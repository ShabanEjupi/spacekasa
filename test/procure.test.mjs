// node test/procure.test.mjs — the whole procurement loop with a fake PayPal: buys what runs out, inside the mandate.
import fs from 'node:fs';
import { keys, signMandate } from '../mandate.mjs';
import { run, simulatedSales, usage } from '../procure.mjs';
let fail = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail = 1; };
const supplies = JSON.parse(fs.readFileSync(new URL('../supplies.json', import.meta.url)));
const now = Date.parse('2026-10-26T08:00:00Z'), owner = keys();
const M = signMandate({ ...supplies.mandate, skus: supplies.items.map(i => i.sku), suppliers: [supplies.supplier.id],
  reference: Object.fromEntries(supplies.items.map(i => [i.sku, i.reference])), from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z' }, owner.priv);
const sales = simulatedSales(now), u = usage(sales, supplies, 56, now);
const milk = u['milk-1l'].slice(-28).reduce((s, x) => s + x, 0) / 28;
ok(milk > 8 && milk < 20, `simulated café uses ${milk.toFixed(1)} l of milk a day`);
const payments = [], history = [];
const fresh = () => JSON.parse(JSON.stringify(supplies));                // stock back to low, as if it was used up
const pay = async (item, deal) => { payments.push({ sku: item.sku, ...deal }); return { id: 'FAKE-' + payments.length }; };
const t1 = await run({ supplies: fresh(), sales, mandates: [M], pub: owner.pub, history, now, pay });
for (const t of t1) console.log('  ', t.sku, t.outcome, t.order, t.deal ? `${t.deal.qty} × ${t.deal.unit}` : '', t.why ?? '');
ok(t1.some(t => t.outcome.startsWith('paid')), 'what runs out is bought and paid without a human');
ok(t1.find(t => t.sku === 'beans-1kg').outcome === 'paid part', `more beans than one order may hold: buys what fits, ${t1.find(t => t.sku === 'beans-1kg').short} kg left to a human`);
ok(payments.every(p => p.unit * p.qty <= 60 + 1e-9), 'every payment within the per-order limit');
const spent = () => history.reduce((s, h) => s + h.lines[0].unit * h.lines[0].qty, 0);
// Run again and again the same week: the weekly limit must stop it and hand over to a human.
for (let i = 0; i < 5; i++) await run({ supplies: fresh(), sales, mandates: [M], pub: owner.pub, history, now: now + i * 36e5, pay });
ok(spent() <= 120 + 1e-9, `five more runs in the same week: spent ${spent().toFixed(2)} of 120, then stops`);
const last = await run({ supplies: fresh(), sales, mandates: [M], pub: owner.pub, history, now: now + 6 * 36e5, pay });
ok(last.some(t => t.outcome === 'needs a human'), `…and asks a human: ${last.find(t => t.outcome === 'needs a human')?.why}`);
process.exit(fail);
