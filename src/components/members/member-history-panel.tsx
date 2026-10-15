"use client";
import NoMeeting from "../no-meeting";
import {useEffect,useRef,useState} from "react";
import {displayMemberName,type NamedMember} from "@/lib/members/display-name";
import {CATEGORY_COLORS,completionTime,historyYear,reportSchedule,specialResetLabel,visibleCompletions,yearlyTotal,type HistoryEntry,type MemberHistoryData} from "@/lib/member-history/model";
import styles from "./member-history.module.css";
function Mark({clock=false,size=28}:{clock?:boolean;size?:number}){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/>{clock?<path d="M12 6v6l4 2"/>:<path d="m7 12 3 3 7-7"/>}</svg>;}
function EmptyMark(){return <svg width="84" height="84" viewBox="0 0 72 72" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="30" cy="30" r="24" stroke="currentColor" strokeWidth="2.5"/><path d="m18 30 8 8 16-17" stroke="currentColor" strokeWidth="2.5"/><circle cx="51" cy="48" r="13" fill="#b89d63" stroke="#fffdf8" strokeWidth="3"/><path d="m45 48 4 4 8-9" stroke="#fffdf8" strokeWidth="1.9"/></svg>;}
function Section({category,entries,resetLabel}:{category:string;entries:HistoryEntry[];resetLabel:string}){
 return <section className={styles.section} aria-label={category+" completed history"}><div className={styles.sectionHeader}><h2><span className={styles.dot} style={{background:CATEGORY_COLORS[category]}}/>{category}</h2><span>{entries.length} {entries.length===1?"task":"tasks"}</span></div><p className={styles.reset}><Mark clock size={17}/>{resetLabel}</p>
 {entries.length?<ul className={styles.entries}>{entries.map(entry=><li key={entry.id} className={styles.entry}><Mark size={26}/><div className={styles.entryBody}><h3>{entry.title}</h3>{entry.notes&&<p className={styles.notes}>{entry.notes}</p>}<time className={styles.completedOn} dateTime={entry.completedAt}><Mark clock size={13}/><span>Completed on {completionTime(entry.completedAt)}</span></time></div></li>)}</ul>:<div className={styles.empty}><EmptyMark/><h3>No completions yet</h3><p>Completed {category} tasks will appear here.</p></div>}
 </section>;
}
export default function MemberHistoryPanel({data,loading,error,now,currentMembers=[],currentMemberId,hasSpecialTasks=false,onRefresh}:{currentMembers?:NamedMember[];data:MemberHistoryData|null;loading:boolean;error:string;now:Date;currentMemberId?:string;hasSpecialTasks?:boolean;onRefresh:()=>void}){
 const [selected,setSelected]=useState(currentMemberId??"");
 const members=data?data.members.map(member=>({...member,name:displayMemberName(member.id,member.name,currentMembers)!})).sort((a,b)=>Number(b.id===currentMemberId)-Number(a.id===currentMemberId)):[];
 const memberId=members.some(member=>member.id===selected)?selected:members.find(member=>member.id===currentMemberId)?.id??members[0]?.id??"";
 const member=members.find(item=>item.id===memberId),year=historyYear(now),schedule=reportSchedule(data,now);
 const entries=visibleCompletions(data,memberId,schedule.category,now);
 const specialEntries=visibleCompletions(data,memberId,"Special Meeting",now);
 const hasSpecial=hasSpecialTasks||!!data?.specialWindows.some(window=>Date.parse(window.startsAt)<=now.getTime()&&Date.parse(window.endsAt)>now.getTime())
  ||!!data?.entries.some(entry=>entry.category==="Special Meeting"&&Date.parse(entry.completedAt)<=now.getTime()&&Date.parse(entry.expiresAt)>now.getTime());
 const visibleCount=entries.length+specialEntries.length;
 // The schedule changes locally at the exact server-adjusted boundary; refetch
 // then catches up new totals/members without requiring a manual refresh.
 const boundaryKey=year+":"+schedule.category+":"+schedule.boundary;
 const refresh=useRef(onRefresh);refresh.current=onRefresh;
 const previousBoundary=useRef(boundaryKey);
 useEffect(()=>{if(previousBoundary.current!==boundaryKey){previousBoundary.current=boundaryKey;refresh.current();}},[boundaryKey]);
 return <section className={styles.panel} aria-label="Member history" aria-busy={loading}>
  <div className={styles.top}><label className={styles.memberField}><span>MEMBER</span><div className={styles.selector}><span className={styles.avatar} aria-hidden="true">{member?Array.from(member.name)[0]?.toLocaleUpperCase():"—"}</span><select aria-label="Choose history member" value={memberId} disabled={!members.length} onChange={event=>setSelected(event.target.value)}>{!members.length&&<option value="">Choose a member</option>}{members.map(item=><option key={item.id} value={item.id}>{item.name}{item.id===currentMemberId?" · You":""}</option>)}</select></div></label><button className={styles.refresh} type="button" onClick={onRefresh} disabled={loading}>{loading?"Loading…":"Refresh"}</button></div>
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {!data?<p className={styles.loading} role="status">{loading?"Loading member history…":"Refresh to load your member history."}</p>:<><div className={styles.stats}><div className={styles.stat}><Mark/><div><strong className={styles.number}>{yearlyTotal(data,memberId,now)}</strong><span className={styles.statLabel}>Completed in {year}</span><small>All categories · this year</small></div></div><div className={styles.stat}><Mark/><div><strong className={styles.number}>{visibleCount}</strong><span className={styles.statLabel}>Visible history</span></div></div></div>
   {schedule.category ? <Section category={schedule.category} entries={entries} resetLabel={schedule.label}/> : <NoMeeting now={now}/>}
   {hasSpecial&&<Section category="Special Meeting" entries={specialEntries} resetLabel={specialResetLabel(specialEntries)}/>}
   <p className={styles.footer}><Mark clock size={16}/>Regular category changes automatically. Special Meeting clears separately.</p>
  </>}
 </section>;
}
