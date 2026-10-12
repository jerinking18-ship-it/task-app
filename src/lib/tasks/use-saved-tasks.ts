"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { mapTask, newestFirst, taskFields, type Category, type Dataset, type Task, type TaskAction } from "./model";
import { decodeCategory, decodeDataset, decodeRow, isRecord } from "./validation";

export class SaveError extends Error {
  constructor(message:string, public status=0, public latest?:Task, public future?:Task[]) { super(message); }
}
export function useSavedTasks(enabled:boolean, dirty:boolean) {
  const [data,setData]=useState<Dataset|null>(null);
  const [loading,setLoading]=useState(enabled);
  const [pending,setPending]=useState(false);
  const [error,setError]=useState("");
  const [expired,setExpired]=useState(false);
  const [initialized,setInitialized]=useState(false);
  const [deferred,setDeferred]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const state=useRef({dirty,pending:false,data}); state.current.dirty=dirty; state.current.data=data;
  const read=useRef<AbortController|null>(null); const sequence=useRef(0); const alive=useRef(true);
  const refresh=useCallback(async () => {
    if(!enabled) return;
    if(state.current.dirty || state.current.pending) { setDeferred(true); return; }
    read.current?.abort(); const controller=new AbortController(); read.current=controller;
    const revision=++sequence.current; setLoading(true); setError(""); setDeferred(false);
    try {
      const response=await fetch("/api/tasks",{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const body:unknown=await response.json();
      if(!response.ok) { if(response.status===401) setExpired(true); throw new Error(isRecord(body) && typeof body.message==="string" ? body.message : "Unable to load saved tasks."); }
      const next=decodeDataset(body);
      // Validate category joins before accepting a complete dataset.
      next.tasks.forEach(row=>mapTask(row,next.categories));
      if(alive.current && revision===sequence.current) { setData(next); setUncertain(false); }
    } catch(error) {
      if(alive.current && revision===sequence.current && !controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Unable to connect. Try refreshing.");
    } finally { if(alive.current && revision===sequence.current) {setLoading(false);read.current=null;} }
  },[enabled]);
  useEffect(()=>{
    alive.current=true;
    if(enabled) void refresh();
    return ()=>{alive.current=false; read.current?.abort(); sequence.current++;};
  },[enabled,refresh]);
  useEffect(()=>{
    if(dirty && read.current) {
      read.current.abort(); read.current=null; sequence.current++; setLoading(false); setDeferred(true);
    }
  },[dirty]);
  useEffect(()=>{
    if(enabled && deferred && !dirty && !pending) void refresh();
  },[enabled,deferred,dirty,pending,refresh]);
  useEffect(()=>{
    if(!enabled) return;
    let last=0;
    const returned=()=>{
      if(document.visibilityState!=="visible" || Date.now()-last<1000) return;
      last=Date.now(); void refresh();
    };
    window.addEventListener("focus",returned); document.addEventListener("visibilitychange",returned);
    return ()=>{window.removeEventListener("focus",returned); document.removeEventListener("visibilitychange",returned);};
  },[enabled,refresh]);
  useEffect(()=>{
    if(!enabled || data?.timezone!=="Asia/Kolkata") return;
    let timer:number;
    const schedule=()=>{
      // One refresh per India date boundary, not a polling loop. The read RPC
      // releases due schedules itself, so it need not race the background job.
      const indiaOffset=19800000;
      const nextMidnight=(Math.floor((Date.now()+indiaOffset)/86400000)+1)*86400000-indiaOffset;
      timer=window.setTimeout(()=>{void refresh();schedule();},nextMidnight-Date.now()+100);
    };
    schedule(); return ()=>window.clearTimeout(timer);
  },[enabled,data?.timezone,refresh]);
  async function mutate(input:TaskAction):Promise<Record<string,unknown>> {
    if(state.current.pending) throw new SaveError("Please wait for the current save.");
    if(expired) throw new SaveError("Sign in again before saving.",401);
    if((input.action==="create" || input.action==="create_many") && uncertain) throw new SaveError("Refresh and review saved tasks before creating more tasks.");
    read.current?.abort(); sequence.current++; setLoading(false);
    state.current.pending=true; setPending(true); setError("");
    try {
      const response=await fetch("/api/tasks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
      const body:unknown=await response.json();
      if(!isRecord(body)) throw new SaveError("The save response was incomplete. Refresh before retrying.");
      if(!response.ok) {
        if(response.status===401) setExpired(true);
        const categories=Array.isArray(body.categories) ? body.categories.map(decodeCategory) : state.current.data?.categories ?? [];
        if(Array.isArray(body.categories)) setData(current=>current ? {...current,categories} : current);
        const latest=body.latest ? mapTask(decodeRow(body.latest),categories) : undefined;
        const future=Array.isArray(body.future)?body.future.map(row=>mapTask(decodeRow(row),categories)):undefined;
        throw new SaveError(typeof body.message==="string" ? body.message : "Unable to save. Please try again.",response.status,latest,future);
      }
      if(input.action === "create" || input.action === "update" || input.action === "status") decodeRow(body.task);
      if(input.action === "create_many") {
        if(!Array.isArray(body.tasks) || body.tasks.length !== input.fields.length) throw new SaveError("The save response was incomplete. Refresh before retrying.");
        const rows=body.tasks.map(decodeRow);
        if(new Set(rows.map(row=>row.id)).size !== rows.length) throw new SaveError("The save response was incomplete. Refresh before retrying.");
      }
      if(input.action === "delete" && body.deleted !== input.id) throw new SaveError("Deletion could not be confirmed. Refresh before trying again.");
      return body;
    } catch(error) {
      if((input.action==="create" || input.action==="create_many") && (!(error instanceof SaveError) || error.status===0 || error.status>=500)) setUncertain(true);
      throw error instanceof SaveError ? error : new SaveError("We couldn’t confirm saving. Check your connection and refresh to review saved data before trying again.");
    } finally {state.current.pending=false; if(alive.current) setPending(false);}
  }
  async function initialize() {
    const reply=await mutate({action:"bootstrap"});
    if(!Array.isArray(reply.categories)) throw new SaveError("Category setup was incomplete. Please retry.");
    const categories=reply.categories.map(decodeCategory);
    setData(current=>current ? {...current,categories} : current); setInitialized(true);
    setDeferred(true);
  }
  async function setup() {
    const reply=await mutate({action:"setup",timezone:"Asia/Kolkata"});
    if(reply.timezone!=="Asia/Kolkata") throw new SaveError("Account setup was not confirmed. Refresh before trying again.");
    setData(current=>current ? {...current,timezone:"Asia/Kolkata"} : current);
  }
  const bootstrapRunning=useRef(false);
  useEffect(()=>{
    if(!enabled || !data?.timezone || initialized || bootstrapRunning.current) return;
    bootstrapRunning.current=true;
    void initialize().catch(e=>setError(e instanceof Error ? e.message : "Category setup failed. Please retry."));
    // No automatic retry after failure. The visible Retry setup action is explicit.
  },[enabled,data?.timezone,initialized]);
  async function save(task:Task,scope:"this"|"future"="this") {
    const fields=taskFields(task,data?.categories ?? []);
    const reply=await mutate(task.id ? {action:"update",id:task.id,version:task.updatedAt,fields,scope,seriesVersion:task.seriesVersion || task.updatedAt}
      : {action:"create",fields:{...fields,status:"active"}});
    const row=decodeRow(reply.task); const mapped=mapTask(row,data?.categories ?? []);
    setData(current=>current ? {...current,tasks:[...current.tasks.filter(t=>t.id!==row.id),row]} : current);
    setDeferred(true); return mapped;
  }
  async function toggle(task:Task) {
    const reply=await mutate({action:"status",id:task.id,version:task.updatedAt,status:task.completed ? "active" : "completed"});
    const row=decodeRow(reply.task); const mapped=mapTask(row,data?.categories ?? []);
    setData(current=>current ? {...current,tasks:current.tasks.map(t=>t.id===row.id ? row : t)} : current);
    setDeferred(true); return mapped;
  }
  async function saveMany(tasks:Task[], category:string) {
    const fields=tasks.map(task=>({...taskFields({...task,category},data?.categories ?? []),status:"active" as const}));
    const reply=await mutate({action:"create_many",fields});
    const rows=(reply.tasks as unknown[]).map(decodeRow);
    const mapped=rows.map(row=>mapTask(row,data?.categories ?? []));
    setData(current=>current ? {...current,tasks:[...current.tasks,...rows]} : current);
    setDeferred(true); return mapped;
  }
  async function remove(task:Task) {
    await mutate({action:"delete",id:task.id,version:task.updatedAt});
    setData(current=>current ? {...current,tasks:current.tasks.filter(row=>row.id!==task.id)} : current);
    setDeferred(true);
  }
  async function addCategory(name:string):Promise<string> {
    const reply=await mutate({action:"category",name}); const category=decodeCategory(reply.category);
    setData(current=>current ? {...current,categories:[...current.categories.filter(c=>c.id!==category.id),category]} : current);
    setDeferred(true);
    return category.name;
  }
  let tasks:Task[]=[];
  if(data) tasks=newestFirst(data.tasks.map(t=>mapTask(t,data.categories)));
  const categories:Category[]=data?.categories ?? [];
  return {tasks,categories,timezone:data?.timezone ?? null,hasData:!!data,ready:!!data?.timezone && initialized,
    loading,pending,error,expired,deferred,uncertain,refresh,setup,initialize,save,toggle,saveMany,remove,addCategory};
}
