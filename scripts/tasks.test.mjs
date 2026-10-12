import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const require=createRequire(import.meta.url);
function load(path,deps={}) {
  const {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const exports={}; vm.runInNewContext(outputText,{exports,Date,Intl,Set,URL,TextDecoder,Uint8Array,Promise,require(name){
    if(name in deps) return deps[name]; if(name==="next/server") return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }}); return exports;
}
const model=load("../src/lib/tasks/model.ts");
const validation=load("../src/lib/tasks/validation.ts");
const repository=load("../src/lib/tasks/repository.ts",{"./validation":validation});
const owner="00000000-0000-4000-8000-000000000001";
const taskId="00000000-0000-4000-8000-000000000010";
const catId="00000000-0000-4000-8000-000000000020";
const version="2026-10-12T09:00:00.000000+00:00";
const fields={title:"A task",notes:null,status:"active",due_date:null,due_time:null,priority:"none",category_id:null};
const row={...fields,id:taskId,created_at:version,updated_at:version,completed_at:null};
function fixture(respond) {
  const calls=[];
  const client={from(table){
    const ops=[]; const query={};
    for(const method of ["select","eq","order","limit","gt","insert","update","single","maybeSingle"])
      query[method]=(...args)=>{ops.push([method,...args]);return query;};
    query.then=(resolve,reject)=>{
      const call={table,ops};calls.push(call);
      return Promise.resolve().then(()=>respond(call,calls)).then(resolve,reject);
    };
    return query;
  }};
  return {repo:new repository.TaskRepository(client,owner),calls,client};
}
const op=(call,name)=>call.ops.find(o=>o[0]===name);
const normal=call=>({data:call.table==="account_settings" ? {timezone:"Asia/Kolkata"} : [],error:null});

test("task payload validation rejects unsupported/owner/metadata writes, bad dates, missing fields, and completed creates",()=>{
  assert.equal(validation.validateAction({action:"create",fields:{...fields,title:"  hello  "}}).fields.title,"hello");
  for(const value of [
    {action:"create",fields:{...fields,owner_id:owner}},
    {action:"create",fields:{...fields,reminder:"Off"}},
    {action:"create",fields:{...fields,title:"\t\n"}},
    {action:"create",fields:{...fields,title:"x".repeat(201)}},
    {action:"create",fields:{...fields,notes:"x".repeat(4001)}},
    {action:"create",fields:{...fields,status:"completed"}},
    {action:"create",fields:{...fields,due_date:"2026-02-30"}},
    {action:"create",fields:{...fields,due_time:"25:00"}},
    {action:"update",fields,id:taskId,version:"not-a-version"},
    {action:"setup",timezone:"UTC"},
    {action:"delete",id:taskId},
    {action:"bootstrap",owner_id:owner},
    {action:"create",fields:{title:"missing other fields"}},
  ]) assert.equal(validation.validateAction(value),null);
  assert.ok(validation.validateAction({action:"create",fields:{...fields,due_date:"2028-02-29",due_time:"00:00"}}));
});

test("India calendar, timed and date-only Overdue boundaries, and completed/undated exclusions",()=>{
  const midnight=model.accountClock(new Date("2026-10-12T18:30:00Z"),"Asia/Kolkata");
  assert.equal(midnight.date,"2026-10-13"); assert.equal(midnight.time,"00:00:00");
  const task={...model.blankTask(),date:"2026-10-12",time:"14:00"};
  assert.equal(model.isOverdue(task,"2026-10-12","14:00:00"),false);
  assert.equal(model.isOverdue(task,"2026-10-12","14:00:01"),true);
  assert.equal(model.isOverdue({...task,time:""},"2026-10-12","23:59:59"),false);
  assert.equal(model.isOverdue({...task,time:""},midnight.date,midnight.time),true);
  assert.equal(model.isOverdue({...task,completed:true},midnight.date,midnight.time),false);
  assert.equal(model.isOverdue({...task,date:""},midnight.date,midnight.time),false);
});

test("search uses per-field phrases and AND filters; Today includes completed due-today tasks",()=>{
  const t={...model.blankTask(),title:"Buy groceries",notes:"Buy milk today",date:"2026-10-12",category:"Work",priority:"High",completed:true};
  const f={view:"Today",status:"All",category:"Work",priority:"High",search:" GROc "};
  assert.ok(model.matchesTask(t,f,t.date));
  assert.ok(model.matchesTask(t,{...f,search:"buy MILK"},t.date));
  assert.equal(model.matchesTask(t,{...f,search:"groceries buy"},t.date),false);
  assert.equal(model.matchesTask(t,{...f,status:"Active"},t.date),false);
  assert.equal(model.matchesTask(t,{...f,category:"Personal"},t.date),false);
  assert.equal(model.matchesTask(t,f,"2026-10-13"),false);
  assert.equal(model.matchesTask(t,{...f,view:"Overdue"},"2026-10-13"),false);
});

test("row mapping preserves dates/versions and rejects missing category joins or malformed committed rows",()=>{
  const t=model.mapTask(validation.decodeRow({...row,category_id:catId,due_date:"2026-10-12",due_time:"09:30:00"}),[{id:catId,name:"Work"}]);
  assert.equal(t.time,"09:30"); assert.equal(t.category,"Work"); assert.equal(t.updatedAt,version);
  assert.throws(()=>model.mapTask({...row,category_id:catId},[]));
  assert.throws(()=>validation.decodeRow({...row,status:"completed",completed_at:null}));
  assert.throws(()=>validation.decodeDataset({tasks:[row],categories:[],timezone:"UTC"}));
  const order=model.newestFirst([{...t,id:"a",createdAt:version},{...t,id:"b",createdAt:version,updatedAt:"2027-01-01T00:00:00Z"}]);
  assert.equal(order[0].id,"b");
});

test("paged reads load beyond 500 rows, keep explicit owner filters, and never write",async()=>{
  const rows=Array.from({length:501},(_,i)=>({...row,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`}));
  const f=fixture(call=>{
    if(call.table!=="tasks") return normal(call);
    return {data:op(call,"gt") ? rows.slice(500) : rows.slice(0,500),error:null};
  });
  const data=await f.repo.read();assert.equal(data.tasks.length,501);
  for(const call of f.calls) {
    assert.ok(call.ops.some(o=>o[0]==="eq"&&o[1]==="owner_id"&&o[2]===owner));
    assert.equal(!!op(call,"insert"),false);assert.equal(!!op(call,"update"),false);
  }
  const broken=fixture(call=>call.table==="tasks" ? {data:null,error:{code:"network"}} : normal(call));
  await assert.rejects(()=>broken.repo.read());
});

test("create returns committed row and sends only allowed fields",async()=>{
  const f=fixture(call=>op(call,"insert") ? {data:row,error:null} : normal(call));
  const result=await f.repo.mutate({action:"create",fields});assert.equal(result.task.id,taskId);
  const insert=f.calls.find(c=>op(c,"insert"));assert.equal(insert.table,"tasks");
  assert.equal("owner_id" in op(insert,"insert")[1],false);assert.ok(op(insert,"select"));
  const bad=fixture(call=>op(call,"insert") ? {data:null,error:null} : normal(call));
  await assert.rejects(()=>bad.repo.mutate({action:"create",fields}));
});

test("updates use owner/id/original version; complete writes status alone",async()=>{
  const done={...row,status:"completed",completed_at:version};
  const f=fixture(call=>op(call,"update") ? {data:done,error:null} : normal(call));
  await f.repo.mutate({action:"status",id:taskId,version,status:"completed"});
  const call=f.calls.find(c=>op(c,"update"));
  assert.deepEqual(Object.keys(op(call,"update")[1]),["status"]);
  for(const [key,value] of [["owner_id",owner],["id",taskId],["updated_at",version]])
    assert.ok(call.ops.some(o=>o[0]==="eq"&&o[1]===key&&o[2]===value));
});

test("stale edit returns latest owned row as conflict, missing row returns 404, no automatic replay",async()=>{
  const f=fixture(call=>op(call,"update") ? {data:null,error:null} : call.table==="tasks" ? {data:{...row,title:"Changed elsewhere"},error:null} : normal(call));
  await assert.rejects(()=>f.repo.mutate({action:"update",id:taskId,version,fields}),e=>e.status===409 && e.latest.title==="Changed elsewhere");
  assert.equal(f.calls.filter(c=>op(c,"update")).length,1);
  const missing=fixture(call=>call.table==="tasks" ? {data:null,error:null} : normal(call));
  await assert.rejects(()=>missing.repo.mutate({action:"update",id:taskId,version,fields}),e=>e.status===404);
});

test("category duplicate race re-reads the owned winner without update/upsert",async()=>{
  let reads=0;
  const f=fixture(call=>{
    if(call.table!=="categories") return normal(call);
    if(op(call,"insert")) return {data:null,error:{code:"23505"}};
    reads++;return {data:reads===1 ? [] : [{id:catId,name:"Work"}],error:null};
  });
  const result=await f.repo.mutate({action:"category",name:"work"});assert.equal(result.category.id,catId);
  assert.equal(f.calls.filter(c=>op(c,"insert")).length,1);assert.equal(f.calls.some(c=>op(c,"update")),false);
});

test("setup duplicate race reuses saved setting, unconfigured accounts cannot create tasks",async()=>{
  let reads=0;
  const f=fixture(call=>{
    if(op(call,"insert")) return {data:null,error:{code:"23505"}};
    return {data:++reads===1 ? null : {timezone:"Asia/Kolkata"},error:null};
  });
  assert.equal((await f.repo.mutate({action:"setup",timezone:"Asia/Kolkata"})).timezone,"Asia/Kolkata");
  const empty=fixture(()=>({data:null,error:null}));
  await assert.rejects(()=>empty.repo.mutate({action:"create",fields}),e=>e.status===409);
  assert.equal(empty.calls.some(c=>op(c,"insert")),false);
});

test("starter initialization creates only missing categories and is idempotent",async()=>{
  const categories=[{id:catId,name:"work"}]; let inserts=0;
  const f=fixture(call=>{
    if(call.table!=="categories") return normal(call);
    if(op(call,"insert")) {
      const value=op(call,"insert")[1];assert.deepEqual(Object.keys(value),["name"]);
      const category={id:`00000000-0000-4000-8000-${String(100+inserts++).padStart(12,"0")}`,name:value.name};
      categories.push(category);return {data:category,error:null};
    }
    return {data:categories,error:null};
  });
  await f.repo.mutate({action:"bootstrap"});await f.repo.mutate({action:"bootstrap"});
  assert.equal(inserts,2);assert.equal(categories.length,3);
  assert.equal(f.calls.some(c=>c.table==="tasks"),false);
});

function routeFixture(signedIn=true) {
  const f=fixture(normal);
  const route=load("../src/app/api/tasks/route.ts",{
    "@/lib/supabase/server":{createClient:async()=>({...f.client,auth:{}})},
    "@/lib/auth/flow":{verifiedIdentity:async()=>signedIn ? {userId:owner} : null},
    "@/lib/auth/server":{authOrigin:()=>"http://127.0.0.1:3003",AUTH_HEADERS:{"Cache-Control":"private, no-store, max-age=0"}},
    "@/lib/tasks/repository":repository,"@/lib/tasks/validation":validation,
  });return {...f,route};
}
const request=(body,origin="http://127.0.0.1:3003",type="application/json")=>new Request("http://127.0.0.1:3003/api/tasks",{
  method:"POST",headers:{origin,"Content-Type":type},body:typeof body==="string" ? body : JSON.stringify(body),
});
test("API rejects origin, media type, oversized/malformed JSON and invalid writes before any query",async()=>{
  const f=routeFixture();
  for(const [req,status] of [[request({action:"bootstrap"},"https://example.org"),403],
    [request({},undefined,"text/plain"),415],[request("x".repeat(32769)),413],
    [request("{"),400],[request({action:"create",fields:{...fields,owner_id:owner}}),400]])
    assert.equal((await f.route.POST(req)).status,status);
  assert.equal(f.calls.length,0);
});
test("API verifies session for every read/write and emits private no-store responses",async()=>{
  const anon=routeFixture(false);
  for(const response of [await anon.route.GET(),await anon.route.POST(request({action:"bootstrap"}))]) {
    assert.equal(response.status,401);assert.match(response.headers.get("cache-control"),/private, no-store/);
  }
  assert.equal(anon.calls.length,0);
  const f=routeFixture();const response=await f.route.GET();assert.equal(response.status,200);
  assert.equal((await response.json()).tasks.length,0);assert.match(response.headers.get("cache-control"),/no-store/);
});

test("API unexpected failures never expose provider errors or private contents",async()=>{
  const {GET}=load("../src/app/api/tasks/route.ts",{
    "@/lib/supabase/server":{createClient:async()=>{throw Error('fixture-private-provider-details');}},
    "@/lib/auth/flow":{verifiedIdentity:async()=>null},
    "@/lib/auth/server":{authOrigin:()=>"http://127.0.0.1:3003",AUTH_HEADERS:{"Cache-Control":"private, no-store"}},
    "@/lib/tasks/repository":repository,"@/lib/tasks/validation":validation,
  });
  const response=await GET();assert.equal(response.status,503);
  assert.equal((await response.text()).includes('fixture-private-provider-details'),false);
});
