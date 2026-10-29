ALTER TABLE public.receivable_email_requests
  ALTER COLUMN movement_id DROP NOT NULL;

DO $$
DECLARE
  movement_foreign_key text;
BEGIN
  FOR movement_foreign_key IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.receivable_email_requests'::regclass
      AND confrelid = 'public.financial_movements'::regclass
      AND contype = 'f'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.receivable_email_requests DROP CONSTRAINT %I',
      movement_foreign_key
    );
  END LOOP;
END $$;

ALTER TABLE public.receivable_email_requests
  ADD CONSTRAINT receivable_email_requests_movement_id_fkey
  FOREIGN KEY (movement_id)
  REFERENCES public.financial_movements(id)
  ON DELETE SET NULL;

DO $$
DECLARE
  status_constraint text;
BEGIN
  FOR status_constraint IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.receivable_email_requests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.receivable_email_requests DROP CONSTRAINT %I',
      status_constraint
    );
  END LOOP;
END $$;

ALTER TABLE public.receivable_email_requests
  ADD CONSTRAINT receivable_email_requests_status_check
  CHECK (
    status IN (
      'sending',
      'sent',
      'failed',
      'needs_review',
      'pending',
      'processing',
      'drafted',
      'deferred',
      'declined',
      'cancelled'
    )
  );

CREATE OR REPLACE FUNCTION public.clear_financial_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  LOCK TABLE public.receivable_email_requests IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1
    FROM public.receivable_email_requests
    WHERE status = 'sending'
  ) THEN
    RAISE EXCEPTION 'Há um envio de cobrança em andamento. Aguarde antes de limpar os dados.';
  END IF;

  UPDATE public.receivable_email_requests
  SET
    status = 'cancelled',
    error_code = 'cancelled_by_data_reset',
    movement_id = NULL,
    updated_at = now()
  WHERE status IN ('pending', 'processing');

  DELETE FROM public.bling_cadastro_overrides;
  DELETE FROM public.bling_report_imports;
  DELETE FROM public.financial_movements;
  DELETE FROM public.import_batches;
  DELETE FROM public.fiscal_documents;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_financial_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_financial_data() TO service_role;
