"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {decodeFines,type FineAction,type FinesData} from "./model";
import {isRecord} from "@/lib/tasks/validation";
export function useFines(enabled:boolean,blocked:boolean){
 const[data,setData]=useState<FinesData|null>(null),[loading,setLoading]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(""),[expired,setExpired]=useState(false),[forbidden,setForbidden]=useState(false),[deferred,setDeferred]=useState(false);
 const live=useRef(true),sequence=useRef(0),read=useRef<AbortController|null>(null),state=useRef({blocked,pending,enabled});state.current={blocked,pending,enabled};
 const refresh=useCallback(async(background=false)=>{
  if(!enabled)return;if(state.current.blocked||state.current.pending){setDeferred(true);return;}
  read.current?.abort();const controller=new AbortController();read.current=controller;const seq=++sequence.current;if(!background)setLoading(true);setError("");setDeferred(false);
  try{const response=await fetch('/api/fines',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});const body:unknown=await response.json();if(!response.ok){if(response.status===401)setExpired(true);if(response.status===403){setData(null);setForbidden(true);}throw Error(isRecord(body)&&typeof body.message==='string'?body.message:'Fines could not be loaded.');}const next=decodeFines(body);if(live.current&&seq===sequence.current){setData(next);setExpired(false);setForbidden(false);}}
  catch(reason){if(live.current&&seq===sequence.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Unable to connect. Refresh to try again.');}
  finally{if(live.current&&seq===sequence.current){setLoading(false);read.current=null;}}
 },[enabled]);
 useEffect(()=>{live.current=true;if(enabled)void refresh();else{setData(null);read.current?.abort();sequence.current++;setLoading(false);}return()=>{live.current=false;read.current?.abort();sequence.current++;};},[enabled,refresh]);
 useEffect(()=>{if(blocked&&read.current){read.current.abort();read.current=null;sequence.current++;setLoading(false);setDeferred(true);}if(deferred&&!blocked&&!pending)void refresh(true);},[blocked,deferred,pending,refresh]);
 const mutate=useCallback(async(action:FineAction)=>{
  if(!state.current.enabled||state.current.pending )throw Error('Finish the current action first.');state.current.pending=true;setPending(true);read.current?.abort();sequence.current++;
  try{const response=await fetch('/api/fines',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action),signal:AbortSignal.timeout(20000)});const body:unknown=await response.json();if(!response.ok){if(response.status===401)setExpired(true);if(response.status===403){setForbidden(true);setData(null);}throw Error(isRecord(body)&&typeof body.message==='string'?body.message:'We couldn’t confirm this fine action. Refresh before trying again.');}if(!isRecord(body)||body.id!==action.id||body.status!==action.action)throw Error('We couldn’t confirm this fine action. Refresh before trying again.');const next=decodeFines(body.data);setData(next);setDeferred(false);}
  catch(reason){setDeferred(true);throw reason;}
  finally{state.current.pending=false;setPending(false);}
 },[]);
 return{data,loading,pending,error,expired,forbidden,deferred,refresh,mutate};
}
