import { request } from "node:http";
import { realpathSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export function removeTestDirectory(directory, prefix) {
  const target = realpathSync(directory);
  const temporaryRoot = realpathSync(os.tmpdir());
  if (
    path.dirname(target) !== temporaryRoot ||
    !path.basename(target).startsWith(prefix)
  ) {
    throw new Error(
      "Refusing to remove a directory outside this test's temporary root.",
    );
  }
  rmSync(target, { recursive: true, force: true });
}

export async function listen(app) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });
}

export async function closeServer(server) {
  await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections();
  });
}

export function httpRequest(
  server,
  host,
  pathname,
  { method = "GET", headers = {}, body } = {},
) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port: server.address().port,
        path: pathname,
        method,
        headers: { Host: host, Accept: "application/json", ...headers },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          const buffer = Buffer.concat(chunks),
            text = buffer.toString("utf8");
          resolve({
            status: response.statusCode,
            headers: response.headers,
            buffer,
            text,
            json: () => JSON.parse(text),
          });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}
