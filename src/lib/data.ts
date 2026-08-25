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

export async function importRecords(
  records: ParsedRecord[],
  pdfTotal: number | null,
  fileName: string,
): Promise<ImportSummary> {
  const keys = records.map((r) => r.unique_key);
  const existingKeys = new Set<string>();

  for (const part of chunk(keys, 300)) {
    const { data, error } = await supabase
      .from("financial_movements")
      .select("unique_key")
      .in("unique_key", part);
    if (error) throw error;
    for (const row of data ?? []) existingKeys.add((row as { unique_key: string }).unique_key);
  }

  const toInsert = records.filter((r) => !existingKeys.has(r.unique_key));
  for (const part of chunk(toInsert, 300)) {
    const { error } = await supabase.from("financial_movements").insert(part);
    if (error) throw error;
  }

  const total = records.reduce((s, r) => s + r.original_amount, 0);
  const paid = records.reduce((s, r) => s + r.paid_amount, 0);
  const open = records.reduce((s, r) => s + r.open_amount, 0);
  const type = records[0]?.type ?? "RECEITA";

  await supabase.from("import_batches").insert({
    type,
    file_name: fileName,
    found_count: records.length,
    new_count: toInsert.length,
    existing_count: records.length - toInsert.length,
    updated_count: 0,
    total_amount: total,
    paid_amount: paid,
    open_amount: open,
    pdf_total: pdfTotal,
  });

  return {
    found: records.length,
    created: toInsert.length,
    existing: records.length - toInsert.length,
    updated: 0,
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
