import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "@/lib/company-context";
import type { Movement } from "@/lib/finance";
import type { MovementEditInput } from "@/lib/movement-edit";
import type { ChangeRecord } from "@/lib/movement-edits-server";

export type { ChangeRecord };

async function post<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const response = await fetch("/api/billing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(result.error ?? fallback);
  return result;
}

/** Ações de edição; atualizam o cache para que KPIs e telas recalculem na hora. */
export function useMovementEditing() {
  const qc = useQueryClient();
  const { company } = useCompany();

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["movements", company.id] }),
      qc.invalidateQueries({ queryKey: ["partial-balances", company.id] }),
      qc.invalidateQueries({ queryKey: ["movement-changes", company.id] }),
    ]);
  };

  return {
    async save(movementId: string, input: MovementEditInput) {
      const result = await post<{ movement: Partial<Movement> }>(
        { action: "update_movement", companyId: company.id, movementId, input },
        "Não foi possível salvar o título.",
      );
      // Atualização imediata do cache antes da revalidação.
      qc.setQueryData<Movement[]>(["movements", company.id], (old) =>
        old?.map((m) => (m.id === movementId ? { ...m, ...result.movement } : m)),
      );
      await refresh();
    },
    async remove(movementId: string) {
      await post({ action: "delete_movement", companyId: company.id, movementId }, "Não foi possível excluir o título.");
      qc.setQueryData<Movement[]>(["movements", company.id], (old) =>
        old?.filter((m) => m.id !== movementId),
      );
      await refresh();
    },
    async restore(changeId: string) {
      await post({ action: "restore_movement", companyId: company.id, changeId }, "Não foi possível restaurar o título.");
      await refresh();
    },
  };
}

export function useMovementChanges(enabled: boolean) {
  const { company, ready } = useCompany();
  return useQuery<ChangeRecord[]>({
    queryKey: ["movement-changes", company.id],
    enabled: enabled && ready,
    staleTime: 10_000,
    queryFn: async () => {
      const response = await fetch(`/api/billing?action=changes&companyId=${company.id}`);
      const result = (await response.json()) as ChangeRecord[] | { error?: string };
      if (!response.ok || !Array.isArray(result)) {
        throw new Error(
          !Array.isArray(result)
            ? (result.error ?? "Falha ao carregar o histórico.")
            : "Falha ao carregar o histórico.",
        );
      }
      return result;
    },
  });
}
