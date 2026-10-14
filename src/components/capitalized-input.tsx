"use client";

import { useImperativeHandle, useRef, type ComponentPropsWithRef } from "react";
import { capitalizeInitial, capitalizedSelection } from "@/lib/text/capitalization";

type Props = Omit<ComponentPropsWithRef<"input">,
  "value" | "defaultValue" | "onChange" | "onCompositionStart" | "onCompositionEnd" | "autoCapitalize">
  & { value: string; onValueChange: (value: string) => void };

/** Shared by human-readable name/title fields; never used for credentials. */
export default function CapitalizedInput({ ref, value, onValueChange, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  useImperativeHandle(ref, () => input.current!, []);

  function commit(element: HTMLInputElement) {
    const raw = element.value;
    const next = capitalizeInitial(raw);
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const direction = element.selectionDirection;
    onValueChange(next);
    if (next !== raw && start !== null && end !== null) {
      window.requestAnimationFrame(() => {
        if (element.isConnected && document.activeElement === element && element.value === next) {
          element.setSelectionRange(capitalizedSelection(raw, start), capitalizedSelection(raw, end), direction ?? undefined);
        }
      });
    }
  }

  return <input {...props} ref={input} value={value} autoCapitalize="sentences"
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={event => { composing.current = false; commit(event.currentTarget); }}
    onChange={event => {
      if (composing.current) onValueChange(event.currentTarget.value);
      else commit(event.currentTarget);
    }} />;
}
