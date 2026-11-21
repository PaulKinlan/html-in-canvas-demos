// Pickers for <input type="time">, <input type="date"> and <input type="color">
// drawn by a canvas.
//
//   <input type="time" picker="clock">
//   <input type="date" picker="calendar">
//   <input type="color" picker="swatches" list="palette">
//   <script type="module" src="/lib/input-pickers.js"></script>
//
// The browser's own pickers for these inputs cannot be styled and are not
// elements. These replace them with a popover that holds a canvas. Every hour,
// minute, day and swatch is a real <button> inside that canvas, drawn where a
// layout function says (see placed-popover.js), so the buttons can move: the
// hours fold into the centre and the minutes come out, and a month slides off
// as the next one slides on. The input keeps its value, its typing and its
// form submission. Without HTML-in-canvas the input is left alone.

import { PlacedPopover, supported } from './placed-popover.js';
export { supported };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pad = (n) => String(n).padStart(2, '0');
const el = (tag, props = {}, attrs = {}) => {
  const node = Object.assign(document.createElement(tag), props);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

const CSS_TEXT = `
input[picker]::-webkit-calendar-picker-indicator { display: none; }
.input-picker > canvas { touch-action: none; }
.input-picker button, .input-picker span { box-sizing: border-box; font: inherit; color: inherit; margin: 0; }
.input-picker button { border: 0; background: none; padding: 0; cursor: pointer; border-radius: 999px; -webkit-tap-highlight-color: transparent; }
.input-picker button:focus-visible { outline: 2px solid var(--picker-accent, #0a66d0); outline-offset: -2px; }
.input-picker button:disabled { opacity: .3; cursor: default; }
.input-picker .cell { width: 40px; height: 40px; font-size: 15px; font-variant-numeric: tabular-nums; }
.input-picker .cell.small { font-size: 12px; opacity: .8; }
.input-picker .cell[aria-pressed="true"] { color: #fff; font-weight: 700; }
.input-picker .cell:hover:not(:disabled, [aria-pressed="true"]) { background: color-mix(in srgb, currentColor 10%, transparent); }
.input-picker .part { min-width: 62px; height: 52px; padding: 0 8px; border-radius: 12px; font: 600 34px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums; background: color-mix(in srgb, currentColor 8%, transparent); }
.input-picker .part[aria-pressed="true"] { background: color-mix(in srgb, var(--picker-accent, #0a66d0) 22%, transparent); }
.input-picker .title { height: 40px; padding: 0 12px; border-radius: 10px; font-weight: 700; font-size: 16px; white-space: nowrap; }
.input-picker .nav { width: 40px; height: 40px; font-size: 20px; }
.input-picker .nav:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
.input-picker .dow { display: block; width: 40px; height: 24px; text-align: center; font-size: 12px; opacity: .6; }
.input-picker .day.out { opacity: .35; }
.input-picker .day.today:not([aria-pressed="true"]) { box-shadow: inset 0 0 0 1.5px currentColor; }
.input-picker .swatch { width: 40px; height: 40px; background: var(--c); border: 2px solid color-mix(in srgb, currentColor 25%, transparent); }
.input-picker .swatch[aria-pressed="true"] { border-color: currentColor; }
`;

/** What the three pickers share: opening next to the input, closing, writing the value. */
class InputPicker {
  static #all = new WeakMap();
  static for(input) { return InputPicker.#all.get(input); }
  note = '';

  constructor(input, className) {
    this.input = input;
    if (!supported || InputPicker.#all.has(input)) return;
    InputPicker.#all.set(input, this);
    const root = input.getRootNode(), head = root.nodeType === 9 ? root.head : root;
    if (!head.querySelector('style[data-input-pickers]')) head.append(el('style', { textContent: CSS_TEXT }, { 'data-input-pickers': '' }));
    this.items = [];
    this.pop = new PlacedPopover({
      anchor: input,
      className: `input-picker ${className}`,
      items: () => this.items,
      size: (s) => this.size(s),
      prepare: (s) => this.prepare?.(s),
      place: (i, s) => this.place(i, s),
      under: (ctx, s) => this.under?.(ctx, s),
      onhide: () => { input.readOnly = this.wasReadOnly; input.ariaExpanded = 'false'; },
    });
    this.pop.host.setAttribute('role', 'dialog');
    input.ariaHasPopup = 'dialog';
    input.ariaExpanded = 'false';

    // #region open
    // A press on the input opens this picker. On a touch screen the browser
    // would open its own picker for the same tap. A read-only input does not
    // open one, so the input is read-only while this picker is open.
    input.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' && !this.open) { this.wasReadOnly = input.readOnly; input.readOnly = true; this.viaTouch = true; }
    });
    input.addEventListener('click', (e) => {
      if (this.viaTouch || input.type === 'color') e.preventDefault(); // type="color" opens the browser's chooser on click
      this.viaTouch = false;
      this.show();
    });
    input.addEventListener('keydown', (e) => {
      if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); this.show(); this.focusCurrent?.(); }
      else if (e.key === 'Escape' && this.open) { e.preventDefault(); this.hide(); }
    });
    input.addEventListener('input', () => { if (!this.writing && this.open) { this.read(); this.pop.invalidate(); } });
    this.pop.host.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.hide(); input.focus(); }
    });
    // #endregion open
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
    if (!this.viaTouch) this.wasReadOnly = this.input.readOnly;
    this.read();
    this.input.ariaExpanded = 'true';
    this.pop.show();
  }

  hide() { this.pop?.hide(); }

  // #region write
  /** Set the input's value as if it had been typed. */
  write(value, { close = false } = {}) {
    if (this.input.value !== value) {
      this.writing = true;
      this.input.value = value;
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
      this.input.dispatchEvent(new Event('change', { bubbles: true }));
      this.writing = false;
    }
    if (close) this.hide(); else this.pop.invalidate();
  }
  // #endregion write
}

// #region clock
// A clock face. 24 hour buttons in two rings, then 12 minute buttons. The
// hand, the face and the dot under the chosen number are drawn by the canvas.
const FACE = { cx: 140, cy: 216, R: 104, r: 66 };

export class ClockPicker extends InputPicker {
  mode = 'h';
  h = 12;
  m = 0;
  #hand = null;

  constructor(input) {
    super(input, 'is-clock');
    if (!this.pop) return;
    this.partH = this.add('button', { className: 'part' }, { 'aria-label': 'Hours' });
    this.colon = this.add('span', { textContent: ':', style: 'font: 600 34px/52px system-ui' });
    this.partM = this.add('button', { className: 'part' }, { 'aria-label': 'Minutes' });
    this.hours = Array.from({ length: 24 }, (_, h) => this.add('button', { className: h === 0 || h > 12 ? 'cell small' : 'cell', textContent: h === 0 ? '00' : String(h) }, { 'aria-label': `${h} hours` }));
    this.minutes = Array.from({ length: 12 }, (_, i) => this.add('button', { className: 'cell', textContent: pad(i * 5) }, { 'aria-label': `${i * 5} minutes` }));
    this.partH.addEventListener('click', () => this.setMode('h'));
    this.partM.addEventListener('click', () => this.setMode('m'));
    // Keyboard: Enter or Space on a number. A pointer is handled below, so that a drag works too.
    this.hours.forEach((b, h) => b.addEventListener('click', (e) => { if (e.detail === 0) { this.h = h; this.#commit(); const back = this.inside; this.setMode('m'); if (back) this.minutes[Math.round(this.m / 5) % 12].focus(); } }));
    this.minutes.forEach((b, i) => b.addEventListener('click', (e) => { if (e.detail === 0) { this.m = i * 5; { const back = this.inside; this.#commit(true); if (back) this.input.focus(); } } }));

    const { host } = this.pop;
    let down = false;
    const aim = (e) => {
      const r = this.pop.canvas.getBoundingClientRect();
      const dx = e.clientX - r.left - FACE.cx, dy = e.clientY - r.top - FACE.cy, d = Math.hypot(dx, dy);
      if (d > FACE.R + 34) return false;
      const turn = ((Math.atan2(dx, -dy) / (2 * Math.PI)) + 1) % 1; // 0 at the top, clockwise
      if (this.mode === 'h') {
        const n = Math.round(turn * 12) % 12; // 0 means 12 on the outer ring
        const inner = d < (FACE.R + FACE.r) / 2;
        this.h = inner ? (n === 0 ? 0 : n + 12) : (n === 0 ? 12 : n);
      } else {
        // A drag gives single minutes. A tap on a number gives that number.
        this.m = down === 'moved' ? Math.round(turn * 60) % 60 : (Math.round(turn * 12) % 12) * 5;
      }
      this.#commit();
      return true;
    };
    host.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.part') || !aim(e)) return;
      down = true;
      host.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    host.addEventListener('pointermove', (e) => { if (down) { down = 'moved'; aim(e); } });
    host.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      if (this.mode === 'h') this.setMode('m'); else this.#commit(true);
    });
    host.addEventListener('pointercancel', () => { down = false; });
  }

  read() {
    const [h, m] = (this.input.value || '12:00').split(':').map(Number);
    this.h = h; this.m = m;
    if (!this.open) this.mode = 'h';
    this.#label();
  }

  #label() {
    this.partH.textContent = pad(this.h);
    this.partM.textContent = pad(this.m);
    this.partH.ariaPressed = String(this.mode === 'h');
    this.partM.ariaPressed = String(this.mode === 'm');
    this.hours.forEach((b, h) => { b.ariaPressed = String(h === this.h); });
    this.minutes.forEach((b, i) => { b.ariaPressed = String(i * 5 === this.m); });
  }

  #commit(close) { this.#label(); this.write(`${pad(this.h)}:${pad(this.m)}`, { close }); }

  setMode(mode) { this.mode = mode; this.#label(); this.pop.invalidate(); }
  focusCurrent() { this.hours[this.h].focus(); }

  size() { return [280, 344]; }

  /** Where the centre of a number is. */
  #spot(turn, radius) {
    const a = turn * 2 * Math.PI;
    return { x: FACE.cx + Math.sin(a) * radius, y: FACE.cy - Math.cos(a) * radius };
  }

  place(i) {
    if (i < 3) return { x: [70, 134, 148][i], y: 14 };
    const hour = i < 27, n = hour ? i - 3 : i - 27;
    const inner = hour && (n === 0 || n > 12);
    const spot = this.#spot(hour ? (n % 12) / 12 : n / 12, inner ? FACE.r : FACE.R);
    // The ring that is not in use folds into the centre and fades out.
    if (hour !== (this.mode === 'h')) return { x: FACE.cx - 20 + (spot.x - FACE.cx) * 0.25, y: FACE.cy - 20 + (spot.y - FACE.cy) * 0.25, scale: 0.4, alpha: 0 };
    return { x: spot.x - 20, y: spot.y - 20 };
  }

  under(ctx, s) {
    const hourMode = this.mode === 'h';
    const inner = hourMode && (this.h === 0 || this.h > 12);
    const to = { turn: hourMode ? (this.h % 12) / 12 : this.m / 60, radius: inner ? FACE.r : FACE.R };
    const hand = (this.#hand ??= { ...to });
    // The hand turns the short way round.
    let gap = ((to.turn - hand.turn + 1.5) % 1) - 0.5;
    const k = 1 - Math.exp(-s.dt * 18);
    let moving = false;
    if (Math.abs(gap) > 0.0005) { hand.turn = (hand.turn + gap * k + 1) % 1; moving = true; } else hand.turn = to.turn;
    if (Math.abs(to.radius - hand.radius) > 0.2) { hand.radius += (to.radius - hand.radius) * k; moving = true; } else hand.radius = to.radius;
    const tip = this.#spot(hand.turn, hand.radius);
    ctx.globalAlpha = s.open;
    ctx.fillStyle = s.ink;
    ctx.globalAlpha = 0.07 * s.open;
    ctx.beginPath(); ctx.arc(FACE.cx, FACE.cy, FACE.R + 26, 0, 7); ctx.fill();
    ctx.globalAlpha = s.open;
    ctx.strokeStyle = ctx.fillStyle = s.accent;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(FACE.cx, FACE.cy); ctx.lineTo(tip.x, tip.y); ctx.stroke();
    ctx.beginPath(); ctx.arc(FACE.cx, FACE.cy, 4, 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(tip.x, tip.y, 20, 0, 7); ctx.fill();
    return moving;
  }
}
// #endregion clock

// #region calendar
// A month of day buttons. There are two sets of 42. Changing month fills the
// other set and swaps them: the old set slides off one side while the new one
// slides in from the other.
const CELL = 40, LEFT = 14, TOP = 86;

export class CalendarPicker extends InputPicker {
  #set = 0;
  #dir = 0;
  #dot = null;

  constructor(input) {
    super(input, 'is-calendar');
    if (!this.pop) return;
    const lang = input.lang || document.documentElement.lang || undefined;
    this.monthName = new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' });
    this.dayName = new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeZone: 'UTC' });
    this.prev = this.add('button', { className: 'nav', textContent: '‹' }, { 'aria-label': 'Previous month' });
    this.title = this.add('span', { className: 'title', style: 'line-height:40px' }, { 'aria-live': 'polite' });
    this.next = this.add('button', { className: 'nav', textContent: '›' }, { 'aria-label': 'Next month' });
    const weekday = new Intl.DateTimeFormat(lang, { weekday: 'narrow', timeZone: 'UTC' });
    for (let d = 0; d < 7; d++) this.add('span', { className: 'dow', textContent: weekday.format(Date.UTC(2024, 0, 1 + d)) }, { 'aria-hidden': 'true' }); // 1 January 2024 was a Monday
    this.sets = [0, 1].map(() => Array.from({ length: 42 }, () => this.add('button', { className: 'cell day' })));
    this.prev.addEventListener('click', () => this.turn(-1));
    this.next.addEventListener('click', () => this.turn(1));

    const { host } = this.pop;
    host.addEventListener('click', (e) => {
      const day = e.target.closest?.('.day');
      if (day && !this.swiped) { const back = this.inside; this.write(day.dataset.date, { close: true }); if (back) this.input.focus(); }
    });
    // #region calendar-keys
    host.addEventListener('keydown', (e) => {
      const day = e.target.closest?.('.day');
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); this.turn(e.key === 'PageUp' ? -1 : 1, day?.dataset.date); }
      else if (day && step) {
        e.preventDefault();
        const to = new Date(Date.parse(day.dataset.date) + step * 864e5);
        if (to.getUTCMonth() !== this.month) this.turn(step < 0 ? -1 : 1);
        this.#button(iso(to))?.focus();
      }
    });
    // #endregion calendar-keys
    // A sideways swipe changes the month.
    let start = null;
    host.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; this.swiped = false; });
    host.addEventListener('pointerup', (e) => {
      if (start && Math.abs(e.clientX - start.x) > 44 && Math.abs(e.clientX - start.x) > Math.abs(e.clientY - start.y) * 1.5) { this.swiped = true; this.turn(e.clientX < start.x ? 1 : -1); }
      start = null;
    });
  }

  read() {
    const value = /^\d{4}-\d\d-\d\d$/.test(this.input.value) ? this.input.value : '';
    const shown = new Date(value || iso(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4)));
    this.value = value;
    if (!this.open || value) { this.year = shown.getUTCFullYear(); this.month = shown.getUTCMonth(); }
    this.#fill(this.sets[this.#set]);
  }

  #button(date) { return this.sets[this.#set].find((b) => b.dataset.date === date); }
  focusCurrent() { (this.#button(this.value) ?? this.sets[this.#set].find((b) => !b.classList.contains('out')))?.focus(); }

  #fill(buttons) {
    const first = new Date(Date.UTC(this.year, this.month, 1));
    const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
    const today = iso(new Date(Date.now() - new Date().getTimezoneOffset() * 6e4));
    const { min, max } = this.input;
    buttons.forEach((b, i) => {
      const d = new Date(Date.UTC(this.year, this.month, 1 - lead + i)), date = iso(d);
      b.textContent = d.getUTCDate();
      b.dataset.date = date;
      b.ariaLabel = this.dayName.format(d);
      b.ariaPressed = String(date === this.value);
      b.classList.toggle('out', d.getUTCMonth() !== this.month);
      b.classList.toggle('today', date === today);
      b.disabled = !!((min && date < min) || (max && date > max));
    });
    this.title.textContent = this.monthName.format(first);
  }

  /** Show the month before (-1) or after (1). */
  turn(dir) {
    const focused = this.pop.host.contains(document.activeElement) && document.activeElement.classList.contains('day');
    const to = new Date(Date.UTC(this.year, this.month + dir, 1));
    this.year = to.getUTCFullYear(); this.month = to.getUTCMonth();
    this.#dir = dir;
    this.#set = 1 - this.#set;
    const incoming = this.sets[this.#set];
    this.#fill(incoming);
    // The new set starts one calendar width away, on the side it comes in from.
    incoming.forEach((b, i) => this.pop.from(b, { x: LEFT + (i % 7) * CELL + dir * 7 * CELL, y: TOP + Math.floor(i / 7) * CELL, alpha: 0 }));
    if (focused) incoming.find((b) => !b.classList.contains('out'))?.focus();
    this.pop.invalidate();
  }

  size() { return [LEFT * 2 + 7 * CELL, TOP + 6 * CELL + 12]; }

  place(i, s) {
    if (i === 0) return { x: LEFT, y: 12 };
    if (i === 1) return { x: (s.w - s.sizes[1].w) / 2, y: 12 };
    if (i === 2) return { x: s.w - LEFT - CELL, y: 12 };
    if (i < 10) return { x: LEFT + (i - 3) * CELL, y: 58 };
    const set = i < 52 ? 0 : 1, n = (i - 10) % 42;
    const x = LEFT + (n % 7) * CELL, y = TOP + Math.floor(n / 7) * CELL;
    return set === this.#set ? { x, y } : { x: x - this.#dir * 7 * CELL, y, alpha: 0 };
  }

  // The disc under the chosen day is drawn by the canvas and slides to a new day.
  under(ctx, s) {
    const at = this.sets[this.#set].findIndex((b) => b.dataset.date === this.value && !b.classList.contains('out'));
    const dot = (this.#dot ??= { x: 0, y: 0, a: 0 });
    const to = at < 0 ? { x: dot.x, y: dot.y, a: 0 } : { x: LEFT + (at % 7) * CELL + 20, y: TOP + Math.floor(at / 7) * CELL + 20, a: 1 };
    const k = 1 - Math.exp(-s.dt * 16);
    let moving = false;
    for (const key of ['x', 'y', 'a']) {
      const gap = to[key] - dot[key];
      if (Math.abs(gap) > 0.01) { dot[key] = dot.a < 0.05 && key !== 'a' ? to[key] : dot[key] + gap * k; moving = true; } else dot[key] = to[key];
    }
    ctx.globalAlpha = dot.a * s.open;
    ctx.fillStyle = s.accent;
    ctx.beginPath(); ctx.arc(dot.x, dot.y, 19, 0, 7); ctx.fill();
    return moving;
  }
}

const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
// #endregion calendar

// #region swatches
// <input type="color" list>: one button per option of the datalist, in rings
// round the current colour. The buttons near the pointer grow.
export class SwatchPicker extends InputPicker {
  constructor(input) {
    super(input, 'is-swatches');
    if (!this.pop) return;
    const colours = [...(input.list?.options ?? [])].map((o) => o.value.toLowerCase());
    this.buttons = colours.map((c) => this.add('button', { className: 'swatch', style: `--c:${c}` }, { 'aria-label': c, 'data-value': c }));
    this.pop.host.addEventListener('click', (e) => {
      const b = e.target.closest?.('.swatch');
      if (b) { const back = this.inside; this.write(b.dataset.value, { close: true }); if (back) this.input.focus(); }
    });
  }

  read() { for (const b of this.buttons) b.ariaPressed = String(b.dataset.value === this.input.value.toLowerCase()); }
  focusCurrent() { (this.buttons.find((b) => b.ariaPressed === 'true') ?? this.buttons[0])?.focus(); }
  size() { return [248, 248]; }

  place(i, s) {
    // 6 in the first ring, 12 in the second, and so on.
    let ring = 1, n = i;
    while (n >= ring * 6) { n -= ring * 6; ring++; }
    const count = Math.min(ring * 6, s.n - 3 * ring * (ring - 1));
    const a = (n / count) * 2 * Math.PI + ring * 0.5, radius = 2 + ring * 46 * s.open;
    const x = 124 + Math.sin(a) * radius - 20, y = 124 - Math.cos(a) * radius - 20;
    const near = s.pointer ? clamp(1 - Math.hypot(s.px - x - 20, s.py - y - 20) / 70, 0, 1) : 0;
    return { x, y, scale: 0.9 + near * 0.5, order: near };
  }

  under(ctx, s) {
    ctx.globalAlpha = s.open;
    ctx.fillStyle = this.input.value;
    ctx.beginPath(); ctx.arc(124, 124, 18, 0, 7); ctx.fill();
  }
}
// #endregion swatches

export const pickers = { clock: ClockPicker, calendar: CalendarPicker, swatches: SwatchPicker };

/** Turn every <input picker="clock|calendar|swatches"> on the page into its picker. */
export function upgrade(root = document) {
  return [...root.querySelectorAll('input[picker]')].filter((input) => pickers[input.getAttribute('picker')])
    .map((input) => InputPicker.for(input) ?? new pickers[input.getAttribute('picker')](input));
}
export const pickerFor = (input) => InputPicker.for(input);

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgrade());
  else queueMicrotask(() => upgrade());
}
