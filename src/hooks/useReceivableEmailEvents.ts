import { useQuery } from "@tanstack/react-query";
import { fetchReceivableEmailEvents } from "@/lib/receivable-email-events-data";
import type { PeriodRange } from "@/lib/period";
import type { ReceivableEmailHistory } from "@/lib/receivable-email-events-data";

export function useReceivableEmailEvents(range: PeriodRange, enabled: boolean) {
  return useQuery<ReceivableEmailHistory>({
    queryKey: ["receivable-email-events", range.from, range.to],
    queryFn: () => fetchReceivableEmailEvents(range),
    enabled,
    staleTime: 30_000,
  });
}
