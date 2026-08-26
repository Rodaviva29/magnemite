import { prisma } from "@magnemite/db";
import { requireUser } from "@/lib/session";
import { hub, type HubHealth } from "@/lib/hub";
import { StatusBoard } from "@/components/status-board";

export const dynamic = "force-dynamic";

/**
 * When the hub is the thing that is down, its own probes are unavailable —
 * but the dashboard talks to Postgres directly, so it can still answer the
 * next question an operator asks: is this the hub, or is it everything?
 */
async function fallbackHealth(error: string): Promise<HubHealth> {
  const started = Date.now();
  let database: HubHealth["checks"][number];

  try {
    const devices = await prisma.device.count();
    database = {
      key: "database",
      label: "Database",
      summary: `Postgres answering in ${Date.now() - started} ms (checked from the dashboard)`,
      state: "OK",
      latencyMs: Date.now() - started,
      facts: [{ label: "Devices", value: String(devices) }],
      detail: null,
      link: null,
    };
  } catch (err) {
    database = {
      key: "database",
      label: "Database",
      summary: "Postgres is not answering the dashboard either",
      state: "DOWN",
      latencyMs: null,
      facts: [],
      detail: err instanceof Error ? err.message : String(err),
      link: null,
    };
  }

  return {
    checkedAt: new Date().toISOString(),
    overall: "DOWN",
    checks: [
      {
        key: "hub",
        label: "Hub",
        summary: "Not reachable from the dashboard",
        state: "DOWN",
        latencyMs: null,
        facts: [{ label: "HUB_URL", value: process.env.HUB_URL ?? "http://localhost:3001" }],
        detail: error,
        link: null,
      },
      database,
    ],
  };
}

export default async function StatusPage() {
  await requireUser();

  try {
    const health = await hub.health();
    return <StatusBoard health={health} error={null} />;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return <StatusBoard health={await fallbackHealth(message)} error={message} />;
  }
}
