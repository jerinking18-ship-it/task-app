import { isRecord, uuid } from "@/lib/tasks/validation";
import { memberName, type MemberRole } from "@/lib/members/model";
export type WorkspaceAction =
 | {action:"invite";email:string;role:"member"|"coordinator";replaceId?:string}
 | {action:"accept";token:string;name:string}
 | {action:"revoke";id:string;confirmed:true}
 | {action:"role";id:string;previousRole:MemberRole;role:"member"|"coordinator";confirmed:true}
 | {action:"transfer";id:string;confirmed:true};
export function workspaceAction(value:unknown):WorkspaceAction|null {
 if(!isRecord(value))return null;
 const only=(keys:string[])=>Object.keys(value).every(key=>keys.includes(key));
 const role=value.role==="member"||value.role==="coordinator";
 if(value.action==="invite"&&only(["action","email","role","replaceId"])&&typeof value.email==="string"&&value.email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)&&role&&(value.replaceId===undefined||uuid(value.replaceId)))return value as WorkspaceAction;
 if(value.action==="accept"&&only(["action","token","name"])&&typeof value.token==="string"&&/^[a-f0-9]{64}$/.test(value.token)&&memberName(value.name))return {...value,name:memberName(value.name)!} as WorkspaceAction;
 if(value.confirmed!==true||!uuid(value.id))return null;
 if((value.action==="revoke"||value.action==="transfer")&&only(["action","id","confirmed"]))return value as WorkspaceAction;
 if(value.action==="role"&&only(["action","id","previousRole","role","confirmed"])&&role&&["member","coordinator"].includes(value.previousRole as string))return value as WorkspaceAction;
 return null;
}
export function workspaceRpc(action:WorkspaceAction):{name:string;args:Record<string,unknown>} {
 switch(action.action){
 case "invite":return {name:"task_app_invite",args:{invited_email:action.email,invited_role:action.role,replace_invitation:action.replaceId??null}};
 case "accept":return {name:"task_app_accept_invitation",args:{invitation_token:action.token,member_name:action.name}};
 case "revoke":return {name:"task_app_revoke_invitation",args:{invitation_id:action.id}};
 case "role":return {name:"task_app_change_role",args:{member_id:action.id,previous_role:action.previousRole,new_role:action.role,confirmed:true}};
 case "transfer":return {name:"task_app_transfer_owner",args:{member_id:action.id,confirmed:true}};
 }
}
