import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { SectionCard } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { useReceivableEmailEvents } from "@/hooks/useReceivableEmailEvents";
import { useBillingSession } from "@/lib/billing-session";
import {
  ACTION_LABEL,
  buildCollectionRows,
  clientReport,
  downloadCsv,
  periodReport,
  titleReport,
  toCsv,
  type ActionType,
} from "@/lib/collection-reports";
import { formatBRL, formatDate, formatPercent, todayISO } from "@/lib/finance";
import { usePeriod } from "@/lib/period";
import { cn } from "@/lib/utils";

type Tab = "titulo" | "cliente" | "periodo" | "registro";

const TABS: { id: Tab; label: string }[] = [
  { id: "titulo", label: "Por título" },
  { id: "cliente", label: "Por cliente" },
  { id: "periodo", label: "Por período" },
  { id: "registro", label: "Cada envio" },
];

export function CollectionReports() {
  const { authenticated } = useBillingSession();
  const { range, label } = usePeriod();
  const { data: movements } = useMovements();
  const { data: history, isLoading, error } = useReceivableEmailEvents(range, authenticated);
  const [tab, setTab] = useState<Tab>("titulo");
  const [action, setAction] = useState<"" | ActionType>("");
  const [granularity, setGranularity] = useState<"month" | "week">("month");
  const today = todayISO();

  const allRows = useMemo(() => buildCollectionRows(history), [history]);
  const rows = useMemo(() => allRows.filter((r) => !action || r.action === action), [allRows, action]);
  const titles = useMemo(() => titleReport(rows, movements ?? [], today), [rows, movements, today]);
  const clients = useMemo(() => clientReport(titles, movements ?? []), [titles, movements]);
  const periods = useMemo(() => periodReport(rows, granularity), [rows, granularity]);

  const totals = useMemo(() => {
    const billed = titles.reduce((s, t) => s + t.amount, 0);
    const recoveredTitles = titles.filter((t) => t.state === "Recebido");
    const recovered = recoveredTitles.reduce((s, t) => s + t.amount, 0);
    const open = titles.reduce((s, t) => s + t.open, 0);
    return { billed, recovered, open, recoveredCount: recoveredTitles.length };
  }, [titles]);

  function exportCsv() {
    const stamp = today;
    if (tab === "titulo")
      downloadCsv(`cobranca-por-titulo-${stamp}.csv`, toCsv(
        ["Documento", "Cliente", "Valor", "Vencimento", "Ações", "Avisos", "Cobranças", "Boletos", "Primeira ação", "Última ação", "Situação atual", "Data de recebimento", "Saldo em aberto", "Dias da última ação até o recebimento"],
        titles.map((t) => [t.document, t.client, t.amount, formatDate(t.dueDate), t.actions, t.warnings, t.collections, t.boletos, formatDate(t.firstAction), formatDate(t.lastAction), t.state, formatDate(t.paymentDate), t.open, t.daysToPay]),
      ));
    else if (tab === "cliente")
      downloadCsv(`cobranca-por-cliente-${stamp}.csv`, toCsv(
        ["Cliente", "Títulos acionados", "Ações", "Valor acionado", "Em aberto", "Recuperado", "Taxa de recuperação", "Prazo médio até receber (dias)"],
        clients.map((c) => [c.client, c.titles, c.actions, c.billed, c.open, c.recovered, formatPercent(c.recoveryRate), c.avgDaysToPay]),
      ));
    else if (tab === "periodo")
      downloadCsv(`cobranca-por-periodo-${stamp}.csv`, toCsv(
        ["Período", "Avisos de vencimento", "Cobranças de vencido", "Boletos enviados", "Títulos acionados", "Valor acionado"],
        periods.map((p) => [p.label, p.avisos, p.cobrancas, p.boletos, p.titles, p.amount]),
      ));
    else
      downloadCsv(`cobranca-envios-${stamp}.csv`, toCsv(
        ["Data do envio", "Ação", "Cliente", "Destinatário", "Documento", "Valor", "Vencimento", "Dias em atraso"],
        rows.map((r) => [new Date(r.sentAt).toLocaleString("pt-BR"), ACTION_LABEL[r.action], r.client, r.recipient, r.document, r.amount, formatDate(r.dueDate), r.daysOverdue]),
      ));
  }

  return (
    <SectionCard
      title="Relatórios de cobrança"
      description={`Ações de cobrança realizadas por título, cliente e período — ${label}. A situação atual vem de Contas a Receber e reflete suas edições.`}
    >
      {!authenticated ? (
        <p className="text-sm text-muted-foreground">
          Entre pelo controle “Acesso de cobrança” no cabeçalho para consultar os relatórios.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando ações de cobrança…</p>
      ) : error ? (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Kpi label="Ações realizadas" value={String(rows.length)} />
            <Kpi label="Títulos acionados" value={String(titles.length)} />
            <Kpi label="Valor acionado" value={formatBRL(totals.billed)} />
            <Kpi
              label="Já recebido"
              value={formatBRL(totals.recovered)}
              hint={`${totals.recoveredCount} títulos · ${formatPercent(totals.billed ? totals.recovered / totals.billed : 0)}`}
              tone="text-success"
            />
            <Kpi label="Ainda em aberto" value={formatBRL(totals.open)} tone="text-warning" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div role="tablist" className="flex gap-1 rounded-md bg-muted p-1">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "rounded px-3 py-1.5 text-sm",
                    tab === t.id ? "bg-card font-medium shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as typeof action)}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm"
              aria-label="Filtrar por tipo de ação"
            >
              <option value="">Todas as ações</option>
              {(Object.keys(ACTION_LABEL) as ActionType[]).map((a) => (
                <option key={a} value={a}>
                  {ACTION_LABEL[a]}
                </option>
              ))}
            </select>
            {tab === "periodo" && (
              <select
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as typeof granularity)}
                className="rounded-md border border-input bg-card px-3 py-2 text-sm"
              >
                <option value="month">Agrupar por mês</option>
                <option value="week">Agrupar por semana</option>
              </select>
            )}
            <button
              onClick={exportCsv}
              disabled={!rows.length}
              className="ml-auto inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <Download className="size-4" /> Exportar CSV
            </button>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma ação de cobrança registrada neste período.
            </p>
          ) : (
            <div className="max-h-[520px] overflow-auto rounded-md border border-border">
              {tab === "titulo" && <TitleTable titles={titles} />}
              {tab === "cliente" && <ClientTable clients={clients} />}
              {tab === "periodo" && <PeriodTable periods={periods} />}
              {tab === "registro" && <EventTable rows={rows} />}
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}

const th = "sticky top-0 bg-muted px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const td = "px-3 py-2 whitespace-nowrap border-t border-border/60";

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("num mt-1 text-lg font-semibold", tone)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function TitleTable({ titles }: { titles: ReturnType<typeof titleReport> }) {
  return (
    <table className="w-full min-w-[1000px] text-sm">
      <thead>
        <tr>
          {["Documento", "Cliente", "Valor", "Vencimento", "Ações", "Primeira", "Última", "Situação", "Recebimento", "Em aberto", "Dias até receber"].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {titles.map((t) => (
          <tr key={t.key}>
            <td className={`${td} num`}>{t.document}</td>
            <td className={`${td} max-w-[240px] truncate`} title={t.client}>{t.client}</td>
            <td className={`${td} num`}>{formatBRL(t.amount)}</td>
            <td className={`${td} num`}>{formatDate(t.dueDate)}</td>
            <td className={td} title={`${t.warnings} aviso(s) · ${t.collections} cobrança(s) · ${t.boletos} boleto(s)`}>
              {t.actions} ({t.warnings}/{t.collections}/{t.boletos})
            </td>
            <td className={`${td} num`}>{formatDate(t.firstAction)}</td>
            <td className={`${td} num`}>{formatDate(t.lastAction)}</td>
            <td className={td}>{t.state}</td>
            <td className={`${td} num`}>{formatDate(t.paymentDate) || "—"}</td>
            <td className={`${td} num`}>{formatBRL(t.open)}</td>
            <td className={`${td} num`}>{t.daysToPay ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ClientTable({ clients }: { clients: ReturnType<typeof clientReport> }) {
  return (
    <table className="w-full min-w-[800px] text-sm">
      <thead>
        <tr>
          {["Cliente", "Títulos", "Ações", "Valor acionado", "Em aberto", "Recuperado", "Taxa", "Prazo médio (dias)"].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {clients.map((c) => (
          <tr key={c.client}>
            <td className={`${td} max-w-[300px] truncate`} title={c.client}>{c.client}</td>
            <td className={`${td} num`}>{c.titles}</td>
            <td className={`${td} num`}>{c.actions}</td>
            <td className={`${td} num`}>{formatBRL(c.billed)}</td>
            <td className={`${td} num`}>{formatBRL(c.open)}</td>
            <td className={`${td} num`}>{formatBRL(c.recovered)}</td>
            <td className={`${td} num`}>{formatPercent(c.recoveryRate)}</td>
            <td className={`${td} num`}>{c.avgDaysToPay ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PeriodTable({ periods }: { periods: ReturnType<typeof periodReport> }) {
  return (
    <table className="w-full min-w-[700px] text-sm">
      <thead>
        <tr>
          {["Período", "Avisos", "Cobranças", "Boletos", "Títulos acionados", "Valor acionado"].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {periods.map((p) => (
          <tr key={p.period}>
            <td className={td}>{p.label}</td>
            <td className={`${td} num`}>{p.avisos}</td>
            <td className={`${td} num`}>{p.cobrancas}</td>
            <td className={`${td} num`}>{p.boletos}</td>
            <td className={`${td} num`}>{p.titles}</td>
            <td className={`${td} num`}>{formatBRL(p.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventTable({ rows }: { rows: ReturnType<typeof buildCollectionRows> }) {
  return (
    <table className="w-full min-w-[950px] text-sm">
      <thead>
        <tr>
          {["Data do envio", "Ação", "Cliente", "Destinatário", "Documento", "Valor", "Vencimento", "Dias em atraso"].map((h) => (
            <th key={h} className={th}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td className={td}>{new Date(r.sentAt).toLocaleString("pt-BR")}</td>
            <td className={td}>{ACTION_LABEL[r.action]}</td>
            <td className={`${td} max-w-[240px] truncate`} title={r.client}>{r.client}</td>
            <td className={td}>{r.recipient ?? "—"}</td>
            <td className={`${td} num`}>{r.document ?? "—"}</td>
            <td className={`${td} num`}>{r.amount === null ? "—" : formatBRL(r.amount)}</td>
            <td className={`${td} num`}>{formatDate(r.dueDate) || "—"}</td>
            <td className={`${td} num`}>{r.daysOverdue ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
