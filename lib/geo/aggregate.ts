// Aggregates Fresh orders into the regional hierarchy (lib/geo/regions.ts). Pure: the query layer passes in Fresh
// APP/WEB orders placed in the range (every status except PRESCRIPTION_UPLOADED) and only these aggregates leave the
// server.
//
// Counting rules:
//   - New-sales figures use ELIGIBLE orders only: the three agreed status exclusions are applied here.
//     orders = distinct orderID; customers = distinct non-blank userID, counted once per group over the whole range
//     (never summed across days or groups); revenue = Σ finalAmount over distinct orders. AOV = revenue ÷ orders.
//   - Cancellations are counted on PLACED orders (eligible + cancelled), because most cancelled statuses are excluded
//     from new sales by definition.
//   - RTO and delivered are counted within eligible orders; RTO rate = RTO ÷ (delivered + RTO).

import { MARKET_LABEL, TIER_LABEL, TIER_ORDER, resolveLocation, type RegionTier } from "./regions.ts";

/** The agreed New Sales exclusions — exactly these three, nothing else. */
export const NEW_SALES_EXCLUDED_STATUSES: ReadonlySet<string> = new Set([
  "PRESCRIPTION_UPLOADED",
  "DELIVERY_CANCELED",
  "THREE_PL_CANCELLED_ACKNOWLEDGEMENT",
]);
/** Cancelled orders — agreed 18 Oct 2026: exactly these two statuses. DR_REJECTED, FAILED, CANCELLED and
 * THREE_PL_CANCELLED are NOT counted as cancellations. */
export const CANCELLED_STATUSES: ReadonlySet<string> = new Set(["DELIVERY_CANCELED", "THREE_PL_CANCELLED_ACKNOWLEDGEMENT"]);
/** Return to origin (undelivered shipment coming back) — agreed 18 Oct 2026. */
export const RTO_STATUSES: ReadonlySet<string> = new Set(["RTO_INITIATED", "RTO_IN_TRANSIT", "RTO_DELIVERED", "RETURN_TO_ORIGIN"]);
export const DELIVERED_STATUSES: ReadonlySet<string> = new Set(["COMPLETED"]);

export function isEligibleNewSale(status: string | null): boolean {
  return status !== null && !NEW_SALES_EXCLUDED_STATUSES.has(status);
}

export interface GeoOrder {
  orderId: string;
  userId: string | null;
  /** IST calendar date of the order. */
  date: string;
  platform: unknown;
  amount: number;
  pin: unknown;
  city: unknown;
  status: string | null;
}

export type RegionalLevel = "total" | "market" | "tier" | "area" | "metro_city" | "pincode" | "daily_tier";

export interface RegionalAggregate {
  level: RegionalLevel;
  /** Parent grouping: tier id for area/metro/daily rows, area for pincode rows, market id for market rows, "all" for the total. */
  group: string;
  /** Display key: label, area name, pincode, or date (daily rows). */
  key: string;
  /** Period id for period-comparison rows (today, yesterday, last7, mtd); null otherwise. */
  period: string | null;
  fresh_orders: number;
  fresh_app: number;
  fresh_web: number;
  customers: number;
  revenue: number;
  placed_orders: number;
  cancelled_orders: number;
  delivered_orders: number;
  rto_orders: number;
  /** Number of pincodes behind a pincode-level row (> 1 only for the merged small-pincode row); null elsewhere. */
  group_size: number | null;
}

/** Pincodes with fewer distinct customers than this are not shown individually (small-cell suppression). */
export const MIN_CUSTOMERS_PER_PINCODE = 3;
export const SUPPRESSED_PINCODES_KEY = `Other priority pincodes (fewer than ${MIN_CUSTOMERS_PER_PINCODE} customers each)`;

class Acc {
  placed = new Set<string>();
  orders = new Set<string>();
  customers = new Set<string>();
  app = 0;
  web = 0;
  revenue = 0;
  cancelled = 0;
  delivered = 0;
  rto = 0;
  pins = new Set<string>();

  add(o: GeoOrder, pin?: string) {
    if (this.placed.has(o.orderId)) return;
    this.placed.add(o.orderId);
    if (pin) this.pins.add(pin);
    if (o.status !== null && CANCELLED_STATUSES.has(o.status)) this.cancelled++;
    if (!isEligibleNewSale(o.status)) return;
    this.orders.add(o.orderId);
    if (o.userId && o.userId.trim() !== "") this.customers.add(o.userId);
    if (o.platform === "APP") this.app++;
    else this.web++;
    this.revenue += o.amount;
    if (DELIVERED_STATUSES.has(o.status!)) this.delivered++;
    if (RTO_STATUSES.has(o.status!)) this.rto++;
  }

  row(level: RegionalLevel, group: string, key: string, withPins = false, period: string | null = null): RegionalAggregate {
    return {
      level,
      group,
      key,
      period,
      fresh_orders: this.orders.size,
      fresh_app: this.app,
      fresh_web: this.web,
      customers: this.customers.size,
      revenue: Math.round(this.revenue * 100) / 100,
      placed_orders: this.placed.size,
      cancelled_orders: this.cancelled,
      delivered_orders: this.delivered,
      rto_orders: this.rto,
      group_size: withPins ? this.pins.size : null,
    };
  }
}

function bucket<K, V>(map: Map<K, V>, key: K, make: () => V): V {
  let v = map.get(key);
  if (v === undefined) map.set(key, (v = make()));
  return v;
}
const acc = (map: Map<string, Acc>, key: string) => bucket(map, key, () => new Acc());

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function resolveAll(input: readonly GeoOrder[]) {
  // Rule 3: one row per orderID, whatever the source returned.
  const orders = [...new Map(input.map((o) => [o.orderId, o])).values()];
  const resolved = orders.map((o) => ({ o, loc: resolveLocation(o.pin, o.city), pin: String(o.pin ?? "").trim() }));

  // Tier 3 postal districts are labelled by the most common city text among their orders.
  const cityVotes = new Map<string, Map<string, number>>();
  for (const { o, loc } of resolved) {
    if (loc.tier !== "tier_3" || !/^\d{3}xxx$/.test(loc.area)) continue;
    const city = typeof o.city === "string" ? o.city.trim().toLowerCase() : "";
    if (!city) continue;
    const votes = bucket(cityVotes, loc.area, () => new Map<string, number>());
    votes.set(city, (votes.get(city) ?? 0) + 1);
  }
  const areaLabel = (tier: RegionTier, area: string) => {
    if (tier !== "tier_3" || !/^\d{3}xxx$/.test(area)) return area;
    const votes = cityVotes.get(area);
    const top = votes ? [...votes].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] : undefined;
    return top ? `${titleCase(top)} area (${area})` : `Area ${area}`;
  };
  return resolved.map((r) => ({ ...r, area: areaLabel(r.loc.tier, r.loc.area) }));
}

export function aggregateRegional(input: readonly GeoOrder[]): RegionalAggregate[] {
  const total = new Acc();
  const markets = new Map<string, Acc>();
  const tiers = new Map<string, Acc>();
  const areas = new Map<string, Acc>();
  const metros = new Map<string, Acc>();
  const pincodes = new Map<string, Acc>();
  const daily = new Map<string, Acc>();
  const areaTier = new Map<string, RegionTier>();
  const metroTier = new Map<string, RegionTier>();
  const pinArea = new Map<string, string>();
  const pinOrders = new Map<string, GeoOrder[]>();

  for (const { o, loc, pin, area } of resolveAll(input)) {
    total.add(o);
    acc(markets, loc.market).add(o);
    acc(tiers, loc.tier).add(o);
    if (loc.tier !== "unverified") {
      const areaKey = `${loc.tier}|${area}`;
      acc(areas, areaKey).add(o);
      areaTier.set(areaKey, loc.tier);
    }
    if (loc.metroCity) {
      acc(metros, loc.metroCity).add(o);
      metroTier.set(loc.metroCity, loc.tier === "priority_mumbai" ? "tier_1" : loc.tier); // MMR areas span priority pincodes + Tier 1
    }
    if (loc.tier === "priority_mumbai") {
      acc(pincodes, pin).add(o, pin);
      pinArea.set(pin, area);
      bucket(pinOrders, pin, () => [] as GeoOrder[]).push(o);
    }
    acc(daily, `${o.date}|${loc.tier}`).add(o);
  }

  const out: RegionalAggregate[] = [total.row("total", "all", "All Fresh orders")];
  for (const [m, a] of markets) out.push(a.row("market", m, MARKET_LABEL[m as keyof typeof MARKET_LABEL]));
  for (const t of TIER_ORDER) {
    const a = tiers.get(t);
    if (a) out.push(a.row("tier", t, TIER_LABEL[t]));
  }
  for (const [k, a] of areas) out.push(a.row("area", areaTier.get(k)!, k.slice(k.indexOf("|") + 1)));
  for (const [city, a] of metros) out.push(a.row("metro_city", metroTier.get(city)!, city));

  // Priority pincodes: small pincodes are merged into one row so no pincode with < 3 customers is shown.
  const small = new Acc();
  for (const [pin, a] of pincodes) {
    if (a.customers.size >= MIN_CUSTOMERS_PER_PINCODE) out.push(a.row("pincode", pinArea.get(pin) ?? "", pin, true));
    else for (const o of pinOrders.get(pin) ?? []) small.add(o, pin);
  }
  if (small.placed.size) out.push(small.row("pincode", "", SUPPRESSED_PINCODES_KEY, true));

  for (const [k, a] of daily) {
    const [date, tier] = k.split("|");
    out.push(a.row("daily_tier", tier, date));
  }
  return out;
}

export interface PeriodSpec {
  id: string;
  from: string;
  to: string;
}

/** Total and per-tier aggregates for several (possibly overlapping) periods, from one set of orders. */
export function aggregatePeriods(input: readonly GeoOrder[], periods: readonly PeriodSpec[]): RegionalAggregate[] {
  const resolved = resolveAll(input);
  const out: RegionalAggregate[] = [];
  for (const p of periods) {
    const total = new Acc();
    const tiers = new Map<string, Acc>();
    for (const { o, loc } of resolved) {
      if (o.date < p.from || o.date > p.to) continue;
      total.add(o);
      acc(tiers, loc.tier).add(o);
    }
    out.push(total.row("total", "all", "All Fresh orders", false, p.id));
    for (const t of TIER_ORDER) {
      const a = tiers.get(t);
      if (a) out.push(a.row("tier", t, TIER_LABEL[t], false, p.id));
    }
  }
  return out;
}

// ---------- New markets (first-ever eligible Fresh order per pincode / area) ----------

export type NewMarketLevel = "daily" | "range" | "area";

export interface NewMarketAggregate {
  level: NewMarketLevel;
  /** Tier. */
  group: string;
  /** daily: the date; range: "range"; area: the area label. */
  key: string;
  /** area: date of the area's first-ever eligible Fresh order. */
  first_date: string | null;
  /** Pincodes whose first-ever eligible Fresh order falls on this day / in the range / in this area within the range. */
  new_pins: number;
  /** Areas (Tier 3: postal districts) whose first-ever eligible Fresh order falls on this day / in the range. */
  new_areas: number;
  /** Eligible Fresh orders in the day / range placed at pincodes first seen in the range. */
  orders: number;
  /** range only: distinct pincodes / areas with an eligible Fresh order in the range. */
  active_pins: number | null;
  active_areas: number | null;
  /** range only: distinct pincodes with an eligible Fresh order at any time up to the end of the range. */
  ever_pins: number | null;
}

/**
 * "New" = the first eligible Fresh order ever seen at that pincode (or area), over the full order history passed in
 * (Order_Level_V4 starts 25 Oct 2025). `history` must hold every Fresh order up to `to`; only aggregates are returned.
 */
export function aggregateNewMarkets(history: readonly GeoOrder[], from: string, to: string): NewMarketAggregate[] {
  const eligible = resolveAll(history).filter(({ o, loc }) => isEligibleNewSale(o.status) && loc.tier !== "unverified" && o.date <= to);
  const firstPin = new Map<string, string>();
  const firstArea = new Map<string, string>();
  const pinTier = new Map<string, RegionTier>();
  const pinArea = new Map<string, string>();
  for (const { o, loc, pin, area } of eligible) {
    const a = `${loc.tier}|${area}`;
    if (!firstPin.has(pin) || o.date < firstPin.get(pin)!) firstPin.set(pin, o.date);
    if (!firstArea.has(a) || o.date < firstArea.get(a)!) firstArea.set(a, o.date);
    if (!pinTier.has(pin)) {
      pinTier.set(pin, loc.tier);
      pinArea.set(pin, a);
    }
  }
  const inRange = (d: string | undefined) => d !== undefined && d >= from && d <= to;
  const tierOf = (areaKey: string) => areaKey.slice(0, areaKey.indexOf("|"));
  const labelOf = (areaKey: string) => areaKey.slice(areaKey.indexOf("|") + 1);

  const daily = new Map<string, { pins: number; areas: number; orders: number }>();
  const day = (date: string, tier: string) => bucket(daily, `${date}|${tier}`, () => ({ pins: 0, areas: 0, orders: 0 }));
  const range = new Map<string, { pins: number; areas: number; orders: number; active: Set<string>; activeAreas: Set<string>; ever: Set<string> }>();
  const rng = (tier: string) => bucket(range, tier, () => ({ pins: 0, areas: 0, orders: 0, active: new Set<string>(), activeAreas: new Set<string>(), ever: new Set<string>() }));
  const areas = new Map<string, { pins: number; orders: number }>();

  for (const [pin, d] of firstPin) {
    const tier = pinTier.get(pin)!;
    rng(tier).ever.add(pin);
    if (!inRange(d)) continue;
    day(d, tier).pins++;
    rng(tier).pins++;
    const a = pinArea.get(pin)!;
    if (inRange(firstArea.get(a))) bucket(areas, a, () => ({ pins: 0, orders: 0 })).pins++;
  }
  for (const [a, d] of firstArea) {
    if (!inRange(d)) continue;
    day(d, tierOf(a)).areas++;
    rng(tierOf(a)).areas++;
  }
  for (const { o, loc, pin, area } of eligible) {
    if (!inRange(o.date)) continue;
    const r = rng(loc.tier);
    r.active.add(pin);
    r.activeAreas.add(`${loc.tier}|${area}`);
    if (!inRange(firstPin.get(pin))) continue;
    r.orders++;
    day(o.date, loc.tier).orders++;
    const a = areas.get(`${loc.tier}|${area}`);
    if (a) a.orders++;
  }

  const row = (level: NewMarketLevel, group: string, key: string, v: Partial<NewMarketAggregate>): NewMarketAggregate => ({
    level, group, key, first_date: null, new_pins: 0, new_areas: 0, orders: 0, active_pins: null, active_areas: null, ever_pins: null, ...v,
  });
  const out: NewMarketAggregate[] = [];
  for (const t of TIER_ORDER) {
    const r = range.get(t);
    if (r) out.push(row("range", t, "range", { new_pins: r.pins, new_areas: r.areas, orders: r.orders, active_pins: r.active.size, active_areas: r.activeAreas.size, ever_pins: r.ever.size }));
  }
  for (const [k, v] of daily) {
    const [date, tier] = k.split("|");
    out.push(row("daily", tier, date, { new_pins: v.pins, new_areas: v.areas, orders: v.orders }));
  }
  for (const [a, v] of areas) out.push(row("area", tierOf(a), labelOf(a), { first_date: firstArea.get(a)!, new_pins: v.pins, new_areas: 1, orders: v.orders }));
  return out;
}
