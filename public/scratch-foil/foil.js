import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const MASK_W = 256;
const MASK_H = 192;
const GATE_CLEAR_THRESHOLD = 0.35;
const MASK_BYTE_OPEN = 128;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// #region shader
export const FOIL_THERMAL_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uMask;
uniform vec2 uSize;
uniform float uTime;
uniform int uMode;
uniform int uFinish;
uniform vec2 uTilt;
uniform float uFeedWave;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2D(vec2 p) {
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
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * noise2D(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}

vec4 renderScratchFoil() {
  vec4 card = texture(uTex, vUv);
  float m = texture(uMask, vUv).r;
  vec2 texel = vec2(1.0 / 256.0, 1.0 / 192.0) * 1.4;

  float mL = texture(uMask, clamp(vUv - vec2(texel.x, 0.0), 0.0, 1.0)).r;
  float mR = texture(uMask, clamp(vUv + vec2(texel.x, 0.0), 0.0, 1.0)).r;
  float mU = texture(uMask, clamp(vUv - vec2(0.0, texel.y), 0.0, 1.0)).r;
  float mD = texture(uMask, clamp(vUv + vec2(0.0, texel.y), 0.0, 1.0)).r;
  vec2 maskGrad = vec2(mR - mL, mD - mU);

  vec2 pxCoord = vUv * max(uSize, vec2(1.0));
  float tearNoise = fbm(pxCoord * 0.24) * 0.28 + hash21(floor(pxCoord * 0.9)) * 0.12;
  float midBand = smoothstep(0.02, 0.30, m) * (1.0 - smoothstep(0.70, 0.98, m));
  float edge = clamp(m + (tearNoise - 0.18) * midBand, 0.0, 1.0);

  float openMask = smoothstep(0.38, 0.58, edge);
  float flakeRim = smoothstep(0.16, 0.42, edge) * (1.0 - smoothstep(0.42, 0.74, edge));

  // Drop shadow cast by the raised foil edge onto the bright DOM card underneath.
  float mShadow = texture(uMask, clamp(vUv - vec2(0.007, 0.010), 0.0, 1.0)).r;
  float rimShadow = clamp(openMask - smoothstep(0.38, 0.62, mShadow), 0.0, 1.0);
  vec3 cardRgb = card.a > 0.001 ? card.rgb / card.a : vec3(1.0);
  vec3 underRgb = cardRgb * (1.0 - rimShadow * 0.34);

  // Anisotropic brushed metal strokes + fine satin sheen.
  float angle = 0.28;
  mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 bPos = rot * pxCoord;
  float brushMacro = fbm(vec2(bPos.x * 0.012, bPos.y * 0.24));
  float brushFine = sin(bPos.y * 0.65 + brushMacro * 4.8) * 0.5 + 0.5;
  float streak = mix(brushMacro, brushFine, 0.42);

  // Subtle sparse metallic micro-sparkles without blocky patches.
  vec2 flakeCell = floor(pxCoord * 1.15);
  float flakeRnd = hash21(flakeCell);
  float flakeMask = smoothstep(0.90, 0.99, flakeRnd);

  vec3 normal = normalize(vec3(
    (streak - 0.5) * 0.24 - maskGrad.x * 1.8,
    (brushMacro - 0.5) * 0.16 - maskGrad.y * 1.8,
    1.0
  ));

  vec3 lightDir = normalize(vec3(uTilt.x * 1.5 + 0.22, uTilt.y * 1.3 - 0.28, 1.0));
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVec = normalize(lightDir + viewDir);

  float diff = max(dot(normal, lightDir), 0.0);
  vec2 dv = vUv - (vec2(0.5, 0.5) + uTilt * 0.68);
  float bandPos = dv.x * 0.78 + dv.y * 0.62;
  float sheenBand = exp(-(bandPos * bandPos) * 7.2);
  float microSpec = pow(max(dot(normal, halfVec), 0.0001), 16.0) * 0.34;
  float glint = flakeMask * pow(max(dot(normal, halfVec), 0.0001), 20.0) * 0.24;

  // Printed security chevron motif + ticket bevel so intact foil reads immediately.
  float chevron = sin((pxCoord.x + abs(mod(pxCoord.y, 38.0) - 19.0)) * 0.23) * 0.5 + 0.5;
  float motif = mix(0.92, 1.07, smoothstep(0.32, 0.68, chevron));
  vec2 edgeDist = min(vUv, 1.0 - vUv);
  float borderBand = 1.0 - smoothstep(0.016, 0.036, min(edgeDist.x, edgeDist.y));

  vec3 shadowCol;
  vec3 baseCol;
  vec3 specCol;
  if (uFinish == 1) {
    // Hologram Silver
    shadowCol = vec3(0.43, 0.46, 0.52);
    baseCol = vec3(0.71, 0.75, 0.81);
    specCol = vec3(0.92, 0.95, 0.99);
    float grating = dot(pxCoord, vec2(0.036, 0.022)) + (uTilt.x * 4.2 + uTilt.y * 3.0) + streak * 1.25;
    vec3 rainbow = 0.5 + 0.5 * cos(grating + vec3(0.0, 2.094, 4.188));
    baseCol = mix(baseCol, rainbow * 0.68 + 0.26, 0.26 + 0.16 * sheenBand);
    specCol = mix(specCol, rainbow * 0.42 + 0.56, 0.35);
  } else if (uFinish == 2) {
    // Copper Foil
    shadowCol = vec3(0.38, 0.16, 0.09);
    baseCol = vec3(0.73, 0.37, 0.22);
    specCol = vec3(0.96, 0.74, 0.58);
  } else {
    // Brushed Gold
    shadowCol = vec3(0.45, 0.30, 0.08);
    baseCol = vec3(0.78, 0.58, 0.20);
    specCol = vec3(0.98, 0.87, 0.50);
  }

  vec3 foilRgb = mix(shadowCol, baseCol, 0.28 + 0.72 * streak) * (0.76 + 0.26 * diff) * motif;
  foilRgb = mix(foilRgb, specCol, clamp(sheenBand * 0.42 + microSpec * 0.44, 0.0, 0.68));
  foilRgb += specCol * glint;
  foilRgb = mix(foilRgb, foilRgb * 0.82 + specCol * 0.16, borderBand * 0.55);
  foilRgb += mix(specCol, vec3(1.0), 0.25) * flakeRim * (0.38 + 0.28 * streak);

  vec3 finalRgb = mix(foilRgb, underRgb, openMask);
  float outAlpha = mix(1.0, card.a, openMask);
  return vec4(finalRgb * outAlpha, outAlpha);
}

vec4 renderThermalPaper() {
  vec4 receipt = texture(uTex, vUv);
  float heat = texture(uMask, vUv).r;
  vec2 pxCoord = vUv * max(uSize, vec2(1.0));

  float grain = (hash21(floor(pxCoord * 0.9)) - 0.5) * 0.026 + (fbm(pxCoord * 0.08) - 0.5) * 0.024;
  float topCurl = exp(-vUv.y * 15.0);
  float botCurl = exp(-(1.0 - vUv.y) * 11.0);
  float feedRipple = 0.0;
  if (uFeedWave > -0.25) {
    float waveDist = vUv.y - uFeedWave;
    feedRipple = exp(-(waveDist * waveDist) * 42.0) * 0.20;
  }

  // Serrated tear-off teeth along top and bottom receipt edges.
  float tooth = abs(mod(pxCoord.x, 12.0) - 6.0) / 6.0;
  float topCut = smoothstep(0.0, 0.012, vUv.y - tooth * 0.008);
  float botCut = smoothstep(0.0, 0.012, (1.0 - vUv.y) - tooth * 0.008);
  float paperAlpha = topCut * botCut;

  vec3 waxyPaper = vec3(0.955, 0.942, 0.902) + grain;
  float curlBand = (vUv.y - 0.11) * 11.0;
  waxyPaper *= 1.0 - topCurl * 0.14 - botCurl * 0.18 - feedRipple;
  waxyPaper += vec3(0.035, 0.035, 0.028) * exp(-(curlBand * curlBand));

  // Warm amber scorch halo surrounds heated regions.
  float halo = smoothstep(0.14, 0.44, heat) * (1.0 - smoothstep(0.58, 0.96, heat) * 0.24);
  float scorchEdge = smoothstep(0.74, 1.0, heat);
  vec3 amberPaper = mix(waxyPaper, vec3(0.91, 0.72, 0.41) + grain, halo * 0.58);
  amberPaper = mix(amberPaper, vec3(0.84, 0.60, 0.30) + grain, scorchEdge * 0.34);

  vec3 receiptRgb = receipt.a > 0.001 ? receipt.rgb / receipt.a : vec3(1.0);
  float receiptLuma = dot(receiptRgb, vec3(0.299, 0.587, 0.114));
  float domInk = clamp(1.0 - receiptLuma, 0.0, 1.0) * receipt.a;

  float develop = smoothstep(0.24, 0.54, heat);
  vec3 carbonBlack = vec3(0.055, 0.050, 0.048) + grain * 0.35;
  vec3 warmInk = vec3(0.45, 0.24, 0.10);
  vec3 inkColor = mix(warmInk, carbonBlack, smoothstep(0.36, 0.72, heat));

  vec3 thermalRgb = mix(amberPaper, inkColor, domInk * develop);
  float sideShade = smoothstep(0.0, 0.024, vUv.x) * smoothstep(0.0, 0.024, 1.0 - vUv.x);
  thermalRgb *= mix(0.84, 1.0, sideShade);

  return vec4(thermalRgb * paperAlpha, paperAlpha);
}

void main() {
  if (uMode == 1) {
    outColor = renderThermalPaper();
  } else {
    outColor = renderScratchFoil();
  }
}`;
// #endregion shader

// #region mask
export class MaskBuffer {
  constructor(w = MASK_W, h = MASK_H) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h);
    this.dirty = { active: false, x0: w, y0: h, x1: -1, y1: -1 };
  }

  resetDirty() {
    this.dirty.active = false;
    this.dirty.x0 = this.w;
    this.dirty.y0 = this.h;
    this.dirty.x1 = -1;
    this.dirty.y1 = -1;
  }

  markDirty(x0, y0, x1, y1) {
    const d = this.dirty;
    d.active = true;
    if (x0 < d.x0) d.x0 = x0;
    if (y0 < d.y0) d.y0 = y0;
    if (x1 > d.x1) d.x1 = x1;
    if (y1 > d.y1) d.y1 = y1;
  }

  markAllDirty() {
    this.markDirty(0, 0, this.w - 1, this.h - 1);
  }

  fill(value) {
    this.data.fill(value);
    this.markAllDirty();
  }

  // Stamp a jagged coin or thumbnail stroke into the R8 scratch mask.
  stampScratch(normX, normY, radiusPx = 12, strokeAngle = 0, seed = 0) {
    const cx = clamp(normX, 0, 1) * (this.w - 1);
    const cy = clamp(normY, 0, 1) * (this.h - 1);
    const r = Math.max(3, radiusPx);
    const pad = Math.ceil(r * 1.25);
    const x0 = Math.max(0, Math.floor(cx - pad));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + pad));
    const y0 = Math.max(0, Math.floor(cy - pad));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + pad));
    const cosA = Math.cos(strokeAngle);
    const sinA = Math.sin(strokeAngle);

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * this.w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        // Slight coin elongation perpendicular to motion + serrated chip profile.
        const lx = dx * cosA + dy * sinA;
        const ly = -dx * sinA + dy * cosA;
        const dist = Math.hypot(lx * 1.12, ly * 0.90);
        if (dist > r * 1.2) continue;

        const theta = Math.atan2(ly, lx);
        const jag = 0.84 + 0.14 * Math.sin(theta * 7 + seed) + 0.08 * Math.cos(theta * 13 - seed * 1.7);
        const effR = r * jag;
        if (dist > effR) continue;

        const idx = row + x;
        if (dist <= effR * 0.78) {
          this.data[idx] = 255;
        } else {
          // Flaky crumb boundary driven by deterministic integer hash.
          const grit = ((x * 73856093 ^ y * 19349663 ^ ((seed * 97) | 0)) >>> 0) & 255;
          const rimT = 1 - (dist - effR * 0.78) / Math.max(0.001, effR * 0.22);
          const next = Math.round(clamp(rimT * 235 + (grit > 140 ? 60 : -55), 0, 255));
          if (next > this.data[idx]) this.data[idx] = next;
        }
      }
    }
    this.markDirty(x0, y0, x1, y1);
  }

  // Stamp thermal stylus heat; holding still drives temperatures up into carbon black.
  stampHeat(normX, normY, radiusPx = 15, strength = 0.36) {
    const cx = clamp(normX, 0, 1) * (this.w - 1);
    const cy = clamp(normY, 0, 1) * (this.h - 1);
    const r = Math.max(4, radiusPx);
    const r2 = r * r;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r));

    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * this.w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const t = 1 - Math.sqrt(d2) / r;
        const falloff = t * t * (3 - 2 * t);
        const idx = row + x;
        const cur = this.data[idx];
        const next = Math.min(255, Math.round(cur + (255 - cur) * Math.min(1, falloff * strength)));
        if (next > cur) this.data[idx] = next;
      }
    }
    this.markDirty(x0, y0, x1, y1);
  }

  cool(dropByte = 1) {
    let minX = this.w;
    let minY = this.h;
    let maxX = -1;
    let maxY = -1;
    let stillHot = false;
    for (let y = 0; y < this.h; y++) {
      const row = y * this.w;
      for (let x = 0; x < this.w; x++) {
        const idx = row + x;
        const v = this.data[idx];
        if (v === 0) continue;
        const next = v > dropByte ? v - dropByte : 0;
        this.data[idx] = next;
        if (next > 0) stillHot = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX >= minX && maxY >= minY) {
      this.markDirty(minX, minY, maxX, maxY);
      return { changed: true, stillHot };
    }
    return { changed: false, stillHot: false };
  }

  coverageInRect(u0, v0, u1, v1, threshold = MASK_BYTE_OPEN) {
    const x0 = clamp(Math.floor(u0 * (this.w - 1)), 0, this.w - 1);
    const x1 = clamp(Math.ceil(u1 * (this.w - 1)), x0, this.w - 1);
    const y0 = clamp(Math.floor(v0 * (this.h - 1)), 0, this.h - 1);
    const y1 = clamp(Math.ceil(v1 * (this.h - 1)), y0, this.h - 1);
    let hit = 0;
    let total = 0;
    for (let y = y0; y <= y1; y++) {
      const row = y * this.w;
      for (let x = x0; x <= x1; x++) {
        total++;
        if (this.data[row + x] >= threshold) hit++;
      }
    }
    return total ? hit / total : 0;
  }

  overallCoverage(threshold = MASK_BYTE_OPEN) {
    let hit = 0;
    const len = this.data.length;
    for (let i = 0; i < len; i++) {
      if (this.data[i] >= threshold) hit++;
    }
    return hit / len;
  }
}

function ensureMaskTexture(gl, texState, maskBuf) {
  if (texState.tex) return;
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, maskBuf.w, maskBuf.h, 0, gl.RED, gl.UNSIGNED_BYTE, maskBuf.data);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.bindTexture(gl.TEXTURE_2D, null);
  texState.tex = tex;
  maskBuf.resetDirty();
}

function uploadMaskDirty(gl, texState, maskBuf) {
  ensureMaskTexture(gl, texState, maskBuf);
  if (!maskBuf.dirty.active) return;
  const d = maskBuf.dirty;
  const dx = clamp(d.x0, 0, maskBuf.w - 1);
  const dy = clamp(d.y0, 0, maskBuf.h - 1);
  const dw = clamp(d.x1 - dx + 1, 1, maskBuf.w - dx);
  const dh = clamp(d.y1 - dy + 1, 1, maskBuf.h - dy);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texState.tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, maskBuf.w);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, dx);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, dy);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, dx, dy, dw, dh, gl.RED, gl.UNSIGNED_BYTE, maskBuf.data);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.activeTexture(gl.TEXTURE0);
  maskBuf.resetDirty();
}
// #endregion mask

// #region gating
export function measureElementBox(el, surfaceEl) {
  let x = 0;
  let y = 0;
  let cur = el;
  while (cur && cur !== surfaceEl) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent;
  }
  const sw = Math.max(1, surfaceEl.offsetWidth);
  const sh = Math.max(1, surfaceEl.offsetHeight);
  return {
    el,
    u0: clamp(x / sw, 0, 1),
    v0: clamp(y / sh, 0, 1),
    u1: clamp((x + el.offsetWidth) / sw, 0, 1),
    v1: clamp((y + el.offsetHeight) / sh, 0, 1),
  };
}

export function syncGatedControls(boxes, maskBuf, surfaceEl, forceOpen = false, threshold = GATE_CLEAR_THRESHOLD) {
  let openCount = 0;
  let changed = false;
  for (const box of boxes) {
    const cov = maskBuf.coverageInRect(box.u0, box.v0, box.u1, box.v1);
    const isOpen = forceOpen || cov > threshold;
    if (isOpen) openCount++;
    const nextState = isOpen ? 'open' : 'closed';
    if (box.el.dataset.gated !== nextState) {
      box.el.dataset.gated = nextState;
      box.el.tabIndex = isOpen ? 0 : -1;
      if (isOpen) box.el.removeAttribute('aria-disabled');
      else box.el.setAttribute('aria-disabled', 'true');
      box.el.dataset.hitTick = box.el.dataset.hitTick === '1' ? '0' : '1';
      changed = true;
    }
  }
  if (changed && surfaceEl) {
    surfaceEl.dataset.hitTick = surfaceEl.dataset.hitTick === '1' ? '0' : '1';
  }
  return { openCount, totalCount: boxes.length, changed };
}
// #endregion gating

function mountScratchFoil() {
  banner();

  const stageEl = document.getElementById('sf-stage');
  const canvas = document.getElementById('sf-canvas');
  const surfaceEl = document.getElementById('sf-surface');
  const foilCardEl = document.getElementById('sf-foil-card');
  const receiptEl = document.getElementById('sf-receipt');

  const nameInput = document.getElementById('sf-name-input');
  const nameEchoEl = document.getElementById('sf-name-echo');
  const claimBtn = document.getElementById('sf-claim-btn');
  const claimCountEl = document.getElementById('sf-claim-count');
  const spinBtn = document.getElementById('sf-spin-btn');
  const spinValEl = document.getElementById('sf-spin-val');
  const prizeBadgeEl = document.getElementById('sf-prize-badge');
  const swatchBtns = [...foilCardEl.querySelectorAll('[data-swatch]')];

  const receiptNumEl = document.getElementById('sf-receipt-num');
  const itemInput = document.getElementById('sf-item-input');
  const qtyMinusBtn = document.getElementById('sf-qty-minus');
  const qtyPlusBtn = document.getElementById('sf-qty-plus');
  const qtyValEl = document.getElementById('sf-qty-val');
  const feeBtn = document.getElementById('sf-fee-btn');
  const subtotalEl = document.getElementById('sf-subtotal');

  const surfaceBtns = [...document.querySelectorAll('.sf-surface-toggle button[data-surface]')];
  const foilToolsEl = document.getElementById('sf-foil-tools');
  const finishBtns = [...document.querySelectorAll('.sf-foil-tools button[data-finish]')];
  const revealBtn = document.getElementById('sf-reveal-btn');
  const recoatBtn = document.getElementById('sf-recoat-btn');

  const thermalToolsEl = document.getElementById('sf-thermal-tools');
  const feedBtn = document.getElementById('sf-feed-btn');
  const heatAllBtn = document.getElementById('sf-heat-all-btn');
  const coolCheck = document.getElementById('sf-cool-check');

  const statusEl = document.getElementById('sf-status');
  const telemetryEl = document.getElementById('sf-telemetry');
  const noticeEl = document.getElementById('sf-notice');

  const reducedMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const foilMask = new MaskBuffer(MASK_W, MASK_H);
  const heatMask = new MaskBuffer(MASK_W, MASK_H);

  const SPINS = ['2x', '5x', '10x', '25x', '100x'];
  const state = {
    mode: 'foil', // 'foil' | 'thermal'
    finish: 0,    // 0: gold, 1: silver, 2: copper
    claimed: 0,
    spinIdx: 0,
    receiptNum: 42,
    qty: 2,
    expressFee: true,
    coolSlowly: coolCheck.checked,
    revealed: false,
    tiltX: 0.08,
    tiltY: -0.10,
    targetTiltX: 0.08,
    targetTiltY: -0.10,
    feedOffsetY: 0,
    feedWave: -0.5,
    feedUntil: 0,
    coolCarry: 0,
    isVisible: true,
  };

  let route = 'plain';
  let stage = null;
  let ctx2d = null;
  const maskTexState = { tex: null };
  let lostTimer = 0;
  let rafId = 0;
  let lastTick = 0;
  let controlBoxes = [];
  let boxesDirty = true;

  // Offscreen plain canvases for the 2D fallback (never marked drawable).
  const fallback2d = {
    coat: null,
    coatCtx: null,
    cut: null,
    cutCtx: null,
    w: 512,
    h: 384,
  };

  const say = (text) => {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  };
  const clearNotice = () => {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  };

  function activeMask() {
    return state.mode === 'thermal' ? heatMask : foilMask;
  }

  function activeSection() {
    return state.mode === 'thermal' ? receiptEl : foilCardEl;
  }

  function refreshControlBoxes() {
    const els = [...activeSection().querySelectorAll('[data-gate]')];
    controlBoxes = els.map((el) => measureElementBox(el, surfaceEl));
    boxesDirty = false;
  }

  function syncMaskAndStatus() {
    if (boxesDirty) refreshControlBoxes();
    const mask = activeMask();
    const res = syncGatedControls(controlBoxes, mask, surfaceEl, route === 'plain');
    const pct = Math.round(mask.overallCoverage() * 100);
    if (state.mode === 'foil') {
      statusEl.textContent = `${pct}% scratched · ${res.openCount} of ${res.totalCount} controls open`;
    } else {
      statusEl.textContent = `${pct}% developed · ${res.openCount} of ${res.totalCount} receipt controls warm`;
    }
    if (res.changed && route !== 'plain') {
      lastGeoKey = '';
      canvas.requestPaint?.();
    }
  }

  function updateTelemetry() {
    const openSnaps = window.__gfx?.snapshots?.open ?? 0;
    const unasked = window.__gfx?.reads?.unasked ?? 0;
    const routeLabel = route === 'webgl' ? 'WebGL 2 (ElementGL)' : route === '2d' ? '2D fallback' : 'Plain HTML';
    const modeLabel = state.mode === 'foil' ? 'Metallic foil' : 'Thermal paper';
    telemetryEl.textContent =
      `Route: ${routeLabel} · Mode: ${modeLabel} · Mask: ${MASK_W}x${MASK_H} R8 · ` +
      `openSnapshots: ${openSnaps} · unasked readbacks: ${unasked}`;
  }

  function enterPlainFallback(reason) {
    clearTimeout(lostTimer);
    lostTimer = 0;
    route = 'plain';
    stageEl.classList.add('plain');
    stageEl.append(surfaceEl);
    syncMaskAndStatus();
    say(reason);
    updateTelemetry();
  }

  function ensure2DFallbackCanvases() {
    if (fallback2d.coat) return;
    fallback2d.coat = document.createElement('canvas');
    fallback2d.coat.width = fallback2d.w;
    fallback2d.coat.height = fallback2d.h;
    fallback2d.coatCtx = fallback2d.coat.getContext('2d');
    fallback2d.cut = document.createElement('canvas');
    fallback2d.cut.width = fallback2d.w;
    fallback2d.cut.height = fallback2d.h;
    fallback2d.cutCtx = fallback2d.cut.getContext('2d');
    sync2DCutFromMask();
  }

  function sync2DCutFromMask() {
    if (!fallback2d.cutCtx) return;
    const { cutCtx, w, h } = fallback2d;
    const mask = activeMask();
    cutCtx.clearRect(0, 0, w, h);
    cutCtx.fillStyle = '#000';
    const sx = w / mask.w;
    const sy = h / mask.h;
    for (let y = 0; y < mask.h; y++) {
      const row = y * mask.w;
      for (let x = 0; x < mask.w; x++) {
        if (mask.data[row + x] >= MASK_BYTE_OPEN) {
          cutCtx.fillRect(x * sx, y * sy, sx + 0.5, sy + 0.5);
        }
      }
    }
  }

  function stamp2DCut(nx, ny, radiusPx) {
    if (!fallback2d.cutCtx) return;
    const { cutCtx, w, h } = fallback2d;
    const r = (radiusPx / MASK_W) * w;
    cutCtx.fillStyle = '#000';
    cutCtx.beginPath();
    cutCtx.arc(nx * w, ny * h, r, 0, Math.PI * 2);
    cutCtx.fill();
  }

  function draw2DFallback(cw, ch) {
    ensure2DFallbackCanvases();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const cardW = surfaceEl.offsetWidth || cw;
    const cardH = surfaceEl.offsetHeight || ch;
    ctx2d.reset();
    ctx2d.scale(dpr, dpr);
    ctx2d.clearRect(0, 0, cw, ch);
    ctx2d.drawElementImage(surfaceEl, 0, state.feedOffsetY, cardW, cardH);

    const { coat, coatCtx, cut, w, h } = fallback2d;
    coatCtx.globalCompositeOperation = 'source-over';
    coatCtx.clearRect(0, 0, w, h);

    if (state.mode === 'foil') {
      const palettes = [
        ['#7a531a', '#d7a846', '#f9efc1', '#a67628'],
        ['#7a828f', '#cbd2dc', '#f5f8fc', '#959eab'],
        ['#6a2f1d', '#ca6c49', '#fed7bf', '#98472b'],
      ];
      const pal = palettes[state.finish] || palettes[0];
      const grad = coatCtx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, pal[0]);
      grad.addColorStop(0.35 + state.tiltX * 0.25, pal[2]);
      grad.addColorStop(0.65, pal[1]);
      grad.addColorStop(1, pal[3]);
      coatCtx.fillStyle = grad;
      coatCtx.fillRect(0, 0, w, h);

      coatCtx.strokeStyle = 'rgba(255,255,255,0.12)';
      coatCtx.lineWidth = 1;
      for (let y = 0; y < h; y += 4) {
        coatCtx.beginPath();
        coatCtx.moveTo(0, y);
        coatCtx.lineTo(w, y - 18);
        coatCtx.stroke();
      }
      // Stamp out scratched openings with destination-out.
      coatCtx.globalCompositeOperation = 'destination-out';
      coatCtx.drawImage(cut, 0, 0);
      coatCtx.globalCompositeOperation = 'source-over';
    } else {
      const paperGrad = coatCtx.createLinearGradient(0, 0, 0, h);
      paperGrad.addColorStop(0, '#dcd7ca');
      paperGrad.addColorStop(0.08, '#f5f2ea');
      paperGrad.addColorStop(0.92, '#f2eee4');
      paperGrad.addColorStop(1, '#d8d2c4');
      coatCtx.fillStyle = paperGrad;
      coatCtx.fillRect(0, 0, w, h);
      coatCtx.globalCompositeOperation = 'destination-out';
      coatCtx.drawImage(cut, 0, 0);
      coatCtx.globalCompositeOperation = 'source-over';
    }

    ctx2d.drawImage(coat, 0, state.feedOffsetY, cw, ch);
    const unit = geometryUnit(canvas, surfaceEl, cardW);
    canvas.updateElementGeometry(surfaceEl, {
      canvasTransform: new DOMMatrix().scale(unit).translate(0, state.feedOffsetY),
    });
  }

  // Try WebGL 2 via ElementGL first, then 2D, then plain HTML.
  if (supported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: FOIL_THERMAL_FRAGMENT,
        onLost: () => {
          maskTexState.tex = null;
          activeMask().markAllDirty();
          say('WebGL context lost. Waiting for restore before switching to plain HTML.');
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              enterPlainFallback('WebGL context stayed lost, so the card is shown as plain HTML.');
            }
          }, 1500);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          lostTimer = 0;
          clearNotice();
          activeMask().markAllDirty();
          canvas.requestPaint?.();
        },
      });
      route = 'webgl';
    } catch (err) {
      say(`WebGL could not start (${err.message}).`);
    }
  }

  if (route === 'plain' && supported) {
    try {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        route = '2d';
        say('WebGL texElementSubImage2D() is unavailable here, so the canvas uses a 2D destination-out and drawElementImage() fallback.');
      }
    } catch {}
  }

  if (route === 'plain') {
    enterPlainFallback('HTML-in-canvas is unavailable in this browser, so the controls are shown as plain HTML.');
  }

  // #region paint
  let lastGeoKey = '';
  function syncSurfaceGeometry(unit, offsetY) {
    const key = `${unit.toFixed(4)}:${offsetY.toFixed(1)}:${state.mode}`;
    if (key === lastGeoKey) return;
    lastGeoKey = key;
    canvas.updateElementGeometry(surfaceEl, {
      canvasTransform: new DOMMatrix().scale(unit).translate(0, offsetY),
    });
    surfaceEl.dataset.hitTick = surfaceEl.dataset.hitTick === '1' ? '0' : '1';
  }

  canvas.addEventListener('paint', () => {
    if (route === 'plain') return;
    const cw = canvas.clientWidth || 1;
    const ch = canvas.clientHeight || 1;

    if (route === 'webgl' && stage && !stage.lost) {
      const gl = stage.gl;
      stage.upload(surfaceEl);
      uploadMaskDirty(gl, maskTexState, activeMask());
      if (!stage.begin([0, 0, 0, 0])) return;

      stage.quad(surfaceEl, ElementGL.rect(canvas, 0, state.feedOffsetY, cw, ch), (g, uniform) => {
        g.activeTexture(g.TEXTURE1);
        g.bindTexture(g.TEXTURE_2D, maskTexState.tex);
        g.uniform1i(uniform('uMask'), 1);
        g.uniform1i(uniform('uMode'), state.mode === 'thermal' ? 1 : 0);
        g.uniform1i(uniform('uFinish'), state.finish);
        g.uniform2f(uniform('uTilt'), state.tiltX, state.tiltY);
        g.uniform1f(uniform('uFeedWave'), state.feedWave);
        g.activeTexture(g.TEXTURE0);
      });

      const unit = geometryUnit(canvas, surfaceEl, surfaceEl.offsetWidth || cw);
      syncSurfaceGeometry(unit, state.feedOffsetY);
      updateTelemetry();
      return;
    }

    if (route === '2d' && ctx2d) {
      draw2DFallback(cw, ch);
      updateTelemetry();
    }
  });
  // #endregion paint

  // Animation loop runs only while tilt is easing, stylus is held, paper is cooling or feeding.
  let activeDrag = null;

  function needsLoop(now) {
    if (!state.isVisible || document.hidden || route === 'plain') return false;
    const tiltMoving = Math.abs(state.tiltX - state.targetTiltX) > 0.003 || Math.abs(state.tiltY - state.targetTiltY) > 0.003;
    const stylusHeld = activeDrag && state.mode === 'thermal';
    const cooling = state.mode === 'thermal' && state.coolSlowly && !reducedMotion && heatMask.overallCoverage(1) > 0;
    const feeding = state.feedUntil > now;
    return tiltMoving || stylusHeld || cooling || feeding;
  }

  function ensureLoop() {
    if (!rafId && needsLoop(performance.now())) {
      lastTick = performance.now();
      rafId = requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    rafId = 0;
    if (!state.isVisible || document.hidden || route === 'plain') return;
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) / 1000));
    lastTick = now;
    let changed = false;

    const dx = state.targetTiltX - state.tiltX;
    const dy = state.targetTiltY - state.tiltY;
    if (Math.abs(dx) > 0.003 || Math.abs(dy) > 0.003) {
      const k = reducedMotion ? 1 : Math.min(1, dt * 12);
      state.tiltX += dx * k;
      state.tiltY += dy * k;
      changed = true;
    } else if (state.tiltX !== state.targetTiltX || state.tiltY !== state.targetTiltY) {
      state.tiltX = state.targetTiltX;
      state.tiltY = state.targetTiltY;
      changed = true;
    }

    if (activeDrag && state.mode === 'thermal') {
      heatMask.stampHeat(activeDrag.x, activeDrag.y, 16, Math.min(0.45, dt * 7.5));
      if (route === '2d') sync2DCutFromMask();
      syncMaskAndStatus();
      changed = true;
    }

    if (state.mode === 'thermal' && state.coolSlowly && !reducedMotion) {
      state.coolCarry += dt * 26;
      const drop = Math.floor(state.coolCarry);
      if (drop >= 1) {
        state.coolCarry -= drop;
        const res = heatMask.cool(drop);
        if (res.changed) {
          if (route === '2d') sync2DCutFromMask();
          syncMaskAndStatus();
          changed = true;
        }
      }
    }

    if (state.feedUntil > now) {
      const t = 1 - (state.feedUntil - now) / 650;
      const ease = 1 - Math.pow(1 - clamp(t, 0, 1), 3);
      state.feedOffsetY = -56 * (1 - ease);
      state.feedWave = -0.2 + ease * 1.4;
      changed = true;
    } else if (state.feedOffsetY !== 0 || state.feedWave > -0.25) {
      state.feedOffsetY = 0;
      state.feedWave = -0.5;
      changed = true;
    }

    if (changed) canvas.requestPaint?.();
    if (needsLoop(now)) {
      rafId = requestAnimationFrame(tick);
    }
  }

  const visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      state.isVisible = Boolean(entry?.isIntersecting);
      if (state.isVisible) ensureLoop();
    },
    { rootMargin: '80px' }
  );
  visibilityObserver.observe(stageEl);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) ensureLoop();
  });

  // Pointer brushing + tilt tracking.
  function normStagePoint(e) {
    const r = stageEl.getBoundingClientRect();
    return {
      x: clamp((e.clientX - r.left) / Math.max(1, r.width), 0, 1),
      y: clamp((e.clientY - r.top) / Math.max(1, r.height), 0, 1),
    };
  }

  function applyBrushStroke(x0, y0, x1, y1) {
    const mask = activeMask();
    const distPx = Math.hypot((x1 - x0) * MASK_W, (y1 - y0) * MASK_H);
    const steps = Math.max(1, Math.ceil(distPx / 2.5));
    const angle = Math.atan2(y1 - y0, x1 - x0);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const sx = x0 + (x1 - x0) * t;
      const sy = y0 + (y1 - y0) * t;
      if (state.mode === 'foil') {
        mask.stampScratch(sx, sy, 13, angle, (sx * 100 + sy * 173 + i) | 0);
        if (route === '2d') stamp2DCut(sx, sy, 13);
      } else {
        mask.stampHeat(sx, sy, 15, 0.34);
        if (route === '2d') sync2DCutFromMask();
      }
    }
    syncMaskAndStatus();
    if (route !== 'plain') canvas.requestPaint?.();
  }

  stageEl.addEventListener('pointerdown', (e) => {
    if (route === 'plain') return;
    const openControl = e.target instanceof Element ? e.target.closest('[data-gated="open"]') : null;
    if (openControl) return;

    const pt = normStagePoint(e);
    activeDrag = { id: e.pointerId, x: pt.x, y: pt.y, pointerType: e.pointerType };
    stageEl.setPointerCapture?.(e.pointerId);
    state.targetTiltX = pt.x - 0.5;
    state.targetTiltY = pt.y - 0.5;
    applyBrushStroke(pt.x, pt.y, pt.x, pt.y);
    ensureLoop();
  });

  stageEl.addEventListener('pointermove', (e) => {
    if (route === 'plain') return;
    const pt = normStagePoint(e);
    if (e.pointerType === 'mouse' || activeDrag?.id === e.pointerId) {
      state.targetTiltX = pt.x - 0.5;
      state.targetTiltY = pt.y - 0.5;
      ensureLoop();
    }
    if (!activeDrag || e.pointerId !== activeDrag.id) return;
    applyBrushStroke(activeDrag.x, activeDrag.y, pt.x, pt.y);
    activeDrag.x = pt.x;
    activeDrag.y = pt.y;
  });

  function endDrag(e) {
    if (!activeDrag || e.pointerId !== activeDrag.id) return;
    stageEl.releasePointerCapture?.(activeDrag.id);
    if (activeDrag.pointerType !== 'mouse') {
      state.targetTiltX = 0.08;
      state.targetTiltY = -0.10;
      ensureLoop();
    }
    activeDrag = null;
  }
  stageEl.addEventListener('pointerup', endDrag);
  stageEl.addEventListener('pointercancel', endDrag);
  stageEl.addEventListener('pointerleave', (e) => {
    if (!activeDrag && e.pointerType === 'mouse') {
      state.targetTiltX = 0.08;
      state.targetTiltY = -0.10;
      ensureLoop();
    }
  });

  // Card controls inside the live canvas.
  nameInput.addEventListener('input', () => {
    nameEchoEl.textContent = nameInput.value.trim() || 'Guest';
    if (route !== 'plain') canvas.requestPaint?.();
  });

  claimBtn.addEventListener('click', () => {
    state.claimed++;
    claimCountEl.textContent = String(state.claimed);
    if (route !== 'plain') canvas.requestPaint?.();
  });

  spinBtn.addEventListener('click', () => {
    state.spinIdx = (state.spinIdx + 1) % SPINS.length;
    const label = SPINS[state.spinIdx];
    spinValEl.textContent = label;
    prizeBadgeEl.textContent = `${label} BONUS`;
    if (route !== 'plain') canvas.requestPaint?.();
  });

  for (const btn of swatchBtns) {
    btn.addEventListener('click', () => {
      foilCardEl.dataset.theme = btn.dataset.swatch;
      for (const other of swatchBtns) other.setAttribute('aria-pressed', String(other === btn));
      if (route !== 'plain') canvas.requestPaint?.();
    });
  }

  function updateReceiptTotal() {
    qtyValEl.textContent = String(state.qty);
    const total = state.qty * 4.5 + (state.expressFee ? 1.5 : 0);
    subtotalEl.textContent = `£${total.toFixed(2)}`;
    if (route !== 'plain') canvas.requestPaint?.();
  }

  qtyMinusBtn.addEventListener('click', () => {
    state.qty = Math.max(1, state.qty - 1);
    updateReceiptTotal();
  });

  qtyPlusBtn.addEventListener('click', () => {
    state.qty = Math.min(99, state.qty + 1);
    updateReceiptTotal();
  });

  feeBtn.addEventListener('click', () => {
    state.expressFee = !state.expressFee;
    feeBtn.setAttribute('aria-pressed', String(state.expressFee));
    updateReceiptTotal();
  });

  itemInput.addEventListener('input', () => {
    if (route !== 'plain') canvas.requestPaint?.();
  });

  // External surface and material controls.
  function setSurfaceMode(mode) {
    state.mode = mode;
    const isThermal = mode === 'thermal';
    stageEl.classList.toggle('is-thermal', isThermal);
    foilCardEl.hidden = isThermal;
    receiptEl.hidden = !isThermal;
    foilToolsEl.hidden = isThermal;
    thermalToolsEl.hidden = !isThermal;
    for (const btn of surfaceBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.surface === mode));
    }
    activeMask().markAllDirty();
    if (route === '2d') sync2DCutFromMask();
    boxesDirty = true;
    lastGeoKey = '';
    syncMaskAndStatus();
    updateTelemetry();
    if (route !== 'plain') canvas.requestPaint?.();
    ensureLoop();
  }

  for (const btn of surfaceBtns) {
    btn.addEventListener('click', () => setSurfaceMode(btn.dataset.surface));
  }

  for (const btn of finishBtns) {
    btn.addEventListener('click', () => {
      state.finish = Number(btn.dataset.finish);
      for (const other of finishBtns) other.setAttribute('aria-pressed', String(other === btn));
      if (route !== 'plain') canvas.requestPaint?.();
    });
  }

  revealBtn.addEventListener('click', () => {
    state.revealed = !state.revealed;
    foilMask.fill(state.revealed ? 255 : 0);
    revealBtn.textContent = state.revealed ? 'Hide foil again' : 'Peek / Reveal all';
    if (route === '2d') sync2DCutFromMask();
    syncMaskAndStatus();
    if (route !== 'plain') canvas.requestPaint?.();
  });

  recoatBtn.addEventListener('click', () => {
    state.revealed = false;
    revealBtn.textContent = 'Peek / Reveal all';
    foilMask.fill(0);
    if (route === '2d') sync2DCutFromMask();
    syncMaskAndStatus();
    if (route !== 'plain') canvas.requestPaint?.();
  });

  feedBtn.addEventListener('click', () => {
    state.receiptNum++;
    receiptNumEl.textContent = `RECEIPT #${String(state.receiptNum).padStart(4, '0')}`;
    heatMask.fill(0);
    if (route === '2d') sync2DCutFromMask();
    syncMaskAndStatus();
    if (!reducedMotion) {
      state.feedUntil = performance.now() + 650;
      ensureLoop();
    }
    if (route !== 'plain') canvas.requestPaint?.();
  });

  heatAllBtn.addEventListener('click', () => {
    heatMask.fill(225);
    if (route === '2d') sync2DCutFromMask();
    syncMaskAndStatus();
    if (route !== 'plain') canvas.requestPaint?.();
    ensureLoop();
  });

  coolCheck.addEventListener('change', () => {
    state.coolSlowly = coolCheck.checked;
    ensureLoop();
  });

  const stageRO = new ResizeObserver(() => {
    boxesDirty = true;
    lastGeoKey = '';
    syncMaskAndStatus();
    if (route !== 'plain') canvas.requestPaint?.();
  });
  stageRO.observe(stageEl);

  window.addEventListener('pagehide', () => {
    clearTimeout(lostTimer);
    cancelAnimationFrame(rafId);
    rafId = 0;
    visibilityObserver.disconnect();
    stageRO.disconnect();
    if (stage) {
      if (maskTexState.tex && !stage.lost && !stage.gl.isContextLost()) {
        stage.gl.deleteTexture(maskTexState.tex);
      }
      maskTexState.tex = null;
      stage.dispose();
      stage = null;
    }
  });

  syncMaskAndStatus();
  updateTelemetry();

  // ---------------------------------------------------------------- live checks on isolated fixtures
  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  function makeFixture(w, h, html) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
    const card = document.createElement('div');
    card.setAttribute('drawable', '');
    card.style.cssText = `position:absolute;inset:0;width:${w}px;height:${h}px;overflow:hidden;pointer-events:none;`;
    card.innerHTML = html;
    cv.append(card);
    testStage().append(cv);
    return { cv, card };
  }

  function readCssPx(g, cv, cssX, cssY) {
    const gl = g.gl;
    const sx = cv.width / (cv.clientWidth || 1);
    const sy = cv.height / (cv.clientHeight || 1);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  const luma = (px) => 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];

  const tests = [
    {
      name: 'ElementGL + texElementSubImage2D() + R8 mask texSubImage2D() renders coated vs scratched regions with gl.getError() === 0',
      expect: 'pass',
      why: 'Uploads a bright green card via texElementSubImage2D() and a half-scratched 256 by 192 R8 mask via dirty-rect texSubImage2D(), checking metallic foil on the left and green DOM on the right.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
        const { cv, card } = makeFixture(200, 120, '<div style="width:100%;height:100%;background:#16a34a"></div>');
        let g = null;
        const fxTex = { tex: null };
        try {
          g = new ElementGL(cv, { fragment: FOIL_THERMAL_FRAGMENT, attributes: { preserveDrawingBuffer: true } });
          await nextPaint(cv);
          const gl = g.gl;
          while (gl.getError() !== gl.NO_ERROR) {}

          const mask = new MaskBuffer(MASK_W, MASK_H);
          ensureMaskTexture(gl, fxTex, mask);
          // Scratch right half via selective dirty-rect texSubImage2D.
          for (let y = 0; y < MASK_H; y++) {
            for (let x = MASK_W >> 1; x < MASK_W; x++) {
              mask.data[y * MASK_W + x] = 255;
            }
          }
          mask.markDirty(MASK_W >> 1, 0, MASK_W - 1, MASK_H - 1);
          uploadMaskDirty(gl, fxTex, mask);

          g.upload(card);
          g.begin([0, 0, 0, 1]);
          g.quad(card, ElementGL.rect(cv, 0, 0, 200, 120), (ctx, u) => {
            ctx.activeTexture(ctx.TEXTURE1);
            ctx.bindTexture(ctx.TEXTURE_2D, fxTex.tex);
            ctx.uniform1i(u('uMask'), 1);
            ctx.uniform1i(u('uMode'), 0);
            ctx.uniform1i(u('uFinish'), 0);
            ctx.uniform2f(u('uTilt'), 0.1, -0.1);
            ctx.uniform1f(u('uFeedWave'), -0.5);
            ctx.activeTexture(ctx.TEXTURE0);
          });

          const glErr = gl.getError();
          const coated = readCssPx(g, cv, 40, 60);
          const scratched = readCssPx(g, cv, 160, 60);
          return need(
            glErr === gl.NO_ERROR && coated[0] > coated[2] + 35 && scratched[1] > scratched[0] + 40,
            `gl.getError()=${glErr}; coated gold rgb(${coated[0]},${coated[1]},${coated[2]}); scratched green rgb(${scratched[0]},${scratched[1]},${scratched[2]}).`
          );
        } finally {
          if (g && fxTex.tex && !g.lost) g.gl.deleteTexture(fxTex.tex);
          g?.dispose();
          window.__gfx?.retire(cv);
        }
      },
    },
    {
      name: 'Scratching across a control box updates cleared fraction (> 0.35) and opens interactive clicking without GPU readback',
      expect: 'pass',
      why: 'Keeps a covered button gated until MaskBuffer strokes push its cleared fraction past 35%, then verifies elementsFromPoint() and click() succeed with zero GPU readbacks.',
      run: async () => {
        if (!supported) throw new Error('HTML-in-canvas is not available in this browser.');
        const { cv, card } = makeFixture(
          240,
          120,
          '<button id="fx-sf-gate" data-gate="test" type="button" style="position:absolute;left:48px;top:36px;width:120px;height:44px">Claim</button>'
        );
        let g = null;
        const fxTex = { tex: null };
        const mask = new MaskBuffer(MASK_W, MASK_H);
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: FOIL_THERMAL_FRAGMENT });
            const drawFx = () => {
              if (!g || g.lost) return;
              g.upload(card);
              uploadMaskDirty(g.gl, fxTex, mask);
              g.begin([0, 0, 0, 1]);
              g.quad(card, ElementGL.rect(cv, 0, 0, 240, 120), (ctx, u) => {
                ctx.activeTexture(ctx.TEXTURE1);
                ctx.bindTexture(ctx.TEXTURE_2D, fxTex.tex);
                ctx.uniform1i(u('uMask'), 1);
                ctx.uniform1i(u('uMode'), 0);
                ctx.uniform1i(u('uFinish'), 0);
                ctx.uniform2f(u('uTilt'), 0.08, -0.1);
                ctx.uniform1f(u('uFeedWave'), -0.5);
                ctx.activeTexture(ctx.TEXTURE0);
              });
            };
            cv.addEventListener('paint', drawFx);
            await nextPaint(cv);
          } else {
            const ctx = cv.getContext('2d');
            cv.width = 240;
            cv.height = 120;
            cv.addEventListener('paint', () => {
              ctx.reset();
              ctx.drawElementImage(card, 0, 0, 240, 120);
            });
            await nextPaint(cv);
          }

          const unit = geometryUnit(cv, card, 240);
          cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit) });

          const btn = card.querySelector('#fx-sf-gate');
          let clicks = 0;
          btn.addEventListener('click', () => { clicks++; });

          const box = measureElementBox(btn, card);
          const beforeCov = mask.coverageInRect(box.u0, box.v0, box.u1, box.v1);
          syncGatedControls([box], mask, card, false);

          const rect = cv.getBoundingClientRect();
          const cx = rect.left + 108;
          const cy = rect.top + 58;
          const beforeStack = document.elementsFromPoint(cx, cy);
          const blockedBefore = !beforeStack.includes(btn);

          const readsBefore = window.__gfx?.reads?.total ?? 0;
          for (let i = 0; i <= 6; i++) {
            mask.stampScratch(0.24 + i * 0.075, 0.48, 18, 0, i);
          }
          const afterCov = mask.coverageInRect(box.u0, box.v0, box.u1, box.v1);
          syncGatedControls([box], mask, card, false);
          await nextPaint(cv);
          cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit) });
          card.dataset.hitTick = card.dataset.hitTick === '1' ? '0' : '1';
          const readsAfter = window.__gfx?.reads?.total ?? 0;

          const afterStack = document.elementsFromPoint(cx, cy);
          const openAfter = afterStack.includes(btn);
          if (openAfter) btn.click();

          return need(
            blockedBefore && beforeCov === 0 && afterCov > 0.35 && openAfter && clicks === 1 && readsAfter === readsBefore,
            `Before cov=${beforeCov.toFixed(2)} (blocked=${blockedBefore}); after cov=${afterCov.toFixed(2)} (open=${openAfter}, clicks=${clicks}, readbacks=${readsAfter - readsBefore}).`
          );
        } finally {
          if (g && fxTex.tex && !g.lost) g.gl.deleteTexture(fxTex.tex);
          g?.dispose();
          window.__gfx?.retire(cv);
        }
      },
    },
    {
      name: 'Thermal Paper mode develops hidden dark DOM luminance where heat mask > 0.5',
      expect: 'pass',
      why: 'Draws a black receipt block under mode uMode = 1 with cold left half (0) and hot right half (220 > 0.5), checking pale paper vs dark carbon ink.',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
        const { cv, card } = makeFixture(200, 120, '<div style="width:100%;height:100%;background:#0b0a09"></div>');
        let g = null;
        const fxTex = { tex: null };
        try {
          g = new ElementGL(cv, { fragment: FOIL_THERMAL_FRAGMENT, attributes: { preserveDrawingBuffer: true } });
          await nextPaint(cv);
          const gl = g.gl;
          while (gl.getError() !== gl.NO_ERROR) {}

          const mask = new MaskBuffer(MASK_W, MASK_H);
          ensureMaskTexture(gl, fxTex, mask);
          for (let y = 0; y < MASK_H; y++) {
            for (let x = MASK_W >> 1; x < MASK_W; x++) {
              mask.data[y * MASK_W + x] = 220;
            }
          }
          mask.markDirty(MASK_W >> 1, 0, MASK_W - 1, MASK_H - 1);
          uploadMaskDirty(gl, fxTex, mask);

          g.upload(card);
          g.begin([0, 0, 0, 1]);
          g.quad(card, ElementGL.rect(cv, 0, 0, 200, 120), (ctx, u) => {
            ctx.activeTexture(ctx.TEXTURE1);
            ctx.bindTexture(ctx.TEXTURE_2D, fxTex.tex);
            ctx.uniform1i(u('uMask'), 1);
            ctx.uniform1i(u('uMode'), 1);
            ctx.uniform1i(u('uFinish'), 0);
            ctx.uniform2f(u('uTilt'), 0, 0);
            ctx.uniform1f(u('uFeedWave'), -0.5);
            ctx.activeTexture(ctx.TEXTURE0);
          });

          const glErr = gl.getError();
          const coldPx = readCssPx(g, cv, 40, 60);
          const hotPx = readCssPx(g, cv, 160, 60);
          const coldL = luma(coldPx);
          const hotL = luma(hotPx);
          return need(
            glErr === gl.NO_ERROR && coldL > 180 && hotL < 65 && coldL - hotL > 120,
            `gl.getError()=${glErr}; cold luma=${coldL.toFixed(0)} rgb(${coldPx[0]},${coldPx[1]},${coldPx[2]}); hot luma=${hotL.toFixed(0)} rgb(${hotPx[0]},${hotPx[1]},${hotPx[2]}).`
          );
        } finally {
          if (g && fxTex.tex && !g.lost) g.gl.deleteTexture(fxTex.tex);
          g?.dispose();
          window.__gfx?.retire(cv);
        }
      },
    },
    {
      name: 'updateElementGeometry() keeps uncovered <input> and buttons clickable via elementsFromPoint()',
      expect: 'pass',
      why: 'Places an uncovered input and button inside a drawable wrapper, updates geometry at rest and with a +14 px feed shift, and checks elementsFromPoint() hits both.',
      run: async () => {
        if (!supported) throw new Error('HTML-in-canvas is not available in this browser.');
        const { cv, card } = makeFixture(
          240,
          120,
          '<input id="fx-sf-in" type="text" value="Mint" style="position:absolute;left:16px;top:14px;width:190px;height:36px;pointer-events:auto">' +
          '<button id="fx-sf-btn" type="button" style="position:absolute;left:16px;top:62px;width:120px;height:38px;pointer-events:auto">Spin</button>'
        );
        let g = null;
        const fxTex = { tex: null };
        const mask = new MaskBuffer(MASK_W, MASK_H);
        mask.fill(255);
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: FOIL_THERMAL_FRAGMENT });
            cv.addEventListener('paint', () => {
              if (!g || g.lost) return;
              g.upload(card);
              uploadMaskDirty(g.gl, fxTex, mask);
              g.begin([0, 0, 0, 1]);
              g.quad(card, ElementGL.rect(cv, 0, 0, 240, 120), (ctx, u) => {
                ctx.activeTexture(ctx.TEXTURE1);
                ctx.bindTexture(ctx.TEXTURE_2D, fxTex.tex);
                ctx.uniform1i(u('uMask'), 1);
                ctx.uniform1i(u('uMode'), 0);
                ctx.uniform1i(u('uFinish'), 0);
                ctx.uniform2f(u('uTilt'), 0, 0);
                ctx.uniform1f(u('uFeedWave'), -0.5);
                ctx.activeTexture(ctx.TEXTURE0);
              });
            });
            await nextPaint(cv);
          } else {
            const ctx = cv.getContext('2d');
            cv.width = 240;
            cv.height = 120;
            cv.addEventListener('paint', () => {
              ctx.reset();
              ctx.drawElementImage(card, 0, 0, 240, 120);
            });
            await nextPaint(cv);
          }

          const unit = geometryUnit(cv, card, 240);
          cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit) });
          card.dataset.hitTick = '1';

          const inp = card.querySelector('#fx-sf-in');
          const btn = card.querySelector('#fx-sf-btn');
          let clicks = 0;
          btn.addEventListener('click', () => { clicks++; });

          const rect = cv.getBoundingClientRect();
          const hitInput = document.elementsFromPoint(rect.left + 80, rect.top + 32).includes(inp);
          const hitBtn = document.elementsFromPoint(rect.left + 70, rect.top + 80).includes(btn);
          if (hitBtn) btn.click();

          // Shift geometry vertically by +14 px (thermal receipt feed offset).
          cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit).translate(0, 14) });
          card.dataset.hitTick = '0';
          const hitShifted = document.elementsFromPoint(rect.left + 70, rect.top + 96).includes(btn);

          return need(
            hitInput && hitBtn && clicks === 1 && hitShifted,
            `Input hit=${hitInput}, button hit=${hitBtn}, clicks=${clicks}, +14 px shifted hit=${hitShifted}.`
          );
        } finally {
          if (g && fxTex.tex && !g.lost) g.gl.deleteTexture(fxTex.tex);
          g?.dispose();
          window.__gfx?.retire(cv);
        }
      },
    },
  ];

  runTests(document.getElementById('tests'), tests);
}

if (typeof document !== 'undefined' && document.getElementById('sf-canvas')) {
  mountScratchFoil();
}
