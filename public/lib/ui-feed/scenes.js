// ui-feed/scenes.js: five controls drawn into a picture, rebuilt from demos on ui-feed.dev.
//
//   <coast-path>       a hand-drawn map with a <button> for each waypoint and a role="tooltip" card that
//                      springs out of the one you point at or focus
//   <travel-journal>   a scrapbook page: an <input type="file"> drop zone, and the photos as a list, tossed
//                      onto the page as they are added
//   <backup-log>       a table with role="treegrid" drawn as a green screen waterfall of a night's backup;
//                      the rows that fold away are drawn sliding
//   <hob-lock>         two switches (<input type="checkbox" role="switch">) on a worktop under a hob whose
//                      zones and keys are a fieldset that the lock disables
//   <cutting-mat>      a crop box over a picture, with four range inputs for the keys and a drag that moves
//                      an edge, a corner or the box
//
// Each one is a FeedControl (kit.js): a custom element with one drawable 2D canvas in its shadow root and
// the native elements as children of that canvas. The originals are credited on /scene-controls/.

import { FeedControl, put, hit, options, esc, clamp, lerp, easeOut, rr, spring, TAU, reduced, seg7Text } from './kit.js';
import { cached } from './folds.js';

const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// A hand that prints. The test browser has none of these, and falls back to its sans-serif rather than to a script.
const HAND = "'Patrick Hand', 'Gochi Hand', 'Segoe Print', 'Bradley Hand', 'Chalkboard SE', 'Comic Sans MS', 'Comic Neue', ui-rounded, sans-serif";
const SANS = "'Inter', 'Helvetica Neue', Helvetica, Arial, ui-sans-serif, sans-serif";
const MONO = "'IBM Plex Mono', 'Courier Prime', 'Courier New', 'Liberation Mono', 'DejaVu Sans Mono', ui-monospace, monospace";
const node = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); const el = t.content.firstElementChild; el.setAttribute('drawable', ''); return el; };
const local = (el, e, size) => { const r = el.canvas.getBoundingClientRect(), k = r.width / size; return { x: (e.clientX - r.left) / k, y: (e.clientY - r.top) / k }; };

// ---------------------------------------------------------------------------------------------------------
// Coast path: a map drawn by the canvas, a button for each waypoint and one tooltip
// ---------------------------------------------------------------------------------------------------------

// The coast, as points from the top left to the bottom right. The sea is below and to the left of it.
const COAST = [[-10, 84], [30, 104], [70, 132], [110, 170], [150, 206], [196, 238], [236, 268], [270, 300], [300, 334], [318, 372]];
const along = (pts, t) => { const n = pts.length - 1, i = Math.min(n - 1, Math.floor(t * n)), k = t * n - i; return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)]; };

export class CoastPath extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    button.wp { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: transparent; font-size: 1px; cursor: pointer; }
    button.wp:focus-visible { outline: 0; }
    .tip { width: max-content; max-width: 250px; padding: 9px 12px 10px; background: #fffdf6; border: 2px solid #161616; box-shadow: 4px 4px 0 #161616; color: #161616; font-family: ${HAND}; }
    .tip small { display: block; font-size: 11px; letter-spacing: 0.04em; }
    .tip b { display: inline-block; margin: 2px 0 8px; font: 700 26px/1.05 ${HAND}; border-bottom: 2px solid #d4372c; }
    .tip dl { display: flex; margin: 0; }
    .tip dl div { padding: 0 9px; white-space: nowrap; border-left: 1.5px solid #161616; }
    .tip dl div:first-child { padding-left: 0; border: 0; }
    .tip dt { font: 400 21px/1 ${HAND}; }
    .tip dt i { font-style: normal; font-size: 12px; margin-left: 2px; }
    .tip dd { margin: 3px 0 0; font-size: 10px; }`;

  ready() {
    this.pop = { x: 0, v: 0 };
    this.build();
  }

  // #region coast-path
  build() {
    const box = this.canvas ?? this.$('.plain');
    this.points = options(this).map((o) => ({ ...o, x: +o.data.x, y: +o.data.y }));
    this.tip = node('<div class="tip" role="tooltip" id="tip"></div>');
    this.buttons = this.points.map((p, i) => node(`<button class="wp" type="button" aria-describedby="tip" data-i="${i}">${esc(p.label)}</button>`));
    box.replaceChildren(...this.buttons, this.tip);
    this.shown = -1; this.pinned = -1;
    const show = (i) => { if (i === this.shown) return; this.shown = i; this.fill(i); this.pop.x = Math.min(this.pop.x, 0.2); this.request(); };
    this.buttons.forEach((b, i) => {
      b.addEventListener('pointerenter', () => show(i));
      b.addEventListener('pointerleave', () => show(this.pinned >= 0 ? this.pinned : this.shadowRoot.activeElement?.classList.contains('wp') ? +this.shadowRoot.activeElement.dataset.i : -1));
      b.addEventListener('focus', () => show(i));
      b.addEventListener('blur', () => { if (this.pinned !== i) show(this.pinned); });
      // A tap pins the card, so it stays when the finger lifts. A second tap lets it go.
      b.addEventListener('click', () => { this.pinned = this.pinned === i ? -1 : i; show(this.pinned >= 0 ? i : -1); });
    });
    // Escape hides the card, as a tooltip should (WCAG 1.4.13), without moving focus.
    this.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.shown >= 0) { this.pinned = -1; show(-1); } });
    this.tip.hidden = true;
  }
  fill(i) {
    const p = this.points[i];
    this.tip.hidden = i < 0;
    if (!p) return;
    const d = p.data;
    this.tip.innerHTML = `<small>${esc(d.note ?? '')}</small><b>${esc(p.label)}</b><dl><div><dt>${esc(d.km)}<i>km</i></dt><dd>${esc(d.from ?? 'from start')}</dd></div><div><dt>${esc(d.time)}</dt><dd>walking</dd></div><div><dt>↑${esc(d.climb)}<i>m</i></dt><dd>${esc(d.up ?? 'climbed')}</dd></div></dl>`;
  }

  draw(ctx, w, h) {
    ctx.drawImage(cached(this, 'map', 360, 360, (g) => drawMap(g, this.points)), 0, 0, w, h);
    const focus = this.shadowRoot.activeElement;
    this.points.forEach((p, i) => {
      const on = i === this.shown;
      ctx.beginPath(); ctx.arc(p.x, p.y, on ? 7.5 : 6, 0, TAU);
      ctx.fillStyle = on ? '#d4372c' : '#fffdf6'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#161616'; ctx.stroke();
      if (on) { ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, TAU); ctx.fillStyle = '#161616'; ctx.fill(); }
      if (focus === this.buttons[i]) { ctx.save(); ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(p.x, p.y, 12, 0, TAU); ctx.stroke(); ctx.restore(); }
      hit(ctx, this.buttons[i], p.x - 11, p.y - 11, 22, 22);
    });
    // The card springs out of the waypoint. It sits below and to one side, and above near the bottom.
    let moving = spring(this.pop, this.shown >= 0 ? 1 : 0, this.dt, 320, 20);
    if (this.shown >= 0 && this.pop.x > 0.02) {
      const p = this.points[this.shown], tw = this.tip.offsetWidth, th = this.tip.offsetHeight;
      const below = p.y + 28 + th < h - 8, tx = clamp(p.x - tw * 0.35, 8, w - tw - 12), ty = below ? p.y + 26 : p.y - 26 - th;
      const s = clamp(this.pop.x, 0, 1.2);
      // the stem, drawn first so the card covers its end
      ctx.strokeStyle = '#161616'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y + (below ? 8 : -8)); ctx.lineTo(p.x, lerp(p.y, below ? ty + 2 : ty + th - 2, Math.min(1, s))); ctx.stroke();
      ctx.save();
      ctx.globalAlpha = clamp(s * 2);
      ctx.translate(p.x, p.y); ctx.scale(s, s); ctx.translate(-p.x, -p.y);
      put(ctx, this.tip, tx, ty, tw, th);
      ctx.restore();
    } else hit(ctx, this.tip, -1000, 0);
    return moving;
  }
  // #endregion coast-path
}
customElements.define('coast-path', CoastPath);

// The map: squared paper, the sea, the cliffs hatched in ink, contours on the hills, two towns, the path.
function drawMap(g, pts) {
  g.fillStyle = '#f7f5ee'; g.fillRect(0, 0, 360, 360);
  g.strokeStyle = 'rgba(120,130,150,0.16)'; g.lineWidth = 0.5;
  for (let i = 0; i <= 360; i += 9) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 360); g.moveTo(0, i); g.lineTo(360, i); g.stroke(); }
  const ink = '#1b1b1b';
  // the normal of the coast, pointing inland (up and right)
  const inland = (t) => { const a = along(COAST, Math.max(0, t - 0.01)), b = along(COAST, Math.min(1, t + 0.01)), dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); return [dy / l, -dx / l]; };
  // contours on the hills: wavy lines further and further inland
  g.strokeStyle = ink; g.lineCap = 'round';
  for (let c = 0; c < 9; c++) {
    const off = 46 + c * 21 + rnd(c) * 6;
    g.lineWidth = 0.7;
    for (let piece = 0; piece < 7; piece++) {
      const t0 = rnd(c * 9 + piece) * 0.9, len = 0.06 + rnd(c * 11 + piece) * 0.12;
      g.beginPath();
      for (let k = 0; k <= 12; k++) {
        const t = clamp(t0 + len * k / 12), [x, y] = along(COAST, t), [nx, ny] = inland(t), o = off + Math.sin(t * 40 + c) * 4;
        k ? g.lineTo(x + nx * o, y + ny * o) : g.moveTo(x + nx * o, y + ny * o);
      }
      g.stroke();
    }
  }
  // the cliffs: hatching across a band inland of the coast, cross-hatched where it is steepest
  for (let i = 0; i <= 300; i++) {
    const t = i / 300, [x, y] = along(COAST, t), [nx, ny] = inland(t), len = 30 + 26 * (0.5 + 0.5 * Math.sin(t * 13)) + rnd(i) * 10;
    g.lineWidth = 0.45 + rnd(i + 3) * 0.4;
    g.beginPath(); g.moveTo(x + rnd(i) - 0.5, y); g.lineTo(x + nx * len + (rnd(i + 1) - 0.5) * 4, y + ny * len); g.stroke();
    if (i % 2 === 0 && Math.sin(t * 17) > -0.2) { g.beginPath(); g.moveTo(x + nx * 4, y + ny * 4 + 6); g.lineTo(x + nx * len * 0.7 + 8, y + ny * len * 0.7 - 2); g.stroke(); }
  }
  // the coast line, and the sea as short strokes along it
  g.lineWidth = 2; g.beginPath(); COAST.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  g.lineWidth = 0.6;
  for (let r = 1; r < 4; r++) for (let i = 0; i < 18; i++) {
    const t = rnd(i * 7 + r), [x, y] = along(COAST, t), [nx, ny] = inland(t), o = -8 * r - rnd(i) * 6;
    g.beginPath(); g.moveTo(x + nx * o - ny * 5, y + ny * o + nx * 5); g.lineTo(x + nx * o + ny * 5, y + ny * o - nx * 5); g.stroke();
  }
  // the path, a red dashed line through the waypoints
  g.strokeStyle = '#d4372c'; g.lineWidth = 2.2; g.setLineDash([5, 4]);
  g.beginPath();
  pts.forEach((p, i) => { if (!i) return g.moveTo(p.x, p.y); const q = pts[i - 1], mx = (p.x + q.x) / 2 + (rnd(i) - 0.5) * 18, my = (p.y + q.y) / 2 + (rnd(i + 5) - 0.5) * 18; g.quadraticCurveTo(mx, my, p.x, p.y); });
  g.stroke(); g.setLineDash([]);
  // the towns at each end: little blocks of houses, and their names in capitals
  const town = (x, y) => { g.save(); g.translate(x, y); g.rotate(-0.6); g.strokeStyle = ink; g.lineWidth = 0.8; for (let i = 0; i < 9; i++) { const bx = (i % 3) * 7 - 10, by = Math.floor(i / 3) * 7 - 10; g.strokeRect(bx, by, 5.5, 5.5); g.beginPath(); for (let k = 1; k < 5; k++) { g.moveTo(bx, by + k * 1.1); g.lineTo(bx + 5.5, by + k * 1.1); } g.stroke(); } g.restore(); };
  for (const p of pts) if (p.data.town !== undefined) town(p.x + (+p.data.tx || -14), p.y + (+p.data.ty || -16));
  g.fillStyle = ink; g.font = `400 15px ${HAND}`;
  const caps = (s, x, y) => { g.save(); g.letterSpacing = '3px'; g.fillText(s.toUpperCase(), x, y); g.restore(); };
  for (const p of pts) if (p.data.town !== undefined) caps(p.label, p.x + (+p.data.lx || 18), p.y + (+p.data.ly || 5));
  // the scale bar and north
  g.strokeStyle = ink; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(254, 26); g.lineTo(322, 26); g.moveTo(254, 21); g.lineTo(254, 31); g.moveTo(322, 21); g.lineTo(322, 31); g.stroke();
  for (let i = 1; i < 10; i++) { g.beginPath(); g.moveTo(254 + i * 6.8, 26); g.lineTo(254 + i * 6.8, 22); g.stroke(); }
  g.font = `400 11px ${HAND}`; g.fillText('0', 251, 42); g.fillText('500 m', 305, 42);
  g.beginPath(); g.moveTo(336, 58); g.lineTo(346, 26); g.moveTo(341, 31); g.lineTo(346, 26); g.lineTo(349, 33); g.stroke();
  g.fillText('N', 344, 20);
}

// ---------------------------------------------------------------------------------------------------------
// Travel journal: a file input as a drop zone, and the photos as a list, tossed onto a scrapbook page
// ---------------------------------------------------------------------------------------------------------

// Where each photo lands on the page, and its tilt. Photos after these are piled near the middle.
const SLOTS = [{ x: 14, y: 104, w: 156, h: 118, r: -0.035 }, { x: 196, y: 88, w: 112, h: 152, r: 0.03 }, { x: 8, y: 236, w: 138, h: 108, r: 0.025 }, { x: 132, y: 226, w: 102, h: 126, r: -0.05 }];

export class TravelJournal extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static css = `
    h2 { width: 250px; margin: 0; display: flex; flex-wrap: wrap; gap: 2px 3px; align-items: flex-end; }
    h2 span { display: inline-block; padding: 1px 4px; font: 900 18px/1 ${SANS}; color: #111; background: #fff; }
    h2 span.big { font: 900 28px/0.95 Impact, 'Anton', 'Arial Black', ${SANS}; padding: 2px 5px; }
    h2 span:nth-child(3n) { background: #f2c84b; } h2 span:nth-child(4n) { background: #111; color: #fff; }
    h2 span:nth-child(5n) { background: #e74c6b; color: #fff; font-family: Georgia, serif; } h2 span:nth-child(7n) { background: #f5a3b5; }
    h2 span.gap { width: 100%; height: 0; padding: 0; background: none; }
    p.date { width: max-content; padding: 4px 8px; background: #f3f0e6; font: 600 9px/1 ${MONO}; color: #111; }
    output.count { width: max-content; display: flex; align-items: center; gap: 6px; padding: 3px 7px 3px 3px; background: #f3f0e6; font: 800 8px/1 ${MONO}; letter-spacing: 0.08em; color: #111; }
    output.count b { padding: 2px 5px; background: #e74c6b; color: #fff; font: 900 20px/1 Impact, 'Arial Black', ${SANS}; }
    ul { width: 360px; height: 360px; margin: 0; padding: 0; list-style: none; }
    li { position: absolute; padding: 5px 5px 0; background: #fbfaf5; box-sizing: border-box; }
    li .pic { display: block; width: 100%; background: #9aa; object-fit: cover; }
    li p { margin: 0; display: flex; align-items: center; gap: 6px; height: 22px; font: 600 8.5px/1 ${MONO}; color: #111; white-space: nowrap; overflow: hidden; }
    li time { padding: 2px 4px; background: #111; color: #fff; font: 700 9px/1 ${MONO}; }
    label.drop { display: grid; place-items: center; align-content: center; gap: 6px; width: 112px; height: 104px; border: 0; color: #fff; text-align: center; font: 800 10px/1.2 ${MONO}; letter-spacing: 0.04em; cursor: pointer; }
    label.drop small { font: 500 7px/1 ${MONO}; opacity: 0.85; }
    label.drop span.add { padding: 4px 7px; background: #f2c84b; color: #111; font: 800 8px/1 ${MONO}; }
    label.drop input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
    output.status { width: 360px; font: 600 9px/1.2 ${MONO}; color: #fff; text-align: right; }`;

  ready() {
    this.added = [];
    this.build();
    this.addEventListener('feed-plain', () => { for (const li of this.list.children) li.style.position = 'static'; });
  }

  // #region travel-journal
  build() {
    const box = this.canvas ?? this.$('.plain');
    const day = esc(this.getAttribute('day') ?? '1'), place = esc(this.getAttribute('place') ?? '');
    // The heading is cut out letter by letter, like a ransom note. Each letter is a span, read as one word.
    const cut = (s, cls) => [...s].map((c) => `<span class="${cls}" aria-hidden="true">${esc(c)}</span>`).join('');
    this.head = node(`<h2 aria-label="Day ${day}, ${place}">${cut('DAY', '')}${cut(day, 'big')}<span class="gap"></span>${cut(place.toUpperCase(), 'big')}</h2>`);
    this.date = node(`<p class="date">${esc(this.getAttribute('date') ?? '')}</p>`);
    this.count = node('<output class="count"><b>0</b>PHOTOS</output>');
    this.list = node('<ul aria-label="Photos"></ul>');
    this.drop = node(`<label class="drop"><span>DROP PHOTOS<br>HERE</span><small>JPG · PNG · WebP</small><span class="add">+ ADD PHOTOS</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple></label>`);
    this.file = this.drop.querySelector('input');
    this.status = node('<output class="status" role="status"></output>');
    box.replaceChildren(this.head, this.date, this.count, this.list, this.drop, this.status);
    // The photos the page starts with are <option>s. Their pictures are painted by the canvas.
    for (const o of options(this)) this.add({ time: o.data.time, title: o.label, scene: o.data.scene, start: true });
    this.file.addEventListener('change', () => this.take([...this.file.files]));
    // A file dragged over the zone: the input takes the drop itself, and the zone is drawn lit while it is over.
    this.file.addEventListener('dragenter', () => { this.over = true; this.request(); });
    this.file.addEventListener('dragleave', () => { this.over = false; this.request(); });
    this.file.addEventListener('drop', () => { this.over = false; });
    this.sync();
  }
  // Files from the input. Only pictures are taken; the rest are named in the status line.
  take(files) {
    const ok = files.filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type)), bad = files.filter((f) => !ok.includes(f));
    for (const f of ok) {
      const at = new Date(f.lastModified || Date.now());
      this.add({ time: `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`, title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), file: f });
    }
    this.status.textContent = `${ok.length} ${ok.length === 1 ? 'file' : 'files'} accepted.${bad.length ? ` ${bad.map((f) => f.name).join(', ')} ${bad.length === 1 ? 'is not a' : 'are not'} JPG, PNG or WebP.` : ''}`;
    this.sync();
  }
  add({ time, title, scene, file, start }) {
    const i = this.added.length, slot = SLOTS[i] ?? { x: 70 + rnd(i) * 120, y: 110 + rnd(i + 1) * 120, w: 130, h: 116, r: (rnd(i + 2) - 0.5) * 0.24 };
    const li = document.createElement('li');
    li.style.cssText = `left:${slot.x}px;top:${slot.y}px;width:${slot.w}px;height:${slot.h}px`;
    const url = file ? URL.createObjectURL(file) : '';
    li.innerHTML = `${file ? `<img class="pic" alt="${esc(title)}" src="${url}">` : `<span class="pic" role="img" aria-label="${esc(title)}"></span>`}<p><time>${esc(time ?? '')}</time>${esc(title)}</p>`;
    li.querySelector('.pic').style.height = `${slot.h - 27}px`;
    this.list.append(li);
    // A new photo is tossed on: it falls from above the page, turning, and lands on its slot.
    this.added.push({ li, slot, scene, file, y: { x: start ? 0 : -1, v: 0 }, url });
    li.querySelector('img')?.addEventListener('load', () => this.request());
  }
  sync() {
    this.count.querySelector('b').textContent = this.added.length;
    const fd = new FormData(), name = this.getAttribute('name') ?? 'photos';
    for (const a of this.added) if (a.file) fd.append(name, a.file);
    this.setValue(fd);
    this.request();
  }

  draw(ctx, w, h, now) {
    let moving = false;
    ctx.drawImage(cached(this, 'felt', 360, 360, felt), 0, 0, w, h);
    put(ctx, this.head, 12, 12);
    put(ctx, this.date, 214, 70);
    put(ctx, this.count, 268, 14);
    // The list is laid out as one element. Each photo is drawn as a slice of its picture, turned, with tape.
    const L = this.list;
    for (const a of this.added) {
      moving = spring(a.y, 0, this.dt, 120, 14) || moving;
      const s = a.slot, fall = a.y.x, cx = s.x + s.w / 2, cy = s.y + s.h / 2 + fall * 300;
      ctx.save();
      ctx.translate(cx, cy); ctx.rotate(s.r + fall * 0.9); ctx.translate(-s.w / 2, -s.h / 2);
      ctx.shadowColor = 'rgba(0,0,20,0.45)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#fbfaf5'; ctx.fillRect(0, 0, s.w, s.h);
      ctx.shadowColor = 'transparent';
      ctx.beginPath(); ctx.rect(0, 0, s.w, s.h); ctx.clip();
      put(ctx, L, -s.x, -s.y, L.offsetWidth, L.offsetHeight);
      if (!a.file) ctx.drawImage(cached(this, 'scene-' + a.scene + s.w, s.w - 10, s.h - 27, (g, sw, sh) => scene(g, a.scene, sw, sh)), 5, 5, s.w - 10, s.h - 27);
      ctx.restore();
      // a strip of tape across the top
      ctx.save(); ctx.translate(cx, cy - s.h / 2); ctx.rotate(s.r * 2 - 0.2 + fall); ctx.fillStyle = 'rgba(240,232,200,0.75)'; ctx.fillRect(-18, -6, 36, 12); ctx.restore();
    }
    hit(ctx, L, -2000, 0);
    // the drop zone: blue, with a dashed edge that runs while a file is over it, and scissors
    const Z = { x: 236, y: 244, w: 112, h: 104 };
    ctx.fillStyle = '#1946d8'; ctx.fillRect(Z.x, Z.y, Z.w, Z.h);
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = this.over ? 2 : 1.2; ctx.setLineDash([4, 3]);
    if (this.over && !reduced()) { ctx.lineDashOffset = -now / 40; moving = true; }
    ctx.strokeRect(Z.x + 3, Z.y + 3, Z.w - 6, Z.h - 6); ctx.restore();
    if (this.over) { ctx.fillStyle = 'rgba(242,200,75,0.25)'; ctx.fillRect(Z.x, Z.y, Z.w, Z.h); }
    put(ctx, this.drop, Z.x, Z.y, Z.w, Z.h);
    if (this.shadowRoot.activeElement === this.file) { ctx.save(); ctx.strokeStyle = '#f2c84b'; ctx.lineWidth = 2.5; ctx.strokeRect(Z.x - 2, Z.y - 2, Z.w + 4, Z.h + 4); ctx.restore(); }
    put(ctx, this.status, 0, 350);
    return moving;
  }
  // #endregion travel-journal
}
customElements.define('travel-journal', TravelJournal);

function felt(g) {
  g.fillStyle = '#1f4fd6'; g.fillRect(0, 0, 360, 360);
  for (let i = 0; i < 3200; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '120,160,255' : '0,10,80'},${0.08 + rnd(i + 1) * 0.12})`; g.fillRect(rnd(i + 2) * 360, rnd(i + 3) * 360, 1 + rnd(i + 4) * 2, 1); }
}

// Four little paintings for the photos the page starts with, so that no picture is borrowed.
function scene(g, kind, w, h) {
  const sky = (a, b) => { const s = g.createLinearGradient(0, 0, 0, h); s.addColorStop(0, a); s.addColorStop(1, b); g.fillStyle = s; g.fillRect(0, 0, w, h); };
  if (kind === 'town') {
    sky('#f3b38c', '#c9a6b8');
    for (let row = 0; row < 7; row++) for (let i = 0; i < 9; i++) {
      const bw = 12 + rnd(row * 9 + i) * 14, x = i * (w / 8) - 6 + rnd(i + row) * 6, y = h * 0.3 + row * h * 0.1 + rnd(row + i * 3) * 6;
      g.fillStyle = `hsl(${30 + rnd(i * row) * 12}, ${30 + rnd(i) * 15}%, ${58 + rnd(row * 7 + i) * 22 - row * 3}%)`; g.fillRect(x, y, bw, h * 0.12);
      g.fillStyle = 'rgba(60,40,40,0.55)'; g.fillRect(x + bw * 0.35, y + h * 0.05, 2.5, 4);
    }
    g.fillStyle = '#c9b29c'; g.fillRect(w * 0.62, h * 0.12, 7, h * 0.22); g.beginPath(); g.moveTo(w * 0.62 - 2, h * 0.12); g.lineTo(w * 0.62 + 3.5, h * 0.05); g.lineTo(w * 0.62 + 9, h * 0.12); g.fill();
  } else if (kind === 'bread') {
    sky('#5b4636', '#2b211b');
    g.fillStyle = '#8a6a4b'; g.fillRect(0, h * 0.62, w, h);
    const loaf = g.createRadialGradient(w * 0.45, h * 0.42, 4, w * 0.5, h * 0.52, w * 0.42); loaf.addColorStop(0, '#e8b779'); loaf.addColorStop(0.6, '#b97a3e'); loaf.addColorStop(1, '#6b3f1d');
    g.fillStyle = loaf; g.beginPath(); g.ellipse(w * 0.5, h * 0.55, w * 0.38, h * 0.26, -0.15, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(250,220,170,0.7)'; g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(w * (0.3 + i * 0.15), h * 0.42); g.quadraticCurveTo(w * (0.36 + i * 0.15), h * 0.5, w * (0.33 + i * 0.15), h * 0.66); g.stroke(); }
  } else if (kind === 'steps') {
    sky('#e9dcc2', '#b9a183');
    g.fillStyle = '#d8c6a5'; g.fillRect(0, 0, w * 0.22, h); g.fillRect(w * 0.78, 0, w, h);
    for (let i = 0; i < 12; i++) { const y = h * 0.35 + i * h * 0.055, inset = (12 - i) * w * 0.012; g.fillStyle = i % 2 ? '#c4ad89' : '#a8916f'; g.fillRect(w * 0.22 + inset, y, w * 0.56 - inset * 2, h * 0.055); }
    g.fillStyle = 'rgba(80,60,40,0.35)'; for (let i = 0; i < 6; i++) g.fillRect(w * (0.04 + (i % 2) * 0.8), h * (0.15 + i * 0.12), 8, 12);
  } else {
    sky('#dfe7ec', '#c3ccd1');
    g.fillStyle = '#e9e3d6'; g.fillRect(w * 0.15, h * 0.2, w * 0.7, h * 0.8);
    g.fillStyle = '#2c5aa0'; g.beginPath(); g.ellipse(w * 0.5, h * 0.6, w * 0.16, h * 0.17, 0, 0, TAU); g.fill();
    g.fillStyle = '#c0392b'; g.beginPath(); g.moveTo(w * 0.5, h * 0.33); g.lineTo(w * 0.58, h * 0.45); g.lineTo(w * 0.44, h * 0.45); g.fill();
    g.fillStyle = '#f2c84b'; g.beginPath(); g.moveTo(w * 0.62, h * 0.48); g.lineTo(w * 0.72, h * 0.5); g.lineTo(w * 0.62, h * 0.53); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(w * 0.55, h * 0.47, 2.5, 0, TAU); g.fill();
  }
  // a little grain, as a print has
  for (let i = 0; i < w * h / 40; i++) { g.fillStyle = `rgba(${rnd(i) > 0.5 ? '255,255,255' : '0,0,0'},0.06)`; g.fillRect(rnd(i + 1) * w, rnd(i + 2) * h, 1, 1); }
}

// ---------------------------------------------------------------------------------------------------------
// Backup log: a treegrid of the night's jobs, drawn as a green screen waterfall
// ---------------------------------------------------------------------------------------------------------

const GREEN = '#5dff9a', DIM = 'rgba(93,255,154,0.55)';
const hms = (s) => { const [h, m, x] = String(s).split(':').map(Number); return h * 3600 + m * 60 + (x || 0); };
const fmt = (v) => `${String(Math.floor(v / 3600)).padStart(2, '0')}:${String(Math.floor(v / 60) % 60).padStart(2, '0')}:${String(Math.round(v % 60)).padStart(2, '0')}`;
const span = (v) => `${Math.floor(v / 60)} min ${Math.round(v % 60)} s`;

export class BackupLog extends FeedControl {
  static size = [360, 360];
  static radius = 10;
  static CHART = { x: 150, w: 186, top: 48, row: 24 };
  static css = `
    table { width: 336px; border-collapse: collapse; color: ${GREEN}; font: 400 11.5px/1 ${MONO}; }
    tr { height: 24px; outline: 0; }
    th { width: 132px; padding: 0; text-align: left; font-weight: 400; white-space: nowrap; }
    td { padding: 0 0 0 8px; color: transparent; font-size: 9.5px; white-space: nowrap; }   /* read out; the canvas writes it beside the bar */
    tr[aria-level="2"] th { padding-left: 14px; } tr[aria-level="3"] th { padding-left: 24px; }
    tr[aria-expanded] th::before { content: '\\25BE '; } tr[aria-expanded="false"] th::before { content: '\\25B8 '; }
    tr[aria-selected="true"] th { background: ${GREEN}; color: #041b0c; }
    tr[hidden] { display: none; }
    output { width: 336px; display: grid; grid-template-columns: 1fr auto; gap: 3px 0; color: ${GREEN}; font: 400 11px/1.15 ${MONO}; }
    output b { font-weight: 700; } output span:nth-child(even) { text-align: right; }`;

  ready() { this.build(); }

  // #region backup-log
  build() {
    const box = this.canvas ?? this.$('.plain');
    // Each <option> is a job: data-level for its depth in the tree, data-start and data-end, data-photos, data-mb.
    this.jobs = options(this).map((o) => ({ ...o, level: +(o.data.level ?? 1), t0: hms(o.data.start), t1: hms(o.data.end) }));
    this.jobs.forEach((j, i) => { j.parent = -1; for (let k = i - 1; k >= 0; k--) if (this.jobs[k].level < j.level) { j.parent = k; break; } j.kids = 0; });
    this.jobs.forEach((j) => { if (j.parent >= 0) this.jobs[j.parent].kids++; });
    this.from = hms(this.getAttribute('from') ?? '02:00'); this.to = hms(this.getAttribute('to') ?? '02:45');
    this.table = node(`<table role="treegrid" aria-label="Nightly backup jobs"><tbody>${this.jobs.map((j, i) => `<tr role="row" aria-level="${j.level}"${j.kids ? ' aria-expanded="true"' : ''} aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}" data-i="${i}"><th role="rowheader">${esc(j.label)}</th><td role="gridcell">${j.data.photos ? `${esc(j.data.photos)} photos` : ''}</td></tr>`).join('')}</tbody></table>`);
    this.rows = [...this.table.querySelectorAll('tr')];
    this.foot = node('<output aria-live="polite"></output>');
    box.replaceChildren(this.table, this.foot);
    this.ys = this.rows.map(() => ({ x: -1, v: 0 }));
    this.table.addEventListener('click', (e) => { const tr = e.target.closest('tr'); if (!tr) return; const i = +tr.dataset.i; if (tr.hasAttribute('aria-expanded') && e.target.closest('th') && this.sel === i) this.toggle(i); this.pick(i); });
    this.table.addEventListener('keydown', (e) => this.key(e));
    this.sel = 0; this.pick(0);
  }
  visible() { return this.rows.filter((r) => !r.hidden); }
  pick(i, focus = false) {
    this.sel = i;
    this.rows.forEach((r, k) => { r.setAttribute('aria-selected', String(k === i)); r.tabIndex = k === i ? 0 : -1; });
    if (focus) this.rows[i].focus({ preventScroll: true });
    // A job with no count of its own counts the photos of the jobs under it.
    const j = this.jobs[i], photos = j.data.photos ?? this.jobs.filter((x, k) => this.under(k, i)).reduce((s, x) => s + +(x.data.photos ?? 0), 0);
    this.foot.innerHTML = `<b>${esc(j.label)}</b><b>${span(j.t1 - j.t0)}</b><span>${fmt(j.t0)} to ${fmt(j.t1)}</span><span>${photos ? `${esc(photos)} photos` : ''}${j.data.mb ? `  ${esc(j.data.mb)} MB` : ''}</span>`;
    this.setValue(j.value);
    this.request();
  }
  under(k, i) { for (let p = this.jobs[k].parent; p >= 0; p = this.jobs[p].parent) if (p === i) return true; return false; }
  toggle(i, open = this.rows[i].getAttribute('aria-expanded') !== 'true') {
    if (!this.rows[i].hasAttribute('aria-expanded')) return;
    this.rows[i].setAttribute('aria-expanded', String(open));
    // A row is shown when every row above it in the tree is open.
    this.jobs.forEach((j, k) => { let show = true; for (let p = j.parent; p >= 0; p = this.jobs[p].parent) if (this.rows[p].getAttribute('aria-expanded') === 'false') show = false; this.rows[k].hidden = !show; });
    this.request();
  }
  // The keys of a treegrid's rows: Up and Down, Home and End, Right opens or goes in, Left closes or goes out.
  key(e) {
    const vis = this.visible(), at = vis.indexOf(this.rows[this.sel]), row = this.rows[this.sel], j = this.jobs[this.sel];
    const go = (r) => r && this.pick(+r.dataset.i, true);
    const moves = {
      ArrowDown: () => go(vis[at + 1]), ArrowUp: () => go(vis[at - 1]), Home: () => go(vis[0]), End: () => go(vis.at(-1)),
      ArrowRight: () => (row.getAttribute('aria-expanded') === 'false' ? this.toggle(this.sel, true) : go(vis[at + 1]?.getAttribute('aria-level') > row.getAttribute('aria-level') ? vis[at + 1] : null)),
      ArrowLeft: () => (row.getAttribute('aria-expanded') === 'true' ? this.toggle(this.sel, false) : go(this.rows[j.parent])),
      Enter: () => this.toggle(this.sel),
    };
    if (!moves[e.key]) return;
    e.preventDefault(); moves[e.key]();
  }

  draw(ctx, w, h) {
    const C = BackupLog.CHART, T = this.table, px = (t) => C.x + (t - this.from) / (this.to - this.from) * C.w;
    let moving = false;
    ctx.fillStyle = '#04140a'; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(180, 170, 40, 180, 180, 260); glow.addColorStop(0, 'rgba(30,90,50,0.35)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    ctx.save(); ctx.shadowColor = 'rgba(93,255,154,0.7)'; ctx.shadowBlur = 5;
    // the time axis, and the moment the fibre went down
    ctx.fillStyle = DIM; ctx.font = `400 10px ${MONO}`; ctx.fillText(this.getAttribute('date') ?? '', 12, 26);
    ctx.textAlign = 'center';
    for (let t = this.from; t <= this.to; t += 900) ctx.fillText(fmt(t).slice(0, 5), px(t), 26);
    ctx.textAlign = 'left';
    const ev = this.getAttribute('event'), evT = ev ? hms(ev.split(' ')[0]) : 0;
    // Each row is drawn as a slice of the table's picture at a y that follows its place on a spring, so
    // the rows under one that closes slide up rather than jump.
    const vis = this.visible(), bottom = C.top + vis.length * C.row;
    for (let t = this.from; t <= this.to; t += 900) { ctx.fillStyle = 'rgba(93,255,154,0.18)'; for (let y = C.top - 6; y < bottom; y += 4) ctx.fillRect(px(t), y, 1, 2); }
    if (ev) { ctx.fillStyle = GREEN; for (let y = 32; y < bottom; y += 5) ctx.fillRect(px(evT), y, 1.2, 3); ctx.fillText(ev.split(' ').slice(1).join(' '), px(evT) + 5, 42); }
    this.rows.forEach((r, i) => {
      const s = this.ys[i];
      if (r.hidden) { s.x = -1; return; }
      const want = C.top + vis.indexOf(r) * C.row;
      if (s.x < 0) s.x = want;
      moving = spring(s, want, this.dt, 260, 26) || moving;
      const y = s.x, j = this.jobs[i];
      ctx.save(); ctx.beginPath(); ctx.rect(0, y, w, C.row); ctx.clip();
      put(ctx, T, 12, y - r.offsetTop, T.offsetWidth, T.offsetHeight);
      ctx.restore();
      // the bar: a bracket for a job with children, a block for one without
      const x0 = px(j.t0), x1 = Math.max(px(j.t1), x0 + 3), cy = y + C.row / 2;
      ctx.fillStyle = GREEN;
      if (j.kids) { ctx.fillRect(x0, cy - 0.6, x1 - x0, 1.2); ctx.fillRect(x0, cy - 5, 1.2, 10); ctx.fillRect(x1 - 1.2, cy - 5, 1.2, 10); }
      else ctx.fillRect(x0, cy - 5, x1 - x0, 10);
      if (j.data.photos) { ctx.fillStyle = DIM; ctx.font = `400 9.5px ${MONO}`; ctx.fillText(`${j.data.photos} photos`, x1 + 4, cy + 3.5); }
      if (this.shadowRoot.activeElement === r) { ctx.strokeStyle = GREEN; ctx.setLineDash([3, 2]); ctx.strokeRect(10.5, y + 1.5, 136, C.row - 3); ctx.setLineDash([]); }
    });
    // The table's hit region goes back to where it is laid out, so a click finds the row under it.
    if (!moving) hit(ctx, T, 12, C.top - (this.rows.find((r) => !r.hidden)?.offsetTop ?? 0));
    ctx.fillStyle = DIM; ctx.fillRect(12, 304, 336, 1);
    put(ctx, this.foot, 12, 312);
    ctx.restore();
    // scan lines and the curve of the glass
    ctx.drawImage(cached(this, 'crt', 360, 360, (g) => { g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 0; y < 360; y += 3) g.fillRect(0, y, 360, 1); const v = g.createRadialGradient(180, 180, 150, 180, 180, 260); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.6)'); g.fillStyle = v; g.fillRect(0, 0, 360, 360); }), 0, 0, w, h);
    return moving;
  }
  // #endregion backup-log
}
customElements.define('backup-log', BackupLog);

// ---------------------------------------------------------------------------------------------------------
// Hob child lock: two switches on a worktop, and the hob's keys in a fieldset that the lock disables
// ---------------------------------------------------------------------------------------------------------

const NAVY = '#1d3a8a';

export class HobLock extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  static HOLD = 3;
  static css = `
    .lock, .again { width: 336px; display: grid; grid-template-columns: 1fr auto; align-items: center; color: ${NAVY}; }
    .lock b { font: 700 34px/1 ${SANS}; letter-spacing: -0.02em; }
    .lock p, .again small { grid-column: 1 / -1; margin: 10px 0 0; font: 400 9.5px/1.5 ${SANS}; color: #2a2a2a; }
    .again b { display: block; font: 600 14px/1.2 ${SANS}; } .again small { display: block; margin: 2px 0 0; }
    input[role=switch] { margin: 0; opacity: 0; cursor: pointer; }
    .lock input { width: 112px; height: 60px; } .again input { width: 52px; height: 30px; }
    fieldset { width: 336px; height: 36px; margin: 0; padding: 0; border: 0; display: flex; align-items: center; gap: 0; }
    fieldset button, fieldset label { width: 34px; height: 36px; padding: 0; border: 0; background: transparent; color: transparent; font-size: 1px; cursor: pointer; }
    fieldset label input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    fieldset .zones { display: flex; margin: 0 46px 0 30px; } fieldset .zones label { width: 38px; }
    button.key { touch-action: none; }`;

  ready() {
    this.knob = { x: 1, v: 0 }; this.knob2 = { x: 1, v: 0 }; this.held = 0;
    this.levels = [0, 0, 0, 0];
    this.build();
  }

  // #region hob-lock
  build() {
    const box = this.canvas ?? this.$('.plain'), on = this.hasAttribute('locked'), again = !this.hasAttribute('no-relock');
    this.lockRow = node(`<label class="lock"><b>Child lock</b><input type="checkbox" role="switch" ${on ? 'checked' : ''} aria-describedby="why"><p id="why"></p></label>`);
    this.againRow = node(`<label class="again"><span><b>Lock again after cooking</b><small>10 minutes after the last zone goes off</small></span><input type="checkbox" role="switch" ${again ? 'checked' : ''}></label>`);
    this.sw = this.lockRow.querySelector('input'); this.sw2 = this.againRow.querySelector('input');
    // The hob's own keys. A disabled fieldset disables all of them at once while the lock is on, except the
    // lock key, which is outside it: hold it for three seconds to unlock.
    this.keys = node(`<div class="keys"><fieldset aria-label="Hob"><button type="button" class="power" aria-label="Power">P</button><span class="zones" role="radiogroup" aria-label="Zone">${[1, 2, 3, 4].map((n) => `<label><input type="radio" name="zone" value="${n}" ${n === 1 ? 'checked' : ''}>Zone ${n}</label>`).join('')}</span><button type="button" class="down" aria-label="Lower">−</button><button type="button" class="up" aria-label="Higher">+</button></fieldset></div>`);
    this.key = node('<button type="button" class="key" aria-label="Lock key: hold for 3 seconds to unlock">Lock key</button>');
    this.fs = this.keys.querySelector('fieldset');
    box.replaceChildren(this.keys, this.key, this.lockRow, this.againRow);
    this.sw.addEventListener('change', () => this.sync());
    this.sw2.addEventListener('change', () => this.sync());
    const zone = () => +this.fs.querySelector('input:checked').value - 1;
    this.fs.querySelector('.up').addEventListener('click', () => { this.levels[zone()] = Math.min(9, this.levels[zone()] + 1); this.sync(); });
    this.fs.querySelector('.down').addEventListener('click', () => { this.levels[zone()] = Math.max(0, this.levels[zone()] - 1); this.sync(); });
    this.fs.querySelector('.power').addEventListener('click', () => { this.levels = [0, 0, 0, 0]; this.sync(); });
    this.fs.addEventListener('change', () => this.request());
    // Holding the lock key: pointer or Space and Enter. It counts while held, and toggles at three seconds.
    const start = (e) => { if (e.type === 'keydown' && (e.repeat || (e.key !== ' ' && e.key !== 'Enter'))) return; e.preventDefault(); try { this.key.setPointerCapture(e.pointerId); } catch {} this.holding = performance.now(); this.request(); };
    const stop = () => { this.holding = 0; this.request(); };
    this.key.addEventListener('pointerdown', start); this.key.addEventListener('keydown', start);
    for (const t of ['pointerup', 'pointercancel', 'keyup', 'blur']) this.key.addEventListener(t, stop);
    this.key.addEventListener('click', (e) => e.preventDefault());
    this.knob.x = this.sw.checked ? 1 : 0; this.knob2.x = this.sw2.checked ? 1 : 0;
    this.sync();
  }
  sync() {
    const on = this.sw.checked;
    this.fs.disabled = on;
    this.lockRow.querySelector('p').textContent = on ? 'Hob controls and oven door are locked. Hold the lock key on the hob for 3 seconds to unlock.' : 'Anyone can switch the hob on.';
    const fd = new FormData(), name = this.getAttribute('name') ?? 'hob';
    if (on) fd.append(name, 'locked');
    if (this.sw2.checked) fd.append(name, 'relock');
    this.levels.forEach((l, i) => { if (l) fd.append(`zone${i + 1}`, l); });
    this.setValue(fd);
    this.request();
  }

  draw(ctx, w, h, now) {
    const on = this.sw.checked;
    let moving = spring(this.knob, on ? 1 : 0, this.dt, 300, 22);
    moving = spring(this.knob2, this.sw2.checked ? 1 : 0, this.dt, 300, 22) || moving;
    // the glass of the hob, with a pot on the first zone and the light from a window across it
    ctx.drawImage(cached(this, 'hob', 360, 150, hobGlass), 0, 0, 360, 150);
    const heat = this.levels[0] / 9;
    if (heat) { const g = ctx.createRadialGradient(80, 40, 40, 80, 40, 110); g.addColorStop(0, `rgba(255,70,20,${0.45 * heat})`); g.addColorStop(1, 'rgba(255,40,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, 360, 150); }
    ctx.drawImage(cached(this, 'pot', 160, 110, pot), 0, -14, 160, 110);
    // the keys: a power symbol, the lock key, four zone digits, minus and plus
    const lit = on ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)', ky = 128;
    put(ctx, this.keys, 12, ky - 18); hit(ctx, this.keys, 12, ky - 18);
    ctx.strokeStyle = lit; ctx.fillStyle = lit; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(29, ky, 6, -1.1, 4.25); ctx.stroke(); ctx.fillRect(28.3, ky - 9, 1.4, 7);
    const sel = +this.fs.querySelector('input:checked').value - 1;
    for (let i = 0; i < 4; i++) {
      const x = 90 + i * 38;
      seg7Text(ctx, String(this.levels[i]), x, ky - 9, 10, 18, on ? 'rgba(255,255,255,0.2)' : this.levels[i] ? '#ff5a2a' : '#fff', '');
      if (!on && i === sel) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(x + 5, ky + 15, 1.6, 0, TAU); ctx.fill(); }
      const zf = this.fs.querySelectorAll('.zones input')[i];
      if (this.shadowRoot.activeElement === zf) { ctx.save(); ctx.strokeStyle = '#8fb3ff'; ctx.setLineDash([2, 2]); ctx.strokeRect(x - 6, ky - 14, 22, 30); ctx.restore(); }
    }
    ctx.strokeStyle = lit; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(286, ky); ctx.lineTo(296, ky); ctx.moveTo(320, ky); ctx.lineTo(330, ky); ctx.moveTo(325, ky - 5); ctx.lineTo(325, ky + 5); ctx.stroke();
    // the lock key, lit blue while locked, with a ring that fills while it is held
    const held = this.holding ? (now - this.holding) / 1000 / HobLock.HOLD : 0;
    if (held >= 1) { this.holding = 0; this.sw.checked = !this.sw.checked; this.sync(); this.dispatchEvent(new Event('change', { bubbles: true })); }
    const kx = 52, kc = on ? '#5b8cff' : 'rgba(255,255,255,0.9)';
    padlock(ctx, kx, ky, 0.85, kc, on ? 0 : 1);
    if (on) { ctx.save(); ctx.shadowColor = '#5b8cff'; ctx.shadowBlur = 8; padlock(ctx, kx, ky, 0.85, kc, 0); ctx.restore(); }
    if (held > 0) { ctx.strokeStyle = '#5b8cff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(kx, ky, 13, -Math.PI / 2, -Math.PI / 2 + TAU * Math.min(1, held)); ctx.stroke(); moving = true; }
    if (this.shadowRoot.activeElement === this.key) { ctx.save(); ctx.strokeStyle = '#8fb3ff'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(kx, ky, 16, 0, TAU); ctx.stroke(); ctx.restore(); }
    hit(ctx, this.key, kx - 17, ky - 17, 34, 34);
    // the worktop, with sunlight through the window across it
    ctx.drawImage(cached(this, 'wood', 360, 210, wood), 0, 150, 360, 210);
    put(ctx, this.lockRow, 12, 178);
    toggle(ctx, 236, 172, 112, 60, this.knob.x, true, this.shadowRoot.activeElement === this.sw);
    hit(ctx, this.sw, 236, 172, 112, 60);
    put(ctx, this.againRow, 12, 304);
    toggle(ctx, 296, 304, 52, 30, this.knob2.x, false, this.shadowRoot.activeElement === this.sw2);
    hit(ctx, this.sw2, 296, 304, 52, 30);
    return moving;
  }
  // #endregion hob-lock
}
customElements.define('hob-lock', HobLock);

function padlock(ctx, x, y, s, colour, open) {
  ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
  ctx.strokeStyle = colour; ctx.fillStyle = colour; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.arc(0, -3 - open * 2, 4.5, Math.PI, open ? Math.PI * 1.85 : TAU); if (!open) ctx.lineTo(4.5, -1); ctx.moveTo(-4.5, -3 - open * 2); ctx.lineTo(-4.5, -1); ctx.stroke();
  rr(ctx, -7, -1, 14, 11, 2); ctx.fill();
  ctx.restore();
}
// A switch: the track, and a white knob with a padlock on the big one.
function toggle(ctx, x, y, w, h, t, lock, focused) {
  const on = t > 0.5, r = h / 2;
  ctx.save();
  ctx.shadowColor = 'rgba(60,30,0,0.35)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  const tr = ctx.createLinearGradient(0, y, 0, y + h);
  tr.addColorStop(0, `rgb(${lerp(196, 23, t)},${lerp(205, 52, t)},${lerp(222, 140, t)})`); tr.addColorStop(1, `rgb(${lerp(214, 36, t)},${lerp(222, 72, t)},${lerp(236, 170, t)})`);
  ctx.fillStyle = tr; rr(ctx, x, y, w, h, r); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.strokeStyle = 'rgba(0,0,0,0.18)'; ctx.lineWidth = 1; ctx.stroke();
  const kx = x + r + (w - h) * t, ky = y + r, kr = r - 4;
  ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 2;
  const kg = ctx.createRadialGradient(kx - kr * 0.3, ky - kr * 0.4, 2, kx, ky, kr); kg.addColorStop(0, '#ffffff'); kg.addColorStop(1, '#dfe3ea');
  ctx.fillStyle = kg; ctx.beginPath(); ctx.arc(kx, ky, kr, 0, TAU); ctx.fill();
  ctx.restore();
  if (lock) { ctx.save(); ctx.strokeStyle = 'rgba(60,70,90,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(kx, ky, kr - 6, 0, TAU); ctx.stroke(); ctx.restore(); padlock(ctx, kx, ky, 1, NAVY, on ? 0 : 1); }
  if (focused) { ctx.save(); ctx.strokeStyle = NAVY; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); rr(ctx, x - 4, y - 4, w + 8, h + 8, r + 4); ctx.stroke(); ctx.restore(); }
}
function hobGlass(g) {
  const b = g.createLinearGradient(0, 0, 0, 150); b.addColorStop(0, '#16181c'); b.addColorStop(1, '#050608'); g.fillStyle = b; g.fillRect(0, 0, 360, 150);
  // the window's light, two soft bands across the glass
  g.save(); g.globalCompositeOperation = 'lighter';
  for (const [x, a] of [[40, 0.07], [96, 0.05]]) { g.fillStyle = `rgba(160,180,210,${a})`; g.beginPath(); g.moveTo(x, 150); g.lineTo(x + 40, 150); g.lineTo(x + 140, 0); g.lineTo(x + 100, 0); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1; g.beginPath(); g.arc(80, 40, 64, 0, TAU); g.stroke();
}
function pot(g) {
  const body = g.createRadialGradient(70, 30, 10, 80, 50, 92); body.addColorStop(0, '#5f86c9'); body.addColorStop(0.55, '#2f5aa5'); body.addColorStop(1, '#16305f');
  g.fillStyle = body; g.beginPath(); g.ellipse(80, 50, 74, 60, 0, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 2; g.beginPath(); g.ellipse(80, 50, 58, 46, 0, 0, TAU); g.stroke();
  g.fillStyle = '#1b2f57'; g.beginPath(); g.ellipse(80, 50, 15, 12, 0, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(58, 24, 18, 6, -0.5, 0, TAU); g.fill();
  g.fillStyle = '#244a8c'; rr(g, 136, 44, 22, 14, 6); g.fill(); rr(g, 2, 44, 22, 14, 6); g.fill();
}
function wood(g) {
  g.fillStyle = '#c99a63'; g.fillRect(0, 0, 360, 210);
  for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(${rnd(i) > 0.5 ? '120,70,30' : '235,190,130'},${0.12 + rnd(i + 1) * 0.15})`; g.lineWidth = 0.6 + rnd(i + 2) * 1.6; const y = rnd(i + 3) * 210; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(120, y + (rnd(i + 4) - 0.5) * 14, 240, y + (rnd(i + 5) - 0.5) * 14, 360, y + (rnd(i + 6) - 0.5) * 10); g.stroke(); }
  // sun through the window: bright diagonal bands with soft edges
  for (const [x, wd] of [[-60, 70], [60, 40], [150, 80]]) { const s = g.createLinearGradient(x, 0, x + wd + 90, 0); s.addColorStop(0, 'rgba(255,240,200,0)'); s.addColorStop(0.5, 'rgba(255,236,190,0.28)'); s.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = s; g.beginPath(); g.moveTo(x, 210); g.lineTo(x + wd, 210); g.lineTo(x + wd + 90, 0); g.lineTo(x + 90, 0); g.fill(); }
  const top = g.createLinearGradient(0, 0, 0, 10); top.addColorStop(0, 'rgba(0,0,0,0.35)'); top.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = top; g.fillRect(0, 0, 360, 10);
}

// ---------------------------------------------------------------------------------------------------------
// Cutting mat: a crop box over a picture. Four range inputs hold the box; a drag moves an edge, a corner or all of it
// ---------------------------------------------------------------------------------------------------------

export class CuttingMat extends FeedControl {
  static size = [360, 360];
  static radius = 4;
  // The picture, in design units, and how many design units make an inch of it.
  static PIC = { x: 34, y: 34, w: 292, h: 292, inch: 40 };
  static css = `
    .crop { width: 292px; height: 292px; touch-action: none; cursor: move; }
    .keys { width: 292px; display: flex; flex-wrap: wrap; }
    .keys label { display: block; width: 50%; font: 10px/1.4 ${SANS}; color: #fff; }
    .keys input { width: 100%; margin: 0; }
    output { width: max-content; padding: 3px 6px; background: #f6d33c; color: #111; font: 700 10.5px/1 ${MONO}; }`;

  ready() { this.build(); }

  // #region cutting-mat
  build() {
    const box = this.canvas ?? this.$('.plain'), P = CuttingMat.PIC;
    const [x, y, w, h] = (this.getAttribute('value') ?? '40 60 140 130').split(/[\s,]+/).map(Number);
    // Four ranges hold the box, in design units of the picture: the keys work on them, and they are what
    // the form sends. Their limits move with each other, so the box never leaves the picture.
    const r = (k, label, v) => `<label>${label}<input type="range" data-k="${k}" min="0" max="${P.w}" step="1" value="${v}"></label>`;
    this.keyset = node(`<div class="keys" role="group" aria-label="Crop">${r('x', 'Left', x)}${r('y', 'Top', y)}${r('w', 'Width', w)}${r('h', 'Height', h)}</div>`);
    this.range = Object.fromEntries([...this.keyset.querySelectorAll('input')].map((i) => [i.dataset.k, i]));
    this.grab = node('<div class="crop" aria-hidden="true"></div>');
    this.size = node('<output aria-live="polite"></output>');
    box.replaceChildren(this.keyset, this.grab, this.size);
    this.keyset.addEventListener('input', () => this.sync());
    // One element takes every drag over the picture. Where it starts says what it moves.
    let drag = null;
    this.grab.addEventListener('pointerdown', (e) => {
      const p = local(this, e, 360), b = this.box(), near = (a, v) => Math.abs(a - v) < 14;
      const ex = { l: near(p.x, P.x + b.x), r: near(p.x, P.x + b.x + b.w), t: near(p.y, P.y + b.y), b: near(p.y, P.y + b.y + b.h) };
      const inside = p.x > P.x + b.x && p.x < P.x + b.x + b.w && p.y > P.y + b.y && p.y < P.y + b.y + b.h;
      if (!ex.l && !ex.r && !ex.t && !ex.b && !inside) return;
      e.preventDefault(); try { this.grab.setPointerCapture(e.pointerId); } catch {}
      drag = { p, b, ex, move: !ex.l && !ex.r && !ex.t && !ex.b }; this.dragging = true; this.request();
    });
    this.grab.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const p = local(this, e, 360), dx = p.x - drag.p.x, dy = p.y - drag.p.y, b = { ...drag.b }, min = 24;
      if (drag.move) { b.x = clamp(b.x + dx, 0, P.w - b.w); b.y = clamp(b.y + dy, 0, P.h - b.h); }
      if (drag.ex.l) { const nx = clamp(b.x + dx, 0, b.x + b.w - min); b.w += b.x - nx; b.x = nx; }
      if (drag.ex.r) b.w = clamp(b.w + dx, min, P.w - b.x);
      if (drag.ex.t) { const ny = clamp(b.y + dy, 0, b.y + b.h - min); b.h += b.y - ny; b.y = ny; }
      if (drag.ex.b) b.h = clamp(b.h + dy, min, P.h - b.y);
      this.set(b);
    });
    const end = () => { if (!drag) return; drag = null; this.dragging = false; this.dispatchEvent(new Event('change', { bubbles: true })); this.request(); };
    this.grab.addEventListener('pointerup', end); this.grab.addEventListener('pointercancel', end);
    this.sync();
  }
  box() { const R = this.range; return { x: +R.x.value, y: +R.y.value, w: +R.w.value, h: +R.h.value }; }
  set(b) { const R = this.range; R.x.value = Math.round(b.x); R.y.value = Math.round(b.y); R.w.value = Math.round(b.w); R.h.value = Math.round(b.h); this.sync(); }
  sync() {
    const P = CuttingMat.PIC, R = this.range, b = this.box();
    // Each range's limit follows the others, so the keys can't push the box off the picture.
    R.x.max = P.w - b.w; R.y.max = P.h - b.h; R.w.min = R.h.min = 24; R.w.max = P.w - b.x; R.h.max = P.h - b.y;
    const inch = (v) => (v / P.inch).toFixed(1);
    this.size.textContent = `${inch(b.w)} × ${inch(b.h)} in`;
    for (const [k, i] of Object.entries(R)) i.setAttribute('aria-valuetext', `${inch(+i.value)} in`);
    this.setValue(`${inch(b.x)},${inch(b.y)},${inch(b.w)},${inch(b.h)}`);
    this.request();
  }

  draw(ctx, w, h) {
    const P = CuttingMat.PIC, b = this.box(), X = P.x + b.x, Y = P.y + b.y;
    ctx.drawImage(cached(this, 'mat', 360, 360, mat), 0, 0, w, h);
    ctx.drawImage(cached(this, 'still', P.w, P.h, stillLife), P.x, P.y, P.w, P.h);
    put(ctx, this.keyset, -1000, 0);
    // outside the box, the picture is dimmed; inside, thirds while it is being dragged
    ctx.save(); ctx.fillStyle = 'rgba(8,30,24,0.55)'; ctx.beginPath(); ctx.rect(P.x, P.y, P.w, P.h); ctx.rect(X, Y, b.w, b.h); ctx.fill('evenodd'); ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.strokeRect(X, Y, b.w, b.h);
    if (this.dragging) { ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 0.8; ctx.beginPath(); for (const k of [1, 2]) { ctx.moveTo(X + b.w * k / 3, Y); ctx.lineTo(X + b.w * k / 3, Y + b.h); ctx.moveTo(X, Y + b.h * k / 3); ctx.lineTo(X + b.w, Y + b.h * k / 3); } ctx.stroke(); }
    // the handles: L-shaped corners and short bars on the edges; the one whose range has focus is yellow
    const f = this.shadowRoot.activeElement?.dataset?.k, L = 12;
    const ink = (k) => (f === k ? '#f6d33c' : '#fff');
    ctx.lineWidth = 3.5; ctx.lineCap = 'square';
    const corner = (cx, cy, sx, sy, c) => { ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(cx + sx * L, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + sy * L); ctx.stroke(); };
    corner(X, Y, 1, 1, f === 'x' || f === 'y' ? '#f6d33c' : '#fff'); corner(X + b.w, Y, -1, 1, ink('w')); corner(X, Y + b.h, 1, -1, ink('h')); corner(X + b.w, Y + b.h, -1, -1, f === 'w' || f === 'h' ? '#f6d33c' : '#fff');
    ctx.strokeStyle = ink('y'); ctx.beginPath(); ctx.moveTo(X + b.w / 2 - 8, Y); ctx.lineTo(X + b.w / 2 + 8, Y); ctx.stroke();
    ctx.strokeStyle = ink('h'); ctx.beginPath(); ctx.moveTo(X + b.w / 2 - 8, Y + b.h); ctx.lineTo(X + b.w / 2 + 8, Y + b.h); ctx.stroke();
    ctx.strokeStyle = ink('x'); ctx.beginPath(); ctx.moveTo(X, Y + b.h / 2 - 8); ctx.lineTo(X, Y + b.h / 2 + 8); ctx.stroke();
    ctx.strokeStyle = ink('w'); ctx.beginPath(); ctx.moveTo(X + b.w, Y + b.h / 2 - 8); ctx.lineTo(X + b.w, Y + b.h / 2 + 8); ctx.stroke();
    // the size, on a yellow tag above the box (below it when the box is at the top)
    const sw = this.size.offsetWidth, sh = this.size.offsetHeight, ty = Y - sh - 6 < P.y - 20 ? Y + b.h + 6 : Y - sh - 6;
    put(ctx, this.size, clamp(X, 4, w - sw - 4), ty);
    hit(ctx, this.grab, P.x, P.y, P.w, P.h);
    return false;
  }
  // #endregion cutting-mat
}
customElements.define('cutting-mat', CuttingMat);

function mat(g) {
  g.fillStyle = '#0f5a48'; g.fillRect(0, 0, 360, 360);
  g.strokeStyle = 'rgba(160,230,200,0.22)'; g.lineWidth = 0.6;
  for (let i = 0; i <= 360; i += 10) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 360); g.moveTo(0, i); g.lineTo(360, i); g.stroke(); }
  g.strokeStyle = 'rgba(190,240,215,0.4)'; g.lineWidth = 0.9;
  for (let i = 0; i <= 360; i += 40) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 360); g.moveTo(0, i); g.lineTo(360, i); g.stroke(); }
}
// The picture to crop, painted: a gingham cloth, a plate with orange halves, a cup of coffee, a lemon and a leaf.
function stillLife(g, w, h) {
  g.fillStyle = '#eef1f6'; g.fillRect(0, 0, w, h);
  const sq = w / 14;
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(48,78,150,0.55)'; g.fillRect(i * sq, 0, sq / 2, h); g.fillRect(0, i * sq, w, sq / 2); }
  for (let i = 0; i < 14; i++) for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(30,55,120,0.45)'; g.fillRect(i * sq, k * sq, sq / 2, sq / 2); }
  const shadow = (fn) => { g.save(); g.shadowColor = 'rgba(0,0,30,0.4)'; g.shadowBlur = 10; g.shadowOffsetY = 4; fn(); g.restore(); };
  shadow(() => { g.fillStyle = '#6f7d86'; g.beginPath(); g.arc(w * 0.38, h * 0.48, w * 0.32, 0, TAU); g.fill(); });
  g.fillStyle = '#f4efe3'; g.beginPath(); g.arc(w * 0.38, h * 0.48, w * 0.27, 0, TAU); g.fill();
  shadow(() => { g.fillStyle = '#f08a1c'; g.beginPath(); g.arc(w * 0.27, h * 0.38, w * 0.105, 0, TAU); g.fill(); });
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(w * 0.25, h * 0.35, w * 0.04, 0, TAU); g.fill();
  g.fillStyle = '#2e6b2e'; g.beginPath(); g.arc(w * 0.3, h * 0.39, 2, 0, TAU); g.fill();
  shadow(() => { g.fillStyle = '#f39c1e'; g.beginPath(); g.arc(w * 0.47, h * 0.56, w * 0.1, 0, TAU); g.fill(); });
  g.fillStyle = '#ffd16e'; g.beginPath(); g.arc(w * 0.47, h * 0.56, w * 0.082, 0, TAU); g.fill();
  g.strokeStyle = '#f39c1e'; g.lineWidth = 1.5; for (let i = 0; i < 8; i++) { const a = i * TAU / 8; g.beginPath(); g.moveTo(w * 0.47, h * 0.56); g.lineTo(w * 0.47 + Math.cos(a) * w * 0.08, h * 0.56 + Math.sin(a) * w * 0.08); g.stroke(); }
  shadow(() => { g.fillStyle = '#7f8a91'; g.beginPath(); g.arc(w * 0.8, h * 0.2, w * 0.13, 0, TAU); g.fill(); });
  g.fillStyle = '#e9e4da'; g.beginPath(); g.arc(w * 0.8, h * 0.2, w * 0.1, 0, TAU); g.fill();
  g.fillStyle = '#2a1a12'; g.beginPath(); g.arc(w * 0.8, h * 0.2, w * 0.072, 0, TAU); g.fill();
  shadow(() => { g.fillStyle = '#b8b23a'; g.beginPath(); g.ellipse(w * 0.75, h * 0.82, w * 0.12, w * 0.075, -0.3, 0, TAU); g.fill(); });
  shadow(() => { g.fillStyle = '#245a32'; g.beginPath(); g.ellipse(w * 0.14, h * 0.86, w * 0.1, w * 0.035, -0.5, 0, TAU); g.fill(); });
}
