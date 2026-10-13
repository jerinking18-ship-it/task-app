"use client";
import { useRef, useState, type FormEvent } from "react";
import { decodeMemberResponse, MEMBER_LIMIT, memberName, type MemberAction, type MemberState } from "@/lib/members/model";
import { isRecord } from "@/lib/tasks/validation";
import AccountControls from "@/components/auth/account-controls";
import auth from "@/components/auth/auth.module.css";
import styles from "./members.module.css";

export default function MemberForm({ initialState }: { initialState: MemberState | null }) {
  const [state, setState] = useState(initialState);
  const [mode, setMode] = useState<"create" | "select">((initialState?.members.length ?? 0) >= MEMBER_LIMIT ? "select" : "create");
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(initialState ? "" : "We couldn’t load account members. Refresh to try again.");
  const [expired, setExpired] = useState(false);
  const busy = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const feedback = useRef<HTMLParagraphElement>(null);
  const full = (state?.members.length ?? 0) >= MEMBER_LIMIT;
  function showError(message: string) {
    setError(message); requestAnimationFrame(() => feedback.current?.focus());
  }
  async function refresh() {
    const response = await fetch("/api/members", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    const body: unknown = await response.json();
    if (!response.ok) {
      if (response.status === 401) setExpired(true);
      throw new Error(isRecord(body) && typeof body.message === "string" ? body.message : "Unable to load members.");
    }
    const next = decodeMemberResponse(body); setState(next);
    if (next.current) window.location.assign("/account");
    if (next.members.length >= MEMBER_LIMIT) setMode("select");
    return next;
  }
  async function retry() {
    if (busy.current) return;
    busy.current = true; setPending(true); setError("");
    try { await refresh(); } catch (error) { showError(error instanceof Error ? error.message : "Unable to connect. Please try again."); }
    finally { busy.current = false; setPending(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy.current || !state || expired) return;
    const clean = memberName(name);
    if (mode === "create" && !clean) { setError("Enter a name between 1 and 50 characters."); nameInput.current?.focus(); return; }
    if (mode === "select" && !state.members.some(member => member.id === selected)) { showError("Choose your name to continue."); return; }
    const action: MemberAction = mode === "create" ? { action: "create", name: clean! } : { action: "select", id: selected };
    busy.current = true; setPending(true); setError("");
    try {
      const response = await fetch("/api/members", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action), cache: "no-store", signal: AbortSignal.timeout(20000) });
      const body: unknown = await response.json();
      if (!response.ok) {
        if (response.status === 401) setExpired(true);
        if (response.status === 409) await refresh();
        throw new Error(isRecord(body) && typeof body.message === "string" ? body.message : "Unable to confirm your name.");
      }
      if (!decodeMemberResponse(body).current) throw new Error("Refresh to confirm your name before trying again.");
      window.location.assign("/account");
    } catch (error) { showError(error instanceof Error ? error.message : "We couldn’t confirm your name. Refresh before trying again."); }
    finally { busy.current = false; setPending(false); }
  }
  return <div className={styles.memberStep}>
    <p className={styles.verified}><span aria-hidden="true">✓</span> Account verified</p>
    <p className={styles.capacity}>Shared account · {state ? `${state.members.length} of ${MEMBER_LIMIT} members` : "Members unavailable"}</p>
    {full && <p className={styles.limitNotice}>All 10 member spaces are in use. Choose your existing name to continue.</p>}
    {error && <p ref={feedback} tabIndex={-1} className={auth.error} role="alert">{error}</p>}
    {expired ? <a className={auth.backLink} href="/sign-in">Sign in again</a> : <form onSubmit={submit} aria-busy={pending}>
      {mode === "create" ? <label className={auth.field} htmlFor="member-name"><span>Your name</span><input ref={nameInput} id="member-name" name="memberName" autoComplete="name" maxLength={50} required value={name} disabled={pending || !state || full} onChange={event => setName(event.target.value)} placeholder="Enter your name"/></label>
        : <label className={auth.field} htmlFor="member-choice"><span>Choose your name</span><select className={styles.memberSelect} id="member-choice" required value={selected} disabled={pending || !state} onChange={event => setSelected(event.target.value)}><option value="">Select a member</option>{state?.members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>}
      <button type="submit" className={auth.primary} disabled={pending || !state || (full && mode === "create")}>{pending ? "Confirming…" : "Continue"}</button>
      {!!state?.members.length && (!full || mode === "create") && <p className={styles.modeSwitch}>{mode === "create" ? "Already a member? " : "New to this account? "}<button type="button" disabled={pending} onClick={() => { setMode(mode === "create" ? "select" : "create"); setError(""); }}>{mode === "create" ? "Choose your name" : "Add your name"}</button></p>}
    </form>}
    {!expired && <button type="button" className={styles.retry} disabled={pending} onClick={() => void retry()}>Refresh members</button>}
    <div className={styles.stepSignOut}><AccountControls blocked={pending}/></div>
  </div>;
}
