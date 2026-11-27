import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const ROW_PRESETS = [
  [
    { id: 'compute', item: 'Compute', units: 14, rate: 18.5 },
    { id: 'kv', item: 'Edge KV', units: 420, rate: 0.5 },
    { id: 'gpu', item: 'GPU render', units: 8, rate: 32.0 },
    { id: 'worker', item: 'Worker CPU', units: 65, rate: 4.2 },
    { id: 'egress', item: 'Egress GB', units: 180, rate: 0.85 },
    { id: 'd1', item: 'D1 rows', units: 25, rate: 3.9 },
  ],
  [
    { id: 'compute', item: 'Build VM', units: 22, rate: 14.0 },
    { id: 'kv', item: 'Cache hit', units: 640, rate: 0.35 },
    { id: 'gpu', item: 'Shader pass', units: 12, rate: 26.5 },
    { id: 'worker', item: 'Queue job', units: 90, rate: 2.8 },
    { id: 'egress', item: 'Bundle MB', units: 310, rate: 0.6 },
    { id: 'd1', item: 'Log shard', units: 40, rate: 4.5 },
  ],
];

const GBP_FORMAT = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatMoney(n) {
  return GBP_FORMAT.format(Number.isFinite(n) ? n : 0);
}

// DOM references
const stageBox = document.getElementById('sheet-stage');
const viewportEl = document.getElementById('sheet-viewport');
let canvas = document.getElementById('sheet-canvas');
const sheetCard = document.getElementById('sheet-card');
const sheetTable = document.getElementById('sheet-table');
const sheetHead = sheetTable.tHead.rows[0];
const sheetBody = document.getElementById('sheet-body');
const sheetFoot = sheetTable.tFoot.rows[0];
const totalUnitsEl = document.getElementById('total-units');
const sheetTotalEl = document.getElementById('sheet-total');
const statePillEl = document.getElementById('sheet-state-pill');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('sheet-notice');
const statusEl = document.getElementById('sheet-status');
const testsBody = document.getElementById('tests');

// External controls
const sweepBtn = document.getElementById('btn-sweep');
const populateBtn = document.getElementById('btn-populate');
const clearBtn = document.getElementById('btn-clear');
const scrubSlider = document.getElementById('scrub-slider');
const scrubOut = document.getElementById('scrub-out');
const widthSlider = document.getElementById('width-slider');
const widthOut = document.getElementById('width-out');
const reducedToggle = document.getElementById('reduced-toggle');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

// #region sweep-shader
export function sweepParameters(progress, bandWidthPx = 96) {
  const p = Math.max(0, Math.min(1, progress));
  const bandPx = Math.max(24, Math.min(200, bandWidthPx));
  return { p, bandPx };
}

export const SHEET_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uPrevTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uProgress;
uniform float uBandWidth;
uniform int uBeforeMode;
uniform float uAnimated;
uniform vec4 uHeadFoot;
uniform vec3 uColSplits;
uniform vec4 uRows[6];

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float gridLineMask(vec2 uv) {
  vec2 px = uv * uSize;
  float minDist = 1e6;

  if (uHeadFoot.w > 0.02) {
    minDist = min(minDist, abs(px.y - uHeadFoot.x * uSize.y));
    minDist = min(minDist, abs(px.y - uHeadFoot.y * uSize.y));
    minDist = min(minDist, abs(px.y - uHeadFoot.z * uSize.y));
    minDist = min(minDist, abs(px.y - uHeadFoot.w * uSize.y));
    for (int i = 0; i < 6; i++) {
      if (uRows[i].w > 0.5) {
        minDist = min(minDist, abs(px.y - uRows[i].y * uSize.y));
      }
    }
    if (uv.y >= uHeadFoot.x && uv.y <= uHeadFoot.w) {
      minDist = min(minDist, abs(px.x - uColSplits.x * uSize.x));
      minDist = min(minDist, abs(px.x - uColSplits.y * uSize.x));
      minDist = min(minDist, abs(px.x - uColSplits.z * uSize.x));
    }
  } else {
    float cellH = max(uSize.y / 8.0, 20.0);
    float rowPos = mod(px.y, cellH);
    minDist = min(rowPos, cellH - rowPos);
    minDist = min(minDist, abs(px.x - uSize.x * 0.42));
    minDist = min(minDist, abs(px.x - uSize.x * 0.62));
    minDist = min(minDist, abs(px.x - uSize.x * 0.80));
  }
  return 1.0 - smoothstep(0.0, 1.25, minDist);
}

vec3 skeletonColor(vec2 uv) {
  vec2 px = uv * uSize;
  vec3 bg = vec3(0.055, 0.068, 0.098);
  vec3 barBg = vec3(0.082, 0.098, 0.138);
  vec3 col = bg;

  if (uHeadFoot.w > 0.02) {
    if (uv.y < uHeadFoot.x || (uv.y >= uHeadFoot.x && uv.y <= uHeadFoot.y) || (uv.y >= uHeadFoot.z && uv.y <= uHeadFoot.w)) {
      col = barBg;
    }
  } else if (uv.y < 0.14 || uv.y > 0.86) {
    col = barBg;
  }

  float line = gridLineMask(uv);
  col = mix(col, vec3(0.145, 0.172, 0.232), line * 0.9);

  float shimmer = 0.5 + 0.5 * sin(uv.x * 6.0 - uv.y * 4.5 + uTime * 2.2 * uAnimated);
  vec3 pillCol = mix(vec3(0.110, 0.132, 0.184), vec3(0.185, 0.220, 0.300), shimmer);

  float pillMask = 0.0;
  float cols[5];
  cols[0] = 0.0;
  cols[1] = uHeadFoot.w > 0.02 ? uColSplits.x : 0.42;
  cols[2] = uHeadFoot.w > 0.02 ? uColSplits.y : 0.62;
  cols[3] = uHeadFoot.w > 0.02 ? uColSplits.z : 0.80;
  cols[4] = 1.0;

  if (uHeadFoot.w > 0.02) {
    for (int i = 0; i < 6; i++) {
      if (uRows[i].w < 0.5) continue;
      float y0 = uRows[i].x * uSize.y;
      float y1 = uRows[i].y * uSize.y;
      float cy = 0.5 * (y0 + y1);
      float ph = max(4.0, (y1 - y0) * 0.24);
      for (int c = 0; c < 4; c++) {
        float x0 = cols[c] * uSize.x + 8.0;
        float x1 = cols[c + 1] * uSize.x - 8.0;
        float cw = max(8.0, x1 - x0);
        float w = c == 0 ? cw * uRows[i].z : cw * (c == 1 ? 0.66 : 0.72);
        float cx = c == 0 ? x0 + w * 0.5 : x1 - w * 0.5;
        float sd = sdRoundBox(px - vec2(cx, cy), vec2(w * 0.5, ph * 0.5), ph * 0.5);
        pillMask = max(pillMask, 1.0 - smoothstep(-0.75, 0.75, sd));
      }
    }
    // Header and footer skeleton pills
    float hy = 0.5 * (uHeadFoot.x + uHeadFoot.y) * uSize.y;
    float hh = max(4.0, (uHeadFoot.y - uHeadFoot.x) * uSize.y * 0.24);
    for (int c = 0; c < 4; c++) {
      float x0 = cols[c] * uSize.x + 8.0;
      float x1 = cols[c + 1] * uSize.x - 8.0;
      float cw = max(8.0, x1 - x0);
      float w = cw * 0.52;
      float cx = c == 0 ? x0 + w * 0.5 : x1 - w * 0.5;
      float sd = sdRoundBox(px - vec2(cx, hy), vec2(w * 0.5, hh * 0.5), hh * 0.5);
      pillMask = max(pillMask, 0.7 * (1.0 - smoothstep(-0.75, 0.75, sd)));
    }
  } else {
    float cellH = uSize.y / 6.0;
    float rowIdx = floor(px.y / cellH);
    float cy = (rowIdx + 0.5) * cellH;
    float w = uSize.x * (0.28 + 0.16 * fract(sin(rowIdx * 17.3) * 43.1));
    float sd = sdRoundBox(px - vec2(12.0 + w * 0.5, cy), vec2(w * 0.5, 4.5), 4.5);
    pillMask = 1.0 - smoothstep(-0.75, 0.75, sd);
  }

  col = mix(col, pillCol, pillMask);
  return col;
}

vec4 sampleBefore(vec2 uv) {
  vec2 cUv = clamp(uv, vec2(0.0), vec2(1.0));
  if (uBeforeMode == 1) {
    return texture(uPrevTex, cUv);
  }
  return vec4(skeletonColor(cUv), 1.0);
}

vec4 sampleAfter(vec2 uv) {
  return texture(uTex, clamp(uv, vec2(0.0), vec2(1.0)));
}

void main() {
  if (uProgress >= 0.9995) {
    outColor = texture(uTex, vUv);
    return;
  }
  if (uProgress <= 0.0005) {
    outColor = sampleBefore(vUv);
    return;
  }

  float bandPx = max(24.0, uBandWidth);
  float travelPad = bandPx * 1.15 / max(uSize.y, 1.0);
  float sweepY = mix(1.0 + travelPad, -travelPad, clamp(uProgress, 0.0, 1.0));

  float yPx = vUv.y * uSize.y;
  float frontPx = sweepY * uSize.y;
  float distPx = yPx - frontPx;

  float env = smoothstep(0.0, 0.055, uProgress) * smoothstep(1.0, 0.945, uProgress);
  float sigma = max(7.0, bandPx * 0.34);
  float bandBell = exp(-(distPx * distPx) / (2.0 * sigma * sigma)) * env;
  float edgeSoft = max(9.0, bandPx * 0.40);
  float reveal = smoothstep(-edgeSoft, edgeSoft, distPx);

  float waveSlope = -(distPx / sigma) * bandBell;
  vec2 refractUv = vUv + vec2(0.0, waveSlope * 7.5 / max(uSize.y, 1.0));

  vec4 mixed;
  if (bandBell < 0.008) {
    vec4 b = sampleBefore(refractUv);
    vec4 a = sampleAfter(refractUv);
    mixed = mix(b, a, reveal);
  } else {
    vec2 blurStep = vec2(bandBell * bandPx * 0.022, bandBell * bandPx * 0.048) / max(uSize, vec2(1.0));
    vec2 split = vec2(bandBell * 2.2, bandBell * 1.6) / max(uSize, vec2(1.0));

    vec4 acc = vec4(0.0);
    float wSum = 0.0;
    for (int k = -4; k <= 4; k++) {
      float fk = float(k);
      float w = exp(-0.16 * fk * fk);
      vec2 off = vec2(fk * 0.35 * blurStep.x, fk * blurStep.y);
      vec4 sb = sampleBefore(refractUv + off);
      vec4 sa = sampleAfter(refractUv + off);
      acc += mix(sb, sa, reveal) * w;
      wSum += w;
    }
    mixed = acc / wSum;

    // Chromatic glass dispersion across the sweeping crest
    float rCh = mix(sampleBefore(refractUv - split).r, sampleAfter(refractUv - split).r, reveal);
    float bCh = mix(sampleBefore(refractUv + split).b, sampleAfter(refractUv + split).b, reveal);
    mixed.r = mix(mixed.r, rCh, 0.65 * bandBell);
    mixed.b = mix(mixed.b, bCh, 0.65 * bandBell);
  }

  float shimmerX = 0.90 + 0.10 * sin(vUv.x * 11.0 - uTime * 2.6 * uAnimated);
  float cyanHalo = exp(-(distPx * distPx) / (2.0 * (sigma * 1.35) * (sigma * 1.35))) * 0.34 * env;
  float goldCore = exp(-(distPx * distPx) / (2.0 * (sigma * 0.60) * (sigma * 0.60))) * 0.68 * env;
  float crestLine = exp(-abs(distPx) / max(2.8, bandPx * 0.058)) * 0.54 * env * shimmerX;
  float gridCatch = gridLineMask(vUv) * bandBell * 0.34;

  vec3 glow = vec3(0.24, 0.72, 1.00) * cyanHalo
    + vec3(1.00, 0.84, 0.50) * goldCore
    + vec3(1.00, 0.99, 0.95) * crestLine
    + vec3(0.84, 0.94, 1.00) * gridCatch;

  outColor = vec4(clamp(mixed.rgb + glow, 0.0, 1.0), 1.0);
}`;
// #endregion sweep-shader

// #region fbo-snapshot
const COPY_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0);
}`;

const COPY_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
in vec2 vUv;
out vec4 outColor;
void main() {
  outColor = texture(uSrc, vUv);
}`;

export function createSnapshotFBO(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || 'Snapshot shader compile error');
    }
    return s;
  };
  const prog = gl.createProgram();
  const vs = compile(gl.VERTEX_SHADER, COPY_VERT);
  const fs = compile(gl.FRAGMENT_SHADER, COPY_FRAG);
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(prog) || 'Snapshot program link error');
  }

  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const fbo = gl.createFramebuffer();
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 2, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return {
    prog,
    uSrc: gl.getUniformLocation(prog, 'uSrc'),
    vao,
    vbo,
    fbo,
    tex,
    w: 2,
    h: 2,
  };
}

export function captureSnapshot(gl, res, srcTexObj) {
  if (!gl || !res || !srcTexObj || gl.isContextLost()) return false;
  const w = Math.max(2, srcTexObj.w);
  const h = Math.max(2, srcTexObj.h);
  if (res.w !== w || res.h !== h) {
    gl.bindTexture(gl.TEXTURE_2D, res.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    res.w = w;
    res.h = h;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, res.tex, 0);
  gl.viewport(0, 0, w, h);
  gl.disable(gl.BLEND);
  gl.useProgram(res.prog);
  gl.bindVertexArray(res.vao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, srcTexObj.tex);
  gl.uniform1i(res.uSrc, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.bindVertexArray(null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  return true;
}

function disposeSnapshotFBO(gl, res) {
  if (!gl || !res || gl.isContextLost()) return;
  gl.deleteFramebuffer(res.fbo);
  gl.deleteTexture(res.tex);
  gl.deleteBuffer(res.vbo);
  gl.deleteVertexArray(res.vao);
  gl.deleteProgram(res.prog);
}
// #endregion fbo-snapshot

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  presetIndex: 0,
  isEmpty: false,
  progress: 1,
  bandWidth: Number(widthSlider.value),
  beforeMode: 0, // 0 = procedural skeleton, 1 = FBO snapshot
  reducedOverride: reducedToggle.checked,
  onScreen: true,
  hasPainted: false,
  hasUploaded: false,
  pendingUpload: false,
  animating: false,
  animStart: 0,
  animDuration: 920,
  uploads: 0,
  paints: 0,
  snapshots: 0,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
  rafId: 0,
  gridMetrics: {
    headFoot: new Float32Array([0, 0, 0, 0]),
    colSplits: new Float32Array([0.4, 0.6, 0.8]),
    rows: new Float32Array(24),
  },
  rowData: ROW_PRESETS[0].map((r) => ({ ...r })),
};

let stage = null;
let cardTex = null;
let prevFbo = null;
let ctx2d = null;
const prev2dCanvas = document.createElement('canvas');
const prev2dCtx = prev2dCanvas.getContext('2d');

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 352);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 374);
  return { cw, ch };
}

function syncCardSize(cw, ch) {
  if (state.mode === 'plain') {
    if (sheetCard.style.width) sheetCard.style.width = '';
    if (sheetCard.style.height) sheetCard.style.height = '';
    return;
  }
  const w = `${cw}px`;
  const h = `${ch}px`;
  if (sheetCard.style.width !== w) sheetCard.style.width = w;
  if (sheetCard.style.height !== h) sheetCard.style.height = h;
}

function measureGridGeometry() {
  const cardR = sheetCard.getBoundingClientRect();
  if (!(cardR.width > 0 && cardR.height > 0)) return;
  const headR = sheetTable.tHead.getBoundingClientRect();
  const footR = sheetTable.tFoot.getBoundingClientRect();
  const ths = sheetHead.cells;
  state.gridMetrics.headFoot.set([
    (headR.top - cardR.top) / cardR.height,
    (headR.bottom - cardR.top) / cardR.height,
    (footR.top - cardR.top) / cardR.height,
    (footR.bottom - cardR.top) / cardR.height,
  ]);
  if (ths.length >= 4) {
    state.gridMetrics.colSplits.set([
      (ths[1].getBoundingClientRect().left - cardR.left) / cardR.width,
      (ths[2].getBoundingClientRect().left - cardR.left) / cardR.width,
      (ths[3].getBoundingClientRect().left - cardR.left) / cardR.width,
    ]);
  }
  const rows = sheetBody.rows;
  const arr = state.gridMetrics.rows;
  arr.fill(0);
  const pillFracs = [0.68, 0.84, 0.62, 0.78, 0.58, 0.72];
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const r = rows[i].getBoundingClientRect();
    arr[i * 4] = (r.top - cardR.top) / cardR.height;
    arr[i * 4 + 1] = (r.bottom - cardR.top) / cardR.height;
    arr[i * 4 + 2] = pillFracs[i % pillFracs.length];
    arr[i * 4 + 3] = 1;
  }
}

export function recalculateSheetTotals(tableEl) {
  const body = tableEl.tBodies[0];
  let unitsSum = 0;
  let grandSum = 0;
  for (const tr of body.rows) {
    const rate = Number(tr.dataset.rate) || 0;
    const input = tr.querySelector('.qty-input');
    const raw = input?.value ?? '';
    const parsed = raw === '' ? 0 : Math.max(0, Number.parseFloat(raw));
    const units = Number.isFinite(parsed) ? parsed : 0;
    const rowTotal = units * rate;
    unitsSum += units;
    grandSum += rowTotal;
    const out = tr.querySelector('.row-total');
    if (out) out.textContent = formatMoney(rowTotal);
  }
  const unitsOut = tableEl.querySelector('#total-units, [data-total-units]');
  const grandOut = tableEl.querySelector('#sheet-total, [data-sheet-total]');
  if (unitsOut) unitsOut.textContent = String(Math.round(unitsSum * 100) / 100);
  if (grandOut) grandOut.textContent = formatMoney(grandSum);
  return { unitsSum, grandSum };
}

export function sortTableRows(tableEl, key, dir = 1) {
  const body = tableEl.tBodies[0];
  const rows = [...body.rows];
  const valueOf = (tr) => {
    if (key === 'item') return (tr.dataset.item || tr.cells[0]?.textContent || '').trim().toLowerCase();
    if (key === 'units') {
      const v = Number.parseFloat(tr.querySelector('.qty-input')?.value || '0');
      return Number.isFinite(v) ? v : 0;
    }
    if (key === 'rate') return Number(tr.dataset.rate) || 0;
    const units = Number.parseFloat(tr.querySelector('.qty-input')?.value || '0');
    const rate = Number(tr.dataset.rate) || 0;
    return (Number.isFinite(units) ? units : 0) * rate;
  };
  rows.sort((a, b) => {
    const x = valueOf(a);
    const y = valueOf(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  const useMoveBefore = typeof body.moveBefore === 'function';
  rows.forEach((tr, i) => {
    if (body.rows[i] !== tr) {
      if (useMoveBefore) body.moveBefore(tr, body.rows[i]);
      else body.insertBefore(tr, body.rows[i]);
    }
  });
  return useMoveBefore ? 'moveBefore' : 'insertBefore';
}

function syncRowDOMFromPreset(presetRows) {
  const rows = [...sheetBody.rows];
  const byId = new Map(rows.map((tr) => [tr.dataset.id, tr]));
  presetRows.forEach((data, idx) => {
    const tr = byId.get(data.id) || rows[idx];
    if (!tr) return;
    tr.dataset.id = data.id;
    tr.dataset.item = data.item;
    tr.dataset.rate = String(data.rate);
    const itemVal = tr.querySelector('.col-item .cell-val');
    const rateVal = tr.querySelector('.col-rate .cell-val');
    const qtyInput = tr.querySelector('.qty-input');
    if (itemVal) itemVal.textContent = data.item;
    if (rateVal) rateVal.textContent = formatMoney(data.rate);
    if (qtyInput) {
      qtyInput.value = String(data.units);
      qtyInput.setAttribute('aria-label', `Units for ${data.item}`);
    }
  });
  recalculateSheetTotals(sheetTable);
}

function setSheetEmpty(empty) {
  state.isEmpty = empty;
  if (empty) {
    sheetCard.dataset.empty = 'true';
    for (const tr of sheetBody.rows) {
      const inp = tr.querySelector('.qty-input');
      if (inp) inp.value = '';
    }
    recalculateSheetTotals(sheetTable);
    statePillEl.textContent = `${sheetBody.rows.length} empty`;
  } else {
    delete sheetCard.dataset.empty;
    statePillEl.textContent = `${sheetBody.rows.length} rows`;
  }
}

function updateControlsUI() {
  const pct = Math.round(state.progress * 100);
  scrubSlider.value = String(pct);
  scrubOut.textContent = `${pct}%`;
  widthOut.textContent = `${Math.round(state.bandWidth)} px`;
}

function updateStatus() {
  const routeLabel = state.mode === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.mode === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const phaseLabel = state.progress >= 0.995
    ? (state.isEmpty ? 'Empty grid' : 'Revealed')
    : state.progress <= 0.005
      ? 'Before sweep'
      : `Wavefront ${(state.progress * 100).toFixed(0)}%`;
  const sourceLabel = state.beforeMode === 1 ? 'FBO snapshot' : 'Skeleton grid';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  statusEl.textContent = `${routeLabel} · ${phaseLabel} (${sourceLabel}) · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads · ${state.snapshots} FBO captures.`;
}

// #region geometry-sync
function cachedUnit(cw) {
  const zoom = sheetCard.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${cw}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, sheetCard, cw);
    state.unitCache.key = key;
    state.lastGeoKey = '';
  }
  return state.unitCache.unit;
}

export function syncSheetGeometry(force = false) {
  if (state.mode === 'plain' || typeof canvas.updateElementGeometry !== 'function') return;
  const { cw, ch } = getViewportSize();
  const geoKey = `${cw}x${ch}`;
  if (!force && geoKey === state.lastGeoKey) return;
  state.lastGeoKey = geoKey;
  if (state.mode === 'webgl') {
    const u = cachedUnit(cw);
    canvas.updateElementGeometry(sheetCard, {
      canvasTransform: new DOMMatrix().scale(u, u),
    });
  }
  sheetCard.dataset.hitTick = sheetCard.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function captureBeforeMutation() {
  if (state.mode === 'webgl' && stage && !stage.lost && prevFbo && cardTex && state.hasUploaded) {
    const ok = captureSnapshot(stage.gl, prevFbo, cardTex);
    if (ok) {
      state.snapshots++;
      state.beforeMode = 1;
      return true;
    }
  } else if (state.mode === '2d' && canvas.width > 0 && canvas.height > 0 && prev2dCtx) {
    if (prev2dCanvas.width !== canvas.width || prev2dCanvas.height !== canvas.height) {
      prev2dCanvas.width = canvas.width;
      prev2dCanvas.height = canvas.height;
    }
    prev2dCtx.clearRect(0, 0, prev2dCanvas.width, prev2dCanvas.height);
    prev2dCtx.drawImage(canvas, 0, 0);
    state.snapshots++;
    state.beforeMode = 1;
    return true;
  }
  return false;
}

function startSweep(durationMs = 920) {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  if (isReducedMotion() || state.mode === 'plain') {
    state.animating = false;
    state.progress = 1;
    updateControlsUI();
    drawCurrentFrame(true);
    return;
  }
  state.animating = true;
  state.animStart = performance.now();
  state.animDuration = durationMs;
  state.progress = 0;
  updateControlsUI();
  if (state.onScreen) {
    state.rafId = requestAnimationFrame(stepSweep);
  }
}

function stepSweep(now) {
  state.rafId = 0;
  if (!state.animating || !state.onScreen || state.mode === 'plain') return;
  if (state.pendingUpload) {
    state.animStart = now;
    drawCurrentFrame(false);
    state.rafId = requestAnimationFrame(stepSweep);
    return;
  }
  const elapsed = Math.max(0, now - state.animStart);
  const t = Math.min(1, elapsed / state.animDuration);
  // Smooth ease-in-out curve for the upward light band
  state.progress = t * t * (3 - 2 * t);
  updateControlsUI();
  if (t >= 1) {
    state.progress = 1;
    state.animating = false;
    updateControlsUI();
    drawCurrentFrame(false);
    return;
  }
  drawCurrentFrame(false);
  state.rafId = requestAnimationFrame(stepSweep);
}

function uploadSheetWebGL() {
  if (!stage || stage.lost || !state.hasPainted) return null;
  try {
    const tex = stage.upload(sheetCard);
    if (tex) {
      cardTex = tex;
      state.hasUploaded = true;
      state.pendingUpload = false;
      state.uploads++;
    }
    return tex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return cardTex;
    }
    throw err;
  }
}

function renderWebGL(shouldUpload = false) {
  if (!stage || stage.lost || !state.hasPainted) return;
  const { cw, ch } = getViewportSize();
  syncCardSize(cw, ch);

  if (shouldUpload || !state.hasUploaded) {
    uploadSheetWebGL();
  }
  if (!cardTex) return;

  measureGridGeometry();
  if (!stage.begin([0, 0, 0, 0])) return;
  syncSheetGeometry(false);

  const params = sweepParameters(state.progress, state.bandWidth);
  stage.quad(sheetCard, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, prevFbo ? prevFbo.tex : cardTex.tex);
    gl.uniform1i(loc('uPrevTex'), 1);
    gl.uniform1f(loc('uProgress'), params.p);
    gl.uniform1f(loc('uBandWidth'), params.bandPx);
    gl.uniform1i(loc('uBeforeMode'), state.beforeMode);
    gl.uniform1f(loc('uAnimated'), isReducedMotion() ? 0 : 1);
    gl.uniform4fv(loc('uHeadFoot'), state.gridMetrics.headFoot);
    gl.uniform3fv(loc('uColSplits'), state.gridMetrics.colSplits);
    gl.uniform4fv(loc('uRows[0]'), state.gridMetrics.rows);
  });

  state.paints++;
  updateStatus();
}

// #region fallback-2d
function render2DFallback() {
  if (!ctx2d || !state.hasPainted) return;
  const { cw, ch } = getViewportSize();
  syncCardSize(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const params = sweepParameters(state.progress, state.bandWidth);
  const p = params.p;
  const band = params.bandPx;
  const sweepY = (1 - p) * ch;

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.clearRect(0, 0, cw, ch);

  if (p >= 0.999) {
    try {
      ctx2d.drawElementImage(sheetCard, 0, 0, cw, ch);
      state.hasUploaded = true;
      state.pendingUpload = false;
    } catch {}
  } else {
    // Top half: skeleton grid or previous 2D snapshot
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(0, 0, cw, Math.max(0, sweepY));
    ctx2d.clip();
    if (state.beforeMode === 1 && prev2dCanvas.width > 0) {
      ctx2d.drawImage(prev2dCanvas, 0, 0, cw, ch);
    } else {
      ctx2d.fillStyle = '#0e1118';
      ctx2d.fillRect(0, 0, cw, ch);
      ctx2d.strokeStyle = '#252c3b';
      ctx2d.lineWidth = 1;
      for (let y = 48; y < ch; y += 44) {
        ctx2d.beginPath();
        ctx2d.moveTo(0, y);
        ctx2d.lineTo(cw, y);
        ctx2d.stroke();
        ctx2d.fillStyle = '#1f2636';
        ctx2d.fillRect(14, y + 16, cw * 0.28, 10);
        ctx2d.fillRect(cw * 0.56, y + 16, cw * 0.14, 10);
        ctx2d.fillRect(cw * 0.80, y + 16, cw * 0.14, 10);
      }
    }
    ctx2d.restore();

    // Bottom half: live spreadsheet DOM drawn with 5-arg drawElementImage()
    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.rect(0, Math.max(0, sweepY), cw, ch - Math.max(0, sweepY));
    ctx2d.clip();
    try {
      ctx2d.drawElementImage(sheetCard, 0, 0, cw, ch);
      state.hasUploaded = true;
      state.pendingUpload = false;
    } catch {}
    ctx2d.restore();

    // Luminous sweep gradient band
    const topY = sweepY - band * 0.5;
    const botY = sweepY + band * 0.5;
    const grad = ctx2d.createLinearGradient(0, topY, 0, botY);
    grad.addColorStop(0, 'rgba(56, 189, 248, 0)');
    grad.addColorStop(0.32, 'rgba(56, 189, 248, 0.28)');
    grad.addColorStop(0.50, 'rgba(255, 242, 205, 0.86)');
    grad.addColorStop(0.68, 'rgba(251, 191, 36, 0.34)');
    grad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx2d.fillStyle = grad;
    ctx2d.fillRect(0, topY, cw, band);
  }

  ctx2d.restore();
  syncSheetGeometry(false);
  state.paints++;
  updateStatus();
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  state.animating = false;
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.progress = 1;
  stageBox.classList.add('is-plain');
  if (sheetCard.parentElement !== plainHost) {
    if (typeof plainHost.moveBefore === 'function' && sheetCard.isConnected) {
      try { plainHost.moveBefore(sheetCard, null); } catch { plainHost.append(sheetCard); }
    } else {
      plainHost.append(sheetCard);
    }
  }
  syncCardSize(0, 0);
  showNotice(reason);
  updateControlsUI();
  updateStatus();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (sheetCard.parentElement !== canvas) {
    if (typeof canvas.moveBefore === 'function' && sheetCard.isConnected) {
      try { canvas.moveBefore(sheetCard, null); } catch { canvas.append(sheetCard); }
    } else {
      canvas.append(sheetCard);
    }
  }
  showNotice('');
}
// #endregion fallback-2d

function drawCurrentFrame(forcePaint = false) {
  if (state.mode === 'plain') {
    enterPlainFallback(noticeEl.textContent || '');
    return;
  }
  if (!forcePaint && state.mode === 'webgl' && stage && !stage.lost && state.hasPainted && state.hasUploaded) {
    renderWebGL(false);
    return;
  }
  canvas.requestPaint?.();
}

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', () => {
    state.hasPainted = true;
    if (state.mode === 'webgl' && stage && !stage.lost) {
      renderWebGL(true);
    } else if (state.mode === '2d' && ctx2d) {
      render2DFallback();
    }
  });
  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing the spreadsheet as plain HTML.');
    }
  });
  cv.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      cv.requestPaint?.();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: SHEET_FRAG,
        onLost: () => {
          prevFbo = null;
          cardTex = null;
          state.hasUploaded = false;
          enterPlainFallback('The WebGL 2 context was lost. Showing the spreadsheet as plain HTML until restored.');
        },
        onRestored: () => {
          prevFbo = createSnapshotFBO(stage.gl);
          cardTex = null;
          state.hasPainted = false;
          state.hasUploaded = false;
          state.mode = 'webgl';
          exitPlainFallback();
          state.lastGeoKey = '';
          syncSheetGeometry(true);
          canvas.requestPaint?.();
        },
      });
      prevFbo = createSnapshotFBO(stage.gl);
      state.mode = 'webgl';
      wireCanvasEvents(canvas);
      syncSheetGeometry(true);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      prevFbo = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'sheet-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(sheetCard);
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
        showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 2D drawElementImage() fallback.');
      }
      wireCanvasEvents(canvas);
      syncSheetGeometry(true);
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the spreadsheet is shown as plain HTML.');
}

// Spreadsheet interaction listeners
sheetBody.addEventListener('input', (e) => {
  const input = e.target.closest('.qty-input');
  if (!input) return;
  if (state.isEmpty) {
    setSheetEmpty(false);
  }
  const tr = input.closest('tr');
  const item = ROW_PRESETS.flat().find((r) => r.id === tr?.dataset.id);
  if (tr) {
    const val = Number.parseFloat(input.value);
    const match = state.rowData.find((r) => r.id === tr.dataset.id);
    if (match) match.units = Number.isFinite(val) ? Math.max(0, val) : 0;
    else if (item) item.units = Number.isFinite(val) ? Math.max(0, val) : 0;
  }
  recalculateSheetTotals(sheetTable);
  drawCurrentFrame(true);
});

sheetHead.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-sort]');
  if (!btn) return;
  const th = btn.closest('th');
  const key = btn.dataset.sort;
  const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;

  captureBeforeMutation();
  for (const other of sheetHead.cells) other.setAttribute('aria-sort', 'none');
  th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');

  sortTableRows(sheetTable, key, dir);
  state.pendingUpload = state.mode !== 'plain';
  syncSheetGeometry(true);
  canvas.requestPaint?.();
  startSweep(860);
});

sweepBtn.addEventListener('click', () => {
  if (state.isEmpty) {
    captureBeforeMutation();
    setSheetEmpty(false);
    syncRowDOMFromPreset(state.rowData);
    state.pendingUpload = state.mode !== 'plain';
  } else {
    state.beforeMode = 0;
  }
  syncSheetGeometry(true);
  canvas.requestPaint?.();
  startSweep(960);
});

populateBtn.addEventListener('click', () => {
  captureBeforeMutation();
  if (!state.isEmpty) {
    state.presetIndex = (state.presetIndex + 1) % ROW_PRESETS.length;
  }
  state.rowData = ROW_PRESETS[state.presetIndex].map((r) => ({ ...r }));
  setSheetEmpty(false);
  syncRowDOMFromPreset(state.rowData);
  state.pendingUpload = state.mode !== 'plain';
  syncSheetGeometry(true);
  canvas.requestPaint?.();
  startSweep(960);
});

clearBtn.addEventListener('click', () => {
  captureBeforeMutation();
  if (!state.isEmpty) {
    setSheetEmpty(true);
    state.pendingUpload = state.mode !== 'plain';
  } else {
    state.beforeMode = 0;
  }
  syncSheetGeometry(true);
  canvas.requestPaint?.();
  startSweep(860);
});

scrubSlider.addEventListener('input', () => {
  cancelAnimationFrame(state.rafId);
  state.rafId = 0;
  state.animating = false;
  state.progress = Number(scrubSlider.value) / 100;
  updateControlsUI();
  drawCurrentFrame(false);
});

widthSlider.addEventListener('input', () => {
  state.bandWidth = Number(widthSlider.value);
  updateControlsUI();
  drawCurrentFrame(false);
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion() && state.animating) {
    state.animating = false;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    state.progress = 1;
    updateControlsUI();
  }
  drawCurrentFrame(false);
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  drawCurrentFrame(false);
});

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  } else if (state.mode !== 'plain') {
    if (state.animating && !state.rafId) {
      state.rafId = requestAnimationFrame(stepSweep);
    } else {
      drawCurrentFrame(false);
    }
  }
}, { threshold: 0.01 }).observe(stageBox);

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKey = '';
    const { cw, ch } = getViewportSize();
    syncCardSize(cw, ch);
    syncSheetGeometry(true);
    canvas.requestPaint?.();
  }
}).observe(viewportEl);

// Initialise spreadsheet values and graphics backend
syncRowDOMFromPreset(state.rowData);
updateControlsUI();
initBackend();

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function sampleCssPixel(gl, cv, cssX, cssY) {
  const px = new Uint8Array(4);
  const scaleX = cv.width / Math.max(1, cv.clientWidth);
  const scaleY = cv.height / Math.max(1, cv.clientHeight);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * scaleX)));
  const ry = Math.max(0, Math.min(cv.height - 1, cv.height - 1 - Math.round(cssY * scaleY)));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const lum = (p) => 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];

function makeTableFixture(w = 280, h = 210) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const card = document.createElement('div');
  card.setAttribute('drawable', '');
  card.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;background:#38bdf8;color:#0f172a;font:600 13px system-ui;padding:6px 6px 24px 6px`;

  const tbl = document.createElement('table');
  tbl.style.cssText = 'width:100%;height:176px;border-collapse:collapse;table-layout:fixed';
  tbl.innerHTML = `
    <thead>
      <tr style="height:34px">
        <th aria-sort="none"><button type="button" data-sort="item" style="width:100%;height:30px;background:#ffffff;color:#0f172a;border:1px solid #0284c7">Item</button></th>
        <th aria-sort="none"><button type="button" data-sort="units" style="width:100%;height:30px;background:#ffffff;color:#0f172a;border:1px solid #0284c7">Units</button></th>
        <th aria-sort="none"><button type="button" data-sort="total" style="width:100%;height:30px;background:#ffffff;color:#0f172a;border:1px solid #0284c7">Total</button></th>
      </tr>
    </thead>
    <tbody>
      <tr data-id="a" data-item="Beta" data-rate="10" style="height:36px">
        <td>Beta</td>
        <td><input type="number" inputmode="none" class="qty-input" value="4" aria-label="Beta units" style="width:54px;height:28px"></td>
        <td><output class="row-total">£40.00</output></td>
      </tr>
      <tr data-id="b" data-item="Alpha" data-rate="5" style="height:36px">
        <td>Alpha</td>
        <td><input type="number" inputmode="none" class="qty-input" value="2" aria-label="Alpha units" style="width:54px;height:28px"></td>
        <td><output class="row-total">£10.00</output></td>
      </tr>
      <tr data-id="c" data-item="Gamma" data-rate="20" style="height:36px">
        <td>Gamma</td>
        <td><input type="number" inputmode="none" class="qty-input" value="3" aria-label="Gamma units" style="width:54px;height:28px"></td>
        <td><output class="row-total">£60.00</output></td>
      </tr>
    </tbody>
    <tfoot>
      <tr style="height:34px">
        <td>Total</td>
        <td><output data-total-units>9</output></td>
        <td><output data-sheet-total>£110.00</output></td>
      </tr>
    </tfoot>`;
  card.append(tbl);
  cv.append(card);
  return { cv, card, tbl };
}

runTests(testsBody, [
  {
    name: 'ElementGL table upload and mid-sweep shader render skeleton top, luminous crest and revealed bottom cleanly',
    expect: 'pass',
    why: 'Builds an isolated ElementGL canvas on testStage(), uploads a live <table> via texElementSubImage2D(), renders at progress=0.5 and checks gl.getError() === 0 plus readPixels() across skeleton, wave peak and revealed cells.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280, H = 210;
      const { cv, card } = makeTableFixture(W, H);
      testStage().append(cv);
      let g = null;
      try {
        g = new ElementGL(cv, { fragment: SHEET_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const tex = g.upload(card);
        g.begin([0, 0, 0, 0]);
        g.quad(card, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, tex.tex);
          gl.uniform1i(loc('uPrevTex'), 1);
          gl.uniform1f(loc('uProgress'), 0.5);
          gl.uniform1f(loc('uBandWidth'), 56);
          gl.uniform1i(loc('uBeforeMode'), 0);
          gl.uniform1f(loc('uAnimated'), 0);
          gl.uniform4f(loc('uHeadFoot'), 0.03, 0.20, 0.72, 0.88);
          gl.uniform3f(loc('uColSplits'), 0.34, 0.67, 0.84);
        });
        const err = g.gl.getError();
        const topSkel = sampleCssPixel(g.gl, cv, 24, 24);
        const waveBand = sampleCssPixel(g.gl, cv, 140, 105);
        const botLive = sampleCssPixel(g.gl, cv, 140, 198);

        const topDarkOk = lum(topSkel) < 75;
        const wavePeakOk = lum(waveBand) > 180 && lum(waveBand) > lum(topSkel) + 100;
        const botRevealedOk = botLive[2] > botLive[0] + 40 && lum(botLive) > 130;
        return need(
          err === g.gl.NO_ERROR && tex?.w > 0 && topDarkOk && wavePeakOk && botRevealedOk,
          `gl.getError()=${err}, tex=${tex?.w}x${tex?.h}, skelLuma=${lum(topSkel).toFixed(0)}, waveLuma=${lum(waveBand).toFixed(0)}, botRgb=[${botLive.slice(0, 3)}].`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await new Promise((r) => setTimeout(r, 750));
      }
    },
  },
  {
    name: 'Pre-sort FBO snapshot capture preserves Y-orientation without flipping vertically',
    expect: 'pass',
    why: 'Uploads a red-top/blue-bottom element, captures it into prevFbo via gl.bindFramebuffer(), flips DOM to green-top/yellow-bottom, renders mid-sweep and verifies readPixels() reads red at top and yellow at bottom.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 220, H = 180;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${W}px;height:${H}px;display:block;position:relative`;
      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = `width:${W}px;height:${H}px;display:flex;flex-direction:column`;
      const topHalf = document.createElement('div');
      topHalf.style.cssText = 'flex:1;background:#ef4444';
      const botHalf = document.createElement('div');
      botHalf.style.cssText = 'flex:1;background:#2563eb';
      box.append(topHalf, botHalf);
      cv.append(box);
      testStage().append(cv);

      let g = null;
      let fbo = null;
      try {
        g = new ElementGL(cv, { fragment: SHEET_FRAG, attributes: { preserveDrawingBuffer: true } });
        fbo = createSnapshotFBO(g.gl);
        await nextPaint(cv);
        const t1 = g.upload(box);
        const okCap = captureSnapshot(g.gl, fbo, t1);

        topHalf.style.background = '#22c55e';
        botHalf.style.background = '#eab308';
        await nextPaint(cv);
        g.upload(box);

        g.begin([0, 0, 0, 0]);
        g.quad(box, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, fbo.tex);
          gl.uniform1i(loc('uPrevTex'), 1);
          gl.uniform1f(loc('uProgress'), 0.5);
          gl.uniform1f(loc('uBandWidth'), 24);
          gl.uniform1i(loc('uBeforeMode'), 1);
          gl.uniform1f(loc('uAnimated'), 0);
          gl.uniform4f(loc('uHeadFoot'), 0, 0, 0, 0);
        });
        const err = g.gl.getError();
        const topPx = sampleCssPixel(g.gl, cv, 110, 20);
        const botPx = sampleCssPixel(g.gl, cv, 110, 160);

        const topRedOk = topPx[0] > 180 && topPx[1] < 90 && topPx[2] < 90;
        const botYellowOk = botPx[0] > 180 && botPx[1] > 140 && botPx[2] < 80;
        return need(
          okCap && err === g.gl.NO_ERROR && topRedOk && botYellowOk,
          `gl.getError()=${err}, topOld=[${topPx.slice(0, 3)}] (red), botNew=[${botPx.slice(0, 3)}] (yellow).`
        );
      } finally {
        if (g && fbo) disposeSnapshotFBO(g.gl, fbo);
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await new Promise((r) => setTimeout(r, 750));
      }
    },
  },
  {
    name: 'Sorting rows and editing a quantity input updates row order and live <tfoot> total cleanly',
    expect: 'pass',
    why: 'On an isolated table fixture inside testStage(), edits a quantity input, verifies live <tfoot> total recalculation, sorts rows by item and units, and confirms row order and total.',
    run: async () => {
      const { cv, tbl } = makeTableFixture(280, 210);
      testStage().append(cv);
      try {
        const before = recalculateSheetTotals(tbl);
        const alphaInput = tbl.querySelector('tr[data-id="b"] .qty-input');
        alphaInput.value = '10';
        const afterEdit = recalculateSheetTotals(tbl);
        const moveMethod = sortTableRows(tbl, 'item', 1);
        const firstAfterItemSort = tbl.tBodies[0].rows[0].dataset.item;
        sortTableRows(tbl, 'total', -1);
        const firstAfterTotalDesc = tbl.tBodies[0].rows[0].dataset.item;
        const grandText = tbl.querySelector('[data-sheet-total]').textContent;

        return need(
          before.grandSum === 110 &&
          afterEdit.grandSum === 150 &&
          firstAfterItemSort === 'Alpha' &&
          firstAfterTotalDesc === 'Gamma' &&
          grandText === formatMoney(150),
          `before=${formatMoney(before.grandSum)}, edited=${grandText}, sort(${moveMethod})=[${firstAfterItemSort} -> ${firstAfterTotalDesc}].`
        );
      } finally {
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps sort button and cell <input> clickable via elementsFromPoint() mid-sweep',
    expect: 'pass',
    why: 'Applies geometryUnit()-scaled updateElementGeometry() plus dataset.hitTick on an isolated ElementGL table fixture frozen at progress=0.5 and checks elementsFromPoint() at a sort button and a revealed <input>.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 280, H = 210;
      const { cv, card, tbl } = makeTableFixture(W, H);
      testStage().append(cv);
      let g = null;
      let c2 = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: SHEET_FRAG });
        } else {
          c2 = cv.getContext('2d');
        }
        await nextPaint(cv);
        if (g) {
          const tex = g.upload(card);
          g.begin([0, 0, 0, 0]);
          g.quad(card, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tex.tex);
            gl.uniform1i(loc('uPrevTex'), 1);
            gl.uniform1f(loc('uProgress'), 0.5);
            gl.uniform1f(loc('uBandWidth'), 56);
            gl.uniform1i(loc('uBeforeMode'), 0);
            gl.uniform1f(loc('uAnimated'), 0);
            gl.uniform4f(loc('uHeadFoot'), 0.03, 0.20, 0.72, 0.88);
            gl.uniform3f(loc('uColSplits'), 0.34, 0.67, 0.84);
          });
          const u = geometryUnit(cv, card, W);
          cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(u, u) });
          card.dataset.hitTick = card.dataset.hitTick === '1' ? '0' : '1';
        } else if (c2) {
          c2.drawElementImage(card, 0, 0, W, H);
        }
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const sortBtn = tbl.querySelector('button[data-sort="units"]');
        const botInput = tbl.tBodies[0].rows[2].querySelector('.qty-input');
        const btnR = sortBtn.getBoundingClientRect();
        const inpR = botInput.getBoundingClientRect();
        const btnHits = document.elementsFromPoint(btnR.left + btnR.width * 0.5, btnR.top + btnR.height * 0.5);
        const inpHits = document.elementsFromPoint(inpR.left + inpR.width * 0.5, inpR.top + inpR.height * 0.5);

        return need(
          btnHits.includes(sortBtn) && inpHits.includes(botInput),
          `sortButtonHit=${btnHits.includes(sortBtn)}, revealedInputHit=${inpHits.includes(botInput)}.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
        await new Promise((r) => setTimeout(r, 750));
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'sheet-reveal stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !state.hasUploaded || !cardTex) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
]);
