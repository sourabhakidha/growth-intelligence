"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MetricFormat } from "@/lib/metrics/definitions";
import { formatMetric } from "@/lib/format/metric";
import { SERIES_COLOR, type SeriesColor } from "./palette";

export interface CategorySeries {
  key: string;
  label: string;
  color: SeriesColor;
}

interface CategoryBarsProps {
  data: Record<string, string | number | null>[];
  /** Field holding the category label (tier, city, period…). */
  categoryKey: string;
  series: CategorySeries[];
  format: MetricFormat;
  /** "horizontal" draws bars left-to-right with categories down the side (best for long labels / rankings). */
  orientation?: "vertical" | "horizontal";
  stacked?: boolean;
  height?: number;
}

/** Bars by category on ONE value axis (never dual-axis). Same visual language as TrendChart. */
export function CategoryBars({ data, categoryKey, series, format, orientation = "vertical", stacked = false, height }: CategoryBarsProps) {
  const axisTick = { fill: "var(--text-muted)", fontSize: 11 };
  const horizontal = orientation === "horizontal";
  const h = height ?? (horizontal ? Math.max(160, data.length * 34 + 48) : 260);
  const valueFmt = (v: number) => formatMetric(v, format, true);

  const categoryAxisProps = { dataKey: categoryKey, tick: axisTick, tickLine: false, axisLine: { stroke: "var(--border)" }, interval: 0 as const };
  const valueAxisProps = { tick: axisTick, tickLine: false, axisLine: false, tickFormatter: valueFmt };

  return (
    <div style={{ height: h }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          barCategoryGap="22%"
        >
          <CartesianGrid horizontal={!horizontal} vertical={horizontal} stroke="var(--grid)" />
          {horizontal ? (
            <>
              <XAxis type="number" {...valueAxisProps} />
              <YAxis type="category" width={150} {...categoryAxisProps} />
            </>
          ) : (
            <>
              <XAxis type="category" {...categoryAxisProps} />
              <YAxis type="number" width={56} {...valueAxisProps} />
            </>
          )}
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{
              background: "var(--surface-1)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--text-primary)",
            }}
            labelStyle={{ color: "var(--text-secondary)", marginBottom: 4 }}
            formatter={(v, name) => [formatMetric(Number(v), format), String(name)]}
          />
          {series.length > 1 ? <Legend iconType="square" wrapperStyle={{ fontSize: 12, color: "var(--text-secondary)" }} /> : null}
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={SERIES_COLOR[s.color]}
              stackId={stacked ? "a" : undefined}
              radius={stacked ? 0 : horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]}
              stroke="var(--surface-1)"
              strokeWidth={stacked ? 1 : 0}
              maxBarSize={28}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
