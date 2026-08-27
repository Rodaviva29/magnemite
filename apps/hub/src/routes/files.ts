import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { hashToken, prisma } from "@magnemite/db";
import { env } from "../env.js";
import { log } from "../log.js";

/**
 * Artifact downloads straight from the hub.
 *
 * In production Caddy handles /files/* off the shared volume and this never
 * runs — it exists so a dev machine (or a deployment without a reverse proxy)
 * can still serve bundles. Range support is not optional either way: a device
 * that loses its uplink at 80% has to resume, not start over.
 */
export async function fileRoutes(app: FastifyInstance) {
  if (!env.SERVE_ARTIFACTS) return;

  log.warn(
    "SERVE_ARTIFACTS is on: artifact downloads go through Node. " +
      "In production let Caddy serve /files/* instead.",
  );

  app.get<{ Params: { "*": string } }>("/files/*", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) return reply.status(401).send();

    const device = await prisma.device.findUnique({
      where: { tokenHash: hashToken(token) },
      select: { id: true, approved: true },
    });
    if (!device?.approved) return reply.status(401).send();

    // Subpaths are allowed — agent releases live under agent/<version>/ — but
    // nothing under /files may escape the artifact directory, so the resolved
    // path is checked rather than the requested one.
    const requested = request.params["*"] ?? "";
    const root = path.resolve(env.ARTIFACT_DIR);
    const full = path.resolve(root, requested);
    if (full !== root && !full.startsWith(root + path.sep)) return reply.status(404).send();
    if (path.basename(full).startsWith(".")) return reply.status(404).send();
    const stat = await fs.stat(full).catch(() => null);
    if (!stat?.isFile()) return reply.status(404).send();

    reply.header("Accept-Ranges", "bytes");
    reply.header("Content-Type", "application/octet-stream");

    const range = request.headers.range;
    if (!range) {
      reply.header("Content-Length", stat.size);
      return reply.send(createReadStream(full));
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      return reply.status(416).header("Content-Range", `bytes */${stat.size}`).send();
    }

    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stat.size) {
      return reply.status(416).header("Content-Range", `bytes */${stat.size}`).send();
    }

    const last = Math.min(end, stat.size - 1);
    reply
      .status(206)
      .header("Content-Range", `bytes ${start}-${last}/${stat.size}`)
      .header("Content-Length", last - start + 1);
    return reply.send(createReadStream(full, { start, end: last }));
  });
}
