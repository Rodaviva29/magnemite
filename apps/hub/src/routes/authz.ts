import type { FastifyInstance } from "fastify";
import { hashToken, prisma } from "@magnemite/db";

/**
 * Caddy calls this before serving anything under /files/. Keeping the
 * decision here means the ~170 MB artifacts still stream straight off disk
 * through Caddy while staying behind the device token.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { deviceId: string; expires: number }>();

function cached(tokenHash: string): string | null {
  const hit = cache.get(tokenHash);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(tokenHash);
    return null;
  }
  return hit.deviceId;
}

export async function authzRoutes(app: FastifyInstance) {
  app.all("/internal/authz", async (request, reply) => {
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
    if (!token) return reply.status(401).send();

    const tokenHash = hashToken(token);
    let deviceId = cached(tokenHash);

    if (!deviceId) {
      const device = await prisma.device.findUnique({
        where: { tokenHash },
        select: { id: true, approved: true },
      });
      if (!device || !device.approved) return reply.status(401).send();
      deviceId = device.id;
      cache.set(tokenHash, { deviceId, expires: Date.now() + CACHE_TTL_MS });
    }

    return reply.header("X-Device-Id", deviceId).status(204).send();
  });
}

/** Called when a device is deleted or unapproved so access stops immediately. */
export function invalidateAuthzCache(tokenHash?: string) {
  if (tokenHash) cache.delete(tokenHash);
  else cache.clear();
}
