// Recalculate freshness in the browser: latest.json is a snapshot, not a live status.
const DAY = 86400000;
const iso = d => d.toISOString().slice(0, 10);
const at = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const plus = (d, n) => new Date(d.getTime() + n * DAY);
const weekday = d => d.getUTCDay();
const monday = (y, m, n) => plus(at(y, m, 1), (8 - weekday(at(y, m, 1))) % 7 + 7 * (n - 1));
const lastMonday = (y, m) => {
  const end = at(y, m + 1, 0);
  return plus(end, -((weekday(end) + 6) % 7));
};
const observed = d => weekday(d) === 6 ? plus(d, -1) : weekday(d) === 0 ? plus(d, 1) : d;

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return at(y, Math.floor(n / 31), n % 31 + 1);
}

function holidays(y, market) {
  const e = easter(y);
  if (market === "uk") {
    const christmas = at(y, 12, 25), boxing = at(y, 12, 26);
    const newYear = at(y, 1, 1);
    const christmasObserved = weekday(christmas) >= 1 && weekday(christmas) <= 5 ? christmas : at(y, 12, 27);
    return [newYear, weekday(newYear) === 6 ? at(y, 1, 3) : weekday(newYear) === 0 ? at(y, 1, 2) : newYear,
      plus(e, -2), plus(e, 1), monday(y, 5, 1), lastMonday(y, 5), lastMonday(y, 8),
      christmasObserved,
      weekday(boxing) >= 1 && weekday(boxing) <= 5 && iso(boxing) !== iso(christmasObserved) ? boxing : at(y, 12, 28)];
  }
  if (market === "us") return [observed(at(y, 1, 1)), monday(y, 1, 3), monday(y, 2, 3),
    plus(e, -2), lastMonday(y, 5), observed(at(y, 6, 19)), observed(at(y, 7, 4)),
    monday(y, 9, 1), plus(at(y, 11, 1), (4 - weekday(at(y, 11, 1)) + 7) % 7 + 21),
    observed(at(y, 12, 25))];
  return [];
}

const US_KEYS = new Set(["credit_spread", "vix", "us_10y", "nasdaq", "hyg", "iei"]);
const PRIMARY_KEYS = ["credit_spread", "vix", "us_10y", "uk_10y", "brent", "gbp_cny", "gold", "dxy"];

export function businessDaysBetween(asOf, today, market = "weekday") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(today ?? "")) return null;
  const start = new Date(`${asOf}T00:00:00Z`), end = new Date(`${today}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return null;
  if (end <= start) return 0;
  const closed = new Set();
  for (let y = start.getUTCFullYear() - 1; y <= end.getUTCFullYear() + 1; y++) {
    holidays(y, market).forEach(d => closed.add(iso(d)));
  }
  let count = 0;
  for (let d = plus(start, 1); d <= end; d = plus(d, 1)) {
    if (weekday(d) !== 0 && weekday(d) !== 6 && !closed.has(iso(d))) count++;
  }
  return count;
}

export function liveFreshness(meta, today) {
  if (!meta) return { meta: null, freshness: null };
  const current = Object.fromEntries(Object.entries(meta).map(([key, item]) => {
    const market = key === "uk_10y" ? "uk" : US_KEYS.has(key) ? "us" : "weekday";
    const staleBdays = businessDaysBetween(item?.as_of, today, market);
    return [key, { ...item, stale_bdays: staleBdays, stale: staleBdays == null || staleBdays > 3 }];
  }));
  const oldest = PRIMARY_KEYS.map(key => [key, current[key]]).filter(([, item]) => item?.stale_bdays != null)
    .sort((a, b) => b[1].stale_bdays - a[1].stale_bdays)[0];
  return { meta: current, freshness: oldest ? {
    oldest_key: oldest[0], oldest_as_of: oldest[1].as_of, oldest_bdays: oldest[1].stale_bdays,
  } : null };
}
