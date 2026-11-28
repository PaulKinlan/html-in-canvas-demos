import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

export const MAX_BLUR_PX = 22.0;
export const QUAD_PAD_CSS = 26.0;
export const BREATHE_FACTOR = 0.015;
export const APERTURE_MIN = 1.4;
export const APERTURE_MAX = 11.0;

export const PLANE_SPECS = [
  { id: 'bg', label: 'Far', z: 0.0 },
  { id: 'mid', label: 'Mid', z: 0.5 },
  { id: 'fg', label: 'Near', z: 1.0 },
];

// #region rack-optics
/**
 * Compute normalized Circle of Confusion (0..1) for a depth plane given the
 * active focal plane depth (0..1) and lens f-stop (f/1.4..f/11).
 */
export function computePlaneCoC(planeZ, focusDepth, fStop) {
  const dz = Math.abs(planeZ - focusDepth);
  const invN = 1 / clamp(fStop, APERTURE_MIN, APERTURE_MAX);
  const invOpen = 1 / APERTURE_MIN;
  const invClosed = 1 / 14.0;
  const apertureGain = clamp((invN - invClosed) / (invOpen - invClosed), 0, 1);
  return clamp(dz * apertureGain, 0, 1);
}

/**
 * Create a deterministic damped-spring state for cinema rack transitions.
 */
export function createRackSpring(fromDepth, targetDepth, startMs, initVel = 0) {
  return {
    from: clamp(fromDepth, 0, 1),
    to: clamp(targetDepth, 0, 1),
    v0: initVel,
    startMs,
  };
}

/**
 * Evaluate the spring deterministically at timestamp `tMs`.
 * Under reduced motion, snaps directly to `spring.to` with zero overshoot.
 */
export function evaluateFocusSpring(spring, tMs, reducedMotion = false) {
  if (!spring) return { depth: 0.5, vel: 0, settled: true };
  if (reducedMotion || tMs <= spring.startMs && Math.abs(spring.to - spring.from) < 1e-4) {
    return {
      depth: reducedMotion ? spring.to : spring.from,
      vel: 0,
      settled: reducedMotion || Math.abs(spring.to - spring.from) < 1e-4,
    };
  }
  const dt = Math.max(0, (tMs - spring.startMs) / 1000);
  const omega = 11.2;
  const zeta = 0.90;
  const omegaD = omega * Math.sqrt(1 - zeta * zeta);
  const x0 = spring.from - spring.to;
  const v0 = spring.v0;
  const B = (v0 + zeta * omega * x0) / omegaD;
  const env = Math.exp(-zeta * omega * dt);
  const cosT = Math.cos(omegaD * dt);
  const sinT = Math.sin(omegaD * dt);

  const rawDepth = spring.to + env * (x0 * cosT + B * sinT);
  const vel = env * ((B * omegaD - x0 * zeta * omega) * cosT - (x0 * omegaD + B * zeta * omega) * sinT);
  const settled = dt > 0.02 && (Math.abs(rawDepth - spring.to) < 0.0008 && Math.abs(vel) < 0.004 || dt > 1.25);

  return {
    depth: settled ? spring.to : clamp(rawDepth, 0, 1),
    vel: settled ? 0 : vel,
    settled,
  };
}

/**
 * Compute CSS pixel positions and target layout widths for the 3 overlapping
 * depth planes so every plane's primary controls remain uncovered and inside bounds.
 */
export function computePlaneLayout(cw, ch, sizes = {}) {
  const safeCw = Math.max(260, cw);
  const safeCh = Math.max(320, ch);
  const wide = safeCw >= 540;

  const bgW = Math.min(472, Math.max(240, Math.round(safeCw - (wide ? 120 : 22))));
  const midW = Math.min(396, Math.max(230, Math.round(safeCw - (wide ? 180 : 46))));
  const fgW = Math.min(276, Math.max(228, Math.round(safeCw - (wide ? 220 : 54))));

  const bgH = sizes.bgH || 248;
  const midH = sizes.midH || 192;
  const fgH = sizes.fgH || 94;

  const bgX = wide ? Math.max(18, Math.round((safeCw - bgW) * 0.5 - 36)) : 10;
  const bgY = wide ? 16 : 12;

  const midX = wide
    ? clamp(Math.round((safeCw - midW) * 0.5 + 18), bgX + 42, safeCw - midW - 18)
    : clamp(Math.round((safeCw - midW) * 0.5 + 5), bgX + 14, safeCw - midW - 10);
  const midY = wide ? 122 : 114;

  const fgX = clamp(
    wide ? Math.round(midX + midW - fgW * 0.62) : safeCw - fgW - 10,
    12,
    safeCw - fgW - 10
  );
  const fgY = clamp(
    Math.round(midY + midH - 46),
    midY + 124,
    safeCh - fgH - 12
  );

  return {
    cw: safeCw,
    ch: safeCh,
    bg: { x: bgX, y: bgY, w: bgW, h: bgH },
    mid: { x: midX, y: midY, w: midW, h: midH },
    fg: { x: fgX, y: fgY, w: fgW, h: fgH },
  };
}
// #endregion rack-optics

// #region rack-shader
export const FOCUS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform vec2 uCanvasSize;
uniform vec2 uDispSize;
uniform vec2 uTexSize;
uniform float uPadCss;
uniform float uBlurPx;
uniform float uCoC;
uniform float uFocusDepth;
uniform float uPlaneZ;
uniform float uDim;
uniform float uCoating;
uniform float uHdrBloom;
uniform float uGainEv;

in vec2 vUv;
out vec4 outColor;

const float GOLDEN_ANGLE = 2.39996323;
const int BOKEH_TAPS = 24;

float ignNoise(vec2 fragCoord) {
  return fract(52.9829189 * fract(dot(fragCoord, vec2(0.06711056, 0.00583715))));
}

void main() {
  if (uPass == 0) {
    vec2 p = vUv - 0.5;
    float aspect = uCanvasSize.x / max(uCanvasSize.y, 1.0);
    vec2 pa = vec2(p.x * aspect, p.y);
    float r = length(pa);

    vec3 edgeCol = uDim > 0.5 ? vec3(0.016, 0.020, 0.030) : vec3(0.032, 0.040, 0.058);
    vec3 centerCol = uDim > 0.5 ? vec3(0.038, 0.046, 0.068) : vec3(0.068, 0.086, 0.128);
    vec3 col = mix(centerCol, edgeCol, smoothstep(0.08, 0.72, r));

    vec3 coatTint = uCoating > 0.5 ? vec3(0.18, 0.09, 0.24) : vec3(0.06, 0.14, 0.24);
    col += coatTint * exp(-r * 3.0) * (uDim > 0.5 ? 0.14 : 0.28);

    float ringR = mix(0.26, 0.44, uFocusDepth);
    float ring = exp(-pow((r - ringR) / 0.0045, 2.0));
    col += vec3(0.28, 0.58, 0.86) * ring * (uDim > 0.5 ? 0.08 : 0.14);

    outColor = vec4(col, 1.0);
    return;
  }

  vec2 paddedSize = uDispSize + vec2(uPadCss * 2.0);
  vec2 localCss = vUv * paddedSize - vec2(uPadCss);
  vec2 elemUv = localCss / max(uDispSize, vec2(1.0));

  // Crisp single-tap path when the plane sits at the focal plane.
  if (uBlurPx < 0.25) {
    if (elemUv.x < 0.0 || elemUv.x > 1.0 || elemUv.y < 0.0 || elemUv.y > 1.0) {
      outColor = vec4(0.0);
      return;
    }
    vec4 sharp = textureLod(uTex, elemUv, 0.0);
    float dimMul = (uDim > 0.5 && uPlaneZ < 0.9) ? 0.84 : 1.0;
    outColor = vec4(sharp.rgb * dimMul, sharp.a);
    return;
  }

  // 24-tap golden-angle Poisson disc bokeh paired with trilinear mipmap LOD
  // so crisp 1 px UI text dissolves smoothly without ghost echoes.
  float texScale = max(uTexSize.x / max(uDispSize.x, 1.0), uTexSize.y / max(uDispSize.y, 1.0));
  float blurTexPx = uBlurPx * texScale;
  float lod = clamp(log2(max(1.0, blurTexPx * 0.34)), 0.0, 4.2);
  float jitterAng = ignNoise(gl_FragCoord.xy) * 6.2831853;

  vec3 accRgb = vec3(0.0);
  float accAlpha = 0.0;
  float wAlphaSum = 0.0;
  float bloomBias = uHdrBloom > 0.5 ? (1.25 + 0.55 * uGainEv) : 0.24;

  for (int k = 0; k < BOKEH_TAPS; k++) {
    float fk = float(k);
    float rNorm = sqrt((fk + 0.5) / float(BOKEH_TAPS));
    float ang = fk * GOLDEN_ANGLE + jitterAng;
    vec2 dir = vec2(cos(ang), sin(ang));
    vec2 tapCss = localCss + dir * (rNorm * uBlurPx);
    vec2 tapUv = tapCss / max(uDispSize, vec2(1.0));

    float ringW = mix(0.82, 1.24, smoothstep(0.35, 1.0, rNorm));
    wAlphaSum += ringW;

    if (tapUv.x >= 0.0 && tapUv.x <= 1.0 && tapUv.y >= 0.0 && tapUv.y <= 1.0) {
      vec4 t = textureLod(uTex, tapUv, lod);
      if (t.a > 0.002) {
        vec3 straight = clamp(t.rgb / t.a, 0.0, 1.0);
        vec3 lin = pow(straight, vec3(2.2));
        float lum = dot(straight, vec3(0.2126, 0.7152, 0.0722));
        float maxC = max(straight.r, max(straight.g, straight.b));
        float peak = max(lum, maxC * 0.92);
        float specBoost = 1.0 + bloomBias * smoothstep(0.62, 0.97, peak) * smoothstep(0.08, 0.55, uCoC);

        vec3 fringe = uCoating > 0.5
          ? mix(vec3(1.0), vec3(0.92, 0.98, 1.09), rNorm * smoothstep(0.64, 1.0, peak))
          : vec3(1.0);

        accRgb += lin * fringe * (t.a * ringW * specBoost);
        accAlpha += t.a * ringW;
      }
    }
  }

  float outAlpha = clamp(accAlpha / max(wAlphaSum, 0.0001), 0.0, 1.0);
  if (outAlpha < 0.002) {
    outColor = vec4(0.0);
    return;
  }

  vec3 straightLin = accRgb / max(accAlpha, 0.0001);
  float maxLin = max(straightLin.r, max(straightLin.g, straightLin.b));
  vec3 mappedLin = straightLin / (1.0 + 0.16 * maxLin);
  vec3 outSrgb = pow(clamp(mappedLin, 0.0, 1.0), vec3(1.0 / 2.2));

  float dimMul = (uDim > 0.5 && uPlaneZ < 0.9) ? 0.76 : 1.0;
  outSrgb *= dimMul;

  outColor = vec4(outSrgb * outAlpha, outAlpha);
}
`;
// #endregion rack-shader

// #region rack-geometry
export function syncPlaneGeometry({
  canvasEl,
  planes,
  layout,
  focusDepth,
  aperture,
  mode,
  unitCache,
  geoCache,
  force = false,
}) {
  if (!canvasEl || mode === 'plain' || typeof canvasEl.updateElementGeometry !== 'function') return;

  const ref = planes[1];
  const refW = layout[ref.id].w;
  const zoom = ref.el.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${refW}/${zoom}`;

  let unit = unitCache.unit;
  if (unitCache.key !== uKey && canvasEl.width > 0 && canvasEl.clientWidth > 0) {
    unit = geometryUnit(canvasEl, ref.el, refW);
    unitCache.unit = unit;
    unitCache.key = uKey;
  }

  for (const p of planes) {
    const r = layout[p.id];
    const coC = computePlaneCoC(p.z, focusDepth, aperture);
    const breathe = 1 + BREATHE_FACTOR * coC;
    const drawW = r.w * breathe;
    const drawH = r.h * breathe;
    const drawX = r.x - (drawW - r.w) * 0.5;
    const drawY = r.y - (drawH - r.h) * 0.5;

    const u = unit;
    const key = `${mode}|${u.toFixed(4)}|${drawX.toFixed(2)},${drawY.toFixed(2)},${breathe.toFixed(4)}`;
    if (!force && geoCache.get(p.el) === key) continue;
    geoCache.set(p.el, key);

    const mat = new DOMMatrix()
      .scale(u, u, 1)
      .translate(drawX, drawY)
      .scale(breathe, breathe, 1);

    canvasEl.updateElementGeometry(p.el, { canvasTransform: mat });
    p.el.dataset.hitTick = p.el.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion rack-geometry

export function mountRackFocus() {
  banner();

  const stageBox = document.getElementById('rf-stage');
  const viewportEl = document.getElementById('rf-viewport');
  let canvas = document.getElementById('rf-canvas');
  const plainHost = document.getElementById('plain-host');
  const noticeEl = document.getElementById('rf-notice');
  const statusEl = document.getElementById('rf-status');
  const testsBody = document.getElementById('tests');

  const bgPlaneEl = document.getElementById('rf-bg');
  const midPlaneEl = document.getElementById('rf-mid');
  const fgPlaneEl = document.getElementById('rf-fg');

  // Inside #rf-bg (far plane z = 0.0)
  const btnSwitchPlane = document.getElementById('rf-btn-switch');
  const chipHdr = document.getElementById('rf-chip-hdr');
  const chipCoating = document.getElementById('rf-chip-coating');
  const btnGain = document.getElementById('rf-btn-gain');
  const meterFill = document.getElementById('rf-meter-fill');
  const meterThumb = document.getElementById('rf-meter-thumb');
  const gainOut = document.getElementById('rf-gain-out');

  // Inside #rf-mid (mid plane z = 0.5)
  const slateInput = document.getElementById('rf-slate-input');
  const btnMarkCue = document.getElementById('rf-btn-mark-cue');
  const cueBadge = document.getElementById('rf-mid-cue-badge');
  const midSpec = document.getElementById('rf-mid-spec');

  // Inside #rf-fg (near plane z = 1.0)
  const btnApply = document.getElementById('rf-btn-apply');
  const btnDim = document.getElementById('rf-btn-dim');
  const btnFocusNear = document.getElementById('rf-btn-focus-near');
  const fgStatusOut = document.getElementById('rf-fg-status');

  // External controls
  const planeButtons = Array.from(document.querySelectorAll('button[data-plane-btn]'));
  const apertureInput = document.getElementById('ctl-aperture');
  const apertureOut = document.getElementById('out-aperture');
  const cycleBtn = document.getElementById('ctl-cycle');
  const reducedCheck = document.getElementById('ctl-reduced');

  const reducedMQ = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  if (reducedMQ.matches) reducedCheck.checked = true;

  const PLANES = [
    { id: 'bg', label: 'Far', z: 0.0, el: bgPlaneEl, tex: null, dirty: true },
    { id: 'mid', label: 'Mid', z: 0.5, el: midPlaneEl, tex: null, dirty: true },
    { id: 'fg', label: 'Near', z: 1.0, el: fgPlaneEl, tex: null, dirty: true },
  ];

  const GAIN_STEPS = [0.0, 0.6, 1.2, 1.8];
  const CYCLE_ORDER = ['bg', 'mid', 'fg', 'mid'];

  const state = {
    mode: 'init', // 'webgl' | '2d' | 'plain'
    activePlane: 'mid',
    focusDepth: 0.5,
    spring: createRackSpring(0.5, 0.5, 0, 0),
    aperture: Number(apertureInput.value) || 1.4,
    cycle: false,
    cycleIndex: 1,
    nextCycleAt: 0,
    reduced: reducedCheck.checked,
    hdrBloom: true,
    coating: false,
    gainIndex: 2, // +1.2 EV
    cueCount: 1,
    applyCount: 0,
    dimBackdrop: false,
    hasPainted: false,
    onScreen: true,
    uploads: 0,
    paints: 0,
    rafId: 0,
    lastStatusMs: -1000,
    lastWidthKey: '',
    unitCache: { key: '', unit: 1 },
    geoCache: new WeakMap(),
  };

  let stage = null;
  let ctx2d = null;

  const isReducedMotion = () => state.reduced || reducedMQ.matches;

  function showNotice(msg) {
    noticeEl.hidden = !msg;
    noticeEl.textContent = msg || '';
  }

  function markPlaneDirty(planeId) {
    for (const p of PLANES) {
      if (!planeId || p.id === planeId) p.dirty = true;
    }
  }

  function clearTextures() {
    for (const p of PLANES) {
      p.tex = null;
      p.dirty = true;
    }
  }

  function getPlaneById(id) {
    return PLANES.find((p) => p.id === id) || PLANES[1];
  }

  function nearestPlaneId(depth) {
    let best = PLANES[0];
    let bestD = Infinity;
    for (const p of PLANES) {
      const d = Math.abs(p.z - depth);
      if (d < bestD) { bestD = d; best = p; }
    }
    return best.id;
  }

  function getStageBox() {
    const cw = Math.max(260, canvas.clientWidth || viewportEl.clientWidth || 360);
    const ch = Math.max(320, canvas.clientHeight || viewportEl.clientHeight || 396);
    return { cw, ch };
  }

  function syncPlaneCSSWidths(cw) {
    if (state.mode === 'plain') {
      for (const p of PLANES) p.el.style.width = '';
      return;
    }
    const probe = computePlaneLayout(cw, 400);
    const key = `${probe.bg.w}|${probe.mid.w}|${probe.fg.w}`;
    if (state.lastWidthKey === key) return;
    state.lastWidthKey = key;
    bgPlaneEl.style.width = `${probe.bg.w}px`;
    midPlaneEl.style.width = `${probe.mid.w}px`;
    fgPlaneEl.style.width = `${probe.fg.w}px`;
    markPlaneDirty();
    state.unitCache.key = '';
    state.geoCache = new WeakMap();
  }

  function getCurrentLayout() {
    const { cw, ch } = getStageBox();
    syncPlaneCSSWidths(cw);
    return computePlaneLayout(cw, ch, {
      bgH: bgPlaneEl.offsetHeight || 248,
      midH: midPlaneEl.offsetHeight || 192,
      fgH: fgPlaneEl.offsetHeight || 94,
    });
  }

  function syncPlaneControlsUI() {
    chipHdr.setAttribute('aria-pressed', String(state.hdrBloom));
    chipCoating.setAttribute('aria-pressed', String(state.coating));
    const ev = GAIN_STEPS[state.gainIndex];
    const pct = (ev / 1.8) * 100;
    meterFill.style.width = `${pct.toFixed(0)}%`;
    meterThumb.style.left = `${pct.toFixed(0)}%`;
    gainOut.textContent = `+${ev.toFixed(1)} EV`;

    cueBadge.textContent = `CUE ${String(state.cueCount).padStart(2, '0')}`;
    midSpec.textContent = `50MM · f/${state.aperture.toFixed(1)}`;

    btnDim.setAttribute('aria-pressed', String(state.dimBackdrop));
    fgStatusOut.textContent = state.applyCount > 0
      ? `APPLIED #${state.applyCount}`
      : state.dimBackdrop ? 'DIMMED' : 'READY';

    for (const p of PLANES) {
      p.el.dataset.focused = String(p.id === state.activePlane);
    }
    for (const btn of planeButtons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.planeBtn === state.activePlane));
    }
    apertureOut.textContent = `f/${state.aperture.toFixed(1)}`;
    cycleBtn.setAttribute('aria-pressed', String(state.cycle));
  }

  function updateStatus(force = false) {
    const now = performance.now();
    if (!force && now - state.lastStatusMs < 110) return;
    state.lastStatusMs = now;
    const routeLabel = state.mode === 'webgl'
      ? 'WebGL 2 ElementGL'
      : state.mode === '2d'
        ? '2D drawElementImage()'
        : 'Plain HTML';
    const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
    const activeLabel = getPlaneById(state.activePlane).label;
    const cycleNote = state.cycle ? ' · cycling' : '';
    statusEl.textContent =
      `${routeLabel} · Focus ${activeLabel} (z=${state.focusDepth.toFixed(2)}) · f/${state.aperture.toFixed(1)} · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads${cycleNote}.`;
  }

  // Selectstart guard keeps clicks and drags on planes from highlighting labels
  // while leaving text selection enabled inside the editable slate <input>.
  viewportEl.addEventListener('selectstart', (e) => {
    const t = e.target;
    if (t instanceof Element && t.closest('input, textarea')) return;
    e.preventDefault();
  });

  // #region rack-pipeline
  function uploadMipmappedTexture(stageObj, element) {
    const tex = stageObj.upload(element);
    if (tex) {
      const gl = stageObj.gl;
      gl.bindTexture(gl.TEXTURE_2D, tex.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    return tex;
  }

  function uploadDirtyPlanes(changedElements = null) {
    if (!state.hasPainted || !stage || stage.lost) return;
    const inputFocused = document.activeElement === slateInput;
    for (const p of PLANES) {
      const inputChanged = inputFocused && p.id === 'mid' && changedElements
        ? changedElements.some((node) => node === p.el || p.el.contains(node))
        : false;
      if (!p.tex || p.dirty || inputChanged) {
        try {
          const tex = uploadMipmappedTexture(stage, p.el);
          if (tex) {
            p.tex = tex;
            p.dirty = false;
            state.uploads++;
          }
        } catch (err) {
          if (/paint record/i.test(err?.message ?? '')) {
            canvas.requestPaint?.();
          } else {
            throw err;
          }
        }
      }
    }
  }

  function drawWebGL(changedElements = null, forceGeo = false, allowUpload = false) {
    if (!state.hasPainted || !stage || stage.lost) return;
    const layout = getCurrentLayout();
    if (layout.cw <= 0 || layout.ch <= 0) return;

    // Always call stage.begin() BEFORE stage.upload() so buffer sizing matches CSS pixels.
    if (!stage.begin([0.035, 0.042, 0.064, 1.0])) return;

    if (allowUpload) {
      uploadDirtyPlanes(changedElements);
    }
    if (PLANES.some((p) => !p.tex)) return;

    const gainEv = GAIN_STEPS[state.gainIndex];
    const commonUniforms = (gl, u) => {
      gl.uniform2f(u('uCanvasSize'), layout.cw, layout.ch);
      gl.uniform1f(u('uFocusDepth'), state.focusDepth);
      gl.uniform1f(u('uDim'), state.dimBackdrop ? 1.0 : 0.0);
      gl.uniform1f(u('uCoating'), state.coating ? 1.0 : 0.0);
      gl.uniform1f(u('uHdrBloom'), state.hdrBloom ? 1.0 : 0.0);
      gl.uniform1f(u('uGainEv'), gainEv);
    };

    // Pass 0: subtle dark optical studio vignette directly to default framebuffer.
    stage.quad(PLANES[0].el, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (gl, u) => {
      gl.uniform1i(u('uPass'), 0);
      gl.uniform2f(u('uTexSize'), PLANES[0].tex.w, PLANES[0].tex.h);
      commonUniforms(gl, u);
    });

    // Pass 1: composite all 3 depth planes back-to-front (bg -> mid -> fg).
    for (const p of PLANES) {
      const r = layout[p.id];
      const coC = computePlaneCoC(p.z, state.focusDepth, state.aperture);
      const blurPx = coC * MAX_BLUR_PX;
      const breathe = 1 + BREATHE_FACTOR * coC;
      const dispW = r.w * breathe;
      const dispH = r.h * breathe;
      const dispX = r.x - (dispW - r.w) * 0.5;
      const dispY = r.y - (dispH - r.h) * 0.5;

      const pad = blurPx < 0.25 ? 0.0 : QUAD_PAD_CSS;
      const qx = dispX - pad;
      const qy = dispY - pad;
      const qw = dispW + pad * 2;
      const qh = dispH + pad * 2;

      stage.quad(p.el, ElementGL.rect(canvas, qx, qy, qw, qh), (gl, u) => {
        gl.uniform1i(u('uPass'), 1);
        gl.uniform2f(u('uDispSize'), dispW, dispH);
        gl.uniform2f(u('uTexSize'), p.tex.w, p.tex.h);
        gl.uniform1f(u('uPadCss'), pad);
        gl.uniform1f(u('uBlurPx'), blurPx);
        gl.uniform1f(u('uCoC'), coC);
        gl.uniform1f(u('uPlaneZ'), p.z);
        commonUniforms(gl, u);
      });
    }

    stage.gl.bindVertexArray(null);

    syncPlaneGeometry({
      canvasEl: canvas,
      planes: PLANES,
      layout,
      focusDepth: state.focusDepth,
      aperture: state.aperture,
      mode: state.mode,
      unitCache: state.unitCache,
      geoCache: state.geoCache,
      force: forceGeo,
    });

    updateStatus();
  }
  // #endregion rack-pipeline

  // #region rack-fallbacks
  function draw2DFallback(forceGeo = false) {
    if (!state.hasPainted || !ctx2d) return;
    const layout = getCurrentLayout();
    const { cw, ch } = layout;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;

    ctx2d.save();
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    const grad = ctx2d.createRadialGradient(cw * 0.5, ch * 0.45, 20, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.72);
    grad.addColorStop(0, state.dimBackdrop ? '#0b101b' : '#121928');
    grad.addColorStop(1, state.dimBackdrop ? '#05070c' : '#090d16');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, 0, cw, ch);

    for (const p of PLANES) {
      const r = layout[p.id];
      const coC = computePlaneCoC(p.z, state.focusDepth, state.aperture);
      const blurPx = coC * MAX_BLUR_PX;
      const breathe = 1 + BREATHE_FACTOR * coC;
      const dispW = r.w * breathe;
      const dispH = r.h * breathe;
      const dispX = r.x - (dispW - r.w) * 0.5;
      const dispY = r.y - (dispH - r.h) * 0.5;

      ctx2d.save();
      ctx2d.filter = blurPx >= 0.6 ? `blur(${(blurPx * 0.45).toFixed(1)}px)` : 'none';
      if (state.dimBackdrop && p.z < 0.9) ctx2d.globalAlpha = 0.82;
      // 5-argument drawElementImage() scales cleanly on high-DPI phones.
      ctx2d.drawElementImage(p.el, dispX, dispY, dispW, dispH);
      ctx2d.restore();
    }
    ctx2d.restore();

    syncPlaneGeometry({
      canvasEl: canvas,
      planes: PLANES,
      layout,
      focusDepth: state.focusDepth,
      aperture: state.aperture,
      mode: state.mode,
      unitCache: state.unitCache,
      geoCache: state.geoCache,
      force: forceGeo,
    });
    updateStatus();
  }

  function syncPlainLayout() {
    if (state.mode !== 'plain') return;
    const cw = Math.max(260, plainHost.clientWidth || viewportEl.clientWidth || 360);
    const ch = Math.max(360, plainHost.clientHeight || 396);
    const layout = computePlaneLayout(cw, ch, {
      bgH: bgPlaneEl.offsetHeight || 248,
      midH: midPlaneEl.offsetHeight || 192,
      fgH: fgPlaneEl.offsetHeight || 94,
    });
    plainHost.style.minHeight = `${ch}px`;
    PLANES.forEach((p, idx) => {
      const r = layout[p.id];
      const coC = computePlaneCoC(p.z, state.focusDepth, state.aperture);
      const breathe = 1 + BREATHE_FACTOR * coC;
      const blurPx = coC * MAX_BLUR_PX * 0.42;
      p.el.style.width = `${r.w}px`;
      p.el.style.transformOrigin = 'center center';
      p.el.style.transform = `translate(${r.x}px, ${r.y}px) scale(${breathe.toFixed(4)})`;
      p.el.style.zIndex = String(idx + 1);
      p.el.style.filter = blurPx >= 0.4 ? `blur(${blurPx.toFixed(1)}px)` : 'none';
      p.el.style.opacity = state.dimBackdrop && p.z < 0.9 ? '0.78' : '1';
    });
    updateStatus(true);
  }

  function enterPlainFallback(reason) {
    state.mode = 'plain';
    stopLoop();
    stageBox.classList.add('is-plain');
    for (const p of PLANES) {
      p.el.inert = false;
      if (p.el.parentElement !== plainHost) plainHost.append(p.el);
    }
    showNotice(reason);
    syncPlainLayout();
  }

  function exitPlainFallback() {
    stageBox.classList.remove('is-plain');
    for (const p of PLANES) {
      p.el.style.transform = '';
      p.el.style.transformOrigin = '';
      p.el.style.zIndex = '';
      p.el.style.filter = '';
      p.el.style.opacity = '';
      if (p.el.parentElement !== canvas) canvas.append(p.el);
    }
    state.lastWidthKey = '';
    state.unitCache.key = '';
    state.geoCache = new WeakMap();
    showNotice('');
  }
  // #endregion rack-fallbacks

  function drawCurrentFrame(forceGeo = false) {
    if (state.mode === 'plain') {
      syncPlainLayout();
      return;
    }
    if (!state.hasPainted) {
      canvas.requestPaint?.();
      return;
    }
    if (state.mode === 'webgl') drawWebGL(null, forceGeo, false);
    else if (state.mode === '2d') draw2DFallback(forceGeo);
  }

  function needsLoop() {
    if (!state.onScreen || document.hidden || state.mode === 'plain') return false;
    if (state.cycle && !isReducedMotion()) return true;
    const cur = evaluateFocusSpring(state.spring, performance.now(), isReducedMotion());
    return !cur.settled;
  }

  function stopLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  function startLoop() {
    if (!state.rafId && needsLoop()) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    state.rafId = 0;
    if (!state.onScreen || document.hidden || state.mode === 'plain') return;
    const reduced = isReducedMotion();

    if (state.cycle && !reduced && now >= state.nextCycleAt) {
      state.cycleIndex = (state.cycleIndex + 1) % CYCLE_ORDER.length;
      const nextId = CYCLE_ORDER[state.cycleIndex];
      rackToPlane(nextId, { fromCycle: true, nowMs: now });
      state.nextCycleAt = now + 1350;
    }

    const ev = evaluateFocusSpring(state.spring, now, reduced);
    state.focusDepth = ev.depth;
    drawCurrentFrame(ev.settled);

    if (needsLoop()) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function rackToPlane(planeId, { fromCycle = false, nowMs = performance.now() } = {}) {
    const targetPlane = getPlaneById(planeId);
    if (!fromCycle && state.cycle) {
      state.cycle = false;
    }
    state.activePlane = targetPlane.id;

    const reduced = isReducedMotion();
    const cur = evaluateFocusSpring(state.spring, nowMs, reduced);
    if (reduced) {
      state.focusDepth = targetPlane.z;
      state.spring = createRackSpring(targetPlane.z, targetPlane.z, nowMs, 0);
      syncPlaneControlsUI();
      drawCurrentFrame(true);
      updateStatus(true);
      return;
    }

    state.spring = createRackSpring(cur.depth, targetPlane.z, nowMs, cur.vel);
    syncPlaneControlsUI();
    drawCurrentFrame(false);
    startLoop();
  }

  function wireCanvasEvents(cv) {
    cv.addEventListener('paint', (e) => {
      state.paints++;
      state.hasPainted = true;
      const changed = e?.changedElements ? Array.from(e.changedElements) : null;
      if (state.mode === 'webgl' && stage && !stage.lost) {
        drawWebGL(changed, true, true);
      } else if (state.mode === '2d' && ctx2d) {
        draw2DFallback(true);
      }
      startLoop();
    });

    cv.addEventListener('contextlost', (e) => {
      e.preventDefault();
      if (state.mode === '2d') {
        state.hasPainted = false;
        enterPlainFallback('The 2D canvas context was lost. Showing the three depth planes as plain HTML.');
      }
    });

    cv.addEventListener('contextrestored', () => {
      if (state.mode === 'plain' && ctx2d) {
        state.mode = '2d';
        state.hasPainted = false;
        exitPlainFallback();
        cv.requestPaint?.();
        startLoop();
      }
    });
  }

  function initBackend() {
    syncPlaneCSSWidths(getStageBox().cw);
    syncPlaneControlsUI();

    if (hicSupported && glSupported) {
      try {
        stage = new ElementGL(canvas, {
          fragment: FOCUS_FRAG,
          attributes: { alpha: false, antialias: false, powerPreference: 'low-power' },
          onLost: () => {
            clearTextures();
            state.hasPainted = false;
            enterPlainFallback('The WebGL 2 context was lost. Moved the three planes to plain HTML until restored.');
          },
          onRestored: () => {
            stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            clearTextures();
            state.mode = 'webgl';
            state.hasPainted = false;
            exitPlainFallback();
            canvas.requestPaint?.();
            startLoop();
          },
        });
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.mode = 'webgl';
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      } catch (err) {
        stage = null;
        const fresh = document.createElement('canvas');
        fresh.id = 'rf-canvas';
        fresh.setAttribute('content', 'drawable');
        fresh.setAttribute('layoutsubtree', '');
        fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
        fresh.append(bgPlaneEl, midPlaneEl, fgPlaneEl);
        canvas.replaceWith(fresh);
        window.__gfx?.retire?.(canvas);
        canvas = fresh;
        showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
      }
    }

    if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        state.mode = '2d';
        if (noticeEl.hidden) {
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() fallback.');
        }
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      }
    }

    enterPlainFallback('HTML-in-canvas is not available in this browser, so all three planes are shown as plain HTML.');
  }

  // Interactive handlers on the 3 live drawable planes
  let pointerOnSwitch = false;
  btnSwitchPlane.addEventListener('pointerdown', () => {
    pointerOnSwitch = true;
    setTimeout(() => { pointerOnSwitch = false; }, 120);
  });

  btnSwitchPlane.addEventListener('click', (e) => {
    e.stopPropagation();
    pointerOnSwitch = false;
    const order = ['bg', 'mid', 'fg'];
    const idx = order.indexOf(state.activePlane);
    const next = order[(idx + 1) % order.length];
    markPlaneDirty('bg');
    rackToPlane(next);
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  chipHdr.addEventListener('click', (e) => {
    e.stopPropagation();
    state.hdrBloom = !state.hdrBloom;
    markPlaneDirty('bg');
    syncPlaneControlsUI();
    rackToPlane('bg');
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  chipCoating.addEventListener('click', (e) => {
    e.stopPropagation();
    state.coating = !state.coating;
    markPlaneDirty('bg');
    syncPlaneControlsUI();
    rackToPlane('bg');
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnGain.addEventListener('click', (e) => {
    e.stopPropagation();
    state.gainIndex = (state.gainIndex + 1) % GAIN_STEPS.length;
    markPlaneDirty('bg');
    syncPlaneControlsUI();
    rackToPlane('bg');
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  slateInput.addEventListener('input', () => {
    markPlaneDirty('mid');
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnMarkCue.addEventListener('click', (e) => {
    e.stopPropagation();
    state.cueCount++;
    markPlaneDirty('mid');
    syncPlaneControlsUI();
    rackToPlane('mid');
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnApply.addEventListener('click', (e) => {
    e.stopPropagation();
    state.applyCount++;
    markPlaneDirty('fg');
    syncPlaneControlsUI();
    rackToPlane('fg');
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnDim.addEventListener('click', (e) => {
    e.stopPropagation();
    state.dimBackdrop = !state.dimBackdrop;
    markPlaneDirty('fg');
    syncPlaneControlsUI();
    rackToPlane('fg');
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  btnFocusNear.addEventListener('click', (e) => {
    e.stopPropagation();
    rackToPlane('fg');
  });

  // Tapping anywhere on a plane body or tabbing focus into a plane racks focus there.
  for (const p of PLANES) {
    p.el.addEventListener('click', (e) => {
      if (e.target.closest('button') === btnSwitchPlane) return;
      rackToPlane(p.id);
    });
    p.el.addEventListener('focusin', (e) => {
      markPlaneDirty(p.id);
      if (!(e.target === btnSwitchPlane && pointerOnSwitch) && state.activePlane !== p.id) {
        rackToPlane(p.id);
      }
      if (state.mode !== 'plain') canvas.requestPaint?.();
    });
    p.el.addEventListener('focusout', () => {
      markPlaneDirty(p.id);
      if (state.mode !== 'plain') canvas.requestPaint?.();
    });
  }

  // External optical controls
  for (const btn of planeButtons) {
    btn.addEventListener('click', () => {
      rackToPlane(btn.dataset.planeBtn);
    });
  }

  apertureInput.addEventListener('input', () => {
    state.aperture = clamp(Number(apertureInput.value) || 1.4, APERTURE_MIN, APERTURE_MAX);
    markPlaneDirty('mid');
    syncPlaneControlsUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
    drawCurrentFrame(true);
  });

  cycleBtn.addEventListener('click', () => {
    if (isReducedMotion()) {
      state.cycle = false;
      syncPlaneControlsUI();
      statusEl.textContent = 'Cycle rack stays paused while Reduced motion is on. Tap any plane or Focus button to snap.';
      return;
    }
    state.cycle = !state.cycle;
    if (state.cycle) {
      state.cycleIndex = Math.max(0, CYCLE_ORDER.indexOf(nearestPlaneId(state.focusDepth)));
      const nextIdx = (state.cycleIndex + 1) % CYCLE_ORDER.length;
      state.cycleIndex = nextIdx;
      const now = performance.now();
      rackToPlane(CYCLE_ORDER[nextIdx], { fromCycle: true, nowMs: now });
      state.nextCycleAt = now + 1350;
    }
    syncPlaneControlsUI();
    updateStatus(true);
    startLoop();
  });

  function applyReducedMotionChange() {
    state.reduced = reducedCheck.checked;
    if (isReducedMotion()) {
      state.cycle = false;
      stopLoop();
      const target = getPlaneById(state.activePlane).z;
      state.focusDepth = target;
      state.spring = createRackSpring(target, target, performance.now(), 0);
    }
    syncPlaneControlsUI();
    drawCurrentFrame(true);
    updateStatus(true);
    startLoop();
  }

  reducedCheck.addEventListener('change', applyReducedMotionChange);
  reducedMQ.addEventListener?.('change', () => {
    reducedCheck.checked = reducedMQ.matches;
    applyReducedMotionChange();
  });

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(([entry]) => {
      state.onScreen = entry.isIntersecting;
      if (!state.onScreen) stopLoop();
      else {
        if (state.hasPainted) drawCurrentFrame(false);
        startLoop();
      }
    }, { rootMargin: '80px 0px' }).observe(stageBox);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else if (state.onScreen) {
      if (state.hasPainted) drawCurrentFrame(false);
      startLoop();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      if (state.mode === 'plain') {
        syncPlainLayout();
        return;
      }
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      state.unitCache.key = '';
      state.geoCache = new WeakMap();
      syncPlaneCSSWidths(cw);
      if (state.hasPainted) canvas.requestPaint?.();
    }).observe(viewportEl);
  }

  initBackend();

  // ---------------- Isolated Live Checks (Tap-Gated) ----------------

  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  async function settleGfx(baseActive) {
    if (!window.__gfx?.active) return;
    const deadline = performance.now() + 900;
    while (window.__gfx.active() > baseActive && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  function makeFixtureCanvas(w, h, innerHtml) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.width = w;
    cv.height = h;
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
    cv.innerHTML = innerHtml;
    testStage().append(cv);
    return cv;
  }

  function readCssPx(gl, cv, cssX, cssY) {
    const sx = cv.width / (cv.clientWidth || 1);
    const sy = cv.height / (cv.clientHeight || 1);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  function drawFixturePlanes(g, cv, planes, focusDepth, fStop, cw, ch) {
    if (!g.begin([0.035, 0.042, 0.064, 1.0])) return;
    g.quad(planes[0].el, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
      gl.uniform1i(u('uPass'), 0);
      gl.uniform2f(u('uCanvasSize'), cw, ch);
      gl.uniform2f(u('uTexSize'), planes[0].tex?.w || cw, planes[0].tex?.h || ch);
      gl.uniform1f(u('uFocusDepth'), focusDepth);
      gl.uniform1f(u('uDim'), 0.0);
      gl.uniform1f(u('uCoating'), 0.0);
      gl.uniform1f(u('uHdrBloom'), 1.0);
      gl.uniform1f(u('uGainEv'), 1.2);
    });
    for (const p of planes) {
      const coC = computePlaneCoC(p.z, focusDepth, fStop);
      const blurPx = coC * MAX_BLUR_PX;
      const pad = blurPx < 0.25 ? 0.0 : QUAD_PAD_CSS;
      g.quad(p.el, ElementGL.rect(cv, p.x - pad, p.y - pad, p.w + pad * 2, p.h + pad * 2), (gl, u) => {
        gl.uniform1i(u('uPass'), 1);
        gl.uniform2f(u('uCanvasSize'), cw, ch);
        gl.uniform2f(u('uDispSize'), p.w, p.h);
        gl.uniform2f(u('uTexSize'), p.tex?.w || p.w, p.tex?.h || p.h);
        gl.uniform1f(u('uPadCss'), pad);
        gl.uniform1f(u('uBlurPx'), blurPx);
        gl.uniform1f(u('uCoC'), coC);
        gl.uniform1f(u('uFocusDepth'), focusDepth);
        gl.uniform1f(u('uPlaneZ'), p.z);
        gl.uniform1f(u('uDim'), 0.0);
        gl.uniform1f(u('uCoating'), 0.0);
        gl.uniform1f(u('uHdrBloom'), 1.0);
        gl.uniform1f(u('uGainEv'), 1.2);
      });
    }
    g.gl.bindVertexArray(null);
  }

  const tests = [
    {
      name: 'ElementGL + texElementSubImage2D() uploads 3 staggered depth planes with gl.getError() === 0',
      expect: 'pass',
      timeout: 6000,
      why: 'Creates an isolated ElementGL fixture with 3 drawable planes, sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, gates stage.upload() on hasPainted after stage.begin(), and checks gl.getError() === 0 plus pixel readback from every plane.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 300;
        const H = 220;
        const cv = makeFixtureCanvas(
          W,
          H,
          '<div id="fx-bg" drawable style="position:absolute;left:0;top:0;width:220px;height:130px;background:#102244;border-radius:10px;"></div>' +
          '<div id="fx-mid" drawable style="position:absolute;left:0;top:0;width:190px;height:105px;background:#f7f2e8;border-radius:10px;"></div>' +
          '<div id="fx-fg" drawable style="position:absolute;left:0;top:0;width:150px;height:64px;background:#188855;border-radius:10px;"></div>'
        );
        const fxPlanes = [
          { el: cv.querySelector('#fx-bg'), z: 0.0, x: 10, y: 10, w: 220, h: 130, tex: null },
          { el: cv.querySelector('#fx-mid'), z: 0.5, x: 40, y: 68, w: 190, h: 105, tex: null },
          { el: cv.querySelector('#fx-fg'), z: 1.0, x: 132, y: 142, w: 150, h: 64, tex: null },
        ];
        let g = null;
        let hasPaint = false;
        try {
          g = new ElementGL(cv, { fragment: FOCUS_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            hasPaint = true;
            if (!g.begin([0.035, 0.042, 0.064, 1.0])) return;
            if (hasPaint) {
              for (const p of fxPlanes) p.tex = uploadMipmappedTexture(g, p.el);
            }
          }, { once: true });
          await nextPaint(cv);
          if (!hasPaint || fxPlanes.some((p) => !p.tex)) throw new Error('paint event did not upload all 3 planes');

          drawFixturePlanes(g, cv, fxPlanes, 0.5, 1.4, W, H);
          const glErr = g.gl.getError();
          const bgPx = readCssPx(g.gl, cv, 26, 26);
          const midPx = readCssPx(g.gl, cv, 76, 108);
          const fgPx = readCssPx(g.gl, cv, 192, 178);

          return need(
            glErr === g.gl.NO_ERROR && bgPx[2] > bgPx[0] && midPx[0] > 210 && fgPx[1] > fgPx[0],
            `gl.getError()=0; tex=${fxPlanes.map((p) => `${p.tex.w}×${p.tex.h}`).join(', ')}; bg rgb(${bgPx.slice(0, 3).join(',')}), mid rgb(${midPx.slice(0, 3).join(',')}), fg rgb(${fgPx.slice(0, 3).join(',')}).`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Focus Far -> Focus Near sharpens foreground while blurring far edge, and f/1.4 widens bokeh vs f/11',
      expect: 'pass',
      timeout: 6000,
      why: 'Uploads crisp white step targets on far (z=0.0) and near (z=1.0) planes and measures edge contrast plus 10 px outside bokeh spill across Focus Far, Focus Near at f/1.4, and Focus Near at f/11.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 280;
        const H = 150;
        const cv = makeFixtureCanvas(
          W,
          H,
          '<div id="fx-far-t" drawable style="position:absolute;left:0;top:0;width:120px;height:110px;background:#070b14;">' +
          '<div style="position:absolute;left:46px;top:25px;width:28px;height:60px;background:#ffffff;"></div></div>' +
          '<div id="fx-near-t" drawable style="position:absolute;left:0;top:0;width:120px;height:110px;background:#070b14;">' +
          '<div style="position:absolute;left:46px;top:25px;width:28px;height:60px;background:#ffffff;"></div></div>'
        );
        const fxPlanes = [
          { el: cv.querySelector('#fx-far-t'), z: 0.0, x: 10, y: 20, w: 120, h: 110, tex: null },
          { el: cv.querySelector('#fx-near-t'), z: 1.0, x: 150, y: 20, w: 120, h: 110, tex: null },
        ];
        let g = null;
        let hasPaint = false;
        try {
          g = new ElementGL(cv, { fragment: FOCUS_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            hasPaint = true;
            if (!g.begin([0.035, 0.042, 0.064, 1.0])) return;
            if (hasPaint) {
              for (const p of fxPlanes) p.tex = uploadMipmappedTexture(g, p.el);
            }
          }, { once: true });
          await nextPaint(cv);
          if (!hasPaint || fxPlanes.some((p) => !p.tex)) throw new Error('target textures failed to upload');

          const sampleTarget = (baseX) => {
            const inside = readCssPx(g.gl, cv, baseX + 54, 75)[0];
            const outNearEdge = readCssPx(g.gl, cv, baseX + 43, 75)[0];
            const spill10px = readCssPx(g.gl, cv, baseX + 36, 75)[0];
            return { edgeDelta: inside - outNearEdge, spill10px };
          };

          drawFixturePlanes(g, cv, fxPlanes, 0.0, 1.4, W, H);
          const farFocusFar = sampleTarget(10);
          const farFocusNear = sampleTarget(150);

          drawFixturePlanes(g, cv, fxPlanes, 1.0, 1.4, W, H);
          const nearFocusFar14 = sampleTarget(10);
          const nearFocusNear = sampleTarget(150);

          drawFixturePlanes(g, cv, fxPlanes, 1.0, 11.0, W, H);
          const nearFocusFar11 = sampleTarget(10);

          const ok =
            farFocusFar.edgeDelta > 200 &&
            farFocusNear.spill10px > farFocusFar.spill10px + 30 &&
            nearFocusNear.edgeDelta > 200 &&
            nearFocusFar14.spill10px > farFocusFar.spill10px + 30 &&
            nearFocusFar14.edgeDelta < nearFocusFar11.edgeDelta - 40 &&
            nearFocusFar14.spill10px > nearFocusFar11.spill10px + 25;

          return need(
            ok,
            `Far focus: farEdge=${farFocusFar.edgeDelta}, nearSpill=${farFocusNear.spill10px}; ` +
            `Near f/1.4: nearEdge=${nearFocusNear.edgeDelta}, farEdge=${nearFocusFar14.edgeDelta}, farSpill=${nearFocusFar14.spill10px}; ` +
            `Near f/11: farEdge=${nearFocusFar11.edgeDelta}, farSpill=${nearFocusFar11.spill10px}.`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Deterministic tMs spring solver smoothly glides rack focus and snaps under reduced motion',
      expect: 'pass',
      why: 'Steps createRackSpring(0.0, 1.0, 0) across deterministic tMs timestamps, checks mid-flight focus breathing scale (1 + 0.015 * coC), velocity continuity on mid-flight retargeting, and instant snap under reducedMotion.',
      run: async () => {
        const sp = createRackSpring(0.0, 1.0, 0, 0);
        const s0 = evaluateFocusSpring(sp, 0, false);
        const s120 = evaluateFocusSpring(sp, 120, false);
        const s240 = evaluateFocusSpring(sp, 240, false);
        const s950 = evaluateFocusSpring(sp, 950, false);

        const retarget = createRackSpring(s120.depth, 0.0, 120, s120.vel);
        const r120 = evaluateFocusSpring(retarget, 120, false);
        const r950 = evaluateFocusSpring(retarget, 1070, false);

        const snapped = evaluateFocusSpring(sp, 15, true);
        const coCFar = computePlaneCoC(0.0, 1.0, 1.4);
        const coCNear = computePlaneCoC(1.0, 1.0, 1.4);
        const breatheFar = 1 + BREATHE_FACTOR * coCFar;
        const breatheNear = 1 + BREATHE_FACTOR * coCNear;

        const ok =
          s0.depth === 0 &&
          s120.depth > 0.12 && s120.depth < 0.85 &&
          s240.depth > s120.depth &&
          s950.settled && Math.abs(s950.depth - 1.0) < 0.001 &&
          Math.abs(r120.depth - s120.depth) < 1e-4 &&
          r950.settled && r950.depth === 0 &&
          snapped.settled && snapped.depth === 1.0 &&
          Math.abs(breatheFar - 1.015) < 1e-5 && breatheNear === 1.0;

        return need(
          ok,
          `t=0 -> ${s0.depth.toFixed(2)}, t=120 -> ${s120.depth.toFixed(3)}, t=240 -> ${s240.depth.toFixed(3)}, t=950 -> ${s950.depth.toFixed(3)}; ` +
          `retarget continuous=${r120.depth.toFixed(3)}; reduced snap=${snapped.depth.toFixed(2)}; breathe far=${breatheFar.toFixed(4)}.`
        );
      },
    },
    {
      name: 'updateElementGeometry() + geometryUnit() keeps buttons and input clickable on all 3 depth planes',
      expect: 'pass',
      timeout: 6000,
      why: 'Positions 3 staggered drawable planes with buttons and an input on an isolated fixture using geometryUnit(), updateElementGeometry() and dataset.hitTick, then tests elementsFromPoint() and live .click() across Far and Near focus.',
      run: async () => {
        if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('updateElementGeometry() is not available.');
        }
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 320;
        const H = 300;
        const cv = makeFixtureCanvas(
          W,
          H,
          '<div id="fx-h-bg" drawable style="position:absolute;left:0;top:0;width:290px;height:140px;background:#0e1729;">' +
          '<button type="button" id="fx-b-bg" style="position:absolute;left:180px;top:12px;width:96px;height:36px;">Switch</button></div>' +
          '<div id="fx-h-mid" drawable style="position:absolute;left:0;top:0;width:270px;height:130px;background:#f8f4ec;">' +
          '<input id="fx-i-mid" type="text" inputmode="none" value="SLATE" aria-label="Fixture slate" style="position:absolute;left:14px;top:14px;width:160px;height:34px;">' +
          '<button type="button" id="fx-b-mid" style="position:absolute;left:14px;top:62px;width:96px;height:34px;">Cue</button></div>' +
          '<div id="fx-h-fg" drawable style="position:absolute;left:0;top:0;width:220px;height:78px;background:#101827;">' +
          '<button type="button" id="fx-b-fg" style="position:absolute;left:112px;top:22px;width:96px;height:36px;">Near</button></div>'
        );
        const fxPlanes = [
          { id: 'bg', z: 0.0, x: 10, y: 10, w: 290, h: 140, el: cv.querySelector('#fx-h-bg'), tex: null },
          { id: 'mid', z: 0.5, x: 24, y: 88, w: 270, h: 130, el: cv.querySelector('#fx-h-mid'), tex: null },
          { id: 'fg', z: 1.0, x: 90, y: 204, w: 220, h: 78, el: cv.querySelector('#fx-h-fg'), tex: null },
        ];
        const bBg = cv.querySelector('#fx-b-bg');
        const iMid = cv.querySelector('#fx-i-mid');
        const bMid = cv.querySelector('#fx-b-mid');
        const bFg = cv.querySelector('#fx-b-fg');
        let clicks = 0;
        for (const b of [bBg, bMid, bFg]) b.addEventListener('click', () => { clicks++; });

        const layout = {
          cw: W,
          ch: H,
          bg: { x: 10, y: 10, w: 290, h: 140 },
          mid: { x: 24, y: 88, w: 270, h: 130 },
          fg: { x: 90, y: 204, w: 220, h: 78 },
        };

        let g = null;
        let hasPaint = false;
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: FOCUS_FRAG });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.addEventListener('paint', () => {
              hasPaint = true;
              if (!g.begin([0.035, 0.042, 0.064, 1.0])) return;
              if (hasPaint) {
                for (const p of fxPlanes) p.tex = uploadMipmappedTexture(g, p.el);
              }
            }, { once: true });
          } else {
            cv.getContext('2d');
          }
          await nextPaint(cv);
          if (g && !hasPaint) throw new Error('hit-test fixture paint event did not fire');

          const unitCache = { key: '', unit: 1 };
          const geoCache = new WeakMap();
          const modeType = g ? 'webgl' : '2d';
          const cvRect = cv.getBoundingClientRect();

          const checkAt = async (depth) => {
            if (g) {
              drawFixturePlanes(g, cv, fxPlanes, depth, 1.4, W, H);
            } else {
              const c2 = cv.getContext('2d');
              c2.reset();
              for (const p of fxPlanes) {
                const r = layout[p.id];
                c2.drawElementImage(p.el, r.x, r.y, r.w, r.h);
              }
            }
            syncPlaneGeometry({
              canvasEl: cv,
              planes: fxPlanes,
              layout,
              focusDepth: depth,
              aperture: 1.4,
              mode: modeType,
              unitCache,
              geoCache,
              force: true,
            });
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            const hitCenter = (p, localX, localY, target) => {
              const coC = computePlaneCoC(p.z, depth, 1.4);
              const s = 1 + BREATHE_FACTOR * coC;
              const r = layout[p.id];
              const dx = r.x - (r.w * (s - 1)) * 0.5 + localX * s;
              const dy = r.y - (r.h * (s - 1)) * 0.5 + localY * s;
              const list = document.elementsFromPoint(cvRect.left + dx, cvRect.top + dy);
              return list.includes(target);
            };
            return (
              hitCenter(fxPlanes[0], 228, 30, bBg) &&
              hitCenter(fxPlanes[1], 94, 31, iMid) &&
              hitCenter(fxPlanes[1], 62, 79, bMid) &&
              hitCenter(fxPlanes[2], 160, 40, bFg)
            );
          };

          const farHit = await checkAt(0.0);
          const nearHit = await checkAt(1.0);
          bBg.click();
          bMid.click();
          bFg.click();

          return need(
            farHit && nearHit && clicks === 3,
            `Focus Far all-3 hit=${farHit}; Focus Near all-3 hit=${nearHit}; live clicks=${clicks}/3.`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Synthetic webglcontextlost + 5-arg 2D fallback and webglcontextrestored recovery without loseContext()',
      expect: 'pass',
      timeout: 6000,
      why: 'Tests the 5-argument drawElementImage() 2D depth stack via a plain copy canvas, then dispatches synthetic webglcontextlost and webglcontextrestored events verifying plain-HTML rescue and WebGL texture restoration.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('HTML-in-canvas WebGL 2 is not available.');
        const baseActive = window.__gfx?.active() ?? 0;

        // 1. 5-argument 2D drawElementImage() depth stack
        const cv2 = makeFixtureCanvas(
          220,
          150,
          '<div id="fx-2d-bg" drawable style="position:absolute;left:0;top:0;width:160px;height:90px;background:#163058;"></div>' +
          '<div id="fx-2d-mid" drawable style="position:absolute;left:0;top:0;width:140px;height:74px;background:#f4efe6;"></div>' +
          '<div id="fx-2d-fg" drawable style="position:absolute;left:0;top:0;width:110px;height:46px;background:#1f7a3a;"></div>'
        );
        const c2 = cv2.getContext('2d');
        await nextPaint(cv2);
        c2.clearRect(0, 0, 220, 150);
        c2.drawElementImage(cv2.querySelector('#fx-2d-bg'), 8, 8, 160, 90);
        c2.drawElementImage(cv2.querySelector('#fx-2d-mid'), 28, 42, 140, 74);
        c2.drawElementImage(cv2.querySelector('#fx-2d-fg'), 96, 94, 110, 46);

        const copy = document.createElement('canvas');
        copy.width = cv2.width;
        copy.height = cv2.height;
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(cv2, 0, 0);
        const frac2d = inkFraction(cc);
        cv2.remove();
        window.__gfx?.retire?.(cv2);

        // 2. Synthetic webglcontextlost / webglcontextrestored
        const wrap = document.createElement('div');
        const plain = document.createElement('div');
        plain.hidden = true;
        const cv = document.createElement('canvas');
        cv.setAttribute('content', 'drawable');
        cv.setAttribute('layoutsubtree', '');
        cv.width = 220;
        cv.height = 140;
        cv.style.cssText = 'display:block;width:220px;height:140px;';
        const p1 = document.createElement('div');
        p1.setAttribute('drawable', '');
        p1.style.cssText = 'position:absolute;left:0;top:0;width:140px;height:70px;background:#112238;';
        const p2 = document.createElement('div');
        p2.setAttribute('drawable', '');
        p2.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:60px;background:#fcfbf7;';
        const p3 = document.createElement('div');
        p3.setAttribute('drawable', '');
        p3.style.cssText = 'position:absolute;left:0;top:0;width:100px;height:40px;background:#101726;';
        cv.append(p1, p2, p3);
        wrap.append(cv, plain);
        testStage().append(wrap);

        let g = null;
        let lostFired = false;
        let restoredFired = false;
        let hasPaint = false;
        let t1 = null;
        let t2 = null;
        let t3 = null;
        try {
          g = new ElementGL(cv, {
            fragment: FOCUS_FRAG,
            onLost: () => {
              lostFired = true;
              hasPaint = false;
              plain.hidden = false;
              plain.append(p1, p2, p3);
            },
            onRestored: () => {
              restoredFired = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              plain.hidden = true;
              cv.append(p1, p2, p3);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          cv.addEventListener('paint', () => {
            hasPaint = true;
            if (!g.begin([0, 0, 0, 1])) return;
            if (hasPaint) {
              t1 = g.upload(p1);
              t2 = g.upload(p2);
              t3 = g.upload(p3);
            }
          });
          await nextPaint(cv);

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(lostEv);
          const inPlain = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(p1) && plain.contains(p2) && plain.contains(p3);

          t1 = null;
          t2 = null;
          t3 = null;
          cv.dispatchEvent(new Event('webglcontextrestored'));
          await nextPaint(cv);
          const err = g.gl.getError();

          return need(
            frac2d > 0.3 && inPlain && restoredFired && !g.lost && cv.contains(p3) && t1?.w > 0 && t2?.w > 0 && t3?.w > 0 && err === g.gl.NO_ERROR,
            `2D ink=${(frac2d * 100).toFixed(1)}%, preventDefault=${lostEv.defaultPrevented}, inPlain=${inPlain}, restored=${restoredFired}, glErr=${err}.`
          );
        } finally {
          g?.dispose();
          wrap.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    stillDrawn(() => [
      {
        name: 'rack-focus stage',
        ink: async () => {
          if (state.mode === 'plain') return null;
          if (state.mode === 'webgl') {
            if (!stage || stage.lost || PLANES.some((p) => !p.tex)) return 0;
            const mp = (canvas.width * canvas.height) / 1e6;
            if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
            const openSnaps = window.__gfx?.snapshots?.open ?? 0;
            if (openSnaps > 0) throw new Error(`unexpected open snapshots: ${openSnaps}`);
            return state.paints > 0 && state.uploads >= 3 ? 1 : 0;
          }
          return state.hasPainted && canvas.width > 0 && canvas.height > 0 ? 1 : 0;
        },
        rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
      },
    ]),
  ];

  runTests(testsBody, tests);
}

if (typeof document !== 'undefined' && document.getElementById('rf-canvas')) {
  mountRackFocus();
}
