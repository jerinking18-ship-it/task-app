"use client";
import { useEffect, useRef } from "react";
import type { MeetingCelebration } from "@/lib/tasks/meeting-celebration";
import styles from "./meeting-complete-celebration.module.css";

export const completionDialogClass = styles.dialog;

/** Local decorative motion only: no network, audio, persisted state or task writes. */
export function animateMeetingCompletion(root: HTMLElement, onClose: () => void) {
  const animations: Animation[] = [];
  const card = root.querySelector<HTMLElement>("[data-message]") ?? root;
  const particles = root.querySelector<HTMLElement>("[data-confetti]");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  let disposed = false;
  let fadeStarted = false;
  const cancelMotion = () => { animations.forEach(animation => animation.cancel()); particles?.replaceChildren(); };
  const finish = () => { if (!disposed) onClose(); };
  function reduceMotion() { if (reduced.matches) { cancelMotion(); if (fadeStarted) finish(); } }
  if (!reduced.matches) {
    animations.push(card.animate([
      { opacity: 0, transform: "translateY(16px) scale(.94)" },
      { opacity: 1, transform: "translateY(-3px) scale(1.01)", offset: .72 },
      { opacity: 1, transform: "translateY(0) scale(1)" },
    ], { duration: 500, easing: "cubic-bezier(.22,1,.36,1)" }));
    const emblem = root.querySelector<HTMLElement>("[data-emblem]");
    if (emblem) animations.push(emblem.animate([
      { transform: "rotate(-18deg) scale(.3)", opacity: 0 },
      { transform: "rotate(-5deg) scale(1.1)", opacity: 1, offset: .65 },
      { transform: "rotate(-8deg) scale(1)", opacity: 1 },
    ], { duration: 700, easing: "cubic-bezier(.22,1,.36,1)" }));
    root.querySelectorAll<HTMLElement>("[data-spark]").forEach((spark, i) => animations.push(spark.animate([
      { opacity: 0, transform: "scale(.3)" }, { opacity: 1, transform: "scale(1.2)", offset: .5 }, { opacity: 1, transform: "scale(1)" },
    ], { duration: 650, delay: 220 + i * 70, fill: "backwards" })));
    if (particles) {
      const rect = (root.querySelector<HTMLElement>("[data-emblem]") ?? card).getBoundingClientRect();
      const colors = ["#d2b970", "#d2b970", "#ecedf2", "#8dc0a3"];
      for (let i = 0; i < 54; i++) {
        const piece = document.createElement("span");
        piece.className = styles.particle;
        piece.style.background = colors[i % colors.length];
        piece.style.left = `${rect.left + rect.width / 2}px`;
        piece.style.top = `${rect.top + rect.height / 2}px`;
        if (i % 4 === 0) { piece.style.borderRadius = "50%"; piece.style.height = "5px"; }
        particles.appendChild(piece);
        const angle = i / 54 * Math.PI * 2, reach = 90 + i * 37 % 145;
        const vx = Math.cos(angle) * reach, vy = Math.sin(angle) * 120 - 145;
        const frames = Array.from({ length: 13 }, (_, k) => {
          const t = k / 12;
          return { transform: `translate(${vx * t}px,${vy * t + 365 * t * t}px) rotate(${i * 73 + t * 500}deg)`, opacity: t < .68 ? 1 : Math.max(0, (1 - t) / .32) };
        });
        const animation = piece.animate(frames, { duration: 1800 + i * 41 % 900, delay: i % 7 * 25, easing: "linear", fill: "both" });
        animations.push(animation);
        animation.onfinish = () => piece.remove();
      }
    }
    const progress = root.querySelector<HTMLElement>("[data-dismiss-progress]");
    if (progress) animations.push(progress.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: 4600, easing: "linear", fill: "forwards" }));
  }
  reduced.addEventListener("change", reduceMotion);
  const timer = window.setTimeout(() => {
    if (reduced.matches) { finish(); return; }
    fadeStarted = true;
    const fade = card.animate([{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(8px)" }], { duration: 250, fill: "forwards" });
    animations.push(fade); fade.onfinish = finish;
  }, 4600);
  return () => { disposed = true; window.clearTimeout(timer); reduced.removeEventListener("change", reduceMotion); cancelMotion(); };
}

export default function MeetingCompleteCelebration({ celebration, onClose }: { celebration: MeetingCelebration; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The shared parent dialog opens in its own effect. Measure the emblem only
    // after it is in the top layer, so confetti starts at the check, not (0, 0).
    let cleanup: (() => void) | undefined;
    const frame = window.requestAnimationFrame(() => { if (root.current) cleanup = animateMeetingCompletion(root.current, onClose); });
    return () => { window.cancelAnimationFrame(frame); cleanup?.(); };
  }, [onClose]);
  return <div ref={root}>
    <div data-confetti className={styles.confetti} aria-hidden="true"/>
    <div data-message className={styles.message}>
    <button type="button" className={styles.dismiss} aria-label="Dismiss celebration" data-autofocus="true" onClick={onClose}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    <div className={styles.emblem} aria-hidden="true"><div className={styles.halo}/><span data-emblem className={styles.disc}><svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 4 4L19 6"/></svg></span><span data-spark className={styles.sparkA}>✦</span><span data-spark className={styles.sparkB}>✧</span><span data-spark className={styles.sparkC}>✦</span></div>
    <div role="status" aria-live="polite" aria-atomic="true"><p className={styles.meeting}>{celebration.meeting}</p><h2>All tasks completed!</h2><p className={styles.gratitude}>Thank you for serving.</p><div className={styles.seal}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg><span>{celebration.total} of {celebration.total} {celebration.total === 1 ? "task" : "tasks"} completed</span></div></div>
    <div className={styles.progress} aria-hidden="true"><span data-dismiss-progress/></div>
    </div>
  </div>;
}
