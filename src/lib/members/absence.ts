import type { MemberState } from "./model";
import type { SundayService, Task } from "@/lib/tasks/model";

export type Absence = { id:string; memberId:string; categoryId:string; category:string;
  meetingDate:string|null; createdAt:string; expiresAt:string; sundayService?:SundayService|null;
  morningReturnedAt?:string|null; eveningReturnedAt?:string|null };
export type Coverage = { absenceId:string; memberId:string; memberName:string; expiresAt:string };

// Missing scope is a legacy Sunday mark covering both services until expiry.
export function absenceCoversService(absence:Absence,service:SundayService|null|undefined,now:Date):boolean {
  if(absence.category!=="Sunday Service"||!service)return true;
  if(absence.sundayService)return absence.sundayService===service;
  const returned=service==="morning"?absence.morningReturnedAt:absence.eveningReturnedAt;
  return !returned||Date.parse(returned)>now.getTime();
}
export function activeAbsences(state:MemberState|null,now:Date):Absence[] {
  return (state?.absences??[]).filter(a=>Date.parse(a.createdAt)<=now.getTime()&&Date.parse(a.expiresAt)>now.getTime()
    &&(a.category!=="Sunday Service"||absenceCoversService(a,"morning",now)||absenceCoversService(a,"evening",now)));
}
// Display people once while retaining each meeting's independent expiry.
export function absentMemberGroups(state:MemberState|null,now:Date):{memberId:string;name:string;categories:string[]}[] {
  const names=new Map((state?.members??[]).map(member=>[member.id,member.name]));
  const groups=new Map<string,{memberId:string;name:string;categories:string[]}>();
  for(const absence of activeAbsences(state,now)){
    const name=names.get(absence.memberId);if(!name)continue;
    let group=groups.get(absence.memberId);
    if(!group){group={memberId:absence.memberId,name,categories:[]};groups.set(absence.memberId,group);}
    if(!group.categories.includes(absence.category))group.categories.push(absence.category);
  }
  return [...groups.values()];
}
export function taskCoverage(task:Task,now:Date):Coverage|null {
  return !task.completed&&task.coverage&&task.coverage.memberId===task.assignedToId
    &&Date.parse(task.coverage.expiresAt)>now.getTime()?task.coverage:null;
}
export function canTakeTask(task:Task,state:MemberState|null,now:Date):boolean {
  const coverage=taskCoverage(task,now);
  if(!coverage||!state?.workspace||!state.current||coverage.memberId===state.current.id
    ||!state.members.some(m=>m.id===coverage.memberId))return false;
  return !activeAbsences(state,now).some(a=>a.memberId===state.current!.id&&a.category===task.category
    &&absenceCoversService(a,task.category==="Sunday Service"?task.sundayService??"evening":null,now)
    &&(a.category!=="Special Meeting"||!task.date||a.meetingDate===task.date));
}
