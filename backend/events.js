import { randomUUID } from "node:crypto";

export const STREAM_LIFETIME_MS = 25000;
const types = new Set([
  "item.created",
  "item.updated",
  "item.deleted",
  "storage.updated",
  "preferences.updated",
]);

// Notifications are process-local invalidations, never a content cache or replay
// log. Every new connection must fetch authoritative state through checked APIs.
export class EventHub {
  constructor({ lifetimeMs = STREAM_LIFETIME_MS, heartbeatMs = 10000 } = {}) {
    this.lifetimeMs = Math.max(1, Math.min(STREAM_LIFETIME_MS, lifetimeMs));
    this.heartbeatMs = Math.max(1, Math.min(10000, heartbeatMs));
    this.boot = randomUUID();
    this.sequence = 0;
    this.clients = new Set();
  }
  connect(req, res, ownerId) {
    if (req.method !== "GET") return res.sendStatus(405);
    if (this.clients.size >= 100)
      return res.status(503).json({
        error:
          "Too many live connections. Close an unused CavVoid tab and retry.",
      });
    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const client = { ownerId, res };
    let deadline,
      heartbeat,
      closed = false;
    const close = (destroy = false) => {
      if (closed) return;
      closed = true;
      clearTimeout(deadline);
      clearInterval(heartbeat);
      this.clients.delete(client);
      res.removeListener("close", disconnected);
      res.removeListener("error", disconnected);
      if (destroy) res.destroy();
      else if (!res.writableEnded) res.end();
    };
    const disconnected = () => close(true);
    client.close = close;
    client.write = (frame) => {
      if (closed || res.destroyed || res.writableEnded) return close(true);
      try {
        // Disconnect a slow consumer instead of accumulating an unbounded queue.
        if (!res.write(frame)) close(true);
      } catch {
        close(true);
      }
    };
    res.once("close", disconnected);
    res.once("error", disconnected);
    this.clients.add(client);
    // This deadline never moves when changes or heartbeats are sent.
    deadline = setTimeout(() => {
      client.write("event: stream.end\ndata: {}\n\n");
      close();
    }, this.lifetimeMs);
    heartbeat = setInterval(
      () => client.write(": heartbeat\n\n"),
      this.heartbeatMs,
    );
    deadline.unref?.();
    heartbeat.unref?.();
    client.write("event: sync.ready\ndata: {}\n\n");
  }
  publish(ownerId, type, id) {
    if (!types.has(type)) return;
    const payload = type.startsWith("item.") ? { id } : {};
    const frame = `id: ${this.boot}:${++this.sequence}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of this.clients)
      if (client.ownerId === ownerId) client.write(frame);
  }
  close() {
    for (const client of this.clients) client.close(true);
  }
}
