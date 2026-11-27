import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// #region blur-pyramid
const BLUR_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;

void main() {
  // Normalized 9-tap separable Gaussian kernel (weights sum to 1.000000).
  vec4 acc = texture(uSrc, clamp(vUv, vec2(0.0), vec2(1.0))) * 0.194508;
  acc += (texture(uSrc, clamp(vUv + uStep * 1.0, vec2(0.0), vec2(1.0))) +
          texture(uSrc, clamp(vUv - uStep * 1.0, vec2(0.0), vec2(1.0)))) * 0.174330;
  acc += (texture(uSrc, clamp(vUv + uStep * 2.0, vec2(0.0), vec2(1.0))) +
          texture(uSrc, clamp(vUv - uStep * 2.0, vec2(0.0), vec2(1.0)))) * 0.125216;
  acc += (texture(uSrc, clamp(vUv + uStep * 3.0, vec2(0.0), vec2(1.0))) +
          texture(uSrc, clamp(vUv - uStep * 3.0, vec2(0.0), vec2(1.0)))) * 0.072096;
  acc += (texture(uSrc, clamp(vUv + uStep * 4.0, vec2(0.0), vec2(1.0))) +
          texture(uSrc, clamp(vUv - uStep * 4.0, vec2(0.0), vec2(1.0)))) * 0.031104;
  outColor = acc;
}`;

const QUAD_VERTS = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

function compileProgram(gl, vsSrc, fsSrc) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || 'blur shader compile failed');
    }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(log || 'blur program link failed');
  }
  return prog;
}

function makeTarget(gl) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo, w: 0, h: 0 };
}

function resizeTarget(gl, target, w, h) {
  if (target.w === w && target.h === h) return;
  gl.bindTexture(gl.TEXTURE_2D, target.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  target.w = w;
  target.h = h;
}

/**
 * Three-level CSS-pixel-normalized separable Gaussian pyramid (6 offscreen FBO passes).
 * Level 1 halves backing resolution (exact 2:1 prefilter), then levels 2 and 3 step in
 * CSS-pixel proportions so the blur radius stays consistent across 1x and 2.625x DPR.
 */
export function createBlurPyramid(gl) {
  const prog = compileProgram(gl, BLUR_VERT, BLUR_FRAG);
  const uSrc = gl.getUniformLocation(prog, 'uSrc');
  const uStep = gl.getUniformLocation(prog, 'uStep');

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const levels = [
    { a: makeTarget(gl), b: makeTarget(gl), stride: 1.05 },
    { a: makeTarget(gl), b: makeTarget(gl), stride: 1.28 },
    { a: makeTarget(gl), b: makeTarget(gl), stride: 1.48 },
  ];
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function ensureSize(cw, ch, bw, bh) {
    const dims = [
      [Math.max(1, Math.round(bw * 0.5)), Math.max(1, Math.round(bh * 0.5))],
      [Math.max(1, Math.round(cw * 0.42)), Math.max(1, Math.round(ch * 0.42))],
      [Math.max(1, Math.round(cw * 0.18)), Math.max(1, Math.round(ch * 0.18))],
    ];
    for (let i = 0; i < levels.length; i++) {
      resizeTarget(gl, levels[i].a, dims[i][0], dims[i][1]);
      resizeTarget(gl, levels[i].b, dims[i][0], dims[i][1]);
    }
  }

  function run(srcTex, cw, ch, bw, bh) {
    if (!srcTex || gl.isContextLost()) return null;
    ensureSize(cw, ch, bw, bh);

    gl.disable(gl.BLEND);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(uSrc, 0);

    let inputTex = srcTex;
    for (const lvl of levels) {
      const { a, b, stride } = lvl;
      gl.viewport(0, 0, a.w, a.h);

      // Horizontal pass into A
      gl.bindFramebuffer(gl.FRAMEBUFFER, a.fbo);
      gl.bindTexture(gl.TEXTURE_2D, inputTex);
      gl.uniform2f(uStep, stride / a.w, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Vertical pass from A into B
      gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
      gl.bindTexture(gl.TEXTURE_2D, a.tex);
      gl.uniform2f(uStep, 0, stride / b.h);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      inputTex = b.tex;
    }

    // Unbind every offscreen FBO and VAO before rendering to screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    return {
      tex1: levels[0].b.tex,
      tex2: levels[1].b.tex,
      tex3: levels[2].b.tex,
    };
  }

  function dispose() {
    if (!gl.isContextLost()) {
      for (const lvl of levels) {
        gl.deleteTexture(lvl.a.tex);
        gl.deleteFramebuffer(lvl.a.fbo);
        gl.deleteTexture(lvl.b.tex);
        gl.deleteFramebuffer(lvl.b.fbo);
      }
      gl.deleteBuffer(vbo);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(prog);
    }
  }

  return { run, dispose };
}
// #endregion blur-pyramid

// #region composite-shader
const COMPOSITE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uBlur1;
uniform sampler2D uBlur2;
uniform sampler2D uBlur3;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform int uMode;
uniform vec2 uCanvasSize;
uniform float uMaxBlurPx;
uniform float uRampPx;
uniform vec4 uTopRect;
uniform vec4 uBotRect;
uniform float uTopRadius;
uniform float uBotRadius;
uniform float uScrimAlpha;
uniform vec3 uScrimRgb;

in vec2 vUv;
out vec4 outColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec4 sampleMicro(vec2 uv, float px) {
  vec2 d = px / max(uCanvasSize, vec2(1.0));
  vec4 c = texture(uTex, clamp(uv, vec2(0.0), vec2(1.0))) * 0.4;
  c += texture(uTex, clamp(uv + vec2( d.x,  d.y * 0.4), vec2(0.0), vec2(1.0))) * 0.15;
  c += texture(uTex, clamp(uv + vec2(-d.x, -d.y * 0.4), vec2(0.0), vec2(1.0))) * 0.15;
  c += texture(uTex, clamp(uv + vec2(-d.x * 0.4,  d.y), vec2(0.0), vec2(1.0))) * 0.15;
  c += texture(uTex, clamp(uv + vec2( d.x * 0.4, -d.y), vec2(0.0), vec2(1.0))) * 0.15;
  return c;
}

vec4 samplePyramid(vec2 uv, float radiusPx) {
  if (radiusPx <= 0.05) return texture(uTex, uv);
  float normR = clamp(radiusPx / 32.0, 0.0, 1.0);
  float s = pow(normR, 0.72) * 3.0;
  if (s < 1.0) {
    vec4 c0 = sampleMicro(uv, mix(0.0, 1.8, s));
    vec4 c1 = texture(uBlur1, uv);
    return mix(c0, c1, smoothstep(0.0, 1.0, s));
  } else if (s < 2.0) {
    return mix(texture(uBlur1, uv), texture(uBlur2, uv), s - 1.0);
  }
  return mix(texture(uBlur2, uv), texture(uBlur3, uv), s - 2.0);
}

void main() {
  if (uPass == 1) {
    outColor = texture(uTex, vUv);
    return;
  }

  vec2 pCss = vUv * uCanvasSize;
  float ramp = max(uRampPx, 1.0);
  float topRamp = clamp(1.0 - pCss.y / ramp, 0.0, 1.0);
  float botRamp = clamp(1.0 - (uCanvasSize.y - pCss.y) / ramp, 0.0, 1.0);

  float dTop = sdRoundedBox(pCss - (uTopRect.xy + uTopRect.zw * 0.5), uTopRect.zw * 0.5, uTopRadius);
  float dBot = sdRoundedBox(pCss - (uBotRect.xy + uBotRect.zw * 0.5), uBotRect.zw * 0.5, uBotRadius);
  float inTop = 1.0 - smoothstep(-0.8, 0.8, dTop);
  float inBot = 1.0 - smoothstep(-0.8, 0.8, dBot);
  float inChrome = max(inTop, inBot);

  float factor = 0.0;
  float seam = 0.0;
  if (uMode == 0) {
    // Progressive: smooth optical ramp from edge maxBlurPx down to 0 px in the middle.
    factor = max(smoothstep(0.0, 1.0, topRamp), smoothstep(0.0, 1.0, botRamp));
  } else if (uMode == 1) {
    // Stepped CSS bands: quantized 4-band mask simulation with visible step seams.
    float raw = max(topRamp, botRamp);
    float bands = 4.0;
    factor = floor(raw * bands + 0.001) / bands;
    float edge = abs(fract(raw * bands) - 0.5);
    if (raw > 0.02 && raw < 0.98 && edge > 0.46) seam = 1.0;
  } else {
    // Uniform: constant blur clipped strictly to the floating header and bottom capsule.
    factor = inChrome;
  }

  float radiusPx = uMaxBlurPx * factor;
  vec4 col = samplePyramid(vUv, radiusPx);

  // Subtle translucent glass tint inside the ramp and floating chrome capsules.
  float washFactor = uMode == 2 ? inChrome : max(factor * 0.72, inChrome * 0.92);
  if (uScrimAlpha > 0.001 && washFactor > 0.001) {
    col.rgb = mix(col.rgb, uScrimRgb * col.a, uScrimAlpha * washFactor);
  }
  if (seam > 0.5 && uMaxBlurPx > 0.5) {
    col.rgb = mix(col.rgb, vec3(0.82, 0.29, 0.12) * col.a, 0.16);
  }

  // Soft 1 px optical specular rim inside the floating capsules.
  float rimTop = smoothstep(2.0, 0.0, abs(dTop)) * step(0.1, uTopRect.z);
  float rimBot = smoothstep(2.0, 0.0, abs(dBot)) * step(0.1, uBotRect.z);
  float rim = max(rimTop, rimBot);
  if (rim > 0.01 && uScrimAlpha > 0.001) {
    col.rgb = mix(col.rgb, vec3(1.0) * col.a, rim * 0.22);
  }

  outColor = col;
}`;
// #endregion composite-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('pb-stage');
const phoneViewport = document.getElementById('phone-viewport');
const canvas = document.getElementById('pb-canvas');
const feedEl = document.getElementById('pb-feed');
const chromeEl = document.getElementById('pb-chrome');
const topbarEl = document.getElementById('pb-topbar');
const dockEl = document.getElementById('pb-dock');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('stage-notice');
const hudEl = document.getElementById('stage-hud');
const testsBody = document.getElementById('tests');

const searchInput = document.getElementById('pb-search');
const searchClearBtn = document.getElementById('pb-search-clear');
const feedEmptyEl = document.getElementById('pb-empty');
const chromeReadoutEl = document.getElementById('pb-chrome-readout');
const dockStatusEl = document.getElementById('pb-dock-status');
const btnJumpTop = document.getElementById('btn-jump-top');
const btnChromeLiked = document.getElementById('btn-chrome-liked');
const btnDockOptics = document.getElementById('btn-dock-optics');
const btnDockColour = document.getElementById('btn-dock-colour');
const btnDockScroll = document.getElementById('btn-dock-scroll');

const modeBtns = Array.from(document.querySelectorAll('button[data-mode]'));
const chipBtns = Array.from(document.querySelectorAll('.pb-chip[data-filter]'));
const cardEls = Array.from(document.querySelectorAll('.pb-card'));
const ctlBlur = document.getElementById('ctl-blur');
const outBlur = document.getElementById('out-blur');
const ctlRamp = document.getElementById('ctl-ramp');
const outRamp = document.getElementById('out-ramp');
const ctlReduced = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
const darkQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-color-scheme: dark)')
  : { matches: false };

ctlReduced.checked = reducedQuery.matches;
const isReduced = () => ctlReduced.checked || reducedQuery.matches;

// ---------------------------------------------------------------- State
const state = {
  backend: 'none', // 'webgl' | '2d' | 'plain'
  mode: 'progressive', // 'progressive' | 'stepped' | 'uniform'
  maxBlurPx: Number(ctlBlur.value) || 28,
  rampPx: Number(ctlRamp.value) || 108,
  filter: 'all',
  query: '',
  hasPainted: false,
  feedDirty: true,
  chromeDirty: true,
  blurDirty: true,
  isVisible: true,
  uploads: 0,
  paints: 0,
  scrollTarget: null,
  rafId: 0,
  lastTickMs: 0,
};

let stage = null;
let pyramid = null;
let blurTextures = null;
let ctx2d = null;
let plainCopy = null;
let plainCopyCtx = null;
let lostTimer = 0;
let lastGeoSig = '';
let suppressClickUntil = 0;

function showNotice(text) {
  if (!text) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  } else {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  }
}

function modeInt(mode) {
  return mode === 'stepped' ? 1 : mode === 'uniform' ? 2 : 0;
}

function updateHud() {
  const routeName =
    state.backend === 'webgl' ? 'WebGL 2 (ElementGL + 6-pass FBO)'
      : state.backend === '2d' ? '2D drawElementImage() fallback'
        : 'Plain HTML fallback';
  const modeLabel =
    state.mode === 'progressive' ? 'Progressive'
      : state.mode === 'stepped' ? 'Stepped CSS bands'
        : 'Uniform';
  const mp = state.backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const maxScroll = Math.max(0, Math.round(feedEl.scrollHeight - feedEl.clientHeight));
  hudEl.textContent =
    `Route: ${routeName} · Mode: ${modeLabel} · blur: ${state.maxBlurPx} px · ramp: ${state.rampPx} px · ` +
    `scroll: ${Math.round(feedEl.scrollTop)}/${maxScroll} px · ${mp} MP · ${state.uploads} uploads`;
}

// ---------------------------------------------------------------- Live DOM Feed & Chrome Sync
function applyFeedFilter() {
  const q = state.query.trim().toLowerCase();
  let visibleCount = 0;
  let totalLikes = 0;
  let likedCards = 0;

  for (const card of cardEls) {
    const topic = card.dataset.topic || '';
    const likeBtn = card.querySelector('.btn-like');
    const likes = Number(likeBtn?.dataset.likes || 0);
    totalLikes += likes;
    if (likes > 0) likedCards++;

    const hay = card.textContent.toLowerCase();
    const matchTopic =
      state.filter === 'all' ||
      (state.filter === 'liked' ? likes > 0 : topic === state.filter);
    const matchQuery = !q || hay.includes(q);
    const show = matchTopic && matchQuery;
    card.hidden = !show;
    if (show) visibleCount++;
  }

  feedEmptyEl.hidden = visibleCount > 0;
  searchClearBtn.hidden = !q;

  const likedChip = chipBtns.find((b) => b.dataset.filter === 'liked');
  if (likedChip) likedChip.textContent = `Liked (${likedCards})`;

  for (const btn of chipBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.filter === state.filter));
  }
  btnChromeLiked.setAttribute('aria-pressed', String(state.filter === 'liked'));
  btnDockOptics.setAttribute('aria-pressed', String(state.filter === 'optics'));
  btnDockColour.setAttribute('aria-pressed', String(state.filter === 'colour'));

  const tag = q ? `"${q.slice(0, 10)}"` : state.filter === 'all' ? 'All' : state.filter[0].toUpperCase() + state.filter.slice(1);
  chromeReadoutEl.textContent = `${tag} · ${visibleCount}`;
  dockStatusEl.textContent = `${totalLikes} likes`;

  state.feedDirty = true;
  state.chromeDirty = true;
  state.blurDirty = true;
  requestRedraw();
}

function setFilter(nextFilter) {
  state.filter = state.filter === nextFilter && nextFilter !== 'all' ? 'all' : nextFilter;
  applyFeedFilter();
}

for (const chip of chipBtns) {
  chip.addEventListener('click', () => {
    if (performance.now() < suppressClickUntil) return;
    setFilter(chip.dataset.filter);
  });
}

searchInput.addEventListener('input', () => {
  state.query = searchInput.value;
  applyFeedFilter();
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  state.query = '';
  applyFeedFilter();
  searchInput.focus({ preventScroll: true });
});

feedEl.addEventListener('click', (e) => {
  if (performance.now() < suppressClickUntil) return;
  const likeBtn = e.target.closest('.btn-like');
  if (likeBtn) {
    const next = (Number(likeBtn.dataset.likes) || 0) + 1;
    likeBtn.dataset.likes = String(next);
    likeBtn.textContent = `+1 Like (${next})`;
    applyFeedFilter();
    return;
  }
  const toggleBtn = e.target.closest('.btn-pin');
  if (toggleBtn) {
    const card = toggleBtn.closest('.pb-card');
    const next = toggleBtn.getAttribute('aria-pressed') !== 'true';
    toggleBtn.setAttribute('aria-pressed', String(next));
    toggleBtn.textContent = next ? 'Pinned' : 'Pin';
    card?.classList.toggle('is-pinned', next);
    state.feedDirty = true;
    state.blurDirty = true;
    requestRedraw();
  }
});

// Chrome header & dock actions
function scrollFeedTo(targetY) {
  const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
  const clamped = clamp(targetY, 0, maxScroll);
  if (isReduced() || state.backend === 'plain') {
    state.scrollTarget = null;
    stopAnimLoop();
    feedEl.scrollTop = clamped;
    return;
  }
  state.scrollTarget = clamped;
  startAnimLoop();
}

btnJumpTop.addEventListener('click', () => scrollFeedTo(0));
btnChromeLiked.addEventListener('click', () => setFilter('liked'));
btnDockOptics.addEventListener('click', () => setFilter('optics'));
btnDockColour.addEventListener('click', () => setFilter('colour'));
btnDockScroll.addEventListener('click', () => {
  const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
  const target = feedEl.scrollTop > maxScroll * 0.45 ? 0 : Math.round(maxScroll * 0.56);
  scrollFeedTo(target);
});

// ---------------------------------------------------------------- Geometry Sync & Render
// #region paint-loop
function syncGeometry(force = false) {
  if (state.backend === 'plain' || !state.hasPainted) return;
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const fw = feedEl.offsetWidth;
  if (!cw || !ch || !fw) return;

  const unit = geometryUnit(canvas, feedEl, fw);
  const sig = `${cw}x${ch}:${unit.toFixed(4)}:${Math.round(feedEl.scrollTop)}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  const target = new DOMMatrix().scale(unit, unit, 1);
  canvas.updateElementGeometry(feedEl, { canvasTransform: target });
  canvas.updateElementGeometry(chromeEl, { canvasTransform: target });
  feedEl.dataset.hitTick = feedEl.dataset.hitTick === '1' ? '0' : '1';
  chromeEl.dataset.hitTick = chromeEl.dataset.hitTick === '1' ? '0' : '1';
}

function chromeRects(cw, ch) {
  const topR = [
    topbarEl.offsetLeft || 10,
    topbarEl.offsetTop || 8,
    topbarEl.offsetWidth || Math.max(120, cw - 20),
    topbarEl.offsetHeight || 48,
  ];
  const botR = [
    dockEl.offsetLeft || 12,
    dockEl.offsetTop || Math.max(80, ch - 60),
    dockEl.offsetWidth || Math.max(120, cw - 24),
    dockEl.offsetHeight || 50,
  ];
  return { topR, botR };
}

function renderWebGL(forceGeo = false) {
  if (!state.hasPainted || !stage || stage.lost || state.backend !== 'webgl') return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch) return;

  try {
    // Always call stage.begin() before stage.upload() so canvas backing dimensions match HiDPI pixels.
    if (!stage.begin([0, 0, 0, 0])) return;

    let uploadedNow = false;
    let feedTex = null;
    if (state.feedDirty || !stage.has(feedEl)) {
      feedTex = stage.upload(feedEl);
      state.feedDirty = false;
      state.blurDirty = true;
      state.uploads++;
      uploadedNow = true;
    }
    if (state.chromeDirty || !stage.has(chromeEl)) {
      stage.upload(chromeEl);
      state.chromeDirty = false;
      state.uploads++;
    }
    if (!stage.has(feedEl) || !stage.has(chromeEl)) return;

    const gl = stage.gl;
    if (!pyramid) pyramid = createBlurPyramid(gl);

    if (state.blurDirty || !blurTextures) {
      if (!feedTex) feedTex = stage.upload(feedEl);
      blurTextures = pyramid.run(feedTex.tex, cw, ch, canvas.width, canvas.height);
      state.blurDirty = false;
      if (!uploadedNow) state.uploads++;
    }

    // Re-bind ElementGL's default framebuffer and VAO cleanly before drawing to screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    if (!stage.begin([0, 0, 0, 0])) return;

    const { topR, botR } = chromeRects(cw, ch);
    const dark = darkQuery.matches;
    const scrimRgb = dark ? [0.09, 0.1, 0.13] : [0.97, 0.96, 0.94];
    const m = modeInt(state.mode);
    const tex1 = blurTextures?.tex1 ?? feedTex?.tex;
    const tex2 = blurTextures?.tex2 ?? tex1;
    const tex3 = blurTextures?.tex3 ?? tex1;

    stage.quad(feedEl, ElementGL.rect(canvas, 0, 0, cw, ch), (glCtx, loc) => {
      glCtx.activeTexture(glCtx.TEXTURE1);
      glCtx.bindTexture(glCtx.TEXTURE_2D, tex1);
      glCtx.uniform1i(loc('uBlur1'), 1);

      glCtx.activeTexture(glCtx.TEXTURE2);
      glCtx.bindTexture(glCtx.TEXTURE_2D, tex2);
      glCtx.uniform1i(loc('uBlur2'), 2);

      glCtx.activeTexture(glCtx.TEXTURE3);
      glCtx.bindTexture(glCtx.TEXTURE_2D, tex3);
      glCtx.uniform1i(loc('uBlur3'), 3);

      glCtx.activeTexture(glCtx.TEXTURE0);
      glCtx.uniform1i(loc('uPass'), 0);
      glCtx.uniform1i(loc('uMode'), m);
      glCtx.uniform2f(loc('uCanvasSize'), cw, ch);
      glCtx.uniform1f(loc('uMaxBlurPx'), state.maxBlurPx);
      glCtx.uniform1f(loc('uRampPx'), state.rampPx);
      glCtx.uniform4f(loc('uTopRect'), topR[0], topR[1], topR[2], topR[3]);
      glCtx.uniform4f(loc('uBotRect'), botR[0], botR[1], botR[2], botR[3]);
      glCtx.uniform1f(loc('uTopRadius'), 14);
      glCtx.uniform1f(loc('uBotRadius'), botR[3] * 0.5);
      glCtx.uniform1f(loc('uScrimAlpha'), dark ? 0.24 : 0.16);
      glCtx.uniform3f(loc('uScrimRgb'), scrimRgb[0], scrimRgb[1], scrimRgb[2]);
    });

    stage.quad(chromeEl, ElementGL.rect(canvas, 0, 0, cw, ch), (glCtx, loc) => {
      glCtx.uniform1i(loc('uPass'), 1);
    });

    syncGeometry(forceGeo);
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      state.feedDirty = true;
      state.chromeDirty = true;
      state.blurDirty = true;
      canvas.requestPaint?.();
    } else {
      throw err;
    }
  }
}
// #endregion paint-loop

// #region fallback-2d
function render2DFallback(forceGeo = false) {
  if (!state.hasPainted || !ctx2d || state.backend !== '2d') return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.clearRect(0, 0, cw, ch);
  ctx2d.drawElementImage(feedEl, 0, 0, cw, ch);

  if (state.maxBlurPx > 0.5) {
    if (!plainCopy) {
      plainCopy = document.createElement('canvas');
      plainCopyCtx = plainCopy.getContext('2d');
    }
    const pw = Math.max(1, Math.round(cw));
    const ph = Math.max(1, Math.round(ch));
    if (plainCopy.width !== pw || plainCopy.height !== ph) {
      plainCopy.width = pw;
      plainCopy.height = ph;
    }
    plainCopyCtx.clearRect(0, 0, pw, ph);
    plainCopyCtx.drawImage(canvas, 0, 0, pw, ph);

    const { topR, botR } = chromeRects(cw, ch);
    const drawZone = (isTop) => {
      const bands = state.mode === 'uniform' ? 1 : 4;
      for (let i = 0; i < bands; i++) {
        ctx2d.save();
        if (state.mode === 'uniform') {
          const r = isTop ? topR : botR;
          const rad = isTop ? 14 : r[3] * 0.5;
          ctx2d.beginPath();
          ctx2d.roundRect(r[0], r[1], r[2], r[3], rad);
          ctx2d.clip();
          ctx2d.filter = `blur(${Math.round(state.maxBlurPx * 0.55)}px)`;
          ctx2d.drawImage(plainCopy, 0, 0, cw, ch);
        } else {
          const stepH = state.rampPx / bands;
          const y0 = isTop ? i * stepH : ch - (i + 1) * stepH;
          const t = 1 - (i + 0.35) / bands;
          ctx2d.beginPath();
          ctx2d.rect(0, y0, cw, stepH + 0.5);
          ctx2d.clip();
          ctx2d.filter = `blur(${Math.max(1, Math.round(state.maxBlurPx * 0.55 * t))}px)`;
          ctx2d.drawImage(plainCopy, 0, 0, cw, ch);
        }
        ctx2d.restore();
      }
    };
    drawZone(true);
    drawZone(false);
    ctx2d.filter = 'none';
  }

  ctx2d.drawElementImage(chromeEl, 0, 0, cw, ch);
  syncGeometry(forceGeo);
}
// #endregion fallback-2d

function renderFrame(forceGeo = false) {
  if (!state.isVisible || document.hidden || state.backend === 'plain') return;
  if (state.backend === 'webgl') renderWebGL(forceGeo);
  else if (state.backend === '2d') render2DFallback(forceGeo);
  updateHud();
}

function requestRedraw() {
  if (state.backend === 'plain' || state.backend === 'none') {
    updateHud();
    return;
  }
  canvas.requestPaint?.();
}

function stopAnimLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastTickMs = 0;
}

function stepAnim(now) {
  state.rafId = 0;
  if (!state.isVisible || document.hidden || state.backend === 'plain') return;
  if (state.scrollTarget === null) return;

  const dt = state.lastTickMs ? Math.min(0.05, (now - state.lastTickMs) / 1000) : 0.016;
  state.lastTickMs = now;
  const diff = state.scrollTarget - feedEl.scrollTop;
  if (isReduced() || Math.abs(diff) < 0.8) {
    feedEl.scrollTop = state.scrollTarget;
    state.scrollTarget = null;
  } else {
    feedEl.scrollTop += diff * Math.min(1, dt * 12);
    state.rafId = requestAnimationFrame(stepAnim);
  }
  state.feedDirty = true;
  state.blurDirty = true;
  renderFrame(true);
}

function startAnimLoop() {
  if (!state.rafId && state.isVisible && !document.hidden && state.backend !== 'plain') {
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(stepAnim);
  }
}

function enterPlainFallback(reason, { keepForRestore = false } = {}) {
  state.backend = 'plain';
  stopAnimLoop();
  stageBox.classList.add('is-plain');
  feedEl.inert = false;
  chromeEl.inert = false;
  if (feedEl.parentElement !== plainHost) plainHost.append(feedEl);
  if (chromeEl.parentElement !== plainHost) plainHost.append(chromeEl);
  showNotice(reason);
  updateHud();
  if (!keepForRestore) blurTextures = null;
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (feedEl.parentElement !== canvas) canvas.append(feedEl);
  if (chromeEl.parentElement !== canvas) canvas.append(chromeEl);
  lastGeoSig = '';
  showNotice('');
}

// ---------------------------------------------------------------- Scroll & Mouse-drag Input
feedEl.addEventListener('scroll', () => {
  feedEl.dataset.scrollTick = feedEl.dataset.scrollTick === '1' ? '0' : '1';
  state.feedDirty = true;
  state.blurDirty = true;
  if (!state.rafId) {
    renderFrame(true);
    canvas.requestPaint?.();
  }
}, { passive: true });

feedEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

let mouseActive = false;
let mouseDragged = false;
let mouseStartY = 0;
let mouseLastY = 0;

feedEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  if (e.target.closest('input, textarea, select, button')) return;
  window.getSelection?.()?.removeAllRanges?.();
  mouseActive = true;
  mouseDragged = false;
  mouseStartY = e.clientY;
  mouseLastY = e.clientY;
  state.scrollTarget = null;
});

window.addEventListener('pointermove', (e) => {
  if (!mouseActive || e.pointerType !== 'mouse') return;
  const dy = e.clientY - mouseLastY;
  mouseLastY = e.clientY;
  if (!mouseDragged && Math.abs(e.clientY - mouseStartY) > 6) {
    mouseDragged = true;
    feedEl.classList.add('is-dragging');
    window.getSelection?.()?.removeAllRanges?.();
  }
  if (!mouseDragged) return;
  if (e.cancelable) e.preventDefault();
  const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
  feedEl.scrollTop = clamp(feedEl.scrollTop - dy, 0, maxScroll);
});

function endMouseDrag() {
  if (!mouseActive) return;
  mouseActive = false;
  feedEl.classList.remove('is-dragging');
  if (mouseDragged) {
    suppressClickUntil = performance.now() + 90;
    mouseDragged = false;
  }
}
window.addEventListener('pointerup', endMouseDrag);
window.addEventListener('pointercancel', endMouseDrag);

const refreshGeoNow = () => {
  if (state.backend !== 'plain' && state.hasPainted) syncGeometry(false);
};
canvas.addEventListener('pointerdown', refreshGeoNow, true);
canvas.addEventListener('focusin', refreshGeoNow);

// ---------------------------------------------------------------- Toolbar & Sliders
for (const btn of modeBtns) {
  btn.addEventListener('click', () => {
    state.mode = btn.dataset.mode;
    for (const b of modeBtns) b.setAttribute('aria-pressed', String(b === btn));
    renderFrame();
    updateHud();
  });
}

ctlBlur.addEventListener('input', () => {
  state.maxBlurPx = Number(ctlBlur.value) || 0;
  outBlur.textContent = `${state.maxBlurPx} px`;
  renderFrame();
  updateHud();
});

ctlRamp.addEventListener('input', () => {
  state.rampPx = Number(ctlRamp.value) || 40;
  outRamp.textContent = `${state.rampPx} px`;
  renderFrame();
  updateHud();
});

ctlReduced.addEventListener('change', () => {
  if (isReduced() && state.scrollTarget !== null) {
    feedEl.scrollTop = state.scrollTarget;
    state.scrollTarget = null;
    stopAnimLoop();
    state.feedDirty = true;
    state.blurDirty = true;
    renderFrame(true);
  }
});

reducedQuery.addEventListener?.('change', () => {
  ctlReduced.checked = reducedQuery.matches;
  if (reducedQuery.matches && state.scrollTarget !== null) {
    feedEl.scrollTop = state.scrollTarget;
    state.scrollTarget = null;
    stopAnimLoop();
    state.feedDirty = true;
    state.blurDirty = true;
    renderFrame(true);
  }
});

darkQuery.addEventListener?.('change', () => {
  state.feedDirty = true;
  state.chromeDirty = true;
  state.blurDirty = true;
  requestRedraw();
});

// ---------------------------------------------------------------- Backend Startup & Observers
function wireCanvasListeners() {
  canvas.addEventListener('paint', (e) => {
    state.paints++;
    state.hasPainted = true;
    const changed = new Set(e.changedElements ?? []);
    if (!changed.size || changed.has(feedEl)) {
      state.feedDirty = true;
      state.blurDirty = true;
    }
    if (!changed.size || changed.has(chromeEl)) {
      state.chromeDirty = true;
    }
    if (state.isVisible && !document.hidden) renderFrame();
  });

  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.backend === '2d') {
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          enterPlainFallback('The 2D canvas context was lost, so the feed and bars moved to plain HTML.', { keepForRestore: true });
        }
      }, 900);
    }
  });

  canvas.addEventListener('contextrestored', () => {
    clearTimeout(lostTimer);
    if (ctx2d) {
      exitPlainFallback();
      state.backend = '2d';
      state.hasPainted = false;
      state.feedDirty = true;
      state.chromeDirty = true;
      requestRedraw();
    }
  });
}

function initBackend() {
  const forceRoute = new URLSearchParams(location.search).get('route');

  if (hicSupported && glSupported && forceRoute !== '2d' && forceRoute !== 'plain') {
    try {
      stage = new ElementGL(canvas, {
        fragment: COMPOSITE_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          pyramid = null;
          blurTextures = null;
          state.hasPainted = false;
          state.feedDirty = true;
          state.chromeDirty = true;
          state.blurDirty = true;
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              enterPlainFallback('The WebGL 2 context was lost, so the feed and bars moved to plain HTML until restored.', { keepForRestore: true });
            }
          }, 900);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          pyramid = createBlurPyramid(stage.gl);
          blurTextures = null;
          exitPlainFallback();
          state.backend = 'webgl';
          state.hasPainted = false;
          state.feedDirty = true;
          state.chromeDirty = true;
          state.blurDirty = true;
          requestRedraw();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      pyramid = createBlurPyramid(stage.gl);
      state.backend = 'webgl';
      wireCanvasListeners();
      requestRedraw();
      return;
    } catch {
      stage = null;
      pyramid = null;
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype && forceRoute !== 'plain') {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.backend = '2d';
      showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using 5-argument drawElementImage() 2D fallback.');
      wireCanvasListeners();
      requestRedraw();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the feed and floating bars are shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    const nowVisible = Boolean(entry && entry.isIntersecting);
    if (nowVisible === state.isVisible) return;
    state.isVisible = nowVisible;
    if (!state.isVisible) {
      stopAnimLoop();
    } else if (state.hasPainted) {
      renderFrame(true);
      if (state.scrollTarget !== null) startAnimLoop();
    }
  }, { rootMargin: '120px' }).observe(phoneViewport);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.backend === 'plain') return;
    lastGeoSig = '';
    state.feedDirty = true;
    state.chromeDirty = true;
    state.blurDirty = true;
    if (state.hasPainted) renderFrame(true);
    else requestRedraw();
  }).observe(phoneViewport);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAnimLoop();
  } else if (state.isVisible && state.hasPainted) {
    renderFrame(true);
    if (state.scrollTarget !== null) startAnimLoop();
  }
});

applyFeedFilter();
initBackend();
updateHud();

// ---------------------------------------------------------------- Live Checks (Tap-Gated, Isolated Fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function makeFixtureStage(w = 240, h = 200, { stripes = false, scrollButtons = false } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;background:#f4f1ea`;

  const feed = document.createElement('div');
  feed.setAttribute('drawable', '');
  feed.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow-y:auto;overscroll-behavior-y:contain;` +
    'background:#f4f1ea;color:#15161a;font:600 13px system-ui;box-sizing:border-box';

  let scrollBtn = null;
  if (stripes) {
    feed.style.background =
      'repeating-linear-gradient(90deg,#111827 0 6px,#ffffff 6px 12px,#d2491f 12px 18px,#1d5fa8 18px 24px)';
  } else if (scrollButtons) {
    const topBlock = document.createElement('div');
    topBlock.style.cssText = 'height:170px;background:#d2491f;color:#fff;padding:12px';
    topBlock.textContent = 'Top section';
    const midWrap = document.createElement('div');
    midWrap.style.cssText = 'height:160px;padding:14px;background:#1d5fa8';
    scrollBtn = document.createElement('button');
    scrollBtn.type = 'button';
    scrollBtn.textContent = 'Feed Action';
    scrollBtn.style.cssText = 'display:block;width:130px;height:40px;background:#fff;color:#111;border:0;border-radius:8px;font:700 13px system-ui';
    midWrap.append(scrollBtn);
    const tail = document.createElement('div');
    tail.style.cssText = 'height:160px;background:#1f7a3a';
    feed.append(topBlock, midWrap, tail);
  } else {
    const a = document.createElement('div');
    a.style.cssText = 'height:200px;background:#d2491f';
    const b = document.createElement('div');
    b.style.cssText = 'height:240px;background:#1d5fa8';
    feed.append(a, b);
  }

  const chrome = document.createElement('div');
  chrome.setAttribute('drawable', '');
  chrome.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;pointer-events:none;background:transparent`;

  const topbar = document.createElement('div');
  topbar.style.cssText =
    'position:absolute;left:8px;right:8px;top:6px;height:40px;border-radius:12px;' +
    'background:rgba(255,255,255,0.28);border:1px solid rgba(255,255,255,0.75);' +
    'display:flex;align-items:center;justify-content:space-between;padding:0 10px;pointer-events:auto';
  const topBtn = document.createElement('button');
  topBtn.type = 'button';
  topBtn.textContent = 'Top';
  topBtn.style.cssText = 'width:68px;height:30px;border:0;border-radius:99px;background:#15161a;color:#fff;font:600 12px system-ui';
  topbar.append(topBtn);

  const dock = document.createElement('div');
  dock.style.cssText =
    'position:absolute;left:10px;right:10px;bottom:8px;height:42px;border-radius:999px;' +
    'background:rgba(255,255,255,0.28);border:1px solid rgba(255,255,255,0.75);' +
    'display:flex;align-items:center;justify-content:center;pointer-events:auto';
  const dockBtn = document.createElement('button');
  dockBtn.type = 'button';
  dockBtn.textContent = 'Dock';
  dockBtn.style.cssText = 'width:76px;height:30px;border:0;border-radius:99px;background:#d2491f;color:#fff;font:600 12px system-ui';
  dock.append(dockBtn);

  chrome.append(topbar, dock);
  cv.append(feed, chrome);
  return { cv, feed, chrome, topBtn, dockBtn, scrollBtn };
}

function drawFixtureComposite(g, pyr, cv, feed, chrome, w, h, {
  mode = 0,
  maxBlurPx = 28,
  rampPx = 110,
  withChrome = true,
  scrimAlpha = 0.0,
} = {}) {
  g.begin([0, 0, 0, 0]);
  const fTex = g.upload(feed);
  if (withChrome) g.upload(chrome);
  const gl = g.gl;
  const pyrTex = pyr.run(fTex.tex, w, h, cv.width, cv.height);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindVertexArray(null);
  g.begin([0, 0, 0, 0]);

  g.quad(feed, ElementGL.rect(cv, 0, 0, w, h), (glCtx, loc) => {
    glCtx.activeTexture(glCtx.TEXTURE1);
    glCtx.bindTexture(glCtx.TEXTURE_2D, pyrTex.tex1);
    glCtx.uniform1i(loc('uBlur1'), 1);
    glCtx.activeTexture(glCtx.TEXTURE2);
    glCtx.bindTexture(glCtx.TEXTURE_2D, pyrTex.tex2);
    glCtx.uniform1i(loc('uBlur2'), 2);
    glCtx.activeTexture(glCtx.TEXTURE3);
    glCtx.bindTexture(glCtx.TEXTURE_2D, pyrTex.tex3);
    glCtx.uniform1i(loc('uBlur3'), 3);
    glCtx.activeTexture(glCtx.TEXTURE0);
    glCtx.uniform1i(loc('uPass'), 0);
    glCtx.uniform1i(loc('uMode'), mode);
    glCtx.uniform2f(loc('uCanvasSize'), w, h);
    glCtx.uniform1f(loc('uMaxBlurPx'), maxBlurPx);
    glCtx.uniform1f(loc('uRampPx'), rampPx);
    glCtx.uniform4f(loc('uTopRect'), 8, 6, w - 16, 40);
    glCtx.uniform4f(loc('uBotRect'), 10, h - 50, w - 20, 42);
    glCtx.uniform1f(loc('uTopRadius'), 12);
    glCtx.uniform1f(loc('uBotRadius'), 21);
    glCtx.uniform1f(loc('uScrimAlpha'), scrimAlpha);
    glCtx.uniform3f(loc('uScrimRgb'), 0.97, 0.96, 0.94);
  });

  if (withChrome) {
    g.quad(chrome, ElementGL.rect(cv, 0, 0, w, h), (glCtx, loc) => {
      glCtx.uniform1i(loc('uPass'), 1);
    });
  }
}

function readRowLine(gl, cv, w, h, cssY) {
  const row = new Uint8Array(4 * cv.width);
  const py = clamp(Math.round((h - cssY) * (cv.height / h)), 0, cv.height - 1);
  gl.readPixels(0, py, cv.width, 1, gl.RGBA, gl.UNSIGNED_BYTE, row);
  return row;
}

function rowRmsContrast(row, cvW) {
  const x0 = Math.floor(cvW * 0.12);
  const x1 = Math.ceil(cvW * 0.88);
  let sum = 0;
  let count = 0;
  for (let x = x0; x < x1; x++) {
    const i = x * 4;
    sum += 0.299 * row[i] + 0.587 * row[i + 1] + 0.114 * row[i + 2];
    count++;
  }
  if (!count) return 0;
  const mean = sum / count;
  let sq = 0;
  for (let x = x0; x < x1; x++) {
    const i = x * 4;
    const lum = 0.299 * row[i] + 0.587 * row[i + 1] + 0.114 * row[i + 2];
    const d = lum - mean;
    sq += d * d;
  }
  return Math.sqrt(sq / count);
}

function meanRgbAtRow(row, cvW) {
  const x0 = Math.floor(cvW * 0.2);
  const x1 = Math.ceil(cvW * 0.8);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = x0; x < x1; x++) {
    const i = x * 4;
    r += row[i];
    g += row[i + 1];
    b += row[i + 2];
    n++;
  }
  return n ? [r / n, g / n, b / n] : [0, 0, 0];
}

runTests(testsBody, [
  {
    name: 'ElementGL upload and 6-pass separable FBO pyramid render with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated fixture on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, gates upload on paint with begin() before upload(), runs 3-level H+V FBO passes, unbinds FBO and VAO, and verifies pixels.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 220;
      const H = 180;
      const { cv, feed, chrome } = makeFixtureStage(W, H, { stripes: true });
      testStage().append(cv);
      let g = null;
      let pyr = null;
      try {
        g = new ElementGL(cv, { fragment: COMPOSITE_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        pyr = createBlurPyramid(g.gl);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 0, maxBlurPx: 28, rampPx: 96, withChrome: true, scrimAlpha: 0.16 });
        const err = g.gl.getError();
        const midRow = readRowLine(g.gl, cv, W, H, H * 0.5);
        const midContrast = rowRmsContrast(midRow, cv.width);
        const pxMid = meanRgbAtRow(midRow, cv.width);
        return need(
          err === g.gl.NO_ERROR && midContrast > 20 && pxMid[0] > 40,
          `glErr=${err}, canvas=${cv.width}x${cv.height}, midRms=${midContrast.toFixed(1)}, midRgb=[${pxMid.map((v) => Math.round(v)).join(',')}]`
        );
      } finally {
        pyr?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Progressive blur smooths stripe variance toward top edge while middle stays sharp vs uniform',
    expect: 'pass',
    why: 'Measures horizontal luminance gradient on high-frequency vertical stripes at y = 10, 44, 82 and 150 px in Progressive mode vs Uniform mode.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 220;
      const { cv, feed, chrome } = makeFixtureStage(W, H, { stripes: true });
      testStage().append(cv);
      let g = null;
      let pyr = null;
      try {
        g = new ElementGL(cv, { fragment: COMPOSITE_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        pyr = createBlurPyramid(g.gl);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);

        drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 0, maxBlurPx: 28, rampPx: 110, withChrome: false, scrimAlpha: 0 });
        const vTop = rowRmsContrast(readRowLine(g.gl, cv, W, H, 10), cv.width);
        const vUpper = rowRmsContrast(readRowLine(g.gl, cv, W, H, 38), cv.width);
        const vLower = rowRmsContrast(readRowLine(g.gl, cv, W, H, 68), cv.width);
        const vMid = rowRmsContrast(readRowLine(g.gl, cv, W, H, 145), cv.width);

        drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 2, maxBlurPx: 28, rampPx: 110, withChrome: false, scrimAlpha: 0 });
        const uTop = rowRmsContrast(readRowLine(g.gl, cv, W, H, 16), cv.width);
        const uBarEnd = rowRmsContrast(readRowLine(g.gl, cv, W, H, 36), cv.width);
        const uBelow = rowRmsContrast(readRowLine(g.gl, cv, W, H, 68), cv.width);

        const progressiveMonotonic = vTop < vUpper && vUpper < vLower && vLower < vMid * 0.96 && vTop < vMid * 0.25 && vMid > 40;
        const uniformSteepCutoff = uTop < vMid * 0.25 && Math.abs(uTop - uBarEnd) < 4.0 && uBelow > vMid * 0.9;
        return need(
          progressiveMonotonic && uniformSteepCutoff,
          `prog rms: y10=${vTop.toFixed(1)}, y38=${vUpper.toFixed(1)}, y68=${vLower.toFixed(1)}, y145=${vMid.toFixed(1)}; ` +
          `uniform: y16=${uTop.toFixed(1)}, y36=${uBarEnd.toFixed(1)}, y68=${uBelow.toFixed(1)}`
        );
      } finally {
        pyr?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Scrolling the drawable feed changes blurred pixels behind the top bar',
    expect: 'pass',
    why: 'Scrolls an isolated two-tone feed from scrollTop = 0 (vermilion) to scrollTop = 210 (cobalt), re-uploads and blurs, and measures RGB shift behind the floating header.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 220;
      const H = 190;
      const { cv, feed, chrome } = makeFixtureStage(W, H, { stripes: false });
      testStage().append(cv);
      let g = null;
      let pyr = null;
      try {
        g = new ElementGL(cv, { fragment: COMPOSITE_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        pyr = createBlurPyramid(g.gl);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);

        drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 0, maxBlurPx: 26, rampPx: 100, withChrome: true, scrimAlpha: 0.08 });
        const topBefore = meanRgbAtRow(readRowLine(g.gl, cv, W, H, 26), cv.width);

        feed.scrollTop = 210;
        await nextPaint(cv);
        drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 0, maxBlurPx: 26, rampPx: 100, withChrome: true, scrimAlpha: 0.08 });
        const topAfter = meanRgbAtRow(readRowLine(g.gl, cv, W, H, 26), cv.width);

        const delta = Math.abs(topBefore[0] - topAfter[0]) + Math.abs(topBefore[2] - topAfter[2]);
        return need(
          topBefore[0] > topBefore[2] + 30 && topAfter[2] > topAfter[0] + 30 && delta > 120,
          `scrollTop=0 rgb=[${topBefore.map((v) => Math.round(v)).join(',')}] -> scrollTop=210 rgb=[${topAfter.map((v) => Math.round(v)).join(',')}]`
        );
      } finally {
        pyr?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() hit-tests buttons in both #pb-chrome and scrolled #pb-feed',
    expect: 'pass',
    why: 'Calls geometryUnit()-scaled updateElementGeometry() on both sibling subtrees after scrolling, and checks elementsFromPoint() hits the top bar button, bottom dock button and mid-feed button.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 250;
      const H = 220;
      const { cv, feed, chrome, topBtn, dockBtn, scrollBtn } = makeFixtureStage(W, H, { scrollButtons: true });
      testStage().append(cv);
      let g = null;
      let pyr = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: COMPOSITE_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          pyr = createBlurPyramid(g.gl);
          g.begin([0, 0, 0, 0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        feed.scrollTop = 96;
        await nextPaint(cv);

        if (g && pyr) {
          drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 0, maxBlurPx: 24, rampPx: 96, withChrome: true, scrimAlpha: 0.16 });
        }

        const unit = geometryUnit(cv, feed, feed.offsetWidth);
        const mat = new DOMMatrix().scale(unit, unit, 1);
        cv.updateElementGeometry(feed, { canvasTransform: mat });
        cv.updateElementGeometry(chrome, { canvasTransform: mat });
        feed.dataset.hitTick = '1';
        chrome.dataset.hitTick = '1';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const hitCentre = (el) => {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width * 0.5;
          const y = r.top + r.height * 0.5;
          const hits = document.elementsFromPoint(x, y);
          return { ok: hits.includes(el), x: Math.round(x), y: Math.round(y), top: hits[0]?.tagName };
        };

        const hTop = hitCentre(topBtn);
        const hDock = hitCentre(dockBtn);
        const hFeed = hitCentre(scrollBtn);
        return need(
          hTop.ok && hDock.ok && hFeed.ok,
          `unit=${unit.toFixed(3)}, topBtn=${hTop.ok} [${hTop.top}], dockBtn=${hDock.ok} [${hDock.top}], feedBtn=${hFeed.ok} [${hFeed.top}]`
        );
      } finally {
        pyr?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'webglcontextlost rescues to plain HTML, webglcontextrestored recovers, and 5-arg 2D draw works',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored on an isolated ElementGL fixture, then verifies a 5-argument drawElementImage() 2D fixture renders non-blank pixels with zero draw-size warnings.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 200;
      const H = 160;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, feed, chrome } = makeFixtureStage(W, H, { stripes: true });
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let pyr = null;
      let lostOk = false;
      let restoredOk = false;
      let cv2 = null;
      try {
        g = new ElementGL(cv, {
          fragment: COMPOSITE_FRAG,
          attributes: { alpha: false, preserveDrawingBuffer: true },
          onLost: () => {
            pyr = null;
            plain.hidden = false;
            plain.append(feed, chrome);
            lostOk = true;
          },
          onRestored: () => {
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            pyr = createBlurPyramid(g.gl);
            plain.hidden = true;
            cv.append(feed, chrome);
            restoredOk = true;
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        pyr = createBlurPyramid(g.gl);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 0, maxBlurPx: 24, rampPx: 90 });

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const rescuedToPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(feed) && plain.contains(chrome);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        drawFixtureComposite(g, pyr, cv, feed, chrome, W, H, { mode: 0, maxBlurPx: 24, rampPx: 90 });
        const glErrAfter = g.gl.getError();
        const premulAfter = Boolean(g.gl.getParameter(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL));

        // 5-argument drawElementImage() 2D fallback fixture (never willReadFrequently on drawable canvas).
        const wrongBefore = window.__gfx?.draws?.wrong ?? 0;
        cv2 = document.createElement('canvas');
        cv2.setAttribute('content', 'drawable');
        cv2.setAttribute('layoutsubtree', '');
        cv2.style.cssText = `display:block;position:relative;width:${W}px;height:${H}px`;
        const f2 = document.createElement('div');
        f2.setAttribute('drawable', '');
        f2.style.cssText = `width:${W}px;height:${H}px;background:#d2491f`;
        const c2 = document.createElement('div');
        c2.setAttribute('drawable', '');
        c2.style.cssText = `position:absolute;left:12px;top:12px;width:${W - 24}px;height:36px;background:rgba(255,255,255,0.6)`;
        cv2.append(f2, c2);
        wrap.append(cv2);
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        cv2.width = Math.round(W * dpr);
        cv2.height = Math.round(H * dpr);
        const ctx2 = cv2.getContext('2d');
        await nextPaint(cv2);
        ctx2.reset();
        ctx2.scale(dpr, dpr);
        ctx2.drawElementImage(f2, 0, 0, W, H);
        ctx2.drawElementImage(c2, 12, 12, W - 24, 36);

        const copy = document.createElement('canvas');
        copy.width = cv2.width;
        copy.height = cv2.height;
        const copyCtx = copy.getContext('2d', { willReadFrequently: true });
        copyCtx.drawImage(cv2, 0, 0);
        const px2 = copyCtx.getImageData(Math.floor(copy.width * 0.5), Math.floor(copy.height * 0.5), 1, 1).data;
        copy.width = 0;
        copy.height = 0;
        const wrongDelta = (window.__gfx?.draws?.wrong ?? 0) - wrongBefore;

        return need(
          rescuedToPlain && restoredOk && !g.lost && cv.contains(feed) && glErrAfter === g.gl.NO_ERROR && premulAfter && px2[0] > 140 && px2[3] > 200 && wrongDelta === 0,
          `plainRescue=${rescuedToPlain}, restored=${restoredOk}, premul=${premulAfter}, glErr=${glErrAfter}, 2dRgb=[${Array.from(px2).join(',')}], wrongDrawSize=${wrongDelta}`
        );
      } finally {
        pyr?.dispose();
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
        if (cv2) window.__gfx?.retire?.(cv2);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'progressive-blur stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !stage.has(feedEl) || !stage.has(chromeEl)) return 0;
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
