// Audited source metadata (Phase 1 audit, 17 Oct 2026). Pure data — safe to render on any page.
import type { SourceId } from "@/lib/types/result";

export interface SourceInfo {
  id: SourceId;
  label: string;
  relation: string;
  grain: string;
  coverageFrom: string | null;
  refresh: string;
  caveats: string[];
}

export const SOURCES: Record<SourceId, SourceInfo> = {
  orders: {
    id: "orders",
    label: "Orders",
    relation: 'public."Order_Level_V4"',
    grain: "1 row per order (orderID)",
    coverageFrom: "2025-10-24",
    refresh: "Every 15 min (sync-order-level-v3)",
    caveats: [
      "orderDate is IST wall-clock time.",
      "Internal_Team = true means agent-placed (sales-assisted), not test orders.",
      "29 orders are labelled Repeat without an earlier COMPLETED order (data-quality flag).",
    ],
  },
  meta_ad_daily: {
    id: "meta_ad_daily",
    label: "Meta ads (ad × day)",
    relation: "adwatch.meta_ad_daily",
    grain: "date × ad_id",
    coverageFrom: "2026-09-12",
    refresh: "Hourly (adwatch-collect)",
    caveats: [
      "No purchase or add-to-cart events reach Meta, so Meta-reported purchase ROAS is unavailable.",
      "Ad-level history before 12 Sep is in the stale Meta_AdSpent schema and is not merged.",
    ],
  },
  meta_campaign_check: {
    id: "meta_campaign_check",
    label: "Meta campaign cross-check",
    relation: "marketing_meta.meta_campaign_performance_daily",
    grain: "date × campaign",
    coverageFrom: "2026-06-18",
    refresh: "Daily (ba-adwatch-meta-sync)",
    caveats: ["Matches adwatch to the rupee on settled days; recent days differ slightly due to Meta restatement."],
  },
  af_events: {
    id: "af_events",
    label: "AppsFlyer events (paid users)",
    relation: "public.af_events_rt",
    grain: "1 row per event",
    coverageFrom: "2026-10-06",
    refresh: "Installs hourly, in-app events every 30 min",
    caveats: [
      "Non-organic only — organic ingest is switched off.",
      "Meta installs appear as media_source 'restricted': no campaign/ad breakdown at user level.",
    ],
  },
  af_ad_daily: {
    id: "af_ad_daily",
    label: "AppsFlyer by ad name",
    relation: "adwatch.af_ad_daily",
    grain: "date × campaign × adset × ad name",
    coverageFrom: "2026-10-05",
    refresh: "Hourly (adwatch-af)",
    caveats: ["Joins to Meta by ad name, not ad_id.", "Purchasers are AppsFlyer-attributed, not Fresh orders."],
  },
  ga4_app_funnel: {
    id: "ga4_app_funnel",
    label: "App funnel (GA4, all users)",
    relation: "bigquery_data.app_funnel_daily",
    grain: "day × platform, distinct users per step",
    coverageFrom: "2026-08-03",
    refresh: "Daily, ~2-day lag",
    caveats: ["Same-day distinct users per step — not a cohort conversion."],
  },
  crm_cart_leads: {
    id: "crm_cart_leads",
    label: "Abandoned-cart leads",
    relation: "crm.leads (written crm_025a rule)",
    grain: "1 lead per phone per IST date",
    coverageFrom: "2026-09-26",
    refresh: "Every minute (crm-tick)",
    caveats: [
      "Uses the agreed 14 Oct definition, not the live crm.cart_leads_std() changed by crm_027b.",
      "Counts will differ from CRM screens that read the live function.",
    ],
  },
  crm_lifecycle: {
    id: "crm_lifecycle",
    label: "Sales CRM lifecycle",
    relation: "crm.leads → crm.tasks → crm.calls_* / crm.events_*",
    grain: "lead / task / call",
    coverageFrom: "2026-09-26",
    refresh: "Every minute",
    caveats: [
      "Leads and tasks are keyed by phone, not userID.",
      "CRM 'won' includes self-serve APP orders — recovery attribution rule still to be agreed.",
    ],
  },
  regions: {
    id: "regions",
    label: "Regional hierarchy (pincode)",
    relation: 'Order_Level_V4."pinCode" → lib/geo/regions.ts',
    grain: "order → tier → area",
    coverageFrom: "2025-10-24",
    refresh: "Every 15 min (with orders); mapping is version-controlled",
    caveats: [
      "Groups are exclusive, first match wins: Priority Mumbai pincodes → Tier 1 → Delhi NCR → Tier 2 → Tier 3.",
      "Tier 1 = rest of MMR (incl. Mira-Bhayandar), Pune & Pimpri-Chinchwad, Kolkata & Howrah, Hyderabad & Secunderabad, Ahmedabad, Chennai, Bangalore, Surat.",
      "Tier 2 = established Tier 2 cities (Government of India Y-class list, plus Satara), e.g. Bhopal, Indore, Kolhapur, Sangli, Satara, Visakhapatnam, Lucknow, Chandigarh.",
      "Tier 3 = every other valid pincode. Orders without a valid pincode are 'location not verified', never Tier 3.",
      "Surat (high RTO) and Visakhapatnam are flagged whenever they get orders.",
    ],
  },
  crm_change_log: {
    id: "crm_change_log",
    label: "Change log",
    relation: "crm.change_log",
    grain: "1 row per logged change / experiment",
    coverageFrom: "2026-10-07",
    refresh: "When someone logs or updates a change",
    caveats: [
      "Who, intent and expected outcome exist only for changes someone logged. Meta's own activity log stopped loading on 7 Jul 2026, so Meta edits are otherwise detected from delivery data.",
      "CRM changes (lead routing, dialer, WhatsApp flows) are logged here too; they move leads and New Sales and are flagged as concurrent changes.",
    ],
  },

};
