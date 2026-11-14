import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { request as nodeRequest } from "node:http";
import path from "node:path";
import os from "node:os";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { openDatabase } from "../db/database.js";
import { FileStore } from "../files.js";
import { createItemStore } from "../items.js";
import { isAvailable, retentionOptions } from "../../shared/retention.js";
import {
  closeServer,
  httpRequest,
  listen,
  removeTestDirectory,
} from "./helpers.js";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPFsAAAAASUVORK5CYII=",
  "base64",
);
function form(bytes, boundary = "retention-test") {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}
async function fixture(t, { fsOps = {}, pause = true } = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cavvoid-retention-"));
  let now = Date.parse("2026-11-14T23:59:00.000Z");
  const config = {
    ...loadConfig({
      GATEKEEPER_PROXY_SECRET: "retention-test-secret-".repeat(3),
      DATABASE_PATH: path.join(directory, "app.sqlite"),
      FILES_PATH: path.join(directory, "files"),
    }),
  };
  const instance = createApp({
    config,
    clock: () => now,
    fileOptions: { fsOps },
    fetchImpl: async (url, options) =>
      new Response(null, {
        status:
          options.headers.Cookie === "gatekeeper_session=retention-test"
            ? 204
            : 401,
      }),
  });
  if (pause) clearInterval(instance.files.timer);
  const server = await listen(instance.app);
  config.appOrigin = "http://localhost:" + server.address().port;
  config.appHost = "localhost:" + server.address().port;
  const headers = {
    Cookie: "gatekeeper_session=retention-test",
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
    instance.close();
    removeTestDirectory(directory, "cavvoid-retention-");
  });
  return {
    instance,
    config,
    server,
    headers,
    request,
    directory,
    clock: () => now,
    advance: (ms) => {
      now += ms;
    },
    create: (retention, submissionId = randomUUID()) =>
      request("/api/items/text", {
        method: "POST",
        body: JSON.stringify({
          text: "Disposable retention test",
          submissionId,
          retention,
        }),
      }),
    upload: (retention, id = randomUUID()) =>
      request("/api/items/file", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data; boundary=retention-test",
          "X-Upload-Id": id,
          "X-File-Size": String(png.length),
          ...(retention === undefined ? {} : { "X-Retention": retention }),
        },
        body: form(png),
      }),
    patch: (id, retention, options = {}) =>
      request("/api/items/" + id, {
        method: "PATCH",
        body: JSON.stringify({ retention }),
        ...options,
      }),
  };
}

test("all composer retention options use server UTC for text and files, including midnight", async (t) => {
  const f = await fixture(t);
  for (const { value, milliseconds } of retentionOptions) {
    for (const response of [await f.create(value), await f.upload(value)]) {
      assert.equal(response.status, 201, response.text);
      const item = response.json().item;
      assert.equal(item.createdAt, new Date(f.clock()).toISOString());
      assert.equal(item.isKept, value === "keep");
      assert.equal(
        item.expiresAt,
        milliseconds === null
          ? null
          : new Date(f.clock() + milliseconds).toISOString(),
      );
    }
  }
  assert.equal((await f.request("/api/items?section=kept")).json().total, 2);
  assert.equal((await f.request("/api/items")).json().total, 8);
  assert.equal(
    (await f.create()).json().item.expiresAt,
    "2026-11-15T23:59:00.000Z",
  );
  assert.equal(
    (await f.upload()).json().item.expiresAt,
    "2026-11-15T23:59:00.000Z",
  );
});

test("Keep and unkeep update one original item/file, and durations restart when explicitly applied", async (t) => {
  const f = await fixture(t);
  const original = (await f.upload("10m")).json().item;
  const usage = f.instance.files.usage().usedBytes;
  f.advance(599999);
  const kept = (await f.patch(original.id, "keep")).json().item;
  assert.equal(kept.isKept, true);
  assert.equal(kept.expiresAt, null);
  f.advance(8 * 86400000);
  f.instance.files.repair();
  assert.equal(
    (await f.request(`/api/items/${original.id}/preview`)).status,
    200,
  );
  assert.equal((await f.request("/api/items")).json().total, 0);
  assert.equal(
    (await f.request("/api/items?section=kept")).json().items[0].id,
    original.id,
  );
  const unkept = (await f.patch(original.id, "24h")).json().item;
  assert.equal(unkept.isKept, false);
  assert.equal(unkept.createdAt, original.createdAt);
  assert.equal(unkept.updatedAt, new Date(f.clock()).toISOString());
  assert.equal(Date.parse(unkept.expiresAt) - f.clock(), 86400000);
  assert.equal(unkept.file.sha256, original.file.sha256);
  assert.equal(f.instance.files.usage().usedBytes, usage);
  assert.equal(readdirSync(f.instance.files.objects).length, 1);
  f.advance(1000);
  assert.equal(
    Date.parse((await f.patch(original.id, "1h")).json().item.expiresAt) -
      f.clock(),
    3600000,
  );
});

test("expiry denies every access and mutation at the exact boundary while cleanup is paused", async (t) => {
  const f = await fixture(t);
  const text = (await f.create("10m")).json().item;
  const file = (await f.upload("10m")).json().item;
  f.advance(599999);
  assert.equal((await f.request("/api/items/" + text.id)).status, 200);
  assert.equal((await f.request(`/api/items/${file.id}/download`)).status, 200);
  assert.equal(isAvailable(text, f.clock()), true);
  f.advance(1);
  assert.equal(isAvailable(text, f.clock()), false);
  for (const item of [text, file]) {
    assert.equal((await f.request("/api/items/" + item.id)).status, 410);
    assert.equal((await f.patch(item.id, "keep")).status, 410);
    assert.equal((await f.patch(item.id, "7d")).status, 410);
    assert.equal(
      (await f.request("/api/items/" + item.id, { method: "DELETE" })).status,
      410,
    );
  }
  for (const suffix of ["download", "preview"])
    assert.equal(
      (
        await f.request(`/api/items/${file.id}/${suffix}`, {
          headers: { Range: "bytes=0-3" },
        })
      ).status,
      410,
    );
  assert.equal((await f.request("/api/items")).json().total, 0);
  assert.equal(
    f.instance.database.connection
      .prepare("SELECT count(*) AS n FROM items")
      .get().n,
    2,
  );
  assert.equal(existsSync(f.instance.files.paths(file.id).final), true);
  f.instance.files.repair();
  f.instance.files.repair();
  assert.equal((await f.request("/api/items/" + text.id)).status, 404);
  assert.equal(
    f.instance.database.connection
      .prepare("SELECT count(*) AS n FROM items")
      .get().n,
    0,
  );
  assert.equal(f.instance.files.usage().usedBytes, 0);
  assert.equal(existsSync(f.instance.files.paths(file.id).final), false);
});

test("retention validation, owner isolation, authentication and CSRF apply to PATCH", async (t) => {
  const f = await fixture(t);
  const item = (await f.create("24h")).json().item;
  for (const retention of [null, 600000, "forever", "", {}, ["keep"]]) {
    assert.equal((await f.create(retention)).status, 400);
    assert.equal((await f.patch(item.id, retention)).status, 400);
  }
  assert.equal((await f.upload("invalid")).status, 400);
  for (const body of [
    {},
    [],
    { retention: "keep", user_id: "someone" },
    { expiresAt: "2099-01-01" },
    { isKept: true },
  ])
    assert.equal(
      (
        await f.request("/api/items/" + item.id, {
          method: "PATCH",
          body: JSON.stringify(body),
        })
      ).status,
      400,
    );
  for (const [headers, status] of [
    [{ Cookie: "" }, 401],
    [{ Origin: "https://attacker.example" }, 403],
    [{ "X-CavVoid-Request": "" }, 403],
    [{ "Content-Type": "text/plain" }, 415],
  ])
    assert.equal((await f.patch(item.id, "keep", { headers })).status, status);
  const store = createItemStore(f.instance.database, {
    maxTextBytes: 102400,
    clock: f.clock,
  });
  assert.throws(
    () => store.update("another-owner", item.id, { retention: "keep" }),
    (error) => error.status === 404,
  );
  assert.equal((await f.patch("invalid-id", "keep")).status, 404);
  assert.equal(
    (await f.request("/api/items/" + item.id)).json().item.isKept,
    false,
  );
});

test("expired file deletion failures remain charged and recover durably after reopening storage", async (t) => {
  let blocked = true;
  const fsOps = {
    unlinkSync(filename) {
      if (blocked) throw Object.assign(new Error("locked"), { code: "EACCES" });
      return unlinkSync(filename);
    },
  };
  const f = await fixture(t, { fsOps });
  const file = (await f.upload("10m")).json().item;
  const kept = (await f.upload("keep")).json().item;
  f.config.storageQuotaBytes = png.length * 2;
  f.advance(600000);
  f.instance.files.repair();
  const db = f.instance.database.connection;
  assert.equal(db.prepare("SELECT count(*) AS n FROM item_files").get().n, 1);
  let ledger = db.prepare("SELECT * FROM file_objects WHERE id=?").get(file.id);
  assert.equal(ledger.state, "deleting");
  assert.equal(ledger.last_error, "EACCES");
  assert.equal(f.instance.files.usage().pendingDeletionBytes, png.length);
  assert.equal((await f.upload("24h")).status, 507);
  f.instance.files.repair();
  assert.equal(
    db
      .prepare("SELECT delete_attempts FROM file_objects WHERE id=?")
      .get(file.id).delete_attempts,
    1,
  );
  // A new connection simulates reopening after the transaction committed but
  // before physical unlink succeeded. The durable ledger is the source of truth.
  const reopened = openDatabase(f.config.databasePath);
  const other = new FileStore(reopened, f.config, { clock: f.clock, fsOps });
  try {
    assert.equal(other.usage().pendingDeletionBytes, png.length);
    blocked = false;
    f.advance(30000);
    other.repair();
    other.repair();
    assert.equal(other.usage().usedBytes, png.length);
    assert.equal(existsSync(other.paths(file.id).final), false);
    assert.equal(existsSync(other.paths(kept.id).final), true);
    assert.equal(
      (await f.request(`/api/items/${kept.id}/download`)).status,
      200,
    );
    assert.equal((await f.upload("24h")).status, 201);
  } finally {
    other.close();
    reopened.close();
  }
});

test("startup and scheduled cleanup remove expired records while preserving kept content", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const f = await fixture(t, { pause: false });
  const text = (await f.create("10m")).json().item;
  const file = (await f.upload("10m")).json().item;
  const kept = (await f.upload("keep")).json().item;
  f.advance(600000);
  t.mock.timers.tick(30000);
  assert.equal((await f.request("/api/items/" + text.id)).status, 404);
  assert.equal(existsSync(f.instance.files.paths(file.id).final), false);
  assert.equal((await f.request("/api/items/" + kept.id)).status, 200);
  const startup = (await f.upload("10m")).json().item;
  f.advance(600000);
  const reopened = openDatabase(f.config.databasePath);
  const other = new FileStore(reopened, f.config, { clock: f.clock });
  try {
    assert.equal(existsSync(other.paths(startup.id).final), false);
    assert.equal(
      reopened.connection.prepare("SELECT count(*) AS n FROM items").get().n,
      1,
    );
  } finally {
    other.close();
    reopened.close();
  }
});

test("retention changes and cleanup across connections never delete a Keep or revive expired content", async (t) => {
  const f = await fixture(t);
  const kept = (await f.upload("10m")).json().item;
  const expires = (await f.upload("10m")).json().item;
  const reopened = openDatabase(f.config.databasePath);
  const other = new FileStore(reopened, f.config, { clock: f.clock });
  const store = createItemStore(reopened, {
    maxTextBytes: 102400,
    clock: f.clock,
  });
  try {
    f.advance(599999);
    assert.equal((await f.patch(kept.id, "keep")).status, 200);
    f.advance(1);
    assert.throws(
      () => store.update("owner", expires.id, { retention: "keep" }),
      (error) => error.status === 410,
    );
    other.repair();
    assert.equal((await f.patch(expires.id, "keep")).status, 404);
    assert.equal(
      (await f.request(`/api/items/${kept.id}/preview`)).status,
      200,
    );
    assert.equal(f.instance.files.usage().usedBytes, png.length);
  } finally {
    other.close();
    reopened.close();
  }
});

test("cleanup during an active upload does not publish early or shorten its lifetime", async (t) => {
  const f = await fixture(t);
  const expired = (await f.create("10m")).json().item;
  f.advance(599999);
  const id = randomUUID(),
    boundary = "held-retention-upload";
  let response;
  const complete = new Promise((resolve, reject) => {
    response = nodeRequest(
      {
        hostname: "127.0.0.1",
        port: f.server.address().port,
        method: "POST",
        path: "/api/items/file",
        headers: {
          ...f.headers,
          Host: f.config.appHost,
          "Content-Type": "multipart/form-data; boundary=" + boundary,
          "X-File-Size": String(png.length),
          "X-Upload-Id": id,
          "X-Retention": "10m",
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode, json: JSON.parse(text) }),
        );
      },
    );
    response.on("error", reject);
  });
  response.write(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\n\r\n`,
    ),
  );
  response.write(png.subarray(0, 10));
  for (let i = 0; i < 100 && !f.instance.files.active.has(id); i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.instance.files.active.has(id), true);
  f.advance(1);
  f.instance.files.repair();
  assert.equal((await f.patch(expired.id, "keep")).status, 404);
  assert.equal((await f.request("/api/items/" + id)).status, 404);
  response.end(
    Buffer.concat([png.subarray(10), Buffer.from(`\r\n--${boundary}--\r\n`)]),
  );
  const result = await complete;
  assert.equal(result.status, 201);
  assert.equal(Date.parse(result.json.item.expiresAt) - f.clock(), 600000);
  assert.equal((await f.request(`/api/items/${id}/preview`)).status, 200);
});

test("retries return the original item without changing its edited retention", async (t) => {
  const f = await fixture(t);
  const textId = randomUUID(),
    fileId = randomUUID();
  const text = (await f.create("10m", textId)).json().item;
  const file = (await f.upload("10m", fileId)).json().item;
  await f.patch(text.id, "keep");
  await f.patch(file.id, "keep");
  f.advance(1000);
  for (const response of [
    await f.create("10m", textId),
    await f.upload("10m", fileId),
  ]) {
    assert.equal(response.status, 200);
    assert.equal(response.json().item.isKept, true);
    assert.equal(response.json().item.expiresAt, null);
  }
});
