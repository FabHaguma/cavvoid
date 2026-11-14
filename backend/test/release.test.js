import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/database.js";
import { readPreferences, savePreferences } from "../preferences.js";
import { createItemStore } from "../items.js";
import {
  closeServer,
  httpRequest,
  listen,
  removeTestDirectory,
} from "./helpers.js";
import { openEventStream } from "./event-client.js";

async function fixture(t) {
  let now = Date.now();
  const config = {
    ...loadConfig({
      GATEKEEPER_PROXY_SECRET: "release-fixture-secret-".repeat(3),
      DATABASE_PATH: ":memory:",
    }),
  };
  const app = createApp({
    config,
    clock: () => now,
    fetchImpl: async (url, options) =>
      new Response(null, {
        status:
          options.headers.Cookie === "gatekeeper_session=release" ? 204 : 401,
      }),
  });
  const server = await listen(app.app);
  config.appHost = "localhost:" + server.address().port;
  config.appOrigin = "http://" + config.appHost;
  const headers = {
    Cookie: "gatekeeper_session=release",
    Origin: config.appOrigin,
    "X-CavVoid-Request": "1",
    "Content-Type": "application/json",
  };
  const request = (url, options = {}) =>
    httpRequest(server, config.appHost, url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  t.after(async () => {
    await closeServer(server);
    app.close();
  });
  return {
    app,
    config,
    server,
    headers,
    request,
    advance: (ms) => (now += ms),
    create: async (text, retention) => {
      const response = await request("/api/items/text", {
        method: "POST",
        body: JSON.stringify({ text, retention, submissionId: randomUUID() }),
      });
      assert.equal(response.status, 201, response.text);
      return response.json().item;
    },
    upload: async (name, bytes) => {
      const boundary = "release-" + randomUUID();
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const response = await request("/api/items/file", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=" + boundary,
          "X-File-Size": String(bytes.length),
          "X-Upload-Id": randomUUID(),
        },
        body,
      });
      assert.equal(response.status, 201, response.text);
      return response.json().item;
    },
  };
}

test("search combines literal text/filename, type, section, expiry and stable pagination without owner escalation", async (t) => {
  const f = await fixture(t);
  const oldest = await f.create("Alpha 100%_ literal");
  f.advance(1);
  await f.create("https://example.com/alpha", "keep");
  f.advance(1);
  const newest = await f.create("alpha second");
  const file = await f.upload(
    "Alpha report.pdf",
    Buffer.from("%PDF-1.4\nreport"),
  );
  const image = await f.upload(
    "photo.png",
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPFsAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  assert.equal(
    (await f.request("/api/items?section=all&q=ALPHA")).json().total,
    4,
  );
  assert.equal(
    (await f.request("/api/items?section=all&q=100%25_")).json().items[0].id,
    oldest.id,
  );
  assert.equal(
    (await f.request("/api/items?section=all&type=document&q=report")).json()
      .items[0].id,
    file.id,
  );
  assert.equal(
    (await f.request("/api/items?section=all&type=image")).json().items[0].id,
    image.id,
  );
  assert.equal(
    (await f.request("/api/items?section=all&type=file")).json().total,
    2,
  );
  assert.equal(
    (await f.request("/api/items?section=kept&type=link")).json().total,
    1,
  );
  assert.equal(
    (await f.request("/api/items?section=all&type=audio")).json().total,
    0,
  );
  const pages = await Promise.all(
    [1, 2].map((page) =>
      f.request(`/api/items?type=text&sort=oldest&limit=1&page=${page}`),
    ),
  );
  assert.deepEqual(
    pages.map((page) => page.json().items[0].id),
    [oldest.id, newest.id],
  );
  assert.equal(pages[0].json().totalPages, 2);
  assert.equal(
    (await f.request("/api/items?section=all&q=%27%20OR%201%3D1--")).json()
      .total,
    0,
  );
  const store = createItemStore(f.app.database, { maxTextBytes: 102400 });
  assert.equal(
    store.list("another-owner", { section: "all", q: "alpha" }).total,
    0,
  );
  assert.equal(
    (await f.request("/api/items?section=all&user_id=attacker")).json().total,
    5,
  );
  f.advance(86400001);
  assert.equal(
    (await f.request("/api/items?section=all&q=alpha")).json().total,
    1,
  );
});

test("invalid search parameters and unauthenticated queries are rejected", async (t) => {
  const f = await fixture(t);
  for (const query of [
    "q=x&q=y",
    "q=" + "x".repeat(201),
    "section=outside",
    "type=script",
    "sort=created_at%20DESC%3BDELETE",
    "page=0",
    "page=NaN",
    "limit=101",
  ])
    assert.equal((await f.request("/api/items?" + query)).status, 400, query);
  for (const route of [
    "/api/items?section=all&q=private",
    "/api/storage",
    "/api/preferences",
  ])
    assert.equal(
      (await f.request(route, { headers: { Cookie: "" } })).status,
      401,
    );
});

test("preferences are owner-scoped, strict, CSRF protected and broadcast without private values", async (t) => {
  const f = await fixture(t);
  const stream = await openEventStream(f.server, f.config.appHost, {
    Cookie: f.headers.Cookie,
  });
  t.after(() => stream.close());
  await stream.waitFor("sync.ready");
  assert.deepEqual((await f.request("/api/preferences")).json(), {
    defaultExpiration: "24h",
  });
  const patch = (body, headers = {}) =>
    f.request("/api/preferences", {
      method: "PATCH",
      body: JSON.stringify(body),
      headers,
    });
  for (const body of [
    null,
    [],
    {},
    { defaultExpiration: "forever" },
    { defaultExpiration: "1h", user_id: "attacker" },
    { defaultExpiration: "1h", storageQuota: 999 },
  ])
    assert.equal((await patch(body)).status, 400);
  assert.equal(
    (
      await patch(
        { defaultExpiration: "1h" },
        { Origin: "https://evil.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (await patch({ defaultExpiration: "1h" }, { "X-CavVoid-Request": "" }))
      .status,
    403,
  );
  assert.equal(
    (await patch({ defaultExpiration: "1h" }, { Cookie: "" })).status,
    401,
  );
  assert.equal(
    (await patch({ defaultExpiration: "1h" }, { "Content-Type": "text/plain" }))
      .status,
    415,
  );
  assert.equal(
    (await f.request("/api/preferences", { method: "PATCH", body: "{bad" }))
      .status,
    400,
  );
  assert.equal((await patch({ defaultExpiration: "keep" })).status, 200);
  assert.deepEqual((await stream.waitFor("preferences.updated")).data, {});
  assert.equal(
    readPreferences(f.app.database.connection, "other-owner").defaultExpiration,
    "24h",
  );
  assert.equal(
    (await f.request("/api/auth/me")).json().preferences.defaultExpiration,
    "keep",
  );
  const text = await f.create("default kept text");
  const file = await f.upload("default.txt", Buffer.from("default kept file"));
  assert.equal(text.isKept, true);
  assert.equal(file.isKept, true);
  await patch({ defaultExpiration: "10m" });
  assert.equal(
    (await f.request("/api/items/" + text.id)).json().item.isKept,
    true,
  );
  const next = await f.create("ten minute default");
  assert.equal(Date.parse(next.expiresAt) - Date.parse(next.createdAt), 600000);
  assert.equal(
    (await f.create("explicit overrides default", "7d")).isKept,
    false,
  );
  const usage = (await f.request("/api/storage")).json();
  assert.deepEqual(usage.counts, { total: 4, temporary: 2, kept: 2 });
  assert.equal(usage.usedBytes, file.file.size);
  assert.equal(usage.maxTextBytes, f.config.maxTextBytes);
  f.advance(600001);
  assert.deepEqual((await f.request("/api/storage")).json().counts, {
    total: 3,
    temporary: 1,
    kept: 2,
  });
});

test("version 3 migration preserves existing data and saved preferences survive reopening", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "cavvoid-preferences-test-"),
  );
  const filename = path.join(directory, "app.sqlite");
  let database;
  try {
    const old = new DatabaseSync(filename);
    for (const migration of ["001-owner", "002-items", "003-files"])
      old.exec(
        readFileSync(
          new URL(`../db/migrations/${migration}.sql`, import.meta.url),
          "utf8",
        ),
      );
    old
      .prepare("INSERT INTO users VALUES (?,?,?,?)")
      .run("owner", "Fixture", "2026-01-01", "2026-01-01");
    old
      .prepare(
        "INSERT INTO items (id,user_id,type,text_content,is_kept,created_at,updated_at,submission_id) VALUES (?,'owner','text','preserved',1,?,?,?)",
      )
      .run(randomUUID(), "2026-01-01", "2026-01-01", randomUUID());
    old.close();
    database = openDatabase(filename);
    assert.equal(
      database.connection.prepare("PRAGMA user_version").get().user_version,
      4,
    );
    assert.equal(
      database.connection.prepare("SELECT text_content FROM items").get()
        .text_content,
      "preserved",
    );
    savePreferences(
      database.connection,
      "owner",
      { defaultExpiration: "1h" },
      Date.now(),
    );
    database.close();
    database = openDatabase(filename);
    assert.equal(
      readPreferences(database.connection, "owner").defaultExpiration,
      "1h",
    );
    assert.equal(
      database.connection
        .prepare("SELECT count(*) AS n FROM user_preferences")
        .get().n,
      1,
    );
  } finally {
    database?.close();
    removeTestDirectory(directory, "cavvoid-preferences-test-");
  }
});

test("release headers keep scripts, workers, private APIs and files on the protected origin", async (t) => {
  const f = await fixture(t);
  for (const url of ["/api/items", "/api/storage", "/api/preferences"]) {
    const response = await f.request(url);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.match(
      response.headers["content-security-policy"],
      /worker-src 'self'/,
    );
    assert.doesNotMatch(
      response.headers["content-security-policy"],
      /unsafe-inline|unsafe-eval/,
    );
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  }
});
