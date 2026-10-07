ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS removed_count integer NOT NULL DEFAULT 0;

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
  removed integer;
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
    unique_key
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
    incoming.unique_key
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
    source_file = EXCLUDED.source_file;

  DELETE FROM public.financial_movements AS stored
  WHERE stored.type = p_type
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_records) AS incoming(unique_key text)
      WHERE incoming.unique_key = stored.unique_key
    );
  GET DIAGNOSTICS removed = ROW_COUNT;

  INSERT INTO public.import_batches (
    type,
    file_name,
    found_count,
    new_count,
    existing_count,
    updated_count,
    removed_count,
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
    removed,
    p_total_amount,
    p_paid_amount,
    p_open_amount,
    p_pdf_total
  );

  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_financial_movements(
  text, jsonb, text, integer, integer, integer, integer, numeric, numeric, numeric, numeric
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_financial_movements(
  text, jsonb, text, integer, integer, integer, integer, numeric, numeric, numeric, numeric
) TO anon, authenticated;
