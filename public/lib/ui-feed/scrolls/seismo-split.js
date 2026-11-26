// <seismo-split>: a seismograph trace and event table split by a draggable vertical <input type="range">.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, rr, reduced } from '../kit.js';
import { cached } from '../fold.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const VT = "'VT323', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
// As plain HTML the component's rules are gone, so a scroll container is given a height of its own.
const scroller = (el) => { el.style.cssText += 'max-height:300px;overflow-y:auto;width:100%'; };
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };

const AMBER = '#ffb21e';

export class SeismoSplit extends FeedControl {
  static size = [360, 360];
  static radius = 6;
  static PANE = { x: 12, top: 56, bottom: 348, bar: 14 };
  static css = `
    header { width: 336px; height: 44px; color: ${AMBER}; font: 400 13px/1 ${VT}; }
    header > b { position: absolute; left: 0; top: 2px; font: 400 15px/1 ${VT}; letter-spacing: 0.04em; }
    header > span { position: absolute; left: 0; top: 18px; font: 400 13px/1 ${VT}; }
    header time { position: absolute; right: 0; top: 2px; font: 400 28px/1 ${VT}; }
    header time small { font-size: 13px; margin-right: 6px; }
    input.split { width: 336px; height: 14px; margin: 0; opacity: 0; cursor: ns-resize; touch-action: none; }
    .events { width: 336px; overflow-y: auto; scrollbar-width: none; outline: 0; }
    .events::-webkit-scrollbar { display: none; }
    .events:focus-visible { box-shadow: inset 0 0 0 1px ${AMBER}; }
    table { width: 336px; border-collapse: collapse; color: ${AMBER}; font: 400 13px/1 ${VT}; }
    th { position: sticky; top: 0; background: #120a02; text-align: left; font-weight: 400; padding: 2px 3px; border-bottom: 1px solid ${AMBER}; }
    td { padding: 1px 3px; white-space: nowrap; }
    td:nth-child(2), td:nth-child(3) { text-align: right; }`;

  ready() {
    this.build();
    this.addEventListener('feed-plain', () => { scroller(this.events); this.split.style.opacity = 1; });
    // The clock ticks once a second, only while the control is on screen.
    new IntersectionObserver(([e]) => {
      clearInterval(this.tick);
      if (e.isIntersecting && !reduced()) this.tick = setInterval(() => this.request(), 1000);
    }).observe(this);
  }

  // #region seismo-split
  build() {
    const box = this.canvas ?? this.$('.plain'), ev = options(this);
    this.header = node(`<header><b>${esc(this.getAttribute('net') ?? 'Network')}</b><span>${esc(this.getAttribute('station') ?? '')}</span><time><small>UTC</small><span></span></time></header>`);
    // The bar between the panes. A range input, so it has a value, the arrow keys and Page Up and Down.
    this.split = node('<input class="split" type="range" min="60" max="236" step="1" value="96" aria-label="Height of the trace" aria-orientation="vertical">');
    this.events = node(`<div class="events" tabindex="0" role="region" aria-label="Events"><table><thead><tr><th>UTC</th><th>MAG</th><th>DEPTH</th><th>LOCATION</th></tr></thead><tbody>${ev.map((o) => `<tr><td>${esc(o.value)}</td><td>${esc(o.data.mag)}</td><td>${esc(o.data.depth)}KM</td><td>${esc(o.label)}</td></tr>`).join('')}</tbody></table></div>`);
    box.replaceChildren(this.header, this.split, this.events);
    this.mags = ev.map((o) => ({ t: o.value, mag: Number(o.data.mag) }));
    this.split.addEventListener('input', () => this.layout());
    // A drag anywhere on the bar moves it: the range input's own drag runs along it, not across it.
    let start = null;
    this.split.addEventListener('pointerdown', (e) => { e.preventDefault(); this.split.focus({ preventScroll: true }); try { this.split.setPointerCapture(e.pointerId); } catch {} start = { y: e.clientY, v: +this.split.value }; });
    this.split.addEventListener('pointermove', (e) => {
      if (!start) return;
      const k = this.canvas.getBoundingClientRect().width / 360;
      this.split.value = String(Math.round(start.v + (e.clientY - start.y) / k));
      this.layout(); this.split.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const end = () => { start = null; };
    this.split.addEventListener('pointerup', end); this.split.addEventListener('pointercancel', end);
    // Up makes the trace shorter, as the bar goes up. A range's ArrowUp would make it taller.
    this.split.addEventListener('keydown', (e) => {
      const by = { ArrowUp: -8, ArrowDown: 8, PageUp: -40, PageDown: 40 }[e.key];
      if (by === undefined) return;
      e.preventDefault(); this.split.value = String(+this.split.value + by); this.layout();
    });
    this.layout();
  }
  get trace() { return +this.split.value; }
  layout() {
    const P = SeismoSplit.PANE, want = Math.round(P.bottom - (P.top + this.trace + P.bar));
    this.split.setAttribute('aria-valuetext', `Trace ${Math.round((this.trace - 60) / 176 * 100)}%, ${Math.floor(this.trace / 34)} ${Math.floor(this.trace / 34) === 1 ? 'minute' : 'minutes'} shown`);
    if (this.events.offsetHeight !== want) this.events.style.height = want + 'px';
    this.request();
  }

  draw(ctx, w, h, now) {
    const P = SeismoSplit.PANE, T = this.trace, x0 = P.x, x1 = 360 - P.x;
    const t0 = this.base ??= Date.UTC(2026, 10, 21, 14, 32, 43) - now;   // the clock starts where the original's did
    const t = new Date(t0 + now), hh = (n) => String(n).padStart(2, '0');
    const shown = `${hh(t.getUTCHours())}:${hh(t.getUTCMinutes())}:${hh(t.getUTCSeconds())}`, face = this.header.querySelector('time span');
    if (face.textContent !== shown) face.textContent = shown;   // a change raises a paint event, so only once a second
    ctx.fillStyle = '#0c2a52'; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(cached(this, 'case', 360, 360, (g) => { for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '120,170,230' : '0,10,30'},${0.08 + rnd(i + 1) * 0.12})`; g.fillRect(rnd(i + 2) * 360, rnd(i + 3) * 360, 2, 2); } }), 0, 0, w, h);
    ctx.fillStyle = '#120a02'; rr(ctx, 8, 8, 344, 344, 8); ctx.fill();
    // a glow on everything amber: the picture of the header and the table, and the trace
    ctx.save(); ctx.shadowColor = 'rgba(255,170,30,0.65)'; ctx.shadowBlur = 6;
    put(ctx, this.header, x0, 10);
    // The trace: a row a minute, the newest at the bottom. A shorter pane shows the last few minutes.
    const rows = 6, rowH = 34, y0 = P.top + T - rows * rowH;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, P.top, x1 - x0, T); ctx.clip();
    ctx.strokeStyle = 'rgba(255,178,30,0.25)'; ctx.lineWidth = 0.6;
    for (let s = 0; s <= 6; s++) { const x = x0 + (x1 - x0) * s / 6; ctx.beginPath(); ctx.moveTo(x, P.top); ctx.lineTo(x, P.top + T); ctx.stroke(); }
    ctx.font = `400 13px ${VT}`; ctx.fillStyle = AMBER;
    for (let s = 0; s < 6; s++) ctx.fillText(String(s * 10), x0 + 4 + (x1 - x0) * s / 6, y0 + 10 > P.top ? P.top + 10 : P.top + 10);
    ctx.strokeStyle = AMBER; ctx.lineWidth = 1.1;
    for (let r = 0; r < rows; r++) {
      const cy = y0 + r * rowH + rowH / 2, quake = r === rows - 1;
      if (cy < P.top - rowH) continue;
      ctx.fillText(`14:${27 + r}`, x0 + 3, cy - 6);
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 1.5) {
        const i = x * 3.1 + r * 977, k = (x - x0) / (x1 - x0);
        let a = (rnd(i) - 0.5) * 3 + Math.sin(i * 0.05) * 1.5;
        if (quake && k > 0.18) a *= 1 + 9 * Math.exp(-(k - 0.2) * 9) * (k > 0.26 ? 1.8 : 0.6);
        x === x0 ? ctx.moveTo(x, cy + a) : ctx.lineTo(x, cy + a);
      }
      ctx.stroke();
      if (quake) { ctx.fillText('P', x0 + (x1 - x0) * 0.18, cy - 4); ctx.fillText('S', x0 + (x1 - x0) * 0.26, cy - 4); }
    }
    // the arrival times of the last event, on a strip at the foot of the trace
    ctx.fillStyle = '#120a02'; ctx.fillRect(x0, P.top + T - 14, x1 - x0, 14);
    const [h0, m0, s0] = String(this.mags[0]?.t ?? '0:0:0').split(':').map(Number), at = (d) => { const v = h0 * 3600 + m0 * 60 + s0 + d; return `${hh(Math.floor(v / 3600))}:${hh(Math.floor(v / 60) % 60)}:${(v % 60).toFixed(1).padStart(4, '0')}`; };
    ctx.fillStyle = AMBER; ctx.fillText(`P ${at(0)}   S ${at(2.2)}   S−P 2.2 S`, x0 + 2, P.top + T - 3);
    ctx.restore();
    // the bar between the panes, with its arrows
    const by = P.top + T;
    ctx.fillStyle = 'rgba(255,178,30,0.4)'; ctx.fillRect(x0, by + 3, x1 - x0, P.bar - 6);
    ctx.fillStyle = AMBER; ctx.fillRect(170, by + 1, 20, P.bar - 2);
    ctx.fillStyle = '#120a02'; ctx.beginPath(); ctx.moveTo(174, by + 6); ctx.lineTo(180, by + 2.5); ctx.lineTo(186, by + 6); ctx.moveTo(174, by + 8); ctx.lineTo(180, by + 11.5); ctx.lineTo(186, by + 8); ctx.fill();
    put(ctx, this.events, x0, by + P.bar);
    ctx.restore();
    hit(ctx, this.split, x0, by, x1 - x0, P.bar);
    if (this.shadowRoot.activeElement === this.split) { ctx.strokeStyle = '#fff'; ctx.setLineDash([4, 3]); ctx.strokeRect(x0 - 1, by, x1 - x0 + 2, P.bar); ctx.setLineDash([]); }
    // scan lines over the screen
    ctx.drawImage(cached(this, 'scan', 360, 360, (g) => { g.fillStyle = 'rgba(0,0,0,0.22)'; for (let y = 8; y < 352; y += 3) g.fillRect(8, y, 344, 1); }), 0, 0, w, h);
    return false;
  }
  // #endregion seismo-split
}
customElements.define('seismo-split', SeismoSplit);
