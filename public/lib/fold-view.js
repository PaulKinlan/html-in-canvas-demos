// FoldView: draw the children of one <canvas content="drawable"> across a fold.
//
//   import { FoldView, readDevice } from '/lib/fold-view.js';
//   const view = new FoldView(canvas, { content, controls });
//   view.set({ source: 'sim', axis: 'horizontal', angle: 110, hinge: 0 });
//   view.set({ source: 'device' });   // use navigator.devicePosture and viewport.segments
//
// The canvas has two children, a content pane and a controls pane. The class
// decides where each pane goes from the posture and the segments, draws them
// with a 2D context, and sets their hit boxes with updateElementGeometry().
//
// With source 'sim' the fold is drawn as a picture of a folded device: each
// half is cut into strips along the fold, and every strip is one clipped
// drawElementImage() call with its own scale. With source 'device' the canvas
// covers the window and nothing is tilted, because the screen itself is bent.

const PERSPECTIVE = 1100; // distance of the eye from the hinge, CSS px
const STRIP = 8; // length of one strip along the surface, CSS px
const BEZEL = 10;
const BEND = 16; // the surface turns over this distance next to the hinge
const BAR = 68; // height of the controls pane when it is a bar
const PITCH = 38 * (Math.PI / 180); // the eye looks down on the device by this much
const MIN_ANGLE = 60; // the smallest fold angle the picture can show: below it the first half hides the second

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ease = (x) => 1 - Math.pow(1 - x, 3);
const lerp = (a, b, t) => a + (b - a) * t;

// #region device
/** What this window reports about a fold. Never throws. */
export function readDevice() {
  // Chrome 138 added viewport.segments. Older builds had visualViewport.segments.
  const list = window.viewport?.segments ?? window.visualViewport?.segments ?? null;
  const segments = list ? Array.from(list, (r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })) : [];
  return {
    posture: navigator.devicePosture?.type ?? null, // 'continuous' | 'folded'
    segments,
    from: window.viewport?.segments ? 'viewport.segments' : window.visualViewport?.segments ? 'visualViewport.segments' : null,
  };
}

/** Call `fn` when the posture or the segments may have changed. */
export function watchDevice(fn) {
  navigator.devicePosture?.addEventListener('change', fn);
  addEventListener('resize', fn);
  for (const q of ['(horizontal-viewport-segments: 2)', '(vertical-viewport-segments: 2)']) matchMedia(q).addEventListener('change', fn);
}
// #endregion device

export class FoldView {
  state = { source: 'sim', axis: 'horizontal', angle: 180, hinge: 0, cut: true, span: false };
  /** The last model that was drawn: surface size, fold position, strips, pane rects. */
  model = null;
  lost = false;

  #panes;
  #pointerHalf = -1;
  #unit = null;
  #raf = 0;
  #opening = null; // { from, start, ms }: the picture of the hinge opening after a posture change
  #lastPosture = null;

  constructor(canvas, { content, controls }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.#panes = [
      { el: content, name: 'content', rect: null, from: null, start: 0 },
      { el: controls, name: 'controls', rect: null, from: null, start: 0 },
    ];
    for (const p of this.#panes) Object.assign(p.el.style, { position: 'absolute', left: '0', top: '0', boxSizing: 'border-box' });

    new ResizeObserver(([entry]) => {
      const size = entry.devicePixelContentBoxSize?.[0];
      const w = size ? size.inlineSize : Math.round(canvas.clientWidth * devicePixelRatio);
      const h = size ? size.blockSize : Math.round(canvas.clientHeight * devicePixelRatio);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      this.#unit = null;
      this.update();
    }).observe(canvas, { box: 'device-pixel-content-box' });

    canvas.addEventListener('paint', () => this.#paint());
    canvas.addEventListener('contextlost', () => { this.lost = true; this.onlost?.(); });
    canvas.addEventListener('contextrestored', () => { this.lost = false; this.onlost?.(); this.update(); });
    // A pane that spans the fold lies on two planes but has one hit box. Give it to the half under the pointer.
    const follow = (e) => this.#follow(e);
    addEventListener('pointermove', follow, { capture: true, passive: true });
    addEventListener('pointerdown', follow, { capture: true, passive: true });
    watchDevice(() => {
      if (this.state.source !== 'device') return;
      // #region opening
      // The API has no fold angle, only two words. When the word changes, the canvas
      // plays the movement itself: the two halves are drawn as slabs that swing flat.
      const posture = readDevice().posture;
      if (this.#lastPosture && posture !== this.#lastPosture) this.open(posture === 'continuous' ? 90 : 150, posture === 'continuous' ? 1100 : 600);
      this.#lastPosture = posture;
      // #endregion opening
      this.update();
    });
  }

  /** Draw the halves swinging from `from` degrees to flat. Used when a real device changes posture. */
  open(from = 90, ms = 1100) {
    this.#opening = { from, start: performance.now(), ms };
    this.update();
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.update();
  }

  /** Work out the layout again and ask for a paint. */
  update() {
    this.#layout();
    this.canvas.requestPaint?.();
  }

  // #region layout
  // The surface is the unfolded screen in CSS px. `along` runs across the
  // fold, `cross` runs beside it. The hinge covers along = h0 .. h1.
  #layout() {
    const { canvas, state } = this;
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return;
    const m = { source: state.source, cw, ch, bezel: BEZEL, angle: 180 };
    if (state.source === 'device') {
      const dev = readDevice();
      const [a, b] = dev.segments;
      m.W = cw; m.H = ch; m.bezel = 0; m.posture = dev.posture ?? 'continuous';
      this.#lastPosture ??= dev.posture;
      if (this.#opening) {
        // A damped swing from the starting angle to flat. It passes 180 degrees a little and comes back.
        const t = (performance.now() - this.#opening.start) / this.#opening.ms;
        if (t >= 1) this.#opening = null;
        else { m.angle = 180 - (180 - this.#opening.from) * Math.exp(-3.2 * t) * Math.cos(4.2 * t); m.opening = true; }
      }
      if (a && b) {
        // Two segments one above the other mean a horizontal fold. Side by side mean a vertical one.
        m.axis = b.y >= a.y + a.height - 1 ? 'horizontal' : 'vertical';
        m.h0 = m.axis === 'horizontal' ? a.y + a.height : a.x + a.width;
        m.h1 = m.axis === 'horizontal' ? b.y : b.x;
        m.fold = true;
      } else {
        m.axis = 'horizontal'; m.h0 = m.h1 = ch; m.fold = false;
      }
    } else {
      m.axis = state.axis;
      m.W = m.axis === 'horizontal' ? Math.min(cw - 36, 320) : Math.min(cw - 36, 560);
      m.H = m.axis === 'horizontal' ? Math.min(ch - 36, 460) : Math.min(ch - 36, 360);
      const L = m.axis === 'horizontal' ? m.H : m.W;
      m.h0 = (L - state.hinge) / 2; m.h1 = (L + state.hinge) / 2;
      m.fold = true;
      m.angle = Math.max(MIN_ANGLE, state.angle);
      // The Device Posture API reports 'folded' for a laptop or book shape and 'continuous' for flat.
      m.posture = state.angle < 150 ? 'folded' : 'continuous';
    }
    m.L = m.axis === 'horizontal' ? m.H : m.W; // length across the fold
    m.C = m.axis === 'horizontal' ? m.W : m.H; // length beside the fold
    m.gap = m.h1 - m.h0;
    // How far each half is turned towards the eye. In the picture of a device the
    // second half never moves: it lies at the pitch of the eye, and the first half
    // swings up from it. So the controls stay where they are at every angle.
    const fold = (180 - m.angle) * (Math.PI / 180);
    m.alpha = fold / 2;
    m.tilt = m.source === 'device' ? { [-1]: fold / 2, 1: fold / 2 } : { [-1]: fold - PITCH, 1: PITCH };
    m.separate = m.fold && m.posture === 'folded' && !state.span;
    m.cutShift = m.fold && state.cut && !m.separate ? m.gap : 0;

    // Where each pane goes, as a rectangle on the surface.
    const rect = (along, cross, alongLen, crossLen) =>
      m.axis === 'horizontal' ? { x: cross, y: along, w: crossLen, h: alongLen } : { x: along, y: cross, w: alongLen, h: crossLen };
    let content, controls;
    if (m.separate) {
      content = rect(0, 0, m.h0, m.C); // first segment
      controls = rect(m.h1, 0, m.L - m.h1, m.C); // second segment
    } else {
      // One pane over the whole screen. With `cut` its picture is cut at the hinge and
      // carries on after it, so it is laid out shorter by the width of the hinge.
      content = rect(0, 0, m.L - m.cutShift, m.C);
      controls = !m.fold ? { x: 0, y: m.H - BAR, w: m.W, h: BAR }
        : m.axis === 'horizontal' ? { x: 0, y: m.L - BAR, w: m.C, h: BAR }
        : { x: m.h1, y: m.C - BAR, w: m.L - m.h1, h: BAR };
    }
    const now = performance.now();
    for (const [pane, target, mode] of [[this.#panes[0], content, m.separate ? 'half' : 'span'], [this.#panes[1], controls, m.separate ? 'full' : 'bar']]) {
      const old = pane.rect;
      const moved = old && (old.x !== target.x || old.y !== target.y || old.w !== target.w || old.h !== target.h);
      // A pane that changes place because the posture changed slides there. A slider drag does not animate.
      if (moved && pane.mode !== mode && !this.still) { pane.from = this.#current(pane, now); pane.start = now; }
      pane.rect = target;
      pane.mode = mode;
      pane.el.style.width = `${target.w}px`;
      pane.el.style.height = `${target.h}px`;
      pane.el.dataset.mode = mode;
    }
    m.strips = strips(m);
    this.model = m;
    this.onmodel?.(m);
  }
  // #endregion layout

  #current(pane, now) {
    const t = pane.from ? Math.min(1, (now - pane.start) / 320) : 1;
    if (t >= 1) { pane.from = null; return pane.rect; }
    const e = ease(t), a = pane.from, b = pane.rect;
    return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), w: lerp(a.w, b.w, e), h: lerp(a.h, b.h, e), moving: true };
  }

  // #region draw
  #paint() {
    const { canvas, ctx, model: m } = this;
    if (!m || this.lost) return;
    const dpr = canvas.width / canvas.clientWidth;
    const now = performance.now();
    const horizontal = m.axis === 'horizontal';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Every strip maps a band of the surface to the canvas with its own scale.
    const use = (s) => (horizontal
      ? ctx.setTransform(dpr * s.sc, 0, 0, dpr * s.m, dpr * (m.cC - s.sc * m.C / 2), dpr * (s.p0 - s.m * s.tA))
      : ctx.setTransform(dpr * s.m, 0, 0, dpr * s.sc, dpr * (s.p0 - s.m * s.tA), dpr * (m.cC - s.sc * m.C / 2)));
    const band = (s, c0, c1, t0, t1) => (horizontal ? [c0, t0, c1 - c0, t1 - t0] : [t0, c0, t1 - t0, c1 - c0]);

    // The outline of the folded device and of its screen, from the corners of every strip.
    // One path for all strips, so the edges are straight and no seam shows between strips.
    const outline = (pad) => {
      ctx.beginPath();
      for (const s of m.strips) {
        const p0 = s.p0 - (s.first ? pad * s.m : 0), p1 = s.p1 + (s.last ? pad * s.m : 0);
        const a = s.scA * (m.C / 2 + pad), b = s.scB * (m.C / 2 + pad);
        const quad = [[m.cC - a, p0], [m.cC + a, p0], [m.cC + b, p1], [m.cC - b, p1]];
        quad.forEach(([c, p], i) => ctx[i ? 'lineTo' : 'moveTo'](...(horizontal ? [c, p] : [p, c])));
        ctx.closePath();
      }
    };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (m.bezel) {
      // The body, with a shadow that grows as the slabs lift off the page.
      outline(m.bezel);
      ctx.shadowColor = 'rgb(0 0 0 / .45)';
      ctx.shadowBlur = dpr * (6 + 26 * Math.sin(Math.abs(m.alpha)));
      ctx.shadowOffsetY = dpr * (2 + 14 * Math.sin(Math.abs(m.alpha)));
      ctx.fillStyle = '#26282c';
      ctx.fill();
      ctx.shadowColor = 'transparent';
    }
    outline(0);
    ctx.fillStyle = '#0c0d0f';
    ctx.fill();
    ctx.save();
    ctx.clip(); // everything below stays inside the screen

    let moving = false, draws = 0;
    for (const pane of this.#panes) {
      const r = this.#current(pane, now);
      moving ||= !!r.moving;
      const a0 = horizontal ? r.y : r.x, aLen = horizontal ? r.h : r.w; // the pane along the fold
      const c0 = horizontal ? r.x : r.y, cLen = horizontal ? r.w : r.h;
      const spans = pane.name === 'content' && !m.separate;
      for (const s of m.strips) {
        // After the hinge, a cut picture is drawn further on by the width of the hinge.
        const shift = spans && s.half > 0 ? m.cutShift : 0;
        const lo = Math.max(s.tA, a0 + shift), hi = Math.min(s.tB, a0 + shift + aLen);
        if (hi <= lo) continue;
        const over = 0.5 / s.m; // overlap the next strip by half a pixel so no seam shows
        ctx.save();
        use(s);
        ctx.beginPath();
        ctx.rect(...band(s, c0, c0 + cLen, lo - (lo > s.tA ? 0 : over), hi + (hi < s.tB ? 0 : over)));
        draws++;
        ctx.clip();
        try {
          if (horizontal) ctx.drawElementImage(pane.el, r.x, r.y + shift, r.w, r.h);
          else ctx.drawElementImage(pane.el, r.x + shift, r.y, r.w, r.h);
        } catch (err) { this.error = err.message; }
        ctx.restore();
      }
      pane.drawn = r;
    }

    // Light: the half that turns away from the light is darker, and the crease is darkest.
    // Bands are snapped to whole pixels so that neighbours neither overlap nor leave a gap.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const s of m.strips) {
      const tilt = Math.max(0, Math.sin(s.tilt));
      const crease = m.gap < 1 ? Math.max(0, 1 - s.d / 14) * Math.sin(m.alpha) * 0.3 : 0;
      const dark = (s.half < 0 ? 0.3 : 0) * tilt + crease;
      const light = m.source === 'device' && s.half > 0 ? 0.1 * tilt : 0;
      if (dark < 0.004 && light < 0.004) continue;
      ctx.fillStyle = dark > light ? `rgb(0 0 0 / ${dark.toFixed(3)})` : `rgb(255 255 255 / ${light.toFixed(3)})`;
      const p0 = Math.round(s.p0 * dpr), p1 = Math.round(s.p1 * dpr);
      ctx.fillRect(...(horizontal ? [0, p0, canvas.width, p1 - p0] : [p0, 0, p1 - p0, canvas.height]));
    }
    // Glass: a band of reflected light that crosses each half as the angle changes.
    if (Math.abs(m.alpha) > 0.004) {
      const turn = Math.sin(m.alpha), size = Math.max(canvas.width, canvas.height);
      for (const half of [-1, 1]) {
        const at = (m.cA + half * m.k * (m.L / 2) * (1.15 - 1.3 * Math.abs(turn))) * dpr, w = size * 0.16;
        const g = horizontal ? ctx.createLinearGradient(0, at - w, w * 0.5, at + w) : ctx.createLinearGradient(at - w, 0, at + w, w * 0.5);
        g.addColorStop(0, 'rgb(255 255 255 / 0)'); g.addColorStop(0.5, `rgb(255 255 255 / ${(0.22 * Math.min(1, Math.abs(turn) * 2.5)).toFixed(3)})`); g.addColorStop(1, 'rgb(255 255 255 / 0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
    }
    ctx.restore(); // end of the screen clip

    // The hinge is flat and faces the eye.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (m.gap >= 1) {
      const p0 = m.cA - m.k * m.gap / 2, c0 = m.cC - m.k * (m.C / 2 + m.bezel), cLen = m.k * (m.C + 2 * m.bezel);
      const g = horizontal ? ctx.createLinearGradient(0, p0, 0, p0 + m.k * m.gap) : ctx.createLinearGradient(p0, 0, p0 + m.k * m.gap, 0);
      g.addColorStop(0, '#15161a'); g.addColorStop(0.5, '#4a4d55'); g.addColorStop(1, '#15161a');
      ctx.fillStyle = g;
      ctx.fillRect(...(horizontal ? [c0, p0, cLen, m.k * m.gap] : [p0, c0, m.k * m.gap, cLen]));
    } else if (m.source === 'device' && m.fold && m.posture === 'folded') {
      // On a real folded screen nothing is tilted in the picture. Only the crease is shaded.
      const g = horizontal ? ctx.createLinearGradient(0, m.h0 - 16, 0, m.h0 + 16) : ctx.createLinearGradient(m.h0 - 16, 0, m.h0 + 16, 0);
      g.addColorStop(0, 'rgb(0 0 0 / 0)'); g.addColorStop(0.5, 'rgb(0 0 0 / .28)'); g.addColorStop(0.52, 'rgb(255 255 255 / .16)'); g.addColorStop(1, 'rgb(255 255 255 / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(...(horizontal ? [0, m.h0 - 16, m.W, 32] : [m.h0 - 16, 0, 32, m.H]));
    }

    // Hit boxes last: this replaces the boxes the draws above left behind.
    for (const pane of this.#panes) this.#place(pane);
    this.painted = (this.painted ?? 0) + 1;
    this.draws = draws;
    if ((moving || m.opening) && !this.#raf) this.#raf = requestAnimationFrame(() => { this.#raf = 0; if (m.opening) this.update(); else canvas.requestPaint(); });
  }
  // #endregion draw

  // #region geometry
  // One half of the folded surface is a plane, so a 3D matrix with a perspective
  // row describes it exactly. updateElementGeometry() accepts that matrix.
  #place(pane) {
    const { canvas, model: m } = this;
    const r = pane.drawn ?? pane.rect;
    const spans = pane.name === 'content' && !m.separate;
    const half = pane.name === 'controls' ? 1 : spans ? this.#pointerHalf : -1;
    const shift = spans && half > 0 ? m.cutShift : 0;
    const el = pane.el, ew = el.offsetWidth || r.w, eh = el.offsetHeight || r.h;
    const matrix = planeMatrix(m, half)
      .translate(r.x + (m.axis === 'horizontal' ? 0 : shift), r.y + (m.axis === 'horizontal' ? shift : 0))
      .scale(r.w / ew, r.h / eh);
    if (this.#unit === null) {
      // canvasTransform has been seen in CSS px on some canvases and buffer px on others. Measure which.
      canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix() });
      const measured = el.getBoundingClientRect().width;
      this.#unit = measured > 0 ? (ew * (el.currentCSSZoom || 1)) / measured : 1;
    }
    canvas.updateElementGeometry(el, { canvasTransform: new DOMMatrix().scale(this.#unit).multiply(matrix) });
    pane.half = half;
  }

  #follow(e) {
    const m = this.model;
    if (!m || !m.fold || m.separate) return;
    const box = this.canvas.getBoundingClientRect();
    const zoom = this.canvas.currentCSSZoom || 1;
    const p = m.axis === 'horizontal' ? (e.clientY - box.top) / zoom : (e.clientX - box.left) / zoom;
    const half = p < m.cA ? -1 : 1;
    if (half === this.#pointerHalf) return;
    this.#pointerHalf = half;
    const pane = this.#panes[0];
    this.#place(pane);
    // Chromium 157 remembers its last hit-test answer for a point. A DOM change clears it.
    pane.el.toggleAttribute('data-moved');
  }
  // #endregion geometry

  /** Where a point of the surface is drawn, in CSS px from the canvas corner. */
  project(x, y) {
    const m = this.model;
    const [t, c] = m.axis === 'horizontal' ? [y, x] : [x, y];
    const half = t <= m.h0 ? -1 : 1;
    const d = Math.max(0, half < 0 ? m.h0 - t : t - m.h1);
    const { along, z } = at(m.profiles[half], d);
    const s = 1 / (1 - z / PERSPECTIVE);
    const p = m.cA + half * m.k * s * (m.gap / 2 + along);
    const q = m.cC + m.k * s * (c - m.C / 2);
    return m.axis === 'horizontal' ? { x: q, y: p } : { x: p, y: q };
  }

  /** Where a point inside a pane element is drawn, in client coordinates. */
  clientPoint(el, dx, dy) {
    const m = this.model;
    const pane = this.#panes.find((p) => p.el === el || p.el.contains(el));
    const r = pane.rect;
    const horizontal = m.axis === 'horizontal';
    let x = r.x + dx, y = r.y + dy;
    // A cut picture carries on after the hinge.
    if (pane.name === 'content' && !m.separate && m.cutShift) {
      if (horizontal && y > m.h0) y += m.cutShift;
      if (!horizontal && x > m.h0) x += m.cutShift;
    }
    const p = this.project(x, y);
    const box = this.canvas.getBoundingClientRect();
    return { x: box.left + p.x, y: box.top + p.y };
  }

  get panes() { return this.#panes; }
}

// #region strips
// Walk away from the hinge along one half. The surface turns from flat to the
// fold angle over BEND px, so the crease is a curve and not a corner.
function walk(len, alpha, steps) {
  const out = [{ d: 0, along: 0, z: 0, tilt: 0 }];
  let along = 0, z = 0;
  const sub = 4;
  for (let i = 1; i <= steps; i++) {
    let tilt = 0;
    for (let j = 0; j < sub; j++) {
      const d = ((i - 1 + (j + 0.5) / sub) * len) / steps;
      tilt = alpha * smooth(d / BEND);
      along += (Math.cos(tilt) * len) / steps / sub;
      z += (Math.sin(tilt) * len) / steps / sub; // towards the eye
    }
    out.push({ d: (i * len) / steps, along, z, tilt });
  }
  return out;
}

function at(profile, d) {
  const last = profile[profile.length - 1];
  if (d >= last.d) {
    // Past the end of the walk the surface is a plane.
    return { along: last.along + (d - last.d) * Math.cos(last.tilt), z: last.z + (d - last.d) * Math.sin(last.tilt) };
  }
  let i = 1;
  while (profile[i].d < d) i++;
  const a = profile[i - 1], b = profile[i], f = (d - a.d) / (b.d - a.d || 1);
  return { along: lerp(a.along, b.along, f), z: lerp(a.z, b.z, f) };
}

function strips(m) {
  const flat = Math.abs(m.tilt[-1]) < 0.004 && Math.abs(m.tilt[1]) < 0.004;
  const lens = { [-1]: m.h0, 1: m.L - m.h1 };
  const steps = (half) => (flat ? 1 : Math.max(1, Math.ceil(lens[half] / STRIP)));
  m.profiles = { [-1]: walk(Math.max(lens[-1], 1), m.tilt[-1], steps(-1)), 1: walk(Math.max(lens[1], 1), m.tilt[1], steps(1)) };
  const scale = (p) => 1 / (1 - p.z / PERSPECTIVE);

  if (m.source === 'device') {
    m.k = 1; m.cA = (m.h0 + m.h1) / 2; m.cC = m.C / 2;
  } else {
    // Fit the picture into the canvas once, for every angle the slider can reach,
    // so that neither the size nor the place of the hinge changes while it folds.
    const reach = (len, tilt) => { const end = walk(len, tilt, 8)[8], sc = scale(end); return { along: sc * (m.gap / 2 + end.along + m.bezel), cross: sc * (m.C / 2 + m.bezel) }; };
    const second = reach(lens[1], PITCH);
    let first = 0, cross = second.cross;
    for (let angle = MIN_ANGLE; angle <= 180; angle += 15) {
      const r = reach(lens[-1], (180 - angle) * (Math.PI / 180) - PITCH);
      first = Math.max(first, r.along); cross = Math.max(cross, r.cross);
    }
    const roomAlong = (m.axis === 'horizontal' ? m.ch : m.cw) - 8, roomCross = (m.axis === 'horizontal' ? m.cw : m.ch) - 8;
    m.k = Math.min(1, roomAlong / (first + second.along), roomCross / (2 * cross));
    m.cA = (roomAlong + 8 - m.k * (first + second.along)) / 2 + m.k * first; // where the hinge is drawn
    m.cC = (roomCross + 8) / 2;
  }

  const out = [];
  for (const half of [-1, 1]) {
    const len = lens[half], profile = m.profiles[half];
    if (len < 1) continue;
    for (let i = 0; i + 1 < profile.length; i++) {
      const a = profile[i], b = profile[i + 1];
      const pa = m.k * scale(a) * (m.gap / 2 + a.along), pb = m.k * scale(b) * (m.gap / 2 + b.along);
      if (pb - pa < 0.02) continue; // seen edge on: nothing to draw
      const s = {
        half, d: (a.d + b.d) / 2, tilt: (a.tilt + b.tilt) / 2,
        sc: m.k * (scale(a) + scale(b)) / 2, // scale beside the fold
        scA: m.k * scale(half > 0 ? a : b), scB: m.k * scale(half > 0 ? b : a), // the same at each end
        first: half < 0 && i + 2 === profile.length, last: half > 0 && i + 2 === profile.length,
      };
      if (half > 0) { s.tA = m.h1 + a.d; s.tB = m.h1 + b.d; s.p0 = m.cA + pa; s.p1 = m.cA + pb; }
      else { s.tA = m.h0 - b.d; s.tB = m.h0 - a.d; s.p0 = m.cA - pb; s.p1 = m.cA - pa; }
      s.m = (s.p1 - s.p0) / (s.tB - s.tA); // scale across the fold
      out.push(s);
    }
  }
  return out;
}
// #endregion strips

// #region plane
// The matrix that takes a surface point (x, y) on one half to the canvas.
// It is exact where the half is flat, which is everywhere past the bend.
function planeMatrix(m, half) {
  const r = Math.min(BEND, half < 0 ? m.h0 : m.L - m.h1);
  const { along: Ar, z: Zr } = at(m.profiles[half], r);
  const cos = Math.cos(m.tilt[half]), sin = Math.sin(m.tilt[half]);
  const edge = half < 0 ? m.h0 : m.h1; // where this half meets the hinge
  // With t the position across the fold: Y = Y0 + cos * t and w = W0 + Wt * t.
  const Y0 = half * (m.gap / 2 + Ar - r * cos) - cos * edge;
  const W0 = 1 - (Zr - r * sin - half * sin * edge) / PERSPECTIVE;
  const Wt = (-half * sin) / PERSPECTIVE;
  const k = m.k, cA = m.cA, cC = m.cC, C = m.C;
  // Rows of the homography for (t, c, 1): position across the fold, position beside it, and w.
  const across = [k * cos + cA * Wt, 0, k * Y0 + cA * W0];
  const beside = [cC * Wt, k, cC * W0 - (k * C) / 2];
  const w = [Wt, 0, W0];
  // Canvas x and y in terms of surface x and y.
  const [X, Y] = m.axis === 'horizontal'
    ? [[beside[1], beside[0], beside[2]], [across[1], across[0], across[2]]]
    : [across, beside];
  const Wr = m.axis === 'horizontal' ? [w[1], w[0], w[2]] : w;
  return new DOMMatrix([
    X[0], Y[0], 0, Wr[0],
    X[1], Y[1], 0, Wr[1],
    0, 0, 1, 0,
    X[2], Y[2], 0, Wr[2],
  ]);
}
// #endregion plane
