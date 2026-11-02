import { accountClock, inHistory, isAvailable, type Task } from "./model";
import { isCategoryTaskVisible, regularMeetingWindow, specialMeetingIsOpen } from "./meeting-period";
import { activeSpecialMeeting, type SpecialMeeting } from "@/lib/special-meetings/model";

export type MeetingCelebration = { key: string; meeting: string; total: number };

/** Called only with a confirmed own-task save, never from a load or count effect. */
export function completedMeeting(
  before: Task[], confirmed: Task, currentId: string | undefined, now: Date,
  meetings: SpecialMeeting[] = [], specialTitle = "Special Meeting",
): MeetingCelebration | null {
  const previous = before.find(task => task.id === confirmed.id);
  if (!currentId || !previous || previous.completed || !confirmed.completed
    || previous.assignedToId !== currentId || confirmed.assignedToId !== currentId
    || confirmed.completedById !== currentId || confirmed.missedCompletionRole
    || previous.category !== confirmed.category || previous.date !== confirmed.date
    || !Number.isFinite(now.getTime())) return null;

  const clock = accountClock(now, "Asia/Kolkata");
  const special = activeSpecialMeeting(meetings, now);
  const regular = regularMeetingWindow(now);
  let key: string;
  let inMeeting: (task: Task) => boolean;
  if (confirmed.category === "Special Meeting") {
    const event = confirmed.specialMeeting;
    if (!special || !event || special.id !== event.id || !specialMeetingIsOpen(confirmed, now)) return null;
    const day = event.days === null ? event.startDate : clock.date;
    key = `${currentId}:special:${event.id}:${day}`;
    inMeeting = task => task.category === "Special Meeting" && task.specialMeeting?.id === event.id
      && (task.date || event.startDate) === day && !!task.specialEnabled;
  } else {
    if (special || !regular.category || confirmed.category !== regular.category) return null;
    key = `${currentId}:${regular.category}:${regular.startsAt}`;
    inMeeting = task => task.category === regular.category && (!task.date
      || (Date.parse(`${task.date}T00:00:00+05:30`) >= regular.startsAt
        && Date.parse(`${task.date}T00:00:00+05:30`) < regular.endsAt));
  }
  const tasks = before.filter(task => task.assignedToId === currentId && inMeeting(task)
    && isAvailable(task, now) && !inHistory(task, now)
    && isCategoryTaskVisible(task, now, clock.date, clock.time));
  if (!tasks.some(task => task.id === confirmed.id) || tasks.some(task => {
    const result = task.id === confirmed.id ? confirmed : task;
    return !result.completed || !!result.missedCompletionRole;
  })) return null;
  return { key, meeting: confirmed.category === "Special Meeting" ? specialTitle : confirmed.category, total: tasks.length };
}
