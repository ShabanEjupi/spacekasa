// Records the demo: plays script.json against a live instance and logs, for every narration segment,
// when it started and when the app answered. compose.mjs later cuts the "Thinking…" waits out.
// The customer's phone is a second, recorded browser (phone.webm); compose.mjs shows it beside the till.
//   node record.mjs <base-url> <dir with durations.json> [en|sq]  →  <dir>/raw.webm, phone.webm, timeline.json
import { chromium, devices } from 'playwright';
import fs from 'node:fs';

const [base, dir, lang = 'en'] = process.argv.slice(2);
const script = JSON.parse(fs.readFileSync(new URL('./script.json', import.meta.url)));
const durs = JSON.parse(fs.readFileSync(`${dir}/durations.json`));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5, colorScheme: 'light',
  recordVideo: { dir, size: { width: 1920, height: 1080 } }, locale: lang === 'sq' ? 'sq-AL' : 'en-US' });
// Video has no mouse pointer of its own: draw one, with a ring on every click, so viewers can follow the cashier.
await ctx.addInitScript(() => addEventListener('DOMContentLoaded', () => {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;'
    + 'background:rgba(15,107,85,.35);border:2px solid #0f6b55;z-index:99999;pointer-events:none;transition:transform .15s';
  document.body.append(c);
  addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { c.style.transform = 'scale(1.8)'; setTimeout(() => (c.style.transform = ''), 220); }, true);
}));
const p = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const sleep = s => p.waitForTimeout(Math.max(0, s * 1000));
let mouse = { x: 640, y: 360 };
const moveTo = async sel => {
  const r = await p.locator(sel).last().boundingBox();
  const to = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  await p.mouse.move(to.x, to.y, { steps: 25 });
  mouse = to;
};

const T = {
  en: { intro: ['SpaceKasa', 'Talk to your till.', 'A language-model assistant for small cafés · payments by PayPal'],
        outro: ['SpaceKasa', 'Prices only from the menu · No money moves without a tap · Refunds capped at what was paid',
                'kasa.spacecode.tech · git.spacecode.tech/shaban/spacekasa'] },
  sq: { intro: ['SpaceKasa', 'Fol me arkën.', 'Asistent me model gjuhësor për kafenetë e vogla · pagesat me PayPal'],
        outro: ['SpaceKasa', 'Çmimet vetëm nga menyja · Asnjë pagesë pa prekjen e njeriut · Kthimi sa u pagua',
                'kasa.spacecode.tech · git.spacecode.tech/shaban/spacekasa'] },
};
const card = ([title, big, small]) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 30% 20%,#17463a,#0b1714 70%);
       color:#eef3ef;font:16px/1.4 system-ui,"DejaVu Sans",sans-serif;text-align:center}
  .logo{width:34px;height:34px;background:#3fb68f;border-radius:7px;transform:rotate(45deg);margin:0 auto 26px}
  h1{font-size:64px;margin:0;letter-spacing:-1px} h2{font-size:30px;font-weight:500;margin:14px 0 26px;color:#bfe3d4}
  p{font-size:19px;color:#9fb8ae;max-width:900px;margin:0 auto} .pp{margin-top:34px;font-size:15px;color:#6f8a80}</style>
  <div><div class="logo"></div><h1>${title}</h1><h2>${big}</h2><p>${small}</p><p class="pp">PayPal AI Hackathon 2026 · PayPal sandbox</p></div>`;

const timeline = [];
let phone;
for (const [i, seg] of script.entries()) {
  const start = now();
  if (seg.card) await p.setContent(card(T[lang][seg.card]));
  if (seg.goto) { await p.goto(base); await p.mouse.move(mouse.x, mouse.y); await sleep(1.2); }
  const before = seg.until ? await p.locator(seg.until).count() : 0;
  let acted = start;
  const typed = lang === 'sq' ? seg.type_sq || seg.type : seg.type;
  if (typed) {
    await moveTo('#q'); await p.mouse.down(); await p.mouse.up();
    await p.locator('#q').pressSequentially(typed, { delay: 38 });
    await moveTo('#go'); await sleep(0.3); await p.mouse.down(); await p.mouse.up();
    acted = now();
  }
  if (seg.click) { await sleep(1.0); await moveTo(seg.click); await sleep(0.4); await p.mouse.down(); await p.mouse.up(); acted = now(); }
  if (seg.pay) {
    // The customer's phone: a separate browser, recorded on its own, pays the newest QR in the PayPal sandbox.
    const url = await p.locator('.card.payment a.btn').last().getAttribute('href');
    const pctx = await b.newContext({ ...devices['iPhone 13'], locale: 'en-US', recordVideo: { dir: `${dir}/ph`, size: { width: 780, height: 1328 } } });
    const buyer = await pctx.newPage();
    const pStart = now();
    await buyer.goto(url + '&locale.x=en_US'); // the host sits in the Netherlands, so PayPal would otherwise speak Dutch
    await buyer.locator('#email').pressSequentially(process.env.BUYER_EMAIL, { delay: 25, timeout: 60000 });
    await buyer.click('#btnNext');
    // The password page re-renders right after it appears and drops what was typed; type again until it sticks.
    for (let i = 0; i < 4; i++) {
      await buyer.waitForTimeout(1000);
      await buyer.locator('#password').fill('', { timeout: 30000 });
      await buyer.locator('#password').pressSequentially(process.env.BUYER_PASS, { delay: 30 });
      if (await buyer.locator('#password').inputValue() === process.env.BUYER_PASS) break;
    }
    await buyer.click('#btnLogin');
    // Same button variants as test/pay.mjs: the mobile sandbox page labels it differently. A screenshot tells why when none shows.
    await buyer.locator('#payment-submit-btn, button:has-text("Complete Purchase"), button:has-text("Pay"), button:has-text("Continue to Review Order")').first()
      .click({ timeout: 60000 }).catch(async e => { await buyer.screenshot({ path: `${dir}/pay-fail.png` }); throw e; });
    await buyer.waitForURL(/\/paid\?/, { timeout: 60000 });
    await buyer.waitForTimeout(1500);
    const pEnd = now();
    const v = buyer.video();
    await pctx.close();
    fs.renameSync(await v.path(), `${dir}/phone.webm`);
    phone = { start: pStart, end: pEnd };
    acted = now();
  }
  let done = acted;
  if (seg.until) {
    // Wait until one MORE element matches than before the action.
    await p.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [seg.until, before], { timeout: 150000 });
    done = now();
    await p.evaluate(() => document.querySelector('#chat')?.scrollTo({ top: 1e6, behavior: 'smooth' }));
  }
  const end = Math.max(done + 1.8, start + durs[i] + 0.7);
  await sleep(end - now());
  timeline.push({ i, start, acted, done, end, dur: durs[i], pay: !!seg.pay });
  console.log(i, `start ${start.toFixed(1)} acted ${acted.toFixed(1)} done ${done.toFixed(1)} end ${end.toFixed(1)}`);
}
await sleep(1.0);
const video = p.video();
await ctx.close();
fs.renameSync(await video.path(), `${dir}/raw.webm`);
fs.writeFileSync(`${dir}/timeline.json`, JSON.stringify({ total: now(), phone, timeline }, null, 1));
await b.close();
