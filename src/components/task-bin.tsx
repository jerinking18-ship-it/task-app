"use client";
import { useEffect, useRef, useState } from "react";
import { deletionLabel, MAX_BIN_SELECTION, type BinTask } from "@/lib/tasks/bin";
import { WEEKDAYS } from "@/lib/tasks/model";
import { useBinDrag } from "@/lib/tasks/use-bin-drag";
import styles from "./task-bin.module.css";
function Trash(){return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden="true"><path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>;}
function Restore(){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" aria-hidden="true"><path d="M3 5v5h5M3 10a9 9 0 1 1 1 8"/><path d="M12 7v5l3 2"/></svg>;}
function RestoreAction(){return <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 0 1 15.36-6.36L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.36 6.36L3 16M8 16H3v5"/></svg>;}
export default function TaskBin({tasks,search,now,loaded,loading,pending,error,expired,needsMember,onRefresh,onRestore,onPurge}:{tasks:BinTask[];search:string;now:Date;loaded:boolean;loading:boolean;pending:boolean;error:string;expired:boolean;needsMember:boolean;onRefresh:()=>void;onRestore:(tasks:BinTask[])=>Promise<void>;onPurge:(tasks:BinTask[])=>void}) {
  const [selection,setSelection]=useState<Map<string,string>>(()=>new Map());
  const [selecting,setSelecting]=useState(false);
  const [feedback,setFeedback]=useState(''); const all=useRef<HTMLInputElement>(null);
  const query=search.trim().toLowerCase();
  const visible=tasks.filter(task=>!query||[task.title,task.notes,task.category].some(value=>value.toLowerCase().includes(query)));
  const selected=visible.filter(task=>selection.get(task.id)===task.updatedAt);
  const every=visible.length>0&&selected.length===visible.length;
  useEffect(()=>{if(all.current)all.current.indeterminate=selected.length>0&&!every;},[selected.length,every]);
  useEffect(()=>{setSelection(new Map());setSelecting(false);setFeedback('');},[search]);
  useEffect(()=>{if(!tasks.length){setSelecting(false);setSelection(new Map());}},[tasks.length]);
  useEffect(()=>{const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!pending){setSelecting(false);setSelection(new Map());}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[pending]);
  const disabled=pending||expired||needsMember||loading;
  const noDropTarget=useRef<HTMLButtonElement>(null);
  const hold=useBinDrag<BinTask>(noDropTarget,disabled,()=>{},task=>{if(selecting)toggle(task);},beginSelection);
  function beginSelection(task:BinTask){setSelecting(true);setSelection(current=>{const next=new Map(current);if(next.size<MAX_BIN_SELECTION)next.set(task.id,task.updatedAt);return next;});setFeedback('');}
  function finishSelection(){if(disabled)return;setSelecting(false);setSelection(new Map());hold.cancel();window.requestAnimationFrame(()=>hold.origin.current?.isConnected&&hold.origin.current.focus());}
  function toggleAll(){setFeedback('');if(every)setSelection(new Map());else if(visible.length>MAX_BIN_SELECTION)setFeedback('Select up to 1,000 tasks at a time. Narrow your search to select all.');else setSelection(new Map(visible.map(task=>[task.id,task.updatedAt])));}
  function toggle(task:BinTask){setSelection(current=>{const next=new Map(current);if(next.get(task.id)===task.updatedAt)next.delete(task.id);else if(next.size<MAX_BIN_SELECTION)next.set(task.id,task.updatedAt);return next;});setFeedback('');}
  async function restore(items:BinTask[]){setFeedback('');try{await onRestore(items);setSelection(new Map());setSelecting(false);setFeedback(`${items.length===1?'Task':`${items.length} tasks`} restored.`);}catch{/* The hook shows the error; never claim an ambiguous write succeeded. */}}
  return <section className={styles.panel} aria-label="Deleted tasks" aria-busy={pending}>
    <div className={styles.overview}><span className={styles.overviewIcon}><Trash/></span><div><h2>A second chance for your tasks</h2><p className={styles.intro}>Restore what you need. Tasks stay here until you permanently delete them.</p></div><span className={styles.total}>{loaded?tasks.length:"—"}<small>{tasks.length===1?"task":"tasks"}</small></span></div>
    {error&&<div className={styles.error} role="alert"><p>{error}</p>{expired?<a href="/sign-in">Sign in again</a>:needsMember?<a href="/account/member">Choose your name</a>:<button onClick={onRefresh} disabled={pending||loading}>Refresh Bin</button>}</div>}
    {feedback&&<p className={styles.feedback} role="status">{feedback}</p>}
    {!loaded&&loading?<div className={styles.empty} role="status">Loading Bin…</div>:loaded&&tasks.length===0?<div className={styles.empty}><span className={styles.emptyIcon}><Trash/></span><h2>All clear here</h2><p>Deleted tasks will appear here, ready to restore whenever you need them.</p></div>:<>
      {selecting&&<div className={styles.selectionBar} role="region" aria-label="Bin selection actions">
        <label><input ref={all} type="checkbox" checked={every} disabled={disabled||!visible.length} onChange={toggleAll}/><span>Select all</span></label>
        <button type="button" className={styles.done} disabled={disabled} onClick={finishSelection}>Done</button><span className={styles.selectionCount}>{selected.length?`${selected.length} selected`:"Choose tasks to manage"}</span>
        <div className={styles.actions}><button className={styles.restore} disabled={disabled||!selected.length} onClick={()=>void restore(selected)}><Restore/><span>Restore<span className={styles.desktop}> selected</span> {selected.length>0&&` (${selected.length})`}</span></button><button className={styles.purge} disabled={disabled||!selected.length} onClick={()=>onPurge(selected)}><Trash/><span>Delete<span className={styles.desktop}> permanently</span> {selected.length>0&&` (${selected.length})`}</span></button></div>
      </div>}
      <div className={styles.listHeading}><p className={styles.count}>{query?`${visible.length} ${visible.length===1?'result':'results'}`:'DELETED TASKS'}</p><span>{selecting?'Tap tasks to select':'Hold a task for options'}</span></div>
      {!visible.length?<div className={styles.empty}><h2>No deleted tasks found</h2><p>Try another search.</p></div>:<ul className={styles.list}>{visible.map(task=><li key={task.id} className={`${styles.row} ${selection.get(task.id)===task.updatedAt?styles.chosen:""}`}>
        {selecting&&<input type="checkbox" aria-label={`Select ${task.title}`} checked={selection.get(task.id)===task.updatedAt} disabled={disabled} onChange={()=>toggle(task)}/>}
        <div className={styles.details}><button className={styles.taskBody} {...hold.handle(task)} onClick={event=>{if(!selecting&&event.detail===0)beginSelection(task);else hold.handle(task).onClick(event);}} disabled={disabled} aria-label={`${selecting?"Select":"Hold for options:"} deleted task ${task.title}`} aria-pressed={selecting?selection.get(task.id)===task.updatedAt:undefined}><span className={styles.taskTitle}>{task.title}</span>{task.notes&&<span className={styles.notes}>{task.notes}</span>}
          <span className={styles.meta}>{task.category&&<span>{task.category}</span>}<span>{task.priority}</span>{task.date&&<span>{new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(`${task.date}T12:00:00+05:30`))}{task.time&&` · ${new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(`${task.date}T${task.time}:00+05:30`))}`}</span>}{task.weekdays.length>0&&<span>{task.weekdays.map(day=>WEEKDAYS[day].slice(0,3)).join(' · ')}</span>}{task.repeat!=='Off'&&<span>Repeat paused · {task.repeat}</span>}</span>
          <time className={styles.deleted} dateTime={task.deletedAt} title={new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',dateStyle:'full',timeStyle:'short'}).format(new Date(task.deletedAt))}>{deletionLabel(task.deletedAt,now)} IST{task.deletedByName&&` · by ${task.deletedByName}`}</time></button>
        </div>
        {selecting&&<div className={styles.rowActions}><button aria-label={`Restore ${task.title}`} title="Restore task" disabled={disabled} className={styles.restoreIcon} onClick={()=>void restore([task])}><RestoreAction/></button><button className={styles.red} aria-label={`Permanently delete ${task.title}`} title="Delete permanently" disabled={disabled} onClick={()=>onPurge([task])}><Trash/></button></div>}
      </li>)}</ul>}
    </>}
  </section>;
}
