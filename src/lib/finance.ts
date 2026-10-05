export type MovementType = "RECEITA" | "DESPESA";

export interface ReceivableEmailEvent {
  id: string;
  sent_at: string;
  action_type: "cobranca_vencido" | "aviso_vencimento" | "boleto_enviado";
  recipient_email: string | null;
  subject: string | null;
  title_count: number;
  title_documents: string[];
  title_details: unknown;
  reminder_days: number | null;
  aging_ranges: string[];
}

export interface Movement {
  id: string;
  type: MovementType;
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
  status: string;
  source: string;
  source_file: string | null;
  created_at?: string;
}

export const RECEITA_STATUS = [
  "RECEBIDO",
  "EM_ABERTO",
  "ATRASADO",
  "PARCIALMENTE_RECEBIDO",
] as const;

export const DESPESA_STATUS = ["PAGO", "EM_ABERTO", "ATRASADO", "PARCIALMENTE_PAGO"] as const;

export const STATUS_LABEL: Record<string, string> = {
  RECEBIDO: "Recebido",
  PAGO: "Pago",
  EM_ABERTO: "Em aberto",
  ATRASADO: "Atrasado",
  PARCIALMENTE_RECEBIDO: "Parcial",
  PARCIALMENTE_PAGO: "Parcial",
};

export const isSettled = (s: string) => s === "RECEBIDO" || s === "PAGO";
export const isPartial = (s: string) => s === "PARCIALMENTE_RECEBIDO" || s === "PARCIALMENTE_PAGO";

export function formatBRL(v: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(v || 0);
}

export function formatDate(v: string | null | undefined): string {
  if (!v) return "";
  const [y, m, d] = v.slice(0, 10).split("-");
  if (!y || !m || !d) return "";
  return `${d}/${m}/${y}`;
}

export function formatPercent(v: number): string {
  if (!isFinite(v)) return "—";
  return `${(v * 100).toFixed(1).replace(".", ",")}%`;
}

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function monthKey(v: string | null): string | null {
  if (!v) return null;
  return v.slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = [
    "jan",
    "fev",
    "mar",
    "abr",
    "mai",
    "jun",
    "jul",
    "ago",
    "set",
    "out",
    "nov",
    "dez",
  ];
  return `${names[Number(m) - 1] ?? m}/${(y ?? "").slice(2)}`;
}

export interface Totals {
  count: number;
  total: number;
  settled: number;
  open: number;
  overdue: number;
}

export function totalize(rows: Movement[]): Totals {
  const today = todayISO();
  let total = 0,
    settled = 0,
    open = 0,
    overdue = 0;
  for (const r of rows) {
    total += Number(r.original_amount) || 0;
    settled += Number(r.paid_amount) || 0;
    const o = Number(r.open_amount) || 0;
    open += o;
    if (o > 0 && r.due_date && r.due_date < today) overdue += o;
  }
  return { count: rows.length, total, settled, open, overdue };
}
