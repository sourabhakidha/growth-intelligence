// Output shapes for every reporting query. These are the ONLY fields that may leave the
// database layer. zod strips any column not listed here, so a stray column in SQL can never
// reach a page. tests/pii-guard.test.ts fails the build if a PII-like key is added here.
//
// Numeric columns arrive from node-postgres as strings for numeric/bigint; z.coerce handles that.

import { z } from "zod";

const num = z.coerce.number();
const numOrNull = z.preprocess((v) => (v === null || v === undefined ? null : Number(v)), z.number().nullable());
const isoDate = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
);
const ts = z.preprocess((v) => (v instanceof Date ? v.toISOString() : v), z.string().nullable());

/** Order channel derived from orderPlatform + Internal_Team (agent-placed). See audit §4.1–4.2. */
export const OrderChannel = z.enum(["APP", "WEB_AGENT", "WEB_OTHER"]);
export type OrderChannel = z.infer<typeof OrderChannel>;

// ---------- Orders (public."Order_Level_V4") ----------
export const OrdersDailyRow = z.object({
  order_date: isoDate,
  channel: OrderChannel,
  order_type: z.enum(["Fresh", "Repeat"]),
  orders: num,
  unique_customers: num, // distinct userID within this day × channel × type only — never sum across rows
  revenue: num,
  completed_orders: num,
  completed_revenue: num,
  avg_patient_age: numOrNull,
});
export type OrdersDailyRow = z.infer<typeof OrdersDailyRow>;

/** Range-level distinct customers (deduplicated across days and channels). */
export const OrdersUniqueCustomersRow = z.object({
  order_type: z.enum(["Fresh", "Repeat"]),
  unique_customers_all: num,
  unique_customers_app: num,
  unique_customers_web_agent: num,
  unique_customers_web_other: num,
});
export type OrdersUniqueCustomersRow = z.infer<typeof OrdersUniqueCustomersRow>;

export const OrdersPaymentMixRow = z.object({
  channel: OrderChannel,
  payment_mode: z.string(),
  orders: num,
  revenue: num,
});
export type OrdersPaymentMixRow = z.infer<typeof OrdersPaymentMixRow>;

// ---------- Meta (adwatch.meta_ad_daily) ----------
export const MetaAdDailyRow = z.object({
  date: isoDate,
  campaign_id: z.string(),
  campaign_name: z.string().nullable(),
  adset_id: z.string(),
  adset_name: z.string().nullable(),
  ad_id: z.string(),
  ad_name: z.string().nullable(),
  spend: num,
  impressions: num,
  reach: num,
  clicks: num,
  link_clicks: num,
  installs: num,
});
export type MetaAdDailyRow = z.infer<typeof MetaAdDailyRow>;

export const MetaAccountDailyRow = z.object({
  date: isoDate,
  spend: num,
  impressions: num,
  clicks: num,
  link_clicks: num,
  installs: num,
});
export type MetaAccountDailyRow = z.infer<typeof MetaAccountDailyRow>;

// ---------- Meta cross-check (marketing_meta.meta_campaign_performance_daily) ----------
export const MetaSpendCheckRow = z.object({
  date: isoDate,
  adwatch_spend: numOrNull,
  campaign_table_spend: numOrNull,
  adwatch_impressions: numOrNull,
  campaign_table_impressions: numOrNull,
});
export type MetaSpendCheckRow = z.infer<typeof MetaSpendCheckRow>;

// ---------- AppsFlyer (public.af_events_rt) — paid (non-organic) users only ----------
export const AfEventsDailyRow = z.object({
  event_date: isoDate,
  event_name: z.string(),
  media_source_group: z.enum(["restricted", "facebook", "other_paid"]),
  events: num,
  unique_devices: num, // distinct appsflyer_id
  unique_users: num, // distinct customer_user_id (= Order_Level_V4.userID)
});
export type AfEventsDailyRow = z.infer<typeof AfEventsDailyRow>;

// ---------- AppsFlyer ad aggregate (adwatch.af_ad_daily) ----------
export const AfAdDailyRow = z.object({
  date: isoDate,
  ad_name: z.string(),
  installs: num,
  purchasers: num, // AppsFlyer-attributed purchasers, NOT Fresh orders
});
export type AfAdDailyRow = z.infer<typeof AfAdDailyRow>;

// ---------- GA4 all-user funnel (bigquery_data.app_funnel_daily) ----------
export const AppFunnelDailyRow = z.object({
  day: isoDate,
  platform: z.string(),
  first_open: num,
  active_users: num,
  searched: num,
  viewed_item: num,
  added_to_cart: num,
  viewed_cart: num,
  began_checkout: num,
  purchased: num,
  first_purchase: num,
});
export type AppFunnelDailyRow = z.infer<typeof AppFunnelDailyRow>;

// ---------- Abandoned-cart leads (crm.leads, written crm_025a rule) ----------
export const CartLeadDailyRow = z.object({
  lead_date: isoDate,
  total_cart_leads: num,
  fresh: num,
  repeat: num,
});
export type CartLeadDailyRow = z.infer<typeof CartLeadDailyRow>;

/** Lead lifecycle rolled up by lead date — no per-lead rows, no phone numbers. */
export const CartLeadLifecycleDailyRow = z.object({
  lead_date: isoDate,
  leads: num,
  with_task: num,
  dialled: num,
  won_any_order: num,
  won_fresh_app: num,
  won_fresh_web_agent: num,
  won_fresh_web_other: num,
  median_min_cart_to_lead: numOrNull,
});
export type CartLeadLifecycleDailyRow = z.infer<typeof CartLeadLifecycleDailyRow>;

// ---------- Regions (public.dash_city_region) ----------
export const RegionDailyRow = z.object({
  order_date: isoDate,
  region: z.string(), // mapped region, or "Unmapped"
  channel: OrderChannel,
  fresh_orders: num,
  fresh_revenue: num,
  completed_fresh_revenue: num,
});
export type RegionDailyRow = z.infer<typeof RegionDailyRow>;

export const UnmappedCityRow = z.object({
  city_key: z.string(), // normalised city text only (no address)
  fresh_orders: num,
});
export type UnmappedCityRow = z.infer<typeof UnmappedCityRow>;

// ---------- Freshness ----------
export const SourceFreshnessRow = z.object({
  source: z.string(),
  latest_data_date: isoDate.nullable(),
  last_loaded_at: ts,
});
export type SourceFreshnessRow = z.infer<typeof SourceFreshnessRow>;

/** Registry consumed by the PII guard test. Add every schema here. */
export const ALL_ROW_SCHEMAS = {
  OrdersDailyRow,
  OrdersUniqueCustomersRow,
  OrdersPaymentMixRow,
  MetaAdDailyRow,
  MetaAccountDailyRow,
  MetaSpendCheckRow,
  AfEventsDailyRow,
  AfAdDailyRow,
  AppFunnelDailyRow,
  CartLeadDailyRow,
  CartLeadLifecycleDailyRow,
  RegionDailyRow,
  UnmappedCityRow,
  SourceFreshnessRow,
} as const;
