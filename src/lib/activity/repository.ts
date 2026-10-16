import type {SupabaseClient} from '@supabase/supabase-js';
import {TaskError} from '@/lib/tasks/repository';
import {decodeActivity,type ActivityFilter} from './model';
export class ActivityRepository{
 constructor(private client:SupabaseClient){}
 async read(filter:ActivityFilter,before:string|null,beforeId:string|null){
  const{data,error}=await this.client.rpc('task_app_activity',{p_member:filter.member||null,p_relation:filter.relation,p_meeting:filter.meeting||null,p_kind:filter.kind||null,p_since:filter.days==='all'?null:new Date(Date.now()-Number(filter.days)*86400000).toISOString(),p_before:before,p_before_id:beforeId});
  if(error){if(error.code==='P0403')throw new TaskError(403,'Activity is available to Owners and Coordinators only.');if(['42501','PGRST301','PGRST302'].includes(error.code??''))throw new TaskError(401,'Your session has ended. Sign in again.');throw new TaskError(503,'Activity is unavailable. Refresh to try again.');}
  try{return decodeActivity(data);}catch{throw new TaskError(503,'Activity could not be loaded completely. Refresh to try again.');}
 }
}
