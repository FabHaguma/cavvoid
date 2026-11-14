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

// Run on the VPS checkout only when preparing a requested release. No credentials
// are printed, no app is started, and an existing ingress secret is preserved.
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
  const existing = existsSync(filename)
    ? parseEnv(readFileSync(filename, "utf8"))
    : {};
  const permitted = [
    "CAVVOID_RELEASE",
    "GATEKEEPER_URL",
    "CAVVOID_INGRESS_SECRET",
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
    CAVVOID_INGRESS_SECRET:
      existing.CAVVOID_INGRESS_SECRET || randomBytes(32).toString("hex"),
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
      "# Private CavVoid runtime settings. Never commit or print this file.\n" +
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
  return { filename, release, created: !existing.CAVVOID_INGRESS_SECRET };
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
      `${result.created ? "Created" : "Updated"} private runtime file for release ${result.release}. Existing ingress proof was preserved on updates. No services changed.`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
