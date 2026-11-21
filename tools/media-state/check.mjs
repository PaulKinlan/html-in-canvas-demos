#!/usr/bin/env node
// Drives /media-state/ by touch at phone width and prints what each demo reported. It also opens the
// receiver page in a second tab and waits for the canvas stream to arrive there.
//
//   npm run build
//   node tools/media-state/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/media-state/?autochecks=0');
await p.waitForTimeout(1200);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);
const between = (what, text, re, lo, hi) => { const n = num(text, re); report(n >= lo && n <= hi, what, n, `${lo} to ${hi}`); };
const still = async (what, id) => { const a = await txt(id); await p.waitForTimeout(800); report(a === await txt(id), what, 'line unchanged for 0.8 s', 'no change'); };

const expect = (what, got, want) => report(String(got).includes(want), what, got, want);
// A point inside a part of the bar, found by hit testing the canvas in a grid: where does a tap reach it?
const where = (part) => p.evaluate((name) => {
  const bar = document.getElementById('barControls'), el = bar.parts[name], c = document.getElementById('barCanvas').getBoundingClientRect();
  const hits = [];
  for (let y = c.top + 4; y < c.bottom; y += 5) for (let x = c.left + 4; x < c.right; x += 5) if (bar.shadowRoot.elementFromPoint(x, y) === el) hits.push([x, y]);
  if (!hits.length) return null;
  const xs = hits.map((h) => h[0]), ys = hits.map((h) => h[1]);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}, part);
const tapPart = async (part) => { const at = await where(part); if (!at) { report(false, `hit region of the ${part} part`, 'not found', 'a place in the canvas'); return null; } await p.touchscreen.tap(at.x, at.y); await p.waitForTimeout(800); return at; };

// The bar as one picture.
await show('bar');
expect('at the start', await txt('barOut'), ':state(playing) false');
await tapPart('play');
expect('after a tap on the play part', await txt('barOut'), ':state(playing) true');
between('--fx-amount while playing', await txt('barOut'), /canvas: (\d\.\d\d)/, 1, 1);
await shot('bar-playing');
await tapPart('mute');
expect('after a tap on the sound part', await txt('barOut'), ':state(muted) false');
await tapPart('mute');

// The bar as four pictures.
await p.tap('#barLift'); await p.waitForTimeout(700);
expect('after ticking the box', await txt('barOut'), 'four pictures');
const line = await where('timeline');
report(line && line.w > 300, 'width of the hit region of the timeline, stretched', line && Math.round(line.w), 'more than 300 px');
await shot('bar-parts');
await tapPart('play');
expect('after a tap on the large play part', await txt('barOut'), ':state(playing) false');
const big = await where('play');
report(big && big.h > 55, 'height of the hit region of the play part, drawn at 2.2 times its size while paused', big && Math.round(big.h), 'more than 55 px');
if (line) { await p.touchscreen.tap(line.x + line.w * 0.25, line.y); await p.waitForTimeout(700); }
between('seconds of film after a tap at three quarters of the stretched timeline', String(await p.evaluate(() => document.getElementById('barVideo').currentTime)), /([\d.]+)/, 6, 9);
await shot('bar-parts-paused');

// States.
await show('states');
await p.tap('#statesLamp'); await p.waitForTimeout(900);
expect('after a tap on Lamp', await txt('statesOut'), '--fx-amount 1.00');
await p.tap('#statesCard summary'); await p.waitForTimeout(800);
expect('after a tap on Opening hours', await txt('statesOut'), '--fx-progress 1.00');
await shot('states-lamp-open');
await p.tap('#statesCard input[type=email]'); await p.keyboard.type('not an address', { delay: 20 });
await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(250);
between('--fx-x 0.25 s after the field was left with a bad value', await txt('statesOut'), /--fx-x (\d\.\d\d)/, 0.05, 0.95);
await p.waitForTimeout(800);
expect('after the transition', await txt('statesOut'), ':user-invalid matches, --fx-x 1.00');
await shot('states-invalid');
await p.tap('#statesCard button[popovertarget]'); await p.waitForTimeout(700);
expect('after a tap on Help', await txt('statesOut'), ':popover-open matches, --fx-y 1.00');
await shot('states-popover');
await p.touchscreen.tap(20, 880); await p.waitForTimeout(700);
expect('after a tap outside the popover', await txt('statesOut'), '--fx-y 0.00');
await still('no frames once the numbers have settled', 'statesOut');

// The pseudo-element.
await show('pseudo');
console.log(`     ${await txt('pseudoOut')}`);
expect('the proposed call', await txt('pseudoOut'), 'threw TypeError');
{
  const at = await p.evaluate(() => { const a = document.querySelector('#pseudoQuote a'); for (const r of a.getClientRects()) return [r.x + r.width / 2, r.y + r.height / 2]; });
  expect('element at the link in the quote, drawn apart from its mark', await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href'), at), '/player-parts/');
}
await shot('pseudo');

// Casting: the three routes, then the receiver in a second tab.
await p.evaluate(() => window.scrollTo(0, document.getElementById('cast').getBoundingClientRect().top + scrollY - 60)); await p.waitForTimeout(900);
for (const id of ['castMake', 'castWatch', 'castAvailable', 'castPresent', 'castRemote']) { await p.tap('#' + id); await p.waitForTimeout(1200); }
for (const l of (await txt('castOut')).split('\n')) console.log(`     ${l}`);
const tab = await ctx.newPage();
await tab.goto(BASE + '/media-state/receiver.html');
await p.bringToFront();
await p.evaluate(() => document.getElementById('barVideo').play());
let got = '';
for (let i = 0; i < 40 && !got; i++) { await p.waitForTimeout(250); got = await tab.evaluate(() => { const v = document.getElementById('screen'); return v.videoWidth ? `${v.videoWidth} by ${v.videoHeight}` : ''; }); }
report(!!got, 'size of the video in the receiver tab', got || 'no frame in 10 s', 'a size');
console.log(`     receiver says: ${await tab.evaluate(() => document.getElementById('status').textContent)}`);
if (SHOTS) await tab.screenshot({ path: `${SHOTS}/receiver.png` });
expect('sender log', await txt('castOut'), 'Tab: connection connected');
await tab.close();

// A lost context: the three canvases show plain HTML and the controls still work.
await p.evaluate(() => document.getElementById('statesCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 3, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 3);
await show('bar'); await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
