import { isRecord, uuid } from "@/lib/tasks/validation";
export const PRESENCE_HEARTBEAT_MS = 25000;
export const SYNC_FALLBACK_MS = 30000;
export type PresenceInput = { tabId: string; active: boolean; sequence: number };
export function presenceInput(value: unknown): PresenceInput | null {
  if (!isRecord(value) || Object.keys(value).some(key => !["tabId", "active", "sequence"].includes(key))
    || !uuid(value.tabId) || typeof value.active !== "boolean" || !Number.isSafeInteger(value.sequence) || (value.sequence as number)<1) return null;
  return {tabId:value.tabId,active:value.active,sequence:value.sequence as number};
}
