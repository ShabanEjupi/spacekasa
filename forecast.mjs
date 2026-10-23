// Demand forecasting from the till's own sales, for the procurement agent. Café items sell intermittently (no milk
// sold some days, ten litres others), so the core is TSB (Teunter, Syntetos & Babai, 2011): it smooths the chance
// that an item sells on a day and the size of the sale separately, and unlike Croston it decays when an item stops
// selling. Weekday multipliers carry the weekly rhythm (Saturdays are not Tuesdays).

// series: units sold per day, oldest first, series[0] is a Monday + offset (dow0 = weekday of day 0, 0 = Monday).
export function tsb(series, a = 0.1, b = 0.1) {
  const first = series.findIndex(x => x > 0);
  if (first < 0) return { p: 0, z: 0, rate: 0 };
  let p = series.filter(x => x > 0).length / series.length, z = series[first];
  for (const x of series) { p += b * ((x > 0 ? 1 : 0) - p); if (x > 0) z += a * (x - z); }
  return { p, z, rate: p * z };
}
export function weekday(series, dow0 = 0) {
  const sum = Array(7).fill(0), n = Array(7).fill(0);
  series.forEach((x, i) => { const d = (dow0 + i) % 7; sum[d] += x; n[d]++; });
  const mean = series.reduce((s, x) => s + x, 0) / (series.length || 1);
  // Shrink towards 1 with few weeks of data, so one odd Saturday does not become a rule.
  return sum.map((s, d) => { const w = n[d] / (n[d] + 2), f = mean ? s / n[d] / mean : 1; return n[d] ? w * f + (1 - w) : 1; });
}
// Expected units per day for the next `days` days.
export function forecast(series, days, dow0 = 0) {
  const f = weekday(series, dow0), deseason = series.map((x, i) => x / (f[(dow0 + i) % 7] || 1)), { rate } = tsb(deseason);
  return [...Array(days)].map((_, k) => rate * f[(dow0 + series.length + k) % 7]);
}
// How much to order now so stock lasts through the lead time plus the next review period, with a safety margin
// that grows with the item's day-to-day volatility. Returns { runsOutIn, order }.
export function reorder(stock, series, { lead = 2, review = 7, z = 1.65, dow0 = 0 } = {}) {
  const f = forecast(series, lead + review + 60, dow0);
  let left = stock, runsOutIn = Infinity;
  for (let k = 0; k < f.length; k++) { left -= f[k]; if (left < 0) { runsOutIn = k; break; } }
  const need = f.slice(0, lead + review).reduce((s, x) => s + x, 0);
  const mean = series.reduce((s, x) => s + x, 0) / series.length, sd = Math.sqrt(series.reduce((s, x) => s + (x - mean) ** 2, 0) / series.length);
  const safety = z * sd * Math.sqrt(lead + review);
  return { runsOutIn, order: Math.max(0, Math.ceil(need + safety - stock)) };
}
