// node test/a2a.test.mjs — a real supplier server on a local port: signed haggling over HTTP, a buyer that tries to
// skip to the floor price, a reply under the wrong key, and a witness that must refuse rewritten books.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { keys, signMandate } from '../mandate.mjs';
import { negotiate } from '../negotiate.mjs';
import { remoteSeller, signObj, verifyObj, der, pemOf } from '../a2a.mjs';
import { append, root } from '../audit.mjs';
let fail = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail = 1; };
const PORT = 18000 + Math.floor(Math.random() * 1000), URL_ = `http://127.0.0.1:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-sup-'));
const srv = spawn(process.execPath, [new URL('../supplier.mjs', import.meta.url).pathname], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) { try { if ((await fetch(`${URL_}/health`)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const sup = await (await fetch(`${URL_}/a2a/key`)).json(), supPem = pemOf(sup.key);
  ok(sup.id === 'S-0042', `supplier ${sup.id} publishes its key`);

  const owner = keys(), till = { id: 'test-till', ...keys() };
  const M = signMandate({ id: 'M-1', agent: 'procurement', kind: 'buy', skus: ['milk-1l'], suppliers: ['S-0042'], perOrder: 60, perWeek: 200,
    priceFactor: 1.1, reference: { 'milk-1l': 0.9 }, from: '2026-10-01T00:00:00Z', until: '2026-12-31T00:00:00Z' }, owner.priv);
  const buyer = { open: 0.72, limit: 1.08, beta: 0.5, qty: 40, sku: 'milk-1l', supplier: 'S-0042', mandates: [M], pub: owner.pub, history: [], at: '2026-10-26T09:00:00Z' };
  const n = await negotiate(buyer, remoteSeller(URL_, supPem, till));
  ok(n.deal && n.deal.unit >= 0.82 && n.deal.unit <= 0.99, `over HTTP: deal at ${n.deal?.unit} × ${n.deal?.qty} in round ${n.deal?.round}, inside the mandate's 0.99, never under the hidden floor`);
  const signed = n.log.filter(o => o.signed);
  ok(signed.length >= 2 && signed.every(o => verifyObj(o.signed, o.sig, supPem)), `${signed.length} supplier messages in the log, each verifies against the supplier's key`);
  ok(signed.every(o => !verifyObj({ ...o.signed, ask: (o.signed.ask ?? 0) + 0.01, accept: o.signed.accept }, o.sig, supPem) || o.signed.ask == null), 'an offer changed by one cent no longer verifies');

  // The wrong pinned key: every reply is refused.
  const other = keys();
  let threw = false;
  try { await negotiate(buyer, remoteSeller(URL_, other.pub, till)); } catch (e) { threw = /does not verify/.test(e.message); }
  ok(threw, 'a reply under a key other than the pinned one is refused');

  // A cheating buyer: open a session, then claim to accept the round-10 floor price straight away.
  const post = (msg, k = till) => fetch(`${URL_}/a2a/offer`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msg, sig: signObj(msg, k.priv), key: der(k.pub) }) });
  const s = 'cheat-' + Date.now(), first = await (await post({ session: s, round: 0, sku: 'milk-1l', qty: 10, bid: null, buyer: 'x' })).json();
  const r1 = await post({ session: s, round: 10, sku: 'milk-1l', qty: 10, accept: 0.82, buyer: 'x' });
  ok(first.ask > 1 && r1.status === 409, `opening ask ${first.ask}; accepting the floor 0.82 for a round never played → ${r1.status}`);
  const r2 = await post({ session: s, round: 5, sku: 'milk-1l', qty: 10, bid: 0.5, buyer: 'x' });
  ok(r2.status === 409, `jumping from round 1 to round 5 → ${r2.status}`);
  const forged = { session: 'f-' + Date.now(), round: 0, sku: 'milk-1l', qty: 10, bid: null, buyer: 'x' };
  const r3 = await fetch(`${URL_}/a2a/offer`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg: forged, sig: signObj({ ...forged, qty: 11 }, till.priv), key: der(till.pub) }) });
  ok(r3.status === 400, `a buyer message whose signature does not match → ${r3.status}`);

  // Witness: grow a chain, have it countersigned twice; then rewrite history and ask again.
  const chain = [], tk = keys();
  const head = () => ({ log: 'test', n: chain.length, head: chain.at(-1).hash, root: root(chain.map(c => c.data)), at: new Date().toISOString() });
  const wit = (h, from) => fetch(`${URL_}/a2a/witness`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ head: h, sig: signObj(h, tk.priv), key: der(tk.pub), entries: chain.slice(from) }) });
  for (let i = 0; i < 5; i++) append(chain, { ref: 'K-' + i, status: 'paid', total: 100 + i, at: new Date().toISOString() });
  const h1 = head(), w1 = await (await wit(h1, 0)).json();
  ok(verifyObj({ ...h1, witness: 'supplier' }, w1.cosig, supPem), 'witness countersigns 5 entries; the cosignature verifies');
  for (let i = 5; i < 9; i++) append(chain, { ref: 'K-' + i, status: 'paid', total: 100 + i, at: new Date().toISOString() });
  const h2 = head(), w2 = await (await wit(h2, 5)).json();
  ok(verifyObj({ ...h2, witness: 'supplier' }, w2.cosig, supPem), '4 more entries, sent alone, extend what the witness saw');
  // Rewrite entry 2 (a refund that never happened) and rebuild the chain from there, perfectly hashed.
  const forgedChain = [];
  for (const c of chain) append(forgedChain, c.n === 2 ? { ...c.data, total: 1 } : c.data);
  append(forgedChain, { ref: 'K-9', status: 'paid', total: 109, at: new Date().toISOString() });
  chain.splice(0, chain.length, ...forgedChain);
  const r4 = await wit(head(), 0);
  ok(r4.status === 409, `rewritten books, re-hashed end to end: the witness refuses → ${r4.status} ${(await r4.json()).error}`);
  const r5 = await fetch(`${URL_}/a2a/witness`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ head: h2, sig: signObj(h2, other.priv), key: der(tk.pub), entries: [] }) });
  ok(r5.status === 400, `a head not signed by the till's key → ${r5.status}`);
} finally { srv.kill(); fs.rmSync(dir, { recursive: true, force: true }); }
process.exit(fail);
