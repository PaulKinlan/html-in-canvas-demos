// <candle-rating>: radio buttons drawn as a row of candles that light each other and smoke when put out.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, clamp, lerp, smooth, rr, TAU, reduced } from '../kit.js';

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
