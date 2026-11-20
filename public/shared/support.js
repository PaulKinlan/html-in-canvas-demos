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
 * Run a list of live tests and render them into a <tbody>.
 * Each test: { name, expect: 'pass'|'fail', why, run: async () => detailString }
 * A test "passes" if run() resolves, "fails" if it throws.
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
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:2147483600;opacity:.02;display:flex;flex-direction:column;align-items:flex-start;max-width:calc(100vw - 16px);overflow:hidden';
    document.body.append(el);
  }
  return el;
}

function canvasesIn(root, out = []) {
  for (const el of root.querySelectorAll('*')) {
    if (el.localName === 'canvas') out.push(el);
    if (el.shadowRoot) canvasesIn(el.shadowRoot, out);
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

export async function runTests(tbody, tests) {
  const rows = tests.map((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="status pending">… waiting</td><td><strong></strong><div class="note"></div></td><td class="note detail"></td>`;
    tr.querySelector('strong').textContent = t.name;
    tr.querySelector('div.note').textContent = t.why ?? '';
    tbody.append(tr);
    return tr;
  });
  const results = [];
  for (const [i, t] of tests.entries()) {
    const tr = rows[i];
    const status = tr.querySelector('.status');
    status.textContent = '… running';
    let ok, detail;
    try {
      detail = await withTimeout(t.run(), t.timeout ?? 4000);
      ok = true;
    } catch (err) {
      ok = false;
      detail = `${err?.name ?? 'Error'}: ${err?.message ?? err}`;
    }
    status.className = `status ${ok ? 'pass' : 'fail'}`;
    status.textContent = ok ? '✓ works' : '✗ fails';
    const cell = tr.querySelector('.detail');
    cell.textContent = detail ?? '';
    const stage = document.getElementById('test-stage');
    if (stage) {
      const pics = fixturePictures(stage);
      if (pics.length) { const div = document.createElement('div'); div.append(...pics); cell.append(div); }
      stage.replaceChildren();
    }
    results.push({ name: t.name, ok, detail });
  }
  document.getElementById('test-stage')?.remove();
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
