DELETE FROM public.bling_report_imports
WHERE report_type IN ('NF_SAIDA', 'NF_ENTRADA');

ALTER TABLE public.bling_report_imports
  DROP CONSTRAINT IF EXISTS bling_report_imports_report_type_check;

ALTER TABLE public.bling_report_imports
  ADD CONSTRAINT bling_report_imports_report_type_check
  CHECK (report_type IN ('CONTAS_RECEBER', 'CONTAS_PAGAR', 'CADASTROS'));

DROP TABLE IF EXISTS public.fiscal_documents;

CREATE OR REPLACE FUNCTION public.import_bling_report(
  p_report_type text,
  p_file_name text,
  p_file_hash text,
  p_parser_version text,
  p_period_start date,
  p_period_end date,
  p_expected_record_count integer,
  p_official_total_cents bigint,
  p_calculated_total_cents bigint,
  p_status text,
  p_records jsonb
)
RETURNS TABLE(import_id uuid, inserted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_import_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to import a Bling report.';
  END IF;
  IF p_report_type NOT IN ('CONTAS_RECEBER', 'CONTAS_PAGAR') THEN
    RAISE EXCEPTION 'Unsupported Bling report type.';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' THEN
    RAISE EXCEPTION 'Report records must be a JSON array.';
  END IF;
  IF jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'A Bling report cannot be imported without records.';
  END IF;
  IF p_status NOT IN ('ok', 'total_diverge', 'partial', 'rejected') THEN
    RAISE EXCEPTION 'Unsupported Bling report import status.';
  END IF;

  INSERT INTO public.bling_report_imports (
    report_type,
    file_name,
    file_hash,
    parser_version,
    period_start,
    period_end,
    expected_record_count,
    record_count,
    official_total_cents,
    calculated_total_cents,
    status,
    uploaded_by
  )
  VALUES (
    p_report_type,
    p_file_name,
    p_file_hash,
    p_parser_version,
    p_period_start,
    p_period_end,
    p_expected_record_count,
    jsonb_array_length(p_records),
    p_official_total_cents,
    p_calculated_total_cents,
    p_status,
    auth.uid()
  )
  ON CONFLICT (uploaded_by, report_type, file_hash, parser_version) DO NOTHING
  RETURNING id INTO v_import_id;

  IF v_import_id IS NULL THEN
    SELECT report.id
      INTO v_import_id
    FROM public.bling_report_imports report
    WHERE report.uploaded_by = auth.uid()
      AND report.report_type = p_report_type
      AND report.file_hash = p_file_hash
      AND report.parser_version = p_parser_version;
    RETURN QUERY SELECT v_import_id, false;
    RETURN;
  END IF;

  INSERT INTO public.bling_report_records (import_id, record_index, record_key, data)
  SELECT
    v_import_id,
    (record.ordinality - 1)::integer,
    record.value ->> 'record_key',
    record.value -> 'data'
  FROM jsonb_array_elements(p_records) WITH ORDINALITY AS record(value, ordinality);

  RETURN QUERY SELECT v_import_id, true;
END;
$$;

REVOKE ALL ON FUNCTION public.import_bling_report(
  text, text, text, text, date, date, integer, bigint, bigint, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bling_report(
  text, text, text, text, date, date, integer, bigint, bigint, text, jsonb
) TO authenticated;

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

  DELETE FROM public.bling_cadastro_overrides WHERE true;
  DELETE FROM public.bling_report_imports WHERE true;
  DELETE FROM public.financial_movements WHERE true;
  DELETE FROM public.import_batches WHERE true;
END;
$$;

REVOKE ALL ON FUNCTION public.clear_financial_data() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_financial_data() TO service_role;
