// End-to-end UI check against a running instance: chat → proposal card → Confirm → QR card.
//   docker run --rm --network host -v $PWD:/s mcr.microsoft.com/playwright:v1.55.0-noble \
//     sh -c "cd /tmp && npm i -s playwright@1.55.0 >/dev/null && cp /s/test/ui.mjs . && node ui.mjs http://127.0.0.1:8310 /s/test/out"
import { chromium } from 'playwright';
const [base, out] = process.argv.slice(2);
const b = await chromium.launch();
let fail = 0;
for (const [label, vp, lang, said] of [
  ['desktop', { width: 1280, height: 860 }, 'en', 'Two macchiatos and a small water, he pays now'],
  ['phone', { width: 390, height: 844 }, 'sq', 'Dy ujë të mëdhenj dhe një bukë integrale, paguan tani me QR'],
]) {
  const p = await b.newPage({ viewport: vp, locale: lang === 'sq' ? 'sq-AL' : 'en-US', colorScheme: label === 'phone' ? 'dark' : 'light' });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(base);
  await p.screenshot({ path: `${out}/${label}-0-start.png` });
  await p.fill('#q', said);
  await p.click('#go');
  await p.waitForSelector('.card.proposal', { timeout: 120000 });
  await p.screenshot({ path: `${out}/${label}-1-proposal.png` });
  await p.click('.card.proposal .primary');
  await p.waitForSelector('.card.payment .qr svg', { timeout: 30000 });
  await p.screenshot({ path: `${out}/${label}-2-qr.png` });
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  const total = await p.textContent('.card.payment .total');
  console.log(label, 'total', total, 'h-overflow', overflow, 'errors', errors.length);
  if (overflow || errors.length) fail++;
  await p.close();
}
await b.close();
process.exit(fail ? 1 : 0);
