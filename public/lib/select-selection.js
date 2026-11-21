// Six experiments on selects, inputs and text selection. Each is one class on
// a 2D canvas that holds real elements. Nothing here opens a WebGL or WebGPU
// context, and nothing reads pixels back.
//
//   new MultiSelect(canvas)        <canvas><select multiple drawable><option drawable>…</select></canvas>
//   new SuggestSelect(input, select)   an <input> that opens a customisable <select> with no button
//   new TiltedText(canvas)         <canvas><article drawable>…</article></canvas>, drawn on a plane in perspective
//   new TranslateInPlace(canvas)   <canvas><article drawable><span data-s>Sentence.</span>…</article></canvas>
//   new SelectionTicks(canvas)     <canvas><article drawable>…</article></canvas>, a pulse per word selected
//   new ControlSelection(canvas)   <canvas><input drawable><textarea drawable></textarea></canvas>
//
// Without HTML-in-canvas each class takes the elements out of the canvas and
// leaves them as ordinary HTML.

import { SelectPicker, layouts, supported as pickerSupported } from './select-picker.js';

export const supported =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype &&
  'requestPaint' in HTMLCanvasElement.prototype &&
  'updateElementGeometry' in HTMLCanvasElement.prototype;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const FAR = typeof DOMMatrix === 'undefined' ? null : new DOMMatrix().translate(-1e5, -1e5);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const fire = (el, ...types) => { for (const type of types) el.dispatchEvent(new Event(type, { bubbles: true })); };

const CSS_TEXT = `
canvas.multi-select { display: block; width: 100%; height: 252px; touch-action: pan-y; border-radius: 14px; background: var(--picker-bg, Canvas); color: var(--picker-ink, CanvasText); border: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
canvas.multi-select[data-lasso] { touch-action: none; cursor: crosshair; }
canvas.multi-select:has(select:focus-visible) { outline: 2px solid var(--picker-accent, AccentColor); outline-offset: 2px; }
canvas.multi-select > select { display: block; box-sizing: border-box; width: 100%; height: 100%; margin: 0; padding: 0; border: 0; background: transparent; overflow: hidden; outline: none; font: inherit; color: inherit; }
canvas.multi-select option { box-sizing: border-box; width: max-content; min-height: 36px; padding: 7px 14px 7px 10px; border-radius: 18px; border: 1.5px solid color-mix(in srgb, currentColor 30%, transparent); background: var(--picker-bg, Canvas); color: var(--picker-ink, CanvasText); font: 15px/1.3 system-ui, sans-serif; white-space: nowrap; }
canvas.multi-select option::before { content: ''; display: inline-block; width: 12px; height: 12px; margin-right: 7px; border-radius: 50%; background: var(--c, currentColor); vertical-align: -1px; }
select[suggest] { position: absolute; inset: 0; box-sizing: border-box; width: 100%; height: 100%; min-height: 0; min-block-size: 0; border: 0; padding: 0; margin: 0; background: none; color: inherit; pointer-events: none; }
select[suggest]::picker(select) { pointer-events: auto; }
select[suggest] > button, select[suggest]::picker-icon { display: none; }
select[suggest]::picker(select) { margin: 4px 0; }
select[suggest] > canvas { touch-action: manipulation; }
select[picker="suggest"] option { width: var(--suggest-w, 300px); height: 46px; justify-content: flex-start; gap: 10px; padding: 0 10px; border-radius: 10px; background: none; font: 15px/1.2 system-ui, sans-serif; }
select[picker="suggest"] option::before { content: ''; flex: none; width: 26px; height: 26px; border-radius: 8px; background: var(--c, currentColor); }
select[picker="suggest"] option small { display: block; font-size: 12px; opacity: .7; }
select[picker="suggest"] option b { font-weight: 600; }
canvas.tilted-text, canvas.translate-in-place, canvas.selection-ticks, canvas.control-selection { display: block; width: 100%; border-radius: 14px; background: var(--picker-bg, Canvas); color: var(--picker-ink, CanvasText); border: 1px solid color-mix(in srgb, currentColor 18%, transparent); touch-action: pan-y; }
canvas.tilted-text { height: 300px; }
canvas.tilted-text > * { box-sizing: border-box; width: min(100% - 24px, 330px); margin: 0; padding: 10px 14px; font: 16px/1.5 system-ui, sans-serif; background: transparent; }
canvas.tilted-text > [data-twin] { user-select: none; pointer-events: none; }
canvas.tilted-text > [drawable]::selection, canvas.tilted-text > [drawable] *::selection { background: transparent; color: #fff; }
canvas.translate-in-place { height: 290px; }
canvas.selection-ticks { height: 250px; }
canvas.translate-in-place > *, canvas.selection-ticks > * { box-sizing: border-box; width: calc(100% - 24px); margin: 0; padding: 0; font: 16px/1.55 system-ui, sans-serif; background: transparent; }
canvas.translate-in-place p, canvas.selection-ticks p, canvas.tilted-text p { margin: 0 0 8px; }
canvas.control-selection { height: 232px; }
canvas.control-selection > :is(input, textarea) { box-sizing: border-box; display: block; width: min(100% - 24px, 340px); margin: 0; padding: 9px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); background: var(--picker-bg, Canvas); color: var(--picker-ink, CanvasText); font: 17px/1.4 system-ui, sans-serif; outline-offset: -2px; resize: none; }
canvas.control-selection > textarea { height: 104px; }
canvas.control-selection > :is(input, textarea)::selection { background: transparent; color: inherit; }
canvas.control-selection > .control-mirror { position: absolute; visibility: hidden; pointer-events: none; white-space: pre-wrap; overflow-wrap: break-word; }
`;

function addCSS(node) {
  const root = node.getRootNode(), head = root.nodeType === 9 ? root.head : root;
  if (head.querySelector('style[data-select-selection]')) return;
  const style = document.createElement('style');
  style.dataset.selectSelection = '';
  style.textContent = CSS_TEXT;
  head.append(style);
}

/** Keep a canvas's bitmap at the size of its box in device pixels. */
function fit(canvas) {
  new ResizeObserver(([entry]) => {
    const size = entry.devicePixelContentBoxSize?.[0] ?? { inlineSize: Math.round(entry.contentRect.width * devicePixelRatio), blockSize: Math.round(entry.contentRect.height * devicePixelRatio) };
    if (!size.inlineSize || !size.blockSize) return;
    if (canvas.width !== size.inlineSize) canvas.width = size.inlineSize;
    if (canvas.height !== size.blockSize) canvas.height = size.blockSize;
    canvas.requestPaint();
  }).observe(canvas);
}

/** Take the children of a canvas out and show them where the canvas is. */
export function unwrap(canvas) {
  if (canvas.hidden) return;
  for (const twin of canvas.querySelectorAll('[data-twin], .control-mirror')) twin.remove();
  canvas.before(...canvas.children);
  canvas.hidden = true;
}

/** Run fn once, when el comes within 300 px of the screen. */
export function near(el, fn) {
  if (typeof IntersectionObserver === 'undefined') { fn(); return; }
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    fn();
  }, { rootMargin: '300px' });
  io.observe(el);
}

const colours = (canvas) => {
  const style = getComputedStyle(canvas);
  return {
    ink: style.color,
    bg: style.backgroundColor,
    accent: style.getPropertyValue('--picker-accent').trim() || '#0a66d0',
  };
};

// Rectangles on one line of text become one rectangle.
function mergeLines(rects) {
  const lines = [];
  for (const r of rects) {
    if (r.w < 0.5 || r.h < 0.5) continue;
    const line = lines.find((l) => Math.abs(l.y - r.y) < l.h * 0.5 && Math.abs(l.h - r.h) < l.h * 0.6);
    if (line) {
      const right = Math.max(line.x + line.w, r.x + r.w);
      line.x = Math.min(line.x, r.x);
      line.w = right - line.x;
    } else lines.push({ ...r });
  }
  return lines.sort((a, b) => a.y - b.y);
}

/** Client rectangles of a range, in the layout pixels of `el`, measured from its top left corner. */
function rectsIn(el, range) {
  const base = el.getBoundingClientRect();
  if (!base.width) return [];
  const k = el.offsetWidth / base.width;
  return [...range.getClientRects()].map((r) => ({ x: (r.left - base.left) * k, y: (r.top - base.top) * k, w: r.width * k, h: r.height * k }));
}

/** The selection's range when all of it is inside el, else null. */
function rangeIn(el) {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  return el.contains(range.startContainer) && el.contains(range.endContainer) ? range : null;
}

// What the classes share: a 2D context scaled to CSS pixels, a paint handler
// that waits for the first paint record, and the plain-HTML fallback.
class Stage {
  /** Frames drawn, for tests. */
  frames = 0;
  /** A message for the page to show: why the canvas is not drawing, or how it is drawing. */
  note = '';
  #raf = 0;

  constructor(canvas) { this.canvas = canvas; }

  start(name, paint) {
    const { canvas } = this;
    if (!supported) { unwrap(canvas); this.plain = true; return false; }
    addCSS(canvas);
    canvas.classList.add(name);
    this.ctx = canvas.getContext('2d');
    fit(canvas);
    canvas.addEventListener('paint', () => {
      if (canvas.hidden || !canvas.clientWidth || !canvas.width) return;
      const { ctx } = this, k = canvas.width / canvas.clientWidth;
      try {
        ctx.reset();
        ctx.scale(k, k);
        paint(ctx, canvas.clientWidth, canvas.clientHeight);
        this.frames++;
      } catch (err) {
        // "No cached paint record" before an element's first paint: the next paint event draws it.
        if (/paint record/.test(err.message)) { if (!this.missed?.(err)) this.again(); }
        else if (this.note !== err.message) { this.note = err.message; window.__gfx?.report?.('draw-error', err.message, { page: location.pathname }); }
      }
    });
    canvas.addEventListener('contextlost', () => { this.note = 'the canvas lost its context, so its content is shown as ordinary HTML'; unwrap(canvas); });
    return true;
  }

  /** Ask for one more paint, on the next frame. */
  again() {
    if (this.#raf || this.canvas.hidden) return;
    this.#raf = requestAnimationFrame(() => { this.#raf = 0; if (!this.canvas.hidden) this.canvas.requestPaint(); });
  }

  /** updateElementGeometry()'s matrix has been seen in CSS px and in buffer px. Measure which, once. */
  unitOf(el) {
    if (this.unit) return this.unit;
    this.canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix() });
    const measured = el.getBoundingClientRect().width;
    this.unit = measured > 0 ? (el.offsetWidth * (el.currentCSSZoom || 1)) / measured : 1;
    return this.unit;
  }
}

// #region multi
// A <select multiple> is a list box. A canvas inside it is not laid out, so
// the select is a child of the canvas instead, and each option has the
// drawable attribute. The select's box covers the canvas: a list box clips
// hit testing to its own box, so an option drawn outside that box cannot be
// clicked. The canvas draws each option where it likes. Click, Ctrl and Shift
// click, the arrow keys and a touch tap are the list box's own. The lasso is
// the canvas's: it sets option.selected and fires input and change.
export class MultiSelect extends Stage {
  /** 'options': each option is drawn as an element. 'text': the option has no picture, so its label is drawn as text. */
  route = 'options';
  /** Where each option was drawn: { x, y, w, h } in canvas CSS px. */
  spots = [];
  /** Points of the lasso being drawn, or null. */
  loop = null;
  #pop = [];
  #misses = 0;
  #down = null;

  constructor(canvas, { route = '' } = {}) {
    super(canvas);
    const select = (this.select = canvas.querySelector('select'));
    this.options = [...select.options];
    if (!this.start('multi-select', (ctx, w, h) => this.#paint(ctx, w, h))) return;
    if (route) this.route = route;
    this.#pop = this.options.map((o) => (o.selected ? 1 : 0));
    for (const type of ['input', 'change', 'focus', 'blur', 'keyup']) select.addEventListener(type, () => this.again());
    this.#pointer();
    this.lasso = matchMedia('(pointer: fine)').matches;
  }

  /** With the lasso on, a drag draws a loop and the options inside it become the selection. */
  get lasso() { return this.canvas.hasAttribute('data-lasso'); }
  set lasso(on) { this.canvas.toggleAttribute('data-lasso', !!on); }

  // Called when an option has no paint record. On Android a <select multiple>
  // is a button that opens a dialog, and its options have no boxes.
  missed() {
    if (++this.#misses < 12) return false;
    this.route = 'text';
    this.note = 'the options of this select have no picture here, so their labels are drawn as text and taps are handled by the canvas';
    this.again();
    return true;
  }

  #layout(ctx, w) {
    const gap = 9, pad = 14;
    let x = pad, y = pad, rowH = 0;
    ctx.font = '15px system-ui, sans-serif';
    this.spots = this.options.map((o) => {
      const ow = this.route === 'options' ? o.offsetWidth : Math.ceil(ctx.measureText(o.label).width) + 44;
      const oh = this.route === 'options' ? o.offsetHeight : 36;
      if (x + ow > w - pad && x > pad) { x = pad; y += rowH + gap; rowH = 0; }
      const spot = { x, y, w: ow, h: oh };
      x += ow + gap;
      rowH = Math.max(rowH, oh);
      return spot;
    });
  }

  #paint(ctx, w, h) {
    const { canvas, select, options } = this;
    const { ink, bg, accent } = colours(canvas);
    this.#layout(ctx, w);
    const inside = this.loop && this.loop.length > 2 ? this.inside(this.loop) : null;
    let moving = false;
    if (this.route === 'options') {
      // The select's own picture is not shown, but its hit box must cover the canvas.
      ctx.save();
      ctx.globalAlpha = 0;
      ctx.drawElementImage(select, 0, 0, w, h);
      ctx.restore();
    } else canvas.updateElementGeometry(select, { canvasTransform: FAR });
    for (const [i, option] of options.entries()) {
      const spot = this.spots[i], target = option.selected ? 1 : 0;
      const p = (this.#pop[i] = reduced() || Math.abs(target - this.#pop[i]) < 0.01 ? target : this.#pop[i] + (target - this.#pop[i]) * 0.22);
      if (p !== target) moving = true;
      ctx.save();
      ctx.translate(spot.x + spot.w / 2, spot.y + spot.h / 2);
      // A chosen option is drawn larger, turned a little, with a shadow under it.
      ctx.rotate((i % 2 ? 1 : -1) * 0.05 * p);
      ctx.scale(1 + 0.1 * p, 1 + 0.1 * p);
      if (p > 0.02) { ctx.shadowColor = 'rgb(0 0 0 / .35)'; ctx.shadowBlur = 12 * p; ctx.shadowOffsetY = 5 * p; }
      if (this.route === 'options') ctx.drawElementImage(option, -spot.w / 2, -spot.h / 2, spot.w, spot.h);
      else {
        ctx.beginPath(); ctx.roundRect(-spot.w / 2, -spot.h / 2, spot.w, spot.h, 18);
        ctx.fillStyle = option.selected ? accent : bg; ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = ink; ctx.globalAlpha = 0.35; ctx.stroke(); ctx.globalAlpha = 1;
        ctx.fillStyle = option.style.getPropertyValue('--c') || ink;
        ctx.beginPath(); ctx.arc(-spot.w / 2 + 16, 0, 6, 0, 7); ctx.fill();
        ctx.fillStyle = option.selected ? '#fff' : ink;
        ctx.font = '15px system-ui, sans-serif'; ctx.textBaseline = 'middle';
        ctx.fillText(option.label, -spot.w / 2 + 29, 1);
      }
      if (p > 0.02) {
        // The colour of a chosen list box option is the browser's and differs by platform and focus,
        // so the canvas marks the chosen chips itself.
        ctx.shadowColor = 'transparent';
        ctx.beginPath(); ctx.roundRect(-spot.w / 2, -spot.h / 2, spot.w, spot.h, 18);
        ctx.globalAlpha = 0.2 * p; ctx.fillStyle = accent; ctx.fill();
        ctx.globalAlpha = p; ctx.strokeStyle = accent; ctx.lineWidth = 2.5; ctx.stroke();
      }
      ctx.restore();
      if (inside?.[i]) {
        ctx.save();
        ctx.strokeStyle = accent; ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.roundRect(spot.x - 3, spot.y - 3, spot.w + 6, spot.h + 6, 21); ctx.stroke();
        ctx.restore();
      }
    }
    if (this.loop?.length > 1) {
      ctx.save();
      ctx.beginPath();
      this.loop.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.globalAlpha = 0.14; ctx.fillStyle = accent; ctx.fill();
      ctx.globalAlpha = 1; ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.stroke();
      ctx.restore();
    }
    if (moving) this.again();
  }

  /** For each option, is the middle of its chip inside the closed path `points`? */
  inside(points) {
    return this.spots.map((s) => {
      const x = s.x + s.w / 2, y = s.y + s.h / 2;
      let hit = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
      return hit;
    });
  }

  /** Make the options inside the path the selection, or add them to it. Fires input and change. */
  choose(points, { add = false, before = this.options.map((o) => o.selected) } = {}) {
    const inside = this.inside(points);
    let changed = false;
    for (const [i, option] of this.options.entries()) {
      const want = (inside[i] || (add && before[i])) && !option.disabled;
      if (option.selected !== want) changed = true;
      option.selected = want;
    }
    if (changed) fire(this.select, 'input', 'change');
    this.again();
    return inside.filter(Boolean).length;
  }

  #pointer() {
    const { canvas } = this;
    const local = (e) => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      this.#down = { id: e.pointerId, points: [local(e)], moved: false, before: this.options.map((o) => o.selected), add: e.ctrlKey || e.metaKey || e.shiftKey || e.pointerType === 'touch' };
    });
    canvas.addEventListener('pointermove', (e) => {
      const d = this.#down;
      if (!d || d.id !== e.pointerId || !this.lasso) return;
      const p = local(e), [x0, y0] = d.points[0];
      if (!d.moved && Math.hypot(p[0] - x0, p[1] - y0) < 8) return;
      if (!d.moved) {
        d.moved = true;
        // From here the pointer is the canvas's, so the list box stops its own drag selection.
        try { canvas.setPointerCapture(e.pointerId); } catch {}
      }
      d.points.push(p);
      this.loop = d.points;
      this.again();
    });
    const up = (e) => {
      const d = this.#down;
      if (!d || d.id !== e.pointerId) return;
      this.#down = null;
      this.loop = null;
      if (d.moved && e.type === 'pointerup') this.choose(d.points, d);
      else if (!d.moved && e.type === 'pointerup' && this.route === 'text') {
        const [x, y] = d.points[0];
        const i = this.spots.findIndex((s) => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
        if (i >= 0 && !this.options[i].disabled) { this.options[i].selected = !this.options[i].selected; fire(this.select, 'input', 'change'); }
      }
      this.again();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }
}
// #endregion multi

// #region suggest
// Rows of a customisable select, ranked by the text typed in an input. Options
// that do not match fade out and the others slide up to their new rank.
const SUGGEST = { rows: 5, rowH: 50, pad: 6, foot: 26 };
layouts.suggest = {
  size: (n, vw) => [Math.min(340, vw - 24), SUGGEST.pad * 2 + SUGGEST.rows * SUGGEST.rowH + SUGGEST.foot],
  prepare(s) {
    const g = s.suggest;
    if (!g) return;
    let moving = false;
    for (let i = 0; i < s.n; i++) {
      const y = SUGGEST.pad + 2 + g.rank[i] * SUGGEST.rowH, a = g.rank[i] >= 0 && g.rank[i] < SUGGEST.rows ? 1 : 0;
      if (g.y[i] === undefined || reduced()) { g.y[i] = a ? y : g.y[i] ?? y; g.alpha[i] = a; continue; }
      if (a && g.alpha[i] < 0.02) g.y[i] = y + 14; // a row that comes back rises into place
      if (a) { if (Math.abs(g.y[i] - y) > 0.4) { g.y[i] += (y - g.y[i]) * 0.26; moving = true; } else g.y[i] = y; }
      if (Math.abs(g.alpha[i] - a) > 0.02) { g.alpha[i] += (a - g.alpha[i]) * 0.3; moving = true; } else g.alpha[i] = a;
    }
    if (moving) requestAnimationFrame(() => { try { if (s.picker?.open) s.picker.canvas.requestPaint(); } catch {} });
  },
  place(i, s) {
    const g = s.suggest;
    if (!g || g.alpha[i] < 0.02) return null;
    return { m: new DOMMatrix().translate(8, g.y[i]), alpha: g.alpha[i] * s.open, order: i };
  },
  under(ctx, s) {
    const g = s.suggest;
    if (!g) return;
    const w = s.w - 16;
    // The canvas draws a bar behind each row from the option's data-n, and a band behind the row the arrow keys are on.
    for (let i = 0; i < s.n; i++) {
      if (g.alpha[i] < 0.02) continue;
      ctx.globalAlpha = g.alpha[i] * s.open * (i === g.cursor ? 0.22 : 0.09);
      ctx.fillStyle = i === g.cursor ? s.accent : s.ink;
      ctx.beginPath();
      ctx.roundRect(8, g.y[i], i === g.cursor ? w : Math.max(8, w * g.share[i]), SUGGEST.rowH - 4, 10);
      ctx.fill();
    }
  },
  over(ctx, s) {
    const g = s.suggest;
    if (!g) return;
    ctx.globalAlpha = 0.7 * s.open;
    ctx.fillStyle = s.ink;
    ctx.font = '12px ui-monospace, monospace';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.count ? `${g.count} of ${s.n} match${g.typed ? ` "${g.typed}"` : ''}` : `nothing matches "${g.typed}"`, 14, s.h - SUGGEST.foot / 2 - 2, s.w - 28);
  },
};

// An <input> with a customisable <select> under it. The select has no button
// and no height: only its picker is ever seen. Typing opens the picker with
// showPicker(), which is allowed because a key press is a user activation.
// The options are the suggestions, with any content, drawn by a canvas.
export class SuggestSelect {
  note = '';

  constructor(input, select) {
    this.input = input;
    this.select = select;
    if (!supported || !pickerSupported) {
      this.plain = true;
      this.note = 'HTML-in-canvas or appearance: base-select is not available, so the select is shown as an ordinary select';
      select.addEventListener('change', () => { input.value = select.value; fire(input, 'input', 'change'); });
      return;
    }
    addCSS(select);
    select.setAttribute('suggest', '');
    select.tabIndex = -1;
    // The select lies over the input and takes no pointer events, so its picker opens beside the input's box.
    if (getComputedStyle(select.parentElement).position === 'static') select.parentElement.style.position = 'relative';
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.autocomplete = 'off';
    // Moving the options into the picker's canvas makes the select choose the last one. Put the choice back.
    const chosen = select.selectedIndex;
    const picker = (this.picker = new SelectPicker(select, { layout: 'suggest' }));
    select.selectedIndex = select.querySelector('option[selected]') ? chosen : -1;
    picker.s.picker = picker;
    this.options = picker.options;
    const most = Math.max(1, ...this.options.map((o) => +o.dataset.n || 0));
    this.state = picker.s.suggest = { rank: [], y: [], alpha: [], share: this.options.map((o) => (+o.dataset.n || 0) / most), cursor: -1, count: 0, typed: '' };
    select.style.setProperty('--suggest-w', `${Math.min(340, innerWidth - 24) - 16}px`);
    this.filter('');

    input.addEventListener('input', () => { this.filter(input.value); this.open(); });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!this.open()) return; this.move(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter' && picker.open && this.state.cursor >= 0) { e.preventDefault(); this.take(this.state.cursor); }
      else if (e.key === 'Escape' && picker.open) { e.preventDefault(); this.close(); }
    });
    // A tap on a row is the select's own choice. Copy it to the input.
    select.addEventListener('input', () => this.#write());
    select.addEventListener('toggle', () => input.setAttribute('aria-expanded', String(picker.open)), true);
  }

  /** The options in the order they are shown for the typed text: those that start with it, then those that contain it. */
  matches(typed) {
    const t = typed.trim().toLowerCase();
    const scored = this.options.map((o, i) => {
      const name = (o.dataset.name ?? o.value).toLowerCase(), more = (o.dataset.more ?? '').toLowerCase();
      const score = !t ? 1 : name.startsWith(t) ? 0 : name.includes(t) ? 1 : more.includes(t) ? 2 : -1;
      return { i, score };
    }).filter((m) => m.score >= 0);
    return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((m) => m.i);
  }

  filter(typed) {
    const g = this.state, order = this.matches(typed);
    g.rank = this.options.map(() => -1);
    order.forEach((i, rank) => { g.rank[i] = rank; });
    g.count = order.length;
    g.typed = typed.trim();
    g.cursor = order[0] ?? -1;
    this.order = order;
    if (this.picker.open) this.picker.canvas.requestPaint();
  }

  /** Open the picker and keep the focus in the input. False when the browser refused. */
  open() {
    if (this.picker.open) return true;
    try { this.select.showPicker(); } catch (err) { this.note = `showPicker() was refused: ${err.message}`; return false; }
    // showPicker() moves the focus to an option. The typing must stay in the input.
    this.input.focus({ preventScroll: true });
    this.note = '';
    return true;
  }

  close() {
    this.picker.close();
    this.input.focus({ preventScroll: true });
  }

  /** Move the keyboard row by one, within the rows that are shown. */
  move(by) {
    const g = this.state, shown = this.order.slice(0, SUGGEST.rows);
    if (!shown.length) return;
    g.cursor = shown[clamp(shown.indexOf(g.cursor) + by, 0, shown.length - 1)];
    this.input.setAttribute('aria-activedescendant', this.options[g.cursor].id || '');
    this.picker.canvas.requestPaint();
  }

  /** Choose option i: it becomes the select's value and the input's text. */
  take(i) {
    const option = this.options[i];
    if (!option || option.disabled) return false;
    const was = option.selected;
    this.picker.choose(i, { close: true });
    if (was) this.#write(); // choose() fires no event for the option that is already the value
    this.input.focus({ preventScroll: true });
    return true;
  }

  #write() {
    const { input, select } = this;
    const option = select.selectedOptions[0];
    if (!option) return;
    input.value = option.dataset.name ?? option.value;
    this.filter(input.value);
    fire(input, 'change');
    // The select takes the focus when its picker closes. Give it back to the input after that.
    setTimeout(() => { if (document.activeElement === select || select.contains(document.activeElement)) input.focus({ preventScroll: true }); }, 0);
  }
}
// #endregion suggest

// #region tilt
// An article drawn on a plane that is turned about its horizontal middle line,
// with perspective. A 2D context has no perspective, so the article is drawn
// in strips 2 px tall with the nine-argument form of drawElementImage(): each
// strip at the width and place the plane gives its row. The hit box is set
// once with updateElementGeometry() and the plane's 4 by 4 matrix, so the
// browser's own text selection lands on the right letters. The selected lines
// are then drawn a second time on a plane lifted towards the viewer.
export class TiltedText extends Stage {
  /** Degrees about the horizontal axis. The top edge goes away from the viewer. */
  #angle = 42;
  /** Distance of the viewer, CSS px. */
  depth = 620;
  /** How far the selected lines rise off the plane, CSS px. */
  rise = 9;
  /** The selected lines, one rectangle each, in the article's own px. */
  rects = [];
  /** drawElementImage() calls in the last frame. */
  draws = 0;
  #lift = 0;
  #placed = '';

  constructor(canvas, { angle = 42 } = {}) {
    super(canvas);
    this.el = canvas.querySelector('[drawable]');
    this.#angle = angle;
    if (!this.start('tilted-text', (ctx, w, h) => this.#paint(ctx, w, h))) return;
    // A copy of the article that is never drawn and never given a transform.
    // Range rectangles are measured on it: under the plane's transform the
    // browser reports the bounding boxes of slanted quads.
    const twin = (this.twin = this.el.cloneNode(true));
    twin.removeAttribute('id');
    twin.dataset.twin = '';
    twin.inert = true;
    twin.setAttribute('aria-hidden', 'true');
    canvas.append(twin);
    // The copy keeps the drawable attribute: updateElementGeometry() refuses an element without it.
    // Its hit box is moved away, so the pointer never lands on it.
    canvas.updateElementGeometry(twin, { canvasTransform: FAR });
    document.addEventListener('selectionchange', () => this.#selection());
  }

  get angle() { return this.#angle; }
  set angle(v) { this.#angle = clamp(+v || 0, 0, 70); this.again(); }

  /** The plane's matrix for canvas CSS px. `z` lifts the plane towards the viewer along its normal. */
  matrix(z = 0) {
    const { canvas, el } = this;
    const view = new DOMMatrix();
    view.m34 = -1 / this.depth;
    return new DOMMatrix()
      .translate(canvas.clientWidth / 2, canvas.clientHeight / 2 + 6)
      .multiply(view)
      .rotateAxisAngle(1, 0, 0, this.#angle)
      .translate(-el.offsetWidth / 2, -el.offsetHeight / 2, z);
  }

  /** Where a point of the article is on the canvas. */
  project(m, x, y) {
    const p = m.transformPoint(new DOMPoint(x, y, 0, 1));
    return [p.x / p.w, p.y / p.w];
  }

  #selection() {
    const range = rangeIn(this.el);
    let rects = [];
    if (range) {
      // The same characters in the copy.
      const at = (node, offset) => { const r = new Range(); r.selectNodeContents(this.el); r.setEnd(node, offset); return r.toString().length; };
      const start = at(range.startContainer, range.startOffset), end = start + range.toString().length;
      rects = mergeLines(rectsIn(this.twin, textRange(this.twin, start, end)));
    }
    if (!rects.length && !this.rects.length) return;
    this.rects = rects;
    this.again();
  }

  // Draw rows y0..y1 of the article's rectangle x0..x1 on the plane m.
  #strips(ctx, m, x0, y0, x1, y1) {
    const step = 2;
    for (let y = y0; y < y1; y += step) {
      const sh = Math.min(step, y1 - y);
      const [ax, ay] = this.project(m, x0, y), [bx] = this.project(m, x1, y), [, cy] = this.project(m, x0, y + sh);
      ctx.drawElementImage(this.el, x0, y, x1 - x0, sh, ax, ay, bx - ax, cy - ay + 0.6);
      this.draws++;
    }
  }

  #quad(ctx, m, x0, y0, x1, y1) {
    ctx.beginPath();
    for (const [i, [x, y]] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].entries()) {
      const [px, py] = this.project(m, x, y);
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
    ctx.closePath();
  }

  #paint(ctx) {
    const { canvas, el } = this;
    const { ink, accent } = colours(canvas);
    const w = el.offsetWidth, h = el.offsetHeight, m = this.matrix();
    this.draws = 0;
    // The plane itself.
    this.#quad(ctx, m, 0, 0, w, h);
    ctx.save();
    ctx.globalAlpha = 0.07; ctx.fillStyle = ink; ctx.fill();
    ctx.globalAlpha = 0.3; ctx.strokeStyle = ink; ctx.stroke();
    ctx.restore();
    this.#strips(ctx, m, 0, 0, w, h);

    const target = this.rects.length ? 1 : 0;
    this.#lift = reduced() || Math.abs(target - this.#lift) < 0.01 ? target : this.#lift + (target - this.#lift) * 0.2;
    if (this.#lift > 0.01) {
      const up = this.matrix(this.rise * this.#lift);
      for (const r of this.rects) {
        const x0 = Math.max(0, r.x - 3), x1 = Math.min(w, r.x + r.w + 3), y0 = Math.max(0, r.y), y1 = Math.min(h, r.y + r.h);
        // A slab in the accent colour with a shadow that falls on the plane, then the line's own pixels on it.
        ctx.save();
        ctx.shadowColor = 'rgb(0 0 0 / .32)'; ctx.shadowBlur = 8 * this.#lift; ctx.shadowOffsetY = 6 * this.#lift;
        ctx.fillStyle = accent;
        this.#quad(ctx, up, x0, y0, x1, y1);
        ctx.fill();
        ctx.restore();
        this.#strips(ctx, up, x0, y0, x1, y1);
      }
    }
    // Every strip moved the article's one hit box and cut it down to that strip's source rectangle.
    // A draw of the whole article at no opacity makes the box whole again. Then put it on the plane,
    // perspective included.
    ctx.save();
    ctx.globalAlpha = 0;
    ctx.drawElementImage(el, 0, 0, w, h);
    ctx.restore();
    canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix().scale(this.unitOf(el)).multiply(m) });
    const placed = `${this.#angle}/${canvas.clientWidth}/${w}/${h}`;
    if (placed !== this.#placed) {
      this.#placed = placed;
      // Chromium remembers the hit test answer for a point. An attribute change clears it.
      el.toggleAttribute('data-moved');
    }
    if (this.#lift !== target) this.again();
  }
}

/** The range that covers characters start..end of root's text. */
export function textRange(root, start, end) {
  const range = new Range(), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let at = 0, began = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const next = at + node.length;
    if (!began && start < next) { range.setStart(node, start - at); began = true; }
    if (began && end <= next) { range.setEnd(node, end - at); return range; }
    at = next;
  }
  if (!began) { range.selectNodeContents(root); range.collapse(false); } else range.setEnd(root, root.childNodes.length);
  return range;
}
// #endregion tilt

// #region translate
// The article's text is not changed. For each translated sentence the canvas
// covers the sentence's line rectangles and writes the translation into the
// same rectangles with fillText(), a line at a time. The DOM, the selection
// and a copy keep the original words.
export class TranslateInPlace extends Stage {
  /** sentence element -> { text, label, at } */
  done = new Map();
  /** What the last frame wrote: one { lines, scale, left, rects } per translated sentence. */
  last = [];

  constructor(canvas) {
    super(canvas);
    this.el = canvas.querySelector('[drawable]');
    this.sentences = [...this.el.querySelectorAll('[data-s]')];
    if (!this.start('translate-in-place', (ctx, w, h) => this.#paint(ctx, w, h))) return;
    document.addEventListener('selectionchange', () => this.again());
  }

  /** The sentences that the selection touches. */
  picked() {
    const range = rangeIn(this.el);
    return range ? this.sentences.filter((s) => range.intersectsNode(s)) : [];
  }

  /**
   * Translate sentences with a provider: { label, convert(text) -> string | null | Promise }.
   * Returns how many were written. A sentence the provider has no answer for is left as it is.
   */
  async translate(provider, sentences = this.picked()) {
    let n = 0;
    for (const s of sentences) {
      const text = await provider.convert(s.textContent.replace(/\s+/g, ' ').trim());
      if (text == null) continue;
      if (this.plain) { s.dataset.original ??= s.textContent; s.textContent = text; }
      this.done.set(s, { text, label: provider.label, at: performance.now() });
      n++;
      if (!this.plain) this.again();
    }
    return n;
  }

  /** Show the original words again. */
  restore() {
    if (this.plain) for (const s of this.done.keys()) if (s.dataset.original) s.textContent = s.dataset.original;
    this.done.clear();
    if (!this.plain) this.again();
  }

  #paint(ctx, w, h) {
    const { canvas, el } = this;
    const { ink, bg, accent } = colours(canvas);
    const x0 = 12, y0 = 12;
    ctx.drawElementImage(el, x0, y0, el.offsetWidth, el.offsetHeight);
    const style = getComputedStyle(el);
    ctx.font = style.font;
    ctx.textBaseline = 'alphabetic';
    const metrics = ctx.measureText('Hg'), ascent = metrics.fontBoundingBoxAscent, descent = metrics.fontBoundingBoxDescent;
    const lineHeight = parseFloat(style.lineHeight) || (ascent + descent) * 1.3;
    const now = performance.now();
    let moving = false;
    this.last = [];
    for (const [sentence, entry] of this.done) {
      const lines = mergeLines(rectsIn(el, textRange(sentence, 0, sentence.textContent.length)));
      const words = entry.text.split(/\s+/);
      const t = reduced() ? 1 : clamp((now - entry.at) / 450, 0, 1);
      if (t < 1) moving = true;
      // A translation that is longer than the original is made narrower by the same amount on every line.
      const room = lines.reduce((sum, r) => sum + r.w, 0);
      const scale = Math.min(1, room / (ctx.measureText(entry.text).width * 1.06));
      const written = [];
      for (const [j, r] of lines.entries()) {
        // Words that fit this line. The last line takes what is left.
        let line = '';
        while (words.length) {
          const next = line ? `${line} ${words[0]}` : words[0];
          if (j < lines.length - 1 && ctx.measureText(next).width * scale > r.w && line) break;
          line = next;
          words.shift();
        }
        written.push(line);
        // The line appears from left to right, each line a little after the one above.
        const reveal = clamp(t * (lines.length + 1) - j, 0, 1);
        if (reveal <= 0) continue;
        // The cover is as tall as the line box, which is the height of the browser's selection highlight.
        const top = y0 + r.y - (lineHeight - r.h) / 2;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 + r.x - 2, top, (r.w + 9) * reveal, lineHeight);
        ctx.clip();
        ctx.fillStyle = bg; ctx.fillRect(x0 + r.x - 2, top, r.w + 9, lineHeight);
        ctx.globalAlpha = 0.16; ctx.fillStyle = accent; ctx.fillRect(x0 + r.x - 2, y0 + r.y, r.w + 4, r.h);
        ctx.globalAlpha = 1; ctx.fillStyle = ink;
        ctx.fillText(line, x0 + r.x, y0 + r.y + (r.h + ascent - descent) / 2, r.w);
        ctx.restore();
      }
      this.last.push({ lines: written, scale, left: words.length, rects: lines });
    }
    // The article was drawn once at its layout size, so its hit box is already where it is drawn.
    if (moving) this.again();
  }
}
// #endregion translate

// #region ticks
// A pulse for each word and each sentence that enters or leaves the
// selection: navigator.vibrate() where there is a motor, and a ring drawn at
// the moving end of the selection everywhere.
export class SelectionTicks extends Stage {
  /** The last ticks: { kind: 'word' | 'sentence', at, x, y, ok } */
  ticks = [];
  /** Call navigator.vibrate(). */
  vibrate = true;
  /** vibrate() calls that returned true, and false. */
  pulses = 0;
  refused = 0;
  #words = 0;
  #sentences = 0;

  constructor(canvas) {
    super(canvas);
    this.el = canvas.querySelector('[drawable]');
    if (!this.start('selection-ticks', (ctx, w, h) => this.#paint(ctx, w, h))) return;
    document.addEventListener('selectionchange', () => this.#change());
  }

  #change() {
    const range = rangeIn(this.el);
    const text = range ? range.toString() : '';
    const words = (text.match(/\S+/g) ?? []).length, sentences = (text.match(/[.!?](?=\s|$)/g) ?? []).length;
    let at = null;
    if (range) {
      // The end of the selection that moves.
      const sel = getSelection(), focus = new Range();
      focus.setStart(sel.focusNode, sel.focusOffset);
      const r = rectsIn(this.el, focus)[0] ?? rectsIn(this.el, range).at(-1);
      if (r) at = { x: 12 + r.x, y: 12 + r.y + r.h / 2 };
    }
    if (at && sentences !== this.#sentences) this.tick('sentence', at);
    else if (at && words !== this.#words) this.tick('word', at);
    this.#words = words;
    this.#sentences = sentences;
    this.again();
  }

  /** One pulse. `ok` is what navigator.vibrate() returned, or null when it was not called. */
  tick(kind, { x = 0, y = 0 } = {}) {
    let ok = null;
    if (this.vibrate && 'vibrate' in navigator) {
      ok = navigator.vibrate(kind === 'sentence' ? 24 : 8);
      if (ok) this.pulses++; else this.refused++;
    }
    this.ticks.push({ kind, at: performance.now(), x, y, ok });
    if (this.ticks.length > 48) this.ticks.shift();
    this.again();
    return ok;
  }

  #paint(ctx, w, h) {
    const { canvas, el } = this;
    const { ink, accent } = colours(canvas);
    ctx.drawElementImage(el, 12, 12, el.offsetWidth, el.offsetHeight);
    const now = performance.now();
    let moving = false;
    for (const tick of this.ticks) {
      const age = (now - tick.at) / (tick.kind === 'sentence' ? 700 : 420);
      if (age >= 1 || reduced()) continue;
      moving = true;
      ctx.save();
      ctx.globalAlpha = (1 - age) * 0.9;
      ctx.strokeStyle = accent;
      ctx.lineWidth = tick.kind === 'sentence' ? 3.5 : 2;
      ctx.beginPath();
      ctx.arc(tick.x, tick.y, 5 + age * (tick.kind === 'sentence' ? 46 : 24), 0, 7);
      ctx.stroke();
      ctx.restore();
    }
    // A strip of the last pulses along the bottom: a short bar for a word, a tall bar for a sentence.
    const n = this.ticks.length;
    for (const [i, tick] of this.ticks.entries()) {
      const tall = tick.kind === 'sentence' ? 20 : 9;
      ctx.globalAlpha = tick.ok === false ? 0.3 : 0.85;
      ctx.fillStyle = tick.kind === 'sentence' ? accent : ink;
      ctx.fillRect(w - 14 - (n - i) * 6, h - 10 - tall, 4, tall);
    }
    ctx.globalAlpha = 1;
    if (moving) this.again();
  }
}
// #endregion ticks

// #region controls
// A Range cannot be made inside an <input> or a <textarea>, so the selected
// letters have no rectangles to ask for. For an input they are worked out
// with measureText() from selectionStart and selectionEnd. For a textarea
// the text is laid out again in a hidden block with the same font, padding
// and width, and a Range there gives one rectangle per letter. Each selected
// letter is then drawn again from the control's own picture, a slice at a
// time, on a band that moves in a wave.
export class ControlSelection extends Stage {
  /** Draw the effect when the control does not have focus too. For tests. */
  always = false;
  /** What the last frame drew for each control: { control, letters, first, last } */
  last = [];
  #since = 0;
  #had = false;

  constructor(canvas) {
    super(canvas);
    this.controls = [...canvas.querySelectorAll('input, textarea')];
    if (!this.start('control-selection', (ctx, w, h) => this.#paint(ctx, w, h))) return;
    const mirror = (this.mirror = document.createElement('div'));
    mirror.className = 'control-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    canvas.append(mirror);
    const again = () => this.again();
    for (const c of this.controls) for (const type of ['select', 'input', 'focus', 'blur', 'scroll', 'keyup', 'pointerup', 'pointermove']) c.addEventListener(type, again);
    document.addEventListener('selectionchange', again);
  }

  /** One rectangle per selected letter, in the control's own px from its border box corner. At most 240. */
  letters(control) {
    const start = control.selectionStart ?? 0, end = Math.min(control.selectionEnd ?? 0, start + 240);
    if (end <= start || (!this.always && document.activeElement !== control)) return [];
    const style = getComputedStyle(control), text = control.value;
    const left = parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
    const top = parseFloat(style.borderTopWidth) + parseFloat(style.paddingTop);
    const out = [];
    if (control.localName === 'input') {
      const { ctx } = this;
      ctx.save();
      ctx.font = style.font;
      ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
      const height = control.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      let x = ctx.measureText(text.slice(0, start)).width;
      for (let i = start; i < end; i++) {
        const next = ctx.measureText(text.slice(0, i + 1)).width;
        out.push({ x: left + x - control.scrollLeft, y: top, w: next - x, h: height });
        x = next;
      }
      ctx.restore();
      return out;
    }
    const { mirror } = this;
    for (const p of ['font', 'letterSpacing', 'padding', 'borderWidth', 'boxSizing', 'tabSize', 'textAlign', 'textIndent']) mirror.style[p] = style[p];
    mirror.style.borderStyle = 'solid';
    mirror.style.borderColor = 'transparent';
    // The width that the text wraps in: the textarea's box less its scroll bar.
    mirror.style.width = `${control.offsetWidth - (control.offsetWidth - control.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth))}px`;
    if (mirror.textContent !== text) mirror.textContent = text;
    const node = mirror.firstChild, base = mirror.getBoundingClientRect(), k = base.width ? mirror.offsetWidth / base.width : 1;
    if (!node) return out;
    const range = new Range();
    for (let i = start; i < end; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const r = range.getClientRects()[0];
      if (!r || r.width < 0.5) continue;
      out.push({ x: (r.left - base.left) * k, y: (r.top - base.top) * k - control.scrollTop, w: r.width * k, h: r.height * k });
    }
    return out;
  }

  #paint(ctx, w, h) {
    const { canvas } = this;
    const { accent } = colours(canvas);
    const now = performance.now();
    let y = 14, any = false;
    this.last = [];
    for (const control of this.controls) {
      const x = 12, cw = control.offsetWidth, ch = control.offsetHeight;
      ctx.drawElementImage(control, x, y, cw, ch);
      const letters = this.letters(control);
      if (letters.length) {
        any = true;
        if (!this.#had) this.#since = now;
        const style = getComputedStyle(control);
        const rgb = (style.backgroundColor.match(/[\d.]+/g) ?? [255, 255, 255]).map(Number);
        const light = rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11 > 128;
        const bl = parseFloat(style.borderLeftWidth), bt = parseFloat(style.borderTopWidth);
        const amp = reduced() ? 0 : 3.2 * clamp((now - this.#since) / 300, 0, 1);
        ctx.save();
        // Nothing is drawn outside the control's padding box, as with its own text.
        ctx.beginPath();
        ctx.rect(x + bl, y + bt, control.clientWidth, control.clientHeight);
        ctx.clip();
        const dy = (i) => Math.sin(now / 130 - i * 0.55) * amp;
        // Cover the letters where they stand, then draw the band they ride on.
        ctx.fillStyle = style.backgroundColor;
        for (const l of letters) ctx.fillRect(x + l.x - 0.5, y + l.y, l.w + 1, l.h);
        ctx.fillStyle = accent;
        ctx.globalAlpha = 0.38;
        for (const [i, l] of letters.entries()) ctx.fillRect(x + l.x - 0.5, y + l.y + dy(i), l.w + 1, l.h);
        ctx.globalAlpha = 1;
        // The control's background is in every slice. Multiply (or screen, on a dark control) leaves only the letter.
        ctx.globalCompositeOperation = light ? 'multiply' : 'screen';
        for (const [i, l] of letters.entries()) {
          if (l.x + l.w < bl || l.x > bl + control.clientWidth) continue;
          ctx.drawElementImage(control, l.x, l.y, l.w, l.h, x + l.x, y + l.y + dy(i), l.w, l.h);
        }
        ctx.restore();
        // The slices moved the control's hit box. Put it back over the whole control without drawing.
        ctx.save();
        ctx.globalAlpha = 0;
        ctx.drawElementImage(control, x, y, cw, ch);
        ctx.restore();
        this.last.push({ control, letters: letters.length, first: { ...letters[0], x: x + letters[0].x, y: y + letters[0].y }, last: { ...letters.at(-1), x: x + letters.at(-1).x, y: y + letters.at(-1).y } });
      }
      y += ch + 14;
    }
    this.#had = any;
    if (any && !reduced()) this.again();
  }
}
// #endregion controls
