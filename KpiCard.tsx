import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { METRICS, type MetricId } from "@/lib/metrics/definitions";
import { formatMetric } from "@/lib/format/metric";
import { formatPct, pctChange } from "@/lib/format/inr";
import type { DataResult } from "@/lib/types/result";
import { cn } from "@/lib/cn";
import { StatusBadge } from "@/components/state/Badges";
import { MetricInfo } from "./MetricInfo";

export type KpiState = DataResult<unknown>["state"];

interface KpiCardProps {
  metric: MetricId;
  value?: number | null;
  previous?: number | null;
  /** State of the data behind this value. Anything but "ok" renders an explicit placeholder, never a zero. */
  state: KpiState;
  compact?: boolean;
  sublabel?: string;
}

const STATE_TEXT: Record<Exclude<KpiState, "ok">, string> = {
  not_connected: "Not connected",
  empty: "No data",
  error: "Error",
};

export function KpiCard({ metric, value, previous, state, compact = true, sublabel }: KpiCardProps) {
  const def = METRICS[metric];
  const unavailable = def.status === "unavailable";
  const ok = state === "ok" && !unavailable;
  const delta = ok ? pctChange(value, previous) : null;
  const good = delta === null ? null : def.higherIsBetter ? delta > 0 : delta < 0;

  return (
    <div className="flex min-h-[104px] flex-col justify-between rounded-lg border border-line bg-surface-1 p-3">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-ink-2">{def.label}</span>
        <MetricInfo def={def} />
      </div>
      <div>
        {ok ? (
          <span className="tabular text-2xl font-semibold tracking-tight text-ink">{formatMetric(value, def.format, compact)}</span>
        ) : (
          <span className="text-sm font-medium text-ink-3">{unavailable ? "Not available" : STATE_TEXT[state as Exclude<KpiState, "ok">]}</span>
        )}
        <div className="mt-1 flex min-h-[18px] flex-wrap items-center gap-1.5">
          {delta !== null ? (
            <span
              className={cn("tabular inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-good" : "text-critical")}
              title="Change vs previous period of equal length"
            >
              {delta > 0 ? <ArrowUpRight size={12} aria-hidden /> : delta < 0 ? <ArrowDownRight size={12} aria-hidden /> : <Minus size={12} aria-hidden />}
              {formatPct(Math.abs(delta))}
              <span className="sr-only">{delta > 0 ? "increase" : "decrease"} vs previous period</span>
            </span>
          ) : null}
          {sublabel ? <span className="text-[11px] text-ink-3">{sublabel}</span> : null}
          {def.status !== "reliable" ? <StatusBadge status={def.status} /> : null}
        </div>
      </div>
    </div>
  );
}

export function KpiGrid({ children, cols = 6 }: { children: React.ReactNode; cols?: 3 | 4 | 5 | 6 }) {
  const map = { 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" } as const;
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-3", map[cols])}>{children}</div>;
}
