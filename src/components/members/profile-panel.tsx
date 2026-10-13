"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import AccountControls from "@/components/auth/account-controls";
import { decodeMemberResponse, MEMBER_LIMIT, memberName, memberSeen, memberActive, type MemberState } from "@/lib/members/model";
import { isRecord } from "@/lib/tasks/validation";
import styles from "./profile.module.css";

function ProfileIcon({ children }: { children: ReactNode }) {
  return <svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
const chevron = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>;

export default function ProfilePanel({ state, email, loading, error, disabled, now, onRefresh, onUsers, onSaved, onDirty, onPending, beforeSignOut, onSignedOut }: {
  state: MemberState | null; email: string | null; loading: boolean; error: string; disabled: boolean; now: Date;
  onRefresh: () => void; onUsers: () => void; onSaved: (state: MemberState) => void;
  onDirty: (dirty: boolean) => void; onPending: (pending: boolean) => void; beforeSignOut: () => Promise<boolean>; onSignedOut: (url:string) => void;
}) {
  const member = state?.current;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const previousName = useRef("");
  const [feedback, setFeedback] = useState("");
  const [problem, setProblem] = useState("");
  const [expired, setExpired] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const leaveButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const blocked = disabled || pending || expired;

  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  useEffect(() => {
    if (!leaving) return;
    const element = dialog.current;
    element?.showModal(); cancelButton.current?.focus();
    return () => { element?.close(); if (leaveButton.current?.isConnected) leaveButton.current.focus(); };
  }, [leaving]);
  function editName() {
    if (!member || blocked) return;
    setName(member.name); previousName.current = member.name;
    setProblem(""); setFeedback(""); setEditing(true);
  }
  function cancelEdit() { if (busy.current) return; setEditing(false); setProblem(""); onDirty(false); }
  async function submitName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!member || busy.current || blocked) return;
    const clean = memberName(name);
    if (!clean) { setProblem("Enter a name between 1 and 50 characters."); input.current?.focus(); return; }
    if (clean === previousName.current) { cancelEdit(); return; }
    busy.current = true; setPending(true); onPending(true); setProblem(""); setFeedback("");
    try {
      const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rename", name: clean, previousName: previousName.current }), cache: "no-store", signal: AbortSignal.timeout(20000) });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 401) setExpired(true);
        throw new Error(isRecord(body) && typeof body.message === "string" ? body.message : "Unable to save your name. Please try again.");
      }
      const next = decodeMemberResponse(body);
      if (next.current?.id !== member.id) throw new Error("Refresh your profile to confirm your saved name.");
      onSaved(next); onDirty(false); setEditing(false); setFeedback("Name updated");
    } catch (reason) { setProblem(reason instanceof Error ? reason.message : "We couldn’t confirm the save. Cancel and refresh your profile before retrying."); }
    finally { busy.current = false; setPending(false); onPending(false); }
  }
  async function confirmLeave() {
    if (!member || busy.current || blocked) return;
    busy.current = true; setPending(true); onPending(true); setProblem("");
    try {
      const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "leave", confirmed: true }), cache: "no-store", signal: AbortSignal.timeout(20000) });
      const body: unknown = await response.json();
      if (!response.ok || !isRecord(body) || body.left !== true) {
        if (response.status === 401) setExpired(true);
        throw new Error(isRecord(body) && typeof body.message === "string" ? body.message : "We couldn’t confirm that you left. Refresh before trying again.");
      }
      onSignedOut("/sign-in?notice=profile-left");
    } catch (reason) { setProblem(reason instanceof Error ? reason.message : "We couldn’t confirm that you left. Refresh before trying again."); }
    finally { busy.current = false; setPending(false); onPending(false); }
  }
  if (!member || !state) return <section className={styles.panel} aria-label="My profile"><div className={styles.card}><h2>Your profile</h2><p role={error ? "alert" : "status"}>{error || "Loading your profile…"}</p><button className={styles.editButton} onClick={onRefresh} disabled={loading}>Refresh profile</button></div></section>;
  const joined = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", month: "short", day: "numeric", year: "numeric" }).format(new Date(member.createdAt));
  const seen = memberSeen(member.lastSeenAt, now).replace(/^Last seen /, "").replace(/^./, letter => letter.toUpperCase());
  return <section className={styles.panel} aria-label="My profile" aria-busy={pending}>
    <div className={styles.profileCard}>
      <span className={styles.avatar} aria-hidden="true">{Array.from(member.name)[0]?.toLocaleUpperCase()}</span>
      <div className={styles.identity}><h2>{member.name}</h2><p>Your member profile <span className={styles.you}>You</span></p></div>
      {!editing && <button className={styles.editButton} disabled={blocked || loading} onClick={editName}>Edit name</button>}
      {editing && <form className={styles.nameForm} onSubmit={submitName} aria-label="Edit your name">
        <label htmlFor="profile-name">Your name</label>
        <input ref={input} id="profile-name" autoComplete="name" maxLength={50} required disabled={blocked} value={name} onChange={event => { setName(event.target.value); onDirty(event.target.value !== previousName.current); }}/>
        <p>Previous completion names will stay unchanged.</p>
        <div className={styles.formActions}><button type="button" className={styles.cancel} disabled={pending} onClick={cancelEdit}>Cancel</button><button type="submit" className={styles.save} disabled={blocked}>{pending ? "Saving…" : "Save name"}</button></div>
      </form>}
    </div>
    {!leaving && (problem || error) && <div className={styles.feedback} role="alert"><p>{problem || error}</p>{expired ? <a href="/sign-in">Sign in again</a> : !editing && <button disabled={blocked || loading} onClick={onRefresh}>{loading ? "Refreshing…" : "Refresh profile"}</button>}</div>}
    {feedback && <p className={styles.success} role="status">{feedback}</p>}
    <div className={styles.sections}>
      <section className={styles.card} aria-label="Shared account"><h2>Shared account</h2>
        <div className={styles.detail}><ProfileIcon><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m3 5 9 7 9-7"/></ProfileIcon><div><span>Shared email</span><p className={styles.email}>{email || "Email unavailable. Refresh this page."}</p></div></div>
        <div className={styles.memberSummary}><div><span>Members</span><p>{state.members.length} of {MEMBER_LIMIT}</p></div><button disabled={blocked} onClick={onUsers}>View users {chevron}</button></div>
        <div className={styles.capacity} role="progressbar" aria-label="Member spaces used" aria-valuemin={0} aria-valuemax={MEMBER_LIMIT} aria-valuenow={state.members.length}><span style={{ width: `${state.members.length * 10}%` }}/></div>
      </section>
      <section className={styles.card} aria-label="Profile activity"><h2>Activity</h2>
        <div className={`${styles.detail} ${styles.activityDetail}`}><ProfileIcon><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/></ProfileIcon><div><span>Member since</span><time dateTime={member.createdAt}>{joined}</time></div></div>
        <div className={`${styles.detail} ${styles.activityDetail}`}><ProfileIcon><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></ProfileIcon><div><span>{memberActive(member,now)?"Status":"Last seen"}</span>{memberActive(member,now)?<p className={styles.activeNow}>● Active now</p>:<time dateTime={member.lastSeenAt}>{seen} IST</time>}</div></div>
      </section>
    </div>
    <div className={styles.signOutRow}><AccountControls label="Sign out this device" beforeSignOut={beforeSignOut} blocked={blocked} onPendingChange={onPending} onSignedOut={onSignedOut}/>{chevron}</div>
    <div className={styles.leaveSection}><button ref={leaveButton} disabled={blocked || editing} onClick={() => { setProblem(""); setLeaving(true); }}>Leave this account</button><p>Shared tasks and past completion names will stay.</p></div>
    {leaving && <dialog ref={dialog} aria-labelledby="leave-profile-title" aria-describedby="leave-profile-description" className={styles.leaveDialog} onCancel={event => { event.preventDefault(); if (!busy.current) setLeaving(false); }} onClick={event => { if (event.target === event.currentTarget && !busy.current) setLeaving(false); }}>
      <div className={styles.confirmation}><h2 id="leave-profile-title">Leave this account?</h2><p id="leave-profile-description">Your profile will be removed. Devices using it will be signed out when they next connect. Shared tasks and past completion names will stay.</p>
        {problem && <p className={styles.dialogError} role="alert">{problem}</p>}
        {expired && <a href="/sign-in">Sign in again</a>}
        <div className={styles.formActions}><button ref={cancelButton} className={styles.cancel} disabled={pending} onClick={() => setLeaving(false)}>Cancel</button><button className={styles.leaveConfirm} disabled={blocked} onClick={() => void confirmLeave()}>{pending ? "Leaving…" : "Leave account"}</button></div>
      </div>
    </dialog>}
  </section>;
}
