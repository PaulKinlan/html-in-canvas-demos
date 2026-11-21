#!/usr/bin/env node
// Drives the six demos of /text-marks/ by touch at phone width and prints what each reported.
//
//   npm run build
//   node tools/text-marks/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/text-marks/?autochecks=0');
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

await show('settle');
await p.tap('#settleAgain'); await p.waitForTimeout(700);
between('subscripts in place 0.7 s after Drop them again', await txt('settleOut'), /In place: (\d+)/, 0, 6);
await shot('settle-falling');
await p.waitForTimeout(2800);
between('subscripts in place 3.5 s after', await txt('settleOut'), /In place: (\d+)/, 12, 12);
await still('no frames once they have landed', 'settleOut');
expect('element at the link in the formulas', await p.evaluate(() => { const r = document.querySelector('#settleSheet a').getClientRects()[0]; return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('a')?.getAttribute('href'); }), '/elements/');

await show('bidi');
expect('plain run', await txt('bidiOut'), 'span: 13 characters, drawn left to right');
expect('Hebrew run', await txt('bidiOut'), 'bdi dir=rtl: 9 characters, drawn right to left');
expect('bdo run', await txt('bidiOut'), 'bdo dir=rtl: 20 characters, drawn right to left');
await shot('bidi');

await show('gloss');
await tapEl('#glossSheet abbr:nth-of-type(2)');
expect('after a tap on CSS', await txt('glossOut'), 'Open: CSS');
expect('the title element', await p.evaluate(() => document.getElementById('glossText').textContent), 'Cascading Style Sheets');
await shot('gloss');
// API is below the cut, so it is drawn lower than its layout place. The tap goes to where it is drawn.
await tapEl('#glossSheet abbr:nth-of-type(4)');
expect('after a tap on API, which is in the piece that moved down', await txt('glossOut'), 'Open: API');
// Now API is above the cut. Its client rectangle is reported from the last draw of the sheet, which is
// the lower piece, 42 px further down, so the tap goes 42 px above the rectangle.
{ const at = await p.evaluate(() => { const r = document.querySelector('#glossSheet abbr:nth-of-type(4)').getClientRects()[0]; return [r.x + r.width / 2, r.y + r.height / 2 - 42]; }); await p.touchscreen.tap(...at); await p.waitForTimeout(800); }
expect('after a second tap on API', await txt('glossOut'), 'Tap an abbreviation');
await p.focus('#glossSheet abbr'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
expect('after Enter on the focused HTML', await txt('glossOut'), 'Open: HTML');

await show('quotes');
between('rectangles of the two q elements', await txt('quotesOut'), /from (\d+) rectangles/, 5, 12);
await shot('quotes');
await p.tap('#quotesOn'); await p.waitForTimeout(500);
expect('with the box cleared', await txt('quotesOut'), 'as the browser draws it');

await show('vars');
await tapEl('#varsSheet p var:nth-of-type(2)');
expect('after a tap on sum in the sentence', await txt('varsOut'), 'var "sum": 5 places');
await shot('vars');
await tapEl('#varsSheet pre var:nth-of-type(3)');
expect('after a tap on n in the code', await txt('varsOut'), 'var "n": 4 places');

await show('fold');
expect('flat', await txt('foldOut'), '6 strips from 5 br elements');
await shot('fold-flat');
await p.tap('#foldToggle'); await p.waitForTimeout(400); await shot('fold-half'); await p.waitForTimeout(900);
expect('after Fold', await txt('foldOut'), 'Fold: 100%');
await shot('fold');
await p.tap('#foldToggle'); await p.waitForTimeout(1200);
expect('after Unfold', await txt('foldOut'), 'Fold: 0%');

// A lost context: every sheet is shown as plain HTML.
await p.evaluate(() => document.getElementById('foldCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 6, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 6);
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
