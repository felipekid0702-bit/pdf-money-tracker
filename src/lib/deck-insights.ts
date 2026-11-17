import type { Movement } from "./finance";
import { finState, money, openOf, type SeriesPoint } from "./analytics";

export interface PriorityTitle {
  document: string;
  party: string;
  dueDate: string;
  /** Positivo = dias de atraso; negativo = dias até vencer. */
  days: number;
  amount: number;
}

export interface DataIssue {
  label: string;
  count: number;
  amount: number;
  hint: string;
}

const dayDiff = (from: string, to: string) =>
  Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

function toPriority(m: Movement, today: string): PriorityTitle {
  return {
    document: m.document ?? "—",
    party: m.counterparty?.trim() || "(sem identificação)",
    dueDate: m.due_date ?? "",
    days: m.due_date ? dayDiff(m.due_date, today) : 0,
    amount: openOf(m),
  };
}

/** Maiores títulos vencidos de um lado (receber ou pagar), por saldo. */
export function topOverdue(
  all: Movement[],
  type: Movement["type"],
  today: string,
  limit = 8,
): PriorityTitle[] {
  return all
    .filter((m) => m.type === type && finState(m, today) === "VENCIDO" && openOf(m) > 0 && m.due_date)
    .map((m) => toPriority(m, today))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Maiores títulos que vencem nos próximos `windowDays` dias. */
export function topUpcoming(
  all: Movement[],
  type: Movement["type"],
  today: string,
  windowDays = 15,
  limit = 8,
): PriorityTitle[] {
  const end = addDays(today, windowDays);
  return all
    .filter(
      (m) =>
        m.type === type &&
        finState(m, today) === "EM_ABERTO" &&
        openOf(m) > 0 &&
        m.due_date &&
        m.due_date >= today &&
        m.due_date <= end,
    )
    .map((m) => toPriority(m, today))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

/** Pontos de atenção sobre a qualidade dos dados que distorcem gráficos e totais. */
export function dataIssues(all: Movement[], today: string): DataIssue[] {
  const live = all.filter((m) => finState(m, today) !== "CANCELADO");
  const horizon = addDays(today, 365);
  const issues: DataIssue[] = [];

  const far = live.filter((m) => m.due_date && m.due_date > horizon);
  if (far.length)
    issues.push({
      label: "Vencimento a mais de 12 meses",
      count: far.length,
      amount: money(far.reduce((s, m) => s + (Number(m.original_amount) || 0), 0)),
      hint: "Provável erro de digitação de data (ex.: 2027 a 2030). Corrija no título para ajustar gráficos e projeções.",
    });

  const noParty = live.filter((m) => !m.counterparty?.trim());
  if (noParty.length)
    issues.push({
      label: "Sem cliente/fornecedor identificado",
      count: noParty.length,
      amount: money(noParty.reduce((s, m) => s + (Number(m.original_amount) || 0), 0)),
      hint: "Entram como “(sem identificação)” nos rankings de concentração.",
    });

  const unknown = live.filter((m) => m.open_amount_known === false);
  if (unknown.length)
    issues.push({
      label: "Parciais sem saldo informado",
      count: unknown.length,
      amount: money(unknown.reduce((s, m) => s + (Number(m.original_amount) || 0), 0)),
      hint: "Valor em aberto desconhecido; não entra nos totais em aberto.",
    });

  const noPaymentDate = live.filter(
    (m) => finState(m, today) === "REALIZADO" && !m.payment_date,
  );
  if (noPaymentDate.length)
    issues.push({
      label: "Quitados sem data de recebimento/pagamento",
      count: noPaymentDate.length,
      amount: money(noPaymentDate.reduce((s, m) => s + (Number(m.original_amount) || 0), 0)),
      hint: "Impede medir prazo médio de recebimento e a eficácia da cobrança.",
    });

  return issues;
}

/** Janela de meses relevante (5 meses atrás até 3 à frente); ignora datas absurdas. */
export function trendWindow(series: SeriesPoint[], today: string): SeriesPoint[] {
  const from = addDays(today, -150).slice(0, 7);
  const to = addDays(today, 100).slice(0, 7);
  const inside = series.filter((p) => p.key >= from && p.key <= to);
  return inside.length >= 2 ? inside : series.slice(-6);
}
