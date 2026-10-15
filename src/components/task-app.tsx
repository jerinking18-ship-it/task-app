"use client";
import MeetingOverview from "./meeting-overview";
import NeedsHelp from "./needs-help";
import {needsHelpCount} from "@/lib/tasks/needs-help";
import FinesPanel from "./fines/fines-panel";
import {useFines} from "@/lib/fines/use-fines";
import CapitalizedInput from "./capitalized-input";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import styles from "./task-app.module.css";
import { accountClock, completionAge, inHistory, isAvailable, sortTasksForStatus, repeatError, blankTask, newTaskDraft, categoryWeekdays, categoryOrder, MEETING_CATEGORIES, PRIORITIES, WEEKDAYS, isOverdue, type EditScope, type Priority, type Task } from "@/lib/tasks/model";
import { displayMemberName } from "@/lib/members/display-name";
import { taskCoverage, canTakeTask } from "@/lib/members/absence";
import {assignmentLabel,matchesAssignedTask,isChangedCompletion,isChangedAssignment} from "@/lib/tasks/assignment";
import { isCategoryTaskVisible, matchesCategoryTask } from "@/lib/tasks/meeting-period";
import { SaveError, useSavedTasks } from "@/lib/tasks/use-saved-tasks";
import AccountControls from "./auth/account-controls";
import BulkTaskEditor from "./bulk-task-editor";
import TemplatesForm from "./templates-form";
import { useTemplates } from "@/lib/templates/use-templates";
import type { TaskTemplate, TemplateItem } from "@/lib/templates/model";
import TaskRepeat from "./task-repeat";
import TaskTime from "./task-time";
import TaskAssignee from "./task-assignee";
import TaskBin from "./task-bin";
import { useLiveSync } from "@/lib/tasks/use-live-sync";
import { useBin } from "@/lib/tasks/use-bin";
import { useBinDrag } from "@/lib/tasks/use-bin-drag";
import type { BinTask, BinEntry } from "@/lib/tasks/bin";
import type { CompletedSnapshot } from "@/lib/tasks/completed";
import UsersPanel from "./members/users-panel";
import MemberHistoryPanel from "./members/member-history-panel";
import { useMemberHistory } from "@/lib/member-history/use-member-history";
import ProfilePanel from "./members/profile-panel";
import { decodeMemberResponse, canManageTasks, canChangeTaskStatus, type MemberState, type Member } from "@/lib/members/model";
type View = "Needs help" | "Meeting overview" | "Fines" | "All tasks" | "Today" | "Overdue" | "Completed" | "Member history" | "Users" | "Assigned to me" | "My profile" | "Bin";
type IconName = "grid" | "rupee" | "check" | "plus" | "search" | "list" | "calendar" | "clock" | "chevron" | "back" | "close" | "menu" | "filter" | "repeat" | "bell" | "warning" | "trash" | "history" | "active" | "users" | "templates" | "person" | "lock";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    grid:<><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
    rupee:<path d="M6 4h12M6 8h12M10 4c8 0 8 8-4 8l9 8"/>,
    person: <><circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
    templates: <><path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/></>,
    active: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/></>,
    history: <><path d="M3 5v5h5M3 10a9 9 0 1 1 1 8"/><path d="M12 7v5l3 2"/></>,
    check: <path d="m5 12 4 4L19 6" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    list: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 9h8M8 15h8" /></>,
    calendar: <><rect x="4" y="5" width="16" height="15" rx="3" /><path d="M8 3v4M16 3v4M4 10h16M8 14h3" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    chevron: <path d="m9 6 6 6-6 6" />,
    back: <path d="M20 12H4m7-7-7 7 7 7" />,
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

function historyDate(value: string | null, offset=0) {
  return value ? new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",year:"numeric"}).format(new Date(Date.parse(value)+offset*86400000)) : "—";
}
function CompletionTime({value}:{value:string|null}) {
  if(!value) return null;
  const date=new Date(value);
  if(!Number.isFinite(date.getTime())) return null;
  const options={timeZone:"Asia/Kolkata"};
  const day=new Intl.DateTimeFormat("en-US",{...options,month:"short",day:"numeric"}).format(date);
  const time=new Intl.DateTimeFormat("en-US",{...options,hour:"numeric",minute:"2-digit",hour12:true}).format(date);
  const weekday=new Intl.DateTimeFormat("en-US",{...options,weekday:"short"}).format(date);
  return <time className={styles.completionTime} dateTime={value}><Icon name="clock" size={13}/><span>Completed on {day} · {time} · {weekday}</span></time>;
}
function CompletedBy({name}:{name:string|null}) {
  return name ? <span className={styles.completedBy}><Icon name="person" size={13}/><span>Completed by <strong>{name}</strong></span></span> : null;
}
function CompletionAge({value,now}:{value:string|null;now:Date}) {
  const age=completionAge(value,now);
  return age ? <span className={styles.dueDate} aria-label={`Completed ${age.toLowerCase()}`}><Icon name="clock" size={13}/>{age}</span> : null;
}
function TaskStatus({task,today,time}:{task:Task;today:string;time:string}) {
  if(task.completed) return null;
  const overdue=isOverdue(task,today,time);
  return <span className={`${styles.taskStatus} ${overdue?styles.overdueStatus:styles.activeStatus}`}><Icon name={overdue?"warning":"active"} size={13}/>{overdue?"Overdue!":"Active"}</span>;
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
  { view: "Meeting overview", icon: "grid" },
  { view: "All tasks", icon: "list" }, { view: "Today", icon: "calendar" },
  { view: "Overdue", icon: "clock" }, {view:"Needs help",icon:"users"}, { view: "Completed", icon: "check" }, {view:"Member history",icon:"history"},
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
export default function TaskApp({ today: initialToday, accountControls, saved = false, passwordUpdated = false, initialMembers = null, initialView = "All tasks", accountEmail = null, accountId }: { today: string; accountControls?: ReactNode; saved?: boolean; passwordUpdated?: boolean; initialMembers?: MemberState | null; initialView?: View; accountEmail?: string | null; accountId?: string }) {
  const [dirty,setDirty]=useState(false);
  const endingSession=useRef(false);
  const storage=useSavedTasks(saved,dirty);
  useEffect(() => { if (saved && storage.expired) navigateAfterSignOut("/sign-in"); }, [saved, storage.expired]);
  const [previewTasks, setTasks] = useState(() => saved ? [] : sampleTasks(initialToday));
  const [previewCategories, setCategories] = useState(MEETING_CATEGORIES);
  const categories=categoryOrder(saved ? storage.categories.map(c=>c.name) : previewCategories);
  const [now,setNow]=useState(()=>new Date());
  const tasks=(saved ? storage.tasks : previewTasks).filter(task=>isAvailable(task,now));
  useEffect(()=>{const timer=window.setInterval(()=>setNow(new Date()),1000); return ()=>clearInterval(timer);},[]);
  const clock=accountClock(now,saved && storage.timezone ? storage.timezone : "UTC");
  const today=saved ? clock.date : initialToday;
  const [view, setView] = useState<View>(initialView);
  const [previewBin,setPreviewBin]=useState<BinTask[]>([]);
  const binButton=useRef<HTMLButtonElement>(null);
  const binTitle=useRef<HTMLHeadingElement>(null);
  const [purgeTasks,setPurgeTasks]=useState<BinEntry[]|null>(null);
  const [purgeError,setPurgeError]=useState("");
  const purgeFocus=useRef<HTMLElement|null>(null);
  const [clearCompleted,setClearCompleted]=useState(false);
  const [completedSnapshot,setCompletedSnapshot]=useState<CompletedSnapshot|null>(null);
  const [completedError,setCompletedError]=useState("");
  const completedFocus=useRef<HTMLElement|null>(null);
  const completedCancel=useRef<HTMLButtonElement>(null);
  const completedReturn=useRef(false);
  const [status, setStatus] = useState("Active");
  const [members, setMembers] = useState(initialMembers);
  const canManage=!saved||canManageTasks(members);
  const canStatus=(task:Task)=>!saved||(canChangeTaskStatus(members,task.assignedToId)&&!taskCoverage(task,new Date(now.getTime()+memberOffset)));
  const memberStamp=useRef(initialMembers?.serverNow?Date.parse(initialMembers.serverNow):0);
  const [memberOffset,setMemberOffset]=useState(()=>initialMembers?.serverNow?Date.parse(initialMembers.serverNow)-Date.now():0);
  const acceptMembers=useCallback((next:MemberState)=>{
    const stamp=next.serverNow?Date.parse(next.serverNow):Date.now();
    if(stamp<memberStamp.current)return;
    memberStamp.current=stamp;if(next.serverNow)setMemberOffset(stamp-Date.now());setMembers(next);
  },[]);
  const [accountPending, setAccountPending] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");
  const membersRead = useRef<AbortController | null>(null);
  const refreshMembers = useCallback(async (background=false) => {
    if (!saved || dirty || accountPending) return;
    membersRead.current?.abort(); const controller = new AbortController(); membersRead.current = controller;
    if(!background)setMembersLoading(true); setMembersError("");
    try {
      const response = await fetch("/api/members", { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      const body = await response.json();
      if (response.status === 401) { navigateAfterSignOut("/sign-in"); return; }
      if (!response.ok) throw new Error(typeof body?.message === "string" ? body.message : "Unable to load account members.");
      const next = decodeMemberResponse(body);
      if (!next.current || !next.workspace) { acceptMembers(next); throw new Error("Your workspace membership is no longer available. Sign out to continue."); }
      if (!controller.signal.aborted) acceptMembers(next);
    } catch (error) {
      if (!controller.signal.aborted) setMembersError(error instanceof Error ? error.message : "Unable to connect. Please refresh.");
    } finally { if (!controller.signal.aborted) setMembersLoading(false); }
  }, [saved, dirty, accountPending, acceptMembers]);
  useEffect(() => {
    if (view !== "Users" && view !== "My profile" && view !== "Meeting overview" && view !== "Needs help") return;
    void refreshMembers();
    const returned = () => { if (document.visibilityState === "visible") void refreshMembers(); };
    window.addEventListener("focus", returned);
    return () => { window.removeEventListener("focus", returned); membersRead.current?.abort(); };
  }, [view, refreshMembers]);
  const [priority, setPriority] = useState("Any");
  const [category, setCategory] = useState("Any");
  const [search, setSearch] = useState("");
  const [usersSearch,setUsersSearch]=useState("");
  const [editing, setEditing] = useState<Task | null>(() => saved ? null : sampleTasks(initialToday)[0]);
  const [editorVersion,setEditorVersion]=useState(0);
  const [bulkCategory,setBulkCategory]=useState<string|null>(null);
  const [bulkTemplate,setBulkTemplate]=useState<{name:string;items:TemplateItem[]}|null>(null);
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const [removeTemplate,setRemoveTemplate]=useState<TaskTemplate|null>(null);
  const [removeTemplateError,setRemoveTemplateError]=useState("");
  const removeTemplateFocus=useRef<HTMLElement|null>(null);
  const templates=useTemplates(saved&&canManage&&templatesOpen,dirty);
  const [deleteTask,setDeleteTask]=useState<Task|null>(null);
  const [deleteError,setDeleteError]=useState("");
  const [deleteConflict,setDeleteConflict]=useState<Task|null>(null);
  const deleteFocus=useRef<HTMLElement|null>(null);
  const [queuedAction,setQueuedAction]=useState<(()=>void)|null>(null);
  const [writeError,setWriteError]=useState("");
  const [statusConflict,setStatusConflict]=useState<Task|null>(null);
  const [takeTask,setTakeTask]=useState<Task|null>(null);
  const [takeError,setTakeError]=useState("");
  const takeFocus=useRef<HTMLElement|null>(null);
  const [reopenTask,setReopenTask]=useState<Task|null>(null);
  const reopenFocus=useRef<HTMLElement|null>(null);
  const signOutAnswer=useRef<((answer:boolean)=>void)|null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [message, setMessage] = useState("");
  const returnFocus = useRef<HTMLElement | null>(null);
  const bin=useBin(saved,dirty||storage.pending||accountPending);
  const busy=(saved && (storage.pending||bin.pending||templates.pending)) || accountPending;
  useEffect(()=>{if(saved&&templates.expired)navigateAfterSignOut("/sign-in");},[saved,templates.expired]);
  const fines=useFines(saved&&view==="Fines"&&canManageTasks(members),dirty||busy);
  useEffect(()=>{if(fines.expired)navigateAfterSignOut("/sign-in");},[fines.expired]);
  const history=useMemberHistory(saved&&view==="Member history",dirty||busy);
  useEffect(()=>{if(history.expired)navigateAfterSignOut("/sign-in");},[history.expired]);
  const historyNow=new Date(now.getTime()+history.clockOffset);
  const binTasks=saved?bin.tasks:previewBin;
  const live=useLiveSync({enabled:saved&&!storage.expired,accountId,blocked:dirty||busy||clearCompleted||!!deleteTask||!!purgeTasks||!!removeTemplate,
    onTasks:()=>{void storage.refresh(true);void bin.refresh(true);void templates.refresh(true);void history.refresh(true);void fines.refresh(true);},onMembers:()=>{void refreshMembers(true);void history.refresh(true);void fines.refresh(true);},
    onPresence:acceptMembers,onExpired:()=>navigateAfterSignOut("/sign-in")});
  const memberNow=new Date(now.getTime()+memberOffset);
  const memberNameKey=JSON.stringify((members?.members??[]).map(member=>[member.id,member.name]).sort((a,b)=>a[0].localeCompare(b[0])));
  const previousMemberNameKey=useRef(memberNameKey);
  useEffect(()=>{
    if(previousMemberNameKey.current===memberNameKey)return;
    previousMemberNameKey.current=memberNameKey;
    // Rename/join/leave events refresh attribution projections without fetching
    // task data on every presence heartbeat. Existing draft guards defer reads.
    void storage.refresh(true);void bin.refresh(true);void history.refresh(true);void fines.refresh(true);
  },[memberNameKey,storage.refresh,bin.refresh,history.refresh,fines.refresh]);
  useEffect(()=>{
    if(completedReturn.current&&!clearCompleted&&!busy&&!storage.loading&&!storage.deferred){
      completedReturn.current=false;if(completedFocus.current?.isConnected)completedFocus.current.focus();
    }
  },[clearCompleted,busy,storage.loading,storage.deferred]);
  useEffect(()=>{if(view==="Bin")binTitle.current?.focus({preventScroll:true});},[view]);
  const drag=useBinDrag(binButton,!canManage||busy||dirty||!!deleteTask||!!purgeTasks||!!removeTemplate||clearCompleted||(saved&&(!storage.ready||storage.expired)),askDelete,openEditor);
  useEffect(()=>{drag.cancel();},[view,status,priority,category,search]);
  useEffect(()=>{if(saved)void bin.refresh();},[saved,storage.tasks.length,bin.refresh]);
  useEffect(()=>{
    if(!dirty && !busy) return;
    const warn=(event:BeforeUnloadEvent)=>{if(endingSession.current)return; event.preventDefault(); event.returnValue="";};
    window.addEventListener("beforeunload",warn); return ()=>window.removeEventListener("beforeunload",warn);
  },[dirty,busy]);
  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [message]);
  const displayedStatus=view==="Overdue"?"Overdue":view==="Completed"?"Completed":status;
  const statusOptions=view==="Overdue"?["Overdue"]:view==="Completed"?["Completed"]:["Active","Completed","Overdue","All"];
  const currentFilters={view,status:displayedStatus,priority,category,search};
  const matches=(task:Task)=>view==="Assigned to me"?matchesAssignedTask(task,members?.current?.id,currentFilters,today,saved?clock.time:"00:00:00",now):matchesCategoryTask(task,currentFilters,today,saved ? clock.time : "00:00:00",now);
  const categoryTasks=tasks.filter(task=>isCategoryTaskVisible(task,now,today,saved ? clock.time : "00:00:00"));
  const visibleTasks=sortTasksForStatus(tasks.filter(matches),displayedStatus);
  const completedCount=visibleTasks.filter(task=>task.completed).length;
  const remainingCount=visibleTasks.length-completedCount;
  const filtersApplied = search !== "" || priority !== "Any" || category !== "Any" || status !== "All";
  const categoryEmpty = category!=="Any" && view==="All tasks" && !search && priority==="Any" && status==="All";
  const periodEmpty = view==="All tasks" && category!=="Any" && !search && priority==="Any"
    && tasks.some(task=>task.category===category && !inHistory(task,now) && !categoryTasks.includes(task));
  const activeEmpty = view==="All tasks" && status==="Active" && !search && priority==="Any" && category==="Any";
  const overdueEmpty = (status==="Overdue" || view==="Overdue") && !search && priority==="Any" && category==="Any";
  const filteredEmpty = filtersApplied && !categoryEmpty && !activeEmpty && !overdueEmpty && !periodEmpty;
  const navigationCounts: Partial<Record<View, number>> = {
    "Needs help":needsHelpCount(tasks,now,memberNow),
    "Assigned to me":tasks.filter(task=>task.assignedToId===members?.current?.id && !task.completed && !inHistory(task,now) && isCategoryTaskVisible(task,now,today,saved?clock.time:"00:00:00")).length,
    "All tasks": tasks.filter(task => !inHistory(task, now)).length,
    Today: tasks.filter(task => !task.completed && task.date === today).length,
    Overdue: tasks.filter(task => isOverdue(task, today, saved ? clock.time : "00:00:00")).length,
  };
  function openEditor(task: Task) {
    if(busy || (saved && !storage.ready)) return;
    if(!saved && !task.id) {requestAction(()=>window.location.assign("/sign-in")); return;}
    const trigger=drag.held?drag.origin.current:document.activeElement;
    drag.cancel();
    returnFocus.current = trigger instanceof HTMLElement ? trigger : null;
    requestAction(()=>{setBulkCategory(null);setEditing({ ...task,weekdays:[...task.weekdays] }); setDirty(false); setEditorVersion(v=>v+1);});
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
  function keepEditing() {setQueuedAction(null); if(view === "My profile") setMenuOpen(false); signOutAnswer.current?.(false); signOutAnswer.current=null;}
  function discardChanges() {const action=queuedAction; setQueuedAction(null); setDirty(false); action?.();}
  function beforeSignOut():Promise<boolean> {
    if(busy) return Promise.resolve(false);
    if(!dirty) {live.deactivate();return Promise.resolve(true);}
    return new Promise(resolve=>{signOutAnswer.current=resolve; setQueuedAction(()=>()=>{setEditing(null);setBulkCategory(null); live.deactivate();resolve(true); signOutAnswer.current=null;});});
  }
  function navigateAfterSignOut(url:string) { endingSession.current=true; window.location.assign(url); }
  function finishEditor() {setDirty(false); setEditing(null); restoreFocus();}
  function closeEditor() {requestAction(finishEditor);}
  function newTask() {if(!canManage)return;openEditor(newTaskDraft(category==="Any"?"":category));}
  function openBulk() {
    if(!canManage)return;
    if(busy || (saved && !storage.ready)) return;
    if(!saved) {requestAction(()=>window.location.assign("/sign-in"));return;}
    returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    requestAction(()=>{setEditing(null);setDirty(false);setBulkTemplate(null);setBulkCategory(category==="Any"?(categories[0]??""):category);});
  }
  function finishBulk() {setDirty(false);setBulkCategory(null);setBulkTemplate(null);restoreFocus();}
  function openTemplates() {
    if(!canManage)return;
    if(busy || (saved && !storage.ready))return;
    if(!saved){requestAction(()=>window.location.assign("/sign-in"));return;}
    const trigger=document.activeElement instanceof HTMLElement?document.activeElement:null;
    requestAction(()=>{returnFocus.current=trigger;setEditing(null);setBulkCategory(null);setBulkTemplate(null);setDirty(false);setTemplatesOpen(true);});
  }
  function askRemoveTemplate(template:TaskTemplate){if(busy)return;removeTemplateFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setRemoveTemplateError("");setRemoveTemplate({...template,items:template.items.map(item=>({...item}))});}
  function cancelRemoveTemplate(){if(busy)return;setRemoveTemplate(null);if(removeTemplateError){void templates.refresh();void bin.refresh();}setRemoveTemplateError("");window.requestAnimationFrame(()=>{if(removeTemplateFocus.current?.isConnected)removeTemplateFocus.current.focus();});}
  async function confirmRemoveTemplate(){
    if(!removeTemplate||busy||removeTemplateError)return;
    try{await templates.remove(removeTemplate);setRemoveTemplate(null);setMessage("Template moved to Bin");void bin.refresh();window.requestAnimationFrame(()=>document.getElementById("templates-library-title")?.focus());}
    catch(reason){setRemoveTemplateError(reason instanceof Error?reason.message:"Removal could not be confirmed. Close and refresh templates.");}
  }
  function finishTemplates(){setTemplatesOpen(false);setDirty(false);restoreFocus();}
  function useTemplate(template:TaskTemplate){
    requestAction(()=>{setTemplatesOpen(false);setEditing(null);setDirty(false);setBulkTemplate({name:template.name,items:template.items.map(item=>({...item}))});setBulkCategory(category==="Any"?(categories[0]??""):category);});
  }
  async function saveMany(drafts:Task[],chosenCategory:string) {
    const results=await storage.saveMany(drafts,chosenCategory);
    finishBulk();setMessage(`${results.length} ${results.length===1?"task":"tasks"} created`);
  }
  function askDelete(task:Task) {
    if(!canManage||busy) return;
    const trigger=drag.held||drag.drag?drag.origin.current:document.activeElement;
    drag.cancel();
    deleteFocus.current=trigger instanceof HTMLElement?trigger:null;
    setDeleteError("");setDeleteConflict(null);setDeleteTask({...task,weekdays:[...task.weekdays]});
  }
  function closeTaskActions(){const trigger=drag.origin.current;drag.cancel();window.requestAnimationFrame(()=>{if(trigger?.isConnected)trigger.focus();});}
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
      else {setPreviewBin(current=>[{...deleteTask,deletedAt:new Date().toISOString(),deletedByName:members?.current?.name??null},...current]);setTasks(current=>current.filter(task=>task.id!==deleteTask.id));}
      setDeleteTask(null);finishEditor();setMessage("Task moved to Bin");void bin.refresh();
    } catch(e) {
      setDeleteError(e instanceof Error?e.message:"Unable to delete. Your task is still here.");
      if(e instanceof SaveError && e.latest)setDeleteConflict(e.latest);
    }
  }
  function chooseView(next: View) {
    if(saved && (next==="Assigned to me" || next==="Fines")){
      if(view===next){setMenuOpen(false);return;}
      requestAction(()=>window.location.assign(next==="Fines"?"/account/fines":"/account/assigned-to-me"));return;
    }
    if (next === "My profile" && view === next) { setMenuOpen(false); return; }
    const change = () => { if (next === "Needs help" || next === "Meeting overview" || next === "Users" || next === "My profile" || next === "Bin" || next === "Member history" || next === "Fines" || view === "Fines" || view === "Bin" || view === "My profile") { finishEditor(); setBulkCategory(null); } setView(next); resetFilters(); setStatus(next === "Completed" ? "Completed" : next === "Overdue" ? "Overdue" : next === "Member history" ? "All" : "Active"); setMenuOpen(false); };
    if (next === "Needs help" || next === "Meeting overview" || next === "Users" || next === "My profile" || next === "Bin" || next === "Member history" || next === "Fines" || view === "Fines" || view === "Bin" || view === "My profile" || busy) requestAction(change); else change();
  }
  function openBin(){drag.cancel();chooseView("Bin");void bin.refresh();}
  function askClearCompleted() {
    if(!canManage || busy || !saved || !storage.ready) return;
    completedFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    requestAction(()=>{
      finishEditor();setBulkCategory(null);setClearCompleted(true);setCompletedSnapshot(null);setCompletedError("");

    });
  }
  useEffect(()=>{
    if(!clearCompleted)return;
    let current=true;
    void storage.reviewCompleted().then(snapshot=>{if(current){setCompletedSnapshot(snapshot);window.requestAnimationFrame(()=>completedCancel.current?.focus());}}).catch(reason=>{if(current){setCompletedError(reason instanceof Error?reason.message:"Unable to confirm completed tasks.");window.requestAnimationFrame(()=>completedCancel.current?.focus());}});
    return ()=>{current=false;};
  },[clearCompleted]);
  function cancelClearCompleted(){
    if(busy)return;
    setClearCompleted(false);setCompletedSnapshot(null);setCompletedError("");
    completedReturn.current=true;
  }
  async function confirmClearCompleted(){
    if(busy || !completedSnapshot || !completedSnapshot.count || completedError) return;
    try {
      await storage.purgeCompleted(completedSnapshot);
      setClearCompleted(false);setCompletedSnapshot(null);setMessage(`${completedSnapshot.count} completed ${completedSnapshot.count===1?"task":"tasks"} permanently deleted`);
      completedReturn.current=true;
    } catch(reason){setCompletedError(reason instanceof Error?reason.message:"Deletion could not be confirmed. Close and refresh before trying again.");window.requestAnimationFrame(()=>completedCancel.current?.focus());}
  }
  async function restoreBin(items:BinEntry[]){
    if(saved){await bin.mutate("restore",items);void storage.refresh();void templates.refresh(true);void history.refresh(true);}
    else {setPreviewBin(current=>current.filter(task=>!items.some(item=>item.id===task.id)));setTasks(current=>[...current,...items.filter((item):item is BinTask & {kind:"task"}=>item.kind==="task").map(task=>({...task,historyAt:null}))]);}
    setMessage(`${items.length===1?(items[0].kind==="template"?"Template":"Task"):`${items.length} items`} restored`);
  }
  function askPurge(items:BinEntry[]){if(busy)return;purgeFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setPurgeError("");setPurgeTasks(items.map(task=>({...task})));}
  function cancelPurge(){if(busy)return;setPurgeTasks(null);setPurgeError("");window.requestAnimationFrame(()=>{if(purgeFocus.current?.isConnected)purgeFocus.current.focus();});}
  async function confirmPurge(){
    if(!purgeTasks||busy)return;setPurgeError("");
    try{if(saved)await bin.mutate("purge",purgeTasks);else setPreviewBin(current=>current.filter(task=>!purgeTasks.some(item=>item.id===task.id)));setPurgeTasks(null);setMessage(`${purgeTasks.length===1?(purgeTasks[0].kind==="template"?"Template":"Task"):`${purgeTasks.length} items`} permanently deleted`);}
    catch(reason){setPurgeError(reason instanceof Error?reason.message:"Refresh Bin before trying again.");}
  }
  function chooseStatus(next:string) {
    if((view==="Completed" && next!=="Completed") || (view==="Overdue" && next!=="Active" && next!=="Overdue")) setView("All tasks");
    setStatus(next);
  }
  function cancelReopenTask() {
    setReopenTask(null);
    window.requestAnimationFrame(()=>{if(reopenFocus.current?.isConnected) reopenFocus.current.focus();});
  }
  function cancelTakeTask(){
    if(busy)return;setTakeTask(null);if(takeError)void storage.refresh();setTakeError("");
    window.requestAnimationFrame(()=>takeFocus.current?.isConnected&&takeFocus.current.focus());
  }
  function askTakeTask(task:Task){
    if(busy||dirty||storage.expired||!canTakeTask(task,members,memberNow))return;
    takeFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setTakeError("");setTakeTask(task);
  }
  async function confirmTakeTask(){
    const coverage=takeTask&&taskCoverage(takeTask,memberNow);
    if(!takeTask||!coverage||busy||!canTakeTask(takeTask,members,memberNow))return;
    try{await storage.take(takeTask,coverage.absenceId);setTakeTask(null);setMessage("Task assigned to you");window.requestAnimationFrame(()=>document.getElementById("task-page-title")?.focus());}
    catch(reason){setTakeError(reason instanceof Error?reason.message:"Taking this task could not be confirmed. Close and refresh before trying again.");}
  }
  async function toggleTask(id: string, confirmedReopen?: Task) {
    const task = confirmedReopen ?? tasks.find((item) => item.id === id);
    if (!task || !canStatus(task) || busy || (saved && (!storage.ready || storage.expired)) || (dirty && editing?.id===id)) return;
    if(task.completed && !confirmedReopen) {
      reopenFocus.current=document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setReopenTask(task); return;
    }
    if(saved) {
      setWriteError(""); setStatusConflict(null);
      try {
        const result=await storage.toggle(task);
        if(editing?.id===id) {setEditing(result);setEditorVersion(v=>v+1);}
        setMessage(result.completed ? "Task completed" : "Task reopened");
      } catch(error) {setWriteError(error instanceof Error ? error.message : "Unable to save status."); if(error instanceof SaveError && error.latest) setStatusConflict(error.latest);}
      return;
    }
    setTasks((current) => current.map((item) => item.id === id ? { ...item, completed: !item.completed } : item));
    if (editing?.id === id) setEditing({ ...editing, completed: !task.completed });
    setMessage(task.completed ? "Task reopened in this preview" : "Task completed in this preview");
  }
  async function saveTask(task: Task, scope:EditScope="this") {
    if(!canManage)throw new SaveError("Your current role cannot save task details.",403);
    if(!saved && !task.id) {requestAction(()=>window.location.assign("/sign-in")); return;}
    if(saved) {
      await storage.save(task,scope);
      finishEditor(); setMessage(task.id ? "Changes saved" : "Task created"); return;
    }
    const previewSaved = { ...task, id: task.id || crypto.randomUUID(), title: task.title.trim(), notes: task.notes.trim() };
    setTasks((current) => task.id ? current.map((item) => item.id === task.id ? previewSaved : item) : [...current, previewSaved]);
    finishEditor();
    setMessage(task.id ? "Changes saved in this preview" : "Task added in this preview");
  }
  function resetFilters() { setSearch(""); setPriority("Any"); setCategory("Any"); setStatus("All"); }
  async function addCategory(name:string) {
    if(saved) return storage.addCategory(name);
    setCategories(current=>[...current,name]); return name;
  }
  async function setupAccount() {setWriteError(""); try {await storage.setup();} catch(e) {setWriteError(e instanceof Error ? e.message : "Setup failed. Please retry.");}}
  async function retrySetup() {setWriteError(""); try {await storage.initialize();} catch(e) {setWriteError(e instanceof Error ? e.message : "Setup failed. Please retry.");}}
  function sidebar(mobile = false) {
    return <>
      <div className={styles.brand}><span className={styles.brandMark}><Icon name="check" size={23} /></span><span>BGM Task<span className={styles.brandDot}>.</span></span>{mobile && <button className={styles.menuClose} aria-label="Close navigation" onClick={() => setMenuOpen(false)}><Icon name="close" /></button>}</div>
      <nav aria-label="Task views" className={styles.navigation}>{navItems.map((item) => <button key={item.view} className={`${styles.navItem} ${view === item.view ? styles.navActive : ""} ${view==="Member history" && item.view==="Member history"?styles.historySelected:""}`} onClick={() => chooseView(item.view)} aria-current={view === item.view ? "page" : undefined}><Icon name={item.icon} /><span>{item.view}</span>{navigationCounts[item.view] !== undefined && <span className={styles.navCount}>{saved && !storage.hasData ? "…" : navigationCounts[item.view]}</span>}</button>)}</nav>
      {(saved || members) && <nav aria-label="Account" className={styles.memberNavigation}><button className={`${styles.navItem} ${view === "Users" ? styles.navActive : ""}`} aria-current={view === "Users" ? "page" : undefined} onClick={() => chooseView("Users")}><Icon name="users"/><span>Users</span><span className={styles.navCount}>{members ? `${members.members.length}/10` : "…"}</span></button><button className={`${styles.navItem} ${styles.assignedNav} ${view === "Assigned to me" ? styles.navActive : ""}`} aria-current={view === "Assigned to me" ? "page" : undefined} onClick={() => chooseView("Assigned to me")}><Icon name="person"/><span>Assigned to me</span><span className={styles.navCount}>{navigationCounts["Assigned to me"]??0}</span></button><button className={`${styles.navItem} ${view==="Fines"?styles.navActive:""}`} aria-current={view==="Fines"?"page":undefined} onClick={()=>chooseView("Fines")}><Icon name="rupee"/><span>Fines</span></button></nav>}
      <div className={styles.categorySection}><p className={styles.eyebrow}>Categories</p><nav aria-label="Categories">{categories.map((name) => <button key={name} className={`${styles.categoryNav} ${category === name ? styles.categoryActive : ""}`} onClick={() => { const change=()=>{ if(view === "My profile") finishEditor(); resetFilters(); setStatus("Active"); setCategory(name); setView("All tasks"); setMenuOpen(false); }; if(view === "My profile" || busy) requestAction(change); else change(); }} aria-pressed={category === name}><span className={`${styles.dot} ${categoryClass(name)}`} />{name}<span className={styles.categoryCount}>{categoryTasks.filter((task) => task.category === name).length}</span></button>)}</nav></div>
      <div className={styles.sidebarFooter}>{members?.current && <button type="button" className={styles.profileLink} aria-label={`Open My profile for ${members.current.name}`} aria-current={view === "My profile" ? "page" : undefined} onClick={() => chooseView("My profile")}/>}<span className={styles.footerMark}>{members?.current ? Array.from(members.current.name)[0]?.toLocaleUpperCase() : <Icon name="check" size={16} />}</span><div>{members?.current ? <><strong>{members.current.name}</strong><span>Your member profile</span></> : <>A little more clarity.<span>One task at a time.</span></>}</div></div>
    </>;
  }
  const editor = editing && <TaskEditor key={`${editing.id || "new"}-${editorVersion}`} task={editing} currentMemberId={members?.current?.id} members={members?.members??[]} canManage={canManage} canStatus={canStatus(editing)} categories={categories} onSave={saveTask} onClose={closeEditor} onCategory={addCategory} onDirty={setDirty} saved={saved} pending={busy} uncertain={storage.uncertain} onLatest={openEditor} onDelete={askDelete} />;
  return <div className={styles.app}>
    <a className={styles.skipLink} href="#task-content">Skip to tasks</a>
    <aside className={styles.sidebar}>{sidebar()}</aside>
    {menuOpen && <Modal label="Navigation" onClose={() => setMenuOpen(false)} className={styles.menuDialog}><div className={styles.drawer}>{sidebar(true)}</div></Modal>}
    <main id="task-content" className={`${styles.workspace} ${!["Needs help","Meeting overview","Bin","Users","My profile","Member history","Fines"].includes(view)?styles.taskWorkspace:""} ${!["Needs help","Meeting overview","Bin","Member history","Users","My profile","Fines"].includes(view)?canManage?styles.templatesAvailable:"":""} ${view==="Needs help"?`${styles.overviewWorkspace} ${styles.needsHelpWorkspace}`:view==="Meeting overview"?styles.overviewWorkspace:view==="Fines"?styles.finesWorkspace:view==="Bin"?styles.binWorkspace:view==="Member history"?styles.memberHistoryWorkspace:view==="Users"?styles.usersWorkspace:view==="My profile"?styles.profileWorkspace:""}`}>
      {(saved || accountControls) && <div className={styles.accountBar}>{saved ? <AccountControls passwordUpdated={passwordUpdated} beforeSignOut={beforeSignOut} blocked={busy} onPendingChange={setAccountPending} onSignedOut={navigateAfterSignOut} /> : accountControls}</div>}
      <header className={styles.header}>
        <div className={styles.heading}>{view==="Bin"&&<button className={styles.binBack} disabled={busy} onClick={()=>{chooseView("All tasks");window.requestAnimationFrame(()=>binButton.current?.focus());}} aria-label="Back to tasks"><Icon name="back" size={21}/><span>Back to tasks</span></button>}<button className={styles.mobileMenu} aria-label="Open navigation" onClick={() => setMenuOpen(true)}><Icon name="menu" size={23} /></button><div><p className={styles.overline}>{view==="Meeting overview"?"MEETING INSIGHTS":"YOUR SPACE, YOUR PACE"}</p><h1 id="task-page-title" ref={view==="Bin"?binTitle:undefined} tabIndex={-1}>{category !== "Any" ? (view === "All tasks" ? category || "Uncategorized" : `${view} · ${category || "Uncategorized"}`) : view === "All tasks" ? "All tasks" : view}</h1><p className={styles.date}>{view==="Member history"?"Completed work by member":view==="My profile"?"Your profile and workspace":new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${today}T12:00:00`))}</p></div></div>
        {view==="Fines"&&canManageTasks(members)&&<div className={styles.headerActions}><label className={styles.search}><Icon name="search" size={19}/><span className={styles.srOnly}>Search fines</span><input type="search" placeholder="Search fines…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}
        {view==="Needs help"&&<div className={styles.headerActions}><label className={styles.search}><Icon name="search" size={19}/><span className={styles.srOnly}>Search tasks needing help</span><input type="search" placeholder="Search tasks needing help…" value={search} onChange={e=>setSearch(e.target.value)}/></label></div>}
        {view==="Users"&&<div className={styles.headerActions}><label className={styles.search}><Icon name="search" size={19}/><span className={styles.srOnly}>Search members</span><input type="search" placeholder="Search members…" value={usersSearch} onChange={e=>setUsersSearch(e.target.value)}/></label></div>}
        {view!=="Needs help" && view!=="Meeting overview" && view!=="Users" && view!=="My profile" && view!=="Member history" && view!=="Fines" && <div className={styles.headerActions}><label className={styles.search}><Icon name="search" size={19} /><span className={styles.srOnly}>{view==="Bin"?"Search deleted items":"Search tasks"}</span><input type="search" placeholder={view==="Bin"?"Search deleted items…":"Search your tasks…"} value={search} onChange={(event) => setSearch(event.target.value)} /></label>{view!=="Bin" && canManage && <><button className={styles.templatesButton} aria-label="Open templates" title="Templates" disabled={busy || (saved && (!storage.ready || storage.expired))} onClick={openTemplates}><Icon name="templates" size={21}/></button><button className={styles.addButton} disabled={busy || (saved && (!storage.ready || storage.expired))} onClick={newTask}><Icon name="plus" size={19} />Add task</button><button className={`${styles.addButton} ${styles.bulkButton}`} disabled={busy || (saved && (!storage.ready || storage.expired))} onClick={openBulk}><Icon name="plus" size={19} />Add multiple tasks</button></>}{view!=="Bin"&&<button ref={binButton} className={`${styles.binButton} ${drag.drag?styles.binDragReady:""} ${drag.drag?.over?styles.binDropActive:""}`} aria-label={`Open Bin${saved&&!bin.loaded?"":` (${binTasks.length+(saved&&canManage?bin.templates.length:0)} ${binTasks.length+(saved&&canManage?bin.templates.length:0)===1?"item":"items"})`}`} title={drag.drag?"Release to move to Bin":"Open Bin"} disabled={busy} onClick={openBin}><Icon name="trash" size={21}/><span className={styles.binCount}>{saved&&!bin.loaded?"…":binTasks.length+(saved&&canManage?bin.templates.length:0)}</span></button>}</div>}
      </header>
      {view!=="Needs help" && view!=="Meeting overview" && view!=="Users" && view!=="My profile" && view!=="Bin" && view!=="Member history" && view!=="Fines" && (saved ? <div className={styles.previewNotice}><span className={styles.previewDot} />{members?.workspace?.name??"My saved tasks"}<span className={styles.noticeDivider}>·</span><span>{storage.timezone ? "India time · Mumbai" : storage.hasData ? "Account setup" : storage.loading ? "Loading account…" : "Account unavailable"}</span><div className={`${styles.refreshActions} ${view==="Completed"?styles.completedRefresh:""}`}><button className={styles.refreshButton} disabled={storage.loading || busy} onClick={()=>void storage.refresh()}>{storage.loading ? "Refreshing…" : "Refresh"}</button>{view==="Completed"&&canManage&&<button className={styles.clearCompletedButton} aria-label="Delete all completed tasks" title="Delete all completed tasks" disabled={busy||storage.loading||!storage.ready||storage.expired} onClick={askClearCompleted}><Icon name="trash" size={21}/></button>}</div></div> : <div className={styles.previewNotice}><span className={styles.previewDot} />Design preview<span className={styles.noticeDivider}>·</span><span>Sample tasks. Changes reset on refresh.</span><Link href="/sign-in" className={styles.signInLink}>Sign in <span aria-hidden="true">↗</span></Link></div>)}
      {view==="Needs help" ? <NeedsHelp tasks={tasks} members={members?.members??[]} memberState={members} currentMemberId={members?.current?.id} now={now} coverageNow={memberNow} workspaceName={members?.workspace?.name??"Workspace"} loaded={!saved||storage.hasData} ready={!saved||storage.ready} timezone={saved?storage.timezone:"Asia/Kolkata"} loading={storage.loading||membersLoading} pending={busy||dirty||storage.expired} error={storage.error||writeError||membersError} deferred={storage.deferred} search={search} onTake={askTakeTask} onRefresh={()=>{void storage.refresh();void refreshMembers();}} onSetup={()=>void(storage.timezone?retrySetup():setupAccount())}/> : view==="Meeting overview" ? <MeetingOverview tasks={tasks} members={members?.members??[]} currentMemberId={members?.current?.id} now={now} coverageNow={memberNow} workspaceName={members?.workspace?.name??"Workspace"} loaded={!saved||storage.hasData} ready={!saved||storage.ready} timezone={saved?storage.timezone:"Asia/Kolkata"} loading={storage.loading} pending={busy} error={storage.error||writeError} deferred={storage.deferred} onRefresh={()=>{void storage.refresh();void refreshMembers();}} onSetup={()=>void(storage.timezone?retrySetup():setupAccount())}/> : view==="Fines" ? <FinesPanel allowed={canManageTasks(members)} data={fines.data} members={members?.members??[]} loading={fines.loading} pending={fines.pending} error={fines.error} forbidden={fines.forbidden} deferred={fines.deferred} search={search} workspaceName={members?.workspace?.name??"Workspace"} onRefresh={()=>void fines.refresh()} onMutate={fines.mutate} onBack={()=>requestAction(()=>window.location.assign("/account"))} onDirty={setDirty} onPending={setAccountPending}/> : view==="Member history" ? <MemberHistoryPanel currentMembers={members?.members??[]} data={history.data} loading={history.loading} error={history.error} now={historyNow} currentMemberId={members?.current?.id} hasSpecialTasks={tasks.some(task=>task.category==="Special Meeting")} onRefresh={()=>void history.refresh()}/> : view==="Bin" ? <TaskBin members={members?.members??[]} canManage={canManage} tasks={binTasks} templates={saved&&canManage?bin.templates:[]} search={search} now={now} loaded={!saved||bin.loaded} loading={bin.loading} pending={busy} error={bin.error} expired={bin.expired} needsMember={bin.needsMember} onRefresh={()=>void bin.refresh()} onRestore={restoreBin} onPurge={askPurge}/> : view==="My profile" ? <ProfilePanel state={members} categories={storage.categories} hasSpecialTasks={tasks.some(task=>task.category==="Special Meeting")} email={accountEmail} loading={membersLoading} error={membersError} disabled={busy} now={memberNow} onRefresh={()=>void refreshMembers()} onUsers={()=>chooseView("Users")} onSaved={next=>{acceptMembers(next);void storage.refresh();}} onDirty={setDirty} onPending={setAccountPending} beforeSignOut={beforeSignOut} onSignedOut={navigateAfterSignOut}/> : view==="Users" ? <UsersPanel search={usersSearch} state={members} loading={membersLoading} error={membersError} onRefresh={()=>void refreshMembers()} onSaved={acceptMembers} now={memberNow}/> : <div className={styles.content}>
        <section className={styles.taskSection} aria-label="Tasks">
          {saved && <>
            {storage.deferred && <p className={styles.inlineNotice} role="status">Refresh queued. Finish editing or saving to load updates.</p>}
            {storage.loading && !storage.hasData && <div className={styles.empty} role="status"><div className={styles.emptyIcon}><Icon name="clock" size={29}/></div><h2>Loading your space…</h2><p>Getting your saved tasks ready.</p></div>}
            {(storage.error || writeError) && <div className={styles.inlineError} role="alert"><p>{writeError || storage.error}</p>{storage.needsMember ? <Link href="/account/member" onClick={event=>{if(dirty){event.preventDefault();requestAction(()=>window.location.assign("/account/member"));}}}>Choose your name</Link> : storage.expired ? <Link href="/sign-in" onClick={event=>{if(dirty){event.preventDefault();requestAction(()=>window.location.assign('/sign-in'));}}}>Sign in again</Link> : <button onClick={()=>void storage.refresh()} disabled={busy || storage.loading}>Refresh saved data</button>}{statusConflict && <button onClick={()=>openEditor(statusConflict)}>Review saved task</button>}</div>}
            {storage.hasData && !storage.timezone && !storage.expired && <div className={styles.empty}><div className={styles.emptyIcon}><Icon name="clock" size={29}/></div><h2>A home for your time</h2><p>Use India time (Mumbai · IST) so deadlines stay consistent on every device. This version supports India time.</p><button className={styles.emptyAction} disabled={busy} onClick={()=>void setupAccount()}>{busy ? "Setting up…" : "Use India time"}</button></div>}
            {!!storage.timezone && !storage.ready && <div className={styles.empty} role="status"><h2>Preparing your categories</h2><p>Your five meeting categories are being prepared. Your task list starts empty.</p><button className={styles.emptyAction} disabled={busy} onClick={()=>void retrySetup()}>{busy ? "Preparing…" : "Retry category setup"}</button></div>}
          </>}
          {(!saved || storage.ready) && <>
          <div className={styles.toolbar}><div className={styles.tabs} aria-label="Task status">{statusOptions.map((item) => <button key={item} className={displayedStatus === item ? styles.tabActive : ""} onClick={() => chooseStatus(item)} aria-pressed={displayedStatus === item}>{item}</button>)}</div><button className={`${styles.mobileFilter} ${filtersOpen ? styles.filterActive : ""}`} aria-label="Toggle priority and category filters" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}><Icon name="filter" /></button><div className={`${styles.filters} ${filtersOpen ? styles.filtersVisible : ""}`}><label><span className={styles.srOnly}>Filter by priority</span><select value={priority} onChange={(event) => setPriority(event.target.value)}><option value="Any">Priority</option>{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className={styles.srOnly}>Filter by category</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="Any">Category</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label></div></div>
          <p id="task-gesture-help" className={styles.gestureHelp}>{canManage?"Tap to edit · Hold and drag to Bin":"Tap to view · Complete only tasks assigned to you"}</p>
          <div className={styles.listHeading}><span>{visibleTasks.length} {visibleTasks.length === 1 ? "task" : "tasks"}</span><span className={styles.taskCounts}>{(displayedStatus==="All" || displayedStatus==="Completed") && <span className={styles.completedTasks}><Icon name="check" size={14}/>{completedCount} {completedCount===1?"task":"tasks"} done</span>}{displayedStatus!=="Completed" && <span className={styles.remainingTasks}><Icon name="warning" size={14}/>{remainingCount} left to do!</span>}</span></div>
          {visibleTasks.length ? <ul className={styles.taskList}>{visibleTasks.map((task) => <li key={task.id} className={`${styles.taskRow} ${editing?.id === task.id ? styles.selected : ""} ${task.completed ? styles.completed : ""} ${drag.drag?.task.id===task.id?styles.dragSource:""}`} ><label className={`${styles.taskCheck} ${saved&&!canStatus(task)?styles.lockedCheck:""}`} title={saved&&!canStatus(task)?taskCoverage(task,memberNow)?"A teammate must take this task before completing it":assignmentLabel(task,members?.current?.id,members?.members??[]):undefined}><input type="checkbox" checked={task.completed} disabled={!canStatus(task) || busy || (saved && storage.expired) || (dirty && editing?.id === task.id)} onChange={() => void toggleTask(task.id)} aria-label={`${task.completed ? "Reopen" : "Complete"} ${task.title}`} /><span><Icon name={saved&&!canStatus(task)?"lock":"check"} size={15} /></span></label><button className={`${styles.taskDetails} ${task.completed && task.completedAt ? styles.taskDetailsWithCompletion : ""}`} {...(canManage?drag.handle(task):{onClick:()=>openEditor(task)})} aria-label={`${canManage?"Edit":"View"} ${task.title}`} aria-describedby="task-gesture-help"><span className={styles.taskText}><span className={styles.taskHeading}><span className={styles.taskTitle}>{task.title}</span><span className={styles.titleStatuses}>{(isChangedAssignment(task) || status==="Completed" && isChangedCompletion(task)) && <span className={styles.changedTag}>Switched to {displayMemberName(task.assignedToId,null,members?.members??[])||"a former member"}</span>}<TaskStatus task={task} today={today} time={saved ? clock.time : "00:00:00"}/></span></span><span className={styles.taskNote}>{task.notes || "No notes added"}</span></span><span className={styles.taskMeta}>{task.category && <span className={styles.categoryLabel}><span className={`${styles.dot} ${categoryClass(task.category)}`} />{task.category}</span>}{task.priority !== "None" && <span className={`${styles.badge} ${styles[task.priority.toLowerCase()]}`}>{task.priority}</span>}{task.completed ? <CompletionAge value={task.completedAt} now={now}/> : <span className={`${styles.dueDate} ${isOverdue(task,today,saved ? clock.time : "00:00:00") ? styles.overdue : ""}`}>{task.date ? <><Icon name="calendar" size={13} />{task.date === today ? "Today" : new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(`${task.date}T12:00:00`))}{task.time && <span className={styles.dueTime}>{new Intl.DateTimeFormat("en", { timeZone: "UTC", hour: "numeric", minute: "2-digit" }).format(new Date(`${task.date}T${task.time}Z`))}</span>}</> : "No due date"}</span>}{(task.weekdays.length>0 || task.repeat !== "Off") && <span className={styles.repeatMeta}>{task.weekdays.length>0 && <span className={styles.weekdayMeta}>{task.weekdays.map(day=>WEEKDAYS[day].slice(0,3)).join(" · ")}</span>}{task.repeat !== "Off" && <span title={`Repeats ${task.repeat.toLowerCase()}`}><Icon name="repeat" size={14} /></span>}</span>}{saved&&isChangedAssignment(task)&&task.claimOrigin&&<span className={styles.originalAssignee}><Icon name="person" size={13}/>Original assignee: <strong>{displayMemberName(task.claimOrigin.memberId,task.claimOrigin.memberName,members?.members??[])}</strong></span>}{saved&&<span className={`${styles.assignmentLabel} ${taskCoverage(task,memberNow)?styles.coverageLabel:""} ${taskCoverage(task,memberNow)&&task.assignedToId===members?.current?.id?styles.ownCoverageLabel:""}`}>{!taskCoverage(task,memberNow)&&<Icon name={(task.completed&&task.claimOrigin)||task.assignedToId===members?.current?.id?"person":"lock"} size={14}/>}{taskCoverage(task,memberNow)?task.assignedToId===members?.current?.id?<span className={styles.coverageBadge}><span className={styles.coverageStatusDot} aria-hidden="true"/>Available</span>:<span className={styles.coverageInfo}><span className={styles.helpMeBadge}>Help me</span><span className={styles.coverageOwner}><Icon name="person" size={13}/>Original assignee: <strong>{displayMemberName(taskCoverage(task,memberNow)!.memberId,taskCoverage(task,memberNow)!.memberName,members?.members??[])}</strong></span></span>:assignmentLabel(task,members?.current?.id,members?.members??[])}</span>}</span>{task.completed && (status==="Completed" || status==="All") && <span className={styles.completionBlock}><CompletedBy name={displayMemberName(task.completedById,task.completedByName,members?.members??[])}/><CompletionTime value={task.completedAt}/></span>}<span className={styles.rowChevron}><Icon name="chevron" size={17} /></span></button>{saved&&canTakeTask(task,members,memberNow)&&<button className={styles.takeTaskButton} disabled={busy||dirty||storage.expired} onClick={()=>askTakeTask(task)} aria-label={`Take task: ${task.title}`}>Take task</button>}</li>)}</ul> : <div className={styles.empty}><div className={styles.emptyIcon}><Icon name={filteredEmpty ? "search" : "check"} size={29} /></div><h2>{periodEmpty ? (status==="All" ? "All clear for this meeting period" : `No ${status.toLowerCase()} tasks in this meeting period`) : overdueEmpty ? "All caught up" : activeEmpty ? (tasks.length ? "No active tasks" : "No tasks yet") : categoryEmpty ? `No tasks in ${category || "Uncategorized"} yet` : filtersApplied ? "No tasks found" : view === "Overdue" ? "All caught up" : view === "Completed" ? "Small wins start here" : saved && !tasks.length ? "No tasks yet" : "A little room for something new"}</h2><p>{periodEmpty ? "Tasks from earlier periods are still saved in the main Completed and Overdue pages." : overdueEmpty ? "You don’t have any overdue tasks in this view." : activeEmpty ? (tasks.length ? "You’re all caught up. Add a task or select All to review completed tasks." : "Add a task and take the first step.") : categoryEmpty ? "Add your first task to this category." : filtersApplied ? "Try another search or adjust your filters." : view === "Overdue" ? "You don’t have any overdue tasks. Enjoy the breathing room." : view === "Completed" ? "Your completed tasks will appear here." : "Add a task and take the first step."}</p>{(filteredEmpty||canManage)&&<button className={styles.emptyAction} onClick={filteredEmpty ? resetFilters : newTask}>{filteredEmpty ? "Clear filters" : "Add a task"}<Icon name={filteredEmpty ? "close" : "plus"} size={16} /></button>}</div>}
          </>}
          <p className={styles.listFooter}><span className={styles.smallLine} />A clear space for everything on your mind.</p>
        </section>
      </div>}
    </main>
    {editing && <Modal label={editing.id?(canManage?"Edit task":"Task details"):"Add task"} onClose={closeEditor} className={`${styles.bulkDialog} ${styles.singleTaskDialog}`}>{editor}</Modal>}
    {templatesOpen && canManage && <Modal label="Templates" onClose={()=>requestAction(finishTemplates)} className={styles.bulkDialog}><TemplatesForm store={templates} onRemove={askRemoveTemplate} onUse={useTemplate} onClose={()=>requestAction(finishTemplates)} onDirty={setDirty} requestAction={requestAction}/></Modal>}
    {bulkCategory!==null && <Modal label="Add multiple tasks" onClose={()=>requestAction(finishBulk)} className={styles.bulkDialog}><BulkTaskEditor categories={categories} initialCategory={bulkCategory} currentMemberId={members?.current?.id} members={members?.members??[]} canManage={canManage} initialTemplate={bulkTemplate} onSave={saveMany} onClose={()=>requestAction(finishBulk)} onDirty={setDirty} pending={busy} uncertain={storage.uncertain}/></Modal>}
    {drag.held && <Modal label="Task actions" onClose={closeTaskActions} className={styles.taskActionsDialog}><div className={styles.taskActionsTitle}><span>Task actions</span><h2>{drag.held.title}</h2><p>Hold and move a task to drag it to Bin.</p></div><button data-autofocus="true" onClick={()=>{if(drag.held)openEditor(drag.held);}}><Icon name="list" size={19}/>Edit task</button><button className={styles.taskActionsRed} onClick={()=>{if(drag.held)askDelete(drag.held);}}><Icon name="trash" size={19}/>Move to Bin</button><button className={styles.taskActionsCancel} onClick={closeTaskActions}>Cancel</button></Modal>}
    {deleteTask && <Modal label="Move task to Bin?" onClose={cancelDelete} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>MOVE TO BIN</p><h2>Move task to Bin?</h2><p>“{deleteTask.title}”</p><p>You can restore this task from Bin.</p>{deleteTask.seriesId && <p>Future repeats will stop. Tasks already created stay in your list with Repeat off. Restoring can resume the schedule.</p>}{deleteError&&<p className={styles.error} role="alert">{deleteError}</p>}{deleteConflict&&<button type="button" className={styles.cancelButton} onClick={()=>{setDeleteTask(null);openEditor(deleteConflict);}}>Review saved task</button>}<div className={styles.editorActions}><button className={styles.cancelButton} disabled={busy} data-autofocus="true" onClick={cancelDelete}>Cancel</button><button className={styles.deleteConfirm} disabled={busy || !!deleteConflict} onClick={()=>void confirmDelete()}>{busy?"Moving…":"Move to Bin"}</button></div></div></Modal>}
    {clearCompleted && <Modal label="Delete all completed tasks?" onClose={cancelClearCompleted} className={styles.confirmDialog}><div className={`${styles.confirmContent} ${styles.completedClearContent}`}><span className={styles.completedClearIcon}><Icon name="trash" size={28}/></span><h2>Delete all completed tasks?</h2>{!completedSnapshot&&!completedError?<p role="status">Checking all completed tasks…</p>:completedSnapshot?.count===0?<p>There are no completed tasks to delete.</p>:completedSnapshot&&<><p>Permanently delete all <strong>{completedSnapshot.count}</strong> completed {completedSnapshot.count===1?"task":"tasks"} from this account and the database.</p><p>They will not move to Bin. This cannot be undone.</p><p className={styles.completedClearHint}>Active tasks, archived repeats and future repeats stay unchanged. Yearly totals are kept.</p></>}{completedError&&<p className={styles.error} role="alert">{completedError}</p>}<div className={styles.editorActions}><button ref={completedCancel} className={styles.cancelButton} data-autofocus="true" disabled={busy} onClick={cancelClearCompleted}>{completedError?"Close":"Cancel"}</button><button className={styles.deleteConfirm} disabled={busy||!completedSnapshot?.count||!!completedError} onClick={()=>void confirmClearCompleted()}>{busy&&completedSnapshot?"Deleting…":"Delete permanently"}</button></div>{completedError&&<button className={styles.cancelButton} disabled={busy} onClick={()=>{cancelClearCompleted();void storage.refresh();}}>Close and refresh</button>}</div></Modal>}
    {purgeTasks && <Modal label="Permanently delete items?" onClose={cancelPurge} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>PERMANENT DELETION</p><h2>Permanently delete {purgeTasks.length===1?`this ${purgeTasks[0].kind}`:`${purgeTasks.length} items`}?</h2><p>{purgeTasks.length===1?`“${purgeTasks[0].title}” will be permanently removed.`:"Only the selected items in Bin will be permanently removed."}</p><p>This cannot be undone.</p>{purgeError&&<p role="alert" className={styles.error}>{purgeError}</p>}<div className={styles.editorActions}><button className={styles.cancelButton} data-autofocus="true" disabled={busy} onClick={cancelPurge}>Cancel</button><button className={styles.deleteConfirm} disabled={busy||!!purgeError} onClick={()=>void confirmPurge()}>{busy?"Deleting…":"Delete permanently"}</button></div>{purgeError&&<button className={styles.cancelButton} disabled={busy} onClick={()=>{cancelPurge();void bin.refresh();}}>Close and refresh Bin</button>}</div></Modal>}
    {drag.drag&&<><div className={styles.dragGhost} style={{left:drag.drag.x,top:drag.drag.y}} aria-hidden="true"><Icon name="trash" size={18}/><span>{drag.drag.task.title}</span></div><p className={styles.dragHint} role="status">{drag.drag.over?"Release to move to Bin":"Drag onto the red Bin. Release elsewhere to cancel."}</p></>}
    {queuedAction && <Modal label="Unsaved changes" onClose={keepEditing} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>YOUR CHANGES MATTER</p><h2>Keep your changes?</h2><p>You have unsaved changes in this editor.</p><div className={styles.editorActions}><button className={styles.saveButton} data-autofocus="true" onClick={keepEditing}>Keep editing</button><button className={styles.cancelButton} onClick={discardChanges}>Discard changes</button></div></div></Modal>}
    {removeTemplate&&<Modal label="Move template to Bin?" onClose={cancelRemoveTemplate} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>REMOVE TEMPLATE</p><h2>Move template to Bin?</h2><p>“{removeTemplate.name}”</p><p>You can restore this template and all its titles and notes from Bin. Tasks already created from it stay unchanged.</p>{removeTemplateError&&<p role="alert" className={styles.error}>{removeTemplateError}</p>}<div className={styles.editorActions}><button className={styles.cancelButton} data-autofocus="true" disabled={busy} onClick={cancelRemoveTemplate}>Cancel</button><button className={styles.deleteConfirm} disabled={busy||!!removeTemplateError} onClick={()=>void confirmRemoveTemplate()}>{busy?"Moving…":"Move to Bin"}</button></div>{removeTemplateError&&<button className={styles.cancelButton} disabled={busy} onClick={cancelRemoveTemplate}>Close and refresh templates</button>}</div></Modal>}
    {takeTask&&<Modal label="Take this task?" onClose={cancelTakeTask} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>TEAM COVERAGE</p><h2>Take this task?</h2><p className={styles.reassignTitle}>{takeTask.title}</p><div className={styles.reassignPeople}>{[displayMemberName(taskCoverage(takeTask,memberNow)?.memberId,taskCoverage(takeTask,memberNow)?.memberName,members?.members??[])??"Original assignee",members?.current?.name??"You"].map((name,index)=><Fragment key={index}>{index===1&&<span className={styles.reassignArrow} aria-hidden="true">→</span>}<div><span className={`${styles.reassignAvatar} ${index===1?styles.reassignNew:""}`} aria-hidden="true">{Array.from(name)[0]?.toLocaleUpperCase()}</span><strong>{name}</strong></div></Fragment>)}</div><p>This task will be assigned to you. Only you can complete or reopen it.</p><p className={styles.editorHint}>Future repeat assignments stay unchanged.</p>{takeError&&<p role="alert" className={styles.error}>{takeError}</p>}{!taskCoverage(takeTask,memberNow)&&<p role="alert" className={styles.error}>This meeting period has ended. Close and refresh tasks.</p>}<div className={styles.editorActions}><button className={styles.cancelButton} data-autofocus="true" disabled={busy} onClick={cancelTakeTask}>Cancel</button><button className={styles.takeTaskConfirm} disabled={busy||!!takeError||!canTakeTask(takeTask,members,memberNow)} onClick={()=>void confirmTakeTask()}>{busy?"Taking…":"Take task"}</button></div></div></Modal>}
    {reopenTask && <Modal label="Reopen this task?" onClose={cancelReopenTask} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>TASK STATUS</p><h2>Reopen this task?</h2><p>This task will be marked as active again.</p>{reopenTask.seriesId && <p>Its next scheduled task stays unchanged. Completing this task again won’t create a duplicate.</p>}<div className={styles.editorActions}><button className={styles.cancelButton} data-autofocus="true" onClick={cancelReopenTask}>Keep completed</button><button className={styles.saveButton} onClick={()=>{setReopenTask(null);void toggleTask(reopenTask.id,reopenTask);}}>Reopen task</button></div></div></Modal>}
    <div className={styles.toastRegion} role="status" aria-live="polite">{message && <div className={styles.toast}><Icon name="check" size={17} />{message}</div>}</div>
  </div>;
}

function TaskEditor({ task, currentMemberId, members, canManage, canStatus, categories, onSave, onClose, onCategory, onDirty, saved, pending, uncertain, onLatest, onDelete }: { task: Task; currentMemberId?:string; members:Member[];canManage:boolean;canStatus:boolean;categories: string[]; onSave: (task: Task,scope?:EditScope) => Promise<void>; onClose: () => void; onCategory: (name: string) => Promise<string>; onDirty:(dirty:boolean)=>void; saved:boolean; pending:boolean; uncertain:boolean; onLatest:(task:Task)=>void; onDelete:(task:Task)=>void }) {
  const [draft, setDraft] = useState(task);
  const [confirmSave,setConfirmSave]=useState(false);
  const [scope,setScope]=useState<EditScope>("this");
  const [error, setError] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [conflict,setConflict]=useState<Task|null>(null);
  const [futureConflict,setFutureConflict]=useState<Task[]>([]);
  const titleRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const priorityRef = useRef<HTMLSelectElement>(null);
  useEffect(()=>{onDirty(JSON.stringify(draft)!==JSON.stringify(task) || !!newCategory || scope!=="this");},[draft,task,newCategory,scope,onDirty]);
  useEffect(()=>()=>onDirty(false),[onDirty]);
  function update<K extends keyof Task>(key: K, value: Task[K]) {setConfirmSave(false); setDraft((current) => ({ ...current, [key]: value })); }
  function changeCategory(category:string) {
    setDraft(current=>({...current,category,...(!task.id?{weekdays:categoryWeekdays(category)}:{})}));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.title.trim()) { setError("Give your task a title."); titleRef.current?.focus(); return; }
    if (draft.priority === "None") { setError("Choose a priority before saving."); priorityRef.current?.focus(); return; }
    if (draft.time && !draft.date) { setError("Choose a date to go with the time."); return; }
    const repeatIssue=repeatError(draft); if(repeatIssue){setError(repeatIssue);return;}
    if(!draft.assignedToId || !members.some(member=>member.id===draft.assignedToId)){setError("Choose an assigned member before saving.");return;}
    if(!canManage){setError("Your role can view task details but cannot edit them.");return;}
    if(task.completed && draft.assignedToId!==task.assignedToId){setError("The current assignee must reopen this task before it can be reassigned.");return;}
    if(pending || conflict || (saved && !task.id && uncertain)) return;
    if(task.id && (draft.assignedToId!==task.assignedToId || (task.completed&&!draft.completed))){setConfirmSave(true);return;}
    await commit();
  }
  async function commit(){
    if(pending||!canManage)return;
    setError("");setConfirmSave(false);
    try {await onSave(draft,scope);} catch(e) {
      setError(e instanceof Error ? e.message : "Unable to save. Your changes are still here.");
      if(e instanceof SaveError && e.latest) {setConflict(e.latest);setFutureConflict(e.future??[]);}
    }
  }
  async function addCategory() {
    const name = newCategory.trim(); if (!name) return;
    const existing = categories.find((item) => item.toLowerCase() === name.toLowerCase());
    try {
      const chosen=existing || await onCategory(name);
      changeCategory(chosen); setNewCategory(""); setAddingCategory(false); setError("");
      window.requestAnimationFrame(()=>categoryRef.current?.focus());
    } catch(e) {setError(e instanceof Error ? e.message : "Category saving failed. Please try again.");}
  }
  return <div className={styles.editor}>
    <div className={styles.editorHeader}><div><span className={styles.editorEyebrow}>{task.id ? "THE DETAILS" : "A FRESH START"}</span><h2>{task.id ? (canManage?"Edit task":"Task details") : "Add task"}</h2></div><button disabled={pending} type="button" className={styles.iconButton} aria-label="Close editor" onClick={onClose}><Icon name="close" size={19} /></button></div>
    <form onSubmit={submit} className={styles.editorForm} noValidate aria-busy={pending}>
      <fieldset disabled={pending||!canManage} className={styles.formFields}>
      {task.historyAt && <p className={styles.editorHint}>Completed: {historyDate(task.completedAt)} · In history: {historyDate(task.historyAt)} · Deletes: {historyDate(task.historyAt,30)}</p>}
      <label className={styles.field}>Title <span className={styles.required}>*</span><CapitalizedInput ref={titleRef} name="title" value={draft.title} onValueChange={value => { update("title", value); setError(""); }} placeholder="What would you like to do?" maxLength={200} required aria-invalid={!!error && !draft.title.trim()} aria-describedby={error ? "editor-error" : undefined} autoFocus={!task.id} data-autofocus={!task.id} /></label>
      <label className={styles.field}>Notes <span className={styles.optional}>optional</span><textarea name="notes" value={draft.notes} onChange={(event) => update("notes", event.target.value)} placeholder="A few helpful details…" rows={3} maxLength={4000} /></label>
      <TaskAssignee currentMemberId={currentMemberId} originalValue={task.assignedToId} value={draft.assignedToId} members={members} onChange={id=>update("assignedToId",id)} disabled={!!task.completed}/>
      <div className={styles.editorDivider} />
      <label className={styles.property}><span><Icon name="check" size={17} />Status</span><select name="status" disabled={!task.id||!canStatus} value={draft.completed ? "Completed" : "Active"} onChange={(event) => update("completed", event.target.value === "Completed")}><option>Active</option><option>Completed</option></select></label>
      <div className={styles.dateFields}><label className={styles.field}><span><Icon name="calendar" size={16} />Due date</span><input type="date" name="date" value={draft.date} onInput={event=>{update("date",event.currentTarget.value);if(!event.currentTarget.value)update("time","");}} onChange={(event) => { update("date", event.target.value); if (!event.target.value) update("time", ""); }} /></label><div className={styles.field}><span><Icon name="clock" size={16} />Time <span className={styles.optional}>optional</span></span><TaskTime value={draft.time} onChange={value=>update("time",value)}/></div></div>
      <TaskRepeat task={{...draft,repeatAnchor:draft.date===task.date?task.repeatAnchor:null}} onChange={rule=>update("repeat",rule)} onDaysChange={days=>update("weekdays",days)}/>
      <label className={styles.property}><span><span className={styles.priorityGlyph}>⚑</span>Priority</span><select ref={priorityRef} name="priority" value={draft.priority === "None" ? "" : draft.priority} onChange={(event) => update("priority", event.target.value as Priority)}>{draft.priority === "None" && <option value="" disabled>Choose priority</option>}{PRIORITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className={styles.property}><span><span className={`${styles.dot} ${categoryClass(draft.category)}`} />Category</span><select ref={categoryRef} name="category" value={draft.category} onChange={(event) => { if (event.target.value === "__new") setAddingCategory(true); else changeCategory(event.target.value); }}>{!draft.category && <option value="" disabled>Choose category</option>}{categories.map((name) => <option key={name}>{name}</option>)}<option value="__new">+ New category</option></select></label>
      {addingCategory && <div className={styles.newCategory}><label className={styles.srOnly} htmlFor="new-category">New category name</label><CapitalizedInput id="new-category" value={newCategory} maxLength={40} onValueChange={setNewCategory} placeholder="Category name" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCategory(); } }} /><button type="button" onClick={addCategory}>Add</button><button type="button" aria-label="Cancel new category" onClick={() => setAddingCategory(false)}><Icon name="close" size={15} /></button></div>}
      <div className={styles.editorDivider} />
      {task.seriesId && <><label className={styles.property}><span>Apply changes to</span><select value={scope} onChange={event=>setScope(event.target.value as EditScope)}><option value="this">This task only</option><option value="future">This and future tasks</option></select></label><p className={styles.editorHint}>Assignment and status changes affect this task only. Future changes update pending schedules and later active tasks; completed history stays unchanged. To stop scheduled repeats, choose This and future tasks, then Off.</p></>}
      {error && <p id="editor-error" className={styles.error} role="alert">{error}</p>}
      {saved && !task.id && uncertain && <p className={styles.error} role="alert">Saving could not be confirmed. Your draft is kept here. Close the editor when ready, then refresh and review your saved tasks before creating another.</p>}
      {conflict && <div className={styles.conflict}><h3>Latest saved version</h3><dl><dt>Title</dt><dd>{conflict.title}</dd><dt>Notes</dt><dd>{conflict.notes || "None"}</dd><dt>Status</dt><dd>{conflict.completed ? "Completed" : "Active"}</dd><dt>Due</dt><dd>{conflict.date || "None"} {conflict.time} · India time</dd><dt>Days</dt><dd>{conflict.weekdays.map(day=>WEEKDAYS[day]).join(", ") || "None"}</dd><dt>Repeat</dt><dd>{conflict.repeat}</dd><dt>Priority / category</dt><dd>{conflict.priority} / {conflict.category || "None"}</dd></dl>{futureConflict.length>0 && <><h3>Later active tasks</h3>{futureConflict.map(item=><dl key={item.id}><dt>Title / notes</dt><dd>{item.title}<br/>{item.notes || "No notes added"}</dd><dt>Due / repeat</dt><dd>{item.date} {item.time} · {item.repeat} · {item.weekdays.map(day=>WEEKDAYS[day]).join(", ")}</dd><dt>Priority / category</dt><dd>{item.priority} / {item.category || "Uncategorized"}</dd></dl>)}</>}<button type="button" onClick={()=>onLatest(conflict)}>Use saved version</button><button type="button" onClick={()=>{setDraft(current=>({...current,updatedAt:conflict.updatedAt,seriesVersion:conflict.seriesVersion}));setConflict(null);setFutureConflict([]);setError("Reviewed. Your draft is kept; save when ready.");}}>Keep my draft after review</button></div>}
      {canManage && task.id && <button type="button" className={styles.deleteButton} disabled={!!conflict} onClick={()=>onDelete(task)}><Icon name="trash" size={17}/>Move to Bin</button>}

      </fieldset>
      {!canManage&&<p className={styles.editorHint}>Your role can view task details. Use the task checkbox to complete or reopen work assigned to you.</p>}
      <div className={styles.editorActions}><button type="button" className={styles.cancelButton} disabled={pending} onClick={onClose}>Cancel</button>{canManage&&<button disabled={pending || !!conflict || (saved && !task.id && uncertain)} type="submit" className={styles.saveButton}><Icon name="check" size={17} />{pending ? "Saving…" : task.id ? "Save changes" : "Create task"}</button>}</div>
    </form>
    {confirmSave&&<Modal label={draft.assignedToId!==task.assignedToId?"Reassign this task?":"Reopen this task?"} onClose={()=>{if(!pending)setConfirmSave(false);}} className={styles.confirmDialog}><div className={styles.confirmContent}><p className={styles.editorEyebrow}>TASK ASSIGNMENT</p><h2>{draft.assignedToId!==task.assignedToId?"Reassign this task?":"Reopen this task?"}</h2>{draft.assignedToId!==task.assignedToId?<><p className={styles.reassignTitle}>{task.title}</p><div className={styles.reassignPeople}>{[task.assignedToId,draft.assignedToId].map((id,index)=><Fragment key={index}>{index===1&&<span className={styles.reassignArrow} aria-hidden="true">→</span>}<div><span className={`${styles.reassignAvatar} ${index===1?styles.reassignNew:""}`} aria-hidden="true">{Array.from(members.find(m=>m.id===id)?.name??"?")[0]?.toLocaleUpperCase()}</span><strong>{members.find(m=>m.id===id)?.name??"Previous member"}</strong></div></Fragment>)}</div><p>Only <strong>{members.find(m=>m.id===draft.assignedToId)?.name??"the new assignee"}</strong> will be able to complete or reopen this task.</p><p className={styles.editorHint}>It moves to their Assigned to me list. Future repeat assignments stay unchanged.</p></>:<p>This task will become active again. Its next scheduled occurrence stays unchanged.</p>}<div className={styles.editorActions}><button type="button" data-autofocus="true" className={styles.cancelButton} disabled={pending} onClick={()=>setConfirmSave(false)}>Cancel</button><button type="button" className={`${styles.saveButton} ${draft.assignedToId!==task.assignedToId?styles.reassignConfirm:""}`} disabled={pending||!canManage} onClick={()=>void commit()}>{pending?"Saving…":draft.assignedToId!==task.assignedToId?"Reassign task":"Reopen task"}</button></div></div></Modal>}
  </div>;
}
