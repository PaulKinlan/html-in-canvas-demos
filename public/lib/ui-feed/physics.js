// ui-feed/physics.js: five controls whose drawing is a small simulation, rebuilt from demos on ui-feed.dev.
//
//   <pump-number name min max step value>      an <input type="number"> filled by a hand pump
//   <string-radios name legend>                radios, each with a string that vibrates when it is chosen
//   <candle-rating name max value>             radios drawn as a row of candles
//   <orbit-listbox name>                       a <select size> beside a probe that flies to the chosen row
//   <ball-calendar name value="2026-12-05">    a month of buttons and a ball that bounces to the chosen day
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root. The
// native elements are children of that canvas. The simulation is stepped in the paint handler and the
// control asks for another frame only while something still moves.
//
// The originals are credited on the page that shows these, /sim-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, TAU, reduced } from './kit.js';

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

// #region string-radios
// One radio and one <label> for each <option> the author wrote, all direct children of the canvas. Each row
// has a string: 40 points joined by tension, fixed at both ends (the wave equation, stepped eight times a
// frame). A heavier string has the same tension and more mass, so its wave is slower and it rings lower.
export class StringRadios extends FeedControl {
  static size = [360, 392];
  static html = `<h3 class="legend"></h3>`;
  static css = `
    .legend { margin: 0; font: 800 58px/1.2 'Helvetica Neue', 'Arial Black', Arial, ui-sans-serif, sans-serif; letter-spacing: -0.035em; color: #1b1508; white-space: nowrap; }
    label { font: 400 23px/1.25 'Helvetica Neue', Arial, ui-sans-serif, sans-serif; color: #1b1508; white-space: nowrap; padding: 6px 0; cursor: pointer; }
    input { width: 232px; height: 44px; opacity: 0; margin: 0; touch-action: manipulation; }`;
  static N = 40; static X0 = 136; static X1 = 338; static ROW0 = 124; static GAP = 46;

  ready() {
    this.legend = this.$('.legend');
    this.canvas.setAttribute('role', 'radiogroup');
    this.strings = [];
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    // Dragging a pointer across a string plucks it without choosing it.
    this.canvas.addEventListener('pointermove', (e) => {
      const r = this.canvas.getBoundingClientRect(), k = StringRadios.size[0] / r.width;
      const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k, last = this.last;
      this.last = { x, y, t: e.timeStamp };
      if (!last || e.timeStamp - last.t > 120) return;
      this.strings.forEach((s, i) => {
        const sy = StringRadios.ROW0 + i * StringRadios.GAP;
        if ((last.y - sy) * (y - sy) < 0 && x > StringRadios.X0 + 6 && x < StringRadios.X1 - 6) {
          const speed = Math.abs(y - last.y) / Math.max(1, e.timeStamp - last.t);
          this.pluck(i, (x - StringRadios.X0) / (StringRadios.X1 - StringRadios.X0), Math.sign(y - last.y) * clamp(speed * 9, 1.2, 6));
        }
      });
    });
    this.canvas.addEventListener('pointerleave', () => { this.last = null; });
  }
  build() {
    const list = options(this), root = this.canvas, keep = this.value;
    this.legend.textContent = this.getAttribute('legend') ?? '';
    root.ariaLabel = this.getAttribute('legend');
    for (const el of this.$$('input, label')) el.remove();
    this.rows = list.map((o, i) => {
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'r', id: 'r' + i, value: o.value, checked: keep ? o.value === keep : o.selected });
      const label = Object.assign(document.createElement('label'), { htmlFor: 'r' + i, textContent: o.label });
      label.style.fontWeight = o.data.weight ?? 400;
      input.setAttribute('drawable', ''); label.setAttribute('drawable', '');
      input.addEventListener('change', () => {
        const f = this.last ? clamp((this.last.x - StringRadios.X0) / (StringRadios.X1 - StringRadios.X0), 0.12, 0.88) : 0.72;
        this.pluck(i, f, 13);
        this.setValue(this.value);
        this.dispatchEvent(new Event('change', { bubbles: true }));
      });
      root.append(input, label);
      // The line is as heavy as the label: a font weight of 100 to 900 becomes 0.8 to 5.2 units.
      const thick = 0.25 + Number(o.data.weight ?? 400) * 0.0055;
      const old = this.strings[i];
      return { input, label, thick, u: old?.u ?? new Float32Array(StringRadios.N + 1), v: old?.v ?? new Float32Array(StringRadios.N + 1), live: old?.live ?? false };
    });
    this.strings = this.rows;
    this.setValue(this.value);
    this.request();
  }
  get value() { return this.$('input:checked')?.value ?? ''; }
  set value(v) { for (const r of this.rows) r.input.checked = r.input.value === String(v); this.setValue(this.value); this.request(); }

  // #region string-step
  // Pull the string into a triangle with its corner at `at` (0 to 1 along it) and let go.
  pluck(i, at, amp) {
    const s = this.strings[i], N = StringRadios.N;
    if (!s || reduced()) return;
    for (let k = 1; k < N; k++) { const x = k / N; s.u[k] += amp * (x < at ? x / at : (1 - x) / (1 - at)); }
    s.live = true;
    this.request();
  }
  wave(s, dt) {
    const N = StringRadios.N, steps = 8, h = dt / steps, T = 26000 / s.thick, { u, v } = s;
    let energy = 0;
    for (let n = 0; n < steps; n++) {
      for (let k = 1; k < N; k++) v[k] += (T * (u[k - 1] - 2 * u[k] + u[k + 1]) - 1.9 * v[k]) * h;
      // A real string loses its sharp corners first. This takes a little of each point's speed from its neighbours.
      for (let k = 1; k < N; k++) u[k] += (v[k] + 0.02 * (v[k - 1] - 2 * v[k] + v[k + 1])) * h;
    }
    for (let k = 1; k < N; k++) energy = Math.max(energy, Math.abs(u[k]), Math.abs(v[k]) * 0.01);
    if (energy < 0.06) { u.fill(0); v.fill(0); s.live = false; }
  }
  // #endregion string-step

  draw(ctx, w, h) {
    const { N, X0, X1, ROW0, GAP } = StringRadios, INK = '#1b1508';
    ctx.fillStyle = '#e0a626'; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.07);
    put(ctx, this.legend, 24, 16);
    let live = false;
    this.rows.forEach((s, i) => {
      const y = ROW0 + i * GAP;
      if (s.live) { this.wave(s, this.dt); live = live || s.live; }
      put(ctx, s.label, 26, y - s.label.offsetHeight / 2);
      ctx.strokeStyle = INK; ctx.lineWidth = s.thick; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(X0, y);
      for (let k = 1; k <= N; k++) ctx.lineTo(X0 + (X1 - X0) * k / N, y + s.u[k]);
      ctx.stroke();
      // the radio: a ring the string is tied to, with a dot in it when it is the checked one
      ctx.fillStyle = '#e0a626'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(X0 - 6, y, 6, 0, TAU); ctx.fill(); ctx.stroke();
      if (s.input.checked) { ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(X0 - 6, y, 3.3, 0, TAU); ctx.fill(); }
      if (s.input.matches(':focus-visible')) { ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X0 - 6, y, 11, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      hit(ctx, s.input, X0 - 18, y - 22, 232, 44);
    });
    // the bar the strings end on
    const n = Math.max(1, this.rows.length);
    ctx.strokeStyle = INK; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(X1, ROW0 - 16); ctx.lineTo(X1, ROW0 + (n - 1) * GAP + 16); ctx.stroke();
    return live;
  }
}
customElements.define('string-radios', StringRadios);
// #endregion string-radios

// #region candle-rating
// A rating is a set of radios: "3 of 5" checks the third. The canvas lights the first three candles. Each
// candle is lit by its own flame and by its neighbours', so an unlit candle beside a lit one is bright on
// the side that faces it. Raising the rating carries a match along the row. Lowering it puts the others
// out, and each one smokes for a second and a half.
export class CandleRating extends FeedControl {
  static size = [360, 372];
  static fps = 30;
  static html = `<span class="legend"><slot>How was it?</slot></span><output class="count" aria-hidden="true"></output>`;
  static css = `
    .legend, .count { font: 400 12.5px/1.3 'Helvetica Neue', Arial, ui-sans-serif, sans-serif; color: #a59f93; white-space: nowrap; }
    .count { font-family: ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color: #d8d2c5; width: 80px; text-align: right; }
    input { width: 68px; height: 250px; opacity: 0; margin: 0; touch-action: manipulation; }`;
  static observedAttributes = ['value'];
  static TOP = 122; static BASE = 296; static HALF = 7.5;

  ready() {
    this.max = clamp(Number(this.getAttribute('max') ?? 5) | 0, 2, 7);
    const start = clamp(Number(this.getAttribute('value') ?? 0) | 0, 0, this.max);
    this.candles = [];
    for (let i = 1; i <= this.max; i++) {
      const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'r', value: String(i), checked: i === start, ariaLabel: `${i} of ${this.max}` });
      input.setAttribute('drawable', '');
      input.addEventListener('change', () => { this.light(); this.dispatchEvent(new Event('change', { bubbles: true })); });
      this.canvas.append(input);
      this.candles.push({ input, lit: i <= start, level: i <= start ? 1 : 0, out: -1e9, smoke: [], seed: rnd(i) * 40 });
    }
    this.canvas.setAttribute('role', 'radiogroup');
    this.t = 0;
    this.sync();
  }
  attributeChangedCallback(_, __, v) { if (this.candles && v !== null) this.value = v; }
  get value() { return this.$('input:checked')?.value ?? ''; }
  set value(v) { for (const c of this.candles) c.input.checked = c.input.value === String(v); this.light(); }
  sync() {
    this.setValue(this.value || null);
    this.$('.count').textContent = `${this.value || 0} of ${this.max}`;
    this.canvas.ariaLabel = this.textContent.trim() || 'Rating';
    this.request();
  }
  x(i) { const gap = (360 - 72) / (this.max - 1 || 1); return 36 + i * Math.min(gap, 72) + (288 - Math.min(gap, 72) * (this.max - 1)) / 2; }
  // Bring the candles to the checked value: the ones above it go out now, the ones below wait for the match.
  light() {
    const v = Number(this.value || 0), queue = [];
    this.candles.forEach((c, i) => {
      if (i < v && !c.lit) { if (reduced()) { c.lit = true; c.level = 1; } else queue.push(i); }
      if (i >= v && c.lit) { c.lit = false; c.out = this.t; if (reduced()) c.level = 0; }
    });
    if (queue.length) {
      const from = this.match?.at ?? { x: this.x(queue[0]) + 26, y: CandleRating.TOP - 34 };
      this.match = { queue, at: { ...from }, from, t: 0, age: 0 };
    }
    this.sync();
  }

  // #region candle-flame
  flame(ctx, x, y, s, t, seed) {
    const sway = (Math.sin(t * 7.3 + seed) * 0.6 + Math.sin(t * 13.7 + seed * 2.1) * 0.4) * 1.5 * s;
    const hgt = 30 * s * (1 + 0.07 * Math.sin(t * 17.3 + seed * 3)), wd = 5.4 * s;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(x, y - hgt * 0.5, 0, x, y - hgt * 0.5, 54 * s);
    halo.addColorStop(0, 'rgba(255,176,84,0.42)'); halo.addColorStop(0.35, 'rgba(255,140,50,0.12)'); halo.addColorStop(1, 'rgba(255,120,40,0)');
    ctx.fillStyle = halo; ctx.fillRect(x - 60 * s, y - hgt * 0.5 - 60 * s, 120 * s, 120 * s);
    ctx.restore();
    const tear = (k, lean) => {
      ctx.beginPath(); ctx.moveTo(x, y + 1.5);
      ctx.bezierCurveTo(x - wd * 1.55 * k, y - hgt * 0.12, x - wd * 0.95 * k + sway * 0.35 * lean, y - hgt * 0.58 * k, x + sway * lean, y - hgt * k);
      ctx.bezierCurveTo(x + wd * 0.95 * k + sway * 0.35 * lean, y - hgt * 0.58 * k, x + wd * 1.55 * k, y - hgt * 0.12, x, y + 1.5);
    };
    const g = ctx.createLinearGradient(0, y + 2, 0, y - hgt);
    g.addColorStop(0, 'rgba(96,130,255,0.75)'); g.addColorStop(0.14, 'rgba(255,150,60,0.9)'); g.addColorStop(0.4, '#ffd98a'); g.addColorStop(0.75, '#fff3cf'); g.addColorStop(1, 'rgba(255,236,190,0.85)');
    ctx.save(); ctx.shadowColor = 'rgba(255,160,60,0.9)'; ctx.shadowBlur = 12 * s * this.px; ctx.fillStyle = g; tear(1, 1); ctx.fill(); ctx.restore();
    ctx.fillStyle = 'rgba(255,253,240,0.92)'; ctx.save(); ctx.translate(0, -hgt * 0.1); tear(0.55, 0.7); ctx.fill(); ctx.restore();
  }
  // #endregion candle-flame

  draw(ctx, w, h) {
    const C = CandleRating, cs = this.candles, dt = this.dt;
    this.t += dt;
    const t = this.t;
    let live = false;
    // the match: go to the next unlit candle, hold the flame to its wick, move on
    const m = this.match;
    if (m) {
      m.age += dt;
      const i = m.queue[0], goal = { x: this.x(i) + 5, y: C.TOP - 9 };
      m.t += dt;
      const travel = 0.2, hold = 0.2, k = smooth(m.t / travel);
      m.at = { x: lerp(m.from.x, goal.x, k), y: lerp(m.from.y, goal.y, k) - Math.sin(k * Math.PI) * 10 };
      if (m.t > travel + hold * 0.4) cs[i].lit = true;
      if (m.t > travel + hold) { m.queue.shift(); m.from = { ...m.at }; m.t = 0; if (!m.queue.length) { this.match = null; this.gone = { at: m.at, t: 0 }; } }
      live = true;
    }
    for (const c of cs) {
      const to = c.lit ? 1 : 0;
      if (c.level !== to) { c.level = clamp(c.level + (to ? dt / 0.45 : -dt / 0.09)); live = true; }
      if (c.lit) live = true;                              // a flame never holds still
    }
    // how much light falls on each candle from its left and from its right
    const fall = (d) => 0.34 / (d * d);
    ctx.fillStyle = '#0b0907'; ctx.fillRect(0, 0, w, h);
    const total = cs.reduce((s, c) => s + c.level, 0);
    // the wall and the table take a little light from every flame
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    cs.forEach((c, i) => {
      if (c.level <= 0) return;
      const x = this.x(i), fl = 0.9 + 0.1 * Math.sin(t * 9 + c.seed);
      const wall = ctx.createRadialGradient(x, C.TOP - 20, 0, x, C.TOP - 20, 170);
      wall.addColorStop(0, `rgba(120,72,30,${0.2 * c.level * fl})`); wall.addColorStop(1, 'rgba(60,30,10,0)');
      ctx.fillStyle = wall; ctx.fillRect(0, 0, w, C.BASE + 6);
      ctx.save(); ctx.translate(x, C.BASE + 10); ctx.scale(1, 0.2);
      const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, 120);
      pool.addColorStop(0, `rgba(150,96,44,${0.34 * c.level * fl})`); pool.addColorStop(1, 'rgba(60,30,10,0)');
      ctx.fillStyle = pool; ctx.fillRect(-130, -130, 260, 260); ctx.restore();
    });
    ctx.restore();
    grain(ctx, w, h, 0.035);
    const tone = (v) => { v = clamp(v); return `rgb(${Math.round(lerp(13, 244, v))},${Math.round(lerp(11, 222, v))},${Math.round(lerp(9, 176, v))})`; };
    cs.forEach((c, i) => {
      const x = this.x(i);
      let L = 0, Rr = 0;
      cs.forEach((o, j) => { if (j < i) L += o.level * fall(i - j); if (j > i) Rr += o.level * fall(j - i); });
      const own = c.level * 0.78;
      // holder and its shadow
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.ellipse(x, C.BASE + 5, 26, 5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = tone(0.03 + (own + L + Rr) * 0.07); ctx.beginPath(); ctx.ellipse(x, C.BASE + 1, 13, 5.5, 0, 0, TAU); ctx.fill();
      // the wax: a round column, so the middle takes its own flame's light and each edge its neighbour's
      const g = ctx.createLinearGradient(x - C.HALF, 0, x + C.HALF, 0);
      g.addColorStop(0, tone(own * 0.62 + L)); g.addColorStop(0.5, tone(own + (L + Rr) * 0.45)); g.addColorStop(1, tone(own * 0.62 + Rr));
      ctx.fillStyle = g; rr(ctx, x - C.HALF, C.TOP, C.HALF * 2, C.BASE - C.TOP, [2.5, 2.5, 1, 1]); ctx.fill();
      const fade = ctx.createLinearGradient(0, C.TOP, 0, C.BASE);
      fade.addColorStop(0, 'rgba(8,6,4,0)'); fade.addColorStop(0.55, 'rgba(8,6,4,0.16)'); fade.addColorStop(1, 'rgba(8,6,4,0.62)');
      ctx.fillStyle = fade; ctx.fillRect(x - C.HALF, C.TOP, C.HALF * 2, C.BASE - C.TOP);
      if (c.level > 0) {                                   // light inside the wax under the flame
        const glow = ctx.createLinearGradient(0, C.TOP, 0, C.TOP + 46);
        glow.addColorStop(0, `rgba(255,236,190,${0.5 * c.level})`); glow.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = glow; ctx.fillRect(x - C.HALF, C.TOP, C.HALF * 2, 46);
      }
      ctx.strokeStyle = '#141009'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, C.TOP); ctx.lineTo(x + 0.6, C.TOP - 5); ctx.stroke();
      // a wick that has just gone out glows, then smokes
      const since = t - c.out;
      if (since < 1.5 && !c.lit) {
        ctx.fillStyle = `rgba(255,${Math.round(90 - since * 40)},30,${clamp(1 - since / 1.1)})`; ctx.beginPath(); ctx.arc(x + 0.6, C.TOP - 5, 1.3, 0, TAU); ctx.fill();
        if (since > 0.08 && since < 1.3 && c.smoke.length < 110) for (let n = 0; n < 3; n++) c.smoke.push({ x: x + 0.6, y: C.TOP - 6, vx: 3 + rnd(c.made = (c.made ?? 0) + 1) * 5, vy: -(26 + rnd(c.made + i * 7) * 12), age: 0, life: 1.0 + rnd(c.made + 50) * 0.8, seed: i * 1.7 });
      }
      if (c.smoke.length) {
        live = true;
        ctx.save(); ctx.filter = `blur(${1.1 * this.px}px)`;
        for (const p of c.smoke) {
          p.age += dt; p.vx += Math.sin(p.age * 4.4 + p.seed) * 30 * dt; p.vy *= 1 - 0.5 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt;
          const k = p.age / p.life;
          ctx.fillStyle = `rgba(205,196,180,${0.1 * (1 - k) * smooth(k * 6)})`;
          ctx.beginPath(); ctx.arc(p.x, p.y, 1 + k * 3.6, 0, TAU); ctx.fill();
        }
        ctx.restore();
        c.smoke = c.smoke.filter((p) => p.age < p.life);
      }
      if (c.level > 0.02) this.flame(ctx, x + 0.6, C.TOP - 5, c.level * (0.94 + 0.06 * Math.sin(t * 5 + c.seed)), t, c.seed);
      if (c.input.matches(':focus-visible')) { ctx.strokeStyle = '#ffd98a'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); rr(ctx, x - 22, C.TOP - 44, 44, C.BASE - C.TOP + 56, 8); ctx.stroke(); ctx.setLineDash([]); }
      const half = Math.min(36, (this.x(1) - this.x(0)) / 2);
      hit(ctx, c.input, x - half, C.TOP - 60, half * 2, 250);
    });
    // the match, and its last moment after the last candle
    const stick = (at, alpha) => {
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#c9a877'; ctx.lineWidth = 1.6; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(at.x + 22, at.y + 20); ctx.stroke();
      this.flame(ctx, at.x - 1, at.y, 0.42, t * 1.4, 9);
      ctx.restore();
    };
    if (this.match) stick(this.match.at, clamp(this.match.age / 0.12));
    if (this.gone) { this.gone.t += dt; const k = this.gone.t / 0.3; if (k < 1) { stick({ x: this.gone.at.x + k * 14, y: this.gone.at.y - k * 10 }, 1 - k); live = true; } else this.gone = null; }
    // the question and the count are elements
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.fillRect(22, 328, w - 44, 1);
    put(ctx, this.$('.legend'), 22, 341);
    put(ctx, this.$('.count'), w - 22 - 80, 341, 80);
    if (total <= 0 && !live) { ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(0, 0, w, h); }
    return live;
  }
}
customElements.define('candle-rating', CandleRating);
// #endregion candle-rating

// #region orbit-listbox
// A native <select size> is the listbox: its rows, arrow keys and type-ahead are the browser's. Beside it
// is a field with one gravity well for each <option>. A probe circles the chosen one. Choosing another
// gives the probe a new target: each frame it is steered toward the speed a circular orbit would have at
// its distance, plus a pull inward that fades as it reaches the orbit, so it leaves on a tangent, curves
// across and is wound in.
export class OrbitListbox extends FeedControl {
  static size = [360, 372];
  static html = `<select aria-label="Destination"></select>`;
  static css = `
    select { width: 122px; height: 356px; padding: 0; border: 1px solid #47586a; border-radius: 0; outline: 0; overflow: hidden;
      background: #0a0e15; color: #dfe7ee; font: 700 17px/1.15 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; }
    option { box-sizing: border-box; padding: 9px 8px 0; border-bottom: 1px solid #47586a; background: #0a0e15; color: #dfe7ee; }
    option:checked { background: #ff6a3d linear-gradient(#ff6a3d, #ff6a3d); color: #17100c; }
    select:focus-visible { border-color: #ff6a3d; }`;
  static R0 = 15;              // the radius of the orbit
  static GM = 26000;           // the pull of a well: gives a lap of about 2.3 s at R0

  ready() {
    this.list = this.$('select');
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
    this.list.addEventListener('change', () => {
      this.setValue(this.value); this.held = 0;
      this.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  get value() { return this.list.value; }
  set value(v) { this.list.value = String(v); this.setValue(this.value); this.held = 0; this.request(); }
  sync() {
    const keep = this.list?.value, list = this.data = options(this), n = Math.max(1, list.length);
    this.list.size = Math.max(2, n);
    this.rowH = 354 / n;
    this.list.innerHTML = list.map((o) => `<option value="${esc(o.value)}"${o.selected ? ' selected' : ''} style="height:${this.rowH}px">${esc(o.label)}</option>`).join('');
    if (keep && list.some((o) => o.value === keep)) this.list.value = keep;
    if (this.list.selectedIndex < 0 && n) this.list.selectedIndex = 0;
    // one well for each row, level with it, set left and right of a line down the field
    this.wells = list.map((o, i) => ({ x: 150 + (i % 2 ? -1 : 1) * (24 + rnd(i + 3) * 26) - (i % 3 === 2 ? 14 : 0), y: 9 + (i + 0.5) * this.rowH }));
    this.sun = { x: 52, y: 190 };
    const c = this.wells[this.list.selectedIndex] ?? { x: 150, y: 180 };
    this.probe = { x: c.x + OrbitListbox.R0, y: c.y, vx: 0, vy: -Math.sqrt(OrbitListbox.GM / OrbitListbox.R0) };
    this.trail = []; this.held = 9; this.map = null;
    this.setValue(this.value);
    this.request();
  }

  // #region orbit-step
  step(dt) {
    const { R0, GM } = OrbitListbox, p = this.probe, c = this.wells[this.list.selectedIndex];
    if (!c) return;
    const dx = p.x - c.x, dy = p.y - c.y, r = Math.hypot(dx, dy) || 1e-3;
    const ex = dx / r, ey = dy / r, tx = ey, ty = -ex;       // out from the well, and along the orbit
    if (this.held || r < R0 + 7) {
      // Captured: from here it is a circular orbit, and what is left of the approach is eased out of the radius.
      this.held = (this.held ?? 0) + dt;
      const r1 = r + (R0 - r) * Math.min(1, 5 * dt), a = Math.atan2(dy, dx) - (Math.sqrt(GM / R0) / R0) * dt;
      p.x = c.x + Math.cos(a) * r1; p.y = c.y + Math.sin(a) * r1;
      p.vx = Math.sin(a) * Math.sqrt(GM / R0); p.vy = -Math.cos(a) * Math.sqrt(GM / R0);
      this.off = Math.abs(r1 - R0);
      return;
    }
    const round = Math.sqrt(GM / Math.max(r, R0));           // the speed of a circular orbit at this distance
    const near = smooth(1 - (r - R0) / 110);                 // 0 far away, 1 on the orbit
    const side = Math.max(round, 70 * (1 - near)) * (0.55 + 0.45 * near);   // far out it still drifts sideways, which is what bends the path
    const fallIn = clamp((r - R0) * 2.2, -80, 150);
    const wantX = -ex * fallIn + tx * side, wantY = -ey * fallIn + ty * side;
    const k = Math.min(1, (2 + near * 6) * dt);
    p.vx += (wantX - p.vx) * k; p.vy += (wantY - p.vy) * k;
    p.x += p.vx * dt; p.y += p.vy * dt;
    this.off = Math.abs(r - R0);
  }
  // #endregion orbit-step

  // The contour lines of the field's potential, drawn once on a plain canvas with marching squares.
  contours(px) {
    if (this.map?.px === px) return this.map.canvas;
    const W = 222, H = 356, S = 5, cols = Math.ceil(W / S) + 1, rows = Math.ceil(H / S) + 1;
    const canvas = document.createElement('canvas'); canvas.width = Math.round(W * px); canvas.height = Math.round(H * px);
    const g = canvas.getContext('2d'); g.scale(px, px);
    const phi = (x, y) => { let v = 2.6 * 40 / (Math.hypot(x - this.sun.x + 8, y - this.sun.y + 8) + 26); for (const q of this.wells) v += 34 / (Math.hypot(x - q.x + 8, y - q.y + 9) + 20); return v + x * 0.004; };
    const f = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) f[j * cols + i] = phi(i * S, j * S);
    g.strokeStyle = 'rgba(120,150,175,0.22)'; g.lineWidth = 0.7;
    for (const level of [1.55, 1.75, 1.95, 2.2, 2.5, 2.9, 3.4]) {
      g.beginPath();
      for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
        const a = f[j * cols + i], b = f[j * cols + i + 1], c = f[(j + 1) * cols + i + 1], d = f[(j + 1) * cols + i];
        const pts = [];
        const cut = (v0, v1, x0, y0, x1, y1) => { if ((v0 < level) !== (v1 < level)) { const t = (level - v0) / (v1 - v0); pts.push([(x0 + (x1 - x0) * t) * S, (y0 + (y1 - y0) * t) * S]); } };
        cut(a, b, i, j, i + 1, j); cut(b, c, i + 1, j, i + 1, j + 1); cut(d, c, i, j + 1, i + 1, j + 1); cut(a, d, i, j, i, j + 1);
        for (let k = 0; k + 1 < pts.length; k += 2) { g.moveTo(pts[k][0], pts[k][1]); g.lineTo(pts[k + 1][0], pts[k + 1][1]); }
      }
      g.stroke();
    }
    this.map = { px, canvas };
    return canvas;
  }

  draw(ctx, w, h) {
    const { R0 } = OrbitListbox, HOT = '#ff6a3d', LINE = '#47586a', sel = this.list.selectedIndex;
    let live = false;
    if (reduced()) { const c = this.wells[sel]; if (c) Object.assign(this.probe, { x: c.x + R0, y: c.y }); this.trail = []; }
    else if (this.held < 2.4) {                             // one lap after the capture, then it parks
      for (let i = 0; i < 2; i++) this.step(this.dt / 2);
      this.trail.push({ x: this.probe.x, y: this.probe.y, t: 0 });
      live = true;
    }
    for (const q of this.trail) q.t += this.dt;
    this.trail = this.trail.filter((q) => q.t < 1.3);
    if (this.trail.length && !live) { live = true; }

    ctx.fillStyle = '#0a0e15'; ctx.fillRect(0, 0, w, h);
    const F = { x: 8, y: 8, w: 222, h: 356 };
    ctx.save(); ctx.beginPath(); ctx.rect(F.x, F.y, F.w, F.h); ctx.clip();
    ctx.drawImage(this.contours(this.px), F.x, F.y, F.w, F.h);
    ctx.strokeStyle = 'rgba(120,150,175,0.4)'; ctx.lineWidth = 0.7; ctx.beginPath();
    for (let y = F.y + 34; y < F.y + F.h; y += 48) for (let x = F.x + 30; x < F.x + F.w; x += 48) { ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); }
    ctx.stroke();
    // the sun, off to one side
    ctx.strokeStyle = 'rgba(120,150,175,0.35)'; ctx.beginPath(); ctx.arc(this.sun.x, this.sun.y, 44, 0, TAU); ctx.stroke();
    const sg = ctx.createRadialGradient(this.sun.x, this.sun.y, 0, this.sun.x, this.sun.y, 9);
    sg.addColorStop(0, '#fff'); sg.addColorStop(0.3, '#ffb199'); sg.addColorStop(1, 'rgba(255,106,61,0)');
    ctx.fillStyle = sg; ctx.fillRect(this.sun.x - 10, this.sun.y - 10, 20, 20);
    ctx.strokeStyle = 'rgba(255,177,153,0.7)'; ctx.beginPath(); ctx.moveTo(this.sun.x - 8, this.sun.y); ctx.lineTo(this.sun.x + 8, this.sun.y); ctx.moveTo(this.sun.x, this.sun.y - 8); ctx.lineTo(this.sun.x, this.sun.y + 8); ctx.stroke();
    this.wells.forEach((q, i) => {
      const on = i === sel;
      ctx.strokeStyle = on ? HOT : LINE; ctx.lineWidth = on ? 1 : 0.7;
      ctx.beginPath(); ctx.moveTo(q.x + R0 + 4, q.y); ctx.lineTo(F.x + F.w + 6, q.y); ctx.stroke();
      ctx.strokeStyle = 'rgba(160,185,205,0.5)'; ctx.lineWidth = 0.6;
      for (const r of [5, 9, 12]) { ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, TAU); ctx.stroke(); }
      ctx.setLineDash(on ? [] : [2, 2.5]); ctx.strokeStyle = on ? HOT : 'rgba(160,185,205,0.75)'; ctx.lineWidth = on ? 1.1 : 0.8;
      ctx.beginPath(); ctx.arc(q.x, q.y, R0, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#eef3f7'; ctx.beginPath(); ctx.arc(q.x, q.y, 1.6, 0, TAU); ctx.fill();
    });
    // where the probe has been in the last second, fading
    ctx.lineCap = 'round';
    for (let i = 1; i < this.trail.length; i++) {
      const a = this.trail[i - 1], b = this.trail[i];
      ctx.strokeStyle = `rgba(255,106,61,${0.85 * (1 - b.t / 1.3)})`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    const p = this.probe;
    const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 7);
    pg.addColorStop(0, 'rgba(255,140,100,0.9)'); pg.addColorStop(1, 'rgba(255,106,61,0)');
    ctx.fillStyle = pg; ctx.fillRect(p.x - 8, p.y - 8, 16, 16);
    ctx.fillStyle = '#fff3ea'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = LINE; ctx.lineWidth = 1; ctx.strokeRect(F.x + 0.5, F.y + 0.5, F.w - 1, F.h - 1);

    // the listbox, as the browser painted it, with each row's second line drawn over it
    put(ctx, this.list, 232, 8, 122, 356);
    ctx.font = "500 9.5px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace"; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    this.data.forEach((o, i) => {
      const y = 9 + i * this.rowH, on = i === sel;
      ctx.fillStyle = on ? '#3a1d10' : '#93a5b5';
      if (o.data.note) ctx.fillText(o.data.note, 241, y + 43, 108);
      if (on) { ctx.strokeStyle = '#3a1d10'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.arc(343, y + 12, 3.6, 0.6, TAU); ctx.stroke(); }
    });
    return live;
  }
}
customElements.define('orbit-listbox', OrbitListbox);
// #endregion orbit-listbox

// #region ball-calendar
// A month as a <table> of <button>s, one for each day, with the chosen one pressed. The table is drawn as
// it is. Under each number the canvas draws a dimple, and a rubber ball sits in the chosen one. Choosing
// another day throws the ball there: a hop for about every 70 units of the way, each lower than the last,
// then two small bounces in the dimple.
export class BallCalendar extends FeedControl {
  static size = [360, 408];
  static html = `<output class="head"><b></b><span></span><time></time></output><table></table>`;
  static css = `
    .head { display: flex; align-items: flex-end; gap: 10px; width: 322px; height: 78px; color: #141412; }
    .head b { font: 500 82px/0.86 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif; letter-spacing: -0.02em; }
    .head span, .head time { font: 600 18px/1.5 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; white-space: nowrap; }
    .head time { margin-left: auto; font-weight: 400; color: #8b8a84; }
    table { border-collapse: collapse; width: 322px; table-layout: fixed; }
    th { height: 20px; padding: 0 0 0 2px; font: 600 8px/1 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 0.1em; color: #8b8a84; text-align: left; text-transform: uppercase; }
    td { height: 48px; padding: 0; border-top: 1px solid #c4c2ba; vertical-align: top; }
    tr:last-child td { border-bottom: 1px solid #c4c2ba; }
    button { all: unset; display: flex; align-items: flex-start; box-sizing: border-box; width: 46px; height: 48px; padding: 5px 0 0 0;
      font: 600 10.5px/1 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color: #1a1a18; cursor: pointer; touch-action: manipulation; }
    button span { padding: 1px 3px 1px 2px; border-radius: 2px; }
    button[aria-pressed=true] span { background: #f2c21a; }
    button:focus-visible { outline: 2px solid #1a1a18; outline-offset: -3px; border-radius: 6px; }`;
  static observedAttributes = ['value'];
  static R = 13;

  ready() {
    this.table = this.$('table'); this.head = this.$('.head');
    const v = this.getAttribute('value') ?? new Date().toISOString().slice(0, 10);
    const [y, mo, d] = v.split('-').map(Number);
    this.year = y; this.month = mo; this.day = d;
    const first = new Date(Date.UTC(y, mo - 1, 1)), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = `<caption hidden></caption><thead><tr>${names.map((n) => `<th scope="col">${n}</th>`).join('')}</tr></thead><tbody><tr>`;
    for (let i = 0; i < first.getUTCDay(); i++) html += '<td></td>';
    for (let n = 1; n <= days; n++) {
      const date = new Date(Date.UTC(y, mo - 1, n));
      html += `<td><button type="button" data-day="${n}" aria-label="${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}"><span>${n}</span></button></td>`;
      if (date.getUTCDay() === 6 && n < days) html += '</tr><tr>';
    }
    this.table.innerHTML = html + '</tr></tbody>';
    this.buttons = this.$$('button');
    this.table.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.choose(Number(b.dataset.day), true); });
    // One button is in the tab order. The arrow keys move between days, as in a grid.
    this.table.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      const at = this.buttons.indexOf(this.shadowRoot.activeElement);
      if (!step || at < 0) return;
      const to = this.buttons[at + step];
      if (to) { e.preventDefault(); this.buttons[at].tabIndex = -1; to.tabIndex = 0; to.focus({ preventScroll: true }); this.request(); }
    });
    this.landed = this.day;
    this.ball = null;
    this.choose(this.day, false);
  }
  attributeChangedCallback(_, __, v) { if (this.buttons && v) this.choose(Number(v.split('-')[2]), false); }
  get value() { return `${this.year}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`; }
  set value(v) { this.choose(Number(String(v).split('-')[2]), false); }
  // The middle of a day's dimple, in design units.
  spot(day) {
    const b = this.buttons[day - 1], s = this.slice(b, this.table);
    return { x: 19 + s.left + 29, y: 104 + s.top + 29 };
  }
  choose(day, fromUser) {
    day = clamp(day | 0, 1, this.buttons.length);
    const moved = day !== this.day;
    this.day = day;
    this.buttons.forEach((b, i) => { b.setAttribute('aria-pressed', String(i === day - 1)); b.tabIndex = i === day - 1 ? 0 : -1; });
    this.setValue(this.value);
    this.aim = day;                                       // the throw starts in the next paint, when the table has a layout
    if (!moved || reduced()) this.landed = day;
    this.title();
    if (fromUser && moved) this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }
  // The big number and the weekday follow the ball: they change when it lands.
  title() {
    const date = new Date(Date.UTC(this.year, this.month - 1, this.landed));
    this.head.children[0].textContent = this.landed;
    this.head.children[1].textContent = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    this.head.children[2].textContent = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // #region ball-step
  // b.t runs through the hops. Along the ground the ball moves at one speed. Its height in hop k is a
  // parabola, and each hop is 0.62 of the height of the one before.
  throwTo(to) {
    const b = this.ball, dist = Math.hypot(to.x - b.x, to.y - b.y);
    if (dist < 1) return;
    const hops = clamp(Math.round(dist / 70), 1, 4);
    Object.assign(b, { from: { x: b.x, y: b.y }, to, hops, t: 0, dur: 0.24 * hops + 0.1, spin: b.spin ?? 0, dist });
  }
  stepBall(dt) {
    const b = this.ball;
    if (!b.to) return false;
    b.t += dt;
    const fly = b.dur, settle = 0.32;
    if (b.t < fly) {
      const k = b.t / fly, hop = Math.min(b.hops - 1, Math.floor(k * b.hops)), u = k * b.hops - hop;
      b.x = lerp(b.from.x, b.to.x, k); b.y = lerp(b.from.y, b.to.y, k);
      b.z = 4 * (30 * 0.62 ** hop + 6) * u * (1 - u);
      b.spin += (b.dist / fly) * dt / BallCalendar.R;
    } else if (b.t < fly + settle) {
      const u = (b.t - fly) / settle;                      // two small bounces where it lands
      b.x = b.to.x; b.y = b.to.y;
      b.z = u < 0.6 ? 4 * 5 * (u / 0.6) * (1 - u / 0.6) : 4 * 1.6 * ((u - 0.6) / 0.4) * (1 - (u - 0.6) / 0.4);
      if (this.landed !== this.day) { this.landed = this.day; this.title(); }
    } else {
      Object.assign(b, { x: b.to.x, y: b.to.y, z: 0, to: null });
      if (this.landed !== this.day) { this.landed = this.day; this.title(); }
      return false;
    }
    return true;
  }
  // #endregion ball-step

  draw(ctx, w, h) {
    const R = BallCalendar.R;
    ctx.fillStyle = '#e8e7e2'; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.045);
    if (!this.table.offsetHeight) return true;
    if (!this.ball) this.ball = { ...this.spot(this.day), z: 0, spin: 0.6 };
    if (this.aim) {
      const to = this.spot(this.aim); this.aim = 0;
      if (reduced() || this.landed === this.day) Object.assign(this.ball, to, { z: 0, to: null }); else this.throwTo(to);
    }
    const live = this.stepBall(this.dt);
    // a dimple pressed into the card under each day: shaded where the light from the top left can't reach
    for (let d = 1; d <= this.buttons.length; d++) {
      const s = this.spot(d);
      const g = ctx.createLinearGradient(s.x - 10, s.y - 10, s.x + 10, s.y + 10);
      g.addColorStop(0, '#c4c2ba'); g.addColorStop(0.5, '#e2e1dc'); g.addColorStop(1, '#f7f6f3');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, TAU); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0.1, 1.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,58,50,0.22)'; ctx.beginPath(); ctx.arc(s.x, s.y, 14, Math.PI + 0.1, Math.PI + 1.5); ctx.stroke();
    }
    put(ctx, this.head, 19, 14);
    put(ctx, this.table, 19, 104);
    // the ball: its shadow moves away and softens as it rises
    const b = this.ball, z = b.z, k = 1 + z / 240;
    ctx.save(); ctx.filter = `blur(${(2 + z * 0.1) * this.px}px)`;
    ctx.fillStyle = `rgba(30,28,22,${clamp(0.42 - z * 0.006, 0.12, 0.42)})`;
    ctx.beginPath(); ctx.ellipse(b.x + 3 + z * 0.2, b.y + 4 + z * 0.16, R * (1 + z * 0.004), R * 0.92, 0, 0, TAU); ctx.fill();
    ctx.restore();
    const bx = b.x, by = b.y - z * 0.6 - 1;
    const g = ctx.createRadialGradient(bx - R * 0.4 * k, by - R * 0.45 * k, R * 0.05, bx, by, R * k);
    g.addColorStop(0, '#6a6a6e'); g.addColorStop(0.3, '#2c2c2f'); g.addColorStop(1, '#09090a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, R * k, 0, TAU); ctx.fill();
    // the two yellow dots of a squash ball, carried round as it rolls
    ctx.save(); ctx.beginPath(); ctx.arc(bx, by, R * k, 0, TAU); ctx.clip();
    for (const off of [0, 0.5]) {
      const a = b.spin + off, c = Math.cos(a);
      if (c > -0.2) { ctx.fillStyle = `rgba(242,194,26,${clamp(c + 0.3)})`; ctx.beginPath(); ctx.ellipse(bx + Math.sin(a) * R * 0.72 * k, by + (off ? 2.5 : -1.5) * k, 1.5 * k * Math.max(0.35, c), 1.5 * k, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(bx - R * 0.36 * k, by - R * 0.44 * k, R * 0.2 * k, R * 0.12 * k, -0.6, 0, TAU); ctx.fill();
    return live;
  }
}
customElements.define('ball-calendar', BallCalendar);
// #endregion ball-calendar
