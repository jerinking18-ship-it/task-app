import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const require=createRequire(import.meta.url);
function load(path,deps={},globals={}) {
  const {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  const exports={}; vm.runInNewContext(outputText,{exports,Date,Intl,Set,URL,TextDecoder,Uint8Array,Promise,...globals,require(name){
    if(name in deps) return deps[name]; if(name==="next/server") return require(name);
    throw Error(`Unexpected dependency ${name}`);
  }}); return exports;
}
const model=load("../src/lib/tasks/model.ts");
const validation=load("../src/lib/tasks/validation.ts",{"./model":model});
const confirmedState=load("../src/lib/tasks/confirmed-state.ts",{"./validation":validation,"./model":model});
const completed=load("../src/lib/tasks/completed.ts",{"./validation":validation});
const repository=load("../src/lib/tasks/repository.ts",{"./validation":validation,"./model":model});
const owner="00000000-0000-4000-8000-000000000001";
const taskId="00000000-0000-4000-8000-000000000010";
const catId="00000000-0000-4000-8000-000000000020";
const version="2026-10-12T09:00:00.000000+00:00";
const fields={assigned_to_member_id:taskId,title:"A task",notes:null,status:"active",due_date:null,due_time:null,priority:"none",category_id:null,weekdays:[]};
const row={...fields,id:taskId,created_at:version,updated_at:version,completed_at:null};
function fixture(respond) {
  const calls=[];
  const client={rpc(name,args){if(name==="task_app_special_state")return Promise.resolve({data:{serverNow:version,meetings:[],plans:[]},error:null});const call={table:"rpc",ops:[["rpc",name,args]]};calls.push(call);return Promise.resolve().then(()=>respond(call,calls));},from(table){
    const ops=[]; const query={};
    for(const method of ["select","eq","is","order","limit","gt","insert","update","single","maybeSingle"])
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
const normal=call=>({data:call.table==="account_settings" ? {timezone:"Asia/Kolkata"} : call.table==="rpc" ? (["task_app_available_coverage","task_app_coverage_origins","task_app_member_names"].includes(op(call,"rpc")[1])?[]:null) : [],error:null});

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

test("completion age uses India calendar days rather than elapsed hours or deadlines",()=>{
  for(const [completed,now,expected] of [
    ["2026-10-12T18:29:59Z","2026-10-12T18:29:59Z","Today"],
    ["2026-10-12T18:29:59Z","2026-10-12T18:30:00Z","Yesterday"],
    ["2026-10-12T18:30:00Z","2026-10-13T18:29:59Z","Today"],
    ["2026-10-12T18:30:00Z","2026-10-14T18:30:00Z","2 days ago"],
    ["2026-10-16T07:25:00Z","2026-10-19T07:25:00Z","3 days ago"],
    ["2026-12-31T18:29:59Z","2026-12-31T18:30:00Z","Yesterday"],
    ["2028-02-28T18:30:00Z","2028-03-01T18:30:00Z","2 days ago"],
  ]) assert.equal(model.completionAge(completed,new Date(now)),expected);
  assert.equal(model.completionAge(null,new Date("2026-10-13T00:00:00Z")),null);
  assert.equal(model.completionAge("invalid",new Date()),null);
  assert.equal(model.completionAge("2026-10-13T00:00:00Z",new Date(NaN)),null);
  assert.equal(model.completionAge("2026-10-14T18:30:00Z",new Date("2026-10-13T00:00:00Z")),null);
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

test("Overdue status filter respects deadline and AND filters, excluding completed/history/unavailable tasks",()=>{
  const now=new Date("2026-10-13T08:30:01Z");
  const task={...model.blankTask(),title:"Prepare service",notes:"Team meeting",date:"2026-10-13",time:"14:00",category:"Sunday Service",priority:"High"};
  const filters={view:"All tasks",status:"Overdue",category:"Any",priority:"Any",search:""};
  assert.equal(model.matchesTask(task,filters,"2026-10-13","14:00:00",now),false);
  assert.ok(model.matchesTask(task,filters,"2026-10-13","14:00:01",now));
  assert.ok(model.matchesTask(task,{...filters,view:"Today",category:"Sunday Service",priority:"High",search:"team meeting"},"2026-10-13","14:00:01",now));
  for(const change of [{completed:true},{date:"2026-10-14"},{date:""},{time:"15:00"},{availableAt:"2026-10-14T00:00:00Z"},{completed:true,historyAt:"2026-10-12T00:00:00Z"}])
    assert.equal(model.matchesTask({...task,...change},filters,"2026-10-13","14:00:01",now),false);
  for(const change of [{category:"Healing Meeting"},{priority:"Low"},{search:"missing"},{view:"Completed"}])
    assert.equal(model.matchesTask(task,{...filters,...change},"2026-10-13","14:00:01",now),false);
  assert.ok(model.matchesTask({...task,date:"2026-10-12",time:""},filters,"2026-10-13","00:00:00",now));
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

test("Completed sorts by the real completion instant, not creation, editing or timestamp formatting",()=>{
  const base={...model.blankTask(),completed:true};
  const rows=[
    {...base,id:"old-created",createdAt:"2026-10-10T00:00:00Z",completedAt:"2026-10-14T13:00:00.123456Z"},
    {...base,id:"new-created",createdAt:"2026-10-14T00:00:00Z",updatedAt:"2026-10-15T00:00:00Z",completedAt:"2026-10-14T18:29:00+05:30"},
    {...base,id:"slightly-later",createdAt:"2026-10-11T00:00:00Z",completedAt:"2026-10-14T13:00:00.123457+00:00"},
    {...base,id:"missing-completion",createdAt:"2026-10-15T00:00:00Z",completedAt:null},
  ];
  assert.equal(model.sortTasksForStatus(rows,"Completed").map(t=>t.id).join(","),"slightly-later,old-created,new-created,missing-completion");
  assert.equal(rows[0].id,"old-created");
});

test("Overdue uses latest due date then time, including date-only midnight boundaries",()=>{
  const base=model.blankTask();
  const rows=[
    {...base,id:"recently-created",createdAt:"2026-10-14T00:00:00Z",date:"2026-10-10",time:"23:50"},
    {...base,id:"morning",createdAt:"2026-10-10T00:00:00Z",date:"2026-10-13",time:"05:00"},
    {...base,id:"evening",createdAt:"2026-10-09T00:00:00Z",date:"2026-10-13",time:"23:50"},
    {...base,id:"date-only",createdAt:"2026-10-08T00:00:00Z",date:"2026-10-13",time:""},
    {...base,id:"same-midnight-newer",createdAt:"2026-10-09T00:00:00Z",date:"2026-10-14",time:"00:00"},
  ];
  assert.equal(model.sortTasksForStatus(rows,"Overdue").map(t=>t.id).join(","),"same-midnight-newer,date-only,evening,morning,recently-created");
});

test("All and Active retain creation-time order across offset representations and stable ties",()=>{
  const base=model.blankTask();
  const rows=[
    {...base,id:"older",createdAt:"2026-10-14T18:00:00+05:30",updatedAt:"2026-10-15T00:00:00Z",completedAt:"2026-10-15T00:00:00Z"},
    {...base,id:"a",createdAt:"2026-10-14T13:00:00Z"},
    {...base,id:"b",createdAt:"2026-10-14T18:30:00.000000+05:30"},
  ];
  for(const status of ["All","Active"])
    assert.equal(model.sortTasksForStatus(rows,status).map(t=>t.id).join(","),"b,a,older");
  assert.equal(model.newestFirst(rows).map(t=>t.id).join(","),"b,a,older");
});

test("equal completion and due times fall back to creation time, then ID",()=>{
  const base={...model.blankTask(),completed:true,completedAt:"2026-10-14T13:00:00Z",date:"2026-10-13",time:"12:00"};
  const rows=[{...base,id:"z",createdAt:"2026-10-10T00:00:00Z"},{...base,id:"a",createdAt:"2026-10-12T00:00:00Z"},{...base,id:"b",createdAt:"2026-10-12T00:00:00Z"}];
  for(const status of ["Completed","Overdue"])
    assert.equal(model.sortTasksForStatus(rows,status).map(t=>t.id).join(","),"b,a,z");
});

test("paged reads release only the session owner's due repeats, load beyond 500 rows, and keep owner filters",async()=>{
  const rows=Array.from({length:501},(_,i)=>({...row,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`}));
  const f=fixture(call=>{
    if(call.table!=="tasks") return normal(call);
    return {data:op(call,"gt") ? rows.slice(500) : rows.slice(0,500),error:null};
  });
  const data=await f.repo.read();assert.equal(data.tasks.length,501);
  for(const call of f.calls) {
    if(call.table==="rpc") {assert.ok(["task_app_release_my_repeats","task_app_available_coverage","task_app_coverage_origins","task_app_member_names"].includes(op(call,"rpc")[1]));assert.equal(op(call,"rpc")[2],undefined);continue;}
    assert.ok(call.ops.some(o=>o[0]==="eq"&&o[1]==="owner_id"&&o[2]===owner));
    assert.equal(!!op(call,"insert"),false);assert.equal(!!op(call,"update"),false);
  }
  const broken=fixture(call=>call.table==="tasks" ? {data:null,error:{code:"network"}} : normal(call));
  await assert.rejects(()=>broken.repo.read());
});

test("midnight availability gates generated successors without hiding user-created future tasks",()=>{
  const before=new Date("2026-10-13T18:29:59.999Z"), midnight=new Date("2026-10-13T18:30:00Z");
  const fields={...row,due_date:"2026-10-14",due_time:"10:00:00",available_at:midnight.toISOString()};
  const delayed=model.mapTask(validation.decodeRow(fields),[]);
  const filters={view:"All tasks",status:"All",priority:"Any",category:"Any",search:""};
  assert.equal(model.isAvailable(delayed,before),false);
  assert.equal(model.matchesTask(delayed,filters,"2026-10-13","23:59:59",before),false);
  assert.equal(model.matchesTask(delayed,filters,"2026-10-14","00:00:00",midnight),true);
  assert.equal(model.isOverdue(delayed,"2026-10-14","00:00:00"),false);
  assert.equal(model.isAvailable({...delayed,availableAt:null},before),true);
  assert.throws(()=>validation.decodeRow({...fields,available_at:"not a date"}));
  assert.equal(validation.validateAction({action:"create",fields:{...row,available_at:midnight.toISOString()}}),null);
});

test("failed midnight release aborts loading before a partial dataset can be returned",async()=>{
  const f=fixture(call=>call.table==="rpc"?{data:null,error:{code:"XX000"}}:normal(call));
  await assert.rejects(()=>f.repo.read(),error=>error.status===503);
  assert.equal(f.calls.length,1);
});

test("an open app refreshes once at India midnight, preserves dirty drafts and cleans up its timer",async()=>{
  for(const dirty of [false,true]) {
    let clock=Date.parse("2026-10-12T18:29:59.500Z"), stateIndex=0, reads=0;
    const effects=[],timers=new Map();let timerId=0;
    class FixtureDate extends Date {constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
    const react={useCallback:fn=>fn,useMemo:fn=>fn(),useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),
      useState:value=>[stateIndex++===0?{timezone:"Asia/Kolkata",tasks:[],categories:[]}:stateIndex===6?true:value,()=>{}]};
    const window={addEventListener(){},removeEventListener(){},setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);}};
    const document={visibilityState:"visible",addEventListener(){},removeEventListener(){}};
    const hook=load("../src/lib/tasks/use-saved-tasks.ts",{"react":react,"./model":model,"./validation":validation,"./completed":completed,"./confirmed-state":confirmedState},
      {window,document,Date:FixtureDate,AbortController,AbortSignal,fetch:async()=>{reads++;return {ok:true,json:async()=>({timezone:"Asia/Kolkata",tasks:[],categories:[]})};}});
    hook.useSavedTasks(true,dirty);
    const cleanups=effects.map(effect=>effect());
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(timers.size,1);const entry=[...timers.entries()][0];
    assert.equal(entry[1].delay,600);
    timers.delete(entry[0]);clock+=600;entry[1].fn();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(reads,dirty?0:2);
    assert.equal(timers.size,1);assert.equal([...timers.values()][0].delay,86400000);
    cleanups.forEach(cleanup=>cleanup?.());assert.equal(timers.size,0);
  }
});

test("create sends one checked RPC with assignee and validates committed row",async()=>{
 const f=fixture(call=>op(call,"rpc")?.[1]==="task_app_create_tasks"?{data:[row],error:null}:normal(call));
 const result=await f.repo.mutate({action:"create",fields});assert.equal(result.task.id,taskId);
 assert.equal(f.calls.length,1);assert.equal(op(f.calls[0],"rpc")[2].task_fields[0].assigned_to_member_id,taskId);
 assert.equal("owner_id" in op(f.calls[0],"rpc")[2],false);
 const bad=fixture(()=>({data:[],error:null}));await assert.rejects(()=>bad.repo.mutate({action:"create",fields}));
 const missing=fixture(normal);await assert.rejects(()=>missing.repo.mutate({action:"create",fields:{...fields,assigned_to_member_id:null}}),error=>error.status===400);assert.equal(missing.calls.length,0);
});

test("status uses the atomic owner-checked RPC with original task/version",async()=>{
  const done={...row,status:"completed",completed_at:version};
  const f=fixture(call=>op(call,"rpc")?.[1]==="task_app_mutate" ? {data:done,error:null} : normal(call));
  await f.repo.mutate({action:"status",id:taskId,version,status:"completed",cachedProjection:true});
  const args=op(f.calls.find(c=>op(c,"rpc")),"rpc")[2];
  assert.equal(args.task_id,taskId);assert.equal(args.expected_version,version);
  assert.equal(args.operation,"status");assert.equal(args.new_status,"completed");
  assert.equal(args.fields,null);assert.equal(args.edit_scope,"this");
  assert.equal("owner_id" in args,false);
  assert.equal(f.calls.length,1,"committed status must not wait for directory/origin reads");
});

test("status rejects wrong identity/status and preserves stale and permission failures",async()=>{
  for(const data of [{...row,id:catId,status:"completed",completed_at:version},row]){
    const f=fixture(()=>({data,error:null}));
    await assert.rejects(()=>f.repo.mutate({action:"status",id:taskId,version,status:"completed",cachedProjection:true}),e=>e.status===503);
    assert.equal(f.calls.length,1);
  }
  const denied=fixture(()=>({data:null,error:{code:"P0403"}}));
  await assert.rejects(()=>denied.repo.mutate({action:"status",id:taskId,version,status:"completed"}),e=>e.status===403);
  assert.equal(denied.calls.length,1);
  const stale=fixture(call=>call.table==="tasks"?{data:row,error:null}:op(call,"rpc")?.[1]==="task_app_mutate"?{data:{conflict:true},error:null}:normal(call));
  await assert.rejects(()=>stale.repo.mutate({action:"status",id:taskId,version,status:"completed"}),e=>e.status===409&&e.latest.id===taskId);
  assert.equal(stale.calls.filter(c=>op(c,"rpc")?.[1]==="task_app_mutate").length,1,"never replay a stale mutation");
});

test("compact status responses are opt-in presentation only, never permission or field overrides",()=>{
  const input={action:"status",id:taskId,version,status:"completed",cachedProjection:true};
  assert.equal(validation.validateAction(input)?.cachedProjection,true);
  for(const bad of [{...input,cachedProjection:false},{...input,cachedProjection:"true"},{...input,owner_id:owner},{...input,assigned_to_member_id:taskId},{...input,fields:{status:"completed"}}])assert.equal(validation.validateAction(bad),null);
});

test("stale edit returns latest owned row as conflict, missing row returns 404, no automatic replay",async()=>{
  const f=fixture(call=>op(call,"rpc")?.[1]==="task_app_mutate" ? {data:null,error:null} : call.table==="tasks" ? {data:{...row,title:"Changed elsewhere"},error:null} : normal(call));
  await assert.rejects(()=>f.repo.mutate({action:"update",id:taskId,version,fields}),e=>e.status===409 && e.latest.title==="Changed elsewhere");
  assert.equal(f.calls.filter(c=>op(c,"rpc")).length,3);
  const missing=fixture(call=>call.table==="tasks" ? {data:null,error:null} : normal(call));
  await assert.rejects(()=>missing.repo.mutate({action:"update",id:taskId,version,fields}),e=>e.status===404);
});

test("category creation uses checked workspace RPC without direct table writes",async()=>{
 const f=fixture(()=>({data:{category:{id:catId,name:"Work"}},error:null}));
 assert.equal((await f.repo.mutate({action:"category",name:"Work"})).category.id,catId);
 assert.equal(f.calls.length,1);assert.equal(op(f.calls[0],"rpc")[1],"task_app_setup");assert.equal(op(f.calls[0],"rpc")[2].category_name,"Work");
});

test("setup uses fixed timezone through workspace RPC and reports permission denial",async()=>{
 const f=fixture(()=>({data:{timezone:"Asia/Kolkata"},error:null}));
 assert.equal((await f.repo.mutate({action:"setup",timezone:"Asia/Kolkata"})).timezone,"Asia/Kolkata");
 const forbidden=fixture(()=>({data:null,error:{code:"P0403"}}));await assert.rejects(()=>forbidden.repo.mutate({action:"setup",timezone:"Asia/Kolkata"}),error=>error.status===403);
});

test("bootstrap loads complete workspace categories after atomic server initialization",async()=>{
 const categories=[{id:catId,name:"Sunday Service"}];
 const f=fixture(call=>({data:call.table==="categories"?categories:{timezone:"Asia/Kolkata"},error:null}));
 const result=await f.repo.mutate({action:"bootstrap"});assert.equal(result.categories[0].id,catId);
 assert.equal(f.calls[0].table,"rpc");assert.equal(op(f.calls[0],"rpc")[1],"task_app_setup");
 assert.ok(f.calls.filter(call=>call.table==="categories").every(call=>op(call,"eq")[2]===owner));assert.equal(f.calls.some(call=>op(call,"insert")),false);
});

function routeFixture(signedIn=true,respond=normal) {
  const f=fixture(respond);
  const route=load("../src/app/api/tasks/route.ts",{
    "@/lib/supabase/server":{createClient:async()=>({...f.client,auth:{}})},
    "@/lib/auth/flow":{verifiedIdentity:async()=>signedIn ? {userId:owner} : null},
    "@/lib/auth/server":{authOrigin:()=>"http://127.0.0.1:3003",AUTH_HEADERS:{"Cache-Control":"private, no-store, max-age=0"}},
    "@/lib/tasks/repository":repository,"@/lib/tasks/validation":validation,
    "@/lib/members/server":{readMembers:async()=>({current:{id:"fixture-member",role:"owner"},workspace:{ownerId:owner}}),MemberError:class extends Error{}},
  });return {...f,route};
}
const request=(body,origin="http://127.0.0.1:3003",type="application/json")=>new Request("http://127.0.0.1:3003/api/tasks",{
  method:"POST",headers:{origin,"Content-Type":type},body:typeof body==="string" ? body : JSON.stringify(body),
});
test("API rejects origin, media type, oversized/malformed JSON and invalid writes before any query",async()=>{
  const f=routeFixture();
  for(const [req,status] of [[request({action:"bootstrap"},"https://example.org"),403],
    [request({},undefined,"text/plain"),415],[request("x".repeat(393217)),413],
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
    "@/lib/members/server":{readMembers:async()=>({current:null}),MemberError:class extends Error{}},
  });
  const response=await GET();assert.equal(response.status,503);
  assert.equal((await response.text()).includes('fixture-private-provider-details'),false);
});


test("weekdays round-trip as independent labels; invalid arrays cannot be saved",()=>{
  for(const days of [[],[0],[0,2,6],[0,1,2,3,4,5,6]]) {
    const input=validation.validateAction({action:"create",fields:{...fields,weekdays:days}});
    assert.ok(input);
    const mapped=model.mapTask(validation.decodeRow({...row,...input.fields}),[]);
    assert.deepEqual([...mapped.weekdays],days);
    assert.deepEqual([...model.taskFields(mapped,[]).weekdays],days);
    assert.equal(mapped.date,"");assert.equal(mapped.repeat,"Off");
  }
  for(const weekdays of [null,undefined,"Sunday",[0,0],[-1],[7],[1.5],["1"],[[0]],[0,1,2,3,4,5,6,6]])
    { assert.equal(validation.validateAction({action:"create",fields:{...fields,weekdays}}),null);
      assert.throws(()=>validation.decodeRow({...row,weekdays})); }
});

test("bulk payload validates every independent task, bounds count, common category and active status",()=>{
  const input=validation.validateAction({action:"create_many",fields:[{...fields,title:"  First  ",notes:"Independent note",weekdays:[0,3]}, {...fields,title:"Second",priority:"high"}]});
  assert.equal(input.fields[0].title,"First");assert.equal(input.fields[1].notes,null);
  assert.ok(validation.validateAction({action:"create_many",fields:Array.from({length:20},()=>fields)}));
  for(const list of [[],Array.from({length:21},()=>fields),[fields,{...fields,title:" "}],[fields,{...fields,owner_id:owner}],[fields,{...fields,status:"completed"}],[fields,{...fields,category_id:catId}],[fields,{...fields,due_time:"09:00"}]])
    assert.equal(validation.validateAction({action:"create_many",fields:list}),null);
  assert.equal(validation.validateAction({action:"create_many",fields:[fields],owner_id:owner}),null);
});

test("bulk save uses one checked atomic RPC, rejects partial confirmations without replay",async()=>{
 const drafts=[{...fields,title:"First",notes:"One"},{...fields,title:"Second",notes:"Two",weekdays:[1,4]}];
 const rows=drafts.map((field,i)=>({...row,...field,id:i?catId:taskId}));
 const f=fixture(()=>({data:rows,error:null}));const result=await f.repo.mutate({action:"create_many",fields:drafts});
 assert.equal(result.tasks.length,2);assert.equal(result.tasks[1].notes,"Two");assert.equal(f.calls.length,1);assert.equal(op(f.calls[0],"rpc")[2].task_fields,drafts);
 for(const response of [{data:[rows[0]],error:null},{data:null,error:{code:"23503"}}]){const bad=fixture(()=>response);await assert.rejects(()=>bad.repo.mutate({action:"create_many",fields:drafts}));assert.equal(bad.calls.length,1);}
});

test("delete marks the retained row and checks original owner/version; all task reads and writes exclude deleted rows",async()=>{
  assert.ok(validation.validateAction({action:"delete",id:taskId,version}));
  for(const extra of [{version:"invalid"},{owner_id:owner},{deleted_at:version}])
    assert.equal(validation.validateAction({action:"delete",id:taskId,version,...extra}),null);
  const f=fixture(call=>op(call,"rpc")?{data:{...row,deleted_at:version},error:null}:normal(call));
  assert.equal((await f.repo.mutate({action:"delete",id:taskId,version})).deleted,taskId);
  const args=op(f.calls.find(call=>op(call,"rpc")),"rpc")[2];
  assert.equal(args.task_id,taskId);assert.equal(args.expected_version,version);
  assert.equal(args.operation,"delete");assert.equal(args.fields,null);
  const reads=fixture(normal);await reads.repo.read();
  for(const call of reads.calls.filter(call=>call.table==="tasks"))assert.deepEqual(op(call,"is"),["is","deleted_at",null]);
  for(const action of ["delete","update","status"]) {
    const missing=fixture(call=>call.table==="tasks"?{data:null,error:null}:normal(call));
    await assert.rejects(()=>missing.repo.mutate({action,id:taskId,version,fields,status:"active"}),error=>error.status===404);
    for(const call of missing.calls.filter(call=>call.table==="tasks"))assert.deepEqual(op(call,"is"),["is","deleted_at",null]);
    assert.equal(missing.calls.filter(call=>op(call,"rpc")).length,1);
  }
});

test("stale delete preserves task and reports saved version for review",async()=>{
  const f=fixture(call=>op(call,"rpc")?.[1]==="task_app_mutate"?{data:null,error:null}:call.table==="tasks"?{data:{...row,title:"New saved title"},error:null}:normal(call));
  await assert.rejects(()=>f.repo.mutate({action:"delete",id:taskId,version}),error=>error.status===409&&error.latest.title==="New saved title");
  assert.equal(f.calls.filter(call=>op(call,"rpc")).length,3);
});

test("new task actions still require authenticated same-origin requests; meeting presets keep approved order",async()=>{
  const anon=routeFixture(false);
  for(const body of [{action:"create_many",fields:[fields]},{action:"delete",id:taskId,version}]) {
    assert.equal((await anon.route.POST(request(body))).status,401);
    const signedIn=routeFixture();assert.equal((await signedIn.route.POST(request(body,"https://example.org"))).status,403);
    assert.equal(signedIn.calls.length,0);
  }
  assert.equal(anon.calls.length,0);
  const ordered=model.categoryOrder(["Z custom",...model.MEETING_CATEGORIES].reverse());
  assert.deepEqual([...ordered],[...model.MEETING_CATEGORIES,"Z custom"]);
});

test("repeat validation requires dates and selected matching weekly days; managed metadata is denied",()=>{
  const weekly={...fields,due_date:"2026-10-11",weekdays:[0,3],repeat_rule:"weekly"};
  assert.ok(validation.validateAction({action:"create",fields:weekly}));
  for(const extra of [{due_date:null},{weekdays:[]},{weekdays:[1]},{repeat_rule:"yearly"},{series_id:taskId},{history_at:version},{repeat_anchor_day:31}])
    assert.equal(validation.validateAction({action:"create",fields:{...weekly,...extra}}),null);
  assert.ok(validation.validateAction({action:"update",id:taskId,version,fields:weekly,scope:"future"}));
  assert.equal(validation.validateAction({action:"update",id:taskId,version,fields:weekly,scope:"everyone"}),null);
});

test("History boundary hides only completed archived tasks and preserves active reopened occurrences",()=>{
  const task={...model.blankTask(),completed:true,historyAt:"2026-10-18T04:30:00Z"};
  const filters={view:"All tasks",status:"All",priority:"Any",category:"Any",search:""};
  const before=new Date("2026-10-18T04:29:59Z"),due=new Date("2026-10-18T04:30:00Z");
  assert.ok(model.matchesTask(task,filters,"2026-10-18","10:00:00",before));
  assert.equal(model.matchesTask(task,filters,"2026-10-18","10:00:00",due),false);
  assert.ok(model.matchesTask(task,{...filters,view:"History"},"2026-10-18","10:00:00",due));
  assert.ok(model.matchesTask({...task,completed:false},filters,"2026-10-18","10:00:00",due));
  assert.equal(model.inHistory({...task,historyAt:null},due),false);
});


test("successful Bin move with no remaining live series version returns200 instead of a false503",async()=>{
  for(const repeat of [false,true]) {
    const deletedRow={...row,deleted_at:version,series_version:null,
      ...(repeat?{due_date:"2026-10-13",repeat_rule:"daily",series_id:catId}:{} )};
    const f=routeFixture(true,call=>op(call,"rpc")?{data:deletedRow,error:null}:normal(call));
    const response=await f.route.POST(request({action:"delete",id:taskId,version}));
    assert.equal(response.status,200);
    assert.equal((await response.json()).deleted,taskId);
    assert.equal(f.calls.filter(call=>op(call,"rpc")).length,1);
    assert.match(response.headers.get("cache-control"),/private, no-store/);
  }
});


test("Bin acknowledgement rejects unconfirmed rows and keeps live task version validation strict",async()=>{
  for(const extra of [{id:catId},{deleted_at:null},{deleted_at:"invalid"},{series_version:"invalid"},{status:"completed"}]) {
    const f=routeFixture(true,call=>op(call,"rpc")?{data:{...row,deleted_at:version,series_version:null,...extra},error:null}:normal(call));
    const response=await f.route.POST(request({action:"delete",id:taskId,version}));
    assert.equal(response.status,503);
    assert.equal(f.calls.filter(call=>op(call,"rpc")).length,1);
  }
  assert.throws(()=>validation.decodeRow({...row,series_version:null}));
  const f=routeFixture(true,call=>op(call,"rpc")?{data:{...row,series_version:null},error:null}:normal(call));
  assert.equal((await f.route.POST(request({action:"status",id:taskId,version,status:"active"}))).status,503);
});

test("completion author reads use the current scoped profile name, including retained former profiles, without rewriting task rows",async()=>{
 const done={...row,status:'completed',completed_at:version,completed_by_member_id:taskId,completed_by_name:'Old name'};
 const f=fixture(call=>call.table==='tasks'?{data:[done],error:null}:op(call,'rpc')?.[1]==='task_app_member_names'?{data:[{id:taskId,name:'Current name'}],error:null}:normal(call));
 const result=await f.repo.read();assert.equal(result.tasks[0].completed_by_name,'Current name');assert.equal(done.completed_by_name,'Old name');assert.equal(result.tasks[0].updated_at,version);
 const nameRead=f.calls.find(call=>op(call,'rpc')?.[1]==='task_app_member_names');assert.equal(op(nameRead,'rpc')[2],undefined);assert.equal(f.calls.some(call=>call.table==='account_members'),false);
 const broken=fixture(call=>op(call,'rpc')?.[1]==='task_app_member_names'?{data:[{id:taskId,name:'One'},{id:taskId,name:'Two'}],error:null}:normal(call));await assert.rejects(()=>broken.repo.read());
});

test('reassignment duration is independent of calendar scope and rejects injected or incomplete permanent saves',()=>{
  const input={action:'update',id:taskId,version,fields:{...fields,due_date:'2026-10-18',repeat_rule:'daily'},scope:'this',assignmentScope:'future',seriesVersion:version};
  assert.equal(validation.validateAction(input).assignmentScope,'future');
  assert.equal(validation.validateAction({...input,scope:'future',assignmentScope:'this'}).assignmentScope,'this');
  for(const patch of [{assignmentScope:'permanent'},{assignmentScope:true},{seriesVersion:undefined},{fields:{...input.fields,repeat_rule:'off'}},{fields:{...input.fields,assigned_to_member_id:null}},{owner_id:owner}])assert.equal(validation.validateAction({...input,...patch}),null);
  assert.equal(validation.validateAction({action:'status',id:taskId,version,status:'completed',assignmentScope:'future'}),null);
});
test('only explicit permanent assignment uses the atomic RPC; calendar future and one occurrence keep original path',async()=>{
  for(const [assignmentScope,scope,rpcName]of [['future','this','task_app_reassign_permanently'],['this','future','task_app_mutate'],[undefined,'future','task_app_mutate']]){
    const f=fixture(call=>call.table==='rpc'&&op(call,'rpc')[1]===rpcName?{data:row,error:null}:normal(call));
    await f.repo.mutate({action:'update',id:taskId,version,fields,scope,assignmentScope,seriesVersion:version});
    const args=op(f.calls[0],'rpc');assert.equal(args[1],rpcName);assert.equal(args[2].edit_scope,scope);assert.equal(args[2].expected_series_version,version);assert.equal(args[2].fields.assigned_to_member_id,taskId);assert.equal('owner_id'in args[2],false);assert.equal('role'in args[2],false);
  }
});
test('failed permanent reassignment never falls back to an occurrence-only partial save',async()=>{
  const f=fixture(()=>({data:null,error:{code:'P0403'}}));
  await assert.rejects(f.repo.mutate({action:'update',id:taskId,version,fields,assignmentScope:'future',seriesVersion:version}),error=>error.status===403);
  assert.equal(f.calls.length,1);assert.equal(op(f.calls[0],'rpc')[1],'task_app_reassign_permanently');
});

test('task reads begin together after catch-up, without waiting for the task page',async()=>{
 let release,finishTasks;
 const releaseGate=new Promise(resolve=>{release=resolve;}),taskGate=new Promise(resolve=>{finishTasks=resolve;});
 const f=fixture(call=>op(call,'rpc')?.[1]==='task_app_release_my_repeats'?releaseGate:call.table==='tasks'?taskGate:normal(call));
 const result=f.repo.read();await new Promise(setImmediate);
 assert.equal(f.calls.length,1);assert.equal(op(f.calls[0],'rpc')[1],'task_app_release_my_repeats');
 release({data:null,error:null});await new Promise(setImmediate);
 assert.ok(f.calls.some(call=>op(call,'rpc')?.[1]==='task_app_available_coverage'));
 assert.ok(f.calls.some(call=>op(call,'rpc')?.[1]==='task_app_coverage_origins'));
 finishTasks({data:[],error:null});assert.equal((await result).tasks.length,0);
});

test('saved task mapping reuses unchanged data and refreshes after task/category edits',()=>{
 let stateIndex=0,memoIndex=0;
 const memos=[],states=[{timezone:'Asia/Kolkata',tasks:[{...row,category_id:catId}],categories:[{id:catId,name:'Healing Meeting'}]}];
 const react={useCallback:fn=>fn,useEffect(){},useRef:value=>({current:value}),useState(value){const i=stateIndex++;if(!(i in states))states[i]=value;return[states[i],next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useMemo(factory,deps){const i=memoIndex++,old=memos[i];if(!old||deps.some((v,n)=>!Object.is(v,old.deps[n])))memos[i]={deps,value:factory()};return memos[i].value;}};
 const hook=load('../src/lib/tasks/use-saved-tasks.ts',{'react':react,'./model':model,'./validation':validation,'./completed':completed,'./confirmed-state':confirmedState});
 const render=()=>{stateIndex=0;memoIndex=0;return hook.useSavedTasks(true,false);};
 const first=render();assert.equal(first.tasks[0].category,'Healing Meeting');
 assert.equal(render().tasks,first.tasks);
 states[0]={...states[0],tasks:[{...states[0].tasks[0],title:'Updated task'}]};
 const changed=render();assert.notEqual(changed.tasks,first.tasks);assert.equal(changed.tasks[0].title,'Updated task');
 states[0]={...states[0],categories:[{id:catId,name:'Special Meeting'}]};
 const renamed=render();assert.equal(renamed.tasks[0].category,'Special Meeting');assert.notEqual(renamed.tasks,changed.tasks);
});

test('reused clock formatters preserve zone boundaries, DST and independent results',()=>{
 let constructors=0;
 const CountingFormatter=new Proxy(Intl.DateTimeFormat,{construct(target,args){constructors++;return Reflect.construct(target,args);}});
 const cached=load('../src/lib/tasks/model.ts',{}, {Intl:{DateTimeFormat:CountingFormatter}});
 const reference=(now,timezone)=>{const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(now);const part=name=>parts.find(p=>p.type===name).value;return{date:`${part('year')}-${part('month')}-${part('day')}`,time:`${part('hour')}:${part('minute')}:${part('second')}`};};
 const zones=['Asia/Kolkata','UTC','America/New_York'];
 const instants=['2026-10-17T18:29:59Z','2026-10-17T18:30:00Z','2026-03-08T06:59:59Z','2026-03-08T07:00:00Z','2026-11-01T05:59:59Z','2026-11-01T06:00:00Z','2028-02-29T00:00:00Z'];
 for(const zone of zones)for(const value of instants){const now=new Date(value);assert.deepEqual({...cached.accountClock(now,zone)},reference(now,zone));}
 assert.equal(constructors,zones.length);
 const value=cached.accountClock(new Date(instants[0]),zones[0]);value.date='Changed locally';assert.notEqual(cached.accountClock(new Date(instants[0]),zones[0]).date,value.date);
 assert.throws(()=>cached.accountClock(new Date(), 'Not/A_Zone'));
 assert.throws(()=>cached.accountClock(new Date('invalid'),'UTC'));
});

test('category creation accepts only the four supported canonical meeting names',()=>{
 for(const name of model.MEETING_CATEGORIES)assert.equal(validation.validateAction({action:'category',name:' '+name+' '}).name,name);
 for(const name of ['Work','Youth Meeting',"Woman’s Meeting",'sunday service','',null,123,'Sunday Service\nExtra'])assert.equal(validation.validateAction({action:'category',name}),null);
 assert.equal(validation.validateAction({action:'category',name:'Sunday Service',owner_id:owner}),null);
});
