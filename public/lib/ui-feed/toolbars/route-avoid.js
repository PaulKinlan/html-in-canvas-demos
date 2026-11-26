// <route-avoid>: a road sign with a fieldset of four avoidance checkboxes, animated route and dot board.
// Standalone HTML-in-canvas custom element; depends only on ../kit.js and ../fold.js.

import { FeedControl, put, clamp, lerp, easeOut, rr, spring, TAU, reduced, dotBoard } from '../kit.js';
import { cached } from '../fold.js';

const SIGN = "'Overpass', 'Transport', 'B612', 'DIN Alternate', 'Barlow Semi Condensed', 'Arial Narrow', Inter, 'Helvetica Neue', Arial, sans-serif";
const MONO = "'Courier New', Courier, 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const changed = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

// The roads, in design units. The routes all start at the bottom of the map and leave from the top.
const MAP = { l: 51, r: 309, t: 121, b: 217, x: 220, start: 248, end: 82, unpaved: 101, ferry: 151 };
const ROUTES = [
  { id: 'a8', min: 44, km: 81, via: '<i class="m">A8</i>', has: ['tolls', 'motorways'], pts: [[MAP.x, MAP.start], [MAP.x, MAP.end]] },
  { id: 'a3', min: 63, km: 104, via: '<i class="m">A3</i> <i>N21</i>', has: ['motorways'], pts: [[MAP.x, MAP.start], [MAP.x, MAP.b], [MAP.r, MAP.b], [MAP.r, MAP.t], [MAP.x, MAP.t], [MAP.x, MAP.end]] },
  { id: 'ferry', min: 76, km: 58, via: '<i>N14</i> <i class="f">ferry</i>', has: ['ferries'], pts: [[MAP.x, MAP.start], [MAP.x, MAP.b], [MAP.ferry, MAP.b], [MAP.ferry, MAP.t], [MAP.x, MAP.t], [MAP.x, MAP.end]], dash: MAP.ferry },
  { id: 'r305', min: 85, km: 69, via: '<i>N14</i> <i>R305</i>', has: ['unpaved'], pts: [[MAP.x, MAP.start], [MAP.x, MAP.b], [MAP.unpaved, MAP.b], [MAP.unpaved, MAP.t], [MAP.x, MAP.t], [MAP.x, MAP.end]], dots: MAP.unpaved },
  { id: 'n14', min: 97, km: 117, via: '<i>N14</i>', has: [], pts: [[MAP.x, MAP.start], [MAP.x, MAP.b], [MAP.l, MAP.b], [MAP.l, MAP.t], [MAP.x, MAP.t], [MAP.x, MAP.end]] },
];
const AVOID = [['tolls', 'Tolls'], ['motorways', 'Motorways'], ['ferries', 'Ferries'], ['unpaved', 'Unpaved']];
const lengthOf = (pts) => pts.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

// The part of a polyline up to `len`, and the direction at its end.
function upTo(pts, len) {
  const out = [pts[0]];
  let dir = [0, -1];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], l = Math.hypot(bx - ax, by - ay);
    dir = [(bx - ax) / l, (by - ay) / l];
    if (len <= l) { out.push([ax + dir[0] * len, ay + dir[1] * len]); return { out, dir }; }
    len -= l; out.push([bx, by]);
  }
  return { out, dir };
}
function roundLine(ctx, pts, r = 12) {
  ctx.beginPath(); ctx.moveTo(...pts[0]);
  for (let i = 1; i < pts.length - 1; i++) ctx.arcTo(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], r);
  ctx.lineTo(...pts.at(-1));
}

// The sign: the green board, its white edge and rule, the grain, and the roads of the map, faint.
function drawSign(g, w, h) {
  g.fillStyle = '#08723f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { g.fillStyle = rnd(i) > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.05)'; g.fillRect(rnd(i + 0.3) * w, rnd(i + 0.7) * h, 1.2, 1.2); }
  g.strokeStyle = '#fff'; g.lineWidth = 2.6;
  rr(g, 5, 5, w - 10, h - 10, 11); g.stroke();
  g.fillStyle = '#fff'; g.fillRect(5, 248.5, w - 10, 2.4);
  g.strokeStyle = 'rgba(255,255,255,0.32)'; g.lineWidth = 5; g.lineJoin = 'round';
  rr(g, MAP.l, MAP.t, MAP.r - MAP.l, MAP.b - MAP.t, 12); g.stroke();
  g.beginPath(); g.moveTo(MAP.x, MAP.t); g.lineTo(MAP.x, MAP.b); g.stroke();
  g.setLineDash([6, 5]); g.beginPath(); g.moveTo(MAP.ferry, MAP.t); g.lineTo(MAP.ferry, MAP.b); g.stroke();
  g.setLineDash([2.5, 4.5]); g.lineCap = 'round'; g.beginPath(); g.moveTo(MAP.unpaved, MAP.t); g.lineTo(MAP.unpaved, MAP.b); g.stroke();
  g.setLineDash([]);
}

// Road numbers in their shields. Anything you avoid goes dim.
function shield(ctx, x, y, text, kind, dim) {
  ctx.save();
  ctx.globalAlpha = dim ? 0.3 : 1;
  ctx.font = `700 9px ${SIGN}`;
  const tw = ctx.measureText(text).width + 9, th = kind === 'toll' ? 9 : 13;
  rr(ctx, x - tw / 2, y - th / 2, tw, th, 2.5);
  ctx.fillStyle = { m: '#1d55c4', n: '#fff', toll: '#ffcd1c', ferry: '#08723f' }[kind]; ctx.fill();
  ctx.strokeStyle = kind === 'n' ? '#08723f' : '#fff'; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = kind === 'n' || kind === 'toll' ? '#111' : '#fff';
  if (kind === 'toll') ctx.font = `800 6.5px ${SIGN}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (kind === 'ferry') boat(ctx, x, y + 1, 0.42, '#fff'); else ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}
function drawShields(ctx, avoid) {
  shield(ctx, MAP.l, 169, 'N14', 'n', false);
  shield(ctx, MAP.unpaved, 169, 'R305', 'n', avoid.has('unpaved'));
  shield(ctx, MAP.ferry, 169, 'ferry', 'ferry', avoid.has('ferries'));
  shield(ctx, MAP.x, 160, 'A8', 'm', avoid.has('motorways') || avoid.has('tolls'));
  shield(ctx, MAP.x, 172, 'TOLL', 'toll', avoid.has('tolls'));
  shield(ctx, MAP.r, 144, 'N21', 'n', false);
  shield(ctx, MAP.r, 194, 'A3', 'm', avoid.has('motorways'));
  shield(ctx, 184, MAP.b, 'N14', 'n', false);
}
function drawRoute(ctx, r, t, alpha) {
  if (alpha <= 0.01) return;
  const total = lengthOf(r.pts), { out, dir } = upTo(r.pts, Math.max(1, total * t));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.lineCap = 'butt';
  roundLine(ctx, out); ctx.stroke();
  // a ferry crossing is drawn dashed and an unpaved road dotted, by drawing the gaps in the board's green
  const across = r.dash ?? r.dots;
  if (across) {
    ctx.strokeStyle = '#08723f'; ctx.lineWidth = 8;
    ctx.setLineDash(r.dash ? [6, 6] : [3, 4]);
    const ys = out.filter(([x]) => Math.abs(x - across) < 0.5).map(([, y]) => y);
    if (ys.length > 1) { ctx.beginPath(); ctx.moveTo(across, Math.max(...ys) - 10); ctx.lineTo(across, Math.min(...ys) + 10); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  const [x, y] = out.at(-1), [dx, dy] = dir, nx = -dy, ny = dx;
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(x + dx * 13, y + dy * 13); ctx.lineTo(x + nx * 11, y + ny * 11); ctx.lineTo(x - nx * 11, y - ny * 11); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function boat(ctx, x, y, s, c) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s); ctx.fillStyle = c;
  ctx.beginPath(); ctx.moveTo(-24, 0); ctx.lineTo(24, 0); ctx.lineTo(17, 9); ctx.lineTo(-19, 9); ctx.closePath(); ctx.fill();
  ctx.fillRect(-12, -7, 20, 7); ctx.fillRect(10, -12, 6, 12); ctx.fillRect(-7, -12, 10, 5);
  ctx.restore();
}
// Pictograms for the four keys, drawn about 40 by 30 round (x, y).
const PICTO = {
  tolls(ctx, x, y, c) {
    // the booth with a window cut in it (an even-odd fill, so nothing is cleared from the canvas)
    ctx.fillStyle = c;
    ctx.fillRect(x - 21, y - 14, 18, 4);
    const booth = new Path2D(); booth.rect(x - 19, y - 10, 14, 24); booth.rect(x - 15, y - 6, 6, 6);
    ctx.fill(booth, 'evenodd');
    ctx.fillRect(x - 1, y + 2, 4, 12); ctx.fillRect(x - 1, y + 1, 10, 4);
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 12 + i * 4, y + 1, 2.5, 4);
  },
  motorways(ctx, x, y, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x - 20, y - 8, 40, 4);
    ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x - 2, y - 4); ctx.lineTo(x - 5, y + 15); ctx.lineTo(x - 16, y + 15); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + 2, y - 4); ctx.lineTo(x + 4, y - 4); ctx.lineTo(x + 16, y + 15); ctx.lineTo(x + 5, y + 15); ctx.closePath(); ctx.fill();
    ctx.fillRect(x - 3, y - 14, 1.5, 6); ctx.fillRect(x + 1.5, y - 14, 1.5, 6);
  },
  ferries(ctx, x, y, c) {
    boat(ctx, x, y + 3, 0.78, c);
    ctx.strokeStyle = c; ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) { const px = x - 20 + i, py = y + 14 + Math.sin(i * 0.8) * 1.4; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
  },
  unpaved(ctx, x, y, c) {
    ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x - 5, y - 13); ctx.lineTo(x - 16, y + 14); ctx.moveTo(x + 5, y - 13); ctx.lineTo(x + 16, y + 14); ctx.stroke();
    for (let i = 0; i < 13; i++) { const r = rnd(i + 3), q = rnd(i + 9), yy = y - 10 + r * 24, half = 3 + (yy - y + 10) * 0.3; ctx.beginPath(); ctx.arc(x + (q - 0.5) * 2 * half, yy, 1 + r * 0.9, 0, TAU); ctx.fill(); }
  },
};

// #region route-avoid
//   <route-avoid name="avoid" to="Kestle Bay" now="14:10"></route-avoid>
// A <fieldset> of four checkboxes. The canvas draws each label's box, fills it yellow and strikes out its
// picture when it is checked, and draws the fastest route that avoids everything checked.
export class RouteAvoid extends FeedControl {
  static size = [360, 360];
  static radius = 14;
  static html = `<h2 class="to"></h2><output class="eta" aria-label="Time to drive"></output><span class="was" aria-hidden="true"></span>
    <p class="via"><span class="dist"></span><span class="arrive"></span></p>
    <fieldset><legend>Avoid</legend><div class="keys">${AVOID.map(([v, l]) => `<label><input type="checkbox" value="${v}"><span>${l}</span></label>`).join('')}</div></fieldset>`;
  static css = `
    .to { width: 210px; margin: 0; white-space: nowrap; color: #fff; font: 700 37px/1 ${SIGN}; letter-spacing: -0.5px; }
    .eta, .was { width: 120px; height: 28px; padding: 0 6px; text-align: right; white-space: pre; color: #ffae2b; font: 700 23px/28px ${MONO}; }
    .via { display: flex; justify-content: space-between; align-items: baseline; width: 328px; color: #fff; font: 600 11px/18px ${SIGN}; }
    .via b { font-size: 15px; font-weight: 700; }
    .via i { display: inline-block; padding: 0 4px; margin-left: 2px; border-radius: 3px; background: #fff; color: #111; font: 700 10px/15px ${SIGN}; font-style: normal; }
    .via i.m { background: #1d55c4; color: #fff; box-shadow: inset 0 0 0 1px #fff; }
    .via i.f { background: transparent; color: #fff; box-shadow: inset 0 0 0 1px #fff; }
    fieldset { width: 330px; margin: 0; padding: 0; border: 0; min-inline-size: 0; }
    legend { padding: 0; margin: 0 0 5px; color: #fff; font: 700 17px/1.2 ${SIGN}; }
    .keys { display: grid; grid-template-columns: repeat(4, 75px); column-gap: 10px; }
    label { position: relative; display: flex; align-items: flex-end; justify-content: center; height: 66px; padding-bottom: 6px; box-sizing: border-box; border-radius: 6px; color: #fff; font: 700 11.5px/1 ${SIGN}; cursor: pointer; }
    label:has(:checked) { color: #141414; }
    label:has(:focus-visible) { outline: 3px solid #fff; outline-offset: 3px; }
    label:active { transform: translateY(1px); }
    input { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: pointer; }`;

  ready() {
    this.toEl = this.$('.to'); this.eta = this.$('.eta'); this.was = this.$('.was');
    this.viaEl = this.$('.via'); this.dist = this.$('.dist'); this.arrive = this.$('.arrive'); this.fs = this.$('fieldset');
    this.boxes = this.$$('input'); this.labels = this.$$('label');
    this.toEl.textContent = this.getAttribute('to') ?? 'Kestle Bay';
    this.fill = this.boxes.map(() => ({ x: 0, v: 0 }));
    this.flip = 1; this.drawn = 1; this.fade = 0;
    for (const v of (this.getAttribute('avoid') ?? '').split(/\s+/)) { const b = this.boxes.find((x) => x.value === v); if (b) { b.checked = true; this.fill[this.boxes.indexOf(b)].x = 1; } }
    this.fs.addEventListener('change', () => this.pick());
    this.pick(true);
  }
  get value() { return this.boxes.filter((b) => b.checked).map((b) => b.value).join(' '); }
  pick(quiet = false) {
    const avoid = new Set(this.boxes.filter((b) => b.checked).map((b) => b.value));
    const route = ROUTES.find((r) => !r.has.some((f) => avoid.has(f)));
    if (route !== this.route) {
      this.old = quiet ? null : this.route;
      this.was.textContent = this.eta.textContent;
      this.route = route;
      const [hh, mm] = (this.getAttribute('now') ?? '14:10').split(':').map(Number), t = hh * 60 + mm + route.min;
      this.eta.textContent = `${route.min} MIN`;
      this.dist.innerHTML = `<span><b>${route.km}</b> km &nbsp;via ${route.via}</span>`;
      this.arrive.innerHTML = `Arrive <b>${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}</b>`;
      this.started = quiet ? -1e9 : performance.now();
    }
    const fd = new FormData(), name = this.getAttribute('name') ?? 'avoid';
    for (const v of avoid) fd.append(name, v);
    this.setValue(fd);
    if (!quiet) changed(this);
    this.request();
  }
  draw(ctx, w, h, now) {
    ctx.drawImage(cached(this, 'sign', w, h, drawSign), 0, 0, w, h);
    const avoid = new Set(this.boxes.filter((b) => b.checked).map((b) => b.value));
    const t = reduced() ? 1 : clamp((now - this.started) / 900);
    // the old route fades while the new one is drawn from the start, with its arrow at the tip
    if (this.old && t < 1) drawRoute(ctx, this.old, 1, 1 - easeOut(t * 1.6));
    drawRoute(ctx, this.route, easeOut(t), 1);
    drawShields(ctx, avoid);

    put(ctx, this.toEl, 16, 13);
    // The time is an <output> on a board of amber dots. The old time scrolls up and out as the new one arrives.
    const k = reduced() ? 1 : easeOut(clamp((now - this.started) / 420));
    dotBoard(this, ctx, { x: 224, y: 15, w: 122, h: 30, cell: 1.55, bg: '#1d1206', off: 0.1, glow: 1.2, id: 'eta' }, (c) => {
      if (k < 1) put(c, this.was, 0, 1 - k * 30);
      put(c, this.eta, 0, 1 + (1 - k) * 30);
    });
    put(ctx, this.viaEl, 16, 50);

    // the keys: a yellow fill that wipes across, the box, the label's picture, the pictogram and its strike
    const fx = 15, fy = 254;
    let moving = t < 1 || k < 1;
    this.labels.forEach((l, i) => {
      moving = spring(this.fill[i], this.boxes[i].checked ? 1 : 0, this.dt, 260, 30) || moving;
      const x = fx + l.offsetLeft, y = fy + l.offsetTop, f = clamp(this.fill[i].x);
      if (f > 0.002) { ctx.save(); rr(ctx, x, y, 75, 66, 6); ctx.clip(); ctx.fillStyle = '#ffcd1c'; ctx.fillRect(x, y, 75 * f, 66); ctx.restore(); }
      rr(ctx, x, y, 75, 66, 6); ctx.lineWidth = 2; ctx.strokeStyle = f > 0.5 ? '#141414' : '#fff'; ctx.stroke();
    });
    put(ctx, this.fs, fx, fy);
    this.labels.forEach((l, i) => {
      const x = fx + l.offsetLeft, y = fy + l.offsetTop, f = clamp(this.fill[i].x);
      PICTO[AVOID[i][0]](ctx, x + 37.5, y + 25, '#fff');
      if (f > 0.002) {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, 75 * f, 66); ctx.clip();
        PICTO[AVOID[i][0]](ctx, x + 37.5, y + 25, '#141414');
        ctx.restore();
        // the strike goes from bottom left to top right as the fill arrives
        const s = clamp((f - 0.3) / 0.7), x0 = x + 17, y0 = y + 42, x1 = x + 58, y1 = y + 8;
        ctx.lineCap = 'round';
        for (const [c, lw] of [['#ffcd1c', 7], ['#141414', 3]]) {
          ctx.strokeStyle = c; ctx.lineWidth = lw;
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(lerp(x0, x1, s), lerp(y0, y1, s)); ctx.stroke();
        }
      }
    });
    return moving;
  }
}
customElements.define('route-avoid', RouteAvoid);
// #endregion route-avoid
