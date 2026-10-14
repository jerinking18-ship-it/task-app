import type {Absence} from "./absence";
import { isRecord, timestamp, uuid, date } from "@/lib/tasks/validation";

export const MEMBER_LIMIT = 10;
export type MemberRole = "owner" | "coordinator" | "member";
export type Workspace = {id:string;ownerId:string;name:string;reservedSeats:number};
export type Invitation = {id:string;email:string;role:"member"|"coordinator";expiresAt:string};
export type Member = { role?:MemberRole; id: string; name: string; createdAt: string; lastSeenAt: string; activeUntil?: string | null };
export type MemberState = { absences?:Absence[]; current: Member | null; members: Member[]; serverNow?: string; workspace?:Workspace|null; invitations?:Invitation[] };
export type MemberAction = { action: "rename"; name: string; previousName: string } | { action: "leave"; confirmed: true };

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
  return null;
}
function decodeMember(value: unknown, format: "database" | "api"): Member {
  if (!isRecord(value)) throw new Error("Incomplete member response.");
  const createdAt = format === "database" ? value.created_at : value.createdAt;
  const lastSeenAt = format === "database" ? value.last_seen_at : value.lastSeenAt;
  const activeUntil = (format === "database" ? value.active_until : value.activeUntil) ?? null;
  if (!uuid(value.id) || memberName(value.name) !== value.name
    || !timestamp(createdAt) || !timestamp(lastSeenAt) || (activeUntil!==null&&!timestamp(activeUntil))) throw new Error("Incomplete member response.");
  if(value.role!==undefined && !["owner","coordinator","member"].includes(value.role as string))throw new Error("Incomplete member role.");
  return { ...(value.role===undefined?{}:{role:value.role as MemberRole}), id: value.id, name: value.name as string, createdAt, lastSeenAt, activeUntil };
}
function decodeState(value: unknown, format: "database" | "api"): MemberState {
  if (!isRecord(value) || !Array.isArray(value.members) || value.members.length > MEMBER_LIMIT) throw new Error("Incomplete members response.");
  const members = value.members.map(member => decodeMember(member, format));
  if (new Set(members.map(member => member.id)).size !== members.length) throw new Error("Incomplete members response.");
  const current = value.current === null ? null : decodeMember(value.current, format);
  if (current && !members.some(member => member.id === current.id && member.name === current.name && member.role === current.role)) throw new Error("Incomplete members response.");
  const serverNow = format === "database" ? value.server_now : value.serverNow;
  if(serverNow!==undefined&&!timestamp(serverNow))throw new Error("Incomplete member response.");
  let workspace:Workspace|null|undefined;
  if(value.workspace!==undefined && value.workspace!==null){
    const w=value.workspace;const ownerId=isRecord(w)?(format==="database"?w.owner_id:w.ownerId):null;
    const reservedSeats=isRecord(w)?(format==="database"?w.reserved_seats:w.reservedSeats):null;
    if(!isRecord(w)||!uuid(w.id)||!uuid(ownerId)||typeof w.name!=="string"||!w.name.trim()||!Number.isInteger(reservedSeats)||Number(reservedSeats)<0||Number(reservedSeats)+members.length>MEMBER_LIMIT)throw new Error("Incomplete workspace response.");
    if(!current || members.some(member=>!member.role))throw new Error("Incomplete verified workspace membership.");
    workspace={id:w.id,ownerId,name:w.name,reservedSeats:Number(reservedSeats)};
  }else workspace=value.workspace===null?null:undefined;
  const invitations:Invitation[]=[];
  if(value.invitations!==undefined){
    if(!Array.isArray(value.invitations)||value.invitations.length>MEMBER_LIMIT)throw new Error("Incomplete invitations response.");
    for(const i of value.invitations){const expiresAt=isRecord(i)?(format==="database"?i.expires_at:i.expiresAt):null;
      if(!isRecord(i)||!uuid(i.id)||typeof i.email!=="string"||!["member","coordinator"].includes(i.role as string)||!timestamp(expiresAt))throw new Error("Incomplete invitation response.");
      invitations.push({id:i.id,email:i.email,role:i.role as Invitation["role"],expiresAt});}
  }
  const absences:Absence[]=[];
  if(value.absences!==undefined){
    if(!Array.isArray(value.absences)||value.absences.length>50)throw new Error("Incomplete absence response.");
    for(const a of value.absences){
      if(!isRecord(a))throw new Error("Incomplete absence response.");
      const memberId=format==="database"?a.member_id:a.memberId,categoryId=format==="database"?a.category_id:a.categoryId;
      const createdAt=format==="database"?a.created_at:a.createdAt,expiresAt=format==="database"?a.expires_at:a.expiresAt;
      const meetingDate=(format==="database"?a.meeting_date:a.meetingDate)??null;
      if(!uuid(a.id)||!uuid(memberId)||!members.some(m=>m.id===memberId)||!uuid(categoryId)||typeof a.category!=="string"
        ||!["Sunday Service","Healing Meeting","Revival Meeting","Special Meeting","Woman's Meeting"].includes(a.category)
        ||!timestamp(createdAt)||!timestamp(expiresAt)||Date.parse(expiresAt)<=Date.parse(createdAt)
        ||(a.category==="Special Meeting"?!date(meetingDate):meetingDate!==null))throw new Error("Incomplete absence response.");
      absences.push({id:a.id,memberId,categoryId,category:a.category,createdAt,expiresAt,meetingDate:meetingDate as string|null});
    }
    if(new Set(absences.map(a=>a.memberId+":"+a.categoryId)).size!==absences.length)throw new Error("Duplicate active absence response.");
  }
  return { ...(value.absences===undefined?{}:{absences}), ...(workspace===undefined?{}:{workspace}),...(value.invitations===undefined?{}:{invitations}), current, members, ...(serverNow===undefined?{}:{serverNow}) };
}
export function memberActive(member:Member,now=new Date()):boolean {
  return !!member.activeUntil && Date.parse(member.activeUntil)>now.getTime();
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

export function canManageTasks(state:MemberState|null):boolean {
 return !!state?.workspace && (state.current?.role==="owner" || state.current?.role==="coordinator");
}
export function canChangeTaskStatus(state:MemberState|null,assignedToId?:string|null):boolean {
 return !!state?.workspace && !!assignedToId && state.current?.id===assignedToId;
}
export function roleLabel(role?:MemberRole):string {return role==="owner"?"Owner":role==="coordinator"?"Coordinator":"Member";}
