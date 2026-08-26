import { NextResponse } from "next/server";
import { requireOperator } from "@/lib/session";
import { HUB_BASE_URL, HUB_SECRET } from "@/lib/hub";

// Node, not edge: the body is piped through as a stream rather than buffered,
// and an APK is a few hundred megabytes.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A box on a thin uplink is not the concern here — this is the operator's own
// upload — but a 300 MB file over a home connection still outlives the default.
export const maxDuration = 600;

/**
 * The dashboard cannot write to the artifacts volume: it is mounted on the hub
 * and on Caddy, and deliberately not here. So a manual upload is streamed
 * through to the hub's internal API, which owns everything that lands on that
 * volume.
 *
 * The stream is never buffered on this side — `duplex: "half"` hands the
 * request body straight to the hub as it arrives.
 */
export async function POST(request: Request) {
  try {
    await requireOperator();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "not allowed" },
      { status: 403 },
    );
  }

  const incoming = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ["packageName", "version", "filename", "displayName", "arch"]) {
    const value = incoming.searchParams.get(key);
    if (value) query.set(key, value);
  }

  if (!request.body) {
    return NextResponse.json({ error: "no file in the request" }, { status: 400 });
  }

  let res: Response;
  try {
    res = await fetch(`${HUB_BASE_URL}/internal/uploads?${query.toString()}`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-magnemite-secret": HUB_SECRET,
      },
      body: request.body,
      // Required by undici to send a streaming body.
      duplex: "half",
    } as RequestInit & { duplex: "half" });
  } catch (err) {
    return NextResponse.json(
      {
        error: `The hub is not reachable at ${HUB_BASE_URL} (${
          err instanceof Error ? err.message : String(err)
        })`,
      },
      { status: 502 },
    );
  }

  const text = await res.text();
  const payload = text ? JSON.parse(text) : {};
  return NextResponse.json(payload, { status: res.status });
}
