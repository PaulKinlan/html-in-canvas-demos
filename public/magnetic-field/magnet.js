import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const QUAD_PAD = 28;
export const DEFAULT_RADIUS = 120;
export const DEFAULT_ATTRACTION = 1.0;

export const TOOLS = [
  { id: 'select', label: 'Select', hex: '#38bdf8', rgb: [0.220, 0.741, 0.973] },
  { id: 'brush',  label: 'Brush',  hex: '#ff7a4d', rgb: [1.000, 0.478, 0.302] },
  { id: 'slice',  label: 'Slice',  hex: '#34d399', rgb: [0.204, 0.827, 0.600] },
  { id: 'magnet', label: 'Magnet', hex: '#a78bfa', rgb: [0.655, 0.545, 0.980] },
  { id: 'lock',   label: 'Lock',   hex: '#f0c060', rgb: [0.941, 0.753, 0.376] },
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function computeDockLayout(cw, ch, tileW, tileH) {
  const count = TOOLS.length;
  const sidePad = cw < 440 ? 12 : 24;
  const maxGap = cw < 440 ? 12 : 18;
  const rawGap = Math.floor((cw - count * tileW - sidePad * 2) / (count - 1));
  const gap = clamp(rawGap, 6, maxGap);
  const totalW = count * tileW + (count - 1) * gap;
  const startX = Math.round((cw - totalW) * 0.5);
  const centerY = Math.round(ch * 0.58);
  const restY = Math.round(centerY - tileH * 0.5);

  const slots = [];
  for (let i = 0; i < count; i++) {
    const restX = startX + i * (tileW + gap);
    slots.push({
      restX,
      restY,
      cx: restX + tileW * 0.5,
      cy: restY + tileH * 0.5,
    });
  }
  return slots;
}

// #region mf-spring
function stepSpring1D(cur, vel, target, dt, stiffness, damping) {
  const subStep = 1 / 120;
  let x = cur;
  let v = vel;
  for (let rem = dt; rem > 1e-6; rem -= subStep) {
    const h = Math.min(rem, subStep);
    const acc = -stiffness * (x - target) - damping * v;
    v += acc * h;
    x += v * h;
  }
  return [x, v];
}

export function createMagneticField({
  count = TOOLS.length,
  pullRadius = DEFAULT_RADIUS,
  attraction = DEFAULT_ATTRACTION,
  isReduced = () => false,
} = {}) {
  const s = {
    pullRadius,
    attraction,
    pointerX: 0,
    pointerY: 0,
    pointerActive: false,
    pointerStrength: 0,
    lastTMs: null,
    bounds: { minDx: -46, maxDx: 46, minDy: -64, maxDy: 42 },
    tiles: Array.from({ length: count }, (_, idx) => ({
      idx,
      restX: 0,
      restY: 0,
      cx: 0,
      cy: 0,
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      targetDx: 0,
      targetDy: 0,
      stretch: 0,
      stretchVel: 0,
      targetStretch: 0,
      dirX: 0,
      dirY: -1,
      engaged: false,
      detached: false,
      snapGlow: 0,
    })),
  };

  function setLayout(slots, cw = 640, ch = 340, tileW = 64, tileH = 76) {
    for (let i = 0; i < s.tiles.length && i < slots.length; i++) {
      const t = s.tiles[i];
      t.restX = slots[i].restX;
      t.restY = slots[i].restY;
      t.cx = slots[i].cx;
      t.cy = slots[i].cy;
    }
    s.bounds = { cw, ch, tileW, tileH };
    if (s.pointerActive) evaluateTargets(false);
  }

  function setParams({ pullRadius: r, attraction: a } = {}) {
    if (Number.isFinite(r)) s.pullRadius = clamp(r, 40, 220);
    if (Number.isFinite(a)) s.attraction = clamp(a, 0.2, 1.6);
    if (s.pointerActive) evaluateTargets(true);
  }

  function evaluateTargets(allowSnapImpulse = true) {
    const rad = Math.max(20, s.pullRadius);
    const reach = Math.min(rad * 0.34, 38) * s.attraction;

    for (let i = 0; i < s.tiles.length; i++) {
      const t = s.tiles[i];
      if (!s.pointerActive) {
        if (t.engaged && allowSnapImpulse && !isReduced()) {
          t.snapGlow = Math.max(t.snapGlow, 0.9);
        }
        t.engaged = false;
        t.detached = false;
        t.targetDx = 0;
        t.targetDy = 0;
        t.targetStretch = 0;
        continue;
      }

      const vx = s.pointerX - t.cx;
      const vy = s.pointerY - t.cy;
      const dist = Math.hypot(vx, vy);

      if (t.engaged) {
        if (dist > rad) {
          t.engaged = false;
          t.detached = true;
          if (allowSnapImpulse && !isReduced()) t.snapGlow = 1.0;
        }
      } else if (t.detached) {
        if (dist < rad * 0.85) {
          t.detached = false;
          t.engaged = true;
        } else if (dist > rad * 1.15) {
          t.detached = false;
        }
      } else if (dist <= rad * 0.98) {
        t.engaged = true;
      }

      if (t.engaged) {
        const u = clamp(dist / rad, 0, 1);
        const dirX = dist > 0.5 ? vx / dist : 0;
        const dirY = dist > 0.5 ? vy / dist : -1;
        const profile = Math.sin(u * Math.PI * 0.52) * (0.45 + 0.55 * clamp(u / 0.55, 0, 1));
        let tx = dirX * reach * profile;
        let ty = dirY * reach * profile;
        if (s.bounds?.cw && s.bounds?.ch) {
          const minX = 8 - t.restX;
          const maxX = Math.max(minX, s.bounds.cw - s.bounds.tileW - 8 - t.restX);
          const minY = 48 - t.restY;
          const maxY = Math.max(minY, s.bounds.ch - s.bounds.tileH - 32 - t.restY);
          tx = clamp(tx, minX, maxX);
          ty = clamp(ty, minY, maxY);
        }
        t.targetDx = tx;
        t.targetDy = ty;
        t.targetStretch = clamp(profile * (0.65 + 0.35 * s.attraction), 0, 1.0);
        if (dist > 1.5) {
          t.dirX = dirX;
          t.dirY = dirY;
        }
      } else {
        t.targetDx = 0;
        t.targetDy = 0;
        t.targetStretch = 0;
      }
    }

    // Soft sibling separation keeps neighboring dock tiles from stacking over one another
    const tw = s.bounds?.tileW || 58;
    const th = s.bounds?.tileH || 74;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < s.tiles.length - 1; i++) {
        const a = s.tiles[i];
        const b = s.tiles[i + 1];
        if (!a.engaged && !b.engaged) continue;
        const ay = a.restY + a.targetDy;
        const by = b.restY + b.targetDy;
        if (Math.abs(ay - by) >= th * 0.78) continue;
        const minSep = Math.min(tw + 2, b.restX - a.restX);
        const ax = a.restX + a.targetDx;
        const bx = b.restX + b.targetDx;
        const overlap = minSep - (bx - ax);
        if (overlap > 0) {
          const push = overlap * 0.5;
          if (a.engaged) a.targetDx -= b.engaged ? push : overlap;
          if (b.engaged) b.targetDx += a.engaged ? push : overlap;
        }
      }
    }
    if (s.bounds?.cw) {
      for (let i = 0; i < s.tiles.length; i++) {
        const t = s.tiles[i];
        const minX = 8 - t.restX;
        const maxX = Math.max(minX, s.bounds.cw - tw - 8 - t.restX);
        t.targetDx = clamp(t.targetDx, minX, maxX);
      }
    }
  }

  function setPointer(px, py, { active = true, tMs = null } = {}) {
    s.pointerX = px;
    s.pointerY = py;
    s.pointerActive = active;
    if (Number.isFinite(tMs) && s.lastTMs == null) s.lastTMs = tMs;
    evaluateTargets(true);
    if (isReduced()) snapAll();
  }

  function releasePointer({ tMs = null, snapImpulse = true } = {}) {
    s.pointerActive = false;
    if (Number.isFinite(tMs) && s.lastTMs == null) s.lastTMs = tMs;
    evaluateTargets(snapImpulse);
    if (isReduced()) snapAll();
  }

  function snapAll() {
    s.pointerStrength = s.pointerActive ? 1 : 0;
    for (let i = 0; i < s.tiles.length; i++) {
      const t = s.tiles[i];
      t.dx = t.targetDx;
      t.dy = t.targetDy;
      t.vx = 0;
      t.vy = 0;
      t.stretch = t.targetStretch;
      t.stretchVel = 0;
      t.snapGlow = 0;
    }
  }

  function stepAt(tMs) {
    const dt = s.lastTMs == null
      ? 1 / 60
      : clamp((tMs - s.lastTMs) / 1000, 0.0001, 0.05);
    s.lastTMs = tMs;

    if (isReduced()) {
      snapAll();
      return false;
    }

    let moving = false;
    const pTarget = s.pointerActive ? 1 : 0;
    if (Math.abs(s.pointerStrength - pTarget) > 0.005) {
      const rate = s.pointerActive ? 14 : 8;
      s.pointerStrength += (pTarget - s.pointerStrength) * Math.min(1, dt * rate);
      if (Math.abs(s.pointerStrength - pTarget) < 0.005) s.pointerStrength = pTarget;
      else moving = true;
    } else {
      s.pointerStrength = pTarget;
    }

    const drive = (cur, vel, target, stiffness, damping, epsX, epsV) => {
      if (Math.abs(cur - target) > epsX || Math.abs(vel) > epsV) {
        const [nx, nv] = stepSpring1D(cur, vel, target, dt, stiffness, damping);
        if (Math.abs(nx - target) < epsX && Math.abs(nv) < epsV) {
          return [target, 0, false];
        }
        return [nx, nv, true];
      }
      return [target, 0, false];
    };

    for (let i = 0; i < s.tiles.length; i++) {
      const t = s.tiles[i];
      // Engaged tracking uses smooth damping; detached recoil snaps back underdamped.
      const k = t.engaged ? 320 : 380;
      const c = t.engaged ? 24 : 15;

      let m;
      [t.dx, t.vx, m] = drive(t.dx, t.vx, t.targetDx, k, c, 0.03, 0.12);
      if (m) moving = true;
      [t.dy, t.vy, m] = drive(t.dy, t.vy, t.targetDy, k, c, 0.03, 0.12);
      if (m) moving = true;
      [t.stretch, t.stretchVel, m] = drive(t.stretch, t.stretchVel, t.targetStretch, 340, 22, 0.003, 0.02);
      if (m) moving = true;

      if (t.snapGlow > 0.005) {
        t.snapGlow = Math.max(0, t.snapGlow - dt * 3.1);
        if (t.snapGlow > 0.005) moving = true;
        else t.snapGlow = 0;
      }
    }

    return moving;
  }

  return { s, setLayout, setParams, setPointer, releasePointer, stepAt, snapAll };
}
// #endregion mf-spring

// #region mf-shader
export const MAGNET_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform vec2 uCanvasSize;
uniform vec2 uPointer;
uniform float uPointerActive;
uniform float uPullRadius;
uniform float uReduced;
uniform vec2 uTileSize;
uniform vec2 uRestCenters[5];
uniform vec2 uCurrCenters[5];
uniform float uEngaged[5];
uniform vec3 uAccent;

uniform vec2 uQuadSize;
uniform vec2 uElemSize;
uniform vec2 uPullDir;
uniform float uStretch;
uniform float uSnapGlow;
uniform vec3 uTileAccent;
uniform float uSelected;

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - max(b - vec2(r), vec2(0.0));
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

vec4 sampleTile(vec2 uv) {
  vec2 px = 1.0 / max(uElemSize, vec2(1.0));
  float mask = smoothstep(0.0, px.x, uv.x)
    * (1.0 - smoothstep(1.0 - px.x, 1.0, uv.x))
    * smoothstep(0.0, px.y, uv.y)
    * (1.0 - smoothstep(1.0 - px.y, 1.0, uv.y));
  if (mask <= 0.001) return vec4(0.0);
  return texture(uTex, clamp(uv, 0.001, 0.999)) * mask;
}

void main() {
  if (uPass == 0) {
    vec4 base = texture(uTex, vUv);
    vec2 p = vUv * max(uCanvasSize, vec2(1.0));
    vec3 col = base.rgb;

    // Draw subtle resting cradle outlines under each dock button
    for (int i = 0; i < 5; i++) {
      float sd = sdRoundBox(p - uRestCenters[i], uTileSize * 0.5, 13.0);
      float pullDist = length(uCurrCenters[i] - uRestCenters[i]);
      float away = clamp(pullDist / 16.0, 0.0, 1.0);
      float inner = 1.0 - smoothstep(-1.5, 1.0, sd);
      float rim = exp(-pow(sd / 1.25, 2.0));
      col = mix(col, col * 0.54, inner * 0.48);
      col += mix(vec3(0.24, 0.33, 0.50), uAccent, away * 0.85) * (rim * (0.24 + 0.42 * away));
    }

    // Pulsing concentric field contours + curved magnetic flux lines
    if (uPointerActive > 0.005) {
      vec2 dp = p - uPointer;
      float r = length(dp);
      float rWarped = r;
      for (int i = 0; i < 5; i++) {
        if (uEngaged[i] > 0.01) {
          float db = length(p - uCurrCenters[i]);
          rWarped -= uEngaged[i] * 15.0 * exp(-db / 50.0);
        }
      }

      float tShift = uReduced > 0.5 ? 0.0 : uTime * 2.4;
      float wave = pow(max(0.0, cos(rWarped * 0.175 - tShift)), 10.0);
      float falloff = 1.0 - smoothstep(uPullRadius * 0.72, uPullRadius * 1.38, r);
      col += uAccent * (0.28 * wave * falloff * uPointerActive);

      // Escape threshold dashed ring at r = uPullRadius
      float ang = atan(dp.y, dp.x);
      float dashShift = uReduced > 0.5 ? 0.0 : uTime * 0.9;
      float dash = smoothstep(-0.15, 0.25, sin(ang * 24.0 + dashShift));
      float escRing = exp(-pow((r - uPullRadius) / 1.5, 2.0));
      col += mix(uAccent, vec3(1.0, 0.62, 0.42), 0.38) * (0.44 * escRing * mix(0.42, 1.0, dash) * uPointerActive);

      // Curved flux arcs connecting pointer pole to engaged buttons
      for (int i = 0; i < 5; i++) {
        float eng = uEngaged[i];
        if (eng <= 0.01) continue;
        vec2 a = uPointer;
        vec2 b = uCurrCenters[i];
        vec2 ab = b - a;
        float abLen = max(length(ab), 1.0);
        vec2 dir = ab / abLen;
        vec2 perp = vec2(-dir.y, dir.x);
        float t = dot(p - a, dir) / abLen;
        float s = dot(p - a, perp);
        if (t > -0.06 && t < 1.06) {
          float bow = sin(clamp(t, 0.0, 1.0) * 3.14159265);
          float spread = clamp(abLen * 0.30, 10.0, 32.0);
          float lineGlow =
            exp(-pow(s / 1.9, 2.0)) +
            0.78 * exp(-pow((s - spread * bow) / 1.75, 2.0)) +
            0.78 * exp(-pow((s + spread * bow) / 1.75, 2.0));
          float pulse = uReduced > 0.5 ? 0.85 : (0.64 + 0.36 * sin(t * 15.0 - uTime * 6.5));
          float ends = smoothstep(-0.06, 0.08, t) * (1.0 - smoothstep(0.92, 1.06, t));
          col += mix(uAccent, vec3(1.0), 0.25) * (lineGlow * 0.54 * pulse * ends * eng * uPointerActive);
        }
      }

      // Pointer magnetic pole core glow
      float poleGlow = exp(-pow(r / 16.0, 2.0)) * 0.48 + exp(-pow(r / 4.2, 2.0)) * 0.72;
      col += mix(uAccent, vec3(1.0), 0.45) * (poleGlow * uPointerActive);
    }

    outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    return;
  }

  // Pass 1: individual dock button with directional liquid-stretch elongation and edge rim glow
  vec2 local = (vUv - 0.5) * uQuadSize;
  vec2 dir = length(uPullDir) > 0.1 ? normalize(uPullDir) : vec2(0.0, -1.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float along = dot(local, dir);
  float across = dot(local, perp);

  float halfSpan = max(max(uElemSize.x, uElemSize.y) * 0.5, 1.0);
  float frontBias = smoothstep(-halfSpan * 0.55, halfSpan * 0.85, along);
  float stretchPx = uStretch * 15.0 * pow(frontBias, 1.28);
  float pinch = 1.0 + uStretch * 0.16 * frontBias * (0.45 + 0.55 * smoothstep(0.0, halfSpan * 0.65, abs(across)));

  vec2 warpedLocal = local - dir * stretchPx;
  float wAlong = dot(warpedLocal, dir);
  float wAcross = dot(warpedLocal, perp) * pinch;
  vec2 srcLocal = dir * wAlong + perp * wAcross;
  vec2 texUv = srcLocal / max(uElemSize, vec2(1.0)) + 0.5;

  vec4 tile = sampleTile(texUv);
  vec2 pxStep = 1.65 / max(uElemSize, vec2(1.0));
  float aN = sampleTile(texUv + vec2(0.0, -pxStep.y)).a;
  float aS = sampleTile(texUv + vec2(0.0,  pxStep.y)).a;
  float aE = sampleTile(texUv + vec2( pxStep.x, 0.0)).a;
  float aW = sampleTile(texUv + vec2(-pxStep.x, 0.0)).a;

  float edgeBand = clamp(max(max(aN, aS), max(aE, aW)) - tile.a, 0.0, 1.0);
  float innerRim = tile.a * clamp(1.0 - min(min(aN, aS), min(aE, aW)), 0.0, 1.0);

  float glowStrength = clamp(uStretch * 0.85 + uSnapGlow * 0.95 + uSelected * 0.18, 0.0, 1.15);
  vec3 rimCol = mix(uTileAccent, vec3(1.0), 0.36);
  float outerGlowA = edgeBand * 0.70 * glowStrength * (0.38 + 0.62 * frontBias + uSnapGlow * 0.38);

  vec3 rgb = tile.rgb + rimCol * (innerRim * tile.a * 0.42 * glowStrength + outerGlowA);
  float a = max(tile.a, outerGlowA);
  outColor = vec4(clamp(rgb, 0.0, 1.0), clamp(a, 0.0, 1.0));
}`;
// #endregion mf-shader

// ---------------------------------------------------------------- DOM refs
const stageBox = document.getElementById('mf-stage');
const viewportEl = document.getElementById('mf-viewport');
const canvas = document.getElementById('mf-canvas');
const backdropEl = document.getElementById('mf-backdrop');
const modePillEl = document.getElementById('mf-mode-pill');
const summaryPillEl = document.getElementById('mf-summary-pill');
const footHintEl = document.getElementById('mf-foot-hint');
const footSnapEl = document.getElementById('mf-foot-snap');
const tileEls = TOOLS.map((_, i) => document.getElementById(`mf-item-${i}`));
const countEls = TOOLS.map((_, i) => document.getElementById(`mf-count-${i}`));
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const noticeEl = document.getElementById('stage-notice');
const checksBody = document.getElementById('checks-body');

const btnPreset = document.getElementById('btn-preset');
const btnOrbit = document.getElementById('btn-orbit');
const btnSnap = document.getElementById('btn-snap');
const reducedCheck = document.getElementById('ctl-reduced');
const radiusInput = document.getElementById('ctl-radius');
const radiusOut = document.getElementById('out-radius');
const attractInput = document.getElementById('ctl-attract');
const attractOut = document.getElementById('out-attract');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

const ctrl = createMagneticField({
  count: TOOLS.length,
  pullRadius: Number(radiusInput.value),
  attraction: Number(attractInput.value),
  isReduced,
});
const field = ctrl.s;

const appState = {
  selectedIdx: 0,
  clicks: TOOLS.map(() => 0),
  totalClicks: 0,
  presetStep: 0,
  orbitActive: false,
  orbitStartMs: 0,
};

let stage = null;
let ctx2d = null;
let backend = 'none';
let hasPainted = false;
let bgDirty = true;
const tileDirty = TOOLS.map(() => true);
const lastTileClass = TOOLS.map(() => false);
let rafId = 0;
let isVisible = true;
let lostTimer = 0;
let dragging = false;
let dragId = -1;
let lastGeoSig = '';
let plainDockEl = null;
const unitCache = { bgKey: '', bgUnit: 1, tileKey: '', tileUnit: 1 };

const restUniform = new Float32Array(TOOLS.length * 2);
const currUniform = new Float32Array(TOOLS.length * 2);
const engUniform = new Float32Array(TOOLS.length);

function getCanvasSize() {
  const cw = Math.max(200, canvas.clientWidth || viewportEl.clientWidth || 360);
  const ch = Math.max(200, canvas.clientHeight || viewportEl.clientHeight || 304);
  return { cw, ch };
}

function getTileSize() {
  const tw = tileEls[0]?.offsetWidth || (window.innerWidth <= 620 ? 58 : 72);
  const th = tileEls[0]?.offsetHeight || (window.innerWidth <= 620 ? 74 : 82);
  return { tw, th };
}

function syncLayout() {
  const { cw, ch } = getCanvasSize();
  const { tw, th } = getTileSize();
  const slots = computeDockLayout(cw, ch, tw, th);
  ctrl.setLayout(slots, cw, ch, tw, th);
  return { cw, ch, tw, th };
}

function syncReadout() {
  const tool = TOOLS[appState.selectedIdx];
  summaryPillEl.textContent = `${tool.label} · ${appState.totalClicks} ${appState.totalClicks === 1 ? 'click' : 'clicks'}`;
  footSnapEl.textContent = `Escape: ${Math.round(field.pullRadius)} px`;
  for (let i = 0; i < tileEls.length; i++) {
    const sel = i === appState.selectedIdx;
    tileEls[i].classList.toggle('is-selected', sel);
    tileEls[i].setAttribute('aria-pressed', String(sel));
    countEls[i].textContent = String(appState.clicks[i]);
  }
  bgDirty = true;
  canvas.requestPaint?.();
}

function syncTileDomClasses() {
  let changed = false;
  for (let i = 0; i < tileEls.length; i++) {
    const eng = field.tiles[i].engaged;
    if (eng !== lastTileClass[i]) {
      lastTileClass[i] = eng;
      tileEls[i].classList.toggle('is-engaged', eng);
      tileDirty[i] = true;
      changed = true;
    }
  }
  if (changed) canvas.requestPaint?.();
}

function showNotice(text) {
  if (!text) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  } else {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  }
}

function switchToPlain(reason) {
  backend = 'plain';
  appState.orbitActive = false;
  btnOrbit.setAttribute('aria-pressed', 'false');
  cancelAnimationFrame(rafId);
  rafId = 0;
  stageBox.classList.add('is-plain');
  backdropEl.inert = false;
  if (!plainDockEl) {
    plainDockEl = document.createElement('div');
    plainDockEl.className = 'plain-dock';
  }
  if (backdropEl.parentElement !== plainHost) plainHost.append(backdropEl);
  if (plainDockEl.parentElement !== plainHost) plainHost.append(plainDockEl);
  for (const btn of tileEls) {
    btn.inert = false;
    if (btn.parentElement !== plainDockEl) plainDockEl.append(btn);
  }
  showNotice(reason);
  updateHud();
}

function restoreFromPlain() {
  stageBox.classList.remove('is-plain');
  if (backdropEl.parentElement !== canvas) canvas.append(backdropEl);
  for (const btn of tileEls) {
    if (btn.parentElement !== canvas) canvas.append(btn);
  }
  unitCache.bgKey = '';
  unitCache.tileKey = '';
  lastGeoSig = '';
  bgDirty = true;
  for (let i = 0; i < tileDirty.length; i++) tileDirty[i] = true;
  showNotice('');
}

function tileDrawOrder() {
  return field.tiles
    .map((t, i) => ({ i, mag: Math.hypot(t.dx, t.dy) + (t.engaged ? 0.5 : 0) }))
    .sort((a, b) => a.mag - b.mag)
    .map((e) => e.i);
}

// #region geometry-sync
function syncGeometry(force = false) {
  if (backend === 'plain' || !hasPainted || typeof canvas.updateElementGeometry !== 'function') return;
  const { cw, ch, tw, th } = syncLayout();
  const bw = backdropEl.offsetWidth || cw;
  if (!cw || !ch || !bw || !tw) return;

  const order = tileDrawOrder();
  const parts = [`${backend}:${canvas.width}x${canvas.height}:${cw}x${ch}:${tw}x${th}:${order.join('')}`];
  for (let i = 0; i < field.tiles.length; i++) {
    const t = field.tiles[i];
    parts.push(`${(t.restX + t.dx).toFixed(1)},${(t.restY + t.dy).toFixed(1)}`);
  }
  const sig = parts.join('|');
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  const bgKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${bw}`;
  if (unitCache.bgKey !== bgKey) {
    unitCache.bgUnit = geometryUnit(canvas, backdropEl, bw);
    unitCache.bgKey = bgKey;
  }
  const tileKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${tw}`;
  if (unitCache.tileKey !== tileKey) {
    unitCache.tileUnit = geometryUnit(canvas, tileEls[0], tw);
    unitCache.tileKey = tileKey;
  }

  const uBg = unitCache.bgUnit || 1;
  const uTile = unitCache.tileUnit || 1;

  canvas.updateElementGeometry(backdropEl, {
    canvasTransform: new DOMMatrix().scale(uBg, uBg, 1),
  });
  backdropEl.dataset.hitTick = backdropEl.dataset.hitTick === '1' ? '0' : '1';

  for (const i of order) {
    const btn = tileEls[i];
    const t = field.tiles[i];
    const mat = new DOMMatrix().scale(uTile, uTile, 1).translate(t.restX + t.dx, t.restY + t.dy);
    canvas.updateElementGeometry(btn, { canvasTransform: mat });
    btn.dataset.hitTick = btn.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion geometry-sync

// #region fallback-2d
function draw2DFallback(cw, ch, tw, th, forceGeo = false) {
  if (!ctx2d || !hasPainted) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.drawElementImage(backdropEl, 0, 0, cw, ch);

  const accent = TOOLS[appState.selectedIdx].hex;
  ctx2d.save();
  for (let i = 0; i < field.tiles.length; i++) {
    const t = field.tiles[i];
    ctx2d.strokeStyle = t.engaged ? accent : 'rgb(88 108 148 / 0.35)';
    ctx2d.lineWidth = 1.25;
    ctx2d.beginPath();
    ctx2d.roundRect(t.restX, t.restY, tw, th, 13);
    ctx2d.stroke();
  }

  if (field.pointerStrength > 0.01) {
    ctx2d.globalAlpha = field.pointerStrength;
    ctx2d.strokeStyle = accent;
    for (let r = 30; r <= field.pullRadius; r += 30) {
      ctx2d.lineWidth = Math.abs(r - field.pullRadius) < 5 ? 1.5 : 1;
      ctx2d.beginPath();
      ctx2d.arc(field.pointerX, field.pointerY, r, 0, Math.PI * 2);
      ctx2d.stroke();
    }
    for (let i = 0; i < field.tiles.length; i++) {
      const t = field.tiles[i];
      if (!t.engaged) continue;
      ctx2d.lineWidth = 2;
      ctx2d.beginPath();
      ctx2d.moveTo(field.pointerX, field.pointerY);
      ctx2d.lineTo(t.cx + t.dx, t.cy + t.dy);
      ctx2d.stroke();
    }
  }
  ctx2d.restore();

  for (const i of tileDrawOrder()) {
    const t = field.tiles[i];
    ctx2d.drawElementImage(tileEls[i], t.restX + t.dx, t.restY + t.dy, tw, th);
  }

  syncGeometry(forceGeo);
}
// #endregion fallback-2d

function updateHud() {
  const route = backend === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : backend === '2d'
      ? '2D drawElementImage() fallback'
      : 'Plain HTML fallback';
  const mp = backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  let engagedCount = 0;
  let maxDisp = 0;
  for (let i = 0; i < field.tiles.length; i++) {
    const t = field.tiles[i];
    if (t.engaged) engagedCount++;
    const d = Math.hypot(t.dx, t.dy);
    if (d > maxDisp) maxDisp = d;
  }
  const probeText = appState.orbitActive
    ? 'auto orbit'
    : appState.presetStep > 0
      ? `preset #${appState.presetStep}`
      : field.pointerActive
        ? `(${Math.round(field.pointerX)}, ${Math.round(field.pointerY)})`
        : 'idle';
  hudEl.textContent =
    `Route: ${route} · ${mp} MP · Probe: ${probeText} · Engaged: ${engagedCount}/5 · ` +
    `Peak pull: ${maxDisp.toFixed(1)} px · Active: ${TOOLS[appState.selectedIdx].label}`;
}

function drawFrame(forceGeo = false) {
  const { cw, ch, tw, th } = syncLayout();
  if (!cw || !ch || !hasPainted) return;

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      if (!stage.begin([0, 0, 0, 0])) return;
      if (bgDirty || !stage.has(backdropEl)) {
        stage.upload(backdropEl);
        bgDirty = false;
      }
      for (let i = 0; i < tileEls.length; i++) {
        if (tileDirty[i] || !stage.has(tileEls[i])) {
          stage.upload(tileEls[i]);
          tileDirty[i] = false;
        }
      }

      for (let i = 0; i < field.tiles.length; i++) {
        const t = field.tiles[i];
        restUniform[i * 2] = t.cx;
        restUniform[i * 2 + 1] = t.cy;
        currUniform[i * 2] = t.cx + t.dx;
        currUniform[i * 2 + 1] = t.cy + t.dy;
        engUniform[i] = t.engaged ? Math.max(0.3, t.stretch) : 0.0;
      }
      const accentRgb = TOOLS[appState.selectedIdx].rgb;

      stage.quad(backdropEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        gl.uniform1i(loc('uPass'), 0);
        gl.uniform2f(loc('uCanvasSize'), cw, ch);
        gl.uniform2f(loc('uPointer'), field.pointerX, field.pointerY);
        gl.uniform1f(loc('uPointerActive'), field.pointerStrength);
        gl.uniform1f(loc('uPullRadius'), field.pullRadius);
        gl.uniform1f(loc('uReduced'), isReduced() ? 1.0 : 0.0);
        gl.uniform2f(loc('uTileSize'), tw, th);
        const uRest = loc('uRestCenters[0]');
        if (uRest) gl.uniform2fv(uRest, restUniform);
        const uCurr = loc('uCurrCenters[0]');
        if (uCurr) gl.uniform2fv(uCurr, currUniform);
        const uEng = loc('uEngaged[0]');
        if (uEng) gl.uniform1fv(uEng, engUniform);
        gl.uniform3f(loc('uAccent'), accentRgb[0], accentRgb[1], accentRgb[2]);
      });

      const qw = tw + QUAD_PAD * 2;
      const qh = th + QUAD_PAD * 2;
      for (const i of tileDrawOrder()) {
        const t = field.tiles[i];
        const tileRgb = TOOLS[i].rgb;
        const drawX = t.restX + t.dx - QUAD_PAD;
        const drawY = t.restY + t.dy - QUAD_PAD;
        stage.quad(tileEls[i], ElementGL.rect(canvas, drawX, drawY, qw, qh), (gl, loc) => {
          gl.uniform1i(loc('uPass'), 1);
          gl.uniform2f(loc('uQuadSize'), qw, qh);
          gl.uniform2f(loc('uElemSize'), tw, th);
          gl.uniform2f(loc('uPullDir'), t.dirX, t.dirY);
          gl.uniform1f(loc('uStretch'), t.stretch);
          gl.uniform1f(loc('uSnapGlow'), t.snapGlow);
          gl.uniform3f(loc('uTileAccent'), tileRgb[0], tileRgb[1], tileRgb[2]);
          gl.uniform1f(loc('uSelected'), i === appState.selectedIdx ? 1.0 : 0.0);
        });
      }

      syncGeometry(forceGeo);
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        bgDirty = true;
        for (let i = 0; i < tileDirty.length; i++) tileDirty[i] = true;
        canvas.requestPaint?.();
      } else {
        throw err;
      }
    }
  } else if (backend === '2d') {
    draw2DFallback(cw, ch, tw, th, forceGeo);
  }
  updateHud();
}

function tick(now) {
  rafId = 0;
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;

  if (appState.orbitActive && !isReduced()) {
    const { cw, ch } = getCanvasSize();
    const sec = (now - appState.orbitStartMs) / 1000;
    const ox = cw * 0.5 + Math.cos(sec * 1.15) * (cw * 0.36);
    const oy = ch * 0.52 + Math.sin(sec * 2.15) * (ch * 0.24);
    ctrl.setPointer(ox, oy, { active: true, tMs: now });
  }

  const moving = ctrl.stepAt(now);
  syncTileDomClasses();
  drawFrame();

  const pulsing = !isReduced() && field.pointerActive && field.pointerStrength > 0.05;
  if (moving || dragging || appState.orbitActive || pulsing) {
    rafId = requestAnimationFrame(tick);
  } else {
    field.lastTMs = null;
  }
}

function scheduleLoop() {
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  if (!rafId) {
    rafId = requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------- Event wiring
viewportEl.addEventListener('selectstart', (e) => {
  if (e.target instanceof Element && e.target.closest('input, textarea, [contenteditable]')) return;
  e.preventDefault();
});

modePillEl.addEventListener('input', () => {
  bgDirty = true;
  canvas.requestPaint?.();
});

for (let i = 0; i < tileEls.length; i++) {
  const btn = tileEls[i];
  btn.addEventListener('click', () => {
    appState.selectedIdx = i;
    appState.clicks[i]++;
    appState.totalClicks++;
    field.tiles[i].snapGlow = isReduced() ? 0 : 0.85;
    syncReadout();
    tileDirty[i] = true;
    canvas.requestPaint?.();
    scheduleLoop();
  });

  btn.addEventListener('focus', () => {
    if (backend === 'plain') return;
    const t = field.tiles[i];
    if (!field.pointerActive && !appState.orbitActive) {
      ctrl.setPointer(t.cx, t.cy - 34, { active: true, tMs: performance.now() });
      syncTileDomClasses();
      scheduleLoop();
    }
  });
}

function localCanvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('pointerdown', (e) => {
  if (backend === 'plain') return;
  if (e.target instanceof Element && (e.target.closest('.mf-tile') || e.target.closest('input'))) return;
  appState.orbitActive = false;
  appState.presetStep = 0;
  btnOrbit.setAttribute('aria-pressed', 'false');
  btnPreset.setAttribute('aria-pressed', 'false');

  const [px, py] = localCanvasPoint(e);
  dragging = true;
  dragId = e.pointerId;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  ctrl.setPointer(px, py, { active: true, tMs: performance.now() });
  syncTileDomClasses();
  scheduleLoop();
});

canvas.addEventListener('pointermove', (e) => {
  if (backend === 'plain') return;
  const [px, py] = localCanvasPoint(e);
  if (dragging && e.pointerId === dragId) {
    ctrl.setPointer(px, py, { active: true, tMs: performance.now() });
    syncTileDomClasses();
    scheduleLoop();
    return;
  }
  if (!dragging && e.pointerType === 'mouse' && !appState.orbitActive) {
    appState.presetStep = 0;
    btnPreset.setAttribute('aria-pressed', 'false');
    ctrl.setPointer(px, py, { active: true, tMs: performance.now() });
    syncTileDomClasses();
    scheduleLoop();
  }
});

function releaseDrag(e) {
  if (!dragging || e.pointerId !== dragId) return;
  dragging = false;
  dragId = -1;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  ctrl.releasePointer({ tMs: performance.now(), snapImpulse: true });
  syncTileDomClasses();
  scheduleLoop();
}

canvas.addEventListener('pointerup', releaseDrag);
canvas.addEventListener('pointercancel', releaseDrag);

canvas.addEventListener('pointerleave', (e) => {
  if (!dragging && e.pointerType === 'mouse' && !appState.orbitActive && appState.presetStep === 0) {
    ctrl.releasePointer({ tMs: performance.now(), snapImpulse: true });
    syncTileDomClasses();
    scheduleLoop();
  }
});

btnPreset.addEventListener('click', () => {
  appState.orbitActive = false;
  btnOrbit.setAttribute('aria-pressed', 'false');
  appState.presetStep = (appState.presetStep + 1) % 4;
  const { cw, ch } = syncLayout();
  if (appState.presetStep === 0) {
    btnPreset.setAttribute('aria-pressed', 'false');
    ctrl.releasePointer({ tMs: performance.now(), snapImpulse: true });
  } else {
    btnPreset.setAttribute('aria-pressed', 'true');
    const spots = [
      [field.tiles[2].cx, field.tiles[2].cy - 70],
      [field.tiles[0].cx + 22, field.tiles[0].cy - 66],
      [field.tiles[4].cx - 22, field.tiles[4].cy - 66],
    ];
    const [px, py] = spots[appState.presetStep - 1] ?? [cw * 0.5, ch * 0.35];
    ctrl.setPointer(px, py, { active: true, tMs: performance.now() });
  }
  syncTileDomClasses();
  scheduleLoop();
});

btnOrbit.addEventListener('click', () => {
  if (isReduced()) {
    appState.orbitActive = false;
    btnOrbit.setAttribute('aria-pressed', 'false');
    updateHud();
    return;
  }
  appState.orbitActive = !appState.orbitActive;
  appState.presetStep = 0;
  btnPreset.setAttribute('aria-pressed', 'false');
  btnOrbit.setAttribute('aria-pressed', String(appState.orbitActive));
  if (appState.orbitActive) {
    appState.orbitStartMs = performance.now();
    scheduleLoop();
  } else {
    ctrl.releasePointer({ tMs: performance.now(), snapImpulse: true });
    syncTileDomClasses();
    scheduleLoop();
  }
});

btnSnap.addEventListener('click', () => {
  appState.orbitActive = false;
  appState.presetStep = 0;
  btnOrbit.setAttribute('aria-pressed', 'false');
  btnPreset.setAttribute('aria-pressed', 'false');
  ctrl.releasePointer({ tMs: performance.now(), snapImpulse: true });
  syncTileDomClasses();
  scheduleLoop();
});

radiusInput.addEventListener('input', () => {
  const val = Number(radiusInput.value);
  radiusOut.textContent = `${val} px`;
  ctrl.setParams({ pullRadius: val });
  footSnapEl.textContent = `Escape: ${val} px`;
  bgDirty = true;
  syncTileDomClasses();
  canvas.requestPaint?.();
  scheduleLoop();
});

attractInput.addEventListener('input', () => {
  const val = Number(attractInput.value);
  attractOut.textContent = `${val.toFixed(2)}×`;
  ctrl.setParams({ attraction: val });
  syncTileDomClasses();
  scheduleLoop();
});

function handleReducedChange() {
  if (isReduced()) {
    appState.orbitActive = false;
    btnOrbit.setAttribute('aria-pressed', 'false');
    ctrl.snapAll();
    syncTileDomClasses();
  }
  drawFrame(true);
}

reducedCheck.addEventListener('change', handleReducedChange);
reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  handleReducedChange();
});

// ---------------------------------------------------------------- Startup & observers
function startBackend() {
  syncLayout();
  syncReadout();

  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available in this browser, so the dock buttons are shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    hasPainted = true;
    bgDirty = true;
    for (let i = 0; i < tileDirty.length; i++) tileDirty[i] = true;
    if (!rafId && isVisible && !document.hidden) drawFrame();
  });

  const forceRoute = new URLSearchParams(location.search).get('route');

  if (glSupported && forceRoute !== '2d') {
    try {
      stage = new ElementGL(canvas, {
        fragment: MAGNET_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so the dock moved to plain HTML.');
            }
          }, 900);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          restoreFromPlain();
          backend = 'webgl';
          hasPainted = true;
          bgDirty = true;
          for (let i = 0; i < tileDirty.length; i++) tileDirty[i] = true;
          canvas.requestPaint?.();
          scheduleLoop();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      backend = 'webgl';
    } catch {
      stage = null;
    }
  }

  if (backend === 'none') {
    ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
      switchToPlain('Canvas rendering is unavailable here, so the dock is shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so the dock moved to plain HTML.');
        }
      }, 900);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      restoreFromPlain();
      backend = '2d';
      hasPainted = true;
      bgDirty = true;
      for (let i = 0; i < tileDirty.length; i++) tileDirty[i] = true;
      canvas.requestPaint?.();
      scheduleLoop();
    });
  }

  canvas.requestPaint?.();
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    const nowVisible = Boolean(entry && entry.isIntersecting);
    if (nowVisible === isVisible) return;
    isVisible = nowVisible;
    if (isVisible) {
      drawFrame();
      scheduleLoop();
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }, { threshold: 0.01 }).observe(viewportEl);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (backend === 'plain') return;
    unitCache.bgKey = '';
    unitCache.tileKey = '';
    lastGeoSig = '';
    bgDirty = true;
    for (let i = 0; i < tileDirty.length; i++) tileDirty[i] = true;
    syncLayout();
    if (hasPainted) drawFrame(true);
    else canvas.requestPaint?.();
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  } else if (isVisible && hasPainted) {
    drawFrame();
    scheduleLoop();
  }
});

startBackend();
updateHud();

// ---------------------------------------------------------------- Live checks (isolated fixtures on testStage)
const need = (ok, msg) => { if (!ok) throw new Error(msg); return msg; };
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

function makeDockFixture(w = 340, h = 240, tileW = 54, tileH = 66) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const bg = document.createElement('div');
  bg.setAttribute('drawable', '');
  bg.style.cssText = `position:relative;width:${w}px;height:${h}px;background:#0a0f1a;color:#eef2fb;padding:10px;box-sizing:border-box;font:600 12px system-ui`;
  bg.textContent = 'Dock fixture';

  const gap = 8;
  const startX = Math.round((w - (TOOLS.length * tileW + (TOOLS.length - 1) * gap)) * 0.5);
  const restY = Math.round(h * 0.58 - tileH * 0.5);
  const slots = [];

  const btns = TOOLS.map((tool, i) => {
    const restX = startX + i * (tileW + gap);
    slots.push({ restX, restY, cx: restX + tileW * 0.5, cy: restY + tileH * 0.5 });
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.idx = String(i);
    b.textContent = tool.label;
    b.setAttribute('drawable', '');
    b.style.cssText =
      `position:absolute;left:0;top:0;width:${tileW}px;height:${tileH}px;margin:0;` +
      `border-radius:12px;border:2px solid ${tool.hex};background:#1f2c46;color:#f8fafc;font:600 11px system-ui`;
    return b;
  });

  cv.append(bg, ...btns);
  return { cv, bg, btns, slots, w, h, tileW, tileH };
}

function drawFixtureStage(g, fx, fieldState) {
  const { cv, bg, btns, w, h, tileW, tileH } = fx;
  const rArr = new Float32Array(10);
  const cArr = new Float32Array(10);
  const eArr = new Float32Array(5);
  for (let i = 0; i < fieldState.tiles.length; i++) {
    const t = fieldState.tiles[i];
    rArr[i * 2] = t.cx;
    rArr[i * 2 + 1] = t.cy;
    cArr[i * 2] = t.cx + t.dx;
    cArr[i * 2 + 1] = t.cy + t.dy;
    eArr[i] = t.engaged ? Math.max(0.35, t.stretch) : 0;
  }
  g.quad(bg, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => {
    gl.uniform1i(loc('uPass'), 0);
    gl.uniform2f(loc('uCanvasSize'), w, h);
    gl.uniform2f(loc('uPointer'), fieldState.pointerX, fieldState.pointerY);
    gl.uniform1f(loc('uPointerActive'), fieldState.pointerStrength);
    gl.uniform1f(loc('uPullRadius'), fieldState.pullRadius);
    gl.uniform1f(loc('uReduced'), 1.0);
    gl.uniform2f(loc('uTileSize'), tileW, tileH);
    const uRest = loc('uRestCenters[0]');
    if (uRest) gl.uniform2fv(uRest, rArr);
    const uCurr = loc('uCurrCenters[0]');
    if (uCurr) gl.uniform2fv(uCurr, cArr);
    const uEng = loc('uEngaged[0]');
    if (uEng) gl.uniform1fv(uEng, eArr);
    gl.uniform3f(loc('uAccent'), 0.204, 0.827, 0.600);
  });

  const qw = tileW + QUAD_PAD * 2;
  const qh = tileH + QUAD_PAD * 2;
  for (let i = 0; i < btns.length; i++) {
    const t = fieldState.tiles[i];
    const rgb = TOOLS[i].rgb;
    g.quad(btns[i], ElementGL.rect(cv, t.restX + t.dx - QUAD_PAD, t.restY + t.dy - QUAD_PAD, qw, qh), (gl, loc) => {
      gl.uniform1i(loc('uPass'), 1);
      gl.uniform2f(loc('uQuadSize'), qw, qh);
      gl.uniform2f(loc('uElemSize'), tileW, tileH);
      gl.uniform2f(loc('uPullDir'), t.dirX, t.dirY);
      gl.uniform1f(loc('uStretch'), t.stretch);
      gl.uniform1f(loc('uSnapGlow'), t.snapGlow);
      gl.uniform3f(loc('uTileAccent'), rgb[0], rgb[1], rgb[2]);
      gl.uniform1f(loc('uSelected'), i === 2 ? 1.0 : 0.0);
    });
  }
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const tests = [
  {
    name: 'ElementGL uploads backdrop and five drawable buttons via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated fixture on testStage() with one backdrop and five drawable <button> tiles, sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), renders all passes and verifies non-transparent tile pixels.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const fx = makeDockFixture();
      testStage().append(fx.cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(fx.cv, { fragment: MAGNET_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(fx.cv);
        g.begin([0, 0, 0, 0]);

        const tBg = g.upload(fx.bg);
        const tBtns = fx.btns.map((b) => g.upload(b));
        const fCtrl = createMagneticField({ count: TOOLS.length });
        fCtrl.setLayout(fx.slots, fx.w, fx.h, fx.tileW, fx.tileH);
        drawFixtureStage(g, fx, fCtrl.s);

        const err = g.gl.getError();
        const samples = fx.slots.map((sl) => readCssPixel(g.gl, fx.cv, fx.w, fx.h, sl.cx, sl.cy));
        const allOpaque = samples.every((p) => p[3] > 200);
        const allTex = tBg?.w > 0 && tBtns.every((t) => t?.w > 0);
        return need(
          err === g.gl.NO_ERROR && allTex && allOpaque,
          `glErr=${err}, bg=${tBg?.w}x${tBg?.h}, tile0=${tBtns[0]?.w}x${tBtns[0]?.h}, centersAlpha=[${samples.map((p) => p[3]).join(',')}]`
        );
      } finally {
        await retireFixture(g, fx.cv, fx.cv, baseActive);
      }
    },
  },
  {
    name: 'Pointer proximity displaces pulled button pixels and illuminates Pass 0 magnetic flux vs rest',
    expect: 'pass',
    why: 'Samples readPixels() above Slice rest edge and along the flux midpoint between pointer and tile at rest vs engaged, confirming pixel shift from displacement/liquid stretch and Pass 0 flux glow.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const fx = makeDockFixture();
      testStage().append(fx.cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(fx.cv, { fragment: MAGNET_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(fx.cv);
        g.begin([0, 0, 0, 0]);
        g.upload(fx.bg);
        for (const b of fx.btns) g.upload(b);

        const fCtrl = createMagneticField({ count: TOOLS.length, isReduced: () => true });
        fCtrl.setLayout(fx.slots, fx.w, fx.h, fx.tileW, fx.tileH);
        drawFixtureStage(g, fx, fCtrl.s);

        const slot2 = fx.slots[2];
        // Probe 14 px above tile 2's resting top edge (outside tile at rest, inside pulled/stretched tile when engaged)
        const probeTileX = slot2.cx;
        const probeTileY = slot2.restY - 14;
        // Probe flux midpoint in Pass 0 strictly between pointer and displaced tile top
        const px = slot2.cx;
        const py = slot2.restY - 74;
        const fluxX = slot2.cx;
        const fluxY = py + 14;

        const restTilePx = readCssPixel(g.gl, fx.cv, fx.w, fx.h, probeTileX, probeTileY);
        const restFluxPx = readCssPixel(g.gl, fx.cv, fx.w, fx.h, fluxX, fluxY);

        fCtrl.setPointer(px, py, { active: true, tMs: 1000 });
        fCtrl.stepAt(1016.67);
        g.begin([0, 0, 0, 0]);
        drawFixtureStage(g, fx, fCtrl.s);

        const pullTilePx = readCssPixel(g.gl, fx.cv, fx.w, fx.h, probeTileX, probeTileY);
        const pullFluxPx = readCssPixel(g.gl, fx.cv, fx.w, fx.h, fluxX, fluxY);
        const err = g.gl.getError();

        const lum = (p) => p[0] * 0.25 + p[1] * 0.55 + p[2] * 0.2;
        const tileDelta = lum(pullTilePx) - lum(restTilePx);
        const fluxDelta = lum(pullFluxPx) - lum(restFluxPx);

        return need(
          err === g.gl.NO_ERROR && fCtrl.s.tiles[2].dy < -18 && tileDelta > 15 && fluxDelta > 20,
          `glErr=${err}, dy=${fCtrl.s.tiles[2].dy.toFixed(1)} px, tileProbe lum ${lum(restTilePx).toFixed(0)}->${lum(pullTilePx).toFixed(0)}, fluxMid lum ${lum(restFluxPx).toFixed(0)}->${lum(pullFluxPx).toFixed(0)}`
        );
      } finally {
        await retireFixture(g, fx.cv, fx.cv, baseActive);
      }
    },
  },
  {
    name: 'Crossing escape threshold triggers damped spring detachment recoil back to origin (tMs)',
    expect: 'pass',
    why: 'Steps createMagneticField() with explicit tMs timestamps: pulls tile 2 inside 120 px, crosses the escape boundary at 138 px, verifies elastic overshoot recoil past origin before settling to (0, 0), and confirms 1-step reduced-motion snap.',
    run: async () => {
      let reduced = false;
      const fx = createMagneticField({ count: TOOLS.length, pullRadius: 120, attraction: 1.0, isReduced: () => reduced });
      fx.setLayout(
        TOOLS.map((_, i) => ({ restX: 20 + i * 66, restY: 140, cx: 52 + i * 66, cy: 178 })),
        380, 320, 64, 76
      );
      const t2 = fx.s.tiles[2];
      let tMs = 1000;
      fx.setPointer(t2.cx, t2.cy - 68, { active: true, tMs });

      let pullFrames = 0;
      let moving = true;
      while (moving && pullFrames < 200) {
        tMs += 16.67;
        moving = fx.stepAt(tMs);
        pullFrames++;
      }
      const pulledDy = t2.dy;
      const pulledStretch = t2.stretch;
      const engagedAtPeak = t2.engaged;

      // Cross the 120 px escape threshold (distance 138 px)
      fx.setPointer(t2.cx, t2.cy - 138, { active: true, tMs });
      const detachedOnCross = !t2.engaged && t2.detached;

      let recoilFrames = 0;
      let maxOvershoot = 0;
      moving = true;
      while (moving && recoilFrames < 240) {
        tMs += 16.67;
        moving = fx.stepAt(tMs);
        if (t2.dy > maxOvershoot) maxOvershoot = t2.dy;
        recoilFrames++;
      }
      const settledBack = !moving && Math.hypot(t2.dx, t2.dy) < 0.05;

      reduced = true;
      fx.setPointer(t2.cx, t2.cy - 68, { active: true, tMs });
      const reducedMoving = fx.stepAt(tMs + 16.67);
      const snappedDy = t2.dy;

      return need(
        engagedAtPeak && pulledDy < -20 && pulledStretch > 0.3 && detachedOnCross && maxOvershoot > 1.0 && settledBack && !reducedMoving && snappedDy < -20,
        `pulled dy=${pulledDy.toFixed(1)} px (${pullFrames} frames), recoil overshoot=+${maxOvershoot.toFixed(1)} px, settled in ${recoilFrames} frames, reduced snap=${snappedDy.toFixed(1)} px.`
      );
    },
  },
  {
    name: 'updateElementGeometry() + geometryUnit() hits a magnetically displaced button at pulled coordinates',
    expect: 'pass',
    why: 'Displaces #mf-item-2 toward an overhead pointer, calibrates geometryUnit(), calls updateElementGeometry() + toggles dataset.hitTick, and verifies elementsFromPoint() hits the moved button while the vacated bottom slot misses it.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const fx = makeDockFixture(340, 240, 54, 66);
      const btn2 = fx.btns[2];
      let clicks = 0;
      btn2.addEventListener('click', () => { clicks++; });
      testStage().append(fx.cv);

      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        if (glSupported) {
          g = new ElementGL(fx.cv, { fragment: MAGNET_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 0]);
        } else {
          fx.cv.width = fx.w;
          fx.cv.height = fx.h;
          fx.cv.getContext('2d');
        }
        await nextPaint(fx.cv);

        const fCtrl = createMagneticField({ count: TOOLS.length, isReduced: () => true });
        fCtrl.setLayout(fx.slots, fx.w, fx.h, fx.tileW, fx.tileH);
        const slot2 = fx.slots[2];
        fCtrl.setPointer(slot2.cx + 16, slot2.cy - 88, { active: true, tMs: 1000 });
        fCtrl.stepAt(1016.67);

        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(fx.bg);
          for (const b of fx.btns) g.upload(b);
          drawFixtureStage(g, fx, fCtrl.s);
        }

        const uBg = geometryUnit(fx.cv, fx.bg, fx.w);
        const uBtn = geometryUnit(fx.cv, btn2, fx.tileW);
        fx.cv.updateElementGeometry(fx.bg, { canvasTransform: new DOMMatrix().scale(uBg, uBg, 1) });
        for (let i = 0; i < fx.btns.length; i++) {
          const t = fCtrl.s.tiles[i];
          fx.cv.updateElementGeometry(fx.btns[i], {
            canvasTransform: new DOMMatrix().scale(uBtn, uBtn, 1).translate(t.restX + t.dx, t.restY + t.dy),
          });
          fx.btns[i].dataset.hitTick = '1';
        }
        await raf2();

        const cvRect = fx.cv.getBoundingClientRect();
        const bRect = btn2.getBoundingClientRect();
        const hitX = bRect.left + bRect.width * 0.5;
        const hitY = bRect.top + bRect.height * 0.5;
        const hitsMoved = document.elementsFromPoint(hitX, hitY);
        const vacatedY = cvRect.top + slot2.restY + fx.tileH - 6;
        const vacatedX = cvRect.left + slot2.cx;
        const hitsOld = document.elementsFromPoint(vacatedX, vacatedY);
        btn2.click();

        const t2 = fCtrl.s.tiles[2];
        return need(
          hitsMoved.includes(btn2) && !hitsOld.includes(btn2) && clicks === 1,
          `dx=${t2.dx.toFixed(1)}, dy=${t2.dy.toFixed(1)}, geometryUnit=${uBtn.toFixed(3)}, movedHit=${hitsMoved.includes(btn2)}, vacatedMiss=${!hitsOld.includes(btn2)}, clicks=${clicks}.`
        );
      } finally {
        await retireFixture(g, fx.cv, fx.cv, baseActive);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-argument 2D drawElementImage() fallback work',
    expect: 'pass',
    why: 'Dispatches synthetic webglcontextlost and webglcontextrestored on an ElementGL fixture to verify plain-HTML fallback and GL recovery, then draws backdrop and a shifted button via 5-argument 2D drawElementImage().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const fx = makeDockFixture(280, 200, 44, 54);
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      wrap.append(fx.cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostOk = false;
      let restoredOk = false;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(fx.cv, {
          fragment: MAGNET_FRAG,
          attributes: { preserveDrawingBuffer: true },
          onLost: () => {
            lostOk = true;
            plain.hidden = false;
            plain.append(fx.bg, ...fx.btns);
          },
          onRestored: () => {
            restoredOk = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            fx.cv.append(fx.bg, ...fx.btns);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(fx.cv);
        g.begin([0, 0, 0, 0]);
        g.upload(fx.bg);
        for (const b of fx.btns) g.upload(b);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        fx.cv.dispatchEvent(lostEv);
        const inPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(fx.btns[2]);
        const bRect = fx.btns[2].getBoundingClientRect();
        const plainHits = document.elementsFromPoint(bRect.left + bRect.width * 0.5, bRect.top + bRect.height * 0.5);

        fx.cv.dispatchEvent(new Event('webglcontextrestored'));
        g.begin([0, 0, 0, 0]);
        await nextPaint(fx.cv);
        g.begin([0, 0, 0, 0]);
        const tAfter = g.upload(fx.btns[2]);
        const err = g.gl.getError();

        const cv2d = document.createElement('canvas');
        cv2d.setAttribute('content', 'drawable');
        cv2d.setAttribute('layoutsubtree', '');
        cv2d.style.cssText = `width:${fx.w}px;height:${fx.h}px;display:block`;
        const box2d = document.createElement('div');
        box2d.setAttribute('drawable', '');
        box2d.style.cssText = `width:${fx.w}px;height:${fx.h}px;background:#10192b;color:#fff;padding:10px;box-sizing:border-box`;
        box2d.textContent = '2D Fallback';
        const btn2d = document.createElement('button');
        btn2d.type = 'button';
        btn2d.setAttribute('drawable', '');
        btn2d.style.cssText = 'position:absolute;left:0;top:0;width:54px;height:66px;background:#243554;color:#fff;border:2px solid #34d399;border-radius:12px';
        btn2d.textContent = 'Slice';
        cv2d.append(box2d, btn2d);
        testStage().append(cv2d);
        try {
          const ctx = cv2d.getContext('2d');
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv2d.width = Math.round(fx.w * dpr);
          cv2d.height = Math.round(fx.h * dpr);
          await nextPaint(cv2d);
          ctx.reset();
          ctx.scale(dpr, dpr);
          ctx.drawElementImage(box2d, 0, 0, fx.w, fx.h);
          ctx.drawElementImage(btn2d, 112, 64, 54, 66);
          const copy = document.createElement('canvas');
          copy.width = 140;
          copy.height = 100;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2d, 0, 0, 140, 100);
          const f2d = inkFraction(cc);

          return need(
            inPlain && plainHits.includes(fx.btns[2]) && restoredOk && !g.lost && tAfter?.w > 0 && err === g.gl.NO_ERROR && f2d > 0.5,
            `plainDuringLoss=${inPlain}, plainHit=${plainHits.includes(fx.btns[2])}, restored=${restoredOk}, texAfter=${tAfter?.w}x${tAfter?.h}, glErr=${err}, 2dInk=${(f2d * 100).toFixed(0)}%.`
          );
        } finally {
          cv2d.remove();
          window.__gfx?.retire?.(cv2d);
        }
      } finally {
        await retireFixture(g, wrap, fx.cv, baseActive);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'magnetic-field canvas',
      note: 'plain HTML',
      ink: async () => {
        if (backend === 'plain') return null;
        if (!hasPainted || !canvas.width || !canvas.height) return 0;
        if (backend === 'webgl') {
          if (!stage || stage.lost) return 0;
          drawFrame(true);
        }
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => switchToPlain('The magnetic-field canvas came back blank, so the dock moved to plain HTML.'),
    },
  ]),
];

runTests(checksBody, tests);
