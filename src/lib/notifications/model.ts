import {isRecord,uuid,timestamp} from "@/lib/tasks/validation";
import {accountClock,compareNewestTime} from "@/lib/tasks/model";
export const REOPEN_REASONS=["Marked completed by mistake","Work needs correction","Work is not finished"] as const;
export const KINDS=["task_available","task_taken","released_completed","reassigned_to","reassigned_from","missed","overdue","fine_applied","fine_paid","fine_cancelled","role_changed","request_received","request_result"] as const;
export type NotificationKind=typeof KINDS[number];
export type RequestStatus="pending"|"approved"|"declined"|"unavailable";
export type Preferences={availability:boolean;coverageUpdates:boolean;reassignments:boolean};
export type Notification={id:string;kind:NotificationKind;taskId:string|null;title:string|null;category:string|null;actorName:string|null;payload:Record<string,unknown>;createdAt:string;readAt:string|null;taskAvailable:boolean;canTake:boolean;takenBy:string|null;canRequest:boolean;requestId:string|null;requestStatus:RequestStatus|null};
export type ReopenRequest={id:string;taskId:string;title:string;requesterId:string;requesterName:string;reviewerId:string;reviewerName:string;completedAt:string;reason:typeof REOPEN_REASONS[number];status:RequestStatus;createdAt:string;version:string;unavailableReason:string|null;canReview:boolean};
export type NotificationsData={serverNow:string;currentId:string;entries:Notification[];requests:ReopenRequest[];preferences:Preferences};
export type ClearSnapshot={count:number;snapshot:string};
export type NotificationAction={action:"read";ids:string[]}|{action:"preferences";preferences:Preferences}|{action:"preview_clear"}|({action:"clear";confirmed:true}&ClearSnapshot)|{action:"request";taskId:string;completedAt:string;reason:typeof REOPEN_REASONS[number];confirmed:true}|{action:"review";id:string;version:string;decision:"approved"|"declined";confirmed:true};
const only=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).every(k=>keys.includes(k));
const text=(v:unknown,max=200):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=max;
const optionalText=(v:unknown,max=200)=>v===null||text(v,max);
const statuses=["pending","approved","declined","unavailable"];
export function preferences(v:unknown):v is Preferences{return isRecord(v)&&only(v,["availability","coverageUpdates","reassignments"])&&[v.availability,v.coverageUpdates,v.reassignments].every(x=>typeof x==="boolean");}
export function clearSnapshot(v:unknown):ClearSnapshot {if(!isRecord(v)||!Number.isSafeInteger(v.count)||(Number(v.count)<0||Number(v.count)>2147483647)||typeof v.snapshot!=="string"||!/^[a-f0-9]{32}$/.test(v.snapshot))throw Error("Message count could not be confirmed. Refresh before clearing.");return {count:Number(v.count),snapshot:v.snapshot};}
export function notificationAction(v:unknown):NotificationAction|null{
 if(!isRecord(v))return null;
 if(v.action==="read"&&only(v,["action","ids"])&&Array.isArray(v.ids)&&v.ids.length>0&&v.ids.length<=100&&v.ids.every(uuid)&&new Set(v.ids).size===v.ids.length)return v as NotificationAction;
 if(v.action==="preferences"&&only(v,["action","preferences"])&&preferences(v.preferences))return v as NotificationAction;
 if(v.action==="preview_clear"&&only(v,["action"]))return {action:"preview_clear"};
 if(v.confirmed!==true)return null;
 if(v.action==="clear"&&only(v,["action","confirmed","count","snapshot"])){try{clearSnapshot(v);return v as NotificationAction;}catch{return null;}}
 if(v.action==="request"&&only(v,["action","taskId","completedAt","reason","confirmed"])&&uuid(v.taskId)&&timestamp(v.completedAt)&&REOPEN_REASONS.includes(v.reason as typeof REOPEN_REASONS[number]))return v as NotificationAction;
 if(v.action==="review"&&only(v,["action","id","version","decision","confirmed"])&&uuid(v.id)&&timestamp(v.version)&&["approved","declined"].includes(v.decision as string))return v as NotificationAction;
 return null;
}
export function decodeNotifications(v:unknown):NotificationsData{
 if(!isRecord(v)||!timestamp(v.serverNow)||!uuid(v.currentId)||!preferences(v.preferences)||!Array.isArray(v.entries)||v.entries.length>10000||!Array.isArray(v.requests)||v.requests.length>10000)throw Error("Incomplete notifications. Refresh to try again.");
 const entries=v.entries.map((x):Notification=>{
  if(!isRecord(x)||!uuid(x.id)||!KINDS.includes(x.kind as NotificationKind)||(x.taskId!==null&&!uuid(x.taskId))||!optionalText(x.title)||!optionalText(x.category,40)||!optionalText(x.actorName,50)||!isRecord(x.payload)||!timestamp(x.createdAt)||(x.readAt!==null&&!timestamp(x.readAt))||![x.taskAvailable,x.canTake,x.canRequest].every(b=>typeof b==="boolean")||!optionalText(x.takenBy,50)||(x.requestId!==null&&!uuid(x.requestId))||(x.requestStatus!==null&&!statuses.includes(x.requestStatus as string)))throw Error("Incomplete notification. Refresh before acting.");
  if(x.kind==='missed'&&(!timestamp(x.payload.completedAt)||!['owner','coordinator'].includes(x.payload.role as string)))throw Error('Incomplete completion notice.');
  if(x.kind==='task_available'&&!uuid(x.payload.absenceId))throw Error('Incomplete availability notice.');
  if(x.kind==='overdue'&&!timestamp(x.payload.dueAt))throw Error('Incomplete overdue notice.');
  if(String(x.kind).startsWith('fine_')&&(x.payload.amountPaise!==5000||!uuid(x.payload.fineId)||!['unpaid','paid','cancelled'].includes(x.payload.status as string)))throw Error('Incomplete fine notice.');
  if(x.kind==='role_changed'&&(!['owner','coordinator','member'].includes(x.payload.role as string)||!['owner','coordinator','member'].includes(x.payload.previousRole as string)))throw Error('Incomplete role notice.');
  if(x.kind==='request_result'&&!['approved','declined','unavailable'].includes(x.payload.status as string))throw Error('Incomplete request result.');
  if((x.kind==='request_received'||x.kind==='request_result')&&!uuid(x.payload.requestId))throw Error('Incomplete request notice.');
  return x as Notification;
 });
 const requests=v.requests.map((x):ReopenRequest=>{
  if(!isRecord(x)||!uuid(x.id)||!uuid(x.taskId)||!text(x.title)||!uuid(x.requesterId)||!text(x.requesterName,50)||!uuid(x.reviewerId)||!text(x.reviewerName,50)||x.requesterId===x.reviewerId||![x.requesterId,x.reviewerId].includes(String(v.currentId))||!timestamp(x.completedAt)||!REOPEN_REASONS.includes(x.reason as typeof REOPEN_REASONS[number])||!statuses.includes(x.status as string)||!timestamp(x.createdAt)||!timestamp(x.version)||!optionalText(x.unavailableReason,500)||typeof x.canReview!=="boolean"||x.canReview!==(x.status==='pending'&&x.reviewerId===v.currentId))throw Error('Incomplete reopening request. Refresh before reviewing.');
  return x as ReopenRequest;
 });
 if(new Set(entries.map(x=>x.id)).size!==entries.length||new Set(requests.map(x=>x.id)).size!==requests.length)throw Error('Duplicate inbox data. Refresh before acting.');
 return {serverNow:v.serverNow,currentId:v.currentId,preferences:v.preferences,entries:entries.sort((a,b)=>compareNewestTime(a.createdAt,b.createdAt)||b.id.localeCompare(a.id)),requests:requests.sort((a,b)=>compareNewestTime(a.createdAt,b.createdAt)||b.id.localeCompare(a.id))};
}
export function visibleNotifications(data:NotificationsData|null):Notification[]{return (data?.entries??[]).filter(n=>n.kind==='task_available'?data!.preferences.availability:['task_taken','released_completed'].includes(n.kind)?data!.preferences.coverageUpdates:['reassigned_to','reassigned_from'].includes(n.kind)?data!.preferences.reassignments:true);}
export function notificationCounts(data:NotificationsData|null){const items=visibleNotifications(data);return {all:items.length,unread:items.filter(n=>!n.readAt).length,requests:data?.requests.length??0,pending:(data?.requests??[]).filter(r=>r.status==='pending'&&r.canReview).length};}
export function messageAge(value:string,now:Date):string{const day=accountClock(new Date(value),'Asia/Kolkata').date,current=accountClock(now,'Asia/Kolkata').date,days=(Date.parse(current)-Date.parse(day))/86400000;return days===0?'Today':days===1?'Yesterday':new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',month:'short',day:'numeric',year:day.slice(0,4)!==current.slice(0,4)?'numeric':undefined}).format(new Date(value));}
export function messageTime(value:string,now:Date):string{return `${messageAge(value,now)} · ${new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit'}).format(new Date(value))}`;}
export const statusLabel=(status:RequestStatus)=>({pending:'Pending',approved:'Approved',declined:'Declined',unavailable:'No longer available'})[status];
export function notificationCopy(n:Notification):{heading:string;body:string;tone:'navy'|'red'|'green'|'gold';icon:'people'|'shield'|'clock'|'rupee'|'warning'|'check'|'request'}{
 const actor=n.actorName||'A teammate',role=n.payload.role==='owner'?'Owner':'Coordinator';
 switch(n.kind){
  case 'task_available':return {heading:'Task available',body:`${actor} released this task. A teammate is needed.`,tone:'gold',icon:'people'};
  case 'task_taken':return {heading:'Your task was taken',body:`${actor} took your task.`,tone:'navy',icon:'people'};
  case 'released_completed':return {heading:'Your released task is complete',body:`Completed by ${['owner','coordinator'].includes(n.payload.role as string)?role:actor}.`,tone:'green',icon:'check'};
  case 'reassigned_to':return {heading:'Task reassigned to you',body:'This task has been reassigned to you.',tone:'navy',icon:'people'};
  case 'reassigned_from':return {heading:'Task reassigned',body:`This task has been reassigned from you to ${actor}.`,tone:'navy',icon:'people'};
  case 'missed':return {heading:'Task completed as Missed',body:`${role==='Owner'?'An':'A'} ${role} completed this task as Missed.`,tone:'red',icon:'shield'};
  case 'overdue':return {heading:'Task overdue',body:'Your assigned task has passed its due time.',tone:'red',icon:'warning'};
  case 'fine_applied':return {heading:'Fine applied',body:'A ₹50 fine has been applied for this task.',tone:'red',icon:'rupee'};
  case 'fine_paid':return {heading:'Fine paid',body:'Your ₹50 fine has been marked paid.',tone:'green',icon:'rupee'};
  case 'fine_cancelled':return {heading:'Fine cancelled',body:'Your ₹50 fine has been cancelled.',tone:'gold',icon:'rupee'};
  case 'role_changed':return {heading:n.payload.role==='coordinator'&&n.payload.previousRole==='member'?'Promoted to Coordinator':`Role changed to ${String(n.payload.role).replace(/^./,c=>c.toUpperCase())}`,body:`Your role has been updated from ${String(n.payload.previousRole).replace(/^./,c=>c.toUpperCase())} to ${String(n.payload.role).replace(/^./,c=>c.toUpperCase())}.`,tone:'navy',icon:'shield'};
  case 'request_received':return {heading:'Reopening requested',body:`${actor} requested reopening.`,tone:'gold',icon:'request'};
  case 'request_result':{const s=n.payload.status;return {heading:s==='approved'?'Reopening approved':s==='declined'?'Reopening declined':'Request no longer available',body:s==='approved'?'Your request was approved. The task is active again.':s==='declined'?'Your request was declined. The task remains completed.':typeof n.payload.unavailableReason==='string'?n.payload.unavailableReason:'The task or its completion changed.',tone:s==='approved'?'green':s==='declined'?'red':'navy',icon:'request'};}
 }
}
