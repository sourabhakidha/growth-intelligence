import { formatRange, type DateRange } from "@/lib/format/ist";
import { SOURCES } from "@/lib/sources/registry";
import type { SourceId } from "@/lib/types/result";

interface PageHeaderProps {
  title: string;
  description: string;
  range: DateRange;
  sources: SourceId[];
}

export function PageHeader({ title, description, range, sources }: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">{description}</p>
      </div>
      <div className="flex flex-col items-start gap-1.5 md:items-end">
        <span className="tabular text-xs text-ink-2">{formatRange(range)} · IST</span>
        <div className="flex flex-wrap gap-1 md:justify-end">
          {sources.map((s) => (
            <span key={s} className="rounded border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-ink-3" title={SOURCES[s].label}>
              {SOURCES[s].relation}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
