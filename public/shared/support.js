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
export async function runTests(tbody, tests) {
  const rows = tests.map((t) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="status pending">…</td><td><strong></strong><div class="note"></div></td><td class="note detail"></td>`;
    tr.querySelector('strong').textContent = t.name;
    tr.querySelector('div.note').textContent = t.why ?? '';
    tbody.append(tr);
    return tr;
  });
  const results = [];
  for (const [i, t] of tests.entries()) {
    const tr = rows[i];
    let ok, detail;
    try {
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

export function nav(current) {
  const links = [
    ['/', 'Home', 'home'],
    ['/slot/', '1 · Slots'],
    ['/slot-bare/', '1b · Bare slot'],
    ['/offscreen/', '2 · OffscreenCanvas'],
    ['/cross-tab/', '3 · Cross-tab'],
    ['/cross-origin/', '4 · Cross-origin'],
    ['/transports/', '5 · Transport lab'],
    ['/transitions/', 'Transitions'],
    ['/time-scrubber/', 'Time scrubber'],
    ['/particles/', 'Particles'],
  ];
  const header = document.createElement('header');
  header.className = 'site';
  for (const [href, label, cls] of links) {
    const a = document.createElement('a');
    a.href = href;
    a.textContent = cls === 'home' ? 'HTML-in-canvas experiments' : label;
    if (cls) a.className = cls;
    if (href === current) a.setAttribute('aria-current', 'page');
    header.append(a);
  }
  document.querySelector('main').prepend(header);
}
