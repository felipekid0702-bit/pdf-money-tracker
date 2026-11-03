import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchAllMovements, fetchPendingPartialBalances } from "@/lib/data";
import type { PartialBalanceMovement } from "@/lib/data";
import type { Movement } from "@/lib/finance";
import { useCompany } from "@/lib/company-context";

/** Todos os títulos gravados, inclusive os em revisão (não constam mais no Bling). */
export function useAllMovements() {
  const { company, ready } = useCompany();
  return useQuery<Movement[]>({
    queryKey: ["movements", company.id],
    queryFn: () => fetchAllMovements(company.id),
    enabled: ready,
    staleTime: 30_000,
  });
}

export function usePendingPartialBalances() {
  const { company, ready } = useCompany();
  return useQuery<PartialBalanceMovement[]>({
    queryKey: ["partial-balances", company.id],
    queryFn: () => fetchPendingPartialBalances(company.id),
    enabled: ready,
    staleTime: 30_000,
  });
}

/**
 * Títulos que refletem o último relatório do Bling.
 * Títulos em revisão (ausentes do último PDF importado) ficam de fora de
 * listas, KPIs, análises e ações de cobrança para não divergir do Bling.
 */
export function useMovements() {
  const query = useAllMovements();
  const data = useMemo(() => query.data?.filter((m) => m.sync_state !== "review"), [query.data]);
  return { ...query, data };
}
