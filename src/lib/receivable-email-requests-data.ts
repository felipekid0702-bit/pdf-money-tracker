import { supabase } from "@/integrations/supabase/client";
import type { ReceivableEmailAction, ReceivableEmailRequest } from "./finance";

export async function fetchActiveReceivableEmailRequests(): Promise<ReceivableEmailRequest[]> {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("receivable_email_requests")
    .select("id,movement_id,action_type,status,error_message,created_at,processed_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function requestReceivableEmail(
  movementId: string,
  actionType: ReceivableEmailAction,
): Promise<void> {
  const { error } = await supabase.from("receivable_email_requests").insert({
    movement_id: movementId,
    action_type: actionType,
    status: "pending",
  });
  if (error) throw error;
}
