// Agent-to-agent over HTTP. Two SpaceKasa instances — a café's till and its supplier — trade with signed messages:
// every offer the supplier sends is Ed25519-signed over its canonical JSON, so the transcript of a deal is a contract
// neither side can later deny, and its hash goes into the café's audit chain next to the payout.
// The supplier also witnesses the café's books: it countersigns a tree head only after checking that the chain grew
// by appending (audit.mjs), so a till that later rewrote a receipt would contradict a signature it does not hold.
import { sign, verify, createPublicKey, createPrivateKey, generateKeyPairSync, createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { canonical } from './mandate.mjs';
import { strategy, ROUNDS } from './negotiate.mjs';
import { extend } from './audit.mjs';

export const signObj = (o, priv) => sign(null, Buffer.from(canonical(o)), priv).toString('base64');
export const verifyObj = (o, sig, pub) => { try { return !!sig && verify(null, Buffer.from(canonical(o)), createPublicKey(pub), Buffer.from(sig, 'base64')); } catch { return false; } };
export const sha = s => createHash('sha256').update(s).digest('hex');
// Public key as base64 SPKI DER: what a browser's WebCrypto imports directly.
export const der = pem => createPublicKey(pem).export({ type: 'spki', format: 'der' }).toString('base64');
export const pemOf = b64 => createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' }).export({ type: 'spki', format: 'pem' });

// A key kept in a file, made on first use.
export function keyFile(f, writeJson) {
  try { const k = JSON.parse(fs.readFileSync(f, 'utf8')); return { pub: k.pub, priv: createPrivateKey(k.priv) }; }
  catch {
    const p = generateKeyPairSync('ed25519'), pub = p.publicKey.export({ type: 'spki', format: 'pem' });
    writeJson(f, { pub, priv: p.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
    return { pub, priv: p.privateKey };
  }
}

// ── Buyer side: a seller across the internet, with its key pinned on first contact ──
export function remoteSeller(url, pinned, buyer) {
  const session = randomUUID();
  return {
    session,
    async respond(msg) {
      const body = { ...msg, session, buyer: buyer.id };
      const r = await fetch(`${url}/a2a/offer`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg: body, sig: signObj(body, buyer.priv), key: der(buyer.pub) }), signal: AbortSignal.timeout(10e3) });
      const j = await r.json();
      if (!r.ok) throw new Error(`supplier: ${j.error || r.status}`);
      const { sig, ...reply } = j;
      // A reply that is not signed by the pinned key, or answers a different message, is not an offer.
      if (!verifyObj(reply, sig, pinned) || reply.session !== session || reply.round !== msg.round)
        throw new Error('supplier reply does not verify');
      return { ...reply, sig };
    },
  };
}

// ── Seller side: the supplier's sales agent. Sessions enforce the protocol the strategy assumes: rounds advance one
// at a time, and an acceptance must name the ask the seller actually made in that round. ──
export function supplierDesk({ catalog, key, log }) {
  const sessions = new Map(), strat = Object.fromEntries(catalog.items.map(i => [i.sku, strategy(i)]));
  return function offer({ msg, sig, key: buyerKey }) {
    if (!msg || typeof msg !== 'object' || typeof msg.session !== 'string' || msg.session.length > 64) throw Object.assign(new Error('bad message'), { status: 400 });
    if (!buyerKey || !verifyObj(msg, sig, pemOf(buyerKey))) throw Object.assign(new Error('buyer signature does not verify'), { status: 400 });
    const s = strat[msg.sku];
    if (!s) throw Object.assign(new Error(`we do not sell ${msg.sku}`), { status: 400 });
    if (!(Number.isInteger(msg.qty) && msg.qty > 0 && msg.qty <= 10000)) throw Object.assign(new Error('bad quantity'), { status: 400 });
    for (const [k, v] of sessions) if (Date.now() - v.at > 10 * 60e3) sessions.delete(k);
    if (!sessions.has(msg.session) && sessions.size >= 2000) throw Object.assign(new Error('busy, try again later'), { status: 429 });
    const st = sessions.get(msg.session) || { round: 0, asks: {}, at: Date.now(), sku: msg.sku, buyer: buyerKey, transcript: [] };
    if (st.done || st.sku !== msg.sku || st.buyer !== buyerKey) throw Object.assign(new Error('session closed'), { status: 409 });
    let reply;
    if (msg.accept != null) {
      if (st.asks[msg.round] !== msg.accept) throw Object.assign(new Error('that was not our ask'), { status: 409 });
      reply = s(msg);
    } else {
      if (msg.round !== st.round || msg.round > ROUNDS + 1) throw Object.assign(new Error(`expected round ${st.round}`), { status: 409 });
      reply = s(msg);
      st.round++;
      if (reply.ask != null) st.asks[msg.round] = reply.ask;
    }
    const out = { ...reply, session: msg.session, round: msg.round, sku: msg.sku, supplier: catalog.supplier.id, at: new Date().toISOString() };
    const signed = { ...out, sig: signObj(out, key.priv) };
    st.transcript.push({ buyer: { msg, sig }, seller: signed });
    if (reply.accept != null || reply.confirmed != null || !reply.qty) { st.done = true; log({ session: msg.session, sku: msg.sku, deal: reply.accept ?? reply.confirmed ?? null, qty: reply.qty, transcript: st.transcript, at: out.at }); }
    sessions.set(msg.session, st);
    return signed;
  };
}

// ── Witness: countersign a till's tree head after checking the chain only grew. state = { n, head, leaves } ──
export function witness(state, { entries, head }, key) {
  const next = extend(state, entries);                       // throws if the new entries do not chain onto what we saw
  if (next.head !== head.head || next.n !== head.n || next.root !== head.root) throw Object.assign(new Error('tree head does not match the entries'), { status: 409 });
  const cosig = signObj({ ...head, witness: 'supplier' }, key.priv);
  return { state: next, cosig };
}
