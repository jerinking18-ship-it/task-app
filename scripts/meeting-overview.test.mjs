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
const stamp='2026-10-14T06:00:00Z';
const task=(fields={})=>({...model.blankTask(),id:'task',title:'Check microphones',category:'Healing Meeting',assignedToId:'sarah',date:'2026-10-15',time:'23:50',createdAt:stamp,updatedAt:stamp,...fields});
const ids=rows=>Array.from(rows,row=>row.id);

test('Automatic meeting follows all seven India weekdays and changes at midnight, not the 23:50 deadline',()=>{
 const expected=['Sunday Service','Sunday Service','Healing Meeting','Healing Meeting','Healing Meeting','Revival Meeting','Revival Meeting'];
 for(let i=0;i<7;i++){const day=String(11+i);for(const time of ['00:00:00','23:50:00'])assert.equal(overview.automaticOverviewCategory(new Date(`2026-10-${day}T${time}+05:30`)),expected[i]);}
 assert.equal(overview.automaticOverviewCategory(new Date('2026-10-14T18:29:59.999Z')),'Healing Meeting');
 assert.equal(overview.automaticOverviewCategory(new Date('2026-10-14T18:30:00Z')),'Healing Meeting');
 assert.equal(overview.automaticOverviewCategory(new Date('2026-12-31T18:30:00Z')),'Revival Meeting');
});
test('Summary and four lists use one category scope, with help a subset of remaining and stable completion percentage',()=>{
 const now=new Date('2026-10-15T12:00:00+05:30');
 const rows=Array.from({length:12},(_,i)=>task({id:String(i),completed:i<9,completedAt:i<9?stamp:null}));
 rows[9].coverage={absenceId:'absence',memberId:'sarah',memberName:'Sarah',expiresAt:'2026-10-16T23:50:00+05:30'};
 rows.push(task({id:'other-category',category:'Sunday Service'}));
 const before=JSON.stringify(rows),s=overview.meetingOverview(rows,'Healing Meeting',now);
 assert.equal(s.tasks.length,12);assert.equal(s.completed.length,9);assert.equal(s.remaining.length,3);assert.equal(s.needsHelp.length,1);assert.equal(s.percentage,75);
 for(const [filter,count] of [['All',12],['Completed',9],['Remaining',3],['Needs help',1]])assert.equal(overview.overviewTasks(rows,'Healing Meeting',filter,now).length,count);
 assert.deepEqual(ids(s.needsHelp),['9']);assert.equal(JSON.stringify(rows),before,'No filtering may edit a task or schedule');
});
test('All weekly reset boundaries hide completed/overdue together but keep available future and undated work',()=>{
 for(const [category,reset] of [['Sunday Service','2026-10-12'],['Healing Meeting','2026-10-15'],['Revival Meeting','2026-10-17']]){
  const rows=[task({id:'done',category,date:'2026-10-11',completed:true,completedAt:'2026-10-11T06:00:00Z'}),task({id:'due',category,date:reset,time:'23:50',createdAt:'2026-10-11T06:00:00Z'}),task({id:'future',category,date:'2026-10-25'}),task({id:'undated',category,date:'',time:''})];
  const before=overview.meetingOverview(rows,category,new Date(`${reset}T23:49:59.999+05:30`));
  assert.equal(before.tasks.length,4,category);
  const after=overview.meetingOverview(rows,category,new Date(`${reset}T23:50:00+05:30`));
  assert.deepEqual(ids(after.tasks),['future','undated'],category);assert.equal(after.completed.length,0);assert.equal(after.remaining.length,2);assert.equal(rows.length,4);
 }
});
test('Special Meeting has independent selected-date deadlines and never enters the regular list',()=>{
 const rows=[task({id:'regular',category:'Revival Meeting',date:'2026-10-16'}),task({id:'old-special',category:'Special Meeting',date:'2026-10-14'}),task({id:'special',category:'Special Meeting',date:'2026-10-15'})];
 const before=new Date('2026-10-15T23:49:59+05:30'),after=new Date('2026-10-15T23:50:00+05:30');
 assert.deepEqual(ids(overview.meetingOverview(rows,'Special Meeting',before).tasks),['old-special','special']);
 assert.deepEqual(ids(overview.meetingOverview(rows,'Special Meeting',after).tasks),['special']);
 assert.deepEqual(ids(overview.meetingOverview(rows,'Revival Meeting',after).tasks),['regular']);
 assert.equal(overview.meetingOverview(rows,'Special Meeting',new Date('2026-10-16T23:50:00+05:30')).tasks.length,0);
});
test('History and not-yet-released repeats do not inflate counts; available future work remains',()=>{
 const now=new Date('2026-10-15T12:00:00+05:30');
 const rows=[task({id:'history',completed:true,completedAt:stamp,historyAt:stamp}),task({id:'unreleased',date:'2026-10-22',availableAt:'2026-10-21T18:30:00Z'}),task({id:'available',date:'2026-10-22'})];
 assert.deepEqual(ids(overview.meetingOverview(rows,'Healing Meeting',now).tasks),['available']);
 assert.equal(overview.meetingOverview([],'Healing Meeting',now).percentage,0);
});
test('Coverage expires correctly, does not include claimed/completed/mismatched work and respects server-adjusted coverage time',()=>{
 const now=new Date('2026-10-15T12:00:00+05:30'),expiresAt='2026-10-15T12:00:00+05:30';
 const coverage={absenceId:'absence',memberId:'sarah',memberName:'Sarah',expiresAt};
 const rows=[task({id:'released',coverage}),task({id:'claimed',assignedToId:'jerin',coverage}),task({id:'done',coverage,completed:true,completedAt:stamp})];
 assert.deepEqual(ids(overview.meetingOverview(rows,'Healing Meeting',now,new Date(now.getTime()-1)).needsHelp),['released']);
 assert.equal(overview.meetingOverview(rows,'Healing Meeting',now).needsHelp.length,0);
});
test('Reopening updates overview counts and Completed uses completion time while All uses creation time',()=>{
 const now=new Date('2026-10-15T12:00:00+05:30');
 const rows=[task({id:'older-created',createdAt:'2026-10-14T05:00:00Z',completed:true,completedAt:'2026-10-15T05:00:00Z'}),task({id:'newer-created',createdAt:stamp,completed:true,completedAt:stamp})];
 assert.deepEqual(ids(overview.overviewTasks(rows,'Healing Meeting','Completed',now)),['older-created','newer-created']);
 assert.deepEqual(ids(overview.overviewTasks(rows,'Healing Meeting','All',now)),['newer-created','older-created']);
 const reopened=rows.map(row=>row.id==='older-created'?{...row,completed:false,completedAt:null}:row);
 const summary=overview.meetingOverview(reopened,'Healing Meeting',now);assert.equal(summary.completed.length,1);assert.equal(summary.remaining.length,1);assert.equal(summary.percentage,50);
});
test('Deadline labels follow the unchanged reset calendar, and late completions remain until their next matching reset',()=>{
 const now=new Date('2026-10-15T10:00:00+05:30');
 const deadline=overview.overviewDeadline('Healing Meeting',now);assert.equal(deadline.meetingDate,'2026-10-14');assert.equal(deadline.resetAt,Date.parse('2026-10-15T23:50:00+05:30'));assert.equal(overview.overviewDeadline('Special Meeting',now),null);
 const row=task({category:'Healing Meeting',completed:true,completedAt:'2026-10-15T23:50:00+05:30'});
 assert.equal(overview.meetingOverview([row],row.category,new Date('2026-10-16T00:00:00+05:30')).tasks.length,1);
 assert.equal(overview.meetingOverview([row],row.category,new Date('2026-10-22T23:50:00+05:30')).tasks.length,0);
});
