// Business-rule guards: the agreed definitions must stay in the SQL exactly as written.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (f: string) =>
  readFileSync(path.join(import.meta.dirname, "..", "lib", "sql", f), "utf8")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

const EXCLUSIONS = "status not in ('PRESCRIPTION_UPLOADED', 'DELIVERY_CANCELED', 'THREE_PL_CANCELLED_ACKNOWLEDGEMENT')";

test("every new-sales query applies exactly the three agreed status exclusions", () => {
  for (const f of ["orders_daily.sql", "orders_unique_customers.sql", "orders_payment_mix.sql", "regional_fresh.sql"]) {
    const sql = read(f);
    assert.ok(sql.includes(EXCLUSIONS), `${f} is missing the agreed exclusion list`);
    assert.ok(!/RTO_|'CANCELLED'|DR_REJECTED/.test(sql), `${f} excludes extra statuses`);
  }
});

test("channel is APP (self-serve) vs WEB (sales-assisted) only, never split by agent", () => {
  for (const f of ["orders_daily.sql", "orders_unique_customers.sql", "orders_payment_mix.sql", "cart_lead_lifecycle_daily.sql", "regional_fresh.sql"]) {
    const sql = read(f);
    assert.ok(/'APP' then 'APP'/.test(sql) && /else 'WEB'/.test(sql), `${f} channel mapping changed`);
    assert.ok(!/Internal_Team|WEB_AGENT|WEB_OTHER/.test(sql), `${f} splits WEB by agent`);
  }
});

test("cart leads use the written crm_025a rule, not the drifted live function", () => {
  for (const f of ["cart_leads_daily.sql", "cart_lead_lifecycle_daily.sql"]) {
    const sql = read(f);
    assert.ok(sql.includes("l.lead_type = 'cart'"), `${f}: lead_type`);
    assert.ok(sql.includes("not like '%#r%'"), `${f}: #r re-runs`);
    assert.ok(sql.includes("is distinct from 'duplicate_merged'"), `${f}: duplicate_merged`);
    assert.ok(/distinct on \(phone, d\)/.test(sql), `${f}: one lead per phone per IST day`);
    assert.ok(sql.includes("'Asia/Kolkata'"), `${f}: IST dates`);
    for (const banned of ["cart_leads_std", "cart_lead_daily", "lead_rep", "lead_merge_std", "cart_realtime", "cart_merge_view"]) {
      assert.ok(!new RegExp(`\\b${banned}\\b`).test(sql), `${f} must not use ${banned}`);
    }
  }
  const daily = read("cart_leads_daily.sql");
  assert.ok(daily.includes("o.status = 'COMPLETED'"), "repeat = earlier COMPLETED order");
  assert.ok(daily.includes("fo.first_completed_at < m.created_at"), "repeat compares against lead time");
});

test("GA4 funnel compares day as YYYYMMDD, never with dashes", () => {
  const sql = read("app_funnel_daily.sql");
  assert.ok(sql.includes("to_char($1::date, 'YYYYMMDD')"));
  assert.ok(!/f\.day\s*(>=|<=|between)\s*'\d{4}-/.test(sql));
});
