import { accountClock, inHistory, isAvailable, isOverdue, matchesTask, type Filters, type Task } from "./model";

export const RESET_WEEKDAYS: Record<string, number> = {"Sunday Service":1,"Healing Meeting":4,"Revival Meeting":6};
export const RESET_LABELS: Record<string, string> = {"Sunday Service":"Monday","Healing Meeting":"Thursday","Revival Meeting":"Saturday"};

function shiftDay(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
// Exclusive midnight includes every second of the advertised 11:59 PM minute.
const cutoff = (day: string) => Date.parse(`${shiftDay(day, 1)}T00:00:00+05:30`);
export function regularMeetingWindow(now: Date) {
  const day = accountClock(now, "Asia/Kolkata").date;
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  const category = ["Sunday Service", "Sunday Service", "", "Healing Meeting", "Healing Meeting", "Revival Meeting", "Revival Meeting"][weekday];
  const start = shiftDay(day, [0,-1,0,0,-1,0,-1][weekday]);
  const nextDay = weekday === 2 ? shiftDay(day, 1) : shiftDay(start, category === "Sunday Service" ? 3 : 2);
  const nextCategory = weekday === 2 || category === "Sunday Service" ? "Healing Meeting" : category === "Healing Meeting" ? "Revival Meeting" : "Sunday Service";
  return { category, startsAt: Date.parse(`${start}T00:00:00+05:30`),
    endsAt: Date.parse(`${shiftDay(start, category ? 2 : 1)}T00:00:00+05:30`), nextCategory, nextDay };
}
export function specialMeetingIsOpen(task: Task, now: Date): boolean {
  if(task.specialMeeting){const e=task.specialMeeting;const today=accountClock(now,"Asia/Kolkata").date;return !e.locked&&!!task.specialEnabled&&now.getTime()>=Date.parse(e.startsAt)&&now.getTime()<Date.parse(e.endsAt)&&task.date===(e.days===null?e.startDate:today);}

  const day = accountClock(now, "Asia/Kolkata").date;
  if (task.date) return now.getTime() >= Date.parse(`${task.date}T00:00:00+05:30`)
    && now.getTime() < Date.parse(`${shiftDay(task.date, 2)}T00:00:00+05:30`);
  if (task.weekdays.length) return [day,shiftDay(day,-1)].some(value => task.weekdays.includes(new Date(`${value}T12:00:00Z`).getUTCDay()));
  // Legacy undated tasks use their creation day; never invent an endless meeting.
  const created = Date.parse(task.createdAt);
  if (!Number.isFinite(created)) return false;
  const createdDay = accountClock(new Date(created), "Asia/Kolkata").date;
  return now.getTime() >= created && now.getTime() < Date.parse(`${shiftDay(createdDay,2)}T00:00:00+05:30`);
}


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
  if(task.specialMeeting){const e=task.specialMeeting;const today=accountClock(now,"Asia/Kolkata").date;return now.getTime()<Date.parse(e.endsAt)&&(task.date||e.startDate)===(e.days===null||today<e.startDate?e.startDate:today);}

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

// Category pages/counts open only in their own meeting window. Keep this gate
// separate from occurrence expiry: other saved views still retain active work.
export function isCategoryWindowTaskVisible(task: Task, now: Date, date: string, time: string): boolean {
  if (Object.prototype.hasOwnProperty.call(RESET_WEEKDAYS, task.category)
    && regularMeetingWindow(now).category !== task.category) return false;
  if (task.category === "Special Meeting") {
    if (task.specialMeeting) {
      if (task.specialMeeting.locked || !task.specialEnabled || now.getTime() < Date.parse(task.specialMeeting.startsAt)) return false;
    } else if (!specialMeetingIsOpen(task, now)) return false;
  }
  return isCategoryTaskVisible(task, now, date, time);
}

export function matchesCategoryTask(task: Task, filters: Filters, date: string, time: string, now: Date): boolean {
  return matchesTask(task, filters, date, time, now)
    && (filters.view !== "All tasks" || filters.category === "Any" || isCategoryWindowTaskVisible(task, now, date, time));
}
