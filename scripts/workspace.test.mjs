import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(path,deps={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Uint8Array,TextDecoder,Promise,require(name){if(name in deps)return deps[name];if(name==='next/server')return require(name);throw Error(name);}});return exports;}
const tasks=load('../src/lib/tasks/model.ts');const validation=load('../src/lib/tasks/validation.ts',{'./model':tasks});
const members=load('../src/lib/members/model.ts',{'@/lib/tasks/validation':validation});
const model=load('../src/lib/workspace/model.ts',{'@/lib/tasks/validation':validation,'@/lib/members/model':members});
const meeting=load('../src/lib/tasks/meeting-period.ts',{'./model':tasks});
const displayNames=load('../src/lib/members/display-name.ts');
const assignments=load('../src/lib/tasks/assignment.ts',{'./model':tasks,'./meeting-period':meeting,'@/lib/members/display-name':displayNames});
const server=load('../src/lib/members/server.ts',{'./model':members});
const id='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',stamp='2026-10-14T07:25:00Z',token='a'.repeat(64);
const member={id,name:'Jerin',role:'owner',createdAt:stamp,lastSeenAt:stamp};
const state={current:member,members:[member,{...member,id:other,name:'Sarah',role:'member'}],workspace:{id,ownerId:id,name:'BGM Workspace',reservedSeats:0},invitations:[]};
test('roles grant task management only to Owner/Coordinator; status always requires own assignment',()=>{
 for(const role of ['owner','coordinator','member']){const s={...state,current:{...member,role}};assert.equal(members.canManageTasks(s),role!=='member');assert.equal(members.canChangeTaskStatus(s,id),true);assert.equal(members.canChangeTaskStatus(s,other),false);assert.equal(members.canChangeTaskStatus(s,null),false);}
 assert.equal(members.canManageTasks(null),false);assert.equal(members.canManageTasks({...state,workspace:null}),false);
});
test('viewer-relative assignment labels keep completed attribution separate',()=>{
 const task={...tasks.blankTask(),assignedToId:other};assert.equal(assignments.assignmentLabel(task,id,state.members),'Only Sarah can complete');assert.equal(assignments.assignmentLabel(task,other,state.members),'Assigned to me');assert.equal(assignments.assignmentLabel({...task,completed:true},id,state.members),'Assigned to Sarah');assert.equal(assignments.assignmentLabel({...task,assignedToId:null},id,state.members),'Unassigned');
});
test('personal page hides only own expired category work, preserves active future and global lists',()=>{
 const now=new Date('2026-10-12T18:30:01Z');const clock=tasks.accountClock(now,'Asia/Kolkata');const filters={view:'Assigned to me',status:'All',priority:'Any',category:'Any',search:''};
 const task={...tasks.blankTask(),id,title:'Prepare service',category:'Sunday Service',assignedToId:id,createdAt:'2026-10-10T00:00:00Z',date:'2026-10-11',time:'23:50'};
 assert.equal(assignments.matchesAssignedTask(task,id,filters,clock.date,clock.time,now),false);
 assert.equal(tasks.matchesTask(task,{...filters,view:'All tasks'},clock.date,clock.time,now),true);
 assert.equal(assignments.matchesAssignedTask({...task,date:'2026-10-18'},id,filters,clock.date,clock.time,now),true);
 assert.equal(assignments.matchesAssignedTask({...task,date:''},id,filters,clock.date,clock.time,now),true);
 assert.equal(assignments.matchesAssignedTask({...task,date:'2026-10-18'},other,filters,clock.date,clock.time,now),false);
 assert.equal(assignments.matchesAssignedTask(task,undefined,filters,clock.date,clock.time,now),false);
 assert.equal(assignments.matchesAssignedTask({...task,completed:true,completedAt:'2026-10-11T07:25:00Z'},id,filters,clock.date,clock.time,now),false);
 assert.equal(assignments.matchesAssignedTask({...task,date:'2026-10-18',availableAt:'2026-10-17T18:30:00Z'},id,filters,clock.date,clock.time,now),false);
});
test('workspace payload cannot inject identity/owner/role or bypass confirmations',()=>{
 const invite={action:'invite',email:'sarah@example.test',role:'member'};
 assert.ok(model.workspaceAction(invite));assert.ok(model.workspaceAction({action:'accept',token,name:' Sarah  Mary '}));
 for(const action of [{...invite,role:'owner'},{...invite,owner_id:id},{...invite,email:'bad'},{action:'accept',token,name:'Bad\nName'},{action:'accept',token,name:'Sarah',role:'owner'},{action:'role',id,role:'owner',previousRole:'member',confirmed:true},{action:'transfer',id},{action:'transfer',id,confirmed:false},{action:'revoke',id,confirmed:true,userId:other}])assert.equal(model.workspaceAction(action),null);
 assert.equal(model.workspaceRpc({action:'transfer',id,confirmed:true}).name,'task_app_transfer_owner');
});
test('workspace decoder preserves roles/invitation metadata and rejects inconsistent privilege responses',()=>{
 assert.equal(members.decodeMemberResponse(state).current.role,'owner');
 for(const data of [{...state,current:{...member,role:'coordinator'}},{...state,workspace:{...state.workspace,reservedSeats:9}},{...state,members:[{...member,role:'administrator'}]},{...state,invitations:[{id,email:'x',role:'owner',expiresAt:stamp}]}])assert.throws(()=>members.decodeMemberResponse(data));
});
function fixture({signedIn=true,error=null}={}){
 const calls=[];const client={auth:{},rpc:async(name,args)=>{calls.push({name,args});return {data:{token,expires_at:stamp,id},error};}};
 const route=load('../src/app/api/workspace/route.ts',{'@/lib/auth/server':{authOrigin:()=> 'https://app.example.test',AUTH_HEADERS:{'Cache-Control':'private, no-store'}},'@/lib/supabase/server':{createClient:async()=>client},'@/lib/auth/flow':{verifiedIdentity:async()=>signedIn?{userId:id}:null},'@/lib/members/server':server,'@/lib/members/model':members,'@/lib/tasks/validation':validation,'@/lib/workspace/model':model});return {route,calls};
}
const request=(body,origin='https://app.example.test',type='application/json')=>new Request('https://app.example.test/api/workspace',{method:'POST',headers:{origin,'Content-Type':type},body:typeof body==='string'?body:JSON.stringify(body)});
test('workspace API rejects anonymous, cross-origin, oversize and injected requests before mutation',async()=>{
 const action={action:'invite',email:'sarah@example.test',role:'member'};const anon=fixture({signedIn:false});assert.equal((await anon.route.POST(request(action))).status,401);assert.equal(anon.calls.length,0);
 const f=fixture();for(const [req,status]of [[request(action,'https://other.example.test'),403],[request(action,undefined,'text/plain'),415],[request('x'.repeat(4097)),413],[request('{'),400],[request({...action,owner_id:id}),400]])assert.equal((await f.route.POST(req)).status,status);assert.equal(f.calls.length,0);
});
test('workspace API uses fixed RPC mappings, private cache policy, sanitized denied role errors',async()=>{
 const action={action:'invite',email:'sarah@example.test',role:'member'};const f=fixture();const response=await f.route.POST(request(action));assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.equal(f.calls[0].name,'task_app_invite');assert.equal('owner_id'in f.calls[0].args,false);
 for(const [code,status]of [['P0403',403],['P0409',409],['P0010',409],['42501',401],['XX000',503]]){const denied=fixture({error:{code,message:'private-provider-detail'}});const result=await denied.route.POST(request(action));assert.equal(result.status,status);assert.equal((await result.text()).includes('private-provider-detail'),false);}
});

test('completed coverage task displays original assignee for everyone, preserving helper permissions and author',()=>{
 const task={...tasks.blankTask(),assignedToId:id,completed:true,completedById:id,completedByName:'Jerin',claimOrigin:{memberId:other,memberName:'Sarah',takenById:id}};
 for(const viewer of [id,other,undefined])assert.equal(assignments.assignmentLabel(task,viewer,state.members),'Assigned to Sarah');
 assert.equal(members.canChangeTaskStatus(state,task.assignedToId),true);
 assert.equal(members.canChangeTaskStatus({...state,current:state.members[1]},task.assignedToId),false);
 assert.equal(assignments.assignmentLabel({...task,completed:false},id,state.members),'Assigned to me');
 assert.equal(assignments.assignmentLabel({...task,claimOrigin:null},id,state.members),'Assigned to me');
 assert.equal(assignments.assignmentLabel({...task,assignedToId:other},other,state.members),'Assigned to me');
 assert.equal(task.completedByName,'Jerin');
});

test('renamed profiles resolve cached attribution by identity while preserving snapshots and former-member fallback',()=>{
 const directory=[{id,name:'Jerin New'},{id:other,name:'Sarah New'}];
 assert.equal(displayNames.displayMemberName(id,'Jerin',directory),'Jerin New');
 assert.equal(displayNames.displayMemberName(other,'Sarah',directory),'Sarah New');
 assert.equal(displayNames.displayMemberName('00000000-0000-4000-8000-000000000099','Former name',directory),'Former name');
 assert.equal(displayNames.displayMemberName(null,'Legacy name',directory),'Legacy name');
 assert.equal(displayNames.displayMemberName(null,null,directory),null);
 const completion={...tasks.blankTask(),assignedToId:id,completed:true,completedById:id,completedByName:'Jerin',completedAt:stamp,claimOrigin:{memberId:other,memberName:'Sarah',takenById:id}};
 const before=JSON.stringify(completion);
 assert.equal(assignments.assignmentLabel(completion,id,directory),'Assigned to Sarah New');
 assert.equal(displayNames.displayMemberName(completion.completedById,completion.completedByName,directory),'Jerin New');
 assert.equal(JSON.stringify(completion),before);
 assert.equal(members.canChangeTaskStatus(state,completion.assignedToId),true);
 assert.equal(displayNames.displayMemberName(other,'Jerin',[{id,name:'Different person'}]),'Jerin');
});

test('Changed completion requires the actual helper author and original assignee provenance',()=>{
 const completed={...tasks.blankTask(),completed:true,assignedToId:id,completedById:id,claimOrigin:{memberId:other,memberName:'Sarah',takenById:id}};
 assert.equal(assignments.isChangedCompletion(completed),true);
 for(const patch of [{completed:false},{claimOrigin:null},{completedById:other},{completedById:null},{assignedToId:other},{claimOrigin:{...completed.claimOrigin,memberId:id}}])assert.equal(assignments.isChangedCompletion({...completed,...patch}),false);
});

test('Assigned Special Meeting section partitions only the viewer’s retained tasks',()=>{
 const now=new Date('2026-10-16T12:00:00+05:30'),clock=tasks.accountClock(now,'Asia/Kolkata'),filters={view:'Assigned to me',status:'All',priority:'Any',category:'Any',search:''};
 const base={...tasks.blankTask(),assignedToId:id,createdAt:'2026-10-16T04:00:00Z',date:'2026-10-16',time:'23:50'};
 const rows=[{...base,id:'regular',category:'Revival Meeting'},{...base,id:'special',category:'Special Meeting'},{...base,id:'other-person',category:'Special Meeting',assignedToId:other}];
 const selected=scope=>rows.filter(row=>assignments.matchesAssignedTask(row,id,filters,clock.date,clock.time,now,scope)).map(row=>row.id);
 assert.deepEqual(selected('regular'),['regular']);assert.deepEqual(selected('special'),['special']);assert.deepEqual(selected(undefined),['regular','special']);
 assert.equal(assignments.matchesAssignedTask(rows[1],id,{...filters,status:'Completed'},clock.date,clock.time,now,'special'),false);
 assert.equal(assignments.matchesAssignedTask({...rows[1],completed:true,completedAt:now.toISOString()},id,{...filters,status:'Completed'},clock.date,clock.time,now,'special'),true);
 assert.equal(assignments.matchesAssignedTask(rows[1],id,{...filters,search:'no match'},clock.date,clock.time,now,'special'),false);
});
test('Special assigned sections keep existing midnight expiry and future-task rules',()=>{
 const filters={view:'Assigned to me',status:'All',priority:'Any',category:'Any',search:''},task={...tasks.blankTask(),assignedToId:id,category:'Special Meeting',createdAt:'2026-10-16T04:00:00Z',date:'2026-10-16',time:'23:50'};
 const visible=(row,stamp)=>{const now=new Date(stamp),clock=tasks.accountClock(now,'Asia/Kolkata');return assignments.matchesAssignedTask(row,id,filters,clock.date,clock.time,now,'special');};
 assert.equal(visible(task,'2026-10-17T23:59:59+05:30'),true);assert.equal(visible(task,'2026-10-18T00:00:00+05:30'),false);
 assert.equal(visible({...task,completed:true,completedAt:'2026-10-16T10:00:00Z'},'2026-10-18T00:00:00+05:30'),false);
 assert.equal(visible({...task,date:'2026-10-25'},'2026-10-18T00:00:00+05:30'),true);
 assert.equal(visible({...task,date:''},'2026-10-18T00:00:00+05:30'),true);
});
