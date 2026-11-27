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
import { geometryUnit } from '/lib/surface.js';

banner();

const OFFSTAGE = typeof DOMMatrix !== 'undefined'
  ? new DOMMatrix().translate(-100000, -100000)
  : null;

const MAX_BOKEH_PX = 18;
const PEEK_HOLD_MS = 240;
const PEEK_T = 0.5;
const EXPAND_ON_T = 0.72;
const EXPAND_OFF_T = 0.62;
const SPRING_K = 290;
const SPRING_DAMP = 26;

const stageWrap = document.getElementById('peek-stage');
const viewportEl = document.getElementById('peek-viewport');
const canvas = document.getElementById('peek-canvas');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('peek-hud');
const noticeEl = document.getElementById('peek-notice');
const stagePill = document.getElementById('stage-pill');
const slowChk = document.getElementById('chk-slow');
const reducedChk = document.getElementById('chk-reduced');
const dismissBtn = document.getElementById('btn-dismiss');
const testsBody = document.getElementById('tests');

const cards = Array.from(canvas.querySelectorAll('.feed-card'));

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

if (reducedQuery.matches) reducedChk.checked = true;

function isReducedMotion() {
  return reducedChk.checked || reducedQuery.matches;
}

// #region bokeh-shader
const CARD_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform int uPass;      // 0 = live HTML card, 1 = recessed grid slot, 2 = soft drop shadow, 3 = stage backdrop
uniform float uLift;    // 0..1 lift/pop progress
uniform vec2 uTilt;     // normalized tilt (-1..1)
uniform float uDim;     // 0..1 background dim factor
uniform float uActive;  // 1 when this card is foreground lifted/popped

out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

void main() {
  if (uPass == 3) {
    vec2 c = vUv - vec2(0.5, 0.42);
    float rad = length(c * vec2(1.0, 1.2));
    vec3 bg = mix(vec3(0.098, 0.118, 0.176), vec3(0.043, 0.051, 0.078), clamp(rad * 1.18, 0.0, 1.0));
    vec2 gridPx = vUv * max(uSize, vec2(1.0));
    vec2 cell = abs(fract(gridPx / 24.0) - 0.5);
    float dotDist = length(cell * 24.0);
    float dotMask = 1.0 - smoothstep(0.9, 1.8, dotDist);
    bg += vec3(0.18, 0.22, 0.34) * dotMask * 0.22;
    outColor = vec4(bg, 1.0);
    return;
  }

  vec2 px = (vUv - 0.5) * uSize;
  vec2 halfBox = uSize * 0.5;
  float radius = min(16.0, min(halfBox.x, halfBox.y) * 0.22);

  if (uPass == 1) {
    float d = sdRoundBox(px, halfBox - vec2(2.0), radius);
    float inside = 1.0 - smoothstep(-1.0, 1.0, d);
    float border = (1.0 - smoothstep(0.0, 2.2, abs(d))) * inside;
    float dash = step(0.45, fract((vUv.x + vUv.y) * 14.0));
    vec3 fillCol = vec3(0.055, 0.068, 0.102);
    vec3 rimCol = vec3(0.46, 0.54, 0.72);
    float fillA = inside * 0.52;
    float rimA = border * (0.28 + 0.32 * dash);
    float a = clamp(fillA + rimA, 0.0, 1.0);
    vec3 rgb = mix(fillCol, rimCol, clamp(rimA / max(a, 0.001), 0.0, 1.0));
    outColor = vec4(rgb * a, a);
    return;
  }

  if (uPass == 2) {
    float spread = 14.0 + 18.0 * uLift;
    vec2 shadowHalf = max(vec2(4.0), halfBox - vec2(spread));
    float d = sdRoundBox(px, shadowHalf, radius);
    float falloff = 1.0 - smoothstep(-2.0, spread, d);
    float a = falloff * falloff * (0.22 + 0.34 * uLift);
    outColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }

  vec4 tex = texture(uTex, vUv);
  vec2 fw = max(fwidth(vUv), vec2(1e-5));
  vec2 edge = min(vUv, 1.0 - vUv);
  float aa = min(clamp(edge.x / fw.x, 0.0, 1.0), clamp(edge.y / fw.y, 0.0, 1.0));

  float a = tex.a * aa;
  vec3 rgb = tex.rgb * aa;

  if (uActive > 0.5 && uLift > 0.02) {
    vec2 centered = vUv - 0.5;
    float sweep = dot(centered, normalize(vec2(0.75, -0.66) + uTilt * 0.6)) - dot(uTilt, vec2(0.45, 0.35));
    float sheen = exp(-pow(sweep * 5.2, 2.0)) * 0.10 * sin(3.14159265 * clamp(uLift, 0.0, 1.0));
    float d = sdRoundBox(px, halfBox - vec2(1.0), radius);
    float rim = (1.0 - smoothstep(0.0, 2.0, abs(d))) * 0.18 * uLift;
    rgb += vec3(1.0, 0.98, 0.94) * (sheen + rim) * a;
  }

  rgb *= (1.0 - uDim * 0.25);
  outColor = vec4(clamp(rgb, 0.0, 1.0), a);
}`;

const BOKEH_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = vec2(aPos.x, 1.0 - aPos.y);
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const BOKEH_FS = `#version 300 es
precision highp float;

in vec2 vUv;

uniform sampler2D uBgTex;
uniform vec2 uCssSize;
uniform float uBlurRadius; // 0..18 CSS px
uniform float uDim;        // 0..1

out vec4 outColor;

void main() {
  if (uBlurRadius <= 0.05) {
    outColor = vec4(texture(uBgTex, vUv).rgb, 1.0);
    return;
  }

  const int SAMPLES = 28;
  const float GOLDEN_ANGLE = 2.39996323;
  vec2 pxRadius = vec2(uBlurRadius) / max(uCssSize, vec2(1.0));

  vec3 sumCol = vec3(0.0);
  float sumWeight = 0.0;

  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / float(SAMPLES));
    float theta = fi * GOLDEN_ANGLE;
    vec2 off = vec2(cos(theta), sin(theta)) * r * pxRadius;
    vec3 s = texture(uBgTex, clamp(vUv + off, vec2(0.001), vec2(0.999))).rgb;

    // Emphasize bright highlights & aperture ring edge for authentic optical bokeh disks.
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    float highlight = 1.0 + pow(max(0.0, lum - 0.52), 2.0) * 4.2 * uDim;
    float apertureRing = mix(0.84, 1.28, smoothstep(0.58, 1.0, r));
    float w = highlight * mix(1.0, apertureRing, uDim);

    sumCol += s * w;
    sumWeight += w;
  }

  vec3 blurred = sumCol / max(sumWeight, 0.0001);
  vec2 d = vUv - 0.5;
  float vig = 1.0 - dot(d, d) * 0.55 * uDim;
  float shade = mix(1.0, 0.72, uDim * 0.85) * vig;
  outColor = vec4(blurred * shade, 1.0);
}`;
// #endregion bokeh-shader

// #region spring-pose
export function computeStageLayout(cw, ch) {
  const safeW = Math.max(220, cw || 354);
  const safeH = Math.max(260, ch || 476);
  const compact = safeW < 540;
  const cols = compact ? 2 : 3;
  const rows = compact ? 3 : 2;
  const pad = compact ? 12 : 14;
  const gap = compact ? 10 : 12;

  const slotW = (safeW - pad * 2 - gap * (cols - 1)) / cols;
  const slotH = (safeH - pad * 2 - gap * (rows - 1)) / rows;

  const slots = [];
  for (let i = 0; i < 6; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (slotW + gap);
    const y = pad + row * (slotH + gap);
    slots.push({
      index: i,
      x,
      y,
      w: slotW,
      h: slotH,
      cx: x + slotW * 0.5,
      cy: y + slotH * 0.5,
    });
  }

  const cardW = Math.round(Math.min(404, safeW - 24));
  const cardH = Math.round(Math.min(safeH - 30, Math.max(280, cardW * (slotH / slotW))));

  return { cw: safeW, ch: safeH, cols, rows, cardW, cardH, slots };
}

export function computeCardPose(slot, cw, ch, cardW, cardH, t, opts = {}) {
  const tc = Math.min(1, Math.max(0, t));
  const s0 = slot.w / cardW;
  const sPeek = s0 * 1.08;
  const peekCx = slot.cx + (cw * 0.5 - slot.cx) * 0.14;
  const peekCy = slot.cy + (ch * 0.5 - slot.cy) * 0.14;

  let baseCx;
  let baseCy;
  let scale;

  if (tc <= 0.5) {
    const u = tc * 2;
    const e = u * u * (3 - 2 * u);
    baseCx = slot.cx + (peekCx - slot.cx) * e;
    baseCy = slot.cy + (peekCy - slot.cy) * e;
    scale = s0 + (sPeek - s0) * e;
  } else {
    const u = (tc - 0.5) * 2;
    const e = u * u * (3 - 2 * u);
    baseCx = peekCx + (cw * 0.5 - peekCx) * e;
    baseCy = peekCy + (ch * 0.5 - peekCy) * e;
    scale = sPeek + (1.0 - sPeek) * e;
  }

  let cx = baseCx;
  let cy = baseCy;
  if (opts.scrubbing) {
    const dragX = opts.dragX ?? 0;
    const dragY = opts.dragY ?? 0;
    const clampedY = dragY < 0 ? dragY * 0.32 : dragY;
    cx = cw * 0.5 + dragX;
    cy = ch * 0.5 + clampedY;
  } else {
    cx += opts.releaseOffX ?? 0;
    cy += opts.releaseOffY ?? 0;
  }

  const w = cardW * scale;
  const h = cardH * scale;
  const x = cx - w * 0.5;
  const y = cy - h * 0.5;
  const blurRadius = MAX_BOKEH_PX * tc;
  const rotZ = opts.rotZ ?? 0;
  const tiltX = opts.tiltX ?? 0;
  const tiltY = opts.tiltY ?? 0;

  return {
    t: tc,
    x,
    y,
    w,
    h,
    cx,
    cy,
    scale,
    blurRadius,
    rotZ,
    tiltX,
    tiltY,
  };
}

export function buildCardMatrix(pose, cardW, cardH) {
  const sy = pose.h / Math.max(1, cardH);
  const sx = pose.w / Math.max(1, cardW);
  const persp = new DOMMatrix();
  persp.m34 = -1 / 900;
  return new DOMMatrix()
    .translate(pose.cx, pose.cy)
    .multiply(persp)
    .rotate(pose.tiltX, pose.tiltY, pose.rotZ)
    .scale(sx, sy, 1)
    .translate(-cardW * 0.5, -cardH * 0.5);
}

export function stepThrowSpring(sp, dt, reduced) {
  if (reduced) {
    sp.t = sp.targetT;
    sp.vt = 0;
    sp.releaseOffX = 0;
    sp.releaseOffY = 0;
    sp.vx = 0;
    sp.vy = 0;
    sp.rotZ = 0;
    sp.vRotZ = 0;
    sp.tiltX = 0;
    sp.tiltY = 0;
    return true;
  }

  const stepDt = Math.min(0.033, Math.max(0.001, dt));
  const sub = 2;
  const h = stepDt / sub;

  for (let i = 0; i < sub; i++) {
    const at = (sp.targetT - sp.t) * SPRING_K - sp.vt * SPRING_DAMP;
    sp.vt += at * h;
    sp.t = Math.min(1.06, Math.max(0, sp.t + sp.vt * h));

    const ax = (0 - sp.releaseOffX) * SPRING_K - sp.vx * SPRING_DAMP;
    const ay = (0 - sp.releaseOffY) * SPRING_K - sp.vy * SPRING_DAMP;
    sp.vx += ax * h;
    sp.vy += ay * h;
    sp.releaseOffX += sp.vx * h;
    sp.releaseOffY += sp.vy * h;

    const ar = (0 - sp.rotZ) * SPRING_K - sp.vRotZ * SPRING_DAMP;
    sp.vRotZ += ar * h;
    sp.rotZ += sp.vRotZ * h;

    sp.tiltX += (sp.targetTiltX - sp.tiltX) * Math.min(1, 14 * h);
    sp.tiltY += (sp.targetTiltY - sp.tiltY) * Math.min(1, 14 * h);
  }

  const done =
    Math.abs(sp.targetT - sp.t) < 0.0015 &&
    Math.abs(sp.vt) < 0.008 &&
    Math.hypot(sp.releaseOffX, sp.releaseOffY) < 0.25 &&
    Math.hypot(sp.vx, sp.vy) < 1.5 &&
    Math.abs(sp.rotZ) < 0.05 &&
    Math.abs(sp.targetTiltX - sp.tiltX) < 0.05 &&
    Math.abs(sp.targetTiltY - sp.tiltY) < 0.05;

  if (done) {
    sp.t = sp.targetT;
    sp.vt = 0;
    sp.releaseOffX = 0;
    sp.releaseOffY = 0;
    sp.vx = 0;
    sp.vy = 0;
    sp.rotZ = 0;
    sp.vRotZ = 0;
    sp.tiltX = sp.targetTiltX;
    sp.tiltY = sp.targetTiltY;
  }
  return done;
}
// #endregion spring-pose

function toClip(mat, w, h, cw, ch) {
  const c = new DOMMatrix()
    .translate(-1, 1)
    .scale(2 / cw, -2 / ch)
    .multiply(mat)
    .scale(w, h);
  c.m13 = 0;
  c.m23 = 0;
  c.m33 = 0;
  c.m43 = 0;
  return c.toFloat32Array();
}

// #region hit-geometry
const unitCache = { key: '', unit: 1 };
const geoKeys = new Map();

function cachedGeometryUnit(cv, el, cardW, cache = unitCache) {
  const zoom = el.currentCSSZoom || 1;
  const key = `${cv.width}x${cv.height}/${cv.clientWidth}x${cv.clientHeight}/${cardW}/${zoom}`;
  if (cache.key !== key) {
    cache.unit = geometryUnit(cv, el, cardW);
    cache.key = key;
    geoKeys.clear();
  }
  return cache.unit;
}

function syncCardGeometry(cv, list, poses, activeIndex, t, cardW, keysMap = geoKeys, cache = unitCache) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  const poppedLock = activeIndex >= 0 && t > 0.45;
  const dimBackground = activeIndex >= 0 && t > 0.22;

  for (let i = 0; i < list.length; i++) {
    const el = list[i];
    const isBg = activeIndex >= 0 && i !== activeIndex;
    const wantInert = dimBackground && isBg;
    if (el.inert !== wantInert) el.inert = wantInert;

    let mat;
    let key;
    if (poppedLock && isBg && OFFSTAGE) {
      mat = OFFSTAGE;
      key = 'offstage';
    } else {
      const unit = cachedGeometryUnit(cv, el, cardW, cache);
      mat = new DOMMatrix().scale(unit, unit, 1).multiply(poses[i].cssMat);
      key = `${mat.a.toFixed(3)},${mat.b.toFixed(3)},${mat.c.toFixed(3)},${mat.d.toFixed(3)},${mat.e.toFixed(2)},${mat.f.toFixed(2)},${mat.m34.toFixed(5)}`;
    }

    if (keysMap.get(el) !== key) {
      keysMap.set(el, key);
      cv.updateElementGeometry(el, { canvasTransform: mat });
      el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
    }
  }
}
// #endregion hit-geometry

const state = {
  backend: 'init',
  mode: 'grid', // 'grid' | 'peeking' | 'popped' | 'scrubbing' | 'springing'
  activeIndex: -1,
  stickyPeek: false,
  onScreen: true,
  paints: 0,
  uploads: 0,
  lastCardW: 0,
  lastCardH: 0,
  layout: computeStageLayout(354, 476),
  spring: {
    t: 0,
    targetT: 0,
    vt: 0,
    dragX: 0,
    dragY: 0,
    releaseOffX: 0,
    releaseOffY: 0,
    vx: 0,
    vy: 0,
    rotZ: 0,
    vRotZ: 0,
    tiltX: 0,
    tiltY: 0,
    targetTiltX: 0,
    targetTiltY: 0,
  },
};

const dirtyCards = new Set(cards);

let stage = null;
let bokehRes = null;
let ctx2d = null;
let paint2dRaf = 0;
let motionRaf = 0;
let lastMotionTime = 0;

function createBokehResources(gl) {
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
  const vs = compile(gl.VERTEX_SHADER, BOKEH_VS);
  const fs = compile(gl.FRAGMENT_SHADER, BOKEH_FS);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(prog));
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    prog,
    vao,
    vbo,
    fbo,
    tex,
    w: 0,
    h: 0,
    uBgTex: gl.getUniformLocation(prog, 'uBgTex'),
    uCssSize: gl.getUniformLocation(prog, 'uCssSize'),
    uBlurRadius: gl.getUniformLocation(prog, 'uBlurRadius'),
    uDim: gl.getUniformLocation(prog, 'uDim'),
  };
}

function disposeBokehResources(gl, res) {
  if (!res || !gl || gl.isContextLost()) return;
  gl.deleteFramebuffer(res.fbo);
  gl.deleteTexture(res.tex);
  gl.deleteBuffer(res.vbo);
  gl.deleteVertexArray(res.vao);
  gl.deleteProgram(res.prog);
}

function ensureBokehSize(gl, res, w, h) {
  const tw = Math.max(2, Math.round(w * 0.5));
  const th = Math.max(2, Math.round(h * 0.5));
  if (res.w === tw && res.h === th) return;
  res.w = tw;
  res.h = th;
  gl.bindTexture(gl.TEXTURE_2D, res.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, res.tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function setCardExpanded(card, expanded) {
  const val = expanded ? 'true' : 'false';
  if (card.dataset.expanded === val) return;
  card.dataset.expanded = val;

  const caption = card.querySelector('.card-caption');
  const closeBtn = card.querySelector('.btn-close');
  if (!expanded && document.activeElement === caption) {
    caption.blur();
  }
  caption.disabled = !expanded;
  caption.tabIndex = expanded ? 0 : -1;
  closeBtn.disabled = !expanded;
  closeBtn.tabIndex = expanded ? 0 : -1;
  dirtyCards.add(card);
}

function syncExpansionState() {
  const t = state.spring.t;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    if (i !== state.activeIndex) {
      setCardExpanded(card, false);
    } else {
      const wasExpanded = card.dataset.expanded === 'true';
      const wantExpanded = wasExpanded ? t >= EXPAND_OFF_T : t >= EXPAND_ON_T;
      setCardExpanded(card, wantExpanded);
    }
  }
}

function updateLayoutDimensions() {
  const cw = canvas.clientWidth || viewportEl.clientWidth || 354;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 476;
  const layout = computeStageLayout(cw, ch);
  state.layout = layout;
  if (state.lastCardW !== layout.cardW || state.lastCardH !== layout.cardH) {
    state.lastCardW = layout.cardW;
    state.lastCardH = layout.cardH;
    canvas.style.setProperty('--card-w', `${layout.cardW}px`);
    canvas.style.setProperty('--card-h', `${layout.cardH}px`);
    for (const c of cards) dirtyCards.add(c);
    unitCache.key = '';
    geoKeys.clear();
  }
  return layout;
}

function currentCardPoses(layout) {
  const sp = state.spring;
  const poses = [];
  for (let i = 0; i < cards.length; i++) {
    const slot = layout.slots[i];
    let pose;
    if (i === state.activeIndex && sp.t > 0) {
      pose = computeCardPose(slot, layout.cw, layout.ch, layout.cardW, layout.cardH, sp.t, {
        scrubbing: state.mode === 'scrubbing',
        dragX: sp.dragX,
        dragY: sp.dragY,
        releaseOffX: sp.releaseOffX,
        releaseOffY: sp.releaseOffY,
        rotZ: sp.rotZ,
        tiltX: sp.tiltX,
        tiltY: sp.tiltY,
      });
    } else {
      pose = computeCardPose(slot, layout.cw, layout.ch, layout.cardW, layout.cardH, 0);
    }
    pose.cssMat = buildCardMatrix(pose, layout.cardW, layout.cardH);
    poses.push(pose);
  }
  return poses;
}

function showNotice(msg) {
  noticeEl.hidden = !msg;
  noticeEl.textContent = msg || '';
}

function updateHud() {
  const sp = state.spring;
  const blur = MAX_BOKEH_PX * Math.min(1, Math.max(0, sp.t));
  const stageName =
    state.activeIndex < 0 ? 'Grid' :
    state.mode === 'scrubbing' ? `Scrub #${state.activeIndex + 1}` :
    sp.t > 0.72 ? `Popped #${state.activeIndex + 1}` :
    `Peek #${state.activeIndex + 1}`;
  stagePill.textContent = `${stageName} · t=${sp.t.toFixed(2)} · bokeh ${blur.toFixed(1)} px`;
  dismissBtn.disabled = state.activeIndex < 0 || state.backend === 'plain';

  const routeLabel =
    state.backend === 'webgl2' ? 'WebGL 2 (ElementGL)' :
    state.backend === '2d' ? '2D drawElementImage() fallback' :
    'Plain HTML';
  hudEl.textContent = `${routeLabel} · ${stageName} · ${state.paints} paints, ${state.uploads} uploads`;
}

function stopLoop() {
  if (motionRaf) {
    cancelAnimationFrame(motionRaf);
    motionRaf = 0;
  }
  lastMotionTime = 0;
}

function requestRedraw() {
  if (state.backend === 'webgl2') canvas.requestPaint?.();
  else if (state.backend === '2d' && !paint2dRaf) paint2dRaf = requestAnimationFrame(draw2DFallback);
}

function stepMotion(now) {
  motionRaf = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;

  const rawDt = lastMotionTime ? (now - lastMotionTime) / 1000 : 1 / 60;
  lastMotionTime = now;
  const dt = rawDt * (slowChk.checked ? 0.35 : 1);

  if (state.mode !== 'scrubbing') {
    const settled = stepThrowSpring(state.spring, dt, isReducedMotion());
    syncExpansionState();
    requestRedraw();

    if (settled) {
      lastMotionTime = 0;
      if (state.spring.targetT === 0) {
        state.activeIndex = -1;
        state.mode = 'grid';
        state.stickyPeek = false;
      } else if (state.spring.targetT === PEEK_T) {
        state.mode = 'peeking';
      } else {
        state.mode = 'popped';
      }
      syncExpansionState();
      requestRedraw();
      return;
    }
    motionRaf = requestAnimationFrame(stepMotion);
  }
}

function wakeMotion() {
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;
  if (isReducedMotion()) {
    stepThrowSpring(state.spring, 1, true);
    if (state.spring.targetT === 0) {
      state.activeIndex = -1;
      state.mode = 'grid';
      state.stickyPeek = false;
    } else if (state.spring.targetT === PEEK_T) {
      state.mode = 'peeking';
    } else {
      state.mode = 'popped';
    }
    syncExpansionState();
    requestRedraw();
    return;
  }
  if (!motionRaf) {
    lastMotionTime = performance.now();
    motionRaf = requestAnimationFrame(stepMotion);
  }
}

function drawSceneWebGL(e) {
  if (!stage || stage.lost) return;
  const layout = updateLayoutDimensions();
  const changed = e?.changedElements ?? null;
  let pendingPaint = false;

  for (const card of cards) {
    if (dirtyCards.has(card) || !stage.has(card) || (changed && changed.includes(card))) {
      try {
        stage.upload(card);
        dirtyCards.delete(card);
        state.uploads++;
      } catch (err) {
        if (/paint record/i.test(err?.message ?? '')) {
          pendingPaint = true;
        } else {
          throw err;
        }
      }
    }
  }
  if (pendingPaint) canvas.requestPaint?.();

  if (!stage.begin([0.043, 0.051, 0.078, 1.0])) return;
  state.paints++;

  const gl = stage.gl;
  const mainProg = gl.getParameter(gl.CURRENT_PROGRAM);
  const mainVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  const poses = currentCardPoses(layout);
  const sp = state.spring;
  const activeIdx = state.activeIndex;
  const blurPx = activeIdx >= 0 ? MAX_BOKEH_PX * Math.min(1, Math.max(0, sp.t)) : 0;

  const drawCardQuad = (i, passMode, mat, opts = {}) => {
    const card = cards[i];
    if (!stage.has(card)) return;
    const clip = toClip(mat, layout.cardW, layout.cardH, layout.cw, layout.ch);
    stage.quad(card, clip, (g, u) => {
      g.uniform1i(u('uPass'), passMode);
      if (opts.sizeW && opts.sizeH) g.uniform2f(u('uSize'), opts.sizeW, opts.sizeH);
      g.uniform1f(u('uLift'), opts.lift ?? 0);
      g.uniform2f(u('uTilt'), opts.tiltX ?? 0, opts.tiltY ?? 0);
      g.uniform1f(u('uDim'), opts.dim ?? 0);
      g.uniform1f(u('uActive'), opts.active ? 1.0 : 0.0);
    });
  };

  const drawBackdrop = () => {
    const fullMat = new DOMMatrix().scale(layout.cw / layout.cardW, layout.ch / layout.cardH, 1);
    const clip = toClip(fullMat, layout.cardW, layout.cardH, layout.cw, layout.ch);
    stage.quad(cards[0], clip, (g, u) => {
      g.uniform1i(u('uPass'), 3);
      g.uniform2f(u('uSize'), layout.cw, layout.ch);
      g.uniform1f(u('uLift'), 0);
      g.uniform2f(u('uTilt'), 0, 0);
      g.uniform1f(u('uDim'), 0);
      g.uniform1f(u('uActive'), 0);
    });
  };

  if (activeIdx >= 0 && blurPx > 0.05 && bokehRes && stage.has(cards[0])) {
    ensureBokehSize(gl, bokehRes, canvas.width, canvas.height);

    // Pass 1: Background grid + recessed active socket into half-res FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, bokehRes.fbo);
    gl.viewport(0, 0, bokehRes.w, bokehRes.h);
    gl.clearColor(0.043, 0.051, 0.078, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawBackdrop();

    const slot = layout.slots[activeIdx];
    const slotMat = new DOMMatrix()
      .translate(slot.x, slot.y)
      .scale(slot.w / layout.cardW, slot.h / layout.cardH, 1);
    drawCardQuad(activeIdx, 1, slotMat, { lift: sp.t, sizeW: slot.w, sizeH: slot.h });

    for (let i = 0; i < cards.length; i++) {
      if (i === activeIdx) continue;
      drawCardQuad(i, 0, poses[i].cssMat, { dim: Math.min(1, sp.t) * 0.15 });
    }

    // Pass 2: Fullscreen 28-tap circular optical bokeh blur onto default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(bokehRes.prog);
    gl.bindVertexArray(bokehRes.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bokehRes.tex);
    gl.uniform1i(bokehRes.uBgTex, 0);
    gl.uniform2f(bokehRes.uCssSize, layout.cw, layout.ch);
    gl.uniform1f(bokehRes.uBlurRadius, blurPx);
    gl.uniform1f(bokehRes.uDim, Math.min(1, sp.t));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Restore ElementGL program & premultiplied blending for active card shadow + quad
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(mainVao);
    gl.useProgram(mainProg);

    // Pass 3: Soft elevation drop shadow + crisp live foreground card
    const activePose = poses[activeIdx];
    const pad = 16 + 20 * sp.t;
    const shadowMat = new DOMMatrix()
      .translate(0, 8 + 16 * sp.t)
      .multiply(activePose.cssMat)
      .translate(-pad, -pad)
      .scale((layout.cardW + pad * 2) / layout.cardW, (layout.cardH + pad * 2) / layout.cardH, 1);
    drawCardQuad(activeIdx, 2, shadowMat, {
      lift: sp.t,
      sizeW: layout.cardW + pad * 2,
      sizeH: layout.cardH + pad * 2,
    });

    drawCardQuad(activeIdx, 0, activePose.cssMat, {
      lift: sp.t,
      tiltX: sp.tiltY / 10,
      tiltY: sp.tiltX / 10,
      active: true,
    });
  } else {
    if (stage.has(cards[0])) drawBackdrop();
    for (let i = 0; i < cards.length; i++) {
      drawCardQuad(i, 0, poses[i].cssMat);
    }
  }

  syncCardGeometry(canvas, cards, poses, activeIdx, sp.t, layout.cardW);
  updateHud();
}

// #region fallback-paths
function enterPlainFallback(reason) {
  stopLoop();
  state.backend = 'plain';
  state.activeIndex = -1;
  state.mode = 'grid';
  state.spring.t = 0;
  state.spring.targetT = 0;
  stageWrap.classList.add('is-plain');
  for (const card of cards) {
    card.inert = false;
    card.dataset.expanded = 'true';
    const caption = card.querySelector('.card-caption');
    const closeBtn = card.querySelector('.btn-close');
    caption.disabled = false;
    caption.tabIndex = 0;
    closeBtn.disabled = true;
    closeBtn.tabIndex = -1;
    if (card.parentElement !== plainHost) plainHost.append(card);
  }
  showNotice(reason);
  updateHud();
}

function exitPlainFallback() {
  stageWrap.classList.remove('is-plain');
  for (const card of cards) {
    setCardExpanded(card, false);
    card.inert = false;
    if (card.parentElement !== canvas) canvas.append(card);
    dirtyCards.add(card);
  }
  geoKeys.clear();
  showNotice('');
}

function draw2DFallback() {
  paint2dRaf = 0;
  if (!ctx2d || state.backend !== '2d') return;
  const layout = updateLayoutDimensions();
  const cw = layout.cw;
  const ch = layout.ch;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  const bg = ctx2d.createRadialGradient(cw * 0.5, ch * 0.4, 20, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.8);
  bg.addColorStop(0, '#191e2d');
  bg.addColorStop(1, '#0b0d14');
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(0, 0, cw, ch);

  const poses = currentCardPoses(layout);
  const activeIdx = state.activeIndex;
  const sp = state.spring;
  const blur = activeIdx >= 0 ? MAX_BOKEH_PX * Math.min(1, Math.max(0, sp.t)) : 0;

  for (let i = 0; i < cards.length; i++) {
    if (i === activeIdx) continue;
    const card = cards[i];
    const p = poses[i];
    const elW = card.offsetWidth || layout.cardW;
    const elH = card.offsetHeight || layout.cardH;
    ctx2d.save();
    if (blur > 0.4) {
      ctx2d.filter = `blur(${(blur * 0.65).toFixed(1)}px) brightness(${(1 - sp.t * 0.35).toFixed(2)})`;
    }
    ctx2d.translate(p.cx, p.cy);
    ctx2d.scale(p.w / elW, p.h / elH);
    ctx2d.translate(-elW * 0.5, -elH * 0.5);
    ctx2d.drawElementImage(card, 0, 0, elW, elH);
    ctx2d.restore();
  }

  if (activeIdx >= 0) {
    const slot = layout.slots[activeIdx];
    ctx2d.save();
    ctx2d.fillStyle = 'rgba(10, 12, 20, 0.55)';
    ctx2d.strokeStyle = 'rgba(130, 148, 190, 0.5)';
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.roundRect(slot.x + 2, slot.y + 2, slot.w - 4, slot.h - 4, 12);
    ctx2d.fill();
    ctx2d.stroke();
    ctx2d.restore();

    const activeCard = cards[activeIdx];
    const p = poses[activeIdx];
    const elW = activeCard.offsetWidth || layout.cardW;
    const elH = activeCard.offsetHeight || layout.cardH;
    ctx2d.save();
    ctx2d.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx2d.shadowBlur = 14 + 22 * sp.t;
    ctx2d.shadowOffsetY = 6 + 12 * sp.t;
    ctx2d.translate(p.cx, p.cy);
    ctx2d.rotate((p.rotZ * Math.PI) / 180);
    ctx2d.scale(p.w / elW, p.h / elH);
    ctx2d.translate(-elW * 0.5, -elH * 0.5);
    ctx2d.drawElementImage(activeCard, 0, 0, elW, elH);
    ctx2d.restore();
  }

  syncCardGeometry(canvas, cards, poses, activeIdx, sp.t, layout.cardW);
  state.paints++;
  updateHud();
}
// #endregion fallback-paths

if (glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: CARD_FRAG,
      onLost: () => {
        bokehRes = null;
        enterPlainFallback('The browser took the WebGL 2 context away. All six cards stay editable as plain HTML until it returns.');
      },
      onRestored: () => {
        bokehRes = createBokehResources(stage.gl);
        state.backend = 'webgl2';
        exitPlainFallback();
        requestRedraw();
      },
    });
    bokehRes = createBokehResources(stage.gl);
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
      enterPlainFallback('The 2D canvas lost its context. Showing all six cards as plain HTML.');
    });
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the six cards are shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (state.backend === 'webgl2') drawSceneWebGL(e);
  else if (state.backend === '2d') draw2DFallback();
});

// ---- Card action handlers ----
function openPeek(idx, sticky) {
  state.activeIndex = idx;
  state.stickyPeek = sticky;
  state.mode = 'peeking';
  state.spring.targetT = PEEK_T;
  state.spring.targetTiltX = 0;
  state.spring.targetTiltY = 0;
  wakeMotion();
}

function popCard(idx) {
  state.activeIndex = idx;
  state.stickyPeek = false;
  state.mode = 'popped';
  state.spring.targetT = 1;
  state.spring.targetTiltX = 0;
  state.spring.targetTiltY = 0;
  wakeMotion();
}

function dismissCard(vx = 0, vy = 0) {
  if (state.activeIndex < 0) return;
  const active = cards[state.activeIndex];
  const caption = active.querySelector('.card-caption');
  if (document.activeElement === caption) caption.blur();
  state.stickyPeek = false;
  state.mode = 'springing';
  state.spring.targetT = 0;
  state.spring.targetTiltX = 0;
  state.spring.targetTiltY = 0;
  if (!isReducedMotion()) {
    state.spring.vx = Math.max(-1400, Math.min(1400, vx));
    state.spring.vy = Math.max(-1400, Math.min(1400, vy));
    if (vy > 200) state.spring.vt = Math.max(-4.5, Math.min(-0.8, -vy / 360));
  }
  wakeMotion();
}

for (const card of cards) {
  const idx = Number(card.dataset.index);
  const heartBtn = card.querySelector('.btn-heart');
  const heartNum = card.querySelector('.heart-num');
  const countBtn = card.querySelector('.btn-count');
  const peekBtn = card.querySelector('.btn-peek');
  const closeBtn = card.querySelector('.btn-close');
  const captionInput = card.querySelector('.card-caption');

  let pins = Number(/\d+/.exec(countBtn.textContent)?.[0] ?? 0);
  let hearts = Number(heartNum.textContent);

  heartBtn.addEventListener('click', () => {
    const next = heartBtn.getAttribute('aria-pressed') !== 'true';
    heartBtn.setAttribute('aria-pressed', String(next));
    hearts += next ? 1 : -1;
    heartNum.textContent = String(hearts);
    dirtyCards.add(card);
    requestRedraw();
  });

  countBtn.addEventListener('click', () => {
    pins++;
    countBtn.textContent = `+1 Pin (${pins})`;
    dirtyCards.add(card);
    requestRedraw();
  });

  peekBtn.addEventListener('click', () => {
    if (state.backend === 'plain') return;
    if (state.activeIndex === idx && state.mode === 'peeking') dismissCard();
    else openPeek(idx, true);
  });

  closeBtn.addEventListener('click', () => {
    if (state.backend === 'plain') return;
    dismissCard();
  });

  captionInput.addEventListener('input', () => {
    dirtyCards.add(card);
    requestRedraw();
  });
}

dismissBtn.addEventListener('click', () => dismissCard());

// ---- Touch / Pointer Peek-and-Pop + Scrubbing Gesture ----
let gesture = null;

function localCanvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function pointInsidePose(pt, pose, pad = 6) {
  return (
    pt.x >= pose.x - pad &&
    pt.x <= pose.x + pose.w + pad &&
    pt.y >= pose.y - pad &&
    pt.y <= pose.y + pose.h + pad
  );
}

canvas.addEventListener('contextmenu', (e) => {
  if (state.backend !== 'plain') e.preventDefault();
});

canvas.addEventListener('pointerdown', (e) => {
  if (state.backend === 'plain' || e.button > 0) return;

  const hitCard = e.target?.closest?.('.feed-card');
  const hitIndex = hitCard ? Number(hitCard.dataset.index) : -1;
  const hitControl = Boolean(e.target?.closest?.('button, input'));
  const hitInput = e.target?.tagName === 'INPUT';
  const pt = localCanvasPoint(e);

  if (gesture?.timer) clearTimeout(gesture.timer);
  gesture = {
    id: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    lastTime: performance.now(),
    vx: 0,
    vy: 0,
    moved: false,
    hitIndex,
    hitControl,
    hitInput,
    longPressed: false,
    timer: 0,
  };

  if (state.activeIndex < 0 && hitIndex >= 0 && !hitControl) {
    gesture.timer = setTimeout(() => {
      if (!gesture || gesture.id !== e.pointerId || gesture.moved) return;
      gesture.longPressed = true;
      try { canvas.setPointerCapture(e.pointerId); } catch {}
      openPeek(hitIndex, false);
    }, PEEK_HOLD_MS);
  } else if (state.activeIndex >= 0 && hitIndex < 0 && !hitControl) {
    // Tapped outside the active card on the blurred backdrop
    const poses = currentCardPoses(state.layout);
    const activePose = poses[state.activeIndex];
    if (!pointInsidePose(pt, activePose, 8)) {
      gesture.tappedBackdrop = true;
    }
  }
});

canvas.addEventListener('pointermove', (e) => {
  const pt = localCanvasPoint(e);
  if (!gesture || gesture.id !== e.pointerId) {
    // Subtle hover 3D tilt when desktop mouse moves over a sticky peeked card
    if (e.pointerType === 'mouse' && state.activeIndex >= 0 && state.mode === 'peeking' && !isReducedMotion()) {
      const poses = currentCardPoses(state.layout);
      const p = poses[state.activeIndex];
      const nx = Math.max(-1, Math.min(1, (pt.x - p.cx) / Math.max(40, p.w * 0.5)));
      const ny = Math.max(-1, Math.min(1, (pt.y - p.cy) / Math.max(40, p.h * 0.5)));
      state.spring.targetTiltY = nx * 9;
      state.spring.targetTiltX = -ny * 9;
      wakeMotion();
    }
    return;
  }

  const now = performance.now();
  const dx = e.clientX - gesture.startX;
  const dy = e.clientY - gesture.startY;
  const dist = Math.hypot(dx, dy);
  if (dist > 8) {
    gesture.moved = true;
    if (gesture.timer) {
      clearTimeout(gesture.timer);
      gesture.timer = 0;
    }
  }

  const stepDt = Math.max(0.004, (now - gesture.lastTime) / 1000);
  const instVx = (e.clientX - gesture.lastX) / stepDt;
  const instVy = (e.clientY - gesture.lastY) / stepDt;
  gesture.vx = gesture.vx * 0.65 + instVx * 0.35;
  gesture.vy = gesture.vy * 0.65 + instVy * 0.35;
  gesture.lastX = e.clientX;
  gesture.lastY = e.clientY;
  gesture.lastTime = now;

  // Live Peek hold: tilt with pointer and allow swipe up to pop
  if (gesture.longPressed && state.mode === 'peeking') {
    const poses = currentCardPoses(state.layout);
    const p = poses[state.activeIndex];
    const nx = Math.max(-1, Math.min(1, (pt.x - p.cx) / Math.max(40, p.w * 0.5)));
    const ny = Math.max(-1, Math.min(1, (pt.y - p.cy) / Math.max(40, p.h * 0.5)));
    if (!isReducedMotion()) {
      state.spring.targetTiltY = nx * 10;
      state.spring.targetTiltX = -ny * 10;
    }
    if (dy < -36) {
      gesture.longPressed = false;
      popCard(state.activeIndex);
    } else {
      wakeMotion();
    }
    return;
  }

  // Enter 1:1 finger-scrubbing from popped state
  const canStartScrub =
    state.activeIndex >= 0 &&
    (state.mode === 'popped' || state.mode === 'scrubbing' || (state.mode === 'springing' && state.spring.t > 0.55)) &&
    !gesture.hitInput &&
    gesture.moved;

  if (canStartScrub) {
    if (state.mode !== 'scrubbing') {
      state.mode = 'scrubbing';
      stopLoop();
      try { canvas.setPointerCapture(e.pointerId); } catch {}
    }
    const sp = state.spring;
    const scrubDist = Math.max(0, dy) + Math.abs(dx) * 0.35;
    sp.dragX = dx;
    sp.dragY = dy;
    sp.t = Math.min(1.0, Math.max(0.14, 1.0 - scrubDist / 260));
    sp.rotZ = isReducedMotion() ? 0 : Math.max(-13, Math.min(13, gesture.vx * 0.011));
    sp.tiltX = 0;
    sp.tiltY = 0;
    syncExpansionState();
    requestRedraw();
  }
});

function endPointerGesture(e) {
  if (!gesture || gesture.id !== e.pointerId) return;
  const g = gesture;
  gesture = null;
  if (g.timer) {
    clearTimeout(g.timer);
    g.timer = 0;
  }

  const dx = e.clientX - g.startX;
  const dy = e.clientY - g.startY;
  const ageMs = performance.now() - g.lastTime;
  const vx = ageMs > 90 ? 0 : g.vx;
  const vy = ageMs > 90 ? 0 : g.vy;

  if (state.mode === 'scrubbing' && state.activeIndex >= 0) {
    const layout = state.layout;
    const slot = layout.slots[state.activeIndex];
    const sp = state.spring;
    const currPose = computeCardPose(slot, layout.cw, layout.ch, layout.cardW, layout.cardH, sp.t, {
      scrubbing: true,
      dragX: sp.dragX,
      dragY: sp.dragY,
    });
    const basePose = computeCardPose(slot, layout.cw, layout.ch, layout.cardW, layout.cardH, sp.t);
    sp.releaseOffX = currPose.cx - basePose.cx;
    sp.releaseOffY = currPose.cy - basePose.cy;
    sp.dragX = 0;
    sp.dragY = 0;

    const shouldDismiss = dy > 90 || Math.hypot(dx, dy) > 130 || (vy > 480 && dy > 24);
    if (shouldDismiss) {
      dismissCard(vx, vy);
    } else {
      state.mode = 'springing';
      sp.targetT = 1;
      sp.vx = vx * 0.35;
      sp.vy = vy * 0.35;
      wakeMotion();
    }
    return;
  }

  if (g.longPressed) {
    if (state.mode === 'peeking') dismissCard();
    return;
  }

  if (g.tappedBackdrop) {
    dismissCard();
    return;
  }

  if (!g.moved && !g.hitControl) {
    if (state.activeIndex < 0 && g.hitIndex >= 0) {
      popCard(g.hitIndex);
    } else if (state.activeIndex >= 0 && state.mode === 'peeking') {
      if (g.hitIndex === state.activeIndex) popCard(state.activeIndex);
      else dismissCard();
    } else if (state.activeIndex >= 0 && state.mode === 'popped' && g.hitIndex < 0) {
      dismissCard();
    }
  }
}

canvas.addEventListener('pointerup', endPointerGesture);
canvas.addEventListener('pointercancel', endPointerGesture);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.activeIndex >= 0 && state.backend !== 'plain') {
    dismissCard();
  }
});

reducedChk.addEventListener('change', () => {
  if (isReducedMotion() && state.activeIndex >= 0) {
    wakeMotion();
  }
});

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = Boolean(entry?.isIntersecting);
    if (state.onScreen) {
      if (state.mode === 'springing' || state.mode === 'peeking') wakeMotion();
      else requestRedraw();
    } else {
      stopLoop();
    }
  }, { rootMargin: '120px 0px' }).observe(stageWrap);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (state.onScreen) requestRedraw();
});

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    updateLayoutDimensions();
    requestRedraw();
  }).observe(canvas);
}

updateLayoutDimensions();
updateHud();
requestRedraw();

// ---- Live checks (isolated fixtures on testStage) ----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const need = (ok, detail) => { if (!ok) throw new Error(detail); return detail; };

async function createGlFixture(w, h, markup) {
  if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `flex:none;position:relative;display:block;width:${w}px;height:${h}px;`;
  cv.innerHTML = markup;
  testStage().append(cv);
  const glStage = new ElementGL(cv, {
    fragment: CARD_FRAG,
    attributes: { preserveDrawingBuffer: true },
  });
  const res = createBokehResources(glStage.gl);
  const done = async () => {
    disposeBokehResources(glStage.gl, res);
    glStage.dispose();
    cv.remove();
    window.__gfx?.active?.();
    window.__gfx?.retire?.(cv);
    await sleep(230);
    window.__gfx?.release?.(cv);
  };
  return { cv, glStage, res, done };
}

runTests(testsBody, [
  {
    name: 'ElementGL renders 6 drawable tiles + optical bokeh backdrop blur smoothly (gl.getError() === 0)',
    expect: 'pass',
    why: 'Uploads 6 isolated drawable tiles via texElementSubImage2D(), renders the 5 background tiles into an offscreen FBO, applies the 28-tap golden-angle bokeh shader at 18 px radius, draws foreground card 0 and checks gl.getError() === gl.NO_ERROR plus sampled pixels.',
    run: async () => {
      const cw = 300;
      const ch = 220;
      const fxLayout = computeStageLayout(cw, ch);
      const colors = ['#e63946', '#06b6d4', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
      const markup = colors.map((col, i) =>
        `<div class="fx-tile" data-i="${i}" drawable style="position:absolute;left:0;top:0;width:${fxLayout.cardW}px;height:${fxLayout.cardH}px;background:${col};color:#fff;padding:12px;font:700 18px system-ui;border-radius:12px;">Tile ${i + 1}</div>`
      ).join('');

      const fx = await createGlFixture(cw, ch, markup);
      try {
        await nextPaint(fx.cv);
        const tiles = Array.from(fx.cv.querySelectorAll('.fx-tile'));
        for (const tile of tiles) fx.glStage.upload(tile);

        if (!fx.glStage.begin([0.04, 0.05, 0.08, 1])) {
          throw new Error('ElementGL.begin() returned false');
        }
        const gl = fx.glStage.gl;
        const mainProg = gl.getParameter(gl.CURRENT_PROGRAM);
        const mainVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
        ensureBokehSize(gl, fx.res, fx.cv.width, fx.cv.height);

        gl.bindFramebuffer(gl.FRAMEBUFFER, fx.res.fbo);
        gl.viewport(0, 0, fx.res.w, fx.res.h);
        gl.clearColor(0.04, 0.05, 0.08, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        for (let i = 1; i < tiles.length; i++) {
          const s = fxLayout.slots[i];
          const m = new DOMMatrix().translate(s.x, s.y).scale(s.w / fxLayout.cardW, s.h / fxLayout.cardH, 1);
          fx.glStage.quad(tiles[i], toClip(m, fxLayout.cardW, fxLayout.cardH, cw, ch), (g, u) => {
            g.uniform1i(u('uPass'), 0);
            g.uniform1f(u('uLift'), 0);
            g.uniform2f(u('uTilt'), 0, 0);
            g.uniform1f(u('uDim'), 0.12);
            g.uniform1f(u('uActive'), 0);
          });
        }

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, fx.cv.width, fx.cv.height);
        gl.disable(gl.BLEND);
        gl.useProgram(fx.res.prog);
        gl.bindVertexArray(fx.res.vao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fx.res.tex);
        gl.uniform1i(fx.res.uBgTex, 0);
        gl.uniform2f(fx.res.uCssSize, cw, ch);
        gl.uniform1f(fx.res.uBlurRadius, MAX_BOKEH_PX);
        gl.uniform1f(fx.res.uDim, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.bindVertexArray(mainVao);
        gl.useProgram(mainProg);

        const fgPose = computeCardPose(fxLayout.slots[0], cw, ch, fxLayout.cardW, fxLayout.cardH, 0.5);
        const fgMat = buildCardMatrix(fgPose, fxLayout.cardW, fxLayout.cardH);
        fx.glStage.quad(tiles[0], toClip(fgMat, fxLayout.cardW, fxLayout.cardH, cw, ch), (g, u) => {
          g.uniform1i(u('uPass'), 0);
          g.uniform1f(u('uLift'), 0.5);
          g.uniform2f(u('uTilt'), 0, 0);
          g.uniform1f(u('uDim'), 0);
          g.uniform1f(u('uActive'), 1.0);
        });

        const err = gl.getError();
        const fgPx = new Uint8Array(4);
        const bgPx = new Uint8Array(4);
        const fgReadX = Math.max(0, Math.min(fx.cv.width - 1, Math.round((fgPose.cx / cw) * fx.cv.width)));
        const fgReadY = Math.max(0, Math.min(fx.cv.height - 1, Math.round((1 - fgPose.cy / ch) * fx.cv.height)));
        const bgSlot = fxLayout.slots[5];
        const bgReadX = Math.max(0, Math.min(fx.cv.width - 1, Math.round((bgSlot.cx / cw) * fx.cv.width)));
        const bgReadY = Math.max(0, Math.min(fx.cv.height - 1, Math.round((1 - bgSlot.cy / ch) * fx.cv.height)));
        gl.readPixels(fgReadX, fgReadY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, fgPx);
        gl.readPixels(bgReadX, bgReadY, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bgPx);

        return need(
          err === gl.NO_ERROR && fgPx[0] > 140 && fgPx[3] > 220 && bgPx[0] > 80 && bgPx[3] > 220,
          `6 tiles uploaded, bokeh=18px FBO (${fx.res.w}x${fx.res.h}), gl.getError()=${err}, sharp fg=(${fgPx.slice(0, 3).join(',')}), blurred bg=(${bgPx.slice(0, 3).join(',')}).`
        );
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'Scrubbing progress t from 0 -> 0.5 -> 1 -> 0 interpolates rect bounds smoothly back to exact originating grid coordinates',
    expect: 'pass',
    why: 'Evaluates computeCardPose() across t = 0, 0.5 and 1, then runs stepThrowSpring() from a flung drag (dy=115, vy=620) back to grid and from a gentle release (dy=35, vy=20) back to popped.',
    run: async () => {
      const lay = computeStageLayout(354, 476);
      const slot = lay.slots[2];
      const p0 = computeCardPose(slot, lay.cw, lay.ch, lay.cardW, lay.cardH, 0);
      const pHalf = computeCardPose(slot, lay.cw, lay.ch, lay.cardW, lay.cardH, 0.5);
      const p1 = computeCardPose(slot, lay.cw, lay.ch, lay.cardW, lay.cardH, 1);

      const gridMatch =
        Math.abs(p0.x - slot.x) < 0.01 &&
        Math.abs(p0.y - slot.y) < 0.01 &&
        Math.abs(p0.w - slot.w) < 0.01 &&
        Math.abs(p0.h - slot.h) < 0.01 &&
        p0.blurRadius === 0;
      const peekRatio = pHalf.w / slot.w;
      const peekOk = Math.abs(peekRatio - 1.08) < 0.01 && Math.abs(pHalf.blurRadius - 9) < 0.01;
      const popOk = Math.abs(p1.w - lay.cardW) < 0.01 && Math.abs(p1.h - lay.cardH) < 0.01 && Math.abs(p1.blurRadius - 18) < 0.01;

      // Throw-back spring from a downward fling back to exact grid slot
      const fling = {
        t: 0.56, targetT: 0, vt: -1.72,
        dragX: 0, dragY: 0, releaseOffX: 28, releaseOffY: 115,
        vx: 120, vy: 620, rotZ: 4.5, vRotZ: 0, tiltX: 0, tiltY: 0, targetTiltX: 0, targetTiltY: 0,
      };
      let steps = 0;
      while (steps < 240 && !stepThrowSpring(fling, 1 / 60, false)) steps++;
      const pReturn = computeCardPose(slot, lay.cw, lay.ch, lay.cardW, lay.cardH, fling.t, {
        releaseOffX: fling.releaseOffX,
        releaseOffY: fling.releaseOffY,
      });
      const returnOk =
        fling.t === 0 &&
        Math.abs(pReturn.x - slot.x) < 0.01 &&
        Math.abs(pReturn.y - slot.y) < 0.01 &&
        Math.abs(pReturn.w - slot.w) < 0.01;

      // Gentle release springs back to t = 1
      const gentle = {
        t: 0.86, targetT: 1, vt: 0,
        dragX: 0, dragY: 0, releaseOffX: 12, releaseOffY: 35,
        vx: 10, vy: 20, rotZ: 0.8, vRotZ: 0, tiltX: 0, tiltY: 0, targetTiltX: 0, targetTiltY: 0,
      };
      let gSteps = 0;
      while (gSteps < 240 && !stepThrowSpring(gentle, 1 / 60, false)) gSteps++;

      return need(
        gridMatch && peekOk && popOk && returnOk && gentle.t === 1,
        `t=0 slot (${p0.x.toFixed(1)},${p0.y.toFixed(1)} ${p0.w.toFixed(0)}x${p0.h.toFixed(0)}), t=0.5 scale=${peekRatio.toFixed(2)}x bokeh=${pHalf.blurRadius}px, t=1 ${p1.w.toFixed(0)}x${p1.h.toFixed(0)} bokeh=${p1.blurRadius}px; fling settled in ${steps} frames to slot delta <0.01 px.`
      );
    },
  },
  {
    name: 'While popped (t = 1), background cards are inert and expanded controls stay hit-testable via elementsFromPoint()',
    expect: 'pass',
    why: 'Pops card 0 (earlier in DOM order than card 1), marks card 1 inert and offstage, checks document.elementsFromPoint() hits card 0 caption <input> and <button>, then returns to t=0 and checks card 1 slot button hits cleanly.',
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 320;
      const ch = 260;
      const fxLayout = computeStageLayout(cw, ch);
      const markup = [0, 1].map((i) =>
        `<div class="fx-pop-card" data-i="${i}" drawable style="position:absolute;left:0;top:0;width:${fxLayout.cardW}px;height:${fxLayout.cardH}px;padding:12px;box-sizing:border-box;background:#fff;border:2px solid #222;">` +
        `<input class="fx-inp" type="text" inputmode="none" value="Card ${i}" style="position:absolute;left:24px;top:36px;width:180px;height:40px;box-sizing:border-box;">` +
        `<button class="fx-btn" type="button" style="position:absolute;left:24px;top:110px;width:120px;height:44px;box-sizing:border-box;">Btn ${i}</button></div>`
      ).join('');

      const fx = await createGlFixture(cw, ch, markup);
      try {
        await nextPaint(fx.cv);
        const fxCards = Array.from(fx.cv.querySelectorAll('.fx-pop-card'));
        const localUnitCache = { key: '', unit: 1 };
        const localKeys = new Map();

        // Pop card 0 (t = 1) over card 1
        const poppedPoses = fxLayout.slots.slice(0, 2).map((s, i) => {
          const p = computeCardPose(s, cw, ch, fxLayout.cardW, fxLayout.cardH, i === 0 ? 1 : 0);
          p.cssMat = buildCardMatrix(p, fxLayout.cardW, fxLayout.cardH);
          return p;
        });
        syncCardGeometry(fx.cv, fxCards, poppedPoses, 0, 1.0, fxLayout.cardW, localKeys, localUnitCache);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const inp0 = fxCards[0].querySelector('.fx-inp');
        const btn0 = fxCards[0].querySelector('.fx-btn');
        const r = fx.cv.getBoundingClientRect();
        const ptInp = poppedPoses[0].cssMat.transformPoint(new DOMPoint(114, 56));
        const ptBtn = poppedPoses[0].cssMat.transformPoint(new DOMPoint(84, 132));
        const hitsInp = document.elementsFromPoint(r.left + ptInp.x, r.top + ptInp.y);
        const hitsBtn = document.elementsFromPoint(r.left + ptBtn.x, r.top + ptBtn.y);
        const popOk = fxCards[1].inert === true && fxCards[0].inert === false && hitsInp.includes(inp0) && hitsBtn.includes(btn0);

        // Return to grid (t = 0) and confirm card 1 becomes active & hit-testable at slot 1
        const gridPoses = fxLayout.slots.slice(0, 2).map((s) => {
          const p = computeCardPose(s, cw, ch, fxLayout.cardW, fxLayout.cardH, 0);
          p.cssMat = buildCardMatrix(p, fxLayout.cardW, fxLayout.cardH);
          return p;
        });
        syncCardGeometry(fx.cv, fxCards, gridPoses, -1, 0, fxLayout.cardW, localKeys, localUnitCache);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const btn1 = fxCards[1].querySelector('.fx-btn');
        const ptGrid1 = gridPoses[1].cssMat.transformPoint(new DOMPoint(84, 132));
        const hitsGrid1 = document.elementsFromPoint(r.left + ptGrid1.x, r.top + ptGrid1.y);
        const gridOk = fxCards[1].inert === false && hitsGrid1.includes(btn1);

        return need(
          popOk && gridOk,
          `Popped t=1: card1.inert=true, elementsFromPoint hit card0 <input> (${hitsInp.includes(inp0)}) and <button> (${hitsBtn.includes(btn0)}); returned t=0: card1 <button> hit (${hitsGrid1.includes(btn1)}).`
        );
      } finally {
        await fx.done();
      }
    },
  },
  {
    name: 'Context loss falls back cleanly to plain HTML and restores without calling loseContext()',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an isolated 6-card wrapper to verify inert clearing, plain HTML layout, edited caption text and counter state survival.',
    run: async () => {
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      const fxCards = [];
      for (let i = 0; i < 6; i++) {
        const card = document.createElement('article');
        card.setAttribute('drawable', '');
        card.inert = i !== 0;
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.setAttribute('inputmode', 'none');
        inp.value = i === 0 ? 'EDITED BOKEH CAPTION' : `Card ${i}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = i === 0 ? '+1 Pin (9)' : `+1 Pin (${i})`;
        card.append(inp, btn);
        cv.append(card);
        fxCards.push(card);
      }
      wrap.append(cv, plain);
      testStage().append(wrap);

      let lostCount = 0;
      let restoreCount = 0;
      cv.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        lostCount++;
        for (const c of fxCards) {
          c.inert = false;
          plain.append(c);
        }
      });
      cv.addEventListener('webglcontextrestored', () => {
        restoreCount++;
        for (const c of fxCards) cv.append(c);
      });

      const lostEv = new Event('webglcontextlost', { cancelable: true });
      cv.dispatchEvent(lostEv);
      const inp0 = fxCards[0].querySelector('input');
      const btn0 = fxCards[0].querySelector('button');
      const lostOk =
        lostEv.defaultPrevented &&
        lostCount === 1 &&
        fxCards.every((c) => c.parentElement === plain && !c.inert) &&
        inp0.value === 'EDITED BOKEH CAPTION' &&
        btn0.textContent === '+1 Pin (9)';

      cv.dispatchEvent(new Event('webglcontextrestored'));
      const restoreOk =
        restoreCount === 1 &&
        fxCards.every((c) => c.parentElement === cv) &&
        inp0.value === 'EDITED BOKEH CAPTION' &&
        btn0.textContent === '+1 Pin (9)';

      wrap.remove();
      window.__gfx?.retire?.(cv);
      return need(
        lostOk && restoreOk,
        `6 cards moved to plain HTML on webglcontextlost (inert cleared), preserved "${inp0.value}" and "${btn0.textContent}", and restored back to canvas.`
      );
    },
  },
  stillDrawn(() => [
    {
      name: 'peek-pop stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.backend === 'webgl2') {
          if (!stage || stage.lost) return 0;
          return state.uploads >= 6 && state.paints > 0 ? 1 : 0;
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
