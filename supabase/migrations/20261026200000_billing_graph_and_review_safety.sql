ALTER TABLE public.financial_movements
  ADD COLUMN IF NOT EXISTS sync_state text NOT NULL DEFAULT 'current'
    CHECK (sync_state IN ('current', 'review'));

ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS review_required_count integer NOT NULL DEFAULT 0;

CREATE TABLE public.receivable_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_key text NOT NULL UNIQUE,
  counterparty_name text NOT NULL,
  email text NOT NULL,
  cc text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (match_key <> ''),
  CHECK (email <> '')
);

CREATE TABLE IF NOT EXISTS public.receivable_email_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL DEFAULT ('legacy:' || gen_random_uuid()::text),
  movement_id uuid REFERENCES public.financial_movements(id) ON DELETE SET NULL,
  action_type text NOT NULL CHECK (action_type IN ('cobranca_vencido', 'aviso_vencimento')),
  status text NOT NULL CHECK (
    status IN (
      'sending', 'sent', 'failed', 'needs_review',
      'pending', 'processing', 'drafted', 'deferred', 'declined'
    )
  ),
  recipient_email text NOT NULL DEFAULT 'legacy-unavailable',
  subject text NOT NULL DEFAULT 'Legacy request',
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.receivable_email_requests
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS recipient_email text NOT NULL DEFAULT 'legacy-unavailable',
  ADD COLUMN IF NOT EXISTS subject text NOT NULL DEFAULT 'Legacy request',
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE public.receivable_email_requests
SET idempotency_key = 'legacy:' || id::text
WHERE idempotency_key IS NULL;

ALTER TABLE public.receivable_email_requests
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN movement_id DROP NOT NULL;

DO $$
DECLARE
  status_constraint record;
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
      status_constraint.conname
    );
  END LOOP;
END $$;

ALTER TABLE public.receivable_email_requests
  ADD CONSTRAINT receivable_email_requests_status_check
  CHECK (
    status IN (
      'sending', 'sent', 'failed', 'needs_review',
      'pending', 'processing', 'drafted', 'deferred', 'declined'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS receivable_email_requests_idempotency_key_idx
  ON public.receivable_email_requests (idempotency_key);

CREATE INDEX receivable_email_requests_movement_idx
  ON public.receivable_email_requests (movement_id, created_at DESC);

CREATE TABLE public.billing_login_attempts (
  ip_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)
);

ALTER TABLE public.receivable_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.receivable_email_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_login_attempts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  existing_policy record;
BEGIN
  FOR existing_policy IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'receivable_email_requests'
  LOOP
    EXECUTE format(
      'DROP POLICY %I ON public.receivable_email_requests',
      existing_policy.policyname
    );
  END LOOP;
END $$;

REVOKE ALL ON public.receivable_contacts FROM anon, authenticated;
REVOKE ALL ON public.receivable_email_requests FROM anon, authenticated;
REVOKE ALL ON public.billing_login_attempts FROM anon, authenticated;
GRANT ALL ON public.receivable_contacts TO service_role;
GRANT ALL ON public.receivable_email_requests TO service_role;
GRANT ALL ON public.billing_login_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.consume_billing_login_attempt(p_ip_hash text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_attempts integer;
BEGIN
  INSERT INTO public.billing_login_attempts (ip_hash, window_started_at, attempt_count)
  VALUES (p_ip_hash, now(), 1)
  ON CONFLICT (ip_hash) DO UPDATE
  SET
    window_started_at = CASE
      WHEN public.billing_login_attempts.window_started_at < now() - interval '15 minutes'
        THEN now()
      ELSE public.billing_login_attempts.window_started_at
    END,
    attempt_count = CASE
      WHEN public.billing_login_attempts.window_started_at < now() - interval '15 minutes'
        THEN 1
      ELSE public.billing_login_attempts.attempt_count + 1
    END
  RETURNING attempt_count INTO current_attempts;

  RETURN current_attempts <= 10;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_billing_login_attempt(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_billing_login_attempt(text) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_financial_movements(
  p_type text,
  p_records jsonb,
  p_file_name text,
  p_found_count integer,
  p_new_count integer,
  p_existing_count integer,
  p_updated_count integer,
  p_total_amount numeric(14,2),
  p_paid_amount numeric(14,2),
  p_open_amount numeric(14,2),
  p_pdf_total numeric(14,2)
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  review_required integer;
BEGIN
  IF p_type IS NULL OR p_type NOT IN ('RECEITA', 'DESPESA') THEN
    RAISE EXCEPTION 'Tipo de movimento inválido: %', p_type;
  END IF;

  IF p_records IS NULL OR jsonb_typeof(p_records) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'A sincronização exige uma lista de registros.';
  END IF;

  IF jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'A sincronização exige um conjunto não vazio de registros.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_records) AS incoming(type text, source text, unique_key text)
    WHERE incoming.type IS DISTINCT FROM p_type
      OR incoming.source IS DISTINCT FROM CASE
        WHEN p_type = 'RECEITA' THEN 'BLING_RECEBER'
        ELSE 'BLING_PAGAR'
      END
      OR incoming.unique_key IS NULL
  ) THEN
    RAISE EXCEPTION 'O PDF contém registros incompatíveis com o tipo informado.';
  END IF;

  IF EXISTS (
    SELECT incoming.unique_key
    FROM jsonb_to_recordset(p_records) AS incoming(unique_key text)
    GROUP BY incoming.unique_key
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'O PDF contém chaves de títulos repetidas.';
  END IF;

  INSERT INTO public.financial_movements (
    type,
    document,
    counterparty,
    counterparty_document,
    description,
    issue_date,
    due_date,
    payment_date,
    original_amount,
    paid_amount,
    open_amount,
    status,
    source,
    source_file,
    unique_key,
    sync_state
  )
  SELECT
    incoming.type,
    incoming.document,
    incoming.counterparty,
    incoming.counterparty_document,
    incoming.description,
    incoming.issue_date,
    incoming.due_date,
    incoming.payment_date,
    incoming.original_amount,
    incoming.paid_amount,
    incoming.open_amount,
    incoming.status,
    incoming.source,
    incoming.source_file,
    incoming.unique_key,
    'current'
  FROM jsonb_to_recordset(p_records) AS incoming(
    type text,
    document text,
    counterparty text,
    counterparty_document text,
    description text,
    issue_date date,
    due_date date,
    payment_date date,
    original_amount numeric(14,2),
    paid_amount numeric(14,2),
    open_amount numeric(14,2),
    status text,
    source text,
    source_file text,
    unique_key text
  )
  ON CONFLICT (unique_key) DO UPDATE SET
    type = EXCLUDED.type,
    document = EXCLUDED.document,
    counterparty = EXCLUDED.counterparty,
    counterparty_document = EXCLUDED.counterparty_document,
    description = EXCLUDED.description,
    issue_date = EXCLUDED.issue_date,
    due_date = EXCLUDED.due_date,
    payment_date = EXCLUDED.payment_date,
    original_amount = EXCLUDED.original_amount,
    paid_amount = EXCLUDED.paid_amount,
    open_amount = EXCLUDED.open_amount,
    status = EXCLUDED.status,
    source = EXCLUDED.source,
    source_file = EXCLUDED.source_file,
    sync_state = 'current';

  SELECT count(*) INTO review_required
  FROM public.financial_movements AS stored
  WHERE stored.type = p_type
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_records) AS incoming(unique_key text)
      WHERE incoming.unique_key = stored.unique_key
    );

  UPDATE public.financial_movements AS stored
  SET sync_state = 'review'
  WHERE stored.type = p_type
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_records) AS incoming(unique_key text)
      WHERE incoming.unique_key = stored.unique_key
    );

  INSERT INTO public.import_batches (
    type,
    file_name,
    found_count,
    new_count,
    existing_count,
    updated_count,
    removed_count,
    review_required_count,
    total_amount,
    paid_amount,
    open_amount,
    pdf_total
  )
  VALUES (
    p_type,
    p_file_name,
    p_found_count,
    p_new_count,
    p_existing_count,
    p_updated_count,
    0,
    review_required,
    p_total_amount,
    p_paid_amount,
    p_open_amount,
    p_pdf_total
  );

  RETURN review_required;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_financial_movements(
  text, jsonb, text, integer, integer, integer, integer, numeric, numeric, numeric, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_financial_movements(
  text, jsonb, text, integer, integer, integer, integer, numeric, numeric, numeric, numeric
) TO anon, authenticated;
