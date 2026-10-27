import assert from "node:assert/strict";
import test from "node:test";
import { securityHeaders } from "../security/headers.mjs";

const policy = (options) => Object.fromEntries(securityHeaders(options).map(({ key, value }) => [key, value]));

test("production policy blocks foreign sources and framing while retaining current Next rendering", () => {
  const h = policy({ supabaseUrl: "https://example.supabase.co/path?ignored=1" });
  const csp = h["Content-Security-Policy"];
  assert.match(csp, /connect-src 'self' https:\/\/example\.supabase\.co wss:\/\/example\.supabase\.co;/);
  assert.match(csp, /script-src 'self' 'unsafe-inline';/);
  assert.match(csp, /style-src 'self' 'unsafe-inline';/);
  for (const directive of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "manifest-src 'self'"]) assert.ok(csp.includes(directive));
  assert.ok(!csp.includes("unsafe-eval") && !csp.includes("*") && !csp.includes("ignored"));
  assert.equal(h["X-Frame-Options"], "DENY");
  assert.equal(h["X-Content-Type-Options"], "nosniff");
  assert.equal(h["Referrer-Policy"], "no-referrer");
  assert.match(h["Permissions-Policy"], /camera=\(\), microphone=\(\), geolocation=\(\)/);
  assert.match(h["Strict-Transport-Security"], /max-age=63072000/);
  assert.equal(h["Cache-Control"], undefined);
});

test("development retains local Supabase/HMR without forcing localhost to HTTPS", () => {
  const h = policy({ supabaseUrl: "http://127.0.0.1:54321", development: true });
  assert.match(h["Content-Security-Policy"], /http:\/\/127.0.0.1:54321 ws:\/\/127.0.0.1:54321/);
  assert.match(h["Content-Security-Policy"], /unsafe-eval/);
  assert.ok(!h["Content-Security-Policy"].includes("upgrade-insecure-requests"));
  assert.equal(h["Strict-Transport-Security"], undefined);
});

test("policy rejects credentials and insecure remote hosts and needs no privileged secret", () => {
  for (const url of ["http://remote.example", "https://user:password@example.com", "not-a-url", "javascript:alert(1)"]) assert.throws(() => securityHeaders({ supabaseUrl: url }));
  assert.match(policy()["Content-Security-Policy"], /connect-src 'self';/);
});
