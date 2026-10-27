import { supabase } from "@/integrations/supabase/client";
import type { Movement } from "./finance";
import type { ParsedRecord } from "./pdf-parser";

export async function fetchAllMovements(): Promise<Movement[]> {
  const all: Movement[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("financial_movements")
      .select(
        "id,unique_key,paid_amount,open_amount,status,payment_date,issue_date,description,counterparty,counterparty_document,document,source_file,type,source,original_amount,due_date,sync_state",
      )
      .order("due_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Movement[];
    all.push(
      ...rows.map((row) => ({
        ...row,
        original_amount: Number(row.original_amount),
        paid_amount: Number(row.paid_amount),
        open_amount: Number(row.open_amount),
      })),
    );
    if (rows.length < pageSize) break;
  }
  return all;
}

export interface ImportSummary {
  found: number;
  valid: number;
  rejected: number;
  created: number;
  existing: number;
  updated: number;
  reviewRequired: number;
  reviewApplied: boolean;
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
  open_amount: number | string;
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
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const recordType = records[0]?.type;
  if (!recordType || records.some((record) => record.type !== recordType)) {
    throw new Error("A importação precisa conter registros de um único tipo.");
  }
  if (!records.length) throw new Error("Nenhum registro financeiro válido foi identificado.");

  const cents = (amount: number) => Math.round(amount * 100);
  const totalCents = records.reduce((sum, record) => sum + cents(record.original_amount), 0);
  const total = totalCents / 100;
  const wanted = new Set(records.map((record) => record.unique_key));
  if (wanted.size !== records.length) {
    throw new Error("O PDF contém chaves de títulos repetidas.");
  }

  const reviewApplied =
    rejected === 0 &&
    found === records.length &&
    pdfTotal !== null &&
    Number.isFinite(pdfTotal) &&
    cents(pdfTotal) === totalCents;
  const existing = new Map<string, ExistingRow>();
  const allExisting: ExistingRow[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
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
    }
    onProgress?.(Math.round(records.length * 0.15), records.length);
    if (rows.length < pageSize) break;
  }

  const toInsert: ParsedRecord[] = [];
  const toUpdate: Array<Record<string, unknown>> = [];
  for (const record of records) {
    const previous = existing.get(record.unique_key);
    if (!previous) {
      toInsert.push(record);
      continue;
    }

    const patch: Record<string, unknown> = {};
    if (Number(previous.paid_amount) !== record.paid_amount)
      patch["paid_amount"] = record.paid_amount;
    if (Number(previous.open_amount) !== record.open_amount)
      patch["open_amount"] = record.open_amount;
    if (previous.status !== record.status) patch["status"] = record.status;
    if (record.payment_date && previous.payment_date !== record.payment_date)
      patch["payment_date"] = record.payment_date;
    if (record.issue_date && !previous.issue_date) patch["issue_date"] = record.issue_date;
    if (record.description && !previous.description) patch["description"] = record.description;
    if (record.counterparty && !previous.counterparty) patch["counterparty"] = record.counterparty;
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
      open_amount: Number(previous.open_amount),
      status: previous.status,
      source: previous.source,
      source_file: previous.source_file,
      unique_key: previous.unique_key,
      sync_state: "current",
      ...patch,
    });
  }

  const batches: Array<Array<Record<string, unknown>>> = [
    ...chunk(
      toInsert.map((record) => ({ ...record, sync_state: "current" })),
      400,
    ),
    ...chunk(toUpdate, 400),
  ];
  let written = 0;
  await mapLimit(batches, 3, async (batch) => {
    const { error } = await supabase
      .from("financial_movements")
      .upsert(batch as never, { onConflict: "unique_key" });
    if (error) throw error;
    written += batch.length;
    onProgress?.(Math.round(records.length * 0.3 + written * 0.7), records.length);
  });

  const paid = records.reduce((sum, record) => sum + cents(record.paid_amount), 0) / 100;
  const open = records.reduce((sum, record) => sum + cents(record.open_amount), 0) / 100;
  const missingRows = allExisting.filter((row) => !wanted.has(row.unique_key));
  if (reviewApplied && missingRows.length) {
    await mapLimit(chunk(missingRows, 400), 3, async (batch) => {
      const { error } = await supabase
        .from("financial_movements")
        .update({ sync_state: "review" })
        .in(
          "id",
          batch.map((row) => row.id),
        );
      if (error) throw error;
    });
  }
  const reviewRequired = reviewApplied
    ? missingRows.length
    : allExisting.filter((row) => row.sync_state === "review").length;

  const { error: batchError } = await supabase.from("import_batches").insert({
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
    reviewApplied,
    total,
    paid,
    open,
    pdfTotal,
    divergence: pdfTotal === null ? null : Number((pdfTotal - total).toFixed(2)),
  };
}

export async function clearAllData(): Promise<void> {
  const movements = await supabase.from("financial_movements").delete().not("id", "is", null);
  if (movements.error) throw movements.error;
  const batches = await supabase.from("import_batches").delete().not("id", "is", null);
  if (batches.error) throw batches.error;
}
