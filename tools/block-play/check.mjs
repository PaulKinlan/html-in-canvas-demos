#!/usr/bin/env node
// Drives the five demos of /block-play/ by touch at phone width and prints what each reported.
//
//   npm run build
//   node tools/block-play/check.mjs [base URL] [folder for screenshots]
//
// With no base URL it serves public/ itself. Each step reads the line under a demo, which the paint handler
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
await p.goto(BASE + '/block-play/?autochecks=0');
await p.waitForTimeout(1200);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);
const between = (what, text, re, lo, hi) => { const n = num(text, re); report(n >= lo && n <= hi, what, n, `${lo} to ${hi}`); };
const still = async (what, id) => { const a = await txt(id); await p.waitForTimeout(800); report(a === await txt(id), what, 'line unchanged for 0.8 s', 'no change'); };

const expect = (what, got, want) => report(String(got).includes(want), what, got, want);
// Tap the middle of the first client rectangle of an element: the place where it was last drawn.
const tapEl = async (sel, wait = 800) => { const at = await p.evaluate((s) => { const r = document.querySelector(s).getClientRects()[0]; return [r.x + r.width / 2, r.y + r.height / 2]; }, sel); await p.touchscreen.tap(...at); await p.waitForTimeout(wait); };

const hrefAt = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getClientRects()[0]; const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return e ? `${e.localName}${e.id ? '#' + e.id : ''}` : 'none'; }, sel);

await show('folders');
expect('order at the start', await txt('foldersOut'), 'Order from the front: Crew, Stores, Log.');
await shot('folders');
await tapEl('.folder:nth-of-type(3) legend button', 200); await shot('folders-moving'); await p.waitForTimeout(600);
expect('after a tap on the Log tab', await txt('foldersOut'), 'Order from the front: Log, Crew, Stores.');
await still('no frames once the folder is in front', 'foldersOut');
await shot('folders-log');
await tapEl('.folder:nth-of-type(3) textarea', 300);
expect('focused element after a tap on the text area of the front folder', await p.evaluate(() => document.activeElement?.localName), 'textarea');
await p.evaluate(() => document.activeElement.blur());
await tapEl('.folder:nth-of-type(2) legend button', 800);
expect('after a tap on the Stores tab', await txt('foldersOut'), 'Order from the front: Stores, Log, Crew.');

await show('lever');
expect('at the start', await txt('leverOut'), 'details.open is false. Lever at 0%');
await shot('lever-closed');
// Drag the knob from its place on the left to the right.
{ const k = await p.evaluate(() => { const c = document.getElementById('leverCanvas').getBoundingClientRect(); return { cx: c.left + c.width / 2, by: c.bottom - 22 }; });
  const from = [k.cx - Math.sin(0.75) * 84, k.by - Math.cos(0.75) * 84];
  const cdp = await ctx.newCDPSession(p), y0 = await p.evaluate(() => Math.round(scrollY));
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await touch('touchStart', ...from);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', from[0] + i * 9, from[1] - i * 3); await p.waitForTimeout(40); }
  await p.waitForTimeout(150);
  const mid = await txt('leverOut');
  between('lever while the knob is held part of the way', mid, /Lever at (\d+)%/, 25, 75);
  expect('details while the knob is held', mid, 'details.open is true');
  await shot('lever-half');
  for (let i = 7; i <= 14; i++) { await touch('touchMove', from[0] + i * 9, from[1] - 18); await p.waitForTimeout(40); }
  await touch('touchEnd'); await p.waitForTimeout(700);
  expect('after the knob is let go on the right', await txt('leverOut'), 'details.open is true. Lever at 100%');
  { const y1 = await p.evaluate(() => Math.round(scrollY)); report(y1 === y0, 'page scroll during the drag', `${y1 - y0} px`, '0 px'); }
}
await shot('lever-open');
expect('element at the link in the unrolled content', await hrefAt('#leverDetails a'), 'a');
await tapEl('#leverDetails summary', 900);
expect('after a tap on the summary', await txt('leverOut'), 'details.open is false. Lever at 0%');
await p.focus('#leverDetails summary'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
expect('after Enter on the summary', await txt('leverOut'), 'details.open is true. Lever at 100%');
await still('no frames at rest', 'leverOut');

await show('gallery');
expect('at the start', await txt('galleryOut'), '4 prints. Tap one.');
await shot('gallery');
await tapEl('.print:nth-of-type(4) img', 700);
expect('after a tap on the last print', await txt('galleryOut'), 'Picked: Market day. Its img has alt text of 81 characters');
await shot('gallery-picked');
expect('element at the middle of the picked image', await hrefAt('.print:nth-of-type(4) img'), 'img');
await tapEl('.print:nth-of-type(4) img', 700);
expect('after a second tap on it', await txt('galleryOut'), '4 prints. Tap one.');

await show('stamps');
await p.waitForTimeout(900);
expect('at the start', await txt('stampsOut'), '9 clones of one template, layout "ring". Taps counted on the clones: 0.');
await shot('stamps-ring');
await tapEl('.ticket:nth-of-type(3)', 300); await tapEl('.ticket:nth-of-type(3)', 300); await tapEl('.ticket:nth-of-type(7)', 300);
expect('after three taps on two tickets', await txt('stampsOut'), 'Taps counted on the clones: 3.');
expect('count on the third ticket', await p.evaluate(() => document.querySelector('.ticket:nth-of-type(3) i').textContent), '2');
for (const name of ['fan', 'grid', 'pile']) {
  await p.tap(`#stampsLayouts [data-layout="${name}"]`); await p.waitForTimeout(350); if (name === 'fan') await shot('stamps-moving'); await p.waitForTimeout(900);
  expect(`layout ${name}`, await txt('stampsOut'), `layout "${name}"`);
  await shot(`stamps-${name}`);
}
await p.evaluate(() => { const r = document.getElementById('stampsCount'); r.value = 18; r.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(1400);
expect('with the slider at 18', await txt('stampsOut'), '18 clones');
report(await p.evaluate(() => document.querySelectorAll('#stampsCanvas > .ticket').length) === 18, 'ticket elements in the canvas', await p.evaluate(() => document.querySelectorAll('#stampsCanvas > .ticket').length), 18);
await still('no frames at rest', 'stampsOut');

await show('mines');
expect('at the start', await txt('minesOut'), 'Open: 0 of 55 safe cells');
await tapEl('#minesTable tr:nth-child(4) td:nth-child(4) button', 120);
const early = num(await txt('minesOut'), /Open: (\d+)/);
await shot('mines-wave');
await p.waitForTimeout(1400);
const late = num(await txt('minesOut'), /Open: (\d+)/);
report(late >= 9 && early < late, 'cells open 0.12 s and 1.5 s after the first tap', `${early} then ${late}`, 'at least 9 at the end, fewer at first');
await shot('mines');
await still('no frames once the wave has passed', 'minesOut');
await p.tap('#minesFlag');
{ const sel = await p.evaluate(() => { const b = [...document.querySelectorAll('#minesTable button')].find((x) => !x.disabled); b.id = 'toFlag'; return '#toFlag'; }); await tapEl(sel, 400); }
expect('after a tap in flag mode', await txt('minesOut'), 'Flags: 1 of 9');
await p.tap('#minesNew'); await p.waitForTimeout(400);
expect('after New game', await txt('minesOut'), 'Open: 0 of 55 safe cells. Flags: 0');

// A lost context: every element is shown as plain HTML.
await p.evaluate(() => document.getElementById('minesCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 5, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 5);
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
