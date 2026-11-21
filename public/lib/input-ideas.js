// Five more pickers on real <input> elements, drawn by a canvas.
//
//   new DialRange(canvas)                 <canvas><input type="range" drawable></canvas>, drawn round an arc
//   new DateRangePicker(start, end)       two <input type="date">, one calendar, a band between the two days
//   new ColourWheel(input)                <input type="color" list>, a wheel whose pixels are read back
//   new WeekYearPicker(input)             <input type="week">, a year of week buttons under a fisheye
//   new GhostText(canvas)                 <canvas><input list drawable></canvas>, the best option drawn after the caret
//
// Each input keeps its value, its form entry, its input and change events and
// its keyboard handling. The canvas does the drawing. Without HTML-in-canvas
// every input is left as (or put back as) an ordinary input.
//
// The three popover pickers are built on PlacedPopover (placed-popover.js).
// The calendar part of DateRangePicker follows CalendarPicker in
// input-pickers.js, which does not export its base class, so the parts needed
// are repeated here.

import { PlacedPopover, supported } from './placed-popover.js';
export { supported };

const TAU = Math.PI * 2;
const DAY = 864e5;
const FAR = typeof DOMMatrix === 'undefined' ? null : new DOMMatrix().translate(-1e5, -1e5);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad = (n) => String(n).padStart(2, '0');
const el = (tag, props = {}, attrs = {}) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const fire = (input, ...types) => { for (const type of types) input.dispatchEvent(new Event(type, { bubbles: true })); };
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const today = () => iso(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4));
const dayNumber = (date) => Math.round(Date.parse(date) / DAY);

const CSS_TEXT = `
canvas.dial-range { display: block; width: 280px; max-width: 100%; height: 216px; touch-action: none; cursor: pointer; overflow-anchor: none; }
canvas.dial-range > input[type="range"] { display: block; margin: 0; pointer-events: none; outline: none; }
canvas.dial-range > output { display: block; width: max-content; font: 600 40px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums; pointer-events: none; }
canvas.ghost-text { display: block; width: 100%; max-width: 360px; height: 50px; overflow-anchor: none; }
canvas.ghost-text > input { display: block; box-sizing: border-box; width: calc(100% - 6px); height: 44px; margin: 0; }
canvas.ghost-text > input:focus-visible { outline: 2px solid var(--picker-accent, #0a66d0); outline-offset: -2px; }
canvas.ghost-text > datalist { display: block; }
canvas.ghost-text option { display: block; box-sizing: border-box; width: max-content; min-height: 0; padding: 0; margin: 0; white-space: pre; line-height: normal; cursor: pointer; }
input[data-idea-picker]::-webkit-calendar-picker-indicator { display: none; }
.idea-picker > canvas { touch-action: none; overflow-anchor: none; }
.idea-picker button, .idea-picker span { box-sizing: border-box; font: inherit; color: inherit; margin: 0; }
.idea-picker button { border: 0; background: none; padding: 0; cursor: pointer; border-radius: 999px; -webkit-tap-highlight-color: transparent; }
.idea-picker button:focus-visible { outline: 2px solid var(--picker-accent, #0a66d0); outline-offset: -2px; }
.idea-picker button:disabled { opacity: .3; cursor: default; }
.idea-picker .cell { width: 40px; height: 40px; font-size: 15px; font-variant-numeric: tabular-nums; }
.idea-picker .cell[aria-pressed="true"] { color: #fff; font-weight: 700; }
.idea-picker .day.out { opacity: .35; }
.idea-picker .day.today:not([aria-pressed="true"]) { box-shadow: inset 0 0 0 1.5px currentColor; }
.idea-picker .title { display: block; height: 40px; padding: 0 12px; font-weight: 700; font-size: 16px; line-height: 40px; white-space: nowrap; }
.idea-picker .nav { width: 40px; height: 40px; font-size: 20px; }
.idea-picker .nav:hover, .idea-picker .done:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
.idea-picker .dow { display: block; width: 40px; height: 24px; text-align: center; font-size: 12px; opacity: .6; }
.idea-picker .status { display: block; width: 196px; height: 36px; font-size: 13px; line-height: 18px; opacity: .8; }
.idea-picker .done { height: 36px; padding: 0 14px; border-radius: 10px; font-weight: 600; background: color-mix(in srgb, currentColor 8%, transparent); }
.idea-picker .swatch { width: 24px; height: 24px; background: var(--c); border: 2px solid #fff; box-shadow: inset 0 0 0 1px rgb(0 0 0 / .4); }
.idea-picker .swatch[aria-pressed="true"] { border-color: #000; box-shadow: inset 0 0 0 1px #fff; }
.idea-picker input[type="range"] { display: block; width: 180px; height: 24px; margin: 0; accent-color: var(--picker-accent, #0a66d0); }
.idea-picker .hex { display: block; width: 64px; height: 24px; font: 12px/24px ui-monospace, monospace; text-align: right; }
.idea-picker .week { width: 36px; height: 32px; border-radius: 8px; font-size: 14px; font-variant-numeric: tabular-nums; background: color-mix(in srgb, currentColor 9%, transparent); }
.idea-picker .week[aria-pressed="true"] { background: var(--picker-accent, #0a66d0); color: #fff; font-weight: 700; }
.idea-picker .info { display: block; width: 260px; height: 20px; text-align: center; font-size: 13px; line-height: 20px; white-space: nowrap; }
`;

/**
 * One pixel of a canvas, read from a 1 by 1 copy made with drawImage(). The
 * drawable canvas itself is never read with getImageData(): on Android a
 * drawable 2D canvas that is read that way can lose every 2D context on the page.
 */
let scratch;
export function pixelOf(canvas, x, y) {
  scratch ??= Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d');
  scratch.clearRect(0, 0, 1, 1);
  scratch.drawImage(canvas, x, y, 1, 1, 0, 0, 1, 1);
  return scratch.getImageData(0, 0, 1, 1).data;
}

function addCSS(node) {
  const root = node.getRootNode(), head = root.nodeType === 9 ? root.head : root;
  if (!head.querySelector('style[data-input-ideas]')) head.append(el('style', { textContent: CSS_TEXT }, { 'data-input-ideas': '' }));
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

/**
 * Take the children of a canvas out and put them where the canvas is. Used
 * when HTML-in-canvas is missing or the canvas lost its context: the children
 * of a canvas are not shown otherwise, and the input must stay usable.
 */
export function unwrap(canvas) {
  if (canvas.hidden) return;
  const input = canvas.querySelector('input');
  if (input?.dataset.list) { input.setAttribute('list', input.dataset.list); delete input.dataset.list; }
  if (input?.type === 'range') input.style.width = '';
  canvas.before(...canvas.children);
  canvas.hidden = true;
}

// #region dial
// A range input drawn round an arc. The canvas draws the input's own picture
// in slices a few pixels wide, each under its own rotation, so the built-in
// track, thumb and tick marks follow the arc. The input is as wide as the arc
// is long, so nothing is stretched.
export class DialRange {
  /** Width of the built-in thumb in Chromium. The thumb's centre moves between half of this from each end. */
  static THUMB = 16;
  frames = 0;
  note = '';

  constructor(canvas, { radius = 96, start = 150, sweep = 240, slice = 3, sourceRect = true, box = true } = {}) {
    this.canvas = canvas;
    this.input = canvas.querySelector('input[type="range"]');
    this.readout = canvas.querySelector('output');
    Object.assign(this, { radius, slice, sourceRect, box, a0: (start * Math.PI) / 180, sweep: (sweep * Math.PI) / 180 });
    if (!supported) { unwrap(canvas); return; }
    addCSS(canvas);
    canvas.classList.add('dial-range');
    this.input.style.width = `${Math.round(radius * this.sweep)}px`;
    this.ctx = canvas.getContext('2d');
    fit(canvas);
    canvas.addEventListener('paint', () => this.#paint());
    canvas.addEventListener('contextlost', () => { this.note = 'the canvas lost its context'; unwrap(canvas); });
    for (const type of ['input', 'focus', 'blur']) this.input.addEventListener(type, () => { this.#label(); canvas.requestPaint(); });
    this.#label();

    // The pointer is mapped by hand: the input's hit box is a rectangle, and
    // each slice moves it, so the input takes no pointer events itself.
    let down = false, before = '';
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button || this.input.disabled || this.valueAt(e.clientX, e.clientY) === null) return;
      down = true;
      before = this.input.value;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic event has no pointer to capture */ }
      if (e.isTrusted) this.input.focus({ preventScroll: true });
      this.#set(this.valueAt(e.clientX, e.clientY));
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => { if (down) this.#set(this.valueAt(e.clientX, e.clientY, true)); });
    const up = () => {
      if (!down) return;
      down = false;
      if (this.input.value !== before) fire(this.input, 'change');
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  get centre() { return { x: this.canvas.clientWidth / 2, y: this.radius + 24 }; }

  /** The value at a point of the window, or null when the point is near the middle of the dial. */
  valueAt(clientX, clientY, anywhere = false) {
    const { input, radius } = this, r = this.canvas.getBoundingClientRect(), c = this.centre;
    const dx = clientX - r.left - c.x, dy = clientY - r.top - c.y;
    if (!anywhere && Math.hypot(dx, dy) < radius * 0.45) return null;
    let turn = (Math.atan2(dy, dx) - this.a0 + 2 * TAU) % TAU; // angle from the start of the arc, clockwise
    if (turn > this.sweep) turn = turn - this.sweep < (TAU - this.sweep) / 2 ? this.sweep : 0; // in the gap: the nearer end
    const w = input.offsetWidth, along = (turn / this.sweep) * w;
    const f = clamp((along - DialRange.THUMB / 2) / (w - DialRange.THUMB), 0, 1);
    const min = Number(input.min || 0), max = Number(input.max || 100);
    return min + f * (max - min);
  }

  #set(number) {
    const { input } = this, old = input.value;
    input.valueAsNumber = number; // the input rounds to its own step
    if (input.value !== old) fire(input, 'input');
  }

  #label() { if (this.readout) this.readout.value = this.input.value; }

  #paint() {
    const { canvas, ctx, input, readout, radius: R } = this;
    if (canvas.hidden || !canvas.clientWidth) return;
    const dpr = canvas.width / canvas.clientWidth;
    const w = input.offsetWidth, h = input.offsetHeight, c = this.centre;
    const n = Math.ceil(w / this.slice), sw = w / n;
    try {
      ctx.reset();
      ctx.scale(dpr, dpr);
      if (input.matches(':focus-visible')) {
        // The focus ring of the input is not part of its picture, so the canvas draws one.
        ctx.strokeStyle = getComputedStyle(canvas).getPropertyValue('--picker-accent').trim() || '#0a66d0';
        ctx.globalAlpha = 0.3;
        ctx.lineWidth = h + 10;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.arc(c.x, c.y, R, this.a0, this.a0 + this.sweep); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      for (let i = 0; i < n; i++) {
        const a = this.a0 + ((i + 0.5) / n) * this.sweep;
        ctx.save();
        ctx.translate(c.x, c.y);
        ctx.rotate(a + Math.PI / 2); // x runs along the arc, the top of the input faces out
        ctx.translate(0, -R);
        // Half a pixel of overlap on each side hides the joins.
        const x0 = Math.max(0, i * sw - 0.5), x1 = Math.min(w, (i + 1) * sw + 0.5);
        if (this.sourceRect) {
          // The nine-argument form: draw only this slice of the input's picture.
          ctx.drawElementImage(input, x0, 0, x1 - x0, h, x0 - (i + 0.5) * sw, -h / 2, x1 - x0, h);
        } else {
          // The same with a clip and the whole input.
          ctx.beginPath(); ctx.rect(x0 - (i + 0.5) * sw, -h / 2, x1 - x0, h); ctx.clip();
          ctx.drawElementImage(input, -(i + 0.5) * sw, -h / 2, w, h);
        }
        ctx.restore();
      }
      // Every slice moved the input's hit box. One last draw with no opacity
      // leaves the box over the whole dial, where focus and tools expect it.
      if (this.box) {
        ctx.save();
        ctx.globalAlpha = 0;
        ctx.translate(c.x - R, c.y - R);
        ctx.scale((2 * R) / w, (2 * R) / h);
        ctx.drawElementImage(input, 0, 0, w, h);
        ctx.restore();
      }
      if (readout) ctx.drawElementImage(readout, c.x - readout.offsetWidth / 2, c.y - readout.offsetHeight / 2, readout.offsetWidth, readout.offsetHeight);
      this.frames++;
    } catch (err) {
      // "No cached paint record" before the first paint: the next paint event draws.
      if (/paint record/.test(err.message)) requestAnimationFrame(() => canvas.requestPaint()); else this.note = err.message;
    }
  }
}
// #endregion dial

/** What the three popover pickers share: opening next to the input, closing, writing a value. */
class IdeaPicker {
  static #all = new WeakMap();
  static for(input) { return IdeaPicker.#all.get(input); }
  note = '';

  constructor(inputs, className, anchor = inputs[0]) {
    this.inputs = inputs;
    this.input = inputs[0];
    if (!supported || IdeaPicker.#all.has(this.input)) return;
    for (const input of inputs) IdeaPicker.#all.set(input, this);
    addCSS(anchor);
    this.items = [];
    this.pop = new PlacedPopover({
      anchor,
      className: `idea-picker ${className}`,
      items: () => this.items,
      size: (s) => this.size(s),
      prepare: (s) => this.prepare?.(s),
      place: (i, s) => this.place(i, s),
      under: (ctx, s) => this.under?.(ctx, s),
      over: (ctx, s) => this.over?.(ctx, s),
      onhide: () => {
        if (this.was) inputs.forEach((input, i) => { input.readOnly = this.was[i]; });
        this.was = null;
        for (const input of inputs) input.ariaExpanded = 'false';
      },
    });
    this.pop.host.setAttribute('role', 'dialog');
    this.pop.host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.hide(); this.input.focus({ preventScroll: true }); }
    });
    for (const input of inputs) {
      input.dataset.ideaPicker = '';
      input.ariaHasPopup = 'dialog';
      input.ariaExpanded = 'false';
      // #region open
      // A press on the input opens this picker. A touch would also open the
      // browser's own date or week picker. A read-only input opens none, so
      // the inputs are read-only while this picker is open after a touch.
      input.addEventListener('pointerdown', (e) => {
        if (e.pointerType !== 'mouse' && !this.open && input.type !== 'color') { this.was = inputs.map((i) => i.readOnly); for (const i of inputs) i.readOnly = true; }
      });
      input.addEventListener('click', (e) => {
        if (input.type === 'color') e.preventDefault(); // type="color" opens the browser's chooser on click
        this.show();
      });
      input.addEventListener('keydown', (e) => {
        if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); this.show(); this.focusCurrent?.(); }
        else if (e.key === 'Escape' && this.open) { e.preventDefault(); this.hide(); }
      });
      input.addEventListener('input', () => { if (!this.writing && this.open) { this.read(); this.pop.invalidate(); } });
      // #endregion open
    }
  }

  get open() { return !!this.pop?.open; }
  /** Is the keyboard focus on one of the picker's buttons? */
  get inside() { return !!this.pop?.host.contains(document.activeElement); }

  /** A button or label that lives in the canvas. */
  add(tag, props, attrs) {
    const node = el(tag, tag === 'button' ? { type: 'button', ...props } : props, { drawable: '', ...attrs });
    this.pop.adopt(node);
    this.items.push(node);
    return node;
  }

  show() {
    if (!this.pop || this.open || this.input.disabled) return;
    this.read();
    for (const input of this.inputs) input.ariaExpanded = 'true';
    this.pop.show();
  }

  hide() { this.pop?.hide(); }

  /** Set an input's value as if it had been typed. Returns true when the value changed. */
  set(input, value, types = ['input', 'change']) {
    if (input.value === value) return false;
    this.writing = true;
    input.value = value;
    fire(input, ...types);
    this.writing = false;
    return true;
  }
}

// #region range
// Two date inputs, one calendar. The first press sets the start and the second
// sets the end. The band between the two days is drawn by the canvas under
// the day buttons, and its ends move a little each frame, so the band grows
// and shrinks as the pointer moves over the days.
const CELL = 40, LEFT = 14, TOP = 86;

export class DateRangePicker extends IdeaPicker {
  #set = 0;
  #dir = 0;
  #slide = 0;
  #band = null;
  a = '';
  b = '';
  pending = false;
  hover = '';

  constructor(start, end, { anchor = start } = {}) {
    super([start, end], 'is-range', anchor);
    if (!this.pop) return;
    this.start = start; this.end = end;
    const lang = start.lang || document.documentElement.lang || undefined;
    this.monthName = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    this.dayName = new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeZone: 'UTC' });
    this.shortDay = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    this.prev = this.add('button', { className: 'nav', textContent: '‹' }, { 'aria-label': 'Previous month' });
    this.title = this.add('span', { className: 'title' }, { 'aria-live': 'polite' });
    this.next = this.add('button', { className: 'nav', textContent: '›' }, { 'aria-label': 'Next month' });
    const weekday = new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' });
    for (let d = 0; d < 7; d++) this.add('span', { className: 'dow', textContent: weekday.format(Date.UTC(2024, 0, 1 + d)) }, { 'aria-hidden': 'true' }); // 1 January 2024 was a Monday
    this.sets = [0, 1].map(() => Array.from({ length: 42 }, () => this.add('button', { className: 'cell day' })));
    this.status = this.add('span', { className: 'status' }, { 'aria-live': 'polite' });
    this.done = this.add('button', { className: 'done', textContent: 'Done' });
    this.prev.addEventListener('click', () => this.turn(-1));
    this.next.addEventListener('click', () => this.turn(1));
    this.done.addEventListener('click', () => { const back = this.inside; this.hide(); if (back) this.end.focus({ preventScroll: true }); });

    const { host } = this.pop;
    const dayAt = (e) => {
      const node = e.pointerType === 'mouse' && e.type !== 'pointerup' ? e.target : document.elementFromPoint(e.clientX, e.clientY);
      const day = node?.closest?.('.day');
      return day && host.contains(day) && !day.disabled ? day.dataset.date : '';
    };
    // A press on a day starts a range, or previews the end of the one that is
    // being made. Lifting on another day ends it, so a drag sets both days.
    let first = false, down = false;
    host.addEventListener('pointerdown', (e) => {
      const date = dayAt(e);
      if (!date) return;
      down = true;
      first = !this.pending;
      if (first) this.begin(date); else this.preview(date);
    });
    host.addEventListener('pointermove', (e) => {
      if (!this.pending || (e.pointerType !== 'mouse' && !down)) return;
      const date = dayAt(e);
      if (date) this.preview(date);
    });
    host.addEventListener('pointerup', (e) => {
      if (!down) return;
      down = false;
      const date = dayAt(e);
      if (date && this.pending && !(first && date === this.a)) this.finish(date);
    });
    host.addEventListener('pointercancel', () => { down = false; });
    // Keyboard: Enter or Space on a day arrives as a click with no pointer.
    host.addEventListener('click', (e) => {
      const day = e.target.closest?.('.day');
      if (day && e.detail === 0) { if (this.pending) this.finish(day.dataset.date); else this.begin(day.dataset.date); }
    });
    host.addEventListener('focusin', (e) => { const day = e.target.closest?.('.day'); if (day && this.pending) this.preview(day.dataset.date); });
    host.addEventListener('keydown', (e) => {
      const day = e.target.closest?.('.day');
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); this.turn(e.key === 'PageUp' ? -1 : 1); }
      else if (day && step) {
        e.preventDefault();
        const to = new Date(Date.parse(day.dataset.date) + step * DAY);
        if (to.getUTCMonth() !== this.month) this.turn(step < 0 ? -1 : 1);
        this.#button(iso(to))?.focus({ preventScroll: true });
      }
    });
  }

  read() {
    const valid = (v) => (/^\d{4}-\d\d-\d\d$/.test(v) ? v : '');
    this.a = valid(this.start.value);
    this.b = this.a && valid(this.end.value) >= this.a ? valid(this.end.value) : '';
    this.pending = !!this.a && !this.b;
    this.hover = '';
    const shown = new Date(this.a || today());
    if (!this.open) { this.year = shown.getUTCFullYear(); this.month = shown.getUTCMonth(); }
    this.#fill(this.sets[this.#set]);
  }

  /** First press: this day is the start, and the end is open. */
  begin(date) {
    this.a = date; this.b = ''; this.pending = true; this.hover = date;
    this.set(this.start, date);
    this.set(this.end, '');
    this.#mark();
  }

  /** While the end is open: show the band as far as this day. */
  preview(date) {
    if (this.hover === date) return;
    this.hover = date;
    this.pop.invalidate();
  }

  /** Second press: the two days in order go to the two inputs. */
  finish(date) {
    const [a, b] = date < this.a ? [date, this.a] : [this.a, date];
    this.a = a; this.b = b; this.pending = false; this.hover = '';
    this.set(this.start, a);
    this.set(this.end, b);
    this.#mark();
  }

  #mark() {
    for (const set of this.sets) for (const day of set) day.ariaPressed = String(day.dataset.date === this.a || day.dataset.date === this.b);
    const name = (date) => this.shortDay.format(new Date(date));
    this.status.textContent = !this.a ? 'Choose the first day.'
      : this.pending ? `From ${name(this.a)}. Choose the last day.`
        : `${name(this.a)} to ${name(this.b)}, ${dayNumber(this.b) - dayNumber(this.a) + 1} days.`;
    this.pop.invalidate();
  }

  #button(date) { return this.sets[this.#set].find((b) => b.dataset.date === date); }
  focusCurrent() { (this.#button(this.a) ?? this.sets[this.#set].find((b) => !b.classList.contains('out')))?.focus({ preventScroll: true }); }
  /** The 42 day buttons of the month on show. */
  get days() { return this.sets[this.#set]; }

  #fill(buttons) {
    const first = new Date(Date.UTC(this.year, this.month, 1));
    const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
    const now = today();
    const { min, max } = this.start;
    buttons.forEach((b, i) => {
      const d = new Date(Date.UTC(this.year, this.month, 1 - lead + i)), date = iso(d);
      b.textContent = d.getUTCDate();
      b.dataset.date = date;
      b.ariaLabel = this.dayName.format(d);
      b.classList.toggle('out', d.getUTCMonth() !== this.month);
      b.classList.toggle('today', date === now);
      b.disabled = !!((min && date < min) || (max && date > max));
    });
    this.title.textContent = this.monthName.format(first);
    this.#mark();
  }

  /** Show the month before (-1) or after (1). */
  turn(dir) {
    const focused = this.inside && document.activeElement.classList.contains('day');
    const to = new Date(Date.UTC(this.year, this.month + dir, 1));
    this.year = to.getUTCFullYear(); this.month = to.getUTCMonth();
    this.#dir = dir;
    this.#set = 1 - this.#set;
    const incoming = this.sets[this.#set];
    this.#fill(incoming);
    // The new set starts one calendar width away, on the side it comes in from. The band starts there too.
    incoming.forEach((b, i) => this.pop.from(b, { x: LEFT + (i % 7) * CELL + dir * 7 * CELL, y: TOP + Math.floor(i / 7) * CELL, alpha: 0 }));
    this.#slide = dir * 7 * CELL;
    if (focused) incoming.find((b) => !b.classList.contains('out'))?.focus({ preventScroll: true });
    this.pop.invalidate();
  }

  size() { return [LEFT * 2 + 7 * CELL, TOP + 6 * CELL + 58]; }

  place(i, s) {
    if (i === 0) return { x: LEFT, y: 12 };
    if (i === 1) return { x: (s.w - s.sizes[1].w) / 2, y: 12 };
    if (i === 2) return { x: s.w - LEFT - CELL, y: 12 };
    if (i < 10) return { x: LEFT + (i - 3) * CELL, y: 58 };
    if (i === 94) return { x: LEFT + 4, y: TOP + 6 * CELL + 10 };
    if (i === 95) return { x: s.w - LEFT - s.sizes[95].w, y: TOP + 6 * CELL + 10 };
    const set = i < 52 ? 0 : 1, n = (i - 10) % 42;
    const x = LEFT + (n % 7) * CELL, y = TOP + Math.floor(n / 7) * CELL;
    return set === this.#set ? { x, y } : { x: x - this.#dir * 7 * CELL, y, alpha: 0 };
  }

  // #region band
  // The band and the two discs. lo and hi are day numbers that move towards
  // the chosen (or previewed) days a little each frame. A day number minus the
  // number of the first cell is a position in the grid of 42.
  under(ctx, s) {
    const end = this.pending ? this.hover || this.a : this.b;
    const band = (this.#band ??= { lo: 0, hi: 0, a: 0 });
    const to = this.a ? { lo: Math.min(dayNumber(this.a), dayNumber(end)), hi: Math.max(dayNumber(this.a), dayNumber(end)), a: 1 } : { lo: band.lo, hi: band.hi, a: 0 };
    const k = 1 - Math.exp(-s.dt * 16);
    let moving = false;
    for (const key of ['lo', 'hi', 'a']) {
      const gap = to[key] - band[key];
      if (Math.abs(gap) > 0.01) { band[key] = band.a < 0.05 && key !== 'a' ? to[key] : band[key] + gap * k; moving = true; } else band[key] = to[key];
    }
    // During a change of month the band slides in with the incoming days.
    if (Math.abs(this.#slide) > 0.5) { this.#slide -= this.#slide * (1 - Math.exp(-s.dt * 14)); moving = true; } else this.#slide = 0;
    const first = dayNumber(this.sets[this.#set][0].dataset.date);
    const lo = band.lo - first, hi = band.hi - first;
    ctx.beginPath(); ctx.rect(LEFT - 2, TOP, 7 * CELL + 4, 6 * CELL); ctx.clip();
    ctx.translate(this.#slide, 0);
    ctx.fillStyle = s.accent;
    ctx.globalAlpha = 0.22 * band.a * s.open;
    for (let row = 0; row < 6; row++) {
      const from = Math.max(lo, row * 7), until = Math.min(hi, row * 7 + 6);
      if (from > until) continue;
      ctx.beginPath();
      ctx.roundRect(LEFT + (from - row * 7) * CELL + 1, TOP + row * CELL + 3, (until - from + 1) * CELL - 2, CELL - 6, 17);
      ctx.fill();
    }
    ctx.globalAlpha = band.a * s.open;
    for (const at of [lo, hi]) {
      if (at < -0.5 || at > 41.5) continue;
      const row = clamp(Math.floor(at / 7 + 1e-6), 0, 5);
      ctx.beginPath(); ctx.arc(LEFT + (at - row * 7 + 0.5) * CELL, TOP + (row + 0.5) * CELL, 18, 0, TAU); ctx.fill();
    }
    return moving;
  }
  // #endregion band
}
// #endregion range

// #region wheel
// <input type="color" list>: a hue and saturation wheel drawn with two canvas
// gradients, a real range input for brightness, and one real button for each
// option of the datalist, placed on the wheel at its own colour. A press or
// drag on the wheel reads the pixel under the pointer back from the canvas.
const WHEEL = { cx: 132, cy: 126, R: 110 };
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb) => '#' + [...rgb].slice(0, 3).map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
export function hsvOf([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max / 255 };
}
export function rgbOfHsv({ h, s, v }) {
  const f = (n) => { const k = (n + h / 60) % 6; return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))); };
  return [f(5), f(3), f(1)];
}

export class ColourWheel extends IdeaPicker {
  /** Pixels read back from the canvas so far, and the error if a read threw. */
  reads = 0;
  readError = '';
  #pick = null;
  #last = null;
  #down = false;

  constructor(input) {
    super([input], 'is-wheel');
    if (!this.pop) return;
    const colours = [...(input.list?.options ?? [])].map((o) => o.value.toLowerCase()).filter((c) => /^#[0-9a-f]{6}$/.test(c));
    this.buttons = colours.map((c) => this.add('button', { className: 'swatch', style: `--c:${c}` }, { 'aria-label': c, 'data-value': c }));
    this.slider = this.add('input', { type: 'range', min: 0, max: 100, value: 100 }, { 'aria-label': 'Brightness' });
    this.hex = this.add('span', { className: 'hex' }, { 'aria-live': 'polite' });
    const { host } = this.pop;
    host.addEventListener('click', (e) => {
      const b = e.target.closest?.('.swatch');
      if (b) { this.set(this.input, b.dataset.value); this.read(); this.pop.invalidate(); }
    });
    this.slider.addEventListener('input', (e) => {
      e.stopPropagation(); // the slider is part of the picker, not a field of the form
      this.hsv.v = this.slider.value / 100;
      this.#pick = { ...this.spot(this.hsv), types: ['input'], read: false };
      this.pop.invalidate();
    });
    this.slider.addEventListener('change', (e) => { e.stopPropagation(); this.#pick = { ...this.spot(this.hsv), types: ['input'] }; this.pop.invalidate(); requestAnimationFrame(() => requestAnimationFrame(() => fire(this.input, 'change'))); });
    let armed = null; // a press that began on a swatch: it becomes a drag once it has moved
    const begin = (e) => {
      this.#down = this.input.value;
      armed = null;
      try { host.setPointerCapture(e.pointerId); } catch { /* a synthetic event has no pointer to capture */ }
    };
    host.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('input')) return;
      const r = this.pop.canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (Math.hypot(x - WHEEL.cx, y - WHEEL.cy) > WHEEL.R + 8) return;
      if (e.target.closest?.('.swatch')) { armed = { x: e.clientX, y: e.clientY }; return; }
      begin(e);
      this.pickAt(x, y, ['input']);
      e.preventDefault();
    });
    host.addEventListener('pointermove', (e) => {
      if (armed && e.buttons && Math.hypot(e.clientX - armed.x, e.clientY - armed.y) > 8) begin(e);
      if (this.#down === false) return;
      const r = this.pop.canvas.getBoundingClientRect();
      // While the pointer moves the colour is worked out from the position. The
      // canvas is read once on the press and once on the release, not on every frame.
      this.#last = [e.clientX - r.left, e.clientY - r.top];
      this.pickAt(...this.#last, ['input'], { read: false });
    });
    const up = () => {
      armed = null;
      if (this.#down === false) return;
      const before = this.#down;
      this.#down = false;
      if (this.#last) this.pickAt(...this.#last, ['input']);
      this.#last = null;
      // The last read happens in the next frame, so the change event waits for it.
      requestAnimationFrame(() => requestAnimationFrame(() => { if (this.input.value !== before) fire(this.input, 'change'); }));
    };
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
  }

  read() {
    const value = this.input.value.toLowerCase();
    this.hsv = hsvOf(rgbOf(value));
    this.slider.value = Math.round(this.hsv.v * 100);
    this.hex.textContent = value;
    for (const b of this.buttons) b.ariaPressed = String(b.dataset.value === value);
  }

  focusCurrent() { (this.buttons.find((b) => b.ariaPressed === 'true') ?? this.buttons[0] ?? this.slider).focus({ preventScroll: true }); }
  size() { return [264, 290]; }

  /** Where a colour is on the wheel: the angle is its hue and the distance from the centre is its saturation. */
  spot({ h, s }) {
    const a = (h * Math.PI) / 180;
    return { x: WHEEL.cx + Math.cos(a) * s * WHEEL.R, y: WHEEL.cy + Math.sin(a) * s * WHEEL.R };
  }

  /** Ask for the pixel at a point of the canvas (CSS px) to become the value. The read happens in the next frame. */
  pickAt(x, y, types = ['input', 'change'], { read = true } = {}) {
    const dx = x - WHEEL.cx, dy = y - WHEEL.cy, d = Math.hypot(dx, dy), max = WHEEL.R - 2;
    const k = d > max ? max / d : 1; // a point outside the wheel is pulled to its edge
    this.#pick = { x: WHEEL.cx + dx * k, y: WHEEL.cy + dy * k, types, read };
    this.hsv = { h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, s: Math.min(1, (d * k) / WHEEL.R), v: this.hsv.v };
    this.pop.invalidate();
  }

  place(i, s) {
    if (i === this.buttons.length) return { x: 18, y: 252 };
    if (i === this.buttons.length + 1) return { x: s.w - 18 - 64, y: 252 };
    const at = this.spot(hsvOf(rgbOf(this.buttons[i].dataset.value)));
    const near = s.pointer && this.#down === false ? clamp(1 - Math.hypot(s.px - at.x, s.py - at.y) / 40, 0, 1) : 0;
    return { x: at.x - 12, y: at.y - 12, scale: 1 + near * 0.5, order: near };
  }

  // #region wheel-read
  // The wheel is drawn first, below the buttons, so the pixel can be read
  // before a swatch or the marker covers it. The canvas has had
  // drawElementImage() called on it in every earlier frame, and the read works.
  under(ctx, s) {
    const { cx, cy, R } = WHEEL;
    ctx.globalAlpha = s.open;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    const hue = ctx.createConicGradient(0, cx, cy);
    for (let i = 0; i <= 6; i++) hue.addColorStop(i / 6, `hsl(${i * 60} 100% 50%)`);
    ctx.fillStyle = hue;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    const white = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
    white.addColorStop(0, 'rgb(255 255 255 / 1)');
    white.addColorStop(1, 'rgb(255 255 255 / 0)');
    ctx.fillStyle = white;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);
    ctx.fillStyle = `rgb(0 0 0 / ${1 - this.hsv.v})`;
    ctx.fillRect(cx - R, cy - R, 2 * R, 2 * R);

    const pick = this.#pick;
    if (!pick) return false;
    if (s.open < 1) return true; // the wheel is still fading in: read in a later frame
    this.#pick = null;
    const unit = ctx.canvas.width / s.w;
    let rgb;
    if (pick.read !== false) try {
      const px = pixelOf(ctx.canvas, Math.round(pick.x * unit), Math.round(pick.y * unit));
      this.reads++;
      rgb = px[3] === 255 ? px : null;
    } catch (err) {
      this.readError = `${err.name}: ${err.message}`;
    }
    rgb ??= rgbOfHsv(this.hsv); // the read failed: work the colour out from the position
    const value = hexOf(rgb);
    this.hex.textContent = value;
    for (const b of this.buttons) b.ariaPressed = String(b.dataset.value === value);
    this.set(this.input, value, pick.types);
    return false;
  }
  // #endregion wheel-read

  // The ring that marks the current colour is drawn last, over the buttons.
  over(ctx, s) {
    const at = this.spot(this.hsv);
    ctx.globalAlpha = s.open;
    ctx.lineWidth = 4; ctx.strokeStyle = '#000';
    ctx.beginPath(); ctx.arc(at.x, at.y, 9, 0, TAU); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
    ctx.beginPath(); ctx.arc(at.x, at.y, 9, 0, TAU); ctx.stroke();
  }
}
// #endregion wheel

// #region week
// <input type="week">: every week of a year is a small button, in rows of
// thirteen. The buttons near the pointer (or near the focused or chosen week)
// are pushed apart and drawn larger. Slide over the weeks and lift to choose.
const WEEK = { top: 70, pitchY: 34, reach: 84, power: 1.3 };

/** The number of ISO weeks in a year: 53 when 1 January is a Thursday, or a Wednesday in a leap year. */
export function weeksIn(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const leap = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
  return jan1 === 4 || (leap && jan1 === 3) ? 53 : 52;
}
/** The Monday that starts ISO week n of a year, as a time in ms. Week 1 holds 4 January. */
export function mondayOf(year, n) {
  const jan4 = Date.UTC(year, 0, 4);
  return jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY + (n - 1) * 7 * DAY;
}

export class WeekYearPicker extends IdeaPicker {
  hot = -1;

  constructor(input) {
    super([input], 'is-weeks');
    if (!this.pop) return;
    const lang = input.lang || document.documentElement.lang || undefined;
    this.shortDay = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', timeZone: 'UTC' });
    this.prev = this.add('button', { className: 'nav', textContent: '‹' }, { 'aria-label': 'Previous year' });
    this.title = this.add('span', { className: 'title' }, { 'aria-live': 'polite' });
    this.next = this.add('button', { className: 'nav', textContent: '›' }, { 'aria-label': 'Next year' });
    this.info = this.add('span', { className: 'info' }, { 'aria-live': 'polite' });
    this.weeks = Array.from({ length: 53 }, (_, i) => this.add('button', { className: 'week', textContent: i + 1 }));
    this.prev.addEventListener('click', () => this.turn(-1));
    this.next.addEventListener('click', () => this.turn(1));

    const { host } = this.pop;
    let down = false;
    const aim = (e) => {
      const r = this.pop.canvas.getBoundingClientRect();
      this.#heat(this.nearest(e.clientX - r.left, e.clientY - r.top));
    };
    host.addEventListener('pointerdown', (e) => {
      if (e.target.closest?.('.nav')) return;
      down = true;
      try { host.setPointerCapture(e.pointerId); } catch { /* a synthetic event has no pointer to capture */ }
      aim(e);
      e.preventDefault();
    });
    host.addEventListener('pointermove', (e) => { if (down || e.pointerType === 'mouse') aim(e); });
    host.addEventListener('pointerup', (e) => {
      if (!down) return;
      down = false;
      aim(e);
      if (this.hot >= 0) this.choose(this.hot);
    });
    host.addEventListener('pointercancel', () => { down = false; });
    host.addEventListener('pointerleave', () => { if (!down) this.#heat(-1); });
    // Keyboard: Enter or Space on a week arrives as a click with no pointer.
    host.addEventListener('click', (e) => {
      const i = this.weeks.indexOf(e.target.closest?.('.week'));
      if (i >= 0 && e.detail === 0) this.choose(i);
    });
    host.addEventListener('focusin', (e) => { const i = this.weeks.indexOf(e.target); if (i >= 0) this.#heat(i); });
    host.addEventListener('keydown', (e) => {
      const i = this.weeks.indexOf(e.target);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -13, ArrowDown: 13 }[e.key];
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); this.turn(e.key === 'PageUp' ? -1 : 1); if (i >= 0) this.weeks[Math.min(i, this.count - 1)].focus({ preventScroll: true }); }
      else if (i >= 0 && step) { e.preventDefault(); this.weeks[clamp(i + step, 0, this.count - 1)].focus({ preventScroll: true }); }
    });
  }

  read() {
    const m = /^(\d{4})-W(\d\d)$/.exec(this.input.value);
    this.value = m ? this.input.value : '';
    if (!this.open || m) this.year = m ? Number(m[1]) : new Date().getFullYear();
    this.#fill();
  }

  #fill() {
    const { min, max } = this.input;
    this.count = weeksIn(this.year);
    this.title.textContent = this.year;
    this.weeks.forEach((b, i) => {
      const value = `${this.year}-W${pad(i + 1)}`;
      b.dataset.value = value;
      b.ariaLabel = this.#name(i);
      b.ariaPressed = String(value === this.value);
      b.disabled = i >= this.count || !!((min && value < min) || (max && value > max));
    });
    this.#heat(this.hot, true);
  }

  #name(i) {
    const monday = mondayOf(this.year, i + 1);
    return `Week ${i + 1}: ${this.shortDay.format(monday)} to ${this.shortDay.format(monday + 6 * DAY)}`;
  }

  /** The week the picker is looking at: under the pointer or focused. Its dates are shown below the weeks. */
  #heat(i, force) {
    if (i === this.hot && !force) return;
    this.hot = i < this.count ? i : -1;
    const shown = this.hot >= 0 ? this.hot : this.weeks.findIndex((b) => b.ariaPressed === 'true');
    this.info.textContent = shown >= 0 ? this.#name(shown) : 'Slide over the weeks and lift.';
    this.pop.invalidate();
  }

  focusCurrent() { (this.weeks.find((b) => b.ariaPressed === 'true') ?? this.weeks[0]).focus({ preventScroll: true }); }

  choose(i) {
    if (this.weeks[i].disabled) return;
    const back = this.inside;
    this.value = this.weeks[i].dataset.value;
    this.set(this.input, this.value);
    this.hide();
    if (back) this.input.focus({ preventScroll: true });
  }

  /** Show the year before (-1) or after (1). */
  turn(dir) {
    this.year += dir;
    this.#fill();
    this.weeks.forEach((b, i) => { const at = this.base(i, this.pop.s); this.pop.from(b, { x: at.x - 18 + dir * 40, y: at.y - 16, scale: at.scale, alpha: 0 }); });
  }

  size() { return [Math.min(340, innerWidth - 16), WEEK.top + 4 * WEEK.pitchY + 44]; }

  /** The centre and scale of week i with no magnification. The 53rd week is a fourteenth button in the last row. */
  base(i, s) {
    const pitch = ((s.w || 340) - 20) / 14;
    return { x: 10 + ((i === 52 ? 13 : i % 13) + 0.5) * pitch, y: WEEK.top + (Math.min(3, Math.floor(i / 13)) + 0.5) * WEEK.pitchY, scale: (pitch - 3) / 36 };
  }

  /** The week whose button is nearest to a point of the canvas, or -1. */
  nearest(x, y) {
    let best = -1, distance = 40;
    for (let i = 0; i < this.count; i++) {
      const at = this.base(i, this.pop.s), d = Math.hypot(at.x - x, at.y - y);
      if (d < distance) { best = i; distance = d; }
    }
    return best;
  }

  /** The point the fisheye is centred on. */
  prepare(s) {
    const chosen = this.weeks.findIndex((b) => b.ariaPressed === 'true');
    const at = this.hot >= 0 ? this.hot : chosen;
    this.focus = s.pointer ? { x: s.px, y: s.py } : at >= 0 && at < this.count ? this.base(at, s) : null;
  }

  place(i, s) {
    if (i === 0) return { x: 10, y: 10 };
    if (i === 1) return { x: (s.w - s.sizes[1].w) / 2, y: 10 };
    if (i === 2) return { x: s.w - 50, y: 10 };
    if (i === 3) return { x: (s.w - s.sizes[3].w) / 2, y: s.h - 32 };
    const n = i - 4;
    if (n >= this.count) return null;
    const at = this.base(n, s), f = this.focus;
    let { x, y, scale } = at, near = 0;
    if (f) {
      // A fisheye: a button at distance t from the focus (as a fraction of
      // the reach) moves out to g(t) = (p + 1)t / (pt + 1). Space near the
      // focus is stretched by p + 1 and space at the rim is squeezed, so the
      // button is scaled by the mean of the stretch along and across the radius.
      const dx = at.x - f.x, dy = at.y - f.y, t = Math.hypot(dx, dy) / WEEK.reach, p = WEEK.power;
      if (t < 1) {
        const push = (p + 1) / (p * t + 1);
        x = f.x + dx * push; y = f.y + dy * push;
        near = 1 - t;
        scale = at.scale * Math.sqrt(push * ((p + 1) / (p * t + 1) ** 2));
      }
    }
    x = clamp(x, 18 * scale + 2, s.w - 18 * scale - 2);
    return { x: x - 18, y: y - 16, scale, order: near };
  }

  under(ctx, s) {
    if (!this.focus) return;
    ctx.globalAlpha = 0.06 * s.open;
    ctx.fillStyle = s.ink;
    ctx.beginPath(); ctx.arc(this.focus.x, this.focus.y, WEEK.reach, 0, TAU); ctx.fill();
  }
}
// #endregion week

// #region ghost
// A text input with a datalist. The input is a drawable child of the canvas,
// and so is each <option>. The canvas draws the input, then draws the part of
// the best matching option that has not been typed yet, starting at the caret.
export class GhostText {
  frames = 0;
  note = '';
  /** Draw the suggestion when the input does not have focus too. For tests. */
  always = false;
  /** What the last frame drew: { option, caret, width, top, height } in canvas CSS px, or null. */
  last = null;
  #off = false;

  constructor(canvas) {
    this.canvas = canvas;
    const input = (this.input = canvas.querySelector('input'));
    const list = (this.list = input.list);
    if (!supported || !list) { unwrap(canvas); return; }
    addCSS(canvas);
    canvas.classList.add('ghost-text');
    // Without its list attribute the input opens no datalist popup. The datalist stays where it is.
    input.dataset.list = input.getAttribute('list');
    input.removeAttribute('list');
    input.setAttribute('aria-autocomplete', 'inline');
    if (list.parentNode !== canvas) canvas.append(list);
    list.style.font = getComputedStyle(input).font;
    for (const option of list.options) option.setAttribute('drawable', '');
    this.ctx = canvas.getContext('2d');
    fit(canvas);
    canvas.addEventListener('paint', () => this.#paint());
    canvas.addEventListener('contextlost', () => { this.note = 'the canvas lost its context'; unwrap(canvas); });
    const again = () => canvas.requestPaint();
    for (const type of ['focus', 'blur', 'keyup', 'select', 'pointerup', 'scroll']) input.addEventListener(type, again);
    document.addEventListener('selectionchange', again);
    input.addEventListener('input', () => { this.#off = false; again(); });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || !this.match()) return;
      if (e.key === 'Tab' || e.key === 'ArrowRight' || e.key === 'End') { e.preventDefault(); this.accept(); }
      else if (e.key === 'Escape') { this.#off = true; again(); }
    });
    // The suggestion is a real element with a hit box, so a tap on it accepts it.
    list.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the input
    list.addEventListener('click', (e) => { if (e.target === this.match()) this.accept(); });
  }

  /** The option to suggest: the first whose value starts with the typed text. Only with the caret at the end. */
  match() {
    const { input } = this, typed = input.value;
    if (this.#off || !typed || (!this.always && document.activeElement !== input)) return null;
    if (input.selectionStart !== typed.length || input.selectionEnd !== typed.length) return null;
    const lower = typed.toLowerCase();
    return [...this.list.options].find((o) => o.value.length > typed.length && o.value.toLowerCase().startsWith(lower) && o.label === o.value) ?? null;
  }

  /** Take the suggestion: the option's value becomes the input's value. */
  accept() {
    const option = this.match();
    if (!option) return false;
    this.input.value = option.value;
    this.input.setSelectionRange(option.value.length, option.value.length);
    this.input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: option.value }));
    fire(this.input, 'change');
    this.canvas.requestPaint();
    return true;
  }

  #paint() {
    const { canvas, ctx, input, list } = this;
    if (canvas.hidden || !canvas.clientWidth) return;
    const dpr = canvas.width / canvas.clientWidth;
    const w = input.offsetWidth, h = input.offsetHeight, x = 3, y = 3;
    const option = this.match();
    try {
      ctx.reset();
      ctx.scale(dpr, dpr);
      ctx.drawElementImage(input, x, y, w, h);
      // An option that is not drawn keeps its last hit box, so the others are moved away.
      for (const o of list.options) if (o !== option) canvas.updateElementGeometry(o, { canvasTransform: FAR });
      this.last = null;
      if (option) {
        const style = getComputedStyle(input), typed = input.value;
        ctx.font = style.font;
        ctx.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing;
        const left = x + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
        const right = x + w - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
        // Where the typed text ends, and how much of the option's own text it covers.
        const caret = left + ctx.measureText(typed).width - input.scrollLeft;
        const skip = ctx.measureText(option.value.slice(0, typed.length)).width;
        const ow = option.offsetWidth, oh = option.offsetHeight, top = y + (h - oh) / 2;
        const width = Math.min(ow - skip, right - caret);
        if (width > 0) {
          ctx.globalAlpha = 0.45;
          // The nine-argument form: the option from `skip` px onwards, drawn at the caret.
          ctx.drawElementImage(option, skip, 0, width, oh, caret, top, width, oh);
          this.last = { option, caret, width, top, height: oh };
        } else canvas.updateElementGeometry(option, { canvasTransform: FAR });
      }
      this.frames++;
    } catch (err) {
      // "No cached paint record" before the first paint: the next paint event draws.
      if (/paint record/.test(err.message)) requestAnimationFrame(() => canvas.requestPaint()); else this.note = err.message;
    }
  }
}
// #endregion ghost
