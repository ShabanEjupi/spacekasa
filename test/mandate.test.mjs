// node test/mandate.test.mjs — the verifier's promises, checked against thousands of adversarial actions.
import { keys, signMandate, check, canonical, weekOf } from '../mandate.mjs';
let fail = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail = 1; };

const owner = keys(), thief = keys();
const body = { id: 'M-1', agent: 'procurement', kind: 'buy', skus: ['milk-1l', 'coffee-1kg'], suppliers: ['S-0042'],
               perOrder: 60, perWeek: 200, priceFactor: 1.1, reference: { 'milk-1l': 0.9, 'coffee-1kg': 14 },
               from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z' };
const M = signMandate(body, owner.priv);
const buy = (lines, at = '2026-10-26T09:00:00Z', extra = {}) => ({ agent: 'procurement', kind: 'buy', supplier: 'S-0042', lines, at, ...extra });

ok(canonical({ b: 1, a: [2, { d: 3, c: 4 }] }) === '{"a":[2,{"c":4,"d":3}],"b":1}', 'canonical JSON sorts keys at every level');
ok(check(buy([{ sku: 'milk-1l', qty: 20, unit: 0.95 }]), [M], owner.pub).ok, 'a plain order inside the mandate passes');
const no = (a, ms, msg, h = []) => { const r = check(a, ms, owner.pub, h); ok(!r.ok, `${msg} → ${r.reasons?.join('; ')}`); };
no(buy([{ sku: 'milk-1l', qty: 20, unit: 0.95 }]), [signMandate(body, thief.priv)], 'signed by someone else');
no(buy([{ sku: 'milk-1l', qty: 20, unit: 0.95 }]), [{ ...M, perWeek: 2000 }], 'limit raised after signing');
no(buy([{ sku: 'milk-1l', qty: 20, unit: 0.95 }], '2027-01-02T09:00:00Z'), [M], 'after it expired');
no(buy([{ sku: 'milk-1l', qty: 20, unit: 0.95 }], undefined, { supplier: 'S-6666' }), [M], 'unknown supplier');
no(buy([{ sku: 'whisky', qty: 1, unit: 30 }]), [M], 'item outside the mandate');
no(buy([{ sku: 'coffee-1kg', qty: 5, unit: 14 }]), [M], 'one order over the per-order limit');
no(buy([{ sku: 'milk-1l', qty: 20, unit: 0.99 + 0.01 }]), [M], 'price over 1.1 × the signed reference');
no(buy([{ sku: 'milk-1l', qty: -50, unit: 0.9 }, { sku: 'coffee-1kg', qty: 4, unit: 14 }]), [M], 'negative quantity to hide a big line');
no(buy([{ sku: 'milk-1l', qty: 1.5, unit: 0.9 }]), [M], 'fractional quantity');
no(buy([{ sku: 'milk-1l', qty: 1, unit: NaN }]), [M], 'price NaN');
no(buy([]), [M], 'no lines');
no(buy([{ sku: 'milk-1l', qty: 1, unit: 0.9 }], 'yesterday'), [M], 'time that does not parse');
no({ ...buy([{ sku: 'milk-1l', qty: 1, unit: 0.9 }]), agent: 'cashier' }, [M], 'another agent using the mandate');

// Property test: an adversarial agent fires 5000 random orders over ten weeks, including over-limit, foreign items,
// wrong suppliers and inflated prices. Whatever passes is executed. No week, order or price may ever break the mandate.
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const history = [], start = Date.parse('2026-10-05T00:00:00Z');
const skus = ['milk-1l', 'coffee-1kg', 'whisky'], ref = { 'milk-1l': 0.9, 'coffee-1kg': 14, whisky: 30 };
for (let i = 0; i < 5000; i++) {
  const lines = [...Array(1 + Math.floor(rnd() * 3))].map(() => { const sku = skus[Math.floor(rnd() * 3)]; return { sku, qty: 1 + Math.floor(rnd() * 8), unit: Math.round(ref[sku] * (0.8 + rnd() * 0.5) * 100) / 100 }; });
  const a = buy(lines, new Date(start + rnd() * 70 * 864e5).toISOString(), { supplier: rnd() < 0.9 ? 'S-0042' : 'S-6666' });
  const r = check(a, [M], owner.pub, history);
  if (r.ok) history.push({ ...a, mandate: r.mandate });
}
const c = x => Math.round(x * 100), tot = h => h.lines.reduce((s, l) => s + c(l.unit) * l.qty, 0);
const weeks = new Map(); for (const h of history) weeks.set(weekOf(Date.parse(h.at)), (weeks.get(weekOf(Date.parse(h.at))) ?? 0) + tot(h));
ok(history.length > 50, `${history.length} of 5000 random orders executed autonomously`);
ok([...weeks.values()].every(v => v <= 20000), `every week ≤ 200 (max ${Math.max(...weeks.values()) / 100})`);
ok(history.every(h => tot(h) <= 6000), 'every order ≤ 60');
ok(history.every(h => h.supplier === 'S-0042' && h.lines.every(l => body.skus.includes(l.sku))), 'only allowed suppliers and items');
ok(history.every(h => h.lines.every(l => c(l.unit) * 100 <= c(body.reference[l.sku]) * 110)), 'no price ever above 1.1 × the signed reference');

// The ratchet attack: always paying the maximum allowed must not lift the limit over time.
const greedy = [];
for (let d = 0; d < 60; d++) {
  let u = 2; while (u > 0.5 && !check(buy([{ sku: 'milk-1l', qty: 1, unit: u }], new Date(start + d * 864e5).toISOString()), [M], owner.pub, greedy).ok) u = Math.round((u - 0.01) * 100) / 100;
  greedy.push({ ...buy([{ sku: 'milk-1l', qty: 1, unit: u }], new Date(start + d * 864e5).toISOString()), mandate: 'M-1' });
}
ok(Math.max(...greedy.map(g => g.lines[0].unit)) <= 0.99, `ratchet: 60 days of paying the maximum, highest price ${Math.max(...greedy.map(g => g.lines[0].unit))} (limit 0.99)`);
process.exit(fail);
