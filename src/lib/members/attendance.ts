import { activeAbsences, absenceCoversService } from "./absence";
import type { MemberState } from "./model";
import { automaticOverviewCategory, meetingOverview } from "@/lib/tasks/meeting-overview";
import type { SundayService, Task } from "@/lib/tasks/model";

// Present describes members without an active absence, not online presence or check-in.
export function meetingAttendance(state: MemberState | null, category: string, now: Date, meetingDate: string | null = null, sundayService: SundayService | null = null) {
  const ready = !!(state?.current && state.workspace && state.absences !== undefined
    && state.members.some(member => member.id === state.current!.id));
  if (!ready || !state) return { ready: false, absent: [], present: [] };
  const ids = new Set(activeAbsences(state, now)
    .filter(absence => absence.category === category
      && absenceCoversService(absence,sundayService,now)
      && (category !== "Special Meeting" || meetingDate === null || absence.meetingDate === meetingDate))
    .map(absence => absence.memberId));
  const people = [...state.members].sort((a, b) => Number(b.id === state.current!.id) - Number(a.id === state.current!.id));
  return { ready: true, absent: people.filter(member => ids.has(member.id)), present: people.filter(member => !ids.has(member.id)) };
}

export function attendanceMeetings(tasks: Task[], now: Date) {
  const dates = [...new Set(meetingOverview(tasks, "Special Meeting", now).tasks.map(task => task.date || null))];
  dates.sort((a, b) => (a ?? "").localeCompare(b ?? ""));
  const regular = automaticOverviewCategory(now);
  return [...(regular === "Sunday Service" ? (["morning","evening"] as SundayService[]).map(sundayService=>({category:regular,meetingDate:null as string|null,sundayService}))
    : regular ? [{category:regular,meetingDate:null as string|null,sundayService:null}] : []),
    ...dates.map(meetingDate => ({ category: "Special Meeting", meetingDate,sundayService:null }))];
}
