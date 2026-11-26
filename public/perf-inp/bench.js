// Input latency (INP) and updateElementGeometry() hit-test overhead benchmark.
//
// Exports:
//   createArena(...)        interactive moving-controls arena (DOM, 2D, WebGL stale, WebGL cache-bust)
//   createInpRecorder(...)  Event Timing INP phase recorder + visual hit-accuracy tracker
//   runOverheadSweep(...)   automated 1..200 control sweep for JS cost, LoAFs and hit-test drift
//   formatMarkdownReport()  Markdown table for findings or bug reports
//   buildLiveChecks(...)    isolated fixture checks for runTests()

import { supported, nextPaint, testStage } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

export const MODES = [
  { id: 'dom', label: 'Plain DOM', short: 'DOM (CSS transform)' },
  { id: '2d', label: '2D drawElementImage()', short: '2D canvas' },
  { id: 'gl-stale', label: 'WebGL + geometry', short: 'WebGL (no cache bust)' },
  { id: 'gl-bust', label: 'WebGL + geometry + cache bust', short: 'WebGL + toggleAttribute' },
];

export const COUNTS = [1, 12, 50, 100, 200];

const MAX_AREA = 3_900_000;
const MAX_DIM = 4096;

const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uPulse;
uniform float uKind;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUv);
  // Subtle border pulse when a control is tapped or dragged so WebGL feedback is clear.
  float edgeX = min(vUv.x, 1.0 - vUv.x) * uSize.x;
  float edgeY = min(vUv.y, 1.0 - vUv.y) * uSize.y;
  float border = 1.0 - smoothstep(1.0, 3.0, min(edgeX, edgeY));
  vec3 tint = uKind > 0.5 ? vec3(0.12, 0.48, 0.23) : vec3(0.82, 0.29, 0.12);
  float glow = clamp(uPulse * 0.55 + border * (0.14 + uPulse * 0.45), 0.0, 0.75);
  vec3 rgb = mix(c.rgb, tint * c.a, glow);
  outColor = vec4(rgb, c.a);
}`;

const raf = () => new Promise((r) => requestAnimationFrame(r));

export function percentile(values, p) {
  const s = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

export function median(values) {
  const s = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.floor(s.length / 2)];
}

export function fmtMs(val) {
  return val == null || !Number.isFinite(val) ? '-' : `${val.toFixed(1)} ms`;
}

function sizeCanvas2D(canvas, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let w = Math.max(1, Math.round(cssW * dpr));
  let h = Math.max(1, Math.round(cssH * dpr));
  const k = Math.min(1, MAX_DIM / w, MAX_DIM / h, Math.sqrt(MAX_AREA / (w * h)));
  if (k < 1) {
    w = Math.max(1, Math.floor(w * k));
    h = Math.max(1, Math.floor(h * k));
  }
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return Math.min(w / Math.max(1, cssW), h / Math.max(1, cssH));
}

function chipMetrics(count, stageW) {
  if (count <= 12) return { w: Math.min(92, Math.floor((stageW - 24) / 3)), h: 40, cls: 'sz-lg' };
  if (count <= 50) return { w: 66, h: 32, cls: 'sz-md' };
  if (count <= 100) return { w: 54, h: 28, cls: 'sz-sm' };
  return { w: 46, h: 24, cls: 'sz-xs' };
}

function makeControlElements(count, chip, asDrawable) {
  const items = [];
  for (let i = 0; i < count; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `arena-btn ${chip.cls}`;
    btn.dataset.idx = String(i);
    btn.style.width = `${chip.w}px`;
    btn.style.height = `${chip.h}px`;
    if (asDrawable) btn.setAttribute('drawable', '');
    btn.textContent = `#${i + 1} · 0`;
    items.push({
      kind: 'button',
      idx: i,
      el: btn,
      w: chip.w,
      h: chip.h,
      clicks: 0,
      x: 12,
      y: 12,
      phase: i * 0.73,
      speedX: 0.45 + (i % 7) * 0.11,
      speedY: 0.35 + (i % 5) * 0.13,
      pulseAt: -1e9,
      dirty: true,
      dragged: false,
    });
  }
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'arena-input';
  input.setAttribute('aria-label', 'Moving text input inside the test arena');
  input.placeholder = 'Tap and type while moving';
  input.autocomplete = 'off';
  input.spellcheck = false;
  if (asDrawable) input.setAttribute('drawable', '');
  const inputW = Math.min(250, Math.max(160, 220));
  items.push({
    kind: 'input',
    idx: count,
    el: input,
    w: inputW,
    h: 40,
    clicks: 0,
    x: 16,
    y: 240,
    phase: 0,
    speedX: 0.42,
    speedY: 0,
    pulseAt: -1e9,
    dirty: true,
    dragged: false,
  });
  return items;
}

export function createArena(stageEl, noticeEl, { onModeChange, onFrameStats, onHitProbe }) {
  let mode = supported ? '2d' : 'dom';
  let count = 12;
  let paused = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let suspended = false;
  let onScreen = true;
  let items = [];
  let canvas = null;
  let ctx2d = null;
  let glStage = null;
  let domLayer = null;
  let scale2d = 1;
  let geomUnit = 1;
  let geomUnitKey = '';
  let rafId = 0;
  let lastNow = 0;
  let simTime = 0;
  let dragItem = null;
  let dragOffX = 0;
  let dragOffY = 0;
  let dragMoved = false;
  let markers = [];
  let frameCostSamples = [];
  let frameIntervalSamples = [];
  let lastStatsEmit = 0;
  let lastPulse = -1e9;
  let paintCount = 0;
  const matPool = new Float32Array(16);

  function spawnRing(x, y, kind) {
    const ring = document.createElement('span');
    ring.className = `hit-ring ${kind}`;
    ring.style.left = `${x}px`;
    ring.style.top = `${y}px`;
    ring.textContent = kind === 'hit' ? 'hit' : kind === 'ghost' ? 'ghost' : 'miss';
    stageEl.append(ring);
    setTimeout(() => ring.remove(), 750);
  }

  function showNotice(text) {
    if (!noticeEl) return;
    if (!text) {
      noticeEl.hidden = true;
      noticeEl.textContent = '';
    } else {
      noticeEl.hidden = false;
      noticeEl.textContent = text;
    }
  }

  function retireActiveCanvas() {
    if (glStage) {
      glStage.dispose();
      glStage = null;
    }
    if (canvas) {
      const old = canvas;
      canvas = null;
      ctx2d = null;
      old.remove();
      window.__gfx?.retire?.(old);
    }
    if (domLayer) {
      domLayer.remove();
      domLayer = null;
    }
    geomUnit = 1;
    geomUnitKey = '';
  }

  function stageSize() {
    return {
      w: Math.max(200, stageEl.clientWidth || 320),
      h: Math.max(220, stageEl.clientHeight || 300),
    };
  }

  function layoutPositions(tSec) {
    const { w: sw, h: sh } = stageSize();
    const inputLaneH = 54;
    const playH = Math.max(80, sh - inputLaneH);
    const pad = 8;
    const nButtons = Math.max(1, items.length - 1);
    const cols = Math.max(1, Math.ceil(Math.sqrt(nButtons * (sw / playH))));
    const rows = Math.max(1, Math.ceil(nButtons / cols));
    const cellW = (sw - pad * 2) / cols;
    const cellH = (playH - pad * 2) / rows;
    const ampX = Math.max(10, Math.min(34, (sw - pad * 2) * 0.08));
    const ampY = Math.max(8, Math.min(22, (playH - pad * 2) * 0.08));

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === 'input') {
        const iw = Math.min(250, Math.max(150, sw - 28));
        if (it.w !== iw) {
          it.w = iw;
          it.el.style.width = `${iw}px`;
          it.dirty = true;
        }
        const travel = Math.max(0, sw - iw - pad * 2);
        const u = 0.5 + 0.5 * Math.sin(tSec * it.speedX);
        it.x = Math.round(pad + travel * u);
        it.y = Math.round(sh - it.h - 10);
        continue;
      }
      if (it.dragged) continue;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const baseX = pad + col * cellW + (cellW - it.w) * 0.5;
      const baseY = pad + row * cellH + (cellH - it.h) * 0.5;
      const dx = Math.sin(tSec * it.speedX + it.phase) * ampX;
      const dy = Math.cos(tSec * it.speedY + it.phase * 1.3) * ampY;
      it.x = Math.max(pad, Math.min(sw - it.w - pad, Math.round(baseX + dx)));
      it.y = Math.max(pad, Math.min(playH - it.h - pad, Math.round(baseY + dy)));
    }
  }

  function updateGeomUnit() {
    if (!canvas || !items.length) return 1;
    const sample = items[0];
    const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${sample.w}`;
    if (key !== geomUnitKey) {
      geomUnit = geometryUnit(canvas, sample.el, sample.w);
      geomUnitKey = key;
    }
    return geomUnit;
  }

  function attachItemListeners() {
    for (const it of items) {
      if (it.kind === 'button') {
        it.el.addEventListener('click', () => {
          if (dragMoved) return;
          it.clicks++;
          it.el.textContent = `#${it.idx + 1} · ${it.clicks}`;
          it.pulseAt = lastPulse = performance.now();
          it.dirty = true;
          canvas?.requestPaint?.();
        });
      } else {
        it.el.addEventListener('input', () => {
          it.pulseAt = lastPulse = performance.now();
          it.dirty = true;
          canvas?.requestPaint?.();
        });
        it.el.addEventListener('keydown', () => {
          it.pulseAt = lastPulse = performance.now();
          it.dirty = true;
          canvas?.requestPaint?.();
        });
      }
    }
  }

  function buildScene() {
    const wantCanvas = mode !== 'dom';
    const wantGL = mode === 'gl-stale' || mode === 'gl-bust';

    if (wantCanvas && !supported) {
      showNotice('HTML-in-canvas is not available in this browser, so the arena is running in Plain DOM mode.');
      mode = 'dom';
      onModeChange?.(mode);
    } else if (wantGL && !glSupported) {
      showNotice('WebGL texElementSubImage2D() is not available here, so the arena fell back to 2D canvas.');
      mode = '2d';
      onModeChange?.(mode);
    } else {
      showNotice('');
    }

    const { w: sw } = stageSize();
    const chip = chipMetrics(count, sw);
    const reuseGL = (mode === 'gl-stale' || mode === 'gl-bust') && glStage && !glStage.lost && canvas;

    if (reuseGL) {
      for (const old of items) {
        glStage.forget(old.el);
        old.el.remove();
      }
      items = makeControlElements(count, chip, true);
      canvas.append(...items.map((it) => it.el));
      attachItemListeners();
      geomUnitKey = '';
      layoutPositions(simTime);
      canvas.requestPaint();
      return;
    }

    retireActiveCanvas();
    items = makeControlElements(count, chip, mode !== 'dom');

    if (mode === 'dom') {
      domLayer = document.createElement('div');
      domLayer.className = 'arena-dom';
      domLayer.append(...items.map((it) => it.el));
      stageEl.append(domLayer);
      attachItemListeners();
      layoutPositions(simTime);
      drawDOM();
      return;
    }

    canvas = document.createElement('canvas');
    canvas.className = 'arena-canvas';
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', '');
    canvas.append(...items.map((it) => it.el));
    stageEl.append(canvas);
    attachItemListeners();
    layoutPositions(simTime);

    if (mode === '2d') {
      // #region arena-2d
      ctx2d = canvas.getContext('2d');
      canvas.addEventListener('contextlost', (e) => {
        e.preventDefault();
        showNotice('The 2D canvas lost its context. Controls switched to Plain DOM.');
        setMode('dom');
      });
      canvas.addEventListener('paint', () => {
        if (!ctx2d || mode !== '2d') return;
        paintCount++;
        draw2D(performance.now());
      });
      // #endregion arena-2d
      canvas.requestPaint();
      return;
    }

    // #region arena-gl
    try {
      glStage = new ElementGL(canvas, {
        fragment: FRAGMENT,
        onLost: () => {
          showNotice('WebGL context lost. Waiting for restore or switch back to 2D / Plain DOM.');
        },
        onRestored: () => {
          showNotice('');
          for (const it of items) it.dirty = true;
          canvas?.requestPaint();
        },
      });
    } catch (err) {
      showNotice(`WebGL could not start (${err.message}). Switched to 2D canvas.`);
      mode = '2d';
      onModeChange?.(mode);
      buildScene();
      return;
    }
    canvas.addEventListener('paint', (e) => {
      if (!glStage || glStage.lost) return;
      paintCount++;
      const changed = new Set(e.changedElements ?? []);
      for (const it of items) {
        if (it.dirty || changed.has(it.el) || !glStage.has(it.el)) {
          try {
            glStage.upload(it.el);
            it.dirty = false;
          } catch {}
        }
      }
      drawGL(performance.now(), false);
    });
    // #endregion arena-gl
    canvas.requestPaint();
  }

  function drawDOM() {
    const t0 = performance.now();
    for (const it of items) {
      it.el.style.transform = `translate3d(${it.x}px, ${it.y}px, 0)`;
    }
    return performance.now() - t0;
  }

  function drawMarkers2D(ctx, now) {
    markers = markers.filter((m) => now - m.at < 900);
    for (const m of markers) {
      const alpha = Math.max(0, 1 - (now - m.at) / 900);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = m.kind === 'hit' ? '#1f7a3a' : '#b3261e';
      ctx.beginPath();
      ctx.arc(m.x, m.y, 12 + (1 - alpha) * 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw2D(now) {
    if (!canvas || !ctx2d) return 0;
    const { w: sw, h: sh } = stageSize();
    scale2d = sizeCanvas2D(canvas, sw, sh);
    const t0 = performance.now();
    ctx2d.setTransform(scale2d, 0, 0, scale2d, 0, 0);
    ctx2d.clearRect(0, 0, sw, sh);

    // Subtle track line for the bottom text input lane.
    ctx2d.strokeStyle = 'rgba(128, 124, 118, 0.25)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    ctx2d.moveTo(8, sh - 54);
    ctx2d.lineTo(sw - 8, sh - 54);
    ctx2d.stroke();

    for (const it of items) {
      try {
        ctx2d.drawElementImage(it.el, it.x, it.y, it.w, it.h);
      } catch {}
      const age = now - it.pulseAt;
      if (age >= 0 && age < 450) {
        ctx2d.save();
        ctx2d.strokeStyle = it.kind === 'input' ? '#1f7a3a' : '#d2491f';
        ctx2d.globalAlpha = 1 - age / 450;
        ctx2d.lineWidth = 2;
        ctx2d.strokeRect(it.x - 2, it.y - 2, it.w + 4, it.h + 4);
        ctx2d.restore();
      }
    }
    drawMarkers2D(ctx2d, now);
    return performance.now() - t0;
  }

  function drawGL(now, allowBust = true) {
    if (!canvas || !glStage || glStage.lost) return 0;
    const t0 = performance.now();
    if (!glStage.begin([0, 0, 0, 0])) return 0;
    const unit = updateGeomUnit();
    const bust = allowBust && mode === 'gl-bust';

    for (const it of items) {
      if (!glStage.has(it.el)) continue;
      const age = now - it.pulseAt;
      const pulse = age >= 0 && age < 450 ? 1 - age / 450 : 0;
      const kind = it.kind === 'input' ? 1 : 0;
      ElementGL.rect(canvas, it.x, it.y, it.w, it.h, matPool);
      glStage.quad(it.el, matPool, (gl, uniform) => {
        gl.uniform1f(uniform('uPulse'), pulse);
        gl.uniform1f(uniform('uKind'), kind);
      });
      // Update browser hit-test geometry for this element.
      const m = new DOMMatrix().scale(unit).translate(it.x, it.y);
      canvas.updateElementGeometry(it.el, { canvasTransform: m });
      // In gl-bust mode, toggle an attribute to clear Chromium's hit-test cache.
      if (bust) it.el.toggleAttribute('data-hit');
    }
    return performance.now() - t0;
  }

  function tick(now) {
    rafId = requestAnimationFrame(tick);
    if (!onScreen || document.hidden || suspended) {
      lastNow = now;
      return;
    }
    const dt = lastNow ? Math.min(100, now - lastNow) : 16.6;
    if (lastNow) frameIntervalSamples.push(dt);
    lastNow = now;
    if (!paused) simTime += dt / 1000;

    const activeMotion = !paused || Boolean(dragItem) || now - lastPulse < 500 || markers.length > 0;
    if (activeMotion) layoutPositions(simTime);

    let jsCost = 0;
    if (mode === 'dom') {
      if (activeMotion) jsCost = drawDOM();
    } else if (mode === '2d') {
      if (activeMotion) jsCost = draw2D(now);
    } else if (mode === 'gl-stale' || mode === 'gl-bust') {
      if (activeMotion) jsCost = drawGL(now, true);
    }
    frameCostSamples.push(jsCost);

    if (now - lastStatsEmit > 450) {
      const elapsedSec = lastStatsEmit ? (now - lastStatsEmit) / 1000 : 0.45;
      lastStatsEmit = now;
      const medCost = median(frameCostSamples);
      const medFrame = median(frameIntervalSamples);
      const paintsPerSec = elapsedSec > 0 ? paintCount / elapsedSec : 0;
      paintCount = 0;
      frameCostSamples = [];
      frameIntervalSamples = [];
      onFrameStats?.({
        mode,
        count,
        jsMs: medCost,
        frameMs: medFrame,
        fps: medFrame ? Math.min(240, 1000 / medFrame) : null,
        paintsPerSec,
      });
    }
  }

  // Pointer hit-accuracy check and direct drag handling on the arena.
  stageEl.addEventListener('pointerdown', (e) => {
    const rect = stageEl.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;

    // Check top-most drawn control first (reverse paint order).
    let visualHit = null;
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (lx >= it.x && lx <= it.x + it.w && ly >= it.y && ly <= it.y + it.h) {
        visualHit = it;
        break;
      }
    }

    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const actualControl = items.find((it) => e.target === it.el || it.el.contains(e.target) || stack.includes(it.el));

    let kind = 'background';
    let driftPx = 0;
    if (visualHit) {
      const matched = e.target === visualHit.el || visualHit.el.contains(e.target) || stack.includes(visualHit.el);
      if (matched) {
        kind = 'hit';
      } else {
        kind = 'miss';
        const br = visualHit.el.getBoundingClientRect();
        const vx = rect.left + visualHit.x + visualHit.w * 0.5;
        const vy = rect.top + visualHit.y + visualHit.h * 0.5;
        const bx = br.left + br.width * 0.5;
        const by = br.top + br.height * 0.5;
        driftPx = Math.hypot(vx - bx, vy - by);
      }
    } else if (actualControl) {
      kind = 'ghost';
      const br = actualControl.el.getBoundingClientRect();
      const vx = rect.left + actualControl.x + actualControl.w * 0.5;
      const vy = rect.top + actualControl.y + actualControl.h * 0.5;
      driftPx = Math.hypot(vx - (br.left + br.width * 0.5), vy - (br.top + br.height * 0.5));
    }

    if (kind !== 'background') {
      markers.push({ x: lx, y: ly, kind, at: performance.now() });
      spawnRing(lx, ly, kind);
      onHitProbe?.({
        mode,
        count,
        kind,
        driftPx,
        visualLabel: visualHit ? (visualHit.kind === 'input' ? 'input' : `#${visualHit.idx + 1}`) : 'none',
        targetTag: e.target?.localName ?? 'unknown',
      });
    }

    // Allow dragging any button that actually received the pointerdown.
    const hitBtn = items.find((it) => it.kind === 'button' && (e.target === it.el || it.el.contains(e.target)));
    if (hitBtn) {
      dragItem = hitBtn;
      dragItem.dragged = true;
      dragOffX = lx - hitBtn.x;
      dragOffY = ly - hitBtn.y;
      dragMoved = false;
      hitBtn.pulseAt = performance.now();
    }
  }, { capture: true });

  window.addEventListener('pointermove', (e) => {
    if (!dragItem) return;
    const rect = stageEl.getBoundingClientRect();
    const { w: sw, h: sh } = stageSize();
    const nx = Math.max(8, Math.min(sw - dragItem.w - 8, Math.round(e.clientX - rect.left - dragOffX)));
    const ny = Math.max(8, Math.min(sh - 62 - dragItem.h, Math.round(e.clientY - rect.top - dragOffY)));
    if (Math.hypot(nx - dragItem.x, ny - dragItem.y) > 4) dragMoved = true;
    dragItem.x = nx;
    dragItem.y = ny;
  }, { passive: true });

  const endDrag = () => {
    if (!dragItem) return;
    dragItem.dragged = false;
    dragItem = null;
    setTimeout(() => { dragMoved = false; }, 0);
  };
  window.addEventListener('pointerup', endDrag, { passive: true });
  window.addEventListener('pointercancel', endDrag, { passive: true });

  const io = new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
  });
  io.observe(stageEl);

  const ro = new ResizeObserver(() => {
    geomUnitKey = '';
    layoutPositions(simTime);
    if (mode === 'dom') drawDOM();
    else if (mode === '2d') draw2D(performance.now());
    else if (mode === 'gl-stale' || mode === 'gl-bust') canvas?.requestPaint();
  });
  ro.observe(stageEl);

  function setMode(next) {
    if (mode === next && (canvas || domLayer)) return mode;
    mode = next;
    buildScene();
    onModeChange?.(mode);
    return mode;
  }

  function setCount(next) {
    count = next;
    buildScene();
  }

  function setPaused(next) {
    paused = Boolean(next);
    return paused;
  }

  function suspend() {
    suspended = true;
    retireActiveCanvas();
  }

  function resume() {
    suspended = false;
    buildScene();
  }

  buildScene();
  rafId = requestAnimationFrame(tick);

  return {
    getMode: () => mode,
    getCount: () => count,
    isPaused: () => paused,
    setMode,
    setCount,
    setPaused,
    suspend,
    resume,
    destroy: () => {
      cancelAnimationFrame(rafId);
      io.disconnect();
      ro.disconnect();
      retireActiveCanvas();
    },
  };
}

// #region inp-observer
export function createInpRecorder(stageEl, getContext, onUpdate) {
  const supportedEventTiming =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('event');

  const trackedTypes = new Set(['pointerdown', 'pointerup', 'click', 'keydown', 'keyup', 'input']);
  const byInteraction = new Map();
  const recent = [];
  const hitStats = new Map();
  let syntheticId = 0;

  function ensureHitBucket(mode) {
    let b = hitStats.get(mode);
    if (!b) {
      b = { hits: 0, misses: 0, ghosts: 0, drifts: [] };
      hitStats.set(mode, b);
    }
    return b;
  }

  function recordHitProbe(probe) {
    const b = ensureHitBucket(probe.mode);
    if (probe.kind === 'hit') b.hits++;
    else if (probe.kind === 'miss') {
      b.misses++;
      if (probe.driftPx > 0) b.drifts.push(probe.driftPx);
    } else if (probe.kind === 'ghost') {
      b.ghosts++;
      if (probe.driftPx > 0) b.drifts.push(probe.driftPx);
    }
    onUpdate?.(snapshot());
  }

  function handleEntry(entry) {
    if (!trackedTypes.has(entry.name)) return;
    const target = entry.target;
    if (!target || !stageEl.contains(target)) return;

    const { mode, count } = getContext();
    const inputDelay = Math.max(0, entry.processingStart - entry.startTime);
    const processingDuration = Math.max(0, entry.processingEnd - entry.processingStart);
    const presentationDelay = Math.max(0, entry.startTime + entry.duration - entry.processingEnd);
    const duration = Math.max(0, entry.duration);
    const key = entry.interactionId > 0 ? `id:${entry.interactionId}` : `raw:${++syntheticId}`;

    const record = {
      key,
      interactionId: entry.interactionId || 0,
      name: entry.name,
      mode,
      count,
      targetTag: target.localName || 'node',
      inputDelay,
      processingDuration,
      presentationDelay,
      duration,
      at: performance.now(),
    };

    const prev = byInteraction.get(key);
    if (!prev || record.duration >= prev.duration) {
      byInteraction.set(key, record);
    }
    recent.unshift(record);
    if (recent.length > 12) recent.length = 12;
    onUpdate?.(snapshot());
  }

  let observer = null;
  if (supportedEventTiming) {
    observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) handleEntry(entry);
    });
    try {
      observer.observe({ type: 'event', durationThreshold: 0, buffered: false });
    } catch {
      try {
        observer.observe({ type: 'event', durationThreshold: 16, buffered: false });
      } catch {
        observer = null;
      }
    }
  }

  function summariseList(list) {
    const durations = list.map((r) => r.duration);
    return {
      count: list.length,
      p75: percentile(durations, 0.75),
      p98: percentile(durations, 0.98),
      worst: durations.length ? Math.max(...durations) : null,
      medInput: median(list.map((r) => r.inputDelay)),
      medProc: median(list.map((r) => r.processingDuration)),
      medPres: median(list.map((r) => r.presentationDelay)),
    };
  }

  function snapshot() {
    const all = Array.from(byInteraction.values());
    const byMode = {};
    for (const m of MODES) {
      const list = all.filter((r) => r.mode === m.id);
      const hb = hitStats.get(m.id) ?? { hits: 0, misses: 0, ghosts: 0, drifts: [] };
      const totalProbes = hb.hits + hb.misses;
      byMode[m.id] = {
        ...summariseList(list),
        hits: hb.hits,
        misses: hb.misses,
        ghosts: hb.ghosts,
        hitRate: totalProbes ? hb.hits / totalProbes : null,
        medDrift: median(hb.drifts),
      };
    }
    let totalHits = 0, totalMisses = 0, totalGhosts = 0;
    for (const b of hitStats.values()) {
      totalHits += b.hits;
      totalMisses += b.misses;
      totalGhosts += b.ghosts;
    }
    return {
      supported: Boolean(observer),
      overall: summariseList(all),
      hitOverall: {
        hits: totalHits,
        misses: totalMisses,
        ghosts: totalGhosts,
        hitRate: totalHits + totalMisses ? totalHits / (totalHits + totalMisses) : null,
      },
      byMode,
      recent: recent.slice(0, 10),
    };
  }

  function reset() {
    byInteraction.clear();
    recent.length = 0;
    hitStats.clear();
    onUpdate?.(snapshot());
  }

  return {
    supported: Boolean(observer),
    recordHitProbe,
    snapshot,
    reset,
    disconnect: () => observer?.disconnect(),
  };
}
// #endregion inp-observer

// #region sweep
export async function runOverheadSweep(stageEl, { signal, onStatus, onRow } = {}) {
  const rows = [];
  if (!supported) {
    onStatus?.('HTML-in-canvas is not available in this browser.');
    return rows;
  }

  const W = Math.min(340, Math.max(260, stageEl.clientWidth || 320));
  const H = 180;
  const FRAMES = 24;
  const mat = new Float32Array(16);

  const loafSupported =
    typeof PerformanceObserver !== 'undefined' &&
    PerformanceObserver.supportedEntryTypes?.includes('long-animation-frame');

  let loafEntries = [];
  let loafObs = null;
  if (loafSupported) {
    loafObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) loafEntries.push(e);
    });
    try {
      loafObs.observe({ type: 'long-animation-frame', buffered: false });
    } catch {
      loafObs = null;
    }
  }

  // Create at most one 2D canvas and one WebGL canvas for the entire sweep,
  // reusing each across counts so GPU contexts are never churned.
  const makeSweepButtons = (n) => {
    const bw = n <= 12 ? 56 : n <= 50 ? 40 : 30;
    const bh = n <= 12 ? 28 : n <= 50 ? 22 : 18;
    const list = [];
    for (let i = 0; i < n; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sweep-btn';
      b.setAttribute('drawable', '');
      b.style.width = `${bw}px`;
      b.style.height = `${bh}px`;
      b.textContent = `${i + 1}`;
      list.push({ el: b, w: bw, h: bh, x: 6, y: 6 });
    }
    return list;
  };

  function placeInitial(btns) {
    const cols = Math.max(1, Math.floor((W - 12) / (btns[0].w + 4)));
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      b.x = 6 + (i % cols) * (b.w + 4);
      b.y = 6 + (Math.floor(i / cols) % 3) * (b.h + 4);
      b.initX = b.x;
      b.initY = b.y;
    }
  }

  function placeProbeTargets(btns) {
    // Move the first 5 buttons to non-overlapping positions shifted clearly away from initX/initY.
    const probeN = Math.min(btns.length, 5);
    for (let i = 0; i < probeN; i++) {
      const b = btns[i];
      b.x = Math.min(W - b.w - 6, 12 + i * (b.w + 6));
      b.y = Math.min(H - b.h - 6, H - b.h - 14 - (i % 2) * (b.h + 8));
      if (Math.hypot(b.x - b.initX, b.y - b.initY) < 40) {
        b.x = Math.max(6, W - b.w - 10 - i * 12);
      }
    }
  }

  function probeHits(canvas, btns) {
    const rect = canvas.getBoundingClientRect();
    const visible = rect.width > 0 && rect.height > 0 && rect.top >= 48 && rect.bottom <= window.innerHeight && rect.left >= 0 && rect.right <= window.innerWidth;
    if (!visible) return { visible: false, hits: 0, ghosts: 0, total: 0 };
    const probeN = Math.min(btns.length, 5);
    let hits = 0, ghosts = 0;
    for (let i = 0; i < probeN; i++) {
      const b = btns[i];
      const cx = rect.left + b.x + b.w * 0.5;
      const cy = rect.top + b.y + b.h * 0.5;
      const stack = document.elementsFromPoint(cx, cy);
      if (stack.includes(b.el)) hits++;

      const ox = rect.left + b.initX + b.w * 0.5;
      const oy = rect.top + b.initY + b.h * 0.5;
      if (Math.hypot(cx - ox, cy - oy) > b.w) {
        const oldStack = document.elementsFromPoint(ox, oy);
        if (oldStack.includes(b.el)) ghosts++;
      }
    }
    return { visible: true, hits, ghosts, total: probeN };
  }

  let sweepCanvas = null;
  let sweepGL = null;

  const retireSweep = () => {
    if (sweepGL) {
      sweepGL.dispose();
      sweepGL = null;
    }
    if (sweepCanvas) {
      const old = sweepCanvas;
      sweepCanvas = null;
      old.remove();
      window.__gfx?.retire?.(old);
    }
  };

  try {
    // Pass 1: 2D drawElementImage() across all counts.
    sweepCanvas = document.createElement('canvas');
    sweepCanvas.className = 'sweep-canvas';
    sweepCanvas.style.width = `${W}px`;
    sweepCanvas.style.height = `${H}px`;
    sweepCanvas.setAttribute('content', 'drawable');
    sweepCanvas.setAttribute('layoutsubtree', '');
    stageEl.replaceChildren(sweepCanvas);
    const ctx = sweepCanvas.getContext('2d');
    const scale = sizeCanvas2D(sweepCanvas, W, H);

    for (const n of COUNTS) {
      if (signal?.aborted) break;
      onStatus?.(`2D drawElementImage() with ${n} control${n === 1 ? '' : 's'}…`);
      const btns = makeSweepButtons(n);
      sweepCanvas.replaceChildren(...btns.map((b) => b.el));
      placeInitial(btns);
      await nextPaint(sweepCanvas);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const b of btns) ctx.drawElementImage(b.el, b.x, b.y, b.w, b.h);
      await raf();
      // Warm hit-test cache at initial positions.
      const r0 = sweepCanvas.getBoundingClientRect();
      for (let i = 0; i < Math.min(n, 5); i++) {
        document.elementsFromPoint(r0.left + btns[i].initX + btns[i].w * 0.5, r0.top + btns[i].initY + btns[i].h * 0.5);
      }

      loafEntries = [];
      const jsTimes = [], frameTimes = [];
      let prev = performance.now();
      for (let f = 0; f < FRAMES; f++) {
        if (signal?.aborted) break;
        const now = await raf();
        frameTimes.push(now - prev);
        prev = now;
        const t0 = performance.now();
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, W, H);
        if (f === FRAMES - 1) {
          placeProbeTargets(btns);
        } else {
          for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            b.x = 6 + ((b.initX + f * 5 + i * 3) % Math.max(8, W - b.w - 12));
            b.y = 6 + ((b.initY + f * 3 + i * 2) % Math.max(8, H - b.h - 12));
          }
        }
        for (const b of btns) ctx.drawElementImage(b.el, b.x, b.y, b.w, b.h);
        jsTimes.push(performance.now() - t0);
      }
      await raf();
      const probe = probeHits(sweepCanvas, btns);
      const row = {
        count: n,
        route: '2d',
        label: '2D drawElementImage()',
        jsMed: median(jsTimes),
        jsP95: percentile(jsTimes, 0.95),
        frameMed: median(frameTimes),
        loafCount: loafEntries.length,
        loafMax: loafEntries.length ? Math.max(...loafEntries.map((e) => e.duration)) : 0,
        probe,
      };
      rows.push(row);
      onRow?.(row);
    }

    retireSweep();

    // Pass 2: WebGL ElementGL + updateElementGeometry() (without and with attribute toggle).
    if (!signal?.aborted && glSupported) {
      sweepCanvas = document.createElement('canvas');
      sweepCanvas.className = 'sweep-canvas';
      sweepCanvas.style.width = `${W}px`;
      sweepCanvas.style.height = `${H}px`;
      sweepCanvas.setAttribute('content', 'drawable');
      sweepCanvas.setAttribute('layoutsubtree', '');
      stageEl.replaceChildren(sweepCanvas);
      sweepGL = new ElementGL(sweepCanvas, { fragment: FRAGMENT });
      let currentBtns = [];

      for (const n of COUNTS) {
        if (signal?.aborted) break;
        for (const old of currentBtns) {
          sweepGL.forget(old.el);
          old.el.remove();
        }
        currentBtns = makeSweepButtons(n);
        sweepCanvas.append(...currentBtns.map((b) => b.el));
        placeInitial(currentBtns);
        await nextPaint(sweepCanvas);
        for (const b of currentBtns) sweepGL.upload(b.el);
        const unit = geometryUnit(sweepCanvas, currentBtns[0].el, currentBtns[0].w);

        for (const bust of [false, true]) {
          if (signal?.aborted) break;
          const label = bust ? 'WebGL + geometry + toggleAttribute' : 'WebGL + geometry (no toggle)';
          onStatus?.(`${label} with ${n} control${n === 1 ? '' : 's'}…`);

          // Reset to initial positions and warm the hit-test cache with an attribute toggle so both runs start clean.
          placeInitial(currentBtns);
          if (sweepGL.begin([0, 0, 0, 0])) {
            for (const b of currentBtns) {
              ElementGL.rect(sweepCanvas, b.x, b.y, b.w, b.h, mat);
              sweepGL.quad(b.el, mat, (gl, u) => { gl.uniform1f(u('uPulse'), 0); gl.uniform1f(u('uKind'), 0); });
              sweepCanvas.updateElementGeometry(b.el, { canvasTransform: new DOMMatrix().scale(unit).translate(b.x, b.y) });
              b.el.toggleAttribute('data-hit');
            }
          }
          await raf();
          const r0 = sweepCanvas.getBoundingClientRect();
          for (let i = 0; i < Math.min(n, 5); i++) {
            document.elementsFromPoint(r0.left + currentBtns[i].initX + currentBtns[i].w * 0.5, r0.top + currentBtns[i].initY + currentBtns[i].h * 0.5);
          }

          loafEntries = [];
          const jsTimes = [], geomTimes = [], frameTimes = [];
          let prev = performance.now();
          for (let f = 0; f < FRAMES; f++) {
            if (signal?.aborted) break;
            const now = await raf();
            frameTimes.push(now - prev);
            prev = now;
            const t0 = performance.now();
            if (f === FRAMES - 1) {
              placeProbeTargets(currentBtns);
            } else {
              for (let i = 0; i < currentBtns.length; i++) {
                const b = currentBtns[i];
                b.x = 6 + ((b.initX + f * 5 + i * 3) % Math.max(8, W - b.w - 12));
                b.y = 6 + ((b.initY + f * 3 + i * 2) % Math.max(8, H - b.h - 12));
              }
            }
            if (sweepGL.begin([0, 0, 0, 0])) {
              for (const b of currentBtns) {
                ElementGL.rect(sweepCanvas, b.x, b.y, b.w, b.h, mat);
                sweepGL.quad(b.el, mat, (gl, u) => { gl.uniform1f(u('uPulse'), 0); gl.uniform1f(u('uKind'), 0); });
              }
            }
            const tg0 = performance.now();
            for (const b of currentBtns) {
              sweepCanvas.updateElementGeometry(b.el, {
                canvasTransform: new DOMMatrix().scale(unit).translate(b.x, b.y),
              });
              if (bust) b.el.toggleAttribute('data-hit');
            }
            const tEnd = performance.now();
            geomTimes.push(tEnd - tg0);
            jsTimes.push(tEnd - t0);
          }
          await raf();
          const probe = probeHits(sweepCanvas, currentBtns);
          const row = {
            count: n,
            route: bust ? 'gl-bust' : 'gl-stale',
            label,
            jsMed: median(jsTimes),
            jsP95: percentile(jsTimes, 0.95),
            geomMed: median(geomTimes),
            frameMed: median(frameTimes),
            loafCount: loafEntries.length,
            loafMax: loafEntries.length ? Math.max(...loafEntries.map((e) => e.duration)) : 0,
            probe,
          };
          rows.push(row);
          onRow?.(row);
        }
      }
    }
  } finally {
    loafObs?.disconnect();
    retireSweep();
    stageEl.replaceChildren();
  }

  return rows;
}
// #endregion sweep

export function formatMarkdownReport({ inpSnap, sweepRows }) {
  const chrome = navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? navigator.userAgent;
  const lines = [
    '### `/perf-inp/` measurement report',
    '',
    `- Browser: ${chrome}`,
    `- Date: ${new Date().toISOString().slice(0, 10)}`,
    `- Viewport: ${window.innerWidth}x${window.innerHeight} CSS px, DPR ${devicePixelRatio}, ${navigator.hardwareConcurrency ?? '?'} cores`,
    '',
  ];

  if (inpSnap && (inpSnap.overall.count > 0 || inpSnap.hitOverall.hits + inpSnap.hitOverall.misses > 0)) {
    lines.push('#### Real interaction INP and hit accuracy', '');
    lines.push('| Mode | Interactions | INP p75 | INP p98 | Worst | Input delay | Processing | Presentation | Hits | Stale misses | Ghost hits |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const m of MODES) {
      const s = inpSnap.byMode[m.id];
      if (!s || (s.count === 0 && s.hits === 0 && s.misses === 0 && s.ghosts === 0)) continue;
      const hitText = s.hits + s.misses ? `${s.hits}/${s.hits + s.misses} (${Math.round(s.hitRate * 100)}%)` : '-';
      lines.push(`| ${m.short} | ${s.count} | ${fmtMs(s.p75)} | ${fmtMs(s.p98)} | ${fmtMs(s.worst)} | ${fmtMs(s.medInput)} | ${fmtMs(s.medProc)} | ${fmtMs(s.medPres)} | ${hitText} | ${s.misses} | ${s.ghosts} |`);
    }
    lines.push('');
  }

  if (sweepRows?.length) {
    lines.push('#### Geometry overhead and hit-test drift sweep', '');
    lines.push('| Controls | Route | JS median | JS p95 | Geometry loop | Frame median | LoAFs (>50 ms) | elementsFromPoint() hits |');
    lines.push('|---:|---|---:|---:|---:|---:|---:|---|');
    for (const r of sweepRows) {
      const hitStr = !r.probe.visible
        ? 'off-screen'
        : `${r.probe.hits}/${r.probe.total}${r.probe.ghosts ? ` (${r.probe.ghosts} ghost at old pos)` : ''}`;
      const loafStr = r.loafCount ? `${r.loafCount} (max ${r.loafMax.toFixed(0)} ms)` : '0';
      lines.push(`| ${r.count} | ${r.label} | ${fmtMs(r.jsMed)} | ${fmtMs(r.jsP95)} | ${r.geomMed != null ? fmtMs(r.geomMed) : '-'} | ${fmtMs(r.frameMed)} | ${loafStr} | ${hitStr} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function buildLiveChecks() {
  const mkFixtureCanvas = (w = 280, h = 150) => {
    const c = document.createElement('canvas');
    c.setAttribute('content', 'drawable');
    c.setAttribute('layoutsubtree', '');
    c.style.cssText = `display:block;width:${w}px;height:${h}px;background:#fff`;
    testStage().append(c);
    return c;
  };

  return [
    {
      name: 'Event Timing (event) entries are supported',
      expect: 'pass',
      why: 'The live INP recorder uses PerformanceObserver({ type: "event", durationThreshold: 0 }) to split input delay, processing and presentation delay.',
      run: async () => {
        const types = PerformanceObserver.supportedEntryTypes ?? [];
        if (!types.includes('event')) throw new Error('PerformanceObserver does not list "event" in supportedEntryTypes');
        const obs = new PerformanceObserver(() => {});
        try {
          obs.observe({ type: 'event', durationThreshold: 0, buffered: false });
        } finally {
          obs.disconnect();
        }
        return 'supported (durationThreshold: 0 accepted)';
      },
    },
    {
      name: 'Long Animation Frame (long-animation-frame) entries are supported',
      expect: 'pass',
      why: 'The sweep watches long-animation-frame entries to catch frames over 50 ms caused by geometry updates or style recalc.',
      run: async () => {
        const types = PerformanceObserver.supportedEntryTypes ?? [];
        if (!types.includes('long-animation-frame')) throw new Error('long-animation-frame is not in supportedEntryTypes');
        return 'supported';
      },
    },
    {
      name: '2D drawElementImage() moves a button hit box to its new coordinates',
      expect: 'pass',
      why: 'Draws a button at (10, 10), warms elementsFromPoint(), moves it to (150, 75) with explicit width and height, and checks hit-testing at the new centre.',
      run: async () => {
        if (!supported) throw new Error('HTML-in-canvas not available');
        const c = mkFixtureCanvas(280, 140);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('drawable', '');
        btn.textContent = 'Target';
        btn.style.cssText = 'width:80px;height:36px;margin:0';
        c.append(btn);
        const ctx = c.getContext('2d');
        const s = sizeCanvas2D(c, 280, 140);
        await nextPaint(c);
        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.clearRect(0, 0, 280, 140);
        ctx.drawElementImage(btn, 10, 10, 80, 36);
        await raf();
        const r = c.getBoundingClientRect();
        const hitBefore = document.elementsFromPoint(r.left + 50, r.top + 28).includes(btn);

        ctx.setTransform(s, 0, 0, s, 0, 0);
        ctx.clearRect(0, 0, 280, 140);
        ctx.drawElementImage(btn, 150, 75, 80, 36);
        await raf();
        const hitAfterRaw = document.elementsFromPoint(r.left + 190, r.top + 93).includes(btn);
        btn.toggleAttribute('data-hit');
        await raf();
        const hitAfterToggle = document.elementsFromPoint(r.left + 190, r.top + 93).includes(btn);

        if (!hitAfterRaw && !hitAfterToggle) {
          throw new Error(`missed at new position (initial hit=${hitBefore}, raw=${hitAfterRaw}, after toggle=${hitAfterToggle})`);
        }
        return `initial=${hitBefore}, moved raw=${hitAfterRaw}, after attribute toggle=${hitAfterToggle}`;
      },
    },
    {
      name: 'WebGL updateElementGeometry() hit-test after cache warm-up (without attribute toggle)',
      expect: 'fail',
      why: 'Reproduces Chromium\'s stale hit-test cache: warms elementsFromPoint() at (10, 10), moves geometry to (150, 75) with updateElementGeometry() alone, and probes the new box.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL HTML-in-canvas not available');
        const c = mkFixtureCanvas(280, 140);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('drawable', '');
        btn.textContent = 'GL';
        btn.style.cssText = 'width:80px;height:36px;margin:0';
        c.append(btn);
        const gl = new ElementGL(c, { fragment: FRAGMENT });
        try {
          await nextPaint(c);
          gl.upload(btn);
          const unit = geometryUnit(c, btn, 80);
          const m = new Float32Array(16);
          if (gl.begin([0, 0, 0, 0])) {
            ElementGL.rect(c, 10, 10, 80, 36, m);
            gl.quad(btn, m, (g, u) => { g.uniform1f(u('uPulse'), 0); g.uniform1f(u('uKind'), 0); });
            c.updateElementGeometry(btn, { canvasTransform: new DOMMatrix().scale(unit).translate(10, 10) });
            btn.toggleAttribute('data-hit');
          }
          await raf();
          const r = c.getBoundingClientRect();
          const warmHit = document.elementsFromPoint(r.left + 50, r.top + 28).includes(btn);

          // Move geometry WITHOUT toggling an attribute.
          if (gl.begin([0, 0, 0, 0])) {
            ElementGL.rect(c, 150, 75, 80, 36, m);
            gl.quad(btn, m, (g, u) => { g.uniform1f(u('uPulse'), 0); g.uniform1f(u('uKind'), 0); });
            c.updateElementGeometry(btn, { canvasTransform: new DOMMatrix().scale(unit).translate(150, 75) });
          }
          await raf();
          const newHit = document.elementsFromPoint(r.left + 190, r.top + 93).includes(btn);
          const oldGhost = document.elementsFromPoint(r.left + 50, r.top + 28).includes(btn);
          if (!newHit) {
            throw new Error(`stale hit-test cache reproduced: warm=${warmHit}, newPosHit=${newHit}, oldPosGhost=${oldGhost}`);
          }
          return `cache did not go stale here (warm=${warmHit}, newPosHit=${newHit}, oldPosGhost=${oldGhost})`;
        } finally {
          gl.dispose();
        }
      },
    },
    {
      name: 'WebGL updateElementGeometry() + toggleAttribute("data-hit") updates the hit box',
      expect: 'pass',
      why: 'Same move as above, adding el.toggleAttribute("data-hit") after updateElementGeometry() to clear Chromium\'s hit-test cache.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL HTML-in-canvas not available');
        const c = mkFixtureCanvas(280, 140);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.setAttribute('drawable', '');
        btn.textContent = 'GL';
        btn.style.cssText = 'width:80px;height:36px;margin:0';
        c.append(btn);
        const gl = new ElementGL(c, { fragment: FRAGMENT });
        try {
          await nextPaint(c);
          gl.upload(btn);
          const unit = geometryUnit(c, btn, 80);
          const m = new Float32Array(16);
          if (gl.begin([0, 0, 0, 0])) {
            ElementGL.rect(c, 10, 10, 80, 36, m);
            gl.quad(btn, m, (g, u) => { g.uniform1f(u('uPulse'), 0); g.uniform1f(u('uKind'), 0); });
            c.updateElementGeometry(btn, { canvasTransform: new DOMMatrix().scale(unit).translate(10, 10) });
            btn.toggleAttribute('data-hit');
          }
          await raf();
          const r = c.getBoundingClientRect();
          document.elementsFromPoint(r.left + 50, r.top + 28);

          if (gl.begin([0, 0, 0, 0])) {
            ElementGL.rect(c, 150, 75, 80, 36, m);
            gl.quad(btn, m, (g, u) => { g.uniform1f(u('uPulse'), 0); g.uniform1f(u('uKind'), 0); });
            c.updateElementGeometry(btn, { canvasTransform: new DOMMatrix().scale(unit).translate(150, 75) });
            btn.toggleAttribute('data-hit');
          }
          await raf();
          const newHit = document.elementsFromPoint(r.left + 190, r.top + 93).includes(btn);
          const oldGhost = document.elementsFromPoint(r.left + 50, r.top + 28).includes(btn);
          if (!newHit) throw new Error(`still missed after toggleAttribute (newHit=${newHit}, oldGhost=${oldGhost})`);
          return `newPosHit=${newHit}, oldPosGhost=${oldGhost}`;
        } finally {
          gl.dispose();
        }
      },
    },
    {
      name: 'Fixture timing check: 12 controls with updateElementGeometry() and attribute toggle',
      expect: 'pass',
      why: 'Times 10 frames of 12 buttons on an isolated fixture comparing geometry-only vs geometry + toggleAttribute.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL HTML-in-canvas not available');
        const c = mkFixtureCanvas(280, 140);
        const btns = [];
        for (let i = 0; i < 12; i++) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('drawable', '');
          b.style.cssText = 'width:40px;height:24px;margin:0';
          b.textContent = String(i + 1);
          c.append(b);
          btns.push(b);
        }
        const gl = new ElementGL(c, { fragment: FRAGMENT });
        try {
          await nextPaint(c);
          for (const b of btns) gl.upload(b);
          const unit = geometryUnit(c, btns[0], 40);
          const runPass = async (bust) => {
            const times = [];
            for (let f = 0; f < 10; f++) {
              await raf();
              const t0 = performance.now();
              for (let i = 0; i < btns.length; i++) {
                const x = 6 + ((i * 22 + f * 5) % 220);
                const y = 6 + ((i * 15 + f * 3) % 100);
                c.updateElementGeometry(btns[i], { canvasTransform: new DOMMatrix().scale(unit).translate(x, y) });
                if (bust) btns[i].toggleAttribute('data-hit');
              }
              times.push(performance.now() - t0);
            }
            return median(times);
          };
          const medOnly = await runPass(false);
          const medBust = await runPass(true);
          return `12 controls median: geometry only ${medOnly.toFixed(2)} ms, with toggleAttribute ${medBust.toFixed(2)} ms`;
        } finally {
          gl.dispose();
        }
      },
    },
  ];
}
