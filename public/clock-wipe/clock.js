import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn, inkFraction } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

// #region clock-controller
export function normalizeDeg(deg) {
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

/** Clockwise polar angle in degrees from 12 o'clock (0° = North, 90° = East, 180° = South, 270° = West). */
export function clockAngleDeg(dx, dy) {
  if (dx === 0 && dy === 0) return 0;
  return normalizeDeg((Math.atan2(dx, -dy) * 180) / Math.PI);
}

export function patternBlades(pattern) {
  if (pattern === 'bow-tie') return 2;
  if (pattern === 'quad-iris') return 4;
  return 1;
}

export function patternIndex(pattern) {
  if (pattern === 'bow-tie') return 1;
  if (pattern === 'quad-iris') return 2;
  return 0;
}

export function isPolarAngleInSceneB(thetaDeg, sweepDeg, pattern) {
  const progress = clamp(sweepDeg / 360, 0, 1);
  if (progress <= 0.0005) return false;
  if (progress >= 0.9995) return true;
  const blades = patternBlades(pattern);
  const period = 360 / blades;
  const bladeSweep = progress * period;
  const local = normalizeDeg(thetaDeg) % period;
  return local <= bladeSweep;
}

export function createSweepController({
  initialAngle = 135,
  initialPattern = 'single',
  initialRefract = 1.15,
  isReduced = () => false,
} = {}) {
  const s = {
    angleDeg: clamp(initialAngle, 0, 360),
    pattern: initialPattern,
    refract: clamp(initialRefract, 0, 2),
    playing: false,
    startMs: 0,
    durationMs: 1400,
    fromDeg: clamp(initialAngle, 0, 360),
    toDeg: 360,
  };

  function setAngle(deg) {
    s.playing = false;
    s.angleDeg = clamp(deg, 0, 360);
    return s.angleDeg;
  }

  function setPattern(pat) {
    s.pattern = pat === 'bow-tie' || pat === 'quad-iris' ? pat : 'single';
    return s.pattern;
  }

  function setRefract(val) {
    s.refract = clamp(val, 0, 2);
    return s.refract;
  }

  function pause() {
    s.playing = false;
  }

  function shiftStart(deltaMs) {
    if (s.playing) s.startMs += deltaMs;
  }

  function startSweep({
    fromDeg = s.angleDeg,
    toDeg = s.angleDeg >= 359 ? 0 : 360,
    durationMs = 1400,
    tMs = performance.now(),
  } = {}) {
    if (isReduced()) {
      s.playing = false;
      s.fromDeg = clamp(fromDeg, 0, 360);
      s.toDeg = clamp(toDeg, 0, 360);
      s.angleDeg = s.toDeg;
      return false;
    }
    s.fromDeg = clamp(fromDeg, 0, 360);
    s.toDeg = clamp(toDeg, 0, 360);
    s.durationMs = Math.max(1, durationMs);
    s.startMs = tMs;
    s.angleDeg = s.fromDeg;
    s.playing = true;
    return true;
  }

  function step(tMs = performance.now()) {
    if (!s.playing) return false;
    if (isReduced()) {
      s.angleDeg = s.toDeg;
      s.playing = false;
      return false;
    }
    const raw = clamp((tMs - s.startMs) / s.durationMs, 0, 1);
    const eased = raw < 0.5
      ? 4 * raw * raw * raw
      : 1 - Math.pow(-2 * raw + 2, 3) / 2;
    s.angleDeg = s.fromDeg + (s.toDeg - s.fromDeg) * eased;
    if (raw >= 1) {
      s.angleDeg = s.toDeg;
      s.playing = false;
      return false;
    }
    return true;
  }

  return { s, setAngle, setPattern, setRefract, pause, shiftStart, startSweep, step };
}
// #endregion clock-controller

// #region clock-shader
export const CLOCK_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;    // #cw-scene-a
uniform sampler2D uTexB;   // #cw-scene-b
uniform vec2 uSize;
uniform float uTime;
uniform vec2 uCanvasSize;
uniform float uSweepDeg;   // 0..360
uniform int uPattern;      // 0 = single hand, 1 = bow-tie, 2 = quad iris
uniform float uRefract;    // 0..2
uniform float uReduced;    // 0 or 1

in vec2 vUv;
out vec4 outColor;

void main() {
  float progress = clamp(uSweepDeg / 360.0, 0.0, 1.0);
  if (progress <= 0.0005) {
    outColor = texture(uTex, vUv);
    return;
  }
  if (progress >= 0.9995) {
    outColor = texture(uTexB, vUv);
    return;
  }

  const float TAU = 6.28318530718;
  vec2 size = max(uCanvasSize, vec2(1.0));
  vec2 pCss = vUv * size;
  vec2 center = size * 0.5;
  vec2 d = pCss - center;
  float r = length(d);

  float rawAng = r > 0.0001 ? atan(d.x, -d.y) : 0.0;
  float theta = rawAng < 0.0 ? rawAng + TAU : rawAng;

  float blades = uPattern == 1 ? 2.0 : (uPattern == 2 ? 4.0 : 1.0);
  float period = TAU / blades;
  float bladeSweep = progress * period;
  float localA = mod(theta, period);

  float signedAng = localA <= bladeSweep
    ? min(localA, bladeSweep - localA)
    : -min(localA - bladeSweep, period - localA);
  float reveal = smoothstep(-0.85, 0.85, signedAng * r);

  float dLead = mod(localA - bladeSweep + period * 0.5, period) - period * 0.5;
  float leadPx = dLead * r;
  float dOrig = mod(localA + period * 0.5, period) - period * 0.5;
  float origPx = dOrig * r;

  float armHalfW = mix(7.0, 22.0, clamp(uRefract * 0.5, 0.0, 1.0));
  float u = leadPx / armHalfW;
  float radialMask = smoothstep(10.0, 18.0, r);
  float armMask = (1.0 - smoothstep(0.70, 1.0, abs(u))) * radialMask;

  vec2 rayNormal = r > 0.001 ? vec2(-d.y, d.x) / r : vec2(1.0, 0.0);
  float bevel = sqrt(max(0.0, 1.0 - u * u));
  float slope = -u / max(0.35, bevel);
  float refractAmp = uRefract * armMask;
  vec2 pxStep = 1.0 / size;
  vec2 bendShift = rayNormal * (slope * 5.2 * refractAmp) * pxStep;
  vec2 dispShift = rayNormal * (3.8 * refractAmp) * pxStep;

  vec2 uvR = clamp(vUv + bendShift + dispShift, 0.001, 0.999);
  vec2 uvG = clamp(vUv + bendShift,             0.001, 0.999);
  vec2 uvB = clamp(vUv + bendShift - dispShift, 0.001, 0.999);

  vec4 aR = texture(uTex, uvR);
  vec4 aG = texture(uTex, uvG);
  vec4 aB = texture(uTex, uvB);
  vec4 bR = texture(uTexB, uvR);
  vec4 bG = texture(uTexB, uvG);
  vec4 bB = texture(uTexB, uvB);

  vec3 backdrop = vec3(0.05, 0.07, 0.11);
  vec3 colA = vec3(aR.r, aG.g, aB.b) + backdrop * (1.0 - aG.a);
  vec3 colB = vec3(bR.r, bG.g, bB.b) + backdrop * (1.0 - bG.a);
  vec3 col = mix(colA, colB, reveal);

  float shimmer = uReduced > 0.5 ? 0.65 : 1.0;
  float shoulder = exp(-pow((abs(u) - 0.52) / 0.28, 2.0)) * radialMask;
  vec3 prismCol = mix(vec3(0.22, 0.78, 1.0), vec3(1.0, 0.54, 0.18), smoothstep(-0.6, 0.6, u));
  col += prismCol * shoulder * (0.28 + 0.34 * clamp(uRefract, 0.0, 2.0)) * shimmer;

  float core = exp(-pow(leadPx / 2.2, 2.0)) * radialMask;
  float outerGlow = exp(-pow(leadPx / 6.5, 2.0)) * radialMask;
  col = mix(col, vec3(0.98, 0.99, 1.0), clamp(core * (0.85 + 0.15 * shimmer), 0.0, 1.0));
  col += vec3(0.45, 0.85, 1.0) * outerGlow * 0.28 * shimmer;

  float origLine = exp(-pow(origPx / 1.35, 2.0)) * radialMask;
  col = mix(col, vec3(0.76, 0.88, 1.0), origLine * 0.45);

  float hubOuter = 1.0 - smoothstep(13.5, 16.0, r);
  float hubRing = exp(-pow((r - 13.5) / 1.5, 2.0));
  float hubGlass = 1.0 - smoothstep(9.0, 12.5, r);
  vec3 hubTint = mix(vec3(0.08, 0.13, 0.22), vec3(0.55, 0.85, 1.0), 0.28 * hubGlass);
  col = mix(col, hubTint, hubOuter * 0.88);
  col += vec3(0.86, 0.96, 1.0) * hubRing * 0.55 * shimmer;

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// #endregion clock-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('cw-stage');
const viewportEl = document.getElementById('cw-viewport');
const canvas = document.getElementById('cw-canvas');
const sceneA = document.getElementById('cw-scene-a');
const sceneB = document.getElementById('cw-scene-b');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const noticeEl = document.getElementById('stage-notice');
const checksBody = document.getElementById('checks-body');

// Scene A controls
const aClockEl = document.getElementById('a-clock');
const aTrainEl = document.getElementById('a-train-readout');
const aDelayEl = document.getElementById('a-delay-readout');
const aDoorsEl = document.getElementById('a-doors-readout');
const aEchoEl = document.getElementById('a-echo');
const aCountEl = document.getElementById('a-count');
const aBtnNW = document.getElementById('a-btn-nw');
const aBtnNE = document.getElementById('a-btn-ne');
const aInputSW = document.getElementById('a-input-sw');
const aBtnSE = document.getElementById('a-btn-se');

// Scene B controls
const bLogEl = document.getElementById('b-log-readout');
const bSpeedEl = document.getElementById('b-speed-readout');
const bBeamEl = document.getElementById('b-beam-readout');
const bEchoEl = document.getElementById('b-echo');
const bCountEl = document.getElementById('b-count');
const bBtnNW = document.getElementById('b-btn-nw');
const bBtnNE = document.getElementById('b-btn-ne');
const bBtnSW = document.getElementById('b-btn-sw');
const bInputSE = document.getElementById('b-input-se');

// Toolbar controls
const patternBtns = Array.from(document.querySelectorAll('.cw-pattern-btn[data-pattern]'));
const btnSweep = document.getElementById('btn-sweep');
const angleSlider = document.getElementById('angle-slider');
const angleOut = document.getElementById('angle-out');
const refractSlider = document.getElementById('refract-slider');
const refractOut = document.getElementById('refract-out');
const reducedCheck = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

const ctrl = createSweepController({
  initialAngle: 135,
  initialPattern: 'single',
  initialRefract: 1.15,
  isReduced,
});
const sweep = ctrl.s;

const TRAINS = ['08:14 Bayside', '08:21 Harbour', '08:29 Northgate', '08:36 Central'];
const sceneAState = { trainIdx: 0, delayMin: 0, doorsHeld: false, taps: 0 };
const sceneBState = { speed: 180, beamHigh: true, cmds: 0 };

let stage = null;
let ctx2d = null;
let backend = 'none';
let hasPainted = false;
let dirtyA = true;
let dirtyB = true;
let texA = null;
let texB = null;
let rafId = 0;
let isVisible = true;
let pausedAtMs = 0;
let lostTimer = 0;
let drag = null;
let lastGeoSig = '';
const unitCache = { keyA: '', unitA: 1, keyB: '', unitB: 1 };

const sceneAHits = [aBtnNW, aBtnNE, aInputSW, aBtnSE];
const sceneBHits = [bBtnNW, bBtnNE, bBtnSW, bInputSE];

function viewportSize() {
  const cw = Math.max(1, canvas.clientWidth || viewportEl.clientWidth || 378);
  const ch = Math.max(1, canvas.clientHeight || viewportEl.clientHeight || 376);
  return { cw, ch };
}

function syncSceneSizes(cw, ch) {
  if (backend === 'plain') {
    for (const el of [sceneA, sceneB]) {
      if (el.style.width) el.style.width = '';
      if (el.style.height) el.style.height = '';
    }
    return;
  }
  const wStr = `${cw}px`;
  const hStr = `${ch}px`;
  for (const el of [sceneA, sceneB]) {
    if (el.style.width !== wStr) el.style.width = wStr;
    if (el.style.height !== hStr) el.style.height = hStr;
  }
}

function controlLocalCenter(el, rootEl) {
  let x = el.offsetLeft + el.offsetWidth * 0.5;
  let y = el.offsetTop + el.offsetHeight * 0.5;
  let p = el.offsetParent;
  while (p && p !== rootEl && rootEl.contains(p)) {
    x += p.offsetLeft;
    y += p.offsetTop;
    p = p.offsetParent;
  }
  return [x, y];
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

function setControlActive(el, active) {
  if (active) {
    el.inert = false;
    el.style.pointerEvents = 'auto';
  } else {
    if (document.activeElement === el) el.blur();
    el.inert = true;
    el.style.pointerEvents = 'none';
  }
}

// #region geometry-sync
function syncGeometry(force = false) {
  if (backend === 'plain' || !hasPainted || typeof canvas.updateElementGeometry !== 'function') return;
  const { cw, ch } = viewportSize();
  syncSceneSizes(cw, ch);

  const aWidth = sceneA.offsetWidth || cw;
  const bWidth = sceneB.offsetWidth || cw;
  const keyA = `${canvas.width}x${canvas.height}/${cw}x${ch}/${aWidth}`;
  if (unitCache.keyA !== keyA) {
    unitCache.unitA = geometryUnit(canvas, sceneA, aWidth);
    unitCache.keyA = keyA;
  }
  const keyB = `${canvas.width}x${canvas.height}/${cw}x${ch}/${bWidth}`;
  if (unitCache.keyB !== keyB) {
    unitCache.unitB = geometryUnit(canvas, sceneB, bWidth);
    unitCache.keyB = keyB;
  }

  const uA = unitCache.unitA || 1;
  const uB = unitCache.unitB || 1;
  const modeEnd = sweep.angleDeg <= 0.1 ? 'A' : sweep.angleDeg >= 359.9 ? 'B' : 'MID';
  const sectorBits = modeEnd === 'MID'
    ? sceneAHits.map((el) => {
        const [lx, ly] = controlLocalCenter(el, sceneA);
        return isPolarAngleInSceneB(clockAngleDeg(lx - cw * 0.5, ly - ch * 0.5), sweep.angleDeg, sweep.pattern) ? 'B' : 'A';
      }).join('')
    : modeEnd;

  const sig = `${backend}:${canvas.width}x${canvas.height}:${cw}x${ch}:${sweep.pattern}:${modeEnd}:${sectorBits}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  if (modeEnd === 'A') {
    sceneA.inert = false;
    sceneB.inert = true;
    for (const el of sceneAHits) setControlActive(el, true);
    for (const el of sceneBHits) setControlActive(el, false);
    canvas.updateElementGeometry(sceneA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
    if (OFFSTAGE) canvas.updateElementGeometry(sceneB, { canvasTransform: OFFSTAGE });
  } else if (modeEnd === 'B') {
    sceneA.inert = true;
    sceneB.inert = false;
    for (const el of sceneAHits) setControlActive(el, false);
    for (const el of sceneBHits) setControlActive(el, true);
    if (OFFSTAGE) canvas.updateElementGeometry(sceneA, { canvasTransform: OFFSTAGE });
    canvas.updateElementGeometry(sceneB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
  } else {
    sceneA.inert = false;
    sceneB.inert = false;
    const cx = cw * 0.5;
    const cy = ch * 0.5;
    for (const el of sceneAHits) {
      const [lx, ly] = controlLocalCenter(el, sceneA);
      const inB = isPolarAngleInSceneB(clockAngleDeg(lx - cx, ly - cy), sweep.angleDeg, sweep.pattern);
      setControlActive(el, !inB);
    }
    for (const el of sceneBHits) {
      const [lx, ly] = controlLocalCenter(el, sceneB);
      const inB = isPolarAngleInSceneB(clockAngleDeg(lx - cx, ly - cy), sweep.angleDeg, sweep.pattern);
      setControlActive(el, inB);
    }
    canvas.updateElementGeometry(sceneA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
    canvas.updateElementGeometry(sceneB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
  }

  sceneA.dataset.hitTick = sceneA.dataset.hitTick === '1' ? '0' : '1';
  sceneB.dataset.hitTick = sceneB.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function syncScenesUI() {
  aTrainEl.textContent = TRAINS[sceneAState.trainIdx];
  aDelayEl.textContent = sceneAState.delayMin ? `Delayed (+${sceneAState.delayMin}m)` : 'On time (+0m)';
  aDoorsEl.textContent = sceneAState.doorsHeld ? 'Doors held' : 'Doors clear';
  aBtnSE.classList.toggle('is-warn', sceneAState.doorsHeld);
  aBtnSE.textContent = sceneAState.doorsHeld ? 'Release doors' : 'Hold doors';
  aClockEl.textContent = `08:${String(14 + sceneAState.delayMin).padStart(2, '0')} · Line 4`;
  aEchoEl.textContent = `Note: ${aInputSW.value || '(empty)'}`;
  aCountEl.textContent = `${sceneAState.taps} ${sceneAState.taps === 1 ? 'tap' : 'taps'}`;

  bLogEl.textContent = `${sceneBState.cmds} ${sceneBState.cmds === 1 ? 'event' : 'events'}`;
  bSpeedEl.textContent = `${sceneBState.speed} km/h`;
  bBeamEl.textContent = sceneBState.beamHigh ? 'Beam: High' : 'Beam: Dim';
  bBtnSW.setAttribute('aria-pressed', String(sceneBState.beamHigh));
  bEchoEl.textContent = `Tag: ${bInputSE.value || '(empty)'}`;
  bCountEl.textContent = `${sceneBState.cmds} ${sceneBState.cmds === 1 ? 'cmd' : 'cmds'}`;
}

function syncToolbarUI() {
  for (const btn of patternBtns) {
    btn.setAttribute('aria-pressed', String(btn.dataset.pattern === sweep.pattern));
  }
  btnSweep.textContent = sweep.playing ? 'Pause' : 'Sweep';
  btnSweep.setAttribute('aria-pressed', String(sweep.playing));
  const degRound = Math.round(sweep.angleDeg);
  angleSlider.value = String(degRound);
  angleOut.textContent = `${degRound}°`;
  refractSlider.value = sweep.refract.toFixed(2);
  refractOut.textContent = `${sweep.refract.toFixed(2)}×`;
}

function updateHud() {
  const route = backend === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : backend === '2d'
      ? '2D drawElementImage() fallback'
      : 'Plain HTML fallback';
  const mp = backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const patLabel = sweep.pattern === 'bow-tie'
    ? 'Bow-tie dual blades'
    : sweep.pattern === 'quad-iris'
      ? 'Quad Iris'
      : 'Single hand';
  hudEl.textContent =
    `Route: ${route} · ${mp} MP · Pattern: ${patLabel} · Angle: ${Math.round(sweep.angleDeg)}° · ` +
    `Refraction: ${sweep.refract.toFixed(2)}× · A taps: ${sceneAState.taps} · B cmds: ${sceneBState.cmds}`;
}

function switchToPlain(reason) {
  backend = 'plain';
  cancelAnimationFrame(rafId);
  rafId = 0;
  ctrl.pause();
  stageBox.classList.add('is-plain');
  sceneA.inert = false;
  sceneB.inert = false;
  for (const el of [...sceneAHits, ...sceneBHits]) {
    el.inert = false;
    el.style.pointerEvents = 'auto';
  }
  syncSceneSizes(0, 0);
  if (sceneA.parentElement !== plainHost) plainHost.append(sceneA);
  if (sceneB.parentElement !== plainHost) plainHost.append(sceneB);
  showNotice(reason);
  syncToolbarUI();
  updateHud();
}

function restoreFromPlain() {
  stageBox.classList.remove('is-plain');
  if (sceneA.parentElement !== canvas) canvas.append(sceneA);
  if (sceneB.parentElement !== canvas) canvas.append(sceneB);
  unitCache.keyA = '';
  unitCache.keyB = '';
  lastGeoSig = '';
  dirtyA = true;
  dirtyB = true;
  texA = null;
  texB = null;
  showNotice('');
}

// #region fallback-2d
function draw2DFallback(cw, ch, forceGeo = false) {
  if (!ctx2d || !hasPainted) return;
  syncSceneSizes(cw, ch);
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  ctx2d.reset();
  ctx2d.scale(dpr, dpr);
  ctx2d.drawElementImage(sceneA, 0, 0, cw, ch);

  const progress = clamp(sweep.angleDeg / 360, 0, 1);
  if (progress > 0.0005) {
    if (progress >= 0.9995) {
      ctx2d.drawElementImage(sceneB, 0, 0, cw, ch);
    } else {
      const cx = cw * 0.5;
      const cy = ch * 0.5;
      const radius = Math.hypot(cw, ch);
      const blades = patternBlades(sweep.pattern);
      const periodRad = (Math.PI * 2) / blades;
      const sweepRad = progress * periodRad;

      ctx2d.save();
      ctx2d.beginPath();
      for (let k = 0; k < blades; k++) {
        const a0 = k * periodRad - Math.PI * 0.5;
        const a1 = a0 + sweepRad;
        ctx2d.moveTo(cx, cy);
        ctx2d.arc(cx, cy, radius, a0, a1);
        ctx2d.closePath();
      }
      ctx2d.clip();
      ctx2d.drawElementImage(sceneB, 0, 0, cw, ch);
      ctx2d.restore();

      const glowWidth = 5 + sweep.refract * 6;
      ctx2d.save();
      for (let k = 0; k < blades; k++) {
        const leadRad = k * periodRad + sweepRad - Math.PI * 0.5;
        const ex = cx + Math.cos(leadRad) * radius;
        const ey = cy + Math.sin(leadRad) * radius;

        ctx2d.beginPath();
        ctx2d.moveTo(cx, cy);
        ctx2d.lineTo(ex, ey);
        ctx2d.strokeStyle = 'rgb(56 189 248 / 0.45)';
        ctx2d.lineWidth = glowWidth;
        ctx2d.stroke();

        ctx2d.beginPath();
        ctx2d.moveTo(cx, cy);
        ctx2d.lineTo(ex, ey);
        ctx2d.strokeStyle = '#ffffff';
        ctx2d.lineWidth = 2.2;
        ctx2d.stroke();
      }

      ctx2d.beginPath();
      ctx2d.arc(cx, cy, 13, 0, Math.PI * 2);
      ctx2d.fillStyle = '#132036';
      ctx2d.fill();
      ctx2d.lineWidth = 2;
      ctx2d.strokeStyle = '#bae6fd';
      ctx2d.stroke();
      ctx2d.restore();
    }
  }

  syncGeometry(forceGeo);
}
// #endregion fallback-2d

function drawFrame({ allowUpload = false, forceGeo = false } = {}) {
  const { cw, ch } = viewportSize();
  if (!cw || !ch || !hasPainted) return;
  syncSceneSizes(cw, ch);

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      if (!stage.begin([0, 0, 0, 0])) return;
      if (allowUpload) {
        if (dirtyA || !texA) {
          texA = stage.upload(sceneA);
          dirtyA = false;
        }
        if (dirtyB || !texB) {
          texB = stage.upload(sceneB);
          dirtyB = false;
        }
      } else if (!texA || !texB || dirtyA || dirtyB) {
        canvas.requestPaint?.();
        if (!texA || !texB) return;
      }

      stage.quad(sceneA, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, texB.tex);
        gl.uniform1i(loc('uTexB'), 1);
        gl.activeTexture(gl.TEXTURE0);
        gl.uniform2f(loc('uCanvasSize'), cw, ch);
        gl.uniform1f(loc('uSweepDeg'), sweep.angleDeg);
        gl.uniform1i(loc('uPattern'), patternIndex(sweep.pattern));
        gl.uniform1f(loc('uRefract'), sweep.refract);
        gl.uniform1f(loc('uReduced'), isReduced() ? 1.0 : 0.0);
      });

      syncGeometry(forceGeo);
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        dirtyA = true;
        dirtyB = true;
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
  const moving = ctrl.step(now);
  syncToolbarUI();
  drawFrame();
  if (moving) {
    rafId = requestAnimationFrame(tick);
  }
}

function scheduleLoop() {
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  if (!rafId && sweep.playing) {
    rafId = requestAnimationFrame(tick);
  }
}

function markSceneDirty(which) {
  if (which === 'a' || which === 'both') dirtyA = true;
  if (which === 'b' || which === 'both') dirtyB = true;
  if (backend === 'plain') {
    updateHud();
    return;
  }
  canvas.requestPaint?.();
}

// ---------------------------------------------------------------- Scene A & B interactions
aBtnNW.addEventListener('click', () => {
  sceneAState.trainIdx = (sceneAState.trainIdx + 1) % TRAINS.length;
  sceneAState.taps++;
  syncScenesUI();
  markSceneDirty('a');
});
aBtnNE.addEventListener('click', () => {
  sceneAState.delayMin = (sceneAState.delayMin + 2) % 12;
  sceneAState.taps++;
  syncScenesUI();
  markSceneDirty('a');
});
aBtnSE.addEventListener('click', () => {
  sceneAState.doorsHeld = !sceneAState.doorsHeld;
  sceneAState.taps++;
  syncScenesUI();
  markSceneDirty('a');
});
aInputSW.addEventListener('input', () => {
  syncScenesUI();
  markSceneDirty('a');
});

bBtnNW.addEventListener('click', () => {
  sceneBState.cmds = 0;
  sceneBState.speed = 180;
  sceneBState.beamHigh = true;
  syncScenesUI();
  markSceneDirty('b');
});
bBtnNE.addEventListener('click', () => {
  sceneBState.speed = sceneBState.speed >= 240 ? 160 : sceneBState.speed + 10;
  sceneBState.cmds++;
  syncScenesUI();
  markSceneDirty('b');
});
bBtnSW.addEventListener('click', () => {
  sceneBState.beamHigh = !sceneBState.beamHigh;
  sceneBState.cmds++;
  syncScenesUI();
  markSceneDirty('b');
});
bInputSE.addEventListener('input', () => {
  syncScenesUI();
  markSceneDirty('b');
});

// ---------------------------------------------------------------- Circular dial scrub + selectstart guard
viewportEl.addEventListener('selectstart', (e) => {
  if (!e.target.closest('input, textarea')) e.preventDefault();
});

function localCanvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || backend === 'plain') return;
  if (e.target instanceof Element && e.target.closest('button, input, textarea, select, label, a')) return;

  cancelAnimationFrame(rafId);
  rafId = 0;
  ctrl.pause();

  const { cw, ch } = viewportSize();
  const [px, py] = localCanvasPoint(e);
  const dx = px - cw * 0.5;
  const dy = py - ch * 0.5;
  const dist = Math.hypot(dx, dy);
  let ptrDeg = clockAngleDeg(dx, dy);

  if (dist >= 12) {
    if (ptrDeg < 12 && sweep.angleDeg > 300) ctrl.setAngle(360);
    else if (ptrDeg > 348 && sweep.angleDeg < 60) ctrl.setAngle(0);
    else ctrl.setAngle(ptrDeg);
  }

  drag = {
    id: e.pointerId,
    lastPtrDeg: ptrDeg,
    accumDeg: sweep.angleDeg,
  };
  try { canvas.setPointerCapture(e.pointerId); } catch {}
  syncToolbarUI();
  drawFrame();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id || backend === 'plain') return;
  const { cw, ch } = viewportSize();
  const [px, py] = localCanvasPoint(e);
  const dx = px - cw * 0.5;
  const dy = py - ch * 0.5;
  if (Math.hypot(dx, dy) < 10) return;

  const curDeg = clockAngleDeg(dx, dy);
  const delta = ((curDeg - drag.lastPtrDeg + 540) % 360) - 180;
  drag.lastPtrDeg = curDeg;
  drag.accumDeg = clamp(drag.accumDeg + delta, -20, 380);
  ctrl.setAngle(clamp(drag.accumDeg, 0, 360));
  syncToolbarUI();
  drawFrame();
});

function finishDialDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  try { canvas.releasePointerCapture(e.pointerId); } catch {}
  syncToolbarUI();
  drawFrame({ forceGeo: true });
}

canvas.addEventListener('pointerup', finishDialDrag);
canvas.addEventListener('pointercancel', finishDialDrag);

// ---------------------------------------------------------------- Toolbar controls
for (const btn of patternBtns) {
  btn.addEventListener('click', () => {
    ctrl.setPattern(btn.dataset.pattern);
    syncToolbarUI();
    drawFrame({ forceGeo: true });
  });
}

btnSweep.addEventListener('click', () => {
  if (sweep.playing) {
    ctrl.pause();
    cancelAnimationFrame(rafId);
    rafId = 0;
    syncToolbarUI();
    drawFrame({ forceGeo: true });
    return;
  }
  const fromDeg = sweep.angleDeg >= 359 ? 360 : sweep.angleDeg <= 1 ? 0 : sweep.angleDeg;
  const toDeg = sweep.angleDeg >= 359 ? 0 : 360;
  const durationMs = Math.max(420, Math.round((Math.abs(toDeg - fromDeg) / 360) * 1450));
  const started = ctrl.startSweep({ fromDeg, toDeg, durationMs, tMs: performance.now() });
  syncToolbarUI();
  drawFrame({ forceGeo: !started });
  if (started) scheduleLoop();
});

angleSlider.addEventListener('input', () => {
  cancelAnimationFrame(rafId);
  rafId = 0;
  ctrl.setAngle(Number(angleSlider.value));
  syncToolbarUI();
  drawFrame();
});

refractSlider.addEventListener('input', () => {
  ctrl.setRefract(Number(refractSlider.value));
  syncToolbarUI();
  drawFrame();
});

reducedCheck.addEventListener('change', () => {
  if (isReduced() && sweep.playing) {
    ctrl.step(performance.now());
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  syncToolbarUI();
  drawFrame({ forceGeo: true });
});

reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  if (isReduced() && sweep.playing) {
    ctrl.step(performance.now());
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  syncToolbarUI();
  drawFrame({ forceGeo: true });
});

// ---------------------------------------------------------------- Backend startup & visibility
function startBackend() {
  syncScenesUI();
  syncToolbarUI();
  const { cw, ch } = viewportSize();
  syncSceneSizes(cw, ch);

  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available in this browser, so both cards are shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', (e) => {
    hasPainted = true;
    if (e?.changedElements?.length) {
      for (const el of e.changedElements) {
        if (el === sceneA || sceneA.contains(el)) dirtyA = true;
        if (el === sceneB || sceneB.contains(el)) dirtyB = true;
      }
    } else {
      dirtyA = true;
      dirtyB = true;
    }
    drawFrame({ allowUpload: true });
  });

  const forceRoute = new URLSearchParams(location.search).get('route');

  if (glSupported && forceRoute !== '2d') {
    try {
      stage = new ElementGL(canvas, {
        fragment: CLOCK_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          texA = null;
          texB = null;
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so both cards moved to plain HTML.');
            }
          }, 900);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          restoreFromPlain();
          backend = 'webgl';
          hasPainted = false;
          const s = viewportSize();
          syncSceneSizes(s.cw, s.ch);
          canvas.requestPaint?.();
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
      switchToPlain('Canvas rendering is unavailable here, so both cards are shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so both cards moved to plain HTML.');
        }
      }, 900);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      restoreFromPlain();
      backend = '2d';
      hasPainted = false;
      const s = viewportSize();
      syncSceneSizes(s.cw, s.ch);
      canvas.requestPaint?.();
    });
  }

  canvas.requestPaint?.();
}

function pauseAnimation() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (sweep.playing && !pausedAtMs) {
    pausedAtMs = performance.now();
  }
}

function resumeAnimation() {
  if (!isVisible || document.hidden || backend === 'plain' || backend === 'none') return;
  if (pausedAtMs) {
    ctrl.shiftStart(performance.now() - pausedAtMs);
    pausedAtMs = 0;
  }
  if (hasPainted) drawFrame();
  if (sweep.playing) scheduleLoop();
}

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    const nowVisible = Boolean(entry && entry.isIntersecting);
    if (nowVisible === isVisible) return;
    isVisible = nowVisible;
    if (isVisible) resumeAnimation();
    else pauseAnimation();
  }, { threshold: 0.01 }).observe(viewportEl);
}

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (backend === 'plain') return;
    unitCache.keyA = '';
    unitCache.keyB = '';
    lastGeoSig = '';
    dirtyA = true;
    dirtyB = true;
    const { cw, ch } = viewportSize();
    syncSceneSizes(cw, ch);
    if (hasPainted) {
      syncGeometry(true);
      canvas.requestPaint?.();
    } else {
      canvas.requestPaint?.();
    }
  }).observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseAnimation();
  else resumeAnimation();
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

function makeClockFixture(w = 280, h = 220) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${w}px;height:${h}px;display:block;position:relative`;

  const makeBtn = (label, cssPos, bg, fg) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText =
      `position:absolute;${cssPos};width:92px;height:36px;border-radius:7px;` +
      `border:1px solid ${fg};background:${bg};color:${fg};font:700 11px system-ui;pointer-events:auto`;
    return b;
  };

  const makeInput = (value, label, cssPos, bg, fg, bd) => {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.setAttribute('inputmode', 'none');
    inp.setAttribute('aria-label', label);
    inp.style.cssText =
      `position:absolute;${cssPos};width:92px;height:36px;padding:4px 6px;box-sizing:border-box;` +
      `border-radius:7px;border:1.5px solid ${bd};background:${bg};color:${fg};font:600 11px system-ui;pointer-events:auto`;
    return inp;
  };

  const fA = document.createElement('section');
  fA.setAttribute('drawable', '');
  fA.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#eadec9;color:#191815;box-sizing:border-box;pointer-events:none`;
  const aBtnNW = makeBtn('A-NW', 'left:10px;top:10px', '#1d222b', '#fbf7ef');
  const aBtnNE = makeBtn('A-NE', 'right:10px;top:10px', '#c84218', '#ffffff');
  const aInputSW = makeInput('Metro A', 'Fixture Scene A note', 'left:10px;bottom:10px', '#ffffff', '#191815', '#b5a389');
  const aBtnSE = makeBtn('A-SE', 'right:10px;bottom:10px', '#1d222b', '#fbf7ef');
  fA.append(aBtnNW, aBtnNE, aInputSW, aBtnSE);

  const fB = document.createElement('section');
  fB.setAttribute('drawable', '');
  fB.style.cssText = `position:absolute;left:0;top:0;width:${w}px;height:${h}px;background:#0b1526;color:#eef4ff;box-sizing:border-box;pointer-events:none`;
  const bBtnNW = makeBtn('B-NW', 'left:10px;top:10px', '#173454', '#e0f2fe');
  const bBtnNE = makeBtn('B-NE', 'right:10px;top:10px', '#0ea5e9', '#061826');
  const bBtnSW = makeBtn('B-SW', 'left:10px;bottom:10px', '#34d399', '#062116');
  const bInputSE = makeInput('Express B', 'Fixture Scene B tag', 'right:10px;bottom:10px', '#091322', '#f8fafc', '#38bdf8');
  fB.append(bBtnNW, bBtnNE, bBtnSW, bInputSE);

  cv.append(fA, fB);
  return { cv, fA, fB, aBtnNW, aBtnNE, aInputSW, aBtnSE, bBtnNW, bBtnNE, bBtnSW, bInputSE };
}

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

const lum = (px) => 0.299 * px[0] + 0.587 * px[1] + 0.114 * px[2];

function drawClockFixture(g, cv, tA, tB, w, h, { sweepDeg, pattern = 0, refract = 1.25, reduced = 0 }) {
  g.begin([0, 0, 0, 1]);
  g.quad(tA.el, ElementGL.rect(cv, 0, 0, w, h), (gl, loc) => {
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tB.tex);
    gl.uniform1i(loc('uTexB'), 1);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(loc('uCanvasSize'), w, h);
    gl.uniform1f(loc('uSweepDeg'), sweepDeg);
    gl.uniform1i(loc('uPattern'), pattern);
    gl.uniform1f(loc('uRefract'), refract);
    gl.uniform1f(loc('uReduced'), reduced);
  });
}

function scanEdgePeak(gl, cv, w, h, cssX, yFrom, yTo) {
  let best = 0;
  for (let y = yFrom; y <= yTo; y++) {
    const p = readCssPixel(gl, cv, w, h, cssX, y);
    best = Math.max(best, lum(p));
  }
  return best;
}

const tests = [
  {
    name: 'ElementGL uploads both HTML scenes via texElementSubImage2D() with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL fixture with two full-stage drawable scenes on testStage(), sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, calls begin() before upload(), renders at 0° and 360°, and verifies gl.getError() === 0.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280;
      const H = 220;
      const { cv, fA, fB } = makeClockFixture(W, H);
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: CLOCK_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        if (!g.begin([0, 0, 0, 1])) throw new Error('ElementGL.begin() returned false');
        const tA = g.upload(fA);
        const tB = g.upload(fB);

        drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: 0 });
        const pxA = readCssPixel(g.gl, cv, W, H, 190, 68);

        drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: 360 });
        const pxB = readCssPixel(g.gl, cv, W, H, 190, 68);

        const err = g.gl.getError();
        return need(
          err === g.gl.NO_ERROR && tA?.w > 0 && tB?.w > 0 && lum(pxA) > 205 && lum(pxB) < 55,
          `glErr=${err}, sceneA=${tA?.w}x${tA?.h} rgb(${pxA.slice(0, 3)}), sceneB=${tB?.w}x${tB?.h} rgb(${pxB.slice(0, 3)}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Polar sector split at 90° and 270° with luminous leading glass arm peak',
    expect: 'pass',
    why: 'Renders Single hand at 90° (NE shows Scene B while NW/SE show Scene A, plus East 90° glass arm luminance peak) and 270° (NE/SE/SW show Scene B while NW stays Scene A, plus West 270° glass arm peak).',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 280;
      const H = 220;
      const { cv, fA, fB } = makeClockFixture(W, H);
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: CLOCK_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tA = g.upload(fA);
        const tB = g.upload(fB);

        drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: 90, pattern: 0, refract: 1.25 });
        const ne90 = lum(readCssPixel(g.gl, cv, W, H, 190, 68));
        const se90 = lum(readCssPixel(g.gl, cv, W, H, 190, 152));
        const nw90 = lum(readCssPixel(g.gl, cv, W, H, 90, 68));
        const arm90 = scanEdgePeak(g.gl, cv, W, H, 210, 106, 114);

        drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: 270, pattern: 0, refract: 1.25 });
        const ne270 = lum(readCssPixel(g.gl, cv, W, H, 190, 68));
        const sw270 = lum(readCssPixel(g.gl, cv, W, H, 90, 152));
        const nw270 = lum(readCssPixel(g.gl, cv, W, H, 90, 68));
        const arm270 = scanEdgePeak(g.gl, cv, W, H, 70, 106, 114);

        const err = g.gl.getError();
        const ok90 = ne90 < 55 && se90 > 205 && nw90 > 205 && arm90 >= 245 && arm90 > nw90 + 12;
        const ok270 = ne270 < 55 && sw270 < 55 && nw270 > 205 && arm270 >= 245 && arm270 > nw270 + 12;

        return need(
          err === g.gl.NO_ERROR && ok90 && ok270,
          `90° NE=${ne90.toFixed(0)} NW=${nw90.toFixed(0)} arm=${arm90.toFixed(0)}; 270° SW=${sw270.toFixed(0)} NW=${nw270.toFixed(0)} arm=${arm270.toFixed(0)} (glErr=${err}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Single hand vs Bow-tie dual blades vs Quad Iris symmetry and tMs sweep timing',
    expect: 'pass',
    why: 'Steps createSweepController() with explicit tMs timestamps (0°, 180° midpoint, 360° end, plus reduced-motion snap) and verifies opposing quadrant symmetry across Single hand, Bow-tie dual blades and Quad Iris at 180°.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      let reduced = false;
      const fx = createSweepController({ initialAngle: 0, isReduced: () => reduced });
      fx.startSweep({ fromDeg: 0, toDeg: 360, durationMs: 1200, tMs: 1000 });
      const mStart = fx.step(1000);
      const deg0 = fx.s.angleDeg;
      const mMid = fx.step(1600);
      const degMid = fx.s.angleDeg;
      const mEnd = fx.step(2200);
      const degEnd = fx.s.angleDeg;
      reduced = true;
      const mRed = fx.startSweep({ fromDeg: 360, toDeg: 0, durationMs: 1200, tMs: 2400 });
      const degSnap = fx.s.angleDeg;

      const timingOk = mStart && Math.abs(deg0) < 0.01 &&
        mMid && Math.abs(degMid - 180) < 0.01 &&
        !mEnd && Math.abs(degEnd - 360) < 0.01 &&
        !mRed && Math.abs(degSnap) < 0.01;

      const W = 280;
      const H = 220;
      const { cv, fA, fB } = makeClockFixture(W, H);
      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, { fragment: CLOCK_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tA = g.upload(fA);
        const tB = g.upload(fB);

        // Single hand at 180°: NE + SE = B, SW + NW = A
        drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: 180, pattern: 0, refract: 1.0 });
        const sNE = lum(readCssPixel(g.gl, cv, W, H, 190, 68));
        const sSE = lum(readCssPixel(g.gl, cv, W, H, 190, 152));
        const sSW = lum(readCssPixel(g.gl, cv, W, H, 90, 152));
        const sNW = lum(readCssPixel(g.gl, cv, W, H, 90, 68));

        // Bow-tie dual blades at 180°: NE + SW = B, SE + NW = A
        drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: 180, pattern: 1, refract: 1.0 });
        const bNE = lum(readCssPixel(g.gl, cv, W, H, 190, 68));
        const bSE = lum(readCssPixel(g.gl, cv, W, H, 190, 152));
        const bSW = lum(readCssPixel(g.gl, cv, W, H, 90, 152));
        const bNW = lum(readCssPixel(g.gl, cv, W, H, 90, 68));

        // Quad Iris at 180° (45° per quadrant): 20° and 200° = B, 70° and 250° = A
        drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: 180, pattern: 2, refract: 1.0 });
        const q20 = lum(readCssPixel(g.gl, cv, W, H, 159, 57));
        const q70 = lum(readCssPixel(g.gl, cv, W, H, 201, 88));
        const q200 = lum(readCssPixel(g.gl, cv, W, H, 121, 163));
        const q250 = lum(readCssPixel(g.gl, cv, W, H, 79, 132));

        const err = g.gl.getError();
        const singleOk = sNE < 55 && sSE < 55 && sSW > 205 && sNW > 205;
        const bowOk = bNE < 55 && bSW < 55 && bSE > 205 && bNW > 205;
        const quadOk = q20 < 55 && q200 < 55 && q70 > 205 && q250 > 205;

        return need(
          timingOk && err === g.gl.NO_ERROR && singleOk && bowOk && quadOk,
          `tMs mid=${degMid.toFixed(0)}°; single(NE=${sNE.toFixed(0)},SW=${sSW.toFixed(0)}); bow-tie(NE=${bNE.toFixed(0)},SW=${bSW.toFixed(0)},SE=${bSE.toFixed(0)}); quad(20°=${q20.toFixed(0)},70°=${q70.toFixed(0)}).`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'updateElementGeometry() hit-testing at 0°, 135° mid-sweep and 360°',
    expect: 'pass',
    why: 'Calibrates geometryUnit() with dataset.hitTick and sector-aware pointer-events on testStage(), checking elementsFromPoint() and clicks on Scene A (0°), mixed NE Scene B vs NW/SW Scene A (135°), and Scene B (360°).',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const W = 280;
      const H = 220;
      const fix = makeClockFixture(W, H);
      const { cv, fA, fB, aBtnNW, aBtnNE, aInputSW, aBtnSE, bBtnNW, bBtnNE, bBtnSW, bInputSE } = fix;
      const fAHits = [aBtnNW, aBtnNE, aInputSW, aBtnSE];
      const fBHits = [bBtnNW, bBtnNE, bBtnSW, bInputSE];

      let aClicks = 0;
      let bClicks = 0;
      aBtnNW.addEventListener('click', () => { aClicks++; });
      bBtnNE.addEventListener('click', () => { bClicks++; });
      bBtnNW.addEventListener('click', () => { bClicks++; });

      testStage().append(cv);
      let g = null;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: CLOCK_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.begin([0, 0, 0, 1]);
        } else {
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv.width = Math.round(W * dpr);
          cv.height = Math.round(H * dpr);
          cv.getContext('2d');
        }
        await nextPaint(cv);

        let tA = null;
        let tB = null;
        if (g) {
          g.begin([0, 0, 0, 1]);
          tA = g.upload(fA);
          tB = g.upload(fB);
        }

        const applyAngle = async (deg) => {
          if (g) {
            drawClockFixture(g, cv, { el: fA, tex: tA.tex }, { el: fB, tex: tB.tex }, W, H, { sweepDeg: deg });
          } else {
            const ctx = cv.getContext('2d');
            const dpr = Math.min(window.devicePixelRatio || 1, 3);
            ctx.reset();
            ctx.scale(dpr, dpr);
            ctx.drawElementImage(deg >= 360 ? fB : fA, 0, 0, W, H);
          }

          const uA = geometryUnit(cv, fA, W);
          const uB = geometryUnit(cv, fB, W);
          if (deg <= 0.1) {
            fA.inert = false;
            fB.inert = true;
            for (const el of fAHits) { el.inert = false; el.style.pointerEvents = 'auto'; }
            for (const el of fBHits) { el.inert = true; el.style.pointerEvents = 'none'; }
            cv.updateElementGeometry(fA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
            if (OFFSTAGE) cv.updateElementGeometry(fB, { canvasTransform: OFFSTAGE });
          } else if (deg >= 359.9) {
            fA.inert = true;
            fB.inert = false;
            for (const el of fAHits) { el.inert = true; el.style.pointerEvents = 'none'; }
            for (const el of fBHits) { el.inert = false; el.style.pointerEvents = 'auto'; }
            if (OFFSTAGE) cv.updateElementGeometry(fA, { canvasTransform: OFFSTAGE });
            cv.updateElementGeometry(fB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
          } else {
            fA.inert = false;
            fB.inert = false;
            const cx = W * 0.5;
            const cy = H * 0.5;
            for (const el of fAHits) {
              const [lx, ly] = controlLocalCenter(el, fA);
              const inB = isPolarAngleInSceneB(clockAngleDeg(lx - cx, ly - cy), deg, 'single');
              el.inert = inB;
              el.style.pointerEvents = inB ? 'none' : 'auto';
            }
            for (const el of fBHits) {
              const [lx, ly] = controlLocalCenter(el, fB);
              const inB = isPolarAngleInSceneB(clockAngleDeg(lx - cx, ly - cy), deg, 'single');
              el.inert = !inB;
              el.style.pointerEvents = inB ? 'auto' : 'none';
            }
            cv.updateElementGeometry(fA, { canvasTransform: new DOMMatrix().scale(uA, uA, 1) });
            cv.updateElementGeometry(fB, { canvasTransform: new DOMMatrix().scale(uB, uB, 1) });
          }
          fA.dataset.hitTick = fA.dataset.hitTick === '1' ? '0' : '1';
          fB.dataset.hitTick = fB.dataset.hitTick === '1' ? '0' : '1';
          await raf2();
        };

        const hit = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };

        await applyAngle(0);
        const h0NW = hit(aBtnNW).includes(aBtnNW);
        const h0In = hit(aInputSW).includes(aInputSW);
        if (h0NW) aBtnNW.click();

        await applyAngle(135);
        const h135B = hit(bBtnNE).includes(bBtnNE) && !hit(bBtnNE).includes(aBtnNE);
        const h135A = hit(aBtnNW).includes(aBtnNW) && !hit(aBtnNW).includes(bBtnNW);
        if (h135B) bBtnNE.click();
        if (h135A) aBtnNW.click();

        await applyAngle(360);
        const h360NW = hit(bBtnNW).includes(bBtnNW);
        const h360In = hit(bInputSE).includes(bInputSE);
        if (h360NW) bBtnNW.click();

        return need(
          h0NW && h0In && h135B && h135A && h360NW && h360In && aClicks === 2 && bClicks === 2,
          `0°(NW=${h0NW},InA=${h0In}); 135°(B_NE=${h135B},A_NW=${h135A}); 360°(NW=${h360NW},InB=${h360In}); clicks A=${aClicks} B=${bClicks}.`
        );
      } finally {
        await retireFixture(g, cv, cv, baseActive);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored and 5-argument 2D wedge clip fallback',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored without calling loseContext(), verifies plain-HTML survival and WebGL restore, then verifies 5-argument 2D drawElementImage() wedge clipping.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const W = 240;
      const H = 150;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const { cv, fA, fB, aBtnNW, bBtnNE } = makeClockFixture(W, H);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let lostOk = false;
      let restoredOk = false;
      const baseActive = window.__gfx?.active?.() ?? 0;
      try {
        g = new ElementGL(cv, {
          fragment: CLOCK_FRAG,
          attributes: { preserveDrawingBuffer: true },
          onLost: () => {
            lostOk = true;
            plain.hidden = false;
            plain.append(fA, fB);
            fA.style.position = 'relative';
            fB.style.position = 'relative';
          },
          onRestored: () => {
            restoredOk = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            plain.hidden = true;
            fA.style.position = 'absolute';
            fB.style.position = 'absolute';
            cv.append(fA, fB);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        g.upload(fA);
        g.upload(fB);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const inPlain = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(fA) && plain.contains(fB);
        const rA = aBtnNW.getBoundingClientRect();
        const rB = bBtnNE.getBoundingClientRect();
        const plainHitA = document.elementsFromPoint(rA.left + rA.width * 0.5, rA.top + rA.height * 0.5).includes(aBtnNW);
        const plainHitB = document.elementsFromPoint(rB.left + rB.width * 0.5, rB.top + rB.height * 0.5).includes(bBtnNE);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tAfterA = g.upload(fA);
        const tAfterB = g.upload(fB);
        const err = g.gl.getError();

        // Part B: 5-argument 2D wedge clip fallback on a fresh drawable canvas
        const cv2d = document.createElement('canvas');
        cv2d.setAttribute('content', 'drawable');
        cv2d.setAttribute('layoutsubtree', '');
        cv2d.style.cssText = `width:${W}px;height:${H}px;display:block`;
        const boxA = document.createElement('div');
        boxA.setAttribute('drawable', '');
        boxA.style.cssText = `width:${W}px;height:${H}px;background:#eadec9`;
        const boxB = document.createElement('div');
        boxB.setAttribute('drawable', '');
        boxB.style.cssText = `width:${W}px;height:${H}px;background:#0b1526`;
        cv2d.append(boxA, boxB);
        testStage().append(cv2d);
        try {
          const ctx = cv2d.getContext('2d');
          const dpr = Math.min(window.devicePixelRatio || 1, 3);
          cv2d.width = Math.round(W * dpr);
          cv2d.height = Math.round(H * dpr);
          await nextPaint(cv2d);

          ctx.reset();
          ctx.scale(dpr, dpr);
          ctx.drawElementImage(boxA, 0, 0, W, H);
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(W * 0.5, H * 0.5);
          ctx.arc(W * 0.5, H * 0.5, Math.hypot(W, H), -Math.PI * 0.5, 0);
          ctx.closePath();
          ctx.clip();
          ctx.drawElementImage(boxB, 0, 0, W, H);
          ctx.restore();

          const copy = document.createElement('canvas');
          copy.width = W;
          copy.height = H;
          const cc = copy.getContext('2d', { willReadFrequently: true });
          cc.drawImage(cv2d, 0, 0, W, H);
          const pxNE = cc.getImageData(Math.round(W * 0.72), Math.round(H * 0.28), 1, 1).data;
          const pxNW = cc.getImageData(Math.round(W * 0.28), Math.round(H * 0.28), 1, 1).data;
          const drawsWrong = window.__gfx?.draws?.wrong ?? 0;
          const drawsNoSize = window.__gfx?.draws?.noSize ?? 0;

          return need(
            inPlain && plainHitA && plainHitB && restoredOk && !g.lost && tAfterA?.w > 0 && tAfterB?.w > 0 &&
              err === g.gl.NO_ERROR && lum(pxNE) < 55 && lum(pxNW) > 205 && drawsWrong === 0 && drawsNoSize === 0,
            `plainLost=${inPlain}, plainHits=${plainHitA}/${plainHitB}, restored=${restoredOk}, glErr=${err}, 2dNE=${lum(pxNE).toFixed(0)}, 2dNW=${lum(pxNW).toFixed(0)}, drawWrong=${drawsWrong}.`
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
      name: 'clock-wipe canvas',
      note: 'plain HTML',
      ink: async () => {
        if (backend === 'plain') return null;
        if (!hasPainted || !canvas.width || !canvas.height) return 0;
        if (backend === 'webgl') {
          if (!stage || stage.lost || !texA || !texB) return 0;
          drawFrame({ forceGeo: true });
        }
        const copy = document.createElement('canvas');
        copy.width = 160;
        copy.height = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(canvas, 0, 0, copy.width, copy.height);
        return inkFraction(cc);
      },
      rescue: () => switchToPlain('The clock-wipe canvas came back blank, so both cards moved to plain HTML.'),
    },
  ]),
];

runTests(checksBody, tests);
