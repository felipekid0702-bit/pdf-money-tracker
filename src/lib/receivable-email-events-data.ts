import type { ReceivableEmailEvent } from "./finance";
import type { PeriodRange } from "./period";

export async function fetchReceivableEmailEvents(
  range: PeriodRange,
): Promise<ReceivableEmailEvent[]> {
  const params = new URLSearchParams({ action: "events" });
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);

  const response = await fetch(`/api/billing?${params.toString()}`);
  const result = (await response.json()) as {
    events?: ReceivableEmailEvent[];
    error?: string;
  };
  if (!response.ok) {
    throw new Error(result.error ?? "Não foi possível carregar o histórico de cobranças.");
  }
  return result.events ?? [];
}
