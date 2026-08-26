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

interface ExistingRow {
  id: string;
  unique_key: string;
  paid_amount: number | string;
  open_amount: number | string;
  status: string;
  payment_date: string | null;
  issue_date: string | null;
  description: string | null;
  counterparty_document: string | null;
}

export async function importRecords(
  records: ParsedRecord[],
  pdfTotal: number | null,
  fileName: string,
  found = records.length,
  rejected = 0,
): Promise<ImportSummary> {
  const keys = records.map((r) => r.unique_key);
  const existing = new Map<string, ExistingRow>();

  for (const part of chunk(keys, 300)) {
    const { data, error } = await supabase
      .from("financial_movements")
      .select(
        "id,unique_key,paid_amount,open_amount,status,payment_date,issue_date,description,counterparty_document",
      )
      .in("unique_key", part);
    if (error) throw error;
    for (const row of (data ?? []) as unknown as ExistingRow[])
      existing.set(row.unique_key, row);
  }

  const toInsert = records.filter((r) => !existing.has(r.unique_key));
  for (const part of chunk(toInsert, 300)) {
    const { error } = await supabase.from("financial_movements").insert(part);
    if (error) throw error;
  }

  // atualiza registros já existentes quando o PDF traz informação mais recente
  let updated = 0;
  for (const r of records) {
    const prev = existing.get(r.unique_key);
    if (!prev) continue;
    const patch: {
      paid_amount?: number;
      open_amount?: number;
      status?: string;
      payment_date?: string;
      issue_date?: string;
      description?: string;
      counterparty_document?: string;
    } = {};
    if (Number(prev["paid_amount"]) !== r.paid_amount) patch.paid_amount = r.paid_amount;
    if (Number(prev["open_amount"]) !== r.open_amount) patch.open_amount = r.open_amount;
    if (prev["status"] !== r.status) patch.status = r.status;
    if (r.payment_date && prev["payment_date"] !== r.payment_date)
      patch.payment_date = r.payment_date;
    if (r.issue_date && !prev["issue_date"]) patch.issue_date = r.issue_date;
    if (r.description && !prev["description"]) patch.description = r.description;
    if (r.counterparty_document && !prev["counterparty_document"])
      patch.counterparty_document = r.counterparty_document;
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase
      .from("financial_movements")
      .update(patch)
      .eq("id", prev.id);
    if (error) throw error;
    updated++;
  }

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
    updated_count: updated,
    total_amount: total,
    paid_amount: paid,
    open_amount: open,
    pdf_total: pdfTotal,
  });

  return {
    found,
    valid: records.length,
    rejected,
    created: toInsert.length,
    existing: records.length - toInsert.length,
    updated,
    total,
    paid,
    open,
    pdfTotal,
    divergence:
      pdfTotal === null ? null : Number((pdfTotal - total).toFixed(2)),
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
