import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SESSION_COOKIE = "fp-finance-session";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_CONTACTS_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 5_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZOHO_OAUTH_STATE_COOKIE = "fp-zoho-oauth-state";
const ZOHO_REFRESH_TOKEN_COOKIE = "fp-zoho-refresh-token";
const ZOHO_OAUTH_SCOPES = "ZohoMail.accounts.READ,ZohoMail.messages.CREATE";
const ZOHO_REDIRECT_URI = "https://pdf-money-tracker.vercel.app/api/zoho/callback";
const ZOHO_APP_ORIGIN = "https://pdf-money-tracker.vercel.app";

function hasAdminDatabaseConfig(): boolean {
  return !!process.env["SUPABASE_URL"] && !!process.env["SUPABASE_SERVICE_ROLE_KEY"];
}

interface LoginBody {
  action: "login";
  username: string;
  password: string;
}

interface SendBody {
  action: "send";
  movementId: string;
}

interface ImportContactsBody {
  action: "import_contacts";
  contents: string;
}

interface ClearFinancialDataBody {
  action: "clear_financial_data";
}

type PostBody =
  LoginBody | SendBody | ImportContactsBody | ClearFinancialDataBody | { action: "logout" };

interface MovementRow {
  id: string;
  type: string;
  document: string | null;
  counterparty: string | null;
  due_date: string | null;
  open_amount: number | string;
  open_amount_known: boolean;
  status: string;
  sync_state: "current" | "review";
}

interface ContactRow {
  email: string;
  cc: string;
}

interface ContactImportRow {
  match_key: string;
  counterparty_name: string;
  email: string;
  cc: string;
}

interface ZohoOAuthToken {
  access_token?: string;
  refresh_token?: string;
}

interface ZohoMailAccount {
  accountId?: string;
  primaryEmailAddress?: string;
  mailboxAddress?: string;
  emailAddress?: Array<{ mailId?: string }>;
}

interface ZohoApiStatus {
  status?: { code?: number; description?: string };
}

interface ZohoAccountsResponse extends ZohoApiStatus {
  data?: ZohoMailAccount[];
}

interface ZohoMailCredentials {
  clientId: string;
  clientSecret: string;
  sender: string;
}

interface MailDefinition {
  actionType: "cobranca_vencido" | "aviso_vencimento";
  periodKey: string;
  reminderDays: number | null;
  subject: string;
  body: string;
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, { status, ...(headers ? { headers } : {}) });
}

function requireSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin || new URL(origin).origin !== new URL(request.url).origin) {
    return jsonResponse({ error: "Origem da solicitação não autorizada." }, 403);
  }
  return null;
}

function sessionSecret(): string | null {
  const secret = process.env["BILLING_SESSION_SECRET"];
  return secret && secret.length >= 32 ? secret : null;
}

function safeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

function signature(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function signedSession(username: string, secret: string): string {
  const payload = Buffer.from(
    JSON.stringify({ username, expiresAt: Math.floor(Date.now() / 1000) + SESSION_SECONDS }),
  ).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

function readCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const entry = cookies
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${name}=`));
  if (!entry) return null;
  try {
    return decodeURIComponent(entry.slice(name.length + 1));
  } catch {
    return null;
  }
}

function authenticatedUsername(request: Request): string | null {
  const secret = sessionSecret();
  const cookie = readCookie(request, SESSION_COOKIE);
  if (!secret || !cookie) return null;

  const [payload, receivedSignature, extra] = cookie.split(".");
  if (!payload || !receivedSignature || extra) return null;
  if (!safeEqual(receivedSignature, signature(payload, secret))) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      username?: unknown;
      expiresAt?: unknown;
    };
    if (
      typeof data.username !== "string" ||
      typeof data.expiresAt !== "number" ||
      data.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return data.username;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function cookieHeader(value: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

function zohoCookieHeader(
  name: string,
  value: string,
  request: Request,
  maxAge: number,
  path: string,
  sameSite: "Lax" | "Strict" = "Lax",
): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${secure}`;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function validEmailList(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const addresses = value
    .split(/[;,]/)
    .map((address) => address.trim())
    .filter(Boolean);
  return addresses.length && addresses.every((address) => EMAIL_RE.test(address))
    ? addresses
    : null;
}

function localDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values["year"]}-${values["month"]}-${values["day"]}`;
}

function daysUntil(dueDate: string, today: string): number {
  return Math.round(
    (Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      86_400_000,
  );
}

function mondayOfWeek(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  const daysSinceMonday = (value.getUTCDay() + 6) % 7;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return value.toISOString().slice(0, 10);
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

function buildMail(
  movement: MovementRow,
  reminderDays: number | null,
  daysOverdue: number,
  periodKey: string,
): MailDefinition {
  const document = movement.document ?? "não informado";
  const amount = Number(movement.open_amount);
  const dueDate = movement.due_date!.slice(0, 10).split("-").reverse().join("/");
  const customer = movement.counterparty!;
  const title = `• Título: ${document}\n• Saldo em aberto: ${formatBRL(amount)}\n• Vencimento: ${dueDate}`;

  if (reminderDays !== null) {
    const timeLabel = reminderDays === 1 ? "em 1 dia" : `em ${reminderDays} dias`;
    return {
      actionType: "aviso_vencimento",
      periodKey,
      reminderDays,
      subject: `Lembrete de vencimento – Título ${document}`,
      body:
        `Prezado(a) Sr.(a.) ${customer},\n\n` +
        `Informamos que o título abaixo vencerá ${timeLabel}. Encaminhamos este aviso como lembrete para auxiliar em seu planejamento financeiro.\n\n` +
        `${title}\n\n` +
        "Caso o pagamento já tenha sido realizado, por favor, desconsidere esta mensagem.\n\n" +
        "Permanecemos à disposição para quaisquer esclarecimentos.",
    };
  }

  const overdueText =
    daysOverdue <= 15
      ? "1 a 15 dias"
      : daysOverdue <= 30
        ? "16 a 30 dias"
        : daysOverdue <= 45
          ? "31 a 45 dias"
          : daysOverdue <= 60
            ? "46 a 60 dias"
            : daysOverdue <= 90
              ? "61 a 90 dias"
              : "mais de 90 dias";

  return {
    actionType: "cobranca_vencido",
    periodKey,
    reminderDays: null,
    subject: `Título vencido – ${document}`,
    body:
      `Prezado(a) Sr.(a.) ${customer},\n\n` +
      "Identificamos que o título abaixo encontra-se vencido em nosso sistema e, até o momento, não registramos a respectiva baixa financeira.\n\n" +
      `${title}\n• Dias em atraso: ${daysOverdue}\n• Faixa de cobrança: ${overdueText}\n\n` +
      "Solicitamos, por gentileza, que verifique a situação e providencie a regularização do pagamento.\n\n" +
      "Caso o pagamento já tenha sido realizado, pedimos a gentileza de encaminhar o comprovante ou desconsiderar esta mensagem caso a baixa ainda esteja em processamento.\n\n" +
      "Permanecemos à disposição para quaisquer esclarecimentos e agradecemos sua atenção.",
  };
}

function zohoMailCredentials(): ZohoMailCredentials | null {
  const clientId = process.env["ZOHO_CLIENT_ID"];
  const clientSecret = process.env["ZOHO_CLIENT_SECRET"];
  const sender = process.env["ZOHO_SENDER_EMAIL"];
  if (!clientId || !clientSecret || !sender || !EMAIL_RE.test(sender)) {
    return null;
  }
  return { clientId, clientSecret, sender };
}

async function getZohoAccessToken(
  credentials: ZohoMailCredentials,
  refreshToken: string,
): Promise<string> {
  const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: credentials.clientId,
      client_secret: credentials.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok) {
    throw new Error(`Zoho OAuth recusou a renovação do token (HTTP ${response.status}).`);
  }
  const token = (await response.json()) as ZohoOAuthToken;
  if (!token.access_token) throw new Error("Zoho OAuth não retornou um token de acesso.");
  return token.access_token;
}

async function getZohoAccountId(accessToken: string, sender: string): Promise<string> {
  const response = await fetch("https://mail.zoho.com/api/accounts", {
    headers: { authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Zoho Mail recusou a consulta da caixa (HTTP ${response.status}).`);
  }
  const result = (await response.json()) as ZohoAccountsResponse;
  if (result.status?.code !== 200 || !Array.isArray(result.data)) {
    throw new Error("Zoho Mail não retornou as caixas autorizadas para o usuário.");
  }
  const normalizedSender = sender.toLowerCase();
  const account = result.data.find(
    (candidate) =>
      candidate.primaryEmailAddress?.toLowerCase() === normalizedSender ||
      candidate.mailboxAddress?.toLowerCase() === normalizedSender ||
      candidate.emailAddress?.some((address) => address.mailId?.toLowerCase() === normalizedSender),
  );
  if (!account?.accountId) {
    throw new Error("A caixa remetente não está autorizada na conta Zoho conectada.");
  }
  return account.accountId;
}

function settingsRedirect(request: Request, result: string, headers?: Headers): Response {
  const url = new URL("/configuracoes", request.url);
  url.searchParams.set("zoho", result);
  const responseHeaders = new Headers(headers);
  responseHeaders.set("location", url.toString());
  responseHeaders.set("cache-control", "no-store");
  return new Response(null, { status: 303, headers: responseHeaders });
}

function startZohoAuthorization(request: Request): Response {
  if (new URL(request.url).origin !== ZOHO_APP_ORIGIN) {
    return Response.redirect(`${ZOHO_APP_ORIGIN}/configuracoes?zoho=use-primary-domain`, 303);
  }
  if (!authenticatedUsername(request)) {
    return jsonResponse({ error: "Entre na área de cobrança antes de conectar o Zoho Mail." }, 401);
  }
  const credentials = zohoMailCredentials();
  if (!credentials) {
    return jsonResponse(
      {
        error:
          "Configure ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET e ZOHO_SENDER_EMAIL na Vercel antes de conectar.",
      },
      503,
    );
  }
  const state = randomBytes(32).toString("base64url");
  const authorizationUrl = new URL("https://accounts.zoho.com/oauth/v2/auth");
  authorizationUrl.search = new URLSearchParams({
    client_id: credentials.clientId,
    response_type: "code",
    redirect_uri: ZOHO_REDIRECT_URI,
    scope: ZOHO_OAUTH_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  }).toString();

  const headers = new Headers({
    location: authorizationUrl.toString(),
    "cache-control": "no-store",
  });
  headers.append(
    "set-cookie",
    zohoCookieHeader(ZOHO_OAUTH_STATE_COOKIE, state, request, 600, "/api/zoho/callback"),
  );
  return new Response(null, { status: 302, headers });
}

export async function handleZohoOAuthCallback(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const state = url.searchParams.get("state");
  const expectedState = readCookie(request, ZOHO_OAUTH_STATE_COOKIE);
  const code = url.searchParams.get("code");
  const oauthError = url.searchParams.get("error");
  const headers = new Headers();
  headers.append(
    "set-cookie",
    zohoCookieHeader(ZOHO_OAUTH_STATE_COOKIE, "", request, 0, "/api/zoho/callback"),
  );

  if (!state || !expectedState || !safeEqual(state, expectedState)) {
    return settingsRedirect(request, "invalid-state", headers);
  }
  if (oauthError) return settingsRedirect(request, "denied", headers);
  if (!code) return settingsRedirect(request, "invalid-state", headers);

  const credentials = zohoMailCredentials();
  if (!credentials) return settingsRedirect(request, "not-configured", headers);

  try {
    const response = await fetch("https://accounts.zoho.com/oauth/v2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        redirect_uri: ZOHO_REDIRECT_URI,
      }),
    });
    if (!response.ok) {
      console.error("[billing] Zoho OAuth recusou a autorização", response.status);
      return settingsRedirect(request, "authorization-failed", headers);
    }

    const token = (await response.json()) as ZohoOAuthToken;
    if (!token.refresh_token) {
      console.error("[billing] Zoho OAuth não retornou refresh token");
      return settingsRedirect(request, "authorization-failed", headers);
    }

    headers.append(
      "set-cookie",
      zohoCookieHeader(
        ZOHO_REFRESH_TOKEN_COOKIE,
        token.refresh_token,
        request,
        31_536_000,
        "/api/billing",
        "Strict",
      ),
    );
    return settingsRedirect(request, "connected", headers);
  } catch (error) {
    console.error("[billing] falha ao concluir a autorização Zoho", error);
    return settingsRedirect(request, "authorization-failed", headers);
  }
}

async function importContacts(source: unknown): Promise<Response> {
  if (!hasAdminDatabaseConfig()) {
    return jsonResponse(
      { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
      503,
    );
  }
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return jsonResponse({ error: "O arquivo de contatos deve ser um objeto JSON." }, 400);
  }

  const contacts: ContactImportRow[] = [];
  const rejectedKeys: string[] = [];
  const byKey = new Map<string, ContactImportRow>();
  for (const [rawKey, rawValue] of Object.entries(source)) {
    const name = rawKey.replace(/^nome\s*:\s*/i, "").trim();
    const value = rawValue as { email?: unknown; cc?: unknown } | null;
    const email = validEmailList(value?.email);
    const ccText = value?.cc === undefined || value.cc === null ? "" : value.cc;
    const cc = ccText === "" ? [] : validEmailList(ccText);
    const matchKey = normalizeName(name);
    if (!name || !matchKey || !email || cc === null) {
      rejectedKeys.push(rawKey);
      continue;
    }
    const contact = {
      match_key: matchKey,
      counterparty_name: name,
      email: email.join("; "),
      cc: cc.join("; "),
    };
    const previous = byKey.get(matchKey);
    if (previous && (previous.email !== contact.email || previous.cc !== contact.cc)) {
      return jsonResponse(
        {
          error:
            "Há nomes repetidos com destinatários diferentes; revise o arquivo antes de importar.",
        },
        400,
      );
    }
    byKey.set(matchKey, contact);
  }
  contacts.push(...byKey.values());
  if (!contacts.length) {
    return jsonResponse({ error: "Nenhum contato válido foi encontrado no arquivo." }, 400);
  }

  const { error } = await supabaseAdmin
    .from("receivable_contacts")
    .upsert(contacts, { onConflict: "match_key" });
  if (error) {
    console.error("[billing] falha ao importar contatos", error);
    return jsonResponse({ error: "Não foi possível salvar os contatos." }, 500);
  }
  return jsonResponse({ imported: contacts.length, rejected: rejectedKeys.length });
}

async function sendBillingEmail(body: SendBody, request: Request): Promise<Response> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.movementId,
    )
  ) {
    return jsonResponse({ error: "Identificador do título inválido." }, 400);
  }

  const credentials = zohoMailCredentials();
  const refreshToken = readCookie(request, ZOHO_REFRESH_TOKEN_COOKIE);
  if (!hasAdminDatabaseConfig()) {
    return jsonResponse(
      { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
      503,
    );
  }
  if (!credentials || !refreshToken) {
    return jsonResponse(
      {
        error:
          "Envio indisponível: conecte a caixa financeiro@fpsolucao.com.br à FP Financeiro pelo Zoho. Nenhum e-mail foi enviado.",
      },
      503,
    );
  }

  const { data: movement, error: movementError } = await supabaseAdmin
    .from("financial_movements")
    .select(
      "id,type,document,counterparty,counterparty_document,due_date,open_amount,open_amount_known,status,sync_state",
    )
    .eq("id", body.movementId)
    .maybeSingle();
  if (movementError) {
    console.error("[billing] falha ao consultar o título", movementError);
    return jsonResponse({ error: "Não foi possível validar o título financeiro." }, 500);
  }
  if (!movement) return jsonResponse({ error: "Título não encontrado." }, 404);
  const row = movement as MovementRow & { counterparty_document: string | null };
  if (row.type !== "RECEITA")
    return jsonResponse({ error: "Só títulos de Contas a Receber podem ser enviados." }, 400);
  if (row.sync_state !== "current") {
    return jsonResponse(
      {
        error:
          "Envio bloqueado: o título não consta no último PDF importado e precisa de revisão no Bling.",
      },
      409,
    );
  }
  if (!row.open_amount_known) {
    return jsonResponse(
      { error: "Envio bloqueado: o saldo deste título parcial não consta no relatório importado." },
      409,
    );
  }
  const openAmount = Number(row.open_amount);
  if (!Number.isFinite(openAmount) || openAmount <= 0) {
    return jsonResponse({ error: "O título não tem saldo em aberto para cobrança." }, 409);
  }
  if (!row.counterparty || !row.document || !row.due_date) {
    return jsonResponse(
      { error: "O título não tem cliente, documento ou vencimento suficiente para envio." },
      409,
    );
  }
  if (["CANCELADO", "CANCELADA", "RECEBIDO", "PAGO"].includes(row.status.toUpperCase())) {
    return jsonResponse(
      { error: "O título está cancelado ou quitado e não pode ser enviado." },
      409,
    );
  }

  const today = localDate();
  const untilDue = daysUntil(row.due_date, today);
  const reminderDays = [14, 7, 1].includes(untilDue) ? untilDue : null;
  const daysOverdue = -untilDue;
  if (reminderDays === null && daysOverdue <= 0) {
    return jsonResponse(
      {
        error: "Este título não está vencido nem em um marco de aviso (14, 7 ou 1 dia).",
      },
      409,
    );
  }
  const periodKey = reminderDays === null ? mondayOfWeek(today) : today;
  const mail = buildMail(row, reminderDays, daysOverdue, periodKey);

  const matchKey = normalizeName(row.counterparty);
  const { data: contact, error: contactError } = await supabaseAdmin
    .from("receivable_contacts")
    .select("email,cc")
    .eq("match_key", matchKey)
    .maybeSingle();
  if (contactError) {
    console.error("[billing] falha ao consultar o destinatário", contactError);
    return jsonResponse({ error: "Não foi possível consultar os contatos de cobrança." }, 500);
  }
  if (!contact) {
    return jsonResponse(
      {
        error: "Não há e-mail cadastrado para este cliente. Importe os contatos em Configurações.",
      },
      409,
    );
  }

  const contactRow = contact as ContactRow;
  const recipients = validEmailList(contactRow.email);
  const cc = contactRow.cc ? validEmailList(contactRow.cc) : [];
  if (!recipients || cc === null) {
    return jsonResponse(
      { error: "O destinatário cadastrado não é válido; revise os contatos." },
      409,
    );
  }

  let accessToken: string;
  let accountId: string;
  try {
    accessToken = await getZohoAccessToken(credentials, refreshToken);
    accountId = await getZohoAccountId(accessToken, credentials.sender);
  } catch (error) {
    console.error("[billing] falha ao autorizar a conta Zoho", error);
    return jsonResponse(
      {
        error:
          "Não foi possível autorizar a caixa no Zoho Mail. Revise a conexão OAuth e as permissões accounts.READ e messages.CREATE.",
      },
      502,
    );
  }

  const idempotencyKey = `${row.id}:${mail.actionType}:${periodKey}`;
  const { data: requestRow, error: reserveError } = await supabaseAdmin
    .from("receivable_email_requests")
    .insert({
      idempotency_key: idempotencyKey,
      movement_id: row.id,
      action_type: mail.actionType,
      status: "sending",
      recipient_email: recipients.join("; "),
      subject: mail.subject,
    })
    .select("id")
    .single();
  if (reserveError?.code === "23505") {
    return jsonResponse(
      {
        error:
          "Este título já teve uma solicitação de envio neste período; confira o histórico antes de tentar novamente.",
      },
      409,
    );
  }
  if (reserveError || !requestRow) {
    console.error("[billing] falha ao reservar envio", reserveError);
    return jsonResponse({ error: "Não foi possível reservar o envio com segurança." }, 500);
  }

  let zohoResponse: Response;
  try {
    zohoResponse = await fetch(
      `https://mail.zoho.com/api/accounts/${encodeURIComponent(accountId)}/messages`,
      {
        method: "POST",
        signal: AbortSignal.timeout(20_000),
        headers: {
          authorization: `Zoho-oauthtoken ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          fromAddress: credentials.sender,
          toAddress: recipients.join(","),
          ...(cc.length ? { ccAddress: cc.join(",") } : {}),
          subject: mail.subject,
          content: mail.body,
          mailFormat: "plaintext",
          isSchedule: false,
        }),
      },
    );
  } catch (error) {
    console.error("[billing] falha na chamada da API do Zoho Mail", error);
    const { error: updateError } = await supabaseAdmin
      .from("receivable_email_requests")
      .update({
        status: "needs_review",
        error_code: "zoho_api_network_error",
      })
      .eq("id", requestRow.id);
    if (updateError)
      console.error("[billing] falha ao registrar resultado incerto do Zoho Mail", updateError);
    return jsonResponse(
      {
        error:
          "Não foi possível confirmar se o Zoho Mail recebeu o e-mail. Confira a pasta Enviados e o histórico antes de tentar novamente.",
      },
      502,
    );
  }

  let zohoResult: ZohoApiStatus | null = null;
  try {
    zohoResult = (await zohoResponse.json()) as ZohoApiStatus;
  } catch (error) {
    console.error("[billing] resposta inválida da API do Zoho Mail", error);
    const definiteFailure = zohoResponse.status >= 400 && zohoResponse.status < 500;
    const { error: updateError } = await supabaseAdmin
      .from("receivable_email_requests")
      .update({
        status: definiteFailure ? "failed" : "needs_review",
        error_code: `zoho_invalid_api_response_${zohoResponse.status}`,
      })
      .eq("id", requestRow.id);
    if (updateError)
      console.error("[billing] falha ao registrar resposta inválida do Zoho", updateError);
    return jsonResponse(
      {
        error: definiteFailure
          ? "O Zoho Mail recusou o envio; nenhum e-mail foi enviado."
          : "Não foi possível confirmar se o Zoho Mail aceitou o envio. Confira a pasta Enviados antes de tentar novamente.",
      },
      502,
    );
  }
  if (!zohoResponse.ok || zohoResult?.status?.code !== 200) {
    const apiCode = zohoResult?.status?.code;
    const definiteFailure =
      (zohoResponse.status >= 400 && zohoResponse.status < 500) ||
      (apiCode !== undefined && apiCode >= 400 && apiCode < 500);
    const { error: updateError } = await supabaseAdmin
      .from("receivable_email_requests")
      .update({
        status: definiteFailure ? "failed" : "needs_review",
        error_code: `zoho_api_${apiCode ?? zohoResponse.status}`,
      })
      .eq("id", requestRow.id);
    if (updateError)
      console.error("[billing] falha ao registrar rejeição da API Zoho", updateError);
    return jsonResponse(
      {
        error: definiteFailure
          ? "O Zoho Mail recusou o envio. Nenhum e-mail foi enviado; revise a caixa e as permissões da integração."
          : "Não foi possível confirmar se o Zoho Mail aceitou o e-mail. Confira a pasta Enviados antes de tentar novamente.",
      },
      502,
    );
  }

  const sentAt = new Date().toISOString();
  const { error: eventError } = await supabaseAdmin.from("receivable_email_events").insert({
    event_key: idempotencyKey,
    sent_at: sentAt,
    action_type: mail.actionType,
    recipient_email: recipients.join("; "),
    subject: mail.subject,
    title_count: 1,
    title_documents: [row.document],
    reminder_days: mail.reminderDays,
    aging_ranges:
      reminderDays === null
        ? [
            daysOverdue <= 15
              ? "1-15"
              : daysOverdue <= 30
                ? "16-30"
                : daysOverdue <= 45
                  ? "31-45"
                  : daysOverdue <= 60
                    ? "46-60"
                    : daysOverdue <= 90
                      ? "61-90"
                      : "90+",
          ]
        : [],
    title_details: [
      {
        client: row.counterparty,
        cnpj: row.counterparty_document,
        document: row.document,
        amount: openAmount,
        due_date: row.due_date,
        days_overdue: reminderDays === null ? daysOverdue : null,
        boleto_file: null,
        nf_file: null,
        xml_file: null,
      },
    ],
  });
  if (eventError) {
    console.error("[billing] e-mail aceito, mas falhou ao gravar o histórico", eventError);
    await supabaseAdmin
      .from("receivable_email_requests")
      .update({ status: "needs_review", error_code: "history_write_failed", sent_at: sentAt })
      .eq("id", requestRow.id);
    return jsonResponse(
      {
        error:
          "O Zoho Mail aceitou o e-mail, mas o histórico não foi gravado. Não reenvie até conferir a pasta Enviados.",
      },
      502,
    );
  }

  const { error: updateError } = await supabaseAdmin
    .from("receivable_email_requests")
    .update({ status: "sent", sent_at: sentAt })
    .eq("id", requestRow.id);
  if (updateError) {
    console.error("[billing] e-mail enviado, mas falhou ao atualizar a solicitação", updateError);
    return jsonResponse(
      {
        error:
          "O e-mail foi enviado e entrou no histórico, mas o status da solicitação não foi atualizado.",
      },
      502,
    );
  }

  return jsonResponse(
    { sent: true, actionType: mail.actionType, recipient: recipients.join("; ") },
    200,
  );
}

export async function handleBillingRequest(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const action = new URL(request.url).searchParams.get("action");
    if (action === "zoho_connect") return startZohoAuthorization(request);
    return jsonResponse({
      authenticated: !!authenticatedUsername(request),
      zohoConnected: !!readCookie(request, ZOHO_REFRESH_TOKEN_COOKIE),
      zohoConfigured: !!zohoMailCredentials(),
    });
  }

  const originError = requireSameOrigin(request);
  if (originError) return originError;

  if (request.method !== "POST") {
    return jsonResponse({ error: "Método não permitido." }, 405, { Allow: "GET, POST" });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "Arquivo de contatos excede o limite de 1 MB." }, 413);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: "Corpo da solicitação excede o limite permitido." }, 413);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch (error) {
    if (error instanceof SyntaxError) return jsonResponse({ error: "Corpo JSON inválido." }, 400);
    throw error;
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return jsonResponse({ error: "Corpo JSON inválido." }, 400);
  }
  const body = parsedBody as PostBody;
  if (typeof body.action !== "string") {
    return jsonResponse({ error: "Ação não informada." }, 400);
  }

  if (body.action === "login") {
    const username = process.env["BILLING_LOGIN_USERNAME"];
    const password = process.env["BILLING_LOGIN_PASSWORD"];
    const secret = sessionSecret();
    if (!username || !password || !secret || !hasAdminDatabaseConfig()) {
      return jsonResponse(
        { error: "A autenticação de cobrança não está configurada na Vercel." },
        503,
      );
    }
    if (password.length < 16) {
      return jsonResponse(
        {
          error:
            "A senha de cobrança configurada é fraca; use uma senha aleatória com pelo menos 16 caracteres.",
        },
        503,
      );
    }

    const forwardedIps = request.headers
      .get("x-forwarded-for")
      ?.split(",")
      .map((value) => value.trim());
    const ip = request.headers.get("x-real-ip") ?? forwardedIps?.at(-1) ?? "unknown";
    const ipHash = createHmac("sha256", secret).update(ip).digest("hex");
    const { data: allowed, error: rateError } = await supabaseAdmin.rpc(
      "consume_billing_login_attempt",
      { p_ip_hash: ipHash },
    );
    if (rateError) {
      console.error("[billing] falha no limite de tentativas de login", rateError);
      return jsonResponse({ error: "Não foi possível validar a solicitação de login." }, 503);
    }
    if (!allowed) return jsonResponse({ error: "Muitas tentativas. Aguarde 15 minutos." }, 429);

    const matches =
      typeof body.username === "string" &&
      typeof body.password === "string" &&
      safeEqual(body.username, username) &&
      safeEqual(body.password, password);
    if (!matches) return jsonResponse({ error: "Usuário ou senha inválidos." }, 401);

    const { error: resetError } = await supabaseAdmin
      .from("billing_login_attempts")
      .delete()
      .eq("ip_hash", ipHash);
    if (resetError) {
      console.error("[billing] falha ao reiniciar limite de tentativas", resetError);
      return jsonResponse({ error: "Não foi possível concluir o login." }, 503);
    }

    const responseHeaders = new Headers();
    responseHeaders.append(
      "Set-Cookie",
      cookieHeader(signedSession(username, secret), request, SESSION_SECONDS),
    );
    return jsonResponse({ authenticated: true }, 200, responseHeaders);
  }

  if (body.action === "logout") {
    const responseHeaders = new Headers();
    responseHeaders.append("Set-Cookie", cookieHeader("", request, 0));
    responseHeaders.append(
      "Set-Cookie",
      zohoCookieHeader(ZOHO_REFRESH_TOKEN_COOKIE, "", request, 0, "/api/billing", "Strict"),
    );
    return jsonResponse({ authenticated: false }, 200, responseHeaders);
  }

  if (!authenticatedUsername(request)) {
    return jsonResponse({ error: "Entre na área de cobrança antes de continuar." }, 401);
  }

  if (body.action === "import_contacts") {
    if (
      typeof body.contents !== "string" ||
      Buffer.byteLength(body.contents, "utf8") > MAX_CONTACTS_BYTES
    ) {
      return jsonResponse({ error: "Arquivo de contatos excede o limite de 1 MB." }, 413);
    }
    let source: unknown;
    try {
      source = JSON.parse(body.contents);
    } catch (error) {
      if (error instanceof SyntaxError)
        return jsonResponse({ error: "O arquivo selecionado não contém JSON válido." }, 400);
      throw error;
    }
    return importContacts(source);
  }

  if (body.action === "send") return sendBillingEmail(body, request);
  if (body.action === "clear_financial_data") {
    if (!hasAdminDatabaseConfig()) {
      return jsonResponse(
        { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
        503,
      );
    }
    const { error } = await supabaseAdmin.rpc("clear_financial_data");
    if (error) {
      console.error("[billing] falha ao limpar os dados financeiros", error);
      if (error.code === "P0001") {
        return jsonResponse({ error: error.message }, 409);
      }
      return jsonResponse({ error: "Não foi possível apagar os dados financeiros." }, 500);
    }
    return jsonResponse({ cleared: true });
  }
  return jsonResponse({ error: "Ação de cobrança desconhecida." }, 400);
}
