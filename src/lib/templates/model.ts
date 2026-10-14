import { MAX_BATCH_TASKS, newTaskDraft } from "@/lib/tasks/model";
import { isRecord, timestamp, uuid } from "@/lib/tasks/validation";

export type TemplateItem = { title: string; notes: string };
export type TaskTemplate = { id: string; name: string; items: TemplateItem[]; created_at: string; updated_at: string };
export type TemplateRemoveAction = { action:"remove";id:string;version:string;confirmed:true };
export type TemplateMutation = TemplateAction | TemplateRemoveAction;
export type DeletedTemplate = TaskTemplate & {deleted_at:string;deleted_by_name:string|null};
export type TemplateAction = { action: "create" | "update"; id: string; name: string; items: TemplateItem[]; version: string | null };
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).every(key => keys.includes(key));
export function validItems(value: unknown): value is TemplateItem[] {
  return Array.isArray(value) && value.length > 0 && value.length <= MAX_BATCH_TASKS && value.every(item =>
    isRecord(item) && exact(item,["title","notes"]) && typeof item.title === "string" && item.title.trim().length > 0
    && item.title.length <= 200 && typeof item.notes === "string" && item.notes.length <= 4000);
}
export function validateTemplateAction(value: unknown): TemplateAction | null {
  if (!isRecord(value) || !exact(value,["action","id","name","items","version"]) || !["create","update"].includes(value.action as string)
    || !uuid(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 || !validItems(value.items)
    || (value.action === "create" ? value.version !== null : !timestamp(value.version))) return null;
  return {action:value.action as TemplateAction["action"],id:value.id,name:value.name.trim(),version:value.version as string|null,
    items:value.items.map(item=>({title:item.title.trim(),notes:item.notes}))};
}
export function validateTemplateMutation(value:unknown):TemplateMutation|null {
  if(isRecord(value)&&value.action==="remove")return exact(value,["action","id","version","confirmed"])&&uuid(value.id)&&timestamp(value.version)&&value.confirmed===true
    ?{action:"remove",id:value.id,version:value.version,confirmed:true}:null;
  return validateTemplateAction(value);
}
export function decodeTemplateRemoval(value:unknown,input:TemplateRemoveAction){
  if(!isRecord(value)||value.id!==input.id||!timestamp(value.updated_at)||!timestamp(value.deleted_at)||value.updated_at===input.version
    ||Date.parse(value.updated_at)<Date.parse(input.version))throw Error("Template removal could not be confirmed. Refresh before retrying.");
  return {id:value.id,updated_at:value.updated_at,deleted_at:value.deleted_at};
}
export function decodeTemplate(value: unknown,allowDeleted=false): TaskTemplate {
  if (!isRecord(value) || (!allowDeleted && value.deleted_at != null) || !uuid(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100
    || !validItems(value.items) || !timestamp(value.created_at) || !timestamp(value.updated_at)) throw Error("Incomplete template response. Refresh before trying again.");
  return {id:value.id,name:value.name,items:value.items.map(item=>({title:item.title,notes:item.notes})),created_at:value.created_at,updated_at:value.updated_at};
}
export function decodeDeletedTemplate(value:unknown):DeletedTemplate {
  const template=decodeTemplate(value,true);
  if(!isRecord(value)||!timestamp(value.deleted_at)||!(value.deleted_by_name===null||(typeof value.deleted_by_name==="string"&&value.deleted_by_name.trim()&&value.deleted_by_name.length<=50)))throw Error("Incomplete deleted template response.");
  return {...template,deleted_at:value.deleted_at,deleted_by_name:value.deleted_by_name as string|null};
}
export function decodeTemplates(value: unknown): TaskTemplate[] {
  if (!isRecord(value) || !Array.isArray(value.templates)) throw Error("Templates could not be loaded completely.");
  const templates=value.templates.map(value=>decodeTemplate(value));
  if (new Set(templates.map(item=>item.id)).size !== templates.length) throw Error("Templates changed while loading. Refresh again.");
  return templates;
}
export function templateDrafts(items: TemplateItem[], category: string) {
  // Explicitly copy only these two fields. Each task receives fresh category defaults
  // and independent arrays; no saved ids, completion state or stale dates can leak in.
  return items.map(item=>({...newTaskDraft(category),title:item.title,notes:item.notes}));
}
