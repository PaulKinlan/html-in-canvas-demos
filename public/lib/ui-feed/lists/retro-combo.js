// <retro-combo>: a text field, a button and a list of radios in a 1990s window.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, options, esc, reduced } from '../kit.js';
import { cached } from '../fold.js';

const PIXEL = "'Silkscreen', 'Press Start 2P', 'Lucida Console', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const hide = 'position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none;';
// The part of a label that matches what was typed, in bold.
const marked = (label, q) => { const i = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1; return i < 0 ? esc(label) : `${esc(label.slice(0, i))}<b>${esc(label.slice(i, i + q.length))}</b>${esc(label.slice(i + q.length))}`; };

function drawDesk90(g) {
  g.fillStyle = '#5a2fe0'; g.fillRect(0, 0, 360, 360);
  g.fillStyle = '#4a22c8';
  for (let y = 0; y < 360; y += 2) for (let x = (y / 2) % 2 ? 1 : 0; x < 360; x += 2) g.fillRect(x, y, 1, 1);
}
// A raised (or sunk) edge, two pixels deep, as a window of that time drew it.
function bevel(ctx, x, y, w, h, sunk = false) {
  const [a, b, c, d] = sunk ? ['#7b7b7b', '#fff', '#000', '#dcdcdc'] : ['#fff', '#000', '#dcdcdc', '#7b7b7b'];
  ctx.fillStyle = a; ctx.fillRect(x, y, w, 2); ctx.fillRect(x, y, 2, h);
  ctx.fillStyle = b; ctx.fillRect(x, y + h - 2, w, 2); ctx.fillRect(x + w - 2, y, 2, h);
  ctx.fillStyle = c; ctx.fillRect(x + 2, y + 2, w - 4, 1); ctx.fillRect(x + 2, y + 2, 1, h - 4);
  ctx.fillStyle = d; ctx.fillRect(x + 2, y + h - 3, w - 4, 1); ctx.fillRect(x + w - 3, y + 2, 1, h - 4);
}

export class RetroCombo extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  static WIN = { x: 20, y: 22, w: 320 };
  static css = `
    h3 { width: 300px; margin: 0; font: 700 20px/30px ${PIXEL}; color: #111; letter-spacing: 0.02em; }
    input.q { width: 266px; height: 30px; padding: 0 6px; border: 0; outline: 0; background: transparent; color: #111; font: 700 17px/30px ${PIXEL}; caret-color: #000; }
    button.drop { width: 26px; height: 26px; padding: 0; border: 0; background: transparent; cursor: pointer; }
    button.drop:focus-visible { outline: 1px dotted #000; outline-offset: -5px; }
    .list { width: 292px; max-height: 210px; overflow: hidden; background: #fff; }
    .list label { display: block; position: relative; height: 26px; padding: 0 6px; font: 700 17px/26px ${PIXEL}; color: #111; cursor: pointer; }
    .list label[hidden] { display: none; }
    .list label:hover, .list label:has(:checked), .list label:has(:focus-visible) { background: #000080; color: #fff; }
    .list label:has(:focus-visible) { outline: 1px dotted #ff0; outline-offset: -3px; }
    .list input { ${hide} }
    .list label b { color: #c00000; font-weight: inherit; }
    .list label:hover b, .list label:has(:checked) b, .list label:has(:focus-visible) b { color: #ff0; }
    output { display: block; width: 292px; height: 24px; padding: 0 6px; box-sizing: border-box; font: 700 13px/24px ${PIXEL}; color: #111; }`;
  static observedAttributes = ['value'];

  ready() {
    this.unroll = 0;
    this.build();
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region retro-combo
  build() {
    const cities = this.cities = options(this), box = this.canvas ?? this.$('.plain');
    this.head = node(`<h3 id="rc-label">${esc(this.getAttribute('label') ?? 'Find a city')}</h3>`);
    this.q = node('<input class="q" type="text" role="combobox" aria-labelledby="rc-label" aria-autocomplete="list" aria-expanded="false" aria-controls="rc-list" autocomplete="off" spellcheck="false">');
    this.drop = node('<button type="button" class="drop" tabindex="-1" aria-label="Show every city"></button>');
    this.list = node(`<div class="list" id="rc-list" role="radiogroup" aria-labelledby="rc-label" hidden>${cities.map((o) => `<label><input type="radio" name="city" value="${esc(o.value)}"><span>${esc(o.label)}</span></label>`).join('')}</div>`);
    this.status = node('<output role="status"></output>');
    box.replaceChildren(this.head, this.q, this.drop, this.list, this.status);
    this.radios = [...this.list.querySelectorAll('input')]; this.labels = this.radios.map((r) => r.parentElement);
    this.q.addEventListener('input', () => { this.chosen = ''; for (const r of this.radios) r.checked = false; this.show(true); this.sync(); });
    this.q.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); if (this.list.hidden) this.show(true); this.shown[0]?.querySelector('input').focus({ preventScroll: true }); }
      if (e.key === 'Escape') this.show(false);
      if (e.key === 'Enter' && !this.list.hidden && this.shown.length) { e.preventDefault(); this.pick(this.shown[0].querySelector('input')); }
    });
    this.drop.addEventListener('click', () => { const open = this.list.hidden || this.filtered; this.q.value = open ? this.q.value : this.q.value; this.show(open, true); this.q.focus({ preventScroll: true }); });
    this.list.addEventListener('click', (e) => { const l = e.target.closest('label'); if (l && e.detail) this.pick(l.querySelector('input')); });
    this.list.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.pick(e.target); }
      if (e.key === 'Escape') { this.show(false); this.q.focus({ preventScroll: true }); }
    });
    const v = this.getAttribute('value'); if (v) this.value = v; else this.sync();
  }
  // Open the list, filtered by what is typed, or every city when the button asks for all of them.
  show(open, all = false) {
    const q = all ? '' : this.q.value.trim().toLowerCase();
    this.filtered = !!q;
    this.labels.forEach((l, i) => { const o = this.cities[i], hit = !q || o.label.toLowerCase().includes(q); l.hidden = !hit; l.querySelector('span').innerHTML = marked(o.label, q); });
    const n = this.shown.length, was = !this.list.hidden;
    this.list.hidden = !open || !n;
    if (open && !was) this.unroll = 0;
    this.q.setAttribute('aria-expanded', String(!this.list.hidden));
    this.status.textContent = !open ? '' : n ? `${n} ${n === 1 ? 'city' : 'cities'}` : 'No results';
    this.request();
  }
  get shown() { return this.labels.filter((l) => !l.hidden); }
  pick(radio) { radio.checked = true; this.chosen = radio.value; this.q.value = this.cities.find((o) => o.value === radio.value).label; this.show(false); this.q.focus({ preventScroll: true }); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); }
  get value() { return this.chosen ?? ''; }
  set value(v) { const r = this.radios.find((x) => x.value === v); this.chosen = r ? v : ''; for (const x of this.radios) x.checked = x === r; this.q.value = r ? this.cities.find((o) => o.value === v).label : ''; this.sync(); }
  sync() {
    this.setValue(this.value);
    try { this.internals?.setValidity(this.q.value && !this.chosen ? { badInput: true } : {}, 'Choose a city from the list', this.q); } catch {}
    this.request();
  }

  draw(ctx, w, h) {
    const { x: X, y: Y, w: W } = RetroCombo.WIN;
    let moving = false;
    ctx.drawImage(cached(this, 'desk', 360, 360, drawDesk90), 0, 0, w, h);
    const open = !this.list.hidden, listH = open ? this.list.offsetHeight : 0;
    // The list unrolls in four steps, as a window of that time did, not with a smooth ease.
    if (open && this.unroll < 1) { this.unroll = reduced() ? 1 : Math.min(1, this.unroll + this.dt / 0.12); moving = true; }
    const steps = Math.ceil(this.unroll * 4) / 4, shown = Math.round(listH * steps);
    const H = 34 + 46 + (open ? shown + 6 : 0) + (this.status.textContent ? 24 : 0) + 6;
    // the window, with a hard black shadow
    ctx.fillStyle = '#000'; ctx.fillRect(X + 6, Y + 6, W, H);
    ctx.fillStyle = '#d4d0c8'; ctx.fillRect(X, Y, W, H); bevel(ctx, X, Y, W, H);
    // the title bar: a box to tick and the label
    ctx.fillStyle = '#ffb000'; ctx.fillRect(X + 6, Y + 6, W - 12, 30); bevel(ctx, X + 6, Y + 6, W - 12, 30, true);
    ctx.fillStyle = '#fff'; ctx.fillRect(X + 14, Y + 15, 13, 13); ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.strokeRect(X + 14, Y + 15, 13, 13);
    if (this.chosen) { ctx.beginPath(); ctx.moveTo(X + 16, Y + 21); ctx.lineTo(X + 20, Y + 25); ctx.lineTo(X + 26, Y + 16); ctx.stroke(); }
    put(ctx, this.head, X + 34, Y + 6);
    // the field and its button
    const FY = Y + 44;
    ctx.fillStyle = '#fff'; ctx.fillRect(X + 10, FY, W - 20, 34); bevel(ctx, X + 10, FY, W - 20, 34, true);
    put(ctx, this.q, X + 13, FY + 2);
    ctx.fillStyle = '#d4d0c8'; ctx.fillRect(X + W - 40, FY + 4, 26, 26); bevel(ctx, X + W - 40, FY + 4, 26, 26, open && !this.filtered);
    ctx.fillStyle = '#000'; ctx.beginPath(); ctx.moveTo(X + W - 34, FY + 13); ctx.lineTo(X + W - 20, FY + 13); ctx.lineTo(X + W - 27, FY + 21); ctx.fill();
    ctx.fillRect(X + W - 34, FY + 23, 14, 2);
    put(ctx, this.drop, X + W - 40, FY + 4);
    let y = FY + 40;
    if (open) {
      ctx.fillStyle = '#fff'; ctx.fillRect(X + 10, y - 2, W - 20, shown + 4); bevel(ctx, X + 10, y - 2, W - 20, shown + 4, true);
      ctx.save(); ctx.beginPath(); ctx.rect(X + 12, y, W - 24, shown); ctx.clip(); put(ctx, this.list, X + 14, y); ctx.restore();
      y += shown + 6;
    }
    if (this.status.textContent) put(ctx, this.status, X + 14, y);
    return moving;
  }
  // #endregion retro-combo
}
customElements.define('retro-combo', RetroCombo);
