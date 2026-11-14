import { randomBytes } from "node:crypto";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  renameSync,
  chmodSync,
  unlinkSync,
} from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectRoot, loadConfig } from "../backend/config.js";

// Optional VPS settings helper. Preserve limits and drop the obsolete app secret;
// authentication belongs to the existing shared Caddy/Gatekeeper route.
export function prepareProduction({
  gatewayOrigin,
  release,
  filename = path.join(projectRoot, "deploy/production.env"),
}) {
  if (
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(release || "") ||
    /\s/.test(release || "") ||
    /^replace/i.test(release)
  )
    throw new Error(
      "Set --release to the pushed commit SHA or another identifiable Docker tag.",
    );
  const existed = existsSync(filename);
  const existing = existed ? parseEnv(readFileSync(filename, "utf8")) : {};
  const permitted = [
    "CAVVOID_RELEASE",
    "GATEKEEPER_URL",
    "CAVVOID_INGRESS_SECRET", // Accepted only to migrate older settings away.
    "MAX_TEXT_BYTES",
    "MAX_FILE_BYTES",
    "STORAGE_QUOTA_BYTES",
  ];
  if (Object.keys(existing).some((key) => !permitted.includes(key)))
    throw new Error(
      "Unexpected runtime settings: review the private file without printing its contents.",
    );
  if (existing.GATEKEEPER_URL && existing.GATEKEEPER_URL !== gatewayOrigin)
    throw new Error(
      "The existing gateway differs. Review it before changing the production origin.",
    );
  const values = {
    CAVVOID_RELEASE: release,
    GATEKEEPER_URL: gatewayOrigin,
    MAX_TEXT_BYTES: existing.MAX_TEXT_BYTES || "102400",
    MAX_FILE_BYTES: existing.MAX_FILE_BYTES || "104857600",
    STORAGE_QUOTA_BYTES: existing.STORAGE_QUOTA_BYTES || "2147483648",
  };
  loadConfig({
    ...values,
    NODE_ENV: "production",
    AUTH_MODE: "trusted-ingress",
    APP_ORIGIN: "https://cavvoid.haguma.com",
    DATABASE_PATH: "/data/cavvoid.sqlite",
    FILES_PATH: "/data/files",
  });
  for (const key of ["MAX_TEXT_BYTES", "MAX_FILE_BYTES", "STORAGE_QUOTA_BYTES"])
    if (String(Number(values[key])) !== values[key])
      throw new Error("Use canonical positive integer limits.");
  const temporary = filename + "." + randomBytes(6).toString("hex") + ".tmp";
  try {
    writeFileSync(
      temporary,
      "# CavVoid release settings. Authentication is handled by shared Caddy/Gatekeeper.\n" +
        Object.entries(values)
          .map(([key, value]) => `${key}=${value}`)
          .join("\n") +
        "\n",
      { mode: 0o600, flag: "wx" },
    );
    renameSync(temporary, filename);
    chmodSync(filename, 0o600);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  return { filename, release, created: !existed };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const args = process.argv.slice(2);
    if (
      args.length !== 4 ||
      args[0] !== "--gateway-origin" ||
      args[2] !== "--release"
    )
      throw new Error(
        "Usage: node scripts/prepare-production.js --gateway-origin <verified HTTPS origin> --release <pushed commit SHA>",
      );
    const result = prepareProduction({
      gatewayOrigin: args[1],
      release: args[3],
    });
    console.log(
      `${result.created ? "Created" : "Updated"} runtime file for release ${result.release}. Limits preserved; obsolete app secret removed. No services changed.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
