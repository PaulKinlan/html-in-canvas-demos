// ui-feed/lists.js: five controls that choose from a list, rebuilt from demos on ui-feed.dev.
//
//   <language-select name>   a <details> of radios. A black bar runs to the row under the pointer, and a
//                            white copy of the list is drawn inside the bar
//   <bin-finder name>        a text field that filters radios. The bins are drawn by the canvas and move to
//                            show where the thing you typed goes
//   <set-list name>          a button for each song and a text field to add one, drawn as strips of tape
//   <retro-combo name>       a text field, a button and a list of radios in a window from the 1990s
//   <city-chips name>        checkboxes, a button for each checked one and a text field that filters them,
//                            printed in two colours that slip when the set changes
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /list-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, easeOut, rr, spring, TAU, reduced } from './kit.js';
import { Fold, cached, focusRing } from './folds.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const HEAVY = "'Arial Black', 'Helvetica Neue', 'Roboto', Arial, sans-serif";
const GROT = "'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif";
const MARKER = "'Permanent Marker', 'Marker Felt', 'Arial Black', 'Impact', sans-serif";
const HAND = "'Caveat', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive";
const MONO = "'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const PIXEL = "'Silkscreen', 'Press Start 2P', 'Lucida Console', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const hide = 'position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none;';
// The part of a label that matches what was typed, in bold.
const marked = (label, q) => { const i = q ? label.toLowerCase().indexOf(q.toLowerCase()) : -1; return i < 0 ? esc(label) : `${esc(label.slice(0, i))}<b>${esc(label.slice(i, i + q.length))}</b>${esc(label.slice(i + q.length))}`; };

// ---------------------------------------------------------------------------------------------------------
// Language: a details of radios, with a bar that runs to the row you point at
// ---------------------------------------------------------------------------------------------------------

export class LanguageSelect extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BAR = { x: 16, y: 20, w: 328, head: 58, row: 40, pad: 4 };
  static css = `
    details { width: 328px; color: #141414; }
    summary { display: block; height: 58px; padding: 0 18px; box-sizing: border-box; background: #0d0d0d; color: #fff; font: 700 30px/58px ${SANS}; letter-spacing: -0.035em; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary:focus-visible { outline: 2px solid #ff3b00; outline-offset: -5px; }
    .list { padding-top: 4px; }
    .list label { display: block; position: relative; height: 40px; padding: 0 18px; box-sizing: border-box; font: 400 26px/40px ${SANS}; letter-spacing: -0.03em; border-bottom: 1px solid rgba(20,20,20,0.28); cursor: pointer; }
    .list label:last-child { border-bottom: 0; }
    .list input { ${hide} }
    .list label:has(:checked)::after, .ink .on::after { content: ' \\00b7'; font-weight: 700; }
    .list label:has(:focus-visible) { outline: 2px dashed currentColor; outline-offset: -4px; }
    .ink { width: 328px; padding-top: 4px; color: #fff; }
    .ink span { display: block; height: 40px; padding: 0 18px; box-sizing: border-box; font: 400 26px/40px ${SANS}; letter-spacing: -0.03em; border-bottom: 1px solid transparent; }
    .ink .on { font-weight: 700; }
    .list label:has(:checked) { font-weight: 700; }`;
  static observedAttributes = ['value'];

  ready() {
    this.top = { x: 0, v: 0 }; this.bottom = { x: 0, v: 0 }; this.point = -1;
    this.build();
    this.addEventListener('feed-plain', () => { this.ink.hidden = true; });   // as plain HTML the copy is not needed
    const root = this.shadowRoot;
    root.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    // A click on a row closes the list. A click that an arrow key sends to the radio does not.
    root.addEventListener('click', (e) => {
      const label = e.target.closest?.('label');
      if (!label) return;
      if (e.target.localName !== 'input') { this.byHand = true; return; }
      if (this.byHand) { this.byHand = false; setTimeout(() => this.toggle(false), reduced() ? 0 : 180); }
    });
    root.addEventListener('keydown', (e) => {
      if (!this.fold.open) return;
      if (e.key === 'Escape' || (e.key === 'Enter' && e.target.type === 'radio')) { e.preventDefault(); this.toggle(false); }
    });
    root.addEventListener('pointermove', (e) => { const l = e.target.closest?.('label'); const i = l ? this.labels.indexOf(l) : -1; if (i !== this.point) { this.point = i; this.request(); } });
    root.addEventListener('pointerleave', () => { this.point = -1; this.request(); }, true);
    root.addEventListener('pointerdown', (e) => { if (e.target === this.canvas && this.fold.open) this.toggle(false); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region language-select
  build() {
    const langs = this.langs = options(this), was = this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    const label = esc(this.getAttribute('label') ?? 'Language');
    const d = this.details = node(`<details><summary aria-label="${label}"><span></span></summary><div class="list" role="radiogroup" aria-label="${label}">${langs.map((o) => `<label lang="${esc(o.value)}"><input type="radio" name="lang" value="${esc(o.value)}">${esc(o.label)}</label>`).join('')}</div></details>`);
    // A copy of the rows in white, for the inside of the bar. It is inert and hidden from assistive technology.
    this.ink = node(`<div class="ink" inert aria-hidden="true">${langs.map((o) => `<span lang="${esc(o.value)}">${esc(o.label)}</span>`).join('')}</div>`);
    box.replaceChildren(d, this.ink);
    this.radios = [...d.querySelectorAll('input')]; this.labels = [...d.querySelectorAll('label')];
    const at = Math.max(0, langs.findIndex((o) => o.value === was), was ? -1 : langs.findIndex((o) => o.selected));
    this.radios[at].checked = true;
    this.top.x = this.bottom.x = at;
    this.fold = new Fold(this, d, 0.3);
    d.firstElementChild.addEventListener('click', (e) => { if (this.plain) return; e.preventDefault(); this.toggle(!this.fold.open); });
    this.sync();
  }
  toggle(open) {
    if (this.plain) { this.details.open = open; return; }
    const inside = this.details.contains(this.shadowRoot.activeElement) && this.shadowRoot.activeElement !== this.details.firstElementChild;
    this.fold.set(open); this.point = -1;
    if (open) this.radios[this.index].focus({ preventScroll: true });
    else if (inside) this.details.firstElementChild.focus({ preventScroll: true });
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === v; this.sync(); this.request(); }
  sync() {
    const o = this.langs[this.index], s = this.details.firstElementChild.firstElementChild;
    s.textContent = o.label; s.lang = o.value;
    [...this.ink.children].forEach((c, i) => c.classList.toggle('on', i === this.index));
    this.setValue(this.value);
  }
  // The row the bar goes to: the one under the pointer, or the one with focus, or the chosen one.
  get aim() { const f = this.radios.indexOf(this.shadowRoot.activeElement); return this.point >= 0 ? this.point : f >= 0 ? f : this.index; }

  draw(ctx, w, h) {
    const B = LanguageSelect.BAR, d = this.details, wasOpen = d.open;
    let moving = this.fold.step(this.dt);
    const shut = wasOpen && !d.open, tall = shut ? this.tall : d.offsetHeight; this.tall = tall; moving ||= shut;
    const e = this.fold.e, list = B.y + B.head + B.pad, aim = this.aim;
    ctx.fillStyle = '#ff3b00'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(cached(this, 'grain', 360, 360, grain), 0, 0, w, h);
    // The two ends of the bar are springs, the leading one stiffer, so the bar stretches as it runs.
    const down = aim >= this.top.x;
    moving = spring(this.top, aim, this.dt, down ? 140 : 420, down ? 20 : 34) || moving;
    moving = spring(this.bottom, aim, this.dt, down ? 420 : 140, down ? 34 : 20) || moving;
    const shown = B.head + this.fold.h * e;
    ctx.save(); ctx.beginPath(); ctx.rect(B.x, B.y, B.w, shown); ctx.clip();
    // the rows come down with the edge of the list
    const drop = (1 - e) * -24;
    put(ctx, d, B.x, B.y, B.w, tall);
    if (e > 0) {
      const y0 = list + this.top.x * B.row + drop, y1 = list + (this.bottom.x + 1) * B.row + drop;
      ctx.save(); ctx.beginPath(); ctx.rect(B.x, Math.max(B.y + B.head, y0), B.w, y1 - y0); ctx.clip();
      ctx.fillStyle = '#0d0d0d'; ctx.fillRect(B.x, y0, B.w, y1 - y0);
      put(ctx, this.ink, B.x, list - B.pad + drop);
      ctx.restore();
    }
    ctx.restore();
    // the arrow in the summary turns over as the list opens
    ctx.save(); ctx.translate(B.x + B.w - 30, B.y + B.head / 2); ctx.rotate(Math.PI * e);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.lineCap = 'square';
    ctx.beginPath(); ctx.moveTo(0, -11); ctx.lineTo(0, 11); ctx.moveTo(-9, 2); ctx.lineTo(0, 11); ctx.lineTo(9, 2); ctx.stroke(); ctx.restore();
    return moving;
  }
  // #endregion language-select
}
customElements.define('language-select', LanguageSelect);

function grain(g) {
  for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,220,190' : '90,10,0'},${0.05 + rnd(i + 3) * 0.08})`; g.fillRect(rnd(i + 1) * 360, rnd(i + 2) * 360, 1, 1); }
}

// ---------------------------------------------------------------------------------------------------------
// Which bin: a text field that filters radios, and five bins that move to answer it
// ---------------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------------
// A setlist: a button for each song and a text field to add one, drawn as strips of tape on a stage
// ---------------------------------------------------------------------------------------------------------

const toSeconds = (t) => { const m = /^(\d+):(\d\d)$/.exec(t ?? ''); return m ? +m[1] * 60 + +m[2] : 0; };
const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function drawStage(g) {
  const bg = g.createRadialGradient(150, 160, 30, 180, 180, 330); bg.addColorStop(0, '#3a2a1e'); bg.addColorStop(0.6, '#221812'); bg.addColorStop(1, '#0d0907');
  g.fillStyle = bg; g.fillRect(0, 0, 360, 360);
  // scuffs, gaffer marks and dust on the floor
  for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${rnd(i) > 0.5 ? '160,130,100' : '0,0,0'},${0.05 + rnd(i + 1) * 0.12})`; g.lineWidth = 0.4 + rnd(i + 2) * 1.6; const x = rnd(i + 3) * 360, y = rnd(i + 4) * 360, l = 10 + rnd(i + 5) * 60, a = (rnd(i + 6) - 0.5) * 0.6; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); }
  for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(220,200,170,${rnd(i + 9) * 0.08})`; g.fillRect(rnd(i + 7) * 360, rnd(i + 8) * 360, 1, 1); }
  // the corner of a monitor speaker and its cable
  g.save(); g.translate(318, -6); g.rotate(0.5);
  const box = g.createLinearGradient(-40, 0, 40, 0); box.addColorStop(0, '#2a2a2a'); box.addColorStop(1, '#0a0a0a');
  g.fillStyle = box; g.fillRect(-46, 0, 92, 70); g.fillStyle = '#151515'; g.beginPath(); g.arc(0, 34, 24, 0, TAU); g.fill();
  g.strokeStyle = '#333'; g.lineWidth = 2; g.beginPath(); g.arc(0, 34, 24, 0, TAU); g.stroke(); g.restore();
  g.strokeStyle = '#0b0b0b'; g.lineWidth = 3.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(326, 62); g.bezierCurveTo(286, 140, 350, 210, 300, 262); g.stroke();
}
// A strip of tape with torn ends, from x 0 to w.
function tape(ctx, w, h, seed, colour) {
  ctx.beginPath(); ctx.moveTo(0, 1);
  for (let x = 0; x <= w; x += 7) ctx.lineTo(x, (rnd(seed + x) - 0.5) * 1.6);
  for (let y = 0; y <= h; y += 3) ctx.lineTo(w + (rnd(seed + y * 3) - 0.5) * 4, y);
  for (let x = w; x >= 0; x -= 7) ctx.lineTo(x, h + (rnd(seed + x * 2) - 0.5) * 1.6);
  for (let y = h; y >= 0; y -= 3) ctx.lineTo((rnd(seed + y * 5) - 0.5) * 4, y);
  ctx.closePath(); ctx.fillStyle = colour; ctx.fill();
  // the paper of the tape: a few fibres, lighter at one edge
  ctx.save(); ctx.clip(); ctx.globalAlpha = 0.16; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h * 0.3);
  ctx.globalAlpha = 0.12; ctx.strokeStyle = '#5a3d1c'; ctx.lineWidth = 0.6;
  for (let i = 0; i < w / 9; i++) { const x = rnd(seed + i * 11) * w; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + 3, h); ctx.stroke(); }
  ctx.restore();
}

export class SetList extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static LIST = { x: 22, y: 12, row: 34 };
  static css = `
    ol { width: 236px; margin: 0; padding: 0; list-style: none; }
    li { height: 34px; display: flow-root; }
    li.leaving { position: absolute; left: 0; }
    button.song, input.add { display: flex; align-items: baseline; gap: 7px; height: 26px; margin-top: 3px; padding: 0 9px; border: 0; background: transparent; color: #17110b; cursor: pointer; white-space: nowrap; }
    button.song b { font: 400 19px/26px ${MARKER}; letter-spacing: 0.04em; text-transform: uppercase; }
    button.song i { font: 400 12px/1 ${HAND}; color: #3b2a19; }
    button.song small { font: 400 8px/1 ${MONO}; color: #3b2a19; }
    button.song:focus-visible { outline: 2px dashed #ff2e88; outline-offset: 1px; }
    input.add { width: 150px; outline: 0; font: 400 17px/26px ${MARKER}; letter-spacing: 0.04em; text-transform: uppercase; caret-color: #ff2e88; cursor: text; }
    input.add::placeholder { color: rgba(23,17,11,0.4); }
    .card { width: 118px; padding: 9px 10px 8px; box-sizing: border-box; color: #2b2b2b; font: 400 7px/1.35 ${MONO}; text-transform: uppercase; }
    .card output { display: block; margin-top: 4px; font: 400 10px/1 ${MARKER}; }
    .card output b { font: 400 25px/1 ${MARKER}; }`;

  ready() {
    this.rows = new Map();                // li -> { y, peel, born } springs and times for each strip
    this.build();
    const root = this.shadowRoot;
    root.addEventListener('keydown', (e) => this.key(e));
    root.addEventListener('focusin', () => this.request());
  }

  // #region set-list
  build() {
    const box = this.canvas ?? this.$('.plain');
    this.ol = node(`<ol aria-label="${esc(this.getAttribute('label') ?? 'Setlist')}"></ol>`);
    this.add = document.createElement('input');
    Object.assign(this.add, { type: 'text', className: 'add', placeholder: 'Add a song', autocomplete: 'off', spellcheck: false, enterKeyHint: 'done' });
    this.add.setAttribute('aria-label', 'Add a song, with its length after it, as in Encore 4:10');
    this.card = node(`<div class="card"><div>${esc(this.getAttribute('venue') ?? '')}</div><div>${esc(this.getAttribute('date') ?? '')}</div><div>${esc(this.getAttribute('times') ?? '')}</div><output aria-live="polite"></output></div>`);
    const last = document.createElement('li'); last.className = 'new'; last.append(this.add);
    this.ol.append(last);
    for (const o of options(this)) this.ol.insertBefore(this.song(o.label, o.data.time, o.data.note), last);
    box.replaceChildren(this.ol, this.card);
    this.sync();
  }
  song(title, time = '', note = '') {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="song" data-time="${esc(time)}" aria-label="${esc(title)}${time ? ', ' + esc(time) : ''}${note ? ', ' + esc(note) : ''}. Delete removes it."><b>${esc(title)}</b>${note ? `<i>${esc(note)}</i>` : ''}<small>${esc(time)}</small></button>`;
    return li;
  }
  get songs() { return [...this.ol.querySelectorAll('li:not(.leaving) button.song')]; }
  get value() { return this.songs.map((b) => b.querySelector('b').textContent); }
  sync() {
    const data = new FormData(), name = this.getAttribute('name') || 'song';
    for (const t of this.value) data.append(name, t);
    this.setValue(data);
    const total = this.songs.reduce((s, b) => s + toSeconds(b.dataset.time), 0);
    this.card.querySelector('output').innerHTML = `Set <b>${clock(total)}</b>`;
    this.request();
  }
  // Enter in the field adds a song ("Title 4:20"). Backspace in an empty field goes to the last song.
  // Delete or Backspace on a song takes it off; the arrow keys move between songs.
  key(e) {
    const t = e.target, songs = this.songs, i = songs.indexOf(t);
    if (t === this.add) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const m = /^(.*?)(?:\s+(\d{1,2}:\d\d))?$/.exec(this.add.value.trim());
        if (!m || !m[1]) return;
        const li = this.song(m[1], m[2] ?? '');
        this.ol.insertBefore(li, this.add.parentElement);
        this.rows.set(li, { y: { x: li.offsetTop, v: 0 }, born: performance.now() });
        this.add.value = ''; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (e.key === 'Backspace' && !this.add.value && songs.length) { e.preventDefault(); songs.at(-1).focus({ preventScroll: true }); }
      if (e.key === 'ArrowUp' && songs.length) { e.preventDefault(); songs.at(-1).focus({ preventScroll: true }); }
      return;
    }
    if (i < 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); (songs[i + 1] ?? this.add).focus({ preventScroll: true }); }
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); songs[i - 1].focus({ preventScroll: true }); }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.remove(songs[i]); }
  }
  // The strip is taken out of the flow at once, so the others close up, and is drawn peeling off until it goes.
  remove(button) {
    const songs = this.songs, i = songs.indexOf(button), li = button.closest('li');
    (songs[i + 1] ?? songs[i - 1] ?? this.add).focus({ preventScroll: true });
    const top = li.offsetTop;
    li.classList.add('leaving'); li.style.top = top + 'px'; li.inert = true;
    const row = this.rows.get(li) ?? { y: { x: top, v: 0 } }; row.peel = performance.now(); this.rows.set(li, row);
    if (reduced() || this.plain) li.remove();
    this.sync(); this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  draw(ctx, w, h, now) {
    const { x: LX, y: LY } = SetList.LIST;
    let moving = false;
    ctx.drawImage(cached(this, 'stage', 360, 360, drawStage), 0, 0, w, h);
    const focus = this.shadowRoot.activeElement;
    for (const li of this.ol.children) {
      const row = this.rows.get(li) ?? { y: { x: li.offsetTop, v: 0 } }; this.rows.set(li, row);
      const target = li.offsetTop;
      moving = spring(row.y, target, this.dt, 190, 20) || moving;
      const b = li.firstElementChild, y = LY + row.y.x, bw = li.classList.contains('new') ? 150 : b.offsetWidth;
      const born = row.born ? clamp((now - row.born) / 260) : 1, peel = row.peel ? clamp((now - row.peel) / 450) : 0;
      if (born < 1 || (peel > 0 && peel < 1)) moving = true;
      if (peel >= 1) { li.remove(); this.rows.delete(li); continue; }
      const lift = b === focus ? 1 : 0, seed = (b.textContent.length * 37 + bw) | 0;
      ctx.save();
      ctx.translate(LX + bw * (1 - peel) * 0, y + 3);
      // peeling: the strip lifts from its right end and goes up and away
      if (peel) { ctx.translate(bw * 0.1, -18 * easeOut(peel)); ctx.rotate(-0.35 * easeOut(peel)); ctx.globalAlpha = 1 - peel ** 2; }
      if (lift) { ctx.rotate(-0.012); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 4; }
      const tw = bw * easeOut(born);
      // the pink tab that holds the strip down, then the strip, then the song on it
      ctx.save(); ctx.translate(-14, 8); ctx.rotate(-0.08); tape(ctx, 24, 12, seed + 5, '#ff2e88'); ctx.restore();
      tape(ctx, Math.max(4, tw), 26, seed, li.classList.contains('new') ? '#9c7a50' : '#c69c66');
      ctx.shadowColor = 'transparent';
      ctx.beginPath(); ctx.rect(-4, -4, tw + 8, 34); ctx.clip();
      put(ctx, this.ol, 0, -li.offsetTop - 3);
      ctx.restore();
    }
    // the song buttons answer where the strips come to rest
    hit(ctx, this.ol, LX, LY);
    // the running order card, pinned at an angle
    ctx.save(); ctx.translate(238, 262); ctx.rotate(-0.05);
    ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ece6d6'; ctx.fillRect(0, 0, 118, 86); ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(120,140,190,0.35)'; ctx.lineWidth = 0.6; for (let y = 22; y < 86; y += 9) { ctx.beginPath(); ctx.moveTo(4, y); ctx.lineTo(114, y); ctx.stroke(); }
    put(ctx, this.card, 0, 0);
    ctx.save(); ctx.translate(50, -6); ctx.rotate(0.1); tape(ctx, 26, 11, 77, 'rgba(255,46,136,0.9)'); ctx.restore();
    ctx.restore();
    return moving;
  }
  // #endregion set-list
}
customElements.define('set-list', SetList);

// ---------------------------------------------------------------------------------------------------------
// A city in a window from the 1990s: a text field, a button and a list of radios
// ---------------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------------
// Cities, printed in two colours: checkboxes, a button for each checked one and a field that filters them
// ---------------------------------------------------------------------------------------------------------

const BLUE = '#2537c9', PINK = '#f14aa4', CREAM = '#f3ead8', YELLOW = '#ffc21a';
function drawHalftone(g) {
  g.fillStyle = PINK; g.fillRect(0, 0, 360, 360);
  g.fillStyle = 'rgba(120,0,60,0.16)';
  for (let y = 0; y < 360; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 360; x += 4) { g.beginPath(); g.arc(x, y, 0.75, 0, TAU); g.fill(); }
}

export class CityChips extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static BOX = { x: 14, y: 58, w: 332, h: 50 };
  static LIST = { x: 14, y: 122, w: 332 };
  static css = `
    header { width: 332px; height: 44px; }
    h2 { position: absolute; left: 0; top: 2px; margin: 0; font: 800 34px/1 ${GROT}; letter-spacing: -0.03em; color: ${BLUE}; }
    header output { position: absolute; right: 0; bottom: 6px; font: 700 12px/1 ${MONO}; color: ${BLUE}; }
    .box { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; width: 332px; min-height: 50px; padding: 8px 10px; box-sizing: border-box; }
    .box button { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 6px 0 10px; border: 0; background: ${BLUE}; color: #fff; font: 600 15px/1 ${GROT}; cursor: pointer; }
    .box button span { display: grid; place-items: center; width: 15px; height: 15px; border-radius: 50%; background: ${PINK}; color: ${BLUE}; font: 900 11px/1 ${SANS}; }
    .box button:focus-visible { outline: 2px dashed ${BLUE}; outline-offset: 2px; }
    .box input { flex: 1; min-width: 60px; height: 30px; padding: 0 4px; border: 0; outline: 0; background: transparent; color: ${BLUE}; font: 600 15px/30px ${GROT}; caret-color: ${PINK}; }
    .yellow button { background: ${YELLOW}; color: transparent; }
    .yellow button span, .yellow input { visibility: hidden; }
    .list { width: 332px; padding: 6px 0; }
    .list label { display: flex; align-items: center; gap: 14px; position: relative; height: 20px; padding: 0 14px; font: 500 14px/20px ${GROT}; color: ${BLUE}; cursor: pointer; }
    .list label[hidden] { display: none; }
    .list label small { width: 14px; font: 700 8.5px/1 ${MONO}; opacity: 0.75; }
    .list label input { ${hide} }
    .list label:has(:checked)::after { content: ''; position: absolute; right: 16px; top: 6px; width: 9px; height: 9px; border-radius: 50%; background: ${PINK}; }
    .list label:has(:focus-visible) { outline: 2px dashed ${BLUE}; outline-offset: -2px; }`;

  ready() {
    this.reg = { x: { x: -3, v: 0 }, y: { x: 0, v: 0 } };
    this.bar = { x: 0, v: 0 }; this.active = -1; this.openT = 0;
    this.build();
    this.addEventListener('feed-plain', () => { this.plate.hidden = true; });
    const root = this.shadowRoot;
    root.addEventListener('focusin', () => this.request());
    root.addEventListener('focusout', () => setTimeout(() => this.request(), 0));
    root.addEventListener('pointermove', (e) => { const l = e.target.closest?.('.list label'); const i = l ? this.labels.indexOf(l) : -1; if (i >= 0 && i !== this.active) { this.active = i; this.request(); } });
  }

  // #region city-chips
  build() {
    const cities = this.cities = options(this), box = this.canvas ?? this.$('.plain'), label = esc(this.getAttribute('label') ?? 'Cities');
    this.header = node(`<header><h2 id="cc-label">${label}</h2><output></output></header>`);
    this.box = node('<div class="box" role="group" aria-labelledby="cc-label"><input type="text" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="cc-list" autocomplete="off" spellcheck="false" aria-label="Add a city"></div>');
    // The yellow plate: a copy of the row of buttons with only the yellow ink. It is inert and hidden.
    this.plate = node('<div class="box yellow" inert aria-hidden="true"></div>');
    this.list = node(`<div class="list" id="cc-list" role="group" aria-labelledby="cc-label">${cities.map((o, i) => `<label id="cc-${i}"><input type="checkbox" value="${esc(o.value)}"${o.selected ? ' checked' : ''}><small>${String(i + 1).padStart(2, '0')}</small><span>${esc(o.label)}</span></label>`).join('')}</div>`);
    box.replaceChildren(this.header, this.plate, this.box, this.list);
    this.q = this.box.querySelector('input');
    this.boxes = [...this.list.querySelectorAll('input')]; this.labels = this.boxes.map((b) => b.parentElement);
    this.order = this.boxes.filter((b) => b.checked);     // the buttons keep the order the cities were chosen in
    this.list.addEventListener('change', (e) => this.toggled(e.target));
    this.box.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.uncheck(this.boxes.find((x) => x.value === b.value), true); });
    this.q.addEventListener('input', () => { this.filter(); this.active = this.visible[0] ?? -1; this.request(); });
    this.q.addEventListener('keydown', (e) => this.key(e));
    this.box.addEventListener('keydown', (e) => { if (e.target.localName === 'button' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); this.uncheck(this.boxes.find((x) => x.value === e.target.value), true); } });
    this.sync(false);
  }
  get visible() { return this.labels.map((l, i) => (l.hidden ? -1 : i)).filter((i) => i >= 0); }
  filter() {
    const q = this.q.value.trim().toLowerCase();
    this.labels.forEach((l, i) => { l.hidden = !!q && !this.cities[i].label.toLowerCase().includes(q); });
  }
  key(e) {
    const vis = this.visible, at = vis.indexOf(this.active);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.active = vis[clamp(at + (e.key === 'ArrowDown' ? 1 : -1), 0, vis.length - 1)] ?? -1; }
    if (e.key === 'Enter' && this.active >= 0 && vis.includes(this.active)) { e.preventDefault(); const b = this.boxes[this.active]; b.checked = !b.checked; this.toggled(b); this.q.value = ''; this.filter(); }
    if (e.key === 'Backspace' && !this.q.value && this.order.length) { e.preventDefault(); this.uncheck(this.order.at(-1)); }
    if (e.key === 'Escape') { this.q.value = ''; this.filter(); }
    this.q.setAttribute('aria-activedescendant', this.active >= 0 ? `cc-${this.active}` : '');
    this.request();
  }
  toggled(b) { this.order = b.checked ? [...this.order.filter((x) => x !== b), b] : this.order.filter((x) => x !== b); this.sync(); }
  uncheck(b, refocus) { if (!b) return; b.checked = false; this.toggled(b); if (refocus) this.q.focus({ preventScroll: true }); }
  get value() { return this.order.map((b) => b.value); }
  // A change to the set is a new pass through the press: the yellow plate lands a little off and settles.
  sync(kick = true) {
    const chips = this.order.map((b) => { const o = this.cities[this.boxes.indexOf(b)]; return `<button type="button" value="${esc(o.value)}" aria-label="Remove ${esc(o.label)}">${esc(o.label)}<span aria-hidden="true">×</span></button>`; }).join('');
    for (const old of this.box.querySelectorAll('button')) old.remove();
    this.q.insertAdjacentHTML('beforebegin', chips);
    this.plate.innerHTML = chips;
    this.header.querySelector('output').textContent = `${String(this.order.length).padStart(2, '0')}/${String(this.boxes.length).padStart(2, '0')}`;
    const data = new FormData(), name = this.getAttribute('name') || 'city';
    for (const v of this.value) data.append(name, v);
    this.setValue(data);
    if (kick && !reduced()) { this.reg.x.v = -90 + rnd(this.order.length) * 40; this.reg.y.v = 60 * (rnd(this.order.length + 3) - 0.5); }
    this.dispatchEvent(new Event(kick ? 'change' : 'ready', { bubbles: kick }));
    this.request();
  }

  draw(ctx, w, h) {
    const B = CityChips.BOX, L = CityChips.LIST;
    let moving = false;
    ctx.drawImage(cached(this, 'halftone', 360, 360, drawHalftone), 0, 0, w, h);
    moving = spring(this.reg.x, -3, this.dt, 120, 9) || moving; moving = spring(this.reg.y, 0, this.dt, 120, 9) || moving;
    // the heading in blue, over the same heading in red a little off
    ctx.save(); ctx.globalAlpha = 0.85; ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = '#ff2a2a'; ctx.font = `800 34px ${GROT}`; ctx.save(); ctx.letterSpacing = '-0.03em'; ctx.fillText(this.header.querySelector('h2').textContent, B.x + 2.5, 14 + 2 + 29); ctx.restore();
    ctx.restore();
    put(ctx, this.header, B.x, 14);
    // the field: cream paper with a blue rule, the yellow plate, then the blue plate over it
    const bh = Math.max(B.h, this.box.offsetHeight);
    ctx.fillStyle = CREAM; ctx.fillRect(B.x, B.y, B.w, bh);
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; put(ctx, this.plate, B.x + this.reg.x.x, B.y + this.reg.y.x); ctx.restore();
    put(ctx, this.box, B.x, B.y);
    ctx.strokeStyle = BLUE; ctx.lineWidth = 2.5; ctx.strokeRect(B.x + 1, B.y + 1, B.w - 2, bh - 2);
    // The list shows while the control has focus. A yellow bar runs to the row the keys or the pointer are on.
    const inside = !!this.shadowRoot.activeElement, want = inside ? 1 : 0;
    if (this.q.getAttribute('aria-expanded') !== String(inside)) this.q.setAttribute('aria-expanded', String(inside));
    if (this.openT !== want) { this.openT = reduced() ? want : clamp(this.openT + (want ? 1 : -1) * this.dt / 0.2); moving = true; }
    const LY = B.y + bh + 14, e = easeOut(this.openT);
    if (e > 0) {
      const lh = this.list.offsetHeight * e;
      // a shadow of dots, then the paper, then the rows
      ctx.fillStyle = 'rgba(37,55,201,0.55)';
      for (let y = LY + 5; y < LY + lh + 5; y += 3) for (let x = L.x + 5 + ((y / 3) % 2 ? 1.5 : 0); x < L.x + L.w + 5; x += 3) if (x > L.x + L.w - 1 || y > LY + lh - 1) ctx.fillRect(x, y, 1.2, 1.2);
      ctx.fillStyle = CREAM; ctx.fillRect(L.x, LY, L.w, lh);
      ctx.save(); ctx.beginPath(); ctx.rect(L.x, LY, L.w, lh); ctx.clip();
      const row = this.labels[this.active];
      if (row && !row.hidden) {
        moving = spring(this.bar, row.offsetTop, this.dt, 320, 28) || moving;
        ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = YELLOW; ctx.fillRect(L.x + 4 + this.reg.x.x + 3, LY + this.bar.x, L.w - 8, 20); ctx.restore();
      }
      put(ctx, this.list, L.x, LY);
      ctx.restore();
    } else hit(ctx, this.list, L.x, -400);
    return moving;
  }
  // #endregion city-chips
}
customElements.define('city-chips', CityChips);
