// ui-feed/sundial.js: a time input drawn as a sundial, rebuilt from a demo on ui-feed.dev.
//
//   <sundial-time>  an <input type="time"> over a stone sundial seen at an angle. The gnomon's shadow
//                   falls on the hour the field holds, worked out from where the sun is at that hour, and
//                   a drag on the dial moves the shadow and sets the field.
//
// A FeedControl (kit.js): one drawable 2D canvas in the shadow root, with the native elements as its
// children. The original is credited on /sundial-time/.

import { FeedControl, put, hit, esc, clamp, lerp, rr, spring, TAU } from './kit.js';

const MONO = "'IBM Plex Mono', 'JetBrains Mono', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const local = (el, e) => { const r = el.canvas.getBoundingClientRect(), k = r.width / el.constructor.size[0]; return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };
const RAD = Math.PI / 180;
const toMin = (v) => { const m = /^(\d\d):(\d\d)/.exec(v ?? ''); return m ? +m[1] * 60 + +m[2] : NaN; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(Math.round(m % 60)).padStart(2, '0')}`;

// A picture painted once and kept until the device pixel ratio changes (the same as cached() in folds.js,
// which is not imported because that file defines five other elements).
function cached(ctrl, key, w, h, paint) {
  const store = ctrl.pictures ??= new Map(), px = ctrl.px;
  let c = store.get(key);
  if (!c || c.px !== px) {
    c = { px, canvas: c?.canvas ?? document.createElement('canvas') };
    c.canvas.width = Math.ceil(w * px); c.canvas.height = Math.ceil(h * px);
    const g = c.canvas.getContext('2d'); g.scale(px, px); paint(g);
    store.set(key, c);
  }
  return c.canvas;
}

// A small seeded random number source, so the stone's grain is the same on every load.
function grain(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

export class SundialTime extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  // The dial: its centre on the canvas, its radius, how much the view squashes it, and which way north
  // (the noon line, where the gnomon stands) points on the face, in degrees from the canvas's x axis.
  static DIAL = { cx: 180, cy: 222, r: 156, squash: 0.76, north: -68, edge: 10 };
  static css = `
    input { width: auto; height: 46px; padding: 0 16px; border: 1px solid #dedbd4; border-radius: 12px; background: #fff;
      color: #111; font: 500 24px/44px ${MONO}; letter-spacing: 0.02em; font-variant-numeric: tabular-nums; outline: 0; }
    input::-webkit-calendar-picker-indicator { display: none; }
    input::-webkit-datetime-edit-fields-wrapper { padding: 0; }
    input:invalid { border-color: #c0392b; }
    .dial { width: 330px; height: 250px; touch-action: none; cursor: grab; }
    .dial:active { cursor: grabbing; }`;

  ready() {
    this.shown = { x: 0, v: 0 };
    this.build();
  }

  // #region sundial-time
  build() {
    const box = this.canvas ?? this.$('.plain');
    this.lat = +(this.getAttribute('latitude') ?? 51.5);
    this.dec = +(this.getAttribute('declination') ?? 18);   // how high the sun is in the sky that day: 18° is mid-May or late July
    const min = this.getAttribute('min') ?? '05:00', max = this.getAttribute('max') ?? '19:00';
    // The field is the control: its value, its keys, its range and what a screen reader says.
    this.input = node(`<input type="time" step="60" min="${esc(min)}" max="${esc(max)}" value="${esc(this.getAttribute('value') ?? '15:20')}" aria-label="${esc(this.getAttribute('label') ?? 'Time')}">`);
    // An empty element over the dial takes the drags. It is hidden from assistive technology: the field
    // already does what it does.
    this.dial = node('<div class="dial" aria-hidden="true"></div>');
    box.replaceChildren(this.input, this.dial);
    this.input.addEventListener('input', () => this.sync());
    // A change event does not leave the shadow root, so the host sends its own for the form around it.
    this.input.addEventListener('change', () => { this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    let drag = null;
    const set = (e) => {
      const m = this.minutesAt(local(this, e));
      if (Number.isNaN(m)) return;
      const lo = toMin(this.input.min), hi = toMin(this.input.max), v = toTime(clamp(Math.round(m), lo, hi));
      if (v === this.input.value) return;
      this.input.value = v;
      this.input.dispatchEvent(new Event('input', { bubbles: true }));
      drag.changed = true;
    };
    this.dial.addEventListener('pointerdown', (e) => { e.preventDefault(); drag = {}; try { this.dial.setPointerCapture(e.pointerId); } catch {} set(e); });
    this.dial.addEventListener('pointermove', (e) => { if (drag) set(e); });
    const end = () => { if (drag?.changed) this.input.dispatchEvent(new Event('change', { bubbles: true })); drag = null; };
    this.dial.addEventListener('pointerup', end); this.dial.addEventListener('pointercancel', end);
    this.shown.x = toMin(this.input.value) || 12 * 60;
    this.sync();
  }
  get minutes() { return toMin(this.input.value); }
  sync() {
    const m = this.minutes;
    this.setValue(this.input.value);
    try { this.internals?.setValidity(this.input.validity.valid ? {} : { rangeUnderflow: this.input.validity.rangeUnderflow, rangeOverflow: this.input.validity.rangeOverflow, badInput: this.input.validity.badInput }, this.input.validationMessage, this.input); } catch {}
    if (Number.isNaN(m)) return;
    this.request();
  }

  // Where the sun is at a time of day, as (east, north, up). The hour angle is 15° for each hour from noon.
  sun(minutes) {
    const H = (minutes / 60 - 12) * 15 * RAD, f = this.lat * RAD, d = this.dec * RAD;
    return { e: -Math.cos(d) * Math.sin(H), n: Math.cos(f) * Math.sin(d) - Math.sin(f) * Math.cos(d) * Math.cos(H), up: Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H) };
  }
  // The angle of an hour line from north, towards east: tan(angle) = sin(latitude) × tan(hour angle).
  hourLine(minutes) { const H = (minutes / 60 - 12) * 15 * RAD; return Math.atan2(Math.sin(this.lat * RAD) * Math.sin(H), Math.cos(H)); }
  // The other way: the time whose hour line passes through a point on the canvas.
  minutesAt(p) {
    const D = SundialTime.DIAL, x = p.x - D.cx, y = (p.y - D.cy) / D.squash;
    if (Math.hypot(x, y) < 12) return NaN;
    const n = D.north * RAD, along = x * Math.cos(n) + y * Math.sin(n), east = -x * Math.sin(n) + y * Math.cos(n);
    const a = Math.atan2(east, along), H = Math.atan2(Math.sin(a), Math.sin(this.lat * RAD) * Math.cos(a));
    return 12 * 60 + H / RAD / 15 * 60;
  }
  // A point on the face, given east and north in the dial's own units, to canvas units.
  at(e, n) {
    const D = SundialTime.DIAL, a = D.north * RAD;
    const x = n * Math.cos(a) - e * Math.sin(a), y = n * Math.sin(a) + e * Math.cos(a);
    return [D.cx + x, D.cy + y * D.squash];
  }
  // A point a distance along an hour line.
  onLine(angle, d) { return this.at(Math.sin(angle) * d, Math.cos(angle) * d); }

  // The stone, the engraving and the numbers do not change, so they are painted once into a picture.
  face(g, w, h) {
    const D = SundialTime.DIAL, R = D.r;
    const disc = (dy = 0, r = R) => { g.beginPath(); g.ellipse(D.cx, D.cy + dy, r, r * D.squash, 0, 0, TAU); };
    // the edge of the slab, then its top
    disc(D.edge); g.fillStyle = '#b9b5ad'; g.fill();
    g.fillRect(D.cx - R, D.cy, R * 2, D.edge); disc(); g.fillStyle = '#dcd9d2'; g.fill();
    // grain: a few thousand specks, light and dark, clipped to the top
    g.save(); disc(); g.clip();
    const rnd = grain(7);
    for (let i = 0; i < 2600; i++) {
      const x = D.cx + (rnd() * 2 - 1) * R, y = D.cy + (rnd() * 2 - 1) * R * D.squash, s = rnd() * 1.4 + 0.3;
      g.fillStyle = rnd() < 0.5 ? `rgba(120,112,100,${0.08 + rnd() * 0.16})` : `rgba(255,255,255,${0.15 + rnd() * 0.3})`;
      g.fillRect(x, y, s, s);
    }
    // a soft light from the top left of the slab
    const lit = g.createRadialGradient(D.cx - R * 0.4, D.cy - R * 0.3, 10, D.cx, D.cy, R * 1.1);
    lit.addColorStop(0, 'rgba(255,255,255,0.22)'); lit.addColorStop(1, 'rgba(0,0,0,0.04)');
    g.fillStyle = lit; g.fillRect(0, 0, w, h);
    g.restore();
    // the engraving: a rim line, the ring of minute marks, and the hour lines
    g.strokeStyle = 'rgba(60,56,50,0.55)'; g.lineCap = 'round';
    g.lineWidth = 0.8; disc(0, R * 0.965); g.stroke();
    disc(0, R * 0.72); g.stroke();
    for (let m = 5 * 60; m <= 19 * 60; m += 10) {
      const a = this.hourLine(m), hour = m % 60 === 0, half = m % 30 === 0;
      const [x0, y0] = this.onLine(a, hour ? R * 0.28 : R * (half ? 0.64 : 0.67)), [x1, y1] = this.onLine(a, R * 0.72);
      g.lineWidth = hour ? 1.1 : 0.7; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    }
    // the numbers, upright, at the end of each hour line
    g.fillStyle = 'rgba(55,52,47,0.85)'; g.font = `400 15px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let hr = 5; hr <= 19; hr++) { const [x, y] = this.onLine(this.hourLine(hr * 60), R * 0.84); g.fillText(String(hr), x, y); }
    // the latitude, on the south side of the face
    g.font = `400 11px ${MONO}`; g.fillStyle = 'rgba(55,52,47,0.75)';
    const deg = Math.floor(this.lat), mins = Math.round((this.lat - deg) * 60), [lx, ly] = this.at(0, -R * 0.46);
    g.save(); g.translate(lx, ly); g.scale(1, 0.85); g.fillText(`${deg}°${String(mins).padStart(2, '0')}′ N`, 0, 0); g.restore();
  }

  draw(ctx, w, h) {
    const D = SundialTime.DIAL, R = D.r, target = this.minutes;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    // The shadow turns to the new time rather than jumping, so typing a time sweeps it round.
    const moving = Number.isNaN(target) ? false : spring(this.shown, target, this.dt, 120, 20);
    const t = this.shown.x, s = this.sun(t), up = Math.max(0.02, s.up);
    // How far the shadow of a point one unit high falls, east and north: away from the sun.
    const k = 1 / up, se = -s.e * k, sn = -s.n * k;
    const low = clamp(1 - up / 0.5);     // 1 when the sun is near the horizon

    // the slab's own shadow on the ground
    const reach = Math.min(24, 8 * Math.hypot(se, sn)) / Math.max(1e-6, Math.hypot(se, sn));
    const [gx, gy] = this.at(se * reach, sn * reach);
    ctx.save(); ctx.filter = 'blur(14px)'; ctx.fillStyle = `rgba(70,74,90,${lerp(0.22, 0.32, low)})`;
    ctx.beginPath(); ctx.ellipse(gx, gy + D.edge + 4, R * 1.02, R * D.squash * 1.02, 0, 0, TAU); ctx.fill();
    ctx.restore();
    ctx.drawImage(cached(this, 'face', w, h, (g) => this.face(g, w, h)), 0, 0, w, h);

    // The light warms and dims towards dawn and dusk.
    ctx.save(); ctx.beginPath(); ctx.ellipse(D.cx, D.cy, R, R * D.squash, 0, 0, TAU); ctx.clip();
    if (low > 0) { ctx.fillStyle = `rgba(255,170,90,${0.2 * low})`; ctx.fillRect(0, 0, w, h); }

    // The gnomon stands on the noon line: its sloping edge points at the pole, so its height over its
    // foot is the foot's distance times tan(latitude).
    const foot = R * 0.6, height = foot * Math.tan(this.lat * RAD);
    const O = this.at(0, 0), F = this.at(0, foot);
    // where the top of the gnomon's shadow falls on the face
    const S = this.at(se * height, foot + sn * height);
    ctx.filter = 'blur(1.2px)';
    ctx.fillStyle = `rgba(38,36,34,${lerp(0.62, 0.3, low)})`;
    ctx.beginPath(); ctx.moveTo(...O); ctx.lineTo(...F); ctx.lineTo(...S); ctx.closePath(); ctx.fill();
    ctx.filter = 'none';
    ctx.restore();

    // the gnomon itself, a plate with two faces: the one towards us is lit in the morning and dark after noon
    const lift = Math.sqrt(1 - D.squash * D.squash);   // how much of a height the view shows: the face is seen from about 50° up
    const T = [F[0], F[1] - height * lift];
    const after = clamp(0.5 - s.e * 1.5), lit = Math.round(lerp(236, 74, after));
    const thick = 4;
    ctx.fillStyle = '#c8c4bb';
    ctx.beginPath(); ctx.moveTo(O[0], O[1]); ctx.lineTo(T[0], T[1]); ctx.lineTo(T[0] + thick, T[1] + 1); ctx.lineTo(O[0] + thick, O[1] + 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = `rgb(${lit},${lit - 3},${lit - 8})`;
    ctx.beginPath(); ctx.moveTo(...O); ctx.lineTo(...F); ctx.lineTo(...T); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...O); ctx.lineTo(...T); ctx.stroke();

    // The field sits in the middle at the top, at its own width (it is wider where the locale shows AM and PM).
    const iw = this.input.offsetWidth, ih = this.input.offsetHeight;
    put(ctx, this.input, (w - iw) / 2, 16, iw, ih);
    if (this.shadowRoot.activeElement === this.input) { ctx.save(); ctx.strokeStyle = '#111'; ctx.lineWidth = 2; rr(ctx, (w - iw) / 2 - 3, 13, iw + 6, ih + 6, 15); ctx.stroke(); ctx.restore(); }
    hit(ctx, this.dial, D.cx - this.dial.offsetWidth / 2, D.cy - this.dial.offsetHeight / 2);
    return moving;
  }
  // #endregion sundial-time
}

customElements.define('sundial-time', SundialTime);
