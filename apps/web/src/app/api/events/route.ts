import { getSession } from "@/lib/session";
import { HUB_BASE_URL, HUB_SECRET } from "@/lib/hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SSE proxy: the browser has a session cookie, the hub only understands the
 * internal secret. This is the seam between the two — it checks the session,
 * then pipes the hub's event stream straight through.
 */
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return new Response("unauthorized", { status: 401 });

  const upstream = await fetch(`${HUB_BASE_URL}/internal/events`, {
    headers: { "x-magnemite-secret": HUB_SECRET, Accept: "text/event-stream" },
    signal: request.signal,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response("event stream unavailable", { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
