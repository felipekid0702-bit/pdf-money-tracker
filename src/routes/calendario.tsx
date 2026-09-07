import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { EmptyState, StatCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { formatBRL, formatDate, todayISO } from "@/lib/finance";
import { finStatusLabel, openOf, paidOf, summarizeByDay } from "@/lib/analytics";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendario")({
  head: () => ({
    meta: [
      { title: "Calendário Financeiro | FP Financeiro" },
      {
        name: "description",
        content:
          "Calendário mensal com recebimentos, pagamentos, vencidos e fluxo líquido por dia da FP Solução em Altura.",
      },
      { property: "og:title", content: "Calendário Financeiro | FP Financeiro" },
      {
        property: "og:description",
        content: "Movimentações diárias de contas a receber e a pagar com fluxo líquido.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalendarPage,
});

const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
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

  const all = useMemo(() => data ?? [], [data]);
  const byDay = useMemo(() => summarizeByDay(all), [all]);

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => iso(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthTotals = useMemo(() => {
    let received = 0, paid = 0, toReceive = 0, toPay = 0, overdueR = 0, overdueP = 0, count = 0;
    for (const key of cells) {
      if (!key) continue;
      const d = byDay.get(key);
      if (!d) continue;
      received += d.received;
      paid += d.paid;
      toReceive += d.toReceive;
      toPay += d.toPay;
      overdueR += d.overdueReceive;
      overdueP += d.overduePay;
      count += d.count;
    }
    return { received, paid, toReceive, toPay, overdueR, overdueP, count };
  }, [cells, byDay]);

  const shift = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const day = selected ? byDay.get(selected) : undefined;
  const dayMovements = day?.items ?? [];
  const dayNet = day
    ? day.received + day.toReceive + day.overdueReceive - day.paid - day.toPay - day.overduePay
    : 0;
  const today = todayISO();

  return (
    <AppLayout
      title="Calendário Financeiro"
      subtitle="Movimentações por data de vencimento"
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : all.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-md border border-border bg-card p-1">
              <button onClick={() => shift(-1)} className="rounded p-1.5 hover:bg-muted" aria-label="Mês anterior">
                <ChevronLeft className="size-4" />
              </button>
              <span className="min-w-40 text-center text-sm font-medium">
                {MONTHS[month]} {year}
              </span>
              <button onClick={() => shift(1)} className="rounded p-1.5 hover:bg-muted" aria-label="Próximo mês">
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
            <span className="ml-auto text-xs text-muted-foreground">
              {monthTotals.count} movimentações no mês
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Recebido" value={formatBRL(monthTotals.received)} tone="success" />
            <StatCard label="Pago" value={formatBRL(monthTotals.paid)} tone="success" />
            <StatCard label="A receber" value={formatBRL(monthTotals.toReceive)} tone="warning" />
            <StatCard label="A pagar" value={formatBRL(monthTotals.toPay)} tone="warning" />
            <StatCard label="Receber vencido" value={formatBRL(monthTotals.overdueR)} tone="danger" />
            <StatCard label="Pagar vencido" value={formatBRL(monthTotals.overdueP)} tone="danger" />
          </div>

          <section className="rounded-lg border border-border bg-card">
            <header className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Próximos 7 dias</h2>
              <p className="text-xs text-muted-foreground">
                Títulos em aberto com vencimento de hoje até {formatDate(addDays(today, 6))}
              </p>
            </header>
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 lg:grid-cols-7">
              {next7.map((n) => (
                <button
                  key={n.key}
                  onClick={() => setSelected(n.key)}
                  className={cn(
                    "bg-card p-3 text-left transition hover:bg-muted/60",
                    selected === n.key && "ring-2 ring-inset ring-primary",
                  )}
                >
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {WEEK[new Date(`${n.key}T12:00:00`).getDay()]} · {n.key.slice(8, 10)}/{n.key.slice(5, 7)}
                  </div>
                  <div className="num mt-1 text-xs text-success">+{formatBRL(n.toReceive)}</div>
                  <div className="num text-xs text-destructive">-{formatBRL(n.toPay)}</div>
                  <div
                    className={cn(
                      "num mt-1 border-t border-border pt-1 text-xs font-semibold",
                      n.toReceive - n.toPay >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {formatBRL(n.toReceive - n.toPay)}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <Legend className="bg-success" label="Recebido / Pago" />
            <Legend className="bg-warning" label="Em aberto" />
            <Legend className="bg-destructive" label="Vencido" />
          </div>


          <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-7 border-b border-border bg-muted/50">
              {WEEK.map((w) => (
                <div key={w} className="px-2 py-2 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((key, i) => {
                if (!key)
                  return <div key={`e${i}`} className="min-h-28 border-b border-r border-border/60 bg-muted/20" />;
                const d = byDay.get(key);
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(key)}
                    className={cn(
                      "min-h-28 border-b border-r border-border/60 p-2 text-left align-top transition-colors hover:bg-muted/50",
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
                    {d && (
                      <div className="mt-1 space-y-0.5">
                        {d.received > 0 && (
                          <div className="num truncate text-[11px] font-medium text-success">
                            +{formatBRL(d.received)}
                          </div>
                        )}
                        {d.toReceive > 0 && (
                          <div className="num truncate text-[11px] text-warning">
                            ↑{formatBRL(d.toReceive)}
                          </div>
                        )}
                        {d.paid > 0 && (
                          <div className="num truncate text-[11px] font-medium text-muted-foreground">
                            −{formatBRL(d.paid)}
                          </div>
                        )}
                        {d.toPay > 0 && (
                          <div className="num truncate text-[11px] text-warning">
                            ↓{formatBRL(d.toPay)}
                          </div>
                        )}
                        {(d.overdueReceive > 0 || d.overduePay > 0) && (
                          <div className="num truncate text-[11px] font-medium text-destructive">
                            !{formatBRL(d.overdueReceive + d.overduePay)}
                          </div>
                        )}
                        <div className="text-[10px] text-muted-foreground">{d.count} mov.</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">
                {selected ? `Movimentações de ${formatDate(selected)}` : "Selecione um dia"}
              </span>
              {day && (
                <span
                  className={cn(
                    "num text-sm font-semibold",
                    dayNet >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  Fluxo líquido do dia: {formatBRL(dayNet)}
                </span>
              )}
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
                      <th className="px-3 py-2 text-left">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dayMovements.map((m) => (
                      <tr key={m.id} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
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
                        <td className="num px-3 py-2 whitespace-nowrap">{m.document ?? ""}</td>
                        <td className="max-w-[280px] truncate px-3 py-2">{m.counterparty ?? ""}</td>
                        <td className="num px-3 py-2 text-right">{formatBRL(m.original_amount)}</td>
                        <td className="num px-3 py-2 text-right">{formatBRL(paidOf(m))}</td>
                        <td className="num px-3 py-2 text-right">{formatBRL(openOf(m))}</td>
                        <td className="px-3 py-2 text-xs">{finStatusLabel(m)}</td>
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

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-full", className)} />
      {label}
    </span>
  );
}
