// <record-speed>: three radios and a turntable platter that runs up to the chosen speed.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, rr, spring, TAU, reduced } from '../kit.js';

let grainTile = null;
function grain(ctx, w, h, alpha = 0.06) {
  if (!grainTile) {
    grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 96;
    const g = grainTile.getContext('2d'), d = g.createImageData(96, 96);
    let s = 11;
    for (let i = 0; i < d.data.length; i += 4) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      const v = (s >> 8) & 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v > 127 ? 255 : 0; d.data[i + 3] = Math.abs(v - 127);
    }
    g.putImageData(d, 0, 0);
  }
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = ctx.createPattern(grainTile, 'repeat'); ctx.fillRect(0, 0, w, h); ctx.restore();
}
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// #region record-speed
// Three radios. The platter has an angle and a speed, and the motor pulls the speed toward the chosen one
// with a time constant of 0.7 s, so a change from 33 to 78 is heard, or here seen, as a run-up.
export class RecordSpeed extends FeedControl {
  static size = [360, 384];
  static SPEEDS = [['33.33', '33⅓'], ['45', '45'], ['78', '78']];
  static html = RecordSpeed.SPEEDS.map(([v, text], i) => `<input type="radio" name="rpm" id="s${i}" value="${v}" aria-label="${text} rpm"><label for="s${i}">${text}</label>`).join('') + `<span class="title"><slot>Side A</slot></span>`;
  static css = `
    input { width: 90px; height: 92px; opacity: 0; margin: 0; touch-action: manipulation; }
    label { width: 90px; text-align: center; font: 600 25px/1.2 'Avenir Next', 'Futura', 'Century Gothic', ui-sans-serif, sans-serif; color: #fff; letter-spacing: 0.02em; cursor: pointer; }
    .title { font: 600 8px/1 ui-sans-serif, sans-serif; color: #fff; }`;
  static observedAttributes = ['value'];
  static P = { x: 138, y: 142 };          // the spindle
  static SLOT = [62, 152, 242];           // where the knob rests for each speed

  ready() {
    this.radios = this.$$('input'); this.labels = this.$$('label');
    this.canvas.setAttribute('role', 'radiogroup'); this.canvas.ariaLabel = 'Speed';
    const v = this.getAttribute('value') ?? '45';
    for (const r of this.radios) r.checked = Number(r.value).toFixed(0) === Number(v).toFixed(0);
    if (!this.$('input:checked')) this.radios[1].checked = true;
    this.turn = { a: 0, w: this.rpm * TAU / 60 };
    this.knob = { x: RecordSpeed.SLOT[this.index], v: 0 };
    this.shadowRoot.addEventListener('change', () => { this.setValue(this.value); this.dispatchEvent(new Event('change', { bubbles: true })); });
    this.setValue(this.value);
  }
  attributeChangedCallback(_, __, v) { if (this.radios && v !== null) this.value = v; }
  get index() { return Math.max(0, this.radios.findIndex((r) => r.checked)); }
  get rpm() { return [100 / 3, 45, 78][this.index]; }
  get value() { return this.radios[this.index].value; }
  set value(v) { for (const r of this.radios) r.checked = Number(r.value).toFixed(0) === Number(v).toFixed(0); this.setValue(this.value); this.request(); }

  draw(ctx, w, h) {
    const { P, SLOT } = RecordSpeed, t = this.turn;
    // #region record-step
    const want = (this.rpm * TAU) / 60;
    t.w += (want - t.w) * (1 - Math.exp(-this.dt / 0.7));
    if (!reduced()) t.a = (t.a + t.w * this.dt) % TAU;
    // #endregion record-step
    const moving = spring(this.knob, SLOT[this.index], this.dt, 260, 24);

    ctx.fillStyle = '#ffd200'; ctx.fillRect(0, 0, w, h);
    // hard sunlight from the upper left: every part throws a shadow down and to the right
    ctx.fillStyle = '#d79f00'; rr(ctx, 26, 26, 290, 344, 5); ctx.fill();
    const blue = ctx.createLinearGradient(0, 0, w, h); blue.addColorStop(0, '#2247e0'); blue.addColorStop(1, '#1a36c4');
    ctx.fillStyle = blue; rr(ctx, 10, 10, 290, 344, 5); ctx.fill();
    grain(ctx, 300, 354, 0.03);
    // the 45 adapter left beside the deck
    ctx.save(); ctx.translate(330, 36);
    ctx.fillStyle = '#d79f00'; ctx.beginPath(); ctx.arc(6, 6, 19, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e3202b'; ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.arc(0, 0, 5, 0, TAU, true); ctx.fill('evenodd');
    ctx.restore();
    ctx.save(); ctx.translate(330, 36); ctx.fillStyle = '#ffd200';
    for (let i = 0; i < 3; i++) { ctx.rotate(TAU / 3); ctx.beginPath(); ctx.ellipse(0, -12.5, 6.5, 3.2, 0, 0, TAU); ctx.fill(); }
    ctx.restore();

    // mat, record and grooves
    ctx.fillStyle = 'rgba(8,16,70,0.55)'; ctx.beginPath(); ctx.arc(P.x + 9, P.y + 9, 124, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222224'; ctx.beginPath(); ctx.arc(P.x, P.y, 124, 0, TAU); ctx.fill();
    ctx.fillStyle = '#0c0c0d'; ctx.beginPath(); ctx.arc(P.x, P.y, 114, 0, TAU); ctx.fill();
    ctx.lineWidth = 0.5;
    for (let r = 46; r < 112; r += 2.2) {
      ctx.strokeStyle = `rgba(255,255,255,${0.035 + 0.03 * rnd(Math.round(r * 5))})`;
      ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, TAU); ctx.stroke();
    }
    // the bands between tracks, and a slight warp, turn with the record
    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(t.a);
    ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = 1.6;
    for (const r of [62, 81, 97]) { ctx.beginPath(); ctx.ellipse(0.6, 0, r, r - 0.5, 0, 0, TAU); ctx.stroke(); }
    ctx.restore();
    // the light on the grooves stays where the lamp is while the record turns under it
    const shine = ctx.createConicGradient(-0.9, P.x, P.y);
    for (const [at, a] of [[0, 0.3], [0.06, 0.02], [0.44, 0.02], [0.5, 0.22], [0.56, 0.02], [0.94, 0.02], [1, 0.3]]) shine.addColorStop(at, `rgba(255,255,255,${a})`);
    ctx.fillStyle = shine; ctx.beginPath(); ctx.arc(P.x, P.y, 113, 0, TAU); ctx.arc(P.x, P.y, 44, 0, TAU, true); ctx.fill('evenodd');
    // the label turns: rays, a name round the top and the slotted side text
    ctx.save(); ctx.translate(P.x, P.y); ctx.rotate(t.a);
    ctx.fillStyle = '#e3202b'; ctx.beginPath(); ctx.arc(0, 0, 40, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 0.7; ctx.beginPath();
    for (let i = 0; i <= 14; i++) { const a = Math.PI + (i / 14) * Math.PI; ctx.moveTo(Math.cos(a) * 7, Math.sin(a) * 7); ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30); }
    ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = "700 8px 'Avenir Next', 'Futura', ui-sans-serif, sans-serif";
    const name = (this.getAttribute('label') ?? 'CANVAS').toUpperCase();
    [...name].forEach((ch, i) => { const a = (i - (name.length - 1) / 2) * 0.24; ctx.save(); ctx.rotate(-a); ctx.fillText(ch, 0, 31); ctx.restore(); });
    put(ctx, this.$('.title'), -this.$('.title').offsetWidth / 2, 10);
    ctx.restore();
    const sp = ctx.createRadialGradient(P.x - 1.5, P.y - 1.5, 0.5, P.x, P.y, 5); sp.addColorStop(0, '#fff'); sp.addColorStop(1, '#7f858c');
    ctx.fillStyle = sp; ctx.beginPath(); ctx.arc(P.x, P.y, 4.2, 0, TAU); ctx.fill();

    // tonearm: counterweight, pivot, tube and headshell, with its shadow on the deck
    const arm = (dx, dy, shade) => {
      ctx.save(); ctx.translate(dx, dy);
      const metal = (x0, x1) => { if (shade) return shade; const g = ctx.createLinearGradient(x0, 0, x1, 0); g.addColorStop(0, '#8a8f96'); g.addColorStop(0.35, '#f1f3f5'); g.addColorStop(1, '#6f747b'); return g; };
      ctx.fillStyle = metal(254, 290); rr(ctx, 254, 16, 36, 30, 4); ctx.fill();
      ctx.fillStyle = metal(262, 282); ctx.beginPath(); ctx.arc(272, 78, 15, 0, TAU); ctx.fill();
      ctx.strokeStyle = metal(268, 276); ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(272, 44); ctx.lineTo(272, 196); ctx.stroke();
      ctx.fillStyle = shade ?? '#3a3b3f'; ctx.beginPath(); ctx.moveTo(277, 190); ctx.lineTo(268, 214); ctx.lineTo(234, 230); ctx.lineTo(229, 220); ctx.lineTo(256, 200); ctx.closePath(); ctx.fill();
      ctx.restore();
    };
    arm(10, 10, 'rgba(8,16,70,0.45)'); arm(0, 0, null);

    // the speeds: the labels are elements, and the knob slides to the checked one
    this.labels.forEach((l, i) => { ctx.save(); ctx.globalAlpha = this.radios[i].checked ? 1 : 0.82; put(ctx, l, SLOT[i] - 45, 268, 90); ctx.restore(); });
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = "700 6.5px ui-sans-serif, sans-serif"; ctx.textAlign = 'left'; ctx.fillText('R P M', 22, 318);
    ctx.strokeStyle = '#0a0f33'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(54, 318); ctx.lineTo(250, 318); ctx.stroke();
    ctx.fillStyle = 'rgba(8,16,70,0.5)'; ctx.beginPath(); ctx.arc(this.knob.x + 9, 318 + 9, 14, 0, TAU); ctx.fill();
    const kn = ctx.createConicGradient(this.knob.x * 0.02, this.knob.x, 318);
    for (let i = 0; i <= 8; i++) kn.addColorStop(i / 8, i % 2 ? '#8b9097' : '#f3f4f6');
    ctx.fillStyle = kn; ctx.beginPath(); ctx.arc(this.knob.x, 318, 14, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.6; ctx.beginPath(); ctx.arc(this.knob.x, 318, 14, 0, TAU); ctx.stroke();
    this.radios.forEach((r, i) => {
      if (r.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]); rr(ctx, SLOT[i] - 40, 260, 80, 78, 8); ctx.stroke(); ctx.setLineDash([]); }
      hit(ctx, r, SLOT[i] - 45, 254, 90, 92);
    });
    return !reduced() || moving;
  }
}
customElements.define('record-speed', RecordSpeed);
// #endregion record-speed
