import { isRecord } from "./validation";

export type CompletedSnapshot = { count: number; snapshot: string };
export type CompletedPurge = CompletedSnapshot & { confirmed: true };
export function decodeCompletedSnapshot(value: unknown): CompletedSnapshot {
  if (!isRecord(value) || !Number.isSafeInteger(value.count) || (value.count as number) < 0
    || typeof value.snapshot !== "string" || !/^[a-f0-9]{32}$/.test(value.snapshot))
    throw new Error("The completed task count could not be confirmed. Close and refresh before trying again.");
  return { count: value.count as number, snapshot: value.snapshot };
}
export function validateCompletedPurge(value: unknown): CompletedPurge | null {
  if (!isRecord(value) || value.confirmed !== true || Object.keys(value).some(key => !["count", "snapshot", "confirmed"].includes(key))) return null;
  try { const snapshot = decodeCompletedSnapshot(value); return snapshot.count > 0 ? { ...snapshot, confirmed: true } : null; }
  catch { return null; }
}
export function decodeCompletedPurge(value: unknown, expected: CompletedSnapshot): number {
  if (!isRecord(value) || value.deleted !== expected.count || value.snapshot !== expected.snapshot)
    throw new Error("Deletion could not be confirmed. Close and refresh before trying again.");
  return expected.count;
}
