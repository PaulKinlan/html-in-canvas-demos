// <mercury-switch>: a checkbox drawn as a tilting glass vial with shallow-water mercury.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, lerp, rr, spring, TAU, reduced } from '../kit.js';

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
