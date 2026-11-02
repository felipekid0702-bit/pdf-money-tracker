import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { todayISO, type Movement } from "./finance";
import type { ParsedRecord } from "./pdf-parser";

export async function fetchAllMovements(): Promise<Movement[]> {
  const response = await fetch("/api/billing?action=movements");
  const result = (await response.json()) as Movement[] | { error?: string };
  if (!response.ok) {
    throw new Error(
      !Array.isArray(result) ? (result.error ?? "Falha ao carregar os títulos financeiros.") : "",
    );
  }
  if (!Array.isArray(result)) {
    throw new Error("A resposta do servidor para os títulos financeiros é inválida.");
  }
  return result;
}

export async function fetchAllMovementsFromDatabase(
  database: SupabaseClient<Database>,
): Promise<Movement[]> {
  const pageSize = 1000;
  const columns =
    "id,unique_key,paid_amount,open_amount,paid_amount_known,open_amount_known,status,payment_date,issue_date,description,counterparty,counterparty_document,document,source_file,type,source,original_amount,due_date,sync_state";
  const firstPage = await database
    .from("financial_movements")
    .select(columns, { count: "exact" })
    .order("due_date", { ascending: true })
    .order("id", { ascending: true })
    .range(0, pageSize - 1);
  if (firstPage.error) throw firstPage.error;
  if (firstPage.count === null) {
    throw new Error("Não foi possível determinar a quantidade total de títulos financeiros.");
  }

  const pageCount = Math.ceil(firstPage.count / pageSize);
  const pages = [firstPage.data ?? []];
  const maxConcurrentPages = 4;
  for (let firstPageIndex = 1; firstPageIndex < pageCount; firstPageIndex += maxConcurrentPages) {
    const pageIndexes = Array.from(
      { length: Math.min(maxConcurrentPages, pageCount - firstPageIndex) },
      (_, index) => firstPageIndex + index,
    );
    const pageResults = await Promise.all(
      pageIndexes.map((pageIndex) =>
        database
          .from("financial_movements")
          .select(columns)
          .order("due_date", { ascending: true })
          .order("id", { ascending: true })
          .range(pageIndex * pageSize, (pageIndex + 1) * pageSize - 1),
      ),
    );
    for (const result of pageResults) {
      if (result.error) throw result.error;
      pages.push(result.data ?? []);
    }
  }

  const rows = pages.flat() as unknown as Movement[];
  const uniqueIds = new Set(rows.map((row) => row.id));
  if (rows.length !== firstPage.count || uniqueIds.size !== firstPage.count) {
    throw new Error(
      "Os títulos financeiros foram alterados durante o carregamento. Atualize a tela para tentar novamente.",
    );
  }

  const { count: currentCount, error: countError } = await database
    .from("financial_movements")
    .select("id", { count: "exact", head: true });
  if (countError) throw countError;
  if (currentCount !== firstPage.count) {
    throw new Error(
      "A quantidade de títulos financeiros mudou durante o carregamento. Atualize a tela para tentar novamente.",
    );
  }

  return rows.map((row) => ({
    ...row,
    original_amount: Number(row.original_amount),
    paid_amount: Number(row.paid_amount),
    open_amount: Number(row.open_amount),
    paid_amount_known: Boolean(row.paid_amount_known),
    open_amount_known: Boolean(row.open_amount_known),
  }));
}

export interface ImportSummary {
  found: number;
  valid: number;
  rejected: number;
  created: number;
  existing: number;
  updated: number;
  reviewRequired: number;
  reviewScope: "all" | "overdue" | "none";
  amountKind: ParsedRecord["amount_kind"];
  sourceAmountTotal: number;
  unmatchedBalanceCount: number;
  total: number;
  paid: number;
  open: number;
  pdfTotal: number | null;
  divergence: number | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

function normalizeIdentityPart(value: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function movementIdentityKey(movement: {
  type: string;
  document: string | null;
  counterparty: string | null;
  description: string | null;
  due_date: string | null;
}): string | null {
  if (!movement.due_date) return null;
  const document = normalizeIdentityPart(movement.document);
  const counterparty = normalizeIdentityPart(movement.counterparty);
  if (document && counterparty) {
    return JSON.stringify([movement.type, document, counterparty, movement.due_date]);
  }

  const description = normalizeIdentityPart(movement.description);
  if (!document && counterparty && description) {
    return JSON.stringify([movement.type, counterparty, description, movement.due_date]);
  }
  return null;
}

function movementDocumentDueKey(movement: {
  type: string;
  document: string | null;
  due_date: string | null;
}): string | null {
  const document = normalizeIdentityPart(movement.document);
  if (!document || !movement.due_date) return null;
  return JSON.stringify([movement.type, document, movement.due_date]);
}

function toDatabaseRecord(record: ParsedRecord): Record<string, unknown> {
  return {
    type: record.type,
    document: record.document,
    counterparty: record.counterparty,
    counterparty_document: record.counterparty_document,
    description: record.description,
    issue_date: record.issue_date,
    due_date: record.due_date,
    payment_date: record.payment_date,
    original_amount: record.original_amount,
    paid_amount: record.paid_amount,
    open_amount: record.open_amount,
    paid_amount_known: record.paid_amount_known,
    open_amount_known: record.open_amount_known,
    status: record.status,
    source: record.source,
    source_file: record.source_file,
    unique_key: record.unique_key,
  };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await operation(items[index]!, index);
    }
  });
  await Promise.all(workers);
  return results;
}

interface ExistingRow {
  id: string;
  unique_key: string;
  paid_amount: number | string;
  manual_paid_amount: number | string | null;
  open_amount: number | string;
  paid_amount_known: boolean;
  open_amount_known: boolean;
  status: string;
  payment_date: string | null;
  issue_date: string | null;
  description: string | null;
  counterparty: string | null;
  counterparty_document: string | null;
  document: string | null;
  source_file: string | null;
  type: string;
  source: string;
  original_amount: number | string;
  due_date: string | null;
  sync_state: "current" | "review";
}

export async function importRecords(
  records: ParsedRecord[],
  pdfTotal: number | null,
  fileName: string,
  found = records.length,
  rejected = 0,
  database: SupabaseClient<Database>,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const recordType = records[0]?.type;
  if (!recordType || records.some((record) => record.type !== recordType)) {
    throw new Error("A importação precisa conter registros de um único tipo.");
  }
  if (!records.length) throw new Error("Nenhum registro financeiro válido foi identificado.");
  const amountKind = records[0]!.amount_kind;
  if (records.some((record) => record.amount_kind !== amountKind)) {
    throw new Error("O PDF mistura valores originais e saldos em aberto.");
  }

  const cents = (amount: number) => Math.round(amount * 100);
  const sourceAmountTotal =
    records.reduce(
      (sum, record) =>
        sum + cents(amountKind === "balance" ? record.open_amount : record.original_amount),
      0,
    ) / 100;
  const wanted = new Set(records.map((record) => record.unique_key));
  if (wanted.size !== records.length) {
    throw new Error("O PDF contém chaves de títulos repetidas.");
  }
  const identityKeys = records
    .map(movementIdentityKey)
    .filter((key): key is string => key !== null);
  if (new Set(identityKeys).size !== identityKeys.length) {
    throw new Error("O PDF contém mais de um registro para o mesmo título e vencimento.");
  }

  const totalsReconciled =
    rejected === 0 &&
    found === records.length &&
    pdfTotal !== null &&
    Number.isFinite(pdfTotal) &&
    cents(pdfTotal) === cents(sourceAmountTotal);
  const overdueOnly = records.every(
    (record) =>
      !!record.due_date &&
      (record.status === "CANCELADO" ||
        (record.due_date < todayISO() &&
          (record.status === "ATRASADO" ||
            record.status === "PARCIALMENTE_RECEBIDO" ||
            record.status === "PARCIALMENTE_PAGO"))),
  );
  const existing = new Map<string, ExistingRow>();
  const existingByIdentity = new Map<string, ExistingRow[]>();
  const existingByDocumentDue = new Map<string, ExistingRow[]>();
  const allExisting: ExistingRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await database
      .from("financial_movements")
      .select("*")
      .eq("type", recordType)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as ExistingRow[];
    for (const row of rows) {
      existing.set(row.unique_key, row);
      allExisting.push(row);
      const identity = movementIdentityKey(row);
      if (identity) {
        existingByIdentity.set(identity, [...(existingByIdentity.get(identity) ?? []), row]);
      }
      const documentDue = movementDocumentDueKey(row);
      if (documentDue) {
        existingByDocumentDue.set(documentDue, [
          ...(existingByDocumentDue.get(documentDue) ?? []),
          row,
        ]);
      }
    }
    onProgress?.(Math.round(records.length * 0.15), records.length);
    if (rows.length < pageSize) break;
  }

  const toInsert: ParsedRecord[] = [];
  const toUpdate: Array<Record<string, unknown>> = [];
  const effectiveRecords: ParsedRecord[] = [];
  const matchedExistingIds = new Set<string>();
  for (const record of records) {
    let previous = existing.get(record.unique_key);

    if (!previous) {
      const identity = movementIdentityKey(record);
      const candidates = (identity ? existingByIdentity.get(identity) : undefined)?.filter(
        (row) => !matchedExistingIds.has(row.id),
      );
      if (candidates && candidates.length > 1) {
        throw new Error(
          "Há títulos duplicados com o mesmo documento, cliente e vencimento. Revise os dados antes de importar.",
        );
      }
      previous = candidates?.[0];
    }
    if (!previous) {
      const documentDue = movementDocumentDueKey(record);
      const candidates = (documentDue ? existingByDocumentDue.get(documentDue) : undefined)?.filter(
        (row) => !matchedExistingIds.has(row.id),
      );
      if (candidates && candidates.length > 1) {
        throw new Error(
          "Há títulos com o mesmo documento e vencimento para contrapartes diferentes. Revise os dados antes de importar.",
        );
      }
      const candidate = candidates?.[0];
      if (
        candidate &&
        amountKind === "original" &&
        cents(Number(candidate.original_amount)) === cents(record.original_amount)
      ) {
        previous = candidate;
      }
    }
    if (!previous) {
      const newRecord: ParsedRecord = {
        ...record,
        paid_amount: record.paid_amount_known ? record.paid_amount : 0,
        open_amount: record.open_amount_known ? record.open_amount : 0,
      };
      toInsert.push(newRecord);
      effectiveRecords.push(newRecord);
      continue;
    }
    matchedExistingIds.add(previous.id);

    const previousOriginal = Number(previous.original_amount);
    const effectiveOriginal =
      amountKind === "balance"
        ? Math.max(previousOriginal, record.open_amount)
        : record.original_amount;
    const partial =
      record.status === "PARCIALMENTE_RECEBIDO" || record.status === "PARCIALMENTE_PAGO";
    let paidAmountKnown = record.paid_amount_known;
    let openAmountKnown = record.open_amount_known;
    let paidAmount = record.paid_amount;
    let openAmount = record.open_amount;

    if (amountKind === "balance") {
      paidAmountKnown = true;
      openAmountKnown = true;
      paidAmount = Number((effectiveOriginal - record.open_amount).toFixed(2));
    } else if (partial) {
      if (previous.paid_amount_known && previous.open_amount_known) {
        paidAmountKnown = true;
        openAmountKnown = true;
        paidAmount = Math.min(effectiveOriginal, Math.max(0, Number(previous.paid_amount)));
        openAmount = Number((effectiveOriginal - paidAmount).toFixed(2));
      } else {
        paidAmountKnown = false;
        openAmountKnown = false;
        paidAmount = 0;
        openAmount = 0;
      }
    }

    const effectiveRecord: ParsedRecord = {
      ...record,
      original_amount: effectiveOriginal,
      paid_amount: paidAmountKnown ? paidAmount : 0,
      open_amount: openAmountKnown ? openAmount : 0,
      paid_amount_known: paidAmountKnown,
      open_amount_known: openAmountKnown,
    };
    effectiveRecords.push(effectiveRecord);

    const patch: Record<string, unknown> = {};
    if (Number(previous.original_amount) !== effectiveRecord.original_amount)
      patch["original_amount"] = effectiveRecord.original_amount;
    if (Number(previous.paid_amount) !== effectiveRecord.paid_amount)
      patch["paid_amount"] = effectiveRecord.paid_amount;
    if (Number(previous.open_amount) !== effectiveRecord.open_amount)
      patch["open_amount"] = effectiveRecord.open_amount;
    if (previous.paid_amount_known !== effectiveRecord.paid_amount_known)
      patch["paid_amount_known"] = effectiveRecord.paid_amount_known;
    if (previous.open_amount_known !== effectiveRecord.open_amount_known)
      patch["open_amount_known"] = effectiveRecord.open_amount_known;
    if (previous.status !== effectiveRecord.status) patch["status"] = effectiveRecord.status;
    if (record.amount_kind === "original" && previous.unique_key !== record.unique_key)
      patch["unique_key"] = record.unique_key;
    if (record.payment_date && previous.payment_date !== record.payment_date)
      patch["payment_date"] = record.payment_date;
    if (record.issue_date && !previous.issue_date) patch["issue_date"] = record.issue_date;
    if (record.description && !previous.description) patch["description"] = record.description;
    if (record.counterparty && previous.counterparty !== record.counterparty)
      patch["counterparty"] = record.counterparty;
    if (record.counterparty_document && !previous.counterparty_document)
      patch["counterparty_document"] = record.counterparty_document;
    if (previous.sync_state !== "current") patch["sync_state"] = "current";
    if (!Object.keys(patch).length) continue;

    toUpdate.push({
      id: previous.id,
      type: previous.type,
      document: previous.document,
      counterparty: previous.counterparty,
      counterparty_document: previous.counterparty_document,
      description: previous.description,
      issue_date: previous.issue_date,
      due_date: previous.due_date,
      payment_date: previous.payment_date,
      original_amount: Number(previous.original_amount),
      paid_amount: Number(previous.paid_amount),
      manual_paid_amount: previous.manual_paid_amount,
      open_amount: Number(previous.open_amount),
      paid_amount_known: previous.paid_amount_known,
      open_amount_known: previous.open_amount_known,
      status: previous.status,
      source: previous.source,
      source_file: previous.source_file,
      unique_key: previous.unique_key,
      sync_state: "current",
      ...patch,
    });
  }

  const total =
    effectiveRecords.reduce((sum, record) => sum + cents(record.original_amount), 0) / 100;
  const insertBatches = chunk(
    toInsert.map((record) => ({ ...toDatabaseRecord(record), sync_state: "current" })),
    400,
  );
  const updateBatches = chunk(toUpdate, 400);
  let written = 0;
  await mapLimit(insertBatches, 3, async (batch) => {
    const { error } = await database
      .from("financial_movements")
      .upsert(batch as never, { onConflict: "unique_key" });
    if (error) throw error;
    written += batch.length;
    onProgress?.(Math.round(records.length * 0.3 + written * 0.7), records.length);
  });
  await mapLimit(updateBatches, 3, async (batch) => {
    const { error } = await database
      .from("financial_movements")
      .upsert(batch as never, { onConflict: "id" });
    if (error) throw error;
    written += batch.length;
    onProgress?.(Math.round(records.length * 0.3 + written * 0.7), records.length);
  });

  const paid = effectiveRecords.reduce((sum, record) => sum + cents(record.paid_amount), 0) / 100;
  const open = effectiveRecords.reduce((sum, record) => sum + cents(record.open_amount), 0) / 100;
  const reviewScope = totalsReconciled
    ? amountKind === "balance" || overdueOnly
      ? "overdue"
      : "all"
    : "none";
  const missingRows = allExisting.filter((row) => !matchedExistingIds.has(row.id));
  const rowsToReview =
    reviewScope === "all"
      ? missingRows
      : reviewScope === "overdue"
        ? missingRows.filter(
            (row) => Number(row.open_amount) > 0 && !!row.due_date && row.due_date < todayISO(),
          )
        : [];
  if (rowsToReview.length) {
    await mapLimit(chunk(rowsToReview, 400), 3, async (batch) => {
      const { error } = await database
        .from("financial_movements")
        .update({ sync_state: "review" })
        .in(
          "id",
          batch.map((row) => row.id),
        );
      if (error) throw error;
    });
  }
  const reviewRequired =
    reviewScope !== "none"
      ? rowsToReview.length
      : allExisting.filter((row) => row.sync_state === "review" && !matchedExistingIds.has(row.id))
          .length;

  const { error: batchError } = await database.from("import_batches").insert({
    type: recordType,
    file_name: fileName,
    found_count: found,
    new_count: toInsert.length,
    existing_count: records.length - toInsert.length,
    updated_count: toUpdate.length,
    removed_count: 0,
    review_required_count: reviewRequired,
    total_amount: total,
    paid_amount: paid,
    open_amount: open,
    pdf_total: pdfTotal,
  });
  if (batchError) throw batchError;

  onProgress?.(records.length, records.length);

  return {
    found,
    valid: records.length,
    rejected,
    created: toInsert.length,
    existing: records.length - toInsert.length,
    updated: toUpdate.length,
    reviewRequired,
    reviewScope,
    amountKind,
    sourceAmountTotal,
    unmatchedBalanceCount: amountKind === "balance" ? toInsert.length : 0,
    total,
    paid,
    open,
    pdfTotal,
    divergence: pdfTotal === null ? null : Number((pdfTotal - sourceAmountTotal).toFixed(2)),
  };
}

export async function clearAllData(): Promise<void> {
  const response = await fetch("/api/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "clear_financial_data" }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Falha ao apagar os dados.");
}

export interface PartialBalanceAdjustment {
  movementId: string;
  openAmount: number;
}

export interface PartialBalanceMovement {
  id: string;
  document: string | null;
  counterparty: string | null;
  due_date: string | null;
  original_amount: number;
  status: string;
}

export async function fetchPendingPartialBalances(): Promise<PartialBalanceMovement[]> {
  const response = await fetch("/api/billing?action=partial_balances");
  const result = (await response.json()) as PartialBalanceMovement[] | { error?: string };
  if (!response.ok) {
    throw new Error(
      !Array.isArray(result) ? (result.error ?? "Falha ao carregar os saldos parciais.") : "",
    );
  }
  if (!Array.isArray(result)) {
    throw new Error("A resposta do servidor para os saldos parciais é inválida.");
  }
  return result;
}

export async function fetchPendingPartialBalancesFromDatabase(
  database: SupabaseClient<Database>,
): Promise<PartialBalanceMovement[]> {
  const { data, error } = await database
    .from("financial_movements")
    .select("id,document,counterparty,due_date,original_amount,status")
    .in("status", ["PARCIALMENTE_RECEBIDO", "PARCIALMENTE_PAGO"])
    .eq("open_amount_known", false)
    .eq("sync_state", "current")
    .order("due_date", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    ...row,
    original_amount: Number(row.original_amount),
  }));
}

export async function savePartialBalanceAdjustments(
  adjustments: PartialBalanceAdjustment[],
): Promise<void> {
  const response = await fetch("/api/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "save_partial_balances", adjustments }),
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error ?? "Falha ao salvar os saldos parciais.");
  }
}

export async function savePartialBalanceAdjustmentsToDatabase(
  adjustments: PartialBalanceAdjustment[],
  database: SupabaseClient<Database>,
): Promise<void> {
  if (!adjustments.length) return;

  const ids = adjustments.map((adjustment) => adjustment.movementId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("A lista de títulos parciais contém registros repetidos.");
  }

  const { data, error } = await database
    .from("financial_movements")
    .select("id,original_amount,status,open_amount_known")
    .in("id", ids);
  if (error) throw error;

  const rows = new Map((data ?? []).map((row) => [row.id, row]));
  if (rows.size !== adjustments.length) {
    throw new Error("Algum título mudou durante o ajuste. Atualize a tela e tente novamente.");
  }

  const validated = adjustments.map((adjustment) => {
    const row = rows.get(adjustment.movementId);
    if (
      !row ||
      !["PARCIALMENTE_RECEBIDO", "PARCIALMENTE_PAGO"].includes(row.status) ||
      row.open_amount_known
    ) {
      throw new Error("Algum título não está mais pendente de ajuste. Atualize a tela.");
    }

    const originalCents = Math.round(Number(row.original_amount) * 100);
    const openCents = Math.round(adjustment.openAmount * 100);
    if (
      !Number.isFinite(originalCents) ||
      !Number.isFinite(openCents) ||
      openCents <= 0 ||
      openCents >= originalCents
    ) {
      throw new Error(
        "O saldo em aberto deve ser maior que zero e menor que o valor original do título.",
      );
    }

    return {
      id: row.id,
      status: row.status,
      openAmount: openCents / 100,
      paidAmount: (originalCents - openCents) / 100,
    };
  });

  for (const adjustment of validated) {
    const { data: updated, error: updateError } = await database
      .from("financial_movements")
      .update({
        manual_paid_amount: adjustment.paidAmount,
        paid_amount: adjustment.paidAmount,
        open_amount: adjustment.openAmount,
        paid_amount_known: true,
        open_amount_known: true,
      })
      .eq("id", adjustment.id)
      .eq("status", adjustment.status)
      .eq("open_amount_known", false)
      .select("id")
      .maybeSingle();
    if (updateError) throw updateError;
    if (!updated) {
      throw new Error("Algum título mudou durante o ajuste. Atualize a tela e tente novamente.");
    }
  }
}
