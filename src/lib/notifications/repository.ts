import type {SupabaseClient}from'@supabase/supabase-js';
import {TaskError}from'@/lib/tasks/repository';
import {isRecord,timestamp,uuid}from'@/lib/tasks/validation';
import {decodeNotifications,clearSnapshot,type NotificationAction}from'./model';
function check(error:{code?:string}|null){if(!error)return;if(error.code==='P0403')throw new TaskError(403,'Only the affected member or recorded completer can perform this action.');if(error.code==='P0409')throw new TaskError(409,'This message, request or task changed. Close and refresh before trying again.');if(error.code==='23514')throw new TaskError(400,'Check the details and confirm this action.');if(['42501','PGRST301','PGRST302'].includes(error.code??''))throw new TaskError(401,'Your session has ended. Sign in again.');if(error.code==='P0013')throw new TaskError(503,'Your inbox has reached its loading limit. Use Clear all to permanently remove old messages.');throw new TaskError(503,'We couldn’t confirm this request. Refresh to check saved messages before trying again.');}
export class NotificationsRepository{
 constructor(private client:SupabaseClient){}
 async read(){const{data,error}=await this.client.rpc('task_app_notifications');check(error);return decodeNotifications(data);}
 async mutate(a:NotificationAction):Promise<Record<string,unknown>>{
  let name:string,args:Record<string,unknown>;
  switch(a.action){
   case 'preview_clear':name='task_app_notification_snapshot';args={};break;
   case 'read':name='task_app_read_notifications';args={ids:a.ids};break;
   case 'preferences':name='task_app_save_notification_preferences';args={availability:a.preferences.availability,coverage_updates:a.preferences.coverageUpdates,reassignments:a.preferences.reassignments};break;
   case 'clear':name='task_app_clear_notifications';args={expected_count:a.count,expected_snapshot:a.snapshot,confirmed:true};break;
   case 'request':name='task_app_request_reopening';args={task_id:a.taskId,completed_at:a.completedAt,reason:a.reason,confirmed:true};break;
   case 'review':name='task_app_review_reopening';args={request_id:a.id,expected_version:a.version,decision:a.decision,confirmed:true};break;
  }
  const{data,error}=await this.client.rpc(name,args);check(error);
  if(a.action==='preview_clear')return clearSnapshot(data);
  if(a.action==='preferences')return {saved:true};
  if(!isRecord(data))throw new TaskError(503,'Incomplete confirmation. Close and refresh before trying again.');
  if(a.action==='clear'&&data.deleted===a.count)return {deleted:data.deleted};
  if(a.action==='read'&&Array.isArray(data.marked)&&data.marked.length===a.ids.length&&new Set(data.marked.map(x=>isRecord(x)?x.id:null)).size===a.ids.length&&data.marked.every(x=>isRecord(x)&&uuid(x.id)&&a.ids.includes(x.id)&&timestamp(x.readAt)))return {marked:data.marked};
  if((a.action==='request'||a.action==='review')&&uuid(data.id)&&['pending','approved','declined','unavailable'].includes(data.status as string)&&(a.action!=='review'||data.id===a.id&&data.status===a.decision))return {id:data.id,status:data.status};
  throw new TaskError(503,'Incomplete confirmation. Close and refresh before trying again.');
 }
}
