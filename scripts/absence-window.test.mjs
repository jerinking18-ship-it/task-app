import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts');
const validation=load('../src/lib/tasks/validation.ts',{'./model':model});
const windowModel=load('../src/lib/members/absence-window.ts',{'@/lib/tasks/model':model,'@/lib/tasks/validation':validation});
const {absenceChangeWindow}=windowModel;
test('regular attendance changes open at India midnight and close exactly at9PM on their own day only',()=>{
 for(const [category,day,next]of [['Sunday Service','2026-10-18','2026-10-19'],['Healing Meeting','2026-10-21','2026-10-22'],['Revival Meeting','2026-10-23','2026-10-24']]){
  for(const time of ['00:00:00','12:00:00','20:59:59.999'])assert.equal(absenceChangeWindow(category,new Date(`${day}T${time}+05:30`)).open,true);
  for(const time of ['21:00:00','21:00:00.001','23:59:59.999'])assert.equal(absenceChangeWindow(category,new Date(`${day}T${time}+05:30`)).open,false);
  assert.equal(absenceChangeWindow(category,new Date(`${next}T00:00:00+05:30`)).open,false,'view remains open next day but attendance changes do not');
 }
 assert.equal(absenceChangeWindow('Sunday Service',new Date('2026-10-17T18:30:00Z')).open,true,'India Sunday while UTC Saturday');
 assert.equal(absenceChangeWindow('Healing Meeting',new Date('2026-10-21T15:30:00Z')).open,false,'India9PM while UTC afternoon');
});
test('Special attendance changes are limited to the exact selected date, including year rollover',()=>{
 for(const [time,expected]of [['2026-12-30T23:59:59.999+05:30',false],['2026-12-31T00:00:00+05:30',true],['2026-12-31T20:59:59.999+05:30',true],['2026-12-31T21:00:00+05:30',false],['2027-01-01T12:00:00+05:30',false]])assert.equal(absenceChangeWindow('Special Meeting',new Date(time),'2026-12-31').open,expected);
 for(const value of [null,'','2026-02-30','2026-13-01'])assert.equal(absenceChangeWindow('Special Meeting',new Date('2026-10-18T12:00:00+05:30'),value).open,false);
 assert.equal(absenceChangeWindow('Unknown',new Date()).open,false);assert.equal(absenceChangeWindow('Sunday Service',new Date('bad')).open,false);
});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const absence=load('../src/lib/members/absence.ts');
const period=load('../src/lib/tasks/meeting-period.ts',{'./model':model});
const overview=load('../src/lib/tasks/meeting-overview.ts',{'./model':model,'./meeting-period':period,'@/lib/members/absence':absence});
const Empty=load('../src/components/no-meeting.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/tasks/model':model,'@/lib/tasks/meeting-period':period,'./no-meeting.module.css':{default:{}}}).default;
const service=load('../src/lib/tasks/sunday-service.ts',{'./model':model});
const selection=load('../src/lib/tasks/sunday-selection.ts',{'./model':model,'./sunday-service':service});
const hook=load('../src/lib/tasks/use-sunday-selection.ts',{'react':React,'./sunday-selection':selection});
const checkInModel=load('../src/lib/check-in/model.ts',{'@/lib/tasks/validation':validation});
const Card=load('../src/components/members/attendance-card.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'react':React,'@/lib/check-in/model':checkInModel,'@/lib/tasks/use-sunday-selection':hook,'../sunday-service-selector':{default:()=>null},'../no-meeting':{default:Empty},'@/lib/members/model':{},'@/lib/members/absence':absence,'@/lib/members/absence-window':windowModel,'@/lib/tasks/validation':validation,'@/lib/tasks/meeting-overview':overview,'@/lib/workspace/client':{},'./attendance.module.css':{default:{}}}).default;
function card(time,absent=false,options={}){
 const now=new Date(time),current={id:'member',name:'Jerin'},category=options.category??'Sunday Service',categoryId=options.categoryId??'sunday';
 const state={current,members:[current],absences:absent?[{id:'absence',memberId:'member',categoryId,category,meetingDate:options.meetingDate??null,createdAt:'2026-10-18T00:00:00+05:30',expiresAt:'2026-10-26T00:00:00+05:30',...(options.absence??{})}]:[]};
 const contexts=options.contexts??['morning','evening'].map(service=>({categoryId,category,meetingDate:'2026-10-18',service,meetingId:null,opensAt:'2026-10-18T07:00:00+05:30',closesAt:'2026-10-19T00:00:00+05:30',visibleUntil:'2026-10-20T00:00:00+05:30'}));
 const checkIns=options.unavailable?null:{currentId:options.currentId??current.id,contexts,presence:options.presence??[],own:[],serverNow:time};
 return renderToStaticMarkup(React.createElement(Card,{state,checkIns,categories:[{id:categoryId,name:category}],hasSpecialTasks:category==='Special Meeting',specialMeetings:options.specialMeetings,now,disabled:false,onSaved(){},onPending(){},onRefresh(){}}));
}
test('the same window disables both Mark and Unmark while preserving a still-active absence',()=>{
 for(const absent of [false,true]){
  const before=card('2026-10-18T20:59:59+05:30',absent),after=card('2026-10-18T21:00:00+05:30',absent);
  const evening=before.match(/<form aria-label="Evening Service attendance"[\s\S]*?<\/form>/)[0];assert.doesNotMatch(evening,/<button[^>]*disabled/);assert.doesNotMatch(before,/<form aria-label="Morning Service attendance"/);assert.match(card("2026-10-18T11:00:00+05:30",absent),/<form aria-label="Morning Service attendance"[\s\S]*?<button[^>]*disabled/);assert.equal((after.match(/<button[^>]*disabled/g)||[]).length,1);assert.match(after,/Attendance changes closed at 9:00 PM India time/);
  if(absent){assert.match(after,/You’re marked absent for/);assert.match(after,/Unmark absent/);assert.match(card('2026-10-19T12:00:00+05:30',true),/You’re marked absent for/);}
 }
});

test('Sunday Morning and Evening Mark/Unmark boundaries are independent',()=>{
 for(const [time,morning,evening]of [['00:00:00',true,false],['10:59:59.999',true,false],['11:00:00',false,false],['12:59:59.999',false,false],['13:00:00',false,true],['20:59:59.999',false,true],['21:00:00',false,false]]){
  const now=new Date(`2026-10-18T${time}+05:30`);
  assert.equal(absenceChangeWindow('Sunday Service',now,null,'morning').open,morning);
  assert.equal(absenceChangeWindow('Sunday Service',now,null,'evening').open,evening);
 }
 assert.equal(absenceChangeWindow('Sunday Service',new Date('2026-10-19T09:00:00+05:30'),null,'morning').open,false);
});


test('checked-in profile hides Unmark only for the matching member, service and current meeting date',()=>{
 const time='2026-10-18T10:00:00+05:30',key='sunday:2026-10-18:morning:';
 // Presence deliberately remains authoritative even if a later absence excludes own[].
 const checked=card(time,true,{presence:[{key,memberId:'member'}]});
 assert.doesNotMatch(checked,/Unmark absent/);assert.match(checked,/You’re marked absent for Morning Service/);
 assert.match(card(time,true),/Unmark absent/);
 for(const presence of [[{key,memberId:'other'}],[{key:'sunday:2026-10-18:evening:',memberId:'member'}],[{key:'sunday:2026-10-11:morning:',memberId:'member'}],[{key:'another:2026-10-18:morning:',memberId:'member'}]])
  assert.match(card(time,true,{presence}),/Unmark absent/);
 assert.match(card(time,true,{unavailable:true}),/Unmark absent/,'Unavailable check-in data preserves existing absence controls');
 assert.match(card(time,true,{currentId:'other'}),/Unmark absent/,'Another identity’s response does not hide this member’s control');
 assert.match(card(time,false,{presence:[{key,memberId:'member'}]}),/Mark myself absent/,'Existing Mark absent behavior is unchanged');
});

test('checked-in return hiding also scopes Healing and each Special Meeting day/event',()=>{
 const healing={categoryId:'healing',category:'Healing Meeting',meetingDate:'2026-10-21',service:null,meetingId:null,opensAt:'2026-10-21T16:00:00+05:30',closesAt:'2026-10-22T00:00:00+05:30',visibleUntil:'2026-10-23T00:00:00+05:30'};
 const props={category:'Healing Meeting',categoryId:'healing',contexts:[healing]};
 assert.match(card('2026-10-21T18:00:00+05:30',true,props),/Unmark absent/);
 assert.doesNotMatch(card('2026-10-21T18:00:00+05:30',true,{...props,presence:[{key:checkInModel.contextKey(healing),memberId:'member'}]}),/Unmark absent/);
 const special={...healing,categoryId:'special',category:'Special Meeting',meetingDate:'2026-10-21',meetingId:'event',visibleUntil:'2026-10-24T00:00:00+05:30'};
 const event={id:'event',startDate:'2026-10-21',days:3,locked:false,startsAt:'2026-10-21T00:00:00+05:30',endsAt:'2026-10-24T00:00:00+05:30'};
 const eventProps={category:'Special Meeting',categoryId:'special',meetingDate:'2026-10-21',contexts:[special],specialMeetings:[event]};
 assert.match(card('2026-10-21T18:00:00+05:30',true,eventProps),/Unmark absent/);
 assert.doesNotMatch(card('2026-10-21T18:00:00+05:30',true,{...eventProps,presence:[{key:checkInModel.contextKey(special),memberId:'member'}]}),/Unmark absent/);
 for(const key of ['special:2026-10-21::other-event','special:2026-10-20::event'])assert.match(card('2026-10-21T18:00:00+05:30',true,{...eventProps,presence:[{key,memberId:'member'}]}),/Unmark absent/);
});
