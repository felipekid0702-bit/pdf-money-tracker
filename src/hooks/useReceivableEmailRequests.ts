import { useQuery } from "@tanstack/react-query";
import { fetchActiveReceivableEmailRequests } from "@/lib/receivable-email-requests-data";
import type { ReceivableEmailRequest } from "@/lib/finance";

export function useReceivableEmailRequests(enabled: boolean) {
  return useQuery<ReceivableEmailRequest[]>({
    queryKey: ["receivable-email-requests"],
    queryFn: fetchActiveReceivableEmailRequests,
    enabled,
    refetchInterval: 15_000,
    staleTime: 5_000,
  });
}
