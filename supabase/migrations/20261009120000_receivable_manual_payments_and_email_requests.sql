ALTER TABLE public.financial_movements
  ADD COLUMN IF NOT EXISTS manual_paid_amount numeric(14,2)
  CHECK (
    manual_paid_amount IS NULL
    OR (manual_paid_amount >= 0 AND manual_paid_amount <= original_amount)
  );

ALTER TABLE public.receivable_email_events
  DROP CONSTRAINT IF EXISTS receivable_email_events_reminder_days_check;

ALTER TABLE public.receivable_email_events
  ADD CONSTRAINT receivable_email_events_reminder_days_check
  CHECK (reminder_days IS NULL OR reminder_days >= 0);

CREATE TABLE public.receivable_email_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_id uuid NOT NULL REFERENCES public.financial_movements(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('cobranca_vencido', 'aviso_vencimento')),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'processing', 'sent', 'drafted', 'deferred', 'declined', 'failed')
  ),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX receivable_email_requests_active_title_action_idx
  ON public.receivable_email_requests (movement_id, action_type)
  WHERE status IN ('pending', 'processing');

CREATE INDEX receivable_email_requests_pending_idx
  ON public.receivable_email_requests (created_at)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE ON public.receivable_email_requests TO anon, authenticated;
GRANT ALL ON public.receivable_email_requests TO service_role;

ALTER TABLE public.receivable_email_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open access to receivable email requests"
  ON public.receivable_email_requests
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

CREATE TRIGGER receivable_email_requests_updated_at
  BEFORE UPDATE ON public.receivable_email_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'receivable_email_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.receivable_email_requests;
  END IF;
END $$;
