#!/usr/bin/env node
// Drives the nine elements of /use-it/ by touch at phone width and prints what each reported.
//
//   npm run build
//   node tools/use-it/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/use-it/?autochecks=0');
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

// show() of the copied head looks for a canvas in the section. These sections hold elements, so:
const see = async (id) => { await p.evaluate((i) => { const c = document.getElementById(i); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 70); }, id); await p.waitForTimeout(1400); };
const mid = (sel) => p.evaluate((q) => { const r = document.querySelector(q).getClientRects()[0]; return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
const tap = async (sel, wait = 600) => { await p.touchscreen.tap(...await mid(sel)); await p.waitForTimeout(wait); };
const js = (f, a) => p.evaluate(f, a);
const popovers = () => js(() => document.querySelectorAll(':popover-open').length);

await see('frame');
expect('effect-frame', await txt('frameOut'), 'effect-frame is a EffectFrame');
expect('effect-frame canvas', await txt('frameOut'), 'with 1 canvas of its own');
await tap('#useFrame input'); await p.keyboard.type('!');
report(await js(() => document.querySelector('#useFrame input').value) === 'Kittiwake!', 'typing in the field inside the frame', await js(() => document.querySelector('#useFrame input').value), 'Kittiwake!');
await js(() => document.activeElement.blur());
await shot('frame');

await see('selection');
expect('selection-fx', await txt('selectionOut'), 'selection-fx is a SelectionFx');
{ const at = await mid('#useSelection p'); await p.mouse.dblclick(at[0], at[1]); await p.waitForTimeout(600); }
report((await js(() => getSelection().toString().trim())).length > 0, 'a double click selects a word inside selection-fx', await js(() => getSelection().toString().trim()), 'a word');
await shot('selection');
await js(() => getSelection().removeAllRanges());

await see('glyph');
expect('glyph-field', await txt('glyphOut'), 'glyph-field is a GlyphField');
report(await js(() => { const a = document.querySelector('#useGlyph a'), r = a.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === a; }), 'the link inside glyph-field is found by a hit test', 'the link', 'the link');
await tap('#glyph .live > button', 350);
await shot('glyph');
await p.waitForTimeout(2500);

await see('select');
expect('select picker', await txt('selectOut'), 'select[picker] is a HTMLSelectElement');
report(await js(() => document.getElementById('useSelect').value) === '06:45', 'the selected option after the library moved the options', await js(() => document.getElementById('useSelect').value), '06:45');
await tap('#useSelect', 900);
report(await js(() => document.getElementById('useSelect').matches(':open')), 'a tap opens the wheel', 'open', 'open');
await shot('select');
await p.keyboard.press('Escape'); await p.waitForTimeout(500);

await see('slot');
expect('canvas-slot', await txt('slotOut'), 'canvas-slot is a CanvasSlot');
await tap('#useSlot input');
report(await js(() => document.querySelector('#useSlot input').checked) === false, 'a tap on the checkbox of the turned card', await js(() => String(document.querySelector('#useSlot input').checked)), 'false');
await shot('slot');

await see('portal');
expect('dom-portal', await txt('portalOut'), 'dom-portal is a DomPortal');
{
  const r = await js(() => { const q = document.getElementById('usePortal').getBoundingClientRect(); return [q.x, q.y, q.width, q.height]; });
  // The input of the copy: the form is 240 px wide at 0.7 scale, and the field is to the right of its label.
  await p.touchscreen.tap(r[0] + 100, r[1] + r[3] / 2); await p.waitForTimeout(500);
  await p.keyboard.type('7');
  report(await js(() => document.querySelector('#usePortalHome input').value) === 'C147', 'typing in the copy changes the one input', await js(() => document.querySelector('#usePortalHome input').value), 'C147');
  await js(() => document.activeElement.blur());
}
await shot('portal');

await see('lens');
expect('dom-lens', await txt('lensOut'), 'dom-lens is a DomLens');
{ const at = await mid('#useLens'); await p.mouse.move(at[0] - 60, at[1]); await p.waitForTimeout(700); }
await shot('lens');

await see('datalist');
expect('datalist picker', await txt('datalistOut'), 'input[picker] is a HTMLInputElement');
report(await js(() => document.getElementById('useDatalist').list) === null, 'the input no longer has its list', 'input.list is null', 'input.list is null');
await tap('#useDatalist'); await p.keyboard.type('t'); await p.waitForTimeout(800);
report(await popovers() >= 1, 'typing a letter opens the popover with the suggestions', await popovers(), 'at least 1');
await shot('datalist');
await p.keyboard.press('Escape'); await js(() => document.activeElement.blur()); await p.waitForTimeout(500);

await see('clock');
expect('time picker', await txt('clockOut'), 'input[picker] is a HTMLInputElement');
await tap('#useClock', 900);
report(await popovers() >= 1, 'a tap on the time field opens the clock', await popovers(), 'at least 1');
await shot('clock');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
