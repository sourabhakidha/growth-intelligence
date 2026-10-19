// Pure funnel view-models for the App Funnel page. Two SOURCE-SPECIFIC funnels are built and never merged:
//   - AppsFlyer: paid (non-organic) users only, distinct devices over the whole range, from 6 Oct 2026.
//   - GA4: all users incl. organic, daily distinct users SUMMED across days (not range-distinct), ~2-day lag.
// Business outcome (eligible Fresh APP orders) is shown next to the tracked events, never as a funnel stage of either
// source. No I/O.

import type { AfFunnelRow, AppFunnelDailyRow, OrdersDailyRow } from "../types/schemas";

/** First day of AppsFlyer raw-event coverage (organic ingest disabled; paid users only). */
export const AF_COVERAGE_FROM = "2026-10-06";
/** GA4 export lag (bigquery_data.app_funnel_daily): the last 2 days are incomplete. */
export const GA4_LAG_DAYS = 2;

export interface StageInput {
  key: string;
  label: string;
  value: number | null;
  prev: number | null;
  /** Derived from other events (not a tracked event of its own). */
  derived?: boolean;
  note?: string;
}

export interface StageView extends StageInput {
  /** value ÷ previous stage's value (same period). */
  conv_prev: number | null;
  /** previous stage − this stage. */
  drop: number | null;
  drop_rate: number | null;
  /** value vs the same stage in the previous period. */
  change: number | null;
  /** Conversion from the previous stage in the previous period (for "where did it get worse"). */
  conv_prev_period: number | null;
}

const div = (n: number | null, d: number | null) => (n === null || d === null || d === 0 ? null : n / d);

export function buildStages(stages: readonly StageInput[]): StageView[] {
  return stages.map((s, i) => {
    const before = i > 0 ? stages[i - 1] : null;
    const conv = before ? div(s.value, before.value) : null;
    return {
      ...s,
      conv_prev: conv,
      drop: before && before.value !== null && s.value !== null ? before.value - s.value : null,
      drop_rate: conv === null ? null : 1 - conv,
      change: s.prev === null || s.value === null ? null : div(s.value - s.prev, s.prev),
      conv_prev_period: before ? div(s.prev, before.prev) : null,
    };
  });
}

/** The stage that loses the most volume (largest absolute drop), ignoring the first stage. */
export function weakestStage(stages: readonly StageView[]): StageView | null {
  return stages.reduce<StageView | null>((w, s) => (s.drop !== null && (w === null || (w.drop ?? 0) < s.drop) ? s : w), null);
}

// ---------- AppsFlyer ----------

export interface AfFunnelView {
  /** Main path, in distinct devices. */
  stages: StageView[];
  paymentFailed: { value: number | null; prev: number | null; rate: number | null };
  atc: { total: number | null; newCustomer: number | null; repeatCustomer: number | null; unidentified: number | null };
  micro: StageView[];
  comparable: boolean;
}

export function afStageMap(rows: readonly AfFunnelRow[] | null): Map<string, AfFunnelRow> {
  return new Map((rows ?? []).map((r) => [r.stage, r]));
}

export function buildAfFunnel(cur: readonly AfFunnelRow[], prev: readonly AfFunnelRow[] | null): AfFunnelView {
  const c = afStageMap(cur);
  const p = prev ? afStageMap(prev) : null;
  const dev = (m: Map<string, AfFunnelRow> | null, k: string) => (m ? (m.get(k)?.devices ?? 0) : null);
  const usr = (m: Map<string, AfFunnelRow> | null, k: string) => (m ? (m.get(k)?.users ?? 0) : null);
  const st = (key: string, label: string, extra: Partial<StageInput> = {}): StageInput => ({ key, label, value: dev(c, key), prev: dev(p, key), ...extra });
  const stages = buildStages([
    st("install", "Installs"),
    st("af_search", "Search"),
    st("af_add_to_cart", "Add to cart"),
    st("af_initiated_checkout", "Checkout initiated"),
    st("payment_attempted", "Payment attempted", { derived: true, note: "Derived: devices with a payment-failed or purchase event. AppsFlyer has no payment-attempt event." }),
    st("af_purchase", "Payment successful", { note: "af_purchase — includes repeat-customer purchases." }),
    st("First_Purchase", "New sale (first purchase, tracked)", { note: "AppsFlyer First_Purchase event — a tracked event, not the business count of Fresh orders." }),
  ]);
  const attempted = dev(c, "payment_attempted");
  const failed = dev(c, "Payment_failed");
  const micro = buildStages([
    st("OTP_sent_success", "OTP sent"),
    st("OTP_verified", "OTP verified"),
    st("af_complete_registration", "Registration complete"),
  ]).concat(
    buildStages([st("af_view_content", "Product viewed"), st("af_add_to_cart", "Add to cart"), st("Cart_View", "Cart viewed"), st("af_initiated_checkout", "Checkout initiated")]),
  );
  return {
    stages,
    paymentFailed: { value: failed, prev: dev(p, "Payment_failed"), rate: div(failed, attempted) },
    atc: {
      total: usr(c, "af_add_to_cart"),
      newCustomer: usr(c, "atc_new_customer"),
      repeatCustomer: usr(c, "atc_repeat_customer"),
      unidentified: c.get("atc_unidentified")?.events ?? null,
    },
    micro,
    comparable: p !== null,
  };
}

// ---------- GA4 ----------

export interface Ga4FunnelView {
  stages: StageView[];
  paymentFailed: { value: number | null; rate: number | null };
}

type Ga4Totals = Record<"first_open" | "otp_sent" | "otp_verified" | "searched" | "viewed_item" | "added_to_cart" | "viewed_cart" | "began_checkout" | "payment_failed" | "purchased" | "first_purchase", number>;

export function sumGa4(rows: readonly AppFunnelDailyRow[]): Ga4Totals {
  const keys = ["first_open", "otp_sent", "otp_verified", "searched", "viewed_item", "added_to_cart", "viewed_cart", "began_checkout", "payment_failed", "purchased", "first_purchase"] as const;
  const t = Object.fromEntries(keys.map((k) => [k, 0])) as Ga4Totals;
  for (const r of rows) for (const k of keys) t[k] += r[k];
  return t;
}

export function buildGa4Funnel(cur: readonly AppFunnelDailyRow[], prev: readonly AppFunnelDailyRow[] | null): Ga4FunnelView {
  const c = sumGa4(cur);
  const p = prev ? sumGa4(prev) : null;
  const st = (key: keyof Ga4Totals, label: string, extra: Partial<StageInput> = {}): StageInput => ({ key, label, value: c[key], prev: p ? p[key] : null, ...extra });
  const attempted = (t: Ga4Totals) => t.payment_failed + t.purchased;
  return {
    stages: buildStages([
      st("first_open", "Installs (first open)"),
      st("searched", "Search"),
      st("added_to_cart", "Add to cart"),
      st("began_checkout", "Checkout initiated"),
      {
        key: "payment_attempted",
        label: "Payment attempted",
        value: attempted(c),
        prev: p ? attempted(p) : null,
        derived: true,
        note: "Derived: payment_failed + purchased users (GA4 has no payment-attempt event; a user can appear in both).",
      },
      st("purchased", "Payment successful"),
      st("first_purchase", "New sale (first purchase, tracked)", { note: "GA4 first_purchase — a tracked event, not the business count of Fresh orders." }),
    ]),
    paymentFailed: { value: c.payment_failed, rate: div(c.payment_failed, attempted(c)) },
  };
}

// ---------- Period snapshot (today / yesterday / last 7 days / MTD / selected range) ----------

export interface SnapshotWindow {
  key: string;
  from: string;
  to: string;
  cmpFrom: string;
  cmpTo: string;
  /** af_funnel rows for the window and its comparison; [] = no events (zero), null = not available. */
  af: readonly AfFunnelRow[] | null;
  afCmp: readonly AfFunnelRow[] | null;
  /** Why the window has no comparison at all (e.g. today is still in progress). */
  noCmp?: string | null;
  /** Why only the AppsFlyer rows have no comparison (comparison before AppsFlyer coverage). */
  afNoCmp?: string | null;
}

export interface SnapshotCell {
  value: number | null;
  cmp: number | null;
  noCmp: string | null;
}

export interface SnapshotRow {
  key: string;
  label: string;
  sub: string;
  format: "count";
  up: true;
  cells: SnapshotCell[];
}

/**
 * One row per measure, one cell per window. AppsFlyer measures are distinct over each window (never summed from
 * smaller windows); New Sales are eligible Fresh orders (APP + WEB), summed from daily order rows inside the window.
 */
export function buildFunnelSnapshot(windows: readonly SnapshotWindow[], orders: readonly OrdersDailyRow[] | null): SnapshotRow[] {
  const af = (key: string, label: string, sub: string, pick: (m: Map<string, AfFunnelRow>) => number): SnapshotRow => ({
    key,
    label,
    sub,
    format: "count",
    up: true,
    cells: windows.map((w) => ({
      value: w.af ? pick(afStageMap(w.af)) : null,
      cmp: w.afCmp ? pick(afStageMap(w.afCmp)) : null,
      noCmp: w.noCmp ?? w.afNoCmp ?? null,
    })),
  });
  const dev = (k: string) => (m: Map<string, AfFunnelRow>) => m.get(k)?.devices ?? 0;
  const fresh = (from: string, to: string) =>
    orders ? orders.filter((r) => r.order_type === "Fresh" && r.order_date >= from && r.order_date <= to).reduce((a, r) => a + r.orders, 0) : null;
  return [
    af("install", "Installs", "AppsFlyer · devices", dev("install")),
    af("otp", "OTP verified", "AppsFlyer · devices", dev("OTP_verified")),
    af("search", "Searches", "AppsFlyer · devices", dev("af_search")),
    af("atc", "Add to carts", "AppsFlyer · devices", dev("af_add_to_cart")),
    af("atc_new", "New add to carts", "AppsFlyer · new-customer users", (m) => m.get("atc_new_customer")?.users ?? 0),
    {
      key: "new_sales",
      label: "New Sales total",
      sub: "Fresh orders · APP + WEB",
      format: "count",
      up: true,
      cells: windows.map((w) => ({ value: fresh(w.from, w.to), cmp: fresh(w.cmpFrom, w.cmpTo), noCmp: w.noCmp ?? null })),
    },
  ];
}
