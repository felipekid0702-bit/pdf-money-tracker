ALTER TABLE public.receivable_email_requests
  ALTER COLUMN idempotency_key
  SET DEFAULT ('request:' || gen_random_uuid()::text);
