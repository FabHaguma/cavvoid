import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../backend/app.js";
import { loadConfig, readEnvironment } from "../backend/config.js";
import {
  defaultGatekeeperRepo,
  loadGatekeeperSource,
} from "../scripts/local-gatekeeper.js";
import {
  closeServer,
  httpRequest,
  listen,
  removeTestDirectory,
} from "../backend/test/helpers.js";
import { openEventStream } from "../backend/test/event-client.js";

test(
  "real Gatekeeper: independent live sessions, bounded streams, revocation, logout, expiry and outage",
  { timeout: 60000 },
  async (t) => {
    const source = loadGatekeeperSource(
      readEnvironment().LOCAL_GATEKEEPER_REPO || defaultGatekeeperRepo(),
    );
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "cavvoid-real-gateway-"),
    );
    const secret = randomBytes(32).toString("hex");
    const password = randomBytes(20).toString("base64url");
    writeFileSync(
      path.join(directory, "index.html"),
      "<h1>Real gateway approved this page</h1>",
    );
    const config = {
      ...loadConfig({
        GATEKEEPER_PROXY_SECRET: secret,
        DATABASE_PATH: ":memory:",
      }),
      frontendPath: directory,
    };
    const cavvoid = createApp({ config });
    const appServer = await listen(cavvoid.app);
    config.appHost = "localhost:" + appServer.address().port;
    config.appOrigin = "http://" + config.appHost;
    const env = {
      PORT: "4000",
      GATEKEEPER_URL: "http://localhost:4000",
      ADMIN_PASSWORD: password,
      PROXY_AUTH_SECRET: secret,
      PROTECTED_APPS: JSON.stringify([
        { id: "cavvoid", name: "CavVoid", url: config.appOrigin },
      ]),
      DATABASE_PATH: path.join(directory, "gatekeeper.sqlite"),
      SESSION_TTL_HOURS: "1",
      TRUST_PROXY: "loopback",
    };
    let gateway, gatewayServer, gatewayConfig;
    async function startGateway() {
      gatewayConfig = source.loadConfig(env);
      gateway = await source.createApp({ config: gatewayConfig });
      gatewayServer = await listen(gateway.app);
      gatewayConfig.gatewayUrl =
        "http://localhost:" + gatewayServer.address().port;
      gatewayConfig.allowedOrigins = new Set([gatewayConfig.gatewayUrl]);
      config.gatewayUrl = gatewayConfig.gatewayUrl;
    }
    async function stopGateway() {
      await closeServer(gatewayServer);
      await gateway.close();
      gatewayServer = null;
    }
    t.after(async () => {
      if (gatewayServer) await stopGateway();
      await closeServer(appServer);
      cavvoid.close();
      removeTestDirectory(directory, "cavvoid-real-gateway-");
    });
    await startGateway();
    const appRequest = (pathname, options) =>
      httpRequest(appServer, config.appHost, pathname, options);
    async function gwRequest(
      pathname,
      { cookie, method = "GET", csrfToken, body } = {},
    ) {
      return fetch(config.gatewayUrl + "/api/v1" + pathname, {
        method,
        headers: {
          Accept: "application/json",
          Origin: config.gatewayUrl,
          "Content-Type": "application/json",
          "X-Gatekeeper-Request": "1",
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    }
    async function login() {
      const result = await gwRequest("/login", {
        method: "POST",
        body: { password, returnTo: config.appOrigin + "/kept?from=test" },
      });
      assert.equal(result.status, 200);
      assert.equal(
        (await result.json()).redirectTo,
        config.appOrigin + "/kept?from=test",
      );
      const header = result.headers.getSetCookie()[0];
      assert.match(header, /HttpOnly/i);
      assert.match(header, /SameSite=Lax/i);
      assert.match(header, /Max-Age=3600/i);
      return header.split(";")[0];
    }
    const initial = await appRequest("/kept?from=test", {
      headers: { Accept: "text/html" },
    });
    assert.equal(initial.status, 302);
    assert.equal(
      new URL(initial.headers.location).searchParams.get("returnTo"),
      config.appOrigin + "/kept?from=test",
    );
    assert.equal((await appRequest("/api/auth/me")).status, 401);
    const first = await login();
    const second = await login();
    const liveCookies = [
      first,
      second,
      await login(),
      await login(),
      await login(),
    ];
    const openedAt = performance.now();
    const liveClients = await Promise.all(
      liveCookies.map((cookie) =>
        openEventStream(appServer, config.appHost, { Cookie: cookie }),
      ),
    );
    t.after(() => {
      for (const client of liveClients) client.close();
    });
    await Promise.all(
      liveClients.map((client) => client.waitFor("sync.ready")),
    );
    for (const cookie of [first, second]) {
      const response = await appRequest("/api/auth/me", {
        headers: { Cookie: cookie, "X-User-Id": "attacker" },
      });
      assert.equal(response.status, 200);
      assert.equal(response.json().owner.id, "owner");
    }
    assert.equal(
      (await appRequest("/kept?from=test", { headers: { Cookie: first } }))
        .status,
      200,
    );
    // Two separately signed-in clients transfer in both directions through the real gateway.
    const mutationHeaders = (cookie) => ({
      Cookie: cookie,
      Origin: config.appOrigin,
      "X-CavVoid-Request": "1",
      "Content-Type": "application/json",
    });
    const submissionId = () => globalThis.crypto.randomUUID();
    const deliveryStarted = performance.now();
    const createdText = await appRequest("/api/items/text", {
      method: "POST",
      headers: mutationHeaders(first),
      body: JSON.stringify({
        text: "From the first client\n  to the second.",
        submissionId: submissionId(),
      }),
    });
    assert.equal(createdText.status, 201);
    const textItem = createdText.json().item;
    const submissionMs = performance.now() - deliveryStarted;
    assert.ok(
      submissionMs < 1000,
      "Text submission exceeded one second locally",
    );
    const liveDeliveries = await Promise.all(
      liveClients.map((client) =>
        client.waitFor(
          "item.created",
          (event) => event.data.id === textItem.id,
        ),
      ),
    );
    const deliveryMs = Math.max(
      ...liveDeliveries.map((event) => event.receivedAt - deliveryStarted),
    );
    assert.ok(deliveryMs < 2000, "Real-gateway delivery exceeded two seconds");
    t.diagnostic(
      "Five independent Gatekeeper sessions, max create delivery: " +
        deliveryMs.toFixed(1) +
        "ms",
    );
    const retrievalStarted = performance.now();
    assert.equal(
      (
        await appRequest("/api/items/" + textItem.id, {
          headers: { Cookie: second },
        })
      ).json().item.text,
      textItem.text,
    );
    const retrievalMs = performance.now() - retrievalStarted;
    assert.ok(retrievalMs < 1000, "Text retrieval exceeded one second locally");
    t.diagnostic(
      `Text submission ${submissionMs.toFixed(1)}ms; retrieval ${retrievalMs.toFixed(1)}ms through real Gatekeeper`,
    );
    const prefs = await appRequest("/api/preferences", {
      method: "PATCH",
      headers: mutationHeaders(first),
      body: JSON.stringify({ defaultExpiration: "1h" }),
    });
    assert.equal(prefs.status, 200);
    assert.equal(
      (
        await appRequest("/api/preferences", { headers: { Cookie: second } })
      ).json().defaultExpiration,
      "1h",
    );
    await Promise.all(
      liveClients.map((client) => client.waitFor("preferences.updated")),
    );
    assert.equal(
      (
        await appRequest(
          "/api/items?section=all&type=text&q=second&sort=oldest",
          { headers: { Cookie: second } },
        )
      ).json().items[0].id,
      textItem.id,
    );
    const createdLink = await appRequest("/api/items/text", {
      method: "POST",
      headers: mutationHeaders(second),
      body: JSON.stringify({
        text: "https://example.com/return-transfer",
        submissionId: submissionId(),
      }),
    });
    assert.equal(createdLink.status, 201);
    const linkItem = createdLink.json().item;
    assert.equal(
      Date.parse(linkItem.expiresAt) - Date.parse(linkItem.createdAt),
      3600000,
    );
    assert.equal(
      (await appRequest("/api/storage", { headers: { Cookie: second } })).json()
        .counts.total,
      2,
    );
    assert.equal(
      (
        await appRequest("/api/preferences", {
          method: "PATCH",
          headers: mutationHeaders(second),
          body: JSON.stringify({ defaultExpiration: "24h" }),
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await appRequest("/api/items/" + linkItem.id, {
          headers: { Cookie: first },
        })
      ).json().item.type,
      "link",
    );
    assert.equal(
      (await appRequest("/api/items", { headers: { Cookie: first } })).json()
        .total,
      2,
    );
    assert.equal(
      (
        await appRequest("/api/items/" + linkItem.id, {
          method: "DELETE",
          headers: mutationHeaders(first),
        })
      ).status,
      204,
    );
    assert.equal(
      (
        await appRequest("/api/items/" + linkItem.id, {
          headers: { Cookie: second },
        })
      ).status,
      404,
    );
    const keptText = await appRequest("/api/items/" + textItem.id, {
      method: "PATCH",
      headers: mutationHeaders(first),
      body: JSON.stringify({ retention: "keep" }),
    });
    assert.equal(keptText.status, 200);
    assert.equal(
      (
        await appRequest("/api/items?section=kept", {
          headers: { Cookie: second },
        })
      ).json().items[0].id,
      textItem.id,
    );
    assert.equal(
      (
        await appRequest("/api/items/" + textItem.id, {
          method: "PATCH",
          headers: { ...mutationHeaders(second), Cookie: "" },
          body: JSON.stringify({ retention: "24h" }),
        })
      ).status,
      401,
    );
    const unkeptText = await appRequest("/api/items/" + textItem.id, {
      method: "PATCH",
      headers: mutationHeaders(second),
      body: JSON.stringify({ retention: "24h" }),
    });
    assert.equal(unkeptText.status, 200);
    assert.equal(unkeptText.json().item.isKept, false);
    // Fresh HTTP clients reuse persistent cookies after the actual gateway/database is reopened.
    // File data travels through the same real gateway between independently signed-in clients.
    const transferredFiles = [];
    for (const [filename, bytes, sender, receiver] of [
      [
        "photo.png",
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPFsAAAAASUVORK5CYII=",
          "base64",
        ),
        first,
        second,
      ],
      [
        "recording.mp3",
        Buffer.concat([Buffer.from("ID3"), Buffer.alloc(60)]),
        second,
        first,
      ],
      [
        "document.pdf",
        Buffer.from("%PDF-1.4\nA private document"),
        first,
        second,
      ],
    ]) {
      const boundary = "test-file-boundary-" + submissionId();
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const result = await appRequest("/api/items/file", {
        method: "POST",
        headers: {
          ...mutationHeaders(sender),
          "Content-Type": "multipart/form-data; boundary=" + boundary,
          "X-File-Size": String(bytes.length),
          "X-Upload-Id": submissionId(),
        },
        body,
      });
      assert.equal(result.status, 201, result.text);
      const file = result.json().item;
      const retrieved = await appRequest(`/api/items/${file.id}/download`, {
        headers: { Cookie: receiver },
      });
      assert.equal(retrieved.status, 200);
      assert.deepEqual(retrieved.buffer, bytes);
      transferredFiles.push(file);
      assert.equal(
        (
          await appRequest(`/api/items/${file.id}/download`, {
            headers: { Range: "bytes=0-2" },
          })
        ).status,
        401,
      );
    }
    assert.equal(
      (
        await appRequest(`/api/items/${transferredFiles[0].id}/preview`, {
          headers: { Cookie: second },
        })
      ).status,
      200,
    );
    await stopGateway();
    const deniedOutageStream = await openEventStream(
      appServer,
      config.appHost,
      { Cookie: first },
    );
    assert.equal(deniedOutageStream.status, 503);
    await deniedOutageStream.closed;
    assert.equal(
      (await appRequest("/api/auth/me", { headers: { Cookie: first } })).status,
      503,
    );
    await startGateway();
    for (const cookie of [first, second])
      assert.equal(
        (await appRequest("/api/auth/me", { headers: { Cookie: cookie } }))
          .status,
        200,
      );
    const firstSession = await (
      await gwRequest("/session", { cookie: first })
    ).json();
    const secondSession = await (
      await gwRequest("/session", { cookie: second })
    ).json();
    const revoked = await gwRequest(
      "/sessions/" + secondSession.sessionId + "/revoke",
      {
        method: "POST",
        cookie: first,
        csrfToken: firstSession.csrfToken,
        body: {},
      },
    );
    assert.equal(revoked.status, 204);
    assert.equal(
      (
        await appRequest(`/api/items/${transferredFiles[0].id}/download`, {
          headers: { Cookie: second, Range: "bytes=0-3" },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await appRequest("/api/items/" + textItem.id, {
          headers: { Cookie: second },
        })
      ).status,
      401,
    );
    assert.equal(
      (
        await appRequest("/api/items/" + textItem.id, {
          method: "DELETE",
          headers: mutationHeaders(second),
        })
      ).status,
      401,
    );
    assert.equal(
      (await appRequest("/api/auth/me", { headers: { Cookie: second } }))
        .status,
      401,
    );
    assert.equal(
      (await appRequest("/api/auth/me", { headers: { Cookie: first } })).status,
      200,
    );
    const signedOut = await gwRequest("/logout", {
      method: "POST",
      cookie: first,
      csrfToken: firstSession.csrfToken,
      body: {},
    });
    assert.equal(signedOut.status, 204);
    assert.equal(
      (await appRequest("/api/auth/me", { headers: { Cookie: first } })).status,
      401,
    );
    const expiring = await login();
    const originalNow = Date.now;
    try {
      const future = originalNow() + 2 * 60 * 60 * 1000;
      Date.now = () => future;
      assert.equal(
        (await appRequest("/api/auth/me", { headers: { Cookie: expiring } }))
          .status,
        401,
      );
    } finally {
      Date.now = originalNow;
    }
    // Traffic must not renew the connection authenticated before revocation.
    const eventTraffic = setInterval(
      () => cavvoid.events.publish("owner", "storage.updated"),
      100,
    );
    t.after(() => clearInterval(eventTraffic));
    const closedAt = await Promise.all(
      liveClients.map((client) => client.closed),
    );
    const lifetime = Math.max(...closedAt.map((time) => time - openedAt));
    assert.ok(
      lifetime < 30000,
      "An authenticated stream remained open for " + lifetime + "ms",
    );
    assert.equal(cavvoid.events.clients.size, 0);
    for (const cookie of [first, second]) {
      const denied = await openEventStream(appServer, config.appHost, {
        Cookie: cookie,
      });
      assert.equal(denied.status, 401);
      await denied.closed;
    }
    t.diagnostic(
      "Maximum real stream lifetime under event traffic: " +
        lifetime.toFixed(1) +
        "ms; revoked/logout reconnects denied",
    );
  },
);
