import { useMemo, useState } from "react";
import { AppLayout } from "@/components/AppLayout";
import { PeriodFilter } from "@/components/PeriodFilter";
import { useMovements } from "@/hooks/useMovements";
import { useReceivableEmailEvents } from "@/hooks/useReceivableEmailEvents";
import { formatBRL, formatDate, type Movement, type ReceivableEmailEvent } from "@/lib/finance";
import { usePeriod } from "@/lib/period";

type ActionFilter = "" | ReceivableEmailEvent["action_type"];

interface TitleDetail {
  client: string | null;
  cnpj: string | null;
  document: string | null;
  amount: number | null;
  due_date: string | null;
  days_overdue: number | null;
  boleto_file: string | null;
  nf_file: string | null;
  xml_file: string | null;
}

interface EventTitleRow {
  event: ReceivableEmailEvent;
  title: TitleDetail;
  index: number;
}

export function ReceivableActionsPage() {
  const { label, range } = usePeriod();
  const {
    data: events = [],
    isLoading: eventsLoading,
    error,
  } = useReceivableEmailEvents(range, true);
  const {
    data: movements = [],
    isLoading: movementsLoading,
    error: movementsError,
  } = useMovements();
  const [actionFilter, setActionFilter] = useState<ActionFilter>("");

  const rows = useMemo(() => {
    const receivableByDocument = new Map<string, Movement[]>();
    const receivableByCnpj = new Map<string, Movement[]>();
    for (const movement of movements) {
      if (movement.type !== "RECEITA") continue;
      if (movement.document) {
        const key = normalizeDocument(movement.document);
        if (key) {
          receivableByDocument.set(key, [...(receivableByDocument.get(key) ?? []), movement]);
        }
      }
      const cnpj = normalizeDigits(movement.counterparty_document);
      if (cnpj) receivableByCnpj.set(cnpj, [...(receivableByCnpj.get(cnpj) ?? []), movement]);
    }

    return events
      .filter((event) => !actionFilter || event.action_type === actionFilter)
      .flatMap((event) => {
        const details = parseTitleDetails(event.title_details);
        const titles = details.length
          ? details
          : event.title_documents.map((document) => ({
              client: null,
              cnpj: null,
              document,
              amount: null,
              due_date: null,
              days_overdue: null,
              boleto_file: null,
              nf_file: null,
              xml_file: null,
            }));
        const titleCount = Math.max(event.title_count, titles.length);
        const expanded = Array.from({ length: titleCount }, (_, index) => {
          const title = titles[index] ?? emptyTitleDetail();
          const matches = title.document
            ? (receivableByDocument.get(normalizeDocument(title.document)) ?? [])
            : [];
          const cnpjMatches = title.cnpj
            ? (receivableByCnpj.get(normalizeDigits(title.cnpj)) ?? [])
            : [];
          const documentMatch = matches.length === 1 ? matches[0] : undefined;
          const cnpj = normalizeDigits(title.cnpj);
          const documentMatchConflicts =
            cnpj &&
            normalizeDigits(documentMatch?.counterparty_document) &&
            cnpj !== normalizeDigits(documentMatch?.counterparty_document);
          const match =
            (cnpjMatches.length === 1 ? cnpjMatches[0] : undefined) ??
            (!documentMatchConflicts ? documentMatch : undefined);
          const enriched: TitleDetail = {
            client:
              match?.counterparty ??
              (title.client && normalizeDigits(title.client) !== normalizeDigits(title.cnpj)
                ? title.client
                : null),
            cnpj: title.cnpj ?? match?.counterparty_document ?? null,
            document: title.document ?? match?.document ?? null,
            amount: title.amount ?? (match ? Number(match.original_amount) || 0 : null),
            due_date: title.due_date ?? match?.due_date ?? null,
            days_overdue:
              title.days_overdue ??
              (event.action_type === "cobranca_vencido" && match?.due_date
                ? daysBetween(match.due_date, localDate(event.sent_at))
                : null),
            boleto_file: title.boleto_file,
            nf_file: title.nf_file,
            xml_file: title.xml_file,
          };
          return { event, title: enriched, index };
        });
        return expanded;
      });
  }, [events, movements, actionFilter]);

  return (
    <AppLayout
      title="Ações de Cobrança"
      subtitle={`Registros de cobranças e avisos de vencimento — ${label}`}
      actions={<PeriodFilter />}
    >
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="font-semibold">Registro dos envios</h2>
          <p className="text-xs text-muted-foreground">
            Um registro por título enviado, com dados do título conciliados com Contas a Receber. A
            fonte dos títulos e valores continua sendo a importação dos PDFs.
          </p>
        </div>
        <p className="border-b border-border px-4 py-3 text-xs text-muted-foreground">
          Registros antigos sem destinatário ou snapshot completo são exibidos sem inventar dados.
        </p>
        <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
          <label className="flex items-center gap-2 text-sm">
            <span>Tipo de ação</span>
            <select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value as ActionFilter)}
              className="rounded-md border border-input bg-card px-3 py-2 text-sm"
              aria-label="Filtrar por tipo de ação"
            >
              <option value="">Todas as ações</option>
              <option value="aviso_vencimento">Aviso de Vencimento</option>
              <option value="cobranca_vencido">Email de título vencido</option>
              <option value="boleto_enviado">Boleto enviado</option>
            </select>
          </label>
          <span className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "título" : "títulos"}
          </span>
        </div>
        {eventsLoading || movementsLoading ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">Carregando registros de envio…</p>
        ) : error ? (
          <p role="alert" className="px-4 py-5 text-sm text-destructive">
            Não foi possível carregar o histórico de envios: {error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-5 text-sm text-muted-foreground">
            Nenhum título encontrado para este período e tipo de ação.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Data do envio</th>
                  <th className="px-3 py-2 font-medium">Ação</th>
                  <th className="px-3 py-2 font-medium">Cliente</th>
                  <th className="px-3 py-2 font-medium">Destinatário (e-mail)</th>
                  <th className="px-3 py-2 font-medium">Nota Fiscal/Parcela</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-3 py-2 font-medium">Vencimento</th>
                  <th className="px-3 py-2 text-right font-medium">Dias em atraso</th>
                  <th className="px-3 py-2 font-medium">Arquivos enviados (boleto, NF, XML)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ event, title, index }) => (
                  <ReceivableEmailEventRow
                    key={`${event.id}-${index}`}
                    event={event}
                    title={title}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {movementsError && (
          <p role="alert" className="border-t border-border px-4 py-3 text-xs text-destructive">
            Não foi possível conciliar os títulos com Contas a Receber: {movementsError.message}
          </p>
        )}
      </section>
    </AppLayout>
  );
}

function ReceivableEmailEventRow({
  event,
  title,
}: {
  event: ReceivableEmailEvent;
  title: TitleDetail;
}) {
  const isOverdueEmail = event.action_type === "cobranca_vencido";
  const isBoleto = event.action_type === "boleto_enviado";
  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-2 whitespace-nowrap">
        {new Date(event.sent_at).toLocaleString("pt-BR")}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        {isBoleto
          ? "Boleto enviado"
          : isOverdueEmail
            ? "Email de título vencido"
            : "Aviso de Vencimento"}
      </td>
      <td className="px-3 py-2">{title.client ?? "—"}</td>
      <td className="px-3 py-2">{event.recipient_email ?? "Destinatário não informado"}</td>
      <td className="px-3 py-2">{title.document ?? "—"}</td>
      <td className="px-3 py-2 text-right">
        {title.amount === null ? "—" : formatBRL(title.amount)}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{formatDate(title.due_date) || "—"}</td>
      <td className="px-3 py-2 text-right">
        {isOverdueEmail && title.days_overdue !== null ? title.days_overdue : "—"}
      </td>
      <td className="px-3 py-2">
        {isBoleto
          ? [title.boleto_file, title.nf_file, title.xml_file].filter(Boolean).join(" · ") || "—"
          : "—"}
      </td>
    </tr>
  );
}

function parseTitleDetails(value: unknown): TitleDetail[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    return [
      {
        client: typeof item["client"] === "string" ? item["client"] : null,
        cnpj: typeof item["cnpj"] === "string" ? item["cnpj"] : null,
        document: typeof item["document"] === "string" ? item["document"] : null,
        amount:
          typeof item["amount"] === "number" && Number.isFinite(item["amount"])
            ? item["amount"]
            : null,
        due_date: typeof item["due_date"] === "string" ? item["due_date"] : null,
        days_overdue:
          typeof item["days_overdue"] === "number" && Number.isFinite(item["days_overdue"])
            ? item["days_overdue"]
            : null,
        boleto_file: typeof item["boleto_file"] === "string" ? item["boleto_file"] : null,
        nf_file: typeof item["nf_file"] === "string" ? item["nf_file"] : null,
        xml_file: typeof item["xml_file"] === "string" ? item["xml_file"] : null,
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyTitleDetail(): TitleDetail {
  return {
    client: null,
    cnpj: null,
    document: null,
    amount: null,
    due_date: null,
    days_overdue: null,
    boleto_file: null,
    nf_file: null,
    xml_file: null,
  };
}

function normalizeDocument(document: string): string {
  return document
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function normalizeDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

function localDate(timestamp: string): string {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function daysBetween(dueDate: string, sentDate: string): number {
  const due = new Date(`${dueDate.slice(0, 10)}T00:00:00`);
  const sent = new Date(`${sentDate}T00:00:00`);
  return Math.max(0, Math.floor((sent.getTime() - due.getTime()) / 86_400_000));
}
