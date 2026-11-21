#!/usr/bin/env node
// Drives /form-state/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8011) &
//   node tools/form-state/check.mjs [base URL, default http://localhost:8011] [folder for screenshots]
//
// Typing and taps go through Playwright, a held press through CDP touch events. Each step reads the
// line under the demo, which the paint handler writes, and some steps compare canvas pixels read from
// a drawImage() copy. It prints one line per step and exits 1 if a step gave an unexpected result.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const BASE = process.argv[2] || 'http://localhost:8011';
const SHOTS = process.argv[3] || null;
let failed = 0;
const report = (ok, what, got, want) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : ` (wanted ${want})`}`); };
const expect = (what, got, want) => report(String(got).includes(want), what, got, want);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
await p.goto(BASE + '/form-state/?autochecks=0');
await p.waitForTimeout(1200);
const cdp = await ctx.newCDPSession(p);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const tap = async (sel) => { const r = await box(sel); await p.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await p.waitForTimeout(250); };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
// The canvas pixel under a point given in CSS pixels of the canvas, read from a drawImage() copy.
const pixel = (id, x, y) => p.evaluate(([i, px, py]) => {
  const c = document.getElementById(i), k = c.width / c.clientWidth;
  const copy = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), c2 = copy.getContext('2d');
  c2.drawImage(c, Math.round(px * k), Math.round(py * k), 1, 1, 0, 0, 1, 1);
  return [...c2.getImageData(0, 0, 1, 1).data];
}, [id, x, y]);
// A number that changes when any pixel of the canvas does: the sum over a 64 by 64 copy.
const sum = (id) => p.evaluate((i) => {
  const c = document.getElementById(i);
  const copy = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), c2 = copy.getContext('2d');
  c2.drawImage(c, 0, 0, 64, 64);
  return c2.getImageData(0, 0, 64, 64).data.reduce((a, v) => a + v, 0);
}, id);
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);

// Ink.
await show('ink');
await tap('#inkText');
const rest = await sum('inkCanvas');
await p.keyboard.type('ink', { delay: 60 });
await p.waitForTimeout(80);
const wet = await sum('inkCanvas');
await shot('ink-wet');
expect('typed "ink" in the textarea', await p.evaluate(() => document.getElementById('inkText').value), 'Dear canvas, ink');
expect('characters the paint handler saw', await txt('inkOut'), 'arrive: 3');
report(wet !== rest, 'canvas while the ink is wet differs from the canvas before typing', `${rest} then ${wet}`, 'a difference');
await p.waitForTimeout(1800);
const n1 = num(await txt('inkOut'), /Paint events: (\d+)/);
await p.waitForTimeout(700);
const n2 = num(await txt('inkOut'), /Paint events: (\d+)/);
report(n2 - n1 <= 3, 'paint events in 0.7 s after the ink dried (the caret blinks)', n2 - n1, 'at most 3');
await p.keyboard.press('Backspace'); await p.waitForTimeout(300);
expect('after Backspace, still', await txt('inkOut'), 'arrive: 3');
{
  // The hit region is back at the flat place: a tap on the first line puts the caret on it.
  const r = await box('#inkText');
  await p.touchscreen.tap(r.x + 30, r.y + 30); await p.waitForTimeout(300);
  const at = await p.evaluate(() => document.getElementById('inkText').selectionStart);
  report(at < 6, 'tap near the start of the first line puts the caret at index', at, 'under 6');
}

// Dent.
await show('dent');
{
  const key = await box('#dentPanel button[value="5"]'), x = key.x + key.w / 2, y = key.y + key.h / 2;
  const flat = await sum('dentCanvas');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await p.waitForTimeout(450);
  const held = await sum('dentCanvas');
  console.log(`     while key 5 is held by touch, button:active is: ${await p.evaluate(() => document.querySelector('#dentPanel button:active')?.value ?? 'none')}`);
  report(held !== flat, 'canvas while held differs from the flat panel', `${flat} then ${held}`, 'a difference');
  await shot('dent-held');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(260);
  await shot('dent-ring');
  await p.waitForTimeout(1600);
  expect('display after the press', await p.evaluate(() => document.getElementById('dentDisplay').value), '5');
  console.log(`     after a touch press: ${await txt('dentOut')}`);
  report(/: 1\./.test(await txt('dentOut')), 'one press was counted by one of the two routes', await txt('dentOut'), 'a count of 1');
  const after = await sum('dentCanvas');
  await tap('#dentPanel button[value="7"]'); await p.waitForTimeout(1700);
  expect('display after a tap on 7', await p.evaluate(() => document.getElementById('dentDisplay').value), '57');
  // Keyboard: Space on the focused key.
  await p.focus('#dentPanel button[value="0"]');
  await p.keyboard.down('Space'); await p.waitForTimeout(300);
  expect('while Space is held on key 0, button:active is', await p.evaluate(() => document.querySelector('#dentPanel button:active')?.value ?? 'none'), '0');
  await p.keyboard.up('Space'); await p.waitForTimeout(1700);
  expect('display after Space on 0', await p.evaluate(() => document.getElementById('dentDisplay').value), '570');
  report(/:active: [1-9]/.test(await txt('dentOut')), 'the Space press was counted through :active', await txt('dentOut'), ':active count above 0');
  report(after !== flat, 'canvas after the first press shows the digit', `${flat} then ${after}`, 'a difference');
}

// Tint.
await show('tint');
{
  const c = await box('#tintCanvas');
  const wall = [c.w - 40, 30];
  const warm = await pixel('tintCanvas', ...wall);
  await p.click('[data-tint="#ff3b6b"]'); await p.waitForTimeout(1500);
  const red = await pixel('tintCanvas', ...wall);
  await shot('tint-red');
  expect('line after the Red button', await txt('tintOut'), '#ff3b6b');
  report(red[0] > red[1] * 2 && red[0] > red[2] * 1.5, 'wall pixel under red light', red.slice(0, 3), 'mostly red');
  await p.click('[data-tint="#62f0a0"]'); await p.waitForTimeout(1500);
  const green = await pixel('tintCanvas', ...wall);
  await shot('tint-green');
  report(green[1] > green[0] * 1.3, 'wall pixel under green light', green.slice(0, 3), 'mostly green');
  console.log(`     wall pixel under the first light: ${warm.slice(0, 3)}`);
  const n = num(await txt('tintOut'), /Paint events: (\d+)/);
  await p.waitForTimeout(800);
  report(num(await txt('tintOut'), /Paint events: (\d+)/) === n, 'paint events in 0.8 s after the colour settled', num(await txt('tintOut'), /Paint events: (\d+)/) - n, '0');
  const i = await box('#tintInput');
  expect('element at the drawn lamp', await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [i.x + i.w / 2, i.y + i.h / 2]), 'tintInput');
}

// Liquid.
await show('liquid');
{
  const c = await box('#liquidCanvas'), mid = [c.w / 2, c.h / 2 - 20];
  const low = await pixel('liquidCanvas', ...mid);
  await p.click('#liquidAdd'); await p.click('#liquidAdd'); await p.click('#liquidAdd');
  await p.waitForTimeout(400);
  await shot('liquid-rising');
  await p.waitForTimeout(3500);
  expect('line after Add 15 three times', await txt('liquidOut'), 'position 0.80');
  const high = await pixel('liquidCanvas', ...mid);
  report(Math.abs(high[0] - low[0]) + Math.abs(high[1] - low[1]) + Math.abs(high[2] - low[2]) > 60, 'pixel above the middle of the tank, at 35% then at 80%', `${low.slice(0, 3)} then ${high.slice(0, 3)}`, 'a different colour');
  const n = num(await txt('liquidOut'), /Paint events: (\d+)/);
  await p.waitForTimeout(800);
  report(num(await txt('liquidOut'), /Paint events: (\d+)/) === n, 'paint events in 0.8 s after the liquid settled', num(await txt('liquidOut'), /Paint events: (\d+)/) - n, '0');
  await p.click('#liquidUnknown'); await p.waitForTimeout(1200);
  await shot('liquid-unknown');
  expect('line after Indeterminate', await txt('liquidOut'), 'position -1.00');
  await p.click('#liquidEmpty'); await p.waitForTimeout(3500);
  expect('line after Empty', await txt('liquidOut'), 'position 0.00');
}

// Focus.
await show('focus');
{
  const calm = await sum('focusCanvas');
  await tap('#focusField'); await p.waitForTimeout(900);
  await shot('focus-empty');
  expect('line after a tap on the field', await txt('focusOut'), ':focus true');
  report((await sum('focusCanvas')) !== calm, 'canvas with the field focused differs', 'changed', 'a difference');
  await p.keyboard.type('se', { delay: 80 }); await p.waitForTimeout(900);
  await shot('focus-query');
  expect('line after typing "se"', await txt('focusOut'), '2 of 6 match');
  // A link that was set aside is still a link at its drawn place.
  const link = await box('#focusCanvas a.result:nth-of-type(1)');
  expect('element at the blurred first link', await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href'), [link.x + link.w / 2, link.y + link.h / 2]), '/start/');
  const c = await box('#focusCanvas');
  await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(900);
  expect('line after the field lost focus', await txt('focusOut'), ':focus false');
  await shot('focus-left');
  void c;
}

// A lost context: every demo shows plain controls, and they still work.
await p.evaluate(() => document.getElementById('liquidCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
expect('plain control boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), '5');
await p.evaluate(() => window.scrollTo(0, 0));
await shot('plain');

await b.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
