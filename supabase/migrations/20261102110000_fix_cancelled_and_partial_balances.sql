ALTER TABLE public.financial_movements
  ADD COLUMN IF NOT EXISTS paid_amount_known boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS open_amount_known boolean NOT NULL DEFAULT true;

UPDATE public.financial_movements
SET paid_amount_known = false,
    open_amount_known = false,
    open_amount = 0
WHERE status IN ('PARCIALMENTE_RECEBIDO', 'PARCIALMENTE_PAGO')
  AND paid_amount = 0;

UPDATE public.financial_movements
SET status = 'CANCELADO',
    open_amount = 0,
    paid_amount = 0,
    paid_amount_known = true,
    open_amount_known = true
WHERE type = 'RECEITA'
  AND source_file = 'Bling - Relatório de Contas a Receber.pdf'
  AND status = 'ATRASADO'
  AND (
    (due_date = DATE '2026-09-30' AND original_amount = 4504.80)
    OR (due_date = DATE '2026-10-21' AND original_amount = 3378.60)
  );
