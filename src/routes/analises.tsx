import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState, SectionCard, StatCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { usePeriod } from "@/lib/period";
import { formatBRL, formatPercent, monthKey, monthLabel, type Movement } from "@/lib/finance";
import {
  aging,
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
    if (!m.issue_date || !m.due_date) continue;
    const diff = (Date.parse(m.due_date) - Date.parse(m.issue_date)) / 86_400_000;
    if (isFinite(diff)) vals.push(diff);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function avgSettleDays(rows: Movement[]): number | null {
  const vals: number[] = [];
  for (const m of rows) {
    if (!m.payment_date || !m.issue_date) continue;
    const diff = (Date.parse(m.payment_date) - Date.parse(m.issue_date)) / 86_400_000;
    if (isFinite(diff) && diff >= 0) vals.push(diff);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function Analises() {
  const { data, isLoading } = useMovements();
  const { filter, label } = usePeriod();
  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(() => filter(all), [all, filter]);

  const receitas = useMemo(() => rows.filter((m) => m.type === "RECEITA"), [rows]);
  const despesas = useMemo(() => rows.filter((m) => m.type === "DESPESA"), [rows]);
  const k = useMemo(() => periodKpis(rows), [rows]);

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
    for (const m of receitas) {
      const key = monthKey(m.due_date);
      if (!key) continue;
      map.set(key, (map.get(key) ?? 0) + (Number(m.original_amount) || 0));
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [receitas]);

  const growth = useMemo(() => {
    if (monthlyRevenue.length < 2) return null;
    const last = monthlyRevenue[monthlyRevenue.length - 1]!;
    const prev = monthlyRevenue[monthlyRevenue.length - 2]!;
    if (!prev[1]) return null;
    return { value: (last[1] - prev[1]) / prev[1], from: prev[0], to: last[0] };
  }, [monthlyRevenue]);

  const prazoReceb = avgDays(receitas);
  const prazoPag = avgDays(despesas);
  const dso = avgSettleDays(receitas);
  const dpo = avgSettleDays(despesas);

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
            <StatCard label="Ticket médio (receitas)" value={k.receita.count ? formatBRL(k.receita.avgTicket) : "—"} />
            <StatCard label="Ticket médio (despesas)" value={k.despesa.count ? formatBRL(k.despesa.avgTicket) : "—"} />
            <StatCard label="Maior recebimento" value={formatBRL(k.receita.maxSettled)} tone="success" />
            <StatCard label="Maior título em aberto" value={formatBRL(k.receita.maxOpen)} tone="warning" />
            <StatCard
              label="Crescimento mensal"
              value={growth ? `${growth.value >= 0 ? "+" : ""}${formatPercent(growth.value)}` : "—"}
              hint={growth ? `${monthLabel(growth.from)} → ${monthLabel(growth.to)}` : "Dados insuficientes"}
              tone={growth ? (growth.value >= 0 ? "success" : "danger") : "default"}
            />
            <StatCard
              label="Relação receitas/despesas"
              value={
                k.despesa.original > 0
                  ? (k.receita.original / k.despesa.original).toFixed(2).replace(".", ",")
                  : "—"
              }
            />
            <StatCard
              label="% recebido"
              value={k.receita.original ? formatPercent(k.receita.settled / k.receita.original) : "—"}
              tone="success"
            />
            <StatCard
              label="% pago"
              value={k.despesa.original ? formatPercent(k.despesa.settled / k.despesa.original) : "—"}
              tone="success"
            />
            <StatCard
              label="Inadimplência (receitas)"
              value={k.receita.original ? formatPercent(k.receita.overdue / k.receita.original) : "—"}
              tone="danger"
            />
            <StatCard
              label="Atraso em despesas"
              value={k.despesa.original ? formatPercent(k.despesa.overdue / k.despesa.original) : "—"}
              tone="danger"
            />
            <StatCard label="Concentração top 5 (clientes)" value={formatPercent(topShare(clientes, 5))} />
            <StatCard label="Concentração top 10 (clientes)" value={formatPercent(topShare(clientes, 10))} />
            <StatCard label="Concentração top 5 (fornecedores)" value={formatPercent(topShare(fornecedores, 5))} />
            <StatCard label="Clientes ativos" value={String(clientes.length)} />
            <StatCard label="Fornecedores ativos" value={String(fornecedores.length)} />
            <StatCard
              label="Prazo médio de recebimento"
              value={prazoReceb !== null ? `${Math.round(prazoReceb)} dias` : "—"}
              hint="Emissão até vencimento"
            />
            <StatCard
              label="Prazo médio de pagamento"
              value={prazoPag !== null ? `${Math.round(prazoPag)} dias` : "—"}
              hint="Emissão até vencimento"
            />
            <StatCard
              label="DSO realizado"
              value={dso !== null ? `${Math.round(dso)} dias` : "—"}
              hint="Emissão até recebimento"
            />
            <StatCard
              label="DPO realizado"
              value={dpo !== null ? `${Math.round(dpo)} dias` : "—"}
              hint="Emissão até pagamento"
            />
          </div>

          <SectionCard
            title="Projeção determinística de fluxo"
            description="Baseada exclusivamente nos títulos em aberto importados"
          >
            <FlowTable rows={forecast} showPeriod />
          </SectionCard>

          <div className="grid gap-4 xl:grid-cols-2">
            <SectionCard title="A receber por vencimento" description="Títulos em aberto ainda a vencer">
              <AgingTable rows={agingReceberFut} />
            </SectionCard>
            <SectionCard title="Receber vencido (aging)" description="Dias de atraso">
              <AgingTable rows={agingReceberVenc} />
            </SectionCard>
            <SectionCard title="A pagar por vencimento" description="Títulos em aberto ainda a vencer">
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
