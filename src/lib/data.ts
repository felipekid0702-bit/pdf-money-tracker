import { supabase } from "@/integrations/supabase/client";
import { formatBRL, type Movement } from "./finance";
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
  removed: number;
  total: number;
  paid: number;
  open: number;
  pdfTotal: number | null;
  divergence: number | null;
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
  const recordType = records[0]?.type;
  if (!recordType || records.some((record) => record.type !== recordType)) {
    throw new Error("A importação precisa conter registros de um único tipo.");
  }

  const cents = (amount: number) => Math.round(amount * 100);
  const totalCents = records.reduce((sum, record) => sum + cents(record.original_amount), 0);
  const total = totalCents / 100;
  if (rejected > 0 || found !== records.length) {
    const unvalidated = Math.max(rejected, found - records.length, 0);
    throw new Error(`Sincronização cancelada: ${unvalidated} linha(s) do PDF não foram validadas.`);
  }
  if (pdfTotal === null || !Number.isFinite(pdfTotal)) {
    throw new Error(
      "Sincronização cancelada: não foi possível confirmar o total informado no PDF.",
    );
  }
  if (cents(pdfTotal) !== totalCents) {
    throw new Error(
      `Sincronização cancelada: o PDF informa ${formatBRL(pdfTotal)}, mas as linhas lidas somam ${formatBRL(total)}.`,
    );
  }

  const wanted = new Set(records.map((r) => r.unique_key));
  if (wanted.size !== records.length) {
    throw new Error("Sincronização cancelada: o PDF contém chaves de títulos repetidas.");
  }
  const existing = new Map<string, ExistingRow>();

  // 1. carrega todos os registros do tipo para reconciliar o banco com o PDF completo
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
    for (const row of rows) existing.set(row.unique_key, row);
    onProgress?.(Math.round(records.length * 0.15), records.length);
    if (rows.length < pageSize) break;
  }

  // 2. calcula o resumo antes de enviar a fotografia completa para sincronização
  let updated = 0;
  for (const r of records) {
    const prev = existing.get(r.unique_key);
    if (
      prev &&
      (prev.document !== r.document ||
        prev.counterparty !== r.counterparty ||
        prev.counterparty_document !== r.counterparty_document ||
        prev.description !== r.description ||
        prev.issue_date !== r.issue_date ||
        prev.due_date !== r.due_date ||
        prev.payment_date !== r.payment_date ||
        Number(prev.original_amount) !== r.original_amount ||
        Number(prev.paid_amount) !== r.paid_amount ||
        Number(prev.open_amount) !== r.open_amount ||
        prev.status !== r.status ||
        prev.source !== r.source ||
        prev.source_file !== r.source_file)
    ) {
      updated++;
    }
  }

  const paid = records.reduce((sum, r) => sum + cents(r.paid_amount), 0) / 100;
  const open = records.reduce((sum, r) => sum + cents(r.open_amount), 0) / 100;
  const created =
    records.length - records.filter((record) => existing.has(record.unique_key)).length;
  const { data: removed, error: syncError } = await supabase.rpc("sync_financial_movements", {
    p_type: recordType,
    p_records: records.map((record) => ({ ...record })),
    p_file_name: fileName,
    p_found_count: found,
    p_new_count: created,
    p_existing_count: records.length - created,
    p_updated_count: updated,
    p_total_amount: total,
    p_paid_amount: paid,
    p_open_amount: open,
    p_pdf_total: pdfTotal,
  });
  if (syncError) throw syncError;

  onProgress?.(records.length, records.length);

  return {
    found,
    valid: records.length,
    rejected,
    created,
    existing: records.length - created,
    updated,
    removed,
    total,
    paid,
    open,
    pdfTotal,
    divergence: Number((pdfTotal - total).toFixed(2)),
  };
}

export async function clearAllData(): Promise<void> {
  const a = await supabase.from("financial_movements").delete().not("id", "is", null);
  if (a.error) throw a.error;
  const b = await supabase.from("import_batches").delete().not("id", "is", null);
  if (b.error) throw b.error;
}
