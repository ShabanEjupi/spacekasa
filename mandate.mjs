// Mandates: limits a human signs once, so an agent may spend on its own inside them and nowhere else.
// The verifier is deterministic and has no model in it; the agent's word counts for nothing, only the mandate does.
import { generateKeyPairSync, sign, verify as edVerify, createPublicKey } from 'node:crypto';

// Canonical JSON: keys sorted at every level, so the signed bytes do not depend on key order.
export const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(',')}]`
  : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
  : JSON.stringify(v);

export const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { pub: publicKey.export({ type: 'spki', format: 'pem' }), priv: privateKey };
};
export const signMandate = (m, priv) => ({ ...m, sig: sign(null, Buffer.from(canonical(m)), priv).toString('base64') });
const signedBy = (m, pub) => {
  const { sig, ...body } = m;
  try { return !!sig && edVerify(null, Buffer.from(canonical(body)), createPublicKey(pub), Buffer.from(sig, 'base64')); } catch { return false; }
};

// Monday 00:00 UTC of the ISO week containing t.
export const weekOf = t => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7); return d.getTime(); };
const cents = x => Math.round(x * 100);
const median = xs => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const DAY = 864e5;

// action  = { agent, kind: 'buy', supplier, lines: [{ sku, qty, unit }], at }
// history = executed actions so far, each { ...action, mandate }
// Returns { ok: true, mandate } for the first mandate that allows the action, otherwise { ok: false, reasons } with
// the reason from every mandate that was considered, for the human who now has to decide.
export function check(action, mandates, pub, history = []) {
  const reasons = [], at = Date.parse(action.at);
  if (!Number.isFinite(at)) return { ok: false, reasons: ['action has no valid time'] };
  if (!Array.isArray(action.lines) || !action.lines.length) return { ok: false, reasons: ['action has no lines'] };
  for (const l of action.lines)
    if (!(Number.isInteger(l.qty) && l.qty > 0 && Number.isFinite(l.unit) && l.unit > 0)) return { ok: false, reasons: [`bad line ${JSON.stringify(l)}`] };
  const total = action.lines.reduce((s, l) => s + cents(l.unit) * l.qty, 0);
  for (const m of mandates) {
    const why = (() => {
      if (!signedBy(m, pub)) return 'signature does not verify';
      if (m.agent !== action.agent || m.kind !== action.kind) return `for ${m.agent}/${m.kind}, not ${action.agent}/${action.kind}`;
      if (at < Date.parse(m.from) || at >= Date.parse(m.until)) return `valid ${m.from} – ${m.until}`;
      if (!m.suppliers.includes(action.supplier)) return `supplier ${action.supplier} not allowed`;
      const bad = action.lines.find(l => !m.skus.includes(l.sku));
      if (bad) return `${bad.sku} not allowed`;
      if (total > cents(m.perOrder)) return `order ${total / 100} over ${m.perOrder} per order`;
      const wk = weekOf(at), spent = history.filter(h => h.mandate === m.id && weekOf(Date.parse(h.at)) === wk)
        .reduce((s, h) => s + h.lines.reduce((t, l) => t + cents(l.unit) * l.qty, 0), 0);
      if (spent + total > cents(m.perWeek)) return `week would reach ${(spent + total) / 100}, limit ${m.perWeek}`;
      for (const l of action.lines) {
        // Prices are bounded by the reference the human signed, or by the 30-day median actually paid if that is lower.
        // Never by the median alone: an agent paying the maximum each time would ratchet its own limit upwards.
        const ref = median(history.filter(h => at - Date.parse(h.at) <= 30 * DAY && at >= Date.parse(h.at))
          .flatMap(h => h.lines.filter(x => x.sku === l.sku).map(x => cents(x.unit))));
        const seed = m.reference?.[l.sku];
        if (seed == null) return `no signed reference price for ${l.sku}`;
        const base = ref == null ? cents(seed) : Math.min(ref, cents(seed));
        if (cents(l.unit) * 100 > base * Math.round(m.priceFactor * 100)) return `${l.sku} at ${l.unit} is over ${m.priceFactor} × ${base / 100}`;
      }
      return null;
    })();
    if (!why) return { ok: true, mandate: m.id };
    reasons.push(`${m.id}: ${why}`);
  }
  return { ok: false, reasons: reasons.length ? reasons : ['no mandate'] };
}
