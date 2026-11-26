// ui-feed/toolbars.js: four controls from bars and drop zones, rebuilt from demos on ui-feed.dev.
//
//   <page-marker>     pagination: a <nav> of page buttons with a red marker that stretches from one page to
//                     the next, and the numerals it passes over drawn in the paper colour
//   <route-avoid>     a road sign with a fieldset of four checkboxes (tolls, motorways, ferries, unpaved);
//                     the canvas draws the route that avoids them and an <output> on a dot matrix board
//   <ledger-menubar>  a menubar over a workshop's ledger: menus of buttons, a checkbox and radios with menu
//                     roles, a blue bar that slides from item to item, and a <table> the menus change
//   <tee-print>       an <input type="file"> as the drop zone over a T-shirt; a PNG that is big enough is
//                     printed onto the shirt in one ink, and a file that isn't says why in big letters
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /toolbar-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, easeOut, rr, spring, TAU, reduced, dotBoard } from './kit.js';

const DIDONE = "'Bodoni Moda', 'Playfair Display', Didot, 'Bodoni 72', 'Bodoni MT', 'Libre Bodoni', 'Liberation Serif', 'Times New Roman', serif";
const SIGN = "'Overpass', 'Transport', 'B612', 'DIN Alternate', 'Barlow Semi Condensed', 'Arial Narrow', Inter, 'Helvetica Neue', Arial, sans-serif";
const TIMES = "'Times New Roman', Times, 'Liberation Serif', 'Nimbus Roman', serif";
const MONO = "'Courier New', Courier, 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const HEAVY = "'Archivo Black', 'Dela Gothic One', 'Arial Black', 'Inter Display', Inter, 'Helvetica Neue', Arial, sans-serif";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const changed = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

// A picture that does not change, drawn once on a plain canvas at the control's own scale.
function cached(ctrl, key, w, h, draw) {
  const store = ctrl.pictures ??= new Map(), px = ctrl.px;
  let c = store.get(key);
  if (!c || c.px !== px) {
    c = { px, canvas: c?.canvas ?? document.createElement('canvas') };
    c.canvas.width = Math.ceil(w * px); c.canvas.height = Math.ceil(h * px);
    const g = c.canvas.getContext('2d');
    g.scale(px, px); draw(g, w, h);
    store.set(key, c);
  }
  return c.canvas;
}

// Draw an element, then draw it again inside a rectangle with a fill behind it and a filter that turns its
// ink into `ink`. This is how a marker "inverts" the text it passes over with no second copy of the text.
const TO_PAPER = 'brightness(0) invert(0.94) sepia(0.22)';
const TO_WHITE = 'brightness(0) invert(1)';
function marker(ctx, el, x, y, r, fill, filter) {
  if (r.w <= 0.5 || r.h <= 0.5) return;
  ctx.save();
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
  ctx.fillStyle = fill; ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.filter = filter;
  put(ctx, el, x, y);
  ctx.restore();
}

// ---------------------------------------------------------------------------------------------------------
// Pagination: a marker that stretches from page to page
// ---------------------------------------------------------------------------------------------------------

const ARROW = '<svg viewBox="0 0 44 14" aria-hidden="true"><path d="M0 7h42M35.5 1.5 42 7l-6.5 5.5"/></svg>';

// #region page-marker
//   <page-marker name="page" pages="5" value="2"></page-marker>
// The pages are <button>s in a <nav>, with aria-current="page" on the one you're on. The canvas draws the
// nav, then draws it again inside the red marker with a filter that turns black ink into paper.
export class PageMarker extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static html = `<p class="where"></p><nav aria-label="Pagination"><ul></ul></nav>`;
  static css = `
    .where { width: 318px; font: 400 19px/1 ${DIDONE}; color: #161310; }
    nav { width: 318px; color: #161310; }
    ul { display: flex; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
    li.n { flex: 0 0 calc(100% / var(--n)); }
    li.step { flex: 1 1 50%; padding-top: 10px; }
    li.later { text-align: right; }
    button { all: unset; box-sizing: border-box; cursor: pointer; color: inherit; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .num { display: block; width: 100%; height: 112px; text-align: center; font: 400 80px/114px ${DIDONE}; }
    .num:focus-visible { box-shadow: inset 0 -6px 0 currentColor; }
    .num:active { transform: translateY(2px); }
    .step button { display: inline-flex; gap: 9px; align-items: center; padding: 6px 0; font: italic 400 22px/1.1 ${DIDONE}; }
    .step button:focus-visible { box-shadow: inset 0 -2px 0 currentColor; }
    .prev svg { transform: scaleX(-1); }
    .step button:active:not([aria-disabled=true]) { transform: translateX(var(--nudge)); }
    .prev { --nudge: -4px; } .next { --nudge: 4px; }
    .step button[aria-disabled=true] { opacity: 0.25; cursor: default; }
    svg { width: 30px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.3; }`;

  ready() {
    this.where = this.$('.where'); this.nav = this.$('nav');
    const n = this.pages = clamp(+this.getAttribute('pages') || 5, 2, 9);
    this.nav.style.setProperty('--n', n);
    const ul = this.$('ul');
    ul.innerHTML = Array.from({ length: n }, (_, i) => `<li class="n"><button type="button" class="num" data-p="${i + 1}" aria-label="Page ${i + 1}">${i + 1}</button></li>`).join('') +
      `<li class="step"><button type="button" class="prev" data-step="-1">${ARROW}Previous</button></li>` +
      `<li class="step later"><button type="button" class="next" data-step="1">Next${ARROW}</button></li>`;
    this.nums = this.$$('.num');
    const p = clamp(+this.getAttribute('value') || 1, 1, n);
    this.L = { x: p - 1, v: 0 }; this.R = { x: p, v: 0 }; this.lead = 1;
    ul.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.getAttribute('aria-disabled') === 'true') return;
      this.go(b.dataset.p ? +b.dataset.p : this.page + +b.dataset.step);
    });
    this.go(p, true);
  }
  get value() { return String(this.page); }
  set value(v) { this.go(+v); }
  go(p, quiet = false) {
    p = clamp(Math.round(p) || 1, 1, this.pages);
    if (p === this.page) return;
    this.lead = p > (this.page ?? p) ? 1 : -1;
    this.page = p;
    this.nums.forEach((b, i) => { if (i + 1 === p) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    // aria-disabled rather than disabled, so a button keeps focus when you reach the end with it
    this.$('.prev').setAttribute('aria-disabled', p === 1);
    this.$('.next').setAttribute('aria-disabled', p === this.pages);
    this.where.textContent = `Page ${p} of ${this.pages}`;
    this.setValue(String(p));
    if (!quiet) changed(this);
    this.request();
  }
  draw(ctx, w, h) {
    ctx.fillStyle = '#efe8dc'; ctx.fillRect(0, 0, w, h);
    const X = 21, Y = 122, W = 318, H = 112, cw = W / this.pages;
    put(ctx, this.where, X, Y - 36);
    ctx.fillStyle = '#161310';
    ctx.fillRect(X, Y - 1.5, W, 1.5); ctx.fillRect(X, Y + H, W, 1.5);
    put(ctx, this.nav, X, Y);
    // The edge in the direction of travel is stiff and the other is soft, so the marker stretches over the
    // pages in between and then catches up.
    const fast = [520, 40], slow = [150, 21], to = this.page;
    const [kl, cl] = this.lead < 0 ? fast : slow, [kr, cr] = this.lead > 0 ? fast : slow;
    const a = spring(this.L, to - 1, this.dt, kl, cl), b = spring(this.R, to, this.dt, kr, cr);
    const x0 = X + Math.min(this.L.x, this.R.x - 0.2) * cw, x1 = X + Math.max(this.R.x, this.L.x + 0.2) * cw;
    marker(ctx, this.nav, X, Y, { x: x0, y: Y, w: x1 - x0, h: H }, '#e3261c', TO_PAPER);
    return a || b;
  }
}
customElements.define('page-marker', PageMarker);
// #endregion page-marker

// ---------------------------------------------------------------------------------------------------------
// Route sign: a toggle group of things to avoid, and the route that avoids them
// ---------------------------------------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------------------------------------
// Menubar: menus over a workshop's ledger
// ---------------------------------------------------------------------------------------------------------

// Each menu item is [label, shortcut, command], or an object for a submenu, a checkbox or a radio. '-' is a separator.
const MENUS = [
  { label: 'File', items: [['Open books…', '⌘O'], ['Back up now', '⌘B'], '-', ['Import bank statement…', '⇧⌘I'], { label: 'Export', sub: [['As CSV'], ['As PDF'], ['For the accountant']] }, '-', ['Print…', '⌘P']] },
  { label: 'Edit', items: [['Undo', '⌘Z', 'undo'], ['Redo', '⇧⌘Z', 'redo'], '-', ['Cut', '⌘X'], ['Copy', '⌘C'], ['Paste', '⌘V'], '-', ['Find in ledger…', '⌘F']] },
  { label: 'Invoices', items: [['New invoice', '⌘I'], ['Invoice a job card…'], ['Credit note…'], '-', ['Email to customer', '⌘E'], ['Chase late payers'], '-', { check: 'unpaid', label: 'Unpaid only' }] },
  { label: 'Ledger', items: [['Post job card', '⌘J', 'post'], ['Record a payment', '⇧⌘P'], ['Reconcile with bank…', '⌘R'], '-', { check: 'vat', label: 'Show VAT column', checked: true }, { label: 'VAT return', sub: [['Jul to Sep 2026'], ['Oct to Dec 2026']] }] },
  { label: 'Reports', items: [['Profit and loss', '⌘1'], ['Labour and parts', '⌘2'], ['Who owes what', '⌘3'], '-', { radio: 'period', value: 'nov', label: 'November 2026', checked: true }, { radio: 'period', value: 'q4', label: 'Oct to Dec 2026' }, { radio: 'period', value: 'year', label: 'Tax year 2026 to 2027' }] },
  { label: 'Window', items: [['Minimise', '⌘M'], ['Zoom'], ['Enter full screen', '⌃⌘F'], '-', ['Bring all to front']] },
];
// Job cards that "Post job card" adds to the top of the ledger, one at a time.
const JOBS = [['Gear tune and new cable, Mensah', '6.50', '39.00'], ['Wheel build, rear, Doyle', '24.00', '144.00'], ['Brake bleed, front, Ito', '5.50', '33.00'], ['Chain and cassette, Byrne', '17.00', '102.00']];

let menuId = 0;
function menuHtml(items, id, sub = false) {
  const row = (it, j) => {
    if (it === '-') return '<div role="separator"></div>';
    if (Array.isArray(it)) {
      const [label, key, cmd] = it;
      return `<button type="button" role="menuitem" tabindex="-1" data-cmd="${cmd ?? ''}"${key ? ` aria-keyshortcuts="${key.replace('⇧', 'Shift+').replace('⌃', 'Control+').replace('⌘', 'Meta+')}"` : ''}><span>${esc(label)}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
    }
    if (it.sub) { const sid = `${id}-${j}`; return `<button type="button" role="menuitem" tabindex="-1" aria-haspopup="menu" aria-expanded="false" aria-controls="m${sid}" data-sub="m${sid}"><span>${esc(it.label)}</span><i aria-hidden="true">${'▸'}</i></button>`; }
    if (it.check) return `<label class="mi"><input type="checkbox" role="menuitemcheckbox" tabindex="-1" name="${it.check}"${it.checked ? ' checked' : ''}><span>${esc(it.label)}</span></label>`;
    return `<label class="mi"><input type="radio" role="menuitemradio" tabindex="-1" name="${it.radio}" value="${it.value}"${it.checked ? ' checked' : ''}><span>${esc(it.label)}</span></label>`;
  };
  return `<div role="menu" id="m${id}" class="${sub ? 'sub' : ''}" hidden>${items.map(row).join('')}</div>`;
}

// #region ledger-menubar
//   <ledger-menubar name="books"><option data-date="20 Nov" data-ref="JC-0419" data-vat="3.00" data-sum="18.00" data-unpaid>Rear wheel trued, Okafor</option>…</ledger-menubar>
// A role="menubar" of buttons. Each opens a role="menu" of buttons, with a checkbox or radios given menu
// roles where an item is on or off. Focus moves with the keys of a menubar; the canvas draws a blue bar
// under the focused item that slides to the next one, and draws the item's text white where the bar is.
export class LedgerMenubar extends FeedControl {
  static size = [360, 360];
  static radius = 2;
  static html = `<div role="menubar" aria-label="Workshop books"></div><table class="ledger"><colgroup><col style="width:44px"><col style="width:58px"><col><col class="c-vat"><col style="width:50px"></colgroup>
    <thead><tr><th>Date</th><th>Ref</th><th>Details</th><th class="vat n">VAT</th><th class="n">£</th></tr></thead><tbody></tbody></table>
    <output class="status" role="status"></output>`;
  static css = `
    [role=menubar] { display: flex; gap: 3px; width: 360px; padding: 3px; box-sizing: border-box; }
    [role=menubar] > button { all: unset; flex: auto; height: 32px; text-align: center; color: #000; font: 700 17px/32px ${TIMES}; cursor: default; }
    [role=menubar] > button:focus-visible { text-decoration: underline 2px; text-underline-offset: 3px; }
    [role=menu] { display: block; width: max-content; min-width: 176px; padding: 0; border: 3px solid #000; color: #000; }
    [role=menu][hidden] { display: none; }
    [role=menu] > button, .mi { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 22px; width: 100%; height: 28px; padding: 0 12px 0 14px; font: 400 15px/28px ${TIMES}; cursor: default; }
    [role=menu] > button > span, .mi > span { flex: auto; white-space: nowrap; }
    [role=menu] > button[aria-disabled=true] { color: #9a9a9a; }
    kbd { font: 700 11px/1 ${MONO}; letter-spacing: 0.06em; }
    [role=menu] i { font-style: normal; font-size: 11px; }
    [role=separator] { height: 0; border-top: 3px solid #000; margin: 2px 0; }
    .mi { gap: 9px; padding-left: 12px; }
    .mi input:focus { outline: none; }
    .mi input { appearance: none; flex: none; margin: 0; width: 12px; height: 12px; border: 1.5px solid currentColor; box-sizing: border-box; }
    .mi input[type=checkbox]:checked { background: linear-gradient(45deg, transparent 42%, currentColor 42% 58%, transparent 58%), linear-gradient(-45deg, transparent 42%, currentColor 42% 58%, transparent 58%); }
    .mi input[type=radio] { width: 9px; height: 9px; border: 0; margin: 0 1.5px; }
    .mi input[type=radio]:checked { background: currentColor; }
    table { width: 360px; border-collapse: collapse; table-layout: fixed; background: transparent; color: #000; font: 400 11.5px/1 ${TIMES}; --vw: 42px; }
    col.c-vat { width: var(--vw); }
    th, td { height: 16px; padding: 0 4px; border: 1px solid #000; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left; }
    th { font-weight: 700; border-bottom-width: 2px; }
    .vat { padding-inline: clamp(0px, calc(var(--vw) / 10), 4px); }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    td.ref { font: 400 9.5px/1 ${MONO}; letter-spacing: 0.04em; }
    table.novat .vat { display: none; }
    table.unpaid-only tbody tr:not([data-unpaid]) { display: none; }
    .status { width: 360px; height: 20px; padding: 0 8px; box-sizing: border-box; background: #000; color: #fff; font: 400 11px/20px ${MONO}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`;

  ready() {
    this.bar = this.$('[role=menubar]'); this.table = this.$('table'); this.tbody = this.$('tbody'); this.status = this.$('.status');
    const box = this.canvas ?? this.$('.plain');
    this.bar.innerHTML = MENUS.map((m, i) => `<button type="button" role="menuitem" aria-haspopup="menu" aria-expanded="false" aria-controls="m${i}" tabindex="${i ? -1 : 0}" data-i="${i}">${m.label}</button>`).join('');
    this.tops = this.$$('[role=menubar] > button');
    // The menus and submenus are children of the canvas, after the table, so they are drawn on top of it.
    const menus = [];
    MENUS.forEach((m, i) => {
      menus.push(menuHtml(m.items, i));
      m.items.forEach((it, j) => { if (Array.isArray(it.sub)) menus.push(menuHtml(it.sub, `${i}-${j}`, true)); });
    });
    for (const html of menus) box.insertBefore(node(html), this.status);
    this.menus = MENUS.map((_, i) => this.$(`#m${i}`));
    for (const o of options(this)) this.tbody.append(this.row(o.data.date, o.data.ref, o.label, o.data.vat, o.data.sum, 'unpaid' in o.data));
    this.open = -1; this.sub = null; this.posted = []; this.undone = []; this.job = 420;
    this.topBar = { x: 0, w: 0, v: 0, vw: 0 }; this.unroll = { x: 0, v: 0 }; this.itemBar = { x: -1, v: 0 }; this.subBar = { x: -1, v: 0 };
    this.flash = null; this.pos = new Map();
    this.vatW = { x: 42, v: 0 };

    this.bar.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) this.toggle(+b.dataset.i); });
    this.bar.addEventListener('pointerover', (e) => { const b = e.target.closest('button'); if (b && this.open >= 0 && +b.dataset.i !== this.open) this.show(+b.dataset.i, null); });
    this.shadowRoot.addEventListener('pointerover', (e) => { const it = e.target.closest?.('[role=menu] > button, [role=menu] .mi'); if (it) { const f = this.focusable(it); if (f !== this.shadowRoot.activeElement) this.focusItem(f); } });
    this.shadowRoot.addEventListener('click', (e) => {
      const it = e.target.closest?.('[role=menu] > button');
      if (it) this.activate(it);
    });
    this.shadowRoot.addEventListener('change', (e) => { if (e.target.closest?.('[role=menu]')) this.setting(e.target); });
    this.addEventListener('keydown', (e) => this.key(e));
    // A press anywhere but the menus and the menubar closes the open menu, as it does in an app.
    document.addEventListener('pointerdown', (e) => {
      if (this.open < 0) return;
      const path = e.composedPath();
      if (!path.some((n) => n.getAttribute?.('role') === 'menu' || n.getAttribute?.('role') === 'menubar')) this.close(false);
    });
    this.$('[name=vat]').checked || this.table.classList.add('novat');
    this.sync('Ready.');
  }

  row(date, ref, details, vat, sum, unpaid) {
    const tr = document.createElement('tr');
    if (unpaid) tr.dataset.unpaid = '';
    tr.innerHTML = `<td>${esc(date)}</td><td class="ref">${esc(ref)}</td><td>${esc(details)}</td><td class="vat n">${esc(vat ?? '')}</td><td class="n">${esc(sum)}</td>`;
    return tr;
  }
  items(menu) { return [...menu.children].filter((c) => c.getAttribute('role') !== 'separator').map((c) => this.focusable(c)); }
  focusable(el) { return el.matches('.mi') ? el.querySelector('input') : el; }
  rowOf(el) { return el.closest('.mi') ?? el; }
  // Every direct child of a layoutsubtree canvas is laid out at the canvas's corner, whatever its CSS
  // position says (left and top are ignored), so the place of each menu is kept here and used when drawing.
  place(menu, x, y) { this.pos.set(menu, { x: Math.max(0, Math.min(360 - menu.offsetWidth, x)), y }); }
  at(menu) { return this.pos.get(menu) ?? { x: 0, y: 0 }; }
  within(el, menu) { return this.slice(el, menu).top; }

  show(i, focus = 'first') {
    this.closeSub();
    if (this.open >= 0 && this.open !== i) { this.menus[this.open].hidden = true; this.tops[this.open].setAttribute('aria-expanded', 'false'); }
    const fresh = this.open !== i;
    this.open = i;
    const menu = this.menus[i], top = this.tops[i];
    menu.hidden = false;
    top.setAttribute('aria-expanded', 'true');
    this.place(menu, top.offsetLeft - 3, 37);
    this.tops.forEach((t, j) => t.tabIndex = j === i ? 0 : -1);
    if (fresh) { this.unroll.x = reduced() ? 1 : 0.15; this.unroll.v = 0; this.itemBar.x = -1; }
    const list = this.items(menu);
    if (focus === 'first') this.focusItem(list[0], true);
    else if (focus === 'last') this.focusItem(list.at(-1), true);
    else top.focus({ preventScroll: true });
    this.request();
  }
  toggle(i) { if (this.open === i) this.close(true); else this.show(i, null); }
  close(refocus = true) {
    if (this.open < 0) return;
    this.closeSub();
    const i = this.open;
    this.menus[i].hidden = true; this.tops[i].setAttribute('aria-expanded', 'false');
    this.open = -1;
    if (refocus) this.tops[i].focus({ preventScroll: true });
    this.request();
  }
  openSub(btn, focusFirst = true) {
    const menu = this.$(`#${btn.dataset.sub}`), parent = btn.closest('[role=menu]');
    if (this.sub && this.sub.menu !== menu) this.closeSub();
    menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
    // to the right of its item if it fits, otherwise to the left
    const p = this.at(parent), right = p.x + parent.offsetWidth - 3, x = right + menu.offsetWidth <= 360 ? right : p.x - menu.offsetWidth + 3;
    this.place(menu, x, p.y + this.within(btn, parent) - 3);
    this.sub = { menu, btn };
    if (focusFirst) { this.subBar.x = -1; this.focusItem(this.items(menu)[0], true); }
    this.request();
  }
  closeSub(refocus = false) {
    if (!this.sub) return;
    this.sub.menu.hidden = true; this.sub.btn.setAttribute('aria-expanded', 'false');
    if (refocus) this.sub.btn.focus({ preventScroll: true });
    this.sub = null;
  }
  focusItem(el, jump = false) {
    if (!el) return;
    const menu = el.closest('[role=menu]');
    if (this.sub && menu !== this.sub.menu && menu.contains(this.sub.btn) && el !== this.sub.btn) this.closeSub();
    el.focus({ preventScroll: true });
    if (jump) (menu.classList.contains('sub') ? this.subBar : this.itemBar).x = -1;
    this.request();
  }

  activate(it) {
    if (it.getAttribute('aria-disabled') === 'true') return;
    if (it.dataset.sub) return this.openSub(it);
    const menu = MENUS[this.open]?.label ?? '', cmd = it.dataset.cmd, label = it.querySelector('span').textContent;
    if (cmd === 'post') this.post();
    else if (cmd === 'undo') this.undo();
    else if (cmd === 'redo') this.redo();
    else this.sync(`${menu} › ${this.sub ? this.sub.btn.querySelector('span').textContent + ' › ' : ''}${label}: not part of this demo.`);
    this.close(true);
  }
  setting(input) {
    if (input.name === 'vat') this.vat(input.checked);
    if (input.name === 'unpaid') this.table.classList.toggle('unpaid-only', input.checked);
    this.sync(input.name === 'period' ? `Period: ${input.closest('.mi').textContent.trim()}.` : `${input.closest('.mi').textContent.trim()}: ${input.checked ? 'on' : 'off'}.`);
    changed(this);
  }
  // The VAT column narrows a frame at a time: its <col> width is changed in a frame callback, never inside
  // the paint handler, and each change raises a paint event of its own.
  vat(on) {
    if (on) this.table.classList.remove('novat');
    cancelAnimationFrame(this.vatRaf);
    let last = performance.now();
    const step = (now) => {
      const dt = clamp((now - last) / 1000, 1 / 240, 1 / 30); last = now;
      const moving = spring(this.vatW, on ? 42 : 0, dt, 200, 26);
      this.table.style.setProperty('--vw', `${Math.max(0, this.vatW.x).toFixed(2)}px`);
      if (moving) this.vatRaf = requestAnimationFrame(step);
      else if (!on) this.table.classList.add('novat');
    };
    this.vatRaf = requestAnimationFrame(step);
  }
  post() {
    const n = this.job++, [details, vat, sum] = JOBS[(n - 420) % JOBS.length], tr = this.row('26 Nov', `JC-0${n}`, details, vat, sum, true);
    this.tbody.prepend(tr);
    this.posted.push(tr); this.undone = [];
    this.flash = { tr, at: performance.now() };
    this.sync(`Posted JC-0${n}: ${details}, £${sum}.`);
    changed(this);
  }
  undo() {
    const tr = this.posted.pop(); if (!tr) return;
    tr.remove(); this.undone.push(tr); this.job--;
    this.sync(`Undo: removed ${tr.children[1].textContent}.`);
    changed(this);
  }
  redo() {
    const tr = this.undone.pop(); if (!tr) return;
    this.tbody.prepend(tr); this.posted.push(tr); this.job++;
    this.flash = { tr, at: performance.now() };
    this.sync(`Redo: posted ${tr.children[1].textContent}.`);
    changed(this);
  }
  // Menu items that depend on state, the status line and the form value.
  sync(message) {
    const cmd = (c) => this.$(`[data-cmd=${c}]`);
    cmd('undo').setAttribute('aria-disabled', !this.posted.length);
    cmd('redo').setAttribute('aria-disabled', !this.undone.length);
    cmd('post').querySelector('span').textContent = `Post job card JC-0${this.job}`;
    this.status.textContent = message;
    const fd = new FormData(), name = this.getAttribute('name') ?? 'books';
    for (const el of this.$$('[role=menu] input')) if (el.checked) fd.append(`${name}-${el.name}`, el.value);
    for (const tr of this.posted) fd.append(`${name}-posted`, tr.children[1].textContent);
    this.setValue(fd);
    this.request();
  }

  key(e) {
    const el = this.shadowRoot.activeElement;
    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); }
      else if (k === 'j') { e.preventDefault(); this.post(); }
      return;
    }
    if (!el) return;
    const top = el.closest('[role=menubar]') ? +el.dataset.i : -1;
    const move = (d) => { const i = (((top >= 0 ? top : this.open) + d) % MENUS.length + MENUS.length) % MENUS.length; if (this.open >= 0 || top < 0) this.show(i, 'first'); else { this.tops[i].focus({ preventScroll: true }); this.tops.forEach((t, j) => t.tabIndex = j === i ? 0 : -1); this.request(); } };
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    if (top >= 0) {
      if (e.key === 'ArrowRight') { handled(); move(1); }
      else if (e.key === 'ArrowLeft') { handled(); move(-1); }
      else if (e.key === 'Home') { handled(); move(-top); }
      else if (e.key === 'End') { handled(); move(MENUS.length - 1 - top); }
      else if (['ArrowDown', 'Enter', ' '].includes(e.key)) { handled(); this.show(top, 'first'); }
      else if (e.key === 'ArrowUp') { handled(); this.show(top, 'last'); }
      else if (e.key === 'Escape') { handled(); this.close(true); }
      return;
    }
    const menu = el.closest('[role=menu]');
    if (!menu) return;
    const list = this.items(menu), i = list.indexOf(el), inSub = menu.classList.contains('sub');
    if (e.key === 'ArrowDown') { handled(); this.focusItem(list[(i + 1) % list.length]); }
    else if (e.key === 'ArrowUp') { handled(); this.focusItem(list[(i - 1 + list.length) % list.length]); }
    else if (e.key === 'Home') { handled(); this.focusItem(list[0]); }
    else if (e.key === 'End') { handled(); this.focusItem(list.at(-1)); }
    else if (e.key === 'Enter' || e.key === ' ') { handled(); if (el.matches('input')) el.click(); else this.activate(el); }
    else if (e.key === 'Escape') { handled(); if (inSub) this.closeSub(true); else this.close(true); this.request(); }
    else if (e.key === 'ArrowRight') { handled(); if (el.dataset.sub) this.openSub(el); else move(1); }
    else if (e.key === 'ArrowLeft') { handled(); if (inSub) { this.closeSub(true); this.request(); } else move(-1); }
    else if (e.key === 'Tab') this.close(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      // type the first letter of an item to go to it
      const next = [...list.slice(i + 1), ...list.slice(0, i + 1)].find((x) => this.rowOf(x).textContent.trim().toLowerCase().startsWith(e.key.toLowerCase()));
      if (next) { handled(); this.focusItem(next); }
    }
  }

  draw(ctx, w, h, now) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    let moving = false;
    // the ledger, with a fading band behind a row that was just posted
    const TY = 38, TB = 340;
    ctx.save(); ctx.beginPath(); ctx.rect(0, TY, w, TB - TY); ctx.clip();
    if (this.flash) {
      const age = (now - this.flash.at) / 1400, tr = this.flash.tr;
      if (age < 1 && tr.isConnected) { ctx.fillStyle = `rgba(255, 214, 0, ${0.85 * (1 - age)})`; ctx.fillRect(0, TY + tr.offsetTop, w, tr.offsetHeight); moving = true; }
      else this.flash = null;
    }
    put(ctx, this.table, 0, TY);
    ctx.restore();
    put(ctx, this.status, 0, TB);

    // the menubar, and a bar on the open menu's title that slides along it. The bar and the menus have no
    // background of their own, so that the white of a second draw through the filter is only their ink.
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, 38);
    ctx.fillStyle = '#fff';
    for (const t of this.tops) ctx.fillRect(t.offsetLeft, 3, t.offsetWidth, 32);
    put(ctx, this.bar, 0, 0);
    const focus = this.shadowRoot.activeElement;
    if (this.open >= 0) {
      const t = this.tops[this.open], tx = t.offsetLeft, tw = t.offsetWidth;
      if (this.topBar.w === 0 || reduced()) { this.topBar.x = tx; this.topBar.w = tw; }
      const sx = { x: this.topBar.x, v: this.topBar.v }, sw = { x: this.topBar.w, v: this.topBar.vw };
      moving = spring(sx, tx, this.dt, 420, 34) | spring(sw, tw, this.dt, 420, 34) || moving;
      Object.assign(this.topBar, { x: sx.x, v: sx.v, w: sw.x, vw: sw.v });
      marker(ctx, this.bar, 0, 0, { x: this.topBar.x, y: 3, w: this.topBar.w, h: 32 }, '#1f1fff', TO_WHITE);

      // the open menu unrolls downwards, and a bar under the focused item slides to the next one
      const menu = this.menus[this.open], { x: mx, y: my } = this.at(menu), mw = menu.offsetWidth, mh = menu.offsetHeight;
      moving = spring(this.unroll, 1, this.dt, 300, 26) || moving;
      ctx.save(); ctx.beginPath(); ctx.rect(mx - 2, my, mw + 8, mh * clamp(this.unroll.x) + 6); ctx.clip();
      ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(mx + 5, my + 5, mw, mh);   // a hard shadow
      ctx.fillStyle = '#fff'; ctx.fillRect(mx, my, mw, mh);
      put(ctx, menu, mx, my);
      moving = this.itemMarker(ctx, menu, focus, this.itemBar) || moving;
      ctx.restore();
      if (this.sub) {
        const s = this.sub.menu, { x: sx, y: sy } = this.at(s);
        ctx.fillStyle = 'rgba(0,0,0,0.9)'; ctx.fillRect(sx + 5, sy + 5, s.offsetWidth, s.offsetHeight);
        ctx.fillStyle = '#fff'; ctx.fillRect(sx, sy, s.offsetWidth, s.offsetHeight);
        put(ctx, s, sx, sy);
        moving = this.itemMarker(ctx, s, focus, this.subBar) || moving;
      }
    } else this.topBar.w = 0;
    return moving;
  }
  // The blue bar under the focused item of one menu. It follows the item on a spring.
  itemMarker(ctx, menu, focus, bar) {
    const own = focus && menu.contains(focus) ? this.rowOf(focus) : (this.sub && menu.contains(this.sub.btn) ? this.sub.btn : null);
    if (!own) { bar.x = -1; return false; }
    const y = this.within(own, menu), m = this.at(menu);
    if (bar.x < 0 || reduced()) { bar.x = y; bar.v = 0; }
    const moving = spring(bar, y, this.dt, 520, 40);
    marker(ctx, menu, m.x, m.y, { x: m.x + 3, y: m.y + bar.x, w: menu.offsetWidth - 6, h: own.offsetHeight }, '#1f1fff', TO_WHITE);
    return moving;
  }
}
customElements.define('ledger-menubar', LedgerMenubar);
// #endregion ledger-menubar

// ---------------------------------------------------------------------------------------------------------
// T-shirt print: a file input as the drop zone
// ---------------------------------------------------------------------------------------------------------

const INK = '#1554d1', PINK = '#f2489b', NAVY = '#1b2591';
const HEADS = { empty: ['Drop', '<em>art</em>', 'here'], over: ['Let', 'go'], small: ['Too', 'small'], type: ['Not a', 'PNG'], done: [] };
// The print area: 15 by 18 inches on the front of the shirt.
const PRINT = { x: 85, y: 70, w: 190, h: 228, inW: 15, inH: 18 };

// #region tee-print
//   <tee-print name="art" min="1200" dpi="300"></tee-print>
// An <input type="file" accept="image/png"> covers the whole control and is drawn with no alpha, so a click
// or a dropped file anywhere lands on it. A label for it is the "Browse files" button. A PNG that is big
// enough is printed onto the shirt in one ink at its size in inches; anything else changes the headline.
export class TeePrint extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static html = `<input type="file" id="file" accept="image/png,.png" aria-describedby="hint">
    <p class="plate head" aria-hidden="true"></p><h2 class="head"></h2>
    <label class="browse" for="file">Browse files</label><p class="hint" id="hint"></p>
    <button type="button" class="alt"></button>
    <p class="fname"></p><p class="facts"></p><label class="replace" for="file">Replace</label><button type="button" class="remove">✕</button>
    <output class="said" role="status"></output>`;
  static css = `
    [hidden] { display: none !important; }
    input { width: 360px; height: 360px; opacity: 0; cursor: pointer; }
    .head { width: max-content; margin: 0; color: ${NAVY}; font: 900 84px/0.82 ${HEAVY}; letter-spacing: -2px; text-transform: uppercase; font-stretch: expanded; }
    .head span { display: block; } .head span:nth-child(2) { text-align: center; } .head em { font-style: normal; color: ${PINK}; }
    .plate { color: ${PINK}; } .plate em { color: #3046e0; }
    .browse { display: block; width: 108px; height: 30px; background: ${INK}; color: #fff; text-align: center; font: 800 13.5px/30px ${HEAVY}; letter-spacing: 0.02em; box-shadow: 4px 4px 0 ${PINK}; cursor: pointer; }
    .browse:active, .replace:active, .alt:active, .remove:active { transform: translate(2px, 2px); box-shadow: 2px 2px 0 ${PINK}; }
    .hint { width: 112px; margin: 0; color: ${INK}; font: 700 9px/1.3 ${HEAVY}; }
    .alt { all: unset; color: ${INK}; font: 800 9.5px/1.6 ${HEAVY}; text-decoration: underline 1.5px; text-underline-offset: 2px; cursor: pointer; }
    .alt:focus-visible, .remove:focus-visible { outline: 2px dashed ${INK}; outline-offset: 3px; }
    .fname { width: 244px; margin: 0; color: ${NAVY}; font: 900 24px/1 ${HEAVY}; letter-spacing: -0.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .facts { width: 230px; margin: 0; color: ${INK}; text-align: center; font: 700 8px/1 ${HEAVY}; opacity: 0.85; }
    .replace { display: block; width: 58px; height: 18px; border: 1.5px solid ${INK}; box-sizing: border-box; background: #fff; color: ${INK}; text-align: center; font: 800 9px/15px ${HEAVY}; box-shadow: 3px 3px 0 ${PINK}; cursor: pointer; }
    .remove { all: unset; box-sizing: border-box; width: 18px; height: 18px; border: 1.5px solid ${INK}; background: #fff; color: ${INK}; text-align: center; font: 700 11px/15px ${HEAVY}; box-shadow: 3px 3px 0 ${PINK}; cursor: pointer; }`;

  ready() {
    this.file = this.$('input'); this.headEl = this.$('h2.head'); this.plate = this.$('.plate');
    this.browse = this.$('.browse'); this.hint = this.$('.hint'); this.alt = this.$('.alt');
    this.fname = this.$('.fname'); this.facts = this.$('.facts'); this.replace = this.$('.replace'); this.remove = this.$('.remove'); this.said = this.$('.said');
    this.min = +this.getAttribute('min') || 1200; this.dpi = +this.getAttribute('dpi') || 300;
    this.reg = { x: 0, v: 0 }; this.inked = -1e9;
    this.file.addEventListener('change', () => this.take(this.file.files[0]));
    // a file dragged over the shirt changes the headline until it is dropped or leaves
    this.file.addEventListener('dragenter', () => { if (this.state !== 'over') { this.before = this.state; this.set('over'); } });
    this.file.addEventListener('dragleave', () => { if (this.state === 'over') this.set(this.before); });
    this.file.addEventListener('drop', () => { if (this.state === 'over') this.set(this.before); });
    this.alt.addEventListener('click', () => this.kept && this.state !== 'done' && this.state !== 'empty' ? this.keep() : this.sample());
    this.remove.addEventListener('click', () => this.clear());
    this.set('empty');
  }
  set(state, hint) {
    const was = this.state;
    this.state = state;
    const lines = HEADS[state].map((l) => `<span>${l}</span>`).join('');
    this.headEl.innerHTML = lines; this.plate.innerHTML = lines;
    this.headEl.hidden = this.plate.hidden = !lines;
    for (const el of [this.fname, this.facts, this.replace, this.remove]) el.hidden = state !== 'done';
    for (const el of [this.browse, this.hint, this.alt]) el.hidden = state === 'done';
    this.hint.textContent = hint ?? `PNG with a transparent background, at ${this.dpi} dpi. I print up to ${PRINT.inW} × ${PRINT.inH} in.`;
    this.alt.textContent = this.kept && state !== 'empty' ? `Keep ${this.kept.name}` : 'No artwork yet? Use the sample';
    this.remove.setAttribute('aria-label', `Remove ${this.kept?.name ?? 'the artwork'}`);
    // the new headline comes in with its two inks out of register, and they settle together
    if (was && was !== state && !reduced()) { this.reg.x = 1; this.reg.v = 0; }
    this.request();
  }
  async take(f) {
    if (!f) return;
    const say = (s) => { this.said.textContent = s; };
    const png = f.type === 'image/png' || /\.png$/i.test(f.name);
    if (!png) { say('1 file rejected.'); return this.set('type', `${f.name} isn't a PNG. Export it as a PNG with a transparent background.`); }
    let bmp;
    try { bmp = await createImageBitmap(f); } catch { say('1 file rejected.'); return this.set('type', `${f.name} couldn't be read as a PNG.`); }
    const { width: w, height: h } = bmp;
    if (Math.min(w, h) < this.min) {
      bmp.close(); say('1 file rejected.');
      return this.set('small', `${f.name} is ${w} × ${h} px: ${(w / this.dpi).toFixed(1)} × ${(h / this.dpi).toFixed(1)} in at ${this.dpi} dpi. Send ${this.min} px or more.`);
    }
    this.kept = f;
    this.art = { w, h, colours: countColours(bmp), ink: inkLayer(bmp, PRINT) };
    bmp.close();
    const inW = Math.min(PRINT.inW, w / this.dpi), inH = Math.min(PRINT.inH, h / this.dpi), fit = Math.min(inW / (w / this.dpi), inH / (h / this.dpi));
    this.art.inW = (w / this.dpi) * fit; this.art.inH = (h / this.dpi) * fit;
    this.fname.textContent = f.name;
    this.facts.textContent = `${Math.max(1, Math.round(f.size / 1000))} kB · ${w} × ${h} px at ${this.dpi} dpi · ${this.art.colours} colour${this.art.colours === 1 ? '' : 's'}`;
    this.inked = performance.now();
    say(`1 file accepted. ${f.name} prints at ${this.art.inW.toFixed(1)} by ${this.art.inH.toFixed(1)} in.`);
    this.send();
    this.set('done');
    changed(this);
  }
  send() {
    const fd = new FormData();
    if (this.kept && this.art) fd.append(this.getAttribute('name') ?? 'art', this.kept);
    this.setValue(fd);
  }
  keep() {
    const dt = new DataTransfer(); dt.items.add(this.kept); this.file.files = dt.files;
    this.said.textContent = `Kept ${this.kept.name}.`;
    this.set('done');
  }
  clear() {
    const name = this.kept?.name;
    this.kept = null; this.art = null; this.file.value = '';
    this.said.textContent = `${name} removed.`;
    this.send(); this.set('empty'); changed(this);
    this.file.focus({ preventScroll: true });
  }
  // The sample is drawn on a plain canvas and turned into a PNG file when you ask for it.
  async sample() {
    const c = document.createElement('canvas'); c.width = 1800; c.height = 2100;
    drawSample(c.getContext('2d'), 1800, 2100);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    const f = new File([blob], 'sea-swim-club.png', { type: 'image/png' }), dt = new DataTransfer();
    dt.items.add(f); this.file.files = dt.files;
    this.take(f);
  }

  draw(ctx, w, h, now) {
    ctx.drawImage(cached(this, 'tee', w, h, drawTee), 0, 0, w, h);
    let moving = spring(this.reg, 0, this.dt, 120, 14);
    const done = this.state === 'done' && this.art;
    if (done) {
      // the print, wiped on from the top as if by a squeegee, at its size in inches
      const t = reduced() ? 1 : clamp((now - this.inked) / 700), u = PRINT.w / PRINT.inW;
      const aw = this.art.inW * u, ah = this.art.inH * u, ax = PRINT.x + (PRINT.w - aw) / 2, ay = PRINT.y + 8;
      ctx.save(); ctx.beginPath(); ctx.rect(ax - 2, ay - 2, aw + 4, (ah + 4) * easeOut(t)); ctx.clip();
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(this.art.ink, ax, ay, aw, ah);
      ctx.restore();
      if (t < 1) { ctx.fillStyle = 'rgba(27,37,145,0.5)'; ctx.fillRect(ax - 6, ay + ah * easeOut(t) - 1, aw + 12, 2.5); moving = true; }
      rulers(ctx, ax, ay, aw, ah, this.art.inW, this.art.inH, clamp(t * 2 - 1));
      hit(ctx, this.file, 0, 0, w, h);
      put(ctx, this.facts, 180 - 115, 304);
      put(ctx, this.fname, 14, 322);
      put(ctx, this.replace, 262, 328);
      put(ctx, this.remove, 327, 328);
    } else {
      // The headline in two inks: a pink plate under the navy one, offset, coming into register. Both are
      // drawn up to 1.3 times wider than they are laid out, which stands in for an extended face.
      const o = 2.4 + this.reg.x * 16, hw = Math.min(this.headEl.offsetWidth * 1.3, 344), hh = this.headEl.offsetHeight;
      ctx.save();
      ctx.globalAlpha = 1 - this.reg.x * 0.45;
      put(ctx, this.plate, 8 + o, 10 + o * 0.6, hw, hh);
      put(ctx, this.headEl, 8 - this.reg.x * 6, 10 - this.reg.x * 3, hw, hh);
      ctx.restore();
      // the input goes over the headline, so a press on the big letters opens the picker too
      hit(ctx, this.file, 0, 0, w, h);
      put(ctx, this.browse, 64, 252);
      put(ctx, this.hint, 180, 250);
      put(ctx, this.alt, 64, 292);
    }
    // The file input has no picture of its own here, so its focus ring is drawn round the button it is under.
    if (this.shadowRoot.activeElement === this.file && this.file.matches(':focus-visible')) {
      const b = done ? [262, 328, 58, 18] : [64, 252, 108, 30];
      ctx.save(); ctx.strokeStyle = INK; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.strokeRect(b[0] - 4, b[1] - 4, b[2] + 8, b[3] + 8); ctx.restore();
    }
    // grain over everything, as on a print
    ctx.save(); ctx.globalAlpha = 0.5; ctx.drawImage(cached(this, 'grain', w, h, drawGrain), 0, 0, w, h); ctx.restore();
    return moving;
  }
}
customElements.define('tee-print', TeePrint);
// #endregion tee-print

function rulers(ctx, x, y, w, h, inW, inH, a) {
  if (a <= 0) return;
  ctx.save(); ctx.globalAlpha = a * 0.8; ctx.strokeStyle = INK; ctx.fillStyle = INK; ctx.lineWidth = 0.8;
  ctx.font = `700 7px ${HEAVY}`; ctx.textAlign = 'center';
  ctx.beginPath(); ctx.moveTo(x, y - 7); ctx.lineTo(x + w, y - 7); ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 4); ctx.moveTo(x + w, y - 10); ctx.lineTo(x + w, y - 4);
  ctx.moveTo(x + w + 9, y); ctx.lineTo(x + w + 9, y + h); ctx.moveTo(x + w + 6, y); ctx.lineTo(x + w + 12, y); ctx.moveTo(x + w + 6, y + h); ctx.lineTo(x + w + 12, y + h); ctx.stroke();
  const label = (s, tx, ty) => { const tw = ctx.measureText(s).width + 6; ctx.fillStyle = '#f6f6f8'; ctx.fillRect(tx - tw / 2, ty - 5, tw, 9); ctx.fillStyle = INK; ctx.fillText(s, tx, ty + 2.5); };
  label(`${inW.toFixed(1)} in`, x + w / 2, y - 7);
  ctx.translate(x + w + 9, y + h / 2); ctx.rotate(-Math.PI / 2); label(`${inH.toFixed(1)} in`, 0, 0);
  ctx.restore();
}

// The number of colours in a picture, from a small copy read once on a plain canvas (never a drawable one).
let counter;
function countColours(bmp) {
  counter ??= document.createElement('canvas');
  counter.width = counter.height = 48;
  const g = counter.getContext('2d', { willReadFrequently: true });
  g.clearRect(0, 0, 48, 48); g.drawImage(bmp, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data, seen = new Map();
  let solid = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    solid++;
    const k = (d[i] >> 5) << 6 | (d[i + 1] >> 5) << 3 | (d[i + 2] >> 5);
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return Math.max(1, [...seen.values()].filter((n) => n >= solid * 0.03).length);
}
// One ink: the picture's own alpha, and its darkness, as the strength of the ink, with a little grain.
function inkLayer(bmp, area) {
  const c = document.createElement('canvas'), W = Math.round(area.w * 3), H = Math.round(area.h * 3);
  const s = Math.min(W / bmp.width, H / bmp.height); c.width = Math.max(1, Math.round(bmp.width * s)); c.height = Math.max(1, Math.round(bmp.height * s));
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data, [r, gr, b] = [0x15, 0x54, 0xd1];
  for (let i = 0; i < d.length; i += 4) {
    const lum = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) / 255, a = (d[i + 3] / 255) * (1 - 0.8 * lum) * (0.82 + 0.18 * rnd(i));
    d[i] = r; d[i + 1] = gr; d[i + 2] = b; d[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// The shirt on pink: its shape, shading and shadow are painted once.
function drawTee(g, w, h) {
  g.fillStyle = '#f04a9c'; g.fillRect(0, 0, w, h);
  const shirt = new Path2D('M118 -4 C140 22 220 22 242 -4 L318 24 L372 92 L372 170 L322 156 L300 136 L304 338 L56 338 L60 136 L38 156 L-12 170 L-12 92 L42 24 Z');
  g.save(); g.translate(7, 9); g.fillStyle = 'rgba(52, 28, 140, 0.55)'; g.fill(shirt); g.restore();
  const body = g.createLinearGradient(0, 0, w, h); body.addColorStop(0, '#fbfbfd'); body.addColorStop(1, '#e9ecf6');
  g.fillStyle = body; g.fill(shirt);
  g.save(); g.clip(shirt);
  // folds, in thin blue, and the collar
  g.strokeStyle = 'rgba(21, 84, 209, 0.33)'; g.lineCap = 'round';
  for (let i = 0; i < 26; i++) {
    const x = 50 + rnd(i) * 260, y = 40 + rnd(i + 5) * 290, l = 10 + rnd(i + 9) * 34, a = -1.2 + rnd(i + 2) * 0.8;
    g.lineWidth = 0.6 + rnd(i + 4) * 1.4;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * l * 0.6 + 4, y + Math.sin(a) * l * 0.5, x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  g.lineWidth = 7; g.strokeStyle = 'rgba(21, 84, 209, 0.22)';
  g.beginPath(); g.moveTo(118, -4); g.bezierCurveTo(140, 26, 220, 26, 242, -4); g.stroke();
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(21, 84, 209, 0.4)';
  g.beginPath(); g.moveTo(60, 136); g.lineTo(52, 40); g.moveTo(300, 136); g.lineTo(308, 40); g.moveTo(62, 330); g.lineTo(298, 330); g.stroke();
  g.restore();
  g.strokeStyle = 'rgba(21, 84, 209, 0.6)'; g.lineWidth = 1; g.stroke(shirt);
}
function drawGrain(g, w, h) {
  for (let i = 0; i < 9000; i++) {
    const r = rnd(i * 1.37);
    g.fillStyle = r > 0.66 ? 'rgba(21,84,209,0.22)' : r > 0.33 ? 'rgba(255,255,255,0.3)' : 'rgba(240,74,156,0.16)';
    g.fillRect(rnd(i + 0.11) * w, rnd(i + 0.57) * h, 0.7, 0.7);
  }
}
// The sample artwork: a sun over three waves and the club's name, on a transparent background.
function drawSample(g, w, h) {
  g.clearRect(0, 0, w, h);
  g.scale(w / 1500, h / 1800); w = 1500;   // drawn in units of a 1500 by 1800 sheet
  g.fillStyle = '#000'; g.strokeStyle = '#000';
  g.beginPath(); g.arc(w / 2, 560, 300, 0, TAU); g.fill();
  g.lineWidth = 36; g.lineCap = 'round';
  for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * 360, 560 + Math.sin(a) * 360); g.lineTo(w / 2 + Math.cos(a) * 470, 560 + Math.sin(a) * 470); g.stroke(); }
  g.lineWidth = 46;
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    for (let x = 80; x <= w - 80; x += 10) { const y = 1060 + k * 110 + Math.sin(x / 95 + k) * 34; x === 80 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.stroke();
  }
  g.font = `900 190px ${HEAVY}`; g.textAlign = 'center';
  g.fillText('SEA SWIM', w / 2, 1560); g.font = `900 120px ${HEAVY}`; g.fillText('CLUB · EST 1926', w / 2, 1720);
}
