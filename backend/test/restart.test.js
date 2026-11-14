import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { projectRoot } from "../config.js";
import { removeTestDirectory } from "./helpers.js";

test(
  "text/files survive a native restart and startup cleanup preserves Keep",
  { timeout: 60000 },
  async () => {
    const directory = mkdtempSync(
      path.join(os.tmpdir(), "cavvoid-process-restart-"),
    );
    const secret = "isolated-process-test-secret-".repeat(3);
    const cookie = "gatekeeper_session=process-test";
    const gateway = createServer((req, res) => {
      res
        .writeHead(
          req.headers["x-gatekeeper-proxy-key"] === secret &&
            req.headers.cookie === cookie
            ? 204
            : 401,
        )
        .end();
    });
    await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const reservation = createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const origin = "http://localhost:" + port;
    let child;
    async function start() {
      child = spawn(process.execPath, ["backend/server.js"], {
        cwd: projectRoot,
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: "test",
          APP_ORIGIN: origin,
          GATEKEEPER_URL: "http://localhost:" + gateway.address().port,
          GATEKEEPER_PROXY_SECRET: secret,
          DATABASE_PATH: path.join(directory, "cavvoid.sqlite"),
          OWNER_DISPLAY_NAME: "Restart test",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("The native test backend did not start.")),
          20000,
        );
        child.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error("Test backend exited: " + code));
        });
        child.stdout.on("data", (bytes) => {
          if (bytes.toString().includes("CavVoid:")) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }
    async function stop() {
      if (child && child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        await exited;
      }
      child = null;
    }
    try {
      await start();
      const text = "A note before restart\n\n  and its whitespace.";
      const response = await fetch(origin + "/api/items/text", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "X-CavVoid-Request": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text, submissionId: randomUUID() }),
      });
      assert.equal(response.status, 201);
      const item = (await response.json()).item;
      const fileBytes = Buffer.from("A private file before restart.");
      const uploadBody = new FormData();
      uploadBody.append("file", new Blob([fileBytes]), "survives-restart.txt");
      const uploaded = await fetch(origin + "/api/items/file", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "X-CavVoid-Request": "1",
          "X-File-Size": String(fileBytes.length),
          "X-Upload-Id": randomUUID(),
        },
        body: uploadBody,
      });
      assert.equal(uploaded.status, 201);
      const file = (await uploaded.json()).item;
      const preferred = await fetch(origin + "/api/preferences", {
        method: "PATCH",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "X-CavVoid-Request": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ defaultExpiration: "1h" }),
      });
      assert.equal(preferred.status, 200);
      await stop();
      await start();
      assert.equal(
        (
          await (
            await fetch(origin + "/api/preferences", {
              headers: { Cookie: cookie },
            })
          ).json()
        ).defaultExpiration,
        "1h",
      );
      const retrieved = await fetch(origin + "/api/items/" + item.id, {
        headers: { Cookie: cookie, Accept: "application/json" },
      });
      assert.equal(retrieved.status, 200);
      assert.equal((await retrieved.json()).item.text, text);
      const fileDownload = await fetch(
        origin + "/api/items/" + file.id + "/download",
        { headers: { Cookie: cookie } },
      );
      assert.equal(fileDownload.status, 200);
      assert.deepEqual(
        Buffer.from(await fileDownload.arrayBuffer()),
        fileBytes,
      );
      const list = await fetch(origin + "/api/items", {
        headers: { Cookie: cookie },
      });
      assert.equal((await list.json()).total, 2);
      const temporary = await fetch(origin + "/api/items/text", {
        method: "POST",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "X-CavVoid-Request": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: "Expires while stopped",
          submissionId: randomUUID(),
        }),
      });
      assert.equal(temporary.status, 201);
      const overdue = (await temporary.json()).item;
      const kept = await fetch(origin + "/api/items/" + file.id, {
        method: "PATCH",
        headers: {
          Cookie: cookie,
          Origin: origin,
          "X-CavVoid-Request": "1",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ retention: "keep" }),
      });
      assert.equal(kept.status, 200);
      await stop();
      // Disposable stopped database: simulate crossing an expiry deadline.
      const stoppedDb = new DatabaseSync(
        path.join(directory, "cavvoid.sqlite"),
      );
      stoppedDb
        .prepare("UPDATE items SET expires_at=? WHERE is_kept=0")
        .run("2000-01-01T00:00:00.000Z");
      stoppedDb.close();
      await start();
      assert.equal(
        (
          await fetch(origin + "/api/items/" + overdue.id, {
            headers: { Cookie: cookie },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await fetch(origin + "/api/items/" + item.id, {
            headers: { Cookie: cookie },
          })
        ).status,
        404,
      );
      const keptList = await fetch(origin + "/api/items?section=kept", {
        headers: { Cookie: cookie },
      });
      assert.equal((await keptList.json()).items[0].id, file.id);
      assert.equal(
        existsSync(path.join(directory, "files", "objects", file.id + ".blob")),
        true,
      );
    } finally {
      await stop();
      await new Promise((resolve) => {
        gateway.close(resolve);
        gateway.closeAllConnections();
      });
      removeTestDirectory(directory, "cavvoid-process-restart-");
    }
  },
);
