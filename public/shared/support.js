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
