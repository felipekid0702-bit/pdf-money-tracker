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

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.touch_bling_reconciliation_link_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bling_reconciliation_link_event
  ON public.bling_reconciliation_links;
DROP TRIGGER IF EXISTS bling_reconciliation_link_updated_at
  ON public.bling_reconciliation_links;
CREATE TRIGGER bling_reconciliation_link_updated_at
  BEFORE UPDATE ON public.bling_reconciliation_links
  FOR EACH ROW EXECUTE FUNCTION public.touch_bling_reconciliation_link_updated_at();
CREATE TRIGGER bling_reconciliation_link_event
  AFTER INSERT OR UPDATE ON public.bling_reconciliation_links
  FOR EACH ROW EXECUTE FUNCTION public.record_bling_reconciliation_event();
