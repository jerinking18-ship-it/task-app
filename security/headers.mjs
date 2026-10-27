/**
 * Browser hardening only; no session, markup, styling or task rules change.
 * @param {{ supabaseUrl?: string, development?: boolean }} options
 */
export function securityHeaders({ supabaseUrl, development = false } = {}) {
  const connections = ["'self'"];
  if (supabaseUrl) {
    const url = new URL(supabaseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password || (url.protocol !== "https:" && !(local && url.protocol === "http:"))) {
      throw new Error("Security policy requires HTTPS Supabase, or a local HTTP instance.");
    }
    connections.push(url.origin, url.origin.replace(/^http/, "ws"));
  }
  if (development) connections.push("ws://localhost:*", "ws://127.0.0.1:*");
  // Next.js hydration and existing React inline style attributes need inline
  // allowances with static rendering. This is not a strict nonce-based CSP.
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `connect-src ${[...new Set(connections)].join(" ")}`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    ...(!development ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: policy },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    // Next's global headers can override a route's stricter policy. Use the
    // authentication routes' existing no-referrer protection everywhere.
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ...(!development ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }] : []),
  ];
}
