import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../backend/config.js";
import {
  defaultGatekeeperRepo,
  loadGatekeeperSource,
  localEnvironmentFile,
} from "./local-gatekeeper.js";

const args = process.argv.slice(2);
if (args.length && (args[0] !== "--gatekeeper-repo" || args.length !== 2)) {
  console.error(
    "Usage: npm run setup:local -- [--gatekeeper-repo <existing OAuthenticator path>]",
  );
  process.exitCode = 1;
} else {
  try {
    const envFile = path.join(projectRoot, ".env");
    if (existsSync(envFile) || existsSync(localEnvironmentFile)) {
      throw new Error(
        "Local settings already exist. They have been preserved. Edit them directly or follow README setup for an existing Gatekeeper.",
      );
    }
    const repo = path.resolve(args[1] || defaultGatekeeperRepo());
    loadGatekeeperSource(repo);
    mkdirSync(path.dirname(localEnvironmentFile), {
      recursive: true,
      mode: 0o700,
    });
    const secret = randomBytes(32).toString("hex");
    const password = randomBytes(18).toString("base64url");
    const quote = (value) => JSON.stringify(value.replaceAll("\\", "/"));
    writeFileSync(
      localEnvironmentFile,
      [
        "# Disposable local Gatekeeper settings. Never commit or use on the VPS.",
        "HOST=127.0.0.1",
        "PORT=4000",
        "GATEKEEPER_URL=http://localhost:4000",
        `ADMIN_PASSWORD=${password}`,
        "GATEKEEPER_USERNAME=Fabrice",
        `PROXY_AUTH_SECRET=${secret}`,
        `PROTECTED_APPS='[{"id":"cavvoid","name":"CavVoid","url":"http://localhost:3000"}]'`,
        "COOKIE_DOMAIN=",
        "SESSION_TTL_HOURS=168",
        "TRUST_PROXY=loopback",
        "NODE_ENV=development",
        `DATABASE_PATH=${quote(path.join(projectRoot, ".local/gatekeeper.sqlite"))}`,
        "",
      ].join("\n"),
      { mode: 0o600, flag: "wx" },
    );
    writeFileSync(
      envFile,
      [
        "APP_ORIGIN=http://localhost:3000",
        "GATEKEEPER_URL=http://localhost:4000",
        `GATEKEEPER_PROXY_SECRET=${secret}`,
        "GATEKEEPER_TIMEOUT_MS=5000",
        "DATABASE_PATH=./backend/data/cavvoid.sqlite",
        "OWNER_DISPLAY_NAME=Fabrice",
        `LOCAL_GATEKEEPER_REPO=${quote(repo)}`,
        "",
      ].join("\n"),
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "Local setup ready. Your original Gatekeeper configuration and database were not changed.",
    );
    console.log("Run npm run dev, then open http://localhost:3000.");
    console.log(
      "The local demo password is ADMIN_PASSWORD in .local/gatekeeper.env (ignored by Git).",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
