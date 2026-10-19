import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCount, formatINR, formatINRCompact, formatPct, pctChange, safeDiv } from "../lib/format/inr.ts";
import { addDays, daysBetween, parseRange, presetRange, previousPeriod, todayIST } from "../lib/format/ist.ts";

test("Indian number grouping and INR", () => {
  assert.equal(formatCount(1234567), "12,34,567");
  assert.equal(formatINR(1189584), "₹11,89,584");
  assert.equal(formatINR(null), "—");
  assert.equal(formatINRCompact(1189584), "₹11.9 L");
  assert.equal(formatINRCompact(12500000), "₹1.25 Cr");
  assert.equal(formatINRCompact(1361), "₹1.36K");
  assert.equal(formatPct(0.2481), "24.8%");
});

test("ratios never return Infinity", () => {
  assert.equal(safeDiv(10, 0), null);
  assert.equal(pctChange(5, 0), null);
  assert.equal(pctChange(110, 100), 0.1);
});

test("IST today is computed in Asia/Kolkata, not UTC", () => {
  // 20:00 UTC on 16 Oct = 01:30 IST on 17 Oct
  assert.equal(todayIST(new Date("2026-10-16T20:00:00Z")), "2026-10-17");
  assert.equal(todayIST(new Date("2026-10-16T18:00:00Z")), "2026-10-16");
});

test("date ranges", () => {
  assert.deepEqual(presetRange("mtd", "2026-10-17"), { from: "2026-10-01", to: "2026-10-17" });
  assert.deepEqual(presetRange("lastMonth", "2026-10-17"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepEqual(previousPeriod({ from: "2026-10-01", to: "2026-10-16" }), { from: "2026-09-15", to: "2026-09-30" });
  assert.equal(daysBetween("2026-10-01", "2026-10-16"), 16);
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
});

test("parseRange rejects bad input and falls back to MTD", () => {
  const today = "2026-10-17";
  assert.equal(parseRange({ from: "2026-10-05", to: "2026-10-09" }, today).isDefault, false);
  assert.equal(parseRange({ from: "2026-10-09", to: "2026-10-05" }, today).isDefault, true);
  assert.equal(parseRange({ from: "2026-02-30", to: "2026-03-01" }, today).isDefault, true);
  assert.equal(parseRange({ from: "'; drop table x;--", to: "2026-10-01" }, today).isDefault, true);
  assert.equal(parseRange({ from: "2024-01-01", to: "2026-10-01" }, today).isDefault, true);
  assert.deepEqual(parseRange({ from: "2026-10-10", to: "2026-12-31" }, today), { from: "2026-10-10", to: today, isDefault: false });
});
