import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History, Undo2 } from "lucide-react";
import { SectionCard } from "@/components/StatCard";
import { useBillingSession } from "@/lib/billing-session";
import { FIELD_LABELS, formatFieldValue } from "@/lib/movement-edit";
import { useMovementChanges, useMovementEditing, type ChangeRecord } from "@/lib/movement-edits";

const ACTION_LABEL: Record<ChangeRecord["action"], string> = {
  update: "Edição",
  delete: "Exclusão",
  restore: "Restauração",
};

export function ChangeHistory() {
  const { authenticated } = useBillingSession();
  const { data, isLoading, error } = useMovementChanges(authenticated);
  const editing = useMovementEditing();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"" | ChangeRecord["action"]>("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data ?? []).filter(
      (c) =>
        (!filter || c.action === filter) &&
        (!q ||
          (c.document ?? "").toLowerCase().includes(q) ||
          (c.counterparty ?? "").toLowerCase().includes(q)),
    );
  }, [data, filter, search]);

  async function restore(id: string) {
    setBusyId(id);
    setMessage("");
    try {
      await editing.restore(id);
      setMessage("Título restaurado.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Não foi possível restaurar.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard
      title="Histórico de alterações"
      description="Todas as edições, exclusões e restaurações feitas manualmente em títulos, com valores antes e depois."
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
      >
        <History className="size-4" />
        {open ? "Ocultar histórico" : "Ver histórico"}
        {data && <span className="text-xs text-muted-foreground">({data.length})</span>}
      </button>
      {open && (
        <div className="mt-4 space-y-3">
          {!authenticated ? (
            <p className="text-sm text-muted-foreground">
              Entre pelo controle “Acesso de cobrança” no cabeçalho para consultar o histórico.
            </p>
          ) : isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : error ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Pesquisar documento ou nome"
                  className="min-w-56 flex-1 rounded-md border border-input bg-card px-3 py-2 text-sm"
                />
                <select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as typeof filter)}
                  className="rounded-md border border-input bg-card px-3 py-2 text-sm"
                >
                  <option value="">Todas as ações</option>
                  <option value="update">Edições</option>
                  <option value="delete">Exclusões</option>
                  <option value="restore">Restaurações</option>
                </select>
              </div>
              {message && (
                <p role="status" className="text-sm text-muted-foreground">
                  {message}
                </p>
              )}
              {rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhuma alteração registrada.</p>
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {rows.map((c) => (
                    <ChangeRow
                      key={c.id}
                      change={c}
                      busy={busyId === c.id}
                      onRestore={() => void restore(c.id)}
                    />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </SectionCard>
  );
}

function ChangeRow({
  change,
  busy,
  onRestore,
}: {
  change: ChangeRecord;
  busy: boolean;
  onRestore: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const fields =
    change.action === "update"
      ? change.changed_fields
      : Object.keys(change.before_data ?? change.after_data ?? {}).filter((f) => f in FIELD_LABELS);
  return (
    <li className="p-3 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 font-medium"
          aria-expanded={expanded}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          {ACTION_LABEL[change.action]} · {change.type === "RECEITA" ? "Receber" : "Pagar"}
        </button>
        <span className="num">{change.document ?? "sem documento"}</span>
        <span className="text-muted-foreground">{change.counterparty ?? ""}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {new Date(change.created_at).toLocaleString("pt-BR")}
          {change.actor ? ` · ${change.actor}` : ""}
        </span>
        {change.restorable && (
          <button
            type="button"
            disabled={busy}
            onClick={onRestore}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
          >
            <Undo2 className="size-3" /> Restaurar
          </button>
        )}
      </div>
      {change.action === "update" && (
        <p className="mt-1 text-xs text-muted-foreground">
          Campos: {change.changed_fields.map((f) => FIELD_LABELS[f] ?? f).join(", ")}
        </p>
      )}
      {expanded && (
        <table className="mt-2 w-full text-xs">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Campo</th>
              {change.action !== "restore" && <th className="py-1 pr-3 font-medium">Antes</th>}
              {change.action !== "delete" && <th className="py-1 font-medium">Depois</th>}
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => (
              <tr key={f} className="border-t border-border/60">
                <td className="py-1 pr-3">{FIELD_LABELS[f] ?? f}</td>
                {change.action !== "restore" && (
                  <td className="py-1 pr-3">{formatFieldValue(f, change.before_data?.[f])}</td>
                )}
                {change.action !== "delete" && (
                  <td className="py-1">{formatFieldValue(f, change.after_data?.[f])}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
