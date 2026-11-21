#!/usr/bin/env node
// Drives /animated-images/ at phone width and prints the paint rate of each animated image format,
// with the canvas on screen and scrolled off screen.
//
//   npm run build
//   node tools/animated-images/check.mjs [base URL] [folder for screenshots]
//
// With no base URL it serves public/ itself. Each step reads the line under the demo, which the paint
// handler writes. It prints one line per step and exits 1 if a step gave an unexpected result.
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
  const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webm': 'video/webm', '.gif': 'image/gif', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.avif': 'image/avif' };
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
await p.goto(BASE + '/animated-images/?autochecks=0');
await p.waitForTimeout(1200);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);
const between = (what, text, re, lo, hi) => { const n = num(text, re); report(n >= lo && n <= hi, what, n, `${lo} to ${hi}`); };
const still = async (what, id) => { const a = await txt(id); await p.waitForTimeout(800); report(a === await txt(id), what, 'line unchanged for 0.8 s', 'no change'); };

const NAMES = ['GIF', 'APNG', 'WebP', 'AVIF', 'SVG, SMIL steps', 'SVG, CSS steps', 'Inline SVG', 'CSS background', 'GIF, plays once', 'SVG, smooth SMIL'];
const rates = async () => { const t = await txt('tilesOut'); return Object.fromEntries(NAMES.map((n) => [n, num(t, new RegExp(`${n}: (\\d+)`))])); };
const scroll = async (dy, ms = 2300) => { await p.evaluate((d) => window.scrollTo(0, document.getElementById('tilesCanvas').getBoundingClientRect().top + scrollY + d), dy); await p.waitForTimeout(ms); };
const range = (what, n, lo, hi) => report(n >= lo && n <= hi, what, n, `${lo} to ${hi}`);
const FRAMED = ['GIF', 'APNG', 'WebP', 'AVIF', 'SVG, SMIL steps', 'SVG, CSS steps', 'CSS background'];

// The whole canvas on screen.
await scroll(-80);
let r = await rates();
for (const n of FRAMED) range(`${n}, paint events in the last second`, r[n], 10, 15);
range('Inline SVG, paint events in the last second', r['Inline SVG'], 7, 18);
range('SVG, smooth SMIL, paint events in the last second', r['SVG, smooth SMIL'], 20, 130);
range('GIF, plays once, more than a second after its last frame', r['GIF, plays once'], 0, 0);
await shot('tiles');

// The one-shot GIF again.
await p.click('#tilesOnce'); await p.waitForTimeout(600);
range('GIF, plays once, 0.6 s after Play again', (await rates())['GIF, plays once'], 3, 15);
await p.waitForTimeout(2000);
range('GIF, plays once, 2.6 s after Play again', (await rates())['GIF, plays once'], 0, 0);

// The canvas scrolled off screen. These are printed, not judged, apart from the count.
await scroll(2000);
r = await rates();
console.log(`     canvas above the screen for 2.3 s: ${NAMES.map((n) => `${n}: ${r[n]}`).join('; ')}`);
console.log(`     paint events while the canvas was off screen: ${num(await txt('tilesOut'), /off screen: (\d+)/)}`);
await scroll(-80);
r = await rates();
for (const n of ['GIF', 'SVG, SMIL steps', 'SVG, CSS steps']) range(`${n}, back on screen`, r[n], 10, 15);

// Remove and restart.
await p.click('#tilesRemove'); await p.waitForTimeout(500);
await still('no paint events after the clocks are removed', 'tilesOut');
await shot('removed');
await p.click('#tilesRestart'); await p.waitForTimeout(1800);
r = await rates();
for (const n of ['GIF', 'AVIF', 'SVG, SMIL steps', 'CSS background']) range(`${n}, after Restart all`, r[n], 10, 15);

// A sign's link is a link at the place where the swinging sign is drawn.
{
  const at = await p.evaluate(() => { const c = document.getElementById('tilesCanvas').getBoundingClientRect(), w = c.width, tw = Math.min(w / 2, 230); return [c.x + (w - tw * 2) / 2 + tw / 2 - 30, c.y + 38 + 42 + 40]; });
  const href = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href') ?? document.elementFromPoint(x, y)?.className, at);
  console.log(`     element under the first sign's second line: ${href}`);
}

// A lost context: the elements are shown as plain HTML.
await p.evaluate(() => document.getElementById('tilesCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 1, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 1);
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
