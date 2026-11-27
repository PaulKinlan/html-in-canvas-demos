import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const PANEL_ANGLES = [-0.048, 0.042]; // radians: crisp comic tilt per panel
const HIT_STOP_MS = 35;
const WIPE_SPEEDS = { fast: 190, normal: 320, slow: 760 };

const stageBox = document.getElementById('comic-stage');
const viewportEl = document.getElementById('comic-viewport');
const canvas = document.getElementById('comic-canvas');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('comic-notice');
const hudEl = document.getElementById('comic-hud');
const testsBody = document.getElementById('tests');

const panels = [
  document.getElementById('panel-profile'),
  document.getElementById('panel-loadout'),
];

// External controls
const presetBtns = Array.from(document.querySelectorAll('button[data-preset]'));
const pitchInput = document.getElementById('ctl-pitch');
const pitchOut = document.getElementById('out-pitch');
const spotlightCheck = document.getElementById('ctl-spotlight');
const speedSelect = document.getElementById('ctl-speed');
const reducedCheck = document.getElementById('ctl-reduced');

// Interactive elements inside the drawable panels
const profileCallsignBadge = document.getElementById('profile-callsign-badge');
const profileRankBadge = document.getElementById('profile-rank-badge');
const profileNoteInput = document.getElementById('profile-note');
const barInk = document.getElementById('bar-ink');
const barStyle = document.getElementById('bar-style');
const barVolt = document.getElementById('bar-volt');
const boostBtn = document.getElementById('btn-boost');
const invertBadgeBtn = document.getElementById('btn-invert-badge');

const loadoutCallsignInput = document.getElementById('loadout-callsign');
const loadoutStatusEl = document.getElementById('loadout-status');
const overdriveCheck = document.getElementById('chk-overdrive');
const doubleOutlineCheck = document.getElementById('chk-rim');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };

if (reducedQuery.matches) reducedCheck.checked = true;

// #region halftone-shader
const COMIC_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uOutgoingTex;
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec2 uPanelCenter;
uniform vec2 uPanelSize;
uniform float uPanelAngle;

uniform int uPreset;
uniform float uDotPitch;
uniform float uLightActive;
uniform vec2 uLightPos;
uniform float uReducedMotion;
uniform float uOverdrive;
uniform float uDoubleRim;

uniform float uWipeActive;
uniform float uWipeProgress;
uniform float uWipeDir;
uniform vec2 uOutSize;
uniform float uOutAngle;
uniform float uHasOutgoing;

in vec2 vUv;
out vec4 outColor;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

vec2 invRotate(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x + s * p.y, -s * p.x + c * p.y);
}

// Rotated Ben-Day dot screen: area scales linearly with tonal coverage.
float benDayDot(vec2 cssPx, float angle, float pitch, float coverage) {
  float c = cos(angle);
  float s = sin(angle);
  vec2 rot = vec2(c * cssPx.x - s * cssPx.y, s * cssPx.x + c * cssPx.y);
  vec2 cell = fract(rot / pitch) - 0.5;
  float dist = length(cell);
  float r = sqrt(clamp(coverage, 0.0, 1.0)) * 0.72;
  float aa = 0.85 / max(pitch, 1.0);
  return 1.0 - smoothstep(r - aa, r + aa, dist);
}

vec4 sampleUnpremul(sampler2D tex, vec2 uv) {
  vec4 s = texture(tex, clamp(uv, 0.0, 1.0));
  vec3 rgb = s.a > 0.002 ? clamp(s.rgb / s.a, 0.0, 1.0) : vec3(1.0);
  return vec4(rgb, s.a);
}

vec3 halftoneComposite(
  sampler2D tex,
  vec2 panelUv,
  vec2 panelPx,
  vec2 panelSize,
  float spot,
  float rim
) {
  float pitch = uDotPitch * (uPreset == 2 ? 1.35 : 1.0);
  float regPx = (uPreset == 2 ? 2.4 : uPreset == 1 ? 1.5 : 1.7)
    + rim * 0.9 * uLightActive
    + uDoubleRim * 1.1;

  vec2 offC = vec2(regPx, -regPx * 0.65) / max(panelSize, vec2(1.0));
  vec2 offM = vec2(-regPx, regPx * 0.70) / max(panelSize, vec2(1.0));

  vec3 rgb0 = sampleUnpremul(tex, panelUv).rgb;
  vec3 rgbC = sampleUnpremul(tex, panelUv + offC).rgb;
  vec3 rgbM = sampleUnpremul(tex, panelUv + offM).rgb;

  float grain = hash12(floor(panelPx * 1.1));
  float tooth = (grain - 0.5) * (uPreset == 2 ? 0.055 : 0.032);

  // Subtle spotlight paper brightening and dot-gain modulation around pointer.
  float lightLift = uLightActive * (0.065 * spot - 0.035 * (1.0 - spot));
  float gain = (1.0 + uOverdrive * 0.14)
    * (1.0 + uLightActive * (0.26 * rim - 0.14 * spot + 0.08 * (1.0 - spot)));

  if (uPreset == 1) {
    // Phantom Red-Black Ink: bone paper, crimson accents, stark sumi halftone.
    vec3 bone = clamp(vec3(0.975, 0.953, 0.910) + tooth + lightLift, 0.0, 1.0);
    float lum = dot(rgb0, vec3(0.299, 0.587, 0.114));
    float redness = clamp((rgb0.r - max(rgb0.g, rgb0.b)) * 1.9, 0.0, 1.0);
    float redShift = clamp((rgbC.r - max(rgbC.g, rgbC.b)) * 1.9, 0.0, 1.0);
    float k0 = clamp(1.0 - lum - redness * 0.45, 0.0, 1.0);
    float kShift = clamp(1.0 - dot(rgbM, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);

    float dotRed = benDayDot(panelPx, 0.2618, pitch * 0.95, clamp(redness * 1.05 * gain, 0.0, 1.0));
    float dotInk = benDayDot(panelPx, 0.7854, pitch, clamp(k0 * 1.08 * gain, 0.0, 1.0));
    float solidInk = smoothstep(0.68, 0.90, k0);
    float kMask = max(dotInk, solidInk);

    // Chromatic red outline echo on dark type and borders.
    float redEdge = clamp(max(redShift, kShift * 0.75) - k0, 0.0, 1.0);
    vec3 col = mix(bone, vec3(0.89, 0.08, 0.16), max(dotRed, redness * 0.78));
    col = mix(col, vec3(0.92, 0.10, 0.18), redEdge * 0.85);
    col = mix(col, vec3(0.06, 0.05, 0.07), kMask);
    return col;
  }

  // CMYK separation at 15 deg (C), 75 deg (M), 0 deg (Y), 45 deg (K).
  float k0 = 1.0 - max(rgb0.r, max(rgb0.g, rgb0.b));
  float kC = 1.0 - max(rgbC.r, max(rgbC.g, rgbC.b));
  float kM = 1.0 - max(rgbM.r, max(rgbM.g, rgbM.b));

  float cRaw = (1.0 - rgbC.r - kC) / max(1.0 - kC, 0.001);
  float mRaw = (1.0 - rgbM.g - kM) / max(1.0 - kM, 0.001);
  float yRaw = (1.0 - rgb0.b - k0) / max(1.0 - k0, 0.001);

  // Chromatic ink misregistration on dark text outlines without blurring K.
  float fringeC = max(0.0, kC - k0) * 0.78;
  float fringeM = max(0.0, kM - k0) * 0.78;

  float covC = clamp((cRaw + fringeC) * gain, 0.0, 1.0);
  float covM = clamp((mRaw + fringeM) * gain, 0.0, 1.0);
  float covY = clamp(yRaw * gain, 0.0, 1.0);
  float covK = clamp(k0 * (0.96 + 0.16 * uOverdrive) * (1.0 + uLightActive * 0.18 * rim), 0.0, 1.0);

  float dC = benDayDot(panelPx, 0.261799, pitch, covC); // 15 deg
  float dM = benDayDot(panelPx, 1.308997, pitch, covM); // 75 deg
  float dY = benDayDot(panelPx, 0.0,      pitch, covY); // 0 deg
  float dK = benDayDot(panelPx, 0.785398, pitch, covK); // 45 deg

  // Keep dense key ink solid so fine labels stay sharp at larger dot pitches.
  float solidK = smoothstep(0.72, 0.91, k0);
  dK = max(dK, solidK);

  vec3 paper = uPreset == 2
    ? vec3(0.935, 0.882, 0.768)
    : vec3(0.965, 0.942, 0.892);
  paper = clamp(paper + tooth + lightLift, 0.0, 1.0);

  float inkStr = uPreset == 2 ? 0.90 : 0.97;
  vec3 cInk = uPreset == 2 ? vec3(0.16, 0.72, 0.88) : vec3(0.05, 0.76, 0.96);
  vec3 mInk = uPreset == 2 ? vec3(0.88, 0.18, 0.48) : vec3(0.94, 0.11, 0.53);
  vec3 yInk = uPreset == 2 ? vec3(0.96, 0.83, 0.16) : vec3(1.00, 0.89, 0.08);
  vec3 kInk = uPreset == 2 ? vec3(0.14, 0.12, 0.11) : vec3(0.06, 0.05, 0.07);

  vec3 col = paper;
  col *= mix(vec3(1.0), cInk, dC * inkStr);
  col *= mix(vec3(1.0), mInk, dM * inkStr);
  col *= mix(vec3(1.0), yInk, dY * inkStr);
  col *= mix(vec3(1.0), kInk, dK);
  return col;
}

void main() {
  vec2 pCss = vUv * uCanvasSize;

  float spotDist = length(pCss - uLightPos);
  float spot = exp(-(spotDist * spotDist) / (2.0 * 120.0 * 120.0));
  float rim = exp(-pow((spotDist - 120.0) / 48.0, 2.0));

  // Stage paper & Persona 5 / Spider-Verse halftone backdrop.
  float bgGrain = (hash12(floor(pCss * 0.9)) - 0.5) * 0.028;
  vec3 stageBg = uPreset == 1
    ? vec3(0.77, 0.07, 0.13)
    : uPreset == 2
      ? vec3(0.90, 0.84, 0.73)
      : vec3(0.93, 0.89, 0.82);
  stageBg = clamp(stageBg + bgGrain, 0.0, 1.0);

  // Diagonal action halftone band across the canvas stage.
  float diagBand = smoothstep(0.18, 0.55, sin((pCss.x * 0.75 - pCss.y * 0.65) * 0.025) * 0.5 + 0.5);
  float bgDots = benDayDot(pCss, 0.785398, max(7.0, uDotPitch * 1.45), 0.16 + 0.22 * diagBand);
  vec3 bgDotCol = uPreset == 1
    ? vec3(0.12, 0.03, 0.05)
    : uPreset == 2
      ? vec3(0.76, 0.67, 0.54)
      : vec3(0.84, 0.22, 0.20);
  stageBg = mix(stageBg, bgDotCol, bgDots * (uPreset == 1 ? 0.62 : 0.18));

  if (uLightActive > 0.5) {
    stageBg = mix(stageBg * 0.90, stageBg * 1.08 + vec3(0.03), spot);
  }

  // Transform canvas CSS coordinates into active slanted panel space.
  vec2 q = invRotate(pCss - uPanelCenter, uPanelAngle);
  vec2 halfPanel = uPanelSize * 0.5;

  // Offset comic drop shadow.
  float sdShadow = sdRoundBox(q - vec2(11.0, 13.0), halfPanel + vec2(3.0), 8.0);
  float shadowMask = 1.0 - smoothstep(-1.0, 1.0, sdShadow);
  float shadowDots = benDayDot(q, 0.785398, max(5.5, uDotPitch * 1.1), 0.72);
  vec3 shadowCol = mix(stageBg, vec3(0.06, 0.05, 0.07), 0.88 * max(shadowDots, 1.0 - smoothstep(-8.0, 0.0, sdShadow)));
  vec3 col = mix(stageBg, shadowCol, shadowMask * 0.92);

  // Tilted jagged crimson & black slash frame behind the panel.
  vec2 qFrame = invRotate(pCss - uPanelCenter, uPanelAngle + (uPanelAngle < 0.0 ? -0.055 : 0.055));
  qFrame.x += qFrame.y * 0.06;
  float jagEdge = 5.5 * abs(fract((qFrame.x + qFrame.y) / 44.0) - 0.5);
  float sdSlashOuter = sdRoundBox(qFrame, halfPanel + vec2(12.0, 10.0) + jagEdge, 4.0);
  float sdSlashInner = sdRoundBox(qFrame, halfPanel + vec2(5.0, 4.0), 5.0);
  float slashOuterMask = 1.0 - smoothstep(-1.0, 1.0, sdSlashOuter);
  float slashInnerMask = 1.0 - smoothstep(-1.0, 1.0, sdSlashInner);

  vec3 crimsonSlash = uPreset == 2 ? vec3(0.84, 0.25, 0.16) : vec3(0.89, 0.08, 0.18);
  vec3 frameCol = mix(crimsonSlash, vec3(0.07, 0.06, 0.08), slashInnerMask);
  col = mix(col, frameCol, slashOuterMask);

  // Blade-wipe geometry across the panel & frame.
  vec2 wipeN = normalize(vec2(0.85, 0.52)) * uWipeDir;
  vec2 wipeT = vec2(-wipeN.y, wipeN.x);
  float perp = dot(q, wipeT);
  float jag = 0.065 * (abs(fract(perp / 36.0) - 0.5) * 2.0 - 0.5)
    + 0.025 * sin(perp * 0.16);
  float cutPos = mix(-0.98, 0.98, clamp(uWipeProgress, 0.0, 1.0));
  float diag = dot(q / max(uPanelSize.y, 1.0), wipeN);
  float bladeDist = (diag + jag - cutPos) * uPanelSize.y;

  float useOutgoing = (uWipeActive > 0.5 && uHasOutgoing > 0.5 && bladeDist >= 0.0) ? 1.0 : 0.0;

  // Panel silhouette (outgoing panel shifts slightly when cleaved).
  vec2 outCleavedOffset = useOutgoing > 0.5
    ? vec2(uWipeDir * 14.0 * uWipeProgress, -6.0 * uWipeProgress)
    : vec2(0.0);
  vec2 qPanel = useOutgoing > 0.5
    ? invRotate(pCss - (uPanelCenter + outCleavedOffset), uOutAngle)
    : q;
  vec2 activeSize = useOutgoing > 0.5 ? uOutSize : uPanelSize;
  float sdPanel = sdRoundBox(qPanel, activeSize * 0.5, 8.0);
  float panelMask = 1.0 - smoothstep(-0.85, 0.85, sdPanel);

  // Chromatic ink edge fringe around the outer card border.
  if (uPreset != 1) {
    float sdEdgeC = sdRoundBox(qPanel - vec2(-2.6, -1.6), activeSize * 0.5 + 1.0, 8.0);
    float sdEdgeM = sdRoundBox(qPanel - vec2(2.6, 1.6), activeSize * 0.5 + 1.0, 8.0);
    float fringeC = (1.0 - smoothstep(-1.0, 1.0, sdEdgeC)) * (1.0 - panelMask);
    float fringeM = (1.0 - smoothstep(-1.0, 1.0, sdEdgeM)) * (1.0 - panelMask);
    col = mix(col, vec3(0.06, 0.74, 0.94), fringeC * 0.55);
    col = mix(col, vec3(0.92, 0.12, 0.52), fringeM * 0.55);
  }

  if (panelMask > 0.002) {
    vec2 pPx = qPanel + activeSize * 0.5;
    vec2 pUv = pPx / max(activeSize, vec2(1.0));
    vec3 printed = useOutgoing > 0.5
      ? halftoneComposite(uOutgoingTex, pUv, pPx, activeSize, spot, rim)
      : halftoneComposite(uTex, pUv, pPx, activeSize, spot, rim);

    // Bold comic ink panel frame border.
    float border = smoothstep(-4.0, -2.5, sdPanel) * panelMask;
    printed = mix(printed, vec3(0.06, 0.05, 0.07), border);
    col = mix(col, printed, panelMask);
  }

  // Jagged diagonal crimson/white blade ribbon during transition.
  if (uWipeActive > 0.5 && uReducedMotion < 0.5) {
    float nearPanel = 1.0 - smoothstep(10.0, 62.0, sdPanel);
    float bladeCore = 1.0 - smoothstep(2.0, 5.0, abs(bladeDist));
    float bladeCrimson = 1.0 - smoothstep(5.0, 13.5, abs(bladeDist));
    vec3 slashHue = uPreset == 1 ? vec3(1.0, 0.95, 0.88) : vec3(0.94, 0.10, 0.22);
    col = mix(col, slashHue, bladeCrimson * nearPanel * 0.92);
    col = mix(col, vec3(1.0, 0.99, 0.96), bladeCore * nearPanel);
  }

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// #endregion halftone-shader

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

const state = {
  preset: 0, // 0: Spider-Verse CMYK, 1: Phantom Red-Black Ink, 2: Sunday Funnies
  dotPitch: Number(pitchInput.value),
  spotlight: spotlightCheck.checked,
  wipeSpeed: speedSelect.value,
  reducedOverride: reducedCheck.checked,
  activePanel: 0,
  boostCount: 0,
  dispatchCount: 0,
  badgeInverted: false,
  lightX: 160,
  lightY: 160,
  lightHasPointer: false,
  mode: 'init', // 'webgl' | '2d' | 'plain'
  onScreen: true,
  wipeActive: false,
  wipeStart: 0,
  wipeDir: 1,
  outSize: { w: 312, h: 360 },
  outAngle: PANEL_ANGLES[0],
  hasOutgoing: false,
  unitCache: { key: '', unit: 1 },
  lastGeoKey: null,
  uploads: 0,
  paints: 0,
};

let stage = null;
let glExtra = null;
let ctx2d = null;
let rafId = 0;
const panelTextures = new Map();

export function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function getWipeDuration() {
  return WIPE_SPEEDS[state.wipeSpeed] ?? WIPE_SPEEDS.normal;
}

// #region fbo-wipe
export function computeWipeMotion(elapsedMs, durationMs, reduced) {
  if (reduced || durationMs <= 0) {
    return { wipeProgress: 1, shakeX: 0, shakeY: 0, active: false };
  }
  const total = HIT_STOP_MS + durationMs;
  if (elapsedMs >= total) {
    return { wipeProgress: 1, shakeX: 0, shakeY: 0, active: false };
  }
  // 35 ms hit-stop impulse holds the slash briefly at impact before slicing across.
  let wipeProgress;
  if (elapsedMs < HIT_STOP_MS) {
    wipeProgress = 0.14 * (elapsedMs / HIT_STOP_MS);
  } else {
    const u = Math.min(1, (elapsedMs - HIT_STOP_MS) / durationMs);
    const eased = 1 - Math.pow(1 - u, 3);
    wipeProgress = 0.14 + 0.86 * eased;
  }
  // Damped directional camera jolt decaying inside ~180 ms.
  const decay = Math.exp(-elapsedMs * 0.022);
  const amp = 5.2 * decay;
  const shakeX = Math.sin(elapsedMs * 0.19) * amp;
  const shakeY = Math.cos(elapsedMs * 0.24) * amp * 0.75;
  return { wipeProgress, shakeX, shakeY, active: true };
}

function createWipeResources(gl) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || 'Copy shader compile error');
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, COPY_VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, COPY_FRAG));
  gl.bindAttribLocation(prog, 0, 'aPos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(prog) || 'Copy program link error');
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

function captureOutgoingFBO(gl, res, srcTexObj, panelW, panelH, panelAngle) {
  if (!res || !srcTexObj) return false;
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

  state.outSize = { w: panelW, h: panelH };
  state.outAngle = panelAngle;
  state.hasOutgoing = true;
  return true;
}
// #endregion fbo-wipe

// #region geometry-sync
function computePanelLayout() {
  const cw = canvas.clientWidth || viewportEl.clientWidth || 356;
  const ch = canvas.clientHeight || viewportEl.clientHeight || 460;
  const pw = Math.round(Math.min(390, Math.max(248, cw - 40)));
  for (const p of panels) {
    const target = `${pw}px`;
    if (p.style.width !== target) p.style.width = target;
  }
  const activeEl = panels[state.activePanel];
  const ph = activeEl.offsetHeight || 356;
  const motion = state.wipeActive
    ? computeWipeMotion(performance.now() - state.wipeStart, getWipeDuration(), isReducedMotion())
    : { wipeProgress: 1, shakeX: 0, shakeY: 0, active: false };
  if (!motion.active) state.wipeActive = false;
  const cx = cw * 0.5 + motion.shakeX;
  const cy = ch * 0.5 + motion.shakeY;
  const angle = PANEL_ANGLES[state.activePanel];
  return { cw, ch, pw, ph, cx, cy, angle, motion };
}

export function buildPanelMatrix(cx, cy, pw, ph, angleRad) {
  return new DOMMatrix()
    .translate(cx, cy)
    .rotate((angleRad * 180) / Math.PI)
    .translate(-pw * 0.5, -ph * 0.5);
}

function cachedGeometryUnit(activeEl, pw) {
  const zoom = activeEl.currentCSSZoom || 1;
  const key = `${canvas.width}x${canvas.height}/${canvas.clientWidth}x${canvas.clientHeight}/${pw}/${zoom}`;
  if (state.unitCache.key !== key) {
    state.unitCache.unit = geometryUnit(canvas, activeEl, pw);
    state.unitCache.key = key;
    state.lastGeoKey = null;
  }
  return state.unitCache.unit;
}

function syncPanelGeometry(layout, force = false) {
  if (!('updateElementGeometry' in HTMLCanvasElement.prototype) || state.mode === 'plain') return;
  const activeEl = panels[state.activePanel];
  const inactiveEl = panels[1 - state.activePanel];
  if (OFFSTAGE) {
    canvas.updateElementGeometry(inactiveEl, { canvasTransform: OFFSTAGE });
  }
  if (state.mode !== 'webgl') return;
  const cssMat = buildPanelMatrix(layout.cx, layout.cy, layout.pw, layout.ph, layout.angle);
  const unit = cachedGeometryUnit(activeEl, layout.pw);
  const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
  const vals = scaled.toFloat32Array();
  if (!force && state.lastGeoKey && vals.every((v, i) => Math.abs(v - state.lastGeoKey[i]) < 1e-4)) return;
  state.lastGeoKey = vals;
  canvas.updateElementGeometry(activeEl, { canvasTransform: scaled });
  activeEl.dataset.hitTick = activeEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function updateHud() {
  const modeName = state.mode === 'webgl' ? 'WebGL 2 CMYK' : state.mode === '2d' ? '2D fallback' : 'Plain HTML';
  const presetName = ['Spider-Verse CMYK', 'Phantom Red-Black', 'Sunday Funnies'][state.preset];
  const activeName = state.activePanel === 0 ? 'Profile' : 'Loadout';
  const rmText = isReducedMotion() ? ' · reduced motion (0 px shake)' : '';
  hudEl.textContent = `${modeName} · ${presetName} · ${activeName} · ${state.dotPitch.toFixed(1)} px dots${rmText}`;
}

function enterPlainFallback(reason) {
  state.mode = 'plain';
  state.wipeActive = false;
  cancelAnimationFrame(rafId);
  rafId = 0;
  stageBox.classList.add('is-plain');
  for (const p of panels) {
    p.style.width = '';
    if (p.parentElement !== plainHost) plainHost.append(p);
  }
  showNotice(reason);
  updateHud();
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  for (const p of panels) {
    if (p.parentElement !== canvas) canvas.append(p);
  }
  showNotice('');
}

function tryUploadPanel(el) {
  if (!stage || stage.lost) return null;
  try {
    const t = stage.upload(el);
    panelTextures.set(el, t);
    state.uploads++;
    return t;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return panelTextures.get(el) ?? null;
    }
    throw err;
  }
}

function renderWebGL() {
  if (!stage || stage.lost) return;
  const layout = computePanelLayout();
  const activeEl = panels[state.activePanel];
  const uploaded = tryUploadPanel(activeEl);
  if (!uploaded) return;

  // Warm the second panel once so the first blade-wipe transition never waits on a cold paint.
  const otherEl = panels[1 - state.activePanel];
  if (!panelTextures.has(otherEl)) {
    try {
      const warm = stage.upload(otherEl);
      if (warm) panelTextures.set(otherEl, warm);
    } catch {}
  }

  if (!stage.begin([0, 0, 0, 0])) return;
  syncPanelGeometry(layout);

  const gl = stage.gl;
  const lightX = state.lightHasPointer ? state.lightX : layout.cw * 0.36;
  const lightY = state.lightHasPointer ? state.lightY : layout.ch * 0.32;

  stage.quad(activeEl, ElementGL.rect(canvas, 0, 0, layout.cw, layout.ch), (g, loc) => {
    g.activeTexture(g.TEXTURE1);
    g.bindTexture(g.TEXTURE_2D, glExtra?.tex ?? uploaded.tex);
    g.uniform1i(loc('uOutgoingTex'), 1);

    g.uniform2f(loc('uCanvasSize'), layout.cw, layout.ch);
    g.uniform2f(loc('uPanelCenter'), layout.cx, layout.cy);
    g.uniform2f(loc('uPanelSize'), layout.pw, layout.ph);
    g.uniform1f(loc('uPanelAngle'), layout.angle);

    g.uniform1i(loc('uPreset'), state.preset);
    g.uniform1f(loc('uDotPitch'), state.dotPitch);
    g.uniform1f(loc('uLightActive'), state.spotlight ? 1 : 0);
    g.uniform2f(loc('uLightPos'), lightX, lightY);
    g.uniform1f(loc('uReducedMotion'), isReducedMotion() ? 1 : 0);
    g.uniform1f(loc('uOverdrive'), overdriveCheck.checked ? 1 : 0);
    g.uniform1f(loc('uDoubleRim'), doubleOutlineCheck.checked ? 1 : 0);

    g.uniform1f(loc('uWipeActive'), layout.motion.active ? 1 : 0);
    g.uniform1f(loc('uWipeProgress'), layout.motion.wipeProgress);
    g.uniform1f(loc('uWipeDir'), state.wipeDir);
    g.uniform2f(loc('uOutSize'), state.outSize.w, state.outSize.h);
    g.uniform1f(loc('uOutAngle'), state.outAngle);
    g.uniform1f(loc('uHasOutgoing'), state.hasOutgoing ? 1 : 0);
  });

  state.paints++;
  updateHud();
}

// #region fallback-2d
function render2DFallback() {
  if (!ctx2d) return;
  const layout = computePanelLayout();
  const activeEl = panels[state.activePanel];
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(layout.cw * dpr));
  const bh = Math.max(1, Math.round(layout.ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  syncPanelGeometry(layout);

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = state.preset === 1 ? '#c41222' : state.preset === 2 ? '#e6d8bd' : '#ede4d1';
  ctx2d.fillRect(0, 0, layout.cw, layout.ch);

  // Slanted shadow and crimson comic frame behind the panel.
  ctx2d.save();
  ctx2d.translate(layout.cx, layout.cy);
  ctx2d.rotate(layout.angle);
  ctx2d.fillStyle = '#110f14';
  ctx2d.fillRect(-layout.pw * 0.5 + 10, -layout.ph * 0.5 + 12, layout.pw, layout.ph);
  ctx2d.rotate(layout.angle < 0 ? -0.05 : 0.05);
  ctx2d.fillStyle = '#e3172b';
  ctx2d.fillRect(-layout.pw * 0.5 - 8, -layout.ph * 0.5 - 8, layout.pw + 16, layout.ph + 16);
  ctx2d.restore();

  // Draw live active HTML panel with explicit 5-argument CSS dimensions.
  ctx2d.save();
  ctx2d.translate(layout.cx, layout.cy);
  ctx2d.rotate(layout.angle);
  ctx2d.drawElementImage(activeEl, -layout.pw * 0.5, -layout.ph * 0.5, layout.pw, layout.ph);
  ctx2d.strokeStyle = '#110f14';
  ctx2d.lineWidth = 3;
  ctx2d.strokeRect(-layout.pw * 0.5, -layout.ph * 0.5, layout.pw, layout.ph);
  ctx2d.restore();

  ctx2d.restore();
  state.paints++;
  updateHud();
}
// #endregion fallback-2d

function scheduleWipeLoop() {
  if (rafId || !state.wipeActive || !state.onScreen || document.hidden) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (!state.wipeActive || !state.onScreen) return;
    canvas.requestPaint?.();
    scheduleWipeLoop();
  });
}

function requestDraw() {
  if (state.mode === 'plain') {
    updateHud();
    return;
  }
  canvas.requestPaint?.();
}

function updateNavAria(activeIdx) {
  for (const p of panels) {
    for (const btn of p.querySelectorAll('.comic-tab')) {
      const isCurrent = Number(btn.dataset.tab) === activeIdx;
      if (isCurrent) btn.setAttribute('aria-current', 'page');
      else btn.removeAttribute('aria-current');
    }
  }
}

export function switchPanel(nextIdx, { moveFocus = false } = {}) {
  if (nextIdx === state.activePanel) return;
  const prevIdx = state.activePanel;
  const outEl = panels[prevIdx];
  const inEl = panels[nextIdx];

  if (state.mode === 'webgl' && stage && !stage.lost && glExtra && !isReducedMotion()) {
    const outTex = panelTextures.get(outEl) ?? tryUploadPanel(outEl);
    if (outTex) {
      captureOutgoingFBO(
        stage.gl,
        glExtra,
        outTex,
        outEl.offsetWidth || 312,
        outEl.offsetHeight || 356,
        PANEL_ANGLES[prevIdx]
      );
      state.wipeDir = nextIdx > prevIdx ? 1 : -1;
      state.wipeStart = performance.now();
      state.wipeActive = true;
    }
  } else {
    state.wipeActive = false;
  }

  state.activePanel = nextIdx;
  outEl.inert = true;
  inEl.inert = false;
  outEl.dataset.active = 'false';
  inEl.dataset.active = 'true';
  updateNavAria(nextIdx);
  state.lastGeoKey = null;

  if (moveFocus) {
    const targetBtn = inEl.querySelector(`.comic-tab[data-tab="${nextIdx}"]`);
    targetBtn?.focus({ preventScroll: true });
  }

  if (state.mode !== 'plain') {
    syncPanelGeometry(computePanelLayout(), true);
    requestDraw();
    scheduleWipeLoop();
  } else {
    updateHud();
  }
}

// Initialise rendering backend: WebGL 2 via ElementGL first, then 2D fallback, else plain HTML.
if (hicSupported && glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: COMIC_FRAG,
      onLost: () => {
        panelTextures.clear();
        glExtra = null;
        enterPlainFallback('The WebGL 2 context was lost. Showing the semantic panels as plain HTML until restored.');
      },
      onRestored: () => {
        glExtra = createWipeResources(stage.gl);
        state.mode = 'webgl';
        exitPlainFallback();
        state.lastGeoKey = null;
        requestDraw();
      },
    });
    glExtra = createWipeResources(stage.gl);
    state.mode = 'webgl';
  } catch (err) {
    stage = null;
    glExtra = null;
    showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
  }
}

if (!stage && hicSupported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.mode = '2d';
    if (noticeEl.hidden) {
      showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 2D drawElementImage() fallback.');
    }
  }
}

if (!stage && !ctx2d) {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the semantic panels are shown as plain HTML.');
}

canvas.addEventListener('paint', () => {
  if (state.mode === 'webgl' && stage && !stage.lost) renderWebGL();
  else if (state.mode === '2d' && ctx2d) render2DFallback();
});

new IntersectionObserver(([entry]) => {
  state.onScreen = entry.isIntersecting;
  if (!state.onScreen) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  } else if (state.mode !== 'plain') {
    requestDraw();
    scheduleWipeLoop();
  }
}).observe(stageBox);

new ResizeObserver(() => {
  if (state.mode !== 'plain') {
    state.unitCache.key = '';
    state.lastGeoKey = null;
    requestDraw();
  }
}).observe(canvas);

// Pointer spotlight: works from pointerdown on touch and resets when touch ends.
const updatePointerSpot = (e) => {
  if (!state.spotlight || state.mode !== 'webgl') return;
  const r = canvas.getBoundingClientRect();
  if (!r.width || !r.height) return;
  state.lightX = e.clientX - r.left;
  state.lightY = e.clientY - r.top;
  state.lightHasPointer = true;
  requestDraw();
};

canvas.addEventListener('pointerdown', (e) => {
  updatePointerSpot(e);
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse' || e.buttons > 0) updatePointerSpot(e);
});
canvas.addEventListener('pointerup', (e) => {
  if (e.pointerType !== 'mouse') {
    state.lightHasPointer = false;
    requestDraw();
  }
});
canvas.addEventListener('pointercancel', () => {
  state.lightHasPointer = false;
  requestDraw();
});
canvas.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') {
    state.lightHasPointer = false;
    requestDraw();
  }
});

// Panel <nav> tabs & interactive controls inside both panels.
for (const p of panels) {
  p.addEventListener('click', (e) => {
    const tab = e.target.closest('.comic-tab');
    if (tab) {
      switchPanel(Number(tab.dataset.tab), { moveFocus: true });
    }
  });
}

boostBtn.addEventListener('click', () => {
  state.boostCount++;
  boostBtn.textContent = `Boost signal (${state.boostCount})`;
  const inkW = 60 + ((state.boostCount * 17) % 38);
  const styleW = 72 + ((state.boostCount * 13) % 26);
  const voltW = 54 + ((state.boostCount * 23) % 44);
  barInk.style.width = `${inkW}%`;
  barStyle.style.width = `${styleW}%`;
  barVolt.style.width = `${voltW}%`;
  profileRankBadge.textContent = `SYNC ${84 + (state.boostCount % 16)}%`;
  requestDraw();
});

invertBadgeBtn.addEventListener('click', () => {
  state.badgeInverted = !state.badgeInverted;
  panels[0].classList.toggle('badge-inverted', state.badgeInverted);
  requestDraw();
});

profileNoteInput.addEventListener('input', () => {
  requestDraw();
});

loadoutCallsignInput.addEventListener('input', () => {
  const clean = loadoutCallsignInput.value.trim() || 'PHANTOM-01';
  profileCallsignBadge.textContent = clean.toUpperCase();
  requestDraw();
});

panels[1].addEventListener('change', () => {
  const chosen = panels[1].querySelector('input[name="tactic"]:checked')?.value ?? 'All-Out';
  loadoutStatusEl.textContent = `Ready: ${chosen}`;
  requestDraw();
});

panels[1].addEventListener('submit', (e) => {
  e.preventDefault();
  state.dispatchCount++;
  const chosen = panels[1].querySelector('input[name="tactic"]:checked')?.value ?? 'All-Out';
  const callsign = loadoutCallsignInput.value.trim() || 'PHANTOM-01';
  loadoutStatusEl.textContent = `Sent #${state.dispatchCount}: ${chosen} (${callsign})`;
  requestDraw();
});

// External toolbar controls.
for (const btn of presetBtns) {
  btn.addEventListener('click', () => {
    state.preset = Number(btn.dataset.preset);
    for (const b of presetBtns) b.setAttribute('aria-pressed', String(b === btn));
    requestDraw();
  });
}

pitchInput.addEventListener('input', () => {
  state.dotPitch = Number(pitchInput.value);
  pitchOut.textContent = `${state.dotPitch.toFixed(1)} px`;
  requestDraw();
});

spotlightCheck.addEventListener('change', () => {
  state.spotlight = spotlightCheck.checked;
  requestDraw();
});

speedSelect.addEventListener('change', () => {
  state.wipeSpeed = speedSelect.value;
  updateHud();
});

reducedCheck.addEventListener('change', () => {
  state.reducedOverride = reducedCheck.checked;
  if (isReducedMotion()) state.wipeActive = false;
  requestDraw();
});

reducedQuery.addEventListener?.('change', () => {
  reducedCheck.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) state.wipeActive = false;
  requestDraw();
});

// Initial sync and first paint.
panels[0].inert = false;
panels[1].inert = true;
updateNavAria(0);
if (state.mode !== 'plain') {
  syncPanelGeometry(computePanelLayout(), true);
  requestDraw();
} else {
  updateHud();
}

// ---------------------------------------------------------------- live checks (isolated fixtures on testStage)
const need = (ok, text) => { if (!ok) throw new Error(text); return text; };

const tests = [
  {
    name: 'ElementGL + texElementSubImage2D() renders CMYK halftone pass with gl.getError() === 0',
    expect: 'pass',
    why: 'Builds an isolated ElementGL canvas on testStage(), uploads a colourful DOM child via texElementSubImage2D(), runs COMIC_FRAG and checks gl.getError() and halftone ink variation.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:160px;height:120px;display:block';
      const child = document.createElement('div');
      child.setAttribute('drawable', '');
      child.style.cssText = 'width:130px;height:90px;padding:8px;box-sizing:border-box;background:linear-gradient(90deg,#00a6d6,#e6192e,#ffd200);color:#141214;font:700 14px system-ui';
      child.textContent = 'INK';
      cv.append(child);
      testStage().append(cv);

      let g = null;
      try {
        g = new ElementGL(cv, { fragment: COMIC_FRAG, attributes: { preserveDrawingBuffer: true } });
        await nextPaint(cv);
        const uploaded = g.upload(child);
        g.begin([0, 0, 0, 0]);
        g.quad(child, ElementGL.rect(cv, 0, 0, 160, 120), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, uploaded.tex);
          gl.uniform1i(loc('uOutgoingTex'), 1);
          gl.uniform2f(loc('uCanvasSize'), 160, 120);
          gl.uniform2f(loc('uPanelCenter'), 80, 60);
          gl.uniform2f(loc('uPanelSize'), 130, 90);
          gl.uniform1f(loc('uPanelAngle'), -0.05);
          gl.uniform1i(loc('uPreset'), 0);
          gl.uniform1f(loc('uDotPitch'), 5.5);
          gl.uniform1f(loc('uLightActive'), 1);
          gl.uniform2f(loc('uLightPos'), 80, 60);
          gl.uniform1f(loc('uReducedMotion'), 0);
          gl.uniform1f(loc('uOverdrive'), 0);
          gl.uniform1f(loc('uDoubleRim'), 0);
          gl.uniform1f(loc('uWipeActive'), 0);
          gl.uniform1f(loc('uWipeProgress'), 1);
          gl.uniform1f(loc('uWipeDir'), 1);
          gl.uniform2f(loc('uOutSize'), 130, 90);
          gl.uniform1f(loc('uOutAngle'), -0.05);
          gl.uniform1f(loc('uHasOutgoing'), 0);
        });
        const err = g.gl.getError();
        const patch = new Uint8Array(24 * 24 * 4);
        const rx = Math.max(0, Math.floor(cv.width * 0.5) - 12);
        const ry = Math.max(0, Math.floor(cv.height * 0.5) - 12);
        g.gl.readPixels(rx, ry, 24, 24, g.gl.RGBA, g.gl.UNSIGNED_BYTE, patch);
        let minLum = 255, maxLum = 0;
        for (let i = 0; i < patch.length; i += 4) {
          const lum = 0.299 * patch[i] + 0.587 * patch[i + 1] + 0.114 * patch[i + 2];
          if (lum < minLum) minLum = lum;
          if (lum > maxLum) maxLum = lum;
        }
        return need(
          err === g.gl.NO_ERROR && uploaded && (maxLum - minLum) > 25,
          `gl.getError()=${err}, uploaded ${uploaded?.w}x${uploaded?.h}, halftone luma span ${Math.round(minLum)}..${Math.round(maxLum)}/255.`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Tab switch captures outgoing panel to FBO, runs diagonal wipe and leaves incoming !inert',
    expect: 'pass',
    why: 'Captures panel 0 into an off-screen GPU framebuffer, switches to panel 1, draws a mid-wipe frame and checks incoming panel inert state.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = 'width:220px;height:150px;display:block;position:relative';

      const makePanel = (bg, label, tabIdx, active) => {
        const p = document.createElement('section');
        p.setAttribute('drawable', '');
        p.inert = !active;
        p.style.cssText = `position:absolute;left:0;top:0;width:180px;height:120px;padding:8px;box-sizing:border-box;background:${bg};color:#111`;
        const nav = document.createElement('nav');
        const b0 = document.createElement('button'); b0.type = 'button'; b0.textContent = 'P0';
        const b1 = document.createElement('button'); b1.type = 'button'; b1.textContent = 'P1';
        nav.append(b0, b1);
        const tag = document.createElement('div');
        tag.textContent = label;
        p.append(nav, tag);
        return { p, nav, b0, b1, tabIdx };
      };

      const p0 = makePanel('#00b4d8', 'OUTGOING', 0, true);
      const p1 = makePanel('#ffd200', 'INCOMING', 1, false);
      cv.append(p0.p, p1.p);
      testStage().append(cv);

      let g = null;
      let res = null;
      try {
        g = new ElementGL(cv, { fragment: COMIC_FRAG, attributes: { preserveDrawingBuffer: true } });
        res = createWipeResources(g.gl);
        await nextPaint(cv);
        const t0 = g.upload(p0.p);
        captureOutgoingFBO(g.gl, res, t0, 180, 120, PANEL_ANGLES[0]);

        p0.p.inert = true;
        p1.p.inert = false;
        cv.updateElementGeometry?.(p0.p, { canvasTransform: OFFSTAGE });
        const unit = geometryUnit(cv, p1.p, 180);
        const m = buildPanelMatrix(110, 75, 180, 120, PANEL_ANGLES[1]);
        cv.updateElementGeometry?.(p1.p, { canvasTransform: new DOMMatrix().scale(unit, unit, 1).multiply(m) });
        await nextPaint(cv);
        g.upload(p1.p);

        g.begin([0, 0, 0, 0]);
        g.quad(p1.p, ElementGL.rect(cv, 0, 0, 220, 150), (gl, loc) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, res.tex);
          gl.uniform1i(loc('uOutgoingTex'), 1);
          gl.uniform2f(loc('uCanvasSize'), 220, 150);
          gl.uniform2f(loc('uPanelCenter'), 110, 75);
          gl.uniform2f(loc('uPanelSize'), 180, 120);
          gl.uniform1f(loc('uPanelAngle'), PANEL_ANGLES[1]);
          gl.uniform1i(loc('uPreset'), 0);
          gl.uniform1f(loc('uDotPitch'), 5.0);
          gl.uniform1f(loc('uLightActive'), 0);
          gl.uniform2f(loc('uLightPos'), 110, 75);
          gl.uniform1f(loc('uReducedMotion'), 0);
          gl.uniform1f(loc('uOverdrive'), 0);
          gl.uniform1f(loc('uDoubleRim'), 0);
          gl.uniform1f(loc('uWipeActive'), 1);
          gl.uniform1f(loc('uWipeProgress'), 0.5);
          gl.uniform1f(loc('uWipeDir'), 1);
          gl.uniform2f(loc('uOutSize'), 180, 120);
          gl.uniform1f(loc('uOutAngle'), PANEL_ANGLES[0]);
          gl.uniform1f(loc('uHasOutgoing'), 1);
        });
        const err = g.gl.getError();
        const leftPatch = new Uint8Array(8 * 8 * 4);
        const rightPatch = new Uint8Array(8 * 8 * 4);
        const ly = Math.max(0, Math.floor(cv.height * 0.5) - 4);
        g.gl.readPixels(Math.max(0, Math.floor(cv.width * 0.25) - 4), ly, 8, 8, g.gl.RGBA, g.gl.UNSIGNED_BYTE, leftPatch);
        g.gl.readPixels(Math.max(0, Math.floor(cv.width * 0.75) - 4), ly, 8, 8, g.gl.RGBA, g.gl.UNSIGNED_BYTE, rightPatch);
        const avg = (buf, chIdx) => {
          let sum = 0;
          for (let i = chIdx; i < buf.length; i += 4) sum += buf[i];
          return sum / (buf.length / 4);
        };
        const diff = Math.abs(avg(leftPatch, 0) - avg(rightPatch, 0)) + Math.abs(avg(leftPatch, 2) - avg(rightPatch, 2));
        return need(
          err === g.gl.NO_ERROR && p0.p.inert === true && p1.p.inert === false && diff > 25,
          `p0.inert=${p0.p.inert}, p1.inert=${p1.p.inert}, FBO ${res.w}x${res.h}, wipe left/right delta=${diff.toFixed(1)}.`
        );
      } finally {
        if (res && g && !g.lost) {
          const gl = g.gl;
          gl.deleteFramebuffer(res.fbo);
          gl.deleteTexture(res.tex);
          gl.deleteBuffer(res.vbo);
          gl.deleteVertexArray(res.vao);
          gl.deleteProgram(res.prog);
        }
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Slanted updateElementGeometry() scaled by geometryUnit() hits <nav> button and <input>',
    expect: 'pass',
    why: 'Applies a rotated DOMMatrix scaled by geometryUnit() to an isolated fixture panel and probes document.elementsFromPoint() at the transformed centres of its <nav> button and <input>.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const cw = 260, ch = 190, pw = 210, ph = 140;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `width:${cw}px;height:${ch}px;display:block;position:relative`;

      const panel = document.createElement('div');
      panel.setAttribute('drawable', '');
      panel.style.cssText = `position:absolute;left:0;top:0;width:${pw}px;height:${ph}px;padding:10px;box-sizing:border-box;background:#faf5ea`;
      const nav = document.createElement('nav');
      nav.style.cssText = 'display:flex;gap:8px;margin-bottom:12px';
      const navBtn = document.createElement('button');
      navBtn.type = 'button';
      navBtn.textContent = 'Tab 1';
      navBtn.style.cssText = 'height:36px;min-width:84px;padding:0 10px';
      nav.append(navBtn);

      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('inputmode', 'none');
      input.value = 'CALLSIGN';
      input.style.cssText = 'display:block;width:160px;height:36px;box-sizing:border-box';
      panel.append(nav, input);
      cv.append(panel);
      testStage().append(cv);

      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: COMIC_FRAG });
        }
        await nextPaint(cv);
        if (g) {
          const tex = g.upload(panel);
          g.begin([0, 0, 0, 0]);
          g.quad(panel, ElementGL.rect(cv, 0, 0, cw, ch), (gl, loc) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tex.tex);
            gl.uniform1i(loc('uOutgoingTex'), 1);
            gl.uniform2f(loc('uCanvasSize'), cw, ch);
            gl.uniform2f(loc('uPanelCenter'), cw * 0.5, ch * 0.5);
            gl.uniform2f(loc('uPanelSize'), pw, ph);
            gl.uniform1f(loc('uPanelAngle'), -0.065);
            gl.uniform1i(loc('uPreset'), 0);
            gl.uniform1f(loc('uDotPitch'), 5.5);
            gl.uniform1f(loc('uLightActive'), 0);
            gl.uniform2f(loc('uLightPos'), cw * 0.5, ch * 0.5);
            gl.uniform1f(loc('uReducedMotion'), 1);
            gl.uniform1f(loc('uOverdrive'), 0);
            gl.uniform1f(loc('uDoubleRim'), 0);
            gl.uniform1f(loc('uWipeActive'), 0);
            gl.uniform1f(loc('uWipeProgress'), 1);
            gl.uniform1f(loc('uWipeDir'), 1);
            gl.uniform2f(loc('uOutSize'), pw, ph);
            gl.uniform1f(loc('uOutAngle'), -0.065);
            gl.uniform1f(loc('uHasOutgoing'), 0);
          });
        }
        const cssMat = buildPanelMatrix(cw * 0.5, ch * 0.5, pw, ph, -0.065);
        const unit = geometryUnit(cv, panel, pw);
        const scaled = new DOMMatrix().scale(unit, unit, 1).multiply(cssMat);
        cv.updateElementGeometry(panel, { canvasTransform: scaled });
        panel.dataset.hitTick = '1';

        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const localCenter = (el) => {
          let x = el.offsetWidth * 0.5;
          let y = el.offsetHeight * 0.5;
          let cur = el;
          while (cur && cur !== panel) {
            x += cur.offsetLeft;
            y += cur.offsetTop;
            cur = cur.offsetParent;
          }
          return { x, y };
        };

        const cRect = cv.getBoundingClientRect();
        const navPt = cssMat.transformPoint(new DOMPoint(localCenter(navBtn).x, localCenter(navBtn).y));
        const inpPt = cssMat.transformPoint(new DOMPoint(localCenter(input).x, localCenter(input).y));
        const navHits = document.elementsFromPoint(cRect.left + navPt.x, cRect.top + navPt.y);
        const inpHits = document.elementsFromPoint(cRect.left + inpPt.x, cRect.top + inpPt.y);

        const navOk = navHits.includes(navBtn);
        const inpOk = inpHits.includes(input);
        return need(
          navOk && inpOk,
          `geometryUnit=${unit.toFixed(2)}; nav <button> hit=${navOk} at (${navPt.x.toFixed(1)}, ${navPt.y.toFixed(1)}); <input> hit=${inpOk} at (${inpPt.x.toFixed(1)}, ${inpPt.y.toFixed(1)}).`
        );
      } finally {
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'prefers-reduced-motion: reduce suppresses hit-stop shake amplitude to 0 px',
    expect: 'pass',
    why: 'Samples computeWipeMotion() across the 35 ms hit-stop window and full wipe with reduced=false vs reduced=true, confirming 0 px shake and immediate completion.',
    run: async () => {
      const samples = [0, 12, 24, 35, 90, 180, 320];
      let normalPeak = 0;
      let reducedPeak = 0;
      let anyReducedActive = false;
      for (const t of samples) {
        const normal = computeWipeMotion(t, WIPE_SPEEDS.normal, false);
        const reduced = computeWipeMotion(t, WIPE_SPEEDS.normal, true);
        normalPeak = Math.max(normalPeak, Math.hypot(normal.shakeX, normal.shakeY));
        reducedPeak = Math.max(reducedPeak, Math.hypot(reduced.shakeX, reduced.shakeY));
        if (reduced.active || reduced.wipeProgress !== 1) anyReducedActive = true;
      }
      return need(
        normalPeak > 1.5 && reducedPeak === 0 && !anyReducedActive,
        `Normal peak shake=${normalPeak.toFixed(2)} px; reduced-motion peak shake=${reducedPeak.toFixed(2)} px, instant wipe=true.`
      );
    },
  },
  stillDrawn(() => [
    {
      name: 'kinetic comic stage',
      ink: async () => {
        if (state.mode === 'plain') return null;
        if (state.mode === 'webgl') {
          if (!stage || stage.lost || !panelTextures.has(panels[state.activePanel])) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return state.uploads > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
    },
  ]),
];

runTests(testsBody, tests);
