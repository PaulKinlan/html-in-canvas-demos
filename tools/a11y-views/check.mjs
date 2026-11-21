#!/usr/bin/env node
// Drives /a11y-views/ with real input at phone width and prints what the page did.
//
//   npm run build && (cd public && python3 -m http.server 8011) &
//   node tools/a11y-views/check.mjs [base URL, default http://localhost:8011] [folder for screenshots]
//
// Key presses and taps go through Playwright, a finger drag through CDP touch events. Each step reads
// window.__a11yViews, which the two paint handlers write, or the line under a picture. Canvas pixels
// are read from a drawImage() copy. It prints one line per step and exits 1 if a step gave an
// unexpected result.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const BASE = process.argv[2] || 'http://localhost:8011';
const SHOTS = process.argv[3] || null;
let failed = 0;
const report = (ok, what, got, want) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : ` (wanted ${want})`}`); };
const note = (what, got) => console.log(`note ${what}: ${got}`);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
await p.goto(BASE + '/a11y-views/?autochecks=0');
await p.waitForTimeout(1500);
const cdp = await ctx.newCDPSession(p);
const show = async (sel) => { await p.evaluate((s) => window.scrollTo(0, document.querySelector(s).getBoundingClientRect().top + scrollY - 70), sel); await p.waitForTimeout(700); };
const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const tap = async (sel) => { const r = await box(sel); await p.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2); await p.waitForTimeout(300); };
const views = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__a11yViews)));
const active = () => p.evaluate(() => document.activeElement?.id || document.activeElement?.localName);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
// The canvas pixel at a point given in viewport pixels, read from a drawImage() copy.
const pixel = (id, vx, vy) => p.evaluate(([i, x, y]) => {
  const c = document.getElementById(i), o = c.getBoundingClientRect(), k = c.width / c.clientWidth;
  const copy = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), c2 = copy.getContext('2d');
  c2.drawImage(c, Math.round((x - o.left) * k), Math.round((y - o.top) * k), 1, 1, 0, 0, 1, 1);
  return [...c2.getImageData(0, 0, 1, 1).data];
}, [id, vx, vy]);
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);

// ---- the form
await show('#formCanvas');
await tap('#name');
let v = await views();
report(v.form.active === 'name' && (await active()) === 'name', 'touch tap on the drawn Name field', `focus on ${await active()}, focusin events ${v.form.moves}`, 'focus on name');
const y0 = await p.evaluate(() => scrollY);
const seen = [];
for (let i = 0; i < 3; i++) {
  await p.keyboard.press('Tab');
  if (i === 1) { await p.waitForTimeout(140); await shot('trail-in-flight'); }
  await p.waitForTimeout(900);
  v = await views();
  seen.push(`${v.form.active} ${Math.round(v.form.distance)} px`);
}
report(seen.map((s) => s.split(' ')[0]).join(' ') === 'email phone country', 'three Tab presses from Name', seen.join(', '), 'email phone country');
report((await p.evaluate(() => scrollY)) === y0, 'the page did not scroll while focus moved', `scrollY ${await p.evaluate(() => scrollY)}`, `scrollY ${y0}`);
{
  // At rest the ring is 4 px outside the focused control: blue over white.
  const r = await box('#country');
  const px = await pixel('formCanvas', r.x - 4, r.y + r.h / 2);
  report(px[2] > 180 && px[0] < 120, 'ring pixel 4 px left of the focused select', px.join(' '), 'blue');
  const shade = await pixel('formCanvas', (await box('#name')).x + 20, (await box('#name')).y + 20);
  report(shade[0] < 200, 'a pixel inside the Name field is shaded while focus is elsewhere', shade.join(' '), 'darker than white');
}
await tap('#send');
v = await views();
report(v.form.active === 'send', 'touch tap on the drawn Order button moves focus and the trail', `focus on ${v.form.active}, moved ${Math.round(v.form.distance)} px`, 'send');
await tap('#next');
await p.waitForTimeout(700);
v = await views();
report(v.form.active === 'orders' && (await active()) === 'orders', '"Next stop" from the last stop', `focus on ${await active()}`, 'orders');
await p.evaluate(() => document.activeElement.blur());
await p.check('#showTargets');
await p.waitForTimeout(400);
const full = await txt('trailOut');
await shot('target-sizes');
await p.selectOption('#size', '0.6');
await p.waitForTimeout(400);
const small = await txt('trailOut');
await shot('target-sizes-60');
report(num(small, /under 24 px: (\d+)/) > num(full, /under 24 px: (\d+)/), 'more targets are under 24 px when the form is drawn at 60%', `${num(full, /under 24 px: (\d+)/)} at 100%, ${num(small, /under 24 px: (\d+)/)} at 60%`, 'an increase');
note('targets at 100%', full.split('\n').find((l) => l.startsWith('Targets')));
note('targets at 60%', small.split('\n').find((l) => l.startsWith('Targets')));
await tap('#send');
v = await views();
report(v.form.active === 'send', 'touch tap on Order while the form is drawn at 60%', `focus on ${v.form.active}`, 'send');
await p.evaluate(() => document.activeElement.blur());
await p.selectOption('#size', '1');
await p.uncheck('#showTargets');
await p.check('#showLabels');
await p.waitForTimeout(400);
await shot('label-lines');
const labels = (await txt('trailOut')).split('\n').find((l) => l.startsWith('Controls'));
report(/With a label: 3\. aria-label only: 1\. Placeholder only: 1\. No name: 1\. Labels with no control: 1\./.test(labels), 'label view', labels, '3 labelled, 1 aria-label, 1 placeholder, 1 none, 1 orphan');
await p.uncheck('#showLabels');

// ---- the article and its outline
await show('#reader');
await shot('outline');
v = await views();
report(v.doc.headings.length === 10 && v.doc.rows === 10, 'headings collected', `${v.doc.headings.length} headings, ${v.doc.rows} rows`, '10 and 10');
{
  // A finger drag on the drawn article scrolls the container, not the page.
  const r = await box('#reader'), x = r.x + 80, y = r.y + 400, yPage = await p.evaluate(() => scrollY);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - i * 25 }] }); await p.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(900);
  const top = await p.evaluate(() => document.getElementById('reader').scrollTop);
  v = await views();
  report(top > 100 && Math.abs(v.doc.top - top) < 2, 'finger drag of 250 px on the drawn article', `scrollTop ${Math.round(top)}, drawn at ${Math.round(v.doc.top)}, page moved ${(await p.evaluate(() => scrollY)) - yPage} px`, 'scrollTop over 100');
  await shot('outline-scrolled');
}
{
  // Tap the row for "Elements that count".
  const yPage = await p.evaluate(() => scrollY);
  const r = await p.evaluate(() => { const a = document.querySelectorAll('#tocList a')[7].getBoundingClientRect(); return { x: a.x + a.width / 2, y: a.y + a.height / 2 }; });
  await p.touchscreen.tap(r.x, r.y);
  await p.waitForTimeout(180);
  await shot('outline-jump');
  await p.waitForTimeout(1300);
  v = await views();
  const where = await p.evaluate(() => { const h = document.activeElement.getBoundingClientRect(), c = document.getElementById('docCanvas').getBoundingClientRect(); return `${document.activeElement.textContent.trim()} at ${Math.round(h.top - c.top)} px in the canvas`; });
  report(/^Elements that count at \d\d? px/.test(where) && v.doc.current === 7, 'tap on row 8 of the outline', `focus on ${where}, current row ${v.doc.current + 1}, page moved ${(await p.evaluate(() => scrollY)) - yPage} px`, 'the heading near the top');
}
{
  // Tab from before the canvas reaches the first link of the article, which is out of view at scrollTop 0.
  await p.evaluate(() => { document.activeElement.blur(); document.getElementById('reader').scrollTop = 0; });
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#trail details.show-code > summary').focus({ preventScroll: true }));
  const yPage = await p.evaluate(() => scrollY);
  await p.keyboard.press('Tab');
  await p.waitForTimeout(1400);
  const got = await p.evaluate(() => { const a = document.activeElement, r = a.getBoundingClientRect(), c = document.getElementById('docCanvas').getBoundingClientRect(); return { text: a.textContent.trim(), y: Math.round(r.top - c.top), top: Math.round(document.getElementById('reader').scrollTop), page: scrollY }; });
  report(got.text === 'Listing every heading' && got.y > 0 && got.y < 500, 'Tab into the article reaches a link that was out of view', `focus on "${got.text}" at ${got.y} px in the canvas, container scrolled to ${got.top}, page moved ${got.page - yPage} px`, 'the link inside the canvas');
  await shot('outline-tab');
}
await p.evaluate(() => document.activeElement.blur());
await p.selectOption('#skipLevel', 'h5');
await p.waitForTimeout(400);
v = await views();
report(v.doc.skipped === 1 && v.doc.headings[3] === '5! Skipped levels', 'the heading changed to an h5', `${v.doc.headings[3]}, skipped ${v.doc.skipped}`, '5! Skipped levels');
await p.evaluate(() => { document.getElementById('reader').scrollTop = 0; });
await p.fill('#rename', 'Levels');
await p.waitForTimeout(400);
v = await views();
report(v.doc.headings[1] === '2 Levels', 'typing in "Second heading" changes the heading and its link', `${v.doc.headings[1]}; link text "${await p.evaluate(() => document.querySelectorAll('#tocList a')[1].textContent)}"`, '2 Levels');
{
  // The row is the article's pixels: somewhere along the middle of row 2 there is a pixel of the article's paper colour.
  const r = await p.evaluate(() => { const a = document.querySelectorAll('#tocList a')[1].getBoundingClientRect(); return { x: a.x, y: a.y + a.height / 2, w: a.width }; });
  let paper = 0;
  for (let x = r.x + 4; x < r.x + r.w - 30; x += 3) { const px = await pixel('docCanvas', x, r.y); if (px[0] > 225 && px[1] > 225 && px[2] > 215) paper++; }
  report(paper > 3, 'row 2 of the rail holds pixels of the article', `${paper} samples in the paper colour`, 'more than 3');
}
await tap('#addSection');
v = await views();
report(v.doc.headings.length === 11, '"Add a section"', `${v.doc.headings.length} headings`, '11');
await shot('outline-skipped');
await b.close();
console.log(failed ? `${failed} step${failed === 1 ? '' : 's'} failed` : 'all steps gave the expected result');
process.exit(failed ? 1 : 0);
