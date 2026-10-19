import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { AfAdDailyRow, AfCampaignDailyRow, AfEventsDailyRow, AfFunnelRow, AfFunnelWindowRow } from "@/lib/types/schemas";
import { assertRange, rangeParams, runSource } from "./run";

/** public.af_events_rt — paid-user events by IST date (coverage from 6 Oct 2026). */
export function getAfEventsDaily(range: DateRange) {
  return runSource("af_events", "af_events_daily", rangeParams(range), AfEventsDailyRow);
}

/** adwatch.af_ad_daily — AppsFlyer installs and purchasers by ad name. */
export function getAfAdDaily(range: DateRange) {
  return runSource("af_ad_daily", "af_ad_daily", rangeParams(range), AfAdDailyRow);
}

/** AppsFlyer paid-user funnel over the range: distinct devices / users per stage, plus new vs repeat add-to-cart. */
export function getAfFunnel(range: DateRange) {
  return runSource("af_events", "af_funnel", rangeParams(range), AfFunnelRow);
}

/** The AppsFlyer funnel for several named windows, from one read of their combined span. */
export function getAfFunnelWindows(windows: { id: string; from: string; to: string }[]) {
  for (const w of windows) assertRange(w);
  return runSource("af_events", "af_funnel_windows", windows.map((w) => `${w.id}:${w.from}:${w.to}`), AfFunnelWindowRow);
}

/** adwatch.af_campaign_daily — AppsFlyer installs, add-to-cart users and first purchasers by Meta campaign name. */
export function getAfCampaignDaily(range: DateRange) {
  return runSource("af_ad_daily", "af_campaign_daily", rangeParams(range), AfCampaignDailyRow);
}
