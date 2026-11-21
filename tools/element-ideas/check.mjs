#!/usr/bin/env node
// Drives every demo on /element-ideas/ with real mouse and keyboard input and reports what happened.
//
//   npm run check:ideas            all demos, at 412 px wide
//   npm run check:ideas -- wheel   only the demos named
//
// Serves public/ on port 8003. Needs Playwright with Chromium.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

const TYPES = { html: 'text/html', js: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', webm: 'video/webm', vtt: 'text/vtt' };
const server = createServer(async (req, res) => {
  let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (file.endsWith(path.sep)) file += 'index.html';
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()] ?? 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(8003);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 412, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8003/element-ideas/');

const wait = (ms) => page.waitForTimeout(ms);
const js = (fn, arg) => page.evaluate(fn, arg);
// The middle of an element's box as the browser reports it, which is where the canvas drew it.
const mid = (selector, fx = 0.5, fy = 0.5) => js(([s, fx, fy]) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width * fx, y: r.y + r.height * fy }; }, [selector, fx, fy]);
const click = async (selector, fx, fy) => { const p = await mid(selector, fx, fy); await page.mouse.move(p.x - 30, p.y - 30); await page.mouse.click(p.x, p.y); };
const show = async (id) => { await js((id) => document.getElementById(id).scrollIntoView({ block: 'center' }), id); await wait(700); };

const TESTS = {
  async wheel() {
    await click('#wheelSelect option:nth-child(4)');
    const picked = await js(() => [...wheelSelect.selectedOptions].map((o) => o.text).join());
    await page.mouse.wheel(0, 100); await page.mouse.wheel(0, 100); await wait(700);
    const p = await mid('#wheelCanvas');
    const front = await js(([x, y]) => document.elementFromPoint(x, y)?.textContent, [p.x, p.y]);
    return [picked === 'Chilli' && front !== 'Chilli', `clicked option 4: selected "${picked}"; after two wheel steps the option at the front is "${front}"`];
  },
  async desk() {
    const p = await mid('#deskCanvas input');
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.mouse.move(p.x, p.y - 60, { steps: 6 }); await page.mouse.up();
    const up = +(await js(() => document.querySelector('#deskCanvas input').value));
    return [up > 75, `dragged the first fader up 60 px from the middle: value ${up}`];
  },
  async sequencer() {
    await click('#seqForm fieldset:nth-of-type(2) input:nth-of-type(2)');
    const on = await js(() => seqForm.elements.snare[1].checked);
    await click('#seqForm button[type=reset]'); await wait(100);
    const after = await js(() => seqForm.elements.snare[1].checked);
    return [on && !after, `tap on snare step 2 checked it: ${on}; Clear restored it: ${!after}; ${await js(() => seqOut.textContent)}`];
  },
  async crt() {
    await click('#crtText', 0.5, 0.9);
    await page.keyboard.type('LIST');
    const v = await js(() => crtText.value);
    return [v.endsWith('LIST'), `clicked the screen and typed: value ends "${v.slice(-8).replace(/\n/g, '\\n')}"`];
  },
  async dialog() {
    await click('#dialogOpen'); await wait(500);
    const open = await js(() => [dialogBox.open, dialogPage.inert, document.activeElement?.value]);
    await click('#dialogBox button[value=delete]'); await wait(600);
    const left = await js(() => [dialogPage.querySelectorAll('li').length, dialogBox.returnValue, document.activeElement?.id]);
    return [open[0] && open[1] && left[0] === 2 && left[1] === 'delete', `open ${open[0]}, page inert ${open[1]}, focus on "${open[2]}"; after Delete: ${left[0]} files left, returnValue "${left[1]}", focus on #${left[2]}`];
  },
  async callouts() {
    const read = () => js(() => { const b = document.querySelector('button.spot').getBoundingClientRect(), p = callA.getBoundingClientRect(); return { open: callA.matches(':popover-open'), bx: b.x + b.width / 2, by: b.y, px: p.x + p.width / 2, py: p.bottom }; });
    const a = await read(); await wait(900); const b = await read();
    const follows = Math.abs(b.px - b.bx) < 3 && Math.abs(b.by - b.py - 8) < 3;
    return [a.open && follows && Math.hypot(a.bx - b.bx, a.by - b.by) > 2, `popover open ${a.open}; button moved ${Math.hypot(a.bx - b.bx, a.by - b.by).toFixed(1)} px in 0.9 s; popover is ${(b.px - b.bx).toFixed(1)} px off centre and ${(b.by - b.py).toFixed(1)} px above the button`];
  },
  async inert() {
    await click('#inertCanvas .panel:nth-of-type(1) button'); await wait(300);
    const withInert = await js(() => inertOut.textContent);
    await js(() => inertOn.click()); await wait(300);
    const without = await js(() => inertOut.textContent);
    await js(() => inertOn.click());
    return [/not drawn: 0\..*nothing/.test(withInert) && /not drawn: 4\..*panel 1/.test(without), `with inert: "${withInert}" without: "${without}"`];
  },
  async find() {
    await click('#findForm button'); await wait(1500);
    const a = await js(() => [findView.scrollLeft, findView.scrollTop, findOut.textContent, String(getSelection())]);
    await js(() => { findForm.elements.word.value = 'tide table'; }); await click('#findForm button'); await wait(1500);
    const b = await js(() => [findView.scrollLeft, findView.scrollTop, findOut.textContent]);
    return [a[0] === 300 && a[1] === 0 && b[0] === 0 && b[1] === 0, `"lighthouse": view scrolled to ${a[0]},${a[1]} (${a[2]}), selection "${a[3]}"; "tide table": ${b[0]},${b[1]} (${b[2]})`];
  },
  async math() {
    const before = await js(() => { const r = document.querySelector('#mathCanvas .step:nth-child(2) [data-k=b]').getBoundingClientRect(); return r.width; });
    await click('#mathNext'); await wait(1200);
    const p = await mid('#mathCanvas .step:nth-child(2) [data-k=b]');
    const hit = await js(([x, y]) => document.elementFromPoint(x, y)?.closest('.step') === document.querySelectorAll('#mathCanvas .step')[1], [p.x, p.y]);
    return [hit && before > 0, `after Next, line 2 is the element under its own "3": ${hit}; ${await js(() => mathOut.textContent)}`];
  },
  async tv() {
    await click('#tvVideo', 0.07, 0.8); await wait(800);
    const s = await js(() => [tvVideo.paused, tvVideo.currentTime, tvVideo.textTracks[0]?.mode]);
    await js(() => tvVideo.pause());
    return [!s[0] && s[1] > 0, `clicked the play control: paused ${s[0]}, currentTime ${s[1].toFixed(2)}, captions ${s[2]}`];
  },
  async plan() {
    // The middle of the living room: image point (215, 60) through translate, scale(1, 0.5), rotate(45deg).
    const p = await js(() => { const c = planCanvas.getBoundingClientRect(), k = Math.min(1, (c.width - 16) / 366), s = Math.SQRT1_2; return { x: c.x + c.width / 2 - 35 * k + k * (215 - 60) * s, y: c.y + 26 * k + 20 + k * 0.5 * (215 + 60) * s }; });
    await page.mouse.click(p.x, p.y); await wait(400);
    const t = await js(() => planOut.textContent);
    return [t.startsWith('Living room'), `clicked where the living room is drawn: "${t}"`];
  },
  async flow() {
    await click('#flowList li:nth-child(5)', 0.7, 0.3); await wait(900);
    const p = await mid('#flowCanvas', 0.5, 0.4);
    const front = await js(([x, y]) => document.elementFromPoint(x, y)?.closest('li')?.querySelector('h3').textContent, [p.x, p.y]);
    await click('#flowList li:nth-child(5) button'); await wait(100);
    const t = await js(() => flowOut.textContent);
    return [front === 'Sodium Light' && t === 'Playing: Sodium Light', `clicked the fifth cover at the side: front is "${front}"; its button: "${t}"`];
  },
  async radial() {
    await click('#radialToggle'); await wait(700);
    const focus = await js(() => document.activeElement?.textContent);
    await click('#radialMenu li:nth-child(3) button'); await wait(600);
    const s = await js(() => [radialOut.textContent, radialMenu.inert, document.activeElement?.id]);
    return [s[0] === 'Chosen: Paste' && s[1], `opened: focus on "${focus}"; clicked the third item: "${s[0]}", menu inert again ${s[1]}, focus on #${s[2]}`];
  },
  async bars() {
    await click('#barsTable tr:nth-child(2) td:nth-of-type(4)'); await wait(100);
    await page.keyboard.press('End'); await page.keyboard.press('Backspace'); await page.keyboard.press('Backspace'); await page.keyboard.type('55'); await wait(200);
    const s = await js(() => [document.activeElement?.textContent, barsOut.textContent]);
    return [s[0] === '55', `clicked the top of the tallest bar and typed: cell is "${s[0]}"; ${s[1]}`];
  },
  async diff() {
    const a = await js(() => getComputedStyle(diffText.querySelector('ins')).display);
    await click('#diffPlay'); await wait(3000);
    const b = await js(() => [getComputedStyle(diffText.querySelector('ins')).display, getComputedStyle(diffText.querySelector('del')).display, diffAt.value]);
    return [a === 'none' && b[0] === 'inline' && b[1] === 'none' && b[2] === '1000', `before: ins ${a}; after playing: ins ${b[0]}, del ${b[1]}, slider ${b[2]}`];
  },
  async style() {
    await click('#styleSheet', 0.5, 0.5);
    await page.keyboard.press('Control+A');
    await page.keyboard.type('#stylePreview .badge { background: rgb(0, 128, 0); font-size: 40px; }'); await wait(300);
    const s = await js(() => [getComputedStyle(document.querySelector('#stylePreview .badge')).backgroundColor, styleOut.textContent]);
    return [s[0] === 'rgb(0, 128, 0)', `replaced the sheet by typing: badge background is ${s[0]}; ${s[1]}`];
  },
  async ticker() {
    const c = await mid('#tickerCanvas');
    const hit = await js(([x, y]) => document.elementFromPoint(x, y)?.closest('marquee')?.id, [c.x, c.y]);
    const paints = await js(() => new Promise((done) => { let n = 0; const f = () => n++; tickerCanvas.addEventListener('paint', f); setTimeout(() => { tickerCanvas.removeEventListener('paint', f); done(n); }, 1000); }));
    return [hit === 'tickerText' && paints > 5, `element at the middle of the panel: #${hit}; paint events in one second with no timer: ${paints}`];
  },
};

const only = process.argv.slice(2);
let failed = 0;
for (const [id, test] of Object.entries(TESTS)) {
  if (only.length && !only.includes(id)) continue;
  await show(id);
  let ok = false, text = '';
  try { [ok, text] = await test(); } catch (err) { text = 'threw: ' + err.message.split('\n')[0]; }
  if (!ok) failed++;
  console.log(`${ok ? 'pass' : 'FAIL'}  ${id.padEnd(10)} ${text}`);
}
if (errors.length) { failed++; console.log('page errors:\n  ' + errors.join('\n  ')); }
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
