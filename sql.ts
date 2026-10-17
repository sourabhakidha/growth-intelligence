import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";

// Every reporting query lives in lib/sql/*.sql (version-controlled, reviewed). Only names in this list can be
// loaded, so no request input can ever choose or build SQL.
export const SQL_FILES = [
  "orders_daily",
  "orders_unique_customers",
  "orders_payment_mix",
  "meta_ad_daily",
  "meta_account_daily",
  "meta_spend_check",
  "af_events_daily",
  "af_ad_daily",
  "app_funnel_daily",
  "cart_leads_daily",
  "cart_lead_lifecycle_daily",
  "regions_daily",
  "unmapped_cities",
  "source_freshness",
] as const;

export type SqlName = (typeof SQL_FILES)[number];

const cache = new Map<SqlName, string>();

export function loadSql(name: SqlName): string {
  if (!SQL_FILES.includes(name)) throw new Error(`Unknown SQL file: ${name}`);
  const hit = cache.get(name);
  if (hit) return hit;
  const text = readFileSync(path.join(process.cwd(), "lib", "sql", `${name}.sql`), "utf8");
  cache.set(name, text);
  return text;
}
