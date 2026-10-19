import type { StageView } from "@/lib/metrics/funnel";
import { formatCount, formatPct } from "@/lib/format/inr";
import { cn } from "@/lib/cn";

interface FunnelChartProps {
  stages: StageView[];
  /** Unit shown after volumes, e.g. "devices" or "users". */
  unit: string;
  /** Optional side branch under a stage (e.g. payment failed under "Payment attempted"). */
  branch?: { underKey: string; label: string; value: number | null; rate: number | null };
  /** Stage key to highlight as the biggest drop-off. */
  weakestKey?: string | null;
  color?: string;
}

/**
 * Drawn funnel: centred bars whose width is proportional to volume, with stage-to-stage conversion, drop-off and the
 * change vs the previous period between bars. Server-rendered HTML — no client JS.
 */
export function FunnelChart({ stages, unit, branch, weakestKey, color = "var(--series-app)" }: FunnelChartProps) {
  const max = Math.max(1, ...stages.map((s) => s.value ?? 0));
  return (
    <ol className="space-y-0.5" aria-label="Funnel">
      {stages.map((s, i) => {
        const w = Math.max(2, ((s.value ?? 0) / max) * 100);
        const weak = s.key === weakestKey;
        return (
          <li key={s.key}>
            {i > 0 ? (
              <div className={cn("flex items-center justify-center gap-3 py-1 text-[11px]", weak ? "text-critical" : "text-ink-3")}>
                {s.drop !== null && s.drop < 0 ? (
                  <span title="This stage counts more than the stage before it: GA4 counts users per day per event, and derived stages can include users who skipped a tracked step.">
                    ↑ {formatCount(-s.drop)} above previous stage (counting overlap, not a conversion)
                  </span>
                ) : (
                  <>
                    <span>↓ {formatPct(s.conv_prev)} continue</span>
                    <span>
                      −{formatCount(s.drop ?? 0)} ({formatPct(s.drop_rate)}) drop{weak ? " · biggest drop-off" : ""}
                    </span>
                  </>
                )}
                {s.conv_prev_period !== null && s.conv_prev !== null ? (
                  <span>prev. {formatPct(s.conv_prev_period)}</span>
                ) : null}
              </div>
            ) : null}
            <div className="grid grid-cols-[150px_1fr_120px] items-center gap-3">
              <span className="text-xs text-ink-2">
                {s.label}
                {s.derived ? <span className="ml-1 rounded bg-surface-2 px-1 text-[10px] text-ink-3">derived</span> : null}
              </span>
              <div className="flex justify-center">
                <div
                  className={cn("h-7 rounded-sm", weak && "ring-2 ring-critical/60")}
                  style={{ width: `${w}%`, background: color, opacity: 0.35 + 0.65 * ((s.value ?? 0) / max) }}
                  title={s.note}
                />
              </div>
              <span className="text-right text-xs tabular-nums text-ink">
                {formatCount(s.value)} <span className="text-ink-3">{unit}</span>
                {s.change !== null ? (
                  <span className={cn("ml-1", s.change >= 0 ? "text-good" : "text-critical")}>
                    {s.change >= 0 ? "+" : ""}
                    {formatPct(s.change)}
                  </span>
                ) : null}
              </span>
            </div>
            {branch && branch.underKey === s.key ? (
              <div className="mt-1 grid grid-cols-[150px_1fr_120px] items-center gap-3">
                <span className="pl-3 text-[11px] text-critical">↳ {branch.label}</span>
                <div className="flex justify-center">
                  <div className="h-3 rounded-sm bg-critical/60" style={{ width: `${Math.max(1, ((branch.value ?? 0) / max) * 100)}%` }} />
                </div>
                <span className="text-right text-[11px] tabular-nums text-critical">
                  {formatCount(branch.value)} ({formatPct(branch.rate)})
                </span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
