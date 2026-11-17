import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { todayISO, type MovementType } from "./finance";
import {
  buildPatch,
  diffFields,
  lockFieldsFor,
  validateEdit,
  type MovementEditInput,
} from "./movement-edit";

// As tabelas novas ainda não constam nos tipos gerados do Supabase.
type Db = SupabaseClient<Database>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const table = (db: Db, name: string) => (db as any).from(name);

const MIGRATION_HINT =
  "O histórico de alterações ainda não foi criado no banco. Aplique a migration 20261117100000_manual_title_edits.sql.";

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  return (
    !!error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      /does not exist|schema cache/i.test(error.message ?? ""))
  );
}

export class EditError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export interface ChangeRecord {
  id: string;
  movement_id: string;
  action: "update" | "delete" | "restore";
  type: MovementType;
  document: string | null;
  counterparty: string | null;
  changed_fields: string[];
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  actor: string | null;
  created_at: string;
  restorable: boolean;
}

const MOVEMENT_COLUMNS =
  "id,company_id,type,document,counterparty,counterparty_document,description,issue_date,due_date,payment_date,original_amount,paid_amount,open_amount,paid_amount_known,open_amount_known,manual_paid_amount,status,source,source_file,unique_key,sync_state";

function snapshot(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const k of ["original_amount", "paid_amount", "open_amount", "manual_paid_amount"]) {
    if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  }
  return out;
}

async function loadMovement(db: Db, companyId: string, movementId: string) {
  const { data, error } = await db
    .from("financial_movements")
    .select(MOVEMENT_COLUMNS)
    .eq("company_id", companyId)
    .eq("id", movementId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new EditError("Título não encontrado. Atualize a tela e tente novamente.", 404);
  return snapshot(data as unknown as Record<string, unknown>);
}

export async function updateMovement(
  db: Db,
  companyId: string,
  movementId: string,
  input: MovementEditInput,
  actor: string,
): Promise<Record<string, unknown>> {
  const invalid = validateEdit(input);
  if (invalid) throw new EditError(invalid);

  const before = await loadMovement(db, companyId, movementId);
  const patch = buildPatch(before["type"] as MovementType, input, todayISO());
  const after = { ...before, ...patch };
  const changed = diffFields(before, after);
  if (!changed.length) return before;

  const { error } = await db
    .from("financial_movements")
    .update(patch as never)
    .eq("company_id", companyId)
    .eq("id", movementId);
  if (error) throw error;

  const { error: logError } = await table(db, "financial_movement_changes").insert({
    company_id: companyId,
    movement_id: movementId,
    action: "update",
    type: before["type"],
    document: (after["document"] as string | null) ?? null,
    counterparty: (after["counterparty"] as string | null) ?? null,
    changed_fields: changed,
    before_data: before,
    after_data: after,
    actor,
  });
  if (logError) {
    // Desfaz a edição: sem histórico não há trilha de auditoria.
    await db
      .from("financial_movements")
      .update(before as never)
      .eq("company_id", companyId)
      .eq("id", movementId);
    throw new EditError(isMissingTable(logError) ? MIGRATION_HINT : logError.message, 500);
  }

  const lockFields = lockFieldsFor(changed);
  const { data: existing } = await table(db, "financial_movement_manual_locks")
    .select("fields")
    .eq("movement_id", movementId)
    .maybeSingle();
  const merged = [...new Set([...(existing?.fields ?? []), ...lockFields])];
  const { error: lockError } = await table(db, "financial_movement_manual_locks").upsert(
    { movement_id: movementId, company_id: companyId, fields: merged, updated_at: new Date().toISOString() },
    { onConflict: "movement_id" },
  );
  if (lockError) console.error("[movement-edits] falha ao registrar proteção da edição", lockError);

  return after;
}

export async function deleteMovement(
  db: Db,
  companyId: string,
  movementId: string,
  actor: string,
): Promise<void> {
  const before = await loadMovement(db, companyId, movementId);
  const { data: change, error: logError } = await table(db, "financial_movement_changes")
    .insert({
      company_id: companyId,
      movement_id: movementId,
      action: "delete",
      type: before["type"],
      document: before["document"] ?? null,
      counterparty: before["counterparty"] ?? null,
      changed_fields: [],
      before_data: before,
      after_data: null,
      actor,
    })
    .select("id")
    .single();
  if (logError) throw new EditError(isMissingTable(logError) ? MIGRATION_HINT : logError.message, 500);

  const { error: exclusionError } = await table(db, "financial_movement_exclusions").upsert(
    {
      company_id: companyId,
      unique_key: before["unique_key"],
      type: before["type"],
      document: before["document"] ?? null,
      counterparty: before["counterparty"] ?? null,
      due_date: before["due_date"] ?? null,
      original_amount: before["original_amount"] ?? null,
      change_id: change.id,
    },
    { onConflict: "company_id,unique_key" },
  );
  if (exclusionError) {
    await table(db, "financial_movement_changes").delete().eq("id", change.id);
    throw new EditError(exclusionError.message, 500);
  }

  const { error } = await db
    .from("financial_movements")
    .delete()
    .eq("company_id", companyId)
    .eq("id", movementId);
  if (error) {
    await table(db, "financial_movement_exclusions")
      .delete()
      .eq("company_id", companyId)
      .eq("unique_key", before["unique_key"]);
    await table(db, "financial_movement_changes").delete().eq("id", change.id);
    throw error;
  }
  await table(db, "financial_movement_manual_locks").delete().eq("movement_id", movementId);
}

export async function restoreMovement(
  db: Db,
  companyId: string,
  changeId: string,
  actor: string,
): Promise<void> {
  const { data: change, error } = await table(db, "financial_movement_changes")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", changeId)
    .eq("action", "delete")
    .maybeSingle();
  if (error) throw new EditError(isMissingTable(error) ? MIGRATION_HINT : error.message, 500);
  if (!change?.before_data) throw new EditError("Registro de exclusão não encontrado.", 404);

  const row = { ...(change.before_data as Record<string, unknown>) };
  const { error: insertError } = await db.from("financial_movements").insert(row as never);
  if (insertError) {
    throw new EditError(
      insertError.code === "23505"
        ? "Este título já existe novamente (provavelmente reimportado)."
        : insertError.message,
      409,
    );
  }
  await table(db, "financial_movement_exclusions")
    .delete()
    .eq("company_id", companyId)
    .eq("unique_key", row["unique_key"]);
  await table(db, "financial_movement_changes").insert({
    company_id: companyId,
    movement_id: change.movement_id,
    action: "restore",
    type: change.type,
    document: change.document,
    counterparty: change.counterparty,
    changed_fields: [],
    before_data: null,
    after_data: row,
    actor,
  });
}

export async function listChanges(
  db: Db,
  companyId: string,
  limit = 500,
): Promise<ChangeRecord[]> {
  const { data, error } = await table(db, "financial_movement_changes")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) return [];
    throw error;
  }
  const { data: exclusions } = await table(db, "financial_movement_exclusions")
    .select("change_id")
    .eq("company_id", companyId);
  const restorable = new Set<string>((exclusions ?? []).map((e: { change_id: string }) => e.change_id));
  return (data ?? []).map((c: Omit<ChangeRecord, "restorable">) => ({
    ...c,
    restorable: c.action === "delete" && restorable.has(c.id),
  }));
}

/** Para a importação do Bling: exclusões e campos protegidos. Tolerante à migration ausente. */
export async function loadManualState(
  db: Db,
  companyId: string,
): Promise<{ excludedKeys: Set<string>; locks: Map<string, Set<string>> }> {
  const excludedKeys = new Set<string>();
  const locks = new Map<string, Set<string>>();
  const ex = await table(db, "financial_movement_exclusions")
    .select("unique_key")
    .eq("company_id", companyId)
    .limit(100000);
  if (ex.error) {
    if (!isMissingTable(ex.error)) throw ex.error;
    return { excludedKeys, locks };
  }
  for (const r of ex.data ?? []) excludedKeys.add(r.unique_key);
  const lk = await table(db, "financial_movement_manual_locks")
    .select("movement_id,fields")
    .eq("company_id", companyId)
    .limit(100000);
  if (lk.error) {
    if (!isMissingTable(lk.error)) throw lk.error;
    return { excludedKeys, locks };
  }
  for (const r of lk.data ?? []) locks.set(r.movement_id, new Set<string>(r.fields ?? []));
  return { excludedKeys, locks };
}
