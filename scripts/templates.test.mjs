import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,URL,TextDecoder,Uint8Array,JSON,...globals,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts');
const validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const model=load('../src/lib/templates/model.ts',{'@/lib/tasks/model':tasks,'@/lib/tasks/validation':validation});
const errors=load('../src/lib/tasks/repository.ts',{'./model':tasks,'./validation':validation});
const {TemplateRepository}=load('../src/lib/templates/repository.ts',{'./model':model,'@/lib/tasks/repository':errors});
const id='00000000-0000-4000-8000-000000000901',owner='00000000-0000-4000-8000-000000000001',stamp='2026-10-14T01:00:00.123456+00:00';
const items=Array.from({length:5},(_,i)=>({title:'Task '+(i+1),notes:'Notes '+(i+1)}));
const input={action:'create',id,name:'Sound team setup',items,version:null};
const row={id,name:input.name,items,created_at:stamp,updated_at:stamp};
test('Templates accept only name plus 1–20 titles/notes; reject schedules, owner fields, empty, oversize or invalid versions',()=>{
 assert.equal(model.validateTemplateAction({...input,name:'  Team setup  '}).name,'Team setup');
 assert.ok(model.validateTemplateAction({...input,action:'update',version:stamp}));
 for(const bad of [null,{...input,owner_id:owner},{...input,name:' '},{...input,name:'x'.repeat(101)},{...input,items:[]},{...input,items:Array(21).fill(items[0])},{...input,items:[{title:' ',notes:''}]},{...input,items:[{title:'x'.repeat(201),notes:''}]},{...input,items:[{title:'x',notes:'x'.repeat(4001)}]},{...input,items:[{title:'x',notes:null}]},{...input,items:[{...items[0],repeat:'Weekly'}]},{...input,version:stamp},{...input,action:'update',version:null},{...input,id:'bad'}])assert.equal(model.validateTemplateAction(bad),null);
});
test('Using five entries copies all titles/notes into independent fresh category defaults with no ids or stale schedule',()=>{
 const source=items.map(item=>({...item,date:'2020-01-01',id:owner,completed:true,repeat:'Daily'}));
 const copied=model.templateDrafts(source,'Healing Meeting');assert.equal(copied.length,5);
 for(let i=0;i<5;i++){assert.equal(copied[i].title,items[i].title);assert.equal(copied[i].notes,items[i].notes);assert.equal(copied[i].id,'');assert.equal(copied[i].completed,false);assert.equal(copied[i].date,'');assert.equal(copied[i].time,'23:50');assert.equal(copied[i].repeat,'Weekly');assert.equal(copied[i].category,'Healing Meeting');assert.equal(JSON.stringify(copied[i].weekdays),'[3]');}
 copied[0].title='Independent';copied[0].weekdays.push(5);assert.equal(items[0].title,'Task 1');assert.equal(JSON.stringify(copied[1].weekdays),'[3]');
});
test('Template decoder refuses incomplete, duplicated or corrupt saved sets rather than showing a partial list',()=>{
 assert.equal(model.decodeTemplates({templates:[row]})[0].items.length,5);
 for(const bad of [{templates:[row,row]},{templates:[{...row,items:[]}]},{templates:[{...row,updated_at:'bad'}]},{templates:null}])assert.throws(()=>model.decodeTemplates(bad));
});
function repositoryFixture(respond){const calls=[];const client={rpc:async(name,args)=>{calls.push({name,args});return respond({name,args});},from(table){const ops=[],q={};for(const name of ['select','eq','order','limit','gt'])q[name]=(...args)=>{ops.push([name,...args]);return q;};q.then=(resolve,reject)=>{const call={table,ops};calls.push(call);return Promise.resolve(respond(call)).then(resolve,reject);};return q;}};return {repo:new TemplateRepository(client,owner),calls};}
test('Repository reads every page with owner filter and rejects invalid page ordering',async()=>{
 const rows=Array.from({length:101},(_,i)=>({...row,id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0')}));
 const f=repositoryFixture(c=>({data:c.ops.some(op=>op[0]==='gt')?rows.slice(100):rows.slice(0,100),error:null}));assert.equal((await f.repo.read()).templates.length,101);assert.equal(f.calls.length,2);
 for(const c of f.calls)assert.ok(c.ops.some(op=>op[0]==='eq'&&op[1]==='owner_id'&&op[2]===owner));
 await assert.rejects(()=>repositoryFixture(()=>({data:[row,row],error:null})).repo.read(),e=>e.status===503);
});
test('Template save uses one atomic RPC without caller owner; verifies exact echoed id/name/items and safe conflict errors',async()=>{
 const f=repositoryFixture(()=>({data:row,error:null}));assert.equal((await f.repo.mutate(input)).template.id,id);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'task_app_save_template');assert.equal('owner_id' in f.calls[0].args,false);assert.equal(f.calls[0].args.expected_version,null);
 for(const data of [{...row,id:owner},{...row,items:items.slice(0,4)},{...row,name:'Other'}])await assert.rejects(()=>repositoryFixture(()=>({data,error:null})).repo.mutate(input),e=>e.status===503);
 for(const [code,status] of [['P0013',409],['42501',401],['23514',400],['private-provider-detail',503]])await assert.rejects(()=>repositoryFixture(()=>({data:null,error:{code}})).repo.mutate(input),e=>e.status===status&&!e.message.includes(code));
});
function routeFixture({signedIn=true,selected=true}={}){const calls=[];const route=load('../src/app/api/templates/route.ts',{'@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:owner}:null},'@/lib/auth/server':{authOrigin:()=> 'http://127.0.0.1:3003',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError:class extends Error{},readMembers:async()=>({current:selected?{id,role:"owner"}:null,workspace:selected?{ownerId:owner}:null})},'@/lib/tasks/repository':errors,'@/lib/templates/model':model,'@/lib/templates/repository':{TemplateRepository:class{async read(){calls.push('read');return {templates:[row]};}async mutate(){calls.push('write');return {template:row};}}}});return {route,calls};}
const request=(body,origin='http://127.0.0.1:3003',type='application/json')=>new Request('http://127.0.0.1:3003/api/templates',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});
test('Template routes require verified session/member and same-origin bounded strict JSON before data access',async()=>{
 for(const [options,status] of [[{signedIn:false},401],[{selected:false},403]]){const f=routeFixture(options);assert.equal((await f.route.GET()).status,status);assert.equal((await f.route.POST(request(input))).status,status);assert.equal(f.calls.length,0);}
 const f=routeFixture();for(const [req,status] of [[request(input,'https://other.test'),403],[request(input,undefined,'text/plain'),415],[request('{'),400],[request('x'.repeat(393217)),413],[request({...input,owner_id:owner}),400]])assert.equal((await f.route.POST(req)).status,status);assert.equal(f.calls.length,0);
});
test('Template routes return private no-store complete saved responses',async()=>{const f=routeFixture();const r=await f.route.GET();assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(model.decodeTemplates(await r.json())[0].items.length,5);const saved=await f.route.POST(request(input));assert.equal(saved.status,200);assert.equal(model.decodeTemplate((await saved.json()).template).id,id);});
function hookFixture({dirty=false,responseStatus=200}={}){
 const effects=[],states=[],calls=[];let stateIndex=0;
 const react={useRef:value=>({current:value}),useState:value=>{const index=stateIndex++;states[index]=value;return [value,next=>{states[index]=typeof next==='function'?next(states[index]):next;}];},useEffect:fn=>effects.push(fn),useCallback:fn=>fn};
 const hook=load('../src/lib/templates/use-templates.ts',{'react':react,'./model':model,'@/lib/tasks/validation':validation},{AbortController,AbortSignal,fetch:async(url,init)=>{calls.push({url,init});return {ok:responseStatus===200,status:responseStatus,json:async()=>init.method?{template:row}:{templates:[row]}};}});
 const api=hook.useTemplates(true,dirty);const cleanups=effects.map(fn=>fn());return {api,calls,states,cleanup:()=>cleanups.forEach(fn=>fn?.()),settle:()=>new Promise(setImmediate)};
}
test('Template refresh pauses for dirty drafts; save confirms all entries and no extra task endpoint is called',async()=>{
 const dirty=hookFixture({dirty:true});await dirty.settle();assert.equal(dirty.calls.length,0);dirty.cleanup();
 const f=hookFixture();await f.settle();assert.equal(f.states[1],true);await f.api.save(input);assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1);assert.ok(f.calls.every(call=>call.url==='/api/templates'));assert.equal(f.states[0][0].items.length,5);f.cleanup();
});
test('Template hook keeps an unconfirmed save as an error, never a success',async()=>{const f=hookFixture({responseStatus:503});await f.settle();await assert.rejects(()=>f.api.save(input),e=>e.status===503);assert.equal(f.states[0].length,0);f.cleanup();});
