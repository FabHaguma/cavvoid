import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { pwaBuild } from "./scripts/pwa-build.js";

export default defineConfig({
  root: fileURLToPath(new URL("./frontend/", import.meta.url)),
  publicDir: false,
  plugins: [pwaBuild()],
  build: { outDir: "dist", emptyOutDir: true },
});
