import { accountClock, inHistory, isAvailable, isOverdue, matchesTask, type Filters, type Task } from "./model";

export const RESET_WEEKDAYS: Record<string, number> = {"Sunday Service":1,"Healing Meeting":4,"Revival Meeting":6};
export const RESET_LABELS: Record<string, string> = {"Sunday Service":"Monday","Healing Meeting":"Thursday","Revival Meeting":"Saturday"};

function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
const cutoff = (day: string) => Date.parse(`${day}T23:50:00+05:30`);

// Same deadlines as task_app_history_expires, anchored to the occurrence rather
// than the current week. An expired item must not return on the following week.
export function meetingResetAt(category: string, anchor: number, scheduledDate = "", weekdays: number[] = [], includeAnchor = false): number | null {
  if (!Number.isFinite(anchor)) return null;
  const eligible = (ends: number) => ends > anchor || (includeAnchor && ends === anchor);
  const day = accountClock(new Date(anchor), "Asia/Kolkata").date;
  if (category === "Special Meeting") {
    if (scheduledDate) {
      const scheduled = cutoff(shiftDay(scheduledDate, 1));
      if (eligible(scheduled)) return scheduled;
    }
    if (weekdays.length) {
      for (let offset = -1; offset <= 7; offset++) {
        const meetingDay = shiftDay(day, offset);
        const ends = cutoff(shiftDay(meetingDay, 1));
        if (weekdays.includes(new Date(`${meetingDay}T12:00:00Z`).getUTCDay()) && eligible(ends)) return ends;
      }
    }
    return cutoff(shiftDay(day, 1));
  }
  if (!Object.prototype.hasOwnProperty.call(RESET_WEEKDAYS, category)) return null;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const distance = (RESET_WEEKDAYS[category] - weekday + 7) % 7;
  const next = shiftDay(day, distance);
  const ends = cutoff(next);
  return eligible(ends) ? ends : cutoff(shiftDay(next, 7));
}

export function isCategoryTaskVisible(task: Task, now: Date, date: string, time: string): boolean {
  if (!isAvailable(task, now) || inHistory(task, now)) return false;
  let anchor: number;
  let includeAnchor = false;
  if (task.completed) {
    // Incomplete legacy metadata must never hide a task by guessing its age.
    if (!task.completedAt) return true;
    anchor = Date.parse(task.completedAt);
  } else if (isOverdue(task, date, time) || (task.date === date && !!task.time && `${task.time}:00` === time)) {
    // A date-only task first becomes overdue at the following midnight.
    const dueAt = task.time ? Date.parse(`${task.date}T${task.time}:00+05:30`)
      : Date.parse(`${shiftDay(task.date, 1)}T00:00:00+05:30`);
    // A task entered late gets the next reset, just like a late completion.
    const created = Date.parse(task.createdAt);
    anchor = Number.isFinite(created) ? Math.max(dueAt, created) : dueAt;
    // If due and reset coincide, the occurrence expires at that reset rather
    // than waiting another week. Main-page overdue semantics remain unchanged.
    includeAnchor = anchor === dueAt;
  } else return true;
  const ends = meetingResetAt(task.category, anchor, task.date, task.weekdays, includeAnchor);
  return ends === null || now.getTime() < ends;
}

export function matchesCategoryTask(task: Task, filters: Filters, date: string, time: string, now: Date): boolean {
  return matchesTask(task, filters, date, time, now)
    && (filters.view !== "All tasks" || filters.category === "Any" || isCategoryTaskVisible(task, now, date, time));
}
