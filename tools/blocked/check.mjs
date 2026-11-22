#!/usr/bin/env node
// Drives the six demos of /blocked/ by touch at phone width and prints what each reported.
//
//   npm run build
//   node tools/blocked/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/blocked/?autochecks=0');
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

const routeOf = (id) => p.evaluate((i) => { const d = document.getElementById(i); return `${d.dataset.state}: ${d.textContent}`; }, id);
const tapId = async (id, wait = 700) => { const at = await p.evaluate((i) => { const r = document.getElementById(i).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, id); await p.touchscreen.tap(...at); await p.waitForTimeout(wait); };
const cdp = await ctx.newCDPSession(p);
// A touch drag from (x, y0) to (x, y1) in steps, held at the end until release() is called.
const drag = async (x, y0, y1, steps = 14) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / steps }] }); await p.waitForTimeout(30); }
  return async () => { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(700); };
};

// 1. Picker in the scene.
await show('picker');
expect('picker at rest', await txt('pickerOut'), 'Sail: tan');
await tapEl('#pickerList option[value=blue]', 900);
expect('a tap on a sheared row of the list box', await txt('pickerOut'), 'Sail: blue, chosen through the list drawn on the panel');
expect('route 2', await routeOf('pickerR2'), 'works: 1 choice made by a tap on a sheared row');
await shot('picker-1');
await tapId('pickerMeasure', 1500);
expect('route 1 after the measurement', await routeOf('pickerR1'), 'blocked: The picker is open.');
expect('route 1, points', await routeOf('pickerR1'), ' 0 of them have the picker');
await shot('picker-2');
await tapEl('#pickerSelect option[value=green]', 900);
expect('a tap on a row of the open picker', await txt('pickerOut'), 'Sail: green, chosen through the picker in the top layer');
await still('picker stops drawing', 'pickerOut');

// 2. PDF.
await show('pdf');
expect('pdf at rest', await txt('pdfOut'), 'The PDF is not loaded yet');
await shot('pdf-1');
await tapId('pdfMeasure', 4200);
console.log('info ' + await routeOf('pdfR1'));
console.log('info ' + await routeOf('pdfR2'));
report(/^(works|blocked): /.test(await routeOf('pdfR1')) && /^(works|blocked): /.test(await routeOf('pdfR2')), 'both PDF routes gave an answer', 'yes', 'yes');
expect('pdf line', await txt('pdfOut'), 'The PDF is loaded into both pages');
await shot('pdf-2');

// 3. Image wall.
await show('wall');
await p.waitForTimeout(800);
expect('wall at rest', await txt('wallOut'), 'Pictures loaded: 9 of 9. Pictures the page expects the canvas to leave out: 3.');
await shot('wall-1');
await tapId('wallMeasure', 900);
expect('row 2 without CORS', await routeOf('wallR1'), 'blocked: 0 of 3 pictures are in the canvas (3 of 3 loaded)');
expect('row 3 with CORS', await routeOf('wallR2'), 'works: 3 of 3 pictures are in the canvas (3 of 3 loaded). This origin: 3 of 3.');
await tapId('wallFix', 1800);
expect('after loading row 2 with crossorigin', await txt('wallOut'), 'expects the canvas to leave out: 0.');
await tapId('wallMeasure', 900);
expect('row 2 with CORS', await routeOf('wallR1'), 'works: 3 of 3 pictures are in the canvas');
await shot('wall-2');
await still('wall stops drawing', 'wallOut');

// 4. Popover.
await show('popover');
await p.waitForTimeout(1500);
await tapEl('#popAck', 600);
expect('a tap on the button of the swinging card', await routeOf('popoverR2'), 'works: A tap reached the button of the swinging card 1 time.');
{ const r = await p.evaluate(() => { const q = document.getElementById('popoverCanvas').getBoundingClientRect(); return [q.x + 24, q.y + 200]; }); await p.touchscreen.tap(...r); await p.waitForTimeout(500); }
expect('a tap beside the card', await txt('popoverOut'), 'Pushes: 1.');
await shot('popover-1');
await tapId('popoverMeasure', 900);
expect('popover route 1', await routeOf('popoverR1'), 'blocked: drawElementImage() of the open popover');
console.log('info ' + await routeOf('popoverR1'));
console.log('info the open popover on the screen, relative to the canvas: ' + await p.evaluate(() => { const a = document.getElementById('popCard').getBoundingClientRect(), c = document.getElementById('popoverCanvas').getBoundingClientRect(); return [a.x - c.x, a.y - c.y, a.width, a.height].map(Math.round).join(', '); }));
expect('popover line', await txt('popoverOut'), ':popover-open matches');
await shot('popover-2');
await p.keyboard.press('Escape');
await p.waitForTimeout(700);
expect('after Escape', await txt('popoverOut'), 'has no popover attribute and is drawn by the canvas');
await p.waitForTimeout(6000);
await still('popover stops drawing', 'popoverOut');

// 5. Permission button.
await show('permit');
await p.waitForTimeout(2200);
expect('the button drawn by the canvas', await routeOf('permitR1'), 'blocked: isValid: false (intersection_');
expect('the button over the canvas', await routeOf('permitR2'), 'works: isValid: true');
await shot('permit-1');
await tapId('permMove', 120);
console.log('info 0.1 s after the move: ' + await routeOf('permitR2'));
await p.waitForTimeout(1500);
expect('1.6 s after the move', await routeOf('permitR2'), 'works: isValid: true');
await tapEl('#permTilt', 1600);
console.log('info turned 4 degrees: ' + await routeOf('permitR2'));
await shot('permit-2');
await tapEl('#permTilt', 1600);
await ctx.grantPermissions(['geolocation']); await ctx.setGeolocation({ latitude: 56.41, longitude: -5.47, accuracy: 25 });
await tapId('permOver', 2500);
console.log('info after a tap on the button over the canvas: ' + await txt('permitOut'));
await shot('permit-3');

// 6. Drawer.
await show('drawer');
expect('drawer at rest', await txt('drawerOut'), 'The drawer is closed. Opened by a pull: 0.');
expect('drawer route 1', await routeOf('drawerR1'), "blocked: CSS.supports('overscroll-area', '--drawer') is false");
{
  const r = await p.evaluate(() => { const q = document.getElementById('drawerCanvas').getBoundingClientRect(); return [q.x + q.width / 2, q.y + 200]; });
  // Short drags scroll the list to its end by touch. Each is shorter than the pull that opens the drawer.
  let drags = 0;
  while (drags < 14 && !(await txt('drawerOut')).includes('is at its end')) { await (await drag(r[0], r[1], r[1] - 60, 6))(); drags++; }
  expect(`the list after ${drags} touch drags of 60 px`, await txt('drawerOut'), 'The list is at its end. Pull: 0 px. The drawer is closed');
  const y0 = await p.evaluate(() => scrollY);
  const release = await drag(r[0], r[1], r[1] - 120);
  between('pull while the finger is down', await txt('drawerOut'), /Pull: (\d+) px/, 70, 125);
  await shot('drawer-1');
  await release();
  report(await p.evaluate(() => scrollY) === y0, 'the page did not scroll during the pull', await p.evaluate(() => scrollY) - y0, 0);
}
expect('after letting go', await txt('drawerOut'), 'The drawer is open. Opened by a pull: 1.');
expect('drawer route 2', await routeOf('drawerR2'), 'works: A pull past the end of the list opened the drawer 1 time.');
await shot('drawer-2');
await tapEl('#drawerClose', 900);
expect('after Close on the drawn drawer', await txt('drawerOut'), 'The drawer is closed.');
await still('drawer stops drawing', 'drawerOut');

// A lost context: every element is shown as plain HTML.
await p.evaluate(() => document.getElementById('wallCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 6, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 6);
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
