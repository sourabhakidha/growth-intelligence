import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { CartLeadLifecycleDailyRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/**
 * crm.leads → crm.tasks → Order_Level_V4 lifecycle, rolled up by lead date. PROVISIONAL: task-level signals
 * until the recovery attribution rule is agreed. Call-level timing (crm.calls_*, crm.events_*) is Phase 2B.
 */
export function getCartLeadLifecycleDaily(range: DateRange) {
  return runSource("crm_lifecycle", "cart_lead_lifecycle_daily", rangeParams(range), CartLeadLifecycleDailyRow);
}
