import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePendingPartialBalances } from "@/hooks/useMovements";
import { formatBRL, formatDate } from "@/lib/finance";
import { savePartialBalanceAdjustments } from "@/lib/data";
import type { PartialBalanceMovement } from "@/lib/data";
import { useImportQueue } from "@/lib/import-context";

/** Barra flutuante global: a importação continua mesmo trocando de tela. */
export function ImportStatusBar() {
  const { jobs } = useImportQueue();
  const queryClient = useQueryClient();
  const { data: partials = [], error: partialBalancesError } = usePendingPartialBalances();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dismissedKey, setDismissedKey] = useState("");
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const active = jobs.filter((j) => j.phase !== "concluido" && j.phase !== "erro");
  const partialKey = partials
    .map((movement) => movement.id)
    .sort()
    .join("|");
  const current = active[0];

  useEffect(() => {
    if (!partialKey) {
      setDialogOpen(false);
      setDismissedKey("");
      return;
    }
    if (partialKey !== dismissedKey) setDialogOpen(true);
  }, [partialKey, dismissedKey]);

  useEffect(() => {
    setAmounts((previous) =>
      Object.fromEntries(partials.map((movement) => [movement.id, previous[movement.id] ?? ""])),
    );
    setErrorMessage("");
  }, [partialKey, partials]);

  function setOpen(open: boolean) {
    if (!open && saving) return;
    setDialogOpen(open);
    if (!open) setDismissedKey(partialKey);
  }

  async function saveAdjustments() {
    const adjustments: Array<{ movementId: string; openAmount: number }> = [];
    for (const movement of partials) {
      const openAmount = parseBrazilianAmount(amounts[movement.id] ?? "");
      if (openAmount === null) {
        setErrorMessage(
          `Informe um saldo válido para o título ${movement.document ?? movement.id}.`,
        );
        return;
      }
      if (openAmount <= 0 || openAmount >= movement.original_amount) {
        setErrorMessage(
          `O saldo do título ${movement.document ?? movement.id} deve ser maior que zero e menor que ${formatBRL(movement.original_amount)}.`,
        );
        return;
      }
      adjustments.push({ movementId: movement.id, openAmount });
    }

    setSaving(true);
    setErrorMessage("");
    try {
      await savePartialBalanceAdjustments(adjustments);
      await queryClient.invalidateQueries({ queryKey: ["movements"] });
      await queryClient.invalidateQueries({ queryKey: ["partial-balances"] });
      setDismissedKey(partialKey);
      setDialogOpen(false);
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: ["movements"] });
      await queryClient.invalidateQueries({ queryKey: ["partial-balances"] });
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível salvar os saldos parciais. Tente novamente.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {current && (
        <div
          className={`fixed right-4 z-50 w-80 rounded-lg border border-border bg-card p-4 shadow-lg ${
            partials.length > 0 && !dialogOpen ? "bottom-20" : "bottom-4"
          }`}
        >
          <div className="flex items-center gap-2 text-sm font-medium">
            <Loader2 className="size-4 animate-spin text-primary" />
            <span className="truncate">{current.fileName}</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round(current.progress * 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {current.detail}
            {active.length > 1 ? ` · +${active.length - 1} na fila` : ""}
          </p>
          <Link to="/importacao" className="mt-2 inline-block text-xs text-primary underline">
            Ver detalhes da importação
          </Link>
        </div>
      )}
      {partials.length > 0 && !dialogOpen && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-50 rounded-md border border-warning/50 bg-card px-3 py-2 text-sm font-medium text-warning shadow-lg"
        >
          Ajustar saldos parciais ({partials.length})
        </button>
      )}
      {partialBalancesError && (
        <div
          role="alert"
          className="fixed bottom-4 left-4 z-50 flex max-w-md items-center gap-3 rounded-md border border-destructive/40 bg-card p-3 text-xs shadow-lg"
        >
          <span>Não foi possível verificar os saldos parciais para ajuste.</span>
          <button
            type="button"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["partial-balances"] })}
            className="shrink-0 underline"
          >
            Tentar novamente
          </button>
        </div>
      )}
      <Dialog open={dialogOpen} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ajuste de títulos parcialmente pagos</DialogTitle>
            <DialogDescription>
              O PDF informa o valor original, mas não o valor recebido/pago nem o saldo dos títulos
              parciais. Informe o saldo em aberto confirmado no Bling; o valor recebido/pago será
              calculado automaticamente.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {partials.map((movement) => (
              <PartialBalanceRow
                key={movement.id}
                movement={movement}
                value={amounts[movement.id] ?? ""}
                onChange={(value) =>
                  setAmounts((previous) => ({ ...previous, [movement.id]: value }))
                }
              />
            ))}
          </div>
          {errorMessage && (
            <div role="alert" className="flex items-start gap-2 text-sm text-destructive">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {errorMessage}
            </div>
          )}
          <DialogFooter>
            <button
              type="button"
              disabled={saving}
              onClick={() => setOpen(false)}
              className="rounded-md border border-input px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
            >
              Ajustar depois
            </button>
            <button
              type="button"
              disabled={saving || partials.length === 0}
              onClick={() => void saveAdjustments()}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar saldos"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PartialBalanceRow({
  movement,
  value,
  onChange,
}: {
  movement: PartialBalanceMovement;
  value: string;
  onChange: (value: string) => void;
}) {
  const openAmount = parseBrazilianAmount(value);
  const paidAmount =
    openAmount !== null && openAmount > 0 && openAmount < movement.original_amount
      ? movement.original_amount - openAmount
      : null;

  return (
    <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-[1fr_150px_180px] sm:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {movement.document || "Sem documento"} — {movement.counterparty || "Sem identificação"}
        </p>
        <p className="text-xs text-muted-foreground">
          Vencimento: {formatDate(movement.due_date)} · Original:{" "}
          {formatBRL(movement.original_amount)}
        </p>
      </div>
      <label className="text-xs">
        Saldo em aberto
        <input
          aria-label={`Saldo em aberto do título ${movement.document ?? movement.id}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        {paidAmount === null ? "Recebido/pago: —" : `Recebido/pago: ${formatBRL(paidAmount)}`}
      </p>
    </div>
  );
}

function parseBrazilianAmount(value: string): number | null {
  const normalized = value.trim().replace(/\./g, "").replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}
