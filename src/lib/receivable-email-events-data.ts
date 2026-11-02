import type { ReceivableEmailEvent } from "./finance";
import type { PeriodRange } from "./period";

export interface ReceivableEmailHistory {
  events: ReceivableEmailEvent[];
  movements: Array<{
    id: string;
    document: string | null;
    counterparty: string | null;
    counterparty_document: string | null;
    due_date: string | null;
    original_amount: number | string;
  }>;
}

export async function fetchReceivableEmailEvents(
  range: PeriodRange,
): Promise<ReceivableEmailHistory> {
  const params = new URLSearchParams({ action: "events" });
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);

  const response = await fetch(`/api/billing?${params.toString()}`);
  const result = (await response.json()) as {
    events?: ReceivableEmailEvent[];
    movements?: ReceivableEmailHistory["movements"];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error ?? "Não foi possível carregar o histórico de cobranças.");
  }
  return { events: result.events ?? [], movements: result.movements ?? [] };
}
