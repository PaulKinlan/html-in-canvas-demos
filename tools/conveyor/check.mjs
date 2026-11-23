#!/usr/bin/env node
// Drives the conveyor belt list of /conveyor/ by touch at phone width and prints what it reported.
//
//   npm run build
//   node tools/conveyor/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/conveyor/?autochecks=0');
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

const cdp = await ctx.newCDPSession(p);
const st = () => p.evaluate(() => { const s = window.__belt.state; return { scroll: s.scroll, first: s.first, copies: s.copies, frames: s.frames, kids: document.getElementById('beltCanvas').children.length }; });
const mid = (sel) => p.evaluate((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
const tapSel = async (sel, wait = 500) => { await p.touchscreen.tap(...await mid(sel)); await p.waitForTimeout(wait); };
// A touch drag from (x, y0) to (x, y1). gap is the time between moves, so a small gap is a flick.
const drag = async (x, y0, y1, steps = 12, gap = 30, hold = 0) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps }] }); await p.waitForTimeout(gap); }
  if (hold) await p.waitForTimeout(hold);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
};

await show('conveyor');
await p.waitForTimeout(2200);
expect('at rest', await txt('beltOut'), 'Elements in the document: 10.');
between('rows on the belt', await txt('beltOut'), /Rows on the belt: (\d+)/, 6, 8);
await still('the belt stops drawing after its first run', 'beltOut');
await shot('belt-1');

// Taps on real elements of a row.
await tapSel('[data-row="4"] input');
expect('a tap on the checkbox of row 4', await txt('beltOut'), 'Ticked: 1.');
await tapSel('[data-row="5"] button');
expect('a tap on Open of row 5', await txt('beltOut'), 'Last opened: #5.');

// A slow drag that starts on a checkbox moves the belt and does not tick the box.
{
  const a = await st(), at = await mid('[data-row="6"] input');
  await drag(at[0], at[1], at[1] - 190, 12, 30, 250);
  await p.waitForTimeout(700);
  const b2 = await st();
  between('scroll after a drag of 190 px up', String(Math.round(b2.scroll - a.scroll)), /(-?\d+)/, 170, 200);
  expect('the box under the finger', await txt('beltOut'), 'Ticked: 1.');
  report(b2.kids === 10, 'children of the canvas after the drag', b2.kids, 10);
  console.log(`info the drag drew ${b2.frames - a.frames} frames and copied ${b2.copies - a.copies} element pictures`);
}
await shot('belt-2');

// A flick keeps the belt moving, and it stops by itself.
{
  const c = await p.evaluate(() => { const q = document.getElementById('beltCanvas').getBoundingClientRect(); return [q.x + 60, q.y + 360]; });
  const a = await st();
  await drag(c[0], c[1], c[1] - 220, 5, 16);
  const b1 = await st();
  await p.waitForTimeout(350);
  const b2 = await st();
  report(b2.scroll - b1.scroll > 40, 'movement in the 0.35 s after a flick', Math.round(b2.scroll - b1.scroll) + ' px', 'more than 40 px');
  await shot('belt-3');
  await p.waitForTimeout(3500);
  await still('the belt stops after the flick', 'beltOut');
  const b3 = await st();
  console.log(`info the flick carried the belt ${Math.round(b3.scroll - a.scroll)} px in all, ${b3.frames - a.frames} frames, ${b3.copies - a.copies} element pictures copied`);
}

// Row 1,000,000 and back.
await p.touchscreen.tap(...await mid('#beltGo')); await p.waitForTimeout(3500);
between('first row after Go to 1,000,000', await txt('beltOut'), /starting at #(\d+)/, 999997, 1000000);
report((await st()).kids === 10, 'children of the canvas at row 1,000,000', (await st()).kids, 10);
await shot('belt-4');
await tapSel('[data-row="1000002"] input');
expect('a tap on the checkbox of row 1,000,002', await txt('beltOut'), 'Ticked: 2.');
await p.fill('#beltTo', '4'); await p.touchscreen.tap(...await mid('#beltGo')); await p.waitForTimeout(3500);
report(await p.evaluate(() => document.querySelector('[data-row="4"] input').checked), 'row 4 is still ticked after its element showed other rows', 'checked', 'checked');
report(await p.evaluate(() => !document.querySelector('[data-row="5"] input').checked), 'row 5 is not ticked', 'not checked', 'not checked');

// The motor: a tap reaches a checkbox on a moving row.
await p.touchscreen.tap(...await mid('#beltMotor')); await p.waitForTimeout(900);
{
  const a = await st(); await p.waitForTimeout(500); const b2 = await st();
  between('belt speed with the motor on, px in 0.5 s', String(Math.round(b2.scroll - a.scroll)), /(\d+)/, 55, 110);
  const first = b2.first + 5;
  await p.touchscreen.tap(...await mid(`[data-row="${first}"] input`)); await p.waitForTimeout(300);
  expect(`a tap on the checkbox of moving row ${first}`, await txt('beltOut'), 'Ticked: 3.');
  await shot('belt-5');
}
// The page stays where it is while the belt runs. With the top of the canvas above the top of the screen,
// scroll anchoring took a row as its anchor and moved the page with it, until the canvas had overflow-anchor: none.
{
  const y = await p.evaluate(() => { const c = document.getElementById('beltCanvas'); const to = Math.round(c.getBoundingClientRect().top + scrollY + 60); window.scrollTo(0, to); return to; });
  await p.waitForTimeout(400);
  await p.evaluate(() => { window.__pageScrolls = []; addEventListener('scroll', () => window.__pageScrolls.push(Math.round(scrollY))); });
  await p.waitForTimeout(2500);
  const got = await p.evaluate(() => ({ n: window.__pageScrolls.length, min: Math.min(scrollY, ...window.__pageScrolls), max: Math.max(scrollY, ...window.__pageScrolls) }));
  report(got.n === 0, `page scroll events in 2.5 s with the motor on and the page at ${y}`, got.n ? `${got.n}, between ${got.min} and ${got.max}` : 0, 0);
  await show('conveyor');
}
await p.touchscreen.tap(...await mid('#beltMotor')); await p.waitForTimeout(900);
await still('the belt stops with the motor', 'beltOut');

// A row that is mostly round a roller takes no input, and the keyboard moves the belt.
{
  const got = await p.evaluate(() => { const q = document.getElementById('beltCanvas').getBoundingClientRect(); const e = document.elementFromPoint(q.x + q.width / 2, q.y + 26); return e.id || e.localName; });
  report(got === 'beltCanvas', 'the element 26 px down the canvas, on the top roller', got, 'beltCanvas');
  const a = await st();
  await p.evaluate(() => document.querySelector(`[data-row="${window.__belt.state.first + 4}"] button`).focus({ preventScroll: true }));
  await p.keyboard.press('ArrowDown'); await p.waitForTimeout(1500);
  const b2 = await st();
  between('scroll after ArrowDown', String(Math.round(b2.scroll - a.scroll)), /(-?\d+)/, 38, 115);
  report(Math.abs(((b2.scroll + 4) % 76 + 76) % 76) < 1, 'the belt stops with a row at the top of the flat face', (((b2.scroll + 4) % 76 + 76) % 76).toFixed(1) + ' px off', 'under 1 px');
}

// A lost context: the ten rows are shown as plain HTML.
await p.evaluate(() => document.getElementById('beltCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls [data-row]').length) === 10, 'rows in the plain box after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls [data-row]').length), 10);
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
