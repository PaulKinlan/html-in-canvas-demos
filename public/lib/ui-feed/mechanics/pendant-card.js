// <pendant-card>: buttons with a hover card, lit by a pendant lamp that swings to the one in use.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, options, esc, clamp, rr, TAU, reduced } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// #region pendant-card
// A row of buttons, one for each <option> the author wrote, and one card that describes the button in use.
// The lamp hangs from a trolley that runs to the button. The lamp itself is a pendulum on that trolley, so
// it lags behind, overshoots and swings before it settles, and each face is lit by how near the lamp is.
export class PendantCard extends FeedControl {
  static size = [360, 372];
  static html = `<div class="card" role="tooltip" id="card"><b></b><i></i><dl></dl></div>`;
  static css = `
    button { width: 60px; height: 60px; opacity: 0; border-radius: 50%; touch-action: manipulation; }
    .card { width: 214px; box-sizing: border-box; padding: 14px 16px 6px; border: 1px solid #2d2a27; border-radius: 12px; background: #0b0a09; color: #f3efe8;
      font: 400 12.5px/1.35 'Helvetica Neue', Arial, ui-sans-serif, sans-serif; }
    .card b { display: block; font-size: 15px; font-weight: 500; }
    .card i { display: block; font-style: normal; color: #8e877d; margin-bottom: 10px; }
    .card dl { margin: 0; }
    .card dl div { display: flex; justify-content: space-between; padding: 8px 0; border-top: 1px solid #25221f; }
    .card dt { color: #8e877d; } .card dd { margin: 0; }`;
  static L = 88; static G = 2300; static ROW = 184;

  ready() {
    this.card = this.$('.card');
    this.build();
    new MutationObserver(() => this.build()).observe(this, { childList: true, subtree: true, characterData: true, attributes: true });
  }
  x(i) { const n = this.people.length; return n < 2 ? 180 : 44 + (i * 272) / (n - 1); }
  build() {
    for (const b of this.$$('button')) b.remove();
    this.people = options(this);
    this.buttons = this.people.map((p, i) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', ariaLabel: p.label });
      b.setAttribute('drawable', ''); b.setAttribute('aria-describedby', 'card');
      const use = () => this.use(i);
      for (const type of ['pointerenter', 'focus', 'click']) b.addEventListener(type, use);
      this.canvas.append(b);
      return b;
    });
    const start = Math.max(0, this.people.findIndex((p) => p.selected));
    this.at = start; this.shown = -1;
    this.sim = { x: this.x(start), vx: 0, th: 0, w: 0 };
    this.fade = 0;
    this.request();
  }
  use(i) { if (i === this.at) return; this.at = i; this.dispatchEvent(new CustomEvent('show', { detail: this.people[i] })); this.request(); }
  fill(i) {
    const p = this.people[i]; if (!p) return;
    this.shown = i;
    this.card.children[0].textContent = p.label; this.card.children[1].textContent = p.data.role ?? '';
    this.card.children[2].innerHTML = Object.entries(p.data).filter(([k]) => k !== 'role').map(([k, v]) => `<div><dt>${esc(k[0].toUpperCase() + k.slice(1))}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  // #region pendant-step
  step(dt) {
    const { L, G } = PendantCard, s = this.sim, goal = this.x(this.at);
    const ax = 16 * (goal - s.x) - 7 * s.vx;                 // the trolley: a spring to the button, a little under-damped
    s.vx += ax * dt; s.x += s.vx * dt;
    // a pendulum whose pivot accelerates: the bob is left behind by the trolley's acceleration
    s.w += (-(G / L) * Math.sin(s.th) - (ax / L) * Math.cos(s.th) - 2.8 * s.w) * dt;
    s.th += s.w * dt;
    if (Math.abs(goal - s.x) > 0.05 || Math.abs(s.vx) > 0.5 || Math.abs(s.th) > 0.003 || Math.abs(s.w) > 0.02) return true;
    Object.assign(s, { x: goal, vx: 0, th: 0, w: 0 });       // too small to see: stop, so the canvas can rest
    return false;
  }
  // #endregion pendant-step

  draw(ctx, w, h) {
    const { L, ROW } = PendantCard, s = this.sim;
    let live = false;
    if (reduced()) Object.assign(s, { x: this.x(this.at), vx: 0, th: 0, w: 0 });
    else for (let i = 0; i < 4; i++) live = this.step(this.dt / 4) || live;
    const bob = { x: s.x + Math.sin(s.th) * L, y: 4 + Math.cos(s.th) * L };
    // a dark wooden wall, with the grain showing only where the light falls
    ctx.fillStyle = '#0a0706'; ctx.fillRect(0, 0, w, h);
    const pool = ctx.createRadialGradient(bob.x, bob.y + 20, 10, bob.x, bob.y + 20, 210);
    pool.addColorStop(0, '#6a3a1c'); pool.addColorStop(0.35, '#2e170c'); pool.addColorStop(1, 'rgba(10,7,6,0)');
    ctx.fillStyle = pool; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.globalCompositeOperation = 'multiply';
    for (let i = 0; i < 120; i++) { ctx.fillStyle = `rgba(0,0,0,${0.1 + rnd(i) * 0.3})`; ctx.fillRect(0, (i * h) / 120 + rnd(i + 7) * 2, w, 0.8 + rnd(i + 3)); }
    ctx.restore();
    // the faces
    const near = this.people.map((_, i) => 1 / (1 + ((this.x(i) - bob.x) / 54) ** 2));
    this.people.forEach((p, i) => {
      const x = this.x(i), b = clamp(0.08 + near[i] * 1.05), R = 26;
      const tone = (v) => `rgb(${Math.round(v * b * 255)},${Math.round(v * b * 232)},${Math.round(v * b * 200)})`;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.arc(x + (x - bob.x) * 0.04, ROW + 4, R + 1, 0, TAU); ctx.fill();
      ctx.save(); ctx.beginPath(); ctx.arc(x, ROW, R, 0, TAU); ctx.clip();
      ctx.fillStyle = tone(0.42); ctx.fillRect(x - R, ROW - R, R * 2, R * 2);
      // head and shoulders, different for each person: skin, shirt, and one of five ways of wearing hair
      const k = rnd(i * 13 + p.label.length), kind = (i + p.label.length) % 5;
      const lit = (c, v = 1) => `rgb(${c.map((n) => Math.round(n * v * b)).join(',')})`;
      const skin = [[236, 190, 150], [150, 100, 70], [222, 172, 128], [110, 72, 52], [244, 208, 176]][(i * 3 + p.label.length) % 5];
      const shirt = [[70, 92, 140], [150, 60, 50], [60, 110, 90], [170, 150, 110], [90, 70, 120]][(i + 2 * p.label.length) % 5];
      const hair = [[40, 28, 20], [20, 16, 14], [120, 76, 36], [170, 165, 160], [70, 40, 24]][(i * 2 + p.label.length) % 5];
      ctx.fillStyle = lit(shirt); ctx.beginPath(); ctx.ellipse(x, ROW + 31, 21 + k * 4, 17, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = lit(skin, 0.82); ctx.fillRect(x - 4, ROW + 5, 8, 10);
      if (kind === 1) { ctx.fillStyle = lit(hair); rr(ctx, x - 13, ROW - 14, 26, 32, 11); ctx.fill(); }      // long, behind the face
      if (kind === 2) { ctx.fillStyle = lit(hair); ctx.beginPath(); ctx.arc(x, ROW - 19, 6, 0, TAU); ctx.fill(); }   // a bun
      ctx.fillStyle = lit(skin); ctx.beginPath(); ctx.ellipse(x, ROW - 3, 9.5, 11.5, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = lit(hair);
      if (kind === 3) { ctx.beginPath(); ctx.ellipse(x, ROW + 3, 9.2, 7.5, 0, 0, Math.PI); ctx.fill(); }             // bald, with a beard
      else if (kind === 4) { ctx.beginPath(); ctx.ellipse(x, ROW - 6, 11.5, 10.5, 0, Math.PI, TAU); ctx.fill(); ctx.fillRect(x - 11.5, ROW - 7, 23, 3); ctx.fillRect(x - 11.5, ROW - 7, 3.5, 12); ctx.fillRect(x + 8, ROW - 7, 3.5, 12); } // a bob with a fringe
      else { ctx.beginPath(); ctx.ellipse(x + (kind ? 0 : 1.5), ROW - 8, 10.5, 7.5 + k * 2, 0, Math.PI, TAU); ctx.fill(); }
      ctx.fillStyle = lit([30, 22, 18]); ctx.fillRect(x - 4.5, ROW - 3, 2, 2); ctx.fillRect(x + 2.5, ROW - 3, 2, 2);
      // the light comes from above: the top of the disc is brighter than the bottom
      const top = ctx.createLinearGradient(0, ROW - R, 0, ROW + R); top.addColorStop(0, `rgba(255,240,215,${0.25 * near[i]})`); top.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = top; ctx.fillRect(x - R, ROW - R, R * 2, R * 2);
      ctx.restore();
      ctx.strokeStyle = `rgba(255,236,205,${0.12 + near[i] * 0.5})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, ROW, R, 0, TAU); ctx.stroke();
      if (this.buttons[i].matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.arc(x, ROW, R + 5, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      hit(ctx, this.buttons[i], x - 30, ROW - 30, 60, 60);
    });
    // cord, cap and globe
    ctx.strokeStyle = '#050403'; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(s.x, 0); ctx.lineTo(bob.x - Math.sin(s.th) * 26, bob.y - Math.cos(s.th) * 26); ctx.stroke();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(bob.x, bob.y, 18, bob.x, bob.y, 86);
    halo.addColorStop(0, 'rgba(255,214,160,0.5)'); halo.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = halo; ctx.fillRect(bob.x - 90, bob.y - 90, 180, 180); ctx.restore();
    const globe = ctx.createRadialGradient(bob.x, bob.y - 4, 2, bob.x, bob.y, 27);
    globe.addColorStop(0, '#fffdf6'); globe.addColorStop(0.7, '#fff1d6'); globe.addColorStop(1, '#f2cf9c');
    ctx.fillStyle = globe; ctx.beginPath(); ctx.arc(bob.x, bob.y, 26, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(bob.x, bob.y); ctx.rotate(-s.th); ctx.fillStyle = '#0b0908'; rr(ctx, -5, -31, 10, 9, 2); ctx.fill(); ctx.restore();
    // the card belongs to the button the lamp is over
    const over = near.indexOf(Math.max(...near)), arrived = over === this.at && Math.abs(this.x(over) - bob.x) < 30;
    if (arrived && this.shown !== over) { this.fill(over); live = true; }
    const want = arrived && this.shown === over ? 1 : 0;
    if (this.fade !== want) { this.fade = reduced() ? want : clamp(this.fade + (want ? this.dt / 0.18 : -this.dt / 0.1)); live = true; }
    if (this.shown >= 0 && this.fade > 0) {
      const cx = clamp(this.x(this.shown) - 107, 10, w - 224);
      ctx.save(); ctx.globalAlpha = this.fade; put(ctx, this.card, cx, ROW + 40 + (1 - this.fade) * 6); ctx.restore();
    }
    this.buttons.forEach((b, i) => b.setAttribute('aria-expanded', String(i === this.shown && this.fade > 0.5)));
    return live;
  }
}
customElements.define('pendant-card', PendantCard);
// #endregion pendant-card
