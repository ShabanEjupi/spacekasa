// The supplier's side, a second SpaceKasa instance: a sales agent that haggles with cafés' procurement agents over
// signed messages, and a witness that countersigns their books. Its floor prices live only here (supplier.json);
// the café learns them from nothing but the offers it receives.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { supplierDesk, witness, keyFile, der, pemOf, verifyObj } from './a2a.mjs';
import { genesis } from './audit.mjs';

const PORT = Number(process.env.PORT || 8080);
const DATA = process.env.DATA_DIR || './data-supplier';
const DIR = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(DATA, { recursive: true });
const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1)); fs.renameSync(f + '.tmp', f); };
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return d; } };

const catalog = JSON.parse(fs.readFileSync(path.join(DIR, 'supplier.json'), 'utf8'));
const key = keyFile(path.join(DATA, 'supplier-key.json'), writeJson);
const deals = read('deals.json', []);
// Per till we witness: its pinned key, what we have seen of its chain, and the last head we countersigned.
const books = read('witness.json', {});
const WITNESS = (process.env.WITNESS_LOGS || 'https://kasa.spacecode.tech,test').split(',');
for (const k of Object.keys(books)) if (!WITNESS.includes(k)) delete books[k];
const desk = supplierDesk({ catalog, key, log: d => { deals.push(d); if (deals.length > 500) deals.splice(0, deals.length - 500); writeJson(path.join(DATA, 'deals.json'), deals); } });

const send = (res, code, obj, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' });
  res.end(type === 'application/json' ? JSON.stringify(obj) : obj);
};
async function body(req) {
  let b = '';
  for await (const c of req) { b += c; if (b.length > 2e6) throw Object.assign(new Error('Too large'), { status: 413 }); }
  try { return JSON.parse(b || '{}'); } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
}
const view = d => ({ session: d.session, sku: d.sku, deal: d.deal, qty: d.qty, at: d.at, rounds: d.transcript.length,
  offers: d.transcript.map(x => ({ round: x.seller.round, bid: x.buyer.msg.bid ?? x.buyer.msg.accept ?? null, ask: x.seller.ask ?? null, accept: x.seller.accept ?? x.seller.confirmed ?? null, sig: x.seller.sig })) });

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (u.pathname === '/health') return send(res, 200, { ok: true, deals: deals.length });
    if (req.method === 'GET' && u.pathname === '/') return send(res, 200, fs.readFileSync(path.join(DIR, 'public', 'supplier.html')), 'text/html; charset=utf-8');
    if (req.method === 'GET' && ['/sk.js', '/style.css'].includes(u.pathname)) return send(res, 200, fs.readFileSync(path.join(DIR, 'public', u.pathname.slice(1))), u.pathname.endsWith('.js') ? 'text/javascript' : 'text/css');
    if (req.method === 'GET' && u.pathname === '/a2a/key') return send(res, 200, { id: catalog.supplier.id, name: catalog.supplier.name, key: der(key.pub) });
    if (req.method === 'GET' && u.pathname === '/api/deals') return send(res, 200, { supplier: catalog.supplier, key: der(key.pub), deals: deals.slice(-20).reverse().map(view),
      witnessed: Object.entries(books).map(([till, b]) => ({ log: till, n: b.state.n, head: b.state.head, root: b.state.root, at: b.at })) });
    if (req.method !== 'POST') return send(res, 404, { error: 'Not found' });
    const b = await body(req);
    if (u.pathname === '/a2a/offer') return send(res, 200, desk(b));
    if (u.pathname === '/a2a/witness') {
      // The till's key is pinned the first time it asks; a head signed by any other key is refused.
      const { head, sig, key: tillKey, entries } = b;
      if (!head || typeof tillKey !== 'string' || !Array.isArray(entries)) return send(res, 400, { error: 'bad request' });
      // Only the logs we agreed to witness, each pinned to the first key that signed for it.
      const id = head.log, book = books[id] || { state: genesis(), key: tillKey };
      if (!WITNESS.includes(id)) return send(res, 403, { error: 'we do not witness this log' });
      if (book.key !== tillKey || !verifyObj(head, sig, pemOf(tillKey))) return send(res, 400, { error: 'till signature does not verify' });
      if (head.n < book.state.n) return send(res, 409, { error: `we already countersigned ${book.state.n} entries` });
      const from = entries[0]?.n ?? book.state.n;
      if (from > book.state.n) return send(res, 409, { error: `send entries from ${book.state.n}`, need: book.state.n });
      const w = witness(book.state, { entries: entries.slice(book.state.n - from), head }, key);
      books[id] = { state: w.state, key: tillKey, at: new Date().toISOString() };
      writeJson(path.join(DATA, 'witness.json'), books);
      return send(res, 200, { cosig: w.cosig, key: der(key.pub) });
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, err.status && err.status < 500 ? err.status : 500, { error: err.message });
  }
}).listen(PORT, () => console.log(`SpaceKasa supplier ${catalog.supplier.id} on :${PORT}`));
