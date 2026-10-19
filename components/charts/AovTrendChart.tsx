"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatDateShort } from "@/lib/format/ist";
import { formatCount, formatINR, formatPct } from "@/lib/format/inr";
import { BRACKETS, BRACKET_LABEL, type DailyAovPoint } from "@/lib/metrics/aov";
import { cn } from "@/lib/cn";

// Bracket colours run cool (small baskets) → warm (large); "amount missing" is neutral.
const BRACKET_COLOR: Record<string, string> = {
  b0_100: "#c7d7f5",
  b100_200: "#8fb0ec",
  b200_500: "var(--series-app)",
  b500_600: "var(--series-tier-4)",
  b600_plus: "var(--series-web-other)",
  no_amount: "var(--series-neutral)",
};

/**
 * One chart: stacked bars = daily Fresh orders split by AOV bracket (bar height = order volume; segments = mix), with
 * daily AOV and trailing 7-day AOV as lines on the right ₹ axis. "Mix %" switches the bars to each bracket's share of
 * the day's orders so mix can be read on quiet days too.
 */
export function AovTrendChart({ data }: { data: DailyAovPoint[] }) {
  const [mode, setMode] = useState<"count" | "share">("count");
  const tick = { fill: "var(--text-muted)", fontSize: 11 };
  const brackets = BRACKETS.filter((b) => b !== "no_amount" || data.some((d) => d.no_amount > 0));
  return (
    <div>
      <div className="mb-2 flex gap-1" role="group" aria-label="Bar view">
        {(["count", "share"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            aria-pressed={mode === m}
            className={cn("rounded-md border px-2 py-1 text-xs", mode === m ? "border-accent bg-accent text-white" : "border-line text-ink-2 hover:bg-surface-2")}
          >
            {m === "count" ? "Bars: Fresh orders" : "Bars: bracket mix %"}
          </button>
        ))}
      </div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" tick={tick} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={(d) => formatDateShort(String(d))} minTickGap={18} />
            <YAxis
              yAxisId="bars"
              tick={tick}
              tickLine={false}
              axisLine={false}
              width={44}
              domain={mode === "share" ? [0, 1] : [0, "auto"]}
              tickFormatter={(v) => (mode === "share" ? `${Math.round(Number(v) * 100)}%` : formatCount(Number(v)))}
              label={{ value: mode === "share" ? "Share of orders" : "Fresh orders", angle: -90, position: "insideLeft", fill: "var(--text-muted)", fontSize: 11, dy: 40 }}
            />
            <YAxis
              yAxisId="aov"
              orientation="right"
              tick={{ ...tick, fill: "var(--series-web-agent)" }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v) => `₹${v}`}
              label={{ value: "AOV (₹)", angle: 90, position: "insideRight", fill: "var(--series-web-agent)", fontSize: 11, dy: -24 }}
            />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-primary)" }}
              labelFormatter={(l) => {
                const d = data.find((x) => x.date === l);
                return `${formatDate(String(l))}${d ? ` · ${formatCount(d.orders)} Fresh orders · ${formatINR(d.revenue)}` : ""}`;
              }}
              formatter={(v, name, item) => {
                const key = String(item?.dataKey ?? "");
                if (key === "aov" || key === "aov_7d") return [v === null || v === undefined ? "—" : formatINR(Number(v)), String(name)];
                const b = key.replace(/_share$/, "") as keyof DailyAovPoint;
                const row = item?.payload as DailyAovPoint | undefined;
                const n = row ? Number(row[b] ?? 0) : 0;
                const share = row ? (row[`${b}_share` as keyof DailyAovPoint] as number | null) : null;
                return [`${formatCount(n)} (${formatPct(share)})`, String(name)];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} />
            {brackets.map((b) => (
              <Bar key={b} yAxisId="bars" dataKey={mode === "share" ? `${b}_share` : b} name={BRACKET_LABEL[b]} stackId="mix" fill={BRACKET_COLOR[b]} isAnimationActive={false} />
            ))}
            <Line yAxisId="aov" dataKey="aov" name="AOV (day)" stroke="var(--series-web-agent)" strokeWidth={1.5} strokeDasharray="3 3" dot={{ r: 2 }} connectNulls isAnimationActive={false} />
            <Line yAxisId="aov" dataKey="aov_7d" name="AOV (trailing 7 days)" stroke="var(--series-web-agent)" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
