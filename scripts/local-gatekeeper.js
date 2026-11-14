import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readEnvironment, projectRoot } from "../backend/config.js";

export const localEnvironmentFile = path.join(
  projectRoot,
  ".local/gatekeeper.env",
);

export function defaultGatekeeperRepo() {
  return path.resolve(projectRoot, "../../Dockered/OAuthenticator");
}

export function loadGatekeeperSource(repo) {
  if (
    !existsSync(path.join(repo, "backend/app.js")) ||
    !existsSync(path.join(repo, "backend/node_modules/express"))
  ) {
    throw new Error(
      "Gatekeeper source/dependencies not found. Run setup:local with --gatekeeper-repo <path> after installing Gatekeeper.",
    );
  }
  if (!existsSync(path.join(repo, "frontend/dist/index.html"))) {
    throw new Error(
      "Build the existing Gatekeeper frontend first (npm run build in its repository).",
    );
  }
  const require = createRequire(path.join(repo, "backend/package.json"));
  return { ...require("./app.js"), ...require("./config.js") };
}

export async function startLocalGatekeeper(
  repo,
  env = readEnvironment(localEnvironmentFile),
) {
  const source = loadGatekeeperSource(repo);
  const config = source.loadConfig(env);
  const instance = await source.createApp({ config });
  let server;
  try {
    server = await new Promise((resolve, reject) => {
      const handle = instance.app.listen(config.port, "127.0.0.1", () =>
        resolve(handle),
      );
      handle.once("error", reject);
    });
  } catch (error) {
    await instance.close();
    throw error;
  }
  return {
    server,
    config,
    async close() {
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      await instance.close();
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const appEnv = readEnvironment();
    const gateway = await startLocalGatekeeper(
      appEnv.LOCAL_GATEKEEPER_REPO || defaultGatekeeperRepo(),
    );
    console.log(`Local Gatekeeper: ${gateway.config.gatewayUrl}`);
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => gateway.close().then(() => process.exit(0)));
  } catch (error) {
    console.error(`Cannot start local Gatekeeper: ${error.message}`);
    process.exitCode = 1;
  }
}
