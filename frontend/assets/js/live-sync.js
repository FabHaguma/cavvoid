import { getAccess } from "./api.js";

const changeTypes = [
  "item.created",
  "item.updated",
  "item.deleted",
  "storage.updated",
  "preferences.updated",
];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function startLiveSync({
  onChange,
  onStatus,
  onDenied,
  sourceFactory = () => new EventSource("/api/events"),
  probe = getAccess,
  windowTarget = window,
  documentTarget = document,
  timers = {
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (id) => globalThis.clearTimeout(id),
  },
  random = Math.random,
}) {
  let stopped = false,
    source,
    checking = false,
    controller;
  let retryTimer,
    watchdog,
    stableTimer,
    batchTimer,
    failures = 0,
    generation = 0;
  const seen = new Set();
  const clear = (timer) => timers.clearTimeout(timer);
  const status = (value) => {
    if (!stopped) onStatus(value);
  };
  const changed = () => {
    if (batchTimer || stopped) return;
    batchTimer = timers.setTimeout(() => {
      batchTimer = null;
      if (!stopped) onChange();
    }, 80);
  };
  const closeSource = () => {
    generation++;
    source?.close();
    source = null;
    clear(watchdog);
    clear(stableTimer);
  };
  const offline = () => windowTarget.navigator?.onLine === false;
  function retry() {
    if (stopped || offline()) {
      status("offline");
      return;
    }
    const delay =
      Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) +
      Math.floor(random() * 250);
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      recover();
    }, delay);
  }
  async function recover(mode = "failure") {
    if (stopped || checking) return;
    clear(retryTimer);
    retryTimer = null;
    closeSource();
    if (offline()) {
      status("offline");
      return;
    }
    if (mode !== "rotate") status("reconnecting");
    checking = true;
    const probeController = new AbortController();
    controller = probeController;
    const current = generation;
    try {
      await probe(probeController.signal);
      if (stopped || current !== generation) return;
      if (mode === "failure") {
        const delay =
          Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)) +
          Math.floor(random() * 250);
        retryTimer = timers.setTimeout(() => {
          retryTimer = null;
          connect();
        }, delay);
      } else connect();
    } catch (error) {
      if (stopped || current !== generation) return;
      if ([401, 403].includes(error.status)) {
        stop();
        onDenied(error);
        return;
      }
      status(offline() ? "offline" : "reconnecting");
      retry();
    } finally {
      if (controller === probeController) {
        checking = false;
        controller = null;
      }
    }
  }
  function connect() {
    if (stopped || offline()) {
      status("offline");
      return;
    }
    const current = ++generation;
    let connection;
    try {
      connection = sourceFactory();
      source = connection;
    } catch {
      status("unsupported");
      return;
    }
    const active = () => !stopped && current === generation;
    // A dead transport cannot remain silently "live" if its close is lost.
    watchdog = timers.setTimeout(() => {
      if (active()) recover();
    }, 30000);
    connection.addEventListener("sync.ready", () => {
      if (!active()) return;
      status("live");
      changed(); // Full reconciliation on every connection, including missed events.
      stableTimer = timers.setTimeout(() => {
        failures = 0;
      }, 5000);
    });
    connection.addEventListener("stream.end", () => {
      if (active()) recover("rotate");
    });
    for (const type of changeTypes)
      connection.addEventListener(type, (event) => {
        if (!active()) return;
        let data;
        try {
          data = JSON.parse(event.data);
        } catch {
          return recover();
        }
        if (
          !data ||
          typeof data !== "object" ||
          (type.startsWith("item.") && !uuid.test(data.id || ""))
        )
          return recover();
        if (!event.lastEventId || event.lastEventId.length > 120)
          return recover();
        if (seen.has(event.lastEventId)) return;
        seen.add(event.lastEventId);
        if (seen.size > 256) seen.delete(seen.values().next().value);
        changed();
      });
    connection.onerror = () => {
      if (active()) recover();
    };
  }
  const resume = () => {
    if (documentTarget.visibilityState === "visible") recover("resume");
  };
  const disconnected = () => {
    controller?.abort();
    controller = null;
    checking = false;
    clear(retryTimer);
    retryTimer = null;
    closeSource();
    status("offline");
  };
  function stop() {
    if (stopped) return;
    stopped = true;
    controller?.abort();
    closeSource();
    clear(retryTimer);
    clear(batchTimer);
    seen.clear();
    windowTarget.removeEventListener("online", recoverOnline);
    windowTarget.removeEventListener("offline", disconnected);
    windowTarget.removeEventListener("focus", resume);
    windowTarget.removeEventListener("pagehide", stop);
    documentTarget.removeEventListener("visibilitychange", resume);
  }
  const recoverOnline = () => recover("resume");
  windowTarget.addEventListener("online", recoverOnline);
  windowTarget.addEventListener("offline", disconnected);
  windowTarget.addEventListener("focus", resume);
  windowTarget.addEventListener("pagehide", stop);
  documentTarget.addEventListener("visibilitychange", resume);
  status("connecting");
  connect();
  return { stop, reconnect: recoverOnline };
}
