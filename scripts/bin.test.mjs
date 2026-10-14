import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,URL,TextDecoder,Uint8Array,...globals,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts');const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const templateModel=load('../src/lib/templates/model.ts',{'@/lib/tasks/model':model,'@/lib/tasks/validation':validation});
const bin=load('../src/lib/tasks/bin.ts',{'./model':model,'./validation':validation,'@/lib/templates/model':templateModel});
const repo=load('../src/lib/tasks/repository.ts',{'./model':model,'./validation':validation});
const {BinRepository}=load('../src/lib/tasks/bin-repository.ts',{'./bin':bin,'./validation':validation,'./repository':repo,'@/lib/templates/model':templateModel});
const id='00000000-0000-4000-8000-000000000091',owner='00000000-0000-4000-8000-000000000001',stamp='2026-10-13T07:25:00.123456+00:00';
const row={id,title:'Example task',notes:'Notes remain',status:'completed',due_date:'2026-10-13',due_time:'12:55:00',priority:'high',category_id:null,weekdays:[2],repeat_rule:'off',series_id:null,created_at:stamp,updated_at:stamp,completed_at:stamp,completed_by_member_id:id,completed_by_name:'Example',deleted_at:stamp,deleted_by_name:'Example'};
const action={action:'purge',confirmed:true,items:[{id,version:stamp}]};
test('Bin action requires explicit confirmation, unique bounded versioned selections and rejects extra owner/metadata fields',()=>{
 assert.ok(bin.validateBinAction(action));assert.ok(bin.validateBinAction({...action,action:'restore'}));assert.equal(bin.validateBinAction({...action,action:'move'}),null);
 for(const value of [{...action,confirmed:false},{...action,confirmed:undefined},{...action,action:'delete'},{...action,owner_id:owner},{...action,items:[]},{...action,items:[action.items[0],action.items[0]]},{...action,items:[{id,version:'bad'}]},{...action,items:[{id,version:stamp,owner_id:owner}]},{...action,items:Array.from({length:1001},(_,i)=>({id:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,version:stamp}))}])assert.equal(bin.validateBinAction(value),null);
});
test('Bin response keeps deleted/completed metadata and rejects live, malformed, duplicate and missing-join records',()=>{
 const result=bin.decodeBinResponse({tasks:[row],categories:[],templates:[]});assert.equal(result.tasks[0].deletedAt,stamp);assert.equal(result.tasks[0].completedByName,'Example');assert.equal(result.tasks[0].notes,'Notes remain');assert.equal(result.tasks[0].time,'12:55');
 for(const value of [{tasks:[{...row,deleted_at:null}],categories:[],templates:[]},{tasks:[{...row,deleted_by_name:undefined}],categories:[],templates:[]},{tasks:[row,row],categories:[],templates:[]},{tasks:[{...row,category_id:id}],categories:[],templates:[]},{tasks:[{...row,deleted_at:'bad'}],categories:[],templates:[]},{tasks:[],categories:null}])assert.throws(()=>bin.decodeBinResponse(value));
});
test('Deletion label uses actual India time and local midnight age boundaries',()=>{
 assert.equal(bin.deletionLabel('2026-10-13T07:25:00Z',new Date('2026-10-13T08:00:00Z')),'Deleted today · 12:55 PM');
 assert.equal(bin.deletionLabel('2026-10-12T18:29:59Z',new Date('2026-10-12T18:30:00Z')),'Deleted yesterday · 11:59 PM');
 assert.equal(bin.deletionLabel('2026-10-13T07:25:00Z',new Date('2026-10-16T07:25:00Z')),'Deleted 3 days ago · 12:55 PM');assert.equal(bin.deletionLabel('bad'),'Deletion time unavailable');
});
function repositoryFixture(respond){const calls=[];return {calls,repo:new BinRepository({rpc(name,args){calls.push({name,args});return name==='task_app_deleted_templates'?{data:[],error:null}:respond({name,args});},from(table){const ops=[];const q={};for(const method of ['select','eq','not','order','limit','gt'])q[method]=(...args)=>{ops.push([method,...args]);return q;};q.then=(resolve,reject)=>Promise.resolve(respond({table,ops})).then(resolve,reject);calls.push({table,ops});return q;}},owner)};}
test('Bin reads are owner-scoped, exclude live tasks and page completely past500 without partial acceptance',async()=>{
 const rows=Array.from({length:501},(_,i)=>({...row,id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`}));
 const f=repositoryFixture(c=>({data:c.table==='categories'?[]:c.ops.some(o=>o[0]==='gt')?rows.slice(500):rows.slice(0,500),error:null}));
 const result=await f.repo.read();assert.equal(result.tasks.length,501);
 for(const c of f.calls.filter(c=>c.table)){assert.ok(c.ops.some(o=>o[0]==='eq'&&o[1]==='owner_id'&&o[2]===owner));if(c.table==='tasks')assert.ok(c.ops.some(o=>o[0]==='not'&&o[1]==='deleted_at'&&o[2]==='is'&&o[3]===null));}
 const broken=repositoryFixture(()=>({data:null,error:{code:'provider-private'}}));await assert.rejects(()=>broken.repo.read(),e=>e.status===503&&!e.message.includes('provider-private'));
});
test('Bin mutations use one atomic RPC and verify exact affected ids; stale/foreign selections get safe409',async()=>{
 const f=repositoryFixture(c=>({data:{action:c.args.operation,ids:[id]},error:null}));assert.equal((await f.repo.mutate(action)).ids[0],id);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'task_app_bin');assert.equal(f.calls[0].args.confirmed,true);
 for(const data of [null,{action:'restore',ids:[id]},{action:'purge',ids:[]},{action:'purge',ids:[owner]}])await assert.rejects(()=>repositoryFixture(()=>({data,error:null})).repo.mutate(action),e=>e.status===503);
 await assert.rejects(()=>repositoryFixture(()=>({data:null,error:{code:'P0012'}})).repo.mutate(action),e=>e.status===409);
});
function routeFixture({signedIn=true,selected=true}={}){let reads=0,writes=0;const route=load('../src/app/api/bin/route.ts',{
 '@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:owner}:null},'@/lib/auth/server':{authOrigin:()=> 'http://127.0.0.1:3003',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError:class extends Error{},readMembers:async()=>({current:selected?{id,role:"owner"}:null,workspace:selected?{ownerId:owner}:null})},'@/lib/tasks/repository':repo,'@/lib/tasks/bin':bin,'@/lib/tasks/bin-repository':{BinRepository:class{async read(){reads++;return {tasks:[row],categories:[],templates:[]};}async mutate(input){writes++;return {action:input.action,ids:input.items.map(i=>i.id)};}}}});return {route,counts:()=>({reads,writes})};}
function request(body,origin='http://127.0.0.1:3003',type='application/json'){return new Request('http://127.0.0.1:3003/api/bin',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});}
test('Bin API rejects anonymous/unselected/cross-origin/malformed/oversize actions without data access',async()=>{
 for(const [options,status] of [[{signedIn:false},401],[{selected:false},403]]){const f=routeFixture(options);assert.equal((await f.route.GET()).status,status);assert.equal((await f.route.POST(request(action))).status,status);assert.equal(f.counts().reads+f.counts().writes,0);}
 const f=routeFixture();for(const [req,status] of [[request(action,'https://other.test'),403],[request(action,undefined,'text/plain'),415],[request('{'),400],[request('x'.repeat(196609)),413],[request({...action,confirmed:false}),400]])assert.equal((await f.route.POST(req)).status,status);assert.equal(f.counts().reads+f.counts().writes,0);
});
test('Bin API sends complete private no-store payloads the browser can decode and exact mutation confirmations',async()=>{
 const f=routeFixture();const response=await f.route.GET();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(bin.decodeBinResponse(await response.json()).tasks[0].title,row.title);
 const changed=await f.route.POST(request(action));assert.equal(changed.status,200);assert.equal((await changed.json()).ids[0],id);assert.equal(f.counts().writes,1);
});
function dragFixture({selectionOnly=false}={}) {
 const states=[],effects=[],timers=new Map(),events={window:new Map(),document:new Map()};let seq=0,stateIndex=0,drops=0,opens=0,holds=0;
 const react={useCallback:fn=>fn,useRef:value=>({current:value}),useState:value=>{const index=stateIndex++;states[index]=value;return [value,next=>{states[index]=next;}];},useEffect:fn=>effects.push(fn)};
 const surface=name=>({addEventListener:(key,fn)=>events[name].set(key,fn),removeEventListener:key=>events[name].delete(key)});
 const mod=load('../src/lib/tasks/use-bin-drag.ts',{'react':react},{window:surface('window'),document:surface('document'),setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:key=>timers.delete(key)});
 const api=mod.useBinDrag({current:selectionOnly?null:{getBoundingClientRect:()=>({left:100,right:150,top:100,bottom:150})}},false,()=>drops++,()=>opens++,selectionOnly?()=>holds++:undefined);
 effects.forEach(fn=>fn());
 const captured=new Set();const element={dataset:{},setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)};
 const event=(x,y,kind='mouse')=>({pointerId:1,pointerType:kind,button:0,currentTarget:element,clientX:x,clientY:y,preventDefault(){}});
 const touch=(x,y)=>({identifier:1,clientX:x,clientY:y});
 return {api,event,element,touch,events,timers,hold:()=>[...timers.values()][0](),drops:()=>drops,opens:()=>opens,holds:()=>holds,state:()=>states[0],held:()=>states[1]};
}
test('Short click opens editor; hold and release offers options without opening or moving',()=>{
 const f=dragFixture(),task=model.blankTask(),h=f.api.handle(task);
 h.onPointerDown(f.event(5,5));h.onPointerUp(f.event(5,5));h.onClick({preventDefault(){}});assert.equal(f.opens(),1);assert.equal(f.drops(),0);assert.equal(f.held(),null);
 h.onPointerDown(f.event(5,5));f.hold();assert.equal(f.element.dataset.taskHeld,'true');h.onPointerUp(f.event(5,5));h.onClick({preventDefault(){}});
 assert.equal(f.held(),task);assert.equal(f.opens(),1);assert.equal(f.drops(),0);assert.equal(f.element.dataset.taskHeld,undefined);
});
test('Mouse requires a hold before drag, confirms only a Bin hit and suppresses the post-drag click',()=>{
 const f=dragFixture(),h=f.api.handle(model.blankTask());h.onPointerDown(f.event(5,5));h.onPointerMove(f.event(120,120));h.onPointerUp(f.event(120,120));h.onClick({preventDefault(){}});assert.equal(f.drops()+f.opens(),0);assert.equal(f.state(),null);
 h.onPointerDown(f.event(5,5));f.hold();h.onPointerMove(f.event(120,120));assert.equal(f.state().over,true);h.onPointerUp(f.event(120,120));h.onClick({preventDefault(){}});assert.equal(f.drops(),1);assert.equal(f.opens(),0);assert.equal(f.held(),null);
 const outside=dragFixture(),o=outside.api.handle(model.blankTask());o.onPointerDown(outside.event(5,5));outside.hold();o.onPointerMove(outside.event(20,20));o.onPointerUp(outside.event(20,20));assert.equal(outside.drops(),0);assert.equal(outside.held(),null);
});
test('Touch swipes scroll before hold; held touch prevents scrolling and drops with no accidental edit',()=>{
 const f=dragFixture(),h=f.api.handle(model.blankTask());let prevented=0;
 h.onTouchStart({currentTarget:f.element,touches:[f.touch(5,5)]});f.events.document.get('touchmove')({touches:[f.touch(5,25)],cancelable:true,preventDefault(){prevented++;}});assert.equal(prevented,0);assert.equal(f.timers.size,0);
 h.onTouchStart({currentTarget:f.element,touches:[f.touch(5,5)]});f.hold();f.events.document.get('touchmove')({touches:[f.touch(120,120)],cancelable:true,preventDefault(){prevented++;}});assert.equal(prevented,1);assert.equal(f.state().over,true);
 f.events.document.get('touchend')({changedTouches:[f.touch(120,120)]});h.onClick({preventDefault(){}});assert.equal(f.drops(),1);assert.equal(f.opens(),0);
});
test('Touch hold selects Bin item; multi-touch, blur, resize, Escape and interrupted pointer cancel safely',()=>{
 const selection=dragFixture({selectionOnly:true}),s=selection.api.handle(model.blankTask());s.onTouchStart({currentTarget:selection.element,touches:[selection.touch(5,5)]});selection.hold();assert.equal(selection.holds(),1);selection.events.document.get('touchend')({changedTouches:[selection.touch(5,5)]});assert.equal(selection.holds(),1);assert.equal(selection.drops(),0);
 for(const cancel of ['blur','resize','Escape','pointer','touch','multi']){
  const f=dragFixture(),h=f.api.handle(model.blankTask());h.onPointerDown(f.event(5,5));f.hold();h.onPointerMove(f.event(120,120));
  if(cancel==='Escape')f.events.window.get('keydown')({key:'Escape'});else if(cancel==='pointer')h.onPointerCancel(f.event(120,120));else if(cancel==='touch')f.events.document.get('touchcancel')();else if(cancel==='multi')h.onTouchStart({touches:[f.touch(5,5),f.touch(10,10)]});else f.events.window.get(cancel)();
  h.onPointerUp(f.event(120,120));assert.equal(f.drops(),0);assert.equal(f.state(),null);assert.equal(f.element.dataset.taskHeld,undefined);
 }
});
test('Right-click and keyboard options are accessible without triggering edit or deletion',()=>{
 const f=dragFixture(),task=model.blankTask(),h=f.api.handle(task);let prevented=0;
 h.onContextMenu({currentTarget:f.element,preventDefault(){prevented++;}});assert.equal(f.held(),task);f.api.cancel();
 h.onKeyDown({key:'F10',shiftKey:true,currentTarget:f.element,preventDefault(){prevented++;}});assert.equal(f.held(),task);assert.equal(f.opens()+f.drops(),0);assert.equal(prevented,2);assert.equal(f.api.origin.current,f.element);
});
