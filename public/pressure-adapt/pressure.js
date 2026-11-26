import { banner, runTests, testStage } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const canvas2dSupported =
  typeof CanvasRenderingContext2D !== 'undefined' &&
  'drawElementImage' in CanvasRenderingContext2D.prototype;

const $ = (id) => document.getElementById(id);
const host = $('card-host');
const card = $('control-card');
const cardInput = $('card-input');
const cardSlider = $('card-slider');
const cardSliderOut = $('card-slider-out');
const cardMeta = $('card-meta');
const cardPill = $('card-tier-pill');
const gaugeArc = $('gauge-arc');
const gaugeLabel = $('gauge-label');
const gaugeSub = $('gauge-sub');
const noticeEl = $('stage-notice');
const sensorStatusEl = $('sensor-status');
const timelineEl = $('pressure-timeline');
const burnBtn = $('burn-btn');

const statTier = $('stat-tier');
const statBackend = $('stat-backend');
const statFps = $('stat-fps');
const statMemory = $('stat-memory');
const statTransition = $('stat-transition');

const togRipple = $('tog-ripple');
const togChroma = $('tog-chroma');
const togHighlight = $('tog-highlight');
const tierBtns = Array.from(document.querySelectorAll('.tier-btn'));

const TIERS = ['nominal', 'fair', 'serious', 'critical'];
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 22;

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// #region shader
const NOMINAL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uIntensity;
uniform float uRippleOn;
uniform float uChromaOn;
uniform float uHighlightOn;
uniform float uReduced;
uniform vec3 uPointer;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec2 uv = vUv;
  float t = uReduced > 0.5 ? 0.0 : uTime;
  float strength = clamp(uIntensity, 0.0, 1.0);
  vec2 aspect = vec2(max(uSize.x, 1.0) / max(uSize.y, 1.0), 1.0);

  // Travelling wave plus pointer-centred circular glass ripple.
  vec2 offset = vec2(0.0);
  if (uRippleOn > 0.5 && strength > 0.001) {
    float waveX = sin(uv.y * 14.0 - t * 2.6) * cos(uv.x * 7.0 + t * 1.4);
    float waveY = cos(uv.x * 12.0 + t * 2.2) * sin(uv.y * 8.0 - t * 1.7);
    offset += vec2(waveX, waveY) * (0.0042 * strength);

    if (uPointer.z > 0.5) {
      vec2 delta = (uv - uPointer.xy) * aspect;
      float dist = length(delta);
      float ring = sin(dist * 34.0 - t * 6.5) * exp(-dist * 4.5);
      vec2 dir = dist > 0.0001 ? delta / dist : vec2(0.0);
      offset += dir * (ring * 0.011 * strength);
    }
  }

  // Chromatic RGB channel dispersion along the ripple gradient.
  vec2 sampleUv = clamp(uv + offset, vec2(0.001), vec2(0.999));
  vec2 chromaShift = (uChromaOn > 0.5)
    ? (offset * 1.65 + vec2(0.0022 * strength, 0.0009 * strength))
    : vec2(0.0);

  vec4 cR = texture(uTex, clamp(sampleUv + chromaShift, vec2(0.001), vec2(0.999)));
  vec4 cG = texture(uTex, sampleUv);
  vec4 cB = texture(uTex, clamp(sampleUv - chromaShift, vec2(0.001), vec2(0.999)));
  float a = max(cG.a, max(cR.a, cB.a));
  vec3 rgb = vec3(cR.r, cG.g, cB.b);

  // Sweeping specular glass sheen and soft rim refraction.
  if (uHighlightOn > 0.5 && a > 0.01) {
    float sweepPos = fract(t * 0.14) * 2.4 - 0.7;
    float diag = (uv.x * 0.85 + uv.y * 0.45) - sweepPos;
    float sheen = exp(-diag * diag * 42.0) * (0.14 + 0.14 * strength);
    float edge = smoothstep(0.32, 0.5, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
    vec3 tint = mix(vec3(0.42, 0.82, 1.0), vec3(1.0, 0.56, 0.36), uv.x);
    rgb += (vec3(sheen) + tint * edge * (0.10 * strength)) * a;
  }

  outColor = vec4(rgb, a);
}`;
// #endregion shader

// Move an element into a new parent while keeping DOM identity, focus and input state.
function moveNode(parent, el, before = null) {
  try {
    if (typeof parent.moveBefore === 'function') {
      parent.moveBefore(el, before);
      return 'moveBefore';
    }
  } catch {}
  parent.insertBefore(el, before);
  return 'insertBefore';
}

function showNotice(text) {
  if (!text) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
    return;
  }
  noticeEl.hidden = false;
  noticeEl.textContent = text;
}

function formatMB(bytes) {
  return `${(bytes / 1e6).toFixed(1)} MB`;
}

// Compute canvas backing dimensions within the 4 MP phone budget.
function backingSize(cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let w = Math.max(1, Math.round(cssW * dpr));
  let h = Math.max(1, Math.round(cssH * dpr));
  const maxPx = 3.8e6;
  if (w * h > maxPx) {
    const s = Math.sqrt(maxPx / (w * h));
    w = Math.max(1, Math.floor(w * s));
    h = Math.max(1, Math.floor(h * s));
  }
  return { w, h, dpr };
}

function makeDrawableCanvas(cssHeight) {
  const c = document.createElement('canvas');
  c.setAttribute('content', 'drawable');
  c.setAttribute('layoutsubtree', '');
  c.style.cssText = `display:block;width:100%;height:${Math.max(120, Math.round(cssHeight))}px`;
  return c;
}

// #region tiers
const state = {
  mode: 'live',          // 'live' | 'nominal' | 'fair' | 'serious' | 'critical'
  tier: 'fair',          // active rendering tier
  backend: 'plain',      // 'webgl' | '2d-30' | '2d-demand' | 'plain'
  source: 'startup',     // 'startup' | 'sensor' | 'manual' | 'fallback'
  canvas: null,
  ctx2d: null,
  glStage: null,
  glDirty: true,
  lastGeoKey: '',
  rafId: 0,
  lastFrameTime: 0,
  frameTimes: [],
  onScreen: true,
  transitionMs: 0,
  resizeObs: null,
  pointer: { x: 0.5, y: 0.5, active: 0 },
  lastAction: 'waiting for input',
  sensorState: null,
  history: [],
};

const TIER_INFO = {
  nominal: { label: 'nominal · WebGL 60 fps', backend: 'WebGL (ElementGL)', gaugePct: 92, gaugeSub: '60 fps GL', gaugeColor: '#5fcf7f' },
  fair: { label: 'fair · 2D 30 fps', backend: '2D (30 fps)', gaugePct: 56, gaugeSub: '30 fps 2D', gaugeColor: '#60a5fa' },
  serious: { label: 'serious · 2D on-demand', backend: '2D (on-demand)', gaugePct: 24, gaugeSub: '0 idle rAF', gaugeColor: '#f0c060' },
  critical: { label: 'critical · Plain DOM', backend: 'Plain DOM', gaugePct: 6, gaugeSub: '0 canvases', gaugeColor: '#ff8a80' },
};

function updateCardChrome(tier) {
  const info = TIER_INFO[tier];
  card.dataset.tier = tier;
  cardPill.dataset.tier = tier;
  cardPill.textContent = info.label;
  const offset = GAUGE_CIRCUMFERENCE * (1 - info.gaugePct / 100);
  gaugeArc.setAttribute('stroke-dashoffset', offset.toFixed(2));
  gaugeArc.style.stroke = info.gaugeColor;
  gaugeLabel.textContent = `${info.gaugePct}% GPU`;
  gaugeSub.textContent = info.gaugeSub;
}

function updateCardMeta(action) {
  if (action) state.lastAction = action;
  const togglesOn = [togRipple, togChroma, togHighlight].filter((b) => b.getAttribute('aria-pressed') === 'true').length;
  cardMeta.textContent = `${cardInput.value.length} chars · ${cardSlider.value}% intensity · ${togglesOn} toggles on · ${state.lastAction}`;
}

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function shouldAnimate() {
  if (document.hidden || !state.onScreen || reducedMotion()) return false;
  return state.backend === 'webgl' || state.backend === '2d-30';
}

function startLoop() {
  stopLoop();
  if (!shouldAnimate() || !state.canvas) return;
  const tick = (now) => {
    if (!shouldAnimate() || !state.canvas) {
      state.rafId = 0;
      return;
    }
    const minGap = state.backend === '2d-30' ? 32 : 0;
    if (!minGap || now - state.lastFrameTime >= minGap) {
      state.lastFrameTime = now;
      state.canvas.requestPaint?.();
    }
    state.rafId = requestAnimationFrame(tick);
  };
  state.rafId = requestAnimationFrame(tick);
}

function recordFrame() {
  const now = performance.now();
  state.frameTimes.push(now);
  while (state.frameTimes.length && now - state.frameTimes[0] > 1000) state.frameTimes.shift();
}

function retireCurrentCanvas() {
  stopLoop();
  state.resizeObs?.disconnect();
  state.resizeObs = null;
  if (state.glStage) {
    state.glStage.dispose();
    state.glStage = null;
  }
  const old = state.canvas;
  state.canvas = null;
  state.ctx2d = null;
  state.lastGeoKey = '';
  if (old) {
    old.remove();
    window.__gfx?.retire?.(old);
  }
}

function syncCardHeight() {
  if (!state.canvas) return;
  const h = Math.max(120, Math.round(card.offsetHeight));
  if (h && state.canvas.style.height !== `${h}px`) {
    state.canvas.style.height = `${h}px`;
  }
}

function syncWebGLGeometry(canvas) {
  const unit = geometryUnit(canvas, card, card.offsetWidth || canvas.clientWidth || 1);
  const key = `${card.offsetWidth}x${card.offsetHeight}@${unit.toFixed(3)}`;
  if (state.lastGeoKey === key) return;
  state.lastGeoKey = key;
  canvas.updateElementGeometry(card, {
    canvasTransform: new DOMMatrix().scale(unit).translate(0, 0),
  });
  card.dataset.hitTick = card.dataset.hitTick === '1' ? '0' : '1';
}

function attachWebGLPaint(canvas, stage) {
  canvas.addEventListener('paint', (e) => {
    if (state.canvas !== canvas || state.backend !== 'webgl' || stage.lost) return;
    syncCardHeight();
    const changed = new Set(e.changedElements ?? []);
    if (state.glDirty || changed.has(card) || !stage.has(card)) {
      stage.upload(card);
      state.glDirty = false;
    }
    if (!stage.begin([0.07, 0.09, 0.14, 1])) return;
    const cw = canvas.clientWidth || card.offsetWidth || 1;
    const ch = canvas.clientHeight || card.offsetHeight || 1;
    const intensity = Number(cardSlider.value) / 100;
    const rippleOn = togRipple.getAttribute('aria-pressed') === 'true' ? 1 : 0;
    const chromaOn = togChroma.getAttribute('aria-pressed') === 'true' ? 1 : 0;
    const highlightOn = togHighlight.getAttribute('aria-pressed') === 'true' ? 1 : 0;
    const reduced = reducedMotion() ? 1 : 0;

    stage.quad(card, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, uniform) => {
      gl.uniform1f(uniform('uIntensity'), intensity);
      gl.uniform1f(uniform('uRippleOn'), rippleOn);
      gl.uniform1f(uniform('uChromaOn'), chromaOn);
      gl.uniform1f(uniform('uHighlightOn'), highlightOn);
      gl.uniform1f(uniform('uReduced'), reduced);
      gl.uniform3f(uniform('uPointer'), state.pointer.x, state.pointer.y, state.pointer.active);
    });
    syncWebGLGeometry(canvas);
    recordFrame();
  });
}

function attach2DPaint(canvas, ctx) {
  canvas.addEventListener('paint', () => {
    if (state.canvas !== canvas || (state.backend !== '2d-30' && state.backend !== '2d-demand')) return;
    syncCardHeight();
    const cw = canvas.clientWidth || card.offsetWidth || 1;
    const ch = canvas.clientHeight || card.offsetHeight || 1;
    const { w, h } = backingSize(cw, ch);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const sx = canvas.width / cw;
    const sy = canvas.height / ch;
    ctx.reset();
    ctx.scale(sx, sy);
    ctx.clearRect(0, 0, cw, ch);

    const ew = card.offsetWidth || cw;
    const eh = card.offsetHeight || ch;
    const intensity = Number(cardSlider.value) / 100;
    const highlightOn = togHighlight.getAttribute('aria-pressed') === 'true';

    if (state.backend === '2d-30' && !reducedMotion()) {
      const t = performance.now() / 1000;
      const tilt = Math.sin(t * 1.8) * 0.006 * intensity;
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate(tilt);
      ctx.translate(-cw / 2, -ch / 2);
      ctx.drawElementImage(card, 0, 0, ew, eh);
      ctx.restore();

      if (highlightOn) {
        const sweep = ((t * 0.28) % 1.6) - 0.3;
        const x0 = cw * sweep;
        const grad = ctx.createLinearGradient(x0 - 90, 0, x0 + 90, ch * 0.6);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        grad.addColorStop(0.5, `rgba(170, 218, 255, ${(0.08 + 0.1 * intensity).toFixed(3)})`);
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, cw, ch);
      }
    } else {
      // Static 1:1 draw for serious (on-demand) or reduced motion.
      ctx.drawElementImage(card, 0, 0, ew, eh);
      if (state.backend === '2d-demand') {
        ctx.fillStyle = 'rgba(240, 192, 96, 0.85)';
        ctx.fillRect(0, 0, cw, 3);
      }
    }
    recordFrame();
  });
}

function watchCardResize(canvas) {
  if (typeof ResizeObserver === 'undefined') return null;
  const ro = new ResizeObserver(() => {
    syncCardHeight();
    state.glDirty = true;
    canvas.requestPaint?.();
  });
  ro.observe(card);
  return ro;
}

function applyTier(tier, source = 'manual') {
  if (!TIERS.includes(tier)) return;
  const t0 = performance.now();
  state.tier = tier;
  state.source = source;
  state.frameTimes.length = 0;
  updateCardChrome(tier);
  showNotice('');

  // Without HTML-in-canvas, keep the live card in plain HTML.
  if (!canvas2dSupported) {
    if (card.parentNode !== host) moveNode(host, card, state.canvas);
    card.removeAttribute('drawable');
    retireCurrentCanvas();
    state.backend = 'plain';
    state.transitionMs = performance.now() - t0;
    showNotice('HTML-in-canvas is not available in this browser, so the card stays in plain HTML on every tier.');
    updateTelemetry();
    pushHistory(tier, source);
    return;
  }

  // Tier 4: critical -> plain DOM via moveBefore(), retire all canvases.
  if (tier === 'critical') {
    if (card.parentNode !== host) moveNode(host, card, state.canvas);
    card.removeAttribute('drawable');
    retireCurrentCanvas();
    state.backend = 'plain';
    state.transitionMs = performance.now() - t0;
    updateTelemetry();
    pushHistory(tier, source);
    return;
  }

  // Tier 2 & 3 share a 2D drawable canvas; switching fair <-> serious toggles the rAF loop.
  if ((tier === 'fair' || tier === 'serious') && state.canvas && state.ctx2d) {
    state.backend = tier === 'fair' ? '2d-30' : '2d-demand';
    if (tier === 'fair') startLoop();
    else stopLoop();
    state.canvas.requestPaint?.();
    state.transitionMs = performance.now() - t0;
    updateTelemetry();
    pushHistory(tier, source);
    return;
  }

  // Tier 1: nominal -> WebGL 2 via ElementGL (falls back to 2D if WebGL element upload is unavailable).
  if (tier === 'nominal') {
    if (state.canvas && state.glStage && !state.glStage.lost) {
      state.backend = 'webgl';
      state.glDirty = true;
      startLoop();
      state.canvas.requestPaint?.();
      state.transitionMs = performance.now() - t0;
      updateTelemetry();
      pushHistory(tier, source);
      return;
    }
    if (glSupported) {
      const cssH = card.offsetHeight || 260;
      const nextCanvas = makeDrawableCanvas(cssH);
      host.insertBefore(nextCanvas, state.canvas || card);
      card.setAttribute('drawable', '');
      moveNode(nextCanvas, card, null);
      retireCurrentCanvas();
      try {
        const stage = new ElementGL(nextCanvas, {
          fragment: NOMINAL_FRAGMENT,
          onLost: () => {
            showNotice('The WebGL context was lost. Stepping down to 2D while waiting for restore.');
            applyTier('fair', 'fallback');
          },
          onRestored: () => {
            showNotice('');
            state.glDirty = true;
            nextCanvas.requestPaint?.();
          },
        });
        state.canvas = nextCanvas;
        state.glStage = stage;
        state.glDirty = true;
        state.backend = 'webgl';
        attachWebGLPaint(nextCanvas, stage);
        state.resizeObs = watchCardResize(nextCanvas);
        startLoop();
        nextCanvas.requestPaint?.();
        state.transitionMs = performance.now() - t0;
        updateTelemetry();
        pushHistory(tier, source);
        return;
      } catch (err) {
        moveNode(host, card, nextCanvas);
        nextCanvas.remove();
        window.__gfx?.retire?.(nextCanvas);
        showNotice(`WebGL ElementGL could not start (${err.message}). Using 2D instead.`);
      }
    } else {
      showNotice('WebGL texElementSubImage2D() is not available here, so nominal uses the 2D canvas.');
    }
  }

  // Create a 2D drawable canvas for fair / serious (or WebGL fallback).
  const cssH = card.offsetHeight || 260;
  const nextCanvas = makeDrawableCanvas(cssH);
  host.insertBefore(nextCanvas, state.canvas || card);
  card.setAttribute('drawable', '');
  moveNode(nextCanvas, card, null);
  retireCurrentCanvas();

  const ctx = nextCanvas.getContext('2d');
  state.canvas = nextCanvas;
  state.ctx2d = ctx;
  state.backend = tier === 'serious' ? '2d-demand' : '2d-30';
  attach2DPaint(nextCanvas, ctx);
  state.resizeObs = watchCardResize(nextCanvas);
  if (state.backend === '2d-30') startLoop();
  nextCanvas.requestPaint?.();
  state.transitionMs = performance.now() - t0;
  updateTelemetry();
  pushHistory(tier, source);
}
// #endregion tiers

function pushHistory(tier, source) {
  const now = new Date();
  const ts = `${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  state.history.push({ tier, source, ts });
  if (state.history.length > 14) state.history.shift();
  timelineEl.replaceChildren(
    ...state.history.map((item) => {
      const chip = document.createElement('span');
      chip.className = 'tl-chip';
      const dot = document.createElement('span');
      dot.className = 'tl-dot';
      dot.dataset.tier = item.tier;
      chip.append(dot, `${item.tier} · ${item.source} · ${item.ts}`);
      return chip;
    }),
  );
}

function updateTelemetry() {
  const info = TIER_INFO[state.tier];
  statTier.dataset.tier = state.tier;
  statTier.textContent = `${state.tier} (${state.source})`;
  statBackend.textContent = state.backend === 'plain' ? 'Plain DOM' : info.backend;

  const now = performance.now();
  while (state.frameTimes.length && now - state.frameTimes[0] > 1000) state.frameTimes.shift();
  if (state.backend === 'plain') statFps.textContent = '0 fps (DOM)';
  else if (state.backend === '2d-demand') statFps.textContent = `${state.frameTimes.length} fps (on-demand)`;
  else if (!shouldAnimate()) statFps.textContent = '0 fps (paused)';
  else statFps.textContent = `${state.frameTimes.length} fps`;

  const mem = window.__gfx?.memory?.();
  if (mem) statMemory.textContent = `${formatMB(mem.bytes)} (${mem.canvases})`;
  else statMemory.textContent = state.canvas ? 'active (1)' : '0.0 MB (0)';

  statTransition.textContent = `${state.transitionMs.toFixed(1)} ms`;
}

// Refresh telemetry counters cleanly outside the canvas.
setInterval(updateTelemetry, 400);

// Card interactions.
cardInput.addEventListener('input', () => {
  updateCardMeta('typed');
  state.glDirty = true;
  state.canvas?.requestPaint?.();
});
cardSlider.addEventListener('input', () => {
  cardSliderOut.textContent = `${cardSlider.value}%`;
  updateCardMeta(`slider ${cardSlider.value}%`);
  state.glDirty = true;
  state.canvas?.requestPaint?.();
});
for (const btn of [togRipple, togChroma, togHighlight]) {
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    updateCardMeta(`${btn.textContent} ${next ? 'on' : 'off'}`);
    state.glDirty = true;
    state.canvas?.requestPaint?.();
  });
}

// Pointer tracking for the WebGL glass ripple (forgets touch after lift).
function updatePointer(e, active) {
  const rect = host.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  state.pointer.x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  state.pointer.y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
  state.pointer.active = active ? 1 : 0;
}
host.addEventListener('pointerdown', (e) => updatePointer(e, true), { passive: true });
host.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || e.buttons > 0) updatePointer(e, true);
}, { passive: true });
host.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') state.pointer.active = 0;
}, { passive: true });
host.addEventListener('pointercancel', () => { state.pointer.active = 0; }, { passive: true });
host.addEventListener('pointerleave', () => { state.pointer.active = 0; }, { passive: true });

// Pause animation when scrolled off screen or tab is hidden.
if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(
    ([entry]) => {
      state.onScreen = entry.isIntersecting;
      if (state.onScreen) startLoop();
      else stopLoop();
    },
    { threshold: 0.05 },
  ).observe(host);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else startLoop();
});

// #region observer
let pressureObserver = null;

function setMode(mode) {
  state.mode = mode;
  for (const b of tierBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  if (mode === 'live') {
    if (state.sensorState && TIERS.includes(state.sensorState)) {
      applyTier(state.sensorState, 'sensor');
    } else {
      applyTier('fair', 'startup');
    }
  } else {
    applyTier(mode, 'manual');
  }
}

for (const btn of tierBtns) {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
}

async function startPressureObserver() {
  if (typeof PressureObserver !== 'function') {
    sensorStatusEl.textContent = 'PressureObserver is not exposed in this browser. Use the tier buttons above to step through all four modes.';
    return;
  }
  const sources = Array.isArray(PressureObserver.knownSources) ? PressureObserver.knownSources.join(', ') : 'unknown';
  sensorStatusEl.textContent = `PressureObserver is available (knownSources: ${sources}). Subscribing to cpu at 1,000 ms…`;
  try {
    pressureObserver = new PressureObserver((records) => {
      const latest = records[records.length - 1];
      if (!latest?.state) return;
      state.sensorState = latest.state;
      sensorStatusEl.textContent = `PressureObserver live cpu sample: ${latest.state} (t=${Math.round(latest.time)} ms, knownSources: ${sources}).`;
      if (state.mode === 'live' && latest.state !== state.tier) {
        applyTier(latest.state, 'sensor');
      } else if (state.mode !== 'live') {
        pushHistory(latest.state, 'sensor');
      }
    });
    await pressureObserver.observe('cpu', { sampleInterval: 1000 });
    sensorStatusEl.textContent = `PressureObserver listening on cpu (1,000 ms interval, knownSources: ${sources}). Waiting for first sample…`;
  } catch (err) {
    sensorStatusEl.textContent = `PressureObserver.observe('cpu') rejected (${err.name}: ${err.message}). Use the simulated tier buttons above.`;
  }
}
// #endregion observer

// Short CPU burst on explicit tap (1.5 s) using short-lived Workers or chunked slices.
let burning = false;
burnBtn.addEventListener('click', async () => {
  if (burning) return;
  burning = true;
  burnBtn.disabled = true;
  const durationMs = 1500;
  const endsAt = performance.now() + durationMs;
  const workers = [];
  let blobUrl = '';

  try {
    const count = Math.min(Math.max(navigator.hardwareConcurrency || 2, 2), 4);
    const code = 'let x = 1; const end = performance.now() + 1500; while (performance.now() < end) { x = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b); } postMessage(x);';
    blobUrl = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    for (let i = 0; i < count; i++) workers.push(new Worker(blobUrl));
  } catch {
    // Fall back to chunked main-thread work if Workers are unavailable.
  }

  while (performance.now() < endsAt) {
    const left = Math.max(0, (endsAt - performance.now()) / 1000);
    burnBtn.textContent = `Burning CPU… ${left.toFixed(1)} s`;
    if (!workers.length) {
      const sliceEnd = performance.now() + 35;
      let acc = 0;
      while (performance.now() < sliceEnd) acc += Math.sqrt(performance.now());
      void acc;
    }
    await new Promise((r) => setTimeout(r, 80));
  }

  for (const w of workers) w.terminate();
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  burnBtn.textContent = 'Burn CPU briefly (1.5 s)';
  burnBtn.disabled = false;
  burning = false;
});

// Start on the lightest animated drawing route (2D fair) on load, then listen to the sensor.
updateCardMeta('ready');
applyTier('fair', 'startup');
startPressureObserver();

// ---------------------------------------------------------------- Live checks (isolated fixtures)
const need = (ok, msg) => {
  if (!ok) throw new Error(msg);
  return msg;
};
const frame = () => new Promise((r) => requestAnimationFrame(r));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHECK_FRAGMENT = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

const tests = [
  {
    name: 'PressureObserver is available and lists knownSources',
    why: 'Checks typeof PressureObserver === "function", reads PressureObserver.knownSources, and tries a short observe("cpu") call.',
    run: async () => {
      need(typeof PressureObserver === 'function', 'PressureObserver is not defined in this browser.');
      const sources = Array.isArray(PressureObserver.knownSources) ? [...PressureObserver.knownSources] : [];
      let observeNote = '';
      const obs = new PressureObserver(() => {});
      try {
        await obs.observe('cpu', { sampleInterval: 1000 });
        observeNote = 'observe("cpu") resolved';
      } catch (err) {
        observeNote = `observe("cpu") threw ${err.name}: ${err.message}`;
      } finally {
        try { obs.disconnect(); } catch {}
      }
      return `PressureObserver present; knownSources=[${sources.join(', ')}]; ${observeNote}.`;
    },
  },
  {
    name: 'Stepping through nominal -> fair -> serious -> critical -> nominal keeps input value and retires canvases',
    why: 'Moves a fixture card with an <input> through WebGL, 2D, on-demand 2D, plain DOM and back to WebGL, verifying the typed text at every tier and that window.__gfx.memory() releases the fixture canvases on critical.',
    timeout: 12000,
    run: async () => {
      need(canvas2dSupported, 'HTML-in-canvas drawElementImage() is not available.');
      need(glSupported, 'WebGL texElementSubImage2D() is not available.');
      const gfx = window.__gfx;
      const baseBytes = gfx?.memory ? gfx.memory().bytes : 0;

      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:220px;height:100px;flex:none';
      const fxCard = document.createElement('div');
      fxCard.style.cssText = 'box-sizing:border-box;width:220px;height:100px;padding:10px;background:#1e293b;color:#fff';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'pressure-check-42';
      input.style.cssText = 'width:180px;height:30px';
      fxCard.append(input);
      wrap.append(fxCard);
      testStage().append(wrap);

      let activeCanvas = null;
      let activeStage = null;
      const cleanCanvas = () => {
        if (activeStage) { activeStage.dispose(); activeStage = null; }
        if (activeCanvas) {
          const old = activeCanvas;
          activeCanvas = null;
          old.remove();
          window.__gfx?.retire?.(old);
        }
      };

      try {
        // 1. nominal (WebGL via ElementGL)
        const glCanvas = makeDrawableCanvas(100);
        glCanvas.style.width = '220px';
        wrap.insertBefore(glCanvas, fxCard);
        fxCard.setAttribute('drawable', '');
        moveNode(glCanvas, fxCard, null);
        activeCanvas = glCanvas;
        activeStage = new ElementGL(glCanvas, { fragment: CHECK_FRAGMENT });
        glCanvas.addEventListener('paint', () => {
          if (!activeStage || activeStage.lost) return;
          activeStage.upload(fxCard);
          if (!activeStage.begin([0, 0, 0, 0])) return;
          activeStage.quad(fxCard, ElementGL.rect(glCanvas, 0, 0, 220, 100));
        });
        glCanvas.requestPaint?.();
        await frame();
        await frame();
        need(input.value === 'pressure-check-42', `Input lost on nominal: "${input.value}"`);
        const peakBytes = gfx?.memory ? gfx.memory().bytes : 0;

        // 2. fair (2D 30 fps)
        const c2d = makeDrawableCanvas(100);
        c2d.style.width = '220px';
        wrap.insertBefore(c2d, activeCanvas);
        moveNode(c2d, fxCard, null);
        cleanCanvas();
        activeCanvas = c2d;
        const ctx = c2d.getContext('2d');
        c2d.addEventListener('paint', () => {
          const { w, h } = backingSize(220, 100);
          if (c2d.width !== w || c2d.height !== h) { c2d.width = w; c2d.height = h; }
          const k = c2d.width / 220;
          ctx.reset();
          ctx.scale(k, k);
          ctx.drawElementImage(fxCard, 0, 0, fxCard.offsetWidth, fxCard.offsetHeight);
        });
        c2d.requestPaint?.();
        await frame();
        need(input.value === 'pressure-check-42', `Input lost on fair: "${input.value}"`);

        // 3. serious (2D on-demand)
        c2d.requestPaint?.();
        await frame();
        need(input.value === 'pressure-check-42', `Input lost on serious: "${input.value}"`);

        // 4. critical (plain DOM, retire canvas)
        moveNode(wrap, fxCard, activeCanvas);
        fxCard.removeAttribute('drawable');
        cleanCanvas();
        need(input.value === 'pressure-check-42', `Input lost on critical: "${input.value}"`);
        need(wrap.firstElementChild === fxCard, 'Card was not restored directly into host on critical.');

        // Wait for context-guard retirement tick (>200 ms + 500 ms interval).
        await sleep(900);
        const criticalBytes = gfx?.memory ? gfx.memory().bytes : 0;
        const fixtureDelta = Math.max(0, criticalBytes - baseBytes);
        need(fixtureDelta === 0, `Fixture canvas memory did not return to baseline on critical (delta ${formatMB(fixtureDelta)}).`);

        // 5. nominal again
        const glCanvas2 = makeDrawableCanvas(100);
        glCanvas2.style.width = '220px';
        wrap.insertBefore(glCanvas2, fxCard);
        fxCard.setAttribute('drawable', '');
        moveNode(glCanvas2, fxCard, null);
        activeCanvas = glCanvas2;
        activeStage = new ElementGL(glCanvas2, { fragment: CHECK_FRAGMENT });
        glCanvas2.requestPaint?.();
        await frame();
        need(input.value === 'pressure-check-42', `Input lost returning to nominal: "${input.value}"`);

        const peakFixture = Math.max(0, peakBytes - baseBytes);
        return `Input "${input.value}" kept across all 5 steps; fixture memory peaked at ${formatMB(peakFixture)} and dropped to 0.0 MB on critical (page total ${formatMB(criticalBytes)}).`;
      } finally {
        if (fxCard.parentNode !== wrap) moveNode(wrap, fxCard, null);
        cleanCanvas();
      }
    },
  },
  {
    name: 'moveBefore() keeps DOM element identity (===) across canvas <-> plain DOM handoff',
    why: 'Verifies Element.prototype.moveBefore exists and that moving a card into a drawable canvas and back keeps strict node identity for both the card and its input.',
    run: async () => {
      need(typeof Element.prototype.moveBefore === 'function', 'Element.prototype.moveBefore is not available in this browser.');
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:relative;width:200px;height:80px;flex:none';
      const fxCard = document.createElement('div');
      fxCard.style.cssText = 'width:200px;height:80px;background:#0f766e;color:#fff;padding:8px';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = 'identity';
      input.setSelectionRange(2, 6);
      fxCard.append(input);
      wrap.append(fxCard);
      testStage().append(wrap);

      const cardRef = fxCard;
      const inputRef = input;
      const c = makeDrawableCanvas(80);
      c.style.width = '200px';
      wrap.insertBefore(c, fxCard);
      fxCard.setAttribute('drawable', '');
      c.moveBefore(fxCard, null);
      const sameInCanvas = c.firstElementChild === cardRef && c.querySelector('input') === inputRef;

      wrap.moveBefore(fxCard, c);
      fxCard.removeAttribute('drawable');
      c.remove();
      window.__gfx?.retire?.(c);
      const sameInDom = wrap.firstElementChild === cardRef && wrap.querySelector('input') === inputRef;
      const keptText = inputRef.value === 'identity' && inputRef.selectionStart === 2 && inputRef.selectionEnd === 6;

      need(sameInCanvas && sameInDom && keptText, `Identity in canvas: ${sameInCanvas}, back in DOM: ${sameInDom}, value/selection kept: ${keptText}.`);
      return 'Card === and input === preserved across canvas -> DOM moveBefore() handoff with selection 2..6 intact.';
    },
  },
  {
    name: 'updateElementGeometry() keeps hit-testing aligned on the WebGL tier',
    why: 'Draws a card with a button at offset (24, 18) inside an ElementGL canvas, updates its geometry and clears Chromium\'s hit-test cache, then checks document.elementFromPoint().',
    run: async () => {
      need(canvas2dSupported && glSupported, 'WebGL HTML-in-canvas (texElementSubImage2D) is not available.');
      const c = makeDrawableCanvas(140);
      c.style.width = '260px';
      const fxCard = document.createElement('div');
      fxCard.setAttribute('drawable', '');
      fxCard.style.cssText = 'box-sizing:border-box;width:180px;height:80px;padding:16px;background:#1e3a8a;display:flex;align-items:center;justify-content:center';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Target';
      btn.style.cssText = 'width:110px;height:40px';
      fxCard.append(btn);
      c.append(fxCard);
      testStage().append(c);

      const stage = new ElementGL(c, { fragment: CHECK_FRAGMENT });
      const ox = 24, oy = 18;
      try {
        await new Promise((resolve) => {
          const onPaint = () => {
            if (stage.lost) return;
            stage.upload(fxCard);
            if (!stage.begin([0.05, 0.05, 0.08, 1])) return;
            stage.quad(fxCard, ElementGL.rect(c, ox, oy, fxCard.offsetWidth, fxCard.offsetHeight));
            const unit = geometryUnit(c, fxCard, fxCard.offsetWidth || 180);
            c.updateElementGeometry(fxCard, {
              canvasTransform: new DOMMatrix().scale(unit).translate(ox, oy),
            });
            fxCard.dataset.hitTick = fxCard.dataset.hitTick === '1' ? '0' : '1';
            resolve();
          };
          c.addEventListener('paint', onPaint, { once: true });
          c.requestPaint?.();
        });
        await frame();
        const cr = c.getBoundingClientRect();
        const cx = cr.left + ox + fxCard.offsetWidth / 2;
        const cy = cr.top + oy + fxCard.offsetHeight / 2;
        const hit = document.elementFromPoint(cx, cy);
        const ok = hit === btn || hit === fxCard || fxCard.contains(hit);
        need(ok, `elementFromPoint(${Math.round(cx)}, ${Math.round(cy)}) returned <${hit?.localName ?? 'null'}> instead of the button inside the WebGL card.`);
        return `elementFromPoint(${Math.round(cx)}, ${Math.round(cy)}) hit <${hit.localName}> at offset (${ox}, ${oy}) inside the ElementGL canvas.`;
      } finally {
        stage.dispose();
        c.remove();
        window.__gfx?.retire?.(c);
      }
    },
  },
];

runTests($('tests'), tests);
