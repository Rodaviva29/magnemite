import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { hashToken, prisma } from "@magnemite/db";
import { log } from "../log.js";
import { bundleDir, bundlePath, completeBundle, failBundle } from "../services/deviceLogs.js";

/**
 * Where a box uploads the log bundle it was asked for.
 *
 * Public like `/api/enroll`, and authenticated the same way everything else a
 * box does is: its own device token. The bundle id in the path is not a
 * capability — the token has to belong to the device that bundle was asked of,
 * or this is a 401.
 */

/** A logcat tail plus the agent's own log, zipped. Anything near this is a bug. */
const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;

export async function logRoutes(app: FastifyInstance) {
  // The body is a zip, and the app-wide parser would buffer it whole before
  // the handler ran. Same trick as the manual upload route.
  app.addContentTypeParser("application/zip", (_request, payload, done) => {
    done(null, payload);
  });

  app.post<{ Params: { bundleId: string } }>("/api/logs/:bundleId", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) return reply.status(401).send({ error: "unauthorized" });

    const [device, bundle] = await Promise.all([
      prisma.device.findUnique({
        where: { tokenHash: hashToken(token) },
        select: { id: true, approved: true },
      }),
      prisma.deviceLogBundle.findUnique({
        where: { id: request.params.bundleId },
        select: { id: true, deviceId: true, state: true },
      }),
    ]);

    if (!device?.approved) return reply.status(401).send({ error: "unauthorized" });
    if (!bundle || bundle.deviceId !== device.id) {
      return reply.status(404).send({ error: "no such bundle" });
    }
    if (bundle.state !== "PENDING") {
      return reply.status(409).send({ error: "that bundle is already closed" });
    }

    const declared = Number(request.headers["content-length"] ?? 0);
    if (declared > MAX_BUNDLE_BYTES) {
      await failBundle(bundle.id, `the bundle is too large (${declared} bytes)`);
      return reply.status(413).send({ error: "bundle too large" });
    }

    await fs.mkdir(bundleDir(device.id), { recursive: true });
    const dest = bundlePath(device.id, bundle.id);
    const tmp = `${dest}.part`;

    let written = 0;
    try {
      const sink = createWriteStream(tmp);
      request.raw.on("data", (chunk: Buffer) => {
        written += chunk.length;
        // Content-Length can lie, so the real cap is enforced as it arrives.
        if (written > MAX_BUNDLE_BYTES) request.raw.destroy(new Error("bundle too large"));
      });
      await pipeline(request.raw, sink);
      await fs.rename(tmp, dest);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ err, deviceId: device.id, bundleId: bundle.id }, "log bundle upload failed");
      await failBundle(bundle.id, `upload failed: ${message}`);
      return reply.status(400).send({ error: message });
    }

    await completeBundle(bundle.id, dest, written);
    log.info({ deviceId: device.id, bundleId: bundle.id, bytes: written }, "log bundle received");
    return { ok: true };
  });
}
