// <tuner-slider>: an <input type="range"> drawn as the tuning slide of a hi-fi tuner, with stations as <option>s.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, options, clamp, lerp, rr, spring, TAU, reduced } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";

// A pointer position in the control's design units.
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };

// A native range sits under a drawn handle. While the handle is held the range's own `input` events are ignored.
function grip(el, on) {
  let id = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    id = e.pointerId; try { el.setPointerCapture(id); } catch {}      // a pointer made in script cannot be captured
    e.preventDefault(); el.focus({ preventScroll: true });
    on.down?.(e);
  });
  el.addEventListener('pointermove', (e) => { if (e.pointerId === id) on.move?.(e); });
  const end = (e) => { if (e.pointerId !== id) return; id = null; on.up?.(e); };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  return () => id !== null;
}

// #region tuner-slider
// A range from 88 to 108 MHz. The slide has a flywheel behind it: let go while it is moving and it coasts,
// slowed by friction. Near a station (an <option>) the tuner's frequency control pulls it the rest of the way
// in, and the stereo lamp comes on with the strength of the signal.
export class TunerSlider extends FeedControl {
  static size = [360, 312];
  static html = `<output class="freq"></output><output class="station"></output><input type="range" aria-label="Tuning">`;
  static css = `
    input { width: 56px; height: 64px; opacity: 0; margin: 0; touch-action: none; }
    .freq { width: 150px; font: 300 46px/1 ${SANS}; color: #e9f6dc; text-shadow: 0 0 10px rgba(190,255,170,0.55); font-variant-numeric: tabular-nums; }
    .station { width: 170px; height: 14px; font: 500 10px/14px ${SANS}; letter-spacing: 0.14em; text-transform: uppercase; color: #a9c79a; white-space: nowrap; overflow: hidden; }`;
  static observedAttributes = ['value'];
  static X0 = 54; static X1 = 306; static KY = 256;

  ready() {
    this.range = this.$('input');
    this.min = Number(this.getAttribute('min') ?? 88); this.max = Number(this.getAttribute('max') ?? 108);
    Object.assign(this.range, { min: this.min, max: this.max, step: 0.1 });
    this.f = clamp(Number(this.getAttribute('value') ?? 93.1), this.min, this.max); this.vel = 0;
    this.needle = { x: this.f, v: 0 };
    const read = () => { this.stations = options(this).map((o) => ({ f: Number(o.value), name: o.label })); this.sync(); };
    new MutationObserver(read).observe(this, { childList: true, subtree: true, characterData: true });
    let off = 0, last = null;
    this.held = grip(this.range, {
      down: (e) => { off = point(this, e).x - this.fx(this.f); this.vel = 0; last = null; },
      move: (e) => {
        const { X0, X1 } = TunerSlider, f = clamp(this.min + ((point(this, e).x - off - X0) / (X1 - X0)) * (this.max - this.min), this.min, this.max);
        const now = performance.now();
        if (last && now > last.t) this.vel = clamp(lerp(this.vel, ((f - last.f) / (now - last.t)) * 1000, 0.5), -14, 14);
        last = { f, t: now }; this.f = f; this.sync(true);
      },
      up: () => { if (last && performance.now() - last.t > 80) this.vel = 0; if (reduced()) { this.vel = 0; this.settle(); } this.request(); },
    });
    this.range.addEventListener('input', () => { if (!this.held()) { this.f = this.range.valueAsNumber; this.vel = 0; this.sync(true); } });
    this.range.addEventListener('change', () => { if (!this.held()) this.dispatchEvent(new Event('change', { bubbles: true })); });
    read();
  }
  attributeChangedCallback(_, __, v) { if (this.range && v !== null) this.value = v; }
  fx(f) { return lerp(TunerSlider.X0, TunerSlider.X1, (f - this.min) / (this.max - this.min)); }
  get value() { return (Math.round(this.f * 10) / 10).toFixed(1); }
  set value(v) { this.f = clamp(Number(v) || this.min, this.min, this.max); this.vel = 0; this.sync(); }
  // The nearest station and how much of its signal gets through at this frequency.
  get signal() {
    let best = { s: 0, st: null };
    for (const st of this.stations ?? []) { const s = Math.exp(-(((this.f - st.f) / 0.13) ** 2)); if (s > best.s) best = { s, st }; }
    return best;
  }
  sync(input = false) {
    const text = this.value, { s, st } = this.signal;
    this.setValue(text);
    if (!this.held()) this.range.value = text;
    this.range.setAttribute('aria-valuetext', `${text} megahertz${s > 0.6 ? `, ${st.name}` : ''}`);
    const f = this.$('.freq'), n = this.$('.station'), name = s > 0.6 ? st.name : '';
    if (f.textContent !== text) f.textContent = text;
    if (n.textContent !== name) n.textContent = name;
    if (input) this.dispatchEvent(new Event('input', { bubbles: true }));
    this.request();
  }
  settle() { this.f = Math.round(this.f * 10) / 10; this.vel = 0; this.sync(true); this.dispatchEvent(new Event('change', { bubbles: true })); }
  // #region tuner-step
  step(dt) {
    if (this.held()) return false;
    const { st } = this.signal, near = st && Math.abs(st.f - this.f) < 0.3 && Math.abs(this.vel) < 2.5;
    if (near && this.f === st.f && !this.vel) return false;
    if (!near && Math.abs(this.vel) < 0.03) { if (this.vel) this.settle(); return false; }
    if (near) this.vel += ((st.f - this.f) * 90 - this.vel * 14) * dt;      // pulled in by the station
    else this.vel *= Math.exp(-dt * 4);                                      // the flywheel runs down
    this.f += this.vel * dt;
    if (this.f <= this.min || this.f >= this.max) { this.f = clamp(this.f, this.min, this.max); this.vel = 0; }
    if (near && Math.abs(st.f - this.f) < 0.004 && Math.abs(this.vel) < 0.05) { this.f = st.f; this.settle(); return false; }
    this.sync(true);
    return true;
  }
  // #endregion tuner-step

  draw(ctx, w, h) {
    const { X0, X1, KY } = TunerSlider;
    let live = false;
    for (let i = 0; i < 4; i++) live = this.step(this.dt / 4) || live;
    live = spring(this.needle, this.f, this.dt, 900, 44) || live;
    const { s } = this.signal, nx = this.fx(this.needle.x), kx = this.fx(this.f);
    // wooden cheeks and a brushed, champagne face
    const wood = ctx.createLinearGradient(0, 0, w, 0); wood.addColorStop(0, '#4a2412'); wood.addColorStop(0.5, '#6b3519'); wood.addColorStop(1, '#43200f');
    ctx.fillStyle = wood; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(20,8,2,${0.08 + rnd(i) * 0.22})`; ctx.fillRect(rnd(i + 9) * w, 0, 0.6 + rnd(i + 5) * 1.6, h); }
    const face = ctx.createLinearGradient(0, 12, 0, h - 12); face.addColorStop(0, '#d9c8a6'); face.addColorStop(0.5, '#cbb991'); face.addColorStop(1, '#bca97f');
    ctx.fillStyle = face; rr(ctx, 12, 12, w - 24, h - 24, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 0.5; ctx.beginPath();
    for (let y = 14; y < h - 12; y += 2) { ctx.moveTo(13, y); ctx.lineTo(w - 13, y); }
    ctx.stroke();
    // the dial glass
    const G = { x: 28, y: 28, w: w - 56, h: 182 };
    const glass = ctx.createLinearGradient(0, G.y, 0, G.y + G.h); glass.addColorStop(0, '#0d140e'); glass.addColorStop(1, '#070a07');
    ctx.fillStyle = glass; rr(ctx, G.x, G.y, G.w, G.h, 3); ctx.fill();
    ctx.save(); rr(ctx, G.x, G.y, G.w, G.h, 3); ctx.clip();
    const lampGlow = ctx.createRadialGradient(nx, G.y + 120, 4, nx, G.y + 120, 150); lampGlow.addColorStop(0, 'rgba(120,150,90,0.2)'); lampGlow.addColorStop(1, 'rgba(120,150,90,0)');
    ctx.fillStyle = lampGlow; ctx.fillRect(G.x, G.y, G.w, G.h);
    ctx.fillStyle = '#9fb58f'; ctx.font = `500 8px ${SANS}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('F M   M H Z', 46, 46);
    ctx.textAlign = 'right'; ctx.fillText('S T E R E O', G.x + G.w - 16, 46);
    ctx.fillStyle = `rgb(${Math.round(lerp(70, 255, s))},${Math.round(lerp(26, 70, s))},${Math.round(lerp(20, 40, s))})`;
    if (s > 0.2) { ctx.shadowColor = '#ff3a20'; ctx.shadowBlur = 8 * s * this.px; }
    ctx.beginPath(); ctx.arc(G.x + G.w - 74, 46, 2.6, 0, TAU); ctx.fill(); ctx.shadowBlur = 0;
    put(ctx, this.$('.freq'), 44, 58); put(ctx, this.$('.station'), 46, 108);
    // signal strength: five bars
    for (let i = 0; i < 5; i++) { ctx.fillStyle = s * 5 > i + 0.3 ? '#d9f2c4' : 'rgba(217,242,196,0.16)'; ctx.fillRect(G.x + G.w - 50 + i * 7, 76 - i * 3, 4, 6 + i * 3); }
    // FM scale, and an AM scale under it that this control does not use
    ctx.strokeStyle = '#e6f2da'; ctx.fillStyle = '#e6f2da'; ctx.lineWidth = 0.9; ctx.textAlign = 'center'; ctx.font = `500 10px ${SANS}`;
    ctx.beginPath(); ctx.moveTo(X0, 156); ctx.lineTo(X1, 156);
    for (let i = 0; i <= (this.max - this.min) * 2; i++) { const x = lerp(X0, X1, i / ((this.max - this.min) * 2)); ctx.moveTo(x, 156); ctx.lineTo(x, i % 4 === 0 ? 144 : i % 2 === 0 ? 149 : 152); }
    ctx.stroke();
    for (let f = Math.ceil(this.min / 2) * 2; f <= this.max; f += 2) ctx.fillText(String(f), this.fx(f), 134);
    ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(X0, 172); ctx.lineTo(X1, 172);
    [54, 60, 70, 80, 100, 120, 140, 160].forEach((am, i) => { const x = lerp(X0, X1, Math.log(am / 54) / Math.log(160 / 54)); ctx.moveTo(x, 172); ctx.lineTo(x, 179); ctx.fillText(String(am), x, 190); });
    ctx.stroke(); ctx.globalAlpha = 1;
    // the stations, as small marks on the scale
    for (const st of this.stations) { ctx.fillStyle = 'rgba(255,190,120,0.8)'; ctx.fillRect(this.fx(st.f) - 0.6, 158, 1.2, 4); }
    // the needle, lit
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const ng = ctx.createLinearGradient(nx - 7, 0, nx + 7, 0); ng.addColorStop(0, 'rgba(255,60,30,0)'); ng.addColorStop(0.5, 'rgba(255,60,30,0.4)'); ng.addColorStop(1, 'rgba(255,60,30,0)');
    ctx.fillStyle = ng; ctx.fillRect(nx - 7, 118, 14, G.y + G.h - 118); ctx.restore();
    ctx.fillStyle = '#ff5a3c'; ctx.fillRect(nx - 0.9, 116, 1.8, G.y + G.h - 116);
    // a reflection across the glass
    const refl = ctx.createLinearGradient(G.x, G.y, G.x + 180, G.y + 150); refl.addColorStop(0, 'rgba(255,255,255,0.07)'); refl.addColorStop(0.5, 'rgba(255,255,255,0.02)'); refl.addColorStop(0.51, 'rgba(255,255,255,0)');
    ctx.fillStyle = refl; ctx.fillRect(G.x, G.y, G.w, G.h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; rr(ctx, G.x, G.y, G.w, G.h, 3); ctx.stroke();
    // the slide
    ctx.fillStyle = '#0a0a0a'; rr(ctx, X0 - 6, KY - 2.5, X1 - X0 + 12, 5, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(40,25,5,0.35)'; rr(ctx, kx - 15, KY - 20, 34, 50, 4); ctx.fill();
    const held = this.held();
    const km = ctx.createLinearGradient(kx - 16, 0, kx + 16, 0); km.addColorStop(0, '#9a988f'); km.addColorStop(0.2, '#f1efe6'); km.addColorStop(0.8, '#d6d3c8'); km.addColorStop(1, '#8a877e');
    ctx.fillStyle = km; rr(ctx, kx - 16, KY - 24, 32, 48, 4); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.6; ctx.beginPath();
    for (let x = -12; x <= 12; x += 2.4) { ctx.moveTo(kx + x, KY - 14); ctx.lineTo(kx + x, KY + 21); }
    ctx.stroke();
    ctx.strokeStyle = held ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.8; rr(ctx, kx - 16, KY - 24, 32, 48, 4); ctx.stroke();
    ctx.fillStyle = '#e8402a'; ctx.fillRect(kx - 1, KY - 22, 2, 9);
    ctx.fillStyle = '#5b4d32'; ctx.font = `600 7.5px ${SANS}`; ctx.textAlign = 'center'; ctx.fillText('T U N I N G', w / 2, h - 24);
    if (this.range.matches(':focus-visible')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 2; rr(ctx, kx - 20, KY - 28, 40, 56, 6); ctx.stroke(); }
    hit(ctx, this.range, kx - 28, KY - 32, 56, 64);
    return live;
  }
}
customElements.define('tuner-slider', TunerSlider);
// #endregion tuner-slider
