import { MEETING_CATEGORIES, type Category, type TaskRow } from "./model";
import { decodeRow } from "./validation";

export function meetingCategoriesReady(categories: Category[]) {
  return MEETING_CATEGORIES.every(name => categories.some(category => category.name === name));
}

/** Accept committed status fields immediately. Presentation metadata belongs to
 * the unchanged assignment/plan; the background dataset read reconciles it.
 * No status, timestamp, completer or permission is inferred on the client.
 */
export function confirmedStatusRow(previous: TaskRow | undefined, value: unknown, id: string, status: "active" | "completed"): TaskRow {
  const row = decodeRow(value);
  if (row.id !== id || row.status !== status) throw new Error("Task status could not be confirmed. Refresh before trying again.");
  if (!previous || previous.id !== row.id) return row;
  const samePlan = !!row.special_plan_id && row.special_plan_id === previous.special_plan_id;
  return decodeRow({
    ...row,
    claim_origin: row.claim_origin === undefined && row.assigned_to_member_id === previous.assigned_to_member_id ? previous.claim_origin : row.claim_origin,
    special_meeting: row.special_meeting === undefined && samePlan ? previous.special_meeting : row.special_meeting,
    special_plan_version: samePlan ? row.special_plan_version ?? row.series_version ?? previous.special_plan_version : row.special_plan_version,
  });
}
