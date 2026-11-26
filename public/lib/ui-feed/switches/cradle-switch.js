// <cradle-switch>: a checkbox drawn as a Newton's cradle with a sliding thumb ball.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js.

import { FeedControl, put, hit, lerp, smooth, rr, TAU, reduced } from '../kit.js';

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
