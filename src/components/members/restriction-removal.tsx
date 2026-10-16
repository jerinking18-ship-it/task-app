"use client";
import {useEffect,useRef,useState} from "react";
import type {Absence} from "@/lib/members/absence";
import {decodeMemberResponse,type MemberState} from "@/lib/members/model";
import {requestWorkspace} from "@/lib/workspace/client";
import modal from "../task-app.module.css";
import styles from "./attendance-page.module.css";
function Unlock({size=14}:{size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 7.5-2"/></svg>;}
export default function RestrictionRemoval({absence,name,meeting,now,disabled,onSaved,onPending}:{absence:Absence;name:string;meeting:string;now:Date;disabled:boolean;onSaved:(state:MemberState)=>void;onPending:(pending:boolean)=>void}){
 const [open,setOpen]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState("");
 const busy=useRef(false),dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const expired=Date.parse(absence.expiresAt)<=now.getTime();
 useEffect(()=>{if(!open)return;const el=dialog.current;el?.showModal();el?.querySelector<HTMLButtonElement>("button")?.focus();return()=>{el?.close();requestAnimationFrame(()=>trigger.current?.isConnected&&trigger.current.focus());};},[open]);
 function close(){if(!busy.current){setOpen(false);setError("");}}
 async function remove(){
  if(busy.current||disabled||expired||!absence.restrictionRole)return;
  busy.current=true;setPending(true);onPending(true);setError("");
  try{
   const next=decodeMemberResponse(await requestWorkspace({action:"removeRestriction",id:absence.id,expiresAt:absence.expiresAt,confirmed:true}));
   if(!next.current||next.absences===undefined||next.absences.some(a=>a.id===absence.id))throw new Error("Removal could not be confirmed. Close and refresh Attendance before retrying.");
   onSaved(next);setOpen(false);
  }catch(reason){setError(reason instanceof Error?reason.message:"Removal could not be confirmed. Refresh before retrying.");}
  finally{busy.current=false;setPending(false);onPending(false);}
 }
 return <><button ref={trigger} type="button" className={styles.removeRestriction} disabled={disabled||expired||pending} onClick={()=>{setError("");setOpen(true);}}><Unlock/>Remove restriction</button>
 {open&&<dialog ref={dialog} className={`${modal.dialog} ${modal.confirmDialog}`} aria-label="Remove restriction?" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}><div className={`${modal.confirmContent} ${modal.missedConfirmation}`}><div className={styles.unlockIcon}><Unlock size={34}/></div><h2>Remove restriction?</h2><p>{name} can complete their remaining {meeting} tasks again and will leave the absent list for this service.</p><p className={styles.keepFine}>Existing fines will stay unchanged.</p>{(error||expired)&&<p className={modal.error} role="alert">{expired?"This restriction has expired. Close and refresh Attendance.":error}</p>}<div className={modal.editorActions}><button className={modal.cancelButton} disabled={pending} onClick={close}>Cancel</button><button className={styles.removeConfirm} disabled={disabled||pending||expired||!!error} onClick={()=>void remove()}>{pending?"Removing…":"Remove restriction"}</button></div></div></dialog>}</>;
}
