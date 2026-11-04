ALTER TABLE public.receivable_email_events
  DROP CONSTRAINT IF EXISTS receivable_email_events_action_type_check,
  DROP CONSTRAINT IF EXISTS receivable_email_events_check;

ALTER TABLE public.receivable_email_events
  ADD CONSTRAINT receivable_email_events_action_type_check
    CHECK (
      action_type IN (
        'cobranca_vencido',
        'aviso_vencimento',
        'boleto_enviado'
      )
    ),
  ADD CONSTRAINT receivable_email_events_check
    CHECK (
      (action_type = 'aviso_vencimento' AND reminder_days IS NOT NULL)
      OR (
        action_type IN ('cobranca_vencido', 'boleto_enviado')
        AND reminder_days IS NULL
      )
    );
