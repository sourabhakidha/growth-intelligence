// Pure aggregation helpers: turn validated query rows into KPI values. No I/O, no imports beyond types,
// so they can be unit-tested and reused by every page. All ratios use safeDiv (null, never Infinity).

import type {
  AppFunnelDailyRow,
  CartLeadDailyRow,
  MetaAccountDailyRow,
  OrdersDailyRow,
  OrdersUniqueCustomersRow,
  RegionDailyRow,
} from "../types/schemas";

function div(n: number, d: number): number | null {
  return d === 0 ? null : n / d;
}

export interface MetaTotals {
  spend: number;
  impressions: number;
  clicks: number;
  link_clicks: number;
  installs: number;
  cpm: number | null;
  ctr: number | null;
  cpc: number | null;
  cpi: number | null;
}

export function summarizeMeta(rows: readonly MetaAccountDailyRow[]): MetaTotals {
  const t = rows.reduce(
    (a, r) => ({
      spend: a.spend + r.spend,
      impressions: a.impressions + r.impressions,
      clicks: a.clicks + r.clicks,
      link_clicks: a.link_clicks + r.link_clicks,
      installs: a.installs + r.installs,
    }),
    { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, installs: 0 },
  );
  return {
    ...t,
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : null,
    ctr: div(t.link_clicks, t.impressions),
    cpc: div(t.spend, t.link_clicks),
    cpi: div(t.spend, t.installs),
  };
}

export interface FreshTotals {
  fresh_orders: number;
  fresh_app: number;
  fresh_web_agent: number;
  fresh_web_other: number;
  fresh_revenue: number;
  completed_fresh_orders: number;
  completed_fresh_revenue: number;
  aov_fresh: number | null;
}

export function summarizeFresh(rows: readonly OrdersDailyRow[]): FreshTotals {
  const f = rows.filter((r) => r.order_type === "Fresh");
  const sum = (pred: (r: OrdersDailyRow) => boolean, k: "orders" | "revenue" | "completed_orders" | "completed_revenue") =>
    f.filter(pred).reduce((a, r) => a + r[k], 0);
  const all = () => true;
  const fresh_orders = sum(all, "orders");
  const fresh_revenue = sum(all, "revenue");
  return {
    fresh_orders,
    fresh_app: sum((r) => r.channel === "APP", "orders"),
    fresh_web_agent: sum((r) => r.channel === "WEB_AGENT", "orders"),
    fresh_web_other: sum((r) => r.channel === "WEB_OTHER", "orders"),
    fresh_revenue,
    completed_fresh_orders: sum(all, "completed_orders"),
    completed_fresh_revenue: sum(all, "completed_revenue"),
    aov_fresh: div(fresh_revenue, fresh_orders),
  };
}

/** Range-level unique Fresh customers. Uses the de-duplicated query, never a sum of daily rows. */
export function uniqueFreshCustomers(rows: readonly OrdersUniqueCustomersRow[]): number | null {
  return rows.find((r) => r.order_type === "Fresh")?.unique_customers_all ?? null;
}

export interface Acquisition {
  cac_fresh_order: number | null;
  cost_per_new_customer: number | null;
}

export function acquisitionCosts(spend: number | null, freshOrders: number | null, uniqueNew: number | null): Acquisition {
  return {
    cac_fresh_order: spend === null || freshOrders === null ? null : div(spend, freshOrders),
    cost_per_new_customer: spend === null || uniqueNew === null ? null : div(spend, uniqueNew),
  };
}

export interface FunnelTotals {
  first_open: number;
  searched: number;
  viewed_item: number;
  added_to_cart: number;
  began_checkout: number;
  purchased: number;
}

/** Sums daily distinct users across days and platforms — an event-volume view, not a cohort. */
export function summarizeFunnel(rows: readonly AppFunnelDailyRow[]): FunnelTotals {
  return rows.reduce(
    (a, r) => ({
      first_open: a.first_open + r.first_open,
      searched: a.searched + r.searched,
      viewed_item: a.viewed_item + r.viewed_item,
      added_to_cart: a.added_to_cart + r.added_to_cart,
      began_checkout: a.began_checkout + r.began_checkout,
      purchased: a.purchased + r.purchased,
    }),
    { first_open: 0, searched: 0, viewed_item: 0, added_to_cart: 0, began_checkout: 0, purchased: 0 },
  );
}

export function summarizeCartLeads(rows: readonly CartLeadDailyRow[]) {
  return rows.reduce(
    (a, r) => ({ total: a.total + r.total_cart_leads, fresh: a.fresh + r.fresh, repeat: a.repeat + r.repeat }),
    { total: 0, fresh: 0, repeat: 0 },
  );
}

export interface RegionSummary {
  region: string;
  fresh_orders: number;
  fresh_app: number;
  fresh_web_agent: number;
  fresh_web_other: number;
  fresh_revenue: number;
  aov: number | null;
  order_share: number | null;
  revenue_share: number | null;
}

/** Region totals that always reconcile to total Fresh orders (Unmapped is a region row). */
export function summarizeRegions(rows: readonly RegionDailyRow[]): RegionSummary[] {
  const by = new Map<string, Omit<RegionSummary, "aov" | "order_share" | "revenue_share">>();
  for (const r of rows) {
    const cur = by.get(r.region) ?? {
      region: r.region, fresh_orders: 0, fresh_app: 0, fresh_web_agent: 0, fresh_web_other: 0, fresh_revenue: 0,
    };
    cur.fresh_orders += r.fresh_orders;
    cur.fresh_revenue += r.fresh_revenue;
    if (r.channel === "APP") cur.fresh_app += r.fresh_orders;
    else if (r.channel === "WEB_AGENT") cur.fresh_web_agent += r.fresh_orders;
    else cur.fresh_web_other += r.fresh_orders;
    by.set(r.region, cur);
  }
  const totalOrders = [...by.values()].reduce((a, r) => a + r.fresh_orders, 0);
  const totalRev = [...by.values()].reduce((a, r) => a + r.fresh_revenue, 0);
  return [...by.values()]
    .map((r) => ({
      ...r,
      aov: div(r.fresh_revenue, r.fresh_orders),
      order_share: div(r.fresh_orders, totalOrders),
      revenue_share: div(r.fresh_revenue, totalRev),
    }))
    .sort((a, b) => b.fresh_orders - a.fresh_orders);
}
