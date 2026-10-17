import { AlertTriangle, DatabaseZap, Inbox, PlugZap } from "lucide-react";
import type { DataResult } from "@/lib/types/result";
import { SOURCES } from "@/lib/sources/registry";
import { cn } from "@/lib/cn";

interface BaseProps {
  title: string;
  detail?: string;
  className?: string;
  compact?: boolean;
}

function Shell({ icon, title, detail, className, compact, tone = "neutral" }: BaseProps & { icon: React.ReactNode; tone?: "neutral" | "critical" }) {
  return (
    <div
      role={tone === "critical" ? "alert" : "status"}
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center",
        tone === "critical" ? "border-critical/40 bg-critical/5" : "border-line-strong bg-surface-2/40",
        compact ? "px-3 py-4" : "px-6 py-10",
        className,
      )}
    >
      <span className={cn("text-ink-3", tone === "critical" && "text-critical")} aria-hidden>
        {icon}
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {detail ? <p className="max-w-md text-xs leading-relaxed text-ink-2">{detail}</p> : null}
    </div>
  );
}

export function EmptyState(props: BaseProps) {
  return <Shell icon={<Inbox size={20} />} {...props} />;
}

export function NotConnectedState(props: BaseProps) {
  return <Shell icon={<PlugZap size={20} />} {...props} />;
}

export function ErrorState(props: BaseProps) {
  return <Shell icon={<AlertTriangle size={20} />} tone="critical" {...props} />;
}

export function PendingDefinitionState(props: BaseProps) {
  return <Shell icon={<DatabaseZap size={20} />} {...props} />;
}

/** Render the non-ok states of a DataResult; returns null when the result is ok. */
export function ResultState<T>({ result, compact, className }: { result: DataResult<T>; compact?: boolean; className?: string }) {
  const src = SOURCES[result.source];
  switch (result.state) {
    case "ok":
      return null;
    case "not_connected":
      return (
        <NotConnectedState
          compact={compact}
          className={className}
          title="No data connected yet"
          detail={`${result.reason} Source: ${src.relation}.`}
        />
      );
    case "empty":
      return <EmptyState compact={compact} className={className} title="No data for these dates" detail={`${result.reason} Source: ${src.relation}.`} />;
    case "error":
      return <ErrorState compact={compact} className={className} title="Could not load data" detail={result.message} />;
  }
}
