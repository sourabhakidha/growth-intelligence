"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MetricFormat } from "@/lib/metrics/definitions";
import { formatMetric } from "@/lib/format/metric";
import { formatDate, formatDateShort } from "@/lib/format/ist";
import { SERIES_COLOR, type SeriesColor } from "./palette";

export interface TrendSeries {
  key: string;
  label: string;
  color: SeriesColor;
}

interface TrendChartProps {
  data: Record<string, string | number | null>[];
  xKey: string; // IST ISO date
  series: TrendSeries[];
  format: MetricFormat;
  kind?: "line" | "bar";
  stacked?: boolean;
  height?: number;
}

/** Daily trend on ONE y-axis (never dual-axis). Legend for ≥2 series; crosshair tooltip on hover. */
export function TrendChart({ data, xKey, series, format, kind = "line", stacked = false, height = 260 }: TrendChartProps) {
  const axisTick = { fill: "var(--text-muted)", fontSize: 11 };
  const common = {
    data,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  };
  const yFmt = (v: number) => formatMetric(v, format, true);

  const tooltip = (
    <Tooltip
      cursor={kind === "line" ? { stroke: "var(--border-strong)", strokeWidth: 1 } : { fill: "var(--surface-2)" }}
      contentStyle={{
        background: "var(--surface-1)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontSize: 12,
        color: "var(--text-primary)",
      }}
      labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
      labelFormatter={(l) => formatDate(String(l))}
      formatter={(v, name) => [formatMetric(Number(v), format), String(name)]}
    />
  );

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--grid)" />
      <XAxis dataKey={xKey} tick={axisTick} tickLine={false} axisLine={{ stroke: "var(--border)" }} tickFormatter={(d) => formatDateShort(String(d))} minTickGap={24} />
      <YAxis tick={axisTick} tickLine={false} axisLine={false} width={64} tickFormatter={yFmt} />
      {tooltip}
      {series.length > 1 ? <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} /> : null}
    </>
  );

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart {...common} barCategoryGap="20%">
            {axes}
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                fill={SERIES_COLOR[s.color]}
                stackId={stacked ? "a" : undefined}
                radius={stacked ? 0 : [4, 4, 0, 0]}
                stroke="var(--surface-1)"
                strokeWidth={stacked ? 1 : 0}
                maxBarSize={28}
              />
            ))}
          </BarChart>
        ) : (
          <LineChart {...common}>
            {axes}
            {series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stroke={SERIES_COLOR[s.color]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--surface-1)", strokeWidth: 2 }}
                connectNulls={false}
                type="monotone"
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
