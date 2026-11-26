// <ball-calendar>: a month table of day buttons with a rubber ball that bounces to the chosen day.
// Standalone HTML-in-canvas custom element. Only dependency: ../kit.js.

import { FeedControl, put, clamp, lerp, TAU, reduced } from '../kit.js';

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

// #region ball-calendar
// A month as a <table> of <button>s, one for each day, with the chosen one pressed. The table is drawn as
// it is. Under each number the canvas draws a dimple, and a rubber ball sits in the chosen one. Choosing
// another day throws the ball there: a hop for about every 70 units of the way, each lower than the last,
// then two small bounces in the dimple.
export class BallCalendar extends FeedControl {
  static size = [360, 408];
  static html = `<output class="head"><b></b><span></span><time></time></output><table></table>`;
  static css = `
    .head { display: flex; align-items: flex-end; gap: 10px; width: 322px; height: 78px; color: #141412; }
    .head b { font: 500 82px/0.86 'DIN Alternate', 'Roboto Condensed', 'Arial Narrow', ui-sans-serif, sans-serif; letter-spacing: -0.02em; }
    .head span, .head time { font: 600 18px/1.5 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; white-space: nowrap; }
    .head time { margin-left: auto; font-weight: 400; color: #8b8a84; }
    table { border-collapse: collapse; width: 322px; table-layout: fixed; }
    th { height: 20px; padding: 0 0 0 2px; font: 600 8px/1 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; letter-spacing: 0.1em; color: #8b8a84; text-align: left; text-transform: uppercase; }
    td { height: 48px; padding: 0; border-top: 1px solid #c4c2ba; vertical-align: top; }
    tr:last-child td { border-bottom: 1px solid #c4c2ba; }
    button { all: unset; display: flex; align-items: flex-start; box-sizing: border-box; width: 46px; height: 48px; padding: 5px 0 0 0;
      font: 600 10.5px/1 ui-monospace, 'DejaVu Sans Mono', Menlo, monospace; color: #1a1a18; cursor: pointer; touch-action: manipulation; }
    button span { padding: 1px 3px 1px 2px; border-radius: 2px; }
    button[aria-pressed=true] span { background: #f2c21a; }
    button:focus-visible { outline: 2px solid #1a1a18; outline-offset: -3px; border-radius: 6px; }`;
  static observedAttributes = ['value'];
  static R = 13;

  ready() {
    this.table = this.$('table'); this.head = this.$('.head');
    const v = this.getAttribute('value') ?? new Date().toISOString().slice(0, 10);
    const [y, mo, d] = v.split('-').map(Number);
    this.year = y; this.month = mo; this.day = d;
    const first = new Date(Date.UTC(y, mo - 1, 1)), days = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let html = `<caption hidden></caption><thead><tr>${names.map((n) => `<th scope="col">${n}</th>`).join('')}</tr></thead><tbody><tr>`;
    for (let i = 0; i < first.getUTCDay(); i++) html += '<td></td>';
    for (let n = 1; n <= days; n++) {
      const date = new Date(Date.UTC(y, mo - 1, n));
      html += `<td><button type="button" data-day="${n}" aria-label="${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}"><span>${n}</span></button></td>`;
      if (date.getUTCDay() === 6 && n < days) html += '</tr><tr>';
    }
    this.table.innerHTML = html + '</tr></tbody>';
    this.buttons = this.$$('button');
    this.table.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.choose(Number(b.dataset.day), true); });
    // One button is in the tab order. The arrow keys move between days, as in a grid.
    this.table.addEventListener('keydown', (e) => {
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      const at = this.buttons.indexOf(this.shadowRoot.activeElement);
      if (!step || at < 0) return;
      const to = this.buttons[at + step];
      if (to) { e.preventDefault(); this.buttons[at].tabIndex = -1; to.tabIndex = 0; to.focus({ preventScroll: true }); this.request(); }
    });
    this.landed = this.day;
    this.ball = null;
    this.choose(this.day, false);
  }
  attributeChangedCallback(_, __, v) { if (this.buttons && v) this.choose(Number(v.split('-')[2]), false); }
  get value() { return `${this.year}-${String(this.month).padStart(2, '0')}-${String(this.day).padStart(2, '0')}`; }
  set value(v) { this.choose(Number(String(v).split('-')[2]), false); }
  // The middle of a day's dimple, in design units.
  spot(day) {
    const b = this.buttons[day - 1], s = this.slice(b, this.table);
    return { x: 19 + s.left + 29, y: 104 + s.top + 29 };
  }
  choose(day, fromUser) {
    day = clamp(day | 0, 1, this.buttons.length);
    const moved = day !== this.day;
    this.day = day;
    this.buttons.forEach((b, i) => { b.setAttribute('aria-pressed', String(i === day - 1)); b.tabIndex = i === day - 1 ? 0 : -1; });
    this.setValue(this.value);
    this.aim = day;                                       // the throw starts in the next paint, when the table has a layout
    if (!moved || reduced()) this.landed = day;
    this.title();
    if (fromUser && moved) this.dispatchEvent(new Event('change', { bubbles: true }));
    this.request();
  }
  // The big number and the weekday follow the ball: they change when it lands.
  title() {
    const date = new Date(Date.UTC(this.year, this.month - 1, this.landed));
    this.head.children[0].textContent = this.landed;
    this.head.children[1].textContent = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
    this.head.children[2].textContent = date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }

  // #region ball-step
  // b.t runs through the hops. Along the ground the ball moves at one speed. Its height in hop k is a
  // parabola, and each hop is 0.62 of the height of the one before.
  throwTo(to) {
    const b = this.ball, dist = Math.hypot(to.x - b.x, to.y - b.y);
    if (dist < 1) return;
    const hops = clamp(Math.round(dist / 70), 1, 4);
    Object.assign(b, { from: { x: b.x, y: b.y }, to, hops, t: 0, dur: 0.24 * hops + 0.1, spin: b.spin ?? 0, dist });
  }
  stepBall(dt) {
    const b = this.ball;
    if (!b.to) return false;
    b.t += dt;
    const fly = b.dur, settle = 0.32;
    if (b.t < fly) {
      const k = b.t / fly, hop = Math.min(b.hops - 1, Math.floor(k * b.hops)), u = k * b.hops - hop;
      b.x = lerp(b.from.x, b.to.x, k); b.y = lerp(b.from.y, b.to.y, k);
      b.z = 4 * (30 * 0.62 ** hop + 6) * u * (1 - u);
      b.spin += (b.dist / fly) * dt / BallCalendar.R;
    } else if (b.t < fly + settle) {
      const u = (b.t - fly) / settle;                      // two small bounces where it lands
      b.x = b.to.x; b.y = b.to.y;
      b.z = u < 0.6 ? 4 * 5 * (u / 0.6) * (1 - u / 0.6) : 4 * 1.6 * ((u - 0.6) / 0.4) * (1 - (u - 0.6) / 0.4);
      if (this.landed !== this.day) { this.landed = this.day; this.title(); }
    } else {
      Object.assign(b, { x: b.to.x, y: b.to.y, z: 0, to: null });
      if (this.landed !== this.day) { this.landed = this.day; this.title(); }
      return false;
    }
    return true;
  }
  // #endregion ball-step

  draw(ctx, w, h) {
    const R = BallCalendar.R;
    ctx.fillStyle = '#e8e7e2'; ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, 0.045);
    if (!this.table.offsetHeight) return true;
    if (!this.ball) this.ball = { ...this.spot(this.day), z: 0, spin: 0.6 };
    if (this.aim) {
      const to = this.spot(this.aim); this.aim = 0;
      if (reduced() || this.landed === this.day) Object.assign(this.ball, to, { z: 0, to: null }); else this.throwTo(to);
    }
    const live = this.stepBall(this.dt);
    // a dimple pressed into the card under each day: shaded where the light from the top left can't reach
    for (let d = 1; d <= this.buttons.length; d++) {
      const s = this.spot(d);
      const g = ctx.createLinearGradient(s.x - 10, s.y - 10, s.x + 10, s.y + 10);
      g.addColorStop(0, '#c4c2ba'); g.addColorStop(0.5, '#e2e1dc'); g.addColorStop(1, '#f7f6f3');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0, TAU); ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(s.x, s.y, 14, 0.1, 1.5); ctx.stroke();
      ctx.strokeStyle = 'rgba(60,58,50,0.22)'; ctx.beginPath(); ctx.arc(s.x, s.y, 14, Math.PI + 0.1, Math.PI + 1.5); ctx.stroke();
    }
    put(ctx, this.head, 19, 14);
    put(ctx, this.table, 19, 104);
    // the ball: its shadow moves away and softens as it rises
    const b = this.ball, z = b.z, k = 1 + z / 240;
    ctx.save(); ctx.filter = `blur(${(2 + z * 0.1) * this.px}px)`;
    ctx.fillStyle = `rgba(30,28,22,${clamp(0.42 - z * 0.006, 0.12, 0.42)})`;
    ctx.beginPath(); ctx.ellipse(b.x + 3 + z * 0.2, b.y + 4 + z * 0.16, R * (1 + z * 0.004), R * 0.92, 0, 0, TAU); ctx.fill();
    ctx.restore();
    const bx = b.x, by = b.y - z * 0.6 - 1;
    const g = ctx.createRadialGradient(bx - R * 0.4 * k, by - R * 0.45 * k, R * 0.05, bx, by, R * k);
    g.addColorStop(0, '#6a6a6e'); g.addColorStop(0.3, '#2c2c2f'); g.addColorStop(1, '#09090a');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(bx, by, R * k, 0, TAU); ctx.fill();
    // the two yellow dots of a squash ball, carried round as it rolls
    ctx.save(); ctx.beginPath(); ctx.arc(bx, by, R * k, 0, TAU); ctx.clip();
    for (const off of [0, 0.5]) {
      const a = b.spin + off, c = Math.cos(a);
      if (c > -0.2) { ctx.fillStyle = `rgba(242,194,26,${clamp(c + 0.3)})`; ctx.beginPath(); ctx.ellipse(bx + Math.sin(a) * R * 0.72 * k, by + (off ? 2.5 : -1.5) * k, 1.5 * k * Math.max(0.35, c), 1.5 * k, 0, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.beginPath(); ctx.ellipse(bx - R * 0.36 * k, by - R * 0.44 * k, R * 0.2 * k, R * 0.12 * k, -0.6, 0, TAU); ctx.fill();
    return live;
  }
}
customElements.define('ball-calendar', BallCalendar);
// #endregion ball-calendar
