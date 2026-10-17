import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { PendingDefinitionState } from "@/components/state/States";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getAfAdDaily } from "@/lib/data/afEvents";
import { getMetaAdDaily } from "@/lib/data/metaAds";
import { rollupAds, withRates, type Row } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "Creative Intelligence" };

const COLUMNS: TableColumn[] = [
  { key: "name", label: "Creative (ad name)", format: "text", hint: "Ad name is the creative-concept proxy until creative IDs are synced." },
  { key: "ads", label: "Ads", format: "count" },
  { key: "first_date", label: "First seen*", format: "date", hint: "Earliest date in adwatch (from 12 Sep 2026). Provisional." },
  { key: "spend", label: "Spend", format: "inr" },
  { key: "impressions", label: "Impressions", format: "count" },
  { key: "ctr", label: "CTR (link)", format: "pct" },
  { key: "cpm", label: "CPM", format: "inr_precise" },
  { key: "installs", label: "Installs (Meta)", format: "count" },
  { key: "cpi", label: "CPI", format: "inr_precise" },
  { key: "af_installs", label: "AF installs", format: "count" },
  { key: "af_purchasers", label: "AF purchasers", format: "count", hint: "AppsFlyer-attributed purchasers — not Fresh orders." },
  { key: "cost_per_af_purchaser", label: "Spend / AF purchaser", format: "inr" },
];

export default async function CreativesPage({ searchParams }: PageProps<"/creatives">) {
  const { range } = await rangeFromSearchParams(searchParams);
  const [ads, af] = await Promise.all([getMetaAdDaily(range), getAfAdDaily(range)]);

  const afByName = new Map<string, { installs: number; purchasers: number }>();
  if (af.state === "ok") {
    for (const r of af.data) {
      const cur = afByName.get(r.ad_name) ?? { installs: 0, purchasers: 0 };
      cur.installs += r.installs;
      cur.purchasers += r.purchasers;
      afByName.set(r.ad_name, cur);
    }
  }
  const rows =
    ads.state === "ok"
      ? rollupAds(ads.data, "ad_name").map((e): Row => {
          const base = withRates(e);
          const a = afByName.get(e.name);
          return {
            ...base,
            af_installs: a ? a.installs : null,
            af_purchasers: a ? a.purchasers : null,
            cost_per_af_purchaser: a && a.purchasers ? e.spend / a.purchasers : null,
          };
        })
      : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Creative intelligence"
        description="Creative-level attention and install efficiency, with AppsFlyer-attributed purchasers where the ad name matches."
        range={range}
        sources={["meta_ad_daily", "af_ad_daily"]}
      />

      <KpiGrid cols={4}>
        <KpiCard metric="spend" state={ads.state} value={ads.state === "ok" ? rows.reduce((a, r) => a + Number(r.spend ?? 0), 0) : null} />
        <KpiCard metric="af_purchasers" state={af.state} value={af.state === "ok" ? [...afByName.values()].reduce((a, r) => a + r.purchasers, 0) : null} />
        <KpiCard metric="creative_cac" state="ok" />
        <KpiCard metric="meta_purchase_roas" state="ok" />
      </KpiGrid>

      <Callout tone="warning">
        Creative identity is provisional. October ads are missing from the stored Meta creative tables (last updated in August), so ad name
        stands in for the creative concept and &ldquo;first seen&rdquo; is the earliest date in adwatch, not a verified launch date. October
        new-creative counts and the winner/fatigue classification are held until creative IDs and launch history are available.
      </Callout>

      <ChartCard title="Creatives" question="Which creatives earn attention and installs efficiently?" result={ads} status="provisional">
        <DataTable columns={COLUMNS} rows={rows} exportName={`creatives-${range.from}-${range.to}`} />
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Launches in the period" status="provisional">
          <PendingDefinitionState
            title="Needs verified creative launch dates"
            detail="New creative vs reused creative vs new ad on an old creative can only be separated once creative IDs and their first-delivery dates are synced from Meta."
          />
        </ChartCard>
        <ChartCard title="Winner / fatigue classification" status="provisional">
          <PendingDefinitionState
            title="Framework in Phase 2B"
            detail="Data-driven thresholds (spend and impression sufficiency, CTR/CPI against comparable campaigns, trend) will be built from history, not fixed cut-offs."
          />
        </ChartCard>
      </div>

      <SourceNotes sources={["meta_ad_daily", "af_ad_daily"]} />
    </div>
  );
}
