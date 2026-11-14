import { request } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export async function probeHealth({
  appOrigin = process.env.APP_ORIGIN,
  port = Number(process.env.PORT || 3001),
  timeoutMs = 3000,
} = {}) {
  let host;
  try {
    host = new URL(appOrigin).host;
  } catch {
    return { ok: false, code: "invalid_config" };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    return { ok: false, code: "invalid_config" };
  return new Promise((resolve) => {
    let req,
      settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, code: "timeout" }),
      timeoutMs,
    );
    // Core HTTP preserves this Host header. fetch can replace it with loopback,
    // which the application's exact public-host guard correctly rejects.
    req = request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/health",
        method: "GET",
        agent: false,
        headers: { Host: host, Accept: "application/json" },
      },
      (response) => {
        response.on("error", () =>
          finish({ ok: false, code: "connection_error" }),
        );
        if (response.statusCode !== 200)
          return finish({
            ok: false,
            code: "http_error",
            status: response.statusCode,
          });
        let body = "",
          bytes = 0;
        response.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > 512)
            return finish({ ok: false, code: "invalid_response" });
          body += chunk.toString("utf8");
        });
        response.on("end", () => {
          try {
            finish(
              JSON.parse(body).status === "ok"
                ? { ok: true, status: 200 }
                : { ok: false, code: "invalid_response" },
            );
          } catch {
            finish({ ok: false, code: "invalid_response" });
          }
        });
      },
    );
    req.on("error", () => finish({ ok: false, code: "connection_error" }));
    req.end();
  });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await probeHealth();
  if (!result.ok)
    console.error(
      `CavVoid readiness failed: ${result.code}${result.status ? ` (HTTP ${result.status})` : ""}`,
    );
  process.exitCode = result.ok ? 0 : 1;
}
