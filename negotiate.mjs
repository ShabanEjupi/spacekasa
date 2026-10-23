// Agent-to-agent trade: the café's procurement agent and the supplier's sales agent haggle in a fixed protocol of
// alternating offers. Each side concedes along a time-dependent curve (Faratin, Sierra & Jennings, 1998) between its
// opening price and its reservation price, and walks away at the deadline. The buyer's side never sends an offer its
// mandate would refuse: every offer passes through the same verifier that guards payments.
import { check } from './mandate.mjs';

const cents = x => Math.round(x * 100) / 100, up = x => Math.ceil(x * 100 - 1e-9) / 100;   // prices are whole cents; a seller rounds up
// Price at round t of T: from `open` to `limit`; beta < 1 holds firm until late (Boulware), beta > 1 gives in early.
export const curve = (open, limit, t, T, beta) => cents(open + (limit - open) * Math.min(1, t / T) ** (1 / beta));

// buyer:  { open, limit, beta, qty, sku, supplier, mandates, pub, history, at }
// seller: { open, floor, beta, stock }
// Returns { deal: { unit, qty, round } | null, log: [{ round, from, unit, ok?, why? }] }
export function negotiate(buyer, seller, T = 10) {
  const log = [], qty = Math.min(buyer.qty, seller.stock);
  if (qty <= 0) return { deal: null, log: [{ round: 0, from: 'seller', why: 'no stock' }] };
  const allowed = unit => check({ agent: 'procurement', kind: 'buy', supplier: buyer.supplier, lines: [{ sku: buyer.sku, qty, unit }], at: buyer.at },
    buyer.mandates, buyer.pub, buyer.history);
  let last = { buyer: null, seller: null };
  for (let t = 0; t <= T; t++) {
    // Seller offers; the buyer accepts if it is no worse than what the buyer would offer next and the mandate allows it.
    const ask = up(Math.max(seller.floor, curve(seller.open, seller.floor, t, T, seller.beta)));
    log.push({ round: t, from: 'seller', unit: ask });
    const mine = curve(buyer.open, buyer.limit, t + 1, T, buyer.beta);
    if (ask <= mine && allowed(ask).ok) { log.push({ round: t, from: 'buyer', unit: ask, ok: true }); return { deal: { unit: ask, qty, round: t }, log }; }
    // Buyer counters with the most its curve allows this round, cut back to what the mandate allows.
    let bid = Math.min(mine, buyer.limit);
    while (bid > 0 && !allowed(bid).ok) bid = cents(bid - 0.01);
    if (bid <= 0) { log.push({ round: t, from: 'buyer', why: allowed(mine).reasons.join('; ') }); return { deal: null, log }; }
    log.push({ round: t, from: 'buyer', unit: bid });
    const next = up(Math.max(seller.floor, curve(seller.open, seller.floor, t + 1, T, seller.beta)));
    if (bid >= next) { log.push({ round: t, from: 'seller', unit: bid, ok: true }); return { deal: { unit: bid, qty, round: t }, log }; }
    last = { buyer: bid, seller: ask };
  }
  log.push({ round: T, from: 'buyer', why: `no agreement: last ask ${last.seller}, last bid ${last.buyer}` });
  return { deal: null, log };
}
