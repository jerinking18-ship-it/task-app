import type { Category, Dataset, TaskAction, TaskFields, TaskRow } from "./model";
import { MAX_BATCH_TASKS } from "./model";

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export function date(v: unknown) {
  return typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) && v >= "0001-01-01" && v <= "9999-12-31"
    && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
}
export function validFields(v: unknown): v is TaskFields {
  return isRecord(v) && keys(v, ["title","notes","status","due_date","due_time","priority","category_id","weekdays","repeat_rule","assigned_to_member_id","sunday_service","special_days"])
    && (v.special_days===undefined||v.special_days===null||Number.isInteger(v.special_days)&&Number(v.special_days)>=1&&Number(v.special_days)<=31)
    && (v.sunday_service === undefined || v.sunday_service === null || ["morning","evening"].includes(v.sunday_service as string))
    && (v.assigned_to_member_id === undefined || v.assigned_to_member_id === null || uuid(v.assigned_to_member_id))
    && typeof v.title === "string" && v.title.trim().length > 0 && v.title.trim().length <= 200
    && (v.notes === null || (typeof v.notes === "string" && v.notes.length <= 4000))
    && ["active","completed"].includes(v.status as string)
    && ["none","low","medium","high"].includes(v.priority as string)
    && (v.due_date === null || date(v.due_date))
    && (v.due_time === null || (typeof v.due_time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.due_time) && v.due_date !== null))
    && (v.category_id === null || uuid(v.category_id))
    && Array.isArray(v.weekdays) && v.weekdays.length <= 7 && new Set(v.weekdays).size === v.weekdays.length
    && v.weekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    && (v.repeat_rule===undefined || ["off","daily","weekly","monthly"].includes(v.repeat_rule as string))
    && (!v.repeat_rule || v.repeat_rule==="off" || v.due_date!==null)
    && (v.repeat_rule!=="weekly" || (v.weekdays.length>0 && v.weekdays.includes(new Date(`${v.due_date}T12:00:00Z`).getUTCDay())));
}
export function validateAction(v: unknown): TaskAction | null {
  if (!isRecord(v)) return null;
  switch (v.action) {
    case "setup": return keys(v,["action","timezone"]) && v.timezone === "Asia/Kolkata" ? v as TaskAction : null;
    case "bootstrap": return keys(v,["action"]) ? { action: "bootstrap" } : null;
    case "category": return keys(v,["action","name"]) && typeof v.name === "string" && !!v.name.trim() && v.name.trim().length <= 40 ? { action: "category", name: v.name.trim() } : null;
    case "create": return keys(v,["action","fields"]) && validFields(v.fields) && v.fields.status === "active"
      ? { action: "create", fields: {...v.fields, title:v.fields.title.trim()} } : null;
    case "create_many": {
      const fields = v.fields;
      if (!keys(v,["action","fields"]) || !Array.isArray(fields) || !fields.length || fields.length > MAX_BATCH_TASKS
        || !fields.every((field): field is TaskFields => validFields(field) && field.status === "active")) return null;
      if (!fields.every(field=>field.category_id === fields[0].category_id)) return null;
      return {action:"create_many",fields:fields.map(field=>({...field,title:field.title.trim()}))};
    }
    case "special_lock":return keys(v,["action","id","version","locked","confirmed"])&&uuid(v.id)&&timestamp(v.version)&&typeof v.locked==="boolean"&&v.confirmed===true?v as TaskAction:null;
    case "delete": return keys(v,["action","id","version"]) && uuid(v.id) && timestamp(v.version)
      ? {action:"delete",id:v.id,version:v.version} : null;
    case "update": return keys(v,["action","id","version","fields","scope","assignmentScope","seriesVersion","specialStart"]) && uuid(v.id) && timestamp(v.version) && validFields(v.fields)
      && (v.scope===undefined || v.scope==="this" || v.scope==="future")
      && (v.assignmentScope===undefined || v.assignmentScope==="this" || v.assignmentScope==="future")
      && (v.specialStart===undefined || isRecord(v.specialStart)&&keys(v.specialStart,["date","version","confirmed"])&&date(v.specialStart.date)&&typeof v.specialStart.date==="string"&&v.specialStart.date<="9999-11-30"&&timestamp(v.specialStart.version)&&v.specialStart.confirmed===true&&v.fields.special_days!==undefined)
      && (v.seriesVersion===undefined || timestamp(v.seriesVersion))
      && (v.assignmentScope!=="future" || (timestamp(v.seriesVersion) && !!v.fields.assigned_to_member_id && !!v.fields.repeat_rule && v.fields.repeat_rule!=="off"))
      ? { action:"update", id:v.id, version:v.version, fields:{...v.fields,title:v.fields.title.trim()},scope:v.scope as "this"|"future"|undefined,assignmentScope:v.assignmentScope as "this"|"future"|undefined,seriesVersion:v.seriesVersion as string|undefined,specialStart:v.specialStart as Extract<TaskAction,{action:"update"}>["specialStart"] } : null;
    case "missed": return keys(v,["action","id","version","confirmed"]) && uuid(v.id) && timestamp(v.version) && v.confirmed===true ? v as TaskAction : null;
    case "take": return keys(v,["action","id","version","absenceId","confirmed"]) && uuid(v.id) && timestamp(v.version) && uuid(v.absenceId) && v.confirmed===true ? v as TaskAction : null;
    case "status": return keys(v,["action","id","version","status","cachedProjection"]) && (v.cachedProjection===undefined||v.cachedProjection===true) && uuid(v.id) && timestamp(v.version) && ["active","completed"].includes(v.status as string)
      ? v as TaskAction : null;
    default: return null;
  }
}
export function decodeCategory(v: unknown): Category {
  if (!isRecord(v) || !uuid(v.id) || typeof v.name !== "string" || !v.name.trim() || v.name.length > 40) throw new Error("Incomplete category response.");
  return { id:v.id, name:v.name };
}
export function decodeRow(v: unknown): TaskRow {
  if (!isRecord(v) || !uuid(v.id) || !timestamp(v.created_at) || !timestamp(v.updated_at)
    || !(v.completed_at === null || timestamp(v.completed_at))) throw new Error("Incomplete task response.");
  // PostgreSQL returns time with seconds; the first stage edits minute precision.
  const time = typeof v.due_time === "string" && /^([01]\d|2[0-3]):[0-5]\d:00(?:\.0+)?$/.test(v.due_time) ? v.due_time.slice(0,5) : v.due_time;
  const fields = { ...(v.sunday_service===undefined?{}:{sunday_service:v.sunday_service}), ...(v.assigned_to_member_id===undefined?{}:{assigned_to_member_id:v.assigned_to_member_id as string|null}), title:v.title, notes:v.notes, status:v.status, due_date:v.due_date,
    due_time:time, priority:v.priority, category_id:v.category_id, weekdays:v.weekdays,
    ...(v.repeat_rule!==undefined ? {repeat_rule:v.repeat_rule} : {}) };
  if (!validFields(fields) || (v.status === "completed") !== (v.completed_at !== null)) throw new Error("Incomplete task response.");
  if (!(v.series_id===undefined || v.series_id===null || uuid(v.series_id))
    || !(v.series_version===undefined || timestamp(v.series_version))
    || !(v.history_at===undefined || v.history_at===null || timestamp(v.history_at))
    || !(v.available_at===undefined || v.available_at===null || timestamp(v.available_at))
    || !(v.repeat_anchor_day===undefined || v.repeat_anchor_day===null || (Number.isInteger(v.repeat_anchor_day) && Number(v.repeat_anchor_day)>=1 && Number(v.repeat_anchor_day)<=31))) throw new Error("Incomplete repeat response.");
  if(v.repeat_rule && v.repeat_rule!=="off" && (!uuid(v.series_id) || (v.repeat_rule==="monthly" && !v.repeat_anchor_day))) throw new Error("Incomplete repeat response.");
  const origin=v.claim_origin;
  if(origin!==undefined&&origin!==null&&(!isRecord(origin)||!uuid(origin.member_id)||!uuid(origin.taken_by_member_id)
    ||origin.member_id===origin.taken_by_member_id||origin.taken_by_member_id!==v.assigned_to_member_id
    ||typeof origin.member_name!=="string"||!origin.member_name.trim()||origin.member_name.length>50))throw new Error("Incomplete original assignee response.");
  const coverage=v.coverage;
  if(coverage!==undefined&&coverage!==null&&(!isRecord(coverage)||!uuid(coverage.absence_id)||!uuid(coverage.member_id)
    ||coverage.member_id!==v.assigned_to_member_id||typeof coverage.member_name!=="string"||!coverage.member_name.trim()
    ||coverage.member_name.length>50||!timestamp(coverage.expires_at)||v.status!=="active"))throw new Error("Incomplete coverage response.");
  const completedById=v.completed_by_member_id ?? null, completedByName=v.completed_by_name ?? null;
  if (!((completedById===null && completedByName===null) || (v.status==="completed" && uuid(completedById)
    && typeof completedByName==="string" && completedByName.trim().length>0 && completedByName.length<=50))) throw new Error("Incomplete completion member response.");
  const missed=v.missed_completion_role??null;
  if(missed!==null && (!["owner","coordinator"].includes(missed as string) || v.status!=="completed" || !uuid(completedById) || !uuid(v.assigned_to_member_id) || completedById===v.assigned_to_member_id)) throw new Error("Incomplete missed completion response.");
  if(!(v.special_plan_id===undefined||v.special_plan_id===null||uuid(v.special_plan_id))||!(v.special_enabled===undefined||typeof v.special_enabled==="boolean")||!(v.special_plan_version===undefined||timestamp(v.special_plan_version)))throw Error("Incomplete Special task response.");
  const special=v.special_meeting===undefined||v.special_meeting===null?v.special_meeting:decodeSpecialMeeting(v.special_meeting);
  return { ...fields,special_plan_id:v.special_plan_id as string|null|undefined,special_enabled:v.special_enabled as boolean|undefined,special_meeting:special,special_plan_version:v.special_plan_version as string|undefined, missed_completion_role:missed as TaskRow["missed_completion_role"], ...(origin===undefined?{}:{claim_origin:origin as TaskRow["claim_origin"]}), ...(coverage===undefined?{}:{coverage:coverage as TaskRow["coverage"]}), id:v.id, created_at:v.created_at, updated_at:v.updated_at, completed_at:v.completed_at,
    completed_by_member_id:completedById as string|null,completed_by_name:completedByName as string|null,
    series_id:v.series_id as string|null|undefined,history_at:v.history_at as string|null|undefined,available_at:v.available_at as string|null|undefined,repeat_anchor_day:v.repeat_anchor_day as number|null|undefined,series_version:v.series_version as string|undefined };
}
export function decodeDataset(v: unknown): Dataset {
  if (!isRecord(v) || !Array.isArray(v.tasks) || !Array.isArray(v.categories)
    || !(v.timezone === null || v.timezone === "Asia/Kolkata")) throw new Error("Incomplete saved data. Please refresh.");
  if(v.specialMeetings!==undefined&&(!Array.isArray(v.specialMeetings)||v.specialMeetings.length>10000))throw Error("Incomplete meeting schedules.");
  if(v.serverNow!==undefined&&!timestamp(v.serverNow))throw Error("Incomplete server time.");
  const specialMeetings=v.specialMeetings===undefined?[]:(v.specialMeetings as unknown[]).map(decodeSpecialMeeting);
  if(new Set(specialMeetings.map(m=>m.id)).size!==specialMeetings.length)throw Error("Duplicate meeting schedules.");
  return {tasks:v.tasks.map(decodeRow), categories:v.categories.map(decodeCategory), timezone:v.timezone,specialMeetings,serverNow:v.serverNow as string|undefined};
}

export function decodeSpecialMeeting(v:unknown):import("@/lib/special-meetings/model").SpecialMeeting {
 if(!isRecord(v)||!uuid(v.id)||!date(v.startDate)||!(v.days===null||Number.isInteger(v.days)&&Number(v.days)>=1&&Number(v.days)<=31)||typeof v.locked!=="boolean"||!timestamp(v.version)||!timestamp(v.startsAt)||!timestamp(v.endsAt))throw Error("Incomplete Special Meeting schedule.");
 const end=new Date(v.startDate+"T12:00:00Z");end.setUTCDate(end.getUTCDate()+(v.days===null?2:Number(v.days)));
 if(Date.parse(v.startsAt)!==Date.parse(v.startDate+"T00:00:00+05:30")||Date.parse(v.endsAt)!==Date.parse(end.toISOString().slice(0,10)+"T00:00:00+05:30"))throw Error("Incomplete Special Meeting dates.");
 return {id:v.id,startDate:v.startDate as string,days:v.days as number|null,locked:v.locked,version:v.version,startsAt:v.startsAt,endsAt:v.endsAt};
}
