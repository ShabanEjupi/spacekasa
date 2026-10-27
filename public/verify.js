'use strict';
// The receipt check runs here, on the customer's phone, from the published proofs. Nothing on this page asks the
// till to vouch for itself: every ✓ is a hash or a signature recomputed in this browser.
const T = {
  en: { tag: 'receipt check', how: 'Every line above is recomputed on this phone: SHA-256 Merkle proofs and Ed25519 signatures. The supplier is a separate server that countersigns the books only after checking they were only ever appended to.',
        pin: 'This is the receipt you were given (its hash matches the QR)', day: 'It is in the day\'s published books', log: 'It is in the whole log up to entry', till: 'The till signed that log state', wit: 'The supplier, an independent server, countersigned it',
        direct: 'The supplier\'s key, fetched from the supplier itself, matches', notyet: 'Not countersigned yet — try again in a minute', missing: 'No such receipt', paid: 'Paid', refunded: 'Refunded', sent: 'Sent', awaiting_payment: 'Waiting', cancelled: 'Cancelled', failed: 'Declined', key: 'key' },
  sq: { tag: 'verifikimi i kuponit', how: 'Çdo rresht më lart rillogaritet te ky telefon: prova Merkle SHA-256 dhe nënshkrime Ed25519. Furnitori është server tjetër që i kundërnënshkruan librat vetëm pasi verifikon se atyre vetëm u është shtuar.',
        pin: 'Ky është kuponi që more (hash-i i tij përputhet me QR-në)', day: 'Është te librat e publikuar të ditës', log: 'Është te i gjithë ditari deri te hyrja', till: 'Arka e nënshkroi atë gjendje të ditarit', wit: 'Furnitori, server i pavarur, e kundërnënshkroi',
        direct: 'Çelësi i furnitorit, marrë nga vetë furnitori, përputhet', notyet: 'Ende pa kundërnënshkrim — provo pas një minute', missing: 'Ky kupon nuk ekziston', paid: 'U pagua', refunded: 'U kthye', sent: 'U dërgua', awaiting_payment: 'Në pritje', cancelled: 'U anulua', failed: 'U refuzua', key: 'çelësi' },
};
let lang = (navigator.language || '').startsWith('sq') ? 'sq' : 'en';
try { lang = localStorage.getItem('kasa-lang') || lang; } catch {}
const t = k => T[lang][k] ?? k, $ = s => document.querySelector(s);
const ref = location.pathname.split('/').pop().toUpperCase(), pin = location.hash.slice(1).toLowerCase();
let data = null;
const row = (ok, text, sub) => {
  const li = document.createElement('li'); li.className = ok === null ? 'wait' : ok ? 'ok' : 'bad';
  li.append(document.createTextNode(`${ok === null ? '…' : ok ? '✓' : '✗'} ${text}`));
  if (sub) { const s = document.createElement('small'); s.textContent = sub; li.append(s); }
  return li;
};
async function render() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach(e => { e.textContent = t(e.dataset.t); });
  $('#lang').textContent = lang === 'en' ? 'SQ' : 'EN';
  $('#ref').textContent = ref;
  const ol = $('#checks');
  if (!data) { ol.replaceChildren(row(false, t('missing'))); return; }
  const leaves = await Promise.all(data.facts.map(f => SK.leaf(f.fact)));
  // The QR pins 16 hex digits; a shorter "pin" (one digit matches 1 in 16 leaves) must not earn a ✓.
  const i = pin ? leaves.findIndex(h => pin.length >= 16 && h.startsWith(pin)) : leaves.length - 1, f = data.facts[Math.max(i, 0)];
  $('#status').textContent = t(f.fact.status);
  $('#amount').textContent = `${(f.fact.total / 100).toFixed(2)} €`;
  $('#when').textContent = new Date(f.fact.at).toLocaleString(lang === 'sq' ? 'sq-AL' : 'en-GB');
  const out = [];
  if (pin) out.push(row(i >= 0, t('pin'), pin));
  out.push(row(await SK.walk(f.fact, f.proof) === f.root, t('day'), `${f.day} · ${f.root.slice(0, 16)}…`));
  const h = data.head;
  if (!h || !f.logProof) out.push(row(null, t('notyet')));
  else {
    out.push(row(await SK.walk(f.fact, f.logProof) === h.head.root, `${t('log')} ${h.head.n}`, `${h.head.root.slice(0, 16)}…`));
    out.push(row(await SK.verify(h.head, h.sig, data.tillKey), t('till'), `${t('key')} ${await SK.fingerprint(data.tillKey)}`));
    out.push(row(await SK.verify({ ...h.head, witness: 'supplier' }, h.cosig, h.witnessKey), t('wit'), `${t('key')} ${await SK.fingerprint(h.witnessKey)}`));
    // Ask the supplier directly, not through the till: the witness key must be the one the supplier itself publishes.
    try {
      const s = await (await fetch(`${data.supplierUrl}/a2a/key`)).json();
      out.push(row(s.key === h.witnessKey, t('direct'), data.supplierUrl.replace(/^https?:\/\//, '')));
    } catch { out.push(row(false, t('direct'), data.supplierUrl)); }
  }
  ol.replaceChildren(...out);
}
$('#lang').onclick = () => { lang = lang === 'en' ? 'sq' : 'en'; try { localStorage.setItem('kasa-lang', lang); } catch {} render(); };
fetch(`/api/receipt/${encodeURIComponent(ref)}`).then(r => r.ok ? r.json() : null).then(j => { data = j; render(); }).catch(() => render());
