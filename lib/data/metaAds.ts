import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { MetaAccountDailyRow, MetaAdDailyRow, MetaAdHistoryRow, MetaAfRow, MetaSameTimeRow } from "@/lib/types/schemas";
import { isIsoDate } from "@/lib/format/ist";
import { rangeParams, runSource } from "./run";

/** adwatch.meta_ad_daily — ad × day delivery, spend and Meta-reported installs. */
export function getMetaAdDaily(range: DateRange) {
  return runSource("meta_ad_daily", "meta_ad_daily", rangeParams(range), MetaAdDailyRow);
}

/** Account-level daily totals (CAC numerator). */
export function getMetaAccountDaily(range: DateRange) {
  return runSource("meta_ad_daily", "meta_account_daily", rangeParams(range), MetaAccountDailyRow);
}

/** Every ad × day since adwatch coverage (12 Sep 2026) up to `to` — baselines, trends and first-delivery dates. */
export function getMetaAdHistory(to: string) {
  if (!isIsoDate(to)) throw new Error("Invalid date");
  return runSource("meta_ad_daily", "meta_ad_history", [to], MetaAdHistoryRow);
}

/**
 * Meta-attributed AppsFlyer installs / add-to-cart devices: daily over the range, plus distinct counts per window, plus
 * (with `sameTime`) each recent day counted only to `cutoffMinute` IST (level "st").
 */
export function getMetaAf(range: DateRange, windows: { id: string; from: string; to: string }[], sameTime?: { today: string; cutoffMinute: number }) {
  const ws = windows.filter((w) => w.from <= w.to).map((w) => `${w.id}:${w.from}:${w.to}`);
  if (sameTime && (!isIsoDate(sameTime.today) || !Number.isInteger(sameTime.cutoffMinute) || sameTime.cutoffMinute < 0 || sameTime.cutoffMinute > 1439)) throw new Error("Invalid same-time params");
  const st = sameTime ? [`st:${sameTime.today}:${sameTime.cutoffMinute}`] : [];
  return runSource("af_events", "meta_af", [...rangeParams(range), ...ws, ...st], MetaAfRow);
}

/** Each day from the earlier of 7 days back and the 1st of the month, counted only to `cutoffMinute` IST (meta_same_time.sql). */
export function getMetaSameTime(today: string, cutoffMinute: number) {
  if (!isIsoDate(today) || !Number.isInteger(cutoffMinute) || cutoffMinute < 0 || cutoffMinute > 1439) throw new Error("Invalid same-time params");
  return runSource("meta_ad_daily", "meta_same_time", [today, cutoffMinute], MetaSameTimeRow);
}
