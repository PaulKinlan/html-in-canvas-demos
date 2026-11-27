import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const RING_SIZE = 316;
export const RING_HALF = RING_SIZE * 0.5;
export const BTN_RADIUS = 88;
export const DETENT_PULL = 13;
export const DETENT_SCALE = 1.13;

export const COMMANDS = [
  { cmd: 'rotate', label: 'Rotate', angle: 0 },
  { cmd: 'scale',  label: 'Scale',  angle: Math.PI / 3 },
  { cmd: 'invert', label: 'Invert', angle: (2 * Math.PI) / 3 },
  { cmd: 'tint',   label: 'Tint',   angle: Math.PI },
  { cmd: 'grid',   label: 'Grid',   angle: (4 * Math.PI) / 3 },
  { cmd: 'reset',  label: 'Reset',  angle: (5 * Math.PI) / 3 },
];

export const TINTS = [
  { name: 'Coral',   hex: '#ff7a4d', rgb: [1.0, 0.478, 0.302] },
  { name: 'Cyan',    hex: '#38bdf8', rgb: [0.220, 0.741, 0.973] },
  { name: 'Emerald', hex: '#34d399', rgb: [0.204, 0.827, 0.600] },
  { name: 'Violet',  hex: '#a78bfa', rgb: [0.655, 0.545, 0.980] },
];

const SCALES = [1.0, 1.18, 0.84];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

export function normalizeAngle(rad) {
  let a = rad % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a;
}

export function angleToWedgeIndex(angleRad) {
  const step = Math.PI / 3;
  const norm = normalizeAngle(angleRad + step * 0.5);
  return Math.floor(norm / step) % 6;
}

// #region pie-spring
function stepDampedSpring(cur, vel, target, dt, stiffness, damping) {
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

export function createPieState({ initialX = 200, initialY = 200, isReduced = () => false } = {}) {
  const s = {
    open: true,
    menuX: initialX,
    menuY: initialY,
    menuScale: 1,
    menuScaleVel: 0,
    menuAlpha: 1,
    menuAlphaVel: 0,
    pointerAngle: 0,
    pointerDist: 0,
    beamStrength: 0,
    beamVel: 0,
    hasAim: false,
    activeIdx: -1,
    flashIdx: -1,
    flashUntil: 0,
    bulge: 0,
    bulgeVel: 0,
    wedges: COMMANDS.map((c, idx) => ({
      idx,
      cmd: c.cmd,
      angle: c.angle,
      pull: 0,
      pullVel: 0,
      scale: 1,
      scaleVel: 0,
    })),
  };

  function snapAll() {
    s.menuScale = s.open ? 1 : 0;
    s.menuScaleVel = 0;
    s.menuAlpha = s.open ? 1 : 0;
    s.menuAlphaVel = 0;
    s.beamStrength = s.open && s.hasAim ? 1 : 0;
    s.beamVel = 0;
    s.bulge = s.open && s.activeIdx >= 0 ? 1 : 0;
    s.bulgeVel = 0;
    for (let i = 0; i < s.wedges.length; i++) {
      const w = s.wedges[i];
      const active = s.open && s.activeIdx === i;
      w.pull = active ? DETENT_PULL : 0;
      w.pullVel = 0;
      w.scale = active ? DETENT_SCALE : 1;
      w.scaleVel = 0;
    }
  }

  function openAt(x, y, { bubble = true } = {}) {
    const moved = Math.hypot(x - s.menuX, y - s.menuY);
    const wasClosed = !s.open;
    s.open = true;
    s.menuX = x;
    s.menuY = y;
    if (isReduced() || !bubble) {
      snapAll();
      return;
    }
    if (wasClosed || moved > 14) {
      s.menuScale = wasClosed ? 0.34 : 0.56;
      s.menuScaleVel = 3.2;
      s.menuAlpha = wasClosed ? 0.18 : 0.72;
      s.menuAlphaVel = 0;
    }
  }

  function close() {
    s.open = false;
    s.hasAim = false;
    s.activeIdx = -1;
    s.flashIdx = -1;
    if (isReduced()) snapAll();
  }

  function aimAt(px, py, { armDeadzone = 20 } = {}) {
    if (!s.open) return;
    const dx = px - s.menuX;
    const dy = py - s.menuY;
    const dist = Math.hypot(dx, dy);
    s.pointerDist = dist;
    if (dist >= armDeadzone) {
      s.pointerAngle = Math.atan2(dy, dx);
      s.hasAim = true;
      s.activeIdx = angleToWedgeIndex(s.pointerAngle);
    } else {
      s.hasAim = false;
      s.activeIdx = -1;
    }
    if (isReduced()) snapAll();
  }

  function aimWedge(idx) {
    if (!s.open) return;
    s.activeIdx = idx >= 0 && idx < 6 ? idx : -1;
    s.hasAim = s.activeIdx >= 0;
    if (s.activeIdx >= 0) {
      s.pointerAngle = COMMANDS[s.activeIdx].angle;
      s.pointerDist = BTN_RADIUS;
    }
    if (isReduced()) snapAll();
  }

  function triggerFlash(idx, { now = performance.now() } = {}) {
    if (idx < 0 || idx >= 6) return;
    if (isReduced()) {
      s.flashIdx = -1;
      s.flashUntil = 0;
      snapAll();
      return;
    }
    s.flashIdx = idx;
    s.flashUntil = now + 220;
    s.wedges[idx].pullVel += 95;
    s.wedges[idx].scaleVel += 1.05;
    s.bulge = 1.18;
  }

  function step(dt, now = performance.now()) {
    const clampedDt = Math.min(Math.max(dt, 0.001), 0.05);
    if (s.flashIdx >= 0 && now >= s.flashUntil) {
      s.flashIdx = -1;
    }

    if (isReduced()) {
      snapAll();
      return false;
    }

    let moving = false;
    const drive = (cur, vel, target, stiffness, damping, epsX, epsV) => {
      if (Math.abs(cur - target) > epsX || Math.abs(vel) > epsV) {
        const [nx, nv] = stepDampedSpring(cur, vel, target, clampedDt, stiffness, damping);
        if (Math.abs(nx - target) < epsX && Math.abs(nv) < epsV) {
          return [target, 0, false];
        }
        return [nx, nv, true];
      }
      return [target, 0, false];
    };

    let m;
    [s.menuScale, s.menuScaleVel, m] = drive(s.menuScale, s.menuScaleVel, s.open ? 1 : 0, 340, 22, 0.001, 0.005);
    if (m) moving = true;

    [s.menuAlpha, s.menuAlphaVel, m] = drive(s.menuAlpha, s.menuAlphaVel, s.open ? 1 : 0, 380, 34, 0.002, 0.01);
    if (m) moving = true;

    [s.beamStrength, s.beamVel, m] = drive(s.beamStrength, s.beamVel, s.open && s.hasAim ? 1 : 0, 300, 28, 0.002, 0.01);
    if (m) moving = true;

    [s.bulge, s.bulgeVel, m] = drive(s.bulge, s.bulgeVel, s.open && s.activeIdx >= 0 ? 1 : 0, 280, 24, 0.002, 0.01);
    if (m) moving = true;

    for (let i = 0; i < s.wedges.length; i++) {
      const w = s.wedges[i];
      const active = s.open && s.activeIdx === i;
      [w.pull, w.pullVel, m] = drive(w.pull, w.pullVel, active ? DETENT_PULL : 0, 320, 22, 0.02, 0.08);
      if (m) moving = true;
      [w.scale, w.scaleVel, m] = drive(w.scale, w.scaleVel, active ? DETENT_SCALE : 1, 320, 22, 0.001, 0.005);
      if (m) moving = true;
    }

    if (s.flashIdx >= 0 && now < s.flashUntil) moving = true;
    return moving;
  }

  return { s, openAt, close, aimAt, aimWedge, triggerFlash, step, snapAll };
}
// #endregion pie-spring

// #region pie-shader
export const PIE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform int uPass;
uniform vec2 uCanvasSize;
uniform vec2 uRingSize;
uniform vec2 uMenuCenter;
uniform float uMenuScale;
uniform float uMenuAlpha;
uniform float uPointerAngle;
uniform float uPointerDist;
uniform float uActiveAngle;
uniform float uActiveIdx;
uniform float uActivePull;
uniform float uBeamStrength;
uniform float uBulge;
uniform vec3 uAccent;

in vec2 vUv;
out vec4 outColor;

float modAngle(float a) {
  return atan(sin(a), cos(a));
}

void main() {
  if (uPass == 0) {
    vec4 base = texture(uTex, vUv);
    if (uMenuAlpha <= 0.005) {
      outColor = base;
      return;
    }

    vec2 px = vUv * max(uCanvasSize, vec2(1.0));
    vec2 d = px - uMenuCenter;
    float dist = length(d);
    float ang = atan(d.y, d.x);

    float rInner = 25.0 * max(uMenuScale, 0.05);
    float rOuter = 144.0 * max(uMenuScale, 0.05);
    float ringBand = smoothstep(rInner - 2.0, rInner + 2.0, dist) * (1.0 - smoothstep(rOuter - 2.0, rOuter + 2.0, dist));

    vec3 col = base.rgb;
    if (ringBand > 0.001) {
      vec2 dir = dist > 0.5 ? d / dist : vec2(1.0, 0.0);
      float curve = sin(clamp((dist - rInner) / max(rOuter - rInner, 1.0), 0.0, 1.0) * 3.14159265);
      vec2 refr = -dir * (5.2 * curve) / max(uCanvasSize, vec2(1.0));
      vec2 spread = vec2(4.2) / max(uCanvasSize, vec2(1.0));
      vec4 s0 = texture(uTex, clamp(vUv + refr, 0.001, 0.999));
      vec4 s1 = texture(uTex, clamp(vUv + refr + vec2(spread.x, 0.0), 0.001, 0.999));
      vec4 s2 = texture(uTex, clamp(vUv + refr - vec2(spread.x, 0.0), 0.001, 0.999));
      vec4 s3 = texture(uTex, clamp(vUv + refr + vec2(0.0, spread.y), 0.001, 0.999));
      vec4 s4 = texture(uTex, clamp(vUv + refr - vec2(0.0, spread.y), 0.001, 0.999));
      vec3 frosted = (s0.rgb * 2.0 + s1.rgb + s2.rgb + s3.rgb + s4.rgb) / 6.0;
      frosted = mix(frosted * 0.46, vec3(0.06, 0.09, 0.17), 0.58);
      col = mix(col, frosted, ringBand * 0.92 * uMenuAlpha);
    }

    // 6 radial sector dividers at 30, 90, 150, 210, 270, 330 degrees
    float secMod = abs(mod(ang + 0.52359878, 1.04719755) - 0.52359878);
    float divLine = exp(-pow(secMod * max(dist, 24.0) / 1.15, 2.0)) * ringBand;
    col += vec3(0.48, 0.58, 0.80) * (0.24 * divLine * uMenuAlpha);

    // Inner & outer frosted bezel rims
    float outerRim = exp(-pow((dist - rOuter) / 1.6, 2.0));
    float innerRim = exp(-pow((dist - rInner) / 1.5, 2.0));
    col += vec3(0.66, 0.78, 0.98) * (0.28 * outerRim + 0.36 * innerRim) * uMenuAlpha;

    // Central hub disc
    float hubMask = 1.0 - smoothstep(rInner - 2.0, rInner + 1.0, dist);
    col = mix(col, col * 0.45 + vec3(0.05, 0.08, 0.14), hubMask * 0.85 * uMenuAlpha);

    // Directional selection beam + active sector highlight
    if (uBeamStrength > 0.005) {
      float dSec = modAngle(ang - uActiveAngle);
      float secGlow = smoothstep(0.54, 0.18, abs(dSec)) * ringBand;
      float radRamp = smoothstep(rInner, rOuter, dist);
      col += uAccent * (0.22 + 0.34 * radRamp) * secGlow * uBeamStrength * uMenuAlpha;

      float arcGlow = exp(-pow((dist - rOuter) / 3.2, 2.0)) * smoothstep(0.56, 0.24, abs(dSec));
      col += mix(uAccent, vec3(1.0), 0.35) * (0.85 * arcGlow * uBeamStrength * uMenuAlpha);

      float dPtr = modAngle(ang - uPointerAngle);
      float beamLen = clamp(uPointerDist, rInner + 14.0, rOuter + 14.0);
      float beamRadial = smoothstep(10.0, 22.0, dist) * (1.0 - smoothstep(beamLen - 6.0, beamLen + 10.0, dist));
      float beamCore = exp(-pow(dPtr / 0.13, 2.0)) * beamRadial;
      float beamCone = exp(-pow(dPtr / 0.34, 2.0)) * beamRadial * 0.36;
      float tipFlare = exp(-pow((dist - beamLen) / 8.0, 2.0)) * exp(-pow(dPtr / 0.22, 2.0));
      col += mix(uAccent, vec3(1.0, 0.96, 0.9), 0.45) * (beamCore * 0.74 + beamCone + tipFlare * 0.65) * uBeamStrength * uMenuAlpha;

      float pipGlow = exp(-pow((dist - (rInner - 5.0)) / 3.4, 2.0)) * exp(-pow(dPtr / 0.32, 2.0));
      col += mix(uAccent, vec3(1.0), 0.5) * (pipGlow * 0.9 * uBeamStrength * uMenuAlpha);
    }

    outColor = vec4(col, 1.0);
    return;
  }

  // Pass 1: #pm-ring buttons with barrel bulge and crisp specular edge glow on the active wedge
  vec2 p = (vUv - 0.5) * uRingSize;
  vec2 sampleUv = vUv;
  float ang = atan(p.y, p.x);
  float sMask = 0.0;

  if (uActiveIdx >= -0.5 && uBulge > 0.005) {
    float dAct = modAngle(ang - uActiveAngle);
    sMask = smoothstep(0.56, 0.40, abs(dAct));
    if (sMask > 0.001) {
      vec2 wDir = vec2(cos(uActiveAngle), sin(uActiveAngle));
      vec2 wPerp = vec2(-wDir.y, wDir.x);
      vec2 wCenter = wDir * (${BTN_RADIUS.toFixed(1)} + uActivePull);
      vec2 wLocal = p - wCenter;
      float along = dot(wLocal, wDir);
      float across = dot(wLocal, wPerp);
      vec2 ell = vec2(along / 46.0, across / 32.0);
      float r2 = dot(ell, ell);
      if (r2 < 1.0) {
        float strength = 0.14 * uBulge * sMask;
        vec2 bulgeOffset = wLocal * (strength * (1.0 - r2));
        float stretch = 3.5 * uBulge * sMask * (1.0 - r2) * smoothstep(-32.0, 14.0, along);
        vec2 warpedP = p - bulgeOffset - wDir * stretch * 0.25;
        sampleUv = clamp(warpedP / uRingSize + 0.5, 0.001, 0.999);
      }
    }
  }

  vec4 ringTex = texture(uTex, sampleUv);
  if (sMask > 0.01 && uBulge > 0.01) {
    vec2 pxStep = 1.75 / max(uRingSize, vec2(1.0));
    float aN = texture(uTex, clamp(sampleUv + vec2(0.0, -pxStep.y), 0.0, 1.0)).a;
    float aS = texture(uTex, clamp(sampleUv + vec2(0.0,  pxStep.y), 0.0, 1.0)).a;
    float aE = texture(uTex, clamp(sampleUv + vec2( pxStep.x, 0.0), 0.0, 1.0)).a;
    float aW = texture(uTex, clamp(sampleUv + vec2(-pxStep.x, 0.0), 0.0, 1.0)).a;
    float edgeBand = clamp(max(max(aN, aS), max(aE, aW)) - ringTex.a, 0.0, 1.0);
    float innerRim = ringTex.a * clamp(1.0 - min(min(aN, aS), min(aE, aW)), 0.0, 1.0);
    vec3 glowCol = mix(uAccent, vec3(1.0), 0.38);
    ringTex.rgb += glowCol * (edgeBand * 0.85 + innerRim * 0.42) * uBulge * sMask;
    ringTex.a = max(ringTex.a, edgeBand * 0.72 * uBulge * sMask);
  }

  outColor = ringTex * uMenuAlpha;
}`;
// #endregion pie-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('pm-stage');
const viewportEl = document.getElementById('pm-viewport');
const canvas = document.getElementById('pm-canvas');
const workspaceEl = document.getElementById('pm-workspace');
const ringEl = document.getElementById('pm-ring');
const targetCardEl = document.getElementById('pm-target');
const wsBadgeEl = document.getElementById('ws-badge');
const wsTintLabelEl = document.getElementById('ws-tint-label');
const statRotEl = document.getElementById('stat-rot');
const statScaleEl = document.getElementById('stat-scale');
const statGridEl = document.getElementById('stat-grid');
const wsFeedbackEl = document.getElementById('ws-feedback');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const noticeEl = document.getElementById('stage-notice');
const checksBody = document.getElementById('checks-body');

const wedgeBtns = Array.from(ringEl.querySelectorAll('.pm-wedge[data-cmd]'));
const btnToggle = document.getElementById('btn-toggle');
const btnCentre = document.getElementById('btn-centre');
const btnResetCard = document.getElementById('btn-reset-card');
const reducedCheck = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

// ---------------------------------------------------------------- State
const cardState = {
  rotDeg: 0,
  scaleIdx: 0,
  inverted: false,
  tintIdx: 0,
  grid: false,
  lastCmd: 'Ready',
  cmdCount: 0,
};

const ctrl = createPieState({ initialX: 200, initialY: 200, isReduced });
const pie = ctrl.s;

let stage = null;
let ctx2d = null;
let backend = 'none';
let hasPainted = false;
let wsDirty = true;
let ringDirty = true;
let rafId = 0;
let lastFrameTime = 0;
let isVisible = true;
let lostTimer = 0;
let dragging = false;
let dragId = -1;
let dragStartDist = 0;
let dragMaxDist = 0;
let lastGeoSig = '';
const lastWedgeStyle = wedgeBtns.map(() => '');
const unitCache = { wsKey: '', wsUnit: 1, ringKey: '', ringUnit: 1 };

function clampMenuCenter(x, y) {
  const cw = canvas.clientWidth || viewportEl.clientWidth || 360;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 360;
  const mx = Math.min(134, cw * 0.48);
  const my = Math.min(106, ch * 0.48);
  return [clamp(x, mx, cw - mx), clamp(y, my, ch - my)];
}

function syncWorkspaceCard() {
  const scale = SCALES[cardState.scaleIdx];
  const tint = TINTS[cardState.tintIdx];

  workspaceEl.style.setProperty('--ws-accent', tint.hex);
  ringEl.style.setProperty('--wedge-accent', tint.hex);
  workspaceEl.classList.toggle('is-grid', cardState.grid);
  targetCardEl.classList.toggle('is-inverted', cardState.inverted);
  targetCardEl.classList.toggle('is-grid', cardState.grid);
  targetCardEl.style.transform = `rotate(${cardState.rotDeg}deg) scale(${scale})`;

  const themeWord = cardState.inverted ? 'Light' : 'Dark';
  wsBadgeEl.textContent = `${cardState.rotDeg}° · ${scale.toFixed(2)}× · ${themeWord}`;
  wsTintLabelEl.textContent = `Accent · ${tint.name}`;
  statRotEl.textContent = `${cardState.rotDeg}°`;
  statScaleEl.textContent = `${scale.toFixed(2)}×`;
  statGridEl.textContent = cardState.grid ? 'On' : 'Off';
  wsFeedbackEl.textContent = cardState.cmdCount
    ? `Applied: ${cardState.lastCmd} (#${cardState.cmdCount})`
    : 'Ready · tap wedge or drag';

  for (const btn of wedgeBtns) {
    btn.style.setProperty('--wedge-accent', tint.hex);
  }
  wsDirty = true;
  ringDirty = true;
}

function applyRingDom() {
  let changed = false;
  for (let i = 0; i < wedgeBtns.length; i++) {
    const btn = wedgeBtns[i];
    const w = pie.wedges[i];
    const r = BTN_RADIUS + w.pull;
    const wx = Math.cos(w.angle) * r;
    const wy = Math.sin(w.angle) * r;
    const isAct = pie.activeIdx === i;
    const isFlash = pie.flashIdx === i;
    const sig = `${wx.toFixed(1)},${wy.toFixed(1)},${w.scale.toFixed(3)},${isAct ? 1 : 0},${isFlash ? 1 : 0}`;
    if (sig !== lastWedgeStyle[i]) {
      lastWedgeStyle[i] = sig;
      btn.style.setProperty('--wx', `${wx.toFixed(2)}px`);
      btn.style.setProperty('--wy', `${wy.toFixed(2)}px`);
      btn.style.setProperty('--ws', w.scale.toFixed(4));
      btn.classList.toggle('is-active', isAct);
      btn.classList.toggle('is-flash', isFlash);
      changed = true;
    }
  }
  if (changed) {
    ringDirty = true;
    lastGeoSig = '';
    canvas.requestPaint?.();
  }
  return changed;
}

function applyCommand(cmd, idx = -1) {
  if (cmd === 'rotate') {
    cardState.rotDeg = (cardState.rotDeg + 45) % 360;
    cardState.lastCmd = `Rotate ${cardState.rotDeg}°`;
  } else if (cmd === 'scale') {
    cardState.scaleIdx = (cardState.scaleIdx + 1) % SCALES.length;
    cardState.lastCmd = `Scale ${SCALES[cardState.scaleIdx].toFixed(2)}×`;
  } else if (cmd === 'invert') {
    cardState.inverted = !cardState.inverted;
    cardState.lastCmd = cardState.inverted ? 'Invert Light' : 'Invert Dark';
  } else if (cmd === 'tint') {
    cardState.tintIdx = (cardState.tintIdx + 1) % TINTS.length;
    cardState.lastCmd = `Tint ${TINTS[cardState.tintIdx].name}`;
  } else if (cmd === 'grid') {
    cardState.grid = !cardState.grid;
    cardState.lastCmd = cardState.grid ? 'Grid On' : 'Grid Off';
  } else if (cmd === 'reset') {
    cardState.rotDeg = 0;
    cardState.scaleIdx = 0;
    cardState.inverted = false;
    cardState.tintIdx = 0;
    cardState.grid = false;
    cardState.lastCmd = 'Reset';
  }
  cardState.cmdCount++;
  if (idx >= 0) ctrl.triggerFlash(idx);
  syncWorkspaceCard();
  applyRingDom();
  canvas.requestPaint?.();
  scheduleLoop();
}

function syncToolbar() {
  btnToggle.setAttribute('aria-pressed', String(pie.open));
  btnToggle.textContent = pie.open ? 'Close menu' : 'Open at centre';
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
  cancelAnimationFrame(rafId);
  rafId = 0;
  stageBox.classList.add('is-plain');
  workspaceEl.inert = false;
  ringEl.inert = false;
  if (workspaceEl.parentElement !== plainHost) plainHost.append(workspaceEl);
  if (ringEl.parentElement !== plainHost) plainHost.append(ringEl);
  showNotice(reason);
  updateHud();
}

function restoreFromPlain() {
  stageBox.classList.remove('is-plain');
  if (workspaceEl.parentElement !== canvas) canvas.append(workspaceEl);
  if (ringEl.parentElement !== canvas) canvas.append(ringEl);
  unitCache.wsKey = '';
  unitCache.ringKey = '';
  lastGeoSig = '';
  wsDirty = true;
  ringDirty = true;
  showNotice('');
}

// #region geometry-sync
function syncGeometry(force = false) {
  if (backend === 'plain' || !hasPainted || typeof canvas.updateElementGeometry !== 'function') return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const ww = workspaceEl.offsetWidth || cw;
  const rw = ringEl.offsetWidth || RING_SIZE;
  if (!cw || !ch || !ww || !rw) return;

  const sig = `${backend}:${canvas.width}x${canvas.height}:${cw}x${ch}:${pie.open ? 1 : 0}:${pie.menuX.toFixed(1)},${pie.menuY.toFixed(1)},${pie.menuScale.toFixed(3)},${pie.activeIdx}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  const wsKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${ww}`;
  if (unitCache.wsKey !== wsKey) {
    unitCache.wsUnit = geometryUnit(canvas, workspaceEl, ww);
    unitCache.wsKey = wsKey;
  }
  const ringKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${rw}`;
  if (unitCache.ringKey !== ringKey) {
    unitCache.ringUnit = geometryUnit(canvas, ringEl, rw);
    unitCache.ringKey = ringKey;
  }

  const uWs = unitCache.wsUnit || 1;
  const uRing = unitCache.ringUnit || 1;
  canvas.updateElementGeometry(workspaceEl, { canvasTransform: new DOMMatrix().scale(uWs, uWs, 1) });
  workspaceEl.dataset.hitTick = workspaceEl.dataset.hitTick === '1' ? '0' : '1';

  const visibleMenu = pie.open && pie.menuScale > 0.08 && pie.menuAlpha > 0.08;
  ringEl.inert = !visibleMenu;
  ringEl.style.pointerEvents = visibleMenu ? 'auto' : 'none';
  if (visibleMenu) {
    const ringLeft = pie.menuX - RING_HALF * pie.menuScale;
    const ringTop = pie.menuY - RING_HALF * pie.menuScale;
    const mat = new DOMMatrix()
      .scale(uRing, uRing, 1)
      .translate(ringLeft, ringTop)
      .scale(pie.menuScale, pie.menuScale, 1);
    canvas.updateElementGeometry(ringEl, { canvasTransform: mat });
  } else if (OFFSTAGE) {
    canvas.updateElementGeometry(ringEl, { canvasTransform: OFFSTAGE });
  }
  ringEl.dataset.hitTick = ringEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

// #region fallback-2d
function draw2DFallback(cw, ch, forceGeo = false) {
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
  ctx2d.drawElementImage(workspaceEl, 0, 0, cw, ch);

  if (pie.menuAlpha > 0.01 && pie.menuScale > 0.05) {
    const tint = TINTS[cardState.tintIdx];
    const rInner = 25 * pie.menuScale;
    const rOuter = 144 * pie.menuScale;
    ctx2d.save();
    ctx2d.globalAlpha = pie.menuAlpha;

    ctx2d.beginPath();
    ctx2d.arc(pie.menuX, pie.menuY, rOuter, 0, Math.PI * 2);
    ctx2d.arc(pie.menuX, pie.menuY, rInner, 0, Math.PI * 2, true);
    ctx2d.fillStyle = 'rgb(12 18 31 / 0.72)';
    ctx2d.fill();
    ctx2d.lineWidth = 1.5;
    ctx2d.strokeStyle = 'rgb(168 190 228 / 0.35)';
    ctx2d.stroke();

    if (pie.beamStrength > 0.01 && pie.activeIdx >= 0) {
      const a0 = COMMANDS[pie.activeIdx].angle;
      ctx2d.beginPath();
      ctx2d.arc(pie.menuX, pie.menuY, rOuter, a0 - Math.PI / 6, a0 + Math.PI / 6);
      ctx2d.arc(pie.menuX, pie.menuY, rInner, a0 + Math.PI / 6, a0 - Math.PI / 6, true);
      ctx2d.closePath();
      ctx2d.fillStyle = `color-mix(in srgb, ${tint.hex} 34%, transparent)`;
      ctx2d.fill();

      const len = clamp(pie.pointerDist, rInner + 14, rOuter + 10);
      ctx2d.beginPath();
      ctx2d.moveTo(pie.menuX + Math.cos(pie.pointerAngle) * 14, pie.menuY + Math.sin(pie.pointerAngle) * 14);
      ctx2d.lineTo(pie.menuX + Math.cos(pie.pointerAngle) * len, pie.menuY + Math.sin(pie.pointerAngle) * len);
      ctx2d.strokeStyle = tint.hex;
      ctx2d.lineWidth = 3;
      ctx2d.lineCap = 'round';
      ctx2d.stroke();
    }

    const ringLeft = pie.menuX - RING_HALF * pie.menuScale;
    const ringTop = pie.menuY - RING_HALF * pie.menuScale;
    const size = RING_SIZE * pie.menuScale;
    ctx2d.drawElementImage(ringEl, ringLeft, ringTop, size, size);
    ctx2d.restore();
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
  const wedgeText = pie.activeIdx >= 0
    ? `${COMMANDS[pie.activeIdx].label} (${Math.round((COMMANDS[pie.activeIdx].angle * 180) / Math.PI)}°)`
    : 'none';
  hudEl.textContent =
    `Route: ${route} · ${mp} MP · Menu: ${pie.open ? `open (${Math.round(pie.menuX)}, ${Math.round(pie.menuY)})` : 'closed'} · ` +
    `Wedge: ${wedgeText} · Last: ${cardState.lastCmd}`;
}

function drawFrame(forceGeo = false) {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch || !hasPainted) return;

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      if (!stage.begin([0, 0, 0, 0])) return;
      if (wsDirty || !stage.has(workspaceEl)) {
        stage.upload(workspaceEl);
        wsDirty = false;
      }
      if (ringDirty || !stage.has(ringEl)) {
        stage.upload(ringEl);
        ringDirty = false;
      }

      const tint = TINTS[cardState.tintIdx];
      const activeAngle = pie.activeIdx >= 0 ? COMMANDS[pie.activeIdx].angle : pie.pointerAngle;
      const activePull = pie.activeIdx >= 0 ? pie.wedges[pie.activeIdx].pull : 0;

      const setCommon = (gl, loc) => {
        gl.uniform2f(loc('uCanvasSize'), cw, ch);
        gl.uniform2f(loc('uRingSize'), RING_SIZE, RING_SIZE);
        gl.uniform2f(loc('uMenuCenter'), pie.menuX, pie.menuY);
        gl.uniform1f(loc('uMenuScale'), pie.menuScale);
        gl.uniform1f(loc('uMenuAlpha'), pie.menuAlpha);
        gl.uniform1f(loc('uPointerAngle'), pie.pointerAngle);
        gl.uniform1f(loc('uPointerDist'), pie.pointerDist);
        gl.uniform1f(loc('uActiveAngle'), activeAngle);
        gl.uniform1f(loc('uActiveIdx'), pie.activeIdx);
        gl.uniform1f(loc('uActivePull'), activePull);
        gl.uniform1f(loc('uBeamStrength'), pie.beamStrength);
        gl.uniform1f(loc('uBulge'), pie.bulge);
        gl.uniform3f(loc('uAccent'), tint.rgb[0], tint.rgb[1], tint.rgb[2]);
      };

      stage.quad(workspaceEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        gl.uniform1i(loc('uPass'), 0);
        setCommon(gl, loc);
      });

      if (pie.menuAlpha > 0.01 && pie.menuScale > 0.05) {
        const ringLeft = pie.menuX - RING_HALF * pie.menuScale;
        const ringTop = pie.menuY - RING_HALF * pie.menuScale;
        const size = RING_SIZE * pie.menuScale;
        stage.quad(ringEl, ElementGL.rect(canvas, ringLeft, ringTop, size, size), (gl, loc) => {
          gl.uniform1i(loc('uPass'), 1);
          setCommon(gl, loc);
        });
      }

      syncGeometry(forceGeo);
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        wsDirty = true;
        ringDirty = true;
        canvas.requestPaint?.();
      } else {
        throw err;
      }
    }
  } else if (backend === '2d') {
    draw2DFallback(cw, ch, forceGeo);
  }
  updateHud();
}

function tick(now) {
  rafId = 0;
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 1 / 60;
  lastFrameTime = now;

  const moving = ctrl.step(dt, now);
  applyRingDom();
  drawFrame();

  if (moving || dragging) {
    rafId = requestAnimationFrame(tick);
  } else {
    lastFrameTime = 0;
  }
}

function scheduleLoop() {
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  if (!rafId) {
    rafId = requestAnimationFrame(tick);
  }
}

function recenterMenu({ bubble = true } = {}) {
  const cw = canvas.clientWidth || viewportEl.clientWidth || 360;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 360;
  ctrl.openAt(cw * 0.5, ch * 0.5, { bubble });
  syncToolbar();
  applyRingDom();
  scheduleLoop();
}

// ---------------------------------------------------------------- Event wiring
for (const btn of wedgeBtns) {
  btn.addEventListener('pointerdown', (e) => {
    const idx = Number(btn.dataset.idx);
    if (Number.isFinite(idx)) {
      ctrl.aimWedge(idx);
      applyRingDom();
      scheduleLoop();
    }
    e.stopPropagation();
  });

  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.idx);
    applyCommand(btn.dataset.cmd, Number.isFinite(idx) ? idx : -1);
  });

  btn.addEventListener('focus', () => {
    const idx = Number(btn.dataset.idx);
    if (Number.isFinite(idx) && pie.open) {
      ctrl.aimWedge(idx);
      applyRingDom();
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
  if (e.target instanceof Element && e.target.closest('.pm-wedge')) return;
  const [rawX, rawY] = localCanvasPoint(e);
  const [cx, cy] = clampMenuCenter(rawX, rawY);
  ctrl.openAt(cx, cy, { bubble: true });
  ctrl.aimAt(cx, cy, { armDeadzone: 20 });
  dragging = true;
  dragId = e.pointerId;
  dragStartDist = 0;
  dragMaxDist = 0;
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  syncToolbar();
  applyRingDom();
  scheduleLoop();
});

canvas.addEventListener('pointermove', (e) => {
  if (backend === 'plain') return;
  const [px, py] = localCanvasPoint(e);
  if (dragging && e.pointerId === dragId) {
    const dist = Math.hypot(px - pie.menuX, py - pie.menuY);
    dragStartDist = dist;
    if (dist > dragMaxDist) dragMaxDist = dist;
    ctrl.aimAt(px, py, { armDeadzone: 20 });
    applyRingDom();
    scheduleLoop();
    return;
  }
  if (!dragging && e.pointerType === 'mouse' && pie.open) {
    const dist = Math.hypot(px - pie.menuX, py - pie.menuY);
    if (dist <= 185) {
      ctrl.aimAt(px, py, { armDeadzone: 18 });
    } else if (pie.activeIdx !== -1 || pie.hasAim) {
      ctrl.aimAt(pie.menuX, pie.menuY, { armDeadzone: 20 });
    }
    applyRingDom();
    scheduleLoop();
  }
});

function finishDrag(e) {
  if (!dragging || e.pointerId !== dragId) return;
  const [px, py] = localCanvasPoint(e);
  const dist = Math.hypot(px - pie.menuX, py - pie.menuY);
  ctrl.aimAt(px, py, { armDeadzone: 20 });
  const armed = pie.activeIdx;
  dragging = false;
  dragId = -1;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}

  if (armed >= 0 && Math.max(dist, dragMaxDist) >= 26) {
    applyCommand(COMMANDS[armed].cmd, armed);
  } else {
    applyRingDom();
    scheduleLoop();
  }
}

canvas.addEventListener('pointerup', finishDrag);
canvas.addEventListener('pointercancel', () => {
  dragging = false;
  dragId = -1;
  scheduleLoop();
});

canvas.addEventListener('pointerleave', () => {
  if (!dragging && pie.open) {
    ctrl.aimAt(pie.menuX, pie.menuY, { armDeadzone: 20 });
    applyRingDom();
    scheduleLoop();
  }
});

btnToggle.addEventListener('click', () => {
  if (pie.open) {
    ctrl.close();
  } else {
    recenterMenu({ bubble: true });
  }
  syncToolbar();
  applyRingDom();
  scheduleLoop();
});

btnCentre.addEventListener('click', () => {
  recenterMenu({ bubble: true });
});

btnResetCard.addEventListener('click', () => {
  applyCommand('reset', 5);
});

reducedCheck.addEventListener('change', () => {
  if (isReduced()) {
    ctrl.snapAll();
    applyRingDom();
  }
  drawFrame(true);
});

reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  if (isReduced()) {
    ctrl.snapAll();
    applyRingDom();
  }
  drawFrame(true);
});

// ---------------------------------------------------------------- Backend startup & visibility
function startBackend() {
  syncWorkspaceCard();
  const cw = canvas.clientWidth || viewportEl.clientWidth || 360;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 360;
  ctrl.openAt(cw * 0.5, ch * 0.5, { bubble: false });
  syncToolbar();
  applyRingDom();

  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available in this browser, so the workspace and pie buttons are shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    hasPainted = true;
    wsDirty = true;
    ringDirty = true;
    if (!rafId && isVisible && !document.hidden) drawFrame();
  });

  const forceRoute = new URLSearchParams(location.search).get('route');

  if (glSupported && forceRoute !== '2d') {
    try {
      stage = new ElementGL(canvas, {
        fragment: PIE_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so the workspace and pie buttons moved to plain HTML.');
            }
          }, 900);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          restoreFromPlain();
          backend = 'webgl';
          hasPainted = true;
          wsDirty = true;
          ringDirty = true;
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
      switchToPlain('Canvas rendering is unavailable here, so the workspace and pie buttons are shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so the workspace and pie buttons moved to plain HTML.');
        }
      }, 900);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      restoreFromPlain();
      backend = '2d';
      hasPainted = true;
      wsDirty = true;
      ringDirty = true;
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
    const [cx, cy] = clampMenuCenter(pie.menuX, pie.menuY);
    pie.menuX = cx;
    pie.menuY = cy;
    unitCache.wsKey = '';
    unitCache.ringKey = '';
    lastGeoSig = '';
    wsDirty = true;
    ringDirty = true;
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

function makePieFixture(w = 280, h = 280) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const ws = document.createElement('div');
  ws.setAttribute('drawable', '');
  ws.style.cssText = `position:relative;width:${w}px;height:${h}px;background:#101520;color:#eef2fb;padding:12px;box-sizing:border-box;font:700 14px system-ui`;
  ws.innerHTML = '<div style="width:120px;height:68px;margin:92px auto 0;border-radius:10px;background:#1b2438;border:1px solid #394867;display:grid;place-items:center">Target</div>';

  const ring = document.createElement('nav');
  ring.setAttribute('drawable', '');
  ring.style.cssText = `position:absolute;left:0;top:0;width:${RING_SIZE}px;height:${RING_SIZE}px;background:transparent`;

  const btns = COMMANDS.map((c, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.cmd = c.cmd;
    b.dataset.idx = String(idx);
    b.textContent = c.label;
    const bx = Math.cos(c.angle) * BTN_RADIUS;
    const by = Math.sin(c.angle) * BTN_RADIUS;
    b.style.cssText =
      `position:absolute;left:50%;top:50%;width:82px;height:42px;border-radius:12px;` +
      `border:1.5px solid rgba(176,196,232,0.45);background:rgba(16,22,36,0.94);color:#f4f6fb;` +
      `font:600 12.5px system-ui;transform:translate(-50%,-50%) translate(${bx.toFixed(1)}px,${by.toFixed(1)}px)`;
    ring.append(b);
    return b;
  });

  cv.append(ws, ring);
  return { cv, ws, ring, btns };
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
    name: 'ElementGL uploads workspace and pie ring via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture with two drawable children on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), renders both passes, and checks gl.getError() === 0 plus pixel output.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280;
      const H = 280;
      const { cv, ws, ring } = makePieFixture(W, H);
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: PIE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const tWs = g.upload(ws);
        const tRing = g.upload(ring);

        const setCommon = (gl, loc) => {
          gl.uniform2f(loc('uCanvasSize'), W, H);
          gl.uniform2f(loc('uRingSize'), RING_SIZE, RING_SIZE);
          gl.uniform2f(loc('uMenuCenter'), W * 0.5, H * 0.5);
          gl.uniform1f(loc('uMenuScale'), 1);
          gl.uniform1f(loc('uMenuAlpha'), 1);
          gl.uniform1f(loc('uPointerAngle'), 0);
          gl.uniform1f(loc('uPointerDist'), BTN_RADIUS);
          gl.uniform1f(loc('uActiveAngle'), 0);
          gl.uniform1f(loc('uActiveIdx'), 0);
          gl.uniform1f(loc('uActivePull'), DETENT_PULL);
          gl.uniform1f(loc('uBeamStrength'), 1);
          gl.uniform1f(loc('uBulge'), 1);
          gl.uniform3f(loc('uAccent'), 1.0, 0.478, 0.302);
        };

        g.quad(ws, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => { gl.uniform1i(loc('uPass'), 0); setCommon(gl, loc); });
        g.quad(ring, ElementGL.rect(cv, W * 0.5 - RING_HALF, H * 0.5 - RING_HALF, RING_SIZE, RING_SIZE), (gl, loc) => { gl.uniform1i(loc('uPass'), 1); setCommon(gl, loc); });

        const err = g.gl.getError();
        const centre = readCssPixel(g.gl, cv, W, H, W * 0.5, H * 0.5);
        const wedge0 = readCssPixel(g.gl, cv, W, H, W * 0.5 + BTN_RADIUS, H * 0.5);
        return need(
          err === g.gl.NO_ERROR && tWs?.w > 0 && tRing?.w > 0 && centre[3] > 200 && wedge0[3] > 200,
          `glErr=${err}, ws=${tWs?.w}x${tWs?.h}, ring=${tRing?.w}x${tRing?.h}, wedge0=[${Array.from(wedge0)}]`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Polar pointer angle (0°, 120°, 240°) shifts selection beam and wedge glow to distinct quadrants',
    expect: 'pass',
    why: 'Renders the pie shader at 0°, 120° and 240° with readPixels() sampling the unobstructed inner beam band (r = 38 px) in each of the three quadrants to prove the active glow follows the pointer angle.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280;
      const H = 280;
      const { cv, ws, ring } = makePieFixture(W, H);
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: PIE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(ws);
        g.upload(ring);

        const sampleAngles = [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3];
        const sampleR = 38;
        const lumAt = (ang) => {
          const px = readCssPixel(
            g.gl, cv, W, H,
            W * 0.5 + Math.cos(ang) * sampleR,
            H * 0.5 + Math.sin(ang) * sampleR
          );
          return px[0] * 1.4 + px[1] * 0.6 + px[2] * 0.2;
        };

        const report = [];
        let allMatched = true;
        for (let k = 0; k < sampleAngles.length; k++) {
          const ang = sampleAngles[k];
          const idx = angleToWedgeIndex(ang);
          g.begin([0, 0, 0, 0]);
          const setCommon = (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform2f(loc('uRingSize'), RING_SIZE, RING_SIZE);
            gl.uniform2f(loc('uMenuCenter'), W * 0.5, H * 0.5);
            gl.uniform1f(loc('uMenuScale'), 1);
            gl.uniform1f(loc('uMenuAlpha'), 1);
            gl.uniform1f(loc('uPointerAngle'), ang);
            gl.uniform1f(loc('uPointerDist'), BTN_RADIUS);
            gl.uniform1f(loc('uActiveAngle'), COMMANDS[idx].angle);
            gl.uniform1f(loc('uActiveIdx'), idx);
            gl.uniform1f(loc('uActivePull'), DETENT_PULL);
            gl.uniform1f(loc('uBeamStrength'), 1);
            gl.uniform1f(loc('uBulge'), 1);
            gl.uniform3f(loc('uAccent'), 1.0, 0.478, 0.302);
          };
          g.quad(ws, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => { gl.uniform1i(loc('uPass'), 0); setCommon(gl, loc); });
          g.quad(ring, ElementGL.rect(cv, W * 0.5 - RING_HALF, H * 0.5 - RING_HALF, RING_SIZE, RING_SIZE), (gl, loc) => { gl.uniform1i(loc('uPass'), 1); setCommon(gl, loc); });

          const vals = sampleAngles.map(lumAt);
          const best = vals.indexOf(Math.max(...vals));
          const otherMax = Math.max(...vals.filter((_, i) => i !== k));
          if (best !== k || vals[k] <= otherMax + 40) allMatched = false;
          report.push(`${Math.round((ang * 180) / Math.PI)}°->[${vals.map((v) => Math.round(v)).join('/')}]`);
        }
        const err = g.gl.getError();
        return need(
          err === g.gl.NO_ERROR && allMatched,
          `glErr=${err}, beam warmth per quadrant: ${report.join(' ')}`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Wedge spring stretch settles deterministically with explicit timestamps and snaps under reduced motion',
    expect: 'pass',
    why: 'Steps createPieState() through openAt(), aimAt(0°), aimAt(120°) and reduced-motion aimAt(240°) with explicit synthetic timestamps, verifying loop termination and exact detent targets.',
    run: async () => {
      let reduced = false;
      const fx = createPieState({ initialX: 180, initialY: 180, isReduced: () => reduced });
      let t = 1000;
      fx.openAt(180, 180, { bubble: true, now: t });
      fx.aimAt(180 + 95, 180, { now: t });

      let steps = 0;
      let moving = true;
      while (moving && steps < 240) {
        t += 16.67;
        moving = fx.step(1 / 60, t);
        steps++;
      }

      const settled0 = !moving
        && fx.s.activeIdx === 0
        && Math.abs(fx.s.menuScale - 1) < 0.002
        && Math.abs(fx.s.wedges[0].pull - DETENT_PULL) < 0.05
        && Math.abs(fx.s.wedges[0].scale - DETENT_SCALE) < 0.005
        && Math.abs(fx.s.wedges[2].pull) < 0.05;
      const pull0 = fx.s.wedges[0].pull;

      fx.aimAt(180 - 48, 180 + 84, { now: t });
      let steps2 = 0;
      let moving2 = true;
      while (moving2 && steps2 < 240) {
        t += 16.67;
        moving2 = fx.step(1 / 60, t);
        steps2++;
      }
      const settled2 = !moving2
        && fx.s.activeIdx === 2
        && Math.abs(fx.s.wedges[0].pull) < 0.05
        && Math.abs(fx.s.wedges[2].pull - DETENT_PULL) < 0.05;
      const pull2 = fx.s.wedges[2].pull;

      reduced = true;
      fx.aimAt(180 - 48, 180 - 84, { now: t });
      const movingReduced = fx.step(1 / 60, t + 16.67);
      const snapped4 = !movingReduced
        && fx.s.activeIdx === 4
        && fx.s.wedges[4].pull === DETENT_PULL
        && fx.s.wedges[2].pull === 0;

      return need(
        settled0 && settled2 && snapped4,
        `0° settled in ${steps} frames (pull=${pull0.toFixed(1)}), 120° settled in ${steps2} frames (pull=${pull2.toFixed(1)}), 240° reduced-motion snapped in 1 step.`
      );
    },
  },
  {
    name: 'updateElementGeometry() + geometryUnit() hits repositioned and pulled wedge <button>',
    expect: 'pass',
    why: 'Repositions #pm-ring to (185, 148) via geometryUnit()-scaled updateElementGeometry(), shifts wedge 2 (120°) outward by its spring detent offset, probes elementsFromPoint() and dispatches a real click.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 320;
      const H = 280;
      const { cv, ws, ring, btns } = makePieFixture(W, H);
      const btn2 = btns[2];
      let clicked = false;
      btn2.addEventListener('click', () => { clicked = true; });
      testStage().append(cv);

      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: PIE_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 0]);
        } else {
          cv.width = W;
          cv.height = H;
          cv.getContext('2d');
        }
        await nextPaint(cv);

        // Shift active wedge 2 (120°) outward with spring detent pull + scale
        const ang2 = COMMANDS[2].angle;
        const r2 = BTN_RADIUS + DETENT_PULL;
        btn2.style.transform = `translate(-50%,-50%) translate(${(Math.cos(ang2) * r2).toFixed(1)}px,${(Math.sin(ang2) * r2).toFixed(1)}px) scale(${DETENT_SCALE})`;
        await nextPaint(cv);

        const menuX = 185;
        const menuY = 148;
        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(ws);
          g.upload(ring);
          const setCommon = (gl, loc) => {
            gl.uniform2f(loc('uCanvasSize'), W, H);
            gl.uniform2f(loc('uRingSize'), RING_SIZE, RING_SIZE);
            gl.uniform2f(loc('uMenuCenter'), menuX, menuY);
            gl.uniform1f(loc('uMenuScale'), 1);
            gl.uniform1f(loc('uMenuAlpha'), 1);
            gl.uniform1f(loc('uPointerAngle'), ang2);
            gl.uniform1f(loc('uPointerDist'), r2);
            gl.uniform1f(loc('uActiveAngle'), ang2);
            gl.uniform1f(loc('uActiveIdx'), 2);
            gl.uniform1f(loc('uActivePull'), DETENT_PULL);
            gl.uniform1f(loc('uBeamStrength'), 1);
            gl.uniform1f(loc('uBulge'), 1);
            gl.uniform3f(loc('uAccent'), 1.0, 0.478, 0.302);
          };
          g.quad(ws, ElementGL.rect(cv, 0, 0, W, H), (gl, loc) => { gl.uniform1i(loc('uPass'), 0); setCommon(gl, loc); });
          g.quad(ring, ElementGL.rect(cv, menuX - RING_HALF, menuY - RING_HALF, RING_SIZE, RING_SIZE), (gl, loc) => { gl.uniform1i(loc('uPass'), 1); setCommon(gl, loc); });
        }

        const uWs = geometryUnit(cv, ws, W);
        const uRing = geometryUnit(cv, ring, RING_SIZE);
        cv.updateElementGeometry(ws, { canvasTransform: new DOMMatrix().scale(uWs, uWs, 1) });
        cv.updateElementGeometry(ring, {
          canvasTransform: new DOMMatrix().scale(uRing, uRing, 1).translate(menuX - RING_HALF, menuY - RING_HALF),
        });
        ring.dataset.hitTick = '1';
        await raf2();

        const bRect = btn2.getBoundingClientRect();
        const cx = bRect.left + bRect.width * 0.5;
        const cy = bRect.top + bRect.height * 0.5;
        const hits = document.elementsFromPoint(cx, cy);
        btn2.click();

        return need(
          hits.includes(btn2) && clicked,
          `elementsFromPoint(${cx.toFixed(1)}, ${cy.toFixed(1)}) hit <button data-cmd="invert"> (geometryUnit=${uRing.toFixed(3)}, rect=${Math.round(bRect.width)}x${Math.round(bRect.height)}, clicked=${clicked}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-argument 2D drawElementImage() fallback work',
    expect: 'pass',
    why: 'Dispatches synthetic webglcontextlost and webglcontextrestored on an ElementGL fixture to verify plain-HTML rescue and WebGL restore, then verifies 5-argument 2D drawElementImage() rendering.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 200;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, ws, ring, btns } = makePieFixture(W, H);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostOk = false;
      let restoredOk = false;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, {
          fragment: PIE_FRAG,
          attributes: { preserveDrawingBuffer: true },
          onLost: () => {
            lostOk = true;
            plain.hidden = false;
            plain.append(ws, ring);
          },
          onRestored: () => {
            restoredOk = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            cv.append(ws, ring);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        g.upload(ws);
        g.upload(ring);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(ring);
        const rRect = btns[0].getBoundingClientRect();
        const plainHits = document.elementsFromPoint(rRect.left + rRect.width * 0.5, rRect.top + rRect.height * 0.5);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        g.begin([0, 0, 0, 0]);
        await nextPaint(cv);
        g.begin([0, 0, 0, 0]);
        const tAfter = g.upload(ring);
        const err = g.gl.getError();

        // Part B: 5-argument 2D drawElementImage() fallback on a fresh drawable canvas
        const cv2d = document.createElement('canvas');
        cv2d.setAttribute('content', 'drawable');
        cv2d.setAttribute('layoutsubtree', '');
        cv2d.style.cssText = `width:${W}px;height:${H}px;display:block`;
        const box2d = document.createElement('div');
        box2d.setAttribute('drawable', '');
        box2d.style.cssText = `width:${W}px;height:${H}px;background:#182235;color:#fff;padding:12px;box-sizing:border-box`;
        box2d.textContent = '2D Fallback Pie';
        cv2d.append(box2d);
        testStage().append(cv2d);
        try {
          const ctx = cv2d.getContext('2d');
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv2d.width = Math.round(W * dpr);
          cv2d.height = Math.round(H * dpr);
          await nextPaint(cv2d);
          ctx.reset();
          ctx.scale(dpr, dpr);
          ctx.drawElementImage(box2d, 0, 0, W, H);
          const copy = document.createElement('canvas');
          copy.width = 120;
          copy.height = 100;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2d, 0, 0, 120, 100);
          const f2d = inkFraction(cc);

          return need(
            inPlain && plainHits.includes(btns[0]) && restoredOk && !g.lost && tAfter?.w > 0 && err === g.gl.NO_ERROR && f2d > 0.5,
            `plainDuringLoss=${inPlain}, plainHit=${plainHits.includes(btns[0])}, restored=${restoredOk}, texAfter=${tAfter?.w}x${tAfter?.h}, glErr=${err}, 2dInk=${(f2d * 100).toFixed(0)}%.`
          );
        } finally {
          cv2d.remove();
          window.__gfx?.retire?.(cv2d);
        }
      } finally {
        await retireFixture(g, wrap, cv, baseActive);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'pie-menu canvas',
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
      rescue: () => switchToPlain('The pie-menu canvas came back blank, so the controls moved to plain HTML.'),
    },
  ]),
];

runTests(checksBody, tests);
