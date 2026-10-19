import { formatMetric } from "@/lib/format/metric";
import type { MetricFormat } from "@/lib/metrics/definitions";
import type { CompareWindow } from "@/lib/metrics/metaIntel";
import type { SameTimeWindow } from "@/lib/metrics/sameTime";
import { cn } from "@/lib/cn";

// Measures × comparison windows (Today / Yesterday / Last 7 days / MTD / Selected range). Each cell shows the value,
// its change vs that window's own comparison (green = better, red = worse) and the comparison value. Same-time columns
// (`vsNow`) instead show how the "now" column compares with them, both counted to the same time of day. Server-rendered.

export interface MatrixWindow {
  key: string;
  short: string;
  span: string;
  cmpLabel: string;
  partial?: boolean;
  /** Same-time column: its change line is the "now" column vs this column's value. */
  vsNow?: boolean;
}

export interface MatrixCell {
  value: number | null;
  cmp?: number | null;
  /** Why there is no comparison (shown instead of the change). */
  noCmp?: string | null;
}

export interface MatrixRow {
  key: string;
  label: string;
  sub?: string;
  /** Section heading drawn above this row when it differs from the previous row's. */
  group?: string;
  format: MetricFormat;
  /** true = higher is better. */
  up: boolean;
  /** "points" for shares and conversion rates (change in percentage points); default relative %. */
  change?: "relative" | "points";
  hint?: string;
  /** One cell per window, in window order. */
  cells: MatrixCell[];
}

export const matrixWindows = (ws: readonly CompareWindow[]): MatrixWindow[] =>
  ws.map((w) => ({ key: w.id, short: w.short, span: w.span, cmpLabel: w.cmpLabel, partial: w.partial }));

/** Now / Yesterday / Last 7 days / MTD, every column counted to the same time of day and compared with "now". */
export const sameTimeMatrixWindows = (ws: readonly SameTimeWindow[]): MatrixWindow[] =>
  ws.map((w) => ({ key: w.id, short: w.short, span: w.span, cmpLabel: w.cmpLabel, vsNow: w.id !== "now" }));

// Rates such as CTR sit well under 1%, so percentages keep two decimals.
const fmt = (v: number | null | undefined, f: MetricFormat) =>
  f === "pct" && v !== null && v !== undefined && Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : formatMetric(v, f, f === "inr");

function Change({ cell, up, format, points, vsNow = false }: { cell: MatrixCell; up: boolean; format: MetricFormat; points: boolean; vsNow?: boolean }) {
  if (cell.noCmp) return <span className="whitespace-normal text-ink-3">{cell.noCmp}</span>;
  if (cell.value === null || cell.cmp === null || cell.cmp === undefined || (!points && cell.cmp === 0)) return <span className="text-ink-3">—</span>;
  const ch = points ? cell.value - cell.cmp : cell.value / cell.cmp - 1;
  const good = ch === 0 ? null : up ? ch > 0 : ch < 0;
  return (
    <>
      {vsNow ? <span className="text-ink-3">now </span> : null}
      <span className={cn("font-semibold", good === null ? "text-ink-2" : good ? "text-good" : "text-critical")}>
        {ch > 0 ? "▲" : ch < 0 ? "▼" : "■"} {Math.abs(ch * 100).toFixed(points ? 2 : 1)}{points ? " pp" : "%"}
      </span>
      {vsNow ? null : <span className="text-ink-3"> · {fmt(cell.cmp, format)}</span>}
    </>
  );
}

export function PeriodMatrix({ windows, rows, highlight = "range" }: { windows: MatrixWindow[]; rows: MatrixRow[]; highlight?: string }) {
  const hi = windows.findIndex((w) => w.key === highlight);
  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[820px] table-fixed border-collapse text-xs">
        <colgroup>
          <col style={{ width: "22%" }} />
          {windows.map((w) => (
            <col key={w.key} style={{ width: `${78 / windows.length}%` }} />
          ))}
        </colgroup>
        <thead className="bg-surface-2/60">
          <tr>
            <th scope="col" className="border-b border-line px-3 py-2 text-left font-medium text-ink-2">
              Measure
            </th>
            {windows.map((w, i) => (
              <th key={w.key} scope="col" title={w.cmpLabel} className={cn("border-b border-line px-3 py-2 text-right align-bottom", i === hi && "bg-accent/10")}>
                <span className="block font-semibold text-ink">{w.short}</span>
                <span className="block whitespace-nowrap text-[10px] font-normal text-ink-2">
                  {w.span}
                  {w.partial ? " · so far" : ""}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <MatrixBodyRow key={r.key} row={r} windows={windows} showGroup={!!r.group && r.group !== rows[ri - 1]?.group} hi={hi} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MatrixBodyRow({ row, windows, showGroup, hi }: { row: MatrixRow; windows: MatrixWindow[]; showGroup: boolean; hi: number }) {
  const span = windows.length + 1;
  const nowIdx = windows.findIndex((w) => w.key === "now");
  const now = nowIdx >= 0 ? row.cells[nowIdx] : null;
  return (
    <>
      {showGroup ? (
        <tr>
          <th colSpan={span} scope="colgroup" className="border-b border-line bg-surface-2/30 px-3 pb-1 pt-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-ink-2">
            {row.group}
          </th>
        </tr>
      ) : null}
      <tr className="border-b border-line last:border-0 hover:bg-surface-2/40">
        <th scope="row" className="px-3 py-2 text-left align-top font-normal" title={row.hint}>
          <span className="block font-medium text-ink">{row.label}</span>
          {row.sub ? <span className="block text-[10px] leading-tight text-ink-2">{row.sub}</span> : null}
        </th>
        {row.cells.map((c, i) => {
          const vsNow = !!windows[i]?.vsNow && now !== null;
          return (
            <td key={i} className={cn("px-3 py-2 text-right align-top tabular-nums", i === hi && "bg-accent/5")}>
              <span className="block text-sm font-semibold text-ink">{fmt(c.value, row.format)}</span>
              <span className="mt-0.5 block whitespace-nowrap text-[10px] leading-tight">
                {i === nowIdx && c.cmp === undefined && !c.noCmp ? (
                  <span className="text-ink-3">so far</span>
                ) : (
                  <Change cell={vsNow ? { value: now.value, cmp: c.value, noCmp: c.noCmp } : c} up={row.up} format={row.format} points={row.change === "points"} vsNow={vsNow} />
                )}
              </span>
            </td>
          );
        })}
      </tr>
    </>
  );
}
