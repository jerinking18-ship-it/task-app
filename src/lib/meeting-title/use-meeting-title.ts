"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {isRecord} from "@/lib/tasks/validation";
import {decodeMeetingTitle,MeetingTitleError,type MeetingTitle} from "./model";
export function useMeetingTitle(enabled:boolean,blocked:boolean){
  const[data,setData]=useState<MeetingTitle|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false);
  const state=useRef({blocked,pending:false,queued:false,alive:true,revision:0});state.current.blocked=blocked;
  const read=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    if(!enabled)return;
    if(state.current.blocked||state.current.pending){state.current.queued=true;return;}
    state.current.queued=false;read.current?.abort();const controller=new AbortController();read.current=controller;const revision=++state.current.revision;
    try{const response=await fetch("/api/meeting-title",{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])});const body:unknown=await response.json();if(!response.ok)throw new Error(isRecord(body)&&typeof body.message==="string"?body.message:"Meeting title unavailable.");const next=decodeMeetingTitle(body);if(state.current.alive&&revision===state.current.revision){setData(next);setError("");}}
    catch(e){if(state.current.alive&&revision===state.current.revision&&!controller.signal.aborted)setError(e instanceof Error?e.message:"Meeting title unavailable.");}
  },[enabled]);
  useEffect(()=>{state.current.alive=true;void refresh();return()=>{state.current.alive=false;read.current?.abort();state.current.revision++;};},[refresh]);
  useEffect(()=>{if(blocked&&read.current){read.current.abort();state.current.revision++;state.current.queued=true;}if(!blocked&&!pending&&state.current.queued)void refresh();},[blocked,pending,refresh]);
  async function save(title:string,version:string|null){
    if(!enabled||state.current.pending)throw new MeetingTitleError("Wait for the current save.");
    read.current?.abort();state.current.revision++;state.current.pending=true;setPending(true);
    try{const response=await fetch("/api/meeting-title",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({title,version}),signal:AbortSignal.timeout(20000)});const body:unknown=await response.json();if(!response.ok)throw new MeetingTitleError(isRecord(body)&&typeof body.message==="string"?body.message:"Meeting title could not be saved.",response.status,isRecord(body)&&body.latest?decodeMeetingTitle(body.latest):undefined);const next=decodeMeetingTitle(body);if(state.current.alive){setData(next);setError("");}return next;}
    catch(e){throw e instanceof MeetingTitleError?e:new MeetingTitleError("Saving could not be confirmed. Your draft is kept; refresh before retrying.");}
    finally{state.current.pending=false;if(state.current.alive)setPending(false);}
  }
  return {data,error,pending,refresh,save};
}
