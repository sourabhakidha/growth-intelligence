// Fails if any output schema or reporting SQL could carry customer PII to the browser.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ALL_ROW_SCHEMAS } from "../lib/types/schemas.ts";

const FORBIDDEN_KEY = /(phone|mobile|email|name$|^name|first_name|last_name|address|street|landmark|pincode|pin_code|prescription|patient(?!_age)|cx_|cxphone|user_id|userid|customer_user_id|appsflyer_id|advertising_id|idfa|order_?id|lead_id)/i;

// Keys that look similar but are aggregate labels, not personal data.
const ALLOWED = new Set(["campaign_name", "adset_name", "ad_name", "event_name", "avg_patient_age"]);

test("no output schema exposes a PII-like field", () => {
  for (const [schemaName, schema] of Object.entries(ALL_ROW_SCHEMAS)) {
    for (const key of Object.keys(schema.shape)) {
      if (ALLOWED.has(key)) continue;
      assert.ok(!FORBIDDEN_KEY.test(key), `${schemaName}.${key} looks like PII`);
    }
  }
});

const SQL_DIR = path.join(import.meta.dirname, "..", "lib", "sql");
const sqlFiles = readdirSync(SQL_DIR).filter((f) => f.endsWith(".sql"));

// Columns that must never appear anywhere in reporting SQL (not even in joins).
const NEVER_SELECT = [
  "cx_first_name", "cx_last_name", "patientName", "cx_add_street_1", "cx_add_street_2", "cx_landmark",
  "prescriptionURL", "customerName", "customer_name", "contact_number", "username", "item_names", "itemName",
];

test("reporting SQL never references name, address or prescription columns", () => {
  for (const f of sqlFiles) {
    const sql = readFileSync(path.join(SQL_DIR, f), "utf8");
    for (const col of NEVER_SELECT) {
      assert.ok(!new RegExp(`\\b${col}\\b`, "i").test(stripComments(sql)), `${f} references ${col}`);
    }
  }
});

test("reporting SQL contains no write or DDL statements", () => {
  const WRITE = /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|comment\s+on|copy|vacuum|refresh\s+materialized)\b/i;
  for (const f of sqlFiles) {
    const body = stripComments(readFileSync(path.join(SQL_DIR, f), "utf8"));
    assert.ok(!WRITE.test(body), `${f} contains a write/DDL keyword`);
    assert.ok(!/select\s+\*/i.test(body), `${f} uses select *`);
  }
});

test("every SQL file is registered in lib/db/sql.ts and vice versa", () => {
  const reg = readFileSync(path.join(import.meta.dirname, "..", "lib", "db", "sql.ts"), "utf8");
  const listed = [...reg.matchAll(/^\s+"([a-z_]+)",$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(listed, sqlFiles.map((f) => f.replace(/\.sql$/, "")).sort());
});

function stripComments(sql: string): string {
  return sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
}

test("Supabase query implementations never read name, address or prescription columns, and never write", () => {
  const src = readFileSync(path.join(import.meta.dirname, "..", "lib", "db", "queries.ts"), "utf8");
  for (const col of NEVER_SELECT) {
    assert.ok(!new RegExp(`\b${col}\b`, "i").test(src), `queries.ts references ${col}`);
  }
  const client = readFileSync(path.join(import.meta.dirname, "..", "lib", "db", "supabase.ts"), "utf8");
  for (const src2 of [src, client]) {
    assert.ok(!/\.(insert|update|upsert|delete|rpc)\(/.test(src2), "Supabase layer calls a write/RPC method");
    assert.ok(!/columns:\s*["'`]\*["'`]/.test(src2), "Supabase layer selects *");
  }
});
