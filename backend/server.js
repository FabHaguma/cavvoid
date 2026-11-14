import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

try {
  const config = loadConfig();
  const instance = createApp({ config });
  const server = instance.app.listen(config.port, config.host, () =>
    console.log(`CavVoid: ${config.appOrigin}`),
  );
  server.requestTimeout = 30 * 60 * 1000;
  server.on("error", (error) => {
    console.error(`Cannot start CavVoid: ${error.code || "server error"}`);
    instance.close();
    process.exitCode = 1;
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      instance.events.close();
      server.close(() => {
        instance.close();
        process.exit(0);
      });
    });
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
