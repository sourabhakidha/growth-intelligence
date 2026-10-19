import type { DataResult } from "@/lib/types/result";
import { ResultState } from "@/components/state/States";
import { StatusBadge } from "@/components/state/Badges";
import type { MetricStatus } from "@/lib/metrics/definitions";
import { cn } from "@/lib/cn";

interface ChartCardProps {
  title: string;
  question?: string; // the business question this chart answers
  result?: DataResult<unknown>;
  status?: MetricStatus;
  footnote?: string;
  className?: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}

/** Card frame for a chart or table. Renders the data state explicitly when there is nothing to plot. */
export function ChartCard({ title, question, result, status, footnote, className, children, actions }: ChartCardProps) {
  const showBody = !result || result.state === "ok";
  return (
    <section className={cn("flex min-w-0 flex-col rounded-lg border border-line bg-surface-1", className)}>
      <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {question ? <p className="mt-0.5 text-xs text-ink-2">{question}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {status && status !== "reliable" ? <StatusBadge status={status} /> : null}
          {actions}
        </div>
      </header>
      <div className="flex-1 p-4">{showBody ? children : result ? <ResultState result={result} /> : null}</div>
      {footnote ? <footer className="border-t border-line px-4 py-2 text-[11px] leading-relaxed text-ink-3">{footnote}</footer> : null}
    </section>
  );
}
