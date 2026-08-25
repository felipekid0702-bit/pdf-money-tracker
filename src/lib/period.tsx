import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Movement } from "./finance";
import { todayISO } from "./finance";

export type PeriodId =
  | "today"
  | "7"
  | "15"
  | "30"
  | "60"
  | "90"
  | "180"
  | "365"
  | "all"
  | "custom";

export const PERIOD_OPTIONS: { id: PeriodId; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "7", label: "7 dias" },
  { id: "15", label: "15 dias" },
  { id: "30", label: "30 dias" },
  { id: "60", label: "60 dias" },
  { id: "90", label: "90 dias" },
  { id: "180", label: "6 meses" },
  { id: "365", label: "12 meses" },
  { id: "all", label: "Todo período" },
  { id: "custom", label: "Personalizado" },
];

interface PeriodRange {
  from: string | null;
  to: string | null;
}

interface PeriodCtx {
  period: PeriodId;
  setPeriod: (p: PeriodId) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (v: string) => void;
  setCustomTo: (v: string) => void;
  range: PeriodRange;
  filter: (rows: Movement[]) => Movement[];
}

const Ctx = createContext<PeriodCtx | null>(null);

function shiftISO(days: number, back: boolean): string {
  const d = new Date();
  d.setDate(d.getDate() + (back ? -days : days));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<PeriodId>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo<PeriodRange>(() => {
    const today = todayISO();
    switch (period) {
      case "today":
        return { from: today, to: today };
      case "all":
        return { from: null, to: null };
      case "custom":
        return { from: customFrom || null, to: customTo || null };
      default: {
        const days = Number(period);
        return { from: shiftISO(days, true), to: shiftISO(days, false) };
      }
    }
  }, [period, customFrom, customTo]);

  const value = useMemo<PeriodCtx>(
    () => ({
      period,
      setPeriod,
      customFrom,
      customTo,
      setCustomFrom,
      setCustomTo,
      range,
      filter: (rows: Movement[]) =>
        rows.filter((r) => {
          const d = r.due_date;
          if (!d) return range.from === null && range.to === null;
          if (range.from && d < range.from) return false;
          if (range.to && d > range.to) return false;
          return true;
        }),
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
