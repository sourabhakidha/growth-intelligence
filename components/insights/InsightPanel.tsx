import type { ActionInsight } from "@/lib/metrics/actionInsights";
import { cn } from "@/lib/cn";

const PRIORITY: Record<ActionInsight["priority"], { label: string; cls: string }> = {
  1: { label: "Act now", cls: "bg-critical/10 text-critical" },
  2: { label: "This week", cls: "bg-warning/10 text-serious" },
  3: { label: "Monitor", cls: "bg-surface-2 text-ink-2" },
};

/**
 * Ranked action panel. Each insight is collapsed to its headline; expanding shows
 * evidence → likely causes (confirmed / hypothesis) → levers → action → impact → follow-up.
 * Native <details>, so it works without client JS.
 */
export function InsightPanel({ insights, limit }: { insights: ActionInsight[]; limit?: number }) {
  const shown = limit ? insights.slice(0, limit) : insights;
  if (!shown.length) return <p className="text-sm text-ink-2">No insight crossed the thresholds for this period.</p>;
  return (
    <ol className="divide-y divide-line">
      {shown.map((x, i) => (
        <li key={x.id}>
          <details className="group py-2.5" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-start gap-3">
              <span className="mt-0.5 w-5 shrink-0 text-xs tabular-nums text-ink-3">{i + 1}</span>
              <span className={cn("mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium", PRIORITY[x.priority].cls)}>{PRIORITY[x.priority].label}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-ink">{x.title}</span>
                <span className="block text-[11px] text-ink-3">
                  {x.kind === "tracking" ? "Tracking / data quality · " : ""}
                  {x.affects}
                </span>
              </span>
              <span className="mt-0.5 text-xs text-ink-3 group-open:rotate-90">›</span>
            </summary>
            <dl className="mt-2 grid gap-x-4 gap-y-1.5 min-w-0 pl-8 text-xs text-ink-2 [overflow-wrap:anywhere] sm:grid-cols-[120px_1fr]">
              <dt className="font-medium text-ink-3">Evidence</dt>
              <dd>
                <ul className="list-disc space-y-0.5 pl-4">
                  {x.evidence.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              </dd>
              <dt className="font-medium text-ink-3">Likely cause(s)</dt>
              <dd>
                <ul className="space-y-0.5">
                  {x.causes.map((c) => (
                    <li key={c.text}>
                      <span className={cn("mr-1.5 rounded px-1 text-[10px]", c.status === "confirmed" ? "bg-good/10 text-good" : "bg-surface-2 text-ink-3")}>
                        {c.status === "confirmed" ? "Confirmed" : `Hypothesis · ${c.confidence} confidence`}
                      </span>
                      {c.text}
                    </li>
                  ))}
                </ul>
              </dd>
              {x.levers.length ? (
                <>
                  <dt className="font-medium text-ink-3">Levers</dt>
                  <dd>{x.levers.join(" · ")}</dd>
                </>
              ) : null}
              <dt className="font-medium text-ink-3">Action</dt>
              <dd className="text-ink">{x.action}</dd>
              <dt className="font-medium text-ink-3">Business impact</dt>
              <dd>{x.impact}</dd>
              <dt className="font-medium text-ink-3">Follow-up metric</dt>
              <dd>{x.followUp}</dd>
            </dl>
          </details>
        </li>
      ))}
    </ol>
  );
}
