import { createFileRoute } from "@tanstack/react-router";

async function handle({ request }: { request: Request }): Promise<Response> {
  const { handleZohoOAuthCallback } = await import("@/lib/billing-server");
  return handleZohoOAuthCallback(request);
}

export const Route = createFileRoute("/api/zoho/callback")({
  server: {
    handlers: {
      GET: handle,
    },
  },
});
