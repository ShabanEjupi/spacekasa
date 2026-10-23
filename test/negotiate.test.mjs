// node test/negotiate.test.mjs — two agents trade; the mandate bounds every deal, whatever the supplier tries.
import { keys, signMandate } from '../mandate.mjs';
import { negotiate, curve } from '../negotiate.mjs';
let fail = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail = 1; };
const owner = keys();
const M = signMandate({ id: 'M-1', agent: 'procurement', kind: 'buy', skus: ['milk-1l'], suppliers: ['S-0042'], perOrder: 60, perWeek: 200,
  priceFactor: 1.1, reference: { 'milk-1l': 0.9 }, from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z' }, owner.priv);
const buyer = (o = {}) => ({ open: 0.7, limit: 1.2, beta: 0.5, qty: 40, sku: 'milk-1l', supplier: 'S-0042', mandates: [M], pub: owner.pub, history: [], at: '2026-10-26T09:00:00Z', ...o });

ok(curve(1, 2, 0, 10, 1) === 1 && curve(1, 2, 10, 10, 1) === 2 && curve(1, 2, 5, 10, 0.5) < 1.5, 'concession curve: opens, ends at the limit, Boulware holds firm');
const a = await negotiate(buyer(), { open: 1.3, floor: 0.8, beta: 1, stock: 500 });
ok(a.deal && a.deal.unit >= 0.8 && a.deal.unit <= 0.99, `fair supplier: deal at ${a.deal?.unit} after ${a.deal?.round} rounds, between its floor 0.8 and the mandate's 0.99`);
// The buyer agent's own limit (1.2) is looser than the mandate; the mandate wins.
const b = await negotiate(buyer(), { open: 1.5, floor: 1.05, beta: 1, stock: 500 });
ok(!b.deal, `supplier who will not go below 1.05: no deal, the agent walks away (${b.log.at(-1).why ?? ''})`);
const c = await negotiate(buyer({ qty: 80 }), { open: 1.0, floor: 0.85, beta: 2, stock: 500 });
ok(!c.deal || c.deal.unit * c.deal.qty <= 60, `80 litres would break the 60 per-order limit: ${c.deal ? 'deal ' + c.deal.unit : 'no deal'} (${c.log.at(-1).why ?? ''})`);
const d = await negotiate(buyer(), { open: 1.2, floor: 0.6, beta: 3, stock: 25 });
ok(d.deal && d.deal.qty === 25, `supplier has only 25: deal for ${d.deal?.qty}`);
// Many random suppliers: no deal ever breaks the mandate.
let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let deals = 0, bad = 0;
for (let i = 0; i < 500; i++) {
  const floor = 0.5 + rnd(), r = await negotiate(buyer({ qty: 1 + Math.floor(rnd() * 70), beta: 0.3 + rnd() * 2 }), { open: floor + rnd(), floor, beta: 0.3 + rnd() * 3, stock: Math.floor(rnd() * 100) });
  if (r.deal) { deals++; if (r.deal.unit > 0.99 || r.deal.unit * r.deal.qty > 60 + 1e-9 || r.deal.unit < floor - 1e-9) bad++; }
}
ok(deals > 50 && bad === 0, `500 random suppliers: ${deals} deals, ${bad} outside the mandate or under the seller's floor`);
process.exit(fail);
