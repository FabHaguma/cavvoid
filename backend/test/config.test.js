import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";

const env = { GATEKEEPER_PROXY_SECRET: "test-only-secret-".repeat(4) };

test("configuration permits only the explicit local foundation and keeps data private", () => {
  const config = loadConfig(env);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.appOrigin, "http://localhost:3000");
  assert.ok(config.databasePath.endsWith("cavvoid.sqlite"));
  for (const override of [
    { NODE_ENV: "production" },
    { APP_ORIGIN: "http://0.0.0.0:3000" },
    { APP_ORIGIN: "http://localhost:3000/path" },
    { GATEKEEPER_URL: "https://login.example.com" },
    { GATEKEEPER_URL: "http://localhost:3000" },
    { GATEKEEPER_PROXY_SECRET: "" },
    { GATEKEEPER_PROXY_SECRET: "replace-with-a-long-placeholder-secret" },
    { GATEKEEPER_TIMEOUT_MS: "0" },
    { GATEKEEPER_TIMEOUT_MS: "10001" },
    { DATABASE_PATH: "frontend/private.sqlite" },
    { OWNER_DISPLAY_NAME: " " },
  ])
    assert.throws(() => loadConfig({ ...env, ...override }));
});
