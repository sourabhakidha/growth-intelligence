import { formatDateShort } from "@/lib/format/ist";
import { formatMetric } from "@/lib/format/metric";
import { KIND_LABEL, type ChangeAssessment, type Decision, type ImpactRow, type Verdict } from "@/lib/metrics/changeImpact";
import { cn } from "@/lib/cn";

// One expandable card per change: what changed / who / when / campaigns / intent / expected outcome, the before → after
// table from Meta to New Sales, the read, uncertainties, the recommended action and questions for Performance Marketing.

const VERDICT_CLS: Record<Verdict, string> = {
  Positive: "bg-good/10 text-good",
  Negative: "bg-critical/10 text-critical",
  Mixed: "bg-warning/10 text-serious",
  Inconclusive: "bg-surface-2 text-ink-2",
  "Too early": "bg-surface-2 text-ink-3",
};

const DECISION_TEXT: Record<Decision, string> = { Retain: "text-good", Reverse: "text-critical", Test: "text-serious", Wait: "text-ink-2" };
const DECISION_BORDER: Record<Decision, string> = { Retain: "border-good/50", Reverse: "border-critical/50", Test: "border-warning/60", Wait: "border-line" };

const span = (w: { from: string; to: string }) => (w.from === w.to ? formatDateShort(w.from) : `${formatDateShort(w.from)} – ${formatDateShort(w.to)}`);
const fmt = (v: number | null, f: ImpactRow["format"]) => (f === "pct" && v !== null ? `${(v * 100).toFixed(2)}%` : formatMetric(v, f, f === "inr"));

function ImpactTable({ a }: { a: ChangeAssessment }) {
  const stages = ["Meta", "App funnel", "New Sales"] as const;
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead className="bg-surface-2/60 text-ink-2">
          <tr>
            <th scope="col" className="px-3 py-1.5 text-left font-medium">Metric</th>
            <th scope="col" className="px-3 py-1.5 text-left font-medium">Scope</th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">Before · {span(a.pre)}</th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">After · {span(a.post)}</th>
            <th scope="col" className="px-3 py-1.5 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody>
          {stages.map((st) => (
            <StageRows key={st} stage={st} rows={a.rows.filter((r) => r.stage === st)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StageRows({ stage, rows }: { stage: string; rows: ImpactRow[] }) {
  return (
    <>
      <tr>
        <th colSpan={5} scope="colgroup" className="border-y border-line bg-surface-2/30 px-3 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-ink-2">
          {stage}
        </th>
      </tr>
      {rows.map((r) => {
        const good = r.change === null || r.change === 0 ? null : r.up ? r.change > 0 : r.change < 0;
        return (
          <tr key={`${r.key}-${r.scope}`} className="border-b border-line last:border-0">
            <td className="px-3 py-1 text-ink">{r.label}</td>
            <td className="px-3 py-1 text-ink-2">{r.scope}</td>
            <td className="px-3 py-1 text-right tabular-nums text-ink-2">{fmt(r.pre, r.format)}</td>
            <td className="px-3 py-1 text-right font-medium tabular-nums text-ink">{fmt(r.post, r.format)}</td>
            <td className={cn("px-3 py-1 text-right font-semibold tabular-nums", good === null ? "text-ink-3" : good ? "text-good" : "text-critical")}>
              {r.change === null ? "—" : `${r.change > 0 ? "▲" : r.change < 0 ? "▼" : "■"} ${Math.abs(r.change * 100).toFixed(1)}%`}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-xs text-ink">{children}</dd>
    </div>
  );
}

const missing = <span className="text-ink-3">Not logged</span>;

export function ChangeImpactList({ items, open = 2 }: { items: ChangeAssessment[]; open?: number }) {
  if (!items.length) return <p className="text-sm text-ink-2">No material change was detected or logged in the selected dates.</p>;
  return (
    <ol className="divide-y divide-line">
      {items.map((a, i) => {
        const c = a.change;
        return (
          <li key={c.id}>
            <details className="group py-3" open={i < open}>
              <summary className="flex cursor-pointer list-none flex-wrap items-start gap-x-3 gap-y-1">
                <span className="w-14 shrink-0 pt-0.5 text-xs font-medium tabular-nums text-ink-2">{formatDateShort(c.date)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink [overflow-wrap:anywhere]">{c.title}</span>
                  <span className="block text-[11px] text-ink-3">
                    {KIND_LABEL[c.kind]} · {c.area} · {c.source}
                    {c.weight ? ` · ${(c.weight * 100).toFixed(0)}% of spend` : ""}
                  </span>
                </span>
                <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", VERDICT_CLS[a.verdict])}>{a.verdict}</span>
                <span className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-2">{a.confidence} confidence</span>
                <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-semibold", DECISION_BORDER[a.decision], DECISION_TEXT[a.decision])}>{a.decision}</span>
                <span className="pt-0.5 text-xs text-ink-3 group-open:rotate-90">›</span>
              </summary>

              <div className="mt-3 min-w-0 space-y-3 [overflow-wrap:anywhere] sm:pl-[68px]">
                <dl className="grid gap-3 rounded-md border border-line bg-surface-2/30 p-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Field label="What changed">{c.evidence}</Field>
                  <Field label="Who / when">
                    {c.who ?? missing} · {formatDateShort(c.date)}
                    {c.logStatus ? <span className="text-ink-2"> · log status: {c.logStatus}</span> : null}
                  </Field>
                  <Field label="Affected campaigns">{c.campaigns.length ? c.campaigns.join(", ") : c.area === "CRM" ? "None (CRM change — affects leads and sales)" : "Account"}</Field>
                  <Field label="Strategic intent">{c.intent ?? missing}</Field>
                  <Field label="Expected outcome">{c.expected ?? missing}</Field>
                  <Field label="Recommended action">
                    <span className={cn("mr-1 font-semibold", DECISION_TEXT[a.decision])}>{a.decision}:</span>
                    {a.action}
                    <span className="mt-0.5 block text-ink-2">
                      Owner: {a.owner} · review by {formatDateShort(a.reviewBy)}
                    </span>
                  </Field>
                </dl>

                <ImpactTable a={a} />

                <div className="grid gap-3 lg:grid-cols-3 [&>*]:min-w-0">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Impact</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink">
                      {a.explanation.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Uncertainties</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink-2">
                      {a.uncertainties.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-3">Questions for Performance Marketing</p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-xs text-ink">
                      {a.questions.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}
