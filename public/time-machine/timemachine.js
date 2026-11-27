import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const MAX_LAYERS = 16;
const CARD_CSS_W = 360;
const CARD_CSS_H = 292;
const THEME_NAMES = {
  aqua: 'Aqua',
  parchment: 'Paper',
  emerald: 'Mint',
  midnight: 'Night',
};
const LAYOUT_NAMES = ['Time Machine', 'Cover Flow', 'Flip 3D'];
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-9999, -9999) : null;

const SEED_REVISIONS = [
  {
    title: '2007 desktop stack notes',
    body: 'Start with one ElementGL WebGL 2 context. Keep open ElementImage snapshots at zero.',
    theme: 'midnight',
    flags: { ship: false, review: false, urgent: true },
  },
  {
    title: 'Glossy Cover Flow floor',
    body: 'Mirror each card below its bottom edge with a vertical alpha fade on the dark obsidian stage.',
    theme: 'parchment',
    flags: { ship: false, review: true, urgent: false },
  },
  {
    title: '16-layer GPU array cap',
    body: 'Downscale high-DPI textures on the GPU via blitFramebuffer() before copyTexSubImage3D().',
    theme: 'emerald',
    flags: { ship: true, review: true, urgent: false },
  },
  {
    title: 'Vista Flip 3D cascade',
    body: 'Angle every card along Y and step older states back-left over a drifting teal aurora.',
    theme: 'aqua',
    flags: { ship: true, review: false, urgent: false },
  },
  {
    title: 'Leopard starfield tunnel',
    body: 'Stack older revisions up and back in Z so every titlebar peeks out behind the front card.',
    theme: 'midnight',
    flags: { ship: false, review: true, urgent: true },
  },
  {
    title: 'Projective 3D hit boxes',
    body: 'Map the front clip matrix into CSS pixels and scale by geometryUnit() for tilted inputs.',
    theme: 'parchment',
    flags: { ship: true, review: true, urgent: false },
  },
  {
    title: 'Live editable card (Rev 7)',
    body: 'Edit this text, switch a theme pill or press Save snapshot to push a layer into the GPU stack.',
    theme: 'aqua',
    flags: { ship: true, review: false, urgent: false },
  },
];

const stageEl = document.getElementById('tm-stage');
const canvas = document.getElementById('tm-canvas');
const plainHostEl = document.getElementById('tm-plain-host');
const cardEl = document.getElementById('tm-card');
const revPillEl = document.getElementById('tm-rev-pill');
const themeBadgeEl = document.getElementById('tm-theme-badge');
const titleInput = document.getElementById('tm-title');
const bodyInput = document.getElementById('tm-body');
const themeBtns = [...cardEl.querySelectorAll('.tm-theme-pill')];
const flagShip = document.getElementById('tm-flag-ship');
const flagReview = document.getElementById('tm-flag-review');
const flagUrgent = document.getElementById('tm-flag-urgent');
const cardMetaEl = document.getElementById('tm-card-meta');
const saveBtn = document.getElementById('tm-save-btn');

const layoutBtns = [...document.querySelectorAll('.tm-seg button[data-layout]')];
const revStatusEl = document.getElementById('tm-rev-status');
const prevBtn = document.getElementById('tm-prev');
const nextBtn = document.getElementById('tm-next');
const scrubberInput = document.getElementById('tm-scrubber');
const restoreBtn = document.getElementById('tm-restore-btn');
const liveBtn = document.getElementById('tm-live-btn');
const extSaveBtn = document.getElementById('tm-ext-save');
const telemetryEl = document.getElementById('tm-telemetry');
const noticeEl = document.getElementById('tm-notice');

const cardRefs = {
  card: cardEl,
  revPill: revPillEl,
  themeBadge: themeBadgeEl,
  title: titleInput,
  body: bodyInput,
  themeBtns,
  flags: { ship: flagShip, review: flagReview, urgent: flagUrgent },
  meta: cardMetaEl,
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const prefersReducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function say(text) {
  noticeEl.hidden = false;
  noticeEl.textContent = text;
}
function clearNotice() {
  noticeEl.hidden = true;
  noticeEl.textContent = '';
}

function cloneState(data) {
  return {
    title: String(data.title ?? ''),
    body: String(data.body ?? ''),
    theme: THEME_NAMES[data.theme] ? data.theme : 'aqua',
    flags: {
      ship: Boolean(data.flags?.ship),
      review: Boolean(data.flags?.review),
      urgent: Boolean(data.flags?.urgent),
    },
  };
}

function readCardState(refs) {
  return {
    title: refs.title.value,
    body: refs.body.value,
    theme: refs.card.dataset.theme || 'aqua',
    flags: {
      ship: refs.flags.ship.checked,
      review: refs.flags.review.checked,
      urgent: refs.flags.urgent.checked,
    },
  };
}

function countFlags(flags) {
  return (flags.ship ? 1 : 0) + (flags.review ? 1 : 0) + (flags.urgent ? 1 : 0);
}

function applyCardState(refs, data, label, suffix = 'live front') {
  const s = cloneState(data);
  refs.card.dataset.theme = s.theme;
  if (refs.title.value !== s.title) refs.title.value = s.title;
  if (refs.body.value !== s.body) refs.body.value = s.body;
  refs.flags.ship.checked = s.flags.ship;
  refs.flags.review.checked = s.flags.review;
  refs.flags.urgent.checked = s.flags.urgent;
  for (const btn of refs.themeBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.theme === s.theme));
  }
  if (refs.themeBadge) refs.themeBadge.textContent = THEME_NAMES[s.theme] || s.theme;
  if (refs.revPill && label) refs.revPill.textContent = label;
  if (refs.meta) {
    const n = countFlags(s.flags);
    refs.meta.textContent = `${n} ${n === 1 ? 'flag' : 'flags'} · ${suffix}`;
  }
}

// #region shader
const FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;

uniform sampler2D uTex;
uniform sampler2DArray uHistory;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;      // 0 = backdrop, 1 = card face, 2 = floor reflection
uniform int uLayout;    // 0 = Time Machine, 1 = Cover Flow, 2 = Flip 3D
uniform int uUseLive;   // 1 = live uTex, 0 = archived uHistory slice
uniform int uLayer;     // slice index in uHistory
uniform float uAlpha;
uniform float uDim;
uniform float uAngle;
uniform float uFocused;
uniform float uScroll;
uniform vec2 uViewport;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

vec3 timeMachineBackdrop(vec2 uv, float t, float scroll) {
  vec2 centered = (uv - vec2(0.5, 0.44)) * vec2(uViewport.x / max(uViewport.y, 1.0), 1.0);
  float r = length(centered);

  // Deep cosmic indigo-violet base with a soft central nebula behind the stack.
  vec3 col = mix(vec3(0.08, 0.06, 0.21), vec3(0.02, 0.02, 0.06), smoothstep(0.06, 0.96, r));

  float nebA = sin(centered.x * 3.1 + t * 0.14 + scroll * 0.25) * cos(centered.y * 2.8 - t * 0.10);
  float nebB = sin((centered.x - centered.y) * 4.4 - t * 0.12 - scroll * 0.18);
  float cloud = smoothstep(-0.3, 0.9, nebA * 0.55 + nebB * 0.45) * exp(-r * 1.45);
  col += vec3(0.28, 0.10, 0.42) * cloud * 0.52;
  col += vec3(0.06, 0.24, 0.44) * smoothstep(0.1, 0.9, -nebA) * exp(-r * 1.35) * 0.42;

  // Three parallax star layers drifting radially as you travel through history.
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float density = 14.0 + fi * 11.0;
    float depth = fract(fi * 0.33 + scroll * 0.09 + t * 0.008);
    float zoom = mix(1.9, 0.38, depth);
    vec2 gridUv = centered * density * zoom + vec2(fi * 17.3, fi * 9.7);
    vec2 cell = floor(gridUv);
    vec2 f = fract(gridUv) - 0.5;
    float rnd = hash21(cell + fi * 31.0);
    if (rnd > 0.72) {
      vec2 jitter = vec2(hash21(cell + 4.1) - 0.5, hash21(cell + 8.7) - 0.5) * 0.58;
      float d = length(f - jitter);
      float twinkle = 0.65 + 0.35 * sin(t * (1.8 + rnd * 3.0) + rnd * 28.0);
      float fade = smoothstep(0.0, 0.18, depth) * smoothstep(1.0, 0.82, depth);
      float star = smoothstep(0.11, 0.015, d) * twinkle * fade;
      vec3 starCol = mix(vec3(0.75, 0.87, 1.0), vec3(1.0, 0.92, 0.84), fract(rnd * 13.7));
      col += starCol * star * (0.55 + 0.45 * (1.0 - fi * 0.2));
    }
  }

  // Subtle translucent horizon floor mist near the bottom edge.
  float floorMist = smoothstep(0.66, 1.0, uv.y);
  col = mix(col, vec3(0.05, 0.08, 0.18), floorMist * 0.55);
  return col;
}

vec3 coverFlowBackdrop(vec2 uv) {
  float horizon = 0.66;
  float spot = exp(-length((uv - vec2(0.5, 0.44)) * vec2(1.4, 1.8)) * 2.1);
  vec3 wall = mix(vec3(0.025, 0.03, 0.045), vec3(0.09, 0.11, 0.15), spot);
  vec3 floorCol = mix(vec3(0.06, 0.075, 0.10), vec3(0.015, 0.018, 0.026), smoothstep(horizon, 1.0, uv.y));
  vec3 col = mix(wall, floorCol, smoothstep(horizon - 0.008, horizon + 0.012, uv.y));
  float seam = exp(-abs(uv.y - horizon) * 190.0) * (0.25 + 0.75 * spot);
  col += vec3(0.32, 0.40, 0.54) * seam * 0.42;
  return col;
}

vec3 flip3DBackdrop(vec2 uv, float t) {
  vec3 col = mix(vec3(0.025, 0.11, 0.16), vec3(0.015, 0.045, 0.075), uv.y);
  float w1 = sin(uv.x * 4.2 + t * 0.22) * 0.12 + 0.34;
  float w2 = cos(uv.x * 3.1 - t * 0.17 + 1.2) * 0.14 + 0.50;
  float w3 = sin(uv.x * 5.6 + t * 0.14 + 2.4) * 0.09 + 0.62;
  float band1 = exp(-abs(uv.y - w1) * 10.5);
  float band2 = exp(-abs(uv.y - w2) * 8.5);
  float band3 = exp(-abs(uv.y - w3) * 12.0);
  col += vec3(0.06, 0.48, 0.46) * band1 * 0.55;
  col += vec3(0.12, 0.62, 0.40) * band2 * 0.36;
  col += vec3(0.18, 0.42, 0.72) * band3 * 0.30;
  float vig = smoothstep(0.18, 0.95, length(uv - 0.5));
  col *= (1.0 - vig * 0.42);
  return col;
}

void main() {
  if (uPass == 0) {
    vec3 bg = uLayout == 0
      ? timeMachineBackdrop(vUv, uTime, uScroll)
      : (uLayout == 1 ? coverFlowBackdrop(vUv) : flip3DBackdrop(vUv, uTime));
    outColor = vec4(bg, 1.0);
    return;
  }

  // Rounded-corner signed distance mask in aspect-corrected coordinates.
  vec2 aspect = vec2(uSize.x / max(uSize.y, 1.0), 1.0);
  vec2 p = (vUv - 0.5) * aspect;
  float radius = 0.034;
  vec2 q = abs(p) - (0.5 * aspect - vec2(radius));
  float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float aa = max(fwidth(sd), 0.0025);
  float mask = 1.0 - smoothstep(-aa, aa, sd);
  if (mask <= 0.001) discard;

  vec4 sampled = (uUseLive == 1)
    ? texture(uTex, vUv)
    : texture(uHistory, vec3(vUv, float(uLayer)));
  vec3 rgb = sampled.a > 0.001 ? sampled.rgb / sampled.a : sampled.rgb;

  if (uPass == 2) {
    // Glossy floor reflection: vUv.y == 1 touches the mirror seam, fading down toward 0.
    float fade = pow(clamp((vUv.y - 0.20) / 0.80, 0.0, 1.0), 2.1);
    float a = sampled.a * mask * uAlpha * fade;
    if (a <= 0.001) discard;
    vec3 mirrorRgb = mix(rgb * 0.78, vec3(0.05, 0.08, 0.14), 0.25 + 0.35 * (1.0 - fade));
    outColor = vec4(mirrorRgb * a, a);
    return;
  }

  // Distance dimming toward the current layout's atmosphere.
  vec3 fogCol = uLayout == 0
    ? vec3(0.09, 0.08, 0.24)
    : (uLayout == 1 ? vec3(0.03, 0.035, 0.05) : vec3(0.04, 0.14, 0.18));
  rgb = mix(rgb, fogCol, uDim);

  // Subtle 2007 glass sheen across tilted cards.
  float diag = smoothstep(0.05, 0.78, 1.0 - (vUv.x * 0.55 + vUv.y * 0.95));
  float sheenStrength = (0.04 + 0.10 * abs(uAngle)) * (1.0 - uDim * 0.6);
  rgb += vec3(0.86, 0.94, 1.0) * diag * sheenStrength;

  // Crisp bevelled rim highlight (stronger glow around the focused front card).
  float rim = smoothstep(-0.012, -0.001, sd);
  vec3 rimCol = uFocused > 0.5 ? vec3(0.55, 0.85, 1.0) : vec3(0.70, 0.78, 0.90);
  rgb = mix(rgb, rimCol, rim * (uFocused > 0.5 ? 0.55 : 0.30));

  float a = sampled.a * mask * uAlpha;
  outColor = vec4(rgb * a, a);
}`;
// #endregion shader

// #region history-array
const store = {
  tex: null,
  srcFbo: null,
  scratchTex: null,
  scratchFbo: null,
  w: 0,
  h: 0,
  attachedTex: null,
  attachedW: 0,
  attachedH: 0,
  liveW: 0,
  liveH: 0,
};

function computeArraySize(srcW, srcH) {
  const narrow = window.innerWidth < 700;
  const maxBytes = (narrow ? 24 : 36) * 1024 * 1024;
  const maxSide = narrow ? 640 : 760;
  const maxPixels = Math.floor(maxBytes / (4 * MAX_LAYERS));
  const area = Math.max(1, srcW * srcH);
  const scale = Math.min(1, maxSide / srcW, maxSide / srcH, Math.sqrt(maxPixels / area));
  let w = Math.max(32, Math.floor((srcW * scale) / 2) * 2);
  let h = Math.max(32, Math.floor((srcH * scale) / 2) * 2);
  while (w * h * 4 * MAX_LAYERS > maxBytes && w > 32 && h > 32) {
    w = Math.max(32, w - 2);
    h = Math.max(32, h - 2);
  }
  return { w, h };
}

function disposeHistoryArray(gl) {
  if (gl && !gl.isContextLost()) {
    if (store.tex) gl.deleteTexture(store.tex);
    if (store.scratchTex) gl.deleteTexture(store.scratchTex);
    if (store.srcFbo) gl.deleteFramebuffer(store.srcFbo);
    if (store.scratchFbo) gl.deleteFramebuffer(store.scratchFbo);
  }
  store.tex = null;
  store.scratchTex = null;
  store.srcFbo = null;
  store.scratchFbo = null;
  store.w = 0;
  store.h = 0;
  store.attachedTex = null;
  store.attachedW = 0;
  store.attachedH = 0;
}

function ensureHistoryArray(gl, srcW, srcH) {
  const target = computeArraySize(srcW, srcH);
  if (store.tex && store.w === target.w && store.h === target.h) return false;

  disposeHistoryArray(gl);
  store.w = target.w;
  store.h = target.h;

  store.tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, store.tex);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, store.w, store.h, MAX_LAYERS);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);

  store.srcFbo = gl.createFramebuffer();

  store.scratchTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, store.scratchTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, store.w, store.h);
  gl.bindTexture(gl.TEXTURE_2D, null);

  store.scratchFbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, store.scratchFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, store.scratchTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return true;
}

function copyLiveToLayer(gl, liveTex, layer) {
  store.liveW = liveTex.w;
  store.liveH = liveTex.h;
  const reallocated = ensureHistoryArray(gl, liveTex.w, liveTex.h);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, store.srcFbo);
  if (store.attachedTex !== liveTex.tex || store.attachedW !== liveTex.w || store.attachedH !== liveTex.h) {
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, liveTex.tex, 0);
    store.attachedTex = liveTex.tex;
    store.attachedW = liveTex.w;
    store.attachedH = liveTex.h;
  }

  let readFbo = store.srcFbo;
  if (liveTex.w !== store.w || liveTex.h !== store.h) {
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, store.scratchFbo);
    gl.blitFramebuffer(0, 0, liveTex.w, liveTex.h, 0, 0, store.w, store.h, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    readFbo = store.scratchFbo;
  }

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, readFbo);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, store.tex);
  gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, 0, 0, store.w, store.h);

  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.activeTexture(gl.TEXTURE0);
  return reallocated;
}
// #endregion history-array

// #region layouts
function mat4Mul(a, b, out = new Float32Array(16)) {
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    out[col * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

function mat4MulVec4(m, x, y, z, w) {
  return [
    m[0] * x + m[4] * y + m[8]  * z + m[12] * w,
    m[1] * x + m[5] * y + m[9]  * z + m[13] * w,
    m[2] * x + m[6] * y + m[10] * z + m[14] * w,
    m[3] * x + m[7] * y + m[11] * z + m[15] * w,
  ];
}

function mat4Perspective(fovYRad, aspect, near, far) {
  const f = 1 / Math.tan(fovYRad * 0.5);
  const nf = 1 / (near - far);
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * nf, -1,
    0, 0, 2 * far * near * nf, 0,
  ]);
}

function mat4Model(tx, ty, tz, rotY, rotX, scale) {
  const cy = Math.cos(rotY), sy = Math.sin(rotY);
  const cx = Math.cos(rotX), sx = Math.sin(rotX);
  // T(tx, ty, tz) * Ry(rotY) * Rx(rotX) * S(scale)
  return new Float32Array([
    cy * scale,      0,               -sy * scale,      0,
    sy * sx * scale, cx * scale,       cy * sx * scale, 0,
    sy * cx * scale, -sx * scale,      cy * cx * scale, 0,
    tx,              ty,               tz,              1,
  ]);
}

function mat4UvToCard(cardW, cardH) {
  return new Float32Array([
    cardW, 0, 0, 0,
    0, -cardH, 0, 0,
    0, 0, 1, 0,
    -cardW * 0.5, cardH * 0.5, 0, 1,
  ]);
}

function mat4UvToReflection(cardW, cardH, gap, reflectH) {
  return new Float32Array([
    cardW, 0, 0, 0,
    0, reflectH, 0, 0,
    0, 0, 1, 0,
    -cardW * 0.5, -cardH * 0.5 - gap - reflectH, 0, 1,
  ]);
}

function computeCameraMatrix(cw, ch, cardAspect, layoutA, layoutB, blend) {
  const aspect = cw / Math.max(1, ch);
  const fov = (44 * Math.PI) / 180;
  const f = 1 / Math.tan(fov * 0.5);
  const narrow = cw < 520;
  const maxWFrac = narrow ? 0.88 : 0.78;
  const maxHFrac = narrow ? 0.57 : 0.60;
  const camZ = Math.max(f / (2 * maxHFrac), (cardAspect * f) / (2 * aspect * maxWFrac));
  const camYs = [0.16, -0.14, 0.04];
  const camY = camYs[layoutA] + (camYs[layoutB] - camYs[layoutA]) * blend;
  const proj = mat4Perspective(fov, aspect, 0.1, 30);
  const view = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, -camY, -camZ, 1,
  ]);
  return mat4Mul(proj, view);
}

function computePoseForLayout(layoutId, index, focusPos, narrow) {
  if (layoutId === 0) {
    // Time Machine: receding cosmic depth stack rising cleanly behind the front card.
    const d = focusPos - index;
    if (d >= 0) {
      return {
        tx: 0,
        ty: d * (narrow ? 0.24 : 0.29),
        tz: -d * 0.72,
        rotY: 0,
        rotX: -0.035 * Math.min(d, 4),
        scale: 1,
        alpha: clamp(1 - Math.max(0, d - 5.8) * 0.32, 0, 1),
        dim: clamp(d * 0.10, 0, 0.58),
        reflectAlpha: d < 0.8 ? 0.14 * (1 - d / 0.8) : 0,
        sortZ: -d,
      };
    }
    return {
      tx: 0,
      ty: d * 0.16,
      tz: -d * 1.12,
      rotY: 0,
      rotX: 0,
      scale: 1,
      alpha: clamp(1 + d * 1.45, 0, 1),
      dim: 0,
      reflectAlpha: 0,
      sortZ: -d,
    };
  }

  if (layoutId === 1) {
    // Cover Flow: centre card faces forward; side cards angle inward over a glossy floor.
    const offset = index - focusPos;
    const s = Math.sign(offset);
    const a = Math.abs(offset);
    const t = smoothstep(0, 1, a);
    const firstStep = narrow ? 0.56 : 0.72;
    const tailStep = narrow ? 0.20 : 0.28;
    const tx = s * (firstStep * t + Math.max(0, a - 1) * tailStep);
    const tz = -0.44 * t - Math.max(0, a - 1) * 0.06;
    const alpha = clamp(1 - Math.max(0, a - 4.8) * 0.38, 0, 1);
    return {
      tx,
      ty: 0.04,
      tz,
      rotY: -s * (narrow ? 0.94 : 1.04) * t,
      rotX: 0,
      scale: 1,
      alpha,
      dim: clamp(a * 0.12, 0, 0.50),
      reflectAlpha: 0.44 * alpha,
      sortZ: -a,
    };
  }

  // Flip 3D: angled diagonal Vista perspective cascade stepping back-left.
  const d = focusPos - index;
  const yaw = narrow ? 0.34 : 0.44;
  if (d >= 0) {
    const alpha = clamp(1 - Math.max(0, d - 5.5) * 0.34, 0, 1);
    return {
      tx: (narrow ? 0.08 : 0.20) - d * (narrow ? 0.19 : 0.28),
      ty: -0.02 + d * 0.11,
      tz: -d * 0.52,
      rotY: yaw,
      rotX: 0.035,
      scale: 1,
      alpha,
      dim: clamp(d * 0.095, 0, 0.54),
      reflectAlpha: 0.24 * alpha,
      sortZ: -d,
    };
  }
  return {
    tx: (narrow ? 0.08 : 0.20) - d * 0.55,
    ty: -0.02 + d * 0.12,
    tz: -d * 0.95,
    rotY: yaw,
    rotX: 0.035,
    scale: 1,
    alpha: clamp(1 + d * 1.4, 0, 1),
    dim: 0,
    reflectAlpha: 0,
    sortZ: -d,
  };
}

function blendPoses(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const mix = (u, v) => u + (v - u) * t;
  return {
    tx: mix(a.tx, b.tx),
    ty: mix(a.ty, b.ty),
    tz: mix(a.tz, b.tz),
    rotY: mix(a.rotY, b.rotY),
    rotX: mix(a.rotX, b.rotX),
    scale: mix(a.scale, b.scale),
    alpha: mix(a.alpha, b.alpha),
    dim: mix(a.dim, b.dim),
    reflectAlpha: mix(a.reflectAlpha, b.reflectAlpha),
    sortZ: mix(a.sortZ, b.sortZ),
  };
}
// #endregion layouts

// #region projective-hit
const unitCache = { key: '', unit: 1 };
let lastGeoVals = null;

function cachedGeometryUnit(cv, el) {
  const w = el.offsetWidth || CARD_CSS_W;
  const key = `${cv.width}x${cv.height}/${cv.clientWidth}x${cv.clientHeight}/${w}`;
  if (unitCache.key !== key) {
    unitCache.unit = geometryUnit(cv, el, w);
    unitCache.key = key;
    lastGeoVals = null;
  }
  return unitCache.unit;
}

function clipToCssMatrix(clipM, elW, elH, cw, ch) {
  const clipElem = new Float32Array(16);
  const invW = 1 / Math.max(1, elW);
  const invH = 1 / Math.max(1, elH);
  for (let i = 0; i < 4; i++) {
    clipElem[i]      = clipM[i] * invW;
    clipElem[4 + i]  = clipM[4 + i] * invH;
    clipElem[8 + i]  = clipM[8 + i];
    clipElem[12 + i] = clipM[12 + i];
  }
  const ndcToCss = new Float32Array([
    cw * 0.5, 0,         0, 0,
    0,        -ch * 0.5, 0, 0,
    0,        0,         1, 0,
    cw * 0.5, ch * 0.5,  0, 1,
  ]);
  const raw = mat4Mul(ndcToCss, clipElem);
  const wCenter = raw[3] * (elW * 0.5) + raw[7] * (elH * 0.5) + raw[15];
  if (wCenter <= 1e-4) return null;
  const norm = new Float32Array(16);
  const scaleW = 1 / wCenter;
  for (let i = 0; i < 16; i++) norm[i] = raw[i] * scaleW;
  return new DOMMatrix(Array.from(norm));
}

function syncCardGeometry(cv, el, cssMatrix, interactive) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  el.inert = !interactive || !cssMatrix;
  const unit = cachedGeometryUnit(cv, el);
  const target = interactive && cssMatrix
    ? new DOMMatrix().scale(unit, unit, 1).multiply(cssMatrix)
    : OFFSTAGE;
  if (!target) return;
  const vals = target.toFloat32Array();
  if (lastGeoVals && vals.every((v, i) => Math.abs(v - lastGeoVals[i]) < 1e-4)) return;
  lastGeoVals = vals;
  cv.updateElementGeometry(el, { canvasTransform: target });
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion projective-hit

function projectQuad2D(clipM, cw, ch) {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const pts = [];
  for (const [u, v] of corners) {
    const c = mat4MulVec4(clipM, u, v, 0, 1);
    if (c[3] <= 1e-4) return null;
    pts.push([(c[0] / c[3] + 1) * 0.5 * cw, (1 - c[1] / c[3]) * 0.5 * ch]);
  }
  return pts;
}

function pointInQuad(px, py, quad) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[i];
    const b = quad[(i + 1) % 4];
    const cross = (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
    if (Math.abs(cross) < 1e-5) continue;
    const s = cross > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (sign !== s) return false;
  }
  return sign !== 0;
}

const state = {
  route: 'plain', // 'webgl' | '2d' | 'plain'
  layout: 0,
  prevLayout: 0,
  layoutBlend: 1,
  layoutChangedAt: 0,
  history: [],
  nextRev: 1,
  targetIndex: 0,
  scrollPos: 0,
  isSeeding: false,
  captureQueue: [],
  savedDraftForRecapture: null,
  isVisible: true,
  dragging: false,
  hitQuads: [],
  fps: 0,
  fpsFrames: 0,
  fpsAt: performance.now(),
  lastTelemetryAt: 0,
};

let stage = null;
let ctx2d = null;
let rafId = 0;
let lostFallbackTimer = 0;

function estimatedVramMB() {
  if (state.route !== 'webgl' || !store.w || !store.h) return 0;
  const arrayBytes = store.w * store.h * 4 * MAX_LAYERS;
  const scratchBytes = store.w * store.h * 4;
  const liveBytes = store.liveW * store.liveH * 4;
  return (arrayBytes + scratchBytes + liveBytes) / (1024 * 1024);
}

function updateControlsUI() {
  const count = state.history.length;
  const maxIdx = Math.max(0, count - 1);
  scrubberInput.max = String(maxIdx);
  scrubberInput.value = String(clamp(state.targetIndex, 0, maxIdx));
  scrubberInput.disabled = count <= 1;

  const entry = state.history[state.targetIndex];
  const onLive = count === 0 || state.targetIndex === maxIdx;
  prevBtn.disabled = state.targetIndex <= 0;
  nextBtn.disabled = state.targetIndex >= maxIdx;
  restoreBtn.disabled = onLive || !entry;
  liveBtn.disabled = onLive;
  restoreBtn.textContent = !onLive && entry ? `Restore Rev ${entry.rev}` : 'Restore this revision';

  if (entry) {
    revStatusEl.textContent = onLive
      ? `Rev ${entry.rev} of ${count} · Live`
      : `Rev ${entry.rev} of ${count} · Preview`;
  } else {
    revStatusEl.textContent = 'Seeding stack';
  }

  if (state.route === 'plain') renderPlainHistoryButtons();
}

function updateTelemetry(force = false) {
  const now = performance.now();
  if (!force && now - state.lastTelemetryAt < 250) return;
  state.lastTelemetryAt = now;
  const openSnaps = window.__gfx?.snapshots?.open ?? 0;
  const routeLabel =
    state.route === 'webgl' ? 'WebGL 2 (ElementGL)' : state.route === '2d' ? '2D fallback' : 'Plain HTML fallback';
  if (state.route === 'webgl') {
    const vram = estimatedVramMB().toFixed(1);
    const dims = store.w ? `${store.w}x${store.h}` : 'allocating';
    const visTag = !state.isVisible || document.hidden ? ' · paused offscreen' : '';
    telemetryEl.textContent =
      `Route: ${routeLabel} · Layout: ${LAYOUT_NAMES[state.layout]} · ` +
      `Layers: ${state.history.length}/${MAX_LAYERS} (${dims}) · ` +
      `VRAM: ~${vram} MB · openSnapshots: ${openSnaps} · ${state.fps} fps${visTag}`;
  } else {
    telemetryEl.textContent =
      `Route: ${routeLabel} · Revisions: ${state.history.length}/${MAX_LAYERS} · openSnapshots: ${openSnaps}`;
  }
}

function renderPlainHistoryButtons() {
  let list = plainHostEl.querySelector('.tm-plain-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'tm-plain-list';
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Saved document revisions');
    plainHostEl.append(list);
  }
  list.replaceChildren();
  state.history.forEach((entry, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `Rev ${entry.rev}: ${entry.title.slice(0, 18)}`;
    b.setAttribute('aria-current', String(idx === state.targetIndex));
    b.addEventListener('click', () => {
      state.targetIndex = idx;
      state.scrollPos = idx;
      const isLive = idx === state.history.length - 1;
      applyCardState(cardRefs, entry, isLive ? `Rev ${entry.rev} · Live` : `Rev ${entry.rev} · Preview`, isLive ? 'live front' : 'archived');
      updateControlsUI();
    });
    list.append(b);
  });
}

function enterPlainFallback(reason) {
  state.route = 'plain';
  cardEl.inert = false;
  stageEl.classList.add('plain');
  if (cardEl.parentElement !== plainHostEl) plainHostEl.prepend(cardEl);
  if (state.history.length === 0) seedHistoryMetadataOnly();
  updateControlsUI();
  say(reason);
  updateTelemetry(true);
}

function leavePlainAfterRestore() {
  stageEl.classList.remove('plain');
  if (cardEl.parentElement !== canvas) canvas.append(cardEl);
  plainHostEl.replaceChildren();
  state.route = 'webgl';
  clearNotice();
}

function seedHistoryMetadataOnly() {
  state.history = SEED_REVISIONS.map((rev, i) => ({
    rev: i + 1,
    layer: i,
    ...cloneState(rev),
  }));
  state.nextRev = state.history.length + 1;
  state.targetIndex = state.history.length - 1;
  state.scrollPos = state.targetIndex;
  const last = state.history[state.targetIndex];
  applyCardState(cardRefs, last, `Rev ${last.rev} · Live`, 'live front');
}

function allocLayer() {
  if (state.history.length < MAX_LAYERS) return state.history.length;
  const evicted = state.history.shift();
  state.targetIndex = Math.max(0, state.targetIndex - 1);
  state.scrollPos = Math.max(0, state.scrollPos - 1);
  return evicted.layer;
}

function startInitialSeedQueue() {
  state.isSeeding = true;
  state.history = [];
  state.nextRev = 1;
  state.captureQueue = SEED_REVISIONS.map((data, idx) => ({
    kind: 'seed',
    rev: idx + 1,
    data: cloneState(data),
    label: idx === SEED_REVISIONS.length - 1 ? `Rev ${idx + 1} · Live` : `Rev ${idx + 1}`,
    suffix: idx === SEED_REVISIONS.length - 1 ? 'live front' : `seed #${idx + 1}`,
  }));
  const first = state.captureQueue[0];
  applyCardState(cardRefs, first.data, first.label, first.suffix);
  canvas.requestPaint?.();
}

function queueRecaptureAll() {
  if (state.route !== 'webgl') return;
  if (state.history.length === 0) {
    startInitialSeedQueue();
    return;
  }
  state.savedDraftForRecapture = readCardState(cardRefs);
  state.captureQueue = state.history.map((entry, idx) => ({
    kind: 'recapture',
    entry,
    data: cloneState(entry),
    label: idx === state.history.length - 1 ? `Rev ${entry.rev} · Live` : `Rev ${entry.rev}`,
    suffix: idx === state.history.length - 1 ? 'live front' : 'archived',
  }));
  const first = state.captureQueue[0];
  applyCardState(cardRefs, first.data, first.label, first.suffix);
  canvas.requestPaint?.();
}

function pushSnapshot(kind = 'save', overrideData = null, fromRev = null) {
  const data = cloneState(overrideData ?? readCardState(cardRefs));
  const rev = state.nextRev++;
  const label = fromRev ? `Rev ${rev} · from Rev ${fromRev}` : `Rev ${rev} · Live`;

  if (state.route !== 'webgl') {
    const layer = allocLayer();
    state.history.push({ rev, layer, ...data });
    state.targetIndex = state.history.length - 1;
    state.scrollPos = state.targetIndex;
    applyCardState(cardRefs, data, label, 'live front');
    updateControlsUI();
    if (state.route === '2d') canvas.requestPaint?.();
    updateTelemetry(true);
    return;
  }

  // If user interacts during initial 100 ms seed, cancel remaining seeds cleanly.
  if (state.isSeeding) {
    state.isSeeding = false;
    state.captureQueue = [];
  }
  applyCardState(cardRefs, data, label, 'live front');
  state.captureQueue.push({ kind, rev, data, label, suffix: 'live front' });
  canvas.requestPaint?.();
}

function restoreSelectedRevision() {
  const entry = state.history[state.targetIndex];
  if (!entry || state.targetIndex === state.history.length - 1) return;
  pushSnapshot('restore', entry, entry.rev);
}

function jumpToLive() {
  if (state.history.length === 0) return;
  state.targetIndex = state.history.length - 1;
  if (state.route !== 'webgl') {
    state.scrollPos = state.targetIndex;
    const last = state.history[state.targetIndex];
    applyCardState(cardRefs, last, `Rev ${last.rev} · Live`, 'live front');
    if (state.route === '2d') canvas.requestPaint?.();
  }
  updateControlsUI();
}

function renderWebGLScene(now) {
  if (state.route !== 'webgl' || !stage || stage.lost || !stage.has(cardEl) || !store.tex) return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const narrow = cw < 520;
  const elW = cardEl.offsetWidth || CARD_CSS_W;
  const elH = cardEl.offsetHeight || CARD_CSS_H;
  const cardAspect = elW / Math.max(1, elH);

  // Smooth spring scroll toward targetIndex.
  if (!state.dragging) {
    const diff = state.targetIndex - state.scrollPos;
    if (Math.abs(diff) < 0.001 || prefersReducedMotion()) state.scrollPos = state.targetIndex;
    else state.scrollPos += diff * 0.16;
  }

  // Smooth layout morph when switching between Time Machine, Cover Flow and Flip 3D.
  if (state.layoutBlend < 1) {
    state.layoutBlend = prefersReducedMotion() ? 1 : clamp((now - state.layoutChangedAt) / 320, 0, 1);
  }
  const easeBlend = smoothstep(0, 1, state.layoutBlend);

  if (!stage.begin([0.03, 0.04, 0.08, 1])) return;
  const gl = stage.gl;

  // Bind uHistory on TEXTURE1 for every draw call so sampler2D and sampler2DArray never share unit 0.
  const bindCommon = (g, u, pass, useLive, layer, alpha, dim, angle, focused) => {
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D_ARRAY, store.tex);
    g.uniform1i(u('uHistory'), 1);
    g.uniform1i(u('uPass'), pass);
    g.uniform1i(u('uLayout'), state.layout);
    g.uniform1i(u('uUseLive'), useLive ? 1 : 0);
    g.uniform1i(u('uLayer'), layer);
    g.uniform1f(u('uAlpha'), alpha);
    g.uniform1f(u('uDim'), dim);
    g.uniform1f(u('uAngle'), angle);
    g.uniform1f(u('uFocused'), focused);
    g.uniform1f(u('uScroll'), state.scrollPos);
    g.uniform2f(u('uViewport'), cw, ch);
    g.activeTexture(g.TEXTURE0);
  };

  // Pass 0: procedural 2007 backdrop.
  stage.quad(cardEl, ElementGL.rect(canvas, 0, 0, cw, ch), (g, u) => {
    bindCommon(g, u, 0, true, 0, 1, 0, 0, 0);
  });

  const vp = computeCameraMatrix(cw, ch, cardAspect, state.prevLayout, state.layout, easeBlend);
  const uvToCard = mat4UvToCard(cardAspect, 1.0);
  const uvToRefl = mat4UvToReflection(cardAspect, 1.0, 0.03, 0.72);
  const lastIdx = state.history.length - 1;

  // Compute poses and sort back-to-front for clean translucent blending and reflections.
  const drawItems = [];
  for (let i = 0; i < state.history.length; i++) {
    const pA = computePoseForLayout(state.prevLayout, i, state.scrollPos, narrow);
    const pB = computePoseForLayout(state.layout, i, state.scrollPos, narrow);
    const pose = blendPoses(pA, pB, easeBlend);
    if (pose.alpha <= 0.01) continue;
    const model = mat4Model(pose.tx, pose.ty, pose.tz, pose.rotY, pose.rotX, pose.scale);
    const mv = mat4Mul(vp, model);
    const clipCard = mat4Mul(mv, uvToCard);
    const clipRefl = pose.reflectAlpha > 0.01 ? mat4Mul(mv, uvToRefl) : null;
    drawItems.push({ index: i, entry: state.history[i], pose, clipCard, clipRefl });
  }
  drawItems.sort((a, b) => a.pose.sortZ - b.pose.sortZ);

  // Store front-to-back projected quads for clicking archived cards.
  const hitList = [];
  let frontLiveCss = null;

  for (const item of drawItems) {
    const { index, entry, pose, clipCard, clipRefl } = item;
    const isLiveHead = index === lastIdx && !state.isSeeding;
    const useLiveTex = isLiveHead && state.captureQueue.length === 0;
    const isFocused = Math.abs(index - state.scrollPos) < 0.35;

    if (clipRefl) {
      stage.quad(cardEl, clipRefl, (g, u) => {
        bindCommon(g, u, 2, useLiveTex, entry.layer, pose.reflectAlpha, pose.dim, pose.rotY, 0);
      });
    }

    stage.quad(cardEl, clipCard, (g, u) => {
      bindCommon(g, u, 1, useLiveTex, entry.layer, pose.alpha, pose.dim, pose.rotY, isFocused ? 1 : 0);
    });

    const quad = projectQuad2D(clipCard, cw, ch);
    if (quad) hitList.push({ index, quad });

    if (isLiveHead && state.targetIndex === lastIdx) {
      frontLiveCss = clipToCssMatrix(clipCard, elW, elH, cw, ch);
    }
  }

  state.hitQuads = hitList.reverse();

  const canInteractLive =
    !state.isSeeding &&
    state.captureQueue.length === 0 &&
    !state.dragging &&
    state.targetIndex === lastIdx &&
    Math.abs(state.scrollPos - lastIdx) < 0.12 &&
    frontLiveCss !== null;

  syncCardGeometry(canvas, cardEl, frontLiveCss, canInteractLive);

  state.fpsFrames++;
  if (now - state.fpsAt >= 500) {
    state.fps = Math.round((state.fpsFrames * 1000) / (now - state.fpsAt));
    state.fpsFrames = 0;
    state.fpsAt = now;
  }
  updateTelemetry();
}

function render2DFallback() {
  if (state.route !== '2d' || !ctx2d) return;
  const cw = canvas.clientWidth || 1;
  const ch = canvas.clientHeight || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.fillStyle = '#0c1020';
  ctx2d.fillRect(0, 0, cw, ch);

  const elW = cardEl.offsetWidth || CARD_CSS_W;
  const elH = cardEl.offsetHeight || CARD_CSS_H;
  const scale = Math.min(1, (cw - 28) / elW, (ch - 96) / elH);
  const drawW = elW * scale;
  const drawH = elH * scale;
  const x = Math.round((cw - drawW) * 0.5);
  const y = Math.round(ch - drawH - 26);

  // Draw receding 2D placeholder cards for earlier revisions behind the live card.
  for (let d = Math.min(5, state.targetIndex); d >= 1; d--) {
    const prev = state.history[state.targetIndex - d];
    if (!prev) continue;
    const s = Math.pow(0.92, d);
    const pw = drawW * s;
    const ph = drawH * s;
    const px = (cw - pw) * 0.5;
    const py = y - d * 24;
    ctx2d.fillStyle = prev.theme === 'midnight' ? '#1c2438' : prev.theme === 'emerald' ? '#dff3e7' : prev.theme === 'parchment' ? '#f4e6ce' : '#dce9f8';
    ctx2d.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx2d.lineWidth = 1;
    ctx2d.fillRect(px, py, pw, ph);
    ctx2d.strokeRect(px, py, pw, ph);
    ctx2d.fillStyle = prev.theme === 'midnight' ? '#edf3ff' : '#182230';
    ctx2d.font = '600 11px ui-monospace, monospace';
    ctx2d.fillText(`Rev ${prev.rev} · ${prev.title}`, px + 10, py + 16);
  }

  ctx2d.drawElementImage(cardEl, x, y, drawW, drawH);

  const cssMat = new DOMMatrix().translate(x, y).scale(scale, scale);
  syncCardGeometry(canvas, cardEl, cssMat, true);
  updateTelemetry();
}

// Start the single ElementGL context, falling back cleanly to 2D or plain HTML.
if (supported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: FRAGMENT,
      onLost: () => {
        disposeHistoryArray(null);
        say('The WebGL context was lost. Waiting for restore, or falling back to plain HTML.');
        clearTimeout(lostFallbackTimer);
        lostFallbackTimer = setTimeout(() => {
          if (stage?.lost) enterPlainFallback('WebGL context lost: showing the card and revision list as plain HTML.');
        }, 1500);
      },
      onRestored: () => {
        clearTimeout(lostFallbackTimer);
        if (state.route === 'plain') leavePlainAfterRestore();
        else clearNotice();
        queueRecaptureAll();
      },
    });
    state.route = 'webgl';
  } catch (err) {
    say(`WebGL could not start (${err.message}).`);
  }
}

if (state.route === 'plain' && supported) {
  try {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.route = '2d';
      seedHistoryMetadataOnly();
      say('WebGL texElementSubImage2D() is not available here, so this page is running on a 2D drawElementImage() fallback.');
    }
  } catch {}
}

if (state.route === 'plain') {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the editable card and history list are shown as plain HTML.');
}

canvas.addEventListener('paint', () => {
  if (state.route === 'plain') return;

  if (state.route === 'webgl' && stage && !stage.lost) {
    const gl = stage.gl;
    const liveTex = stage.upload(cardEl);
    if (!liveTex) return;

    if (!store.tex) {
      ensureHistoryArray(gl, liveTex.w, liveTex.h);
    }

    if (state.captureQueue.length > 0) {
      const job = state.captureQueue.shift();
      let layer = 0;
      if (job.kind === 'recapture') {
        layer = job.entry.layer;
        copyLiveToLayer(gl, liveTex, layer);
      } else {
        layer = allocLayer();
        copyLiveToLayer(gl, liveTex, layer);
        state.history.push({ rev: job.rev, layer, ...job.data });
        state.targetIndex = state.history.length - 1;
        if (job.kind === 'seed') {
          state.scrollPos = state.targetIndex;
        }
      }

      if (state.captureQueue.length > 0) {
        const nextJob = state.captureQueue[0];
        applyCardState(cardRefs, nextJob.data, nextJob.label, nextJob.suffix);
        requestAnimationFrame(() => canvas.requestPaint?.());
      } else {
        if (state.savedDraftForRecapture) {
          const last = state.history[state.history.length - 1];
          applyCardState(cardRefs, state.savedDraftForRecapture, last ? `Rev ${last.rev} · Live` : 'Live', 'live front');
          state.savedDraftForRecapture = null;
          requestAnimationFrame(() => canvas.requestPaint?.());
        }
        state.isSeeding = false;
      }
      updateControlsUI();
    } else if (store.liveW !== liveTex.w || store.liveH !== liveTex.h) {
      const resized = ensureHistoryArray(gl, liveTex.w, liveTex.h);
      store.liveW = liveTex.w;
      store.liveH = liveTex.h;
      if (resized && state.history.length > 0) queueRecaptureAll();
    }

    renderWebGLScene(performance.now());
    return;
  }

  if (state.route === '2d') {
    render2DFallback();
  }
});

// Animation loop pauses completely when scrolled offscreen or tab is hidden.
function tickLoop(now) {
  rafId = 0;
  if (!state.isVisible || document.hidden || state.route !== 'webgl') return;
  renderWebGLScene(now);
  rafId = requestAnimationFrame(tickLoop);
}

function syncLoop() {
  const shouldRun = state.route === 'webgl' && state.isVisible && !document.hidden;
  if (shouldRun && !rafId) {
    rafId = requestAnimationFrame(tickLoop);
  } else if (!shouldRun && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  updateTelemetry(true);
}

const visibilityObserver = new IntersectionObserver(
  ([entry]) => {
    state.isVisible = Boolean(entry?.isIntersecting);
    syncLoop();
  },
  { rootMargin: '80px' }
);
visibilityObserver.observe(stageEl);
document.addEventListener('visibilitychange', syncLoop);

const resizeObserver = new ResizeObserver(() => {
  unitCache.key = '';
  lastGeoVals = null;
  if (state.route !== 'plain') canvas.requestPaint?.();
});
resizeObserver.observe(stageEl);

// Live card editing interactions.
function onLiveCardEdit() {
  const s = readCardState(cardRefs);
  const n = countFlags(s.flags);
  cardMetaEl.textContent = `${n} ${n === 1 ? 'flag' : 'flags'} · edited`;
  if (state.route !== 'plain') canvas.requestPaint?.();
}

titleInput.addEventListener('input', onLiveCardEdit);
bodyInput.addEventListener('input', onLiveCardEdit);
flagShip.addEventListener('change', onLiveCardEdit);
flagReview.addEventListener('change', onLiveCardEdit);
flagUrgent.addEventListener('change', onLiveCardEdit);

titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    pushSnapshot('save');
  }
});

cardEl.addEventListener('submit', (e) => {
  e.preventDefault();
  pushSnapshot('save');
});

saveBtn.addEventListener('click', () => pushSnapshot('save'));
extSaveBtn.addEventListener('click', () => {
  if (state.targetIndex !== state.history.length - 1) jumpToLive();
  pushSnapshot('save');
});

for (const btn of themeBtns) {
  btn.addEventListener('click', () => {
    const nextTheme = btn.dataset.theme;
    if (!nextTheme || nextTheme === cardEl.dataset.theme) return;
    const data = readCardState(cardRefs);
    data.theme = nextTheme;
    pushSnapshot('save', data);
  });
}

// External layout switcher and timeline controls.
function setLayout(id) {
  if (id === state.layout) return;
  state.prevLayout = state.layout;
  state.layout = id;
  state.layoutBlend = prefersReducedMotion() ? 1 : 0;
  state.layoutChangedAt = performance.now();
  for (const b of layoutBtns) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.layout) === id));
  }
  updateTelemetry(true);
}

for (const btn of layoutBtns) {
  btn.addEventListener('click', () => setLayout(Number(btn.dataset.layout)));
}

function stepRevision(delta) {
  const maxIdx = Math.max(0, state.history.length - 1);
  const next = clamp(state.targetIndex + delta, 0, maxIdx);
  if (next === state.targetIndex) return;
  state.targetIndex = next;
  if (state.route !== 'webgl') {
    state.scrollPos = next;
    const entry = state.history[next];
    const isLive = next === maxIdx;
    if (entry) applyCardState(cardRefs, entry, isLive ? `Rev ${entry.rev} · Live` : `Rev ${entry.rev} · Preview`, isLive ? 'live front' : 'archived');
    if (state.route === '2d') canvas.requestPaint?.();
  }
  updateControlsUI();
}

prevBtn.addEventListener('click', () => stepRevision(-1));
nextBtn.addEventListener('click', () => stepRevision(1));
scrubberInput.addEventListener('input', () => {
  const next = Number(scrubberInput.value);
  stepRevision(next - state.targetIndex);
});
restoreBtn.addEventListener('click', restoreSelectedRevision);
liveBtn.addEventListener('click', jumpToLive);

// Wheel and drag scrubbing + click-a-card navigation on the 3D stage.
let wheelAccum = 0;
stageEl.addEventListener(
  'wheel',
  (e) => {
    if (state.route !== 'webgl' || state.history.length <= 1) return;
    if (e.target === bodyInput && bodyInput.scrollHeight > bodyInput.clientHeight + 2) return;
    e.preventDefault();
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    wheelAccum += delta;
    if (Math.abs(wheelAccum) >= 42) {
      stepRevision(wheelAccum > 0 ? -1 : 1);
      wheelAccum = 0;
    }
  },
  { passive: false }
);

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state.route !== 'webgl') return;
  if (e.target !== canvas && cardEl.contains(e.target)) return;
  drag = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startScroll: state.scrollPos,
    moved: false,
  };
  canvas.setPointerCapture?.(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (!drag.moved && Math.hypot(dx, dy) > 7) {
    drag.moved = true;
    state.dragging = true;
    canvas.classList.add('is-dragging');
  }
  if (!drag.moved) return;
  const maxIdx = Math.max(0, state.history.length - 1);
  const delta = state.layout === 0 ? -dy / 85 : -dx / 105;
  state.scrollPos = clamp(drag.startScroll + delta, 0, maxIdx);
  const nearest = Math.round(state.scrollPos);
  if (nearest !== state.targetIndex) {
    state.targetIndex = nearest;
    updateControlsUI();
  }
});

function finishDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const wasMoved = drag.moved;
  canvas.releasePointerCapture?.(drag.id);
  drag = null;
  state.dragging = false;
  canvas.classList.remove('is-dragging');

  if (!wasMoved) {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    for (const item of state.hitQuads) {
      if (pointInQuad(px, py, item.quad)) {
        if (item.index !== state.targetIndex) {
          state.targetIndex = item.index;
          updateControlsUI();
        }
        break;
      }
    }
  } else {
    state.targetIndex = clamp(Math.round(state.scrollPos), 0, Math.max(0, state.history.length - 1));
    updateControlsUI();
  }
}
canvas.addEventListener('pointerup', finishDrag);
canvas.addEventListener('pointercancel', finishDrag);

window.addEventListener('pagehide', () => {
  clearTimeout(lostFallbackTimer);
  cancelAnimationFrame(rafId);
  rafId = 0;
  visibilityObserver.disconnect();
  resizeObserver.disconnect();
  if (stage) {
    disposeHistoryArray(stage.gl);
    stage.dispose();
    stage = null;
  }
});

if (state.route === 'webgl') {
  startInitialSeedQueue();
  syncLoop();
} else if (state.route === '2d') {
  updateControlsUI();
  canvas.requestPaint?.();
}
updateTelemetry(true);

// ---------------------------------------------------------------- live checks on isolated fixtures
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function makeFixture(w, h, cardW, cardH, html) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
  const child = document.createElement('div');
  child.setAttribute('drawable', '');
  child.style.cssText = `position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;overflow:hidden;box-sizing:border-box;`;
  child.innerHTML = html;
  cv.append(child);
  testStage().append(cv);
  return { cv, child };
}

function readCentrePixel(g, cv) {
  const gl = g.gl;
  const px = new Uint8Array(4);
  gl.readPixels(Math.floor(cv.width / 2), Math.floor(cv.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const tests = [
  {
    name: 'TEXTURE_2D_ARRAY + copyTexSubImage3D() stores distinct DOM revisions with gl.getError() === 0 and openSnapshots === 0',
    expect: 'pass',
    why: 'Uploads a red DOM revision into layer 0 and a blue revision into layer 1 of a 4-layer TEXTURE_2D_ARRAY, renders both layers back and checks window.__gfx.snapshots.open.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
      const madeBefore = window.__gfx?.snapshots?.made ?? 0;
      const { cv, child } = makeFixture(160, 100, 160, 100, '<div id="fx-sw" style="width:100%;height:100%;background:#dc2626"></div>');
      let g = null;
      let arrTex = null;
      let fbo = null;
      try {
        g = new ElementGL(cv, { fragment: FRAGMENT, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const gl = g.gl;
        while (gl.getError() !== gl.NO_ERROR) {}
        const t0 = g.upload(child);

        arrTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, t0.w, t0.h, 4);

        fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0.tex, 0);
        gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 0, 0, 0, t0.w, t0.h);

        child.querySelector('#fx-sw').style.background = '#1d5fd6';
        await nextPaint(cv);
        gl.activeTexture(gl.TEXTURE0);
        const t1 = g.upload(child);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1.tex, 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, 1, 0, 0, t1.w, t1.h);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.activeTexture(gl.TEXTURE0);

        const drawLayer = (layer) => {
          g.begin([0, 0, 0, 1]);
          g.quad(child, ElementGL.rect(cv, 0, 0, 160, 100), (ctx, u) => {
            ctx.activeTexture(ctx.TEXTURE1);
            ctx.bindTexture(ctx.TEXTURE_2D_ARRAY, arrTex);
            ctx.uniform1i(u('uHistory'), 1);
            ctx.uniform1i(u('uPass'), 1);
            ctx.uniform1i(u('uLayout'), 0);
            ctx.uniform1i(u('uUseLive'), 0);
            ctx.uniform1i(u('uLayer'), layer);
            ctx.uniform1f(u('uAlpha'), 1);
            ctx.uniform1f(u('uDim'), 0);
            ctx.uniform1f(u('uAngle'), 0);
            ctx.uniform1f(u('uFocused'), 0);
            ctx.uniform1f(u('uScroll'), 0);
            ctx.uniform2f(u('uViewport'), 160, 100);
            ctx.activeTexture(ctx.TEXTURE0);
          });
          return readCentrePixel(g, cv);
        };

        const p0 = drawLayer(0);
        const p1 = drawLayer(1);
        const err = gl.getError();
        const openNow = window.__gfx?.snapshots?.open ?? 0;
        const madeNow = window.__gfx?.snapshots?.made ?? 0;
        return need(
          err === gl.NO_ERROR && openNow === 0 && madeNow === madeBefore && p0[0] > p0[2] + 60 && p1[2] > p1[0] + 60,
          `Layer 0 rgb(${p0[0]},${p0[1]},${p0[2]}), layer 1 rgb(${p1[0]},${p1[1]},${p1[2]}), gl.getError() === ${err}, openSnapshots === ${openNow}.`
        );
      } finally {
        if (g && !g.lost) {
          if (arrTex) g.gl.deleteTexture(arrTex);
          if (fbo) g.gl.deleteFramebuffer(fbo);
          g.dispose();
        }
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'Switching across Time Machine, Cover Flow and Flip 3D layouts renders cleanly with gl.getError() === 0',
    expect: 'pass',
    why: 'Renders the procedural backdrop, glossy reflections and three stacked cards through each layout pose function and checks gl.getError() and non-blank output.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
      const { cv, child } = makeFixture(220, 150, 140, 110, '<div style="width:100%;height:100%;background:#f4e6ce;border:4px solid #c84b20"></div>');
      let g = null;
      let arrTex = null;
      let fbo = null;
      try {
        g = new ElementGL(cv, { fragment: FRAGMENT, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const gl = g.gl;
        while (gl.getError() !== gl.NO_ERROR) {}
        const t = g.upload(child);

        arrTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, t.w, t.h, 3);

        fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
        for (let z = 0; z < 3; z++) {
          gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, z, 0, 0, t.w, t.h);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);

        const uvToCard = mat4UvToCard(140 / 110, 1.0);
        const uvToRefl = mat4UvToReflection(140 / 110, 1.0, 0.03, 0.72);
        const summaries = [];
        let allOk = true;

        for (let layoutId = 0; layoutId < 3; layoutId++) {
          g.begin([0, 0, 0, 1]);
          const drawWith = (mat, pass, useLive, layer, alpha, dim, angle, focused) => {
            g.quad(child, mat, (ctx, u) => {
              ctx.activeTexture(ctx.TEXTURE1);
              ctx.bindTexture(ctx.TEXTURE_2D_ARRAY, arrTex);
              ctx.uniform1i(u('uHistory'), 1);
              ctx.uniform1i(u('uPass'), pass);
              ctx.uniform1i(u('uLayout'), layoutId);
              ctx.uniform1i(u('uUseLive'), useLive ? 1 : 0);
              ctx.uniform1i(u('uLayer'), layer);
              ctx.uniform1f(u('uAlpha'), alpha);
              ctx.uniform1f(u('uDim'), dim);
              ctx.uniform1f(u('uAngle'), angle);
              ctx.uniform1f(u('uFocused'), focused);
              ctx.uniform1f(u('uScroll'), 2);
              ctx.uniform2f(u('uViewport'), 220, 150);
              ctx.activeTexture(ctx.TEXTURE0);
            });
          };
          drawWith(ElementGL.rect(cv, 0, 0, 220, 150), 0, true, 0, 1, 0, 0, 0);
          const vp = computeCameraMatrix(220, 150, 140 / 110, layoutId, layoutId, 1);
          for (let i = 0; i < 3; i++) {
            const pose = computePoseForLayout(layoutId, i, 2, false);
            const mv = mat4Mul(vp, mat4Model(pose.tx, pose.ty, pose.tz, pose.rotY, pose.rotX, pose.scale));
            if (pose.reflectAlpha > 0.01) {
              drawWith(mat4Mul(mv, uvToRefl), 2, i === 2, i, pose.reflectAlpha, pose.dim, pose.rotY, 0);
            }
            drawWith(mat4Mul(mv, uvToCard), 1, i === 2, i, pose.alpha, pose.dim, pose.rotY, i === 2 ? 1 : 0);
          }
          const px = readCentrePixel(g, cv);
          const err = gl.getError();
          const nonBlank = px[3] > 200 && (px[0] + px[1] + px[2]) > 20;
          if (err !== gl.NO_ERROR || !nonBlank) allOk = false;
          summaries.push(`${LAYOUT_NAMES[layoutId]} rgb(${px[0]},${px[1]},${px[2]}) err=${err}`);
        }
        return need(allOk, summaries.join('; '));
      } finally {
        if (g && !g.lost) {
          if (arrTex) g.gl.deleteTexture(arrTex);
          if (fbo) g.gl.deleteFramebuffer(fbo);
          g.dispose();
        }
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() hits the front card input and button via elementsFromPoint()',
    expect: 'pass',
    why: 'Projects an angled 3D front card into canvas CSS space, scales by geometryUnit(), and checks that document.elementsFromPoint() hits both the live input and Save button.',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas is not available in this browser.');
      const { cv, child } = makeFixture(
        280,
        210,
        200,
        140,
        '<div style="width:100%;height:100%;padding:14px;background:#f8fbff;display:flex;flex-direction:column;gap:12px;box-sizing:border-box">' +
          '<input id="fx-tm-in" type="text" value="Rev 7" style="width:172px;height:38px;box-sizing:border-box">' +
          '<button id="fx-tm-btn" type="button" style="width:140px;height:40px;box-sizing:border-box">Save snapshot</button>' +
        '</div>'
      );
      let g = null;
      let arrTex = null;
      try {
        const cardAspect = 200 / 140;
        const vp = computeCameraMatrix(280, 210, cardAspect, 2, 2, 1);
        const pose = computePoseForLayout(2, 2, 2, true);
        const mv = mat4Mul(vp, mat4Model(pose.tx, pose.ty, pose.tz, pose.rotY, pose.rotX, pose.scale));
        const clipCard = mat4Mul(mv, mat4UvToCard(cardAspect, 1.0));
        let cssMat = clipToCssMatrix(clipCard, 200, 140, 280, 210);

        if (glSupported) {
          g = new ElementGL(cv, { fragment: FRAGMENT });
          await nextPaint(cv);
          const gl = g.gl;
          g.upload(child);
          arrTex = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
          gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, 1, 1, 1);
          g.begin([0, 0, 0, 0]);
          g.quad(child, clipCard, (ctx, u) => {
            ctx.activeTexture(ctx.TEXTURE1);
            ctx.bindTexture(ctx.TEXTURE_2D_ARRAY, arrTex);
            ctx.uniform1i(u('uHistory'), 1);
            ctx.uniform1i(u('uPass'), 1);
            ctx.uniform1i(u('uLayout'), 2);
            ctx.uniform1i(u('uUseLive'), 1);
            ctx.uniform1i(u('uLayer'), 0);
            ctx.uniform1f(u('uAlpha'), 1);
            ctx.uniform1f(u('uDim'), 0);
            ctx.uniform1f(u('uAngle'), pose.rotY);
            ctx.uniform1f(u('uFocused'), 1);
            ctx.uniform1f(u('uScroll'), 2);
            ctx.uniform2f(u('uViewport'), 280, 210);
            ctx.activeTexture(ctx.TEXTURE0);
          });
        } else {
          const ctx = cv.getContext('2d');
          cv.width = 280;
          cv.height = 210;
          cssMat = new DOMMatrix().translate(40, 35);
          cv.addEventListener('paint', () => {
            ctx.reset();
            ctx.drawElementImage(child, 40, 35, 200, 140);
          });
          await nextPaint(cv);
        }

        const unit = geometryUnit(cv, child, 200);
        const canvasTransform = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
        cv.updateElementGeometry(child, { canvasTransform });
        child.dataset.hitTick = '1';

        const inEl = child.querySelector('#fx-tm-in');
        const btnEl = child.querySelector('#fx-tm-btn');
        let clicks = 0;
        btnEl.addEventListener('click', () => { clicks++; });

        const projectLocal = (lx, ly) => {
          const p = cssMat.transformPoint(new DOMPoint(lx, ly, 0, 1));
          return [p.x / p.w, p.y / p.w];
        };
        const cvRect = cv.getBoundingClientRect();
        const [ix, iy] = projectLocal(100, 33);
        const [bx, by] = projectLocal(84, 84);
        const inStack = document.elementsFromPoint(cvRect.left + ix, cvRect.top + iy);
        const btnStack = document.elementsFromPoint(cvRect.left + bx, cvRect.top + by);
        const hitInput = inStack.includes(inEl);
        const hitBtn = btnStack.includes(btnEl);
        if (hitBtn) btnEl.click();

        return need(
          hitInput && hitBtn && clicks === 1,
          `unit=${unit.toFixed(2)}, input in stack=${hitInput}, button in stack=${hitBtn}, clicks=${clicks}.`
        );
      } finally {
        if (g && !g.lost) {
          if (arrTex) g.gl.deleteTexture(arrTex);
          g.dispose();
        }
        window.__gfx?.retire(cv);
      }
    },
  },
  {
    name: 'Restoring an earlier revision restores the saved input text, notes, theme and checkboxes',
    expect: 'pass',
    why: 'Saves revision A from an isolated fixture form, mutates the form to revision B, restores revision A via applyCardState() and checks every field.',
    run: async () => {
      const box = document.createElement('form');
      box.dataset.theme = 'aqua';
      box.style.cssText = 'width:260px;padding:8px;background:#fff;color:#000';
      box.innerHTML =
        '<span class="r-pill"></span><span class="r-badge"></span>' +
        '<input class="r-title" type="text" value="Leopard archive">' +
        '<textarea class="r-body">Saved revision A notes.</textarea>' +
        '<button type="button" class="r-theme" data-theme="aqua" aria-pressed="false">Aqua</button>' +
        '<button type="button" class="r-theme" data-theme="midnight" aria-pressed="true">Night</button>' +
        '<input type="checkbox" class="r-ship" checked>' +
        '<input type="checkbox" class="r-review">' +
        '<input type="checkbox" class="r-urgent" checked>' +
        '<span class="r-meta"></span>';
      testStage().append(box);

      const refs = {
        card: box,
        revPill: box.querySelector('.r-pill'),
        themeBadge: box.querySelector('.r-badge'),
        title: box.querySelector('.r-title'),
        body: box.querySelector('.r-body'),
        themeBtns: [...box.querySelectorAll('.r-theme')],
        flags: {
          ship: box.querySelector('.r-ship'),
          review: box.querySelector('.r-review'),
          urgent: box.querySelector('.r-urgent'),
        },
        meta: box.querySelector('.r-meta'),
      };

      applyCardState(refs, {
        title: 'Leopard archive',
        body: 'Saved revision A notes.',
        theme: 'midnight',
        flags: { ship: true, review: false, urgent: true },
      }, 'Rev 1');
      const savedA = readCardState(refs);

      applyCardState(refs, {
        title: 'Newer draft',
        body: 'Overwritten revision B.',
        theme: 'parchment',
        flags: { ship: false, review: true, urgent: false },
      }, 'Rev 2');

      applyCardState(refs, savedA, 'Rev 3 · from Rev 1');
      const restored = readCardState(refs);
      const nightPressed = refs.themeBtns.find((b) => b.dataset.theme === 'midnight')?.getAttribute('aria-pressed');

      return need(
        restored.title === 'Leopard archive' &&
          restored.body === 'Saved revision A notes.' &&
          restored.theme === 'midnight' &&
          restored.flags.ship === true &&
          restored.flags.review === false &&
          restored.flags.urgent === true &&
          nightPressed === 'true',
        `Restored title="${restored.title}", theme=${restored.theme}, flags=${JSON.stringify(restored.flags)}, aria-pressed=${nightPressed}.`
      );
    },
  },
];

runTests(document.getElementById('tests'), tests);
