import { useQuery } from "@tanstack/react-query";
import { fetchReceivableEmailEvents } from "@/lib/receivable-email-events-data";
import type { PeriodRange } from "@/lib/period";
import type { ReceivableEmailEvent } from "@/lib/finance";

export function useReceivableEmailEvents(range: PeriodRange, enabled: boolean) {
  return useQuery<ReceivableEmailEvent[]>({
    queryKey: ["receivable-email-events", range.from, range.to],
    queryFn: () => fetchReceivableEmailEvents(range),
    enabled,
    staleTime: 30_000,
  });
}
