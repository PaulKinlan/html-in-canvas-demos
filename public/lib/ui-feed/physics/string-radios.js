// <string-radios>: radio buttons, each tied to a string that vibrates with the wave equation when chosen.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, options, clamp, TAU, reduced } from '../kit.js';

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
