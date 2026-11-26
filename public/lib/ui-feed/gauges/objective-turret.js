// <objective-turret>: four radios, the objectives of a microscope, and the view through the chosen one.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, clamp, smooth, rr, spring, TAU, reduced } from '../kit.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const SANS = "'Helvetica Neue', Arial, ui-sans-serif, sans-serif";

// #region objective-turret
// Four radios. Choosing one turns the turret a quarter turn for each step, and the view through the eyepiece
// goes dark while no objective is over the slide, then comes back at the new magnification, out of focus at
// first. The specimen is a drawing made of a few hundred cells with positions in millimetres, so each
// objective shows more of the same thing, not a larger picture of it.
const OBJECTIVES = [
  { x: 4, fov: 4.5, text: 'PLAN 4/0.10 160/−', band: '#e23a2e', bar: [1, '1 mm'], at: [0, 0] },
  { x: 10, fov: 1.8, text: 'PLAN 10/0.25 160/0.17', band: '#f2c230', bar: [0.4, '400 µm'], at: [0, 0] },
  { x: 40, fov: 0.45, text: 'PLAN 40/0.65 160/0.17', band: '#3a9be8', bar: [0.1, '100 µm'], at: [0.03, -0.02] },
  { x: 100, fov: 0.18, text: 'PLAN 100/1.25 OIL 160/0.17', band: '#1a1a1a', bar: [0.04, '40 µm'], at: [0.3, -0.16] },
];
// The specimen: a root in cross-section. Rings of cells round a core with a cross of water vessels.
let CELLS = null;
function cells() {
  if (CELLS) return CELLS;
  CELLS = [];
  let id = 0;
  for (let ring = 0, r = 0.21; r < 0.8; ring++) {
    const size = 0.034 + ring * 0.0035 + (ring > 9 ? -0.012 : 0), n = Math.floor((TAU * r) / (size * 2));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + ring * 0.37, j = rnd(id) - 0.5;
      CELLS.push({ x: Math.cos(a) * (r + j * 0.008), y: Math.sin(a) * (r + j * 0.008), r: size * (0.92 + rnd(id + 5) * 0.14), a: a + j, grains: Math.floor(rnd(id + 2) * 9), id, skin: r + size * 2 > 0.8 });
      id++;
    }
    r += size * 1.9;
  }
  // the core: small packed cells, and four arms of large vessels
  for (let i = 0; i < 90; i++) { const a = rnd(i + 500) * TAU, r = 0.03 + Math.sqrt(rnd(i + 600)) * 0.15; CELLS.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 0.011 + rnd(i + 700) * 0.008, a, core: true, id: id++ }); }
  for (let arm = 0; arm < 4; arm++) for (let k = 0; k < 5; k++) { const a = arm * (TAU / 4), r = 0.012 + k * 0.034; CELLS.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, r: 0.021 - k * 0.0028, a, vessel: true, id: id++ }); }
  CELLS.push({ x: 0, y: 0, r: 0.024, a: 0, vessel: true, id: id++ });
  return CELLS;
}

export class ObjectiveTurret extends FeedControl {
  static size = [360, 384];
  static html = OBJECTIVES.map((o, i) => `<input type="radio" name="objective" id="o${i}" value="${o.x}" aria-label="${o.x} times${o.x === 100 ? ', oil immersion' : ''}"><label for="o${i}">${o.x}×${o.x === 100 ? '<small>OIL</small>' : ''}</label>`).join('')
    + `<span class="specimen"><slot>Specimen</slot></span><output class="fov"></output>`;
  static css = `
    input { width: 82px; height: 50px; opacity: 0; margin: 0; touch-action: manipulation; }
    label { width: 82px; height: 44px; font: 700 18px/44px ${SANS}; text-align: center; color: #0c4a3e; letter-spacing: -0.02em; cursor: pointer; white-space: nowrap; }
    label small { font-size: 8px; margin-left: 2px; }
    label.on { color: #fff; }
    .specimen { width: 120px; font: 600 11.5px/1.25 ${SANS}; color: #0c4a3e; }
    .fov { width: 110px; font: 700 20px/1 ${SANS}; color: #0c4a3e; text-align: right; letter-spacing: -0.02em; }`;
  static observedAttributes = ['value'];
  static C = { x: 180, y: 170 }; static R = 122;

  ready() {
    this.radios = this.$$('input'); this.labels = this.$$('label');
    this.canvas.setAttribute('role', 'radiogroup'); this.canvas.ariaLabel = 'Objective';
    const v = Number(this.getAttribute('value') ?? 10);
    (this.radios.find((r) => Number(r.value) === v) ?? this.radios[1]).checked = true;
    const i = this.index;
    this.turn = { x: i, v: 0 }; this.pill = { x: i, v: 0 }; this.shown = i; this.focus = 1;
    this.view = Object.assign(document.createElement('canvas'), { width: 1, height: 1 });      // a plain canvas: the specimen is drawn here, then blurred onto the control
    this.shadowRoot.addEventListener('change', () => { this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.sync();
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null) this.value = v; }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get value() { return this.radios[this.index].value; }
  set value(v) { const r = this.radios.find((x) => Number(x.value) === Number(v)); if (r) { r.checked = true; this.sync(); } }
  sync() {
    this.setValue(this.value);
    this.labels.forEach((l, i) => l.classList.toggle('on', i === this.index));
    this.request();
  }
  // Draw the cells that fall inside the field of view. `size` is the picture's width in pixels.
  specimen(o, size) {
    const c = this.view; if (c.width !== size) c.width = c.height = size;
    const g = c.getContext('2d'), k = size / o.fov;
    g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#f4fbf6'; g.fillRect(0, 0, size, size);
    g.setTransform(k, 0, 0, k, size / 2 - o.at[0] * k, size / 2 - o.at[1] * k);
    g.fillStyle = '#e4f4ea'; g.beginPath(); g.arc(0, 0, 0.81, 0, TAU); g.fill();
    g.fillStyle = '#f7dfe9'; g.beginPath(); g.arc(0, 0, 0.2, 0, TAU); g.fill();
    g.strokeStyle = '#c96a92'; g.lineWidth = Math.max(0.006, 1.2 / k); g.beginPath(); g.arc(0, 0, 0.2, 0, TAU); g.stroke();
    const half = o.fov / 2 + 0.06, wall = clamp(1.1 / k, 0.0012, 0.006);
    for (const cell of cells()) {
      if (Math.abs(cell.x - o.at[0]) > half || Math.abs(cell.y - o.at[1]) > half) continue;
      g.save(); g.translate(cell.x, cell.y); g.rotate(cell.a);
      g.beginPath(); g.ellipse(0, 0, cell.r, cell.r * (cell.vessel ? 1 : 0.86), 0, 0, TAU);
      g.fillStyle = cell.vessel ? '#fff' : cell.core ? '#bfe6dc' : cell.skin ? '#d7efe2' : '#f6fcf8'; g.fill();
      g.strokeStyle = cell.vessel ? '#d61f6b' : cell.core ? '#3f9c8f' : '#69b5a3'; g.lineWidth = cell.vessel ? wall * 3 : wall; g.stroke();
      // starch grains show once a cell is more than a few pixels across
      if (!cell.vessel && !cell.core && cell.r * k > 5) {
        g.fillStyle = '#d4488e';
        for (let i = 0; i < cell.grains; i++) { const a = rnd(cell.id * 9 + i) * TAU, d = Math.sqrt(rnd(cell.id * 5 + i)) * cell.r * 0.62; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d * 0.86, cell.r * 0.085, 0, TAU); g.fill(); }
        if (cell.r * k > 40) { g.strokeStyle = 'rgba(105,181,163,0.5)'; g.lineWidth = wall * 0.6; g.beginPath(); g.ellipse(0, 0, cell.r * 0.93, cell.r * 0.8, 0, 0, TAU); g.stroke(); }
      }
      g.restore();
    }
  }

  draw(ctx, w, h) {
    const { C, R } = ObjectiveTurret, i = this.index;
    // #region turret-step
    let live = spring(this.turn, i, this.dt, 60, 11);
    // light reaches the eyepiece only while an objective is in line: the view darkens between two clicks
    const off = Math.abs(this.turn.x - Math.round(this.turn.x)), light = reduced() ? 1 : clamp(1 - off * 3.2);
    this.light = light;
    const over = clamp(Math.round(this.turn.x), 0, OBJECTIVES.length - 1);
    if (over !== this.shown && off < 0.3) { this.shown = over; this.focus = reduced() ? 1 : 0; this.drawn = null; }
    if (this.shown === i && this.focus < 1) { this.focus = clamp(this.focus + this.dt / 0.7); live = true; }   // the fine focus comes in
    // #endregion turret-step
    live = spring(this.pill, i, this.dt, 300, 26) || live;
    const o = OBJECTIVES[this.shown], size = Math.round(R * 2 * this.px);
    if (this.drawn !== `${this.shown}:${size}`) { this.specimen(o, size); this.drawn = `${this.shown}:${size}`; }
    const fov = this.$('.fov'), fovText = o.fov >= 1 ? `${o.fov} mm` : `${Math.round(o.fov * 1000)} µm`;
    if (fov.textContent !== fovText) fov.textContent = fovText;

    ctx.fillStyle = '#b8f0dc'; ctx.fillRect(0, 0, w, h);
    // the turret ring, engraved, turning a quarter turn for each objective
    ctx.fillStyle = 'rgba(12,74,62,0.18)'; ctx.beginPath(); ctx.arc(C.x, C.y + 4, R + 22, 0, TAU); ctx.fill();
    const ringG = ctx.createLinearGradient(0, C.y - R - 20, 0, C.y + R + 20); ringG.addColorStop(0, '#ffffff'); ringG.addColorStop(1, '#e3ece8');
    ctx.fillStyle = ringG; ctx.beginPath(); ctx.arc(C.x, C.y, R + 20, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(-this.turn.x * (TAU / 4));
    ctx.strokeStyle = 'rgba(12,74,62,0.25)'; ctx.lineWidth = 0.5; ctx.beginPath();
    for (let k = 0; k < 120; k++) { const a = (k / 120) * TAU; ctx.moveTo(Math.cos(a) * (R + 17), Math.sin(a) * (R + 17)); ctx.lineTo(Math.cos(a) * (R + 20), Math.sin(a) * (R + 20)); }
    ctx.stroke();
    OBJECTIVES.forEach((ob, k) => {
      ctx.save(); ctx.rotate(k * (TAU / 4));
      ctx.strokeStyle = ob.band; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(0, 0, R + 17, -Math.PI / 2 - 0.36, -Math.PI / 2 + 0.36); ctx.stroke();
      ctx.fillStyle = '#31504a'; ctx.font = `600 7.5px ui-monospace, Menlo, Consolas, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      [...ob.text].forEach((ch, n) => { ctx.save(); ctx.rotate((n - (ob.text.length - 1) / 2) * 0.037); ctx.fillText(ch, 0, -(R + 9)); ctx.restore(); });
      ctx.restore();
    });
    ctx.restore();
    // the view
    ctx.save(); ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.clip();
    const blur = (1 - smooth(this.focus)) * 7 + off * 10;
    if (blur > 0.15) ctx.filter = `blur(${(blur * this.px).toFixed(2)}px)`;
    ctx.drawImage(this.view, C.x - R, C.y - R, R * 2, R * 2);
    ctx.filter = 'none';
    const vig = ctx.createRadialGradient(C.x, C.y, R * 0.55, C.x, C.y, R); vig.addColorStop(0, 'rgba(0,20,15,0)'); vig.addColorStop(1, 'rgba(0,20,15,0.3)');
    ctx.fillStyle = vig; ctx.fillRect(C.x - R, C.y - R, R * 2, R * 2);
    if (light < 1) { ctx.fillStyle = `rgba(4,16,13,${1 - light})`; ctx.fillRect(C.x - R, C.y - R, R * 2, R * 2); }
    ctx.restore();
    ctx.strokeStyle = '#0c4a3e'; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(C.x, C.y, R, 0, TAU); ctx.stroke();
    // the scale bar, for the objective that is in line
    const bw = (o.bar[0] / o.fov) * R * 2;
    ctx.globalAlpha = light * smooth(this.focus * 2);
    ctx.fillStyle = '#fff'; rr(ctx, C.x - Math.max(bw, 44) / 2 - 10, C.y + R - 50, Math.max(bw, 44) + 20, 30, 8); ctx.fill();
    ctx.fillStyle = '#0c4a3e'; ctx.font = `700 9.5px ${SANS}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(o.bar[1], C.x, C.y + R - 40);
    ctx.strokeStyle = '#0c4a3e'; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(C.x - bw / 2, C.y + R - 28); ctx.lineTo(C.x + bw / 2, C.y + R - 28);
    ctx.moveTo(C.x - bw / 2, C.y + R - 31); ctx.lineTo(C.x - bw / 2, C.y + R - 25); ctx.moveTo(C.x + bw / 2, C.y + R - 31); ctx.lineTo(C.x + bw / 2, C.y + R - 25); ctx.stroke();
    ctx.globalAlpha = 1;
    // captions
    ctx.fillStyle = '#31504a'; ctx.font = `600 7.5px ${SANS}`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText('S P E C I M E N', 12, 14); ctx.textAlign = 'right'; ctx.fillText('F I E L D   O F   V I E W', w - 12, 14);
    put(ctx, this.$('.specimen'), 12, 22); put(ctx, fov, w - 122, 24);
    // the four radios, as one bar with a pill that slides to the checked one
    const BX = 14, BW = 83, BY = 326;
    ctx.fillStyle = '#fff'; rr(ctx, BX - 4, BY - 4, BW * 4 + 8, 52, 26); ctx.fill();
    ctx.fillStyle = '#c4107a'; rr(ctx, BX + this.pill.x * BW + 2, BY, BW - 4, 44, 22); ctx.fill();
    this.labels.forEach((l, k) => put(ctx, l, BX + k * BW + 0.5, BY));
    this.radios.forEach((r, k) => {
      if (r.matches(':focus-visible')) { ctx.strokeStyle = '#0c4a3e'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); rr(ctx, BX + k * BW, BY - 2, BW, 48, 24); ctx.stroke(); ctx.setLineDash([]); }
      hit(ctx, r, BX + k * BW, BY - 3, BW, 50);
    });
    return live;
  }
}
customElements.define('objective-turret', ObjectiveTurret);
// #endregion objective-turret
