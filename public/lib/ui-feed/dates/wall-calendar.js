// <wall-calendar>: a month of radios printed as two offset colour plates that turn together.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, esc, clamp, easeOut, reduced } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Bodoni 72', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const day = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
const iso = (dt) => dt.toISOString().slice(0, 10);
const addDays = (dt, n) => new Date(dt.getTime() + n * 864e5);
const fmt = (dt, o, loc = 'en-US') => dt.toLocaleDateString(loc, { timeZone: 'UTC', ...o });
const sameMonth = (a, b) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();

const TEAL = '#14706e', CORAL = '#ef6c58', PAPER = '#f1e8d4';
function drawStock(g) {
  // flecks in the paper, laid over both inks
  for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(${rnd(i) > 0.4 ? '255,252,240' : '120,96,60'},${0.06 + rnd(i + 4) * 0.12})`; const s = 0.5 + rnd(i + 2) ** 2 * 1.6; g.fillRect(rnd(i + 1) * 360, rnd(i + 3) * 360, s, s); }
}

export class WallCalendar extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static GRID = { x: 16, y: 96 };
  static SECONDS = 0.44;
  static css = `
    header { width: 328px; height: 84px; color: ${TEAL}; }
    h2 { position: absolute; left: 0; top: 2px; margin: 0; font: 400 66px/1 ${DISPLAY}; letter-spacing: -0.035em; white-space: nowrap; }
    header span { position: absolute; right: 0; bottom: 6px; font: 400 11px/1 ${DISPLAY}; }
    button { width: 22px; height: 22px; padding: 0; border: 1px solid ${TEAL}; background: transparent; color: ${TEAL}; font: 13px/1 ${SANS}; cursor: pointer; }
    button:focus-visible { outline: 2px solid ${CORAL}; outline-offset: 1px; }
    table { width: 328px; border-collapse: collapse; table-layout: fixed; font: 400 23px/1 ${DISPLAY}; }
    th { height: 22px; padding: 0; font: 400 9.5px/22px ${DISPLAY}; border-top: 1px solid; border-bottom: 1px solid; }
    td { height: 38px; padding: 0; text-align: center; border-bottom: 1px solid; }
    td label { display: block; position: relative; height: 37px; line-height: 37px; cursor: pointer; }
    td input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
    td.out { opacity: 0.38; }
    .teal { color: ${TEAL}; }
    .teal th, .teal td { border-color: ${TEAL}; }
    .teal .end { color: transparent; }
    .teal label.today { box-shadow: inset 0 0 0 1px ${TEAL}; }
    .teal label:has(:focus-visible) { outline: 2px dashed ${TEAL}; outline-offset: -4px; }
    .coral { color: transparent; }
    .coral th, .coral td { border-color: transparent; }
    .coral .end { color: ${CORAL}; }
    .coral label.on { background: ${CORAL}; }
    .coral .end label.on { color: #8e2e22; }`;
  static observedAttributes = ['value'];

  ready() {
    const v = this.getAttribute('value'), m = this.getAttribute('month') ?? (v ? v.slice(0, 7) : iso(new Date()).slice(0, 7));
    this.month = day(m + '-01'); this.picked = v ?? ''; this.anim = 1; this.way = 1;
    this.build();
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.picked = e.target.value; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.shadowRoot.addEventListener('keydown', (e) => this.key(e));
  }
  attributeChangedCallback(_, __, v) { if (this.plates && v !== null && v !== this.picked) this.value = v; }

  // #region wall-calendar
  // Two copies of the month: the teal plate holds the radios and the coral plate is only ink.
  build() {
    const box = this.canvas ?? this.$('.plain'), m = this.month, today = this.getAttribute('today') ?? '';
    const start = addDays(m, -m.getUTCDay()), weeks = [];
    for (let d = start; weeks.length < 6 && (weeks.length < 4 || sameMonth(d, m)); d = addDays(d, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)));
    const plate = (kind) => {
      const ink = kind === 'teal', head = `<tr>${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((t, i) => `<th class="${i % 6 ? '' : 'end'}" abbr="${t}">${t}</th>`).join('')}</tr>`;
      const cell = (d, i) => {
        const inside = sameMonth(d, m), cls = `${i % 6 ? '' : 'end'}${inside ? '' : ' out'}`;
        if (!inside) return `<td class="${cls}">${d.getUTCDate()}</td>`;
        const v = iso(d), lab = `${v === today ? 'today' : ''}${v === this.picked ? ' on' : ''}`;
        return `<td class="${cls}"><label class="${lab}">${ink ? `<input type="radio" name="day" value="${v}" aria-label="${esc(fmt(d, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}${v === today ? ', today' : ''}">` : ''}${d.getUTCDate()}</label></td>`;
      };
      return node(`<table class="${kind}"${ink ? '' : ' aria-hidden="true" inert'}><thead>${head}</thead><tbody>${weeks.map((w) => `<tr>${w.map(cell).join('')}</tr>`).join('')}</tbody></table>`);
    };
    const name = fmt(m, { month: 'long' }), year = m.getUTCFullYear();
    this.header = node(`<header><h2 id="cal-title">${esc(name)}</h2><span>${year}</span></header>`);
    if (!this.prev) {
      this.prev = node('<button type="button" aria-label="Previous month">&larr;</button>'); this.next = node('<button type="button" aria-label="Next month">&rarr;</button>');
      this.prev.addEventListener('click', () => this.turn(-1)); this.next.addEventListener('click', () => this.turn(1));
    }
    this.plates = [plate('coral'), plate('teal')];
    this.plates[1].setAttribute('aria-labelledby', 'cal-title');
    box.replaceChildren(this.plates[0], this.plates[1], this.header, this.prev, this.next);
    this.radios = [...this.plates[1].querySelectorAll('input')];
    for (const r of this.radios) r.checked = r.value === this.picked;
    this.setValue(this.picked);
  }
  get value() { return this.picked; }
  set value(v) { this.picked = v; if (v && !sameMonth(day(v), this.month)) { this.month = day(v.slice(0, 7) + '-01'); this.build(); } else this.sync(); }
  // The coral plate shows the chosen day as a filled square. It is a copy, so its class follows the radio.
  sync() {
    for (const l of this.plates[0].querySelectorAll('label')) l.classList.toggle('on', false);
    const i = this.radios.findIndex((r) => r.value === this.picked);
    if (i >= 0) this.plates[0].querySelectorAll('label')[i].classList.add('on');
    this.setValue(this.picked); this.request();
  }
  // Turn the page: both plates slide out, the month is rebuilt half way, and they slide in. The coral plate
  // runs a little behind the teal one, as a second colour does on a press that is out of register.
  turn(dir, then) {
    this.way = dir; this.anim = reduced() ? 1 : 0;
    clearTimeout(this.swap);
    const go = () => { this.month = day(iso(addDays(this.month, dir > 0 ? 32 : -1)).slice(0, 7) + '-01'); this.build(); this.sync(); then?.(); };
    if (reduced()) go(); else this.swap = setTimeout(go, (WallCalendar.SECONDS * 1000) / 2);
    this.request();
  }
  // Arrow keys move by a day or a week and cross into the next month. Page Up and Page Down turn the page.
  key(e) {
    if (e.target.type !== 'radio') return;
    const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); this.turn(e.key === 'PageDown' ? 1 : -1, () => this.radios[0]?.focus({ preventScroll: true })); return; }
    if (!by) return;
    e.preventDefault();
    const to = iso(addDays(day(e.target.value), by)), pick = () => { const r = this.radios.find((x) => x.value === to); if (!r) return; r.checked = true; r.focus({ preventScroll: true }); this.picked = to; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); };
    if (sameMonth(day(to), this.month)) pick(); else this.turn(by > 0 ? 1 : -1, pick);
  }

  // How far a plate is from its place, and how much of it shows, at point p of a page turn.
  shift(p) {
    if (p >= 1) return { dx: 0, a: 1 };
    return p < 0.5 ? { dx: -this.way * 46 * (p * 2) ** 2, a: 1 - p * 2 } : { dx: this.way * 46 * (1 - easeOut((p - 0.5) * 2)), a: (p - 0.5) * 2 };
  }
  draw(ctx, w, h) {
    const { x: GX, y: GY } = WallCalendar.GRID;
    let moving = false;
    if (this.anim < 1) { this.anim = Math.min(1, this.anim + this.dt / WallCalendar.SECONDS); moving = true; }
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    const teal = this.shift(this.anim), coral = this.shift(clamp((this.anim - 0.1) / 0.9));
    // a press out of register: the coral sits a little off the teal at rest as well
    ctx.save(); ctx.globalAlpha = coral.a; ctx.globalCompositeOperation = 'multiply';
    put(ctx, this.plates[0], GX + coral.dx * 1.12 + 0.8, GY + 0.6);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = teal.a; ctx.globalCompositeOperation = 'multiply';
    put(ctx, this.header, GX + teal.dx * 0.7, 6);
    put(ctx, this.plates[1], GX + teal.dx, GY);
    ctx.restore();
    // the radios answer where they will be, not where they are passing
    if (this.anim < 1) hit(ctx, this.plates[1], GX, GY);
    put(ctx, this.prev, 302, 12); put(ctx, this.next, 323, 12);
    ctx.drawImage(cached(this, 'stock', 360, 360, drawStock), 0, 0, w, h);
    return moving;
  }
  // #endregion wall-calendar
}
customElements.define('wall-calendar', WallCalendar);
