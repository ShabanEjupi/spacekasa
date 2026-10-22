// Turns raw.webm + timeline.json + a<i>.mp3 into the ffmpeg job: cuts the waits for the model,
// places each narration clip on the new timeline, and writes matching subtitles.
//   node compose.mjs <dir>  →  <dir>/subs.srt + <dir>/ffmpeg.args (one argument per line)
import fs from 'node:fs';

const dir = process.argv[2];
const { total, timeline } = JSON.parse(fs.readFileSync(`${dir}/timeline.json`));

// Cut what happens after the narration ended and before the answer appeared (minus a little context).
const cuts = [];
for (const s of timeline) {
  const a = Math.max(s.start + s.dur + 0.2, s.acted + 1.2), b = s.done - 0.6;
  if (b - a > 0.8) cuts.push([a, b]);
}
const keep = [];
let t = 0;
for (const [a, b] of cuts) { keep.push([t, a]); t = b; }
keep.push([t, total]);
const newTime = x => {
  let n = 0;
  for (const [a, b] of keep) { if (x >= b) n += b - a; else { if (x > a) n += x - a; break; } }
  return n;
};

const srtTime = s => {
  const ms = Math.round(s * 1000), h = Math.floor(ms / 3.6e6), m = Math.floor(ms / 6e4) % 60, sec = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
// Long lines are split in two so a caption never covers half the screen.
const wrap = text => {
  if (text.length < 70) return text;
  const mid = text.lastIndexOf(' ', Math.ceil(text.length / 2) + 6);
  return `${text.slice(0, mid)}\n${text.slice(mid + 1)}`;
};
fs.writeFileSync(`${dir}/subs.srt`, timeline.map((s, k) =>
  `${k + 1}\n${srtTime(newTime(s.start))} --> ${srtTime(newTime(s.start) + s.dur)}\n${wrap(s.say)}\n`).join('\n'));

const select = keep.map(([a, b]) => `between(t,${a.toFixed(3)},${b.toFixed(3)})`).join('+');
const audio = timeline.map((s, k) => `[${k + 1}:a]adelay=${Math.round(newTime(s.start) * 1000)}:all=1[a${k}]`).join(';');
const filter = `[0:v]fps=25,select='${select}',setpts=N/FRAME_RATE/TB,`
  + `subtitles=subs.srt:force_style='FontName=DejaVu Sans,FontSize=10,PrimaryColour=&H00FFFFFF,BackColour=&H80000000,BorderStyle=4,Outline=0,MarginV=34'[v];`
  + `${audio};${timeline.map((_, k) => `[a${k}]`).join('')}amix=inputs=${timeline.length}:normalize=0[a]`;
const args = ['-y', '-i', 'raw.webm', ...timeline.flatMap((_, k) => ['-i', `a${k}.mp3`]),
  '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '22', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k',
  '-movflags', '+faststart', 'spacekasa-demo.mp4'];
fs.writeFileSync(`${dir}/ffmpeg.args`, args.join('\n'));
console.log(`raw ${total.toFixed(1)} s → final ${newTime(total).toFixed(1)} s, ${cuts.length} waits cut`);
