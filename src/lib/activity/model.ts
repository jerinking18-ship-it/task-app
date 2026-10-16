import {isRecord,uuid,timestamp} from '@/lib/tasks/validation';
import {accountClock} from '@/lib/tasks/model';
export const ACTIVITY_KINDS={
 task_created:'Task created',task_edited:'Task edited',task_completed:'Task completed',task_reopened:'Task reopened',task_missed:'Missed completion',task_reassigned:'Task reassigned',repeat_reassigned:'Repeats reassigned',task_taken:'Task taken',task_moved:'Task moved to Bin',task_restored:'Task restored',task_deleted:'Task permanently deleted',
 member_joined:'Member joined',member_left:'Member left',name_changed:'Profile name changed',role_changed:'Role changed',absence_marked:'Marked absent',absence_unmarked:'Unmarked absent',restriction_removed:'Restriction removed',
 fine_issued:'Fine issued',fine_paid:'Fine paid',fine_cancelled:'Fine cancelled',template_created:'Template created',template_edited:'Template edited',template_moved:'Template moved to Bin',template_restored:'Template restored',template_deleted:'Template permanently deleted',
 reopen_requested:'Reopening requested',reopen_approved:'Reopening approved',reopen_declined:'Reopening declined',reopen_unavailable:'Request unavailable',meeting_title_changed:'Meeting title changed',
} as const;
export type ActivityKind=keyof typeof ACTIVITY_KINDS;
export type ActivityEntry={id:string;kind:ActivityKind;actorId:string|null;actorName:string;actorRole:string|null;affectedIds:string[];title:string|null;category:string|null;createdAt:string;details:Record<string,string|number|boolean>};
export type ActivityData={serverNow:string;total:number;hasMore:boolean;entries:ActivityEntry[];members:{id:string;name:string;left:boolean}[]};
export type ActivityFilter={member:string;relation:'performed'|'affecting';meeting:string;kind:string;days:'7'|'30'|'90'|'all'};
export const defaultActivityFilter:ActivityFilter={member:'',relation:'performed',meeting:'',kind:'',days:'7'};
const text=(v:unknown,max=200):v is string=>typeof v==='string'&&!!v.trim()&&v.length<=max;
const nullable=(v:unknown,max=200)=>v===null||text(v,max);
export function decodeActivity(v:unknown):ActivityData{
 if(!isRecord(v)||!timestamp(v.serverNow)||!Number.isSafeInteger(v.total)||Number(v.total)<0||typeof v.hasMore!=='boolean'||!Array.isArray(v.entries)||v.entries.length>100||!Array.isArray(v.members))throw Error('Activity could not be loaded completely.');
 const members=v.members.map(m=>{if(!isRecord(m)||!uuid(m.id)||!text(m.name,50)||typeof m.left!=='boolean')throw Error('Incomplete activity members.');return{id:m.id,name:m.name,left:m.left};});
 const entries=v.entries.map(e=>{
  if(!isRecord(e)||!uuid(e.id)||typeof e.kind!=='string'||!Object.hasOwn(ACTIVITY_KINDS,e.kind)||!(e.actorId===null||uuid(e.actorId))||!text(e.actorName,50)||!(e.actorRole===null||['owner','coordinator','member'].includes(String(e.actorRole)))||!Array.isArray(e.affectedIds)||!e.affectedIds.every(uuid)||!nullable(e.title)||!nullable(e.category,80)||!timestamp(e.createdAt)||!isRecord(e.details)||Object.values(e.details).some(x=>!['string','number','boolean'].includes(typeof x)))throw Error('Incomplete activity entry.');
  return e as unknown as ActivityEntry;
 });
 if(new Set(entries.map(e=>e.id)).size!==entries.length||new Set(members.map(m=>m.id)).size!==members.length||Number(v.total)<entries.length||(v.hasMore&&entries.length!==100))throw Error('Incomplete activity page.');
 return{serverNow:v.serverNow,total:Number(v.total),hasMore:v.hasMore,entries,members};
}
export function activityQuery(params:URLSearchParams){
 if([...params.keys()].some(k=>!['member','relation','meeting','kind','days','before','beforeId'].includes(k))||[...params.keys()].some(k=>params.getAll(k).length>1))return null;
 const member=params.get('member')||'',relation=params.get('relation')||'performed',meeting=params.get('meeting')||'',kind=params.get('kind')||'',days=params.get('days')||'7',before=params.get('before'),beforeId=params.get('beforeId');
 if((member&&!uuid(member))||!['performed','affecting'].includes(relation)||(meeting&&!['Sunday Service','Healing Meeting','Revival Meeting','Special Meeting'].includes(meeting))||(kind&&!Object.hasOwn(ACTIVITY_KINDS,kind))||!['7','30','90','all'].includes(days)||((before===null)!==(beforeId===null))||(before!==null&&(!timestamp(before)||!uuid(beforeId))))return null;
 return {filter:{member,relation,meeting,kind,days}as ActivityFilter,before,beforeId};
}
export function activityParams(filter:ActivityFilter,last?:ActivityEntry){const p=new URLSearchParams({...filter});if(last){p.set('before',last.createdAt);p.set('beforeId',last.id);}return p;}
export function activityDay(value:string,now:Date){const day=accountClock(new Date(value),'Asia/Kolkata').date,today=accountClock(now,'Asia/Kolkata').date,yesterday=accountClock(new Date(now.getTime()-86400000),'Asia/Kolkata').date;return day===today?'Today':day===yesterday?'Yesterday':new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',month:'long',day:'numeric',year:'numeric'}).format(new Date(value));}
const label=(v:unknown)=>typeof v==='string'?v:'';
export function activityCopy(e:ActivityEntry){
 const actor=e.actorName,member=label(e.details.memberName)||'a member',previous=label(e.details.previousMemberName)||'another member';
 const self=e.actorId!==null&&e.details.memberId===e.actorId;
 const role=(v:unknown)=>typeof v==='string'?v.charAt(0).toUpperCase()+v.slice(1):'';
 const phrases:Record<ActivityKind,string>={
  task_created:`${actor} created a task`,task_edited:`${actor} edited a task`,task_completed:`${actor} completed a task`,task_reopened:`${actor} reopened a task`,task_missed:`${actor} completed ${member}’s task as Missed`,
  task_reassigned:`${actor} reassigned a task to ${member}`,repeat_reassigned:`${actor} reassigned future repeats to ${member}`,task_taken:`${actor} took ${member}’s task`,task_moved:`${actor} moved a task to Bin`,task_restored:`${actor} restored a task`,task_deleted:`${actor} permanently deleted a task`,
  member_joined:`${member} joined the workspace`,member_left:`${member} left the workspace`,name_changed:`${actor} updated ${self?'their':member+'’s'} profile name`,role_changed:`${actor} changed ${member}’s role`,
  absence_marked:`${actor} marked ${self?'themselves':member} absent`,absence_unmarked:`${actor} unmarked ${self?'their':member+'’s'} absence`,restriction_removed:`${actor} removed ${member}’s restriction`,
  fine_issued:`${actor} issued a fine to ${member}`,fine_paid:`${actor} marked ${member}’s fine paid`,fine_cancelled:`${actor} cancelled ${member}’s fine`,
  template_created:`${actor} created a template`,template_edited:`${actor} edited a template`,template_moved:`${actor} moved a template to Bin`,template_restored:`${actor} restored a template`,template_deleted:`${actor} permanently deleted a template`,
  reopen_requested:`${actor} requested reopening`,reopen_approved:`${actor} approved ${member}’s reopening request`,reopen_declined:`${actor} declined ${member}’s reopening request`,reopen_unavailable:'Reopening request is no longer available',meeting_title_changed:`${actor} changed the Special Meeting title`,
 };
 const secondary=e.kind==='role_changed'?`${role(e.details.from)} → ${role(e.details.to)}`:e.kind==='name_changed'?`${label(e.details.from)} → ${label(e.details.to)}`:e.title||((e.details.service==='morning'?'Morning Service':e.details.service==='evening'?'Evening Service':'')||e.category)||'';
 const extra=e.kind.startsWith('fine_')&&typeof e.details.amountPaise==='number'?`₹${e.details.amountPaise/100}`:e.kind==='task_reassigned'?`${previous} → ${member}`:'';
 return{headline:phrases[e.kind],secondary,extra};
}
