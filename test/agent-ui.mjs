// The owner's path in a real browser against a running instance: make a key (WebCrypto Ed25519), sign a mandate,
// run the agent on the owner's signed word, see every supplier offer verify; then a receipt check on a phone.
//   docker run --rm --network host -v $PWD:/s mcr.microsoft.com/playwright:v1.55.0-noble \
//     sh -c "cd /tmp && npm i -s playwright@1.55.0 >/dev/null && cp /s/test/agent-ui.mjs . && node agent-ui.mjs https://kasa.spacecode.tech K-REF /s/test/out"
import { chromium } from 'playwright';
const [base, ref, out] = process.argv.slice(2);
const b = await chromium.launch();
let fail = 0;
const ok = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) fail = 1; };
{
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(base);
  await p.click('#agentBtn');
  await p.getByRole('button', { name: /Create owner key/ }).click();
  await p.getByRole('button', { name: 'Sign mandate' }).waitFor();
  ok(/[0-9a-f]{4} [0-9a-f]{4}/.test(await p.textContent('#agent .fp')), `owner key made in the browser: ${await p.textContent('#agent .fp')}`);
  await p.fill('#agent .fields input >> nth=0', '50');
  await p.getByRole('button', { name: 'Sign mandate' }).click();
  await p.getByText('Signed by you').waitFor();
  ok(true, 'mandate signed in the browser and accepted by the server');
  await p.getByRole('button', { name: 'Run the agent' }).click();
  await p.locator('#agent .trace').first().waitFor({ timeout: 60e3 });
  const lines = await p.locator('#agent .okline, #agent .trace .error').allTextContents();
  console.log('  ', lines.join(' | '));
  ok(lines.some(l => /✓ \d+ supplier signatures verified here/.test(l)) && !lines.some(l => l.includes('✗')), 'supplier signatures verified in the browser');
  ok(await p.locator('#agent .ladder polyline').count() >= 2, 'offer ladder drawn');
  await p.screenshot({ path: `${out}/agent-desktop.png` });
  ok(!errors.length, `no page errors ${errors.join('; ')}`);
}
{
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, locale: 'sq-AL', colorScheme: 'dark' }), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(`${base}/v/${ref}`);
  await p.locator('#checks li.ok').nth(3).waitFor({ timeout: 30e3 }).catch(() => {});
  const rows = await p.locator('#checks li').allTextContents();
  console.log('  ', rows.join(' | '));
  ok(rows.length >= 5 && await p.locator('#checks li.bad').count() === 0, `receipt ${ref}: ${await p.locator('#checks li.ok').count()} checks pass on the phone`);
  await p.screenshot({ path: `${out}/receipt-phone.png`, fullPage: true });
  const w = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(w <= 390, `no sideways scroll (${w})`);
  ok(!errors.length, `no page errors ${errors.join('; ')}`);
}
{
  const p = await b.newPage({ viewport: { width: 1000, height: 800 } });
  await p.goto(base.replace('kasa.', 'kasa-supplier.'));
  await p.locator('#deals li small').first().waitFor();
  await p.screenshot({ path: `${out}/supplier.png` });
  ok(true, 'supplier page lists its signed negotiations');
}
await b.close();
process.exit(fail);
