"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {isRecord} from "@/lib/tasks/validation";
import {decodeMemberHistory,type MemberHistoryData} from "./model";
export function useMemberHistory(enabled:boolean,blocked:boolean){
  const [data,setData]=useState<MemberHistoryData|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const [expired,setExpired]=useState(false),[deferred,setDeferred]=useState(false),[clockOffset,setClockOffset]=useState(0);
  const state=useRef({blocked});state.current.blocked=blocked;
  const controller=useRef<AbortController|null>(null),sequence=useRef(0),alive=useRef(true);
  const refresh=useCallback(async(background=false)=>{
    if(!enabled)return;if(state.current.blocked){setDeferred(true);return;}
    controller.current?.abort();const read=new AbortController();controller.current=read;const seq=++sequence.current;
    if(!background)setLoading(true);setError("");setDeferred(false);
    try{
      const response=await fetch("/api/member-history",{cache:"no-store",signal:AbortSignal.any([read.signal,AbortSignal.timeout(15000)])});const body:unknown=await response.json();
      if(!response.ok){if(response.status===401)setExpired(true);throw Error(isRecord(body)&&typeof body.message==="string"?body.message:"Unable to load member history.");}
      const next=decodeMemberHistory(body);
      if(alive.current&&seq===sequence.current){setData(next);setClockOffset(Date.parse(next.serverNow)-Date.now());setExpired(false);}
    }catch(reason){if(alive.current&&seq===sequence.current&&!read.signal.aborted)setError(reason instanceof Error?reason.message:"Unable to connect. Refresh to try again.");}
    finally{if(alive.current&&seq===sequence.current){setLoading(false);controller.current=null;}}
  },[enabled]);
  useEffect(()=>{alive.current=true;if(enabled)void refresh();return()=>{alive.current=false;controller.current?.abort();sequence.current++;};},[enabled,refresh]);
  useEffect(()=>{if(blocked&&controller.current){controller.current.abort();controller.current=null;sequence.current++;setLoading(false);setDeferred(true);}if(deferred&&!blocked)void refresh(true);},[blocked,deferred,refresh]);
  return {data,loading,error,expired,clockOffset,refresh};
}
