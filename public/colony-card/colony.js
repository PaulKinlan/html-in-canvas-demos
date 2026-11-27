import {
  banner,
  supported as supported2d,
  runTests,
  testStage,
  nextPaint,
  stillDrawn,
  inkFraction,
} from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit, cssZoom } from '/lib/surface.js';

banner();

const SIM_W = 192;
const SIM_H = 256;
const STEPS_PER_SEED = 88;

const STRAINS = {
  moss: {
    label: 'MOSS',
    bg: [0.059, 0.165, 0.114],      // #0f2a1d
    cell: [0.114, 0.298, 0.200],    // #1d4c33
    ink: [0.851, 0.976, 0.616],     // #d9f99d
    rim: [0.290, 0.871, 0.502],     // #4ade80
    diff2d: '#9ae6b4',
    rim2d: '#16a34a',
  },
  coral: {
    label: 'CORAL',
    bg: [0.169, 0.063, 0.098],      // #2b1019
    cell: [0.329, 0.106, 0.169],    // #541b2b
    ink: [1.000, 0.894, 0.839],     // #ffe4d6
    rim: [0.984, 0.443, 0.522],     // #fb7185
    diff2d: '#feb2b2',
    rim2d: '#e11d48',
  },
  cobalt: {
    label: 'COBALT',
    bg: [0.051, 0.106, 0.220],      // #0d1b38
    cell: [0.098, 0.200, 0.396],    // #193365
    ink: [0.859, 0.918, 0.996],     // #dbeafe
    rim: [0.220, 0.741, 0.973],     // #38bdf8
    diff2d: '#93c5fd',
    rim2d: '#0284c7',
  },
  neon: {
    label: 'NEON',
    bg: [0.067, 0.075, 0.102],      // #11131a
    cell: [0.141, 0.157, 0.235],    // #24283c
    ink: [0.639, 1.000, 0.796],     // #a3ffcb
    rim: [0.133, 1.000, 0.533],     // #22ff88
    diff2d: '#6ee7b7',
    rim2d: '#10b981',
  },
};

const stageWrap = document.getElementById('colony-stage');
const viewportEl = document.getElementById('colony-viewport');
const canvas = document.getElementById('colony-canvas');
const cardEl = document.getElementById('colony-card');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('colony-hud');
const noticeEl = document.getElementById('colony-notice');
const pillEl = document.getElementById('colony-pill');
const reducedChk = document.getElementById('chk-reduced');
const strainTag = document.getElementById('card-strain-tag');
const wordInput = document.getElementById('specimen-word');
const seedBtn = document.getElementById('btn-seed');
const clearBtn = document.getElementById('btn-clear');
const strainBtns = Array.from(document.querySelectorAll('.strain-btn'));
const checkboxes = Array.from(cardEl.querySelectorAll('input[type="checkbox"]'));
const testsBody = document.getElementById('tests');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

if (reducedQuery.matches) reducedChk.checked = true;

function isReducedMotion() {
  return reducedChk.checked || reducedQuery.matches;
}

// #region sim-shaders
const SIM_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  // Both simulation FBOs and ElementGL DOM textures share top-down UV (v = 0 top, v = 1 bottom)
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const SIM_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uPrev;
uniform sampler2D uTex;
uniform vec2 uSimSize;
uniform float uAspect;
uniform float uHasTex;
uniform int uMode;       // 0 = clear dish, 1 = stamp seed, 2 = reaction-diffusion step
uniform vec2 uSeed;
uniform float uSeedRadius;
uniform float uReduced;

out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  return 0.62 * vnoise(p) + 0.38 * vnoise(p * 2.13 + vec2(4.7, 1.9));
}

void main() {
  if (uMode == 0) {
    // R = active biomass, G = agar nutrient, B = persistent colonised territory
    outColor = vec4(0.0, 1.0, 0.0, 1.0);
    return;
  }

  vec4 cur = texture(uPrev, vUv);

  if (uMode == 1) {
    vec2 diff = (vUv - uSeed) * vec2(uAspect, 1.0);
    float d = length(diff);
    float ang = atan(diff.y, diff.x);
    float wobble = 0.85 + 0.25 * fbm(vec2(uAspect * vUv.x, vUv.y) * 14.0 + uSeed * 7.0);
    float eff = d / max(0.005, uSeedRadius * wobble);

    if (uReduced > 0.5) {
      // Reduced motion: stamp a deterministic multi-lobed static ring at once
      float ringD = d / max(0.01, uSeedRadius * 3.1 * (0.88 + 0.16 * sin(ang * 5.0 + uSeed.x * 18.0)));
      float body = 1.0 - smoothstep(0.65, 1.0, ringD);
      float rim = smoothstep(0.55, 0.82, ringD) * (1.0 - smoothstep(0.88, 1.05, ringD));
      float nextR = clamp(max(cur.r, rim * 0.85 + body * 0.18), 0.0, 1.0);
      float nextG = clamp(min(cur.g, 1.0 - body * 0.65), 0.0, 1.0);
      float nextB = clamp(max(cur.b, body), 0.0, 1.0);
      outColor = vec4(nextR, nextG, nextB, 1.0);
      return;
    }

    float drop = 1.0 - smoothstep(0.45, 1.0, eff);
    float halo = 1.0 - smoothstep(0.7, 2.2, eff);
    float nextR = clamp(max(cur.r, drop * 0.94), 0.0, 1.0);
    float nextG = clamp(mix(cur.g, 1.0, halo * 0.55), 0.0, 1.0);
    float nextB = clamp(max(cur.b, drop * 0.88), 0.0, 1.0);
    outColor = vec4(nextR, nextG, nextB, 1.0);
    return;
  }

  vec2 px = 1.0 / max(uSimSize, vec2(1.0));
  vec4 n  = texture(uPrev, clamp(vUv + vec2( 0.0, -px.y), vec2(0.0), vec2(1.0)));
  vec4 s  = texture(uPrev, clamp(vUv + vec2( 0.0,  px.y), vec2(0.0), vec2(1.0)));
  vec4 w  = texture(uPrev, clamp(vUv + vec2(-px.x,  0.0), vec2(0.0), vec2(1.0)));
  vec4 e  = texture(uPrev, clamp(vUv + vec2( px.x,  0.0), vec2(0.0), vec2(1.0)));
  vec4 nw = texture(uPrev, clamp(vUv + vec2(-px.x, -px.y), vec2(0.0), vec2(1.0)));
  vec4 ne = texture(uPrev, clamp(vUv + vec2( px.x, -px.y), vec2(0.0), vec2(1.0)));
  vec4 sw = texture(uPrev, clamp(vUv + vec2(-px.x,  px.y), vec2(0.0), vec2(1.0)));
  vec4 se = texture(uPrev, clamp(vUv + vec2( px.x,  px.y), vec2(0.0), vec2(1.0)));

  vec4 avg = 0.20 * (n + s + w + e) + 0.05 * (nw + ne + sw + se);
  float maxR = max(max(max(n.r, s.r), max(w.r, e.r)), max(max(nw.r, ne.r), max(sw.r, se.r)));

  float ink = 0.0;
  if (uHasTex > 0.5) {
    vec4 dom = texture(uTex, vUv);
    vec3 rgb = dom.a > 0.001 ? dom.rgb / dom.a : vec3(1.0);
    float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    ink = smoothstep(0.70, 0.20, lum) * dom.a;
  }

  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  float lobe = fbm(p * 11.5);
  float micro = fbm(p * 29.0 + vec2(3.7, 8.1));
  float substrate = mix(0.46, 1.38, 0.65 * lobe + 0.35 * micro) + ink * 0.44;

  float lapR = avg.r - cur.r;
  float spreadR = mix(avg.r, maxR, 0.28);
  float activeMask = smoothstep(0.015, 0.24, spreadR);
  float grow = spreadR * cur.g * substrate * 0.25 * activeMask;
  float decay = cur.r * (0.044 + 0.036 * (1.0 - cur.g));
  float nextR = clamp(cur.r + 0.26 * lapR + grow - decay, 0.0, 1.0);

  float lapG = avg.g - cur.g;
  float consume = 0.068 * nextR * cur.g;
  float trickle = 0.005 * ink * (1.0 - cur.g);
  float nextG = clamp(cur.g + 0.20 * lapG - consume + trickle, 0.0, 1.0);

  float targetB = smoothstep(0.09, 0.40, nextR);
  float nextB = max(cur.b, mix(cur.b, targetB, 0.24));
  if (nextR > 0.20 && nextB - cur.b < 0.008) {
    nextB = min(1.0, cur.b + 0.012);
  }

  outColor = vec4(nextR, nextG, nextB, 1.0);
}`;

const COLONY_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTex;
uniform sampler2D uField;
uniform vec2 uSize;
uniform float uTime;
uniform vec3 uColonyBg;
uniform vec3 uCellTint;
uniform vec3 uColonyInk;
uniform vec3 uRimColor;

out vec4 outColor;

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Returns (distance to nearest cell centre, distance to nearest cell wall)
vec2 voronoi(vec2 x) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  vec2 mg = vec2(0.0);
  vec2 mr = vec2(0.0);
  float md = 8.0;

  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      float d = dot(r, r);
      if (d < md) {
        md = d;
        mr = r;
        mg = g;
      }
    }
  }

  md = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 o = hash22(n + g);
      vec2 r = g + (0.14 + 0.72 * o) - f;
      if (dot(mr - r, mr - r) > 0.00001) {
        md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
      }
    }
  }
  return vec2(sqrt(max(0.0, dot(mr, mr))), md);
}

void main() {
  vec4 dom = texture(uTex, vUv);
  if (dom.a <= 0.001) {
    outColor = vec4(0.0);
    return;
  }
  vec3 src = dom.rgb / dom.a;
  vec4 fld = texture(uField, vUv);

  float aspect = uSize.x / max(uSize.y, 1.0);
  vec2 cellCoord = vec2(vUv.x * aspect, vUv.y) * 26.0 + vec2(fld.r * 0.25, -fld.g * 0.20);
  vec2 vc = voronoi(cellCoord);

  float cellWall = 1.0 - smoothstep(0.03, 0.14, vc.y);
  float cellShade = smoothstep(0.0, 0.65, vc.x);

  float fieldMix = fld.b + 0.18 * fld.r;
  float cov = smoothstep(0.16, 0.34, fieldMix - 0.13 * vc.x);

  float lum = dot(src, vec3(0.2126, 0.7152, 0.0722));
  float inkMask = smoothstep(0.70, 0.22, lum);
  float chroma = clamp(max(max(src.r, src.g), src.b) - min(min(src.r, src.g), src.b), 0.0, 1.0);

  vec3 cellBg = mix(uColonyBg, uCellTint, 0.34 * cellShade + 0.42 * cellWall * (0.28 + 0.72 * fld.r));
  vec3 inverted = mix(cellBg, uColonyInk, clamp(inkMask + chroma * 0.28 * (1.0 - inkMask), 0.0, 1.0));

  float outerRim = smoothstep(0.04, 0.28, cov) * (1.0 - smoothstep(0.62, 0.96, cov));
  float bioRim = smoothstep(0.14, 0.60, fld.r) * cov;
  float membrane = clamp(outerRim * 1.2 + bioRim * cellWall * 0.9, 0.0, 1.0);

  vec3 colFace = mix(inverted, uRimColor, membrane * mix(0.76, 0.30, inkMask));
  float preAura = smoothstep(0.94, 0.45, fld.g) * (1.0 - cov) * 0.14;
  vec3 baseWithAura = mix(src, uRimColor, preAura * (1.0 - inkMask * 0.75));
  vec3 finalRgb = mix(baseWithAura, colFace, cov);

  outColor = vec4(clamp(finalRgb, 0.0, 1.0) * dom.a, dom.a);
}`;
// #endregion sim-shaders

const QUAD_VERTS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

const state = {
  backend: 'init',
  strain: 'moss',
  onScreen: true,
  hasPainted: false,
  cardDirty: true,
  paints: 0,
  uploads: 0,
  taps: 0,
  stepsRemaining: 0,
  simSteps: 0,
  coverageEst: 0,
  cardW: 354,
  cardH: 500,
  seeds2d: [],
  pendingSeeds: [],
  clearQueued: false,
  paintQueued: false,
  rafId: 0,
};

let stage = null;
let simRes = null;
let ctx2d = null;
let raf2d = 0;

function compileSimShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(log || 'Simulation shader compile failed');
  }
  return s;
}

// #region ping-pong
function createSimResources(gl, simW = SIM_W, simH = SIM_H) {
  const vs = compileSimShader(gl, gl.VERTEX_SHADER, SIM_VS);
  const fs = compileSimShader(gl, gl.FRAGMENT_SHADER, SIM_FS);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(log || 'Simulation program link failed');
  }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const buffers = [0, 1].map(() => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, simW, simH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
      throw new Error(`Simulation RGBA8 FBO incomplete (status ${status})`);
    }
    return { tex, fbo, status };
  });

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);

  const res = {
    prog,
    vao,
    vbo,
    w: simW,
    h: simH,
    buffers,
    readIdx: 0,
    uPrev: gl.getUniformLocation(prog, 'uPrev'),
    uTex: gl.getUniformLocation(prog, 'uTex'),
    uSimSize: gl.getUniformLocation(prog, 'uSimSize'),
    uAspect: gl.getUniformLocation(prog, 'uAspect'),
    uHasTex: gl.getUniformLocation(prog, 'uHasTex'),
    uMode: gl.getUniformLocation(prog, 'uMode'),
    uSeed: gl.getUniformLocation(prog, 'uSeed'),
    uSeedRadius: gl.getUniformLocation(prog, 'uSeedRadius'),
    uReduced: gl.getUniformLocation(prog, 'uReduced'),
  };
  clearSimBuffers(gl, res);
  return res;
}

function disposeSimResources(gl, res) {
  if (!res || !gl || gl.isContextLost()) return;
  for (const b of res.buffers) {
    gl.deleteFramebuffer(b.fbo);
    gl.deleteTexture(b.tex);
  }
  gl.deleteBuffer(res.vbo);
  gl.deleteVertexArray(res.vao);
  gl.deleteProgram(res.prog);
}

function runSimPass(gl, res, mode, opts = {}) {
  const dstIdx = 1 - res.readIdx;
  const src = res.buffers[res.readIdx];
  const dst = res.buffers[dstIdx];

  gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, res.w, res.h);
  gl.useProgram(res.prog);
  gl.bindVertexArray(res.vao);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src.tex);
  gl.uniform1i(res.uPrev, 0);

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, opts.domTex ?? src.tex);
  gl.uniform1i(res.uTex, 1);

  gl.uniform2f(res.uSimSize, res.w, res.h);
  gl.uniform1f(res.uAspect, opts.aspect ?? 0.72);
  gl.uniform1f(res.uHasTex, opts.domTex ? 1.0 : 0.0);
  gl.uniform1i(res.uMode, mode);
  gl.uniform2f(res.uSeed, opts.u ?? 0.5, opts.v ?? 0.5);
  gl.uniform1f(res.uSeedRadius, opts.radius ?? 0.036);
  gl.uniform1f(res.uReduced, opts.reduced ? 1.0 : 0.0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  res.readIdx = dstIdx;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
}

function clearSimBuffers(gl, res) {
  runSimPass(gl, res, 0);
  runSimPass(gl, res, 0);
}

function stampSimSeed(gl, res, u, v, opts = {}) {
  runSimPass(gl, res, 1, { u, v, ...opts });
}

function stepSimBuffers(gl, res, count, opts = {}) {
  for (let i = 0; i < count; i++) {
    runSimPass(gl, res, 2, opts);
  }
}
// #endregion ping-pong

// #region hit-geometry
const unitCache = { key: '', unit: 1 };
let lastGeoKey = '';

function cachedGeometryUnit(cv, el, cssW, cache = unitCache) {
  const zoom = cssZoom(el);
  const key = `${cv.width}x${cv.height}/${cv.clientWidth}x${cv.clientHeight}/${Math.round(cssW)}/${zoom}`;
  if (cache.key !== key) {
    cache.unit = geometryUnit(cv, el, cssW);
    cache.key = key;
    lastGeoKey = '';
  }
  return cache.unit;
}

function syncCardGeometry(cv, el, cssW) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  const unit = cachedGeometryUnit(cv, el, cssW);
  const key = `${unit.toFixed(4)}:${cv.width}x${cv.height}`;
  if (key === lastGeoKey) return;
  lastGeoKey = key;
  const mat = new DOMMatrix().scale(unit, unit, 1);
  cv.updateElementGeometry(el, { canvasTransform: mat });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}

function cardUvFromEvent(e) {
  const r = canvas.getBoundingClientRect();
  const z = cssZoom(canvas);
  const x = (e.clientX - r.left) / z;
  const y = (e.clientY - r.top) / z;
  return {
    u: Math.max(0.01, Math.min(0.99, x / Math.max(1, state.cardW))),
    v: Math.max(0.01, Math.min(0.99, y / Math.max(1, state.cardH))),
  };
}
// #endregion hit-geometry

function measureCardSize() {
  const w = canvas.clientWidth || viewportEl.clientWidth || 354;
  const h = canvas.clientHeight || viewportEl.clientHeight || 472;
  if (w !== state.cardW || h !== state.cardH || !canvas.style.getPropertyValue('--card-w')) {
    state.cardW = w;
    state.cardH = h;
    canvas.style.setProperty('--card-w', `${w}px`);
    canvas.style.setProperty('--card-h', `${h}px`);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    state.cardDirty = true;
    unitCache.key = '';
    lastGeoKey = '';
  }
  return { w, h };
}

function showNotice(msg) {
  noticeEl.hidden = !msg;
  noticeEl.textContent = msg || '';
}

function updateHud() {
  const strainName = STRAINS[state.strain].label;
  const route =
    state.backend === 'webgl2' ? 'WebGL 2 (ElementGL)' :
    state.backend === '2d' ? '2D drawElementImage()' :
    'Plain HTML';
  const cov = Math.min(100, Math.round(state.coverageEst * 100));
  pillEl.textContent = `${state.taps} ${state.taps === 1 ? 'tap' : 'taps'} · ~${cov}% · ${strainName}`;
  hudEl.textContent = `${route} · ${SIM_W}x${SIM_H} RGBA8 FBO · ${state.simSteps} steps · ${state.paints} paints, ${state.uploads} uploads`;
}

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  if (raf2d) {
    cancelAnimationFrame(raf2d);
    raf2d = 0;
  }
}

function requestRedraw() {
  if (state.backend === 'webgl2') {
    if (!state.paintQueued) {
      state.paintQueued = true;
      canvas.requestPaint?.();
    }
  } else if (state.backend === '2d') {
    if (!raf2d) raf2d = requestAnimationFrame(draw2DFallback);
  }
}

function wakeLoop() {
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;
  if (isReducedMotion()) {
    requestRedraw();
    return;
  }
  if (state.backend === 'webgl2') {
    if (!state.rafId && state.stepsRemaining > 0) {
      state.rafId = requestAnimationFrame(tickWebGL);
    }
  } else if (state.backend === '2d') {
    if (!raf2d && state.stepsRemaining > 0) {
      raf2d = requestAnimationFrame(draw2DFallback);
    }
  }
}

function tickWebGL() {
  state.rafId = 0;
  if (!state.onScreen || document.hidden || state.backend !== 'webgl2') return;
  if (state.stepsRemaining > 0 || state.pendingSeeds.length || state.clearQueued) {
    requestRedraw();
    if (!isReducedMotion() && state.stepsRemaining > 0) {
      state.rafId = requestAnimationFrame(tickWebGL);
    }
  }
}

function seedAt(u, v, opts = {}) {
  if (state.backend === 'plain') return;
  state.taps++;
  const dropRadius = opts.radius ?? 0.038;
  state.coverageEst = Math.min(1, state.coverageEst + (isReducedMotion() ? 0.14 : 0.18) * (1 - state.coverageEst * 0.55));

  if (state.backend === 'webgl2') {
    state.pendingSeeds.push({ u, v, radius: dropRadius, reduced: isReducedMotion() });
    if (!isReducedMotion()) {
      state.stepsRemaining = Math.max(state.stepsRemaining, opts.steps ?? STEPS_PER_SEED);
    }
    requestRedraw();
    wakeLoop();
  } else if (state.backend === '2d') {
    const maxR = Math.min(state.cardW, state.cardH) * (isReducedMotion() ? 0.24 : 0.34);
    state.seeds2d.push({
      x: u * state.cardW,
      y: v * state.cardH,
      r: isReducedMotion() ? maxR * 0.72 : 14,
      maxR,
      seedAngle: u * 6.28 + v * 3.14,
    });
    if (!isReducedMotion()) {
      state.stepsRemaining = Math.max(state.stepsRemaining, opts.steps ?? STEPS_PER_SEED);
    }
    requestRedraw();
    wakeLoop();
  }
  updateHud();
}

function clearDish() {
  state.taps = 0;
  state.simSteps = 0;
  state.stepsRemaining = 0;
  state.coverageEst = 0;
  state.pendingSeeds.length = 0;
  state.seeds2d.length = 0;
  state.clearQueued = true;
  stopLoop();
  requestRedraw();
  updateHud();
}

function setStrain(name) {
  if (!STRAINS[name]) return;
  state.strain = name;
  strainTag.textContent = `STRAIN: ${STRAINS[name].label}`;
  for (const btn of strainBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.strain === name));
  }
  state.cardDirty = true;
  requestRedraw();
  updateHud();
}

function drawSceneWebGL(e) {
  state.paintQueued = false;
  if (!stage || stage.lost || !simRes) return;
  state.hasPainted = true;
  const { w, h } = measureCardSize();
  const changed = e?.changedElements ?? null;

  const gl = stage.gl;
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  if (!stage.begin([0.98, 0.97, 0.94, 1.0])) return;
  const mainProg = gl.getParameter(gl.CURRENT_PROGRAM);
  const mainVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);

  if (state.cardDirty || !stage.has(cardEl) || (changed && changed.includes(cardEl))) {
    try {
      const uploaded = stage.upload(cardEl);
      if (uploaded?.tex) state.domTex = uploaded.tex;
      state.cardDirty = false;
      state.uploads++;
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        requestRedraw();
        return;
      }
      throw err;
    }
  }

  const aspect = w / Math.max(1, h);

  if (state.clearQueued) {
    clearSimBuffers(gl, simRes);
    state.clearQueued = false;
  }

  while (state.pendingSeeds.length) {
    const s = state.pendingSeeds.shift();
    stampSimSeed(gl, simRes, s.u, s.v, { aspect, radius: s.radius, reduced: s.reduced });
    state.simSteps++;
  }

  if (!isReducedMotion() && state.stepsRemaining > 0) {
    const batch = state.simSteps <= 1 ? 16 : 1;
    stepSimBuffers(gl, simRes, batch, { aspect, domTex: state.domTex || null });
    state.simSteps += batch;
    state.stepsRemaining = Math.max(0, state.stepsRemaining - 1);
  }

  // Restore default framebuffer & ElementGL state to composite live card + colony field
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(mainProg);
  gl.bindVertexArray(mainVao);

  const pal = STRAINS[state.strain];
  const fieldTex = simRes.buffers[simRes.readIdx].tex;
  const mat = ElementGL.rect(canvas, 0, 0, w, h);

  stage.quad(cardEl, mat, (g, uniform) => {
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, fieldTex);
    g.uniform1i(uniform('uField'), 1);
    g.uniform3fv(uniform('uColonyBg'), pal.bg);
    g.uniform3fv(uniform('uCellTint'), pal.cell);
    g.uniform3fv(uniform('uColonyInk'), pal.ink);
    g.uniform3fv(uniform('uRimColor'), pal.rim);
    g.activeTexture(g.TEXTURE0);
  });

  state.paints++;
  syncCardGeometry(canvas, cardEl, w);
  updateHud();
}

// #region fallback-paths
function draw2DFallback() {
  raf2d = 0;
  if (!ctx2d || state.backend !== '2d') return;
  const { w, h } = measureCardSize();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(w * dpr));
  const bh = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.drawElementImage(cardEl, 0, 0, w, h);

  const pal = STRAINS[state.strain];
  let growing = false;
  if (!isReducedMotion() && state.stepsRemaining > 0) {
    for (const s of state.seeds2d) {
      if (s.r < s.maxR) {
        s.r = Math.min(s.maxR, s.r + 0.85);
        growing = true;
      }
    }
    state.stepsRemaining = growing ? Math.max(0, state.stepsRemaining - 1) : 0;
  }

  if (state.seeds2d.length) {
    ctx2d.save();
    for (const s of state.seeds2d) {
      ctx2d.beginPath();
      const lobes = 18;
      for (let i = 0; i <= lobes; i++) {
        const a = (i / lobes) * Math.PI * 2;
        const r = s.r * (0.84 + 0.16 * Math.sin(a * 5 + s.seedAngle) + 0.08 * Math.cos(a * 9 - s.seedAngle));
        const px = s.x + Math.cos(a) * r;
        const py = s.y + Math.sin(a) * r;
        if (i === 0) ctx2d.moveTo(px, py);
        else ctx2d.lineTo(px, py);
      }
      ctx2d.closePath();
      ctx2d.globalCompositeOperation = 'difference';
      ctx2d.fillStyle = pal.diff2d;
      ctx2d.fill();

      ctx2d.globalCompositeOperation = 'source-over';
      ctx2d.lineWidth = 2.5;
      ctx2d.strokeStyle = pal.rim2d;
      ctx2d.stroke();
    }
    ctx2d.restore();
  }

  state.paints++;
  syncCardGeometry(canvas, cardEl, w);
  updateHud();

  if (!isReducedMotion() && growing && state.onScreen && !document.hidden) {
    raf2d = requestAnimationFrame(draw2DFallback);
  }
}

function enterPlainFallback(reason) {
  stopLoop();
  state.backend = 'plain';
  stageWrap.classList.add('is-plain');
  cardEl.inert = false;
  if (cardEl.parentElement !== plainHost) plainHost.append(cardEl);
  showNotice(reason);
  updateHud();
}

function exitPlainFallback() {
  stageWrap.classList.remove('is-plain');
  cardEl.inert = false;
  if (cardEl.parentElement !== canvas) canvas.append(cardEl);
  state.cardDirty = true;
  lastGeoKey = '';
  showNotice('');
}
// #endregion fallback-paths

function initStarterColony() {
  state.pendingSeeds.push({ u: 0.76, v: 0.24, radius: 0.042, reduced: isReducedMotion() });
  state.coverageEst = 0.16;
  if (!isReducedMotion()) {
    state.stepsRemaining = 42;
  }
  if (state.backend === '2d') {
    const rMax = Math.min(state.cardW, state.cardH) * 0.25;
    state.seeds2d.push({
      x: 0.76 * state.cardW,
      y: 0.24 * state.cardH,
      r: isReducedMotion() ? rMax : 24,
      maxR: rMax,
      seedAngle: 5.4,
    });
  }
}

if (glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: COLONY_FRAG,
      onLost: () => {
        simRes = null;
        state.domTex = null;
        enterPlainFallback('The browser took the WebGL 2 context away. The specimen card stays editable as plain HTML until it returns.');
      },
      onRestored: () => {
        simRes = createSimResources(stage.gl);
        state.domTex = null;
        state.backend = 'webgl2';
        exitPlainFallback();
        initStarterColony();
        requestRedraw();
        wakeLoop();
      },
    });
    simRes = createSimResources(stage.gl);
    state.backend = 'webgl2';
  } catch (err) {
    stage = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D drawElementImage() fallback.`);
  }
}

if (!stage && supported2d) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.backend = '2d';
    if (noticeEl.hidden) {
      showNotice('WebGL 2 texElementSubImage2D() is not available here. Drawing with the 2D drawElementImage() fallback.');
    }
    canvas.addEventListener('contextlost', () => {
      enterPlainFallback('The 2D canvas lost its context. Showing the specimen card as plain HTML.');
    });
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the specimen card is shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (state.backend === 'webgl2') drawSceneWebGL(e);
  else if (state.backend === '2d') draw2DFallback();
});

// ---- Card & control wiring (zero swallowed clicks) ----
cardEl.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain' || e.button > 0) return;
  if (e.target?.closest?.('#btn-clear, #btn-seed')) return;
  const { u, v } = cardUvFromEvent(e);
  seedAt(u, v);
});

cardEl.addEventListener('pointermove', (e) => {
  if (state.backend === 'plain' || e.pointerType !== 'mouse' || e.buttons !== 1) return;
  if (e.target?.closest?.('input[type="text"], button')) return;
  const { u, v } = cardUvFromEvent(e);
  if (state.backend === 'webgl2') {
    state.pendingSeeds.push({ u, v, radius: 0.024, reduced: isReducedMotion() });
    if (!isReducedMotion()) state.stepsRemaining = Math.max(state.stepsRemaining, 120);
    requestRedraw();
    wakeLoop();
  }
});

for (const chk of checkboxes) {
  chk.addEventListener('change', () => {
    state.cardDirty = true;
    requestRedraw();
  });
}

wordInput.addEventListener('input', () => {
  state.cardDirty = true;
  requestRedraw();
});

for (const btn of strainBtns) {
  btn.addEventListener('click', () => {
    setStrain(btn.dataset.strain);
  });
}

seedBtn.addEventListener('click', () => {
  if (isReducedMotion() && state.backend === 'webgl2' && simRes && state.domTex) {
    // Manual discrete growth steps when reduced motion disables continuous animation
    seedAt(0.5, 0.5, { radius: 0.044 });
    stepSimBuffers(stage.gl, simRes, 10, {
      aspect: state.cardW / Math.max(1, state.cardH),
      domTex: state.domTex,
    });
    state.simSteps += 10;
    requestRedraw();
    return;
  }
  seedAt(0.5, 0.5, { radius: 0.045 });
});

clearBtn.addEventListener('click', () => {
  clearDish();
});

reducedChk.addEventListener('change', () => {
  if (isReducedMotion()) {
    state.stepsRemaining = 0;
    stopLoop();
  }
  requestRedraw();
});

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = Boolean(entry?.isIntersecting);
    if (state.onScreen) {
      if (state.stepsRemaining > 0) wakeLoop();
      else requestRedraw();
    } else {
      stopLoop();
    }
  }, { rootMargin: '120px 0px' }).observe(stageWrap);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (state.onScreen) {
    if (state.stepsRemaining > 0) wakeLoop();
    else requestRedraw();
  }
});

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    measureCardSize();
    requestRedraw();
  }).observe(canvas);
}

measureCardSize();
if (state.backend !== 'plain') {
  initStarterColony();
  requestRedraw();
  wakeLoop();
}
updateHud();

// ---- Live checks (isolated testStage() fixtures, retired after each check) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = (ok, detail) => { if (!ok) throw new Error(detail); return detail; };

async function createColonyFixture(w, h, markup) {
  if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  cv.width = Math.max(1, Math.round(w * dpr));
  cv.height = Math.max(1, Math.round(h * dpr));
  cv.style.cssText = `flex:none;position:relative;display:block;width:${w}px;height:${h}px;`;
  cv.innerHTML = markup;
  testStage().append(cv);
  const glStage = new ElementGL(cv, {
    fragment: COLONY_FRAG,
    attributes: { preserveDrawingBuffer: true },
  });
  const res = createSimResources(glStage.gl, SIM_W, SIM_H);
  const done = async () => {
    disposeSimResources(glStage.gl, res);
    glStage.dispose();
    cv.remove();
    window.__gfx?.active?.();
    window.__gfx?.retire?.(cv);
    await sleep(230);
    window.__gfx?.release?.(cv);
  };
  return { cv, glStage, res, done };
}

function drawFixtureComposite(fx, card, strainKey = 'moss', cw = 240, ch = 320) {
  const gl = fx.glStage.gl;
  const pal = STRAINS[strainKey];
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  if (!fx.glStage.begin([1, 1, 1, 1])) throw new Error('ElementGL.begin() returned false');
  const fieldTex = fx.res.buffers[fx.res.readIdx].tex;
  fx.glStage.quad(card, ElementGL.rect(fx.cv, 0, 0, cw, ch), (g, uniform) => {
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, fieldTex);
    g.uniform1i(uniform('uField'), 1);
    g.uniform3fv(uniform('uColonyBg'), pal.bg);
    g.uniform3fv(uniform('uCellTint'), pal.cell);
    g.uniform3fv(uniform('uColonyInk'), pal.ink);
    g.uniform3fv(uniform('uRimColor'), pal.rim);
    g.activeTexture(g.TEXTURE0);
  });
}

runTests(testsBody, [
  {
    name: 'ElementGL + RGBA8 ping-pong FBO setup leaves gl.getError() === 0',
    expect: 'pass',
    why: 'Allocates two 192 by 256 RGBA8 UNSIGNED_BYTE framebuffers inside a single ElementGL context, verifies FRAMEBUFFER_COMPLETE, steps 4 ping-pong passes, draws the uploaded DOM card and checks gl.getError() === gl.NO_ERROR.',
    run: async () => {
      const w = 240, h = 300;
      const fx = await createColonyFixture(
        w,
        h,
        `<div class="fx-card" drawable style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#ffffff;color:#141614;padding:16px;font:700 18px system-ui;box-sizing:border-box;">Plate 01</div>`
      );
      try {
        await nextPaint(fx.cv);
        const card = fx.cv.querySelector('.fx-card');
        const gl = fx.glStage.gl;
        const uploaded = fx.glStage.upload(card);
        stampSimSeed(gl, fx.res, 0.5, 0.5, { aspect: w / h, radius: 0.05 });
        stepSimBuffers(gl, fx.res, 4, { aspect: w / h, domTex: uploaded.tex });
        drawFixtureComposite(fx, card, 'moss', w, h);
        const err = gl.getError();
        const fboOk = fx.res.buffers.every((b) => b.status === gl.FRAMEBUFFER_COMPLETE);
        return need(
          fboOk && err === gl.NO_ERROR,
          `2 RGBA8 FBOs (${SIM_W}x${SIM_H}) status=${fx.res.buffers[0].status} (COMPLETE=${gl.FRAMEBUFFER_COMPLETE}), tex=${uploaded.w}x${uploaded.h}, gl.getError()=${err}.`
        );
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'Seeding top-left (u=0.22, v=0.22) grows pixels in HTML top-left without Y-inversion',
    expect: 'pass',
    why: 'Drops a seed at (0.22, 0.22), advances 25 ping-pong steps (an odd count across both FBOs), renders over a white card and samples default-framebuffer pixels in top-left, bottom-left and bottom-right via readPixels().',
    run: async () => {
      const w = 240;
      const h = 320;
      const fx = await createColonyFixture(
        w,
        h,
        `<div class="fx-card" drawable style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#ffffff;"></div>`
      );
      try {
        await nextPaint(fx.cv);
        const card = fx.cv.querySelector('.fx-card');
        const gl = fx.glStage.gl;
        const uploaded = fx.glStage.upload(card);

        clearSimBuffers(gl, fx.res);
        stampSimSeed(gl, fx.res, 0.22, 0.22, { aspect: w / h, radius: 0.05 });
        stepSimBuffers(gl, fx.res, 25, { aspect: w / h, domTex: uploaded.tex });
        drawFixtureComposite(fx, card, 'moss', w, h);

        const readCss = (u, v) => {
          const px = new Uint8Array(4);
          const rx = Math.max(0, Math.min(fx.cv.width - 1, Math.round(u * fx.cv.width)));
          const ry = Math.max(0, Math.min(fx.cv.height - 1, Math.round((1 - v) * fx.cv.height)));
          gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return px;
        };

        const topLeft = readCss(0.22, 0.22);
        const botLeft = readCss(0.22, 0.78);
        const botRight = readCss(0.78, 0.78);
        const tlLum = 0.2126 * topLeft[0] + 0.7152 * topLeft[1] + 0.0722 * topLeft[2];
        const blLum = 0.2126 * botLeft[0] + 0.7152 * botLeft[1] + 0.0722 * botLeft[2];
        const brLum = 0.2126 * botRight[0] + 0.7152 * botRight[1] + 0.0722 * botRight[2];

        return need(
          tlLum < 160 && blLum > 235 && brLum > 235 && gl.getError() === gl.NO_ERROR,
          `top-left=(${topLeft.slice(0, 3).join(',')}) lum=${tlLum.toFixed(0)}; bottom-left=(${botLeft.slice(0, 3).join(',')}) lum=${blLum.toFixed(0)}; bottom-right=(${botRight.slice(0, 3).join(',')}) lum=${brLum.toFixed(0)}.`
        );
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'Colony recolours and inverts live DOM ink vs uncolonised pixels',
    expect: 'pass',
    why: 'Places identical dark DOM swatches (#121412) in top-left and bottom-right of a white card, grows a colony over the top-left swatch and compares colonised ink, colonised paper, uncolonised ink and uncolonised paper via readPixels().',
    run: async () => {
      const w = 240;
      const h = 320;
      const fx = await createColonyFixture(
        w,
        h,
        `<div class="fx-card" drawable style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#ffffff;">` +
        '<div style="position:absolute;left:36px;top:52px;width:28px;height:28px;background:#121412;color:#121412;font:900 20px/1 system-ui;">A</div>' +
        '<div style="position:absolute;left:176px;top:240px;width:28px;height:28px;background:#121412;color:#121412;font:900 20px/1 system-ui;">A</div>' +
        '</div>'
      );
      try {
        await nextPaint(fx.cv);
        const card = fx.cv.querySelector('.fx-card');
        const gl = fx.glStage.gl;
        const uploaded = fx.glStage.upload(card);

        clearSimBuffers(gl, fx.res);
        stampSimSeed(gl, fx.res, 0.23, 0.21, { aspect: w / h, radius: 0.065 });
        stepSimBuffers(gl, fx.res, 22, { aspect: w / h, domTex: uploaded.tex });
        drawFixtureComposite(fx, card, 'moss', w, h);

        const lumAt = (u, v) => {
          const px = new Uint8Array(4);
          const rx = Math.max(0, Math.min(fx.cv.width - 1, Math.round(u * fx.cv.width)));
          const ry = Math.max(0, Math.min(fx.cv.height - 1, Math.round((1 - v) * fx.cv.height)));
          gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return { px: Array.from(px.slice(0, 3)), lum: Math.round(0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2]) };
        };

        const colInk = lumAt(0.208, 0.206);
        const colPaper = lumAt(0.30, 0.206);
        const plainInk = lumAt(0.79, 0.79);
        const plainPaper = lumAt(0.60, 0.79);

        return need(
          colInk.lum > 150 && colPaper.lum < 120 && plainInk.lum < 45 && plainPaper.lum > 235,
          `colonised ink=(${colInk.px.join(',')}) lum=${colInk.lum}, colonised paper=(${colPaper.px.join(',')}) lum=${colPaper.lum}; uncolonised ink=(${plainInk.px.join(',')}) lum=${plainInk.lum}, uncolonised paper=(${plainPaper.px.join(',')}) lum=${plainPaper.lum}.`
        );
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'document.elementsFromPoint() hits checkbox, <input> and <button> inside the WebGL canvas',
    expect: 'pass',
    why: 'Draws a live fixture card with ElementGL, sets updateElementGeometry() scaled by geometryUnit(), clears hit-test cache via dataset.hitTick and verifies document.elementsFromPoint() reaches each control and clicking the checkbox toggles it.',
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const w = 280;
      const h = 240;
      const fx = await createColonyFixture(
        w,
        h,
        `<div class="fx-hit-card" drawable style="position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#fbf9f3;box-sizing:border-box;">` +
        '<input type="checkbox" class="fx-chk" style="position:absolute;left:24px;top:24px;width:28px;height:28px;margin:0;">' +
        '<input type="text" inputmode="none" class="fx-inp" value="AGAR" style="position:absolute;left:24px;top:74px;width:180px;height:38px;box-sizing:border-box;">' +
        '<button type="button" class="fx-btn" style="position:absolute;left:24px;top:134px;width:120px;height:42px;box-sizing:border-box;">Seed</button>' +
        '</div>'
      );
      try {
        await nextPaint(fx.cv);
        const card = fx.cv.querySelector('.fx-hit-card');
        fx.glStage.upload(card);
        drawFixtureComposite(fx, card, 'coral', w, h);

        const unit = geometryUnit(fx.cv, card, w);
        fx.cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit, unit, 1) });
        card.dataset.hitTick = card.dataset.hitTick === '1' ? '0' : '1';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const chk = card.querySelector('.fx-chk');
        const inp = card.querySelector('.fx-inp');
        const btn = card.querySelector('.fx-btn');
        const r = fx.cv.getBoundingClientRect();

        const hitsChk = document.elementsFromPoint(r.left + 38, r.top + 38);
        const hitsInp = document.elementsFromPoint(r.left + 110, r.top + 93);
        const hitsBtn = document.elementsFromPoint(r.left + 84, r.top + 155);

        chk.click();
        inp.value = 'SPORE';

        return need(
          hitsChk.includes(chk) && hitsInp.includes(inp) && hitsBtn.includes(btn) && chk.checked === true && inp.value === 'SPORE',
          `elementsFromPoint hit checkbox (${hitsChk.includes(chk)}), <input> (${hitsInp.includes(inp)}), <button> (${hitsBtn.includes(btn)}); checkbox.checked=${chk.checked}, input.value="${inp.value}".`
        );
      } finally {
        await fx.done();
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'colony-card dish',
      ink: async () => {
        if (state.backend === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.backend === 'webgl2') {
          if (!stage || stage.lost || !simRes) return 0;
          return state.hasPainted && state.uploads >= 1 && state.paints > 0 ? 1 : 0;
        }
        const copy = document.createElement('canvas');
        copy.width = Math.min(240, canvas.width || 1);
        copy.height = Math.min(240, canvas.height || 1);
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
]);
