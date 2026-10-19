"use client";

import { CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { formatCount, formatINR } from "@/lib/format/inr";
import { OPPORTUNITY_LABEL, type OpportunityGroup, type OpportunityPoint } from "@/lib/metrics/metaFresh";

const GROUP_COLOR: Record<OpportunityGroup, string> = {
  winner: "var(--series-web-other)",
  emerging: "var(--series-app)",
  underperformer: "var(--series-web-agent)",
  steady: "var(--series-tier-4)",
  insufficient: "var(--series-neutral)",
};
const ORDER: OpportunityGroup[] = ["winner", "emerging", "underperformer", "steady", "insufficient"];

/**
 * Creative opportunity map: CPI (x) against AppsFlyer purchasers per 100 installs (y), bubble = spend. Dashed lines =
 * account CPI and account purchasers per 100 installs, so the top-left quadrant is cheap installs that buy.
 */
export function OpportunityMap({ points, baselineCpi, baselinePer100 }: { points: OpportunityPoint[]; baselineCpi: number | null; baselinePer100: number | null }) {
  // Insufficient-data creatives (< 10 installs) are counted in the legend but not plotted: their rates are noise.
  const plotted = points.filter((p) => p.group !== "insufficient" && p.cpi !== null && p.purchasers_per_100 !== null);
  const tick = { fill: "var(--text-muted)", fontSize: 11 };
  return (
    <div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 12, bottom: 18, left: 0 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis type="number" dataKey="cpi" name="CPI" tick={tick} tickFormatter={(v) => `₹${v}`} label={{ value: "CPI (₹, Meta)", position: "insideBottom", offset: -10, fill: "var(--text-muted)", fontSize: 11 }} />
            <YAxis type="number" dataKey="purchasers_per_100" name="Purchasers / 100 installs" tick={tick} width={44} label={{ value: "AF purchasers / 100 installs", angle: -90, position: "insideLeft", fill: "var(--text-muted)", fontSize: 11, dy: 70 }} />
            <ZAxis type="number" dataKey="spend" range={[30, 600]} name="Spend" />
            {baselineCpi ? <ReferenceLine x={Math.round(baselineCpi)} stroke="var(--border-strong)" strokeDasharray="4 3" /> : null}
            {baselinePer100 !== null ? <ReferenceLine y={baselinePer100} stroke="var(--border-strong)" strokeDasharray="4 3" /> : null}
            <Tooltip
              cursor={{ strokeDasharray: "3 3" }}
              content={({ active, payload }) => {
                const p = active && payload?.[0] ? (payload[0].payload as OpportunityPoint) : null;
                if (!p) return null;
                return (
                  <div className="max-w-[280px] rounded-lg border border-line bg-surface-1 p-2 text-xs text-ink shadow-sm">
                    <p className="font-semibold">{p.name}</p>
                    <p style={{ color: GROUP_COLOR[p.group] }}>{OPPORTUNITY_LABEL[p.group]}</p>
                    <p>
                      Spend {formatINR(p.spend)} · CPI {p.cpi !== null ? formatINR(p.cpi) : "—"} · {formatCount(p.installs)} installs
                    </p>
                    <p>
                      AF purchasers {formatCount(p.af_purchasers)} ({p.purchasers_per_100 ?? "—"} / 100 installs) · cost per purchaser{" "}
                      {p.cost_per_af_purchaser !== null ? formatINR(p.cost_per_af_purchaser) : "—"}
                    </p>
                    <p className="mt-1">{p.reason}</p>
                  </div>
                );
              }}
            />
            {ORDER.map((g) => (
              <Scatter key={g} name={OPPORTUNITY_LABEL[g]} data={plotted.filter((p) => p.group === g)} fill={GROUP_COLOR[g]} fillOpacity={0.7} isAnimationActive={false} />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink">
        {ORDER.map((g) => (
          <li key={g} className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: GROUP_COLOR[g] }} aria-hidden />
            {OPPORTUNITY_LABEL[g]} <strong>{points.filter((p) => p.group === g).length}</strong>
          </li>
        ))}
      </ul>
      {points.length > plotted.length ? (
        <p className="mt-1 text-[11px] text-ink-3">{points.length - plotted.length} creative(s) are not plotted: insufficient data, or no AppsFlyer match by ad name (all are counted in the legend).</p>
      ) : null}
    </div>
  );
}
