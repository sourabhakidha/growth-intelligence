// Pure reshaping helpers for charts and tables (date-keyed rows). No I/O.
import type { MetaAccountDailyRow, MetaAdDailyRow, OrdersDailyRow } from "../types/schemas";

export type Row = Record<string, string | number | null>;

/** Every IST date in [from, to] so charts show gaps as gaps, not as missing x positions. */
export function dateSpine(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < 1000) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Fresh orders per day split by channel (APP / WEB). Days with no row get 0 only if the source returned data for the range. */
export function freshByChannelDaily(rows: readonly OrdersDailyRow[], from: string, to: string): Row[] {
  const map = new Map<string, { APP: number; WEB: number; revenue: number; completed_revenue: number }>();
  for (const r of rows) {
    if (r.order_type !== "Fresh") continue;
    const cur = map.get(r.order_date) ?? { APP: 0, WEB: 0, revenue: 0, completed_revenue: 0 };
    cur[r.channel] += r.orders;
    cur.revenue += r.revenue;
    cur.completed_revenue += r.completed_revenue;
    map.set(r.order_date, cur);
  }
  return dateSpine(from, to).map((date) => {
    const v = map.get(date) ?? { APP: 0, WEB: 0, revenue: 0, completed_revenue: 0 };
    const total = v.APP + v.WEB;
    return {
      date,
      app: v.APP,
      web: v.WEB,
      fresh_total: total,
      fresh_revenue: v.revenue,
      completed_fresh_revenue: v.completed_revenue,
      aov: total ? v.revenue / total : null,
    };
  });
}

export function metaDaily(rows: readonly MetaAccountDailyRow[], from: string, to: string): Row[] {
  const map = new Map(rows.map((r) => [r.date, r]));
  return dateSpine(from, to).map((date) => {
    const r = map.get(date);
    return {
      date,
      spend: r ? r.spend : null,
      impressions: r ? r.impressions : null,
      link_clicks: r ? r.link_clicks : null,
      installs: r ? r.installs : null,
      cpi: r && r.installs ? r.spend / r.installs : null,
    };
  });
}

export interface EntityRollup {
  id: string;
  name: string;
  parent: string;
  ads: number;
  first_date: string;
  last_date: string;
  spend: number;
  impressions: number;
  link_clicks: number;
  installs: number;
}

/** Roll ad × day rows up to campaign, ad set, ad or ad-name (creative concept proxy) level. */
export function rollupAds(rows: readonly MetaAdDailyRow[], level: "campaign" | "adset" | "ad" | "ad_name"): EntityRollup[] {
  const map = new Map<string, EntityRollup & { _ads: Set<string> }>();
  for (const r of rows) {
    const id =
      level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : level === "ad" ? r.ad_id : (r.ad_name ?? r.ad_id);
    const name =
      level === "campaign" ? r.campaign_name ?? r.campaign_id : level === "adset" ? r.adset_name ?? r.adset_id : r.ad_name ?? r.ad_id;
    const parent = level === "adset" ? r.campaign_name ?? "" : level === "ad" ? r.adset_name ?? "" : "";
    const cur =
      map.get(id) ??
      { id, name, parent, ads: 0, first_date: r.date, last_date: r.date, spend: 0, impressions: 0, link_clicks: 0, installs: 0, _ads: new Set<string>() };
    cur._ads.add(r.ad_id);
    if (r.date < cur.first_date) cur.first_date = r.date;
    if (r.date > cur.last_date) cur.last_date = r.date;
    cur.spend += r.spend;
    cur.impressions += r.impressions;
    cur.link_clicks += r.link_clicks;
    cur.installs += r.installs;
    map.set(id, cur);
  }
  return [...map.values()]
    .map(({ _ads, ...rest }) => ({ ...rest, ads: _ads.size }))
    .sort((a, b) => b.spend - a.spend);
}

export function withRates(e: EntityRollup): Row {
  return {
    id: e.id,
    name: e.name,
    parent: e.parent,
    ads: e.ads,
    first_date: e.first_date,
    spend: e.spend,
    impressions: e.impressions,
    link_clicks: e.link_clicks,
    ctr: e.impressions ? e.link_clicks / e.impressions : null,
    cpc: e.link_clicks ? e.spend / e.link_clicks : null,
    cpm: e.impressions ? (e.spend / e.impressions) * 1000 : null,
    installs: e.installs,
    cpi: e.installs ? e.spend / e.installs : null,
  };
}
