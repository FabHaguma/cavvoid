import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/database.js";
import { createItemStore } from "../items.js";
import {
  closeServer,
  httpRequest,
  listen,
  removeTestDirectory,
} from "./helpers.js";

async function fixture(t, options = {}) {
  let now = Date.parse("2026-11-14T08:00:00.000Z");
  const config = loadConfig({
    GATEKEEPER_PROXY_SECRET: "disposable-test-secret-".repeat(3),
    DATABASE_PATH: ":memory:",
    ...options,
  });
  const app = createApp({
    config,
    clock: () => now,
    fetchImpl: async (url, request) =>
      new Response(null, {
        status:
          request.headers.Cookie === "gatekeeper_session=test-session"
            ? 204
            : 401,
      }),
  });
  const server = await listen(app.app);
  t.after(async () => {
    await closeServer(server);
    app.close();
  });
  const headers = {
    Cookie: "gatekeeper_session=test-session",
    Origin: config.appOrigin,
    "X-CavVoid-Request": "1",
    "Content-Type": "application/json",
  };
  const request = (pathname, options = {}) =>
    httpRequest(server, config.appHost, pathname, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  return {
    config,
    db: app.database.connection,
    request,
    advance: (ms) => {
      now += ms;
    },
    store: createItemStore(app.database, {
      maxTextBytes: config.maxTextBytes,
      clock: () => now,
    }),
    create: (text, submissionId = randomUUID()) =>
      request("/api/items/text", {
        method: "POST",
        body: JSON.stringify({ text, submissionId }),
      }),
  };
}

test("text and link CRUD preserve exact whitespace, assign ownership, and expire after 24 hours", async (t) => {
  const f = await fixture(t);
  const text = "  First line\r\n\n\tSecond line  🕳️  ";
  const response = await f.create(text);
  assert.equal(response.status, 201);
  const item = response.json().item;
  assert.equal(item.text, text);
  assert.equal(item.type, "text");
  assert.equal(
    Date.parse(item.expiresAt) - Date.parse(item.createdAt),
    86400000,
  );
  assert.equal(
    f.db.prepare("SELECT user_id FROM items").get().user_id,
    "owner",
  );
  assert.equal(
    (await f.request("/api/items/" + item.id)).json().item.text,
    text,
  );
  const link = (
    await f.create("  https://example.com/hello?q=cavvoid  ")
  ).json().item;
  assert.equal(link.type, "link");
  assert.equal(link.url, "https://example.com/hello?q=cavvoid");
  assert.equal(link.text, "  https://example.com/hello?q=cavvoid  ");
  assert.equal((await f.request("/api/items")).json().total, 2);
  assert.throws(
    () => f.store.get("another-owner", item.id),
    (error) => error.status === 404,
  );
  assert.equal(f.store.list("another-owner", {}).total, 0);
  const forged = await f.request("/api/items/text", {
    method: "POST",
    body: JSON.stringify({
      text: "private",
      submissionId: randomUUID(),
      user_id: "attacker",
    }),
  });
  assert.equal(forged.status, 400);
});

test("validation enforces UTF-8 bytes and rejects invalid payloads, JSON, and mutation origins", async (t) => {
  const f = await fixture(t, { MAX_TEXT_BYTES: "8" });
  assert.equal((await f.create("🕳🕳")).status, 201);
  assert.equal((await f.create("🕳🕳x")).status, 413);
  for (const body of [
    {},
    [],
    { text: " " },
    { text: 7, submissionId: randomUUID() },
    { text: "x", submissionId: "not-a-uuid" },
    { text: "x", submissionId: randomUUID(), is_kept: true },
  ]) {
    assert.equal(
      (
        await f.request("/api/items/text", {
          method: "POST",
          body: JSON.stringify(body),
        })
      ).status,
      400,
    );
  }
  assert.equal(
    (await f.request("/api/items/text", { method: "POST", body: "{broken" }))
      .status,
    400,
  );
  assert.equal(
    (
      await f.request("/api/items/text", {
        method: "POST",
        body: "x",
        headers: { "Content-Type": "text/plain" },
      })
    ).status,
    415,
  );
  assert.equal(
    (
      await f.request("/api/items/text", {
        method: "POST",
        body: "x".repeat(9000),
      })
    ).status,
    413,
  );
  const body = JSON.stringify({ text: "x", submissionId: randomUUID() });
  assert.equal(
    (
      await f.request("/api/items/text", {
        method: "POST",
        body,
        headers: { Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/items/text", {
        method: "POST",
        body,
        headers: { "X-CavVoid-Request": "" },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await f.request("/api/items/text", {
        method: "POST",
        body,
        headers: { Cookie: "" },
      })
    ).status,
    401,
  );
});

test("default 100 KB boundary counts decoded text rather than JSON transport bytes", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.create("x".repeat(102400))).status, 201);
  assert.equal((await f.create("x".repeat(102401))).status, 413);
  const encoded =
    '{"text":"' +
    "\\u0061".repeat(102400) +
    '","submissionId":"' +
    randomUUID() +
    '"}';
  assert.equal(
    (await f.request("/api/items/text", { method: "POST", body: encoded }))
      .status,
    201,
  );
});

test("simultaneous/retried submissions create one item without extending its expiry", async (t) => {
  const f = await fixture(t);
  const id = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 10 }, () => f.create("Only one drop", id)),
  );
  assert.equal(
    responses.filter((response) => response.status === 201).length,
    1,
  );
  assert.equal(
    new Set(responses.map((response) => response.json().item.id)).size,
    1,
  );
  const expires = responses[0].json().item.expiresAt;
  f.advance(3600000);
  const retry = await f.create("Only one drop", id);
  assert.equal(retry.status, 200);
  assert.equal(retry.json().item.expiresAt, expires);
  assert.equal((await f.create("Changed content", id)).status, 409);
  assert.equal((await f.request("/api/items")).json().total, 1);
  f.advance(86400000);
  assert.equal((await f.create("Only one drop", id)).status, 410);
});

test("pagination returns stable newest-first pages of 30 without repeats", async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 65; i++) {
    f.store.create("owner", { text: "Drop " + i, submissionId: randomUUID() });
    f.advance(1000);
  }
  const pages = [];
  for (let page = 1; page <= 3; page++)
    pages.push((await f.request("/api/items?page=" + page)).json());
  assert.deepEqual(
    pages.map((page) => page.items.length),
    [30, 30, 5],
  );
  assert.equal(pages[0].items[0].text, "Drop 64");
  assert.equal(
    new Set(pages.flatMap((page) => page.items.map((item) => item.id))).size,
    65,
  );
  assert.equal(pages[0].total, 65);
  assert.equal(pages[0].totalPages, 3);
  for (const query of [
    "page=0",
    "page=no",
    "limit=0",
    "limit=101",
    "section=someone-else",
  ])
    assert.equal((await f.request("/api/items?" + query)).status, 400);
  assert.equal(
    (await f.request("/api/items?section=kept")).json().items.length,
    0,
  );
});

test("expired and deleted text cannot be retrieved, listed, or mutated", async (t) => {
  const f = await fixture(t);
  const item = (await f.create("Time-limited private text")).json().item;
  f.advance(86400000);
  const expired = await f.request("/api/items/" + item.id);
  assert.equal(expired.status, 410);
  assert.ok(!expired.text.includes("Time-limited private text"));
  assert.equal((await f.request("/api/items")).json().total, 0);
  assert.equal(
    (await f.request("/api/items/" + item.id, { method: "DELETE" })).status,
    410,
  );
  const active = (await f.create("Delete this private text")).json().item;
  assert.equal(
    (await f.request("/api/items/" + active.id, { method: "DELETE" })).status,
    204,
  );
  assert.equal((await f.request("/api/items/" + active.id)).status, 404);
  assert.equal(
    (await f.request("/api/items/" + active.id, { method: "DELETE" })).status,
    404,
  );
  assert.equal(
    f.db
      .prepare("SELECT count(*) AS count FROM items WHERE id = ?")
      .get(active.id).count,
    0,
  );
  assert.equal(
    (await f.request("/api/items", { headers: { Cookie: "" } })).status,
    401,
  );
});

test("unsafe markup/schemes stay inert text and private responses remain uncacheable", async (t) => {
  const f = await fixture(t);
  for (const text of [
    '<script>alert("test")</script>',
    "<img src=x onerror=alert(1)>",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
  ]) {
    const result = await f.create(text);
    assert.equal(result.status, 201);
    assert.equal(result.json().item.type, "text");
    assert.equal(result.json().item.url, null);
    const get = await f.request("/api/items/" + result.json().item.id);
    assert.equal(get.json().item.text, text);
    assert.match(get.headers["content-type"], /application\/json/);
    assert.equal(get.headers["cache-control"], "no-store");
    assert.equal(get.headers["x-content-type-options"], "nosniff");
  }
});

test("migration upgrades the milestone 1 database and item text survives reopening", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "cavvoid-items-migration-"),
  );
  const filename = path.join(directory, "app.sqlite");
  let db;
  try {
    const old = new DatabaseSync(filename);
    old.exec(
      readFileSync(
        new URL("../db/migrations/001-owner.sql", import.meta.url),
        "utf8",
      ),
    );
    old
      .prepare("INSERT INTO users VALUES (?, ?, ?, ?)")
      .run(
        "owner",
        "Fabrice",
        "2026-11-13T00:00:00.000Z",
        "2026-11-13T00:00:00.000Z",
      );
    old.close();
    db = openDatabase(filename, "Fabrice");
    assert.equal(
      db.connection.prepare("PRAGMA user_version").get().user_version,
      4,
    );
    assert.equal(
      db.connection.prepare("SELECT created_at FROM users").get().created_at,
      "2026-11-13T00:00:00.000Z",
    );
    let store = createItemStore(db, { maxTextBytes: 102400 });
    const item = store.create("owner", {
      text: "Persist\n  spacing",
      submissionId: randomUUID(),
    }).item;
    db.close();
    db = openDatabase(filename, "Fabrice");
    store = createItemStore(db, { maxTextBytes: 102400 });
    assert.equal(store.get("owner", item.id).text, "Persist\n  spacing");
  } finally {
    db?.close();
    removeTestDirectory(directory, "cavvoid-items-migration-");
  }
});
