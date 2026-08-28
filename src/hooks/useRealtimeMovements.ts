import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/** Mantém a base local sincronizada em tempo real com financial_movements. */
export function useRealtimeMovements() {
  const qc = useQueryClient();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const invalidate = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
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

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [qc]);
}
