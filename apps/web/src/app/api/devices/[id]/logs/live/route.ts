import { requireOperator } from "@/lib/session";
import { HUB_BASE_URL, HUB_SECRET } from "@/lib/hub";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A live log, proxied.
 *
 * Same seam as `/api/events`: the browser has a session cookie, the hub only
 * understands the internal secret. Closing the tab aborts this request, which
 * drops the hub's subscriber, which stops the follow on the box — so the whole
 * chain hangs off the browser going away.
 *
 * Operators only, not any signed-in user: `?path` follows an arbitrary file as
 * root, and a viewer is explicitly someone who may look at the fleet without
 * being able to reach into a box.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "not allowed", { status: 403 });
  }

  const { id } = await params;
  const path = new URL(request.url).searchParams.get("path");
  const query = path ? `?path=${encodeURIComponent(path)}` : "";

  const upstream = await fetch(`${HUB_BASE_URL}/internal/devices/${id}/logs/live${query}`, {
    headers: { "x-magnemite-secret": HUB_SECRET, Accept: "text/event-stream" },
    signal: request.signal,
    cache: "no-store",
  }).catch(() => null);

  if (!upstream?.ok || !upstream.body) {
    return new Response("log stream unavailable", { status: 502 });
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
