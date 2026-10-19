import type { Metadata } from "next";
import { CategoryBars } from "@/components/charts/CategoryBars";
import { ChartCard } from "@/components/charts/ChartCard";
import { FunnelChart } from "@/components/charts/FunnelChart";
import { TrendChart } from "@/components/charts/TrendChart";
import { InsightPanel } from "@/components/insights/InsightPanel";
import { PeriodMatrix, matrixWindows } from "@/components/kpi/PeriodMatrix";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getAfEventsDaily } from "@/lib/data/afEvents";
import { getCartLeadsDaily } from "@/lib/data/cartLeads";
import { loadFunnelSnapshot } from "@/lib/data/funnelSnapshot";
import { loadGrowthContext } from "@/lib/data/growth";
import { AF_COVERAGE_FROM, buildStages, weakestStage, type StageView } from "@/lib/metrics/funnel";
import { formatDate } from "@/lib/format/ist";
import { summarizeCartLeads } from "@/lib/metrics/compute";
import { dateSpine } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "App Funnel" };

const STAGE_COLUMNS: TableColumn[] = [
  { key: "label", label: "Stage", format: "text" },
  { key: "value", label: "Volume", format: "count" },
  { key: "conv_prev", label: "Conv. from previous", format: "pct" },
  { key: "drop", label: "Drop-off", format: "count" },
  { key: "drop_rate", label: "Drop-off rate", format: "pct" },
  { key: "prev", label: "Previous period", format: "count" },
  { key: "change", label: "Change", format: "pct" },
  { key: "conv_prev_period", label: "Prev. conv.", format: "pct" },
];

const OUTCOME_COLUMNS: TableColumn[] = [
  { key: "measure", label: "Measure", format: "text" },
  { key: "source", label: "Source", format: "text" },
  { key: "kind", label: "Type", format: "text" },
  { key: "value", label: "Count", format: "count" },
  { key: "definition", label: "Definition", format: "text" },
];

const stageRows = (s: StageView[]) => s.map((x) => ({ ...x, label: x.derived ? `${x.label} (derived)` : x.label, note: x.note ?? null, derived: x.derived ? 1 : 0 }));

const AF_TREND_EVENTS: { key: string; event: string; label: string; color: "app" | "web" | "web_other" | "tier_4" | "tier_5" }[] = [
  { key: "install", event: "install", label: "Installs", color: "app" },
  { key: "atc", event: "af_add_to_cart", label: "Add to cart", color: "web" },
  { key: "checkout", event: "af_initiated_checkout", label: "Checkout initiated", color: "tier_4" },
  { key: "failed", event: "Payment_failed", label: "Payment failed", color: "tier_5" },
  { key: "first", event: "First_Purchase", label: "First purchase", color: "web_other" },
];

export default async function FunnelPage({ searchParams }: PageProps<"/funnel">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const [ctx, afDaily, leads, leadsPrev, snapshot] = await Promise.all([
    loadGrowthContext(range, previous),
    getAfEventsDaily(range),
    getCartLeadsDaily(range),
    getCartLeadsDaily(previous),
    loadFunnelSnapshot(range),
  ]);
  const snapshotPartial = snapshot.windows.filter((w) => w.from < AF_COVERAGE_FROM).map((w) => w.short);
  const { af, ga4Funnel, sales } = ctx;

  // Daily distinct devices per key AppsFlyer event (summed across media-source groups; a device has one attribution).
  const byDay = new Map<string, Record<string, number>>();
  if (afDaily.state === "ok") {
    for (const r of afDaily.data) {
      const t = AF_TREND_EVENTS.find((e) => e.event === r.event_name);
      if (!t) continue;
      const d = byDay.get(r.event_date) ?? {};
      d[t.key] = (d[t.key] ?? 0) + r.unique_devices;
      byDay.set(r.event_date, d);
    }
  }
  const afTrend = afDaily.state === "ok" ? dateSpine(range.from, range.to).map((date) => ({ date, ...Object.fromEntries(AF_TREND_EVENTS.map((e) => [e.key, byDay.get(date)?.[e.key] ?? 0])) })) : [];

  const ga4Daily = new Map<string, { first_open: number; added_to_cart: number; began_checkout: number; first_purchase: number }>();
  if (ctx.ga4.state === "ok") {
    for (const r of ctx.ga4.data) {
      const c = ga4Daily.get(r.day) ?? { first_open: 0, added_to_cart: 0, began_checkout: 0, first_purchase: 0 };
      c.first_open += r.first_open;
      c.added_to_cart += r.added_to_cart;
      c.began_checkout += r.began_checkout;
      c.first_purchase += r.first_purchase;
      ga4Daily.set(r.day, c);
    }
  }
  const ga4Trend = ctx.ga4.state === "ok" ? dateSpine(range.from, range.to).map((date) => ({ date, ...(ga4Daily.get(date) ?? { first_open: null, added_to_cart: null, began_checkout: null, first_purchase: null }) })) : [];

  // Paid-user funnel: AppsFlyer installs → AppsFlyer add to cart → CRM Fresh abandoned-cart leads → New Sales (APP + WEB).
  // Four sources counted separately; the later stages are not subsets of the earlier ones (see footnote).
  const afStage = (k: string) => af?.stages.find((s) => s.key === k);
  const freshLeads = leads.state === "ok" ? summarizeCartLeads(leads.data).fresh : null;
  const freshLeadsPrev = leadsPrev.state === "ok" && af?.comparable ? summarizeCartLeads(leadsPrev.data).fresh : null;
  const paidFunnel = af
    ? buildStages([
        { key: "install", label: "Installs (AppsFlyer)", value: afStage("install")?.value ?? null, prev: afStage("install")?.prev ?? null, note: "Distinct devices, paid users only." },
        { key: "af_add_to_cart", label: "Add to cart (AppsFlyer)", value: afStage("af_add_to_cart")?.value ?? null, prev: afStage("af_add_to_cart")?.prev ?? null, note: "Distinct devices firing af_add_to_cart, paid users only." },
        { key: "fresh_leads", label: "Fresh abandoned-cart leads (CRM)", value: freshLeads, prev: freshLeadsPrev, note: "crm.leads cart leads (agreed crm_025a rule), Fresh only, one per phone per IST day. All sources, not only paid users." },
        { key: "new_sales", label: "New Sales (Fresh orders, APP + WEB)", value: ctx.sales?.orders ?? null, prev: af.comparable ? (ctx.salesPrev?.orders ?? null) : null, note: "Eligible Fresh orders, APP + WEB, all channels." },
      ])
    : null;
  const paidWeak = paidFunnel ? weakestStage(paidFunnel.slice(1)) : null;
  const ga4Weak = ga4Funnel ? weakestStage(ga4Funnel.stages.slice(1)) : null;
  const afFirst = af?.stages.find((s) => s.key === "First_Purchase")?.value ?? null;
  const afPurchase = af?.stages.find((s) => s.key === "af_purchase")?.value ?? null;
  const ga4First = ga4Funnel?.stages.find((s) => s.key === "first_purchase")?.value ?? null;

  const outcomes = [
    { measure: "New Sales — eligible Fresh APP orders", source: "Order_Level_V4", kind: "Business outcome", value: sales?.app ?? null, definition: "Unique Fresh orders, orderPlatform = APP, excluding the 3 agreed statuses. All users." },
    { measure: "First purchase (tracked)", source: "AppsFlyer", kind: "Tracked event", value: afFirst, definition: "Distinct devices firing First_Purchase. Paid users only." },
    { measure: "Purchase (tracked)", source: "AppsFlyer", kind: "Tracked event", value: afPurchase, definition: "Distinct devices firing af_purchase. Paid users; includes repeat purchases." },
    { measure: "First purchase (tracked)", source: "GA4", kind: "Tracked event", value: ga4First, definition: "Daily distinct first_purchase users, summed over days. All users; ~2-day lag." },
  ];

  const atc = af?.atc;
  const atcRows = atc
    ? [
        { label: "New customer", users: atc.newCustomer },
        { label: "Repeat customer", users: atc.repeatCustomer },
      ]
    : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="App funnel"
        description="Where app users drop between install and a new sale — AppsFlyer (paid users) and GA4 (all users) shown side by side, against actual New Sales."
        range={range}
        sources={["af_events", "crm_cart_leads", "ga4_app_funnel", "orders"]}
      />

      <Callout>
        Two sources, never merged: <strong>AppsFlyer</strong> = paid (non-organic) users only, distinct devices over the whole range, from 6 Oct 2026.{" "}
        <strong>GA4</strong> = all users including organic, daily distinct users summed over days, about 2 days behind. Users cannot be matched
        across the two, so their funnels are shown separately. Stage ratios are same-period ratios, not install cohorts. New Sales come from
        orders, not from tracked events.
      </Callout>
      {ctx.afCoverageNote ? <Callout tone="warning">{ctx.afCoverageNote}</Callout> : null}

      <ChartCard
        title="App funnel by period"
        question="Today vs yesterday vs last 7 days vs month to date, and the selected range. Each cell: value, change vs its own comparison (hover a column for it)."
        result={snapshot.result}
        footnote={`Installs, OTP verified, searches and add to carts = AppsFlyer distinct devices over each window (paid users only). Today is in progress, so it has no comparison. Last 7 days and MTD are complete days ending yesterday; they compare with the prior 7 days and the same days last month. Selected range compares with the previous period of the same length. New add to carts = distinct AppsFlyer users adding to cart with no completed order before their first add-to-cart in the window. New Sales total = eligible Fresh orders, APP + WEB, all channels.${snapshotPartial.length ? ` ${snapshotPartial.join(", ")} start before AppsFlyer coverage (6 Oct 2026), so AppsFlyer rows cover only part of the window.` : ""}`}
      >
        <PeriodMatrix windows={matrixWindows(snapshot.windows)} rows={snapshot.rows} />
      </ChartCard>

      <ChartCard title="What to do next" question="Ranked by business impact and urgency. Expand an item for evidence, causes, action and impact.">
        <InsightPanel insights={ctx.insights} />
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="App funnel — AppsFlyer → CRM → New Sales"
          question="Installs and add to cart (AppsFlyer, paid users) → Fresh abandoned-cart leads (CRM) → New Sales (APP + WEB)."
          result={ctx.afCur}
          footnote={`${formatDate(range.from)} – ${formatDate(range.to)}. Installs and add to cart = AppsFlyer distinct devices (paid users only). Fresh abandoned-cart leads = CRM, all sources, one per phone per IST day. New Sales = eligible Fresh orders, APP ${ctx.sales ? ctx.sales.app.toLocaleString("en-IN") : "—"} + WEB ${ctx.sales ? ctx.sales.web.toLocaleString("en-IN") : "—"}, all channels. Different sources and populations, so each step is a ratio between counts, not a user-level conversion. Red marks the biggest drop-off. Change is vs the previous period of the same length${af?.comparable ? "" : " (not available: previous period is before AppsFlyer coverage)"}.`}
        >
          {paidFunnel ? <FunnelChart stages={paidFunnel} unit="" weakestKey={paidWeak?.key} /> : null}
        </ChartCard>
        <ChartCard
          title="GA4 funnel — all users"
          question="Does the all-user funnel break at the same stage?"
          result={ctx.ga4}
          footnote={`Daily distinct users summed over days. ${ctx.ga4Incomplete ? `GA4 is complete only through ${formatDate(ctx.ga4CompleteThrough)}; later days are missing or partial.` : ""}`}
        >
          {ga4Funnel ? (
            <FunnelChart
              stages={ga4Funnel.stages}
              unit="users"
              weakestKey={ga4Weak?.key}
              color="var(--series-web-other)"
              branch={{ underKey: "payment_attempted", label: "Payment failed", value: ga4Funnel.paymentFailed.value, rate: ga4Funnel.paymentFailed.rate }}
            />
          ) : null}
        </ChartCard>
      </div>

      <ChartCard
        title="Tracked purchases vs actual New Sales"
        question="How much of New Sales do the tracking tools see?"
        result={ctx.orders}
        footnote="Tracked events are not business outcomes: AppsFlyer sees paid users only, GA4 counts users per day, and both can fire on orders that are later cancelled. New Sales are always reported from orders."
      >
        <DataTable columns={OUTCOME_COLUMNS} rows={outcomes} searchable={false} />
      </ChartCard>

      <div className="grid gap-4 2xl:grid-cols-[3fr_2fr]">
        <ChartCard title="App funnel — stage detail" result={ctx.afCur}>
          <DataTable columns={STAGE_COLUMNS} rows={paidFunnel ? stageRows(paidFunnel) : []} searchable={false} />
        </ChartCard>
        <ChartCard
          title="Add to cart: new vs repeat customers"
          question="Is cart activity coming from new customers?"
          result={ctx.afCur}
          footnote={`Distinct AppsFlyer users who added to cart: ${atc?.total ?? "—"}. Repeat = a completed order before their first add-to-cart in the range (the agreed cart-lead rule). ${atc?.unidentified ? `${atc.unidentified} add-to-cart events had no customer ID and are not split.` : ""}`}
        >
          <CategoryBars data={atcRows} categoryKey="label" series={[{ key: "users", label: "Users", color: "app" }]} format="count" orientation="horizontal" />
        </ChartCard>
      </div>

      {ga4Funnel ? (
        <ChartCard title="GA4 funnel — stage detail" result={ctx.ga4}>
          <DataTable columns={STAGE_COLUMNS} rows={stageRows(ga4Funnel.stages)} searchable={false} />
        </ChartCard>
      ) : null}

      <ChartCard
        title="Micro-events: onboarding and cart friction (AppsFlyer)"
        question="Do users get stuck at OTP, registration or the cart page?"
        result={ctx.afCur}
        footnote="Two short sequences: OTP sent → verified → registration, and product view → add to cart → cart view → checkout. Distinct devices."
      >
        <DataTable columns={STAGE_COLUMNS.slice(0, 5)} rows={af ? stageRows(af.micro) : []} searchable={false} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="When did it change? AppsFlyer daily" question="Daily distinct devices per stage (paid users)." result={afDaily}>
          <TrendChart data={afTrend} xKey="date" format="count" series={AF_TREND_EVENTS.map((e) => ({ key: e.key, label: e.label, color: e.color }))} />
        </ChartCard>
        <ChartCard
          title="When did it change? GA4 daily"
          question="Daily distinct users per stage (all users)."
          result={ctx.ga4}
          footnote={ctx.ga4Incomplete ? `Days after ${formatDate(ctx.ga4CompleteThrough)} are incomplete (GA4 lag).` : undefined}
        >
          <TrendChart
            data={ga4Trend}
            xKey="date"
            format="count"
            series={[
              { key: "first_open", label: "First open", color: "app" },
              { key: "added_to_cart", label: "Add to cart", color: "web" },
              { key: "began_checkout", label: "Checkout", color: "tier_4" },
              { key: "first_purchase", label: "First purchase", color: "web_other" },
            ]}
          />
        </ChartCard>
      </div>

      <SourceNotes sources={["af_events", "crm_cart_leads", "ga4_app_funnel", "orders"]} />
    </div>
  );
}
