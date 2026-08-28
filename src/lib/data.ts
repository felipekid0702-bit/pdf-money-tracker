import { supabase } from "@/integrations/supabase/client";
import type { Movement } from "./finance";
import type { ParsedRecord } from "./pdf-parser";

export async function fetchAllMovements(): Promise<Movement[]> {
  const all: Movement[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("financial_movements")
      .select("*")
      .order("due_date", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as Movement[];
    all.push(
      ...rows.map((r) => ({
        ...r,
        original_amount: Number(r.original_amount),
        paid_amount: Number(r.paid_amount),
        open_amount: Number(r.open_amount),
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
  total: number;
  paid: number;
  open: number;
  pdfTotal: number | null;
  divergence: number | null;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
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
}

export async function importRecords(
  records: ParsedRecord[],
  pdfTotal: number | null,
  fileName: string,
  found = records.length,
  rejected = 0,
  onProgress?: (done: number, total: number) => void,
): Promise<ImportSummary> {
  const keys = records.map((r) => r.unique_key);
  const existing = new Map<string, ExistingRow>();

  // 1. lookup das chaves existentes (paralelo, em lotes)
  const keyChunks = chunk(keys, 400);
  let lookupDone = 0;
  await mapLimit(keyChunks, 4, async (part) => {
    const { data, error } = await supabase
      .from("financial_movements")
      .select("*")
      .in("unique_key", part);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as ExistingRow[])
      existing.set(row.unique_key, row);
    lookupDone += part.length;
    onProgress?.(Math.round(lookupDone * 0.3), records.length);
  });

  // 2. separa novos e atualizações reais
  const toInsert: ParsedRecord[] = [];
  const toUpdate: Array<Record<string, unknown>> = [];

  for (const r of records) {
    const prev = existing.get(r.unique_key);
    if (!prev) {
      toInsert.push(r);
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (Number(prev.paid_amount) !== r.paid_amount) patch["paid_amount"] = r.paid_amount;
    if (Number(prev.open_amount) !== r.open_amount) patch["open_amount"] = r.open_amount;
    if (prev.status !== r.status) patch["status"] = r.status;
    if (r.payment_date && prev.payment_date !== r.payment_date)
      patch["payment_date"] = r.payment_date;
    if (r.issue_date && !prev.issue_date) patch["issue_date"] = r.issue_date;
    if (r.description && !prev.description) patch["description"] = r.description;
    if (r.counterparty && !prev.counterparty) patch["counterparty"] = r.counterparty;
    if (r.counterparty_document && !prev.counterparty_document)
      patch["counterparty_document"] = r.counterparty_document;
    if (Object.keys(patch).length === 0) continue;
    // upsert exige a linha completa: mescla o existente com o patch
    toUpdate.push({
      id: prev.id,
      type: prev.type,
      document: prev.document,
      counterparty: prev.counterparty,
      counterparty_document: prev.counterparty_document,
      description: prev.description,
      issue_date: prev.issue_date,
      due_date: prev.due_date,
      payment_date: prev.payment_date,
      original_amount: Number(prev.original_amount),
      paid_amount: Number(prev.paid_amount),
      open_amount: Number(prev.open_amount),
      status: prev.status,
      source: prev.source,
      source_file: prev.source_file,
      unique_key: prev.unique_key,
      ...patch,
    });
  }

  // 3. grava em lotes (upsert por unique_key: nunca duplica)
  const batches: Array<Array<Record<string, unknown>>> = [
    ...chunk(toInsert as unknown as Array<Record<string, unknown>>, 400),
    ...chunk(toUpdate, 400),
  ];
  let written = 0;
  await mapLimit(batches, 3, async (batch) => {
    const { error } = await supabase
      .from("financial_movements")
      .upsert(batch as never, { onConflict: "unique_key" });
    if (error) throw error;
    written += batch.length;
    onProgress?.(
      Math.round(records.length * 0.3 + written * 0.7),
      records.length,
    );
  });

  const total = records.reduce((s, r) => s + r.original_amount, 0);
  const paid = records.reduce((s, r) => s + r.paid_amount, 0);
  const open = records.reduce((s, r) => s + r.open_amount, 0);
  const type = records[0]?.type ?? "RECEITA";

  await supabase.from("import_batches").insert({
    type,
    file_name: fileName,
    found_count: found,
    new_count: toInsert.length,
    existing_count: records.length - toInsert.length,
    updated_count: toUpdate.length,
    total_amount: total,
    paid_amount: paid,
    open_amount: open,
    pdf_total: pdfTotal,
  });

  onProgress?.(records.length, records.length);

  return {
    found,
    valid: records.length,
    rejected,
    created: toInsert.length,
    existing: records.length - toInsert.length,
    updated: toUpdate.length,
    total,
    paid,
    open,
    pdfTotal,
    divergence: pdfTotal === null ? null : Number((pdfTotal - total).toFixed(2)),
  };
}

export async function clearAllData(): Promise<void> {
  const a = await supabase
    .from("financial_movements")
    .delete()
    .not("id", "is", null);
  if (a.error) throw a.error;
  const b = await supabase.from("import_batches").delete().not("id", "is", null);
  if (b.error) throw b.error;
}
