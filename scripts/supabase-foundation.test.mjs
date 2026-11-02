import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { getSupabaseConfig } from "../src/lib/supabase/config.ts";
import { appFetch, createDeadlineFetch } from "../src/lib/supabase/fetch.ts";

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
      if (name === "./fetch") return { appFetch };
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

test("provider requests preserve caller options and have a deadline without retrying writes",async()=>{
  let calls=0;
  const bounded=createDeadlineFetch(async(input,init)=>{calls++;assert.equal(input,'https://fixture.example/rpc');assert.equal(init.method,'POST');assert.equal(init.body,'{}');assert.equal(init.headers['X-Test'],'retained');assert.equal('cache'in init,false);assert.ok(init.signal instanceof AbortSignal);return new Response('{}');});
  assert.equal((await bounded('https://fixture.example/rpc',{method:'POST',body:'{}',headers:{'X-Test':'retained'}})).status,200);assert.equal(calls,1);
});
test("a hung provider request aborts within its deadline and is not automatically retried",async()=>{
  let calls=0;const hold=setTimeout(()=>{},200);
  try{const bounded=createDeadlineFetch((_input,init)=>{calls++;return new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});});},15);
    await assert.rejects(bounded('https://fixture.example'),e=>e.name==='TimeoutError');assert.equal(calls,1);
  }finally{clearTimeout(hold);}
});
test("provider deadlines retain explicit caller and Request cancellation",async()=>{
  const bounded=createDeadlineFetch(async(_input,init)=>{init.signal.throwIfAborted();return new Response('{}');});
  const caller=new AbortController();caller.abort();
  await assert.rejects(bounded('https://fixture.example',{signal:caller.signal}),e=>e.name==='AbortError');
  await assert.rejects(bounded(new Request('https://fixture.example',{signal:caller.signal})),e=>e.name==='AbortError');
});
test("a failed proxy refresh passes no identity or authorization and preserves route verification",async()=>{
  const updateSession=loadSessionHelper((_url,_key,options)=>{assert.equal(typeof options.global.fetch,'function');return{auth:{getClaims:async()=>{throw Error('Fictional provider unavailable');}}};});
  const r=await updateSession(new NextRequest('https://app.example/account'));
  assert.equal(r.status,200);assert.equal(r.headers.get('set-cookie'),null);assert.equal(r.headers.get('authorization'),null);assert.equal(r.headers.get('location'),null);
});
