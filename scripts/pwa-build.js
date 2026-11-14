import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const directory = new URL("../frontend/assets/pwa/", import.meta.url);
const workerPath = new URL(
  "../frontend/assets/js/service-worker.js",
  import.meta.url,
);
const types = {
  js: ["text/javascript", "application/javascript"],
  css: ["text/css"],
  svg: ["image/svg+xml"],
  png: ["image/png"],
  webmanifest: ["application/manifest+json"],
  html: ["text/html"],
};

export function pwaBuild() {
  return {
    name: "cavvoid-static-pwa",
    apply: "build",
    enforce: "post",
    transformIndexHtml: {
      order: "post",
      handler: (html) =>
        html.replace(
          "</head>",
          `<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials"><link rel="apple-touch-icon" href="/assets/pwa/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"></head>`,
        ),
    },
    generateBundle: {
      order: "post",
      handler(options, bundle) {
        this.addWatchFile(fileURLToPath(workerPath));
        const staticFiles = new Map();
        const index = bundle["index.html"]?.source;
        if (typeof index !== "string")
          throw new Error("Build the HTML shell before generating the PWA.");
        staticFiles.set(
          "pwa-shell.html",
          index.replace(
            "</head>",
            '<meta name="cavvoid-shell" content="static"></head>',
          ),
        );
        for (const entry of readdirSync(directory)) {
          if (
            !/^(manifest\.webmanifest|(?:icon-192|icon-512|icon-maskable-512|apple-touch-icon)\.png)$/.test(
              entry,
            )
          )
            continue;
          const filename = new URL(entry, directory);
          this.addWatchFile(fileURLToPath(filename));
          staticFiles.set(
            entry === "manifest.webmanifest" ? entry : "assets/pwa/" + entry,
            readFileSync(filename),
          );
        }
        const assets = [];
        const hash = createHash("sha256");
        const worker = readFileSync(workerPath, "utf8");
        hash.update(worker);
        for (const [filename, data] of [
          ...Object.values(bundle).map((entry) => [
            entry.fileName,
            entry.type === "chunk" ? entry.code : entry.source,
          ]),
          ...staticFiles,
        ].sort(([a], [b]) => a.localeCompare(b))) {
          if (filename === "index.html") continue;
          const extension = filename.split(".").at(-1);
          if (!types[extension]) continue;
          hash.update(filename);
          hash.update(data);
          assets.push({ url: "/" + filename, types: types[extension] });
        }
        if (!assets.some((asset) => asset.url === "/assets/pwa/icon-512.png"))
          throw new Error(
            "Generate the PWA icons first: node scripts/generate-icons.js",
          );
        const config = {
          cacheName: "cavvoid-shell-v1-" + hash.digest("hex").slice(0, 16),
          shell: "/pwa-shell.html",
          assets,
        };
        for (const [fileName, source] of staticFiles)
          this.emitFile({ type: "asset", fileName, source });
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: worker.replace(
            "__CAVVOID_PWA_CONFIG__",
            JSON.stringify(config),
          ),
        });
      },
    },
  };
}
