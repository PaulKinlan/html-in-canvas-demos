#!/usr/bin/env node
// Drives /form-scenes/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8031) &
//   node tools/form-scenes/check.mjs [base URL, default http://localhost:8031] [folder for screenshots]
//
// Taps go through Playwright's touchscreen, typing through its keyboard, the file chooser through its
// filechooser event, and the file drop through CDP Input.dispatchDragEvent.
// It prints one line per step and exits 1 if a step gave an unexpected result.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const BASE = process.argv[2] || 'http://localhost:8031';
const SHOTS = process.argv[3] || null;
let failed = 0;
const expect = (what, got, want) => { const ok = String(got).includes(want); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${String(got).replace(/\n/g, ' | ')}${ok ? '' : ` (wanted ${want})`}`); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
await p.goto(BASE + '/form-scenes/?autochecks=0');
await p.waitForTimeout(1200);
const cdp = await ctx.newCDPSession(p);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 100); }, id); await p.waitForTimeout(1100); };
const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const tap = async (sel, fx = 0.5, fy = 0.5) => { const r = await box(sel); await p.touchscreen.tap(r.x + r.w * fx, r.y + r.h * fy); await p.waitForTimeout(300); };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const active = () => p.evaluate(() => document.activeElement?.id || document.activeElement?.localName);

// Exploded form.
await show('exploded');
await tap('label[for=exEmail]');
expect('tap on the call-out "Email"', await active(), 'exEmail');
expect('  the page reports it', await txt('explodedOut'), 'A tap on the call-out "Email" focused the field "email"');
await p.keyboard.type('a@b.co');
expect('typing in the sheared field', await txt('explodedOut'), 'email=a%40b.co');
await shot('exploded-focus');
await tap('label[for=exNews]');
expect('tap on the checkbox call-out', await p.evaluate(() => exNews.checked), 'true');
const sheared = await box('#exName');
await tap('#exName', 0.9, 0.2);
expect('tap near the raised end of a sheared field', await active(), 'exName');
await tap('#explodedForm button');
expect('Send with the name empty', await txt('explodedOut'), 'reports "name" as invalid: valueMissing');
await shot('exploded-invalid');
await p.tap('#explodedToggle');
await p.waitForTimeout(1200);
const flat = await box('#exName');
expect('Assemble: the field is flat', `${Math.round(sheared.h)} px tall sheared, ${Math.round(flat.h)} px assembled`, 'assembled');
if (!(flat.h < sheared.h - 20)) { failed++; console.log('FAIL the field did not flatten'); }
await tap('label[for=exName]');
expect('tap on the label of the assembled form', await active(), 'exName');
await shot('exploded-assembled');
await p.evaluate(() => document.activeElement.blur());

// Wall calendar.
await show('calendar');
const want = await p.evaluate(() => {
  const [y, m] = calMonth.value.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = first.getTime() - ((first.getUTCDay() + 6) % 7) * 864e5;
  return new Date(start + (2 * 7 + 2) * 864e5).toISOString().slice(0, 10);
});
await tap('#calGrid', 2.5 / 7, 2.5 / 6);
expect('tap on row 3, column 3 of the drawn grid', await p.evaluate(() => calDate.value), want);
const month0 = await p.evaluate(() => calMonth.value);
const rest = await box('#calDate');
await tap('#calNext');
const during = await box('#calDate');
await shot('calendar-falling');
expect('tap on the next month button', await txt('calOut'), 'Sheets torn off: 1');
expect('  the month input moved on from ' + month0, await p.evaluate(() => calMonth.value !== '' && calMonth.value), month0.slice(0, 2));
expect('  the date input stays hit at its place while the sheet falls', `${Math.round(during.y - rest.y)} px from rest`, '0 px');
await p.waitForTimeout(1200);
await p.fill('#calDate', '2027-01-15');
await p.waitForTimeout(500);
await shot('calendar-typed');
expect('a date typed in the input', await txt('calOut'), 'month=2027-01');
await tap('#calPrev');
await p.waitForTimeout(1200);
expect('tap on the previous month button', await p.evaluate(() => calMonth.value), '2026-12');
expect('  open pictures after the sheets fell', await p.evaluate(() => String(window.__gfx?.snapshotsOpen ?? 'not counted')), '');

// Letter box.
await show('letterbox');
const dir = mkdtempSync(join(tmpdir(), 'form-scenes-'));
const png = (name, colour) => p.evaluate(async ([c]) => { const o = new OffscreenCanvas(320, 200); const x = o.getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 320, 200); x.fillStyle = '#fff'; x.fillRect(40, 40, 120, 80); const blob = await o.convertToBlob(); return [...new Uint8Array(await blob.arrayBuffer())]; }, [colour]).then((bytes) => { const f = join(dir, name); writeFileSync(f, Buffer.from(bytes)); return f; });
const files = [await png('red.png', '#c0392b'), await png('blue.png', '#2980b9')];
writeFileSync(join(dir, 'letter.txt'), 'hello'); files.push(join(dir, 'letter.txt'));
const chooser = p.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null);
await tap('#lbInput', 0.25, 0.5);
const fc = await chooser;
expect('tap on the drawn file input opens the file chooser', fc ? `chooser opened, multiple ${fc.isMultiple()}` : 'no chooser', 'chooser opened');
if (fc) await fc.setFiles(files);
await p.waitForTimeout(2600);
expect('three files chosen', await txt('lbOut'), 'input.files: 3');
expect('  elements made for them', await p.evaluate(() => `${document.querySelectorAll('#lbCanvas .lb-print').length} prints, ${document.querySelectorAll('#lbCanvas .lb-letter').length} envelopes`), '2 prints, 1 envelopes');
await shot('letterbox-chosen');
await tap('#lbCanvas .lb-print');
await p.waitForTimeout(900);
expect('tap on a print on the mat takes its file out', await txt('lbOut'), 'input.files: 2');
// A drop on the drawn input.
const slot = await box('#lbInput');
const data = { items: [], files: [files[0]], dragOperationsMask: 1 };
let dropped = 'drop sent';
try {
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x: Math.round(slot.x + slot.w / 2), y: Math.round(slot.y + slot.h / 2), data });
} catch (e) { dropped = 'CDP refused: ' + e.message; }
await p.waitForTimeout(2200);
expect('a file dropped on the drawn input (' + dropped + ')', await txt('lbOut'), 'input.files: 1 (');
await shot('letterbox-dropped');
await p.tap('#lbSamples');
await p.waitForTimeout(2600);
expect('sample files written to input.files', await txt('lbOut'), 'night.svg, note.txt');
await shot('letterbox-samples');
await p.tap('#lbEmpty');
await p.waitForTimeout(900);
expect('Empty the box', await p.evaluate(() => `${lbInput.files.length} files, ${document.querySelectorAll('#lbCanvas button').length} elements`), '0 files, 0 elements');

// Disabled panel.
await show('frost');
await tap('#frostLock');
await p.waitForTimeout(1500);
expect('tap on the lock in the legend', await txt('frostOut'), '6 of 7 controls match :disabled. FormData: (nothing)');
await tap('#frostSet button[type=submit]');
await shot('frost-touched');
expect('tap on the disabled Apply button', await txt('frostOut'), 'the last on <button>. Click events on its controls: 0');
await tap('#frostSet input[name=room]');
expect('tap on the disabled text field', await active(), 'body');
expect('  the press reached the canvas', await txt('frostOut'), 'Presses on the locked panel: 2, the last on <input>');
await tap('#frostLock');
await p.waitForTimeout(900);
expect('tap on the lock again', await txt('frostOut'), '0 of 7 controls match :disabled. FormData: room=Kitchen&temp=21&mode=Heat');
await tap('#frostSet button[type=submit]');
expect('tap on Apply', await txt('frostOut'), 'Submitted: room=Kitchen&temp=21&mode=Heat');
await shot('frost-unlocked');

expect('lost canvases', await p.evaluate(() => String(document.querySelectorAll('.plain-fallback').length)), '0');
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
await b.close();
process.exit(failed ? 1 : 0);
