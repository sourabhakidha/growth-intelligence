// Perf Change Impact: every Meta change (and logged CRM change) connected to Meta → App Funnel → New Sales. Pure (no I/O).
//
//   1. Detect changes from delivery data (adwatch.meta_ad_daily): campaign / ad set launches, pauses and restarts, new
//      creatives going live, and step changes in a campaign's daily spend. No readable source records budget, bid or
//      targeting edits (the Meta activity log stopped loading on 7 Jul 2026), so spend steps are labelled as inferred.
//   2. Merge crm.change_log entries: who, intent (hypothesis) and expected outcome (target) exist only when logged.
//   3. Compare the 7 days after each change with the same number of days before it, for Meta delivery (affected
//      campaigns and account), the app funnel (Meta-attributed add to carts, CRM abandoned-cart leads) and New Sales.
//      Funnel and sales are account-level: Meta receives no purchase events, so they cannot be attributed to a campaign.
//   4. Turn the comparison into a verdict, a confidence, uncertainties, a retain / reverse / test action and questions.

import { addDays, daysBetween, formatDateShort } from "../format/ist.ts";
import { formatCount, formatINR, formatPct } from "../format/inr.ts";
import { ADWATCH_FROM, AF_COVERAGE_FROM, totals } from "./metaIntel.ts";
import type { CampaignReachRow, CartLeadDailyRow, ChangeLogRow, MetaAdHistoryRow, MetaAfRow, OrdersDailyRow } from "../types/schemas";

type AfWindow = Omit<MetaAfRow, "level" | "key">;
type Win = { from: string; to: string };

const div = (n: number | null | undefined, d: number | null | undefined) => (n === null || n === undefined || !d ? null : n / d);
const chg = (a: number | null, b: number | null) => (a === null || b === null || b === 0 ? null : a / b - 1);
const spine = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
};
const span = (w: Win) => (w.from === w.to ? formatDateShort(w.from) : `${formatDateShort(w.from)} – ${formatDateShort(w.to)}`);

/** "MI_AKIDHA_Meta_APP_ABO_Creative_Test_220926" → "ABO Creative Test 220926". */
export const shortName = (name: string) => name.replace(/^MI_AKIDHA_Meta_(APP|App)_/i, "").replace(/_/g, " ");

// ---------- Metrics ----------

export type ImpactKey =
  | "spend" | "reach" | "impressions" | "cpm" | "ctr" | "cpc" | "installs" | "cpi"
  | "atc" | "atc_fresh" | "leads" | "leads_fresh"
  | "new_sales" | "sales_app" | "sales_web" | "aov" | "cac" | "revenue";

export type ImpactStage = "Meta" | "App funnel" | "New Sales";

export interface ImpactMetric {
  key: ImpactKey;
  label: string;
  sub: string;
  stage: ImpactStage;
  format: "inr" | "inr_precise" | "count" | "pct";
  /** true = higher is better. */
  up: boolean;
  /** Meta delivery metric: also shown for the affected campaigns. */
  meta?: boolean;
  /** Ratio — comparable even when the day is in progress. */
  rate?: boolean;
}

export const IMPACT_METRICS: ImpactMetric[] = [
  { key: "spend", label: "Spend", sub: "Meta", stage: "Meta", format: "inr", up: false, meta: true },
  { key: "reach", label: "Reach", sub: "avg daily, campaign sum", stage: "Meta", format: "count", up: true, meta: true },
  { key: "impressions", label: "Impressions", sub: "Meta", stage: "Meta", format: "count", up: true, meta: true },
  { key: "cpm", label: "CPM", sub: "per 1,000 impr.", stage: "Meta", format: "inr_precise", up: false, meta: true, rate: true },
  { key: "ctr", label: "CTR", sub: "link", stage: "Meta", format: "pct", up: true, meta: true, rate: true },
  { key: "cpc", label: "CPC", sub: "link", stage: "Meta", format: "inr_precise", up: false, meta: true, rate: true },
  { key: "installs", label: "Installs", sub: "Meta-reported", stage: "Meta", format: "count", up: true, meta: true },
  { key: "cpi", label: "CPI", sub: "spend ÷ installs", stage: "Meta", format: "inr_precise", up: false, meta: true, rate: true },
  { key: "atc", label: "Add to carts", sub: "AppsFlyer, Meta users · devices", stage: "App funnel", format: "count", up: true },
  { key: "atc_fresh", label: "Fresh add to carts", sub: "AppsFlyer, Meta users · new customers", stage: "App funnel", format: "count", up: true },
  { key: "leads", label: "Abandoned-cart leads", sub: "CRM, all sources", stage: "App funnel", format: "count", up: false },
  { key: "leads_fresh", label: "Fresh abandoned-cart leads", sub: "CRM, all sources", stage: "App funnel", format: "count", up: false },
  { key: "new_sales", label: "New Sales", sub: "Fresh orders, APP + WEB", stage: "New Sales", format: "count", up: true },
  { key: "sales_app", label: "APP New Sales", sub: "self-serve", stage: "New Sales", format: "count", up: true },
  { key: "sales_web", label: "WEB New Sales", sub: "sales-assisted", stage: "New Sales", format: "count", up: true },
  { key: "aov", label: "AOV", sub: "Fresh revenue ÷ orders", stage: "New Sales", format: "inr", up: true, rate: true },
  { key: "cac", label: "CAC", sub: "Meta spend ÷ New Sales", stage: "New Sales", format: "inr_precise", up: false, rate: true },
  { key: "revenue", label: "Revenue", sub: "Fresh orders", stage: "New Sales", format: "inr", up: true },
];

export type ImpactValues = Record<ImpactKey, number | null>;

export interface ImpactInputs {
  history: readonly MetaAdHistoryRow[];
  reach: readonly CampaignReachRow[] | null;
  leads: readonly CartLeadDailyRow[] | null;
  orders: readonly OrdersDailyRow[] | null;
}

/** Meta delivery for a window, optionally limited to some campaigns. */
function metaValues(x: ImpactInputs, w: Win, campaigns?: ReadonlySet<string>) {
  const rows = x.history.filter((r) => r.date >= w.from && r.date <= w.to && (!campaigns || campaigns.has(r.campaign_id)));
  const t = totals(rows);
  let reach: number | null = null;
  if (x.reach) {
    const rr = x.reach.filter((r) => r.date >= w.from && r.date <= w.to && (!campaigns || campaigns.has(r.campaign_id)));
    const days = new Set(rr.map((r) => r.date)).size;
    reach = days ? rr.reduce((a, r) => a + r.reach, 0) / days : null;
  }
  return { spend: t.spend, reach, impressions: t.impressions, cpm: t.cpm, ctr: t.ctr, cpc: t.cpc, installs: t.installs, cpi: t.cpi };
}

/** Every impact metric for one window. Funnel and sales are account-level; `af` is the window's Meta-attributed AppsFlyer row. */
export function impactValues(x: ImpactInputs, w: Win, af: AfWindow | null): ImpactValues {
  const m = metaValues(x, w);
  const fresh = (x.orders ?? []).filter((r) => r.order_type === "Fresh" && r.order_date >= w.from && r.order_date <= w.to);
  const sum = (rs: typeof fresh, k: "orders" | "revenue") => rs.reduce((a, r) => a + r[k], 0);
  const sales = x.orders ? sum(fresh, "orders") : null;
  const revenue = x.orders ? sum(fresh, "revenue") : null;
  const leads = x.leads?.filter((r) => r.lead_date >= w.from && r.lead_date <= w.to) ?? null;
  const afOk = af !== null && w.from >= AF_COVERAGE_FROM;
  return {
    ...m,
    atc: afOk ? af.atc : null,
    atc_fresh: afOk ? af.atc_fresh : null,
    leads: leads ? leads.reduce((a, r) => a + r.total_cart_leads, 0) : null,
    leads_fresh: leads ? leads.reduce((a, r) => a + r.fresh, 0) : null,
    new_sales: sales,
    sales_app: x.orders ? sum(fresh.filter((r) => r.channel === "APP"), "orders") : null,
    sales_web: x.orders ? sum(fresh.filter((r) => r.channel === "WEB"), "orders") : null,
    aov: div(revenue, sales),
    cac: div(m.spend, sales),
    revenue,
  };
}

// ---------- Change detection ----------

export type ChangeKind =
  | "campaign_launch" | "campaign_pause" | "campaign_restart" | "adset_launch" | "adset_pause"
  | "creative_launch" | "spend_up" | "spend_down" | "logged";

export const KIND_LABEL: Record<ChangeKind, string> = {
  campaign_launch: "Campaign launch",
  campaign_pause: "Campaign paused",
  campaign_restart: "Campaign restarted",
  adset_launch: "Ad set launch",
  adset_pause: "Ad set paused",
  creative_launch: "New creatives",
  spend_up: "Budget / spend increase",
  spend_down: "Budget / spend cut",
  logged: "Logged change",
};

export interface PerfChange {
  id: string;
  date: string;
  kind: ChangeKind;
  area: "Meta" | "CRM";
  title: string;
  /** What the data shows (or the log says). */
  evidence: string;
  campaignIds: string[];
  campaigns: string[];
  /** Share of account spend the change touches (materiality, 0–1). */
  weight: number;
  source: "Detected" | "Logged" | "Detected + logged";
  /** True when the change is inferred from spend rather than an observed launch / stop. */
  inferred: boolean;
  who: string | null;
  intent: string | null;
  expected: string | null;
  logId: number | null;
  logStatus: string | null;
  reviewDate: string | null;
}

interface Entity {
  id: string;
  name: string;
  campaignId: string;
  campaignName: string;
  adsetId: string;
  days: Map<string, number>;
}

function entities(history: readonly MetaAdHistoryRow[], level: "campaign" | "adset" | "ad"): Map<string, Entity> {
  const out = new Map<string, Entity>();
  for (const r of history) {
    const id = level === "campaign" ? r.campaign_id : level === "adset" ? r.adset_id : r.ad_id;
    if (!id) continue;
    let e = out.get(id);
    if (!e) {
      const name = (level === "campaign" ? r.campaign_name : level === "adset" ? r.adset_name : r.ad_name) ?? id;
      out.set(id, (e = { id, name, campaignId: r.campaign_id, campaignName: r.campaign_name ?? r.campaign_id, adsetId: r.adset_id, days: new Map() }));
    }
    e.days.set(r.date, (e.days.get(r.date) ?? 0) + r.spend);
  }
  return out;
}

const PAUSE_GAP = 2; // zero-spend days that make a stop (and, when delivery resumes, a restart)
const SPEND_STEP = 0.4; // ±40% step in a campaign's 3-day average spend vs its prior 7 days
const MIN_WEIGHT = 0.02; // changes touching < 2% of account spend are not shown

/**
 * Changes visible in delivery data between `from` and `to` (to ≤ last complete day). `last` bounds look-ahead windows.
 * Launches on the first day of adwatch coverage (12 Sep 2026) are not changes — the data just starts there.
 */
export function detectChanges(history: readonly MetaAdHistoryRow[], from: string, to: string, last: string): PerfChange[] {
  const days = spine(ADWATCH_FROM, last);
  const acct = new Map<string, number>();
  for (const r of history) acct.set(r.date, (acct.get(r.date) ?? 0) + r.spend);
  const acctSum = (w: Win) => spine(w.from, w.to).reduce((a, d) => a + (acct.get(d) ?? 0), 0);
  const share = (e: Pick<Entity, "days">, w: Win) => div(spine(w.from, w.to).reduce((a, d) => a + (e.days.get(d) ?? 0), 0), acctSum(w)) ?? 0;
  const after = (d: string) => ({ from: d, to: addDays(d, 6) < last ? addDays(d, 6) : last });
  const before = (d: string) => ({ from: addDays(d, -7), to: addDays(d, -1) });
  const inRange = (d: string) => d >= from && d <= to;
  const out: PerfChange[] = [];
  const base = (e: Entity, date: string, kind: ChangeKind, title: string, evidence: string, weight: number, inferred = false): PerfChange => ({
    id: `${kind}:${e.id}:${date}`,
    date,
    kind,
    area: "Meta",
    title,
    evidence,
    campaignIds: [e.campaignId],
    campaigns: [shortName(e.campaignName)],
    weight,
    source: "Detected",
    inferred,
    who: null,
    intent: null,
    expected: null,
    logId: null,
    logStatus: null,
    reviewDate: null,
  });

  /** Launch / stop / restart dates of one entity over the coverage window. */
  const lifecycle = (e: Entity) => {
    const ev: { date: string; kind: "launch" | "pause" | "restart" }[] = [];
    let zeros = 0;
    let started = false;
    for (const d of days) {
      const live = (e.days.get(d) ?? 0) > 0;
      if (live) {
        if (!started) {
          if (d > ADWATCH_FROM) ev.push({ date: d, kind: "launch" });
          started = true;
        } else if (zeros >= PAUSE_GAP) ev.push({ date: d, kind: "restart" });
        zeros = 0;
      } else if (started) {
        zeros++;
        if (zeros === PAUSE_GAP) ev.push({ date: addDays(d, -(PAUSE_GAP - 1)), kind: "pause" });
      }
    }
    return ev;
  };

  const camps = entities(history, "campaign");
  const campEvents = new Map<string, Set<string>>(); // campaignId → dates with a launch / pause / restart
  for (const c of camps.values()) {
    const short = shortName(c.name);
    for (const ev of lifecycle(c)) {
      campEvents.set(c.id, (campEvents.get(c.id) ?? new Set()).add(ev.date));
      if (!inRange(ev.date)) continue;
      if (ev.kind === "pause") {
        const w = share(c, before(ev.date));
        if (w >= MIN_WEIGHT) out.push(base(c, ev.date, "campaign_pause", `Paused: ${short}`, `No delivery from ${formatDateShort(ev.date)}; it had ${formatPct(w)} of account spend in the 7 days before.`, w));
      } else {
        const w = share(c, after(ev.date));
        const kind = ev.kind === "launch" ? "campaign_launch" : "campaign_restart";
        if (w >= MIN_WEIGHT) out.push(base(c, ev.date, kind, `${ev.kind === "launch" ? "Launched" : "Restarted"}: ${short}`, `First delivery ${ev.kind === "launch" ? "" : "after a pause "}on ${formatDateShort(ev.date)}; ${formatPct(w)} of account spend in its first 7 days.`, w));
      }
    }
  }

  const adsets = entities(history, "adset");
  const adsetLaunch = new Map<string, string>();
  for (const a of adsets.values()) {
    for (const ev of lifecycle(a)) {
      if (ev.kind === "launch") adsetLaunch.set(a.id, ev.date);
      if (!inRange(ev.date) || ev.kind === "restart" || campEvents.get(a.campaignId)?.has(ev.date)) continue;
      const pause = ev.kind === "pause";
      const w = share(a, pause ? before(ev.date) : after(ev.date));
      if (w < MIN_WEIGHT) continue;
      out.push(
        base(a, ev.date, pause ? "adset_pause" : "adset_launch", `${pause ? "Ad set paused" : "New ad set"}: ${shortName(a.name)} (${shortName(a.campaignName)})`,
          pause ? `No delivery from ${formatDateShort(ev.date)}; ${formatPct(w)} of account spend in the 7 days before.` : `First delivery on ${formatDateShort(ev.date)}; ${formatPct(w)} of account spend in its first 7 days.`, w),
      );
    }
  }

  // New creatives: ads first delivering on the same day in the same campaign, unless their ad set / campaign also launched.
  const groups = new Map<string, { camp: Entity; date: string; ads: Entity[] }>();
  for (const ad of entities(history, "ad").values()) {
    const first = [...ad.days].filter(([, s]) => s > 0).map(([d]) => d).sort()[0];
    if (!first || first <= ADWATCH_FROM || !inRange(first) || adsetLaunch.get(ad.adsetId) === first || campEvents.get(ad.campaignId)?.has(first)) continue;
    const k = `${ad.campaignId}|${first}`;
    const g = groups.get(k) ?? { camp: camps.get(ad.campaignId)!, date: first, ads: [] };
    g.ads.push(ad);
    groups.set(k, g);
  }
  for (const g of groups.values()) {
    const merged = { days: new Map<string, number>() };
    for (const ad of g.ads) for (const [d, s] of ad.days) merged.days.set(d, (merged.days.get(d) ?? 0) + s);
    const w = share(merged, after(g.date));
    if (w < MIN_WEIGHT || !g.camp) continue;
    const names = g.ads.map((a) => shortName(a.name));
    out.push({
      ...base(g.camp, g.date, "creative_launch", `${g.ads.length} new ad${g.ads.length > 1 ? "s" : ""} live in ${shortName(g.camp.name)}`, `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3} more` : ""} — ${formatPct(w)} of account spend in their first 7 days.`, w),
      id: `creative_launch:${g.camp.id}:${g.date}`,
    });
  }

  // Spend steps: a campaign's 3-day average from d vs its 7 days before (consistent with a budget edit; not proof).
  for (const c of camps.values()) {
    const ev = campEvents.get(c.id) ?? new Set<string>();
    for (const d of spine(from, to)) {
      if (addDays(d, 2) > last) break;
      const prior = spine(addDays(d, -7), addDays(d, -1)).map((x) => c.days.get(x) ?? 0);
      const next = spine(d, addDays(d, 2)).map((x) => c.days.get(x) ?? 0);
      if (prior.some((s) => s <= 0) || next.some((s) => s <= 0)) continue; // not live throughout: lifecycle events cover it
      if ([...ev].some((x) => Math.abs(daysBetween(x < d ? x : d, x < d ? d : x)) <= 3)) continue;
      const p = prior.reduce((a, b) => a + b, 0) / 7;
      const n = next.reduce((a, b) => a + b, 0) / 3;
      const step = n / p - 1;
      const first = next[0] / p - 1; // the change day itself must move too, so the step is dated on the day it happened
      const acctDay = acctSum(before(d)) / 7;
      if (Math.abs(step) < SPEND_STEP || Math.abs(first) < SPEND_STEP || Math.sign(first) !== Math.sign(step) || Math.max(p, n) < acctDay * 0.05) continue;
      const up = step > 0;
      const w = share(c, up ? after(d) : before(d));
      out.push(
        base(c, d, up ? "spend_up" : "spend_down", `Spend ${up ? "stepped up" : "cut"} ${formatPct(Math.abs(step), 0)}: ${shortName(c.name)}`,
          `${formatINR(p)}/day in the 7 days before → ${formatINR(n)}/day over ${span({ from: d, to: addDays(d, 2) })}. Consistent with a budget ${up ? "increase" : "cut"}; no source records the edit itself.`, w, true),
      );
      ev.add(d); // one step per campaign per week
      for (let k = 1; k <= 6; k++) ev.add(addDays(d, k));
    }
  }
  return out.sort((a, b) => (a.date === b.date ? b.weight - a.weight : a.date < b.date ? -1 : 1));
}

// ---------- Change log ----------

const META_WORDS = /\b(meta|facebook|campaign|ad ?set|creative|budget|bid|audience|targeting|lookalike|cbo|abo|cpi|cpm|ctr)\b/i;

export function expectedOutcome(r: ChangeLogRow): string | null {
  if (!r.primary_metric) return null;
  const dir = r.target_dir === "down" ? "down to" : r.target_dir === "up" ? "up to" : "at";
  return `${r.primary_metric} ${dir} ${r.target_value ?? "—"}${r.review_date ? ` by ${formatDateShort(r.review_date)}` : ""}`;
}

/**
 * Attach log entries to detected changes (same campaign named in the title / scope, within a day) and add the rest as
 * changes of their own. Entries that started before `from` are not listed but stay available as concurrent changes.
 */
export function mergeLog(detected: PerfChange[], log: readonly ChangeLogRow[], from: string, to: string): PerfChange[] {
  const out = detected.map((c) => ({ ...c }));
  for (const r of log) {
    if (r.start_date < from || r.start_date > to) continue;
    const text = `${r.title} ${r.scope ?? ""} ${r.type ?? ""}`.toLowerCase();
    const meta = META_WORDS.test(text);
    const who = r.owner ?? r.created_by;
    const hit = meta
      ? out.find((c) => c.logId === null && Math.abs(daysBetween(c.date < r.start_date ? c.date : r.start_date, c.date < r.start_date ? r.start_date : c.date)) <= 2 && c.campaignIds.some((id, i) => text.includes(id) || text.includes(c.campaigns[i].toLowerCase())))
      : undefined;
    const fields = { who, intent: r.hypothesis, expected: expectedOutcome(r), logId: r.id, logStatus: r.status, reviewDate: r.review_date };
    if (hit) Object.assign(hit, fields, { source: "Detected + logged" as const });
    else
      out.push({
        id: `logged:${r.id}`,
        date: r.start_date,
        kind: "logged",
        area: meta ? "Meta" : "CRM",
        title: r.title,
        evidence: `Logged in crm.change_log${r.type ? ` as “${r.type}”` : ""}${r.status ? ` · status ${r.status}` : ""}.`,
        campaignIds: [],
        campaigns: [],
        weight: 0,
        source: "Logged",
        inferred: false,
        ...fields,
      });
  }
  return out.sort((a, b) => (a.date === b.date ? b.weight - a.weight : a.date < b.date ? -1 : 1));
}

// ---------- Impact assessment ----------

export interface ImpactRow {
  key: ImpactKey;
  label: string;
  stage: ImpactStage;
  scope: "Affected campaigns" | "Account";
  format: ImpactMetric["format"];
  up: boolean;
  pre: number | null;
  post: number | null;
  change: number | null;
}

export type Verdict = "Positive" | "Negative" | "Mixed" | "Inconclusive" | "Too early";
export type Decision = "Retain" | "Reverse" | "Test" | "Wait";

export interface ChangeAssessment {
  change: PerfChange;
  pre: Win;
  post: Win;
  postDays: number;
  rows: ImpactRow[];
  verdict: Verdict;
  confidence: "High" | "Medium" | "Low";
  explanation: string[];
  uncertainties: string[];
  decision: Decision;
  action: string;
  owner: string;
  reviewBy: string;
  questions: string[];
}

/** 7 days from the change (to the last complete day) and the same number of days before it. */
export function impactWindows(date: string, last: string): { pre: Win; post: Win; days: number } {
  const postTo = addDays(date, 6) < last ? addDays(date, 6) : last;
  const days = postTo >= date ? daysBetween(date, postTo) : 0;
  return { pre: { from: addDays(date, -Math.max(days, 1)), to: addDays(date, -1) }, post: { from: date, to: postTo }, days };
}

const REDUCES = new Set<ChangeKind>(["campaign_pause", "adset_pause", "spend_down"]);
const LAUNCHES = new Set<ChangeKind>(["campaign_launch", "campaign_restart", "adset_launch", "creative_launch"]);

const pctTxt = (c: number | null) => (c === null ? "no comparison" : `${c > 0 ? "+" : c < 0 ? "−" : "±"}${formatPct(Math.abs(c), 0)}`);

function fmtVal(v: number | null, f: ImpactMetric["format"]) {
  if (v === null) return "—";
  return f === "pct" ? formatPct(v, 2) : f === "count" ? formatCount(Math.round(v)) : formatINR(v);
}

export function assessChange(
  change: PerfChange,
  x: ImpactInputs,
  af: { pre: AfWindow | null; post: AfWindow | null },
  all: readonly PerfChange[],
  log: readonly ChangeLogRow[],
  last: string,
): ChangeAssessment {
  const { pre, post, days } = impactWindows(change.date, last);
  const acctPre = impactValues(x, pre, af.pre);
  const acctPost = impactValues(x, post, af.post);
  const ids = new Set(change.campaignIds);
  const campPre = ids.size ? metaValues(x, pre, ids) : null;
  const campPost = ids.size ? metaValues(x, post, ids) : null;

  const rows: ImpactRow[] = [];
  for (const m of IMPACT_METRICS) {
    if (m.meta && campPre && campPost) {
      const a = campPre[m.key as keyof typeof campPre];
      const b = campPost[m.key as keyof typeof campPost];
      rows.push({ key: m.key, label: m.label, stage: m.stage, scope: "Affected campaigns", format: m.format, up: m.up, pre: a, post: b, change: chg(b, a) });
    }
    rows.push({ key: m.key, label: m.label, stage: m.stage, scope: "Account", format: m.format, up: m.up, pre: acctPre[m.key], post: acctPost[m.key], change: chg(acctPost[m.key], acctPre[m.key]) });
  }
  const row = (k: ImpactKey, scope: ImpactRow["scope"] = "Account") => rows.find((r) => r.key === k && r.scope === scope);
  const meta = (k: ImpactKey) => row(k, campPre ? "Affected campaigns" : "Account");

  // ----- Uncertainties (each one lowers confidence) -----
  const unc: string[] = [];
  let penalty = 0;
  const flag = (text: string, weight = 1) => {
    unc.push(text);
    penalty += weight;
  };
  if (days < 3) flag(`Only ${days} day${days === 1 ? "" : "s"} of data after the change — too early to judge.`, 2);
  else if (days < 7) flag(`Only ${days} of 7 days after the change are complete; figures will move.`);
  if (LAUNCHES.has(change.kind) && change.kind !== "creative_launch") flag("Meta learning phase: delivery and CPI are usually unstable for the first ~7 days (or until ~50 optimisation events).");
  const window = { from: pre.from, to: post.to };
  const others = all.filter((c) => c.id !== change.id && c.date >= window.from && c.date <= window.to && (c.area === "CRM" || c.weight >= 0.05));
  if (others.length)
    flag(`${others.length} other change${others.length > 1 ? "s" : ""} in the same window: ${others.slice(0, 3).map((c) => `${c.title} (${formatDateShort(c.date)})`).join("; ")}${others.length > 3 ? "; …" : ""}.`, others.length > 2 ? 2 : 1);
  const crmOpen = log.filter((r) => !META_WORDS.test(`${r.title} ${r.scope ?? ""} ${r.type ?? ""}`) && r.start_date < pre.from && (r.closed_at === null || r.closed_at.slice(0, 10) >= pre.from));
  if (crmOpen.length) flag(`CRM change${crmOpen.length > 1 ? "s" : ""} running throughout (moves leads and New Sales, not Meta): ${crmOpen.map((r) => `${r.title} (from ${formatDateShort(r.start_date)})`).join("; ")}.`);
  if (pre.from < AF_COVERAGE_FROM) flag(`The before-window starts before AppsFlyer data (${formatDateShort(AF_COVERAGE_FROM)}): add-to-cart change is unavailable.`);
  const salesPost = acctPost.new_sales ?? 0;
  if (salesPost < 30) flag(`Only ${salesPost} New Sales after the change — a single day can swing the percentages.`);
  if (change.area === "Meta" && change.weight > 0 && change.weight < 0.05) flag(`Touches only ${formatPct(change.weight)} of account spend, so account-level funnel and sales mostly reflect other campaigns.`);
  if (change.inferred) unc.push("Inferred from spend: no readable source records budget edits (Meta activity log stopped 7 Jul 2026). It may be Meta pacing, a bid / cost cap or a budget edit.");
  if (change.logId === null) unc.push("Not in crm.change_log: who made it, why and the expected outcome are unknown.");
  if (change.area === "Meta") unc.push("New Sales and funnel steps are account totals — Meta receives no purchase events, so they cannot be attributed to this campaign.");

  // ----- Verdict -----
  const cac = row("cac")?.change ?? null;
  const sales = row("new_sales")?.change ?? null;
  const cpi = meta("cpi")?.change ?? null;
  let verdict: Verdict;
  if (change.area === "CRM") {
    const leadsFresh = row("leads_fresh")?.change ?? null;
    verdict = days < 3 ? "Too early" : sales === null ? "Inconclusive" : sales >= 0.05 ? "Positive" : sales <= -0.1 ? "Negative" : leadsFresh !== null && leadsFresh > 0.1 && sales < 0.02 ? "Mixed" : "Inconclusive";
  } else if (days < 3) verdict = "Too early";
  else {
    const pos = cac !== null && cac <= -0.05 && (sales ?? 0) >= -0.02;
    const neg = (cac !== null && cac >= 0.1) || (sales !== null && sales <= -0.1 && !REDUCES.has(change.kind));
    if (pos && !neg) verdict = "Positive";
    else if (neg && !pos) verdict = "Negative";
    else if (cpi !== null && cac !== null && Math.abs(cpi) >= 0.05 && Math.abs(cac) >= 0.05 && Math.sign(cpi) !== Math.sign(cac)) verdict = "Mixed";
    else verdict = "Inconclusive";
  }
  const score = 3 - penalty;
  const confidence = score >= 3 ? "High" : score >= 1 ? "Medium" : "Low";

  // ----- Explanation -----
  const exp: string[] = [];
  const scope = campPre ? (change.campaigns.length === 1 ? change.campaigns[0] : "Affected campaigns") : "Account";
  const sp = meta("spend");
  if (change.area === "Meta" && sp)
    exp.push(
      `Meta · ${scope}: spend ${fmtVal(sp.pre, "inr")} → ${fmtVal(sp.post, "inr")} (${pctTxt(sp.change)}), impressions ${pctTxt(meta("impressions")?.change ?? null)}, CPM ${fmtVal(meta("cpm")?.post ?? null, "inr_precise")} (${pctTxt(meta("cpm")?.change ?? null)}), CTR ${fmtVal(meta("ctr")?.post ?? null, "pct")} (${pctTxt(meta("ctr")?.change ?? null)}), installs ${pctTxt(meta("installs")?.change ?? null)}, CPI ${fmtVal(meta("cpi")?.post ?? null, "inr_precise")} (${pctTxt(cpi)}).`,
    );
  exp.push(
    `App funnel · account: Meta-user add to carts ${pctTxt(row("atc")?.change ?? null)}, Fresh add to carts ${fmtVal(acctPre.atc_fresh, "count")} → ${fmtVal(acctPost.atc_fresh, "count")} (${pctTxt(row("atc_fresh")?.change ?? null)}); abandoned-cart leads ${pctTxt(row("leads")?.change ?? null)} (Fresh ${pctTxt(row("leads_fresh")?.change ?? null)}).`,
  );
  exp.push(
    `New Sales · account: ${fmtVal(acctPre.new_sales, "count")} → ${fmtVal(acctPost.new_sales, "count")} (${pctTxt(sales)}) — APP ${pctTxt(row("sales_app")?.change ?? null)}, WEB ${pctTxt(row("sales_web")?.change ?? null)}; AOV ${fmtVal(acctPost.aov, "inr")} (${pctTxt(row("aov")?.change ?? null)}); revenue ${pctTxt(row("revenue")?.change ?? null)}; CAC ${fmtVal(acctPre.cac, "inr")} → ${fmtVal(acctPost.cac, "inr")} (${pctTxt(cac)}).`,
  );
  const READ: Record<Verdict, string> = {
    Positive: REDUCES.has(change.kind)
      ? "Read: after the cut, CAC fell without losing New Sales — consistent with removing inefficient spend."
      : "Read: CAC improved while New Sales held or grew — consistent with the change helping, though not proof of cause.",
    Negative: REDUCES.has(change.kind) ? "Read: after the cut, CAC rose — the removed spend may have been driving sales." : "Read: CAC rose or New Sales fell after the change — the extra spend is not yet converting into new customers.",
    Mixed: "Read: Meta efficiency (CPI) and business efficiency (CAC) moved in opposite directions — cheaper installs are not turning into New Sales, or the reverse.",
    Inconclusive: "Read: no clear movement beyond normal day-to-day noise.",
    "Too early": "Read: too few days after the change to judge.",
  };
  exp.push(READ[verdict]);

  // ----- Action -----
  const owner = change.who ?? (change.area === "CRM" ? "CRM team (unassigned)" : "Performance Marketing (unassigned)");
  const reviewBy = change.reviewDate ?? addDays(change.date, 14);
  const cacCap = acctPre.cac !== null ? formatINR(acctPre.cac * 1.1) : "10% above the before-window";
  let decision: Decision;
  let action: string;
  if (verdict === "Too early") {
    decision = "Wait";
    action = `Let it run to 7 full days (until ${formatDateShort(addDays(change.date, 6))}) without further edits to the same campaign, then re-check CPI and CAC.`;
  } else if (verdict === "Positive") {
    decision = confidence === "Low" ? "Test" : "Retain";
    action =
      confidence === "Low"
        ? "Looks positive but confounded: keep it, and confirm with a holdout (pause one comparable ad set or geo for 7 days) before scaling."
        : REDUCES.has(change.kind)
          ? "Retain the cut. Move the freed budget to the campaign with the lowest CAC, in steps of ≤ 20%."
          : `Retain. Scale in steps of ≤ 20% budget every 3–4 days while CAC stays below ${cacCap}.`;
  } else if (verdict === "Negative") {
    decision = confidence === "Low" ? "Test" : "Reverse";
    action =
      confidence === "Low"
        ? `Test before reversing: other changes overlap. Hold it 7 more days with a stop rule — reverse if CAC stays above ${cacCap}.`
        : REDUCES.has(change.kind)
          ? "Reverse: restore the paused campaign / previous budget at its last good level, and re-check CAC after 7 days."
          : "Reverse: return the budget to its previous level or pause the weakest ad sets; keep the best-CPI ads.";
  } else {
    decision = "Test";
    action = `Keep it as a test with a clear stop rule: reverse if CAC is above ${cacCap} after 7 full days; scale if it is 10% below.`;
  }

  // ----- Questions for Performance Marketing -----
  const q: string[] = [];
  if (change.logId === null) q.push(`Who made this change and why? Please log it in crm.change_log with the expected outcome and a review date.`);
  switch (change.kind) {
    case "campaign_launch":
    case "adset_launch":
      q.push("Which audience and optimisation event is it set to (installs, an in-app event such as add to cart / purchase, or value)? Is it built to find new customers?");
      q.push("What daily budget and learning-phase plan does it have, and which CPI / CAC ends the test?");
      break;
    case "campaign_restart":
      q.push("What changed before restarting it (creative, audience, budget, objective)?");
      break;
    case "creative_launch":
      q.push("Which hypothesis do these creatives test (hook, format, offer, language), and which ads do they replace?");
      break;
    case "campaign_pause":
    case "adset_pause":
      q.push("Why was it paused (CPI, CAC, fatigue, budget)? Which campaign absorbed its budget?");
      break;
    case "spend_up":
      q.push("Was the spend increase a deliberate budget edit? What CAC ceiling triggers a rollback?");
      break;
    case "spend_down":
      q.push("Was the drop a budget cut, a bid / cost cap, or Meta under-delivering?");
      break;
    case "logged":
      if (change.area === "CRM") q.push("Should Meta budgets change while this CRM change runs, given it moves leads and New Sales on its own?");
      break;
  }
  if (verdict === "Negative") q.push("Reverse now, or give it more days — and what evidence would change the call?");
  if (verdict === "Positive" && change.area === "Meta") q.push("Can the budget be scaled without CAC rising, and from which campaign should it come?");
  if (verdict === "Mixed") q.push("Installs got cheaper but customers did not (or the reverse) — is the audience quality right for new customers?");

  return { change, pre, post, postDays: days, rows, verdict, confidence, explanation: exp, uncertainties: unc, decision, action, owner, reviewBy, questions: q };
}

// ---------- Strategic questions for Performance Marketing ----------

export interface ThemeQuestion {
  theme: "Strategy" | "Audience quality" | "Budgets" | "Targeting" | "Optimisation objectives" | "Retain, reverse or test";
  question: string;
  evidence: string;
}

export function strategicQuestions(
  x: ImpactInputs,
  range: Win,
  cur: ImpactValues,
  prev: ImpactValues,
  afInstalls: number | null,
  assessments: readonly ChangeAssessment[],
): ThemeQuestion[] {
  const out: ThemeQuestion[] = [];
  const unlogged = assessments.filter((a) => a.change.area === "Meta" && a.change.logId === null).length;
  const meta = assessments.filter((a) => a.change.area === "Meta").length;
  out.push({
    theme: "Strategy",
    question: "What is the plan for the next two weeks — scale, consolidate or test — and which KPI decides: CAC per New Sale, CPI or Fresh add to carts?",
    evidence: `${meta} Meta change${meta === 1 ? "" : "s"} in ${span(range)}, ${unlogged} not logged. CAC ${fmtVal(prev.cac, "inr")} → ${fmtVal(cur.cac, "inr")} (${pctTxt(chg(cur.cac, prev.cac))}) vs the previous period.`,
  });
  const rate = (v: ImpactValues) => div(v.atc_fresh, v.installs);
  const r1 = rate(cur);
  const r0 = rate(prev);
  out.push({
    theme: "Audience quality",
    question: "Are campaigns reaching new customers, or re-acquiring existing ones? Should existing customers be excluded from prospecting?",
    evidence:
      r1 === null
        ? "Fresh add to carts per Meta install is not available for this range (AppsFlyer starts 6 Oct 2026)."
        : `Fresh add to carts per Meta install: ${formatPct(r1)}${r0 !== null ? ` (previous period ${formatPct(r0)})` : ""}.`,
  });
  const camp = new Map<string, { name: string; spend: number; installs: number }>();
  for (const r of x.history) {
    if (r.date < range.from || r.date > range.to) continue;
    const c = camp.get(r.campaign_id) ?? { name: r.campaign_name ?? r.campaign_id, spend: 0, installs: 0 };
    c.spend += r.spend;
    c.installs += r.installs;
    camp.set(r.campaign_id, c);
  }
  const ranked = [...camp.values()].sort((a, b) => b.spend - a.spend);
  const total = ranked.reduce((a, c) => a + c.spend, 0);
  if (ranked.length && total) {
    const top = ranked[0];
    const best = ranked.filter((c) => c.installs >= 20).sort((a, b) => a.spend / a.installs - b.spend / b.installs)[0];
    out.push({
      theme: "Budgets",
      question: "Is the split of budget across campaigns intended? What are the daily caps and the CAC ceiling per campaign?",
      evidence: `${shortName(top.name)} takes ${formatPct(top.spend / total)} of spend${best ? `; lowest CPI is ${shortName(best.name)} at ${formatINR(best.spend / best.installs)}` : ""}.`,
    });
  }
  out.push({
    theme: "Targeting",
    question: "Which geographies, ages and interests is each campaign targeting? Should budgets follow the regions where New Sales come from (Priority Mumbai, Tier 1)?",
    evidence: `New Sales in the range: ${fmtVal(cur.new_sales, "count")} (APP ${fmtVal(cur.sales_app, "count")}, WEB ${fmtVal(cur.sales_web, "count")}). Regional split is on Regional Analysis; Meta placement / geo breakdowns are not collected.`,
  });
  out.push({
    theme: "Optimisation objectives",
    question: "Campaigns optimise for installs, but the business needs New Sales. Can campaigns optimise for an in-app event (add to cart / first purchase) sent from AppsFlyer?",
    evidence: `Meta reports ${fmtVal(cur.installs, "count")} installs${afInstalls !== null ? ` vs ${formatCount(afInstalls)} Meta-attributed installs in AppsFlyer` : ""}; Meta receives no purchase or add-to-cart events.`,
  });
  const by = (d: Decision) => assessments.filter((a) => a.decision === d).length;
  out.push({
    theme: "Retain, reverse or test",
    question: "Confirm the decision for each change in the action log, and agree a stop rule and date for every test.",
    evidence: `Suggested: retain ${by("Retain")}, reverse ${by("Reverse")}, test ${by("Test")}, wait ${by("Wait")}.`,
  });
  return out;
}
