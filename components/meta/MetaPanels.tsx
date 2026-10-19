import { formatMetric } from "@/lib/format/metric";
import { formatCount, formatPct } from "@/lib/format/inr";
import type { EfficiencyRow, FunnelView, KpiTile } from "@/lib/metrics/metaFresh";
import { cn } from "@/lib/cn";

// Server-rendered panels for the Meta Ads page. Colours: black text, green = better, red = worse, blue = Meta / accent.

const SOURCE_COLOR: Record<string, string> = { Meta: "text-accent", AppsFlyer: "text-good", Orders: "text-ink", CRM: "text-ink" };

export function SectionTitle({ n, title, sub }: { n: number; title: string; sub?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-accent text-xs font-semibold text-white">{n}</span>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink">{title}</h2>
      {sub ? <span className="text-xs text-ink-2">{sub}</span> : null}
    </div>
  );
}

const fmtTile = (v: number | null, f: KpiTile["format"]) => (v === null ? "—" : f === "pct" ? `${(v * 100).toFixed(2)}%` : formatMetric(v, f, true));

function Tile({ t, cmpLabel }: { t: KpiTile; cmpLabel: string }) {
  const good = t.change === null || t.change === 0 ? null : t.up ? t.change > 0 : t.change < 0;
  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border border-line bg-surface-1 p-3" title={t.hint}>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold text-ink">{t.label}</p>
        <p className={cn("line-clamp-2 text-[11px] leading-snug", SOURCE_COLOR[t.source.split(" ")[0]] ?? "text-ink-2")}>{t.sub}</p>
      </div>
      <p className="tabular text-xl font-semibold tracking-tight text-ink">{fmtTile(t.value, t.format)}</p>
      <div className="min-h-[30px] text-[11px] leading-snug">
        {t.change !== null ? (
          <span className={cn("font-semibold tabular-nums", good === null ? "text-ink" : good ? "text-good" : "text-critical")}>
            {t.change > 0 ? "▲" : t.change < 0 ? "▼" : "■"} {Math.abs(t.change * 100).toFixed(1)}%
          </span>
        ) : (
          <span className="text-ink-3">{t.noCmp ?? "no comparison"}</span>
        )}
        {t.cmp !== null ? <span className="block truncate text-ink-2">{cmpLabel}: {fmtTile(t.cmp, t.format)}</span> : null}
      </div>
    </div>
  );
}

/** 13 tiles in two labelled rows: Meta delivery (7) above, cost and Fresh outcomes (6) below. */
export function KpiStrip({ tiles, cmpLabel }: { tiles: KpiTile[]; cmpLabel: string }) {
  const rows = [
    { title: "Meta delivery", tiles: tiles.slice(0, 7), cols: "lg:grid-cols-7" },
    { title: "Cost and Fresh outcomes", tiles: tiles.slice(7), cols: "lg:grid-cols-6" },
  ];
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.title}>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-2">{r.title}</p>
          <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4", r.cols)}>
            {r.tiles.map((t) => (
              <Tile key={t.key} t={t} cmpLabel={cmpLabel} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const STEP_COLORS = ["#1d4ed8", "#2563eb", "#3b82f6", "#15803d", "#16a34a", "#000000"];

/** Funnel with log-scaled widths (impressions are ~10,000× orders), conversion, change vs comparison and drop-off. */
export function FreshFunnel({ view }: { view: FunnelView }) {
  const max = Math.max(1, ...view.steps.map((s) => s.value ?? 0));
  const width = (v: number | null) => (v && v > 0 ? 18 + 82 * (Math.log10(v) / Math.log10(max)) : 4);
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[minmax(0,1fr)_64px_60px_92px] gap-2 text-[10px] font-semibold uppercase tracking-wide text-ink-2">
        <span>Stage</span>
        <span className="text-right">Conversion</span>
        <span className="text-right">vs prev.</span>
        <span className="text-right">Drop-off</span>
      </div>
      {view.steps.map((s, i) => (
        <div key={s.key} className="grid grid-cols-[minmax(0,1fr)_64px_60px_92px] items-end gap-2 py-0.5">
          <div className="min-w-0">
            <div className="text-xs leading-tight">
              <span className="font-medium text-ink">{s.label}</span> <span className={cn("text-[10px]", SOURCE_COLOR[s.source])}>· {s.source}</span>
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <div className="h-3 rounded-sm" style={{ width: `${width(s.value)}%`, background: STEP_COLORS[i] ?? "#000" }} />
              <span className="shrink-0 text-xs font-semibold tabular-nums text-ink">{formatCount(s.value)}</span>
            </div>
          </div>
          <span className="text-right text-xs tabular-nums text-ink">{i ? formatPct(s.conv) : "—"}</span>
          <span className={cn("text-right text-xs font-semibold tabular-nums", s.conv_change_pts === null ? "text-ink-3" : s.conv_change_pts >= 0 ? "text-good" : "text-critical")}>
            {s.conv_change_pts === null ? "—" : `${s.conv_change_pts >= 0 ? "▲" : "▼"}${Math.abs(s.conv_change_pts * 100).toFixed(1)}pp`}
          </span>
          <span className="text-right text-[11px] tabular-nums text-ink-2">{i && s.drop !== null && s.drop >= 0 ? `−${formatCount(s.drop)} (${formatPct(s.drop_rate)})` : "—"}</span>
        </div>
      ))}
      <dl className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3 text-xs">
        <div>
          <dt className="text-ink-2">Fresh Checkout Initiated (AppsFlyer users)</dt>
          <dd className="tabular-nums font-semibold text-ink">
            {formatCount(view.checkout)}
            {view.checkoutPrev !== null ? <span className="ml-1 font-normal text-ink-2">prev. {formatCount(view.checkoutPrev)}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-ink-2">All Fresh orders by Meta-attributed users</dt>
          <dd className="tabular-nums font-semibold text-ink">
            {formatCount(view.metaUserOrders)} <span className="font-normal text-ink-2">· APP {formatCount(view.metaUserOrdersApp)}</span>
          </dd>
        </div>
        <div>
          <dt className="text-ink-2">Fresh Abandoned Cart Leads (CRM, all sources)</dt>
          <dd className="tabular-nums font-semibold text-ink">
            {formatCount(view.leads)}
            {view.leadsPrev !== null ? <span className="ml-1 font-normal text-ink-2">prev. {formatCount(view.leadsPrev)}</span> : null}
          </dd>
        </div>
        <div>
          <dt className="text-ink-2">All New Sales (Fresh, APP + WEB)</dt>
          <dd className="tabular-nums font-semibold text-ink">
            {formatCount(view.newSales)} <span className="font-normal text-ink-2">· APP {formatCount(view.newSalesApp)}</span>
            {view.metaShareOfNewSales !== null ? <span className="ml-1 font-normal text-accent">· {formatPct(view.metaShareOfNewSales)} by Meta users</span> : null}
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Change in drop-off rate per step vs the comparison window: red = losing more users, green = losing fewer. */
export function DropOffBars({ view }: { view: FunnelView }) {
  const steps = view.steps
    .slice(1)
    .map((s, i) => ({ label: `${view.steps[i].label} → ${s.label}`, v: s.drop_change_pts }))
    .filter((s): s is { label: string; v: number } => s.v !== null)
    .sort((a, b) => b.v - a.v);
  if (!steps.length) return <p className="text-sm text-ink-2">No comparison window inside AppsFlyer coverage (from 6 Oct 2026) for this period.</p>;
  const max = Math.max(0.005, ...steps.map((s) => Math.abs(s.v)));
  return (
    <ul className="space-y-2">
      {steps.map((s) => (
        <li key={s.label} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_60px] items-center gap-2 text-xs">
          <span className="leading-tight text-ink">{s.label}</span>
          <div className="h-4">
            <div className={cn("h-4 rounded-sm", s.v > 0 ? "bg-critical" : "bg-good")} style={{ width: `${Math.max(3, (Math.abs(s.v) / max) * 100)}%` }} />
          </div>
          <span className={cn("text-right font-semibold tabular-nums", s.v > 0 ? "text-critical" : "text-good")}>
            {Math.abs(s.v) < 0.0005 ? "" : s.v > 0 ? "+" : "−"}
            {Math.abs(s.v * 100).toFixed(1)} pp
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Cost per outcome, comparison (grey) vs current (blue), each metric on its own scale. Red change = more expensive. */
export function EfficiencyBars({ rows, curLabel, prevLabel }: { rows: EfficiencyRow[]; curLabel: string; prevLabel: string }) {
  const money = (v: number | null) => (v === null ? "—" : formatMetric(v, "inr", false));
  return (
    <div>
      <div className="mb-3 flex gap-4 text-xs text-ink">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-[var(--series-neutral)]" />{prevLabel}</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />{curLabel}</span>
      </div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const max = Math.max(1, r.cur ?? 0, r.prev ?? 0);
          return (
            <li key={r.key} title={r.note}>
              <div className="flex items-baseline justify-between text-xs">
                <span className="font-medium text-ink">{r.label}</span>
                <span className={cn("font-semibold tabular-nums", r.change === null ? "text-ink-3" : r.change > 0 ? "text-critical" : "text-good")}>
                  {r.change === null ? "no comparison" : `${r.change > 0 ? "▲ +" : "▼ −"}${Math.abs(r.change * 100).toFixed(0)}%`}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-[minmax(0,1fr)_72px] items-center gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
                <div className="h-2.5 rounded-sm bg-[var(--series-neutral)]" style={{ width: `${((r.prev ?? 0) / max) * 100}%` }} />
                <span className="text-right text-ink-2">{money(r.prev)}</span>
                <div className="h-2.5 rounded-sm bg-accent" style={{ width: `${((r.cur ?? 0) / max) * 100}%` }} />
                <span className="text-right font-semibold text-ink">{money(r.cur)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
