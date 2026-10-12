export type Priority = "None" | "Low" | "Medium" | "High";
export type Task = {
  id: string; title: string; notes: string; completed: boolean; date: string;
  time: string; priority: Priority; category: string; reminder: string;
  notification: boolean; email: boolean; repeat: string;
  createdAt: string; updatedAt: string;
};
export type Category = { id: string; name: string };
export type TaskFields = {
  title: string; notes: string | null; status: "active" | "completed";
  due_date: string | null; due_time: string | null;
  priority: "none" | "low" | "medium" | "high"; category_id: string | null;
};
export type TaskRow = TaskFields & {
  id: string; created_at: string; updated_at: string; completed_at: string | null;
};
export type Dataset = { tasks: TaskRow[]; categories: Category[]; timezone: "Asia/Kolkata" | null };
export type TaskAction =
  | { action: "setup"; timezone: "Asia/Kolkata" }
  | { action: "bootstrap" }
  | { action: "category"; name: string }
  | { action: "create"; fields: TaskFields }
  | { action: "update"; id: string; version: string; fields: TaskFields }
  | { action: "status"; id: string; version: string; status: "active" | "completed" };

export function blankTask(): Task {
  return { id: "", title: "", notes: "", completed: false, date: "", time: "", priority: "None",
    category: "", reminder: "Off", notification: false, email: false, repeat: "Off", createdAt: "", updatedAt: "" };
}
export function mapTask(row: TaskRow, categories: Category[]): Task {
  const category = row.category_id ? categories.find(c => c.id === row.category_id) : null;
  if (row.category_id && !category) throw new Error("Category data is incomplete. Refresh your tasks.");
  return { ...blankTask(), id: row.id, title: row.title, notes: row.notes ?? "", completed: row.status === "completed",
    date: row.due_date ?? "", time: row.due_time?.slice(0, 5) ?? "",
    priority: (row.priority[0].toUpperCase() + row.priority.slice(1)) as Priority,
    category: category?.name ?? "", createdAt: row.created_at, updatedAt: row.updated_at };
}
export function taskFields(task: Task, categories: Category[]): TaskFields {
  const category = task.category ? categories.find(c => c.name === task.category) : null;
  if (task.category && !category) throw new Error("That category is unavailable. Refresh and choose again.");
  return { title: task.title.trim(), notes: task.notes || null, status: task.completed ? "completed" : "active",
    due_date: task.date || null, due_time: task.time || null,
    priority: task.priority.toLowerCase() as TaskFields["priority"], category_id: category?.id ?? null };
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
export type Filters = { view: string; status: string; priority: string; category: string; search: string };
export function matchesTask(task: Task, filters: Filters, date: string, time = "00:00:00") {
  const query = filters.search.trim().toLowerCase();
  return (!query || [task.title, task.notes, task.category].some(field => field.toLowerCase().includes(query)))
    && (filters.view !== "Today" || task.date === date)
    && (filters.view !== "Overdue" || isOverdue(task, date, time))
    && (filters.view !== "Completed" || task.completed)
    && (filters.status === "All" || (filters.status === "Completed" ? task.completed : !task.completed))
    && (filters.priority === "Any" || task.priority === filters.priority)
    && (filters.category === "Any" || task.category === filters.category);
}
