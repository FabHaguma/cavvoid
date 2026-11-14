import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const projectRoot = fileURLToPath(new URL("../", import.meta.url));

export function readEnvironment(filename = path.join(projectRoot, ".env")) {
  try {
    return parseEnv(readFileSync(filename, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function localOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an exact localhost origin.`);
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "localhost" ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${label} must be http://localhost:<port>, without a path.`,
    );
  }
  return url;
}

function secureOrigin(value, label) {
  if (typeof value !== "string" || /[\x00-\x20\x7f]/.test(value))
    throw new Error(`${label} must be an exact public HTTPS origin.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an exact HTTPS origin.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error(`${label} must be an exact public HTTPS origin.`);
  return url;
}

export function loadConfig(env = { ...readEnvironment(), ...process.env }) {
  const production = env.NODE_ENV === "production";
  const origin = production ? secureOrigin : localOrigin;
  if (
    production &&
    (env.AUTH_MODE !== "trusted-ingress" ||
      env.CAVVOID_INGRESS_SECRET?.length !== 64 ||
      !/^[a-f0-9]{64}$/.test(env.CAVVOID_INGRESS_SECRET || ""))
  )
    throw new Error(
      "Production requires AUTH_MODE=trusted-ingress and a separate 64-character lowercase hex CAVVOID_INGRESS_SECRET.",
    );
  if (production && (env.GATEKEEPER_PROXY_SECRET || env.LOCAL_GATEKEEPER_REPO))
    throw new Error(
      "Keep Gatekeeper credentials and local launch configuration out of the production app.",
    );
  if (!production && env.AUTH_MODE && env.AUTH_MODE !== "local-gateway")
    throw new Error("Local development requires local-gateway authentication.");
  const app = origin(env.APP_ORIGIN || "http://localhost:3000", "APP_ORIGIN");
  const gateway = origin(
    env.GATEKEEPER_URL || "http://localhost:4000",
    "GATEKEEPER_URL",
  );
  if (app.origin === gateway.origin)
    throw new Error("CavVoid and Gatekeeper must use distinct origins.");
  const proxySecret = env.GATEKEEPER_PROXY_SECRET || "";
  if (
    !production &&
    (proxySecret.length < 32 ||
      /\s/.test(proxySecret) ||
      /^replace/i.test(proxySecret))
  ) {
    throw new Error(
      "Set GATEKEEPER_PROXY_SECRET to the server-only Gatekeeper secret. For an isolated demo, run npm run setup:local.",
    );
  }
  const timeoutMs = Number(env.GATEKEEPER_TIMEOUT_MS || 5000);
  const port = production ? Number(env.PORT || 3001) : Number(app.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be a valid internal listening port.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000) {
    throw new Error("GATEKEEPER_TIMEOUT_MS must be between 100 and 10000.");
  }
  const maxTextBytes = Number(env.MAX_TEXT_BYTES || 102400);
  if (
    !Number.isInteger(maxTextBytes) ||
    maxTextBytes < 1 ||
    maxTextBytes > 10485760
  ) {
    throw new Error("MAX_TEXT_BYTES must be between 1 and 10485760.");
  }
  const databasePath =
    env.DATABASE_PATH === ":memory:"
      ? ":memory:"
      : path.resolve(
          projectRoot,
          env.DATABASE_PATH || "backend/data/cavvoid.sqlite",
        );
  if (
    production &&
    (!path.isAbsolute(env.DATABASE_PATH || "") ||
      !path.isAbsolute(env.FILES_PATH || ""))
  )
    throw new Error(
      "Production requires absolute DATABASE_PATH and FILES_PATH on persistent storage.",
    );
  const frontendDirectory = path.join(projectRoot, "frontend");
  const maxFileBytes = Number(env.MAX_FILE_BYTES || 104857600);
  const storageQuotaBytes = Number(env.STORAGE_QUOTA_BYTES || 2147483648);
  if (
    !Number.isSafeInteger(maxFileBytes) ||
    maxFileBytes < 1 ||
    maxFileBytes > 1073741824 ||
    !Number.isSafeInteger(storageQuotaBytes) ||
    storageQuotaBytes < 1 ||
    storageQuotaBytes > 1099511627776
  ) {
    throw new Error(
      "Set positive MAX_FILE_BYTES (up to 1 GB) and STORAGE_QUOTA_BYTES (up to 1 TB).",
    );
  }
  const filesDirectory = env.FILES_PATH
    ? path.resolve(projectRoot, env.FILES_PATH)
    : databasePath === ":memory:"
      ? null
      : path.join(path.dirname(databasePath), "files");
  if (
    filesDirectory &&
    !path.relative(frontendDirectory, filesDirectory).startsWith("..")
  ) {
    throw new Error("FILES_PATH must be outside the frontend directory.");
  }
  if (
    databasePath !== ":memory:" &&
    !path.relative(frontendDirectory, databasePath).startsWith("..")
  ) {
    throw new Error("DATABASE_PATH must be outside the frontend directory.");
  }
  const ownerDisplayName = (env.OWNER_DISPLAY_NAME || "Owner").trim();
  if (
    !ownerDisplayName ||
    ownerDisplayName.length > 80 ||
    /[\r\n]/.test(ownerDisplayName)
  ) {
    throw new Error(
      "OWNER_DISPLAY_NAME must be between 1 and 80 characters on one line.",
    );
  }
  return Object.freeze({
    appOrigin: app.origin,
    appHost: app.host,
    port,
    host: production ? "0.0.0.0" : "127.0.0.1",
    production,
    authMode: production ? "trusted-ingress" : "local-gateway",
    ingressSecret: production ? env.CAVVOID_INGRESS_SECRET : undefined,
    gatewayUrl: gateway.origin,
    proxySecret,
    timeoutMs,
    maxTextBytes,
    maxFileBytes,
    storageQuotaBytes,
    filesDirectory,
    databasePath,
    ownerDisplayName,
    frontendPath: path.join(frontendDirectory, "dist"),
    localGatekeeperRepo: env.LOCAL_GATEKEEPER_REPO
      ? path.resolve(projectRoot, env.LOCAL_GATEKEEPER_REPO)
      : null,
  });
}
