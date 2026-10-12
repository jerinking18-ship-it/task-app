"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { blankTask, repeatError, MAX_BATCH_TASKS, PRIORITIES, type Priority, type Task } from "@/lib/tasks/model";
import TaskRepeat from "./task-repeat";
import styles from "./task-app.module.css";

type DraftRow = { key: number; task: Task; details: boolean; notesOpen: boolean };
export default function BulkTaskEditor({ categories, initialCategory, onSave, onClose, onDirty, pending, uncertain }: {
  categories: string[]; initialCategory: string; onSave: (tasks: Task[], category: string)=>Promise<void>;
  onClose: ()=>void; onDirty: (dirty:boolean)=>void; pending:boolean; uncertain:boolean;
}) {
  const id=useId();
  const sequence=useRef(1);
  const submitting=useRef(false);
  const appliedDetails=useRef<Pick<Task,"date"|"time"|"weekdays"|"priority"|"repeat">|null>(null);
  const [category,setCategory]=useState(initialCategory);
  const [rows,setRows]=useState<DraftRow[]>(()=>[{key:0,task:blankTask(),details:true,notesOpen:true}]);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  useEffect(()=>{
    onDirty(category!==initialCategory || rows.length!==1 || rows.some(row=>JSON.stringify(row.task)!==JSON.stringify(blankTask())));
  },[rows,category,initialCategory,onDirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  function update<K extends keyof Task>(key:number,field:K,value:Task[K]) {
    setRows(current=>current.map(row=>row.key===key?{...row,task:{...row.task,[field]:value}}:row));
    setError("");setNotice("");
  }
  function applyDetails(source:Task) {
    const details={date:source.date,time:source.time,weekdays:[...source.weekdays],priority:source.priority,repeat:source.repeat};
    appliedDetails.current=details;
    setRows(current=>current.map(row=>({...row,task:{...row.task,...details,weekdays:[...details.weekdays]}})));
    setNotice("Details applied to all tasks, including tasks you add next in this batch. Titles and notes kept.");
  }
  function addRow() {
    if(rows.length>=MAX_BATCH_TASKS) return;
    const key=sequence.current++;
    const details=appliedDetails.current;
    const task=details?{...blankTask(),...details,weekdays:[...details.weekdays]}:blankTask();
    setRows(current=>[...current,{key,task,details:false,notesOpen:false}]);
    window.requestAnimationFrame(()=>document.getElementById(`${id}-title-${key}`)?.focus());
  }
  function removeRow(key:number) {
    const index=rows.findIndex(row=>row.key===key);
    const next=rows[index+1]??rows[index-1];
    if(!next) return;
    setRows(current=>current.filter(row=>row.key!==key));setNotice("");
    window.requestAnimationFrame(()=>document.getElementById(`${id}-title-${next.key}`)?.focus());
  }
  async function submit(event:FormEvent) {
    event.preventDefault();
    if(pending || submitting.current || uncertain) return;
    const empty=rows.find(row=>!row.task.title.trim());
    if(empty) {setError("Give every task a title before adding them.");document.getElementById(`${id}-title-${empty.key}`)?.focus();return;}
    const missingDate=rows.find(row=>row.task.time && !row.task.date);
    if(missingDate) {
      setError("Choose a due date for every task with a time.");
      setRows(current=>current.map(row=>row.key===missingDate.key?{...row,details:true}:row));
      window.requestAnimationFrame(()=>document.getElementById(`${id}-date-${missingDate.key}`)?.focus());return;
    }
    const invalidRepeat=rows.find(row=>repeatError(row.task));
    if(invalidRepeat){setError(`Task ${rows.indexOf(invalidRepeat)+1}: ${repeatError(invalidRepeat.task)}`);setRows(current=>current.map(row=>row.key===invalidRepeat.key?{...row,details:true}:row));return;}
    submitting.current=true;setError("");
    try {await onSave(rows.map(row=>row.task),category);}
    catch(e) {setError(e instanceof Error?e.message:"Unable to save. Your tasks are still here.");}
    finally {submitting.current=false;}
  }
  return <div className={styles.bulkEditor}>
    <div className={styles.bulkHeader}><div><p className={styles.editorEyebrow}>MAKE ROOM FOR WHAT MATTERS</p><h2>Add multiple tasks</h2><p>Create separate tasks in one category.</p></div><button type="button" className={styles.iconButton} disabled={pending} aria-label="Close multiple-task editor" onClick={onClose}>×</button></div>
    <form onSubmit={submit} noValidate aria-busy={pending}>
      <fieldset className={styles.formFields} disabled={pending}>
        <label className={`${styles.field} ${styles.bulkCategory}`}>Category<select value={category} onChange={event=>setCategory(event.target.value)}>{!category && <option value="" disabled>Choose category</option>}{categories.map(name=><option key={name}>{name}</option>)}</select></label>
        <div className={styles.bulkSectionHeading}><h3>Tasks</h3><span>{rows.length} / {MAX_BATCH_TASKS}</span></div>
        <div className={styles.bulkRows}>{rows.map((row,index)=><section key={row.key} className={styles.bulkRow} aria-label={`Task ${index+1}`}>
          <div className={styles.bulkTitleRow}><span className={styles.taskNumber}>{index+1}</span><label className={styles.field}><span className={styles.srOnly}>Task {index+1} title</span><input id={`${id}-title-${row.key}`} value={row.task.title} onChange={event=>update(row.key,"title",event.target.value)} maxLength={200} required placeholder="What would you like to do?" data-autofocus={index===0} aria-invalid={!!error && !row.task.title.trim()} /></label><button type="button" className={styles.iconButton} aria-label={`Remove task ${index+1}`} disabled={rows.length===1} onClick={()=>removeRow(row.key)}>×</button></div>
          {row.notesOpen?<label className={styles.field}>Notes <span className={styles.optional}>optional</span><span className={styles.srOnly}> for task {index+1}</span><textarea value={row.task.notes} onChange={event=>update(row.key,"notes",event.target.value)} rows={2} maxLength={4000} placeholder="A few helpful details…" /></label>:<button type="button" className={styles.textButton} onClick={()=>setRows(current=>current.map(item=>item.key===row.key?{...item,notesOpen:true}:item))}>+ Add notes <span className={styles.optional}>optional</span><span className={styles.srOnly}> for task {index+1}</span></button>}
          <button type="button" className={styles.detailsToggle} aria-expanded={row.details} aria-controls={`${id}-details-${row.key}`} onClick={()=>setRows(current=>current.map(item=>item.key===row.key?{...item,details:!item.details}:item))}>{row.details?"Hide details":"Task details"}<span aria-hidden="true">{row.details?"−":"+"}</span></button>
          <div id={`${id}-details-${row.key}`} hidden={!row.details}>
            <div className={styles.bulkDetails}>
              <div className={styles.dateFields}><label className={styles.field}><span>Due date<span className={styles.srOnly}> for task {index+1}</span></span><input id={`${id}-date-${row.key}`} type="date" value={row.task.date} onInput={event=>{update(row.key,"date",event.currentTarget.value);if(!event.currentTarget.value)update(row.key,"time","");}} onChange={event=>{update(row.key,"date",event.target.value);if(!event.target.value)update(row.key,"time","");}} /></label><label className={styles.field}><span>Time <span className={styles.optional}>optional</span><span className={styles.srOnly}> for task {index+1}</span></span><input type="time" value={row.task.time} onInput={event=>update(row.key,"time",event.currentTarget.value)} onChange={event=>update(row.key,"time",event.target.value)} /></label></div>
              <p className={styles.editorHint}>India time · Mumbai</p>
              <TaskRepeat task={row.task} onChange={rule=>update(row.key,"repeat",rule)} onDaysChange={days=>update(row.key,"weekdays",days)} label={`Repeat for task ${index+1}`}/>
              <label className={styles.property}><span>Priority<span className={styles.srOnly}> for task {index+1}</span></span><select value={row.task.priority} onChange={event=>update(row.key,"priority",event.target.value as Priority)}>{PRIORITIES.map(item=><option key={item}>{item}</option>)}</select></label>
              <button type="button" className={styles.applyDetails} onClick={()=>applyDetails(row.task)}>Apply these details to all tasks</button>
              <p className={styles.editorHint}>Applies date, time, days, priority and repeat to this batch and tasks added next. Keeps each task’s title and notes.</p>
            </div>
          </div>
        </section>)}</div>
        <button className={styles.addAnother} type="button" onClick={addRow} disabled={rows.length>=MAX_BATCH_TASKS}>+ Add another task</button>
        <p className={styles.bulkHint}>Each task can be edited and completed separately.</p>
        {notice&&<p className={styles.inlineNotice} role="status">{notice}</p>}
        {error&&!uncertain&&<p className={styles.error} role="alert">{error}</p>}
        {uncertain&&<p className={styles.error} role="alert">Saving could not be confirmed. Your drafts are kept here. Close this editor when ready, then refresh and review saved tasks before adding more.</p>}
        <div className={styles.editorActions}><button type="button" className={styles.cancelButton} onClick={onClose}>Cancel</button><button className={`${styles.saveButton} ${styles.goldSave}`} type="submit" disabled={uncertain}>{pending?"Adding tasks…":`Add ${rows.length} ${rows.length===1?"task":"tasks"}`}</button></div>
      </fieldset>
    </form>
  </div>;
}
