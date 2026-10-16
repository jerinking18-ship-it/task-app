import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,URL,TextDecoder,Uint8Array,JSON,...globals,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts');const validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const templates=load('../src/lib/templates/model.ts',{'@/lib/tasks/model':tasks,'@/lib/tasks/validation':validation});
const bin=load('../src/lib/tasks/bin.ts',{'./model':tasks,'./validation':validation,'@/lib/templates/model':templates});
const errors=load('../src/lib/tasks/repository.ts',{'./model':tasks,'./validation':validation});
const {TemplateRepository}=load('../src/lib/templates/repository.ts',{'./model':templates,'@/lib/tasks/repository':errors});
const {BinRepository}=load('../src/lib/tasks/bin-repository.ts',{'./bin':bin,'./validation':validation,'./repository':errors,'@/lib/templates/model':templates});
const id='00000000-0000-4000-8000-000000001081',owner='00000000-0000-4000-8000-000000001071',stamp='2026-10-14T04:00:00.123456Z',later='2026-10-14T05:00:00.234567Z';
const row={id,name:'Sound team setup',items:Array.from({length:5},(_,i)=>({title:'Task '+(i+1),notes:i?'Check carefully':'Calibrate piano'})),created_at:stamp,updated_at:stamp};
const removed={...row,updated_at:later,deleted_at:later,deleted_by_name:'Daniel'};
const removal={action:'remove',id,version:stamp,confirmed:true};
const mixed={action:'restore',confirmed:true,items:[{kind:'task',id,version:later},{kind:'template',id,version:later}]};
test('Template removal requires exact id/version/confirmation and never accepts owner, content edits or forged timestamps',()=>{
 assert.ok(templates.validateTemplateMutation(removal));
 for(const bad of [{...removal,confirmed:false},{...removal,confirmed:undefined},{...removal,version:null},{...removal,id:'bad'},{...removal,name:'Hijack'},{...removal,owner_id:owner}])assert.equal(templates.validateTemplateMutation(bad),null);
 assert.throws(()=>templates.decodeTemplate(removed));assert.equal(templates.decodeDeletedTemplate(removed).items.length,5);
 for(const bad of [{...removed,deleted_at:null},{...removed,deleted_by_name:undefined},{...removed,items:[]}])assert.throws(()=>templates.decodeDeletedTemplate(bad));
});
test('Removal acknowledgement requires the exact id and a new version; missing, stale or mismatched responses fail closed',()=>{
 assert.equal(templates.decodeTemplateRemoval({id,updated_at:later,deleted_at:later},removal).id,id);
 for(const bad of [null,{}, {id:owner,updated_at:later,deleted_at:later},{id,updated_at:stamp,deleted_at:later},{id,updated_at:later},{id,updated_at:'bad',deleted_at:later}])assert.throws(()=>templates.decodeTemplateRemoval(bad,removal));
});
test('Typed Bin identities allow same UUID across task/template but reject duplicate identities and invalid kinds',()=>{
 assert.ok(bin.validateBinAction(mixed));assert.notEqual(bin.binKey(mixed.items[0]),bin.binKey(mixed.items[1]));
 for(const bad of [{...mixed,items:[mixed.items[0],mixed.items[0]]},{...mixed,items:[{...mixed.items[1],kind:'wrong'}]},{...mixed,items:[{...mixed.items[1],owner_id:owner}]},{...mixed,confirmed:false}])assert.equal(bin.validateBinAction(bad),null);
 const data=bin.decodeBinResponse({tasks:[],categories:[],templates:[removed]});assert.equal(data.templates[0].title,row.name);assert.equal(data.templates[0].items.length,5);assert.equal(data.templates[0].deletedAt,later);
 for(const bad of [{tasks:[],categories:[]},{tasks:[],categories:[],templates:[removed,removed]},{tasks:[],categories:[],templates:[row]}])assert.throws(()=>bin.decodeBinResponse(bad));
});
test('Mixed Bin acknowledgement must include every exact kind/id once; ids-only and partial replies cannot claim success',()=>{
 assert.equal(bin.confirmBinItems({action:'restore',items:mixed.items.map(({kind,id})=>({kind,id}))},mixed).items.length,2);
 for(const bad of [{action:'restore',ids:[id,id]},{action:'restore',items:[mixed.items[0]]},{action:'restore',items:[mixed.items[0],mixed.items[0]]},{action:'purge',items:mixed.items},{action:'restore',items:[mixed.items[0],{kind:'template',id:owner}]}])assert.throws(()=>bin.confirmBinItems(bad,mixed));
});
test('Template repository removes through one member/version RPC and sanitizes stale/ambiguous errors',async()=>{
 const calls=[];const r=new TemplateRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:{id,updated_at:later,deleted_at:later},error:null};}},owner);
 assert.equal((await r.mutate(removal)).removed.id,id);assert.equal(calls[0].name,'task_app_remove_template');assert.equal(calls[0].args.confirmed,true);assert.equal('owner_id' in calls[0].args,false);
 await assert.rejects(()=>new TemplateRepository({rpc:async()=>({data:null,error:{code:'P0013'}})},owner).mutate(removal),e=>e.status===409);
 await assert.rejects(()=>new TemplateRepository({rpc:async()=>({data:{id},error:null})},owner).mutate(removal),e=>e.status===503);
});
test('Mixed repository actions use one atomic RPC; read failures never return a partial task-only Bin',async()=>{
 const calls=[];const r=new BinRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:{action:'restore',items:mixed.items},error:null};}},owner);
 assert.equal((await r.mutate(mixed)).items.length,2);assert.equal(calls.length,1);assert.equal(calls[0].name,'task_app_bin_items');assert.equal('owner_id' in calls[0].args,false);
 const client={from(){const q={};for(const k of ['select','eq','order','limit','not','gt'])q[k]=()=>q;q.then=resolve=>Promise.resolve({data:[],error:null}).then(resolve);return q;},rpc:async()=>({data:null,error:{code:'unavailable'}})};
 await assert.rejects(()=>new BinRepository(client,owner).read(),e=>e.status===503);
 client.rpc=async()=>({data:[removed],error:null});assert.equal((await new BinRepository(client,owner).read()).templates[0].items.length,5);
});
function hookFixture({status=200,bad=false,blocked=false}={}){const effects=[],states=[],calls=[];let n=0;const react={useRef:v=>({current:v}),useState:v=>{const i=n++;states[i]=v;return [v,next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:fn=>effects.push(fn),useCallback:fn=>fn};const mod=load('../src/lib/templates/use-templates.ts',{'react':react,'./model':templates,'@/lib/tasks/validation':validation},{AbortController,AbortSignal,fetch:async(url,init)=>{calls.push({url,init});return {ok:!init.method||status===200,status:init.method?status:200,json:async()=>!init.method?{templates:[row]}:status!==200?{message:'Could not confirm'}:{removed:bad?{id}:{id,updated_at:later,deleted_at:later}}};}});const api=mod.useTemplates(true,blocked),cleanups=effects.map(fn=>fn());return {api,calls,states,settle:()=>new Promise(setImmediate),close:()=>cleanups.forEach(fn=>fn?.())};}
test('Confirmed template hook removal updates the library only after a complete response and never writes tasks',async()=>{
 const f=hookFixture();await f.settle();await f.api.remove(row);assert.equal(f.states[0].length,0);assert.ok(f.calls.every(c=>c.url==='/api/templates'));const sent=JSON.parse(f.calls.find(c=>c.init.method).init.body);assert.equal(sent.confirmed,true);assert.equal(sent.version,stamp);f.close();
 for(const options of [{status:503},{bad:true}]){const g=hookFixture(options);await g.settle();await assert.rejects(()=>g.api.remove(row));assert.equal(g.states[0].length,1);const attempts=g.calls.length;await assert.rejects(()=>g.api.remove(row));await assert.rejects(()=>g.api.save({action:'update',id,name:row.name,items:row.items,version:stamp}));assert.equal(g.calls.length,attempts);g.close();}
});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const css={default:new Proxy({},{get:(_,key)=>String(key)})};
const drag=load('../src/lib/tasks/use-bin-drag.ts',{'react':React});
const sundayLabel=load('../src/components/sunday-service-label.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'./sunday-service.module.css':css});
const TaskBin=load('../src/components/task-bin.tsx',{'./sunday-service-label':sundayLabel,'./special-meeting-title':{SpecialMeetingLabel:()=>null},'@/lib/tasks/category-display':load('../src/lib/tasks/category-display.ts'),'@/lib/members/display-name':load('../src/lib/members/display-name.ts'),'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/tasks/bin':bin,'@/lib/tasks/model':tasks,'@/lib/tasks/use-bin-drag':drag,'./task-bin.module.css':css}).default;
test('Bin renders tasks and templates in distinct sections, hides selection initially and searches template notes',()=>{
 const deleted=bin.decodeBinResponse({tasks:[],categories:[],templates:[removed]}).templates;
 const task={...tasks.blankTask(),id,title:'A deleted task',deletedAt:later,deletedByName:'Daniel'};
 const render=(search='')=>renderToStaticMarkup(React.createElement(TaskBin,{tasks:[task],templates:deleted,search,now:new Date(later),loaded:true,loading:false,pending:false,error:'',expired:false,needsMember:false,onRefresh(){},async onRestore(){},onPurge(){}}));
 const html=render();assert.ok(html.indexOf('aria-label="Deleted tasks"')<html.indexOf('aria-label="Deleted templates"'));assert.match(html,/Sound team setup/);assert.match(html,/5 tasks/);assert.match(html,/Deleted today/);assert.doesNotMatch(html,/type="checkbox"|Bin selection actions|Permanently delete template/);
 const match=render('Calibrate piano');assert.match(match,/Sound team setup/);assert.doesNotMatch(match,/A deleted task/);
});
function binHookFixture({bad=false}={}){const effects=[],states=[],calls=[];let n=0;const react={useRef:v=>({current:v}),useState:v=>{const i=n++;states[i]=v;return [v,next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:fn=>effects.push(fn),useCallback:fn=>fn};const taskRow={id,title:'Same id task',notes:'Keep this task',status:'active',due_date:null,due_time:null,priority:'low',category_id:null,weekdays:[],repeat_rule:'off',created_at:stamp,updated_at:later,completed_at:null,deleted_at:later,deleted_by_name:'Daniel'};
 const mod=load('../src/lib/tasks/use-bin.ts',{'react':react,'./bin':bin,'./validation':validation},{AbortController,AbortSignal,window:{addEventListener(){},removeEventListener(){}},document:{visibilityState:'visible'},fetch:async(url,init)=>{calls.push({url,init});return {ok:true,status:200,json:async()=>init.method?{action:'restore',items:bad?[]:JSON.parse(init.body).items.map(({kind,id})=>({kind,id}))}:{tasks:[taskRow],categories:[],templates:[removed]}};}});const api=mod.useBin(true,false),cleanups=effects.map(fn=>fn());return {api,states,calls,settle:()=>new Promise(setImmediate),close:()=>cleanups.forEach(fn=>fn?.())};}
test('Bin hook keeps a colliding task when its template is restored, and keeps both on an ambiguous acknowledgement',async()=>{
 for(const bad of [false,true]){const f=binHookFixture({bad});await f.settle();const template=bin.decodeBinResponse({tasks:[],categories:[],templates:[removed]}).templates[0];if(bad)await assert.rejects(()=>f.api.mutate('restore',[template]));else await f.api.mutate('restore',[template]);assert.equal(f.states[0].length,1);assert.equal(f.states[7].length,bad?1:0);f.close();}
});
function removalRoute({signedIn=true,selected=true}={}){let writes=0;const route=load('../src/app/api/templates/route.ts',{'next/server':require('next/server'),'@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:owner}:null},'@/lib/auth/server':{authOrigin:()=> 'https://app.example.test',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError:class extends Error{},readMembers:async()=>({current:selected?{id,role:"owner"}:null,workspace:selected?{ownerId:owner}:null})},'@/lib/tasks/repository':errors,'@/lib/templates/model':templates,'@/lib/templates/repository':{TemplateRepository:class{async mutate(input){writes++;return {removed:{id:input.id,updated_at:later,deleted_at:later}};}}}});return {route,writes:()=>writes};}
const removeRequest=(body=removal,origin='https://app.example.test')=>new Request('https://app.example.test/api/templates',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('Template removal API checks session/member/origin/explicit confirmation before the only write',async()=>{
 for(const [opts,status] of [[{signedIn:false},401],[{selected:false},403]]){const f=removalRoute(opts);assert.equal((await f.route.POST(removeRequest())).status,status);assert.equal(f.writes(),0);}
 const f=removalRoute();assert.equal((await f.route.POST(removeRequest(removal,'https://foreign.test'))).status,403);assert.equal((await f.route.POST(removeRequest({...removal,confirmed:false}))).status,400);assert.equal(f.writes(),0);const response=await f.route.POST(removeRequest());assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal((await response.json()).removed.id,id);assert.equal(f.writes(),1);
});

test('task and template Bin deletion authors use current identity names without replacing saved attribution',()=>{
 const task={...tasks.blankTask(),id,title:'Deleted sound notes',deletedAt:later,deletedById:owner,deletedByName:'Old owner'};
 const template={kind:'template',id:owner,title:'Saved team set',notes:'',items:[{title:'Setup',notes:''}],updatedAt:later,deletedAt:later,deletedById:owner,deletedByName:'Old owner'};
 const html=renderToStaticMarkup(React.createElement(TaskBin,{members:[{id:owner,name:'Current owner'}],tasks:[task],templates:[template],search:'',now:new Date(later),loaded:true,loading:false,pending:false,error:'',expired:false,needsMember:false,onRefresh(){},async onRestore(){},onPurge(){}}));
 assert.equal((html.match(/by Current owner/g)||[]).length,2);assert.doesNotMatch(html,/by Old owner/);
 assert.equal(task.deletedByName,'Old owner');assert.equal(template.deletedByName,'Old owner');
});
