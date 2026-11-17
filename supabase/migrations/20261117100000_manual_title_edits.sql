-- Edição manual de títulos: histórico de alterações, proteção contra
-- sobrescrita na reimportação do Bling e lista de títulos excluídos.
-- Tabelas acessadas apenas pelo servidor (service_role).

CREATE TABLE IF NOT EXISTS public.financial_movement_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  movement_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('update', 'delete', 'restore')),
  type text NOT NULL,
  document text,
  counterparty text,
  changed_fields text[] NOT NULL DEFAULT '{}',
  before_data jsonb,
  after_data jsonb,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_movement_changes_company_idx
  ON public.financial_movement_changes (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS financial_movement_changes_movement_idx
  ON public.financial_movement_changes (movement_id);

CREATE TABLE IF NOT EXISTS public.financial_movement_manual_locks (
  movement_id uuid PRIMARY KEY,
  company_id uuid NOT NULL,
  fields text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_movement_manual_locks_company_idx
  ON public.financial_movement_manual_locks (company_id);

CREATE TABLE IF NOT EXISTS public.financial_movement_exclusions (
  company_id uuid NOT NULL,
  unique_key text NOT NULL,
  type text NOT NULL,
  document text,
  counterparty text,
  due_date date,
  original_amount numeric(14,2),
  change_id uuid,
  excluded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, unique_key)
);

ALTER TABLE public.financial_movement_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_movement_manual_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_movement_exclusions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.financial_movement_changes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_movement_manual_locks FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.financial_movement_exclusions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.financial_movement_changes TO service_role;
GRANT ALL ON public.financial_movement_manual_locks TO service_role;
GRANT ALL ON public.financial_movement_exclusions TO service_role;

-- "Apagar dados" também limpa exclusões e travas (o histórico é preservado).
CREATE OR REPLACE FUNCTION public.clear_manual_edit_state(p_company_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  DELETE FROM public.financial_movement_exclusions WHERE company_id = p_company_id;
  DELETE FROM public.financial_movement_manual_locks WHERE company_id = p_company_id;
$$;

REVOKE ALL ON FUNCTION public.clear_manual_edit_state(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clear_manual_edit_state(uuid) TO service_role;
