import "server-only";

import { parseRange, previousPeriod, type DateRange } from "@/lib/format/ist";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Validated IST range from the URL (falls back to month-to-date) plus the equal-length previous period. */
export async function rangeFromSearchParams(sp: SearchParams): Promise<{ range: DateRange; previous: DateRange }> {
  const p = await sp;
  const r = parseRange({ from: p.from, to: p.to });
  const range = { from: r.from, to: r.to };
  return { range, previous: previousPeriod(range) };
}
