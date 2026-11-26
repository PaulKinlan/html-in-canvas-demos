// <orbit-listbox>: a <select size> beside a gravity-well field with a probe captured into orbit.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, options, esc, clamp, smooth, TAU, reduced } from '../kit.js';

// A deterministic random number from an integer, for things that must not change between frames.
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

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
