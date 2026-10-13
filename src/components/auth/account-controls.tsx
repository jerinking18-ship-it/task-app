"use client";
import { useState } from "react";
import styles from "./auth.module.css";

export default function AccountControls({ passwordUpdated = false, beforeSignOut, blocked = false, label = "Sign out", onPendingChange, onSignedOut }: { passwordUpdated?: boolean; beforeSignOut?:()=>Promise<boolean>; blocked?:boolean; label?:string; onPendingChange?:(pending:boolean)=>void; onSignedOut?:(url:string)=>void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return <div className={styles.accountControls}>
    {passwordUpdated && <span role="status">Password updated. You’re still signed in to this browser.</span>}
    <button disabled={pending || blocked} onClick={async () => {
      if(beforeSignOut && !await beforeSignOut()) return;
      setPending(true); onPendingChange?.(true); setMessage("");
      try {
        const response = await fetch("/auth/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign-out" }) });
        const reply = await response.json();
        if (response.ok) (onSignedOut ?? (url => window.location.assign(url)))("/sign-in?notice=signed-out");
        else setMessage(reply.message ?? "Unable to sign out. Please try again.");
      } catch { setMessage("Unable to connect. Please try again."); }
      finally { setPending(false); onPendingChange?.(false); }
    }}>{pending ? "Signing out…" : label}</button>
    {message && <span role="alert">{message}</span>}
  </div>;
}
