import "server-only";

import type { DateRange } from "@/lib/format/ist";
import { OrdersDailyRow, OrdersPaymentMixRow, OrdersUniqueCustomersRow } from "@/lib/types/schemas";
import { rangeParams, runSource } from "./run";

/** public."Order_Level_V4" — date × channel × Fresh/Repeat with the agreed status exclusions. */
export function getOrdersDaily(range: DateRange) {
  return runSource("orders", "orders_daily", rangeParams(range), OrdersDailyRow);
}

/** Range-level de-duplicated customer counts (never sum APP + WEB). */
export function getUniqueCustomers(range: DateRange) {
  return runSource("orders", "orders_unique_customers", rangeParams(range), OrdersUniqueCustomersRow);
}

/** Fresh-order payment mix by channel. */
export function getPaymentMix(range: DateRange) {
  return runSource("orders", "orders_payment_mix", rangeParams(range), OrdersPaymentMixRow);
}
