import {isRecord,timestamp,uuid} from "@/lib/tasks/validation";
import {MEETING_CATEGORIES,accountClock} from "@/lib/tasks/model";
export type FineStatus="unpaid"|"paid"|"cancelled";
export type Fine={id:string;taskId:string;title:string;category:string;memberId:string;memberName:string;cutoffAt:string;amountPaise:number;status:FineStatus;assessedAt:string;version:string;settledAt:string|null;settledById:string|null;settledByName:string|null;reason:string|null};
export type FinesData={serverNow:string;enabledAt:string|null;members:{id:string;name:string}[];entries:Fine[]};
export type FineAction={id:string;version:string;action:"paid"|"cancelled";reason:string|null;confirmed:true};
const text=(v:unknown,max:number):v is string=>typeof v==="string"&&!!v.trim()&&v.length<=max;
export function decodeFines(v:unknown):FinesData{
 if(!isRecord(v)||!timestamp(v.serverNow)||(v.enabledAt!==null&&!timestamp(v.enabledAt))||!Array.isArray(v.members)||v.members.length>100000||!Array.isArray(v.entries)||v.entries.length>100000)throw Error("Incomplete fine response. Refresh to try again.");
 const members=v.members.map(m=>{if(!isRecord(m)||!uuid(m.id)||!text(m.name,50))throw Error("Incomplete fine member.");return{id:m.id,name:m.name};});
 const ids=new Set(members.map(m=>m.id));if(ids.size!==members.length)throw Error("Duplicate fine members.");
 const entries=v.entries.map(f=>{
  if(!isRecord(f)||!uuid(f.id)||!uuid(f.taskId)||!text(f.title,200)||!text(f.category,50)||!MEETING_CATEGORIES.includes(f.category)||!uuid(f.memberId)||!text(f.memberName,50)||!timestamp(f.cutoffAt)||f.amountPaise!==5000||!["unpaid","paid","cancelled"].includes(String(f.status))||!timestamp(f.assessedAt)||!timestamp(f.version))throw Error("Incomplete fine record.");
  if(f.status==="unpaid"?(f.settledAt!==null||f.settledById!==null||f.settledByName!==null||f.reason!==null):(!timestamp(f.settledAt)||!uuid(f.settledById)||!text(f.settledByName,50)||(f.status==="cancelled"?!text(f.reason,500):f.reason!==null)))throw Error("Incomplete fine settlement.");
  return f as unknown as Fine;
 });
 if(new Set(entries.map(f=>f.id)).size!==entries.length||new Set(entries.map(f=>f.taskId)).size!==entries.length)throw Error("Duplicate fines.");
 return{serverNow:v.serverNow,enabledAt:v.enabledAt,members,entries};
}
export function fineAction(v:unknown):FineAction|null{
 if(!isRecord(v)||Object.keys(v).sort().join()!=="action,confirmed,id,reason,version"||!uuid(v.id)||!timestamp(v.version)||v.confirmed!==true||!["paid","cancelled"].includes(String(v.action))||(v.action==="paid"?v.reason!==null:!text(v.reason,500)))return null;
 return{id:v.id,version:v.version,action:v.action as FineAction["action"],reason:typeof v.reason==="string"?v.reason.trim():null,confirmed:true};
}
export function fineTotals(entries:Fine[]){return entries.reduce((totals,f)=>({...totals,[f.status]:totals[f.status]+f.amountPaise}),{unpaid:0,paid:0,cancelled:0});}
export const rupees=(paise:number)=>new Intl.NumberFormat("en-IN",{style:"currency",currency:"INR",maximumFractionDigits:0}).format(paise/100);
export function fineMonth(value:string){return accountClock(new Date(value),"Asia/Kolkata").date.slice(0,7);}
export function filterFines(entries:Fine[],filters:{member:string;category:string;month:string;search:string;status:FineStatus|"all"}){
 const search=filters.search.trim().toLocaleLowerCase();return entries.filter(f=>(filters.member==="all"||f.memberId===filters.member)&&(filters.category==="all"||f.category===filters.category)&&(filters.month==="all"||fineMonth(f.cutoffAt)===filters.month)&&(filters.status==="all"||f.status===filters.status)&&(!search||[f.title,f.memberName,f.category].some(v=>v.toLocaleLowerCase().includes(search))));
}
