import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Movement } from "./finance";

/* ============================================================
 * MOTOR CENTRAL DE PERÍODOS
 * Único responsável por transformar um PeriodId em { from, to }.
 * Todas as telas (Dashboard, Receber, Pagar, Calendário, Análises)
 * consomem exclusivamente este módulo.
 * ============================================================ */

export type PeriodId =
  // históricos (calendário real)
  | "today"
  | "yesterday"
  | "week"
  | "last_week"
  | "month"
  | "last_month"
  | "quarter"
  | "semester"
  | "year"
  | "all"
  | "custom"
  // projeção
  | "tomorrow"
  | "next7"
  | "next15"
  | "next30"
  | "next60"
  | "next90"
  | "next120"
  | "next6m"
  | "next12m"
  | "next_week"
  | "next_month"
  | "next_quarter"
  | "next_semester"
  | "next_year"
  | "custom_forecast";


export interface PeriodRange {
  from: string | null;
  to: string | null;
}

export const HISTORY_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "yesterday", label: "Ontem" },
  { id: "week", label: "Semana atual" },
  { id: "last_week", label: "Semana anterior" },
  { id: "month", label: "Mês atual" },
  { id: "last_month", label: "Mês anterior" },
  { id: "quarter", label: "Trimestre atual" },
  { id: "semester", label: "Semestre atual" },
  { id: "year", label: "Ano atual" },
  { id: "all", label: "Todo o período" },
  { id: "custom", label: "Personalizado (histórico)" },
];

export const FORECAST_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "tomorrow", label: "Amanhã" },
  { id: "next7", label: "Próximos 7 dias" },
  { id: "next15", label: "Próximos 15 dias" },
  { id: "next30", label: "Próximos 30 dias" },
  { id: "next60", label: "Próximos 60 dias" },
  { id: "next90", label: "Próximos 90 dias" },
  { id: "next120", label: "Próximos 120 dias" },
  { id: "next6m", label: "Próximos 6 meses" },
  { id: "next12m", label: "Próximos 12 meses" },

  { id: "next_week", label: "Próxima semana" },
  { id: "next_month", label: "Próximo mês" },
  { id: "next_quarter", label: "Próximo trimestre" },
  { id: "next_semester", label: "Próximo semestre" },
  { id: "next_year", label: "Próximo ano" },
  { id: "custom_forecast", label: "Personalizado (futuro)" },
];

const FORECAST_IDS = new Set<PeriodId>(FORECAST_OPTIONS.map((o) => o.id));
export const isForecastPeriod = (p: PeriodId) => FORECAST_IDS.has(p);

export const PERIOD_LABEL: Record<string, string> = Object.fromEntries(
  [...HISTORY_OPTIONS, ...FORECAST_OPTIONS].map((o) => [o.id, o.label]),
);

/* ---------------- utilitários de data (locais, sem UTC) ---------------- */

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function fromISO(v: string): Date {
  const [y, m, d] = v.slice(0, 10).split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Segunda-feira da semana que contém `d`. */
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  const dow = x.getDay(); // 0=dom
  const diff = dow === 0 ? -6 : 1 - dow;
  x.setDate(x.getDate() + diff);
  return x;
}

const startOfMonth = (y: number, m: number) => new Date(y, m, 1);
const endOfMonth = (y: number, m: number) => new Date(y, m + 1, 0);

/** Motor único: resolve qualquer PeriodId numa faixa de datas inclusiva. */
export function resolvePeriod(
  period: PeriodId,
  customFrom = "",
  customTo = "",
  now: Date = new Date(),
): PeriodRange {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3); // 0..3
  const s = m < 6 ? 0 : 1;

  const range = (a: Date, b: Date): PeriodRange => ({ from: toISO(a), to: toISO(b) });

  switch (period) {
    case "today":
      return range(today, today);
    case "yesterday": {
      const d = addDays(today, -1);
      return range(d, d);
    }
    case "week": {
      const a = startOfWeek(today);
      return range(a, addDays(a, 6));
    }
    case "last_week": {
      const a = addDays(startOfWeek(today), -7);
      return range(a, addDays(a, 6));
    }
    case "month":
      return range(startOfMonth(y, m), endOfMonth(y, m));
    case "last_month": {
      const d = new Date(y, m - 1, 1);
      return range(
        startOfMonth(d.getFullYear(), d.getMonth()),
        endOfMonth(d.getFullYear(), d.getMonth()),
      );
    }
    case "quarter":
      return range(startOfMonth(y, q * 3), endOfMonth(y, q * 3 + 2));
    case "semester":
      return range(startOfMonth(y, s * 6), endOfMonth(y, s * 6 + 5));
    case "year":
      return range(new Date(y, 0, 1), new Date(y, 11, 31));
    case "all":
      return { from: null, to: null };
    case "custom":
    case "custom_forecast":
      return { from: customFrom || null, to: customTo || null };

    /* -------- projeção: sempre a partir de amanhã -------- */
    case "tomorrow": {
      const d = addDays(today, 1);
      return range(d, d);
    }
    case "next7":
      return range(addDays(today, 1), addDays(today, 7));
    case "next15":
      return range(addDays(today, 1), addDays(today, 15));
    case "next30":
      return range(addDays(today, 1), addDays(today, 30));
    case "next60":
      return range(addDays(today, 1), addDays(today, 60));
    case "next90":
      return range(addDays(today, 1), addDays(today, 90));
    case "next120":
      return range(addDays(today, 1), addDays(today, 120));
    case "next6m": {
      const a = addDays(today, 1);
      const b = new Date(y, m + 6, today.getDate());
      return range(a, b);
    }
    case "next12m": {
      const a = addDays(today, 1);
      const b = new Date(y + 1, m, today.getDate());
      return range(a, b);
    }

    case "next_week": {
      const a = addDays(startOfWeek(today), 7);
      return range(a, addDays(a, 6));
    }
    case "next_month": {
      const d = new Date(y, m + 1, 1);
      return range(
        startOfMonth(d.getFullYear(), d.getMonth()),
        endOfMonth(d.getFullYear(), d.getMonth()),
      );
    }
    case "next_quarter": {
      const startM = (q + 1) * 3;
      const d = new Date(y, startM, 1);
      return range(
        startOfMonth(d.getFullYear(), d.getMonth()),
        endOfMonth(d.getFullYear(), d.getMonth() + 2),
      );
    }
    case "next_semester": {
      const d = new Date(y, (s + 1) * 6, 1);
      return range(
        startOfMonth(d.getFullYear(), d.getMonth()),
        endOfMonth(d.getFullYear(), d.getMonth() + 5),
      );
    }
    case "next_year":
      return range(new Date(y + 1, 0, 1), new Date(y + 1, 11, 31));
    default:
      return { from: null, to: null };
  }
}

/** Filtra movimentos pela data de vencimento dentro da faixa. */
export function filterByRange(rows: Movement[], range: PeriodRange): Movement[] {
  if (!range.from && !range.to) return rows;
  return rows.filter((r) => {
    const d = r.due_date;
    if (!d) return false;
    if (range.from && d < range.from) return false;
    if (range.to && d > range.to) return false;
    return true;
  });
}

/* ---------------- contexto global ---------------- */

interface PeriodCtx {
  period: PeriodId;
  setPeriod: (p: PeriodId) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  range: PeriodRange;
  label: string;
  isForecast: boolean;
  filter: (rows: Movement[]) => Movement[];
}

const Ctx = createContext<PeriodCtx | null>(null);

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<PeriodId>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(
    () => resolvePeriod(period, customFrom, customTo),
    [period, customFrom, customTo],
  );

  const value = useMemo<PeriodCtx>(
    () => ({
      period,
      setPeriod,
      customFrom,
      customTo,
      setCustomFrom,
      setCustomTo,
      range,
      label: PERIOD_LABEL[period] ?? "",
      isForecast: isForecastPeriod(period),
      filter: (rows: Movement[]) => filterByRange(rows, range),
    }),
    [period, customFrom, customTo, range],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePeriod(): PeriodCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePeriod must be used inside PeriodProvider");
  return ctx;
}
