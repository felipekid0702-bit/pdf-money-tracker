import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchAllMovements } from "@/lib/data";
import type { Movement } from "@/lib/finance";

/** Todos os títulos gravados, inclusive os em revisão (não constam mais no Bling). */
export function useAllMovements() {
  return useQuery<Movement[]>({
    queryKey: ["movements"],
    queryFn: fetchAllMovements,
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
  const data = useMemo(
    () => query.data?.filter((m) => m.sync_state !== "review"),
    [query.data],
  );
  return { ...query, data };
}
