import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isCompanyId } from "@/lib/companies";
import type { PartialBalanceAdjustment } from "./data";
import type { ParsedRecord } from "./pdf-parser";

const SESSION_COOKIE = "fp-finance-session";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_CONTACTS_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 5_000_000;
const BILLING_EVENTS_PAGE_SIZE = 1_000;
const BILLING_HISTORY_MOVEMENT_PAGE_SIZE = 1_000;
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
  companyId: string;
  movementId: string;
  recipientEmail: string;
  ccEmail: string;
}

interface ImportContactsBody {
  action: "import_contacts";
  companyId: string;
  contents: string;
}

interface ImportRecordsBody {
  action: "import_records";
  companyId: string;
  records: ParsedRecord[];
  pdfTotal: number | null;
  fileName: string;
  found: number;
  rejected: number;
}

interface SavePartialBalancesBody {
  action: "save_partial_balances";
  companyId: string;
  adjustments: PartialBalanceAdjustment[];
}

interface ClearFinancialDataBody {
  action: "clear_financial_data";
  companyId: string;
}

type PostBody =
  | LoginBody
  | SendBody
  | ImportContactsBody
  | ImportRecordsBody
  | SavePartialBalancesBody
  | ClearFinancialDataBody
  | { action: "logout" };

interface MovementRow {
  id: string;
  type: string;
  document: string | null;
  counterparty: string | null;
  counterparty_document: string | null;
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
  company_id: string;
  match_key: string;
  counterparty_name: string;
  email: string;
  cc: string;
}

interface BillingRecipientHistory {
  id: string;
  action_type: string;
  recipient_email: string | null;
  title_documents: string[];
  title_details: unknown;
  sent_at: string;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNullableText(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === "string" && value.length <= maxLength);
}

function isParsedRecord(value: unknown): value is ParsedRecord {
  if (!isObject(value)) return false;
  const isDate = (date: unknown) =>
    date === null || (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date));
  const type = value["type"];
  const source = value["source"];
  return (
    (type === "RECEITA" || type === "DESPESA") &&
    ((type === "RECEITA" && source === "BLING_RECEBER") ||
      (type === "DESPESA" && source === "BLING_PAGAR")) &&
    (value["amount_kind"] === "original" || value["amount_kind"] === "balance") &&
    isNullableText(value["document"], 512) &&
    isNullableText(value["counterparty"], 2048) &&
    isNullableText(value["counterparty_document"], 128) &&
    isNullableText(value["description"], 4096) &&
    isDate(value["issue_date"]) &&
    isDate(value["due_date"]) &&
    isDate(value["payment_date"]) &&
    Number.isFinite(value["original_amount"]) &&
    Number.isFinite(value["paid_amount"]) &&
    Number.isFinite(value["open_amount"]) &&
    typeof value["paid_amount_known"] === "boolean" &&
    typeof value["open_amount_known"] === "boolean" &&
    typeof value["status"] === "string" &&
    value["status"].length <= 128 &&
    typeof value["source_file"] === "string" &&
    value["source_file"].length <= 512 &&
    typeof value["unique_key"] === "string" &&
    value["unique_key"].length > 0 &&
    value["unique_key"].length <= 2048
  );
}

function isImportRecordsBody(value: unknown): value is ImportRecordsBody {
  return (
    isObject(value) &&
    value["action"] === "import_records" &&
    isCompanyId(value["companyId"]) &&
    Array.isArray(value["records"]) &&
    value["records"].length > 0 &&
    value["records"].every(isParsedRecord) &&
    (value["pdfTotal"] === null ||
      (typeof value["pdfTotal"] === "number" && Number.isFinite(value["pdfTotal"]))) &&
    typeof value["fileName"] === "string" &&
    value["fileName"].trim().length > 0 &&
    value["fileName"].length <= 512 &&
    Number.isInteger(value["found"]) &&
    Number.isInteger(value["rejected"]) &&
    Number(value["found"]) >= value["records"].length &&
    Number(value["rejected"]) >= 0
  );
}

function isSavePartialBalancesBody(value: unknown): value is SavePartialBalancesBody {
  return (
    isObject(value) &&
    value["action"] === "save_partial_balances" &&
    isCompanyId(value["companyId"]) &&
    Array.isArray(value["adjustments"]) &&
    value["adjustments"].length > 0 &&
    value["adjustments"].length <= 1_000 &&
    value["adjustments"].every(
      (adjustment) =>
        isObject(adjustment) &&
        typeof adjustment["movementId"] === "string" &&
        adjustment["movementId"].length <= 128 &&
        typeof adjustment["openAmount"] === "number" &&
        Number.isFinite(adjustment["openAmount"]),
    )
  );
}

async function getFinanceData(
  action: "movements" | "partial_balances",
  companyId: string,
): Promise<Response> {
  if (!hasAdminDatabaseConfig()) {
    return jsonResponse(
      { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
      503,
    );
  }
  try {
    const data = await import("@/lib/data");
    const result =
      action === "movements"
        ? await data.fetchAllMovementsFromDatabase(companyId, supabaseAdmin)
        : await data.fetchPendingPartialBalancesFromDatabase(companyId, supabaseAdmin);
    return jsonResponse(result);
  } catch (error) {
    console.error(`[billing] falha ao carregar ${action}`, error);
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Não foi possível carregar os dados financeiros.",
      },
      500,
    );
  }
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

async function importContacts(source: unknown, companyId: string): Promise<Response> {
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
      company_id: companyId,
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
    .upsert(contacts, { onConflict: "company_id,match_key" });
  if (error) {
    console.error("[billing] falha ao importar contatos", error);
    return jsonResponse({ error: "Não foi possível salvar os contatos." }, 500);
  }
  return jsonResponse({ imported: contacts.length, rejected: rejectedKeys.length });
}

function validMovementId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function documentMatchKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ""));
}

async function findPreviousRecipients(
  companyId: string,
  movement: Pick<MovementRow, "counterparty" | "counterparty_document" | "document">,
): Promise<string[]> {
  const recipients = new Set<string>();
  const pageSize = 1_000;
  const customerKey = normalizeName(movement.counterparty ?? "");
  const customerDocument = (movement.counterparty_document ?? "").replace(/\D/g, "");
  const documentKey = movement.document ? documentMatchKey(movement.document) : "";

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("receivable_email_events")
      .select("id,action_type,recipient_email,title_documents,title_details,sent_at")
      .eq("company_id", companyId)
      .in("action_type", ["cobranca_vencido", "aviso_vencimento"])
      .order("sent_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (error) {
      console.error("[billing] falha ao consultar destinatários anteriores", error);
      throw new Error("Não foi possível consultar os destinatários usados anteriormente.");
    }

    for (const event of (data ?? []) as BillingRecipientHistory[]) {
      const details = Array.isArray(event.title_details) ? event.title_details : [];
      const customerMatches = details.map((value) => {
        if (!isJsonRecord(value)) return null;
        const detailDocument =
          typeof value["cnpj"] === "string" ? value["cnpj"].replace(/\D/g, "") : "";
        const detailName =
          typeof value["client"] === "string" ? normalizeName(value["client"]) : "";
        if (customerDocument && detailDocument) return customerDocument === detailDocument;
        if (customerKey && detailName) return detailName === customerKey;
        return null;
      });
      const sameCustomer = customerMatches.some((matches) => matches === true);
      const conflictingCustomer = customerMatches.some((matches) => matches === false);
      const sameTitle =
        !!documentKey &&
        (event.title_documents ?? []).some(
          (document) => documentMatchKey(document) === documentKey,
        );
      if ((!sameCustomer && !sameTitle) || conflictingCustomer) continue;

      const addresses = validEmailList(event.recipient_email ?? "");
      for (const address of addresses ?? []) recipients.add(address);
    }
    if ((data ?? []).length < pageSize) break;
  }

  return [...recipients];
}

async function getBillingRecipient(request: Request, companyId: string): Promise<Response> {
  if (!authenticatedUsername(request)) {
    return jsonResponse(
      { error: "Entre na área de cobrança para consultar os destinatários." },
      401,
    );
  }
  if (!hasAdminDatabaseConfig()) {
    return jsonResponse(
      { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
      503,
    );
  }
  const movementId = new URL(request.url).searchParams.get("movementId");
  if (!validMovementId(movementId)) {
    return jsonResponse({ error: "Identificador do título inválido." }, 400);
  }

  const { data: movement, error: movementError } = await supabaseAdmin
    .from("financial_movements")
    .select("id,type,document,counterparty,counterparty_document")
    .eq("company_id", companyId)
    .eq("id", movementId)
    .maybeSingle();
  if (movementError) {
    console.error("[billing] falha ao consultar dados do destinatário", movementError);
    return jsonResponse({ error: "Não foi possível consultar o cliente do título." }, 500);
  }
  if (!movement || movement.type !== "RECEITA" || !movement.counterparty) {
    return jsonResponse({ error: "Cliente do título não encontrado." }, 404);
  }

  const matchKey = normalizeName(movement.counterparty);
  let contact: ContactRow | null;
  let previousRecipients: string[];
  try {
    const [contactResult, historyRecipients] = await Promise.all([
      supabaseAdmin
        .from("receivable_contacts")
        .select("email,cc")
        .eq("company_id", companyId)
        .eq("match_key", matchKey)
        .maybeSingle(),
      findPreviousRecipients(companyId, movement),
    ]);
    if (contactResult.error) {
      console.error("[billing] falha ao consultar contato salvo", contactResult.error);
      return jsonResponse({ error: "Não foi possível consultar o contato salvo." }, 500);
    }
    contact = contactResult.data as ContactRow | null;
    previousRecipients = historyRecipients;
  } catch (error) {
    console.error("[billing] falha ao carregar destinatários de cobrança", error);
    return jsonResponse(
      { error: "Não foi possível carregar os endereços de cobrança anteriores." },
      500,
    );
  }

  const savedRecipients = contact ? validEmailList(contact.email) : null;
  const recipients = [...new Set([...(savedRecipients ?? []), ...previousRecipients])];
  return jsonResponse({
    recipientEmail: savedRecipients?.join("; ") ?? previousRecipients.join("; "),
    ccEmail: contact?.cc ?? "",
    previousRecipients: recipients,
  });
}

async function sendBillingEmail(body: SendBody, request: Request): Promise<Response> {
  if (!validMovementId(body.movementId)) {
    return jsonResponse({ error: "Identificador do título inválido." }, 400);
  }
  const recipients = validEmailList(body.recipientEmail);
  const cc = body.ccEmail === "" ? [] : validEmailList(body.ccEmail);
  if (!recipients || cc === null) {
    return jsonResponse({ error: "Informe endereços válidos nos campos Para e Cc." }, 400);
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
    .eq("company_id", body.companyId)
    .eq("id", body.movementId)
    .maybeSingle();
  if (movementError) {
    console.error("[billing] falha ao consultar o título", movementError);
    return jsonResponse({ error: "Não foi possível validar o título financeiro." }, 500);
  }
  if (!movement) return jsonResponse({ error: "Título não encontrado." }, 404);
  const row = movement as MovementRow;
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
  const { error: saveContactError } = await supabaseAdmin.from("receivable_contacts").upsert(
    {
      company_id: body.companyId,
      match_key: matchKey,
      counterparty_name: row.counterparty,
      email: recipients.join("; "),
      cc: cc.join("; "),
    },
    { onConflict: "company_id,match_key" },
  );
  if (saveContactError) {
    console.error("[billing] falha ao salvar o destinatário confirmado", saveContactError);
    return jsonResponse(
      { error: "Não foi possível salvar o contato confirmado; nenhum e-mail foi enviado." },
      500,
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

  const idempotencyKey = `${body.companyId}:${row.id}:${mail.actionType}:${periodKey}`;
  const { data: requestRow, error: reserveError } = await supabaseAdmin
    .from("receivable_email_requests")
    .insert({
      company_id: body.companyId,
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
      .eq("company_id", body.companyId)
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
      .eq("company_id", body.companyId)
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
      .eq("company_id", body.companyId)
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
    company_id: body.companyId,
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
      .eq("company_id", body.companyId)
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
    .eq("company_id", body.companyId)
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

function validISODate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

interface BillingHistoryMovement {
  id: string;
  document: string | null;
  counterparty: string | null;
  counterparty_document: string | null;
  due_date: string | null;
  original_amount: number | string;
}

async function findBillingHistoryMovements(
  companyId: string,
  field: "document" | "counterparty_document",
  values: string[],
): Promise<BillingHistoryMovement[]> {
  const matches = new Map<string, BillingHistoryMovement>();
  for (const valueChunk of chunks([...new Set(values)], 50)) {
    for (let offset = 0; ; offset += BILLING_HISTORY_MOVEMENT_PAGE_SIZE) {
      let query = supabaseAdmin
        .from("financial_movements")
        .select("id,document,counterparty,counterparty_document,due_date,original_amount")
        .eq("company_id", companyId)
        .eq("type", "RECEITA")
        .order("id", { ascending: true })
        .range(offset, offset + BILLING_HISTORY_MOVEMENT_PAGE_SIZE - 1);
      query =
        field === "document"
          ? query.in("document", valueChunk)
          : query.in("counterparty_document", valueChunk);
      const { data, error } = await query;
      if (error) {
        console.error("[billing] falha ao conciliar detalhes do histórico", error);
        throw new Error("Não foi possível conciliar os títulos do histórico.");
      }
      for (const row of data ?? []) matches.set(row.id, row);
      if ((data ?? []).length < BILLING_HISTORY_MOVEMENT_PAGE_SIZE) break;
    }
  }
  return [...matches.values()];
}

async function getBillingEvents(request: Request, companyId: string): Promise<Response> {
  if (!authenticatedUsername(request)) {
    return jsonResponse({ error: "Entre na área de cobrança para consultar o histórico." }, 401);
  }
  if (!hasAdminDatabaseConfig()) {
    return jsonResponse(
      { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
      503,
    );
  }

  const params = new URL(request.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if ((from && !validISODate(from)) || (to && !validISODate(to))) {
    return jsonResponse({ error: "O período informado para o histórico é inválido." }, 400);
  }
  if (from && to && from > to) {
    return jsonResponse(
      { error: "A data inicial do histórico não pode ser posterior à final." },
      400,
    );
  }

  const fromTimestamp = from ? new Date(`${from}T00:00:00-03:00`).toISOString() : null;
  let toTimestamp: string | null = null;
  if (to) {
    const end = new Date(`${to}T00:00:00-03:00`);
    end.setUTCDate(end.getUTCDate() + 1);
    toTimestamp = end.toISOString();
  }

  const events = [];
  for (let offset = 0; ; offset += BILLING_EVENTS_PAGE_SIZE) {
    let query = supabaseAdmin
      .from("receivable_email_events")
      .select("*")
      .eq("company_id", companyId)
      .order("sent_at", { ascending: false })
      .range(offset, offset + BILLING_EVENTS_PAGE_SIZE - 1);
    if (fromTimestamp) query = query.gte("sent_at", fromTimestamp);
    if (toTimestamp) query = query.lt("sent_at", toTimestamp);

    const { data, error } = await query;
    if (error) {
      console.error("[billing] falha ao consultar o histórico de cobranças", error);
      return jsonResponse({ error: "Não foi possível carregar o histórico de cobranças." }, 500);
    }
    events.push(...(data ?? []));
    if ((data ?? []).length < BILLING_EVENTS_PAGE_SIZE) break;
  }

  const documents = new Set<string>();
  const counterpartyDocuments = new Set<string>();
  for (const event of events) {
    const details = Array.isArray(event.title_details) ? event.title_details : [];
    const needsMovementDetails =
      details.length < event.title_count ||
      details.some(
        (detail) =>
          !isJsonRecord(detail) ||
          typeof detail["client"] !== "string" ||
          typeof detail["document"] !== "string" ||
          typeof detail["amount"] !== "number" ||
          typeof detail["due_date"] !== "string",
      );
    if (!needsMovementDetails) continue;

    for (const document of event.title_documents ?? []) {
      if (typeof document === "string" && document) documents.add(document);
    }
    for (const detail of details) {
      if (!isJsonRecord(detail)) continue;
      if (typeof detail["document"] === "string" && detail["document"]) {
        documents.add(detail["document"]);
      }
      if (typeof detail["cnpj"] === "string" && detail["cnpj"]) {
        counterpartyDocuments.add(detail["cnpj"]);
      }
    }
  }

  try {
    const [documentMatches, counterpartyMatches] = await Promise.all([
      findBillingHistoryMovements(companyId, "document", [...documents]),
      findBillingHistoryMovements(companyId, "counterparty_document", [...counterpartyDocuments]),
    ]);
    const movements = new Map<string, BillingHistoryMovement>();
    for (const row of [...documentMatches, ...counterpartyMatches]) movements.set(row.id, row);
    return jsonResponse({ events, movements: [...movements.values()] });
  } catch (error) {
    console.error("[billing] falha ao completar o histórico de cobranças", error);
    return jsonResponse(
      { error: "Não foi possível carregar todos os dados do histórico de cobranças." },
      500,
    );
  }
}

export async function handleBillingRequest(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const params = new URL(request.url).searchParams;
    const action = params.get("action");
    const companyId = params.get("companyId");
    if (action === "zoho_connect") return startZohoAuthorization(request);
    if (action === "events" || action === "recipient") {
      if (!isCompanyId(companyId)) {
        return jsonResponse({ error: "Empresa inválida ou não informada." }, 400);
      }
      return action === "events"
        ? getBillingEvents(request, companyId)
        : getBillingRecipient(request, companyId);
    }
    if (action === "movements" || action === "partial_balances") {
      if (!authenticatedUsername(request)) {
        return jsonResponse({ error: "Entre na área de cobrança antes de continuar." }, 401);
      }
      if (!isCompanyId(companyId)) {
        return jsonResponse({ error: "Empresa inválida ou não informada." }, 400);
      }
      return getFinanceData(action, companyId);
    }
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
    return jsonResponse({ error: "A solicitação excede o limite permitido." }, 413);
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

  if (body.action === "save_partial_balances") {
    if (!isSavePartialBalancesBody(parsedBody)) {
      return jsonResponse({ error: "Os ajustes de saldo parcial são inválidos." }, 400);
    }
    if (!hasAdminDatabaseConfig()) {
      return jsonResponse(
        { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
        503,
      );
    }
    try {
      const { savePartialBalanceAdjustmentsToDatabase } = await import("@/lib/data");
      await savePartialBalanceAdjustmentsToDatabase(
        body.companyId,
        body.adjustments,
        supabaseAdmin,
      );
      return jsonResponse({ saved: true });
    } catch (error) {
      console.error("[billing] falha ao salvar saldos parciais", error);
      return jsonResponse(
        {
          error:
            error instanceof Error ? error.message : "Não foi possível salvar os saldos parciais.",
        },
        500,
      );
    }
  }

  if (body.action === "import_records") {
    if (!isImportRecordsBody(parsedBody)) {
      return jsonResponse({ error: "Os dados do relatório são inválidos." }, 400);
    }
    if (!hasAdminDatabaseConfig()) {
      return jsonResponse(
        { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
        503,
      );
    }
    try {
      const { importRecords } = await import("@/lib/data");
      const summary = await importRecords(
        body.records,
        body.pdfTotal,
        body.fileName,
        body.found,
        body.rejected,
        supabaseAdmin,
        body.companyId,
      );
      return jsonResponse(summary);
    } catch (error) {
      console.error("[billing] falha ao importar relatório financeiro", error);
      return jsonResponse(
        {
          error:
            error instanceof Error
              ? error.message
              : "Não foi possível gravar os registros financeiros.",
        },
        500,
      );
    }
  }

  if (body.action === "import_contacts") {
    if (!isCompanyId(body.companyId)) {
      return jsonResponse({ error: "Empresa inválida ou não informada." }, 400);
    }
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
    return importContacts(source, body.companyId);
  }

  if (body.action === "send") {
    if (!isCompanyId(body.companyId)) {
      return jsonResponse({ error: "Empresa inválida ou não informada." }, 400);
    }
    return sendBillingEmail(body, request);
  }
  if (body.action === "clear_financial_data") {
    if (!isCompanyId(body.companyId)) {
      return jsonResponse({ error: "Empresa inválida ou não informada." }, 400);
    }
    if (!hasAdminDatabaseConfig()) {
      return jsonResponse(
        { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
        503,
      );
    }
    const { error } = await supabaseAdmin.rpc("clear_financial_data", {
      p_company_id: body.companyId,
    });
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
