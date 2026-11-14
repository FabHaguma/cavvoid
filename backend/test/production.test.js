import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { parseEnv } from "node:util";
import { loadConfig } from "../config.js";
import { createApp } from "../app.js";
import { openDatabase } from "../db/database.js";
import {
  httpRequest,
  listen,
  closeServer,
  removeTestDirectory,
} from "./helpers.js";
import { prepareProduction } from "../../scripts/prepare-production.js";
import { verifyData } from "../../scripts/verify-data.js";

const environment = {
  NODE_ENV: "production",
  AUTH_MODE: "trusted-ingress",
  APP_ORIGIN: "https://cavvoid.haguma.com",
  GATEKEEPER_URL: "https://login.haguma.com",
  CAVVOID_INGRESS_SECRET: "ab".repeat(32),
  DATABASE_PATH: path.join(
    os.tmpdir(),
    "cavvoid-unused-production-fixture",
    "content.sqlite",
  ),
  FILES_PATH: path.join(
    os.tmpdir(),
    "cavvoid-unused-production-fixture",
    "files",
  ),
};

test("production startup requires explicit HTTPS, persistent paths and separate ingress proof", () => {
  const config = loadConfig(environment);
  assert.equal(config.production, true);
  assert.equal(config.authMode, "trusted-ingress");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 3001);
  assert.equal(config.proxySecret, "");
  assert.equal(config.localGatekeeperRepo, null);
  for (const override of [
    { AUTH_MODE: "local-gateway" },
    { AUTH_MODE: "" },
    { CAVVOID_INGRESS_SECRET: "" },
    { CAVVOID_INGRESS_SECRET: "x".repeat(64) },
    { CAVVOID_INGRESS_SECRET: "ab".repeat(32) + "\n" },
    { CAVVOID_INGRESS_SECRET: '"; injection' },
    { GATEKEEPER_PROXY_SECRET: "private-gateway-secret-".repeat(3) },
    { LOCAL_GATEKEEPER_REPO: "./gateway" },
    { APP_ORIGIN: "http://cavvoid.haguma.com" },
    { APP_ORIGIN: "https://cavvoid.haguma.com/path" },
    { GATEKEEPER_URL: "https://login.haguma.com\n" },
    { GATEKEEPER_URL: "http://login.haguma.com" },
    { APP_ORIGIN: "https://localhost:3001" },
    { GATEKEEPER_URL: environment.APP_ORIGIN },
    { DATABASE_PATH: ":memory:" },
    { DATABASE_PATH: "./data/content.sqlite" },
    { FILES_PATH: "" },
    { PORT: "0" },
    { PORT: "70000" },
  ])
    assert.throws(
      () => loadConfig({ ...environment, ...override }),
      JSON.stringify(override),
    );
  assert.throws(
    () =>
      loadConfig({
        AUTH_MODE: "trusted-ingress",
        GATEKEEPER_PROXY_SECRET: "test-secret-".repeat(4),
      }),
    /Local development/,
  );
});

test("production runtime preparation preserves existing proof/limits and rejects unsafe updates before writing", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "cavvoid-production-env-"),
  );
  const filename = path.join(directory, "production.env");
  try {
    const options = {
      filename,
      gatewayOrigin: "https://login.haguma.com",
      release: "a".repeat(40),
    };
    assert.equal(prepareProduction(options).created, true);
    const first = parseEnv(readFileSync(filename, "utf8"));
    assert.match(first.CAVVOID_INGRESS_SECRET, /^[a-f0-9]{64}$/);
    assert.equal(first.PROXY_AUTH_SECRET, undefined);
    first.MAX_FILE_BYTES = "12345";
    writeFileSync(
      filename,
      Object.entries(first)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    assert.equal(
      prepareProduction({ ...options, release: "b".repeat(40) }).created,
      false,
    );
    const next = parseEnv(readFileSync(filename, "utf8"));
    assert.equal(next.CAVVOID_INGRESS_SECRET, first.CAVVOID_INGRESS_SECRET);
    assert.equal(next.MAX_FILE_BYTES, "12345");
    assert.equal(next.CAVVOID_RELEASE, "b".repeat(40));
    const before = readFileSync(filename, "utf8");
    for (const invalid of [
      { release: "replace-me" },
      { release: "bad tag" },
      { gatewayOrigin: "https://different.example" },
    ]) {
      assert.throws(() => prepareProduction({ ...options, ...invalid }));
      assert.equal(readFileSync(filename, "utf8"), before);
    }
    writeFileSync(
      filename,
      before + "\nPROXY_AUTH_SECRET=do-not-copy-gateway-credentials\n",
    );
    assert.throws(() => prepareProduction(options), /Unexpected runtime/);
  } finally {
    removeTestDirectory(directory, "cavvoid-production-env-");
  }
});

test("offline restore verification checks database/ledger/file bytes without migrating or exposing content", async () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "cavvoid-production-restore-"),
  );
  const databasePath = path.join(directory, "content.sqlite");
  const filesDirectory = path.join(directory, "files");
  const objects = path.join(filesDirectory, "objects");
  mkdirSync(objects, { recursive: true });
  let database;
  try {
    database = openDatabase(databasePath);
    const db = database.connection,
      id = randomUUID(),
      now = new Date().toISOString();
    const bytes = Buffer.from("Disposable restore fixture bytes");
    const hash = createHash("sha256").update(bytes).digest("hex");
    db.prepare(
      "INSERT INTO items (id,user_id,type,is_kept,created_at,updated_at,submission_id) VALUES (?,'owner','file',1,?,?,?)",
    ).run(id, now, now, randomUUID());
    db.prepare("INSERT INTO item_files VALUES (?,?,?,?,?,?,?,?)").run(
      id,
      id,
      id + ".blob",
      "Private fixture filename.txt",
      "application/octet-stream",
      bytes.length,
      hash,
      now,
    );
    db.prepare(
      "INSERT INTO file_objects (id,user_id,storage_name,charged_bytes,state,created_at) VALUES (?,'owner',?,?,'ready',?)",
    ).run(id, id + ".blob", bytes.length, now);
    writeFileSync(path.join(objects, id + ".blob"), bytes);
    database.close();
    database = null;
    const before = readFileSync(databasePath);
    const report = await verifyData(databasePath, filesDirectory);
    assert.deepEqual(report, {
      database: "ok",
      schemaVersion: 4,
      fileItems: 1,
      verifiedFileBytes: bytes.length,
      unfinishedUploads: 0,
      pendingDeletionObjects: 0,
    });
    assert.deepEqual(readFileSync(databasePath), before);
    assert.doesNotMatch(JSON.stringify(report), /filename|Disposable|\.blob/);
    const corrupted = Buffer.from(bytes);
    corrupted[0] = 0;
    writeFileSync(path.join(objects, id + ".blob"), corrupted);
    await assert.rejects(
      verifyData(databasePath, filesDirectory),
      /hash check failed/,
    );
    writeFileSync(path.join(objects, id + ".blob"), bytes.subarray(1));
    await assert.rejects(
      verifyData(databasePath, filesDirectory),
      /size check failed/,
    );
    const missing = path.join(directory, "missing.sqlite");
    await assert.rejects(verifyData(missing, filesDirectory));
    assert.equal(existsSync(missing), false);
  } finally {
    database?.close();
    removeTestDirectory(directory, "cavvoid-production-restore-");
  }
});

test("production APIs reject direct/forged admission, keep CSRF and never consume gateway credentials", async (t) => {
  const config = { ...loadConfig(environment), filesDirectory: null };
  const database = openDatabase(":memory:", "Production fixture");
  const instance = createApp({
    config,
    database,
    fileOptions: {},
    fetchImpl: () => {
      throw new Error(
        "Production must not contact Gatekeeper or receive its secret",
      );
    },
  });
  const server = await listen(instance.app);
  t.after(async () => {
    await closeServer(server);
    instance.close();
  });
  const request = (url, options = {}) =>
    httpRequest(server, config.appHost, url, options);
  assert.equal((await request("/health")).status, 200);
  for (const headers of [
    {},
    {
      "X-Forwarded-Proto": "https",
      "X-Forwarded-Host": config.appHost,
      "X-User-Id": "owner",
    },
    { Cookie: "gatekeeper_session=fake-session" },
    { "X-Gatekeeper-Proxy-Key": "ab".repeat(32) },
    { "X-CavVoid-Ingress": "cd".repeat(32) },
    { "X-CavVoid-Ingress": environment.CAVVOID_INGRESS_SECRET + ",fake" },
  ])
    for (const url of [
      "/api/auth/me",
      "/api/items",
      "/api/events",
      "/api/storage",
      "/api/preferences",
      "/settings",
      "/sw.js",
    ])
      assert.equal((await request(url, { headers })).status, 403, url);
  const headers = { "X-CavVoid-Ingress": environment.CAVVOID_INGRESS_SECRET };
  const access = await request("/api/auth/me", { headers });
  assert.equal(access.status, 200);
  assert.equal(access.json().owner.id, "owner");
  assert.doesNotMatch(access.text, /abababab|Proxy-Key|gatekeeper_session/);
  assert.equal(
    (
      await request("/api/items", {
        headers: { ...headers, Host: "attacker.example" },
      })
    ).status,
    421,
  );
  const body = JSON.stringify({
    text: "Production boundary fixture",
    submissionId: randomUUID(),
  });
  const mutation = {
    ...headers,
    Origin: config.appOrigin,
    "X-CavVoid-Request": "1",
    "Content-Type": "application/json",
  };
  assert.equal(
    (
      await request("/api/items/text", {
        method: "POST",
        headers: { ...mutation, Origin: "https://evil.example" },
        body,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/items/text", {
        method: "POST",
        headers: { ...mutation, "X-CavVoid-Request": "" },
        body,
      })
    ).status,
    403,
  );
  const created = await request("/api/items/text", {
    method: "POST",
    headers: mutation,
    body,
  });
  assert.equal(created.status, 201);
  assert.equal(
    (await request("/api/items/" + created.json().item.id, { headers })).status,
    200,
  );
  // In production only Nginx serves the UI; backend admission cannot expose files.
  assert.equal((await request("/settings", { headers })).status, 404);
  assert.equal((await request("/sw.js", { headers })).status, 404);
});
