import {displayMemberName} from "@/lib/members/display-name";
import type {Member} from "@/lib/members/model";
import {accountClock,MEETING_CATEGORIES,matchesTask,type Filters,type Task} from "./model";
import {isCategoryTaskVisible,regularMeetingWindow,specialMeetingIsOpen} from "./meeting-period";
export function assignmentLabel(task:Task,currentId:string|undefined,members:Member[]):string {
 if(task.completed&&task.missedCompletionRole)return `Assigned to ${displayMemberName(task.assignedToId,null,members)||"a former member"}`;
 if(task.completed&&task.claimOrigin&&task.claimOrigin.takenById===task.assignedToId)return `Assigned to ${displayMemberName(task.claimOrigin.memberId,task.claimOrigin.memberName,members)}`;
 if(task.assignedToId&&task.assignedToId===currentId)return "Assigned to me";
 if(!task.assignedToId)return "Unassigned";
 const name=members.find(member=>member.id===task.assignedToId)?.name;
 return task.completed?`Assigned to ${name??"a former member"}`:`Only ${name??"the assigned member"} can complete`;
}
export function matchesAssignedTask(task:Task,currentId:string|undefined,filters:Filters,date:string,time:string,now:Date):boolean {
 return !!currentId&&task.assignedToId===currentId&&isCategoryTaskVisible(task,now,date,time)&&matchesTask(task,filters,date,time,now);
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
 return !!(Number.isFinite(now.getTime())&&MEETING_CATEGORIES.includes(task.category)&&currentId&&(role==="owner"||role==="coordinator")&&!task.completed&&task.assignedToId&&task.assignedToId!==currentId
  &&(!task.availableAt||Date.parse(task.availableAt)<=now.getTime())
  &&!(task.coverage&&task.coverage.memberId===task.assignedToId&&Date.parse(task.coverage.expiresAt)>now.getTime()));
}
// The database repeats this timing check after taking its mutation locks.
export function missedCompletionTiming(task:Task,now:Date):{open:boolean;message:string} {
 if(!Number.isFinite(now.getTime()))return {open:false,message:"Refresh to check this task’s scheduled date."};
 if(task.date){
  const open=task.date<=accountClock(now,"Asia/Kolkata").date;
  return {open,message:open?"":"This task is scheduled for a future date. Missed completion is available from 12:00 AM India time on its scheduled date."};
 }
 const open=task.category==="Special Meeting"?specialMeetingIsOpen(task,now):regularMeetingWindow(now).category===task.category;
 return {open,message:open?"":"This task has no due date. Missed completion is available only during its meeting period."};
}
export function canCompleteMissed(task:Task,currentId:string|undefined,role:string|undefined,now:Date):boolean {
 return canReviewMissed(task,currentId,role,now)&&missedCompletionTiming(task,now).open;
}
export function completionRoleLabel(task:Task):string|null {
 return task.completed&&task.missedCompletionRole ? task.missedCompletionRole==="owner"?"Owner":"Coordinator" : null;
}
