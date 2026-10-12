"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { validateAuthInput, type AuthAction, type AuthReply, type FieldErrors } from "@/lib/auth/validation";
import { CheckMark } from "./auth-shell";
import styles from "./auth.module.css";

export default function AuthForm({ mode = "signin", initialMessage = "", initialError = false }: {
  mode?: "signin" | "signup" | "forgot" | "reset"; initialMessage?: string; initialError?: boolean;
}) {
  const [tab, setTab] = useState<"password" | "email-link">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<FieldErrors>({});
  const [message, setMessage] = useState(initialMessage);
  const [isError, setIsError] = useState(initialError);
  const [sent, setSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [cooldownFor, setCooldownFor] = useState<AuthAction | null>(null);
  const busy = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const action: AuthAction = mode === "signup" ? "signup" : mode === "forgot" ? "recover" : mode === "reset" ? "reset" : tab;
  const newPassword = mode === "signup" || mode === "reset";
  const usesPassword = action === "password" || newPassword;
  const waiting = cooldown > 0 && cooldownFor === action;

  useEffect(() => {
    if (!cooldown) return;
    const interval = window.setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(interval);
  }, [cooldown > 0]);

  function chooseTab(next: "password" | "email-link") {
    setTab(next); setFields({}); setMessage(""); setSent(false); setPassword(""); setConfirmation(""); setVisible(false);
  }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : 1 - index;
    chooseTab(next === 0 ? "password" : "email-link"); tabs.current[next]?.focus();
  }
  function focusFeedback() { window.requestAnimationFrame(() => feedback.current?.focus()); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || waiting) return;
    const checked = validateAuthInput({ action, email, password, confirmation });
    setFields(checked.fields); setMessage("");
    if (!checked.input) {
      const name = Object.keys(checked.fields)[0];
      event.currentTarget.querySelector<HTMLInputElement>(`[name="${name}"]`)?.focus();
      return;
    }
    busy.current = true; setPending(true); setIsError(false);
    try {
      const response = await fetch("/auth/submit", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(checked.input), cache: "no-store",
      });
      const result: AuthReply = await response.json();
      if (result.retryAfter) {
        setCooldownFor(action); setCooldown(Math.min(3600, Math.max(0, result.retryAfter)));
      }
      if (!response.ok) {
        setIsError(true); setFields(result.fields ?? {}); setMessage(result.message ?? "We couldn’t complete that request. Please try again."); focusFeedback();
      } else if (result.redirectTo) {
        // Destinations are fixed server values, with a local-path check as a second guard.
        if (result.redirectTo.startsWith("/") && !result.redirectTo.startsWith("//")) window.location.assign(result.redirectTo);
      } else {
        setSent(true); setMessage(result.message ?? "Check your inbox for the next step."); focusFeedback();
      }
    } catch {
      setIsError(true); setMessage("We couldn’t connect. If you requested an email, check your inbox before trying again."); focusFeedback();
    } finally {
      setPassword(""); setConfirmation(""); busy.current = false; setPending(false);
    }
  }

  const submitLabel = action === "signup" ? "Create account" : action === "password" ? "Sign in" : action === "email-link" ? "Send sign-in link" : action === "recover" ? "Send reset link" : "Update password";
  return <>
    {mode === "signin" && <div className={styles.tabs} role="tablist" aria-label="Sign-in method">
      {(["password", "email-link"] as const).map((name, index) => <button key={name} ref={(element) => { tabs.current[index] = element; }}
        type="button" role="tab" id={`tab-${name}`} aria-controls="auth-panel" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1}
        onKeyDown={(event) => tabKeys(event, index)} onClick={() => chooseTab(name)} disabled={pending}>
        {name === "password" ? "Password" : "Email link"}
      </button>)}
    </div>}
    <div id="auth-panel" role={mode === "signin" ? "tabpanel" : undefined} aria-labelledby={mode === "signin" ? `tab-${tab}` : undefined}>
      {sent ? <div className={styles.sent}>
        <CheckMark large /><h2>Check your inbox</h2>
        <div ref={feedback} tabIndex={-1} className={isError ? styles.error : styles.feedback} role={isError ? "alert" : "status"}>{message}</div>
        <p className={styles.sentEmail}>{email.trim()}</p>
        <button type="button" className={styles.primary} disabled={cooldown > 0} onClick={() => { setSent(false); setMessage(""); }}>
          {mode === "signup" ? cooldown > 0 ? `Try again in ${cooldown}s` : "Try again" : cooldown > 0 ? `Request another link in ${cooldown}s` : "Request another link"}
        </button>
        <button type="button" className={styles.textButton} onClick={() => { setSent(false); setMessage(""); }}>Use another email</button>
      </div> : <form onSubmit={submit} noValidate aria-busy={pending}>
        {message && <div ref={feedback} tabIndex={-1} className={isError ? styles.error : styles.feedback} role={isError ? "alert" : "status"}>{message}</div>}
        {mode !== "reset" && <div className={styles.field}>
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" spellCheck={false}
            placeholder="you@example.com" value={email} maxLength={254} disabled={pending} required
            onChange={(event) => { setEmail(event.target.value); setFields((current) => ({ ...current, email: undefined })); }}
            aria-invalid={!!fields.email} aria-describedby={fields.email ? "email-error" : undefined} />
          {fields.email && <p id="email-error" className={styles.fieldError}>{fields.email}</p>}
        </div>}
        {usesPassword && <div className={styles.field}>
          <div className={styles.labelRow}><label htmlFor="password">{mode === "reset" ? "New password" : "Password"}</label>
            {mode === "signin" && <Link href="/auth/forgot-password">Forgot password?</Link>}
          </div>
          <div className={styles.passwordInput}>
            <input id="password" name="password" type={visible ? "text" : "password"} autoComplete={newPassword ? "new-password" : "current-password"}
              value={password} disabled={pending} required maxLength={1024} placeholder={newPassword ? "Choose a new password" : "Enter your password"}
              onChange={(event) => { setPassword(event.target.value); setFields((current) => ({ ...current, password: undefined })); }}
              aria-invalid={!!fields.password} aria-describedby={fields.password ? "password-error" : newPassword ? "password-hint" : undefined} />
            <button type="button" aria-label={visible ? "Hide password" : "Show password"} aria-pressed={visible} disabled={pending} onClick={() => setVisible(!visible)}>{visible ? "Hide" : "Show"}</button>
          </div>
          {fields.password && <p id="password-error" className={styles.fieldError}>{fields.password}</p>}
          {newPassword && <p id="password-hint" className={styles.hint}>{mode === "signup" ? "At least 8 characters." : "At least 6 characters. Your account may require a stronger password."}</p>}
        </div>}
        {newPassword && <div className={styles.field}>
          <label htmlFor="confirmation">{mode === "signup" ? "Confirm password" : "Confirm new password"}</label>
          <input id="confirmation" name="confirmation" type={visible ? "text" : "password"} autoComplete="new-password" value={confirmation}
            disabled={pending} required maxLength={1024} placeholder="Enter your new password again"
            onChange={(event) => { setConfirmation(event.target.value); setFields((current) => ({ ...current, confirmation: undefined })); }}
            aria-invalid={!!fields.confirmation} aria-describedby={fields.confirmation ? "confirmation-error" : undefined} />
          {fields.confirmation && <p id="confirmation-error" className={styles.fieldError}>{fields.confirmation}</p>}
        </div>}
        {action === "email-link" && <p className={styles.hint}>We’ll email you a one-time sign-in link. No password needed.</p>}
        {action === "signup" && <p className={styles.hint}>Use an email you can access. Open confirmation links in this browser.</p>}
        <button className={styles.primary} type="submit" disabled={pending || waiting}>
          {pending ? <><span className={styles.spinner} aria-hidden="true" />{action === "signup" ? "Creating account…" : action === "password" ? "Signing in…" : action === "reset" ? "Updating password…" : "Requesting link…"}</> : waiting ? `Try again in ${cooldown}s` : <>{submitLabel}<span aria-hidden="true">→</span></>}
        </button>
      </form>}
    </div>
    {mode === "signin" ? <p className={styles.accountNote}>New here? <Link href="/sign-up">Create account</Link></p> : mode === "signup" ? <p className={styles.accountNote}>Already have an account? <Link href="/sign-in">Sign in</Link></p> : <Link href="/sign-in" className={styles.backLink}><span aria-hidden="true">←</span> Back to sign in</Link>}
  </>;
}
