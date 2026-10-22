// Records the demo: plays script.json against a live instance and logs, for every narration segment,
// when it started and when the app answered. compose.mjs later cuts the "Thinking…" waits out.
//   node record.mjs <base-url> <dir with durations.json>  →  <dir>/raw.webm + <dir>/timeline.json
import { chromium } from 'playwright';
import fs from 'node:fs';

const [base, dir] = process.argv.slice(2);
const script = JSON.parse(fs.readFileSync(new URL('./script.json', import.meta.url)));
const durs = JSON.parse(fs.readFileSync(`${dir}/durations.json`));
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } }, locale: 'en-US' });
const p = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const sleep = s => p.waitForTimeout(Math.max(0, s * 1000));
await p.goto(base);
await sleep(0.8);

const timeline = [];
for (const [i, seg] of script.entries()) {
  const start = now();
  const before = seg.until ? await p.locator(seg.until).count() : 0;
  let acted = start;
  if (seg.type) {
    await p.locator('#q').pressSequentially(seg.type, { delay: 35 });
    await p.click('#go');
    acted = now();
  }
  if (seg.click) { await sleep(1.2); await p.click(seg.click); acted = now(); }
  let done = acted;
  if (seg.until) {
    // Wait until one MORE element matches than before the action.
    await p.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [seg.until, before], { timeout: 150000 });
    done = now();
    await p.evaluate(() => document.querySelector('#chat').scrollTo({ top: 1e6, behavior: 'smooth' }));
  }
  const end = Math.max(done + 1.8, start + durs[i] + 0.7);
  await sleep(end - now());
  timeline.push({ i, start, acted, done, end, dur: durs[i], say: seg.say });
  console.log(i, `start ${start.toFixed(1)} acted ${acted.toFixed(1)} done ${done.toFixed(1)} end ${end.toFixed(1)}`);
}
await sleep(1.5);
const video = p.video();
await ctx.close();
fs.renameSync(await video.path(), `${dir}/raw.webm`);
fs.writeFileSync(`${dir}/timeline.json`, JSON.stringify({ total: now(), timeline }, null, 1));
await b.close();
