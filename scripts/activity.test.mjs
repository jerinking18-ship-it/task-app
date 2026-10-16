import assert from 'node:assert/strict';
import {readFileSync}from'node:fs';
import {createRequire}from'node:module';
import test from'node:test';
import vm from'node:vm';
import ts from'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,URL,URLSearchParams,Object,Promise,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const model=load('../src/lib/activity/model.ts',{'@/lib/tasks/validation':validation,'@/lib/tasks/model':tasks});
class TaskError extends Error{constructor(status,message){super(message);this.status=status;}}
class MemberError extends TaskError{}
const repo=load('../src/lib/activity/repository.ts',{'@/lib/tasks/repository':{TaskError},'./model':model});
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),stamp='2026-10-16T13:00:00.000123Z';
const entry={id:id(1),kind:'task_completed',actorId:id(2),actorName:'Jerin',actorRole:'member',affectedIds:[id(2)],title:'Sound',category:'Revival Meeting',createdAt:stamp,details:{memberId:id(2),memberName:'Jerin'}};
const data={serverNow:stamp,total:1,hasMore:false,entries:[entry],members:[{id:id(2),name:'Jerin',left:false}]};
test('Query validates identity, direction, date and matching cursor together',()=>{
 assert.ok(model.activityQuery(new URLSearchParams()));
 assert.ok(model.activityQuery(new URLSearchParams({member:id(2),relation:'affecting',days:'all',before:stamp,beforeId:id(1)})));
 for(const q of ['member=other','relation=all','days=365','meeting=Other','kind=forged','owner_id=x','member=&member='+id(2),'before='+stamp,'beforeId='+id(1),'before=no&beforeId='+id(1)])assert.equal(model.activityQuery(new URLSearchParams(q)),null,q);
});
test('Malformed and incomplete pages fail closed',()=>{
 assert.equal(model.decodeActivity(data).entries[0].id,id(1));
 for(const bad of [null,{}, {...data,total:0},{...data,hasMore:true},{...data,entries:[entry,entry]},{...data,entries:[{...entry,kind:'unknown'}]},{...data,entries:[{...entry,createdAt:'bad'}]},{...data,entries:[{...entry,details:{private:{token:'x'}}}]},{...data,members:[{...data.members[0],name:null}]}])assert.throws(()=>model.decodeActivity(bad));
});
test('IST day grouping handles UTC date boundaries',()=>{
 assert.equal(model.activityDay('2026-10-15T19:00:00Z',new Date('2026-10-16T12:00:00Z')),'Today');
 assert.equal(model.activityDay('2026-10-15T18:00:00Z',new Date('2026-10-16T12:00:00Z')),'Yesterday');
});
test('Copy distinguishes actions involving someone from self actions',()=>{
 assert.equal(model.activityCopy(entry).headline,'Jerin completed a task');
 assert.equal(model.activityCopy({...entry,kind:'task_taken',actorName:'Sarah',details:{memberName:'Jerin'}}).headline,'Sarah took Jerin’s task');
 assert.equal(model.activityCopy({...entry,kind:'role_changed',actorName:'Owner',details:{memberName:'Sarah',from:'member',to:'coordinator'}}).secondary,'Member → Coordinator');
 assert.equal(model.activityCopy({...entry,kind:'fine_issued',actorName:'System',actorId:null,details:{memberName:'Jerin',amountPaise:5000}}).extra,'₹50');
});
function fixture({signedIn=true,role='owner',databaseError=null,databaseData=data}={}){
 const calls=[];const client={auth:{},rpc:async(name,args)=>{calls.push({name,args});return {data:databaseData,error:databaseError};}};
 const route=load('../src/app/api/activity-log/route.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:id(9)}:null},'@/lib/auth/server':{AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError,readMembers:async()=>({current:{id:id(2),role},workspace:{id:id(8)}})},'@/lib/tasks/repository':{TaskError},'@/lib/activity/repository':repo,'@/lib/activity/model':model});
 return{calls,route};
}
const request=query=>new Request('https://app.example.test/api/activity-log'+(query?'?'+query:''));
test('API blocks anonymous and Member before the audit RPC',async()=>{
 for(const options of [{signedIn:false},{role:'member'}]){const f=fixture(options),r=await f.route.GET(request());assert.equal(r.status,options.signedIn===false?401:403);assert.equal(f.calls.length,0);assert.match(r.headers.get('cache-control'),/private, no-store/);}
});
test('Manager API forwards validated scope and returns private read-only data',async()=>{
 for(const role of ['owner','coordinator']){const f=fixture({role}),r=await f.route.GET(request('member='+id(2)+'&relation=affecting&days=all'));assert.equal(r.status,200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'task_app_activity');assert.equal(f.calls[0].args.p_member,id(2));assert.equal(f.calls[0].args.p_relation,'affecting');assert.equal(f.calls[0].args.p_since,null);assert.equal(f.route.POST,undefined);}
});
test('Invalid filters never reach the database and DB permission changes fail closed',async()=>{
 const bad=fixture();assert.equal((await bad.route.GET(request('owner_id=other'))).status,400);assert.equal(bad.calls.length,0);
 for(const [code,status]of [['P0403',403],['42501',401],['PGRST202',503]]){const f=fixture({databaseError:{code}});assert.equal((await f.route.GET(request())).status,status);}
 const incomplete=fixture({databaseData:{}});assert.equal((await incomplete.route.GET(request())).status,503);
});
