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
 const now=new Date(stamp);
 for(const role of ['owner','coordinator'])assert.equal(assignment.canCompleteMissed(base,actor,role,now),true);
 for(const [task,user,role]of [[base,actor,'member'],[base,assignee,'owner'],[base,undefined,'owner'],[{...base,assignedToId:null},actor,'owner'],[{...base,completed:true},actor,'owner'],[{...base,availableAt:'2026-10-16T07:25:00Z'},actor,'owner'],[{...base,coverage:{memberId:assignee,expiresAt:'2026-10-16T00:00:00Z'}},actor,'owner']])assert.equal(assignment.canCompleteMissed(task,user,role,now),false);
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

test('dated Missed opens at India midnight, independent of due time, without changing lock review access',()=>{
 const task={...base,date:'2026-10-18',time:'23:50',category:'Sunday Service'};
 const before=new Date('2026-10-17T23:59:59.999+05:30'),at=new Date('2026-10-18T00:00:00+05:30');
 assert.equal(assignment.canReviewMissed(task,actor,'owner',before),true);
 assert.equal(assignment.canCompleteMissed(task,actor,'owner',before),false);
 assert.equal(assignment.canCompleteMissed(task,actor,'owner',at),true);
 assert.equal(assignment.canCompleteMissed(task,actor,'owner',new Date('2026-10-20T12:00:00+05:30')),true);
});
test('undated Missed follows two-day regular windows and bounded Special dates',()=>{
 for(const [category,start,end]of [['Sunday Service','2026-10-18','2026-10-20'],['Healing Meeting','2026-10-21','2026-10-23'],['Revival Meeting','2026-10-23','2026-10-25']]){
  const task={...base,category,date:''};
  assert.equal(assignment.canCompleteMissed(task,actor,'coordinator',new Date(`${start}T00:00:00+05:30`)),true);
  assert.equal(assignment.canCompleteMissed(task,actor,'coordinator',new Date(Date.parse(`${end}T00:00:00+05:30`)-1)),true);
  assert.equal(assignment.canCompleteMissed(task,actor,'coordinator',new Date(`${end}T00:00:00+05:30`)),false);
 }
 const special={...base,category:'Special Meeting',createdAt:'2026-10-18T09:00:00+05:30',date:'',weekdays:[]};
 for(const [stamp,want]of [['2026-10-18T08:59:00+05:30',false],['2026-10-19T23:59:59+05:30',true],['2026-10-20T00:00:00+05:30',false]])assert.equal(assignment.missedCompletionTiming(special,new Date(stamp)).open,want);
 assert.equal(assignment.missedCompletionTiming({...special,weekdays:[3]},new Date('2026-10-22T12:00:00+05:30')).open,true);
});

test('server timing rejection is a readable conflict rather than generic failure',async()=>{
 const client={async rpc(){return{data:null,error:{code:'P0014'}}}};
 const repo=new repository.TaskRepository(client,id);
 await assert.rejects(repo.mutate({action:'missed',id,version:stamp,confirmed:true}),error=>error.status===409&&/scheduled date/.test(error.message));
});
