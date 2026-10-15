import { decodeDeletedTemplate } from "@/lib/templates/model";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decodeBinRow, confirmBinItems, type BinAction } from "./bin";
import { decodeCategory } from "./validation";
import { TaskError,readMemberNames } from "./repository";
const columns = "id,title,notes,status,due_date,due_time,priority,category_id,sunday_service,weekdays,repeat_rule,series_id,history_at,available_at,repeat_anchor_day,created_at,updated_at,completed_at,completed_by_member_id,completed_by_name,missed_completion_role,deleted_at,deleted_by_name,deleted_by_member_id,assigned_to_member_id";
function check(error: { code?: string } | null) {
  if (!error) return;
  if(error.code === "P0403") throw new TaskError(403,"Your current role or assignment does not allow this action. Refresh to see current permissions.");
  if(error.code === "P0409") throw new TaskError(409,"This item changed. Refresh and review the current details before trying again.");
  if (["42501", "PGRST301", "PGRST302"].includes(error.code ?? "")) throw new TaskError(401, "Your session has ended. Sign in again to continue.");
  if (error.code === "P0012") throw new TaskError(409, "A selected item changed or is no longer in Bin. Refresh and select again. No items were changed.");
  if (["23514", "22P02"].includes(error.code ?? "")) throw new TaskError(400, "Check your selection and try again.");
  throw new TaskError(503, "We couldn’t confirm this Bin request. Refresh before trying again.");
}
export class BinRepository {
  constructor(private client: SupabaseClient, private owner: string, private templatesAllowed = true) {}
  private async pages(table: "tasks" | "categories") {
    const rows: unknown[] = []; const seen = new Set<string>(); let cursor = "";
    for (let page = 0; page < 200; page++) {
      let query = this.client.from(table).select(table === "tasks" ? columns : "id,name").eq("owner_id", this.owner).order("id", { ascending: true }).limit(500);
      if (table === "tasks") query = query.not("deleted_at", "is", null);
      if (cursor) query = query.gt("id", cursor);
      const { data, error } = await query; check(error);
      if (!Array.isArray(data)) throw new TaskError(503, "Bin could not be loaded completely. Refresh to try again.");
      for (const value of data) {
        const row = table === "tasks" ? decodeBinRow(value) : decodeCategory(value);
        if (seen.has(row.id) || (cursor && row.id <= cursor)) throw new TaskError(503, "Bin changed while loading. Refresh again.");
        seen.add(row.id); rows.push(row);
      }
      if (data.length < 500) return rows;
      cursor = [...seen].at(-1)!;
    }
    throw new TaskError(503, "Bin is too large to load completely. No partial list is shown.");
  }
  async read() {
    const [rawTasks,categories,names] = await Promise.all([this.pages("tasks"),this.pages("categories"),readMemberNames(this.client)]);
    const tasks=rawTasks.map(value=>{const task=decodeBinRow(value);return {...task,completed_by_name:task.completed_by_member_id?names.get(task.completed_by_member_id)??task.completed_by_name:task.completed_by_name,deleted_by_name:task.deleted_by_member_id?names.get(task.deleted_by_member_id)??task.deleted_by_name:task.deleted_by_name};});
    if(!this.templatesAllowed)return {tasks,categories,templates:[]};
    const {data,error}=await this.client.rpc("task_app_deleted_templates");check(error);
    if(!Array.isArray(data))throw new TaskError(503,"Bin templates could not be loaded completely. Refresh to try again.");
    const templates=data.map(value=>{const item=decodeDeletedTemplate(value);return {...item,deleted_by_name:item.deleted_by_member_id?names.get(item.deleted_by_member_id)??item.deleted_by_name:item.deleted_by_name};});
    if(new Set(templates.map(item=>item.id)).size!==templates.length)throw new TaskError(503,"Bin templates changed while loading. Refresh again.");
    return { tasks, categories, templates };
  }
  async mutate(input: BinAction) {
    if(input.items.some(item=>item.kind!==undefined)){
      const {data,error}=await this.client.rpc("task_app_bin_items",{operation:input.action,selections:input.items.map(item=>({...item,kind:item.kind??"task"})),confirmed:input.confirmed});check(error);
      try{return confirmBinItems(data,input);}catch{throw new TaskError(503,"Bin changes could not be confirmed. Refresh before retrying.");}
    }
    const { data, error } = await this.client.rpc("task_app_bin", { operation: input.action, selections: input.items, confirmed: input.confirmed });
    check(error);
    if (!data || data.action !== input.action || !Array.isArray(data.ids) || data.ids.length !== input.items.length
      || new Set(data.ids).size !== data.ids.length || !input.items.every(item => data.ids.includes(item.id))) throw new TaskError(503, "Bin changes could not be confirmed. Refresh before retrying.");
    return data as { action: BinAction["action"]; ids: string[] };
  }
}
