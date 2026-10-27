import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }): Promise<Response> {
  const { handleBillingRequest } = await import("@/lib/billing-server");
  return handleBillingRequest(request);
}

export const Route = createFileRoute("/api/billing")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
    },
  },
});
