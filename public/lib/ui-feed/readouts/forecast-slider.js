// <forecast-slider>: a range over the hours of a day with interpolated temperature and sky colour.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, options, clamp, lerp, smooth, rr, spring } from '../kit.js';

const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
// A range under a drawn handle: the pointer is captured and the control works out the value.
function grip(el, on) {
  let id = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    id = e.pointerId; try { el.setPointerCapture(id); } catch {}      // a pointer made in script cannot be captured
    e.preventDefault(); el.focus({ preventScroll: true }); on.down?.(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) on.move?.(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; on.up?.(e); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return () => id !== null;
}
let grainTile = null;
function grain(ctx, w, h, alpha = 0.06) {
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 96;
    const g = grainTile.getContext('2d'), d = g.createImageData(96, 96);
    let s = 11;
    for (let i = 0; i < d.data.length; i += 4) { s = (s * 1103515245 + 12345) & 0x7fffffff; const v = (s >> 8) & 255; d.data[i] = d.data[i + 1] = d.data[i + 2] = v > 127 ? 255 : 0; d.data[i + 3] = Math.abs(v - 127); }
    g.putImageData(d, 0, 0);
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, w, h); ctx.restore();
}

// #region forecast-slider
// A range over the hours the forecast covers. Each <option> is a time with a temperature, and the big
// figure is the temperature between them at the time under the thumb. The sky behind goes dark outside the
// hours between sunrise and sunset.
const minutes = (hhmm) => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const clock = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min) % 60).padStart(2, '0')}`;
export class ForecastSlider extends FeedControl {
  static size = [360, 372];
  static html = `<span class="place"><slot>Here</slot></span><output class="temp"></output><input type="range" aria-label="Forecast time">`;
  static css = `
    .place { width: 200px; font: 700 21px/1 ${SANS}; color: #fff6e4; letter-spacing: -0.01em; }
    .temp { width: 330px; font: 900 112px/1 'Arial Black', 'Helvetica Neue', ${SANS}; color: #fff6e4; letter-spacing: -0.05em; font-variant-numeric: tabular-nums; white-space: nowrap; }
    input { width: 80px; height: 52px; opacity: 0; margin: 0; touch-action: none; }`;
  static observedAttributes = ['value'];
  static X0 = 38; static X1 = 322; static TY = 222;

  ready() {
    this.range = this.$('input');
    const read = () => {
      let last = -1;
      this.points = options(this).map((o) => { let t = minutes(o.value); if (t <= last) t += 1440; last = t; return { t, temp: Number(o.data.temp), label: o.value }; });
      this.min = this.points[0]?.t ?? 0; this.max = this.points.at(-1)?.t ?? 1440;
      Object.assign(this.range, { min: this.min, max: this.max, step: 10 });
      this.t = clamp(this.t ?? minutes(this.getAttribute('value') ?? '12:00'), this.min, this.max);
      this.shown = this.shown ?? { x: this.temp(this.t), v: 0 };
      this.sync();
    };
    new MutationObserver(read).observe(this, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-temp', 'value'] });
    let off = 0;
    this.held = grip(this.range, {
      down: (e) => { off = point(this, e).x - this.tx(this.t); this.request(); },
      move: (e) => { const { X0, X1 } = ForecastSlider; this.t = clamp(this.min + ((point(this, e).x - off - X0) / (X1 - X0)) * (this.max - this.min), this.min, this.max); this.sync(true); },
      up: () => { this.t = Math.round(this.t / 10) * 10; this.sync(true); this.dispatchEvent(new Event('change', { bubbles: true })); },
    });
    this.range.addEventListener('input', () => { if (!this.held()) { this.t = this.range.valueAsNumber; this.sync(true); } });
    read();
  }
  attributeChangedCallback(_, __, v) { if (this.points && v !== null && v !== this.value) this.value = v; }
  tx(t) { return lerp(ForecastSlider.X0, ForecastSlider.X1, (t - this.min) / (this.max - this.min || 1)); }
  // #region forecast-temp
  // Between two forecasts the temperature follows a smooth curve through both, level at each one.
  temp(t) {
    const p = this.points; if (!p.length) return 0;
    if (t <= p[0].t) return p[0].temp;
    for (let i = 1; i < p.length; i++) if (t <= p[i].t) return lerp(p[i - 1].temp, p[i].temp, smooth((t - p[i - 1].t) / (p[i].t - p[i - 1].t)));
    return p.at(-1).temp;
  }
  // #endregion forecast-temp
  get value() { return clock(Math.round(this.t / 10) * 10); }
  set value(v) { let t = minutes(v); if (t < this.min) t += 1440; this.t = clamp(t, this.min, this.max); this.sync(); }
  get temperature() { return Math.round(this.temp(this.t) * 10) / 10; }
  sync(input = false) {
    this.setValue(this.value);
    if (!this.held()) this.range.value = Math.round(this.t / 10) * 10;
    this.range.setAttribute('aria-valuetext', `${this.value}, ${this.temperature.toFixed(1)} degrees`);
    if (input) this.dispatchEvent(new Event('input', { bubbles: true }));
    this.request();
  }

  draw(ctx, w, h) {
    const { X0, X1, TY } = ForecastSlider;
    const live = spring(this.shown, this.temp(this.t), this.dt, 260, 30);
    const text = `${this.shown.x.toFixed(1)}°`, out = this.$('.temp');
    if (out.textContent !== text) out.textContent = text;
    // the sky: daylight between sunrise and sunset, with three quarters of an hour of dusk at each end
    const rise = minutes(this.getAttribute('sunrise') ?? '06:00'), set = minutes(this.getAttribute('sunset') ?? '18:00'), tt = this.t % 1440;
    const day = smooth((tt - rise + 22) / 45) * (1 - smooth((tt - set + 22) / 45)) * (this.t >= 1440 ? smooth((tt - rise + 22) / 45) : 1);
    const mix = (a, b) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], day))).join(',')})`;
    ctx.fillStyle = mix([38, 30, 84], [240, 100, 24]); ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(this.tx(this.t), TY, 10, this.tx(this.t), TY, 260); glow.addColorStop(0, `rgba(255,190,110,${0.28 * day + 0.06})`); glow.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.05);
    put(ctx, this.$('.place'), 20, 22);
    ctx.fillStyle = '#fff6e4'; ctx.font = `700 21px ${SANS}`; ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillText(day > 0.5 ? (this.getAttribute('summary') ?? 'Clear') : 'Night', w - 20, 21);
    put(ctx, out, 16, 62);
    // track, filled up to the thumb
    const x = this.tx(this.t);
    ctx.fillStyle = 'rgba(255,246,228,0.28)'; rr(ctx, X0 - 14, TY - 6, X1 - X0 + 28, 12, 6); ctx.fill();
    ctx.fillStyle = 'rgba(255,246,228,0.5)'; rr(ctx, X0 - 14, TY - 6, x - X0 + 14, 12, 6); ctx.fill();
    // ticks and the forecasts
    ctx.strokeStyle = '#fff6e4'; ctx.fillStyle = '#fff6e4'; ctx.lineWidth = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let t = this.min; t <= this.max; t += 60) { const tx = this.tx(t), big = this.points.some((p) => p.t === t); ctx.globalAlpha = big ? 1 : 0.55; ctx.beginPath(); ctx.moveTo(tx, TY + 24); ctx.lineTo(tx, TY + (big ? 33 : 29)); ctx.stroke(); }
    ctx.globalAlpha = 1;
    for (const p of this.points) {
      const near = 1 - clamp(Math.abs(p.t - this.t) / 120);
      ctx.globalAlpha = 0.7 + near * 0.3; ctx.font = `800 ${(12 + near * 2).toFixed(1)}px ${SANS}`; ctx.fillText(`${p.temp}°`, this.tx(p.t), TY + 50);
      ctx.globalAlpha = 0.8; ctx.font = `600 8px ${SANS}`; ctx.fillText(p.label, this.tx(p.t), TY + 66);
    }
    ctx.globalAlpha = 1;
    // the thumb: a pill with the time on it
    const held = this.held();
    ctx.fillStyle = 'rgba(60,20,0,0.25)'; rr(ctx, x - 29, TY - 14 + (held ? 2 : 4), 58, 30, 15); ctx.fill();
    ctx.fillStyle = '#fff6e4'; rr(ctx, x - 29, TY - 15, 58, 30, 15); ctx.fill();
    ctx.fillStyle = mix([38, 30, 84], [226, 86, 16]); ctx.font = `800 13px ${SANS}`; ctx.fillText(clock(this.t), x, TY + 0.5);
    if (this.range.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; rr(ctx, x - 34, TY - 20, 68, 40, 20); ctx.stroke(); }
    hit(ctx, this.range, x - 40, TY - 26, 80, 52);
    // sunrise and sunset
    ctx.fillStyle = '#fff6e4'; ctx.font = `700 12px ${SANS}`; ctx.textBaseline = 'middle';
    for (const [label, tx, align, up] of [[clock(rise), 20, 'left', true], [clock(set), w - 20, 'right', false]]) {
      ctx.textAlign = align; ctx.fillText(label, tx + (align === 'left' ? 20 : 0), h - 24);
      const ix = align === 'left' ? tx + 7 : tx - ctx.measureText(label).width - 13;
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ix - 7, h - 19); ctx.lineTo(ix + 7, h - 19); ctx.moveTo(ix + 4.5, h - 19); ctx.arc(ix, h - 19, 4.5, 0, Math.PI, true);
      ctx.moveTo(ix, h - 33); ctx.lineTo(ix, h - 27); ctx.moveTo(ix - 2.5, up ? h - 30.5 : h - 29.5); ctx.lineTo(ix, up ? h - 33 : h - 27); ctx.lineTo(ix + 2.5, up ? h - 30.5 : h - 29.5); ctx.stroke();
    }
    return live;
  }
}
customElements.define('forecast-slider', ForecastSlider);
// #endregion forecast-slider
