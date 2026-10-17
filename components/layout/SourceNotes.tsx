import { SOURCES } from "@/lib/sources/registry";
import type { SourceId } from "@/lib/types/result";
import { formatDate } from "@/lib/format/ist";

/** "About this data" panel: grain, coverage, refresh and audited caveats for each source on the page. */
export function SourceNotes({ sources }: { sources: SourceId[] }) {
  return (
    <details className="group rounded-lg border border-line bg-surface-1">
      <summary className="cursor-pointer select-none px-4 py-3 text-sm font-semibold text-ink">About this data</summary>
      <div className="grid gap-3 border-t border-line p-4 md:grid-cols-2">
        {sources.map((id) => {
          const s = SOURCES[id];
          return (
            <div key={id} className="text-xs">
              <p className="font-medium text-ink">
                {s.label} <span className="ml-1 font-mono text-[10px] text-ink-3">{s.relation}</span>
              </p>
              <p className="mt-1 text-ink-2">
                Grain: {s.grain}. {s.coverageFrom ? `Coverage from ${formatDate(s.coverageFrom)}. ` : ""}Refresh: {s.refresh}.
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-2">
                {s.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}
