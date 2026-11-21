// Shared helpers: feature banner + a tiny live test harness that renders
// pass/fail rows so every demo reports what actually works in *your* browser.

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype;

export function banner() {
  const el = document.getElementById('support');
  if (!el) return;
  if (supported) {
    el.className = 'ok';
    el.textContent = `HTML-in-canvas is available in this browser (${navigator.userAgent.match(/Chrome\/\d+/)?.[0] ?? 'unknown'}).`;
  } else {
    el.className = 'bad';
    el.innerHTML =
      'HTML-in-canvas is not available here. Use Chrome 148+ with <code>chrome://flags/#canvas-draw-element</code> enabled ' +
      '(the API is also in an origin trial named <code>html-in-canvas</code>). The live tests below will report failures. ' +
      '<a href="/start/#enable">How to turn it on</a>.';
  }
}

/**
 * True in the hidden copy of a page that runs its `apart` tests (see runTests).
 * Pages can use it to keep the copy from sharing named channels or storage
 * with the page the person is looking at.
 */
export const isBench = new URLSearchParams(location.search).has('bench');

/**
 * Run a list of live tests and render them into a <tbody>.
 * Each test: { name, expect: 'pass'|'fail', why, run: async () => detailString }
 * A test "passes" if run() resolves, "fails" if it throws.
 *
 * A test marked `apart: true` presses buttons, types, resizes or scrolls. It
 * must not do that to the demo someone is looking at, so it runs in a second
 * copy of the page: an invisible, non-interactive frame of the same URL plus
 * ?bench, which is removed when its tests are done. The rows here are filled
 * in from its reports. Tests without the mark only look, and run in place.
 * `when` (a promise) delays loading the copy, for checks that only make sense
 * after the person has done something.
 */
/**
 * Where test fixtures live while their test runs: a small fixed box in the
 * corner of the viewport, all but invisible. Fixtures are always on screen
 * there, so they paint and hit-test wherever the reader has scrolled to, and
 * the tests never have to scroll the page. runTests() empties it after each
 * test and puts a picture of what the fixture drew into that test's row.
 */
export function testStage() {
  let el = document.getElementById('test-stage');
  if (!el) {
    el = document.createElement('div');
    el.id = 'test-stage';
    el.setAttribute('aria-hidden', 'true');
    // A fixed size, so the box itself never moves or resizes between tests (that would count as layout shift).
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;display:flex;flex-direction:column;align-items:flex-start;width:min(360px,calc(100vw - 16px));height:340px;overflow:hidden';
    document.body.append(el);
  }
  return el;
}

/**
 * Load a same-origin page in a frame on the test stage and resolve with the
 * frame once it has loaded. For testing a demo page without depending on
 * where the reader has scrolled to.
 */
export function stageFrame(url, width = 360, height = 320) {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = `display:block;border:0;width:${width}px;max-width:100%;height:${height}px;background:#fff`;
    frame.onload = () => resolve(frame);
    frame.onerror = () => reject(new Error(`could not load ${url}`));
    frame.src = url;
    testStage().append(frame);
  });
}

function canvasesIn(root, out = []) {
  for (const el of root.querySelectorAll('*')) {
    if (el.localName === 'canvas') out.push(el);
    if (el.shadowRoot) canvasesIn(el.shadowRoot, out);
    if (el.localName === 'iframe') { try { canvasesIn(el.contentDocument, out); } catch {} }
  }
  return out;
}

// A still picture of what each fixture canvas drew, or nothing if it is blank.
function fixturePictures(stage) {
  const pics = [];
  for (const c of canvasesIn(stage)) {
    try {
      const ctx = c.getContext('2d');
      if (!ctx || !c.width || !c.height) continue;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let any = false;
      for (let i = 3; i < d.length; i += 16) if (d[i]) { any = true; break; }
      if (!any) continue;
      const img = new Image();
      img.src = c.toDataURL();
      img.alt = 'What this test drew';
      img.className = 'fixture-shot';
      img.style.width = (c.clientWidth || c.width) + 'px';
      pics.push(img);
    } catch {}
  }
  return pics;
}

// Pages whose checks still drive the visible demo: they scroll the page, move
// focus or flicker while they run (measured by `npm run check:jank`). On these
// pages the checks wait for a tap instead of starting on load, so opening the
// page never moves it. To take a page off this list, make its checks run on
// their own fixtures, then confirm with
//   npm run check:jank -- --checks /your-page/
// and delete its line. Keep one page per line so branches merge cleanly.
// (/transitions/, /time-scrubber/ and /particles/ have their own rule: their
// checks start when the reader scrolls to them, see shared/on-screen.js.)
export const CHECKS_WAIT_FOR_TAP = [
  '/cross-origin/',
  '/remote/',
  '/portal/',
  '/lens/',
  '/shader-css/',
  '/slot-effects/',
  '/physical/',
  '/video/',
  '/overlay/',
  '/audio/',
  '/player-parts/',
  '/player-fx/',
  '/native-ui/',
  '/select/',
  '/component-kit/',
  '/datalist/',
  '/inputs/',
  '/selection/',
  '/caret/',
  '/xr-room/',
  '/scroll-fx/',
  '/shape-ui/',
  '/tilt-card/',
  '/text-labels/',
];

/** Should this page's checks start by themselves? ?autochecks=1 and ?autochecks=0 override the list. */
export function checksAutoRun() {
  const mode = new URLSearchParams(location.search).get('autochecks');
  if (mode === '1') return true;
  if (mode === '0') return false;
  if (window.top !== window) return true; // framed by the audit: nobody is reading this page
  return !CHECKS_WAIT_FOR_TAP.includes(location.pathname.replace(/index\.html$/, ''));
}

function waitForTap(tbody, rows) {
  const table = tbody.closest('table') ?? tbody;
  const gate = document.createElement('p');
  gate.className = 'checks-gate';
  gate.innerHTML = `<button type="button">Run these ${rows.length} checks</button> <span class="note">They drive the demo on this page, so it will scroll and flicker while they run.</span>`;
  (table.closest('details.checks-fold') ?? table).before(gate);
  for (const tr of rows) { const s = tr.querySelector('.status'); s.className = 'status idle'; s.textContent = 'not run'; }
  // A fixture panel the page already pinned to the window stays out of sight until the checks start.
  const bench = document.getElementById('check-bench');
  if (bench) bench.hidden = true;
  window.__checkState = 'waiting';
  return new Promise((resolve) => {
    gate.querySelector('button').addEventListener('click', () => {
      gate.remove();
      const fold = table.closest('details.checks-fold');
      if (fold) fold.open = true; // the person asked for the checks, so show the rows
      if (bench) bench.hidden = false;
      for (const tr of rows) { const s = tr.querySelector('.status'); s.className = 'status pending'; s.textContent = '… waiting'; }
      resolve();
    }, { once: true });
  });
}

/**
 * Put a results table inside a <details> whose summary line carries the count
 * ("Live checks: 9 of 11 pass"). Closed on a narrow screen, so the rows do not
 * push the rest of the page down; open where there is room. Safe to call twice.
 * runTests() calls it; a page that fills its rows earlier can call it then.
 */
export function foldChecks(tbody) {
  const table = tbody.closest?.('table');
  if (!table || isBench) return null;
  let fold = table.closest('details.checks-fold');
  if (fold) return fold;
  fold = document.createElement('details');
  fold.className = 'checks-fold';
  fold.open = window.top === window && innerWidth >= 700;
  const summary = document.createElement('summary');
  summary.innerHTML = '<b>Results</b><span class="count">not run yet</span>';
  table.before(fold);
  fold.append(summary, table);
  return fold;
}

function foldCount(fold, text) {
  const el = fold?.querySelector(':scope > summary .count');
  if (el) el.textContent = text;
}

export async function runTests(tbody, tests, { when = null } = {}) {
  const apart = tests.map((t, i) => (t.apart ? i : -1)).filter((i) => i >= 0);
  if (isBench) return runBench(tests, apart);
  const rows = tests.map((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="status pending">… waiting</td><td><strong></strong><div class="note"></div></td><td class="note detail"></td>`;
    tr.querySelector('strong').textContent = t.name;
    tr.querySelector('div.note').textContent = t.why ?? '';
    tbody.append(tr);
    return tr;
  });
  const fold = foldChecks(tbody);
  foldCount(fold, `${tests.length} checks, not run yet`);
  if (!checksAutoRun()) await waitForTap(tbody, rows);
  foldCount(fold, `${tests.length} checks, running`);
  window.__checkState = 'running';
  const calm = keepCalm();
  const results = new Array(tests.length);
  const show = (i, ok, detail) => {
    const status = rows[i].querySelector('.status');
    status.className = `status ${ok ? 'pass' : 'fail'}`;
    status.textContent = ok ? '✓ works' : '✗ fails';
    rows[i].querySelector('.detail').textContent = detail ?? '';
    results[i] = { name: tests[i].name, ok, detail };
  };
  const bench = apart.length ? Promise.resolve(when).then(() => openBench(apart, tests, show)) : Promise.resolve();
  for (const [i, t] of tests.entries()) {
    if (t.apart) continue;
    rows[i].querySelector('.status').textContent = '… running';
    await calm.wait();
    const r = await runOne(t);
    show(i, r.ok, r.detail);
    const stage = document.getElementById('test-stage');
    if (stage) {
      const pics = fixturePictures(stage);
      if (pics.length) { const div = document.createElement('div'); div.append(...pics); rows[i].querySelector('.detail').append(div); }
      stage.replaceChildren();
    }
  }
  document.getElementById('test-stage')?.remove();
  await bench;
  calm.restore();
  {
    // "9 of 11 pass, 2 fail (2 expected)". A check marked expect: 'fail' records a limit of the API.
    const pass = results.filter((r) => r?.ok).length;
    const failed = tests.filter((t, i) => !results[i]?.ok);
    const expected = failed.filter((t) => t.expect === 'fail').length;
    let text = `${pass} of ${tests.length} pass`;
    if (failed.length) text += `, ${failed.length} fail` + (expected ? ` (${expected} expected)` : '');
    foldCount(fold, text);
  }
  window.__checkState = 'done';
  window.__results = results;
  return results;
}

// A safety net, not a licence: checks should run on their own fixtures and
// never scroll or focus the page (npm run check:jank fails a page that does).
// If one does anyway, and the person has not touched the page meanwhile, put
// the scroll position and focus back where they were when the checks started.
function keepCalm() {
  const start = { x: scrollX, y: scrollY, active: document.activeElement };
  let touched = false;
  const types = ['pointerdown', 'touchstart', 'wheel', 'keydown'];
  let last = -1e9;
  const on = (e) => { if (e.isTrusted) { touched = true; last = performance.now(); } };
  const moving = (e) => { if (touched) last = performance.now(); };
  for (const t of types) addEventListener(t, on, { capture: true, passive: true });
  for (const t of ['scroll', 'pointermove', 'touchmove']) addEventListener(t, moving, { capture: true, passive: true });
  return {
    // The person comes first: while they are scrolling, dragging or typing,
    // the next check waits (up to 10 seconds) instead of fighting them for the
    // main thread. With nobody touching the page it does not wait at all.
    async wait() {
      const t0 = performance.now();
      while (performance.now() - last < 700 && performance.now() - t0 < 10000) await new Promise((r) => setTimeout(r, 250));
    },
    restore() {
      for (const t of types) removeEventListener(t, on, { capture: true });
      for (const t of ['scroll', 'pointermove', 'touchmove']) removeEventListener(t, moving, { capture: true });
      if (touched) return;
      if (scrollX !== start.x || scrollY !== start.y) scrollTo({ left: start.x, top: start.y, behavior: 'instant' });
      const a = document.activeElement;
      if (a && a !== start.active && a !== document.body) a.blur?.();
    },
  };
}

async function runOne(t) {
  try {
    return { ok: true, detail: await withTimeout(t.run(), t.timeout ?? 4000) };
  } catch (err) {
    return { ok: false, detail: `${err?.name ?? 'Error'}: ${err?.message ?? err}` };
  }
}

// In the page: load the copy, wait for its reports.
function openBench(apart, tests, show) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    const url = new URL(location.href);
    url.searchParams.set('bench', '1');
    url.hash = '';
    frame.src = url.href;
    frame.title = 'Hidden copy of this page that runs its live checks';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // In the viewport (so it paints) and the size of the screen (so layout
    // is the same), but never seen and never in the way.
    frame.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;border:0;opacity:0;pointer-events:none;z-index:-1;';
    const left = new Set(apart);
    const budget = apart.reduce((ms, i) => ms + (tests[i].timeout ?? 4000), 20000);
    // Checks in the copy focus things, and focus inside a frame takes it away
    // from this page. They need it while they run, so hand it back to
    // whatever had it as each check ends.
    let had = document.activeElement;
    const onFocus = (e) => (had = e.target);
    const giveBack = () => {
      if (document.activeElement !== frame) return;
      if (had && had !== document.body && had.isConnected) had.focus({ preventScroll: true });
      else frame.blur();
    };
    addEventListener('focusin', onFocus);
    const finish = (why) => {
      giveBack();
      removeEventListener('focusin', onFocus);
      removeEventListener('message', on);
      clearTimeout(timer);
      for (const i of left) show(i, false, why);
      frame.remove();
      resolve();
    };
    const on = (e) => {
      if (e.source !== frame.contentWindow || e.origin !== location.origin || !e.data?.bench) return;
      if (e.data.bench === 'result' && left.has(e.data.i)) {
        left.delete(e.data.i);
        show(e.data.i, e.data.ok, e.data.detail);
        giveBack();
      }
      if (e.data.bench === 'done' || !left.size) finish('the hidden copy finished without running this check');
    };
    addEventListener('message', on);
    const timer = setTimeout(() => finish('the hidden copy of the page did not report in time'), budget);
    document.body.append(frame);
  });
}

// In the copy: run only the tests that need it, and report each one.
async function runBench(tests, apart) {
  const results = [];
  for (const i of apart) {
    const r = await runOne(tests[i]);
    results.push({ name: tests[i].name, ...r });
    parent.postMessage({ bench: 'result', i, ...r, detail: r.detail == null ? '' : String(r.detail) }, location.origin);
  }
  parent.postMessage({ bench: 'done' }, location.origin);
  window.__results = results;
  return results;
}

export function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

/** Resolve on the next paint event of a canvas (requesting one). */
export function nextPaint(canvas) {
  return new Promise((resolve) => {
    canvas.addEventListener('paint', resolve, { once: true });
    canvas.requestPaint();
  });
}

/** Read one pixel as "r,g,b,a". */
export function pixel(ctx, x, y) {
  return Array.from(ctx.getImageData(x, y, 1, 1).data).join(',');
}

// The top menu is /shared/nav.js (list of demos: /shared/demos.js). Pages
// should include it with a script tag; this keeps older pages that call nav()
// working by loading it for them.
export function nav() {
  if (window.__siteNav || document.getElementById('site-nav')) return;
  const s = document.createElement('script');
  s.src = '/shared/nav.js';
  document.head.append(s);
}

/**
 * Mark every test `apart` (see runTests) except those that say `apart: false`.
 * For pages whose checks nearly all press or type.
 */
export const apart = (tests) => tests.map((t) => (t.apart === false ? t : { ...t, apart: true }));

/**
 * A place for live checks to build their fixtures. It is a small panel fixed
 * to the bottom of the window, so a check can hit test its fixture with
 * elementFromPoint() without scrolling the page, taking focus or touching the
 * demo the visitor is looking at. Call bench.done() after runTests().
 */
export function checkBench({ padding = '8px' } = {}) {
  const panel = document.createElement('div');
  panel.id = 'check-bench';
  panel.setAttribute('aria-hidden', 'true');
  panel.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:2147483000;max-height:45vh;overflow:hidden;box-sizing:border-box;' +
    'background:var(--bg,#fff);color:var(--fg,#000);border-top:1px solid var(--line,#ccc);box-shadow:0 -6px 24px rgb(0 0 0 / .18);' +
    'padding:4px 10px 10px;font:13px system-ui';
  const label = document.createElement('div');
  label.style.cssText = 'font:11px var(--mono,monospace);color:var(--muted,#666);margin-bottom:4px';
  label.textContent = 'Running live checks on test fixtures. This panel goes away when they finish.';
  const bench = document.createElement('div');
  bench.id = 'fixtures';
  bench.style.padding = padding;
  panel.append(label, bench);
  document.body.append(panel);
  bench.done = () => panel.remove();
  return bench;
}

/** Wrap each test so it starts with an empty bench: finished fixtures give their canvases and GPU contexts back. */
export function onBench(bench, tests) {
  for (const t of tests) {
    const run = t.run;
    if (!t.keepBench) t.run = () => { bench.replaceChildren(); return run(); };
  }
  return tests;
}

/** Fraction of pixels in an ImageData (or a 2D context's whole canvas) that are not fully transparent. */
export function inkFraction(source) {
  const data = source.data ?? source.getImageData(0, 0, source.canvas.width, source.canvas.height).data;
  let ink = 0;
  const step = Math.max(1, Math.floor(data.length / 4 / 40000));
  let seen = 0;
  for (let i = 3; i < data.length; i += 4 * step) { seen++; if (data[i] > 8) ink++; }
  return seen ? ink / seen : 0;
}

/**
 * The last check on a page: every demo the visitor can see must still have a
 * picture after the fixtures came and went. `demos` is a list of
 * { name, ink: async () => fraction 0..1 or null to skip, rescue?: () => void }.
 * A blank demo is rescued (usually by switching it to plain HTML) and reported.
 */
export function stillDrawn(demos) {
  return {
    name: 'The demos above still have a picture',
    why: 'Run last, after every fixture was built and thrown away. A canvas that lost its context or ended up blank fails here, and is switched to plain HTML with a note instead of staying an empty box.',
    timeout: 20000,
    run: async () => {
      const blank = [], seen = [];
      for (const d of demos()) {
        // A canvas that just lost its context may be on its way back: look three times before calling it blank.
        let f;
        for (let tries = 0; tries < 3; tries++) {
          if (tries) await new Promise((r) => setTimeout(r, 1200));
          d.error = '';
          try { f = await d.ink(); } catch (err) { f = 0; d.error = err.message; }
          if (f === null || f >= 0.002) break;
        }
        if (f === null) { seen.push(`${d.name}: ${d.note ?? 'skipped'}`); continue; }
        if (f < 0.002) { blank.push(d.name + (d.error ? ` (${d.error})` : '')); try { d.rescue?.(); } catch {} }
        else seen.push(`${d.name} ${(f * 100).toFixed(1)}%`);
      }
      if (blank.length) throw new Error(`blank: ${blank.join(', ')}. Drawn: ${seen.join(', ') || 'none'}`);
      return `pixels drawn: ${seen.join(', ')}`;
    },
  };
}
