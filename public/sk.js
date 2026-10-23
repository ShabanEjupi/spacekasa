'use strict';
// Browser half of SpaceKasa's cryptography, the same rules as mandate.mjs / audit.mjs: canonical JSON, SHA-256 with
// domain-separated Merkle leaves and nodes, Ed25519. The owner's key is made here and stored in IndexedDB as a
// non-extractable CryptoKey: the private half cannot be read out, not even by this page.
const SK = (() => {
  const canonical = v => Array.isArray(v) ? `[${v.map(x => x === undefined ? 'null' : canonical(x)).join(',')}]`
    : v && typeof v === 'object' ? `{${Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v);
  const enc = new TextEncoder();
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const ED = { name: 'Ed25519' };
  const supported = async () => { try { await crypto.subtle.generateKey(ED, false, ['sign']); return true; } catch { return false; } };
  async function verify(obj, sig, keyB64) {
    try { return await crypto.subtle.verify(ED, await crypto.subtle.importKey('spki', unb64(keyB64), ED, false, ['verify']), unb64(sig), enc.encode(canonical(obj))); }
    catch { return false; }
  }
  const leaf = e => sha('0' + canonical(e)), node = (a, b) => sha('1' + a + b);
  async function walk(entry, steps) {
    let h = await leaf(entry);
    for (const [side, s] of steps) h = side === 'L' ? await node(s, h) : await node(h, s);
    return h;
  }
  // Owner keys, one per till.
  const open = () => new Promise((ok, no) => {
    const r = indexedDB.open('spacekasa', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('keys');
    r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error);
  });
  const tx = async (mode, f) => { const d = await open(); return new Promise((ok, no) => {
    const t = d.transaction('keys', mode), r = f(t.objectStore('keys'));
    t.oncomplete = () => ok(r.result); t.onerror = () => no(t.error);
  }); };
  const ownerKey = till => tx('readonly', s => s.get(till)).catch(() => null);
  async function makeOwnerKey(till) {
    const k = await crypto.subtle.generateKey(ED, false, ['sign', 'verify']);
    await tx('readwrite', s => s.put(k, till));
    return k;
  }
  const pub = async k => b64(await crypto.subtle.exportKey('spki', k.publicKey));
  const sign = async (k, obj) => b64(await crypto.subtle.sign(ED, k.privateKey, enc.encode(canonical(obj))));
  const fingerprint = async keyB64 => (await sha(keyB64)).slice(0, 16).replace(/(....)(?!$)/g, '$1 ');
  return { canonical, sha, verify, leaf, walk, supported, ownerKey, makeOwnerKey, pub, sign, fingerprint };
})();
