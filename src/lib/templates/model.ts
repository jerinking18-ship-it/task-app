import { MAX_BATCH_TASKS, newTaskDraft } from "@/lib/tasks/model";
import { isRecord, timestamp, uuid } from "@/lib/tasks/validation";

export type TemplateItem = { title: string; notes: string };
export type TaskTemplate = { id: string; name: string; items: TemplateItem[]; created_at: string; updated_at: string };
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
export function decodeTemplate(value: unknown): TaskTemplate {
  if (!isRecord(value) || !uuid(value.id) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100
    || !validItems(value.items) || !timestamp(value.created_at) || !timestamp(value.updated_at)) throw Error("Incomplete template response. Refresh before trying again.");
  return {id:value.id,name:value.name,items:value.items.map(item=>({title:item.title,notes:item.notes})),created_at:value.created_at,updated_at:value.updated_at};
}
export function decodeTemplates(value: unknown): TaskTemplate[] {
  if (!isRecord(value) || !Array.isArray(value.templates)) throw Error("Templates could not be loaded completely.");
  const templates=value.templates.map(decodeTemplate);
  if (new Set(templates.map(item=>item.id)).size !== templates.length) throw Error("Templates changed while loading. Refresh again.");
  return templates;
}
export function templateDrafts(items: TemplateItem[], category: string) {
  // Explicitly copy only these two fields. Each task receives fresh category defaults
  // and independent arrays; no saved ids, completion state or stale dates can leak in.
  return items.map(item=>({...newTaskDraft(category),title:item.title,notes:item.notes}));
}
