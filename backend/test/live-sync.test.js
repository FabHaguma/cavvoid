import test from "node:test";
import assert from "node:assert/strict";
import { startLiveSync } from "../../frontend/assets/js/live-sync.js";
import { AccessError } from "../../frontend/assets/js/api.js";

function fixture(probe = async () => ({})) {
  let now = 0,
    next = 0,
    changes = 0,
    probes = 0;
  const jobs = new Map(),
    sources = [],
    states = [],
    denied = [];
  const timers = {
    setTimeout(callback, delay) {
      const id = ++next;
      jobs.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      jobs.delete(id);
    },
  };
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      const due = [...jobs]
        .filter(([, job]) => job.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      now = due[1].at;
      jobs.delete(due[0]);
      due[1].callback();
    }
    now = until;
  };
  class Source extends EventTarget {
    closed = false;
    close() {
      this.closed = true;
    }
    emit(type, data = {}, id = "boot:1") {
      const event = new Event(type);
      event.data = JSON.stringify(data);
      event.lastEventId = id;
      this.dispatchEvent(event);
    }
    fail() {
      this.onerror?.();
    }
  }
  const windowTarget = new EventTarget();
  windowTarget.navigator = { onLine: true };
  const documentTarget = new EventTarget();
  documentTarget.visibilityState = "visible";
  const connection = startLiveSync({
    timers,
    random: () => 0,
    windowTarget,
    documentTarget,
    probe: async (signal) => {
      probes++;
      return probe(signal);
    },
    sourceFactory: () => {
      const source = new Source();
      sources.push(source);
      return source;
    },
    onChange: () => {
      changes++;
    },
    onStatus: (state) => states.push(state),
    onDenied: (error) => denied.push(error),
  });
  return {
    connection,
    sources,
    states,
    denied,
    windowTarget,
    documentTarget,
    advance,
    jobs,
    changes: () => changes,
    probes: () => probes,
  };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const id = "9cb68861-4f7a-4abc-bb47-9383a353b91a";

test("default timers keep the browser global receiver", (t) => {
  const set = globalThis.setTimeout,
    clear = globalThis.clearTimeout;
  t.mock.method(globalThis, "setTimeout", function (...args) {
    assert.equal(this, globalThis);
    return set(...args);
  });
  t.mock.method(globalThis, "clearTimeout", function (...args) {
    assert.equal(this, globalThis);
    return clear(...args);
  });
  const target = new EventTarget();
  const connection = startLiveSync({
    windowTarget: target,
    documentTarget: target,
    sourceFactory: () => ({ close() {}, addEventListener() {} }),
    onChange() {},
    onStatus() {},
    onDenied() {},
  });
  connection.stop();
});

test("browser live sync reconciles on connect, deduplicates IDs and coalesces bursts", () => {
  const f = fixture();
  const source = f.sources[0];
  source.emit("sync.ready");
  f.advance(80);
  assert.equal(f.changes(), 1);
  source.emit("item.created", { id }, "boot:1");
  source.emit("item.created", { id }, "boot:1");
  source.emit("item.updated", { id }, "boot:2");
  source.emit("storage.updated", {}, "boot:3");
  f.advance(80);
  assert.equal(f.changes(), 2);
  source.emit("item.updated", { id }, "boot:2");
  f.advance(80);
  assert.equal(f.changes(), 2);
  assert.equal(f.states.at(-1), "live");
  f.connection.stop();
  assert.equal(f.jobs.size, 0);
});

test("rotation probes access, reconnects immediately, and reconciles missed changes", async () => {
  const f = fixture(),
    first = f.sources[0];
  first.emit("sync.ready");
  f.advance(80);
  first.emit("stream.end");
  await flush();
  assert.equal(first.closed, true);
  assert.equal(f.probes(), 1);
  assert.equal(f.sources.length, 2);
  first.emit("item.deleted", { id }, "old:2");
  f.advance(80);
  assert.equal(f.changes(), 1);
  f.sources[1].emit("sync.ready");
  f.advance(80);
  assert.equal(f.changes(), 2);
  f.connection.stop();
});

test("revoked or expired authentication stops reconnects, cancels pending work and clears access", async () => {
  for (const status of [401, 403]) {
    const f = fixture(async () => {
      throw new AccessError(status, "Session ended", "/login");
    });
    f.sources[0].emit("item.created", { id }, "boot:1");
    f.sources[0].fail();
    await flush();
    assert.equal(f.denied[0].status, status);
    assert.equal(f.sources[0].closed, true);
    assert.equal(f.jobs.size, 0);
    f.windowTarget.dispatchEvent(new Event("focus"));
    f.windowTarget.dispatchEvent(new Event("online"));
    f.advance(120000);
    await flush();
    assert.equal(f.sources.length, 1);
    assert.equal(f.probes(), 1);
    assert.equal(f.changes(), 0);
  }
});

test("gateway/network failures back off, then recover to current state", async () => {
  let broken = true;
  const f = fixture(async () => {
    if (broken) throw new AccessError(503, "Gateway unavailable");
  });
  f.sources[0].fail();
  f.sources[0].fail();
  await flush();
  assert.equal(f.probes(), 1);
  assert.equal(f.states.at(-1), "reconnecting");
  assert.equal(f.denied.length, 0);
  f.advance(999);
  await flush();
  assert.equal(f.probes(), 1);
  f.advance(1);
  await flush();
  assert.equal(f.probes(), 2);
  f.advance(1999);
  await flush();
  assert.equal(f.probes(), 2);
  broken = false;
  f.advance(1);
  await flush();
  f.advance(4000);
  await flush();
  assert.equal(f.sources.length, 2);
  f.sources[1].emit("sync.ready");
  f.advance(80);
  assert.equal(f.changes(), 1);
  f.connection.stop();
});

test("a working access probe cannot cause a rapid failing EventSource loop", async () => {
  const f = fixture();
  f.sources[0].fail();
  await flush();
  assert.equal(f.sources.length, 1);
  f.advance(1000);
  assert.equal(f.sources.length, 2);
  f.sources[1].fail();
  await flush();
  f.advance(1999);
  assert.equal(f.sources.length, 2);
  f.advance(1);
  assert.equal(f.sources.length, 3);
  f.connection.stop();
});

test("offline, resume and pagehide close abandoned streams and pending probes", async () => {
  let aborted = false;
  const f = fixture(async (signal) => {
    signal.addEventListener("abort", () => {
      aborted = true;
    });
  });
  f.sources[0].emit("sync.ready");
  f.advance(80);
  f.windowTarget.navigator.onLine = false;
  f.windowTarget.dispatchEvent(new Event("offline"));
  assert.equal(f.sources[0].closed, true);
  assert.equal(f.states.at(-1), "offline");
  f.advance(60000);
  await flush();
  assert.equal(f.probes(), 0);
  f.windowTarget.navigator.onLine = true;
  f.windowTarget.dispatchEvent(new Event("online"));
  await flush();
  assert.equal(f.sources.length, 2);
  f.sources[1].emit("sync.ready");
  f.advance(80);
  f.documentTarget.dispatchEvent(new Event("visibilitychange"));
  await flush();
  assert.equal(f.sources.length, 3);
  f.windowTarget.dispatchEvent(new Event("pagehide"));
  assert.equal(f.sources[2].closed, true);
  assert.equal(f.jobs.size, 0);
  f.advance(120000);
  await flush();
  assert.equal(f.sources.length, 3);
  // Separate pending probe: cleanup must abort it and ignore its late success.
  let finish;
  const pending = fixture(
    (signal) =>
      new Promise((resolve) => {
        finish = resolve;
        signal.addEventListener("abort", () => {
          aborted = true;
        });
      }),
  );
  pending.sources[0].fail();
  pending.connection.stop();
  assert.equal(aborted, true);
  finish({});
  await flush();
  assert.equal(pending.sources.length, 1);
});

test("watchdog recovers a silent transport and malformed notifications never inject content", async () => {
  const f = fixture();
  f.sources[0].emit("sync.ready");
  f.advance(80);
  f.advance(29920);
  await flush();
  assert.equal(f.sources[0].closed, true);
  f.advance(1000);
  assert.equal(f.sources.length, 2);
  f.sources[1].emit(
    "item.created",
    { text: "unexpected private content" },
    "new:1",
  );
  await flush();
  assert.equal(f.sources[1].closed, true);
  assert.equal(f.changes(), 1);
  f.connection.stop();
});
