// <bloom-timeline>: amaryllis growth timeline driven by a native <input type="range"> and <ol> of dates.
// Standalone ES module; only depends on ../kit.js and ../fold.js.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, TAU } from '../kit.js';
import { focusRing } from '../fold.js';

const DISPLAY = "'Playfair Display', 'Didot', 'Bodoni MT', 'Bodoni 72', 'Noto Serif Display', 'Noto Serif', 'Times New Roman', serif";
const point = (ctrl, e) => { const r = ctrl.canvas.getBoundingClientRect(), k = ctrl.constructor.size[0] / r.width; return { x: (e.clientX - r.left) * k, y: (e.clientY - r.top) * k }; };
// A range under a drawn handle: the pointer is captured and the control works out the value (see gauges.js).
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

// #region bloom-plant
// The plant at growth g, where 0 is the bare bulb and each whole number is the next stage. Every length is
// a list of five values, one for each stage, and is read part way between two of them.
const at = (g, v) => { const i = clamp(Math.floor(g), 0, v.length - 2), f = smooth(g - i); return lerp(v[i], v[i + 1], f); };
function drawPlant(ctx, g) {
  const X = 180, SOIL = 213;
  const tall = at(g, [0, 34, 70, 126, 132]), thick = at(g, [5, 8.5, 10, 9.5, 9.5]), side = at(g, [0, 13, 15, 24, 31]);
  const bud = at(g, [0, 0, 36, 30, 0]), open = clamp((g - 2.35) / 1.5), lean = Math.sin(g * 1.7) * 1.5;
  const top = { x: X + lean, y: 184 - tall };

  // the pot's shadow, the pot, the soil and the bulb
  ctx.save(); ctx.filter = 'blur(5px)'; ctx.fillStyle = 'rgba(150,110,0,0.5)'; ctx.beginPath(); ctx.ellipse(X + 44, 287, 62, 7, 0, 0, TAU); ctx.fill(); ctx.restore();
  const clay = ctx.createLinearGradient(X - 48, 0, X + 48, 0);
  for (const [p, c] of [[0, '#b9532a'], [0.3, '#e2783f'], [0.62, '#d96a35'], [1, '#a8461f']]) clay.addColorStop(p, c);
  ctx.fillStyle = clay; ctx.beginPath(); ctx.moveTo(X - 43, 224); ctx.lineTo(X + 43, 224); ctx.lineTo(X + 32, 286); ctx.quadraticCurveTo(X, 291, X - 32, 286); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#3a2314'; ctx.beginPath(); ctx.ellipse(X, SOIL, 44, 4.5, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = clay; rr(ctx, X - 48, SOIL, 96, 12, 2.5); ctx.fill();
  ctx.fillStyle = 'rgba(255,220,190,0.25)'; ctx.fillRect(X - 46, SOIL + 0.6, 92, 1.2);
  ctx.fillStyle = 'rgba(90,30,8,0.22)'; ctx.fillRect(X - 43, SOIL + 12, 86, 2.2);
  ctx.fillStyle = '#3a2314'; ctx.beginPath(); ctx.ellipse(X, SOIL + 0.5, 44, 4, 0, Math.PI, TAU); ctx.fill();
  const skin = ctx.createRadialGradient(X - 8, 194, 3, X, 200, 30); skin.addColorStop(0, '#d9ad78'); skin.addColorStop(0.6, '#b07a45'); skin.addColorStop(1, '#7a4a25');
  ctx.fillStyle = skin; ctx.beginPath(); ctx.moveTo(X - 7, 181); ctx.bezierCurveTo(X - 34, 188, X - 34, SOIL, X - 20, SOIL + 1); ctx.lineTo(X + 20, SOIL + 1); ctx.bezierCurveTo(X + 34, SOIL, X + 34, 188, X + 7, 181); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(90,50,20,0.4)'; ctx.lineWidth = 0.6;
  for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(X + i * 2, 182); ctx.quadraticCurveTo(X + i * 9, 196, X + i * 6, SOIL); ctx.stroke(); }

  const green = (x0, x1) => { const m = ctx.createLinearGradient(x0, 0, x1, 0); m.addColorStop(0, '#4f8f1f'); m.addColorStop(0.45, '#8cc63f'); m.addColorStop(1, '#3f7a18'); return m; };
  const blade = (dir, len, wide) => {                     // a short leaf beside the stalk
    if (len < 1) return;
    ctx.fillStyle = green(X + dir * 4, X + dir * (8 + wide));
    ctx.beginPath(); ctx.moveTo(X + dir * 3, 186); ctx.quadraticCurveTo(X + dir * (6 + wide), 186 - len * 0.5, X + dir * (8 + len * 0.22), 186 - len);
    ctx.quadraticCurveTo(X + dir * 1, 186 - len * 0.5, X - dir * 2, 186); ctx.closePath(); ctx.fill();
  };
  blade(-1, side * 0.85, 7); blade(1, side, 8);
  // the stalk: a blunt shoot at first, then a tube
  if (tall > 0.5) {
    ctx.fillStyle = green(X - thick / 2, X + thick / 2);
    ctx.beginPath(); ctx.moveTo(X - thick / 2, 186); ctx.lineTo(top.x - thick / 2 * 0.9, top.y + thick * 0.5);
    ctx.quadraticCurveTo(top.x, top.y - thick * 0.7, top.x + thick / 2 * 0.9, top.y + thick * 0.5); ctx.lineTo(X + thick / 2, 186); ctx.closePath(); ctx.fill();
  }
  // the bud at the top of the stalk, which splits as the flowers come out
  if (bud > 1 && open < 0.35) {
    ctx.save(); ctx.globalAlpha = 1 - open / 0.35; ctx.translate(top.x, top.y + 4);
    const sheath = ctx.createLinearGradient(-8, 0, 8, -bud); sheath.addColorStop(0, '#86c33c'); sheath.addColorStop(0.55, '#c9dc52'); sheath.addColorStop(1, g > 1.6 ? '#f0a35a' : '#d7e06a');
    ctx.fillStyle = sheath; ctx.beginPath(); ctx.moveTo(-thick * 0.5, 0); ctx.bezierCurveTo(-bud * 0.34, -bud * 0.3, -bud * 0.22, -bud * 0.8, 0, -bud); ctx.bezierCurveTo(bud * 0.22, -bud * 0.8, bud * 0.34, -bud * 0.3, thick * 0.5, 0); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(70,120,20,0.45)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -bud * 0.94); ctx.stroke();
    ctx.restore();
  }
  // four trumpets. The first two open ahead of the others
  if (open > 0) {
    [[-1.42, 2], [1.42, 3], [-0.62, 0], [0.7, 1]].forEach(([angle, order]) => {
      const o = clamp(open * 1.7 - order * 0.22); if (o <= 0) return;
      const stem = 9 + 9 * o, cx = top.x + Math.sin(angle) * stem, cy = top.y - 2 - Math.cos(angle) * stem * 0.7;
      ctx.strokeStyle = '#6aa52b'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(top.x, top.y + 2); ctx.lineTo(cx, cy); ctx.stroke();
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle);
      const len = 13 + 31 * o, wide = 5 + 9.5 * o, fan = lerp(0.1, 0.58, o);
      for (const k of [-2.5, 2.5, -1.5, 1.5, -0.5, 0.5]) {
        ctx.save(); ctx.rotate(k * fan);
        const petal = ctx.createLinearGradient(0, 0, 0, -len); petal.addColorStop(0, '#8f0a10'); petal.addColorStop(0.4, Math.abs(k) > 1 ? '#c21218' : '#de1f1f'); petal.addColorStop(1, Math.abs(k) > 1 ? '#b00d14' : '#ea2a24');
        ctx.fillStyle = petal; ctx.beginPath(); ctx.moveTo(0, 0); ctx.bezierCurveTo(-wide, -len * 0.3, -wide * 0.9, -len * 0.78, 0, -len); ctx.bezierCurveTo(wide * 0.9, -len * 0.78, wide, -len * 0.3, 0, 0); ctx.fill();
        ctx.strokeStyle = 'rgba(110,0,8,0.35)'; ctx.lineWidth = 0.5; ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -len * 0.9); ctx.stroke();
        ctx.restore();
      }
      if (o > 0.45) {                                    // stamens
        ctx.strokeStyle = 'rgba(255,232,210,0.9)'; ctx.fillStyle = '#f6e3a0'; ctx.lineWidth = 0.7;
        for (let s = -2; s <= 2; s++) { const ex = s * 3.2 * o, ey = -len * (0.5 + 0.05 * Math.abs(s)); ctx.beginPath(); ctx.moveTo(0, -3); ctx.quadraticCurveTo(ex * 0.3, ey * 0.6, ex, ey); ctx.stroke(); ctx.beginPath(); ctx.ellipse(ex, ey, 1.5, 0.9, 0.3, 0, TAU); ctx.fill(); }
      }
      ctx.restore();
    });
  }
}
// #endregion bloom-plant

export class BloomTimeline extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static X0 = 47; static X1 = 313; static TY = 310;
  static html = `<input type="range" min="0" max="4" step="1" value="0"><ol></ol><output class="day"></output><output class="what"></output>`;
  static css = `
    input { width: 60px; height: 60px; opacity: 0; margin: 0; touch-action: none; cursor: pointer; }
    ol { display: flex; width: 334px; margin: 0; padding: 0; list-style: none; font: 400 9.5px/14px ${DISPLAY}; color: #6f6417; }
    li { flex: 1; text-align: center; white-space: nowrap; }
    li[aria-current] { color: #17150a; font-weight: 600; }
    .day { width: 110px; font: 400 84px/78px ${DISPLAY}; letter-spacing: -0.05em; color: #17150a; }
    .day small { display: block; font: italic 400 17px/18px ${DISPLAY}; letter-spacing: 0; padding-left: 3px; }
    .what { width: 130px; font: italic 400 20px/24px ${DISPLAY}; letter-spacing: -0.02em; color: #17150a; white-space: nowrap; }`;
  static observedAttributes = ['value'];

  ready() {
    this.range = this.$('input'); this.list = this.$('ol'); this.day = this.$('.day'); this.what = this.$('.what');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'data-date'] });
    // #region bloom-range
    // The range has one step for each stage. A drag is followed between the steps, so the plant can be held
    // part way, and the range takes the nearest stage when the finger lifts.
    const to = (e) => { const { X0, X1 } = BloomTimeline, n = this.stages.length - 1; this.goal = clamp((point(this, e).x - X0) / (X1 - X0)) * n; this.show(); };
    this.held = grip(this.range, { down: to, move: to, up: () => { this.range.value = Math.round(this.goal); this.goal = Number(this.range.value); this.show(); this.dispatchEvent(new Event('change', { bubbles: true })); } });
    this.range.addEventListener('keydown', () => { this.keys = true; }); this.range.addEventListener('pointerdown', () => { this.keys = false; });
    this.range.addEventListener('input', () => { if (this.held()) return; this.goal = Number(this.range.value); this.show(); });
    this.range.addEventListener('change', (e) => { e.stopPropagation(); if (!this.held()) this.dispatchEvent(new Event('change', { bubbles: true })); });
    // #endregion bloom-range
  }
  attributeChangedCallback(_, __, v) { if (this.stages && v !== null && v !== this.value) this.value = v; }
  build() {
    const stages = this.stages = options(this).map((o) => {
      const date = o.data.date ? new Date(`${o.data.date}T12:00:00`) : null;
      return { day: Number(o.value) || 0, label: o.label, iso: o.data.date ?? '', date: date ? date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).replace(',', '') : '' };
    });
    const was = this.getAttribute('value'), start = Math.max(0, stages.findIndex((s) => String(s.day) === was));
    this.range.max = Math.max(1, stages.length - 1); this.range.value = start; this.range.ariaLabel = this.getAttribute('label') ?? 'Stage';
    this.list.innerHTML = stages.map((s) => `<li><time datetime="${esc(s.iso)}">${esc(s.date)}</time></li>`).join('');
    this.goal = start; this.grown ??= { x: start, v: 0 }; this.dot ??= { x: start, v: 0 };
    this.show();
  }
  get index() { return clamp(Math.round(this.goal), 0, this.stages.length - 1); }
  get value() { return String(this.stages[this.index]?.day ?? ''); }
  set value(v) { const i = this.stages.findIndex((s) => String(s.day) === String(v)); if (i >= 0) { this.range.value = i; this.goal = i; this.show(); } }
  show() {
    const s = this.stages[this.index]; if (!s) return;
    [...this.list.children].forEach((li, i) => (i === this.index ? li.setAttribute('aria-current', 'step') : li.removeAttribute('aria-current')));
    this.range.setAttribute('aria-valuetext', `Day ${s.day}, ${s.date}: ${s.label}`);
    if (this.what.value !== s.label) this.what.value = s.label;
    this.setValue(this.value); this.request();
  }

  draw(ctx, w, h) {
    const { X0, X1, TY } = BloomTimeline, n = this.stages.length - 1, x = (i) => lerp(X0, X1, i / Math.max(1, n));
    // #region bloom-step
    // The plant grows toward the stage on a slow spring, and the day counts up with it.
    let moving = spring(this.grown, this.goal, this.dt, 16, 8.5);
    if (Math.abs(this.grown.x - this.goal) < 0.004 && Math.abs(this.grown.v) < 0.02) { this.grown.x = this.goal; this.grown.v = 0; moving = false; }
    moving = spring(this.dot, this.goal, this.dt, 260, 26) || moving;
    const g = clamp(this.grown.x, 0, n), i = Math.min(n - 1, Math.floor(g)), a = this.stages[i], b = this.stages[i + 1] ?? a;
    const day = String(Math.round(lerp(a.day, b.day, g - i)));
    if (this.day.dataset.n !== day) { this.day.dataset.n = day; this.day.innerHTML = `<small>Day</small>${esc(day)}`; }
    // #endregion bloom-step

    const sky = ctx.createRadialGradient(180, 150, 30, 180, 170, 300); sky.addColorStop(0, '#fbe535'); sky.addColorStop(1, '#f3d722');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    drawPlant(ctx, g * (4 / Math.max(1, n)));
    put(ctx, this.day, 18, 96);
    put(ctx, this.what, 220, 181);
    // the line, with the part already grown in black
    ctx.lineCap = 'round'; ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(60,50,0,0.35)'; ctx.beginPath(); ctx.moveTo(X0, TY); ctx.lineTo(X1, TY); ctx.stroke();
    ctx.strokeStyle = '#17150a'; ctx.beginPath(); ctx.moveTo(X0, TY); ctx.lineTo(x(clamp(this.dot.x, 0, n)), TY); ctx.stroke();
    this.stages.forEach((_, k) => {
      const done = k <= this.dot.x + 0.02;
      ctx.fillStyle = done ? '#17150a' : '#f7dd2a'; ctx.strokeStyle = '#17150a'; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(x(k), TY, done ? 4.6 : 3.6, 0, TAU); ctx.fill(); if (!done) ctx.stroke();
    });
    ctx.fillStyle = '#c8102e'; ctx.beginPath(); ctx.arc(x(clamp(this.dot.x, 0, n)), TY, 7.4, 0, TAU); ctx.fill();
    put(ctx, this.list, 13, 322);
    if (this.keys && this.range.matches(':focus-visible')) focusRing(ctx, x(this.dot.x) - 12, TY - 12, 24, 24, '#17150a');
    // The range covers the line and the dates, so a tap on either goes to it.
    hit(ctx, this.range, 14, TY - 22, 332, 62);
    return moving;
  }
}
customElements.define('bloom-timeline', BloomTimeline);
