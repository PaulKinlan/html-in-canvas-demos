import { banner, nextPaint, runTests, stillDrawn, supported as api2dSupported, testStage } from '/shared/support.js';
import { ElementGL, supported as elGlSupported } from '/lib/element-gl.js';
import { cssZoom, geometryUnit } from '/lib/surface.js';

banner();

export const F_MIN = 18;
export const F_MAX = 135;
export const F_REF = 50;
export const D_REF = 2.40;
export const PX_PER_M_REF = 240;
export const Z_HERO = 0.0;
export const Z_BG = -5.40;
export const HERO_DEFAULT_W = 252;
export const HERO_DEFAULT_H = 188;
export const BG_DEFAULT_W = 440;
export const BG_DEFAULT_H = 292;
export const BG_WORLD_W = 8.40;
export const BG_WORLD_H = BG_WORLD_W * (BG_DEFAULT_H / BG_DEFAULT_W);
export const BG_WORLD_Y = 0.16;

const SHOTS = {
  vertigo: {
    id: 0,
    title: 'VERTIGO',
    badge: 'VERTIGO · BELL TOWER',
    defaultFocal: 28,
    accent: [1.0, 0.42, 0.24],
    clear: [0.07, 0.03, 0.03, 1],
  },
  jaws: {
    id: 1,
    title: 'JAWS',
    badge: 'JAWS · AMITY PIER',
    defaultFocal: 86,
    accent: [0.22, 0.74, 0.97],
    clear: [0.03, 0.06, 0.11, 1],
  },
  corridor: {
    id: 2,
    title: 'CORRIDOR',
    badge: 'CORRIDOR · BAY 09',
    defaultFocal: 50,
    accent: [0.13, 0.83, 0.93],
    clear: [0.03, 0.05, 0.08, 1],
  },
};

const canvas = document.getElementById('dz-canvas');
const viewportEl = document.getElementById('stage-viewport');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const routeNoteEl = document.getElementById('route-note');
const testsBody = document.getElementById('tests');

const bgLayer = document.getElementById('bg-layer');
const bgShotBadge = document.getElementById('bg-shot-badge');
const heroCard = document.getElementById('hero-card');
const subjectInput = document.getElementById('subject-input');
const cardScaleOut = document.getElementById('card-scale-out');
const cardDistOut = document.getElementById('card-dist-out');
const cardCueBtn = document.getElementById('card-cue-btn');
const shotBtns = Array.from(heroCard.querySelectorAll('.shot-btn'));

const ctlFocal = document.getElementById('ctl-focal');
const outFocal = document.getElementById('out-focal');
const btnSweep = document.getElementById('btn-sweep');
const btnLock = document.getElementById('btn-lock');
const btnZoom = document.getElementById('btn-zoom');
const ctlReduced = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

// ---------------- Dolly-Zoom Camera Optics & Projective Geometry ----------------

// #region dolly-math
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Compute camera distance, pinhole focal pixel length and screen-space quads
 * for both the foreground card (z = 0) and background scene layer (z = -5.40 m).
 * Keeping tan(fov/2) * d constant is equivalent to d = D_REF * (focalMm / F_REF).
 */
export function computeDollyFrame({
  cw,
  ch,
  focalMm,
  lockSubject = true,
  heroW = HERO_DEFAULT_W,
  heroH = HERO_DEFAULT_H,
  bgW = BG_DEFAULT_W,
  bgH = BG_DEFAULT_H,
}) {
  const f = clamp(focalMm, F_MIN, F_MAX);
  const camDist = lockSubject ? D_REF * (f / F_REF) : D_REF;
  const focalPx = PX_PER_M_REF * D_REF * (f / F_REF);

  const heroScale = (focalPx / (camDist - Z_HERO)) / PX_PER_M_REF;
  const heroProjW = heroW * heroScale;
  const heroProjH = heroH * heroScale;
  const heroX = cw * 0.5 - heroProjW * 0.5;
  const heroY = ch * 0.5 - heroProjH * 0.5 + 10;

  const bgDepth = camDist - Z_BG;
  const bgPxPerM = focalPx / bgDepth;
  const bgProjW = BG_WORLD_W * bgPxPerM;
  const bgProjH = BG_WORLD_H * bgPxPerM;
  const bgScale = bgProjW / Math.max(bgW, 1);
  const bgX = cw * 0.5 - bgProjW * 0.5;
  const bgY = ch * 0.5 - bgProjH * 0.5 - BG_WORLD_Y * bgPxPerM;

  const refBgPxPerM = (PX_PER_M_REF * D_REF) / (D_REF - Z_BG);
  const bgRelScale = bgPxPerM / refBgPxPerM;
  const fovXDeg = 2 * Math.atan((cw * 0.5) / Math.max(focalPx, 1)) * (180 / Math.PI);

  return {
    focalMm: f,
    camDist,
    focalPx,
    fovXDeg,
    hero: { x: heroX, y: heroY, w: heroProjW, h: heroProjH, scale: heroScale },
    bg: { x: bgX, y: bgY, w: bgProjW, h: bgProjH, scale: bgScale, relScale: bgRelScale },
    // Unused parameter guard for symmetry with custom card dimensions.
    bgAspect: bgH > 0 ? bgW / bgH : BG_DEFAULT_W / BG_DEFAULT_H,
  };
}

/**
 * Step a focal-length transition toward its target; snaps immediately when reducedMotion is true.
 */
export function stepFocalAnim(anim, nowMs, reducedMotion = false) {
  if (!anim) return { focalMm: F_REF, settled: true };
  if (reducedMotion || anim.durMs <= 0) {
    return { focalMm: anim.to, settled: true };
  }
  const t = clamp((nowMs - anim.startMs) / anim.durMs, 0, 1);
  const e = 1 - Math.pow(1 - t, 3);
  return {
    focalMm: anim.from + (anim.to - anim.from) * e,
    settled: t >= 1,
  };
}

function buildElementMatrix(x, y, scale) {
  return new DOMMatrix().translate(x, y).scale(scale, scale, 1);
}

const unitCache = new WeakMap();

function cachedGeometryUnit(targetCanvas, targetEl) {
  const ew = targetEl.offsetWidth || HERO_DEFAULT_W;
  const zoom = cssZoom(targetEl);
  const key = `${targetCanvas.width}x${targetCanvas.height}/${targetCanvas.clientWidth}x${targetCanvas.clientHeight}/${ew}/${zoom}`;
  const prev = unitCache.get(targetCanvas);
  if (prev && prev.key === key) return prev.unit;
  const unit = geometryUnit(targetCanvas, targetEl, ew);
  unitCache.set(targetCanvas, { key, unit, geoVals: new WeakMap() });
  return unit;
}

function applyElementTransform(targetCanvas, el, x, y, scale) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !OFFSTAGE) return;
  const unit = cachedGeometryUnit(targetCanvas, el === bgLayer ? heroCard : el);
  const cssMat = buildElementMatrix(x, y, scale);
  const target = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
  const vals = target.toFloat32Array();
  const entry = unitCache.get(targetCanvas);
  const prevVals = entry?.geoVals?.get(el);
  if (prevVals && vals.every((v, i) => Math.abs(v - prevVals[i]) < 1e-4)) return;
  entry?.geoVals?.set(el, vals);
  targetCanvas.updateElementGeometry(el, { canvasTransform: target });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}

function syncDollyGeometry(frame) {
  heroCard.inert = false;
  applyElementTransform(canvas, bgLayer, frame.bg.x, frame.bg.y, frame.bg.scale);
  applyElementTransform(canvas, heroCard, frame.hero.x, frame.hero.y, frame.hero.scale);
}
// #endregion dolly-math

// ---------------- WebGL 2 Corridor, Telephoto DoF & Vignette Shader ----------------

// #region dolly-shader
export const DOLLY_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform vec2 uCanvasSize;
uniform vec4 uQuadRect;
uniform float uFocalMm;
uniform float uCamDist;
uniform float uFocalPx;
uniform int uShot;
uniform float uTakePulse;
uniform vec3 uAccent;

in vec2 vUv;
out vec4 outColor;

float screenVignette(vec2 screenUv, float focalNorm) {
  vec2 d = screenUv - 0.5;
  float r2 = dot(d, d);
  // Wide-angle lenses show stronger cos^4 illumination falloff toward frame corners.
  float strength = mix(1.38, 0.62, focalNorm);
  return clamp(1.0 - r2 * strength, 0.28, 1.0);
}

vec3 raytraceCorridor(vec2 pCss, float focalNorm) {
  vec2 centered = pCss - uCanvasSize * 0.5;
  vec3 rd = normalize(vec3(centered.x / max(uFocalPx, 1.0), -centered.y / max(uFocalPx, 1.0), -1.0));
  vec3 ro = vec3(0.0, 0.0, uCamDist);

  // Perspective tunnel walls and floor/ceiling coordinates.
  float halfW = uShot == 1 ? 3.2 : 2.55;
  float halfH = uShot == 1 ? 2.2 : 1.85;
  float farZ = -34.0;

  float tx = abs(rd.x) > 1e-5 ? ((rd.x > 0.0 ? halfW : -halfW) - ro.x) / rd.x : 1e6;
  float ty = abs(rd.y) > 1e-5 ? ((rd.y > 0.0 ? halfH : -halfH) - ro.y) / rd.y : 1e6;
  float tz = rd.z < -1e-5 ? (farZ - ro.z) / rd.z : 1e6;

  if (tx < 0.0) tx = 1e6;
  if (ty < 0.0) ty = 1e6;
  if (tz < 0.0) tz = 1e6;

  float tHit = tx;
  int hitType = 0; // 0 = side wall, 1 = ceiling/floor, 2 = back portal
  if (ty < tHit) { tHit = ty; hitType = 1; }
  if (tz < tHit) { tHit = tz; hitType = 2; }

  vec3 pos = ro + rd * tHit;
  float worldDepth = max(0.0, -pos.z);
  float dofSoft = smoothstep(32.0, 135.0, uFocalMm) * smoothstep(2.0, 16.0, worldDepth);
  float ribSharp = mix(0.03, 0.24, dofSoft);

  vec3 col = vec3(0.02);

  if (uShot == 0) {
    // Vertigo: warm crimson-amber stepped stairwell / gallery corridor.
    float bay = fract(pos.z / 1.55);
    float rib = 1.0 - smoothstep(0.05, 0.05 + ribSharp, min(bay, 1.0 - bay));
    float stripe = smoothstep(0.09 + ribSharp * 0.5, 0.01, abs(bay - 0.5));
    if (hitType == 0) {
      float panel = smoothstep(0.18, 0.45, abs(pos.y / halfH));
      col = mix(vec3(0.16, 0.04, 0.05), vec3(0.30, 0.09, 0.06), panel);
      col += vec3(1.0, 0.46, 0.18) * rib * 0.52;
      col += vec3(0.95, 0.28, 0.14) * stripe * (1.0 - panel) * 0.45;
    } else if (hitType == 1) {
      float isFloor = pos.y < 0.0 ? 1.0 : 0.0;
      float lane = smoothstep(0.28 + ribSharp, 0.02, abs(abs(pos.x) - 1.15));
      float centerLine = smoothstep(0.12 + ribSharp * 0.4, 0.0, abs(pos.x));
      col = mix(vec3(0.11, 0.03, 0.04), vec3(0.20, 0.06, 0.05), isFloor);
      col += vec3(1.0, 0.62, 0.26) * rib * (0.35 + 0.35 * isFloor);
      col += vec3(1.0, 0.38, 0.16) * (lane * 0.55 + centerLine * 0.28 * isFloor);
    } else {
      float ring = length(pos.xy * vec2(0.75, 1.0));
      float spiral = 0.5 + 0.5 * sin(ring * 11.0 - atan(pos.y, pos.x) * 2.0);
      col = mix(vec3(0.26, 0.06, 0.05), vec3(0.82, 0.34, 0.14), spiral * exp(-ring * 0.65));
    }
    float fog = 1.0 - exp(-worldDepth * mix(0.045, 0.068, focalNorm));
    col = mix(col, vec3(0.22, 0.05, 0.04), fog * 0.72);
  } else if (uShot == 1) {
    // Jaws: twilight Amity ocean horizon and receding timber pier boardwalk.
    float waterY = -0.58;
    if (rd.y < -1e-4) {
      float tw = (waterY - ro.y) / rd.y;
      if (tw > 0.0 && tw < 42.0) {
        vec3 wp = ro + rd * tw;
        float wz = max(0.0, -wp.z);
        float onPier = step(abs(wp.x), 1.54) * step(wz, 20.0);
        if (onPier > 0.5) {
          float plank = fract(wp.z / 0.42);
          float gap = 1.0 - smoothstep(0.05, 0.05 + ribSharp * 0.5, min(plank, 1.0 - plank));
          float rail = step(1.28, abs(wp.x));
          float post = rail * (1.0 - smoothstep(0.06, 0.16, abs(fract(wp.z / 1.68) - 0.5)));
          vec3 timber = mix(vec3(0.24, 0.17, 0.13), vec3(0.08, 0.06, 0.05), gap);
          timber += vec3(0.32, 0.48, 0.68) * rail * 0.18;
          timber += vec3(0.55, 0.78, 0.98) * post * 0.45;
          col = timber;
        } else {
          float wave = sin(wp.z * 2.4 + wp.x * 0.8) * 0.5 + sin(wp.z * 5.2 - wp.x * 1.3) * 0.25;
          float moonSpec = exp(-abs(wp.x) * 0.85) * smoothstep(-0.2, 0.8, wave);
          col = vec3(0.04, 0.11, 0.22) + vec3(0.38, 0.72, 0.96) * moonSpec * 0.60;
        }
        float fog = 1.0 - exp(-wz * mix(0.028, 0.048, focalNorm));
        col = mix(col, vec3(0.16, 0.28, 0.46), fog * 0.70);
      } else {
        col = vec3(0.06, 0.13, 0.24);
      }
    } else {
      float h = clamp(rd.y * 2.4, 0.0, 1.0);
      vec3 horizonCol = mix(vec3(0.86, 0.44, 0.26), vec3(0.12, 0.28, 0.48), smoothstep(0.0, 0.26, h));
      col = mix(horizonCol, vec3(0.03, 0.06, 0.13), smoothstep(0.18, 0.85, h));
    }
  } else {
    // Corridor: brutalist neon cinema tunnel with overhead coffers and edge rails.
    float bay = fract(pos.z / 1.45);
    float rib = 1.0 - smoothstep(0.05, 0.05 + ribSharp, min(bay, 1.0 - bay));
    float coffer = smoothstep(0.18 + ribSharp * 0.4, 0.02, abs(bay - 0.5));
    if (hitType == 0) {
      float seam = smoothstep(0.08 + ribSharp * 0.3, 0.0, abs(pos.y));
      col = vec3(0.06, 0.09, 0.13);
      col += vec3(0.18, 0.78, 0.96) * rib * 0.44;
      col += vec3(0.98, 0.68, 0.24) * seam * 0.38;
    } else if (hitType == 1) {
      float isCeil = pos.y > 0.0 ? 1.0 : 0.0;
      float strip = smoothstep(0.42 + ribSharp * 0.5, 0.05, abs(pos.x));
      float sideRail = smoothstep(0.14 + ribSharp * 0.4, 0.0, abs(abs(pos.x) - 1.72));
      col = vec3(0.04, 0.06, 0.09);
      col += vec3(0.24, 0.86, 0.98) * coffer * strip * isCeil * 0.72;
      col += vec3(0.98, 0.62, 0.20) * sideRail * (1.0 - isCeil) * 0.62;
      col += vec3(0.15, 0.36, 0.48) * rib * 0.36;
    } else {
      float frame = max(abs(pos.x) / halfW, abs(pos.y) / halfH);
      col = mix(vec3(0.24, 0.78, 0.94), vec3(0.04, 0.07, 0.11), smoothstep(0.18, 0.68, frame));
    }
    float fog = 1.0 - exp(-worldDepth * mix(0.04, 0.065, focalNorm));
    col = mix(col, vec3(0.05, 0.10, 0.16), fog * 0.78);
  }

  col += uAccent * (uTakePulse * 0.16);
  return clamp(col, 0.0, 1.0);
}

vec4 samplePremulBlur(vec2 uv, float dofFactor, float caOffset) {
  vec2 texel = 1.0 / max(uSize, vec2(1.0));
  if (dofFactor < 0.04 && abs(caOffset) < 0.0005) {
    return texture(uTex, uv);
  }
  float lodBias = dofFactor * 1.35;
  vec2 rad = texel * (dofFactor * 1.65);
  vec2 radialDir = (uv - 0.5) * caOffset;
  vec4 sum = vec4(0.0);
  float wSum = 0.0;
  for (int iy = -1; iy <= 1; iy++) {
    for (int ix = -1; ix <= 1; ix++) {
      vec2 off = vec2(float(ix), float(iy)) * rad;
      float w = (ix == 0 && iy == 0) ? 0.26 : (ix == 0 || iy == 0) ? 0.125 : 0.06;
      vec2 baseUv = clamp(uv + off, vec2(0.0), vec2(1.0));
      vec4 sG = texture(uTex, baseUv, lodBias);
      float sR = texture(uTex, clamp(baseUv + radialDir, vec2(0.0), vec2(1.0)), lodBias).r;
      float sB = texture(uTex, clamp(baseUv - radialDir, vec2(0.0), vec2(1.0)), lodBias).b;
      sum += vec4(sR, sG.g, sB, sG.a) * w;
      wSum += w;
    }
  }
  return sum / max(wSum, 0.001);
}

void main() {
  float focalNorm = clamp((uFocalMm - 18.0) / (135.0 - 18.0), 0.0, 1.0);

  if (uPass == 0) {
    vec2 pCss = vUv * uCanvasSize;
    vec3 col = raytraceCorridor(pCss, focalNorm);
    col *= screenVignette(vUv, focalNorm);
    outColor = vec4(col, 1.0);
    return;
  }

  vec2 screenUv = (uQuadRect.xy + vUv * uQuadRect.zw) / max(uCanvasSize, vec2(1.0));
  float vig = screenVignette(screenUv, focalNorm);

  if (uPass == 1) {
    // Background HTML scene layer at z = -5.40 m: shallow DoF softens it at telephoto lengths.
    float dofFactor = smoothstep(0.18, 1.0, focalNorm);
    float ca = mix(0.0042, 0.0004, focalNorm);
    vec4 tex = samplePremulBlur(vUv, dofFactor, ca);
    if (tex.a <= 0.003) {
      outColor = vec4(0.0);
      return;
    }
    vec3 haze = uShot == 0 ? vec3(0.24, 0.06, 0.05) : uShot == 1 ? vec3(0.12, 0.24, 0.38) : vec3(0.05, 0.12, 0.18);
    float hazeAmt = mix(0.06, 0.26, focalNorm);
    vec3 rgb = mix(tex.rgb, haze * tex.a, hazeAmt);
    rgb *= vig;
    outColor = vec4(rgb, tex.a);
    return;
  }

  // Pass 2: Foreground hero card locked sharp on focal plane z = 0.
  vec4 tex = texture(uTex, vUv);
  if (tex.a <= 0.003) {
    outColor = vec4(0.0);
    return;
  }
  float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float rimGlow = smoothstep(0.06, 0.0, edge) * uTakePulse * 0.45 * tex.a;
  vec3 rgb = tex.rgb * mix(1.0, vig, 0.35) + uAccent * rimGlow;
  outColor = vec4(rgb, tex.a);
}`;
// #endregion dolly-shader

// ---------------- State ----------------

const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  shot: 'vertigo',
  focalMm: 50,
  lockSubject: true,
  autoSweep: false,
  sweepPhase: Math.asin((50 - (F_MIN + F_MAX) * 0.5) / ((F_MAX - F_MIN) * 0.5)),
  focalAnim: null,
  takeCount: 1,
  takePulseStart: -10000,
  userEditedTitle: false,
  dragging: false,
  dragId: null,
  dragLastX: 0,
  onScreen: true,
  hasPainted: false,
  dirtyBg: true,
  dirtyHero: true,
  texUploaded: false,
  uploads: 0,
  paints: 0,
  lastReadoutKey: '',
  needsDraw: true,
};

let stage = null;
let ctx2d = null;
let anisoExt = null;
let maxAniso = 1;
let rafId = 0;
let lastTickMs = performance.now();

function isReducedMotion() {
  return Boolean(ctlReduced.checked || reducedQuery?.matches);
}

function activeShot() {
  return SHOTS[state.shot] || SHOTS.vertigo;
}

function updateCardReadouts(frame) {
  const roundedF = Math.round(frame.focalMm);
  const scaleStr = frame.hero.scale.toFixed(2);
  const distStr = frame.camDist.toFixed(2);
  const modeKey = `${roundedF}|${scaleStr}|${distStr}`;
  if (modeKey === state.lastReadoutKey) return;
  state.lastReadoutKey = modeKey;
  cardScaleOut.textContent = `${scaleStr}x · ${roundedF} mm`;
  cardDistOut.textContent = `d = ${distStr} m`;
  state.dirtyHero = true;
  if (state.backend !== 'plain') canvas.requestPaint?.();
}

function syncToolbarUI(frame) {
  const roundedF = Math.round(state.focalMm);
  if (Number(ctlFocal.value) !== roundedF) ctlFocal.value = String(roundedF);
  outFocal.textContent = `${roundedF} mm`;
  btnLock.setAttribute('aria-pressed', String(state.lockSubject));
  btnZoom.setAttribute('aria-pressed', String(!state.lockSubject));
  btnSweep.setAttribute('aria-pressed', String(state.autoSweep));
  if (frame) {
    hudEl.textContent =
      `${state.backend} · ${roundedF} mm · d ${frame.camDist.toFixed(2)} m · ` +
      `subj ${frame.hero.scale.toFixed(2)}x · bg ${frame.bg.relScale.toFixed(2)}x · ${frame.fovXDeg.toFixed(1)} deg`;
  }
}

// ---------------- Upload, Render & Fallbacks ----------------

// #region paint-upload
function uploadDrawable(el) {
  if (!stage || stage.lost || !state.hasPainted) return false;
  try {
    const t = stage.upload(el);
    if (!t) return false;
    const gl = stage.gl;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
    if (anisoExt) {
      gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    state.uploads++;
    return true;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return false;
    }
    throw err;
  }
}

function renderWebGL(now) {
  if (!state.hasPainted || !stage || stage.lost) return;

  const cw = canvas.clientWidth || viewportEl.clientWidth || 380;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 420;
  const frame = computeDollyFrame({
    cw,
    ch,
    focalMm: state.focalMm,
    lockSubject: state.lockSubject,
    heroW: heroCard.offsetWidth || HERO_DEFAULT_W,
    heroH: heroCard.offsetHeight || HERO_DEFAULT_H,
    bgW: bgLayer.offsetWidth || BG_DEFAULT_W,
    bgH: bgLayer.offsetHeight || BG_DEFAULT_H,
  });

  updateCardReadouts(frame);
  syncToolbarUI(frame);

  const shot = activeShot();
  // Call stage.begin() before stage.upload() so the canvas backing store matches DPR first.
  if (!stage.begin(shot.clear)) return;

  if (state.dirtyBg || !stage.has(bgLayer)) {
    if (uploadDrawable(bgLayer)) state.dirtyBg = false;
  }
  if (state.dirtyHero || !stage.has(heroCard)) {
    if (uploadDrawable(heroCard)) state.dirtyHero = false;
  }
  if (!stage.has(bgLayer) || !stage.has(heroCard)) return;
  state.texUploaded = true;

  const pulseAge = (now - state.takePulseStart) / 1000;
  const pulse = (!isReducedMotion() && pulseAge >= 0 && pulseAge < 0.75) ? (1 - pulseAge / 0.75) : 0;

  const setCommon = (gl, u, pass, rx, ry, rw, rh) => {
    gl.uniform1i(u('uPass'), pass);
    gl.uniform2f(u('uCanvasSize'), cw, ch);
    gl.uniform4f(u('uQuadRect'), rx, ry, rw, rh);
    gl.uniform1f(u('uFocalMm'), frame.focalMm);
    gl.uniform1f(u('uCamDist'), frame.camDist);
    gl.uniform1f(u('uFocalPx'), frame.focalPx);
    gl.uniform1i(u('uShot'), shot.id);
    gl.uniform1f(u('uTakePulse'), pulse);
    gl.uniform3fv(u('uAccent'), shot.accent);
  };

  // Pass 0: procedural 3D corridor / ocean pier / Vertigo stairwell.
  stage.quad(heroCard, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
    setCommon(gl, u, 0, 0, 0, cw, ch);
  });

  // Pass 1: deep parallax background HTML layer with focal-length DoF.
  stage.quad(bgLayer, ElementGL.rect(canvas, frame.bg.x, frame.bg.y, frame.bg.w, frame.bg.h), (gl, u) => {
    setCommon(gl, u, 1, frame.bg.x, frame.bg.y, frame.bg.w, frame.bg.h);
  });

  // Pass 2: sharp foreground hero card locked on z = 0.
  stage.quad(heroCard, ElementGL.rect(canvas, frame.hero.x, frame.hero.y, frame.hero.w, frame.hero.h), (gl, u) => {
    setCommon(gl, u, 2, frame.hero.x, frame.hero.y, frame.hero.w, frame.hero.h);
  });

  syncDollyGeometry(frame);
}

function render2DFallback() {
  if (!state.hasPainted || !ctx2d) return;
  const cw = canvas.clientWidth || viewportEl.clientWidth || 380;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 420;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const frame = computeDollyFrame({
    cw,
    ch,
    focalMm: state.focalMm,
    lockSubject: state.lockSubject,
    heroW: heroCard.offsetWidth || HERO_DEFAULT_W,
    heroH: heroCard.offsetHeight || HERO_DEFAULT_H,
    bgW: bgLayer.offsetWidth || BG_DEFAULT_W,
    bgH: bgLayer.offsetHeight || BG_DEFAULT_H,
  });

  updateCardReadouts(frame);
  syncToolbarUI(frame);

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = state.shot === 'vertigo' ? '#19090b' : state.shot === 'jaws' ? '#081526' : '#091019';
  ctx2d.fillRect(0, 0, cw, ch);

  // Simple 2D perspective corridor ribs driven by focalPx and camDist.
  ctx2d.strokeStyle = state.shot === 'vertigo' ? 'rgba(255,106,61,0.34)' : 'rgba(56,189,248,0.34)';
  ctx2d.lineWidth = 1.25;
  for (let i = 0; i < 10; i++) {
    const z = -i * 2.2;
    const scale = frame.focalPx / (frame.camDist - z);
    const rw = 5.1 * scale;
    const rh = 3.7 * scale;
    ctx2d.strokeRect(cw * 0.5 - rw * 0.5, ch * 0.5 - rh * 0.5, rw, rh);
  }

  try {
    ctx2d.drawElementImage(bgLayer, frame.bg.x, frame.bg.y, frame.bg.w, frame.bg.h);
  } catch {}
  try {
    ctx2d.drawElementImage(heroCard, frame.hero.x, frame.hero.y, frame.hero.w, frame.hero.h);
  } catch {}
  ctx2d.restore();

  syncDollyGeometry(frame);
  state.texUploaded = true;
}

function attachContextLossController({ targetCanvas, targetViewport, targetElements, targetPlainHost, onPlain, onRestore }) {
  const onLost = (e) => {
    e.preventDefault();
    for (const el of targetElements) {
      if (el === heroCard) el.inert = false;
      if (el.parentElement !== targetPlainHost) targetPlainHost.append(el);
    }
    targetPlainHost.hidden = false;
    if (targetViewport) targetViewport.hidden = true;
    onPlain?.('Context lost; showing the parallax layers as plain HTML until restored.');
  };
  const onRestored = () => {
    for (const el of targetElements) {
      if (el.parentElement !== targetCanvas) targetCanvas.append(el);
    }
    targetPlainHost.hidden = true;
    if (targetViewport) targetViewport.hidden = false;
    onRestore?.();
  };
  targetCanvas.addEventListener('webglcontextlost', onLost);
  targetCanvas.addEventListener('contextlost', onLost);
  targetCanvas.addEventListener('webglcontextrestored', onRestored);
  targetCanvas.addEventListener('contextrestored', onRestored);
}

function showPlainFallback(reason) {
  state.backend = 'plain';
  state.autoSweep = false;
  heroCard.inert = false;
  if (bgLayer.parentElement !== plainHost) plainHost.append(bgLayer);
  if (heroCard.parentElement !== plainHost) plainHost.append(heroCard);
  plainHost.hidden = false;
  viewportEl.hidden = true;
  routeNoteEl.textContent = reason;
  const frame = computeDollyFrame({ cw: 380, ch: 420, focalMm: state.focalMm, lockSubject: state.lockSubject });
  updateCardReadouts(frame);
  syncToolbarUI(frame);
}
// #endregion paint-upload

// ---------------- Loop & Lifecycle ----------------

function requestRender() {
  state.needsDraw = true;
  if (state.backend === 'plain') {
    const frame = computeDollyFrame({ cw: 380, ch: 420, focalMm: state.focalMm, lockSubject: state.lockSubject });
    updateCardReadouts(frame);
    syncToolbarUI(frame);
    return;
  }
  if (!rafId && state.onScreen && !document.hidden) {
    lastTickMs = performance.now();
    rafId = requestAnimationFrame(tick);
  }
}

function tick(now) {
  rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;
  const dt = Math.min(0.05, Math.max(0.001, (now - lastTickMs) / 1000));
  lastTickMs = now;

  let keepGoing = false;
  const reduced = isReducedMotion();

  if (state.focalAnim) {
    const stepped = stepFocalAnim(state.focalAnim, now, reduced);
    state.focalMm = stepped.focalMm;
    state.needsDraw = true;
    if (stepped.settled) state.focalAnim = null;
    else keepGoing = true;
  } else if (state.autoSweep && !state.dragging && !reduced) {
    state.sweepPhase += dt * 1.12;
    const mid = (F_MIN + F_MAX) * 0.5;
    const amp = (F_MAX - F_MIN) * 0.5;
    state.focalMm = mid + amp * Math.sin(state.sweepPhase);
    state.needsDraw = true;
    keepGoing = true;
  }

  const pulseAge = (now - state.takePulseStart) / 1000;
  if (!reduced && pulseAge >= 0 && pulseAge < 0.78) {
    state.needsDraw = true;
    keepGoing = true;
  }

  if (state.needsDraw && state.hasPainted) {
    state.needsDraw = false;
    if (state.backend === 'webgl') renderWebGL(now);
    else if (state.backend === '2d') render2DFallback();
  }

  if (keepGoing) rafId = requestAnimationFrame(tick);
}

function initBackend() {
  attachContextLossController({
    targetCanvas: canvas,
    targetViewport: viewportEl,
    targetElements: [bgLayer, heroCard],
    targetPlainHost: plainHost,
    onPlain: (msg) => {
      state.backend = 'plain';
      state.autoSweep = false;
      state.texUploaded = false;
      routeNoteEl.textContent = msg;
    },
    onRestore: () => {
      if (stage && !stage.lost) {
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        state.backend = 'webgl';
        state.hasPainted = false;
        state.dirtyBg = true;
        state.dirtyHero = true;
        unitCache.delete(canvas);
        routeNoteEl.textContent = 'WebGL 2 context restored on one ElementGL canvas.';
        canvas.requestPaint?.();
        requestRender();
      } else if (ctx2d) {
        state.backend = '2d';
        state.hasPainted = false;
        unitCache.delete(canvas);
        canvas.requestPaint?.();
        requestRender();
      }
    },
  });

  if (elGlSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: DOLLY_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' },
        onLost: () => {
          state.texUploaded = false;
          state.hasPainted = false;
          state.dirtyBg = true;
          state.dirtyHero = true;
        },
        onRestored: () => {
          const gl = stage.gl;
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
          maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
          state.hasPainted = false;
          state.dirtyBg = true;
          state.dirtyHero = true;
          unitCache.delete(canvas);
          canvas.requestPaint?.();
          requestRender();
        },
      });
      const gl = stage.gl;
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
      maxAniso = anisoExt ? Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) || 1) : 1;
      state.backend = 'webgl';
      routeNoteEl.textContent = `Running on WebGL 2 via one ElementGL context (${anisoExt ? `${maxAniso}x anisotropic mipmaps` : 'trilinear mipmaps'}, premultiplied alpha).`;
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back.`;
    }
  }

  if (state.backend === 'none' && api2dSupported) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; running the 2D 5-argument drawElementImage() fallback.';
    }
  }

  if (state.backend === 'none') {
    showPlainFallback('HTML-in-canvas is not available in this browser, so both cards are shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', (e) => {
    state.hasPainted = true;
    state.paints++;
    const changed = e?.changedElements;
    if (!changed || !changed.length) {
      state.dirtyBg = true;
      state.dirtyHero = true;
    } else {
      for (const el of changed) {
        if (el === bgLayer || bgLayer.contains(el)) state.dirtyBg = true;
        if (el === heroCard || heroCard.contains(el)) state.dirtyHero = true;
      }
    }
    if (state.backend === 'webgl') renderWebGL(performance.now());
    else if (state.backend === '2d') render2DFallback();
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      unitCache.delete(canvas);
      requestRender();
    }).observe(canvas);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver((entries) => {
      state.onScreen = entries.some((e) => e.isIntersecting);
      if (state.onScreen) requestRender();
    }, { rootMargin: '120px' }).observe(viewportEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.onScreen) requestRender();
  });

  canvas.requestPaint?.();
  requestRender();
}

// ---------------- Interactive Controls ----------------

function setShot(shotKey, { animateFocal = true } = {}) {
  const shot = SHOTS[shotKey];
  if (!shot) return;
  state.shot = shotKey;
  bgLayer.dataset.shot = shotKey;
  heroCard.dataset.shot = shotKey;
  bgShotBadge.textContent = shot.badge;
  if (!state.userEditedTitle) subjectInput.value = shot.title;
  for (const b of shotBtns) {
    b.setAttribute('aria-pressed', String(b.dataset.shot === shotKey));
  }
  state.dirtyBg = true;
  state.dirtyHero = true;
  if (animateFocal && !state.autoSweep) {
    if (isReducedMotion()) {
      state.focalAnim = null;
      state.focalMm = shot.defaultFocal;
      const cw = canvas.clientWidth || viewportEl.clientWidth || 380;
      const ch = canvas.clientHeight || viewportEl.clientHeight || 420;
      const frame = computeDollyFrame({
        cw,
        ch,
        focalMm: state.focalMm,
        lockSubject: state.lockSubject,
        heroW: heroCard.offsetWidth || HERO_DEFAULT_W,
        heroH: heroCard.offsetHeight || HERO_DEFAULT_H,
        bgW: bgLayer.offsetWidth || BG_DEFAULT_W,
        bgH: bgLayer.offsetHeight || BG_DEFAULT_H,
      });
      updateCardReadouts(frame);
      syncToolbarUI(frame);
    } else {
      state.focalAnim = {
        from: state.focalMm,
        to: shot.defaultFocal,
        startMs: performance.now(),
        durMs: 460,
      };
    }
  }
  canvas.requestPaint?.();
  requestRender();
}

ctlFocal.addEventListener('input', () => {
  state.autoSweep = false;
  state.focalAnim = null;
  state.focalMm = clamp(Number(ctlFocal.value), F_MIN, F_MAX);
  requestRender();
});

btnSweep.addEventListener('click', () => {
  if (isReducedMotion()) {
    state.autoSweep = false;
    routeNoteEl.textContent = 'Auto push-pull stays paused while Reduced motion is on. Drag the focal slider or scrub the stage.';
    syncToolbarUI();
    return;
  }
  state.autoSweep = !state.autoSweep;
  state.focalAnim = null;
  if (state.autoSweep) {
    const mid = (F_MIN + F_MAX) * 0.5;
    const amp = (F_MAX - F_MIN) * 0.5;
    state.sweepPhase = Math.asin(clamp((state.focalMm - mid) / amp, -1, 1));
  }
  requestRender();
});

function setLockMode(locked) {
  state.lockSubject = locked;
  requestRender();
}

btnLock.addEventListener('click', () => setLockMode(true));
btnZoom.addEventListener('click', () => setLockMode(false));

function applyReducedMotionState() {
  if (isReducedMotion()) {
    state.autoSweep = false;
    if (state.focalAnim) {
      state.focalMm = state.focalAnim.to;
      state.focalAnim = null;
    }
  }
  requestRender();
}

if (reducedQuery) {
  ctlReduced.checked = reducedQuery.matches;
  reducedQuery.addEventListener('change', () => {
    ctlReduced.checked = reducedQuery.matches;
    applyReducedMotionState();
  });
}

ctlReduced.addEventListener('change', applyReducedMotionState);

for (const b of shotBtns) {
  b.addEventListener('click', () => setShot(b.dataset.shot));
}

subjectInput.addEventListener('input', () => {
  state.userEditedTitle = true;
  state.dirtyHero = true;
  canvas.requestPaint?.();
  requestRender();
});

heroCard.addEventListener('focusin', () => {
  state.dirtyHero = true;
  canvas.requestPaint?.();
  requestRender();
});

heroCard.addEventListener('focusout', () => {
  state.dirtyHero = true;
  canvas.requestPaint?.();
  requestRender();
});

cardCueBtn.addEventListener('click', () => {
  state.takeCount++;
  cardCueBtn.textContent = `Cue take #${state.takeCount}`;
  state.dirtyHero = true;
  state.takePulseStart = isReducedMotion() ? -10000 : performance.now();
  canvas.requestPaint?.();
  requestRender();
});

function isHeroControl(target) {
  return target instanceof Element && heroCard.contains(target) && Boolean(target.closest('input, button'));
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain' || isHeroControl(e.target)) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  state.autoSweep = false;
  state.focalAnim = null;
  state.dragging = true;
  state.dragId = e.pointerId;
  state.dragLastX = e.clientX;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  const dx = e.clientX - state.dragLastX;
  state.dragLastX = e.clientX;
  state.focalMm = clamp(state.focalMm + dx * 0.42, F_MIN, F_MAX);
  requestRender();
});

function endStageDrag(e) {
  if (!state.dragging || e.pointerId !== state.dragId) return;
  state.dragging = false;
  state.dragId = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
}
canvas.addEventListener('pointerup', endStageDrag);
canvas.addEventListener('pointercancel', endStageDrag);

canvas.addEventListener('wheel', (e) => {
  if (state.backend === 'plain') return;
  e.preventDefault();
  state.autoSweep = false;
  state.focalAnim = null;
  state.focalMm = clamp(state.focalMm + e.deltaY * 0.06, F_MIN, F_MAX);
  requestRender();
}, { passive: false });

initBackend();

// ---------------- Isolated Live Checks (Tap-Gated) ----------------

function makeFixtureCanvas(w = 240, h = 180) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.width = w;
  cv.height = h;
  cv.style.cssText = `display:block;width:${w}px;height:${h}px;position:relative;overflow:hidden`;
  testStage().append(cv);
  return cv;
}

function readPlainCopyImageData(srcCanvas) {
  const copy = document.createElement('canvas');
  copy.width = srcCanvas.width;
  copy.height = srcCanvas.height;
  const cc = copy.getContext('2d', { willReadFrequently: true });
  cc.drawImage(srcCanvas, 0, 0);
  return cc.getImageData(0, 0, copy.width, copy.height);
}

runTests(testsBody, [
  {
    name: 'ElementGL + texElementSubImage2D() renders both drawable layers with gl.getError() === 0',
    why: 'Builds an isolated ElementGL fixture canvas with background and foreground drawable children, sets UNPACK_PREMULTIPLY_ALPHA_WEBGL, calls begin() before upload() and checks drawn pixels and GL errors.',
    timeout: 6000,
    run: async () => {
      if (!elGlSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 240, ch = 180;
      const cv = makeFixtureCanvas(cw, ch);
      const fixBg = document.createElement('div');
      fixBg.setAttribute('drawable', '');
      fixBg.style.cssText = 'position:absolute;left:0;top:0;width:180px;height:120px;background:rgb(48 164 255 / 0.8);';
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:80px;background:#ff6a3d;border:2px solid #fff;';
      cv.append(fixBg, fixCard);

      const g = new ElementGL(cv, {
        fragment: DOLLY_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      try {
        await nextPaint(cv);
        if (!g.begin([0.04, 0.05, 0.08, 1])) throw new Error('ElementGL.begin() returned false');
        const tBg = g.upload(fixBg);
        const tCard = g.upload(fixCard);
        if (!tBg || !tCard) throw new Error('stage.upload() returned null');

        const f = computeDollyFrame({ cw, ch, focalMm: 85, lockSubject: true, heroW: 120, heroH: 80, bgW: 180, bgH: 120 });
        const setU = (gl, u, pass, rx, ry, rw, rh) => {
          gl.uniform1i(u('uPass'), pass);
          gl.uniform2f(u('uCanvasSize'), cw, ch);
          gl.uniform4f(u('uQuadRect'), rx, ry, rw, rh);
          gl.uniform1f(u('uFocalMm'), f.focalMm);
          gl.uniform1f(u('uCamDist'), f.camDist);
          gl.uniform1f(u('uFocalPx'), f.focalPx);
          gl.uniform1i(u('uShot'), 0);
          gl.uniform1f(u('uTakePulse'), 0);
          gl.uniform3fv(u('uAccent'), SHOTS.vertigo.accent);
        };
        g.quad(fixCard, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => setU(gl, u, 0, 0, 0, cw, ch));
        g.quad(fixBg, ElementGL.rect(cv, 10, 10, 220, 160), (gl, u) => setU(gl, u, 1, 10, 10, 220, 160));
        g.quad(fixCard, ElementGL.rect(cv, 60, 50, 120, 80), (gl, u) => setU(gl, u, 2, 60, 50, 120, 80));

        const err = g.gl.getError();
        if (err !== 0) throw new Error(`gl.getError() returned 0x${err.toString(16)}`);
        const img = readPlainCopyImageData(cv);
        const cIdx = (Math.floor(img.height * 0.5) * img.width + Math.floor(img.width * 0.5)) * 4;
        const px = [img.data[cIdx], img.data[cIdx + 1], img.data[cIdx + 2], img.data[cIdx + 3]];
        if (px[0] < 160) throw new Error(`expected warm foreground card pixel at centre, got rgba(${px.join(',')})`);
        return `bg ${tBg.w}×${tBg.h}, card ${tCard.w}×${tCard.h}, gl.getError()=0, centre rgba(${px.join(',')})`;
      } finally {
        g.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Dolly zoom locks foreground width (1:1) while background stretches across 18 mm to 135 mm',
    why: 'Applies computeDollyFrame() + updateElementGeometry() at 18 mm and 135 mm in Keep 1:1 width and Zoom only modes, then reads both layers with getBoundingClientRect().',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !api2dSupported) {
        throw new Error('updateElementGeometry() or drawElementImage() is not available');
      }
      const cw = 320, ch = 220;
      const cv = makeFixtureCanvas(cw, ch);
      const fixBg = document.createElement('div');
      fixBg.setAttribute('drawable', '');
      fixBg.style.cssText = 'position:absolute;left:0;top:0;width:220px;height:140px;pointer-events:none;background:#1e3a5f;';
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = 'position:absolute;left:0;top:0;width:140px;height:96px;background:#ff6a3d;';
      cv.append(fixBg, fixCard);

      try {
        const c2 = cv.getContext('2d');
        await nextPaint(cv);
        c2.drawElementImage(fixBg, 0, 0, 220, 140);
        c2.drawElementImage(fixCard, 0, 0, 140, 96);

        const placeBoth = (focalMm, lockSubject) => {
          const f = computeDollyFrame({
            cw, ch, focalMm, lockSubject,
            heroW: 140, heroH: 96, bgW: 220, bgH: 140,
          });
          applyElementTransform(cv, fixBg, f.bg.x, f.bg.y, f.bg.scale);
          applyElementTransform(cv, fixCard, f.hero.x, f.hero.y, f.hero.scale);
          return {
            heroW: fixCard.getBoundingClientRect().width,
            bgW: fixBg.getBoundingClientRect().width,
          };
        };

        const d18 = placeBoth(18, true);
        const d135 = placeBoth(135, true);
        const scaleDelta = Math.abs(d135.heroW - d18.heroW);
        const bgDelta = Math.abs(d135.bgW - d18.bgW);
        if (scaleDelta > 0.5) throw new Error(`dolly mode subject width drifted by ${scaleDelta.toFixed(2)} px`);
        if (bgDelta < 150) throw new Error(`background layer shifted only ${bgDelta.toFixed(1)} px across 18-135 mm`);

        const z18 = placeBoth(18, false);
        const z135 = placeBoth(135, false);
        const zoomRatio = z135.heroW / Math.max(z18.heroW, 0.1);
        if (zoomRatio < 7.0) throw new Error(`Zoom only ratio was ${zoomRatio.toFixed(2)}x, expected >= 7.0x`);

        return `locked scaleDelta=${scaleDelta.toFixed(2)} px, bgDelta=${bgDelta.toFixed(1)} px (${(d135.bgW / d18.bgW).toFixed(2)}x), zoomOnly=${zoomRatio.toFixed(2)}x`;
      } finally {
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps card button and input hit-testable at 18 mm and 135 mm',
    why: 'Places a background layer and an interactive foreground card inside an isolated fixture canvas, checks elementsFromPoint() on both the <button> and <input> at 18 mm and 135 mm, and checks outside points miss.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || !api2dSupported) {
        throw new Error('updateElementGeometry() or drawElementImage() is not available');
      }
      const cw = 320, ch = 220, hw = 180, hh = 120;
      const cv = makeFixtureCanvas(cw, ch);
      const fixBg = document.createElement('div');
      fixBg.setAttribute('drawable', '');
      fixBg.style.cssText = 'position:absolute;left:0;top:0;width:240px;height:160px;pointer-events:none;background:#102030;';
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = `position:absolute;left:0;top:0;width:${hw}px;height:${hh}px;background:#141a26;`;

      const inp = document.createElement('input');
      inp.type = 'text';
      inp.inputMode = 'none';
      inp.value = 'SLATE';
      inp.setAttribute('aria-label', 'Fixture slate input');
      inp.style.cssText = 'position:absolute;left:16px;top:14px;width:148px;height:36px;margin:0;border:0;';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Cue take';
      btn.style.cssText = 'position:absolute;left:30px;top:68px;width:120px;height:38px;margin:0;border:0;';

      fixCard.append(inp, btn);
      cv.append(fixBg, fixCard);

      try {
        const c2 = cv.getContext('2d');
        await nextPaint(cv);
        c2.drawElementImage(fixBg, 0, 0, 240, 160);
        c2.drawElementImage(fixCard, 0, 0, hw, hh);

        const rect = cv.getBoundingClientRect();
        const checkAt = (focalMm) => {
          const f = computeDollyFrame({ cw, ch, focalMm, lockSubject: true, heroW: hw, heroH: hh, bgW: 240, bgH: 160 });
          applyElementTransform(cv, fixBg, f.bg.x, f.bg.y, f.bg.scale);
          applyElementTransform(cv, fixCard, f.hero.x, f.hero.y, f.hero.scale);

          const bx = rect.left + f.hero.x + 90 * f.hero.scale;
          const by = rect.top + f.hero.y + 87 * f.hero.scale;
          const ix = rect.left + f.hero.x + 90 * f.hero.scale;
          const iy = rect.top + f.hero.y + 32 * f.hero.scale;
          const bHits = document.elementsFromPoint(bx, by);
          const iHits = document.elementsFromPoint(ix, iy);
          const outHits = document.elementsFromPoint(rect.left + 4, rect.top + 4);
          if (!bHits.includes(btn)) throw new Error(`at ${focalMm} mm button missed (top=${bHits[0]?.tagName})`);
          if (!iHits.includes(inp)) throw new Error(`at ${focalMm} mm input missed (top=${iHits[0]?.tagName})`);
          if (outHits.includes(fixCard)) throw new Error(`at ${focalMm} mm corner outside card hit fixCard`);
          return { bx: Math.round(bx - rect.left), by: Math.round(by - rect.top) };
        };

        const p18 = checkAt(18);
        const p135 = checkAt(135);
        return `18 mm button (${p18.bx},${p18.by}) & 135 mm button (${p135.bx},${p135.by}) both hit`;
      } finally {
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Reduced motion snaps focal presets and context loss restores without loseContext()',
    why: 'Tests stepFocalAnim(..., true) for immediate preset snaps, then dispatches synthetic webglcontextlost and webglcontextrestored events on an isolated fixture.',
    run: async () => {
      const snapped = stepFocalAnim({ from: 18, to: 135, startMs: 0, durMs: 500 }, 10, true);
      if (!snapped.settled || snapped.focalMm !== 135) {
        throw new Error(`reduced-motion step did not snap (got ${snapped.focalMm}, settled=${snapped.settled})`);
      }

      const box = document.createElement('div');
      box.style.cssText = 'position:relative;width:160px;height:100px;';
      const vp = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.width = 160;
      cv.height = 100;
      const fixBg = document.createElement('div');
      fixBg.setAttribute('drawable', '');
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.textContent = 'Subject';
      const ph = document.createElement('div');
      ph.hidden = true;
      cv.append(fixBg, fixCard);
      vp.append(cv);
      box.append(vp, ph);
      testStage().append(box);

      let note = '';
      let restored = false;
      attachContextLossController({
        targetCanvas: cv,
        targetViewport: vp,
        targetElements: [fixBg, fixCard],
        targetPlainHost: ph,
        onPlain: (m) => { note = m; },
        onRestore: () => { restored = true; },
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(lostEv);
      const fellBack = lostEv.defaultPrevented && vp.hidden && !ph.hidden && ph.contains(fixCard) && ph.contains(fixBg);
      if (!fellBack) throw new Error(`fallback failed (prevented=${lostEv.defaultPrevented}, cardInPlain=${ph.contains(fixCard)})`);

      cv.dispatchEvent(new Event('webglcontextrestored'));
      const cameBack = restored && !vp.hidden && ph.hidden && cv.contains(fixCard) && cv.contains(fixBg);
      box.remove();
      window.__gfx?.retire?.(cv);
      if (!cameBack) throw new Error('webglcontextrestored did not restore layers to canvas');
      return `reduced-motion snapped 18->135 mm; synthetic loss moved layers ("${note.slice(0, 28)}…") and restored`;
    },
  },
  stillDrawn(() => [
    {
      name: 'dolly-zoom stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !state.texUploaded || !state.hasPainted) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return 1;
        }
        return state.hasPainted && canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => showPlainFallback('Canvas drew blank after live checks; switched to plain HTML.'),
    },
  ]),
]);
