import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma, serialize } from "@magnemite/db";
import { env } from "../env.js";
import { log } from "../log.js";
import { connectionCount, onlineDeviceIds, sendTo } from "../registry.js";
import { cacheVersion, pruneArtifacts } from "../services/artifacts.js";
import { cancelJob, retryFailedJobs, retryJob } from "../services/jobs.js";
import { cancelRollout, createRollout, resumeRollout } from "../services/rollouts.js";
import { type RotomAction, deviceAction, rotomEnabled, syncDevices } from "../services/rotom.js";
import { nudge } from "../services/scheduler.js";
import { pollAllSources } from "../services/sources/poller.js";

const createRolloutBody = z.object({
  appVersionId: z.string(),
  deviceIds: z.array(z.string()).optional(),
  forceClean: z.boolean().optional(),
  canaryCount: z.number().int().min(0).optional(),
  soakMinutes: z.number().int().min(0).optional(),
  maxConcurrency: z.number().int().positive().nullable().optional(),
  maxAttempts: z.number().int().positive().optional(),
  skipUpToDate: z.boolean().optional(),
  createdById: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * Everything the dashboard needs the hub to actually do — anything that
 * touches a live socket or the scheduler. Plain reads go straight to Postgres
 * from the Next server instead of through here.
 */
export async function internalRoutes(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/internal/")) return;
    // Caddy never routes /internal/authz here from the outside; it is called
    // by Caddy itself with the device's own bearer token.
    if (request.url.startsWith("/internal/authz")) return;

    const secret = request.headers["x-magnemite-secret"];
    if (secret !== env.HUB_INTERNAL_SECRET) {
      log.warn({ url: request.url, ip: request.ip }, "internal call rejected");
      return reply.status(401).send({ error: "unauthorized" });
    }
  });

  app.get("/internal/status", async () => ({
    online: connectionCount(),
    onlineDeviceIds: onlineDeviceIds(),
    maxConcurrentJobs: env.MAX_CONCURRENT_JOBS,
  }));

  app.post("/internal/nudge", async () => {
    nudge();
    return { ok: true };
  });

  // --- rollouts ------------------------------------------------------------

  app.post("/internal/rollouts", async (request, reply) => {
    const parsed = createRolloutBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid body", issues: parsed.error.issues });
    }
    try {
      const rollout = await createRollout(parsed.data);
      nudge();
      return reply.send(serialize({ id: rollout.id, jobs: rollout.jobs.length }));
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>("/internal/rollouts/:id/cancel", async (request) => {
    const cancelled = await cancelRollout(request.params.id);
    return { ok: true, cancelled };
  });

  app.post<{ Params: { id: string } }>("/internal/rollouts/:id/resume", async (request, reply) => {
    try {
      await resumeRollout(request.params.id);
      nudge();
      return { ok: true };
    } catch (err) {
      return reply.status(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post<{ Params: { id: string } }>("/internal/rollouts/:id/retry-failed", async (request) => {
    const retried = await retryFailedJobs(request.params.id);
    nudge();
    return { ok: true, retried };
  });

  // --- jobs ----------------------------------------------------------------

  app.post<{ Params: { id: string } }>("/internal/jobs/:id/retry", async (request) => {
    await retryJob(request.params.id);
    nudge();
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/internal/jobs/:id/cancel", async (request) => {
    const job = await cancelJob(request.params.id);
    // Tell the agent to stop too, so it isn't still pulling 170 MB for a job
    // the dashboard already shows as cancelled.
    if (job) sendTo(job.deviceId, { type: "cancel_job", jobId: job.id });
    nudge();
    return { ok: true };
  });

  // --- devices -------------------------------------------------------------

  app.post<{ Params: { id: string } }>("/internal/devices/:id/reboot", async (request, reply) => {
    const sent = sendTo(request.params.id, { type: "reboot" });
    if (!sent) return reply.status(409).send({ error: "device is offline" });
    return { ok: true };
  });

  app.post<{ Params: { id: string }; Body: { url: string; sha256: string; version: string } }>(
    "/internal/devices/:id/agent-update",
    async (request, reply) => {
      const body = z
        .object({ url: z.string().url(), sha256: z.string().length(64), version: z.string() })
        .safeParse(request.body);
      if (!body.success) return reply.status(400).send({ error: "invalid body" });
      const sent = sendTo(request.params.id, { type: "agent_update", ...body.data });
      if (!sent) return reply.status(409).send({ error: "device is offline" });
      return { ok: true };
    },
  );

  app.post<{ Params: { id: string; action: string } }>(
    "/internal/devices/:id/rotom/:action",
    async (request, reply) => {
      if (!rotomEnabled()) return reply.status(409).send({ error: "rotom integration is off" });

      const allowed: RotomAction[] = ["restart", "reboot", "enable", "disable", "disconnect"];
      const action = request.params.action as RotomAction;
      if (!allowed.includes(action)) return reply.status(400).send({ error: "unknown action" });

      const device = await prisma.device.findUnique({
        where: { id: request.params.id },
        select: { rotomDeviceId: true },
      });
      if (!device?.rotomDeviceId) {
        return reply.status(409).send({ error: "this device is not matched to a rotom device" });
      }

      const ok = await deviceAction(device.rotomDeviceId, action);
      if (!ok) return reply.status(502).send({ error: `rotom refused the ${action}` });
      return { ok: true };
    },
  );

  app.post("/internal/rotom/sync", async (request, reply) => {
    if (!rotomEnabled()) return reply.status(409).send({ error: "rotom integration is off" });
    const result = await syncDevices();
    return { ok: true, ...result };
  });

  // --- versions ------------------------------------------------------------

  app.post<{ Params: { id: string } }>("/internal/versions/:id/cache", async (request, reply) => {
    const version = await prisma.appVersion.findUnique({ where: { id: request.params.id } });
    if (!version) return reply.status(404).send({ error: "version not found" });
    // Downloading 250 MB takes minutes; kick it off and let the dashboard
    // follow cacheProgress over SSE.
    void cacheVersion(version.id).catch((err) => log.error({ err }, "cacheVersion failed"));
    return { ok: true };
  });

  app.post("/internal/versions/prune", async (request) => {
    const body = z
      .object({ keepLatest: z.number().int().min(1).optional() })
      .safeParse(request.body);
    const removed = await pruneArtifacts(body.success ? body.data.keepLatest : undefined);
    return { ok: true, removed };
  });

  app.post("/internal/sources/poll", async () => {
    void pollAllSources().catch((err) => log.error({ err }, "manual poll failed"));
    return { ok: true };
  });
}
