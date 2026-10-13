import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
function load(path, deps = {}) {
  const { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx:ts.JsxEmit.ReactJSX } });
  const exports = {};
  vm.runInNewContext(outputText, { exports, Date, Intl, Set, Uint8Array, TextDecoder, Promise, require(name) {
    if (name in deps) return deps[name];
    if (name === "next/server") return require(name);
    throw Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
const tasksModel = load("../src/lib/tasks/model.ts");
const validation = load("../src/lib/tasks/validation.ts", { "./model": tasksModel });
const model = load("../src/lib/members/model.ts", { "@/lib/tasks/validation": validation });
const server = load("../src/lib/members/server.ts", { "./model": model });
const id = "00000000-0000-4000-8000-000000000091";
const stamp = "2026-10-13T07:25:00Z";
const member = { id, name: "Grace", created_at: stamp, last_seen_at: stamp };
const state = { current: member, members: [member] };

test("member input trims/collapses spaces, accepts Unicode names, rejects controls/oversize/identity injection", () => {
  assert.equal(model.memberName("  Grace   Mary  "), "Grace Mary");
  assert.equal(model.memberName("தமிழ் பெயர்"), "தமிழ் பெயர்");
  for (const name of ["", " ", "x".repeat(51), "Bad\nName", "Bad\u200bName", null]) assert.equal(model.memberName(name), null);
  assert.equal(model.memberAction({ action: "create", name: "Grace", owner_id: id }), null);
  assert.equal(model.memberAction({ action: "select", id, session_id: id }), null);
  assert.equal(model.memberAction({ action: "select", id: "invalid" }), null);
  assert.deepEqual(JSON.parse(JSON.stringify(model.memberAction({ action: "create", name: " Grace " }))), { action: "create", name: "Grace" });
});
test("member decoder rejects partial, duplicate, foreign current member and over-capacity responses", () => {
  const result = model.decodeMembers(state); assert.equal(result.current.name, "Grace");
  assert.equal(model.decodeMembers({ current: null, members: [] }).current, null);
  for (const data of [{}, { ...state, members: [member, member] }, { ...state, members: [] },
    { ...state, current: { ...member, name: "Other" } }, { ...state, members: Array(11).fill(member) },
    { ...state, members: [{ ...member, last_seen_at: "invalid" }] }]) assert.throws(() => model.decodeMembers(data));
});
test("member last seen uses India calendar boundaries without claiming online status", () => {
  assert.equal(model.memberSeen("2026-10-12T18:29:59Z", new Date("2026-10-12T18:30:00Z")), "Last seen yesterday, 11:59 PM");
  assert.equal(model.memberSeen("2026-10-12T18:30:00Z", new Date("2026-10-13T18:29:59Z")), "Last seen today, 12:00 AM");
  assert.equal(model.memberSeen("bad"), "Last seen unavailable");
});
test("completion attribution is read-only metadata, preserved in mapping and omitted for legacy rows", () => {
  const row = { id, title: "Task", notes: null, status: "completed", due_date: null, due_time: null, priority: "medium", category_id: null, weekdays: [], created_at: stamp, updated_at: stamp, completed_at: stamp };
  assert.equal(tasksModel.mapTask(validation.decodeRow(row), []).completedByName, null);
  const mapped = tasksModel.mapTask(validation.decodeRow({ ...row, completed_by_member_id: id, completed_by_name: "Grace" }), []);
  assert.equal(mapped.completedByName, "Grace"); assert.equal(mapped.completedById, id);
  for (const patch of [{ completed_by_name: "Grace" }, { completed_by_member_id: id },
    { status: "active", completed_at: null, completed_by_name: "Grace", completed_by_member_id: id }]) assert.throws(() => validation.decodeRow({ ...row, ...patch }));
  const fields = tasksModel.taskFields(mapped, []);
  assert.equal("completed_by_name" in fields, false);
  assert.equal(validation.validateAction({ action: "update", id, version: stamp, fields: { ...fields, completed_by_name: "Other" } }), null);
});
test("member RPC supplies only selection data and sanitizes database error responses", async () => {
  const calls = []; const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: state, error: null }; } };
  assert.equal((await server.chooseMember(client, { action: "create", name: "Grace" })).current.name, "Grace");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), { name: "task_app_choose_member", args: { member_id: null, member_name: "Grace" } });
  await server.chooseMember(client, { action: "select", id });
  assert.equal(calls[1].args.member_name, null); assert.equal(calls[1].args.member_id, id);
  for (const [code, status] of [["P0010", 409], ["23505", 409], ["23514", 400], ["42501", 401], ["unexpected", 503]]) {
    await assert.rejects(() => server.readMembers({ rpc: async () => ({ data: null, error: { code, message: "private-provider-data" } }) }), error => error.status === status && !error.message.includes("private-provider-data"));
  }
});
function fixture({ signedIn = true, data = state, error = null, signOutFails = false } = {}) {
  const calls = [];
  const client = { auth: { signOut: async options => { calls.push({ signOut: options }); if(signOutFails) throw Error("Cookie cleanup unavailable"); return { error: null }; } }, rpc: async (name, args) => { calls.push({ name, args }); return { data, error }; } };
  const route = load("../src/app/api/members/route.ts", {
    "@/lib/supabase/server": { createClient: async () => client },
    "@/lib/auth/flow": { verifiedIdentity: async () => signedIn ? { userId: id, sessionId: id } : null },
    "@/lib/auth/server": { authOrigin: () => "http://127.0.0.1:3003", AUTH_HEADERS: { "Cache-Control": "private, no-store" } },
    "@/lib/members/model": model, "@/lib/members/server": server,
  });
  return { calls, route };
}
const request = (body, origin = "http://127.0.0.1:3003", type = "application/json") => new Request("http://127.0.0.1:3003/api/members", { method: "POST", headers: { origin, "Content-Type": type }, body: typeof body === "string" ? body : JSON.stringify(body) });
test("member API denies anonymous requests and wrong-origin/media/oversize/invalid writes, never mutating members", async () => {
  const anonymous = fixture({ signedIn: false });
  assert.equal((await anonymous.route.GET()).status, 401);
  assert.equal((await anonymous.route.POST(request({ action: "create", name: "Grace" }))).status, 401);
  assert.equal(anonymous.calls.length, 0);
  const f = fixture();
  for (const [req, status] of [[request({}, "https://other.example"), 403], [request({}, undefined, "text/plain"), 415],
    [request("x".repeat(4097)), 413], [request("{"), 400], [request({ action: "create", name: "Grace", owner_id: id }), 400]]) assert.equal((await f.route.POST(req)).status, status);
  assert.equal(f.calls.length, 0);
});
test("member API returns private no-store profile responses and useful cap conflicts", async () => {
  const f = fixture();
  const read = await f.route.GET(); assert.equal(read.status, 200); assert.match(read.headers.get("cache-control"), /private, no-store/);
  const selected = await f.route.POST(request({ action: "select", id })); assert.equal(selected.status, 200);
  const full = fixture({ error: { code: "P0010" }, data: null });
  const response = await full.route.POST(request({ action: "create", name: "Eleventh" }));
  assert.equal(response.status, 409); assert.match((await response.json()).message, /10-member limit/);
});
test("task API requires a selected member before task reads or writes", async () => {
  let reads = 0;
  const route = load("../src/app/api/tasks/route.ts", {
    "@/lib/supabase/server": { createClient: async () => ({ auth: {} }) },
    "@/lib/auth/flow": { verifiedIdentity: async () => ({ userId: id, sessionId: id }) },
    "@/lib/auth/server": { authOrigin: () => "http://127.0.0.1:3003", AUTH_HEADERS: {} },
    "@/lib/members/server": { ...server, readMembers: async () => ({ current: null, members: [] }) },
    "@/lib/tasks/repository": { TaskError: class extends Error { constructor(status, message) { super(message); this.status = status; } }, TaskRepository: class { async read() { reads++; } async mutate() { reads++; } } },
    "@/lib/tasks/validation": validation,
  });
  assert.equal((await route.GET()).status, 403);
  assert.equal((await route.POST(request({ action: "bootstrap" }))).status, 403);
  assert.equal(reads, 0);
});

test("account and member pages verify authentication, gate unselected sessions and recover member read failures", async () => {
  for (const signedIn of [false, true]) for (const current of [null, model.decodeMembers(state).current]) {
    let memberReads = 0;
    const deps = {
      "react/jsx-runtime": { jsx:(type,props)=>({type,props}), jsxs:(type,props)=>({type,props}) },
      "next/navigation": { redirect:path=>{throw Error(`redirect:${path}`);} },
      "@/lib/supabase/server": { createClient:async()=>({auth:{}}) },
      "@/lib/auth/flow": { verifiedIdentity:async()=>signedIn ? {userId:id,sessionId:id} : null },
      "@/lib/members/server": { MemberError:server.MemberError, readMembers:async()=>{memberReads++;return {current,members:model.decodeMembers(state).members};} },
      "@/components/task-app": {default:"task-app"},
      "@/components/auth/auth-shell": {default:"auth-shell"},
      "@/components/members/member-form": {default:"member-form"},
    };
    const account=load("../src/app/account/page.tsx",deps).default;
    if(!signedIn || !current) await assert.rejects(()=>account({searchParams:Promise.resolve({})}),new RegExp(`redirect:${signedIn?"/account/member":"/sign-in"}`));
    else {const page=await account({searchParams:Promise.resolve({password:"updated"})});assert.equal(page.props.initialMembers.current.name,"Grace");assert.equal(page.props.passwordUpdated,true);}
    if(!signedIn) assert.equal(memberReads,0);
    const memberPage=load("../src/app/account/member/page.tsx",deps).default;
    if(!signedIn || current) await assert.rejects(()=>memberPage(),new RegExp(`redirect:${signedIn?"/account":"/sign-in"}`));
    else assert.equal((await memberPage()).props.children.props.initialState.current,null);
    if(signedIn) {
      deps["@/lib/members/server"].readMembers=async()=>{throw Error("private-database-details");};
      const page=await load("../src/app/account/member/page.tsx",deps).default();
      assert.equal(page.props.children.props.initialState,null);
      assert.equal(JSON.stringify(page).includes("private-database-details"),false);
      deps["@/lib/members/server"].readMembers=async()=>{throw new server.MemberError(401,"Profile session ended");};
      await assert.rejects(()=>load("../src/app/account/page.tsx",deps).default({searchParams:Promise.resolve({})}),/redirect:\/sign-in/);
      await assert.rejects(()=>load("../src/app/account/member/page.tsx",deps).default(),/redirect:\/sign-in/);
    }
  }
});

test("profile actions only rename the selected member or explicitly confirm leaving; reject member/owner targeting", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(model.memberAction({action:"rename",name:" Grace  Mary ",previousName:"Grace"}))), {action:"rename",name:"Grace Mary",previousName:"Grace"});
  assert.equal(model.memberAction({action:"leave",confirmed:true}).action,"leave");
  for(const action of [{action:"leave"},{action:"leave",confirmed:false},{action:"leave",confirmed:true,id},
    {action:"rename",name:"Grace",previousName:"Old",id},{action:"rename",name:"",previousName:"Grace"},
    {action:"rename",name:"Grace",previousName:""}]) assert.equal(model.memberAction(action),null);
});
test("profile API uses current-member RPCs, rejects stale names and signs out only this device after leave", async () => {
  const f=fixture();
  const renamed=await f.route.POST(request({action:"rename",name:"Grace Mary",previousName:"Grace"}));
  assert.equal(renamed.status,200);
  assert.equal(f.calls[0].name,"task_app_rename_member");
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].args)),{member_name:"Grace Mary",previous_name:"Grace"});
  const stale=fixture({data:null,error:{code:"P0011",message:"private-details"}});
  const conflict=await stale.route.POST(request({action:"rename",name:"Grace Mary",previousName:"Grace"}));
  assert.equal(conflict.status,409); assert.match((await conflict.json()).message,/another device/);
  assert.equal(stale.calls.some(call=>call.signOut),false);
  const left=fixture({data:true});
  const response=await left.route.POST(request({action:"leave",confirmed:true}));
  assert.equal(response.status,200); assert.equal((await response.json()).left,true);
  assert.match(response.headers.get("cache-control"),/private, no-store/);
  assert.equal(left.calls[0].name,"task_app_leave_member"); assert.equal(left.calls[0].args,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(left.calls[1])),{signOut:{scope:"local"}});
});
test("revoked profile reads clear that browser session; ambiguous leave results never claim success", async () => {
  const revoked=fixture({data:null,error:{code:"42501"}});
  assert.equal((await revoked.route.GET()).status,401);
  assert.deepEqual(JSON.parse(JSON.stringify(revoked.calls[1])),{signOut:{scope:"local"}});
  const ambiguous=fixture({data:{left:true}});
  const response=await ambiguous.route.POST(request({action:"leave",confirmed:true}));
  assert.equal(response.status,503); assert.match((await response.json()).message,/confirm/);
  assert.equal(ambiguous.calls.some(call=>call.signOut),false);
  const anonymous=fixture({signedIn:false});
  assert.equal((await anonymous.route.POST(request({action:"leave",confirmed:true}))).status,401);
  assert.equal(anonymous.calls.length,0);
});
test("a committed profile leave remains successful if browser cookie cleanup fails", async () => {
  const f=fixture({data:true,signOutFails:true});
  const response=await f.route.POST(request({action:"leave",confirmed:true}));
  assert.equal(response.status,200); assert.equal((await response.json()).left,true);
  assert.equal(f.calls.filter(call=>call.name==="task_app_leave_member").length,1);
});
