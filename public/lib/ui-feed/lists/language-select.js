// <language-select>: a <details> of radios with a black bar and an inert white copy drawn inside it.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, options, esc, spring, reduced } from '../kit.js';
import { Fold, cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const hide = 'position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; pointer-events: none;';

function grain(g) {
  for (let i = 0; i < 2200; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,220,190' : '90,10,0'},${0.05 + rnd(i + 3) * 0.08})`; g.fillRect(rnd(i + 1) * 360, rnd(i + 2) * 360, 1, 1); }
}

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
