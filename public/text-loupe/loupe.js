import { banner, supported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit, cssZoom } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const wrap = $('loupe-wrap');
const canvas = $('loupe-canvas');
const card = $('loupe-card');
const editorialProse = $('editorial-prose');
const noteEditor = $('note-editor');
const caretBadge = $('caret-badge');
const statusEl = $('loupe-status');
const noticeEl = $('loupe-notice');

const modeBtns = [...document.querySelectorAll('[data-mode]')];
const zoomBtns = [...document.querySelectorAll('[data-zoom]')];
const shapeBtns = [...document.querySelectorAll('[data-shape]')];
const btnShowLoupe = $('btn-show-loupe');
const btnStepTarget = $('btn-step-target');
const swatchBtns = [...document.querySelectorAll('[data-theme-pick]')];
const btnWeight = $('btn-weight');

const THEMES = {
  paper: { paper: [251 / 255, 248 / 255, 241 / 255], accent: [210 / 255, 73 / 255, 31 / 255], dark: 0 },
  cobalt: { paper: [246 / 255, 249 / 255, 255 / 255], accent: [29 / 255, 92 / 255, 255 / 255], dark: 0 },
  ink: { paper: [23 / 255, 26 / 255, 32 / 255], accent: [255 / 255, 122 / 255, 77 / 255], dark: 1 },
};

const state = {
  backend: 'starting',
  mode: 'caret', // 'caret' | 'pointer' | 'scrub'
  showLoupe: true,
  zoom: 2.2,
  shape: 'pill', // 'pill' | 'round'
  theme: 'paper',
  weight: 'regular',
  targetX: 160,
  targetY: 220,
  loupeX: 160,
  loupeY: 162,
  loupeDrawX: 160,
  loupeDrawY: 162,
  targetSource: 'initial specimen',
  uploads: 0,
  texW: 0,
  texH: 0,
  onScreen: true,
  stepIndex: 0,
};

let stage = null;
let ctx2d = null;
let lastLiveTex = null;
let domDirty = true;
let mipDirty = true;
let hitTick = 0;
let lastGeomKey = '';
let lastCardHeight = 0;
let rafId = 0;
let lastFrameMs = 0;
let scrubbing = false;
let activePointerId = null;
let caretHasFocusOrEdit = false;
let specimenIdx = 58;
let mirrorEl = null;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// #region loupe-shader
const LOUPE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;
uniform vec2 uTarget;
uniform vec2 uLoupeCenter;
uniform vec2 uLoupeHalf;
uniform float uLoupeRadius;
uniform float uZoom;
uniform float uShowLoupe;
uniform float uBarrel;
uniform float uChroma;
uniform vec3 uAccent;
uniform vec3 uPaper;
uniform float uDark;

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 sampleCard(vec2 cssPt, vec2 dUdx, vec2 dUdy) {
  vec2 sz = max(uSize, vec2(1.0));
  vec2 uv = cssPt / sz;
  vec2 clamped = clamp(uv, 0.0005, 0.9995);
  vec4 texel = textureGrad(uTex, clamped, dUdx, dUdy);
  // uTex is premultiplied RGBA8; composite over uPaper and fade gracefully past card bounds.
  vec3 cardRgb = texel.rgb + uPaper * (1.0 - texel.a);
  float insideX = step(0.0, uv.x) * step(uv.x, 1.0);
  float insideY = step(0.0, uv.y) * step(uv.y, 1.0);
  return mix(uPaper, cardRgb, insideX * insideY);
}

void main() {
  vec2 p = vUv * uCanvasSize;
  vec2 texSize = max(uSize, vec2(1.0));
  vec2 dUdx = dFdx(p) / (texSize * max(uZoom, 1.0));
  vec2 dUdy = dFdy(p) / (texSize * max(uZoom, 1.0));

  vec4 baseSample = texture(uTex, vUv);
  vec3 baseCol = baseSample.rgb + uPaper * (1.0 - baseSample.a);

  if (uShowLoupe < 0.5) {
    outColor = vec4(clamp(baseCol, 0.0, 1.0), max(baseSample.a, 1.0));
    return;
  }

  // Faint target reticle and thin leader showing exact caret/touch coordinate below.
  vec2 td = p - uTarget;
  float rDist = length(td);
  float ring = (1.0 - smoothstep(0.6, 1.4, abs(rDist - 6.5))) * 0.52;
  float dotCenter = (1.0 - smoothstep(1.2, 2.1, rDist)) * 0.65;
  float tickH = (1.0 - smoothstep(0.45, 1.1, abs(td.y))) * step(8.2, abs(td.x)) * step(abs(td.x), 12.2) * 0.45;
  float tickV = (1.0 - smoothstep(0.45, 1.1, abs(td.x))) * step(8.2, abs(td.y)) * step(abs(td.y), 12.2) * 0.45;
  float loupeBottom = uLoupeCenter.y + uLoupeHalf.y;
  float leader = 0.0;
  if (loupeBottom < uTarget.y - 13.0) {
    leader = (1.0 - smoothstep(0.4, 1.1, abs(p.x - uTarget.x))) *
             smoothstep(loupeBottom + 1.0, loupeBottom + 5.0, p.y) *
             (1.0 - smoothstep(uTarget.y - 12.0, uTarget.y - 8.0, p.y)) * 0.24;
  }
  float reticleAlpha = clamp(max(max(ring, dotCenter), max(tickH, max(tickV, leader))), 0.0, 0.72);
  vec3 col = mix(baseCol, uAccent, reticleAlpha);

  // Loupe SDF in CSS pixels around uLoupeCenter.
  vec2 d = p - uLoupeCenter;
  float sd = sdRoundBox(d, uLoupeHalf, uLoupeRadius);
  float aa = max(0.7, fwidth(sd));
  float loupeMask = 1.0 - smoothstep(-aa, aa, sd);

  // Warm floating drop-shadow cast onto the surface below the glass.
  float sdShadow = sdRoundBox(d - vec2(0.0, 6.5), uLoupeHalf + vec2(1.0), uLoupeRadius + 1.0);
  float shadowAmt = (exp(-max(sdShadow, 0.0) * 0.145) * 0.26 + smoothstep(12.0, 0.0, sdShadow) * 0.07) * (1.0 - loupeMask);
  vec3 shadowTint = mix(vec3(0.95, 0.96, 1.0), vec3(1.0), uDark);
  col *= (1.0 - shadowAmt * shadowTint);

  if (loupeMask > 0.001) {
    float depthIn = max(0.0, -sd);
    float minHalf = max(min(uLoupeHalf.x, uLoupeHalf.y), 1.0);
    vec2 u = d / max(uLoupeHalf, vec2(1.0));
    float rNorm = clamp(length(u), 0.0, 1.0);
    float edgeNorm = clamp(1.0 - depthIn / minHalf, 0.0, 1.0);
    float curv = mix(rNorm, edgeNorm, 0.45);

    // Spherical radial barrel lensing toward the glass bevel rim + edge chromatic RGB dispersion.
    float barrelScale = 1.0 - uBarrel * (curv * curv);
    vec2 lensOffset = d * barrelScale;
    float ca = uChroma * pow(curv, 2.2) * minHalf;
    vec2 caDir = length(d) > 0.001 ? normalize(d) : vec2(0.0);

    float invZ = 1.0 / max(uZoom, 1.0);
    vec2 ptR = uTarget + (lensOffset - caDir * ca) * invZ;
    vec2 ptG = uTarget + lensOffset * invZ;
    vec2 ptB = uTarget + (lensOffset + caDir * ca) * invZ;

    float rCh = sampleCard(ptR, dUdx, dUdy).r;
    float gCh = sampleCard(ptG, dUdx, dUdy).g;
    float bCh = sampleCard(ptB, dUdx, dUdy).b;
    vec3 glassCol = vec3(rCh, gCh, bCh);

    // Subtle warm glass tint + warm inner bevel drop-shadow.
    vec3 glassTint = mix(vec3(1.0, 0.992, 0.972), vec3(0.96, 0.98, 1.0), uDark * 0.5);
    glassCol *= mix(vec3(1.0), glassTint, 0.35 * curv * curv);

    float innerRimShadow = smoothstep(8.5, 0.0, depthIn) * 0.17;
    float topRecessShadow = smoothstep(12.0, 0.0, depthIn) * clamp(-d.y / minHalf, 0.0, 1.0) * 0.16;
    glassCol *= (1.0 - innerRimShadow - topRecessShadow);

    // Glossy top meniscus highlight inside the upper glass dome.
    vec2 n = d / max(uLoupeHalf - vec2(2.0), vec2(1.0));
    float meniscusBroad = smoothstep(0.08, -0.86, n.y) * smoothstep(1.02, 0.18, abs(n.x)) * (1.0 - smoothstep(2.0, 0.4, depthIn));
    float meniscusArc = smoothstep(13.0, 3.0, depthIn) * smoothstep(-0.08, -0.62, n.y) * smoothstep(0.98, 0.25, abs(n.x));
    float bottomBounce = smoothstep(7.0, 1.8, depthIn) * smoothstep(0.35, 0.92, n.y) * 0.14;
    glassCol = mix(glassCol, vec3(1.0), clamp(meniscusBroad * 0.15 + meniscusArc * 0.23 + bottomBounce, 0.0, 0.38));

    // Subtle bottom notch aligned with the target coordinate.
    float notch = (1.0 - smoothstep(0.6, 1.4, abs(d.x))) * smoothstep(minHalf - 7.0, minHalf - 1.5, d.y) * 0.32;
    glassCol = mix(glassCol, uAccent, notch);

    // Metallic glass bevel rim around sd = 0.
    float rimGrad = clamp(0.5 - 0.5 * (d.y / minHalf), 0.0, 1.0);
    vec3 rimCol = mix(vec3(0.28, 0.30, 0.34), vec3(0.86, 0.87, 0.90), rimGrad);
    float outerBorder = 1.0 - smoothstep(1.4, 2.3, depthIn);
    float innerGlint = exp(-pow((depthIn - 2.3) / 0.85, 2.0)) * (0.35 + 0.35 * rimGrad);
    glassCol = mix(glassCol, rimCol, outerBorder * 0.85);
    glassCol = mix(glassCol, vec3(1.0), innerGlint * 0.55);

    col = mix(col, glassCol, loupeMask);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), max(baseSample.a, 1.0));
}`;
// #endregion loupe-shader

// #region clamp-position
function loupeDimensions(cw, shape) {
  if (shape === 'round') {
    const r = Math.max(36, Math.min(58, Math.floor(cw * 0.2)));
    return { halfW: r, halfH: r, radius: r, barrel: 0.15, chroma: 0.017 };
  }
  const halfW = Math.max(54, Math.min(78, Math.floor(cw * 0.26)));
  const halfH = Math.max(24, Math.min(30, Math.floor(cw * 0.1)));
  return { halfW, halfH, radius: halfH, barrel: 0.1, chroma: 0.014 };
}

function computeLoupeLayout(tx, ty, cw, ch, shape = state.shape) {
  const { halfW, halfH, radius, barrel, chroma } = loupeDimensions(cw, shape);
  const pad = 8;
  const minX = Math.min(cw * 0.5, halfW + pad);
  const maxX = Math.max(minX, cw - halfW - pad);
  const minY = Math.min(ch * 0.5, halfH + pad);
  const maxY = Math.max(minY, ch - halfH - pad);

  const clampedTargetX = clamp(tx, 2, Math.max(2, cw - 2));
  const clampedTargetY = clamp(ty, 2, Math.max(2, ch - 2));
  const lx = clamp(clampedTargetX, minX, maxX);
  const ly = clamp(clampedTargetY - 58, minY, maxY);

  return { tx: clampedTargetX, ty: clampedTargetY, lx, ly, halfW, halfH, radius, barrel, chroma };
}
// #endregion clamp-position

// #region caret-measure
function ensureMirror() {
  if (mirrorEl) return mirrorEl;
  mirrorEl = document.createElement('div');
  mirrorEl.setAttribute('aria-hidden', 'true');
  mirrorEl.inert = true;
  mirrorEl.style.cssText =
    'position:fixed;left:-9999px;top:0;visibility:hidden;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;overflow:hidden;';
  document.body.append(mirrorEl);
  return mirrorEl;
}

function syncMirrorStyles(textarea) {
  const m = ensureMirror();
  const cs = getComputedStyle(textarea);
  const props = [
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'wordSpacing',
    'textIndent',
    'textTransform',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'tabSize',
  ];
  for (const p of props) m.style[p] = cs[p];
  m.style.boxSizing = 'border-box';
  m.style.borderStyle = 'solid';
  m.style.borderColor = 'transparent';
  const bL = parseFloat(cs.borderLeftWidth) || 0;
  const bR = parseFloat(cs.borderRightWidth) || 0;
  m.style.width = `${Math.max(20, textarea.clientWidth + bL + bR)}px`;
  return { m, cs };
}

function toCardLocal(rect) {
  const base = card.getBoundingClientRect();
  const z = cssZoom(card);
  return {
    x: (rect.left - base.left) / z,
    y: (rect.top - base.top) / z,
    w: rect.width / z,
    h: rect.height / z,
  };
}

function measureTextareaCaret(textarea, idx) {
  const val = textarea.value;
  const pos = clamp(idx, 0, val.length);
  const taLocal = toCardLocal(textarea.getBoundingClientRect());
  const cs = getComputedStyle(textarea);
  const bL = parseFloat(cs.borderLeftWidth) || 0;
  const bT = parseFloat(cs.borderTopWidth) || 0;
  const pL = parseFloat(cs.paddingLeft) || 0;
  const pT = parseFloat(cs.paddingTop) || 0;
  const pR = parseFloat(cs.paddingRight) || 0;
  const pB = parseFloat(cs.paddingBottom) || 0;
  const lineH = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) || 12.5) * 1.48;

  // Prefer Chromium's createValueRange() when it produces a non-empty rect on the current line.
  if (typeof textarea.createValueRange === 'function' && val.length > 0) {
    try {
      const r0 = textarea.createValueRange(pos, pos).getBoundingClientRect();
      if (r0 && r0.height > 0 && (r0.left !== 0 || r0.top !== 0)) {
        const loc = toCardLocal(r0);
        return {
          x: clamp(loc.x, taLocal.x + bL + 2, taLocal.x + taLocal.w - 4),
          y: clamp(loc.y + loc.h * 0.5, taLocal.y + bT + 4, taLocal.y + taLocal.h - 4),
          h: loc.h,
          method: 'createValueRange',
        };
      }
      if (pos < val.length && val[pos] !== '\n') {
        const rNext = textarea.createValueRange(pos, pos + 1).getBoundingClientRect();
        if (rNext && rNext.height > 0) {
          const loc = toCardLocal(rNext);
          return {
            x: clamp(loc.x, taLocal.x + bL + 2, taLocal.x + taLocal.w - 4),
            y: clamp(loc.y + loc.h * 0.5, taLocal.y + bT + 4, taLocal.y + taLocal.h - 4),
            h: loc.h,
            method: 'createValueRange(next)',
          };
        }
      }
      if (pos > 0 && val[pos - 1] !== '\n') {
        const rPrev = textarea.createValueRange(pos - 1, pos).getBoundingClientRect();
        if (rPrev && rPrev.height > 0) {
          const loc = toCardLocal(rPrev);
          return {
            x: clamp(loc.x + loc.w, taLocal.x + bL + 2, taLocal.x + taLocal.w - 4),
            y: clamp(loc.y + loc.h * 0.5, taLocal.y + bT + 4, taLocal.y + taLocal.h - 4),
            h: loc.h,
            method: 'createValueRange(prev)',
          };
        }
      }
    } catch {}
  }

  // Fallback mirror measurer handles blank lines, trailing newlines and browsers without createValueRange().
  const { m } = syncMirrorStyles(textarea);
  const head = document.createTextNode(val.slice(0, pos));
  const pin = document.createElement('span');
  pin.textContent = '\u200b';
  const tail = document.createTextNode(val.slice(pos) || ' ');
  m.replaceChildren(head, pin, tail);

  const mBox = m.getBoundingClientRect();
  const pinBox = pin.getBoundingClientRect();
  const relX = pinBox.left - mBox.left - textarea.scrollLeft;
  const relY = pinBox.top - mBox.top - textarea.scrollTop;
  const h = pinBox.height || lineH;

  return {
    x: clamp(taLocal.x + relX, taLocal.x + bL + pL, taLocal.x + taLocal.w - pR - 2),
    y: clamp(taLocal.y + relY + h * 0.5, taLocal.y + bT + pT * 0.5, taLocal.y + taLocal.h - pB * 0.5),
    h,
    method: 'mirror',
  };
}

function caretIndexFromPoint(textarea, cardX, cardY) {
  const val = textarea.value;
  if (!val.length) return 0;
  const taLocal = toCardLocal(textarea.getBoundingClientRect());
  const { m } = syncMirrorStyles(textarea);
  m.textContent = val;
  const textNode = m.firstChild;
  if (!textNode) return 0;

  const mBox = m.getBoundingClientRect();
  const targetX = mBox.left + (cardX - taLocal.x) + textarea.scrollLeft;
  const targetY = mBox.top + (cardY - taLocal.y) + textarea.scrollTop;
  const range = new Range();

  let bestIdx = val.length;
  let bestScore = Infinity;
  for (let i = 0; i <= val.length; i++) {
    let rect = null;
    if (i < val.length && val[i] !== '\n') {
      range.setStart(textNode, i);
      range.setEnd(textNode, i + 1);
      rect = range.getClientRects()[0] ?? null;
    } else if (i > 0 && val[i - 1] !== '\n') {
      range.setStart(textNode, i - 1);
      range.setEnd(textNode, i);
      const r = range.getClientRects()[0];
      if (r) rect = { left: r.right, top: r.top, height: r.height };
    }
    if (!rect) continue;
    const dy = targetY - (rect.top + rect.height * 0.5);
    const dx = targetX - rect.left;
    const score = Math.abs(dy) * 3.5 + Math.abs(dx);
    if (score < bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function lineColFor(val, idx) {
  const upTo = val.slice(0, clamp(idx, 0, val.length));
  const parts = upTo.split('\n');
  return { line: parts.length, col: parts[parts.length - 1].length + 1 };
}

function measureSelectionTarget() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && sel.focusNode && card.contains(sel.focusNode) && !noteEditor.contains(sel.focusNode)) {
    const r = new Range();
    r.setStart(sel.focusNode, sel.focusOffset);
    r.setEnd(sel.focusNode, sel.focusOffset);
    let q = r.getClientRects()[0];
    if ((!q || q.height === 0) && sel.focusOffset > 0 && sel.focusNode.nodeType === Node.TEXT_NODE) {
      r.setStart(sel.focusNode, sel.focusOffset - 1);
      r.setEnd(sel.focusNode, sel.focusOffset);
      const prev = r.getClientRects()[0];
      if (prev && prev.height > 0) q = { left: prev.right, top: prev.top, width: 0, height: prev.height };
    }
    if (q && q.height > 0) {
      const loc = toCardLocal(q);
      return { x: loc.x, y: loc.y + loc.h * 0.5, source: sel.isCollapsed ? 'DOM caret' : 'DOM selection' };
    }
  }

  const idx = caretHasFocusOrEdit
    ? (noteEditor.selectionDirection === 'backward' ? noteEditor.selectionStart : noteEditor.selectionEnd)
    : Math.min(noteEditor.value.length, specimenIdx);
  const caret = measureTextareaCaret(noteEditor, idx ?? 0);
  const lc = lineColFor(noteEditor.value, idx ?? 0);
  caretBadge.textContent = `col ${lc.col}, ln ${lc.line}`;
  const hasRange = caretHasFocusOrEdit && noteEditor.selectionStart !== noteEditor.selectionEnd;
  return {
    x: caret.x,
    y: caret.y,
    source: `${hasRange ? 'textarea selection' : 'textarea caret'} (${caret.method})`,
  };
}
// #endregion caret-measure

// #region geometry-sync
function syncGeometry(force = false) {
  if (typeof canvas.updateElementGeometry !== 'function') return;
  const cw = canvas.clientWidth || card.offsetWidth;
  if (!cw) return;
  const unit = geometryUnit(canvas, card, cw);
  const key = `${canvas.width}x${canvas.height}/${cw}/${unit.toFixed(4)}`;
  if (!force && key === lastGeomKey) return;
  lastGeomKey = key;
  const m = new DOMMatrix().scale(unit);
  canvas.updateElementGeometry(card, { canvasTransform: m });
  card.dataset.hitTick = String(++hitTick);
}
// #endregion geometry-sync

function fitStage() {
  if (wrap.classList.contains('plain')) return;
  const h = Math.max(240, Math.ceil(card.offsetHeight));
  if (Math.abs(h - lastCardHeight) >= 1) {
    lastCardHeight = h;
    canvas.style.height = `${h}px`;
  }
}

function updateLoupeTarget(tx, ty, source, snap = false) {
  const cw = canvas.clientWidth || card.offsetWidth || 680;
  const ch = canvas.clientHeight || card.offsetHeight || 440;
  const lay = computeLoupeLayout(tx, ty, cw, ch, state.shape);
  state.targetX = lay.tx;
  state.targetY = lay.ty;
  state.loupeX = lay.lx;
  state.loupeY = lay.ly;
  state.targetSource = source;
  if (snap || reducedMotion.matches) {
    state.loupeDrawX = lay.lx;
    state.loupeDrawY = lay.ly;
    requestDraw(false);
  } else {
    scheduleAnim();
  }
  updateStatus();
}

function refreshCaretTarget(snap = false) {
  const t = measureSelectionTarget();
  updateLoupeTarget(t.x, t.y, t.source, snap);
}

function updateStatus() {
  const cw = canvas.clientWidth || card.offsetWidth || 0;
  const ch = canvas.clientHeight || card.offsetHeight || 0;
  const texStr = state.texW ? `${state.texW}x${state.texH}` : (ctx2d ? `${canvas.width}x${canvas.height}` : 'pending');
  const countLabel = ctx2d && (!stage || stage.lost) ? 'Draws' : 'Uploads';
  statusEl.textContent =
    `Backend: ${state.backend} | Mode: ${state.mode} (${state.targetSource}) | ` +
    `Target: (${Math.round(state.targetX)}, ${Math.round(state.targetY)}) | ` +
    `Loupe: (${Math.round(state.loupeDrawX)}, ${Math.round(state.loupeDrawY)}) ${state.zoom.toFixed(1)}x ${state.shape} ${state.showLoupe ? 'on' : 'off'} | ` +
    `${countLabel}: ${state.uploads} (${texStr}, stage ${cw}x${ch})`;
}

function showNotice(msg) {
  noticeEl.hidden = !msg;
  noticeEl.textContent = msg;
}

function hasPendingAnim() {
  if (!state.onScreen || document.hidden || wrap.classList.contains('plain') || reducedMotion.matches) return false;
  return Math.hypot(state.loupeX - state.loupeDrawX, state.loupeY - state.loupeDrawY) > 0.2;
}

function scheduleAnim() {
  if (reducedMotion.matches) {
    state.loupeDrawX = state.loupeX;
    state.loupeDrawY = state.loupeY;
    requestDraw(false);
    return;
  }
  if (!rafId && hasPendingAnim()) {
    lastFrameMs = performance.now();
    rafId = requestAnimationFrame(onAnimFrame);
  } else {
    requestDraw(false);
  }
}

function onAnimFrame(now) {
  rafId = 0;
  if (!hasPendingAnim()) {
    state.loupeDrawX = state.loupeX;
    state.loupeDrawY = state.loupeY;
    requestDraw(false);
    return;
  }
  const dt = Math.min(0.05, Math.max(0.004, (now - lastFrameMs) / 1000));
  lastFrameMs = now;
  const k = 1 - Math.exp(-dt * 18);
  state.loupeDrawX += (state.loupeX - state.loupeDrawX) * k;
  state.loupeDrawY += (state.loupeY - state.loupeDrawY) * k;
  requestDraw(false);
  if (hasPendingAnim()) rafId = requestAnimationFrame(onAnimFrame);
  else {
    state.loupeDrawX = state.loupeX;
    state.loupeDrawY = state.loupeY;
    requestDraw(false);
  }
}

function requestDraw(markDirty = true) {
  if (markDirty) domDirty = true;
  if (wrap.classList.contains('plain')) {
    updateStatus();
    return;
  }
  canvas.requestPaint?.();
}

// #region upload-and-draw
function renderWebGL(e) {
  if (!stage || stage.lost) return;
  fitStage();
  const cw = canvas.clientWidth || card.offsetWidth;
  const ch = canvas.clientHeight || card.offsetHeight;
  if (!cw || !ch) return;

  syncGeometry();

  const changed = new Set(e?.changedElements ?? []);
  if (domDirty || changed.has(card) || !stage.has(card) || !lastLiveTex) {
    lastLiveTex = stage.upload(card);
    domDirty = false;
    mipDirty = true;
    state.uploads++;
    if (lastLiveTex) {
      state.texW = lastLiveTex.w;
      state.texH = lastLiveTex.h;
    }
  }
  if (!lastLiveTex) return;

  const gl = stage.gl;
  if (mipDirty) {
    gl.bindTexture(gl.TEXTURE_2D, lastLiveTex.tex);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    mipDirty = false;
  }

  const lay = computeLoupeLayout(state.targetX, state.targetY, cw, ch, state.shape);
  const lx = clamp(state.loupeDrawX, lay.halfW + 8, Math.max(lay.halfW + 8, cw - lay.halfW - 8));
  const ly = clamp(state.loupeDrawY, lay.halfH + 8, Math.max(lay.halfH + 8, ch - lay.halfH - 8));
  const theme = THEMES[state.theme] ?? THEMES.paper;

  if (!stage.begin([theme.paper[0], theme.paper[1], theme.paper[2], 1])) return;
  stage.quad(card, ElementGL.rect(canvas, 0, 0, cw, ch), (g, loc) => {
    g.uniform2f(loc('uCanvasSize'), cw, ch);
    g.uniform2f(loc('uTarget'), lay.tx, lay.ty);
    g.uniform2f(loc('uLoupeCenter'), lx, ly);
    g.uniform2f(loc('uLoupeHalf'), lay.halfW, lay.halfH);
    g.uniform1f(loc('uLoupeRadius'), lay.radius);
    g.uniform1f(loc('uZoom'), state.zoom);
    g.uniform1f(loc('uShowLoupe'), state.showLoupe ? 1 : 0);
    g.uniform1f(loc('uBarrel'), lay.barrel);
    g.uniform1f(loc('uChroma'), lay.chroma);
    g.uniform3f(loc('uAccent'), theme.accent[0], theme.accent[1], theme.accent[2]);
    g.uniform3f(loc('uPaper'), theme.paper[0], theme.paper[1], theme.paper[2]);
    g.uniform1f(loc('uDark'), theme.dark);
  });
  updateStatus();
}
// #endregion upload-and-draw

// #region geometry-sync
function render2DFallback() {
  if (!ctx2d) return;
  fitStage();
  const cw = canvas.clientWidth || card.offsetWidth;
  const ch = canvas.clientHeight || card.offsetHeight;
  if (!cw || !ch) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);
  ctx2d.drawElementImage(card, 0, 0, cw, ch);
  state.uploads++;

  const lay = computeLoupeLayout(state.targetX, state.targetY, cw, ch, state.shape);
  const lx = clamp(state.loupeDrawX, lay.halfW + 8, Math.max(lay.halfW + 8, cw - lay.halfW - 8));
  const ly = clamp(state.loupeDrawY, lay.halfH + 8, Math.max(lay.halfH + 8, ch - lay.halfH - 8));

  if (state.showLoupe) {
    // Faint reticle at the target below.
    ctx2d.strokeStyle = 'rgb(210 73 31 / 0.55)';
    ctx2d.lineWidth = 1.2;
    ctx2d.beginPath();
    ctx2d.arc(lay.tx, lay.ty, 6.5, 0, Math.PI * 2);
    ctx2d.stroke();

    // Rounded pill or circular glass clip using 9-argument zoomed drawElementImage().
    const x0 = lx - lay.halfW;
    const y0 = ly - lay.halfH;
    const w = lay.halfW * 2;
    const h = lay.halfH * 2;

    ctx2d.save();
    ctx2d.shadowColor = 'rgb(0 0 0 / 0.26)';
    ctx2d.shadowBlur = 14 * dpr;
    ctx2d.shadowOffsetY = 5 * dpr;
    ctx2d.fillStyle = state.theme === 'ink' ? '#171a20' : '#fbf8f1';
    ctx2d.beginPath();
    ctx2d.roundRect(x0, y0, w, h, lay.radius);
    ctx2d.fill();
    ctx2d.restore();

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.roundRect(x0, y0, w, h, lay.radius);
    ctx2d.clip();
    const sx0 = Math.max(0, lay.tx - lay.halfW / state.zoom);
    const sy0 = Math.max(0, lay.ty - lay.halfH / state.zoom);
    const sx1 = Math.min(cw, lay.tx + lay.halfW / state.zoom);
    const sy1 = Math.min(ch, lay.ty + lay.halfH / state.zoom);
    const sw = Math.max(1, sx1 - sx0);
    const sh = Math.max(1, sy1 - sy0);
    const dx = lx + (sx0 - lay.tx) * state.zoom;
    const dy = ly + (sy0 - lay.ty) * state.zoom;
    ctx2d.drawElementImage(card, sx0, sy0, sw, sh, dx, dy, sw * state.zoom, sh * state.zoom);

    const sheen = ctx2d.createLinearGradient(0, y0, 0, y0 + h * 0.55);
    sheen.addColorStop(0, 'rgb(255 255 255 / 0.30)');
    sheen.addColorStop(1, 'rgb(255 255 255 / 0)');
    ctx2d.fillStyle = sheen;
    ctx2d.fillRect(x0, y0, w, h * 0.55);

    ctx2d.strokeStyle = 'rgb(70 74 82 / 0.78)';
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath();
    ctx2d.roundRect(x0 + 0.8, y0 + 0.8, w - 1.6, h - 1.6, Math.max(1, lay.radius - 0.8));
    ctx2d.stroke();
    ctx2d.restore();

    // Nine-argument drawElementImage() narrows the hit box to (sx0, sy0, sw, sh).
    // A zero-area clipped 5-argument draw restores the full card hit region.
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(0, 0, 0, 0);
    ctx2d.clip();
    ctx2d.drawElementImage(card, 0, 0, cw, ch);
    ctx2d.restore();
  }

  ctx2d.restore();
  syncGeometry(true);
  domDirty = false;
  updateStatus();
}
// #endregion geometry-sync

function enterPlainFallback(reason) {
  wrap.classList.add('plain');
  if (card.parentElement !== wrap) wrap.append(card);
  state.backend = 'plain HTML';
  showNotice(reason);
  updateStatus();
}

function restoreFromPlain() {
  wrap.classList.remove('plain');
  if (card.parentElement !== canvas) canvas.append(card);
  showNotice('');
  domDirty = true;
  mipDirty = true;
  fitStage();
  syncGeometry(true);
  requestDraw(true);
}

// Boot single ElementGL WebGL 2 context, 2D fallback, or plain HTML.
fitStage();
if (supported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: LOUPE_FRAG,
      onLost: () => {
        lastLiveTex = null;
        enterPlainFallback('The WebGL 2 context was lost. Showing the editable card as plain HTML until the browser restores it.');
      },
      onRestored: () => {
        state.backend = 'WebGL 2 (ElementGL)';
        restoreFromPlain();
      },
    });
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
    if (noticeEl.hidden) showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 2D drawElementImage() fallback.');
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is unavailable in this browser, so the editable card is shown as plain HTML.');
}

canvas.addEventListener('paint', (e) => {
  if (stage && !stage.lost) renderWebGL(e);
  else if (ctx2d) render2DFallback();
});

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (state.onScreen) {
    if (hasPendingAnim()) scheduleAnim();
    requestDraw(false);
  } else if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}).observe(wrap);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  } else if (!document.hidden && state.onScreen) {
    if (hasPendingAnim()) scheduleAnim();
    requestDraw(false);
  }
});

new ResizeObserver(() => {
  if (!wrap.classList.contains('plain')) {
    fitStage();
    syncGeometry(true);
    if (state.mode === 'caret') refreshCaretTarget(true);
    requestDraw(true);
  }
}).observe(card);

// Live card controls and text events.
for (const btn of swatchBtns) {
  btn.addEventListener('click', () => {
    state.theme = btn.dataset.themePick;
    card.dataset.theme = state.theme;
    for (const b of swatchBtns) b.setAttribute('aria-pressed', String(b === btn));
    requestDraw(true);
  });
}

btnWeight.addEventListener('click', () => {
  state.weight = state.weight === 'regular' ? 'bold' : 'regular';
  card.dataset.weight = state.weight;
  btnWeight.setAttribute('aria-pressed', String(state.weight === 'bold'));
  btnWeight.textContent = state.weight === 'bold' ? 'Weight: 600' : 'Weight: 400';
  fitStage();
  if (state.mode === 'caret') refreshCaretTarget(false);
  requestDraw(true);
});

const onEditorUpdate = () => {
  caretHasFocusOrEdit = true;
  const idx = noteEditor.selectionDirection === 'backward' ? noteEditor.selectionStart : noteEditor.selectionEnd;
  const lc = lineColFor(noteEditor.value, idx ?? 0);
  caretBadge.textContent = `col ${lc.col}, ln ${lc.line}`;
  if (state.mode === 'caret') refreshCaretTarget(false);
  requestDraw(true);
};

for (const ev of ['focus', 'input', 'keyup', 'click', 'select', 'scroll']) {
  noteEditor.addEventListener(ev, onEditorUpdate);
}

document.addEventListener('selectionchange', () => {
  const active = document.activeElement;
  const sel = window.getSelection();
  const inCard = (active && card.contains(active)) || (sel && sel.rangeCount > 0 && card.contains(sel.focusNode));
  if (!inCard) return;
  if (state.mode === 'caret') refreshCaretTarget(false);
  requestDraw(true);
});

// Outer stage controls.
function setMode(mode) {
  state.mode = mode;
  for (const b of modeBtns) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  canvas.classList.toggle('pointer-active', mode === 'pointer');
  canvas.classList.toggle('scrub-active', mode === 'scrub');
  if (mode === 'caret') refreshCaretTarget(false);
  updateStatus();
}

for (const b of modeBtns) {
  b.addEventListener('click', () => setMode(b.dataset.mode));
}

btnShowLoupe.addEventListener('click', () => {
  state.showLoupe = !state.showLoupe;
  btnShowLoupe.setAttribute('aria-pressed', String(state.showLoupe));
  btnShowLoupe.textContent = state.showLoupe ? 'Show loupe at target' : 'Loupe hidden';
  requestDraw(false);
});

btnStepTarget.addEventListener('click', () => {
  const cw = canvas.clientWidth || card.offsetWidth || 640;
  const ch = canvas.clientHeight || card.offsetHeight || 440;
  const taBox = toCardLocal(noteEditor.getBoundingClientRect());
  const proseBox = toCardLocal(editorialProse.getBoundingClientRect());
  const stops = [
    { x: Math.min(cw * 0.48, taBox.x + 150), y: taBox.y + 38, label: 'specimen note' },
    { x: clamp(cw * 0.36, 40, cw - 40), y: Math.min(44, proseBox.y + 8), label: 'top clamp (y < 60 px)' },
    { x: clamp(cw * 0.34, 40, cw - 40), y: Math.max(80, ch - 46), label: 'vernier & 8 px footnote' },
  ];
  state.stepIndex = (state.stepIndex + 1) % stops.length;
  const stop = stops[state.stepIndex];
  updateLoupeTarget(stop.x, stop.y, stop.label, false);
});

for (const b of zoomBtns) {
  b.addEventListener('click', () => {
    state.zoom = Number(b.dataset.zoom);
    for (const x of zoomBtns) x.setAttribute('aria-pressed', String(x === b));
    requestDraw(false);
  });
}

for (const b of shapeBtns) {
  b.addEventListener('click', () => {
    state.shape = b.dataset.shape;
    for (const x of shapeBtns) x.setAttribute('aria-pressed', String(x === b));
    updateLoupeTarget(state.targetX, state.targetY, state.targetSource, false);
  });
}

// Pointer tracking and loupe drag scrub.
function canvasLocal(e) {
  const r = canvas.getBoundingClientRect();
  const z = cssZoom(canvas);
  return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
}

function scrubAt(x, y, snap) {
  const taBox = toCardLocal(noteEditor.getBoundingClientRect());
  const inEditor = x >= taBox.x && x <= taBox.x + taBox.w && y >= taBox.y && y <= taBox.y + taBox.h;
  if (inEditor) {
    const idx = caretIndexFromPoint(noteEditor, x, y);
    caretHasFocusOrEdit = true;
    specimenIdx = idx;
    try { noteEditor.setSelectionRange(idx, idx); } catch {}
    const lc = lineColFor(noteEditor.value, idx);
    caretBadge.textContent = `col ${lc.col}, ln ${lc.line}`;
    const caret = measureTextareaCaret(noteEditor, idx);
    updateLoupeTarget(caret.x, caret.y, `scrub col ${lc.col}, ln ${lc.line}`, snap);
    domDirty = true;
    canvas.requestPaint?.();
    return;
  }
  updateLoupeTarget(x, y, 'loupe scrub', snap);
}

canvas.addEventListener('pointerdown', (e) => {
  if (wrap.classList.contains('plain')) return;
  const pt = canvasLocal(e);
  if (state.mode === 'scrub') {
    e.preventDefault();
    scrubbing = true;
    activePointerId = e.pointerId;
    canvas.classList.add('scrubbing');
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    scrubAt(pt.x, pt.y, true);
    return;
  }
  if (state.mode === 'pointer' && e.pointerType !== 'mouse') {
    activePointerId = e.pointerId;
    updateLoupeTarget(pt.x, pt.y, 'touch pointer', true);
  }
}, { capture: true });

canvas.addEventListener('pointermove', (e) => {
  if (wrap.classList.contains('plain')) return;
  const pt = canvasLocal(e);
  if (state.mode === 'scrub' && scrubbing && e.pointerId === activePointerId) {
    scrubAt(pt.x, pt.y, true);
    return;
  }
  if (state.mode === 'pointer') {
    if (e.pointerType === 'mouse' || (e.buttons !== 0 && e.pointerId === activePointerId)) {
      updateLoupeTarget(pt.x, pt.y, e.pointerType === 'mouse' ? 'pointer hover' : 'touch drag', e.pointerType !== 'mouse');
    }
  }
}, { capture: true });

const endScrub = (e) => {
  if (e.pointerId !== activePointerId) return;
  scrubbing = false;
  activePointerId = null;
  canvas.classList.remove('scrubbing');
};
canvas.addEventListener('pointerup', endScrub, { capture: true });
canvas.addEventListener('pointercancel', endScrub, { capture: true });

// Initial layout and default specimen target without focusing the textarea.
fitStage();
syncGeometry(true);
{
  const initialIdx = Math.min(noteEditor.value.length, specimenIdx);
  const initCaret = measureTextareaCaret(noteEditor, initialIdx);
  updateLoupeTarget(initCaret.x, initCaret.y, 'initial specimen', true);
}
requestDraw(true);

// ------------------------------------------------------------ live checks (isolated fixtures on testStage)
const need = (ok, msg) => {
  if (!ok) throw new Error(msg);
  return msg;
};

function readCssPixel(g, cv, x, y) {
  const sx = Math.min(cv.width - 1, Math.max(0, Math.round((x / Math.max(1, cv.clientWidth)) * cv.width)));
  const syFromTop = Math.min(cv.height - 1, Math.max(0, Math.round((y / Math.max(1, cv.clientHeight)) * cv.height)));
  const sy = cv.height - 1 - syFromTop;
  const px = new Uint8Array(4);
  g.gl.readPixels(sx, sy, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, px);
  return px;
}

function drawLoupeFixture(g, cv, child, w, h, tx, ty, shape = 'pill', zoom = 2.2) {
  const gl = g.gl;
  const texObj = g.upload(child);
  gl.bindTexture(gl.TEXTURE_2D, texObj.tex);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const lay = computeLoupeLayout(tx, ty, w, h, shape);
  g.begin([251 / 255, 248 / 255, 241 / 255, 1]);
  g.quad(child, ElementGL.rect(cv, 0, 0, w, h), (gg, loc) => {
    gg.uniform2f(loc('uCanvasSize'), w, h);
    gg.uniform2f(loc('uTarget'), lay.tx, lay.ty);
    gg.uniform2f(loc('uLoupeCenter'), lay.lx, lay.ly);
    gg.uniform2f(loc('uLoupeHalf'), lay.halfW, lay.halfH);
    gg.uniform1f(loc('uLoupeRadius'), lay.radius);
    gg.uniform1f(loc('uZoom'), zoom);
    gg.uniform1f(loc('uShowLoupe'), 1);
    gg.uniform1f(loc('uBarrel'), lay.barrel);
    gg.uniform1f(loc('uChroma'), lay.chroma);
    gg.uniform3f(loc('uAccent'), 210 / 255, 73 / 255, 31 / 255);
    gg.uniform3f(loc('uPaper'), 251 / 255, 248 / 255, 241 / 255);
    gg.uniform1f(loc('uDark'), 0);
  });
  return lay;
}

async function retireFixtureCanvas(g, cv) {
  try { g?.dispose?.(); } catch {}
  try { cv?.remove?.(); } catch {}
  window.__gfx?.retire(cv);
  window.__gfx?.active?.();
  await sleep(550);
}

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() samples magnified zoomed pixels cleanly (gl.getError() === 0)',
    expect: 'pass',
    why: 'Builds an isolated 220x180 ElementGL fixture on testStage() with a 12 px dark ink square at y=128 over white paper, focuses the loupe at (110, 128) so the glass lens sits 58 px higher at y=70, and checks gl.getError() === 0 plus zoomed vs unlensed pixel colours.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is unavailable here');
      const W = 220, H = 180;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block`;
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = `position:relative;width:${W}px;height:${H}px;background:#fbf8f1`;
      const mark = document.createElement('div');
      mark.style.cssText = 'position:absolute;left:102px;top:122px;width:16px;height:12px;background:#161514';
      child.append(mark);
      cv.append(child);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: LOUPE_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        while (g.gl.getError() !== g.gl.NO_ERROR) {}

        const lay = drawLoupeFixture(g, cv, child, W, H, 110, 128, 'pill', 2.2);
        const glErr = g.gl.getError();
        // Inside the loupe at (110, 70): samples target (110, 128) -> dark ink; 14 px right at (124, 70) -> zoomed 16*2.2=35 px wide dark mark; outside at (20, 70) -> light paper.
        const centerPx = readCssPixel(g, cv, lay.lx, lay.ly);
        const edgeMagPx = readCssPixel(g, cv, lay.lx + 12, lay.ly);
        const paperPx = readCssPixel(g, cv, 20, lay.ly);

        const ok =
          glErr === 0 &&
          centerPx[0] < 60 && centerPx[1] < 60 &&
          edgeMagPx[0] < 70 &&
          paperPx[0] > 210 && paperPx[1] > 205;
        return need(
          ok,
          `gl.getError()=${glErr}, loupe centre rgb(${centerPx[0]},${centerPx[1]},${centerPx[2]}), +12px magnified rgb(${edgeMagPx[0]},${edgeMagPx[1]},${edgeMagPx[2]}), paper rgb(${paperPx[0]},${paperPx[1]},${paperPx[2]}).`
        );
      } finally {
        await retireFixtureCanvas(g, cv);
      }
    },
  },
  {
    name: 'Moving loupe focus from a dark text block to a coloured accent strip updates magnified pixels cleanly',
    expect: 'pass',
    why: 'Uploads one fixture holding a dark text block and a vermilion accent strip, renders with the target on the dark block, then shifts only uniforms to the accent strip and compares the RGB readout.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is unavailable here');
      const W = 220, H = 180;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block`;
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = `position:relative;width:${W}px;height:${H}px;background:#fbf8f1`;
      child.innerHTML =
        '<div style="position:absolute;left:30px;top:112px;width:160px;height:26px;background:#161514;color:#161514">Dark block</div>' +
        '<div style="position:absolute;left:30px;top:144px;width:160px;height:26px;background:#d2491f"></div>';
      cv.append(child);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: LOUPE_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        while (g.gl.getError() !== g.gl.NO_ERROR) {}

        const layDark = drawLoupeFixture(g, cv, child, W, H, 110, 125, 'round', 2.2);
        const darkPx = readCssPixel(g, cv, layDark.lx, layDark.ly);

        const layAccent = drawLoupeFixture(g, cv, child, W, H, 110, 157, 'round', 2.2);
        const accentPx = readCssPixel(g, cv, layAccent.lx, layAccent.ly);
        const glErr = g.gl.getError();

        const ok =
          glErr === 0 &&
          darkPx[0] < 70 && darkPx[1] < 70 && darkPx[2] < 70 &&
          accentPx[0] > 170 && accentPx[0] - accentPx[2] > 110;
        return need(
          ok,
          `gl.getError()=${glErr}; dark block rgb(${darkPx[0]},${darkPx[1]},${darkPx[2]}) -> accent strip rgb(${accentPx[0]},${accentPx[1]},${accentPx[2]}).`
        );
      } finally {
        await retireFixtureCanvas(g, cv);
      }
    },
  },
  {
    name: 'Loupe position stays clamped cleanly when target approaches the top edge (y < 60 px)',
    expect: 'pass',
    why: 'Verifies computeLoupeLayout() for both pill and round iOS 6 shapes at y=10, 30 and 59 px, and renders an isolated ElementGL fixture targeting y=22 px to confirm pixels stay inside the top canvas edge.',
    run: async () => {
      if (!supported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is unavailable here');
      const W = 240, H = 160;
      const ys = [10, 30, 59];
      for (const shape of ['pill', 'round']) {
        for (const ty of ys) {
          const lay = computeLoupeLayout(120, ty, W, H, shape);
          const topEdge = lay.ly - lay.halfH;
          if (topEdge < 7.9 || lay.ly + lay.halfH > H - 7.9) {
            throw new Error(`${shape} at y=${ty} produced clipped bounds [${topEdge.toFixed(1)}, ${(lay.ly + lay.halfH).toFixed(1)}]`);
          }
        }
      }

      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block`;
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = `position:relative;width:${W}px;height:${H}px;background:#fbf8f1`;
      child.innerHTML = '<div style="position:absolute;left:90px;top:14px;width:60px;height:16px;background:#1d5cff"></div>';
      cv.append(child);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: LOUPE_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const lay = drawLoupeFixture(g, cv, child, W, H, 120, 22, 'pill', 2.2);
        const clampedCenterPx = readCssPixel(g, cv, lay.lx, lay.ly);
        const glErr = g.gl.getError();
        const ok = glErr === 0 && lay.ly - lay.halfH >= 8 && clampedCenterPx[2] > 160 && clampedCenterPx[2] > clampedCenterPx[0] + 80;
        return need(
          ok,
          `Target y=22 px clamped loupe centre to y=${lay.ly.toFixed(1)} px (top edge ${(lay.ly - lay.halfH).toFixed(1)} px >= 8 px), centre pixel rgb(${clampedCenterPx[0]},${clampedCenterPx[1]},${clampedCenterPx[2]}).`
        );
      } finally {
        await retireFixtureCanvas(g, cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps <textarea> and inline controls clickable (elementsFromPoint())',
    expect: 'pass',
    why: 'Builds an isolated drawable canvas containing a button and a textarea, applies updateElementGeometry() scaled by geometryUnit(), and checks document.elementsFromPoint() on both.',
    run: async () => {
      if (!supported) throw new Error('HTML-in-canvas is unavailable');
      const W = 300, H = 190;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block`;

      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = `position:relative;width:${W}px;height:${H}px;background:#fbf8f1;box-sizing:border-box`;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Check button';
      btn.style.cssText = 'position:absolute;left:24px;top:20px;width:130px;height:36px';

      const ta = document.createElement('textarea');
      ta.value = 'Check textarea';
      ta.setAttribute('inputmode', 'none');
      ta.style.cssText = 'position:absolute;left:24px;top:76px;width:240px;height:84px;box-sizing:border-box';

      box.append(btn, ta);
      cv.append(box);
      testStage().append(cv);

      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const ctx = cv.getContext('2d');
      cv.addEventListener('paint', () => {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        ctx.drawElementImage(box, 0, 0, W, H);
      });
      await nextPaint(cv);

      const unit = geometryUnit(cv, box, W);
      cv.updateElementGeometry?.(box, { canvasTransform: new DOMMatrix().scale(unit) });
      box.dataset.hitTick = '1';
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

      const r = cv.getBoundingClientRect();
      const stageEl = testStage();
      const prevPtr = stageEl.style.pointerEvents;
      stageEl.style.pointerEvents = 'auto';
      let btnHits = [], taHits = [];
      try {
        btnHits = document.elementsFromPoint(r.left + 89, r.top + 38);
        taHits = document.elementsFromPoint(r.left + 120, r.top + 110);
      } finally {
        stageEl.style.pointerEvents = prevPtr;
      }

      const btnOk = btnHits.includes(btn);
      const taOk = taHits.includes(ta);
      cv.remove();
      window.__gfx?.retire(cv);
      return need(
        btnOk && taOk,
        `unit=${unit.toFixed(2)}, button hit=${btnOk} (<${btnHits[0]?.tagName?.toLowerCase() ?? 'none'}>), textarea hit=${taOk} (<${taHits[0]?.tagName?.toLowerCase() ?? 'none'}>).`
      );
    },
  },
  {
    name: 'Dispatched webglcontextlost event falls back to plain HTML without calling loseContext()',
    expect: 'pass',
    why: 'Dispatches a synthetic cancelable webglcontextlost event on an isolated fixture to verify safe fallback recovery.',
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
      cv.remove();
      window.__gfx?.retire(cv);
      return need(ok, `defaultPrevented=${ev.defaultPrevented}, card moved to plain wrapper=${child.parentElement === host}.`);
    },
  },
  stillDrawn(() => [
    {
      name: 'text loupe stage',
      ink: async () => {
        if (wrap.classList.contains('plain')) return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (stage) return !stage.lost && state.uploads > 0 ? 1 : 0;
        return canvas.width > 0 && canvas.height > 0 && state.uploads > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
];

runTests($('tests'), tests);
