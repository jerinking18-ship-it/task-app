import {accountClock,type Task} from "@/lib/tasks/model";
import {date} from "@/lib/tasks/validation";
export type SpecialDateChange={date:string;version:string;confirmed:true};
export type SpecialMeeting={id:string;startDate:string;days:number|null;locked:boolean;version:string;startsAt:string;endsAt:string};
export function shiftSpecialDay(day:string,amount:number){const d=new Date(day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+amount);return d.toISOString().slice(0,10);}
export function specialEndDay(start:string,days:number|null){return shiftSpecialDay(start,days===null?1:days-1);}
export {decodeSpecialMeeting} from "@/lib/tasks/validation";
export function activeSpecialMeeting(meetings:SpecialMeeting[],now:Date){return meetings.find(m=>!m.locked&&Date.parse(m.startsAt)<=now.getTime()&&now.getTime()<Date.parse(m.endsAt))??null;}
export function selectedSpecialMeeting(meetings:SpecialMeeting[],now:Date){const today=accountClock(now,"Asia/Kolkata").date;return activeSpecialMeeting(meetings,now)??meetings.find(m=>m.startDate<=today&&now.getTime()<Date.parse(m.endsAt))??[...meetings].filter(m=>m.startDate>today).sort((a,b)=>a.startDate.localeCompare(b.startDate))[0]??null;}
export function specialCurrentDay(m:SpecialMeeting,now:Date){const today=accountClock(now,"Asia/Kolkata").date;return today<m.startDate?m.startDate:today>specialEndDay(m.startDate,m.days)?specialEndDay(m.startDate,m.days):m.days===null?m.startDate:today;}
export function specialTaskOpen(t:Task,now:Date){const m=t.specialMeeting;return !!(m&&!m.locked&&t.specialEnabled&&Date.parse(m.startsAt)<=now.getTime()&&now.getTime()<Date.parse(m.endsAt));}
export function specialTaskLocked(t:Task,now:Date){return t.category==="Special Meeting"&&!!t.specialMeeting&&!specialTaskOpen(t,now);}
// Preserve raw records for History/Bin; current views show one occurrence per plan.
export function currentSpecialTasks(tasks:Task[],meetings:SpecialMeeting[],now:Date,category="Any",history=false){
 if(history)return tasks;
 const active=activeSpecialMeeting(meetings,now);
 return tasks.filter(t=>{
  if(t.category!=="Special Meeting")return !active;
  const m=t.specialMeeting;
  if(!m)return !active; // Reviewed legacy fixture compatibility; live036 adopts existing rows.
  if(now.getTime()>=Date.parse(m.endsAt))return false;
  if(active&&(m.id!==active.id||!t.specialEnabled))return category==="Special Meeting"&&(t.date||m.startDate)===specialCurrentDay(m,now);
  if(!active&&category!=="Special Meeting")return false;
  return (t.date||m.startDate)===specialCurrentDay(m,now);
 });
}
export function specialDaysLabel(start:string,days:number|null){if(!date(start))return "Choose a meeting date.";const count=days??1;if(!Number.isInteger(count)||count<1||count>31)return "Choose 1–31 days.";return Array.from({length:count},(_,i)=>new Intl.DateTimeFormat("en-US",{timeZone:"Asia/Kolkata",weekday:"short",day:"numeric"}).format(new Date(shiftSpecialDay(start,i)+"T12:00:00+05:30"))).join(" · ");}
