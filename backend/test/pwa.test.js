import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { pwaBuild } from "../../scripts/pwa-build.js";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import {
  closeServer,
  listen,
  httpRequest,
  removeTestDirectory,
} from "./helpers.js";
import { watchPwa } from "../../frontend/assets/js/pwa.js";
import { apiRequest } from "../../frontend/assets/js/api.js";
import { uploadFile } from "../../frontend/assets/js/upload.js";

function artifacts(entry = "static code") {
  const emitted = new Map(),
    plugin = pwaBuild();
  const html = plugin.transformIndexHtml.handler(
    '<html><head></head><body><div id="root"></div><script src="/assets/app.js"></script></body></html>',
  );
  plugin.generateBundle.handler.call(
    {
      addWatchFile() {},
      emitFile(file) {
        emitted.set(file.fileName, file.source);
      },
    },
    {},
    {
      "index.html": { type: "asset", fileName: "index.html", source: html },
      "app.js": { type: "chunk", fileName: "assets/app.js", code: entry },
      "style.css": {
        type: "asset",
        fileName: "assets/style.css",
        source: "body{color:white}",
      },
    },
  );
  return { emitted, html };
}
function worker({
  fetchResponse,
  offline = false,
  boundedBodyPool = false,
} = {}) {
  const { emitted } = artifacts();
  const source = emitted.get("sw.js");
  const config = JSON.parse(source.match(/const SHELL_CONFIG = (.*);/)[1]);
  const origin = "http://localhost:3000",
    handlers = {},
    stores = new Map(),
    writes = [],
    requests = [],
    matches = [];
  let broken = offline,
    claimed = 0,
    skipped = 0;
  const unread = new Set();
  const key = (url) =>
    new URL(typeof url === "string" ? url : url.url, origin).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(url, response) {
          const stored = response.clone();
          await response.arrayBuffer();
          unread.delete(response);
          writes.push(key(url));
          store.set(key(url), stored);
        },
        async match(url) {
          matches.push(key(url));
          return store.get(key(url))?.clone();
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };
  const self = {
    location: { origin },
    addEventListener(type, handler) {
      handlers[type] = handler;
    },
    clients: {
      async claim() {
        claimed++;
      },
    },
    async skipWaiting() {
      skipped++;
    },
  };
  const fetch = async (request) => {
    requests.push(request);
    if (broken) throw new Error("offline");
    if (boundedBodyPool && unread.size >= 2)
      throw new Error("HTTP pool exhausted by unread bodies");
    const asset = config.assets.find(
      (a) => new URL(a.url, origin).href === request.url,
    );
    const response =
      fetchResponse?.(request, asset) ||
      new Response(
        asset?.url === "/pwa-shell.html"
          ? emitted.get("pwa-shell.html")
          : "static asset",
        {
          status: 200,
          headers: {
            "Content-Type": asset?.types[0] || "application/json",
            "X-CavVoid-Shell": "static",
          },
        },
      );
    if (!response.url)
      Object.defineProperty(response, "url", { value: request.url });
    unread.add(response);
    return response;
  };
  vm.runInNewContext(source, {
    self,
    caches,
    fetch,
    Request,
    Response,
    URL,
    Map,
    Set,
    Promise,
    Error,
    AbortController,
    setTimeout,
    clearTimeout,
  });
  async function lifecycle(type, data) {
    let result;
    handlers[type]({
      data,
      waitUntil(value) {
        result = value;
      },
    });
    await result;
  }
  async function get(
    url,
    { method = "GET", mode = "cors", headers = {}, cache = "default" } = {},
  ) {
    let response,
      handled = false;
    handlers.fetch({
      request: {
        url: new URL(url, origin).href,
        method,
        mode,
        headers: new Headers(headers),
        cache,
      },
      respondWith(value) {
        handled = true;
        response = value;
      },
    });
    return { handled, response: await response };
  }
  return {
    config,
    stores,
    writes,
    requests,
    matches,
    lifecycle,
    get,
    caches,
    offline: () => {
      broken = true;
    },
    claimed: () => claimed,
    skipped: () => skipped,
  };
}

test("PWA build emits stable identity, correct icons, a content-free shell and a versioned allowlist", () => {
  const first = artifacts(),
    second = artifacts("a new build");
  const manifest = JSON.parse(first.emitted.get("manifest.webmanifest"));
  assert.equal(manifest.id, "/");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.orientation, "any");
  for (const name of [
    "icon-192",
    "icon-512",
    "icon-maskable-512",
    "apple-touch-icon",
  ]) {
    const bytes = first.emitted.get("assets/pwa/" + name + ".png");
    assert.deepEqual(
      bytes.subarray(0, 8),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    const expected =
      name === "icon-192" ? 192 : name === "apple-touch-icon" ? 180 : 512;
    assert.equal(bytes.readUInt32BE(16), expected);
    assert.equal(bytes.readUInt32BE(20), expected);
  }
  assert.match(first.html, /crossorigin="use-credentials"/);
  assert.match(first.html, /apple-touch-icon/);
  assert.match(first.emitted.get("pwa-shell.html"), /<div id="root"><\/div>/);
  assert.ok(!first.emitted.get("sw.js").includes("__CAVVOID_PWA_CONFIG__"));
  assert.notEqual(first.emitted.get("sw.js"), second.emitted.get("sw.js"));
});

test("install caches exactly the static allowlist without credentials, API data or redirects", async () => {
  const f = worker();
  await f.lifecycle("install");
  assert.equal(f.writes.length, f.config.assets.length);
  assert.ok(
    f.writes.every((url) =>
      f.config.assets.some(
        (asset) => new URL(asset.url, "http://localhost:3000").href === url,
      ),
    ),
  );
  for (const request of f.requests) {
    assert.equal(request.credentials, "same-origin");
    assert.equal(request.redirect, "error");
    assert.equal(request.cache, "reload");
  }
  assert.equal(f.skipped(), 0);
  const shell = await (
    await f.caches.open(f.config.cacheName)
  ).match("/pwa-shell.html");
  assert.ok(!(await shell.text()).includes("private-item-marker"));
});

test("installation consumes bodies promptly when the browser has a small HTTP connection pool", async () => {
  const f = worker({ boundedBodyPool: true });
  await f.lifecycle("install");
  assert.equal(f.writes.length, f.config.assets.length);
});

test("failed or signed-out install never stores denial/login HTML, partial cache or private content", async (t) => {
  for (const [name, options] of [
    ["network", { offline: true }],
    ...[401, 403, 503].map((status) => [
      "status " + status,
      { fetchResponse: () => new Response("private-item-marker", { status }) },
    ]),
    [
      "login HTML",
      {
        fetchResponse: () =>
          new Response("login", { headers: { "Content-Type": "text/html" } }),
      },
    ],
    [
      "followed redirect",
      {
        fetchResponse: (req) => {
          const r = new Response("login", {
            headers: { "Content-Type": "text/html" },
          });
          Object.defineProperty(r, "redirected", { value: true });
          return r;
        },
      },
    ],
    [
      "wrong origin",
      {
        fetchResponse: () => {
          const r = new Response("login");
          Object.defineProperty(r, "url", {
            value: "http://localhost:4000/login",
          });
          return r;
        },
      },
    ],
    [
      "unmarked HTML",
      {
        fetchResponse: (req, asset) =>
          new Response("login", {
            headers: { "Content-Type": asset.types[0] },
          }),
      },
    ],
  ])
    await t.test(name, async () => {
      const f = worker(options);
      await assert.rejects(f.lifecycle("install"));
      assert.equal(f.stores.has(f.config.cacheName), false);
    });
});

test("offline fetch serves only allowed static files and known navigation; private requests remain network-only", async () => {
  const f = worker();
  await f.lifecycle("install");
  f.offline();
  for (const url of ["/", "/kept", "/settings", "/kept?from=app"]) {
    const result = await f.get(url, { mode: "navigate" });
    assert.equal(result.handled, true);
    assert.equal(result.response.status, 200);
    assert.match(await result.response.text(), /id="root"/);
  }
  const icon = await f.get("/assets/pwa/icon-192.png");
  assert.equal(icon.response.status, 200);
  for (const url of [
    "/api/auth/me",
    "/api/items",
    "/api/items/secret/preview",
    "/api/items/secret/download",
    "/api/events",
    "/auth/verify",
    "/login",
    "/assets/app.js?private=token",
    "http://localhost:4000/login",
    "/sw.js",
    "/unknown",
  ]) {
    assert.equal((await f.get(url, { mode: "navigate" })).handled, false, url);
  }
  assert.equal(
    (await f.get("/assets/app.js", { method: "POST" })).handled,
    false,
  );
  assert.equal(
    (await f.get("/assets/app.js", { headers: { Range: "bytes=0-3" } }))
      .handled,
    false,
  );
  assert.equal(
    (await f.get("/assets/app.js", { cache: "reload" })).handled,
    false,
  );
  assert.ok(
    f.matches.every((url) => !url.includes("/api/") && !url.includes("/auth/")),
  );
  assert.equal(f.writes.length, f.config.assets.length);
});

test("online navigation preserves HTTP denials, and update activation deletes only CavVoid's obsolete shell", async () => {
  const f = worker({
    fetchResponse: (req, asset) =>
      asset ? null : new Response("access denied", { status: 401 }),
  });
  await f.lifecycle("install");
  const response = (await f.get("/kept", { mode: "navigate" })).response;
  assert.equal(response.status, 401);
  assert.equal(await response.text(), "access denied");
  f.stores.set("other-app-data", new Map());
  f.stores.set("cavvoid-shell-old", new Map());
  await f.lifecycle("activate");
  assert.equal(f.claimed(), 1);
  assert.equal(f.stores.has("other-app-data"), true);
  assert.equal(f.stores.has("cavvoid-shell-old"), false);
  assert.equal(f.stores.has(f.config.cacheName), true);
  await f.lifecycle("message", { type: "OTHER" });
  assert.equal(f.skipped(), 0);
  await f.lifecycle("message", { type: "ACTIVATE_UPDATE" });
  assert.equal(f.skipped(), 1);
});

test("manifest, worker and shell are gateway-protected; denial cannot carry the shell marker", async (t) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cavvoid-pwa-http-"));
  const { emitted } = artifacts();
  for (const [name, source] of emitted) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), source);
  }
  const config = {
    ...loadConfig({
      GATEKEEPER_PROXY_SECRET: "pwa-boundary-secret-".repeat(3),
      DATABASE_PATH: ":memory:",
    }),
    frontendPath: directory,
  };
  const instance = createApp({
    config,
    fetchImpl: async (url, options) =>
      new Response(null, {
        status:
          options.headers.Cookie === "gatekeeper_session=pwa-test" ? 204 : 401,
      }),
  });
  const server = await listen(instance.app);
  t.after(async () => {
    await closeServer(server);
    instance.close();
    removeTestDirectory(directory, "cavvoid-pwa-http-");
  });
  for (const pathname of [
    "/manifest.webmanifest",
    "/sw.js",
    "/pwa-shell.html",
    "/assets/pwa/icon-512.png",
  ]) {
    const denied = await httpRequest(server, config.appHost, pathname);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers["x-cavvoid-shell"], undefined);
    const allowed = await httpRequest(server, config.appHost, pathname, {
      headers: { Cookie: "gatekeeper_session=pwa-test" },
    });
    assert.equal(allowed.status, 200, pathname);
    assert.equal(allowed.headers["cache-control"], "no-store");
    if (pathname === "/pwa-shell.html")
      assert.equal(allowed.headers["x-cavvoid-shell"], "static");
    if (pathname === "/manifest.webmanifest")
      assert.match(
        allowed.headers["content-type"],
        /application\/manifest\+json/,
      );
    if (pathname === "/sw.js")
      assert.equal(allowed.headers["service-worker-allowed"], "/");
  }
});

const flush = () => new Promise((resolve) => setImmediate(resolve));
test("PWA registration follows approved access; updates reload only after this tab's explicit action", async () => {
  const target = new EventTarget();
  target.navigator = { onLine: true };
  let reloads = 0;
  target.location = {
    reload() {
      reloads++;
    },
  };
  const sw = new EventTarget();
  let registrations = 0,
    reads = 0,
    activated = 0;
  const reg = new EventTarget();
  reg.active = {};
  reg.waiting = {
    postMessage(message) {
      assert.equal(message.type, "ACTIVATE_UPDATE");
      activated++;
    },
  };
  reg.update = async () => {};
  sw.getRegistration = async () => {
    reads++;
    return reg;
  };
  sw.register = async (url, options) => {
    assert.equal(url, "/sw.js");
    assert.equal(options.updateViaCache, "none");
    registrations++;
    return reg;
  };
  const state = [];
  let controller = watchPwa({
    allowRegistration: false,
    onState: (value) => state.push(value),
    serviceWorker: sw,
    windowTarget: target,
    secure: true,
  });
  await flush();
  assert.equal(registrations, 0);
  assert.equal(reads, 1);
  controller.stop();
  controller = watchPwa({
    allowRegistration: true,
    onState: (value) => state.push(value),
    serviceWorker: sw,
    windowTarget: target,
    secure: true,
  });
  await flush();
  assert.equal(registrations, 1);
  assert.equal(state.at(-1).ready, true);
  assert.equal(state.at(-1).updateReady, true);
  sw.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 0);
  controller.update();
  assert.equal(activated, 1);
  sw.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 1);
  sw.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 1);
  controller.stop();
});

test("offline mutations never send or queue a text/file request", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(
    globalThis.navigator,
    "onLine",
  );
  Object.defineProperty(globalThis.navigator, "onLine", {
    value: false,
    configurable: true,
  });
  t.after(() => {
    if (previous)
      Object.defineProperty(globalThis.navigator, "onLine", previous);
    else delete globalThis.navigator.onLine;
  });
  let sent = 0;
  await assert.rejects(
    apiRequest(
      "/api/items/text",
      { method: "POST", body: { text: "unsent" } },
      async () => {
        sent++;
      },
    ),
    (error) => error.code === "offline",
  );
  await assert.rejects(
    uploadFile(new File(["unsent"], "private.txt"), "test", {
      xhrFactory: () => {
        sent++;
      },
    }),
    (error) => error.code === "offline",
  );
  assert.equal(sent, 0);
});
