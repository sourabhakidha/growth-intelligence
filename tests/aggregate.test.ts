// The TypeScript ports in lib/db/queries.ts must keep the Postgres semantics of lib/sql/*.sql.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  channelOf,
  countDistinct,
  firstLeadPerPhonePerDay,
  isCountableCartLead,
  istDateOfInstant,
  istWallClockToEpoch,
  median,
  pgTrim,
  round1,
  sumOrNull,
} from "../lib/db/aggregate.ts";

test("channel rule matches the SQL CASE", () => {
  assert.equal(channelOf("APP"), "APP");
  assert.equal(channelOf("WEB"), "WEB");
});

test("IST date and wall-clock conversions", () => {
  assert.equal(istDateOfInstant("2026-10-13T18:29:59+00:00"), "2026-10-13");
  assert.equal(istDateOfInstant("2026-10-13T18:30:00+00:00"), "2026-10-14");
  assert.equal(istWallClockToEpoch("2026-10-14T00:00:00"), Date.parse("2026-10-13T18:30:00Z"));
});

test("aggregates follow Postgres null handling", () => {
  assert.equal(sumOrNull([null, null]), null);
  assert.equal(sumOrNull([1, null, "2.5"]), 3.5);
  assert.equal(countDistinct(["a", "a", null, "b"]), 2);
  assert.equal(countDistinct(["a", "", null], true), 1);
  assert.equal(median([]), null);
  assert.equal(median([3, null, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(round1(2.25), 2.3);
  assert.equal(pgTrim("  Mumbai \t"), "Mumbai \t");
});

test("crm_025a: filters re-runs and duplicate merges, keeps earliest lead per phone per IST day", () => {
  assert.equal(isCountableCartLead("abc#r2", null), false);
  assert.equal(isCountableCartLead(null, "duplicate_merged"), false);
  assert.equal(isCountableCartLead(null, null), true);
  const leads = firstLeadPerPhonePerDay([
    { id: 3, phone: "p1", d: "2026-10-13", createdMs: 200 },
    { id: 2, phone: "p1", d: "2026-10-13", createdMs: 100 },
    { id: 1, phone: "p1", d: "2026-10-13", createdMs: 100 },
    { id: 4, phone: "p1", d: "2026-10-14", createdMs: 300 },
    { id: 5, phone: "p2", d: "2026-10-13", createdMs: 50 },
  ]);
  assert.deepEqual(leads.map((l) => l.id).sort(), [1, 4, 5]);
});
