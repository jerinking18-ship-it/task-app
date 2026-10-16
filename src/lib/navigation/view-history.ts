export const APP_VIEWS = ["Activity", "Notifications", "Attendance", "Needs help", "Meeting overview", "Fines", "All tasks", "Today", "Overdue", "Completed", "Member history", "Users", "Assigned to me", "My profile", "Bin"] as const;
export type AppView = typeof APP_VIEWS[number];
export type ViewSnapshot = { view: AppView; category: string; status: string; priority: string };
type Entry = { owner: string; index: number; path: string; snapshot: ViewSnapshot };
const KEY = "bgmViewHistory";
type Port = Pick<Window, "history" | "location" | "addEventListener" | "removeEventListener">;
type Callbacks = { restore: (snapshot: ViewSnapshot) => void; blocked: () => boolean; attempt: (proceed: () => void) => void };

function readEntry(state: unknown, path: string): Entry | null {
  if (!state || typeof state !== "object") return null;
  const entry = (state as Record<string, unknown>)[KEY] as Entry | undefined;
  if (!entry || typeof entry.owner !== "string" || !entry.owner || entry.path !== path || !Number.isSafeInteger(entry.index) || entry.index < 0) return null;
  const snapshot = entry.snapshot;
  if (!snapshot || !APP_VIEWS.includes(snapshot.view) || typeof snapshot.category !== "string" || !snapshot.category || snapshot.category.length > 120
    || !["Active", "Completed", "Overdue", "All"].includes(snapshot.status) || !["Any", "Low", "Medium", "High"].includes(snapshot.priority)) return null;
  return entry;
}

/** Navigation metadata only: never task rows, account details or credentials.
 * The launch entry is replaced, not duplicated, so Back can still exit at root.
 */
export function createViewHistory(port: Port, initial: ViewSnapshot, callbacks: Callbacks, owner: string) {
  const path = port.location.pathname;
  const existing = readEntry(port.history.state, path);
  let current: Entry = existing ?? { owner, index: 0, path, snapshot: initial };
  let alive = true;
  let rollback: Entry | null = null;
  let accepted: number | null = null;
  const write = (entry: Entry, push: boolean) => {
    const state = { ...port.history.state, [KEY]: entry };
    if (push) port.history.pushState(state, "", port.location.href);
    else port.history.replaceState(state, "", port.location.href);
  };
  write(current, false);
  if (existing) callbacks.restore(existing.snapshot);

  const pop = (event: PopStateEvent) => {
    const target = readEntry(event.state, path);
    if (!alive || !target || target.owner !== current.owner) return;
    if (rollback) {
      if (target.index !== current.index) { port.history.go(current.index - target.index); return; }
      const destination = rollback;
      rollback = null;
      let used = false;
      callbacks.attempt(() => {
        if (!alive || used) return;
        used = true;
        accepted = destination.index;
        port.history.go(destination.index - current.index);
      });
      return;
    }
    const permitted = accepted === target.index;
    accepted = null;
    if (target.index !== current.index && !permitted && callbacks.blocked()) {
      // popstate happens after traversal. Restore the old position before
      // presenting the existing unsaved-changes dialog or closing a modal.
      rollback = target;
      port.history.go(current.index - target.index);
      return;
    }
    current = target;
    callbacks.restore(target.snapshot);
  };
  port.addEventListener("popstate", pop as EventListener);
  return {
    record(snapshot: ViewSnapshot) {
      if (!alive || rollback) return;
      const push = current.snapshot.view !== snapshot.view || current.snapshot.category !== snapshot.category;
      current = { ...current, index: current.index + (push ? 1 : 0), snapshot };
      write(current, push);
    },
    dispose() { alive = false; port.removeEventListener("popstate", pop as EventListener); },
  };
}
