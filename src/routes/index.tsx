import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState, SectionCard, StatCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { usePeriod } from "@/lib/period";
import {
  addDaysISO,
  formatBRL,
  formatDate,
  monthKey,
  monthLabel,
  todayISO,
  totalize,
  type Movement,
} from "@/lib/finance";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard | FP Financeiro" },
      {
        name: "description",
        content:
          "Painel financeiro da FP Solução em Altura: receitas, despesas, resultado e fluxo previsto a partir dos relatórios do Bling.",
      },
      { property: "og:title", content: "Dashboard | FP Financeiro" },
      {
        property: "og:description",
        content: "Receitas, despesas, resultado e fluxo previsto em um só painel.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useMovements();
  const { filter } = usePeriod();
  const all = data ?? [];
  const rows = useMemo(() => filter(all), [all, filter]);

  const receitas = rows.filter((m) => m.type === "RECEITA");
  const despesas = rows.filter((m) => m.type === "DESPESA");
  const tr = totalize(receitas);
  const td = totalize(despesas);

  const monthly = useMemo(() => {
    const map = new Map<string, { mes: string; receitas: number; despesas: number }>();
    for (const m of rows) {
      const k = monthKey(m.due_date);
      if (!k) continue;
      const cur = map.get(k) ?? { mes: k, receitas: 0, despesas: 0 };
      if (m.type === "RECEITA") cur.receitas += m.original_amount;
      else cur.despesas += m.original_amount;
      map.set(k, cur);
    }
    return Array.from(map.values())
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((r) => ({ ...r, label: monthLabel(r.mes), resultado: r.receitas - r.despesas }));
  }, [rows]);

  const statusData = useMemo(() => {
    const today = todayISO();
    let liquidado = 0,
      aberto = 0,
      atrasado = 0;
    for (const m of rows) {
      liquidado += m.paid_amount;
      if (m.open_amount > 0) {
        if (m.due_date && m.due_date < today) atrasado += m.open_amount;
        else aberto += m.open_amount;
      }
    }
    return [
      { name: "Recebido/Pago", value: liquidado, fill: "var(--color-chart-1)" },
      { name: "Em aberto", value: aberto, fill: "var(--color-chart-4)" },
      { name: "Atrasado", value: atrasado, fill: "var(--color-chart-2)" },
    ].filter((d) => d.value > 0);
  }, [rows]);

  const forecast = useMemo(() => forecastWindows(all), [all]);
  const pressure = useMemo(() => financialPressure(all), [all]);

  return (
    <AppLayout
      title="Dashboard"
      subtitle="Visão financeira consolidada"
      actions={<PeriodFilter />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : all.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Receitas
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Faturamento" value={formatBRL(tr.total)} hint={`${tr.count} documentos`} />
              <StatCard label="Recebido" value={formatBRL(tr.settled)} tone="success" />
              <StatCard label="A receber" value={formatBRL(tr.open)} tone="warning" />
              <StatCard label="Vencido" value={formatBRL(tr.overdue)} tone="danger" />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Despesas
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="Total" value={formatBRL(td.total)} hint={`${td.count} documentos`} />
              <StatCard label="Pago" value={formatBRL(td.settled)} tone="success" />
              <StatCard label="A pagar" value={formatBRL(td.open)} tone="warning" />
              <StatCard label="Vencido" value={formatBRL(td.overdue)} tone="danger" />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resultado
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatCard
                label="Receitas − Despesas"
                value={formatBRL(tr.total - td.total)}
                tone={tr.total - td.total >= 0 ? "success" : "danger"}
              />
              <StatCard
                label="Fluxo previsto (em aberto)"
                value={formatBRL(tr.open - td.open)}
                tone={tr.open - td.open >= 0 ? "success" : "danger"}
                hint="A receber menos a pagar no período"
              />
            </div>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Faturamento por mês">
              <ChartBox>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Bar dataKey="receitas" name="Receitas" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
            </SectionCard>

            <SectionCard title="Despesas por mês">
              <ChartBox>
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Bar dataKey="despesas" name="Despesas" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
            </SectionCard>

            <SectionCard title="Receitas x Despesas">
              <ChartBox>
                <LineChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Legend />
                  <Line type="monotone" dataKey="receitas" name="Receitas" stroke="var(--color-chart-1)" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="despesas" name="Despesas" stroke="var(--color-chart-2)" dot={false} strokeWidth={2} />
                </LineChart>
              </ChartBox>
            </SectionCard>

            <SectionCard title="Status financeiro" description="Distribuição por situação">
              <ChartBox>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" outerRadius={95} label={false}>
                    {statusData.map((d) => (
                      <Cell key={d.name} fill={d.fill} />
                    ))}
                  </Pie>
                  <Legend />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                </PieChart>
              </ChartBox>
            </SectionCard>
          </div>

          <SectionCard
            title="Fluxo previsto"
            description="Recebimentos e pagamentos em aberto por vencimento — sem saldo bancário inicial"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-border">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">Janela</th>
                    <th className="py-2 text-right">Recebimentos previstos</th>
                    <th className="py-2 text-right">Pagamentos previstos</th>
                    <th className="py-2 text-right">Fluxo líquido projetado</th>
                  </tr>
                </thead>
                <tbody>
                  {forecast.map((f) => (
                    <tr key={f.label} className="border-b border-border/60 last:border-0">
                      <td className="py-2">{f.label}</td>
                      <td className="num py-2 text-right text-success">{formatBRL(f.inflow)}</td>
                      <td className="num py-2 text-right text-destructive">{formatBRL(f.outflow)}</td>
                      <td className={`num py-2 text-right font-semibold ${f.net >= 0 ? "text-success" : "text-destructive"}`}>
                        {formatBRL(f.net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SectionCard>

          <SectionCard
            title="Pressão financeira"
            description="Dias com maior concentração de pagamentos em aberto"
          >
            {pressure.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhum pagamento futuro em aberto.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="border-b border-border">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2">Data</th>
                      <th className="py-2 text-right">Total a pagar</th>
                      <th className="py-2 text-right">Total a receber</th>
                      <th className="py-2 text-right">Movimentos</th>
                      <th className="py-2 text-right">Fluxo líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pressure.map((p) => (
                      <tr key={p.date} className="border-b border-border/60 last:border-0">
                        <td className="num py-2">{formatDate(p.date)}</td>
                        <td className="num py-2 text-right text-destructive">{formatBRL(p.pay)}</td>
                        <td className="num py-2 text-right text-success">{formatBRL(p.receive)}</td>
                        <td className="num py-2 text-right">{p.count}</td>
                        <td className={`num py-2 text-right font-semibold ${p.receive - p.pay >= 0 ? "text-success" : "text-destructive"}`}>
                          {formatBRL(p.receive - p.pay)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      )}
    </AppLayout>
  );
}

function ChartBox({ children }: { children: React.ReactElement }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function compact(v: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(v);
}

export function forecastWindows(all: Movement[]) {
  const today = todayISO();
  return [7, 15, 30, 60, 90].map((d) => {
    const limit = addDaysISO(d);
    const inRange = all.filter(
      (m) => m.open_amount > 0 && m.due_date && m.due_date >= today && m.due_date <= limit,
    );
    const inflow = inRange
      .filter((m) => m.type === "RECEITA")
      .reduce((s, m) => s + m.open_amount, 0);
    const outflow = inRange
      .filter((m) => m.type === "DESPESA")
      .reduce((s, m) => s + m.open_amount, 0);
    return { label: `Próximos ${d} dias`, inflow, outflow, net: inflow - outflow };
  });
}

export function financialPressure(all: Movement[]) {
  const today = todayISO();
  const map = new Map<string, { date: string; pay: number; receive: number; count: number }>();
  for (const m of all) {
    if (m.open_amount <= 0 || !m.due_date || m.due_date < today) continue;
    const cur = map.get(m.due_date) ?? { date: m.due_date, pay: 0, receive: 0, count: 0 };
    if (m.type === "DESPESA") cur.pay += m.open_amount;
    else cur.receive += m.open_amount;
    cur.count += 1;
    map.set(m.due_date, cur);
  }
  return Array.from(map.values())
    .sort((a, b) => b.pay - b.receive - (a.pay - a.receive))
    .slice(0, 10);
}
