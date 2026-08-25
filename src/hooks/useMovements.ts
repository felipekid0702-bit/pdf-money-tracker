import { useQuery } from "@tanstack/react-query";
import { fetchAllMovements } from "@/lib/data";
import type { Movement } from "@/lib/finance";

export function useMovements() {
  return useQuery<Movement[]>({
    queryKey: ["movements"],
    queryFn: fetchAllMovements,
    staleTime: 30_000,
  });
}
