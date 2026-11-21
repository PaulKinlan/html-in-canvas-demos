// DatalistPicker: the suggestions of <input list> drawn by a canvas.
//
//   <input list="stations" picker="list">     picker = list | chips
//   <datalist id="stations"><option value="Leeds" label="LDS">…</datalist>
//   <script type="module" src="/lib/datalist-picker.js"></script>
//
// The browser's own datalist popup cannot be styled and no canvas can be put
// in it. So this takes the list over: it removes the input's list attribute
// (that stops the built-in popup), moves the <datalist> into a canvas inside a
// popover, and shows it with display: block. The <option> elements stay the
// suggestions. They are drawn one at a time by drawElementImage(), so a
// suggestion that stops matching fades out and the others move up.
//
// The input keeps its value, its form submission and its focus. Typing
// filters, the arrow keys move through the matches, Enter or a tap chooses.
// Without HTML-in-canvas nothing is changed and the built-in datalist works.
//
// RangeLabels, at the end, draws the options of a range input's datalist as
// labels under the slider.

import { PlacedPopover, supported } from './placed-popover.js';
export { supported };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const CSS_TEXT = `
.datalist-picker > canvas { touch-action: none; }
.datalist-picker datalist { display: block; position: absolute; left: 0; top: 0; width: max-content; }
.datalist-picker option { box-sizing: border-box; cursor: pointer; font: inherit; color: inherit; -webkit-user-select: none; user-select: none; }
.datalist-picker.is-list option { width: var(--list-w, 240px); min-height: 40px; padding: 9px 12px; border-radius: 9px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.datalist-picker option[data-note]::after { content: attr(data-note); opacity: .65; font-size: .82em; margin-left: 8px; }
.datalist-picker.is-list option[data-note]::after { float: right; line-height: 1.75; }
.datalist-picker.is-chips option { width: max-content; max-width: 240px; min-height: 36px; padding: 7px 14px; border-radius: 999px; white-space: nowrap;
  background: color-mix(in srgb, currentColor 9%, transparent); border: 1px solid color-mix(in srgb, currentColor 16%, transparent); }
.datalist-picker.is-chips option[data-active] { background: var(--picker-accent, #0a66d0); color: #fff; }
.datalist-picker.is-chips option:hover { border-color: currentColor; }
`;

// #region layouts
// A layout gives every matching option a place. s.order lists the matching
// option indexes, best match first. prepare() fills s.at[i] = { x, y } and
// s.contentH, and the picker subtracts the scroll offset.
export const layouts = {
  // One row per suggestion.
  list: {
    width: (anchorW, vw) => clamp(anchorW, 220, vw - 16),
    prepare(s) {
      let y = 6;
      for (const i of s.order) { s.at[i] = { x: 6, y }; y += s.sizes[i].h + 2; }
      s.contentH = y + 4;
    },
    place: (i, s) => ({ x: s.at[i].x, y: s.at[i].y - s.scroll }),
    // The highlight behind the active row is drawn by the canvas and slides between rows.
    under(ctx, s, picker) {
      const i = s.active, hl = (picker.hl ??= { y: 0, h: 40, a: 0 });
      const to = i >= 0 && s.at[i] ? { y: s.at[i].y - s.scroll, h: s.sizes[i].h, a: 1 } : { y: hl.y, h: hl.h, a: 0 };
      const k = 1 - Math.exp(-s.dt * 22);
      let moving = false;
      for (const key of ['y', 'h', 'a']) {
        const gap = to[key] - hl[key];
        if (Math.abs(gap) > 0.01) { hl[key] = hl.a < 0.05 && key !== 'a' ? to[key] : hl[key] + gap * k; moving = true; } else hl[key] = to[key];
      }
      ctx.globalAlpha = hl.a * 0.16 * s.open;
      ctx.fillStyle = s.accent;
      ctx.beginPath();
      ctx.roundRect(6, hl.y, s.w - 12, hl.h, 9);
      ctx.fill();
      return moving;
    },
  },
  // Pills that wrap. The active one is larger.
  chips: {
    width: (anchorW, vw) => Math.min(380, vw - 16),
    prepare(s) {
      let x = 10, y = 10, rowH = 0;
      for (const i of s.order) {
        const { w, h } = s.sizes[i];
        if (x > 10 && x + w > s.wantW - 10) { x = 10; y += rowH + 8; rowH = 0; }
        s.at[i] = { x, y };
        x += w + 8;
        rowH = Math.max(rowH, h);
      }
      s.contentH = y + rowH + 10;
    },
    place: (i, s) => ({ x: s.at[i].x, y: s.at[i].y - s.scroll, scale: i === s.active ? 1.1 : 1, order: i === s.active ? 1 : 0 }),
  },
};
// #endregion layouts

let ids = 0;

export class DatalistPicker {
  static #all = new WeakMap();
  static for(input) { return DatalistPicker.#all.get(input); }

  #scroll = 0;
  #drag = null;
  #quiet = false;

  constructor(input, { layout = input.getAttribute('picker') || 'list' } = {}) {
    this.input = input;
    this.datalist = input.list;
    this.layout = layouts[layout] ?? layouts.list;
    this.layoutName = layouts[layout] ? layout : 'list';
    this.active = -1;
    if (!supported || !this.datalist || DatalistPicker.#all.has(input)) return;
    DatalistPicker.#all.set(input, this);
    const { datalist } = this;

    // #region takeover
    // Without the list attribute the browser shows no popup of its own.
    input.removeAttribute('list');
    input.autocomplete = 'off';
    datalist.id ||= `datalist-picker-${++ids}`;
    datalist.setAttribute('role', 'listbox');
    Object.assign(input, { role: 'combobox', ariaAutoComplete: 'list', ariaExpanded: 'false' });
    input.setAttribute('aria-controls', datalist.id);

    this.pop = new PlacedPopover({
      anchor: input,
      className: `datalist-picker is-${this.layoutName}`,
      items: () => this.options,
      prepare: (s) => this.#prepare(s),
      size: (s) => [s.wantW, Math.min(s.contentH, s.maxH)],
      place: (i, s) => (s.at[i] ? this.layout.place(i, s) : null),
      under: this.layout.under && ((ctx, s) => this.layout.under(ctx, s, this)),
      onhide: () => { input.ariaExpanded = 'false'; input.removeAttribute('aria-activedescendant'); },
    });
    addCss(input);
    this.pop.adopt(datalist); // the <datalist> and its options now live in the canvas
    this.#setUp();
    new MutationObserver(() => { this.#setUp(); this.#filter(); }).observe(datalist, { childList: true });
    // #endregion takeover

    input.addEventListener('input', () => { if (!this.#quiet) { this.active = -1; this.show(); } });
    input.addEventListener('pointerdown', () => { if (document.activeElement === input) this.show(); });
    input.addEventListener('focus', () => this.show());
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) this.pop.hide(); }, 120));
    input.addEventListener('keydown', (e) => this.#key(e));
    const { host } = this.pop;
    host.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the input
    host.addEventListener('click', (e) => { const option = e.target.closest?.('option'); if (option) this.choose(this.options.indexOf(option)); });
    host.addEventListener('wheel', (e) => { e.preventDefault(); this.#scrollBy(e.deltaY); }, { passive: false });
    host.addEventListener('pointerdown', (e) => { this.#drag = { y: e.clientY, id: e.pointerId, moved: false }; });
    host.addEventListener('pointermove', (e) => {
      const d = this.#drag;
      if (!d || d.id !== e.pointerId || !(e.buttons > 0)) return;
      if (!d.moved && Math.abs(e.clientY - d.y) > 7) { d.moved = true; d.y = e.clientY; host.setPointerCapture(e.pointerId); }
      if (d.moved) { this.#scrollBy(d.y - e.clientY); d.y = e.clientY; }
    });
    host.addEventListener('pointerup', () => { this.#drag = null; });
    host.addEventListener('pointercancel', () => { this.#drag = null; });
  }

  get options() { return [...this.datalist.options]; }
  get open() { return !!this.pop?.open; }

  // Every option needs the drawable attribute, an id for aria-activedescendant, and something to show.
  #setUp() {
    for (const option of this.options) {
      if (option.hasAttribute('drawable')) continue;
      option.setAttribute('drawable', '');
      option.id ||= `${this.datalist.id}-${++ids}`;
      // The option shows its label attribute instead of its text when it has one.
      // Here the text is the value, and the label moves to data-note, which ::after draws.
      const label = option.getAttribute('label');
      if (!option.textContent.trim() || label) option.textContent = option.value;
      if (label && label !== option.value) option.dataset.note = label;
      option.removeAttribute('label');
    }
  }

  // #region filter
  // Which options match what is typed, best first: the value starts with it,
  // then a word starts with it, then it appears anywhere.
  #filter() {
    const q = this.input.value.trim().toLowerCase();
    const scored = [];
    for (const [i, option] of this.options.entries()) {
      if (option.disabled) continue;
      const value = option.value.toLowerCase(), text = `${value} ${option.textContent} ${option.dataset.note ?? ''}`.toLowerCase();
      const score = !q ? 0 : value.startsWith(q) ? 0 : new RegExp(`(^|[^\\p{L}\\p{N}])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'u').test(text) ? 1 : text.includes(q) ? 2 : -1;
      if (score >= 0) scored.push([score, i]);
    }
    scored.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    this.order = scored.map(([, i]) => i);
    if (!this.order.includes(this.active)) this.active = -1;
    return this.order;
  }

  // #endregion filter

  #prepare(s) {
    const vv = window.visualViewport;
    s.order = this.order ?? [];
    s.active = this.active;
    s.at = [];
    s.wantW = this.width;
    s.maxH = Math.max(120, Math.min(320, (vv?.height ?? innerHeight) * 0.42));
    this.layout.prepare(s);
    const max = Math.max(0, s.contentH - s.maxH);
    if (this.reveal && s.at[this.active]) {
      // Keep the active option in view.
      const { y } = s.at[this.active], h = s.sizes[this.active].h;
      if (y - 6 < this.#scroll) this.#scroll = y - 6;
      if (y + h + 6 > this.#scroll + s.maxH) this.#scroll = y + h + 6 - s.maxH;
      this.reveal = false;
    }
    s.scroll = this.#scroll = clamp(this.#scroll, 0, max);
    s.more = max - this.#scroll > 1;
  }

  #scrollBy(dy) { this.#scroll += dy; this.pop.invalidate(); }

  show() {
    if (!this.pop) return;
    const order = this.#filter();
    // Like the built-in popup: nothing to suggest, nothing shown.
    const only = order.length === 1 && this.options[order[0]].value === this.input.value;
    if (!order.length || only) return this.pop.hide();
    this.width = this.layout.width(this.input.offsetWidth, document.documentElement.clientWidth);
    this.pop.canvas.style.setProperty('--list-w', `${this.width - 12}px`);
    if (!this.open) this.#scroll = 0;
    this.input.ariaExpanded = 'true';
    this.#setActive(this.active);
    this.pop.show();
  }

  hide() { this.pop?.hide(); }

  #setActive(i) {
    for (const option of this.datalist.querySelectorAll('[data-active]')) { delete option.dataset.active; option.removeAttribute('aria-selected'); }
    this.active = i;
    const option = this.options[i];
    if (option) { option.dataset.active = ''; option.setAttribute('aria-selected', 'true'); this.input.setAttribute('aria-activedescendant', option.id); }
    else this.input.removeAttribute('aria-activedescendant');
    this.reveal = true;
    this.pop.invalidate();
  }

  // #region keys
  #key(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!this.open) { this.show(); if (!this.open) return; }
      const n = this.order.length, at = this.order.indexOf(this.active), step = e.key === 'ArrowDown' ? 1 : -1;
      this.#setActive(this.order[at < 0 ? (step > 0 ? 0 : n - 1) : (at + step + n) % n]);
    } else if (e.key === 'Enter' && this.open && this.active >= 0) {
      e.preventDefault(); // do not submit the form
      this.choose(this.active);
    } else if (e.key === 'Escape' && this.open) {
      e.preventDefault();
      this.hide();
    }
  }
  // #endregion keys

  // #region choose
  /** Put option i's value in the input, as if it had been typed. */
  choose(i) {
    const option = this.options[i];
    if (!option || option.disabled) return;
    this.#quiet = true;
    this.input.value = option.value;
    this.input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: option.value }));
    this.input.dispatchEvent(new Event('change', { bubbles: true }));
    this.#quiet = false;
    this.hide();
  }
  // #endregion choose
}

function addCss(node) {
  const root = node.getRootNode();
  const head = root.nodeType === 9 ? root.head : root;
  if (head.querySelector('style[data-datalist-picker]')) return;
  const style = document.createElement('style');
  style.dataset.datalistPicker = '';
  style.textContent = CSS_TEXT + RANGE_CSS;
  head.append(style);
}

// #region range-labels
// RangeLabels: <input type="range" list> draws a tick for each option of its
// datalist, but not the option's label. Here the range input and its
// <datalist> are both inside a canvas. The canvas draws the input, then each
// <option> under its tick. An option is a real element: a tap on it sets
// the value.
const RANGE_CSS = `
canvas.range-labels { display: block; width: 100%; touch-action: pan-y; }
canvas.range-labels > input { width: 100%; margin: 0; box-sizing: border-box; }
canvas.range-labels > datalist { display: block; position: absolute; left: 0; top: 0; width: max-content; }
canvas.range-labels option { width: max-content; padding: 4px 8px; border-radius: 8px; font: inherit; cursor: pointer; white-space: nowrap; }
canvas.range-labels option[data-active] { font-weight: 700; }
`;

export class RangeLabels {
  frames = 0;
  note = '';
  #at = new WeakMap();

  constructor(input, { thumb = 16 } = {}) {
    this.input = input;
    this.datalist = input.list;
    this.thumb = thumb;
    if (!supported || !this.datalist) return;
    addCss(input);
    const canvas = (this.canvas = document.createElement('canvas'));
    canvas.className = 'range-labels';
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    input.before(canvas);
    canvas.append(input, this.datalist);
    input.setAttribute('drawable', '');
    for (const option of this.datalist.options) {
      option.setAttribute('drawable', '');
      if (!option.textContent.trim()) option.textContent = option.label || option.value;
      option.addEventListener('click', () => {
        input.value = option.value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
    canvas.addEventListener('paint', () => this.#draw());
    input.addEventListener('input', () => canvas.requestPaint());
    new ResizeObserver(() => canvas.requestPaint()).observe(canvas);
    canvas.requestPaint();
  }

  #draw() {
    const { canvas, input, thumb } = this;
    const w = canvas.clientWidth, ih = input.offsetHeight;
    const options = [...this.datalist.options];
    const h = ih + 14 + Math.max(0, ...options.map((o) => o.offsetHeight)) * 1.35;
    if (!w) return;
    canvas.style.height = `${h}px`;
    const dpr = devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    const min = +input.min || 0, max = input.max === '' ? 100 : +input.max, value = +input.value;
    // Where the thumb's centre is for a value.
    const xOf = (v) => thumb / 2 + ((v - min) / (max - min || 1)) * (w - thumb);
    let moving = false;
    try {
      const ctx = canvas.getContext('2d');
      ctx.reset();
      ctx.scale(dpr, dpr);
      ctx.drawElementImage(input, 0, 0, w, ih);
      let nearest = options[0];
      for (const option of options) if (Math.abs(+option.value - value) < Math.abs(+nearest.value - value)) nearest = option;
      for (const option of options) {
        const on = option === nearest;
        if (on !== option.hasAttribute('data-active')) option.toggleAttribute('data-active', on);
        // The label grows as the thumb gets near it.
        const near = clamp(1 - Math.abs(+option.value - value) / ((max - min) * 0.18), 0, 1);
        const st = this.#at.get(option) ?? { k: near };
        this.#at.set(option, st);
        if (Math.abs(near - st.k) > 0.005) { st.k += (near - st.k) * 0.25; moving = true; } else st.k = near;
        const ow = option.offsetWidth, oh = option.offsetHeight, scale = 1 + st.k * 0.35;
        const cx = clamp(xOf(+option.value), (ow * scale) / 2, w - (ow * scale) / 2);
        ctx.save();
        ctx.globalAlpha = 0.6 + st.k * 0.4;
        ctx.translate(cx, ih + 10 + (oh * 1.35) / 2);
        ctx.scale(scale, scale);
        ctx.drawElementImage(option, -ow / 2, -oh / 2, ow, oh);
        ctx.restore();
      }
      this.frames++;
    } catch (err) {
      if (!/paint record/.test(err.message)) this.note = err.message;
      moving = true;
    }
    if (moving) requestAnimationFrame(() => canvas.requestPaint());
  }
}
// #endregion range-labels

/** Turn every <input list picker> on the page into a DatalistPicker. */
export function upgrade(root = document) {
  return [...root.querySelectorAll('input[list][picker]')].map((input) => DatalistPicker.for(input) ?? new DatalistPicker(input));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgrade());
  else queueMicrotask(() => upgrade());
}
