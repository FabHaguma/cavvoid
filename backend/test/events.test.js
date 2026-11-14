import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { EventHub, STREAM_LIFETIME_MS } from "../events.js";
import { closeServer, listen, httpRequest } from "./helpers.js";
import { openEventStream } from "./event-client.js";

async function fixture(t, eventOptions = {}) {
  const config = {
    ...loadConfig({
      GATEKEEPER_PROXY_SECRET: "event-test-secret-".repeat(3),
      DATABASE_PATH: ":memory:",
    }),
  };
  let allowed = true,
    unavailable = false,
    now = Date.now(),
    checks = 0;
  const instance = createApp({
    config,
    eventOptions,
    clock: () => now,
    fetchImpl: async (url, options) => {
      checks++;
      if (unavailable) throw new Error("offline");
      return new Response(null, {
        status:
          allowed &&
          options.headers.Cookie.startsWith("gatekeeper_session=client-")
            ? 204
            : 401,
      });
    },
  });
  const server = await listen(instance.app);
  config.appHost = "localhost:" + server.address().port;
  config.appOrigin = "http://" + config.appHost;
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    instance.events.close();
    await closeServer(server);
    instance.close();
  });
  const request = (url, options = {}) =>
    httpRequest(server, config.appHost, url, {
      ...options,
      headers: {
        Cookie: "gatekeeper_session=client-1",
        Origin: config.appOrigin,
        "X-CavVoid-Request": "1",
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
  return {
    instance,
    server,
    config,
    request,
    advance: (ms) => {
      now += ms;
    },
    deny: () => {
      allowed = false;
    },
    outage: () => {
      unavailable = true;
    },
    checks: () => checks,
    async stream(headers = {}) {
      const client = await openEventStream(server, config.appHost, {
        Cookie: "gatekeeper_session=client-1",
        ...headers,
      });
      clients.push(client);
      return client;
    },
    create: (submissionId = randomUUID()) =>
      request("/api/items/text", {
        method: "POST",
        body: JSON.stringify({
          text: "Private text must never appear in an event",
          submissionId,
        }),
      }),
  };
}

test("event endpoint is gated, same-origin, uncacheable and ignores caller identity assertions", async (t) => {
  const f = await fixture(t);
  for (const [headers, status] of [
    [{ Cookie: "" }, 401],
    [{ Origin: "https://attacker.example" }, 403],
    [{ "Sec-Fetch-Site": "cross-site" }, 403],
  ]) {
    const stream = await f.stream(headers);
    assert.equal(stream.status, status);
    await stream.closed;
    assert.ok(!stream.raw.includes("sync.ready"));
  }
  const stream = await f.stream({ "X-User-Id": "other-owner" });
  await stream.waitFor("sync.ready");
  assert.match(stream.headers["content-type"], /text\/event-stream/);
  assert.equal(stream.headers["cache-control"], "no-store, no-transform");
  assert.equal(stream.headers["x-accel-buffering"], "no");
  assert.equal(stream.headers["access-control-allow-origin"], undefined);
  assert.equal(
    (await f.request("/api/events", { method: "HEAD" })).status,
    405,
  );
});

test("five concurrent clients receive committed text/file/retention/delete/storage changes within two seconds", async (t) => {
  const f = await fixture(t);
  const clients = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      f.stream({ Cookie: "gatekeeper_session=client-" + i }),
    ),
  );
  await Promise.all(clients.map((client) => client.waitFor("sync.ready")));
  const started = performance.now(),
    submission = randomUUID();
  const item = (await f.create(submission)).json().item;
  const received = await Promise.all(
    clients.map((client) =>
      client.waitFor("item.created", (event) => event.data.id === item.id),
    ),
  );
  const latency = Math.max(
    ...received.map((event) => event.receivedAt - started),
  );
  assert.ok(latency < 2000, "Event delivery took " + latency + "ms");
  t.diagnostic(
    "Five-client create delivery maximum: " + latency.toFixed(1) + "ms",
  );
  assert.equal((await f.create(submission)).status, 200);
  assert.equal(
    clients[0].events.filter((e) => e.type === "item.created").length,
    1,
  );
  const patched = await f.request("/api/items/" + item.id, {
    method: "PATCH",
    body: JSON.stringify({ retention: "keep" }),
  });
  assert.equal(patched.status, 200);
  await Promise.all(
    clients.map((client) =>
      client.waitFor("item.updated", (event) => event.data.id === item.id),
    ),
  );
  assert.equal(
    (await f.request("/api/items?section=kept")).json().items[0].id,
    item.id,
  );
  await f.request("/api/items/" + item.id, { method: "DELETE" });
  await Promise.all(
    clients.map((client) =>
      client.waitFor("item.deleted", (event) => event.data.id === item.id),
    ),
  );
  const fileId = randomUUID(),
    bytes = Buffer.from("private filename and bytes stay out of SSE");
  const body = Buffer.concat([
    Buffer.from(
      '--test-file\r\nContent-Disposition: form-data; name="file"; filename="private.txt"\r\n\r\n',
    ),
    bytes,
    Buffer.from("\r\n--test-file--\r\n"),
  ]);
  const uploaded = await f.request("/api/items/file", {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=test-file",
      "X-File-Size": String(bytes.length),
      "X-Upload-Id": fileId,
    },
    body,
  });
  assert.equal(uploaded.status, 201, uploaded.text);
  await Promise.all(
    clients.map((client) =>
      client.waitFor("item.created", (event) => event.data.id === fileId),
    ),
  );
  await Promise.all(clients.map((client) => client.waitFor("storage.updated")));
  await f.request("/api/items/" + fileId, { method: "DELETE" });
  await Promise.all(
    clients.map((client) =>
      client.waitFor("item.deleted", (event) => event.data.id === fileId),
    ),
  );
  for (const client of clients) {
    assert.ok(!client.raw.includes("Private text"));
    assert.ok(!client.raw.includes("private.txt"));
    assert.ok(!client.raw.includes("secret"));
    assert.equal(
      new Set(client.events.filter((e) => e.id).map((e) => e.id)).size,
      client.events.filter((e) => e.id).length,
    );
    for (const event of client.events.filter((e) => e.type.startsWith("item.")))
      assert.deepEqual(Object.keys(event.data), ["id"]);
  }
});

test("cleanup emits invalidations, disconnected clients recover from current state without replay", async (t) => {
  const f = await fixture(t);
  const stream = await f.stream();
  await stream.waitFor("sync.ready");
  const item = (await f.create()).json().item;
  await stream.waitFor("item.created");
  stream.close();
  await stream.closed;
  const missed = (await f.create()).json().item;
  const resumed = await f.stream({ "Last-Event-ID": "old-process:1" });
  await resumed.waitFor("sync.ready");
  assert.equal(
    resumed.events.filter((e) => e.type === "item.created").length,
    0,
  );
  assert.equal(
    (await f.request("/api/items"))
      .json()
      .items.some((e) => e.id === missed.id),
    true,
  );
  f.advance(86400000);
  f.instance.files.repair();
  await resumed.waitFor("item.deleted", (e) => e.data.id === item.id);
  assert.equal((await f.request("/api/items")).json().total, 0);
});

test("heartbeats and continuous changes cannot extend the stream lifetime; reconnect is checked again", async (t) => {
  const f = await fixture(t, { lifetimeMs: 450, heartbeatMs: 30 });
  const start = performance.now(),
    stream = await f.stream();
  await stream.waitFor("sync.ready");
  const traffic = setInterval(
    () => f.instance.events.publish("owner", "storage.updated"),
    15,
  );
  t.after(() => clearInterval(traffic));
  f.deny();
  const closedAt = await stream.closed;
  assert.ok(closedAt - start < 1500);
  assert.ok(stream.raw.includes(": heartbeat"));
  assert.ok(stream.raw.includes("stream.end"));
  assert.equal(f.instance.events.clients.size, 0);
  assert.equal((await f.stream()).status, 401);
  assert.ok(f.checks() >= 2);
});

test("gateway outage denies streams; shutting down closes existing clients", async (t) => {
  const f = await fixture(t);
  const stream = await f.stream();
  await stream.waitFor("sync.ready");
  f.outage();
  assert.equal((await f.stream()).status, 503);
  f.instance.events.close();
  await stream.closed;
  assert.equal(f.instance.events.clients.size, 0);
});

test("event hub bounds lifetime and drops slow consumers without affecting other owners", () => {
  class Response extends EventEmitter {
    frames = [];
    writableEnded = false;
    destroyed = false;
    constructor(blocked = false) {
      super();
      this.blocked = blocked;
    }
    set() {}
    flushHeaders() {}
    write(frame) {
      this.frames.push(frame);
      return !this.blocked;
    }
    end() {
      this.writableEnded = true;
    }
    destroy() {
      this.destroyed = true;
      this.emit("close");
    }
  }
  const hub = new EventHub({ lifetimeMs: 999999 });
  assert.equal(hub.lifetimeMs, STREAM_LIFETIME_MS);
  const slow = new Response(true),
    other = new Response(),
    owner = new Response();
  hub.connect({ method: "GET" }, slow, "owner");
  assert.equal(slow.destroyed, true);
  assert.equal(hub.clients.size, 0);
  hub.connect({ method: "GET" }, other, "someone-else");
  hub.connect({ method: "GET" }, owner, "owner");
  hub.publish("owner", "item.created", randomUUID());
  assert.equal(other.frames.length, 1);
  assert.equal(owner.frames.length, 2);
  other.emit("close");
  assert.equal(hub.clients.size, 1);
  assert.equal(other.listenerCount("error"), 0);
  hub.close();
  assert.equal(hub.clients.size, 0);
});
