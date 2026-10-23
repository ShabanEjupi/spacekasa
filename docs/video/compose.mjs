// Turns raw.webm + phone.webm + timeline.json + a<i>.mp3 into the ffmpeg job: cuts the waits for the model,
// plays the customer's phone (sped up) beside the till, places each narration clip on the new timeline,
// and writes matching subtitles in short chunks.
//   node compose.mjs <dir> [en|sq]  →  <dir>/subs.srt + <dir>/ffmpeg.args (one argument per line)
import fs from 'node:fs';

const [dir, lang = 'en'] = process.argv.slice(2);
const { total, phone, timeline } = JSON.parse(fs.readFileSync(`${dir}/timeline.json`));
const script = JSON.parse(fs.readFileSync(`${dir}/script.json`));
const say = i => (lang === 'sq' ? script[i].sq : script[i].say);

// Cut what happens after the narration ended and before the answer appeared (minus a little context).
const cuts = [];
for (const s of timeline) {
  const a = Math.max(s.start + s.dur + 0.2, s.acted + 1.2), b = s.done - 0.6;
  if (b - a > 0.8) cuts.push([a, b]);
}
let pieces = [];
let t = 0;
for (const [a, b] of cuts) { pieces.push({ a: t, b: a }); t = b; }
pieces.push({ a: t, b: total });
// The phone part becomes its own piece, sped up to about ten seconds.
if (phone) {
  const speed = Math.max(1, (phone.end - phone.start) / 10);
  pieces = pieces.flatMap(p => {
    const cutsAt = [phone.start, phone.end].filter(x => x > p.a && x < p.b);
    const bounds = [p.a, ...cutsAt, p.b];
    return bounds.slice(1).map((b, k) => ({ a: bounds[k], b }));
  }).map(p => (p.a >= phone.start - 1e-6 && p.b <= phone.end + 1e-6 ? { ...p, speed, phone: true } : { ...p, speed: 1 }));
} else pieces = pieces.map(p => ({ ...p, speed: 1 }));
const newTime = x => {
  let n = 0;
  for (const { a, b, speed } of pieces) { if (x >= b) n += (b - a) / speed; else { if (x > a) n += (x - a) / speed; break; } }
  return n;
};

const srtTime = s => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
// A caption never covers half the screen: split at sentence/clause ends into chunks of ≤ 84 characters,
// each shown for its share of the narration, and wrap a chunk over 48 characters onto two lines.
const chunks = text => {
  const parts = text.match(/[^.:;,!?]+[.:;,!?]*\s*/g).map(s => s.trim());
  const out = [];
  for (const p of parts) {
    if (out.length && (out.at(-1) + ' ' + p).length <= 84 && !/[.!?]$/.test(out.at(-1))) out[out.length - 1] += ' ' + p;
    else out.push(p);
  }
  return out;
};
const wrap = s => {
  if (s.length <= 48) return s;
  const mid = s.lastIndexOf(' ', Math.ceil(s.length / 2) + 4);
  return `${s.slice(0, mid)}\n${s.slice(mid + 1)}`;
};
const subs = [];
for (const s of timeline) {
  const cs = chunks(say(s.i)), len = cs.reduce((n, c) => n + c.length, 0);
  let at = newTime(s.start);
  for (const c of cs) {
    const d = s.dur * c.length / len;
    subs.push(`${subs.length + 1}\n${srtTime(at)} --> ${srtTime(at + d - 0.05)}\n${wrap(c)}\n`);
    at += d;
  }
}
fs.writeFileSync(`${dir}/subs.srt`, subs.join('\n'));

const v = pieces.map((p, k) => {
  const main = `[0:v]trim=start=${p.a.toFixed(3)}:end=${p.b.toFixed(3)},setpts=(PTS-STARTPTS)/${p.speed.toFixed(3)},scale=1920:1080:flags=lanczos`;
  if (!p.phone) return `${main}[v${k}]`;
  return `${main}[m${k}];[1:v]trim=start=${(p.a - phone.start).toFixed(3)}:end=${(p.b - phone.start).toFixed(3)},`
    + `setpts=(PTS-STARTPTS)/${p.speed.toFixed(3)},scale=-2:880:flags=lanczos,pad=iw+28:ih+28:14:14:color=0x101413[p${k}];`
    + `[m${k}][p${k}]overlay=W-w-80:(H-h)/2:eof_action=repeat[v${k}]`;
}).join(';');
const inputs = phone ? 2 : 1;
const audio = timeline.map((s, k) => `[${k + inputs}:a]adelay=${Math.round(newTime(s.start) * 1000)}:all=1[a${k}]`).join(';');
const filter = `${v};${pieces.map((_, k) => `[v${k}]`).join('')}concat=n=${pieces.length}:v=1:a=0,fps=30,`
  + `subtitles=subs.srt:force_style='FontName=DejaVu Sans,FontSize=11,PrimaryColour=&H00FFFFFF,BackColour=&H99000000,BorderStyle=4,Outline=0,MarginV=22'[v];`
  + `${audio};${timeline.map((_, k) => `[a${k}]`).join('')}amix=inputs=${timeline.length}:normalize=0[a]`;
const args = ['-y', '-i', 'raw.webm', ...(phone ? ['-i', 'phone.webm'] : []), ...timeline.flatMap((_, k) => ['-i', `a${k}.mp3`]),
  '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k',
  '-movflags', '+faststart', `spacekasa-demo-${lang}.mp4`];
fs.writeFileSync(`${dir}/ffmpeg.args`, args.join('\n'));
console.log(`raw ${total.toFixed(1)} s → final ${newTime(total).toFixed(1)} s, ${cuts.length} waits cut, ${pieces.length} pieces`);
