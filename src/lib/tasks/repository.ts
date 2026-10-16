import type { SupabaseClient } from "@supabase/supabase-js";
import type { Category, Dataset, TaskAction, TaskRow } from "./model";
import { MEETING_CATEGORIES } from "./model";
import { decodeCategory, decodeRow, decodeSpecialMeeting,timestamp, uuid, isRecord } from "./validation";

const TASK_COLUMNS = "id,title,notes,status,due_date,due_time,priority,category_id,sunday_service,weekdays,repeat_rule,series_id,history_at,available_at,repeat_anchor_day,created_at,updated_at,completed_at,completed_by_member_id,completed_by_name,missed_completion_role,assigned_to_member_id,special_plan_id,special_enabled";
export class TaskError extends Error {
  constructor(public status: number, message: string, public latest?: TaskRow, public categories?: Category[], public future?:TaskRow[]) { super(message); }
}
function check(error: { code?: string } | null) {
  if (!error) return;
  if(error.code === "P0037")throw new TaskError(409,"Another activated Special Meeting overlaps these dates. Lock it before activating this meeting.");
  if(error.code === "P0036")throw new TaskError(409,"This meeting is locked or another Special Meeting is active. Refresh to check the current meeting.");
  if(error.code === "P0015") throw new TaskError(403,"This task is restricted after a Missed completion. An Owner or Coordinator can remove the restriction on Attendance.");
  if(error.code === "P0014") throw new TaskError(409,"Missed completion is outside this task’s meeting window. Sunday Morning: 9:00 AM–4:00 PM. Other services: 7:00 PM–1:00 AM the following day, India time. Refresh before retrying.");
  if(error.code === "P0403") throw new TaskError(403,"Your current role or assignment does not allow this action. Refresh to see current permissions.");
  if(error.code === "P0409") throw new TaskError(409,"This item changed. Refresh and review the current details before trying again.");
  if (["PGRST301","PGRST302","42501"].includes(error.code ?? "")) throw new TaskError(401,"Your session is unavailable. Sign in again to continue.");
  if (["23514","23503","23502","22007"].includes(error.code ?? "")) throw new TaskError(400,"Check the task details and category, then try again.");
  throw new TaskError(503,"We couldn’t confirm this request. Refresh to check saved data before trying again.");
}
// Resolve historical authors through a verified workspace-scoped RPC. The
// underlying directory stays private, including retained former profiles.
export async function readMemberNames(client:SupabaseClient):Promise<Map<string,string>> {
  const {data,error}=await client.rpc("task_app_member_names");check(error);
  if(!Array.isArray(data)||data.length>100000)throw new TaskError(503,"Member names could not be loaded completely. Refresh to try again.");
  const names=new Map<string,string>();
  for(const member of data){
    if(!isRecord(member)||!uuid(member.id)||typeof member.name!=="string"||!member.name.trim()||member.name.length>50||names.has(member.id))
      throw new TaskError(503,"Member names changed while loading. Refresh again.");
    names.set(member.id,member.name);
  }
  return names;
}
function withCompletionName(row:TaskRow,names:Map<string,string>):TaskRow {
  const current=row.completed_by_member_id?names.get(row.completed_by_member_id):undefined;
  return current?{...row,completed_by_name:current}:row;
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
  private async origins() {
    const {data,error}=await this.client.rpc("task_app_coverage_origins");check(error);
    if(!Array.isArray(data))throw new TaskError(503,"Original task assignments could not be confirmed. Refresh before continuing.");
    const origins=new Map<string,{version:string;origin:NonNullable<TaskRow["claim_origin"]>}>();
    for(const value of data){
      if(!isRecord(value)||!uuid(value.task_id)||!timestamp(value.version)||!uuid(value.member_id)||!uuid(value.taken_by_member_id)
        ||value.member_id===value.taken_by_member_id||typeof value.member_name!=="string"||!value.member_name.trim()||value.member_name.length>50||origins.has(value.task_id))
        throw new TaskError(503,"Original task assignments could not be loaded completely. Refresh before continuing.");
      origins.set(value.task_id,{version:value.version,origin:{member_id:value.member_id,member_name:value.member_name,taken_by_member_id:value.taken_by_member_id}});
    }
    return origins;
  }
  private async specialState(){
    const {data,error}=await this.client.rpc("task_app_special_state");check(error);
    if(!isRecord(data)||!timestamp(data.serverNow)||!Array.isArray(data.meetings)||!Array.isArray(data.plans)||data.meetings.length>10000||data.plans.length>100000)throw new TaskError(503,"Meeting schedules could not be loaded completely. Refresh before continuing.");
    const meetings=data.meetings.map(decodeSpecialMeeting),ids=new Set(meetings.map(e=>e.id));
    const plans=new Map<string,{meetingId:string;version:string}>();
    for(const p of data.plans){if(!isRecord(p)||!uuid(p.id)||!uuid(p.meetingId)||!ids.has(p.meetingId)||!timestamp(p.version)||typeof p.enabled!=="boolean"||typeof p.cancelled!=="boolean"||plans.has(p.id))throw new TaskError(503,"Incomplete meeting task schedule.");plans.set(p.id,{meetingId:p.meetingId,version:p.version});}
    if(ids.size!==meetings.length)throw new TaskError(503,"Duplicate meeting schedule.");
    return {meetings,plans,serverNow:data.serverNow};
  }
  private decorateSpecial(row:TaskRow,state:Awaited<ReturnType<TaskRepository["specialState"]>>){
    if(!row.special_plan_id)return row;
    const plan=state.plans.get(row.special_plan_id),meeting=state.meetings.find(e=>e.id===plan?.meetingId);
    if(!plan||!meeting)throw new TaskError(503,"A meeting changed while loading. Refresh before continuing.");
    return decodeRow({...row,special_meeting:meeting,special_plan_version:plan.version});
  }
  private async withOrigin(row:TaskRow):Promise<TaskRow> {
    const [origins,names,special]=await Promise.all([this.origins(),readMemberNames(this.client),this.specialState()]);
    const origin=origins.get(row.id);
    return this.decorateSpecial(decodeRow({...withCompletionName(row,names),claim_origin:origin?.version===row.updated_at?origin.origin:null}),special);
  }
  async read(): Promise<Dataset> {
    // Owner-scoped, server-clock catch-up also covers a delayed Cron run. Before
    // midnight this is a no-op. Failed maintenance must never show a partial list.
    const {error}=await this.client.rpc("task_app_release_my_repeats"); check(error);
    // These workspace-scoped reads are independent after schedule catch-up.
    const [timezone,tasks,categories,names,special,{data:coverage,error:coverageError},origins] = await Promise.all([
      this.timezone(),this.pages("tasks",decodeRow),this.pages("categories",decodeCategory),readMemberNames(this.client),
      this.specialState(),this.client.rpc("task_app_available_coverage"),this.origins()
    ]);check(coverageError);
    if(!Array.isArray(coverage))throw new TaskError(503,"Task availability could not be confirmed. Refresh before continuing.");
    const released=new Map<string,{version:string;coverage:NonNullable<TaskRow["coverage"]>}>();
    for(const value of coverage){
      if(!isRecord(value)||!uuid(value.task_id)||!timestamp(value.version)||!uuid(value.absence_id)||!uuid(value.member_id)
        ||typeof value.member_name!=="string"||!value.member_name.trim()||value.member_name.length>50||!timestamp(value.expires_at)||released.has(value.task_id))
        throw new TaskError(503,"Task availability could not be loaded completely. Refresh before continuing.");
      released.set(value.task_id,{version:value.version,coverage:{absence_id:value.absence_id,member_id:value.member_id,member_name:value.member_name,expires_at:value.expires_at}});
    }
    const decorated=tasks.map(task=>{const entry=released.get(task.id),origin=origins.get(task.id);return decodeRow({...withCompletionName(task,names),coverage:entry&&entry.version===task.updated_at?entry.coverage:null,claim_origin:origin?.version===task.updated_at?origin.origin:null});});
    const versions=new Map<string,string>();
    for(const task of tasks) if(task.series_id && (!versions.has(task.series_id) || task.updated_at>versions.get(task.series_id)!)) versions.set(task.series_id,task.updated_at);
    return {timezone,specialMeetings:special.meetings,serverNow:special.serverNow,tasks:decorated.map(task=>this.decorateSpecial({...task,series_version:task.series_id?versions.get(task.series_id):task.updated_at},special)),categories};
  }
  async mutate(input: TaskAction): Promise<Record<string,unknown>> {
    if(input.action==="special_lock"){
      const {error}=await this.client.rpc("task_app_set_special_locked",{meeting_id:input.id,expected_version:input.version,locked:input.locked,confirmed:true});check(error);
      return {dataset:await this.read()};
    }
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
      const special=await this.specialState();const tasks=data.map(value=>this.decorateSpecial(decodeRow(value),special));return input.action==="create"?{task:tasks[0]}:{tasks};
    }
    if(input.action==="missed"){
      const {data,error}=await this.client.rpc("task_app_complete_missed",{task_id:input.id,expected_version:input.version,confirmed:true});check(error);
      const task=decodeRow(data);
      if(task.id!==input.id || !task.missed_completion_role || task.status!=="completed")throw new TaskError(503,"Missed completion could not be confirmed. Refresh before trying again.");
      return {task:await this.withOrigin(task)};
    }
    if(input.action==="take"){
      const {data,error}=await this.client.rpc("task_app_take_task",{task_id:input.id,expected_version:input.version,absence_id:input.absenceId,confirmed:input.confirmed});check(error);
      const task=decodeRow(data);
      if(task.id!==input.id)throw new TaskError(503,"Taking this task could not be confirmed. Refresh before trying again.");
      return {task:await this.withOrigin(task)};
    }
    // Permanent reassignment is one transaction, independent of repeat-edit scope.
    // Older clients and occurrence-only saves retain the existing mutation path.
    const permanent=input.action==="update" && input.assignmentScope==="future";
    const {data,error} = await this.client.rpc(input.action==="update"&&input.specialStart?"task_app_reschedule_special_task":permanent?(input.action==="update"&&input.fields.special_days!==undefined?"task_app_reassign_special":"task_app_reassign_permanently"):"task_app_mutate",{
      ...(input.action==="update"&&input.specialStart?{meeting_date:input.specialStart.date,meeting_version:input.specialStart.version,confirmed:true,assignment_future:permanent}:{}),
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
      return {task:await this.withOrigin(decodeRow(data)),...(input.action==="update"&&input.specialStart?{dataset:await this.read()}:{})};
    }
    const current = await this.client.from("tasks").select(TASK_COLUMNS).eq("id",input.id).eq("owner_id",this.owner).is("deleted_at",null).maybeSingle();
    check(current.error);
    if (!current.data) throw new TaskError(404,"This task is no longer available. Your draft has been kept.");
    throw new TaskError(409,input.action === "delete" ? "This task changed elsewhere. Review the saved version before deleting it." : "This task or a future occurrence changed elsewhere. Review saved tasks before saving your draft.",await this.withOrigin(decodeRow({...current.data,...(data?.series_version?{series_version:data.series_version}:{})})),await this.pages("categories",decodeCategory),Array.isArray(data?.future)?data.future.map(decodeRow):undefined);
  }
}
