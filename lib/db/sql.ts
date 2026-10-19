// Every reporting definition lives in lib/sql/*.sql (version-controlled, reviewed) and is implemented over
// Supabase REST in lib/db/queries.ts. Only names in this list can run, so no request input can choose a query.
export const SQL_FILES = [
  "orders_daily",
  "orders_unique_customers",
  "orders_payment_mix",
  "aov_fresh",
  "meta_ad_daily",
  "meta_account_daily",
  "meta_spend_check",
  "meta_ad_history",
  "meta_af",
  "af_events_daily",
  "af_ad_daily",
  "af_campaign_daily",
  "af_funnel",
  "af_funnel_windows",
  "app_funnel_daily",
  "cart_leads_daily",
  "cart_lead_lifecycle_daily",
  "regional_fresh",
  "regional_periods",
  "regional_new_markets",
  "source_freshness",
  "war_room",
  "meta_same_time",
  "change_log",
  "meta_campaign_reach",
] as const;

export type SqlName = (typeof SQL_FILES)[number];
