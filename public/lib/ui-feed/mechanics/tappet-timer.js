// <tappet-timer>: 96 checkboxes, the tappets round the dial of a 24-hour plug-in timer.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, hit, clamp, lerp, rr, spring, TAU } from '../kit.js';

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
