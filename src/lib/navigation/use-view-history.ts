"use client";
import { useEffect, useRef } from "react";
import { createViewHistory, type ViewSnapshot } from "./view-history";

export function useViewHistory(snapshot: ViewSnapshot, callbacks: {
  restore: (snapshot: ViewSnapshot) => void;
  blocked: () => boolean;
  attempt: (proceed: () => void) => void;
  fresh?: boolean;
}) {
  const latest = useRef({ snapshot, callbacks });
  latest.current = { snapshot, callbacks };
  const controller = useRef<ReturnType<typeof createViewHistory> | null>(null);
  const firstWrite = useRef(true);
  useEffect(() => {
    firstWrite.current = true;
    const history = createViewHistory(window, latest.current.snapshot, {
      restore: value => latest.current.callbacks.restore(value),
      blocked: () => latest.current.callbacks.blocked(),
      attempt: proceed => latest.current.callbacks.attempt(proceed),
    }, crypto.randomUUID(), latest.current.callbacks.fresh);
    controller.current = history;
    return () => { history.dispose(); controller.current = null; };
  }, []);
  useEffect(() => {
    // A saved entry may restore state on mount; don't push the server default
    // back over that restored entry before React commits the restored values.
    if (firstWrite.current) { firstWrite.current = false; return; }
    controller.current?.record(snapshot);
  }, [snapshot.view, snapshot.category, snapshot.status, snapshot.priority, snapshot.sundayStatuses?.morning, snapshot.sundayStatuses?.evening]);
}
