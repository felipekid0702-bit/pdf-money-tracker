CREATE TABLE public.fiscal_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direction text NOT NULL CHECK (direction IN ('ENTRADA', 'SAIDA')),
  document_number text NOT NULL,
  invoice_type text,
  issue_date date NOT NULL,
  counterparty text NOT NULL,
  status text NOT NULL,
  amount numeric(14,2) NOT NULL,
  source_file text NOT NULL,
  unique_key text NOT NULL UNIQUE,
  imported_at timestamptz NOT NULL DEFAULT now(),
  CHECK (document_number <> ''),
  CHECK (counterparty <> ''),
  CHECK (status <> '')
);

CREATE INDEX fiscal_documents_direction_date_idx
  ON public.fiscal_documents (direction, issue_date DESC);

ALTER TABLE public.fiscal_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscal_documents FROM anon, authenticated;
GRANT ALL ON public.fiscal_documents TO service_role;
