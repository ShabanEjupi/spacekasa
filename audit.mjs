// The audit ledger: every decision is chained to the one before it, and each day's entries are summed up in a Merkle
// root that can be published. A receipt carries its inclusion proof, so anyone holding the published root can check
// that the payment is in the books and that the books were not edited afterwards.
import { createHash } from 'node:crypto';
import { canonical } from './mandate.mjs';

const H = s => createHash('sha256').update(s).digest('hex');
const leaf = e => H('0' + canonical(e));                     // domain-separated: a leaf can never pass for a node
const node = (a, b) => H('1' + a + b);

// Append-only chain: entry n stores the hash of entry n-1; changing any entry breaks every link after it.
export function append(chain, data) {
  const prev = chain.at(-1)?.hash ?? '0'.repeat(64), e = { n: chain.length, prev, data };
  chain.push({ ...e, hash: H(canonical(e)) });
  return chain.at(-1);
}
export const intact = chain => chain.every((e, i) => e.n === i && e.prev === (i ? chain[i - 1].hash : '0'.repeat(64))
  && e.hash === H(canonical({ n: e.n, prev: e.prev, data: e.data })));

// Merkle tree over a list of entries; an odd node is carried up unchanged.
function levels(entries) {
  const L = [entries.map(leaf)];
  while (L.at(-1).length > 1) { const p = L.at(-1), up = []; for (let i = 0; i < p.length; i += 2) up.push(i + 1 < p.length ? node(p[i], p[i + 1]) : p[i]); L.push(up); }
  return L;
}
export const root = entries => entries.length ? levels(entries).at(-1)[0] : null;
export function proof(entries, i) {
  const out = [];
  for (const lv of levels(entries).slice(0, -1)) { const j = i ^ 1; if (j < lv.length) out.push([i & 1 ? 'L' : 'R', lv[j]]); i >>= 1; }
  return out;
}
export const verifyProof = (entry, steps, r) => steps.reduce((h, [side, s]) => side === 'L' ? node(s, h) : node(h, s), leaf(entry)) === r;
