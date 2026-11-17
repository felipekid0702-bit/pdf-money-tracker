import type { Movement, MovementType } from "./finance";

/** Situações que o usuário escolhe no editor; o status do Bling é derivado delas. */
export type EditSituation = "EM_ABERTO" | "PARCIAL" | "LIQUIDADO" | "CANCELADO";

export interface MovementEditInput {
  document: string | null;
  counterparty: string | null;
  counterparty_document: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  original_amount: number;
  paid_amount: number;
  situation: EditSituation;
}

/** Campos gravados em financial_movements por uma edição manual. */
export interface MovementEditPatch {
  document: string | null;
  counterparty: string | null;
  counterparty_document: string | null;
  description: string | null;
  issue_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  original_amount: number;
  paid_amount: number;
  open_amount: number;
  paid_amount_known: true;
  open_amount_known: true;
  manual_paid_amount: number | null;
  status: string;
}

export const FIELD_LABELS: Record<string, string> = {
  document: "Documento",
  counterparty: "Cliente/Fornecedor",
  counterparty_document: "CPF/CNPJ",
  description: "Histórico",
  issue_date: "Emissão",
  due_date: "Vencimento",
  payment_date: "Data de recebimento/pagamento",
  original_amount: "Valor original",
  paid_amount: "Valor recebido/pago",
  open_amount: "Saldo em aberto",
  status: "Situação",
};

/** Campos comparados para o histórico (ordem de exibição). */
export const TRACKED_FIELDS = [
  "document",
  "counterparty",
  "counterparty_document",
  "description",
  "issue_date",
  "due_date",
  "payment_date",
  "original_amount",
  "paid_amount",
  "open_amount",
  "status",
] as const;

/** Campos que dependem entre si e por isso são protegidos juntos na reimportação. */
export const FINANCIAL_LOCK_FIELDS = [
  "original_amount",
  "paid_amount",
  "open_amount",
  "paid_amount_known",
  "open_amount_known",
  "status",
  "payment_date",
];

const cents = (v: number) => Math.round(v * 100);
const isISODate = (v: string | null) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v);

export function situationOf(m: Pick<Movement, "status" | "type">): EditSituation {
  const s = (m.status ?? "").toUpperCase();
  if (s === "CANCELADO" || s === "CANCELADA") return "CANCELADO";
  if (s === "RECEBIDO" || s === "PAGO") return "LIQUIDADO";
  if (s === "PARCIALMENTE_RECEBIDO" || s === "PARCIALMENTE_PAGO") return "PARCIAL";
  return "EM_ABERTO";
}

export function statusFor(
  type: MovementType,
  situation: EditSituation,
  dueDate: string | null,
  today: string,
): string {
  if (situation === "CANCELADO") return "CANCELADO";
  if (situation === "LIQUIDADO") return type === "RECEITA" ? "RECEBIDO" : "PAGO";
  if (situation === "PARCIAL") return type === "RECEITA" ? "PARCIALMENTE_RECEBIDO" : "PARCIALMENTE_PAGO";
  return dueDate && dueDate < today ? "ATRASADO" : "EM_ABERTO";
}

/** Valida a entrada; devolve a mensagem de erro ou null. */
export function validateEdit(input: MovementEditInput): string | null {
  if (!Number.isFinite(input.original_amount) || input.original_amount < 0)
    return "O valor original deve ser um número maior ou igual a zero.";
  if (!Number.isFinite(input.paid_amount) || input.paid_amount < 0)
    return "O valor recebido/pago não pode ser negativo.";
  for (const [label, value] of [
    ["emissão", input.issue_date],
    ["vencimento", input.due_date],
    ["recebimento/pagamento", input.payment_date],
  ] as const) {
    if (!isISODate(value)) return `Data de ${label} inválida.`;
  }
  if (input.situation === "PARCIAL") {
    if (cents(input.paid_amount) <= 0 || cents(input.paid_amount) >= cents(input.original_amount))
      return "Em pagamento parcial, o valor recebido/pago deve ser maior que zero e menor que o valor original.";
  }
  for (const [text, max] of [
    [input.document, 512],
    [input.counterparty, 2048],
    [input.counterparty_document, 128],
    [input.description, 4096],
  ] as const) {
    if (text !== null && text.length > max) return "Um dos textos excede o tamanho permitido.";
  }
  return null;
}

/** Converte a entrada do editor nos campos gravados, mantendo valores coerentes. */
export function buildPatch(
  type: MovementType,
  input: MovementEditInput,
  today: string,
): MovementEditPatch {
  const original = cents(input.original_amount) / 100;
  let paid = 0;
  let open = 0;
  let manualPaid: number | null = null;
  if (input.situation === "LIQUIDADO") {
    paid = original;
  } else if (input.situation === "PARCIAL") {
    paid = cents(input.paid_amount) / 100;
    open = cents(original - paid) / 100;
    manualPaid = paid;
  } else if (input.situation === "EM_ABERTO") {
    open = original;
  }
  const blank = (v: string | null) => (v && v.trim() ? v.trim() : null);
  return {
    document: blank(input.document),
    counterparty: blank(input.counterparty),
    counterparty_document: blank(input.counterparty_document),
    description: blank(input.description),
    issue_date: input.issue_date || null,
    due_date: input.due_date || null,
    payment_date:
      input.situation === "LIQUIDADO" || input.situation === "PARCIAL"
        ? input.payment_date || null
        : null,
    original_amount: original,
    paid_amount: paid,
    open_amount: open,
    paid_amount_known: true,
    open_amount_known: true,
    manual_paid_amount: manualPaid,
    status: statusFor(type, input.situation, input.due_date || null, today),
  };
}

/** Lista os campos (rastreados) que mudaram entre dois registros. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): string[] {
  return TRACKED_FIELDS.filter((f) => {
    const a = before[f] ?? null;
    const b = after[f] ?? null;
    if (typeof a === "number" || typeof b === "number") return cents(Number(a)) !== cents(Number(b));
    return String(a ?? "") !== String(b ?? "");
  });
}

/** Chaves de patch protegidas na reimportação para os campos alterados. */
export function lockFieldsFor(changed: string[]): string[] {
  const out = new Set<string>();
  for (const f of changed) {
    if (["original_amount", "paid_amount", "open_amount", "status", "payment_date"].includes(f)) {
      FINANCIAL_LOCK_FIELDS.forEach((x) => out.add(x));
    } else out.add(f);
  }
  return [...out];
}

export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field.endsWith("_date")) {
    const [y, m, d] = String(value).slice(0, 10).split("-");
    return y && m && d ? `${d}/${m}/${y}` : String(value);
  }
  if (field.endsWith("_amount"))
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
      Number(value) || 0,
    );
  if (field === "status") {
    const labels: Record<string, string> = {
      RECEBIDO: "Recebido",
      PAGO: "Pago",
      EM_ABERTO: "Em aberto",
      ATRASADO: "Atrasado",
      PARCIALMENTE_RECEBIDO: "Parcialmente recebido",
      PARCIALMENTE_PAGO: "Parcialmente pago",
      CANCELADO: "Cancelado",
    };
    return labels[String(value)] ?? String(value);
  }
  return String(value);
}
