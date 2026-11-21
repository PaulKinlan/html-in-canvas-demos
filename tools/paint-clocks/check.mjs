#!/usr/bin/env node
// Drives /paint-clocks/ with real input at phone width and prints what each demo reported.
//
//   npm run build
//   node tools/paint-clocks/check.mjs [base URL] [folder for screenshots]
//
// With no base URL it serves public/ itself, with range requests, which the video needs for a seek
// (python3 -m http.server has none). Each step reads the line under a demo, which the paint handler
// writes. It prints one line per step and exits 1 if a step gave an unexpected result.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { stat, open } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const SHOTS = process.argv[3] || null;
let BASE = process.argv[2], server = null;
if (!BASE || BASE === '-') {
  const ROOT = fileURLToPath(new URL('../../public', import.meta.url));
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.svg': 'image/svg+xml' };
  server = createServer(async (req, res) => {
    try {
      let file = join(ROOT, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      let st = await stat(file);
      if (st.isDirectory()) { file = join(file, 'index.html'); st = await stat(file); }
      const head = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes' };
      const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      let start = 0, end = st.size - 1, code = 200;
      if (m) { if (m[1]) start = +m[1]; if (m[2]) end = Math.min(end, +m[2]); code = 206; head['content-range'] = `bytes ${start}-${end}/${st.size}`; }
      head['content-length'] = end - start + 1;
      res.writeHead(code, head);
      (await open(file)).createReadStream({ start, end }).pipe(res);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise((r) => server.listen(0, r));
  BASE = `http://localhost:${server.address().port}`;
}
let failed = 0;
const report = (ok, what, got, want) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : ` (wanted ${want})`}`); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
await p.goto(BASE + '/paint-clocks/?autochecks=0');
await p.waitForTimeout(1200);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);
const between = (what, text, re, lo, hi) => { const n = num(text, re); report(n >= lo && n <= hi, what, n, `${lo} to ${hi}`); };
const still = async (what, id) => { const a = await txt(id); await p.waitForTimeout(800); report(a === await txt(id), what, 'line unchanged for 0.8 s', 'no change'); };

// Loading.
await show('loading');
report((await txt('loadOut')).startsWith('Loaded'), 'starts loaded', await txt('loadOut'), 'Loaded');
await still('no paint events while loaded', 'loadOut');
await p.click('#loadStart'); await p.waitForTimeout(1500);
between('paint events from the bar in the last second, loading', await txt('loadOut'), /second: (\d+)/, 20, 70);
await shot('loading');
await p.click('#loadFinish'); await p.waitForTimeout(600);
report((await txt('loadOut')).startsWith('Loaded'), 'after Finish', await txt('loadOut'), 'Loaded');
await still('no paint events after Finish', 'loadOut');

// Caret.
await show('caret');
await p.tap('#caretField'); await p.waitForTimeout(2700);
between('paint events from the field in the last second, focused', await txt('caretOut'), /second: (\d+)/, 1, 3);
between('ms since the field\'s last paint event', await txt('caretOut'), /event: (\d+) ms/, 400, 700);
await p.keyboard.type('Ada', { delay: 90 }); await p.waitForTimeout(200);
between('paint events from the field in the last second, after typing three letters', await txt('caretOut'), /second: (\d+)/, 4, 9);
await shot('caret');
await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(700);
report((await txt('caretOut')).startsWith('Not focused'), 'after blur', await txt('caretOut'), 'Not focused');
await still('no paint events after blur', 'caretOut');

// Film.
await show('film');
await p.click('#filmPlay'); await p.waitForTimeout(2500);
between('paint events from the video in the last second, playing', await txt('filmOut'), /second: (\d+)/, 20, 40);
await shot('film');
await p.click('#filmPlay'); await p.waitForTimeout(500);
report((await txt('filmOut')).startsWith('Paused'), 'after Pause', await txt('filmOut'), 'Paused');
await still('no paint events while paused', 'filmOut');
await p.evaluate(() => { const s = document.getElementById('filmSeek'); s.value = 70; s.dispatchEvent(new Event('input')); }); await p.waitForTimeout(900);
between('seconds shown after a seek to 70% while paused', await txt('filmOut'), /Paused at ([\d.]+)/, 6.8, 7.2);

// Image.
await show('image'); await p.waitForTimeout(1300);
between('paint events from the 80 ms image in the last second', await txt('imageOut'), /second: (\d+)/, 10, 15);
await shot('image');
await p.click('[data-clock*="240"]'); await p.waitForTimeout(2600);
between('paint events from the 240 ms image in the last second', await txt('imageOut'), /second: (\d+)/, 3, 6);
await p.click('#imageRemove'); await p.waitForTimeout(600);
report((await txt('imageOut')).startsWith('Image removed'), 'after Remove', await txt('imageOut'), 'Image removed');
await still('no paint events after the image is removed', 'imageOut');
await p.click('[data-clock*="80"]'); await p.waitForTimeout(1500);
between('paint events from the image after it is put back', await txt('imageOut'), /second: (\d+)/, 10, 15);
await p.click('#imageHide'); await p.waitForTimeout(1300);
console.log(`     with opacity: 0 on the running image: ${await txt('imageOut')}`);

// A lost context: every demo shows plain HTML.
await p.evaluate(() => document.getElementById('imageCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 4, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 4);
await p.evaluate(() => window.scrollTo(0, 0)); await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
