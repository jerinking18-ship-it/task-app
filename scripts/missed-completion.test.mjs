import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function load(file,deps={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts');
const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const period=load('../src/lib/tasks/meeting-period.ts',{'./model':model});
const display=load('../src/lib/members/display-name.ts');
const assignment=load('../src/lib/tasks/assignment.ts',{'./model':model,'./meeting-period':period,'@/lib/members/display-name':display});
const repository=load('../src/lib/tasks/repository.ts',{'./validation':validation,'./model':model});
const id='00000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000002',assignee='00000000-0000-4000-8000-000000000003',stamp='2026-10-15T07:25:00Z';
const base={...model.blankTask(),id,assignedToId:assignee,createdAt:stamp,updatedAt:stamp,title:'Prepare sound',category:'Healing Meeting'};
const row={id,title:'Prepare sound',notes:null,status:'completed',due_date:null,due_time:null,priority:'medium',category_id:null,weekdays:[],assigned_to_member_id:assignee,created_at:stamp,updated_at:stamp,completed_at:stamp,completed_by_member_id:actor,completed_by_name:'Daniel',missed_completion_role:'coordinator'};
test('Missed API accepts only explicit confirmed action and rejects role/fine/actor injection',()=>{
 const action={action:'missed',id,version:stamp,confirmed:true};assert.equal(validation.validateAction(action)?.action,'missed');
 for(const bad of [{...action,confirmed:false},{...action,confirmed:undefined},{...action,actor},{...action,role:'owner'},{...action,amount:0},{...action,id:'bad'},{...action,version:'bad'}])assert.equal(validation.validateAction(bad),null);
});
test('Missed provenance decodes strictly and survives task mapping',()=>{
 const decoded=validation.decodeRow(row),task=model.mapTask(decoded,[]);assert.equal(task.missedCompletionRole,'coordinator');assert.equal(task.completedById,actor);
 for(const bad of [{...row,missed_completion_role:'member'},{...row,status:'active',completed_at:null},{...row,completed_by_member_id:null,completed_by_name:null},{...row,completed_by_member_id:assignee}])assert.throws(()=>validation.decodeRow(bad));
 assert.equal(model.mapTask(validation.decodeRow({...row,missed_completion_role:null}),[]).missedCompletionRole,null);
});
test('Only actual Missed actor can reopen; identical roles confer no access',()=>{
 const task={...base,completed:true,completedById:actor,missedCompletionRole:'coordinator'};
 assert.equal(assignment.canReopenMissed(task,actor),true);
 for(const user of [assignee,id,undefined])assert.equal(assignment.canReopenMissed(task,user),false);
 assert.equal(assignment.canReopenMissed({...task,missedCompletionRole:null},actor),false);
 assert.equal(assignment.canReopenMissed({...task,completed:false},actor),false);
});
test('Missed completion is managerial other-assignee action and excludes coverage/unreleased work',()=>{
 const now=new Date('2026-10-21T19:00:00+05:30');
 for(const role of ['owner','coordinator'])assert.equal(assignment.canCompleteMissed(base,actor,role,now),true);
 for(const [task,user,role]of [[base,actor,'member'],[base,assignee,'owner'],[base,undefined,'owner'],[{...base,assignedToId:null},actor,'owner'],[{...base,completed:true},actor,'owner'],[{...base,availableAt:'2026-10-22T07:25:00Z'},actor,'owner'],[{...base,coverage:{memberId:assignee,expiresAt:'2026-10-22T00:00:00Z'}},actor,'owner']])assert.equal(assignment.canCompleteMissed(task,user,role,now),false);
});
test('role attribution never replaces original assignment, including a previous helper transfer',()=>{
 const task={...base,completed:true,completedById:actor,missedCompletionRole:'coordinator',claimOrigin:{memberId:id,memberName:'Original',takenById:assignee}};
 assert.equal(assignment.completionRoleLabel(task),'Coordinator');assert.equal(assignment.completionRoleLabel({...task,missedCompletionRole:'owner'}),'Owner');
 assert.equal(assignment.assignmentLabel(task,actor,[{id:assignee,name:'Jerin'}]),'Assigned to Jerin');
 assert.equal(assignment.completionRoleLabel({...task,missedCompletionRole:null}),null);
});
test('repository uses dedicated Missed RPC and rejects incomplete success',async()=>{
 const calls=[];let bad=false;
 const client={async rpc(name,args){calls.push({name,args});return {data:name==='task_app_complete_missed'?(bad?{...row,missed_completion_role:null}:row):[],error:null};}};
 const repo=new repository.TaskRepository(client,id);const action={action:'missed',id,version:stamp,confirmed:true};
 assert.equal((await repo.mutate(action)).task.missed_completion_role,'coordinator');assert.equal(calls[0].name,'task_app_complete_missed');assert.equal(calls[0].args.confirmed,true);assert.equal(calls.some(c=>c.name==='task_app_mutate'),false);
 bad=true;await assert.rejects(repo.mutate(action),/could not be confirmed/);
});

test('both roles use exact India 7PM–1AM boundaries for each dated meeting',()=>{
 for(const [category,day,next]of [['Sunday Service','2026-10-18','2026-10-19'],['Healing Meeting','2026-10-21','2026-10-22'],['Revival Meeting','2026-10-23','2026-10-24'],['Special Meeting','2026-10-24','2026-10-25']]){
  const task={...base,category,date:day,time:'23:50'};
  for(const role of ['owner','coordinator']){
   for(const [stamp,want]of [[day+'T18:59:59.999+05:30',false],[day+'T19:00:00+05:30',true],[day+'T23:59:59+05:30',true],[next+'T00:00:00+05:30',true],[next+'T00:59:59.999+05:30',true],[next+'T01:00:00+05:30',false],[next+'T19:00:00+05:30',false]]){
    assert.equal(assignment.canCompleteMissed(task,actor,role,new Date(stamp)),want,category+' '+role+' '+stamp);
   }
  }
 }
});
test('dated occurrences never re-open next week; future work and wrong days stay closed',()=>{
 const task={...base,category:'Sunday Service',date:'2026-10-18'};
 assert.equal(assignment.canReviewMissed(task,actor,'owner',new Date('2026-10-18T18:59:59+05:30')),true);
 assert.equal(assignment.canCompleteMissed(task,actor,'owner',new Date('2026-10-25T19:00:00+05:30')),false);
 assert.equal(assignment.canCompleteMissed({...task,date:'2026-10-25'},actor,'owner',new Date('2026-10-18T19:00:00+05:30')),false);
 assert.equal(assignment.missedCompletionTiming({...task,date:'2026-10-20'},new Date('2026-10-25T19:00:00+05:30')).open,false);
 assert.equal(assignment.missedCompletionTiming({...task,date:'2026-10-19'},new Date('2026-10-19T00:30:00+05:30')).open,true);
 assert.equal(assignment.missedCompletionTiming({...task,date:'2026-10-19'},new Date('2026-10-18T19:00:00+05:30')).open,false);
});
test('undated regular tasks use only current meeting evenings and just-after-midnight',()=>{
 for(const [category,day,next]of [['Sunday Service','2026-10-18','2026-10-19'],['Healing Meeting','2026-10-21','2026-10-22'],['Revival Meeting','2026-10-23','2026-10-24']]){
  const task={...base,category,date:''};
  for(const [stamp,want]of [[day+'T09:00:00+05:30',false],[day+'T19:00:00+05:30',true],[next+'T00:59:59+05:30',true],[next+'T01:00:00+05:30',false],[next+'T19:00:00+05:30',false]])assert.equal(assignment.missedCompletionTiming(task,new Date(stamp)).open,want);
 }
 const sunday={...base,category:'Sunday Service',date:'2026-10-18'};
 assert.equal(assignment.missedCompletionTiming({...sunday,sundayService:'morning'},new Date('2026-10-18T19:00:00+05:30')).open,false);
 assert.equal(assignment.missedCompletionTiming({...sunday,sundayService:'evening'},new Date('2026-10-18T19:00:00+05:30')).open,true);
});
test('undated Special follows selected days or one bounded creation-day window',()=>{
 const task={...base,category:'Special Meeting',date:'',weekdays:[],createdAt:'2026-10-18T20:00:00+05:30'};
 for(const [stamp,want]of [['2026-10-18T19:00:00+05:30',false],['2026-10-18T20:00:00+05:30',true],['2026-10-19T00:59:59+05:30',true],['2026-10-19T01:00:00+05:30',false],['2026-10-25T19:00:00+05:30',false]])assert.equal(assignment.missedCompletionTiming(task,new Date(stamp)).open,want);
 const selected={...task,weekdays:[0,3]};
 for(const stamp of ['2026-10-21T19:00:00+05:30','2026-10-22T00:30:00+05:30'])assert.equal(assignment.missedCompletionTiming(selected,new Date(stamp)).open,true);
 assert.equal(assignment.missedCompletionTiming(selected,new Date('2026-10-22T19:00:00+05:30')).open,false);
 assert.equal(assignment.missedCompletionTiming({...task,category:'Other'},new Date('2026-10-18T20:00:00+05:30')).open,false);
 assert.equal(assignment.missedCompletionTiming({...task,createdAt:'bad'},new Date('2026-10-18T20:00:00+05:30')).open,false);
 assert.equal(assignment.missedCompletionTiming(task,new Date('bad')).open,false);
});
test('server window rejection is readable and never retried as ordinary completion',async()=>{
 const calls=[];const client={async rpc(name){calls.push(name);return{data:null,error:{code:'P0014'}}}};
 const repo=new repository.TaskRepository(client,id);
 await assert.rejects(repo.mutate({action:'missed',id,version:stamp,confirmed:true}),error=>error.status===409&&/7:00 PM/.test(error.message)&&/1:00 AM/.test(error.message));
 assert.equal(calls.length,1);assert.equal(calls[0],'task_app_complete_missed');
});

test('Sunday Morning is 9AM–4PM for both managerial roles',()=>{
 const task={...base,category:'Sunday Service',sundayService:'morning',date:'2026-10-18'};
 for(const role of ['owner','coordinator'])for(const [stamp,want]of [['2026-10-18T08:59:59+05:30',false],['2026-10-18T09:00:00+05:30',true],['2026-10-18T15:59:59+05:30',true],['2026-10-18T16:00:00+05:30',false],['2026-10-18T19:00:00+05:30',false],['2026-10-19T00:30:00+05:30',false],['2026-10-25T10:00:00+05:30',false]])assert.equal(assignment.canCompleteMissed(task,actor,role,new Date(stamp)),want,stamp);
 assert.match(assignment.missedCompletionTiming(task,new Date('2026-10-18T16:00+05:30')).message,/9:00 AM.*4:00 PM/);
});
const absence=load('../src/lib/members/absence.ts');
const membersModel=load('../src/lib/members/model.ts',{'@/lib/tasks/validation':validation});
const workspace=load('../src/lib/workspace/model.ts',{'@/lib/tasks/validation':validation,'@/lib/members/model':membersModel});
const mark={id,memberId:assignee,categoryId:actor,category:'Sunday Service',meetingDate:null,sundayService:'morning',createdAt:'2026-10-18T09:00:00+05:30',expiresAt:'2026-10-20T00:00:00+05:30',restrictionRole:'coordinator',restrictionActorId:actor};
const restrictedState={current:{id:assignee},workspace:{},members:[{id:assignee}],absences:[mark]};
test('restricted absence only locks current own service; completed/old/future work stay separate',()=>{
 const now=new Date('2026-10-18T10:00:00+05:30'),task={...base,category:'Sunday Service',sundayService:'morning',date:'2026-10-18'};
 assert.equal(absence.taskRestriction(task,restrictedState,now)?.restrictionRole,'coordinator');
 for(const changes of [{completed:true},{date:'2026-10-25'},{date:'2026-10-11'},{sundayService:'evening'},{assignedToId:actor},{category:'Healing Meeting'},{availableAt:'2026-10-18T12:00:00+05:30'}])assert.equal(absence.taskRestriction({...task,...changes},restrictedState,now),null);
 assert.equal(absence.taskRestriction(task,restrictedState,new Date('2026-10-20T00:00:00+05:30')),null);
 assert.equal(absence.taskRestriction(task,{...restrictedState,absences:[{...mark,restrictionRole:null}]},now),null);
 assert.equal(absence.canTakeTask({...task,coverage:{memberId:assignee,expiresAt:mark.expiresAt}},{...restrictedState,current:{id:actor}},now),false);
});
test('Special restriction matches only its selected day and keeps role snapshot',()=>{
 const now=new Date('2026-10-18T20:00:00+05:30'),state={...restrictedState,absences:[{...mark,category:'Special Meeting',meetingDate:'2026-10-18',sundayService:null,restrictionRole:'owner'}]};
 assert.equal(absence.taskRestriction({...base,category:'Special Meeting',date:'2026-10-18'},state,now)?.restrictionRole,'owner');
 assert.equal(absence.taskRestriction({...base,category:'Special Meeting',date:'2026-10-19'},state,now),null);
});
test('Remove restriction API requires confirmation/version and forbids actor or role injection',()=>{
 const input={action:'removeRestriction',id,expiresAt:mark.expiresAt,confirmed:true};
 assert.equal(workspace.workspaceAction(input)?.action,'removeRestriction');
 for(const extra of [{confirmed:false},{expiresAt:'bad'},{role:'owner'},{actorId:actor},{memberId:assignee},{sundayService:'evening'}])assert.equal(workspace.workspaceAction({...input,...extra}),null);
 const rpc=workspace.workspaceRpc(input);assert.equal(rpc.name,'task_app_remove_restriction');assert.equal(rpc.args.expected_expires_at,mark.expiresAt);
});
test('member API strictly validates forced-absence provenance',()=>{
 const member={id:assignee,name:'Sarah',createdAt:stamp,lastSeenAt:stamp};
 const state={current:member,members:[member],serverNow:'2026-10-18T10:00:00+05:30',absences:[mark]};
 assert.equal(membersModel.decodeMemberResponse(state).absences[0].restrictionRole,'coordinator');
 for(const changes of [{restrictionRole:'member'},{restrictionActorId:null},{restrictionActorId:'bad'},{restrictionRole:null,restrictionActorId:actor}])assert.throws(()=>membersModel.decodeMemberResponse({...state,absences:[{...mark,...changes}]}));
});
