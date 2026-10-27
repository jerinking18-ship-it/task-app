import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export async function checkSecurityHeaders(base) {
  let checks = 0;
  for (const [path, statuses] of [["/sign-in", [200]], ["/account/check-in", [302, 303, 307, 308]], ["/api/tasks", [401]], ["/manifest.webmanifest", [200]]]) {
    const response = await fetch(new URL(path, base), { redirect: "manual", signal: AbortSignal.timeout(15000) });
    assert.ok(statuses.includes(response.status), `${path}: unexpected status ${response.status}`);
    assert.equal(response.headers.get("x-frame-options"), "DENY", path);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
    const referrer = response.headers.get("referrer-policy");
    assert.ok(["no-referrer", "strict-origin-when-cross-origin"].includes(referrer), path);
    assert.match(response.headers.get("permissions-policy") ?? "", /camera=\(\)/, path);
    const csp = response.headers.get("content-security-policy") ?? "";
    assert.match(csp, /frame-ancestors 'none'/, path);
    assert.match(csp, /object-src 'none'/, path);
    assert.match(csp, /form-action 'self'/, path);
    assert.match(csp, /script-src 'self' 'unsafe-inline';/, path);
    assert.ok(!csp.includes("unsafe-eval"), path);
    assert.equal(response.headers.get("x-powered-by"), null, path);
    if (path === "/api/tasks") assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    if (path === "/sign-in") {
      const html = await response.text();
      assert.match(html, /apple-mobile-web-app-capable/);
      for (const [, asset] of html.matchAll(/(?:src|href)="([^" ]*\/_next\/static\/[^" ]+)"/g)) {
        const resource = await fetch(new URL(asset.replaceAll("&amp;", "&"), base), { signal: AbortSignal.timeout(15000) });
        assert.equal(resource.status, 200, asset);
      }
    }
    checks++;
  }
  // Reject before parsing credentials or reaching Auth. The global header
  // configuration must not weaken this route's existing privacy headers.
  const rejected = await fetch(new URL("/auth/submit", base), {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(15000),
    headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("referrer-policy"), "no-referrer");
  assert.match(rejected.headers.get("cache-control") ?? "", /no-store/);
  checks++;
  console.log(`PASS ${checks} production response/header/asset checks`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkSecurityHeaders(process.argv[2] ?? "http://127.0.0.1:3064");
}
