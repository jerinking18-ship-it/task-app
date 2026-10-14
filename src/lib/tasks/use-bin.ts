"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeBinResponse, confirmBinItems, type BinAction, type BinTask, type BinTemplate, type BinEntry } from "./bin";
import { isRecord } from "./validation";
export function useBin(enabled: boolean, blocked: boolean) {
  const [tasks,setTasks]=useState<BinTask[]>([]);
  const [loaded,setLoaded]=useState(false);
  const [loading,setLoading]=useState(false);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [expired,setExpired]=useState(false);
  const [needsMember,setNeedsMember]=useState(false);
  const [templates,setTemplates]=useState<BinTemplate[]>([]);
  const state=useRef({blocked,pending:false}); state.current.blocked=blocked;
  const read=useRef<AbortController|null>(null); const sequence=useRef(0); const alive=useRef(true);
  const refresh=useCallback(async(background=false)=>{
    if(!enabled || state.current.blocked || state.current.pending) return;
    read.current?.abort(); const controller=new AbortController(); read.current=controller;
    const seq=++sequence.current; if(!background)setLoading(true);setError("");
    try {
      const response=await fetch('/api/bin',{cache:'no-store',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const body:unknown=await response.json();
      if(!response.ok){if(response.status===401)setExpired(true);if(response.status===403)setNeedsMember(true);throw Error(isRecord(body)&&typeof body.message==='string'?body.message:'Unable to load Bin.');}
      const next=decodeBinResponse(body);
      if(alive.current && seq===sequence.current){setTasks(next.tasks);setTemplates(next.templates);setLoaded(true);setExpired(false);setNeedsMember(false);}
    } catch(reason){if(alive.current && seq===sequence.current && !controller.signal.aborted)setError(reason instanceof Error?reason.message:'Unable to load Bin.');}
    finally{if(alive.current && seq===sequence.current){setLoading(false);read.current=null;}}
  },[enabled]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;read.current?.abort();sequence.current++;};},[refresh]);
  useEffect(()=>{
    if(blocked && read.current){read.current.abort();read.current=null;sequence.current++;setLoading(false);}
    if(!blocked)void refresh();
  },[blocked,refresh]);
  useEffect(()=>{if(!enabled)return;const returned=()=>{if(document.visibilityState==='visible')void refresh();};window.addEventListener('focus',returned);return()=>window.removeEventListener('focus',returned);},[enabled,refresh]);
  async function mutate(action:BinAction['action'], selected:BinEntry[]) {
    if(state.current.pending || state.current.blocked)throw Error('Please finish the current action.');
    read.current?.abort();sequence.current++;setLoading(false);state.current.pending=true;setPending(true);setError('');
    try {
      const input:BinAction={action,confirmed:true,items:selected.map(task=>({kind:task.kind,id:task.id,version:task.updatedAt}))};
      const response=await fetch('/api/bin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
      const body:unknown=await response.json();
      if(!response.ok){if(response.status===401)setExpired(true);if(response.status===403)setNeedsMember(true);throw Error(isRecord(body)&&typeof body.message==='string'?body.message:'Unable to confirm Bin changes.');}
      confirmBinItems(body,input);
      setTasks(current=>current.filter(task=>!selected.some(item=>item.kind==="task"&&item.id===task.id)));
      setTemplates(current=>current.filter(template=>!selected.some(item=>item.kind==="template"&&item.id===template.id)));
      return body;
    }catch(reason){setError(reason instanceof Error?reason.message:'Unable to confirm Bin changes. Refresh before retrying.');throw reason;}
    finally{state.current.pending=false;if(alive.current)setPending(false);}
  }
  return {tasks,templates,loaded,loading,pending,error,expired,needsMember,refresh,mutate};
}
