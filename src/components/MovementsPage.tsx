import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { usePeriod } from "@/lib/period";
import {
  DESPESA_STATUS,
  RECEITA_STATUS,
  STATUS_LABEL,
  formatBRL,
  formatDate,
  totalize,
  type Movement,
  type MovementType,
} from "@/lib/finance";
import { cn } from "@/lib/utils";
import { ArrowUpDown } from "lucide-react";

type SortKey =
  | "document"
  | "counterparty"
  | "issue_date"
  | "due_date"
  | "original_amount"
  | "paid_amount"
  | "open_amount"
  | "status";

export function MovementsPage({ type }: { type: MovementType }) {
  const isReceita = type === "RECEITA";
  const { data, isLoading } = useMovements();
  const { filter } = usePeriod();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [party, setParty] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [asc, setAsc] = useState(true);

  const base = useMemo(
    () => (data ?? []).filter((m) => m.type === type),
    [data, type],
  );

  const parties = useMemo(
    () =>
      Array.from(new Set(base.map((m) => m.counterparty ?? "").filter(Boolean))).sort(),
    [base],
  );

  const rows = useMemo(() => {
    let out = filter(base);
    if (status) out = out.filter((m) => m.status === status);
    if (party) out = out.filter((m) => m.counterparty === party);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (m) =>
          (m.counterparty ?? "").toLowerCase().includes(q) ||
          (m.document ?? "").toLowerCase().includes(q) ||
          (m.description ?? "").toLowerCase().includes(q),
      );
    }
    const sorted = [...out].sort((a, b) => {
      const va = a[sortKey] ?? "";
      const vb = b[sortKey] ?? "";
      if (typeof va === "number" && typeof vb === "number") return va - vb;
      return String(va).localeCompare(String(vb), "pt-BR");
    });
    return asc ? sorted : sorted.reverse();
  }, [base, filter, status, party, search, sortKey, asc]);

  const totals = totalize(rows);
  const statuses = isReceita ? RECEITA_STATUS : DESPESA_STATUS;

  const sortBtn = (key: SortKey, label: string, right = false) => (
    <button
      onClick={() => {
        if (sortKey === key) setAsc(!asc);
        else {
          setSortKey(key);
          setAsc(true);
        }
      }}
      className={cn(
        "flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground",
        right && "ml-auto",
      )}
    >
      {label}
      <ArrowUpDown className="size-3 opacity-50" />
    </button>
  );

  return (
    <AppLayout
      title={isReceita ? "Contas a Receber" : "Contas a Pagar"}
      subtitle={isReceita ? "Receitas importadas do Bling" : "Despesas importadas do Bling"}
      actions={<PeriodFilter />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : base.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniTotal label="Registros" value={String(totals.count)} />
            <MiniTotal label="Valor" value={formatBRL(totals.total)} />
            <MiniTotal
              label={isReceita ? "Recebido" : "Pago"}
              value={formatBRL(totals.settled)}
              tone="text-success"
            />
            <MiniTotal
              label="Saldo em aberto"
              value={formatBRL(totals.open)}
              tone="text-warning"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar documento, histórico ou nome"
              className="min-w-56 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Todos os status</option>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABEL[s]}
                </option>
              ))}
            </select>
            <select
              value={party}
              onChange={(e) => setParty(e.target.value)}
              className="max-w-64 rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">
                {isReceita ? "Todos os clientes" : "Todos os fornecedores"}
              </option>
              {parties.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left">{sortBtn("document", "Documento")}</th>
                  <th className="px-3 py-2 text-left">
                    {sortBtn("counterparty", isReceita ? "Cliente" : "Fornecedor")}
                  </th>
                  <th className="px-3 py-2 text-left">{sortBtn("issue_date", "Emissão")}</th>
                  <th className="px-3 py-2 text-left">{sortBtn("due_date", "Vencimento")}</th>
                  <th className="px-3 py-2 text-left">Pagamento</th>
                  <th className="px-3 py-2 text-right">{sortBtn("original_amount", "Valor", true)}</th>
                  <th className="px-3 py-2 text-right">
                    {sortBtn("paid_amount", isReceita ? "Recebido" : "Pago", true)}
                  </th>
                  <th className="px-3 py-2 text-right">{sortBtn("open_amount", "Saldo", true)}</th>
                  <th className="px-3 py-2 text-left">{sortBtn("status", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((m) => (
                  <Row key={m.id} m={m} />
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/40 font-medium">
                <tr>
                  <td className="px-3 py-2" colSpan={5}>
                    {rows.length} registros
                    {rows.length > 500 && " (exibindo os 500 primeiros)"}
                  </td>
                  <td className="num px-3 py-2 text-right">{formatBRL(totals.total)}</td>
                  <td className="num px-3 py-2 text-right">{formatBRL(totals.settled)}</td>
                  <td className="num px-3 py-2 text-right">{formatBRL(totals.open)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </AppLayout>
  );
}

function Row({ m }: { m: Movement }) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/40">
      <td className="num px-3 py-2 whitespace-nowrap">{m.document ?? ""}</td>
      <td className="max-w-[280px] truncate px-3 py-2" title={m.counterparty ?? ""}>
        {m.counterparty ?? ""}
      </td>
      <td className="num px-3 py-2 whitespace-nowrap">{formatDate(m.issue_date)}</td>
      <td className="num px-3 py-2 whitespace-nowrap">{formatDate(m.due_date)}</td>
      <td className="num px-3 py-2 whitespace-nowrap">{formatDate(m.payment_date)}</td>
      <td className="num px-3 py-2 text-right whitespace-nowrap">
        {formatBRL(m.original_amount)}
      </td>
      <td className="num px-3 py-2 text-right whitespace-nowrap">
        {formatBRL(m.paid_amount)}
      </td>
      <td className="num px-3 py-2 text-right whitespace-nowrap">
        {formatBRL(m.open_amount)}
      </td>
      <td className="px-3 py-2">
        <StatusBadge status={m.status} />
      </td>
    </tr>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "RECEBIDO" || status === "PAGO"
      ? "bg-success/12 text-success"
      : status === "ATRASADO"
        ? "bg-destructive/12 text-destructive"
        : status.startsWith("PARCIAL")
          ? "bg-info/12 text-info"
          : "bg-warning/15 text-warning";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone,
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function MiniTotal({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("num mt-1 text-lg font-semibold", tone)}>{value}</div>
    </div>
  );
}
