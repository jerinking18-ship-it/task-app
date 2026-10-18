import { accountClock, MEETING_CATEGORIES, type Task } from "./model";
import { regularMeetingWindow, specialMeetingIsOpen } from "./meeting-period";

const weekdays: Record<string, number> = { "Sunday Service": 0, "Healing Meeting": 3, "Revival Meeting": 5 };

/** Server repeats this check at the actual status transition, for every role. */
export function meetingCompletionLocked(task: Task, now: Date): boolean {
  if (task.completed || !MEETING_CATEGORIES.includes(task.category)) return false;
  if (!Number.isFinite(now.getTime())) return true;
  if (task.availableAt && Date.parse(task.availableAt) > now.getTime()) return true;
  if (task.category === "Special Meeting") {
    const event = task.specialMeeting;
    if (!event) return !specialMeetingIsOpen(task, now);
    const day = task.date || event.startDate;
    return event.locked || !task.specialEnabled || now.getTime() < Date.parse(event.startsAt)
      || now.getTime() >= Date.parse(event.endsAt) || now.getTime() < Date.parse(`${day}T00:00:00+05:30`);
  }
  if (!task.date) return regularMeetingWindow(now).category !== task.category;
  const day = new Date(`${task.date}T12:00:00Z`);
  if (!Number.isFinite(day.getTime())) return true;
  const distance = (day.getUTCDay() - weekdays[task.category] + 7) % 7;
  // The following-day date belongs to the same service; do not map arbitrary
  // off-day dates back to an already-open meeting in the preceding week.
  if (distance <= 1) day.setUTCDate(day.getUTCDate() - distance);
  const starts = Date.parse(`${accountClock(day, "UTC").date}T00:00:00+05:30`);
  return now.getTime() < starts;
}
