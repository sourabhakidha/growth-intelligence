"use client";

import { CalendarDays } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PRESETS, formatRange, parseRange, presetRange, todayIST, type PresetKey } from "@/lib/format/ist";
import { cn } from "@/lib/cn";

/** Shared IST date-range filter. State lives in the URL (?from&to) so every page and link agrees. */
export function DateRangePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const today = todayIST();
  const range = parseRange({ from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined }, today);

  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const apply = (f: string, t: string) => {
    const next = new URLSearchParams(sp.toString());
    next.set("from", f);
    next.set("to", t);
    router.push(`${pathname}?${next.toString()}`);
    setOpen(false);
  };

  const activePreset = PRESETS.find((p) => {
    const r = presetRange(p.key, today);
    return r.from === range.from && r.to === range.to;
  })?.key;

  const invalid = !from || !to || from > to || to > today;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) {
            // Re-seed the custom inputs from the URL each time the picker opens.
            setFrom(range.from);
            setTo(range.to);
          }
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-1 px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-2"
      >
        <CalendarDays size={14} aria-hidden className="text-ink-2" />
        <span className="tabular">{formatRange(range)}</span>
        <span className="hidden text-ink-3 sm:inline">IST</span>
      </button>
      {open ? (
        <div role="dialog" aria-label="Choose date range" className="absolute right-0 z-40 mt-2 w-[min(92vw,340px)] rounded-lg border border-line bg-surface-1 p-3 shadow-lg">
          <div className="grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => {
                  const r = presetRange(p.key as PresetKey, today);
                  apply(r.from, r.to);
                }}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-left text-xs",
                  activePreset === p.key ? "border-accent bg-accent-soft text-ink" : "border-line text-ink-2 hover:bg-surface-2",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <form
            className="mt-3 border-t border-line pt-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!invalid) apply(from, to);
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-ink-3">
                From
                <input type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-ink" />
              </label>
              <label className="text-[11px] text-ink-3">
                To
                <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-ink" />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[11px] text-ink-3">{invalid ? "Pick a valid range up to today." : "Dates are IST calendar days."}</span>
              <button type="submit" disabled={invalid} className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
                Apply
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
