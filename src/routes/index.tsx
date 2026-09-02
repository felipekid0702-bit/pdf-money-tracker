import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
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
import { formatBRL, formatDate, formatPercent } from "@/lib/finance";
import {
  dueWindows,
  financialPressure,
  granularityFor,
  periodKpis,
  projections,
  statusDistribution,
  timeSeries,
} from "@/lib/analytics";

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
  const { filter, range, label } = usePeriod();
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => filter(all), [all, filter]);

  const k = useMemo(() => periodKpis(rows), [rows]);
  const series = useMemo(
    () => timeSeries(rows, granularityFor(range, rows)),
    [rows, range],
  );
  const statusData = useMemo(() => statusDistribution(rows), [rows]);
  const forecast = useMemo(() => projections(all), [all]);
  const due = useMemo(() => dueWindows(all), [all]);
  const pressure = useMemo(() => financialPressure(all), [all]);

  const cumulative = useMemo(() => {
    let acc = 0;
    return series.map((p) => {
      acc += p.liquido;
      return { label: p.label, liquido: p.liquido, acumulado: Math.round(acc * 100) / 100 };
    });
  }, [series]);

  const resultado = k.receita.original - k.despesa.original;
  const caixa = k.netRealized;
  const inadimplencia =
    k.receita.original > 0 ? k.receita.overdue / k.receita.original : 0;
  const taxaRecebimento =
    k.receita.original > 0 ? k.receita.settled / k.receita.original : 0;
  const taxaPagamento =
    k.despesa.original > 0 ? k.despesa.settled / k.despesa.original : 0;
  const cobertura =
    k.despesa.open + k.despesa.overdue > 0
      ? (k.receita.open + k.receita.overdue) / (k.despesa.open + k.despesa.overdue)
      : null;

  return (
    <AppLayout
      title="Dashboard"
      subtitle={`Visão financeira consolidada · ${label}`}
      actions={<PeriodFilter />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : all.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <Group title="Receitas">
            <StatCard
              label="Faturamento"
              value={formatBRL(k.receita.original)}
              hint={`${k.receita.count} documentos`}
            />
            <StatCard
              label="Recebido"
              value={formatBRL(k.receita.settled)}
              hint={`${k.receita.settledCount} liquidados`}
              tone="success"
            />
            <StatCard
              label="A receber"
              value={formatBRL(k.receita.open)}
              hint={`${k.receita.openCount} títulos`}
              tone="warning"
            />
            <StatCard
              label="Vencido"
              value={formatBRL(k.receita.overdue)}
              hint={`${k.receita.overdueCount} títulos`}
              tone="danger"
            />
          </Group>

          <Group title="Despesas">
            <StatCard
              label="Total"
              value={formatBRL(k.despesa.original)}
              hint={`${k.despesa.count} documentos`}
            />
            <StatCard
              label="Pago"
              value={formatBRL(k.despesa.settled)}
              hint={`${k.despesa.settledCount} liquidados`}
              tone="success"
            />
            <StatCard
              label="A pagar"
              value={formatBRL(k.despesa.open)}
              hint={`${k.despesa.openCount} títulos`}
              tone="warning"
            />
            <StatCard
              label="Vencido"
              value={formatBRL(k.despesa.overdue)}
              hint={`${k.despesa.overdueCount} títulos`}
              tone="danger"
            />
          </Group>

          <Group title="Resultado e indicadores">
            <StatCard
              label="Resultado (faturado − despesas)"
              value={formatBRL(resultado)}
              tone={resultado >= 0 ? "success" : "danger"}
            />
            <StatCard
              label="Caixa realizado (recebido − pago)"
              value={formatBRL(caixa)}
              tone={caixa >= 0 ? "success" : "danger"}
            />
            <StatCard
              label="Fluxo em aberto (a receber − a pagar)"
              value={formatBRL(k.netOpen)}
              tone={k.netOpen >= 0 ? "success" : "danger"}
            />
            <StatCard
              label="Vencido líquido"
              value={formatBRL(k.netOverdue)}
              tone={k.netOverdue >= 0 ? "warning" : "danger"}
            />
            <StatCard
              label="Taxa de recebimento"
              value={formatPercent(taxaRecebimento)}
              tone="success"
            />
            <StatCard label="Taxa de pagamento" value={formatPercent(taxaPagamento)} />
            <StatCard
              label="Inadimplência"
              value={formatPercent(inadimplencia)}
              hint="Vencido / faturamento"
              tone="danger"
            />
            <StatCard
              label="Cobertura de obrigações"
              value={cobertura === null ? "—" : `${cobertura.toFixed(2).replace(".", ",")}x`}
              hint="A receber / a pagar em aberto"
              tone={cobertura !== null && cobertura >= 1 ? "success" : "warning"}
            />
          </Group>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Recebido x Pago" description="Realizado por vencimento">
              <ChartBox>
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Legend />
                  <Bar dataKey="recebido" name="Recebido" fill="var(--color-chart-1)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pago" name="Pago" fill="var(--color-chart-2)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
            </SectionCard>

            <SectionCard title="A receber x A pagar" description="Saldos em aberto por vencimento">
              <ChartBox>
                <BarChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Legend />
                  <Bar dataKey="aReceber" name="A receber" fill="var(--color-chart-4)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="aPagar" name="A pagar" fill="var(--color-chart-3)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
            </SectionCard>

            <SectionCard title="Fluxo líquido" description="Entradas menos saídas por período">
              <ChartBox>
                <LineChart data={series}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Line type="monotone" dataKey="liquido" name="Líquido" stroke="var(--color-chart-1)" dot={false} strokeWidth={2} />
                </LineChart>
              </ChartBox>
            </SectionCard>

            <SectionCard title="Saldo acumulado" description="Acúmulo do fluxo líquido no período">
              <ChartBox>
                <AreaChart data={cumulative}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Area
                    type="monotone"
                    dataKey="acumulado"
                    name="Acumulado"
                    stroke="var(--color-chart-1)"
                    fill="var(--color-chart-1)"
                    fillOpacity={0.18}
                  />
                </AreaChart>
              </ChartBox>
            </SectionCard>

            <SectionCard title="Distribuição por situação" description="Realizado, em aberto e vencido">
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

            <SectionCard title="Vencimentos imediatos" description="Títulos em aberto por janela">
              <FlowTable rows={due} />
            </SectionCard>
          </div>

          <SectionCard
            title="Projeção determinística"
            description="Somente títulos em aberto, por data de vencimento — sem saldo bancário inicial"
          >
            <FlowTable rows={forecast} showPeriod />
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
                        <td
                          className={`num py-2 text-right font-semibold ${p.receive - p.pay >= 0 ? "text-success" : "text-destructive"}`}
                        >
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

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </div>
  );
}

export function FlowTable({
  rows,
  showPeriod,
}: {
  rows: {
    label: string;
    from: string;
    to: string;
    inflow: number;
    outflow: number;
    net: number;
    count: number;
  }[];
  showPeriod?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-border">
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2">Janela</th>
            {showPeriod && <th className="py-2">Período</th>}
            <th className="py-2 text-right">Recebimentos</th>
            <th className="py-2 text-right">Pagamentos</th>
            <th className="py-2 text-right">Títulos</th>
            <th className="py-2 text-right">Líquido</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.label} className="border-b border-border/60 last:border-0">
              <td className="py-2">{f.label}</td>
              {showPeriod && (
                <td className="num py-2 text-xs text-muted-foreground">
                  {formatDate(f.from)} – {formatDate(f.to)}
                </td>
              )}
              <td className="num py-2 text-right text-success">{formatBRL(f.inflow)}</td>
              <td className="num py-2 text-right text-destructive">{formatBRL(f.outflow)}</td>
              <td className="num py-2 text-right">{f.count}</td>
              <td
                className={`num py-2 text-right font-semibold ${f.net >= 0 ? "text-success" : "text-destructive"}`}
              >
                {formatBRL(f.net)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
