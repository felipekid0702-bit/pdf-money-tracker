import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { EmptyState } from "@/components/StatCard";
import { useMovements } from "@/hooks/useMovements";
import { useReceivableEmailEvents } from "@/hooks/useReceivableEmailEvents";
import { usePeriod } from "@/lib/period";
import {
  FIN_STATE_OPTIONS,
  finState,
  finStatusLabel,
  openOf,
  paidOf,
  originalOf,
  sideKpis,
  type FinState,
} from "@/lib/analytics";
import {
  formatBRL,
  formatDate,
  todayISO,
  type Movement,
  type MovementType,
  type ReceivableEmailEvent,
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
  const { filter, label } = usePeriod();
  const {
    data: receivableEvents = [],
    error: receivableEventsError,
    isLoading: receivableEventsLoading,
  } = useReceivableEmailEvents({ from: null, to: null }, isReceita);
  const today = todayISO();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"" | FinState>("");
  const [party, setParty] = useState("");
  const [minValue, setMinValue] = useState("");
  const [maxValue, setMaxValue] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("due_date");
  const [asc, setAsc] = useState(true);

  const base = useMemo(() => (data ?? []).filter((m) => m.type === type), [data, type]);

  const parties = useMemo(
    () =>
      Array.from(new Set(base.map((m) => m.counterparty ?? "").filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR"),
      ),
    [base],
  );

  const boletoTooltipByMovementId = useMemo(() => {
    const result = new Map<string, string>();
    if (!isReceita) return result;

    for (const movement of base) {
      const movementDocument = movement.document;
      if (!movementDocument) continue;
      const matchingEvents = receivableEvents.filter(
        (event) =>
          event.action_type === "boleto_enviado" && matchesBoletoEvent(event, movement, base),
      );
      if (!matchingEvents.length) continue;
      const info = matchingEvents
        .sort((a, b) => b.sent_at.localeCompare(a.sent_at))
        .map((event) => {
          const details = parseEventDetails(event.title_details);
          const detail = details.find(
            (candidate) =>
              candidate.document && documentsMatch(candidate.document, movementDocument),
          );
          const date = new Date(event.sent_at).toLocaleString("pt-BR");
          const files = [detail?.boleto_file, detail?.nf_file, detail?.xml_file]
            .filter(Boolean)
            .join(" · ");
          return [
            `Boleto enviado em ${date}`,
            event.recipient_email ? `Destinatário: ${event.recipient_email}` : null,
            files ? `Arquivos: ${files}` : null,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
      result.set(movement.id, info);
    }
    return result;
  }, [base, receivableEvents, isReceita]);

  const rows = useMemo(() => {
    let out = filter(base);
    if (state) out = out.filter((m) => finState(m, today) === state);
    if (party) out = out.filter((m) => m.counterparty === party);
    const min = minValue ? Number(minValue.replace(",", ".")) : null;
    const max = maxValue ? Number(maxValue.replace(",", ".")) : null;
    if (min !== null && !Number.isNaN(min)) out = out.filter((m) => originalOf(m) >= min);
    if (max !== null && !Number.isNaN(max)) out = out.filter((m) => originalOf(m) <= max);
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter(
        (m) =>
          (m.counterparty ?? "").toLowerCase().includes(q) ||
          (m.document ?? "").toLowerCase().includes(q) ||
          (m.counterparty_document ?? "").toLowerCase().includes(q) ||
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
  }, [base, filter, state, party, minValue, maxValue, search, sortKey, asc, today]);

  const k = sideKpis(rows, today);

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
      subtitle={`${isReceita ? "Títulos a receber" : "Títulos a pagar"} — ${label}`}
      actions={<PeriodFilter />}
    >
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : base.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <MiniTotal label="Títulos" value={String(k.count)} />
            <MiniTotal
              label={isReceita ? "Faturamento" : "Despesa total"}
              value={formatBRL(k.original)}
            />
            <MiniTotal
              label={isReceita ? "Recebido" : "Pago"}
              value={formatBRL(k.settled)}
              hint={`${k.settledCount} títulos`}
              tone="text-success"
            />
            <MiniTotal
              label="Em aberto"
              value={formatBRL(k.open)}
              hint={`${k.openCount} títulos`}
              tone="text-warning"
            />
            <MiniTotal
              label="Vencido"
              value={formatBRL(k.overdue)}
              hint={`${k.overdueCount} títulos`}
              tone="text-destructive"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Pesquisar documento, histórico, CPF/CNPJ ou nome"
              className="min-w-56 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
            <select
              value={state}
              onChange={(e) => setState(e.target.value as "" | FinState)}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">Todas as situações</option>
              {FIN_STATE_OPTIONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
            <select
              value={party}
              onChange={(e) => setParty(e.target.value)}
              className="max-w-64 rounded-md border border-input bg-card px-3 py-2 text-sm"
            >
              <option value="">{isReceita ? "Todos os clientes" : "Todos os fornecedores"}</option>
              {parties.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              inputMode="decimal"
              placeholder="Valor mín."
              className="w-28 rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
            <input
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              inputMode="decimal"
              placeholder="Valor máx."
              className="w-28 rounded-md border border-input bg-card px-3 py-2 text-sm"
            />
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
                  <th className="px-3 py-2 text-left">{isReceita ? "Recebimento" : "Pagamento"}</th>
                  <th className="px-3 py-2 text-right">
                    {sortBtn("original_amount", "Valor", true)}
                  </th>
                  <th className="px-3 py-2 text-right">
                    {sortBtn("paid_amount", isReceita ? "Recebido" : "Pago", true)}
                  </th>
                  <th className="px-3 py-2 text-right">{sortBtn("open_amount", "Saldo", true)}</th>
                  <th className="px-3 py-2 text-left">{sortBtn("status", "Situação")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 500).map((m) => (
                  <Row
                    key={m.id}
                    m={m}
                    today={today}
                    boletoTooltip={boletoTooltipByMovementId.get(m.id)}
                  />
                ))}
              </tbody>
              <tfoot className="border-t border-border bg-muted/40 font-medium">
                <tr>
                  <td className="px-3 py-2" colSpan={5}>
                    {rows.length} registros
                    {rows.length > 500 && " (exibindo os 500 primeiros)"}
                  </td>
                  <td className="num px-3 py-2 text-right">{formatBRL(k.original)}</td>
                  <td className="num px-3 py-2 text-right">{formatBRL(k.settled)}</td>
                  <td className="num px-3 py-2 text-right">{formatBRL(k.open + k.overdue)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          {isReceita && receivableEventsLoading && (
            <p className="text-xs text-muted-foreground">
              Verificando registros de boletos enviados…
            </p>
          )}
          {isReceita && receivableEventsError && (
            <p role="alert" className="text-xs text-destructive">
              Não foi possível verificar os registros de boletos enviados:{" "}
              {receivableEventsError.message}
            </p>
          )}
        </div>
      )}
    </AppLayout>
  );
}

function Row({
  m,
  today,
  boletoTooltip,
}: {
  m: Movement;
  today: string;
  boletoTooltip?: string | undefined;
}) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/40">
      <td
        className="num px-3 py-2 whitespace-nowrap"
        title={boletoTooltip}
        aria-label={boletoTooltip ? `${m.document ?? ""}: ${boletoTooltip}` : undefined}
      >
        {m.document ?? ""}
        {boletoTooltip && <span className="sr-only"> — Boleto enviado</span>}
      </td>
      <td className="max-w-[280px] truncate px-3 py-2" title={m.counterparty ?? ""}>
        {m.counterparty ?? ""}
      </td>
      <td className="num px-3 py-2 whitespace-nowrap">{formatDate(m.issue_date)}</td>
      <td className="num px-3 py-2 whitespace-nowrap">{formatDate(m.due_date)}</td>
      <td className="num px-3 py-2 whitespace-nowrap">{formatDate(m.payment_date)}</td>
      <td className="num px-3 py-2 text-right whitespace-nowrap">{formatBRL(originalOf(m))}</td>
      <td className="num px-3 py-2 text-right whitespace-nowrap">{formatBRL(paidOf(m))}</td>
      <td className="num px-3 py-2 text-right whitespace-nowrap">{formatBRL(openOf(m))}</td>
      <td className="px-3 py-2">
        <StatusBadge state={finState(m, today)} label={finStatusLabel(m, today)} />
      </td>
    </tr>
  );
}

interface BoletoTitleDetail {
  client: string | null;
  cnpj: string | null;
  document: string | null;
  boleto_file: string | null;
  nf_file: string | null;
  xml_file: string | null;
}

function matchesBoletoEvent(
  event: ReceivableEmailEvent,
  movement: Movement,
  allReceivables: Movement[],
): boolean {
  if (!movement.document) return false;
  const details = parseEventDetails(event.title_details);
  const documents = [
    ...event.title_documents,
    ...details
      .map((detail) => detail.document)
      .filter((document): document is string => !!document),
  ];
  if (!documents.some((document) => documentsMatch(document, movement.document!))) return false;

  const matchingDetails = details.filter(
    (detail) => detail.document && documentsMatch(detail.document, movement.document!),
  );
  const detail = matchingDetails.length === 1 ? matchingDetails[0] : undefined;
  const eventCnpj = normalizeDigits(detail?.cnpj);
  const movementCnpj = normalizeDigits(movement.counterparty_document);
  if (eventCnpj && movementCnpj) return eventCnpj === movementCnpj;

  const eventClient = normalizeName(detail?.client);
  const movementClient = normalizeName(movement.counterparty);
  if (eventClient && movementClient && !/^\d+$/.test(eventClient)) {
    return eventClient === movementClient;
  }

  return (
    allReceivables.filter(
      (candidate) => !!candidate.document && documentsMatch(candidate.document, movement.document!),
    ).length === 1
  );
}

function parseEventDetails(value: unknown): BoletoTitleDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const detail = item as Record<string, unknown>;
    return [
      {
        client: typeof detail["client"] === "string" ? detail["client"] : null,
        cnpj: typeof detail["cnpj"] === "string" ? detail["cnpj"] : null,
        document: typeof detail["document"] === "string" ? detail["document"] : null,
        boleto_file: typeof detail["boleto_file"] === "string" ? detail["boleto_file"] : null,
        nf_file: typeof detail["nf_file"] === "string" ? detail["nf_file"] : null,
        xml_file: typeof detail["xml_file"] === "string" ? detail["xml_file"] : null,
      },
    ];
  });
}

function documentsMatch(left: string, right: string): boolean {
  const normalize = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .replace(/\d+/g, (digits) => digits.replace(/^0+(?=\d)/, ""));
  return normalize(left) !== "" && normalize(left) === normalize(right);
}

function normalizeDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function StatusBadge({ state, label }: { state: FinState; label: string }) {
  const tone =
    state === "REALIZADO"
      ? "bg-success/12 text-success"
      : state === "VENCIDO"
        ? "bg-destructive/12 text-destructive"
        : "bg-warning/15 text-warning";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone,
      )}
    >
      {label}
    </span>
  );
}

function MiniTotal({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("num mt-1 text-lg font-semibold", tone)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
