import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,URL,TextDecoder,Uint8Array,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts');const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const completed=load('../src/lib/tasks/completed.ts',{'./validation':validation});
const repo=load('../src/lib/tasks/repository.ts',{'./model':model,'./validation':validation});
const {CompletedRepository}=load('../src/lib/tasks/completed-repository.ts',{'./completed':completed,'./repository':repo});
const snapshot={count:4,snapshot:'0123456789abcdef0123456789abcdef'},action={...snapshot,confirmed:true};
test('Completed purge requires exact confirmation and a valid nonempty snapshot; rejects forged scope and malformed values',()=>{
 assert.ok(completed.validateCompletedPurge(action));
 for(const value of [{...action,confirmed:false},{...action,confirmed:undefined},{...action,count:0},{...action,count:-1},{...action,count:1.5},{...action,count:'4'},{...action,count:Number.MAX_SAFE_INTEGER+1},{...action,snapshot:'bad'},{...action,owner_id:'other'},{...action,category:'Sunday Service'},null])assert.equal(completed.validateCompletedPurge(value),null);
 assert.equal(completed.decodeCompletedSnapshot({...snapshot,count:0}).count,0);
 for(const value of [null,{count:4},{...snapshot,snapshot:null}])assert.throws(()=>completed.decodeCompletedSnapshot(value));
});
test('Completed response must acknowledge exact count and exact reviewed version',()=>{
 assert.equal(completed.decodeCompletedPurge({deleted:4,snapshot:snapshot.snapshot},snapshot),4);
 for(const value of [{deleted:3,snapshot:snapshot.snapshot},{deleted:4,snapshot:'f'.repeat(32)},{deleted:'4',snapshot:snapshot.snapshot},null])assert.throws(()=>completed.decodeCompletedPurge(value,snapshot));
});
test('Completed repository uses owner-bound SQL RPC preview and one atomic confirmed purge; stale snapshots fail safely',async()=>{
 const calls=[];const f=new CompletedRepository({rpc:async(name,args)=>{calls.push({name,args});return {data:args.operation==='preview'?snapshot:{deleted:4,snapshot:snapshot.snapshot},error:null};}});
 assert.equal((await f.read()).count,4);assert.equal((await f.purge(action)).deleted,4);assert.equal(calls.length,2);assert.equal(calls[0].name,'task_app_completed');assert.equal(calls[0].args.operation,'preview');assert.equal(calls[1].args.confirmed,true);assert.equal(calls[1].args.expected_snapshot,snapshot.snapshot);assert.equal('owner_id' in calls[1].args,false);
 for(const [code,status] of [['P0013',409],['42501',401],['private-error',503]])await assert.rejects(()=>new CompletedRepository({rpc:async()=>({data:null,error:{code}})}).purge(action),e=>e.status===status&&!e.message.includes('private-error'));
 await assert.rejects(()=>new CompletedRepository({rpc:async()=>({data:{deleted:2,snapshot:snapshot.snapshot},error:null})}).purge(action),e=>e.status===503);
 await assert.rejects(()=>new CompletedRepository({rpc:async()=>({data:null,error:null})}).read(),e=>e.status===503);
});
function routeFixture({signedIn=true,selected=true}={}){let reads=0,writes=0;const route=load('../src/app/api/completed/route.ts',{
 '@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:'owner'}:null},'@/lib/auth/server':{authOrigin:()=> 'http://127.0.0.1:3003',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError:class extends Error{},readMembers:async()=>({current:selected?{id:'member'}:null})},'@/lib/tasks/repository':repo,'@/lib/tasks/completed':completed,'@/lib/tasks/completed-repository':{CompletedRepository:class{async read(){reads++;return snapshot;}async purge(input){writes++;return {deleted:input.count,snapshot:input.snapshot};}}}});return {route,counts:()=>({reads,writes})};}
function request(body,origin='http://127.0.0.1:3003',type='application/json'){return new Request('http://127.0.0.1:3003/api/completed',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});}
test('Completed API denies anonymous, unselected, cross-origin, malformed and oversized requests before touching task data',async()=>{
 for(const [options,status] of [[{signedIn:false},401],[{selected:false},403]]){const f=routeFixture(options);assert.equal((await f.route.GET()).status,status);assert.equal((await f.route.POST(request(action))).status,status);assert.equal(f.counts().reads+f.counts().writes,0);}
 const f=routeFixture();for(const [req,status] of [[request(action,'https://other.test'),403],[request(action,undefined,'text/plain'),415],[request('{'),400],[request('x'.repeat(1025)),413],[request({...action,confirmed:false}),400]])assert.equal((await f.route.POST(req)).status,status);assert.equal(f.counts().reads+f.counts().writes,0);
});
test('Completed API returns private no-store server count and exact acknowledged deletion',async()=>{
 const f=routeFixture(),response=await f.route.GET();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(completed.decodeCompletedSnapshot(await response.json()).count,4);
 const changed=await f.route.POST(request(action));assert.equal(changed.status,200);assert.equal(completed.decodeCompletedPurge(await changed.json(),snapshot),4);assert.equal(f.counts().writes,1);
});
