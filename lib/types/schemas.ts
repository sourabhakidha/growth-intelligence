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

/** APP = self-serve app orders; WEB = sales-assisted orders within the app business. Never split further. */
export const OrderChannel = z.enum(["APP", "WEB"]);
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
  unique_customers_web: num,
});
export type OrdersUniqueCustomersRow = z.infer<typeof OrdersUniqueCustomersRow>;

export const OrdersPaymentMixRow = z.object({
  channel: OrderChannel,
  payment_mode: z.string(),
  orders: num,
  revenue: num,
});
export type OrdersPaymentMixRow = z.infer<typeof OrdersPaymentMixRow>;

/** Eligible Fresh orders by IST date × channel × payment mode × region × AOV bracket (lib/sql/aov_fresh.sql). */
export const AovFreshRow = z.object({
  order_date: isoDate,
  channel: OrderChannel,
  payment_mode: z.string(),
  region: z.enum(["priority_mumbai", "tier_1", "delhi_ncr", "tier_2", "tier_3", "unverified"]),
  bracket: z.enum(["b0_100", "b100_200", "b200_500", "b500_600", "b600_plus", "no_amount"]),
  orders: num, // distinct orderID
  revenue: num, // Σ finalAmount (missing amounts = 0)
});
export type AovFreshRow = z.infer<typeof AovFreshRow>;

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

/** Ad × day history since adwatch coverage, with video metrics. reach / frequency are not additive. */
export const MetaAdHistoryRow = MetaAdDailyRow.extend({
  frequency: num,
  video_3s: num,
  thruplays: num,
});
export type MetaAdHistoryRow = z.infer<typeof MetaAdHistoryRow>;

/** Meta-attributed AppsFlyer devices: daily rows, or distinct counts over a named window. */
export const MetaAfRow = z.object({
  // day = one IST day; window = a named window; st = one IST day counted only to the same-time cut-off.
  level: z.enum(["day", "window", "st"]),
  key: z.string(),
  installs: num,
  atc: num,
  // Meta-attributed USERS (customer_user_id) whose first add-to-cart / checkout in the window came before any COMPLETED
  // order — the agreed Fresh (new-customer) rule. Distinct over the window, never summed across days.
  atc_fresh: num,
  checkout_fresh: num,
  // Eligible Fresh orders in the window placed by users with a Meta-attributed AppsFlyer event in the same window.
  // AppsFlyer user match to actual orders — not Meta purchase attribution.
  fresh_orders: num,
  fresh_orders_app: num,
  fresh_customers: num,
  // Fresh Add to Cart users (above) who placed an eligible Fresh order in the same window — a subset of atc_fresh.
  atc_fresh_buyers: num,
});
export type MetaAfRow = z.infer<typeof MetaAfRow>;

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

/** AppsFlyer funnel stage over the whole range: distinct devices and users, never daily counts summed. */
export const AfFunnelRow = z.object({
  stage: z.string(),
  events: numOrNull,
  devices: numOrNull, // distinct appsflyer_id
  users: numOrNull, // distinct customer_user_id
});
export type AfFunnelRow = z.infer<typeof AfFunnelRow>;

/** af_funnel rows for one named window of a multi-window read. */
export const AfFunnelWindowRow = AfFunnelRow.extend({ window: z.string() });
export type AfFunnelWindowRow = z.infer<typeof AfFunnelWindowRow>;

// ---------- AppsFlyer ad aggregate (adwatch.af_ad_daily) ----------
export const AfAdDailyRow = z.object({
  date: isoDate,
  ad_name: z.string(),
  installs: num,
  purchasers: num, // AppsFlyer-attributed purchasers, NOT Fresh orders
});
export type AfAdDailyRow = z.infer<typeof AfAdDailyRow>;

/** AppsFlyer aggregate by Meta campaign name (adwatch.af_campaign_daily, media_source 'Facebook Ads'). */
export const AfCampaignDailyRow = z.object({
  date: isoDate,
  campaign_name: z.string(),
  installs: num,
  atc_users: num, // AppsFlyer add-to-cart users, all customers (not Fresh-only)
  purchasers: num,
  first_purchasers: num, // AppsFlyer first-purchase users: AppsFlyer attribution, not Fresh orders
});
export type AfCampaignDailyRow = z.infer<typeof AfCampaignDailyRow>;

// ---------- GA4 all-user funnel (bigquery_data.app_funnel_daily) ----------
export const AppFunnelDailyRow = z.object({
  day: isoDate,
  platform: z.string(),
  first_open: num,
  active_users: num,
  otp_sent: num,
  otp_verified: num,
  searched: num,
  viewed_item: num,
  added_to_cart: num,
  viewed_cart: num,
  began_checkout: num,
  payment_failed: num,
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
  won_fresh_web: num,
  median_min_cart_to_lead: numOrNull,
});
export type CartLeadLifecycleDailyRow = z.infer<typeof CartLeadLifecycleDailyRow>;

// ---------- Regions (pincode hierarchy, lib/geo) ----------
/**
 * One aggregate row of the regional view. `key` is a label, area name, priority pincode (only when it has at least 3
 * distinct customers) or IST date for daily rows. No per-order or per-customer values.
 */
export const RegionalRow = z.object({
  level: z.enum(["total", "market", "tier", "area", "metro_city", "pincode", "daily_tier"]),
  group: z.string(),
  key: z.string(),
  period: z.string().nullable(), // today | yesterday | last7 | mtd for period rows
  fresh_orders: num, // distinct orderID of eligible Fresh orders
  fresh_app: num,
  fresh_web: num,
  customers: num, // distinct Fresh userID within this row's group and range — never sum across rows
  revenue: num,
  placed_orders: num, // eligible + cancelled (base for the cancellation rate)
  cancelled_orders: num,
  delivered_orders: num,
  rto_orders: num,
  group_size: numOrNull, // pincodes merged into a pincode-level row
});
export type RegionalRow = z.infer<typeof RegionalRow>;

/** First-ever eligible Fresh order per pincode / area (lib/geo/aggregate.ts -> aggregateNewMarkets). Counts only. */
export const RegionalNewRow = z.object({
  level: z.enum(["daily", "range", "area"]),
  group: z.string(), // tier
  key: z.string(), // date | "range" | area label
  first_date: isoDate.nullable(),
  new_pins: num,
  new_areas: num,
  orders: num,
  active_pins: numOrNull,
  active_areas: numOrNull,
  ever_pins: numOrNull,
});
export type RegionalNewRow = z.infer<typeof RegionalNewRow>;

// ---------- Freshness ----------
export const SourceFreshnessRow = z.object({
  source: z.string(),
  latest_data_date: isoDate.nullable(),
  last_loaded_at: ts,
});
export type SourceFreshnessRow = z.infer<typeof SourceFreshnessRow>;

// ---------- Daily Growth War Room (lib/sql/war_room.sql) ----------
/** One intraday pacing value: metric × segment × IST day, counted to the cut-off time (so_far) and for the full day. */
export const WarRoomRow = z.object({
  metric: z.string(),
  segment: z.string(), // all | APP | WEB | region tier | mmr | campaign:<id> | adset:<id> | ad:<id> | task type | outcome | hour
  day: isoDate,
  label: z.string().nullable(), // campaign / ad set / ad names, or an adwatch signal message
  so_far: num,
  full: numOrNull, // null for today (day in progress) and snapshot rows
});
export type WarRoomRow = z.infer<typeof WarRoomRow>;

/** One IST day counted only to the current minute (meta_same_time.sql): Now / Yesterday / Last 7 days / MTD on Meta Ads. */
export const MetaSameTimeRow = z.object({
  day: isoDate,
  /** Minute of day today's Meta figures run to (last adwatch pull); earlier days' Meta figures are scaled to it. */
  meta_minute: num,
  spend: num,
  impressions: num,
  clicks: num,
  link_clicks: num,
  installs: num,
  video_3s: num,
  new_sales: num,
  new_sales_app: num,
  fresh_customers: num,
  fresh_leads: num,
});
export type MetaSameTimeRow = z.infer<typeof MetaSameTimeRow>;

/** Registry consumed by the PII guard test. Add every schema here. */
// ---------- Change log (crm.change_log) ----------
/** A logged change / experiment. owner and created_by are team members, not customers. */
export const ChangeLogRow = z.object({
  id: num,
  title: z.string(),
  type: z.string().nullable(),
  owner: z.string().nullable(),
  created_by: z.string().nullable(),
  hypothesis: z.string().nullable(),
  scope: z.string().nullable(), // jsonb as text
  start_date: isoDate,
  review_date: isoDate.nullable(),
  status: z.string().nullable(),
  primary_metric: z.string().nullable(),
  target_value: numOrNull,
  target_dir: z.string().nullable(),
  verdict: z.string().nullable(),
  decision: z.string().nullable(),
  closed_at: ts,
});
export type ChangeLogRow = z.infer<typeof ChangeLogRow>;

/** Meta campaign-day reach (not additive across campaigns or days). */
export const CampaignReachRow = z.object({
  date: isoDate,
  campaign_id: z.string(),
  reach: num,
});
export type CampaignReachRow = z.infer<typeof CampaignReachRow>;

export const ALL_ROW_SCHEMAS = {
  OrdersDailyRow,
  OrdersUniqueCustomersRow,
  OrdersPaymentMixRow,
  AovFreshRow,
  MetaAdDailyRow,
  MetaAccountDailyRow,
  MetaAdHistoryRow,
  MetaAfRow,
  MetaSpendCheckRow,
  AfEventsDailyRow,
  AfAdDailyRow,
  AfCampaignDailyRow,
  AfFunnelRow,
  AfFunnelWindowRow,
  AppFunnelDailyRow,
  CartLeadDailyRow,
  CartLeadLifecycleDailyRow,
  RegionalRow,
  RegionalNewRow,
  SourceFreshnessRow,
  WarRoomRow,
  MetaSameTimeRow,
  ChangeLogRow,
  CampaignReachRow,
} as const;
