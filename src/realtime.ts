// Real-time live-view relay: a single Durable Object instance that gates a
// single WebSocket viewer and fans out raw pageview events to it. Nothing here
// is persisted -- no ctx.storage, plain in-memory fields -- because the whole
// point is that the live view has no memory beyond "is a browser watching
// right now". See CLAUDE.md's read-path philosophy: this is deliberately the
// opposite of it (push, not pull; ephemeral, not durable), so it lives
// alongside the D1 pipeline rather than inside it.
import { DurableObject } from "cloudflare:workers";

// What /api/send forwards for every accepted pageview (see routes/collect.ts).
export interface RealtimeEvent {
  path: string;
  country: string;
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: string;
  deviceVendor: string;
  deviceModel: string;
  referrerDomain: string | null;
  visitorId: number;
}

export class RealtimeHub extends DurableObject<Env> {
  // At most one viewer at a time (enforced in fetch()).
  private socket: WebSocket | null = null;

  // WebSocket upgrade from /api/realtime. Deliberately uses the plain accept()
  // API, not the hibernation API: hibernation would evict this DO's in-memory
  // `this.socket` between events, which defeats a relay that must stay warm
  // for as long as a viewer is connected.
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    if (this.socket) {
      return new Response("Realtime dashboard already in use", { status: 409 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    this.socket = server;

    const release = () => {
      if (this.socket === server) this.socket = null;
    };
    server.addEventListener("close", release);
    server.addEventListener("error", release);

    return new Response(null, { status: 101, webSocket: client });
  }

  // RPC method called from the worker's ingest path (handleCollect) for every
  // event that already passed bot/rate-limit checks. No-op when nobody is
  // watching -- this is what makes "only count while the dashboard is open"
  // true: a dropped event is never observed by anyone, anywhere.
  async ingest(event: RealtimeEvent): Promise<void> {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify({ type: "pageview", ...event, ts: Date.now() }));
    } catch {
      // A send racing a close/error teardown must not surface as an ingest
      // failure -- the realtime feed is best-effort by design.
      this.socket = null;
    }
  }
}
