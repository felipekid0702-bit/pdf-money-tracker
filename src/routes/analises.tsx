import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState, KpiCard, SectionCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { usePeriod } from "@/lib/period";
import {
  formatBRL,
  formatPercent,
  isCancelledStatus,
  monthKey,
  monthLabel,
  todayISO,
  type Movement,
} from "@/lib/finance";
import {
  aging,
  avgSettlementDays,
  financialPressure,
  periodKpis,
  projections,
  rankParties,
  topShare,
  type AgingBucket,
  type PartyRow,
} from "@/lib/analytics";
import { FlowTable } from "./index";

export const Route = createFileRoute("/analises")({
  head: () => ({
    meta: [
      { title: "Análises financeiras | FP Financeiro" },
      {
        name: "description",
        content:
          "Rankings de clientes e fornecedores, aging, concentração e previsão determinística de fluxo da FP Solução em Altura.",
      },
      { property: "og:title", content: "Análises financeiras | FP Financeiro" },
      {
        property: "og:description",
        content: "Clientes, fornecedores, aging, concentração e projeções por período.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Analises,
});

function avgDays(rows: Movement[]): number | null {
  const vals: number[] = [];
  for (const m of rows) {
    if (isCancelledStatus(m.status)) continue;
    if (!m.issue_date || !m.due_date) continue;
    const diff = (Date.parse(m.due_date) - Date.parse(m.issue_date)) / 86_400_000;
    if (isFinite(diff)) vals.push(diff);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function previousMonthKey(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, "0")}`;
}

function Analises() {
  const { data, isLoading } = useMovements();
  const { filter, label } = usePeriod();
  const today = todayISO();
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => filter(all), [all, filter]);

  const receitas = useMemo(() => rows.filter((m) => m.type === "RECEITA"), [rows]);
  const despesas = useMemo(() => rows.filter((m) => m.type === "DESPESA"), [rows]);
  const k = useMemo(() => periodKpis(rows, today), [rows, today]);

  const clientes = useMemo(() => rankParties(rows, "RECEITA"), [rows]);
  const fornecedores = useMemo(() => rankParties(rows, "DESPESA"), [rows]);
  const forecast = useMemo(() => projections(all), [all]);
  const pressure = useMemo(() => financialPressure(all, undefined, 15), [all]);

  const agingReceberFut = useMemo(() => aging(all, "RECEITA", "future"), [all]);
  const agingReceberVenc = useMemo(() => aging(all, "RECEITA", "past"), [all]);
  const agingPagarFut = useMemo(() => aging(all, "DESPESA", "future"), [all]);
  const agingPagarVenc = useMemo(() => aging(all, "DESPESA", "past"), [all]);

  const monthlyRevenue = useMemo(() => {
    const map = new Map<string, number>();
    const currentMonth = today.slice(0, 7);
    for (const m of receitas) {
      if (isCancelledStatus(m.status)) continue;
      const key = monthKey(m.due_date);
      if (!key || key >= currentMonth) continue;
      map.set(key, (map.get(key) ?? 0) + (Number(m.original_amount) || 0));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [receitas, today]);

  const growth = useMemo(() => {
    if (monthlyRevenue.length < 2) return null;
    const last = monthlyRevenue[monthlyRevenue.length - 1]!;
    const previousKey = previousMonthKey(last[0]);
    const prev = monthlyRevenue.find(([key]) => key === previousKey);
    if (!prev || prev[1] <= 0) return null;
    return { value: (last[1] - prev[1]) / prev[1], from: prev[0], to: last[0] };
  }, [monthlyRevenue]);

  const prazoReceb = avgDays(receitas);
  const prazoPag = avgDays(despesas);
  const dso = avgSettlementDays(rows, "RECEITA", today);
  const dpo = avgSettlementDays(rows, "DESPESA", today);
  const shareRecebido = k.receita.original > 0 ? k.receita.settled / k.receita.original : null;
  const sharePago = k.despesa.original > 0 ? k.despesa.settled / k.despesa.original : null;
  const saldoReceber = k.receita.open + k.receita.overdue;
  const saldoPagar = k.despesa.open + k.despesa.overdue;
  const shareInadimplencia = saldoReceber > 0 ? k.receita.overdue / saldoReceber : null;
  const shareAtrasoDespesas = saldoPagar > 0 ? k.despesa.overdue / saldoPagar : null;

  return (
    <AppLayout
      title="Análises"
      subtitle={`Clientes, fornecedores, aging e projeções · ${label}`}
      actions={<PeriodFilter />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : all.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard
              name="Ticket médio (receitas)"
              value={k.receita.count ? formatBRL(k.receita.avgTicket) : "—"}
              period={label}
              explanation="Valor original médio por título de receita válido; títulos cancelados são excluídos."
              formula="Valor original das receitas ÷ quantidade de títulos"
              ideal="Meta comercial definida pela gestão."
              status="Informativo; não há meta de ticket cadastrada."
              tone="info"
            />
            <KpiCard
              name="Ticket médio (despesas)"
              value={k.despesa.count ? formatBRL(k.despesa.avgTicket) : "—"}
              period={label}
              explanation="Valor original médio por título de despesa válido; títulos cancelados são excluídos."
              formula="Valor original das despesas ÷ quantidade de títulos"
              ideal="Manter-se dentro do orçamento definido."
              status="Informativo; não há orçamento por título cadastrado."
              tone="info"
            />
            <KpiCard
              name="Maior recebimento"
              value={formatBRL(k.receita.maxSettled)}
              period={label}
              explanation="Maior valor efetivamente recebido em um título de receita do período."
              formula="Maior valor recebido por título"
              ideal="Acompanhar conforme a política de crédito e limites por cliente."
              status={
                k.receita.maxSettled > 0
                  ? "Referência de exposição; não há limite por cliente cadastrado."
                  : "Nenhum recebimento registrado no período."
              }
              tone="info"
            />
            <KpiCard
              name="Maior título em aberto"
              value={formatBRL(k.receita.maxOpen)}
              period={label}
              explanation="Maior saldo ainda não recebido em um título, vencido ou a vencer."
              formula="Maior saldo em aberto por título de receita"
              ideal="Dentro do limite de crédito aprovado para cada cliente."
              status={
                k.receita.maxOpen > 0
                  ? "Há exposição individual em aberto."
                  : "Sem saldo em aberto."
              }
              tone={k.receita.maxOpen > 0 ? "warning" : "success"}
            />
            <KpiCard
              name="Crescimento mensal"
              value={growth ? `${growth.value >= 0 ? "+" : ""}${formatPercent(growth.value)}` : "—"}
              period={label}
              explanation="Variação do valor original das receitas entre os dois meses fechados consecutivos mais recentes com dados no período."
              formula="(Receita do mês mais recente ÷ receita do mês anterior) − 1"
              interpretation={
                growth ? `${monthLabel(growth.from)} → ${monthLabel(growth.to)}` : undefined
              }
              ideal="Crescimento sustentável; comparar meses consecutivos."
              status={
                growth
                  ? growth.value > 0
                    ? "Positivo."
                    : growth.value < 0
                      ? "Negativo; investigar a queda."
                      : "Estável."
                  : "Sem dois meses fechados consecutivos com base de comparação."
              }
              tone={
                growth
                  ? growth.value > 0
                    ? "success"
                    : growth.value < 0
                      ? "danger"
                      : "info"
                  : "default"
              }
            />
            <KpiCard
              name="Relação receitas/despesas"
              value={
                k.despesa.original > 0
                  ? (k.receita.original / k.despesa.original).toFixed(2).replace(".", ",")
                  : "—"
              }
              period={label}
              explanation="Compara os valores originais faturados e as obrigações registradas no período; não representa saldo de caixa."
              formula="Valor original das receitas ÷ valor original das despesas"
              ideal="Igual ou superior a 1,00."
              status={
                k.despesa.original <= 0
                  ? "Sem despesas no período para comparação."
                  : k.receita.original >= k.despesa.original
                    ? "Receitas cobrem as despesas registradas."
                    : "Despesas superam as receitas registradas."
              }
              tone={
                k.despesa.original <= 0
                  ? "default"
                  : k.receita.original >= k.despesa.original
                    ? "success"
                    : "danger"
              }
            />
            <KpiCard
              name="% recebido"
              value={shareRecebido !== null ? formatPercent(shareRecebido) : "—"}
              period={label}
              explanation="Parcela do valor original dos títulos de receita do período que já foi recebida; inclui títulos ainda não vencidos."
              formula="Valor recebido ÷ valor original das receitas"
              ideal="100% após os vencimentos dos títulos."
              status={
                shareRecebido === null
                  ? "Sem receitas no período."
                  : shareRecebido >= 1
                    ? "Todo o valor original já foi recebido."
                    : "Realização parcial; considerar os vencimentos futuros antes de avaliar atraso."
              }
              tone={shareRecebido === null ? "default" : shareRecebido >= 1 ? "success" : "warning"}
            />
            <KpiCard
              name="% pago"
              value={sharePago !== null ? formatPercent(sharePago) : "—"}
              period={label}
              explanation="Parcela do valor original dos títulos de despesa do período que já foi paga; inclui títulos ainda não vencidos."
              formula="Valor pago ÷ valor original das despesas"
              ideal="100% até as datas de vencimento."
              status={
                sharePago === null
                  ? "Sem despesas no período."
                  : sharePago >= 1
                    ? "Todo o valor original já foi pago."
                    : "Realização parcial; verificar vencimentos e disponibilidade de caixa."
              }
              tone={sharePago === null ? "default" : sharePago >= 1 ? "success" : "warning"}
            />
            <KpiCard
              name="Inadimplência (receitas)"
              value={shareInadimplencia !== null ? formatPercent(shareInadimplencia) : "—"}
              period={label}
              explanation="Parcela do saldo total a receber que está vencida e continua em aberto."
              formula="Saldo vencido ÷ (saldo em aberto + saldo vencido)"
              ideal="0%."
              status={
                shareInadimplencia === null
                  ? "Sem saldo de receitas em aberto."
                  : shareInadimplencia === 0
                    ? "Nenhum saldo vencido."
                    : `${formatBRL(k.receita.overdue)} em atraso; priorizar cobrança.`
              }
              tone={shareInadimplencia === null || shareInadimplencia === 0 ? "success" : "danger"}
            />
            <KpiCard
              name="Atraso em despesas"
              value={shareAtrasoDespesas !== null ? formatPercent(shareAtrasoDespesas) : "—"}
              period={label}
              explanation="Parcela do saldo total a pagar que está vencida e continua em aberto."
              formula="Saldo vencido ÷ (saldo em aberto + saldo vencido)"
              ideal="0%."
              status={
                shareAtrasoDespesas === null
                  ? "Sem saldo de despesas em aberto."
                  : shareAtrasoDespesas === 0
                    ? "Nenhum saldo vencido."
                    : `${formatBRL(k.despesa.overdue)} em atraso; programar pagamento.`
              }
              tone={
                shareAtrasoDespesas === null || shareAtrasoDespesas === 0 ? "success" : "danger"
              }
            />
            <KpiCard
              name="Concentração top 5 (clientes)"
              value={clientes.length ? formatPercent(topShare(clientes, 5)) : "—"}
              period={label}
              explanation="Participação dos cinco maiores clientes no valor original das receitas."
              formula="Receitas dos 5 maiores clientes ÷ receitas totais"
              ideal="Carteira diversificada; referência de alerta acima de 60%."
              status={
                clientes.length === 0
                  ? "Sem clientes no período."
                  : topShare(clientes, 5) > 0.6
                    ? "Concentração elevada (referência indicativa: 60%)."
                    : "Abaixo da referência indicativa de 60%."
              }
              tone={topShare(clientes, 5) > 0.6 ? "warning" : "info"}
            />
            <KpiCard
              name="Concentração top 10 (clientes)"
              value={clientes.length ? formatPercent(topShare(clientes, 10)) : "—"}
              period={label}
              explanation="Participação dos dez maiores clientes no valor original das receitas."
              formula="Receitas dos 10 maiores clientes ÷ receitas totais"
              ideal="Menor concentração; definir limite de risco para a carteira."
              status="Informativo; não há limite de concentração top 10 cadastrado."
              tone="info"
            />
            <KpiCard
              name="Concentração top 5 (fornecedores)"
              value={fornecedores.length ? formatPercent(topShare(fornecedores, 5)) : "—"}
              period={label}
              explanation="Participação dos cinco maiores fornecedores no valor original das despesas."
              formula="Despesas dos 5 maiores fornecedores ÷ despesas totais"
              ideal="Carteira diversificada; referência de alerta acima de 60%."
              status={
                fornecedores.length === 0
                  ? "Sem fornecedores no período."
                  : topShare(fornecedores, 5) > 0.6
                    ? "Concentração elevada (referência indicativa: 60%)."
                    : "Abaixo da referência indicativa de 60%."
              }
              tone={topShare(fornecedores, 5) > 0.6 ? "warning" : "info"}
            />
            <KpiCard
              name="Clientes ativos"
              value={String(clientes.length)}
              period={label}
              explanation="Quantidade de clientes com pelo menos um título de receita válido no período."
              formula="Contagem de clientes distintos não cancelados"
              ideal="Carteira diversificada conforme a meta comercial."
              status="Informativo; não há meta de quantidade cadastrada."
              tone="info"
            />
            <KpiCard
              name="Fornecedores ativos"
              value={String(fornecedores.length)}
              period={label}
              explanation="Quantidade de fornecedores com pelo menos um título de despesa válido no período."
              formula="Contagem de fornecedores distintos não cancelados"
              ideal="Base de fornecedores compatível com a estratégia de compras."
              status="Informativo; não há meta de quantidade cadastrada."
              tone="info"
            />
            <KpiCard
              name="Prazo médio de recebimento (contratual)"
              value={prazoReceb !== null ? `${Math.round(prazoReceb)} dias` : "—"}
              period={label}
              explanation="Média simples de dias entre emissão e vencimento dos títulos de receita."
              formula="Média (vencimento − emissão)"
              ideal="Alinhado aos prazos comerciais definidos."
              status={
                prazoReceb === null
                  ? "Sem datas de emissão e vencimento suficientes."
                  : "Informativo; não há prazo-alvo cadastrado."
              }
              tone="info"
            />
            <KpiCard
              name="Prazo médio de pagamento (contratual)"
              value={prazoPag !== null ? `${Math.round(prazoPag)} dias` : "—"}
              period={label}
              explanation="Média simples de dias entre emissão e vencimento dos títulos de despesa."
              formula="Média (vencimento − emissão)"
              ideal="Alinhado aos prazos contratados com fornecedores."
              status={
                prazoPag === null
                  ? "Sem datas de emissão e vencimento suficientes."
                  : "Informativo; não há prazo-alvo cadastrado."
              }
              tone="info"
            />
            <KpiCard
              name="Tempo médio até receber"
              value={dso.value !== null ? `${Math.round(dso.value)} dias` : "—"}
              period={label}
              explanation="Média simples de dias entre emissão e pagamento dos títulos de receita liquidados; não é o DSO contábil por saldo médio."
              formula="Média (data de recebimento − emissão), apenas com data de pagamento"
              ideal="Até o prazo médio contratual de recebimento."
              status={
                dso.value === null
                  ? "Sem títulos liquidados com datas de emissão e pagamento."
                  : prazoReceb === null
                    ? `Base: ${dso.sample} títulos; sem prazo contratual para comparar.`
                    : dso.value <= prazoReceb
                      ? `Dentro do prazo médio (${dso.sample} títulos na base).`
                      : `Acima do prazo médio contratual (${dso.sample} títulos na base).`
              }
              tone={
                dso.value === null || prazoReceb === null
                  ? "info"
                  : dso.value <= prazoReceb
                    ? "success"
                    : "warning"
              }
            />
            <KpiCard
              name="Tempo médio até pagar"
              value={dpo.value !== null ? `${Math.round(dpo.value)} dias` : "—"}
              period={label}
              explanation="Média simples de dias entre emissão e pagamento dos títulos de despesa liquidados; não é o DPO contábil por saldo médio."
              formula="Média (data de pagamento − emissão), apenas com data de pagamento"
              ideal="Pagar até o vencimento, conforme o fluxo de caixa."
              status={
                dpo.value === null
                  ? "Sem títulos liquidados com datas de emissão e pagamento."
                  : prazoPag === null
                    ? `Base: ${dpo.sample} títulos; sem prazo contratual para comparar.`
                    : dpo.value <= prazoPag
                      ? `Dentro do prazo médio (${dpo.sample} títulos na base).`
                      : `Acima do prazo médio contratual (${dpo.sample} títulos na base).`
              }
              tone={
                dpo.value === null || prazoPag === null
                  ? "info"
                  : dpo.value <= prazoPag
                    ? "success"
                    : "warning"
              }
            />
          </div>

          <SectionCard
            title="Projeção determinística de fluxo"
            description="Baseada exclusivamente nos títulos em aberto importados"
          >
            <FlowTable rows={forecast} showPeriod />
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard
              title="A receber por vencimento"
              description="Títulos em aberto ainda a vencer"
            >
              <AgingTable rows={agingReceberFut} />
            </SectionCard>
            <SectionCard title="Receber vencido (aging)" description="Dias de atraso">
              <AgingTable rows={agingReceberVenc} />
            </SectionCard>
            <SectionCard
              title="A pagar por vencimento"
              description="Títulos em aberto ainda a vencer"
            >
              <AgingTable rows={agingPagarFut} />
            </SectionCard>
            <SectionCard title="Pagar vencido (aging)" description="Dias de atraso">
              <AgingTable rows={agingPagarVenc} />
            </SectionCard>
          </div>

          <SectionCard
            title="Pressão financeira"
            description="Datas com maior concentração de pagamentos em aberto"
          >
            {pressure.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum pagamento futuro em aberto.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[620px] text-sm">
                  <thead className="border-b border-border">
                    <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2">Data</th>
                      <th className="py-2 text-right">A pagar</th>
                      <th className="py-2 text-right">A receber</th>
                      <th className="py-2 text-right">Títulos</th>
                      <th className="py-2 text-right">Líquido</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pressure.map((p) => (
                      <tr key={p.date} className="border-b border-border/60 last:border-0">
                        <td className="num py-2">{p.date.split("-").reverse().join("/")}</td>
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

          <SectionCard title="Clientes" description="Ranking por faturamento no período">
            <PartyTable rows={clientes} settledLabel="Recebido" />
          </SectionCard>

          <SectionCard title="Fornecedores" description="Ranking por despesas no período">
            <PartyTable rows={fornecedores} settledLabel="Pago" />
          </SectionCard>
        </div>
      )}
    </AppLayout>
  );
}

function AgingTable({ rows }: { rows: AgingBucket[] }) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  if (total <= 0)
    return <p className="text-sm text-muted-foreground">Sem saldo em aberto nesta faixa.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-border">
        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-2">Faixa</th>
          <th className="py-2 text-right">Títulos</th>
          <th className="py-2 text-right">Valor</th>
          <th className="py-2 text-right">Part.</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.label} className="border-b border-border/60 last:border-0">
            <td className="py-2">{r.label}</td>
            <td className="num py-2 text-right">{r.count}</td>
            <td className="num py-2 text-right">{formatBRL(r.amount)}</td>
            <td className="num py-2 text-right text-muted-foreground">
              {formatPercent(r.amount / total)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PartyTable({ rows, settledLabel }: { rows: PartyRow[]; settledLabel: string }) {
  if (rows.length === 0)
    return <p className="text-sm text-muted-foreground">Sem registros no período.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead className="border-b border-border">
          <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="py-2">Nome</th>
            <th className="py-2 text-right">Total</th>
            <th className="py-2 text-right">{settledLabel}</th>
            <th className="py-2 text-right">Em aberto</th>
            <th className="py-2 text-right">Vencido</th>
            <th className="py-2 text-right">Docs</th>
            <th className="py-2 text-right">Part.</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 50).map((r) => (
            <tr key={r.name} className="border-b border-border/60 last:border-0">
              <td className="max-w-[320px] truncate py-2" title={r.name}>
                {r.name}
              </td>
              <td className="num py-2 text-right">{formatBRL(r.total)}</td>
              <td className="num py-2 text-right text-success">{formatBRL(r.settled)}</td>
              <td className="num py-2 text-right text-warning">{formatBRL(r.open)}</td>
              <td className="num py-2 text-right text-destructive">{formatBRL(r.overdue)}</td>
              <td className="num py-2 text-right">{r.count}</td>
              <td className="num py-2 text-right">{formatPercent(r.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
