import { CircleAlert, CircleCheck, CircleDashed, CircleSlash } from "lucide-react";
import type { MetricStatus } from "@/lib/metrics/definitions";
import { cn } from "@/lib/cn";

// Status is always icon + label, never color alone.
const STATUS: Record<MetricStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  reliable: { label: "Reliable", icon: <CircleCheck size={12} />, cls: "text-ink-2 border-line" },
  provisional: { label: "Provisional", icon: <CircleDashed size={12} />, cls: "text-ink border-warning/60 bg-warning/10" },
  unavailable: { label: "Not available", icon: <CircleSlash size={12} />, cls: "text-ink-2 border-line-strong bg-surface-2" },
};

export function StatusBadge({ status, className }: { status: MetricStatus; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", s.cls, className)}>
      {s.icon}
      {s.label}
    </span>
  );
}

export function Callout({ children, tone = "info" }: { children: React.ReactNode; tone?: "info" | "warning" }) {
  return (
    <div
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed",
        tone === "warning" ? "border-warning/50 bg-warning/10 text-ink" : "border-line bg-surface-1 text-ink-2",
      )}
    >
      <CircleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
