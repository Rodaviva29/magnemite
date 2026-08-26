import type { FastifyInstance } from "fastify";
import { bus } from "../bus.js";
import { env } from "../env.js";

const KEEPALIVE_MS = 25_000;

/**
 * Server-sent events for the dashboard. The browser never talks to the hub
 * directly — the Next app proxies this behind a session check, which is why
 * the shared secret is enough here.
 */
export async function eventRoutes(app: FastifyInstance) {
  app.get("/internal/events", async (request, reply) => {
    if (request.headers["x-magnemite-secret"] !== env.HUB_INTERNAL_SECRET) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(": connected\n\n");

    const unsubscribe = bus.subscribe((event) => {
      reply.raw.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Comment frames keep proxies from closing an idle stream.
    const keepalive = setInterval(() => reply.raw.write(": ping\n\n"), KEEPALIVE_MS);

    request.raw.on("close", () => {
      clearInterval(keepalive);
      unsubscribe();
    });

    // Never resolves; the stream stays open until the client disconnects.
    return reply;
  });
}
