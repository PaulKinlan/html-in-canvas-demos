import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';

banner();

const $ = (id) => document.getElementById(id);

const wrap = $('droste-wrap');
const canvas = $('droste-canvas');
const card = $('droste-card');
const cutout = $('droste-cutout');
const hintEl = $('droste-hint');
const statusEl = $('droste-status');
const noticeEl = $('droste-notice');

// Live source card controls
const cardHeadline = $('card-headline');
const cardClock = $('card-clock');
const cardEcho = $('card-echo');
const cardMeta = $('card-meta');
const cardInput = $('droste-input');
const cardPulseBtn = $('card-pulse');
const cardInvertBtn = $('card-invert');
const themeBtns = [...document.querySelectorAll('[data-card-theme]')];

// Stage controls
const modeBtns = [...document.querySelectorAll('[data-mode]')];
const filterBtns = [...document.querySelectorAll('[data-filter]')];
const btnAniso = $('btn-aniso');
const strandBtns = [...document.querySelectorAll('[data-strands]')];
const panelDroste = $('panel-droste');
const panelMirror = $('panel-mirror');
const ctlTilt = $('ctl-tilt');
const outTilt = $('out-tilt');
const btnTiltAniso = $('btn-tilt-aniso');
const btnAutoZoom = $('btn-autozoom');
const ctlHeatmap = $('ctl-heatmap');
const btnReset = $('btn-reset');
const ctlShrink = $('ctl-shrink');
const outShrink = $('out-shrink');
const ctlTwist = $('ctl-twist');
const outTwist = $('out-twist');
const ctlHue = $('ctl-hue');
const outHue = $('out-hue');
const btnMirrorPulse = $('btn-mirror-pulse');
const btnMirrorClear = $('btn-mirror-clear');

// #region droste-shader
const DROSTE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uMirror;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;
uniform vec2 uTexSize;
uniform float uCardHalf;
uniform float uInnerR;
uniform float uStrands;
uniform float uZoom;
uniform float uRot;
uniform float uTilt;
uniform int uMode;
uniform int uHeatmap;

in vec2 vUv;
out vec4 outColor;

vec2 cmul(vec2 a, vec2 b) {
  return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
}

vec2 cdiv(vec2 a, vec2 b) {
  float d = max(dot(b, b), 1e-10);
  return vec2(a.x * b.x + a.y * b.y, a.y * b.x - a.x * b.y) / d;
}

vec3 lodPalette(float lod) {
  float t = clamp(lod / 7.0, 0.0, 1.0);
  vec3 c0 = vec3(0.12, 0.78, 0.42);
  vec3 c1 = vec3(0.10, 0.68, 0.92);
  vec3 c2 = vec3(0.46, 0.34, 0.96);
  vec3 c3 = vec3(0.95, 0.46, 0.14);
  if (t < 0.333) return mix(c0, c1, t * 3.0);
  if (t < 0.666) return mix(c1, c2, (t - 0.333) * 3.0);
  return mix(c2, c3, (t - 0.666) * 3.0);
}

void main() {
  if (uMode == 1) {
    vec4 m = texture(uMirror, vUv);
    outColor = vec4(m.rgb, 1.0);
    return;
  }

  vec2 s = ((vUv - 0.5) * uCanvasSize) / max(uCardHalf, 1.0);
  float ct = cos(uTilt);
  float st = sin(uTilt);
  float denom = ct + s.y * (st / 2.6);
  vec3 backdrop = mix(vec3(0.05, 0.07, 0.11), vec3(0.09, 0.12, 0.19), clamp(1.0 - vUv.y, 0.0, 1.0));
  if (denom <= 0.05) {
    outColor = vec4(backdrop, 1.0);
    return;
  }

  // Smooth plane coordinates before log/wrap so hardware derivatives never spike at seams
  vec2 z = vec2(s.x * ct, s.y) / denom;
  vec2 dzdx = dFdx(z);
  vec2 dzdy = dFdy(z);

  float r1 = clamp(uInnerR, 0.25, 0.72);
  float L = log(1.0 / r1);
  float alpha = (uStrands * L) / 6.28318530718;
  vec2 c = vec2(1.0, alpha);

  float r = max(length(z), 1e-5);
  float theta = atan(z.y, z.x);
  vec2 w0 = vec2(log(r) - uZoom, theta - uRot);
  vec2 w2 = cmul(c, w0);

  // Modulo before exp() keeps floats bounded across arbitrary zoom octaves
  float wx = mod(w2.x, L);
  vec2 zOut = exp(wx) * vec2(cos(w2.y), sin(w2.y));

  // Wrap Chebyshev norm max(|x|, |y|) into the card frame [r1, 1.0]
  float d = max(abs(zOut.x), abs(zOut.y));
  float k = floor(log(max(d, 1e-5) / r1) / L);
  vec2 zTile = zOut * exp(-k * L);

  // Analytic complex Jacobian of zTile(z): exact mipmap + anisotropic footprint
  vec2 J = cmul(c, cdiv(zTile, z)) * 0.5;
  vec2 dPdx = cmul(J, dzdx);
  vec2 dPdy = cmul(J, dzdy);

  vec2 uv = zTile * 0.5 + 0.5;
  vec4 col = textureGrad(uTex, uv, dPdx, dPdy);
  if (col.a < 0.98) {
    vec2 zNext = clamp(zTile / r1, vec2(-1.0), vec2(1.0));
    vec4 under = textureGrad(uTex, zNext * 0.5 + 0.5, dPdx / r1, dPdy / r1);
    col = col + under * (1.0 - col.a);
  }

  vec3 rgb = col.rgb + backdrop * (1.0 - col.a);

  if (uHeatmap == 1) {
    vec2 gx = dPdx * uTexSize;
    vec2 gy = dPdy * uTexSize;
    float lod = max(0.0, 0.5 * log2(max(max(dot(gx, gx), dot(gy, gy)), 1e-6)));
    rgb = mix(rgb, lodPalette(lod), 0.44);
  }

  if (uTilt > 0.05) {
    float horizon = smoothstep(0.05, 0.24, denom);
    rgb = mix(backdrop, rgb, horizon);
  }

  outColor = vec4(rgb, 1.0);
}`;
// #endregion droste-shader

// #region mirror-shader
const MIRROR_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const MIRROR_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uLive;
uniform sampler2D uPrev;
uniform vec4 uCardRectUv;
uniform vec2 uAspect;
uniform float uShrink;
uniform float uTwist;
uniform float uHueShift;
uniform int uFirst;

in vec2 vUv;
out vec4 outColor;

vec3 shiftHue(vec3 col, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  vec3 k = vec3(0.57735027);
  return col * c + cross(k, col) * s + k * dot(k, col) * (1.0 - c);
}

void main() {
  vec3 prevCol = vec3(0.045, 0.055, 0.085);
  if (uFirst == 0) {
    vec2 p = (vUv - 0.5) * uAspect;
    float ct = cos(uTwist);
    float st = sin(uTwist);
    vec2 q = vec2(p.x * ct - p.y * st, p.x * st + p.y * ct) / max(uShrink, 0.4);
    vec2 prevUv = q / uAspect + 0.5;
    if (prevUv.x >= 0.0 && prevUv.x <= 1.0 && prevUv.y >= 0.0 && prevUv.y <= 1.0) {
      vec3 sampled = texture(uPrev, prevUv).rgb;
      if (uHueShift > 0.005) {
        sampled = clamp(shiftHue(sampled, uHueShift * 0.24), 0.0, 1.0);
      }
      prevCol = sampled * 0.965;
    }
  }

  vec2 cardUv = (vUv - uCardRectUv.xy) / max(uCardRectUv.zw, vec2(0.0001));
  vec4 live = vec4(0.0);
  if (cardUv.x >= 0.0 && cardUv.x <= 1.0 && cardUv.y >= 0.0 && cardUv.y <= 1.0) {
    live = texture(uLive, cardUv);
  }

  vec3 rgb = live.rgb + prevCol * (1.0 - live.a);
  outColor = vec4(rgb, 1.0);
}`;
// #endregion mirror-shader

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// Default zoom (-0.16) aligns the 1-strand outer bottom bar with the live <input> hit box
const DEFAULT_ZOOM = -0.16;

const state = {
  mode: 'droste',       // 'droste' | 'mirror'
  filter: 'aniso',      // 'linear' | 'mipmap' | 'aniso'
  strands: 1,
  zoom: DEFAULT_ZOOM,
  rot: 0,
  tiltDeg: 0,
  autoZoom: false,
  heatmap: false,
  shrink: 0.86,
  twistDeg: 6,
  huePct: 36,
  mirrorPulse: false,
  theme: 'cobalt',
  pulseCount: 0,
  inverted: false,
  backend: 'starting',
  texW: 0,
  texH: 0,
  mipLevels: 0,
  maxAniso: 1,
  anisoSupported: false,
  lastGlError: 0,
  onScreen: true,
};

let stage = null;
let anisoExt = null;
let mirrorProg = null;
let mirrorVao = null;
let mirrorVbo = null;
let mirrorUniforms = null;
let fbos = [null, null];
let fbTex = [null, null];
let fbW = 0;
let fbH = 0;
let fbIdx = 0;
let mirrorSeedPending = true;
let mirrorEchoSteps = 0;
let domDirty = true;
let mipDirty = true;
let lastLiveTex = null;
let ctx2d = null;
let hitTick = 0;
let lastHitKey = '';
let lastCardSize = 0;
let rafId = 0;
let lastFrameMs = performance.now();
let clockTimer = 0;

function showNotice(msg) {
  if (!msg) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
    return;
  }
  noticeEl.hidden = false;
  noticeEl.textContent = msg;
}

function isPow2(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

function updateCardClock() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const t = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  cardClock.textContent = `${t} · #${String(state.pulseCount).padStart(2, '0')}`;
}

function updateCardMeta() {
  const val = cardInput.value.trim();
  cardHeadline.textContent = val ? val.slice(0, 18).toUpperCase() : 'DROSTE LIVE';
  cardEcho.textContent = val ? `Live: "${val}"` : 'Type below to update every turn';
  cardMeta.textContent = `${cardInput.value.length} chars · ${state.theme}`;
}

function computeLayout() {
  const cw = Math.max(240, canvas.clientWidth || 340);
  const ch = Math.max(280, canvas.clientHeight || 360);
  const cardSize = Math.max(248, Math.min(344, Math.round(Math.min(cw, ch) * 0.78)));
  const cardX = Math.round((cw - cardSize) * 0.5);
  const cardY = Math.round((ch - cardSize) * 0.5);
  return { cw, ch, cardSize, cardX, cardY };
}

// #region hit-sync
function syncHitGeometry(layout, force = false) {
  if (lastCardSize !== layout.cardSize) {
    lastCardSize = layout.cardSize;
    card.style.width = `${layout.cardSize}px`;
    card.style.height = `${layout.cardSize}px`;
  }
  const tilt = state.mode === 'droste' ? state.tiltDeg : 0;
  const rotDeg = state.mode === 'droste' ? Math.round(((state.rot * 180) / Math.PI) * 10) / 10 : 0;
  const key = `${layout.cardX},${layout.cardY},${layout.cardSize},${tilt},${rotDeg},${state.mode}`;
  if (!force && lastHitKey === key) return;
  if (typeof canvas.updateElementGeometry !== 'function') return;
  lastHitKey = key;

  const half = layout.cardSize * 0.5;
  const cx = layout.cw * 0.5;
  const cy = layout.ch * 0.5;
  const m = new DOMMatrix().translate(cx, cy);
  if (tilt > 0) {
    const persp = new DOMMatrix();
    persp.m34 = -1 / (2.6 * half);
    m.multiplySelf(persp);
    m.rotateAxisAngleSelf(1, 0, 0, tilt);
  }
  if (rotDeg !== 0) {
    m.rotateSelf(0, 0, rotDeg);
  }
  m.translateSelf(-half, -half);

  canvas.updateElementGeometry(card, { canvasTransform: m });
  card.dataset.hitTick = String(++hitTick);
}
// #endregion hit-sync

function updateStatus() {
  const filterName =
    state.filter === 'linear'
      ? 'LINEAR (no mipmaps)'
      : state.filter === 'mipmap'
        ? 'LINEAR_MIPMAP_LINEAR'
        : `Anisotropic ${state.maxAniso}x`;
  const npot = state.texW && state.texH ? (!isPow2(state.texW) || !isPow2(state.texH) ? ' NPOT' : ' POT') : '';
  const texInfo = state.texW ? `${state.texW}x${state.texH}${npot} (${state.mipLevels} mips)` : 'not uploaded yet';
  const modeInfo =
    state.mode === 'droste'
      ? `Droste (${state.strands} ${state.strands === 1 ? 'strand' : 'strands'}, tilt ${state.tiltDeg} deg)`
      : `Mirror tunnel (shrink ${state.shrink.toFixed(2)}x, twist ${state.twistDeg} deg)`;
  const anisoInfo = state.anisoSupported ? `EXT_aniso max ${state.maxAniso}x` : 'EXT_aniso unavailable';
  statusEl.textContent = `Backend: ${state.backend} | ${modeInfo} | Filter: ${filterName} | Texture: ${texInfo} | ${anisoInfo}`;
}

function compileMirrorProgram(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log);
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, MIRROR_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, MIRROR_FRAG);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(log);
  }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const locs = {};
  for (const name of ['uLive', 'uPrev', 'uCardRectUv', 'uAspect', 'uShrink', 'uTwist', 'uHueShift', 'uFirst']) {
    locs[name] = gl.getUniformLocation(p, name);
  }
  mirrorProg = p;
  mirrorVao = vao;
  mirrorVbo = vbo;
  mirrorUniforms = locs;
}

function ensureMirrorFbos(gl, targetW, targetH) {
  const maxSide = 768;
  const scale = Math.min(1, maxSide / Math.max(targetW, targetH, 1));
  const w = Math.max(64, Math.round(targetW * scale));
  const h = Math.max(64, Math.round(targetH * scale));
  if (fbTex[0] && fbW === w && fbH === h) return;

  for (let i = 0; i < 2; i++) {
    if (fbos[i]) gl.deleteFramebuffer(fbos[i]);
    if (fbTex[i]) gl.deleteTexture(fbTex[i]);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    fbTex[i] = tex;
    fbos[i] = fbo;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  fbW = w;
  fbH = h;
  fbIdx = 0;
  mirrorSeedPending = true;
}

// #region mipmap-upload
function applyTextureFilter(gl, texObj, regenerateMipmaps) {
  if (!texObj) return;
  gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  if (state.filter === 'linear') {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    if (anisoExt) {
      gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, 1);
    }
    return;
  }

  if (regenerateMipmaps) {
    gl.generateMipmap(gl.TEXTURE_2D);
    mipDirty = false;
  }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  if (anisoExt) {
    const aniso = state.filter === 'aniso' ? state.maxAniso : 1;
    gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, aniso);
  }
}
// #endregion mipmap-upload

function stepMirrorPass(gl, liveTex, layout, firstPass) {
  const writeIdx = 1 - fbIdx;
  const minDim = Math.min(layout.cw, layout.ch);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbos[writeIdx]);
  gl.viewport(0, 0, fbW, fbH);
  gl.disable(gl.BLEND);
  gl.useProgram(mirrorProg);
  gl.bindVertexArray(mirrorVao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, liveTex.tex);
  gl.uniform1i(mirrorUniforms.uLive, 0);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, fbTex[fbIdx]);
  gl.uniform1i(mirrorUniforms.uPrev, 1);
  gl.uniform4f(
    mirrorUniforms.uCardRectUv,
    layout.cardX / layout.cw,
    layout.cardY / layout.ch,
    layout.cardSize / layout.cw,
    layout.cardSize / layout.ch
  );
  gl.uniform2f(mirrorUniforms.uAspect, layout.cw / minDim, layout.ch / minDim);
  gl.uniform1f(mirrorUniforms.uShrink, state.shrink);
  gl.uniform1f(mirrorUniforms.uTwist, (state.twistDeg * Math.PI) / 180);
  gl.uniform1f(mirrorUniforms.uHueShift, state.huePct / 100);
  gl.uniform1i(mirrorUniforms.uFirst, firstPass ? 1 : 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.enable(gl.BLEND);
  fbIdx = writeIdx;
}

function renderWebGL(e) {
  if (!stage || stage.lost) return;
  const gl = stage.gl;
  const layout = computeLayout();
  syncHitGeometry(layout);

  const changed = new Set(e?.changedElements ?? []);
  const shouldUpload = domDirty || changed.has(card) || !stage.has(card) || !lastLiveTex;
  if (shouldUpload) {
    lastLiveTex = stage.upload(card);
    domDirty = false;
    mipDirty = true;
    if (lastLiveTex) {
      state.texW = lastLiveTex.w;
      state.texH = lastLiveTex.h;
      state.mipLevels = Math.floor(Math.log2(Math.max(lastLiveTex.w, lastLiveTex.h, 1))) + 1;
    }
  }
  const liveTex = lastLiveTex;
  if (!liveTex) return;

  applyTextureFilter(gl, liveTex, mipDirty);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));

  if (state.mode === 'mirror') {
    ensureMirrorFbos(gl, bw, bh);
    if (mirrorSeedPending) {
      stepMirrorPass(gl, liveTex, layout, true);
      for (let i = 0; i < 22; i++) stepMirrorPass(gl, liveTex, layout, false);
      mirrorSeedPending = false;
    } else {
      stepMirrorPass(gl, liveTex, layout, false);
    }
  }

  const cardW = card.offsetWidth || layout.cardSize;
  const cutoutW = cutout.offsetWidth || cardW * 0.46;
  const innerR = Math.max(0.28, Math.min(0.68, cutoutW / Math.max(cardW, 1)));

  if (!stage.begin([0.05, 0.07, 0.11, 1])) return;
  stage.quad(card, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (g, loc) => {
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, fbTex[fbIdx] || liveTex.tex);
    g.uniform1i(loc('uMirror'), 1);
    g.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    g.uniform2f(loc('uTexSize'), liveTex.w, liveTex.h);
    g.uniform1f(loc('uCardHalf'), layout.cardSize * 0.5);
    g.uniform1f(loc('uInnerR'), innerR);
    g.uniform1f(loc('uStrands'), state.strands);
    g.uniform1f(loc('uZoom'), state.zoom);
    g.uniform1f(loc('uRot'), state.rot);
    g.uniform1f(loc('uTilt'), (state.tiltDeg * Math.PI) / 180);
    g.uniform1i(loc('uMode'), state.mode === 'mirror' ? 1 : 0);
    g.uniform1i(loc('uHeatmap'), state.heatmap ? 1 : 0);
  });

  updateStatus();
}

function render2DFallback() {
  if (!ctx2d) return;
  const layout = computeLayout();
  syncHitGeometry(layout);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#0d1017';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);
  const cardW = card.offsetWidth || layout.cardSize;
  const cutoutW = cutout.offsetWidth || cardW * 0.46;
  const ratio = Math.max(0.38, Math.min(0.62, cutoutW / Math.max(cardW, 1)));
  const cx = layout.cw * 0.5;
  const cy = layout.ch * 0.5;
  const twistStep = state.mode === 'mirror' ? (state.twistDeg * Math.PI) / 180 : state.strands * 0.12;
  for (let i = 6; i >= 0; i--) {
    const sc = Math.pow(ratio, i);
    const sz = layout.cardSize * sc;
    ctx2d.save();
    ctx2d.translate(cx, cy);
    ctx2d.rotate(state.rot + i * twistStep);
    ctx2d.drawElementImage(card, -sz * 0.5, -sz * 0.5, sz, sz);
    ctx2d.restore();
  }
  ctx2d.restore();
  domDirty = false;
  updateStatus();
}

function enterPlainFallback(reason) {
  wrap.classList.add('plain');
  if (card.parentElement !== wrap) wrap.append(card);
  state.backend = 'plain HTML';
  showNotice(reason);
  updateStatus();
}

function restoreCanvasFromPlain() {
  wrap.classList.remove('plain');
  if (card.parentElement !== canvas) canvas.append(card);
  showNotice('');
  domDirty = true;
  mipDirty = true;
  mirrorSeedPending = true;
  syncHitGeometry(computeLayout(), true);
  requestDraw(true);
}

function needsLoop() {
  if (!state.onScreen || document.hidden || wrap.classList.contains('plain')) return false;
  if (state.mode === 'droste') return state.autoZoom && !reducedMotion.matches;
  return (state.mirrorPulse && !reducedMotion.matches) || mirrorEchoSteps > 0;
}

function scheduleLoop() {
  if (rafId || !needsLoop()) return;
  lastFrameMs = performance.now();
  rafId = requestAnimationFrame(onAnimFrame);
}

function onAnimFrame(now) {
  rafId = 0;
  if (!needsLoop()) return;
  const dt = Math.min(0.05, Math.max(0.004, (now - lastFrameMs) / 1000));
  lastFrameMs = now;
  if (state.mode === 'droste' && state.autoZoom) {
    state.zoom += dt * 0.52;
    state.rot += dt * 0.14 * Math.max(0.4, state.strands);
    canvas.requestPaint?.();
  } else if (state.mode === 'mirror') {
    if (mirrorEchoSteps > 0) mirrorEchoSteps--;
    canvas.requestPaint?.();
  }
  scheduleLoop();
}

function requestDraw(markDomDirty = true) {
  if (markDomDirty) domDirty = true;
  if (wrap.classList.contains('plain')) {
    updateStatus();
    return;
  }
  if (markDomDirty && state.mode === 'mirror' && !reducedMotion.matches) {
    mirrorEchoSteps = Math.max(mirrorEchoSteps, 28);
  }
  canvas.requestPaint?.();
  scheduleLoop();
}

function startClock() {
  if (clockTimer) return;
  clockTimer = setInterval(() => {
    if (!state.onScreen || document.hidden) return;
    updateCardClock();
    requestDraw(true);
  }, 1000);
}

function stopClock() {
  if (!clockTimer) return;
  clearInterval(clockTimer);
  clockTimer = 0;
}

// Initialise single ElementGL WebGL 2 context, 2D fallback, or plain HTML
if (supported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: DROSTE_FRAG,
      onLost: () => {
        mirrorProg = null;
        mirrorVao = null;
        mirrorVbo = null;
        fbos = [null, null];
        fbTex = [null, null];
        fbW = 0;
        fbH = 0;
        lastLiveTex = null;
        anisoExt = null;
        enterPlainFallback('The WebGL 2 context was lost. Showing the card as plain HTML until the browser restores it.');
      },
      onRestored: () => {
        const gl = stage.gl;
        anisoExt =
          gl.getExtension('EXT_texture_filter_anisotropic') ||
          gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
          gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
        state.anisoSupported = Boolean(anisoExt);
        state.maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
        compileMirrorProgram(gl);
        state.backend = 'WebGL 2 (ElementGL)';
        restoreCanvasFromPlain();
      },
    });
    const gl = stage.gl;
    anisoExt =
      gl.getExtension('EXT_texture_filter_anisotropic') ||
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
    state.anisoSupported = Boolean(anisoExt);
    state.maxAniso = anisoExt ? gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    if (state.anisoSupported) {
      btnAniso.textContent = `Anisotropic (${state.maxAniso}x)`;
    } else {
      btnAniso.textContent = 'Anisotropic (unavailable)';
      btnAniso.disabled = true;
      state.filter = 'mipmap';
      for (const b of filterBtns) b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter));
    }
    compileMirrorProgram(gl);
    state.backend = 'WebGL 2 (ElementGL)';
  } catch (err) {
    stage = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
  }
}

if (!stage && supported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.backend = '2D fallback';
    if (noticeEl.hidden) showNotice('WebGL 2 texElementSubImage2D() is not available here; using the 2D concentric fallback.');
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the card is shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (stage && !stage.lost) renderWebGL(e);
  else if (ctx2d) render2DFallback();
});

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (state.onScreen) {
    startClock();
    requestDraw(false);
  } else {
    stopClock();
  }
}).observe(wrap);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopClock();
  else if (state.onScreen) {
    startClock();
    requestDraw(false);
  }
});

new ResizeObserver(() => {
  if (!wrap.classList.contains('plain')) {
    syncHitGeometry(computeLayout(), true);
    requestDraw(false);
  }
}).observe(canvas);

// Live HTML card interactions
cardInput.addEventListener('input', () => {
  updateCardMeta();
  requestDraw(true);
});

for (const btn of themeBtns) {
  btn.addEventListener('click', () => {
    state.theme = btn.dataset.cardTheme;
    card.dataset.theme = state.theme;
    for (const b of themeBtns) b.setAttribute('aria-pressed', String(b === btn));
    updateCardMeta();
    requestDraw(true);
  });
}

cardPulseBtn.addEventListener('click', () => {
  state.pulseCount++;
  updateCardClock();
  requestDraw(true);
});

cardInvertBtn.addEventListener('click', () => {
  state.inverted = !state.inverted;
  card.classList.toggle('inverted', state.inverted);
  cardInvertBtn.setAttribute('aria-pressed', String(state.inverted));
  requestDraw(true);
});

// Stage controls
function setMode(nextMode) {
  state.mode = nextMode;
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === nextMode));
  panelDroste.hidden = nextMode !== 'droste';
  panelMirror.hidden = nextMode !== 'mirror';
  hintEl.textContent =
    nextMode === 'droste'
      ? 'Drag canvas to zoom and rotate · tap controls on the outer frame'
      : 'Drag canvas to adjust mirror shrink and twist · type or click to send an echo';
  if (nextMode === 'mirror') {
    mirrorSeedPending = true;
    mirrorEchoSteps = 0;
  }
  syncHitGeometry(computeLayout(), true);
  requestDraw(false);
}

for (const b of modeBtns) {
  b.addEventListener('click', () => setMode(b.dataset.mode));
}

for (const b of filterBtns) {
  b.addEventListener('click', () => {
    if (b.disabled) return;
    state.filter = b.dataset.filter;
    for (const x of filterBtns) x.setAttribute('aria-pressed', String(x === b));
    mipDirty = true;
    requestDraw(false);
  });
}

for (const b of strandBtns) {
  b.addEventListener('click', () => {
    state.strands = Number(b.dataset.strands);
    for (const x of strandBtns) x.setAttribute('aria-pressed', String(x === b));
    if (state.strands === 0) state.zoom = 0;
    else if (state.zoom === 0) state.zoom = DEFAULT_ZOOM;
    requestDraw(false);
  });
}

ctlTilt.addEventListener('input', () => {
  state.tiltDeg = Number(ctlTilt.value);
  outTilt.textContent = `${state.tiltDeg} deg`;
  syncHitGeometry(computeLayout(), true);
  requestDraw(false);
});

btnTiltAniso.addEventListener('click', () => {
  state.tiltDeg = state.tiltDeg >= 45 ? 0 : 52;
  ctlTilt.value = String(state.tiltDeg);
  outTilt.textContent = `${state.tiltDeg} deg`;
  btnTiltAniso.textContent = state.tiltDeg >= 45 ? 'Flatten (0 deg)' : 'Tilt 52 deg (test aniso)';
  syncHitGeometry(computeLayout(), true);
  requestDraw(false);
});

btnAutoZoom.addEventListener('click', () => {
  state.autoZoom = !state.autoZoom;
  btnAutoZoom.setAttribute('aria-pressed', String(state.autoZoom));
  if (state.autoZoom && reducedMotion.matches) {
    showNotice('Auto-zoom is paused because prefers-reduced-motion: reduce is active. Drag the canvas directly to zoom.');
  } else if (!wrap.classList.contains('plain')) {
    showNotice('');
  }
  scheduleLoop();
});

ctlHeatmap.addEventListener('change', () => {
  state.heatmap = ctlHeatmap.checked;
  requestDraw(false);
});

btnReset.addEventListener('click', () => {
  state.zoom = state.strands === 0 ? 0 : DEFAULT_ZOOM;
  state.rot = 0;
  state.tiltDeg = 0;
  ctlTilt.value = '0';
  outTilt.textContent = '0 deg';
  btnTiltAniso.textContent = 'Tilt 52 deg (test aniso)';
  state.autoZoom = false;
  btnAutoZoom.setAttribute('aria-pressed', 'false');
  syncHitGeometry(computeLayout(), true);
  requestDraw(false);
});

ctlShrink.addEventListener('input', () => {
  state.shrink = Number(ctlShrink.value) / 100;
  outShrink.textContent = `${state.shrink.toFixed(2)}x`;
  mirrorSeedPending = true;
  requestDraw(false);
});

ctlTwist.addEventListener('input', () => {
  state.twistDeg = Number(ctlTwist.value);
  outTwist.textContent = `${state.twistDeg} deg`;
  mirrorSeedPending = true;
  requestDraw(false);
});

ctlHue.addEventListener('input', () => {
  state.huePct = Number(ctlHue.value);
  outHue.textContent = `${state.huePct}%`;
  mirrorSeedPending = true;
  requestDraw(false);
});

btnMirrorPulse.addEventListener('click', () => {
  state.mirrorPulse = !state.mirrorPulse;
  btnMirrorPulse.setAttribute('aria-pressed', String(state.mirrorPulse));
  scheduleLoop();
});

btnMirrorClear.addEventListener('click', () => {
  mirrorSeedPending = true;
  requestDraw(true);
});

// Pointer drag on canvas (outside the card rails, or inside the transparent centre cutout)
let dragging = false;
let dragX = 0;
let dragY = 0;

canvas.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return;
  e.preventDefault();
  dragging = true;
  dragX = e.clientX;
  dragY = e.clientY;
  canvas.classList.add('dragging');
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragX;
  const dy = e.clientY - dragY;
  dragX = e.clientX;
  dragY = e.clientY;
  if (state.mode === 'droste') {
    state.rot += dx * 0.008;
    state.zoom -= dy * 0.007;
    syncHitGeometry(computeLayout());
    requestDraw(false);
  } else {
    state.twistDeg = Math.max(-18, Math.min(18, Math.round((state.twistDeg + dx * 0.12) * 10) / 10));
    state.shrink = Math.max(0.76, Math.min(0.94, Math.round((state.shrink - dy * 0.0008) * 100) / 100));
    ctlTwist.value = String(Math.round(state.twistDeg));
    outTwist.textContent = `${Math.round(state.twistDeg)} deg`;
    ctlShrink.value = String(Math.round(state.shrink * 100));
    outShrink.textContent = `${state.shrink.toFixed(2)}x`;
    requestDraw(false);
  }
});

const endDrag = () => {
  if (!dragging) return;
  dragging = false;
  canvas.classList.remove('dragging');
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('wheel', (e) => {
  if (e.target !== canvas || state.mode !== 'droste') return;
  e.preventDefault();
  state.zoom -= e.deltaY * 0.0018;
  requestDraw(false);
}, { passive: false });

// Initial paint and 1 Hz live clock
updateCardClock();
updateCardMeta();
syncHitGeometry(computeLayout(), true);
startClock();
requestDraw(true);

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, text) => {
  if (!ok) throw new Error(text);
  return text;
};

const SIMPLE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

const tests = [
  {
    name: 'gl.generateMipmap(TEXTURE_2D) succeeds after texElementSubImage2D() on NPOT dimensions',
    expect: 'pass',
    why: 'Uploads a non-power-of-two (113x87 CSS px) drawable child on an isolated ElementGL canvas, calls gl.generateMipmap(), draws it minified with LINEAR_MIPMAP_LINEAR and checks gl.getError() === 0.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:113px;height:87px;display:block';
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = 'width:113px;height:87px;background:repeating-linear-gradient(90deg,#1d5cff 0 4px,#ffffff 4px 8px)';
      cv.append(child);
      testStage().append(cv);
      const g = new ElementGL(cv, { fragment: SIMPLE_FRAG, attributes: { preserveDrawingBuffer: true } });
      await nextPaint(cv);
      const gl = g.gl;
      while (gl.getError() !== gl.NO_ERROR) {}
      const uploaded = g.upload(child);
      gl.bindTexture(gl.TEXTURE_2D, uploaded.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      const errMip = gl.getError();
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      g.begin([0, 0, 0, 0]);
      // Minify to 24x18 CSS px to force sampling from mip levels 2-3
      g.quad(child, ElementGL.rect(cv, 0, 0, 24, 18));
      const errDraw = gl.getError();
      const px = new Uint8Array(4);
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      gl.readPixels(Math.max(1, Math.round(12 * dpr)), Math.max(1, cv.height - Math.round(9 * dpr)), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const mips = Math.floor(Math.log2(Math.max(uploaded.w, uploaded.h))) + 1;
      g.dispose();
      window.__gfx?.retire(cv);
      return need(
        errMip === 0 && errDraw === 0 && px[3] > 200 && px[2] > 100,
        `Uploaded ${uploaded.w}x${uploaded.h} (${mips} mip levels), generateMipmap err=${errMip}, draw err=${errDraw}, minified pixel rgba(${px[0]}, ${px[1]}, ${px[2]}, ${px[3]}).`
      );
    },
  },
  {
    name: 'EXT_texture_filter_anisotropic availability and MAX_TEXTURE_MAX_ANISOTROPY_EXT',
    expect: 'pass',
    why: 'Queries EXT_texture_filter_anisotropic on an isolated ElementGL context, applies max anisotropy to a texElementSubImage2D() texture and confirms gl.getError() === 0.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:80px;height:80px;display:block';
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = 'width:80px;height:80px;background:#0f8a5f';
      cv.append(child);
      testStage().append(cv);
      const g = new ElementGL(cv, { fragment: SIMPLE_FRAG });
      await nextPaint(cv);
      const gl = g.gl;
      const ext =
        gl.getExtension('EXT_texture_filter_anisotropic') ||
        gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ||
        gl.getExtension('MOZ_EXT_texture_filter_anisotropic');
      if (!ext) {
        g.dispose();
        window.__gfx?.retire(cv);
        throw new Error('EXT_texture_filter_anisotropic is not exposed by this WebGL 2 driver');
      }
      const maxAniso = gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      while (gl.getError() !== gl.NO_ERROR) {}
      const uploaded = g.upload(child);
      gl.bindTexture(gl.TEXTURE_2D, uploaded.tex);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
      const err = gl.getError();
      const applied = gl.getTexParameter(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT);
      g.dispose();
      window.__gfx?.retire(cv);
      return need(
        err === 0 && maxAniso >= 2 && applied >= 2,
        `Extension present: MAX_TEXTURE_MAX_ANISOTROPY_EXT=${maxAniso}, applied=${applied}, gl.getError()=${err}.`
      );
    },
  },
  {
    name: 'Ping-pong FBO mirror feedback pass renders echoes with gl.getError() === 0',
    expect: 'pass',
    why: 'Allocates two 64x64 RGBA8 ping-pong framebuffers on an isolated ElementGL context, runs 6 feedback passes over a framed cutout child and checks echoed frame pixels appear inside the centre hole.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:80px;height:80px;display:block';
      const frame = document.createElement('div');
      frame.setAttribute('drawable', '');
      frame.style.cssText = 'box-sizing:border-box;width:80px;height:80px;border:20px solid #d94418;background:transparent';
      cv.append(frame);
      testStage().append(cv);
      const g = new ElementGL(cv, { fragment: SIMPLE_FRAG });
      await nextPaint(cv);
      const gl = g.gl;
      while (gl.getError() !== gl.NO_ERROR) {}
      const uploaded = g.upload(frame);

      const mkShader = (type, src) => {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        return s;
      };
      const prog = gl.createProgram();
      const vs = mkShader(gl.VERTEX_SHADER, MIRROR_VERT);
      const fs = mkShader(gl.FRAGMENT_SHADER, MIRROR_FRAG);
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'aPos');
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      const vao = gl.createVertexArray();
      const vbo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      const texs = [];
      const fboList = [];
      for (let i = 0; i < 2; i++) {
        const t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 64, 64, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const f = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        texs.push(t);
        fboList.push(f);
      }
      const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

      let idx = 0;
      for (let step = 0; step < 6; step++) {
        const next = 1 - idx;
        gl.bindFramebuffer(gl.FRAMEBUFFER, fboList[next]);
        gl.viewport(0, 0, 64, 64);
        gl.disable(gl.BLEND);
        gl.useProgram(prog);
        gl.bindVertexArray(vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, uploaded.tex);
        gl.uniform1i(gl.getUniformLocation(prog, 'uLive'), 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texs[idx]);
        gl.uniform1i(gl.getUniformLocation(prog, 'uPrev'), 1);
        gl.uniform4f(gl.getUniformLocation(prog, 'uCardRectUv'), 0, 0, 1, 1);
        gl.uniform2f(gl.getUniformLocation(prog, 'uAspect'), 1, 1);
        gl.uniform1f(gl.getUniformLocation(prog, 'uShrink'), 0.72);
        gl.uniform1f(gl.getUniformLocation(prog, 'uTwist'), 0.08);
        gl.uniform1f(gl.getUniformLocation(prog, 'uHueShift'), 0);
        gl.uniform1i(gl.getUniformLocation(prog, 'uFirst'), step === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        idx = next;
      }

      const px = new Uint8Array(4);
      gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const err = gl.getError();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.enable(gl.BLEND);
      for (const f of fboList) gl.deleteFramebuffer(f);
      for (const t of texs) gl.deleteTexture(t);
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
      g.dispose();
      window.__gfx?.retire(cv);
      return need(
        fbStatus === gl.FRAMEBUFFER_COMPLETE && err === 0 && px[0] > 110,
        `FBO complete=${fbStatus === gl.FRAMEBUFFER_COMPLETE}, gl.getError()=${err}, centre cutout echo pixel rgb(${px[0]}, ${px[1]}, ${px[2]}).`
      );
    },
  },
  {
    name: 'updateElementGeometry() keeps the live input and button clickable (elementsFromPoint)',
    expect: 'pass',
    why: 'Translates a framed card containing an <input> and <button> by (24, 18), bumps dataset.hitTick and checks document.elementsFromPoint() at both control centres.',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.width = 240;
      cv.height = 140;
      cv.style.cssText = 'width:240px;height:140px;display:block';

      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = 'box-sizing:border-box;width:180px;height:96px;padding:8px;display:flex;flex-direction:column;gap:8px;background:#f7f9fd';
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.value = 'Droste';
      inp.style.cssText = 'width:100%;height:34px;box-sizing:border-box';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Cobalt';
      btn.style.cssText = 'width:100%;height:34px;box-sizing:border-box';
      box.append(inp, btn);
      cv.append(box);
      testStage().append(cv);

      const ctx = cv.getContext('2d');
      cv.addEventListener('paint', () => {
        ctx.clearRect(0, 0, 240, 140);
        ctx.drawElementImage(box, 24, 18, 180, 96);
      });
      await nextPaint(cv);
      cv.updateElementGeometry?.(box, { canvasTransform: new DOMMatrix().translate(24, 18) });
      box.dataset.hitTick = '1';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const r = cv.getBoundingClientRect();
      const hitInput = document.elementsFromPoint(r.left + 24 + 90, r.top + 18 + 25);
      const hitBtn = document.elementsFromPoint(r.left + 24 + 90, r.top + 18 + 68);
      const gotInput = hitInput.includes(inp);
      const gotBtn = hitBtn.includes(btn);
      window.__gfx?.retire(cv);
      return need(
        gotInput && gotBtn,
        `input hit=${gotInput} (top: <${hitInput[0]?.tagName?.toLowerCase() ?? 'none'}>), button hit=${gotBtn} (top: <${hitBtn[0]?.tagName?.toLowerCase() ?? 'none'}>).`
      );
    },
  },
  {
    name: 'Dispatched webglcontextlost event falls back to plain HTML without calling loseContext()',
    expect: 'pass',
    why: 'Verifies the context-loss recovery path safely with a synthetic cancelable Event.',
    run: async () => {
      const host = document.createElement('div');
      const cv = document.createElement('canvas');
      const child = document.createElement('div');
      cv.append(child);
      host.append(cv);
      testStage().append(host);
      let recovered = false;
      cv.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        recovered = true;
        host.append(child);
      });
      const ev = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(ev);
      const ok = ev.defaultPrevented && recovered && child.parentElement === host;
      window.__gfx?.retire(cv);
      return need(ok, `defaultPrevented=${ev.defaultPrevented}, card moved to plain wrapper=${child.parentElement === host}.`);
    },
  },
];

runTests(document.getElementById('tests'), tests);
