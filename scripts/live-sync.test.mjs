import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,URL,TextDecoder,Uint8Array,...globals,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const model=load('../src/lib/members/model.ts',{'@/lib/tasks/validation':validation});
const presence=load('../src/lib/members/presence.ts',{'@/lib/tasks/validation':validation});
const id='00000000-0000-4000-8000-000000000091',stamp='2026-10-13T12:00:00Z';
const member={id,name:'Example',createdAt:stamp,lastSeenAt:stamp,activeUntil:'2026-10-13T12:01:05Z'};
const state={current:member,members:[member],serverNow:stamp};
test('Activity input accepts only a tab, boolean status and positive safe sequence; rejects forged member/time/owner',()=>{
 const input={tabId:id,active:true,sequence:1};assert.ok(presence.presenceInput(input));
 for(const value of [{...input,active:'true'},{...input,sequence:0},{...input,sequence:1.5},{...input,sequence:Number.MAX_SAFE_INTEGER+1},{...input,tabId:'bad'},{...input,owner_id:id},{...input,member_id:id},{...input,last_seen_at:stamp}])assert.equal(presence.presenceInput(value),null);
});
test('Member state validates server clock/lease and expires Active exactly at server lease boundary',()=>{
 const next=model.decodeMemberResponse(state);assert.equal(next.serverNow,stamp);assert.equal(model.memberActive(next.current,new Date('2026-10-13T12:01:04.999Z')),true);assert.equal(model.memberActive(next.current,new Date('2026-10-13T12:01:05Z')),false);
 assert.equal(model.memberActive({...member,activeUntil:null},new Date(stamp)),false);
 for(const value of [{...state,serverNow:'bad'},{...state,current:{...member,activeUntil:'bad'}}])assert.throws(()=>model.decodeMemberResponse(value));
 const old=model.decodeMemberResponse({current:{...member,activeUntil:undefined},members:[{...member,activeUntil:undefined}]});assert.equal(model.memberActive(old.current,new Date(stamp)),false);
});
function hookFixture({blocked=false,status=200}={}){
 const effects=[],timers=new Map(),intervals=new Map(),events={window:new Map(),document:new Map()},calls=[],updates=[];let seq=0,focus=true,change,statusCallback,removed=0;
 const document={visibilityState:'visible',hasFocus:()=>focus,addEventListener:(e,f)=>events.document.set(e,f),removeEventListener:e=>events.document.delete(e)};
 const window={addEventListener:(e,f)=>events.window.set(e,f),removeEventListener:e=>events.window.delete(e)};
 const navigator={onLine:true};const channel={on(type,filter,callback){change=callback;calls.push({type,filter});return channel;},subscribe(callback){statusCallback=callback;return channel;}};
 const client={realtime:{setAuth:async()=>{calls.push({auth:true});}},channel(topic,options){calls.push({topic,options});return channel;},removeChannel:async()=>{removed++;}};
 const options={enabled:true,accountId:id,blocked,onTasks:()=>updates.push('tasks'),onMembers:()=>updates.push('members'),onPresence:value=>updates.push(value),onExpired:()=>updates.push('expired')};
 const react={useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
 const hook=load('../src/lib/tasks/use-live-sync.ts',{'react':react,'@/lib/supabase/client':{createClient:()=>client},'@/lib/members/model':model,'@/lib/members/presence':presence},{document,window,navigator,crypto:{randomUUID:()=>id},AbortSignal,fetch:async(url,init)=>{calls.push({url,input:JSON.parse(init.body),keepalive:init.keepalive});return {status,ok:status===200,json:async()=>state};},setTimeout:fn=>{timers.set(++seq,fn);return seq;},clearTimeout:id=>timers.delete(id),setInterval:(fn,ms)=>{intervals.set(++seq,{fn,ms});return seq;},clearInterval:id=>intervals.delete(id)});
 const api=hook.useLiveSync(options),cleanups=effects.map(fn=>fn());
 return {api,options,events,calls,updates,timers,intervals,navigator,document,focus:value=>{focus=value;},change:value=>change(value),status:value=>statusCallback(value),removed:()=>removed,flush:async()=>{await new Promise(setImmediate);for(let i=0;timers.size&&i<10;i++){const entries=[...timers];timers.clear();entries.forEach(([,fn])=>fn());await new Promise(setImmediate);}},unblock:()=>{options.blocked=false;effects[1]();},cleanup:()=>cleanups.forEach(fn=>fn?.())};
}
test('Private account channel coalesces changes and preserves dirty drafts until explicitly unblocked',async()=>{
 const f=hookFixture({blocked:true});await f.flush();assert.ok(f.calls.some(c=>c.topic===`task-account:${id}`&&c.options.config.private));
 for(let i=0;i<10;i++)f.change({payload:{scope:'tasks'}});f.change({payload:{scope:'members'}});await f.flush();assert.equal(f.updates.length,0);
 f.unblock();await f.flush();assert.equal(f.updates.filter(x=>x==='tasks').length,1);assert.equal(f.updates.filter(x=>x==='members').length,1);assert.equal(f.updates.filter(x=>typeof x==='object').length,1);
 f.cleanup();await new Promise(setImmediate);assert.equal(f.removed(),1);assert.equal(f.timers.size+f.intervals.size,0);assert.equal(f.events.window.size+f.events.document.size,0);
});
test('Hidden/offline tabs pause reads; foreground resumes catch-up and sends ordered server heartbeat without overlap',async()=>{
 const f=hookFixture();await f.flush();const pings=()=>f.calls.filter(c=>c.url==='/api/presence');assert.equal(pings()[0].input.active,true);
 f.focus(false);f.events.window.get('blur')();await f.flush();assert.equal(pings().at(-1).input.active,false);assert.equal(pings().at(-1).keepalive,true);
 const count=f.updates.length;f.document.visibilityState='hidden';f.events.document.get('visibilitychange')();f.intervals.forEach(({fn})=>fn());await f.flush();assert.equal(f.updates.length,count);
 f.document.visibilityState='visible';f.navigator.onLine=false;f.focus(true);f.events.window.get('offline')();await f.flush();const offlineCount=f.updates.length;f.intervals.forEach(({fn})=>fn());await f.flush();assert.equal(f.updates.length,offlineCount);
 f.navigator.onLine=true;f.events.window.get('online')();await f.flush();assert.equal(pings().at(-1).input.active,true);assert.ok(f.updates.length>offlineCount);
 const sequences=pings().map(p=>p.input.sequence);assert.equal(new Set(sequences).size,sequences.length);assert.deepEqual(sequences,[...sequences].sort((a,b)=>a-b));f.cleanup();
});
test('Reconnect/fallback refetch authoritative data; expired presence stops app access',async()=>{
 const f=hookFixture();await f.flush();f.status('SUBSCRIBED');await f.flush();assert.ok(f.updates.includes('tasks'));
 const before=f.updates.filter(x=>x==='tasks').length;[...f.intervals.values()].find(i=>i.ms===30000).fn();await f.flush();assert.equal(f.updates.filter(x=>x==='tasks').length,before+1);f.cleanup();
 const expired=hookFixture({status:401});await expired.flush();assert.ok(expired.updates.includes('expired'));expired.cleanup();
});
function routeFixture({signedIn=true,error=null}={}){const calls=[];const route=load('../src/app/api/presence/route.ts',{'@/lib/supabase/server':{createClient:async()=>({auth:{},rpc:async(name,args)=>{calls.push({name,args});return {data:{current:{id,name:'Example',created_at:stamp,last_seen_at:stamp,active_until:member.activeUntil},members:[{id,name:'Example',created_at:stamp,last_seen_at:stamp,active_until:member.activeUntil}],server_now:stamp},error};}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:id}:null},'@/lib/auth/server':{authOrigin:()=> 'http://127.0.0.1:3003',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/model':model,'@/lib/members/presence':presence,'@/lib/members/server':{MemberError:class extends Error{constructor(status,message){super(message);this.status=status;}}}});return {route,calls};}
const request=(body,origin='http://127.0.0.1:3003',type='application/json')=>new Request('http://127.0.0.1:3003/api/presence',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});
test('Presence API enforces origin/session/bounded payload and uses server-owned RPC identity/time',async()=>{
 const action={tabId:id,active:true,sequence:1},f=routeFixture();for(const [req,status] of [[request(action,'https://other.test'),403],[request(action,undefined,'text/plain'),415],[request('{'),400],[request('x'.repeat(1025)),413],[request({...action,last_seen_at:stamp}),400]])assert.equal((await f.route.POST(req)).status,status);assert.equal(f.calls.length,0);
 assert.equal((await routeFixture({signedIn:false}).route.POST(request(action))).status,401);
 const response=await f.route.POST(request(action));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(model.decodeMemberResponse(await response.json()).serverNow,stamp);assert.equal(f.calls[0].name,'task_app_presence');assert.equal('owner_id' in f.calls[0].args,false);
 assert.equal((await routeFixture({error:{code:'42501'}}).route.POST(request(action))).status,401);
});
