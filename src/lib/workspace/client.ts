import { isRecord } from "@/lib/tasks/validation";
import type { WorkspaceAction } from "./model";
export async function requestWorkspace(action:WorkspaceAction):Promise<unknown>{
 const response=await fetch("/api/workspace",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(action),cache:"no-store",signal:AbortSignal.timeout(20000)});
 const body:unknown=await response.json();
 if(!response.ok)throw new Error(isRecord(body)&&typeof body.message==="string"?body.message:"Workspace request could not be confirmed. Refresh before trying again.");
 return body;
}
