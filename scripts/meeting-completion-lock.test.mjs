import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';import ts from'typescript';
function load(file,deps={}){const exports={};const{outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require:n=>{if(n in deps)return deps[n];throw Error(n);}});return exports;}
const model=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':model}),period=load('../src/lib/tasks/meeting-period.ts',{'./model':model}),special=load('../src/lib/special-meetings/model.ts',{'@/lib/tasks/model':model,'@/lib/tasks/validation':validation});
const{meetingCompletionLocked:locked}=load('../src/lib/tasks/completion-lock.ts',{'./model':model,'./meeting-period':period});
const row=(fields={})=>({...model.blankTask(),id:'task',title:'Prepare sound',category:'Sunday Service',date:'2026-10-25',createdAt:'2026-10-01T00:00:00Z',...fields});
test('dated regular tasks unlock on their own India meeting day, with no early unlock in the previous week',()=>{
 for(const[category,day]of[['Sunday Service','2026-10-25'],['Healing Meeting','2026-10-28'],['Revival Meeting','2026-10-30']]){
  const t=row({category,date:day}),start=Date.parse(day+'T00:00:00+05:30');
  assert.equal(locked(t,new Date(start-1)),true);assert.equal(locked(t,new Date(start)),false);assert.equal(locked(t,new Date(start-7*86400000)),true);assert.equal(locked(t,new Date(start+8*86400000)),false,'Past dated overdue tasks retain normal completion');
 }
});
test('following-day dates belong to the same meeting; off-day dates never unlock a week early',()=>{
 assert.equal(locked(row({date:'2026-10-26'}),new Date('2026-10-25T00:00:00+05:30')),false);
 assert.equal(locked(row({category:'Healing Meeting',date:'2026-10-29'}),new Date('2026-10-28T00:00:00+05:30')),false);
 assert.equal(locked(row({date:'2026-10-27'}),new Date('2026-10-25T00:00:00+05:30')),true);
 assert.equal(locked(row({date:'2026-10-27'}),new Date('2026-10-27T00:00:00+05:30')),false);
});
test('undated meeting tasks use only their category window, while completed reopening and custom tasks retain their rules',()=>{
 for(const[category,day,end]of[['Sunday Service','2026-10-25','2026-10-27'],['Healing Meeting','2026-10-28','2026-10-30'],['Revival Meeting','2026-10-30','2026-11-01']]){
  const t=row({category,date:''});assert.equal(locked(t,new Date(day+'T00:00:00+05:30')),false);assert.equal(locked(t,new Date(Date.parse(end+'T00:00:00+05:30')-1)),false);assert.equal(locked(t,new Date(end+'T00:00:00+05:30')),true);
 }
 assert.equal(locked(row({completed:true}),new Date('2026-10-18T00:00:00+05:30')),false);
 assert.equal(locked(row({category:'Custom'}),new Date('2026-10-18T00:00:00+05:30')),false);
 assert.equal(locked(row({availableAt:'2026-10-26T00:00:00+05:30'}),new Date('2026-10-25T00:00:00+05:30')),true);
});
test('Special tasks need activation and each occurrence day, and close at the event end',()=>{
 const e={id:'meeting',startDate:'2026-10-21',days:3,locked:false,startsAt:'2026-10-21T00:00:00+05:30',endsAt:'2026-10-24T00:00:00+05:30'},t=row({category:'Special Meeting',date:'2026-10-22',specialMeeting:e,specialEnabled:true});
 assert.equal(locked(t,new Date('2026-10-21T12:00:00+05:30')),true);assert.equal(locked(t,new Date('2026-10-22T00:00:00+05:30')),false);
 assert.equal(locked({...t,specialMeeting:{...e,locked:true}},new Date('2026-10-22T00:00:00+05:30')),true);
 assert.equal(locked({...t,specialEnabled:false},new Date('2026-10-22T00:00:00+05:30')),true);assert.equal(locked(t,new Date(e.endsAt)),true);
});
test('All tasks can include one prepared Special occurrence while category/Assigned projections retain their existing scope',()=>{
 const e={id:'meeting',startDate:'2026-10-21',days:3,locked:true,startsAt:'2026-10-21T00:00:00+05:30',endsAt:'2026-10-24T00:00:00+05:30'},now=new Date('2026-10-20T12:00:00+05:30');
 const first=row({category:'Special Meeting',date:e.startDate,specialMeeting:e,specialPlanId:'plan',specialEnabled:false}),future={...first,id:'later',date:'2026-10-22'},regular=row();
 assert.equal(special.currentSpecialTasks([first,future,regular],[e],now).length,1);
 const all=special.currentSpecialTasks([first,future,regular],[e],now,'Any',false,true);assert.equal(all.length,2);assert.equal(locked(all[0],now),true);assert.equal(all.filter(t=>t.id==='later').length,0);
 assert.equal(period.isCategoryWindowTaskVisible(first,now,'2026-10-20','12:00:00'),false);
 const active={...e,locked:false};assert.equal(special.currentSpecialTasks([first,regular],[active],new Date('2026-10-21T12:00:00+05:30'),'Any',false,true).some(t=>t.id===regular.id),false,'Active Special replacement remains enforced');
});

test('backend meeting lock refusals remain a safe conflict and never fall back to a second mutation',async()=>{
 let calls=0;const repository=load('../src/lib/tasks/repository.ts',{'./model':model,'./validation':validation});
 const repo=new repository.TaskRepository({rpc:async()=>{calls++;return{data:null,error:{code:'P0038'}};}},'owner');
 await assert.rejects(()=>repo.mutate({action:'status',id:'task',version:'2026-10-18T00:00:00Z',status:'completed',cachedProjection:true}),e=>e.status===409&&e.message.includes('locked until its meeting starts'));
 assert.equal(calls,1);
});
