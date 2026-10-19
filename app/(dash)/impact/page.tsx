import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { ChangeImpactList } from "@/components/impact/ChangeImpactList";
import { PeriodMatrix, matrixWindows, type MatrixRow } from "@/components/kpi/PeriodMatrix";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getCampaignReach, getChangeLog } from "@/lib/data/changeImpact";
import { getCartLeadsDaily } from "@/lib/data/cartLeads";
import { getSourceFreshness } from "@/lib/data/freshness";
import { getMetaAdHistory, getMetaAf } from "@/lib/data/metaAds";
import { getOrdersDaily } from "@/lib/data/orders";
import { cn } from "@/lib/cn";
import { addDays, daysBetween, formatDate, formatDateShort, formatDateTimeIST, todayIST } from "@/lib/format/ist";
import {
  IMPACT_METRICS,
  KIND_LABEL,
  assessChange,
  detectChanges,
  impactValues,
  impactWindows,
  mergeLog,
  strategicQuestions,
  type ImpactInputs,
  type Verdict,
} from "@/lib/metrics/changeImpact";
import { ADWATCH_FROM, AF_COVERAGE_FROM, compareWindows } from "@/lib/metrics/metaIntel";
import { dateSpine } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";
import type { DataResult } from "@/lib/types/result";
import type { MetaAfRow } from "@/lib/types/schemas";

export const metadata: Metadata = { title: "Perf Change Impact" };

const LOG_COLUMNS: TableColumn[] = [
  { key: "date", label: "Date", format: "date" },
  { key: "change", label: "What changed", format: "text" },
  { key: "type", label: "Type", format: "text" },
  { key: "campaigns", label: "Affected campaigns", format: "text" },
  { key: "who", label: "Who", format: "text" },
  { key: "intent", label: "Strategic intent", format: "text" },
  { key: "expected", label: "Expected outcome", format: "text" },
  { key: "source", label: "Source", format: "text", hint: "Detected = visible in Meta delivery data. Logged = from crm.change_log." },
  { key: "verdict", label: "Verdict", format: "text" },
  { key: "decision", label: "Action", format: "text" },
];

const ACTION_COLUMNS: TableColumn[] = [
  { key: "date", label: "Change date", format: "date" },
  { key: "change", label: "Change", format: "text" },
  { key: "decision", label: "Decision", format: "text" },
  { key: "action", label: "Recommended action", format: "text" },
  { key: "owner", label: "Owner", format: "text" },
  { key: "review", label: "Review by", format: "date" },
  { key: "confidence", label: "Confidence", format: "text" },
];

const DAILY_COLUMNS: TableColumn[] = [
  { key: "date", label: "Date", format: "date" },
  { key: "changes", label: "Changes that day", format: "text" },
  ...IMPACT_METRICS.map((m): TableColumn => ({ key: m.key, label: m.label, format: m.format, hint: m.sub })),
];

const THEME_ORDER = ["Strategy", "Audience quality", "Budgets", "Targeting", "Optimisation objectives", "Retain, reverse or test"];

/** Rows when the source answered (empty = no rows), null when it is not connected or failed. */
const rowsOf = <T,>(r: DataResult<T[]>): T[] | null => (r.state === "ok" ? r.data : r.state === "empty" ? [] : null);

export default async function ImpactPage({ searchParams }: PageProps<"/impact">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const today = todayIST();
  const last = addDays(today, -1); // last complete day: impact windows never include today
  const periods = compareWindows(range, today);
  const dataFrom = [addDays(range.from, -14), previous.from, ...periods.map((p) => p.cmpFrom)].reduce((a, b) => (b < a ? b : a));

  // Meta-attributed AppsFlyer counts before / after each change and for each comparison period. Every change is dated
  // inside the range, so for ranges up to ~2 months the windows of every date are requested up front, in parallel with
  // the other reads; longer ranges wait for the detected change dates to keep the per-window counting cheap.
  const dateKey = (d: string) => `d${d.replaceAll("-", "")}`;
  const changeWindows = (dates: readonly string[]) =>
    [...new Set(dates)].flatMap((d) => {
      const w = impactWindows(d, last);
      return [{ id: `${dateKey(d)}_pre`, ...w.pre }, ...(w.days ? [{ id: `${dateKey(d)}_post`, ...w.post }] : [])];
    });
  const periodWindows = periods.flatMap((p) => [{ id: `p_${p.id}_cur`, from: p.from, to: p.to }, { id: `p_${p.id}_cmp`, from: p.cmpFrom, to: p.cmpTo }]);
  const covered = <W extends { to: string }>(ws: W[]) => ws.filter((w) => w.to >= AF_COVERAGE_FROM);
  const upFront = daysBetween(range.from, range.to) <= 62;
  const afEarly = upFront ? getMetaAf(range, covered([...changeWindows(dateSpine(range.from, range.to)), ...periodWindows])) : null;

  const [history, reach, orders, leads, log, freshness] = await Promise.all([
    getMetaAdHistory(today),
    getCampaignReach({ from: dataFrom, to: today }),
    getOrdersDaily({ from: dataFrom, to: today }),
    getCartLeadsDaily({ from: dataFrom, to: today }),
    getChangeLog(range),
    getSourceFreshness(),
  ]);
  const x: ImpactInputs = { history: rowsOf(history) ?? [], reach: rowsOf(reach), leads: rowsOf(leads), orders: rowsOf(orders) };
  const logRows = rowsOf(log) ?? [];

  // ---------- Changes: detected from delivery data + crm.change_log ----------
  const detectTo = range.to < last ? range.to : last;
  const detected = history.state === "ok" && range.from <= detectTo ? detectChanges(x.history, range.from, detectTo, last) : [];
  const changes = mergeLog(detected, logRows, range.from, range.to);

  const af = await (afEarly ?? getMetaAf(range, covered([...changeWindows(changes.map((c) => c.date)), ...periodWindows])));
  const afRows: MetaAfRow[] = af.state === "ok" ? af.data : [];
  const afWin = (id: string) => afRows.find((r) => r.level === "window" && r.key === id) ?? null;
  const afDay = (d: string) => (af.state === "ok" || af.state === "empty" ? (afRows.find((r) => r.level === "day" && r.key === d) ?? { installs: 0, atc: 0, atc_fresh: 0, checkout_fresh: 0, fresh_orders: 0, fresh_orders_app: 0, fresh_customers: 0, atc_fresh_buyers: 0 }) : null);

  const assessments = changes.map((c) => assessChange(c, x, { pre: afWin(`${dateKey(c.date)}_pre`), post: afWin(`${dateKey(c.date)}_post`) }, changes, logRows, last));
  const latestFirst = [...assessments].sort((a, b) => (a.change.date === b.change.date ? b.change.weight - a.change.weight : a.change.date < b.change.date ? 1 : -1));

  // ---------- Period scoreboard ----------
  const vals = periods.map((p) => ({ cur: impactValues(x, p, afWin(`p_${p.id}_cur`)), cmp: impactValues(x, { from: p.cmpFrom, to: p.cmpTo }, afWin(`p_${p.id}_cmp`)) }));
  const metaKeys = new Set(IMPACT_METRICS.filter((m) => m.stage === "Meta").map((m) => m.key));
  const afKeys = new Set(["atc", "atc_fresh"]);
  const scoreRows: MatrixRow[] = IMPACT_METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    sub: m.sub,
    group: m.stage,
    format: m.format,
    up: m.up,
    cells: periods.map((p, i) => {
      const noCmp =
        p.id === "today" && !m.rate
          ? "day in progress"
          : afKeys.has(m.key) && p.cmpFrom < AF_COVERAGE_FROM
            ? "before AppsFlyer data"
            : (metaKeys.has(m.key) || m.key === "cac") && p.cmpFrom < ADWATCH_FROM && !m.rate
              ? "before Meta data"
              : null;
      return { value: vals[i].cur[m.key], cmp: vals[i].cmp[m.key], noCmp };
    }),
  }));

  // ---------- Daily tracker ----------
  const dailyRows = dateSpine(range.from, range.to)
    .reverse()
    .map((d) => {
      const v = impactValues(x, { from: d, to: d }, afDay(d));
      const cs = changes.filter((c) => c.date === d);
      return { date: d, changes: cs.length ? cs.map((c) => c.title).join(" · ") : "", ...v };
    });

  // ---------- Logs ----------
  const logTable = latestFirst.map((a) => ({
    date: a.change.date,
    change: a.change.title,
    type: KIND_LABEL[a.change.kind],
    campaigns: a.change.campaigns.join(", ") || (a.change.area === "CRM" ? "— (CRM)" : "Account"),
    who: a.change.who ?? "Not logged",
    intent: a.change.intent ?? "Not logged",
    expected: a.change.expected ?? "Not logged",
    source: a.change.source,
    verdict: `${a.verdict} (${a.confidence.toLowerCase()})`,
    decision: a.decision,
  }));
  const actions = latestFirst.map((a) => ({ date: a.change.date, change: a.change.title, decision: a.decision, action: a.action, owner: a.owner, review: a.reviewBy, confidence: a.confidence }));
  const sel = periods.findIndex((p) => p.id === "range");
  const themes = strategicQuestions(x, range, vals[sel].cur, vals[sel].cmp, afWin("p_range_cur")?.installs ?? null, assessments);

  const counts = (v: Verdict) => assessments.filter((a) => a.verdict === v).length;
  const unlogged = assessments.filter((a) => a.change.area === "Meta" && a.change.logId === null).length;
  const fresh = freshness.state === "ok" ? freshness.data.filter((r) => ["meta_ad_daily", "af_events", "crm_cart_leads", "orders"].includes(r.source)) : [];
  const FRESH_LABEL: Record<string, string> = { meta_ad_daily: "Meta", af_events: "AppsFlyer", crm_cart_leads: "CRM leads", orders: "Orders" };
  const sources = ["meta_ad_daily", "meta_campaign_check", "af_events", "crm_cart_leads", "orders", "crm_change_log"] as const;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Perf Change Impact Analysis"
        description="Every Meta change — launches, pauses, budget shifts, new creatives — and every logged change, connected to Meta delivery → app funnel → New Sales: what changed, who and why, the before / after impact, how sure we can be, and what to do next."
        range={range}
        sources={[...sources]}
      />

      <Callout>
        Updates daily from live data{fresh.length ? ": " : "."}
        {fresh.map((r, i) => (
          <span key={r.source}>
            {i ? " · " : ""}
            {FRESH_LABEL[r.source]} to <strong className="tabular-nums">{r.latest_data_date ? formatDateShort(r.latest_data_date) : "—"}</strong>
          </span>
        ))}
        {freshness.state === "ok" ? ` (checked ${formatDateTimeIST(new Date())})` : ""}. Use the date picker to choose which changes to analyse: changes dated in the range are listed, and each is
        measured over the 7 days after it vs the same number of days before. Who, intent and expected outcome come from <code>crm.change_log</code> — Meta&rsquo;s own activity log
        stopped loading on 7 Jul 2026, so unlogged changes show “Not logged”.
      </Callout>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: "Changes in range", value: assessments.length, sub: `${assessments.filter((a) => a.change.area === "Meta").length} Meta · ${assessments.filter((a) => a.change.area === "CRM").length} CRM` },
          { label: "Not logged", value: unlogged, sub: "Meta changes with no owner / intent", tone: unlogged ? "text-critical" : "text-ink" },
          { label: "Positive", value: counts("Positive"), sub: "CAC down, New Sales held", tone: "text-good" },
          { label: "Negative", value: counts("Negative"), sub: "CAC up or New Sales down", tone: "text-critical" },
          { label: "Mixed / inconclusive", value: counts("Mixed") + counts("Inconclusive"), sub: "needs a test or more days" },
          { label: "Too early", value: counts("Too early"), sub: "< 3 days after the change" },
        ].map((t) => (
          <div key={t.label} className="min-w-0 rounded-lg border border-line bg-surface-1 p-3">
            <p className="truncate text-xs font-medium text-ink-2">{t.label}</p>
            <p className={cn("tabular mt-1 text-2xl font-semibold", t.tone ?? "text-ink")}>{t.value}</p>
            <p className="truncate text-[11px] text-ink-3">{t.sub}</p>
          </div>
        ))}
      </section>

      <ChartCard
        title="Scoreboard by period: Meta → App funnel → New Sales"
        question="Today vs yesterday vs last 7 days vs month to date, and the selected range. Each cell: value, then change vs that period's own comparison (hover a column heading for it)."
        result={history}
        footnote={`Reach = Meta campaign-day reach averaged per day and summed across campaigns (people reached by two campaigns count twice; about one day behind). Add to carts = Meta-attributed AppsFlyer users (from ${formatDate(AF_COVERAGE_FROM)}); Fresh = no completed order before their first add to cart. Leads = CRM abandoned-cart leads, all sources. New Sales = eligible Fresh orders, all channels. CAC = all Meta spend ÷ New Sales (blended). Last 7 days and MTD are complete days ending yesterday.`}
      >
        <PeriodMatrix windows={matrixWindows(periods)} rows={scoreRows} />
      </ChartCard>

      <ChartCard
        title="Change log"
        question="What changed, when, who, which campaigns, the intent and the expected outcome — newest first."
        result={history}
        footnote={`Detected from delivery data (adwatch, from ${formatDate(ADWATCH_FROM)}): campaign and ad set launches, pauses (≥ 2 days without spend) and restarts; new ads first delivering; and ±40% steps in a campaign's 3-day average spend vs its prior 7 days (shown as inferred budget changes). Only changes touching ≥ 2% of account spend are listed. Logged entries are matched to a detected change of the same campaign within 2 days.`}
      >
        <DataTable columns={LOG_COLUMNS} rows={logTable} pageSize={10} exportName={`perf-change-log-${range.from}-${range.to}`} />
      </ChartCard>

      <ChartCard
        title="Impact of each change — before vs after"
        question="Expand a change for its before / after table from Meta to New Sales, what it means, what is uncertain, the recommended action and questions for Performance Marketing."
        result={history}
        footnote="Verdict: Positive = CAC (Meta spend ÷ New Sales) down ≥ 5% with New Sales held; Negative = CAC up ≥ 10% or New Sales down ≥ 10%; Mixed = CPI and CAC moved in opposite directions. Confidence drops for overlapping changes, fewer than 7 days after, small order counts, learning phase or missing AppsFlyer data. A verdict is evidence for a decision, not proof of cause."
      >
        <ChangeImpactList items={latestFirst} />
      </ChartCard>

      <ChartCard title="Action log" question="Recommended action per change, its owner and review date. Owners come from crm.change_log; unlogged changes default to Performance Marketing." result={history}>
        <DataTable columns={ACTION_COLUMNS} rows={actions} pageSize={10} searchable={false} exportName={`perf-change-actions-${range.from}-${range.to}`} />
      </ChartCard>

      <ChartCard title="Questions for Performance Marketing" question="Strategy, audience quality, budgets, targeting, optimisation objectives — and whether to retain, reverse or test. Change-specific questions are inside each change above." result={history}>
        <ol className="divide-y divide-line">
          {themes
            .sort((a, b) => THEME_ORDER.indexOf(a.theme) - THEME_ORDER.indexOf(b.theme))
            .map((t, i) => (
              <li key={t.theme} className="grid gap-1 py-2.5 sm:grid-cols-[180px_1fr] sm:gap-4">
                <p className="text-xs font-semibold text-ink">
                  <span className="mr-1.5 tabular-nums text-ink-3">{i + 1}</span>
                  {t.theme}
                </p>
                <div className="min-w-0">
                  <p className="text-sm text-ink">{t.question}</p>
                  <p className="mt-0.5 text-xs text-ink-2">{t.evidence}</p>
                </div>
              </li>
            ))}
        </ol>
      </ChartCard>

      <ChartCard
        title="Daily tracker"
        question="Every metric, day by day, with the changes made that day. Newest first; today is in progress."
        result={history}
        footnote="Daily add to carts are distinct per day (not additive into the period figures above). Reach is the sum of campaign-day reach."
      >
        <DataTable columns={DAILY_COLUMNS} rows={dailyRows} pageSize={14} searchable={false} exportName={`perf-daily-${range.from}-${range.to}`} />
      </ChartCard>

      <SourceNotes sources={[...sources]} />
    </div>
  );
}
