import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { CartLeadDailyRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/**
 * Abandoned-cart leads by IST date using the written crm_025a rule (lib/sql/cart_leads_daily.sql).
 * Intentionally does NOT call crm.cart_lead_daily(), whose live definition drifted in crm_027b.
 */
export function getCartLeadsDaily(range: DateRange) {
  return runSource("crm_cart_leads", "cart_leads_daily", rangeParams(range), CartLeadDailyRow);
}
