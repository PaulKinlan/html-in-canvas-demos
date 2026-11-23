// ui-feed/gauges.js: five controls with a scale to read, rebuilt from demos on ui-feed.dev.
//
//   <fader-bank name>            one <input type="range"> for each <option>, drawn as the faders of a mixing desk
//   <tuner-slider name value>    a range drawn as the tuning slide of a hi-fi tuner, with stations as <option>s
//   <barbell-number name value>  an <input type="number"> shown as the plates loaded on one end of a bar
//   <curtain-drop name value>    an <input type="number"> shown as a pair of curtains of that length
//   <objective-turret name>      four radios, the objectives of a microscope, and the view through the chosen one
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /gauge-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, TAU, reduced } from './kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const HAND = "'Bradley Hand', 'Segoe Print', 'Chalkboard SE', 'Comic Sans MS', cursive";
const SERIF = "'Didot', 'Bodoni MT', 'Playfair Display', 'Times New Roman', serif";
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";
const MINUS = '−';

// A pointer position in the control's design units.
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };

// #region grip
// A native range sits under a drawn handle. The handle moves on a path the range knows nothing about, so the
// control captures the pointer and works out the position itself. While the handle is held the range's own
// `input` events are ignored (a range under a finger keeps answering the drag). The keyboard still moves it.
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
// #endregion grip

// #region fader-bank
// One range for each <option>. A fader's travel is not linear in decibels: the scale is spread out round
// 0 dB and squeezed toward silence, so the range holds the position of the cap (0 to 1000) and the control
// converts it to decibels through the marks printed beside the slot.
const MARKS = [[10, 0], [5, 0.11], [0, 0.21], [-5, 0.31], [-10, 0.41], [-20, 0.54], [-30, 0.67], [-40, 0.8], [-60, 0.92], [-90, 1]];
export const faderDb = (t) => {
  if (t >= 0.995) return -Infinity;
  for (let i = 1; i < MARKS.length; i++) if (t <= MARKS[i][1]) return lerp(MARKS[i - 1][0], MARKS[i][0], (t - MARKS[i - 1][1]) / (MARKS[i][1] - MARKS[i - 1][1]));
  return -Infinity;
};
export const faderAt = (db) => {
  if (!(db > -90)) return 1;
  if (db >= 10) return 0;
  for (let i = 1; i < MARKS.length; i++) if (db >= MARKS[i][0]) return lerp(MARKS[i - 1][1], MARKS[i][1], (MARKS[i - 1][0] - db) / (MARKS[i - 1][0] - MARKS[i][0]));
  return 1;
};
const dbText = (db) => (db === -Infinity ? `${MINUS}∞` : `${db < -0.04 ? MINUS : db > 0.04 ? '+' : ''}${Math.abs(db).toFixed(1)}`);

export class FaderBank extends FeedControl {
  static size = [360, 384];
  static css = `
    input { width: 60px; height: 44px; opacity: 0; margin: 0; touch-action: none; }
    label { box-sizing: border-box; width: 78px; height: 24px; padding: 0 6px; background: linear-gradient(#efe3bd, #e3d4a4); color: #1c2a6b;
      font: italic 600 15px/24px ${HAND}; text-align: center; white-space: nowrap; overflow: hidden; }
    output { box-sizing: border-box; width: 72px; height: 26px; background: #120505; border: 1px solid #000; border-radius: 2px; color: #ff3a2c;
      font: 600 16px/24px ui-monospace, 'SF Mono', Menlo, Consolas, monospace; letter-spacing: 0.12em; text-align: center; text-shadow: 0 0 6px #ff2a1c; }`;
  static TOP = 112; static BOT = 352;

  ready() {
    this.canvas.setAttribute('role', 'group');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
  }
  build() {
    for (const el of this.$$('input, label, output')) el.remove();
    const make = (tag, props) => { const el = Object.assign(document.createElement(tag), props); el.setAttribute('drawable', ''); this.canvas.append(el); return el; };
    this.channels = options(this).map((o, i) => {
      const ch = { name: o.label, key: o.data.name ?? o.label.toLowerCase().replace(/\W+/g, '-'), t: faderAt(Number(o.value)) };
      ch.label = make('label', { htmlFor: `f${i}`, textContent: o.label });
      ch.out = make('output', { htmlFor: `f${i}` });
      ch.range = make('input', { type: 'range', id: `f${i}`, min: 0, max: 1000, step: 10, ariaLabel: `${o.label} level` });
      let off = 0;
      ch.held = grip(ch.range, {
        down: (e) => { off = point(this, e).y - this.capY(ch); this.sync(); },
        move: (e) => {
          const { TOP, BOT } = FaderBank;
          let t = clamp((point(this, e).y - off - TOP) / (BOT - TOP));
          if (Math.abs(t - MARKS[2][1]) < 0.012) t = MARKS[2][1];       // the detent at 0 dB
          ch.t = t; this.sync(true);
        },
        up: () => { this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); },
      });
      ch.range.addEventListener('input', () => { if (!ch.held()) { ch.t = 1 - ch.range.valueAsNumber / 1000; this.sync(true); } });
      ch.range.addEventListener('dblclick', () => { ch.t = MARKS[2][1]; this.sync(true); });
      return ch;
    });
    this.sync();
  }
  capY(ch) { return lerp(FaderBank.TOP, FaderBank.BOT, ch.t); }
  // The level of one channel in decibels, by its name or its place.
  level(which) { const ch = typeof which === 'number' ? this.channels[which] : this.channels.find((c) => c.key === which || c.name === which); return ch ? faderDb(ch.t) : undefined; }
  get value() { return this.channels.map((ch) => `${ch.key}=${Number.isFinite(faderDb(ch.t)) ? faderDb(ch.t).toFixed(1) : '-inf'}`).join(' '); }
  sync(input = false) {
    const data = new FormData(), base = this.getAttribute('name');
    for (const ch of this.channels) {
      const db = faderDb(ch.t), text = dbText(db);
      if (!ch.held()) ch.range.value = Math.round((1 - ch.t) * 1000);
      ch.range.setAttribute('aria-valuetext', `${text} dB`);
      if (ch.out.textContent !== text) ch.out.textContent = text;
      if (base) data.append(`${base}-${ch.key}`, Number.isFinite(db) ? db.toFixed(1) : '-inf');
    }
    this.setValue(base ? data : null);
    if (input) this.dispatchEvent(new Event('input', { bubbles: true }));
    this.request();
  }

  draw(ctx, w, h) {
    const { TOP, BOT } = FaderBank, n = this.channels.length || 1, sw = w / n;
    ctx.fillStyle = '#0d0d0e'; ctx.fillRect(0, 0, w, h);
    this.channels.forEach((ch, i) => {
      const x0 = i * sw + 3, cx = i * sw + sw / 2 + 8, y = this.capY(ch);
      // the strip: brushed dark metal
      const g = ctx.createLinearGradient(x0, 0, x0 + sw - 6, 0); g.addColorStop(0, '#2b2c2f'); g.addColorStop(0.5, '#232427'); g.addColorStop(1, '#1b1c1e');
      ctx.fillStyle = g; rr(ctx, x0, 4, sw - 6, h - 8, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 0.5; ctx.beginPath();
      for (let x = x0 + 2; x < x0 + sw - 8; x += 2.5) { ctx.moveTo(x, 6); ctx.lineTo(x, h - 6); }
      ctx.stroke();
      // tape, readout
      ctx.save(); ctx.translate(i * sw + sw / 2, 30); ctx.rotate((rnd(i + 3) - 0.5) * 0.09);
      ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-38, -10, 78, 24); put(ctx, ch.label, -39, -12); ctx.restore();
      put(ctx, ch.out, i * sw + sw / 2 - 36, 54);
      // scale
      ctx.fillStyle = '#c9c9c4'; ctx.strokeStyle = '#77787a'; ctx.lineWidth = 0.8; ctx.font = `500 9.5px ${SANS}`; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      MARKS.forEach(([db, t]) => {
        const ty = lerp(TOP, BOT, t);
        ctx.fillText(db === -90 ? `${MINUS}∞` : db > 0 ? `+${db}` : db < 0 ? `${MINUS}${-db}` : '0', cx - 34, ty);
        ctx.beginPath(); ctx.moveTo(cx - 30, ty); ctx.lineTo(cx - (db === 0 ? 10 : 18), ty); ctx.stroke();
      });
      // slot
      ctx.fillStyle = '#050505'; rr(ctx, cx - 3, TOP - 20, 6, BOT - TOP + 40, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 0.6; rr(ctx, cx - 3, TOP - 20, 6, BOT - TOP + 40, 3); ctx.stroke();
      // cap: a block of metal with a groove, lit from above, pressed a little when held
      const held = ch.held(), cw = 40, chh = 28;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; rr(ctx, cx - cw / 2 + 2, y - chh / 2 + (held ? 3 : 6), cw, chh, 3); ctx.fill();
      const m = ctx.createLinearGradient(0, y - chh / 2, 0, y + chh / 2);
      for (const [at, c] of [[0, '#f4f4f2'], [0.18, '#c9cac8'], [0.44, '#e9e9e7'], [0.47, '#55575a'], [0.53, '#2c2d2f'], [0.56, '#d8d8d6'], [0.85, '#a9aaa8'], [1, '#6f7072']]) m.addColorStop(at, c);
      ctx.fillStyle = m; rr(ctx, cx - cw / 2, y - chh / 2, cw, chh, 3); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 0.6; rr(ctx, cx - cw / 2, y - chh / 2, cw, chh, 3); ctx.stroke();
      if (ch.range.matches(':focus-visible')) { ctx.strokeStyle = '#7fb4ff'; ctx.lineWidth = 2; rr(ctx, cx - cw / 2 - 4, y - chh / 2 - 4, cw + 8, chh + 8, 5); ctx.stroke(); }
      hit(ctx, ch.range, cx - 30, y - 22, 60, 44);
    });
    return false;
  }
}
customElements.define('fader-bank', FaderBank);
// #endregion fader-bank

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

// #region number-control
// The two number fields below share this: a field that can be typed in, a button either side, and a value
// kept to the step between min and max.
class NumberControl extends FeedControl {
  static observedAttributes = ['value'];
  ready() {
    this.field = this.$('.value');
    const num = (name, d) => Number(this.getAttribute(name) ?? d), D = this.constructor.defaults;
    this.min = num('min', D.min); this.max = num('max', D.max); this.step = num('step', D.step);
    Object.assign(this.field, { min: this.min, max: this.max, step: this.step });
    this.v = this.fit(num('value', D.value));
    this.field.addEventListener('input', () => { if (Number.isFinite(this.field.valueAsNumber)) this.set(this.field.valueAsNumber, false, true); });
    this.field.addEventListener('change', () => this.set(this.v, true));
    this.$('.dec').addEventListener('click', () => this.set(this.v - this.step, true));
    this.$('.inc').addEventListener('click', () => this.set(this.v + this.step, true));
    this.setup?.();
    this.set(this.v, false);
  }
  fit(v) { return clamp(Math.round((Number(v) || 0) / this.step) * this.step, this.min, this.max); }
  attributeChangedCallback(_, __, v) { if (this.field && v !== null) this.value = v; }
  get value() { return String(this.v); }
  set value(v) { this.set(v, false); }
  set(v, done, typing = false) {
    v = this.fit(v);
    const changed = v !== this.v;
    this.v = v;
    this.setValue(String(v));
    if (!typing) this.field.value = v;
    this.$('.dec').disabled = v <= this.min; this.$('.inc').disabled = v >= this.max;
    this.changed?.();
    if (changed) this.dispatchEvent(new Event('input', { bubbles: true }));
    if (done) this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }
}
// #endregion number-control

// #region barbell-number
// The number is the weight on the bar. The control works out the plates for one end, heaviest first, and
// slides each one on. A plate that is no longer needed slides off. The bar dips when a plate lands.
const PLATES = [[45, 22, 150], [35, 20, 130], [25, 18, 108], [10, 12, 80], [5, 10, 58], [2.5, 8, 46]];   // pounds, thickness, height
export function platesFor(total, bar = 45) {
  let side = Math.max(0, (total - bar) / 2); const out = [];
  for (const [lb] of PLATES) while (side >= lb - 1e-9) { out.push(lb); side -= lb; }
  return out;
}
let hatchTile = null;
const hatch = (ctx) => {
  if (!hatchTile) {
    hatchTile = document.createElement('canvas'); hatchTile.width = hatchTile.height = 24;
    const g = hatchTile.getContext('2d'); g.strokeStyle = '#161616'; g.lineWidth = 1.1;
    for (let i = -24; i < 48; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 24, 24); g.moveTo(i + 24, 0); g.lineTo(i, 24); g.stroke(); }
  }
  const p = ctx.createPattern(hatchTile, 'repeat'); p.setTransform(new DOMMatrix().scale(0.25));
  return p;
};
// A line drawn twice, a little apart, the way a pen goes over a pencil line.
const sketch = (ctx, path, seed = 0) => {
  for (let i = 0; i < 2; i++) { ctx.save(); ctx.translate((rnd(seed + i) - 0.5) * 1.1, (rnd(seed + i + 9) - 0.5) * 1.1); ctx.rotate((rnd(seed + i + 4) - 0.5) * 0.008); path(); ctx.stroke(); ctx.restore(); }
};

export class BarbellNumber extends NumberControl {
  static size = [360, 372];
  static defaults = { min: 45, max: 585, step: 5, value: 135 };
  static html = `<span class="title"><slot>Lift</slot></span><output class="side"></output>
    <input type="number" class="value" inputmode="numeric" aria-label="Weight on the bar, in pounds"><button type="button" class="dec" aria-label="Less"></button><button type="button" class="inc" aria-label="More"></button>`;
  static css = `
    .title { width: 300px; font: 600 21px/1.2 ${HAND}; color: #111; letter-spacing: 0.03em; }
    .side { width: 84px; font: 500 15px/1.25 ${HAND}; color: #111; text-align: right; }
    .side b { display: block; font-weight: 500; font-size: 13px; margin-bottom: 4px; } .side i { display: block; font-style: normal; padding-right: 18px; }
    .side u { display: block; text-decoration: none; border-top: 1.5px solid #111; margin-top: 3px; padding: 2px 18px 0 0; } .side small { display: block; font-size: 12.5px; margin-top: 4px; white-space: nowrap; }
    .value { width: 190px; height: 96px; opacity: 0; font-size: 40px; text-align: center; touch-action: manipulation; }
    .dec, .inc { width: 52px; height: 52px; opacity: 0; border-radius: 50%; touch-action: manipulation; }`;
  static BAR = 132;

  setup() { this.bar = Number(this.getAttribute('bar') ?? 45); this.on = []; this.off = []; this.sag = { x: 0, v: 0 }; }
  changed() {
    const want = platesFor(this.v, this.bar);
    let same = 0;
    while (same < want.length && same < this.on.length && this.on[same].lb === want[same]) same++;
    for (const p of this.on.splice(same)) { p.leaving = true; this.off.push(p); }
    for (const lb of want.slice(same)) this.on.push({ lb, s: { x: reduced() ? 1 : 0, v: 0 }, seated: false });
    const side = want.reduce((a, b) => a + b, 0);
    this.$('.side').innerHTML = `<b>each side</b>${want.map((lb) => `<i>${lb}</i>`).join('') || '<i>none</i>'}<u>${side}</u><small>× 2, + ${this.bar} bar</small>`;
  }

  draw(ctx, w, h) {
    const Y = BarbellNumber.BAR;
    let live = false;
    // dotted paper
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(40,50,80,0.28)';
    for (let y = 10; y < h; y += 14) for (let x = 10; x < w; x += 14) ctx.fillRect(x, y, 1, 1);
    put(ctx, this.$('.title'), 18, 14);
    // the load, and the dip of the bar under it
    const load = this.on.reduce((a, p) => a + p.lb * clamp(p.s.x), 0);
    live = spring(this.sag, load * 0.016, this.dt, 240, 9) || live;
    ctx.save(); ctx.translate(0, Y); ctx.rotate(Math.atan2(this.sag.x, 250)); ctx.translate(0, -Y);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    const ink = hatch(ctx);
    // shaft with knurling, collar, sleeve
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(-4, Y - 3.5, 80, 7); sketch(ctx, () => { ctx.beginPath(); ctx.rect(-4, Y - 3.5, 80, 7); }, 1);
    ctx.fillStyle = ink; ctx.fillRect(12, Y - 3.5, 46, 7);
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(84, Y - 7, 166, 14); sketch(ctx, () => { ctx.beginPath(); rr(ctx, 84, Y - 7, 166, 14, 3); }, 2);
    ctx.fillRect(74, Y - 15, 8, 30); sketch(ctx, () => { rr(ctx, 74, Y - 15, 8, 30, 2); }, 3);
    // plates: the ones sliding off first, then the ones on the sleeve from the collar outward
    const plate = (p, x, seed) => {
      const [, t, ph] = PLATES.find(([lb]) => lb === p.lb);
      ctx.fillStyle = '#fbfaf7'; rr(ctx, x, Y - ph / 2, t, ph, 4); ctx.fill();
      ctx.fillStyle = ink; rr(ctx, x, Y - ph / 2, t, ph, 4); ctx.fill();
      sketch(ctx, () => rr(ctx, x, Y - ph / 2, t, ph, 4), seed);
      return t + 1.5;
    };
    this.off = this.off.filter((p) => {
      const moving = spring(p.s, -0.6, this.dt, 60, 13);
      if (p.s.x < -0.45 || !moving) return false;
      live = true;
      ctx.save(); ctx.globalAlpha = clamp(p.s.x * 2.5 + 1.1); plate(p, lerp(262, p.at ?? 90, clamp(p.s.x)), p.lb * 3); ctx.restore();
      return true;
    });
    let x = 84;
    this.on.forEach((p, i) => {
      if (spring(p.s, 1, this.dt, 110, 15)) live = true;
      if (!p.seated && p.s.x > 0.97) { p.seated = true; this.sag.v += p.lb * 0.3; live = true; }     // the plate lands
      p.at = x;
      ctx.save(); ctx.globalAlpha = clamp(p.s.x * 4);
      x += plate(p, lerp(262, x, clamp(p.s.x, 0, 1.02)), i * 7 + p.lb);
      ctx.restore();
    });
    // the spring collar outside the last plate
    const cx = Math.max(x + 1, 88);
    ctx.fillStyle = '#fbfaf7'; ctx.fillRect(cx, Y - 11, 6, 22); sketch(ctx, () => { rr(ctx, cx, Y - 11, 6, 22, 2); }, 5);
    sketch(ctx, () => { ctx.beginPath(); ctx.moveTo(cx + 3, Y - 11); ctx.lineTo(cx + 8, Y - 22); }, 6);
    ctx.restore();
    put(ctx, this.$('.side'), 268, 56);
    // the number: heavy figures filled with pen hatching
    const text = this.field.matches(':focus') && this.field.value !== '' ? this.field.value : String(this.v);
    ctx.font = `900 82px 'Arial Black', 'Helvetica Neue', Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fbfaf7'; ctx.fillText(text, 172, 330);
    ctx.fillStyle = hatch(ctx); ctx.fillText(text, 172, 330);
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2.2; ctx.lineJoin = 'round';
    sketch(ctx, () => { ctx.strokeText(text, 172, 330); ctx.beginPath(); }, 11);
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = '#111'; ctx.font = `600 22px ${HAND}`; ctx.textAlign = 'left'; ctx.fillText('lb', 172 + tw / 2 + 8, 330);
    if (this.field.matches(':focus')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); rr(ctx, 172 - tw / 2 - 8, 256, tw + 16, 84, 6); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.field, 77, 250, 190, 96);
    // minus and plus, drawn by hand
    for (const [el, bx, sign] of [[this.$('.dec'), 36, -1], [this.$('.inc'), 324, 1]]) {
      ctx.globalAlpha = el.disabled ? 0.3 : 1; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6;
      sketch(ctx, () => { ctx.beginPath(); ctx.arc(bx, 300, 17, 0.2, TAU + 0.5); }, 20 + sign);
      ctx.beginPath(); ctx.moveTo(bx - 8, 300); ctx.lineTo(bx + 8, 300.6); if (sign > 0) { ctx.moveTo(bx + 0.4, 292); ctx.lineTo(bx, 308); } ctx.stroke();
      ctx.globalAlpha = 1;
      if (el.matches(':focus-visible')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, 300, 23, 0, TAU); ctx.stroke(); }
      hit(ctx, el, bx - 26, 274, 52, 52);
    }
    return live;
  }
}
customElements.define('barbell-number', BarbellNumber);
// #endregion barbell-number

// #region curtain-drop
// The number is the drop of a pair of curtains in inches, from the pole to the hem. The floor is 97 inches
// under the pole, so the note says how far the hem is from it, and past 97 the cloth lies on the floor. The
// hem is on a spring: the curtains overshoot a new length and their folds sway until they hang still.
export class CurtainDrop extends NumberControl {
  static size = [360, 384];
  static defaults = { min: 48, max: 106, step: 1, value: 96 };
  static html = `<input type="number" class="value" inputmode="numeric" aria-label="Drop, in inches"><button type="button" class="dec" aria-label="One inch shorter"></button><button type="button" class="inc" aria-label="One inch longer"></button>
    <output class="note"></output><span class="cloth"><slot>Linen</slot></span><output class="detail"></output><output class="price"></output>`;
  static css = `
    .value { width: 120px; height: 84px; opacity: 0; font-size: 40px; touch-action: manipulation; }
    .dec, .inc { width: 44px; height: 44px; opacity: 0; border-radius: 50%; touch-action: manipulation; }
    .note { width: 118px; font: italic 400 12.5px/1.2 ${SERIF}; color: #222; text-align: right; white-space: nowrap; }
    .cloth { width: 220px; font: 400 9px/1.2 ${SERIF}; letter-spacing: 0.24em; text-transform: uppercase; color: #333; white-space: nowrap; }
    .detail { width: 232px; font: 400 12px/1.2 ${SERIF}; color: #222; white-space: nowrap; }
    .price { width: 110px; font: 400 21px/1 ${SERIF}; color: #111; text-align: right; font-variant-numeric: lining-nums; }`;
  static POLE = 62; static FLOOR = 328; static FLOOR_IN = 97;

  setup() {
    this.pole = Number(this.getAttribute('pole') ?? 72); this.rate = Number(this.getAttribute('price') ?? 68);
    this.len = { x: Number(this.getAttribute('value') ?? 96), v: 0 }; this.sway = { x: 0, v: 0 };
  }
  // Three widths of cloth, each the drop and ten inches for the hems.
  get yards() { return Math.round(((3 * (this.v + 10)) / 36) * 100) / 100; }
  get cost() { return (this.yards * this.rate).toFixed(2); }
  changed() {
    const gap = CurtainDrop.FLOOR_IN - this.v;
    this.$('.note').textContent = gap > 0 ? `${gap} in above the floor` : gap < 0 ? `${-gap} in on the floor` : 'to the floor';
    this.$('.detail').textContent = `Pair for a ${this.pole} in pole, ${this.yards.toFixed(2)} yd at $${this.rate} a yard`;
    this.$('.price').textContent = `$${this.cost}`;
  }

  draw(ctx, w, h) {
    const { POLE, FLOOR, FLOOR_IN } = CurtainDrop, S = (FLOOR - POLE) / FLOOR_IN;
    const was = this.len.v;
    let live = spring(this.len, this.v, this.dt, 46, 7.5);
    this.sway.v += (this.len.v - was) * 0.3;                       // a change of speed sets the folds swinging
    live = spring(this.sway, 0, this.dt, 34, 4.6) || live;
    ctx.fillStyle = '#f3f1ec'; ctx.fillRect(0, 0, w, h);
    // the number and its buttons
    ctx.fillStyle = '#333'; ctx.font = `400 8.5px ${SERIF}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('D R O P', 24, 30); ctx.textAlign = 'right'; ctx.fillText('I N', 138, 30);
    const text = this.field.matches(':focus') && this.field.value !== '' ? this.field.value : String(this.v);
    ctx.fillStyle = '#111'; ctx.font = `400 74px ${SERIF}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText(text, 26, 112);
    ctx.strokeStyle = this.field.matches(':focus') ? '#111' : '#b9b5ac'; ctx.lineWidth = this.field.matches(':focus') ? 1.4 : 0.8; ctx.beginPath(); ctx.moveTo(24, 126); ctx.lineTo(140, 126); ctx.stroke();
    hit(ctx, this.field, 22, 40, 120, 84);
    for (const [el, bx, sign] of [[this.$('.dec'), 40, -1], [this.$('.inc'), 78, 1]]) {
      ctx.globalAlpha = el.disabled ? 0.3 : 1; ctx.strokeStyle = '#555'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(bx, 156, 14, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#111'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx - 5, 156); ctx.lineTo(bx + 5, 156); if (sign > 0) { ctx.moveTo(bx, 151); ctx.lineTo(bx, 161); } ctx.stroke();
      ctx.globalAlpha = 1;
      if (el.matches(':focus-visible')) { ctx.strokeStyle = '#1456d8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bx, 156, 18, 0, TAU); ctx.stroke(); }
      hit(ctx, el, bx - 22, 134, 44, 44);
    }
    ctx.fillStyle = '#444'; ctx.font = `400 8.5px ${SERIF}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(`${this.min}  –  ${this.max}`, 102, 156);
    // window, pole, floor
    ctx.strokeStyle = '#222'; ctx.lineWidth = 0.8;
    ctx.strokeRect(190, POLE + 22, 110, 132); ctx.strokeRect(194, POLE + 26, 49, 124); ctx.strokeRect(247, POLE + 26, 49, 124); ctx.strokeRect(186, POLE + 154, 118, 5);
    ctx.beginPath(); ctx.moveTo(150, POLE); ctx.lineTo(340, POLE); ctx.moveTo(24, FLOOR); ctx.lineTo(340, FLOOR); ctx.stroke();
    ctx.fillStyle = '#f3f1ec'; for (const x of [150, 340]) { ctx.beginPath(); ctx.arc(x, POLE, 2.6, 0, TAU); ctx.fill(); ctx.stroke(); }
    // the curtains: seven folds each, darker in the valleys, with the hem lower at the back of each fold
    const hem = POLE + this.len.x * S;
    for (const [x0, dir] of [[154, 1], [296, -1]]) {
      const W = 44, N = 7, over = Math.max(0, hem - FLOOR);
      if (over > 0) {      // cloth on the floor
        ctx.fillStyle = '#17171b';
        for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.ellipse(x0 + W / 2 + (i - 1.5) * (6 + over * 0.25) * dir, FLOOR - 1 - Math.min(5, over * 0.2) * (i % 2), 14 + over * 0.5, 2.5 + Math.min(6, over * 0.35), 0, 0, TAU); ctx.fill(); }
      }
      for (let i = 0; i < N; i++) {
        const fx = x0 + (i * W) / N, fw = W / N + 0.6, depth = (hem - POLE) / 280;
        const lean = this.sway.x * depth * (0.6 + 0.4 * Math.sin(i * 1.7)) * dir;       // sideways at the hem
        const bottom = Math.min(FLOOR + 1, hem + Math.sin(i * 2.4 + 0.5) * 1.6 + Math.abs(this.sway.x) * 0.25 * Math.sin(i * 1.3));
        const g = ctx.createLinearGradient(fx, 0, fx + fw, 0);
        g.addColorStop(0, '#08080a'); g.addColorStop(0.45, i % 2 ? '#2c2c33' : '#22222a'); g.addColorStop(1, '#0b0b0d');
        ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(fx, POLE + 3); ctx.lineTo(fx + fw, POLE + 3);
        ctx.quadraticCurveTo(fx + fw + lean * 0.3, (POLE + bottom) / 2, fx + fw + lean, bottom); ctx.lineTo(fx + lean, bottom + (i % 2 ? 0.8 : -0.8));
        ctx.quadraticCurveTo(fx + lean * 0.3, (POLE + bottom) / 2, fx, POLE + 3); ctx.fill();
      }
      // the weave: fine lighter threads
      ctx.save(); ctx.globalAlpha = 0.1; ctx.strokeStyle = '#cfcfe0'; ctx.lineWidth = 0.3; ctx.beginPath();
      for (let i = 0; i < 22; i++) { const tx = x0 + rnd(i + x0) * W; ctx.moveTo(tx, POLE + 4); ctx.lineTo(tx + this.sway.x * 0.5 * dir, Math.min(FLOOR, hem) - 2); }
      ctx.stroke(); ctx.restore();
    }
    // the note, with a mark at the height of the hem
    const mark = Math.min(FLOOR, hem);
    ctx.strokeStyle = '#d23b2a'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(142, mark); ctx.lineTo(150, mark); ctx.stroke();
    put(ctx, this.$('.note'), 20, FLOOR - 20);
    put(ctx, this.$('.cloth'), 24, FLOOR + 14); put(ctx, this.$('.detail'), 24, FLOOR + 30); put(ctx, this.$('.price'), 230, FLOOR + 20);
    return live;
  }
}
customElements.define('curtain-drop', CurtainDrop);
// #endregion curtain-drop

// #region objective-turret
// Four radios. Choosing one turns the turret a quarter turn for each step, and the view through the eyepiece
// goes dark while no objective is over the slide, then comes back at the new magnification, out of focus at
// first. The specimen is a drawing made of a few hundred cells with positions in millimetres, so each
// objective shows more of the same thing, not a larger picture of it.
const OBJECTIVES = [
  { x: 4, fov: 4.5, text: 'PLAN 4/0.10 160/−', band: '#e23a2e', bar: [1, '1 mm'], at: [0, 0] },
  { x: 10, fov: 1.8, text: 'PLAN 10/0.25 160/0.17', band: '#f2c230', bar: [0.4, '400 µm'], at: [0, 0] },
  { x: 40, fov: 0.45, text: 'PLAN 40/0.65 160/0.17', band: '#3a9be8', bar: [0.1, '100 µm'], at: [0.03, -0.02] },
  { x: 100, fov: 0.18, text: 'PLAN 100/1.25 OIL 160/0.17', band: '#1a1a1a', bar: [0.04, '40 µm'], at: [0.3, -0.16] },
];
// The specimen: a root in cross-section. Rings of cells round a core with a cross of water vessels.
let CELLS = null;
function cells() {
  if (CELLS) return CELLS;
  CELLS = [];
  let id = 0;
  for (let ring = 0, r = 0.21; r < 0.8; ring++) {
    const size = 0.034 + ring * 0.0035 + (ring > 9 ? -0.012 : 0), n = Math.floor((TAU * r) / (size * 2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + ring * 0.37, j = rnd(id) - 0.5;
      CELLS.push({ x: Math.cos(a) * (r + j * 0.008), y: Math.sin(a) * (r + j * 0.008), r: size * (0.92 + rnd(id + 5) * 0.14), a: a + j, grains: Math.floor(rnd(id + 2) * 9), id, skin: r + size * 2 > 0.8 });
      id++;
    }
    r += size * 1.9;
  }
  // the core: small packed cells, and four arms of large vessels
  for (let i = 0; i < 90; i++) { const a = rnd(i + 500) * TAU, r = 0.03 + Math.sqrt(rnd(i + 600)) * 0.15; CELLS.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 0.011 + rnd(i + 700) * 0.008, a, core: true, id: id++ }); }
  for (let arm = 0; arm < 4; arm++) for (let k = 0; k < 5; k++) { const a = arm * (TAU / 4), r = 0.012 + k * 0.034; CELLS.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 0.021 - k * 0.0028, a, vessel: true, id: id++ }); }
  CELLS.push({ x: 0, y: 0, r: 0.024, a: 0, vessel: true, id: id++ });
  return CELLS;
}

export class ObjectiveTurret extends FeedControl {
  static size = [360, 384];
  static html = OBJECTIVES.map((o, i) => `<input type="radio" name="objective" id="o${i}" value="${o.x}" aria-label="${o.x} times${o.x === 100 ? ', oil immersion' : ''}"><label for="o${i}">${o.x}×${o.x === 100 ? '<small>OIL</small>' : ''}</label>`).join('')
    + `<span class="specimen"><slot>Specimen</slot></span><output class="fov"></output>`;
  static css = `
    input { width: 82px; height: 50px; opacity: 0; margin: 0; touch-action: manipulation; }
    label { width: 82px; height: 44px; font: 700 18px/44px ${SANS}; text-align: center; color: #0c4a3e; letter-spacing: -0.02em; cursor: pointer; white-space: nowrap; }
    label small { font-size: 8px; margin-left: 2px; }
    label.on { color: #fff; }
    .specimen { width: 120px; font: 600 11.5px/1.25 ${SANS}; color: #0c4a3e; }
    .fov { width: 110px; font: 700 20px/1 ${SANS}; color: #0c4a3e; text-align: right; letter-spacing: -0.02em; }`;
  static observedAttributes = ['value'];
  static C = { x: 180, y: 170 }; static R = 122;

  ready() {
    this.radios = this.$$('input'); this.labels = this.$$('label');
    this.canvas.setAttribute('role', 'radiogroup'); this.canvas.ariaLabel = 'Objective';
    const v = Number(this.getAttribute('value') ?? 10);
    (this.radios.find((r) => Number(r.value) === v) ?? this.radios[1]).checked = true;
    const i = this.index;
    this.turn = { x: i, v: 0 }; this.pill = { x: i, v: 0 }; this.shown = i; this.focus = 1;
    this.view = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });      // a plain canvas: the specimen is drawn here, then blurred onto the control
    this.shadowRoot.addEventListener('change', () => { this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.sync();
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null) this.value = v; }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index].value; }
  set value(v) { const r = this.radios.find((x) => Number(x.value) === Number(v)); if (r) { r.checked = true; this.sync(); } }
  sync() {
    this.setValue(this.value);
    this.labels.forEach((l, i) => l.classList.toggle('on', i === this.index));
    this.request();
  }
  // Draw the cells that fall inside the field of view. `size` is the picture's width in pixels.
  specimen(o, size) {
    const c = this.view; if (c.width !== size) c.width = c.height = size;
    const g = c.getContext('2d'), k = size / o.fov;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#f4fbf6'; g.fillRect(0, 0, size, size);
    g.setTransform(k, 0, 0, k, size / 2 - o.at[0] * k, size / 2 - o.at[1] * k);
    g.fillStyle = '#e4f4ea'; g.beginPath(); g.arc(0, 0, 0.81, 0, TAU); g.fill();
    g.fillStyle = '#f7dfe9'; g.beginPath(); g.arc(0, 0, 0.2, 0, TAU); g.fill();
    g.strokeStyle = '#c96a92'; g.lineWidth = Math.max(0.006, 1.2 / k); g.beginPath(); g.arc(0, 0, 0.2, 0, TAU); g.stroke();
    const half = o.fov / 2 + 0.06, wall = clamp(1.1 / k, 0.0012, 0.006);
    for (const cell of cells()) {
      if (Math.abs(cell.x - o.at[0]) > half || Math.abs(cell.y - o.at[1]) > half) continue;
      g.save(); g.translate(cell.x, cell.y); g.rotate(cell.a);
      g.beginPath(); g.ellipse(0, 0, cell.r, cell.r * (cell.vessel ? 1 : 0.86), 0, 0, TAU);
      g.fillStyle = cell.vessel ? '#fff' : cell.core ? '#bfe6dc' : cell.skin ? '#d7efe2' : '#f6fcf8'; g.fill();
      g.strokeStyle = cell.vessel ? '#d61f6b' : cell.core ? '#3f9c8f' : '#69b5a3'; g.lineWidth = cell.vessel ? wall * 3 : wall; g.stroke();
      // starch grains show once a cell is more than a few pixels across
      if (!cell.vessel && !cell.core && cell.r * k > 5) {
        g.fillStyle = '#d4488e';
        for (let i = 0; i < cell.grains; i++) { const a = rnd(cell.id * 9 + i) * TAU, d = Math.sqrt(rnd(cell.id * 5 + i)) * cell.r * 0.62; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d * 0.86, cell.r * 0.085, 0, TAU); g.fill(); }
        if (cell.r * k > 40) { g.strokeStyle = 'rgba(105,181,163,0.5)'; g.lineWidth = wall * 0.6; g.beginPath(); g.ellipse(0, 0, cell.r * 0.93, cell.r * 0.8, 0, 0, TAU); g.stroke(); }
      }
      g.restore();
    }
  }

  draw(ctx, w, h) {
    const { C, R } = ObjectiveTurret, i = this.index;
    // #region turret-step
    let live = spring(this.turn, i, this.dt, 60, 11);
    // light reaches the eyepiece only while an objective is in line: the view darkens between two clicks
    const off = Math.abs(this.turn.x - Math.round(this.turn.x)), light = reduced() ? 1 : clamp(1 - off * 3.2);
    this.light = light;
    const over = clamp(Math.round(this.turn.x), 0, OBJECTIVES.length - 1);
    if (over !== this.shown && off < 0.3) { this.shown = over; this.focus = reduced() ? 1 : 0; this.drawn = null; }
    if (this.shown === i && this.focus < 1) { this.focus = clamp(this.focus + this.dt / 0.7); live = true; }   // the fine focus comes in
    // #endregion turret-step
    live = spring(this.pill, i, this.dt, 300, 26) || live;
    const o = OBJECTIVES[this.shown], size = Math.round(R * 2 * this.px);
    if (this.drawn !== `${this.shown}:${size}`) { this.specimen(o, size); this.drawn = `${this.shown}:${size}`; }
    const fov = this.$('.fov'), fovText = o.fov >= 1 ? `${o.fov} mm` : `${Math.round(o.fov * 1000)} µm`;
    if (fov.textContent !== fovText) fov.textContent = fovText;

    ctx.fillStyle = '#b8f0dc'; ctx.fillRect(0, 0, w, h);
    // the turret ring, engraved, turning a quarter turn for each objective
    ctx.fillStyle = 'rgba(12,74,62,0.18)'; ctx.beginPath(); ctx.arc(C.x, C.y + 4, R + 22, 0, TAU); ctx.fill();
    const ringG = ctx.createLinearGradient(0, C.y - R - 20, 0, C.y + R + 20); ringG.addColorStop(0, '#ffffff'); ringG.addColorStop(1, '#e3ece8');
    ctx.fillStyle = ringG; ctx.beginPath(); ctx.arc(C.x, C.y, R + 20, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(-this.turn.x * (TAU / 4));
    ctx.strokeStyle = 'rgba(12,74,62,0.25)'; ctx.lineWidth = 0.5; ctx.beginPath();
    for (let k = 0; k < 120; k++) { const a = (k / 120) * TAU; ctx.moveTo(Math.cos(a) * (R + 17), Math.sin(a) * (R + 17)); ctx.lineTo(Math.cos(a) * (R + 20), Math.sin(a) * (R + 20)); }
    ctx.stroke();
    OBJECTIVES.forEach((ob, k) => {
      ctx.save(); ctx.rotate(k * (TAU / 4));
      ctx.strokeStyle = ob.band; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, R + 17, -Math.PI / 2 - 0.36, -Math.PI / 2 + 0.36); ctx.stroke();
      ctx.fillStyle = '#31504a'; ctx.font = `600 7.5px ui-monospace, Menlo, Consolas, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      [...ob.text].forEach((ch, n) => { ctx.save(); ctx.rotate((n - (ob.text.length - 1) / 2) * 0.037); ctx.fillText(ch, 0, -(R + 9)); ctx.restore(); });
      ctx.restore();
    });
    ctx.restore();
    // the view
    ctx.save(); ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.clip();
    const blur = (1 - smooth(this.focus)) * 7 + off * 10;
    if (blur > 0.15) ctx.filter = `blur(${(blur * this.px).toFixed(2)}px)`;
    ctx.drawImage(this.view, C.x - R, C.y - R, R * 2, R * 2);
    ctx.filter = 'none';
    const vig = ctx.createRadialGradient(C.x, C.y, R * 0.55, C.x, C.y, R); vig.addColorStop(0, 'rgba(0,20,15,0)'); vig.addColorStop(1, 'rgba(0,20,15,0.3)');
    ctx.fillStyle = vig; ctx.fillRect(C.x - R, C.y - R, R * 2, R * 2);
    if (light < 1) { ctx.fillStyle = `rgba(4,16,13,${1 - light})`; ctx.fillRect(C.x - R, C.y - R, R * 2, R * 2); }
    ctx.restore();
    ctx.strokeStyle = '#0c4a3e'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.stroke();
    // the scale bar, for the objective that is in line
    const bw = (o.bar[0] / o.fov) * R * 2;
    ctx.globalAlpha = light * smooth(this.focus * 2);
    ctx.fillStyle = '#fff'; rr(ctx, C.x - Math.max(bw, 44) / 2 - 10, C.y + R - 50, Math.max(bw, 44) + 20, 30, 8); ctx.fill();
    ctx.fillStyle = '#0c4a3e'; ctx.font = `700 9.5px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.bar[1], C.x, C.y + R - 40);
    ctx.strokeStyle = '#0c4a3e'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(C.x - bw / 2, C.y + R - 28); ctx.lineTo(C.x + bw / 2, C.y + R - 28);
    ctx.moveTo(C.x - bw / 2, C.y + R - 31); ctx.lineTo(C.x - bw / 2, C.y + R - 25); ctx.moveTo(C.x + bw / 2, C.y + R - 31); ctx.lineTo(C.x + bw / 2, C.y + R - 25); ctx.stroke();
    ctx.globalAlpha = 1;
    // captions
    ctx.fillStyle = '#31504a'; ctx.font = `600 7.5px ${SANS}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('S P E C I M E N', 12, 14); ctx.textAlign = 'right'; ctx.fillText('F I E L D   O F   V I E W', w - 12, 14);
    put(ctx, this.$('.specimen'), 12, 22); put(ctx, fov, w - 122, 24);
    // the four radios, as one bar with a pill that slides to the checked one
    const BX = 14, BW = 83, BY = 326;
    ctx.fillStyle = '#fff'; rr(ctx, BX - 4, BY - 4, BW * 4 + 8, 52, 26); ctx.fill();
    ctx.fillStyle = '#c4107a'; rr(ctx, BX + this.pill.x * BW + 2, BY, BW - 4, 44, 22); ctx.fill();
    this.labels.forEach((l, k) => put(ctx, l, BX + k * BW + 0.5, BY));
    this.radios.forEach((r, k) => {
      if (r.matches(':focus-visible')) { ctx.strokeStyle = '#0c4a3e'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); rr(ctx, BX + k * BW, BY - 2, BW, 48, 24); ctx.stroke(); ctx.setLineDash([]); }
      hit(ctx, r, BX + k * BW, BY - 3, BW, 50);
    });
    return live;
  }
}
customElements.define('objective-turret', ObjectiveTurret);
// #endregion objective-turret
