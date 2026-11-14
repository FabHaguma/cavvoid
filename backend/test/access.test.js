import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import {
  closeServer,
  httpRequest,
  listen,
  removeTestDirectory,
} from "./helpers.js";

const cookie = "gatekeeper_session=disposable-test-token";
async function fixture(t, responseFor) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cavvoid-http-test-"));
  mkdirSync(path.join(directory, "assets"));
  writeFileSync(
    path.join(directory, "index.html"),
    "<h1>private-shell-marker</h1>",
  );
  writeFileSync(path.join(directory, "assets/app.js"), "private-asset-marker");
  const config = {
    ...loadConfig({
      GATEKEEPER_PROXY_SECRET: "test-only-secret-".repeat(4),
      DATABASE_PATH: ":memory:",
    }),
    frontendPath: directory,
  };
  const calls = [];
  const instance = createApp({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (responseFor) return responseFor(url, options);
      return options.headers.Cookie === cookie
        ? new Response(null, { status: 204 })
        : new Response("{}", { status: 401 });
    },
  });
  const server = await listen(instance.app);
  t.after(async () => {
    await closeServer(server);
    instance.close();
    removeTestDirectory(directory, "cavvoid-http-test-");
  });
  return {
    config,
    calls,
    request: (pathname, options) =>
      httpRequest(server, config.appHost, pathname, options),
  };
}

test("private pages, assets, API, and future file routes are gated; health reveals no identity", async (t) => {
  const f = await fixture(t);
  assert.deepEqual((await f.request("/health")).json(), { status: "ok" });
  for (const pathname of [
    "/",
    "/kept",
    "/settings",
    "/assets/app.js",
    "/api/auth/me",
    "/api/items/id/download",
    "/api/events",
  ]) {
    const response = await f.request(pathname);
    assert.equal(response.status, 401, pathname);
    assert.ok(!response.text.includes("private-shell-marker"));
    assert.equal(response.headers["cache-control"], "no-store");
  }
  const signedIn = await f.request("/", {
    headers: { Cookie: cookie, Accept: "text/html" },
  });
  assert.equal(signedIn.status, 200);
  assert.match(signedIn.text, /private-shell-marker/);
  assert.equal(
    (await f.request("/.env", { headers: { Cookie: cookie } })).status,
    404,
  );
  assert.equal(
    (await f.request("/missing", { headers: { Cookie: cookie } })).status,
    404,
  );
});

test("forwarded metadata and owner IDs cannot be forged, credentials never reach the access response", async (t) => {
  const f = await fixture(t);
  const forged = {
    "X-Forwarded-Host": "attacker.example",
    "X-Forwarded-Uri": "/health",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-Method": "GET",
    "X-Gatekeeper-Proxy-Key": "forged",
    "X-User-Id": "attacker",
    "X-Auth-Request-User": "attacker",
  };
  assert.equal(
    (await f.request("/api/auth/me", { headers: forged })).status,
    401,
  );
  const response = await f.request("/api/auth/me?user_id=attacker", {
    headers: { ...forged, Cookie: cookie + "; other_app=private" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.json().owner.id, "owner");
  assert.equal(
    response.json().authentication.managementUrl,
    "http://localhost:4000/",
  );
  assert.ok(!/secret|token|session=|csrf/i.test(response.text));
  const forwarded = f.calls.at(-1).options.headers;
  assert.equal(forwarded["X-Forwarded-Host"], "localhost:3000");
  assert.equal(forwarded["X-Forwarded-Uri"], "/api/auth/me?user_id=attacker");
  assert.equal(forwarded["X-Forwarded-Proto"], "http");
  assert.equal(forwarded["X-Gatekeeper-Proxy-Key"], f.config.proxySecret);
  assert.equal(forwarded.Cookie, cookie);
  assert.equal(f.calls.at(-1).options.redirect, "manual");
  assert.equal(
    (
      await f.request("/api/auth/me", {
        headers: { Cookie: cookie + "; " + cookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (await f.request("/", { headers: { Host: "attacker.example" } })).status,
    421,
  );
});

test("only 204 grants access; unexpected status, redirect, timeout, and gateway outage fail closed", async (t) => {
  for (const responseFor of [
    () => new Response("<h1>login</h1>", { status: 200 }),
    () =>
      new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.example/" },
      }),
    () =>
      new Response(null, {
        status: 302,
        headers: {
          Location:
            "http://localhost:4000/login?returnTo=https://attacker.example/",
        },
      }),
    () => new Response("{}", { status: 500 }),
    () => {
      throw new TypeError("connection refused");
    },
    () => {
      throw new DOMException("timed out", "TimeoutError");
    },
  ]) {
    await t.test("denied verification response", async (sub) => {
      const f = await fixture(sub, responseFor);
      assert.equal(
        (await f.request("/api/auth/me", { headers: { Cookie: cookie } }))
          .status,
        503,
      );
      const page = await f.request("/", {
        headers: { Cookie: cookie, Accept: "text/html" },
      });
      assert.equal(page.status, 503);
      assert.match(page.text, /Your Void stays private/);
      assert.ok(!page.text.includes("private-shell-marker"));
    });
  }
});

test("only the expected allowlisted document redirect is passed through; API stays JSON", async (t) => {
  const f = await fixture(t, (url, options) => {
    if (options.headers.Accept === "text/html") {
      const returnTo =
        "http://localhost:3000" + options.headers["X-Forwarded-Uri"];
      return new Response(null, {
        status: 302,
        headers: {
          Location:
            "http://localhost:4000/login?returnTo=" +
            encodeURIComponent(returnTo),
        },
      });
    }
    return new Response("{}", { status: 401 });
  });
  const page = await f.request("/kept?query=~", {
    headers: { Accept: "text/html" },
  });
  assert.equal(page.status, 302);
  assert.equal(
    new URL(page.headers.location).searchParams.get("returnTo"),
    "http://localhost:3000/kept?query=~",
  );
  const api = await f.request("/api/auth/me", {
    headers: { Accept: "text/html" },
  });
  assert.equal(api.status, 401);
  assert.match(api.headers["content-type"], /application\/json/);
});

test("all API mutations require exact Origin and header, including multipart and preflight", async (t) => {
  const f = await fixture(t);
  const base = {
    Cookie: cookie,
    "X-CavVoid-Request": "1",
    Origin: f.config.appOrigin,
  };
  for (const method of ["POST", "PATCH", "PUT", "DELETE", "OPTIONS"]) {
    for (const headers of [
      { ...base, Origin: "https://attacker.example" },
      { ...base, Origin: undefined },
      { ...base, "X-CavVoid-Request": undefined },
    ]) {
      const defined = Object.fromEntries(
        Object.entries(headers).filter(([, value]) => value !== undefined),
      );
      const response = await f.request("/api/items/file", {
        method,
        headers: {
          ...defined,
          "Content-Type": "multipart/form-data; boundary=test",
        },
      });
      assert.equal(response.status, 403, method);
      assert.equal(response.headers["access-control-allow-origin"], undefined);
    }
    assert.equal(
      (await f.request("/api/items/file", { method, headers: base })).status,
      method === "POST" ? 400 : method === "PATCH" ? 415 : 404,
    );
  }
  assert.equal(
    (await f.request("/api/auth/login", { method: "POST", headers: base }))
      .status,
    404,
  );
});
