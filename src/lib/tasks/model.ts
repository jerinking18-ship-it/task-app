import type { Coverage } from "@/lib/members/absence";
export type Priority = "None" | "Low" | "Medium" | "High";
export const PRIORITIES = ["Low", "Medium", "High"] as const;
export const MEETING_CATEGORIES = ["Sunday Service", "Healing Meeting", "Revival Meeting", "Special Meeting", "Woman's Meeting"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const MAX_BATCH_TASKS = 20;
export const REPEATS = ["Off", "Daily", "Weekly", "Monthly"] as const;
export type Repeat = typeof REPEATS[number];
export type EditScope = "this" | "future";
export function categoryOrder(names: string[]) {
  return [...names].sort((a,b) => {
    const first=MEETING_CATEGORIES.indexOf(a), second=MEETING_CATEGORIES.indexOf(b);
    return (first < 0 ? 99 : first) - (second < 0 ? 99 : second) || a.localeCompare(b);
  });
}
export type Task = {
  coverage?:Coverage|null; assignedToId?: string | null; id: string; title: string; notes: string; completed: boolean; date: string;
  time: string; priority: Priority; category: string; reminder: string;
  notification: boolean; email: boolean; repeat: Repeat;
  seriesId: string | null; historyAt: string | null; availableAt: string | null; repeatAnchor: number | null; seriesVersion:string;
  createdAt: string; updatedAt: string; completedAt:string|null; completedById:string|null; completedByName:string|null; weekdays: number[];
};
export type Category = { id: string; name: string };
export type TaskFields = {
  assigned_to_member_id?: string | null; title: string; notes: string | null; status: "active" | "completed";
  due_date: string | null; due_time: string | null;
  priority: "none" | "low" | "medium" | "high"; category_id: string | null;
  weekdays: number[];
  repeat_rule?: "off" | "daily" | "weekly" | "monthly";
};
export type TaskRow = TaskFields & {
  coverage?: {absence_id:string;member_id:string;member_name:string;expires_at:string}|null;
  id: string; created_at: string; updated_at: string; completed_at: string | null;
  completed_by_member_id?: string | null; completed_by_name?: string | null;
  series_id?: string | null; history_at?: string | null; available_at?: string | null; repeat_anchor_day?: number | null; series_version?:string;
};
export type Dataset = { tasks: TaskRow[]; categories: Category[]; timezone: "Asia/Kolkata" | null };
export type TaskAction =
  | { action: "setup"; timezone: "Asia/Kolkata" }
  | { action: "bootstrap" }
  | { action: "category"; name: string }
  | { action: "create"; fields: TaskFields }
  | { action: "create_many"; fields: TaskFields[] }
  | { action: "delete"; id: string; version: string }
  | { action: "update"; id: string; version: string; fields: TaskFields; scope?: EditScope; seriesVersion?:string }
  | { action:"take";id:string;version:string;absenceId:string;confirmed:true }
  | { action: "status"; id: string; version: string; status: "active" | "completed" };

export function blankTask(): Task {
  return { assignedToId:null, id: "", title: "", notes: "", completed: false, date: "", time: "", priority: "Medium",
    category: "", reminder: "Off", notification: false, email: false, repeat: "Off", seriesId:null,historyAt:null,availableAt:null,repeatAnchor:null,seriesVersion:"",createdAt: "", updatedAt: "",completedAt:null,completedById:null,completedByName:null, weekdays: [] };
}
export function categoryWeekdays(category: string): number[] {
  const day: Record<string, number> = {"Sunday Service":0,"Healing Meeting":3,"Revival Meeting":5,"Woman's Meeting":4};
  return Object.prototype.hasOwnProperty.call(day,category) ? [day[category]] : [];
}
export function newTaskDraft(category = ""): Task {
  return {...blankTask(),category,time:"23:50",repeat:"Weekly",weekdays:categoryWeekdays(category)};
}
export function mapTask(row: TaskRow, categories: Category[]): Task {
  const category = row.category_id ? categories.find(c => c.id === row.category_id) : null;
  if (row.category_id && !category) throw new Error("Category data is incomplete. Refresh your tasks.");
  return { ...blankTask(), coverage:row.coverage?{absenceId:row.coverage.absence_id,memberId:row.coverage.member_id,memberName:row.coverage.member_name,expiresAt:row.coverage.expires_at}:null, assignedToId:row.assigned_to_member_id ?? null, id: row.id, title: row.title, notes: row.notes ?? "", completed: row.status === "completed",
    date: row.due_date ?? "", time: row.due_time?.slice(0, 5) ?? "",
    priority: (row.priority[0].toUpperCase() + row.priority.slice(1)) as Priority,
    category: category?.name ?? "", createdAt: row.created_at, updatedAt: row.updated_at,completedAt:row.completed_at,
    completedById:row.completed_by_member_id ?? null,completedByName:row.completed_by_name ?? null, weekdays: [...row.weekdays],
    repeat: REPEATS.find(rule=>rule.toLowerCase()===(row.repeat_rule ?? "off")) ?? "Off",
    seriesId:row.series_id ?? null,historyAt:row.history_at ?? null,availableAt:row.available_at ?? null,repeatAnchor:row.repeat_anchor_day ?? null,seriesVersion:row.series_version ?? row.updated_at };
}
export function taskFields(task: Task, categories: Category[]): TaskFields {
  const category = task.category ? categories.find(c => c.name === task.category) : null;
  if (task.category && !category) throw new Error("That category is unavailable. Refresh and choose again.");
  return { assigned_to_member_id:task.assignedToId ?? null, title: task.title.trim(), notes: task.notes || null, status: task.completed ? "completed" : "active",
    due_date: task.date || null, due_time: task.time || null,
    priority: task.priority.toLowerCase() as TaskFields["priority"], category_id: category?.id ?? null, weekdays: [...task.weekdays].sort((a,b)=>a-b),repeat_rule:task.repeat.toLowerCase() as TaskFields["repeat_rule"] };
}
export function repeatError(task: Pick<Task,"repeat"|"date"|"weekdays">): string {
  if(task.repeat==="Off") return "";
  if(!task.date) return "Choose a starting due date for this repeating task.";
  if(task.repeat==="Weekly" && !task.weekdays.length) return "Select at least one weekday for Weekly repeat.";
  if(task.repeat==="Weekly" && !task.weekdays.includes(new Date(`${task.date}T12:00:00Z`).getUTCDay()))
    return "The starting due date must match one of your selected weekdays.";
  return "";
}
export function inHistory(task: Task, now: Date): boolean {
  return task.completed && !!task.historyAt && Date.parse(task.historyAt)<=now.getTime();
}
export function isAvailable(task: Task, now: Date): boolean {
  return !task.availableAt || Date.parse(task.availableAt)<=now.getTime();
}
export function newestFirst(tasks: Task[]): Task[] {
  return [...tasks].sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
export function accountClock(now: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}:${part("second")}` };
}
export function isOverdue(task: Task, date: string, time = "00:00:00") {
  return !task.completed && !!task.date && (task.date < date ||
    (task.date === date && !!task.time && `${task.time}:00` < time));
}
export function completionAge(completedAt: string | null, now: Date): string | null {
  if(!completedAt) return null;
  const completed=new Date(completedAt);
  if(!Number.isFinite(completed.getTime()) || !Number.isFinite(now.getTime())) return null;
  const completedDate=accountClock(completed,"Asia/Kolkata").date;
  const currentDate=accountClock(now,"Asia/Kolkata").date;
  const days=(Date.parse(`${currentDate}T00:00:00Z`)-Date.parse(`${completedDate}T00:00:00Z`))/86400000;
  if(days<0) return null;
  return days===0 ? "Today" : days===1 ? "Yesterday" : `${days} days ago`;
}
export type Filters = { view: string; status: string; priority: string; category: string; search: string };
export function matchesTask(task: Task, filters: Filters, date: string, time = "00:00:00", now = new Date()) {
  const query = filters.search.trim().toLowerCase();
  return isAvailable(task,now) && (filters.view === "History" ? inHistory(task,now) : !inHistory(task,now))
    && (!query || [task.title, task.notes, task.category].some(field => field.toLowerCase().includes(query)))
    && (filters.view !== "Today" || task.date === date)
    && (filters.view !== "Overdue" || isOverdue(task, date, time))
    && (filters.view !== "Completed" || task.completed)
    && (filters.status === "Overdue" ? isOverdue(task,date,time)
      : filters.status === "All" || (filters.status === "Completed" ? task.completed : !task.completed))
    && (filters.priority === "Any" || task.priority === filters.priority)
    && (filters.category === "Any" || task.category === filters.category);
}
