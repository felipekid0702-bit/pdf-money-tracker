import { useQuery } from "@tanstack/react-query";
import { fetchReceivableEmailEvents } from "@/lib/receivable-email-events-data";
import type { PeriodRange } from "@/lib/period";
import type { ReceivableEmailHistory } from "@/lib/receivable-email-events-data";
import { useCompany } from "@/lib/company-context";

export function useReceivableEmailEvents(range: PeriodRange, enabled: boolean) {
  const { company, ready } = useCompany();
  return useQuery<ReceivableEmailHistory>({
    queryKey: ["receivable-email-events", company.id, range.from, range.to],
    queryFn: () => fetchReceivableEmailEvents(company.id, range),
    enabled: enabled && ready,
    staleTime: 30_000,
  });
}
