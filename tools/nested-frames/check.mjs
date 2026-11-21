#!/usr/bin/env node
// Drives /nested-frames/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8011) &
//   node tools/nested-frames/check.mjs [base URL, default http://localhost:8011] [folder for screenshots]
//
// Taps and typing go through Playwright, drags through CDP touch events. Each step reads the line under
// the demo or the state of the control that was pressed. It prints one line per step and exits 1 if a
// step gave an unexpected result.
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
await p.goto(BASE + '/nested-frames/?autochecks=0');
await p.waitForTimeout(1200);
const cdp = await ctx.newCDPSession(p);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas, #${i} effect-frame`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 70); }, id); await p.waitForTimeout(1000); };
// The box of an element as the browser reports it. For an element drawn in a canvas this is the drawn place.
const box = (sel) => p.evaluate((s) => { let el = document; for (const part of s.split(' >>> ')) el = (el.shadowRoot ?? el).querySelector(part); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel);
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const tapAt = async (x, y) => { await p.touchscreen.tap(x, y); await p.waitForTimeout(300); };
const tap = async (sel) => { const r = await box(sel); await tapAt(r.x + r.w / 2, r.y + r.h / 2); };
const drag = async (x0, y0, x1, y1) => {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8 }] }); await p.waitForTimeout(30); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(500);
};
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const num = (text, re) => Number(text.match(re)?.[1] ?? NaN);

// Widget in a scene.
await show('widget');
await tap('#padCard button[data-step="1"]');
await shot('widget-split');
await tap('#padCard button[data-step="1"]');
expect('two taps on + in the counter, two canvases down', await txt('padCount'), '2');
await p.waitForTimeout(900);
expect('what raised the scene\'s last paint', await txt('widgetOut'), '#padCanvas in changedElements');
{
  const r = await box('#dialRange');
  await drag(r.x + r.w * 0.4, r.y + r.h / 2, r.x + r.w * 0.9, r.y + r.h / 2 + 4);
  const v = Number(await p.evaluate(() => document.getElementById('dialRange').value));
  report(v > 70, 'the lamp\'s range after a touch drag to 90% of its drawn width', v, 'more than 70');
  expect('the lamp\'s output', await txt('dialValue'), `${v}%`);
  await shot('widget-bright');
  await tap('#dialOff');
  expect('the range after a tap on Off', await p.evaluate(() => document.getElementById('dialRange').value), '0');
  await p.waitForTimeout(700);
  const a = num(await txt('widgetOut'), /scene (\d+)/);
  await p.waitForTimeout(700);
  report(num(await txt('widgetOut'), /scene (\d+)/) === a, 'scene paints in 0.7 s at rest', num(await txt('widgetOut'), /scene (\d+)/) - a, '0');
}

expect('the route the page chose', await txt('widgetOut'), 'Route: nested (');
await tap('#widgetRoute');
await p.waitForTimeout(600);
await tap('#padCard button[data-step="1"]');
expect('a tap on + with the cards drawn by the scene itself', await txt('padCount'), '3');
expect('the route after the button', await txt('widgetOut'), 'Route: flat, chosen with the button');
await shot('widget-flat');
await tap('#widgetRoute');
await p.waitForTimeout(600);
await tap('#padCard button[data-step="1"]');
expect('a tap on + back on the inner canvases', await txt('padCount'), '4');

// Email on a drawn phone.
await show('mail');
// A point of the iframe's document, given in the iframe's own CSS pixels, as a point of the window.
const inMail = (sel) => p.evaluate((s) => {
  const canvas = document.getElementById('mailCanvas'), frame = document.getElementById('mailFrame');
  const el = frame.contentDocument.querySelector(s), r = el.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  const fw = frame.offsetWidth, fh = frame.offsetHeight, land = fw > fh;
  const k = Math.min(1, (c.width - 20) / (land ? 468 : 260), (c.height - 20) / (land ? 260 : 468));
  return { x: c.x + c.width / 2 + k * (r.x + r.width / 2 - fw / 2), y: c.y + c.height / 2 + k * (r.y + r.height / 2 - fh / 2), inView: r.y >= 0 && r.bottom <= fh };
}, sel);
{
  let at = await inMail('a[href="#track"]');
  await tapAt(at.x, at.y);
  expect('tap on a link inside the iframe', await txt('mailOut'), 'Tracking opened');
  const y0 = await p.evaluate(() => scrollY);
  await drag(at.x, at.y, at.x, at.y - 160);
  const scrolled = await p.evaluate(() => document.getElementById('mailFrame').contentWindow.scrollY);
  report(scrolled > 60, 'the iframe\'s scroll offset after a touch drag of 160 px on the drawn screen', scrolled, 'more than 60');
  report(await p.evaluate(() => scrollY) === y0, 'the page stayed where it was during that drag', await p.evaluate(() => scrollY) - y0, '0');
  expect('the line under the demo', await txt('mailOut'), `scrolled ${Math.round(scrolled)} px`);
  await shot('mail-scrolled');
  await tap('#mailTurn');
  await p.waitForTimeout(1000);
  expect('the iframe after Turn the phone', await txt('mailOut'), '420 by 236');
  await p.evaluate(() => document.getElementById('mailFrame').contentWindow.scrollTo(0, 0));
  await p.waitForTimeout(300);
  const cols = await p.evaluate(() => getComputedStyle(document.getElementById('mailFrame').contentDocument.querySelector('.body')).gridTemplateColumns.split(' ').length);
  report(cols === 2, 'columns in the message at 420 px', cols, '2');
  await shot('mail-turned');
  at = await inMail('a[href="#return"]');
  if (!at.inView) { await p.evaluate(() => document.getElementById('mailFrame').contentDocument.querySelector('a[href="#return"]').scrollIntoView({ block: 'center' })); await p.waitForTimeout(400); at = await inMail('a[href="#return"]'); }
  await tapAt(at.x, at.y);
  expect('tap on a link with the phone turned', await txt('mailOut'), 'Return started');
  await tap('[data-mail="news"]');
  await p.waitForTimeout(1000);
  expect('the message after Newsletter', await p.evaluate(() => document.getElementById('mailFrame').contentDocument.querySelector('.head b').textContent), 'Three things');
  await tap('#mailTurn');
  await p.waitForTimeout(1000);
}

// Effect as a custom element.
await show('element');
for (const effect of ['glass', 'wave', 'melt', 'blinds']) {
  await tap(`[data-effect="${effect}"]`);
  await p.waitForTimeout(400);
  const want = effect === 'glass' ? 2 : effect === 'wave' ? 3 : effect === 'melt' ? 5 : 1;
  await tap(`tap-rating >>> button[value="${want}"]`);
  expect(`stars after a tap on star ${want} through effect="${effect}"`, await p.evaluate(() => document.querySelector('tap-rating').value), String(want));
  if (effect === 'melt') await shot('element-melt');
  if (effect === 'blinds') await shot('element-blinds');
}
await tap('[data-effect="glass"]');
await tap('#fxForm input[name="name"]');
await p.keyboard.type(' L', { delay: 50 });
expect('typed in the name field', await p.evaluate(() => document.querySelector('#fxForm input[name="name"]').value), 'Ada L');
await shot('element-glass');
await tap('#fxForm > button');
expect('the form\'s output after a tap on Send', await p.evaluate(() => document.querySelector('#fxForm output').value), 'Sent: Ada L, 1 of 5, would open it again');
expect('drawable attributes in the page\'s form', await txt('fxOut'), 'has 0 elements');

// Button in an SVG diagram.
await show('diagram');
{
  const sent = num(await txt('diagramOut'), /sent: (\d+)/);
  await tap('#nodeSend');
  await p.waitForTimeout(300);
  const now = num(await txt('diagramOut'), /sent: (\d+)/);
  report(now >= sent + 5, 'lights sent after a tap on the button in the foreignObject', now - sent, '5 or more');
  await tap('#nodeDetour');
  await p.waitForTimeout(300);
  expect('route after a tap on the checkbox', await txt('diagramOut'), 'the long edge');
  await tap('#diagramTilt');
  await p.waitForTimeout(900);
  await shot('diagram-tilted');
  const before = num(await txt('diagramOut'), /sent: (\d+)/);
  await tap('#nodeSend');
  await p.waitForTimeout(300);
  report(num(await txt('diagramOut'), /sent: (\d+)/) >= before + 5, 'lights sent after a tap on the button with the diagram tilted', num(await txt('diagramOut'), /sent: (\d+)/) - before, '5 or more');
  const r = await box('#nodeSize');
  await drag(r.x + r.w * 0.3, r.y + r.h / 2, r.x + r.w * 0.95, r.y + r.h / 2 + 3);
  const v = Number(await p.evaluate(() => document.getElementById('nodeSize').value));
  report(v > 2, 'the range in the tilted diagram after a touch drag', v, 'more than 2');
  await p.waitForTimeout(2500);
  const arrived = Number(await p.evaluate(() => document.getElementById('nodeArrived').value));
  report(arrived > 0, 'the output element in the last node', arrived, 'more than 0');
}

// Script that shows itself.
await show('self');
{
  expect('the script at load', await txt('selfOut'), 'has run 1 time');
  const r = await box('#selfScript');
  await tapAt(r.x + 60, r.y + 20);
  await p.keyboard.type('X', { delay: 30 });
  const typed = await p.evaluate(() => document.getElementById('selfScript').textContent.includes('X'));
  report(typed, 'a letter typed into the script element after a tap on it', typed, 'true');
  await p.evaluate(() => { const s = document.getElementById('selfScript'); s.textContent = s.textContent.replace('X', '').replace('WEDGES = 8', 'WEDGES = 5'); });
  // Typing can scroll the caret into view. Wait for the page to settle before measuring the button.
  await p.waitForTimeout(700);
  console.log(`     page scroll after typing: ${await p.evaluate(() => Math.round(scrollY))} px, focus in ${await p.evaluate(() => document.activeElement?.id || document.activeElement?.localName)}`);
  await tap('#selfRun');
  await p.waitForTimeout(500);
  expect('after Run the edited script', await txt('selfOut'), 'has run 2 times');
  await shot('self-five');
  await p.evaluate(() => { const s = document.getElementById('selfScript'); s.textContent = s.textContent.replace('ctx.clip();', 'ctx.clip(;'); });
  await tap('#selfRun');
  await p.waitForTimeout(500);
  expect('after running text with a syntax error', await txt('selfOut'), 'The script stopped');
  await tap('#selfReset');
  await p.waitForTimeout(500);
  expect('after Put the original back', await txt('selfOut'), 'has run 3 times');
}

console.log(failed ? `${failed} step${failed === 1 ? '' : 's'} failed` : 'all steps gave the expected result');
await b.close();
process.exit(failed ? 1 : 0);
