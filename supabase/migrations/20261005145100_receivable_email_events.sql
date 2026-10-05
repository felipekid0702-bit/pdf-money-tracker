CREATE TABLE public.receivable_email_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL,
  action_type text NOT NULL CHECK (
    action_type IN ('cobranca_vencido', 'aviso_vencimento', 'boleto_enviado')
  ),
  recipient_email text,
  subject text,
  title_count integer NOT NULL CHECK (title_count > 0),
  title_documents text[] NOT NULL DEFAULT '{}',
  reminder_days integer CHECK (reminder_days IN (1, 7, 14)),
  aging_ranges text[] NOT NULL DEFAULT '{}',
  title_details jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(title_details) = 'array'),
  CHECK (
    (action_type = 'aviso_vencimento' AND reminder_days IS NOT NULL)
    OR (
      action_type IN ('cobranca_vencido', 'boleto_enviado')
      AND reminder_days IS NULL
    )
  )
);

CREATE INDEX receivable_email_events_sent_at_idx
  ON public.receivable_email_events (sent_at DESC);

GRANT SELECT, INSERT ON public.receivable_email_events TO anon, authenticated;
GRANT ALL ON public.receivable_email_events TO service_role;

ALTER TABLE public.receivable_email_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open access to receivable email events"
  ON public.receivable_email_events
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'receivable_email_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.receivable_email_events;
  END IF;
END $$;
