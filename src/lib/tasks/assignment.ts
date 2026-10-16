import {displayMemberName} from "@/lib/members/display-name";
import type {Member} from "@/lib/members/model";
import {accountClock,MEETING_CATEGORIES,matchesTask,type Filters,type Task} from "./model";
import {isCategoryTaskVisible} from "./meeting-period";
export function assignmentLabel(task:Task,currentId:string|undefined,members:Member[]):string {
 if(task.completed&&task.missedCompletionRole)return `Assigned to ${displayMemberName(task.assignedToId,null,members)||"a former member"}`;
 if(task.completed&&task.claimOrigin&&task.claimOrigin.takenById===task.assignedToId)return `Assigned to ${displayMemberName(task.claimOrigin.memberId,task.claimOrigin.memberName,members)}`;
 if(task.assignedToId&&task.assignedToId===currentId)return "Assigned to me";
 if(!task.assignedToId)return "Unassigned";
 const name=members.find(member=>member.id===task.assignedToId)?.name;
 return task.completed?`Assigned to ${name??"a former member"}`:`Only ${name??"the assigned member"} can complete`;
}
export type AssignedTaskScope="regular"|"special";
export function matchesAssignedTask(task:Task,currentId:string|undefined,filters:Filters,date:string,time:string,now:Date,scope?:AssignedTaskScope):boolean {
 return !!currentId&&task.assignedToId===currentId&&(!scope||(scope==="special"?task.category==="Special Meeting":task.category!=="Special Meeting"))&&isCategoryTaskVisible(task,now,date,time)&&matchesTask(task,filters,date,time,now);
}

export function isChangedCompletion(task:Task):boolean {
 const origin=task.claimOrigin;
 return !!(task.completed && origin && task.completedById===origin.takenById && task.assignedToId===origin.takenById && origin.memberId!==task.completedById);
}

// A helper transfer is distinct from an ordinary edit or coordinator reassignment.
export function isChangedAssignment(task:Task):boolean {
 const origin=task.claimOrigin;
 return !!(!task.completed && origin && task.assignedToId===origin.takenById && origin.memberId!==origin.takenById);
}

// A Missed completion is reopened by its recorded actor, never by role alone.
export function canReopenMissed(task:Task,currentId:string|undefined):boolean {
 return !!(task.completed&&task.missedCompletionRole&&currentId&&task.completedById===currentId);
}
export function canReviewMissed(task:Task,currentId:string|undefined,role:string|undefined,now:Date):boolean {
 return !!((!task.specialMeeting||!task.specialMeeting.locked&&!!task.specialEnabled&&now.getTime()>=Date.parse(task.specialMeeting.startsAt)&&now.getTime()<Date.parse(task.specialMeeting.endsAt))&&Number.isFinite(now.getTime())&&MEETING_CATEGORIES.includes(task.category)&&currentId&&(role==="owner"||role==="coordinator")&&!task.completed&&task.assignedToId&&task.assignedToId!==currentId
  &&(!task.availableAt||Date.parse(task.availableAt)<=now.getTime())
  &&!(task.coverage&&task.coverage.memberId===task.assignedToId&&Date.parse(task.coverage.expiresAt)>now.getTime()));
}
// India time; 7 PM is inclusive and the following 1 AM is exclusive.
const missedWeekdays:Record<string,number>={"Sunday Service":0,"Healing Meeting":3,"Revival Meeting":5};
function shiftMeetingDay(day:string,amount:number):string {
 const date=new Date(`${day}T12:00:00Z`);
 if(!Number.isFinite(date.getTime()))return "";
 date.setUTCDate(date.getUTCDate()+amount);
 return date.toISOString().slice(0,10);
}
const meetingWeekday=(day:string)=>new Date(`${day}T12:00:00Z`).getUTCDay();
// The database repeats this timing check after taking its mutation locks.
export function missedCompletionTiming(task:Task,now:Date):{open:boolean;message:string} {
 if(task.specialMeeting&&(task.specialMeeting.locked||!task.specialEnabled||now.getTime()<Date.parse(task.specialMeeting.startsAt)||now.getTime()>=Date.parse(task.specialMeeting.endsAt)))return {open:false,message:"This Special Meeting is locked, not started, or has ended. Final-day Missed actions close at11:59PM India time."};
 const morning=task.category==="Sunday Service"&&task.sundayService==="morning";
 const message=morning?"Morning Service Missed completion is available only on this task’s Sunday, from 9:00 AM until 4:00 PM India time.":"Missed completion is available only from 7:00 PM on this task’s meeting day until 1:00 AM the following day, India time.";
 const result=(open:boolean)=>({open,message:open?"":message});
 if(!Number.isFinite(now.getTime()))return {open:false,message:"Refresh to check this task’s meeting window."};
 const clock=accountClock(now,"Asia/Kolkata");
 if(morning?(clock.time<"09:00:00"||clock.time>="16:00:00"):(clock.time>="01:00:00"&&clock.time<"19:00:00"))return result(false);
 const meetingDay=shiftMeetingDay(clock.date,!morning&&clock.time<"01:00:00"?-1:0);
 if(task.date&&task.date>clock.date)return result(false);
 if(Object.prototype.hasOwnProperty.call(missedWeekdays,task.category)){
  const weekday=missedWeekdays[task.category];
  if(meetingWeekday(meetingDay)!==weekday)return result(false);
  if(!task.date)return result(true);
  // A date on the meeting's following day belongs to that same meeting.
  // Other dated occurrences must never become eligible again next week.
  const distance=(meetingWeekday(task.date)-weekday+7)%7;
  return result(distance<=1&&meetingDay===shiftMeetingDay(task.date,-distance));
 }
 if(task.category!=="Special Meeting")return result(false);
 if(task.date)return result(meetingDay===task.date);
 if(task.weekdays.length)return result(task.weekdays.includes(meetingWeekday(meetingDay)));
 const created=Date.parse(task.createdAt);
 return result(Number.isFinite(created)&&now.getTime()>=created&&meetingDay===accountClock(new Date(created),"Asia/Kolkata").date);
}
export function canCompleteMissed(task:Task,currentId:string|undefined,role:string|undefined,now:Date):boolean {
 return canReviewMissed(task,currentId,role,now)&&missedCompletionTiming(task,now).open;
}
export function completionRoleLabel(task:Task):string|null {
 return task.completed&&task.missedCompletionRole ? task.missedCompletionRole==="owner"?"Owner":"Coordinator" : null;
}
