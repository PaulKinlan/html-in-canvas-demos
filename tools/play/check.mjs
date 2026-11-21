#!/usr/bin/env node
// Drives /play/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8031) &
//   node tools/play/check.mjs [base URL, default http://localhost:8031] [folder for screenshots]
//
// The native drag goes through Playwright's mouse, touches go through CDP touch events and typing
// through the keyboard. Each step reads the line under the demo or the state the demo exports on
// window.playDemos. It prints one line per step and exits 1 if a step gave an unexpected result.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const BASE = process.argv[2] || 'http://localhost:8031';
const SHOTS = process.argv[3] || null;
let failed = 0;
const report = (ok, what, got, want) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : ` (wanted ${want})`}`); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true, deviceScaleFactor: SHOTS ? 2 : 1 });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
await p.goto(BASE + '/play/?autochecks=0');
await p.waitForTimeout(1200);
const cdp = await ctx.newCDPSession(p);
const show = async (id, pad = 70) => { await p.evaluate(([i, d]) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - d); }, [id, pad]); await p.waitForTimeout(1100); };
const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const touch = async (points, { hold = 0, step = 30, end = true } = {}) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: points[0][0], y: points[0][1] }] });
  await p.waitForTimeout(hold || step);
  for (const [x, y] of points.slice(1)) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] }); await p.waitForTimeout(step); }
  if (end) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(350);
};
const path = (a, c, n = 8) => Array.from({ length: n + 1 }, (_, i) => [a[0] + (c[0] - a[0]) * i / n, a[1] + (c[1] - a[1]) * i / n]);
const sum = (id) => p.evaluate((i) => {
  const c = document.getElementById(i);
  const copy = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), c2 = copy.getContext('2d');
  c2.drawImage(c, 0, 0, 64, 64);
  return c2.getImageData(0, 0, 64, 64).data.reduce((a, v) => a + v, 0);
}, id);

// ---------------------------------------------------------------- drag
await show('drag');
const ids = () => p.evaluate(() => [...document.querySelectorAll('#dragCanvas .pcard')].map((c) => c.dataset.id).join(''));
const mid = async (sel) => { const r = await box(sel); return [r.x + r.w / 2, r.y + r.h / 2]; };
let tray = await mid('#dragTray');
// The last card is on top of the hand, so its middle is not covered.
let from = await mid('#dragCanvas .pcard[data-id="e"]');
await p.mouse.move(...from); await p.mouse.down();
for (const [x, y] of path(from, tray, 10)) { await p.mouse.move(x, y); await p.waitForTimeout(25); }
await shot('drag-over-tray');
await p.mouse.up(); await p.waitForTimeout(500);
let t = await txt('dragOut');
report(num(t, /dragstart\): (\d+)/) === 1, 'mouse drag of a drawn card raised dragstart', t.match(/dragstart\): \d+/)[0], 'dragstart): 1');
report(num(t, /tray: (\d+)/) === 1 && (await ids()) === 'abcd', 'the card was dropped on the tray and removed from the canvas', `tray ${num(t, /tray: (\d+)/)}, cards ${await ids()}`, 'tray 1, cards abcd');
report(/dropEffect "move"/.test(t), 'dragend reported the drop', t.match(/Last drag: .*/)[0], 'dropEffect "move"');
const types = await p.evaluate(() => document.querySelector('#dragTray .note small').textContent);
report(/x-play-card/.test(types) && /text\/plain/.test(types) && /text\/html/.test(types), 'types that arrived', types, 'three types');
// Inside the hand: the top card to the far left.
from = await mid('#dragCanvas .pcard[data-id="d"]');
const cb = await box('#dragCanvas');
await p.mouse.move(...from); await p.mouse.down();
for (const [x, y] of path(from, [cb.x + 8, cb.y + 120], 10)) { await p.mouse.move(x, y); await p.waitForTimeout(25); }
await p.mouse.up(); await p.waitForTimeout(600);
report((await ids()) === 'dabc', 'mouse drag inside the hand moved the card to the front', await ids(), 'dabc');
// Touch: pointer route to the tray.
from = await mid('#dragCanvas .pcard[data-id="c"]');
tray = await mid('#dragTray');
await touch(path(from, tray, 10), { end: false });
await shot('drag-touch-ghost');
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await p.waitForTimeout(500);
t = await txt('dragOut');
report(num(t, /pointer events: (\d+)/) === 1 && num(t, /tray: (\d+)/) === 2 && (await ids()) === 'dab', 'touch drag of a card to the tray', `pointer drags ${num(t, /pointer events: (\d+)/)}, tray ${num(t, /tray: (\d+)/)}, cards ${await ids()}`, 'pointer drags 1, tray 2, cards dab');
// Touch on the canvas beside the cards scrolls the page.
let y0 = await p.evaluate(() => scrollY);
await touch(path([cb.x + cb.w / 2, cb.y + 12], [cb.x + cb.w / 2, cb.y - 100], 8));
let y1 = await p.evaluate(() => scrollY);
report(y1 - y0 > 40, 'a touch that starts on the canvas beside the cards scrolls the page', `${Math.round(y1 - y0)} px`, 'more than 40 px');
await show('drag');
await p.touchscreen.tap(...await mid('#dragTray .note button')); await p.waitForTimeout(500);
report((await ids()).length === 4, '"Put back" on a tray note made a card again', await ids(), 'four cards');
await shot('drag-after');

// ---------------------------------------------------------------- pixels
await show('pixels');
const checked = async () => num(await txt('pixelOut'), /^(\d+) of/);
const cell = async (c, r) => { const f = await box('#pixelForm'); return [f.x + (c + 0.5) * f.w / 16, f.y + (r + 0.5) * f.h / 16]; };
const start = await checked();
await p.touchscreen.tap(...await cell(0, 0)); await p.waitForTimeout(300);
report((await checked()) === start + 1, 'a tap on a drawn checkbox checked one box', `${start} then ${await checked()}`, `${start + 1}`);
await p.touchscreen.tap(...await cell(0, 0)); await p.waitForTimeout(300);
report((await checked()) === start, 'a second tap cleared it', `${await checked()}`, `${start}`);
await touch(path(await cell(1, 14), await cell(14, 14), 12));
report((await checked()) === start + 14, 'a touch dragged along row 15 checked 14 boxes', `${await checked()}`, `${start + 14}`);
y0 = await p.evaluate(() => scrollY);
await touch(path(await cell(8, 0), await cell(8, 15), 12));
y1 = await p.evaluate(() => scrollY);
report(y1 === y0, 'a vertical drag on the form draws and does not scroll the page', `${y1 - y0} px`, '0 px');
await shot('pixels-drawn');
const pc = await box('#pixelCanvas');
await touch(path([pc.x + 14, pc.y + 250], [pc.x + 14, pc.y + 130], 8));
y1 = await p.evaluate(() => scrollY);
report(y1 - y0 > 40, 'a touch on the canvas beside the form scrolls the page', `${Math.round(y1 - y0)} px`, 'more than 40 px');
await show('pixels');
await p.touchscreen.tap(...await mid('#pixels button[type=reset]')); await p.waitForTimeout(400);
report((await checked()) === start, 'the reset button put the picture back', `${await checked()}`, `${start}`);

// ---------------------------------------------------------------- puzzle
await show('puzzle');
const state = () => p.evaluate(() => window.playDemos.puzzle.state());
const frameEval = (fn, arg) => p.evaluate(([f, a]) => { const w = document.getElementById('puzzleFrame').contentWindow; return w.eval(`(${f})(${JSON.stringify(a)})`); }, [fn.toString(), arg]);
// The point in the window where a point of the frame is drawn now.
const drawnAt = async (fx, fy) => {
  const s = await state(), c = await box('#puzzleCanvas'), k = Math.min(1, c.w / 324), tile = Math.floor(fy / 108) * 3 + Math.floor(fx / 108), cellNo = s.cellOf[tile];
  return { tile, x: c.x + (c.w - 324 * k) / 2 + ((cellNo % 3) * 108 + fx % 108) * k, y: c.y + (c.h - 324 * k) / 2 + (Math.floor(cellNo / 3) * 108 + fy % 108) * k };
};
const centre = (sel) => frameEval((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel);
let [bx, by] = await centre('#count');
let at = await drawnAt(bx, by);
await p.touchscreen.tap(at.x, at.y); await p.waitForTimeout(400);
t = await txt('puzzleOut');
report((await frameEval(() => document.getElementById('n').textContent)) === '1 press', 'touch tap on the button of a shuffled tile pressed it once', `${await frameEval(() => document.getElementById('n').textContent)}, into the frame ${num(t, /frame itself: (\d+)/)}, passed on ${num(t, /passed on to the frame: (\d+)/)}`, '1 press');
await p.touchscreen.tap(at.x, at.y); await p.waitForTimeout(400);
t = await txt('puzzleOut');
report((await frameEval(() => document.getElementById('n').textContent)) === '2 presses', 'a second tap on the same tile, which is now the active one', `${await frameEval(() => document.getElementById('n').textContent)}, into the frame ${num(t, /frame itself: (\d+)/)}, passed on ${num(t, /passed on to the frame: (\d+)/)}`, '2 presses');
// Mouse: hover makes the tile active, and the click goes into the frame itself.
[bx, by] = await centre('#dark');
at = await drawnAt(bx, by);
await p.mouse.move(at.x - 20, at.y - 3); await p.mouse.move(at.x, at.y); await p.waitForTimeout(150);
await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(400);
t = await txt('puzzleOut');
report((await frameEval(() => document.getElementById('dark').checked)) === true && num(t, /frame itself: (\d+)/) >= 1, 'mouse click on the checkbox of another tile went into the frame', `checked ${await frameEval(() => document.getElementById('dark').checked)}, into the frame ${num(t, /frame itself: (\d+)/)}`, 'checked true, into the frame 1 or more');
await shot('puzzle-dark');
// Wheel over the active tile scrolls the frame.
await p.mouse.wheel(0, 90); await p.waitForTimeout(700);
report((await frameEval(() => scrollY)) > 40, 'wheel over a tile scrolled the frame', `${await frameEval(() => Math.round(scrollY))} px`, 'more than 40 px');
await frameEval(() => scrollTo({ top: 0, behavior: 'instant' })); await p.waitForTimeout(300);
// Touch scroll: the first touch selects the tile, the second scrolls the frame.
let s = await state();
const other = [0, 1, 2, 3, 4, 5, 6, 7].find((i) => i !== s.active);
const pc2 = await box('#puzzleCanvas');
const cellMid = (cellNo) => [pc2.x + (cellNo % 3) * 108 + 54, pc2.y + Math.floor(cellNo / 3) * 108 + 70];
let m = cellMid(s.cellOf[other]);
await touch(path(m, [m[0], m[1] - 50], 6));
const first = await frameEval(() => Math.round(scrollY));
await touch(path(m, [m[0], m[1] - 50], 6));
const second = await frameEval(() => Math.round(scrollY));
report((await state()).active === other && second > first + 15, 'touch scroll on a tile: first touch selects, second scrolls the frame', `active tile ${(await state()).active + 1}, frame scrolled ${first} px then ${second} px`, 'the second larger');
await frameEval(() => scrollTo({ top: 0, behavior: 'instant' })); await p.waitForTimeout(300);
// A tap on plain text of a tile next to the gap slides it.
s = await state();
const gap = s.cellOf[8], near = [gap - 3, gap + 3, gap % 3 ? gap - 1 : -1, gap % 3 < 2 ? gap + 1 : -1].filter((c) => c >= 0 && c < 9);
let slid = false;
for (const cellNo of near) {
  const tile = s.cellOf.indexOf(cellNo);
  const pt = await frameEval(([tile]) => { for (let y = 8; y < 108; y += 10) for (let x = 8; x < 108; x += 10) { const fx = (tile % 3) * 108 + x, fy = Math.floor(tile / 3) * 108 + y; if (!document.elementFromPoint(fx, fy)?.closest('a, button, input, select, textarea, label, summary')) return [x, y]; } return null; }, [tile]);
  if (!pt) continue;
  await p.touchscreen.tap(pc2.x + (cellNo % 3) * 108 + pt[0], pc2.y + Math.floor(cellNo / 3) * 108 + pt[1]); await p.waitForTimeout(500);
  const after = await state();
  report(after.cellOf[tile] === gap && after.moves === s.moves + 1, 'touch tap on plain text of a tile next to the gap slid it', `tile ${tile + 1} went from cell ${cellNo + 1} to cell ${after.cellOf[tile] + 1}`, `cell ${gap + 1}`);
  slid = true; break;
}
if (!slid) report(false, 'slide', 'no plain point found', 'a point');
await shot('puzzle-shuffled');
await p.touchscreen.tap(...await mid('#puzzleSolve')); await p.waitForTimeout(900);
[bx, by] = await centre('#count');
at = await drawnAt(bx, by);
const before = await frameEval(() => document.getElementById('n').textContent);
await p.touchscreen.tap(at.x, at.y); await p.waitForTimeout(400);
report((await state()).solved && (await frameEval(() => document.getElementById('n').textContent)) !== before, 'solved: a tap on the button goes into the whole frame', `${before} then ${await frameEval(() => document.getElementById('n').textContent)}`, 'one more press');
await shot('puzzle-solved');

// ---------------------------------------------------------------- curl
await show('curl', 40);
const curl = () => p.evaluate(() => window.playDemos.curl.state());
const cc = await box('#curlCanvas');
const chars = async () => num(await txt('curlOut'), /, (\d+) characters/);
const n0 = await chars(), sum0 = await sum('curlCanvas');
await p.touchscreen.tap(cc.x + 120, cc.y + 70); await p.waitForTimeout(400);
const focused = await p.evaluate(() => document.activeElement?.getAttribute('aria-label'));
await p.keyboard.press('Control+End');
const TYPED = ' Typed by the check tool, as far as the corner.';
await p.keyboard.type(TYPED, { delay: 15 });
await p.waitForTimeout(400);
report(focused === 'Page 1 of 4' && (await chars()) === n0 + TYPED.length, 'tap on the drawn page focused it and typing added the characters', `focus on "${focused}", ${n0} then ${await chars()} characters`, `${n0 + TYPED.length}`);
report((await sum('curlCanvas')) !== sum0, 'the canvas changed while typing', `${sum0} then ${await sum('curlCanvas')}`, 'a difference');
await shot('curl-typed');
// Drag the corner to the left with a finger.
let st = await curl();
const k = Math.min(1, (cc.w - 36) / 300, (cc.h - 28) / 380), ox = cc.x + (cc.w - 300 * k) / 2 + 8 * k, oy = cc.y + (cc.h - 380 * k) / 2;
const grab = [ox + ((300 + st.P.x) / 2) * k, oy + ((380 + st.P.y) / 2) * k];
y0 = await p.evaluate(() => scrollY);
await touch(path(grab, [grab[0] - 150, grab[1] - 60], 10), { end: false });
await shot('curl-dragging');
const midway = await curl();
await touch([[grab[0] - 150, grab[1] - 60], [ox - 10, grab[1] - 20]], { step: 60 });
await p.waitForTimeout(1500);
st = await curl();
report(midway.P.x < 200 && st.page === 1 && (await p.evaluate(() => scrollY)) === y0, 'touch drag of the corner turned to page 2 without scrolling the page', `corner at x ${Math.round(midway.P.x)} mid-drag, page ${st.page + 1}, page scrolled ${(await p.evaluate(() => scrollY)) - y0} px`, 'page 2');
await p.touchscreen.tap(cc.x + 150, cc.y + 120); await p.waitForTimeout(300);
report((await p.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'Page 2 of 4', 'a tap now focuses page 2', await p.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Page 2 of 4');
await p.touchscreen.tap(...await mid('#curlPrev')); await p.waitForTimeout(1600);
st = await curl();
report(st.page === 0 && (await chars()) === n0 + TYPED.length, '"Previous page" turned back and page 1 kept the typed text', `page ${st.page + 1}, ${await chars()} characters`, `page 1, ${n0 + TYPED.length}`);
await shot('curl-back');

await b.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
