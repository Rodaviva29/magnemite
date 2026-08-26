"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { hub } from "@/lib/hub";

/**
 * Re-run every integration probe now, bypassing the hub's 30s cache.
 *
 * Read-only, so a VIEWER may press it: knowing whether the mirror is down is
 * exactly the kind of thing someone without operator rights gets paged about.
 */
export async function recheckIntegrations(): Promise<{ error?: string }> {
  await requireUser();
  try {
    await hub.health(true);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  revalidatePath("/status");
  return {};
}
