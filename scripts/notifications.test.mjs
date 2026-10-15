import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createRequire}from'node:module';import vm from'node:vm';import test from'node:test';import ts from'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={},globals={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,URL,TextDecoder,Uint8Array,Request,Response,Promise,...globals,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':tasks}),model=load('../src/lib/notifications/model.ts',{'@/lib/tasks/validation':validation,'@/lib/tasks/model':tasks});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,stamp='2026-10-15T07:25:00Z';
const pref={availability:true,coverageUpdates:true,reassignments:true};
const notice={id:id(1),kind:'task_available',taskId:id(2),title:'Arrange seating',category:'Healing Meeting',actorName:'Sarah',payload:{absenceId:id(9)},createdAt:stamp,readAt:null,taskAvailable:true,canTake:true,takenBy:null,canRequest:false,requestId:null,requestStatus:null};
const requestRow={id:id(5),taskId:id(2),title:'Prepare sound',requesterId:id(4),requesterName:'Jerin',reviewerId:id(3),reviewerName:'Daniel',completedAt:stamp,reason:'Work needs correction',status:'pending',createdAt:stamp,version:stamp,unavailableReason:null,canReview:true};
const data={serverNow:stamp,currentId:id(3),preferences:pref,entries:[notice],requests:[requestRow]};
const repoTypes=load('../src/lib/tasks/repository.ts',{'./model':tasks,'./validation':validation});const repository=load('../src/lib/notifications/repository.ts',{'@/lib/tasks/repository':repoTypes,'@/lib/tasks/validation':validation,'./model':model});
test('notification actions require strict recipient-free schemas and explicit consequential confirmation',()=>{
 for(const action of[{action:'read',ids:[id(1)]},{action:'preferences',preferences:pref},{action:'preview_clear'},{action:'clear',count:1,snapshot:'a'.repeat(32),confirmed:true},{action:'request',taskId:id(2),completedAt:stamp,reason:'Work needs correction',confirmed:true},{action:'review',id:id(5),version:stamp,decision:'approved',confirmed:true}])assert.ok(model.notificationAction(action));
 for(const action of[{action:'read',ids:[id(1),id(1)]},{action:'read',ids:[id(1)],recipientId:id(4)},{action:'clear',count:1,snapshot:'a'.repeat(32),confirmed:false},{action:'request',taskId:id(2),completedAt:stamp,reason:'Free chat',confirmed:true},{action:'review',id:id(5),version:stamp,decision:'approved',confirmed:true,reviewerId:id(99)},{action:'preferences',preferences:{...pref,fines:false}},{action:'mark_all_read'},{action:'assigned'},{action:'repeat_ready'}])assert.equal(model.notificationAction(action),null);
});
test('inbox decoder validates provenance, privacy, complete data and reviewer-only action',()=>{
 assert.equal(model.decodeNotifications(data).requests[0].canReview,true);
 for(const bad of[{...data,entries:[notice,notice]},{...data,requests:[{...requestRow,requesterId:id(99),reviewerId:id(98)}]},{...data,requests:[{...requestRow,canReview:false}]},{...data,entries:[{...notice,kind:'assigned'}]},{...data,entries:[{...notice,kind:'missed',payload:{completedAt:stamp,role:'member'}}]}])assert.throws(()=>model.decodeNotifications(bad));
});
test('preference filtering hides routine notices only; all/unread/requests/pending are separate counters',()=>{
 const entries=[notice,{...notice,id:id(6),kind:'role_changed',payload:{role:'coordinator',previousRole:'member'}},{...notice,id:id(7),kind:'fine_applied',readAt:stamp,payload:{fineId:id(19),amountPaise:5000,status:'unpaid'}}];
 const decoded=model.decodeNotifications({...data,entries,preferences:{availability:false,coverageUpdates:false,reassignments:false}});
 assert.equal(model.visibleNotifications(decoded).length,2);const counts=model.notificationCounts(decoded);assert.equal(counts.all,2);assert.equal(counts.unread,1);assert.equal(counts.requests,1);assert.equal(counts.pending,1);
 const cleared=model.notificationCounts({...decoded,entries:[]});assert.equal(cleared.all,0);assert.equal(cleared.unread,0);assert.equal(cleared.requests,1);assert.equal(cleared.pending,1);
 const seen=model.notificationCounts({...decoded,entries:decoded.entries.map(n=>({...n,readAt:stamp}))});assert.equal(seen.unread,0);assert.equal(seen.pending,1);
});
test('message copy follows app events and uses role-only Missed actor while excluding creation/ready events',()=>{
 assert.equal(model.notificationCopy({...notice,kind:'missed',actorName:'Hidden name',payload:{role:'coordinator'}}).body,'A Coordinator completed this task as Missed.');
 assert.equal(model.notificationCopy({...notice,kind:'missed',payload:{role:'owner'}}).body,'An Owner completed this task as Missed.');
 assert.equal(model.KINDS.includes('assigned'),false);assert.equal(model.KINDS.includes('repeat_ready'),false);
 assert.match(model.notificationCopy({...notice,kind:'overdue'}).body,/passed its due time/);
 assert.equal(model.messageAge('2026-10-14T18:30:00Z',new Date('2026-10-15T12:00:00+05:30')),'Today');
 assert.equal(model.messageAge('2026-10-14T18:29:59Z',new Date('2026-10-15T12:00:00+05:30')),'Yesterday');
});
test('notification repository uses fixed private RPC mappings and validates server acknowledgements',async()=>{
 const calls=[];const client={async rpc(name,args){calls.push({name,args});return {data:name==='task_app_notifications'?data:name==='task_app_notification_snapshot'?{count:2,snapshot:'a'.repeat(32)}:name==='task_app_read_notifications'?{marked:[{id:id(1),readAt:stamp}]}:name==='task_app_review_reopening'?{id:id(5),status:'approved'}:null,error:null};}};
 const repo=new repository.NotificationsRepository(client);await repo.read();await repo.mutate({action:'read',ids:[id(1)]});await repo.mutate({action:'preview_clear'});await repo.mutate({action:'review',id:id(5),version:stamp,decision:'approved',confirmed:true});
 assert.equal(calls[3].name,'task_app_review_reopening');assert.equal(calls[3].args.confirmed,true);for(const call of calls)assert.equal('recipient_id'in (call.args??{}),false);
 await assert.rejects(new repository.NotificationsRepository({rpc:async()=>({data:{deleted:0},error:null})}).mutate({action:'clear',count:2,snapshot:'a'.repeat(32),confirmed:true}),/Incomplete confirmation/);
});
class MemberError extends Error{constructor(status,message){super(message);this.status=status;}}
function api({signed=true,selected=true}={}){let reads=0,writes=0;const route=load('../src/app/api/notifications/route.ts',{'@/lib/supabase/server':{createClient:async()=>({auth:{}})},'@/lib/auth/flow':{verifiedIdentity:async()=>signed?{userId:id(3)}:null},'@/lib/auth/server':{authOrigin:()=> 'http://127.0.0.1:3003',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/members/server':{MemberError,readMembers:async()=>({current:selected?{id:id(3),role:'member'}:null,workspace:{ownerId:id(9)}})},'@/lib/tasks/repository':repoTypes,'@/lib/notifications/model':model,'@/lib/notifications/repository':{NotificationsRepository:class{async read(){reads++;return data;}async mutate(){writes++;return {saved:true};}}}});return {route,counts:()=>({reads,writes})};}
const post=(body,origin='http://127.0.0.1:3003',type='application/json')=>new Request('http://127.0.0.1:3003/api/notifications',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});
test('notification API admits verified Members to own inbox but rejects anonymous, CSRF and injected requests',async()=>{
 for(const options of[{signed:false},{selected:false}]){const f=api(options);assert.ok((await f.route.GET()).status>=400);assert.equal(f.counts().reads,0);}
 const f=api();const read=await f.route.GET();assert.equal(read.status,200);assert.match(read.headers.get('cache-control'),/private/);
 for(const [r,status]of[[post({action:'preview_clear'},'https://other.test'),403],[post({action:'preview_clear'},undefined,'text/plain'),415],[post('{'),400],[post('x'.repeat(8193)),413],[post({action:'read',ids:[id(1)],recipient:id(99)}),400]])assert.equal((await f.route.POST(r)).status,status);
 assert.equal(f.counts().writes,0);assert.equal((await f.route.POST(post({action:'preferences',preferences:pref}))).status,200);
});
test('notification panel renders icon-only toolbar, three counters, disabled Taken and request-only permissions',()=>{
 const React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server'),icons=load('../src/components/notifications/notification-icons.tsx',{'react/jsx-runtime':jsx});
 const Panel=load('../src/components/notifications/notifications-panel.tsx',{'react':React,'react/jsx-runtime':jsx,'@/lib/notifications/model':model,'./notification-icons':icons,'./use-viewed-messages':{useViewedMessages(){}},'./notifications.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})}}).default;
 const html=renderToStaticMarkup(React.createElement(Panel,{store:{data:model.decodeNotifications({...data,entries:[{...notice,canTake:false,takenBy:'Sarah'}]}),loading:false,pending:false,error:'',deferred:false,mutate:async()=>({}),refresh(){}},now:new Date(stamp),blocked:false,onBack(){},onTask(){},onTake(){},onProfile(){},onDirty(){},onPending(){},onChanged(){}}));
 assert.match(html,/aria-label="Notification preferences"/);assert.match(html,/aria-label="Clear all messages"/);assert.match(html,/Taken by Sarah/);assert.doesNotMatch(html,/Mark all as read/);assert.match(html,/Unread/);assert.match(html,/Requests/);
});
test('automatic read waits for focused visible dwell, excludes offscreen notices and deduplicates IDs',async()=>{
 let tick,observe,cleanup,clock=0,focus=false,visibility='visible',marked=[],disconnected=false;
 const elements=[1,2,3].map(n=>({getAttribute(){return id(n);}}));
 const FakeDate=class extends Date{static now(){return clock;}};
 const fakeDocument={get visibilityState(){return visibility;},hasFocus(){return focus;}};
 const hooks=load('../src/components/notifications/use-viewed-messages.ts',{'react':{useRef:value=>({current:value}),useEffect:callback=>{cleanup=callback();}}},{Date:FakeDate,document:fakeDocument,window:{setInterval(callback){tick=callback;return 1;},clearInterval(){}},IntersectionObserver:class{constructor(callback){observe=callback;}observe(){}disconnect(){disconnected=true;}}});
 hooks.useViewedMessages({current:{querySelectorAll(){return elements;}}},[id(1),id(2),id(3)],true,async ids=>{marked.push(ids);},e=>assert.fail(e),'All:50');
 observe([{target:elements[0],isIntersecting:true,intersectionRatio:.8},{target:elements[1],isIntersecting:true,intersectionRatio:.3},{target:elements[2],isIntersecting:false,intersectionRatio:0}]);
 clock=3000;tick();assert.equal(marked.length,0);focus=true;clock=3500;tick();assert.equal(marked.length,0);
 clock=4200;tick();await Promise.resolve();await Promise.resolve();assert.deepEqual(Array.from(marked[0]),[id(1)]);
 clock=6000;tick();assert.equal(marked.length,1);visibility='hidden';observe([{target:elements[1],isIntersecting:true,intersectionRatio:1}]);clock=8000;tick();assert.equal(marked.length,1);
 visibility='visible';clock=8500;tick();assert.equal(marked.length,1);clock=9100;tick();await Promise.resolve();await Promise.resolve();assert.deepEqual(Array.from(marked[1]),[id(2)]);assert.equal(marked.length,2);
 cleanup();assert.equal(disconnected,true);
});
test('request review layout shows decisions only to the recorded completer',()=>{
 const React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server'),icons=load('../src/components/notifications/notification-icons.tsx',{'react/jsx-runtime':jsx});
 const selectedReact={...React,useState(value){return React.useState(value==='All'?'Requests':value);}};
 const Panel=load('../src/components/notifications/notifications-panel.tsx',{'react':selectedReact,'react/jsx-runtime':jsx,'@/lib/notifications/model':model,'./notification-icons':icons,'./use-viewed-messages':{useViewedMessages(){}},'./notifications.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})}}).default;
 function render(currentId,canReview){return renderToStaticMarkup(React.createElement(Panel,{store:{data:model.decodeNotifications({...data,currentId,requests:[{...requestRow,canReview}]}),loading:false,pending:false,error:'',deferred:false,mutate:async()=>({}),refresh(){}},now:new Date(stamp),blocked:false,onBack(){},onTask(){},onTake(){},onProfile(){},onDirty(){},onPending(){},onChanged(){}}));}
 const incoming=render(id(3),true);assert.match(incoming,/Approve reopening/);assert.match(incoming,/Decline/);assert.match(incoming,/Existing ₹50 fine stays unchanged/);assert.match(incoming,/Work needs correction/);
 const outgoing=render(id(4),false);assert.doesNotMatch(outgoing,/Approve reopening/);assert.doesNotMatch(outgoing,/>Decline</);assert.match(outgoing,/Review request/);
});
