import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync}from'node:fs';
import {createRequire}from'node:module';
import vm from'node:vm';
import ts from'typescript';
const require=createRequire(import.meta.url);
function load(path,deps={}){
 const {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});
 const exports={};vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;
}
const model=load('../src/lib/tasks/model.ts');
const draft=patch=>({...model.blankTask(),category:'Healing Meeting',date:'2026-12-23',repeat:'Off',...patch});
test('each regular meeting accepts only its own two calendar days for new one-off tasks',()=>{
 for(const [category,allowed]of[['Sunday Service',[0,1]],['Healing Meeting',[3,4]],['Revival Meeting',[5,6]]]){
  assert.deepEqual([...model.regularMeetingDays(category)],allowed);
  for(let day=20;day<=26;day++){
   const date=`2026-12-${day}`,weekday=new Date(date+'T12:00:00Z').getUTCDay();
   assert.equal(model.repeatError(draft({category,date}))==='',allowed.includes(weekday),category+' '+date);
  }
  assert.equal(model.repeatError(draft({category,date:'',time:''})), '');
 }
});
test('regular repeat days stay within the meeting window and match their starting date',()=>{
 assert.equal(model.repeatError(draft({repeat:'Weekly',weekdays:[3,4]})), '');
 assert.equal(model.repeatError(draft({date:'2026-12-24',repeat:'Weekly',weekdays:[4]})), '');
 for(const patch of [{repeat:'Daily'},{repeat:'Monthly'},{repeat:'Weekly',weekdays:[3,5]},{repeat:'Weekly',weekdays:[]},{repeat:'Weekly',weekdays:[4]}])assert.ok(model.repeatError(draft(patch)));
});
test('unchanged legacy schedules survive unrelated edits but cannot change to another invalid schedule',()=>{
 const legacy=draft({id:'saved',date:'2026-12-25',repeat:'Daily'});
 assert.equal(model.repeatError({...legacy,title:'Renamed',assignedToId:'replacement'},legacy),'');
 assert.ok(model.repeatError({...legacy,date:'2026-12-26'},legacy));
 assert.equal(model.repeatError({...legacy,repeat:'Off'},legacy),'');
 assert.ok(model.repeatError({...legacy,repeat:'Weekly',weekdays:[5]},legacy));
 assert.equal(model.repeatError({...legacy,date:'2026-12-24',repeat:'Weekly',weekdays:[4]},legacy),'');
 const weekly=draft({repeat:'Weekly',weekdays:[3,4]});
 assert.equal(model.repeatError({...weekly,weekdays:[4,3]},weekly),'');
});
test('Special daily planning and generic saved response decoding keep their existing rules',()=>{
 assert.equal(model.repeatError(draft({category:'Special Meeting',date:'2026-12-22',repeat:'Daily',specialDays:3})), '');
 assert.ok(model.repeatError(draft({category:'Special Meeting',repeat:'Daily',specialDays:32})));
 const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
 const stamp='2026-12-20T00:00:00Z',id='00000000-0000-4000-8000-000000000001';
 assert.ok(validation.decodeRow({id,title:'Legacy',notes:null,status:'active',due_date:'2026-12-22',due_time:null,priority:'medium',category_id:id,weekdays:[],repeat_rule:'off',created_at:stamp,updated_at:stamp,completed_at:null}));
});
const React=require('react'),jsx=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const styles={default:new Proxy({},{get:(_,key)=>String(key)})};
const Days=load('../src/components/task-days.tsx',{'react/jsx-runtime':jsx,'@/lib/tasks/model':model,'./task-app.module.css':styles}).default;
const Repeat=load('../src/components/task-repeat.tsx',{'react':React,'react/jsx-runtime':jsx,'@/lib/tasks/model':model,'./task-days':{default:Days},'./task-app.module.css':styles}).default;
test('existing repeat controls disable invalid new choices while legacy selected days remain removable',()=>{
 const html=renderToStaticMarkup(React.createElement(Repeat,{task:draft({repeat:'Weekly',weekdays:[3]}),onChange(){},onDaysChange(){}}));
 for(const value of['Daily','Monthly'])assert.match(html,new RegExp('<input[^>]*value="'+value+'"[^>]*disabled|<input[^>]*disabled[^>]*value="'+value+'"'));
 assert.match(html,/<button[^>]*aria-label="Friday"[^>]*disabled/);
 const legacy=renderToStaticMarkup(React.createElement(Days,{value:[3,5],allowedDays:[3,4],onChange(){}}));
 assert.doesNotMatch(legacy,/<button[^>]*aria-label="Friday"[^>]*disabled/);
 assert.match(legacy,/<button[^>]*aria-label="Saturday"[^>]*disabled/);
});
test('server schedule rejection is a safe validation error and never retried as another write',async()=>{
 const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
 const {TaskRepository,TaskError}=load('../src/lib/tasks/repository.ts',{'./model':model,'./validation':validation});
 let writes=0;const repo=new TaskRepository({rpc:async()=>{writes++;return{data:null,error:{code:'P0044',message:'private SQL details'}};}},'owner');
 await assert.rejects(repo.mutate({action:'create',fields:{assigned_to_member_id:'member'}}),error=>error instanceof TaskError&&error.status===400&&!error.message.includes('private SQL'));
 assert.equal(writes,1);
});
