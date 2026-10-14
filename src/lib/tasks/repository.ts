import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Dataset, TaskAction, TaskRow } from "./model";
import { MEETING_CATEGORIES } from "./model";
import { decodeCategory, decodeRow, timestamp, uuid, isRecord } from "./validation";

const TASK_COLUMNS = "id,title,notes,status,due_date,due_time,priority,category_id,weekdays,repeat_rule,series_id,history_at,available_at,repeat_anchor_day,created_at,updated_at,completed_at,completed_by_member_id,completed_by_name,assigned_to_member_id";
export class TaskError extends Error {
  constructor(public status: number, message: string, public latest?: TaskRow, public categories?: Category[], public future?:TaskRow[]) { super(message); }
}
function check(error: { code?: string } | null) {
  if (!error) return;
  if(error.code === "P0403") throw new TaskError(403,"Your current role or assignment does not allow this action. Refresh to see current permissions.");
  if(error.code === "P0409") throw new TaskError(409,"This item changed. Refresh and review the current details before trying again.");
  if (["PGRST301","PGRST302","42501"].includes(error.code ?? "")) throw new TaskError(401,"Your session is unavailable. Sign in again to continue.");
  if (["23514","23503","23502","22007"].includes(error.code ?? "")) throw new TaskError(400,"Check the task details and category, then try again.");
  throw new TaskError(503,"We couldn’t confirm this request. Refresh to check saved data before trying again.");
}
export class TaskRepository {
  constructor(private client: SupabaseClient, private owner: string) {}
  async timezone(): Promise<Dataset["timezone"]> {
    const {data,error} = await this.client.from("account_settings").select("timezone").eq("owner_id",this.owner).maybeSingle();
    check(error);
    if (!data) return null;
    if (data.timezone !== "Asia/Kolkata") throw new TaskError(503,"This account’s timezone is not supported by this version.");
    return data.timezone;
  }
  private async pages<T extends {id:string}>(table: "tasks" | "categories", decode: (v:unknown)=>T): Promise<T[]> {
    const result: T[] = []; const seen = new Set<string>(); let cursor = "";
    for (let page=0; page<200; page++) {
      let query = this.client.from(table).select(table === "tasks" ? TASK_COLUMNS : "id,name")
        .eq("owner_id",this.owner).order("id",{ascending:true}).limit(500);
      if (table === "tasks") query = query.is("deleted_at",null);
      if (cursor) query = query.gt("id",cursor);
      const {data,error} = await query; check(error);
      if (!Array.isArray(data)) throw new TaskError(503,"Saved data could not be loaded completely. Try refreshing.");
      const rows = data.map(decode);
      for (const row of rows) {
        if (seen.has(row.id) || (cursor && row.id <= cursor)) throw new TaskError(503,"Saved data changed during loading. Refresh again.");
        seen.add(row.id); result.push(row);
      }
      if (rows.length < 500) return result;
      cursor = rows.at(-1)!.id;
    }
    throw new TaskError(503,"There are too many records to load in this version. No partial list is shown.");
  }
  async read(): Promise<Dataset> {
    // Owner-scoped, server-clock catch-up also covers a delayed Cron run. Before
    // midnight this is a no-op. Failed maintenance must never show a partial list.
    const {error}=await this.client.rpc("task_app_release_my_repeats"); check(error);
    const [timezone,tasks,categories] = await Promise.all([this.timezone(),this.pages("tasks",decodeRow),this.pages("categories",decodeCategory)]);
    const {data:coverage,error:coverageError}=await this.client.rpc("task_app_available_coverage");check(coverageError);
    if(!Array.isArray(coverage))throw new TaskError(503,"Task availability could not be confirmed. Refresh before continuing.");
    const released=new Map<string,{version:string;coverage:NonNullable<TaskRow["coverage"]>}>();
    for(const value of coverage){
      if(!isRecord(value)||!uuid(value.task_id)||!timestamp(value.version)||!uuid(value.absence_id)||!uuid(value.member_id)
        ||typeof value.member_name!=="string"||!value.member_name.trim()||value.member_name.length>50||!timestamp(value.expires_at)||released.has(value.task_id))
        throw new TaskError(503,"Task availability could not be loaded completely. Refresh before continuing.");
      released.set(value.task_id,{version:value.version,coverage:{absence_id:value.absence_id,member_id:value.member_id,member_name:value.member_name,expires_at:value.expires_at}});
    }
    const decorated=tasks.map(task=>{const entry=released.get(task.id);return decodeRow({...task,coverage:entry&&entry.version===task.updated_at?entry.coverage:null});});
    const versions=new Map<string,string>();
    for(const task of tasks) if(task.series_id && (!versions.has(task.series_id) || task.updated_at>versions.get(task.series_id)!)) versions.set(task.series_id,task.updated_at);
    return {timezone,tasks:decorated.map(task=>({...task,series_version:task.series_id?versions.get(task.series_id):task.updated_at})),categories};
  }
  async mutate(input: TaskAction): Promise<Record<string,unknown>> {
    if (input.action==="setup" || input.action==="bootstrap" || input.action==="category") {
      const {data,error}=await this.client.rpc("task_app_setup",{operation:input.action,category_name:input.action==="category"?input.name:null});
      check(error);
      if(input.action==="bootstrap")return {categories:await this.pages("categories",decodeCategory)};
      if(input.action==="category")return {category:decodeCategory(data?.category)};
      if(data?.timezone!=="Asia/Kolkata")throw new TaskError(503,"Workspace setup could not be confirmed. Refresh before retrying.");
      return {timezone:data.timezone};
    }
    if(input.action==="create" || input.action==="create_many") {
      const fields=input.action==="create"?[input.fields]:input.fields;
      if(fields.some(field=>!field.assigned_to_member_id))throw new TaskError(400,"Choose an assigned member for every task.");
      const {data,error}=await this.client.rpc("task_app_create_tasks",{task_fields:fields});check(error);
      if(!Array.isArray(data)||data.length!==fields.length)throw new TaskError(503,"Refresh and review saved tasks before trying again.");
      const tasks=data.map(decodeRow);return input.action==="create"?{task:tasks[0]}:{tasks};
    }
    if(input.action==="take"){
      const {data,error}=await this.client.rpc("task_app_take_task",{task_id:input.id,expected_version:input.version,absence_id:input.absenceId,confirmed:input.confirmed});check(error);
      const task=decodeRow(data);
      if(task.id!==input.id)throw new TaskError(503,"Taking this task could not be confirmed. Refresh before trying again.");
      return {task};
    }
    const {data,error} = await this.client.rpc("task_app_mutate",{
      task_id:input.id,expected_version:input.version,operation:input.action,
      fields:input.action==="update"?input.fields:null,new_status:input.action==="status"?input.status:null,
      edit_scope:input.action==="update"?(input.scope??"this"):"this",
      expected_series_version:input.action==="update"?(input.seriesVersion??input.version):null
    });
    check(error);
    if (data && !data.conflict) {
      if (input.action === "delete") {
        // Deleted tasks have no live series version when no occurrence remains.
        // Confirm the committed Bin move without treating that null as a live row.
        const deleted = decodeRow({...data,series_version:data.series_version ?? undefined});
        if (deleted.id !== input.id || !timestamp(data.deleted_at))
          throw new TaskError(503,"We couldn’t confirm moving this task. Refresh to check Bin before trying again.");
        return {deleted:deleted.id};
      }
      return {task:decodeRow(data)};
    }
    const current = await this.client.from("tasks").select(TASK_COLUMNS).eq("id",input.id).eq("owner_id",this.owner).is("deleted_at",null).maybeSingle();
    check(current.error);
    if (!current.data) throw new TaskError(404,"This task is no longer available. Your draft has been kept.");
    throw new TaskError(409,input.action === "delete" ? "This task changed elsewhere. Review the saved version before deleting it." : "This task or a future occurrence changed elsewhere. Review saved tasks before saving your draft.",decodeRow({...current.data,...(data?.series_version?{series_version:data.series_version}:{})}),await this.pages("categories",decodeCategory),Array.isArray(data?.future)?data.future.map(decodeRow):undefined);
  }
}
