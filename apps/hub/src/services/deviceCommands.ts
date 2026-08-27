import { randomUUID } from "node:crypto";
import { log } from "../log.js";
import { isOnline, sendTo } from "../registry.js";

/**
 * One-off commands, run on a box and answered.
 *
 * Nothing here is stored: a command is a question asked and answered while
 * someone waits. What it was, and who asked, is in the dashboard's audit log —
 * this side only has to get the answer back to the request that is still open.
 */

export type ExecOutcome = { ok: boolean; output: string; error: string | null };

/** Long enough for `pm` to think, short enough that nobody wonders. */
const DEFAULT_TIMEOUT_SECONDS = 60;
/** The agent gives up first, so a hung command answers rather than hanging. */
const GRACE_MS = 10_000;

const waiting = new Map<string, (outcome: ExecOutcome) => void>();

export async function execOnDevice(
  deviceId: string,
  command: string,
  timeoutSeconds = DEFAULT_TIMEOUT_SECONDS,
): Promise<ExecOutcome> {
  if (!isOnline(deviceId)) throw new Error("device is offline");

  const commandId = randomUUID();
  const sent = sendTo(deviceId, { type: "exec_command", commandId, command, timeoutSeconds });
  if (!sent) throw new Error("device is offline");

  log.info({ deviceId, command }, "exec sent");

  return new Promise<ExecOutcome>((resolve) => {
    const timer = setTimeout(
      () => {
        waiting.delete(commandId);
        resolve({
          ok: false,
          output: "",
          // The agent enforces its own deadline, so reaching this one means the
          // box went quiet rather than the command running long.
          error: "the box did not answer — it may have gone offline mid-command",
        });
      },
      timeoutSeconds * 1000 + GRACE_MS,
    );

    waiting.set(commandId, (outcome) => {
      clearTimeout(timer);
      waiting.delete(commandId);
      resolve(outcome);
    });
  });
}

/** Called from the socket handler when the box answers. */
export function resolveExec(commandId: string, outcome: ExecOutcome) {
  const resolve = waiting.get(commandId);
  // No waiter left: the request timed out, or the hub restarted since. The
  // output has nowhere to go.
  if (!resolve) return;
  resolve(outcome);
}
