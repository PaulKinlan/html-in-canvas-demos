#!/usr/bin/env node
// Drives /media-tiles/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8011) &
//   node tools/media-tiles/check.mjs [base URL, default http://localhost:8011] [folder for screenshots]
//
// Taps go through Playwright's touch screen, hover through its mouse. Each step reads the line under
// the demo, which the paint handler writes, and some steps compare canvas pixels read from a
// drawImage() copy. It prints one line per step and exits 1 if a step gave an unexpected result.
// The images are made by tools/media-tiles/make-images.py.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }
const BASE = process.argv[2] || 'http://localhost:8011';
const SHOTS = process.argv[3] || null;
let failed = 0;
const report = (ok, what, got, want) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${got}${ok ? '' : ` (wanted ${want})`}`); };
const expect = (what, got, want) => report(String(got).includes(want), what, got, want);
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await b.newContext({ viewport: { width: 412, height: 900 }, hasTouch: true, isMobile: true, acceptDownloads: true });
const p = await ctx.newPage();
p.on('pageerror', (e) => { failed++; console.log('FAIL page error: ' + e.message); });
await p.goto(BASE + '/media-tiles/?autochecks=0');
await p.waitForTimeout(1200);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const box = (sel) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const tap = async (sel, fx = 0.5, fy = 0.5) => { const r = await box(sel); await p.touchscreen.tap(r.x + r.w * fx, r.y + r.h * fy); await p.waitForTimeout(250); };
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
// The canvas pixel under a point given in CSS pixels of the viewport, read from a drawImage() copy.
const pixelAt = (id, x, y) => p.evaluate(([i, px, py]) => {
  const c = document.getElementById(i), r = c.getBoundingClientRect(), k = c.width / c.clientWidth;
  const copy = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), c2 = copy.getContext('2d');
  c2.drawImage(c, Math.round((px - r.left) * k), Math.round((py - r.top) * k), 1, 1, 0, 0, 1, 1);
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

// Video wall.
await show('wall');
await p.waitForTimeout(2500);
await shot('wall-apart');
{
  expect('the wall draws 12 tiles', await txt('wallOut'), '12 tiles from 1 <video>');
  expect('the clip plays muted on screen', await txt('wallOut'), 'Playing');
  // Apart: the middle of the wall is a gap between two columns of tiles.
  const v = await box('#wallVideo');
  const apart = await pixelAt('wallCanvas', v.x + v.w / 2, v.y + v.h / 2);
  // A tap on the wall closes it. The tap also reaches the video, whose box is the closed wall.
  const hit = await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.id, [v.x + v.w / 2, v.y + v.h / 2]);
  expect('elementFromPoint in the middle of the closed wall', hit, 'wallVideo');
  const before = await p.evaluate(() => document.getElementById('wallVideo').paused);
  await p.touchscreen.tap(v.x + v.w / 2, v.y + v.h / 2);
  await p.waitForTimeout(1300);
  const closed = await pixelAt('wallCanvas', v.x + v.w / 2, v.y + v.h / 2);
  report(apart[0] + apart[1] + apart[2] < 60 && closed[0] + closed[1] + closed[2] > 60, 'middle of the wall: a gap while apart, video after a tap closed it', `${apart.slice(0, 3)} then ${closed.slice(0, 3)}`, 'dark then not dark');
  await shot('wall-closed');
  const after = await p.evaluate(() => document.getElementById('wallVideo').paused);
  console.log(`info a touch tap on the closed wall: paused was ${before}, is ${after}`);
  // The page's own button pauses. Closed and paused, the wall asks for no frames.
  if (!after) await tap('#wallPlay');
  expect('after Pause', await txt('wallOut'), 'Paused');
  await tap('#wallApart');
  await p.waitForTimeout(1500);
  const n1 = num(await txt('wallOut'), /Paint events: (\d+)/);
  await p.waitForTimeout(700);
  const n2 = num(await txt('wallOut'), /Paint events: (\d+)/);
  report(n2 - n1 <= 2, 'paint events in 0.7 s with the wall closed and the video paused', n2 - n1, 'at most 2');
  // The grid.
  await p.selectOption('#wallGrid', '6 by 4'); await p.waitForTimeout(300);
  await tap('#wallBurst'); await p.waitForTimeout(700);
  expect('grid 6 by 4', await txt('wallOut'), '24 tiles');
  await shot('wall-burst');
  await p.selectOption('#wallGrid', '4 by 3');
}

// Figure with a live caption.
await show('caption');
{
  const sums = {};
  for (const name of ['ripple', 'duotone', 'dots', 'slats']) {
    await tap(`[data-cap="${name}"]`); await p.waitForTimeout(350);
    sums[name] = await sum('capCanvas');
    expect(`effect ${name}`, await txt('capOut'), `Effect "${name}"`);
    await shot(`caption-${name}`);
  }
  report(new Set(Object.values(sums)).size === 4, 'the four effects give four different pictures', Object.values(sums).join(' '), 'four different sums');
  // The caption is text: the link is found at its drawn place, and typing changes the words.
  const link = await box('#capText a');
  expect('elementFromPoint on the drawn link', await p.evaluate(([x, y]) => document.elementFromPoint(x, y)?.localName, [link.x + link.w / 2, link.y + link.h / 2]), 'a');
  const cap = await box('#capText'), cv = await box('#capCanvas');
  report(cap.y > cv.y + 100 && cap.y + cap.h < cv.y + cv.h, 'the caption is reported over the bottom of the image', `${Math.round(cap.y - cv.y)} px down`, 'inside the canvas, over the image');
  await tap('#capText span', 0.9, 0.5);
  await p.keyboard.type(' Live', { delay: 40 });
  await p.waitForTimeout(200);
  expect('typed into the caption', await p.evaluate(() => document.querySelector('#capText span').textContent), 'Live');
  await shot('caption-typed');
  await p.evaluate(() => document.activeElement?.blur());
  await tap('[data-cap="ripple"]');
}

// Resolution chosen by drawn size.
await show('sizes');
{
  const first = await txt('resOut');
  console.log('info at rest: ' + first.replace(/ Paint events.*/, ''));
  await shot('sizes-small');
  await tap('#resNear'); await p.waitForTimeout(3600);
  const near = await txt('resOut');
  expect('after the walk up', near, 'currentSrc: 1280w');
  console.log('info ' + near.match(/Files fetched, in order: [^.]*/)?.[0]);
  await shot('sizes-near');
  await tap('#resFar'); await p.waitForTimeout(3600);
  const far = await txt('resOut');
  console.log('info after stepping back: ' + far.match(/currentSrc: [^.]*/)?.[0]);
  await shot('sizes-back');
  // New URLs and one write of sizes at the end of the walk: one more file.
  await tap('#resDuring');
  await tap('#resAgain'); await p.waitForTimeout(900);
  const again = await txt('resOut');
  console.log('info after new URLs: ' + again.match(/currentSrc: [^.]*\. Files fetched, in order: [^.]*/)?.[0]);
  await tap('#resNear'); await p.waitForTimeout(3800);
  const once = (await txt('resOut')).match(/Files fetched, in order: ([^.]*)/)?.[1] ?? '';
  report(once.split(', ').length === 2 && once.endsWith('1280w'), 'files fetched when sizes is written once, after the walk', once, 'the first file, then 1280w');
  await tap('#resDuring'); await tap('#resFar');
}

// SVG chart.
await show('chart');
{
  // Hover with a mouse. The sheet stops swaying while the mouse is over the canvas.
  const cv = await box('#svgCanvas');
  await p.mouse.move(cv.x + 20, cv.y + 20); await p.waitForTimeout(700);
  const bar = await box('#svgBox a[data-key="thu"] rect');
  await p.mouse.move(bar.x + bar.w / 2, bar.y + bar.h / 2, { steps: 4 }); await p.waitForTimeout(500);
  const hot = await pixelAt('svgCanvas', bar.x + bar.w / 2, bar.y + bar.h * 0.7);
  report(hot[0] > 180 && hot[2] < 90, 'pixel of the hovered bar (its own :hover style)', hot.slice(0, 3), 'orange');
  expect('the paint handler saw :hover', await txt('svgOut'), ':hover in the paint handler: 1');
  await shot('chart-hover');
  await p.mouse.move(cv.x + 5, cv.y + 5); await p.mouse.move(2, 300); await p.waitForTimeout(400);
  // A tap follows the link. The page must not scroll.
  const y0 = await p.evaluate(() => scrollY);
  const tue = await box('#svgBox a[data-key="tue"] rect');
  await p.touchscreen.tap(tue.x + tue.w / 2, tue.y + tue.h / 2); await p.waitForTimeout(600);
  expect('location.hash after a tap on Tue', await p.evaluate(() => location.hash), '#bar=tue');
  report(await p.evaluate(() => scrollY) === y0, 'the page did not scroll', await p.evaluate(() => scrollY), y0);
  expect('class on the tapped bar', await p.evaluate(() => document.querySelector('#svgBox a.on')?.dataset.key), 'tue');
  await shot('chart-tapped');
  // New values: the transition raises paint and the label changes.
  const old = await p.evaluate(() => document.querySelector('#svgBox a[data-key="mon"] text').textContent);
  await tap('#svgData'); await p.waitForTimeout(900);
  console.log(`info New values: Mon ${old} then ${await p.evaluate(() => document.querySelector('#svgBox a[data-key="mon"] text').textContent)}`);
  // A sideways drag turns the sheet, and the click at the end of the drag does not follow a link.
  {
    const turn0 = num(await txt('svgOut'), /Turn (-?\d+)/), hash0 = await p.evaluate(() => location.hash);
    const wed = await box('#svgBox a[data-key="wed"] rect');
    await p.mouse.move(wed.x + wed.w / 2, wed.y + wed.h / 2); await p.mouse.down();
    await p.mouse.move(wed.x + wed.w / 2 + 90, wed.y + wed.h / 2, { steps: 6 }); await p.waitForTimeout(500); await p.mouse.up();
    await p.waitForTimeout(300);
    const turn1 = num(await txt('svgOut'), /Turn (-?\d+)/);
    report(turn1 - turn0 > 15, 'a 90 px drag to the right turned the sheet', `${turn0}° then ${turn1}°`, 'more than 15° further');
    report(await p.evaluate(() => location.hash) === hash0, 'the drag did not follow the link under the pointer', await p.evaluate(() => location.hash), hash0);
    await p.mouse.move(2, 300);
  }
  await p.evaluate(() => { document.getElementById('svgTilt').value = 60; document.getElementById('svgTilt').dispatchEvent(new Event('input')); });
  await shot('chart-tilt-60');
}

// Chart and legend as one picture.
await show('export');
{
  const before = await txt('expOut');
  await tap('#expLegend li:nth-child(2) input'); await p.waitForTimeout(900);
  expect('Links is unticked', await p.evaluate(() => document.querySelector('#expLegend li:nth-child(2) input').checked), 'false');
  const now = await txt('expOut');
  report(num(now, /redrawn (\d+)/) > num(before, /redrawn (\d+)/), 'the inner chart was redrawn after the checkbox changed', `${num(before, /redrawn (\d+)/)} then ${num(now, /redrawn (\d+)/)}`, 'more redraws');
  expect('share of Search with Links out', await p.evaluate(() => document.querySelector('#expLegend li:nth-child(1) b').textContent), '57%');
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), tap('#expSave')]);
  await p.waitForTimeout(700);
  expect('download', download ? download.suggestedFilename() : 'no download', 'chart-and-legend.png');
  expect('the line under the demo', await txt('expOut'), 'Last export: PNG');
  const info = await p.evaluate(async () => {
    const img = document.getElementById('expShot'); await img.decode();
    const c = document.getElementById('expCanvas'), f = document.getElementById('expChart').getBoundingClientRect(), r = c.getBoundingClientRect(), k = img.naturalWidth / r.width;
    const copy = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }), g = copy.getContext('2d');
    // A pixel of the ring (blue, at 3 o'clock) and a pixel of the first legend swatch, in the exported file.
    const at = (x, y) => { g.clearRect(0, 0, 1, 1); g.drawImage(img, Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1, 0, 0, 1, 1); return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3); };
    const sw = document.querySelector('#expLegend i').getBoundingClientRect();
    return { w: img.naturalWidth, h: img.naturalHeight, cw: c.width, ch: c.height, ring: at(f.right - 14, f.top + f.height / 2), swatch: at(sw.left + 6, sw.top + 6) };
  });
  report(info.w === info.cw && info.h === info.ch, 'the PNG is the size of the outer canvas', `${info.w} by ${info.h}`, `${info.cw} by ${info.ch}`);
  report(info.ring[2] > 150 && info.ring[0] < 100, 'the ring drawn by the inner canvas is in the PNG', info.ring, 'blue');
  report(info.swatch[2] > 150 && info.swatch[0] < 100, 'the HTML legend swatch is in the PNG', info.swatch, 'blue');
  await shot('export-saved');
}

// A lost context: every demo shows its elements as plain HTML. The event is dispatched, never forced.
{
  await p.evaluate(() => document.getElementById('capCanvas').dispatchEvent(new Event('contextlost')));
  await p.waitForTimeout(400);
  const plain = await p.evaluate(() => ({ boxes: document.querySelectorAll('.plain-controls').length, shown: document.querySelectorAll('canvas.idea-canvas:not([hidden])').length, video: !!document.querySelector('.plain-controls #wallVideo'), svg: !!document.querySelector('.plain-controls #svgBox svg') }));
  report(plain.boxes === 5 && plain.shown === 0 && plain.video && plain.svg, 'after a dispatched contextlost event', JSON.stringify(plain), '5 plain boxes, no canvas shown');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(300);
  await shot('plain');
}
await b.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
