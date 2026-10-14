import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { NextResponse } = require("next/server");
function load(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, Buffer, URL, process, console, require(name) {
    if (name in dependencies) return dependencies[name];
    if (name === "node:crypto") return require(name);
    if (name === "next/server") return { NextResponse };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const validation = load("../src/lib/auth/validation.ts");
const recovery = load("../src/lib/auth/recovery.ts");
const flow = load("../src/lib/auth/flow.ts", { "./recovery": recovery });
const secret = "local-fixture-only-".repeat(4);
const identity = { userId: "fixture-user", sessionId: "fixture-session" };

function fixture(overrides = {}) {
  const calls = [];
  const auth = {
    async getClaims() { return { data: { claims: { sub: identity.userId, session_id: identity.sessionId } }, error: null }; },
    async getUser() { return { data: { user: { id: identity.userId, email:"person@example.test", email_confirmed_at:"2026-10-14T00:00:00Z" } }, error: null }; },
    async signInWithPassword(input) { calls.push(["password", input]); return { error: null }; },
    async signUp(input) { calls.push(["signup", input]); return { data: { user: { id: "fixture-user" }, session: null }, error: null }; },
    async signInWithOtp(input) { calls.push(["email-link", input]); return { error: null }; },
    async resetPasswordForEmail(email, options) { calls.push(["recover", email, options]); return { error: null }; },
    async updateUser(input) { calls.push(["update", input]); return { error: null }; },
    async signOut(input) { calls.push(["sign-out", input]); return { error: null }; },
    async exchangeCodeForSession(code, options) { calls.push(["exchange", code, options]); return { data: { redirectType: null }, error: null }; },
    ...overrides,
  };
  const cookies = [];
  const deps = { auth, origin: "http://127.0.0.1:3003", secret,
    recoveryGrant: undefined, setRecoveryGrant(value, maxAge) { cookies.push({ value, maxAge }); } };
  return { deps, calls, cookies };
}

test("validation trims only email, preserves passwords, and rejects unknown actions and bad reset confirmation", () => {
  const valid = validation.validateAuthInput({ action: "password", email: " user@example.com ", password: " secret with spaces " });
  assert.equal(valid.input.email, "user@example.com");
  assert.equal(valid.input.password, " secret with spaces ");
  assert.equal(validation.validateAuthInput({ action: "unknown-action" }).input, undefined);
  assert.equal(validation.validateAuthInput({ action: "email-link", email: "bad email" }).fields.email, "Enter a valid email address.");
  const reset = validation.validateAuthInput({ action: "reset", password: "123", confirmation: "different" });
  assert.ok(reset.fields.password); assert.ok(reset.fields.confirmation);
});

test("signup validates email, eight-character password and matching confirmation without trimming passwords", () => {
  const checked = validation.validateAuthInput({ action: "signup", email: " new@example.com ", password: " spaces stay ", confirmation: " spaces stay " });
  assert.equal(checked.input.email, "new@example.com");
  assert.equal(checked.input.password, " spaces stay ");
  assert.equal(validation.validateAuthInput({ action: "signup", email: "invalid", password: "short", confirmation: "different" }).input, undefined);
  const invalid = validation.validateAuthInput({ action: "signup", email: "invalid", password: "short", confirmation: "different" }).fields;
  assert.ok(invalid.email); assert.ok(invalid.password); assert.ok(invalid.confirmation);
  assert.equal(validation.validateAuthInput({ action: "signup", email: "new@example.com", password: "long-enough" }).input, undefined);
});

test("signup uses the canonical callback, does not treat a user object as a session, and hides account existence", async () => {
  const f = fixture();
  const input = { action: "signup", email: "new@example.com", password: "fixture-only" };
  const reply = await flow.runAuthAction(input, f.deps);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], "signup");
  assert.equal(f.calls[0][1].options.emailRedirectTo, `${f.deps.origin}/auth/callback`);
  assert.equal(f.calls[0][1].password, input.password);
  assert.equal(f.calls[0][1].options.data, undefined);
  assert.equal(reply.status, 200); assert.equal(reply.redirectTo, undefined);
  assert.equal(reply.session, undefined); assert.equal(reply.user, undefined);
  for (const code of ["user_already_exists", "email_exists"]) {
    const duplicate = fixture({ async signUp() { return { data: {}, error: { code, status: 422, message: "private account information" } }; } });
    assert.equal(JSON.stringify(await flow.runAuthAction(input, duplicate.deps)), JSON.stringify(reply));
  }
});

test("signup reports safe weak-password, disabled/provider and rate-limit failures", async () => {
  const input = { action: "signup", email: "new@example.com", password: "fixture-only" };
  for (const [code, status] of [["weak_password", 422], ["signup_disabled", 400], ["email_address_not_authorized", 400], ["provider_failure", 500], ["rate_limit", 429]]) {
    const f = fixture({ async signUp() { return { data: {}, error: { code, status, message: "private-provider-detail" } }; } });
    const reply = await flow.runAuthAction(input, f.deps);
    assert.notEqual(reply.status, 200); assert.equal(reply.redirectTo, undefined);
    assert.doesNotMatch(JSON.stringify(reply), /private-provider-detail/);
    if (code === "weak_password") assert.ok(reply.fields.password);
    if (status === 429) {assert.equal(reply.status, 429); assert.equal(reply.retryAfter, 60);}
    if (status === 500) assert.equal(reply.status, 503);
  }
});

test("immediate signup sessions require verified identity before account access", async () => {
  const signUp = async () => ({ data: { user: { id: identity.userId, email:"person@example.test", email_confirmed_at:"2026-10-14T00:00:00Z" }, session: { access_token: "fixture-token-never-return" } }, error: null });
  const input = { action: "signup", email: "new@example.com", password: "fixture-only" };
  const good = fixture({ signUp });
  const reply = await flow.runAuthAction(input, good.deps);
  assert.equal(reply.redirectTo, "/account"); assert.equal(good.cookies.at(-1).maxAge, 0);
  assert.doesNotMatch(JSON.stringify(reply), /fixture-token/);
  const mismatch = fixture({ signUp, async getUser() { return { data: { user: { id: "different-user" } }, error: null }; } });
  const denied = await flow.runAuthAction(input, mismatch.deps);
  assert.equal(denied.status, 401); assert.equal(denied.redirectTo, undefined);
});

test("email links explicitly disable signup and return no user/session data", async () => {
  const { deps, calls } = fixture();
  const result = await flow.runAuthAction({ action: "email-link", email: "user@example.com" }, deps);
  assert.equal(calls[0][1].options.shouldCreateUser, false);
  assert.equal(calls[0][1].options.emailRedirectTo, `${deps.origin}/auth/callback`);
  assert.equal(result.status, 200); assert.match(result.message, /If this email belongs/);
  for (const code of ["otp_disabled", "user_not_found", "signup_disabled", "email_not_confirmed", "other_account_error"]) {
    const unknown = fixture({ async signInWithOtp() { return { error: { status: 400, code } }; } });
    assert.equal((await flow.runAuthAction({ action: "email-link", email: "unknown@example.com" }, unknown.deps)).message, result.message);
  }
  assert.equal(result.user, undefined); assert.equal(result.session, undefined);
});

test("password sign-in requires verified claims and current matching user", async () => {
  const ok = fixture();
  assert.equal((await flow.runAuthAction({ action: "password", email: "user@example.com", password: "fixture-only" }, ok.deps)).redirectTo, "/account");
  const mismatch = fixture({ async getUser() { return { data: { user: { id: "other-user" } }, error: null }; } });
  const denied = await flow.runAuthAction({ action: "password", email: "user@example.com", password: "fixture-only" }, mismatch.deps);
  assert.equal(denied.status, 401); assert.equal(denied.redirectTo, undefined);
});

test("provider errors stay generic and rate limits return a retry delay", async () => {
  const failed = fixture({ async signInWithPassword() { return { error: { status: 400, message: "private provider detail" } }; } });
  const result = await flow.runAuthAction({ action: "password", email: "user@example.com", password: "fixture-only" }, failed.deps);
  assert.equal(result.status, 400); assert.doesNotMatch(result.message, /private provider detail/);
  const limited = fixture({ async signInWithOtp() { return { error: { status: 429 } }; } });
  const rate = await flow.runAuthAction({ action: "email-link", email: "user@example.com" }, limited.deps);
  assert.equal(rate.status, 429); assert.equal(rate.retryAfter, 60);
});

test("recovery requests use only the configured callback and a neutral response", async () => {
  const { deps, calls } = fixture();
  const result = await flow.runAuthAction({ action: "recover", email: "user@example.com" }, deps);
  assert.equal(calls[0][0], "recover");
  assert.equal(calls[0][2].redirectTo, `${deps.origin}/auth/callback`);
  assert.match(result.message, /If this email belongs/);
});

test("signed recovery grants reject tampering, expiry, other accounts, and other sessions", () => {
  const now = Date.now();
  const grant = recovery.createRecoveryGrant(identity, secret, now);
  assert.equal(recovery.verifyRecoveryGrant(grant, identity, secret, now), true);
  assert.equal(recovery.verifyRecoveryGrant(`${grant}x`, identity, secret, now), false);
  assert.equal(recovery.verifyRecoveryGrant(grant, identity, "different-secret-".repeat(3), now), false);
  assert.equal(recovery.verifyRecoveryGrant(grant, identity, secret, now + 600001), false);
  assert.equal(recovery.verifyRecoveryGrant(grant, { ...identity, userId: "other-user" }, secret, now), false);
  assert.equal(recovery.verifyRecoveryGrant(grant, { ...identity, sessionId: "other-session" }, secret, now), false);
});

test("callback grants recovery only for the SDK-verified recovery flow and binds it to the session", async () => {
  const signin = fixture();
  assert.equal(await flow.completeCallback("fixture-code", "fixture-flow-id", signin.deps), "/account");
  assert.equal(signin.calls[0][2].flowId, "fixture-flow-id");
  assert.equal(signin.cookies.every((cookie) => cookie.maxAge === 0), true);
  const reset = fixture({ async exchangeCodeForSession() { return { data: { redirectType: "recovery" }, error: null }; } });
  assert.equal(await flow.completeCallback("fixture-code", null, reset.deps), "/auth/reset-password");
  assert.equal(reset.cookies.at(-1).maxAge, 600);
  assert.equal(recovery.verifyRecoveryGrant(reset.cookies.at(-1).value, identity, secret), true);
  const invalid = fixture({ async exchangeCodeForSession() { return { error: { status: 400 } }; } });
  assert.equal(await flow.completeCallback("used-code", null, invalid.deps), "/sign-in?error=link");
  assert.equal(await flow.completeCallback(null, null, signin.deps), "/sign-in?error=link");
});

test("password updates need a recovery grant; valid updates clear it and end only the current session", async () => {
  const missing = fixture();
  const denied = await flow.runAuthAction({ action: "reset", password: "fixture-password" }, missing.deps);
  assert.equal(denied.status, 401); assert.equal(missing.calls.length, 0);
  const ok = fixture(); ok.deps.recoveryGrant = recovery.createRecoveryGrant(identity, secret);
  const changed = await flow.runAuthAction({ action: "reset", password: "fixture-password" }, ok.deps);
  assert.equal(changed.redirectTo, "/sign-in?notice=password-updated");
  assert.equal(ok.calls[0][0], "update"); assert.equal(ok.calls[1][1].scope, "local");
  assert.equal(ok.cookies.at(-1).maxAge, 0);
});

test("successful password updates are reported as success even if sign-out fails", async () => {
  const f = fixture({ async signOut() { throw new Error("fixture connection failure"); } });
  f.deps.recoveryGrant = recovery.createRecoveryGrant(identity, secret);
  const result = await flow.runAuthAction({ action: "reset", password: "fixture-password" }, f.deps);
  assert.equal(result.status, 200); assert.equal(result.redirectTo, "/account?password=updated");
});

function submitFixture() {
  const f = fixture();
  const server = { AUTH_HEADERS: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
    authOrigin: () => f.deps.origin, authDependencies: async () => f.deps };
  const { POST } = load("../src/app/auth/submit/route.ts", {
    "@/lib/auth/validation": validation, "@/lib/auth/flow": flow, "@/lib/auth/server": server,
  });
  return { ...f, POST, server };
}
function request(body, origin = "http://127.0.0.1:3003", type = "application/json") {
  return new Request("http://127.0.0.1:3003/auth/submit", { method: "POST", headers: { origin, "content-type": type }, body });
}

test("route rejects cross-origin requests, malformed/oversize input, and invalid fields before calling Auth", async () => {
  const { POST, calls } = submitFixture();
  assert.equal((await POST(request('{"action":"sign-out"}', "https://other.example"))).status, 403);
  assert.equal((await POST(request("data", undefined, "text/plain"))).status, 415);
  assert.equal((await POST(request("{"))).status, 400);
  assert.equal((await POST(request("x".repeat(8193)))).status, 413);
  assert.equal((await POST(request('{"action":"password","email":"invalid"}'))).status, 400);
  assert.equal(calls.length, 0);
});

test("route success preserves no-store headers; exceptions never return private details", async () => {
  const { POST, server } = submitFixture();
  const response = await POST(request('{"action":"email-link","email":"user@example.com"}'));
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("retry-after"), "60");
  server.authDependencies = async () => { throw new Error("fixture-secret-never-expose"); };
  const failed = await POST(request('{"action":"email-link","email":"user@example.com"}'));
  assert.equal(failed.status, 503); assert.doesNotMatch(await failed.text(), /fixture-secret/);
});

test("signup route rejects invalid and cross-origin creation before Auth and returns only a private safe reply", async () => {
  const f = submitFixture();
  const valid = JSON.stringify({ action: "signup", email: "new@example.com", password: "fixture-only", confirmation: "fixture-only" });
  assert.equal((await f.POST(request(valid, "https://other.example"))).status, 403);
  assert.equal((await f.POST(request(JSON.stringify({ action: "signup", email: "new@example.com", password: "fixture-only", confirmation: "different" })))).status, 400);
  assert.equal(f.calls.length, 0);
  const response = await f.POST(request(valid));
  assert.equal(response.status, 200); assert.equal(response.headers.get("retry-after"), "60");
  assert.match(response.headers.get("cache-control"), /no-store/);
  const body = await response.json();
  assert.equal(body.user, undefined); assert.equal(body.session, undefined);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0][0], "signup");
});

test("callback ignores external destinations and caller-supplied recovery types", async () => {
  const f = submitFixture();
  const { GET } = load("../src/app/auth/callback/route.ts", { "@/lib/auth/flow": flow, "@/lib/auth/server": f.server });
  const response = await GET(new Request(`${f.deps.origin}/auth/callback?code=fixture&type=recovery&next=https://other.example`));
  assert.equal(response.status, 303); assert.equal(response.headers.get("location"), `${f.deps.origin}/account`);
  assert.equal(f.cookies.every((cookie) => cookie.maxAge === 0), true);
  const invalid = await GET(new Request(`${f.deps.origin}/auth/callback?error=provider-private-error&next=https://other.example`));
  assert.equal(invalid.headers.get("location"), `${f.deps.origin}/sign-in?error=link`);
});

test("profile email comes only from the verified current Auth user", async () => {
  const f=fixture({getUser:async()=>({data:{user:{id:identity.userId,email:"team@example.com",email_confirmed_at:"2026-10-14T00:00:00Z"}},error:null})});
  const verified=await flow.verifiedIdentity(f.deps.auth);
  assert.equal(verified.email,"team@example.com");
  assert.equal(verified.userId,identity.userId);
  const missing=await flow.verifiedIdentity(fixture().deps.auth);
  assert.equal(missing.email,"person@example.test");
});


test("personal workspace login rejects unverified or missing email identities",async()=>{
 for(const user of [{id:identity.userId,email:"person@example.test",email_confirmed_at:null},{id:identity.userId,email_confirmed_at:"2026-10-14T00:00:00Z"}]){
 const f=fixture({getUser:async()=>({data:{user},error:null})});assert.equal(await flow.verifiedIdentity(f.deps.auth),null);}
});
