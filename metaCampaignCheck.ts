import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { MetaSpendCheckRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/** adwatch vs marketing_meta daily spend/impressions reconciliation. */
export function getMetaSpendCheck(range: DateRange) {
  return runSource("meta_campaign_check", "meta_spend_check", rangeParams(range), MetaSpendCheckRow);
}
