// <bus-tabs>: bus stop timetable with radio tabs and sliding <dl> departure panels.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, spring } from '../kit.js';
import { focusRing } from '../fold.js';

const SANS = "'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const COND = "'Roboto Condensed', 'Arial Narrow', 'DIN Condensed', 'Liberation Sans Narrow', sans-serif-condensed, 'Helvetica Neue', Arial, sans-serif";

export class BusTabs extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static HEAD = 104; static TABS = 41;
  static css = `
    input { opacity: 0; margin: 0; touch-action: manipulation; }
    label { text-align: center; font: 700 19px/41px ${COND}; font-stretch: condensed; letter-spacing: -0.01em; color: #fff; white-space: nowrap; cursor: pointer; }
    .head { width: 360px; height: 104px; color: #fff; font: 600 11px/1.2 ${SANS}; }
    .route { font: 700 104px/104px ${COND}; font-stretch: condensed; letter-spacing: -0.045em; color: #fff; white-space: nowrap; }
    .head span { position: absolute; left: 118px; }
    .head .from { top: 12px; } .head .to { top: 79px; }
    .head .stop { top: 33px; font: 700 27px/1.2 ${COND}; font-stretch: condensed; letter-spacing: -0.01em; }
    dl { width: 360px; height: 215px; margin: 0; padding: 9px 14px 0; box-sizing: border-box; columns: 2; column-gap: 10px; font: 700 11.5px/20px ${COND}; font-stretch: condensed; color: #151515; }
    dl div { display: flex; height: 20px; margin-bottom: 0.6px; break-inside: avoid; }
    dl div:nth-child(odd) { background: linear-gradient(#d3ecd9, #d3ecd9) 0 0 / 100% 14px no-repeat; }
    dt { flex: none; width: 27px; text-align: center; font-size: 13px; color: #fff; background: #0a9c47; }
    dd { flex: 1; display: flex; justify-content: space-around; margin: 0; padding: 0 3px; }`;
  static observedAttributes = ['value'];

  ready() {
    this.canvas.setAttribute('role', 'radiogroup');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-times', 'route', 'stop', 'towards', 'label'] });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.type !== 'radio') return; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }
  // #region bus-tabs
  build() {
    const days = this.days = options(this), was = this.radios ? this.value : this.getAttribute('value'), box = this.canvas ?? this.$('.plain');
    box.replaceChildren();
    (this.canvas ?? box).ariaLabel = this.getAttribute('label') ?? 'Day of the week';
    const add = (html) => { const t = document.createElement('template'); t.innerHTML = html; const el = t.content.firstElementChild; el.setAttribute('drawable', ''); box.append(el); return el; };
    this.head = add(`<div class="head"><span class="from">Departures from</span><span class="stop">${esc(this.getAttribute('stop') ?? '')}</span><span class="to">towards ${esc(this.getAttribute('towards') ?? '')}</span></div>`);
    this.route = add(`<b class="route">${esc(this.getAttribute('route') ?? '')}</b>`);
    const tw = 360 / Math.max(1, days.length);
    this.radios = []; this.labels = []; this.panels = [];
    days.forEach((o, i) => {
      const r = add(`<input type="radio" name="day" id="d${i}" value="${esc(o.value)}">`); r.style.cssText = `width:${tw}px;height:41px`;
      const l = add(`<label for="d${i}">${esc(o.label)}</label>`); l.style.width = `${tw}px`;
      // "0510 0525 0610" becomes one row for each hour, in the order the hours first appear
      const hours = new Map();
      for (const t of (o.data.times ?? '').split(/[\s,]+/).filter(Boolean)) { const hh = t.slice(0, 2); hours.set(hh, [...(hours.get(hh) ?? []), t.slice(-2)]); }
      const p = add(`<dl aria-label="${esc(o.label)} departures">${[...hours].map(([hh, mins]) => `<div><dt>${esc(hh)}</dt><dd>${mins.map((m) => `<span>${esc(m)}</span>`).join('')}</dd></div>`).join('')}</dl>`);
      this.radios.push(r); this.labels.push(l); this.panels.push(p);
    });
    const at = Math.max(0, days.findIndex((o) => o.value === was), was ? -1 : days.findIndex((o) => o.selected));
    if (this.radios[at]) this.radios[at].checked = true;
    this.pos = { x: at, v: 0 };
    this.sync();
  }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index]?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === String(v); this.sync(); this.request(); }
  sync() {
    // Every timetable stays laid out so that two can be drawn during a slide. Only the checked day's is read out.
    this.panels.forEach((p, i) => { p.inert = i !== this.index; });
    this.setValue(this.value);
  }

  draw(ctx, w, h) {
    const { HEAD, TABS } = BusTabs, n = this.radios.length, tw = w / Math.max(1, n);
    const moving = spring(this.pos, this.index, this.dt, 210, 27), x = this.pos.x;
    const green = ctx.createLinearGradient(0, 0, w, HEAD); green.addColorStop(0, '#22ad5a'); green.addColorStop(0.45, '#0ea24c'); green.addColorStop(1, '#08964a');
    ctx.fillStyle = green; ctx.fillRect(0, 0, w, HEAD);
    put(ctx, this.head, 0, 0);
    put(ctx, this.route, 10, 2, Math.min(this.route.offsetWidth, 98), 104);     // squeezed to fit if the face is wide
    // the strip of tabs: white names on black, and a paper tab that slides to the checked one
    ctx.fillStyle = '#111'; ctx.fillRect(0, HEAD, w, TABS);
    this.labels.forEach((l, i) => put(ctx, l, i * tw, HEAD));
    ctx.save(); ctx.beginPath(); ctx.rect(x * tw, HEAD, tw, TABS); ctx.clip();
    ctx.fillStyle = '#f3f5f0'; ctx.fillRect(0, HEAD, w, TABS);
    ctx.filter = 'invert(1)'; this.labels.forEach((l, i) => put(ctx, l, i * tw, HEAD));
    ctx.restore();
    // the timetables side by side, moved so that the checked one is in view
    ctx.fillStyle = '#f3f5f0'; ctx.fillRect(0, HEAD + TABS, w, h - HEAD - TABS);
    ctx.save(); ctx.beginPath(); ctx.rect(0, HEAD + TABS, w, h - HEAD - TABS); ctx.clip();
    this.panels.forEach((p, i) => {
      const px = (i - x) * w;
      if (px <= -w + 0.5 || px >= w - 0.5) return;
      put(ctx, p, px, HEAD + TABS);
      if (px > 0.5) { ctx.fillStyle = '#111'; ctx.fillRect(px - 0.8, HEAD + TABS, 1.2, h); }
    });
    ctx.restore();
    this.radios.forEach((r, i) => {
      if (r.matches(':focus-visible')) focusRing(ctx, i * tw + 4, HEAD + 4, tw - 8, TABS - 8, r.checked ? '#111' : '#fff');
      hit(ctx, r, i * tw, HEAD, tw, TABS);
    });
    return moving;
  }
  // #endregion bus-tabs
}
customElements.define('bus-tabs', BusTabs);
