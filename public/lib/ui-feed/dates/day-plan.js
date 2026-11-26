// <day-plan>: a list of radio stops where the chosen or focused stop fades into an inert heavy copy.
// Standalone ui-feed element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, hit, esc, clamp, spring, TAU } from '../kit.js';
import { focusRing } from '../fold.js';

const SERIF = "'Fraunces', 'Iowan Old Style', 'Palatino Linotype', Palatino, 'Noto Serif', Georgia, serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

export class DayPlan extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static LIST = { x: 14, y: 22 };
  static css = `
    ol { width: 334px; margin: 0; padding: 0; list-style: none; }
    li { height: 85px; }
    label { display: grid; grid-template-columns: 84px 1fr; column-gap: 34px; position: relative; cursor: pointer; }
    time { grid-row: span 2; text-align: right; font: 400 23px/1.15 ${SERIF}; }
    b { font: 400 23px/1.15 ${SERIF}; }
    small { font: 400 12px/1.45 ${SERIF}; }
    input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; margin: 0; opacity: 0; }
    .light { color: #a2905c; }
    .heavy { color: #1d180c; }
    .heavy time, .heavy b { font-weight: 800; letter-spacing: -0.01em; }
    .heavy small { font-weight: 600; }`;
  static observedAttributes = ['value'];

  ready() {
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    const root = this.shadowRoot;
    root.addEventListener('change', () => { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); this.request(); });
    root.addEventListener('focusin', () => this.request()); root.addEventListener('focusout', () => this.request());
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null && v !== this.value) this.value = v; }

  // #region day-plan
  build() {
    const box = this.canvas ?? this.$('.plain'), stops = [...this.querySelectorAll(':scope > option')].map((o) => ({ value: o.value || o.textContent.trim(), time: o.dataset.time ?? '', title: o.textContent.trim(), note: o.dataset.note ?? '' }));
    const was = this.radios ? this.value : this.getAttribute('value');
    const list = (kind) => node(`<ol class="${kind}"${kind === 'heavy' ? ' aria-hidden="true" inert' : ` aria-label="${esc(this.getAttribute('label') ?? 'Plan')}"`}>${stops.map((s) => `<li><label>${kind === 'light' ? `<input type="radio" name="stop" value="${esc(s.value)}">` : ''}<time>${esc(s.time)}</time><b>${esc(s.title)}</b><small>${esc(s.note)}</small></label></li>`).join('')}</ol>`);
    // A second, heavier copy of the list is drawn over each stop as it is chosen. Only the first takes input.
    this.light = list('light'); this.heavy = list('heavy');
    box.replaceChildren(this.light, this.heavy);
    this.radios = [...this.light.querySelectorAll('input')];
    for (const r of this.radios) r.checked = r.value === was;
    this.weights = this.radios.map((r) => ({ x: r.checked ? 1 : 0, v: 0 }));
    this.setValue(this.value);
  }
  get value() { return this.radios.find((r) => r.checked)?.value ?? ''; }
  set value(v) { for (const r of this.radios) r.checked = r.value === v; this.setValue(this.value); this.request(); }
  // The stop that shows: the radio with focus, or else the checked one.
  get shown() { const f = this.radios.indexOf(this.shadowRoot.activeElement); return f >= 0 ? f : this.radios.findIndex((r) => r.checked); }

  draw(ctx, w, h) {
    const { x: LX, y: LY } = DayPlan.LIST, rows = [...this.light.children], at = this.shown;
    let moving = false;
    ctx.fillStyle = '#f5e3a3'; ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(140, 120, 20, 180, 180, 300); g.addColorStop(0, 'rgba(255,248,210,0.5)'); g.addColorStop(1, 'rgba(200,170,90,0.12)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    // the line through the stops
    const DX = LX + 84 + 17, first = LY + 14, last = LY + (rows.length - 1) * 85 + 14;
    ctx.fillStyle = '#c9b06a'; ctx.fillRect(DX - 0.6, first, 1.2, last - first);
    rows.forEach((li, i) => {
      const s = this.weights[i], target = i === at ? 1 : 0;
      moving = spring(s, target, this.dt, 260, 24) || moving;
      const e = clamp(s.x), y = LY + li.offsetTop;
      // each stop is cut from both copies: the light one fades out as the heavy one fades in
      ctx.save(); ctx.beginPath(); ctx.rect(LX - 4, y - 2, 340, li.offsetHeight); ctx.clip();
      if (e < 0.99) { ctx.globalAlpha = 1 - e; put(ctx, this.light, LX, LY); }
      if (e > 0.01) { ctx.globalAlpha = e; put(ctx, this.heavy, LX, LY); }
      ctx.restore();
      ctx.fillStyle = '#e04a2f'; ctx.beginPath(); ctx.arc(DX, y + 14, 9.5 * clamp(s.x, 0, 1.3), 0, TAU); ctx.fill();
      ctx.fillStyle = '#1d180c'; ctx.beginPath(); ctx.arc(DX, y + 14, 3, 0, TAU); ctx.fill();
    });
    hit(ctx, this.light, LX, LY);
    const f = this.shadowRoot.activeElement;
    if (f?.type === 'radio' && f.matches(':focus-visible')) { const li = f.closest('li'); focusRing(ctx, LX - 4, LY + li.offsetTop - 4, 342, 70, '#1d180c'); }
    return moving;
  }
  // #endregion day-plan
}
customElements.define('day-plan', DayPlan);
