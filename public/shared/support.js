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
 * Put the rows for a list of tests on the page without running them, so that a page which starts its
 * checks later (see onScreen) does not grow, and scroll under the visitor, when they start.
 * runTests() reuses the rows.
 */
export function listTests(tbody, tests) {
  if (tbody.__rows?.tests === tests) return tbody.__rows.rows;
  const rows = tests.map((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="status pending">…</td><td><strong></strong><div class="note"></div></td><td class="note detail"></td>`;
    tr.querySelector('strong').textContent = t.name;
    tr.querySelector('div.note').textContent = t.why ?? '';
    tbody.append(tr);
    return tr;
  });
  tbody.__rows = { tests, rows };
  return rows;
}

/**
 * Run a list of live tests and render them into a <tbody>.
 * Each test: { name, expect: 'pass'|'fail', why, run: async () => detailString }
 * A test "passes" if run() resolves, "fails" if it throws.
 */
export async function runTests(tbody, tests, { ready } = {}) {
  const rows = listTests(tbody, tests);
  const results = [];
  for (const [i, t] of tests.entries()) {
    const tr = rows[i];
    let ok, detail;
    try {
      if (ready) await ready();   // e.g. wait for the test fixture to be on screen again; not counted against the timeout
      detail = await withTimeout(t.run(), t.timeout ?? 4000);
      ok = true;
    } catch (err) {
      ok = false;
      detail = `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
    }
    const status = tr.querySelector('.status');
    status.className = `status ${ok ? 'pass' : 'fail'}`;
    status.textContent = ok ? '✓ works' : '✗ fails';
    tr.querySelector('.detail').textContent = detail ?? '';
    results.push({ name: t.name, ok, detail });
  }
  window.__results = results;
  return results;
}

/**
 * Keep on-load checks away from the demo the visitor is looking at: run them on a fixture that sits in
 * the page's own "Live tests" section, and only while that fixture is on screen (canvases that are off
 * screen are not painted, so their checks would time out).
 *
 *   const rig = onScreen(document.getElementById('rigbox'));
 *   await rig.seen;                                    // first time it scrolls into view
 *   await runTests(tbody, tests, { ready: rig.wait }); // pauses between checks while it is out of view
 *
 * Add ?checks to the URL to scroll to the fixture and start at once (handy for automation).
 */
export function onScreen(el) {
  let visible = false, waiters = [];
  const io = new IntersectionObserver((entries) => {
    visible = entries.at(-1).isIntersecting;
    if (visible) { for (const w of waiters) w(); waiters = []; }
  }, { threshold: 0.6 });
  io.observe(el);
  const wait = () => (visible ? Promise.resolve() : new Promise((r) => waiters.push(r)));
  if (new URLSearchParams(location.search).has('checks')) el.scrollIntoView({ block: 'center' });
  return { seen: wait(), wait, get visible() { return visible; }, stop: () => io.disconnect() };
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
