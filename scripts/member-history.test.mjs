import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,URL,TextDecoder,Uint8Array,JSON,...globals,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts');
const validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const periods=load('../src/lib/tasks/meeting-period.ts',{'./model':tasks});
const model=load('../src/lib/member-history/model.ts',{'@/lib/tasks/model':tasks,'@/lib/tasks/validation':validation,'@/lib/tasks/meeting-period':periods});
const errors=load('../src/lib/tasks/repository.ts',{'./model':tasks,'./validation':validation});
const {MemberHistoryRepository}=load('../src/lib/member-history/repository.ts',{'./model':model,'@/lib/tasks/repository':errors});
const id='00000000-0000-4000-8000-000000001001',other='00000000-0000-4000-8000-000000001002',taskId='00000000-0000-4000-8000-000000001003';
const data={serverNow:'2026-10-12T18:19:59Z',members:[{id,name:'Daniel'},{id:other,name:'Grace'}],totals:[{memberId:id,year:2026,count:125},{memberId:other,year:2026,count:7}],entries:[{id:taskId,memberId:id,title:'Task',notes:'Notes',category:'Sunday Service',completedAt:'2026-10-11T07:25:00Z',expiresAt:'2026-10-12T18:20:00Z'}],specialWindows:[]};
test('History response validates complete owner-scoped member joins, receipts and exact safe totals',()=>{
 assert.equal(model.decodeMemberHistory(data).totals[0].count,125);
 for(const bad of [{...data,members:[data.members[0],data.members[0]]},{...data,totals:[data.totals[0],data.totals[0]]},{...data,totals:[{memberId:taskId,year:2026,count:1}]},{...data,totals:[{...data.totals[0],count:Number.MAX_SAFE_INTEGER+1}]},{...data,entries:[{...data.entries[0],memberId:taskId}]},{...data,entries:[{...data.entries[0],expiresAt:'bad'}]},{...data,entries:[data.entries[0],data.entries[0]]},{...data,specialWindows:undefined},{...data,specialWindows:[{startsAt:'bad',endsAt:data.serverNow}]}])assert.throws(()=>model.decodeMemberHistory(bad));
});
test('Weekly category rotation switches at exactly 23:50 India time across all three boundaries',()=>{
 for(const [time,category] of [['2026-10-12T18:19:59.999Z','Sunday Service'],['2026-10-12T18:20:00Z','Healing Meeting'],['2026-10-15T18:19:59Z','Healing Meeting'],['2026-10-15T18:20:00Z','Revival Meeting'],['2026-10-16T18:19:59Z','Revival Meeting'],['2026-10-16T18:20:00Z','Revival Meeting'],['2026-10-17T18:19:59Z','Revival Meeting'],['2026-10-17T18:20:00Z','Sunday Service']])assert.equal(model.regularSchedule(new Date(time)).category,category);
 assert.equal(model.regularSchedule(new Date('2026-10-12T18:20:00Z')).resetAt,'2026-10-15T18:20:00.000Z');
});
test('Year label and total switch at India New Year while category history can remain visible',()=>{
 const before=new Date('2026-12-31T18:29:59.999Z'),after=new Date('2026-12-31T18:30:00Z');
 assert.equal(model.historyYear(before),2026);assert.equal(model.historyYear(after),2027);assert.equal(model.yearlyTotal(data,id,before),125);assert.equal(model.yearlyTotal(data,id,after),0);assert.equal(model.yearlyTotal(data,other,before),7);
 const rows={...data,entries:[{...data.entries[0],category:'Healing Meeting',completedAt:'2026-12-31T07:25:00Z',expiresAt:'2027-01-01T18:20:00Z'}]};
 assert.equal(model.visibleCompletions(rows,id,'Healing Meeting',before).length,1);assert.equal(model.visibleCompletions(rows,id,'Healing Meeting',after).length,1);
});
test('Only selected member/category unexpired completions appear; cutoff removes rows but never yearly total',()=>{
 assert.equal(model.visibleCompletions(data,id,'Sunday Service',new Date(data.serverNow)).length,1);assert.equal(model.visibleCompletions(data,other,'Sunday Service',new Date(data.serverNow)).length,0);assert.equal(model.visibleCompletions(data,id,'Healing Meeting',new Date(data.serverNow)).length,0);
 assert.equal(model.visibleCompletions(data,id,'Sunday Service',new Date('2026-10-12T18:20:00Z')).length,0);assert.equal(model.yearlyTotal({...data,entries:[]},id,new Date(data.serverNow)),125);
});
test('Scheduled Special Meetings never replace the regular category, including exact weekly cutoffs',()=>{
 const rows={...data,specialWindows:[{startsAt:'2026-10-12T18:30:00Z',endsAt:'2026-10-18T18:20:00Z'}]};
 for(const [time,category] of [['2026-10-12T18:30:00Z','Healing Meeting'],['2026-10-15T18:19:59Z','Healing Meeting'],['2026-10-15T18:20:00Z','Revival Meeting'],['2026-10-16T18:20:00Z','Revival Meeting'],['2026-10-17T18:20:00Z','Sunday Service']])assert.equal(model.reportSchedule(rows,new Date(time)).category,category);
 assert.equal(model.reportSchedule(rows,new Date('2026-10-14T12:00:00Z')).resetAt,'2026-10-15T18:20:00.000Z');
});
test('Special completion deadlines stay independent across overlapping days and trigger timely refresh',()=>{
 const special=(id,expiresAt)=>({...data.entries[0],id,category:'Special Meeting',completedAt:'2026-10-13T07:25:00Z',expiresAt});
 const rows={...data,entries:[special(taskId,'2026-10-14T18:20:00Z'),special(other,'2026-10-15T18:20:00Z')],specialWindows:[{startsAt:'2026-10-12T18:30:00Z',endsAt:'2026-10-15T18:20:00Z'}]};
 const before=new Date('2026-10-14T18:19:59Z'),after=new Date('2026-10-14T18:20:00Z');
 assert.equal(model.reportSchedule(rows,before).boundary,'2026-10-14T18:20:00.000Z');
 assert.equal(model.visibleCompletions(rows,id,'Special Meeting',before).length,2);
 const remaining=model.visibleCompletions(rows,id,'Special Meeting',after);assert.equal(remaining.length,1);
 assert.equal(model.specialResetLabel(remaining),'Next clears Thursday, Oct 15 · 11:50 PM IST');
 assert.equal(model.reportSchedule(rows,after).category,'Healing Meeting');
 assert.equal(model.yearlyTotal(rows,id,after),125);
 assert.equal(rows.entries[0].expiresAt,'2026-10-14T18:20:00Z');
});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const Panel=load('../src/components/members/member-history-panel.tsx',{'@/lib/members/display-name':load('../src/lib/members/display-name.ts'),'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/member-history/model':model,'./member-history.module.css':{default:new Proxy({},{get:(_,name)=>String(name)})}}).default;
function renderHistory(rows,member=id,hasSpecialTasks=false){return renderToStaticMarkup(React.createElement(Panel,{data:rows,now:new Date('2026-10-14T07:25:00Z'),loading:false,error:'',currentMemberId:member,hasSpecialTasks,onRefresh(){}}));}
test('Report renders only the period category followed by separate Special entries for the selected member',()=>{
 const entry=(memberId,category,title,index)=>({...data.entries[0],id:String(index),memberId,category,title,completedAt:'2026-10-14T07:00:00Z',expiresAt:'2026-10-15T18:20:00Z'});
 const rows={...data,entries:[entry(id,'Healing Meeting','Daniel healing',1),entry(id,'Sunday Service','Daniel Sunday',2),entry(id,'Special Meeting','Daniel special',3),entry(other,'Healing Meeting','Grace healing',4),entry(other,'Special Meeting','Grace special',5)]};
 for(const [member,name,notName] of [[id,'Daniel','Grace'],[other,'Grace','Daniel']]){
  const html=renderHistory(rows,member);assert.ok(html.indexOf('Healing Meeting completed history')<html.indexOf('Special Meeting completed history'));
  assert.match(html,new RegExp(name+' healing'));assert.match(html,new RegExp(name+' special'));
  assert.doesNotMatch(html,new RegExp(notName+' healing|'+notName+' special|Daniel Sunday'));
  assert.match(html,/<strong class="number">2<\/strong><span class="statLabel">Visible history/);
 }
});
test('Special section is conditional, shows an empty state for active/no-date tasks and does not inflate visible count',()=>{
 const rows={...data,entries:[],specialWindows:[]};
 assert.doesNotMatch(renderHistory(rows),/Special Meeting completed history/);
 const active=renderHistory(rows,id,true);assert.match(active,/Special Meeting completed history/);assert.match(active,/Completed Special Meeting tasks will appear here/);
 assert.match(active,/<strong class="number">0<\/strong><span class="statLabel">Visible history/);
 const scheduled={...rows,specialWindows:[{startsAt:'2026-10-15T18:30:00Z',endsAt:'2026-10-17T18:20:00Z'}]};
 assert.match(renderHistory(scheduled),/Special Meeting completed history/);
 const expired={...rows,entries:[{...data.entries[0],category:'Special Meeting'}]};assert.doesNotMatch(renderHistory(expired),/Special Meeting completed history/);
});
test('Completion formatting uses India timestamp and weekday',()=>{assert.equal(model.completionTime('2026-10-14T07:25:00Z'),'Oct 14 · 12:55 PM · Wed');});
test('Repository calls only the authenticated read RPC and never accepts corrupt or private provider errors',async()=>{
 const calls=[];const r=new MemberHistoryRepository({rpc:async(...args)=>{calls.push(args);return {data,error:null};}});assert.equal((await r.read()).totals[0].count,125);assert.equal(calls.length,1);assert.equal(calls[0][0],'task_app_member_history');assert.equal(calls[0].length,1);
 await assert.rejects(()=>new MemberHistoryRepository({rpc:async()=>({data:null,error:{code:'42501'}})}).read(),e=>e.status===401);
 await assert.rejects(()=>new MemberHistoryRepository({rpc:async()=>({data:null,error:{code:'private-provider-detail'}})}).read(),e=>e.status===503&&!e.message.includes('private-provider'));
 await assert.rejects(()=>new MemberHistoryRepository({rpc:async()=>({data:{...data,entries:null},error:null})}).read(),e=>e.status===503);
});
function routeFixture({signedIn=true,selected=true}={}){let calls=0;const route=load('../src/app/api/member-history/route.ts',{'@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:id}:null},'@/lib/auth/server':{AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError:class extends Error{},readMembers:async()=>({current:selected?{id}:null})},'@/lib/tasks/repository':errors,'@/lib/member-history/repository':{MemberHistoryRepository:class{async read(){calls++;return data;}}}});return {route,calls:()=>calls};}
test('Read-only history API requires authenticated selected member, returns private no-store and exposes no write method',async()=>{
 for(const [options,status] of [[{signedIn:false},401],[{selected:false},403]]){const f=routeFixture(options);assert.equal((await f.route.GET()).status,status);assert.equal(f.calls(),0);}
 const f=routeFixture(),response=await f.route.GET();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(model.decodeMemberHistory(await response.json()).totals[0].count,125);assert.equal(f.route.POST,undefined);
});
function hookFixture({blocked=false,status=200}={}){const effects=[],states=[],calls=[];let index=0;const react={useRef:value=>({current:value}),useState:value=>{const i=index++;states[i]=value;return [value,next=>{states[i]=typeof next==='function'?next(states[i]):next;}];},useEffect:fn=>effects.push(fn),useCallback:fn=>fn};const hook=load('../src/lib/member-history/use-member-history.ts',{'react':react,'./model':model,'@/lib/tasks/validation':validation},{AbortController,AbortSignal,fetch:async(url,init)=>{calls.push({url,init});return {ok:status===200,status,json:async()=>status===200?data:{message:'Load unavailable'}};}});const api=hook.useMemberHistory(true,blocked),cleanup=effects.map(fn=>fn());return {api,states,calls,settle:()=>new Promise(setImmediate),cleanup:()=>cleanup.forEach(fn=>fn?.())};}
test('History reads defer during dirty work, never POST, retain authoritative totals and recognize session expiry',async()=>{
 const blocked=hookFixture({blocked:true});await blocked.settle();assert.equal(blocked.calls.length,0);blocked.cleanup();
 const f=hookFixture();await f.settle();assert.equal(f.states[0].totals[0].count,125);assert.ok(f.calls.every(call=>call.url==='/api/member-history'&&!call.init.method));f.cleanup();
 const expired=hookFixture({status:401});await expired.settle();assert.equal(expired.states[3],true);expired.cleanup();
});

test('history selector uses accepted current member names even while history data still carries old names',()=>{
 const html=renderToStaticMarkup(React.createElement(Panel,{data,now:new Date('2026-10-14T07:25:00Z'),loading:false,error:'',currentMemberId:id,currentMembers:[{id,name:'Updated member'}],onRefresh(){}}));
 assert.match(html,/<option[^>]*>Updated member/);
 assert.equal(model.yearlyTotal(data,id,new Date('2026-10-14T07:25:00Z')),model.yearlyTotal({...data,members:data.members.map(m=>m.id===id?{...m,name:'Updated member'}:m)},id,new Date('2026-10-14T07:25:00Z')));
});
