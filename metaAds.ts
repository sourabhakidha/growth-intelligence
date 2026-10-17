import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { MetaAccountDailyRow, MetaAdDailyRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/** adwatch.meta_ad_daily — ad × day delivery, spend and Meta-reported installs. */
export function getMetaAdDaily(range: DateRange) {
  return runSource("meta_ad_daily", "meta_ad_daily", rangeParams(range), MetaAdDailyRow);
}

/** Account-level daily totals (CAC numerator). */
export function getMetaAccountDaily(range: DateRange) {
  return runSource("meta_ad_daily", "meta_account_daily", rangeParams(range), MetaAccountDailyRow);
}
