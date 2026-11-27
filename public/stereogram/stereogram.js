import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const $ = (id) => document.getElementById(id);

const canvas = $('stereo-canvas');
const cardEl = $('depth-card');
const plainHost = $('plain-host');
const hudEl = $('stage-hud');
const routeNoteEl = $('route-note');

// Live form controls inside the drawable canvas
const textInput = $('stereo-text');
const popBtn = $('btn-pop');
const popBadge = $('pop-badge');
const invertBtn = $('btn-invert');
const pulseBtn = $('btn-pulse');
const cardDepthSlider = $('card-depth');
const cardDepthOut = $('card-depth-out');

// Stage controls outside the canvas
const modeBtns = [...document.querySelectorAll('[data-mode]')];
const peekBtn = $('btn-peek');
const patternSelect = $('ctl-pattern');
const depthSlider = $('ctl-depth');
const depthOut = $('out-depth');
const stripSlider = $('ctl-strip');
const stripOut = $('out-strip');

const TOP_BAND = 34;
const MODE_NAMES = [
  'Magic Eye autostereogram',
  'Cross-eye stereo pair',
  'Red / cyan anaglyph 3D',
  'Wiggle 3D parallax',
  'Depth map + overlay',
];
const PATTERN_NAMES = [
  '1990s Confetti Dots',
  'Retro Wallpaper',
  'ASCII Stipple',
  'Live DOM Texture',
];

const reducedMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
let prefersReducedMotion = Boolean(reducedMotionQuery?.matches);
reducedMotionQuery?.addEventListener?.('change', (e) => {
  prefersReducedMotion = e.matches;
  requestRender();
});

const state = {
  route: 'none', // 'webgl' | '2d' | 'plain'
  mode: 0,
  pattern: 0,
  depthPct: 72,
  stripW: 104,
  stripUserSet: false,
  peek: false,
  previewPeek: false,
  pulse: false,
  popCount: 0,
  popStart: -100,
  pairSide: 'left',
  pointerX: 0.5,
  onScreen: true,
  dirtyTex: true,
  lastGeoKey: '',
  paints: 0,
};

let stage = null;
let ctx2d = null;
let rafId = 0;

// ---------------- Fragment Shader (WebGL 2 / GLSL ES 3.00) ----------------

const STEREO_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvas;
uniform vec4 uCardRect;
uniform vec4 uPairLeft;
uniform vec4 uPairRight;
uniform float uTopBand;
uniform int uMode;
uniform int uPattern;
uniform float uDepth;
uniform float uStripW;
uniform float uPeek;
uniform float uPulse;
uniform float uPopAge;
uniform float uPopBoost;
uniform float uPointerX;
uniform float uReducedMotion;
uniform float uPlinth;

in vec2 vUv;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec3 hash23(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// Horizontally periodic bilinear value noise (exact period periodX cells so strips never show a seam)
vec3 periodicNoise(vec2 p, float periodX) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float i0 = mod(i.x, periodX);
  float i1 = mod(i.x + 1.0, periodX);
  vec3 a = hash23(vec2(i0, i.y));
  vec3 b = hash23(vec2(i1, i.y));
  vec3 c = hash23(vec2(i0, i.y + 1.0));
  vec3 d = hash23(vec2(i1, i.y + 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

// Dynamic depth modulation from Pulse wave and Pop+ shockwave ripple
float waveOffset(vec2 pos, vec4 rect) {
  float add = 0.0;
  vec2 center = rect.xy + rect.zw * 0.5;
  float dist = length(pos - center);
  if (uPulse > 0.5 && uReducedMotion < 0.5) {
    float env = exp(-dist * 0.0022);
    add += 0.13 * env * sin(dist * 0.055 - uTime * 3.4);
  }
  if (uPopAge >= 0.0 && uPopAge < 1.45) {
    float radius = uPopAge * 260.0;
    float dr = (dist - radius) / 24.0;
    float ring = exp(-dr * dr);
    add += 0.30 * exp(-uPopAge * 2.3) * ring;
  }
  return add;
}

// Fast 3-tap horizontal bevelled depth lookup inside an arbitrary card rect
float sampleDepthInRect(vec2 pos, vec4 rect) {
  vec2 rel = (pos - rect.xy) / max(rect.zw, vec2(1.0));
  if (rel.x < 0.0 || rel.x > 1.0 || rel.y < 0.0 || rel.y > 1.0) {
    return clamp(waveOffset(pos, rect) * 0.4, 0.0, 1.0);
  }
  vec2 cuv = clamp(rel, vec2(0.0), vec2(1.0));
  float dx = 2.4 / max(rect.z, 1.0);
  float l0 = luma(texture(uTex, vec2(clamp(cuv.x - dx, 0.0, 1.0), cuv.y)).rgb);
  float l1 = luma(texture(uTex, cuv).rgb);
  float l2 = luma(texture(uTex, vec2(clamp(cuv.x + dx, 0.0, 1.0), cuv.y)).rgb);
  float lum = 0.25 * l0 + 0.50 * l1 + 0.25 * l2;
  float d = smoothstep(0.05, 0.94, lum);

  // Soft bevelled plinth mask at the card border (disabled when uPlinth == 0.0)
  float edgeX = smoothstep(0.0, 0.028, rel.x) * smoothstep(0.0, 0.028, 1.0 - rel.x);
  float edgeY = smoothstep(0.0, 0.036, rel.y) * smoothstep(0.0, 0.036, 1.0 - rel.y);
  float mask = edgeX * edgeY;

  float base = uPlinth > 0.001 ? (uPlinth + (1.0 - uPlinth) * d) * mask : d;
  float depth = base + uPopBoost * mask * 0.25 + waveOffset(pos, rect);
  return clamp(depth, 0.0, 1.0);
}

// 5x5 bitmap glyph helper for ASCII Stipple preset (25-bit masks, all signed-int safe)
int glyphMask(int idx) {
  if (idx == 0) return 11512810; // #
  if (idx == 1) return 4357252;  // +
  if (idx == 2) return 18157905; // X
  if (idx == 3) return 15255086; // O
  if (idx == 4) return 20288345; // %
  if (idx == 5) return 1016800;  // =
  if (idx == 6) return 22511061; // *
  return 4543812;                // diamond
}

// Strictly horizontally periodic seed strip patterns (period == stripW)
vec3 samplePattern(vec2 p, float stripW) {
  float px = mod(p.x, stripW);
  float u = px / stripW;
  float y = p.y;

  if (uPattern == 0) {
    // 1990s Confetti Dots: multi-scale periodic random dots with high horizontal contrast
    float nFine = max(14.0, floor(stripW / 3.4));
    float nMed = max(7.0, floor(stripW / 8.5));
    vec3 nf = periodicNoise(vec2(u * nFine, y / 3.4), nFine);
    vec3 nm = periodicNoise(vec2(u * nMed, y / 8.5), nMed);

    // Subtle crisp confetti circles on a periodic grid
    vec2 cellP = vec2(u * nMed, y / 8.5);
    vec2 ci = floor(cellP);
    vec2 cf = fract(cellP) - 0.5;
    vec3 dotRand = hash23(vec2(mod(ci.x, nMed), ci.y) + vec2(11.3, 7.1));
    float dist = length(cf - (dotRand.xy - 0.5) * 0.32);
    float disc = 1.0 - smoothstep(0.18, 0.34, dist);

    vec3 palA = mix(vec3(0.08, 0.14, 0.28), vec3(0.10, 0.72, 0.78), nf.x);
    vec3 palB = mix(vec3(0.92, 0.34, 0.22), vec3(0.98, 0.84, 0.32), nf.y);
    vec3 grain = mix(palA, palB, smoothstep(0.32, 0.68, nf.z));
    vec3 dotCol = mix(vec3(0.96, 0.94, 0.88), vec3(0.62, 0.32, 0.94), dotRand.z);
    vec3 col = mix(grain * (0.68 + 0.46 * nm.x), dotCol, disc * 0.72);
    return col;
  }

  if (uPattern == 1) {
    // Retro Wallpaper: 90s geometric rosette and diagonal weave with fine grain
    float v = fract(y / stripW);
    float ang = 6.2831853 * u;
    float vang = 6.2831853 * v;
    float diagA = sin((u + v) * 6.2831853 * 3.0);
    float diagB = cos((u - v) * 6.2831853 * 3.0);
    float rings = sin(length(fract(vec2(u, v) * 2.0) - 0.5) * 34.0);
    float weave = 0.5 + 0.5 * (diagA * diagB);
    float nFine = max(14.0, floor(stripW / 4.0));
    vec3 micro = periodicNoise(vec2(u * nFine, y / 4.0), nFine);

    vec3 base = mix(vec3(0.10, 0.16, 0.34), vec3(0.12, 0.60, 0.64), weave);
    base = mix(base, vec3(0.86, 0.28, 0.44), smoothstep(0.35, 0.85, rings) * 0.68);
    base = mix(base, vec3(0.98, 0.78, 0.28), smoothstep(0.55, 0.95, sin(ang * 2.0) * cos(vang * 2.0)) * 0.55);
    return base * (0.76 + 0.36 * micro.x) + (micro - 0.5) * 0.16;
  }

  if (uPattern == 2) {
    // ASCII Stipple: periodic terminal glyph grid
    float cols = max(6.0, floor(stripW / 9.0));
    float rowH = 10.0;
    vec2 cell = vec2(u * cols, y / rowH);
    vec2 ci = floor(cell);
    vec2 cf = fract(cell);
    float cx = mod(ci.x, cols);
    vec3 rnd = hash23(vec2(cx, ci.y) + vec2(3.7, 19.1));
    int gIdx = int(floor(rnd.x * 8.0));
    int mask = glyphMask(gIdx);

    vec2 sub = cf * 6.0 - 0.5;
    int gx = int(floor(sub.x));
    int gy = int(floor(sub.y));
    float ink = 0.0;
    if (gx >= 0 && gx < 5 && gy >= 0 && gy < 5) {
      int bit = gy * 5 + gx;
      if (((mask >> bit) & 1) == 1) {
        vec2 sc = fract(sub) - 0.5;
        ink = 1.0 - smoothstep(0.28, 0.52, max(abs(sc.x), abs(sc.y)));
      }
    }
    vec3 fg = mix(vec3(0.24, 0.94, 0.56), vec3(0.98, 0.76, 0.26), step(0.62, rnd.y));
    fg = mix(fg, vec3(0.32, 0.82, 0.98), step(0.84, rnd.z));
    vec3 bg = vec3(0.05, 0.07, 0.10) + vec3(0.03, 0.05, 0.06) * rnd.z;
    return mix(bg, fg, ink);
  }

  // Preset 3: Live DOM Texture tiled into the stereogram strip with subtle colour weave
  float cardAspect = max(uCardRect.w / max(uCardRect.z, 1.0), 0.35);
  float tileH = stripW * cardAspect;
  vec2 tuv = vec2(u, fract(y / max(tileH, 24.0)));
  vec3 domTile = texture(uTex, tuv).rgb;
  float nGrid = max(12.0, floor(stripW / 4.2));
  vec3 grain = periodicNoise(vec2(u * nGrid, y / 4.2), nGrid);
  vec3 tint = mix(vec3(0.12, 0.24, 0.42), vec3(0.88, 0.42, 0.24), grain.x);
  vec3 woven = mix(tint * (0.45 + 0.55 * grain.y), domTile * vec3(1.0, 0.94, 0.86), 0.58);
  return woven + (grain - 0.5) * 0.18;
}

// #region stereogram-chain
// Exact single-pass GPU autostereogram: trace left by (stripW - depth * maxShift)
// until reaching the periodic seed strip [0, stripW). Zero FBOs, zero readback.
vec3 renderAutostereogram(vec2 pos, float stripW, float maxShift) {
  float px = pos.x;
  for (int i = 0; i < 30; i++) {
    if (px < stripW) break;
    // Two-step midpoint lookup centres the perceived 3D silhouette on the live DOM hit box.
    float d0 = sampleDepthInRect(vec2(px - 0.5 * stripW, pos.y), uCardRect);
    float sep0 = stripW - d0 * maxShift;
    float d = sampleDepthInRect(vec2(px - 0.5 * sep0, pos.y), uCardRect);
    float sep = stripW - d * maxShift;
    px -= sep;
  }
  return samplePattern(vec2(mod(px, stripW), pos.y), stripW);
}
// #endregion stereogram-chain

// #region parallax-march
// Front-to-back horizontal heightfield raymarch for cross-eye, anaglyph and wiggle 3D.
// eyeSign = -1 shifts raised features right (left eye); +1 shifts them left (right eye).
vec4 sampleParallax(vec2 pos, vec4 rect, float eyeSign, float maxShift) {
  const int STEPS = 14;
  float prevT = 1.0;
  float prevD = 0.0;
  float hitT = 0.0;
  for (int i = 0; i <= STEPS; i++) {
    float t = 1.0 - float(i) / float(STEPS);
    vec2 sp = vec2(pos.x + eyeSign * maxShift * t, pos.y);
    float d = sampleDepthInRect(sp, rect);
    if (d >= t) {
      float denom = max((prevT - prevD) + (d - t), 1e-4);
      float frac = clamp((prevT - prevD) / denom, 0.0, 1.0);
      hitT = mix(prevT, t, frac);
      break;
    }
    prevT = t;
    prevD = d;
  }
  vec2 hitPos = vec2(pos.x + eyeSign * maxShift * hitT, pos.y);
  vec2 cuv = (hitPos - rect.xy) / max(rect.zw, vec2(1.0));
  bool inside = cuv.x >= 0.0 && cuv.x <= 1.0 && cuv.y >= 0.0 && cuv.y <= 1.0;
  vec3 col;
  if (inside) {
    col = texture(uTex, cuv).rgb;
    float dx = sampleDepthInRect(hitPos + vec2(2.0, 0.0), rect) - sampleDepthInRect(hitPos - vec2(2.0, 0.0), rect);
    float dy = sampleDepthInRect(hitPos + vec2(0.0, 2.0), rect) - sampleDepthInRect(hitPos - vec2(0.0, 2.0), rect);
    vec3 n = normalize(vec3(-dx * 2.6, -dy * 2.6, 0.55));
    float lit = 0.85 + 0.25 * max(dot(n, normalize(vec3(-0.35, -0.45, 0.82))), 0.0);
    col *= lit;
  } else {
    vec2 g = abs(fract(hitPos / 28.0 - 0.5) - 0.5) * 28.0;
    float grid = 1.0 - smoothstep(0.55, 1.35, min(g.x, g.y));
    col = mix(vec3(0.05, 0.065, 0.095), vec3(0.12, 0.16, 0.23), grid * 0.6);
  }
  return vec4(col, hitT);
}
// #endregion parallax-march

vec3 depthPalette(float d) {
  vec3 c0 = vec3(0.06, 0.09, 0.18);
  vec3 c1 = vec3(0.08, 0.48, 0.58);
  vec3 c2 = vec3(0.92, 0.56, 0.16);
  vec3 c3 = vec3(0.99, 0.97, 0.92);
  if (d < 0.35) return mix(c0, c1, d / 0.35);
  if (d < 0.72) return mix(c1, c2, (d - 0.35) / 0.37);
  return mix(c2, c3, (d - 0.72) / 0.28);
}

vec3 drawGuideBar(vec2 pos, float leftDotX, float rightDotX) {
  vec3 bar = vec3(0.065, 0.075, 0.105);
  if (pos.y > uTopBand - 1.2) bar = vec3(0.20, 0.24, 0.32);
  float cy = uTopBand * 0.5;
  float dL = length(pos - vec2(leftDotX, cy));
  float dR = length(pos - vec2(rightDotX, cy));
  float dDot = min(dL, dR);
  float halo = 1.0 - smoothstep(5.0, 10.5, dDot);
  float core = 1.0 - smoothstep(4.2, 5.4, dDot);
  bar = mix(bar, vec3(0.92, 0.36, 0.18), halo * 0.65);
  bar = mix(bar, vec3(1.0, 0.98, 0.95), core);
  return bar;
}

vec3 blendPeekOverlay(vec3 baseCol, vec2 pos, vec4 rect, float amount) {
  vec2 cuv = (pos - rect.xy) / max(rect.zw, vec2(1.0));
  if (cuv.x < 0.0 || cuv.x > 1.0 || cuv.y < 0.0 || cuv.y > 1.0) return baseCol;
  vec3 domCol = texture(uTex, cuv).rgb;
  vec2 borderPx = min(pos - rect.xy, (rect.xy + rect.zw) - pos);
  float frame = 1.0 - smoothstep(1.2, 2.4, min(borderPx.x, borderPx.y));
  vec3 outC = mix(baseCol, domCol, amount);
  return mix(outC, vec3(1.0, 0.48, 0.30), frame * 0.9);
}

void main() {
  vec2 pos = vUv * uCanvas;
  float stripW = max(uStripW, 44.0);
  float maxShift = clamp(uDepth, 0.0, 0.40) * stripW;
  vec3 rgb = vec3(0.05, 0.06, 0.09);

  if (uTopBand > 1.0 && pos.y < uTopBand) {
    if (uMode == 0) {
      float cx = uCanvas.x * 0.5;
      rgb = drawGuideBar(pos, cx - stripW * 0.5, cx + stripW * 0.5);
    } else if (uMode == 1) {
      rgb = drawGuideBar(pos, uCanvas.x * 0.25, uCanvas.x * 0.75);
    } else {
      rgb = vec3(0.065, 0.075, 0.105);
      if (pos.y > uTopBand - 1.2) rgb = vec3(0.18, 0.22, 0.30);
    }
    outColor = vec4(rgb, 1.0);
    return;
  }

  if (uMode == 0) {
    rgb = renderAutostereogram(pos, stripW, maxShift);
    if (uPeek > 0.01) rgb = blendPeekOverlay(rgb, pos, uCardRect, 0.80 * uPeek);
  } else if (uMode == 1) {
    // Cross-eye stereo pair: Left half = Right eye (+1), Right half = Left eye (-1)
    float pairShift = clamp(uDepth, 0.0, 0.40) * 34.0;
    float midX = uCanvas.x * 0.5;
    if (abs(pos.x - midX) < 1.25) {
      rgb = vec3(0.32, 0.38, 0.48);
    } else if (pos.x < midX) {
      rgb = sampleParallax(pos, uPairLeft, 1.0, pairShift).rgb;
      if (uPeek > 0.01) rgb = blendPeekOverlay(rgb, pos, uPairLeft, 0.80 * uPeek);
    } else {
      rgb = sampleParallax(pos, uPairRight, -1.0, pairShift).rgb;
      if (uPeek > 0.01) rgb = blendPeekOverlay(rgb, pos, uPairRight, 0.80 * uPeek);
    }
  } else if (uMode == 2) {
    // Red / Cyan Anaglyph 3D (Red = Left eye, Cyan = Right eye)
    float anaShift = clamp(uDepth, 0.0, 0.40) * 44.0;
    vec3 leftEye = sampleParallax(pos, uCardRect, -1.0, anaShift).rgb;
    vec3 rightEye = sampleParallax(pos, uCardRect, 1.0, anaShift).rgb;
    float rChan = clamp(leftEye.r * 0.65 + luma(leftEye) * 0.35, 0.0, 1.0);
    rgb = vec3(rChan, rightEye.g, rightEye.b);
    if (uPeek > 0.01) rgb = blendPeekOverlay(rgb, pos, uCardRect, 0.82 * uPeek);
  } else if (uMode == 3) {
    // Wiggle 3D: 6 eye reversals per second (3 Hz cycle) or pointer scrub on reduced motion
    float eye;
    if (uReducedMotion > 0.5) {
      eye = clamp(uPointerX * 2.0 - 1.0, -1.0, 1.0);
    } else {
      float s = sin(uTime * 6.2831853 * 3.0);
      eye = s * (1.35 - 0.35 * s * s);
    }
    float wigShift = clamp(uDepth, 0.0, 0.40) * 46.0;
    rgb = sampleParallax(pos, uCardRect, eye, wigShift).rgb;
    if (uPeek > 0.01) rgb = blendPeekOverlay(rgb, pos, uCardRect, 0.78 * uPeek);
  } else {
    // Mode 4: Depth heightfield heatmap with contour lines and live DOM overlay
    float d = sampleDepthInRect(pos, uCardRect);
    float dx = sampleDepthInRect(pos + vec2(2.0, 0.0), uCardRect) - sampleDepthInRect(pos - vec2(2.0, 0.0), uCardRect);
    float dy = sampleDepthInRect(pos + vec2(0.0, 2.0), uCardRect) - sampleDepthInRect(pos - vec2(0.0, 2.0), uCardRect);
    vec3 n = normalize(vec3(-dx * 3.0, -dy * 3.0, 0.50));
    float lit = 0.78 + 0.30 * max(dot(n, normalize(vec3(-0.4, -0.45, 0.8))), 0.0);
    float contour = 1.0 - smoothstep(0.04, 0.11, abs(fract(d * 8.0 + 0.5) - 0.5));
    vec3 heat = depthPalette(d) * lit;
    heat = mix(heat, vec3(1.0), contour * 0.14 * step(0.04, d));
    float blendAmt = uPeek > 0.5 ? 0.85 : 0.42;
    rgb = blendPeekOverlay(heat, pos, uCardRect, blendAmt);
  }

  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

// ---------------- Layout & Hit Geometry ----------------

function computeLayout() {
  const cw = canvas.clientWidth || 360;
  const ch = canvas.clientHeight || 400;
  const rawW = cardEl.offsetWidth || 300;
  const rawH = cardEl.offsetHeight || 312;

  const usableH = Math.max(120, ch - TOP_BAND - 24);
  const padX = Math.max(20, Math.min(96, Math.round(cw * 0.09)));
  const availW = Math.max(160, cw - padX * 2);
  const scale = Math.min(1, availW / rawW, usableH / rawH);
  const w = Math.round(rawW * scale);
  const h = Math.round(rawH * scale);
  const cardRect = {
    x: Math.round((cw - w) * 0.5),
    y: Math.round(TOP_BAND + (ch - TOP_BAND - h) * 0.5),
    w,
    h,
  };

  // Side-by-side rectangles for Cross-eye Stereo Pair mode
  const halfAvailW = Math.max(110, cw * 0.5 - 20);
  const pairScale = Math.min(1, halfAvailW / rawW, usableH / rawH);
  const pw = Math.round(rawW * pairScale);
  const ph = Math.round(rawH * pairScale);
  const py = Math.round(TOP_BAND + (ch - TOP_BAND - ph) * 0.5);
  const pairLeft = { x: Math.round(cw * 0.25 - pw * 0.5), y: py, w: pw, h: ph };
  const pairRight = { x: Math.round(cw * 0.75 - pw * 0.5), y: py, w: pw, h: ph };

  return { cw, ch, rawW, rawH, cardRect, pairLeft, pairRight };
}

function autoStripWidth(cw) {
  return Math.max(60, Math.min(120, Math.round(cw < 540 ? 68 : 104)));
}

// #region hit-geometry
function syncHitGeometry(layout, force = false) {
  if (state.route !== 'webgl' || typeof canvas.updateElementGeometry !== 'function') return;
  const rect = state.mode === 1
    ? (state.pairSide === 'right' ? layout.pairRight : layout.pairLeft)
    : layout.cardRect;
  const key = `${rect.x},${rect.y},${rect.w},${rect.h},${layout.rawW},${layout.rawH},${canvas.width}x${canvas.height}`;
  if (!force && key === state.lastGeoKey) return;
  state.lastGeoKey = key;

  const unit = geometryUnit(canvas, cardEl, layout.rawW);
  const sx = rect.w / Math.max(1, layout.rawW);
  const sy = rect.h / Math.max(1, layout.rawH);
  const m = new DOMMatrix().scale(unit).translate(rect.x, rect.y).scale(sx, sy);
  canvas.updateElementGeometry(cardEl, { canvasTransform: m });
  // Clear Chromium 157's cached hit-test entry after moving the element geometry.
  cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion hit-geometry

// ---------------- Rendering (Single ElementGL + 2D Fallback + Plain HTML) ----------------

function needsAnimation(nowSec) {
  if (!state.onScreen || document.hidden || state.route !== 'webgl') return false;
  if (state.mode === 3 && !prefersReducedMotion) return true;
  if (state.pulse && !prefersReducedMotion) return true;
  if (nowSec - state.popStart < 1.5) return true;
  return false;
}

function updateHud(layout) {
  const modeLabel = MODE_NAMES[state.mode];
  const depthFrac = (state.depthPct / 100) * 0.36;
  const shiftPx = Math.round(state.stripW * depthFrac);
  const peekTag = (state.peek || state.previewPeek) ? ' | peek ON' : '';
  const focusTag = document.activeElement === textInput ? ` | typing "${textInput.value || ''}"` : '';
  if (state.mode === 0) {
    hudEl.textContent = `${modeLabel} | ${PATTERN_NAMES[state.pattern]} | strip ${state.stripW}px, max shift ${shiftPx}px${peekTag}${focusTag}`;
  } else if (state.mode === 1) {
    hudEl.textContent = `${modeLabel} | hit box: ${state.pairSide} half${peekTag}${focusTag}`;
  } else if (state.mode === 3 && prefersReducedMotion) {
    hudEl.textContent = `${modeLabel} | reduced motion: drag horizontally to rock${peekTag}${focusTag}`;
  } else {
    hudEl.textContent = `${modeLabel} | relief ${state.depthPct}%${peekTag}${focusTag}`;
  }
}

// #region gl-render
function renderWebGL() {
  if (!stage || stage.lost) return;
  const layout = computeLayout();
  if (!state.stripUserSet) {
    const autoW = autoStripWidth(layout.cw);
    if (autoW !== state.stripW) {
      state.stripW = autoW;
      stripSlider.value = String(autoW);
      stripOut.textContent = `${autoW}px`;
    }
  }
  if (state.dirtyTex || !stage.has(cardEl)) {
    stage.upload(cardEl);
    state.dirtyTex = false;
  }
  if (!stage.begin([0.04, 0.05, 0.08, 1])) return;

  const nowSec = performance.now() / 1000;
  const popAge = nowSec - state.popStart;
  const popBoost = popAge >= 0 && popAge < 0.7 ? Math.sin((popAge / 0.7) * Math.PI) : 0;
  const depthNorm = (state.depthPct / 100) * 0.36;
  const peekVal = (state.peek || state.previewPeek) ? 1.0 : 0.0;

  stage.quad(cardEl, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (gl, u) => {
    gl.uniform2f(u('uCanvas'), layout.cw, layout.ch);
    gl.uniform4f(u('uCardRect'), layout.cardRect.x, layout.cardRect.y, layout.cardRect.w, layout.cardRect.h);
    gl.uniform4f(u('uPairLeft'), layout.pairLeft.x, layout.pairLeft.y, layout.pairLeft.w, layout.pairLeft.h);
    gl.uniform4f(u('uPairRight'), layout.pairRight.x, layout.pairRight.y, layout.pairRight.w, layout.pairRight.h);
    gl.uniform1f(u('uTopBand'), TOP_BAND);
    gl.uniform1i(u('uMode'), state.mode);
    gl.uniform1i(u('uPattern'), state.pattern);
    gl.uniform1f(u('uDepth'), depthNorm);
    gl.uniform1f(u('uStripW'), state.stripW);
    gl.uniform1f(u('uPeek'), peekVal);
    gl.uniform1f(u('uPulse'), state.pulse ? 1.0 : 0.0);
    gl.uniform1f(u('uPopAge'), popAge < 1.5 ? popAge : 99.0);
    gl.uniform1f(u('uPopBoost'), popBoost);
    gl.uniform1f(u('uPointerX'), state.pointerX);
    gl.uniform1f(u('uReducedMotion'), prefersReducedMotion ? 1.0 : 0.0);
    gl.uniform1f(u('uPlinth'), 0.12);
  });

  syncHitGeometry(layout);
  updateHud(layout);

  if (needsAnimation(nowSec) && !rafId) {
    rafId = requestAnimationFrame(tick);
  }
}
// #endregion gl-render

function render2DFallback() {
  if (!ctx2d) return;
  const layout = computeLayout();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#080a10';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);
  const r = layout.cardRect;
  ctx2d.drawElementImage(cardEl, r.x, r.y, r.w, r.h);
  hudEl.textContent = '2D fallback (drawElementImage): WebGL 2 texElementSubImage2D() unavailable';
}

function tick() {
  rafId = 0;
  if (state.route === 'webgl') renderWebGL();
  else if (state.route === '2d') render2DFallback();
}

function requestRender() {
  if (state.route === 'plain' || rafId) return;
  rafId = requestAnimationFrame(tick);
}

function fallbackToPlainHTML(reason) {
  state.route = 'plain';
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  canvas.hidden = true;
  hudEl.hidden = true;
  if (cardEl.parentElement !== plainHost) plainHost.append(cardEl);
  routeNoteEl.textContent = `Shown as plain HTML (${reason}).`;
}

// ---------------- Live Form & Toolbar Interactions ----------------

cardEl.addEventListener('submit', (e) => e.preventDefault());

function syncDepthValue(val) {
  const pct = Math.max(0, Math.min(100, Number(val) || 0));
  state.depthPct = pct;
  depthSlider.value = String(pct);
  depthOut.textContent = `${pct}%`;
  cardDepthSlider.value = String(pct);
  cardDepthOut.textContent = `${pct}%`;
  state.dirtyTex = true;
  canvas.requestPaint?.();
  requestRender();
}

cardDepthSlider.addEventListener('input', () => syncDepthValue(cardDepthSlider.value));
depthSlider.addEventListener('input', () => syncDepthValue(depthSlider.value));

stripSlider.addEventListener('input', () => {
  state.stripUserSet = true;
  state.stripW = Number(stripSlider.value) || 104;
  stripOut.textContent = `${state.stripW}px`;
  requestRender();
});

patternSelect.addEventListener('change', () => {
  state.pattern = Number(patternSelect.value) || 0;
  if (state.mode !== 0) setMode(0);
  else requestRender();
});

textInput.addEventListener('input', () => {
  state.dirtyTex = true;
  canvas.requestPaint?.();
  requestRender();
});
textInput.addEventListener('focus', () => requestRender());
textInput.addEventListener('blur', () => requestRender());

popBtn.addEventListener('click', () => {
  state.popCount += 1;
  popBadge.textContent = `POP ${state.popCount}`;
  state.popStart = performance.now() / 1000;
  state.dirtyTex = true;
  canvas.requestPaint?.();
  requestRender();
});

invertBtn.addEventListener('click', () => {
  const inverted = cardEl.classList.toggle('inverted');
  invertBtn.setAttribute('aria-pressed', String(inverted));
  state.dirtyTex = true;
  canvas.requestPaint?.();
  requestRender();
});

pulseBtn.addEventListener('click', () => {
  state.pulse = !state.pulse;
  pulseBtn.setAttribute('aria-pressed', String(state.pulse));
  state.dirtyTex = true;
  canvas.requestPaint?.();
  requestRender();
});

function setMode(nextMode) {
  state.mode = nextMode;
  for (const btn of modeBtns) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.mode) === nextMode));
  }
  state.lastGeoKey = '';
  requestRender();
}

for (const btn of modeBtns) {
  btn.addEventListener('click', () => setMode(Number(btn.dataset.mode) || 0));
}

// Peek live HTML: short tap toggles; press-and-hold peeks temporarily while held.
let peekDownAt = 0;
let peekWasOn = false;

peekBtn.addEventListener('pointerdown', (e) => {
  if (e.button && e.button !== 0) return;
  peekDownAt = performance.now();
  peekWasOn = state.peek;
  if (!peekWasOn) {
    state.previewPeek = true;
    peekBtn.classList.add('peeking');
    requestRender();
  }
});

function endPeekHold(isRelease) {
  if (!peekDownAt) return;
  const heldMs = performance.now() - peekDownAt;
  peekDownAt = 0;
  state.previewPeek = false;
  peekBtn.classList.remove('peeking');
  if (isRelease && heldMs <= 260) {
    state.peek = !peekWasOn;
    peekBtn.setAttribute('aria-pressed', String(state.peek));
  }
  requestRender();
}

peekBtn.addEventListener('pointerup', () => endPeekHold(true));
peekBtn.addEventListener('pointercancel', () => endPeekHold(false));
peekBtn.addEventListener('pointerleave', () => {
  if (peekDownAt && performance.now() - peekDownAt > 260) endPeekHold(false);
});
peekBtn.addEventListener('click', (e) => {
  // Keyboard activation (Enter / Space) fires click with detail === 0.
  if (e.detail === 0) {
    state.peek = !state.peek;
    peekBtn.setAttribute('aria-pressed', String(state.peek));
    requestRender();
  }
});

// Pointer tracking: swaps hit box between Left/Right halves in Cross-eye mode
// and scrubs angle in Wiggle 3D under reduced motion.
function handleCanvasPointer(e) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  state.pointerX = nx;
  if (state.mode === 1) {
    const nextSide = nx >= 0.5 ? 'right' : 'left';
    if (nextSide !== state.pairSide) {
      state.pairSide = nextSide;
      syncHitGeometry(computeLayout(), true);
      updateHud(computeLayout());
    }
  } else if (state.mode === 3 && prefersReducedMotion) {
    requestRender();
  }
}

canvas.addEventListener('pointermove', handleCanvasPointer, { passive: true });
canvas.addEventListener('pointerdown', handleCanvasPointer, { passive: true });

// ---------------- Boot & Observers ----------------

function initRenderer() {
  if (!supported) {
    fallbackToPlainHTML('HTML-in-canvas is not enabled in this browser');
    return;
  }

  if (glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: STEREO_FRAG,
        attributes: { alpha: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          fallbackToPlainHTML('WebGL 2 context lost');
        },
        onRestored: () => {
          if (cardEl.parentElement !== canvas) canvas.append(cardEl);
          canvas.hidden = false;
          hudEl.hidden = false;
          state.route = 'webgl';
          state.dirtyTex = true;
          state.lastGeoKey = '';
          routeNoteEl.textContent = 'WebGL 2 context restored on one ElementGL context.';
          canvas.requestPaint?.();
          requestRender();
        },
      });
      state.route = 'webgl';
      routeNoteEl.textContent = 'Drawn with WebGL 2 on one ElementGL context using texElementSubImage2D() and updateElementGeometry().';
    } catch (err) {
      routeNoteEl.textContent = `WebGL 2 failed (${err.message}); falling back to 2D drawElementImage().`;
    }
  }

  if (state.route !== 'webgl') {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.route = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; drawn flat with 2D drawElementImage().';
      canvas.addEventListener('contextlost', () => fallbackToPlainHTML('2D canvas context lost'));
      canvas.addEventListener('contextrestored', () => {
        if (cardEl.parentElement !== canvas) canvas.append(cardEl);
        canvas.hidden = false;
        hudEl.hidden = false;
        state.route = '2d';
        canvas.requestPaint?.();
      });
    } else {
      fallbackToPlainHTML('Canvas context unavailable');
      return;
    }
  }

  canvas.addEventListener('paint', () => {
    state.paints += 1;
    state.dirtyTex = true;
    if (state.route === 'webgl') renderWebGL();
    else if (state.route === '2d') render2DFallback();
  });

  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      state.lastGeoKey = '';
      requestRender();
    });
    ro.observe(canvas);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    const io = new IntersectionObserver((entries) => {
      state.onScreen = entries.some((e) => e.isIntersecting);
      if (state.onScreen) requestRender();
    }, { rootMargin: '120px' });
    io.observe(canvas);
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.onScreen) requestRender();
  });

  canvas.requestPaint?.();
  requestRender();
}

initRenderer();

// ---------------- Live Checks (Tap-Gated, Isolated Fixtures on testStage) ----------------

function setFixtureUniforms(gl, u, opts) {
  gl.uniform2f(u('uCanvas'), opts.cw, opts.ch);
  gl.uniform4f(u('uCardRect'), opts.rect[0], opts.rect[1], opts.rect[2], opts.rect[3]);
  gl.uniform4f(u('uPairLeft'), 6, 8, opts.cw * 0.5 - 12, opts.ch - 16);
  gl.uniform4f(u('uPairRight'), opts.cw * 0.5 + 6, 8, opts.cw * 0.5 - 12, opts.ch - 16);
  gl.uniform1f(u('uTopBand'), opts.topBand ?? 0);
  gl.uniform1i(u('uMode'), opts.mode ?? 0);
  gl.uniform1i(u('uPattern'), opts.pattern ?? 0);
  gl.uniform1f(u('uDepth'), opts.depth ?? 0.30);
  gl.uniform1f(u('uStripW'), opts.stripW ?? 60);
  gl.uniform1f(u('uPeek'), opts.peek ?? 0);
  gl.uniform1f(u('uPulse'), 0);
  gl.uniform1f(u('uPopAge'), 99);
  gl.uniform1f(u('uPopBoost'), 0);
  gl.uniform1f(u('uPointerX'), 0.5);
  gl.uniform1f(u('uReducedMotion'), 0);
  gl.uniform1f(u('uPlinth'), opts.plinth ?? 0);
}

function bestRepeatPeriod(rowBytes, widthPx, minLag, maxLag, startX) {
  let bestLag = minLag;
  let bestErr = Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let count = 0;
    for (let x = startX; x < widthPx - 2; x++) {
      const a = x * 4;
      const b = (x - lag) * 4;
      sum += Math.abs(rowBytes[a] - rowBytes[b])
        + Math.abs(rowBytes[a + 1] - rowBytes[b + 1])
        + Math.abs(rowBytes[a + 2] - rowBytes[b + 2]);
      count += 3;
    }
    const avg = count ? sum / count : Infinity;
    if (avg < bestErr) {
      bestErr = avg;
      bestLag = lag;
    }
  }
  return { lag: bestLag, err: bestErr };
}

const checks = [
  {
    name: 'ElementGL + texElementSubImage2D() feeds live HTML into the stereogram shader',
    why: 'Builds an isolated drawable canvas fixture on testStage(), uploads live HTML via ElementGL.upload(), draws the autostereogram shader and verifies gl.getError() === 0 and non-flat patterned output.',
    timeout: 6000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 180, ch = 100;
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;
      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#060911;color:#fff;font:900 28px system-ui;display:flex;align-items:center;justify-content:center;`;
      fixCard.textContent = '3D';
      fixCanvas.append(fixCard);
      testStage().append(fixCanvas);

      const fixGL = new ElementGL(fixCanvas, {
        fragment: STEREO_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      try {
        await nextPaint(fixCanvas);
        const tex = fixGL.upload(fixCard);
        if (!tex || !tex.w || !tex.h) throw new Error('upload() returned empty texture');
        fixGL.begin([0, 0, 0, 1]);
        fixGL.quad(fixCard, ElementGL.rect(fixCanvas, 0, 0, cw, ch), (gl, u) => {
          setFixtureUniforms(gl, u, { cw, ch, rect: [0, 0, cw, ch], mode: 0, pattern: 0, stripW: 54, depth: 0.28, plinth: 0 });
        });
        const err = fixGL.gl.getError();
        if (err !== fixGL.gl.NO_ERROR) throw new Error(`WebGL error 0x${err.toString(16)}`);

        const row = new Uint8Array(fixCanvas.width * 4);
        fixGL.gl.readPixels(0, Math.floor(fixCanvas.height * 0.5), fixCanvas.width, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, row);
        let minL = 255, maxL = 0;
        for (let i = 0; i < row.length; i += 4) {
          const lum = 0.299 * row[i] + 0.587 * row[i + 1] + 0.114 * row[i + 2];
          if (lum < minL) minL = lum;
          if (lum > maxL) maxL = lum;
        }
        if (maxL - minL < 24) throw new Error(`output looks flat (luminance range ${minL.toFixed(0)}..${maxL.toFixed(0)})`);
        return `uploaded ${tex.w}x${tex.h} texture; gl.getError() === 0; stereogram luma span ${minL.toFixed(0)}..${maxL.toFixed(0)}`;
      } finally {
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'Backward strip-chain shifts repeat period over bright vs dark DOM regions',
    why: 'Draws a split dark (#000) / bright (#fff) HTML fixture with stripW = 60px and depth = 0.30 (18px shift) and measures the horizontal repeat period on both scanlines.',
    timeout: 6000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 240, ch = 120, stripW = 60, depth = 0.30;
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;

      const splitCard = document.createElement('div');
      splitCard.setAttribute('drawable', '');
      splitCard.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;overflow:hidden;`;
      const topDark = document.createElement('div');
      topDark.style.cssText = `width:100%;height:${ch / 2}px;background:#000000;`;
      const botBright = document.createElement('div');
      botBright.style.cssText = `width:100%;height:${ch / 2}px;background:#ffffff;`;
      splitCard.append(topDark, botBright);
      fixCanvas.append(splitCard);
      testStage().append(fixCanvas);

      const fixGL = new ElementGL(fixCanvas, {
        fragment: STEREO_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      try {
        await nextPaint(fixCanvas);
        fixGL.upload(splitCard);
        fixGL.begin([0, 0, 0, 1]);
        fixGL.quad(splitCard, ElementGL.rect(fixCanvas, 0, 0, cw, ch), (gl, u) => {
          setFixtureUniforms(gl, u, { cw, ch, rect: [0, 0, cw, ch], mode: 0, pattern: 0, stripW, depth, plinth: 0 });
        });
        const err = fixGL.gl.getError();
        if (err !== fixGL.gl.NO_ERROR) throw new Error(`WebGL error 0x${err.toString(16)}`);

        const bw = fixCanvas.width;
        const bh = fixCanvas.height;
        const scaleX = bw / cw;
        const darkRow = new Uint8Array(bw * 4);
        const brightRow = new Uint8Array(bw * 4);
        // WebGL readPixels has y = 0 at the bottom, so HTML top dark band is at ~0.80 * bh.
        fixGL.gl.readPixels(0, Math.round(bh * 0.80), bw, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, darkRow);
        fixGL.gl.readPixels(0, Math.round(bh * 0.20), bw, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, brightRow);

        const minLag = Math.max(8, Math.round(30 * scaleX));
        const maxLag = Math.min(bw - 12, Math.round(70 * scaleX));
        const startX = Math.round(72 * scaleX);
        const darkRes = bestRepeatPeriod(darkRow, bw, minLag, maxLag, startX);
        const brightRes = bestRepeatPeriod(brightRow, bw, minLag, maxLag, startX);

        const darkCss = darkRes.lag / scaleX;
        const brightCss = brightRes.lag / scaleX;
        const deltaCss = darkCss - brightCss;
        const expectedBright = stripW * (1 - depth);
        if (Math.abs(darkCss - stripW) > 2.5) {
          throw new Error(`dark period ${darkCss.toFixed(1)}px (expected ~${stripW}px, err ${darkRes.err.toFixed(1)})`);
        }
        if (Math.abs(brightCss - expectedBright) > 2.5) {
          throw new Error(`bright period ${brightCss.toFixed(1)}px (expected ~${expectedBright.toFixed(1)}px, err ${brightRes.err.toFixed(1)})`);
        }
        return `dark repeat ${darkCss.toFixed(1)}px vs bright repeat ${brightCss.toFixed(1)}px (disparity shift ${deltaCss.toFixed(1)}px, expected ${(stripW * depth).toFixed(1)}px)`;
      } finally {
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'Anaglyph, Cross-eye Pair, Wiggle 3D and Depth Overlay draw cleanly',
    why: 'Renders modes 1, 2, 3 and 4 on an isolated ElementGL fixture, verifies gl.getError() === 0 on every mode and checks red/cyan edge separation in Anaglyph mode.',
    timeout: 6000,
    run: async () => {
      if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cw = 220, ch = 120;
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;

      const fixCard = document.createElement('div');
      fixCard.setAttribute('drawable', '');
      fixCard.style.cssText = `position:absolute;left:0;top:0;width:${cw}px;height:${ch}px;background:#05070c;display:flex;align-items:center;justify-content:center;`;
      const box = document.createElement('div');
      box.style.cssText = 'width:80px;height:56px;background:#ffffff;border-radius:6px;';
      fixCard.append(box);
      fixCanvas.append(fixCard);
      testStage().append(fixCanvas);

      const fixGL = new ElementGL(fixCanvas, {
        fragment: STEREO_FRAG,
        attributes: { alpha: false, preserveDrawingBuffer: true },
      });
      try {
        await nextPaint(fixCanvas);
        fixGL.upload(fixCard);
        let maxAnaglyphSplit = 0;

        for (const mode of [1, 2, 3, 4]) {
          fixGL.begin([0, 0, 0, 1]);
          fixGL.quad(fixCard, ElementGL.rect(fixCanvas, 0, 0, cw, ch), (gl, u) => {
            setFixtureUniforms(gl, u, { cw, ch, rect: [0, 0, cw, ch], mode, pattern: 0, stripW: 60, depth: 0.30, plinth: 0 });
          });
          const err = fixGL.gl.getError();
          if (err !== fixGL.gl.NO_ERROR) throw new Error(`mode ${mode} raised WebGL error 0x${err.toString(16)}`);

          if (mode === 2) {
            const row = new Uint8Array(fixCanvas.width * 4);
            fixGL.gl.readPixels(0, Math.floor(fixCanvas.height * 0.5), fixCanvas.width, 1, fixGL.gl.RGBA, fixGL.gl.UNSIGNED_BYTE, row);
            for (let i = 0; i < row.length; i += 4) {
              const diff = Math.abs(row[i] - row[i + 2]);
              if (diff > maxAnaglyphSplit) maxAnaglyphSplit = diff;
            }
          }
        }
        if (maxAnaglyphSplit < 80) {
          throw new Error(`anaglyph red/cyan edge split too small (max |R-B| = ${maxAnaglyphSplit})`);
        }
        return `modes 1..4 drew with gl.getError() === 0; anaglyph edge separation max |R-B| = ${maxAnaglyphSplit}`;
      } finally {
        fixGL.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() keeps live input and button clickable',
    why: 'Places an isolated drawable form with an input and button at an offset via updateElementGeometry() and verifies document.elementsFromPoint() hits both controls.',
    timeout: 6000,
    run: async () => {
      if (!('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 260, ch = 160;
      const ox = 28, oy = 22, cardW = 204, cardH = 116;
      const fixCanvas = document.createElement('canvas');
      fixCanvas.setAttribute('content', 'drawable');
      fixCanvas.setAttribute('layoutsubtree', '');
      fixCanvas.style.cssText = `width:${cw}px;height:${ch}px;display:block;`;

      const fixForm = document.createElement('div');
      fixForm.setAttribute('drawable', '');
      fixForm.style.cssText = `position:absolute;left:0;top:0;width:${cardW}px;height:${cardH}px;background:#080b12;`;

      const fixInput = document.createElement('input');
      fixInput.type = 'text';
      fixInput.value = 'LIVE';
      fixInput.setAttribute('inputmode', 'none');
      fixInput.setAttribute('aria-label', 'Fixture depth text input');
      fixInput.style.cssText = 'position:absolute;left:12px;top:12px;width:180px;height:40px;margin:0;padding:0 6px;border:0;';

      const fixBtn = document.createElement('button');
      fixBtn.type = 'button';
      fixBtn.textContent = 'Pop +';
      fixBtn.style.cssText = 'position:absolute;left:12px;top:64px;width:180px;height:40px;margin:0;padding:0;border:0;';

      fixForm.append(fixInput, fixBtn);
      fixCanvas.append(fixForm);
      testStage().append(fixCanvas);

      const fixGL = glSupported
        ? new ElementGL(fixCanvas, { fragment: STEREO_FRAG, attributes: { alpha: false } })
        : null;
      try {
        await nextPaint(fixCanvas);
        if (fixGL) {
          fixGL.upload(fixForm);
          fixGL.begin([0, 0, 0, 1]);
          fixGL.quad(fixForm, ElementGL.rect(fixCanvas, 0, 0, cw, ch), (gl, u) => {
            setFixtureUniforms(gl, u, { cw, ch, rect: [ox, oy, cardW, cardH], mode: 0, pattern: 0, stripW: 54, depth: 0.28, plinth: 0.12 });
          });
        } else {
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          fixCanvas.width = Math.round(cw * dpr);
          fixCanvas.height = Math.round(ch * dpr);
          const fctx = fixCanvas.getContext('2d');
          if (fctx) {
            fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            fctx.drawElementImage(fixForm, ox, oy, cardW, cardH);
          }
        }
        const unit = geometryUnit(fixCanvas, fixForm, cardW);
        const mat = new DOMMatrix().scale(unit).translate(ox, oy);
        fixCanvas.updateElementGeometry(fixForm, { canvasTransform: mat });
        fixForm.dataset.hitTick = '1';

        const cr = fixCanvas.getBoundingClientRect();
        const inputPt = { x: cr.left + ox + 12 + 90, y: cr.top + oy + 12 + 20 };
        const btnPt = { x: cr.left + ox + 12 + 90, y: cr.top + oy + 64 + 20 };
        const hitInput = document.elementsFromPoint(inputPt.x, inputPt.y).includes(fixInput);
        const hitBtn = document.elementsFromPoint(btnPt.x, btnPt.y).includes(fixBtn);
        if (!hitInput || !hitBtn) {
          throw new Error(`hit test failed (input=${hitInput}, button=${hitBtn}, unit=${unit.toFixed(3)})`);
        }
        return `elementsFromPoint() hit <input> and <button> at offset (${ox}, ${oy}) with geometryUnit() = ${unit.toFixed(3)}`;
      } finally {
        fixGL?.dispose();
        fixCanvas.remove();
        window.__gfx?.retire?.(fixCanvas);
      }
    },
  },
];

runTests($('checks-body'), checks);
