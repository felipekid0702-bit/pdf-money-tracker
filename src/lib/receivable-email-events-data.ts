import { supabase } from "@/integrations/supabase/client";
import type { ReceivableEmailEvent } from "./finance";
import type { PeriodRange } from "./period";

export async function fetchReceivableEmailEvents(
  range: PeriodRange,
): Promise<ReceivableEmailEvent[]> {
  const all: ReceivableEmailEvent[] = [];
  const pageSize = 1000;
  const fromDate = range.from ? new Date(`${range.from}T00:00:00`).toISOString() : null;
  let to: string | null = null;
  if (range.to) {
    const end = new Date(`${range.to}T00:00:00`);
    end.setDate(end.getDate() + 1);
    to = end.toISOString();
  }

  for (let offset = 0; ; offset += pageSize) {
    let query = supabase
      .from("receivable_email_events")
      .select("*")
      .order("sent_at", { ascending: false })
      .range(offset, offset + pageSize - 1);
    if (fromDate) query = query.gte("sent_at", fromDate);
    if (to) query = query.lt("sent_at", to);
    const { data, error } = await query;
    if (error) throw error;
    all.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return all;
}
