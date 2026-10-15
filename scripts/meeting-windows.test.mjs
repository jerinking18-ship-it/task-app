import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const require=createRequire(import.meta.url);
function load(file,deps={}){const exports={};const {outputText}=ts.transpileModule(readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}});vm.runInNewContext(outputText,{exports,Date,Intl,Set,Map,require(name){if(name in deps)return deps[name];throw Error(name);}});return exports;}
const model=load('../src/lib/tasks/model.ts'),period=load('../src/lib/tasks/meeting-period.ts',{'./model':model});
test('India windows include the full final minute, no Tuesday regular meeting, and correct next starts',()=>{
 for(const [at,category,next]of [['2026-10-18T00:00:00+05:30','Sunday Service','2026-10-21'],['2026-10-19T23:59:59.999+05:30','Sunday Service','2026-10-21'],['2026-10-20T00:00:00+05:30','','2026-10-21'],['2026-10-20T23:59:59.999+05:30','','2026-10-21'],['2026-10-21T00:00:00+05:30','Healing Meeting','2026-10-23'],['2026-10-22T23:59:59.999+05:30','Healing Meeting','2026-10-23'],['2026-10-23T00:00:00+05:30','Revival Meeting','2026-10-25'],['2026-10-24T23:59:59.999+05:30','Revival Meeting','2026-10-25']]){const now=new Date(at),w=period.regularMeetingWindow(now);assert.equal(w.category,category);assert.equal(w.nextDay,next);assert.ok(w.startsAt<=now.getTime()&&w.endsAt>now.getTime());}
 assert.equal(period.regularMeetingWindow(new Date('2026-10-20T18:30:00Z')).category,'Healing Meeting','India Wednesday starts while UTC is Tuesday');
});
test('Special selected dates have independent two-day windows across year rollover',()=>{
 const task={...model.blankTask(),category:'Special Meeting',date:'2026-12-31',createdAt:'2026-12-20T00:00:00Z'};
 for(const [at,expected]of [['2026-12-30T23:59:59.999+05:30',false],['2026-12-31T00:00:00+05:30',true],['2027-01-01T23:59:59.999+05:30',true],['2027-01-02T00:00:00+05:30',false]])assert.equal(period.specialMeetingIsOpen(task,new Date(at)),expected);
});
const absence=load('../src/lib/members/absence.ts');const overview=load('../src/lib/tasks/meeting-overview.ts',{'./model':model,'./meeting-period':period,'@/lib/members/absence':absence});const attendance=load('../src/lib/members/attendance.ts',{'./absence':absence,'@/lib/tasks/meeting-overview':overview});
test('Tuesday omits regular attendance without hiding a scheduled Special Meeting or mutating tasks',()=>{
 const now=new Date('2026-10-20T12:00:00+05:30'),task={...model.blankTask(),id:'special',category:'Special Meeting',date:'2026-10-20',createdAt:'2026-10-18T00:00:00Z'};const before=JSON.stringify(task);
 assert.equal(attendance.attendanceMeetings([],now).length,0);assert.deepEqual(Array.from(attendance.attendanceMeetings([task],now),x=>x.category),['Special Meeting']);assert.equal(JSON.stringify(task),before);
});
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');const Empty=load('../src/components/no-meeting.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/tasks/model':model,'@/lib/tasks/meeting-period':period,'./no-meeting.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})}}).default;
test('Tuesday empty state explains saved access, shows next Wednesday midnight, and has no fake readiness counts',()=>{
 const html=renderToStaticMarkup(React.createElement(Empty,{now:new Date('2026-10-20T12:00:00+05:30'),onAllTasks(){}}));assert.match(html,/No meeting today/);assert.match(html,/View all tasks/);assert.match(html,/Healing Meeting/);assert.match(html,/Wednesday, October 21.*12:00 AM/);assert.doesNotMatch(html,/progressbar|0%|checkbox/);
 const readOnly=renderToStaticMarkup(React.createElement(Empty,{now:new Date('2026-10-20T12:00:00+05:30')}));assert.doesNotMatch(readOnly,/<button/);
});

const AssignedHeading=load('../src/components/assigned-meeting-heading.tsx',{'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/tasks/meeting-period':period,'./assigned-meeting-heading.module.css':{default:new Proxy({},{get:(_,key)=>String(key)})}}).default;
test('Assigned heading follows India meeting days and renders the approved label without task actions',()=>{
 for(const [date,title,days]of [['2026-10-18','Sunday Service','Sun · Mon'],['2026-10-19','Sunday Service','Sun · Mon'],['2026-10-20','No meeting today','Tue'],['2026-10-21','Healing Meeting','Wed · Thu'],['2026-10-22','Healing Meeting','Wed · Thu'],['2026-10-23','Revival Meeting','Fri · Sat'],['2026-10-24','Revival Meeting','Fri · Sat']]){
  const html=renderToStaticMarkup(React.createElement(AssignedHeading,{now:new Date(date+'T12:00:00+05:30')}));assert.match(html,/CURRENT MEETING/);assert.ok(html.includes('<h2>'+title+'</h2>'));assert.ok(html.includes(days));assert.doesNotMatch(html,/<button|<select|checkbox|left to do/);
 }
});
test('Assigned heading updates at the exclusive midnight cutoff with no early Tuesday-to-Healing switch',()=>{
 for(const [time,title]of [['2026-10-19T18:29:59.999Z','Sunday Service'],['2026-10-19T18:30:00Z','No meeting today'],['2026-10-20T18:29:59.999Z','No meeting today'],['2026-10-20T18:30:00Z','Healing Meeting']]){
  const html=renderToStaticMarkup(React.createElement(AssignedHeading,{now:new Date(time)}));assert.ok(html.includes('<h2>'+title+'</h2>'));
 }
});
