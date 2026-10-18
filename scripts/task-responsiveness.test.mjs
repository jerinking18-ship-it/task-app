import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path,deps={}){
 const {outputText}=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const exports={};vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require:n=>{if(n in deps)return deps[n];throw Error(n);}});return exports;
}
const model=load('../src/lib/tasks/model.ts'),validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const {meetingCategoriesReady,confirmedStatusRow}=load('../src/lib/tasks/confirmed-state.ts',{'./model':model,'./validation':validation});
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const stamp='2026-10-17T06:00:00Z',next='2026-10-17T06:01:00Z';
const base={id:id(1),title:'Prepare sound',notes:null,status:'active',due_date:'2026-10-18',due_time:'20:00',priority:'medium',category_id:id(2),weekdays:[],repeat_rule:'off',assigned_to_member_id:id(3),created_at:stamp,updated_at:stamp,completed_at:null};
const completed={...base,status:'completed',updated_at:next,completed_at:next,completed_by_member_id:id(3),completed_by_name:'New name'};
const origin={member_id:id(4),member_name:'Original member',taken_by_member_id:id(3)};
test('only a complete fixed-category workspace skips bootstrap; fresh/partial/custom data still needs setup',()=>{
 const categories=model.MEETING_CATEGORIES.map((name,i)=>({id:id(i+10),name}));
 assert.equal(meetingCategoriesReady(categories),true);
 for(const partial of [[],categories.slice(1),[...categories.slice(1),{id:id(99),name:'Custom'}]])assert.equal(meetingCategoriesReady(partial),false);
});
test('committed completion keeps switched attribution while using server status, times and current completer name',()=>{
 const row=confirmedStatusRow({...base,claim_origin:origin},completed,base.id,'completed');
 assert.equal(row.status,'completed');assert.equal(row.completed_by_name,'New name');assert.equal(row.updated_at,next);assert.equal(row.claim_origin.member_id,id(4));
 assert.equal(model.mapTask(row,[{id:id(2),name:'Healing Meeting'}]).completed,true);
});
test('reopen clears server completion fields and does not invent available coverage',()=>{
 const row=confirmedStatusRow({...completed,claim_origin:origin},{...base,updated_at:next},base.id,'active');
 assert.equal(row.completed_at,null);assert.equal(row.completed_by_member_id,null);assert.equal(row.completed_by_name,null);assert.equal(row.coverage,undefined);assert.equal(row.claim_origin.member_id,id(4));
});
test('Special status retains the same plan schedule with authoritative plan version and enabled state',()=>{
 const meeting={id:id(40),startDate:'2026-10-18',days:3,locked:false,version:stamp,startsAt:'2026-10-17T18:30:00Z',endsAt:'2026-10-20T18:30:00Z'};
 const previous={...base,special_plan_id:id(41),special_meeting:meeting,special_enabled:true,special_plan_version:stamp};
 const row=confirmedStatusRow(previous,{...completed,special_plan_id:id(41),special_enabled:false,series_version:next},base.id,'completed');
 assert.equal(row.special_meeting.id,meeting.id);assert.equal(row.special_plan_version,next);assert.equal(row.special_enabled,false);
 assert.equal(model.mapTask(row,[{id:id(2),name:'Special Meeting'}]).repeat,'Daily');
});
test('changed assignment or plan cannot inherit unrelated prior metadata; explicit server null wins',()=>{
 const prev={...base,claim_origin:origin,special_plan_id:id(41),special_meeting:{id:id(40)}};
 const changed=confirmedStatusRow(prev,{...completed,assigned_to_member_id:id(5),special_plan_id:id(42)},base.id,'completed');
 assert.equal(changed.claim_origin,undefined);assert.equal(changed.special_meeting,undefined);
 assert.equal(confirmedStatusRow({...base,claim_origin:origin},{...completed,claim_origin:null},base.id,'completed').claim_origin,null);
});
test('wrong task, wrong status or malformed success response never appears as completion',()=>{
 for(const bad of [{...completed,id:id(99)},base,{...completed,completed_at:null},{...completed,completed_by_member_id:id(3),completed_by_name:null}])assert.throws(()=>confirmedStatusRow(base,bad,base.id,'completed'));
});
