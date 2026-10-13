import { isRecord, timestamp, uuid } from "@/lib/tasks/validation";

export const MEMBER_LIMIT = 10;
export type Member = { id: string; name: string; createdAt: string; lastSeenAt: string };
export type MemberState = { current: Member | null; members: Member[] };
export type MemberChoice = { action: "create"; name: string } | { action: "select"; id: string };
export type MemberAction = MemberChoice | { action: "rename"; name: string; previousName: string } | { action: "leave"; confirmed: true };

export function memberName(value: unknown): string | null {
  if (typeof value !== "string" || /[\p{Cc}\p{Cf}]/u.test(value)) return null;
  const name = value.trim().replace(/\s+/gu, " ");
  return name.length > 0 && name.length <= 50 ? name : null;
}
export function memberAction(value: unknown): MemberAction | null {
  if (!isRecord(value)) return null;
  if (value.action === "leave" && value.confirmed === true && Object.keys(value).every(key => ["action", "confirmed"].includes(key))) return { action: "leave", confirmed: true };
  if (value.action === "rename" && Object.keys(value).every(key => ["action", "name", "previousName"].includes(key))) {
    const name = memberName(value.name); const previousName = memberName(value.previousName);
    return name && previousName ? { action: "rename", name, previousName } : null;
  }
  if (value.action === "create" && Object.keys(value).every(key => ["action", "name"].includes(key))) {
    const name = memberName(value.name);
    return name ? { action: "create", name } : null;
  }
  return value.action === "select" && uuid(value.id) && Object.keys(value).every(key => ["action", "id"].includes(key))
    ? { action: "select", id: value.id } : null;
}
function decodeMember(value: unknown, format: "database" | "api"): Member {
  if (!isRecord(value)) throw new Error("Incomplete member response.");
  const createdAt = format === "database" ? value.created_at : value.createdAt;
  const lastSeenAt = format === "database" ? value.last_seen_at : value.lastSeenAt;
  if (!uuid(value.id) || memberName(value.name) !== value.name
    || !timestamp(createdAt) || !timestamp(lastSeenAt)) throw new Error("Incomplete member response.");
  return { id: value.id, name: value.name as string, createdAt, lastSeenAt };
}
function decodeState(value: unknown, format: "database" | "api"): MemberState {
  if (!isRecord(value) || !Array.isArray(value.members) || value.members.length > MEMBER_LIMIT) throw new Error("Incomplete members response.");
  const members = value.members.map(member => decodeMember(member, format));
  if (new Set(members.map(member => member.id)).size !== members.length) throw new Error("Incomplete members response.");
  const current = value.current === null ? null : decodeMember(value.current, format);
  if (current && !members.some(member => member.id === current.id && member.name === current.name)) throw new Error("Incomplete members response.");
  return { current, members };
}
// Supabase RPCs return database column names; our API returns the normalized model.
export function decodeMembers(value: unknown): MemberState {
  return decodeState(value, "database");
}
export function decodeMemberResponse(value: unknown): MemberState {
  return decodeState(value, "api");
}
export function memberSeen(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Last seen unavailable";
  const options = { timeZone: "Asia/Kolkata" };
  const day = (input: Date) => new Intl.DateTimeFormat("en-CA", { ...options, year: "numeric", month: "2-digit", day: "2-digit" }).format(input);
  const days = (Date.parse(day(now)) - Date.parse(day(date))) / 86400000;
  const label = days === 0 ? "today" : days === 1 ? "yesterday" : new Intl.DateTimeFormat("en-US", { ...options, month: "short", day: "numeric", year: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat("en-US", { ...options, hour: "numeric", minute: "2-digit", hour12: true }).format(date);
  return `Last seen ${label}, ${time}`;
}
