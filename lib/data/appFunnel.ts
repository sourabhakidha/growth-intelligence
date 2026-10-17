import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { AppFunnelDailyRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/** bigquery_data.app_funnel_daily (foreign table) — all-user GA4 funnel, same-day distinct users. */
export function getAppFunnelDaily(range: DateRange) {
  return runSource("ga4_app_funnel", "app_funnel_daily", rangeParams(range), AppFunnelDailyRow);
}
