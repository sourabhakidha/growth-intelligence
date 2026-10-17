import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { TrendChart } from "@/components/charts/TrendChart";
import { KpiCard, KpiGrid } from "@/components/kpi/KpiCard";
import { PageHeader } from "@/components/layout/PageHeader";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { getMetaAccountDaily, getMetaAdDaily } from "@/lib/data/metaAds";
import { getMetaSpendCheck } from "@/lib/data/metaCampaignCheck";
import { summarizeMeta } from "@/lib/metrics/compute";
import { metaDaily, rollupAds, withRates } from "@/lib/metrics/series";
import { rangeFromSearchParams } from "@/lib/page";

export const metadata: Metadata = { title: "Meta Ads" };

const ENTITY_COLUMNS = (nameLabel: string, parentLabel?: string): TableColumn[] => [
  { key: "name", label: nameLabel, format: "text" },
  ...(parentLabel ? [{ key: "parent", label: parentLabel, format: "text" } as TableColumn] : []),
  { key: "spend", label: "Spend", format: "inr" },
  { key: "impressions", label: "Impressions", format: "count" },
  { key: "cpm", label: "CPM", format: "inr_precise" },
  { key: "link_clicks", label: "Link clicks", format: "count" },
  { key: "ctr", label: "CTR (link)", format: "pct" },
  { key: "cpc", label: "CPC (link)", format: "inr_precise" },
  { key: "installs", label: "Installs (Meta)", format: "count" },
  { key: "cpi", label: "CPI", format: "inr_precise" },
];

const CHECK_COLUMNS: TableColumn[] = [
  { key: "date", label: "Date", format: "date" },
  { key: "adwatch_spend", label: "adwatch spend", format: "inr" },
  { key: "campaign_table_spend", label: "Campaign table spend", format: "inr" },
  { key: "diff", label: "Difference", format: "inr" },
  { key: "adwatch_impressions", label: "adwatch impressions", format: "count" },
  { key: "campaign_table_impressions", label: "Campaign table impressions", format: "count" },
];

export default async function MetaAdsPage({ searchParams }: PageProps<"/meta-ads">) {
  const { range, previous } = await rangeFromSearchParams(searchParams);
  const [account, accountPrev, ads, check] = await Promise.all([
    getMetaAccountDaily(range),
    getMetaAccountDaily(previous),
    getMetaAdDaily(range),
    getMetaSpendCheck(range),
  ]);

  const m = account.state === "ok" ? summarizeMeta(account.data) : null;
  const mp = accountPrev.state === "ok" ? summarizeMeta(accountPrev.data) : null;
  const daily = account.state === "ok" ? metaDaily(account.data, range.from, range.to) : [];
  const campaigns = ads.state === "ok" ? rollupAds(ads.data, "campaign").map(withRates) : [];
  const adsets = ads.state === "ok" ? rollupAds(ads.data, "adset").map(withRates) : [];
  const adRows = ads.state === "ok" ? rollupAds(ads.data, "ad").map(withRates) : [];
  const checkRows =
    check.state === "ok"
      ? check.data.map((r) => ({
          ...r,
          diff: r.adwatch_spend !== null && r.campaign_table_spend !== null ? r.adwatch_spend - r.campaign_table_spend : null,
        }))
      : [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Meta ads performance"
        description="Delivery, cost and install efficiency by campaign, ad set and ad. Meta-reported figures; no order attribution is implied."
        range={range}
        sources={["meta_ad_daily", "meta_campaign_check"]}
      />

      <KpiGrid cols={5}>
        <KpiCard metric="spend" state={account.state} value={m?.spend} previous={mp?.spend} />
        <KpiCard metric="impressions" state={account.state} value={m?.impressions} previous={mp?.impressions} />
        <KpiCard metric="cpm" state={account.state} value={m?.cpm} previous={mp?.cpm} />
        <KpiCard metric="link_clicks" state={account.state} value={m?.link_clicks} previous={mp?.link_clicks} />
        <KpiCard metric="ctr" state={account.state} value={m?.ctr} previous={mp?.ctr} />
        <KpiCard metric="cpc" state={account.state} value={m?.cpc} previous={mp?.cpc} />
        <KpiCard metric="installs_meta" state={account.state} value={m?.installs} previous={mp?.installs} />
        <KpiCard metric="cpi" state={account.state} value={m?.cpi} previous={mp?.cpi} />
        <KpiCard metric="clicks" state={account.state} value={m?.clicks} previous={mp?.clicks} />
        <KpiCard metric="meta_purchase_roas" state="ok" />
      </KpiGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Daily spend" result={account}>
          <TrendChart data={daily} xKey="date" format="inr" series={[{ key: "spend", label: "Spend", color: "accent" }]} />
        </ChartCard>
        <ChartCard title="Daily CPI" question="Is install efficiency improving?" result={account}>
          <TrendChart data={daily} xKey="date" format="inr_precise" series={[{ key: "cpi", label: "CPI", color: "accent" }]} />
        </ChartCard>
      </div>

      <ChartCard title="Campaigns" question="Where is spend concentrated, and at what install cost?" result={ads}>
        <DataTable columns={ENTITY_COLUMNS("Campaign")} rows={campaigns} exportName={`meta-campaigns-${range.from}-${range.to}`} />
      </ChartCard>
      <ChartCard title="Ad sets" result={ads}>
        <DataTable columns={ENTITY_COLUMNS("Ad set", "Campaign")} rows={adsets} exportName={`meta-adsets-${range.from}-${range.to}`} />
      </ChartCard>
      <ChartCard title="Ads" result={ads}>
        <DataTable columns={ENTITY_COLUMNS("Ad", "Ad set")} rows={adRows} exportName={`meta-ads-${range.from}-${range.to}`} />
      </ChartCard>

      <ChartCard
        title="Spend reconciliation"
        question="Does ad-level spend agree with the campaign table?"
        result={check}
        footnote="Small differences on the most recent days are Meta late restatements. A persistent gap is a data-quality issue."
      >
        <DataTable columns={CHECK_COLUMNS} rows={checkRows} searchable={false} />
      </ChartCard>

      <Callout>
        Fresh orders, add-to-carts and revenue are not shown per campaign: Meta receives no cart or purchase events, and AppsFlyer hides the
        campaign behind most Meta installs. Placement, audience and objective breakdowns need data not yet ingested.
      </Callout>

      <SourceNotes sources={["meta_ad_daily", "meta_campaign_check"]} />
    </div>
  );
}
