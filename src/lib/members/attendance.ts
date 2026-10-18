import { activeAbsences, absenceCoversService } from "./absence";
import type { CheckInData } from "@/lib/check-in/model";
import type { MemberState } from "./model";
import { automaticOverviewCategory, meetingOverview } from "@/lib/tasks/meeting-overview";
import type { SundayService, Task } from "@/lib/tasks/model";

// Present requires a check-in for this occurrence; never infer attendance from online status.
export function meetingAttendance(state: MemberState | null, category: string, now: Date, meetingDate: string | null = null, sundayService: SundayService | null = null, checkIns: CheckInData | null = null) {
  const ready = !!(state?.current && state.workspace && state.absences !== undefined
    && state.members.some(member => member.id === state.current!.id) && checkIns?.currentId === state.current.id);
  if (!ready || !state) return { ready: false, absent: [], present: [], notChecked: [] };
  const ids = new Set(activeAbsences(state, now)
    .filter(absence => absence.category === category
      && absenceCoversService(absence,sundayService,now)
      && (category !== "Special Meeting" || meetingDate === null || absence.meetingDate === meetingDate))
    .map(absence => absence.memberId));
  const people = [...state.members].sort((a, b) => Number(b.id === state.current!.id) - Number(a.id === state.current!.id));
  const context = checkIns!.contexts.find(c => c.category === category && c.service === sundayService && (meetingDate === null || c.meetingDate === meetingDate) && now.getTime() < Date.parse(c.visibleUntil));
  const key = context ? [context.categoryId,context.meetingDate,context.service??"",context.meetingId??""].join(":") : null;
  const checked = new Set(checkIns!.presence.filter(p => p.key === key).map(p => p.memberId));
  return { ready: true, notChecked: people.filter(member => !ids.has(member.id) && !checked.has(member.id)), absent: people.filter(member => ids.has(member.id)), present: people.filter(member => !ids.has(member.id) && checked.has(member.id)) };
}

export function attendanceMeetings(tasks: Task[], now: Date,meetings:import("@/lib/special-meetings/model").SpecialMeeting[]=[]) {
  const event=meetings.find(e=>!e.locked&&Date.parse(e.startsAt)<=now.getTime()&&now.getTime()<Date.parse(e.endsAt));
  if(event)return [{category:"Special Meeting",meetingDate:event.days===null?event.startDate:new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(now),sundayService:null}];
  const dates = [...new Set(meetingOverview(tasks, "Special Meeting", now).tasks.map(task => task.date || null))];
  dates.sort((a, b) => (a ?? "").localeCompare(b ?? ""));
  const regular = automaticOverviewCategory(now);
  return [...(regular === "Sunday Service" ? (["morning","evening"] as SundayService[]).map(sundayService=>({category:regular,meetingDate:null as string|null,sundayService}))
    : regular ? [{category:regular,meetingDate:null as string|null,sundayService:null}] : []),
    ...dates.map(meetingDate => ({ category: "Special Meeting", meetingDate,sundayService:null }))];
}
