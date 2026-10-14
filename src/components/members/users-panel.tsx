"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { MEMBER_LIMIT, memberSeen, memberActive, roleLabel, decodeMemberResponse, type MemberState, type Member, type Invitation } from "@/lib/members/model";
import { activeAbsences } from "@/lib/members/absence";
import { requestWorkspace } from "@/lib/workspace/client";
import { isRecord } from "@/lib/tasks/validation";
import type { WorkspaceAction } from "@/lib/workspace/model";
import styles from "./users.module.css";
type DialogState={kind:"invite";invitation?:Invitation}|{kind:"role";member:Member;role:"member"|"coordinator"}|{kind:"transfer"}|{kind:"revoke";invitation:Invitation};
function SmallIcon({name}:{name:"refresh"|"lock"}){return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{name==="lock"?<><rect x="6" y="10" width="12" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>:<><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/></>}</svg>;}
function UsersIcon(){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/></svg>;}
export default function UsersPanel({state,search,loading,error,onRefresh,onSaved,now}:{state:MemberState|null;search:string;loading:boolean;error:string;onRefresh:()=>void;onSaved:(state:MemberState)=>void;now:Date}){
 const [dialog,setDialog]=useState<DialogState|null>(null);const [pending,setPending]=useState(false);const [problem,setProblem]=useState("");const [email,setEmail]=useState("");const [role,setRole]=useState<"member"|"coordinator">("member");const [recipient,setRecipient]=useState("");const [link,setLink]=useState("");const [copied,setCopied]=useState(false);const busy=useRef(false);const modal=useRef<HTMLDialogElement>(null);const trigger=useRef<HTMLElement|null>(null);
 const owner=state?.current?.role==="owner";
 const members=state?[...state.members].sort((a,b)=>Number(b.id===state.current?.id)-Number(a.id===state.current?.id)):[];
 const visible=members.filter(m=>m.name.toLowerCase().includes(search.trim().toLowerCase()));
 const absentMembers=activeAbsences(state,now).map(a=>({...a,name:members.find(m=>m.id===a.memberId)?.name??"Member"})).filter(a=>a.name.toLowerCase().includes(search.trim().toLowerCase()));
 const reserved=state?.workspace?.reservedSeats??0;const used=members.length+reserved;
 useEffect(()=>{if(!dialog)return;modal.current?.showModal();modal.current?.querySelector<HTMLElement>("input,select,button")?.focus();return()=>modal.current?.close();},[dialog]);
 useEffect(()=>{if(!owner&&!pending&&dialog){setDialog(null);setLink("");setProblem("Your role changed. Refresh to see current permissions.");}},[owner,pending,dialog]);
 function open(next:DialogState){if(!owner||busy.current)return;trigger.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setProblem("");setLink("");setCopied(false);setEmail(next.kind==="invite"?next.invitation?.email??"":"");setRole(next.kind==="invite"?next.invitation?.role??"member":"member");setRecipient("");setDialog(next);}
 function close(){if(busy.current)return;setDialog(null);setLink("");setProblem("");requestAnimationFrame(()=>trigger.current?.isConnected&&trigger.current.focus());}
 async function submit(event:FormEvent){
  event.preventDefault();if(!dialog||busy.current||!owner)return;
  let action:WorkspaceAction;
  if(dialog.kind==="invite")action={action:"invite",email:email.trim(),role,...(dialog.invitation?{replaceId:dialog.invitation.id}:{})};
  else if(dialog.kind==="role")action={action:"role",id:dialog.member.id,previousRole:dialog.member.role??"member",role:dialog.role,confirmed:true};
  else if(dialog.kind==="revoke")action={action:"revoke",id:dialog.invitation.id,confirmed:true};
  else {if(!recipient){setProblem("Choose the member who will become Owner.");return;}action={action:"transfer",id:recipient,confirmed:true};}
  busy.current=true;setPending(true);setProblem("");
  try{
   const result=await requestWorkspace(action);
   if(action.action==="invite"){
    if(!isRecord(result)||typeof result.token!=="string"||!/^[a-f0-9]{64}$/.test(result.token))throw new Error("Invitation could not be confirmed. Refresh before retrying.");
    setLink(typeof result.invitationUrl==="string"?result.invitationUrl:`${window.location.origin}/invite#${result.token}`);onRefresh();
   }else{onSaved(decodeMemberResponse(result));setDialog(null);requestAnimationFrame(()=>trigger.current?.isConnected&&trigger.current.focus());}
  }catch(reason){setProblem(reason instanceof Error?reason.message:"Workspace update could not be confirmed.");}
  finally{busy.current=false;setPending(false);}
 }
 return <section className={styles.panel} aria-label="Workspace users" aria-busy={loading||pending}>
  <div className={styles.workspace}><span className={styles.workspaceDot}/><strong>{state?.workspace?.name??"Workspace"}</strong><span className={styles.capacity}>{members.length} of {MEMBER_LIMIT} members{reserved>0&&<small> · {reserved} reserved</small>}</span></div>
  {owner&&<button className={`${styles.gold} ${styles.mobileInvite}`} disabled={loading||pending||used>=MEMBER_LIMIT} onClick={()=>open({kind:"invite"})}><span aria-hidden="true">＋</span>Invite member</button>}
  <section className={styles.teamCard} aria-label="Team members">
  <div className={styles.top}><div><h2>Team members</h2><p><span className={styles.onlineDot}/>{members.filter(m=>memberActive(m,now)).length} active now</p></div><div className={styles.topActions}><button className={styles.refresh} aria-label={loading?"Refreshing members":"Refresh members"} title="Refresh members" disabled={loading||pending} onClick={onRefresh}><SmallIcon name="refresh"/></button>{owner&&<button className={`${styles.gold} ${styles.desktopInvite}`} disabled={loading||pending||used>=MEMBER_LIMIT} onClick={()=>open({kind:"invite"})}><span aria-hidden="true">＋</span>Invite member</button>}</div></div>
  {(error||(!dialog&&problem))&&<p className={styles.error} role="alert">{error||problem}</p>}
  {!state&&loading&&<p role="status">Loading workspace members…</p>}
  <div className={styles.tableHead} aria-hidden="true"><span>Member</span><span>Role</span><span>Status</span></div>
  <ul className={styles.list}>{visible.map(member=><li key={member.id}><div className={styles.identity}><span className={`${styles.avatar} ${member.id===state?.current?.id?styles.ownAvatar:""}`} aria-hidden="true">{Array.from(member.name)[0]?.toLocaleUpperCase()}</span><strong>{member.name}{member.id===state?.current?.id&&<small className={styles.you}>You</small>}</strong></div><div className={styles.memberRole}>{owner&&member.role!=="owner"?<select className={styles.roleSelect} aria-label={`Role for ${member.name}`} value={member.role??"member"} disabled={pending||loading} onChange={e=>open({kind:"role",member,role:e.target.value as "member"|"coordinator"})}><option value="member">Member</option><option value="coordinator">Coordinator</option></select>:<span className={`${styles.role} ${member.role==="owner"?styles.owner:""}`}>{roleLabel(member.role)}</span>}</div><div className={`${styles.memberStatus} ${memberActive(member,now)?styles.online:""}`}><span className={memberActive(member,now)?styles.onlineDot:styles.offlineDot}/>{memberActive(member,now)?<span>Active now</span>:<time dateTime={member.lastSeenAt}>{memberSeen(member.lastSeenAt,now)}</time>}</div></li>)}</ul>
  {state&&!visible.length&&<div className={styles.empty}><UsersIcon/><h3>No members found</h3><p>Try another name.</p></div>}
  <footer className={styles.footer}><p><SmallIcon name="lock"/>Only the Owner can manage members and roles.</p><p>Names appear on completed tasks.</p></footer>
  </section>
  {!!absentMembers.length&&<section className={styles.absentCard} aria-label="Absent members"><div className={styles.absentHeading}><h2>Absent members</h2><span>{new Set(absentMembers.map(a=>a.memberId)).size}</span></div><ul>{absentMembers.map(a=><li key={a.id}><span className={styles.absentAvatar} aria-hidden="true">{Array.from(a.name)[0]?.toLocaleUpperCase()}</span><div><strong>{a.name}</strong><p>{a.category}</p></div><span className={styles.absentLabel}>Absent</span></li>)}</ul></section>}
  {owner&&!!state?.invitations?.length&&<section className={styles.pending}><h3>Pending invitations</h3><p>Reserved places · Expire seven days after creation</p>{state.invitations.map(invitation=><div key={invitation.id}><span><strong>{invitation.email}</strong><small>{roleLabel(invitation.role)} · Expires {new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short"}).format(new Date(invitation.expiresAt))}</small></span><button disabled={pending} className={styles.secondary} onClick={()=>open({kind:"invite",invitation})}>New link</button><button disabled={pending} className={styles.cancelInvite} onClick={()=>open({kind:"revoke",invitation})}>Cancel</button></div>)}</section>}
  {owner&&members.length>1&&<button className={styles.transfer} disabled={pending} onClick={()=>open({kind:"transfer"})}>Transfer ownership</button>}
  {dialog&&<dialog ref={modal} className={styles.dialog} aria-labelledby="workspace-dialog-title" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}><form onSubmit={submit}>
   <h2 id="workspace-dialog-title">{dialog.kind==="invite"?(link?"Invitation ready":dialog.invitation?"Create a new invitation link":"Invite member"):dialog.kind==="role"?"Change member role?":dialog.kind==="transfer"?"Transfer ownership?":"Cancel invitation?"}</h2>
   {dialog.kind==="invite"?link?<><p>Share this link privately with the invited person. They must sign in with <strong>{email}</strong> and verify that email. It expires in seven days.</p><label>Invitation link<input aria-label="Invitation link" value={link} readOnly onFocus={e=>e.target.select()}/></label><button type="button" className={styles.gold} onClick={()=>{void navigator.clipboard.writeText(link).then(()=>setCopied(true)).catch(()=>setProblem("Select and copy the invitation link."));}}>{copied?"Copied":"Copy link"}</button><p>No invitation email has been sent.</p></>:<><label>Email address<input type="email" autoComplete="off" maxLength={254} required value={email} disabled={pending||!!dialog.invitation} onChange={e=>setEmail(e.target.value)}/></label><label>Role<select value={role} disabled={pending} onChange={e=>setRole(e.target.value as "member"|"coordinator")}><option value="member">Member</option><option value="coordinator">Coordinator</option></select></label><p>Reserves one of ten places for seven days. {dialog.invitation?"The previous link will stop working.":"Members can complete and reopen only their own assigned tasks."}</p></>:dialog.kind==="role"?<p>Change <strong>{dialog.member.name}</strong> from {roleLabel(dialog.member.role)} to <strong>{roleLabel(dialog.role)}</strong>? Their permissions update on every device. Completing and reopening still require assignment.</p>:dialog.kind==="transfer"?<><p>The chosen member becomes Owner. You stay in this workspace as Coordinator and lose member and role management.</p><label>New Owner<select required value={recipient} disabled={pending} onChange={e=>setRecipient(e.target.value)}><option value="">Choose a member</option>{members.filter(m=>m.id!==state?.current?.id).map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label><p>Tasks, assignments and history stay saved.</p></>:<p>Cancel the invitation for <strong>{dialog.invitation.email}</strong>? Its reserved place will become available.</p>}
   {problem&&<p className={styles.error} role="alert">{problem}</p>}
   <div className={styles.dialogActions}><button type="button" className={styles.secondary} disabled={pending} onClick={close}>{link?"Done":"Cancel"}</button>{!link&&<button className={styles.gold} disabled={pending}>{pending?"Saving…":dialog.kind==="invite"?"Create invitation":dialog.kind==="transfer"?"Transfer ownership":dialog.kind==="role"?"Confirm change":"Cancel invitation"}</button>}</div>
  </form></dialog>}
 </section>;
}
