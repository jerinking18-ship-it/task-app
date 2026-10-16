'use client';
import {useCallback,useEffect,useRef,useState}from'react';
import {isRecord}from'@/lib/tasks/validation';
import {activityParams,decodeActivity,defaultActivityFilter,type ActivityData,type ActivityFilter}from'./model';
export function useActivity(enabled:boolean,blocked:boolean){
 const[filter,setFilter]=useState<ActivityFilter>(defaultActivityFilter),[data,setData]=useState<ActivityData|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[forbidden,setForbidden]=useState(false),[expired,setExpired]=useState(false);
 const state=useRef({enabled,blocked,filter,data});state.current={enabled,blocked,filter,data};const controller=useRef<AbortController|null>(null),sequence=useRef(0);
 const refresh=useCallback(async(more=false,background=false)=>{
  const current=state.current;if(!current.enabled||current.blocked)return;
  controller.current?.abort();const abort=new AbortController();controller.current=abort;const seq=++sequence.current;
  setLoading(true);if(!background)setError('');
  try{
   const last=more?current.data?.entries.at(-1):undefined;
   const response=await fetch(`/api/activity-log?${activityParams(current.filter,last)}`,{cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(15000)])});
   const body:unknown=await response.json();if(seq!==sequence.current)return;if(!response.ok){if(response.status===401)setExpired(true);if(response.status===403){setForbidden(true);setData(null);}throw Error(isRecord(body)&&typeof body.message==='string'?body.message:'Activity unavailable.');}
   const next=decodeActivity(body);if(seq===sequence.current){setForbidden(false);setExpired(false);setError('');setData(previous=>more&&previous?{...next,entries:[...previous.entries,...next.entries.filter(e=>!previous.entries.some(p=>p.id===e.id))]}:next);}
  }catch(reason){if(seq===sequence.current&&!abort.signal.aborted)setError(reason instanceof Error?reason.message:'Activity unavailable.');}
  finally{if(seq===sequence.current){setLoading(false);controller.current=null;}}
 },[]);
 useEffect(()=>{controller.current?.abort();sequence.current++;setData(null);setError('');setLoading(false);return()=>{controller.current?.abort();sequence.current++;};},[enabled,filter,refresh]); // Filter changes replace pages, never mix scopes.
 useEffect(()=>{if(blocked){controller.current?.abort();sequence.current++;setLoading(false);}else if(enabled)void refresh(false,true);},[enabled,blocked,filter,refresh]);
 return{filter,setFilter,data,loading,error,forbidden,expired,refresh};
}
