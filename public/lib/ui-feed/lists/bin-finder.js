// <bin-finder>: a text field that filters radios, with five bins drawn by the canvas on springs.
// Standalone ui-feed element; depends only on ../kit.js.

import { FeedControl, put, options, esc, clamp, easeOut, spring, TAU, reduced } from '../kit.js';

const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const HEAVY = "'Arial Black', 'Helvetica Neue', 'Roboto', Arial, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const hide = 'position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none;';
// The part of a label that matches what was typed, in bold.
const marked = (label, q) => { const i = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1; return i < 0 ? esc(label) : `${esc(label.slice(0, i))}<b>${esc(label.slice(i, i + q.length))}</b>${esc(label.slice(i + q.length))}`; };

const BINS = {
  paper: { name: 'Paper & card', note: 'Flatten it first', colour: '#1f3fd8' },
  plastics: { name: 'Plastics & cans', note: 'Rinse it out', colour: '#ffd400' },
  glass: { name: 'Glass', note: 'Lids off', colour: '#e8301c' },
  general: { name: 'General waste', note: 'The last resort', colour: '#111' },
  centre: { name: 'Recycling center', note: 'Never in a bin', colour: '#111' },
};
const BIN_ORDER = Object.keys(BINS);
// Where each bin sits when nothing has been typed: the centre of its shape, and its width and height.
const REST = { paper: [62, 120, 92, 92], plastics: [180, 120, 92, 92], glass: [299, 124, 90, 80], general: [121, 228, 210, 40], centre: [304, 232, 80, 80] };

function drawBin(ctx, key, cx, cy, w, h) {
  ctx.fillStyle = BINS[key].colour; ctx.strokeStyle = BINS[key].colour;
  if (key === 'paper' || key === 'general') ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  else if (key === 'plastics') { ctx.beginPath(); ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, TAU); ctx.fill(); }
  else if (key === 'glass') { ctx.beginPath(); ctx.moveTo(cx, cy - h / 2); ctx.lineTo(cx + w / 2, cy + h / 2); ctx.lineTo(cx - w / 2, cy + h / 2); ctx.closePath(); ctx.fill(); }
  else { const r = Math.min(w, h) / 2, t = r * 0.27; ctx.lineWidth = t; ctx.beginPath(); ctx.arc(cx, cy, r - t / 2, 0, TAU); ctx.stroke(); }
}

export class BinFinder extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    input.q { width: 328px; height: 48px; padding: 0; border: 0; outline: 0; background: transparent; color: #111; font: 900 36px/48px ${HEAVY}; letter-spacing: -0.02em; text-transform: uppercase; caret-color: #e8301c; }
    input.q::placeholder { color: #111; opacity: 1; }
    .list { width: 176px; border: 2px solid #111; background: #fff; }
    .list label { display: flex; gap: 9px; align-items: center; position: relative; padding: 6px 10px; cursor: pointer; font: 600 12px/1.1 ${SANS}; color: #111; text-transform: uppercase; letter-spacing: 0.02em; }
    .list label + label { border-top: 1px solid #ddd; }
    .list label b { font-weight: 900; }
    .list label small { display: block; margin-top: 2px; font: 700 7.5px/1 ${SANS}; letter-spacing: 0.08em; color: #444; }
    .list label i { flex: none; width: 9px; height: 9px; border: 2px solid #111; border-radius: 50%; }
    .list input { ${hide} }
    .list label:has(:focus-visible), .list label:hover { background: #111; color: #fff; }
    .list label:has(:focus-visible) small, .list label:hover small { color: #ccc; }
    .list label:has(:focus-visible) i, .list label:hover i { border-color: #fff; background: #ffd400; }
    .list p { margin: 0; padding: 8px 10px; font: 700 11px/1.2 ${SANS}; text-transform: uppercase; }
    output { display: block; width: 150px; font: 900 26px/1 ${HEAVY}; text-transform: uppercase; color: #111; letter-spacing: -0.01em; }
    output small { display: block; margin-top: 12px; padding-top: 8px; border-top: 3px solid #111; font: 800 10px/1 ${SANS}; letter-spacing: 0.1em; }`;
  static observedAttributes = ['value'];

  ready() {
    this.marks = Object.fromEntries(BIN_ORDER.map((k) => { const [x, y, bw, bh] = REST[k]; return [k, { x: { x, v: 0 }, y: { x: y, v: 0 }, w: { x: bw, v: 0 }, h: { x: bh, v: 0 }, a: { x: 1, v: 0 } }]; }));
    this.listT = 0;
    this.build();
  }
  attributeChangedCallback(_, __, v) { if (this.items && v !== null && v !== this.value) this.value = v; }

  // #region bin-finder
  build() {
    const items = this.items = options(this), box = this.canvas ?? this.$('.plain');
    this.q = node(`<input class="q" type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="bins" autocomplete="off" spellcheck="false" enterkeyhint="search" placeholder="${esc(this.getAttribute('label') ?? 'Which bin?')}" aria-label="What are you throwing away?">`);
    this.list = node('<div class="list" id="bins" role="radiogroup" aria-label="Things that match" hidden></div>');
    this.out = node('<output aria-live="polite"></output>');
    box.replaceChildren(this.q, this.list, this.out);
    this.q.addEventListener('input', () => { this.picked = null; this.filter(); this.sync(); });
    this.q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && !this.list.hidden) { e.preventDefault(); this.list.querySelector('input')?.focus({ preventScroll: true }); }
      if (e.key === 'Enter') { e.preventDefault(); const first = this.list.querySelector('input'); if (first && !this.list.hidden) this.pick(first.value); }
      if (e.key === 'Escape') { this.list.hidden = true; this.request(); }
    });
    // A row is chosen with a click, or with Enter or Space. The arrow keys move between rows (and check them).
    this.list.addEventListener('click', (e) => { const l = e.target.closest('label'); if (l && e.detail) this.pick(l.querySelector('input').value); });
    this.list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(e.target.value); }
      if (e.key === 'Escape') { this.q.focus({ preventScroll: true }); this.list.hidden = true; this.request(); }
    });
    const v = this.getAttribute('value'); if (v) this.value = v; else this.sync();
  }
  // The rows that match what is typed: words that start with it first, then any that hold it.
  filter() {
    const q = this.q.value.trim().toLowerCase();
    const found = !q ? [] : this.items.filter((o) => o.label.toLowerCase().includes(q))
      .sort((a, b) => Number(!a.label.toLowerCase().split(/\s/).some((w) => w.startsWith(q))) - Number(!b.label.toLowerCase().split(/\s/).some((w) => w.startsWith(q)))).slice(0, 4);
    this.found = found;
    this.list.innerHTML = found.length
      ? found.map((o) => `<label><input type="radio" name="item" value="${esc(o.value)}"><i></i><span>${marked(o.label, q)}<small>${esc(BINS[o.data.bin]?.name ?? '')}</small></span></label>`).join('')
      : `<p role="status">Nothing called that</p>`;
    this.list.hidden = !q;
    this.q.setAttribute('aria-expanded', String(!!q));
    this.request();
  }
  pick(v) {
    const o = this.items.find((x) => x.value === v); if (!o) return;
    this.picked = o; this.q.value = o.label; this.list.hidden = true; this.found = [];
    this.q.setAttribute('aria-expanded', 'false');
    this.q.focus({ preventScroll: true });
    this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
  }
  get value() { return this.picked?.value ?? ''; }
  set value(v) { const o = this.items.find((x) => x.value === v); this.picked = o ?? null; this.q.value = o?.label ?? ''; this.found = []; this.list.hidden = true; this.sync(); }
  sync() {
    const b = BINS[this.picked?.data.bin];
    this.out.innerHTML = b ? `${esc(b.name)}<small>${esc(b.note)}</small>` : '';
    this.setValue(this.value);
    try { this.internals?.setValidity(this.q.value && !this.picked ? { badInput: true } : {}, 'Choose one of the things listed', this.q); } catch {}
    this.request();
  }
  // Where each bin goes: its place in the grid, beside the list of matches, or alone and large when chosen.
  targets() {
    const t = {};
    if (this.picked) {
      for (const k of BIN_ORDER) t[k] = k === this.picked.data.bin ? [100, 210, 150, 150, 1] : [...REST[k].slice(0, 2), 0, 0, 0];
      if (this.picked.data.bin === 'general') t.general = [100, 210, 170, 70, 1];
      if (this.picked.data.bin === 'glass') t.glass = [100, 205, 160, 140, 1];
      return t;
    }
    if (!this.list.hidden) {
      const keys = [...new Set((this.found ?? []).map((o) => o.data.bin))], n = keys.length, size = n > 2 ? 62 : n > 1 ? 84 : 120;
      for (const k of BIN_ORDER) {
        const i = keys.indexOf(k);
        if (i < 0) { t[k] = [...REST[k].slice(0, 2), REST[k][2] * 0.4, REST[k][3] * 0.4, 0]; continue; }
        const cy = n === 1 ? 160 : 112 + i * (230 / n), wide = k === 'general';
        t[k] = [278, cy, wide ? size * 1.3 : size, wide ? size * 0.4 : size * (k === 'glass' ? 0.85 : 1), 1];
      }
      return t;
    }
    for (const k of BIN_ORDER) t[k] = [...REST[k], 1];
    return t;
  }

  draw(ctx, w, h) {
    let moving = false;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    put(ctx, this.q, 16, 14);
    ctx.fillStyle = '#111'; ctx.fillRect(16, 64, 328, 3.5);
    const t = this.targets(), resting = !this.picked && this.list.hidden;
    for (const k of BIN_ORDER) {
      const m = this.marks[k], [x, y, bw, bh, a] = t[k];
      moving = spring(m.x, x, this.dt, 170, 19) || moving; moving = spring(m.y, y, this.dt, 170, 19) || moving;
      moving = spring(m.w, bw, this.dt, 200, 17) || moving; moving = spring(m.h, bh, this.dt, 200, 17) || moving;
      moving = spring(m.a, a, this.dt, 260, 30) || moving;
      if (m.a.x < 0.01 || m.w.x < 1) continue;
      ctx.globalAlpha = clamp(m.a.x);
      drawBin(ctx, k, m.x.x, m.y.x, Math.max(0, m.w.x), Math.max(0, m.h.x));
      // the name under each bin while nothing has been typed
      if (resting || (!this.picked && t[k][4])) {
        ctx.fillStyle = '#111'; ctx.font = `800 8.5px ${SANS}`; ctx.textAlign = k === 'centre' || k === 'glass' ? 'right' : 'left';
        const lx = ctx.textAlign === 'right' ? m.x.x + m.w.x / 2 : m.x.x - m.w.x / 2;
        ctx.save(); ctx.letterSpacing = '0.08em'; ctx.fillText(BINS[k].name.toUpperCase(), lx, m.y.x + m.h.x / 2 + 16); ctx.restore();
      }
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    // the list of matches comes down under the field
    const want = this.list.hidden ? 0 : 1;
    if (this.listT !== want) { this.listT = reduced() ? want : clamp(this.listT + (want ? 1 : -1) * this.dt / 0.16); moving = true; }
    if (!this.list.hidden && this.listT > 0) {
      const e = easeOut(this.listT);
      ctx.save(); ctx.beginPath(); ctx.rect(14, 78, 182, (this.list.offsetHeight + 4) * e); ctx.clip();
      put(ctx, this.list, 16, 80 - (1 - e) * 12);
      ctx.restore();
    }
    if (this.picked) put(ctx, this.out, 196, 166);
    return moving;
  }
  // #endregion bin-finder
}
customElements.define('bin-finder', BinFinder);
