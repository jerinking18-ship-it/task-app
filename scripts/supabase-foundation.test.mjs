import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getSupabaseConfig } from "../src/lib/supabase/config.ts";

const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require("next/server");
const fixtureConfig = { url: "https://example.supabase.co", publishableKey: "sb_publishable_test" };

// Compile only this local helper for dependency substitution. Tests use real
// Next request/response objects, fake SDK callbacks, and no network or real tokens.
function loadSessionHelper(createServerClient) {
  const source = readFileSync(new URL("../src/lib/supabase/proxy.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === "@supabase/ssr") return { createServerClient };
      if (name === "next/server") return { NextResponse };
      if (name === "./config") return { getSupabaseConfig: () => fixtureConfig };
      throw new Error(`Unexpected test dependency: ${name}`);
    },
  });
  return exports.updateSession;
}

function withEnvironment(url, key, check) {
  const names = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const [index, value] of [url, key].entries()) {
      if (value === undefined) delete process.env[names[index]];
      else process.env[names[index]] = value;
    }
    check();
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
}

test("configuration reports missing settings and rejects a privileged key", () => {
  withEnvironment(undefined, undefined, () => assert.throws(getSupabaseConfig, /Set NEXT_PUBLIC/));
  withEnvironment(fixtureConfig.url, "sb_secret_test", () => assert.throws(getSupabaseConfig, /publishable key/));
  withEnvironment("invalid", fixtureConfig.publishableKey, () => assert.throws(getSupabaseConfig, /valid project URL/));
  withEnvironment(fixtureConfig.url, fixtureConfig.publishableKey, () => assert.deepEqual(getSupabaseConfig(), fixtureConfig));
});

test("refresh forwards cookies, preserves cache headers across writes, and isolates requests", async () => {
  let clients = 0;
  const updateSession = loadSessionHelper((_url, _key, { cookies }) => {
    const sequence = ++clients;
    return { auth: { async getClaims() {
      cookies.setAll([{ name: "fixture-session", value: `value-${sequence}`, options: { path: "/", sameSite: "lax" } }], {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0", Pragma: "no-cache",
      });
      cookies.setAll([{ name: "fixture-extra", value: "second-write", options: { path: "/" } }], {});
      return { data: null, error: null };
    } } };
  });
  const request = new NextRequest("http://localhost/", { headers: { cookie: "original=first-request" } });
  const response = await updateSession(request);
  assert.equal(request.cookies.get("fixture-session")?.value, "value-1");
  assert.equal(response.cookies.get("fixture-session")?.value, "value-1");
  assert.equal(response.cookies.get("fixture-extra")?.value, "second-write");
  assert.match(response.headers.get("x-middleware-request-cookie"), /fixture-session=value-1/);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.equal(response.headers.get("expires"), "0");
  assert.equal(response.headers.get("pragma"), "no-cache");

  const otherRequest = new NextRequest("http://localhost/");
  const otherResponse = await updateSession(otherRequest);
  assert.equal(clients, 2);
  assert.equal(otherResponse.cookies.get("fixture-session")?.value, "value-2");
  assert.equal(otherRequest.cookies.get("original"), undefined);
  assert.equal(response.cookies.get("fixture-session")?.value, "value-1");
});

test("an anonymous preview request passes without creating cookies or redirects", async () => {
  const updateSession = loadSessionHelper(() => ({ auth: { async getClaims() {
    return { data: null, error: { name: "AuthSessionMissingError" } };
  } } }));
  const response = await updateSession(new NextRequest("http://localhost/"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("set-cookie"), null);
});
