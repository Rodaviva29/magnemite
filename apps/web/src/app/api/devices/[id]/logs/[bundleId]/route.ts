import { requireOperator } from "@/lib/session";
import { HUB_BASE_URL, HUB_SECRET } from "@/lib/hub";

// Node, not edge: the zip is piped through rather than buffered.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Download a collected log bundle.
 *
 * The zip lives on the artifacts volume, which is mounted on the hub and not
 * here, so the dashboard streams it through — the same seam as the manual
 * upload, in the other direction. The session check is what makes this safe to
 * hand to a browser; the hub itself only speaks the internal secret.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; bundleId: string }> },
) {
  try {
    await requireOperator();
  } catch (err) {
    return new Response(err instanceof Error ? err.message : "not allowed", { status: 403 });
  }

  const { id, bundleId } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(`${HUB_BASE_URL}/internal/devices/${id}/logs/${bundleId}`, {
      headers: { "x-magnemite-secret": HUB_SECRET },
      signal: request.signal,
      cache: "no-store",
    });
  } catch (err) {
    return new Response(
      `The hub is not reachable at ${HUB_BASE_URL} (${
        err instanceof Error ? err.message : String(err)
      })`,
      { status: 502 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text || "the bundle is not available", { status: upstream.status });
  }

  // The serial makes a downloaded file identifiable a week later, when it is
  // one of four zips in a downloads folder.
  const serial = upstream.headers.get("x-magnemite-serial") ?? id;
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="magnemite-${serial}-${stamp}.zip"`,
      ...(upstream.headers.get("content-length")
        ? { "Content-Length": upstream.headers.get("content-length")! }
        : {}),
      "Cache-Control": "no-store",
    },
  });
}
