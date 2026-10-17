"use client";

import { Info } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { MetricDef } from "@/lib/metrics/definitions";

/** Click/keyboard-accessible definition popover: formula, numerator, denominator, window, source. */
export function MetricInfo({ def }: { def: MetricDef }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        aria-label={`How ${def.label} is calculated`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="rounded p-0.5 text-ink-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Info size={13} />
      </button>
      {open ? (
        <span
          id={id}
          role="dialog"
          className="absolute right-0 top-6 z-30 w-72 rounded-lg border border-line bg-surface-1 p-3 text-left text-xs shadow-lg"
        >
          <span className="block font-semibold text-ink">{def.label}</span>
          <dl className="mt-2 space-y-1.5 text-ink-2">
            <Row k="Formula" v={def.formula} />
            {def.numerator ? <Row k="Numerator" v={def.numerator} /> : null}
            {def.denominator ? <Row k="Denominator" v={def.denominator} /> : null}
            <Row k="Grain" v={def.grain} />
            <Row k="Window" v={def.window} />
            <Row k="Source" v={def.source} mono />
          </dl>
          {def.note ? <span className="mt-2 block border-t border-line pt-2 text-ink-2">{def.note}</span> : null}
        </span>
      ) : null}
    </span>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <span className="grid grid-cols-[76px_1fr] gap-2">
      <dt className="text-ink-3">{k}</dt>
      <dd className={mono ? "font-mono text-[11px] break-words" : ""}>{v}</dd>
    </span>
  );
}
