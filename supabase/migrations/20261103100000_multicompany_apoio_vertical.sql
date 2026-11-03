CREATE TABLE public.companies (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text NOT NULL,
  cnpj text NOT NULL UNIQUE,
  logo_path text,
  registration_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.companies (
  id, slug, name, legal_name, cnpj, logo_path, registration_data
)
VALUES
  (
    'f0000000-0000-4000-8000-000000000001',
    'fp-solucao-em-altura',
    'FP Solução em Altura',
    'FP SOLUÇÃO EM ALTURA LTDA.',
    '58.348.102/0001-82',
    'FP Logo - Fundo Branco.png',
    '{}'::jsonb
  ),
  (
    'a0000000-0000-4000-8000-000000000001',
    'apoio-vertical',
    'Apoio Vertical',
    'APOIO VERTICAL EPI LTDA',
    '64.574.363/0001-13',
    'Apoio Vertical Logo.jpeg',
    $company$
    {
      "openingDate": "17/01/2026",
      "tradeName": null,
      "size": "ME",
      "legalNature": "206-2 - Sociedade Empresária Limitada",
      "primaryActivity": "46.42-7-02 - Comércio atacadista de roupas e acessórios para uso profissional e de segurança do trabalho",
      "secondaryActivities": [
        "15.21-1-00 - Fabricação de artigos para viagem, bolsas e semelhantes de qualquer material",
        "32.92-2-02 - Fabricação de equipamentos e acessórios para segurança pessoal e profissional",
        "32.99-0-99 - Fabricação de produtos diversos não especificados anteriormente",
        "33.11-2-00 - Manutenção e reparação de tanques, reservatórios metálicos e caldeiras, exceto para veículos",
        "33.12-1-02 - Manutenção e reparação de aparelhos e instrumentos de medida, teste e controle",
        "33.14-7-02 - Manutenção e reparação de equipamentos hidráulicos e pneumáticos, exceto válvulas",
        "33.14-7-03 - Manutenção e reparação de válvulas industriais",
        "33.14-7-99 - Manutenção e reparação de outras máquinas e equipamentos para usos industriais não especificados anteriormente",
        "33.17-1-01 - Manutenção e reparação de embarcações e estruturas flutuantes",
        "33.19-8-00 - Manutenção e reparação de equipamentos e produtos não especificados anteriormente",
        "33.21-0-00 - Instalação de máquinas e equipamentos industriais",
        "41.20-4-00 - Construção de edifícios",
        "42.92-8-01 - Montagem de estruturas metálicas",
        "42.92-8-02 - Obras de montagem industrial",
        "43.21-5-00 - Instalação e manutenção elétrica",
        "43.29-1-01 - Instalação de painéis publicitários",
        "43.30-4-01 - Impermeabilização em obras de engenharia civil",
        "43.30-4-04 - Serviços de pintura de edifícios em geral",
        "43.30-4-99 - Outras obras de acabamento da construção",
        "43.99-1-02 - Montagem e desmontagem de andaimes e outras estruturas temporárias",
        "43.99-1-03 - Obras de alvenaria",
        "46.43-5-01 - Comércio atacadista de calçados",
        "46.49-4-99 - Comércio atacadista de outros equipamentos e artigos de uso pessoal e doméstico não especificados anteriormente",
        "47.13-0-02 - Lojas de variedades, exceto lojas de departamentos ou magazines",
        "47.42-3-00 - Comércio varejista de material elétrico",
        "47.44-0-01 - Comércio varejista de ferragens e ferramentas",
        "47.44-0-99 - Comércio varejista de materiais de construção em geral",
        "47.59-8-99 - Comércio varejista de outros artigos de uso pessoal e doméstico não especificados anteriormente",
        "47.63-6-02 - Comércio varejista de artigos esportivos",
        "47.63-6-04 - Comércio varejista de artigos de caça, pesca e camping",
        "47.81-4-00 - Comércio varejista de artigos do vestuário e acessórios",
        "47.82-2-01 - Comércio varejista de calçados",
        "47.89-0-99 - Comércio varejista de outros produtos não especificados anteriormente",
        "77.39-0-99 - Aluguel de outras máquinas e equipamentos comerciais e industriais não especificados anteriormente, sem operador",
        "85.99-6-04 - Treinamento em desenvolvimento profissional e gerencial",
        "93.19-1-99 - Outras atividades esportivas não especificadas anteriormente"
      ],
      "address": {
        "street": "AV MINAS GERAIS",
        "number": "21",
        "complement": null,
        "district": "JARDIM ATLÂNTICO",
        "postalCode": "29.175-271",
        "city": "SERRA",
        "state": "ES"
      },
      "email": "UBIANOR@CONTALEGAL.COM.BR",
      "phone": "(22) 2772-2223 / (0000) 0000-0000",
      "status": "ATIVA",
      "statusDate": "17/01/2026",
      "issuedAt": "19/01/2026 às 14:42:11"
    }
    $company$::jsonb
  )
ON CONFLICT (id) DO UPDATE SET
  slug = EXCLUDED.slug,
  name = EXCLUDED.name,
  legal_name = EXCLUDED.legal_name,
  cnpj = EXCLUDED.cnpj,
  logo_path = EXCLUDED.logo_path,
  registration_data = EXCLUDED.registration_data,
  updated_at = now();

CREATE TABLE public.company_memberships (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_id)
);

INSERT INTO public.company_memberships (user_id, company_id)
SELECT users.id, companies.id
FROM auth.users AS users
CROSS JOIN public.companies AS companies
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.has_company_access(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.company_memberships AS membership
    WHERE membership.user_id = auth.uid()
      AND membership.company_id = p_company_id
  );
$$;

REVOKE ALL ON FUNCTION public.has_company_access(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_company_access(uuid) TO authenticated, service_role;

ALTER TABLE public.financial_movements
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.import_batches
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.receivable_contacts
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.receivable_email_events
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.receivable_email_requests
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.bling_report_imports
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.bling_report_records
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.bling_cadastro_overrides
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.bling_reconciliation_links
  ADD COLUMN IF NOT EXISTS company_id uuid;
ALTER TABLE public.bling_reconciliation_link_events
  ADD COLUMN IF NOT EXISTS company_id uuid;

UPDATE public.financial_movements
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.import_batches
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.receivable_contacts
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.receivable_email_events
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.receivable_email_requests AS request
SET company_id = COALESCE(
  movement.company_id,
  'f0000000-0000-4000-8000-000000000001'::uuid
)
FROM public.financial_movements AS movement
WHERE request.movement_id = movement.id
  AND request.company_id IS NULL;
UPDATE public.receivable_email_requests
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.bling_report_imports
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.bling_report_records AS record
SET company_id = report.company_id
FROM public.bling_report_imports AS report
WHERE record.import_id = report.id
  AND record.company_id IS NULL;
UPDATE public.bling_report_records
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.bling_cadastro_overrides
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.bling_reconciliation_links AS link
SET company_id = fiscal_record.company_id
FROM public.bling_report_records AS fiscal_record
WHERE link.fiscal_record_id = fiscal_record.id
  AND link.company_id IS NULL;
UPDATE public.bling_reconciliation_links
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;
UPDATE public.bling_reconciliation_link_events AS event
SET company_id = link.company_id
FROM public.bling_reconciliation_links AS link
WHERE event.link_id = link.id
  AND event.company_id IS NULL;
UPDATE public.bling_reconciliation_link_events
SET company_id = 'f0000000-0000-4000-8000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE public.financial_movements
  ALTER COLUMN company_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS financial_movements_unique_key_key;
DROP INDEX IF EXISTS public.financial_movements_unique_key_idx;
CREATE UNIQUE INDEX financial_movements_company_unique_key_idx
  ON public.financial_movements (company_id, unique_key);
CREATE UNIQUE INDEX financial_movements_id_company_idx
  ON public.financial_movements (id, company_id);
ALTER TABLE public.financial_movements
  ADD CONSTRAINT financial_movements_company_id_fkey
  FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;

ALTER TABLE public.import_batches
  ALTER COLUMN company_id SET NOT NULL,
  ADD CONSTRAINT import_batches_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT;
ALTER TABLE public.receivable_contacts
  ALTER COLUMN company_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS receivable_contacts_match_key_key,
  ADD CONSTRAINT receivable_contacts_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT receivable_contacts_company_match_key_key UNIQUE (company_id, match_key);
ALTER TABLE public.receivable_email_events
  ALTER COLUMN company_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS receivable_email_events_event_key_key,
  ADD CONSTRAINT receivable_email_events_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT receivable_email_events_company_event_key_key UNIQUE (company_id, event_key);
ALTER TABLE public.receivable_email_requests
  ALTER COLUMN company_id SET NOT NULL,
  ADD CONSTRAINT receivable_email_requests_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS receivable_email_requests_movement_id_fkey,
  ADD CONSTRAINT receivable_email_requests_movement_company_fkey
    FOREIGN KEY (movement_id, company_id)
    REFERENCES public.financial_movements(id, company_id)
    ON DELETE SET NULL (movement_id);
DROP INDEX IF EXISTS public.receivable_email_requests_idempotency_key_idx;
CREATE UNIQUE INDEX receivable_email_requests_company_idempotency_key_idx
  ON public.receivable_email_requests (company_id, idempotency_key);
DROP INDEX IF EXISTS public.receivable_email_requests_active_title_action_idx;
CREATE UNIQUE INDEX receivable_email_requests_active_title_action_idx
  ON public.receivable_email_requests (company_id, movement_id, action_type)
  WHERE status IN ('pending', 'processing');
ALTER TABLE public.bling_report_imports
  ALTER COLUMN company_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS bling_report_imports_uploaded_by_report_type_file_hash_parser_version_key,
  ADD CONSTRAINT bling_report_imports_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bling_report_imports_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT bling_report_imports_company_file_key
    UNIQUE (company_id, uploaded_by, report_type, file_hash, parser_version);
DROP INDEX IF EXISTS public.idx_bling_report_imports_latest;
CREATE INDEX idx_bling_report_imports_latest
  ON public.bling_report_imports(company_id, uploaded_by, report_type, created_at DESC);

ALTER TABLE public.bling_report_records
  ALTER COLUMN company_id SET NOT NULL,
  ADD CONSTRAINT bling_report_records_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bling_report_records_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT bling_report_records_import_company_fkey
    FOREIGN KEY (import_id, company_id)
    REFERENCES public.bling_report_imports(id, company_id) ON DELETE CASCADE;
ALTER TABLE public.bling_cadastro_overrides
  ALTER COLUMN company_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS bling_cadastro_overrides_pkey,
  ADD CONSTRAINT bling_cadastro_overrides_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bling_cadastro_overrides_pkey PRIMARY KEY (company_id, identity_key);
ALTER TABLE public.bling_reconciliation_links
  ALTER COLUMN company_id SET NOT NULL,
  DROP CONSTRAINT IF EXISTS bling_reconciliation_links_fiscal_record_id_financial_record_id_key,
  ADD CONSTRAINT bling_reconciliation_links_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bling_reconciliation_links_id_company_key UNIQUE (id, company_id),
  ADD CONSTRAINT bling_reconciliation_links_company_records_key
    UNIQUE (company_id, fiscal_record_id, financial_record_id),
  ADD CONSTRAINT bling_reconciliation_links_fiscal_company_fkey
    FOREIGN KEY (fiscal_record_id, company_id)
    REFERENCES public.bling_report_records(id, company_id) ON DELETE CASCADE,
  ADD CONSTRAINT bling_reconciliation_links_financial_company_fkey
    FOREIGN KEY (financial_record_id, company_id)
    REFERENCES public.bling_report_records(id, company_id) ON DELETE CASCADE;
DROP INDEX IF EXISTS public.idx_bling_reconciliation_one_confirmed_title;
CREATE UNIQUE INDEX idx_bling_reconciliation_one_confirmed_title
  ON public.bling_reconciliation_links(company_id, financial_record_id)
  WHERE status = 'CONFIRMED';
ALTER TABLE public.bling_reconciliation_link_events
  ALTER COLUMN company_id SET NOT NULL,
  ADD CONSTRAINT bling_reconciliation_link_events_company_id_fkey
    FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE RESTRICT,
  ADD CONSTRAINT bling_reconciliation_link_events_link_company_fkey
    FOREIGN KEY (link_id, company_id)
    REFERENCES public.bling_reconciliation_links(id, company_id) ON DELETE CASCADE;

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
      link_id, company_id, changed_by, old_status, new_status, reason
    )
    VALUES (
      NEW.id, NEW.company_id, auth.uid(), v_old_status, NEW.status, NEW.decision_reason
    );
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.sync_financial_movements(
  text, jsonb, text, integer, integer, integer, integer, numeric, numeric, numeric, numeric
);
CREATE OR REPLACE FUNCTION public.sync_financial_movements(
  p_company_id uuid,
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
  IF NOT public.has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'Access to the selected company is not authorized.';
  END IF;
  IF p_type IS NULL OR p_type NOT IN ('RECEITA', 'DESPESA') THEN
    RAISE EXCEPTION 'Tipo de movimento inválido: %', p_type;
  END IF;
  IF p_records IS NULL OR jsonb_typeof(p_records) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'A sincronização exige uma lista não vazia de registros.';
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
    company_id, type, document, counterparty, counterparty_document, description,
    issue_date, due_date, payment_date, original_amount, paid_amount, open_amount,
    status, source, source_file, unique_key
  )
  SELECT
    p_company_id, incoming.type, incoming.document, incoming.counterparty,
    incoming.counterparty_document, incoming.description, incoming.issue_date,
    incoming.due_date, incoming.payment_date, incoming.original_amount,
    incoming.paid_amount, incoming.open_amount, incoming.status, incoming.source,
    incoming.source_file, incoming.unique_key
  FROM jsonb_to_recordset(p_records) AS incoming(
    type text, document text, counterparty text, counterparty_document text,
    description text, issue_date date, due_date date, payment_date date,
    original_amount numeric(14,2), paid_amount numeric(14,2), open_amount numeric(14,2),
    status text, source text, source_file text, unique_key text
  )
  ON CONFLICT (company_id, unique_key) DO UPDATE SET
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
  WHERE stored.company_id = p_company_id
    AND stored.type = p_type
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_to_recordset(p_records) AS incoming(unique_key text)
      WHERE incoming.unique_key = stored.unique_key
    );
  GET DIAGNOSTICS removed = ROW_COUNT;

  INSERT INTO public.import_batches (
    company_id, type, file_name, found_count, new_count, existing_count,
    updated_count, removed_count, total_amount, paid_amount, open_amount, pdf_total
  )
  VALUES (
    p_company_id, p_type, p_file_name, p_found_count, p_new_count, p_existing_count,
    p_updated_count, removed, p_total_amount, p_paid_amount, p_open_amount, p_pdf_total
  );
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_financial_movements(
  uuid, text, jsonb, text, integer, integer, integer, integer, numeric, numeric, numeric, numeric
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_financial_movements(
  uuid, text, jsonb, text, integer, integer, integer, integer, numeric, numeric, numeric, numeric
) TO authenticated;

DROP FUNCTION IF EXISTS public.import_bling_report(
  text, text, text, text, date, date, integer, bigint, bigint, text, jsonb
);
CREATE OR REPLACE FUNCTION public.import_bling_report(
  p_company_id uuid,
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
  IF auth.uid() IS NULL OR NOT public.has_company_access(p_company_id) THEN
    RAISE EXCEPTION 'Access to the selected company is not authorized.';
  END IF;
  IF p_report_type NOT IN ('CONTAS_RECEBER', 'CONTAS_PAGAR') THEN
    RAISE EXCEPTION 'Unsupported Bling report type.';
  END IF;
  IF jsonb_typeof(p_records) <> 'array' OR jsonb_array_length(p_records) = 0 THEN
    RAISE EXCEPTION 'A Bling report requires a non-empty records array.';
  END IF;
  IF p_status NOT IN ('ok', 'total_diverge', 'partial', 'rejected') THEN
    RAISE EXCEPTION 'Unsupported Bling report import status.';
  END IF;

  INSERT INTO public.bling_report_imports (
    company_id, report_type, file_name, file_hash, parser_version, period_start,
    period_end, expected_record_count, record_count, official_total_cents,
    calculated_total_cents, status, uploaded_by
  )
  VALUES (
    p_company_id, p_report_type, p_file_name, p_file_hash, p_parser_version,
    p_period_start, p_period_end, p_expected_record_count, jsonb_array_length(p_records),
    p_official_total_cents, p_calculated_total_cents, p_status, auth.uid()
  )
  ON CONFLICT (company_id, uploaded_by, report_type, file_hash, parser_version) DO NOTHING
  RETURNING id INTO v_import_id;

  IF v_import_id IS NULL THEN
    SELECT report.id
      INTO v_import_id
    FROM public.bling_report_imports AS report
    WHERE report.company_id = p_company_id
      AND report.uploaded_by = auth.uid()
      AND report.report_type = p_report_type
      AND report.file_hash = p_file_hash
      AND report.parser_version = p_parser_version;
    RETURN QUERY SELECT v_import_id, false;
    RETURN;
  END IF;

  INSERT INTO public.bling_report_records (
    import_id, company_id, record_index, record_key, data
  )
  SELECT
    v_import_id,
    p_company_id,
    (record.ordinality - 1)::integer,
    record.value ->> 'record_key',
    record.value -> 'data'
  FROM jsonb_array_elements(p_records) WITH ORDINALITY AS record(value, ordinality);

  RETURN QUERY SELECT v_import_id, true;
END;
$$;
REVOKE ALL ON FUNCTION public.import_bling_report(
  uuid, text, text, text, text, date, date, integer, bigint, bigint, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_bling_report(
  uuid, text, text, text, text, date, date, integer, bigint, bigint, text, jsonb
) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_financial_data(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_company_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.companies WHERE id = p_company_id
  ) THEN
    RAISE EXCEPTION 'A empresa informada é inválida.';
  END IF;

  LOCK TABLE public.receivable_email_requests IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS (
    SELECT 1
    FROM public.receivable_email_requests
    WHERE company_id = p_company_id
      AND status = 'sending'
  ) THEN
    RAISE EXCEPTION 'Há um envio de cobrança em andamento. Aguarde antes de limpar os dados.';
  END IF;

  UPDATE public.receivable_email_requests
  SET
    status = 'cancelled',
    error_code = 'cancelled_by_data_reset',
    movement_id = NULL,
    updated_at = now()
  WHERE company_id = p_company_id
    AND status IN ('pending', 'processing');

  DELETE FROM public.bling_cadastro_overrides WHERE company_id = p_company_id;
  DELETE FROM public.bling_report_imports WHERE company_id = p_company_id;
  DELETE FROM public.financial_movements WHERE company_id = p_company_id;
  DELETE FROM public.import_batches WHERE company_id = p_company_id;
END;
$$;

DROP FUNCTION IF EXISTS public.clear_financial_data();
REVOKE ALL ON FUNCTION public.clear_financial_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_financial_data(uuid) TO service_role;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read their company records"
  ON public.companies FOR SELECT TO authenticated
  USING (public.has_company_access(id));
CREATE POLICY "Users read their own company memberships"
  ON public.company_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid());
REVOKE ALL ON public.companies, public.company_memberships FROM anon, authenticated;
GRANT SELECT ON public.companies, public.company_memberships TO authenticated;
GRANT ALL ON public.companies, public.company_memberships TO service_role;

DO $$
DECLARE
  target_table text;
  existing_policy record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'financial_movements',
    'import_batches',
    'receivable_contacts',
    'receivable_email_events',
    'receivable_email_requests',
    'bling_report_imports',
    'bling_report_records',
    'bling_cadastro_overrides',
    'bling_reconciliation_links',
    'bling_reconciliation_link_events'
  ]
  LOOP
    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', existing_policy.policyname, target_table);
    END LOOP;
  END LOOP;
END $$;

CREATE POLICY "Users access movements in assigned companies"
  ON public.financial_movements FOR ALL TO authenticated
  USING (public.has_company_access(company_id))
  WITH CHECK (public.has_company_access(company_id));
CREATE POLICY "Users access import batches in assigned companies"
  ON public.import_batches FOR ALL TO authenticated
  USING (public.has_company_access(company_id))
  WITH CHECK (public.has_company_access(company_id));
CREATE POLICY "Users access receivable contacts in assigned companies"
  ON public.receivable_contacts FOR ALL TO authenticated
  USING (public.has_company_access(company_id))
  WITH CHECK (public.has_company_access(company_id));
CREATE POLICY "Users access receivable events in assigned companies"
  ON public.receivable_email_events FOR ALL TO authenticated
  USING (public.has_company_access(company_id))
  WITH CHECK (public.has_company_access(company_id));
CREATE POLICY "Users access receivable requests in assigned companies"
  ON public.receivable_email_requests FOR ALL TO authenticated
  USING (public.has_company_access(company_id))
  WITH CHECK (public.has_company_access(company_id));
CREATE POLICY "Users read Bling imports in assigned companies"
  ON public.bling_report_imports FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid() AND public.has_company_access(company_id));
CREATE POLICY "Users read Bling records in assigned companies"
  ON public.bling_report_records FOR SELECT TO authenticated
  USING (
    public.has_company_access(company_id)
    AND EXISTS (
      SELECT 1 FROM public.bling_report_imports AS report
      WHERE report.id = import_id
        AND report.company_id = bling_report_records.company_id
        AND report.uploaded_by = auth.uid()
    )
  );
CREATE POLICY "Users manage Bling overrides in assigned companies"
  ON public.bling_cadastro_overrides FOR ALL TO authenticated
  USING (updated_by = auth.uid() AND public.has_company_access(company_id))
  WITH CHECK (updated_by = auth.uid() AND public.has_company_access(company_id));
CREATE POLICY "Users manage reconciliation links in assigned companies"
  ON public.bling_reconciliation_links FOR ALL TO authenticated
  USING (uploaded_by = auth.uid() AND public.has_company_access(company_id))
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.has_company_access(company_id)
    AND EXISTS (
      SELECT 1
      FROM public.bling_report_records AS record
      JOIN public.bling_report_imports AS report ON report.id = record.import_id
      WHERE record.id = fiscal_record_id
        AND record.company_id = bling_reconciliation_links.company_id
        AND report.company_id = bling_reconciliation_links.company_id
        AND report.uploaded_by = auth.uid()
        AND (
          (link_type = 'SAIDA_AR' AND report.report_type = 'NF_SAIDA')
          OR (link_type = 'ENTRADA_AP' AND report.report_type = 'NF_ENTRADA')
        )
    )
    AND EXISTS (
      SELECT 1
      FROM public.bling_report_records AS record
      JOIN public.bling_report_imports AS report ON report.id = record.import_id
      WHERE record.id = financial_record_id
        AND record.company_id = bling_reconciliation_links.company_id
        AND report.company_id = bling_reconciliation_links.company_id
        AND report.uploaded_by = auth.uid()
        AND (
          (link_type = 'SAIDA_AR' AND report.report_type = 'CONTAS_RECEBER')
          OR (link_type = 'ENTRADA_AP' AND report.report_type = 'CONTAS_PAGAR')
        )
    )
  );
CREATE POLICY "Users read reconciliation events in assigned companies"
  ON public.bling_reconciliation_link_events FOR SELECT TO authenticated
  USING (
    public.has_company_access(company_id)
    AND EXISTS (
      SELECT 1 FROM public.bling_reconciliation_links AS link
      WHERE link.id = link_id
        AND link.company_id = bling_reconciliation_link_events.company_id
        AND link.uploaded_by = auth.uid()
    )
  );

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.financial_movements, public.import_batches TO authenticated;
GRANT SELECT, INSERT ON public.receivable_email_events TO authenticated;
GRANT SELECT ON public.bling_report_imports, public.bling_report_records,
  public.bling_reconciliation_link_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bling_cadastro_overrides TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bling_reconciliation_links TO authenticated;

CREATE INDEX financial_movements_company_due_date_idx
  ON public.financial_movements(company_id, due_date);
CREATE INDEX import_batches_company_created_at_idx
  ON public.import_batches(company_id, created_at DESC);
CREATE INDEX receivable_email_events_company_sent_at_idx
  ON public.receivable_email_events(company_id, sent_at DESC);
CREATE INDEX receivable_email_requests_company_movement_idx
  ON public.receivable_email_requests(company_id, movement_id, created_at DESC);
