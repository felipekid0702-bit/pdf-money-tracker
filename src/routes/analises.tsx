import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState, SectionCard, StatCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { usePeriod } from "@/lib/period";
import {
  formatBRL,
  formatPercent,
  monthKey,
  monthLabel,
  todayISO,
  totalize,
  type Movement,
  type MovementType,
} from "@/lib/finance";
import { forecastWindows } from "./index";

export const Route = createFileRoute("/analises")({
  head: () => ({
    meta: [
      { title: "Análises financeiras | FP Financeiro" },
      {
        name: "description",
        content:
          "Rankings de clientes e fornecedores, indicadores financeiros e previsão de fluxo da FP Solução em Altura.",
      },
      { property: "og:title", content: "Análises financeiras | FP Financeiro" },
      {
        property: "og:description",
        content: "Clientes, fornecedores, indicadores e previsões por período.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Analises,
});

interface PartyRow {
  name: string;
  total: number;
  settled: number;
  open: number;
  overdue: number;
  count: number;
}

function rankParties(rows: Movement[], type: MovementType): PartyRow[] {
  const today = todayISO();
  const map = new Map<string, PartyRow>();
  for (const m of rows) {
    if (m.type !== type) continue;
    const name = m.counterparty?.trim() || "(sem identificação)";
    const cur =
      map.get(name) ?? { name, total: 0, settled: 0, open: 0, overdue: 0, count: 0 };
    cur.total += m.original_amount;
    cur.settled += m.paid_amount;
    cur.open += m.open_amount;
    if (m.open_amount > 0 && m.due_date && m.due_date < today)
      cur.overdue += m.open_amount;
    cur.count += 1;
    map.set(name, cur);
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

function avgDays(rows: Movement[]): number | null {
  const vals: number[] = [];
  for (const m of rows) {
    if (!m.issue_date || !m.due_date) continue;
    const diff =
      (Date.parse(m.due_date) - Date.parse(m.issue_date)) / 86_400_000;
    if (isFinite(diff)) vals.push(diff);
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function Analises() {
  const { data, isLoading } = useMovements();
  const { filter } = usePeriod();
  const all = data ?? [];
  const rows = useMemo(() => filter(all), [all, filter]);

  const receitas = rows.filter((m) => m.type === "RECEITA");
  const despesas = rows.filter((m) => m.type === "DESPESA");
  const tr = totalize(receitas);
  const td = totalize(despesas);

  const clientes = useMemo(() => rankParties(rows, "RECEITA"), [rows]);
  const fornecedores = useMemo(() => rankParties(rows, "DESPESA"), [rows]);
  const forecast = useMemo(() => forecastWindows(all), [all]);

  const monthlyRevenue = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of receitas) {
      const k = monthKey(m.due_date);
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + m.original_amount);
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

  const top5Share =
    tr.total > 0
      ? clientes.slice(0, 5).reduce((s, c) => s + c.total, 0) / tr.total
      : null;
  const top5ShareExp =
    td.total > 0
      ? fornecedores.slice(0, 5).reduce((s, c) => s + c.total, 0) / td.total
      : null;

  const prazoReceb = avgDays(receitas);
  const prazoPag = avgDays(despesas);

  return (
    <AppLayout
      title="Análises"
      subtitle="Clientes, fornecedores, indicadores e previsões"
      actions={<PeriodFilter />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : all.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Ticket médio (receitas)"
              value={tr.count ? formatBRL(tr.total / tr.count) : "—"}
            />
            <StatCard
              label="Ticket médio (despesas)"
              value={td.count ? formatBRL(td.total / td.count) : "—"}
            />
            <StatCard
              label="Crescimento mensal"
              value={
                growth
                  ? `${growth.value >= 0 ? "+" : ""}${formatPercent(growth.value)}`
                  : "—"
              }
              hint={
                growth
                  ? `${monthLabel(growth.from)} → ${monthLabel(growth.to)}`
                  : "Dados insuficientes"
              }
              tone={growth ? (growth.value >= 0 ? "success" : "danger") : "default"}
            />
            <StatCard
              label="Relação receitas/despesas"
              value={td.total > 0 ? (tr.total / td.total).toFixed(2).replace(".", ",") : "—"}
            />
            <StatCard
              label="% recebido"
              value={tr.total ? formatPercent(tr.settled / tr.total) : "—"}
              tone="success"
            />
            <StatCard
              label="% em aberto (receitas)"
              value={tr.total ? formatPercent(tr.open / tr.total) : "—"}
              tone="warning"
            />
            <StatCard
              label="% vencido (receitas)"
              value={tr.total ? formatPercent(tr.overdue / tr.total) : "—"}
              tone="danger"
            />
            <StatCard
              label="% pago"
              value={td.total ? formatPercent(td.settled / td.total) : "—"}
              tone="success"
            />
            <StatCard
              label="Concentração de receita (top 5)"
              value={top5Share !== null ? formatPercent(top5Share) : "—"}
            />
            <StatCard
              label="Concentração de despesas (top 5)"
              value={top5ShareExp !== null ? formatPercent(top5ShareExp) : "—"}
            />
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
          </div>

          <SectionCard
            title="Previsão de fluxo"
            description="Baseada exclusivamente nos lançamentos em aberto"
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="border-b border-border">
                  <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2">Janela</th>
                    <th className="py-2 text-right">Recebimentos</th>
                    <th className="py-2 text-right">Pagamentos</th>
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

          <SectionCard title="Clientes" description="Ranking por faturamento no período">
            <PartyTable rows={clientes} total={tr.total} settledLabel="Recebido" showShare />
          </SectionCard>

          <SectionCard title="Fornecedores" description="Ranking por despesas no período">
            <PartyTable rows={fornecedores} total={td.total} settledLabel="Pago" />
          </SectionCard>
        </div>
      )}
    </AppLayout>
  );
}

function PartyTable({
  rows,
  total,
  settledLabel,
  showShare,
}: {
  rows: PartyRow[];
  total: number;
  settledLabel: string;
  showShare?: boolean;
}) {
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
            {showShare && <th className="py-2 text-right">Part.</th>}
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
              {showShare && (
                <td className="num py-2 text-right">
                  {total > 0 ? formatPercent(r.total / total) : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
