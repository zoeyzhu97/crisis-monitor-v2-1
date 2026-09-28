import test from "node:test";
import assert from "node:assert/strict";
import { businessDaysBetween, liveFreshness } from "../src/freshness.js";

test("Friday to Monday counts one workday, not three calendar days", () => {
  assert.equal(businessDaysBetween("2026-09-25", "2026-09-28"), 1);
});

test("US and UK market holidays are not counted as trading days", () => {
  assert.equal(businessDaysBetween("2026-09-04", "2026-09-08", "us"), 1); // Labor Day
  assert.equal(businessDaysBetween("2026-08-28", "2026-09-01", "uk"), 1); // Summer bank holiday
  assert.equal(businessDaysBetween("2022-12-23", "2022-12-28", "uk"), 1); // Christmas substitutes
});

test("an old JSON snapshot becomes stale without a new fetch", () => {
  const snapshot = { credit_spread: { as_of: "2026-09-23", stale: false, stale_bdays: 2 } };
  const monday = liveFreshness(snapshot, "2026-09-28");
  assert.equal(monday.meta.credit_spread.stale, false);
  assert.equal(monday.meta.credit_spread.stale_bdays, 3);
  const tuesday = liveFreshness(snapshot, "2026-09-29");
  assert.equal(tuesday.meta.credit_spread.stale, true);
  assert.equal(tuesday.meta.credit_spread.stale_bdays, 4);
});
