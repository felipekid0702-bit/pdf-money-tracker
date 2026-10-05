import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState, KpiCard, SectionCard, StatCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { resolvePeriod, usePeriod } from "@/lib/period";
import { formatBRL, formatDate, formatPercent, todayISO } from "@/lib/finance";
import {
  addDays,
  attentionPoints,
  avgSettlementDays,
  dailyFlow,
  dayBlock,
  dowLabel,
  granularityFor,
  openPosition,
  periodKpis,
  projectionForRange,
  rankParties,
  sideDistribution,
  statusDistribution,
  timeSeries,
  topShare,
  type DayBlock,
} from "@/lib/analytics";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard | FP Financeiro" },
      {
        name: "description",
        content:
          "Painel financeiro da FP Solução em Altura: saldo projetado, recebíveis, pagamentos, fluxo de caixa e indicadores a partir dos relatórios do Bling.",
      },
      { property: "og:title", content: "Dashboard | FP Financeiro" },
      {
        property: "og:description",
        content: "Visão executiva de recebimentos, pagamentos, resultado e projeções.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const CHART = {
  in: "var(--color-chart-1)",
  out: "var(--color-chart-3)",
  net: "var(--color-chart-2)",
  warn: "var(--color-chart-4)",
};

function Dashboard() {
  const { data, isLoading } = useMovements();
  const { filter, range, label } = usePeriod();
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => filter(all), [all, filter]);
  const today = todayISO();
  const tomorrow = useMemo(() => addDays(today, 1), [today]);

  /* ---------- indicadores financeiros do período selecionado ---------- */
  const pos = useMemo(() => openPosition(rows, today), [rows, today]);
  const allPosition = useMemo(() => openPosition(all, today), [all, today]);
  const selectedProjection = useMemo(
    () => projectionForRange(rows, { from: null, to: null }, label, today),
    [rows, label, today],
  );
  const alerts = useMemo(() => attentionPoints(all, today), [all, today]);
  const financialPeriod =
    range.from || range.to
      ? `${label}: ${formatDate(range.from) || "…"} – ${formatDate(range.to) || "…"}`
      : label;

  /* ---------- blocos de dia ---------- */
  const hoje = useMemo(() => dayBlock(all, today, today), [all, today]);
  const amanha = useMemo(() => dayBlock(all, tomorrow, today), [all, tomorrow, today]);

  /* ---------- semana atual (seg–dom) ---------- */
  const week = useMemo(() => {
    const r = resolvePeriod("week");
    if (!r.from || !r.to) return [];
    return dailyFlow(all, r.from, r.to, today).map((d) => ({
      ...d,
      label: `${dowLabel(d.date)} ${d.label}`,
      entradas: d.receber + d.recebido,
      saidas: d.pagar + d.pago,
    }));
  }, [all, today]);
  const weekTotals = useMemo(
    () =>
      week.reduce(
        (a, d) => ({
          entradas: a.entradas + d.entradas,
          saidas: a.saidas + d.saidas,
          saldo: a.saldo + d.saldo,
        }),
        { entradas: 0, saidas: 0, saldo: 0 },
      ),
    [week],
  );

  /* ---------- projeção diária dos próximos 7 dias ---------- */
  const next7 = useMemo(
    () =>
      dailyFlow(all, addDays(today, 1), addDays(today, 7), today).map((d) => ({
        ...d,
        label: `${dowLabel(d.date)} ${d.label}`,
      })),
    [all, today],
  );

  /* ---------- período filtrado ---------- */
  const k = useMemo(() => periodKpis(rows, today), [rows, today]);
  const series = useMemo(() => timeSeries(rows, granularityFor(range, rows)), [rows, range]);
  const flow = useMemo(() => {
    let acc = 0;
    return series.map((p) => {
      const entradas = p.recebido + p.aReceber;
      const saidas = p.pago + p.aPagar;
      acc += entradas - saidas;
      return {
        label: p.label,
        entradas,
        saidas,
        acumulado: Math.round(acc * 100) / 100,
      };
    });
  }, [series]);
  const statusData = useMemo(() => statusDistribution(rows, today), [rows, today]);

  const clientes = useMemo(() => rankParties(rows, "RECEITA", today), [rows, today]);
  const fornecedores = useMemo(() => rankParties(rows, "DESPESA", today), [rows, today]);
  const distReceb = useMemo(() => sideDistribution(all, "RECEITA", today), [all, today]);
  const distPag = useMemo(() => sideDistribution(all, "DESPESA", today), [all, today]);

  const pmr = useMemo(() => avgSettlementDays(rows, "RECEITA", today), [rows, today]);
  const pmp = useMemo(() => avgSettlementDays(rows, "DESPESA", today), [rows, today]);

  const resultado = k.receita.original - k.despesa.original;
  const margem = k.receita.original > 0 ? resultado / k.receita.original : null;
  const ticketR = k.receita.count > 0 ? k.receita.original / k.receita.count : null;
  const ticketP = k.despesa.count > 0 ? k.despesa.original / k.despesa.count : null;
  const inadimplencia = k.receita.original > 0 ? k.receita.overdue / k.receita.original : null;
  const relacao = k.despesa.settled > 0 ? k.receita.settled / k.despesa.settled : null;
  const ciclo = pmr.value !== null && pmp.value !== null ? pmr.value - pmp.value : null;
  const concCli = topShare(clientes, 5);
  const concForn = topShare(fornecedores, 5);
  const saldoProjetado = pos.net;

  const vencendo = (list: typeof distReceb, name: string) =>
    list.find((d) => d.name === name)?.value ?? 0;

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
        <div className="space-y-8">
          {/* 1. VISÃO FINANCEIRA */}
          <section>
            <SectionTitle
              title="Visão financeira"
              hint="Projeção baseada apenas em títulos em aberto do Bling — não inclui saldo bancário."
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard
                label="Saldo projetado"
                value={formatBRL(saldoProjetado)}
                hint="A receber − a pagar (projeção, sem saldo bancário)"
                period={financialPeriod}
                tone={saldoProjetado >= 0 ? "success" : "danger"}
              />
              <StatCard
                label="Contas a receber em aberto"
                value={formatBRL(pos.receivableTotal)}
                hint={`Inclui ${formatBRL(pos.receivableOverdue)} vencidos no período`}
                period={financialPeriod}
                tone="info"
              />
              <StatCard
                label="Contas a pagar em aberto"
                value={formatBRL(pos.payableTotal)}
                hint={`Inclui ${formatBRL(pos.payableOverdue)} vencidos no período`}
                period={financialPeriod}
                tone="warning"
              />
              <StatCard
                label="Resultado projetado"
                value={formatBRL(resultado)}
                hint="Valor original a receber − valor original a pagar no período"
                period={financialPeriod}
                tone={resultado >= 0 ? "success" : "danger"}
              />
              <StatCard
                label="Vencido a receber"
                value={formatBRL(pos.receivableOverdue)}
                hint="Títulos vencidos e ainda em aberto"
                period={financialPeriod}
                tone="danger"
              />
              <StatCard
                label="Vencido a pagar"
                value={formatBRL(pos.payableOverdue)}
                hint="Títulos vencidos e ainda em aberto"
                period={financialPeriod}
                tone="danger"
              />
              <StatCard
                label="Previsão do período"
                value={`${formatBRL(selectedProjection.inflow)} / ${formatBRL(selectedProjection.outflow)}`}
                hint="Recebimentos / pagamentos previstos no período selecionado"
                period={financialPeriod}
              />
              <StatCard
                label="Saldo do período"
                value={formatBRL(selectedProjection.net)}
                hint={`${selectedProjection.count} títulos em aberto no período`}
                period={financialPeriod}
                tone={selectedProjection.net >= 0 ? "success" : "danger"}
              />
            </div>
          </section>

          {/* 5. HOJE e AMANHÃ */}
          <div className="grid gap-4 xl:grid-cols-2">
            <DayCard title="Hoje" date={today} b={hoje} />
            <DayCard title="Amanhã" date={tomorrow} b={amanha} />
          </div>

          {/* 6. FLUXO DA SEMANA ATUAL */}
          <SectionCard
            title="Fluxo da semana atual"
            description="Segunda a domingo — entradas, saídas e saldo diário"
          >
            {week.length === 0 ? (
              <Insufficient />
            ) : (
              <>
                <ChartBox>
                  <ComposedChart data={week}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={11} />
                    <YAxis fontSize={11} width={70} tickFormatter={compact} />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                    <Legend />
                    <Bar
                      dataKey="entradas"
                      name="Recebimentos"
                      fill={CHART.in}
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="saidas"
                      name="Pagamentos"
                      fill={CHART.out}
                      radius={[3, 3, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="saldo"
                      name="Saldo do dia"
                      stroke={CHART.net}
                      strokeWidth={2}
                      dot
                    />
                  </ComposedChart>
                </ChartBox>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <StatCard
                    label="Entradas da semana"
                    value={formatBRL(weekTotals.entradas)}
                    tone="success"
                  />
                  <StatCard
                    label="Saídas da semana"
                    value={formatBRL(weekTotals.saidas)}
                    tone="danger"
                  />
                  <StatCard
                    label="Saldo da semana"
                    value={formatBRL(weekTotals.saldo)}
                    tone={weekTotals.saldo >= 0 ? "success" : "danger"}
                  />
                </div>
              </>
            )}
          </SectionCard>

          {/* 7. FLUXO FINANCEIRO */}
          <SectionCard
            title="Fluxo financeiro"
            description={`Entradas, saídas e saldo acumulado · ${label}`}
          >
            {flow.length === 0 ? (
              <Insufficient />
            ) : (
              <ChartBox className="h-80">
                <ComposedChart data={flow}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Legend />
                  <Bar dataKey="entradas" name="Entradas" fill={CHART.in} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="saidas" name="Saídas" fill={CHART.out} radius={[3, 3, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="acumulado"
                    name="Saldo acumulado"
                    stroke={CHART.net}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ChartBox>
            )}
          </SectionCard>

          {/* 8. PROJEÇÕES */}
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Projeção — próximos 7 dias"
              description="Somente títulos em aberto, por data de vencimento"
            >
              <ChartBox>
                <ComposedChart data={next7}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Legend />
                  <Bar dataKey="receber" name="A receber" fill={CHART.in} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="pagar" name="A pagar" fill={CHART.out} radius={[3, 3, 0, 0]} />
                  <Line
                    type="monotone"
                    dataKey="acumulado"
                    name="Acumulado"
                    stroke={CHART.net}
                    strokeWidth={2}
                    dot={false}
                  />
                </ComposedChart>
              </ChartBox>
            </SectionCard>

            <SectionCard
              title="Projeção 30 / 60 / 90 dias"
              description="Determinística: apenas títulos em aberto — sem saldo bancário inicial"
            >
              <FlowTable rows={proj.slice(1)} showPeriod />
            </SectionCard>
          </div>

          {/* 9. PONTOS DE ATENÇÃO */}
          <SectionCard
            title="Pontos de atenção"
            description="Regras objetivas aplicadas sobre os títulos importados"
          >
            {alerts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum ponto de atenção identificado.</p>
            ) : (
              <ul className="space-y-2">
                {alerts.map((a, i) => (
                  <li
                    key={`${a.title}-${i}`}
                    className={`rounded-md border-l-4 bg-muted/40 px-3 py-2 ${
                      a.level === "critico"
                        ? "border-destructive"
                        : a.level === "atencao"
                          ? "border-warning"
                          : "border-info"
                    }`}
                  >
                    <p className="text-sm font-medium">{a.title}</p>
                    <p className="text-xs text-muted-foreground">{a.detail}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* 10. RECEBÍVEIS E PAGAMENTOS */}
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="Recebíveis" description="Posição total em aberto">
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard
                  label="Total em aberto"
                  value={formatBRL(allPosition.receivableTotal)}
                  tone="info"
                />
                <StatCard
                  label="Vence hoje"
                  value={formatBRL(vencendo(distReceb, "Vence hoje"))}
                  tone="warning"
                />
                <StatCard label="Até 7 dias" value={formatBRL(vencendo(distReceb, "Até 7 dias"))} />
                <StatCard
                  label="8 a 30 dias"
                  value={formatBRL(vencendo(distReceb, "8 a 30 dias"))}
                />
                <StatCard
                  label="Ticket médio"
                  value={ticketR === null ? "—" : formatBRL(ticketR)}
                  hint={`${k.receita.count} títulos no período`}
                />
                <StatCard
                  label="Concentração Top 5 clientes"
                  value={clientes.length === 0 ? "—" : formatPercent(concCli)}
                />
              </div>
              <div className="mt-4">
                <DistBars data={distReceb} />
              </div>
            </SectionCard>

            <SectionCard title="Pagamentos" description="Posição total em aberto">
              <div className="grid gap-3 sm:grid-cols-2">
                <StatCard
                  label="Total em aberto"
                  value={formatBRL(allPosition.payableTotal)}
                  tone="warning"
                />
                <StatCard
                  label="Vence hoje"
                  value={formatBRL(vencendo(distPag, "Vence hoje"))}
                  tone="warning"
                />
                <StatCard label="Até 7 dias" value={formatBRL(vencendo(distPag, "Até 7 dias"))} />
                <StatCard label="8 a 30 dias" value={formatBRL(vencendo(distPag, "8 a 30 dias"))} />
                <StatCard
                  label="Ticket médio"
                  value={ticketP === null ? "—" : formatBRL(ticketP)}
                  hint={`${k.despesa.count} títulos no período`}
                />
                <StatCard
                  label="Concentração Top 5 fornecedores"
                  value={fornecedores.length === 0 ? "—" : formatPercent(concForn)}
                />
              </div>
              <div className="mt-4">
                <DistBars data={distPag} />
              </div>
            </SectionCard>
          </div>

          {/* 13. CLIENTES E FORNECEDORES */}
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Top 10 clientes"
              description={`Participação no faturamento · ${label}`}
            >
              <PartyBars list={clientes} color={CHART.in} />
            </SectionCard>
            <SectionCard
              title="Top 10 fornecedores"
              description={`Participação nas despesas · ${label}`}
            >
              <PartyBars list={fornecedores} color={CHART.out} />
            </SectionCard>
          </div>

          {/* 15. PREVISTO x REALIZADO + situação */}
          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="Recebimentos x Pagamentos"
              description={`Previsto (em aberto) e realizado · ${label}`}
            >
              <ChartBox>
                <BarChart
                  data={[
                    {
                      name: "Recebimentos",
                      Realizado: k.receita.settled,
                      Previsto: k.receita.open + k.receita.overdue,
                    },
                    {
                      name: "Pagamentos",
                      Realizado: k.despesa.settled,
                      Previsto: k.despesa.open + k.despesa.overdue,
                    },
                  ]}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} width={70} tickFormatter={compact} />
                  <Tooltip formatter={(v: number) => formatBRL(v)} />
                  <Legend />
                  <Bar dataKey="Realizado" fill={CHART.in} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Previsto" fill={CHART.warn} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartBox>
            </SectionCard>

            <SectionCard
              title="Distribuição por situação"
              description={`Realizado, em aberto e vencido · ${label}`}
            >
              {statusData.every((d) => d.value === 0) ? (
                <Insufficient />
              ) : (
                <ChartBox>
                  <PieChart>
                    <Pie
                      data={statusData}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={95}
                      label={false}
                    >
                      {statusData.map((d) => (
                        <Cell key={d.name} fill={d.fill} />
                      ))}
                    </Pie>
                    <Legend />
                    <Tooltip formatter={(v: number) => formatBRL(v)} />
                  </PieChart>
                </ChartBox>
              )}
            </SectionCard>
          </div>

          {/* 11. KPIs FINANCEIROS */}
          <section>
            <SectionTitle
              title="KPIs financeiros"
              hint="Cada indicador traz explicação, fórmula e leitura. Base: títulos do período selecionado."
            />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <KpiCard
                name="Receita"
                value={formatBRL(k.receita.original)}
                unit="BRL"
                period={label}
                explanation="Total faturado em títulos a receber com vencimento no período."
                formula="Σ valor original dos títulos do tipo RECEITA"
                interpretation={`${k.receita.count} documentos considerados.`}
                tone="success"
              />
              <KpiCard
                name="Despesa"
                value={formatBRL(k.despesa.original)}
                unit="BRL"
                period={label}
                explanation="Total de obrigações a pagar com vencimento no período."
                formula="Σ valor original dos títulos do tipo DESPESA"
                interpretation={`${k.despesa.count} documentos considerados.`}
                tone="danger"
              />
              <KpiCard
                name="Resultado"
                value={formatBRL(resultado)}
                unit="BRL"
                period={label}
                explanation="Diferença entre o faturado e as despesas do período."
                formula="Receita − Despesa"
                interpretation={
                  resultado >= 0 ? "Resultado positivo no período." : "Despesas superam a receita."
                }
                tone={resultado >= 0 ? "success" : "danger"}
              />
              <KpiCard
                name="Margem"
                value={margem === null ? "—" : formatPercent(margem)}
                unit="%"
                period={label}
                explanation="Parcela da receita que sobra após as despesas."
                formula="(Receita − Despesa) ÷ Receita"
                interpretation={
                  margem !== null && margem >= 0 ? "Quanto maior, melhor." : "Margem negativa."
                }
                insufficient={margem === null}
                tone={margem !== null && margem >= 0 ? "success" : "danger"}
              />
              <KpiCard
                name="Ticket médio de recebimento"
                value={ticketR === null ? "—" : formatBRL(ticketR)}
                unit="BRL"
                period={label}
                explanation="Valor médio de cada título a receber."
                formula="Receita ÷ nº de títulos de receita"
                insufficient={ticketR === null}
              />
              <KpiCard
                name="Ticket médio de pagamento"
                value={ticketP === null ? "—" : formatBRL(ticketP)}
                unit="BRL"
                period={label}
                explanation="Valor médio de cada título a pagar."
                formula="Despesa ÷ nº de títulos de despesa"
                insufficient={ticketP === null}
              />
              <KpiCard
                name="Inadimplência"
                value={inadimplencia === null ? "—" : formatPercent(inadimplencia)}
                unit="%"
                period={label}
                explanation="Parcela do faturamento vencida e não recebida."
                formula="Receita vencida ÷ Receita total"
                interpretation="Acima de 15% exige ação de cobrança."
                insufficient={inadimplencia === null}
                tone="danger"
              />
              <KpiCard
                name="PMR — prazo médio de recebimento"
                value={pmr.value === null ? "—" : pmr.value.toFixed(1).replace(".", ",")}
                unit="dias"
                period={label}
                explanation="Tempo médio entre a emissão e o recebimento dos títulos liquidados."
                formula="Média (data de recebimento − data de emissão)"
                interpretation={`Base: ${pmr.sample} títulos liquidados.`}
                insufficient={pmr.value === null}
              />
              <KpiCard
                name="PMP — prazo médio de pagamento"
                value={pmp.value === null ? "—" : pmp.value.toFixed(1).replace(".", ",")}
                unit="dias"
                period={label}
                explanation="Tempo médio entre a emissão e o pagamento das despesas liquidadas."
                formula="Média (data de pagamento − data de emissão)"
                interpretation={`Base: ${pmp.sample} títulos liquidados.`}
                insufficient={pmp.value === null}
              />
              <KpiCard
                name="Ciclo financeiro"
                value={ciclo === null ? "—" : ciclo.toFixed(1).replace(".", ",")}
                unit="dias"
                period={label}
                explanation="Diferença entre o prazo de recebimento e o de pagamento."
                formula="PMR − PMP"
                interpretation={
                  ciclo !== null && ciclo > 0
                    ? "Você paga antes de receber: exige capital de giro."
                    : "Você recebe antes de pagar."
                }
                insufficient={ciclo === null}
                tone={ciclo !== null && ciclo > 0 ? "warning" : "success"}
              />
              <KpiCard
                name="Relação recebimentos / pagamentos"
                value={relacao === null ? "—" : `${relacao.toFixed(2).replace(".", ",")}x`}
                period={label}
                explanation="Quantas vezes o que foi recebido cobre o que foi pago."
                formula="Recebido ÷ Pago"
                interpretation="Abaixo de 1x significa saída de caixa maior que a entrada."
                insufficient={relacao === null}
                tone={relacao !== null && relacao >= 1 ? "success" : "danger"}
              />
              <KpiCard
                name="Concentração de clientes (Top 5)"
                value={clientes.length === 0 ? "—" : formatPercent(concCli)}
                unit="%"
                period={label}
                explanation="Participação dos 5 maiores clientes no faturamento."
                formula="Σ Top 5 clientes ÷ Receita total"
                interpretation="Acima de 60% indica dependência elevada."
                insufficient={clientes.length === 0}
                tone={concCli > 0.6 ? "warning" : "default"}
              />
            </div>
          </section>
        </div>
      )}
    </AppLayout>
  );
}

/* ---------------- componentes auxiliares ---------------- */

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Insufficient() {
  return <p className="text-sm text-muted-foreground">Dados insuficientes para cálculo.</p>;
}

function DayCard({ title, date, b }: { title: string; date: string; b: DayBlock }) {
  const total = b.toReceive + b.toPay + b.received + b.paid;
  return (
    <SectionCard title={title} description={formatDate(date)}>
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">Sem movimentações nesta data.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard
              label="A receber"
              value={formatBRL(b.toReceive)}
              hint={`${b.toReceiveCount} títulos`}
              tone="info"
            />
            <StatCard
              label="A pagar"
              value={formatBRL(b.toPay)}
              hint={`${b.toPayCount} títulos`}
              tone="warning"
            />
            <StatCard
              label="Recebido"
              value={formatBRL(b.received)}
              hint={`${b.receivedCount} títulos`}
              tone="success"
            />
            <StatCard
              label="Pago"
              value={formatBRL(b.paid)}
              hint={`${b.paidCount} títulos`}
              tone="danger"
            />
            <StatCard
              label="Resultado do dia"
              value={formatBRL(b.net)}
              hint="Entradas − saídas do dia"
              tone={b.net >= 0 ? "success" : "danger"}
            />
            <StatCard
              label="Resultado realizado"
              value={formatBRL(b.realizedNet)}
              hint="Recebido − pago"
              tone={b.realizedNet >= 0 ? "success" : "danger"}
            />
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <TopList title="Principais clientes" items={b.topClients} />
            <TopList title="Principais fornecedores" items={b.topSuppliers} />
          </div>
        </>
      )}
    </SectionCard>
  );
}

function TopList({ title, items }: { title: string; items: { name: string; amount: number }[] }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">—</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((i) => (
            <li key={i.name} className="flex justify-between gap-2">
              <span className="truncate">{i.name}</span>
              <span className="num shrink-0">{formatBRL(i.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DistBars({ data }: { data: { name: string; value: number; tone: string }[] }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  if (total <= 0) return <Insufficient />;
  const color = (t: string) =>
    t === "ok"
      ? "bg-success"
      : t === "bad"
        ? "bg-destructive"
        : t === "warn"
          ? "bg-warning"
          : "bg-info";
  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.name}>
          <div className="flex justify-between text-xs">
            <span>{d.name}</span>
            <span className="num text-muted-foreground">
              {formatBRL(d.value)} · {formatPercent(d.value / total)}
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full ${color(d.tone)}`}
              style={{ width: `${Math.min(100, (d.value / total) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function PartyBars({
  list,
  color,
}: {
  list: { name: string; total: number; share: number }[];
  color: string;
}) {
  const top = list.slice(0, 10);
  if (top.length === 0) return <Insufficient />;
  const max = Math.max(...top.map((t) => t.total)) || 1;
  return (
    <div className="space-y-2">
      {top.map((t) => (
        <div key={t.name}>
          <div className="flex justify-between gap-2 text-xs">
            <span className="truncate">{t.name}</span>
            <span className="num shrink-0 text-muted-foreground">
              {formatBRL(t.total)} · {formatPercent(t.share)}
            </span>
          </div>
          <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full"
              style={{ width: `${(t.total / max) * 100}%`, background: color }}
            />
          </div>
        </div>
      ))}
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

function ChartBox({ children, className }: { children: React.ReactElement; className?: string }) {
  return (
    <div className={className ?? "h-64 w-full"}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

function compact(v: number) {
  return new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(v);
}
