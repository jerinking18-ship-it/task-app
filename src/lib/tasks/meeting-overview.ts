import { accountClock, isOverdue, sortTasksForStatus, type Task } from "./model";
import { isCategoryTaskVisible, meetingResetAt, regularMeetingWindow, specialMeetingIsOpen } from "./meeting-period";
import { taskCoverage } from "@/lib/members/absence";

export type OverviewFilter = "All" | "Completed" | "Remaining" | "Needs help";

// Exact two-day India meeting windows; Tuesday has no regular meeting.
export function automaticOverviewCategory(now: Date): string {
  return regularMeetingWindow(now).category;
}

// Use exactly the category visibility rules, rather than a second reset timer
// or a stored count that can drift from the tasks it describes.
export function meetingOverview(tasks: Task[], category: string, now: Date, coverageNow = now) {
  const clock = accountClock(now, "Asia/Kolkata");
  const visible = tasks.filter(task => task.category === category
    && isCategoryTaskVisible(task, now, clock.date, clock.time)
    && (category !== "Special Meeting" || specialMeetingIsOpen(task, now)));
  const completed = visible.filter(task => task.completed);
  const remaining = sortTasksForStatus(visible.filter(task => !task.completed), "All");
  const needsHelp = remaining.filter(task => !!taskCoverage(task, coverageNow));
  return { tasks: visible, completed, remaining, needsHelp,
    percentage: visible.length ? Math.round(completed.length / visible.length * 100) : 0,
    overdue: remaining.filter(task => isOverdue(task, clock.date, clock.time)) };
}

export function overviewTasks(tasks: Task[], category: string, filter: OverviewFilter, now: Date, coverageNow = now) {
  const summary = meetingOverview(tasks, category, now, coverageNow);
  const rows = filter === "Completed" ? summary.completed : filter === "Remaining" ? summary.remaining
    : filter === "Needs help" ? summary.needsHelp : summary.tasks;
  return sortTasksForStatus(rows, filter === "Completed" ? "Completed" : "All");
}

export function overviewDeadline(category: string, now: Date) {
  if (category === "Special Meeting") return null;
  const resetAt = meetingResetAt(category, now.getTime());
  if (resetAt === null) return null;
  const resetDay = accountClock(new Date(resetAt - 1), "Asia/Kolkata").date;
  const meetingDate = new Date(`${resetDay}T12:00:00Z`);
  meetingDate.setUTCDate(meetingDate.getUTCDate() - 1);
  return { resetAt, meetingDate: meetingDate.toISOString().slice(0, 10) };
}
