// Replaced by the build plugin with an explicit, versioned list of static assets.
const SHELL_CONFIG = __CAVVOID_PWA_CONFIG__;
const cacheName = SHELL_CONFIG.cacheName;
const allowed = new Map(SHELL_CONFIG.assets.map((asset) => [asset.url, asset]));
const pages = new Set(["/", "/kept", "/settings"]);

function validResponse(response, url, asset) {
  if (
    response.status !== 200 ||
    response.redirected ||
    response.url !== url ||
    ["opaque", "opaqueredirect"].includes(response.type)
  )
    return false;
  const type = (response.headers.get("Content-Type") || "")
    .split(";")[0]
    .trim();
  return (
    asset.types.includes(type) &&
    (asset.url !== SHELL_CONFIG.shell ||
      response.headers.get("X-CavVoid-Shell") === "static")
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        // Do not follow a signed-out redirect, or reuse a response from the old SW.
        const cache = await caches.open(cacheName);
        // Consume each body before opening the next request. Holding unread
        // responses can exhaust the browser's HTTP connection pool.
        for (const asset of SHELL_CONFIG.assets) {
          const url = new URL(asset.url, self.location.origin).href;
          const response = await fetch(
            new Request(url, {
              credentials: "same-origin",
              cache: "reload",
              redirect: "error",
              signal: controller.signal,
            }),
          );
          if (!validResponse(response, url, asset))
            throw new Error("Static shell not available");
          await cache.put(asset.url, response);
        }
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("cavvoid-shell-") && name !== cacheName)
          await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE")
    event.waitUntil(self.skipWaiting());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    request.headers.has("Range")
  )
    return;
  // Private/API/auth/stream/download requests never enter CacheStorage or receive
  // shell HTML as a fallback. Unknown paths and query variants are network-only.
  const asset = !url.search && allowed.get(url.pathname);
  if (asset && request.cache !== "reload" && request.cache !== "no-store") {
    event.respondWith(
      (async () =>
        (await (await caches.open(cacheName)).match(asset.url)) ||
        fetch(request))(),
    );
  } else if (request.mode === "navigate" && pages.has(url.pathname)) {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch {
          const shell = await (
            await caches.open(cacheName)
          ).match(SHELL_CONFIG.shell);
          if (shell) return shell;
          return new Response(
            "CavVoid is offline. Reconnect to open your private space.",
            {
              status: 503,
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Cache-Control": "no-store",
              },
            },
          );
        }
      })(),
    );
  }
});
