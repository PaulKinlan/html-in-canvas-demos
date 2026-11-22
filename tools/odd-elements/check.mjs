#!/usr/bin/env node
// Drives the five demos of /odd-elements/ by touch at phone width and prints what each reported.
//
//   npm run build
//   node tools/odd-elements/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/odd-elements/?autochecks=0');
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


await show('monitor');
expect('at the start', await txt('monitorOut'), 'Power on. The page is 300 by 224 px, drawn once and cut into 11 strips. Guestbook entries: 0.');
await p.waitForTimeout(600); await shot('monitor');
await tapEl('#monitorSign', 500);
expect('after a tap on the button on the tube', await txt('monitorOut'), 'Guestbook entries: 1.');
expect('visitor count on the page', await p.evaluate(() => document.getElementById('monitorCount').textContent), '000043');
{ const n0 = await p.evaluate(() => { window.__paints = 0; document.getElementById('monitorCanvas').addEventListener('paint', () => window.__paints++); return 0; }); await p.waitForTimeout(2000);
  const n = await p.evaluate(() => window.__paints); report(n >= 6 && n <= 140, 'paint events on the monitor canvas in two seconds', n, '6 to 140'); }
await p.tap('#monitorPower'); await p.waitForTimeout(260); await shot('monitor-off-line'); await p.waitForTimeout(500);
expect('after Power off', await txt('monitorOut'), 'Power off.');
expect('element at the place of the button with the power off', await p.evaluate(() => { const c = document.getElementById('monitorCanvas').getBoundingClientRect(); const e = document.elementFromPoint(c.left + c.width / 2 - 30, c.top + 205); return e?.id || e?.localName; }), 'monitorCanvas');
await p.tap('#monitorPower'); await p.waitForTimeout(800);
expect('after Power on', await txt('monitorOut'), 'Power on.');

await show('xmp');
expect('at the start', await txt('xmpOut'), '12 tags coloured in the xmp text. The xmp has 0 child elements');
expect('elements in the copy', await txt('xmpOut'), 'The copy below it has 6 elements.');
await shot('xmp');
await p.evaluate(() => { const x = document.getElementById('xmpSource'); x.focus(); const s = getSelection(); s.selectAllChildren(x); s.collapseToEnd(); });
await p.keyboard.type('<u>new</u>'); await p.waitForTimeout(500);
expect('after typing a u element at the end', await txt('xmpOut'), '14 tags coloured');
expect('the copy after typing', await p.evaluate(() => document.querySelector('#xmpResult u')?.textContent), 'new');
await p.keyboard.type('<img src=x onerror="window.__bad=1"><script>window.__bad=2</' + 'script>'); await p.waitForTimeout(600);
report(await p.evaluate(() => window.__bad === undefined), 'script typed into the xmp did not run', await p.evaluate(() => String(window.__bad)), 'undefined');
await shot('xmp-typed');
await p.evaluate(() => document.activeElement.blur());

await show('audit');
expect('before', await txt('auditOut'), 'Not audited yet.');
await p.tap('#auditRun'); await p.waitForTimeout(500); await shot('audit-running'); await p.waitForTimeout(1300);
expect('after the audit', await txt('auditOut'), '3 unknown to the parser (red), 2 custom and not defined (amber), 4 known and obsolete (grey)');
await shot('audit');
await still('no frames after the line has passed', 'auditOut');
await p.tap('#auditClear'); await p.waitForTimeout(400);
expect('after Clear', await txt('auditOut'), 'Not audited yet.');

await show('frames');
await p.waitForTimeout(800);
expect('frames found', await txt('framesOut'), 'Frames with no contentDocument: 2 of 3.');
await shot('frames');
for (const i of [1, 2, 3]) { const at = await p.evaluate((n) => { const r = document.querySelector(`#framesSheet iframe:nth-of-type(${n})`).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, i); await p.touchscreen.tap(...at); await p.waitForTimeout(500); }
expect('after one tap in each frame', await txt('framesOut'), 'Taps: 1 in the frame from this origin, 1 in the data: frame, 1 in the sandboxed frame.');
await p.tap('#framesWarn'); await p.waitForTimeout(400); await shot('frames-no-warning');
await p.tap('#framesWarn'); await p.waitForTimeout(300);

await show('floor');
await p.waitForTimeout(500);
expect('at the start', await txt('floorOut'), 'Floor tilted back by 46 degrees');
await shot('floor');
await tapEl('#floorFooter a:nth-of-type(2)', 400);
expect('after a tap on a link on the floor', await txt('floorOut'), 'Last thing tapped: Moorings (a link in the footer)');
await tapEl('.sign:nth-of-type(2) button', 400);
expect('after a tap on the button of the far sign', await txt('floorOut'), 'Last thing tapped: Book a slot (the button on a sign)');
await p.evaluate(() => { const r = document.getElementById('floorTilt'); r.value = 20; r.dispatchEvent(new Event('input', { bubbles: true })); }); await p.waitForTimeout(900);
expect('with the slider at 20', await txt('floorOut'), 'Floor tilted back by 20 degrees');
await shot('floor-20');
await tapEl('#floorFooter a:nth-of-type(3)', 400);
expect('after a tap on a link at 20 degrees', await txt('floorOut'), 'Last thing tapped: Weather (a link in the footer)');
await still('no frames at rest', 'floorOut');

// A lost context: every element is shown as plain HTML.
await p.evaluate(() => document.getElementById('floorCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 5, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 5);
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
