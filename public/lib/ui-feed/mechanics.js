// ui-feed/mechanics.js: five controls drawn as machines, rebuilt from demos on ui-feed.dev.
//
//   <tappet-timer name value="06:00-07:15">    96 checkboxes, the tappets round the dial of a 24-hour timer
//   <record-speed name value="45">             three radios, and a record that turns at the chosen speed
//   <darkroom-timer name min max value>        an <input type="number"> shown as a tape behind a red window
//   <pendant-card>                             buttons with a card, lit by a lamp that swings to the one in use
//   <morse-complete name>                      a text field with suggestions, and a key that types in Morse
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /mech-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, smooth, rr, spring, TAU, reduced } from './kit.js';

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
const NARROW = "'DIN Condensed', 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif";
const hhmm = (q) => `${String(Math.floor(q / 4) % 24).padStart(2, '0')}:${String((q % 4) * 15).padStart(2, '0')}`;

// #region tappet-timer
// A plug-in timer has a ring of 96 tappets, one for each quarter of an hour, and the ring turns once a day
// past a fixed pointer. A tappet pushed out switches the socket on for its quarter. Here each tappet is an
// <input type="checkbox">, placed on the ring with a rotated draw that has no alpha.
export class TappetTimer extends FeedControl {
  static size = [360, 384];
  static html = `<output class="state"></output>`;
  static css = `
    input { width: 30px; height: 9px; opacity: 0; margin: 0; touch-action: manipulation; }
    .state { width: 280px; font: 500 12.5px/1.3 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color: #4b4a45; text-align: center; white-space: nowrap; }`;
  static C = { x: 180, y: 186 };
  static R0 = 122; static R1 = 146;        // the ring the tappets sit in
  static POINTER = (225 * Math.PI) / 180;   // the fixed mark, at the upper left

  ready() {
    this.boxes = [];
    for (let q = 0; q < 96; q++) {
      const input = Object.assign(document.createElement('input'), { type: 'checkbox', tabIndex: q ? -1 : 0, ariaLabel: `${hhmm(q)} to ${hhmm(q + 1)}` });
      input.setAttribute('drawable', '');
      this.canvas.append(input);
      this.boxes.push({ input, s: { x: 0, v: 0 } });
    }
    this.canvas.setAttribute('role', 'group');
    this.canvas.ariaLabel = this.getAttribute('aria-label') ?? 'Switched on';
    this.value = this.getAttribute('value') ?? '';
    for (const b of this.boxes) b.s.x = b.input.checked ? 1 : 0;
    this.shadowRoot.addEventListener('change', () => { this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); });
    // One tappet is in the tab order. Left and Right move round the ring.
    this.canvas.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -4, ArrowDown: 4 }[e.key];
      const at = this.boxes.findIndex((b) => b.input === this.shadowRoot.activeElement);
      if (!step || at < 0) return;
      e.preventDefault();
      const to = this.boxes[(at + step + 96) % 96].input;
      this.boxes[at].input.tabIndex = -1; to.tabIndex = 0; to.focus({ preventScroll: true });
      this.request();
    });
    // The ring turns with the clock, a quarter of a degree a minute.
    this.clock = setInterval(() => { this.sync(); }, 30000);
  }
  disconnectedCallback() { clearInterval(this.clock); }
  // The time of day in hours. A page can set `now` to hold the dial still.
  get hours() { if (this.now != null) return this.now; const d = new Date(); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
  // The value is the list of spans that are on: "06:00-07:15,18:30-22:00".
  get value() {
    const out = [];
    for (let q = 0; q < 96; q++) {
      if (!this.boxes[q].input.checked) continue;
      let end = q; while (end < 95 && this.boxes[end + 1].input.checked) end++;
      out.push(`${hhmm(q)}-${end === 95 ? '24:00' : hhmm(end + 1)}`);
      q = end;
    }
    return out.join(',');
  }
  set value(v) {
    const on = new Set();
    for (const span of String(v).split(',')) {
      const m = span.trim().match(/^(\d\d):(\d\d)-(\d\d):(\d\d)$/);
      if (m) for (let q = m[1] * 4 + Math.floor(m[2] / 15); q < m[3] * 4 + Math.floor(m[4] / 15); q++) on.add(q);
    }
    this.boxes.forEach((b, q) => { b.input.checked = on.has(q); });
    this.sync();
  }
  sync() {
    const n = this.boxes.filter((b) => b.input.checked).length, nowOn = this.boxes[Math.floor(this.hours * 4) % 96].input.checked;
    this.setValue(this.value || null);
    this.$('.state').textContent = `${Math.floor(n / 4)} h ${String((n % 4) * 15).padStart(2, '0')} min a day · ${nowOn ? 'on' : 'off'} now`;
    this.request();
  }
  // Where a time of day is on the dial, as a canvas angle. Later is anticlockwise, because the ring turns clockwise.
  angle(hours) { return TappetTimer.POINTER - ((hours - this.hours) / 24) * TAU; }

  draw(ctx, w, h) {
    const { C, R0, R1, POINTER } = TappetTimer;
    let live = false;
    ctx.fillStyle = '#12a150'; ctx.fillRect(0, 0, w, h);
    // the body of the timer, which runs off the bottom
    ctx.save(); ctx.shadowColor = 'rgba(0,40,15,0.45)'; ctx.shadowBlur = 14 * this.px; ctx.shadowOffsetY = 4 * this.px;
    ctx.fillStyle = '#ece9e1'; rr(ctx, 14, 14, w - 28, h + 30, 30); ctx.fill(); ctx.restore();
    const sheen = ctx.createLinearGradient(0, 14, 0, h); sheen.addColorStop(0, 'rgba(255,255,255,0.5)'); sheen.addColorStop(0.3, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen; rr(ctx, 14, 14, w - 28, h + 30, 30); ctx.fill();
    grain(ctx, w, h, 0.03);
    // the channel the tappets slide in
    ctx.fillStyle = '#151515'; ctx.beginPath(); ctx.arc(C.x, C.y, R1 + 5, 0, TAU); ctx.arc(C.x, C.y, R0 - 3, 0, TAU, true); ctx.fill('evenodd');
    const wide = ((R0 + R1) / 2) * (TAU / 96) - 1.5;
    this.boxes.forEach((b, q) => {
      if (spring(b.s, b.input.checked ? 1 : 0, this.dt, 520, 26)) live = true;
      const a = this.angle((q + 0.5) / 4), push = b.s.x * 5;
      ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(a);
      // a tappet seen from above: a slab, lit from the left, with a red top when it is out
      const g = ctx.createLinearGradient(R0 + push, 0, R1 + push, 0);
      const k = clamp(b.s.x);
      g.addColorStop(0, `rgb(${Math.round(lerp(205, 150, k))},${Math.round(lerp(203, 26, k))},${Math.round(lerp(196, 20, k))})`);
      g.addColorStop(0.2, `rgb(${Math.round(lerp(250, 232, k))},${Math.round(lerp(249, 44, k))},${Math.round(lerp(245, 34, k))})`);
      g.addColorStop(1, `rgb(${Math.round(lerp(236, 214, k))},${Math.round(lerp(234, 34, k))},${Math.round(lerp(228, 26, k))})`);
      ctx.fillStyle = g; rr(ctx, R0 + push, -wide / 2, R1 - R0, wide, 1.6); ctx.fill();
      if (push > 0.3) { ctx.fillStyle = `rgba(245,243,238,${k})`; ctx.fillRect(R0, -wide / 2, push, wide); }   // the neck it leaves behind
      if (b.input.matches(':focus-visible')) { ctx.strokeStyle = '#0b63ff'; ctx.lineWidth = 2; rr(ctx, R0 - 3, -wide / 2 - 2, R1 - R0 + 11, wide + 4, 3); ctx.stroke(); }
      hit(ctx, b.input, R0 - 3, -4.5, 30, 9);
      ctx.restore();
    });
    // the face: hours round the edge, turned with the ring
    ctx.fillStyle = '#f1efe8'; ctx.beginPath(); ctx.arc(C.x, C.y, R0 - 4, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#1a1a18'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(C.x, C.y, R0 - 4, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#1a1a18'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `600 21px ${NARROW}`;
    for (let hr = 0; hr < 24; hr++) {
      const a = this.angle(hr);
      ctx.save(); ctx.translate(C.x, C.y); ctx.rotate(a);
      ctx.lineWidth = hr % 2 ? 0.7 : 1.2; ctx.beginPath(); ctx.moveTo(R0 - 5, 0); ctx.lineTo(R0 - (hr % 2 ? 10 : 13), 0); ctx.stroke();
      if (hr % 2 === 0) { ctx.translate(R0 - 30, 0); ctx.rotate(Math.PI / 2); ctx.fillText(String(hr || 24), 0, 1); }
      ctx.restore();
    }
    ctx.lineWidth = 0.8; ctx.beginPath(); ctx.arc(C.x, C.y, 66, 0, TAU); ctx.stroke();
    ctx.lineWidth = 4; ctx.lineCap = 'butt'; ctx.beginPath(); ctx.arc(C.x, C.y, 58, this.angle(21), this.angle(21) + TAU * 0.52); ctx.stroke();
    // the knob in the middle
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 8 * this.px; ctx.shadowOffsetY = 3 * this.px;
    const kg = ctx.createRadialGradient(C.x - 14, C.y - 16, 4, C.x, C.y, 46);
    kg.addColorStop(0, '#ffffff'); kg.addColorStop(0.6, '#eceae3'); kg.addColorStop(1, '#cfccc3');
    ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(C.x, C.y, 44, 0, TAU); ctx.fill(); ctx.restore();
    // the fixed pointer
    ctx.save(); ctx.translate(C.x + Math.cos(POINTER) * (R1 + 14), C.y + Math.sin(POINTER) * (R1 + 14)); ctx.rotate(POINTER);
    ctx.fillStyle = '#1a1a18'; ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(5, -8); ctx.lineTo(5, 8); ctx.closePath(); ctx.fill(); ctx.restore();
    put(ctx, this.$('.state'), 40, 356, 280);
    return live;
  }
}
customElements.define('tappet-timer', TappetTimer);
// #endregion tappet-timer

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

// #region darkroom-timer
// The seconds of an enlarger timer, under a safelight. The value is an <input type="number"> that lies over
// the window, so it can be typed in. The numbers are printed on a tape round a drum: each one is placed by
// the sine of its angle on the drum and narrowed by the cosine, which is what a cylinder looks like from the
// front. The knob is an <input type="range"> turned by the direction of the pointer from its centre.
export class DarkroomTimer extends FeedControl {
  static size = [360, 372];
  static html = `<input type="number" class="value" inputmode="numeric" aria-label="Seconds"><button type="button" class="dec" aria-label="One second less"></button><input type="range" class="knob" aria-label="Seconds, turn"><button type="button" class="inc" aria-label="One second more"></button>`;
  static css = `
    .value { width: 312px; height: 150px; opacity: 0; font-size: 40px; text-align: center; touch-action: manipulation; }
    .dec, .inc { width: 66px; height: 66px; opacity: 0; touch-action: manipulation; }
    .knob { width: 92px; height: 92px; opacity: 0; touch-action: none; }`;
  static observedAttributes = ['value'];
  static K = { x: 180, y: 292 };
  static STEP = 108; static DRUM = 196;     // tape between two numbers, and the radius of the drum, in units

  ready() {
    this.field = this.$('.value'); this.knob = this.$('.knob');
    this.min = Number(this.getAttribute('min') ?? 1); this.max = Number(this.getAttribute('max') ?? 60);
    Object.assign(this.field, { min: this.min, max: this.max, step: 1 });
    Object.assign(this.knob, { min: this.min, max: this.max, step: 1 });
    this.v = clamp(Math.round(Number(this.getAttribute('value') ?? 8)), this.min, this.max);
    this.tape = { x: this.v, v: 0 };
    this.field.addEventListener('input', () => { if (Number.isFinite(this.field.valueAsNumber)) this.set(this.field.valueAsNumber, false, true); });
    this.field.addEventListener('change', () => this.set(this.v, true));
    this.$('.dec').addEventListener('click', () => this.set(this.v - 1, true));
    this.$('.inc').addEventListener('click', () => this.set(this.v + 1, true));
    const k = this.knob;
    const dir = (e) => { const r = this.canvas.getBoundingClientRect(), s = r.width / DarkroomTimer.size[0]; return Math.atan2(e.clientY - r.top - DarkroomTimer.K.y * s, e.clientX - r.left - DarkroomTimer.K.x * s); };
    k.addEventListener('pointerdown', (e) => { if (e.button) return; k.setPointerCapture(e.pointerId); this.grip = { a: dir(e), at: this.tape.x }; e.preventDefault(); k.focus({ preventScroll: true }); });
    k.addEventListener('pointermove', (e) => {
      if (!this.grip) return;
      let d = dir(e) - this.grip.a; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.grip.a += d;
      // a tenth of a turn for each second, and the tape follows the hand between the numbers
      this.grip.at = clamp(this.grip.at + d / (TAU / 10), this.min, this.max);
      this.tape.x = this.grip.at; this.tape.v = 0;
      this.set(Math.round(this.grip.at), false);
    });
    const drop = () => { if (!this.grip) return; this.grip = null; this.set(this.v, true); };
    k.addEventListener('pointerup', drop); k.addEventListener('pointercancel', drop);
    k.addEventListener('input', () => { if (!this.grip) this.set(k.valueAsNumber, false); });
    k.addEventListener('change', () => { if (!this.grip) this.set(this.v, true); });
    this.set(this.v, false);
  }
  attributeChangedCallback(_, __, v) { if (this.field && v !== null) this.value = v; }
  get value() { return String(this.v); }
  set value(v) { this.set(Number(v), false); }
  set(v, done, typing = false) {
    v = clamp(Math.round(Number(v) || 0), this.min, this.max);
    const changed = v !== this.v;
    this.v = v;
    this.setValue(String(v));
    if (!typing) this.field.value = v;
    if (!this.grip) this.knob.value = v;
    if (changed) this.dispatchEvent(new Event('input', { bubbles: true }));
    if (done) this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }

  draw(ctx, w, h) {
    const { K, STEP, DRUM } = DarkroomTimer, RED = '#ff2f4a';
    let live = false;
    if (!this.grip) { if (reduced()) this.tape.x = this.v; else live = spring(this.tape, this.v, this.dt, 170, 22); }
    const pos = this.tape.x;
    ctx.fillStyle = '#050203'; ctx.fillRect(0, 0, w, h);
    // the case, edged by the safelight
    const rim = ctx.createLinearGradient(0, 0, w, h * 0.6); rim.addColorStop(0, 'rgba(255,47,74,0.75)'); rim.addColorStop(0.5, 'rgba(255,47,74,0.12)'); rim.addColorStop(1, 'rgba(255,47,74,0.03)');
    ctx.strokeStyle = rim; ctx.lineWidth = 1.4;
    rr(ctx, 8, 8, w - 16, h - 16, 24); ctx.stroke(); rr(ctx, 16, 16, w - 32, 190, 18); ctx.stroke();
    // the window: a band of the drum, bowed at the top and bottom
    const X = 24, Y = 26, W = 312, H = 164, cx = X + W / 2;
    const band = () => { ctx.beginPath(); ctx.moveTo(X, Y + 10); ctx.quadraticCurveTo(cx, Y - 6, X + W, Y + 10); ctx.lineTo(X + W, Y + H - 10); ctx.quadraticCurveTo(cx, Y + H + 8, X, Y + H - 10); ctx.closePath(); };
    ctx.save(); band(); ctx.clip();
    const glow = ctx.createRadialGradient(cx, Y + H * 0.45, 10, cx, Y + H * 0.45, W * 0.62);
    glow.addColorStop(0, '#ff2f4a'); glow.addColorStop(0.55, '#c8142c'); glow.addColorStop(1, '#4d0611');
    ctx.fillStyle = glow; ctx.fillRect(X, Y - 8, W, H + 18);
    grain(ctx, w, h, 0.09);
    // the numbers on the drum
    ctx.fillStyle = '#12050a'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = `700 150px ${NARROW}`;
    const first = Math.max(this.min, Math.floor(pos) - 2), last = Math.min(this.max, Math.ceil(pos) + 2);
    for (let n = first; n <= last; n++) {
      const phi = ((n - pos) * STEP) / DRUM;
      if (Math.abs(phi) > 1.35) continue;
      ctx.save(); ctx.translate(cx + Math.sin(phi) * DRUM, Y + 134 - (1 - Math.cos(phi)) * 6); ctx.scale(Math.cos(phi) * 0.66, 1);
      ctx.globalAlpha = clamp(Math.cos(phi) * 1.3); ctx.fillText(String(n), 0, 0); ctx.restore();
    }
    // sprocket holes along the top and a scale of tenths along the bottom, both on the tape
    for (let i = Math.floor((pos - 2) * 8); i <= (pos + 2) * 8; i++) {
      const phi = ((i / 8 - pos) * STEP) / DRUM; if (Math.abs(phi) > 1.4) continue;
      const x = cx + Math.sin(phi) * DRUM, c = Math.cos(phi), bow = (1 - c) * 9;
      ctx.fillStyle = '#12050a'; ctx.fillRect(x - 3.2 * c, Y + 5 + bow, 6.4 * c, 2.6);
    }
    ctx.strokeStyle = '#12050a';
    for (let i = Math.floor((pos - 2) * 10); i <= (pos + 2) * 10; i++) {
      if (i < this.min * 10 || i > this.max * 10) continue;
      const phi = ((i / 10 - pos) * STEP) / DRUM; if (Math.abs(phi) > 1.4) continue;
      const x = cx + Math.sin(phi) * DRUM, bow = (1 - Math.cos(phi)) * 9, len = i % 10 === 0 ? 16 : i % 5 === 0 ? 11 : 6;
      ctx.lineWidth = i % 10 === 0 ? 1.4 : 0.8; ctx.beginPath(); ctx.moveTo(x, Y + H - 12 - bow); ctx.lineTo(x, Y + H - 12 - bow - len); ctx.stroke();
    }
    ctx.lineWidth = 0.9; ctx.beginPath(); ctx.moveTo(X, Y + H - 12 - 9); ctx.quadraticCurveTo(cx, Y + H - 4, X + W, Y + H - 12 - 9); ctx.stroke();
    // the drum is round, so its sides fall away into the dark
    const sides = ctx.createLinearGradient(X, 0, X + W, 0);
    sides.addColorStop(0, 'rgba(5,2,3,0.8)'); sides.addColorStop(0.2, 'rgba(5,2,3,0)'); sides.addColorStop(0.8, 'rgba(5,2,3,0)'); sides.addColorStop(1, 'rgba(5,2,3,0.8)');
    ctx.fillStyle = sides; ctx.fillRect(X, Y - 8, W, H + 18);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,47,74,0.6)'; ctx.lineWidth = 1; band(); ctx.stroke();
    // the hairline the number is read against
    ctx.strokeStyle = this.field.matches(':focus-visible') ? '#fff' : '#12050a'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx, Y + H - 34); ctx.lineTo(cx, Y + H + 4); ctx.stroke();
    ctx.fillStyle = RED; ctx.beginPath(); ctx.moveTo(cx, Y + H + 12); ctx.lineTo(cx - 4, Y + H + 18); ctx.lineTo(cx + 4, Y + H + 18); ctx.closePath(); ctx.fill();
    if (this.field.matches(':focus-visible')) { ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; rr(ctx, X + 4, Y + 4, W - 8, H - 8, 10); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.field, X, Y + 6, W, 150);
    ctx.fillStyle = RED; ctx.font = `700 9px ${NARROW}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText('S E C', 30, 224);

    // minus and plus: domes that catch a little red on their upper edge
    for (const [sel, x, sign] of [['.dec', 68, -1], ['.inc', 292, 1]]) {
      const b = this.$(sel), down = b.matches(':active');
      const g = ctx.createRadialGradient(x - 8, K.y - 10, 2, x, K.y, 32); g.addColorStop(0, down ? '#2a0a10' : '#1c0a0d'); g.addColorStop(1, '#070304');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, K.y, 30, 0, TAU); ctx.fill();
      const edge = ctx.createLinearGradient(x - 30, K.y - 30, x + 30, K.y + 30); edge.addColorStop(0, 'rgba(255,47,74,0.7)'); edge.addColorStop(0.5, 'rgba(255,47,74,0.08)'); edge.addColorStop(1, 'rgba(255,47,74,0.25)');
      ctx.strokeStyle = edge; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, K.y, 30, 0, TAU); ctx.stroke();
      ctx.strokeStyle = RED; ctx.lineWidth = 2.6; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - 9, K.y); ctx.lineTo(x + 9, K.y);
      if (sign > 0) { ctx.moveTo(x, K.y - 9); ctx.lineTo(x, K.y + 9); }
      ctx.stroke();
      if (b.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(x, K.y, 35, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
      hit(ctx, b, x - 33, K.y - 33, 66, 66);
    }
    // the knob: a fluted skirt and a cap with a mark, turned a tenth of a turn for each second
    const turn = pos * (TAU / 10);
    ctx.strokeStyle = 'rgba(255,47,74,0.7)'; ctx.lineWidth = 1.2; ctx.lineCap = 'butt'; ctx.beginPath();
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; ctx.moveTo(K.x + Math.cos(a) * 49, K.y + Math.sin(a) * 49); ctx.lineTo(K.x + Math.cos(a) * (i % 4 ? 53 : 57), K.y + Math.sin(a) * (i % 4 ? 53 : 57)); }
    ctx.stroke();
    ctx.save(); ctx.translate(K.x, K.y); ctx.rotate(turn);
    ctx.beginPath();
    for (let i = 0; i <= 96; i++) { const a = (i / 96) * TAU, r = 40 + Math.cos(a * 20) * 2.2; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fillStyle = '#12060a'; ctx.fill();
    ctx.strokeStyle = 'rgba(255,47,74,0.5)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
    const cap = ctx.createRadialGradient(K.x - 10, K.y - 12, 2, K.x, K.y, 30); cap.addColorStop(0, '#4a0f1a'); cap.addColorStop(0.5, '#1a070b'); cap.addColorStop(1, '#090304');
    ctx.fillStyle = cap; ctx.beginPath(); ctx.arc(K.x, K.y, 29, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(K.x, K.y); ctx.rotate(turn);
    ctx.strokeStyle = RED; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, -24); ctx.stroke(); ctx.restore();
    ctx.fillStyle = 'rgba(255,47,74,0.85)'; ctx.beginPath(); ctx.ellipse(K.x - 8, K.y - 11, 6, 2.6, -0.7, 0, TAU); ctx.fill();
    if (this.knob.matches(':focus-visible')) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.arc(K.x, K.y, 46, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    hit(ctx, this.knob, K.x - 46, K.y - 46, 92, 92);
    return live;
  }
}
customElements.define('darkroom-timer', DarkroomTimer);
// #endregion darkroom-timer

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

// #region morse-complete
// A text field with a short list under it. Typing narrows the list. Beside each name is the Morse for its
// next letter, and the key at the bottom is a button: a short press is a dot, a long one a dash, and a pause
// ends the letter, which is then typed into the field. So two or three letters keyed by hand pick an item.
const MORSE = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..' };
export class MorseComplete extends FeedControl {
  static size = [360, 400];
  static html = `<input type="text" role="combobox" aria-autocomplete="list" aria-controls="list" aria-expanded="true" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="button" class="clear" aria-label="Clear">&times;</button><ol id="list" role="listbox"></ol><button type="button" class="key" aria-label="Morse key. A short press is a dot and a long press is a dash."></button><output class="tape" role="status"></output>`;
  static css = `
    input[type=text] { width: 274px; height: 40px; box-sizing: border-box; padding: 0; border: 0; outline: 0; background: transparent; color: #16293c;
      font: 500 23px/40px ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 0.04em; }
    input::placeholder { color: #5e7f9f; }
    .clear { width: 30px; height: 40px; border: 0; background: transparent; color: #16293c; font: 400 22px/1 ui-sans-serif, sans-serif; padding: 0; touch-action: manipulation; }
    .clear:focus-visible { outline: 2px solid #16293c; }
    ol { list-style: none; margin: 0; padding: 0; width: 304px; font: 400 15.5px/1 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 0.04em; color: #40607f; }
    li { display: flex; align-items: center; justify-content: space-between; height: 29px; border-bottom: 1px solid #7fa3c6; cursor: pointer; }
    li b { font-weight: 400; color: #16293c; }
    li[aria-selected=true] { color: #16293c; border-bottom-color: #16293c; }
    li span { display: flex; gap: 3px; align-items: center; opacity: 0.55; } li[aria-selected=true] span { opacity: 1; }
    li s { display: block; height: 4px; border-radius: 2px; background: currentColor; width: 4px; } li s.dash { width: 12px; }
    .key { width: 110px; height: 104px; opacity: 0; touch-action: none; user-select: none; -webkit-touch-callout: none; }
    .tape { width: 200px; font: 500 12px/1.3 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color: #2b4a68; white-space: nowrap; }`;
  static DOT = 220;            // a press shorter than this many ms is a dot
  static GAP = 650;            // this long without a press ends the letter
  static AXLE = { x: 176, y: 300 };

  ready() {
    this.field = this.$('input'); this.list = this.$('ol'); this.key = this.$('.key'); this.tape = this.$('.tape');
    this.field.placeholder = this.getAttribute('placeholder') ?? 'Add an item';
    this.field.ariaLabel = this.field.placeholder;
    this.lever = { x: 0, v: 0 }; this.code = ''; this.active = 0; this.picked = '';
    this.field.addEventListener('input', () => { this.picked = ''; this.active = 0; this.filter(); });
    this.field.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.active = clamp(this.active + (e.key === 'ArrowDown' ? 1 : -1), 0, Math.max(0, this.shown.length - 1)); this.filter(); }
      if (e.key === 'Enter' && this.shown[this.active]) { e.preventDefault(); this.pick(this.shown[this.active]); }
    });
    this.list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) this.pick(this.shown[[...this.list.children].indexOf(li)]); });
    this.$('.clear').addEventListener('click', () => { this.field.value = ''; this.picked = ''; this.active = 0; this.filter(); this.setValue(null); this.dispatchEvent(new Event('change', { bubbles: true })); });
    // The key keeps its own pressed flag: :active is not set by every kind of touch.
    const k = this.key;
    k.addEventListener('pointerdown', (e) => { if (!e.button) { k.setPointerCapture(e.pointerId); this.press(true); } });
    for (const type of ['pointerup', 'pointercancel', 'blur']) k.addEventListener(type, () => this.press(false));
    k.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); this.press(true); } });
    k.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.press(false); } });
    k.addEventListener('contextmenu', (e) => e.preventDefault());
    k.addEventListener('click', (e) => e.preventDefault());
    new MutationObserver(() => this.filter()).observe(this, { childList: true, subtree: true, characterData: true });
    this.filter();
  }
  disconnectedCallback() { clearTimeout(this.gap); this.tone(false); }
  get value() { return this.picked; }
  set value(v) { this.field.value = v; this.picked = options(this).some((o) => o.label === v) ? v : ''; this.filter(); this.setValue(this.picked || null); }

  // The list: the options that start with what is typed, five at most, each with the Morse of its next letter.
  filter() {
    const typed = this.field.value.trim().toLowerCase(), all = options(this).map((o) => o.label);
    this.shown = this.picked ? [] : all.filter((name) => name.toLowerCase().startsWith(typed)).slice(0, 5);
    this.active = clamp(this.active, 0, Math.max(0, this.shown.length - 1));
    this.list.innerHTML = this.shown.map((name, i) => {
      const code = MORSE[name[typed.length]?.toLowerCase()] ?? '';
      return `<li role="option" id="o${i}" aria-selected="${i === this.active}"><div><b>${esc(name.slice(0, typed.length))}</b>${esc(name.slice(typed.length))}</div><span aria-label="${code ? 'next letter ' + [...code].map((c) => c === '.' ? 'dot' : 'dash').join(' ') : ''}">${[...code].map((c) => `<s class="${c === '.' ? 'dot' : 'dash'}"></s>`).join('')}</span></li>`;
    }).join('');
    this.field.setAttribute('aria-activedescendant', this.shown.length ? 'o' + this.active : '');
    this.field.setAttribute('aria-expanded', String(this.shown.length > 0));
    this.request();
  }
  pick(name) {
    if (!name) return;
    this.field.value = name; this.picked = name; this.filter();
    this.setValue(name);
    this.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // #region morse-key
  press(down) {
    if (down === !!this.down) return;
    clearTimeout(this.gap);
    if (down) { this.down = performance.now(); }
    else {
      this.code += performance.now() - this.down < MorseComplete.DOT ? '.' : '-';
      this.down = 0;
      this.gap = setTimeout(() => this.letter(), MorseComplete.GAP);
    }
    this.tone(down);
    this.tape.textContent = [...this.code].map((c) => (c === '.' ? '•' : '▬')).join(' ');
    this.request();
  }
  // The pause after the last press: look the code up and type the letter.
  letter() {
    const ch = Object.keys(MORSE).find((k) => MORSE[k] === this.code);
    this.tape.textContent = ch ? `${[...this.code].map((c) => (c === '.' ? '•' : '▬')).join(' ')}  ${ch.toUpperCase()}` : this.code ? 'not a letter' : '';
    this.code = '';
    if (ch) {
      this.field.value += this.field.value ? ch : ch.toUpperCase();
      this.picked = ''; this.active = 0; this.filter();
      this.dispatchEvent(new Event('input', { bubbles: true }));
      if (this.shown.length === 1 && this.shown[0].toLowerCase() === this.field.value.toLowerCase()) this.pick(this.shown[0]);
    }
    this.request();
  }
  // A sounder, if the page asked for one with the `sound` attribute: a sine tone for as long as the key is down.
  tone(on) {
    if (!this.hasAttribute('sound')) return;
    try {
      if (on && !this.audio) {
        const A = window.AudioContext ?? window.webkitAudioContext; if (!A) return;
        this.audio = new A(); this.gain = this.audio.createGain(); this.gain.gain.value = 0;
        const osc = this.audio.createOscillator(); osc.frequency.value = 620; osc.connect(this.gain).connect(this.audio.destination); osc.start();
      }
      if (!this.audio) return;
      if (on) this.audio.resume?.();
      this.gain.gain.setTargetAtTime(on ? 0.12 : 0, this.audio.currentTime, 0.008);
    } catch (e) { window.__gfx?.report?.('error', 'morse sounder: ' + e.message); }
  }
  // #endregion morse-key

  draw(ctx, w, h) {
    const { AXLE } = MorseComplete;
    ctx.fillStyle = '#a9c6e2'; ctx.fillRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, 'rgba(255,255,255,0.12)'); sky.addColorStop(1, 'rgba(40,80,130,0.12)');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);
    put(ctx, this.field, 28, 16);
    put(ctx, this.$('.clear'), 302, 16);
    ctx.fillStyle = '#16293c'; ctx.fillRect(28, 58, 304, 1.4);
    if (this.field.matches(':focus-visible')) ctx.fillRect(28, 58, 304, 2.4);
    put(ctx, this.list, 28, 62);

    // the lever: at rest the spring holds the knob end up. Pressed, it comes down onto the contact and stops.
    const want = this.down ? 1 : 0;
    let live = reduced() ? ((this.lever.x = want), false) : spring(this.lever, want, this.dt, 1500, 44);
    if (this.lever.x > 1) { this.lever.x = 1; this.lever.v *= -0.25; }      // the contact is hard
    if (this.lever.x < 0) { this.lever.x = 0; this.lever.v *= -0.25; }      // and so is the back stop
    const tilt = lerp(-0.05, 0.022, this.lever.x);
    const BRASS = (x0, y0, x1, y1) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, '#e8c56a'); g.addColorStop(0.45, '#b98a2c'); g.addColorStop(0.55, '#d9b04c'); g.addColorStop(1, '#7c5714'); return g; };
    // shadow on the table, and the wooden base
    ctx.fillStyle = 'rgba(30,60,100,0.25)'; ctx.beginPath(); ctx.ellipse(180, 386, 170, 7, 0, 0, TAU); ctx.fill();
    const wood = ctx.createLinearGradient(0, 348, 0, 384); wood.addColorStop(0, '#7a4326'); wood.addColorStop(0.2, '#5e2f18'); wood.addColorStop(1, '#3a1a0c');
    ctx.fillStyle = wood; rr(ctx, 12, 348, 336, 36, 3); ctx.fill();
    ctx.save(); rr(ctx, 12, 348, 336, 36, 3); ctx.clip(); ctx.strokeStyle = 'rgba(20,8,2,0.35)'; ctx.lineWidth = 0.7;
    for (let i = 0; i < 14; i++) { const y = 351 + i * 2.5 + rnd(i) * 1.5; ctx.beginPath(); ctx.moveTo(12, y); ctx.bezierCurveTo(100, y + rnd(i + 5) * 4 - 2, 240, y + rnd(i + 9) * 4 - 2, 348, y + rnd(i + 2) * 3); ctx.stroke(); }
    ctx.fillStyle = 'rgba(255,220,180,0.18)'; ctx.fillRect(12, 348, 336, 1.5); ctx.restore();
    // feet on the base: back stop post, spring seat, the pivot block and the contact
    const foot = (x, wd) => { ctx.fillStyle = BRASS(x - wd, 0, x + wd, 0); rr(ctx, x - wd, 340, wd * 2, 9, 2); ctx.fill(); };
    foot(40, 13); foot(108, 11); foot(AXLE.x, 26); foot(262, 15);
    ctx.fillStyle = BRASS(250, 0, 274, 0); rr(ctx, 253, 318, 18, 24, 3); ctx.fill();                       // contact post
    const tip = ctx.createRadialGradient(261, 313, 0.5, 262, 315, 5); tip.addColorStop(0, '#fff'); tip.addColorStop(1, '#7d8288');
    ctx.fillStyle = tip; ctx.beginPath(); ctx.arc(262, 316, 4.2, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = BRASS(162, 0, 190, 0); ctx.beginPath(); ctx.moveTo(160, 342); ctx.lineTo(160, 300); ctx.arc(AXLE.x, 300, 16, Math.PI, TAU); ctx.lineTo(192, 342); ctx.closePath(); ctx.fill();
    // what is on the lever turns about the axle
    const along = (x, y) => { const dx = x - AXLE.x, dy = y - AXLE.y; return { x: AXLE.x + dx * Math.cos(tilt) - dy * Math.sin(tilt), y: AXLE.y + dx * Math.sin(tilt) + dy * Math.cos(tilt) }; };
    // the coil spring between the base and the lever, squeezed or stretched by the lever's end
    const sTop = along(108, 306).y, sBot = 340;
    ctx.strokeStyle = '#3d3f43'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    for (let i = 0; i <= 12; i++) ctx[i ? 'lineTo' : 'moveTo'](108 + (i % 2 ? 7 : -7) * (i && i < 12 ? 1 : 0), lerp(sTop, sBot, i / 12));
    ctx.stroke();
    // the back stop: a threaded post and a knurled nut the lever's tail rests under
    const tail = along(40, 300);
    ctx.fillStyle = BRASS(35, 0, 45, 0); ctx.fillRect(36, 262, 8, 80);
    ctx.strokeStyle = 'rgba(70,45,5,0.6)'; ctx.lineWidth = 0.6; ctx.beginPath(); for (let y = 264; y < 340; y += 2.4) { ctx.moveTo(36, y); ctx.lineTo(44, y + 1); } ctx.stroke();
    ctx.fillStyle = BRASS(22, 0, 58, 0); rr(ctx, 22, 256, 36, 12, 3); ctx.fill();
    ctx.strokeStyle = 'rgba(70,45,5,0.55)'; ctx.beginPath(); for (let x = 24; x < 58; x += 2.2) { ctx.moveTo(x, 257); ctx.lineTo(x, 267); } ctx.stroke();
    ctx.fillStyle = BRASS(26, 0, 54, 0); rr(ctx, 26, tail.y - 13, 28, 7, 2); ctx.fill();
    ctx.save(); ctx.translate(AXLE.x, AXLE.y); ctx.rotate(tilt);
    ctx.fillStyle = BRASS(0, -6, 0, 6); rr(ctx, -150, -5.5, 300, 11, 2.5); ctx.fill();
    ctx.fillStyle = 'rgba(255,240,190,0.5)'; ctx.fillRect(-150, -5.5, 300, 1.4);
    // the knob: a brass collar, a neck and a wide black cap
    ctx.fillStyle = BRASS(110, 0, 146, 0); rr(ctx, 112, -11, 34, 7, 2); ctx.fill();
    const neck = ctx.createLinearGradient(118, 0, 140, 0); neck.addColorStop(0, '#3b3b3d'); neck.addColorStop(0.4, '#1b1b1c'); neck.addColorStop(1, '#070707');
    ctx.fillStyle = neck; ctx.beginPath(); ctx.moveTo(119, -11); ctx.quadraticCurveTo(124, -24, 116, -38); ctx.lineTo(142, -38); ctx.quadraticCurveTo(134, -24, 139, -11); ctx.closePath(); ctx.fill();
    const capG = ctx.createLinearGradient(0, -56, 0, -36); capG.addColorStop(0, '#4b4b4e'); capG.addColorStop(0.35, '#232325'); capG.addColorStop(1, '#0a0a0b');
    ctx.fillStyle = capG; ctx.beginPath(); ctx.ellipse(129, -45, 39, 10.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.14)'; ctx.beginPath(); ctx.ellipse(120, -50, 22, 3, -0.05, 0, TAU); ctx.fill();
    ctx.restore();
    // the axle
    const ax = ctx.createRadialGradient(AXLE.x - 2, AXLE.y - 3, 1, AXLE.x, AXLE.y, 9); ax.addColorStop(0, '#f6dc8e'); ax.addColorStop(1, '#8a6218');
    ctx.fillStyle = ax; ctx.beginPath(); ctx.arc(AXLE.x, AXLE.y, 8.5, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(70,45,5,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
    // a spark of light where the lever meets the contact
    if (this.lever.x > 0.96) { const sp = ctx.createRadialGradient(262, 311, 0, 262, 311, 9); sp.addColorStop(0, 'rgba(255,255,255,0.9)'); sp.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = sp; ctx.fillRect(252, 301, 20, 20); }
    if (this.key.matches(':focus-visible')) { const kp = along(305, 262); ctx.strokeStyle = '#16293c'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]); rr(ctx, kp.x - 48, kp.y - 20, 96, 44, 10); ctx.stroke(); ctx.setLineDash([]); }
    const kp = along(305, 255);
    hit(ctx, this.key, kp.x - 55, kp.y - 34, 110, 104);
    put(ctx, this.tape, 28, 226, 200);
    return live;
  }
}
customElements.define('morse-complete', MorseComplete);
// #endregion morse-complete
