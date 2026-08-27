import Fastify from "fastify";
import { prisma, syncAdminFromEnv } from "@magnemite/db";
import { env } from "./env.js";
import { log } from "./log.js";
import { authzRoutes } from "./routes/authz.js";
import { enrollRoutes } from "./routes/enroll.js";
import { eventRoutes } from "./routes/events.js";
import { fileRoutes } from "./routes/files.js";
import { internalRoutes } from "./routes/internal.js";
import { logRoutes } from "./routes/logs.js";
import { connectionCount } from "./registry.js";
import {
  loadAgentRelease,
  startAgentUpdateSweep,
  stopAgentUpdateSweep,
} from "./services/agentRelease.js";
import { ensureArtifactDir } from "./services/artifacts.js";
import { sweepOffline } from "./services/devices.js";
import { rotomEnabled, syncDevices } from "./services/rotom.js";
import { startScheduler, stopScheduler } from "./services/scheduler.js";
import { startPolling, stopPolling } from "./services/sources/poller.js";
import { attachDeviceSocket } from "./ws/deviceSocket.js";

const OFFLINE_SWEEP_MS = 30_000;

async function main() {
  // Keeps the admin login in sync with ADMIN_EMAIL/ADMIN_PASSWORD on every
  // boot — restarting the hub is the whole story for changing it or
  // recovering a lost password, no seed step required.
  await syncAdminFromEnv();
  await ensureArtifactDir();
  // Publishes the agent binaries this image was built with, so boxes on an
  // older build are updated as they reconnect.
  await loadAgentRelease();

  const app = Fastify({
    loggerInstance: log,
    // Behind Caddy, so trust the forwarded headers for request.ip.
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  // Several internal endpoints take no body at all. Without this, a POST with
  // no Content-Type (curl -X POST, a shell script) is rejected with a 415.
  app.addContentTypeParser("*", { parseAs: "buffer" }, (_request, body, done) => {
    done(null, (body as Buffer).length === 0 ? {} : body);
  });

  app.get("/healthz", async () => ({
    ok: true,
    online: connectionCount(),
    uptime: Math.floor(process.uptime()),
  }));

  await app.register(enrollRoutes);
  await app.register(authzRoutes);
  await app.register(internalRoutes);
  await app.register(eventRoutes);
  await app.register(fileRoutes);
  await app.register(logRoutes);

  await app.listen({ port: env.HUB_PORT, host: env.HUB_HOST });
  attachDeviceSocket(app.server);
  // Artifact URLs are built from the public URL and handed to the boxes, so a
  // wrong value here shows up as every download failing. Log it once.
  log.info(
    { port: env.HUB_PORT, artifactBase: `${env.MAGNEMITE_PUBLIC_URL.replace(/\/$/, "")}/files/` },
    "hub listening",
  );

  startScheduler();
  startPolling();
  startAgentUpdateSweep();

  // Catches sockets that died without a close frame — a box losing power
  // leaves the connection hanging until TCP notices.
  const sweeper = setInterval(() => {
    void sweepOffline(env.DEVICE_OFFLINE_TIMEOUT).catch((err) =>
      log.error({ err }, "offline sweep failed"),
    );
  }, OFFLINE_SWEEP_MS);

  // Optional: keeps each device's Rotom identity and scanning state current,
  // which is what makes "the scanner came back" a usable success signal.
  const rotom = setInterval(() => {
    void syncDevices().catch((err) => log.error({ err }, "rotom sync failed"));
  }, 60_000);
  if (rotomEnabled()) {
    log.info({ url: env.ROTOM_URL }, "rotom integration enabled");
    void syncDevices().catch(() => undefined);
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, "shutting down");
    clearInterval(sweeper);
    clearInterval(rotom);
    stopScheduler();
    stopPolling();
    stopAgentUpdateSweep();
    await app.close().catch(() => undefined);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error({ err }, "hub failed to start");
  process.exit(1);
});
