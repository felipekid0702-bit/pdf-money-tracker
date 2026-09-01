import type { Movement, MovementType } from "./finance";
import { todayISO } from "./finance";
import { fromISO, resolvePeriod, toISO, type PeriodRange } from "./period";

/* ============================================================
 * MOTOR CENTRAL DE STATUS + AGREGAÇÃO
 * Toda regra de cálculo financeiro vive aqui. Nenhuma tela
 * recalcula KPI por conta própria.
 * ============================================================ */

/** Estado normalizado, independente do rótulo original do Bling. */
export type FinState = "REALIZADO" | "EM_ABERTO" | "VENCIDO";

export const money = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const sum = (arr: number[]) => money(arr.reduce((a, b) => a + b, 0));

/** open_amount efetivo — nunca negativo. */
export function openOf(m: Movement): number {
  const o = Number(m.open_amount);
  if (isFinite(o) && o !== 0) return money(Math.max(0, o));
  return money(Math.max(0, (Number(m.original_amount) || 0) - (Number(m.paid_amount) || 0)));
}

export function paidOf(m: Movement): number {
  return money(Math.max(0, Number(m.paid_amount) || 0));
}

export function originalOf(m: Movement): number {
  return money(Number(m.original_amount) || 0);
}

/**
 * Status financeiro normalizado.
 * Prioriza a situação vinda do Bling; usa saldo/datas apenas como apoio.
 */
export function finState(m: Movement, today = todayISO()): FinState {
  const s = (m.status ?? "").toUpperCase();
  if (s === "RECEBIDO" || s === "PAGO") return "REALIZADO";
  if (openOf(m) <= 0 && (paidOf(m) > 0 || s === "RECEBIDO" || s === "PAGO"))
    return "REALIZADO";
  if (s === "ATRASADO" || s === "VENCIDO") return "VENCIDO";
  if (m.due_date && m.due_date < today) return "VENCIDO";
  return "EM_ABERTO";
}

/** Rótulo final exibido nas telas. */
export function finStatusLabel(m: Movement, today = todayISO()): string {
  const st = finState(m, today);
  if (st === "REALIZADO") return m.type === "RECEITA" ? "Recebido" : "Pago";
  if (st === "VENCIDO") return paidOf(m) > 0 ? "Vencido (parcial)" : "Vencido";
  return paidOf(m) > 0 ? "Em aberto (parcial)" : "Em aberto";
}

export const FIN_STATE_OPTIONS: { id: FinState; label: string }[] = [
  { id: "REALIZADO", label: "Recebido / Pago" },
  { id: "EM_ABERTO", label: "Em aberto" },
  { id: "VENCIDO", label: "Vencido" },
];

/* ---------------- KPIs por tipo ---------------- */

export interface SideKpis {
  count: number;
  original: number;
  /** valor efetivamente recebido/pago (realizado) */
  settled: number;
  settledCount: number;
  /** saldo em aberto com vencimento hoje ou futuro */
  open: number;
  openCount: number;
  /** saldo em aberto vencido */
  overdue: number;
  overdueCount: number;
  avgTicket: number;
  maxSettled: number;
  maxOpen: number;
}

export function sideKpis(rows: Movement[], today = todayISO()): SideKpis {
  let original = 0,
    settled = 0,
    open = 0,
    overdue = 0;
  let settledCount = 0,
    openCount = 0,
    overdueCount = 0;
  let maxSettled = 0,
    maxOpen = 0;

  for (const m of rows) {
    const st = finState(m, today);
    const o = openOf(m);
    const p = paidOf(m);
    original += originalOf(m);
    settled += p;
    if (p > 0) {
      if (p > maxSettled) maxSettled = p;
      if (st === "REALIZADO") settledCount += 1;
    }
    if (st === "REALIZADO") {
      if (p === 0) settledCount += 0;
    } else if (st === "VENCIDO") {
      overdue += o;
      overdueCount += 1;
      if (o > maxOpen) maxOpen = o;
    } else {
      open += o;
      openCount += 1;
      if (o > maxOpen) maxOpen = o;
    }
  }
  const realizedCount = rows.filter((m) => finState(m, today) === "REALIZADO").length;
  return {
    count: rows.length,
    original: money(original),
    settled: money(settled),
    settledCount: realizedCount || settledCount,
    open: money(open),
    openCount,
    overdue: money(overdue),
    overdueCount,
    avgTicket: rows.length ? money(original / rows.length) : 0,
    maxSettled: money(maxSettled),
    maxOpen: money(maxOpen),
  };
}

export interface PeriodKpis {
  receita: SideKpis;
  despesa: SideKpis;
  /** recebido − pago */
  netRealized: number;
  /** a receber − a pagar */
  netOpen: number;
  /** vencido a receber − vencido a pagar */
  netOverdue: number;
}

export function periodKpis(rows: Movement[], today = todayISO()): PeriodKpis {
  const receita = sideKpis(rows.filter((m) => m.type === "RECEITA"), today);
  const despesa = sideKpis(rows.filter((m) => m.type === "DESPESA"), today);
  return {
    receita,
    despesa,
    netRealized: money(receita.settled - despesa.settled),
    netOpen: money(receita.open - despesa.open),
    netOverdue: money(receita.overdue - despesa.overdue),
  };
}

/* ---------------- Projeções ---------------- */

export interface ProjectionRow {
  label: string;
  from: string;
  to: string;
  inflow: number;
  outflow: number;
  net: number;
  count: number;
}

const PROJ_WINDOWS = [
  { id: "next7", label: "Próximos 7 dias" },
  { id: "next15", label: "Próximos 15 dias" },
  { id: "next30", label: "Próximos 30 dias" },
  { id: "next60", label: "Próximos 60 dias" },
  { id: "next90", label: "Próximos 90 dias" },
] as const;

/** Somente títulos em aberto (não realizados) com vencimento dentro da janela. */
export function projectionForRange(
  all: Movement[],
  range: PeriodRange,
  label: string,
  today = todayISO(),
): ProjectionRow {
  let inflow = 0,
    outflow = 0,
    count = 0;
  for (const m of all) {
    if (finState(m, today) === "REALIZADO") continue;
    const d = m.due_date;
    if (!d) continue;
    if (range.from && d < range.from) continue;
    if (range.to && d > range.to) continue;
    const o = openOf(m);
    if (o <= 0) continue;
    if (m.type === "RECEITA") inflow += o;
    else outflow += o;
    count += 1;
  }
  return {
    label,
    from: range.from ?? "",
    to: range.to ?? "",
    inflow: money(inflow),
    outflow: money(outflow),
    net: money(inflow - outflow),
    count,
  };
}

export function projections(all: Movement[], today = todayISO()): ProjectionRow[] {
  return PROJ_WINDOWS.map((w) =>
    projectionForRange(all, resolvePeriod(w.id), w.label, today),
  );
}

export function namedProjections(
  all: Movement[],
  ids: { id: Parameters<typeof resolvePeriod>[0]; label: string }[],
  today = todayISO(),
): ProjectionRow[] {
  return ids.map((w) => projectionForRange(all, resolvePeriod(w.id), w.label, today));
}

/* ---------------- Vencimentos imediatos ---------------- */

export function dueWindows(all: Movement[], today = todayISO()) {
  const mk = (id: Parameters<typeof resolvePeriod>[0], label: string) =>
    projectionForRange(all, resolvePeriod(id), label, today);
  return [
    mk("today", "Vence hoje"),
    mk("tomorrow", "Vence amanhã"),
    mk("next7", "Próximos 7 dias"),
    mk("next15", "Próximos 15 dias"),
    mk("next30", "Próximos 30 dias"),
  ];
}

/* ---------------- Aging ---------------- */

export interface AgingBucket {
  label: string;
  amount: number;
  count: number;
}

const FUTURE_BUCKETS: [string, number, number][] = [
  ["Vence hoje", 0, 0],
  ["1 a 7 dias", 1, 7],
  ["8 a 15 dias", 8, 15],
  ["16 a 30 dias", 16, 30],
  ["31 a 60 dias", 31, 60],
  ["61 a 90 dias", 61, 90],
  ["Acima de 90 dias", 91, Infinity],
];

const PAST_BUCKETS: [string, number, number][] = [
  ["1 a 7 dias", 1, 7],
  ["8 a 15 dias", 8, 15],
  ["16 a 30 dias", 16, 30],
  ["31 a 60 dias", 31, 60],
  ["61 a 90 dias", 61, 90],
  ["Acima de 90 dias", 91, Infinity],
];

function daysBetween(aISO: string, bISO: string): number {
  return Math.round((fromISO(bISO).getTime() - fromISO(aISO).getTime()) / 86_400_000);
}

export function aging(
  all: Movement[],
  type: MovementType,
  direction: "future" | "past",
  today = todayISO(),
): AgingBucket[] {
  const defs = direction === "future" ? FUTURE_BUCKETS : PAST_BUCKETS;
  const out: AgingBucket[] = defs.map(([label]) => ({ label, amount: 0, count: 0 }));
  for (const m of all) {
    if (m.type !== type) continue;
    if (finState(m, today) === "REALIZADO") continue;
    const o = openOf(m);
    if (o <= 0 || !m.due_date) continue;
    const diff = daysBetween(today, m.due_date);
    const delta = direction === "future" ? diff : -diff;
    if (direction === "future" ? diff < 0 : diff >= 0) continue;
    const idx = defs.findIndex(([, a, b]) => delta >= a && delta <= b);
    if (idx < 0) continue;
    out[idx]!.amount = money(out[idx]!.amount + o);
    out[idx]!.count += 1;
  }
  return out;
}

/* ---------------- Concentração ---------------- */

export interface PartyRow {
  name: string;
  total: number;
  settled: number;
  open: number;
  overdue: number;
  count: number;
  share: number;
}

export function rankParties(
  rows: Movement[],
  type: MovementType,
  today = todayISO(),
): PartyRow[] {
  const map = new Map<string, PartyRow>();
  let grand = 0;
  for (const m of rows) {
    if (m.type !== type) continue;
    const name = m.counterparty?.trim() || "(sem identificação)";
    const cur =
      map.get(name) ??
      { name, total: 0, settled: 0, open: 0, overdue: 0, count: 0, share: 0 };
    const st = finState(m, today);
    cur.total = money(cur.total + originalOf(m));
    cur.settled = money(cur.settled + paidOf(m));
    if (st === "VENCIDO") cur.overdue = money(cur.overdue + openOf(m));
    else if (st === "EM_ABERTO") cur.open = money(cur.open + openOf(m));
    cur.count += 1;
    grand += originalOf(m);
    map.set(name, cur);
  }
  const list = Array.from(map.values()).sort((a, b) => b.total - a.total);
  for (const r of list) r.share = grand > 0 ? r.total / grand : 0;
  return list;
}

export function topShare(list: PartyRow[], n: number): number {
  const total = sum(list.map((r) => r.total));
  if (total <= 0) return 0;
  return sum(list.slice(0, n).map((r) => r.total)) / total;
}

export function maxBy(list: PartyRow[], key: "open" | "overdue"): PartyRow | null {
  let best: PartyRow | null = null;
  for (const r of list) if (r[key] > 0 && (!best || r[key] > best[key])) best = r;
  return best;
}

/* ---------------- Séries temporais ---------------- */

export type Granularity = "day" | "week" | "month";

export function granularityFor(range: PeriodRange, rows: Movement[]): Granularity {
  let from = range.from;
  let to = range.to;
  if (!from || !to) {
    const dates = rows.map((m) => m.due_date).filter(Boolean) as string[];
    if (!dates.length) return "month";
    from = dates.reduce((a, b) => (a < b ? a : b));
    to = dates.reduce((a, b) => (a > b ? a : b));
  }
  const span = daysBetween(from, to);
  if (span <= 31) return "day";
  if (span <= 120) return "week";
  return "month";
}

function bucketKey(dateISO: string, g: Granularity): string {
  if (g === "month") return dateISO.slice(0, 7);
  if (g === "day") return dateISO;
  const d = fromISO(dateISO);
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return toISO(d);
}

export interface SeriesPoint {
  key: string;
  label: string;
  recebido: number;
  pago: number;
  aReceber: number;
  aPagar: number;
  liquido: number;
}

const MONTHS_ABBR = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

function bucketLabel(key: string, g: Granularity): string {
  if (g === "month") {
    const [y, m] = key.split("-");
    return `${MONTHS_ABBR[Number(m) - 1] ?? m}/${(y ?? "").slice(2)}`;
  }
  const [, m, d] = key.split("-");
  return g === "week" ? `${d}/${m}` : `${d}/${m}`;
}

export function timeSeries(
  rows: Movement[],
  g: Granularity,
  today = todayISO(),
): SeriesPoint[] {
  const map = new Map<string, SeriesPoint>();
  for (const m of rows) {
    if (!m.due_date) continue;
    const key = bucketKey(m.due_date, g);
    const cur =
      map.get(key) ??
      { key, label: bucketLabel(key, g), recebido: 0, pago: 0, aReceber: 0, aPagar: 0, liquido: 0 };
    const st = finState(m, today);
    if (m.type === "RECEITA") {
      cur.recebido = money(cur.recebido + paidOf(m));
      if (st !== "REALIZADO") cur.aReceber = money(cur.aReceber + openOf(m));
    } else {
      cur.pago = money(cur.pago + paidOf(m));
      if (st !== "REALIZADO") cur.aPagar = money(cur.aPagar + openOf(m));
    }
    map.set(key, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => ({
      ...p,
      liquido: money(p.recebido + p.aReceber - p.pago - p.aPagar),
    }));
}

/* ---------------- Distribuição por status ---------------- */

export function statusDistribution(rows: Movement[], today = todayISO()) {
  let recebido = 0,
    pago = 0,
    aberto = 0,
    vencido = 0;
  for (const m of rows) {
    const st = finState(m, today);
    if (st === "REALIZADO") {
      if (m.type === "RECEITA") recebido = money(recebido + paidOf(m));
      else pago = money(pago + paidOf(m));
    } else if (st === "VENCIDO") vencido = money(vencido + openOf(m));
    else aberto = money(aberto + openOf(m));
  }
  return [
    { name: "Recebido", value: recebido, fill: "var(--color-chart-1)" },
    { name: "Pago", value: pago, fill: "var(--color-chart-3)" },
    { name: "Em aberto", value: aberto, fill: "var(--color-chart-4)" },
    { name: "Vencido", value: vencido, fill: "var(--color-chart-2)" },
  ].filter((d) => d.value > 0);
}

/* ---------------- Resumo diário (calendário) ---------------- */

export interface DaySummary {
  date: string;
  toReceive: number;
  toPay: number;
  received: number;
  paid: number;
  overdueReceive: number;
  overduePay: number;
  count: number;
  items: Movement[];
}

export function summarizeByDay(
  all: Movement[],
  today = todayISO(),
): Map<string, DaySummary> {
  const map = new Map<string, DaySummary>();
  for (const m of all) {
    const key = (m.due_date ?? "").slice(0, 10);
    if (!key) continue;
    const cur =
      map.get(key) ??
      {
        date: key,
        toReceive: 0,
        toPay: 0,
        received: 0,
        paid: 0,
        overdueReceive: 0,
        overduePay: 0,
        count: 0,
        items: [] as Movement[],
      };
    const st = finState(m, today);
    if (st === "REALIZADO") {
      if (m.type === "RECEITA") cur.received = money(cur.received + paidOf(m));
      else cur.paid = money(cur.paid + paidOf(m));
    } else if (st === "VENCIDO") {
      if (m.type === "RECEITA") cur.overdueReceive = money(cur.overdueReceive + openOf(m));
      else cur.overduePay = money(cur.overduePay + openOf(m));
    } else if (m.type === "RECEITA") cur.toReceive = money(cur.toReceive + openOf(m));
    else cur.toPay = money(cur.toPay + openOf(m));
    cur.count += 1;
    cur.items.push(m);
    map.set(key, cur);
  }
  return map;
}

/* ---------------- Pressão financeira ---------------- */

export function financialPressure(all: Movement[], today = todayISO(), limit = 10) {
  const map = new Map<string, { date: string; pay: number; receive: number; count: number }>();
  for (const m of all) {
    if (finState(m, today) === "REALIZADO") continue;
    const d = m.due_date;
    if (!d || d < today) continue;
    const o = openOf(m);
    if (o <= 0) continue;
    const cur = map.get(d) ?? { date: d, pay: 0, receive: 0, count: 0 };
    if (m.type === "DESPESA") cur.pay = money(cur.pay + o);
    else cur.receive = money(cur.receive + o);
    cur.count += 1;
    map.set(d, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => b.pay - b.receive - (a.pay - a.receive))
    .slice(0, limit);
}
