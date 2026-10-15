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
const attendance=load('../src/lib/members/attendance.ts',{'./absence':absence,'@/lib/tasks/meeting-overview':overview});
const members=[{id:'sarah',name:'Sarah',activeUntil:null},{id:'jerin',name:'Jerin',activeUntil:null},{id:'daniel',name:'Daniel',activeUntil:'2099-01-01T00:00:00Z'}];
const now=new Date('2026-10-15T12:00:00+05:30');
const absent=(patch={})=>({id:'a',memberId:'sarah',category:'Healing Meeting',meetingDate:null,createdAt:'2026-10-15T00:00:00+05:30',expiresAt:'2026-10-15T24:00:00+05:30',...patch});
const state=(absences=[])=>({current:members[1],members,workspace:{id:'workspace'},absences});
const ids=rows=>Array.from(rows,row=>row.id);

test('Attendance partitions workspace members once, keeps You first and is independent of online status',()=>{
 const data=state([absent(),absent({id:'duplicate'}),absent({id:'departed',memberId:'former'})]);const before=JSON.stringify(data);
 const result=attendance.meetingAttendance(data,'Healing Meeting',now);
 assert.equal(result.ready,true);assert.deepEqual(ids(result.absent),['sarah']);assert.deepEqual(ids(result.present),['jerin','daniel']);assert.equal(JSON.stringify(data),before);
 assert.equal(result.absent.length+result.present.length,members.length);
});
test('Missing attendance or workspace identity fails closed instead of inferring everyone Present',()=>{
 for(const data of [null,{...state(),absences:undefined},{...state(),current:null},{...state(),workspace:null},{...state(),current:{id:'former'}}]){
  const result=attendance.meetingAttendance(data,'Healing Meeting',now);assert.equal(result.ready,false);assert.equal(result.present.length,0);assert.equal(result.absent.length,0);
 }
 assert.equal(attendance.meetingAttendance(state([]),'Healing Meeting',now).present.length,3);
});
test('Meeting-specific absence ends exactly at its deadline; unmark and renamed profiles update without task changes',()=>{
 const data=state([absent(),absent({id:'other',memberId:'daniel',category:'Sunday Service'})]);
 assert.deepEqual(ids(attendance.meetingAttendance(data,'Healing Meeting',new Date('2026-10-15T23:59:59.999+05:30')).absent),['sarah']);
 assert.equal(attendance.meetingAttendance(data,'Healing Meeting',new Date('2026-10-15T24:00:00+05:30')).absent.length,0);
 assert.equal(attendance.meetingAttendance(state([absent({expiresAt:now.toISOString()})]),'Healing Meeting',now).absent.length,0);
 const renamed={...data,members:data.members.map(member=>member.id==='sarah'?{...member,name:'Sarah New'}:member)};
 assert.equal(attendance.meetingAttendance(renamed,'Healing Meeting',now).absent[0].name,'Sarah New');
 assert.equal(attendance.meetingAttendance(state([absent({createdAt:'2026-10-16T00:00:00+05:30'})]),'Healing Meeting',now).absent.length,0);
});
test('Regular meeting switches on the existing India weekday schedule and Sunday absence does not carry into Healing',()=>{
 const data=state([absent({category:'Sunday Service',createdAt:'2026-10-18T00:00:00+05:30',expiresAt:'2026-10-19T24:00:00+05:30'})]);
 for(const [stamp,category,count] of [['2026-10-19T23:59:59+05:30','Sunday Service',1],['2026-10-19T24:00:00+05:30','',0],['2026-10-20T00:00:00+05:30','',0],['2026-10-21T00:00:00+05:30','Healing Meeting',0]]){
  const time=new Date(stamp),meeting=attendance.attendanceMeetings([],time)[0];assert.equal(meeting?.category??'',category);assert.equal(attendance.meetingAttendance(data,category,time).absent.length,count);
 }
});
test('Special Meetings are separated by selected date, deduplicated and gated by available visible tasks',()=>{
 const task=(patch={})=>({...model.blankTask(),id:'t',category:'Special Meeting',title:'Prepare meeting',date:'2026-10-15',time:'23:50',createdAt:'2026-10-14T00:00:00Z',...patch});
 const tasks=[task(),task({id:'same'}),task({id:'other',date:'2026-10-16'}),task({id:'unreleased',date:'2026-10-22',availableAt:'2026-10-21T18:30:00Z'}),task({id:'history',historyAt:'2026-10-14T12:00:00Z',completed:true,completedAt:'2026-10-14T12:00:00Z'}),task({id:'regular',category:'Healing Meeting'})];
 const meetings=attendance.attendanceMeetings(tasks,now);assert.deepEqual(Array.from(meetings,m=>[m.category,m.meetingDate]),[['Healing Meeting',null],['Special Meeting','2026-10-15']]);
 const data=state([absent({category:'Special Meeting',meetingDate:'2026-10-15'})]);
 assert.deepEqual(ids(attendance.meetingAttendance(data,'Special Meeting',now,'2026-10-15').absent),['sarah']);assert.equal(attendance.meetingAttendance(data,'Special Meeting',now,'2026-10-16').absent.length,0);
 assert.equal(attendance.attendanceMeetings([],now).length,1);
 assert.equal(attendance.attendanceMeetings([task({id:'old',completed:true,completedAt:'2026-10-14T00:00:00Z',date:'2026-10-14'})],new Date('2026-10-15T24:00:00+05:30')).length,1);
});

test('Sunday Attendance splits scopes and preserves a legacy both mark until its service return/expiry',()=>{
 const time=new Date('2026-10-18T14:00:00+05:30');
 const sunday=(patch={})=>absent({category:'Sunday Service',createdAt:'2026-10-18T00:00:00+05:30',expiresAt:'2026-10-20T00:00:00+05:30',...patch});
 const data=state([sunday({sundayService:'morning'}),sunday({id:'legacy',memberId:'jerin',morningReturnedAt:'2026-10-18T10:00:00+05:30'})]);
 assert.deepEqual(ids(attendance.meetingAttendance(data,'Sunday Service',time,null,'morning').absent),['sarah']);
 assert.deepEqual(ids(attendance.meetingAttendance(data,'Sunday Service',time,null,'evening').absent),['jerin']);
 assert.deepEqual(Array.from(attendance.attendanceMeetings([],time),m=>m.sundayService),['morning','evening']);
 assert.equal(attendance.meetingAttendance(data,'Sunday Service',new Date('2026-10-20T00:00:00+05:30'),null,'evening').absent.length,0);
 const legacy=state([sunday()]);for(const service of ['morning','evening'])assert.equal(attendance.meetingAttendance(legacy,'Sunday Service',time,null,service).absent.length,1);
});
test('a helper absent only in Morning may take an Evening task but not a Morning task',()=>{
 const time=new Date('2026-10-18T14:00:00+05:30');const data=state([absent({memberId:'jerin',category:'Sunday Service',sundayService:'morning',createdAt:'2026-10-18T00:00:00+05:30',expiresAt:'2026-10-20T00:00:00+05:30'})]);
 const task={...model.blankTask(),category:'Sunday Service',assignedToId:'sarah',coverage:{memberId:'sarah',expiresAt:'2026-10-20T00:00:00+05:30'}};
 assert.equal(absence.canTakeTask({...task,sundayService:'morning'},data,time),false);
 assert.equal(absence.canTakeTask({...task,sundayService:'evening'},data,time),true);
});
