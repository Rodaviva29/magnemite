import { EventEmitter } from "node:events";

/**
 * In-process fan-out for dashboard live updates. The SSE route subscribes,
 * the socket handlers and scheduler publish. Single hub process, so an
 * EventEmitter is enough — if the hub is ever scaled out this becomes a
 * Postgres LISTEN/NOTIFY bridge.
 */
export type BusEvent =
  | { kind: "device"; deviceId: string }
  | { kind: "job"; jobId: string; rolloutId: string; deviceId: string }
  | { kind: "rollout"; rolloutId: string }
  | { kind: "version"; versionId: string };

class Bus extends EventEmitter {
  publish(event: BusEvent) {
    this.emit("event", event);
  }

  subscribe(listener: (event: BusEvent) => void): () => void {
    this.on("event", listener);
    return () => this.off("event", listener);
  }
}

export const bus = new Bus();
// One listener per open dashboard tab; the default cap of 10 is too low.
bus.setMaxListeners(200);
