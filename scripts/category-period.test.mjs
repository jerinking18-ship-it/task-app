import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
function load(file,deps={}) {
  const exports={};
  const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  vm.runInNewContext(outputText,{exports,Date,Intl,Set,require(name){if(name in deps)return deps[name];throw Error(name);}});
  return exports;
}
const model=load('../src/lib/tasks/model.ts');
const periods=load('../src/lib/tasks/meeting-period.ts',{'./model':model});
const stamp='2026-10-11T07:25:00Z';
const task=(fields={})=>({...model.blankTask(),id:'task',category:'Sunday Service',date:'2026-10-11',time:'12:55',createdAt:stamp,updatedAt:stamp,...fields});
const filters=(fields={})=>({view:'All tasks',status:'All',priority:'Any',category:'Sunday Service',search:'',...fields});
function visible(row,now){const d=new Date(now),clock=model.accountClock(d,'Asia/Kolkata');return periods.isCategoryTaskVisible(row,d,clock.date,clock.time);}
function matches(row,f,now){const d=new Date(now),clock=model.accountClock(d,'Asia/Kolkata');return periods.matchesCategoryTask(row,f,clock.date,clock.time,d);}

test('Each weekly category hides completed and overdue rows at exactly its own India reset',()=>{
  for(const [category,date] of [['Sunday Service','2026-10-12'],['Healing Meeting','2026-10-15'],['Revival Meeting','2026-10-17']]) {
    const before=date+'T18:29:59.999Z',at=date+'T18:30:00Z';
    for(const completed of [false,true]) {
      const row=task({category,completed,completedAt:completed?stamp:null});
      assert.equal(visible(row,before),true,category+' before');
      assert.equal(visible(row,at),false,category+' at');
      assert.equal(visible(row,'2026-11-30T00:00:00Z'),false,category+' must not return next week');
    }
  }
});
test('Category All/Completed/Overdue tabs expire rows, while global pages and their category filters keep them',()=>{
  const now='2026-10-12T18:30:00Z';
  const completed=task({completed:true,completedAt:stamp}),overdue=task();
  for(const status of ['All','Completed'])assert.equal(matches(completed,filters({status}),now),false);
  for(const status of ['All','Active','Overdue'])assert.equal(matches(overdue,filters({status}),now),false);
  for(const row of [completed,overdue])assert.equal(matches(row,filters({category:'Any'}),now),true);
  assert.equal(matches(completed,filters({view:'Completed',status:'Completed'}),now),true);
  assert.equal(matches(overdue,filters({view:'Overdue',status:'Overdue'}),now),true);
  assert.equal(matches(overdue,filters({view:'Overdue',status:'Overdue',category:'Any'}),now),true);
});
test('Category counters count every retained status and never force zero when active/upcoming work remains',()=>{
  const rows=[task(),task({id:'done',completed:true,completedAt:stamp}),task({id:'future',date:'2026-10-18'}),task({id:'undated',date:'',time:''}),task({id:'other',category:'Healing Meeting'})];
  const original=JSON.stringify(rows);
  const count=now=>rows.filter(row=>row.category==='Sunday Service'&&visible(row,now)).length;
  assert.equal(count('2026-10-12T18:29:59Z'),4);
  assert.equal(count('2026-10-12T18:30:00Z'),2);
  for(const row of rows.slice(2,4))for(const status of ['Active','All'])assert.equal(matches(row,filters({status}),'2026-10-12T18:30:00Z'),true,'Active/upcoming stay in '+status);
  assert.equal(JSON.stringify(rows),original,'Visibility must never mutate or remove saved records');
  assert.equal(visible(rows[4],'2026-10-12T18:30:00Z'),true,'Other categories retain their own period');
});
test('Late completions and newly entered overdue tasks get the next matching deadline',()=>{
  const late='2026-10-12T18:30:00Z',next='2026-10-19T18:30:00Z';
  for(const row of [task({completed:true,completedAt:late}),task({createdAt:late})]) {
    assert.equal(visible(row,late),true);
    assert.equal(visible(row,'2026-10-19T18:29:59Z'),true);
    assert.equal(visible(row,next),false);
  }
});
test('Special Meeting uses independent next-day deadlines and honors selected-day late-completion fallback',()=>{
  const row=task({category:'Special Meeting',date:'2026-10-13',createdAt:'2026-10-13T07:25:00Z'});
  assert.equal(visible(row,'2026-10-14T18:29:59Z'),true);
  assert.equal(visible(row,'2026-10-14T18:30:00Z'),false);
  const later=task({...row,date:'2026-10-14'});
  assert.equal(visible(later,'2026-10-14T18:30:00Z'),true);
  assert.equal(visible(later,'2026-10-15T18:30:00Z'),false);
  const late=task({...row,completed:true,completedAt:'2026-10-14T18:30:00Z',weekdays:[2]});
  assert.equal(periods.meetingResetAt(late.category,Date.parse(late.completedAt),late.date,late.weekdays),Date.parse('2026-10-21T18:30:00Z'));
  const undated=task({category:'Special Meeting',date:'',time:'',completed:true,completedAt:'2026-10-14T19:00:00Z'});
  assert.equal(visible(undated,'2026-10-16T18:29:59Z'),true);
  assert.equal(visible(undated,'2026-10-16T18:30:00Z'),false);
});
test('Date-only, exact timed overdue boundaries and reopened tasks keep existing semantics',()=>{
  const row=task({date:'2026-10-12',time:''});
  assert.equal(visible(row,'2026-10-12T18:30:00Z'),true,'Date-only remains active until next midnight');
  assert.equal(visible(row,'2026-10-18T18:30:00Z'),true);
  assert.equal(visible(row,'2026-10-19T18:30:00Z'),false);
  const timed=task({date:'2026-10-12',time:'23:50'});
  assert.equal(visible(timed,'2026-10-12T18:29:59.999Z'),true);
  assert.equal(visible(timed,'2026-10-12T18:30:00Z'),false);
  assert.equal(visible(timed,'2026-10-12T18:30:01Z'),false);
  const oldDone=task({date:'',time:'',completed:true,completedAt:stamp});
  assert.equal(visible(oldDone,'2026-10-14T12:00:00Z'),false);
  assert.equal(visible({...oldDone,completed:false,completedAt:null},'2026-10-14T12:00:00Z'),true,'Reopened undated task is active again');
});
test('When due and reset coincide, all four weekly categories clear due work without hiding future occurrences',()=>{
  for(const [category,date] of [['Sunday Service','2026-10-12'],['Healing Meeting','2026-10-15'],['Revival Meeting','2026-10-17']]) {
    const row=task({category,date,time:'23:50'}),at=date+'T18:30:00Z';
    assert.equal(visible(row,date+'T18:29:59Z'),true);
    assert.equal(visible(row,at),false);
    assert.equal(matches(row,filters({category}),at),false);
    assert.equal(matches(row,filters({category:'Any'}),at),true,'Main All still keeps the saved row');
    assert.equal(matches(row,filters({view:'Overdue',category:'Any',status:'Overdue'}),date+'T18:30:01Z'),true);
    const future=task({category,date:'2026-10-25',availableAt:'2026-10-24T18:30:00Z'});
    assert.equal(visible(future,at),false,'Not-yet-released occurrence does not inflate the category');
    assert.equal(visible(future,'2026-10-24T18:30:00Z'),true,'Occurrence appears as active on its own date');
  }
  const rows=[task({completed:true,completedAt:stamp}),task(),task({date:'2026-10-12',time:'23:50'})];
  assert.equal(rows.filter(row=>visible(row,'2026-10-12T18:30:00Z')).length,0,'Counter is zero when all tasks are completed or due');
});
test('Future availability, existing repeat History, legacy timestamps and unknown categories remain safe',()=>{
  const now='2026-10-14T12:00:00Z';
  assert.equal(visible(task({date:'2026-10-18',availableAt:'2026-10-17T18:30:00Z'}),now),false);
  const historical=task({completed:true,completedAt:stamp,historyAt:'2026-10-12T00:00:00Z'});
  assert.equal(visible(historical,now),false);
  assert.equal(matches(historical,filters({view:'History'}),now),true);
  assert.equal(visible(task({completed:true,completedAt:null}),now),true);
  assert.equal(visible(task({completed:true,completedAt:'bad'}),now),true);
  assert.equal(visible(task({category:''}),now),true);
  assert.equal(visible(task({category:'Legacy category'}),now),true);
});
test('Year rollover uses India dates and retains normal filters in category and dedicated views',()=>{
  const row=task({category:'Revival Meeting',completed:true,completedAt:'2026-12-31T19:00:00Z'});
  assert.equal(visible(row,'2027-01-02T18:29:59Z'),true);
  assert.equal(visible(row,'2027-01-02T18:30:00Z'),false);
  const overdue=task({title:'Check camera',notes:'Platform',priority:'High'});
  const f=filters({view:'Overdue',status:'Overdue',search:'camera',priority:'High'});
  assert.equal(matches(overdue,f,'2026-10-14T12:00:00Z'),true);
  assert.equal(matches(overdue,{...f,search:'missing'},'2026-10-14T12:00:00Z'),false);
  assert.equal(matches(overdue,{...f,category:'Healing Meeting'},'2026-10-14T12:00:00Z'),false);
});

test('Supported meeting categories and reset rules contain exactly the four retained meetings',()=>{
 assert.deepEqual(Array.from(model.MEETING_CATEGORIES),['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting']);
 assert.deepEqual(Object.keys(periods.RESET_WEEKDAYS).sort(),['Healing Meeting','Revival Meeting','Sunday Service']);
 assert.deepEqual(Array.from(model.categoryWeekdays('Sunday Service')),[0]);assert.deepEqual(Array.from(model.categoryWeekdays('Healing Meeting')),[3]);assert.deepEqual(Array.from(model.categoryWeekdays('Revival Meeting')),[5]);assert.equal(model.categoryWeekdays('Special Meeting').length,0);
});
