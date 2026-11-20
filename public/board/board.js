// An infinite, zoomable board whose tiles are live DOM: notes and same-origin iframes.
// Everything is drawn with one 2D context: ctx.setTransform(zoom) + drawElementImage(tile).
import { banner, nav, runTests, supported } from '/shared/support.js';
import { isFixture, mirror, publish, sample2D, watchContext } from '/lib/check-fixture.js';

const embed = new URLSearchParams(location.search).has('embed');
const depth = Number(new URLSearchParams(location.search).get('depth') || 0);
if (embed) document.body.classList.add('embed');
else {
  nav('/board/');
  banner();
}

const $ = (id) => document.getElementById(id);
const canvas = $('board'), stage = $('stage'), hud = $('hud');
const ctx = supported ? canvas.getContext('2d') : null;
const KEY = embed ? `board-v1-embed${depth}` : 'board-v1';
const OFFSTAGE = new DOMMatrix().translate(-100000, -100000);
const LOD_PX = 70; // below this on-screen width a tile is drawn as a placeholder
const PAPERS = ['#fff3a8', '#ffd0c2', '#c9ecff', '#d6f5c6', '#ead7ff'];

// ------------------------------------------------------------------ model
const DEFAULT_TILES = [
  { type: 'note', x: -560, y: -330, w: 300, h: 210, color: 0, text: 'Every tile on this board is real DOM.\n\nType here. Select this. Zoom to 800% and the letters stay sharp.' },
  { type: 'frame', x: -220, y: -360, w: 360, h: 330, title: 'To-do list', src: '/board/tiles/todo.html' },
  { type: 'frame', x: 180, y: -360, w: 380, h: 250, title: 'Spreadsheet', src: '/board/tiles/sheet.html' },
  { type: 'frame', x: 180, y: -80, w: 380, h: 300, title: 'Sketch pad', src: '/board/tiles/draw.html' },
  { type: 'frame', x: -560, y: -90, w: 300, h: 250, title: 'Clock', src: '/board/tiles/clock.html' },
  { type: 'frame', x: -220, y: 10, w: 360, h: 300, title: 'Markdown editor', src: '/board/tiles/editor.html' },
  { type: 'note', x: 600, y: -360, w: 260, h: 170, color: 2, text: 'Far to the right there is a whole page of this site running as a tile. Press Tab until you get there: the board follows focus.' },
  { type: 'note', x: -560, y: 200, w: 300, h: 150, color: 3, text: 'Double-click empty space for a new note. Drag title bars. Resize from the corner.' },
  { type: 'frame', x: 1500, y: -300, w: 820, h: 620, title: 'Demo: slots (another HTML-in-canvas page)', src: '/slot/' },
];

let tiles = [];
let cam = { x: -640, y: -420, k: 1 }; // world point at the canvas's top-left, and zoom
let size = { w: 0, h: 0, dpr: 1 };
let nextId = 1, topZ = 1, active = null;
const stats = { paints: 0, drawn: 0, placeholders: 0, culled: 0, ms: 0 };

function load() {
  if (isFixture) return null; // the hidden copy that runs the checks never touches the saved board
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved?.tiles?.length) return saved;
  } catch { /* fall through */ }
  return null;
}
let saveTimer = 0;
function save() {
  if (isFixture) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = { cam, tiles: tiles.filter((t) => !t.temp).map(({ el, parked, ...t }) => ({ ...t, text: t.type === 'note' ? el.querySelector('.text').innerText : undefined })) };
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* private mode */ }
  }, 300);
}

// ------------------------------------------------------------------ tiles
// #region tile
function makeTile(t) {
  t.id ??= nextId++;
  nextId = Math.max(nextId, t.id + 1);
  t.z ??= topZ++;
  topZ = Math.max(topZ, t.z + 1);
  const el = document.createElement('article');
  el.className = `tile ${t.type}`;
  el.setAttribute('drawable', '');
  el.dataset.id = t.id;
  const title = t.title ?? (t.type === 'note' ? 'Note' : t.src);
  el.setAttribute('aria-label', title);
  el.innerHTML = `<header class="bar"><span class="title"></span><span class="kind"></span><button class="close" aria-label="Remove tile" title="Remove">×</button></header><div class="body"></div><i class="grip" aria-hidden="true"></i>`;
  el.querySelector('.title').textContent = title;
  el.querySelector('.kind').textContent = t.type === 'note' ? '' : 'page';
  const body = el.querySelector('.body');
  if (t.type === 'note') {
    el.style.setProperty('--paper', PAPERS[(t.color ?? 0) % PAPERS.length]);
    const text = document.createElement('div');
    text.className = 'text';
    text.contentEditable = 'true';
    text.spellcheck = false;
    text.setAttribute('aria-label', 'Note text');
    text.textContent = t.text ?? '';
    text.addEventListener('input', save);
    body.append(text);
  } else {
    const frame = document.createElement('iframe');
    frame.title = title;
    frame.loading = 'eager';
    let src = t.src.startsWith('/board/?embed') ? `${t.src}&depth=${depth + 1}` : t.src;
    // A demo page shown as a tile does not run its own live checks: they are that page's
    // business, they cost seconds of main thread here, and /slot/'s crashed the tab when run
    // inside a canvas-drawn iframe (Chromium 157).
    if (!src.startsWith('/board/')) src += (src.includes('?') ? '&' : '?') + 'autochecks=0';
    if (src.startsWith('/board/?embed') && depth >= 2) frame.srcdoc = '<body style="font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">Three boards deep is deep enough.</body>';
    else frame.src = src;
    frame.tabIndex = -1; // reached through the cover until the tile is active
    frame.addEventListener('load', () => {
      // Same-origin: let Escape inside the page hand control back to the board.
      try {
        frame.contentWindow.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') { activate(null); el.querySelector('.cover').focus({ preventScroll: true }); }
        });
      } catch { /* cross-origin frame */ }
      requestPaint();
    });
    const cover = document.createElement('button');
    cover.className = 'cover';
    cover.type = 'button';
    cover.setAttribute('aria-label', `Use ${title}`);
    cover.innerHTML = '<span>click to use</span>';
    cover.addEventListener('click', () => { activate(t); frame.focus({ preventScroll: true }); });
    body.append(frame, cover);
  }
  t.el = el;
  layoutTile(t);
  wireTile(t);
  (supported ? canvas : $('plain')).append(el);
  tiles.push(t);
  return t;
}
// #endregion tile

function layoutTile(t) {
  t.el.style.width = `${t.w}px`;
  t.el.style.height = `${t.h}px`;
}

function raise(t) {
  t.z = topZ++; // paint() draws in z order, and where tiles overlap the browser hits the one drawn last
}

function activate(t) {
  if (active === t) return;
  if (active) {
    active.el.classList.remove('active');
    const f = active.el.querySelector('iframe');
    if (f) f.tabIndex = -1;
  }
  active = t;
  if (t) {
    t.el.classList.add('active');
    const f = t.el.querySelector('iframe');
    if (f) f.tabIndex = 0;
    raise(t);
  }
  requestPaint();
}

function removeTile(t) {
  if (active === t) active = null;
  t.el.remove();
  tiles = tiles.filter((o) => o !== t);
  save();
  requestPaint();
}

function wireTile(t) {
  const el = t.el, bar = el.querySelector('.bar'), grip = el.querySelector('.grip');
  el.addEventListener('pointerdown', () => {
    raise(t);
    if (active && active !== t) activate(null);
    requestPaint();
  }, true);
  el.querySelector('.close').addEventListener('click', () => removeTile(t));
  const dragger = (handle, apply) => {
    let last = null;
    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      last = { x: e.clientX, y: e.clientY };
      handle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!last) return;
      apply((e.clientX - last.x) / cam.k, (e.clientY - last.y) / cam.k);
      last = { x: e.clientX, y: e.clientY };
      requestPaint();
    });
    const end = () => { if (last) { last = null; save(); } };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  };
  dragger(bar, (dx, dy) => { t.x += dx; t.y += dy; });
  dragger(grip, (dx, dy) => {
    t.w = Math.max(160, t.w + dx);
    t.h = Math.max(110, t.h + dy);
    layoutTile(t);
  });
}

// ------------------------------------------------------------------ camera
const toWorld = (cx, cy) => ({ x: cam.x + cx / cam.k, y: cam.y + cy / cam.k });
function zoomAt(cx, cy, factor) {
  const before = toWorld(cx, cy);
  cam.k = Math.min(8, Math.max(0.04, cam.k * factor));
  cam.x = before.x - cx / cam.k;
  cam.y = before.y - cy / cam.k;
  changed();
}
function changed() {
  $('zoom-label').textContent = `${Math.round(cam.k * 100)}%`;
  save();
  requestPaint();
}
let glide = null;
function flyTo(target, ms = 350) {
  if (ms === 0) { cam = { ...target }; glide = null; return changed(); }
  glide = { from: { ...cam }, to: target, t0: performance.now(), ms };
  requestAnimationFrame(stepGlide);
}
function stepGlide(now) {
  if (!glide) return;
  const k = Math.min(1, (now - glide.t0) / glide.ms), s = k * k * (3 - 2 * k);
  // Interpolate the centre and the log of the zoom so the motion looks even.
  const zk = Math.exp(Math.log(glide.from.k) + (Math.log(glide.to.k) - Math.log(glide.from.k)) * s);
  const c0 = { x: glide.from.x + size.w / 2 / glide.from.k, y: glide.from.y + size.h / 2 / glide.from.k };
  const c1 = { x: glide.to.x + size.w / 2 / glide.to.k, y: glide.to.y + size.h / 2 / glide.to.k };
  cam = { k: zk, x: c0.x + (c1.x - c0.x) * s - size.w / 2 / zk, y: c0.y + (c1.y - c0.y) * s - size.h / 2 / zk };
  changed();
  if (k < 1) requestAnimationFrame(stepGlide);
  else glide = null;
}
function frameRect(x, y, w, h, { pad = 40, maxK = 1.5 } = {}) {
  const k = Math.min(maxK, (size.w - pad * 2) / w, (size.h - pad * 2) / h);
  return { k, x: x + w / 2 - size.w / 2 / k, y: y + h / 2 - size.h / 2 / k };
}
function bounds(list = tiles) {
  if (!list.length) return { x: -400, y: -300, w: 800, h: 600 };
  const x0 = Math.min(...list.map((t) => t.x)), y0 = Math.min(...list.map((t) => t.y));
  const x1 = Math.max(...list.map((t) => t.x + t.w)), y1 = Math.max(...list.map((t) => t.y + t.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
const fitAll = (ms) => { const b = bounds(); flyTo(frameRect(b.x, b.y, b.w, b.h, { maxK: 1 }), ms); };
function reveal(t, ms = 300) {
  // Already comfortably on screen and readable? Leave the camera alone.
  const sx = (t.x - cam.x) * cam.k, sy = (t.y - cam.y) * cam.k, sw = t.w * cam.k, sh = t.h * cam.k;
  const visible = sx >= 0 && sy >= 0 && sx + sw <= size.w && sy + sh <= size.h;
  if (visible && sw >= LOD_PX * 2) return;
  const fits = t.w * cam.k <= size.w - 40 && t.h * cam.k <= size.h - 40 && sw >= LOD_PX * 2;
  flyTo(fits ? { k: cam.k, x: t.x + t.w / 2 - size.w / 2 / cam.k, y: t.y + t.h / 2 - size.h / 2 / cam.k } : frameRect(t.x, t.y, t.w, t.h, { maxK: 1 }), ms);
}

// ------------------------------------------------------------------ paint
function requestPaint() {
  canvas.requestPaint?.();
}
// #region paint
function park(t) {
  if (t.parked) return;
  t.parked = true;
  canvas.updateElementGeometry(t.el, { canvasTransform: OFFSTAGE });
}
// #endregion paint
// #region paint
function paint() {
  const t0 = performance.now();
  const { w, h, dpr } = size;
  ctx.reset();
  ctx.scale(dpr, dpr);
  const dark = false;
  ctx.fillStyle = dark ? '#191817' : '#e9e5db';
  ctx.fillRect(0, 0, w, h);
  // Dot grid that thins out as you zoom away.
  let step = 40;
  while (step * cam.k < 18) step *= 4;
  ctx.fillStyle = '#c4bdac';
  const r = Math.max(1, Math.min(2.2, cam.k * 1.4));
  for (let wx = Math.floor(cam.x / step) * step; (wx - cam.x) * cam.k < w; wx += step) {
    for (let wy = Math.floor(cam.y / step) * step; (wy - cam.y) * cam.k < h; wy += step) {
      ctx.fillRect((wx - cam.x) * cam.k - r / 2, (wy - cam.y) * cam.k - r / 2, r, r);
    }
  }
  stats.drawn = stats.placeholders = stats.culled = 0;
  for (const t of [...tiles].sort((a, b) => a.z - b.z)) {
    const sx = (t.x - cam.x) * cam.k, sy = (t.y - cam.y) * cam.k, sw = t.w * cam.k, sh = t.h * cam.k;
    if (sx > w || sy > h || sx + sw < 0 || sy + sh < 0) {
      park(t); // a culled tile would otherwise keep the hit region of its last draw
      stats.culled++;
      continue;
    }
    if (sw < LOD_PX) {
      park(t);
      stats.placeholders++;
      ctx.fillStyle = t.type === 'note' ? PAPERS[(t.color ?? 0) % PAPERS.length] : '#ffffff';
      ctx.strokeStyle = '#a9a18f';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(sx, sy, sw, sh, Math.min(4, sw / 6));
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#d2491f';
      ctx.fillRect(sx, sy, sw, Math.max(2, sh * 0.12));
      continue;
    }
    // Shadow under the tile, then the tile itself: real DOM under the camera transform.
    ctx.save();
    ctx.shadowColor = '#0000002e';
    ctx.shadowBlur = 18 * Math.min(1, cam.k);
    ctx.shadowOffsetY = 5 * Math.min(1, cam.k) * dpr;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(sx + 2, sy + 2, sw - 4, sh - 4, 10 * cam.k);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(cam.k, cam.k);
    try {
      ctx.drawElementImage(t.el, 0, 0, t.w, t.h);
      t.parked = false;
      stats.drawn++;
    } catch (err) {
      stats.error = err.message; // no paint record yet for a brand-new tile
    }
    ctx.restore();
  }
  drawMinimap(w, h);
  stats.paints++;
  stats.ms = stats.ms * 0.9 + (performance.now() - t0) * 0.1;
  hud.textContent = `${Math.round(cam.k * 100)}%  ${tiles.length} tiles: ${stats.drawn} live, ${stats.placeholders} placeholders, ${stats.culled} culled  ${stats.ms.toFixed(1)} ms/paint`;
}
// #endregion paint

// Minimap, bottom right. Click or drag it to move the camera.
const MAP = { w: 150, h: 100, pad: 10 };
function mapGeometry(w, h) {
  const b = bounds();
  const view = { x: cam.x, y: cam.y, w: w / cam.k, h: h / cam.k };
  const x0 = Math.min(b.x, view.x), y0 = Math.min(b.y, view.y);
  const x1 = Math.max(b.x + b.w, view.x + view.w), y1 = Math.max(b.y + b.h, view.y + view.h);
  const s = Math.min((MAP.w - 12) / (x1 - x0), (MAP.h - 12) / (y1 - y0));
  const ox = w - MAP.w - MAP.pad + (MAP.w - (x1 - x0) * s) / 2, oy = h - MAP.h - MAP.pad + (MAP.h - (y1 - y0) * s) / 2;
  return { view, s, ox, oy, x0, y0, left: w - MAP.w - MAP.pad, top: h - MAP.h - MAP.pad };
}
function drawMinimap(w, h) {
  if (w < 420 || embed) return;
  const g = mapGeometry(w, h);
  ctx.fillStyle = '#fffdf7e8';
  ctx.strokeStyle = '#b9b1a0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(g.left, g.top, MAP.w, MAP.h, 8);
  ctx.fill();
  ctx.stroke();
  for (const t of tiles) {
    ctx.fillStyle = t === active ? '#d2491f' : t.type === 'note' ? '#d9c95a' : '#8f8a7e';
    ctx.fillRect(g.ox + (t.x - g.x0) * g.s, g.oy + (t.y - g.y0) * g.s, Math.max(1.5, t.w * g.s), Math.max(1.5, t.h * g.s));
  }
  ctx.strokeStyle = '#d2491f';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(g.ox + (g.view.x - g.x0) * g.s, g.oy + (g.view.y - g.y0) * g.s, g.view.w * g.s, g.view.h * g.s);
}
function minimapHit(cx, cy) {
  if (size.w < 420 || embed) return null;
  const g = mapGeometry(size.w, size.h);
  if (cx < g.left || cy < g.top || cx > g.left + MAP.w || cy > g.top + MAP.h) return null;
  return { x: g.x0 + (cx - g.ox) / g.s, y: g.y0 + (cy - g.oy) / g.s };
}

// ------------------------------------------------------------------ input on the background
// Client coordinates are scaled by CSS zoom; the camera works in the canvas's layout pixels.
const local = (e) => { const r = canvas.getBoundingClientRect(), z = (canvas.clientWidth || r.width) / (r.width || 1); return { x: (e.clientX - r.left) * z, y: (e.clientY - r.top) * z }; };
// One finger or the mouse pans when it starts on the background or on a sleeping page tile.
// Two fingers pan and pinch wherever they land, so a tile that fills a phone screen is not a trap.
const pointers = new Map();
let lastPointer = 0;
window.addEventListener('pointerdown', () => (lastPointer = performance.now()), true);
window.addEventListener('pointerup', () => (lastPointer = performance.now()), true);
let pinch = null, mapDrag = false, panId = null, travelled = 0;
const isBackground = (target) => target === canvas || !!target.closest?.('.cover');
canvas.addEventListener('pointerdown', (e) => {
  const p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) };
    panId = null;
    getSelection()?.removeAllRanges();
    return;
  }
  if (!isBackground(e.target)) return; // a live tile gets its own single-pointer input
  travelled = 0;
  glide = null;
  if (e.target === canvas) {
    activate(null);
    const onMap = minimapHit(p.x, p.y);
    if (onMap) {
      mapDrag = true;
      cam.x = onMap.x - size.w / 2 / cam.k;
      cam.y = onMap.y - size.h / 2 / cam.k;
      changed();
    }
    canvas.setPointerCapture(e.pointerId);
  }
  panId = e.pointerId;
  canvas.classList.add('panning');
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  const prev = pointers.get(e.pointerId), p = local(e);
  pointers.set(e.pointerId, p);
  if (pointers.size >= 2 && pinch) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    // Each finger reports its own half of the pan; zoom about the midpoint.
    cam.x -= (p.x - prev.x) / 2 / cam.k;
    cam.y -= (p.y - prev.y) / 2 / cam.k;
    if (pinch.d > 0 && d > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch.d);
    else changed();
    pinch.d = d;
    travelled += 10;
    e.preventDefault();
    return;
  }
  if (e.pointerId !== panId) return;
  if (mapDrag) {
    const onMap = minimapHit(p.x, p.y);
    if (onMap) { cam.x = onMap.x - size.w / 2 / cam.k; cam.y = onMap.y - size.h / 2 / cam.k; changed(); }
    return;
  }
  travelled += Math.abs(p.x - prev.x) + Math.abs(p.y - prev.y);
  cam.x -= (p.x - prev.x) / cam.k;
  cam.y -= (p.y - prev.y) / cam.k;
  changed();
});
const release = (e) => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinch = null;
  if (e.pointerId === panId) panId = null;
  if (!pointers.size) { canvas.classList.remove('panning'); mapDrag = false; }
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
// The pointer can be lifted over a page tile that is awake, where the board never hears about it.
window.addEventListener('pointerup', release);
window.addEventListener('blur', () => { pointers.clear(); pinch = null; panId = null; });
// A drag or pinch that started on a sleeping page tile must not also wake it.
canvas.addEventListener('click', (e) => {
  if (travelled > 8 && e.target.closest?.('.cover')) { e.stopPropagation(); e.preventDefault(); }
  travelled = 0;
}, true);
canvas.addEventListener('wheel', (e) => {
  // Wheel over a note or the background moves the board. A page tile that is awake never
  // sends its wheel events here: the iframe keeps them.
  e.preventDefault();
  const p = local(e);
  if (e.ctrlKey || e.metaKey) zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.01));
  else {
    const unit = e.deltaMode === 1 ? 32 : 1;
    cam.x += (e.deltaX * unit) / cam.k;
    cam.y += (e.deltaY * unit) / cam.k;
    changed();
  }
}, { passive: false });
canvas.addEventListener('dblclick', (e) => {
  if (e.target !== canvas) return;
  const p = local(e);
  if (minimapHit(p.x, p.y)) return;
  const wpt = toWorld(p.x, p.y);
  const t = makeTile({ type: 'note', x: wpt.x - 120, y: wpt.y - 20, w: 240, h: 160, color: tiles.length, text: '' });
  save();
  requestPaint();
  t.el.querySelector('.text').focus({ preventScroll: true });
});
canvas.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && active) return activate(null);
  if (e.target !== canvas) return;
  const step = 80 / cam.k;
  const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (moves[e.key]) { cam.x += moves[e.key][0]; cam.y += moves[e.key][1]; changed(); }
  else if (e.key === '+' || e.key === '=') zoomAt(size.w / 2, size.h / 2, 1.25);
  else if (e.key === '-') zoomAt(size.w / 2, size.h / 2, 0.8);
  else if (e.key === '0') fitAll();
  else return;
  e.preventDefault();
});
// Keyboard users: whatever takes focus, bring its tile into view.
canvas.addEventListener('focusin', (e) => {
  const el = e.target.closest?.('.tile');
  const t = el && tiles.find((o) => o.el === el);
  if (t && !pointers.size && !e.target.matches(':hover') && performance.now() - lastPointer > 500) reveal(t);
});

// ------------------------------------------------------------------ toolbar
$('zoom-in').onclick = () => zoomAt(size.w / 2, size.h / 2, 1.25);
$('zoom-out').onclick = () => zoomAt(size.w / 2, size.h / 2, 0.8);
$('zoom-reset').onclick = () => zoomAt(size.w / 2, size.h / 2, 1 / cam.k);
$('fit').onclick = () => fitAll();
const centre = () => toWorld(size.w / 2, size.h / 2);
$('add-note').onclick = () => {
  const c = centre();
  const t = makeTile({ type: 'note', x: c.x - 130 + (tiles.length % 5) * 14, y: c.y - 90 + (tiles.length % 5) * 14, w: 260, h: 180, color: tiles.length, text: '' });
  save();
  requestPaint();
  t.el.querySelector('.text').focus({ preventScroll: true });
};
$('add-page').onchange = (e) => {
  const src = e.target.value;
  if (!src) return;
  const big = !src.startsWith('/board/tiles/');
  const c = centre(), w = big ? 820 : 360, h = big ? 620 : 300;
  makeTile({ type: 'frame', x: c.x - w / 2, y: c.y - h / 2, w, h, title: e.target.selectedOptions[0].textContent, src });
  e.target.value = '';
  save();
  requestPaint();
};
$('stress').onclick = () => {
  const b = bounds(), n = tiles.length;
  for (let i = 0; i < 50; i++) {
    makeTile({ type: 'note', x: b.x + (i % 10) * 290, y: b.y + b.h + 80 + Math.floor(i / 10) * 200, w: 260, h: 170, color: i, text: `Note ${n + i + 1}\n\nStill a real, editable element.` });
  }
  save();
  fitAll();
};
$('reset').onclick = () => {
  localStorage.removeItem(KEY);
  for (const t of [...tiles]) t.el.remove();
  tiles = [];
  active = null;
  DEFAULT_TILES.forEach((t) => makeTile({ ...t }));
  fitAll(0);
};
$('full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen?.());

// ------------------------------------------------------------------ start
const saved = load();
(saved?.tiles ?? DEFAULT_TILES).forEach((t) => makeTile({ ...t }));
if (!supported) {
  $('plain').hidden = false;
  stage.hidden = true;
  $('toolbar').hidden = true;
  $('hint').textContent = 'HTML-in-canvas is not available, so the tiles are laid out as an ordinary page. They work the same; they just cannot be zoomed.';
  $('results').innerHTML = '<tr><td class="status fail">✗</td><td colspan="2">Needs HTML-in-canvas. See the note at the top of the page.</td></tr>';
} else {
  // #region paint
  canvas.addEventListener('paint', paint);
  // #endregion paint
  const ro = new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize?.[0];
    const cw = entry.contentRect.width, ch = entry.contentRect.height;
    if (!cw || !ch) return;
    const pw = box ? box.inlineSize : Math.round(cw * devicePixelRatio), ph = box ? box.blockSize : Math.round(ch * devicePixelRatio);
    if (canvas.width !== pw) canvas.width = pw; // assigning clears the canvas, even to the same value
    if (canvas.height !== ph) canvas.height = ph;
    const first = !size.w;
    size = { w: cw, h: ch, dpr: canvas.width / cw };
    if (first) {
      if (saved?.cam) { cam = saved.cam; changed(); }
      else {
        // First visit: frame the cluster near the origin, not the far-away page tile. On a
        // phone that would be unreadably small, so start on the first note and the to-do list.
        const b = cw < 700 ? { x: tiles[0].x - 12, y: tiles[0].y - 12, w: Math.min(700, cw * 1.6), h: ch * 1.2 } : bounds(tiles.filter((t) => t.x < 1000));
        const f = frameRect(b.x, b.y, b.w, b.h, { maxK: 1, pad: cw < 700 ? 0 : 24 });
        flyTo(cw < 700 ? { ...f, x: b.x, y: b.y } : f, 0);
      }
    }
    requestPaint();
  });
  try { ro.observe(canvas, { box: 'device-pixel-content-box' }); } catch { ro.observe(canvas); }
}

// Handles for the live tests and for scripted checks.
window.__board = { get tiles() { return tiles; }, get cam() { return cam; }, get size() { return size; }, get active() { return active; }, stats, makeTile, removeTile, flyTo, frameRect, fitAll, reveal, activate, zoomAt };

// ------------------------------------------------------------------ live tests
const context = supported ? watchContext(canvas, stage, { onRestore: () => canvas.requestPaint() }) : null;
if (supported && !embed && !isFixture) {
  // The checks move the camera and add tiles, so they run on a hidden copy of this page.
  await mirror($('results'), runTests, {
    extra: [{
      name: 'The board on this page is not blank',
      why: 'Read back from the canvas on this page, not the hidden copy. Fails if it is one flat colour or its graphics context is gone.',
      run: async () => {
        if (context.lost()) throw new Error('the 2D context is lost');
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const n = sample2D(ctx);
        if (n < 2) throw new Error('every sampled pixel is the same colour');
        return `${n} different colours across a 7×7 grid of samples`;
      },
    }],
  });
} else if (supported && !embed) {
  const frames = (n = 2) => new Promise((resolve) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve()); step(); });
  const painted = () => new Promise((resolve) => { canvas.addEventListener('paint', () => resolve(), { once: true }); canvas.requestPaint(); });
  const onScreen = () => { const r = stage.getBoundingClientRect(); if (r.top < 56 || r.bottom > innerHeight) stage.scrollIntoView({ block: 'nearest' }); };
  const settle = async () => { onScreen(); await painted(); await frames(2); };
  const until = async (fn, ms = 4000) => { const t0 = performance.now(); while (!fn()) { if (performance.now() - t0 > ms) throw new Error('timed out waiting'); await frames(1); } };
  /** Put the point (fx, fy) of a tile at the centre of the canvas, at zoom k. */
  const aim = (t, fx, fy, k = 1) => flyTo({ k, x: t.x + t.w * fx - size.w / 2 / k, y: t.y + t.h * fy - size.h / 2 / k }, 0);
  const client = (t, fx, fy) => { onScreen(); const r = canvas.getBoundingClientRect(); return { x: r.left + (t.x + t.w * fx - cam.x) * cam.k, y: r.top + (t.y + t.h * fy - cam.y) * cam.k }; };
  const name = (el) => (el ? `<${el.localName}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}>` : 'nothing');
  const tile = (pred) => tiles.find(pred);
  await until(() => size.w > 0);
  await settle();
  const before = { cam: { ...cam }, scroll: scrollY };
  // elementFromPoint() only answers inside the viewport, so the board has to be on screen.
  stage.scrollIntoView({ block: 'nearest' });

  await runTests($('results'), publish([
    {
      name: 'A tile is hit-testable where it is drawn, at 40%, 100% and 300%',
      why: 'drawElementImage() under a scale transform moves the element’s geometry with it.',
      run: async () => {
        const t = tile((o) => o.type === 'note');
        const out = [];
        for (const k of [0.4, 1, 3]) {
          aim(t, 0.5, 0.6, k);
          await settle();
          const p = client(t, 0.5, 0.6), got = document.elementFromPoint(p.x, p.y);
          if (!t.el.contains(got)) throw new Error(`at ${k * 100}% the browser hit ${name(got)}`);
          const r = t.el.getBoundingClientRect();
          if (Math.abs(r.width - t.w * k) > 1.5) throw new Error(`at ${k * 100}% the tile reports ${r.width.toFixed(1)}px wide, expected ${(t.w * k).toFixed(1)}`);
          out.push(`${k * 100}%: ${r.width.toFixed(0)}px`);
        }
        return out.join(', ');
      },
    },
    {
      name: 'Text is re-rasterised when zoomed, not stretched',
      why: 'A hard black edge drawn at 800%. A stretched bitmap would smear it over about 8 pixels.',
      run: async () => {
        const t = makeTile({ type: 'note', temp: true, x: 5000, y: 5000, w: 200, h: 120, text: '' });
        t.el.querySelector('.body').innerHTML = '<div style="position:absolute;left:20.5px;top:10px;width:60px;height:40px;background:#000"></div>';
        t.el.querySelector('.body').style.background = '#fff';
        flyTo({ k: 8, x: 5000, y: 5000 + 30 }, 0);
        await settle();
        await settle();
        const dpr = size.dpr, y = Math.round((40 - 30 + 30) * 8 * dpr);
        const row = ctx.getImageData(Math.round(8 * 8 * dpr), y, Math.round(120 * 8 * dpr), 1).data; // inside the tile's border
        let soft = 0, dark = 0;
        for (let i = 0; i < row.length; i += 4) { if (row[i] > 40 && row[i] < 215) soft++; if (row[i] <= 40) dark++; }
        removeTile(t);
        if (!dark) throw new Error('the black box was not found in the drawn row');
        if (soft > 6) throw new Error(`${soft} in-between pixels across two edges: this looks like a stretched bitmap`);
        return `${dark} solid pixels, ${soft} in-between pixels across two edges at 800%`;
      },
    },
    {
      name: 'A page tile (iframe) paints and is covered until you click it',
      why: 'Same-origin iframe as a canvas child. The cover keeps wheel and drag for the board.',
      run: async () => {
        const t = tile((o) => o.src === '/board/tiles/todo.html') ?? makeTile({ type: 'frame', temp: true, x: 0, y: 0, w: 360, h: 330, title: 'To-do list', src: '/board/tiles/todo.html' });
        const frame = t.el.querySelector('iframe');
        await until(() => frame.contentDocument?.readyState === 'complete' && frame.contentDocument.querySelector('li'));
        activate(null);
        aim(t, 0.5, 0.6);
        await settle();
        await settle();
        const p = client(t, 0.5, 0.6), c = canvas.getBoundingClientRect();
        const px = Array.from(ctx.getImageData((p.x - c.left) * size.dpr, (p.y - c.top) * size.dpr, 1, 1).data);
        if (px[3] === 0) throw new Error('the iframe area is transparent');
        const covered = document.elementFromPoint(p.x, p.y);
        if (!covered?.classList.contains('cover')) throw new Error(`expected the cover, hit ${name(covered)}`);
        covered.click();
        await settle();
        const p2 = client(t, 0.5, 0.6); // focusing a frame can scroll the page
        const live = document.elementFromPoint(p2.x, p2.y);
        activate(null);
        if (live !== frame) throw new Error(`after clicking, expected the iframe, hit ${name(live)}`);
        return `frame pixel rgb(${px.slice(0, 3)}); cover first, then the iframe itself takes the pointer`;
      },
    },
    {
      name: 'A change inside an iframe repaints the board',
      why: 'The paint event should list the tile when only the framed document changed.',
      run: async () => {
        const t = tile((o) => o.src === '/board/tiles/todo.html');
        if (!t) throw new Error('no to-do tile on the board');
        const doc = t.el.querySelector('iframe').contentDocument;
        aim(t, 0.5, 0.5);
        await settle();
        const seen = new Promise((resolve) => {
          const on = (e) => { if ((e.changedElements ?? []).includes(t.el)) { canvas.removeEventListener('paint', on); resolve(true); } };
          canvas.addEventListener('paint', on);
          setTimeout(() => resolve(false), 2000);
        });
        const box = doc.querySelector('input[type=checkbox]');
        box.click();
        const ok = await seen;
        box.click();
        if (!ok) throw new Error('no paint event named the tile after its iframe changed');
        return 'ticking a to-do inside the frame fired a paint event naming the tile';
      },
    },
    {
      name: 'A tile that scrolls out of view stops catching clicks',
      why: 'Undrawn elements keep their last hit region unless you move it away.',
      run: async () => {
        const t = tile((o) => o.type === 'note');
        aim(t, 0.5, 0.6);
        await settle();
        const p = client(t, 0.5, 0.6);
        if (!t.el.contains(document.elementFromPoint(p.x, p.y))) throw new Error('tile was not hit before panning');
        flyTo({ k: 1, x: cam.x + 30000, y: cam.y }, 0);
        await settle();
        const got = document.elementFromPoint(p.x, p.y);
        if (t.el.contains(got)) throw new Error('the culled tile still catches clicks at its old position');
        return `after panning away the same point hits ${name(got)}`;
      },
    },
    {
      name: 'Without parking, a culled tile keeps its old hit region',
      why: 'The control for the row above: skip updateElementGeometry() and see what the browser does.',
      run: async () => {
        const t = makeTile({ type: 'note', temp: true, x: 9000, y: 9000, w: 240, h: 160, text: 'ghost' });
        aim(t, 0.5, 0.6);
        await settle();
        await settle();
        const p = client(t, 0.5, 0.6);
        t.parked = true; // pretend it is already parked so paint() leaves its geometry alone
        flyTo({ k: 1, x: cam.x + 30000, y: cam.y }, 0);
        await settle();
        const got = document.elementFromPoint(p.x, p.y);
        removeTile(t);
        if (!t.el.contains(got)) throw new Error(`the stale region was gone: hit ${name(got)}`);
        return 'confirmed: the undrawn tile was still clickable where it was last drawn';
      },
    },
    {
      name: 'Overlapping tiles: which one gets the click?',
      why: 'Two notes on top of each other. Try CSS z-index, then draw order, and see which the hit test obeys.',
      run: async () => {
        const a = makeTile({ type: 'note', temp: true, x: 12000, y: 12000, w: 240, h: 160, text: 'A' });
        const b = makeTile({ type: 'note', temp: true, x: 12040, y: 12040, w: 240, h: 160, text: 'B' });
        aim(b, 0.3, 0.5);
        await settle();
        await settle();
        const p = client(b, 0.3, 0.5); // inside both; B is later in the DOM and drawn last
        const who = () => { const el = document.elementFromPoint(p.x, p.y); return a.el.contains(el) ? 'A' : b.el.contains(el) ? 'B' : name(el); };
        const start = who();
        a.el.style.zIndex = 1e6;
        await settle();
        const byZ = who();
        a.el.style.zIndex = '';
        a.z = b.z + 1; // paint() sorts by z, so A is now drawn last
        await settle();
        const byDraw = who();
        removeTile(a);
        removeTile(b);
        const result = `B drawn last: ${start}; huge z-index on A: ${byZ}; A drawn last: ${byDraw}`;
        if (start !== 'B' || byZ !== 'B' || byDraw !== 'A') throw new Error(`unexpected: ${result}`);
        return `${result}. Draw order decides, CSS stacking does not.`;
      },
    },
    {
      name: 'Focus pulls the camera to a far-away tile',
      why: 'Tab order is DOM order, so focusin can drive the board for keyboard users.',
      run: async () => {
        const t = tile((o) => o.type === 'note');
        flyTo({ k: 1, x: t.x + 20000, y: t.y + 20000 }, 0);
        await settle();
        t.el.querySelector('.text').focus({ preventScroll: true });
        await until(() => !glide && (t.x + t.w / 2 - cam.x) * cam.k >= 0 && (t.x + t.w / 2 - cam.x) * cam.k <= size.w, 3000);
        await settle();
        const p = client(t, 0.5, 0.5), got = document.elementFromPoint(p.x, p.y);
        document.activeElement.blur();
        if (!t.el.contains(got)) throw new Error('camera moved but the tile is not under its own centre');
        return 'focused note is on screen and hit-testable';
      },
    },
    {
      name: 'Zoomed far out, tiles become placeholders and stay out of the hit test',
      why: `Below ${LOD_PX}px wide a tile is drawn as a rectangle; its DOM is parked.`,
      run: async () => {
        const t = tile((o) => o.type === 'note');
        aim(t, 0.5, 0.5, 0.08);
        await settle();
        const p = client(t, 0.5, 0.5), got = document.elementFromPoint(p.x, p.y);
        if (got !== canvas) throw new Error(`placeholder still hits ${name(got)}`);
        return `${stats.placeholders} placeholders, ${stats.drawn} live tiles at 8%`;
      },
    },
    {
      name: 'As many live notes as fit on screen at once',
      why: 'Every one is a contenteditable element, redrawn on each paint. Sized so each stays above the placeholder threshold.',
      timeout: 15000,
      run: async () => {
        const cols = Math.max(2, Math.min(10, Math.floor(size.w / 88))), rows = Math.max(2, Math.min(6, Math.floor(size.h / 60)));
        const extra = [];
        for (let i = 0; i < cols * rows; i++) extra.push(makeTile({ type: 'note', temp: true, x: 20000 + (i % cols) * 270, y: 20000 + Math.floor(i / cols) * 180, w: 250, h: 160, color: i, text: `Note ${i + 1}\nlive DOM` }));
        const b = bounds(extra);
        flyTo(frameRect(b.x, b.y, b.w, b.h, { maxK: 1, pad: 4 }), 0);
        await settle();
        await settle();
        const times = [];
        for (let i = 0; i < 12; i++) { const t0 = performance.now(); cam.x += 3; await painted(); times.push(performance.now() - t0); }
        const live = stats.drawn;
        times.sort((x, y) => x - y);
        extra.forEach(removeTile);
        if (live < extra.length) throw new Error(`only ${live} of ${extra.length} tiles were drawn live`);
        return `${live} live tiles, median ${times[6].toFixed(1)} ms from requestPaint() to painted, ${stats.ms.toFixed(1)} ms in the paint handler`;
      },
    },
  ]));
  flyTo(before.cam, 0);
  scrollTo(0, before.scroll);
  save();
}
