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
  DELETE FROM public.fiscal_documents WHERE true;
END;
$$;
