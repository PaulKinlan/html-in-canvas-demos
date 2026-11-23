// ui-feed/switches.js: checkboxes drawn as physical switches. Each is a rebuild, in HTML-in-canvas, of a demo
// on https://ui-feed.dev/ (the page that uses them links to each original).
//
//   <mercury-switch name="heating" checked>Heating</mercury-switch>
//   <cradle-switch name="dnd">Do not disturb</cradle-switch>
//   <rocker-switch name="porch">Porch</rocker-switch>
//   <frost-switch name="frost">Frost alarm</frost-switch>
//   <clay-switch name="quiet">Do not disturb</clay-switch>
//   <omr-sheet name="shift" columns="Morning Afternoon Evening"><option value="mon">Monday</option>…</omr-sheet>
//
// Every switch holds one <input type="checkbox" role="switch"> inside its canvas. The canvas draws a model
// (a vial of mercury, a row of steel balls, a rocker) from the input's `checked`, and puts the input's hit
// region over the part of the drawing that a finger would press. Space, Tab, a tap and a form submit all
// go to the input. The label is the element's own text, slotted into a <label> that the canvas draws.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, seg7Text, TAU, reduced } from './kit.js';

// #region switch-base
class SwitchControl extends FeedControl {
  static html = `<input type="checkbox" role="switch" id="c"><label for="c"><slot></slot></label><output aria-hidden="true"></output>`;
  static observedAttributes = ['checked'];

  ready() {
    this.input = this.$('input'); this.label = this.$('label'); this.out = this.$('output');
    this.input.checked = this.hasAttribute('checked');
    this.pos = { x: this.input.checked ? 1 : 0, v: 0 };
    this.input.addEventListener('change', () => { this.changed = performance.now(); this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.sync();
  }
  attributeChangedCallback() { if (this.input) this.checked = this.hasAttribute('checked'); }
  get checked() { return this.input?.checked ?? this.hasAttribute('checked'); }
  set checked(v) { if (this.input.checked !== !!v) { this.input.checked = !!v; this.changed = performance.now(); } this.sync(); }
  sync() {
    this.setValue(this.input.checked ? this.getAttribute('value') ?? 'on' : null);
    if (this.out) this.out.textContent = this.input.checked ? 'On' : 'Off';
    this.input.ariaLabel = this.textContent.trim() || null;
    this.request();
  }
  // a ring where the input was put, when it has keyboard focus
  ring(ctx, x, y, w, h, r, colour = '#fff') {
    if (!this.input.matches(':focus-visible')) return;
    ctx.save(); ctx.strokeStyle = colour; ctx.lineWidth = 3; ctx.setLineDash([6, 5]); rr(ctx, x, y, w, h, r); ctx.stroke(); ctx.restore();
  }
}
// #endregion switch-base

// A chrome ball: a bright highlight above the centre, a dark equator, and light bounced up from below.
const ball = (ctx, x, y, r, tint = '#cfd3d8') => {
  const g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.45, r * 0.04, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.22, tint); g.addColorStop(0.62, '#8d939b');
  g.addColorStop(0.82, '#4a4e55'); g.addColorStop(0.93, '#6b7079'); g.addColorStop(1, '#2f3238');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  // the floor reflected in the lower third, and one specular dot
  const f = ctx.createLinearGradient(0, y + r * 0.3, 0, y + r);
  f.addColorStop(0, 'rgba(255,255,255,0)'); f.addColorStop(1, 'rgba(255,255,255,0.32)');
  ctx.save();
  ctx.beginPath(); ctx.arc(x, y, r * 0.98, 0, TAU); ctx.clip();
  ctx.fillStyle = f; ctx.fillRect(x - r, y + r * 0.3, r * 2, r * 0.7);
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath(); ctx.ellipse(x - r * 0.34, y - r * 0.44, r * 0.17, r * 0.12, -0.6, 0, TAU); ctx.fill();
};

// #region mercury-switch
// The mercury is a one-dimensional shallow-water simulation along the tube: 56 columns of metal, each with a
// depth and a speed along the glass. The tilt gives gravity a component along the tube, the difference in depth
// between neighbours gives the pressure, so the metal runs downhill, piles against the end wall, rebounds and
// sloshes back before it settles. Mercury does not wet glass, so a column thinner than a bead is pulled into
// its fuller neighbour, which is what makes the tail break off into separate beads.
export class MercurySwitch extends SwitchControl {
  static size = [360, 340];
  static N = 56;                 // columns
  static L = 134;                // half the length of the tube, in design units
  static T = 31;                 // half its height
  static PAD = 10;               // glass at each end
  static FILL = 0.55;            // the share of the tube the metal fills
  static G = 2600;               // gravity, design units per second squared
  static FILM = 0.4;             // the depth left everywhere, so that the scheme has no dry front to stall at
  static css = `
    input { width: 240px; height: 200px; opacity: 0; touch-action: manipulation; }
    label { font: 26px Georgia, 'Times New Roman', serif; color: #f3efe2; white-space: nowrap; }
    output { font: italic 26px Georgia, 'Times New Roman', serif; color: #f3efe2; width: 60px; text-align: right; }`;

  ready() {
    super.ready();
    const { N, L, PAD, T, FILL } = MercurySwitch;
    this.Hy = 2 * (T - 5);                       // the inside height of the tube
    this.Lx = 2 * (L - PAD);                     // its inside length
    this.h = new Float32Array(N);
    this.u = new Float32Array(N + 1);
    this.f = new Float32Array(N + 1);
    this.vz = new Float32Array(N);
    this.was = new Float32Array(N);
    this.calm = 0; this.frozen = null;
    this.pour(this.checked ? 1 : -1);
    this.fill = FILL * N * this.Hy;              // the volume, in column depths
  }
  // The metal at rest against one end, which is where it starts and where reduced motion puts it.
  pour(side) {
    const { N, FILL } = MercurySwitch;
    this.h.fill(0); this.u.fill(0);
    this.h.fill(MercurySwitch.FILM);
    let left = FILL * N * this.Hy - N * MercurySwitch.FILM;
    for (let k = 0; k < N && left > 0; k++) {
      const i = side > 0 ? N - 1 - k : k;
      const add = Math.min(this.Hy - MercurySwitch.FILM, left);
      this.h[i] += add; left -= add;
    }
  }
  // Where the metal is: `at` is its centre of mass as a fraction of the tube from the far end, and `made` is
  // true while it lies across both contacts. The lamp is lit from this, not from the checkbox.
  get pool() {
    const N = MercurySwitch.N;
    let m = 0, c = 0;
    for (let i = 0; i < N; i++) { m += this.h[i]; c += (this.h[i] * (i + 0.5)) / N; }
    return { at: m ? c / m : 0.5, made: this.h[N - 1] > this.Hy * 0.45, beads: this.runs().length };
  }
  // One step of the simulation. u lives on the faces between columns, h in the columns.
  sim(dt, angle) {
    const { N, G } = MercurySwitch;
    const h = this.h, u = this.u, f = this.f, dx = this.Lx / N;
    // Settled, at a tilt it has already settled at: there is nothing to work out, so the control asks for no
    // more frames until the tilt changes.
    if (this.frozen !== null && Math.abs(angle - this.frozen) < 0.0005) return 0;
    const ax = Math.sin(angle) * G, gy = Math.cos(angle) * G;
    const steps = 4, sdt = Math.min(dt, 1 / 50) / steps;
    for (let s = 0; s < steps; s++) {
      for (let i = 1; i < N; i++) {
        u[i] += sdt * (ax - (gy * (h[i] - h[i - 1])) / dx);
        u[i] -= u[i] * 2.4 * sdt;                                  // the metal drags on the glass
      }
      u[0] = 0; u[N] = 0;
      for (let i = 0; i <= N; i++) f[i] = u[i] * (u[i] > 0 ? (i > 0 ? h[i - 1] : 0) : (i < N ? h[i] : 0));
      for (let i = 0; i < N; i++) h[i] = Math.max(MercurySwitch.FILM, h[i] - (sdt * (f[i + 1] - f[i])) / dx);
      // The tube has a lid: a column that would overfill pushes the rest into whichever neighbour has room.
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < N; i++) {
          const over = h[i] - this.Hy;
          if (over <= 0) continue;
          const l = i > 0 ? this.Hy - h[i - 1] : 0, r = i < N - 1 ? this.Hy - h[i + 1] : 0;
          if (l + r <= 0.001) continue;
          h[i] = this.Hy;
          if (l > 0) h[i - 1] += (over * l) / (l + r);
          if (r > 0) h[i + 1] += (over * r) / (l + r);
        }
      }
      // Mercury does not wet glass: it holds together as a slug and beads rather than spreading into a film.
      // Every column shallower than a third of the tube is pulled towards its fuller neighbour, which is the
      // stand-in for surface tension here, and is what keeps the metal in one piece as it runs.
      const pull = Math.min(1, 6 * sdt);
      for (let i = 0; i < N; i++) {
        if (h[i] <= 0 || h[i] > this.Hy * 0.3) continue;
        const l = i > 0 ? h[i - 1] : -1, r = i < N - 1 ? h[i + 1] : -1;
        if (Math.max(l, r) <= h[i]) continue;
        // The pull is in proportion to how fast the metal is running, so it holds the slug together while it
        // moves and does nothing once it has settled. A pull that kept working at rest would fight gravity for
        // ever: the column it empties is the one gravity then fills again, and the control never stops asking
        // for frames.
        const speed = Math.min(1, Math.max(Math.abs(u[i]), Math.abs(u[i + 1])) / 50);
        if (speed < 0.02) continue;
        const j = l > r ? i - 1 : i + 1;
        const give = h[i] * pull * speed;
        h[i] -= give; h[j] = Math.min(this.Hy, h[j] + give);
      }
      for (let i = 1; i < N; i++) if (Math.abs(u[i]) < 2) u[i] *= 1 - 6 * sdt;   // the last of the motion dies
      // A little viscosity, so the columns cannot ring against each other at the width of one column. It is
      // worked out from a copy and has no flux at the two ends, so it moves metal about without losing any:
      // in place, against the depths it has already changed, it leaks, and the volume has to be put back every
      // frame, which pumps the taper up until gravity pushes it down again and nothing ever settles.
      const visc = Math.min(0.2, 4 * sdt), vz = this.vz;
      vz.set(h);
      for (let i = 0; i < N; i++) {
        const l = i > 0 ? vz[i - 1] : vz[i], r = i < N - 1 ? vz[i + 1] : vz[i];
        h[i] = vz[i] + (l + r - 2 * vz[i]) * visc;
      }
    }
    // A trace of metal left behind on the glass is not a bead: mercury pulls itself off a surface it does not
    // wet, so anything shallower than a bead is given back to the body of the slug.
    for (const [p, q] of this.runs()) {
      let crest = 0, rush = 0;
      for (let i = p; i <= q; i++) { crest = Math.max(crest, h[i]); rush = Math.max(rush, Math.abs(u[i])); }
      if (crest >= 7 || rush < 20) continue;
      let mass = 0, best = 0;
      for (let i = p; i <= q; i++) { mass += h[i]; h[i] = 0; }
      for (let i = 0; i < N; i++) if (h[i] > h[best]) best = i;
      h[best] = Math.min(this.Hy, h[best] + mass);
    }
    // What drift is left is corrected, outside a dead band, by sharing it between the columns that have room
    // for it rather than by scaling every column.
    let tot = 0;
    for (let i = 0; i < N; i++) tot += h[i];
    const diff = this.fill - tot;
    if (Math.abs(diff) > 0.4) {
      let room = 0;
      for (let i = 0; i < N; i++) room += diff > 0 ? this.Hy - h[i] : h[i];
      if (room > 0.001) for (let i = 0; i < N; i++) h[i] += (diff * (diff > 0 ? this.Hy - h[i] : h[i])) / room;
    }
    // How much the picture moved, which is what decides whether the control asks for another frame. The speed
    // on the faces is no use for that: a face between a full column and a dry one keeps a standing speed that
    // moves no metal, because the column it would draw from is empty.
    let change = 0;
    for (let i = 0; i < N; i++) {
      if (!Number.isFinite(h[i])) h[i] = 0;                        // a step that overshot cannot poison the draw
      else h[i] = Math.min(this.Hy, Math.max(MercurySwitch.FILM, h[i]));
      change += Math.abs(h[i] - this.was[i]); this.was[i] = h[i];
    }
    // A settled slug still trades a fiftieth of a pixel a column between neighbours for ever. Once the picture
    // has been still for a third of a second the speeds are set to zero, which holds because at rest the tilt
    // and the slope of the surface cancel. Any change in the tilt unbalances them and it runs again.
    this.calm = change < 6 ? this.calm + 1 : 0;      // a tenth of a pixel a column
    if (this.calm > 15) { u.fill(0); this.calm = 16; this.frozen = angle; return 0; }
    this.frozen = null;
    return change;
  }
  // The runs of metal, as lists of columns with something in them. Two runs means a bead has broken off.
  runs() {
    const N = MercurySwitch.N, out = [];
    let a = -1;
    for (let i = 0; i < N; i++) {
      const wet = this.h[i] > 2.5;
      if (wet && a < 0) a = i;
      else if (!wet && a >= 0) { out.push([a, i - 1]); a = -1; }
    }
    if (a >= 0) out.push([a, N - 1]);
    return out;
  }

  draw(ctx, w, h) {
    const on = this.checked, { N, L, T, PAD } = MercurySwitch;
    let moving = spring(this.pos, on ? 1 : 0, this.dt, 60, 9);
    const angle = lerp(-0.5, 0.5, this.pos.x);        // a tilt switch tilts: 29 degrees either way
    if (reduced()) { this.pour(on ? 1 : -1); }
    else if (this.sim(this.dt, angle) > 0.5) moving = true;       // half a pixel across all 56 columns
    const made = this.pool.made;                      // the lamp is lit from the metal, not the checkbox

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#17494b'); bg.addColorStop(1, '#092328');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    const cx = 180, cy = 118;
    const brass = ctx.createLinearGradient(60, 90, 300, 260);
    brass.addColorStop(0, '#f1d98a'); brass.addColorStop(0.5, '#a9842f'); brass.addColorStop(1, '#e3c873');

    // the base plate and the post the tube pivots on
    ctx.save();
    ctx.shadowColor = '#0007'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
    ctx.fillStyle = brass;
    ctx.beginPath();
    ctx.moveTo(168, 244); ctx.lineTo(192, 244); ctx.lineTo(188, cy); ctx.lineTo(172, cy); ctx.closePath(); ctx.fill();
    rr(ctx, 64, 240, 232, 18, 7); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#00000022'; rr(ctx, 64, 252, 232, 6, 3); ctx.fill();

    // the lamp, and the two flexible leads from the contacts at the far end of the tube
    const px = cx + Math.cos(angle) * (L - PAD + 4), py = cy + Math.sin(angle) * (L - PAD + 4);
    const lx = 236, ly = 218;                                 // the lamp, standing on the base plate
    ctx.strokeStyle = '#9aa1a8'; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (const dy of [-9, 9]) {
      const sx = px - Math.sin(angle) * dy, sy = py + Math.cos(angle) * dy;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(sx + 30, sy + 46, lx + dy * 0.7, ly + 12); ctx.stroke();
    }
    if (made) {
      const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, 54);
      glow.addColorStop(0, '#ffc566dd'); glow.addColorStop(0.5, '#ff9c2a55'); glow.addColorStop(1, '#ff9c2a00');
      ctx.fillStyle = glow; ctx.fillRect(lx - 54, ly - 54, 108, 108);
    }
    ctx.fillStyle = brass;
    rr(ctx, lx - 5, ly + 14, 10, 16, 2); ctx.fill();                   // the post up from the plate
    rr(ctx, lx - 12, ly + 4, 24, 14, 3); ctx.fill();                   // the holder
    const by = ly - 7;
    const jewel = ctx.createRadialGradient(lx - 5, by - 4, 1, lx, by, 15);
    jewel.addColorStop(0, made ? '#fffbe8' : '#b4834a'); jewel.addColorStop(0.45, made ? '#ffc247' : '#8a5c27');
    jewel.addColorStop(1, made ? '#e8700f' : '#4d2d11');
    ctx.fillStyle = jewel; ctx.beginPath(); ctx.arc(lx, by, 14, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#00000055'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(lx, by, 14, 0, TAU); ctx.stroke();
    if (made) { ctx.fillStyle = '#fff7d6'; ctx.beginPath(); ctx.ellipse(lx - 5, by - 5, 4, 2.6, -0.7, 0, TAU); ctx.fill(); }

    // the tube, turned on its pivot
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(angle);
    // the glass, and the metal inside it
    ctx.save();
    ctx.beginPath(); rr(ctx, -L, -T, L * 2, T * 2, T); ctx.clip();
    const tube = ctx.createLinearGradient(0, -T, 0, T);
    tube.addColorStop(0, 'rgba(255,255,255,0.20)'); tube.addColorStop(0.45, 'rgba(160,200,205,0.06)');
    tube.addColorStop(1, 'rgba(255,255,255,0.16)');
    ctx.fillStyle = tube; ctx.fillRect(-L, -T, L * 2, T * 2);

    const x0 = -(L - PAD), dx = this.Lx / N, floor = this.Hy / 2;
    // The surface is smoothed for the drawing only, over three columns and twice, so that the light along it
    // reads as one curve. The simulation keeps its own depths.
    const sm = this.sm || (this.sm = new Float32Array(N));
    sm.set(this.h);
    for (let pass = 0; pass < 2; pass++) {
      let prev = sm[0];
      for (let i = 1; i < N - 1; i++) { const was = sm[i]; sm[i] = (prev + was * 2 + sm[i + 1]) / 4; prev = was; }
    }
    const sx = (i) => x0 + (i + 0.5) * dx, sy = (i) => floor - sm[i];
    for (const [a, b] of this.runs()) {
      const left = Math.max(x0, sx(a) - dx * 0.5), right = Math.min(-x0, sx(b) + dx * 0.5);
      // The chrome runs from the top of this run of metal to the floor, so that a shallow run is lit like a
      // deep one instead of taking only the dark end of one gradient down the whole tube.
      let crest = floor;
      for (let i = a; i <= b; i++) crest = Math.min(crest, sy(i));
      const metal = ctx.createLinearGradient(0, crest, 0, floor + 2);
      metal.addColorStop(0, '#f6f9fa'); metal.addColorStop(0.18, '#ced4da'); metal.addColorStop(0.5, '#6f767e');
      metal.addColorStop(0.8, '#383d43'); metal.addColorStop(0.94, '#5b6168'); metal.addColorStop(1, '#aab0b7');
      ctx.beginPath();
      ctx.moveTo(left, floor);
      ctx.lineTo(right, floor);
      ctx.quadraticCurveTo(right, sy(b), sx(b), sy(b));          // the meniscus at the near end
      for (let i = b - 1; i >= a; i--) {
        const mx = (sx(i) + sx(i + 1)) / 2, my = (sy(i) + sy(i + 1)) / 2;
        ctx.quadraticCurveTo(sx(i + 1), sy(i + 1), mx, my);
      }
      ctx.quadraticCurveTo(sx(a), sy(a), left, Math.min(floor, sy(a) + dx * 0.5));
      ctx.closePath();
      ctx.fillStyle = metal; ctx.fill();
      // the light along the surface, and the dark line where the metal meets the glass
      ctx.save(); ctx.clip();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
      let lit = false;                                   // only over the body, not the thin edge
      ctx.beginPath();
      for (let i = a; i < b; i++) {
        if (sm[i] < 9 || sm[i + 1] < 9) { lit = false; continue; }
        const mx = (sx(i) + sx(i + 1)) / 2, my = (sy(i) + sy(i + 1)) / 2 + 2;
        if (!lit) { ctx.moveTo(sx(i), sy(i) + 2); lit = true; }
        ctx.quadraticCurveTo(sx(i), sy(i) + 2, mx, my);
      }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(left, floor - 3); ctx.lineTo(right, floor - 3); ctx.stroke();
      ctx.restore();
    }
    // the glass over the metal: one streak along the top, one dim edge along the bottom
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-L + 30, -T + 9); ctx.lineTo(L - 46, -T + 9); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-L + 34, T - 8); ctx.lineTo(L - 34, T - 8); ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(226,240,243,0.75)'; ctx.lineWidth = 2;
    rr(ctx, -L, -T, L * 2, T * 2, T); ctx.stroke();

    // the two contacts, sealed into the far end
    ctx.strokeStyle = '#c3c8cd'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (const dy of [-9, 9]) { ctx.beginPath(); ctx.moveTo(L - PAD - 26, dy); ctx.lineTo(L - PAD + 4, dy); ctx.stroke(); }
    if (made) {
      ctx.fillStyle = '#ffd98a';
      for (const dy of [-9, 9]) { ctx.beginPath(); ctx.arc(L - PAD - 26, dy, 3, 0, TAU); ctx.fill(); }
    }
    // the collar that holds the tube to the post
    ctx.fillStyle = brass; rr(ctx, -13, -T - 3, 26, T * 2 + 6, 4); ctx.fill();
    ctx.fillStyle = '#00000033'; rr(ctx, -13, -T - 3, 26, 5, 2); ctx.fill();
    ctx.fillStyle = '#6b5420'; ctx.beginPath(); ctx.arc(0, 0, 4.5, 0, TAU); ctx.fill();
    ctx.restore();

    hit(ctx, this.input, cx - 150, cy - 66, 300, 150);
    this.ring(ctx, cx - 150, cy - 66, 300, 150, 24);
    put(ctx, this.label, 28, 286);
    put(ctx, this.out, w - 28 - 60, 286);
    return moving;
  }
}
customElements.define('mercury-switch', MercurySwitch);
// #endregion mercury-switch

// #region cradle-switch
// The thumb is the ball in the middle, and it is what swings the row: toggling sends it across its track,
// where it strikes the pair on that side and the impulse passes through the near ball to the far one.
export class CradleSwitch extends SwitchControl {
  static size = [360, 330];
  static css = `
    input { width: 300px; height: 96px; opacity: 0; touch-action: manipulation; }
    label { font: 30px Georgia, 'Times New Roman', serif; color: #2b2a27; white-space: nowrap; }
    output { font: italic 30px Georgia, 'Times New Roman', serif; color: #2b2a27; width: 60px; text-align: right; }`;

  static R = 21;              // ball radius
  static L = 150;             // thread length
  static TOP = 34;            // the rail
  static TRAVEL = 42;         // how far the thumb slides, one ball
  static SPEED = 230;         // px a second, the speed the thumb crosses at
  static G = 2600;            // gravity, px a second squared

  ready() {
    super.ready();
    // p is where the thumb is in its track, 0 to 1. a and w are the angle and the angular speed of the two
    // outer balls, the left one first. The inner balls never move: they pass the impulse on.
    this.sim = { p: this.checked ? 1 : 0, v: 0, a: [0, 0], w: [0, 0] };
    this.input.addEventListener('change', () => {
      this.sim.v = (this.checked ? 1 : -1) * CradleSwitch.SPEED;
      this.request();
    });
  }

  // The thumb reaches the end of its track and hits the near ball. A row of touching balls passes the blow
  // through, so it is the outer ball that leaves: side 1 is the right pair, side 0 the left.
  strike(side, speed) {
    const { L } = CradleSwitch;
    this.sim.w[side] = (side ? 1 : -1) * (speed / L) * 0.95;
  }

  step() {
    const { L, TRAVEL, G } = CradleSwitch, s = this.sim, dt = Math.min(this.dt, 1 / 60);
    if (reduced()) { s.p = this.checked ? 1 : 0; s.v = 0; s.a = [0, 0]; s.w = [0, 0]; return false; }
    let live = false;
    if (s.v) {
      s.p += (s.v * dt) / TRAVEL;
      if (s.p >= 1) { s.p = 1; this.strike(1, s.v); s.v = 0; }
      else if (s.p <= 0) { s.p = 0; this.strike(0, -s.v); s.v = 0; }
      live = true;
    }
    for (let k = 0; k < 2; k++) {
      if (!s.w[k] && !s.a[k]) continue;
      s.w[k] += (-(G / L) * Math.sin(s.a[k]) - 0.5 * s.w[k]) * dt;
      s.a[k] += s.w[k] * dt;
      // Coming back in, the ball meets the row again. The thumb is held in its detent, so the blow comes
      // back out of the same side, a little weaker each time.
      if (k ? s.a[k] < 0 : s.a[k] > 0) {
        s.a[k] = 0;
        s.w[k] = -s.w[k] * 0.84;
        if (Math.abs(s.w[k]) < 0.3) s.w[k] = 0;
      }
      if (s.a[k] || s.w[k]) live = true;
    }
    return live;
  }

  draw(ctx, w, h) {
    const { R, L, TOP, TRAVEL } = CradleSwitch, s = this.sim;
    const live = this.step();
    const mid = 180, pill = { x: mid - TRAVEL / 2 - R, y: TOP + L - R - 4, w: TRAVEL + R * 2, h: R * 2 + 8 };
    // The balls touch the ends of the track, so the pair on each side starts two radiuses out from it.
    const rest = [mid - TRAVEL / 2 - R * 4, mid - TRAVEL / 2 - R * 2, 0, mid + TRAVEL / 2 + R * 2, mid + TRAVEL / 2 + R * 4];
    const cy = TOP + L;

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#edeae2'); bg.addColorStop(1, '#dbd7cd');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // the rail, with a mount over each thread
    ctx.fillStyle = '#4b4a47';
    rr(ctx, 54, TOP - 5, 252, 7, 3.5); ctx.fill();
    for (const x of [rest[0], rest[1], rest[3], rest[4]]) { ctx.fillStyle = '#3a3936'; rr(ctx, x - 3, TOP - 7, 6, 11, 2); ctx.fill(); }

    // the track the thumb runs in: it takes the colour on as the thumb crosses
    const lit = smooth(s.p);
    ctx.fillStyle = `rgb(${Math.round(lerp(201, 13, lit))}, ${Math.round(lerp(197, 74, lit))}, ${Math.round(lerp(187, 57, lit))})`;
    rr(ctx, pill.x, pill.y, pill.w, pill.h, pill.h / 2); ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${0.12 + lit * 0.1})`; ctx.lineWidth = 1.5; ctx.stroke();
    const inner = ctx.createLinearGradient(0, pill.y, 0, pill.y + pill.h);
    inner.addColorStop(0, 'rgba(0,0,0,0.18)'); inner.addColorStop(0.5, 'rgba(0,0,0,0)');
    ctx.fillStyle = inner;
    rr(ctx, pill.x, pill.y, pill.w, pill.h, pill.h / 2); ctx.fill();

    // the four hanging balls and the thumb
    const place = (i) => {
      if (i === 2) return [mid + lerp(-TRAVEL / 2, TRAVEL / 2, s.p), cy];
      const k = i > 2 ? 1 : 0, a = i === 0 || i === 4 ? s.a[k] : 0;
      return [rest[i] + Math.sin(a) * L, TOP + Math.cos(a) * L];
    };
    for (let i = 0; i < 5; i++) {
      const [bx, by] = place(i);
      if (i !== 2) {
        ctx.strokeStyle = '#6e6a62'; ctx.lineWidth = 1.1;
        ctx.beginPath(); ctx.moveTo(rest[i], TOP); ctx.lineTo(bx, by); ctx.stroke();
      }
      const lift = (by - cy) / R;                       // a ball that is up casts a smaller, fainter shadow
      ctx.fillStyle = `rgba(60,56,48,${0.22 * (1 + lift * 0.8)})`;
      ctx.beginPath(); ctx.ellipse(bx + 5, cy + R + 10, R * (0.95 + lift * 0.5), 4.5, 0, 0, TAU); ctx.fill();
    }
    for (let i = 0; i < 5; i++) {
      const [bx, by] = place(i);
      ball(ctx, bx, by, R);
    }

    hit(ctx, this.input, 30, cy - 48, 300, 96);
    this.ring(ctx, pill.x - 7, pill.y - 7, pill.w + 14, pill.h + 14, pill.h / 2 + 7, '#2b2a27');
    put(ctx, this.label, 28, 268);
    put(ctx, this.out, w - 28 - 60, 268);
    return live;
  }
}
customElements.define('cradle-switch', CradleSwitch);
// #endregion cradle-switch

// #region rocker-switch
export class RockerSwitch extends SwitchControl {
  static size = [116, 300];
  static radius = 0;
  static html = `<input type="checkbox" role="switch" id="c"><label for="c"><slot></slot></label>`;
  static css = `
    input { width: 80px; height: 140px; opacity: 0; touch-action: manipulation; }
    label { width: 84px; height: 34px; border-radius: 4px; background: #e9e2cf; color: #2d2f28; font: 700 15px/34px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 1.5px; text-align: center; text-transform: uppercase; box-shadow: inset 0 -2px 0 #0003; overflow: hidden; }`;

  draw(ctx, w, h) {
    const moving = spring(this.pos, this.checked ? 1 : 0, this.dt, 420, 22);
    const p = clamp(this.pos.x, -0.1, 1.1);
    ctx.fillStyle = '#4b5046'; ctx.fillRect(0, 0, w, h);
    const lx = w / 2, ly = 34;
    if (p > 0.5) { const g = ctx.createRadialGradient(lx, ly, 2, lx, ly, 34); g.addColorStop(0, '#ffb62ecc'); g.addColorStop(1, '#ffb62e00'); ctx.fillStyle = g; ctx.fillRect(lx - 34, ly - 34, 68, 68); }
    ctx.fillStyle = '#23261f'; ctx.beginPath(); ctx.arc(lx, ly, 11, 0, TAU); ctx.fill();
    const lamp = ctx.createRadialGradient(lx - 2, ly - 3, 1, lx, ly, 8);
    lamp.addColorStop(0, p > 0.5 ? '#fff1b8' : '#8a5a2a'); lamp.addColorStop(1, p > 0.5 ? '#ff9d1e' : '#4a2d12');
    ctx.fillStyle = lamp; ctx.beginPath(); ctx.arc(lx, ly, 8, 0, TAU); ctx.fill();
    const x = 18, y = 66, bw = 80, bh = 140;
    ctx.fillStyle = '#16180f'; rr(ctx, x, y, bw, bh, 8); ctx.fill();
    // two faces. The pressed half is seen from further round, so it is shorter and darker.
    const topH = lerp(0.56, 0.44, p) * (bh - 12), botH = bh - 12 - topH;
    const face = (yy, hh, lit, text) => {
      const g = ctx.createLinearGradient(0, yy, 0, yy + hh);
      g.addColorStop(0, lit ? '#f7f3e6' : '#bdb8a8'); g.addColorStop(1, lit ? '#e0dac8' : '#9a9586');
      ctx.fillStyle = g; rr(ctx, x + 6, yy, bw - 12, hh, 4); ctx.fill();
      ctx.fillStyle = '#2d2f28'; ctx.font = '700 22px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(text, x + bw / 2, yy + hh / 2);
    };
    face(y + 6, topH, p < 0.5, 'I');
    face(y + 6 + topH, botH, p >= 0.5, 'O');
    ctx.fillStyle = '#0005'; ctx.fillRect(x + 6, y + 6 + topH - 1, bw - 12, 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    hit(ctx, this.input, x, y, bw, bh);
    this.ring(ctx, x - 5, y - 5, bw + 10, bh + 10, 12);
    put(ctx, this.label, 16, 236);
    return moving;
  }
}
customElements.define('rocker-switch', RockerSwitch);
// #endregion rocker-switch

// #region frost-switch
//   <frost-switch name="frost" temperature="36.4" low="28.8">Frost alarm</frost-switch>
export class FrostSwitch extends SwitchControl {
  static size = [360, 330];
  static html = `<input type="checkbox" role="switch" id="c"><label for="c"><slot></slot></label>`;
  static css = `
    input { width: 170px; height: 70px; opacity: 0; touch-action: manipulation; }
    label { width: 130px; font: 500 21px/1.15 system-ui, sans-serif; letter-spacing: 2px; text-transform: uppercase; color: #6b4a00; }`;

  draw(ctx, w, h, now) {
    const on = this.checked, moving = spring(this.pos, on ? 1 : 0, this.dt, 300, 24);
    ctx.fillStyle = '#f2b90f'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1d1d1b'; rr(ctx, 12, 12, w - 24, 216, 8); ctx.fill();
    const lcd = ctx.createLinearGradient(0, 22, 0, 218);
    lcd.addColorStop(0, '#c3c9b8'); lcd.addColorStop(1, '#aab19f');
    ctx.fillStyle = lcd; rr(ctx, 24, 24, w - 48, 192, 3); ctx.fill();
    const ink = '#1c1f18', ghost = '#1c1f1812';
    const temp = (+this.getAttribute('temperature') || 36.4).toFixed(1).padStart(4, ' ');
    const low = (+this.getAttribute('low') || 28.8).toFixed(1);
    seg7Text(ctx, temp, 66, 36, 54, 96, ink, ghost);
    ctx.fillStyle = ink; ctx.font = '700 22px system-ui, sans-serif'; ctx.fillText('°F', 296, 62);
    ctx.font = '600 10px system-ui, sans-serif'; ctx.fillText('OUTDOOR', 30, 20 + 16); ctx.fillText('LOW', 36, 162);
    seg7Text(ctx, low, 70, 146, 13, 24, ink, ghost);
    seg7Text(ctx, on ? 'On' : 'OFF', 70, 178, 13, 24, ink, ghost);
    // the bell shows while the alarm is set, and blinks for two seconds after it is switched on
    const blink = on && (now - (this.changed ?? -1e9) > 2000 || reduced() || Math.floor(now / 250) % 2 === 0);
    ctx.fillStyle = blink ? ink : ghost;
    ctx.beginPath(); ctx.moveTo(38, 200); ctx.quadraticCurveTo(40, 180, 47, 180); ctx.quadraticCurveTo(54, 180, 56, 200); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.arc(47, 202, 3, 0, Math.PI); ctx.fill();
    for (let i = 0; i < 44; i++) {                               // the night's temperatures
      const v = 0.95 * Math.exp(-i / 16) + 0.06 * Math.sin(i * 1.7) + 0.05;
      ctx.fillStyle = ink; ctx.fillRect(150 + i * 4, 204 - v * 56, 3, v * 56);
    }
    // the slide switch
    const sx = 172, sy = 246, sw = 170, sh = 70, tw = 84, tx = sx + 4 + this.pos.x * (sw - tw - 8);
    ctx.fillStyle = '#1b1b19'; rr(ctx, sx, sy, sw, sh, 8); ctx.fill();
    ctx.fillStyle = '#2c2c29'; rr(ctx, sx + 4, sy + 4, sw - 8, sh - 8, 5); ctx.fill();
    const tg = ctx.createLinearGradient(0, sy, 0, sy + sh);
    tg.addColorStop(0, '#55554f'); tg.addColorStop(1, '#30302c');
    ctx.fillStyle = tg; rr(ctx, tx, sy + 5, tw, sh - 10, 5); ctx.fill();
    ctx.fillStyle = '#16161499';
    for (let i = 0; i < 7; i++) ctx.fillRect(tx + 18 + i * 7.5, sy + 18, 3, sh - 36);
    ctx.fillStyle = '#6b4a00'; ctx.font = '600 10px system-ui, sans-serif'; ctx.letterSpacing = '2px';
    ctx.fillText('OFF', sx + 30, sy + sh + 12); ctx.fillText('ON', sx + sw - 54, sy + sh + 12);
    ctx.letterSpacing = '0px';
    hit(ctx, this.input, sx, sy, sw, sh);
    this.ring(ctx, sx - 5, sy - 5, sw + 10, sh + 10, 12, '#1d1d1b');
    put(ctx, this.label, 26, 256);
    return moving || (on && now - (this.changed ?? -1e9) < 2100);
  }
}
customElements.define('frost-switch', FrostSwitch);
// #endregion frost-switch

// #region clay-switch
export class ClaySwitch extends SwitchControl {
  static size = [360, 300];
  static css = `
    input { width: 280px; height: 130px; opacity: 0; touch-action: manipulation; }
    label { font: 700 25px system-ui, sans-serif; color: #2d2a6e; white-space: nowrap; }
    output { font: 700 25px system-ui, sans-serif; color: #7a6ad0; width: 50px; text-align: right; }`;

  draw(ctx, w, h) {
    const on = this.checked, moving = spring(this.pos, on ? 1 : 0, this.dt, 150, 11);
    const p = this.pos.x, v = clamp(Math.abs(this.pos.v) / 6, 0, 0.35);
    ctx.fillStyle = '#fbf0cf'; ctx.fillRect(0, 0, w, h);
    // the slab: a drop shadow, then light from the top left and shade at the bottom right
    ctx.save(); ctx.shadowColor = '#7a62c466'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 18;
    ctx.fillStyle = '#b9a4f2'; rr(ctx, 24, 24, w - 48, h - 48, 46); ctx.fill(); ctx.restore();
    ctx.save(); rr(ctx, 24, 24, w - 48, h - 48, 46); ctx.clip();
    ctx.shadowColor = '#ffffffb0'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 8; ctx.shadowOffsetY = 8;
    ctx.strokeStyle = '#b9a4f2'; ctx.lineWidth = 16; rr(ctx, 16, 16, w - 32, h - 32, 54); ctx.stroke();
    ctx.shadowColor = '#5a44a680'; ctx.shadowOffsetX = -8; ctx.shadowOffsetY = -8; ctx.stroke();
    ctx.restore();
    // the groove, pressed in
    const gx = 50, gy = 122, gw = w - 100, gh = 116;
    const track = `rgb(${lerp(226, 255, clamp(p))}, ${lerp(206, 190, clamp(p))}, ${lerp(245, 150, clamp(p))})`;
    ctx.fillStyle = track; rr(ctx, gx, gy, gw, gh, gh / 2); ctx.fill();
    ctx.save(); rr(ctx, gx, gy, gw, gh, gh / 2); ctx.clip();
    ctx.shadowColor = '#3a2a7a80'; ctx.shadowBlur = 14; ctx.shadowOffsetX = 6; ctx.shadowOffsetY = 8;
    ctx.strokeStyle = track; ctx.lineWidth = 14; rr(ctx, gx - 7, gy - 7, gw + 14, gh + 14, gh / 2 + 7); ctx.stroke();
    ctx.restore();
    // the thumb is soft: it is wider and flatter while it moves
    const tr = 46, tx = lerp(gx + gh / 2, gx + gw - gh / 2, p), ty = gy + gh / 2;
    ctx.save(); ctx.translate(tx, ty); ctx.scale(1 + v, 1 - v * 0.6);
    ctx.shadowColor = '#6a4a3080'; ctx.shadowBlur = 16; ctx.shadowOffsetX = 5; ctx.shadowOffsetY = 9;
    const tg = ctx.createRadialGradient(-14, -16, 4, 0, 0, tr);
    tg.addColorStop(0, '#fffdf6'); tg.addColorStop(1, '#f1e2c4');
    ctx.fillStyle = tg; ctx.beginPath(); ctx.arc(0, 0, tr, 0, TAU); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = on ? '#f08a4b' : '#c4a37a'; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(-15, 10); ctx.quadraticCurveTo(-11, 8, -11, -2); ctx.quadraticCurveTo(-11, -16, 0, -16); ctx.quadraticCurveTo(11, -16, 11, -2); ctx.quadraticCurveTo(11, 8, 15, 10); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 16, 4, 0, Math.PI); ctx.stroke();
    ctx.restore();
    hit(ctx, this.input, 40, gy - 8, 280, 130);
    this.ring(ctx, gx - 6, gy - 6, gw + 12, gh + 12, gh / 2 + 6, '#2d2a6e');
    put(ctx, this.label, 54, 62);
    put(ctx, this.out, w - 54 - 50, 62);
    return moving;
  }
}
customElements.define('clay-switch', ClaySwitch);
// #endregion clay-switch

// #region omr-sheet
//   <omr-sheet name="shift" columns="Morning Afternoon Evening">
//     <option value="mon" data-checked="Morning">Monday</option> …
//   </omr-sheet>
// A form of checkboxes laid out and styled as an answer sheet, drawn as one picture. The canvas draws
// pencil over each checked box, stroke by stroke, and leaves a smudge where a mark was rubbed out.
export class OmrSheet extends FeedControl {
  static size = [360, 400];
  static html = `<div class="sheet"></div>`;
  static css = `
    .sheet { width: 336px; background: #fff; color: #e2007a; font: 700 14px/1 'Arial Narrow', 'Liberation Sans Narrow', Arial, sans-serif; text-transform: uppercase; padding: 10px 0 6px 22px; }
    .head, .row { display: grid; grid-template-columns: 104px repeat(var(--n), 1fr); align-items: center; }
    .head { height: 24px; font-size: 9px; letter-spacing: 1px; text-align: center; }
    .row { height: 50px; padding-left: 8px; font-size: 16px; border-top: 1px solid #e2007a; }
    .row:nth-child(even) { background: #fbe3f0; }
    .row label { justify-self: center; position: relative; width: 60px; height: 44px; display: grid; place-items: center; }
    .row input { appearance: none; width: 52px; height: 24px; margin: 0; border: 1.5px solid #e2007a; border-radius: 12px; background: #fff; outline: none; touch-action: manipulation; }
    .row input:focus-visible { box-shadow: 0 0 0 3px #1a1a1a; }
    .row label span { position: absolute; font-size: 10px; pointer-events: none; }`;

  ready() {
    this.form = this.$('.sheet');
    this.marks = new Map();                                     // input -> { amount, smudge }
    this.sync();
    new MutationObserver(() => this.sync()).observe(this, { childList: true, subtree: true, characterData: true });
    this.form.addEventListener('change', () => { this.send(); this.dispatchEvent(new Event('change', { bubbles: true })); });
  }
  get value() { return [...this.form.querySelectorAll('input:checked')].map((i) => `${i.name}:${i.value}`); }
  send() {
    const data = new FormData(), name = this.getAttribute('name') || 'sheet';
    for (const v of this.value) data.append(name, v);
    this.setValue(data);
    this.request();
  }
  sync() {
    const cols = (this.getAttribute('columns') || 'Yes').split(/\s+/);
    this.form.style.setProperty('--n', cols.length);
    this.form.innerHTML = `<div class="head"><span></span>${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` +
      options(this).map((o) => `<div class="row"><span>${esc(o.label)}</span>${cols.map((c) => `<label><input type="checkbox" name="${esc(o.value)}" value="${esc(c)}" aria-label="${esc(o.label)}, ${esc(c)}"${(o.data.checked ?? '').split(/\s+/).includes(c) ? ' checked' : ''}><span>${esc(c[0])}</span></label>`).join('')}</div>`).join('');
    this.marks.clear();
    for (const i of this.form.querySelectorAll('input')) this.marks.set(i, { amount: i.checked ? 1 : 0, smudge: 0 });
    this.send();
  }
  draw(ctx, w, h) {
    ctx.fillStyle = '#e9e4da'; ctx.fillRect(0, 0, w, h);
    const fx = 12, fy = 8;
    ctx.save(); ctx.shadowColor = '#0003'; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3;
    put(ctx, this.form, fx, fy);
    ctx.restore();
    let moving = false, n = 0;
    for (const [input, m] of this.marks) {
      const box = input.parentElement;                         // the label is the input's offsetParent
      const x = fx + box.offsetLeft + input.offsetLeft, y = fy + box.offsetTop + input.offsetTop;
      if (n % 3 === 0) { ctx.fillStyle = '#111'; ctx.fillRect(fx + 5, y + 8, 11, 6); }            // timing marks
      const to = input.checked ? 1 : 0;
      if (m.amount !== to) {
        if (to === 0) m.smudge = 1;
        m.amount = reduced() ? to : clamp(m.amount + (to ? 1 : -1) * this.dt * (to ? 3.2 : 6));
        moving = moving || m.amount !== to;
      }
      if (m.smudge > 0 || m.amount > 0) scribble(ctx, x, y, 52, 24, m.amount, m.smudge, n);
      n++;
    }
    return moving;
  }
}
// A pencil mark over a box: a zigzag whose points come from the box's index, so it is the same each frame.
function scribble(ctx, x, y, w, h, amount, smudge, seed) {
  let s = seed * 9301 + 49297;
  const rnd = () => { s = (s * 233280 + 49297) % 233280; s = (s * 9301 + 49297) % 233280; return s / 233280; };
  ctx.save();
  if (smudge) { ctx.fillStyle = `rgba(60,60,70,${0.1 * smudge})`; rr(ctx, x - 2, y - 1, w + 4, h + 2, h / 2); ctx.fill(); }
  const points = 26, shown = (points - 1) * amount;
  ctx.strokeStyle = '#2b2b33d8'; ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath();
  let lx = 0, ly = 0;
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const px = x + 2 + t * (w - 4) + (rnd() - 0.5) * 3, py = i % 2 ? y + 2 + rnd() * 5 : y + h - 2 - rnd() * 5;
    const part = clamp(shown - (i - 1));
    if (i === 0) ctx.moveTo(px, py);
    else if (part > 0) ctx.lineTo(lerp(lx, px, part), lerp(ly, py, part));
    lx = px; ly = py;
  }
  ctx.stroke();
  ctx.restore();
}
customElements.define('omr-sheet', OmrSheet);
// #endregion omr-sheet
