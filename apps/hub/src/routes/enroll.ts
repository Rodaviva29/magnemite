import type { FastifyInstance } from "fastify";
import { enrollRequestSchema } from "@magnemite/protocol";
import { generateToken, hashToken, prisma } from "@magnemite/db";
import { bus } from "../bus.js";
import { env } from "../env.js";
import { log } from "../log.js";

function defaultName(serial: string, manufacturer?: string | null, model?: string | null) {
  const label = [manufacturer, model].filter(Boolean).join(" ").trim();
  const tail = serial.slice(-6);
  return label ? `${label} ${tail}` : `device ${tail}`;
}

export async function enrollRoutes(app: FastifyInstance) {
  /**
   * First contact from a freshly flashed box. It presents the shared
   * enrollment token and gets back a token of its own, which is what every
   * later request authenticates with.
   */
  app.post("/api/enroll", async (request, reply) => {
    const parsed = enrollRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid body", issues: parsed.error.issues });
    }
    const body = parsed.data;

    const enrollment = await prisma.enrollmentToken.findUnique({
      where: { tokenHash: hashToken(body.enrollmentToken) },
    });
    if (!enrollment || enrollment.revoked) {
      log.warn({ ip: request.ip, serial: body.device.serial }, "enrollment rejected: bad token");
      return reply.status(401).send({ error: "invalid enrollment token" });
    }
    if (enrollment.expiresAt && enrollment.expiresAt < new Date()) {
      return reply.status(401).send({ error: "enrollment token expired" });
    }
    if (enrollment.maxUses !== null && enrollment.uses >= enrollment.maxUses) {
      return reply.status(401).send({ error: "enrollment token exhausted" });
    }

    const deviceToken = generateToken();
    const existing = await prisma.device.findUnique({ where: { serial: body.device.serial } });

    // Re-enrollment (box re-flashed, agent config wiped) keeps the same row so
    // its history, name and group survive. Only the token rotates.
    const device = existing
      ? await prisma.device.update({
          where: { id: existing.id },
          data: {
            tokenHash: hashToken(deviceToken),
            agentVersion: body.agentVersion,
            manufacturer: body.device.manufacturer ?? undefined,
            model: body.device.model ?? undefined,
            androidVersion: body.device.androidVersion ?? undefined,
            sdkInt: body.device.sdkInt ?? undefined,
            abi: body.device.abi ?? undefined,
            localIp: body.device.localIp ?? undefined,
            name: body.name ?? existing.name,
          },
        })
      : await prisma.device.create({
          data: {
            serial: body.device.serial,
            name:
              body.name ??
              defaultName(body.device.serial, body.device.manufacturer, body.device.model),
            tokenHash: hashToken(deviceToken),
            approved: enrollment.autoApprove,
            agentVersion: body.agentVersion,
            manufacturer: body.device.manufacturer ?? null,
            model: body.device.model ?? null,
            androidVersion: body.device.androidVersion ?? null,
            sdkInt: body.device.sdkInt ?? null,
            abi: body.device.abi ?? null,
            localIp: body.device.localIp ?? null,
            group: {
              connectOrCreate: { where: { name: "default" }, create: { name: "default" } },
            },
          },
        });

    await prisma.enrollmentToken.update({
      where: { id: enrollment.id },
      data: { uses: { increment: 1 } },
    });

    log.info(
      { deviceId: device.id, serial: device.serial, reEnrolled: Boolean(existing) },
      "device enrolled",
    );
    bus.publish({ kind: "device", deviceId: device.id });

    const wsUrl = `${env.MAGNEMITE_PUBLIC_URL.replace(/^http/, "ws").replace(/\/$/, "")}/ws/device`;
    return reply.send({
      deviceId: device.id,
      deviceToken,
      name: device.name,
      approved: device.approved,
      wsUrl,
    });
  });
}
