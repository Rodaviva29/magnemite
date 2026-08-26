import { prisma } from "@magnemite/db";
import { bus } from "../../bus.js";
import { env } from "../../env.js";
import { log } from "../../log.js";
import { runAutoUpdate } from "../autoUpdate.js";
import { pollGithub } from "./github.js";
import { pollMirror } from "./mirror.js";
import type { DiscoveredVersion } from "./types.js";

let timer: NodeJS.Timeout | null = null;
let inFlight = false;

export async function pollAllSources() {
  if (inFlight) return;
  inFlight = true;
  try {
    const targets = await prisma.appTarget.findMany({ where: { enabled: true } });

    for (const target of targets) {
      const found: DiscoveredVersion[] = [];

      for (const [name, poll] of [
        ["github", pollGithub],
        ["mirror", pollMirror],
      ] as const) {
        try {
          found.push(...(await poll(target)));
        } catch (err) {
          // One source being down must not stop the other from being checked.
          log.warn({ err, source: name, target: target.packageName }, "source poll failed");
        }
      }

      let discovered = 0;
      for (const item of found) {
        const existing = await prisma.appVersion.findUnique({
          where: {
            appTargetId_source_version_arch: {
              appTargetId: target.id,
              source: item.source,
              version: item.version,
              arch: item.arch,
            },
          },
        });

        if (!existing) {
          const created = await prisma.appVersion.create({
            data: {
              appTargetId: target.id,
              version: item.version,
              buildCode: item.buildCode,
              source: item.source,
              arch: item.arch,
              remoteUrl: item.remoteUrl,
              filename: item.filename,
              sizeBytes: BigInt(item.sizeBytes),
              md5: item.md5,
              publishedAt: item.publishedAt,
              approved: target.autoApprove,
            },
          });
          discovered += 1;
          bus.publish({ kind: "version", versionId: created.id });
          log.info(
            { target: target.packageName, version: item.version, source: item.source },
            "new version discovered",
          );
        } else if (existing.status !== "READY") {
          // Refresh metadata while it is still just a pointer — the mirror
          // occasionally re-uploads a file with a new size or hash.
          await prisma.appVersion.update({
            where: { id: existing.id },
            data: {
              remoteUrl: item.remoteUrl,
              filename: item.filename,
              sizeBytes: BigInt(item.sizeBytes),
              md5: item.md5 ?? existing.md5,
              buildCode: item.buildCode ?? existing.buildCode,
              publishedAt: item.publishedAt ?? existing.publishedAt,
            },
          });
        }
      }

      if (discovered > 0) log.info({ target: target.packageName, discovered }, "poll complete");

      try {
        await runAutoUpdate(target.id);
      } catch (err) {
        log.error({ err, target: target.packageName }, "auto-update check failed");
      }
    }
  } finally {
    inFlight = false;
  }
}

export function startPolling() {
  if (timer) return;
  const intervalMs = env.SOURCE_POLL_MINUTES * 60_000;
  timer = setInterval(() => {
    void pollAllSources().catch((err) => log.error({ err }, "source poll failed"));
  }, intervalMs);
  log.info({ everyMinutes: env.SOURCE_POLL_MINUTES }, "source polling started");
  // Give the hub a moment to finish booting before the first network call.
  setTimeout(() => void pollAllSources().catch(() => undefined), 10_000);
}

export function stopPolling() {
  if (timer) clearInterval(timer);
  timer = null;
}
