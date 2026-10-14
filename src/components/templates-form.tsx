"use client";
import CapitalizedInput from "./capitalized-input";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { MAX_BATCH_TASKS } from "@/lib/tasks/model";
import type { TaskTemplate, TemplateAction, TemplateItem } from "@/lib/templates/model";
import { TemplateSaveError } from "@/lib/templates/use-templates";
import styles from "./task-app.module.css";
import ui from "./templates-form.module.css";

function Glyph({kind}:{kind:"layers"|"edit"|"search"|"back"|"trash"}) {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==="trash"?<path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/>:kind==="layers"?<><path d="m12 3 10 5-10 5L2 8l10-5Zm-10 9 10 5 10-5M2 16l10 5 10-5"/></>:kind==="edit"?<><path d="m15 4 5 5M4 20l4-1L20 7a2 2 0 0 0-4-4L4 15v5Z"/></>:kind==="search"?<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>:<path d="M20 12H4m7-7-7 7 7 7"/>}</svg>;
}
type Store = {templates:TaskTemplate[];loaded:boolean;loading:boolean;pending:boolean;error:string;uncertain?:boolean;refresh:(background?:boolean)=>Promise<void>;save:(input:TemplateAction)=>Promise<TaskTemplate>};
export default function TemplatesForm({store,onUse,onClose,onDirty,requestAction,onRemove}:{store:Store;onUse:(template:TaskTemplate)=>void;onClose:()=>void;onDirty:(dirty:boolean)=>void;requestAction:(action:()=>void)=>void;onRemove:(template:TaskTemplate)=>void}) {
  const [editor,setEditor]=useState<{template:TaskTemplate|null;key:number}|null>(null);
  const [search,setSearch]=useState("");const [expanded,setExpanded]=useState<string|null>(null);
  const [notice,setNotice]=useState("");const heading=useRef<HTMLHeadingElement>(null);
  const actionFocus=useRef<HTMLElement|null>(null);const count=useRef(0);
  function openEditor(template:TaskTemplate|null) {actionFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setNotice("");setEditor({template,key:++count.current});}
  function back(){requestAction(()=>{setEditor(null);onDirty(false);void store.refresh(true);window.requestAnimationFrame(()=>{if(actionFocus.current?.isConnected)actionFocus.current.focus();else heading.current?.focus();});});}
  async function save(input:TemplateAction){const result=await store.save(input);setEditor(null);onDirty(false);setExpanded(result.id);setSearch("");setNotice(input.action==="create"?"Template saved":"Template updated");window.requestAnimationFrame(()=>heading.current?.focus());}
  const unavailable=store.pending||store.loading||!!store.uncertain;
  const visible=[...store.templates].sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.id.localeCompare(b.id))
    .filter(template=>[template.name,...template.items.flatMap(item=>[item.title,item.notes])].some(text=>text.toLowerCase().includes(search.trim().toLowerCase())));
  if(editor)return <TemplateEditor key={editor.key} template={editor.template} pending={store.pending} onSave={save} onClose={onClose} onBack={back} onDirty={onDirty}/>;
  return <div className={`${styles.bulkEditor} ${ui.library}`}>
    <div className={styles.bulkHeader}><div><p className={styles.editorEyebrow}>MAKE ROOM FOR WHAT MATTERS</p><h2 id="templates-library-title" ref={heading} tabIndex={-1}>Your templates</h2><p>Save a task set. Use it in any category.</p></div><button type="button" className={styles.iconButton} aria-label="Close templates" onClick={onClose}>×</button></div>
    <div className={ui.libraryTools}><label className={ui.search}><Glyph kind="search"/><span className={styles.srOnly}>Search templates</span><input type="search" placeholder="Search templates…" value={search} onChange={event=>setSearch(event.target.value)} data-autofocus="true"/></label><button type="button" className={`${styles.saveButton} ${styles.goldSave}`} disabled={unavailable} onClick={()=>openEditor(null)}>+ New template</button></div>
    <div className={ui.libraryStatus}><span>{store.loaded?store.templates.length+" saved "+(store.templates.length===1?"template":"templates"):"Your saved task sets"}</span><button type="button" className={styles.textButton} disabled={store.loading||store.pending} onClick={()=>void store.refresh()}>{store.loading?"Loading…":"Refresh"}</button></div>
    {store.error&&<p role="alert" className={styles.error}>{store.error}</p>}
    {notice&&<p role="status" className={styles.inlineNotice}>{notice}</p>}
    {!store.loaded&&!store.error?<div className={ui.empty} role="status"><Glyph kind="layers"/><p>Loading your templates…</p></div>:store.loaded&&!visible.length?<div className={ui.empty}><Glyph kind={search?"search":"layers"}/><h3>{search?"No templates found":"Your next meeting, made easier"}</h3><p>{search?"Try another name, task title or note.":"Save titles and notes once, then reuse them in any category."}</p><button type="button" className={`${styles.saveButton} ${styles.goldSave}`} disabled={unavailable} onClick={()=>search?setSearch(""):openEditor(null)}>{search?"Clear search":"+ Create your first template"}</button></div>:<ul className={ui.cards}>{visible.map(template=>{
      const open=expanded===template.id;
      return <li key={template.id} className={`${ui.card} ${open?ui.expanded:""}`}><button type="button" className={ui.cardHeading} onClick={()=>setExpanded(open?null:template.id)} aria-expanded={open} aria-controls={"template-items-"+template.id}><span className={ui.templateMark}><Glyph kind="layers"/></span><span><strong>{template.name}</strong><small>{template.items.length} {template.items.length===1?"task":"tasks"}</small></span><span aria-hidden="true">{open?"−":"+"}</span></button>
        <ol id={"template-items-"+template.id} hidden={!open} className={ui.taskPreview}>{template.items.map((item,index)=><li key={index}><span>{index+1}</span><div><strong>{item.title}</strong>{item.notes&&<p>{item.notes}</p>}</div></li>)}</ol>
        <div className={ui.cardActions}><button type="button" className={`${styles.saveButton} ${styles.goldSave}`} disabled={unavailable} onClick={()=>onUse(template)} aria-label={"Use template "+template.name}>Use template</button><button type="button" className={styles.cancelButton} disabled={unavailable} onClick={()=>openEditor(template)} aria-label={"Edit template "+template.name}><Glyph kind="edit"/>Edit template</button></div>
        <button type="button" className={ui.removeTemplate} disabled={unavailable} onClick={()=>onRemove(template)} aria-label={"Remove template "+template.name}><Glyph kind="trash"/>Remove template</button>
      </li>;
    })}</ul>}
    <p className={ui.libraryHint}>Choose the category and schedule after copying. Removing a template moves it to Bin.</p>
  </div>;
}
function TemplateEditor({template,pending,onSave,onClose,onBack,onDirty}:{template:TaskTemplate|null;pending:boolean;onSave:(input:TemplateAction)=>Promise<void>;onClose:()=>void;onBack:()=>void;onDirty:(dirty:boolean)=>void}) {
  const id=useId();const key=useRef(template?.items.length??1);const createId=useRef("");const submitting=useRef(false);
  const initial=useRef({name:template?.name??"",items:template?.items??[{title:"",notes:""}]});
  const [name,setName]=useState(initial.current.name);
  const [rows,setRows]=useState(()=>initial.current.items.map((item,index)=>({...item,key:index})));
  const [error,setError]=useState("");const [blocked,setBlocked]=useState(false);
  useEffect(()=>{document.getElementById(id+"-name")?.focus();},[id]);
  useEffect(()=>{onDirty(name!==initial.current.name||JSON.stringify(rows.map(({title,notes})=>({title,notes})))!==JSON.stringify(initial.current.items));},[name,rows,onDirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  function update(rowKey:number,field:keyof TemplateItem,value:string){setRows(current=>current.map(row=>row.key===rowKey?{...row,[field]:value}:row));if(!blocked)setError("");}
  function add(){const next=key.current++;setRows(current=>[...current,{key:next,title:"",notes:""}]);window.requestAnimationFrame(()=>document.getElementById(id+"-title-"+next)?.focus());}
  function remove(rowKey:number){const index=rows.findIndex(row=>row.key===rowKey);const next=rows[index+1]??rows[index-1];if(!next)return;setRows(current=>current.filter(row=>row.key!==rowKey));window.requestAnimationFrame(()=>document.getElementById(id+"-title-"+next.key)?.focus());}
  async function submit(event:FormEvent){event.preventDefault();if(pending||submitting.current||blocked)return;
    if(!name.trim()){setError("Give your template a name.");document.getElementById(id+"-name")?.focus();return;}
    const empty=rows.find(row=>!row.title.trim());if(empty){setError("Give every task a title before saving.");document.getElementById(id+"-title-"+empty.key)?.focus();return;}
    if(!createId.current)createId.current=crypto.randomUUID();submitting.current=true;setError("");
    try{await onSave({action:template?"update":"create",id:template?.id??createId.current,version:template?.updated_at??null,name:name.trim(),items:rows.map(({title,notes})=>({title:title.trim(),notes}))});}
    catch(reason){setError(reason instanceof Error?reason.message:"Unable to save. Your draft is kept.");if(reason instanceof TemplateSaveError&&(reason.status===409||reason.status>=500))setBlocked(true);}
    finally{submitting.current=false;}
  }
  return <div className={`${styles.bulkEditor} ${ui.editor}`}><div className={styles.bulkHeader}><div><p className={styles.editorEyebrow}>MAKE ROOM FOR WHAT MATTERS</p><h2>{template?"Edit template":"New template"}</h2><p>Only titles and notes are saved.</p></div><button type="button" className={styles.iconButton} disabled={pending} aria-label="Close template editor" onClick={onClose}>×</button></div>
    <form onSubmit={submit} noValidate aria-busy={pending}><fieldset disabled={pending} className={styles.formFields}>
      <button type="button" className={ui.back} onClick={onBack}><Glyph kind="back"/>Back to templates</button>
      <label className={styles.field}>Template name <span aria-hidden="true">*</span><CapitalizedInput id={id+"-name"} value={name} onValueChange={value=>{setName(value);if(!blocked)setError("");}} maxLength={100} required data-autofocus="true" placeholder="e.g. Sound team setup"/></label>
      <p className={ui.editorNote}>{template?"Changes apply the next time you use this template. Tasks already created stay unchanged.":"Use this task set in any category. Choose its schedule when you use it."}</p>
      <div className={styles.bulkSectionHeading}><h3>Tasks</h3><span>{rows.length} / {MAX_BATCH_TASKS}</span></div>
      <div className={styles.bulkRows}>{rows.map((row,index)=><section key={row.key} className={styles.bulkRow} aria-label={"Template task "+(index+1)}><div className={styles.bulkTitleRow}><span className={styles.taskNumber}>{index+1}</span><label className={styles.field}><span className={styles.srOnly}>Task {index+1} title</span><CapitalizedInput id={id+"-title-"+row.key} value={row.title} onValueChange={value=>update(row.key,"title",value)} required maxLength={200} placeholder="What would you like to do?"/></label><button type="button" className={styles.iconButton} disabled={rows.length===1} onClick={()=>remove(row.key)} aria-label={"Remove task "+(index+1)}>×</button></div>
      <label className={styles.field}>Notes <span className={styles.optional}>optional</span><span className={styles.srOnly}> for task {index+1}</span><textarea rows={2} value={row.notes} onChange={event=>update(row.key,"notes",event.target.value)} maxLength={4000} placeholder="A few helpful details…"/></label></section>)}</div>
      <button type="button" className={styles.addAnother} disabled={rows.length>=MAX_BATCH_TASKS} onClick={add}>+ Add another task</button>
      {error&&<p className={styles.error} role="alert">{error}</p>}
      <div className={`${styles.editorActions} ${ui.editorActions}`}><button type="button" className={styles.cancelButton} onClick={onBack}>Cancel</button><button type="submit" className={`${styles.saveButton} ${styles.goldSave}`} disabled={blocked}>{pending?"Saving…":template?"Save changes":"Save template"}</button></div>
    </fieldset></form>
  </div>;
}
