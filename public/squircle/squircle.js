import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const stageBox = document.getElementById('sq-stage');
const viewportEl = document.getElementById('sq-viewport');
const canvas = document.getElementById('sq-canvas');
const plainHost = document.getElementById('plain-host');
const plainDock = document.getElementById('plain-dock');
const hudEl = document.getElementById('stage-hud');
const routeNoteEl = document.getElementById('route-note');
const legendLeft = document.getElementById('legend-left');
const legendRight = document.getElementById('legend-right');
const testsBody = document.getElementById('tests-body');

// Live widgets inside <canvas>.
const tileEls = [
  document.getElementById('tile-focus'),
  document.getElementById('tile-widget'),
  document.getElementById('tile-app-0'),
  document.getElementById('tile-app-1'),
  document.getElementById('tile-app-2'),
  document.getElementById('tile-app-3'),
];

const btnFocus = document.getElementById('btn-focus');
const focusBadge = document.getElementById('focus-badge');
const swatchBtns = Array.from(document.querySelectorAll('.sq-swatch'));
const labelInput = document.getElementById('sq-label-input');
const countOut = document.getElementById('sq-count-out');
const btnCount = document.getElementById('btn-count');
const btnResetCount = document.getElementById('btn-reset-count');

const btnAppFocus = document.getElementById('btn-app-focus');
const btnAppLabel = document.getElementById('btn-app-label');
const appLabelChip = document.getElementById('app-label-chip');
const appLabelShort = document.getElementById('app-label-short');
const btnAppCount = document.getElementById('btn-app-count');
const appCountChip = document.getElementById('app-count-chip');
const btnAppTint = document.getElementById('btn-app-tint');

// External controls outside <canvas>.
const presetBtns = Array.from(document.querySelectorAll('.sq-seg button[data-n]'));
const btnCompare = document.getElementById('btn-compare');
const btnCurvature = document.getElementById('btn-curvature');
const ctlReduced = document.getElementById('ctl-reduced');
const ctlN = document.getElementById('ctl-n');
const outN = document.getElementById('out-n');
const ctlSplit = document.getElementById('ctl-split');
const outSplit = document.getElementById('out-split');
const ctlAngle = document.getElementById('ctl-angle');
const outAngle = document.getElementById('out-angle');

const reducedQuery = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const QUAD_PAD = 8;
const LABEL_PRESETS = ['Glass Dock', 'Squircle OS', 'G² Studio', 'Bevel UI'];

function hexToRgb01(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1.0, 0.48, 0.30];
  const v = parseInt(m[1], 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

const state = {
  mode: 'init', // 'webgl' | '2d' | 'plain'
  hasPainted: false,
  onScreen: true,
  n: 4.8,
  targetN: 4.8,
  splitActive: true,
  splitPct: 50,
  showCurvature: false,
  angleDeg: 315,
  focusOn: true,
  count: 4,
  accentHex: '#ff7a4d',
  accentRgb: hexToRgb01('#ff7a4d'),
  reducedOverride: reducedQuery.matches,
  uploads: 0,
  rafId: 0,
  lastTickMs: 0,
  unitCache: { key: '', unit: 1 },
};

const tiles = tileEls.map((el, index) => ({
  el,
  index,
  dirty: true,
  uploaded: false,
  hitKey: '',
  lw: 0,
  lh: 0,
  rect: { x: 0, y: 0, w: 120, h: 120 },
}));

ctlReduced.checked = state.reducedOverride;
const isReducedMotion = () => state.reducedOverride || reducedQuery.matches;

// ---------------- Superellipse Geometry & Shader ----------------

// #region squircle-shader
export const SQUIRCLE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform vec2 uCanvasSize;
uniform vec4 uQuadRect;
uniform vec4 uDockRect;
uniform float uPad;
uniform float uExponent;
uniform float uSplitActive;
uniform float uSplitX;
uniform float uShowCurv;
uniform vec3 uAccent;
uniform vec2 uLightDir;
uniform float uFocusOn;
uniform float uShadow;
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;

void evalSquircle(vec2 p, vec2 h, float n, out float sd, out vec2 norm, out float kNorm) {
  vec2 u = abs(p) / max(h, vec2(1.0));
  float maxU = max(u.x, u.y);
  if (maxU < 1e-4) {
    sd = -min(h.x, h.y);
    norm = vec2(0.0, -1.0);
    kNorm = 0.0;
    return;
  }
  float ax = max(u.x, 1e-5);
  float ay = max(u.y, 1e-5);
  float pxn = pow(ax, n);
  float pyn = pow(ay, n);
  float s = pxn + pyn;
  float g = pow(s, 1.0 / n);
  vec2 gu = vec2(pow(ax, n - 1.0) / h.x, pow(ay, n - 1.0) / h.y);
  vec2 gradAbs = gu * pow(max(s, 1e-12), (1.0 - n) / n);
  float gradLen = max(length(gradAbs), 1e-5);
  sd = (g - 1.0) / gradLen;
  vec2 sgn = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  norm = (gradAbs * sgn) / gradLen;
  float guLen = max(length(gu), 1e-6);
  float kappa = ((n - 1.0) * s / max(h.x * h.x * h.y * h.y, 1.0))
    * pow(max(ax * ay, 1e-10), max(n - 2.0, 0.0))
    / (guLen * guLen * guLen);
  kNorm = clamp(kappa * min(h.x, h.y) * 0.36, 0.0, 1.0);
}

void evalCssRound(vec2 p, vec2 h, float n, out float sd, out vec2 norm, out float kNorm, out float dKink, out float hasKink) {
  float minH = min(h.x, h.y);
  float rCss = clamp(minH * (1.0 - pow(0.5, 1.0 / n)) / (1.0 - 0.70710678), 2.0, minH);
  vec2 inner = max(h - vec2(rCss), vec2(0.0));
  vec2 ap = abs(p);
  vec2 q = ap - inner;
  sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - rCss;
  vec2 sgn = vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  if (q.x > 0.0 && q.y > 0.0) {
    norm = normalize(q) * sgn;
    kNorm = clamp((minH / rCss) * 0.36, 0.0, 1.0);
  } else if (q.x > q.y) {
    norm = vec2(sgn.x, 0.0);
    kNorm = 0.0;
  } else {
    norm = vec2(0.0, sgn.y);
    kNorm = 0.0;
  }
  float dH = inner.x > 1.0 ? length(ap - vec2(inner.x, h.y)) : 999.0;
  float dV = inner.y > 1.0 ? length(ap - vec2(h.x, inner.y)) : 999.0;
  dKink = min(dH, dV);
  hasKink = dKink < 900.0 ? 1.0 : 0.0;
}

vec3 curvatureHeat(float k) {
  vec3 c0 = vec3(0.24, 0.56, 0.92);
  vec3 c1 = vec3(0.20, 0.88, 0.72);
  vec3 c2 = vec3(0.98, 0.72, 0.20);
  vec3 c3 = vec3(1.00, 0.24, 0.34);
  if (k < 0.33) return mix(c0, c1, k / 0.33);
  if (k < 0.66) return mix(c1, c2, (k - 0.33) / 0.33);
  return mix(c2, c3, (k - 0.66) / 0.34);
}

void main() {
  if (uPass == 0) {
    vec2 canvasPx = vUv * max(uCanvasSize, vec2(1.0));
    vec2 lightPivot = uCanvasSize * 0.5 + uLightDir * min(uCanvasSize.x, uCanvasSize.y) * 0.26;
    float lightDist = length((canvasPx - lightPivot) / max(min(uCanvasSize.x, uCanvasSize.y), 1.0));
    vec3 bg = mix(vec3(0.085, 0.115, 0.175), vec3(0.032, 0.043, 0.072), smoothstep(0.0, 1.15, lightDist));
    bg += uAccent * (0.04 + 0.04 * uFocusOn) * exp(-lightDist * lightDist * 2.4);

    // Subtle 20 px studio dot lattice
    vec2 gridCell = fract(canvasPx / 20.0) - 0.5;
    float dotMask = 1.0 - smoothstep(0.045, 0.085, length(gridCell));
    bg += vec3(0.28, 0.36, 0.52) * dotMask * 0.16;

    // Frosted dock tray behind the 4 app icons
    vec2 dockCenter = uDockRect.xy + uDockRect.zw * 0.5;
    vec2 dockHalf = max(uDockRect.zw * 0.5, vec2(4.0));
    vec2 dp = canvasPx - dockCenter;
    float dSq, dCss, kSq, kCss, dKink, hasKink;
    vec2 nSq, nCss;
    evalSquircle(dp, dockHalf, max(uExponent, 2.0), dSq, nSq, kSq);
    evalCssRound(dp, dockHalf, max(uExponent, 2.0), dCss, nCss, kCss, dKink, hasKink);

    float cssSide = uSplitActive * smoothstep(uSplitX - 0.5, uSplitX + 0.5, canvasPx.x);
    float sdDock = mix(dSq, dCss, cssSide);
    vec2 nDock = normalize(mix(nSq, nCss, cssSide));

    if (sdDock < 8.0) {
      float trayShadow = exp(-max(sdDock, 0.0) * 0.35) * 0.35;
      bg *= (1.0 - trayShadow * step(0.0, sdDock));
      float trayMask = 1.0 - smoothstep(-0.75, 0.75, sdDock);
      if (trayMask > 0.001) {
        vec3 trayCol = mix(vec3(0.11, 0.15, 0.23), vec3(0.15, 0.20, 0.30), 0.5 - dp.y / max(uDockRect.w, 1.0));
        trayCol += uAccent * (0.035 + 0.03 * uFocusOn);
        float rim = smoothstep(-2.4, -0.6, sdDock) * (1.0 - smoothstep(-0.3, 0.7, sdDock));
        float directional = 0.35 + 0.65 * max(dot(nDock, uLightDir), 0.0);
        trayCol += mix(vec3(0.75, 0.84, 0.96), uAccent, 0.32) * rim * directional * 0.45;
        bg = mix(bg, trayCol, trayMask * 0.88);
      }
      if (uShowCurv > 0.5 && abs(sdDock) < 2.4) {
        float ring = 1.0 - smoothstep(0.6, 2.2, abs(sdDock));
        bg = mix(bg, curvatureHeat(mix(kSq, kCss, cssSide)), ring * 0.85);
      }
    }

    if (uSplitActive > 0.5) {
      bg += vec3(-0.008, 0.004, 0.022) * cssSide;
      float beam = 1.0 - smoothstep(0.4, 1.4, abs(canvasPx.x - uSplitX));
      bg = mix(bg, vec3(0.92, 0.96, 1.0), beam * 0.72);
    }

    outColor = vec4(bg, 1.0);
    return;
  }

  // Pass 1: Live DOM tile clipped to superellipse or CSS border-radius + glass bevel
  vec2 fullSize = uSize + 2.0 * uPad;
  vec2 p = (vUv - 0.5) * fullSize;
  vec2 h = max(uSize * 0.5, vec2(1.0));
  vec2 canvasPx = uQuadRect.xy + vUv * uQuadRect.zw;

  float sdSq, kSq, sdCss, kCss, dKink, hasKink;
  vec2 nSq, nCss;
  evalSquircle(p, h, max(uExponent, 2.0), sdSq, nSq, kSq);
  evalCssRound(p, h, max(uExponent, 2.0), sdCss, nCss, kCss, dKink, hasKink);

  float cssSide = uSplitActive * smoothstep(uSplitX - 0.5, uSplitX + 0.5, canvasPx.x);
  float sdActive = mix(sdSq, sdCss, cssSide);
  vec2 nActive = normalize(mix(nSq, nCss, cssSide));
  float kActive = mix(kSq, kCss, cssSide);

  if (sdActive > 5.0 && (uShowCurv < 0.5 || (abs(sdSq) > 3.5 && abs(sdCss) > 3.5 && dKink > 6.5))) {
    discard;
  }

  float clipMask = 1.0 - smoothstep(-0.75, 0.75, sdActive);
  vec4 tileLayer = vec4(0.0);

  if (clipMask > 0.001) {
    // Subtle optical edge refraction over outer 8 px rim; keep center 1:1 sharp
    float rimZone = smoothstep(-8.5, 0.0, sdActive);
    vec2 refrUv = (p / max(uSize, vec2(1.0))) + 0.5 - nActive * (2.2 * rimZone * rimZone) / max(uSize, vec2(1.0));
    vec4 dom = texture(uTex, clamp(refrUv, 0.001, 0.999));

    // Angled 3D inner glass bevel & pointer-driven specular glint
    float bevelSlope = smoothstep(-10.5, -0.4, sdActive) * 0.74;
    vec3 n3 = normalize(vec3(nActive * bevelSlope, sqrt(max(0.05, 1.0 - bevelSlope * bevelSlope))));
    vec3 l3 = normalize(vec3(uLightDir * 0.86, 0.50));
    vec3 h3 = normalize(l3 + vec3(0.0, 0.0, 1.0));
    float specMain = pow(max(dot(n3, h3), 0.0), 18.0);
    float specCrisp = pow(max(dot(n3, h3), 0.0), 76.0);

    vec3 lBounce = normalize(vec3(-uLightDir * 0.72, 0.58));
    vec3 hBounce = normalize(lBounce + vec3(0.0, 0.0, 1.0));
    float specBounce = pow(max(dot(n3, hBounce), 0.0), 22.0) * 0.36;

    float bevelBand = smoothstep(-10.0, -1.6, sdActive) * (1.0 - smoothstep(-0.3, 0.7, sdActive));
    float edgeLine = smoothstep(-2.1, -0.7, sdActive) * (1.0 - smoothstep(-0.2, 0.7, sdActive));

    vec3 bevelTint = mix(vec3(0.86, 0.93, 1.0), uAccent, 0.25 + 0.20 * uFocusOn);
    vec3 specRgb = bevelTint * bevelBand * (specMain * 0.38 + specBounce * 0.28)
      + vec3(1.0) * edgeLine * (0.16 + specCrisp * 0.85 + specMain * 0.35);

    vec3 rgb = dom.rgb + specRgb * dom.a;

    if (uSplitActive > 0.5) {
      float splitLine = 1.0 - smoothstep(0.4, 1.2, abs(canvasPx.x - uSplitX));
      rgb = mix(rgb, vec3(0.95, 0.98, 1.0) * dom.a, splitLine * 0.55);
    }

    tileLayer = vec4(rgb * clipMask, dom.a * clipMask);
  }

  vec4 overLayer = vec4(0.0);

  if (uShadow > 0.5 && sdActive > -0.5) {
    float drop = exp(-max(sdActive, 0.0) * 0.70) * smoothstep(5.0, 0.0, sdActive) * 0.42;
    overLayer = vec4(0.0, 0.0, 0.0, drop);
  }

  if (uShowCurv > 0.5) {
    // Plot the geometric difference halo between G² squircle and CSS border-radius
    float sqInside = step(sdSq, 0.0);
    float cssInside = step(sdCss, 0.0);
    float diffBand = abs(sqInside - cssInside);
    if (diffBand > 0.5) {
      vec3 diffCol = sqInside > cssInside ? vec3(0.18, 0.86, 1.0) : vec3(1.0, 0.48, 0.26);
      overLayer = vec4(diffCol * 0.72, 0.72);
    }
    // Ghost dashed outline of the alternative curve across the shoulder
    float sdOther = mix(sdCss, sdSq, cssSide);
    float ghost = (1.0 - smoothstep(0.4, 1.35, abs(sdOther))) * (0.45 + 0.45 * sin((p.x + p.y) * 0.65));
    if (ghost > 0.08) {
      vec3 gCol = vec3(0.94, 0.97, 1.0);
      float ga = ghost * 0.55;
      overLayer = vec4(gCol * ga, ga) + overLayer * (1.0 - ga);
    }
    // Curvature-coded edge stroke
    float edgeStroke = smoothstep(-3.0, -1.1, sdActive) * (1.0 - smoothstep(-0.2, 1.0, sdActive));
    if (edgeStroke > 0.02) {
      vec3 cCol = curvatureHeat(kActive);
      float ca = edgeStroke * 0.90;
      tileLayer.rgb = mix(tileLayer.rgb, cCol * tileLayer.a, ca);
    }
    // Kink hotspot rings at CSS border-radius tangent joins (kappa jumps 0 -> 1/R)
    if (cssSide > 0.5 && hasKink > 0.5 && dKink < 6.5) {
      float pulse = uReduced < 0.5 ? (0.82 + 0.18 * sin(uTime * 4.2)) : 1.0;
      float ring = smoothstep(5.8, 4.3, dKink) * smoothstep(2.0, 3.4, dKink);
      float core = 1.0 - smoothstep(1.1, 2.2, dKink);
      float ka = clamp((ring * 0.92 + core * 0.95) * pulse, 0.0, 1.0);
      vec3 kCol = mix(vec3(1.0, 0.22, 0.34), vec3(1.0, 0.94, 0.65), core);
      overLayer = vec4(kCol * ka, ka) + overLayer * (1.0 - ka);
    }
  }

  vec4 finalCol = tileLayer + overLayer * (1.0 - tileLayer.a);
  if (uShowCurv > 0.5 && cssSide > 0.5 && hasKink > 0.5 && dKink < 5.8) {
    // Keep kink marker ring legible on top of the CSS card edge
    float pulse = uReduced < 0.5 ? (0.82 + 0.18 * sin(uTime * 4.2)) : 1.0;
    float ring = smoothstep(5.8, 4.3, dKink) * smoothstep(2.0, 3.4, dKink);
    float core = 1.0 - smoothstep(1.1, 2.2, dKink);
    float ka = clamp((ring * 0.90 + core * 0.95) * pulse, 0.0, 1.0);
    vec3 kCol = mix(vec3(1.0, 0.22, 0.34), vec3(1.0, 0.94, 0.65), core);
    finalCol = vec4(kCol * ka, ka) + finalCol * (1.0 - ka);
  }
  outColor = finalCol;
}`;
// #endregion squircle-shader

// ---------------- Responsive Layout ----------------

export function computeLayout(cw, ch) {
  const deckW = Math.min(cw - 20, 520);
  const deckLeft = Math.round((cw - deckW) * 0.5);
  const gap = cw < 460 ? 12 : 16;

  const cardW = Math.floor((deckW - gap) * 0.5);
  const cardH = cw < 460 ? 160 : 178;
  const topY = cw < 460 ? 22 : 26;

  const iconGap = cw < 460 ? 12 : 18;
  const iconPadX = cw < 460 ? 14 : 22;
  const iconSize = Math.min(92, Math.floor((deckW - iconPadX * 2 - iconGap * 3) / 4));
  const dockH = iconSize + (cw < 460 ? 24 : 28);
  const dockY = topY + cardH + (cw < 460 ? 18 : 22);
  const iconsRowW = iconSize * 4 + iconGap * 3;
  const iconsStartX = Math.round(cw * 0.5 - iconsRowW * 0.5);
  const iconY = Math.round(dockY + (dockH - iconSize) * 0.5);

  return {
    rects: [
      { x: deckLeft, y: topY, w: cardW, h: cardH },
      { x: deckLeft + cardW + gap, y: topY, w: cardW, h: cardH },
      { x: iconsStartX + (iconSize + iconGap) * 0, y: iconY, w: iconSize, h: iconSize },
      { x: iconsStartX + (iconSize + iconGap) * 1, y: iconY, w: iconSize, h: iconSize },
      { x: iconsStartX + (iconSize + iconGap) * 2, y: iconY, w: iconSize, h: iconSize },
      { x: iconsStartX + (iconSize + iconGap) * 3, y: iconY, w: iconSize, h: iconSize },
    ],
    dock: { x: deckLeft, y: dockY, w: deckW, h: dockH },
  };
}

function canvasCssBox() {
  return {
    cw: Math.max(240, canvas.clientWidth || viewportEl.clientWidth || 360),
    ch: Math.max(240, canvas.clientHeight || viewportEl.clientHeight || 356),
  };
}

function syncTileDomSizes(rects) {
  let resized = false;
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    const r = rects[i];
    t.rect = r;
    if (t.lw !== r.w || t.lh !== r.h) {
      t.lw = r.w;
      t.lh = r.h;
      t.el.style.width = `${r.w}px`;
      t.el.style.height = `${r.h}px`;
      t.dirty = true;
      t.hitKey = '';
      resized = true;
    }
  }
  return resized;
}

// #region hit-sync
function syncTileGeometries(force = false) {
  if (state.mode === 'plain' || !('updateElementGeometry' in HTMLCanvasElement.prototype)) return;
  const { cw, ch } = canvasCssBox();
  const refTile = tiles[0];
  const refW = refTile.el.offsetWidth || refTile.rect.w;
  const unitKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${refW}`;
  if (state.unitCache.key !== unitKey && canvas.width > 0 && cw > 0 && refW > 0) {
    state.unitCache.unit = geometryUnit(canvas, refTile.el, refW);
    state.unitCache.key = unitKey;
    for (const t of tiles) t.hitKey = '';
  }
  const unit = state.unitCache.unit || 1;
  for (const t of tiles) {
    const { x, y } = t.rect;
    const key = `${x.toFixed(1)},${y.toFixed(1)},${unit.toFixed(4)}`;
    if (!force && t.hitKey === key) continue;
    t.hitKey = key;
    t.el.inert = false;
    const m = new DOMMatrix().translate(x * unit, y * unit).scale(unit, unit);
    canvas.updateElementGeometry(t.el, { canvasTransform: m });
    t.el.dataset.hitTick = t.el.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion hit-sync

// ---------------- UI Sync & Widget Actions ----------------

function padCount(n) {
  return String(Math.max(0, n)).padStart(2, '0');
}

function updateLegendAndHud() {
  legendLeft.textContent = `G² Squircle (n=${state.n.toFixed(1)})`;
  legendLeft.classList.toggle('is-hidden', state.splitActive && state.splitPct < 10);
  legendRight.classList.toggle('is-hidden', !state.splitActive || state.splitPct > 90);

  const route =
    state.mode === 'webgl' ? 'WebGL 2 ElementGL'
      : state.mode === '2d' ? '2D superellipse clip'
        : 'Plain HTML';
  const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const splitStr = state.splitActive ? `split ${Math.round(state.splitPct)}%` : 'full G²';
  hudEl.textContent = `${route} · n=${state.n.toFixed(1)} · ${splitStr} · ${mp} MP · ${state.uploads} uploads`;
}

function syncExternalControls() {
  for (const btn of presetBtns) {
    const target = Number(btn.dataset.n);
    btn.setAttribute('aria-pressed', String(Math.abs(state.targetN - target) < 0.05));
  }
  btnCompare.setAttribute('aria-pressed', String(state.splitActive));
  btnCurvature.setAttribute('aria-pressed', String(state.showCurvature));
  ctlN.value = state.n.toFixed(1);
  outN.textContent = state.n.toFixed(1);
  ctlSplit.value = String(Math.round(state.splitPct));
  outSplit.textContent = `${Math.round(state.splitPct)}%`;
  ctlAngle.value = String(Math.round(state.angleDeg));
  outAngle.textContent = `${Math.round(state.angleDeg)}°`;
  updateLegendAndHud();
}

function markTilesDirty(...indices) {
  for (const i of indices) {
    if (tiles[i]) tiles[i].dirty = true;
  }
  if (state.mode !== 'plain') canvas.requestPaint?.();
}

function setFocusMode(next) {
  state.focusOn = Boolean(next);
  btnFocus.setAttribute('aria-pressed', String(state.focusOn));
  btnAppFocus.setAttribute('aria-pressed', String(state.focusOn));
  focusBadge.textContent = state.focusOn ? 'Focus On' : 'Focus Off';
  focusBadge.classList.toggle('is-off', !state.focusOn);
  tiles[0].el.classList.toggle('is-focus-on', state.focusOn);
  tiles[1].el.classList.toggle('is-focus-on', state.focusOn);
  markTilesDirty(0, 1, 2);
}

function setAccent(hex) {
  state.accentHex = hex;
  state.accentRgb = hexToRgb01(hex);
  stageBox.style.setProperty('--sq-accent', hex);
  for (const b of swatchBtns) {
    b.setAttribute('aria-pressed', String(b.dataset.tint === hex));
  }
  markTilesDirty(0, 1, 2, 3, 4, 5);
}

function setCount(next) {
  state.count = Math.max(0, Math.min(999, next));
  const txt = padCount(state.count);
  countOut.textContent = txt;
  appCountChip.textContent = txt;
  markTilesDirty(1, 4);
}

function syncLabelChip() {
  const raw = (labelInput.value || 'Widget').trim() || 'Widget';
  const shortWord = raw.split(/\s+/)[0].slice(0, 7);
  const code = raw.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'WID';
  appLabelShort.textContent = shortWord;
  appLabelChip.textContent = code;
  markTilesDirty(1, 3);
}

// ---------------- WebGL 2 Upload & Draw ----------------

let stage = null;
let ctx2d = null;
const matBuf = new Float32Array(16);

// #region gl-init
function uploadDirtyTiles(event) {
  if (!state.hasPainted || !stage || stage.lost) return;
  let changedSet = null;
  if (Array.isArray(event?.changedElements)) {
    changedSet = new Set();
    for (const node of event.changedElements) {
      const tile = node?.closest?.('.sq-tile');
      if (tile) changedSet.add(tile);
    }
  }
  for (const t of tiles) {
    if (!t.uploaded || t.dirty || (changedSet && changedSet.has(t.el))) {
      try {
        const tex = stage.upload(t.el);
        if (tex) {
          t.uploaded = true;
          t.dirty = false;
          state.uploads++;
        }
      } catch (err) {
        if (/paint record/i.test(err?.message ?? '')) {
          t.dirty = true;
          canvas.requestPaint?.();
        } else {
          throw err;
        }
      }
    }
  }
}

function drawWebGLScene(event = null, forceGeo = false) {
  if (!state.hasPainted || !stage || stage.lost) return;
  const { cw, ch } = canvasCssBox();
  if (cw < 16 || ch < 16) return;

  const layout = computeLayout(cw, ch);
  syncTileDomSizes(layout.rects);

  if (!stage.begin([0.035, 0.047, 0.078, 1.0])) return;
  uploadDirtyTiles(event);

  const readyTile = tiles.find((t) => t.uploaded && stage.has(t.el));
  if (!readyTile) return;

  const rad = (state.angleDeg * Math.PI) / 180;
  const lx = Math.cos(rad);
  const ly = Math.sin(rad);
  const splitX = (state.splitPct / 100) * cw;
  const splitFlag = state.splitActive ? 1.0 : 0.0;
  const curvFlag = state.showCurvature ? 1.0 : 0.0;
  const focusFlag = state.focusOn ? 1.0 : 0.0;
  const reducedFlag = isReducedMotion() ? 1.0 : 0.0;

  const bindCommon = (gl, loc) => {
    gl.uniform2f(loc('uCanvasSize'), cw, ch);
    gl.uniform4f(loc('uDockRect'), layout.dock.x, layout.dock.y, layout.dock.w, layout.dock.h);
    gl.uniform1f(loc('uExponent'), state.n);
    gl.uniform1f(loc('uSplitActive'), splitFlag);
    gl.uniform1f(loc('uSplitX'), splitX);
    gl.uniform1f(loc('uShowCurv'), curvFlag);
    gl.uniform3f(loc('uAccent'), state.accentRgb[0], state.accentRgb[1], state.accentRgb[2]);
    gl.uniform2f(loc('uLightDir'), lx, ly);
    gl.uniform1f(loc('uFocusOn'), focusFlag);
    gl.uniform1f(loc('uReduced'), reducedFlag);
  };

  // Pass 0: radial glass backdrop, dot grid and frosted dock tray.
  ElementGL.rect(canvas, 0, 0, cw, ch, matBuf);
  stage.quad(readyTile.el, matBuf, (gl, loc) => {
    gl.uniform1i(loc('uPass'), 0);
    gl.uniform4f(loc('uQuadRect'), 0, 0, cw, ch);
    gl.uniform1f(loc('uPad'), 0.0);
    gl.uniform1f(loc('uShadow'), 0.0);
    bindCommon(gl, loc);
  });

  // Pass 1: each live widget clipped to G² superellipse or CSS border-radius.
  for (const t of tiles) {
    if (!t.uploaded || !stage.has(t.el)) continue;
    const { x, y, w, h } = t.rect;
    const qx = x - QUAD_PAD;
    const qy = y - QUAD_PAD;
    const qw = w + QUAD_PAD * 2;
    const qh = h + QUAD_PAD * 2;
    ElementGL.rect(canvas, qx, qy, qw, qh, matBuf);
    stage.quad(t.el, matBuf, (gl, loc) => {
      gl.uniform1i(loc('uPass'), 1);
      gl.uniform4f(loc('uQuadRect'), qx, qy, qw, qh);
      gl.uniform1f(loc('uPad'), QUAD_PAD);
      gl.uniform1f(loc('uShadow'), 1.0);
      bindCommon(gl, loc);
    });
  }

  syncTileGeometries(forceGeo);
  updateLegendAndHud();
}
// #endregion gl-init

// ---------------- 2D Superellipse Fallback ----------------

function buildSuperellipsePath(x, y, w, h, n) {
  const path = new Path2D();
  const cx = x + w * 0.5;
  const cy = y + h * 0.5;
  const a = w * 0.5;
  const b = h * 0.5;
  const steps = 64;
  const exp = 2 / Math.max(2, n);
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    const px = cx + Math.sign(ct) * Math.pow(Math.abs(ct), exp) * a;
    const py = cy + Math.sign(st) * Math.pow(Math.abs(st), exp) * b;
    if (i === 0) path.moveTo(px, py);
    else path.lineTo(px, py);
  }
  path.closePath();
  return path;
}

function buildCssRoundPath(x, y, w, h, n) {
  const minH = Math.min(w, h) * 0.5;
  const rCss = Math.max(2, Math.min(minH, minH * (1 - Math.pow(0.5, 1 / n)) / (1 - Math.SQRT1_2)));
  const path = new Path2D();
  path.roundRect(x, y, w, h, rCss);
  return path;
}

// #region fallback-2d
function draw2DScene(forceGeo = false) {
  if (!state.hasPainted || !ctx2d) return;
  const { cw, ch } = canvasCssBox();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  const layout = computeLayout(cw, ch);
  syncTileDomSizes(layout.rects);

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);

  const bg = ctx2d.createRadialGradient(cw * 0.35, ch * 0.28, 16, cw * 0.5, ch * 0.5, Math.max(cw, ch) * 0.75);
  bg.addColorStop(0, '#182235');
  bg.addColorStop(1, '#090c14');
  ctx2d.fillStyle = bg;
  ctx2d.fillRect(0, 0, cw, ch);

  const dockPath = buildSuperellipsePath(layout.dock.x, layout.dock.y, layout.dock.w, layout.dock.h, state.n);
  ctx2d.fillStyle = 'rgba(20, 28, 43, 0.88)';
  ctx2d.fill(dockPath);
  ctx2d.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx2d.lineWidth = 1;
  ctx2d.stroke(dockPath);

  const splitX = (state.splitPct / 100) * cw;
  const rad = (state.angleDeg * Math.PI) / 180;
  const gx = Math.cos(rad);
  const gy = Math.sin(rad);

  for (const t of tiles) {
    const { x, y, w, h } = t.rect;
    const sqPath = buildSuperellipsePath(x, y, w, h, state.n);
    const cssPath = buildCssRoundPath(x, y, w, h, state.n);

    const drawSide = (clipMinX, clipMaxX, path) => {
      if (clipMaxX <= clipMinX) return;
      ctx2d.save();
      ctx2d.beginPath();
      ctx2d.rect(clipMinX, 0, clipMaxX - clipMinX, ch);
      ctx2d.clip();
      ctx2d.clip(path);
      try {
        ctx2d.drawElementImage(t.el, x, y, w, h);
      } catch {}
      const grad = ctx2d.createLinearGradient(
        x + w * (0.5 + gx * 0.5),
        y + h * (0.5 + gy * 0.5),
        x + w * (0.5 - gx * 0.5),
        y + h * (0.5 - gy * 0.5)
      );
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.05)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.18)');
      ctx2d.strokeStyle = grad;
      ctx2d.lineWidth = 2;
      ctx2d.stroke(path);
      ctx2d.restore();
    };

    if (state.splitActive) {
      drawSide(0, splitX, sqPath);
      drawSide(splitX, cw, cssPath);
    } else {
      drawSide(0, cw, sqPath);
    }
  }

  if (state.splitActive) {
    ctx2d.fillStyle = 'rgba(235, 244, 255, 0.72)';
    ctx2d.fillRect(splitX - 0.75, 0, 1.5, ch);
  }

  state.uploads++;
  syncTileGeometries(forceGeo);
  updateLegendAndHud();
}
// #endregion fallback-2d

// ---------------- Plain HTML Context-Loss & Fallback ----------------

function enterPlainFallback(reason, { keepForRestore = false } = {}) {
  state.mode = 'plain';
  stageBox.classList.add('is-plain');
  for (let i = 0; i < tiles.length; i++) {
    const t = tiles[i];
    t.el.inert = false;
    t.el.style.width = '';
    t.el.style.height = '';
    t.lw = 0;
    t.lh = 0;
    if (i < 2) plainHost.insertBefore(t.el, plainDock);
    else plainDock.append(t.el);
  }
  routeNoteEl.textContent = reason;
  updateLegendAndHud();
  if (!keepForRestore) stopLoop();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const t of tiles) {
    t.uploaded = false;
    t.dirty = true;
    t.hitKey = '';
    t.lw = 0;
    t.lh = 0;
    canvas.append(t.el);
  }
  state.unitCache.key = '';
}

// ---------------- Animation Loop ----------------

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastTickMs = 0;
}

function needsLoop() {
  if (state.mode === 'plain' || !state.onScreen || document.hidden) return false;
  if (Math.abs(state.n - state.targetN) > 0.01) return true;
  if (state.showCurvature && state.splitActive && !isReducedMotion()) return true;
  return false;
}

function startLoop() {
  if (!state.rafId && needsLoop()) {
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }
}

function drawCurrentFrame(event = null, forceGeo = false) {
  if (state.mode === 'webgl') drawWebGLScene(event, forceGeo);
  else if (state.mode === '2d') draw2DScene(forceGeo);
}

function tick(now) {
  state.rafId = 0;
  if (!needsLoop()) return;

  const dt = state.lastTickMs ? Math.min(0.05, (now - state.lastTickMs) / 1000) : 0.016;
  state.lastTickMs = now;

  const diff = state.targetN - state.n;
  if (isReducedMotion() || Math.abs(diff) <= 0.015) {
    state.n = state.targetN;
  } else {
    state.n += diff * Math.min(1, dt * 13);
  }
  syncExternalControls();

  if (state.hasPainted) drawCurrentFrame(null, false);
  if (needsLoop()) state.rafId = requestAnimationFrame(tick);
}

// ---------------- Event Wiring ----------------

btnFocus.addEventListener('click', () => setFocusMode(!state.focusOn));
btnAppFocus.addEventListener('click', () => setFocusMode(!state.focusOn));

for (const sw of swatchBtns) {
  sw.addEventListener('click', () => setAccent(sw.dataset.tint));
}
btnAppTint.addEventListener('click', () => {
  const idx = swatchBtns.findIndex((b) => b.dataset.tint === state.accentHex);
  const next = swatchBtns[(idx + 1) % swatchBtns.length];
  if (next) setAccent(next.dataset.tint);
});

btnCount.addEventListener('click', () => setCount(state.count + 1));
btnAppCount.addEventListener('click', () => setCount(state.count + 1));
btnResetCount.addEventListener('click', () => setCount(0));

labelInput.addEventListener('input', syncLabelChip);
btnAppLabel.addEventListener('click', () => {
  const idx = LABEL_PRESETS.indexOf(labelInput.value);
  labelInput.value = LABEL_PRESETS[(idx + 1) % LABEL_PRESETS.length];
  syncLabelChip();
});

for (const btn of presetBtns) {
  btn.addEventListener('click', () => {
    const target = Number(btn.dataset.n);
    state.targetN = target;
    if (isReducedMotion()) {
      state.n = target;
      syncExternalControls();
      if (state.hasPainted) drawCurrentFrame();
      return;
    }
    syncExternalControls();
    startLoop();
  });
}

btnCompare.addEventListener('click', () => {
  state.splitActive = !state.splitActive;
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
  if (needsLoop()) startLoop();
  else stopLoop();
});

btnCurvature.addEventListener('click', () => {
  state.showCurvature = !state.showCurvature;
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
  if (needsLoop()) startLoop();
  else stopLoop();
});

ctlN.addEventListener('input', () => {
  const v = Math.max(2, Math.min(12, Number(ctlN.value) || 4.8));
  state.n = v;
  state.targetN = v;
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
});

ctlSplit.addEventListener('input', () => {
  state.splitPct = Math.max(0, Math.min(100, Number(ctlSplit.value) || 0));
  state.splitActive = true;
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
  if (needsLoop()) startLoop();
});

ctlAngle.addEventListener('input', () => {
  state.angleDeg = Math.max(0, Math.min(360, Number(ctlAngle.value) || 0));
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
});

function updateLightFromPointer(e) {
  if (state.mode === 'plain') return;
  const r = viewportEl.getBoundingClientRect();
  const dx = e.clientX - (r.left + r.width * 0.5);
  const dy = e.clientY - (r.top + r.height * 0.5);
  if (Math.hypot(dx, dy) < 10) return;
  const deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
  state.angleDeg = Math.round(deg);
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
}

viewportEl.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || e.buttons > 0) updateLightFromPointer(e);
});
viewportEl.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse') updateLightFromPointer(e);
});

ctlReduced.addEventListener('change', () => {
  state.reducedOverride = ctlReduced.checked;
  if (isReducedMotion()) {
    state.n = state.targetN;
    stopLoop();
  }
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
  if (needsLoop()) startLoop();
});

reducedQuery.addEventListener?.('change', () => {
  state.reducedOverride = reducedQuery.matches;
  ctlReduced.checked = state.reducedOverride;
  if (isReducedMotion()) {
    state.n = state.targetN;
    stopLoop();
  }
  syncExternalControls();
  if (state.hasPainted) drawCurrentFrame();
  if (needsLoop()) startLoop();
});

const refreshHits = () => {
  if (state.mode !== 'plain' && state.hasPainted) syncTileGeometries();
};
canvas.addEventListener('pointerdown', refreshHits, true);
canvas.addEventListener('focusin', refreshHits);

// ---------------- Boot & Observers ----------------

function wireCanvasListeners() {
  canvas.addEventListener('paint', (e) => {
    state.hasPainted = true;
    if (Array.isArray(e.changedElements)) {
      for (const node of e.changedElements) {
        const host = node?.closest?.('.sq-tile');
        const found = tiles.find((t) => t.el === host);
        if (found) found.dirty = true;
      }
    }
    drawCurrentFrame(e, true);
    startLoop();
  });

  canvas.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.mode === '2d') {
      enterPlainFallback('The 2D canvas context was lost, so the widget dock moved to plain HTML.', { keepForRestore: true });
    }
  });

  canvas.addEventListener('contextrestored', () => {
    if (state.mode === 'plain' && ctx2d) {
      state.mode = '2d';
      state.hasPainted = false;
      exitPlainFallback();
      routeNoteEl.textContent = '2D canvas context restored (5-argument drawElementImage() superellipse clips).';
      canvas.requestPaint?.();
    }
  });
}

function initBackend() {
  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: SQUIRCLE_FRAG,
        attributes: { alpha: false, depth: false, antialias: false, powerPreference: 'low-power' },
        onLost: () => {
          state.hasPainted = false;
          for (const t of tiles) { t.uploaded = false; t.dirty = true; }
          enterPlainFallback('The WebGL 2 context was lost, so the dock moved to plain HTML until restored.', { keepForRestore: true });
        },
        onRestored: () => {
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          state.mode = 'webgl';
          state.hasPainted = false;
          exitPlainFallback();
          routeNoteEl.textContent = 'WebGL 2 context restored (one ElementGL context with premultiplied texElementSubImage2D()).';
          canvas.requestPaint?.();
          startLoop();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      state.mode = 'webgl';
      routeNoteEl.textContent = 'Drawn with one ElementGL WebGL 2 context using premultiplied texElementSubImage2D() and updateElementGeometry().';
      wireCanvasListeners();
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      routeNoteEl.textContent = `WebGL 2 could not start (${err.message}); falling back to 2D.`;
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      state.mode = '2d';
      routeNoteEl.textContent = 'WebGL 2 texElementSubImage2D() is unavailable here; using 5-argument drawElementImage() superellipse clips.';
      wireCanvasListeners();
      canvas.requestPaint?.();
      return;
    }
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so the dock widgets are shown as plain HTML.');
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = !!entry?.isIntersecting;
    if (!state.onScreen) stopLoop();
    else if (state.hasPainted) {
      drawCurrentFrame();
      startLoop();
    }
  }, { rootMargin: '120px' }).observe(stageBox);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.mode === 'plain') return;
    state.unitCache.key = '';
    for (const t of tiles) t.hitKey = '';
    if (state.hasPainted) drawCurrentFrame(null, true);
    else canvas.requestPaint?.();
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopLoop();
  else if (state.onScreen && state.hasPainted) {
    drawCurrentFrame();
    startLoop();
  }
});

syncLabelChip();
syncExternalControls();
initBackend();

// ---------------- Live Checks (Tap-Gated, Isolated testStage Fixtures) ----------------

const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

async function retireFixture(g, rootEl, canvasEl, baseActive) {
  g?.dispose();
  rootEl?.remove();
  window.__gfx?.retire?.(canvasEl);
  for (let i = 0; i < 15; i++) {
    const active = window.__gfx?.active?.() ?? 0;
    const removed = window.__gfx?.memory?.().removed ?? 0;
    if (active <= baseActive && removed === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
}

function makeFixtureTileCanvas(w, h, { solid = false, interactive = false } = {}) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;background:transparent`;

  const tile = document.createElement('div');
  tile.setAttribute('drawable', '');
  tile.style.cssText =
    `position:absolute;left:0;top:0;width:${w}px;height:${h}px;box-sizing:border-box;` +
    (solid
      ? 'background:#284b8a;color:#ffffff;'
      : 'padding:18px;background:linear-gradient(155deg,#1f2c44,#101726);color:#f8fafc;display:flex;flex-direction:column;justify-content:space-between;');

  let btn = null;
  let inp = null;
  if (interactive) {
    inp = document.createElement('input');
    inp.type = 'text';
    inp.value = 'Glass';
    inp.style.cssText = 'width:100%;height:34px;padding:4px 8px;box-sizing:border-box;border-radius:8px;border:1px solid #64748b;background:#0a0e17;color:#fff;font:600 13px system-ui';
    btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '+1 Tap';
    btn.style.cssText = 'width:100%;height:36px;border-radius:8px;border:0;background:#ff7a4d;color:#0b0f18;font:700 13px system-ui';
    tile.append(inp, btn);
  } else if (!solid) {
    tile.innerHTML = '<div style="font:700 13px system-ui">Studio G²</div><div style="height:26px;border-radius:8px;background:#ff7a4d"></div>';
  }

  cv.append(tile);
  return { cv, tile, btn, inp };
}

function drawFixtureTile(g, cv, tile, w, h, { n = 4.8, splitActive = 0, splitX = w * 0.5, shadow = 1, showCurv = 0 } = {}) {
  ElementGL.rect(cv, 0, 0, w, h, matBuf);
  g.quad(tile, matBuf, (gl, loc) => {
    gl.uniform1i(loc('uPass'), 1);
    gl.uniform2f(loc('uCanvasSize'), w, h);
    gl.uniform4f(loc('uQuadRect'), 0, 0, w, h);
    gl.uniform4f(loc('uDockRect'), 0, 0, w, h);
    gl.uniform1f(loc('uPad'), 0.0);
    gl.uniform1f(loc('uExponent'), n);
    gl.uniform1f(loc('uSplitActive'), splitActive);
    gl.uniform1f(loc('uSplitX'), splitX);
    gl.uniform1f(loc('uShowCurv'), showCurv);
    gl.uniform3f(loc('uAccent'), 1.0, 0.48, 0.30);
    gl.uniform2f(loc('uLightDir'), -0.62, -0.78);
    gl.uniform1f(loc('uFocusOn'), 1.0);
    gl.uniform1f(loc('uShadow'), shadow);
    gl.uniform1f(loc('uReduced'), 1.0);
  });
}

function readCssPx(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

runTests(testsBody, [
  {
    name: 'ElementGL upload via texElementSubImage2D() and squircle draw (glErr === 0)',
    expect: 'pass',
    why: 'Creates an isolated ElementGL canvas on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), draws with SQUIRCLE_FRAG and checks gl.getError() === 0.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const t0 = performance.now();
      const W = 200;
      const H = 140;
      const { cv, tile } = makeFixtureTileCanvas(W, H, { solid: true });
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: SQUIRCLE_FRAG, attributes: { alpha: true, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const tex = g.upload(tile);
        drawFixtureTile(g, cv, tile, W, H, { n: 4.8 });
        const err = g.gl.getError();
        const centre = readCssPx(g.gl, cv, W, H, W * 0.5, H * 0.5);
        const ms = Math.round(performance.now() - t0);
        return need(
          err === g.gl.NO_ERROR && tex?.w > 0 && centre[3] === 255 && centre[2] > 100,
          `tex=${tex?.w}×${tex?.h}, glErr=${err}, centre=[${Array.from(centre)}], t=${ms}ms`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Exponent n = 2 -> 4.8 -> 10 changes corner-shoulder fill area and differs from CSS border-radius',
    expect: 'pass',
    why: 'Renders a 140×140 solid fixture at n = 2.0, 4.8 and 10.0, measures corner-quadrant opaque pixel fill percentage, and diffs n = 4.8 squircle against its diagonal-matched CSS border-radius arc.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const t0 = performance.now();
      const S = 140;
      const { cv, tile } = makeFixtureTileCanvas(S, S, { solid: true });
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: SQUIRCLE_FRAG, attributes: { alpha: true, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(tile);

        const sampleMask = (nVal, splitActive) => {
          g.begin([0, 0, 0, 0]);
          drawFixtureTile(g, cv, tile, S, S, { n: nVal, splitActive, splitX: -100, shadow: 0 });
          const qw = Math.floor(cv.width * 0.5);
          const qh = Math.floor(cv.height * 0.5);
          const buf = new Uint8Array(qw * qh * 4);
          g.gl.readPixels(0, cv.height - qh, qw, qh, g.gl.RGBA, g.gl.UNSIGNED_BYTE, buf);
          let hits = 0;
          const total = qw * qh;
          const bits = new Uint8Array(total);
          for (let i = 0; i < total; i++) {
            const on = buf[i * 4 + 3] > 128 ? 1 : 0;
            bits[i] = on;
            hits += on;
          }
          return { pct: (hits / total) * 100, hits, total, bits };
        };

        const m2 = sampleMask(2.0, 0);
        const m48 = sampleMask(4.8, 0);
        const m10 = sampleMask(10.0, 0);
        const mCss = sampleMask(4.8, 1);

        let shoulderDiff = 0;
        for (let i = 0; i < m48.bits.length; i++) {
          if (m48.bits[i] !== mCss.bits[i]) shoulderDiff++;
        }
        const err = g.gl.getError();
        const ms = Math.round(performance.now() - t0);
        return need(
          err === g.gl.NO_ERROR && m2.pct < m48.pct - 8 && m48.pct < m10.pct - 3 && shoulderDiff > 0,
          `corner fill n=2:${m2.pct.toFixed(1)}% -> n=4.8:${m48.pct.toFixed(1)}% -> n=10:${m10.pct.toFixed(1)}%; vs CSS R diff=${shoulderDiff}/${m48.total} px (${mCss.pct.toFixed(1)}%), t=${ms}ms`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Corner-outside transparency: alpha === 0 at bbox corner, opaque inside tile',
    expect: 'pass',
    why: 'Draws a 140×140 squircle tile (n = 4.8) with live bevel and shadow enabled on a transparent canvas and reads alpha at the outer bbox corner (2, 2) vs interior centre (70, 70).',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const t0 = performance.now();
      const S = 140;
      const { cv, tile } = makeFixtureTileCanvas(S, S, { solid: true });
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: SQUIRCLE_FRAG, attributes: { alpha: true, preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(tile);
        drawFixtureTile(g, cv, tile, S, S, { n: 4.8, shadow: 1 });
        const corner = readCssPx(g.gl, cv, S, S, 2, 2);
        const inside = readCssPx(g.gl, cv, S, S, S * 0.5, S * 0.5);
        const err = g.gl.getError();
        const ms = Math.round(performance.now() - t0);
        return need(
          err === g.gl.NO_ERROR && corner[3] === 0 && inside[3] === 255,
          `corner(2,2)=[${Array.from(corner)}], inside(70,70)=[${Array.from(inside)}], t=${ms}ms`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Hit-testing via updateElementGeometry() reaches buttons and inputs inside squircle tiles',
    expect: 'pass',
    why: 'Syncs geometryUnit()-scaled updateElementGeometry() and toggles dataset.hitTick on an offset squircle tile fixture, checks elementsFromPoint() hits <button> and <input>, and triggers click/input events.',
    timeout: 6000,
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const t0 = performance.now();
      const W = 280;
      const H = 160;
      const tw = 168;
      const th = 128;
      const ox = 56;
      const oy = 16;
      const { cv, tile, btn, inp } = makeFixtureTileCanvas(tw, th, { interactive: true });
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: SQUIRCLE_FRAG, attributes: { alpha: true, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);
        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(tile);
          ElementGL.rect(cv, ox, oy, tw, th, matBuf);
          g.quad(tile, matBuf, (gl, loc) => {
            gl.uniform1i(loc('uPass'), 1);
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform4f(loc('uQuadRect'), ox, oy, tw, th);
            gl.uniform4f(loc('uDockRect'), ox, oy, tw, th);
            gl.uniform1f(loc('uPad'), 0.0);
            gl.uniform1f(loc('uExponent'), 4.8);
            gl.uniform1f(loc('uSplitActive'), 0.0);
            gl.uniform1f(loc('uSplitX'), W * 0.5);
            gl.uniform1f(loc('uShowCurv'), 0.0);
            gl.uniform3f(loc('uAccent'), 1.0, 0.48, 0.30);
            gl.uniform2f(loc('uLightDir'), -0.62, -0.78);
            gl.uniform1f(loc('uFocusOn'), 1.0);
            gl.uniform1f(loc('uShadow'), 1.0);
            gl.uniform1f(loc('uReduced'), 1.0);
          });
        }

        let clicks = 0;
        btn.addEventListener('click', () => { clicks++; });
        let lastVal = inp.value;
        inp.addEventListener('input', () => { lastVal = inp.value; });

        const unit = geometryUnit(cv, tile, tw);
        cv.updateElementGeometry(tile, { canvasTransform: new DOMMatrix().translate(ox * unit, oy * unit).scale(unit, unit) });
        tile.dataset.hitTick = '1';
        await raf2();

        const bRect = btn.getBoundingClientRect();
        const iRect = inp.getBoundingClientRect();
        const bHits = document.elementsFromPoint(bRect.left + bRect.width * 0.5, bRect.top + bRect.height * 0.5);
        const iHits = document.elementsFromPoint(iRect.left + iRect.width * 0.5, iRect.top + iRect.height * 0.5);

        btn.click();
        inp.value = 'Squircle';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        const ms = Math.round(performance.now() - t0);
        return need(
          bHits.includes(btn) && iHits.includes(inp) && clicks === 1 && lastVal === 'Squircle',
          `buttonHit=${bHits.includes(btn)}, inputHit=${iHits.includes(inp)}, clicks=${clicks}, label="${lastVal}", t=${ms}ms`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored rescue and 2D 5-arg drawElementImage() fallback',
    expect: 'pass',
    why: 'Tests cancelable webglcontextlost rescue to plain HTML plus webglcontextrestored ElementGL recovery, then runs a 5-argument drawElementImage() superellipse clip check on a 2D fixture.',
    timeout: 7000,
    run: async () => {
      if (!hicSupported) throw new Error('HTML-in-canvas is not available');
      const t0 = performance.now();
      const W = 200;
      const H = 120;

      // Part A: synthetic webglcontextlost + webglcontextrestored
      let glOk = !glSupported;
      let texAfterW = 0;
      if (glSupported) {
        const wrap = document.createElement('div');
        const plain = document.createElement('div');
        plain.hidden = true;
        const { cv, tile } = makeFixtureTileCanvas(W, H, { solid: true });
        wrap.append(cv, plain);
        testStage().append(wrap);
        let g = null;
        let lostFired = false;
        let restoredFired = false;
        const baseActive = window.__gfx?.active?.() ?? 0;
        try {
          g = new ElementGL(cv, {
            fragment: SQUIRCLE_FRAG,
            attributes: { alpha: true, preserveDrawingBuffer: true },
            onLost: () => {
              lostFired = true;
              plain.hidden = false;
              plain.append(tile);
            },
            onRestored: () => {
              restoredFired = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              plain.hidden = true;
              cv.append(tile);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 0]);
          await nextPaint(cv);
          g.begin([0, 0, 0, 0]);
          g.upload(tile);

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(lostEv);
          const whileLost = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(tile);

          cv.dispatchEvent(new Event('webglcontextrestored'));
          g.begin([0, 0, 0, 0]);
          await nextPaint(cv);
          g.begin([0, 0, 0, 0]);
          const texAfter = g.upload(tile);
          drawFixtureTile(g, cv, tile, W, H, { n: 4.8 });
          const err = g.gl.getError();
          texAfterW = texAfter?.w ?? 0;
          glOk = whileLost && restoredFired && !g.lost && cv.contains(tile) && texAfterW > 0 && err === g.gl.NO_ERROR;
        } finally {
          await retireFixture(g, wrap, cv, baseActive);
        }
      }

      // Part B: 2D 5-arg drawElementImage() clipped to a superellipse Path2D
      const { cv: cv2d, tile: tile2d } = makeFixtureTileCanvas(160, 100, { solid: true });
      testStage().append(cv2d);
      const baseActive2d = window.__gfx?.active?.() ?? 0;
      const wrongBefore = window.__gfx?.draws?.wrong ?? 0;
      let ink2d = 0;
      try {
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        cv2d.width = Math.round(160 * dpr);
        cv2d.height = Math.round(100 * dpr);
        const c2 = cv2d.getContext('2d');
        await nextPaint(cv2d);
        c2.reset();
        c2.scale(dpr, dpr);
        c2.save();
        c2.clip(buildSuperellipsePath(0, 0, 160, 100, 4.8));
        c2.drawElementImage(tile2d, 0, 0, tile2d.offsetWidth, tile2d.offsetHeight);
        c2.restore();

        const copy = document.createElement('canvas');
        copy.width = 80;
        copy.height = 50;
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(cv2d, 0, 0, 80, 50);
        ink2d = inkFraction(cc);
      } finally {
        await retireFixture(null, cv2d, cv2d, baseActive2d);
      }
      const wrongDelta = (window.__gfx?.draws?.wrong ?? 0) - wrongBefore;
      const ms = Math.round(performance.now() - t0);
      const glSummary = glSupported ? `${glOk} (texW=${texAfterW})` : 'skipped';
      return need(
        glOk && ink2d > 0.7 && wrongDelta === 0,
        `glRestore=${glSummary}, 2dInk=${(ink2d * 100).toFixed(1)}%, wrongDraws=${wrongDelta}, snapsOpen=${window.__gfx?.snapshots?.open ?? 0}, t=${ms}ms`
      );
    },
  },
  stillDrawn(() => [
    {
      name: 'squircle dock canvas',
      note: 'plain HTML',
      ink: async () => {
        if (state.mode === 'plain') return null;
        const mp = (canvas.width * canvas.height) / 1e6;
        if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !tiles.some((t) => t.uploaded)) return 0;
          drawWebGLScene(null, false);
        } else if (state.mode === '2d') {
          draw2DScene(false);
        }
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = Math.max(1, Math.round((160 * canvas.height) / Math.max(1, canvas.width)));
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => enterPlainFallback('Squircle canvas drew blank after live checks.'),
    },
  ]),
]);
