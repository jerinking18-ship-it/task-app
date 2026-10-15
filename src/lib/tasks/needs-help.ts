import type { Task } from "./model";
import { automaticOverviewCategory, meetingOverview } from "./meeting-overview";

// One source of visibility and expiry rules for the list and its menu counter.
export function needsHelpMeeting(tasks: Task[], category: string, currentMemberId: string | undefined, now: Date, coverageNow = now, search = "") {
  const query = search.trim().toLocaleLowerCase();
  const released = meetingOverview(tasks, category, now, coverageNow).needsHelp;
  const shown = released.filter(task => !query || `${task.title} ${task.notes}`.toLocaleLowerCase().includes(query));
  return { released, others: shown.filter(task => task.assignedToId !== currentMemberId), mine: shown.filter(task => !!currentMemberId && task.assignedToId === currentMemberId) };
}

export function needsHelpCount(tasks: Task[], now: Date, coverageNow = now) {
  const category = automaticOverviewCategory(now);
  return meetingOverview(tasks, category, now, coverageNow).needsHelp.length
    + meetingOverview(tasks, "Special Meeting", now, coverageNow).needsHelp.length;
}
