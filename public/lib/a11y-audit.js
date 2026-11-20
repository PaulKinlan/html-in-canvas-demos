// a11y-audit.js: point it at any same-origin document that uses HTML-in-canvas
// and it reports how the drawn DOM holds up for people who do not use a mouse
// and a default display. Everything here is measured in the visitor's browser.
//
//   import { auditDocument } from '/lib/a11y-audit.js';
//   const report = await auditDocument(iframe.contentDocument);
//   report.checks → [{ id, title, status: 'pass'|'warn'|'fail'|'info', detail, items }]
//
// It cannot drive a screen reader, press a real Tab key or open an IME. Those
// are listed on /a11y/ as things to try by hand.

const FOCUSABLE = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=""], [contenteditable=true]';

export const CHECKS = [
  ['dom', 'Real DOM, not just pixels'],
  ['hit', 'Drawn where the browser thinks it is'],
  ['ghost', 'No invisible tab stops'],
  ['focus', 'Focus is visible in the canvas'],
  ['names', 'Controls have names'],
  ['find', 'Find and selection reach the text'],
  ['sharp', 'Sharp at this pixel ratio'],
  ['zoom', 'Re-renders when zoomed'],
  ['motion', 'Motion can be reduced'],
];

const frames = (win, n = 2) => new Promise((r) => {
  const f = () => (--n <= 0 ? r() : win.requestAnimationFrame(f));
  win.requestAnimationFrame(f);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** querySelectorAll through open shadow roots. */
export function deepAll(root, selector, out = []) {
  for (const el of root.querySelectorAll('*')) {
    if (el.matches(selector)) out.push(el);
    if (el.shadowRoot) deepAll(el.shadowRoot, selector, out);
  }
  return out;
}

const flatParent = (n) => n.assignedSlot ?? n.parentNode ?? n.host ?? null;
const isDrawableCanvas = (n) => n.nodeType === 1 && n.localName === 'canvas' && (n.getAttribute('content') === 'drawable' || n.hasAttribute('layoutsubtree'));

/** For a node, the drawable canvas that owns it and its outermost drawable ancestor. */
export function ownerOf(el) {
  let root = null;
  for (let n = el; n; n = flatParent(n)) {
    if (n.nodeType !== 1) continue;
    if (isDrawableCanvas(n)) return root ? { canvas: n, root } : null;
    if (n.hasAttribute('drawable')) root = n;
  }
  return null;
}

function flatContains(ancestor, node) {
  for (let n = node; n; n = flatParent(n)) if (n === ancestor) return true;
  return false;
}

function deepElementFromPoint(doc, x, y) {
  let el = doc.elementFromPoint(x, y);
  while (el?.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

function deepActive(doc) {
  let a = doc.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

function hiddenFromAT(el) {
  for (let n = el; n; n = flatParent(n)) {
    if (n.nodeType !== 1) continue;
    if (n.getAttribute('aria-hidden') === 'true' || n.inert) return true;
  }
  return false;
}

function label(el) {
  const id = el.id ? `#${el.id}` : '';
  const text = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 28);
  return `<${el.localName}${id}>${text ? ` "${text}"` : ''}`;
}

function accessibleName(el) {
  const doc = el.ownerDocument;
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => el.getRootNode().getElementById?.(id)?.textContent ?? '').join(' ').trim();
    if (t) return t;
  }
  const aria = el.getAttribute('aria-label');
  if (aria?.trim()) return aria.trim();
  if (el.labels?.length) return [...el.labels].map((l) => l.textContent).join(' ').trim();
  if (el.localName === 'input' && ['submit', 'button', 'reset'].includes(el.type) && el.value) return el.value;
  if (el.localName === 'img' || el.type === 'image') return el.alt ?? '';
  const text = (el.textContent ?? '').trim();
  if (text && !['input', 'select', 'textarea'].includes(el.localName)) return text;
  for (const img of el.querySelectorAll?.('img[alt], svg[aria-label]') ?? []) {
    const t = img.getAttribute('alt') || img.getAttribute('aria-label');
    if (t) return t;
  }
  return el.getAttribute('title') || el.getAttribute('placeholder') || (doc ? '' : '');
}

/** Hash of the pixels a canvas currently shows around a viewport rect. null if unreadable. */
function pixelHash(canvas, rect, pad = 5) {
  try {
    const cr = canvas.getBoundingClientRect();
    if (!cr.width || !cr.height) return null;
    const sx = canvas.width / cr.width, sy = canvas.height / cr.height;
    const x = Math.max(0, Math.floor((rect.left - cr.left - pad) * sx));
    const y = Math.max(0, Math.floor((rect.top - cr.top - pad) * sy));
    const w = Math.min(canvas.width - x, Math.ceil((rect.width + pad * 2) * sx));
    const h = Math.min(canvas.height - y, Math.ceil((rect.height + pad * 2) * sy));
    if (w <= 0 || h <= 0) return null;
    const scratch = canvas.ownerDocument.createElement('canvas');
    scratch.width = w; scratch.height = h;
    const ctx = scratch.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    let hash = 0, opaque = 0;
    for (let i = 0; i < d.length; i += 4) {
      hash = (hash * 31 + d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7 + d[i + 3]) | 0;
      if (d[i + 3]) opaque++;
    }
    return { hash, opaque };
  } catch {
    return null;
  }
}

function inViewport(win, r) {
  return r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < win.innerHeight && r.left < win.innerWidth;
}

/** Is this element hit-testable at (a point inside) its own rect? */
function hitTestable(doc, el) {
  const win = doc.defaultView;
  const r = el.getBoundingClientRect();
  if (!inViewport(win, r)) return null;
  // pointer-events: none (fixture strips, overlays) makes the question unanswerable.
  for (let n = el; n; n = flatParent(n)) {
    if (n.nodeType === 1 && win.getComputedStyle(n).pointerEvents === 'none') return null;
  }
  // Try a few points: the centre can be covered by a child canvas or clipped.
  const pts = [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7], [0.1, 0.1], [0.9, 0.9]];
  for (const [fx, fy] of pts) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x >= win.innerWidth || y >= win.innerHeight) continue;
    const hit = deepElementFromPoint(doc, x, y);
    if (hit && flatContains(el, hit)) return true;
  }
  return false;
}

const result = (id, status, detail, items = []) => ({ id, title: CHECKS.find((c) => c[0] === id)[1], status, detail, items });

/**
 * Audit one document. It is scrolled, focused and (briefly) zoomed while this runs.
 * @param {Document} doc same-origin, rendered (not display: none), ideally ≥ 800×500
 */
export async function auditDocument(doc, { maxControls = 14 } = {}) {
  const win = doc.defaultView;
  const canvases = deepAll(doc, 'canvas');
  const drawable = canvases.filter(isDrawableCanvas);
  const pixelOnly = canvases.filter((c) => !isDrawableCanvas(c));
  const roots = [];
  for (const el of deepAll(doc, '[drawable]')) {
    const o = ownerOf(el);
    if (o && o.root === el) roots.push({ el, canvas: o.canvas });
  }
  const checks = [];

  // ---- dom
  {
    const mute = pixelOnly.filter((c) => {
      if (hiddenFromAT(c)) return false;
      const r = c.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) return false;
      return !(c.getAttribute('aria-label') || c.getAttribute('aria-labelledby') || c.getAttribute('role') || c.textContent.trim() || c.closest('figure')?.querySelector('figcaption'));
    });
    const detail = `${drawable.length} drawable canvas(es) holding ${roots.length} live element(s); ${pixelOnly.length} plain canvas(es)`;
    if (!drawable.length) checks.push(result('dom', mute.length ? 'fail' : 'info', `no HTML-in-canvas content found on this page. ${detail}`, mute.map(label)));
    else if (mute.length) checks.push(result('dom', 'warn', `${detail}, ${mute.length} of them showing pixels with no label, role or fallback text (a screen reader gets nothing for these)`, mute.map(label)));
    else checks.push(result('dom', 'pass', detail));
  }

  // ---- hit: scroll each canvas into view and test its drawn elements
  const drawn = [], undrawn = [], offscreen = [];
  for (const c of drawable) {
    c.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
    await frames(win, 3);
    for (const r of roots.filter((x) => x.canvas === c)) {
      const h = hitTestable(doc, r.el);
      r.rect = r.el.getBoundingClientRect();
      r.scrollY = win.scrollY;
      if (h === true) drawn.push(r);
      else if (h === false) undrawn.push(r);
      else offscreen.push(r);
    }
  }
  if (!roots.length) checks.push(result('hit', 'info', 'nothing to test'));
  else {
    const detail = `${drawn.length} of ${roots.length} element(s) answer elementFromPoint at the position getBoundingClientRect reports` +
      (offscreen.length ? `; ${offscreen.length} could not be tested (outside the viewport or pointer-events: none)` : '');
    checks.push(result('hit', undrawn.length ? 'warn' : 'pass', undrawn.length
      ? `${detail}. ${undrawn.length} do not: they are in the canvas but not drawn (or drawn without geometry, as WebGL does), so pointer, focus rectangle and magnifier positions are wrong for them`
      : detail, undrawn.map((r) => label(r.el))));
  }

  // ---- ghost: focusable things inside elements that are not on screen
  {
    const ghosts = [];
    for (const r of undrawn) {
      for (const f of [r.el, ...deepAll(r.el, '*')].filter((e) => e.matches(FOCUSABLE))) {
        if (f.tabIndex < 0 || f.disabled || hiddenFromAT(f)) continue;
        ghosts.push(f);
      }
    }
    if (!roots.length) checks.push(result('ghost', 'info', 'nothing to test'));
    else if (ghosts.length) checks.push(result('ghost', 'fail', `${ghosts.length} control(s) can take keyboard focus but have no pixels: Tab lands on something the user cannot see. Hide undrawn elements with inert or aria-hidden, or remove them.`, ghosts.map(label)));
    else checks.push(result('ghost', 'pass', undrawn.length ? 'undrawn elements hold no reachable controls' : 'every element in a canvas is drawn'));
  }

  // ---- focus + names
  const controls = [];
  for (const r of drawn) {
    for (const f of [r.el, ...deepAll(r.el, '*')].filter((e) => e.matches(FOCUSABLE))) {
      if (f.disabled || f.tabIndex < 0 || hiddenFromAT(f)) continue;
      controls.push({ el: f, canvas: r.canvas });
    }
  }
  {
    const before = deepActive(doc);
    const sample = controls.slice(0, maxControls);
    const noFocus = [], noRing = [], unreadable = [], moved = [];
    let ok = 0;
    for (const { el, canvas } of sample) {
      canvas.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      deepActive(doc)?.blur?.();
      await frames(win, 2);
      const rect = el.getBoundingClientRect();
      const a = pixelHash(canvas, rect);
      el.focus({ preventScroll: true });
      await frames(win, 3);
      if (deepActive(doc) !== el) { noFocus.push(el); continue; }
      const rect2 = el.getBoundingClientRect();
      const b = pixelHash(canvas, rect2);
      if (!a || !b || (!a.opaque && !b.opaque)) { unreadable.push(el); continue; }
      if (Math.abs(rect2.top - rect.top) > 2 || Math.abs(rect2.left - rect.left) > 2) { moved.push(el); ok++; continue; }
      if (a.hash === b.hash) noRing.push(el); else ok++;
    }
    deepActive(doc)?.blur?.();
    before?.focus?.({ preventScroll: true });
    const extra = controls.length > sample.length ? ` (first ${sample.length} of ${controls.length})` : '';
    if (!sample.length) checks.push(result('focus', 'info', 'no focusable controls inside drawn elements'));
    else {
      const bits = [`${ok} of ${sample.length} control(s) take focus and the canvas pixels change around them${extra}`];
      if (moved.length) bits.push(`${moved.length} were moving, so their ring could not be compared`);
      if (unreadable.length) bits.push(`${unreadable.length} sit in a canvas whose pixels cannot be read back here (WebGL without preserveDrawingBuffer, or not yet presented)`);
      if (noFocus.length) bits.push(`${noFocus.length} refused focus`);
      if (noRing.length) bits.push(`${noRing.length} took focus with no visible change: the page is not repainting the canvas on focus, or has removed the outline`);
      checks.push(result('focus', noFocus.length || noRing.length ? 'fail' : unreadable.length ? 'warn' : 'pass', bits.join('; '), [...noFocus, ...noRing].map(label)));
    }
    const unnamed = controls.filter((c) => !accessibleName(c.el));
    if (!controls.length) checks.push(result('names', 'info', 'no controls'));
    else checks.push(result('names', unnamed.length ? 'fail' : 'pass', unnamed.length ? `${unnamed.length} of ${controls.length} control(s) have no accessible name` : `all ${controls.length} control(s) have a name`, unnamed.map(label)));
  }

  // ---- find + selection
  {
    let tested = null;
    for (const r of drawn) {
      const walker = doc.createTreeWalker(r.el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const m = n.data.match(/[\p{L}\p{N}]{3,}(?: [\p{L}\p{N}]+)?/u);
        const p = n.parentElement;
        if (!m || !p || p.closest('script, style, textarea, button, input, select, option')) continue;
        if (win.getComputedStyle(p).userSelect === 'none') continue;
        tested = { r, node: n, index: m.index, text: m[0] };
        break;
      }
      if (tested) break;
    }
    if (!tested) checks.push(result('find', 'info', 'no plain text inside drawn elements'));
    else {
      const { r, node, index, text } = tested;
      r.canvas.scrollIntoView({ block: 'center', behavior: 'instant' });
      const sel = win.getSelection();
      sel.removeAllRanges();
      await frames(win, 2);
      const range = doc.createRange();
      range.setStart(node, index); range.setEnd(node, index + text.length);
      const rect = range.getBoundingClientRect();
      const a = pixelHash(r.canvas, rect, 2);
      sel.addRange(range);
      await frames(win, 3);
      const b = pixelHash(r.canvas, range.getBoundingClientRect(), 2);
      const selected = sel.toString() === text;
      sel.removeAllRanges();
      let found = null;
      try { found = win.find(text, false, false, true); } catch {}
      const foundInCanvas = found && sel.rangeCount && !!ownerOf(sel.anchorNode.parentElement ?? sel.anchorNode);
      sel.removeAllRanges();
      const painted = a && b ? a.hash !== b.hash : null;
      const bits = [`"${text}": window.find() ${found ? 'finds it' : 'does not find it'}`, `a range over it ${selected ? 'selects' : 'does not select'}`,
        painted === null ? 'canvas pixels are not readable, so the highlight could not be checked' : painted ? 'the selection highlight is painted into the canvas' : 'the highlight is NOT painted into the canvas'];
      checks.push(result('find', !found || !selected || painted === false ? 'fail' : painted === null ? 'warn' : 'pass', bits.join('; ') + (foundInCanvas === false ? ' (the match found first was outside the canvas)' : '')));
    }
  }

  // ---- sharp + zoom
  {
    const dpr = win.devicePixelRatio;
    const measure = (c) => {
      const r = c.getBoundingClientRect();
      return { c, w: c.width, css: r.width, ratio: r.width ? c.width / (r.width * dpr) : 1 };
    };
    const vis = drawable.filter((c) => c.getBoundingClientRect().width >= 24);
    const m0 = vis.map(measure);
    const soft = m0.filter((m) => m.ratio < 0.95);
    if (!vis.length) checks.push(result('sharp', 'info', 'nothing to test'));
    else checks.push(result('sharp', soft.length ? 'warn' : 'pass', soft.length
      ? `${soft.length} of ${vis.length} canvas(es) have fewer backing pixels than the screen shows at devicePixelRatio ${dpr}: text in them is blurrier than the page around it`
      : `all ${vis.length} canvas(es) have at least one backing pixel per device pixel (devicePixelRatio ${dpr})`,
      soft.map((m) => `${label(m.c)} ${m.w}px for ${Math.round(m.css * dpr)} device px`)));

    // CSS zoom on the root stands in for browser zoom and OS text scaling: the
    // layout gets bigger and a canvas has to notice and re-render.
    if (!vis.length || !('zoom' in doc.documentElement.style)) checks.push(result('zoom', 'info', 'nothing to test'));
    else {
      const prev = doc.documentElement.style.zoom;
      const sx = win.scrollX, sy = win.scrollY;
      doc.documentElement.style.zoom = '1.5';
      await frames(win, 4); await sleep(120); await frames(win, 2);
      const grew = [], same = [];
      // Still one backing pixel per device pixel at the zoomed size?
      for (const m of m0) (measure(m.c).ratio >= 0.95 ? grew : same).push(m);
      let lost = 0, retested = 0;
      for (const r of drawn) {
        r.canvas.scrollIntoView({ block: 'center', behavior: 'instant' });
        await frames(win, 2);
        const h = hitTestable(doc, r.el);
        if (h === null) continue;
        retested++;
        if (!h) lost++;
      }
      doc.documentElement.style.zoom = prev;
      await frames(win, 3);
      win.scrollTo(sx, sy);
      const bits = [`at 150% zoom ${grew.length} of ${m0.length} canvas(es) still have a backing pixel for every device pixel`];
      if (same.length) bits.push(`${same.length} kept their old bitmap and are stretched (blurry text for anyone who zooms)`);
      bits.push(lost ? `${lost} of ${retested} drawn element(s) were no longer hit-testable where they appear` : `hit testing still lines up for ${retested} element(s)`);
      checks.push(result('zoom', lost ? 'fail' : same.length ? 'warn' : 'pass', bits.join('; '), same.map((m) => label(m.c))));
    }
  }

  // ---- motion
  {
    const counts = new Map(drawable.map((c) => [c, 0]));
    const on = (e) => counts.set(e.currentTarget, counts.get(e.currentTarget) + 1);
    for (const c of drawable) c.addEventListener('paint', on);
    const span = 700;
    await sleep(span);
    for (const c of drawable) c.removeEventListener('paint', on);
    const busy = [...counts].filter(([, n]) => n / (span / 1000) > 20);
    const reduce = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let aware = /prefers-reduced-motion/.test(doc.documentElement.innerHTML);
    if (!aware) {
      for (const s of doc.querySelectorAll('script[src], link[rel=stylesheet][href]')) {
        try {
          const url = new URL(s.src || s.href, doc.baseURI);
          if (url.origin !== win.location.origin) continue;
          if (/prefers-reduced-motion/.test(await (await fetch(url)).text())) { aware = true; break; }
        } catch {}
      }
    }
    if (!drawable.length) checks.push(result('motion', 'info', 'nothing to test'));
    else if (!busy.length) checks.push(result('motion', 'pass', `no canvas repaints continuously${reduce ? ' (reduced motion is on)' : ''}`));
    else if (reduce) checks.push(result('motion', 'fail', `${busy.length} canvas(es) keep animating although this device asks for reduced motion`, busy.map(([c, n]) => `${label(c)} ${Math.round(n / (span / 1000))} paints/s`)));
    else checks.push(result('motion', aware ? 'pass' : 'warn', `${busy.length} canvas(es) repaint every frame. ${aware ? 'The page mentions prefers-reduced-motion; turn reduced motion on and re-run to verify it.' : 'Nothing on the page checks prefers-reduced-motion, and there is no way to pause it (WCAG 2.2.2).'}`, busy.map(([c, n]) => `${label(c)} ${Math.round(n / (span / 1000))} paints/s`)));
  }

  const tally = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) tally[c.status]++;
  return {
    url: win.location.pathname,
    title: doc.title,
    canvases: drawable.length,
    elements: roots.length,
    controls: controls.length,
    checks,
    tally,
    environment: {
      devicePixelRatio: win.devicePixelRatio,
      forcedColors: win.matchMedia('(forced-colors: active)').matches,
      reducedMotion: win.matchMedia('(prefers-reduced-motion: reduce)').matches,
      dark: win.matchMedia('(prefers-color-scheme: dark)').matches,
    },
  };
}
