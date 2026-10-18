"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { decodeMemberResponse } from "@/lib/members/model";
import { isRecord } from "@/lib/tasks/validation";
import { contextKey, decodeCheckIn, type CheckInAction, type CheckInData } from "./model";
export function useCheckIn(enabled: boolean, details: boolean, blocked: boolean, initial: CheckInData | null = null) {
  const [clockOffset,setClockOffset]=useState(()=>initial?Date.parse(initial.serverNow)-Date.now():0);
  const [data, setData] = useState(initial), [loading, setLoading] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState(""), [expired, setExpired] = useState(false), [forbidden, setForbidden] = useState(false), [deferred, setDeferred] = useState(false);
  const alive = useRef(true), controller = useRef<AbortController | null>(null), sequence = useRef(0), writing = useRef(false);
  const current = useRef({ enabled, details, blocked }); current.current = { enabled, details, blocked };
  const refresh = useCallback(async () => {
    if (!current.current.enabled) return;
    if (current.current.blocked || writing.current) { setDeferred(true); return; }
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const seq = ++sequence.current, mode = current.current.details;
    setLoading(true); setError(""); setDeferred(false);
    try {
      const response = await fetch(`/api/check-in${mode ? "?details=1" : ""}`, { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]) }); const body: unknown = await response.json();
      if (!response.ok) { if (response.status === 401) setExpired(true); if (response.status === 403) { setForbidden(true); setData(null); } throw Error(isRecord(body) && typeof body.message === "string" ? body.message : "Check-in unavailable. Refresh to try again."); }
      const next = decodeCheckIn(body, mode); if (alive.current && seq === sequence.current) { setData(next); setClockOffset(Date.parse(next.serverNow)-Date.now()); setExpired(false); setForbidden(false); }
    } catch (reason) { if (alive.current && seq === sequence.current && !abort.signal.aborted) setError(reason instanceof Error ? reason.message : "Check-in unavailable."); }
    finally { if (alive.current && seq === sequence.current) { controller.current = null; setLoading(false); } }
  }, []);
  useEffect(() => { alive.current = true; if (enabled) void refresh(); else { controller.current?.abort(); sequence.current++; setLoading(false); } return () => { alive.current = false; controller.current?.abort(); sequence.current++; }; }, [enabled, details, refresh]);
  useEffect(() => { if (blocked && controller.current) { controller.current.abort(); sequence.current++; setLoading(false); setDeferred(true); } else if (!blocked && !pending && deferred) void refresh(); }, [blocked, pending, deferred, refresh]);
  useEffect(() => { if (!enabled) return; const returned = () => { if (document.visibilityState === "visible") void refresh(); }; window.addEventListener("focus", returned); document.addEventListener("visibilitychange", returned); return () => { window.removeEventListener("focus", returned); document.removeEventListener("visibilitychange", returned); }; }, [enabled, refresh]);
  const save = useCallback(async (input: CheckInAction) => {
    if (!current.current.enabled || current.current.details || current.current.blocked || writing.current) throw Error("Finish the current action first.");
    writing.current = true; setPending(true); setError(""); controller.current?.abort(); sequence.current++; setLoading(false);
    try {
      const response = await fetch("/api/check-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(20000) }); const body: unknown = await response.json();
      if (!response.ok) { if (response.status === 401) setExpired(true); throw Error(isRecord(body) && typeof body.message === "string" ? body.message : "Check-in couldn’t be confirmed. Refresh before trying again."); }
      if (!isRecord(body)) throw Error("Incomplete check-in confirmation.");
      const next = decodeCheckIn(body.state), members = decodeMemberResponse(body.members);
      if (!members.current || next.currentId !== members.current.id || !next.own.includes(contextKey(input))) throw Error("Check-in couldn’t be confirmed. Refresh before trying again.");
      if (alive.current) {setData(next);setClockOffset(Date.parse(next.serverNow)-Date.now());} return { state: next, members };
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : "Check-in couldn’t be confirmed."); throw reason; }
    finally { writing.current = false; if (alive.current) setPending(false); }
  }, []);
  return { clockOffset, data: details && !data?.entries ? null : data, loading, pending, error, expired, forbidden, refresh, save };
}
