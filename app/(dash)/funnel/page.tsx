import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { FunnelBars } from "@/components/charts/FunnelBars";
import { TrendChart } from "@/components/charts/TrendChart";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { PendingDefinitionState } from "@/components/state/States";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getAfEventsDaily } from "@/lib/data/afEvents";
import { getAppFunnelDaily } from "@/lib/data/appFunnel";
import { summarizeFunnel } from "@/lib/metrics/compute";
import { dateSpine } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "App Funnel" };

const AF_COLUMNS: TableColumn[] = [
  { key: "event_name", label: "Event", format: "text" },
  { key: "media_source_group", label: "Media source", format: "text" },
  { key: "events", label: "Events", format: "count" },
  { key: "unique_devices", label: "Devices (daily, summed)", format: "count" },
  { key: "unique_users", label: "Users (daily, summed)", format: "count" },
];

export default async function FunnelPage({ searchParams }: PageProps<"/funnel">) {
  const { range } = await rangeFromSearchParams(searchParams);
  const [ga4, af] = await Promise.all([getAppFunnelDaily(range), getAfEventsDaily(range)]);

  const t = ga4.state === "ok" ? summarizeFunnel(ga4.data) : null;
  const byDay = new Map<string, { first_open: number; searched: number; added_to_cart: number; purchased: number }>();
  if (ga4.state === "ok") {
    for (const r of ga4.data) {
      const cur = byDay.get(r.day) ?? { first_open: 0, searched: 0, added_to_cart: 0, purchased: 0 };
      cur.first_open += r.first_open;
      cur.searched += r.searched;
      cur.added_to_cart += r.added_to_cart;
      cur.purchased += r.purchased;
      byDay.set(r.day, cur);
    }
  }
  const daily =
    ga4.state === "ok"
      ? dateSpine(range.from, range.to).map((date) => {
          const v = byDay.get(date);
          return {
            date,
            first_open: v ? v.first_open : null,
            searched: v ? v.searched : null,
            added_to_cart: v ? v.added_to_cart : null,
            purchased: v ? v.purchased : null,
          };
        })
      : [];

  const afAgg = new Map<string, { event_name: string; media_source_group: string; events: number; unique_devices: number; unique_users: number }>();
  if (af.state === "ok") {
    for (const r of af.data) {
      const k = `${r.event_name}|${r.media_source_group}`;
      const cur = afAgg.get(k) ?? { event_name: r.event_name, media_source_group: r.media_source_group, events: 0, unique_devices: 0, unique_users: 0 };
      cur.events += r.events;
      cur.unique_devices += r.unique_devices;
      cur.unique_users += r.unique_users;
      afAgg.set(k, cur);
    }
  }
  const afRows = [...afAgg.values()].sort((a, b) => b.events - a.events);

  return (
    <div className="space-y-5">
      <PageHeader
        title="App funnel"
        description="All-user funnel volumes from GA4, and paid-user events from AppsFlyer. Same-day ratios are operational, not cohort conversion."
        range={range}
        sources={["ga4_app_funnel", "af_events"]}
      />

      <KpiGrid cols={5}>
        <KpiCard metric="ga4_installs" state={ga4.state} value={t?.first_open} />
        <KpiCard metric="ga4_search_users" state={ga4.state} value={t?.searched} />
        <KpiCard metric="ga4_atc_users" state={ga4.state} value={t?.added_to_cart} />
        <KpiCard metric="ga4_purchase_users" state={ga4.state} value={t?.purchased} />
        <KpiCard metric="install_to_cart_sameday" state={ga4.state} value={t && t.first_open ? t.added_to_cart / t.first_open : null} />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Funnel volumes (GA4, all users)"
          question="Where is the largest drop between steps?"
          result={ga4}
          footnote="Daily distinct users per step, summed across days. Percentages are step ÷ previous step for the same period."
        >
          {t ? (
            <FunnelBars
              steps={[
                { label: "First open", value: t.first_open },
                { label: "Searched", value: t.searched },
                { label: "Viewed item", value: t.viewed_item },
                { label: "Added to cart", value: t.added_to_cart },
                { label: "Began checkout", value: t.began_checkout },
                { label: "Purchased", value: t.purchased },
              ]}
            />
          ) : null}
        </ChartCard>
        <ChartCard title="Daily funnel users" result={ga4} footnote="GA4 data lags about two days; recent days may be missing.">
          <TrendChart
            data={daily}
            xKey="date"
            format="count"
            series={[
              { key: "first_open", label: "First open", color: "app" },
              { key: "added_to_cart", label: "Added to cart", color: "web_agent" },
              { key: "purchased", label: "Purchased", color: "web_other" },
            ]}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Cohort conversion (install → cart → Fresh order)" status="provisional">
          <PendingDefinitionState
            title="Phase 2B: paid users from 6 Oct 2026"
            detail="Install cohorts keep users with their install date. Built from AppsFlyer device → user links joined to Order_Level_V4; organic users are not in AppsFlyer, so cohorts cover paid installs only."
          />
        </ChartCard>
        <ChartCard title="Time to convert" status="provisional">
          <PendingDefinitionState
            title="Phase 2B"
            detail="Median, p75 and p90 for install → first search, install → first cart and cart → first Fresh order, where timestamps and identity allow."
          />
        </ChartCard>
      </div>

      <ChartCard title="AppsFlyer events (paid users)" question="Which events fire, and from which media source?" result={af}>
        <DataTable columns={AF_COLUMNS} rows={afRows} exportName={`af-events-${range.from}-${range.to}`} />
      </ChartCard>

      <Callout>
        Three install definitions exist and are never mixed: Meta-reported installs (Meta Ads), AppsFlyer non-organic installs (above), and
        GA4 first opens (all users).
      </Callout>

      <SourceNotes sources={["ga4_app_funnel", "af_events"]} />
    </div>
  );
}
