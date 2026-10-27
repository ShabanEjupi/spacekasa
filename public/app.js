'use strict';
// The cashier's screen: chat on the left, today's payments on the right.
// Proposals from the agent arrive as cards; nothing is charged until Confirm.

const T = {
  en: { tagline: 'talk to your till', sandbox: 'PayPal sandbox', h1: 'Say what the customer is buying.',
        intro: 'SpaceKasa finds the items, prices them from the catalogue and prepares a PayPal QR or invoice. You confirm every payment.',
        send: 'Send', placeholder: 'e.g. two macchiatos and a water, QR', today: 'Today', confirm: 'Confirm', dismiss: 'Dismiss',
        checkout_qr: 'Charge now by QR', checkout_invoice: 'Send PayPal invoice', refund: 'Refund', cancel: 'Cancel payment',
        scan: 'Customer scans to pay', open: 'Open payment page', copy: 'Copy link', copied: 'Copied',
        awaiting_payment: 'Waiting for payment', paid: 'Paid', refunded: 'Refunded', cancelled: 'Cancelled', failed: 'Declined by PayPal',
        paid_s: 'paid', awaiting_s: 'waiting', none: 'No payments yet.', thinking: 'Thinking…', err: 'Something went wrong',
        listening: 'Listening…', for: 'for', verify: 'Verify receipt',
        ex: ['Two macchiatos and a small water, she pays now', 'Invoice Blue Desk office for 12 cappuccinos, office@example.com', 'How much did we take today?'] },
  sq: { tagline: 'fol me arkën', sandbox: 'PayPal sandbox', h1: 'Thuaj çka po blen klienti.',
        intro: 'SpaceKasa i gjen artikujt, ua merr çmimin nga katalogu dhe përgatit QR ose faturë PayPal. Çdo pagesë e konfirmon ti.',
        send: 'Dërgo', placeholder: 'p.sh. dy makiato dhe një ujë, me QR', today: 'Sot', confirm: 'Konfirmo', dismiss: 'Hiqe',
        checkout_qr: 'Paguaj tani me QR', checkout_invoice: 'Dërgo faturë PayPal', refund: 'Kthe paratë', cancel: 'Anulo pagesën',
        scan: 'Klienti e skanon për të paguar', open: 'Hap faqen e pagesës', copy: 'Kopjo lidhjen', copied: 'U kopjua',
        awaiting_payment: 'Në pritje të pagesës', paid: 'U pagua', refunded: 'U kthye', cancelled: 'U anulua', failed: 'PayPal e refuzoi',
        paid_s: 'paguar', awaiting_s: 'në pritje', none: 'Ende asnjë pagesë.', thinking: 'Po mendoj…', err: 'Diçka shkoi keq',
        listening: 'Po dëgjoj…', for: 'për', verify: 'Verifiko kuponin',
        ex: ['Dy makiato dhe një ujë i vogël, paguan tani', 'Faturo zyrën Blue Desk për 12 kapuçino, office@example.com', 'Sa kemi xhiru sot?'] },
};
let lang = 'en';
try { lang = localStorage.getItem('kasa-lang') || ((navigator.language || '').startsWith('sq') ? 'sq' : 'en'); } catch {}
const t = k => T[lang][k] ?? k;
// This browser's till id: the server shows each till only its own payments.
const TILL = (() => {
  let v = '';
  try { v = localStorage.getItem('kasa-till') || ''; } catch {}
  if (!/^[a-z0-9]{8,32}$/.test(v)) { v = crypto.randomUUID().replace(/-/g, '').slice(0, 20); try { localStorage.setItem('kasa-till', v); } catch {} }
  return v;
})();
const H = { 'X-Till': TILL };
const $ = s => document.querySelector(s);
const chat = $('#chat');
const history = [];
const watching = new Map();   // ref → card element, polled until final

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(e => { e.textContent = t(e.dataset.t); });
  $('#q').placeholder = t('placeholder');
  $('#lang').textContent = lang === 'en' ? 'SQ' : 'EN';
  const ex = $('#examples');
  ex.replaceChildren(...T[lang].ex.map(s => { const b = el('button', 'chip', s); b.type = 'button'; b.onclick = () => ask(s); return b; }));
  loadPayments();
}
$('#lang').onclick = () => { lang = lang === 'en' ? 'sq' : 'en'; try { localStorage.setItem('kasa-lang', lang); } catch {} applyLang(); };

function bubble(role, text) {
  chat.querySelector('.intro')?.remove();
  const b = el('div', `msg ${role}`, text.replace(/\*\*(.+?)\*\*/g, '$1'));
  chat.append(b);
  b.scrollIntoView({ block: 'end', behavior: 'smooth' });
  return b;
}

const name = l => (lang === 'sq' ? l.sq : l.en);
function linesTable(lines, cur) {
  const tb = el('table', 'lines');
  for (const l of lines) {
    const tr = el('tr');
    tr.append(el('td', 'q', `${l.qty}×`), el('td', '', name(l)), el('td', 'n', `${((l.unit * l.qty) / 100).toFixed(2)} ${cur}`));
    tb.append(tr);
  }
  return tb;
}

function proposalCard(c) {
  const box = el('div', 'card proposal');
  const title = c.action === 'checkout' ? t(c.method === 'invoice' ? 'checkout_invoice' : 'checkout_qr') : `${t(c.action)} · ${c.ref}`;
  box.append(el('div', 'kicker', title));
  if (c.customer || c.email) box.append(el('div', 'who', [c.customer, c.email].filter(Boolean).join(' · ')));
  if (c.action === 'checkout') box.append(linesTable(c.lines, c.currency));
  box.append(el('div', 'total', `${c.total} ${c.currency}`));
  const row = el('div', 'row');
  const ok = el('button', 'primary', t('confirm'));
  const no = el('button', 'ghost', t('dismiss'));
  ok.onclick = async () => {
    ok.disabled = no.disabled = true;
    try {
      const r = await post('/api/confirm', { id: c.id });
      box.replaceWith(paymentCard(r));
      loadPayments();
    } catch (e) { ok.disabled = no.disabled = false; box.append(el('div', 'error', e.message)); }
  };
  no.onclick = () => { post('/api/dismiss', { id: c.id }).catch(() => {}); box.remove(); };
  row.append(ok, no);
  box.append(row);
  return box;
}

function paymentCard(p) {
  const box = el('div', `card payment s-${p.status}`);
  box.dataset.ref = p.ref;
  const head = el('div', 'kicker');
  head.append(el('span', '', `${p.ref}${p.customer ? ` · ${p.customer}` : ''}`), el('span', 'badge', t(p.status)));
  box.append(head, el('div', 'total', `${p.total} ${p.currency}`));
  if (p.error) box.append(el('div', 'error', p.error));
  if (p.qr) {
    const q = el('div', 'qr');
    q.innerHTML = p.qr;            // SVG generated by our own server-side encoder
    box.append(q, el('div', 'hint', t('scan')));
  }
  if (p.url && p.status === 'awaiting_payment') {
    const row = el('div', 'row');
    const a = el('a', 'ghost btn', t('open'));
    a.href = p.url; a.target = '_blank'; a.rel = 'noopener';
    const cp = el('button', 'ghost', t('copy'));
    cp.onclick = () => navigator.clipboard?.writeText(p.url).then(() => { cp.textContent = t('copied'); });
    row.append(a, cp);
    box.append(row);
  }
  if (p.receipt) {
    const v = el('a', 'ghost btn receipt', t('verify'));
    v.href = p.receipt; v.target = '_blank'; v.rel = 'noopener';
    box.append(v);
  }
  if (p.status === 'awaiting_payment') watch(p.ref, box);
  return box;
}

let polling = false;           // one poll loop; a card watched while a poll is in flight used to start a second one
function watch(ref, box) {
  watching.set(ref, box);
  if (!polling) { polling = true; setTimeout(poll, 4000); }
}
async function poll() {
  for (const [ref] of watching) {
    try {
      const r = await fetch(`/api/payment/${ref}`, { headers: H });
      if (!r.ok) continue;          // a PayPal hiccup is not a final state: keep the QR up and ask again
      const p = await r.json();
      if (p.status !== 'awaiting_payment') {
        watching.delete(ref);
        // Every card of this payment (check_payment can show it twice), not only the last one watched.
        document.querySelectorAll(`.card.payment[data-ref="${ref}"]`).forEach(n => n.replaceWith(paymentCard(p)));
        loadPayments();
      }
    } catch {}
  }
  if (watching.size) setTimeout(poll, 4000); else polling = false;
}

async function post(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || t('err'));
  return j;
}

async function ask(text) {
  text = text.trim();
  if (!text) return;
  bubble('user', text);
  history.push({ role: 'user', content: text });
  const wait = bubble('bot pending', t('thinking'));
  $('#go').disabled = true;
  try {
    const r = await post('/api/chat', { messages: history, lang });
    wait.remove();
    if (r.reply) { bubble('bot', r.reply); history.push({ role: 'assistant', content: r.reply }); }
    // Only one open proposal at a time: a new one replaces whatever was not confirmed yet.
    if (r.cards.some(c => c.type === 'proposal')) chat.querySelectorAll('.card.proposal').forEach(n => n.querySelector('.ghost')?.click());
    for (const c of r.cards) {
      const node = c.type === 'proposal' ? proposalCard(c) : paymentCard(c);
      chat.append(node);
      node.scrollIntoView({ block: 'end', behavior: 'smooth' });
    }
    if (r.cards.length) loadPayments();
  } catch (e) {
    wait.remove();
    bubble('bot error', e.message);
  } finally { $('#go').disabled = false; }
}

$('#ask').onsubmit = e => { e.preventDefault(); const q = $('#q'); const v = q.value; q.value = ''; ask(v); };

async function loadPayments() {
  try {
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const list = await (await fetch(`/api/payments?since=${midnight.toISOString()}`, { headers: H })).json();
    const todays = list.filter(p => new Date(p.created) >= midnight);
    const ol = $('#payments');
    ol.replaceChildren(...todays.slice(0, 12).map(p => {
      const li = el('li', `s-${p.status}`);
      li.append(el('span', 'ref', p.ref), el('span', 'who', p.customer || (p.method === 'qr' ? 'QR' : '—')),
                el('span', 'n', `${p.total} ${p.currency}`), el('span', 'badge', t(p.status)));
      return li;
    }));
    if (!todays.length) ol.replaceChildren(el('li', 'empty', t('none')));
    // Whole cents, net of partial refunds, in the shop's currency.
    const c = s => Math.round(Number(s || 0) * 100), cur = todays[0]?.currency || 'EUR';
    const paid = todays.filter(p => p.status === 'paid').reduce((s, p) => s + c(p.total) - c(p.refunded), 0);
    const wait = todays.filter(p => p.status === 'awaiting_payment').reduce((s, p) => s + c(p.total), 0);
    $('#summary').replaceChildren(el('div', 'stat', `${(paid / 100).toFixed(2)} ${cur} ${t('paid_s')}`), el('div', 'stat dim', `${(wait / 100).toFixed(2)} ${cur} ${t('awaiting_s')}`));
  } catch {}
}

// Voice: the browser's own speech recognition, when it has one.
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!SR) $('#mic').hidden = true;
else $('#mic').onclick = () => {
  const r = new SR();
  r.lang = lang === 'sq' ? 'sq-AL' : 'en-US';
  r.interimResults = false;
  $('#q').placeholder = t('listening');
  $('#mic').classList.add('on');
  r.onresult = e => ask(e.results[0][0].transcript);
  r.onend = () => { $('#mic').classList.remove('on'); $('#q').placeholder = t('placeholder'); };
  r.start();
};

applyLang();
