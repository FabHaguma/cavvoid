import { build } from "vite";
import { spawn } from "node:child_process";
import { loadConfig, readEnvironment } from "../backend/config.js";
import {
  startLocalGatekeeper,
  localEnvironmentFile,
} from "./local-gatekeeper.js";

let gateway, watcher, backend;
let stopping = false;
async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  backend?.kill("SIGTERM");
  await watcher?.close();
  await gateway?.close();
  process.exit(code);
}

try {
  const config = loadConfig();
  if (config.localGatekeeperRepo) {
    const env = readEnvironment(localEnvironmentFile);
    if (
      env.PROXY_AUTH_SECRET !== config.proxySecret ||
      env.GATEKEEPER_URL !== config.gatewayUrl
    ) {
      throw new Error(
        "The isolated Gatekeeper settings do not match .env. Run setup:local once or fix the server-side configuration.",
      );
    }
    const apps = JSON.parse(env.PROTECTED_APPS || "[]");
    if (!apps.some((app) => new URL(app.url).origin === config.appOrigin))
      throw new Error(
        "Register APP_ORIGIN in .local/gatekeeper.env PROTECTED_APPS.",
      );
    gateway = await startLocalGatekeeper(config.localGatekeeperRepo, env);
    console.log(`Local Gatekeeper: ${config.gatewayUrl}`);
    console.log("Local demo password: ADMIN_PASSWORD in .local/gatekeeper.env");
  }
  await build();
  watcher = await build({ build: { watch: {} } });
  backend = spawn(process.execPath, ["--watch", "backend/server.js"], {
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, NODE_ENV: "development" },
  });
  backend.once("exit", (code) => {
    if (!stopping) shutdown(code || 0);
  });
  console.log(
    "Frontend changes rebuild automatically; refresh the browser to see them. Backend changes restart automatically.",
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => shutdown());
} catch (error) {
  console.error(`CavVoid could not start: ${error.message}`);
  await shutdown(1);
}
