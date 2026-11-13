import { accountClock, MEETING_CATEGORIES, type Task } from "./model";
import { regularMeetingWindow, specialMeetingIsOpen } from "./meeting-period";

const weekdays: Record<string, number> = { "Sunday Service": 0, "Healing Meeting": 3, "Revival Meeting": 5 };

function sundayMorningCompletionEnd(task: Task, now: Date): number | null {
  if (task.category !== "Sunday Service" || task.sundayService !== "morning") return null;
  if (!task.date) {
    const window = regularMeetingWindow(now);
    return window.category === "Sunday Service" ? window.startsAt + 18 * 60 * 60 * 1000 : null;
  }
  const day = new Date(`${task.date}T12:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.getUTCDay() > 1) return null;
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return Date.parse(`${accountClock(day, "UTC").date}T18:00:00+05:30`);
}

export function meetingCompletionLockLabel(task: Task, now: Date): string {
  const end = sundayMorningCompletionEnd(task, now);
  return end !== null && now.getTime() >= end
    ? "Morning Service completion closed at 6:00 PM on Sunday, India time."
    : "Locked until this task’s meeting starts";
}

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
  if (task.category === "Sunday Service" && task.sundayService === "morning") {
    const end = sundayMorningCompletionEnd(task, now);
    return end === null || now.getTime() < end - 18 * 60 * 60 * 1000 || now.getTime() >= end;
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
