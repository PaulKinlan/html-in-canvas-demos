#!/usr/bin/env node
// Drives the five demos of /table-data/ by touch at phone width and prints what each reported.
//
//   npm run build
//   node tools/table-data/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/table-data/?autochecks=0');
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

await show('stamp');
expect('before the stamp', await txt('stampOut'), 'where the browser puts it');
await shot('stamp-before');
await p.tap('#stampGo'); await p.waitForTimeout(120); await shot('stamp-falling'); await p.waitForTimeout(600);
expect('after Stamp it', await txt('stampOut'), 'drawn turned by 15 degrees at 1.9 times');
await still('no frames once the stamp is down', 'stampOut');
await shot('stamp');
expect('element at the link in the last row, under the stamp', await p.evaluate(() => { const r = document.querySelector('#stampTable a').getClientRects()[0]; return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('a')?.getAttribute('href'); }), '/elements/');
await p.tap('#stampOff'); await p.waitForTimeout(400);
expect('after Put the caption back', await txt('stampOut'), 'where the browser puts it');

await show('totals');
expect('at rest', await txt('totalsOut'), '£24.25. At rest');
await tapEl('#totalsTable tbody tr:nth-child(2) button[data-step="1"]', 250);
{ const mid = await txt('totalsOut'); const v = num(mid, /cell: £([\d.]+\d)/); report(mid.includes('Counting from £24.25 to £37.00') && v > 24.25 && v < 37, 'total 0.25 s after one more cheese', mid, 'a value between 24.25 and 37.00, counting'); }
await shot('totals-counting');
await p.waitForTimeout(800);
expect('total after the count', await txt('totalsOut'), '£37.00. At rest');
expect('text of the tfoot cell', await p.evaluate(() => document.getElementById('totalsSum').textContent), '£37.00');
await tapEl('#totalsTable tbody tr:nth-child(3) input', 300);
await p.keyboard.press('Control+A'); await p.keyboard.type('10'); await p.waitForTimeout(1000);
expect('total after typing 10 apples', await txt('totalsOut'), '£40.40. At rest');
await shot('totals');
await still('no frames at rest', 'totalsOut');

await show('machine');
expect('before', await txt('machineOut'), 'Hold the button');
await p.tap('#machineKeep'); await p.waitForTimeout(700);
expect('with Keep them shown', await txt('machineOut'), 'Showing 4 attributes: 2026-11-28T07:40, PT2H15M, 38.50, 240');
await shot('machine');
await p.tap('#machineKeep'); await p.waitForTimeout(600);
expect('with the box cleared', await txt('machineOut'), 'Hold the button');
await p.keyboard.down('m'); await p.waitForTimeout(500);
expect('with the M key held', await txt('machineOut'), 'Showing 4 attributes');
await p.keyboard.up('m'); await p.waitForTimeout(500);
expect('with the M key released', await txt('machineOut'), 'Hold the button');

await show('envelope');
expect('the address at the start', await txt('envelopeOut'), 'Ada Marsh / 4 Lighthouse Row / Portree IV51". Sent: 0');
await tapEl('#envelopeForm input[name="town"]', 300);
expect('focused element after a tap on the drawn Town field', await p.evaluate(() => document.activeElement?.name), 'town');
await p.keyboard.press('Control+A'); await p.keyboard.type('Skye'); await p.waitForTimeout(500);
expect('the address after typing', await txt('envelopeOut'), '4 Lighthouse Row / Skye". Sent: 0');
await shot('envelope');
await tapEl('#envelopeForm button', 450); await shot('envelope-sealed');
expect('0.45 s after the button', await txt('envelopeOut'), 'Sent: 1. Sending');
await p.waitForTimeout(500); await shot('envelope-leaving');
await p.waitForTimeout(1400);
expect('2.3 s after the button', await txt('envelopeOut'), 'Sent: 1.');
await still('no frames once the new envelope is in', 'envelopeOut');

await show('ticker');
await p.waitForTimeout(1100);
between('paint events from the marquee in a second', await txt('tickerOut'), /last second: (\d+)/, 20, 70);
expect('frame loop', await txt('tickerOut'), 'requestAnimationFrame calls and timers: 0');
await shot('ticker');
// Tap a link where it is now: the first one whose rectangle is well inside the marquee.
{ let at = null;
  for (let i = 0; i < 80 && !at; i++) {
    at = await p.evaluate(() => { const m = document.getElementById('tickerTape').getBoundingClientRect(); for (const a of document.querySelectorAll('#tickerTape a')) { const r = a.getBoundingClientRect(); if (r.left > m.left + 60 && r.left + 110 < m.right) return [r.left + 30, r.top + r.height / 2, a.textContent.trim().split(' ')[0]]; } return null; });
    if (!at) await p.waitForTimeout(100);
  }
  if (!at) report(false, 'a link inside the marquee', 'none in 8 s', 'one'); else { await p.touchscreen.tap(at[0], at[1]); await shot('ticker-tap'); await p.waitForTimeout(400); expect('link tapped while it moved', await txt('tickerOut'), `Last link tapped: ${at[2]}`); } }
await p.tap('#tickerStop'); await p.waitForTimeout(500);
expect('after Stop the marquee', await txt('tickerOut'), 'Stopped with marquee.stop()');
await still('no paint events while stopped', 'tickerOut');
await p.tap('#tickerStop'); await p.waitForTimeout(1300);
between('paint events a second after Start', await txt('tickerOut'), /last second: (\d+)/, 20, 70);

// A lost context: every element is shown as plain HTML.
await p.evaluate(() => document.getElementById('stampCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 5, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 5);
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
