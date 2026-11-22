#!/usr/bin/env node
// Drives the five demos of /field-heads/ by touch at phone width and prints what each reported.
//
//   npm run build
//   node tools/field-heads/check.mjs [base URL] [folder for screenshots]
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
await p.goto(BASE + '/field-heads/?autochecks=0');
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

const val = (id) => p.evaluate((i) => document.getElementById(i).value, id);
const tapCanvas = async (id, x, y, wait = 700) => { const r = await p.evaluate((i) => { const q = document.getElementById(i).getBoundingClientRect(); return [q.x, q.y, q.width]; }, id); await p.touchscreen.tap(r[0] + (x < 0 ? r[2] / 2 : x), r[1] + y); await p.waitForTimeout(wait); };

// 1. Datalist ring.
await show('ring');
expect('ring at rest', await txt('ringOut'), '8 options read from input.list. Nothing typed. input.list is now null.');
await shot('ring-1');
await tapEl('#ringInput', 400);
report(await p.evaluate(() => document.activeElement.id) === 'ringInput', 'a tap on the drawn field focuses it', await p.evaluate(() => document.activeElement.id), 'ringInput');
await p.keyboard.type('ta', { delay: 60 });
await p.waitForTimeout(700);
expect('after typing "ta"', await txt('ringOut'), '1 match "ta"');
await shot('ring-2');
await p.keyboard.press('Backspace'); await p.keyboard.press('Backspace');
await p.waitForTimeout(700);
await tapCanvas('ringCanvas', -1, 28);
report(await val('ringInput') === 'Oban', 'a tap on the canvas where the first chip is drawn', await val('ringInput'), 'Oban');
expect('after the tap', await txt('ringOut'), '1 match "Oban"');
await shot('ring-3');
await still('ring stops drawing', 'ringOut');

// 2. Password guard.
await show('secret');
expect('password at rest', await txt('secretOut'), 'type="password": its picture holds 12 dots');
await shot('secret-1');
await tapEl('#secretShow', 600);
expect('after ticking the box', await txt('secretOut'), 'type="text": its picture holds the 12 characters');
await shot('secret-2');
await tapEl('#secretForm [name=pass]', 400);
await p.keyboard.type('xy', { delay: 60 });
await p.waitForTimeout(500);
expect('after typing two characters', await txt('secretOut'), 'holds the 14 characters');
await tapEl('#secretShow', 600);
expect('after clearing the box', await txt('secretOut'), 'holds 14 dots');

// 3. selectedcontent.
await show('hero');
expect('select at rest', await txt('heroOut'), 'The select\'s value is "starboard"');
expect('selectedcontent text', await txt('heroOut'), 'Starboard');
await shot('hero-1');
await tapEl('#heroSelect', 900);
report(await p.evaluate(() => document.getElementById('heroSelect').matches(':open')), 'a tap on the drawn select opens its picker', await p.evaluate(() => document.getElementById('heroSelect').matches(':open')), true);
await shot('hero-2');
await tapEl('#heroSelect option[value=danger]', 1200);
expect('after choosing Danger', await txt('heroOut'), 'holds "Dangera rock or a wreck"');
expect('value', await txt('heroOut'), 'value is "danger"');
await shot('hero-3');
await still('hero stops drawing', 'heroOut');

// 4. Title.
await show('title');
expect('title parent', await txt('titleOut'), 'its parent is the canvas');
report(await p.evaluate(() => document.title.startsWith('Fields and headings')), 'document.title with the title element inside the canvas', await p.title(), 'Fields and headings…');
await shot('title-1');
await p.fill('#titleInput', 'Tide table for Oban');
await p.waitForTimeout(700);
report(await p.title() === 'Tide table for Oban', 'the tab name after typing', await p.title(), 'Tide table for Oban');
expect('line after typing', await txt('titleOut'), 'document.title is "Tide table for Oban"');
await shot('title-2');
await still('title stops drawing', 'titleOut');

// 5. Subtitle.
await show('subtitle');
await p.waitForTimeout(3500);
expect('subtitle after the run', await txt('subtitleOut'), 'Heading in place: yes. Characters of the subtitle shown: 61 of 61');
await p.touchscreen.tap(...await p.evaluate(() => { const r = document.getElementById('subtitleAgain').getBoundingClientRect(); return [r.x + 20, r.y + 20]; }));
await p.waitForTimeout(1300);
between('characters shown 1.3 s after Type it again', await txt('subtitleOut'), /shown: (\d+) of/, 5, 40);
await shot('subtitle-1');
await p.waitForTimeout(3200);
expect('subtitle after the second run', await txt('subtitleOut'), '61 of 61');
await shot('subtitle-2');
await still('subtitle stops drawing', 'subtitleOut');

// A lost context: every element is shown as plain HTML, and the field has its list again.
await p.evaluate(() => document.getElementById('ringCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
report(await p.evaluate(() => document.querySelectorAll('.plain-controls').length) === 5, 'plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), 5);
report(await p.evaluate(() => document.getElementById('ringInput').list !== null), 'input.list after the loss', await p.evaluate(() => String(document.getElementById('ringInput').list)), 'the datalist');
await shot('plain');

await b.close();
server?.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
