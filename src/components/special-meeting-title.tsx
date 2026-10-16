"use client";
import {useEffect,useState,type ReactNode,type FormEvent} from "react";
import CapitalizedInput from "./capitalized-input";
import {MeetingTitleError,meetingName,type MeetingTitle} from "@/lib/meeting-title/model";
import heading from "./assigned-meeting-heading.module.css";
import app from "./task-app.module.css";
import styles from "./special-meeting-title.module.css";
function Calendar({size=21}:{size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 11h18"/></svg>;}
export function SpecialMeetingHeading({value,editable,disabled,error,onEdit,onRefresh,lock}:{lock?:ReactNode;value:MeetingTitle|null;editable:boolean;disabled:boolean;error:string;onEdit:()=>void;onRefresh:()=>void}){
  return <><section className={heading.card} aria-label="Special Meeting title"><span className={heading.calendar}><Calendar/></span><div className={heading.details}><p>SPECIAL MEETING</p><h2>{meetingName(value)}</h2></div>{editable&&<button type="button" className={styles.edit} aria-label="Edit meeting title" title="Edit meeting title" disabled={disabled||!value||!!error} onClick={onEdit}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m16 3 5 5M4 20l4-1 13-13a2.1 2.1 0 0 0-3-3L5 16l-1 4Z"/></svg></button>}{lock}</section>{error&&<div className={app.inlineError} role="alert"><p>{error}</p><button type="button" disabled={disabled} onClick={onRefresh}>Refresh meeting title</button></div>}</>;
}
export function SpecialMeetingLabel({title}:{title:string|null|undefined}){
  return title?<span className={styles.label}><Calendar/>{title}</span>:null;
}
export function SpecialMeetingTitleField({title,label="Meeting title"}:{title:string;label?:string}){
  return <label className={app.property}><span><Calendar size={14}/>{label}</span><input aria-label={label} value={title} readOnly/></label>;
}
export function SpecialMeetingTitleForm({value,pending,onSave,onClose,onDirty}:{value:MeetingTitle;pending:boolean;onSave:(title:string,version:string|null)=>Promise<unknown>;onClose:()=>void;onDirty:(dirty:boolean)=>void}){
  const[draft,setDraft]=useState(value.title??""),[version,setVersion]=useState(value.version),[error,setError]=useState(""),[latest,setLatest]=useState<MeetingTitle|null>(null);
  useEffect(()=>{onDirty(draft!==(value.title??""));},[draft,value.title,onDirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  async function submit(event:FormEvent){event.preventDefault();if(pending||latest)return;setError("");try{await onSave(draft.trim(),version);onClose();}catch(e){setError(e instanceof Error?e.message:"The meeting title could not be saved.");if(e instanceof MeetingTitleError&&e.latest)setLatest(e.latest);}}
  return <form className={app.confirmContent} onSubmit={event=>void submit(event)}><p className={app.editorEyebrow}>SPECIAL MEETING</p><h2>Edit meeting title</h2><label className={styles.field}><span>Meeting title</span><CapitalizedInput value={draft} onValueChange={setDraft} placeholder="Special Meeting" maxLength={60} data-autofocus="true" disabled={pending}/></label><p className={app.editorHint}>This title appears on Special Meeting tasks.</p>{error&&<p role="alert" className={app.error}>{error}</p>}{latest&&<div className={styles.conflict}><p>Saved title: <strong>{meetingName(latest)}</strong></p><button type="button" disabled={pending} className={app.cancelButton} onClick={()=>{setDraft(latest.title??"");setVersion(latest.version);setLatest(null);setError("");}}>Use saved title</button><button type="button" disabled={pending} className={app.cancelButton} onClick={()=>{setVersion(latest.version);setLatest(null);setError("Reviewed. Your draft is kept; save when ready.");}}>Keep my draft after review</button></div>}<div className={app.editorActions}><button type="button" className={app.cancelButton} disabled={pending} onClick={onClose}>Cancel</button><button type="submit" className={`${app.saveButton} ${app.reassignConfirm}`} disabled={pending||!!latest}>{pending?"Saving…":"Save title"}</button></div></form>;
}
