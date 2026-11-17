import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBRL, todayISO, type Movement } from "@/lib/finance";
import { situationOf, validateEdit, type EditSituation } from "@/lib/movement-edit";
import { useMovementEditing } from "@/lib/movement-edits";
import { useBillingSession } from "@/lib/billing-session";

const parseMoney = (v: string): number => {
  const cleaned = v.trim().replace(/[R$\s]/g, "");
  if (!cleaned) return 0;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  return Number(normalized);
};
const toMoneyText = (n: number) => (Number.isFinite(n) ? n.toFixed(2).replace(".", ",") : "");

export function MovementEditDialog({
  movement,
  onClose,
}: {
  movement: Movement | null;
  onClose: () => void;
}) {
  const { authenticated } = useBillingSession();
  const editing = useMovementEditing();
  const isReceita = movement?.type === "RECEITA";
  const [form, setForm] = useState({
    document: "",
    counterparty: "",
    counterparty_document: "",
    description: "",
    issue_date: "",
    due_date: "",
    payment_date: "",
    original: "",
    paid: "",
    situation: "EM_ABERTO" as EditSituation,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!movement) return;
    setForm({
      document: movement.document ?? "",
      counterparty: movement.counterparty ?? "",
      counterparty_document: movement.counterparty_document ?? "",
      description: movement.description ?? "",
      issue_date: movement.issue_date?.slice(0, 10) ?? "",
      due_date: movement.due_date?.slice(0, 10) ?? "",
      payment_date: movement.payment_date?.slice(0, 10) ?? "",
      original: toMoneyText(Number(movement.original_amount)),
      paid: toMoneyText(movement.paid_amount_known === false ? 0 : Number(movement.paid_amount)),
      situation: situationOf(movement),
    });
    setError("");
    setConfirmDelete(false);
  }, [movement]);

  if (!movement) return null;
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const original = parseMoney(form.original);
  const paid = parseMoney(form.paid);
  const effectivePaid =
    form.situation === "LIQUIDADO" ? original : form.situation === "PARCIAL" ? paid : 0;
  const balance =
    form.situation === "CANCELADO" ? 0 : Math.max(0, Math.round((original - effectivePaid) * 100) / 100);
  const paidLabel = isReceita ? "recebido" : "pago";

  function changeSituation(next: EditSituation) {
    setForm((f) => ({
      ...f,
      situation: next,
      payment_date:
        (next === "LIQUIDADO" || next === "PARCIAL") && !f.payment_date ? todayISO() : f.payment_date,
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = {
      document: form.document,
      counterparty: form.counterparty,
      counterparty_document: form.counterparty_document,
      description: form.description,
      issue_date: form.issue_date || null,
      due_date: form.due_date || null,
      payment_date: form.payment_date || null,
      original_amount: original,
      paid_amount: paid,
      situation: form.situation,
    };
    const invalid = validateEdit(input);
    if (invalid) return setError(invalid);
    setBusy(true);
    setError("");
    try {
      await editing.save(movement!.id, input);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await editing.remove(movement!.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir.");
    } finally {
      setBusy(false);
    }
  }

  const showPayment = form.situation === "LIQUIDADO" || form.situation === "PARCIAL";

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="space-y-5">
          <DialogHeader>
            <DialogTitle>Editar título {movement.document ?? ""}</DialogTitle>
            <DialogDescription>
              {isReceita ? "Conta a receber" : "Conta a pagar"}. As alterações atualizam
              automaticamente todos os indicadores e ficam registradas em Configurações → Histórico
              de alterações.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Documento">
              <input className={inputCls} value={form.document} onChange={(e) => set("document")(e.target.value)} />
            </Field>
            <Field label={isReceita ? "Cliente" : "Fornecedor"}>
              <input className={inputCls} value={form.counterparty} onChange={(e) => set("counterparty")(e.target.value)} />
            </Field>
            <Field label="CPF/CNPJ">
              <input className={inputCls} value={form.counterparty_document} onChange={(e) => set("counterparty_document")(e.target.value)} />
            </Field>
            <Field label="Situação">
              <select className={inputCls} value={form.situation} onChange={(e) => changeSituation(e.target.value as EditSituation)}>
                <option value="EM_ABERTO">Em aberto</option>
                <option value="PARCIAL">{isReceita ? "Parcialmente recebido" : "Parcialmente pago"}</option>
                <option value="LIQUIDADO">{isReceita ? "Recebido" : "Pago"}</option>
                <option value="CANCELADO">Cancelado</option>
              </select>
            </Field>
            <Field label="Emissão">
              <input type="date" className={inputCls} value={form.issue_date} onChange={(e) => set("issue_date")(e.target.value)} />
            </Field>
            <Field label="Vencimento">
              <input type="date" className={inputCls} value={form.due_date} onChange={(e) => set("due_date")(e.target.value)} />
            </Field>
            <Field label="Valor original (R$)">
              <input inputMode="decimal" className={inputCls} value={form.original} onChange={(e) => set("original")(e.target.value)} />
            </Field>
            {form.situation === "PARCIAL" ? (
              <Field label={`Valor ${paidLabel} (R$)`}>
                <input inputMode="decimal" className={inputCls} value={form.paid} onChange={(e) => set("paid")(e.target.value)} />
              </Field>
            ) : (
              <Field label={`Valor ${paidLabel}`}>
                <div className={`${inputCls} bg-muted/40 text-muted-foreground`}>
                  {formatBRL(effectivePaid)}
                </div>
              </Field>
            )}
            {showPayment && (
              <Field label={`Data de ${isReceita ? "recebimento" : "pagamento"}`}>
                <input type="date" className={inputCls} value={form.payment_date} onChange={(e) => set("payment_date")(e.target.value)} />
              </Field>
            )}
            <Field label="Saldo em aberto">
              <div className={`${inputCls} bg-muted/40 font-medium`}>{formatBRL(balance)}</div>
            </Field>
          </div>
          <Field label="Histórico / descrição">
            <textarea rows={2} className={inputCls} value={form.description} onChange={(e) => set("description")(e.target.value)} />
          </Field>

          {!authenticated && (
            <p role="status" className="text-sm text-warning">
              Entre pelo controle “Acesso de cobrança” no cabeçalho para salvar alterações.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            {confirmDelete ? (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-destructive">Excluir este título?</span>
                <button type="button" disabled={busy || !authenticated} onClick={() => void remove()} className="rounded-md bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60">
                  Sim, excluir
                </button>
                <button type="button" disabled={busy} onClick={() => setConfirmDelete(false)} className="rounded-md border border-input px-3 py-2 text-xs">
                  Não
                </button>
              </div>
            ) : (
              <button type="button" disabled={busy || !authenticated} onClick={() => setConfirmDelete(true)} className="inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50">
                <Trash2 className="size-4" /> Excluir
              </button>
            )}
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={onClose} className="rounded-md border border-input px-3 py-2 text-sm">
                Cancelar
              </button>
              <button type="submit" disabled={busy || !authenticated} className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
                {busy && <Loader2 className="size-3 animate-spin" />}
                Salvar alterações
              </button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
