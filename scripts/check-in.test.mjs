import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import vm from'node:vm';
import test from'node:test';
import ts from'typescript';
function load(file,deps={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,URL,Response,Request,TextDecoder,Uint8Array,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const validation=load('../src/lib/tasks/validation.ts',{'./model':load('../src/lib/tasks/model.ts')});
const api=load('../src/lib/check-in/model.ts',{'@/lib/tasks/validation':validation});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const context=(patch={})=>({categoryId:id(1),category:'Sunday Service',meetingDate:'2026-10-18',service:'morning',meetingId:null,opensAt:'2026-10-18T07:00:00+05:30',closesAt:'2026-10-18T16:00:00+05:30',visibleUntil:'2026-10-20T00:00:00+05:30',...patch});
const data=(patch={})=>({serverNow:'2026-10-18T10:00:00+05:30',currentId:id(2),contexts:[context()],presence:[],own:[],...patch});
test('Morning includes every second of 3:59 PM and ends exactly at4',()=>{
 for(const[stamp,expected]of[['06:59:59',false],['07:00:00',true],['15:59:59.999',true],['16:00:00',false]])assert.equal(api.checkInOpen(context(),new Date(`2026-10-18T${stamp}+05:30`)),expected);
});
test('Launch defaults only to an open unchecked service; other times and no meetings use Assigned',()=>{
 const c=context(),key=api.contextKey(c);
 assert.equal(api.checkInLanding(data()),'Check in');
 assert.equal(api.checkInLanding(data({own:[key],presence:[{key,memberId:id(2)}]})),'Assigned to me');
 for(const stamp of ['2026-10-18T06:59:59+05:30','2026-10-18T16:00:00+05:30','2026-10-19T10:00:00+05:30'])assert.equal(api.checkInLanding(data(),new Date(stamp)),'Assigned to me');
 assert.equal(api.checkInLanding(data({contexts:[]})),'Assigned to me');
 const evening=context({service:'evening',opensAt:'2026-10-18T16:00:00+05:30',closesAt:'2026-10-19T00:00:00+05:30'});
 assert.equal(api.checkInLanding(data({contexts:[c,evening],own:[key]}),new Date('2026-10-18T16:00:00+05:30')),'Check in');
});
test('Check-in action refuses identity timestamp injection invalid service and missing confirmation',()=>{
 const input={categoryId:id(1),meetingDate:'2026-10-18',service:'morning',meetingId:null,confirmed:true};
 assert.ok(api.checkInAction(input));for(const bad of [{...input,memberId:id(9)},{...input,checkedAt:new Date().toISOString()},{...input,service:'both'},{...input,confirmed:false},{...input,meetingDate:'2026-02-30'},{...input,categoryId:'wrong'},{...input,meetingId:''}])assert.equal(api.checkInAction(bad),null);
});
test('Public projection rejects private entries; manager projection checks exact presence identities',()=>{
 const c=context(),key=api.contextKey(c),presence=[{key,memberId:id(2)}],own=[key];
 assert.equal(api.decodeCheckIn(data({presence,own})).own[0],key);
 const privateData=data({presence,own,entries:[{key,memberId:id(2),checkedAt:'2026-10-18T09:42:00+05:30'}]});
 assert.throws(()=>api.decodeCheckIn(privateData));assert.equal(api.decodeCheckIn(privateData,true).entries.length,1);
 for(const bad of [data({presence:[{key,memberId:id(2),checkedAt:'hidden'}]}),data({own:[key]}),data({contexts:[c,c]}),data({presence:[{key:'foreign',memberId:id(2)}]}),{...privateData,entries:[]},{...privateData,entries:[{key,memberId:id(8),checkedAt:'2026-10-18T09:42:00+05:30'}]}])assert.throws(()=>api.decodeCheckIn(bad,bad.entries!==undefined));
});
test('Service day and Special meeting id are part of the attendance key',()=>{
 const c=context();const keys=[c,{...c,service:'evening'},{...c,meetingDate:'2026-10-25'},{...c,meetingId:id(3)},{...c,categoryId:id(7)}].map(api.contextKey);assert.equal(new Set(keys).size,5);
});
test('Special and regular context schema refuses invalid cross-service scopes',()=>{
 const special=context({category:'Special Meeting',service:null,meetingId:id(3),opensAt:'2026-10-18T07:00:00+05:30',closesAt:'2026-10-18T23:00:00+05:30'});
 assert.equal(api.decodeCheckIn(data({contexts:[special]})).contexts[0].meetingId,id(3));
 for(const c of [{...special,service:'morning'},{...special,meetingId:null},{...context(),service:null},{...context(),meetingId:id(4)},{...special,closesAt:special.opensAt},{...special,visibleUntil:special.opensAt}])assert.throws(()=>api.decodeCheckIn(data({contexts:[c]})));
});
test('Fresh account opening uses server attendance and safely falls back without changing auth gates',async()=>{
 let signedIn=true,check=data(),reads=0;const deps={
  'react/jsx-runtime':{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})},
  'next/navigation':{redirect:path=>{throw Error('redirect:'+path)}},'@/components/task-app':{default:'task-app'},
  '@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{email:'fictional@example.test'}:null},
  '@/lib/members/server':{MemberError:class extends Error{},readMembers:async()=>({current:{id:id(2)},workspace:{ownerId:id(3)}})},
  '@/lib/check-in/server':{readCheckIn:async()=>{reads++;if(check===null)throw Error('private failure');return check}},'@/lib/check-in/model':api,
 };
 const page=()=>load('../src/app/account/page.tsx',deps).default({searchParams:Promise.resolve({})});
 assert.equal((await page()).props.initialView,'Check in');
 const key=api.contextKey(context());check=data({own:[key],presence:[{key,memberId:id(2)}]});assert.equal((await page()).props.initialView,'Assigned to me');
 check=null;assert.equal((await page()).props.initialView,'Assigned to me');
 signedIn=false;const before=reads;await assert.rejects(page,/redirect:\/sign-in/);assert.equal(reads,before);
});
test('Check-in API authenticates reads and protects mutations against forged identity origin and body size',async()=>{
 class MemberError extends Error{constructor(status,message){super(message);this.status=status;}}
 let signedIn=true,privateAllowed=false,called=0;
 const deps={'next/server':{NextResponse:{json:(body,options)=>Response.json(body,options)}},'@/lib/auth/server':{authOrigin:()=> 'https://app.example',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},
 '@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:id(2)}:null},'@/lib/supabase/server':{createClient:async()=>({})},'@/lib/members/server':{MemberError},'@/lib/members/model':{decodeMembers:v=>v},'@/lib/tasks/validation':validation,'@/lib/check-in/model':api,
 '@/lib/check-in/server':{readCheckIn:async(_,details)=>{called++;if(details&&!privateAllowed)throw new MemberError(403,'Restricted');return data();},saveCheckIn:async(_,input)=>{called++;const key=api.contextKey(input);return{state:data({own:[key],presence:[{key,memberId:id(2)}]}),members:{current:{id:id(2)}}};}}};
 const route=load('../src/app/api/check-in/route.ts',deps),input={categoryId:id(1),meetingDate:'2026-10-18',service:'morning',meetingId:null,confirmed:true};
 const request=(body,origin='https://app.example')=>new Request('https://app.example/api/check-in',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
 signedIn=false;assert.equal((await route.GET(new Request('https://app.example/api/check-in'))).status,401);assert.equal(called,0);
 signedIn=true;assert.equal((await route.GET(new Request('https://app.example/api/check-in?details=1'))).status,403);
 assert.equal((await route.GET(new Request('https://app.example/api/check-in?details=1&details=0'))).status,400);
 const before=called;for(const[body,origin]of[[input,'https://elsewhere.test'],[{...input,memberId:id(3)},'https://app.example'],['{','https://app.example'],['a'.repeat(2049),'https://app.example']])assert.notEqual((await route.POST(request(body,origin))).status,200);assert.equal(called,before);
 const response=await route.POST(request(input));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).state.own.length,1);
});
