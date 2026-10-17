import type { MetricFormat } from "../metrics/definitions";
import { formatCount, formatINR, formatINRCompact, formatINRPrecise, formatPct } from "./inr";

/** Format a metric value for display according to its definition. */
export function formatMetric(value: number | null | undefined, format: MetricFormat, compact = false): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (format) {
    case "inr":
      return compact ? formatINRCompact(value) : formatINR(value);
    case "inr_precise":
      return formatINRPrecise(value);
    case "count":
      return formatCount(value);
    case "pct":
      return formatPct(value);
    case "minutes":
      return `${value.toFixed(1)} min`;
    case "years":
      return `${value.toFixed(1)} yrs`;
  }
}
