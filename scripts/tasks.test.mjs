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
const repository=load("../src/lib/tasks/repository.ts",{"./validation":validation,"./model":model});
const owner="00000000-0000-4000-8000-000000000001";
const taskId="00000000-0000-4000-8000-000000000010";
const catId="00000000-0000-4000-8000-000000000020";
const version="2026-10-12T09:00:00.000000+00:00";
const fields={title:"A task",notes:null,status:"active",due_date:null,due_time:null,priority:"none",category_id:null,weekdays:[]};
const row={...fields,id:taskId,created_at:version,updated_at:version,completed_at:null};
function fixture(respond) {
  const calls=[];
  const client={rpc(name,args){const call={table:"rpc",ops:[["rpc",name,args]]};calls.push(call);return Promise.resolve().then(()=>respond(call,calls));},from(table){
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
const normal=call=>({data:call.table==="account_settings" ? {timezone:"Asia/Kolkata"} : call.table==="rpc" ? null : [],error:null});

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

test("paged reads release only the session owner's due repeats, load beyond 500 rows, and keep owner filters",async()=>{
  const rows=Array.from({length:501},(_,i)=>({...row,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`}));
  const f=fixture(call=>{
    if(call.table!=="tasks") return normal(call);
    return {data:op(call,"gt") ? rows.slice(500) : rows.slice(0,500),error:null};
  });
  const data=await f.repo.read();assert.equal(data.tasks.length,501);
  for(const call of f.calls) {
    if(call.table==="rpc") {assert.equal(op(call,"rpc")[1],"task_app_release_my_repeats");assert.equal(op(call,"rpc")[2],undefined);continue;}
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
    const react={useCallback:fn=>fn,useRef:value=>({current:value}),useEffect:fn=>effects.push(fn),
      useState:value=>[stateIndex++===0?{timezone:"Asia/Kolkata",tasks:[],categories:[]}:stateIndex===6?true:value,()=>{}]};
    const window={addEventListener(){},removeEventListener(){},setTimeout(fn,delay){timers.set(++timerId,{fn,delay});return timerId;},clearTimeout(id){timers.delete(id);}};
    const document={visibilityState:"visible",addEventListener(){},removeEventListener(){}};
    const hook=load("../src/lib/tasks/use-saved-tasks.ts",{"react":react,"./model":model,"./validation":validation},
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

test("create returns committed row and sends only allowed fields",async()=>{
  const f=fixture(call=>op(call,"insert") ? {data:row,error:null} : normal(call));
  const result=await f.repo.mutate({action:"create",fields});assert.equal(result.task.id,taskId);
  const insert=f.calls.find(c=>op(c,"insert"));assert.equal(insert.table,"tasks");
  assert.equal("owner_id" in op(insert,"insert")[1],false);assert.ok(op(insert,"select"));
  const bad=fixture(call=>op(call,"insert") ? {data:null,error:null} : normal(call));
  await assert.rejects(()=>bad.repo.mutate({action:"create",fields}));
});

test("status uses the atomic owner-checked RPC with original task/version",async()=>{
  const done={...row,status:"completed",completed_at:version};
  const f=fixture(call=>op(call,"rpc") ? {data:done,error:null} : normal(call));
  await f.repo.mutate({action:"status",id:taskId,version,status:"completed"});
  const args=op(f.calls.find(c=>op(c,"rpc")),"rpc")[2];
  assert.equal(args.task_id,taskId);assert.equal(args.expected_version,version);
  assert.equal(args.operation,"status");assert.equal(args.new_status,"completed");
  assert.equal(args.fields,null);assert.equal(args.edit_scope,"this");
  assert.equal("owner_id" in args,false);
});

test("stale edit returns latest owned row as conflict, missing row returns 404, no automatic replay",async()=>{
  const f=fixture(call=>op(call,"rpc") ? {data:null,error:null} : call.table==="tasks" ? {data:{...row,title:"Changed elsewhere"},error:null} : normal(call));
  await assert.rejects(()=>f.repo.mutate({action:"update",id:taskId,version,fields}),e=>e.status===409 && e.latest.title==="Changed elsewhere");
  assert.equal(f.calls.filter(c=>op(c,"rpc")).length,1);
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
  assert.equal(inserts,5);assert.equal(categories.length,6);
  assert.equal(f.calls.some(c=>c.table==="tasks"),false);
});

function routeFixture(signedIn=true) {
  const f=fixture(normal);
  const route=load("../src/app/api/tasks/route.ts",{
    "@/lib/supabase/server":{createClient:async()=>({...f.client,auth:{}})},
    "@/lib/auth/flow":{verifiedIdentity:async()=>signedIn ? {userId:owner} : null},
    "@/lib/auth/server":{authOrigin:()=>"http://127.0.0.1:3003",AUTH_HEADERS:{"Cache-Control":"private, no-store, max-age=0"}},
    "@/lib/tasks/repository":repository,"@/lib/tasks/validation":validation,
    "@/lib/members/server":{readMembers:async()=>({current:{id:"fixture-member"}}),MemberError:class extends Error{}},
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

test("bulk save uses one atomic array insert and returns all committed rows, without per-row retries",async()=>{
  const drafts=[{...fields,title:"First",notes:"One"},{...fields,title:"Second",notes:"Two",weekdays:[1,4]}];
  const rows=drafts.map((field,i)=>({...row,...field,id:i?catId:taskId}));
  const f=fixture(call=>op(call,"insert")?{data:rows,error:null}:normal(call));
  const result=await f.repo.mutate({action:"create_many",fields:drafts});
  assert.equal(result.tasks.length,2);assert.equal(result.tasks[1].notes,"Two");
  const inserts=f.calls.filter(call=>op(call,"insert"));assert.equal(inserts.length,1);
  assert.equal(op(inserts[0],"insert")[1],drafts);
  for(const response of [{data:[rows[0]],error:null},{data:null,error:{code:"23503"}}]) {
    const bad=fixture(call=>op(call,"insert")?response:normal(call));
    await assert.rejects(()=>bad.repo.mutate({action:"create_many",fields:drafts}));
    assert.equal(bad.calls.filter(call=>op(call,"insert")).length,1);
  }
});

test("delete marks the retained row and checks original owner/version; all task reads and writes exclude deleted rows",async()=>{
  assert.ok(validation.validateAction({action:"delete",id:taskId,version}));
  for(const extra of [{version:"invalid"},{owner_id:owner},{deleted_at:version}])
    assert.equal(validation.validateAction({action:"delete",id:taskId,version,...extra}),null);
  const f=fixture(call=>op(call,"rpc")?{data:row,error:null}:normal(call));
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
  const f=fixture(call=>op(call,"rpc")?{data:null,error:null}:call.table==="tasks"?{data:{...row,title:"New saved title"},error:null}:normal(call));
  await assert.rejects(()=>f.repo.mutate({action:"delete",id:taskId,version}),error=>error.status===409&&error.latest.title==="New saved title");
  assert.equal(f.calls.filter(call=>op(call,"rpc")).length,1);
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
