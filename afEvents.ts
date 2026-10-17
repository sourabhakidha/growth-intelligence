import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { AfAdDailyRow, AfEventsDailyRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/** public.af_events_rt — paid-user events by IST date (coverage from 6 Oct 2026). */
export function getAfEventsDaily(range: DateRange) {
  return runSource("af_events", "af_events_daily", rangeParams(range), AfEventsDailyRow);
}

/** adwatch.af_ad_daily — AppsFlyer installs and purchasers by ad name. */
export function getAfAdDaily(range: DateRange) {
  return runSource("af_ad_daily", "af_ad_daily", rangeParams(range), AfAdDailyRow);
}
