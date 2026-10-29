DROP POLICY IF EXISTS "Open access to financial movements" ON public.financial_movements;
DROP POLICY IF EXISTS "Open access to import batches" ON public.import_batches;
DROP POLICY IF EXISTS "Open access to receivable email events" ON public.receivable_email_events;
DROP POLICY IF EXISTS "Open access to receivable email requests" ON public.receivable_email_requests;
REVOKE ALL ON public.financial_movements FROM anon;
REVOKE ALL ON public.import_batches FROM anon;
REVOKE ALL ON public.receivable_email_events FROM anon;
REVOKE ALL ON public.receivable_email_requests FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.financial_movements TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_batches TO authenticated;
GRANT SELECT, INSERT ON public.receivable_email_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.receivable_email_requests TO authenticated;
DROP POLICY IF EXISTS "Authenticated users manage financial movements"
  ON public.financial_movements;
CREATE POLICY "Authenticated users manage financial movements"
  ON public.financial_movements
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users manage import batches"
  ON public.import_batches;
CREATE POLICY "Authenticated users manage import batches"
  ON public.import_batches
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users manage receivable email events"
  ON public.receivable_email_events;
CREATE POLICY "Authenticated users manage receivable email events"
  ON public.receivable_email_events
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "Authenticated users manage receivable email requests"
  ON public.receivable_email_requests;
CREATE POLICY "Authenticated users manage receivable email requests"
  ON public.receivable_email_requests
  FOR ALL
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
