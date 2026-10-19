import "server-only";

import { isIsoDate, todayIST, type DateRange } from "@/lib/format/ist";
import { RegionalNewRow, RegionalRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/**
 * Eligible Fresh orders aggregated into the regional hierarchy (lib/geo/regions.ts): Priority Mumbai pincodes,
 * Tier 1, Delhi NCR, Tier 2, Tier 3 — by tier, market, area, metro city, priority
 * pincode and day.
 */
export function getRegional(range: DateRange) {
  return runSource("regions", "regional_fresh", rangeParams(range), RegionalRow);
}

/**
 * Day / previous day / last 7 days / month to date, anchored to the end date of the date filter (IST), total and per
 * tier. See lib/format/periods.ts for how an in-progress today is handled.
 */
export function getRegionalPeriods(anchor: string, today: string = todayIST()) {
  if (!isIsoDate(anchor) || !isIsoDate(today) || anchor > today) throw new Error("Invalid date");
  return runSource("regions", "regional_periods", [anchor, today], RegionalRow);
}

/** Pincodes and areas getting their first-ever eligible Fresh order in the range, by day and tier. */
export function getRegionalNewMarkets(range: DateRange) {
  return runSource("regions", "regional_new_markets", rangeParams(range), RegionalNewRow);
}
