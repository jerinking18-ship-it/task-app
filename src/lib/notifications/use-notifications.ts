"use client";
import{useCallback,useEffect,useRef,useState}from'react';
import{isRecord,timestamp,uuid}from'@/lib/tasks/validation';
import{decodeNotifications,type NotificationAction,type NotificationsData}from'./model';
export function useNotifications(enabled:boolean,blocked:boolean){
 const[data,setData]=useState<NotificationsData|null>(null),[loading,setLoading]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState(''),[expired,setExpired]=useState(false),[deferred,setDeferred]=useState(false);
 const alive=useRef(true),read=useRef<AbortController|null>(null),sequence=useRef(0),state=useRef({enabled,blocked,pending});state.current={enabled,blocked,pending};
 const refresh=useCallback(async(background=false)=>{
  if(!state.current.enabled)return;if(state.current.blocked||state.current.pending){setDeferred(true);return;}
  read.current?.abort();const controller=new AbortController();read.current=controller;const seq=++sequence.current;if(!background)setLoading(true);setDeferred(false);setError('');
  try{const response=await fetch('/api/notifications',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});const body:unknown=await response.json();if(!response.ok){if(response.status===401)setExpired(true);throw Error(isRecord(body)&&typeof body.message==='string'?body.message:'Notifications could not be loaded.');}const next=decodeNotifications(body);if(alive.current&&seq===sequence.current){setData(next);setExpired(false);}}
  catch(reason){if(alive.current&&seq===sequence.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:'Notifications unavailable. Refresh to try again.');}
  finally{if(alive.current&&seq===sequence.current){setLoading(false);read.current=null;}}
 },[]);
 useEffect(()=>{alive.current=true;if(enabled)void refresh();else{read.current?.abort();sequence.current++;setData(null);setLoading(false);}return()=>{alive.current=false;read.current?.abort();sequence.current++;};},[enabled,refresh]);
 useEffect(()=>{if(blocked&&read.current){read.current.abort();sequence.current++;read.current=null;setLoading(false);setDeferred(true);}if(!blocked&&!pending&&deferred)void refresh(true);},[blocked,pending,deferred,refresh]);
 const mutate=useCallback(async(action:NotificationAction)=>{
  if(!state.current.enabled||state.current.pending)throw Error('Finish the current action first.');
  state.current.pending=true;setPending(true);read.current?.abort();sequence.current++;setLoading(false);
  try{
   const response=await fetch('/api/notifications',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action),signal:AbortSignal.timeout(20000)});const body:unknown=await response.json();
   if(!response.ok){if(response.status===401)setExpired(true);throw Error(isRecord(body)&&typeof body.message==='string'?body.message:'We couldn’t confirm this action. Close and refresh before trying again.');}
   if(!isRecord(body))throw Error('Incomplete notification confirmation. Refresh before trying again.');
   if(action.action==='read'){
    if(!Array.isArray(body.marked)||body.marked.length!==action.ids.length||!body.marked.every(x=>isRecord(x)&&uuid(x.id)&&action.ids.includes(x.id)&&timestamp(x.readAt))||new Set(body.marked.map(x=>isRecord(x)?x.id:null)).size!==action.ids.length)throw Error('Read status could not be confirmed.');
    const dates=new Map(body.marked.filter(isRecord).map(x=>[String(x.id),String(x.readAt)]));
    if(action.ids.some(id=>!dates.has(id)))throw Error('Read status could not be confirmed.');
    setData(current=>current?{...current,entries:current.entries.map(n=>dates.has(n.id)?{...n,readAt:dates.get(n.id)!}:n)}:current);
   }else if(action.action==='clear'){
    if(body.deleted!==action.count)throw Error('Clearing could not be confirmed. Refresh before trying again.');
    setData(current=>current?{...current,entries:[]}:current);
   }else if(action.action==='preferences'){
    if(body.saved!==true)throw Error('Preferences could not be confirmed.');setData(current=>current?{...current,preferences:action.preferences}:current);
   }
   if(action.action!=='read'&&action.action!=='preview_clear')setDeferred(true);
   return body;
  }catch(reason){if(action.action!=='preview_clear')setDeferred(true);throw reason;}
  finally{state.current.pending=false;if(alive.current)setPending(false);}
 },[]);
 return{data,loading,pending,error,expired,deferred,refresh,mutate};
}
