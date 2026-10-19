import "server-only";

import { cache } from "react";

import {
  addDaysIso,
  byKeys,
  channelOf,
  countDistinct,
  firstLeadPerPhonePerDay,
  groupBy,
  isCountableCartLead,
  istDateOfInstant,
  istDayStart,
  istWallClockToEpoch,
  median,
  money,
  pgTrim,
  round1,
  sumOrNull,
  toNum,
  wallClockDate,
} from "./aggregate";
import { periodSpecs } from "@/lib/format/periods";
import { CANCELLED_STATUSES, NEW_SALES_EXCLUDED_STATUSES, aggregateNewMarkets, aggregatePeriods, aggregateRegional, type GeoOrder } from "@/lib/geo/aggregate";
import { resolveLocation } from "@/lib/geo/regions";
import { bracketOf } from "@/lib/metrics/aov";
import { AF_FIRST_FULL_DAY } from "@/lib/metrics/metaIntel";
import type { SqlName } from "./sql";
import { maxOf, selectAll, selectIn, type Filter } from "./supabase";

// TypeScript implementations of the reporting definitions in lib/sql/*.sql, run over Supabase REST reads.
// The .sql files remain the written, reviewed definition of each figure; every function below reproduces its
// file's filters, grain and output columns. Raw rows (which may include phone or user IDs for matching) stay
// inside this module — only the aggregated output leaves, and lib/db/readonly.ts validates it with zod.

export type QueryParams = readonly (string | number | null)[];
type Row = Record<string, unknown>;
type Query = (params: QueryParams) => Promise<Row[]>;

const NEW_SALES_EXCLUSIONS = "(PRESCRIPTION_UPLOADED,DELIVERY_CANCELED,THREE_PL_CANCELLED_ACKNOWLEDGEMENT)";

function range(params: QueryParams): [string, string] {
  const [from, to] = params;
  if (typeof from !== "string" || typeof to !== "string") throw new Error("Expected [from, to] date params");
  return [from, to];
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const n0 = (v: unknown): number => toNum(v) ?? 0;

// ---------- Orders (public."Order_Level_V4") ----------

/** orderDate in [from, to] (IST wall clock), APP/WEB, minus the three agreed new-sales exclusions. */
function newSalesFilter(from: string, to: string, orderTypes: readonly string[]): Filter {
  return (q) =>
    q
      .gte("orderDate", from)
      .lt("orderDate", addDaysIso(to, 1))
      .in("orderPlatform", ["APP", "WEB"])
      .in("Order_Type", orderTypes)
      .not("status", "in", NEW_SALES_EXCLUSIONS);
}

function readOrders(from: string, to: string, orderTypes: readonly string[], columns: string) {
  return selectAll({
    schema: "public",
    table: "Order_Level_V4",
    columns: `orderID,${columns}`,
    orderBy: ["orderID"],
    filter: newSalesFilter(from, to, orderTypes),
  });
}

const ordersDaily: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await readOrders(from, to, ["Fresh", "Repeat"], "orderDate,orderPlatform,Order_Type,userID,finalAmount,status,patient_Age");
  const groups = groupBy(rows, (r) => `${wallClockDate(String(r.orderDate))}|${channelOf(r.orderPlatform)}|${r.Order_Type}`);
  const out: Row[] = [];
  for (const [key, g] of groups) {
    const [order_date, channel, order_type] = key.split("|");
    const completed = g.filter((r) => r.status === "COMPLETED");
    const ages = g.map((r) => toNum(r.patient_Age)).filter((a): a is number => a !== null && a >= 1 && a <= 110);
    out.push({
      order_date,
      channel,
      order_type,
      orders: g.length,
      unique_customers: countDistinct(g.map((r) => r.userID)),
      revenue: money(sumOrNull(g.map((r) => r.finalAmount)) ?? 0),
      completed_orders: completed.length,
      completed_revenue: money(sumOrNull(completed.map((r) => r.finalAmount)) ?? 0),
      avg_patient_age: ages.length ? round1(ages.reduce((a, b) => a + b, 0) / ages.length) : null,
    });
  }
  return out.sort(byKeys((r) => String(r.order_date), (r) => String(r.channel), (r) => String(r.order_type)));
};

const ordersUniqueCustomers: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await readOrders(from, to, ["Fresh", "Repeat"], "orderPlatform,Order_Type,userID");
  const out: Row[] = [];
  for (const [order_type, g] of groupBy(rows, (r) => String(r.Order_Type))) {
    const users = (ch: string) => countDistinct(g.filter((r) => channelOf(r.orderPlatform) === ch).map((r) => r.userID));
    out.push({
      order_type,
      unique_customers_all: countDistinct(g.map((r) => r.userID)),
      unique_customers_app: users("APP"),
      unique_customers_web: users("WEB"),
    });
  }
  return out.sort(byKeys((r) => String(r.order_type)));
};

const ordersPaymentMix: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await readOrders(from, to, ["Fresh"], "orderPlatform,paymentMode,finalAmount");
  const groups = groupBy(rows, (r) => {
    const mode = pgTrim(String(r.paymentMode ?? "")).toUpperCase();
    return `${channelOf(r.orderPlatform)}|${mode || "UNKNOWN"}`;
  });
  const out: Row[] = [];
  for (const [key, g] of groups) {
    const [channel, payment_mode] = key.split("|");
    out.push({ channel, payment_mode, orders: g.length, revenue: money(sumOrNull(g.map((r) => r.finalAmount)) ?? 0) });
  }
  return out.sort(byKeys((r) => String(r.channel), (r) => -Number(r.orders)));
};

/** Eligible Fresh orders by IST date × channel × payment mode × region × AOV bracket (see aov_fresh.sql). */
const aovFresh: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await readOrders(from, to, ["Fresh"], "orderDate,orderPlatform,paymentMode,finalAmount,pinCode,city");
  const groups = new Map<string, { orders: number; revenue: number }>();
  for (const o of new Map(rows.map((r) => [String(r.orderID), r])).values()) {
    const amount = toNum(o.finalAmount);
    const mode = pgTrim(String(o.paymentMode ?? "")).toUpperCase() || "UNKNOWN";
    const key = [wallClockDate(String(o.orderDate)), channelOf(o.orderPlatform), mode, resolveLocation(o.pinCode, o.city).tier, bracketOf(amount)].join("|");
    const g = groups.get(key) ?? { orders: 0, revenue: 0 };
    g.orders++;
    g.revenue += amount ?? 0;
    groups.set(key, g);
  }
  const out: Row[] = [];
  for (const [key, g] of groups) {
    const [order_date, channel, payment_mode, region, bracket] = key.split("|");
    out.push({ order_date, channel, payment_mode, region, bracket, orders: g.orders, revenue: money(g.revenue) });
  }
  return out.sort(byKeys((r) => String(r.order_date), (r) => String(r.channel), (r) => String(r.payment_mode), (r) => String(r.region), (r) => String(r.bracket)));
};

// ---------- Regions (pincode hierarchy, lib/geo) ----------

/** Fresh APP/WEB orders placed in the range: every status except PRESCRIPTION_UPLOADED (see regional_fresh.sql). */
async function readPlacedFresh(from: string, to: string): Promise<GeoOrder[]> {
  const rows = await selectAll({
    schema: "public",
    table: "Order_Level_V4",
    columns: "orderID,orderDate,orderPlatform,userID,finalAmount,pinCode,city,status",
    orderBy: ["orderID"],
    filter: (q) =>
      q
        .gte("orderDate", from)
        .lt("orderDate", addDaysIso(to, 1))
        .in("orderPlatform", ["APP", "WEB"])
        .eq("Order_Type", "Fresh")
        .not("status", "in", "(PRESCRIPTION_UPLOADED)"),
  });
  return rows.map((o) => ({
    orderId: String(o.orderID),
    userId: str(o.userID),
    date: wallClockDate(String(o.orderDate)),
    platform: channelOf(o.orderPlatform),
    amount: toNum(o.finalAmount) ?? 0,
    pin: o.pinCode,
    city: o.city,
    status: str(o.status),
  }));
}

const regionalFresh: Query = async (params) => {
  const [from, to] = range(params);
  return aggregateRegional(await readPlacedFresh(from, to)) as unknown as Row[];
};

const regionalPeriods: Query = async (params) => {
  const [anchor, today] = params;
  if (typeof anchor !== "string" || typeof today !== "string" || anchor > today) throw new Error("Expected [anchor, today] params");
  const periods = periodSpecs(anchor, today);
  const from = periods.reduce((m, p) => (p.from < m ? p.from : m), anchor);
  return aggregatePeriods(await readPlacedFresh(from, anchor), periods) as unknown as Row[];
};

/** Full Fresh history up to `to` (Order_Level_V4 starts 25 Oct 2025), so "first-ever order" is well defined. */
const HISTORY_START = "2020-01-01";

const regionalNewMarkets: Query = async (params) => {
  const [from, to] = range(params);
  return aggregateNewMarkets(await readPlacedFresh(HISTORY_START, to), from, to) as unknown as Row[];
};

// ---------- Meta (adwatch.meta_ad_daily, marketing_meta.meta_campaign_performance_daily) ----------

function readMetaAdDaily(from: string, to: string, columns: string) {
  return selectAll({
    schema: "adwatch",
    table: "meta_ad_daily",
    columns: `date,ad_id,${columns}`,
    orderBy: ["date", "ad_id"],
    filter: (q) => q.gte("date", from).lte("date", to),
  });
}

const metaAdDaily: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await readMetaAdDaily(from, to, "campaign_id,campaign_name,adset_id,adset_name,ad_name,spend,impressions,reach,clicks,link_clicks,installs");
  return rows
    .map((m) => ({
      date: m.date,
      campaign_id: str(m.campaign_id),
      campaign_name: str(m.campaign_name),
      adset_id: str(m.adset_id),
      adset_name: str(m.adset_name),
      ad_id: str(m.ad_id),
      ad_name: str(m.ad_name),
      spend: n0(m.spend),
      impressions: n0(m.impressions),
      reach: n0(m.reach),
      clicks: n0(m.clicks),
      link_clicks: n0(m.link_clicks),
      installs: n0(m.installs),
    }))
    .sort(byKeys((r) => String(r.date), (r) => r.campaign_id ?? "", (r) => r.adset_id ?? "", (r) => r.ad_id ?? ""));
};

const metaAccountDaily: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await readMetaAdDaily(from, to, "spend,impressions,clicks,link_clicks,installs");
  const out: Row[] = [];
  for (const [date, g] of groupBy(rows, (r) => String(r.date))) {
    const sum = (col: string) => sumOrNull(g.map((r) => r[col])) ?? 0;
    out.push({ date, spend: money(sum("spend")), impressions: sum("impressions"), clicks: sum("clicks"), link_clicks: sum("link_clicks"), installs: sum("installs") });
  }
  return out.sort(byKeys((r) => String(r.date)));
};

const metaSpendCheck: Query = async (params) => {
  const [from, to] = range(params);
  const [a, c] = await Promise.all([
    readMetaAdDaily(from, to, "spend,impressions"),
    selectAll({
      schema: "marketing_meta",
      table: "meta_campaign_performance_daily",
      columns: "reporting_starts,ad_account_id,campaign_id,amount_spent_inr,impressions",
      orderBy: ["reporting_starts", "ad_account_id", "campaign_id"],
      filter: (q) => q.gte("reporting_starts", from).lte("reporting_starts", to),
    }),
  ]);
  const aBy = groupBy(a, (r) => String(r.date));
  const cBy = groupBy(c, (r) => String(r.reporting_starts));
  const dates = [...new Set([...aBy.keys(), ...cBy.keys()])].sort();
  return dates.map((date) => {
    const ag = aBy.get(date);
    const cg = cBy.get(date);
    const spendA = ag ? sumOrNull(ag.map((r) => r.spend)) : null;
    const spendC = cg ? sumOrNull(cg.map((r) => r.amount_spent_inr)) : null;
    return {
      date,
      adwatch_spend: spendA === null ? null : money(spendA),
      campaign_table_spend: spendC === null ? null : money(spendC),
      adwatch_impressions: ag ? sumOrNull(ag.map((r) => r.impressions)) : null,
      campaign_table_impressions: cg ? sumOrNull(cg.map((r) => r.impressions)) : null,
    };
  });
};

/** Meta campaign-day reach (see meta_campaign_reach.sql). Not additive; the page labels it as a campaign sum. */
const metaCampaignReach: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await selectAll({
    schema: "marketing_meta",
    table: "meta_campaign_performance_daily",
    columns: "reporting_starts,campaign_id,reach",
    orderBy: ["reporting_starts", "campaign_id"],
    filter: (q) => q.gte("reporting_starts", from).lte("reporting_starts", to),
  });
  return rows.map((r) => ({ date: r.reporting_starts, campaign_id: str(r.campaign_id) ?? "", reach: n0(r.reach) }));
};

// ---------- Change log (crm.change_log) ----------

/** Logged changes starting in the range, plus earlier ones still open in it (see change_log.sql). */
const changeLog: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await selectAll({
    schema: "crm",
    table: "change_log",
    columns: "id,title,type,owner,created_by,hypothesis,scope,start_date,review_date,status,primary_metric,target_value,target_dir,verdict,decision,closed_at",
    orderBy: ["start_date", "id"],
    filter: (q) => q.lte("start_date", to),
  });
  return rows
    .filter((r) => String(r.start_date) >= from || r.closed_at === null || istDateOfInstant(String(r.closed_at)) >= from)
    .map((r) => ({ ...r, scope: r.scope === null || r.scope === undefined ? null : JSON.stringify(r.scope) }));
};

/** adwatch coverage start: the first date in adwatch.meta_ad_daily. */
const ADWATCH_FROM = "2026-09-12";

const metaAdHistory: Query = async (params) => {
  const [to] = params;
  if (typeof to !== "string") throw new Error("Expected [to] param");
  const rows = await selectAll({
    schema: "adwatch",
    table: "meta_ad_daily",
    columns: "date,ad_id,campaign_id,campaign_name,adset_id,adset_name,ad_name,spend,impressions,reach,frequency,clicks,link_clicks,installs,video_3s,thruplays",
    orderBy: ["date", "ad_id"],
    filter: (q) => q.gte("date", ADWATCH_FROM).lte("date", to),
  });
  return rows.map((m) => ({
    date: m.date,
    campaign_id: str(m.campaign_id),
    campaign_name: str(m.campaign_name),
    adset_id: str(m.adset_id),
    adset_name: str(m.adset_name),
    ad_id: str(m.ad_id),
    ad_name: str(m.ad_name),
    spend: n0(m.spend),
    impressions: n0(m.impressions),
    reach: n0(m.reach),
    frequency: n0(m.frequency),
    clicks: n0(m.clicks),
    link_clicks: n0(m.link_clicks),
    installs: n0(m.installs),
    video_3s: n0(m.video_3s),
    thruplays: n0(m.thruplays),
  }));
};

const WINDOW_PARAM = /^([a-z0-9_]+):(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;
/** "st:<today>:<minute>" — also count each day since sameTimeFrom(today) only up to that IST minute (level "st"). */
const SAME_TIME_PARAM = /^st:(\d{4}-\d{2}-\d{2}):(\d{1,4})$/;

/** Meta-attributed AppsFlyer installs and add-to-cart devices: daily, plus distinct counts per named window. */
const metaAf: Query = async (params) => {
  const [from, to, ...rest] = params;
  if (typeof from !== "string" || typeof to !== "string") throw new Error("Expected [from, to, ...windows]");
  const stParam = rest.map((w) => (typeof w === "string" ? SAME_TIME_PARAM.exec(w) : null)).find((m) => m !== null) ?? null;
  const sameTime = stParam ? { today: stParam[1], cut: Number(stParam[2]) } : null;
  if (sameTime && sameTime.cut > 1439) throw new Error("Bad same-time param");
  const windows = rest.flatMap((w) => {
    if (typeof w === "string" && SAME_TIME_PARAM.test(w)) return [];
    const m = typeof w === "string" ? WINDOW_PARAM.exec(w) : null;
    if (!m) throw new Error("Bad window param");
    return [{ id: m[1], from: m[2], to: m[3] }];
  });
  // Same-time days: the earlier of 7 days back and the 1st of the month, from AppsFlyer's first whole day, to today.
  const stFrom = sameTime ? [[addDaysIso(sameTime.today, -7), `${sameTime.today.slice(0, 7)}-01`].sort()[0], AF_FIRST_FULL_DAY].sort()[1] : null;
  const spans = [{ from, to }, ...windows, ...(sameTime && stFrom ? [{ from: stFrom, to: sameTime.today }] : [])];
  const start = spans.map((w) => w.from).reduce((a, b) => (b < a ? b : a));
  const end = spans.map((w) => w.to).reduce((a, b) => (b > a ? b : a));
  // One read serves the daily series, the windows and the same-time days (the AppsFlyer read is this page's slowest).
  const base = await readMetaAfBase(start, end);
  const out: Row[] = [];
  const days = new Set(base.events.filter((e) => e.d >= from && e.d <= to).map((e) => e.d));
  for (const d of [...days].sort()) out.push({ level: "day", key: d, ...countMetaAf(base, (x) => x.d === d) });
  for (const w of windows) out.push({ level: "window", key: w.id, ...countMetaAf(base, (x) => x.d >= w.from && x.d <= w.to) });
  if (sameTime && stFrom) {
    for (let d = stFrom; d <= sameTime.today; d = addDaysIso(d, 1)) out.push({ level: "st", key: d, ...countMetaAf(base, (x) => x.d === d && x.m <= sameTime.cut) });
  }
  return out;
};

interface MetaAfBase {
  events: { d: string; t: number; m: number; name: string; device: string | null; user: string | null }[];
  firstCompleted: Map<string, number>;
  freshOrders: { user: string; d: string; m: number; app: boolean }[];
}

/** Meta-attributed AppsFlyer events in [start, end] (IST days) and what the Fresh rule needs to classify them. */
async function readMetaAfBase(start: string, end: string): Promise<MetaAfBase> {
  const rows = await selectAll({
    schema: "public",
    table: "af_events_rt",
    columns: "id,n:event_name,a:appsflyer_id,u:customer_user_id,t:event_ts",
    orderBy: ["id"],
    keyColumn: "id",
    filter: (q) =>
      q
        .gte("event_ts", istDayStart(start))
        .lt("event_ts", istDayStart(addDaysIso(end, 1)))
        .in("media_source", ["restricted", "Facebook Ads"])
        .in("event_name", ["install", "af_add_to_cart", "af_initiated_checkout", "af_purchase", "First_Purchase"]),
  });
  const events = rows.map((r) => ({
    d: istDateOfInstant(String(r.t)),
    t: Date.parse(String(r.t)),
    m: istMinuteOfInstant(String(r.t)),
    name: String(r.n),
    device: str(r.a),
    user: str(r.u) || null,
  }));
  const users = [...new Set(events.map((e) => e.user).filter((u): u is string => u !== null))];
  // Repeat = a COMPLETED order before the user's first add-to-cart / checkout in the window (agreed cart-lead rule).
  const [completed, fresh] = await Promise.all([
    selectIn({ schema: "public", table: "Order_Level_V4", columns: "orderID,userID,orderDate", orderBy: ["orderID"], filter: (q) => q.eq("status", "COMPLETED") }, "userID", users),
    // Eligible Fresh orders (the three agreed exclusions) placed by these Meta-attributed users inside the read span.
    selectIn({ schema: "public", table: "Order_Level_V4", columns: "orderID,userID,orderDate,orderPlatform", orderBy: ["orderID"], filter: newSalesFilter(start, end, ["Fresh"]) }, "userID", users),
  ]);
  const firstCompleted = new Map<string, number>();
  for (const o of completed) {
    if (o.userID === null || o.orderDate === null) continue;
    const t = istWallClockToEpoch(String(o.orderDate));
    const u = String(o.userID);
    if (!firstCompleted.has(u) || t < firstCompleted.get(u)!) firstCompleted.set(u, t);
  }
  const freshOrders = [
    ...new Map(
      fresh.map((o) => [String(o.orderID), { user: String(o.userID), d: wallClockDate(String(o.orderDate)), m: wallMinute(String(o.orderDate)), app: channelOf(o.orderPlatform) === "APP" }]),
    ).values(),
  ];
  return { events, firstCompleted, freshOrders };
}

/** Distinct counts over the events and orders `keep` selects (by IST day `d` and minute of day `m`). */
function countMetaAf({ events, firstCompleted, freshOrders }: MetaAfBase, keep: (x: { d: string; m: number }) => boolean) {
  {
    const inst = new Set<string>();
    const atc = new Set<string>();
    const firstAtc = new Map<string, number>();
    const firstCo = new Map<string, number>();
    const metaUsers = new Set<string>();
    for (const e of events) {
      if (!keep(e)) continue;
      if (e.user && e.name !== "install") metaUsers.add(e.user);
      if (e.name === "install") {
        if (e.device) inst.add(e.device);
      } else if (e.name === "af_add_to_cart") {
        if (e.device) atc.add(e.device);
        if (e.user && (!firstAtc.has(e.user) || e.t < firstAtc.get(e.user)!)) firstAtc.set(e.user, e.t);
      } else if (e.name === "af_initiated_checkout" && e.user && (!firstCo.has(e.user) || e.t < firstCo.get(e.user)!)) {
        firstCo.set(e.user, e.t);
      }
    }
    const freshUsers = (m: Map<string, number>) => [...m].filter(([u, t]) => !((firstCompleted.get(u) ?? Infinity) < t)).map(([u]) => u);
    const freshOf = (m: Map<string, number>) => freshUsers(m).length;
    const matched = freshOrders.filter((o) => keep(o) && metaUsers.has(o.user));
    const atcFresh = new Set(freshUsers(firstAtc));
    const buyers = new Set(matched.filter((o) => atcFresh.has(o.user)).map((o) => o.user));
    return {
      installs: inst.size,
      atc: atc.size,
      atc_fresh: freshOf(firstAtc),
      checkout_fresh: freshOf(firstCo),
      fresh_orders: matched.length,
      fresh_orders_app: matched.filter((o) => o.app).length,
      fresh_customers: new Set(matched.map((o) => o.user)).size,
      atc_fresh_buyers: buyers.size,
    };
  }
}

/**
 * meta_same_time.sql — every day from the earlier of 7 days back and the 1st of the month to today, counted only to
 * the current IST minute, for the Meta Ads Now / Yesterday / Last 7 days / MTD comparison. (The AppsFlyer side of the
 * same days comes from meta_af's "st" rows, so the slow AppsFlyer read runs once per page.)
 */
const metaSameTime: Query = async (params) => {
  const [today, cut] = params;
  if (typeof today !== "string" || typeof cut !== "number" || cut < 0 || cut > 1439) throw new Error("Expected [today, cutoffMinute]");
  const from = [addDaysIso(today, -7), `${today.slice(0, 7)}-01`].sort()[0];
  const [ads, orders, leads] = await Promise.all([
    readMetaAdDaily(from, today, "spend,impressions,clicks,link_clicks,installs,video_3s,pulled_at"),
    readOrders(from, today, ["Fresh"], "orderDate,orderPlatform,userID"),
    readCartLeads(from, today),
  ]);

  // Meta has no hourly split readable: today's row runs to its last pull; earlier days to that minute = full day × the
  // usual cumulative share of daily spend by then (interpolated within the hour).
  const pulls = ads.filter((r) => String(r.date) === today && r.pulled_at !== null).map((r) => istMinuteOfInstant(String(r.pulled_at)));
  const metaMinute = pulls.length ? Math.min(cut, Math.max(...pulls)) : cut;
  const h = Math.floor(metaMinute / 60);
  const share = (h ? META_SPEND_SHARE_BY_HOUR[h - 1] : 0) + (META_SPEND_SHARE_BY_HOUR[h] - (h ? META_SPEND_SHARE_BY_HOUR[h - 1] : 0)) * ((metaMinute % 60) / 60);

  const days: string[] = [];
  for (let d = from; d <= today; d = addDaysIso(d, 1)) days.push(d);
  const byDay = new Map(days.map((d) => [d, { spend: 0, impressions: 0, clicks: 0, link_clicks: 0, installs: 0, video_3s: 0 }]));
  for (const r of ads) {
    const t = byDay.get(String(r.date));
    if (!t) continue;
    const k = String(r.date) === today ? 1 : share;
    t.spend += n0(r.spend) * k;
    t.impressions += n0(r.impressions) * k;
    t.clicks += n0(r.clicks) * k;
    t.link_clicks += n0(r.link_clicks) * k;
    t.installs += n0(r.installs) * k;
    t.video_3s += n0(r.video_3s) * k;
  }

  // Orders: eligible Fresh, APP + WEB, placed by the cut-off minute (IST wall clock).
  const uniq = [...new Map(orders.map((o) => [String(o.orderID), o])).values()].filter((o) => wallMinute(String(o.orderDate)) <= cut);
  const ordersOf = (d: string) => uniq.filter((o) => wallClockDate(String(o.orderDate)) === d);

  // CRM Fresh cart leads by the cut-off (crm_025a; Fresh = no COMPLETED order before the lead).
  const early = leads.filter((l) => istMinuteOfInstant(new Date(l.createdMs).toISOString()) <= cut);
  const completed = await selectIn(
    { schema: "public", table: "Order_Level_V4", columns: "orderID,cxPhone,orderDate", orderBy: ["orderID"], filter: (q) => q.eq("status", "COMPLETED") },
    "cxPhone",
    early.map((l) => l.phone).filter((p): p is string => p !== null),
  );
  const firstCompleted = new Map<string, number>();
  for (const o of completed) {
    if (o.cxPhone === null || o.orderDate === null) continue;
    const t = istWallClockToEpoch(String(o.orderDate));
    const ph = String(o.cxPhone);
    if (!firstCompleted.has(ph) || t < firstCompleted.get(ph)!) firstCompleted.set(ph, t);
  }
  const freshLead = (l: (typeof early)[number]) => {
    const fc = l.phone === null ? undefined : firstCompleted.get(l.phone);
    return !(fc !== undefined && fc < l.createdMs);
  };

  return days.map((d) => {
    const o = ordersOf(d);
    return {
      day: d,
      meta_minute: metaMinute,
      ...byDay.get(d)!,
      new_sales: o.length,
      new_sales_app: o.filter((x) => channelOf(x.orderPlatform) === "APP").length,
      fresh_customers: countDistinct(o.map((x) => x.userID)),
      fresh_leads: early.filter((l) => l.d === d && freshLead(l)).length,
    };
  });
};

// ---------- AppsFlyer ----------

interface AfEvent {
  name: string;
  device: string | null;
  user: string | null;
  media: string | null;
  t: number;
  /** IST date of the event. */
  d: string;
}

/**
 * Every paid AppsFlyer event in [from, to] — the largest read on the App funnel page. Cached per request, so the daily
 * trend, the range funnel and the period table (all month to date by default) page through af_events_rt once.
 */
const readAfEvents = cache(async (from: string, to: string): Promise<AfEvent[]> => {
  const rows = await selectAll({
    schema: "public",
    table: "af_events_rt",
    // One-letter aliases: this is the largest read (every paid event), and JSON keys repeat on every row.
    columns: "id,t:event_ts,n:event_name,m:media_source,a:appsflyer_id,u:customer_user_id",
    orderBy: ["id"],
    keyColumn: "id",
    filter: (q) =>
      q
        .gte("event_ts", istDayStart(from))
        .lt("event_ts", istDayStart(addDaysIso(to, 1)))
        .in("report_type", ["installs_report", "in_app_events_report"]),
  });
  return rows.map((r) => ({
    name: String(r.n),
    device: str(r.a),
    user: str(r.u) || null,
    media: str(r.m),
    t: Date.parse(String(r.t)),
    d: istDateOfInstant(String(r.t)),
  }));
});

const afEventsDaily: Query = async (params) => {
  const [from, to] = range(params);
  const events = await readAfEvents(from, to);
  const groupOf = (ms: string | null) => (ms === "restricted" ? "restricted" : ms === "Facebook Ads" ? "facebook" : "other_paid");
  const groups = groupBy(events, (e) => `${e.d}|${groupOf(e.media)}|${e.name}`);
  const out: Row[] = [];
  for (const [key, g] of groups) {
    const [event_date, media_source_group] = key.split("|");
    out.push({
      event_date,
      event_name: g[0].name,
      media_source_group,
      events: g.length,
      unique_devices: countDistinct(g.map((e) => e.device)),
      unique_users: countDistinct(g.map((e) => e.user), true),
    });
  }
  return out.sort(byKeys((r) => String(r.event_date), (r) => String(r.event_name), (r) => String(r.media_source_group)));
};

const afAdDaily: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await selectAll({
    schema: "adwatch",
    table: "af_ad_daily",
    columns: "date,campaign,adset,ad,installs,purchasers",
    orderBy: ["date", "campaign", "adset", "ad"],
    filter: (q) => q.gte("date", from).lte("date", to).not("ad", "is", null),
  });
  const out: Row[] = [];
  for (const [key, g] of groupBy(rows, (r) => `${r.date}|${r.ad}`)) {
    const sep = key.indexOf("|");
    out.push({
      date: key.slice(0, sep),
      ad_name: key.slice(sep + 1),
      installs: sumOrNull(g.map((r) => r.installs)) ?? 0,
      purchasers: sumOrNull(g.map((r) => r.purchasers)) ?? 0,
    });
  }
  return out.sort(byKeys((r) => String(r.date), (r) => String(r.ad_name)));
};

/** AppsFlyer aggregate by campaign (see af_campaign_daily.sql): Meta campaigns only. */
const afCampaignDaily: Query = async (params) => {
  const [from, to] = range(params);
  const rows = await selectAll({
    schema: "adwatch",
    table: "af_campaign_daily",
    columns: "date,campaign,installs,atc_users,purchasers,first_purchasers",
    orderBy: ["date", "campaign"],
    filter: (q) => q.gte("date", from).lte("date", to).eq("media_source", "Facebook Ads"),
  });
  const out: Row[] = [];
  for (const [key, g] of groupBy(rows, (r) => `${r.date}|${r.campaign ?? "None"}`)) {
    const sep = key.indexOf("|");
    out.push({
      date: key.slice(0, sep),
      campaign_name: key.slice(sep + 1),
      installs: sumOrNull(g.map((r) => r.installs)) ?? 0,
      atc_users: sumOrNull(g.map((r) => r.atc_users)) ?? 0,
      purchasers: sumOrNull(g.map((r) => r.purchasers)) ?? 0,
      first_purchasers: sumOrNull(g.map((r) => r.first_purchasers)) ?? 0,
    });
  }
  return out.sort(byKeys((r) => String(r.date), (r) => String(r.campaign_name)));
};

/** AppsFlyer events used by the app funnel (see af_funnel.sql). */
const AF_FUNNEL_EVENTS = [
  "install", "af_search", "af_view_content", "OTP_sent_success", "OTP_verified", "af_complete_registration", "Cart_View",
  "af_add_to_cart", "af_initiated_checkout", "Payment_failed", "af_purchase", "First_Purchase",
] as const;

const AF_FUNNEL_SET: ReadonlySet<string> = new Set(AF_FUNNEL_EVENTS);
type AfFunnelEvent = AfEvent;

/** The funnel's events from the shared read (cached, so every caller gets the same array for the same span). */
const readAfFunnelEvents = cache(async (from: string, to: string): Promise<AfFunnelEvent[]> => (await readAfEvents(from, to)).filter((e) => AF_FUNNEL_SET.has(e.name)));

/** Earliest COMPLETED order per user, for the users who added to cart (repeat rule). */
const firstCompletedOrders = cache(async (events: readonly AfFunnelEvent[]): Promise<Map<string, number>> => {
  const users = [...new Set(events.filter((e) => e.name === "af_add_to_cart" && e.user).map((e) => e.user as string))];
  const completed = await selectIn(
    { schema: "public", table: "Order_Level_V4", columns: "orderID,userID,orderDate", orderBy: ["orderID"], filter: (q) => q.eq("status", "COMPLETED") },
    "userID",
    users,
  );
  const first = new Map<string, number>();
  for (const o of completed) {
    if (o.userID === null || o.orderDate === null) continue;
    const t = istWallClockToEpoch(String(o.orderDate));
    const u = String(o.userID);
    if (!first.has(u) || t < first.get(u)!) first.set(u, t);
  }
  return first;
});

/** Stage counts over one window: distinct devices / users per stage, plus the new vs repeat add-to-cart split. */
function countAfFunnel(events: readonly AfFunnelEvent[], firstCompleted: ReadonlyMap<string, number>): Row[] {
  const stages = new Map<string, { events: number; devices: Set<string>; users: Set<string> }>();
  const stage = (k: string) => {
    let s = stages.get(k);
    if (!s) stages.set(k, (s = { events: 0, devices: new Set(), users: new Set() }));
    return s;
  };
  const firstAtc = new Map<string, number>();
  let atcUnidentified = 0;
  for (const e of events) {
    for (const k of e.name === "Payment_failed" || e.name === "af_purchase" ? [e.name, "payment_attempted"] : [e.name]) {
      const s = stage(k);
      s.events++;
      if (e.device) s.devices.add(e.device);
      if (e.user) s.users.add(e.user);
    }
    if (e.name === "af_add_to_cart") {
      if (!e.user) atcUnidentified++;
      else if (!firstAtc.has(e.user) || e.t < firstAtc.get(e.user)!) firstAtc.set(e.user, e.t);
    }
  }
  // Repeat = COMPLETED order before the user's first add-to-cart in the window (agreed cart-lead repeat rule).
  let repeat = 0;
  for (const [u, t] of firstAtc) if ((firstCompleted.get(u) ?? Infinity) < t) repeat++;

  const out: Row[] = [...stages].map(([k, s]) => ({ stage: k, events: s.events, devices: s.devices.size, users: s.users.size }));
  out.push({ stage: "atc_new_customer", events: null, devices: null, users: firstAtc.size - repeat });
  out.push({ stage: "atc_repeat_customer", events: null, devices: null, users: repeat });
  out.push({ stage: "atc_unidentified", events: atcUnidentified, devices: null, users: null });
  return out;
}

const afFunnel: Query = async (params) => {
  const [from, to] = range(params);
  const events = await readAfFunnelEvents(from, to);
  return countAfFunnel(events, await firstCompletedOrders(events));
};

/** The af_funnel counts for several named windows from ONE read of their combined span (see af_funnel.sql). */
const afFunnelWindows: Query = async (params) => {
  const windows = params.map((w) => {
    const m = typeof w === "string" ? WINDOW_PARAM.exec(w) : null;
    if (!m) throw new Error("Bad window param");
    return { id: m[1], from: m[2], to: m[3] };
  });
  if (!windows.length) return [];
  const start = windows.map((w) => w.from).reduce((a, b) => (b < a ? b : a));
  const end = windows.map((w) => w.to).reduce((a, b) => (b > a ? b : a));
  const events = await readAfFunnelEvents(start, end);
  const firstCompleted = await firstCompletedOrders(events);
  return windows.flatMap((w) => countAfFunnel(events.filter((e) => e.d >= w.from && e.d <= w.to), firstCompleted).map((r) => ({ window: w.id, ...r })));
};

// ---------- GA4 funnel (bigquery_data.app_funnel_daily) ----------

const FUNNEL_STEPS = [
  "first_open", "active_users", "otp_sent", "otp_verified", "searched", "viewed_item", "added_to_cart", "viewed_cart", "began_checkout",
  "payment_failed", "purchased", "first_purchase",
] as const;

const appFunnelDaily: Query = async (params) => {
  const [from, to] = range(params);
  const ymd = (d: string) => d.replaceAll("-", "");
  const rows = await selectAll({
    schema: "bigquery_data",
    table: "app_funnel_daily",
    columns: `day,platform,${FUNNEL_STEPS.join(",")}`,
    orderBy: ["day", "platform"],
    // `day` is YYYYMMDD text: compare as YYYYMMDD strings, never against 'YYYY-MM-DD'.
    filter: (q) => q.gte("day", ymd(from)).lte("day", ymd(to)),
  });
  return rows.map((f) => {
    const d = String(f.day);
    const out: Row = { day: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, platform: f.platform };
    for (const step of FUNNEL_STEPS) out[step] = n0(f[step]);
    return out;
  });
};

// ---------- Abandoned-cart leads (crm.leads, written crm_025a rule) ----------

interface Lead {
  id: number;
  phone: string | null;
  taskId: number | null;
  d: string;
  createdMs: number;
}

/** Steps 1–3 of crm_025a: cart leads in the IST range, filtered, one per phone per IST date. */
async function readCartLeads(from: string, to: string): Promise<Lead[]> {
  const rows = await selectAll({
    schema: "crm",
    table: "leads",
    columns: "id,phone,task_id,created_at,source_ref,closed_why:context->>closed_why",
    orderBy: ["id"],
    keyColumn: "id",
    filter: (q) => q.eq("lead_type", "cart").gte("created_at", istDayStart(from)).lt("created_at", istDayStart(addDaysIso(to, 1))),
  });
  const leads = rows
    .filter((l) => isCountableCartLead(str(l.source_ref), str(l.closed_why)))
    .map((l) => ({
      id: Number(l.id),
      phone: str(l.phone),
      taskId: toNum(l.task_id),
      d: istDateOfInstant(String(l.created_at)),
      createdMs: Date.parse(String(l.created_at)),
    }));
  return firstLeadPerPhonePerDay(leads);
}

const cartLeadsDaily: Query = async (params) => {
  const [from, to] = range(params);
  const leads = await readCartLeads(from, to);
  const phones = leads.map((l) => l.phone).filter((p): p is string => p !== null);
  // Step 4: Repeat = phone has a COMPLETED order (IST) before the lead time.
  const completed = await selectIn(
    { schema: "public", table: "Order_Level_V4", columns: "orderID,cxPhone,orderDate", orderBy: ["orderID"], filter: (q) => q.eq("status", "COMPLETED") },
    "cxPhone",
    phones,
  );
  const firstCompleted = new Map<string, number>();
  for (const o of completed) {
    if (o.cxPhone === null || o.orderDate === null) continue;
    const ph = String(o.cxPhone);
    const t = istWallClockToEpoch(String(o.orderDate));
    if (!firstCompleted.has(ph) || t < firstCompleted.get(ph)!) firstCompleted.set(ph, t);
  }
  const out: Row[] = [];
  for (const [lead_date, g] of groupBy(leads, (l) => l.d)) {
    const repeat = g.filter((l) => {
      const fc = l.phone === null ? undefined : firstCompleted.get(l.phone);
      return fc !== undefined && fc < l.createdMs;
    }).length;
    out.push({ lead_date, total_cart_leads: g.length, fresh: g.length - repeat, repeat });
  }
  return out.sort(byKeys((r) => String(r.lead_date)));
};

const cartLeadLifecycleDaily: Query = async (params) => {
  const [from, to] = range(params);
  const leads = await readCartLeads(from, to);
  const taskIds = leads.map((l) => l.taskId).filter((t): t is number => t !== null);
  const [tasks, ledger] = await Promise.all([
    selectIn({ schema: "crm", table: "tasks", columns: "id,attempts,won_order_id", orderBy: ["id"] }, "id", taskIds),
    selectIn({ schema: "crm", table: "cart_ledger", columns: "src_key,lead_id,cart_ts", orderBy: ["src_key"] }, "lead_id", leads.map((l) => l.id)),
  ]);
  const taskById = new Map(tasks.map((t) => [Number(t.id), t]));
  const wonIds = tasks.map((t) => str(t.won_order_id)).filter((id): id is string => id !== null);
  const wonOrders = await selectIn(
    { schema: "public", table: "Order_Level_V4", columns: "orderID,orderDate,orderPlatform,Order_Type", orderBy: ["orderID"] },
    "orderID",
    wonIds,
  );
  const orderById = new Map(wonOrders.map((o) => [String(o.orderID), o]));
  const firstCartTs = new Map<number, number>();
  for (const c of ledger) {
    if (c.lead_id === null || c.cart_ts === null) continue;
    const id = Number(c.lead_id);
    const t = Date.parse(String(c.cart_ts));
    if (!firstCartTs.has(id) || t < firstCartTs.get(id)!) firstCartTs.set(id, t);
  }

  const joined = leads.map((l) => {
    const task = l.taskId === null ? undefined : taskById.get(l.taskId);
    const wonId = task ? str(task.won_order_id) : null;
    const order = wonId === null ? undefined : orderById.get(wonId);
    // Only count the task's won order if it was placed at or after the lead time.
    const won = order && order.orderDate !== null && istWallClockToEpoch(String(order.orderDate)) >= l.createdMs ? order : undefined;
    const cartTs = firstCartTs.get(l.id);
    return {
      d: l.d,
      hasTask: task !== undefined,
      dialled: (toNum(task?.attempts) ?? 0) > 0,
      won: won !== undefined,
      wonChannel: won ? channelOf(won.orderPlatform) : null,
      wonType: won ? str(won.Order_Type) : null,
      minCartToLead: cartTs === undefined ? null : (l.createdMs - cartTs) / 60_000,
    };
  });

  const out: Row[] = [];
  for (const [lead_date, g] of groupBy(joined, (j) => j.d)) {
    const wonFresh = (ch: string) => g.filter((j) => j.wonType === "Fresh" && j.wonChannel === ch).length;
    const med = median(g.map((j) => j.minCartToLead));
    out.push({
      lead_date,
      leads: g.length,
      with_task: g.filter((j) => j.hasTask).length,
      dialled: g.filter((j) => j.dialled).length,
      won_any_order: g.filter((j) => j.won).length,
      won_fresh_app: wonFresh("APP"),
      won_fresh_web: wonFresh("WEB"),
      median_min_cart_to_lead: med === null ? null : round1(med),
    });
  }
  return out.sort(byKeys((r) => String(r.lead_date)));
};

// ---------- Freshness ----------

/**
 * Latest data date and load time per source. A source the service key cannot read reports nulls instead of
 * failing the whole banner.
 */
const sourceFreshness: Query = async () => {
  const safe = async (p: Promise<unknown>) => {
    try {
      return await p;
    } catch (err) {
      console.error(`[db] source_freshness: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };
  const date = (v: unknown) => (v === null || v === undefined ? null : String(v).slice(0, 10));
  const istDate = (v: unknown) => (v === null || v === undefined ? null : istDateOfInstant(String(v)));
  const cart: Filter = (q) => q.eq("lead_type", "cart");
  const [ordersDate, ordersLoaded, metaDate, metaLoaded, campDate, campLoaded, afDate, afLoaded, afAdDate, afAdLoaded, crmLatest] =
    await Promise.all([
      safe(maxOf("public", "Order_Level_V4", "orderDate")),
      safe(maxOf("public", "Order_Level_V4", "synced_at")),
      safe(maxOf("adwatch", "meta_ad_daily", "date")),
      safe(maxOf("adwatch", "meta_ad_daily", "pulled_at")),
      safe(maxOf("marketing_meta", "meta_campaign_performance_daily", "reporting_starts")),
      safe(maxOf("marketing_meta", "meta_campaign_performance_daily", "updated_at")),
      safe(maxOf("public", "af_events_rt", "event_ts")),
      safe(maxOf("public", "af_events_rt", "synced_at")),
      safe(maxOf("adwatch", "af_ad_daily", "date")),
      safe(maxOf("adwatch", "af_ad_daily", "pulled_at")),
      safe(maxOf("crm", "leads", "created_at", cart)),
    ]);
  return [
    { source: "orders", latest_data_date: date(ordersDate), last_loaded_at: str(ordersLoaded) },
    { source: "meta_ad_daily", latest_data_date: date(metaDate), last_loaded_at: str(metaLoaded) },
    { source: "meta_campaign_check", latest_data_date: date(campDate), last_loaded_at: str(campLoaded) },
    { source: "af_events", latest_data_date: istDate(afDate), last_loaded_at: str(afLoaded) },
    { source: "af_ad_daily", latest_data_date: date(afAdDate), last_loaded_at: str(afAdLoaded) },
    { source: "crm_cart_leads", latest_data_date: istDate(crmLatest), last_loaded_at: str(crmLatest) },
  ];
};

// ---------- Daily Growth War Room (war_room.sql) ----------

const IST_MS = 330 * 60_000;
/** Minutes since IST midnight for a timestamptz value. */
const istMinuteOfInstant = (ts: string) => Math.floor(((Date.parse(ts) + IST_MS) % 86_400_000) / 60_000);
/** Minutes since midnight for an IST wall-clock timestamp ("YYYY-MM-DD HH:MM:SS"). */
const wallMinute = (wc: string) => Number(wc.slice(11, 13)) * 60 + Number(wc.slice(14, 16));

const WAR_ORDER_HISTORY_DAYS = 14;
const WAR_SHORT_HISTORY_DAYS = 7;
const WAR_AF_EVENTS = ["install", "af_add_to_cart", "af_initiated_checkout", "Payment_failed", "af_purchase"] as const;
/**
 * Usual cumulative share of daily Meta spend reached by the end of each IST hour (mean of 4–17 Oct 2026, from
 * adwatch.meta_campaign_hourly). Used only when the hourly table is not readable: today's spend so far (meta_ad_daily,
 * refreshed hourly) is then compared with previous days' full-day spend × this share.
 */
const META_SPEND_SHARE_BY_HOUR = [0.024, 0.036, 0.043, 0.048, 0.054, 0.065, 0.089, 0.131, 0.189, 0.253, 0.313, 0.378, 0.444, 0.51, 0.572, 0.629, 0.682, 0.728, 0.772, 0.822, 0.875, 0.927, 0.977, 1];

const warRoom: Query = async (params) => {
  const [today, cut] = params;
  if (typeof today !== "string" || typeof cut !== "number" || cut < 0 || cut > 1439) throw new Error("Expected [today, cutoffMinute]");
  // Pacing medians use 14 / 7 days; the same-time Yesterday / Last 7 days / MTD columns need the month back to its 1st.
  const month = `${today.slice(0, 7)}-01`;
  const from14 = [addDaysIso(today, -WAR_ORDER_HISTORY_DAYS), month].sort()[0];
  const from7 = [addDaysIso(today, -WAR_SHORT_HISTORY_DAYS), month].sort()[0];
  const out: Row[] = [];
  // (metric, segment, day) → { so_far, full }
  const acc = new Map<string, { metric: string; segment: string; day: string; label: string | null; so_far: number; full: number }>();
  const add = (metric: string, segment: string, day: string, value: number, inCut: boolean, label: string | null = null) => {
    const k = `${metric}|${segment}|${day}`;
    const a = acc.get(k) ?? { metric, segment, day, label, so_far: 0, full: 0 };
    a.full += value;
    if (inCut) a.so_far += value;
    acc.set(k, a);
  };

  const [orders, hourly, ads, af, leads, tasks, signals] = await Promise.all([
    selectAll({
      schema: "public",
      table: "Order_Level_V4",
      columns: "orderID,orderDate,orderPlatform,Order_Type,userID,finalAmount,pinCode,city,status",
      orderBy: ["orderID"],
      filter: (q) => q.gte("orderDate", from14).lt("orderDate", addDaysIso(today, 1)).in("orderPlatform", ["APP", "WEB"]).in("Order_Type", ["Fresh", "Repeat"]),
    }),
    // Optional: the service key may lack SELECT on the hourly table; then spend pacing falls back to meta_ad_daily.
    selectAll({
      schema: "adwatch",
      table: "meta_campaign_hourly",
      columns: "date,hour,campaign_id,campaign_name,spend,installs",
      orderBy: ["date", "hour", "campaign_id"],
      filter: (q) => q.gte("date", from14).lte("date", today),
    }).catch((err: unknown) => {
      console.error(`[db] war_room: meta_campaign_hourly unavailable, using meta_ad_daily: ${err instanceof Error ? err.message : String(err)}`);
      return [] as Row[];
    }),
    readMetaAdDaily(from14, today, "campaign_id,campaign_name,adset_id,adset_name,ad_name,spend,installs"),
    selectAll({
      schema: "public",
      table: "af_events_rt",
      columns: "id,n:event_name,m:media_source,a:appsflyer_id,t:event_ts",
      orderBy: ["id"],
      keyColumn: "id",
      filter: (q) => q.gte("event_ts", istDayStart(from7)).lt("event_ts", istDayStart(addDaysIso(today, 1))).in("event_name", [...WAR_AF_EVENTS]),
    }),
    readCartLeads(from7, today),
    Promise.all([
      // Open queue now: status open / callback (closed tasks carry closed_at).
      selectAll({ schema: "crm", table: "tasks", columns: "id,status,primary_type,attempts,callback_at,last_dial_at,last_outcome,closed_at", orderBy: ["id"], filter: (q) => q.in("status", ["open", "callback"]) }),
      // Calls in the last 7 days, for outcome mix.
      selectAll({ schema: "crm", table: "tasks", columns: "id,status,primary_type,attempts,callback_at,last_dial_at,last_outcome,closed_at", orderBy: ["id"], filter: (q) => q.gte("last_dial_at", istDayStart(from7)) }),
    ]).then(([open, dialled]) => [...new Map([...open, ...dialled].map((t) => [String(t.id), t])).values()]),
    // Optional: adwatch's own rule signals. The service key may lack SELECT on adwatch.signals — never fail the page.
    selectAll({
      schema: "adwatch",
      table: "signals",
      columns: "id,rule_key,severity,level,entity_name,message,detected_at",
      orderBy: ["id"],
      filter: (q) => q.gte("detected_at", istDayStart(today)),
    }).catch((err: unknown) => {
      console.error(`[db] war_room: adwatch.signals unavailable: ${err instanceof Error ? err.message : String(err)}`);
      return [] as Row[];
    }),
  ]);

  // ----- Orders -----
  const uniq = [...new Map(orders.map((o) => [String(o.orderID), o])).values()];
  const eligible = (s: unknown) => !NEW_SALES_EXCLUDED_STATUSES.has(String(s));
  const byUser = new Map<string, number[]>(); // eligible order times per user (any type), for prescription conversion
  for (const o of uniq) {
    if (!eligible(o.status) || o.userID === null) continue;
    const u = String(o.userID);
    byUser.set(u, [...(byUser.get(u) ?? []), istWallClockToEpoch(String(o.orderDate))]);
  }
  for (const o of uniq) {
    if (o.Order_Type !== "Fresh") continue;
    const wc = String(o.orderDate);
    const day = wallClockDate(wc);
    const inCut = wallMinute(wc) <= cut;
    const status = String(o.status);
    if (status === "PRESCRIPTION_UPLOADED") {
      add("rx_uploads", "all", day, 1, inCut);
      const t = istWallClockToEpoch(wc);
      const converted = o.userID !== null && (byUser.get(String(o.userID)) ?? []).some((x) => x >= t);
      if (converted) add("rx_converted", "all", day, 1, inCut);
      continue;
    }
    if (CANCELLED_STATUSES.has(status)) {
      add("cancelled", "all", day, 1, inCut);
      continue;
    }
    const ch = channelOf(o.orderPlatform);
    const loc = resolveLocation(o.pinCode, o.city);
    const amt = toNum(o.finalAmount) ?? 0;
    for (const seg of ["all", ch, loc.tier, ...(loc.market === "mumbai" ? ["mmr"] : [])]) add("new_sales", seg, day, 1, inCut);
    add("revenue", "all", day, amt, inCut);
    add("new_sales_h", String(Math.floor(wallMinute(wc) / 60)), day, 1, inCut);
  }

  // ----- Meta hourly (cut-off = last hour loaded today) -----
  const hourlyMode = hourly.length > 0;
  const todayHours = hourly.filter((r) => String(r.date) === today).map((r) => Number(r.hour));
  // Daily fallback: meta_ad_daily is pulled hourly, so today's totals run to about the previous full hour.
  const metaHour = hourlyMode ? (todayHours.length ? Math.max(...todayHours) : -1) : Math.max(0, Math.floor(cut / 60) - 1);
  out.push({ metric: "meta_hour", segment: "all", day: today, label: null, so_far: metaHour, full: null });
  out.push({ metric: "meta_mode", segment: hourlyMode ? "hourly" : "daily", day: today, label: null, so_far: 1, full: null });
  if (!hourlyMode) {
    const share = META_SPEND_SHARE_BY_HOUR[metaHour] ?? 1;
    for (const r of ads) {
      const day = String(r.date);
      const spend = n0(r.spend);
      const inst = n0(r.installs);
      const k = day === today ? 1 : share; // priors: expected amount by this hour = full day × usual share
      const put = (metric: string, segment: string, value: number, label: string | null = null) => {
        const key = `${metric}|${segment}|${day}`;
        const a = acc.get(key) ?? { metric, segment, day, label, so_far: 0, full: 0 };
        a.full += value;
        a.so_far += value * k;
        acc.set(key, a);
      };
      put("spend", "all", spend);
      put("installs", "all", inst);
      put("spend", `campaign:${r.campaign_id}`, spend, str(r.campaign_name));
      put("installs", `campaign:${r.campaign_id}`, inst, str(r.campaign_name));
      if (day !== today) {
        for (let h = 0; h < 24; h++) add("spend_h", String(h), day, spend * (META_SPEND_SHARE_BY_HOUR[h] - (h ? META_SPEND_SHARE_BY_HOUR[h - 1] : 0)), h <= metaHour);
      }
    }
  }
  for (const r of hourly) {
    const day = String(r.date);
    const inCut = Number(r.hour) <= metaHour;
    const spend = n0(r.spend);
    const inst = n0(r.installs);
    add("spend", "all", day, spend, inCut);
    add("installs", "all", day, inst, inCut);
    add("spend", `campaign:${r.campaign_id}`, day, spend, inCut, str(r.campaign_name));
    add("installs", `campaign:${r.campaign_id}`, day, inst, inCut, str(r.campaign_name));
    add("spend_h", String(r.hour), day, spend, inCut);
  }

  // ----- Meta ad-level (no hourly split: earlier days to this hour = full day × the usual share of spend by then) -----
  const adShare = META_SPEND_SHARE_BY_HOUR[Math.max(0, metaHour)] ?? 1;
  for (const r of ads) {
    const day = String(r.date);
    const spend = n0(r.spend);
    const inst = n0(r.installs);
    const camp = str(r.campaign_name) ?? "";
    const adset = str(r.adset_name) ?? "";
    for (const [seg, label] of [
      [`ad:${r.ad_id}`, `${camp} › ${adset} › ${str(r.ad_name) ?? r.ad_id}`],
      [`adset:${r.adset_id}`, `${camp} › ${adset}`],
    ] as const) {
      for (const [metric, value] of [["ad_spend", spend], ["ad_installs", inst]] as const) {
        const key = `${metric}|${seg}|${day}`;
        const a = acc.get(key) ?? { metric, segment: seg, day, label, so_far: 0, full: 0 };
        a.full += value;
        a.so_far += day === today ? value : value * adShare;
        acc.set(key, a);
      }
    }
  }

  // ----- AppsFlyer (distinct devices per day, to the cut-off and full day) -----
  const afSets = new Map<string, { cut: Set<string>; full: Set<string> }>();
  for (const e of af) {
    const device = str(e.a);
    if (!device) continue;
    const ts = String(e.t);
    const day = istDateOfInstant(ts);
    const inCut = istMinuteOfInstant(ts) <= cut;
    for (const seg of ["all", ...(e.m === "restricted" || e.m === "Facebook Ads" ? ["meta"] : [])]) {
      const k = `af_${e.n}|${seg}|${day}`;
      const s = afSets.get(k) ?? { cut: new Set<string>(), full: new Set<string>() };
      s.full.add(device);
      if (inCut) s.cut.add(device);
      afSets.set(k, s);
    }
  }
  for (const [k, s] of afSets) {
    const [metric, segment, day] = k.split("|");
    out.push({ metric, segment, day, label: null, so_far: s.cut.size, full: s.full.size });
  }

  // ----- CRM: Fresh abandoned-cart leads (crm_025a + repeat rule) -----
  const phones = leads.map((l) => l.phone).filter((p): p is string => p !== null);
  const completed = await selectIn(
    { schema: "public", table: "Order_Level_V4", columns: "orderID,cxPhone,orderDate", orderBy: ["orderID"], filter: (q) => q.eq("status", "COMPLETED") },
    "cxPhone",
    phones,
  );
  const firstCompleted = new Map<string, number>();
  for (const o of completed) {
    if (o.cxPhone === null || o.orderDate === null) continue;
    const t = istWallClockToEpoch(String(o.orderDate));
    const ph = String(o.cxPhone);
    if (!firstCompleted.has(ph) || t < firstCompleted.get(ph)!) firstCompleted.set(ph, t);
  }
  for (const l of leads) {
    const fc = l.phone === null ? undefined : firstCompleted.get(l.phone);
    const fresh = !(fc !== undefined && fc < l.createdMs);
    const inCut = istMinuteOfInstant(new Date(l.createdMs).toISOString()) <= cut;
    add(fresh ? "fresh_leads" : "repeat_leads", "all", l.d, 1, inCut);
  }

  // ----- CRM queue now (snapshot) and call outcomes -----
  const nowMs = Date.now();
  for (const t of tasks) {
    const type = str(t.primary_type) ?? "other";
    if (t.closed_at === null && (t.status === "open" || t.status === "callback")) {
      add("task_open", type, today, 1, true);
      if (n0(t.attempts) === 0) add("task_never_dialled", type, today, 1, true);
      if (t.callback_at !== null && Date.parse(String(t.callback_at)) < nowMs) add("task_callback_overdue", type, today, 1, true);
    }
    if (t.last_dial_at !== null) {
      const ts = String(t.last_dial_at);
      add("call_outcome", str(t.last_outcome) ?? "NONE", istDateOfInstant(ts), 1, istMinuteOfInstant(ts) <= cut);
    }
  }

  // ----- adwatch signals today (relayed) -----
  for (const s of signals) {
    out.push({
      metric: "signal",
      segment: `${str(s.rule_key) ?? ""}:${str(s.level) ?? ""}:${str(s.severity) ?? ""}`,
      day: today,
      label: `${str(s.entity_name) ?? ""} — ${str(s.message) ?? ""}`.slice(0, 300),
      so_far: 1,
      full: null,
    });
  }

  for (const a of acc.values()) out.push({ ...a, full: a.day === today ? null : a.full });
  return out;
};

/** One implementation per registered reporting definition (lib/db/sql.ts). */
export const QUERIES: Record<SqlName, Query> = {
  orders_daily: ordersDaily,
  orders_unique_customers: ordersUniqueCustomers,
  orders_payment_mix: ordersPaymentMix,
  aov_fresh: aovFresh,
  meta_ad_daily: metaAdDaily,
  meta_account_daily: metaAccountDaily,
  meta_spend_check: metaSpendCheck,
  meta_ad_history: metaAdHistory,
  meta_af: metaAf,
  af_events_daily: afEventsDaily,
  af_ad_daily: afAdDaily,
  af_campaign_daily: afCampaignDaily,
  af_funnel: afFunnel,
  af_funnel_windows: afFunnelWindows,
  app_funnel_daily: appFunnelDaily,
  cart_leads_daily: cartLeadsDaily,
  cart_lead_lifecycle_daily: cartLeadLifecycleDaily,
  regional_fresh: regionalFresh,
  regional_periods: regionalPeriods,
  regional_new_markets: regionalNewMarkets,
  source_freshness: sourceFreshness,
  war_room: warRoom,
  meta_same_time: metaSameTime,
  change_log: changeLog,
  meta_campaign_reach: metaCampaignReach,
};
