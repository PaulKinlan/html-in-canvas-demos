#!/usr/bin/env node
// Drives /top-layer/ with real input at phone width and prints what each demo did.
//
//   npm run build && (cd public && python3 -m http.server 8011) &
//   node tools/top-layer/check.mjs [base URL, default http://localhost:8011] [folder for screenshots]
//
// Taps and typing go through Playwright. It prints one line per step and exits 1 if a step gave an
// unexpected result.
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
await p.goto(BASE + '/top-layer/?autochecks=0');
await p.waitForTimeout(1200);
const show = async (id) => { await p.evaluate((i) => { const c = document.querySelector(`#${i} canvas`); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 120); }, id); await p.waitForTimeout(900); };
const txt = (id) => p.evaluate((i) => document.getElementById(i).textContent, id);
const shot = async (name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const sum = (id) => p.evaluate((i) => {
  const c = document.getElementById(i);
  const copy = Object.assign(document.createElement('canvas'), { width: 64, height: 64 }), c2 = copy.getContext('2d');
  c2.drawImage(c, 0, 0, 64, 64);
  return c2.getImageData(0, 0, 64, 64).data.reduce((a, v) => a + v, 0);
}, id);

// Tooltip.
await show('tooltip');
expect('titles left on the terms after start', await p.evaluate(() => document.querySelectorAll('#tipText [title]').length), '0');
const calm = await sum('tipCanvas');
await p.tap('#tipText [data-tip]'); await p.waitForTimeout(700);
expect('tap on the first term', await txt('tipOut'), 'South-west');
report((await sum('tipCanvas')) !== calm, 'canvas with the tooltip differs', 'changed', 'a difference');
await shot('tooltip');
await p.touchscreen.tap(380, 880); await p.waitForTimeout(600);
expect('tap outside the text', await txt('tipOut'), 'No tooltip');
await p.focus('#tipText [data-tip]:nth-of-type(2)'); await p.waitForTimeout(600);
expect('keyboard focus on a term', await txt('tipOut'), 'Tooltip for');
expect('the term is described by the tooltip element', await p.evaluate(() => document.getElementById(document.activeElement.getAttribute('aria-describedby'))?.textContent), 'North-west');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
expect('Escape', await txt('tipOut'), 'No tooltip');
{
  const r = await p.evaluate(() => { const r = document.querySelector('#tipText [data-tip]').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  await p.mouse.move(r[0], r[1]); await p.waitForTimeout(600);
  expect('mouse over the first term', await txt('tipOut'), 'South-west');
  await p.mouse.move(5, 5); await p.waitForTimeout(500);
}

// Modal.
await show('modal');
const open0 = await sum('modalCanvas');
await p.tap('#mailDelete'); await p.waitForTimeout(900);
expect('after Delete selected', await txt('modalOut'), 'dialog.open true');
expect('dialog heading', await p.evaluate(() => document.querySelector('#mailDialog h3').textContent), 'Delete 2 messages?');
report((await sum('modalCanvas')) < open0 * 0.6, 'canvas is darker behind the dialog', `${open0} then ${await sum('modalCanvas')}`, 'under 60% of the sum');
expect('element at the drawn scene while the dialog is modal', await p.evaluate(() => { const r = document.getElementById('modalCanvas').getBoundingClientRect(); const e = document.elementFromPoint(r.left + 40, r.top + 30); return e?.id || e?.localName; }), 'mailDialog');
await shot('modal');
await p.touchscreen.tap(30, 150); await p.waitForTimeout(900);
expect('tap outside the dialog (closedby="any")', await txt('modalOut'), 'Closed with "cancel". 4 messages');
report(Math.abs((await sum('modalCanvas')) - open0) < open0 * 0.01, 'canvas is back to the first picture', 'same', 'within 1%');
await p.tap('#mailDelete'); await p.waitForTimeout(600);
await p.tap('#mailDialog button[value=delete]'); await p.waitForTimeout(900);
expect('after Delete in the dialog', await txt('modalOut'), 'Closed with "delete". 2 messages');
await p.tap('#mailScene li input'); await p.waitForTimeout(300);
expect('a checkbox in the scene works again after the dialog closed', await p.evaluate(() => document.querySelector('#mailScene li input').checked), 'true');

// Toasts.
await show('toasts');
for (const t of ['Buy rope', 'Check tide', 'Call harbour']) { await p.tap('#toastForm input'); await p.keyboard.type(t); await p.keyboard.press('Enter'); await p.waitForTimeout(350); }
await p.waitForTimeout(700);
expect('toasts after three saves', await p.evaluate(() => document.querySelectorAll('dialog.toast[open]').length), '3');
await shot('toasts');
await p.tap('dialog.toast:nth-of-type(2) button[value=undo]'); await p.waitForTimeout(900);
expect('Undo on the second toast', await p.evaluate(() => [...document.querySelectorAll('#toastNotes li')].map((l) => l.textContent).join(', ')), 'Buy rope, Call harbour');
expect('toasts left', await p.evaluate(() => document.querySelectorAll('dialog.toast').length), '2');
await p.tap('#toastForm button'); await p.tap('#toastForm button'); await p.tap('#toastForm button'); await p.waitForTimeout(1300);
expect('toasts after three more saves (at most 3 are kept)', await p.evaluate(() => document.querySelectorAll('dialog.toast').length), '3');
await p.tap('dialog.toast button[value=close]'); await p.waitForTimeout(800);
expect('toasts after the cross', await p.evaluate(() => document.querySelectorAll('dialog.toast').length), '2');

// A lost context: every demo shows plain HTML.
await p.evaluate(() => document.getElementById('toastCanvas').dispatchEvent(new Event('contextlost')));
await p.waitForTimeout(400);
expect('plain boxes after one contextlost event', await p.evaluate(() => document.querySelectorAll('.plain-controls').length), '3');
await p.evaluate(() => window.scrollTo(0, 0)); await shot('plain');

await b.close();
console.log(failed ? `${failed} step(s) failed` : 'all steps passed');
process.exit(failed ? 1 : 0);
