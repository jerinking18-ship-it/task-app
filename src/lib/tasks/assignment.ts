import type {Member} from "@/lib/members/model";
import {matchesTask,type Filters,type Task} from "./model";
import {isCategoryTaskVisible} from "./meeting-period";
export function assignmentLabel(task:Task,currentId:string|undefined,members:Member[]):string {
 if(task.assignedToId&&task.assignedToId===currentId)return "Assigned to me";
 if(!task.assignedToId)return "Unassigned";
 const name=members.find(member=>member.id===task.assignedToId)?.name;
 return task.completed?`Assigned to ${name??"a former member"}`:`Only ${name??"the assigned member"} can do this`;
}
export function matchesAssignedTask(task:Task,currentId:string|undefined,filters:Filters,date:string,time:string,now:Date):boolean {
 return !!currentId&&task.assignedToId===currentId&&isCategoryTaskVisible(task,now,date,time)&&matchesTask(task,filters,date,time,now);
}
