// Benchmark harness for /perf-architecture/: compares four HTML-in-canvas
// layout and memory architectures across 8, 24, 64 and 128 interactive controls.
//
// Architectures:
//   1. shared-2d            One shared 2D canvas (band-split vertically to stay under 3.6 MP).
//   2. shared-webgl         One shared WebGL 2 canvas via ElementGL (viewport-sized, sticky).
//   3. per-element-live     N individual per-element drawable 2D canvases, all backing stores live.
//   4. per-element-budgeted N per-element drawable 2D canvases with IntersectionObserver 0x0
//                           offscreen eviction and a ~6 ms per-frame paint budget.

import { supported as canvasSupported } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

export const SINGLE_CANVAS_MAX_PX = 3_600_000;
export const TOTAL_BUDGET_BYTES = 80_000_000;
export const STAGE_VIEW_H = 340;
export const TILE_H = 88;
export const PAD = 10;
export const GAP = 8;
export const FRAME_BUDGET_MS = 6;

export const COUNTS = [8, 24, 64, 128];

export const ARCH_LIST = [
  { id: 'shared-2d', short: '1. Shared 2D', label: '1. One shared 2D canvas (band-split <= 3.6 MP)' },
  { id: 'shared-webgl', short: '2. Shared WebGL', label: '2. One shared WebGL canvas (ElementGL)' },
  { id: 'per-element-live', short: '3. N live 2D', label: '3. N per-element 2D canvases (all live)' },
  { id: 'per-element-budgeted', short: '4. N evicted + 6 ms', label: '4. N per-element 2D (0x0 eviction + 6 ms budget)' },
];

const WEBGL_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uTheme;
uniform float uLevel;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec4 c = texture(uTex, vUv);
  vec2 px = vUv * uSize;
  float edge = min(min(px.x, uSize.x - px.x), min(px.y, uSize.y - px.y));
  float rim = (1.0 - smoothstep(0.0, 2.5, edge)) * 0.28;
  vec3 tint = mix(vec3(0.84, 0.32, 0.14), vec3(0.32, 0.68, 0.96), uTheme);
  float sheen = smoothstep(0.0, 1.0, 1.0 - vUv.y) * (0.04 + 0.06 * uLevel);
  vec3 rgb = c.rgb + (tint * rim + vec3(sheen)) * c.a;
  outColor = vec4(rgb, c.a);
}`;

// #region budget-layout
export function activeBudget() {
  const g = window.__gfx?.budget;
  return {
    maxCanvasPx: Math.min(SINGLE_CANVAS_MAX_PX, g?.canvasPx ? Math.floor(g.canvasPx * 0.9) : SINGLE_CANVAS_MAX_PX),
    maxTotalBytes: Math.min(TOTAL_BUDGET_BYTES, g?.bytes ? Math.floor(g.bytes * 0.85) : TOTAL_BUDGET_BYTES),
  };
}

export function computeLayout(n, viewportWidth, nativeDpr = window.devicePixelRatio || 1, archId = 'shared-2d') {
  const budget = activeBudget();
  const viewW = Math.max(240, Math.floor(viewportWidth));
  const cols = viewW >= 740 ? 4 : viewW >= 520 ? 3 : 2;
  const tileW = Math.max(108, Math.floor((viewW - PAD * 2 - GAP * (cols - 1)) / cols));
  const rows = Math.ceil(n / cols);
  const totalH = PAD * 2 + rows * TILE_H + Math.max(0, rows - 1) * GAP;
  const targetDpr = Math.min(nativeDpr || 1, 3);

  let effectiveDpr = targetDpr;
  let capped = false;
  let rawAreaBytes = 0;

  if (archId === 'shared-2d') {
    rawAreaBytes = viewW * totalH * targetDpr * targetDpr * 4;
    if (rawAreaBytes > budget.maxTotalBytes) {
      effectiveDpr = Math.max(1, Math.floor(Math.sqrt(budget.maxTotalBytes / (viewW * totalH * 4)) * 100) / 100);
      capped = true;
    }
  } else if (archId === 'per-element-live') {
    rawAreaBytes = n * tileW * TILE_H * targetDpr * targetDpr * 4;
    if (rawAreaBytes > budget.maxTotalBytes) {
      effectiveDpr = Math.max(1, Math.floor(Math.sqrt(budget.maxTotalBytes / (n * tileW * TILE_H * 4)) * 100) / 100);
      capped = true;
    }
  } else if (archId === 'shared-webgl') {
    rawAreaBytes = viewW * STAGE_VIEW_H * targetDpr * targetDpr * 8;
    if (viewW * STAGE_VIEW_H * targetDpr * targetDpr > budget.maxCanvasPx) {
      effectiveDpr = Math.max(1, Math.floor(Math.sqrt(budget.maxCanvasPx / (viewW * STAGE_VIEW_H)) * 100) / 100);
      capped = true;
    }
  } else {
    // Evicted architecture only keeps visible + margin canvases allocated.
    const visibleRows = Math.ceil((STAGE_VIEW_H + 240) / (TILE_H + GAP)) + 1;
    const estLive = Math.min(n, visibleRows * cols);
    rawAreaBytes = estLive * tileW * TILE_H * targetDpr * targetDpr * 4;
  }

  // Band split for shared-2d so no single canvas ever crosses maxCanvasPx.
  const maxBandCssH = Math.max(TILE_H + PAD * 2, Math.floor(budget.maxCanvasPx / (viewW * effectiveDpr * effectiveDpr)));
  const rowsPerBand = Math.max(1, Math.floor((maxBandCssH - PAD * 2 + GAP) / (TILE_H + GAP)));
  const bands = [];
  for (let startRow = 0; startRow < rows; startRow += rowsPerBand) {
    const endRow = Math.min(rows, startRow + rowsPerBand);
    const bandRows = endRow - startRow;
    const topPad = startRow === 0 ? PAD : Math.floor(GAP / 2);
    const botPad = endRow === rows ? PAD : Math.ceil(GAP / 2);
    const cssH = topPad + bandRows * TILE_H + Math.max(0, bandRows - 1) * GAP + botPad;
    const startIndex = startRow * cols;
    const endIndex = Math.min(n, endRow * cols);
    bands.push({
      bandIndex: bands.length,
      startRow,
      endRow,
      startIndex,
      endIndex,
      topPad,
      cssW: viewW,
      cssH,
      deviceW: Math.max(1, Math.round(viewW * effectiveDpr)),
      deviceH: Math.max(1, Math.round(cssH * effectiveDpr)),
    });
  }

  const items = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    items.push({
      index: i,
      row,
      col,
      x: PAD + col * (tileW + GAP),
      y: PAD + row * (TILE_H + GAP),
      w: tileW,
      h: TILE_H,
    });
  }

  return {
    n,
    archId,
    viewW,
    viewH: STAGE_VIEW_H,
    cols,
    rows,
    tileW,
    tileH: TILE_H,
    totalH,
    nativeDpr: targetDpr,
    effectiveDpr,
    capped,
    bands,
    items,
    budget,
  };
}
// #endregion budget-layout

export function createControlElement(index, theme, w, h, onMutate) {
  const el = document.createElement('div');
  el.className = 'ctrl-card';
  el.dataset.index = String(index);
  el.dataset.theme = theme;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;

  const initChecked = index % 3 === 0;
  const initVal = 20 + ((index * 17) % 75);
  let clicks = 0;

  el.innerHTML =
    `<div class="ctrl-head">` +
      `<span class="ctrl-id">#${String(index + 1).padStart(2, '0')}</span>` +
      `<span class="ctrl-pill">${initChecked ? 'ON' : 'OFF'}</span>` +
    `</div>` +
    `<div class="ctrl-mid">` +
      `<label class="ctrl-check"><input type="checkbox" aria-label="Toggle control ${index + 1}"${initChecked ? ' checked' : ''}><span>Active</span></label>` +
      `<button type="button" class="ctrl-bump" aria-label="Increment control ${index + 1}">+1 (0)</button>` +
    `</div>` +
    `<div class="ctrl-foot">` +
      `<input type="range" class="ctrl-range" min="0" max="100" value="${initVal}" aria-label="Level for control ${index + 1}">` +
      `<span class="ctrl-val">${initVal}%</span>` +
    `</div>`;

  const pill = el.querySelector('.ctrl-pill');
  const cb = el.querySelector('input[type="checkbox"]');
  const btn = el.querySelector('.ctrl-bump');
  const range = el.querySelector('.ctrl-range');
  const valEl = el.querySelector('.ctrl-val');

  el._state = { checked: initChecked, level: initVal / 100, clicks: 0 };

  cb.addEventListener('change', () => {
    el._state.checked = cb.checked;
    pill.textContent = cb.checked ? 'ON' : 'OFF';
    onMutate?.(index, el);
  });
  btn.addEventListener('click', () => {
    clicks++;
    el._state.clicks = clicks;
    btn.textContent = `+1 (${clicks})`;
    onMutate?.(index, el);
  });
  range.addEventListener('input', () => {
    const v = Number(range.value);
    el._state.level = v / 100;
    valEl.textContent = `${v}%`;
    onMutate?.(index, el);
  });

  return el;
}

export function applyControlTheme(el, theme) {
  el.dataset.theme = theme;
}

function drawControlChrome2D(ctx, x, y, w, h, el, theme) {
  const active = el._state?.checked;
  const level = el._state?.level ?? 0.5;
  ctx.save();
  ctx.strokeStyle = theme === 'night'
    ? (active ? 'rgba(95, 207, 127, 0.75)' : 'rgba(130, 150, 190, 0.45)')
    : (active ? 'rgba(210, 73, 31, 0.72)' : 'rgba(110, 102, 92, 0.35)');
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
  // Subtle bottom level meter drawn on the canvas over the control border.
  const barW = Math.max(2, (w - 8) * level);
  ctx.fillStyle = theme === 'night' ? 'rgba(95, 190, 255, 0.65)' : 'rgba(210, 73, 31, 0.55)';
  ctx.fillRect(x + 4, y + h - 3.5, barW, 2.5);
  ctx.restore();
}

function retireCanvas(canvas) {
  if (!canvas) return;
  try {
    if (canvas.width !== 0) canvas.width = 0;
    if (canvas.height !== 0) canvas.height = 0;
  } catch {}
  canvas.remove();
  window.__gfx?.retire(canvas);
}

export function readMemoryMB() {
  const m = window.__gfx?.memory?.();
  if (!m) return { mb: 0, bytes: 0, canvases: 0, largestMP: 0 };
  return {
    mb: m.bytes / 1e6,
    bytes: m.bytes,
    canvases: m.canvases,
    largestMP: m.largest / 1e6,
  };
}

// #region per-element-budgeted
export class FrameBudgetScheduler {
  constructor({ budgetMs = FRAME_BUDGET_MS, onDispatch } = {}) {
    this.budgetMs = budgetMs;
    this.onDispatch = onDispatch;
    this.queue = [];
    this.queuedSet = new Set();
    this.rafId = 0;
    this.emaCostMs = 1.2;
    this.framesUsed = 0;
    this.dispatchedTotal = 0;
    this._waiters = [];
    this._stopped = false;
  }

  enqueue(id) {
    if (this._stopped || this.queuedSet.has(id)) return;
    this.queuedSet.add(id);
    this.queue.push(id);
    if (!this.rafId) this.rafId = requestAnimationFrame(() => this.#tick());
  }

  remove(id) {
    if (!this.queuedSet.has(id)) return;
    this.queuedSet.delete(id);
    const idx = this.queue.indexOf(id);
    if (idx >= 0) this.queue.splice(idx, 1);
  }

  recordPaintCost(ms) {
    if (Number.isFinite(ms) && ms > 0) {
      const clamped = Math.min(20, Math.max(0.15, ms));
      this.emaCostMs = this.emaCostMs * 0.7 + clamped * 0.3;
    }
  }

  get pending() {
    return this.queue.length;
  }

  whenIdle() {
    if (!this.queue.length && !this.rafId) return Promise.resolve();
    return new Promise((resolve) => this._waiters.push(resolve));
  }

  stop() {
    this._stopped = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.queue.length = 0;
    this.queuedSet.clear();
    for (const r of this._waiters.splice(0)) r();
  }

  #tick() {
    this.rafId = 0;
    if (this._stopped) return;
    const frameStart = performance.now();
    // Account for both JS dispatch cost and the deferred paint event cost via emaCostMs.
    const maxItems = Math.max(1, Math.min(8, Math.floor(this.budgetMs / Math.max(0.4, this.emaCostMs))));
    let count = 0;
    while (this.queue.length > 0 && count < maxItems) {
      const elapsed = performance.now() - frameStart;
      if (count > 0 && elapsed >= this.budgetMs) break;
      const id = this.queue.shift();
      this.queuedSet.delete(id);
      this.onDispatch(id);
      count++;
      this.dispatchedTotal++;
    }
    if (count > 0) this.framesUsed++;
    if (this.queue.length > 0) {
      this.rafId = requestAnimationFrame(() => this.#tick());
    } else {
      for (const r of this._waiters.splice(0)) r();
    }
  }
}
// #endregion per-element-budgeted

// #region shared-2d
function mountShared2D(viewport, layout, theme, onStatus) {
  const wrap = document.createElement('div');
  wrap.className = 'arch-bands';
  wrap.style.width = `${layout.viewW}px`;

  const bands = [];
  const controls = new Array(layout.n);
  let activeTheme = theme;
  let paintCount = 0;
  let pendingPaintResolvers = new Map();

  for (const b of layout.bands) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    canvas.className = 'band-canvas';
    canvas.style.width = `${b.cssW}px`;
    canvas.style.height = `${b.cssH}px`;
    canvas.width = b.deviceW;
    canvas.height = b.deviceH;

    const ctx = canvas.getContext('2d');
    const slice = [];

    for (let i = b.startIndex; i < b.endIndex; i++) {
      const item = layout.items[i];
      const localY = b.topPad + (item.row - b.startRow) * (layout.tileH + GAP);
      const el = createControlElement(i, activeTheme, item.w, item.h, () => {
        canvas.requestPaint?.();
      });
      el.style.position = 'absolute';
      el.style.left = `${item.x}px`;
      el.style.top = `${localY}px`;
      canvas.append(el);
      controls[i] = el;
      slice.push({ el, x: item.x, y: localY, w: item.w, h: item.h });
    }

    const onLost = () => onStatus?.('A 2D band canvas lost its context. It will redraw when restored.', true);
    const onRestored = () => {
      onStatus?.('', false);
      canvas.requestPaint?.();
    };
    canvas.addEventListener('contextlost', onLost);
    canvas.addEventListener('contextrestored', onRestored);

    const bandState = { canvas, ctx, slice, info: b, painted: false, onLost, onRestored };

    canvas.addEventListener('paint', () => {
      if (!ctx) return;
      if (canvas.width !== b.deviceW || canvas.height !== b.deviceH) {
        canvas.width = b.deviceW;
        canvas.height = b.deviceH;
      }
      ctx.reset();
      ctx.scale(layout.effectiveDpr, layout.effectiveDpr);
      ctx.clearRect(0, 0, b.cssW, b.cssH);
      for (const s of slice) {
        ctx.drawElementImage(s.el, s.x, s.y, s.el.offsetWidth || s.w, s.el.offsetHeight || s.h);
        drawControlChrome2D(ctx, s.x, s.y, s.w, s.h, s.el, activeTheme);
      }
      bandState.painted = true;
      paintCount++;
      const resolve = pendingPaintResolvers.get(b.bandIndex);
      if (resolve) {
        pendingPaintResolvers.delete(b.bandIndex);
        resolve();
      }
    });

    wrap.append(canvas);
    bands.push(bandState);
  }

  viewport.replaceChildren(wrap);
  for (const b of bands) b.canvas.requestPaint?.();

  return {
    id: 'shared-2d',
    layout,
    controls,
    get canvases() { return bands.map((b) => b.canvas); },
    get bandCount() { return bands.length; },
    get extraGpuMB() { return 0; },
    get paintCount() { return paintCount; },
    async waitInitialPaint() {
      await waitBandPaints(bands, pendingPaintResolvers, 900, true);
    },
    async triggerThemeSwitch(nextTheme) {
      activeTheme = nextTheme;
      for (const el of controls) applyControlTheme(el, nextTheme);
      const wait = waitBandPaints(bands, pendingPaintResolvers, 1500, false);
      for (const b of bands) b.canvas.requestPaint?.();
      const painted = await wait;
      return { paintedBands: painted, totalBands: bands.length, paintedControls: layout.n };
    },
    destroy() {
      pendingPaintResolvers.clear();
      for (const b of bands) {
        b.canvas.removeEventListener('contextlost', b.onLost);
        b.canvas.removeEventListener('contextrestored', b.onRestored);
        retireCanvas(b.canvas);
      }
      wrap.remove();
    },
  };
}

function waitBandPaints(bands, map, timeoutMs, skipAlreadyPainted = false) {
  return new Promise((resolve) => {
    let remaining = 0;
    let done = 0;
    const toWait = [];
    for (const b of bands) {
      if (skipAlreadyPainted && b.painted) {
        done++;
      } else {
        remaining++;
        toWait.push(b);
      }
    }
    if (remaining === 0) { resolve(done); return; }
    const timer = setTimeout(() => {
      for (const b of toWait) map.delete(b.info.bandIndex);
      resolve(done);
    }, timeoutMs);
    for (const b of toWait) {
      map.set(b.info.bandIndex, () => {
        done++;
        if (--remaining <= 0) {
          clearTimeout(timer);
          resolve(done);
        }
      });
    }
  });
}
// #endregion shared-2d

// #region shared-webgl
function mountSharedWebGL(viewport, layout, theme, onStatus) {
  if (!glSupported) {
    const note = document.createElement('div');
    note.className = 'arch-fallback';
    note.textContent = 'WebGL 2 texElementSubImage2D() is not available in this browser, so Architecture 2 could not start.';
    viewport.replaceChildren(note);
    return {
      id: 'shared-webgl',
      unavailable: true,
      layout,
      controls: [],
      canvases: [],
      bandCount: 0,
      extraGpuMB: 0,
      paintCount: 0,
      async waitInitialPaint() {},
      async triggerThemeSwitch() { return { paintedControls: 0, skipped: true }; },
      destroy() { note.remove(); },
    };
  }

  const spacer = document.createElement('div');
  spacer.className = 'gl-spacer';
  spacer.style.width = `${layout.viewW}px`;
  spacer.style.height = `${Math.max(layout.viewH, layout.totalH)}px`;
  spacer.style.position = 'relative';

  const canvas = document.createElement('canvas');
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  canvas.className = 'gl-sticky-canvas';
  canvas.style.width = `${layout.viewW}px`;
  canvas.style.height = `${layout.viewH}px`;

  const controls = new Array(layout.n);
  const dirty = new Set();
  const uploaded = new Set();
  const lastGeo = new WeakMap();
  let activeTheme = theme;
  let paintCount = 0;
  let uploadCount = 0;
  let uploadAllNext = false;
  let pendingResolve = null;

  for (const item of layout.items) {
    const el = createControlElement(item.index, activeTheme, item.w, item.h, () => {
      dirty.add(el);
      canvas.requestPaint?.();
    });
    el.style.position = 'absolute';
    el.style.left = '0px';
    el.style.top = '0px';
    canvas.append(el);
    controls[item.index] = el;
    dirty.add(el);
  }

  spacer.append(canvas);
  viewport.replaceChildren(spacer);

  let stage = null;
  try {
    stage = new ElementGL(canvas, {
      fragment: WEBGL_FRAGMENT,
      onLost: () => onStatus?.('The shared WebGL context was lost. It will rebuild when restored.', true),
      onRestored: () => {
        onStatus?.('', false);
        uploaded.clear();
        for (const el of controls) dirty.add(el);
        canvas.requestPaint?.();
      },
    });
  } catch (err) {
    onStatus?.(`WebGL could not start (${err.message}).`, true);
  }

  function syncGeo(el, x, y, unit) {
    const key = `${Math.round(x)},${Math.round(y)},${unit.toFixed(3)}`;
    if (lastGeo.get(el) === key) return;
    lastGeo.set(el, key);
    canvas.updateElementGeometry?.(el, {
      canvasTransform: new DOMMatrix().scale(unit).translate(x, y),
    });
    el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
  }

  const onPaint = (e) => {
    if (!stage || stage.lost) return;
    const changed = e.changedElements ?? [];
    for (const el of changed) dirty.add(el);

    const scrollTop = viewport.scrollTop;
    const visMin = scrollTop - layout.tileH;
    const visMax = scrollTop + layout.viewH + layout.tileH;

    // Upload dirty visible elements (or every dirty control during a bulk theme switch).
    for (let i = 0; i < layout.n; i++) {
      const item = layout.items[i];
      const el = controls[i];
      const inView = item.y + item.h >= visMin && item.y <= visMax;
      if ((uploadAllNext && dirty.has(el)) || (inView && (dirty.has(el) || !stage.has(el)))) {
        const tex = stage.upload(el);
        if (tex) {
          dirty.delete(el);
          uploaded.add(el);
          uploadCount++;
        }
      }
    }
    uploadAllNext = false;

    const clear = activeTheme === 'night' ? [0.09, 0.1, 0.12, 1] : [0.96, 0.95, 0.93, 1];
    if (!stage.begin(clear)) return;

    const themeFloat = activeTheme === 'night' ? 1.0 : 0.0;
    const sampleEl = controls[0];
    const unit = sampleEl ? geometryUnit(canvas, sampleEl, layout.tileW) : 1;

    for (let i = 0; i < layout.n; i++) {
      const item = layout.items[i];
      const el = controls[i];
      const yView = item.y - scrollTop;
      const inView = yView + item.h >= -8 && yView <= layout.viewH + 8;
      if (inView && stage.has(el)) {
        el.inert = false;
        const level = el._state?.level ?? 0.5;
        stage.quad(el, ElementGL.rect(canvas, item.x, yView, item.w, item.h), (gl, uniform) => {
          gl.uniform1f(uniform('uTheme'), themeFloat);
          gl.uniform1f(uniform('uLevel'), level);
        });
        syncGeo(el, item.x, yView, unit);
      } else {
        el.inert = true;
      }
    }

    paintCount++;
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r();
    }
  };

  canvas.addEventListener('paint', onPaint);
  const onScroll = () => canvas.requestPaint?.();
  viewport.addEventListener('scroll', onScroll, { passive: true });
  canvas.requestPaint?.();

  function waitNextPaint(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        if (pendingResolve) { pendingResolve = null; resolve(false); }
      }, timeoutMs);
      pendingResolve = () => { clearTimeout(t); resolve(true); };
    });
  }

  return {
    id: 'shared-webgl',
    layout,
    controls,
    get canvases() { return [canvas]; },
    get bandCount() { return 1; },
    get extraGpuMB() {
      // Estimate RGBA8 texture memory held inside ElementGL for uploaded controls.
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      return (uploaded.size * layout.tileW * layout.tileH * dpr * dpr * 4) / 1e6;
    },
    get paintCount() { return paintCount; },
    get uploadCount() { return uploadCount; },
    async waitInitialPaint() {
      await waitNextPaint(900);
    },
    async triggerThemeSwitch(nextTheme) {
      activeTheme = nextTheme;
      const beforeUploads = uploadCount;
      for (const el of controls) {
        applyControlTheme(el, nextTheme);
        dirty.add(el);
      }
      uploadAllNext = true;
      const wait = waitNextPaint(1800);
      canvas.requestPaint?.();
      await wait;
      return { paintedControls: uploadCount - beforeUploads };
    },
    destroy() {
      viewport.removeEventListener('scroll', onScroll);
      canvas.removeEventListener('paint', onPaint);
      pendingResolve = null;
      stage?.dispose();
      stage = null;
      retireCanvas(canvas);
      spacer.remove();
    },
  };
}
// #endregion shared-webgl

// #region per-element-live
function mountPerElementLive(viewport, layout, theme, onStatus) {
  const grid = document.createElement('div');
  grid.className = 'arch-grid';
  grid.style.width = `${layout.viewW}px`;
  grid.style.padding = `${PAD}px`;
  grid.style.gap = `${GAP}px`;
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, ${layout.tileW}px)`;

  const bw = Math.max(1, Math.round(layout.tileW * layout.effectiveDpr));
  const bh = Math.max(1, Math.round(layout.tileH * layout.effectiveDpr));

  const cells = [];
  const controls = new Array(layout.n);
  let activeTheme = theme;
  let paintCount = 0;
  let switchTracker = null;

  for (let i = 0; i < layout.n; i++) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    canvas.className = 'cell-canvas';
    canvas.style.width = `${layout.tileW}px`;
    canvas.style.height = `${layout.tileH}px`;
    canvas.width = bw;
    canvas.height = bh;

    const ctx = canvas.getContext('2d');
    const el = createControlElement(i, activeTheme, layout.tileW, layout.tileH, () => {
      canvas.requestPaint?.();
    });
    el.style.width = `${layout.tileW}px`;
    el.style.height = `${layout.tileH}px`;
    canvas.append(el);
    controls[i] = el;

    const onLost = () => onStatus?.('A per-element 2D canvas lost its context.', true);
    const onRestored = () => { onStatus?.('', false); canvas.requestPaint?.(); };
    canvas.addEventListener('contextlost', onLost);
    canvas.addEventListener('contextrestored', onRestored);

    const cell = { index: i, canvas, ctx, el, onLost, onRestored };
    canvas.addEventListener('paint', () => {
      if (!ctx) return;
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.reset();
      ctx.scale(layout.effectiveDpr, layout.effectiveDpr);
      ctx.clearRect(0, 0, layout.tileW, layout.tileH);
      ctx.drawElementImage(el, 0, 0, el.offsetWidth || layout.tileW, el.offsetHeight || layout.tileH);
      drawControlChrome2D(ctx, 0, 0, layout.tileW, layout.tileH, el, activeTheme);
      paintCount++;
      switchTracker?.onPaint(i);
    });

    grid.append(canvas);
    cells.push(cell);
  }

  viewport.replaceChildren(grid);
  for (const c of cells) c.canvas.requestPaint?.();

  function waitCells(timeoutMs = 1500) {
    return new Promise((resolve) => {
      const seen = new Set();
      let quietFrames = 0;
      let lastSeen = 0;
      const visibleLimit = Math.min(layout.n, (Math.ceil(layout.viewH / (layout.tileH + GAP)) + 1) * layout.cols);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        switchTracker = null;
        clearTimeout(timer);
        resolve(seen.size);
      };
      const timer = setTimeout(finish, timeoutMs);
      switchTracker = {
        onPaint(idx) {
          seen.add(idx);
          if (seen.size >= layout.n) finish();
        },
      };
      const checkQuiet = () => {
        if (done) return;
        if (seen.size >= visibleLimit && seen.size === lastSeen) {
          if (++quietFrames >= 2) { finish(); return; }
        } else {
          quietFrames = 0;
          lastSeen = seen.size;
        }
        requestAnimationFrame(checkQuiet);
      };
      requestAnimationFrame(checkQuiet);
    });
  }

  return {
    id: 'per-element-live',
    layout,
    controls,
    get canvases() { return cells.map((c) => c.canvas); },
    get bandCount() { return cells.length; },
    get extraGpuMB() { return 0; },
    get paintCount() { return paintCount; },
    async waitInitialPaint() {
      await waitCells(800);
    },
    async triggerThemeSwitch(nextTheme) {
      activeTheme = nextTheme;
      for (const el of controls) applyControlTheme(el, nextTheme);
      const wait = waitCells(1800);
      for (const c of cells) c.canvas.requestPaint?.();
      const painted = await wait;
      return { paintedControls: painted };
    },
    destroy() {
      switchTracker = null;
      for (const c of cells) {
        c.canvas.removeEventListener('contextlost', c.onLost);
        c.canvas.removeEventListener('contextrestored', c.onRestored);
        retireCanvas(c.canvas);
      }
      grid.remove();
    },
  };
}
// #endregion per-element-live

function mountPerElementBudgeted(viewport, layout, theme, onStatus) {
  const grid = document.createElement('div');
  grid.className = 'arch-grid';
  grid.style.width = `${layout.viewW}px`;
  grid.style.padding = `${PAD}px`;
  grid.style.gap = `${GAP}px`;
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, ${layout.tileW}px)`;

  const bw = Math.max(1, Math.round(layout.tileW * layout.effectiveDpr));
  const bh = Math.max(1, Math.round(layout.tileH * layout.effectiveDpr));

  const cells = [];
  const controls = new Array(layout.n);
  let activeTheme = theme;
  let paintCount = 0;
  let evictions = 0;
  let allocations = 0;
  let switchSeen = null;

  const scheduler = new FrameBudgetScheduler({
    budgetMs: FRAME_BUDGET_MS,
    onDispatch(idx) {
      const c = cells[idx];
      if (!c || !c.visible) return;
      if (c.canvas.width !== bw || c.canvas.height !== bh) {
        c.canvas.width = bw;
        c.canvas.height = bh;
        allocations++;
      }
      c.evicted = false;
      c.dirty = false;
      c.dispatchedAt = performance.now();
      c.canvas.requestPaint?.();
    },
  });

  for (let i = 0; i < layout.n; i++) {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    canvas.className = 'cell-canvas';
    canvas.style.width = `${layout.tileW}px`;
    canvas.style.height = `${layout.tileH}px`;
    // Start evicted at 0x0 until IntersectionObserver reports the tile near the viewport.
    canvas.width = 0;
    canvas.height = 0;

    const ctx = canvas.getContext('2d');
    const el = createControlElement(i, activeTheme, layout.tileW, layout.tileH, () => {
      cell.dirty = true;
      if (cell.visible) scheduler.enqueue(i);
    });
    el.style.width = `${layout.tileW}px`;
    el.style.height = `${layout.tileH}px`;
    canvas.append(el);
    controls[i] = el;

    const onLost = () => onStatus?.('A budgeted 2D canvas lost its context.', true);
    const onRestored = () => {
      onStatus?.('', false);
      if (cell.visible) scheduler.enqueue(i);
    };
    canvas.addEventListener('contextlost', onLost);
    canvas.addEventListener('contextrestored', onRestored);

    const cell = {
      index: i,
      canvas,
      ctx,
      el,
      visible: false,
      evicted: true,
      dirty: true,
      dispatchedAt: 0,
      onLost,
      onRestored,
    };

    canvas.addEventListener('paint', () => {
      if (!ctx || !cell.visible || canvas.width === 0 || canvas.height === 0) return;
      const t0 = performance.now();
      ctx.reset();
      ctx.scale(layout.effectiveDpr, layout.effectiveDpr);
      ctx.clearRect(0, 0, layout.tileW, layout.tileH);
      ctx.drawElementImage(el, 0, 0, el.offsetWidth || layout.tileW, el.offsetHeight || layout.tileH);
      drawControlChrome2D(ctx, 0, 0, layout.tileW, layout.tileH, el, activeTheme);
      const dt = performance.now() - t0;
      scheduler.recordPaintCost(dt + 0.35);
      paintCount++;
      switchSeen?.add(i);
    });

    grid.append(canvas);
    cells.push(cell);
  }

  viewport.replaceChildren(grid);

  // #region per-element-budgeted
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const idx = Number(entry.target.dataset.cellIdx);
        const c = cells[idx];
        if (!c) continue;
        if (entry.isIntersecting) {
          c.visible = true;
          c.el.inert = false;
          if (c.evicted || c.dirty || c.canvas.width === 0) {
            scheduler.enqueue(idx);
          }
        } else {
          c.visible = false;
          c.el.inert = true;
          scheduler.remove(idx);
          if (c.canvas.width !== 0 || c.canvas.height !== 0) {
            c.canvas.width = 0;
            c.canvas.height = 0;
            c.evicted = true;
            c.dirty = true;
            evictions++;
          }
        }
      }
    },
    { root: viewport, rootMargin: '120px 0px' }
  );
  // #endregion per-element-budgeted

  for (const c of cells) {
    c.canvas.dataset.cellIdx = String(c.index);
    io.observe(c.canvas);
  }

  // Also seed currently visible rows synchronously so mount measurement sees the initial batch immediately.
  const seedLimit = Math.min(layout.n, (Math.ceil((layout.viewH + 120) / (layout.tileH + GAP)) + 1) * layout.cols);
  for (let i = 0; i < seedLimit; i++) {
    cells[i].visible = true;
    cells[i].el.inert = false;
    scheduler.enqueue(i);
  }

  return {
    id: 'per-element-budgeted',
    layout,
    controls,
    get canvases() { return cells.map((c) => c.canvas); },
    get bandCount() { return cells.filter((c) => c.canvas.width > 0).length; },
    get extraGpuMB() { return 0; },
    get paintCount() { return paintCount; },
    get evictions() { return evictions; },
    get allocations() { return allocations; },
    async waitInitialPaint() {
      await scheduler.whenIdle();
      await nextFrames(2);
    },
    async triggerThemeSwitch(nextTheme) {
      activeTheme = nextTheme;
      switchSeen = new Set();
      const startFrames = scheduler.framesUsed;
      for (const c of cells) {
        applyControlTheme(c.el, nextTheme);
        c.dirty = true;
        if (c.visible) scheduler.enqueue(c.index);
      }
      await scheduler.whenIdle();
      await nextFrames(2);
      const painted = switchSeen.size;
      switchSeen = null;
      return { paintedControls: painted, framesSpread: scheduler.framesUsed - startFrames };
    },
    destroy() {
      scheduler.stop();
      io.disconnect();
      for (const c of cells) {
        c.canvas.removeEventListener('contextlost', c.onLost);
        c.canvas.removeEventListener('contextrestored', c.onRestored);
        retireCanvas(c.canvas);
      }
      grid.remove();
    },
  };
}

function mountPlainFallback(viewport, layout, theme) {
  const grid = document.createElement('div');
  grid.className = 'arch-grid';
  grid.style.width = `${layout.viewW}px`;
  grid.style.padding = `${PAD}px`;
  grid.style.gap = `${GAP}px`;
  grid.style.gridTemplateColumns = `repeat(${layout.cols}, ${layout.tileW}px)`;

  const controls = [];
  for (let i = 0; i < layout.n; i++) {
    const el = createControlElement(i, theme, layout.tileW, layout.tileH);
    grid.append(el);
    controls.push(el);
  }
  viewport.replaceChildren(grid);

  return {
    id: 'plain',
    unavailable: true,
    layout,
    controls,
    canvases: [],
    bandCount: 0,
    extraGpuMB: 0,
    paintCount: 0,
    async waitInitialPaint() { await nextFrames(1); },
    async triggerThemeSwitch(nextTheme) {
      for (const el of controls) applyControlTheme(el, nextTheme);
      await nextFrames(2);
      return { paintedControls: controls.length };
    },
    destroy() { grid.remove(); },
  };
}

export function mountArchitecture(archId, n, viewport, theme, onStatus) {
  viewport.scrollTop = 0;
  const layout = computeLayout(n, viewport.clientWidth - 18, window.devicePixelRatio || 1, archId);
  if (!canvasSupported) {
    return mountPlainFallback(viewport, layout, theme);
  }
  if (archId === 'shared-2d') return mountShared2D(viewport, layout, theme, onStatus);
  if (archId === 'shared-webgl') return mountSharedWebGL(viewport, layout, theme, onStatus);
  if (archId === 'per-element-live') return mountPerElementLive(viewport, layout, theme, onStatus);
  return mountPerElementBudgeted(viewport, layout, theme, onStatus);
}

// #region measurements
export function nextFrames(count = 1) {
  return new Promise((resolve) => {
    let left = count;
    const step = () => {
      if (--left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

function createLoafTracker() {
  let count = 0;
  let maxMs = 0;
  let supported = false;
  let observer = null;
  if (typeof PerformanceObserver !== 'undefined') {
    try {
      const types = PerformanceObserver.supportedEntryTypes || [];
      if (types.includes('long-animation-frame')) {
        supported = true;
        observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            count++;
            if (entry.duration > maxMs) maxMs = entry.duration;
          }
        });
        observer.observe({ type: 'long-animation-frame', buffered: false });
      }
    } catch {}
  }
  return {
    stop() {
      observer?.disconnect();
      return { supported, count, maxMs };
    },
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
  return sorted[idx];
}

export async function measureMount(archId, n, viewport, theme, onStatus) {
  const loaf = createLoafTracker();
  const t0 = performance.now();
  const handle = mountArchitecture(archId, n, viewport, theme, onStatus);
  await handle.waitInitialPaint();
  await nextFrames(1);
  const mountMs = performance.now() - t0;
  const mem = readMemoryMB();
  const loafRes = loaf.stop();
  return {
    handle,
    mountMs,
    memMB: mem.mb,
    extraGpuMB: handle.extraGpuMB,
    canvases: mem.canvases,
    largestMP: mem.largestMP,
    loaf: loafRes,
  };
}

export async function measureBulkThemeSwitch(handle, nextTheme) {
  const loaf = createLoafTracker();
  const frameDts = [];
  let peakMB = readMemoryMB().mb;
  let running = true;
  let lastT = performance.now();

  const pump = (now) => {
    const dt = now - lastT;
    lastT = now;
    if (dt > 0 && dt < 10_000) frameDts.push(dt);
    const cur = readMemoryMB().mb;
    if (cur > peakMB) peakMB = cur;
    if (running) requestAnimationFrame(pump);
  };
  requestAnimationFrame(pump);

  const t0 = performance.now();
  const detail = await handle.triggerThemeSwitch(nextTheme);
  await nextFrames(2);
  const wallMs = performance.now() - t0;
  running = false;
  await nextFrames(1);

  const loafRes = loaf.stop();
  const worstGapMs = frameDts.length ? Math.max(...frameDts) : wallMs;
  let missedFrames = 0;
  for (const dt of frameDts) {
    if (dt > 24) missedFrames += Math.max(1, Math.round(dt / 16.667) - 1);
  }
  const curMem = readMemoryMB().mb;
  if (curMem > peakMB) peakMB = curMem;

  return {
    wallMs,
    worstGapMs,
    missedFrames,
    peakMB,
    extraGpuMB: handle.extraGpuMB,
    loaf: loafRes,
    detail,
  };
}

export async function measureScrollPass(viewport, handle, { durationMs = 1200 } = {}) {
  const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  const loaf = createLoafTracker();
  const frameDts = [];
  let peakMB = readMemoryMB().mb;

  // Scroll only the internal container, never window.scrollTo() or scrollIntoView().
  viewport.scrollTop = 0;
  await nextFrames(2);

  const runDuration = maxScroll > 4 ? durationMs : 450;
  const start = performance.now();
  let last = start;

  await new Promise((resolve) => {
    const step = (now) => {
      const dt = now - last;
      last = now;
      if (dt > 0 && dt < 10_000) frameDts.push(dt);
      const t = Math.min(1, (now - start) / runDuration);
      if (maxScroll > 4) {
        // Out-and-back triangle sweep across the entire scrollable container.
        const pos = t < 0.5 ? t * 2 : (1 - t) * 2;
        viewport.scrollTop = Math.round(pos * maxScroll);
      }
      const cur = readMemoryMB().mb;
      if (cur > peakMB) peakMB = cur;
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        viewport.scrollTop = 0;
        resolve();
      }
    };
    requestAnimationFrame(step);
  });

  await nextFrames(2);
  const loafRes = loaf.stop();
  const sorted = frameDts.slice().sort((a, b) => a - b);
  const p50Dt = percentile(sorted, 0.5) || 16.67;
  const p95Dt = percentile(sorted, 0.95) || p50Dt;
  const worstGapMs = sorted.length ? sorted[sorted.length - 1] : 0;

  return {
    maxScroll,
    frames: frameDts.length,
    p50Fps: 1000 / Math.max(1, p50Dt),
    p95Fps: 1000 / Math.max(1, p95Dt),
    p50Ms: p50Dt,
    p95Ms: p95Dt,
    worstGapMs,
    peakMB,
    extraGpuMB: handle.extraGpuMB,
    loaf: loafRes,
  };
}
// #endregion measurements

export function formatMarkdownReport(rows, env) {
  const lines = [
    `# One canvas vs many (/perf-architecture/)`,
    ``,
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    `- Browser: ${env.ua}`,
    `- Screen: ${env.screen}, viewport width ${env.viewW} CSS px, DPR ${env.dpr}, cores ${env.cores}`,
    `- Budget caps: ${env.maxCanvasMP.toFixed(1)} MP per canvas, ${env.maxTotalMB.toFixed(0)} MB total`,
    ``,
    `| Architecture | N | Mount (ms) | Peak canvas MB | WebGL tex MB | Theme wall (ms) | Missed frames | Worst rAF (ms) | Scroll FPS p50 / p95-tail | LoAFs (max ms) |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|`,
  ];
  for (const r of rows) {
    if (r.unavailable) {
      lines.push(`| ${r.archShort} | ${r.n} | n/a | n/a | n/a | n/a | n/a | n/a | n/a | unavailable |`);
      continue;
    }
    const scrollStr = r.scroll.maxScroll > 4
      ? `${r.scroll.p50Fps.toFixed(0)} / ${r.scroll.p95Fps.toFixed(0)}`
      : `${r.scroll.p50Fps.toFixed(0)} / ${r.scroll.p95Fps.toFixed(0)} (fits)`;
    const loafTotal = r.mountLoaf.count + r.theme.loaf.count + r.scroll.loaf.count;
    const loafMax = Math.max(r.mountLoaf.maxMs, r.theme.loaf.maxMs, r.scroll.loaf.maxMs);
    const loafStr = r.theme.loaf.supported
      ? `${loafTotal} (${loafMax > 0 ? loafMax.toFixed(0) : '0'})`
      : 'n/a';
    lines.push(
      `| ${r.archShort} | ${r.n} | ${r.mountMs.toFixed(1)} | ${r.peakMB.toFixed(1)} | ${r.extraGpuMB > 0 ? r.extraGpuMB.toFixed(1) : '0.0'} | ${r.theme.wallMs.toFixed(1)} | ${r.theme.missedFrames} | ${Math.max(r.theme.worstGapMs, r.scroll.worstGapMs).toFixed(1)} | ${scrollStr} | ${loafStr} |`
    );
  }
  return lines.join('\n');
}
