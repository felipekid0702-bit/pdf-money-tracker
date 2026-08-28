DELETE FROM public.financial_movements a
USING public.financial_movements b
WHERE a.unique_key = b.unique_key AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS financial_movements_unique_key_idx
  ON public.financial_movements (unique_key);

CREATE INDEX IF NOT EXISTS financial_movements_due_date_idx
  ON public.financial_movements (due_date);

ALTER TABLE public.financial_movements REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'financial_movements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.financial_movements;
  END IF;
END $$;