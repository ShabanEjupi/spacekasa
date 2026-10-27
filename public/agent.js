'use strict';
// The owner's side of the procurement agent: a key made in this browser, a mandate signed with it, and the trace of
// each run — forecast, every signed offer from the supplier (checked here), the verifier's ruling, the payout.
const A = {
  en: { agent: 'Agent', title: 'Procurement agent', close: 'Close', owner: 'Owner key', none: 'No owner yet: this till runs the sandbox demo under the demo mandate.',
        make: 'Create owner key in this browser', mine: 'Owner key (stays in this browser, cannot be exported)', other: 'This till has an owner key that is not in this browser.',
        mandate: 'Mandate', perOrder: 'Per order €', perWeek: 'Per week €', factor: 'Max × reference price', until: 'Valid until', sign: 'Sign mandate',
        signed: 'Signed by you', demo: 'Demo mandate (signed by the server)', run: 'Run the agent', running: 'Forecasting, haggling, paying…', nokey: 'This browser cannot make Ed25519 keys — try a current Chrome, Firefox or Safari.',
        stock: 'stock', perDay: '/day', order: 'order', 'enough stock': 'enough stock', paid: 'paid', 'paid part': 'paid part', 'needs a human': 'needs a human',
        sellerSig: 'supplier signatures verified here', badSig: 'a supplier signature did not verify', payout: 'PayPal payout', contract: 'contract', ask: 'supplier asks', bid: 'our bids', cap: 'mandate cap' },
  sq: { agent: 'Agjenti', title: 'Agjenti i furnizimit', close: 'Mbyll', owner: 'Çelësi i pronarit', none: 'Ende pa pronar: kjo arkë punon me demon sandbox nën mandatin demo.',
        make: 'Krijo çelësin e pronarit te ky shfletues', mine: 'Çelësi i pronarit (rri te ky shfletues, s\'mund të nxirret)', other: 'Kjo arkë ka çelës pronari që nuk është te ky shfletues.',
        mandate: 'Mandati', perOrder: 'Për porosi €', perWeek: 'Në javë €', factor: 'Maks. × çmimi referues', until: 'Vlen deri', sign: 'Nënshkruaj mandatin',
        signed: 'I nënshkruar nga ti', demo: 'Mandati demo (i nënshkruar nga serveri)', run: 'Nise agjentin', running: 'Parashikim, pazar, pagesë…', nokey: 'Ky shfletues s\'krijon dot çelësa Ed25519 — provo Chrome, Firefox ose Safari të ri.',
        stock: 'gjendja', perDay: '/ditë', order: 'porosi', 'enough stock': 'mjafton', paid: 'u pagua', 'paid part': 'u pagua pjesërisht', 'needs a human': 'duhet njeriu',
        sellerSig: 'nënshkrimet e furnitorit u verifikuan këtu', badSig: 'një nënshkrim i furnitorit s\'u verifikua', payout: 'Pagesë PayPal', contract: 'kontrata', ask: 'furnitori kërkon', bid: 'ofertat tona', cap: 'kufiri i mandatit' },
};
const a = k => A[lang][k] ?? k;
const dlg = document.querySelector('#agent');
let state = null, key = null, lastTrace = null;

async function loadAgent() {
  state = await (await fetch('/api/procure', { headers: H })).json();
  key = await SK.ownerKey(TILL);
  drawAgent();
}
function field(label, input) { const l = el('label', 'field'); l.append(el('span', '', label), input); return l; }
function num(v, step) { const i = el('input'); i.type = 'number'; i.step = step; i.value = v; i.inputMode = 'decimal'; return i; }

async function drawAgent() {
  const body = dlg.querySelector('.body');
  dlg.querySelector('h2').textContent = a('title');
  dlg.querySelector('.close').textContent = a('close');
  const out = [];
  // Owner
  const ow = el('section');
  ow.append(el('h3', '', a('owner')));
  const mineKey = key && state.owner && await SK.pub(key) === state.owner.key;
  if (mineKey) ow.append(el('p', 'dim', a('mine')), el('code', 'fp', await SK.fingerprint(state.owner.key)));
  else if (state.owner) ow.append(el('p', 'dim', a('other')));
  else {
    ow.append(el('p', 'dim', a('none')));
    const b = el('button', 'primary', a('make'));
    b.onclick = async () => {
      if (!await SK.supported()) { ow.append(el('p', 'error', a('nokey'))); return; }
      b.disabled = true;
      try { key = await SK.makeOwnerKey(TILL); await post('/api/owner', { key: await SK.pub(key) }); await loadAgent(); }
      catch (e) { b.disabled = false; ow.append(el('p', 'error', e.message)); }
    };
    ow.append(b);
  }
  out.push(ow);
  // Mandate
  const m = state.mandate, ms = el('section');
  ms.append(el('h3', '', `${a('mandate')} · ${m.id}`), el('p', 'dim', state.owner?.mandate ? a('signed') : a('demo')));
  const po = num(m.perOrder, 1), pw = num(m.perWeek, 1), pf = num(m.priceFactor, 0.01), un = el('input');
  un.type = 'date'; un.value = m.until.slice(0, 10);
  const grid = el('div', 'fields');
  grid.append(field(a('perOrder'), po), field(a('perWeek'), pw), field(a('factor'), pf), field(a('until'), un));
  ms.append(grid);
  if (mineKey) {
    const sb = el('button', 'ghost', a('sign'));
    sb.onclick = async () => {
      sb.disabled = true;
      const body = { id: `M-${Date.now().toString(36).toUpperCase()}`, agent: 'procurement', kind: 'buy', perOrder: +po.value, perWeek: +pw.value, priceFactor: +pf.value,
        skus: state.supplies.map(s => s.sku), suppliers: [state.supplier.id], reference: Object.fromEntries(state.supplies.map(s => [s.sku, s.reference])),
        from: new Date().toISOString().slice(0, 10) + 'T00:00:00Z', until: un.value + 'T00:00:00Z' };
      try { await post('/api/mandate', { mandate: { ...body, sig: await SK.sign(key, body) } }); await loadAgent(); }
      catch (e) { sb.disabled = false; ms.append(el('p', 'error', e.message)); }
    };
    ms.append(sb);
  } else [po, pw, pf, un].forEach(i => { i.disabled = true; });
  out.push(ms);
  // Run
  const rs = el('section'), rb = el('button', 'primary', a('run'));
  rb.onclick = async () => {
    rb.disabled = true; rb.textContent = a('running');
    try {
      const at = new Date().toISOString(), req = mineKey ? { at, sig: await SK.sign(key, { op: 'procure', till: TILL, at }) } : {};
      lastTrace = await post('/api/procure', req);
      await loadAgent();
    } catch (e) { rb.disabled = false; rb.textContent = a('run'); rs.append(el('p', 'error', e.message)); }
  };
  rs.append(rb);
  if (lastTrace) for (const tr of lastTrace.trace) rs.append(await traceCard(tr, lastTrace));
  out.push(rs);
  body.replaceChildren(...out);
}

async function traceCard(tr, run) {
  const s = state.supplies.find(x => x.sku === tr.sku), box = el('div', `trace o-${tr.outcome.replace(/\W+/g, '-')}`);
  const head = el('div', 'kicker');
  head.append(el('span', '', s ? name(s) : tr.sku), el('span', 'badge', a(tr.outcome)));
  box.append(head, el('div', 'dim', `${a('stock')} ${tr.stock} · ${tr.perDay}${a('perDay')}${tr.order ? ` · ${a('order')} ${tr.order}` : ''}`));
  if (tr.offers?.length) {
    box.append(ladder(tr.offers, s ? s.reference * run.mandate.priceFactor : null));
    if (run.supplierKey && tr.offers.some(o => o.signed)) {
      // Each offer is checked against the supplier's pinned key, here in the browser, from the signed reply itself.
      const ok = (await Promise.all(tr.offers.filter(o => o.signed).map(o => SK.verify(o.signed, o.sig, run.supplierKey)))).every(Boolean);
      box.append(el('div', ok ? 'okline' : 'error', `${ok ? '✓' : '✗'} ${tr.offers.filter(o => o.signed).length} ${ok ? a('sellerSig') : a('badSig')}`));
    }
  }
  if (tr.why) box.append(el('div', 'dim', tr.why));
  if (tr.payout) box.append(el('div', 'okline', `✓ ${a('payout')} ${tr.payout} · ${tr.total.toFixed(2)} €`));
  if (tr.contract) box.append(el('code', 'fp', `${a('contract')} ${tr.contract.slice(0, 16)}…`));
  return box;
}

// Offers over the rounds: the supplier coming down, us going up, the mandate's ceiling as a dashed line.
function ladder(log, cap) {
  const pts = log.filter(o => o.unit != null), W = 300, Hh = 110, P = 8;
  const ys = pts.map(o => o.unit).concat(cap ? [cap] : []), lo = Math.min(...ys), hi = Math.max(...ys), R = Math.max(...pts.map(o => o.round), 1);
  const x = r => P + (W - 2 * P) * r / R, y = v => Hh - P - (Hh - 2 * P) * (hi === lo ? 0.5 : (v - lo) / (hi - lo));
  const line = who => pts.filter(o => o.from === who).map(o => `${x(o.round).toFixed(1)},${y(o.unit).toFixed(1)}`).join(' ');
  const deal = pts.find(o => o.ok);
  const svg = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="${a('ask')} / ${a('bid')}">
    ${cap ? `<line x1="${P}" x2="${W - P}" y1="${y(cap)}" y2="${y(cap)}" class="cap"/>` : ''}
    <polyline points="${line('seller')}" class="ask"/><polyline points="${line('buyer')}" class="bid"/>
    ${deal ? `<circle cx="${x(deal.round)}" cy="${y(deal.unit)}" r="5" class="deal"/><text x="${Math.min(x(deal.round) + 8, W - 60)}" y="${y(deal.unit) + 18}">${deal.unit.toFixed(2)} €</text>` : ''}</svg>`;
  const d = el('div', 'ladder');
  d.innerHTML = svg;                 // built from numbers only
  const k = el('div', 'legend');
  k.append(el('span', 'k-ask', a('ask')), el('span', 'k-bid', a('bid')), ...(cap ? [el('span', 'k-cap', `${a('cap')} ${cap.toFixed(2)} €`)] : []));
  d.append(k);
  return d;
}

document.querySelector('#agentBtn').onclick = () => { dlg.showModal(); loadAgent().catch(e => dlg.querySelector('.body').replaceChildren(el('p', 'error', e.message))); };
dlg.querySelector('.close').onclick = () => dlg.close();
const agentLang = () => { document.querySelector('#agentBtn').textContent = a('agent'); if (dlg.open && state) drawAgent(); };
document.querySelector('#lang').addEventListener('click', agentLang);
agentLang();
