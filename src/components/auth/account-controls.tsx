"use client";
import { useState } from "react";
import styles from "./auth.module.css";

export default function AccountControls({ passwordUpdated = false, beforeSignOut, blocked = false }: { passwordUpdated?: boolean; beforeSignOut?:()=>Promise<boolean>; blocked?:boolean }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  return <div className={styles.accountControls}>
    {passwordUpdated && <span role="status">Password updated. You’re still signed in to this browser.</span>}
    <button disabled={pending || blocked} onClick={async () => {
      if(beforeSignOut && !await beforeSignOut()) return;
      setPending(true); setMessage("");
      try {
        const response = await fetch("/auth/submit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "sign-out" }) });
        const reply = await response.json();
        if (response.ok) window.location.assign("/sign-in?notice=signed-out");
        else setMessage(reply.message ?? "Unable to sign out. Please try again.");
      } catch { setMessage("Unable to connect. Please try again."); }
      finally { setPending(false); }
    }}>{pending ? "Signing out…" : "Sign out"}</button>
    {message && <span role="alert">{message}</span>}
  </div>;
}
