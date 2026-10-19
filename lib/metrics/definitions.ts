// Single registry of metric definitions. Every KPI card and tooltip reads from here, so a metric means the
// same thing on every screen. Pure data — no imports.

export type MetricFormat = "inr" | "inr_precise" | "count" | "pct" | "minutes" | "years";

export type MetricStatus = "reliable" | "provisional" | "unavailable";

export interface MetricDef {
  id: string;
  label: string;
  format: MetricFormat;
  formula: string;
  numerator?: string;
  denominator?: string;
  grain: string;
  window: string;
  source: string;
  status: MetricStatus;
  note?: string;
  /** true when a higher value is good (drives delta colouring). */
  higherIsBetter: boolean;
}

const NEW_SALES_EXCLUSIONS = "PRESCRIPTION_UPLOADED, DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT";
const SELECTED = "Selected IST date range";

function m(def: MetricDef): MetricDef {
  return def;
}

export const METRICS = {
  spend: m({
    id: "spend", label: "Meta spend", format: "inr", formula: "Σ spend",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: false,
  }),
  impressions: m({
    id: "impressions", label: "Impressions", format: "count", formula: "Σ impressions",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: true,
  }),
  clicks: m({
    id: "clicks", label: "Clicks (all)", format: "count", formula: "Σ clicks",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: true,
    note: "All clicks. Link clicks are shown separately.",
  }),
  link_clicks: m({
    id: "link_clicks", label: "Link clicks", format: "count", formula: "Σ link_clicks",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: true,
  }),
  installs_meta: m({
    id: "installs_meta", label: "Installs (Meta)", format: "count", formula: "Σ installs (Meta-reported mobile_app_install)",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: true,
    note: "Meta's own attribution. AppsFlyer non-organic installs and GA4 first_open are separate definitions.",
  }),
  cpm: m({
    id: "cpm", label: "CPM", format: "inr_precise", formula: "spend ÷ impressions × 1,000",
    numerator: "Meta spend", denominator: "Impressions ÷ 1,000",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: false,
  }),
  ctr: m({
    id: "ctr", label: "CTR (link)", format: "pct", formula: "link clicks ÷ impressions",
    numerator: "Link clicks", denominator: "Impressions",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: true,
  }),
  cpc: m({
    id: "cpc", label: "CPC (link)", format: "inr_precise", formula: "spend ÷ link clicks",
    numerator: "Meta spend", denominator: "Link clicks",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: false,
  }),
  cpi: m({
    id: "cpi", label: "CPI", format: "inr_precise", formula: "spend ÷ installs (Meta)",
    numerator: "Meta spend", denominator: "Installs (Meta)",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "reliable", higherIsBetter: false,
  }),
  fresh_orders: m({
    id: "fresh_orders", label: "Fresh orders", format: "count", formula: "count of orders with Order_Type = Fresh",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
    note: `Excludes ${NEW_SALES_EXCLUSIONS}. No other status is excluded.`,
  }),
  fresh_app: m({
    id: "fresh_app", label: "Fresh APP orders", format: "count", formula: "Fresh orders, orderPlatform = APP",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
    note: "Self-serve.",
  }),
  fresh_web: m({
    id: "fresh_web", label: "Fresh WEB orders", format: "count", formula: "Fresh orders, orderPlatform = WEB",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
    note: "Sales-assisted orders within the app business — not website-acquired customers. Not all follow an abandoned-cart lead.",
  }),
  unique_new_customers: m({
    id: "unique_new_customers", label: "Unique Fresh customers", format: "count",
    formula: "distinct userID across eligible Fresh orders in the range",
    grain: "customer", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
    note: "De-duplicated across days and channels. Not equal to Fresh orders.",
  }),
  fresh_revenue: m({
    id: "fresh_revenue", label: "Fresh-order revenue", format: "inr", formula: "Σ finalAmount of Fresh orders",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
    note: "Includes orders not yet completed.",
  }),
  completed_fresh_revenue: m({
    id: "completed_fresh_revenue", label: "Completed Fresh revenue", format: "inr",
    formula: "Σ finalAmount of Fresh orders with status = COMPLETED",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
    note: "Recent days rise as orders complete.",
  }),
  aov_fresh: m({
    id: "aov_fresh", label: "AOV (Fresh)", format: "inr", formula: "Eligible Fresh-order revenue ÷ unique eligible Fresh orders",
    numerator: "Fresh-order revenue", denominator: "Fresh orders",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
  }),
  cac_fresh_order: m({
    id: "cac_fresh_order", label: "CAC per Fresh order", format: "inr",
    formula: "Meta spend ÷ eligible Fresh orders (APP + WEB)",
    numerator: "Meta spend — all campaigns in the Meta ad account (adwatch.meta_ad_daily)",
    denominator: "Unique eligible Fresh orders, APP + WEB, excluding PRESCRIPTION_UPLOADED, DELIVERY_CANCELED, THREE_PL_CANCELLED_ACKNOWLEDGEMENT",
    grain: "range", window: SELECTED, source: "adwatch.meta_ad_daily + Order_Level_V4", status: "reliable", higherIsBetter: false,
    note: "Order-based, not customer-based. Spend scope (all campaigns vs app campaigns) to be confirmed.",
  }),
  cost_per_new_customer: m({
    id: "cost_per_new_customer", label: "CAC per Fresh customer", format: "inr",
    formula: "Meta spend ÷ distinct Fresh customers (APP + WEB)",
    numerator: "Meta spend — all campaigns in the Meta ad account",
    denominator: "Distinct userIDs with an eligible Fresh order (de-duplicated across APP and WEB, never summed)",
    note: "Customer-based CAC. A customer with two Fresh orders counts once here, so this is ≥ CAC per Fresh order.",
    grain: "range", window: SELECTED, source: "adwatch.meta_ad_daily + Order_Level_V4", status: "reliable", higherIsBetter: false,
  }),
  cart_leads: m({
    id: "cart_leads", label: "Abandoned-cart leads", format: "count",
    formula: "crm.leads (cart), excl. #r re-runs and duplicate_merged; 1 per phone per IST day",
    grain: "phone × IST day", window: SELECTED, source: "crm.leads (written crm_025a rule)", status: "reliable", higherIsBetter: true,
    note: "Differs from CRM screens that use the live crm.cart_leads_std() (changed by crm_027b).",
  }),
  cart_leads_fresh: m({
    id: "cart_leads_fresh", label: "Cart leads — Fresh", format: "count",
    formula: "cart leads whose phone has no COMPLETED order before the lead time",
    grain: "phone × IST day", window: SELECTED, source: "crm.leads + Order_Level_V4", status: "reliable", higherIsBetter: true,
  }),
  cart_leads_repeat: m({
    id: "cart_leads_repeat", label: "Cart leads — Repeat", format: "count",
    formula: "cart leads whose phone has a COMPLETED order before the lead time",
    grain: "phone × IST day", window: SELECTED, source: "crm.leads + Order_Level_V4", status: "reliable", higherIsBetter: true,
  }),
  cart_to_lead_minutes: m({
    id: "cart_to_lead_minutes", label: "Cart → lead (median)", format: "minutes",
    formula: "median(lead created_at − cart_ts)",
    grain: "lead", window: SELECTED, source: "crm.leads + crm.cart_ledger", status: "reliable", higherIsBetter: false,
    note: "The CRM hold is 30 minutes by configuration.",
  }),
  recovered_orders: m({
    id: "recovered_orders", label: "Recovered orders", format: "count",
    formula: "task's won order placed at/after the lead time",
    grain: "lead", window: SELECTED, source: "crm.tasks + Order_Level_V4", status: "provisional", higherIsBetter: true,
    note: "Task-level signal. Includes self-serve APP orders. Attribution rule not yet agreed.",
  }),
  ga4_installs: m({
    id: "ga4_installs", label: "First opens (GA4)", format: "count", formula: "Σ first_open users",
    grain: "day × platform", window: SELECTED, source: "bigquery_data.app_funnel_daily", status: "reliable", higherIsBetter: true,
    note: "All users including organic. ~2-day lag.",
  }),
  ga4_search_users: m({
    id: "ga4_search_users", label: "Users searching", format: "count", formula: "Σ daily distinct users who searched",
    grain: "day × platform", window: SELECTED, source: "bigquery_data.app_funnel_daily", status: "reliable", higherIsBetter: true,
    note: "Summed across days, so a user active on two days counts twice.",
  }),
  ga4_atc_users: m({
    id: "ga4_atc_users", label: "Users adding to cart", format: "count", formula: "Σ daily distinct users with add_to_cart",
    grain: "day × platform", window: SELECTED, source: "bigquery_data.app_funnel_daily", status: "reliable", higherIsBetter: true,
    note: "Summed across days, so a user active on two days counts twice.",
  }),
  ga4_purchase_users: m({
    id: "ga4_purchase_users", label: "Users purchasing (GA4)", format: "count", formula: "Σ daily distinct users with purchase",
    grain: "day × platform", window: SELECTED, source: "bigquery_data.app_funnel_daily", status: "reliable", higherIsBetter: true,
  }),
  install_to_cart_sameday: m({
    id: "install_to_cart_sameday", label: "Install → cart (same-day ratio)", format: "pct",
    formula: "users adding to cart ÷ first opens, same days",
    numerator: "Users adding to cart (GA4)", denominator: "First opens (GA4)",
    grain: "day", window: SELECTED, source: "bigquery_data.app_funnel_daily", status: "provisional", higherIsBetter: true,
    note: "Operational ratio: numerator and denominator are different populations. Cohort conversion is Phase 2B.",
  }),
  meta_purchase_roas: m({
    id: "meta_purchase_roas", label: "Meta purchase ROAS", format: "pct", formula: "n/a",
    grain: "—", window: "—", source: "adwatch.meta_ad_daily", status: "unavailable", higherIsBetter: true,
    note: "Meta receives no purchase events, so this cannot be calculated.",
  }),
  creative_cac: m({
    id: "creative_cac", label: "Cost per Fresh order by creative", format: "inr", formula: "n/a",
    grain: "—", window: "—", source: "—", status: "unavailable", higherIsBetter: false,
    note: "User-level Meta attribution is restricted. Only AppsFlyer-attributed purchasers by ad name are available.",
  }),
  af_purchasers: m({
    id: "af_purchasers", label: "AppsFlyer purchasers", format: "count", formula: "Σ purchasers by ad name",
    grain: "ad name × day", window: SELECTED, source: "adwatch.af_ad_daily", status: "provisional", higherIsBetter: true,
    note: "AppsFlyer-attributed. Not Fresh orders and not unique customers.",
  }),
  avg_patient_age: m({
    id: "avg_patient_age", label: "Avg patient age", format: "years", formula: "mean(patient_Age), ages 1–110",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
  }),
  priority_mumbai_share: m({
    id: "priority_mumbai_share", label: "Priority Mumbai share", format: "pct",
    formula: "Fresh orders in the priority Mumbai pincodes ÷ eligible Fresh orders",
    numerator: "Fresh orders, pinCode in the priority list", denominator: "Eligible Fresh orders",
    grain: "order", window: SELECTED, source: 'Order_Level_V4."pinCode" + lib/geo/regions.ts', status: "reliable", higherIsBetter: true,
    note: "Priority pincodes are a distinct group: they are not counted again in Tier 1.",
  }),
  aov_high_share: m({
    id: "aov_high_share", label: "Fresh orders at ₹600+", format: "pct",
    formula: "Eligible Fresh orders with finalAmount ≥ ₹600 ÷ eligible Fresh orders",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: true,
  }),
  aov_low_share: m({
    id: "aov_low_share", label: "Fresh orders under ₹200", format: "pct",
    formula: "Eligible Fresh orders with finalAmount < ₹200 ÷ eligible Fresh orders",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4"', status: "reliable", higherIsBetter: false,
  }),
  priority_app_share: m({
    id: "priority_app_share", label: "Priority Mumbai share of APP orders", format: "pct",
    formula: "APP Fresh orders in the priority Mumbai pincodes ÷ all APP Fresh orders",
    numerator: "APP Fresh orders, pinCode in the priority list", denominator: "APP Fresh orders",
    grain: "order", window: SELECTED, source: 'Order_Level_V4."pinCode" + lib/geo/regions.ts', status: "reliable", higherIsBetter: true,
    note: "APP (self-serve) orders are the ones Meta spend drives; WEB orders are sales-assisted.",
  }),
  tier3_share: m({
    id: "tier3_share", label: "Tier 3 share", format: "pct",
    formula: "Fresh orders in Tier 3 ÷ eligible Fresh orders",
    numerator: "Fresh orders resolved to Tier 3", denominator: "Eligible Fresh orders",
    grain: "order", window: SELECTED, source: 'Order_Level_V4."pinCode" + lib/geo/regions.ts', status: "reliable", higherIsBetter: false,
  }),
  mumbai_spend_share: m({
    id: "mumbai_spend_share", label: "Mumbai-targeted spend share", format: "pct",
    formula: "Meta spend in ad sets whose name targets Mumbai (Mum / Mumbai) ÷ all Meta spend",
    numerator: "Spend, ad set or campaign name contains Mum / Mumbai", denominator: "All Meta spend",
    grain: "ad × day", window: SELECTED, source: "adwatch.meta_ad_daily", status: "provisional", higherIsBetter: true,
    note: "Read from ad set names: the intended audience, not where the ads actually delivered. Meta does not report spend by pincode.",
  }),
  tier3_new_pins_per_day: m({
    id: "tier3_new_pins_per_day", label: "New Tier 3 pincodes / day", format: "count",
    formula: "Tier 3 pincodes with their first-ever eligible Fresh order in the range ÷ days in the range",
    grain: "pincode", window: SELECTED, source: "Order_Level_V4 (full history from 25 Oct 2025)", status: "reliable", higherIsBetter: false,
    note: "New areas = 3-digit postal districts with their first-ever order; most Tier 3 districts have already ordered, so new pincodes show the spread better.",
  }),
  rto_rate: m({
    id: "rto_rate", label: "RTO rate", format: "pct",
    formula: "RTO ÷ (delivered + RTO), eligible Fresh orders",
    numerator: "Eligible Fresh orders in RTO_INITIATED, RTO_IN_TRANSIT, RTO_DELIVERED or RETURN_TO_ORIGIN",
    denominator: "Eligible Fresh orders delivered (COMPLETED) or in RTO",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4".status', status: "reliable", higherIsBetter: false,
    note: "Orders still in transit are left out until they resolve, so recent days settle over time.",
  }),
  cancellation_rate: m({
    id: "cancellation_rate", label: "Cancellation rate", format: "pct",
    formula: "cancelled ÷ placed Fresh orders",
    numerator: "Fresh orders in DELIVERY_CANCELED or THREE_PL_CANCELLED_ACKNOWLEDGEMENT",
    denominator: "Fresh APP/WEB orders placed (all statuses except PRESCRIPTION_UPLOADED)",
    grain: "order", window: SELECTED, source: 'public."Order_Level_V4".status', status: "reliable", higherIsBetter: false,
    note: "Uses the placed-order base because both cancelled statuses are excluded from New Sales. DR_REJECTED and FAILED are not cancellations.",
  }),
  mumbai_share: m({
    id: "mumbai_share", label: "Mumbai share", format: "pct",
    formula: "Fresh orders in Priority Mumbai pincodes + the rest of MMR ÷ eligible Fresh orders",
    grain: "order", window: SELECTED, source: 'Order_Level_V4."pinCode" + lib/geo/regions.ts', status: "reliable", higherIsBetter: true,
  }),
} satisfies Record<string, MetricDef>;

export type MetricId = keyof typeof METRICS;
