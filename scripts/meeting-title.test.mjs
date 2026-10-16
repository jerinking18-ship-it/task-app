import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Uint8Array,TextDecoder,Promise,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const model=load('../src/lib/meeting-title/model.ts',{'@/lib/tasks/validation':validation});
const repository=load('../src/lib/meeting-title/repository.ts',{'@/lib/tasks/validation':validation,'./model':model});
const stamp='2026-10-16T10:00:00.123456Z';
test('shared title permits blank fallback and rejects identity/version/control-character injection',()=>{
 assert.equal(model.titleAction({title:' Youth Meeting ',version:null}).title,'Youth Meeting');
 assert.equal(model.titleAction({title:'  ',version:stamp}).title,'');
 for(const value of [{title:'A',version:null,owner_id:'x'},{title:'A',version:null,role:'owner'},{title:'A'},{title:'A',version:'bad'},{title:'A',version:Infinity},{title:'a'.repeat(61),version:null},{title:'A\nB',version:null},{title:'A\u2028B',version:null},{title:null,version:null}])assert.equal(model.titleAction(value),null);
 assert.equal(validation.validFields({...tasks.taskFields(tasks.blankTask(),[]),meeting_title:'Bypass'}),false);
});
test('title responses preserve shared fallback and fail closed on unversioned or malformed custom names',()=>{
 assert.equal(model.meetingName(model.decodeMeetingTitle({title:null,version:null})),'Special Meeting');
 assert.equal(model.meetingName(model.decodeMeetingTitle({title:'Youth Meeting',version:stamp})),'Youth Meeting');
 assert.equal(model.meetingName(model.decodeMeetingTitle({title:null,version:stamp})),'Special Meeting');
 for(const value of [null,{}, {title:'Youth',version:null},{title:'',version:stamp},{title:' Youth ',version:stamp},{title:'A\nB',version:stamp},{title:null,version:'bad'}])assert.throws(()=>model.decodeMeetingTitle(value));
});
function fixture({signedIn=true,error=null,data={title:'Youth Meeting',version:stamp}}={}){
 const calls=[];const client={auth:{},rpc:async(name,args)=>{calls.push({name,args});return{data,error};}};
 const route=load('../src/app/api/meeting-title/route.ts',{'@/lib/supabase/server':{createClient:async()=>client},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:'private'}:null},'@/lib/auth/server':{authOrigin:()=> 'https://app.example.test',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/meeting-title/model':model,'@/lib/meeting-title/repository':repository});
 return{calls,route,repo:new repository.MeetingTitleRepository(client)};
}
const request=(body,origin='https://app.example.test',type='application/json')=>new Request('https://app.example.test/api/meeting-title',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});
test('title API protects signed-in reads and same-origin bounded saves before calling any RPC',async()=>{
 const anon=fixture({signedIn:false});assert.equal((await anon.route.GET()).status,401);assert.equal((await anon.route.POST(request({title:'Youth Meeting',version:null}))).status,401);assert.equal(anon.calls.length,0);
 const f=fixture();for(const[req,status]of[[request({title:'A',version:null},'https://bad.test'),403],[request({title:'A',version:null},undefined,'text/plain'),415],[request('{'),400],[request('x'.repeat(4097)),413],[request({title:'A',version:null,owner_id:'other'}),400]])assert.equal((await f.route.POST(req)).status,status);
 assert.equal(f.calls.length,0);
});
test('title API maps fixed identity-free RPCs, validates acknowledgements and uses private cache policy',async()=>{
 const f=fixture();const read=await f.route.GET();assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/private, no-store/);assert.equal(f.calls[0].name,'task_app_special_meeting_title');
 const saved=await f.route.POST(request({title:' Youth Meeting ',version:null}));assert.equal(saved.status,200);assert.equal(f.calls[1].name,'task_app_set_special_meeting_title');assert.equal(f.calls[1].args.meeting_title,'Youth Meeting');assert.equal(f.calls[1].args.expected_version,null);assert.equal('owner_id'in f.calls[1].args,false);
 for(const data of [{title:'Wrong response',version:stamp},{title:'Youth Meeting',version:null}]){const bad=fixture({data});assert.equal((await bad.route.POST(request({title:'Youth Meeting',version:null}))).status,503);}
});
test('concurrent-title conflict returns only the latest shared title and never retries automatically',async()=>{
 const f=fixture({data:{conflict:true,latest:{title:'Christmas Service',version:stamp}}});const response=await f.route.POST(request({title:'Youth Meeting',version:stamp}));assert.equal(response.status,409);assert.equal((await response.json()).latest.title,'Christmas Service');assert.equal(f.calls.length,1);
});
test('manager-only title saves sanitize provider errors and retain explicit status codes',async()=>{
 for(const[code,status]of[['P0403',403],['42501',401],['23514',400],['XX000',503]]){const f=fixture({error:{code,message:'private-provider-detail'}});const response=await f.route.POST(request({title:'Youth Meeting',version:null}));assert.equal(response.status,status);assert.equal((await response.text()).includes('private-provider-detail'),false);}
});
