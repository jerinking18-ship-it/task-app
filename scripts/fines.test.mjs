import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,URL,TextDecoder,Uint8Array,JSON,...globals,require(n){if(n in deps)return deps[n];if(n==='next/server')return require(n);throw Error(n);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const model=load('../src/lib/fines/model.ts',{'@/lib/tasks/validation':validation,'@/lib/tasks/model':tasks});
class TaskError extends Error{constructor(status,message){super(message);this.status=status;}}
class MemberError extends Error{constructor(status,message){super(message);this.status=status;}}
const repo=load('../src/lib/fines/repository.ts',{'./model':model,'@/lib/tasks/repository':{TaskError}});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const stamp='2026-10-14T06:00:00Z';
const fine={id:id(1),taskId:id(2),title:'Arrange seating',category:'Sunday Service',memberId:id(3),memberName:'Jerin',cutoffAt:'2026-10-12T23:30:00Z',amountPaise:5000,status:'unpaid',assessedAt:stamp,version:stamp,settledAt:null,settledById:null,settledByName:null,reason:null};
const data={serverNow:stamp,enabledAt:'2026-10-01T06:00:00Z',members:[{id:id(3),name:'Jerin'}],entries:[fine]};
const action={id:fine.id,version:stamp,action:'cancelled',reason:'Equipment failed',confirmed:true};
test('fine codec rejects partial, duplicate, unsafe and inconsistent financial records',()=>{
 assert.equal(model.decodeFines(data).entries[0].amountPaise,5000);
 for(const patch of [{amountPaise:50},{status:'waived'},{settledAt:stamp},{cutoffAt:'bad'},{memberId:'bad'},{status:'cancelled',settledAt:stamp,settledById:id(3),settledByName:'Jerin',reason:' '},{status:'paid',settledAt:stamp,settledById:id(3),settledByName:'Jerin',reason:'Injected'}])assert.throws(()=>model.decodeFines({...data,entries:[{...fine,...patch}]}));
 assert.throws(()=>model.decodeFines({...data,entries:[fine,fine]}));assert.throws(()=>model.decodeFines({...data,enabledAt:undefined}));
});
test('fine actions require confirmation, version, valid reason and reject client financial identity injection',()=>{
 assert.equal(model.fineAction(action).reason,'Equipment failed');assert.ok(model.fineAction({...action,action:'paid',reason:null}));
 for(const patch of [{confirmed:false},{reason:''},{reason:'x'.repeat(501)},{amountPaise:100},{memberId:id(3)},{ownerId:id(3)},{settledAt:stamp},{action:'unpaid'},{version:'bad'},{action:'paid',reason:'arbitrary'}])assert.equal(model.fineAction({...action,...patch}),null);
});
test('fine filters are member/category/month scoped in India time; unpaid totals survive year rollover',()=>{
 const other={...fine,id:id(4),taskId:id(5),memberId:id(6),category:'Healing Meeting',cutoffAt:'2025-12-31T18:29:00Z'};
 assert.equal(model.filterFines([fine,other],{member:id(3),category:'Sunday Service',month:'2026-10',search:'SEATING',status:'unpaid'}).length,1);
 assert.equal(model.filterFines([fine,other],{member:'all',category:'all',month:'all',search:'',status:'all'}).length,2);
 assert.equal(model.fineTotals([fine,other]).unpaid,10000);assert.equal(model.rupees(15000),'₹150');
 assert.equal(model.fineMonth('2025-12-31T18:30:00Z'),'2026-01');
});
test('fine repository uses role-scoped RPC only and rejects uncertain confirmations',async()=>{
 const calls=[];const r=new repo.FinesRepository({rpc:async(name,args)=>{calls.push({name,args});return{data:name==='task_app_fines'?data:{id:action.id,status:'cancelled',data:{...data,entries:[]}},error:null};}});
 assert.equal((await r.read()).entries.length,1);await r.mutate(action);assert.equal(calls[1].name,'task_app_settle_fine');assert.equal(calls[1].args.cancel_reason,'Equipment failed');assert.equal('owner_id'in calls[1].args,false);
 for(const[code,status]of[['P0403',403],['P0409',409],['42501',401],['23514',400],['XX000',503]])await assert.rejects(()=>new repo.FinesRepository({rpc:async()=>({data:null,error:{code}})}).read(),e=>e.status===status);
 await assert.rejects(()=>new repo.FinesRepository({rpc:async()=>({data:{id:id(99),status:'cancelled'},error:null})}).mutate(action),e=>e.status===503);
});
function routeFixture({signed=true,role='owner',selected=true}={}){let reads=0,writes=0;const route=load('../src/app/api/fines/route.ts',{
 '@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signed?{userId:id(9)}:null},'@/lib/auth/server':{authOrigin:()=> 'http://127.0.0.1:3003',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError,readMembers:async()=>({current:selected?{id:id(3),role}:null,workspace:{ownerId:id(9)}})},'@/lib/tasks/repository':{TaskError},'@/lib/fines/model':model,'@/lib/fines/repository':{FinesRepository:class{async read(){reads++;return data;}async mutate(a){writes++;return{id:a.id,status:a.action,data};}}}});return{route,counts:()=>({reads,writes})};}
const request=(body,origin='http://127.0.0.1:3003',type='application/json')=>new Request('http://127.0.0.1:3003/api/fines',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});
test('fines API denies anonymous, Member, missing role and unselected identities without ledger access',async()=>{
 for(const[options,status]of[[{signed:false},401],[{role:'member'},403],[{role:undefined},403],[{role:'unknown'},403],[{selected:false},403]]){const f=routeFixture(options.role===undefined&&options.signed!==false&&options.selected!==false?{role:'unknown'}:options);assert.equal((await f.route.GET()).status,status);assert.equal((await f.route.POST(request(action))).status,status);assert.equal(f.counts().reads+f.counts().writes,0);}
});
test('fines API validates origin, bounded UTF8 JSON and action schema before mutations',async()=>{
 const f=routeFixture();for(const[req,status]of[[request(action,'https://other.test'),403],[request(action,undefined,'text/plain'),415],[request('{'),400],[request('x'.repeat(8193)),413],[request({...action,amountPaise:1}),400]])assert.equal((await f.route.POST(req)).status,status);assert.equal(f.counts().writes,0);
 for(const role of['owner','coordinator']){const m=routeFixture({role});const read=await m.route.GET();assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/private, no-store/);assert.equal((await m.route.POST(request(action))).status,200);}
});
test('restricted Fines panel does not render or preload financial labels into Member HTML',()=>{
 const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const display=load('../src/lib/members/display-name.ts');
 const Panel=load('../src/components/fines/fines-panel.tsx',{'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/tasks/model':tasks,'@/lib/members/display-name':display,'@/lib/fines/model':model,'./fines.module.css':{default:new Proxy({},{get:(_,p)=>p})}}).default;
 const html=renderToStaticMarkup(React.createElement(Panel,{allowed:false,data,members:[],loading:false,pending:false,error:'',forbidden:false,deferred:false,search:'',workspaceName:'Team',onRefresh(){},onMutate(){},onBack(){},onDirty(){},onPending(){}}));
 assert.match(html,/Access restricted/);assert.match(html,/Back to tasks/);for(const privateText of['Arrange seating','Outstanding','₹50','Mark paid','Cancel fine'])assert.equal(html.includes(privateText),false);
});
