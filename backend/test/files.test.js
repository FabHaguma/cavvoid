import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  mkdtempSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  readdirSync,
} from "node:fs";
import { request as nodeRequest } from "node:http";
import { Writable } from "node:stream";
import path from "node:path";
import os from "node:os";
import { createApp } from "../app.js";
import { loadConfig } from "../config.js";
import { FileStore } from "../files.js";
import { openDatabase } from "../db/database.js";
import {
  closeServer,
  httpRequest,
  listen,
  removeTestDirectory,
} from "./helpers.js";

export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPFsAAAAASUVORK5CYII=",
  "base64",
);
export function multipart(
  filename,
  bytes,
  type = "application/octet-stream",
  field = "file",
) {
  const boundary = "cavvoid-" + randomUUID();
  return {
    type: "multipart/form-data; boundary=" + boundary,
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}
async function fixture(t, env = {}, fsOps = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cavvoid-file-test-"));
  let now = Date.now();
  const config = {
    ...loadConfig({
      GATEKEEPER_PROXY_SECRET: "file-test-proxy-secret-".repeat(3),
      DATABASE_PATH: path.join(directory, "app.sqlite"),
      FILES_PATH: path.join(directory, "files"),
      ...env,
    }),
  };
  const instance = createApp({
    config,
    clock: () => now,
    fileOptions: { fsOps },
    fetchImpl: async (url, options) =>
      new Response(null, {
        status:
          options.headers.Cookie === "gatekeeper_session=file-test" ? 204 : 401,
      }),
  });
  const server = await listen(instance.app);
  config.appOrigin = "http://localhost:" + server.address().port;
  config.appHost = "localhost:" + server.address().port;
  const headers = {
    Cookie: "gatekeeper_session=file-test",
    Origin: config.appOrigin,
    "X-CavVoid-Request": "1",
  };
  const request = (url, options = {}) =>
    httpRequest(server, config.appHost, url, {
      ...options,
      headers: { ...headers, ...options.headers },
    });
  t.after(async () => {
    await closeServer(server);
    instance.close();
    removeTestDirectory(directory, "cavvoid-file-test-");
  });
  return {
    config,
    instance,
    directory,
    server,
    headers,
    request,
    advance: (ms) => {
      now += ms;
    },
    upload: (bytes, name = "test.bin", options = {}) => {
      const form = multipart(name, bytes, options.mime);
      return request("/api/items/file", {
        method: "POST",
        headers: {
          "Content-Type": form.type,
          "X-Upload-Id": options.id || randomUUID(),
          "X-File-Size": String(options.size ?? bytes.length),
          ...options.headers,
        },
        body: form.body,
      });
    },
  };
}
async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("The interrupted upload did not finish cleanup.");
}

test(
  "private image upload, metadata, download, range, expiry and deletion",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t);
    const response = await f.upload(png, "My photo.png", { mime: "text/html" });
    assert.equal(response.status, 201, response.text);
    const item = response.json().item;
    assert.equal(item.file.name, "My photo.png");
    assert.equal(item.file.mimeType, "image/png");
    assert.equal(item.file.previewKind, "image");
    assert.equal(item.file.size, png.length);
    assert.equal(item.type, "file");
    assert.equal(
      Date.parse(item.expiresAt) - Date.parse(item.createdAt),
      86400000,
    );
    const downloaded = await f.request(`/api/items/${item.id}/download`);
    assert.equal(downloaded.status, 200);
    assert.deepEqual(downloaded.buffer, png);
    assert.match(
      downloaded.headers["content-disposition"],
      /attachment.*My photo.png/,
    );
    assert.match(
      downloaded.headers["content-type"],
      /application\/octet-stream/,
    );
    const preview = await f.request(`/api/items/${item.id}/preview`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers["content-type"], "image/png");
    assert.equal(preview.headers["cache-control"], "no-store");
    const range = await f.request(`/api/items/${item.id}/preview`, {
      headers: { Range: "bytes=2-9" },
    });
    assert.equal(range.status, 206);
    assert.deepEqual(range.buffer, png.subarray(2, 10));
    assert.match(range.headers["content-range"], /^bytes 2-9\//);
    assert.equal(
      (
        await f.request(`/api/items/${item.id}/download`, {
          headers: { Range: "bytes=99999-" },
        })
      ).status,
      416,
    );
    assert.equal(
      (await f.request("/api/items")).json().items[0].file.name,
      "My photo.png",
    );
    assert.equal(
      (await f.request("/api/storage")).json().usedBytes,
      png.length,
    );
    for (const suffix of ["preview", "download"])
      assert.equal(
        (
          await f.request(`/api/items/${item.id}/${suffix}`, {
            headers: { Cookie: "", Range: "bytes=0-3" },
          })
        ).status,
        401,
      );
    f.advance(86400000);
    assert.equal(
      (await f.request(`/api/items/${item.id}/preview`)).status,
      410,
    );
    const active = (
      await f.upload(Buffer.from("document"), "document.txt")
    ).json().item;
    assert.equal(
      (await f.request("/api/items/" + active.id, { method: "DELETE" })).status,
      204,
    );
    assert.equal(
      (await f.request(`/api/items/${active.id}/download`)).status,
      404,
    );
    assert.equal(existsSync(f.instance.files.paths(active.id).final), false);
  },
);

test("audio ranges work; PDF, HTML, SVG and arbitrary files remain safe attachments", async (t) => {
  const f = await fixture(t);
  const audio = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(100)]);
  const mp3 = (await f.upload(audio, "Voice.mp3")).json().item;
  assert.equal(mp3.file.previewKind, "audio");
  const range = await f.request(`/api/items/${mp3.id}/preview`, {
    headers: { Range: "bytes=-10" },
  });
  assert.equal(range.status, 206);
  assert.equal(range.buffer.length, 10);
  assert.equal(range.headers["content-type"], "audio/mpeg");
  for (const [name, bytes] of [
    ["../evil.html", Buffer.from("<script>alert(1)</script>")],
    ["C:\\outside\\image.svg", Buffer.from('<svg onload="alert(1)"/>')],
    ["résumé.pdf", Buffer.from("%PDF-1.7\nTest")],
    ["data.zip", Buffer.from("PK\x03\x04test")],
  ]) {
    const uploaded = await f.upload(bytes, name, { mime: "image/png" });
    assert.equal(uploaded.status, 201, uploaded.text);
    const item = uploaded.json().item;
    assert.ok(!/[\\/]/.test(item.file.name));
    assert.equal(item.file.previewKind, null);
    const preview = await f.request(`/api/items/${item.id}/preview`);
    assert.equal(preview.status, 415);
    const download = await f.request(`/api/items/${item.id}/download`);
    assert.equal(download.headers["content-type"], "application/octet-stream");
    assert.match(download.headers["content-disposition"], /^attachment/);
    assert.match(download.headers["content-security-policy"], /sandbox/);
    assert.deepEqual(download.buffer, bytes);
  }
  assert.equal(
    (await f.request("/backend/data/files/objects/test.blob")).status,
    404,
  );
  assert.ok(
    readdirSync(f.instance.files.objects).every((name) =>
      /^[a-f0-9-]+\.blob$/.test(name),
    ),
  );
});

test("size, fields, malformed upload and auth validation leave no completed item or fragment", async (t) => {
  const f = await fixture(t, {
    MAX_FILE_BYTES: "8",
    STORAGE_QUOTA_BYTES: "16",
  });
  assert.equal((await f.upload(Buffer.alloc(9))).status, 413);
  assert.equal(
    (await f.upload(Buffer.alloc(8), "short.bin", { size: 4 })).status,
    413,
  );
  assert.equal(
    (await f.upload(Buffer.alloc(4), "short.bin", { size: 8 })).status,
    400,
  );
  const malformed = multipart("broken.bin", Buffer.from("1234"));
  assert.equal(
    (
      await f.request("/api/items/file", {
        method: "POST",
        headers: {
          "Content-Type": malformed.type,
          "X-Upload-Id": randomUUID(),
          "X-File-Size": "4",
        },
        body: malformed.body.subarray(
          0,
          malformed.body.indexOf(Buffer.from("\r\n--")),
        ),
      })
    ).status,
    400,
  );
  const wrongField = multipart("x", Buffer.from("12"), undefined, "unexpected");
  assert.equal(
    (
      await f.request("/api/items/file", {
        method: "POST",
        headers: {
          "Content-Type": wrongField.type,
          "X-Upload-Id": randomUUID(),
          "X-File-Size": "2",
        },
        body: wrongField.body,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.upload(Buffer.from("x"), "x", {
        headers: { Origin: "https://attacker.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.upload(Buffer.from("x"), "x", { headers: { Cookie: "" } })).status,
    401,
  );
  assert.equal(f.instance.files.usage().usedBytes, 0);
  assert.equal((await f.request("/api/items")).json().total, 0);
  assert.deepEqual(readdirSync(f.instance.files.temporary), []);
});

test(
  "concurrent uploads reserve quota before streaming; abort releases the reservation",
  { timeout: 15000 },
  async (t) => {
    const f = await fixture(t, {
      MAX_FILE_BYTES: "8",
      STORAGE_QUOTA_BYTES: "6",
    });
    const id = randomUUID(),
      boundary = "held-upload";
    const start = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="held.bin"\r\n\r\na`,
    );
    const pending = nodeRequest({
      hostname: "127.0.0.1",
      port: f.server.address().port,
      method: "POST",
      path: "/api/items/file",
      headers: {
        ...f.headers,
        Host: f.config.appHost,
        "Content-Type": "multipart/form-data; boundary=" + boundary,
        "X-File-Size": "4",
        "X-Upload-Id": id,
      },
    });
    pending.on("error", () => {});
    pending.write(start);
    await eventually(() => f.instance.files.usage().reservedBytes === 4);
    assert.equal((await f.upload(Buffer.alloc(4))).status, 507);
    assert.equal((await f.request("/api/items")).json().total, 0);
    pending.destroy();
    await eventually(
      () =>
        f.instance.files.usage().usedBytes === 0 &&
        f.instance.files.active.size === 0,
    );
    assert.deepEqual(readdirSync(f.instance.files.temporary), []);
    const complete = await f.upload(Buffer.alloc(4));
    assert.equal(complete.status, 201);
    assert.equal((await f.upload(Buffer.alloc(3))).status, 507);
  },
);

test("failed deletion revokes access immediately, keeps bytes charged, and retries durably", async (t) => {
  let blocked = false;
  const f = await fixture(
    t,
    {},
    {
      unlinkSync: (filename) => {
        if (blocked)
          throw Object.assign(new Error("locked"), { code: "EACCES" });
        return unlinkSync(filename);
      },
    },
  );
  const item = (await f.upload(png, "photo.png")).json().item;
  blocked = true;
  assert.equal(
    (await f.request("/api/items/" + item.id, { method: "DELETE" })).status,
    204,
  );
  assert.equal((await f.request(`/api/items/${item.id}/download`)).status, 404);
  assert.equal(f.instance.files.usage().pendingDeletionBytes, png.length);
  assert.ok(existsSync(f.instance.files.paths(item.id).final));
  blocked = false;
  f.advance(30001);
  f.instance.files.repair();
  assert.equal(f.instance.files.usage().usedBytes, 0);
  assert.equal(existsSync(f.instance.files.paths(item.id).final), false);
});

test("disk-full writes and finalization failures never publish completed uploads", async (t) => {
  await t.test("write fails", async (sub) => {
    const f = await fixture(
      sub,
      {},
      {
        createWriteStream: () =>
          new Writable({
            write(chunk, encoding, callback) {
              callback(Object.assign(new Error("full"), { code: "ENOSPC" }));
            },
          }),
      },
    );
    assert.equal((await f.upload(png)).status, 507);
    assert.equal(f.instance.files.usage().usedBytes, 0);
    assert.equal((await f.request("/api/items")).json().total, 0);
  });
  await t.test("rename fails", async (sub) => {
    const f = await fixture(
      sub,
      {},
      {
        renameSync: () => {
          throw Object.assign(new Error("full"), { code: "ENOSPC" });
        },
      },
    );
    assert.equal((await f.upload(png)).status, 507);
    assert.equal(f.instance.files.usage().usedBytes, 0);
    assert.deepEqual(readdirSync(f.instance.files.temporary), []);
  });
});

test("retrying a completed upload returns the same item without using more quota", async (t) => {
  const f = await fixture(t, { STORAGE_QUOTA_BYTES: String(png.length) });
  const id = randomUUID();
  const first = await f.upload(png, "photo.png", { id });
  assert.equal(first.status, 201);
  const second = await f.upload(png, "photo.png", { id });
  assert.equal(second.status, 200);
  assert.equal(first.json().item.id, second.json().item.id);
  assert.equal(f.instance.files.usage().usedBytes, png.length);
});

test("startup recovers stale staged files and accounts for orphaned generated files", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "cavvoid-file-recovery-"),
  );
  const db = openDatabase(path.join(directory, "db.sqlite"));
  const config = loadConfig({
    GATEKEEPER_PROXY_SECRET: "recovery-test-secret-".repeat(3),
    DATABASE_PATH: path.join(directory, "db.sqlite"),
    FILES_PATH: path.join(directory, "files"),
  });
  let now = Date.now(),
    store;
  try {
    store = new FileStore(db, config, { clock: () => now });
    const id = randomUUID();
    store.reserve("owner", id, 4);
    writeFileSync(store.paths(id).final, "data");
    store.close();
    store = new FileStore(db, config, { clock: () => now });
    assert.equal(store.usage().reservedBytes, 4);
    now += 180001;
    store.repair();
    assert.equal(store.usage().usedBytes, 0);
    assert.equal(existsSync(store.paths(id).final), false);
    store.close();
    const orphan = randomUUID();
    writeFileSync(store.paths(orphan).temporary, "orphan");
    store = new FileStore(db, config, { clock: () => now });
    assert.equal(existsSync(store.paths(orphan).temporary), false);
    assert.equal(store.usage().usedBytes, 0);
  } finally {
    store?.close();
    db.close();
    removeTestDirectory(directory, "cavvoid-file-recovery-");
  }
});

test("quota reservations remain atomic across separate database connections", async (t) => {
  const f = await fixture(t, { MAX_FILE_BYTES: "8", STORAGE_QUOTA_BYTES: "6" });
  const otherDb = openDatabase(f.config.databasePath);
  const other = new FileStore(otherDb, f.config);
  try {
    f.instance.files.reserve("owner", randomUUID(), 4);
    assert.throws(
      () => other.reserve("owner", randomUUID(), 4),
      (error) => error.status === 507,
    );
    assert.equal(other.usage().reservedBytes, 4);
  } finally {
    other.close();
    otherDb.close();
  }
});

test("multipart limits reject multiple files; empty and exact-limit files remain valid", async (t) => {
  const f = await fixture(t, { MAX_FILE_BYTES: "8", STORAGE_QUOTA_BYTES: "8" });
  const boundary = "two-files";
  const part = (name, contents) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n\r\n${contents}\r\n`;
  const body = Buffer.from(
    part("first.txt", "1") + part("second.txt", "2") + `--${boundary}--\r\n`,
  );
  const rejected = await f.request("/api/items/file", {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=" + boundary,
      "X-File-Size": "1",
      "X-Upload-Id": randomUUID(),
    },
    body,
  });
  assert.equal(rejected.status, 400);
  assert.equal(f.instance.files.usage().usedBytes, 0);
  const empty = await f.upload(Buffer.alloc(0), "empty.bin");
  assert.equal(empty.status, 201);
  const download = await f.request(
    `/api/items/${empty.json().item.id}/download`,
  );
  assert.equal(download.status, 200);
  assert.equal(download.buffer.length, 0);
  assert.equal((await f.upload(Buffer.alloc(8), "at-limit.bin")).status, 201);
  assert.equal((await f.upload(Buffer.alloc(9), "too-large.bin")).status, 413);
});
