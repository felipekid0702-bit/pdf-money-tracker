import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Mantém movimentos e ações de envio sincronizados em tempo real. */
export function useRealtimeMovements() {
  const qc = useQueryClient();

  useEffect(() => {
    let movementsTimer: ReturnType<typeof setTimeout> | null = null;
    let eventsTimer: ReturnType<typeof setTimeout> | null = null;
    let requestsTimer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (movementsTimer) clearTimeout(movementsTimer);
      movementsTimer = setTimeout(() => {
        void qc.invalidateQueries({ queryKey: ["movements"] });
      }, 800);
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
            void qc.invalidateQueries({ queryKey: ["receivable-email-events"] });
          }, 800);
        },
      )
      .subscribe();

    const requestsChannel = supabase
      .channel("receivable_email_requests_stream")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "receivable_email_requests" },
        () => {
          if (requestsTimer) clearTimeout(requestsTimer);
          requestsTimer = setTimeout(() => {
            void qc.invalidateQueries({ queryKey: ["receivable-email-requests"] });
          }, 800);
        },
      )
      .subscribe();

    return () => {
      if (movementsTimer) clearTimeout(movementsTimer);
      if (eventsTimer) clearTimeout(eventsTimer);
      if (requestsTimer) clearTimeout(requestsTimer);
      void supabase.removeChannel(channel);
      void supabase.removeChannel(eventsChannel);
      void supabase.removeChannel(requestsChannel);
    };
  }, [qc]);
}
