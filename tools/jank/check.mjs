#!/usr/bin/env node
// Does a demo page hold still while it loads?
//
// Opens every page in public/shared/demos.js the way a mid-range Android phone
// would (412 px wide, real device scale factor 2.625, touch, CPU slowed 4x),
// touches nothing, and records what moved on its own from navigation until the
// page's live checks finish, plus a few seconds, plus a change of viewport
// height like the URL bar hiding. It fails when a page shifts its layout,
// scrolls, moves focus, covers itself or blanks a canvas.
//
//   npm run check:jank                       every page, pass/fail table
//   npm run check:jank -- /board/ /slot/     just these
//   npm run check:jank -- --json out.json    full measurements
//   npm run check:jank -- --shots dir        keep the screenshots
//   npm run check:jank -- --report           never fail, just print numbers
//   npm run check:jank -- --checks /board/   make checks that wait for a tap run on load
//                                            (to prove a page can come off that list)
//
// Needs Playwright with Chromium (npm i -D playwright, or a global install).
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
let root = path.resolve(here, '../../public');
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(require.resolve('playwright', { paths: [process.cwd(), '/usr/lib/node_modules', '/usr/local/lib/node_modules', '/opt/node22/lib/node_modules'] }))); }

// ---------------------------------------------------------------- options
const argv = process.argv.slice(2);
const opt = { pages: [], json: null, shots: null, report: false, jobs: 3, throttle: 4, base: null, settle: 3000, max: 90000 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') opt.json = argv[++i];
  else if (a === '--shots') opt.shots = argv[++i];
  else if (a === '--report') opt.report = true;
  else if (a === '--jobs') opt.jobs = +argv[++i];
  else if (a === '--throttle') opt.throttle = +argv[++i];
  else if (a === '--base') opt.base = argv[++i];
  else if (a === '--checks') opt.checks = true;
  else if (a === '--root') root = path.resolve(argv[++i]); // another checkout's public/ folder
  else if (a.startsWith('/')) opt.pages.push(a);
  else { console.error(`Unknown option ${a}`); process.exit(2); }
}

// What a page may do on its own while loading. Anything over fails.
const LIMITS = {
  cls: 0.05,           // cumulative layout shift, no input (web.dev calls 0.1 "good")
  scrollPx: 2,         // furthest the page scrolled itself from where it started
  focusMoves: 0,       // focus events nobody asked for
  overlaySamples: 0,   // samples with a fixed element over 40% of the screen
  blankFrames: 0,      // frames where a canvas that had a picture is one flat colour
  blankAtEnd: 0,       // visible canvases that end up one flat colour
  bigChanges: 3,       // frames where over a third of the screen changed (first paints allowed for)
  flashes: 0,          // frames that changed a lot and changed straight back
  resizeFlashes: 0,    // the same while the viewport height changes
  resizeClears: 6,     // backing-store writes to one visible canvas while the viewport height changes twice (a loop writes far more)
  resizeShift: 0.02,   // layout shift while the viewport height changes
  glContexts: 8,       // most WebGL contexts alive at once; Chrome on Android keeps 8 per tab and takes the oldest away
  lostCanvases: 0,     // visible canvases that lost their context and were not recovered (the guard's note was shown)
};
const allow = JSON.parse(await readFile(path.join(here, 'allow.json'), 'utf8').catch(() => '{}'));

// ---------------------------------------------------------------- server
const MIME = { html: 'text/html; charset=utf-8', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', wasm: 'application/wasm', webm: 'video/webm', mp4: 'video/mp4', woff2: 'font/woff2' };
function serve(port) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.join(root, p);
        if (!file.startsWith(root)) throw new Error('outside root');
        const body = await readFile(file);
        res.writeHead(200, { 'content-type': MIME[path.extname(file).slice(1)] ?? 'application/octet-stream', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
        res.end(body);
      } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
      }
    });
    server.on('error', (err) => { console.error(`Port ${port} is taken (${err.code}); using whatever is serving there. Stop it if it is not this checkout.`); resolve(null); });
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

// ---------------------------------------------------------------- pictures
// Runs in a helper page: is each canvas rectangle one flat colour, and how much
// of the screen changed since the previous sample?
async function analyse(b64, rects, cssW, reset) {
  const bmp = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + b64)).blob());
  // Always the same picture size, so frames compare when the viewport height changes.
  const W = 206, H = 440, k = W / cssW;
  const c = (self.__c ??= new OffscreenCanvas(W, H));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000';
  g.fillRect(0, 0, W, H);
  g.drawImage(bmp, 0, 0, W, Math.round((bmp.height / bmp.width) * W));
  bmp.close();
  const px = g.getImageData(0, 0, W, H).data;
  if (reset) self.__hist = [];
  const hist = (self.__hist ??= []);
  // Share of the screen that differs from each of the last few frames, newest first.
  const diffs = hist.map((old) => {
    let n = 0;
    for (let i = 0; i < px.length; i += 4) if (Math.abs(px[i] - old[i]) + Math.abs(px[i + 1] - old[i + 1]) + Math.abs(px[i + 2] - old[i + 2]) > 60) n++;
    return n / (px.length / 4);
  });
  hist.unshift(px);
  hist.length = Math.min(hist.length, 5);
  const flat = rects.map((r) => {
    const x0 = Math.max(0, Math.ceil(r.x * k) + 1), y0 = Math.max(0, Math.ceil(r.y * k) + 1);
    const x1 = Math.min(W, Math.floor((r.x + r.w) * k) - 1), y1 = Math.min(H, Math.floor((r.y + r.h) * k) - 1);
    if (x1 - x0 < 12 || y1 - y0 < 12) return null; // too little showing to judge
    const seen = new Map();
    let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4, key = (px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | (px[i + 2] >> 3);
      seen.set(key, (seen.get(key) || 0) + 1);
      n++;
    }
    return Math.max(...seen.values()) / n;
  });
  return { diffs, flat };
}

// ---------------------------------------------------------------- trace
function readTrace(buf) {
  let events;
  try { const j = JSON.parse(buf.toString()); events = j.traceEvents ?? j; } catch { return null; }
  const mains = new Set();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain') mains.add(e.pid + ':' + e.tid);
  const SCRIPT = new Set(['FunctionCall', 'EvaluateScript', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'RunMicrotasks', 'v8.callFunction', 'FireIdleCallback', 'v8.evaluateModule']);
  const LAYOUT = new Set(['Layout', 'UpdateLayoutTree']);
  const out = { layouts: 0, layoutMs: 0, styles: 0, styleMs: 0, forced: 0, forcedMs: 0, paints: 0, traceShifts: 0, forcedBy: {} };
  const byThread = new Map();
  for (const e of events) {
    if (!mains.has(e.pid + ':' + e.tid)) continue;
    if (e.name === 'Paint') out.paints++;
    if (e.name === 'LayoutShift' && e.args?.data?.is_main_frame && !e.args.data.had_recent_input) out.traceShifts++;
    if (e.ph !== 'X' || !(SCRIPT.has(e.name) || LAYOUT.has(e.name))) continue;
    const k = e.pid + ':' + e.tid;
    if (!byThread.has(k)) byThread.set(k, []);
    byThread.get(k).push(e);
  }
  for (const list of byThread.values()) {
    list.sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
    const stack = [];
    for (const e of list) {
      while (stack.length && stack.at(-1).ts + (stack.at(-1).dur ?? 0) <= e.ts) stack.pop();
      if (SCRIPT.has(e.name)) { stack.push(e); continue; }
      const ms = (e.dur ?? 0) / 1000;
      if (e.name === 'Layout') { out.layouts++; out.layoutMs += ms; } else { out.styles++; out.styleMs += ms; }
      if (stack.length) {
        out.forced++;
        out.forcedMs += ms;
        const f = (e.args?.beginData?.stackTrace ?? e.args?.beginData?.stack ?? [])[0];
        if (f?.url) { const where = new URL(f.url).pathname + ':' + (f.lineNumber ?? '?'); out.forcedBy[where] = (out.forcedBy[where] || 0) + 1; }
      }
    }
  }
  for (const k of ['layoutMs', 'styleMs', 'forcedMs']) out[k] = Math.round(out[k]);
  out.forcedBy = Object.fromEntries(Object.entries(out.forcedBy).sort((a, b) => b[1] - a[1]).slice(0, 5));
  return out;
}

// ---------------------------------------------------------------- one page
const instrument = await readFile(path.join(here, 'instrument.js'), 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measure(base, href, helper) {
  const W = 412, H = 780, BAR = 56; // a Pixel-sized phone with the URL bar showing
  const browser = await chromium.launch({ args: ['--force-device-scale-factor=2.625', `--window-size=${W},${H}`, '--enable-unsafe-swiftshader'] });
  const result = { href, errors: [] };
  try {
    const context = await browser.newContext({ viewport: null });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    page.on('pageerror', (e) => result.errors.push(String(e.message).slice(0, 200)));
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: opt.throttle });
    await cdp.send('Performance.enable');
    await browser.startTracing(page, { categories: ['devtools.timeline', 'loading', '__metadata'] });

    // Every frame the compositor produces is compared with the ones before it
    // (a screencast, so a canvas that blanks for one frame is seen), and a
    // light sample of the page a few times a second says where the canvases are.
    const samples = [], frames = [];
    const seenContent = new Set();
    let latest = null, phase = 'load', step = 0, queue = Promise.resolve(), shotNo = 0, first = true;
    const onFrame = async (f) => {
      // The sample must describe this frame: same scroll position and same viewport size. A frame caught half way
      // through a viewport change is laid out differently, and the rectangles would land on the wrong pixels.
      const m = f.metadata;
      const sameView = latest && Math.abs(latest.y - m.scrollOffsetY) < 1.5 &&
        (latest.vh === undefined || !m.deviceHeight || (Math.abs(latest.vh - m.deviceHeight) < 1.5 && Math.abs(latest.vw - m.deviceWidth) < 1.5));
      const rects = sameView ? latest.canvases : [];
      const rec = { t: Date.now() - t0, phase, step, blank: [] };
      const a = await helper.evaluate(([b, r, w, reset]) => self.__analyse(b, r, w, reset), [f.data, rects, W, first]);
      first = false;
      rec.changed = +(a.diffs[0] ?? 0).toFixed(3);
      rec.back = a.diffs.slice(1).map((d) => +d.toFixed(3));
      rects.forEach((c, i) => {
        const flat = a.flat[i];
        if (flat === null) return;
        if (flat < 0.97) seenContent.add(c.key ?? c.id);
        else if (flat > 0.992) rec.blank.push({ id: c.id, hadContent: seenContent.has(c.key ?? c.id) });
      });
      frames.push(rec);
      if (opt.shots) {
        const dir = path.join(opt.shots, href.replace(/[^a-z0-9]+/gi, '_') || 'home');
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${String(shotNo++).padStart(4, '0')}-${rec.phase}-${rec.t}ms.jpg`), Buffer.from(f.data, 'base64'));
      }
    };
    cdp.on('Page.screencastFrame', (f) => {
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
      queue = queue.then(() => onFrame(f)).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: W, maxHeight: H + BAR, everyNthFrame: 1 });
    const sample = async (ph) => {
      phase = ph;
      const s = await page.evaluate(() => window.__jank?.sample()).catch(() => null);
      if (!s) return;
      latest = s;
      samples.push({ t: Date.now() - t0, phase: ph, y: s.y, active: s.active, overlay: s.overlay });
    };

    const t0 = Date.now();
    await page.goto(base + href + (opt.checks ? (href.includes('?') ? '&' : '?') + 'autochecks=1' : ''), { waitUntil: 'commit' });
    // Load phase: until the live checks report, then a few quiet seconds.
    let doneAt = 0, checks = 'none';
    for (;;) {
      await sample('load');
      const el = Date.now() - t0;
      const st = await page.evaluate(() => ({ waiting: window.__checkState === 'waiting', results: Array.isArray(window.__results) ? window.__results.length : -1, pending: document.querySelectorAll('td.status.pending').length, ready: document.readyState })).catch(() => ({ results: -1, pending: 0, waiting: false }));
      if (!doneAt) {
        if (st.results >= 0) { doneAt = el; checks = 'finished'; }
        else if (st.waiting && el > 6000) { doneAt = el; checks = 'wait for a tap'; }
        else if (el > 12000 && allow[href]?.waitsForPerson) { doneAt = el; checks = 'wait for a person'; }
        else if (el > 12000 && !st.pending) doneAt = el;
        else if (el > opt.max) { doneAt = el; checks = 'timed out'; }
      } else if (el - doneAt > opt.settle) break;
      await sleep(200);
    }
    result.loadMs = doneAt;
    result.checks = checks;
    result.failedChecks = await page.evaluate(() => (window.__results ?? []).filter((r) => !r.ok).map((r) => r.name)).catch(() => []);

    // Viewport phase: the URL bar hides and shows again.
    await page.evaluate(() => { window.__jank.phase = 'viewport'; });
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    for (const h of [H + BAR, H]) {
      await queue;
      step++; // frames are only compared with others at the same viewport height
      await cdp.send('Browser.setWindowBounds', { windowId, bounds: { height: h } });
      for (let i = 0; i < 4; i++) { await sleep(150); await sample('viewport'); }
    }

    await cdp.send('Page.stopScreencast').catch(() => {});
    await queue;
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
    result.jank = await page.evaluate(() => window.__jank.collect());
    result.trace = readTrace(await browser.stopTracing());
    result.metrics = { layouts: metrics.LayoutCount, styleRecalcs: metrics.RecalcStyleCount, layoutMs: Math.round(metrics.LayoutDuration * 1000), styleMs: Math.round(metrics.RecalcStyleDuration * 1000), scriptMs: Math.round(metrics.ScriptDuration * 1000) };
    result.samples = samples;
    result.frames = frames;
  } catch (err) {
    result.errors.push('harness: ' + String(err.message).split('\n')[0]);
  } finally {
    await browser.close().catch(() => {});
  }
  return summarise(result);
}

function summarise(r) {
  const j = r.jank, s = r.samples ?? [];
  if (!j) { r.summary = null; r.problems = ['could not be measured: ' + r.errors.join('; ')]; return r; }
  const f = r.frames ?? [];
  const load = s.filter((x) => x.phase === 'load');
  const fload = f.filter((x) => x.phase === 'load'), fvp = f.filter((x) => x.phase === 'viewport');
  const sum = (list, fn) => list.reduce((n, x) => n + fn(x), 0);
  const pageScrolls = j.scrollCalls.filter((c) => !c.inner);
  const blankNames = new Set();
  const blankFrames = sum(f, (x) => { const b = x.blank.filter((c) => c.hadContent); b.forEach((c) => blankNames.add(c.id)); return b.length ? 1 : 0; });
  const lastLoad = fload.at(-1);
  // A flash: the screen changes a lot, then within a few frames is back to how it was.
  const flashes = (list) => list.filter((x, i) => x.back.some((d, k) => d < 0.02 && list[i - k - 2]?.step === x.step && list.slice(i - k - 1, i).some((m) => m.changed > 0.12))).length;
  const visibleResizes = j.canvasResizes.filter((c) => c.visible);
  const m = (r.summary = {
    loadMs: r.loadMs,
    checks: r.checks,
    cls: +sum(j.shifts.filter((x) => x.phase === 'load'), (x) => x.value).toFixed(3),
    shifts: j.shifts.filter((x) => x.phase === 'load').length,
    scrollPx: Math.round(Math.max(j.scrollMaxFromStart, ...load.map((x) => x.y), 0)),
    scrollTravel: Math.round(j.scrollTravel),
    scrollCalls: pageScrolls.length,
    focusMoves: j.focusEvents.filter((x) => x.phase === 'load').length,
    overlaySamples: s.filter((x) => x.overlay).length,
    blankFrames,
    blankAtEnd: lastLoad ? lastLoad.blank.length : 0,
    bigChanges: fload.filter((x) => x.changed > 0.33).length,
    flashes: flashes(fload),
    frames: fload.length,
    canvasWrites: sum(j.canvasResizes, (c) => c.writes),
    resizeClears: Math.max(0, ...visibleResizes.map((c) => c.phases.viewport || 0)),
    resizeShift: +sum(j.shifts.filter((x) => x.phase === 'viewport'), (x) => x.value).toFixed(3),
    resizeFlashes: flashes(fvp),
    glContexts: j.gfx?.peak ?? 0,
    lostCanvases: j.gfx?.noted ?? 0,
    longTasks: j.longTasks.length,
    longTaskMs: sum(j.longTasks, (x) => x.ms),
    layouts: r.trace?.layouts ?? r.metrics.layouts,
    forcedLayouts: r.trace?.forced ?? null,
    forcedMs: r.trace?.forcedMs ?? null,
    layoutMs: r.metrics.layoutMs + r.metrics.styleMs,
    paints: r.trace?.paints ?? null,
  });
  // Who did it.
  const top = (list, key, n = 3) => Object.entries(list.reduce((o, x) => ((o[key(x)] = (o[key(x)] || 0) + 1), o), {})).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ×${v}`);
  r.causes = {
    shifted: top(j.shifts.flatMap((x) => x.sources), (x) => x.node, 4),
    scrolledBy: top(pageScrolls, (x) => `${x.fn} ${x.by}`),
    focusedBy: top(j.focusCalls.filter((c) => !c.preventScroll), (x) => `focus() without preventScroll ${x.by}`),
    focusWent: top(j.focusEvents, (x) => x.on),
    overlay: [...new Set(s.map((x) => x.overlay).filter(Boolean))],
    blank: [...blankNames],
    blankAtEnd: lastLoad ? lastLoad.blank.map((c) => c.id) : [],
    resized: visibleResizes.filter((c) => c.writes > 2).map((c) => `${c.canvas} in ${c.host}: ${c.writes} writes (${c.same} unchanged) by ${Object.keys(c.by).slice(0, 2).join(', ')}`),
    forcedBy: r.trace?.forcedBy ?? {},
    contexts: j.gfx?.summary ?? '',
  };
  const ok = allow[r.href] ?? {};
  r.problems = [];
  r.allowed = [];
  for (const [k, limit] of Object.entries(LIMITS)) {
    if (m[k] <= limit) continue;
    const line = `${k} ${m[k]} (limit ${limit})`;
    if (ok[k] !== undefined && m[k] <= (ok[k].max ?? Infinity)) r.allowed.push(`${line}: ${ok[k].why}`);
    else r.problems.push(line);
  }
  if (r.checks === 'timed out') r.problems.push('live checks never finished');
  return r;
}

// ---------------------------------------------------------------- run
const servers = opt.base ? [] : [await serve(8001), await serve(8002)];
const base = opt.base ?? 'http://localhost:8001';
const demos = {};
new Function('window', await readFile(path.join(root, 'shared/demos.js'), 'utf8'))(demos);
const pages = opt.pages.length ? opt.pages : ['/', ...demos.DEMOS.map((d) => d.href)];

const helperBrowser = await chromium.launch();
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.min(opt.jobs, pages.length) }, async () => {
  const helper = await helperBrowser.newPage();
  await helper.evaluate(`self.__analyse = ${analyse.toString()}`);
  while (next < pages.length) {
    const i = next++;
    const r = await measure(base, pages[i], helper);
    results[i] = r;
    const m = r.summary;
    const flag = r.problems.length ? 'FAIL' : 'ok  ';
    console.log(`${flag} ${pages[i].padEnd(22)} ${m ? `cls ${m.cls} scroll ${m.scrollPx}px focus ${m.focusMoves} overlay ${m.overlaySamples} blank ${m.blankFrames}/${m.blankAtEnd} changes ${m.bigChanges} flashes ${m.flashes}+${m.resizeFlashes} resize ${m.resizeClears}/${m.resizeShift} gl ${m.glContexts}/${m.lostCanvases} forced ${m.forcedLayouts} long ${m.longTaskMs}ms  [${Math.round(m.loadMs / 1000)}s, checks ${m.checks}]` : ''}`);
    for (const p of r.problems) console.log(`       - ${p}`);
    for (const p of r.allowed ?? []) console.log(`       (allowed) ${p}`);
  }
}));
await helperBrowser.close();
for (const s of servers) s?.close();

if (opt.json) {
  await writeFile(opt.json, JSON.stringify(results.map(({ samples, frames, jank, ...r }) => ({ ...r, frames, shifts: jank?.shifts, scrollCalls: jank?.scrollCalls, focusCalls: jank?.focusCalls, focusEvents: jank?.focusEvents, canvasResizes: jank?.canvasResizes, samples })), null, 1));
}
const failed = results.filter((r) => r.problems.length);
console.log(`\n${results.length - failed.length} of ${results.length} pages hold still.`);
if (failed.length && !opt.report) process.exit(1);
