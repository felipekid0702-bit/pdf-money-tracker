import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SESSION_COOKIE = "fp-finance-session";
const SESSION_SECONDS = 8 * 60 * 60;
const MAX_CONTACTS_BYTES = 1_000_000;
const MAX_REQUEST_BYTES = 5_000_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

interface FiscalDocumentInput {
  direction: "ENTRADA" | "SAIDA";
  document_number: string;
  invoice_type: string | null;
  issue_date: string;
  counterparty: string;
  status: string;
  amount: number;
}

interface ImportFiscalBody {
  action: "import_fiscal";
  sourceFile: string;
  records: FiscalDocumentInput[];
}

interface ClearFinancialDataBody {
  action: "clear_financial_data";
}

type PostBody =
  | LoginBody
  | SendBody
  | ImportContactsBody
  | ImportFiscalBody
  | ClearFinancialDataBody
  | { action: "logout" };

interface MovementRow {
  id: string;
  type: string;
  document: string | null;
  counterparty: string | null;
  due_date: string | null;
  open_amount: number | string;
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

interface GraphToken {
  access_token?: string;
  expires_in?: number;
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
  return entry ? entry.slice(name.length + 1) : null;
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
    daysOverdue <= 30
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

async function postJson(url: string, body: unknown, headers: HeadersInit = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(headers)) },
    body: JSON.stringify(body),
  });
}

async function getGraphToken(): Promise<string> {
  const tenant = process.env["MS_GRAPH_TENANT_ID"];
  const clientId = process.env["MS_GRAPH_CLIENT_ID"];
  const clientSecret = process.env["MS_GRAPH_CLIENT_SECRET"];
  if (!tenant || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph não configurado na Vercel.");
  }

  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!tokenResponse.ok) {
    throw new Error(`Microsoft Graph recusou a autenticação (HTTP ${tokenResponse.status}).`);
  }
  const token = (await tokenResponse.json()) as GraphToken;
  if (!token.access_token) throw new Error("Microsoft Graph não retornou um token de acesso.");
  return token.access_token;
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

async function importFiscalDocuments(body: ImportFiscalBody): Promise<Response> {
  if (!hasAdminDatabaseConfig()) {
    return jsonResponse(
      { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
      503,
    );
  }
  if (
    typeof body.sourceFile !== "string" ||
    !body.sourceFile.trim() ||
    body.sourceFile.length > 255 ||
    !Array.isArray(body.records) ||
    body.records.length === 0 ||
    body.records.length > 10_000
  ) {
    return jsonResponse(
      { error: "O relatório fiscal está vazio ou excede o limite permitido." },
      400,
    );
  }

  const rows = new Map<string, FiscalDocumentInput & { source_file: string; unique_key: string }>();
  for (const rawRecord of body.records) {
    if (!rawRecord || typeof rawRecord !== "object") {
      return jsonResponse({ error: "O relatório contém um registro inválido." }, 400);
    }
    const record = rawRecord as FiscalDocumentInput;
    const parsedDate =
      typeof record.issue_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record.issue_date)
        ? Date.parse(`${record.issue_date}T00:00:00Z`)
        : Number.NaN;
    const issueDate =
      Number.isFinite(parsedDate) &&
      new Date(parsedDate).toISOString().slice(0, 10) === record.issue_date
        ? record.issue_date
        : null;
    if (
      !["ENTRADA", "SAIDA"].includes(record.direction) ||
      typeof record.document_number !== "string" ||
      !record.document_number.trim() ||
      record.document_number.length > 100 ||
      !issueDate ||
      typeof record.counterparty !== "string" ||
      !record.counterparty.trim() ||
      record.counterparty.length > 500 ||
      typeof record.status !== "string" ||
      !record.status.trim() ||
      record.status.length > 120 ||
      (record.invoice_type !== null &&
        (typeof record.invoice_type !== "string" || record.invoice_type.length > 40)) ||
      typeof record.amount !== "number" ||
      !Number.isFinite(record.amount) ||
      Math.abs(record.amount) >= 1_000_000_000_000
    ) {
      return jsonResponse({ error: "O relatório contém campos inválidos ou incompletos." }, 400);
    }

    const documentNumber = record.document_number.trim();
    const counterparty = record.counterparty.trim();
    const uniqueKey = createHash("sha256")
      .update(
        [
          record.direction,
          documentNumber.toLocaleUpperCase("pt-BR"),
          issueDate,
          normalizeName(counterparty),
        ].join("|"),
      )
      .digest("hex");
    const row = {
      ...record,
      document_number: documentNumber,
      issue_date: issueDate,
      counterparty,
      status: record.status.trim(),
      invoice_type: record.invoice_type?.trim() || null,
      amount: Number(record.amount.toFixed(2)),
      source_file: body.sourceFile.trim(),
      unique_key: uniqueKey,
    };
    const previous = rows.get(uniqueKey);
    if (
      previous &&
      (previous.amount !== row.amount ||
        previous.status !== row.status ||
        previous.invoice_type !== row.invoice_type)
    ) {
      return jsonResponse(
        {
          error:
            "O PDF contém a mesma nota mais de uma vez com dados diferentes. Revise o relatório antes de importar.",
        },
        400,
      );
    }
    rows.set(uniqueKey, row);
  }

  const imports = [...rows.values()];
  const existingKeys = new Set<string>();
  for (let offset = 0; offset < imports.length; offset += 200) {
    const batch = imports.slice(offset, offset + 200);
    const { data, error } = await supabaseAdmin
      .from("fiscal_documents")
      .select("unique_key")
      .in(
        "unique_key",
        batch.map((row) => row.unique_key),
      );
    if (error) {
      console.error("[billing] falha ao consultar notas fiscais existentes", error);
      return jsonResponse({ error: "Não foi possível validar notas fiscais já importadas." }, 500);
    }
    for (const row of data ?? []) existingKeys.add(row.unique_key);
  }

  const { error: upsertError } = await supabaseAdmin
    .from("fiscal_documents")
    .upsert(imports, { onConflict: "unique_key" });
  if (upsertError) {
    console.error("[billing] falha ao salvar notas fiscais", upsertError);
    return jsonResponse({ error: "Não foi possível salvar as notas fiscais importadas." }, 500);
  }

  return jsonResponse({
    created: imports.filter((row) => !existingKeys.has(row.unique_key)).length,
    existing: existingKeys.size,
    total: imports.length,
  });
}

async function sendBillingEmail(body: SendBody): Promise<Response> {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      body.movementId,
    )
  ) {
    return jsonResponse({ error: "Identificador do título inválido." }, 400);
  }

  const sender = process.env["MS_GRAPH_SENDER_EMAIL"];
  if (!hasAdminDatabaseConfig()) {
    return jsonResponse(
      { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
      503,
    );
  }
  if (
    !sender ||
    !process.env["MS_GRAPH_TENANT_ID"] ||
    !process.env["MS_GRAPH_CLIENT_ID"] ||
    !process.env["MS_GRAPH_CLIENT_SECRET"]
  ) {
    return jsonResponse(
      { error: "O envio por Microsoft Graph ainda não foi configurado na Vercel." },
      503,
    );
  }

  const { data: movement, error: movementError } = await supabaseAdmin
    .from("financial_movements")
    .select(
      "id,type,document,counterparty,counterparty_document,due_date,open_amount,status,sync_state",
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
  if (reminderDays === null && daysOverdue <= 15) {
    return jsonResponse(
      {
        error:
          "Este título não está em um marco de aviso (14, 7 ou 1 dia) nem ultrapassou 15 dias de atraso.",
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

  let accessToken: string;
  try {
    accessToken = await getGraphToken();
  } catch (error) {
    console.error("[billing] falha ao autenticar no Microsoft Graph", error);
    const { error: updateError } = await supabaseAdmin
      .from("receivable_email_requests")
      .update({ status: "failed", error_code: "graph_authentication_failed" })
      .eq("id", requestRow.id);
    if (updateError)
      console.error("[billing] falha ao registrar erro de autenticação Graph", updateError);
    return jsonResponse(
      { error: "Não foi possível autenticar no Microsoft Graph; nenhum e-mail foi enviado." },
      502,
    );
  }

  let graphResponse: Response;
  try {
    graphResponse = await postJson(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        message: {
          subject: mail.subject,
          body: { contentType: "Text", content: mail.body },
          toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          ccRecipients: (cc ?? []).map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: true,
      },
      { authorization: `Bearer ${accessToken}` },
    );
  } catch (error) {
    console.error("[billing] falha na chamada do Microsoft Graph", error);
    const { error: updateError } = await supabaseAdmin
      .from("receivable_email_requests")
      .update({ status: "needs_review", error_code: "graph_network_error" })
      .eq("id", requestRow.id);
    if (updateError) console.error("[billing] falha ao marcar envio para revisão", updateError);
    return jsonResponse(
      {
        error:
          "Não foi possível confirmar o resultado do envio no Microsoft Graph. Confira o Outlook e o histórico antes de tentar novamente.",
      },
      502,
    );
  }

  if (graphResponse.status !== 202) {
    const errorCode = `graph_http_${graphResponse.status}`;
    const { error: updateError } = await supabaseAdmin
      .from("receivable_email_requests")
      .update({ status: "failed", error_code: errorCode })
      .eq("id", requestRow.id);
    if (updateError) console.error("[billing] falha ao registrar rejeição Graph", updateError);
    return jsonResponse(
      { error: `O Microsoft Graph não aceitou o envio (HTTP ${graphResponse.status}).` },
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
            daysOverdue <= 30
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
          "O Microsoft Graph aceitou o e-mail, mas o histórico não foi gravado. Não reenvie até conferir os Itens Enviados.",
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
    const resource = new URL(request.url).searchParams.get("resource");
    if (resource === "fiscal") {
      if (!authenticatedUsername(request)) {
        return jsonResponse({ error: "Entre na área de cobrança antes de continuar." }, 401);
      }
      if (!hasAdminDatabaseConfig()) {
        return jsonResponse(
          { error: "O acesso privado ao Supabase não foi configurado na Vercel." },
          503,
        );
      }
      const { data, error } = await supabaseAdmin
        .from("fiscal_documents")
        .select(
          "id,direction,document_number,invoice_type,issue_date,counterparty,status,amount,source_file,imported_at",
        )
        .order("imported_at", { ascending: false })
        .limit(100);
      if (error) {
        console.error("[billing] falha ao carregar notas fiscais", error);
        return jsonResponse({ error: "Não foi possível carregar as notas fiscais." }, 500);
      }
      return jsonResponse({ documents: data ?? [] });
    }
    return jsonResponse({ authenticated: !!authenticatedUsername(request) });
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

  if (body.action === "import_fiscal") return importFiscalDocuments(body);
  if (body.action === "send") return sendBillingEmail(body);
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
      return jsonResponse(
        { error: "Não foi possível apagar os dados financeiros e fiscais." },
        500,
      );
    }
    return jsonResponse({ cleared: true });
  }
  return jsonResponse({ error: "Ação de cobrança desconhecida." }, 400);
}
