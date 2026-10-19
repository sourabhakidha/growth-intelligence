// Internal check of the pincode → region mapping in lib/geo/regions.ts against every eligible Fresh order.
// Developer tool only: its output (pincodes, city text) is never shown on the dashboard.
//
//   npm run validate:regions            (reads .env.local: SUPABASE_URL, SUPABASE_SERVICE_KEY)
//
// Read-only: SELECTs over Supabase REST. Prints aggregate counts — no order IDs, user IDs or phone numbers.

import { createClient } from "@supabase/supabase-js";
import { PRIORITY_MUMBAI_PINCODES, TIER_LABEL, TIER_ORDER, resolveLocation, type RegionTier } from "../lib/geo/regions.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error("Set SUPABASE_URL and SUPABASE_SERVICE_KEY (e.g. node --env-file=.env.local ...)");
const sb = createClient(url, key, { auth: { persistSession: false } });

type Order = { orderID: string; pinCode: string | null; city: string | null; state: string | null };

async function readEligibleFresh(): Promise<Order[]> {
  const out: Order[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from("Order_Level_V4")
      .select("orderID,pinCode,city,state")
      .in("orderPlatform", ["APP", "WEB"])
      .eq("Order_Type", "Fresh")
      .not("status", "in", "(PRESCRIPTION_UPLOADED,DELIVERY_CANCELED,THREE_PL_CANCELLED_ACKNOWLEDGEMENT)")
      .order("orderID")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data as Order[]));
    if (!data || data.length < 1000) return out;
  }
}

/** City-text keywords for each metro family; used to spot orders whose city text points somewhere else. */
const FAMILY: [string, RegExp][] = [
  ["Mumbai region", /mumbai|thane|kalyan|dombivli|dombivali|navi mumbai|panvel|vasai|virar|bhiwandi|ulhasnagar|ambernath|badlapur|mira|bhayandar|palghar|raigad|kharghar/],
  ["Delhi NCR", /delhi|gurgaon|gurugram|noida|ghaziabad|faridabad|gautam buddha/],
  ["Pune", /pune|pimpri|chinchwad/],
  ["Ahmedabad", /ahmedabad/], ["Vadodara", /vadodara|baroda/], ["Nagpur", /nagpur/], ["Chandigarh", /chandigarh/],
  ["Jaipur", /jaipur/], ["Chennai", /chennai/], ["Kolkata", /kolkata|howrah/], ["Bhopal", /bhopal/], ["Indore", /indore/],
  ["Lucknow", /lucknow/], ["Hyderabad", /hyderabad|secunderabad/], ["Patna", /patna/],
  ["Bangalore", /bangalore|bengaluru/], ["Surat", /surat/], ["Visakhapatnam", /visakhapatnam|vizag/],
];
const familyOfText = (city: string) => FAMILY.find(([, re]) => re.test(city))?.[0] ?? null;
const familyOfArea = (tier: RegionTier, area: string) => {
  if (tier === "priority_mumbai" || (tier === "tier_1" && /mumbai|thane|navi|panvel|dombivli|kalyan|mira|vasai|bhiwandi|ulhasnagar|ambernath|palghar|raigad/i.test(area))) return "Mumbai region";
  if (tier === "delhi_ncr") return "Delhi NCR";
  if (area === "Pimpri-Chinchwad") return "Pune";
  if (area === "Howrah") return "Kolkata";
  if (area === "Secunderabad") return "Hyderabad";
  return familyOfText(area.toLowerCase());
};

/** India Post postal circles by first two digits, for a state-text sanity check. */
const CIRCLE: [RegExp, RegExp][] = [
  [/^11/, /delhi/], [/^1[23]/, /haryana/], [/^1[4-5]/, /punjab/], [/^16/, /chandigarh|punjab|haryana/], [/^17/, /himachal/],
  [/^1[89]/, /jammu|kashmir|ladakh/], [/^2[0-8]/, /uttar pradesh|uttarakhand/], [/^3[0-4]/, /rajasthan/],
  [/^3[6-9]/, /gujarat|dadra|daman/], [/^4[0-4]/, /maharashtra|goa/], [/^4[5-8]/, /madhya pradesh|chhattisgarh/],
  [/^49/, /chhattisgarh/], [/^50/, /telangana|andhra/], [/^5[1-3]/, /andhra|telangana/], [/^5[6-9]/, /karnataka/],
  [/^6[0-4]/, /tamil nadu|puducherry|pondicherry/], [/^6[7-9]/, /kerala|lakshadweep/], [/^7[0-4]/, /west bengal|sikkim|andaman/],
  [/^7[5-7]/, /odisha|orissa/], [/^78/, /assam/], [/^79/, /arunachal|manipur|meghalaya|mizoram|nagaland|tripura|assam/],
  [/^8[0-5]/, /bihar|jharkhand/],
];

const orders = await readEligibleFresh();
const tierCount = new Map<RegionTier, number>();
const conflicts = new Map<string, number>();
const tier3Metro = new Map<string, number>();
let stateChecked = 0;
let stateMismatch = 0;
const seenPriority = new Set<string>();

for (const o of orders) {
  const pin = (o.pinCode ?? "").trim();
  const city = (o.city ?? "").trim().toLowerCase();
  const loc = resolveLocation(pin, city);
  tierCount.set(loc.tier, (tierCount.get(loc.tier) ?? 0) + 1);
  if (loc.tier === "priority_mumbai") seenPriority.add(pin);

  const textFamily = familyOfText(city);
  if (loc.tier === "tier_3" || loc.tier === "unverified") {
    if (textFamily) tier3Metro.set(`${textFamily} ← ${pin.slice(0, 3)}xxx`, (tier3Metro.get(`${textFamily} ← ${pin.slice(0, 3)}xxx`) ?? 0) + 1);
  } else {
    const areaFamily = familyOfArea(loc.tier, loc.area);
    if (textFamily && areaFamily && textFamily !== areaFamily) {
      const k = `${TIER_LABEL[loc.tier]} / ${loc.area}: city text says ${textFamily}`;
      conflicts.set(k, (conflicts.get(k) ?? 0) + 1);
    }
  }

  const state = (o.state ?? "").trim().toLowerCase();
  const circle = CIRCLE.find(([p]) => p.test(pin));
  if (circle && state) {
    stateChecked++;
    if (!circle[1].test(state)) stateMismatch++;
  }
}

const top = (m: Map<string, number>, n = 15) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
console.log(`Eligible Fresh orders checked: ${orders.length}\n`);
console.log("Orders by tier:");
for (const t of TIER_ORDER) console.log(`  ${TIER_LABEL[t].padEnd(28)} ${tierCount.get(t) ?? 0}`);
console.log(`\nPincode vs city-text conflicts in mapped tiers (${[...conflicts.values()].reduce((a, b) => a + b, 0)} orders):`);
for (const [k, n] of top(conflicts)) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`\nTier 3 / unverified orders whose city text names a metro (${[...tier3Metro.values()].reduce((a, b) => a + b, 0)} orders):`);
for (const [k, n] of top(tier3Metro)) console.log(`  ${String(n).padStart(4)}  ${k}`);
console.log(`\nState text vs postal circle: ${stateMismatch} mismatches of ${stateChecked} checked.`);
console.log(`Priority pincodes with at least one eligible Fresh order (all time): ${seenPriority.size} of ${PRIORITY_MUMBAI_PINCODES.size}.`);
