import { request } from "node:http";
import { StringDecoder } from "node:string_decoder";

export function openEventStream(server, host, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "127.0.0.1",
      port: server.address().port,
      path: "/api/events",
      headers: { Host: host, Accept: "text/event-stream", ...headers },
    });
    let opened = false;
    req.once("error", (error) => {
      if (!opened) reject(error);
    });
    req.once("response", (res) => {
      opened = true;
      const events = [],
        decoder = new StringDecoder("utf8");
      let buffer = "",
        raw = "",
        ended;
      const closed = new Promise((done) => {
        ended = done;
      });
      const waiting = new Set();
      const finish = () => ended(performance.now());
      res.on("end", finish);
      res.on("close", finish);
      res.on("error", finish);
      res.on("data", (chunk) => {
        const text = decoder.write(chunk);
        raw += text;
        buffer += text;
        let split;
        while ((split = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          if (frame.startsWith(":")) continue;
          const lines = Object.fromEntries(
            frame.split("\n").map((line) => {
              const index = line.indexOf(":");
              return [line.slice(0, index), line.slice(index + 1).trimStart()];
            }),
          );
          if (!lines.event) continue;
          const event = {
            type: lines.event,
            id: lines.id,
            data: JSON.parse(lines.data),
            receivedAt: performance.now(),
          };
          events.push(event);
          for (const check of waiting) check();
        }
      });
      resolve({
        status: res.statusCode,
        headers: res.headers,
        events,
        closed,
        get raw() {
          return raw;
        },
        close: () => req.destroy(),
        waitFor(type, predicate = () => true, timeout = 2500) {
          return new Promise((done, fail) => {
            const timer = setTimeout(() => {
              waiting.delete(check);
              fail(new Error("Missing event: " + type));
            }, timeout);
            const check = () => {
              const found = events.find(
                (event) => event.type === type && predicate(event),
              );
              if (found) {
                clearTimeout(timer);
                waiting.delete(check);
                done(found);
              }
            };
            waiting.add(check);
            check();
          });
        },
      });
    });
    req.end();
  });
}
