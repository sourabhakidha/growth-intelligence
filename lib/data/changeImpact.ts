import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { CampaignReachRow, ChangeLogRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/** crm.change_log — logged changes starting in the range, plus earlier ones still open in it. */
export function getChangeLog(range: DateRange) {
  return runSource("crm_change_log", "change_log", rangeParams(range), ChangeLogRow);
}

/** marketing_meta.meta_campaign_performance_daily — Meta's campaign-day reach. */
export function getCampaignReach(range: DateRange) {
  return runSource("meta_campaign_check", "meta_campaign_reach", rangeParams(range), CampaignReachRow);
}
