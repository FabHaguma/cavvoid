const safeMethods = new Set(["GET", "HEAD"]);

export function requireMutationOrigin(config) {
  return (req, res, next) => {
    if (safeMethods.has(req.method)) return next();
    if (
      req.get("Origin") !== config.appOrigin ||
      req.get("X-CavVoid-Request") !== "1"
    ) {
      return res.status(403).json({
        code: "invalid_origin",
        error: "This action must come from your CavVoid page.",
      });
    }
    next();
  };
}

function gatewayCookie(cookie = "") {
  const entries = cookie
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("gatekeeper_session="));
  // Ambiguous cookies never become an authenticated request.
  if (
    entries.length !== 1 ||
    !/^gatekeeper_session=[A-Za-z0-9_-]{1,256}$/.test(entries[0])
  )
    return "";
  return entries[0];
}

export function signInUrl(config, pathname = "/") {
  const url = new URL("/login", config.gatewayUrl);
  url.searchParams.set("returnTo", config.appOrigin + pathname);
  return url.href;
}

export async function verifyGateway(req, config, fetchImpl = fetch) {
  if (config.production) {
    const supplied = req.get("X-CavVoid-Ingress") || "";
    // Caddy overwrites this app-specific proof only after Gatekeeper approves.
    // Network isolation is still required; no gateway cookie/secret enters the app.
    const allowed =
      supplied.length === 64 &&
      /^[a-f0-9]{64}$/.test(supplied) &&
      config.ingressSecret?.length === 64 &&
      /^[a-f0-9]{64}$/.test(config.ingressSecret || "") &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(config.ingressSecret));
    return { allowed, status: allowed ? 204 : 403 };
  }
  const isApi = req.path === "/api" || req.path.startsWith("/api/");
  const isDocument =
    !isApi &&
    ["GET", "HEAD"].includes(req.method) &&
    (req.get("Accept") || "").includes("text/html");
  try {
    const result = await fetchImpl(new URL("/auth/verify", config.gatewayUrl), {
      redirect: "manual",
      signal: AbortSignal.timeout(config.timeoutMs),
      headers: {
        Cookie: gatewayCookie(req.headers.cookie),
        Accept: isDocument ? "text/html" : "application/json",
        "X-Gatekeeper-Proxy-Key": config.proxySecret,
        "X-Forwarded-Proto": "http",
        "X-Forwarded-Host": config.appHost,
        "X-Forwarded-Uri": req.originalUrl,
        "X-Forwarded-Method": req.method,
        "X-Forwarded-For": req.socket.remoteAddress || "127.0.0.1",
      },
    });
    // Only this exact response grants access. Never follow redirects or accept 200 login HTML.
    if (result.status === 204) return { allowed: true };
    if (result.status === 302 && isDocument) {
      const location = result.headers.get("location");
      if (location) {
        const target = new URL(location);
        if (
          target.origin === config.gatewayUrl &&
          target.pathname === "/login" &&
          !target.username &&
          !target.password &&
          !target.hash &&
          [...target.searchParams.keys()].length === 1 &&
          target.searchParams.get("returnTo") ===
            config.appOrigin + req.originalUrl
        ) {
          return { allowed: false, status: 302, location };
        }
      }
    }
    return {
      allowed: false,
      status: result.status === 401 ? 401 : result.status === 403 ? 403 : 503,
    };
  } catch {
    return { allowed: false, status: 503 };
  }
}
import { timingSafeEqual } from "node:crypto";
