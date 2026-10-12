"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import styles from "./task-app.module.css";
import { accountClock, blankTask, categoryOrder, MEETING_CATEGORIES, PRIORITIES, WEEKDAYS, isOverdue, matchesTask, type Priority, type Task } from "@/lib/tasks/model";
import { SaveError, useSavedTasks } from "@/lib/tasks/use-saved-tasks";
import AccountControls from "./auth/account-controls";
import TaskDays from "./task-days";
import BulkTaskEditor from "./bulk-task-editor";
type View = "All tasks" | "Today" | "Overdue" | "Completed";
type IconName = "check" | "plus" | "search" | "list" | "calendar" | "clock" | "chevron" | "close" | "menu" | "filter" | "repeat" | "bell" | "warning" | "trash";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    list: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 9h8M8 15h8" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    filter: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="2" fill="currentColor" /><circle cx="15" cy="17" r="2" fill="currentColor" /></>,
    repeat: <><path d="m17 3 4 4-4 4M21 7H7a4 4 0 0 0-4 4M7 21l-4-4 4-4M3 17h14a4 4 0 0 0 4-4" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></>,
    trash: <><path d="M3 6h18M9 6V4h6v2M5 6l1 15h12l1-15M10 10v7M14 10v7" /></>,
    warning: <><path d="m10.3 4-8 14a2 2 0 0 0 1.7 3h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 4h.01" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function shiftDate(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + amount);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function sampleTasks(today: string): Task[] {
  const base = blankTask();
  return [
    { ...base, id: "design", title: "Review homepage design", notes: "Check desktop and mobile layouts", category: "Work", priority: "High", date: today, time: "16:00" },
    { ...base, id: "groceries", title: "Buy groceries", notes: "Milk, eggs, bread, and fresh fruit", category: "Shopping", priority: "Medium", date: today, time: "18:00" },
    { ...base, id: "planning", title: "Plan next week", notes: "Make room for what matters", category: "Personal", priority: "Low", date: shiftDate(today, 2) },
    { ...base, id: "setup", title: "Set up task app", notes: "A fresh start, all in one place", category: "Work", priority: "Low", date: shiftDate(today, -2), completed: true },
  ];
}
const navItems: { view: View; icon: IconName }[] = [
  { view: "All tasks", icon: "list" }, { view: "Today", icon: "calendar" },
  { view: "Overdue", icon: "clock" }, { view: "Completed", icon: "check" },
];
function categoryClass(category: string) {
  return category === "Sunday Service" ? styles.shopping : category === "Healing Meeting" ? styles.personal : category === "Revival Meeting" ? styles.work : category === "Special Meeting" ? styles.specialMeeting : category === "Woman's Meeting" ? styles.womansMeeting : styles.custom;
}
function Modal({ children, label, onClose, className = "" }: { children: ReactNode; label: string; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>('[data-autofocus="true"]')?.focus();
    return () => dialog?.close();
  }, []);
  return <dialog ref={ref} aria-label={label} className={`${styles.dialog} ${className}`} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>{children}</dialog>;
}

export default function TaskApp({ today: initialToday, accountControls, saved = false, passwordUpdated = false }: { today: string; accountControls?: ReactNode; saved?: boolean; passwordUpdated?: boolean }) {
  const [dirty,setDirty]=useState(false);
  const storage=useSavedTasks(saved,dirty);
  const [previewTasks, setTasks] = useState(() => saved ? [] : sampleTasks(initialToday));
  const [previewCategories, setCategories] = useState(MEETING_CATEGORIES);
  const tasks=saved ? storage.tasks : previewTasks;
  const categories=categoryOrder(saved ? storage.categories.map(c=>c.name) : previewCategories);
  const [now,setNow]=useState(()=>new Date());
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(timer);},[]);
  const clock=accountClock(now,saved && storage.timezone ? storage.timezone : "UTC");
  const today=saved ? clock.date : initialToday;
  const [view, setView] = useState<View>("All tasks");
  const [status, setStatus] = useState("Active");
  const [priority, setPriority] = useState("Any");
  const [category, setCategory] = useState("Any");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Task | null>(() => saved ? null : sampleTasks(initialToday)[0]);
  const [editorVersion,setEditorVersion]=useState(0);
  const [bulkCategory,setBulkCategory]=useState<string|null>(null);
  const [deleteTask,setDeleteTask]=useState<Task|null>(null);
  const [deleteError,setDeleteError]=useState("");
  const [deleteConflict,setDeleteConflict]=useState<Task|null>(null);
  const deleteFocus=useRef<HTMLElement|null>(null);
  const [queuedAction,setQueuedAction]=useState<(()=>void)|null>(null);
  const [writeError,setWriteError]=useState("");
  const [statusConflict,setStatusConflict]=useState<Task|null>(null);
  const [reopenTask,setReopenTask]=useState<Task|null>(null);
  const reopenFocus=useRef<HTMLElement|null>(null);
  const [hiddenSaved,setHiddenSaved]=useState(false);
  useEffect(()=>setHiddenSaved(false),[view,status,priority,category,search]);
  const signOutAnswer=useRef<((answer:boolean)=>void)|null>(null);
  const [mobileEditor, setMobileEditor] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const busy=saved && storage.pending;
  useEffect(()=>{
    if(!dirty && !busy) return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault(); event.returnValue="";};
    window.addEventListener("beforeunload",warn); return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty,busy]);
  useEffect(()=>{
    const media=window.matchMedia("(max-width: 1100px)");
    const resize=()=>setMobileEditor(media.matches);
    media.addEventListener("change",resize); return ()=>media.removeEventListener("change",resize);
  },[]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [message]);
  const currentFilters={view,status,priority,category,search};
  const matching=useRef({filters:currentFilters,date:today,time:saved ? clock.time : "00:00:00"});
  matching.current={filters:currentFilters,date:today,time:saved ? clock.time : "00:00:00"};
  const matches=(task:Task)=>matchesTask(task,matching.current.filters,matching.current.date,matching.current.time);
  const visibleTasks=tasks.filter(matches);
  const filtersApplied = search !== "" || priority !== "Any" || category !== "Any" || status !== "All";
  const categoryEmpty = category!=="Any" && view==="All tasks" && !search && priority==="Any" && status==="All";
  const activeEmpty = view==="All tasks" && status==="Active" && !search && priority==="Any" && category==="Any";
  const filteredEmpty = filtersApplied && !categoryEmpty && !activeEmpty;
  const activeCount = tasks.filter((task) => !task.completed).length;
  function openEditor(task: Task) {
    if(busy || (saved && !storage.ready)) return;
    if(!saved && !task.id) {requestAction(()=>window.location.assign("/sign-in")); return;}
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    requestAction(()=>{setBulkCategory(null);setEditing({ ...task,weekdays:[...task.weekdays] }); setDirty(false); setEditorVersion(v=>v+1); setMobileEditor(window.matchMedia("(max-width: 1100px)").matches);});
  }
  function restoreFocus() {
    window.requestAnimationFrame(() => {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    });
  }
  function requestAction(action:()=>void) {
    if(busy) return;
    if(dirty) setQueuedAction(()=>action); else action();
  }
  function keepEditing() {setQueuedAction(null); signOutAnswer.current?.(false); signOutAnswer.current=null;}
  function discardChanges() {const action=queuedAction; setQueuedAction(null); setDirty(false); action?.();}
  function beforeSignOut():Promise<boolean> {
    if(busy) return Promise.resolve(false);
    if(!dirty) return Promise.resolve(true);
    return new Promise(resolve=>{signOutAnswer.current=resolve; setQueuedAction(()=>()=>{setEditing(null);setBulkCategory(null); resolve(true); signOutAnswer.current=null;});});
  }
  function finishEditor() {setDirty(false); setEditing(null); setMobileEditor(false); restoreFocus();}
  function closeEditor() {requestAction(finishEditor);}
  function newTask() {openEditor({...blankTask(),category:category==="Any"?"":category});}
  function openBulk() {
    if(busy || (saved && !storage.ready)) return;
    if(!saved) {requestAction(()=>window.location.assign("/sign-in"));return;}
    returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    requestAction(()=>{setEditing(null);setDirty(false);setBulkCategory(category==="Any"?(categories[0]??""):category);});
  }
  function finishBulk() {setDirty(false);setBulkCategory(null);restoreFocus();}
  async function saveMany(drafts:Task[],chosenCategory:string) {
    const results=await storage.saveMany(drafts,chosenCategory);
    setHiddenSaved(results.some(task=>!matches(task)));finishBulk();setMessage(`${results.length} ${results.length===1?"task":"tasks"} created`);
  }
  function askDelete(task:Task) {
    if(busy) return;
    deleteFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    setDeleteError("");setDeleteConflict(null);setDeleteTask({...task,weekdays:[...task.weekdays]});
  }
  function cancelDelete() {
    if(busy) return;
    setDeleteTask(null);
    window.requestAnimationFrame(()=>{if(deleteFocus.current?.isConnected)deleteFocus.current.focus();});
  }
  async function confirmDelete() {
    if(!deleteTask || busy || deleteConflict) return;
    setDeleteError("");
    try {
      if(saved) await storage.remove(deleteTask);
      else setTasks(current=>current.filter(task=>task.id!==deleteTask.id));
      setDeleteTask(null);finishEditor();setHiddenSaved(false);setMessage("Task deleted");
    } catch(e) {
      setDeleteError(e instanceof Error?e.message:"Unable to delete. Your task is still here.");
      if(e instanceof SaveError && e.latest)setDeleteConflict(e.latest);
    }
  }
  function chooseView(next: View) { setView(next); resetFilters(); setMenuOpen(false); }
  function cancelReopenTask() {
    setReopenTask(null);
    window.requestAnimationFrame(()=>{if(reopenFocus.current?.isConnected) reopenFocus.current.focus();});
  }
  async function toggleTask(id: string, confirmedReopen?: Task) {
    const task = confirmedReopen ?? tasks.find((item) => item.id === id);
    if (!task || busy || (saved && (!storage.ready || storage.expired)) || (dirty && editing?.id===id)) return;
    if(task.completed && !confirmedReopen) {
      reopenFocus.current=document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setReopenTask(task); return;
    }
    if(saved) {
      setWriteError(""); setStatusConflict(null);
      try {
        const result=await storage.toggle(task);
        if(editing?.id===id) {setEditing(result);setEditorVersion(v=>v+1);}
        setHiddenSaved(!matches(result)); setMessage(result.completed ? "Task completed" : "Task reopened");
      } catch(error) {setWriteError(error instanceof Error ? error.message : "Unable to save status."); if(error instanceof SaveError && error.latest) setStatusConflict(error.latest);}
      return;
    }
    setTasks((current) => current.map((item) => item.id === id ? { ...item, completed: !item.completed } : item));
    if (editing?.id === id) setEditing({ ...editing, completed: !task.completed });
    setMessage(task.completed ? "Task reopened in this preview" : "Task completed in this preview");
  }
  async function saveTask(task: Task) {
    if(!saved && !task.id) {requestAction(()=>window.location.assign("/sign-in")); return;}
    if(saved) {
      const result=await storage.save(task); setHiddenSaved(!matches(result));
      finishEditor(); setMessage(task.id ? "Changes saved" : "Task created"); return;
    }
    const previewSaved = { ...task, id: task.id || crypto.randomUUID(), title: task.title.trim(), notes: task.notes.trim() };
    setTasks((current) => task.id ? current.map((item) => item.id === task.id ? previewSaved : item) : [...current, previewSaved]);
    setEditing(previewSaved);
    setDirty(false); setEditorVersion(v=>v+1);
    if (mobileEditor) { setMobileEditor(false); setEditing(null); restoreFocus(); }
    setMessage(task.id ? "Changes saved in this preview" : "Task added in this preview");
  }
  function resetFilters() { setSearch(""); setPriority("Any"); setCategory("Any"); setStatus("All"); }
  function viewAll() {setView("All tasks");resetFilters();setHiddenSaved(false);}
  async function addCategory(name:string) {
    if(saved) return storage.addCategory(name);
    setCategories(current=>[...current,name]); return name;
  }
  async function setupAccount() {setWriteError(""); try {await storage.setup();} catch(e) {setWriteError(e instanceof Error ? e.message : "Setup failed. Please retry.");}}
  async function retrySetup() {setWriteError(""); try {await storage.initialize();} catch(e) {setWriteError(e instanceof Error ? e.message : "Setup failed. Please retry.");}}
  function sidebar(mobile = false) {
    return <>
      <div className={styles.brand}><span className={styles.brandMark}><Icon name="check" size={23} /></span><span>Task App<span className={styles.brandDot}>.</span></span>{mobile && <button className={styles.menuClose} aria-label="Close navigation" onClick={() => setMenuOpen(false)}><Icon name="close" /></button>}</div>
      <nav aria-label="Task views" className={styles.navigation}>{navItems.map((item) => <button key={item.view} className={`${styles.navItem} ${view === item.view ? styles.navActive : ""}`} onClick={() => chooseView(item.view)} aria-current={view === item.view ? "page" : undefined}><Icon name={item.icon} /><span>{item.view}</span>{item.view === "All tasks" && <span className={styles.navCount}>{saved && !storage.hasData ? "…" : tasks.length}</span>}</button>)}</nav>
      <div className={styles.categorySection}><p className={styles.eyebrow}>Categories</p><nav aria-label="Categories">{categories.map((name) => <button key={name} className={`${styles.categoryNav} ${category === name ? styles.categoryActive : ""}`} onClick={() => { resetFilters(); setCategory(name); setView("All tasks"); setMenuOpen(false); }} aria-pressed={category === name}><span className={`${styles.dot} ${categoryClass(name)}`} />{name}<span className={styles.categoryCount}>{tasks.filter((task) => task.category === name).length}</span></button>)}</nav></div>
      <div className={styles.sidebarFooter}><span className={styles.footerMark}><Icon name="check" size={16} /></span><div>A little more clarity.<span>One task at a time.</span></div></div>
    </>;
  }
  const editor = editing && <TaskEditor key={`${editing.id || "new"}-${editorVersion}`} task={editing} categories={categories} onSave={saveTask} onClose={closeEditor} onCategory={addCategory} onDirty={setDirty} saved={saved} pending={busy} uncertain={storage.uncertain} onLatest={openEditor} onDelete={askDelete} />;
  return <div className={styles.app}>
    <a className={styles.skipLink} href="#task-content">Skip to tasks</a>
    <aside className={styles.sidebar}>{sidebar()}</aside>
    {menuOpen && <Modal label="Navigation" onClose={() => setMenuOpen(false)} className={styles.menuDialog}><div className={styles.drawer}>{sidebar(true)}</div></Modal>}
    <main id="task-content" className={styles.workspace}>
      {(saved || accountControls) && <div className={styles.accountBar}>{saved ? <AccountControls passwordUpdated={passwordUpdated} beforeSignOut={beforeSignOut} blocked={busy} /> : accountControls}</div>}
      <header className={styles.header}>
        <div className={styles.heading}><button className={styles.mobileMenu} aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" size={23} /></button><div><p className={styles.overline}>YOUR SPACE, YOUR PACE</p><h1>{category !== "Any" ? (view === "All tasks" ? category || "Uncategorized" : `${view} · ${category || "Uncategorized"}`) : view === "All tasks" ? "My tasks" : view}</h1><p className={styles.date}>{new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${today}T12:00:00`))}</p></div></div>
        <div className={styles.headerActions}><label className={styles.search}><Icon name="search" size={19} /><span className={styles.srOnly}>Search tasks</span><input type="search" placeholder="Search your tasks…" value={search} onChange={(event) => setSearch(event.target.value)} /></label><button className={styles.addButton} disabled={busy || (saved && (!storage.ready || storage.expired))} onClick={newTask}><Icon name="plus" size={19} />Add task</button><button className={`${styles.addButton} ${styles.bulkButton}`} disabled={busy || (saved && (!storage.ready || storage.expired))} onClick={openBulk}><Icon name="plus" size={19} />Add multiple tasks</button></div>
      </header>
      {saved ? <div className={styles.previewNotice}><span className={styles.previewDot} />My saved tasks<span className={styles.noticeDivider}>·</span><span>{storage.timezone ? "India time · Asia/Kolkata" : storage.hasData ? "Account setup" : storage.loading ? "Loading account…" : "Account unavailable"}</span><button className={styles.refreshButton} disabled={storage.loading || busy} onClick={()=>void storage.refresh()}>{storage.loading ? "Refreshing…" : "Refresh"}</button></div> : <div className={styles.previewNotice}><span className={styles.previewDot} />Design preview<span className={styles.noticeDivider}>·</span><span>Sample tasks. Changes reset on refresh.</span><Link href="/sign-in" className={styles.signInLink}>Sign in <span aria-hidden="true">↗</span></Link></div>}
      <div className={`${styles.content} ${editing ? styles.withEditor : ""}`}>
        <section className={styles.taskSection} aria-label="Tasks">
          {saved && <>
            {storage.deferred && <p className={styles.inlineNotice} role="status">Refresh queued. Finish editing or saving to load updates.</p>}
            {storage.loading && !storage.hasData && <div className={styles.empty} role="status"><div className={styles.emptyIcon}><Icon name="clock" size={29}/></div><h2>Loading your space…</h2><p>Getting your saved tasks ready.</p></div>}
            {(storage.error || writeError) && <div className={styles.inlineError} role="alert"><p>{writeError || storage.error}</p>{storage.expired ? <Link href="/sign-in" onClick={event=>{if(dirty){event.preventDefault();requestAction(()=>window.location.assign('/sign-in'));}}}>Sign in again</Link> : <button onClick={()=>void storage.refresh()} disabled={busy || storage.loading}>Refresh saved data</button>}{statusConflict && <button onClick={()=>openEditor(statusConflict)}>Review saved task</button>}</div>}
            {storage.hasData && !storage.timezone && !storage.expired && <div className={styles.empty}><div className={styles.emptyIcon}><Icon name="clock" size={29}/></div><h2>A home for your time</h2><p>Use India time (Asia/Kolkata) so deadlines stay consistent on every device. This version supports India time.</p><button className={styles.emptyAction} disabled={busy} onClick={()=>void setupAccount()}>{busy ? "Setting up…" : "Use India time"}</button></div>}
            {!!storage.timezone && !storage.ready && <div className={styles.empty} role="status"><h2>Preparing your categories</h2><p>Your five meeting categories are being prepared. Your task list starts empty.</p><button className={styles.emptyAction} disabled={busy} onClick={()=>void retrySetup()}>{busy ? "Preparing…" : "Retry category setup"}</button></div>}
            {hiddenSaved && <div className={styles.inlineNotice} role="status">Saved successfully. One or more tasks are hidden by your current view or filters.<button onClick={viewAll}>View all tasks</button></div>}
          </>}
          {(!saved || storage.ready) && <>
          <div className={styles.toolbar}><div className={styles.tabs} aria-label="Task status">{["Active", "Completed", "All"].map((item) => <button key={item} className={status === item ? styles.tabActive : ""} onClick={() => setStatus(item)} aria-pressed={status === item}>{item}</button>)}</div><button className={`${styles.mobileFilter} ${filtersOpen ? styles.filterActive : ""}`} aria-label="Toggle priority and category filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="filter" /></button><div className={`${styles.filters} ${filtersOpen ? styles.filtersVisible : ""}`}><label><span className={styles.srOnly}>Filter by priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="Any">Priority</option>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className={styles.srOnly}>Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="Any">Category</option><option value="">Uncategorized</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div></div>
          <div className={styles.listHeading}><span>{visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"}</span><span className={styles.remainingTasks}><Icon name="warning" size={14} />{activeCount} left to do</span></div>
          {visibleTasks.length ? <ul className={styles.taskList}>{visibleTasks.map((task) => <li key={task.id} className={`${styles.taskRow} ${editing?.id === task.id ? styles.selected : ""} ${task.completed ? styles.completed : ""}`}><label className={styles.taskCheck}><input type="checkbox" checked={task.completed} disabled={busy || (saved && storage.expired) || (dirty && editing?.id === task.id)} onChange={() => void toggleTask(task.id)} aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`} /><span><Icon name="check" size={15} /></span></label><button className={styles.taskDetails} onClick={() => openEditor(task)} aria-label={`Edit ${task.title}`}><span className={styles.taskText}><span className={styles.taskTitle}>{task.title}</span><span className={styles.taskNote}>{task.notes || "No notes added"}</span></span><span className={styles.taskMeta}>{task.category && <span className={styles.categoryLabel}><span className={`${styles.dot} ${categoryClass(task.category)}`} />{task.category}</span>}{task.priority !== "None" && <span className={`${styles.badge} ${styles[task.priority.toLowerCase()]}`}>{task.priority}</span>}<span className={`${styles.dueDate} ${isOverdue(task,today,saved ? clock.time : "00:00:00") ? styles.overdue : ""}`}>{task.date ? <><Icon name="calendar" size={13} />{task.date === today ? "Today" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${task.date}T12:00:00`))}{task.time && <span className={styles.dueTime}>{new Intl.DateTimeFormat("en", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(`${task.date}T${task.time}Z`))}</span>}</> : "No due date"}</span>{task.weekdays.length>0 && <span className={styles.weekdayMeta}>{task.weekdays.map(day=>WEEKDAYS[day].slice(0,3)).join(" · ")}</span>}{task.repeat !== "Off" && <span title={`Repeats ${task.repeat.toLowerCase()}`}><Icon name="repeat" size={14} /></span>}</span><span className={styles.rowChevron}><Icon name="chevron" size={17} /></span></button></li>)}</ul> : <div className={styles.empty}><div className={styles.emptyIcon}><Icon name={filteredEmpty ? "search" : "check"} size={29} /></div><h2>{activeEmpty ? (tasks.length ? "No active tasks" : "No tasks yet") : categoryEmpty ? `No tasks in ${category || "Uncategorized"} yet` : filtersApplied ? "No tasks found" : view === "Overdue" ? "All caught up" : view === "Completed" ? "Small wins start here" : saved && !tasks.length ? "No tasks yet" : "A little room for something new"}</h2><p>{activeEmpty ? (tasks.length ? "You’re all caught up. Add a task or select All to review completed tasks." : "Add a task and take the first step.") : categoryEmpty ? "Add your first task to this category." : filtersApplied ? "Try another search or adjust your filters." : view === "Overdue" ? "You don’t have any overdue tasks. Enjoy the breathing room." : view === "Completed" ? "Your completed tasks will appear here." : "Add a task and take the first step."}</p><button className={styles.emptyAction} onClick={filteredEmpty ? resetFilters : newTask}>{filteredEmpty ? "Clear filters" : "Add a task"}<Icon name={filteredEmpty ? "close" : "plus"} size={16} /></button></div>}
          </>}
          <p className={styles.listFooter}><span className={styles.smallLine} />A clear space for everything on your mind.</p>
        </section>
        {editing && !mobileEditor && <aside className={styles.editorAside} aria-label="Task editor">{editor}</aside>}
      </div>
    </main>
    {mobileEditor && editing && <Modal label={editing.id ? "Edit task" : "Add task"} onClose={closeEditor} className={styles.editorDialog}>{editor}</Modal>}
    {bulkCategory!==null && <Modal label="Add multiple tasks" onClose={()=>requestAction(finishBulk)} className={styles.bulkDialog}><BulkTaskEditor categories={categories} initialCategory={bulkCategory} onSave={saveMany} onClose={()=>requestAction(finishBulk)} onDirty={setDirty} pending={busy} uncertain={storage.uncertain}/></Modal>}
    {deleteTask && <Modal label="Delete this task?" onClose={cancelDelete} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>DELETE TASK</p><h2>Delete this task?</h2><p>“{deleteTask.title}” will be removed from your task list.</p>{deleteError&&<p className={styles.error} role="alert">{deleteError}</p>}{deleteConflict&&<button type="button" className={styles.cancelButton} onClick={()=>{setDeleteTask(null);openEditor(deleteConflict);}}>Review saved task</button>}<div className={styles.editorActions}><button className={styles.cancelButton} disabled={busy} data-autofocus="true" onClick={cancelDelete}>Cancel</button><button className={styles.deleteConfirm} disabled={busy || !!deleteConflict} onClick={()=>void confirmDelete()}>{busy?"Deleting…":"Delete task"}</button></div></div></Modal>}
    {queuedAction && <Modal label="Unsaved changes" onClose={keepEditing} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>YOUR CHANGES MATTER</p><h2>Keep your changes?</h2><p>You have unsaved changes in this editor.</p><div className={styles.editorActions}><button className={styles.saveButton} data-autofocus="true" onClick={keepEditing}>Keep editing</button><button className={styles.cancelButton} onClick={discardChanges}>Discard changes</button></div></div></Modal>}
    {reopenTask && <Modal label="Reopen this task?" onClose={cancelReopenTask} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>TASK STATUS</p><h2>Reopen this task?</h2><p>This task will be marked as active again.</p><div className={styles.editorActions}><button className={styles.cancelButton} data-autofocus="true" onClick={cancelReopenTask}>Keep completed</button><button className={styles.saveButton} onClick={()=>{setReopenTask(null);void toggleTask(reopenTask.id,reopenTask);}}>Reopen task</button></div></div></Modal>}
    <div className={styles.toastRegion} role="status" aria-live="polite">{message && <div className={styles.toast}><Icon name="check" size={17} />{message}</div>}</div>
  </div>;
}

function TaskEditor({ task, categories, onSave, onClose, onCategory, onDirty, saved, pending, uncertain, onLatest, onDelete }: { task: Task; categories: string[]; onSave: (task: Task) => Promise<void>; onClose: () => void; onCategory: (name: string) => Promise<string>; onDirty:(dirty:boolean)=>void; saved:boolean; pending:boolean; uncertain:boolean; onLatest:(task:Task)=>void; onDelete:(task:Task)=>void }) {
  const [draft, setDraft] = useState(task);
  const [error, setError] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [conflict,setConflict]=useState<Task|null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const priorityRef = useRef<HTMLSelectElement>(null);
  useEffect(()=>{onDirty(JSON.stringify(draft)!==JSON.stringify(task) || !!newCategory);},[draft,task,newCategory,onDirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  function update<K extends keyof Task>(key: K, value: Task[K]) { setDraft((current) => ({ ...current, [key]: value })); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) { setError("Give your task a title."); titleRef.current?.focus(); return; }
    if (draft.priority === "None") { setError("Choose a priority before saving."); priorityRef.current?.focus(); return; }
    if (draft.time && !draft.date) { setError("Choose a date to go with the time."); return; }
    if (draft.reminder !== "Off" && (!draft.date || (!draft.notification && !draft.email))) { setError("Choose a due date and at least one reminder channel."); return; }
    if(pending || conflict || (saved && !task.id && uncertain)) return;
    setError("");
    try {await onSave(draft);} catch(e) {
      setError(e instanceof Error ? e.message : "Unable to save. Your changes are still here.");
      if(e instanceof SaveError && e.latest) setConflict(e.latest);
    }
  }
  async function addCategory() {
    const name = newCategory.trim(); if (!name) return;
    const existing = categories.find((item) => item.toLowerCase() === name.toLowerCase());
    try {
      const chosen=existing || await onCategory(name);
      update("category",chosen); setNewCategory(""); setAddingCategory(false); setError("");
      window.requestAnimationFrame(()=>categoryRef.current?.focus());
    } catch(e) {setError(e instanceof Error ? e.message : "Category saving failed. Please try again.");}
  }
  return <div className={styles.editor}>
    <div className={styles.editorHeader}><div><span className={styles.editorEyebrow}>{task.id ? "THE DETAILS" : "A FRESH START"}</span><h2>{task.id ? "Edit task" : "Add task"}</h2></div><button disabled={pending} type="button" className={styles.iconButton} aria-label="Close editor" onClick={onClose}><Icon name="close" size={19} /></button></div>
    <form onSubmit={submit} className={styles.editorForm} noValidate aria-busy={pending}>
      <fieldset disabled={pending} className={styles.formFields}>
      <label className={styles.field}>Title <span className={styles.required}>*</span><input ref={titleRef} name="title" value={draft.title} onChange={(event) => { update("title", event.target.value); setError(""); }} placeholder="What would you like to do?" maxLength={200} required aria-invalid={!!error && !draft.title.trim()} aria-describedby={error ? "editor-error" : undefined} autoFocus={!task.id} data-autofocus={!task.id} /></label>
      <label className={styles.field}>Notes <span className={styles.optional}>optional</span><textarea name="notes" value={draft.notes} onChange={(event) => update("notes", event.target.value)} placeholder="A few helpful details…" rows={3} maxLength={4000} /></label>
      <div className={styles.editorDivider} />
      <label className={styles.property}><span><Icon name="check" size={17} />Status</span><select name="status" disabled={!task.id} value={draft.completed ? "Completed" : "Active"} onChange={(event) => update("completed", event.target.value === "Completed")}><option>Active</option><option>Completed</option></select></label>
      <TaskDays value={draft.weekdays} onChange={days=>update("weekdays",days)} />
      <div className={styles.dateFields}><label className={styles.field}><span><Icon name="calendar" size={16} />Due date</span><input type="date" name="date" value={draft.date} onInput={event=>{update("date",event.currentTarget.value);if(!event.currentTarget.value)update("time","");}} onChange={(event) => { update("date", event.target.value); if (!event.target.value) update("time", ""); }} /></label><label className={styles.field}><span><Icon name="clock" size={16} />Time <span className={styles.optional}>optional</span></span><input type="time" name="time" value={draft.time} onInput={event=>update("time",event.currentTarget.value)} onChange={(event) => update("time", event.target.value)} /></label></div>
      <label className={styles.property}><span><span className={styles.priorityGlyph}>⚑</span>Priority</span><select ref={priorityRef} name="priority" value={draft.priority === "None" ? "" : draft.priority} onChange={(event) => update("priority", event.target.value as Priority)}>{draft.priority === "None" && <option value="" disabled>Choose priority</option>}{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={styles.property}><span><span className={`${styles.dot} ${categoryClass(draft.category)}`} />Category</span><select ref={categoryRef} name="category" value={draft.category} onChange={(event) => { if (event.target.value === "__new") setAddingCategory(true); else update("category", event.target.value); }}><option value="">None</option>{categories.map((name) => <option key={name}>{name}</option>)}<option value="__new">+ New category</option></select></label>
      {addingCategory && <div className={styles.newCategory}><label className={styles.srOnly} htmlFor="new-category">New category name</label><input id="new-category" value={newCategory} maxLength={40} onChange={(event) => setNewCategory(event.target.value)} placeholder="Category name" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCategory(); } }} /><button type="button" onClick={addCategory}>Add</button><button type="button" aria-label="Cancel new category" onClick={() => setAddingCategory(false)}><Icon name="close" size={15} /></button></div>}
      <div className={styles.editorDivider} />
      <label className={styles.property}><span><Icon name="bell" size={17} />Reminder</span><select name="reminder" disabled={saved} value={saved ? "Coming soon" : draft.reminder} onChange={(event) => update("reminder", event.target.value)}>{saved ? <option>Coming soon</option> : <><option>Off</option><option>At due time</option><option>15 minutes before</option><option>1 hour before</option></>}</select></label>
      {draft.reminder !== "Off" && <div className={styles.reminderChannels}><label><input type="checkbox" checked={draft.notification} onChange={(event) => update("notification", event.target.checked)} />Notification</label><label><input type="checkbox" checked={draft.email} onChange={(event) => update("email", event.target.checked)} />Email</label></div>}
      <label className={styles.property}><span><Icon name="repeat" size={17} />Repeat</span><select name="repeat" disabled={saved} value={saved ? "Coming soon" : draft.repeat} onChange={(event) => update("repeat", event.target.value)}>{(saved ? ["Coming soon"] : ["Off", "Daily", "Weekly", "Monthly"]).map((item) => <option key={item}>{item}</option>)}</select></label>
      <p className={styles.editorHint}>Reminders and repeat scheduling will be connected in a later step.</p>
      {error && <p id="editor-error" className={styles.error} role="alert">{error}</p>}
      {saved && !task.id && uncertain && <p className={styles.error} role="alert">Saving could not be confirmed. Your draft is kept here. Close the editor when ready, then refresh and review your saved tasks before creating another.</p>}
      {conflict && <div className={styles.conflict}><h3>Latest saved version</h3><dl><dt>Title</dt><dd>{conflict.title}</dd><dt>Notes</dt><dd>{conflict.notes || "None"}</dd><dt>Status</dt><dd>{conflict.completed ? "Completed" : "Active"}</dd><dt>Due</dt><dd>{conflict.date || "None"} {conflict.time} · India time</dd><dt>Days</dt><dd>{conflict.weekdays.map(day=>WEEKDAYS[day]).join(", ") || "None"}</dd><dt>Priority / category</dt><dd>{conflict.priority} / {conflict.category || "None"}</dd></dl><button type="button" onClick={()=>onLatest(conflict)}>Use saved version</button><button type="button" onClick={()=>{setDraft(current=>({...current,updatedAt:conflict.updatedAt}));setConflict(null);setError("Reviewed. Your draft is kept; save when ready.");}}>Keep my draft after review</button></div>}
      {task.id && <button type="button" className={styles.deleteButton} disabled={!!conflict} onClick={()=>onDelete(task)}><Icon name="trash" size={17}/>Delete task</button>}
      <div className={styles.editorActions}><button type="button" className={styles.cancelButton} onClick={onClose}>Cancel</button><button disabled={!!conflict || (saved && !task.id && uncertain)} type="submit" className={styles.saveButton}><Icon name="check" size={17} />{pending ? "Saving…" : task.id ? "Save changes" : "Create task"}</button></div>
      </fieldset>
    </form>
  </div>;
}
