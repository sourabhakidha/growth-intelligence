"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCount, formatINR, formatINRCompact } from "@/lib/format/inr";

/** Re-runs the server page every `minutes` (and on demand) so the war room stays current without a manual reload. */
export function AutoRefresh({ minutes, renderedAt }: { minutes: number; renderedAt: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), minutes * 60_000);
    return () => clearInterval(t);
  }, [router, minutes]);
  return (
    <div className="flex items-center gap-2 text-xs text-ink-2">
      <span>
        Updated <strong className="text-ink">{renderedAt}</strong> IST · auto-refresh every {minutes} min
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        className="rounded-md border border-accent px-2 py-1 font-medium text-accent hover:bg-accent-soft"
        disabled={busy}
      >
        {busy ? "Refreshing…" : "Refresh now"}
      </button>
    </div>
  );
}

/** Cumulative today vs the median of the last 14 days (and yesterday), by IST hour. */
export function PaceCurve({ data, money = false }: { data: { hour: string; today: number | null; usual: number | null; yesterday: number | null }[]; money?: boolean }) {
  const tick = { fill: "var(--text-muted)", fontSize: 11 };
  const fmt = (v: number) => (money ? formatINR(v) : formatCount(v));
  return (
    <div style={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="hour" tick={tick} tickLine={false} interval={2} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={50} tickFormatter={(v) => (money ? formatINRCompact(Number(v)) : formatCount(Number(v)))} />
          <Tooltip
            contentStyle={{ background: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text-primary)" }}
            formatter={(v, name) => [v === null || v === undefined ? "—" : fmt(Number(v)), String(name)]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line dataKey="usual" name="Usual (median, last 14 days)" stroke="var(--series-neutral)" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
          <Line dataKey="yesterday" name="Yesterday" stroke="var(--series-tier-5)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          <Line dataKey="today" name="Today" stroke="var(--series-app)" strokeWidth={2.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
