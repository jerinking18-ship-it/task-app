import { date, isRecord, timestamp, uuid } from "@/lib/tasks/validation";
import type { SundayService } from "@/lib/tasks/model";

export type CheckInContext = { categoryId: string; category: string; meetingDate: string; service: SundayService | null; meetingId: string | null; opensAt: string; closesAt: string; visibleUntil: string };
export type AttendancePresence = { key: string; memberId: string };
export type CheckInData = { serverNow: string; currentId: string; contexts: CheckInContext[]; presence: AttendancePresence[]; own: string[]; entries?: { key: string; memberId: string; checkedAt: string }[] };
export type CheckInAction = { categoryId: string; meetingDate: string; service: SundayService | null; meetingId: string | null; confirmed: true };
const categories = ["Sunday Service", "Healing Meeting", "Revival Meeting", "Special Meeting"];
export function contextKey(c: Pick<CheckInContext, "categoryId" | "meetingDate" | "service" | "meetingId">) { return [c.categoryId, c.meetingDate, c.service ?? "", c.meetingId ?? ""].join(":"); }
export function checkInOpen(c: CheckInContext, now: Date) { return Date.parse(c.opensAt) <= now.getTime() && now.getTime() < Date.parse(c.closesAt); }
export function checkInLanding(data: CheckInData, now = new Date(data.serverNow)): "Check in" | "Assigned to me" {
  return data.contexts.some(c => checkInOpen(c, now) && !data.own.includes(contextKey(c))) ? "Check in" : "Assigned to me";
}
export function checkInAction(v: unknown): CheckInAction | null {
  if (!isRecord(v) || Object.keys(v).length !== 5 || !Object.keys(v).every(k => ["categoryId", "meetingDate", "service", "meetingId", "confirmed"].includes(k))
    || !uuid(v.categoryId) || !date(v.meetingDate) || (v.service !== null && v.service !== "morning" && v.service !== "evening") || (v.meetingId !== null && !uuid(v.meetingId)) || v.confirmed !== true) return null;
  return v as CheckInAction;
}
export function decodeCheckIn(value: unknown, details = false): CheckInData {
  const fail = () => { throw Error("Incomplete check-in response. Refresh before trying again."); };
  if (!isRecord(value) || !timestamp(value.serverNow) || !uuid(value.currentId) || !Array.isArray(value.contexts) || value.contexts.length > 2 || !Array.isArray(value.presence) || value.presence.length > 20 || !Array.isArray(value.own) || value.own.length > 2) return fail();
  const contexts: CheckInContext[] = value.contexts.map(c => {
    if (!isRecord(c) || !uuid(c.categoryId) || !categories.includes(String(c.category)) || !date(c.meetingDate)
      || (c.category === "Sunday Service" ? !["morning", "evening"].includes(String(c.service)) || c.meetingId !== null : c.service !== null)
      || (c.category === "Special Meeting" ? !uuid(c.meetingId) : c.meetingId !== null)
      || !timestamp(c.opensAt) || !timestamp(c.closesAt) || !timestamp(c.visibleUntil) || Date.parse(c.opensAt) >= Date.parse(c.closesAt) || Date.parse(c.closesAt) > Date.parse(c.visibleUntil)) return fail();
    return c as CheckInContext;
  });
  const keys = new Set(contexts.map(contextKey));
  if (keys.size !== contexts.length) return fail();
  const presence = value.presence.map(p => { if (!isRecord(p) || Object.keys(p).length !== 2 || !keys.has(String(p.key)) || !uuid(p.memberId)) return fail(); return { key: String(p.key), memberId: p.memberId }; });
  if (new Set(presence.map(p => p.key + p.memberId)).size !== presence.length || !value.own.every(k => typeof k === "string" && keys.has(k)) || new Set(value.own).size !== value.own.length
    || !value.own.every(k => presence.some(p => p.key === k && p.memberId === value.currentId))) return fail();
  let entries: CheckInData["entries"];
  if (details) {
    if (!Array.isArray(value.entries) || value.entries.length !== presence.length) return fail();
    entries = value.entries.map(e => { if (!isRecord(e) || Object.keys(e).length !== 3 || !timestamp(e.checkedAt) || !presence.some(p => p.key === e.key && p.memberId === e.memberId)) return fail(); return { key: String(e.key), memberId: String(e.memberId), checkedAt: e.checkedAt }; });
    if (new Set(entries.map(e => e.key + e.memberId)).size !== entries.length) return fail();
  } else if (value.entries !== undefined) return fail();
  return { serverNow: value.serverNow, currentId: value.currentId, contexts, presence, own: value.own as string[], ...(entries ? { entries } : {}) };
}
