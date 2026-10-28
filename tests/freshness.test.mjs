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
  assert.equal(monday.meta.credit_spread.stale, true);
  assert.equal(monday.meta.credit_spread.stale_bdays, 3);
  const tuesday = liveFreshness(snapshot, "2026-09-29");
  assert.equal(tuesday.meta.credit_spread.stale, true);
  assert.equal(tuesday.meta.credit_spread.stale_bdays, 4);
});

 test("daily indicators allow two publication business days; other thresholds stay unchanged", () => {
   const snapshot = Object.fromEntries(["credit_spread", "uk_10y", "vix"].map(k => [k, {as_of: "2026-10-23"}]));
   assert.equal(liveFreshness(snapshot, "2026-10-26").meta.uk_10y.stale, false);
   const result = liveFreshness(snapshot, "2026-10-27").meta;
   assert.equal(result.credit_spread.stale, false);
   assert.equal(result.uk_10y.stale, false);
   assert.equal(result.vix.stale, false);
 });

// Exercise the actual app scoring functions, without needing a browser/React DOM.
import { readFileSync } from 'node:fs';
const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const definitions = appSource.slice(appSource.indexOf('const INDICATORS'), appSource.indexOf('// 历史危机'));
const scoring = appSource.slice(appSource.indexOf('function scoreOne'), appSource.indexOf('function rc'));
const compute = new Function(`${definitions}\n${scoring}\nreturn computeAll;`)();
test('delayed valid inputs retain the same score and weights', () => {
  const values = {credit_spread: 600, vix: 20, us_10y: 4.5, uk_10y: 5.8, brent: 80, gbp_cny: 9.2, gold: 3500, dxy: 100};
  const delayed = Object.fromEntries(Object.keys(values).map(k => [k, {stale: true}]));
  assert.deepEqual(compute(values, {}, delayed), compute(values, {}, null));
  assert.equal(compute(values, {}, delayed).scores[3], 9.5);
  assert.ok(compute(values, {}, delayed).overall >= 5.95);
});
