import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCompany } from "@/lib/company-context";

/** Mantém movimentos e ações de envio sincronizados em tempo real. */
export function useRealtimeMovements() {
  const qc = useQueryClient();
  const { company } = useCompany();

  useEffect(() => {
    let movementsTimer: ReturnType<typeof setTimeout> | null = null;
    let eventsTimer: ReturnType<typeof setTimeout> | null = null;
    let lastMovementsInvalidation = 0;
    let movementsDirty = false;
    const invalidate = () => {
      movementsDirty = true;
      if (movementsTimer) return;
      const delay = Math.max(0, 5_000 - (Date.now() - lastMovementsInvalidation));
      movementsTimer = setTimeout(() => {
        movementsTimer = null;
        if (!movementsDirty) return;
        movementsDirty = false;
        lastMovementsInvalidation = Date.now();
        void qc.invalidateQueries({ queryKey: ["movements", company.id] });
      }, delay);
    };

    const channel = supabase
      .channel("financial_movements_stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "financial_movements" },
        invalidate,
      )
      .subscribe();

    const eventsChannel = supabase
      .channel("receivable_email_events_stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "receivable_email_events" },
        () => {
          if (eventsTimer) clearTimeout(eventsTimer);
          eventsTimer = setTimeout(() => {
            void qc.invalidateQueries({ queryKey: ["receivable-email-events", company.id] });
          }, 800);
        },
      )
      .subscribe();

    return () => {
      if (movementsTimer) clearTimeout(movementsTimer);
      if (eventsTimer) clearTimeout(eventsTimer);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(eventsChannel);
    };
  }, [company.id, qc]);
}
