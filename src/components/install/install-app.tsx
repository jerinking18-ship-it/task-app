"use client";

import { useEffect, useRef, useState } from "react";
import { installPlatform, showInstallPrompt, type InstallPlatform, type InstallPromptEvent } from "@/lib/install/platform";
import styles from "./install-app.module.css";

function InstallIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3" stroke="currentColor" strokeWidth="1.6"/><path d="M9 12l3 3 3-3M12 6v9M10 19h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

export default function InstallApp() {
  const [installed, setInstalled] = useState(true);
  const [platform, setPlatform] = useState<InstallPlatform>("other");
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const inFlight = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const fullscreen = window.matchMedia("(display-mode: fullscreen)");
    const update = () => setInstalled(mode.matches || fullscreen.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);
    update();
    setPlatform(installPlatform(navigator.userAgent, navigator.platform, navigator.maxTouchPoints));
    const beforeInstall = (event: Event) => {
      if (typeof (event as InstallPromptEvent).prompt !== "function") return;
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const didInstall = () => { setInstalled(true); setPrompt(null); setOpen(false); };
    mode.addEventListener("change", update);
    fullscreen.addEventListener("change", update);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", didInstall);
    return () => {
      mode.removeEventListener("change", update);
      fullscreen.removeEventListener("change", update);
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", didInstall);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>("[data-close]")?.focus();
    return () => { element?.close(); trigger.current?.focus(); };
  }, [open]);

  async function install() {
    if (inFlight.current) return;
    if (!prompt || platform === "ios") { setOpen(true); return; }
    inFlight.current = true;
    setPending(true);
    const event = prompt;
    setPrompt(null);
    try {
      const outcome = await showInstallPrompt(event);
      if (outcome === "unavailable") { setUnavailable(true); setOpen(true); }
    } finally { inFlight.current = false; setPending(false); }
  }

  if (installed) return null;
  return <>
    <button ref={trigger} type="button" className={styles.install} disabled={pending} onClick={() => void install()} aria-haspopup="dialog">
      <span className={styles.icon}><InstallIcon /></span><span><strong>{pending ? "Opening installation…" : "Install app"}</strong><small>Add BGM Task to your Home Screen</small></span><span aria-hidden="true">→</span>
    </button>
    {open && <dialog ref={dialog} className={styles.dialog} aria-labelledby="install-title" aria-describedby="install-description" onCancel={event => { event.preventDefault(); setOpen(false); }} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <div className={styles.content}>
        <div className={styles.heading}><span className={styles.icon}><InstallIcon /></span><button type="button" data-close aria-label="Close installation guide" onClick={() => setOpen(false)}>×</button></div>
        <p className={styles.eyebrow}>YOUR APP, ONE TAP AWAY</p><h2 id="install-title">Add to Home Screen</h2>
        <p id="install-description">Open BGM Task in its own app window from your Home Screen.</p>
        {unavailable && <p role="status">The installation prompt is unavailable. Use your browser’s menu below.</p>}
        {platform === "ios" ? <><h3>iPhone &amp; iPad</h3><ol><li>Open this website in <strong>Safari</strong>.</li><li>Tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. You may need to scroll.</li><li>If shown, turn on <strong>Open as Web App</strong>, then tap <strong>Add</strong>.</li></ol></> : platform === "android" ? <><h3>Android</h3><ol><li>Open this website in <strong>Chrome</strong>.</li><li>Tap the <strong>⋮ menu</strong>, then <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li><li>Choose <strong>Install</strong> when offered, then open the BGM Task icon.</li></ol><p className={styles.note}>Menu wording depends on your browser. If it offers only a shortcut that opens a browser tab, use Chrome’s Install app option when available.</p></> : <><h3>Android &amp; iPhone</h3><p>Open this website on your phone. On Android, use Chrome’s menu → <strong>Install app</strong>. On iPhone, use Safari’s Share menu → <strong>Add to Home Screen</strong>.</p><p className={styles.note}>On a computer, use your browser’s Install app option when available.</p></>}
        <p className={styles.note}>Internet is required. Your existing login and saved tasks stay the same.</p>
        <button className={styles.done} type="button" onClick={() => setOpen(false)}>Got it</button>
      </div>
    </dialog>}
  </>;
}
