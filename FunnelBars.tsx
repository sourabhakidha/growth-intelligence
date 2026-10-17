import type { MetricFormat } from "@/lib/metrics/definitions";
import { formatMetric } from "@/lib/format/metric";
import { formatPct } from "@/lib/format/inr";

export interface FunnelStep {
  label: string;
  value: number;
}

/**
 * Horizontal funnel: bar length = magnitude, with step-over-step and from-top ratios as text.
 * Pure HTML (no client JS). Ratios are labelled as same-period ratios, not cohort conversion.
 */
export function FunnelBars({ steps, format = "count" }: { steps: FunnelStep[]; format?: MetricFormat }) {
  const top = steps[0]?.value ?? 0;
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const prev = i > 0 ? steps[i - 1].value : null;
        const width = top > 0 ? Math.max(1, (s.value / top) * 100) : 0;
        return (
          <li key={s.label} className="grid grid-cols-[120px_1fr_112px] items-center gap-3 text-xs sm:grid-cols-[160px_1fr_140px]">
            <span className="truncate text-ink-2">{s.label}</span>
            <span className="h-5 rounded-r bg-surface-2" title={`${s.label}: ${formatMetric(s.value, format)}`}>
              <span className="block h-full rounded-r" style={{ width: `${width}%`, background: "var(--accent)" }} />
            </span>
            <span className="tabular text-right">
              <span className="font-medium text-ink">{formatMetric(s.value, format)}</span>
              {prev !== null ? <span className="ml-1.5 text-ink-3">{prev > 0 ? formatPct(s.value / prev) : "—"}</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
