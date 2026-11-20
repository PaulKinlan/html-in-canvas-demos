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
      '(the API is also in an origin trial named <code>html-in-canvas</code>). The live tests below will report failures.';
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
export async function runTests(tbody, tests, { when = null } = {}) {
  const apart = tests.map((t, i) => (t.apart ? i : -1)).filter((i) => i >= 0);
  if (isBench) return runBench(tests, apart);
  const rows = tests.map((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="status pending">…</td><td><strong></strong><div class="note"></div></td><td class="note detail"></td>`;
    tr.querySelector('strong').textContent = t.name;
    tr.querySelector('div.note').textContent = t.why ?? '';
    tbody.append(tr);
    return tr;
  });
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
    const r = await runOne(t);
    show(i, r.ok, r.detail);
  }
  await bench;
  window.__results = results;
  return results;
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
