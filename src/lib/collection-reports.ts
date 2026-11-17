import type { ReceivableEmailHistory } from "./receivable-email-events-data";
import type { Movement, ReceivableEmailEvent } from "./finance";
import { finState, openOf, originalOf, paidOf, money } from "./analytics";

export type ActionType = ReceivableEmailEvent["action_type"];

export const ACTION_LABEL: Record<ActionType, string> = {
  aviso_vencimento: "Aviso de vencimento",
  cobranca_vencido: "Cobrança de vencido",
  boleto_enviado: "Boleto enviado",
};

/** Uma linha por título enviado em cada ação de cobrança. */
export interface CollectionRow {
  key: string;
  eventId: string;
  sentAt: string;
  sentDate: string;
  action: ActionType;
  recipient: string | null;
  client: string;
  cnpj: string | null;
  document: string | null;
  amount: number | null;
  dueDate: string | null;
  daysOverdue: number | null;
  movementId: string | null;
}

export interface TitleReportRow {
  key: string;
  movementId: string | null;
  document: string;
  client: string;
  amount: number;
  dueDate: string | null;
  actions: number;
  warnings: number;
  collections: number;
  boletos: number;
  firstAction: string;
  lastAction: string;
  state: string;
  paymentDate: string | null;
  open: number;
  /** Dias entre a última ação e o recebimento (apenas quando recebido depois da ação). */
  daysToPay: number | null;
}

export interface ClientReportRow {
  client: string;
  titles: number;
  actions: number;
  billed: number;
  open: number;
  recovered: number;
  recoveryRate: number;
  avgDaysToPay: number | null;
}

export interface PeriodReportRow {
  period: string;
  label: string;
  avisos: number;
  cobrancas: number;
  boletos: number;
  titles: number;
  amount: number;
}

const norm = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, ""));
const digits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

function localDate(timestamp: string): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

interface RawDetail {
  client: string | null;
  cnpj: string | null;
  document: string | null;
  amount: number | null;
  due_date: string | null;
  days_overdue: number | null;
}

function parseDetails(value: unknown): RawDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const d = item as Record<string, unknown>;
    const str = (k: string) => (typeof d[k] === "string" ? (d[k] as string) : null);
    const n = (k: string) => (typeof d[k] === "number" && Number.isFinite(d[k]) ? (d[k] as number) : null);
    return [
      {
        client: str("client"),
        cnpj: str("cnpj"),
        document: str("document"),
        amount: n("amount"),
        due_date: str("due_date"),
        days_overdue: n("days_overdue"),
      },
    ];
  });
}

export function buildCollectionRows(history: ReceivableEmailHistory | undefined): CollectionRow[] {
  if (!history) return [];
  const byDoc = new Map<string, ReceivableEmailHistory["movements"]>();
  const byCnpj = new Map<string, ReceivableEmailHistory["movements"]>();
  for (const m of history.movements) {
    const dk = norm(m.document);
    if (dk) byDoc.set(dk, [...(byDoc.get(dk) ?? []), m]);
    const ck = digits(m.counterparty_document);
    if (ck) byCnpj.set(ck, [...(byCnpj.get(ck) ?? []), m]);
  }
  const rows: CollectionRow[] = [];
  for (const event of history.events) {
    const details = parseDetails(event.title_details);
    const titles: RawDetail[] = details.length
      ? details
      : event.title_documents.map((document) => ({
          client: null, cnpj: null, document, amount: null, due_date: null, days_overdue: null,
        }));
    titles.forEach((t, index) => {
      const docMatches = t.document ? (byDoc.get(norm(t.document)) ?? []) : [];
      const cnpjMatches = docMatches.filter(
        (m) => !t.cnpj || !digits(m.counterparty_document) || digits(m.counterparty_document) === digits(t.cnpj),
      );
      const match = cnpjMatches.length === 1 ? cnpjMatches[0] : docMatches.length === 1 ? docMatches[0] : undefined;
      const sentDate = localDate(event.sent_at);
      const dueDate = t.due_date ?? match?.due_date ?? null;
      rows.push({
        key: `${event.id}-${index}`,
        eventId: event.id,
        sentAt: event.sent_at,
        sentDate,
        action: event.action_type,
        recipient: event.recipient_email,
        client:
          match?.counterparty ??
          (t.client && digits(t.client) !== digits(t.cnpj) ? t.client : null) ??
          "(sem identificação)",
        cnpj: t.cnpj ?? match?.counterparty_document ?? null,
        document: t.document ?? match?.document ?? null,
        amount: t.amount ?? (match ? Number(match.original_amount) || 0 : null),
        dueDate,
        daysOverdue:
          t.days_overdue ??
          (event.action_type === "cobranca_vencido" && dueDate
            ? Math.max(0, daysBetween(dueDate, sentDate))
            : null),
        movementId: match?.id ?? null,
      });
    });
  }
  return rows;
}

export function filterByDate(rows: CollectionRow[], from: string | null, to: string | null) {
  return rows.filter((r) => (!from || r.sentDate >= from) && (!to || r.sentDate <= to));
}

export function titleReport(
  rows: CollectionRow[],
  movements: Movement[],
  today: string,
): TitleReportRow[] {
  const byId = new Map(movements.map((m) => [m.id, m]));
  const groups = new Map<string, CollectionRow[]>();
  for (const r of rows) {
    const key = r.movementId ?? `${norm(r.document)}|${digits(r.cnpj) || norm(r.client)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: TitleReportRow[] = [];
  for (const [key, list] of groups) {
    list.sort((a, b) => a.sentAt.localeCompare(b.sentAt));
    const first = list[0]!;
    const last = list[list.length - 1]!;
    const m = first.movementId ? byId.get(first.movementId) : undefined;
    const state = m ? finState(m, today) : null;
    const paymentDate = m?.payment_date ?? null;
    out.push({
      key,
      movementId: first.movementId,
      document: first.document ?? "—",
      client: first.client,
      amount: m ? originalOf(m) : (first.amount ?? 0),
      dueDate: m?.due_date ?? first.dueDate,
      actions: list.length,
      warnings: list.filter((r) => r.action === "aviso_vencimento").length,
      collections: list.filter((r) => r.action === "cobranca_vencido").length,
      boletos: list.filter((r) => r.action === "boleto_enviado").length,
      firstAction: first.sentDate,
      lastAction: last.sentDate,
      state: !m
        ? "Não localizado"
        : state === "REALIZADO"
          ? "Recebido"
          : state === "VENCIDO"
            ? "Vencido"
            : state === "CANCELADO"
              ? "Cancelado"
              : "Em aberto",
      paymentDate,
      open: m ? openOf(m) : 0,
      daysToPay:
        state === "REALIZADO" && paymentDate && paymentDate >= last.sentDate
          ? daysBetween(last.sentDate, paymentDate)
          : null,
    });
  }
  return out.sort((a, b) => b.lastAction.localeCompare(a.lastAction));
}

export function clientReport(titles: TitleReportRow[], movements: Movement[]): ClientReportRow[] {
  const byId = new Map(movements.map((m) => [m.id, m]));
  const map = new Map<string, ClientReportRow & { days: number[] }>();
  for (const t of titles) {
    const cur =
      map.get(t.client) ??
      { client: t.client, titles: 0, actions: 0, billed: 0, open: 0, recovered: 0, recoveryRate: 0, avgDaysToPay: null, days: [] };
    cur.titles += 1;
    cur.actions += t.actions;
    cur.billed = money(cur.billed + t.amount);
    cur.open = money(cur.open + t.open);
    const m = t.movementId ? byId.get(t.movementId) : undefined;
    if (t.state === "Recebido") cur.recovered = money(cur.recovered + (m ? paidOf(m) : t.amount));
    if (t.daysToPay !== null) cur.days.push(t.daysToPay);
    map.set(t.client, cur);
  }
  return [...map.values()]
    .map(({ days, ...r }) => ({
      ...r,
      recoveryRate: r.billed > 0 ? r.recovered / r.billed : 0,
      avgDaysToPay: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    }))
    .sort((a, b) => b.open - a.open || b.billed - a.billed);
}

export function periodReport(rows: CollectionRow[], granularity: "month" | "week"): PeriodReportRow[] {
  const keyOf = (date: string) => {
    if (granularity === "month") return date.slice(0, 7);
    const d = new Date(`${date}T00:00:00`);
    const dow = d.getDay();
    d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const map = new Map<string, PeriodReportRow & { docs: Set<string> }>();
  for (const r of rows) {
    const key = keyOf(r.sentDate);
    const [y, m, d] = (granularity === "month" ? `${key}-01` : key).split("-");
    const cur =
      map.get(key) ??
      {
        period: key,
        label: granularity === "month" ? `${m}/${y}` : `semana de ${d}/${m}`,
        avisos: 0, cobrancas: 0, boletos: 0, titles: 0, amount: 0, docs: new Set<string>(),
      };
    if (r.action === "aviso_vencimento") cur.avisos += 1;
    else if (r.action === "cobranca_vencido") cur.cobrancas += 1;
    else cur.boletos += 1;
    const doc = r.movementId ?? `${r.document}|${r.client}`;
    if (!cur.docs.has(doc)) {
      cur.docs.add(doc);
      cur.titles += 1;
      cur.amount = money(cur.amount + (r.amount ?? 0));
    }
    map.set(key, cur);
  }
  return [...map.values()]
    .map(({ docs: _docs, ...r }) => r)
    .sort((a, b) => b.period.localeCompare(a.period));
}

/** CSV com separador ";" e BOM, para abrir direto no Excel em português. */
export function toCsv(header: string[], lines: Array<Array<string | number | null>>): string {
  const cell = (v: string | number | null) => {
    const text = v === null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return `﻿${[header, ...lines].map((l) => l.map(cell).join(";")).join("\r\n")}`;
}

export function downloadCsv(filename: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
