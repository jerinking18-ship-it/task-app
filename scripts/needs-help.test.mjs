import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(file,deps={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts');
const period=load('../src/lib/tasks/meeting-period.ts',{'./model':model});
const absence=load('../src/lib/members/absence.ts');
const overview=load('../src/lib/tasks/meeting-overview.ts',{'./model':model,'./meeting-period':period,'@/lib/members/absence':absence});
const help=load('../src/lib/tasks/needs-help.ts',{'./meeting-overview':overview});
const assignment=load('../src/lib/tasks/assignment.ts',{'./model':model,'./meeting-period':period,'@/lib/members/display-name':load('../src/lib/members/display-name.ts')});
const now=new Date('2026-10-15T12:00:00+05:30');
const coverage={absenceId:'absence',memberId:'sarah',memberName:'Sarah',expiresAt:'2026-10-16T23:50:00+05:30'};
const row=(fields={})=>({...model.blankTask(),id:'task',title:'Test sound',notes:'Check microphones',category:'Healing Meeting',assignedToId:'sarah',coverage,date:'2026-10-15',time:'23:50',createdAt:'2026-10-14T06:00:00Z',...fields});
const ids=rows=>Array.from(rows,x=>x.id);

test('Needs help excludes completed, claimed, expired and unreleased tasks; keeps own releases separate without mutation',()=>{
 const rows=[row({id:'other'}),row({id:'mine',assignedToId:'jerin',coverage:{...coverage,memberId:'jerin'}}),row({id:'done',completed:true}),row({id:'claimed',assignedToId:'daniel'}),row({id:'expired',coverage:{...coverage,expiresAt:now.toISOString()}}),row({id:'future',availableAt:'2026-10-21T18:30:00Z'}),row({id:'different',category:'Sunday Service'})];
 const before=JSON.stringify(rows);const result=help.needsHelpMeeting(rows,'Healing Meeting','jerin',now);
 assert.deepEqual(ids(result.others),['other']);assert.deepEqual(ids(result.mine),['mine']);assert.equal(result.released.length,2);assert.equal(JSON.stringify(rows),before);
});
test('Search filters both own and other sections by title/notes while the menu count stays scoped to all released tasks',()=>{
 const rows=[row({id:'other',notes:'Prepare FLOWERS'}),row({id:'mine',assignedToId:'jerin',title:'Flowers',coverage:{...coverage,memberId:'jerin'}}),row({id:'not-match'})];
 const result=help.needsHelpMeeting(rows,'Healing Meeting','jerin',now,now,' flowers ');
 assert.deepEqual(ids(result.others),['other']);assert.deepEqual(ids(result.mine),['mine']);assert.equal(help.needsHelpCount(rows,now),3);
});
test('Menu count follows India weekdays with Special separate, independent of viewer or searches',()=>{
 const expiry='2026-10-20T23:50:00+05:30';
 const rows=[row({id:'healing',date:'2026-10-22',coverage:{...coverage,expiresAt:expiry}}),row({id:'revival',category:'Revival Meeting',date:'2026-10-16',coverage:{...coverage,expiresAt:expiry}}),row({id:'special',category:'Special Meeting',date:'2026-10-16',coverage:{...coverage,expiresAt:expiry}})];
 assert.equal(help.needsHelpCount(rows,new Date('2026-10-15T23:59:59.999+05:30')),2);
 assert.equal(help.needsHelpCount(rows,new Date('2026-10-16T00:00:00+05:30')),2);
 assert.deepEqual(ids(help.needsHelpMeeting(rows,'Revival Meeting','jerin',new Date('2026-10-16T00:00:00+05:30')).others),['revival']);
});
test('Each category release leaves at its exact India 23:50 deadline, including Special; server-adjusted expiry is respected',()=>{
 for(const [category,meeting,deadline] of [['Sunday Service','2026-10-11','2026-10-12'],['Healing Meeting','2026-10-14','2026-10-15'],['Revival Meeting','2026-10-16','2026-10-17'],['Special Meeting','2026-10-15','2026-10-16']]){
  const end=new Date(`${deadline}T23:50:00+05:30`),before=new Date(end.getTime()-1),task=row({category,date:meeting,coverage:{...coverage,expiresAt:end.toISOString()}});
  assert.equal(help.needsHelpMeeting([task],category,'jerin',before).released.length,1,category);
  assert.equal(help.needsHelpMeeting([task],category,'jerin',end).released.length,0,category);
  assert.equal(help.needsHelpMeeting([task],category,'jerin',before,end).released.length,0,category);
 }
});
test('Same-category absent helper cannot take, own releases cannot be taken, and present members retain existing eligibility',()=>{
 const members=[{id:'jerin'},{id:'sarah'}];const state={members,current:members[0],workspace:{id:'team'},absences:[]};
 assert.equal(absence.canTakeTask(row(),state,now),true);
 assert.equal(absence.canTakeTask(row(),{...state,current:members[1]},now),false);
 assert.equal(absence.canTakeTask(row(),{...state,absences:[{memberId:'jerin',category:'Healing Meeting',createdAt:'2026-10-14T06:00:00Z',expiresAt:coverage.expiresAt}]},now),false);
});
test('Changed active/overdue labels require a real helper transfer and current helper assignment; ordinary edits/reassignment do not qualify',()=>{
 const changed=row({assignedToId:'jerin',coverage:null,claimOrigin:{memberId:'sarah',memberName:'Sarah',takenById:'jerin'}});
 assert.equal(assignment.isChangedAssignment(changed),true);
 assert.equal(assignment.isChangedAssignment({...changed,date:'2026-10-14'}),true);
 assert.equal(assignment.isChangedAssignment(row({title:'Edited title'})),false);
 assert.equal(assignment.isChangedAssignment({...changed,assignedToId:'daniel'}),false);
 assert.equal(assignment.isChangedAssignment({...changed,claimOrigin:{...changed.claimOrigin,memberId:'jerin'}}),false);
 assert.equal(assignment.isChangedAssignment({...changed,completed:true,completedById:'jerin'}),false);
 assert.equal(assignment.isChangedCompletion({...changed,completed:true,completedById:'jerin'}),true);
 assert.equal(assignment.isChangedAssignment({...changed,completed:false,completedById:null}),true,'Reopening retains real transfer provenance');
});
test('Newest-created help rows remain first and empty views/counters stay zero',()=>{
 const rows=[row({id:'old',createdAt:'2026-10-14T01:00:00Z'}),row({id:'new',createdAt:'2026-10-14T06:00:00Z'})];
 assert.deepEqual(ids(help.needsHelpMeeting(rows,'Healing Meeting','jerin',now).others),['new','old']);assert.equal(help.needsHelpCount([],now),0);
});
