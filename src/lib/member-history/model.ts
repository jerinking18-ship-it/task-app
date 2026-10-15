import { accountClock, MEETING_CATEGORIES } from "@/lib/tasks/model";
import { isRecord, timestamp, uuid } from "@/lib/tasks/validation";
import { regularMeetingWindow, RESET_LABELS } from "@/lib/tasks/meeting-period";
export { regularMeetingWindow, RESET_LABELS } from "@/lib/tasks/meeting-period";
export type HistoryMember = { id:string; name:string };
export type HistoryEntry = { id:string; memberId:string; title:string; notes:string; category:string; completedAt:string; expiresAt:string };
export type HistoryTotal = { memberId:string; year:number; count:number };
export type SpecialWindow = { startsAt:string; endsAt:string };
export type MemberHistoryData = { serverNow:string; members:HistoryMember[]; totals:HistoryTotal[]; entries:HistoryEntry[]; specialWindows:SpecialWindow[] };
export function decodeMemberHistory(value:unknown):MemberHistoryData {
  if(!isRecord(value)||!timestamp(value.serverNow)||!Array.isArray(value.members)||value.members.length>10||!Array.isArray(value.totals)||!Array.isArray(value.entries)||!Array.isArray(value.specialWindows))throw Error("Incomplete member history. Refresh to try again.");
  const members=value.members.map(member=>{if(!isRecord(member)||!uuid(member.id)||typeof member.name!=="string"||!member.name.trim()||member.name.length>50)throw Error("Incomplete history member response.");return {id:member.id,name:member.name};});
  const ids=new Set(members.map(member=>member.id));if(ids.size!==members.length)throw Error("Duplicate history members. Refresh again.");
  const totals=value.totals.map(total=>{if(!isRecord(total)||typeof total.memberId!=="string"||!ids.has(total.memberId)||!Number.isInteger(total.year)||Number(total.year)<1||Number(total.year)>9999||!Number.isSafeInteger(total.count)||Number(total.count)<0)throw Error("Incomplete yearly total response.");return {memberId:total.memberId,year:Number(total.year),count:Number(total.count)};});
  if(new Set(totals.map(total=>total.memberId+":"+total.year)).size!==totals.length)throw Error("Duplicate yearly totals. Refresh again.");
  const entries=value.entries.map(entry=>{if(!isRecord(entry)||!uuid(entry.id)||typeof entry.memberId!=="string"||!ids.has(entry.memberId)||typeof entry.title!=="string"||!entry.title.trim()||entry.title.length>200||typeof entry.notes!=="string"||entry.notes.length>4000||typeof entry.category!=="string"||!MEETING_CATEGORIES.includes(entry.category)||!timestamp(entry.completedAt)||!timestamp(entry.expiresAt)||Date.parse(entry.expiresAt)<=Date.parse(entry.completedAt))throw Error("Incomplete completion history response.");return {id:entry.id,memberId:entry.memberId,title:entry.title,notes:entry.notes,category:entry.category,completedAt:entry.completedAt,expiresAt:entry.expiresAt};});
  if(new Set(entries.map(entry=>entry.id)).size!==entries.length)throw Error("Duplicate completion entries. Refresh again.");
  const specialWindows=value.specialWindows.map(window=>{if(!isRecord(window)||!timestamp(window.startsAt)||!timestamp(window.endsAt)||Date.parse(window.endsAt)<=Date.parse(window.startsAt))throw Error("Incomplete Special Meeting schedule.");return {startsAt:window.startsAt,endsAt:window.endsAt};});
  return {serverNow:value.serverNow,members,totals,entries,specialWindows};
}
export function historyYear(now:Date){return Number(accountClock(now,"Asia/Kolkata").date.slice(0,4));}
export function yearlyTotal(data:MemberHistoryData|null,memberId:string,now:Date){return data?.totals.find(total=>total.memberId===memberId&&total.year===historyYear(now))?.count??0;}
export function completionTime(value:string){
  const date=new Date(value),zone={timeZone:"Asia/Kolkata"};
  return new Intl.DateTimeFormat("en-US",{...zone,month:"short",day:"numeric"}).format(date)+" · "+new Intl.DateTimeFormat("en-US",{...zone,hour:"numeric",minute:"2-digit",hour12:true}).format(date)+" · "+new Intl.DateTimeFormat("en-US",{...zone,weekday:"short"}).format(date);
}
export function visibleCompletions(data:MemberHistoryData|null,memberId:string,category:string,now:Date){return (data?.entries??[]).filter(entry=>entry.memberId===memberId&&entry.category===category&&Date.parse(entry.expiresAt)>now.getTime()&&Date.parse(entry.completedAt)<=now.getTime()).sort((a,b)=>b.completedAt.localeCompare(a.completedAt)||a.id.localeCompare(b.id));}
export const CATEGORY_COLORS:Record<string,string>={"Sunday Service":"#b89d63","Healing Meeting":"#58a9a1","Revival Meeting":"#668bcb","Special Meeting":"#9076bd"};
export function regularSchedule(now:Date){
  const window=regularMeetingWindow(now);
  return {category:window.category,resetAt:new Date(window.endsAt).toISOString(),
    label:window.category?"Clears "+RESET_LABELS[window.category]+" · 11:59 PM IST":"No meeting today"};
}
// Special Meeting has its own section; it never replaces the regular period.
export function reportSchedule(data:MemberHistoryData|null,now:Date){
  const regular=regularSchedule(now),time=now.getTime();
  const specialExpiry=(data?.entries??[]).filter(entry=>entry.category==="Special Meeting"&&Date.parse(entry.completedAt)<=time)
    .map(entry=>Date.parse(entry.expiresAt)).filter(expiry=>expiry>time);
  const boundary=new Date(Math.min(Date.parse(regular.resetAt),...specialExpiry)).toISOString();
  return {...regular,boundary};
}
export function specialResetLabel(entries:HistoryEntry[]){
  if(!entries.length)return "Completed tasks clear at their scheduled 11:59 PM IST reset.";
  const next=Math.min(...entries.map(entry=>Date.parse(entry.expiresAt)));
  return "Next clears "+new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kolkata",weekday:"long",month:"short",day:"numeric"}).format(new Date(next-1))+" · 11:59 PM IST";
}
