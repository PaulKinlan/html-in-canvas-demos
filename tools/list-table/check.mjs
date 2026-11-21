#!/usr/bin/env node
// Drives /list-table/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8011) &
//   node tools/list-table/check.mjs [base URL, default http://localhost:8011] [folder for screenshots]
//
// Touch goes through CDP Input.dispatchTouchEvent. Taps and keys go through Playwright.
// It prints one line per step and exits 1 if a step gave an unexpected result.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const BASE = process.argv[2] || 'http://localhost:8011';
const SHOTS = process.argv[3] || null;
let failed = 0;
const expect = (what, ok, got) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}`); };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
p.on('console', (m) => { if (m.type() === 'error') console.log('console error: ' + m.text()); });
await p.goto(BASE + '/list-table/?autochecks=0');
await p.waitForTimeout(1200);
const cdp = await ctx.newCDPSession(p);
const touch = async (pts, gap = 20) => {
  for (let i = 0; i < pts.length; i++) { await cdp.send('Input.dispatchTouchEvent', { type: i ? 'touchMove' : 'touchStart', touchPoints: [{ x: pts[i][0], y: pts[i][1] }] }); await p.waitForTimeout(gap); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(600);
};
const line = (x0, y0, x1, y1, n = 12) => Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 150); }, id); await p.waitForTimeout(1000); };
const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const tap = async (x, y) => { await p.touchscreen.tap(x, y); await p.waitForTimeout(300); };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const scrollY = () => p.evaluate(() => scrollY);
// Pixels of the visible canvas, read from a drawImage() copy.
const ink = (sel, x, y, w, h) => p.evaluate(([s, x, y, w, h]) => {
  const c = document.querySelector(s), k = c.width / c.clientWidth, copy = document.createElement('canvas');
  copy.width = Math.round(w * k); copy.height = Math.round(h * k);
  const g = copy.getContext('2d');
  g.drawImage(c, x * k, y * k, w * k, h * k, 0, 0, copy.width, copy.height);
  const d = g.getImageData(0, 0, copy.width, copy.height).data;
  let any = 0, dark = 0;
  for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 8) any++; if (d[i + 3] > 100 && d[i] + d[i + 1] + d[i + 2] < 330) dark++; }
  return { any: any / (d.length / 4), dark: dark / (d.length / 4) };
}, [sel, x, y, w, h]);

// 1. Column light.
await show('col');
let c = await box('#colCanvas');
await shot('1-col-start');
expect('column light at load', (await txt('colOut')).includes('Column 4 of 6'), await txt('colOut'));
await touch(line(c.x + 150, c.y + 150, c.x + 380, c.y + 160));
expect('sideways touch drag to the last column', (await txt('colOut')).includes('Column 6 of 6 (Fri)'), await txt('colOut'));
await shot('1-col-fri');
await tap(c.x + 170, c.y + 200);
expect('tap on the second column', (await txt('colOut')).includes('(Mon)'), await txt('colOut'));
let y0 = await scrollY();
await touch(line(c.x + 200, c.y + 250, c.x + 205, c.y + 100));
expect('a vertical swipe on the table scrolls the page', (await scrollY()) - y0 > 80, `${(await scrollY()) - y0} px`);
await p.selectOption('#colMode', 'flat');
await p.waitForTimeout(400);
expect('flat fill sets a class on the col', await p.evaluate(() => document.querySelectorAll('#colTable col.lit').length === 1), 'one col.lit');
await shot('1-col-flat');
await p.selectOption('#colMode', 'light');

// 2. Glossary cards.
await show('glossary-cards');
c = await box('#dlCanvas');
await shot('2-dl-start');
await tap(c.x + 100, c.y + 70);
await p.waitForTimeout(350);
await shot('2-dl-turning');
await p.waitForTimeout(800);
expect('tap on the first card turns it', (await txt('dlOut')).startsWith('5 cards show the dt, 1 show the dd'), await txt('dlOut'));
expect('aria-expanded on its button', await p.evaluate(() => document.querySelector('#glossary button').getAttribute('aria-expanded')) === 'true', 'true');
await shot('2-dl-one-back');
await tap(c.x + 100, c.y + 70);
await p.waitForTimeout(1100);
expect('tap on the dd turns it back', (await txt('dlOut')).startsWith('6 cards show the dt'), await txt('dlOut'));
await p.tap('#dlAll');
await p.waitForTimeout(500);
await shot('2-dl-all-turning');
await p.waitForTimeout(1300);
expect('Turn all', (await txt('dlOut')).startsWith('0 cards show the dt, 6 show the dd'), await txt('dlOut'));
await shot('2-dl-all-back');
// The link on the back of the fifth card (left column, third row).
const link = await box('#glossary a');
const before = await p.evaluate(() => location.hash);
await tap(link.x + link.w / 2, link.y + link.h / 2);
await p.waitForTimeout(500);
expect('tap on the link in a dd follows it and does not turn the card', (await p.evaluate(() => location.hash)) === '#findings' && before !== '#findings', await p.evaluate(() => location.hash));

// 3. Staggered list.
await show('stagger');
c = await box('#listCanvas');
await p.tap('#listReplay');
await p.waitForTimeout(330);
await shot('3-list-entering');
await p.waitForTimeout(1500);
await shot('3-list-inside');
let m = await ink('#listCanvas', 14, 12, 26, 300);
expect('inside markers are drawn', m.dark > 0.005, `${(m.dark * 100).toFixed(1)}% dark pixels in the marker column`);
await p.selectOption('#listMarkers', 'outside');
await p.waitForTimeout(1700);
m = await ink('#listCanvas', 4, 12, 40, 300);
expect('outside markers are not drawn', m.any === 0, `${(m.any * 100).toFixed(1)}% of the marker column has ink`);
await shot('3-list-outside');
await p.selectOption('#listMarkers', 'slices');
await p.waitForTimeout(1700);
m = await ink('#listCanvas', 4, 12, 40, 300);
expect('rows of the ol have the markers', m.dark > 0.005, `${(m.dark * 100).toFixed(1)}% dark pixels in the marker column`);
await shot('3-list-slices');
const cb = await box('#steps li:nth-child(4) input');
await tap(cb.x + cb.w / 2, cb.y + cb.h / 2);
expect('tap on the fourth checkbox in slices mode', await p.evaluate(() => document.querySelector('#steps li:nth-child(4) input').checked), 'checked');
await p.tap('#listInsert');
await p.waitForTimeout(1200);
expect('insert a step', await p.evaluate(() => document.querySelectorAll('#steps li').length) === 8, '8 items');
await shot('3-list-inserted');
await p.selectOption('#listStyle', 'fan');
await p.waitForTimeout(450);
await shot('3-list-fan');
await p.waitForTimeout(1200);

// 4. Sticky header.
await show('sticky');
c = await box('#stickyCanvas');
await shot('4-sticky-top');
y0 = await scrollY();
const paints0 = await p.evaluate(() => window.__listTable.sticky.paints);
await touch(line(c.x + 150, c.y + 300, c.x + 150, c.y + 80));
const top = await p.evaluate(() => document.getElementById('scroller').scrollTop);
expect('touch swipe scrolls the table natively', top > 100, `scrollTop ${Math.round(top)}`);
expect('the page did not scroll', (await scrollY()) === y0, `${(await scrollY()) - y0} px`);
expect('paint events during the scroll', (await p.evaluate(() => window.__listTable.sticky.paints)) - paints0 > 3, `${(await p.evaluate(() => window.__listTable.sticky.paints)) - paints0}`);
m = await ink('#stickyCanvas', 60, 46, 200, 8);
await shot('4-sticky-scrolled');
expect('shadow under the header', (await txt('stickyOut')).includes('depth 1.00'), await txt('stickyOut'));
const row = await p.evaluate(() => { const s = document.getElementById('scroller'); const tr = [...s.querySelectorAll('tbody tr')].find((r) => r.getBoundingClientRect().top > s.getBoundingClientRect().top + 120); const r = tr.querySelector('input').getBoundingClientRect(); window.__row = tr; return { x: r.x + r.width / 2, y: r.y + r.height / 2, was: tr.querySelector('input').checked }; });
await tap(row.x, row.y);
expect('tap on a checkbox in a scrolled row', (await p.evaluate(() => window.__row.querySelector('input').checked)) !== row.was, 'toggled');
await p.selectOption('#stickyMode', 'nested');
await p.waitForTimeout(500);
await shot('4-sticky-nested');
await p.selectOption('#stickyMode', 'slice');
await p.mouse.move(c.x + 150, c.y + 200);
await p.mouse.wheel(0, 120);
await p.waitForTimeout(500);
expect('wheel scrolls the table', (await p.evaluate(() => document.getElementById('scroller').scrollTop)) > top + 60, `scrollTop ${Math.round(await p.evaluate(() => document.getElementById('scroller').scrollTop))}`);

// 5. Timeline.
await show('time');
c = await box('#timeCanvas');
await shot('5-time-start');
expect('timeline at load', (await txt('timeOut')).startsWith('Item 4 of 8: 2004'), await txt('timeOut'));
y0 = await scrollY();
await touch(line(c.x + 300, c.y + 150, c.x + 300 - 178 * 2, c.y + 156));
await p.waitForTimeout(900);
expect('sideways touch drag by two items', (await txt('timeOut')).startsWith('Item 6 of 8: 2014'), await txt('timeOut'));
expect('the page did not scroll during the drag', (await scrollY()) === y0, `${(await scrollY()) - y0} px`);
await shot('5-time-dragged');
await tap(c.x + 30, c.y + 190);
await p.waitForTimeout(900);
expect('tap on the item to the left', (await txt('timeOut')).startsWith('Item 5 of 8: 2011'), await txt('timeOut'));
await p.tap('#timeNext');
await p.waitForTimeout(900);
expect('Later button', (await txt('timeOut')).startsWith('Item 6 of 8'), await txt('timeOut'));
await p.check('#timeReversed');
await p.waitForTimeout(500);
await shot('5-time-reversed');
await p.selectOption('#timePath', 'wave');
await p.waitForTimeout(500);
await shot('5-time-wave');
await p.keyboard.press('Tab');
y0 = await scrollY();
await touch(line(c.x + 200, c.y + 250, c.x + 205, c.y + 100));
expect('a vertical swipe on the timeline scrolls the page', (await scrollY()) - y0 > 80, `${(await scrollY()) - y0} px`);

await b.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps ok');
process.exit(failed ? 1 : 0);
