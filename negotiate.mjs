// Agent-to-agent trade: the café's procurement agent and the supplier's sales agent haggle in a fixed protocol of
// alternating offers. Each side concedes along a time-dependent curve (Faratin, Sierra & Jennings, 1998) between its
// opening price and its reservation price, and walks away at the deadline. The buyer's side never sends an offer its
// mandate would refuse: every offer passes through the same verifier that guards payments.
//
// The two sides share nothing but messages. The seller is anything with `respond(msg)`: the local strategy below for
// tests, or another SpaceKasa instance across the internet (a2a.mjs), whose floor price the buyer never learns.
import { check } from './mandate.mjs';

export const ROUNDS = 10;
// A signed reply travels whole in the log, so anyone holding the supplier's key can check it later.
const env = r => r.sig ? { sig: r.sig, signed: (({ sig, ...x }) => x)(r) } : {};
const cents = x => Math.round(x * 100) / 100, up = x => Math.ceil(x * 100 - 1e-9) / 100;   // prices are whole cents; a seller rounds up
// Price at round t of T: from `open` to `limit`; beta < 1 holds firm until late (Boulware), beta > 1 gives in early.
export const curve = (open, limit, t, T, beta) => cents(open + (limit - open) * Math.min(1, t / T) ** (1 / beta));

// The seller's side of the protocol. msg = { round, sku, qty, bid? , accept? }:
//   bid    — the buyer's counter from the round before; the seller takes it if it is no lower than its own next ask
//   accept — the buyer takes the seller's ask of this round
// Reply: { ask, qty } | { accept: unit, qty } | { confirmed: unit, qty }
export function strategy({ open, floor, beta, stock }) {
  const ask = t => up(Math.max(floor, curve(open, floor, t, ROUNDS, beta)));
  return msg => {
    const qty = Math.min(msg.qty, stock);
    if (qty <= 0) return { qty: 0, why: 'no stock' };
    if (msg.accept != null) return msg.accept >= ask(msg.round) ? { confirmed: msg.accept, qty } : { qty, why: 'not my ask' };
    if (msg.bid != null && msg.bid >= ask(msg.round)) return { accept: msg.bid, qty };
    return { ask: ask(msg.round), qty };
  };
}
export const localSeller = params => { const s = strategy(params); return { respond: async msg => s(msg) }; };

// buyer:  { open, limit, beta, qty, sku, supplier, mandates, pub, history, at }
// seller: { respond(msg) → reply } (a strategy's params are accepted too, for the in-process case)
// Returns { deal: { unit, qty, round } | null, log: [{ round, from, unit, ok?, why?, sig? }] }
export async function negotiate(buyer, seller, T = ROUNDS) {
  if (!seller.respond) seller = localSeller(seller);
  const log = [], allowed = (unit, qty) => check({ agent: 'procurement', kind: 'buy', supplier: buyer.supplier,
    lines: [{ sku: buyer.sku, qty, unit }], at: buyer.at }, buyer.mandates, buyer.pub, buyer.history);
  let bid = null, last = { buyer: null, seller: null }, cap = null;
  for (let t = 0; t <= T; t++) {
    const r = await seller.respond({ round: t, sku: buyer.sku, qty: buyer.qty, bid });
    if (!r.qty) { log.push({ round: t, from: 'seller', why: r.why || 'no stock' }); return { deal: null, log }; }
    // The seller may offer less than we asked for, never more (the mandate alone would let it fill a whole order).
    if (!(Number.isInteger(r.qty) && r.qty > 0 && r.qty <= buyer.qty)) { log.push({ round: t, from: 'seller', why: `offered ${r.qty}, we asked for ${buyer.qty}` }); return { deal: null, log }; }
    const qty = r.qty;
    // The seller took our last bid. Its reply is the seller's half of the contract; check the mandate once more anyway.
    if (r.accept != null) {
      if (r.accept !== bid || !allowed(bid, qty).ok) { log.push({ round: t, from: 'seller', why: 'accepted terms the buyer did not offer' }); return { deal: null, log }; }
      log.push({ round: t, from: 'seller', unit: bid, ok: true, ...env(r) });
      return { deal: { unit: bid, qty, round: t - 1, seller: r }, log };
    }
    const ask = r.ask;
    // Whole cents only: the verifier rounds a price to cents, so 1.0049 × 60 would pass as 60.00 and pay 60.29.
    if (!(typeof ask === 'number' && ask > 0 && cents(ask) === ask)) { log.push({ round: t, from: 'seller', why: `ask ${ask} is not a price in whole cents` }); return { deal: null, log }; }
    log.push({ round: t, from: 'seller', unit: ask, ...env(r) });
    // Take the ask if it is no worse than what we would offer next and the mandate allows it; the seller must confirm.
    const mine = curve(buyer.open, buyer.limit, t + 1, T, buyer.beta);
    if (ask <= mine && allowed(ask, qty).ok) {
      const c = await seller.respond({ round: t, sku: buyer.sku, qty, accept: ask });
      if (c.confirmed === ask && c.qty === qty) {
        log.push({ round: t, from: 'buyer', unit: ask, ok: true, ...env(c) });
        return { deal: { unit: ask, qty, round: t, seller: c }, log };
      }
    }
    // Counter with the most our curve allows this round, cut back to what the mandate allows.
    bid = Math.min(mine, buyer.limit);
    if (!allowed(bid, qty).ok) {
      // The highest whole-cent bid the mandate allows (every limit is an upper bound): a binary search, not 1 400 checks.
      let lo = 0, hi = Math.round(bid * 100);
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (allowed(m / 100, qty).ok) lo = m; else hi = m; }
      bid = lo / 100;
    }
    if (bid < mine) cap = allowed(mine, qty).reasons.join('; ');            // the mandate, not the haggling, held the bid down
    if (bid <= 0) { log.push({ round: t, from: 'buyer', why: allowed(mine, qty).reasons.join('; ') }); return { deal: null, log }; }
    log.push({ round: t, from: 'buyer', unit: bid });
    last = { buyer: bid, seller: ask };
  }
  // The final bid still gets its answer: the seller may take it at the deadline.
  const r = await seller.respond({ round: T + 1, sku: buyer.sku, qty: buyer.qty, bid });
  if (r.accept != null && r.accept === bid && Number.isInteger(r.qty) && r.qty > 0 && r.qty <= buyer.qty && allowed(bid, r.qty).ok) {
    log.push({ round: T + 1, from: 'seller', unit: bid, ok: true, ...env(r) });
    return { deal: { unit: bid, qty: r.qty, round: T, seller: r }, log };
  }
  log.push({ round: T, from: 'buyer', why: `no agreement: last ask ${last.seller}, last bid ${last.buyer}` + (cap ? ` (held down by ${cap})` : '') });
  return { deal: null, log };
}
