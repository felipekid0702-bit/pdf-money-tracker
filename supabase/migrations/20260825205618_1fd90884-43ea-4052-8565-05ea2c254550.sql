CREATE TABLE public.financial_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('RECEITA','DESPESA')),
  document text,
  counterparty text,
  counterparty_document text,
  description text,
  issue_date date,
  due_date date,
  payment_date date,
  original_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  open_amount numeric(14,2) NOT NULL DEFAULT 0,
  status text NOT NULL,
  source text NOT NULL CHECK (source IN ('BLING_RECEBER','BLING_PAGAR')),
  source_file text,
  unique_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_fm_type ON public.financial_movements(type);
CREATE INDEX idx_fm_due ON public.financial_movements(due_date);
CREATE INDEX idx_fm_counterparty ON public.financial_movements(counterparty);

CREATE TABLE public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('RECEITA','DESPESA')),
  file_name text,
  found_count integer NOT NULL DEFAULT 0,
  new_count integer NOT NULL DEFAULT 0,
  existing_count integer NOT NULL DEFAULT 0,
  updated_count integer NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  paid_amount numeric(14,2) NOT NULL DEFAULT 0,
  open_amount numeric(14,2) NOT NULL DEFAULT 0,
  pdf_total numeric(14,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_movements TO anon, authenticated;
GRANT ALL ON public.financial_movements TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO anon, authenticated;
GRANT ALL ON public.import_batches TO service_role;

ALTER TABLE public.financial_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open access to financial movements" ON public.financial_movements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Open access to import batches" ON public.import_batches FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER fm_updated_at BEFORE UPDATE ON public.financial_movements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();