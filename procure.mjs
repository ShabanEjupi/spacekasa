// The procurement agent, end to end: forecast what will run out from the till's sales, haggle with the supplier's
// agent, have the mandate verifier rule on the deal, pay inside the mandate (PayPal Payouts) or stop for a human.
// Pure orchestration: payment and clock are passed in, so the whole loop is testable without PayPal.
import { reorder } from './forecast.mjs';
import { negotiate } from './negotiate.mjs';
import { check, canonical } from './mandate.mjs';
import { createHash } from 'node:crypto';
const sha256 = s => createHash('sha256').update(s).digest('hex');

const DAY = 864e5;
// Daily use of each supply over the last `days` days, from paid sales: sold qty × bill of materials.
export function usage(sales, supplies, days, now) {
  const start = now - days * DAY, out = Object.fromEntries(supplies.items.map(s => [s.sku, Array(days).fill(0)]));
  for (const sale of sales) {
    const d = Math.floor((Date.parse(sale.at) - start) / DAY);
    if (d < 0 || d >= days) continue;
    for (const l of sale.lines) for (const s of supplies.items) out[s.sku][d] += (s.uses[l.sku] || 0) * l.qty;
  }
  return out;
}
// Eight weeks of a plausible café (weekends busier), for the demo when the till has little history. Seeded, labelled.
export function simulatedSales(now, days = 56, seed = 5) {
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648, out = [];
  const mix = [['COF-ESP', 30], ['COF-MAC', 45], ['COF-CAP', 18], ['COF-LAT', 8], ['HOT-CHO', 4], ['COF-ICE', 5]];
  for (let d = 0; d < days; d++) {
    const t = now - (days - d) * DAY, weekend = [0, 6].includes(new Date(t).getUTCDay()) ? 1.6 : 1;
    for (const [sku, n] of mix) { const qty = Math.round(n * weekend * (0.75 + rnd() * 0.5)); if (qty) out.push({ at: new Date(t + 9 * 36e5).toISOString(), lines: [{ sku, qty }], simulated: true }); }
  }
  return out;
}

// One run. ctx = { supplies, sales, mandates, pub, history, now, seller(item) → { respond }, pay(item, deal) → { id } }
// Returns a trace a human can read: per item the forecast, every offer, the verdict and the payment.
export async function run(ctx) {
  const { supplies, mandates, pub, now } = ctx, trace = [], days = 56;
  const use = usage(ctx.sales, supplies, days, now), dow0 = (new Date(now - days * DAY).getUTCDay() + 6) % 7;
  for (const item of supplies.items) {
    const series = use[item.sku].map(x => Math.round(x * 100) / 100);
    const plan = reorder(item.stock, series, { dow0 });
    const t = { sku: item.sku, stock: item.stock, perDay: +(series.slice(-28).reduce((s, x) => s + x, 0) / 28).toFixed(2), ...plan };
    trace.push(t);
    if (!plan.order) { t.outcome = 'enough stock'; continue; }
    const at = new Date(now).toISOString();
    // Never split an order to get round the per-order limit: buy what fits in one order, leave the rest to a human.
    const m = mandates.find(x => x.agent === 'procurement' && x.skus.includes(item.sku));
    const fits = m ? Math.floor(m.perOrder / (item.reference * m.priceFactor)) : plan.order, qty = Math.min(plan.order, fits);
    if (qty < plan.order) t.short = plan.order - qty;
    if (!qty) { t.outcome = 'needs a human'; t.why = `one unit is over the ${m.perOrder} per-order limit`; continue; }
    // The seller is another party: we learn its prices only from the offers it sends.
    let n;
    try {
      n = await negotiate({ open: item.reference * 0.8, limit: item.reference * 1.2, beta: 0.5, qty, sku: item.sku,
                            supplier: supplies.supplier.id, mandates, pub, history: ctx.history, at }, ctx.seller(item));
    } catch (e) { t.outcome = 'needs a human'; t.why = `supplier unreachable: ${e.message}`; continue; }
    t.offers = n.log;
    if (!n.deal) {
      // No deal inside the mandate: the human sees why, and what the agent would have needed.
      t.outcome = 'needs a human'; t.why = n.log.at(-1).why; continue;
    }
    const action = { agent: 'procurement', kind: 'buy', supplier: supplies.supplier.id, lines: [{ sku: item.sku, qty: n.deal.qty, unit: n.deal.unit }], at };
    const verdict = check(action, mandates, pub, ctx.history);
    t.deal = n.deal; t.verdict = verdict;
    if (!verdict.ok) { t.outcome = 'needs a human'; t.why = verdict.reasons.join('; '); continue; }
    // The contract: the seller's signed acceptance. Its hash travels with the payout into the audit chain.
    t.contract = n.deal.seller?.sig ? sha256(canonical(n.deal.seller)) : null;
    const paid = await ctx.pay(item, n.deal, t.contract);
    ctx.history.push({ ...action, mandate: verdict.mandate, payout: paid.id, contract: t.contract });
    item.stock += n.deal.qty;
    t.outcome = t.short ? 'paid part' : 'paid'; t.payout = paid.id; t.total = Math.round(n.deal.unit * n.deal.qty * 100) / 100;
  }
  return trace;
}
