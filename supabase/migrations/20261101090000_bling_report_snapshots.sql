CREATE TABLE public.bling_report_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_type text NOT NULL CHECK (
    report_type IN ('CONTAS_RECEBER', 'CONTAS_PAGAR', 'NF_SAIDA', 'NF_ENTRADA', 'CADASTROS')
  ),
  file_name text NOT NULL,
  file_hash text NOT NULL,
  parser_version text NOT NULL,
  period_start date,
  period_end date,
  expected_record_count integer,
  record_count integer NOT NULL CHECK (record_count >= 0),
  official_total_cents bigint,
  calculated_total_cents bigint,
  status text NOT NULL CHECK (status IN ('ok', 'total_diverge', 'partial', 'rejected')),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (uploaded_by, report_type, file_hash, parser_version)
);
CREATE INDEX idx_bling_report_imports_latest
  ON public.bling_report_imports(uploaded_by, report_type, created_at DESC);
CREATE TABLE public.bling_report_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.bling_report_imports(id) ON DELETE CASCADE,
  record_index integer NOT NULL CHECK (record_index >= 0),
  record_key text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, record_index),
  UNIQUE (import_id, record_key)
);
CREATE INDEX idx_bling_report_records_import
  ON public.bling_report_records(import_id, record_index);
CREATE TABLE public.bling_cadastro_overrides (
  identity_key text PRIMARY KEY,
  state_code text CHECK (state_code IS NULL OR state_code ~ '^[A-Z]{2}$'),
  country_name text,
  updated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (state_code IS NOT NULL OR country_name IS NOT NULL)
);
CREATE TABLE public.bling_reconciliation_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fiscal_record_id uuid NOT NULL REFERENCES public.bling_report_records(id) ON DELETE CASCADE,
  financial_record_id uuid NOT NULL REFERENCES public.bling_report_records(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN ('SAIDA_AR', 'ENTRADA_AP')),
  match_method text NOT NULL CHECK (
    match_method IN ('ACCESS_KEY', 'NUMBER_AND_TAX_ID', 'EXPLICIT_REFERENCE', 'NUMBER_AND_NAME', 'NAME_AND_AMOUNT', 'MANUAL')
  ),
  confidence numeric(4,3) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL CHECK (status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  decision_reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fiscal_record_id, financial_record_id)
);
CREATE UNIQUE INDEX idx_bling_reconciliation_one_confirmed_title
  ON public.bling_reconciliation_links(financial_record_id)
  WHERE status = 'CONFIRMED';
CREATE INDEX idx_bling_reconciliation_fiscal
  ON public.bling_reconciliation_links(fiscal_record_id, status);
CREATE TABLE public.bling_reconciliation_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid NOT NULL REFERENCES public.bling_reconciliation_links(id) ON DELETE CASCADE,
  changed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  old_status text CHECK (old_status IS NULL OR old_status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  new_status text NOT NULL CHECK (new_status IN ('PENDING', 'CONFIRMED', 'REJECTED')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.bling_report_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bling_report_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bling_cadastro_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bling_reconciliation_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bling_reconciliation_link_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their Bling report imports"
  ON public.bling_report_imports
  FOR SELECT
  TO authenticated
  USING (uploaded_by = auth.uid());
CREATE POLICY "Users read their Bling report records"
  ON public.bling_report_records
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bling_report_imports report
      WHERE report.id = import_id
        AND report.uploaded_by = auth.uid()
    )
  );
CREATE POLICY "Users manage their Bling cadastro overrides"
  ON public.bling_cadastro_overrides
  FOR ALL
  TO authenticated
  USING (updated_by = auth.uid())
  WITH CHECK (updated_by = auth.uid());
CREATE POLICY "Users manage their Bling reconciliation links"
  ON public.bling_reconciliation_links
  FOR ALL
  TO authenticated
  USING (uploaded_by = auth.uid())
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.bling_report_records fiscal_record
      JOIN public.bling_report_imports fiscal_import
        ON fiscal_import.id = fiscal_record.import_id
      WHERE fiscal_record.id = bling_reconciliation_links.fiscal_record_id
        AND fiscal_import.uploaded_by = auth.uid()
        AND (
          (bling_reconciliation_links.link_type = 'SAIDA_AR' AND fiscal_import.report_type = 'NF_SAIDA')
          OR (bling_reconciliation_links.link_type = 'ENTRADA_AP' AND fiscal_import.report_type = 'NF_ENTRADA')
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.bling_report_records financial_record
      JOIN public.bling_report_imports financial_import
        ON financial_import.id = financial_record.import_id
      WHERE financial_record.id = bling_reconciliation_links.financial_record_id
        AND financial_import.uploaded_by = auth.uid()
        AND (
          (bling_reconciliation_links.link_type = 'SAIDA_AR' AND financial_import.report_type = 'CONTAS_RECEBER')
          OR (bling_reconciliation_links.link_type = 'ENTRADA_AP' AND financial_import.report_type = 'CONTAS_PAGAR')
        )
    )
  );
CREATE POLICY "Users read their Bling reconciliation events"
  ON public.bling_reconciliation_link_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bling_reconciliation_links link
      WHERE link.id = bling_reconciliation_link_events.link_id
        AND link.uploaded_by = auth.uid()
    )
  );
CREATE OR REPLACE FUNCTION public.record_bling_reconciliation_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required to change reconciliation links.';
  END IF;
  IF TG_OP = 'INSERT' THEN
    v_old_status := NULL;
  ELSE
    v_old_status := OLD.status;
  END IF;
  IF TG_OP = 'INSERT' OR v_old_status IS DISTINCT FROM NEW.status
    OR (TG_OP = 'UPDATE' AND OLD.decision_reason IS DISTINCT FROM NEW.decision_reason) THEN
    INSERT INTO public.bling_reconciliation_link_events (
      link_id,
      changed_by,
      old_status,
      new_status,
      reason
    )
    VALUES (
      NEW.id,
      auth.uid(),
      v_old_status,
      NEW.status,
      NEW.decision_reason
    );
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER bling_reconciliation_link_event
  BEFORE INSERT OR UPDATE ON public.bling_reconciliation_links
  FOR EACH ROW EXECUTE FUNCTION public.record_bling_reconciliation_event();
REVOKE ALL ON public.bling_report_imports FROM anon, authenticated;
REVOKE ALL ON public.bling_report_records FROM anon, authenticated;
REVOKE ALL ON public.bling_cadastro_overrides FROM anon;
REVOKE ALL ON public.bling_reconciliation_links FROM anon, authenticated;
REVOKE ALL ON public.bling_reconciliation_link_events FROM anon, authenticated;
GRANT SELECT ON public.bling_report_imports TO authenticated;
GRANT SELECT ON public.bling_report_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_cadastro_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bling_reconciliation_links TO authenticated;
GRANT SELECT ON public.bling_reconciliation_link_events TO authenticated;
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
  IF p_report_type NOT IN ('CONTAS_RECEBER', 'CONTAS_PAGAR', 'NF_SAIDA', 'NF_ENTRADA', 'CADASTROS') THEN
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
REVOKE ALL ON FUNCTION public.record_bling_reconciliation_event() FROM PUBLIC, anon, authenticated;
