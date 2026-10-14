import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,deps={}){
 const {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const exports={};vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,Promise,require(name){if(name in deps)return deps[name];throw Error('Unexpected dependency '+name);}});return exports;
}
const model=load('../src/lib/tasks/model.ts');
const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const members=load('../src/lib/members/model.ts',{'@/lib/tasks/validation':validation});
const absence=load('../src/lib/members/absence.ts');
const workspace=load('../src/lib/workspace/model.ts',{'@/lib/tasks/validation':validation,'@/lib/members/model':members});
const repository=load('../src/lib/tasks/repository.ts',{'./model':model,'./validation':validation});
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const stamp='2026-10-14T06:00:00Z',end='2026-10-15T18:20:00Z';
const person={id:id(2),name:'Sarah',role:'member',createdAt:stamp,lastSeenAt:stamp};
const helper={...person,id:id(3),name:'Jerin',role:'owner'};
const state={current:helper,members:[person,helper],workspace:{id:id(1),ownerId:id(1),name:'Team',reservedSeats:0},absences:[]};
const a={id:id(4),memberId:person.id,categoryId:id(5),category:'Healing Meeting',meetingDate:null,createdAt:stamp,expiresAt:end};
const coverage={absence_id:a.id,member_id:person.id,member_name:person.name,expires_at:end};
const row={id:id(6),title:'Test sound',notes:null,status:'active',due_date:null,due_time:null,priority:'medium',category_id:id(5),weekdays:[],repeat_rule:'off',assigned_to_member_id:person.id,created_at:stamp,updated_at:stamp,completed_at:null};
const task=model.mapTask({...row,coverage},[{id:id(5),name:a.category}]);

test('absence and claim requests reject identity injection and require confirmation and valid dates/versions',()=>{
 const mark={action:'absent',categoryId:a.categoryId,meetingDate:null,confirmed:true};
 const take={action:'take',id:row.id,version:stamp,absenceId:a.id,confirmed:true};
 assert.ok(workspace.workspaceAction(mark));assert.ok(validation.validateAction(take));
 for(const changed of [{memberId:person.id},{ownerId:id(1)},{confirmed:false},{meetingDate:'2026-02-30'},{categoryId:'fake'},{expiresAt:end}])assert.equal(workspace.workspaceAction({...mark,...changed}),null);
 for(const changed of [{assignedTo:helper.id},{memberId:helper.id},{confirmed:false},{version:'invalid'},{absenceId:'fake'},{fields:{status:'completed'}}])assert.equal(validation.validateAction({...take,...changed}),null);
 assert.equal(workspace.workspaceRpc(mark).name,'task_app_mark_absent');assert.equal(workspace.workspaceRpc(mark).args.selected_date,null);
});
test('member response validates absence identities, category, date and expiry; legacy response remains readable',()=>{
 assert.equal(members.decodeMemberResponse({...state,absences:[a]}).absences[0].id,a.id);
 assert.equal(members.decodeMemberResponse({...state,absences:undefined}).absences,undefined);
 for(const bad of [{...a,memberId:id(99)},{...a,expiresAt:stamp},{...a,category:'Other'},{...a,category:'Special Meeting',meetingDate:null},{...a,meetingDate:'2026-10-14'}])assert.throws(()=>members.decodeMemberResponse({...state,absences:[bad]}));
 assert.throws(()=>members.decodeMemberResponse({...state,absences:[a,a]}));
});
test('coverage availability expires at the exact deadline; only other eligible members see Take task',()=>{
 const now=new Date('2026-10-14T07:00:00Z');
 assert.ok(absence.taskCoverage(task,now));assert.ok(absence.canTakeTask(task,state,now));
 assert.equal(absence.canTakeTask(task,{...state,current:person},now),false);
 assert.equal(absence.canTakeTask(task,{...state,current:null},now),false);
 assert.equal(absence.canTakeTask(task,{...state,members:[helper]},now),false);
 assert.equal(absence.canTakeTask(task,{...state,absences:[{...a,memberId:helper.id}]},now),false);
 assert.equal(absence.taskCoverage(task,new Date(end)),null);
 assert.equal(absence.canTakeTask(task,state,new Date(end)),false);
 assert.equal(absence.taskCoverage({...task,completed:true},now),null);
 assert.equal(absence.taskCoverage({...task,assignedToId:helper.id},now),null);
 assert.equal(absence.activeAbsences({...state,absences:[a]},new Date(end)).length,0);
});
test('Special absence only blocks helper claims for the same selected meeting',()=>{
 const special={...a,category:'Special Meeting',meetingDate:'2026-10-14',memberId:helper.id};
 const now=new Date('2026-10-14T07:00:00Z');
 assert.equal(absence.canTakeTask({...task,category:'Special Meeting',date:'2026-10-14'},{...state,absences:[special]},now),false);
 assert.equal(absence.canTakeTask({...task,category:'Special Meeting',date:'2026-10-16'},{...state,absences:[special]},now),true);
});
function fixture(coverageData,taskRow=row,claimReply,originData=[]){
 const calls=[];const client={rpc(name,args){calls.push({name,args});return Promise.resolve({data:name==='task_app_available_coverage'?coverageData:name==='task_app_take_task'||name==='task_app_mutate'?claimReply:name==='task_app_coverage_origins'?originData:null,error:null});},from(table){const query={};for(const key of ['select','eq','is','order','limit','gt','maybeSingle'])query[key]=()=>query;query.then=(resolve,reject)=>Promise.resolve({data:table==='tasks'?[taskRow]:table==='categories'?[{id:id(5),name:a.category}]:{timezone:'Asia/Kolkata'},error:null}).then(resolve,reject);return query;}};
 return {repo:new repository.TaskRepository(client,id(1)),calls};
}
const available={task_id:row.id,version:stamp,...coverage};
test('repository decorates only the same task version and rejects malformed or duplicate availability',async()=>{
 const good=await fixture([available]).repo.read();assert.equal(good.tasks[0].coverage.absence_id,a.id);
 const stale=await fixture([{...available,version:'2026-10-13T06:00:00Z'}]).repo.read();assert.equal(stale.tasks[0].coverage,null);
 for(const bad of [null,[{...available,expires_at:'bad'}],[available,available],[{...available,member_id:helper.id}]])await assert.rejects(()=>fixture(bad).repo.read());
});
test('claim uses dedicated scoped RPC without client-supplied helper identity and checks returned task',async()=>{
 const f=fixture([],row,{...row,assigned_to_member_id:helper.id,coverage:null});
 const result=await f.repo.mutate({action:'take',id:row.id,version:stamp,absenceId:a.id,confirmed:true});
 assert.equal(result.task.assigned_to_member_id,helper.id);assert.equal(f.calls.length,2);assert.equal(f.calls[1].name,'task_app_coverage_origins');assert.equal(f.calls[0].name,'task_app_take_task');assert.deepEqual(Object.keys(f.calls[0].args).sort(),['absence_id','confirmed','expected_version','task_id']);
 await assert.rejects(()=>fixture([],row,{...row,id:id(99)}).repo.mutate({action:'take',id:row.id,version:stamp,absenceId:a.id,confirmed:true}));
});

const origin={task_id:row.id,version:stamp,member_id:person.id,member_name:person.name,taken_by_member_id:helper.id};
test('original assignment survives reads and immediate completion replies without changing the acting assignee',async()=>{
 const taken={...row,assigned_to_member_id:helper.id};
 const read=await fixture([],taken,undefined,[origin]).repo.read();
 assert.equal(read.tasks[0].claim_origin.member_id,person.id);assert.equal(read.tasks[0].assigned_to_member_id,helper.id);
 const done={...taken,status:'completed',completed_at:stamp,completed_by_member_id:helper.id,completed_by_name:helper.name};
 const result=await fixture([],taken,done,[origin]).repo.mutate({action:'status',id:row.id,version:stamp,status:'completed'});
 assert.equal(result.task.claim_origin.member_name,'Sarah');assert.equal(result.task.completed_by_name,'Jerin');assert.equal(result.task.assigned_to_member_id,helper.id);
 const mapped=model.mapTask(result.task,[{id:id(5),name:a.category}]);assert.equal(mapped.claimOrigin.memberName,'Sarah');assert.equal(mapped.completedByName,'Jerin');
 const stale=await fixture([],taken,undefined,[{...origin,version:'2026-10-13T06:00:00Z'}]).repo.read();assert.equal(stale.tasks[0].claim_origin,null);
});
test('provenance rejects malformed, duplicate, mismatched and client-injected identities',async()=>{
 for(const data of [null,[origin,origin],[{...origin,member_id:helper.id}],[{...origin,member_name:''}],[{...origin,version:'bad'}],[{...origin,taken_by_member_id:id(99)}]])await assert.rejects(()=>fixture([],{...row,assigned_to_member_id:helper.id},undefined,data).repo.read());
 assert.equal(validation.validateAction({action:'take',id:row.id,version:stamp,absenceId:a.id,confirmed:true,claim_origin:origin}),null);
 assert.equal(validation.validateAction({action:'status',id:row.id,version:stamp,status:'completed',claim_origin:origin}),null);
});

test('Absent members displays one person once, deduplicates categories and keeps separate people with the same name',()=>{
 const now=new Date('2026-10-14T07:00:00Z');
 const rows=[a,{...a,id:id(20)},{...a,id:id(21)},{...a,id:id(22),categoryId:id(23),category:'Sunday Service'}];
 const input={...state,absences:rows};const before=JSON.stringify(input);
 const grouped=absence.absentMemberGroups(input,now);
 assert.equal(grouped.length,1);assert.equal(grouped[0].memberId,person.id);assert.equal(grouped[0].name,'Sarah');
 assert.deepEqual(Array.from(grouped[0].categories),['Healing Meeting','Sunday Service']);assert.equal(JSON.stringify(input),before);
 const sameName={...helper,name:'Sarah'};
 const both=absence.absentMemberGroups({...state,members:[person,sameName],absences:[...rows,{...a,id:id(24),memberId:helper.id}]},now);
 assert.equal(both.length,2);assert.notEqual(both[0].memberId,both[1].memberId);
 assert.equal(absence.absentMemberGroups(null,now).length,0);
});
test('grouped absent list clears each expired meeting and removes the person only after their last active absence ends',()=>{
 const later='2026-10-16T18:20:00Z';
 const groupedState={...state,absences:[a,{...a,id:id(25),categoryId:id(26),category:'Sunday Service',expiresAt:later}]};
 const atFirst=absence.absentMemberGroups(groupedState,new Date(end));assert.equal(atFirst.length,1);assert.deepEqual(Array.from(atFirst[0].categories),['Sunday Service']);
 assert.equal(absence.absentMemberGroups(groupedState,new Date(later)).length,0);
 assert.equal(absence.absentMemberGroups(groupedState,new Date('2026-10-14T05:59:59Z')).length,0);
});
