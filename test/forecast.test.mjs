// node test/forecast.test.mjs — the forecaster on demand whose truth we know.
import { tsb, weekday, forecast, reorder } from '../forecast.mjs';
let fail = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail = 1; };
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const poisson = l => { let k = 0, p = Math.exp(-l), s = p, u = rnd(); while (u > s) { k++; p *= l / k; s += p; } return k; };

// Steady demand, weekends double: truth is known exactly.
const truth = d => (d % 7 >= 5 ? 12 : 6);
const steady = [...Array(140)].map((_, i) => poisson(truth(i)));
const f = forecast(steady, 14), err = f.reduce((s, x, k) => s + Math.abs(x - truth(140 + k)), 0) / 14;
ok(err < 1.2, `steady café demand (6/day, 12 at weekends): mean error ${err.toFixed(2)} units/day`);
const w = weekday(steady);
ok(w[5] > 1.4 && w[1] < 0.9, `weekday factors find the weekend: Sat ×${w[5].toFixed(2)}, Tue ×${w[1].toFixed(2)}`);

// Intermittent: sells on 20% of days, 5 units when it does. TSB's rate should be near 1/day.
const inter = [...Array(200)].map(() => (rnd() < 0.2 ? 5 : 0)), r = tsb(inter);
ok(Math.abs(r.rate - 1) < 0.35, `intermittent item (20% of days × 5): rate ${r.rate.toFixed(2)}/day (truth 1)`);

// An item that stopped selling: TSB must decay towards zero (Croston would keep forecasting the old rate).
const dead = [...inter.slice(0, 100), ...Array(60).fill(0)];
ok(tsb(dead).rate < 0.05, `item that stopped selling 60 days ago: rate ${tsb(dead).rate.toFixed(3)}/day`);

// Reorder: enough for lead + review with a margin; nothing when well stocked.
const ro = reorder(20, steady);
ok(ro.runsOutIn <= 4 && ro.order >= 60 && ro.order <= 110, `20 in stock: runs out in ${ro.runsOutIn} days, order ${ro.order}`);
ok(reorder(500, steady).order === 0, 'well stocked: order nothing');
ok(reorder(5, Array(30).fill(0)).order === 0 && forecast([], 3).every(x => x === 0), 'no history: no order, no crash');
process.exit(fail);
