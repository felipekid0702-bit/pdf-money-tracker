import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { EmptyState } from "@/components/StatCard";
import { StatusBadge } from "@/components/MovementsPage";
import { useMovements } from "@/hooks/useMovements";
import {
  formatBRL,
  formatDate,
  todayISO,
  type Movement,
} from "@/lib/finance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário Financeiro | FP Financeiro" },
      {
        name: "description",
        content:
          "Calendário mensal com recebimentos e pagamentos por dia de vencimento da FP Solução em Altura.",
      },
      { property: "og:title", content: "Calendário Financeiro | FP Financeiro" },
      {
        property: "og:description",
        content: "Movimentações diárias de contas a receber e a pagar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalendarPage,
});

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function iso(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function CalendarPage() {
  const { data, isLoading } = useMovements();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(todayISO());

  const byDay = useMemo(() => {
    const map = new Map<string, Movement[]>();
    for (const m of data ?? []) {
      const key = (m.due_date ?? "").slice(0, 10);
      if (!key) continue;
      const arr = map.get(key);
      if (arr) arr.push(m);
      else map.set(key, [m]);
    }
    return map;
  }, [data]);

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthTotals = useMemo(() => {
    let receita = 0,
      despesa = 0;
    for (const key of cells) {
      if (!key) continue;
      for (const m of byDay.get(key) ?? []) {
        if (m.type === "RECEITA") receita += Number(m.original_amount) || 0;
        else despesa += Number(m.original_amount) || 0;
      }
    }
    return { receita, despesa };
  }, [cells, byDay]);

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const dayMovements = selected ? (byDay.get(selected) ?? []) : [];
  const today = todayISO();

  return (
    <AppLayout
      title="Calendário Financeiro"
      subtitle="Movimentações por data de vencimento"
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (data ?? []).length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
              <button
                onClick={() => shift(-1)}
                className="rounded p-1.5 hover:bg-muted"
                aria-label="Mês anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-40 text-center text-sm font-medium">
                {MONTHS[month]} {year}
              </span>
              <button
                onClick={() => shift(1)}
                className="rounded p-1.5 hover:bg-muted"
                aria-label="Próximo mês"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <button
              onClick={() => {
                const d = new Date();
                setYear(d.getFullYear());
                setMonth(d.getMonth());
                setSelected(todayISO());
              }}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm hover:bg-muted"
            >
              Hoje
            </button>
            <div className="ml-auto flex gap-4 text-sm">
              <span className="num text-success">
                A receber no mês: {formatBRL(monthTotals.receita)}
              </span>
              <span className="num text-destructive">
                A pagar no mês: {formatBRL(monthTotals.despesa)}
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-7 border-b border-border bg-muted/50">
              {WEEK.map((w) => (
                <div
                  key={w}
                  className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((key, i) => {
                if (!key)
                  return (
                    <div
                      key={`e${i}`}
                      className="min-h-24 border-b border-r border-border/60 bg-muted/20"
                    />
                  );
                const items = byDay.get(key) ?? [];
                let rec = 0,
                  desp = 0;
                for (const m of items) {
                  if (m.type === "RECEITA") rec += Number(m.original_amount) || 0;
                  else desp += Number(m.original_amount) || 0;
                }
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    className={cn(
                      "min-h-24 border-b border-r border-border/60 p-2 text-left align-top transition-colors hover:bg-muted/50",
                      selected === key && "bg-accent/60",
                    )}
                  >
                    <div
                      className={cn(
                        "num text-xs font-semibold",
                        key === today
                          ? "inline-flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {Number(key.slice(8))}
                    </div>
                    {rec > 0 && (
                      <div className="num mt-1 truncate text-[11px] font-medium text-success">
                        +{formatBRL(rec)}
                      </div>
                    )}
                    {desp > 0 && (
                      <div className="num truncate text-[11px] font-medium text-destructive">
                        −{formatBRL(desp)}
                      </div>
                    )}
                    {items.length > 0 && (
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {items.length} mov.
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3 text-sm font-semibold">
              {selected ? `Movimentações de ${formatDate(selected)}` : "Selecione um dia"}
            </div>
            {dayMovements.length === 0 ? (
              <p className="px-4 py-6 text-sm text-muted-foreground">
                Nenhuma movimentação com vencimento nesta data.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Tipo</th>
                      <th className="px-3 py-2 text-left">Documento</th>
                      <th className="px-3 py-2 text-left">Cliente / Fornecedor</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2 text-right">Liquidado</th>
                      <th className="px-3 py-2 text-right">Saldo</th>
                      <th className="px-3 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayMovements.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-border/60 last:border-0 hover:bg-muted/40"
                      >
                        <td className="px-3 py-2">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-[11px] font-medium",
                              m.type === "RECEITA"
                                ? "bg-success/12 text-success"
                                : "bg-destructive/12 text-destructive",
                            )}
                          >
                            {m.type === "RECEITA" ? "Receita" : "Despesa"}
                          </span>
                        </td>
                        <td className="num px-3 py-2 whitespace-nowrap">
                          {m.document ?? ""}
                        </td>
                        <td className="max-w-[280px] truncate px-3 py-2">
                          {m.counterparty ?? ""}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {formatBRL(m.original_amount)}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {formatBRL(m.paid_amount)}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {formatBRL(m.open_amount)}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={m.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
