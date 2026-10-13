"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, type TouchEvent } from "react";
import type { Task } from "./model";

export const TASK_HOLD_MS = 450;
const MOVE_THRESHOLD = 8;
type Session<T> = { task: T; id: number; kind: "pointer" | "touch"; x: number; y: number; held: boolean; holdActionFired: boolean; dragged: boolean; element: HTMLElement; timer: ReturnType<typeof setTimeout> | null };

export function useBinDrag<T extends Task>(target: RefObject<HTMLButtonElement | null>, disabled: boolean, onDrop: (task: T) => void, onOpen: (task: T) => void, onHold?: (task: T) => void) {
  const [drag, setDrag] = useState<{ task: T; x: number; y: number; over: boolean } | null>(null);
  const [held, setHeld] = useState<T | null>(null);
  const session = useRef<Session<T> | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const suppress = useRef(0);
  const callbacks = useRef({ onDrop, onOpen, onHold, disabled });
  callbacks.current = { onDrop, onOpen, onHold, disabled };

  const end = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (current?.timer) clearTimeout(current.timer);
    if (current) delete current.element.dataset.taskHeld;
    if (current?.kind === "pointer" && current.element.hasPointerCapture(current.id)) current.element.releasePointerCapture(current.id);
    setDrag(null);
  }, []);
  const cancel = useCallback(() => {
    if (session.current) suppress.current = Date.now() + 700;
    end(); setHeld(null);
  }, [end]);
  const over = useCallback((x: number, y: number) => {
    const box = target.current?.getBoundingClientRect();
    return !!box && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  }, [target]);
  function start(task: T, element: HTMLElement, id: number, kind: "pointer" | "touch", x: number, y: number) {
    if (callbacks.current.disabled) return;
    cancel(); suppress.current = 0;
    origin.current = element;
    const current: Session<T> = { task, id, kind, x, y, held: false, holdActionFired: false, dragged: false, element, timer: null };
    session.current = current;
    if (kind === "pointer") element.setPointerCapture(id);
    current.timer = setTimeout(() => {
      if (session.current !== current || callbacks.current.disabled) return;
      current.held = true;
      current.element.dataset.taskHeld = "true";
      if (!target.current && callbacks.current.onHold) {
        current.holdActionFired = true;
        callbacks.current.onHold(current.task);
      }
    }, TASK_HOLD_MS);
  }
  const move = useCallback((x: number, y: number, prevent: () => void) => {
    const current = session.current;
    if (!current) return;
    const moved = Math.hypot(x - current.x, y - current.y) > MOVE_THRESHOLD;
    if (!current.held) { if (moved) cancel(); return; }
    // Only a deliberate hold takes over scrolling; ordinary swipes remain native.
    prevent();
    if (moved && target.current) current.dragged = true;
    if (current.dragged) setDrag({ task: current.task, x, y, over: over(x, y) });
  }, [cancel, over, target]);
  const release = useCallback((x: number, y: number) => {
    const current = session.current;
    if (!current) return;
    const heldTask = current.held && !current.dragged;
    const dropped = current.dragged && over(x, y);
    if (current.held) suppress.current = Date.now() + 700;
    end();
    if (callbacks.current.disabled) return;
    if (dropped) callbacks.current.onDrop(current.task);
    else if (heldTask && !current.holdActionFired) {
      if (callbacks.current.onHold) callbacks.current.onHold(current.task);
      else setHeld(current.task);
    }
  }, [end, over]);
  useEffect(() => { if (disabled) cancel(); }, [disabled, cancel]);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    const touchMove = (event: globalThis.TouchEvent) => {
      const current = session.current;
      if (current?.kind !== "touch") return;
      const touch = Array.from(event.touches).find(value => value.identifier === current.id);
      if (!touch || event.touches.length !== 1) { cancel(); return; }
      move(touch.clientX, touch.clientY, () => { if (event.cancelable) event.preventDefault(); });
    };
    const touchEnd = (event: globalThis.TouchEvent) => {
      const current = session.current;
      if (current?.kind !== "touch") return;
      const touch = Array.from(event.changedTouches).find(value => value.identifier === current.id);
      if (touch) release(touch.clientX, touch.clientY);
    };
    window.addEventListener("keydown", escape); window.addEventListener("blur", cancel); window.addEventListener("resize", cancel);
    document.addEventListener("touchmove", touchMove, { passive: false });
    document.addEventListener("touchend", touchEnd); document.addEventListener("touchcancel", cancel);
    return () => {
      window.removeEventListener("keydown", escape); window.removeEventListener("blur", cancel); window.removeEventListener("resize", cancel);
      document.removeEventListener("touchmove", touchMove); document.removeEventListener("touchend", touchEnd); document.removeEventListener("touchcancel", cancel);
      const current = session.current;
      if (current?.timer) clearTimeout(current.timer);
      if (current) delete current.element.dataset.taskHeld;
    };
  }, [cancel, move, release]);

  function showOptions(task: T, element: HTMLElement) {
    cancel(); suppress.current = Date.now() + 700;
    origin.current = element;
    if (!callbacks.current.disabled) {
      if (callbacks.current.onHold) callbacks.current.onHold(task);
      else setHeld(task);
    }
  }
  function handle(task: T) {
    return {
      onPointerDown(event: PointerEvent<HTMLElement>) { if (event.pointerType !== "touch" && event.button === 0) start(task, event.currentTarget, event.pointerId, "pointer", event.clientX, event.clientY); },
      onPointerMove(event: PointerEvent<HTMLElement>) { if (session.current?.kind === "pointer" && session.current.id === event.pointerId) move(event.clientX, event.clientY, () => event.preventDefault()); },
      onPointerUp(event: PointerEvent<HTMLElement>) { if (session.current?.kind === "pointer" && session.current.id === event.pointerId) release(event.clientX, event.clientY); },
      onLostPointerCapture() { if (session.current?.kind === "pointer") cancel(); },
      onPointerCancel(event: PointerEvent<HTMLElement>) { if (event.pointerType !== "touch") cancel(); },
      onTouchStart(event: TouchEvent<HTMLElement>) { if (event.touches.length !== 1) { cancel(); return; } const touch = event.touches[0]; start(task, event.currentTarget, touch.identifier, "touch", touch.clientX, touch.clientY); },
      onContextMenu(event: MouseEvent<HTMLElement>) { event.preventDefault(); if (!session.current?.held) showOptions(task, event.currentTarget); },
      onKeyDown(event: KeyboardEvent<HTMLElement>) { if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) { event.preventDefault(); showOptions(task, event.currentTarget); } },
      onClick(event: MouseEvent<HTMLElement>) { if (Date.now() < suppress.current || callbacks.current.disabled) { event.preventDefault(); return; } callbacks.current.onOpen(task); },
    };
  }
  return { drag, held, handle, cancel, origin };
}
