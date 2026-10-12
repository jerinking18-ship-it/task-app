import type { Category, Dataset, TaskAction, TaskFields, TaskRow } from "./model";
import { MAX_BATCH_TASKS } from "./model";

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const timestamp = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
function date(v: unknown) {
  return typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) && v >= "0001-01-01" && v <= "9999-12-31"
    && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0,10) === v;
}
export function validFields(v: unknown): v is TaskFields {
  return isRecord(v) && keys(v, ["title","notes","status","due_date","due_time","priority","category_id","weekdays","repeat_rule"])
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
    case "delete": return keys(v,["action","id","version"]) && uuid(v.id) && timestamp(v.version)
      ? {action:"delete",id:v.id,version:v.version} : null;
    case "update": return keys(v,["action","id","version","fields","scope","seriesVersion"]) && uuid(v.id) && timestamp(v.version) && validFields(v.fields)
      && (v.scope===undefined || v.scope==="this" || v.scope==="future")
      && (v.seriesVersion===undefined || timestamp(v.seriesVersion))
      ? { action:"update", id:v.id, version:v.version, fields:{...v.fields,title:v.fields.title.trim()},scope:v.scope as "this"|"future"|undefined,seriesVersion:v.seriesVersion as string|undefined } : null;
    case "status": return keys(v,["action","id","version","status"]) && uuid(v.id) && timestamp(v.version) && ["active","completed"].includes(v.status as string)
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
  const fields = { title:v.title, notes:v.notes, status:v.status, due_date:v.due_date,
    due_time:time, priority:v.priority, category_id:v.category_id, weekdays:v.weekdays,
    ...(v.repeat_rule!==undefined ? {repeat_rule:v.repeat_rule} : {}) };
  if (!validFields(fields) || (v.status === "completed") !== (v.completed_at !== null)) throw new Error("Incomplete task response.");
  if (!(v.series_id===undefined || v.series_id===null || uuid(v.series_id))
    || !(v.series_version===undefined || timestamp(v.series_version))
    || !(v.history_at===undefined || v.history_at===null || timestamp(v.history_at))
    || !(v.repeat_anchor_day===undefined || v.repeat_anchor_day===null || (Number.isInteger(v.repeat_anchor_day) && Number(v.repeat_anchor_day)>=1 && Number(v.repeat_anchor_day)<=31))) throw new Error("Incomplete repeat response.");
  if(v.repeat_rule && v.repeat_rule!=="off" && (!uuid(v.series_id) || (v.repeat_rule==="monthly" && !v.repeat_anchor_day))) throw new Error("Incomplete repeat response.");
  return { ...fields, id:v.id, created_at:v.created_at, updated_at:v.updated_at, completed_at:v.completed_at,
    series_id:v.series_id as string|null|undefined,history_at:v.history_at as string|null|undefined,repeat_anchor_day:v.repeat_anchor_day as number|null|undefined,series_version:v.series_version as string|undefined };
}
export function decodeDataset(v: unknown): Dataset {
  if (!isRecord(v) || !Array.isArray(v.tasks) || !Array.isArray(v.categories)
    || !(v.timezone === null || v.timezone === "Asia/Kolkata")) throw new Error("Incomplete saved data. Please refresh.");
  return {tasks:v.tasks.map(decodeRow), categories:v.categories.map(decodeCategory), timezone:v.timezone};
}
