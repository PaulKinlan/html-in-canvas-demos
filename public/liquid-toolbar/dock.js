import { banner, supported as hicSupported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;

const FULL_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

// #region blur-fbo
const BLUR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uStep;
in vec2 vUv;
out vec4 outColor;

void main() {
  // 9-tap separable Gaussian weights (sum = 1.0)
  vec4 acc = texture(uSrc, clamp(vUv, vec2(0.001), vec2(0.999))) * 0.227027;
  acc += texture(uSrc, clamp(vUv + uStep * 1.0, vec2(0.001), vec2(0.999))) * 0.194595;
  acc += texture(uSrc, clamp(vUv - uStep * 1.0, vec2(0.001), vec2(0.999))) * 0.194595;
  acc += texture(uSrc, clamp(vUv + uStep * 2.0, vec2(0.001), vec2(0.999))) * 0.121622;
  acc += texture(uSrc, clamp(vUv - uStep * 2.0, vec2(0.001), vec2(0.999))) * 0.121622;
  acc += texture(uSrc, clamp(vUv + uStep * 3.0, vec2(0.001), vec2(0.999))) * 0.054054;
  acc += texture(uSrc, clamp(vUv - uStep * 3.0, vec2(0.001), vec2(0.999))) * 0.054054;
  acc += texture(uSrc, clamp(vUv + uStep * 4.0, vec2(0.001), vec2(0.999))) * 0.016216;
  acc += texture(uSrc, clamp(vUv - uStep * 4.0, vec2(0.001), vec2(0.999))) * 0.016216;
  outColor = acc;
}`;

function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader error: ${log || 'compile failed'}`);
  }
  return s;
}

function linkProgram(gl, vsSrc, fsSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.linkProgram(p);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error(`Program link error: ${log || 'link failed'}`);
  }
  return p;
}

function createFbo(gl, w, h) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fbo, tex, w, h };
}

function resizeFbo(gl, entry, w, h) {
  if (entry.w === w && entry.h === h) return;
  entry.w = w;
  entry.h = h;
  gl.bindTexture(gl.TEXTURE_2D, entry.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

export class BlurPass {
  constructor(gl, w, h) {
    this.gl = gl;
    this.w = Math.max(32, w);
    this.h = Math.max(32, h);
    this.vao = gl.createVertexArray();
    this.prog = linkProgram(gl, FULL_VERT, BLUR_FRAG);
    this.uSrc = gl.getUniformLocation(this.prog, 'uSrc');
    this.uStep = gl.getUniformLocation(this.prog, 'uStep');
    this.fboA = createFbo(gl, this.w, this.h);
    this.fboB = createFbo(gl, this.w, this.h);
  }

  resize(w, h) {
    const nw = Math.max(32, w);
    const nh = Math.max(32, h);
    if (nw === this.w && nh === this.h) return;
    this.w = nw;
    this.h = nh;
    resizeFbo(this.gl, this.fboA, nw, nh);
    resizeFbo(this.gl, this.fboB, nw, nh);
  }

  render(srcTex) {
    const gl = this.gl;
    if (!gl || gl.isContextLost() || !srcTex) return null;

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.uSrc, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fbo);
    gl.viewport(0, 0, this.w, this.h);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform2f(this.uStep, 2.2 / this.w, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
    gl.uniform2f(this.uStep, 0.0, 2.2 / this.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.fboB.tex);
    gl.uniform2f(this.uStep, 4.2 / this.w, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
    gl.uniform2f(this.uStep, 0.0, 4.2 / this.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Always unbind offscreen FBO and VAO before drawing to the screen.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    return this.fboB.tex;
  }

  dispose() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    gl.deleteFramebuffer(this.fboA.fbo);
    gl.deleteTexture(this.fboA.tex);
    gl.deleteFramebuffer(this.fboB.fbo);
    gl.deleteTexture(this.fboB.tex);
    gl.deleteProgram(this.prog);
    gl.deleteVertexArray(this.vao);
  }
}
// #endregion blur-fbo

// #region glass-shader
// Evaluates the exact analytic gradient and distance of a rounded capsule SDF,
// refracts #lt-feed with RGB chromatic dispersion along the bevelled rim, blends
// a frosted offscreen blur underlay, adds specular glints, and composites crisp
// premultiplied #lt-dock controls on top at 1:1 CSS pixels.
export const LIQUID_GLASS_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;      // #lt-feed
uniform sampler2D uDockTex;  // #lt-dock
uniform sampler2D uBlurTex;  // blurred #lt-feed from offscreen FBO
uniform vec2 uSize;
uniform float uTime;

uniform vec2 uCanvasSize;
uniform vec4 uDockGeom;      // cx, cy, sdfW, sdfH (CSS px)
uniform vec2 uDockLayout;    // exact #lt-dock CSS layout size
uniform float uDockRadius;   // capsule corner radius (CSS px)
uniform int uMode;           // 0 = liquid refraction, 1 = flat frosted glass, 2 = magnify x1.4
uniform float uDepth;        // refraction depth (0..40 CSS px)

in vec2 vUv;
out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r, out vec2 grad) {
  float rr = min(r, min(b.x, b.y));
  vec2 inner = max(b - vec2(rr), vec2(0.0));
  vec2 q = abs(p) - inner;
  vec2 s = vec2(p.x < 0.0 ? -1.0 : 1.0, p.y < 0.0 ? -1.0 : 1.0);
  if (q.x > 0.0 && q.y > 0.0) {
    float len = length(q);
    grad = s * (q / max(len, 1e-6));
    return len - rr;
  } else if (q.x > q.y) {
    grad = vec2(s.x, 0.0);
    return q.x - rr;
  } else {
    grad = vec2(0.0, s.y);
    return q.y - rr;
  }
}

vec3 sampleSharp(vec2 cssPos) {
  vec2 uv = clamp(cssPos / max(uCanvasSize, vec2(1.0)), vec2(0.001), vec2(0.999));
  return texture(uTex, uv).rgb;
}

vec3 sampleBlur(vec2 cssPos) {
  vec2 uv = clamp(cssPos / max(uCanvasSize, vec2(1.0)), vec2(0.001), vec2(0.999));
  return texture(uBlurTex, uv).rgb;
}

void main() {
  vec2 pCss = vUv * uCanvasSize;
  vec3 feedCol = sampleSharp(pCss);

  vec2 grad = vec2(0.0);
  float d = sdRoundBox(pCss - uDockGeom.xy, uDockGeom.zw * 0.5, uDockRadius, grad);

  // Soft ambient shadow cast onto #lt-feed beneath the floating capsule.
  vec2 tmpG;
  float dShadow = sdRoundBox(pCss - (uDockGeom.xy + vec2(0.0, 5.5)), uDockGeom.zw * 0.5, uDockRadius, tmpG);
  float shadow = exp(-max(dShadow, 0.0) * 0.085) * 0.36;
  vec3 outsideRgb = feedCol * (1.0 - shadow * (1.0 - smoothstep(-1.0, 1.0, d)));

  if (d >= 1.2) {
    outColor = vec4(clamp(outsideRgb, 0.0, 1.0), 1.0);
    return;
  }

  float depthInside = max(0.0, -d);
  float rimW = min(uDockRadius * 0.85, 20.0);
  float depthFactor = clamp(uDepth / 22.0, 0.0, 1.85);
  vec2 rel = pCss - uDockGeom.xy;
  vec3 glassRgb = vec3(0.0);

  if (uMode == 1) {
    // Mode 1: Flat frosted glass (no UV bending, no magnification, no dispersion).
    vec3 sharp = sampleSharp(pCss);
    vec3 frosted = sampleBlur(pCss);
    glassRgb = mix(sharp, frosted, 0.94);
    glassRgb = mix(glassRgb, vec3(0.14, 0.14, 0.15), 0.34);
    float edgeLine = exp(-abs(d + 0.7) * 1.9);
    glassRgb = mix(glassRgb, vec3(0.88, 0.89, 0.91), edgeLine * 0.28);
  } else {
    // Mode 0 (Liquid refraction) or Mode 2 (Magnify x1.4)
    // Monotonic bevel slope keeps d(pos)/d(pCss) > 0 everywhere so text curves smoothly
    // around the capsule meniscus without stretching into vertical streaks.
    float t = clamp(depthInside / max(rimW, 1.0), 0.0, 1.0);
    float oneMinusT = 1.0 - t;
    float slope = 1.65 * pow(oneMinusT, 1.15) * depthFactor;

    vec3 N = normalize(vec3(grad * slope, 1.0));
    float hSlab = uDepth * 0.74;

    float mag = (uMode == 2) ? 1.40 : (1.0 + 0.12 * clamp(depthFactor, 0.0, 1.5));
    vec2 magPos = uDockGeom.xy + rel / mag;

    float iorG = 1.52;
    float disp = (uMode == 2 ? 0.095 : 0.085) * depthFactor;
    vec3 rR = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / (iorG - disp));
    vec3 rG = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / iorG);
    vec3 rB = refract(vec3(0.0, 0.0, -1.0), N, 1.0 / (iorG + disp));

    vec2 posR = magPos + (rR.xy / max(-rR.z, 0.35)) * hSlab;
    vec2 posG = magPos + (rG.xy / max(-rG.z, 0.35)) * hSlab;
    vec2 posB = magPos + (rB.xy / max(-rB.z, 0.35)) * hSlab;

    vec3 sharpRefr = vec3(sampleSharp(posR).r, sampleSharp(posG).g, sampleSharp(posB).b);
    vec3 blurRefr = vec3(sampleBlur(posR).r, sampleBlur(posG).g, sampleBlur(posB).b);

    float rimBand = 1.0 - smoothstep(0.0, rimW * 0.9, depthInside);
    float clarity = (uMode == 2) ? 0.88 : mix(0.40, 0.84, rimBand);
    glassRgb = mix(blurRefr, sharpRefr, clarity);

    // Subtle smoked glass body tint keeps crisp white dock labels legible over bright thumbs.
    glassRgb = mix(glassRgb, vec3(0.07, 0.10, 0.17), uMode == 2 ? 0.22 : 0.28);

    // Specular rim glints and Fresnel sky reflection from the analytic capsule normal.
    float rimGlow = exp(-pow((depthInside - 1.15) / 2.2, 2.0));
    float topFacing = pow(clamp(dot(grad, vec2(0.0, -1.0)), 0.0, 1.0), 1.5);
    float botFacing = pow(clamp(dot(grad, vec2(0.0, 1.0)), 0.0, 1.0), 2.3);
    float fresnel = 0.04 + 0.96 * pow(clamp(1.0 - N.z, 0.0, 1.0), 3.2);

    glassRgb += vec3(0.96, 0.98, 1.0) * (topFacing * 0.56 + botFacing * 0.24) * rimGlow * (0.45 + 0.55 * depthFactor);
    glassRgb += vec3(0.68, 0.84, 1.0) * fresnel * 0.28 * (1.0 - t);
    glassRgb = mix(glassRgb, vec3(0.94, 0.97, 1.0), exp(-abs(d + 0.65) * 1.9) * 0.38);
  }

  // Composite sharp premultiplied #lt-dock UI at 1:1 CSS layout coordinates on top.
  vec2 dockOrigin = uDockGeom.xy - uDockLayout * 0.5;
  vec2 dockLocal = pCss - dockOrigin;
  if (dockLocal.x >= 0.0 && dockLocal.x <= uDockLayout.x && dockLocal.y >= 0.0 && dockLocal.y <= uDockLayout.y) {
    vec2 uvDock = dockLocal / max(uDockLayout, vec2(1.0));
    vec4 dockTexel = texture(uDockTex, uvDock);
    glassRgb = dockTexel.rgb + glassRgb * (1.0 - dockTexel.a);
  }

  float mask = 1.0 - smoothstep(-0.85, 0.85, d);
  vec3 finalRgb = mix(outsideRgb, glassRgb, mask);
  outColor = vec4(clamp(finalRgb, 0.0, 1.0), 1.0);
}`;
// #endregion glass-shader

// #region spring-physics
export function stepSpring(spring, target, stiffness, damping, dt) {
  const stepSize = 1 / 120;
  const clampedDt = Math.min(dt, 0.05);
  for (let rem = clampedDt; rem > 1e-6; rem -= stepSize) {
    const h = Math.min(rem, stepSize);
    const acc = stiffness * (target - spring.x) - damping * spring.v;
    spring.v += acc * h;
    spring.x += spring.v * h;
  }
  const done = Math.abs(target - spring.x) < 0.02 && Math.abs(spring.v) < 0.08;
  if (done) {
    spring.x = target;
    spring.v = 0;
  }
  return !done;
}

export function stepDockSprings(anim, target, reduced, dt) {
  if (reduced) {
    anim.dockX.x = target.dockX; anim.dockX.v = 0;
    anim.dockY.x = target.dockY; anim.dockY.v = 0;
    anim.pillX.x = target.pillX; anim.pillX.v = 0;
    anim.pillStretch.x = 1; anim.pillStretch.v = 0;
    anim.capsuleStretch.x = 1; anim.capsuleStretch.v = 0;
    return false;
  }

  let moving = false;
  if (target.dragging) {
    anim.dockX.x = target.dockX;
    anim.dockX.v = target.dragVx;
    anim.dockY.x = target.dockY;
    anim.dockY.v = target.dragVy;
    moving = true;
  } else {
    moving = stepSpring(anim.dockX, target.dockX, 340, 28, dt) || moving;
    moving = stepSpring(anim.dockY, target.dockY, 340, 28, dt) || moving;
  }

  moving = stepSpring(anim.pillX, target.pillX, 380, 26, dt) || moving;

  const speedStretch = 1 + clamp(Math.abs(anim.pillX.v) * 0.00055, 0, 0.34);
  const dragPillStretch = target.dragging ? 1 + clamp(Math.abs(target.dragVx) * 0.00045, 0, 0.32) : 1;
  const targetPillStretch = Math.max(speedStretch, dragPillStretch);
  moving = stepSpring(anim.pillStretch, targetPillStretch, 320, 20, dt) || moving;

  const targetCapStretch = target.dragging ? 1 + clamp(Math.abs(target.dragVx) * 0.00012, 0, 0.065) : 1;
  moving = stepSpring(anim.capsuleStretch, targetCapStretch, 280, 22, dt) || moving;

  return moving;
}
// #endregion spring-physics

const MODES = {
  liquid: { id: 0, label: 'Liquid refraction' },
  frosted: { id: 1, label: 'Flat frosted glass' },
  magnify: { id: 2, label: 'Magnify x1.4' },
};

const TABS = ['foryou', 'saved', 'compose'];

const EXTRA_CARD_THEMES = [
  { thumb: 'p-aurora', tagA: 'DISPATCH', tagB: 'LIVE', dotA: '#22d3ee', labelA: 'Cyan', dotB: '#10b981', labelB: 'Mint' },
  { thumb: 'p-sunset', tagA: 'NOTE', tagB: 'OPTICS', dotA: '#fb7185', labelA: 'Coral', dotB: '#fde047', labelB: 'Solar' },
  { thumb: 'p-prism', tagA: 'USER', tagB: 'PRISM', dotA: '#a855f7', labelA: 'Violet', dotB: '#38bdf8', labelB: 'Sky' },
];

export function mountLiquidToolbar() {
  banner();

  const stageEl = document.getElementById('lt-stage');
  const viewportEl = document.getElementById('phone-viewport');
  const canvas = document.getElementById('lt-canvas');
  const feedEl = document.getElementById('lt-feed');
  const feedCountEl = document.getElementById('lt-feed-count');
  const feedList = document.getElementById('lt-feed-list');
  const composeForm = document.getElementById('lt-compose');
  const noteInput = document.getElementById('lt-note-input');
  const emptyEl = document.getElementById('lt-empty');
  const dockEl = document.getElementById('lt-dock');
  const pillEl = document.getElementById('lt-pill');
  const tabBtns = Array.from(document.querySelectorAll('.lt-tab[data-tab]'));
  const plainHost = document.getElementById('plain-host');
  const hudEl = document.getElementById('lt-hud');
  const noticeEl = document.getElementById('lt-notice');

  const modeBtns = Array.from(document.querySelectorAll('button[data-mode]'));
  const resetDockBtn = document.getElementById('btn-reset-dock');
  const reducedCheck = document.getElementById('ctl-reduced');
  const depthInput = document.getElementById('ctl-depth');
  const depthOut = document.getElementById('out-depth');
  const testsBody = document.getElementById('tests');

  const reducedMQ = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  if (reducedMQ.matches) reducedCheck.checked = true;
  const isReduced = () => reducedCheck.checked || reducedMQ.matches;

  const state = {
    mode: 'liquid',
    depth: Number(depthInput.value),
    activeTab: 'foryou',
    userNotes: 0,
    customDockOffset: false,
    dockTargetX: 0,
    dockTargetY: 0,
    dragVx: 0,
    dragVy: 0,
    dragging: false,
    hasPainted: false,
    feedDirty: true,
    dockDirty: true,
    onScreen: true,
    uploads: 0,
    paints: 0,
  };

  const anim = {
    dockX: { x: 181, v: 0 },
    dockY: { x: 472, v: 0 },
    pillX: { x: 0, v: 0 },
    pillStretch: { x: 1, v: 0 },
    capsuleStretch: { x: 1, v: 0 },
  };

  let route = 'plain'; // 'webgl' | '2d' | 'plain'
  let stage = null;
  let blurPass = null;
  let blurTex = null;
  let feedTexInfo = null;
  let dockTexInfo = null;
  let ctx2d = null;
  let magCanvas = null;
  let magCtx = null;
  let rafId = 0;
  let lastFrameAt = 0;
  let lastHudAt = 0;
  let suppressClickUntil = 0;
  let unitCacheKey = '';
  let cachedUnit = 1;
  const geoKeys = new Map();

  const showNotice = (msg) => {
    noticeEl.hidden = !msg;
    noticeEl.textContent = msg || '';
  };

  const getStageSize = () => ({
    cw: Math.max(180, canvas.clientWidth || viewportEl.clientWidth || 360),
    ch: Math.max(200, canvas.clientHeight || viewportEl.clientHeight || 520),
  });

  const getDockSize = () => ({
    dw: dockEl.offsetWidth || 292,
    dh: dockEl.offsetHeight || 56,
  });

  function getRestDockCenter(cw, ch) {
    const { dh } = getDockSize();
    return {
      cx: Math.round(cw * 0.5),
      cy: Math.round(ch - 14 - dh * 0.5),
    };
  }

  function clampDockCenter(x, y, cw, ch) {
    const { dw, dh } = getDockSize();
    const minX = 12 + dw * 0.5;
    const maxX = Math.max(minX, cw - 12 - dw * 0.5);
    const minY = 14 + dh * 0.5;
    const maxY = Math.max(minY, ch - 12 - dh * 0.5);
    return {
      cx: clamp(x, minX, maxX),
      cy: clamp(y, minY, maxY),
    };
  }

  function getPillMetrics() {
    const { dw, dh } = getDockSize();
    const pad = 5;
    const slotW = Math.max(40, (dw - pad * 2) / 3);
    const idx = Math.max(0, TABS.indexOf(state.activeTab));
    return {
      slotW,
      pillH: Math.max(30, dh - pad * 2),
      targetX: idx * slotW,
    };
  }

  function syncPillStyle() {
    const { slotW, pillH } = getPillMetrics();
    const sx = anim.pillStretch.x;
    const sy = 1 / Math.sqrt(Math.max(1, sx));
    const wStr = `${slotW.toFixed(1)}px`;
    const hStr = `${pillH}px`;
    if (pillEl.style.width !== wStr) pillEl.style.width = wStr;
    if (pillEl.style.height !== hStr) pillEl.style.height = hStr;
    const nextTransform = `translate3d(${anim.pillX.x.toFixed(2)}px, 0, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    if (pillEl.style.transform !== nextTransform) {
      pillEl.style.transform = nextTransform;
      state.dockDirty = true;
    }
  }

  function snapLayoutToRest() {
    const { cw, ch } = getStageSize();
    const rest = getRestDockCenter(cw, ch);
    state.dockTargetX = rest.cx;
    state.dockTargetY = rest.cy;
    anim.dockX.x = rest.cx; anim.dockX.v = 0;
    anim.dockY.x = rest.cy; anim.dockY.v = 0;
    const { targetX } = getPillMetrics();
    anim.pillX.x = targetX; anim.pillX.v = 0;
    anim.pillStretch.x = 1; anim.pillStretch.v = 0;
    anim.capsuleStretch.x = 1; anim.capsuleStretch.v = 0;
    syncPillStyle();
  }

  function updateHud(force = false) {
    const now = performance.now();
    if (!force && now - lastHudAt < 90) return;
    lastHudAt = now;
    const routeLabel = route === 'webgl'
      ? 'WebGL 2 (ElementGL)'
      : route === '2d'
        ? '2D drawElementImage() fallback'
        : 'Plain HTML fallback';
    const modeLabel = MODES[state.mode].label;
    const st = Math.round(feedEl.scrollTop);
    hudEl.textContent =
      `Route: ${routeLabel} · Mode: ${modeLabel} · Depth: ${state.depth} px · ` +
      `Dock: (${Math.round(anim.dockX.x)}, ${Math.round(anim.dockY.x)}) · ` +
      `Feed scrollTop: ${st} px · Uploads: ${state.uploads}`;
  }

  function updateFeedFilter() {
    const cards = Array.from(feedList.querySelectorAll('.lt-card'));
    let shown = 0;
    let saved = 0;
    for (const card of cards) {
      const isSaved = card.dataset.saved === 'true';
      if (isSaved) saved++;
      const show = state.activeTab !== 'saved' || isSaved;
      card.hidden = !show;
      if (show) shown++;
    }
    emptyEl.hidden = !(state.activeTab === 'saved' && shown === 0);
    composeForm.classList.toggle('is-compose-focus', state.activeTab === 'compose');
    feedCountEl.textContent = state.activeTab === 'saved'
      ? `${shown} saved`
      : `${cards.length} ${cards.length === 1 ? 'card' : 'cards'} · ${saved} saved`;
    state.feedDirty = true;
  }

  function setTab(nextTab) {
    if (!TABS.includes(nextTab)) return;
    state.activeTab = nextTab;
    for (const btn of tabBtns) {
      btn.setAttribute('aria-pressed', String(btn.dataset.tab === nextTab));
    }
    if (nextTab === 'compose') {
      feedEl.scrollTop = 0;
    }
    updateFeedFilter();
    const { targetX } = getPillMetrics();
    if (isReduced()) {
      anim.pillX.x = targetX;
      anim.pillX.v = 0;
      anim.pillStretch.x = 1;
      anim.pillStretch.v = 0;
      syncPillStyle();
    }
    state.dockDirty = true;
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
    updateHud(true);
  }

  // #region geometry-sync
  function syncGeometry(force = false) {
    if (route === 'plain' || !state.hasPainted) return;
    const { cw, ch } = getStageSize();
    const fw = feedEl.offsetWidth;
    const { dw, dh } = getDockSize();
    if (!cw || !ch || !fw || !dw) return;

    const uKey = `${canvas.width}x${canvas.height}/${cw}x${ch}/${fw}`;
    if (uKey !== unitCacheKey && canvas.width > 0) {
      cachedUnit = geometryUnit(canvas, feedEl, fw);
      unitCacheKey = uKey;
      geoKeys.clear();
    }
    const unit = cachedUnit;

    const feedKey = `feed:${unit.toFixed(4)}`;
    if (force || geoKeys.get(feedEl) !== feedKey) {
      geoKeys.set(feedEl, feedKey);
      canvas.updateElementGeometry?.(feedEl, {
        canvasTransform: new DOMMatrix().scale(unit, unit, 1),
      });
      feedEl.dataset.hitTick = feedEl.dataset.hitTick === '1' ? '0' : '1';
    }

    const dx = Math.round(anim.dockX.x - dw * 0.5);
    const dy = Math.round(anim.dockY.x - dh * 0.5);
    const dockKey = `dock:${dx}:${dy}:${unit.toFixed(4)}`;
    if (force || geoKeys.get(dockEl) !== dockKey) {
      geoKeys.set(dockEl, dockKey);
      canvas.updateElementGeometry?.(dockEl, {
        canvasTransform: new DOMMatrix().scale(unit, unit, 1).translate(dx, dy),
      });
      dockEl.dataset.hitTick = dockEl.dataset.hitTick === '1' ? '0' : '1';
    }
  }
  // #endregion geometry-sync

  // #region fallbacks
  function enterPlainFallback(reason, { keepForRestore = false } = {}) {
    route = 'plain';
    cancelAnimationFrame(rafId);
    rafId = 0;
    stageEl.classList.add('is-plain');
    if (feedEl.parentElement !== plainHost) plainHost.append(feedEl);
    if (dockEl.parentElement !== plainHost) plainHost.append(dockEl);
    dockEl.style.transform = '';
    const { targetX } = getPillMetrics();
    anim.pillX.x = targetX;
    anim.pillStretch.x = 1;
    syncPillStyle();
    showNotice(reason);
    updateHud(true);
    if (!keepForRestore) stopLoop();
  }

  function restoreFromPlain() {
    stageEl.classList.remove('is-plain');
    if (feedEl.parentElement !== canvas) canvas.append(feedEl);
    if (dockEl.parentElement !== canvas) canvas.append(dockEl);
    showNotice('');
    geoKeys.clear();
    unitCacheKey = '';
    state.feedDirty = true;
    state.dockDirty = true;
    updateHud(true);
    canvas.requestPaint?.();
    startLoop();
  }

  function draw2DFallback(cw, ch) {
    if (!ctx2d || !state.hasPainted) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    ctx2d.reset();
    ctx2d.scale(dpr, dpr);
    ctx2d.drawElementImage(feedEl, 0, 0, cw, ch);

    const { dw, dh } = getDockSize();
    const sdfW = dw * anim.capsuleStretch.x;
    const sdfH = dh / Math.sqrt(Math.max(1, anim.capsuleStretch.x));
    const dx = Math.round(anim.dockX.x - sdfW * 0.5);
    const dy = Math.round(anim.dockY.x - sdfH * 0.5);
    const r = sdfH * 0.5;

    ctx2d.save();
    ctx2d.beginPath();
    ctx2d.roundRect(dx, dy, sdfW, sdfH, r);
    ctx2d.clip();

    if (state.mode === 'magnify') {
      if (!magCanvas) {
        magCanvas = document.createElement('canvas');
        magCtx = magCanvas.getContext('2d');
      }
      if (magCanvas.width !== bw || magCanvas.height !== bh) {
        magCanvas.width = bw;
        magCanvas.height = bh;
      }
      magCtx.clearRect(0, 0, bw, bh);
      magCtx.drawImage(canvas, 0, 0);
      const scale = 1.4;
      const sx = clamp(anim.dockX.x - sdfW / (2 * scale), 0, cw) * dpr;
      const sy = clamp(anim.dockY.x - sdfH / (2 * scale), 0, ch) * dpr;
      const sw = Math.max(1, (sdfW / scale) * dpr);
      const sh = Math.max(1, (sdfH / scale) * dpr);
      ctx2d.drawImage(magCanvas, sx, sy, sw, sh, dx, dy, sdfW, sdfH);
    }

    ctx2d.fillStyle = state.mode === 'frosted'
      ? 'rgba(20, 27, 44, 0.72)'
      : 'rgba(15, 22, 38, 0.42)';
    ctx2d.fillRect(dx, dy, sdfW, sdfH);
    ctx2d.restore();

    ctx2d.save();
    ctx2d.strokeStyle = 'rgba(240, 246, 255, 0.48)';
    ctx2d.lineWidth = 1.25;
    ctx2d.beginPath();
    ctx2d.roundRect(dx + 0.5, dy + 0.5, sdfW - 1, sdfH - 1, r);
    ctx2d.stroke();
    ctx2d.restore();

    ctx2d.drawElementImage(dockEl, Math.round(anim.dockX.x - dw * 0.5), Math.round(anim.dockY.x - dh * 0.5), dw, dh);
    syncGeometry();
  }
  // #endregion fallbacks

  // #region paint-geo
  function drawFrame() {
    const { cw, ch } = getStageSize();
    if (!cw || !ch || !state.hasPainted) return;

    if (route === 'webgl' && stage && !stage.lost) {
      try {
        // Call stage.begin() before stage.upload() so the canvas backing store
        // is sized to device pixels prior to getElementImageDefaultSize().
        if (!stage.begin([0.05, 0.07, 0.10, 1])) return;

        let feedUpdated = false;
        if (state.feedDirty || !feedTexInfo) {
          feedTexInfo = stage.upload(feedEl);
          state.feedDirty = false;
          state.uploads += 1;
          feedUpdated = true;
        }
        if (state.dockDirty || !dockTexInfo) {
          dockTexInfo = stage.upload(dockEl);
          state.dockDirty = false;
          state.uploads += 1;
        }
        if (!feedTexInfo || !dockTexInfo) return;

        const blurW = Math.max(64, Math.round(cw * 0.45));
        const blurH = Math.max(64, Math.round(ch * 0.45));
        if (!blurPass) {
          blurPass = new BlurPass(stage.gl, blurW, blurH);
          feedUpdated = true;
        } else {
          blurPass.resize(blurW, blurH);
        }
        if (feedUpdated || !blurTex) {
          blurTex = blurPass.render(feedTexInfo.tex);
        }

        // Restore default framebuffer & ElementGL state cleanly after FBO passes.
        if (!stage.begin([0.05, 0.07, 0.10, 1])) return;

        const { dw, dh } = getDockSize();
        const sdfW = dw * anim.capsuleStretch.x;
        const sdfH = dh / Math.sqrt(Math.max(1, anim.capsuleStretch.x));

        stage.quad(feedEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, dockTexInfo.tex);
          gl.uniform1i(u('uDockTex'), 1);

          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D, blurTex || feedTexInfo.tex);
          gl.uniform1i(u('uBlurTex'), 2);

          gl.activeTexture(gl.TEXTURE0);
          gl.uniform2f(u('uCanvasSize'), cw, ch);
          gl.uniform4f(u('uDockGeom'), anim.dockX.x, anim.dockY.x, sdfW, sdfH);
          gl.uniform2f(u('uDockLayout'), dw, dh);
          gl.uniform1f(u('uDockRadius'), sdfH * 0.5);
          gl.uniform1i(u('uMode'), MODES[state.mode].id);
          gl.uniform1f(u('uDepth'), state.depth);
        });

        syncGeometry();
      } catch (err) {
        if (/paint record/i.test(err?.message ?? '')) {
          state.feedDirty = true;
          state.dockDirty = true;
          canvas.requestPaint?.();
        } else {
          throw err;
        }
      }
    } else if (route === '2d' && ctx2d) {
      draw2DFallback(cw, ch);
    }

    updateHud();
  }
  // #endregion paint-geo

  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastFrameAt = 0;
  }

  function startLoop() {
    if (rafId || !state.onScreen || document.hidden || route === 'plain') return;
    lastFrameAt = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    rafId = 0;
    if (!state.onScreen || document.hidden || route === 'plain') return;
    const dt = lastFrameAt ? (now - lastFrameAt) / 1000 : 1 / 60;
    lastFrameAt = now;

    const { cw, ch } = getStageSize();
    if (!state.customDockOffset && !state.dragging) {
      const rest = getRestDockCenter(cw, ch);
      state.dockTargetX = rest.cx;
      state.dockTargetY = rest.cy;
    }

    const { targetX } = getPillMetrics();
    const stillMoving = stepDockSprings(
      anim,
      {
        dockX: state.dockTargetX,
        dockY: state.dockTargetY,
        pillX: targetX,
        dragging: state.dragging,
        dragVx: state.dragVx,
        dragVy: state.dragVy,
      },
      isReduced(),
      dt
    );

    syncPillStyle();
    drawFrame();

    if (stillMoving || state.dragging) {
      rafId = requestAnimationFrame(tick);
    } else {
      state.dragVx = 0;
      state.dragVy = 0;
      lastFrameAt = 0;
    }
  }

  // ---------------------------------------------------------------- Backend init
  canvas.addEventListener('paint', (e) => {
    state.hasPainted = true;
    state.paints += 1;
    if (e.changedElements?.length) {
      for (const el of e.changedElements) {
        if (el === feedEl || feedEl.contains(el)) state.feedDirty = true;
        if (el === dockEl || dockEl.contains(el)) state.dockDirty = true;
      }
    } else {
      state.feedDirty = true;
      state.dockDirty = true;
    }
    if (!rafId && state.onScreen && !document.hidden && route !== 'plain') {
      drawFrame();
    }
  });

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: LIQUID_GLASS_FRAG,
        attributes: { preserveDrawingBuffer: true },
        onLost: () => {
          blurPass = null;
          blurTex = null;
          feedTexInfo = null;
          dockTexInfo = null;
          enterPlainFallback(
            'The WebGL 2 context was lost, so the feed and dock moved to plain HTML. They will restore if the context returns.',
            { keepForRestore: true }
          );
        },
        onRestored: () => {
          stage?.gl?.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          blurPass = null;
          blurTex = null;
          feedTexInfo = null;
          dockTexInfo = null;
          route = 'webgl';
          state.hasPainted = true;
          restoreFromPlain();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      route = 'webgl';
    } catch (err) {
      showNotice(`WebGL 2 could not start (${err.message}).`);
      stage = null;
    }
  }

  if (route === 'plain' && hicSupported) {
    try {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        route = '2d';
        showNotice('WebGL texElementSubImage2D() is not available here, so the toolbar uses the 5-argument 2D drawElementImage() fallback.');
        canvas.addEventListener('contextlost', (e) => {
          e.preventDefault();
          enterPlainFallback('The 2D canvas context was lost, so the feed and dock moved to plain HTML.', { keepForRestore: true });
        });
        canvas.addEventListener('contextrestored', () => {
          route = '2d';
          state.hasPainted = true;
          restoreFromPlain();
        });
      }
    } catch {}
  }

  if (route === 'plain' && !stage && !ctx2d) {
    enterPlainFallback('HTML-in-canvas is not available here, so the feed and floating dock are shown as plain HTML.');
  }

  // ---------------------------------------------------------------- Feed interactions
  feedEl.addEventListener('selectstart', (e) => {
    if (!e.target.closest('input, textarea')) e.preventDefault();
  });

  dockEl.addEventListener('selectstart', (e) => {
    e.preventDefault();
  });

  feedEl.addEventListener('scroll', () => {
    state.feedDirty = true;
    canvas.requestPaint?.();
    startLoop();
  }, { passive: true });

  let feedMouseActive = false;
  let feedMouseDragged = false;
  let feedMouseStartY = 0;
  let feedMouseLastY = 0;

  feedEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    if (e.target.closest('input, textarea, select, button')) return;
    window.getSelection?.()?.removeAllRanges?.();
    feedMouseActive = true;
    feedMouseDragged = false;
    feedMouseStartY = e.clientY;
    feedMouseLastY = e.clientY;
  });

  window.addEventListener('pointermove', (e) => {
    if (!feedMouseActive || e.pointerType !== 'mouse') return;
    const dy = e.clientY - feedMouseLastY;
    feedMouseLastY = e.clientY;
    if (!feedMouseDragged && Math.abs(e.clientY - feedMouseStartY) > 6) {
      feedMouseDragged = true;
      feedEl.classList.add('is-dragging');
      window.getSelection?.()?.removeAllRanges?.();
    }
    if (!feedMouseDragged) return;
    if (e.cancelable) e.preventDefault();
    const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
    feedEl.scrollTop = clamp(feedEl.scrollTop - dy, 0, maxScroll);
    state.feedDirty = true;
    startLoop();
  });

  function endFeedMouse() {
    if (!feedMouseActive) return;
    feedMouseActive = false;
    feedEl.classList.remove('is-dragging');
    if (feedMouseDragged) {
      suppressClickUntil = performance.now() + 90;
      feedMouseDragged = false;
    }
  }
  window.addEventListener('pointerup', endFeedMouse);
  window.addEventListener('pointercancel', endFeedMouse);

  feedList.addEventListener('click', (e) => {
    if (performance.now() < suppressClickUntil) return;
    const likeBtn = e.target.closest('.lt-like');
    if (likeBtn) {
      const next = (Number(likeBtn.dataset.likes) || 0) + 1;
      likeBtn.dataset.likes = String(next);
      likeBtn.textContent = `+1 (${next})`;
      state.feedDirty = true;
      canvas.requestPaint?.();
      startLoop();
      return;
    }
    const saveBtn = e.target.closest('.lt-save');
    if (saveBtn) {
      const card = saveBtn.closest('.lt-card');
      const next = saveBtn.getAttribute('aria-pressed') !== 'true';
      saveBtn.setAttribute('aria-pressed', String(next));
      saveBtn.textContent = next ? 'Saved' : 'Save';
      if (card) card.dataset.saved = String(next);
      updateFeedFilter();
      canvas.requestPaint?.();
      startLoop();
    }
  });

  composeForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = noteInput.value.trim();
    if (!text) return;
    state.userNotes += 1;
    const theme = EXTRA_CARD_THEMES[(state.userNotes - 1) % EXTRA_CARD_THEMES.length];
    const stamp = new Date().toLocaleTimeString('en-GB', { hour12: false });

    const card = document.createElement('article');
    card.className = 'lt-card is-fresh';
    card.dataset.saved = 'false';

    const thumb = document.createElement('div');
    thumb.className = `lt-thumb ${theme.thumb}`;
    const tagA = document.createElement('span');
    tagA.className = 'lt-thumb-tag';
    tagA.textContent = `${theme.tagA} · #${state.userNotes}`;
    const tagB = document.createElement('span');
    tagB.className = 'lt-thumb-tag';
    tagB.textContent = stamp;
    thumb.append(tagA, tagB);

    const pills = document.createElement('div');
    pills.className = 'lt-pills';
    const makePill = (dot, label) => {
      const span = document.createElement('span');
      span.className = 'lt-pill-tag';
      const d = document.createElement('span');
      d.className = 'lt-pill-dot';
      d.style.setProperty('--dot', dot);
      span.append(d, document.createTextNode(label));
      return span;
    };
    pills.append(makePill(theme.dotA, theme.labelA), makePill(theme.dotB, theme.labelB));

    const h3 = document.createElement('h3');
    h3.textContent = text;
    const p = document.createElement('p');
    p.textContent = 'Added straight into the live scrollable DOM subtree while the WebGL glass dock floats on top.';

    const actions = document.createElement('div');
    actions.className = 'lt-card-actions';
    const likeBtn = document.createElement('button');
    likeBtn.type = 'button';
    likeBtn.className = 'lt-like';
    likeBtn.dataset.likes = '0';
    likeBtn.textContent = '+1 (0)';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'lt-save';
    saveBtn.setAttribute('aria-pressed', 'false');
    saveBtn.textContent = 'Save';
    actions.append(likeBtn, saveBtn);

    card.append(thumb, pills, h3, p, actions);
    feedList.prepend(card);
    noteInput.value = '';
    if (state.activeTab === 'saved') setTab('foryou');
    else updateFeedFilter();
    feedEl.scrollTop = 0;
    state.feedDirty = true;
    canvas.requestPaint?.();
    startLoop();
  });

  noteInput.addEventListener('input', () => {
    state.feedDirty = true;
    canvas.requestPaint?.();
    startLoop();
  });

  // Forward wheel over the floating dock to #lt-feed so wheeling anywhere inside
  // the phone viewport scrolls smoothly.
  dockEl.addEventListener('wheel', (e) => {
    if (route === 'plain' || Math.abs(e.deltaY) < 0.01) return;
    const maxScroll = Math.max(0, feedEl.scrollHeight - feedEl.clientHeight);
    const next = clamp(feedEl.scrollTop + e.deltaY, 0, maxScroll);
    if (next !== feedEl.scrollTop) {
      feedEl.scrollTop = next;
      state.feedDirty = true;
      if (e.cancelable) e.preventDefault();
      canvas.requestPaint?.();
      startLoop();
    }
  }, { passive: false });

  // ---------------------------------------------------------------- Dock drag & tabs
  let dockDrag = null;

  dockEl.addEventListener('pointerdown', (e) => {
    if (route === 'plain') return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    dockDrag = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      lastClientX: e.clientX,
      lastClientY: e.clientY,
      lastAt: performance.now(),
      startDockX: anim.dockX.x,
      startDockY: anim.dockY.x,
      moved: false,
    };
  });

  window.addEventListener('pointermove', (e) => {
    if (!dockDrag || e.pointerId !== dockDrag.pointerId) return;
    const dxTotal = e.clientX - dockDrag.startClientX;
    const dyTotal = e.clientY - dockDrag.startClientY;
    if (!dockDrag.moved && Math.hypot(dxTotal, dyTotal) > 6) {
      dockDrag.moved = true;
      state.dragging = true;
      state.customDockOffset = true;
      dockEl.classList.add('is-dragging');
      window.getSelection?.()?.removeAllRanges?.();
      try { dockEl.setPointerCapture?.(e.pointerId); } catch {}
    }
    if (!dockDrag.moved) return;
    if (e.cancelable) e.preventDefault();

    const now = performance.now();
    const dt = Math.max(0.008, (now - dockDrag.lastAt) / 1000);
    state.dragVx = (e.clientX - dockDrag.lastClientX) / dt;
    state.dragVy = (e.clientY - dockDrag.lastClientY) / dt;
    dockDrag.lastClientX = e.clientX;
    dockDrag.lastClientY = e.clientY;
    dockDrag.lastAt = now;

    const { cw, ch } = getStageSize();
    const clamped = clampDockCenter(dockDrag.startDockX + dxTotal, dockDrag.startDockY + dyTotal, cw, ch);
    state.dockTargetX = clamped.cx;
    state.dockTargetY = clamped.cy;
    anim.dockX.x = clamped.cx;
    anim.dockY.x = clamped.cy;

    syncGeometry();
    canvas.requestPaint?.();
    startLoop();
    updateHud();
  });

  function endDockDrag(e) {
    if (!dockDrag || e.pointerId !== dockDrag.pointerId) return;
    const wasMoved = dockDrag.moved;
    try { dockEl.releasePointerCapture?.(e.pointerId); } catch {}
    dockDrag = null;
    state.dragging = false;
    dockEl.classList.remove('is-dragging');
    if (wasMoved) {
      suppressClickUntil = performance.now() + 90;
      state.dragVx *= 0.35;
      state.dragVy *= 0.35;
      canvas.requestPaint?.();
      startLoop();
    }
  }
  window.addEventListener('pointerup', endDockDrag);
  window.addEventListener('pointercancel', endDockDrag);

  for (const btn of tabBtns) {
    btn.addEventListener('click', () => {
      if (performance.now() < suppressClickUntil) return;
      setTab(btn.dataset.tab);
    });
  }

  // ---------------------------------------------------------------- External toolbar
  for (const btn of modeBtns) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.mode;
      if (!MODES[next]) return;
      state.mode = next;
      for (const b of modeBtns) b.setAttribute('aria-pressed', String(b === btn));
      updateHud(true);
      if (route !== 'plain') {
        canvas.requestPaint?.();
        startLoop();
      }
    });
  }

  depthInput.addEventListener('input', () => {
    state.depth = Number(depthInput.value);
    depthOut.textContent = `${state.depth} px`;
    updateHud(true);
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
  });

  resetDockBtn.addEventListener('click', () => {
    const { cw, ch } = getStageSize();
    const rest = getRestDockCenter(cw, ch);
    state.customDockOffset = false;
    state.dockTargetX = rest.cx;
    state.dockTargetY = rest.cy;
    if (isReduced()) {
      anim.dockX.x = rest.cx; anim.dockX.v = 0;
      anim.dockY.x = rest.cy; anim.dockY.v = 0;
      anim.capsuleStretch.x = 1; anim.capsuleStretch.v = 0;
      syncGeometry(true);
    }
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
    updateHud(true);
  });

  function syncReducedState() {
    if (isReduced()) {
      const { targetX } = getPillMetrics();
      anim.pillX.x = targetX; anim.pillX.v = 0;
      anim.pillStretch.x = 1; anim.pillStretch.v = 0;
      anim.capsuleStretch.x = 1; anim.capsuleStretch.v = 0;
      anim.dockX.x = state.dockTargetX; anim.dockX.v = 0;
      anim.dockY.x = state.dockTargetY; anim.dockY.v = 0;
      syncPillStyle();
    }
    if (route !== 'plain') {
      canvas.requestPaint?.();
      startLoop();
    }
  }

  reducedCheck.addEventListener('change', syncReducedState);
  reducedMQ.addEventListener?.('change', () => {
    reducedCheck.checked = reducedMQ.matches;
    syncReducedState();
  });

  // ---------------------------------------------------------------- Visibility & resize
  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(
      (entries) => {
        const nextOnScreen = entries.some((entry) => entry.isIntersecting);
        if (nextOnScreen === state.onScreen) return;
        state.onScreen = nextOnScreen;
        if (state.onScreen) {
          state.feedDirty = true;
          state.dockDirty = true;
          if (route !== 'plain') {
            canvas.requestPaint?.();
            startLoop();
          }
        } else {
          stopLoop();
        }
      },
      { rootMargin: '80px 0px' }
    ).observe(stageEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopLoop();
    } else if (state.onScreen && route !== 'plain') {
      state.feedDirty = true;
      state.dockDirty = true;
      canvas.requestPaint?.();
      startLoop();
    }
  });

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => {
      const { cw, ch } = getStageSize();
      unitCacheKey = '';
      geoKeys.clear();
      if (state.customDockOffset) {
        const clamped = clampDockCenter(state.dockTargetX, state.dockTargetY, cw, ch);
        state.dockTargetX = clamped.cx;
        state.dockTargetY = clamped.cy;
        anim.dockX.x = clamped.cx;
        anim.dockY.x = clamped.cy;
      } else {
        const rest = getRestDockCenter(cw, ch);
        state.dockTargetX = rest.cx;
        state.dockTargetY = rest.cy;
        anim.dockX.x = rest.cx;
        anim.dockY.x = rest.cy;
      }
      const { targetX } = getPillMetrics();
      anim.pillX.x = targetX;
      anim.pillX.v = 0;
      syncPillStyle();
      state.feedDirty = true;
      state.dockDirty = true;
      if (route !== 'plain') {
        canvas.requestPaint?.();
        startLoop();
      }
    }).observe(viewportEl);
  }

  // Initial setup
  updateFeedFilter();
  snapLayoutToRest();
  updateHud(true);
  if (route !== 'plain') {
    canvas.requestPaint?.();
    startLoop();
  }

  // ---------------------------------------------------------------- Live checks (isolated fixtures)
  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  async function settleGfx(baseActive) {
    if (!window.__gfx?.active) return;
    const deadline = performance.now() + 900;
    while (
      (window.__gfx.active() > baseActive || (window.__gfx.memory?.().removed ?? 0) > 0) &&
      performance.now() < deadline
    ) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  function makeFixtureCanvas(w, h, innerHtml) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
    cv.innerHTML = innerHtml;
    testStage().append(cv);
    return cv;
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

  function drawFixtureGlass(g, blur, cv, feed, dock, { cx, cy, w, h, mode = 0, depth = 24 }) {
    const cw = cv.clientWidth || 240;
    const ch = cv.clientHeight || 160;
    if (!g.begin([0.05, 0.07, 0.10, 1])) return { glErr: -1, fbBound: -1 };
    const feedT = g.upload(feed);
    const dockT = g.upload(dock);
    if (!feedT || !dockT) return { glErr: -1, fbBound: -1 };
    const blurT = blur.render(feedT.tex);
    const fbBound = g.gl.getParameter(g.gl.FRAMEBUFFER_BINDING);
    if (!g.begin([0.05, 0.07, 0.10, 1])) return { glErr: -1, fbBound };
    g.quad(feed, ElementGL.rect(cv, 0, 0, cw, ch), (gl, u) => {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, dockT.tex);
      gl.uniform1i(u('uDockTex'), 1);

      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, blurT || feedT.tex);
      gl.uniform1i(u('uBlurTex'), 2);

      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(u('uCanvasSize'), cw, ch);
      gl.uniform4f(u('uDockGeom'), cx, cy, w, h);
      gl.uniform2f(u('uDockLayout'), dock.offsetWidth || w, dock.offsetHeight || h);
      gl.uniform1f(u('uDockRadius'), h * 0.5);
      gl.uniform1i(u('uMode'), mode);
      gl.uniform1f(u('uDepth'), depth);
    });
    return { glErr: g.gl.getError(), fbBound, feedT, dockT };
  }

  const tests = [
    {
      name: 'Both #lt-feed and #lt-dock upload via texElementSubImage2D() with UNPACK_PREMULTIPLY_ALPHA_WEBGL = true (gl.getError() === 0)',
      expect: 'pass',
      why: 'Uploads a feed child and a transparent dock child with a translucent white pill, runs the blur FBO pass, confirms the FBO unbinds before drawing, and verifies no white washout.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const cv = makeFixtureCanvas(
          240,
          160,
          '<div id="fx-feed" drawable style="position:absolute;left:0;top:0;width:240px;height:160px;background:#0c101a">' +
            '<div style="height:52px;background:#ff5a36"></div>' +
            '<div style="height:108px;background:#101828"></div>' +
          '</div>' +
          '<div id="fx-dock" drawable style="position:absolute;left:0;top:0;width:180px;height:44px;background:transparent;display:flex;align-items:center;justify-content:space-around">' +
            '<span style="width:52px;height:28px;border-radius:99px;background:rgba(255,255,255,0.22)"></span>' +
            '<span style="width:24px;height:18px;border-radius:4px;background:#ffffff"></span>' +
          '</div>'
        );
        const feed = cv.querySelector('#fx-feed');
        const dock = cv.querySelector('#fx-dock');
        let g = null;
        let blur = null;
        try {
          g = new ElementGL(cv, { fragment: LIQUID_GLASS_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          blur = new BlurPass(g.gl, 120, 80);
          await nextPaint(cv);

          const res = drawFixtureGlass(g, blur, cv, feed, dock, { cx: 120, cy: 112, w: 180, h: 44, mode: 0, depth: 22 });
          const feedPx = readCssPx(g, cv, 40, 24);
          const pillPx = readCssPx(g, cv, 75, 112);
          const glyphPx = readCssPx(g, cv, 165, 112);

          return need(
            res.glErr === 0 &&
              res.fbBound === null &&
              feedPx[0] > 200 && feedPx[2] < 100 &&
              pillPx[0] < 185 && pillPx[0] > 35 &&
              glyphPx[0] > 215 && glyphPx[1] > 215 && glyphPx[2] > 215,
            `glErr=${res.glErr}, fbUnbound=${res.fbBound === null}, feed(${res.feedT.w}x${res.feedT.h}) rgb(${feedPx[0]},${feedPx[1]},${feedPx[2]}), translucent pill rgb(${pillPx[0]},${pillPx[1]},${pillPx[2]}), white label rgb(${glyphPx[0]},${glyphPx[1]},${glyphPx[2]}).`
          );
        } finally {
          blur?.dispose();
          g?.dispose();
          cv.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Analytic capsule bevel bends stripes and separates RGB channels vs Flat frosted glass',
      expect: 'pass',
      why: 'Places sharp horizontal white/black stripes across the top curved bevel of the glass dock and measures pixel delta plus |R - B| chromatic separation in Liquid refraction, Flat frosted glass and Magnify x1.4.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const cv = makeFixtureCanvas(
          240,
          160,
          '<div id="fx-feed2" drawable style="position:absolute;left:0;top:0;width:240px;height:160px;background:repeating-linear-gradient(0deg,#ffffff 0 12px,#000000 12px 24px)"></div>' +
          '<div id="fx-dock2" drawable style="position:absolute;left:0;top:0;width:190px;height:52px;background:transparent"></div>'
        );
        const feed = cv.querySelector('#fx-feed2');
        const dock = cv.querySelector('#fx-dock2');
        let g = null;
        let blur = null;
        try {
          g = new ElementGL(cv, { fragment: LIQUID_GLASS_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          blur = new BlurPass(g.gl, 120, 80);
          await nextPaint(cv);

          const sampleRimStrip = (mode) => {
            drawFixtureGlass(g, blur, cv, feed, dock, { cx: 120, cy: 96, w: 190, h: 52, mode, depth: 28 });
            const out = [];
            for (let y = 71; y <= 88; y++) {
              out.push(readCssPx(g, cv, 120, y));
            }
            return out;
          };

          const liquid = sampleRimStrip(0);
          const frosted = sampleRimStrip(1);
          const magnify = sampleRimStrip(2);

          let diffSum = 0;
          let magDiffSum = 0;
          let maxRbLiquid = 0;
          let maxRbFrosted = 0;
          for (let i = 0; i < liquid.length; i++) {
            const l = liquid[i], f = frosted[i], m = magnify[i];
            diffSum += Math.abs(l[0] - f[0]) + Math.abs(l[1] - f[1]) + Math.abs(l[2] - f[2]);
            magDiffSum += Math.abs(m[0] - f[0]) + Math.abs(m[1] - f[1]) + Math.abs(m[2] - f[2]);
            maxRbLiquid = Math.max(maxRbLiquid, Math.abs(l[0] - l[2]));
            maxRbFrosted = Math.max(maxRbFrosted, Math.abs(f[0] - f[2]));
          }
          const meanDiff = diffSum / (liquid.length * 3);
          const meanMagDiff = magDiffSum / (liquid.length * 3);

          return need(
            meanDiff > 16 && meanMagDiff > 16 && maxRbLiquid >= 10 && maxRbFrosted <= 5,
            `Liquid vs Frosted delta=${meanDiff.toFixed(1)}/ch, Magnify vs Frosted delta=${meanMagDiff.toFixed(1)}/ch, rim chromatic |R-B| liquid=${maxRbLiquid} vs frosted=${maxRbFrosted}.`
          );
        } finally {
          blur?.dispose();
          g?.dispose();
          cv.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Scrolling #lt-feed updates pixels seen through the floating glass dock',
      expect: 'pass',
      why: 'Scrolls an isolated feed container from a coral-red card to a cyan-blue card under the glass dock, re-uploads on paint, and confirms the pixels refracted inside the capsule switch from red-dominant to blue-dominant.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const cv = makeFixtureCanvas(
          240,
          160,
          '<div id="fx-feed3" drawable style="position:absolute;left:0;top:0;width:240px;height:160px;overflow-y:auto">' +
            '<div style="height:160px;background:#ff4d2e"></div>' +
            '<div style="height:220px;background:#06b6d4"></div>' +
          '</div>' +
          '<div id="fx-dock3" drawable style="position:absolute;left:0;top:0;width:180px;height:46px;background:transparent"></div>'
        );
        const feed = cv.querySelector('#fx-feed3');
        const dock = cv.querySelector('#fx-dock3');
        let g = null;
        let blur = null;
        try {
          g = new ElementGL(cv, { fragment: LIQUID_GLASS_FRAG, attributes: { preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          blur = new BlurPass(g.gl, 120, 80);
          await nextPaint(cv);
          drawFixtureGlass(g, blur, cv, feed, dock, { cx: 120, cy: 118, w: 180, h: 46, mode: 0, depth: 22 });
          const topPx = readCssPx(g, cv, 120, 118);

          feed.scrollTop = 180;
          await nextPaint(cv);
          drawFixtureGlass(g, blur, cv, feed, dock, { cx: 120, cy: 118, w: 180, h: 46, mode: 0, depth: 22 });
          const scrolledPx = readCssPx(g, cv, 120, 118);

          return need(
            topPx[0] > topPx[2] + 60 && scrolledPx[2] > scrolledPx[0] + 50,
            `scrollTop=0 glass rgb(${topPx[0]},${topPx[1]},${topPx[2]}); scrollTop=${Math.round(feed.scrollTop)} glass rgb(${scrolledPx[0]},${scrolledPx[1]},${scrolledPx[2]}).`
          );
        } finally {
          blur?.dispose();
          g?.dispose();
          cv.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Hit testing lands on moved #lt-dock tabs and #lt-feed buttons outside the dock',
      expect: 'pass',
      why: 'Syncs both #lt-feed and a moved #lt-dock with updateElementGeometry() scaled by geometryUnit() and dataset.hitTick, then checks elementsFromPoint() and real clicks on both layers.',
      run: async () => {
        if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('updateElementGeometry() is not available.');
        }
        const baseActive = window.__gfx?.active() ?? 0;
        const cv = makeFixtureCanvas(
          260,
          180,
          '<div id="fx-feed4" drawable style="position:absolute;left:0;top:0;width:260px;height:180px;z-index:1;background:#0c101a;padding:12px;box-sizing:border-box">' +
            '<button id="fx-card-btn" type="button" style="width:120px;height:38px">Card +1</button>' +
          '</div>' +
          '<nav id="fx-dock4" drawable style="position:absolute;left:0;top:0;width:200px;height:48px;z-index:5;display:flex;background:transparent">' +
            '<button id="fx-tab-a" type="button" style="flex:1;height:48px">For You</button>' +
            '<button id="fx-tab-b" type="button" style="flex:1;height:48px">Saved</button>' +
          '</nav>'
        );
        const feed = cv.querySelector('#fx-feed4');
        const dock = cv.querySelector('#fx-dock4');
        const cardBtn = cv.querySelector('#fx-card-btn');
        const tabB = cv.querySelector('#fx-tab-b');
        let g = null;
        let blur = null;
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: LIQUID_GLASS_FRAG, attributes: { preserveDrawingBuffer: true } });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            blur = new BlurPass(g.gl, 130, 90);
          }
          await nextPaint(cv);
          if (g && blur) {
            drawFixtureGlass(g, blur, cv, feed, dock, { cx: 130, cy: 96, w: 200, h: 48, mode: 0, depth: 22 });
          }

          const unit = geometryUnit(cv, feed, 260);
          cv.updateElementGeometry(feed, { canvasTransform: new DOMMatrix().scale(unit, unit, 1) });
          feed.dataset.hitTick = '1';
          // Move dock to left=30, top=72 (Saved tab right half around x=180, y=96)
          cv.updateElementGeometry(dock, { canvasTransform: new DOMMatrix().scale(unit, unit, 1).translate(30, 72) });
          dock.dataset.hitTick = '1';

          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const rect = cv.getBoundingClientRect();
          const hitCard = document.elementsFromPoint(rect.left + 70, rect.top + 31);
          const hitDock = document.elementsFromPoint(rect.left + 180, rect.top + 96);

          let cardClicks = 0;
          let tabClicks = 0;
          cardBtn.addEventListener('click', () => { cardClicks++; });
          tabB.addEventListener('click', () => { tabClicks++; });

          const cardOk = hitCard.includes(cardBtn) && !hitCard.includes(dock);
          const dockOk = hitDock.includes(tabB);
          if (cardOk) cardBtn.click();
          if (dockOk) tabB.click();

          return need(
            cardOk && dockOk && cardClicks === 1 && tabClicks === 1,
            `geometryUnit=${unit.toFixed(3)}, feed button hit=${cardOk} (${cardClicks} click), moved dock Saved hit=${dockOk} (${tabClicks} click).`
          );
        } finally {
          blur?.dispose();
          g?.dispose();
          cv.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Elastic pill spring stretches during transitions and snaps under reduced motion',
      expect: 'pass',
      why: 'Steps stepDockSprings() across a tab switch with drag velocity under normal motion (verifying horizontal stretchX > 1.08 and clean rest settle) vs reduced motion (1-step snap with stretchX === 1).',
      run: async () => {
        const a = {
          dockX: { x: 180, v: 0 },
          dockY: { x: 460, v: 0 },
          pillX: { x: 0, v: 0 },
          pillStretch: { x: 1, v: 0 },
          capsuleStretch: { x: 1, v: 0 },
        };
        let peakStretch = 1;
        for (let i = 0; i < 120; i++) {
          stepDockSprings(a, {
            dockX: 180,
            dockY: 460,
            pillX: 196,
            dragging: i < 8,
            dragVx: i < 8 ? 420 : 0,
            dragVy: 0,
          }, false, 1 / 60);
          if (a.pillStretch.x > peakStretch) peakStretch = a.pillStretch.x;
        }
        const settledX = a.pillX.x;
        const settledStretch = a.pillStretch.x;

        const r = {
          dockX: { x: 180, v: 0 },
          dockY: { x: 460, v: 0 },
          pillX: { x: 0, v: 0 },
          pillStretch: { x: 1.25, v: 3 },
          capsuleStretch: { x: 1.05, v: 1 },
        };
        const still = stepDockSprings(r, {
          dockX: 120,
          dockY: 220,
          pillX: 196,
          dragging: true,
          dragVx: 500,
          dragVy: 0,
        }, true, 1 / 60);

        return need(
          peakStretch > 1.08 && Math.abs(settledX - 196) < 0.05 && Math.abs(settledStretch - 1) < 0.02 &&
            !still && r.pillX.x === 196 && r.pillStretch.x === 1 && r.dockY.x === 220,
          `Normal peak stretchX=${peakStretch.toFixed(3)}, settled pillX=${settledX.toFixed(2)} (stretch=${settledStretch.toFixed(3)}); reduced snapped=${!still} (stretch=${r.pillStretch.x}).`
        );
      },
    },
    {
      name: 'Synthetic webglcontextlost/restored recovery and 5-argument 2D drawElementImage() fallback',
      expect: 'pass',
      why: 'Verifies 5-argument drawElementImage() compositing on a 2D fixture with zero wrong-size calls, then dispatches synthetic webglcontextlost and webglcontextrestored on an ElementGL fixture without calling loseContext().',
      run: async () => {
        if (!hicSupported) throw new Error('HTML-in-canvas is not available.');
        const baseActive = window.__gfx?.active() ?? 0;

        // Part A: 5-argument 2D fallback check
        const wrongBefore = window.__gfx?.draws?.wrong ?? 0;
        const cv2d = makeFixtureCanvas(
          200,
          120,
          '<div id="fx-f2d" drawable style="position:absolute;left:0;top:0;width:200px;height:120px;background:#1e293b"></div>' +
          '<div id="fx-d2d" drawable style="position:absolute;left:0;top:0;width:150px;height:36px;background:rgba(255,255,255,0.22)"></div>'
        );
        const f2d = cv2d.querySelector('#fx-f2d');
        const d2d = cv2d.querySelector('#fx-d2d');
        const c2 = cv2d.getContext('2d');
        cv2d.width = 200;
        cv2d.height = 120;
        await nextPaint(cv2d);
        c2.reset();
        c2.drawElementImage(f2d, 0, 0, 200, 120);
        c2.drawElementImage(d2d, 25, 68, 150, 36);
        const wrongAfter = window.__gfx?.draws?.wrong ?? 0;
        cv2d.remove();
        window.__gfx?.retire(cv2d);

        if (!glSupported) {
          return need(wrongAfter === wrongBefore, `2D 5-arg drawElementImage() ok (wrongDraws=${wrongAfter - wrongBefore}); WebGL 2 skipped.`);
        }

        // Part B: synthetic webglcontextlost -> webglcontextrestored
        const wrap = document.createElement('div');
        wrap.style.cssText = 'position:relative;width:200px;height:120px;';
        const cv = document.createElement('canvas');
        cv.setAttribute('content', 'drawable');
        cv.setAttribute('layoutsubtree', '');
        cv.style.cssText = 'display:block;width:200px;height:120px;';
        cv.innerHTML =
          '<div id="fx-fl" drawable style="position:absolute;left:0;top:0;width:200px;height:120px;background:#d2491f"></div>' +
          '<div id="fx-dl" drawable style="position:absolute;left:0;top:0;width:140px;height:38px;background:rgba(255,255,255,0.25)"></div>';
        const feedL = cv.querySelector('#fx-fl');
        const dockL = cv.querySelector('#fx-dl');
        const host = document.createElement('div');
        wrap.append(cv, host);
        testStage().append(wrap);

        let g = null;
        let blur = null;
        let fellBack = false;
        let restored = false;
        try {
          g = new ElementGL(cv, {
            fragment: LIQUID_GLASS_FRAG,
            attributes: { preserveDrawingBuffer: true },
            onLost: () => {
              fellBack = true;
              host.append(feedL, dockL);
            },
            onRestored: () => {
              restored = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              blur?.dispose();
              blur = new BlurPass(g.gl, 100, 60);
              cv.append(feedL, dockL);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          blur = new BlurPass(g.gl, 100, 60);
          await nextPaint(cv);
          drawFixtureGlass(g, blur, cv, feedL, dockL, { cx: 100, cy: 84, w: 140, h: 38, mode: 0, depth: 20 });

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(lostEv);
          const duringLossPlain = fellBack && g.lost && host.contains(feedL) && host.contains(dockL);

          cv.dispatchEvent(new Event('webglcontextrestored'));
          await nextPaint(cv);
          const afterRes = drawFixtureGlass(g, blur, cv, feedL, dockL, { cx: 100, cy: 84, w: 140, h: 38, mode: 0, depth: 20 });
          const px = readCssPx(g, cv, 30, 30);

          return need(
            wrongAfter === wrongBefore && lostEv.defaultPrevented && duringLossPlain &&
              restored && !g.lost && cv.contains(feedL) && cv.contains(dockL) &&
              afterRes.glErr === 0 && px[0] > 160,
            `2D wrongDraws=${wrongAfter - wrongBefore}; lost->plain=${duringLossPlain}; restored=${restored}, backInCanvas=${cv.contains(dockL)}, glErr=${afterRes.glErr}, rgb(${px[0]},${px[1]},${px[2]}).`
          );
        } finally {
          blur?.dispose();
          g?.dispose();
          wrap.remove();
          window.__gfx?.retire(cv);
          await settleGfx(baseActive);
        }
      },
    },
  ];

  runTests(testsBody, tests);
}

if (typeof document !== 'undefined' && document.getElementById('lt-canvas')) {
  mountLiquidToolbar();
}
