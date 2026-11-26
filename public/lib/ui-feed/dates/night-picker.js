// <night-picker>: an <input type="date"> paired with a non-modal <dialog> of radios for each night.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, esc, clamp, easeOut, rr, spring, TAU, reduced } from '../kit.js';
import { cached, focusRing } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

// Dates are kept as UTC midnights, so that no time zone moves a day.
export const day = (iso) => { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, (m || 1) - 1, d || 1)); };
export const iso = (dt) => dt.toISOString().slice(0, 10);
export const addDays = (dt, n) => new Date(dt.getTime() + n * 864e5);
const fmt = (dt, o, loc = 'en-US') => dt.toLocaleDateString(loc, { timeZone: 'UTC', ...o });
const sameMonth = (a, b) => a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();

function drawLake(g) {
  // dusk: violet at the top, pink and orange on the horizon, and the same again upside down in the water
  const H = 252;
  const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#4b33b8'); sky.addColorStop(0.45, '#6f4fd0'); sky.addColorStop(0.75, '#b06fc6'); sky.addColorStop(0.92, '#f08a86'); sky.addColorStop(1, '#ffb07a');
  g.fillStyle = sky; g.fillRect(0, 0, 360, H);
  const water = g.createLinearGradient(0, H, 0, 318); water.addColorStop(0, '#f6a27f'); water.addColorStop(0.3, '#b672b4'); water.addColorStop(1, '#3a2a7c');
  g.fillStyle = water; g.fillRect(0, H, 360, 70);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(255,220,200,${0.05 + rnd(i) * 0.12})`; g.fillRect(rnd(i + 1) * 360, H + 4 + rnd(i + 2) * 60, 20 + rnd(i + 3) * 70, 0.8); }
  // the far shore: a low line of trees, and its reflection
  const shore = (y, k, a) => { g.fillStyle = `rgba(28,18,52,${a})`; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= 360; x += 4) g.lineTo(x, y - k * (3 + rnd(x * 0.37) * 6 + Math.sin(x * 0.03) * 3)); g.lineTo(360, y); g.closePath(); g.fill(); };
  shore(H + 1, 1, 0.95); shore(H + 1, -0.7, 0.35);
  // pines on the right
  const pine = (x, base, h, w) => { g.beginPath(); g.moveTo(x, base - h); for (let i = 1; i <= 7; i++) { const y = base - h + (h * i) / 7, ww = (w * i) / 7; g.lineTo(x + ww, y); g.lineTo(x + ww * 0.35, y - h / 14); } for (let i = 7; i >= 1; i--) { const y = base - h + (h * i) / 7, ww = (w * i) / 7; g.lineTo(x - ww * 0.35, y - h / 14); g.lineTo(x - ww, y); } g.closePath(); g.fill(); g.fillRect(x - 1, base - 4, 2, 6); };
  g.fillStyle = '#140d26'; pine(330, 292, 112, 15); pine(352, 300, 140, 17); pine(312, 296, 66, 10);
  // the near bank
  g.fillStyle = '#120c20'; g.beginPath(); g.moveTo(0, 318); g.bezierCurveTo(80, 306, 220, 304, 360, 296); g.lineTo(360, 360); g.lineTo(0, 360); g.fill();
  // the tent, lit from inside
  const tx = 122, base = 318;
  g.save(); g.filter = 'blur(14px)'; g.fillStyle = 'rgba(255,170,70,0.55)'; g.beginPath(); g.ellipse(tx, base - 18, 72, 30, 0, 0, TAU); g.fill(); g.restore();
  const canvas = g.createLinearGradient(tx - 60, 0, tx + 60, 0); canvas.addColorStop(0, '#d46a10'); canvas.addColorStop(0.45, '#ffd27a'); canvas.addColorStop(0.6, '#ffc35a'); canvas.addColorStop(1, '#c75e0e');
  g.fillStyle = canvas; g.beginPath(); g.moveTo(tx, base - 78); g.quadraticCurveTo(tx - 22, base - 44, tx - 60, base - 30); g.lineTo(tx - 58, base - 2); g.lineTo(tx + 58, base - 2); g.lineTo(tx + 60, base - 30); g.quadraticCurveTo(tx + 22, base - 44, tx, base - 78); g.fill();
  g.strokeStyle = 'rgba(150,70,10,0.5)'; g.lineWidth = 0.8;
  for (const dx of [-36, -14, 14, 36]) { g.beginPath(); g.moveTo(tx, base - 76); g.lineTo(tx + dx, base - 2); g.stroke(); }
  g.fillStyle = '#ffe6a6'; g.beginPath(); g.moveTo(tx - 5, base - 2); g.lineTo(tx, base - 42); g.lineTo(tx + 9, base - 2); g.fill();
  g.strokeStyle = '#5a3a20'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(tx, base - 78); g.lineTo(tx, base - 90); g.stroke();
}

export class NightPicker extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static DIALOG = { x: 8, y: 56 };
  static css = `
    .field { width: 306px; height: 42px; padding: 5px 12px 0; box-sizing: border-box; background: #fff; color: #1d1648; }
    .field label { display: block; font: 600 9px/1 ${SANS}; color: #5b4fd0; }
    .field input { display: block; width: 180px; margin: 2px 0 0; padding: 0; border: 0; outline: 0; background: transparent; color: #1d1648; font: 700 20px/1.1 ${SANS}; }
    .field input::-webkit-calendar-picker-indicator { display: none; }
    .field output { position: absolute; right: 12px; top: 11px; font: 700 20px/1 ${SANS}; }
    .field output.taken { color: #d23a2c; text-decoration: line-through; }
    button.open { width: 42px; height: 42px; padding: 0; border: 0; background: transparent; cursor: pointer; }
    dialog { width: 344px; margin: 0; padding: 0; border: 0; background: transparent; color: #fff; inset: auto; left: 0; top: 0; }
    dialog h3 { margin: 0 0 4px 8px; font: 700 15px/22px ${SANS}; }
    table { width: 344px; border-collapse: collapse; table-layout: fixed; }
    th { font: 600 8px/14px ${SANS}; opacity: 0.8; }
    td { height: 29px; padding: 0; text-align: center; }
    td label { display: block; position: relative; height: 29px; cursor: pointer; }
    td input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none; }
    td b { display: block; padding-top: 3px; font: 700 16px/17px ${SANS}; }
    td small { display: block; font: 500 7.5px/1 ${SANS}; opacity: 0.8; }
    td label:has(:disabled) { opacity: 0.42; cursor: default; }
    td label:has(:disabled) b { text-decoration: line-through; }
    td label:has(:checked) { color: #1d1648; }
    td label:has(:focus-visible) { outline: 2px solid #ffd34d; outline-offset: -2px; border-radius: 8px; }`;
  static observedAttributes = ['value'];

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { attributes: true, attributeFilter: ['month', 'prices', 'label'] });
    const root = this.shadowRoot;
    root.addEventListener('pointerdown', (e) => { this.pressed = performance.now(); if (e.target === this.canvas && this.want) this.show(false); });
    root.addEventListener('keydown', (e) => {
      if (!this.want) return;
      if (e.key === 'Escape') { e.preventDefault(); this.show(false, true); }
      if ((e.key === 'Enter' || e.key === ' ') && e.target.type === 'radio') { e.preventDefault(); this.show(false, true); }
    });
  }
  attributeChangedCallback(_, __, v) { if (this.input && v !== null && v !== this.value) this.value = v; }

  // #region night-picker
  build() {
    const box = this.canvas ?? this.$('.plain'), month = day((this.getAttribute('month') ?? '2027-05') + '-01');
    const prices = (this.getAttribute('prices') ?? '').split(/\s+/).filter(Boolean), was = this.input?.value ?? this.getAttribute('value') ?? '';
    const days = []; for (let d = month; sameMonth(d, month); d = addDays(d, 1)) days.push({ d, value: iso(d), price: prices[d.getUTCDate() - 1] ?? '-' });
    const last = days.at(-1).d, title = fmt(month, { month: 'long', year: 'numeric' });
    this.days = days;
    this.field = node(`<div class="field"><label for="night">${esc(this.getAttribute('label') ?? 'Night of')}</label><input id="night" type="date" min="${iso(month)}" max="${iso(last)}"><output for="night"></output></div>`);
    this.button = node('<button type="button" class="open" aria-haspopup="dialog" aria-expanded="false" aria-label="Choose a night"></button>');
    // Monday first, as the original. A row for each week.
    const lead = (month.getUTCDay() + 6) % 7, cells = [...Array(lead).fill(null), ...days];
    while (cells.length % 7) cells.push(null);
    const rows = []; for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    const cell = (o) => {
      if (!o) return '<td></td>';
      const taken = o.price === '-', said = `${fmt(o.d, { weekday: 'long', day: 'numeric', month: 'long' }, 'en-GB')}, ${taken ? 'taken' : '€' + o.price}`;
      return `<td><label><input type="radio" name="night" value="${o.value}" aria-label="${esc(said)}"${taken ? ' disabled' : ''}><b>${o.d.getUTCDate()}</b><small>${taken ? 'Taken' : '€' + esc(o.price)}</small></label></td>`;
    };
    this.dialog = node(`<dialog aria-label="Choose a night in ${esc(title)}"><h3>${esc(title)}</h3><table><thead><tr>${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((t) => `<th>${t}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map(cell).join('')}</tr>`).join('')}</tbody></table></dialog>`);
    box.replaceChildren(this.field, this.button, this.dialog);
    this.input = this.field.querySelector('input'); this.price = this.field.querySelector('output');
    this.radios = [...this.dialog.querySelectorAll('input')];
    this.t = 0; this.want = 0; this.disc = { x: 0, v: 0 };
    this.button.addEventListener('click', () => this.show(!this.want));
    this.dialog.addEventListener('change', () => {
      this.input.value = this.radios.find((r) => r.checked)?.value ?? '';
      this.sync(); this.commit();
      if (performance.now() - (this.pressed ?? -1e4) < 800) setTimeout(() => this.show(false, true), reduced() ? 0 : 240);
    });
    // Typing in the date field picks the same night, or says that it is taken.
    this.input.addEventListener('input', () => { for (const r of this.radios) r.checked = r.value === this.input.value && !r.disabled; this.sync(); });
    this.input.addEventListener('change', () => this.commit());
    this.input.value = was; for (const r of this.radios) r.checked = r.value === was && !r.disabled;
    this.sync();
  }
  get value() { return this.input?.value ?? ''; }
  set value(v) { this.input.value = v; for (const r of this.radios) r.checked = r.value === v && !r.disabled; this.sync(); this.request(); }
  commit() { this.dispatchEvent(new Event('change', { bubbles: true })); }
  sync() {
    const o = this.days.find((x) => x.value === this.input.value), taken = o?.price === '-';
    this.price.value = taken ? 'Taken' : o ? '€' + o.price : '';
    this.price.classList.toggle('taken', taken);
    this.setValue(this.input.value);
    try { this.internals?.setValidity(taken ? { customError: true } : this.input.validity.rangeOverflow || this.input.validity.rangeUnderflow ? { rangeOverflow: true } : {}, taken ? 'That night is taken' : 'Choose a night in the month shown', this.input); } catch {}
    this.request();
  }
  // Open or close the dialog. It is opened with the attribute, not showModal(), so it stays in the canvas.
  show(open, refocus = false) {
    if (open && !this.dialog.open) {
      this.dialog.open = true;
      (this.radios.find((r) => r.checked) ?? this.radios.find((r) => !r.disabled))?.focus({ preventScroll: true });
    }
    if (!open && refocus) this.button.focus({ preventScroll: true });
    if (!open && this.plain) this.dialog.close();
    this.want = open ? 1 : 0;
    this.button.setAttribute('aria-expanded', String(open));
    this.request();
  }

  draw(ctx, w, h) {
    const { x: DX, y: DY } = NightPicker.DIALOG, dlg = this.dialog;
    if (this.t !== this.want) this.t = reduced() ? this.want : this.want ? Math.min(1, this.t + this.dt / 0.32) : Math.max(0, this.t - this.dt / 0.18);
    let moving = this.t !== this.want;
    if (this.t === 0 && !this.want && dlg.open) dlg.close();
    ctx.drawImage(cached(this, 'lake', 360, 360, drawLake), 0, 0, w, h);
    if (dlg.open) {
      // a band of dusk behind the calendar, so the figures read over the lake
      const dh = dlg.offsetHeight, shade = ctx.createLinearGradient(0, DY, 0, DY + dh);
      shade.addColorStop(0, 'rgba(52,34,150,0.9)'); shade.addColorStop(1, 'rgba(30,18,84,0.94)');
      ctx.save(); ctx.globalAlpha = easeOut(this.t); ctx.shadowColor = 'rgba(10,4,40,0.5)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
      ctx.fillStyle = shade; rr(ctx, DX - 2, DY - 4, 348, (dh + 12) * (0.4 + 0.6 * easeOut(this.t)), 10); ctx.fill();
      ctx.restore();
      // the disc under the chosen night grows from nothing
      const on = this.radios.find((r) => r.checked)?.closest('label');
      moving = spring(this.disc, on ? 1 : 0, this.dt, 300, 22) || moving;
      if (on && this.disc.x > 0.01) {
        const s = this.slice(on, dlg);
        ctx.fillStyle = '#ffc533'; ctx.beginPath(); ctx.arc(DX + s.left + s.ew / 2, DY + s.top + s.eh / 2, 15 * clamp(this.disc.x, 0, 1.2), 0, TAU); ctx.fill();
      }
      // the rows come down one after another as it opens, and go together as it closes
      if (this.t === 1) put(ctx, dlg, DX, DY);
      else {
        const rows = [dlg.querySelector('h3'), ...dlg.querySelectorAll('tr')];
        rows.forEach((row, i) => {
          const s = this.slice(row, dlg), p = this.want ? clamp((this.t - i * 0.07) / 0.5) : this.t, e = easeOut(p);
          if (e <= 0.01) return;
          ctx.save(); ctx.globalAlpha = e;
          ctx.beginPath(); ctx.rect(DX, DY + s.top - 10 * (1 - e), s.ew + 1, s.eh + 0.5); ctx.clip();
          put(ctx, dlg, DX, DY - 10 * (1 - e));
          ctx.restore();
        });
        hit(ctx, dlg, DX, DY);
      }
    }
    // the field: "Add a date" until there is one, or while it isn't being typed in
    const focused = this.shadowRoot.activeElement === this.input;
    ctx.fillStyle = '#fff'; ctx.fillRect(8, 8, 306, 42);
    if (this.input.value || focused) put(ctx, this.field, 8, 8);
    else {
      hit(ctx, this.field, 8, 8);
      ctx.fillStyle = '#5b4fd0'; ctx.font = `600 9px ${SANS}`; ctx.fillText(this.field.querySelector('label').textContent, 20, 22);
      ctx.fillStyle = '#9a93c9'; ctx.font = `600 20px ${SANS}`; ctx.fillText('Add a date', 20, 43);
    }
    // the button, with a small calendar on it
    const lit = this.want || this.t > 0;
    ctx.fillStyle = lit ? '#f7a823' : '#231a5c'; ctx.fillRect(314, 8, 42, 42);
    put(ctx, this.button, 314, 8, 42, 42);
    ctx.strokeStyle = lit ? '#231a5c' : '#fff'; ctx.fillStyle = ctx.strokeStyle; ctx.lineWidth = 1.4;
    rr(ctx, 326, 21, 18, 16, 2.5); ctx.stroke(); ctx.fillRect(326, 25, 18, 1.4); ctx.fillRect(330, 18.5, 1.4, 4); ctx.fillRect(338.6, 18.5, 1.4, 4);
    for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) ctx.fillRect(328.6 + c * 3.6, 28.6 + r * 3.6, 1.8, 1.8);
    if (this.shadowRoot.activeElement === this.button && this.button.matches(':focus-visible')) focusRing(ctx, 316, 10, 38, 38);
    return moving;
  }
  // #endregion night-picker
}
customElements.define('night-picker', NightPicker);
