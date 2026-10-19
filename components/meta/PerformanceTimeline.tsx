"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatDateShort } from "@/lib/format/ist";
import { formatCount, formatINR, formatINRCompact } from "@/lib/format/inr";
import type { TimelineEvent, TimelinePoint } from "@/lib/metrics/metaFresh";
import { cn } from "@/lib/cn";

type SeriesKey = "spend" | "cpi" | "fresh_atc" | "new_sales";

const SERIES: { key: SeriesKey; label: string; color: string; axis: "spend" | "cpi" | "count"; fmt: (v: number) => string }[] = [
  { key: "spend", label: "Spend (₹)", color: "var(--series-app)", axis: "spend", fmt: (v) => formatINR(v) },
  { key: "cpi", label: "CPI (₹)", color: "var(--series-web-agent)", axis: "cpi", fmt: (v) => formatINR(v) },
  { key: "fresh_atc", label: "Fresh Add to Carts", color: "var(--series-web-other)", axis: "count", fmt: (v) => formatCount(v) },
  { key: "new_sales", label: "New Sales (Fresh orders)", color: "var(--series-tier-4)", axis: "count", fmt: (v) => formatCount(v) },
];

const EVENT_COLOR: Record<TimelineEvent["kind"], string> = {
  campaign_start: "var(--series-app)",
  campaign_stop: "var(--series-web-agent)",
  creative: "var(--series-web-other)",
  spend_shift: "var(--series-neutral)",
};

/**
 * One chart, three axes: spend bars (left, ₹), CPI line (right, ₹) and Fresh Add to Carts / New Sales lines (far right,
 * counts). Series can be switched off; dated events are drawn as labelled vertical lines and listed below the chart.
 */
export function PerformanceTimeline({ data, events }: { data: TimelinePoint[]; events: TimelineEvent[] }) {
  const [hidden, setHidden] = useState<Set<SeriesKey>>(new Set());
  const toggle = (k: SeriesKey) => setHidden((h) => {
    const n = new Set(h);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const tick = { fill: "var(--text-muted)", fontSize: 11 };
  const byDate = new Map<string, TimelineEvent[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Series">
        {SERIES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => toggle(s.key)}
            aria-pressed={!hidden.has(s.key)}
            className={cn("inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs text-ink", hidden.has(s.key) && "opacity-40")}
          >
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </button>
        ))}
      </div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 22, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" tick={tick} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={(d) => formatDateShort(String(d))} minTickGap={18} />
            <YAxis yAxisId="spend" tick={tick} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => formatINRCompact(Number(v))} hide={hidden.has("spend")} />
            <YAxis yAxisId="cpi" orientation="right" tick={{ ...tick, fill: "var(--series-web-agent)" }} tickLine={false} axisLine={false} width={44} tickFormatter={(v) => `₹${v}`} hide={hidden.has("cpi")} />
            <YAxis yAxisId="count" orientation="right" tick={{ ...tick, fill: "var(--series-web-other)" }} tickLine={false} axisLine={false} width={40} hide={hidden.has("fresh_atc") && hidden.has("new_sales")} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-primary)" }}
              labelFormatter={(l) => {
                const ev = byDate.get(String(l));
                return `${formatDate(String(l))}${ev ? ` — ${ev.map((e) => e.label).join("; ")}` : ""}`;
              }}
              formatter={(v, name) => {
                const s = SERIES.find((x) => x.label === name);
                return [v === null || v === undefined ? "—" : s ? s.fmt(Number(v)) : String(v), String(name)];
              }}
            />
            {[...byDate].map(([date, evs], i) => (
              <ReferenceLine
                key={date}
                x={date}
                yAxisId="spend"
                stroke={EVENT_COLOR[evs[0].kind]}
                strokeDasharray="4 3"
                label={{ value: `${i + 1}`, position: "top", fill: EVENT_COLOR[evs[0].kind], fontSize: 11, fontWeight: 600 }}
              />
            ))}
            {!hidden.has("spend") ? <Bar yAxisId="spend" dataKey="spend" name="Spend (₹)" fill="var(--series-app)" fillOpacity={0.35} radius={[3, 3, 0, 0]} isAnimationActive={false} /> : null}
            {!hidden.has("cpi") ? <Line yAxisId="cpi" dataKey="cpi" name="CPI (₹)" stroke="var(--series-web-agent)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} /> : null}
            {!hidden.has("fresh_atc") ? <Line yAxisId="count" dataKey="fresh_atc" name="Fresh Add to Carts" stroke="var(--series-web-other)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} /> : null}
            {!hidden.has("new_sales") ? <Line yAxisId="count" dataKey="new_sales" name="New Sales (Fresh orders)" stroke="var(--series-tier-4)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {byDate.size ? (
        <ol className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2 xl:grid-cols-3">
          {[...byDate].map(([date, evs], i) => (
            <li key={date} className="flex gap-2">
              <span className="w-5 shrink-0 font-semibold tabular-nums" style={{ color: EVENT_COLOR[evs[0].kind] }}>
                {i + 1}
              </span>
              <span className="text-ink">
                <span className="tabular-nums">{formatDateShort(date)}</span> — {evs.map((e) => e.label).join("; ")}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
