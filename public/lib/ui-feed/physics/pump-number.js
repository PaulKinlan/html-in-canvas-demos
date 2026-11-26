// <pump-number>: an <input type="number"> filled by a hand pump modelled with Boyle's law.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, clamp, rr, spring, TAU, reduced } from '../kit.js';

// Paper grain: a tile of random specks, made once on a plain canvas and laid over a flat fill as a pattern.
let grainTile = null;
function grain(ctx, w, h, alpha = 0.06) {
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 96;
    const g = grainTile.getContext('2d'), d = g.createImageData(96, 96);
    let s = 7;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = (s >> 8) & 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v > 127 ? 255 : 0; d.data[i + 3] = Math.abs(v - 127);
    }
    g.putImageData(d, 0, 0);
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, w, h); ctx.restore();
}
// A deterministic random number from an integer, for things that must not change between frames.
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// #region pump-number
// The value is the pressure in a tyre. The pump is a cylinder of air with a piston: pushing the handle down
// shrinks the volume, the pressure in the cylinder rises (Boyle's law), and when it passes the pressure in
// the tyre the check valve lifts and the two share their air. Pulling up drops the cylinder below one
// atmosphere and it refills from outside. So a stroke adds less the fuller the tyre is, and the first part
// of every stroke moves no air at all.
export class PumpNumber extends FeedControl {
  static size = [360, 392];
  static html = `<input type="number" class="value" inputmode="decimal"><button type="button" class="dec" aria-label="Decrease">&minus;</button><button type="button" class="inc" aria-label="Increase">+</button><input type="range" class="handle" min="0" max="100" step="25" value="0" aria-label="Pump handle, pushed down"><button type="button" class="bleed" aria-label="Release air"></button>`;
  static css = `
    .value { width: 62px; height: 34px; border: 4px double #1d1d1b; border-radius: 0; background: transparent; color: #1d1d1b;
      font: 700 21px/1 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif; text-align: center;
      appearance: textfield; outline: 0; padding: 0; }
    .value::-webkit-inner-spin-button { display: none; }
    .value:focus-visible { background: #fff6; }
    .dec, .inc { width: 20px; height: 20px; border: 1.2px solid #1d1d1b; border-radius: 0; background: transparent; color: #1d1d1b;
      font: 400 15px/1 ui-sans-serif, sans-serif; padding: 0 0 2px; touch-action: manipulation; }
    .dec:active, .inc:active { background: #1d1d1b; color: #cfd5c6; }
    .dec:focus-visible, .inc:focus-visible { outline: 2px solid #c9742a; outline-offset: 2px; }
    .handle { width: 76px; height: 56px; opacity: 0; touch-action: none; }
    .bleed { width: 48px; height: 78px; opacity: 0; touch-action: none; user-select: none; -webkit-touch-callout: none; }`;
  static observedAttributes = ['value'];
  static V0 = 1;               // the swept volume of the cylinder
  static VD = 0.07;            // what is left under the piston at the bottom of the stroke
  static VT = 5.5;             // the tyre, in cylinders
  static STROKE = 98;          // how far the handle travels, in design units

  ready() {
    this.field = this.$('.value'); this.handle = this.$('.handle'); this.bleed = this.$('.bleed');
    this.min = Number(this.getAttribute('min') ?? 0); this.max = Number(this.getAttribute('max') ?? 6);
    this.step = Number(this.getAttribute('step') ?? 0.1);
    Object.assign(this.field, { min: this.min, max: this.max, step: this.step });
    this.field.ariaLabel = this.getAttribute('aria-label') ?? 'Tyre pressure in bar';
    const C = PumpNumber;
    // P is the tyre's pressure above the air outside, in bar. s is the handle, 0 up and 1 down. n is the
    // air in the cylinder, in cylinders at one atmosphere.
    this.venting = false;
    this.sim = { P: clamp(Number(this.getAttribute('value') ?? 2), this.min, this.max), s: 0, to: 0, n: C.V0 + C.VD, lift: 0, hiss: 0, relief: 0 };
    this.needle = { x: this.sim.P, v: 0 };
    this.shown = null;
    this.field.addEventListener('input', () => { if (Number.isFinite(this.field.valueAsNumber)) { this.sim.P = clamp(this.field.valueAsNumber, this.min, this.max); this.commit(false); } });
    this.field.addEventListener('change', () => { this.commit(true); this.shown = null; });
    for (const [sel, d] of [['.dec', -1], ['.inc', 1]]) this.$(sel).addEventListener('click', () => {
      this.sim.P = clamp(Math.round(this.sim.P / this.step + d) * this.step, this.min, this.max); this.commit(true);
    });
    // The handle is a range, so the arrow keys pump. A finger or a mouse drags it directly: while it is
    // held the range's own input events are ignored, because a native range follows the pointer along
    // its own axis and the handle moves on the other one.
    const h = this.handle;
    h.addEventListener('pointerdown', (e) => {
      if (e.button) return;
      h.setPointerCapture(e.pointerId);
      this.grip = { y: e.clientY, s: this.sim.s };
      e.preventDefault(); h.focus({ preventScroll: true });
    });
    h.addEventListener('pointermove', (e) => {
      if (!this.grip) return;
      const k = this.canvas.clientWidth / C.size[0];
      this.sim.to = clamp(this.grip.s + (e.clientY - this.grip.y) / k / C.STROKE);
      this.request();
    });
    const drop = () => { if (!this.grip) return; this.grip = null; h.value = Math.round(this.sim.to * 100); this.commit(true); };
    h.addEventListener('pointerup', drop); h.addEventListener('pointercancel', drop);
    h.addEventListener('input', () => { if (!this.grip) { this.sim.to = h.valueAsNumber / 100; this.request(); } });
    h.addEventListener('change', () => { if (!this.grip) this.commit(true); });
    // The release cap lets air out for as long as it is held. :active is not set by every kind of touch,
    // so the control keeps its own flag from the pointer and the keyboard.
    const vent = (on) => { if (this.venting === on) return; this.venting = on; if (!on) this.commit(true); this.request(); };
    const cap = this.bleed;
    cap.addEventListener('pointerdown', (e) => { if (!e.button) { cap.setPointerCapture(e.pointerId); vent(true); } });
    for (const type of ['pointerup', 'pointercancel', 'blur']) cap.addEventListener(type, () => vent(false));
    cap.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') vent(true); });
    cap.addEventListener('keyup', () => vent(false));
    cap.addEventListener('contextmenu', (e) => e.preventDefault());
    this.commit(false);
  }
  attributeChangedCallback(_, __, v) { if (this.sim && v !== null) this.value = v; }
  get value() { return (Math.round(this.sim.P / this.step) * this.step).toFixed(1); }
  set value(v) { this.sim.P = clamp(Number(v) || 0, this.min, this.max); this.commit(false); }
  // The form value, the number field (unless it is being typed in) and the events.
  commit(done) {
    const v = this.value;
    if (v !== this.shown) {
      this.shown = v;
      this.setValue(v);
      if (this.shadowRoot.activeElement !== this.field) this.field.value = v;
      this.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (done) this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }

  // #region pump-step
  sim1(dt) {
    const { V0, VD, VT } = PumpNumber, m = this.sim;
    // The handle follows the hand, or the keyboard's target, at no more than five strokes a second.
    const ds = clamp(m.to - m.s, -5 * dt, 5 * dt);
    m.s += ds;
    const V = VD + (1 - m.s) * V0;
    let flow = false;
    const tyre = m.P + 1, cyl = m.n / V;                 // both absolute, in bar
    if (cyl > tyre) {
      // The check valve is open: cylinder and tyre are one volume at one pressure.
      const p = (m.n + tyre * VT) / (V + VT);
      m.n = p * V; m.P = p - 1; flow = true;
    } else if (cyl < 1) {
      m.n = V;                                           // the inlet lets outside air in
    }
    if (m.P > this.max) { m.P = this.max; m.relief = 1; }
    if (this.venting && m.P > 0) {
      m.P = Math.max(0, m.P - (0.35 + m.P * 1.6) * dt);   // faster the fuller the tyre is
      m.hiss = 1;
    }
    m.lift += ((flow && ds > 0 ? 1 : 0) - m.lift) * Math.min(1, dt * 30);
    m.hiss = Math.max(0, m.hiss - dt * 6); m.relief = Math.max(0, m.relief - dt * 3);
    return Math.abs(ds) > 1e-6 || m.hiss > 0 || m.relief > 0 || m.lift > 0.01;
  }
  // #endregion pump-step

  draw(ctx, w, h, now) {
    const m = this.sim, C = PumpNumber;
    let live = false;
    if (reduced()) { m.s = m.to; live = this.sim1(0.001) && false; this.needle.x = m.P; }
    else { const sub = 4; for (let i = 0; i < sub; i++) live = this.sim1(this.dt / sub) || live; }
    this.commit(false);
    if (spring(this.needle, m.P, this.dt, 150, 11)) live = true;

    const INK = '#1d1d1b', PAPER = '#cdd3c4', METAL = '#b6bcae', BRASS = '#d9b98c', HOT = '#c9742a';
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.05);
    ctx.lineJoin = 'round';
    // A part cut through, the way a drawing shows metal: a fill, 45 degree lines and an outline.
    const section = (x, y, bw, bh, gap = 3.5) => {
      ctx.fillStyle = METAL; ctx.fillRect(x, y, bw, bh);
      ctx.save(); ctx.beginPath(); ctx.rect(x, y, bw, bh); ctx.clip();
      ctx.strokeStyle = 'rgba(29,29,27,0.55)'; ctx.lineWidth = 0.6; ctx.beginPath();
      for (let i = -bh; i < bw; i += gap) { ctx.moveTo(x + i, y + bh); ctx.lineTo(x + i + bh, y); }
      ctx.stroke(); ctx.restore();
      ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.strokeRect(x, y, bw, bh);
    };

    // ---- the gauge
    const G = { x: 138, y: 146 }, R = 122;
    const ang = (bar) => (135 + 45 * bar) * Math.PI / 180;
    ctx.strokeStyle = INK;
    ctx.fillStyle = '#d3d9cb'; ctx.beginPath(); ctx.arc(G.x, G.y, R, 0, TAU); ctx.fill();
    ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(G.x, G.y, R, 0, TAU); ctx.stroke();
    ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(G.x, G.y, R - 4, 0, TAU); ctx.stroke();
    const tick = (a, r0, r1, lw) => { ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(G.x + Math.cos(a) * r0, G.y + Math.sin(a) * r0); ctx.lineTo(G.x + Math.cos(a) * r1, G.y + Math.sin(a) * r1); ctx.stroke(); };
    ctx.lineWidth = 0.9; ctx.beginPath(); ctx.arc(G.x, G.y, 88, ang(0), ang(6)); ctx.stroke();
    for (let i = 0; i <= 60; i++) tick(ang(i / 10), 88, 88 + (i % 10 === 0 ? 13 : i % 5 === 0 ? 9 : 5), i % 10 === 0 ? 1.3 : 0.7);
    ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = "500 20px 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif";
    for (let b = 0; b <= 6; b++) ctx.fillText(String(b), G.x + Math.cos(ang(b)) * 109, G.y + Math.sin(ang(b)) * 109 + 1);
    const PSI = 14.5038, top = 6 * PSI;
    ctx.lineWidth = 0.7; ctx.beginPath(); ctx.arc(G.x, G.y, 62, ang(0), ang(6)); ctx.stroke();
    for (let p = 0; p <= top; p += 2) tick(ang(p / PSI), 62, 62 + (p % 10 === 0 ? 7 : 3.5), p % 10 === 0 ? 0.9 : 0.5);
    ctx.font = "500 8.5px 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif";
    for (let p = 10; p <= top; p += 10) ctx.fillText(String(p), G.x + Math.cos(ang(p / PSI)) * 52, G.y + Math.sin(ang(p / PSI)) * 52);
    ctx.fillText('psi', G.x, G.y + 30);
    // the needle follows the pressure on a spring, so it overshoots a stroke and settles
    const a = ang(clamp(this.needle.x, -0.15, 6.15));
    ctx.strokeStyle = HOT; ctx.lineWidth = 1.8; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(G.x - Math.cos(a) * 18, G.y - Math.sin(a) * 18); ctx.lineTo(G.x + Math.cos(a) * 97, G.y + Math.sin(a) * 97); ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(G.x, G.y, 3.6, 0, TAU); ctx.fill();
    // the number field and its two buttons are the real elements, drawn where the dial has room
    put(ctx, this.field, G.x - 31, 191, 62, 34);
    put(ctx, this.$('.dec'), G.x - 57, 198, 20, 20);
    put(ctx, this.$('.inc'), G.x + 37, 198, 20, 20);
    ctx.fillStyle = INK; ctx.font = "500 11px 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif";
    ctx.fillText('bar', G.x, 237);

    // ---- the pipe from the pump to the gauge
    const PY = 350;                                        // centre line of the pipe
    ctx.fillStyle = BRASS; ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(G.x + 8, PY - 3.5, 150, 7); ctx.fill(); ctx.stroke();
    section(G.x - 12, PY - 12, 22, 22); section(G.x - 7, G.y + R - 1, 12, PY - 12 - (G.y + R - 1));
    ctx.fillStyle = BRASS; ctx.beginPath(); ctx.moveTo(G.x - 2.5, G.y + R); ctx.lineTo(G.x - 2.5, PY + 2.5); ctx.lineTo(G.x + 10, PY + 2.5); ctx.lineTo(G.x + 10, PY - 2.5); ctx.lineTo(G.x + 2.5, PY - 2.5); ctx.lineTo(G.x + 2.5, G.y + R); ctx.closePath(); ctx.fill();
    for (const x of [G.x + 10, 218, 250, 278]) section(x, PY - 6, 6, 12, 2.5);
    // the release valve: a spring-loaded pin with a cap. The cap is a <button>.
    const BX = 237, down = this.venting ? 5 : 0;
    section(BX - 9, PY - 20, 18, 26);
    ctx.fillStyle = PAPER; ctx.fillRect(BX - 3, PY - 20, 6, 16); ctx.strokeRect(BX - 3, PY - 20, 6, 16);
    ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.beginPath();
    for (let i = 0; i < 5; i++) { const y = PY - 34 + down + i * (14 - down) / 4; ctx.moveTo(BX - 4, y); ctx.lineTo(BX + 4, y + 2); }
    ctx.stroke();
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(BX, PY - 44 + down); ctx.lineTo(BX, PY - 4 + down * 0.6); ctx.stroke();
    ctx.fillStyle = INK; rr(ctx, BX - 14, PY - 50 + down, 28, 8, 3); ctx.fill();
    if (m.hiss > 0 && m.P > 0.01) {                      // air leaving
      ctx.strokeStyle = `rgba(29,29,27,${0.5 * m.hiss})`; ctx.lineWidth = 0.7; ctx.beginPath();
      for (let i = 0; i < 7; i++) { const t = ((now / 260 + rnd(i)) % 1), dx = (rnd(i + 9) - 0.5) * 30; ctx.moveTo(BX + dx * 0.3 + (dx > 0 ? 12 : -12), PY - 22 - t * 4); ctx.lineTo(BX + dx + (dx > 0 ? 18 : -18), PY - 30 - t * 18); }
      ctx.stroke();
    }
    if (this.bleed.matches(':focus-visible')) { ctx.strokeStyle = HOT; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); rr(ctx, BX - 20, PY - 56, 40, 66, 6); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.bleed, BX - 24, PY - 62, 48, 78);

    // ---- the pump
    const X = 318, TOP = 196, BOT = TOP + C.STROKE + 14, IN = 15;      // centre line, the cylinder's ends, half its bore
    const py = TOP + 6 + m.s * C.STROKE;                    // the top of the piston
    const hy = py - 142;                                    // the handle
    section(X - 36, BOT, 72, PY + 12 - BOT);               // base
    ctx.fillStyle = PAPER; ctx.fillRect(X - IN, BOT - 1, IN * 2, 8);
    // the passage from the cylinder to the pipe, and the ball of the check valve in it
    ctx.fillStyle = BRASS; ctx.beginPath(); ctx.moveTo(X - 4, BOT + 6); ctx.lineTo(X - 4, PY - 3); ctx.lineTo(X - 36, PY - 3); ctx.lineTo(X - 36, PY + 3); ctx.lineTo(X + 4, PY + 3); ctx.lineTo(X + 4, BOT + 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = INK; ctx.lineWidth = 0.8; ctx.stroke();
    ctx.beginPath(); for (let i = 0; i < 4; i++) { ctx.moveTo(X - 3, PY - 2 - i * 2.4 + 6); ctx.lineTo(X + 3, PY - 3.2 - i * 2.4 + 6); } ctx.stroke();
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(X, BOT + 9 + m.lift * 5, 4.2, 0, TAU); ctx.fill();
    section(X - IN - 6, TOP, 6, BOT - TOP); section(X + IN, TOP, 6, BOT - TOP);       // walls
    section(X - IN - 9, TOP - 9, IN + 6, 9); section(X + 3, TOP - 9, IN + 6, 9);      // cap, with a hole for the rod
    // the air under the piston: the same specks in a smaller space as it is pushed down
    const cylP = m.n / (C.VD + (1 - m.s) * C.V0);
    ctx.fillStyle = `rgba(217,185,140,${clamp(0.25 + cylP * 0.12)})`; ctx.fillRect(X - IN, py + 8, IN * 2, BOT + 6 - py - 8);
    ctx.fillStyle = HOT;
    const dots = Math.round(m.n * 240), ch = BOT + 5 - (py + 9);
    for (let i = 0; i < dots; i++) ctx.fillRect(X - IN + 1.5 + rnd(i) * (IN * 2 - 3.6), py + 9 + rnd(i + 500) * ch, 1, 1);
    // rod, piston and handle
    ctx.fillStyle = PAPER; ctx.strokeStyle = INK; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.rect(X - 2.5, hy + 6, 5, py - hy - 6); ctx.fill(); ctx.stroke();
    section(X - IN, py, IN * 2, 8, 2.5);
    ctx.fillStyle = METAL; rr(ctx, X - 5, hy - 2, 10, 12, 2); ctx.fill(); ctx.stroke();
    for (const sx of [-1, 1]) { ctx.fillStyle = PAPER; rr(ctx, X + sx * 5 + (sx < 0 ? -24 : 0), hy, 24, 8, 4); ctx.fill(); ctx.stroke(); }
    if (this.handle.matches(':focus-visible')) { ctx.strokeStyle = HOT; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); rr(ctx, X - 36, hy - 10, 72, 28, 8); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.handle, X - 38, hy - 22, 76, 56);
    if (m.relief > 0) { ctx.fillStyle = `rgba(201,116,42,${m.relief})`; ctx.font = "600 10px ui-monospace, monospace"; ctx.textAlign = 'right'; ctx.fillText('relief valve at ' + this.max.toFixed(1), 352, 20); }
    return live;
  }
}
customElements.define('pump-number', PumpNumber);
// #endregion pump-number
