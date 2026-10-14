import { completionAge, mapTask, type Task, type Category, type TaskRow } from "./model";
import { decodeCategory, decodeRow, isRecord, timestamp, uuid } from "./validation";

import { decodeDeletedTemplate, type TemplateItem } from "@/lib/templates/model";

export const MAX_BIN_SELECTION = 1000;
export type BinTask = Task & { deletedAt: string; deletedByName: string | null; deletedById?:string|null };
export type BinTemplate = {kind:"template";id:string;title:string;notes:string;items:TemplateItem[];updatedAt:string;deletedAt:string;deletedByName:string|null;deletedById?:string|null};
export type BinEntry = (BinTask & {kind:"task"}) | BinTemplate;
export type BinItem = { id: string; version: string; kind?:"task"|"template" };
export const binKey=(item:{id:string;kind?:"task"|"template"})=>(item.kind??"task")+":"+item.id.toLowerCase();
export type BinAction = { action: "restore" | "purge"; items: BinItem[]; confirmed: true };
export type BinRow = TaskRow & { deleted_at: string; deleted_by_name: string | null;deleted_by_member_id?:string|null };
export function validateBinAction(value: unknown): BinAction | null {
  if (!isRecord(value) || !["restore", "purge"].includes(value.action as string) || value.confirmed !== true
    || Object.keys(value).some(key => !["action", "items", "confirmed"].includes(key))
    || !Array.isArray(value.items) || !value.items.length || value.items.length > MAX_BIN_SELECTION) return null;
  const items = value.items;
  if (!items.every(item => isRecord(item) && Object.keys(item).every(key => ["id", "version", "kind"].includes(key)) && uuid(item.id) && timestamp(item.version) && (item.kind===undefined||item.kind==="task"||item.kind==="template"))
    || new Set(items.map(item => binKey(item as BinItem))).size !== items.length) return null;
  return { action: value.action as BinAction["action"], items: items as BinItem[], confirmed: true };
}
export function decodeBinRow(value: unknown): BinRow {
  const row = decodeRow(value);
  if (!isRecord(value) || !timestamp(value.deleted_at)
    || !(value.deleted_by_member_id===undefined||value.deleted_by_member_id===null||(uuid(value.deleted_by_member_id)&&typeof value.deleted_by_name==="string"))
    || !(value.deleted_by_name === null || (typeof value.deleted_by_name === "string" && value.deleted_by_name.trim().length > 0 && value.deleted_by_name.length <= 50))) throw new Error("Incomplete Bin task response.");
  return { ...row,...(value.deleted_by_member_id===undefined?{}:{deleted_by_member_id:value.deleted_by_member_id as string|null}), deleted_at: value.deleted_at, deleted_by_name: value.deleted_by_name as string | null };
}
export function decodeBinResponse(value: unknown): { tasks: BinTask[]; templates:BinTemplate[]; categories: Category[] } {
  if (!isRecord(value) || !Array.isArray(value.tasks) || !Array.isArray(value.categories) || !Array.isArray(value.templates)) throw new Error("Incomplete Bin response. Refresh before trying again.");
  const categories = value.categories.map(decodeCategory);
  const rows = value.tasks.map(decodeBinRow);
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Incomplete Bin response.");
  const deletedTemplates=value.templates.map(decodeDeletedTemplate);
  if(new Set(deletedTemplates.map(item=>item.id)).size!==deletedTemplates.length)throw Error("Incomplete Bin templates response.");
  const templates:BinTemplate[]=deletedTemplates.map(item=>({kind:"template",id:item.id,title:item.name,notes:"",items:item.items,updatedAt:item.updated_at,deletedAt:item.deleted_at,deletedByName:item.deleted_by_name,deletedById:item.deleted_by_member_id??null}));
  templates.sort((a,b)=>Date.parse(b.deletedAt)-Date.parse(a.deletedAt)||a.id.localeCompare(b.id));
  return { categories, templates, tasks: rows.map(row => ({ ...mapTask(row, categories), deletedAt: row.deleted_at, deletedByName: row.deleted_by_name,deletedById:row.deleted_by_member_id??null }))
    .sort((a,b) => Date.parse(b.deletedAt) - Date.parse(a.deletedAt) || a.id.localeCompare(b.id)) };
}
export function confirmBinItems(value:unknown,input:BinAction){
  if(!isRecord(value)||value.action!==input.action||!Array.isArray(value.items)||value.items.length!==input.items.length
    ||!value.items.every(item=>isRecord(item)&&uuid(item.id)&&(item.kind==="task"||item.kind==="template")))throw Error("Bin changes could not be confirmed. Refresh before retrying.");
  const keys=new Set(value.items.map(item=>binKey(item as {id:string;kind:"task"|"template"})));
  if(keys.size!==input.items.length||!input.items.every(item=>keys.has(binKey(item))))throw Error("Bin changes could not be confirmed. Refresh before retrying.");
  return {action:input.action,items:value.items as {id:string;kind:"task"|"template"}[]};
}
export function deletionLabel(value: string, now = new Date()): string {
  const age = completionAge(value, now);
  if (!age) return "Deletion time unavailable";
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
  return `Deleted ${age.toLowerCase()} · ${time}`;
}
