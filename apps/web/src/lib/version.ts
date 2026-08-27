import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Which release this dashboard is.
 *
 * Same file and same trick as the hub: the repo's VERSION holds one
 * `key=value` line per deployable and the image is built with it copied in.
 * Both versions being on the Status page is the point — a dashboard and a hub
 * from different deploys is a real state to be in, and one worth seeing.
 */
const CANDIDATES = [
  "/app/VERSION",
  path.resolve(process.cwd(), "VERSION"),
  path.resolve(process.cwd(), "../../VERSION"),
];

function read(): Record<string, string> {
  for (const candidate of CANDIDATES) {
    const versions: Record<string, string> = {};
    let contents: string;
    try {
      contents = readFileSync(candidate, "utf8");
    } catch {
      continue;
    }

    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 1) continue;
      versions[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
    }

    if (Object.keys(versions).length > 0) return versions;
  }
  return {};
}

const VERSIONS = read();

export const WEB_VERSION = VERSIONS.web ?? "dev";
