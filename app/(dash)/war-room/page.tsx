import type { Metadata } from "next";
import { ChartCard } from "@/components/charts/ChartCard";
import { InsightPanel } from "@/components/insights/InsightPanel";
import { PeriodMatrix, sameTimeMatrixWindows, type MatrixRow } from "@/components/kpi/PeriodMatrix";
import { SourceNotes } from "@/components/layout/SourceNotes";
import { Callout } from "@/components/state/Badges";
import { DataTable, type TableColumn } from "@/components/table/DataTable";
import { AutoRefresh, PaceCurve } from "@/components/warroom/WarRoomClient";
import { getSourceFreshness } from "@/lib/data/freshness";
import { getWarRoom } from "@/lib/data/warRoom";
import { cn } from "@/lib/cn";
import { formatMetric } from "@/lib/format/metric";
import { formatDate, formatDateTimeIST, todayIST } from "@/lib/format/ist";
import { TIER_LABEL, type RegionTier } from "@/lib/geo/regions";
import { AF_FIRST_FULL_DAY } from "@/lib/metrics/metaIntel";
import { NO_EARLIER_DAYS, sameTimeWindows, type SameTimeWindow } from "@/lib/metrics/sameTime";
import { SALES_HOURS, WarData, adBoard, campaignBoard, crmQueue, cumulativeCurve, funnelLinks, outcomeMix, outcomeShares, pulse, warActions, type PulseTile } from "@/lib/metrics/warRoom";

export const metadata: Metadata = { title: "Daily Growth War Room" };
export const dynamic = "force-dynamic";

const REFRESH_MINUTES = 10;

const ENTITY_COLUMNS = (label: string, hhmm: string): TableColumn[] => [
  { key: "name", label, format: "text" },
  { key: "spend", label: "Spend now", format: "inr" },
  { key: "spend_yday", label: "Spend vs yday", format: "pct", hint: `Spend now vs yesterday's spend to ${hhmm}.` },
  { key: "spend_l7", label: "Spend vs L7", format: "pct", hint: `Spend now vs the last-7-day average to ${hhmm}.` },
  { key: "spend_mtd", label: "Spend vs MTD", format: "pct", hint: `Spend now vs the month-to-date average to ${hhmm}.` },
  { key: "installs", label: "Installs", format: "count" },
  { key: "cpi", label: "CPI now", format: "inr" },
  { key: "cpi_yday", label: "CPI yday", format: "inr", hint: `Yesterday's CPI to ${hhmm}.` },
  { key: "cpi_l7", label: "CPI L7", format: "inr", hint: `Last 7 days' CPI to ${hhmm} each day.` },
  { key: "cpi_mtd", label: "CPI MTD", format: "inr", hint: `Month-to-date CPI to ${hhmm} each day.` },
  { key: "verdict", label: "Action", format: "text" },
];
const QUEUE_COLUMNS: TableColumn[] = [
  { key: "type", label: "Task type", format: "text" },
  { key: "open", label: "Open", format: "count" },
  { key: "never_dialled", label: "Never dialled", format: "count" },
  { key: "callback_overdue", label: "Callback overdue", format: "count" },
];
const OUTCOME_COLUMNS: TableColumn[] = [
  { key: "outcome", label: "Last call outcome", format: "text" },
  { key: "today", label: "Calls now", format: "count" },
  { key: "share", label: "Share now", format: "pct", hint: "Share of today's connected calls so far." },
  { key: "share_yday", label: "Yesterday", format: "pct", hint: "Share of yesterday's connected calls to the same time." },
  { key: "share_l7", label: "Last 7 days", format: "pct", hint: "Share of the last 7 days' connected calls, each day to the same time." },
  { key: "share_mtd", label: "MTD", format: "pct", hint: "Share of this month's earlier connected calls, each day to the same time." },
  { key: "flag", label: "", format: "text" },
];

const TILE_SHORT: Record<string, string> = { yday: "Yday", l7: "L7", mtd: "MTD" };

function Tile({ t, hhmm }: { t: PulseTile; hhmm: string }) {
  const fmt = (v: number | null) => (v === null ? "—" : t.format === "pct" ? `${(v * 100).toFixed(1)}%` : formatMetric(v, t.format === "inr" ? "inr" : "count", true));
  return (
    <div
      className={cn("flex min-w-0 flex-col justify-between rounded-lg border bg-surface-1 p-2.5", t.alert ? "border-critical ring-1 ring-critical/40" : "border-line")}
      title={`Now vs yesterday, the last-7-day average and the month-to-date average — every figure counted to ${hhmm} IST. A red border = an alert (vs the median of earlier days to ${hhmm}).`}
    >
      <div>
        <p className="text-[11px] font-semibold leading-tight text-ink">{t.label}</p>
        <p className="text-[10px] leading-tight text-ink-2">{t.sub}</p>
      </div>
      <p className="tabular mt-1 text-lg font-semibold text-ink">{fmt(t.today)}</p>
      <dl className="space-y-px text-[10px] leading-tight">
        {t.cmps.map((c) => {
          // Percentages (failure rate) move in points; counts and money in relative %.
          const ch = t.today === null || c.value === null ? null : t.format === "pct" ? t.today - c.value : c.value ? t.today / c.value - 1 : null;
          const good = ch === null || Math.abs(ch) < (t.format === "pct" ? 0.0005 : 0.05) ? null : t.up ? ch > 0 : ch < 0;
          return (
            <div key={c.id} className="flex items-baseline justify-between gap-1 whitespace-nowrap">
              <dt className="text-ink-2">
                {TILE_SHORT[c.id] ?? c.short} <span className="tabular">{fmt(c.value)}</span>
              </dt>
              <dd className={cn("tabular font-semibold", good === null ? "text-ink-2" : good ? "text-good" : "text-critical")}>
                {ch === null ? "—" : `${ch > 0 ? "▲" : ch < 0 ? "▼" : "■"}${Math.abs(ch * 100).toFixed(t.format === "pct" ? 1 : 0)}${t.format === "pct" ? "pp" : "%"}`}
              </dd>
            </div>
          );
        })}
        {t.projected !== null ? <p className="pt-0.5 text-ink-2">day ≈ {fmt(t.projected)}</p> : null}
      </dl>
    </div>
  );
}

/** One matrix row: a metric's value now and per-day average in each earlier window, all to the same time of day. */
function sameTimeRow(
  windows: readonly SameTimeWindow[],
  r: Omit<MatrixRow, "cells">,
  value: (days: readonly string[]) => number | null,
): MatrixRow {
  return { ...r, cells: windows.map((x) => (x.days.length ? { value: value(x.days) } : { value: null, noCmp: NO_EARLIER_DAYS })) };
}

export default async function WarRoomPage() {
  const now = new Date();
  const today = todayIST(now);
  const ist = new Date(now.getTime() + 330 * 60_000);
  const nowMinute = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const [res, fresh] = await Promise.all([getWarRoom(today, nowMinute), getSourceFreshness()]);
  const rows = res.state === "ok" ? res.data : [];
  const w = new WarData(rows, today);
  const metaHour = rows.find((r) => r.metric === "meta_hour")?.so_far ?? -1;

  // Stale = not loaded in the last 60 minutes (orders, AppsFlyer, CRM) — a stalled feed looks like a sales drop.
  const FRESH: Record<string, string> = { orders: "Orders", af_events: "AppsFlyer", crm_cart_leads: "CRM leads" };
  const stale =
    fresh.state === "ok"
      ? fresh.data
          .filter((f) => FRESH[f.source] && (!f.last_loaded_at || now.getTime() - Date.parse(f.last_loaded_at) > 60 * 60_000))
          .map((f) => ({ label: FRESH[f.source], latest: f.last_loaded_at ? formatDateTimeIST(f.last_loaded_at) : null }))
      : [];
  const spendUsual = w.paced("spend");
  const installsUsual = w.paced("installs");
  const accountCpi = spendUsual.usualFull && installsUsual.usualFull ? spendUsual.usualFull / installsUsual.usualFull : null;
  const actions = res.state === "ok" ? warActions({ w, nowMinute, metaHour, staleSources: stale, accountCpi }) : [];
  const cutHour = Math.floor(nowMinute / 60);
  const hhmm = `${String(cutHour).padStart(2, "0")}:${String(nowMinute % 60).padStart(2, "0")}`;
  const windows = sameTimeWindows(today, hhmm);
  const tiles = pulse(w, windows);
  const ordersCurve = cumulativeCurve(w, "new_sales_h", cutHour);
  const metaHourly = rows.some((r) => r.metric === "meta_mode" && r.segment === "hourly");
  // Without the hourly table, today's spend is known only as a total so far: plot it as one point at the last hour.
  const spendCurve = cumulativeCurve(w, "spend_h", metaHour).map((p, h) => (metaHourly ? p : { ...p, today: h === metaHour ? w.value("spend") : null, yesterday: null }));

  const P = (label: string, source: string, metric: string, segment = "all", opts: { days?: number; up?: boolean; format?: "count" | "inr" } = {}): MatrixRow => {
    const p = w.paced(metric, segment, opts.days ?? 14);
    const fmt = (v: number) => formatMetric(v, opts.format ?? "count", true);
    const flag = p.significant ? (p.pace !== null && p.pace < 0 ? " · ▼ behind usual" : " · ▲ ahead of usual") : "";
    return sameTimeRow(
      windows,
      { key: `${metric}|${segment}`, label, sub: `${source}${p.projected !== null ? ` · day ≈ ${fmt(p.projected)}` : ""}${flag}`, format: opts.format ?? "count", up: opts.up ?? true },
      (days) => w.win(metric, segment, days),
    );
  };
  const tierRows = (["priority_mumbai", "tier_1", "delhi_ncr", "tier_2", "tier_3"] as RegionTier[]).map((t) => ({ ...P(TIER_LABEL[t], "Orders", "new_sales", t), group: "New Sales by region" }));
  const paceRows: MatrixRow[] = [
    ...[
      P("New Sales (Fresh, APP + WEB)", "Orders", "new_sales"),
      P("New Sales — APP", "Orders", "new_sales", "APP"),
      P("New Sales — WEB", "Orders", "new_sales", "WEB"),
      P("New Sales — Mumbai (MMR)", "Orders", "new_sales", "mmr"),
      P("Fresh revenue", "Orders", "revenue", "all", { format: "inr" }),
    ].map((r) => ({ ...r, group: "New Sales" })),
    ...tierRows,
    ...[
      P("Meta spend (to last loaded hour)", "Meta", "spend", "all", { format: "inr" }),
      P("Meta installs", "Meta", "installs"),
      P("Installs (AppsFlyer, paid)", "AppsFlyer", "af_install", "all", { days: 7 }),
      P("Add to cart (AppsFlyer, paid)", "AppsFlyer", "af_af_add_to_cart", "all", { days: 7 }),
      P("Checkout initiated (AppsFlyer)", "AppsFlyer", "af_af_initiated_checkout", "all", { days: 7 }),
      P("Payment successful (AppsFlyer)", "AppsFlyer", "af_af_purchase", "all", { days: 7 }),
      P("Payment failed (AppsFlyer)", "AppsFlyer", "af_Payment_failed", "all", { days: 7, up: false }),
    ].map((r) => ({ ...r, group: "Paid app" })),
    ...[
      P("Fresh abandoned-cart leads", "CRM", "fresh_leads", "all", { days: 7 }),
      P("Prescription uploads", "Orders", "rx_uploads"),
      P("Prescription uploads converted", "Orders", "rx_converted"),
      P("Fresh orders cancelled", "Orders", "cancelled", "all", { up: false }),
    ].map((r) => ({ ...r, group: "Sales team and ops" })),
  ];
  const linkRows: MatrixRow[] = funnelLinks(w).map((l) =>
    sameTimeRow(
      windows,
      {
        key: l.key,
        label: l.link,
        sub: `${l.detail} now${l.broken ? " · ▼ broken vs usual" : ""}`,
        group: l.path,
        format: l.format,
        up: !l.higherIsWorse,
        change: l.format === "pct" ? "points" : "relative",
      },
      (days) => w.winRatio(l.num, l.den, days),
    ),
  );
  const [, yday, l7, mtd] = windows;
  const ent = (rs: ReturnType<typeof campaignBoard>, spendMetric: string, installMetric: string, prefix: string) =>
    rs.map((r) => {
      const seg = `${prefix}:${r.id}`;
      const vs = (x: SameTimeWindow) => {
        const s = x.days.length ? w.win(spendMetric, seg, x.days) : null;
        return s ? r.spend / s - 1 : null;
      };
      const cpi = (x: SameTimeWindow) => (x.days.length ? w.winRatio([spendMetric, seg], [installMetric, seg], x.days) : null);
      return {
        name: r.mumbai ? `${r.name} · Mumbai` : r.name, spend: r.spend, spend_yday: vs(yday), spend_l7: vs(l7), spend_mtd: vs(mtd), installs: r.installs,
        cpi: r.cpi, cpi_yday: cpi(yday), cpi_l7: cpi(l7), cpi_mtd: cpi(mtd), verdict: r.verdict,
      };
    });
  const campaigns = ent(campaignBoard(w), "spend", "installs", "campaign");
  const adsets = ent(adBoard(w, "adset", accountCpi), "ad_spend", "ad_installs", "adset");
  const ads = ent(adBoard(w, "ad", accountCpi), "ad_spend", "ad_installs", "ad").slice(0, 25);
  const queue = crmQueue(w);
  const [sharesYday, sharesL7, sharesMtd] = [yday, l7, mtd].map((x) => outcomeShares(w, x.days));
  const outcomes = outcomeMix(w).map((o) => ({
    outcome: o.outcome.replace(/_/g, " "),
    today: o.today,
    share: o.share,
    share_yday: sharesYday.get(o.outcome) ?? null,
    share_l7: sharesL7.get(o.outcome) ?? null,
    share_mtd: sharesMtd.get(o.outcome) ?? null,
    flag: o.supply && (o.change ?? 0) >= 0.03 ? "▲ supply issue" : "",
  }));
  const signals = rows.filter((r) => r.metric === "signal");
  const inSales = nowMinute >= SALES_HOURS.from && nowMinute <= SALES_HOURS.to;
  const counts = { 1: actions.filter((a) => a.priority === 1).length, 2: actions.filter((a) => a.priority === 2).length };

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Daily Growth War Room</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-2">
            {formatDate(today)} · {hhmm} IST. Every figure is <strong className="text-ink">now vs yesterday, the last 7 days and month to date, all counted to {hhmm}</strong> (7-day and MTD = average per day to {hhmm}). Alerts compare with the median of earlier days to {hhmm}, and each one names the link that broke and the team that owns it.
          </p>
        </div>
        <AutoRefresh minutes={REFRESH_MINUTES} renderedAt={hhmm} />
      </header>

      {!inSales ? <Callout>Outside sales-team hours (09:00–21:00): WEB and call-queue alerts are paused; WEB orders are not expected now.</Callout> : null}

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-5 xl:grid-cols-10">
        {tiles.map((t) => (
          <Tile key={t.key} t={t} hhmm={hhmm} />
        ))}
      </section>

      <ChartCard
        title={`Act now — ${counts[1]} urgent, ${counts[2]} this hour`}
        question="Ranked by urgency and New Sales at stake. Each item: what is happening, evidence, why (confirmed vs hypothesis), the action, the impact and what to watch next. The owner team is shown under each title."
        result={res}
        footnote="Rules: a gap must exceed 20% and ~2√(usual) to count. A New Sales shortfall is traced to the first broken link in its path — paid app (spend → install → add to cart → checkout → payment) or sales team (leads, prescriptions, inbound → calls). Thresholds are starting points from the last 14 days; tell us which alerts are noisy and they will be tuned."
      >
        <InsightPanel insights={actions} />
      </ChartCard>

      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard className="min-w-0" title="New Sales today vs a normal day" question="Cumulative eligible Fresh orders by hour." result={res}>
          <PaceCurve data={ordersCurve} />
        </ChartCard>
        <ChartCard className="min-w-0" title="Meta spend today vs a normal day" question={metaHourly ? `Cumulative spend by hour (loaded to ${metaHour >= 0 ? `${metaHour}:00` : "—"}).` : `Today's spend so far (blue point) vs the usual cumulative curve.`}
          result={res}
          footnote={metaHourly ? undefined : "Hourly Meta spend is not readable by the dashboard (no SELECT grant on adwatch.meta_campaign_hourly). Today's spend comes from meta_ad_daily (refreshed hourly); the usual curve = previous days' spend × the typical hourly spend shape (4–17 Oct). Campaign pacing uses the same approximation."}
        >
          <PaceCurve data={spendCurve} money />
        </ChartCard>
      </div>

      <div className="grid gap-4">
        <ChartCard
          className="min-w-0"
          title={`Pacing — now vs yesterday, last 7 days and MTD, all to ${hhmm}`}
          question={`Each column is counted to ${hhmm} IST on its own days; Last 7 days and MTD are the average per day. Under each earlier column: how now compares with it.`}
          result={res}
          footnote={`Day ≈ = projected full day (today so far ÷ the usual share of the day reached by ${hhmm}). AppsFlyer = paid users only; its first whole day is ${formatDate(AF_FIRST_FULL_DAY)} (MTD averages from then). Meta spend runs to the last loaded hour${metaHourly ? "" : "; earlier days' Meta figures to that hour are estimated as full day × the usual hourly spend shape (hourly table not readable)"}. Green = better, red = worse.`}
        >
          <PeriodMatrix windows={sameTimeMatrixWindows(windows)} rows={paceRows} highlight="now" />
        </ChartCard>
        <ChartCard
          className="min-w-0"
          title="Funnel links — where today breaks"
          question={`Each link's conversion now vs yesterday, the last 7 days and MTD, all to ${hhmm}. A broken link explains a shortfall downstream.`}
          result={res}
          footnote="Paid app links use AppsFlyer paid-user devices (and Meta for CPI); 'Add to cart → APP order' compares actual APP Fresh orders with paid add-to-cart devices. Sales-team links use CRM Fresh leads and prescription uploads against WEB orders / conversions. Rates over several days = total ÷ total, not an average of daily rates."
        >
          <PeriodMatrix windows={sameTimeMatrixWindows(windows)} rows={linkRows} highlight="now" />
        </ChartCard>
      </div>

      <ChartCard className="min-w-0" title="Campaigns today" question={`Spend and CPI now vs yesterday, the last 7 days and MTD, each counted to the same hour.`} result={res} footnote={`${metaHourly ? "From Meta hourly data." : "Today's spend from meta_ad_daily; earlier days to this hour = full day × the usual hourly spend shape (hourly table not readable)."} '· Mumbai' = Mumbai in the campaign name.`}>
        <DataTable columns={ENTITY_COLUMNS("Campaign", hhmm)} rows={campaigns} searchable={false} />
      </ChartCard>
      <div className="grid gap-4">
        <ChartCard className="min-w-0" title="Ad sets today" question="Spend and CPI now vs yesterday, the last 7 days and MTD, each to the same hour. The action compares CPI with the ad set's last-7-day CPI." result={res} footnote="Ad-level data has no hourly split: earlier days to this hour are estimated as full day × the usual hourly spend shape, so CPI is that day's full-day CPI.">
          <DataTable columns={ENTITY_COLUMNS("Campaign › Ad set", hhmm)} rows={adsets} pageSize={10} />
        </ChartCard>
        <ChartCard className="min-w-0" title="Ads today (top 25 by spend)" result={res}>
          <DataTable columns={ENTITY_COLUMNS("Campaign › Ad set › Ad", hhmm)} rows={ads} pageSize={10} />
        </ChartCard>
      </div>

      <div className="grid gap-4 2xl:grid-cols-2">
        <ChartCard className="min-w-0" title="Sales-team queue right now" question="Open CRM tasks: who is waiting for a call." result={res} footnote="Inbound, urgent and cart tasks are the highest intent. Never dialled = no attempt yet.">
          <DataTable columns={QUEUE_COLUMNS} rows={queue.map((x) => ({ ...x }))} searchable={false} pageSize={12} />
        </ChartCard>
        <ChartCard className="min-w-0" title="Call outcomes today" question={`Why calls end — supply problems lose orders the funnel already won. Shares now vs yesterday, the last 7 days and MTD, each to ${hhmm}.`} result={res} footnote="Last outcome per task by its last dial time (a proxy: one row per task, not per call). Shares are of connected calls only — no answer, switched off, busy and DND are counted but not compared, because older days' unanswered tasks were redialled later.">
          <DataTable columns={OUTCOME_COLUMNS} rows={outcomes} searchable={false} pageSize={12} />
        </ChartCard>
      </div>

      {signals.length ? (
        <ChartCard title={`adwatch alerts today (${signals.length})`} question="adwatch's own Meta rules, relayed as they fired." result={res}>
          <ul className="space-y-1 text-xs text-ink">
            {signals.slice(0, 20).map((s, i) => (
              <li key={i}>
                <span className="mr-2 rounded bg-surface-2 px-1 font-mono text-[10px]">{s.segment.split(":")[0]}</span>
                {s.label}
              </li>
            ))}
          </ul>
        </ChartCard>
      ) : null}

      <SourceNotes sources={["orders", "meta_ad_daily", "af_events", "crm_cart_leads"]} />
    </div>
  );
}
