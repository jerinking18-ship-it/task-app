"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isRecord } from "@/lib/tasks/validation";
import { decodeTemplate, decodeTemplates, decodeTemplateRemoval, type TaskTemplate, type TemplateAction } from "./model";
export class TemplateSaveError extends Error { constructor(message:string,public status=0){super(message);} }
export function useTemplates(enabled:boolean,dirty:boolean) {
  const [templates,setTemplates]=useState<TaskTemplate[]>([]);
  const [loaded,setLoaded]=useState(false);const [loading,setLoading]=useState(false);
  const [pending,setPending]=useState(false);const [error,setError]=useState("");
  const [expired,setExpired]=useState(false);const [deferred,setDeferred]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const state=useRef({dirty,pending:false,uncertain:false});state.current.dirty=dirty;
  const read=useRef<AbortController|null>(null);const sequence=useRef(0);const alive=useRef(true);
  const refresh=useCallback(async(background=false)=>{
    if(!enabled)return;
    if(state.current.dirty||state.current.pending){setDeferred(true);return;}
    read.current?.abort();const controller=new AbortController();read.current=controller;
    const seq=++sequence.current;if(!background)setLoading(true);setError("");setDeferred(false);
    try {
      const response=await fetch("/api/templates",{cache:"no-store",signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
      const body:unknown=await response.json();
      if(!response.ok){if(response.status===401)setExpired(true);throw Error(isRecord(body)&&typeof body.message==="string"?body.message:"Unable to load templates.");}
      const next=decodeTemplates(body);
      if(alive.current&&seq===sequence.current){setTemplates(next);setLoaded(true);state.current.uncertain=false;setUncertain(false);}
    }catch(reason){if(alive.current&&seq===sequence.current&&!controller.signal.aborted)setError(reason instanceof Error?reason.message:"Unable to connect. Refresh templates to try again.");}
    finally{if(alive.current&&seq===sequence.current){setLoading(false);read.current=null;}}
  },[enabled]);
  useEffect(()=>{alive.current=true;setLoaded(false);setTemplates([]);if(enabled)void refresh();return()=>{alive.current=false;read.current?.abort();sequence.current++;};},[enabled,refresh]);
  useEffect(()=>{
    if(dirty&&read.current){read.current.abort();read.current=null;sequence.current++;setLoading(false);setDeferred(true);}
    if(deferred&&!dirty&&!pending)void refresh(true);
  },[dirty,pending,deferred,refresh]);
  async function save(input:TemplateAction) {
    if(state.current.uncertain)throw new TemplateSaveError("Refresh templates before saving changes.");
    if(!enabled||state.current.pending)throw new TemplateSaveError("Please finish the current action.");
    read.current?.abort();sequence.current++;setLoading(false);state.current.pending=true;setPending(true);setError("");
    try {
      const response=await fetch("/api/templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
      const body:unknown=await response.json();
      if(!response.ok){if(response.status===401)setExpired(true);throw new TemplateSaveError(isRecord(body)&&typeof body.message==="string"?body.message:"Unable to confirm the saved template.",response.status);}
      const template=decodeTemplate(isRecord(body)?body.template:null);
      if(template.id!==input.id||template.name!==input.name||JSON.stringify(template.items)!==JSON.stringify(input.items))throw new TemplateSaveError("The saved template could not be confirmed. Close and refresh templates before retrying.",503);
      if(alive.current)setTemplates(current=>[template,...current.filter(item=>item.id!==template.id)]);
      return template;
    }catch(reason){throw reason instanceof TemplateSaveError?reason:new TemplateSaveError("Saving could not be confirmed. Your draft is kept. Close and refresh templates before retrying.",503);}
    finally{state.current.pending=false;if(alive.current)setPending(false);}
  }
  async function remove(template:TaskTemplate){
    if(state.current.uncertain||state.current.dirty)throw new TemplateSaveError("Finish editing and refresh templates before removing one.");
    if(!enabled||state.current.pending)throw new TemplateSaveError("Please finish the current action.");
    read.current?.abort();sequence.current++;setLoading(false);state.current.pending=true;setPending(true);setError("");
    const input={action:"remove" as const,id:template.id,version:template.updated_at,confirmed:true as const};
    try{
      const response=await fetch("/api/templates",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
      const body:unknown=await response.json();
      if(!response.ok){if(response.status===401)setExpired(true);throw new TemplateSaveError(isRecord(body)&&typeof body.message==="string"?body.message:"Unable to confirm template removal.",response.status);}
      decodeTemplateRemoval(isRecord(body)?body.removed:null,input);
      if(alive.current)setTemplates(current=>current.filter(item=>item.id!==template.id));
    }catch(reason){state.current.uncertain=true;if(alive.current){setUncertain(true);setError("Template removal could not be confirmed. Refresh templates before another action.");}throw reason instanceof TemplateSaveError?reason:new TemplateSaveError("Template removal could not be confirmed. Close and refresh templates before retrying.",503);}
    finally{state.current.pending=false;if(alive.current)setPending(false);}
  }
  return {templates,loaded,loading,pending,error,expired,uncertain,refresh,save,remove};
}
