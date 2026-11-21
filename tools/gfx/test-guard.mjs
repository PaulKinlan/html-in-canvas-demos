#!/usr/bin/env node
// node tools/gfx/test-guard.mjs
//
// Tests /shared/context-guard.js in headless Chromium on a page with nothing
// else in it. The real losses happen on a phone and not in this browser, so
// each case forces the situation: WEBGL_lose_context on a plain (not drawable)
// canvas for a loss, a large canvas for the budget, a timer for a readback.
// Needs Playwright with Chromium, like check:jank.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

const guard = await readFile(path.resolve(here, '../../public/shared/context-guard.js'), 'utf8');
const collected = [];
const server = createServer((req, res) => {
  if (req.method === 'POST') {
    let text = '';
    req.on('data', (d) => (text += d));
    req.on('end', () => { try { collected.push(...JSON.parse(text)); } catch {} res.writeHead(204); res.end(); });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>guard</title><body style="margin:0;background:#fff"><script>${req.url.includes('small') ? 'window.__gfxBudget = { canvasPx: 1e6, bytes: 6e6 };' : ''}window.__gfxNoTaps = true;${req.url.includes('report') ? "window.__gfxReportTo = '/collect';" : ''}</script><script>${guard}</script><div id="stage"></div>`);
});
await new Promise((r) => server.listen(8013, '127.0.0.1', r));
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
const results = [];
async function test(name, url, fn) {
  const context = await browser.newContext({ viewport: { width: 412, height: 780 } });
  const page = await context.newPage();
  const warnings = [];
  page.on('console', (m) => { if (m.text().startsWith('context-guard:')) warnings.push(m.text()); });
  try {
    await page.goto('http://127.0.0.1:8013' + url);
    const detail = await Promise.race([fn(page, warnings), new Promise((_, no) => setTimeout(() => no(new Error('timed out after 30 s')), 30000))]);
    results.push({ name, ok: true, detail });
  } catch (e) { results.push({ name, ok: false, detail: e.message.split('\n')[0] }); }
  await Promise.race([context.close(), new Promise((r) => setTimeout(r, 3000))]);
}
const must = (ok, message) => { if (!ok) throw new Error(message); };

await test('A removed, retired 2D canvas is set to 0 by 0', '/', async (page) => {
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 600; c.height = 400;
    document.getElementById('stage').append(c);
    c.getContext('2d').fillRect(0, 0, 10, 10);
    await new Promise((r) => setTimeout(r, 600));
    const before = __gfx.memory().bytes;
    __gfx.retire(c);
    const attached = c.width; // still in the page: not touched
    c.remove();
    await new Promise((r) => setTimeout(r, 1600));
    return { before, attached, w: c.width, after: __gfx.memory().bytes, freed: __gfx.freed };
  });
  must(r.before === 960000 && r.attached === 600, `estimate before ${r.before}, width while attached ${r.attached}`);
  must(r.w === 0 && r.after === 0 && r.freed === 1, `after removal: width ${r.w}, estimate ${r.after}, freed ${r.freed}`);
  return `960000 bytes estimated, 0 after removal`;
});

await test('A removed, retired WebGL canvas gives its context back, and one still in the page keeps it', '/', async (page) => {
  const r = await page.evaluate(async () => {
    const make = () => { const c = document.createElement('canvas'); document.getElementById('stage').append(c); return [c, c.getContext('webgl2')]; };
    const [a, ga] = make(), [b, gb] = make();
    await new Promise((r) => setTimeout(r, 600));
    __gfx.retire(a); __gfx.retire(b);
    a.remove();
    await new Promise((r) => setTimeout(r, 1600));
    return { a: ga.isContextLost(), b: gb.isContextLost(), active: __gfx.active(), lost: __gfx.lost.length, noted: __gfx.noted };
  });
  must(r.a && !r.b && r.active === 1, `removed lost ${r.a}, attached lost ${r.b}, alive ${r.active}`);
  must(r.lost === 0 && r.noted === 0, `a retired canvas was recorded as a loss (${r.lost}) or got a note (${r.noted})`);
  return 'removed canvas: context lost; attached canvas: context kept; no loss recorded';
});

await test('Readbacks from a GPU canvas on a timer are flagged, and from a willReadFrequently canvas are not', '/', async (page, warnings) => {
  const r = await page.evaluate(async () => {
    const cpu = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const timer = setInterval(() => cpu.getImageData(0, 0, 1, 1), 300);
    await new Promise((r) => setTimeout(r, 4500));
    const cpuOnly = { ...__gfx.reads, by: null, recent: null };
    clearInterval(timer);
    const gpu = document.createElement('canvas').getContext('2d');
    const t2 = setInterval(() => gpu.getImageData(0, 0, 2, 2), 300);
    await new Promise((r) => setTimeout(r, 4500));
    clearInterval(t2);
    return { cpuOnly, gpu: { ...__gfx.reads, recent: null } };
  });
  must(r.cpuOnly.calls > 8 && r.cpuOnly.unasked === 0 && !r.cpuOnly.timed, `willReadFrequently canvas: ${JSON.stringify(r.cpuOnly)}`);
  must(r.gpu.timed && r.gpu.unaskedSeconds >= 4, `GPU canvas: ${JSON.stringify(r.gpu)}`);
  must(warnings.some((w) => /on a timer/.test(w)), 'no console warning');
  return `GPU canvas: unasked readbacks in ${r.gpu.unaskedSeconds} different seconds, flagged; from ${Object.keys(r.gpu.by)[0]}`;
});

await test('A readback while window.__checkState is "running" is not counted', '/', async (page) => {
  const r = await page.evaluate(async () => {
    window.__checkState = 'running';
    const gpu = document.createElement('canvas').getContext('2d');
    for (let i = 0; i < 5; i++) { gpu.getImageData(0, 0, 2, 2); await new Promise((r) => setTimeout(r, 1010)); }
    return __gfx.reads;
  });
  must(r.calls === 5 && r.unasked === 0, `calls ${r.calls}, unasked ${r.unasked}`);
  return '5 readbacks, 0 unasked';
});

await test('Over the budget, removed canvases are freed and the page is warned', '/?small', async (page, warnings) => {
  const r = await page.evaluate(async () => {
    const gone = document.createElement('canvas'); gone.width = 1000; gone.height = 1000;
    document.getElementById('stage').append(gone); gone.getContext('2d');
    await new Promise((r) => setTimeout(r, 600));
    gone.remove(); // 4 MB, removed and not retired
    await new Promise((r) => setTimeout(r, 2800));
    const kept = gone.width; // under the budget: left alone
    const big = document.createElement('canvas'); big.width = 1500; big.height = 1000;
    document.getElementById('stage').append(big); big.getContext('2d'); // 6 MB more, and 1.5 megapixels
    await new Promise((r) => setTimeout(r, 1300));
    return { kept, gone: gone.width, over: __gfx.over, mem: __gfx.memory() };
  });
  must(r.kept === 1000, `the removed canvas was freed while under the budget (width ${r.kept})`);
  must(r.gone === 0, `the removed canvas was not freed over the budget (width ${r.gone})`);
  must(r.over && warnings.some((w) => /megapixels/.test(w)), `no warning for a 1.5 megapixel canvas with a 1 megapixel budget: ${JSON.stringify(r.over)}`);
  return `removed canvas freed; warning: ${warnings[0].slice(15, 110)}`;
});

await test('Three losses of one canvas in 30 seconds stop paint events and show a note', '/', async (page) => {
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200; c.style.cssText = 'width:300px;height:200px';
    document.getElementById('stage').append(c);
    const gl = c.getContext('webgl2'), ext = gl.getExtension('WEBGL_lose_context');
    let paints = 0;
    c.addEventListener('paint', () => paints++);
    c.dispatchEvent(new Event('paint'));
    c.addEventListener('webglcontextlost', (e) => e.preventDefault());
    for (let i = 0; i < 3; i++) {
      ext.loseContext(); await new Promise((r) => setTimeout(r, 150));
      if (i < 2) { ext.restoreContext(); await new Promise((r) => setTimeout(r, 150)); }
    }
    const before = paints;
    c.dispatchEvent(new Event('paint'));
    const note = document.querySelector('.context-lost-note');
    return { halted: __gfx.halted, before, after: paints, note: note?.firstChild.textContent, summary: __gfx.summary(), stored: sessionStorage.getItem('gfx-visit') };
  });
  must(r.halted, 'not halted');
  must(r.before === 1 && r.after === 1, `paint handlers ran ${r.after - r.before} time(s) after the halt`);
  must(/3 times/.test(r.note ?? '') && /stopped/.test(r.note), `note: ${r.note}`);
  must(/Drawing stopped by the guard/.test(r.summary) && JSON.parse(r.stored).lost === 3, `summary: ${r.summary}`);
  return r.note;
});

await test('A dispatched (untrusted) contextlost event is not recorded as a loss', '/', async (page) => {
  const r = await page.evaluate(async () => {
    const c = document.createElement('canvas'); document.getElementById('stage').append(c); c.getContext('2d');
    c.dispatchEvent(new Event('contextlost'));
    await new Promise((r) => setTimeout(r, 1700));
    return { lost: __gfx.lost.length, noted: __gfx.noted };
  });
  must(r.lost === 0 && r.noted === 0, JSON.stringify(r));
  return 'no loss, no note';
});

await test('An ordinary reload closes the record, and the next page shows no bar', '/', async (page) => {
  const made = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 500; document.getElementById('stage').append(c); c.getContext('2d');
    await new Promise((r) => setTimeout(r, 700));
    return sessionStorage.getItem('gfx-visit');
  });
  must(JSON.parse(made).state === 'open', `record while open: ${made}`);
  // An ordinary reload closes the record, so no bar.
  await page.reload();
  must(!(await page.$('.context-visit-report')), 'a bar was shown after an ordinary reload');
  return 'record "open" while showing; no bar after reload';
});

await test('The record of a page that never closed is shown on the next load', '/', async (page) => {
  // The first document of this tab writes an open record and is then killed without pagehide.
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 500; document.getElementById('stage').append(c); c.getContext('2d');
    await new Promise((r) => setTimeout(r, 700));
  });
  cdp.send('Page.crash').catch(() => {}); // never answers: the renderer is gone
  await new Promise((r) => setTimeout(r, 800));
  // Playwright will not drive a crashed page, so the same tab is reloaded and read over the protocol.
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8013/' });
  await new Promise((r) => setTimeout(r, 1500));
  const { result } = await cdp.send('Runtime.evaluate', { expression: "document.querySelector('.context-visit-report')?.textContent ?? 'no bar; record ' + sessionStorage.getItem('gfx-visit')" });
  const text = result.value;
  must(/stopped without closing/.test(text) && /1\.0 MB in 1 canvases/.test(text), text);
  return text.slice(0, 120);
});

await test('A lost context, a script error and a rejected promise are sent as reports', '/?report', async (page) => {
  collected.length = 0;
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200; document.getElementById('stage').append(c);
    // gfx-allow: lose-context a plain canvas in a test page, to make a real contextlost event
    c.getContext('webgl').getExtension('WEBGL_lose_context').loseContext();
    setTimeout(() => { throw new Error('thrown by the test'); }, 0);
    Promise.reject(new TypeError('rejected by the test'));
    window.__gfx.report('trial', 'a report made by the page', { n: 1 });
    await new Promise((r) => setTimeout(r, 1600));
  });
  const types = collected.map((r) => r.type);
  for (const t of ['context-lost', 'error', 'unhandledrejection', 'trial']) must(types.includes(t), `no ${t} report in ${types.join(', ') || 'nothing'}`);
  const lost = collected.find((r) => r.type === 'context-lost');
  must(lost.source === 'guard' && /^http:\/\/127\.0\.0\.1:8013\//.test(lost.url) && /Contexts made: 1 WebGL/.test(lost.body.summary) && lost.visit, JSON.stringify(lost).slice(0, 200));
  must(/thrown by the test/.test(collected.find((r) => r.type === 'error').message), 'the error report has no message');
  return `${collected.length} reports: ${types.join(', ')}`;
});

await test('Snapshots that are not closed are counted, and close() takes one off', '/', async (page) => {
  const out = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.setAttribute('content', 'drawable'); c.setAttribute('layoutsubtree', ''); c.width = 200; c.height = 100;
    const el = document.createElement('div'); el.setAttribute('drawable', ''); el.textContent = 'x'; c.append(el); document.getElementById('stage').append(c);
    if (!c.captureElementImage) return 'none';
    const ctx = c.getContext('2d');
    await new Promise((r) => { c.onpaint = () => { ctx.drawElementImage(el, 0, 0, 50, 20); r(); }; c.requestPaint(); });
    const kept = []; for (let i = 0; i < 26; i++) kept.push(c.captureElementImage(el));
    kept[0].close(); kept[0].close();
    return JSON.stringify(window.__gfx.snapshots) + ' ' + window.__gfx.reports.map((r) => r.type).join(',');
  });
  if (out === 'none') return 'captureElementImage() is not in this browser: not run';
  must(/"made":26,"open":25,"peak":26/.test(out) && /snapshots-open/.test(out), out);
  return out;
});

await test('A page that died holds its paint events on the next load until "Draw anyway", and reports the death', '/?report', async (page) => {
  collected.length = 0;
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 500; c.height = 500; document.getElementById('stage').append(c); c.getContext('2d');
    await new Promise((r) => setTimeout(r, 700));
  });
  cdp.send('Page.crash').catch(() => {});
  await new Promise((r) => setTimeout(r, 800));
  await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8013/?report' });
  await new Promise((r) => setTimeout(r, 1500));
  const run = async (expression) => (await cdp.send('Runtime.evaluate', { expression, awaitPromise: true })).result.value;
  const paints = `(async () => {
    let c = document.querySelector('#stage canvas');
    if (!c) { c = document.createElement('canvas'); c.setAttribute('content', 'drawable'); c.setAttribute('layoutsubtree', ''); c.width = 100; c.height = 50; c.getContext('2d'); document.getElementById('stage').append(c); window.n = 0; c.addEventListener('paint', () => window.n++); }
    if (!c.requestPaint) return -1;
    c.requestPaint(); await new Promise((r) => setTimeout(r, 300)); return window.n; })()`;
  const held = await run('window.__gfx.held');
  const before = await run(paints);
  const text = await run("document.querySelector('.context-visit-report')?.textContent ?? 'no bar'");
  await run("[...document.querySelectorAll('.context-visit-report button')].find((b) => b.textContent === 'Draw anyway')?.click()");
  const after = await run(paints);
  await new Promise((r) => setTimeout(r, 300));
  must(held === true && /are not being drawn/.test(text), `held ${held}; bar: ${text}`);
  if (before !== -1) must(before === 0 && after > 0, `paint events before "Draw anyway": ${before}, after: ${after}`);
  const died = collected.find((r) => r.type === 'tab-died');
  must(died && died.body.times === 1 && /1\.0 MB in 1 canvases/.test(died.body.summary), `tab-died report: ${JSON.stringify(died)}`);
  must(collected.some((r) => r.type === 'draw-anyway'), 'no draw-anyway report');
  return `held; ${before} paint events while held, ${after} after "Draw anyway"; reports: ${collected.map((r) => r.type).join(', ')}`;
});

await Promise.race([browser.close(), new Promise((r) => setTimeout(r, 3000))]);
server.close();
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}\n       ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} guard tests pass.`);
process.exit(failed ? 1 : 0);
