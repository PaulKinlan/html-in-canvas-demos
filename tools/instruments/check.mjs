#!/usr/bin/env node
// Drives /instruments/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8011) &
//   node tools/instruments/check.mjs [base URL, default http://localhost:8011] [folder for screenshots]
//
// Touch drags go through CDP Input.dispatchTouchEvent. Typing and taps go through Playwright.
// It prints one line per step and exits 1 if a step gave an unexpected form value.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const BASE = process.argv[2] || 'http://localhost:8011';
const SHOTS = process.argv[3] || null;
let failed = 0;
const expect = (what, got, want) => { const ok = String(got).includes(want); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : ` (wanted ${want})`}`); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
await p.goto(BASE + '/instruments/?autochecks=0');
await p.waitForTimeout(1200);
const cdp = await ctx.newCDPSession(p);
const touch = async (pts) => {
  for (let i = 0; i < pts.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: i ? 'touchMove' : 'touchStart', touchPoints: [{ x: pts[i][0], y: pts[i][1] }] }); await p.waitForTimeout(20); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
};
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const tap = async (sel) => { const r = await box(sel); await p.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await p.waitForTimeout(250); };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const scrolled = async (from) => (await p.evaluate(() => scrollY)) - from;

// Rotary switch.
await show('rotary');
const g = await box('#rotaryGrip'), cx = g.x + g.w / 2, cy = g.y + g.h / 2;
const arc = []; for (let a = -1.0; a <= 1.6; a += 0.1) arc.push([cx + Math.sin(a) * 40, cy - Math.cos(a) * 40]);
let y0 = await p.evaluate(() => scrollY);
await touch(arc);
expect('touch drag on the knob, 2.6 rad clockwise from Low', await txt('rotaryOut'), 'speed=high');
expect('page scroll during that drag', await scrolled(y0), '0');
await tap('#rotaryForm label:nth-of-type(1)');
expect('tap on the drawn Off label', await txt('rotaryOut'), 'speed=off');
await p.keyboard.press('ArrowRight'); await p.keyboard.press('ArrowRight'); await p.waitForTimeout(500);
expect('two presses of ArrowRight', await txt('rotaryOut'), 'speed=medium');
const cb = await box('#rotaryCanvas');
y0 = await p.evaluate(() => scrollY);
await touch(Array.from({ length: 12 }, (_, i) => [cb.x + 30, cb.y + cb.h - 20 - i * 15]));
expect('vertical swipe on the canvas beside the knob scrolls the page by', await scrolled(y0), '1');
await shot('rotary');

// Odometer.
await show('odometer');
await tap('#odoInput');
await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(600);
expect('two presses of ArrowUp in the field', await txt('odoOut'), 'miles=12347');
await p.keyboard.press('Control+a'); await p.keyboard.type('907'); await p.waitForTimeout(1500);
expect('select all, type 907', await txt('odoOut'), 'miles=907');
await p.click('[data-odo="2468"]'); await p.waitForTimeout(200); await shot('odometer-rolling'); await p.waitForTimeout(1500);
expect('+2468 button', await txt('odoOut'), 'miles=3375');

// Prism.
await show('prism');
await tap('#prismForm fieldset:nth-of-type(1) button');
await p.waitForTimeout(600); await shot('prism-invalid');
expect('Next with empty fields stays on face 1, focus on', await p.evaluate(() => document.activeElement.name), 'name');
await tap('#prismForm input[name=name]'); await p.keyboard.type('Ada');
await tap('#prismForm input[name=email]'); await p.keyboard.type('ada@example.com');
await p.keyboard.press('Enter'); await p.waitForTimeout(260); await shot('prism-turning'); await p.waitForTimeout(900);
expect('Enter on face 1 turns to the first invalid field, focus on', await p.evaluate(() => document.activeElement.name), 'seats');
await p.keyboard.type('3');
await tap('#prismForm fieldset:nth-of-type(2) button[data-turn="1"]'); await p.waitForTimeout(900);
expect('Next on face 2, inert flags', await p.evaluate(() => [...document.querySelectorAll('#prismForm fieldset')].map((f) => f.inert).join()), 'true,true,false');
await tap('#prismForm button[type=submit]'); await p.waitForTimeout(500);
expect('Book without the checkbox submits nothing', JSON.stringify(await txt('prismOut')), '""');
await tap('#prismForm input[name=agree]');
await tap('#prismForm button[type=submit]'); await p.waitForTimeout(1600);
expect('Book', await txt('prismOut'), 'name=Ada&email=ada%40example.com&ticket=standard&seats=3&agree=on');

// Gauge.
await show('gauge');
await p.evaluate(() => { const s = document.getElementById('gaugeValue'); s.value = 12; s.dispatchEvent(new Event('input', { bubbles: true })); });
await p.waitForTimeout(900); await shot('gauge');
expect('slider to 12', await txt('gaugeOut'), 'two regions away');

// Clock.
await show('clock');
const k = await box('#clockGrip'), kx = k.x + k.w / 2, ky = k.y + k.h / 2;
const at = (deg, r) => [kx + Math.sin(deg * Math.PI / 180) * r, ky - Math.cos(deg * Math.PI / 180) * r];
y0 = await p.evaluate(() => scrollY);
await touch(Array.from({ length: 23 }, (_, i) => at(48 + i * 6, 70)));
expect('touch drag of the minute hand from :08 to :30', await txt('clockOut'), 'at=10:30');
expect('page scroll during that drag', await scrolled(y0), '0');
await touch(Array.from({ length: 41 }, (_, i) => at(180 + i * 6, 70)));
expect('minute hand on past 12 to :10', await txt('clockOut'), 'at=11:10');
await shot('clock');
await b.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
