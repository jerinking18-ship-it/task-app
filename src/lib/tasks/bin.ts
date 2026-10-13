import { completionAge, mapTask, type Task, type Category, type TaskRow } from "./model";
import { decodeCategory, decodeRow, isRecord, timestamp, uuid } from "./validation";

export const MAX_BIN_SELECTION = 1000;
export type BinTask = Task & { deletedAt: string; deletedByName: string | null };
export type BinItem = { id: string; version: string };
export type BinAction = { action: "restore" | "purge"; items: BinItem[]; confirmed: true };
export type BinRow = TaskRow & { deleted_at: string; deleted_by_name: string | null };
export function validateBinAction(value: unknown): BinAction | null {
  if (!isRecord(value) || !["restore", "purge"].includes(value.action as string) || value.confirmed !== true
    || Object.keys(value).some(key => !["action", "items", "confirmed"].includes(key))
    || !Array.isArray(value.items) || !value.items.length || value.items.length > MAX_BIN_SELECTION) return null;
  const items = value.items;
  if (!items.every(item => isRecord(item) && Object.keys(item).every(key => ["id", "version"].includes(key)) && uuid(item.id) && timestamp(item.version))
    || new Set(items.map(item => item.id)).size !== items.length) return null;
  return { action: value.action as BinAction["action"], items: items as BinItem[], confirmed: true };
}
export function decodeBinRow(value: unknown): BinRow {
  const row = decodeRow(value);
  if (!isRecord(value) || !timestamp(value.deleted_at)
    || !(value.deleted_by_name === null || (typeof value.deleted_by_name === "string" && value.deleted_by_name.trim().length > 0 && value.deleted_by_name.length <= 50))) throw new Error("Incomplete Bin task response.");
  return { ...row, deleted_at: value.deleted_at, deleted_by_name: value.deleted_by_name as string | null };
}
export function decodeBinResponse(value: unknown): { tasks: BinTask[]; categories: Category[] } {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !Array.isArray(value.categories)) throw new Error("Incomplete Bin response. Refresh before trying again.");
  const categories = value.categories.map(decodeCategory);
  const rows = value.tasks.map(decodeBinRow);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Incomplete Bin response.");
  return { categories, tasks: rows.map(row => ({ ...mapTask(row, categories), deletedAt: row.deleted_at, deletedByName: row.deleted_by_name }))
    .sort((a,b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || a.id.localeCompare(b.id)) };
}
export function deletionLabel(value: string, now = new Date()): string {
  const age = completionAge(value, now);
  if (!age) return "Deletion time unavailable";
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
  return `Deleted ${age.toLowerCase()} · ${time}`;
}
