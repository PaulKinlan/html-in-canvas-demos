import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const MODES = {
  datamosh: { id: 'datamosh', index: 0, label: 'Block datamosh' },
  scantear: { id: 'scantear', index: 1, label: 'Scan tear' },
  shatter: { id: 'shatter', index: 2, label: 'Chroma shatter' },
};

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// #region cut-envelope
export const CUT_DURATION_MS = 780;
export const REDUCED_CUT_DURATION_MS = 280;

export function createCutEnvelope(initialProgress = 0) {
  const p = clamp(initialProgress, 0, 1);
  return {
    progress: p,
    from: p,
    to: p,
    startMs: 0,
    durationMs: CUT_DURATION_MS,
    active: false,
    pulseUntilMs: 0,
    lastStepMs: 0,
  };
}

export function triggerCutEnvelope(env, {
  to = null,
  tMs,
  durationMs = null,
  reduced = false,
}) {
  const from = clamp(env.progress, 0, 1);
  const target = to == null ? (from < 0.5 ? 1 : 0) : clamp(to, 0, 1);
  const dur = durationMs ?? (reduced ? REDUCED_CUT_DURATION_MS : CUT_DURATION_MS);
  env.from = from;
  env.to = target;
  env.startMs = tMs;
  env.durationMs = Math.max(40, dur);
  env.active = true;
  env.pulseUntilMs = tMs + env.durationMs + 160;
  env.lastStepMs = tMs;
  return env;
}

export function stepCutEnvelope(env, tMs) {
  env.lastStepMs = tMs;
  if (env.active) {
    const elapsed = Math.max(0, tMs - env.startMs);
    const u = clamp(elapsed / Math.max(1, env.durationMs), 0, 1);
    const eased = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    env.progress = env.from + (env.to - env.from) * eased;
    if (u >= 1) {
      env.progress = env.to;
      env.active = false;
    }
  }
  const p = clamp(env.progress, 0, 1);
  const midBell = Math.sin(Math.PI * p);
  const elapsedActive = Math.max(0, tMs - env.startMs);
  const activeRatio = env.active ? clamp(elapsedActive / Math.max(1, env.durationMs), 0, 1) : 0;
  const activeBoost = env.active ? 0.35 * Math.sin(Math.PI * activeRatio) : 0;
  const tailDecay = env.pulseUntilMs > tMs
    ? clamp((env.pulseUntilMs - tMs) / 160, 0, 1) * 0.22
    : 0;
  const cutEnv = clamp(Math.max(midBell, activeBoost, tailDecay), 0, 1);
  return {
    progress: p,
    cutEnv,
    active: env.active || tMs < env.pulseUntilMs,
  };
}
// #endregion cut-envelope

// #region glitch-shaders
const PASSTHROUGH_FRAG = `#version 300 es
precision mediump float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

const QUAD_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const GLITCH_COMMON = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

vec4 sampleDom(sampler2D tex, vec2 topUv) {
  return texture(tex, clamp(topUv, vec2(0.001), vec2(0.999)));
}

vec2 pointerInfluence(vec2 topUv, vec4 ptr) {
  vec2 d = topUv - ptr.xy;
  float spot = exp(-dot(d, d) * 16.0);
  return ptr.zw * spot;
}
`;

// Pass 1: Ping-pong P-frame motion-smear persistence buffer
const SMEAR_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uPrevSmear;
uniform float uHasPrev;
uniform float uProgress;
uniform float uCutEnv;
uniform float uSeverity;
uniform int uMode;
uniform vec2 uSize;
uniform float uTime;
uniform vec4 uPointer;     // xy = topUv (0..1), zw = drag velocity
uniform float uDragEnergy; // 0..1
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;
${GLITCH_COMMON}

void main() {
  vec2 topUv = vec2(vUv.x, 1.0 - vUv.y);

  // At rest or under reduced motion, keep smear buffer clean with no stale ghosting
  float cutEnergy = clamp(max(uCutEnv, uDragEnergy) * (0.25 + 0.75 * uSeverity), 0.0, 1.0);
  if (uReduced > 0.5 || cutEnergy <= 0.002) {
    vec4 cleanSrc = uProgress < 0.5 ? sampleDom(uTexA, topUv) : sampleDom(uTexB, topUv);
    outColor = cleanSrc;
    return;
  }

  float tick = floor(uTime * 16.0);
  vec2 cellPx = uMode == 1 ? vec2(64.0, 16.0) : vec2(24.0, 24.0);
  vec2 grid = max(vec2(6.0), floor(uSize / cellPx));
  vec2 blockId = floor(topUv * grid);
  vec2 rnd = hash22(blockId + vec2(tick * 0.37, 11.7));

  vec2 ptrPush = pointerInfluence(topUv, uPointer) * (0.14 * uDragEnergy);
  vec2 blockVel = (rnd - 0.5) * vec2(0.11, 0.06) * cutEnergy + ptrPush;

  float blockGate = hash12(blockId * 1.31 + vec2(3.1, 7.7));
  float takeB = step(blockGate, uProgress);
  vec2 srcUvA = topUv + blockVel * (0.45 + 0.55 * rnd.x);
  vec2 srcUvB = topUv - blockVel * (0.45 + 0.55 * rnd.y);

  vec4 colA = sampleDom(uTexA, srcUvA);
  vec4 colB = sampleDom(uTexB, srcUvB);
  vec4 instMix = mix(colA, colB, takeB);

  if (uHasPrev > 0.5) {
    // Advect previous ping-pong smear FBO along simulated motion vector (vUv.y is flipped vs topUv.y)
    vec2 advectUv = clamp(vUv - vec2(blockVel.x, -blockVel.y) * 0.85, vec2(0.001), vec2(0.999));
    vec4 prevCol = texture(uPrevSmear, advectUv);
    float freezeMask = step(0.32, rnd.x) * cutEnergy;
    float persist = uMode == 0 ? 0.72 * freezeMask : 0.38 * freezeMask;
    outColor = mix(instMix, prevCol, persist);
  } else {
    outColor = instMix;
  }
}`;

// Pass 2: Composite View A, View B and ping-pong smear buffer onto default framebuffer
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTexA;
uniform sampler2D uTexB;
uniform sampler2D uSmearTex;
uniform float uProgress;
uniform float uCutEnv;
uniform float uSeverity;
uniform int uMode;
uniform vec2 uSize;
uniform float uTime;
uniform vec4 uPointer;
uniform float uDragEnergy;
uniform float uReduced;

in vec2 vUv;
out vec4 outColor;
${GLITCH_COMMON}

vec4 quantizeMacroblock(vec4 c, float amt) {
  float steps = mix(24.0, 6.0, amt);
  vec3 q = floor(c.rgb * steps + 0.5) / steps;
  return vec4(mix(c.rgb, q, amt * 0.55), c.a);
}

void main() {
  vec2 topUv = vec2(vUv.x, 1.0 - vUv.y);

  // Reduced motion: crisp geometric wipe with zero strobing, flicker or flash
  if (uReduced > 0.5) {
    if (uProgress <= 0.001) {
      outColor = sampleDom(uTexA, topUv);
      return;
    }
    if (uProgress >= 0.999) {
      outColor = sampleDom(uTexB, topUv);
      return;
    }
    float stepRow = floor(topUv.y * 10.0) / 10.0;
    float wipeCoord = topUv.x * 0.86 + stepRow * 0.14;
    float edge = uProgress * 1.04 - 0.02;
    float px = 1.6 / max(uSize.x, 1.0);
    float maskB = 1.0 - smoothstep(edge - px, edge + px, wipeCoord);
    vec4 colA = sampleDom(uTexA, topUv);
    vec4 colB = sampleDom(uTexB, topUv);
    vec4 wipeCol = mix(colA, colB, maskB);
    float line = 1.0 - smoothstep(0.0, px * 2.2, abs(wipeCoord - edge));
    wipeCol.rgb = mix(wipeCol.rgb, vec3(0.82, 0.29, 0.12), line * 0.9);
    outColor = wipeCol;
    return;
  }

  float cutEnergy = clamp(max(uCutEnv, uDragEnergy) * (0.22 + 0.78 * uSeverity), 0.0, 1.0);
  if (cutEnergy <= 0.002 && (uProgress <= 0.001 || uProgress >= 0.999)) {
    outColor = uProgress < 0.5 ? sampleDom(uTexA, topUv) : sampleDom(uTexB, topUv);
    return;
  }

  float tick = floor(uTime * 18.0);
  vec2 ptrPush = pointerInfluence(topUv, uPointer) * (0.16 * uDragEnergy);
  float ptrDist = length(topUv - uPointer.xy);
  float ptrSpot = exp(-ptrDist * ptrDist * 18.0) * uDragEnergy;

  if (uMode == 0) {
    // Mode 0: Block datamosh (macroblock UV displacement, stale View A tiles, ping-pong P-frame smear)
    vec2 coarseGrid = max(vec2(5.0), floor(uSize / 32.0));
    vec2 fineGrid = max(vec2(10.0), floor(uSize / 16.0));
    vec2 cId = floor(topUv * coarseGrid);
    vec2 fId = floor(topUv * fineGrid);
    vec2 cRnd = hash22(cId + vec2(tick * 0.25, 2.3));
    vec2 fRnd = hash22(fId + vec2(tick * 0.5, 5.9));

    float blockThresh = mix(cRnd.x, fRnd.x, 0.42);
    float inSeam = 1.0 - smoothstep(0.05, 0.42 + 0.20 * cutEnergy, abs(uProgress - blockThresh));
    float localGlitch = clamp(inSeam * cutEnergy + ptrSpot * 0.95, 0.0, 1.0);

    vec2 mv = (cRnd - 0.5) * vec2(0.16, 0.08) * localGlitch + ptrPush;
    float chooseB = step(blockThresh, uProgress + (cRnd.y - 0.5) * 0.16 * cutEnergy);

    // Hold stale displaced macroblocks of View A during forward cut, or smear from ping-pong FBO
    vec4 tileA = sampleDom(uTexA, topUv + mv);
    vec4 tileB = sampleDom(uTexB, topUv - mv * 0.55);
    vec4 smear = texture(uSmearTex, clamp(vUv + vec2(mv.x, -mv.y) * 0.65, vec2(0.001), vec2(0.999)));

    float staleMask = step(0.46, fRnd.y) * localGlitch;
    vec4 baseMix = mix(tileA, tileB, chooseB);
    baseMix = mix(baseMix, tileA, staleMask * 0.55);
    vec4 mosh = mix(baseMix, smear, clamp(0.62 * localGlitch, 0.0, 0.88));
    mosh = quantizeMacroblock(mosh, localGlitch * 0.75);

    // Subtle macroblock boundary compression tint on glitched edges
    vec2 cellFrac = fract(topUv * fineGrid);
    float edgeLine = (step(0.92, cellFrac.x) + step(0.92, cellFrac.y)) * step(0.62, fRnd.x) * localGlitch;
    mosh.rgb = mix(mosh.rgb, vec3(0.14, 0.92, 0.72), edgeLine * 0.35);
    outColor = mosh;
    return;
  }

  if (uMode == 1) {
    // Mode 1: Scan tear (horizontal H-sync slip + staggered slice bands + sync-loss blanking lines)
    float bandCount = max(16.0, floor(uSize.y / 14.0));
    float bandId = floor(topUv.y * bandCount);
    float bandHash = hash12(vec2(bandId, tick * 0.67 + 1.9));
    float rowNoise = hash12(vec2(floor(topUv.y * uSize.y * 0.5), tick + 9.1));

    float dir = mod(bandId, 2.0) < 0.5 ? 1.0 : -1.0;
    float slipMag = (0.04 + 0.24 * bandHash) * cutEnergy * (0.65 + 0.65 * ptrSpot);
    float slip = dir * slipMag + ptrPush.x * 1.4;
    float ragged = (rowNoise - 0.5) * 0.045 * cutEnergy;

    float bandGate = hash12(vec2(bandId * 1.73, 4.2));
    float takeB = step(bandGate, uProgress + 0.14 * (bandHash - 0.5) * cutEnergy);

    vec4 colA = sampleDom(uTexA, topUv + vec2(slip + ragged, 0.0));
    vec4 colB = sampleDom(uTexB, topUv - vec2(slip * 0.75 - ragged, 0.0));
    vec4 smear = texture(uSmearTex, clamp(vUv + vec2(slip * 0.4, 0.0), vec2(0.001), vec2(0.999)));
    vec4 torn = mix(mix(colA, colB, takeB), smear, 0.24 * cutEnergy);

    // Sync-loss dark blanking gap & bright sync spike on active tear borders
    float bandFrac = fract(topUv.y * bandCount);
    float seamBar = (1.0 - smoothstep(0.0, 0.11, bandFrac)) * step(0.55, bandHash) * cutEnergy;
    float spike = step(0.86, rowNoise) * seamBar;
    torn.rgb = mix(torn.rgb, vec3(0.03, 0.05, 0.08), seamBar * 0.75);
    torn.rgb = mix(torn.rgb, vec3(0.92, 0.98, 1.0), spike * 0.85);
    outColor = torn;
    return;
  }

  // Mode 2: Chroma shatter (RGB channel separation + corrupted parity lines)
  vec2 shardGrid = max(vec2(8.0), floor(uSize / vec2(44.0, 20.0)));
  vec2 shardId = floor(topUv * shardGrid);
  vec2 sRnd = hash22(shardId + vec2(tick * 0.41, 17.3));
  float rowIdx = floor(topUv.y * max(120.0, uSize.y * 0.6));
  float rowHash = hash12(vec2(rowIdx, tick * 0.83 + 3.7));

  float splitMag = (0.020 + 0.052 * uSeverity) * max(cutEnergy, 0.35 * ptrSpot);
  vec2 chromaVec = vec2(splitMag * (0.60 + 0.65 * sRnd.x), (sRnd.y - 0.5) * 0.014 * cutEnergy) + ptrPush * 0.9;

  vec2 uvR = topUv + chromaVec;
  vec2 uvG = topUv + chromaVec * vec2(0.12, -0.30);
  vec2 uvB = topUv - chromaVec;

  float baseGate = hash12(shardId + 2.7);
  float gateR = step(baseGate - 0.14 * cutEnergy, uProgress);
  float gateG = step(baseGate, uProgress);
  float gateB = step(baseGate + 0.14 * cutEnergy, uProgress);

  float r = mix(sampleDom(uTexA, uvR).r, sampleDom(uTexB, uvR).r, gateR);
  float g = mix(sampleDom(uTexA, uvG).g, sampleDom(uTexB, uvG).g, gateG);
  float b = mix(sampleDom(uTexA, uvB).b, sampleDom(uTexB, uvB).b, gateB);

  vec4 smear = texture(uSmearTex, vUv);
  vec3 rgb = mix(vec3(r, g, b), smear.rgb, 0.22 * cutEnergy);

  // Corrupted parity lines (1-2 px cyan/magenta/amber error scanlines)
  float parityHit = step(0.945 - 0.08 * cutEnergy, rowHash) * cutEnergy;
  vec3 parityTint = sRnd.x < 0.33
    ? vec3(0.14, 0.92, 1.0)
    : (sRnd.x < 0.66 ? vec3(1.0, 0.22, 0.72) : vec3(1.0, 0.76, 0.18));
  rgb = mix(rgb, parityTint, parityHit * 0.65);

  outColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}`;
// #endregion glitch-shaders

// #region glitch-pipeline
function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile error: ${log || 'failed'}`);
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
    throw new Error(`Program link error: ${log || 'failed'}`);
  }
  return p;
}

function makeFbo(gl, w, h) {
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

export class GlitchPipeline {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.progs = {
      smear: linkProgram(gl, QUAD_VERT, SMEAR_FRAG),
      composite: linkProgram(gl, QUAD_VERT, COMPOSITE_FRAG),
    };
    this.fbos = [null, null];
    this.fboW = 0;
    this.fboH = 0;
    this.ping = 0;
    this.hasSmear = false;
    this.uniforms = new WeakMap();
  }

  #u(prog, name) {
    let map = this.uniforms.get(prog);
    if (!map) {
      map = new Map();
      this.uniforms.set(prog, map);
    }
    let loc = map.get(name);
    if (loc === undefined) {
      loc = this.gl.getUniformLocation(prog, name);
      map.set(name, loc);
    }
    return loc;
  }

  #ensureFbos(targetW, targetH) {
    const w = Math.max(64, Math.min(720, Math.round(targetW)));
    const h = Math.max(64, Math.min(640, Math.round(targetH)));
    if (this.fbos[0] && this.fboW === w && this.fboH === h) return;
    const gl = this.gl;
    for (let i = 0; i < 2; i++) {
      if (this.fbos[i]) {
        gl.deleteFramebuffer(this.fbos[i].fbo);
        gl.deleteTexture(this.fbos[i].tex);
      }
      this.fbos[i] = makeFbo(gl, w, h);
    }
    this.fboW = w;
    this.fboH = h;
    this.hasSmear = false;
  }

  resetSmear() {
    this.hasSmear = false;
  }

  render({
    canvas,
    texA,
    texB,
    cw,
    ch,
    progress,
    cutEnv,
    severity,
    mode,
    timeSec,
    pointerUv,
    pointerVel,
    dragEnergy,
    reduced,
  }) {
    const gl = this.gl;
    if (!gl || gl.isContextLost() || !texA || !texB) return;

    this.#ensureFbos(canvas.width, canvas.height);
    const readIdx = this.ping;
    const writeIdx = 1 - this.ping;

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    // Pass 1: Update ping-pong motion-smear FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos[writeIdx].fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.useProgram(this.progs.smear);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.uniform1i(this.#u(this.progs.smear, 'uTexA'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(this.#u(this.progs.smear, 'uTexB'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos[readIdx].tex);
    gl.uniform1i(this.#u(this.progs.smear, 'uPrevSmear'), 2);
    gl.uniform1f(this.#u(this.progs.smear, 'uHasPrev'), this.hasSmear ? 1.0 : 0.0);
    gl.uniform1f(this.#u(this.progs.smear, 'uProgress'), progress);
    gl.uniform1f(this.#u(this.progs.smear, 'uCutEnv'), cutEnv);
    gl.uniform1f(this.#u(this.progs.smear, 'uSeverity'), severity);
    gl.uniform1i(this.#u(this.progs.smear, 'uMode'), mode);
    gl.uniform2f(this.#u(this.progs.smear, 'uSize'), cw, ch);
    gl.uniform1f(this.#u(this.progs.smear, 'uTime'), timeSec);
    gl.uniform4f(this.#u(this.progs.smear, 'uPointer'), pointerUv[0], pointerUv[1], pointerVel[0], pointerVel[1]);
    gl.uniform1f(this.#u(this.progs.smear, 'uDragEnergy'), dragEnergy);
    gl.uniform1f(this.#u(this.progs.smear, 'uReduced'), reduced ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Unbind custom FBO before compositing onto the default screen framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);

    // Pass 2: Screen composite
    gl.useProgram(this.progs.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texA);
    gl.uniform1i(this.#u(this.progs.composite, 'uTexA'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, texB);
    gl.uniform1i(this.#u(this.progs.composite, 'uTexB'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos[writeIdx].tex);
    gl.uniform1i(this.#u(this.progs.composite, 'uSmearTex'), 2);
    gl.uniform1f(this.#u(this.progs.composite, 'uProgress'), progress);
    gl.uniform1f(this.#u(this.progs.composite, 'uCutEnv'), cutEnv);
    gl.uniform1f(this.#u(this.progs.composite, 'uSeverity'), severity);
    gl.uniform1i(this.#u(this.progs.composite, 'uMode'), mode);
    gl.uniform2f(this.#u(this.progs.composite, 'uSize'), cw, ch);
    gl.uniform1f(this.#u(this.progs.composite, 'uTime'), timeSec);
    gl.uniform4f(this.#u(this.progs.composite, 'uPointer'), pointerUv[0], pointerUv[1], pointerVel[0], pointerVel[1]);
    gl.uniform1f(this.#u(this.progs.composite, 'uDragEnergy'), dragEnergy);
    gl.uniform1f(this.#u(this.progs.composite, 'uReduced'), reduced ? 1.0 : 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.ping = writeIdx;
    this.hasSmear = cutEnv > 0.002 || dragEnergy > 0.002;

    // Unbind VAO and restore default blend state
    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    for (let i = 0; i < 2; i++) {
      if (this.fbos[i]) {
        gl.deleteFramebuffer(this.fbos[i].fbo);
        gl.deleteTexture(this.fbos[i].tex);
        this.fbos[i] = null;
      }
    }
    for (const p of Object.values(this.progs)) gl.deleteProgram(p);
    if (this.vao) gl.deleteVertexArray(this.vao);
  }
}
// #endregion glitch-pipeline

// DOM references
const stageBox = document.getElementById('gc-stage');
const viewportEl = document.getElementById('gc-viewport');
let canvas = document.getElementById('gc-canvas');
const sceneA = document.getElementById('gc-scene-a');
const sceneB = document.getElementById('gc-scene-b');
const plainHost = document.getElementById('plain-host');
const noticeEl = document.getElementById('gc-notice');
const statusEl = document.getElementById('gc-status');
const testsBody = document.getElementById('tests');

// Scene A (Editorial Broadcast Feed) controls
const sceneAInput = document.getElementById('gc-a-input');
const sceneATitle = document.getElementById('gc-a-title');
const sceneASub = document.getElementById('gc-a-sub');
const sceneADesk = document.getElementById('gc-a-desk');
const sceneAPills = Array.from(document.querySelectorAll('#gc-a-flags button[data-flag]'));
const sceneACueBtn = document.getElementById('gc-a-cue-btn');
const sceneACueOut = document.getElementById('gc-a-cue-out');

// Scene B (Telemetry Node Console) controls
const sceneBInput = document.getElementById('gc-b-input');
const sceneBTerm = document.getElementById('gc-b-term');
const sceneBBuf = document.getElementById('gc-b-buf');
const sceneBBufBar = document.getElementById('gc-b-buf-bar');
const sceneBPkt = document.getElementById('gc-b-pkt');
const sceneBRoute = document.getElementById('gc-b-route');
const sceneBPills = Array.from(document.querySelectorAll('#gc-b-flags button[data-node-flag]'));
const sceneBFlushBtn = document.getElementById('gc-b-flush-btn');
const sceneBFlushOut = document.getElementById('gc-b-flush-out');

// External controls
const modeButtons = Array.from(document.querySelectorAll('#gc-presets button[data-mode]'));
const scrubSlider = document.getElementById('gc-scrub');
const scrubOut = document.getElementById('gc-scrub-out');
const triggerBtn = document.getElementById('gc-trigger');
const severitySlider = document.getElementById('gc-severity');
const severityOut = document.getElementById('gc-severity-out');
const reducedToggle = document.getElementById('gc-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedToggle.checked = true;

const state = {
  backend: 'init', // 'webgl' | '2d' | 'plain'
  mode: 'datamosh',
  envelope: createCutEnvelope(0),
  severity: Number(severitySlider.value) / 100,
  reducedOverride: reducedToggle.checked,
  hasPainted: false,
  dirtyA: true,
  dirtyB: true,
  onScreen: true,
  uploads: 0,
  paints: 0,
  rafId: 0,
  startMs: performance.now(),
  // Scene A live state
  cuesPushed: 0,
  flagsA: { lower3rd: true, wire: true, chyron: false },
  // Scene B live state
  flushes: 0,
  bufferPct: 84,
  flagsB: { autosync: true, trace: false, failover: false },
  // Pointer glitch inject state
  drag: null,
  pointerUv: [0.5, 0.5],
  pointerVel: [0, 0],
  dragEnergy: 0,
  dragLastMs: 0,
  // Geometry sync cache
  unitCache: { key: '', unit: 1 },
  lastGeoKey: '',
  lastStatusMs: 0,
};

let stage = null;
let pipeline = null;
let texA = null;
let texB = null;
let ctx2d = null;

function isReducedMotion() {
  return state.reducedOverride || reducedQuery.matches;
}

function showNotice(text) {
  noticeEl.hidden = !text;
  noticeEl.textContent = text || '';
}

function getViewportSize() {
  const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 356);
  const ch = Math.max(120, canvas.clientHeight || viewportEl.clientHeight || 396);
  return { cw, ch };
}

function syncSceneSizes(cw, ch) {
  if (state.backend === 'plain') {
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

function syncScenesDOM() {
  const headline = sceneAInput.value.trim() || 'NO BROADCAST HEADLINE';
  sceneATitle.textContent = headline;
  const activeFlagsA = Object.entries(state.flagsA).filter(([, v]) => v).map(([k]) => k);
  sceneASub.textContent = activeFlagsA.length
    ? `Active feeds: ${activeFlagsA.join(' · ')} · live sync`
    : 'All overlay feeds muted · clean slate';
  sceneADesk.textContent = state.flagsA.chyron ? 'STUDIO 4 · CHYRON ON' : 'STUDIO 4 · 1080i50';
  for (const btn of sceneAPills) {
    btn.setAttribute('aria-pressed', String(Boolean(state.flagsA[btn.dataset.flag])));
  }
  sceneACueOut.textContent = `Cues: ${state.cuesPushed} · ${state.flagsA.lower3rd ? 'ON AIR' : 'STANDBY'}`;

  const cmd = sceneBInput.value.trim() || 'node-07 --idle';
  sceneBTerm.textContent = `> filter: ${cmd}`;
  sceneBBuf.textContent = `${state.bufferPct}%`;
  sceneBBufBar.style.width = `${state.bufferPct}%`;
  sceneBPkt.textContent = state.flagsB.trace ? '2,480/s' : '1,240/s';
  sceneBRoute.textContent = state.flagsB.failover ? 'FAILOVER-B' : state.flagsB.autosync ? 'AUTO-SYNC' : 'MANUAL';
  for (const btn of sceneBPills) {
    btn.setAttribute('aria-pressed', String(Boolean(state.flagsB[btn.dataset.nodeFlag])));
  }
  sceneBFlushOut.textContent = `Flushes: ${state.flushes} · ${state.flagsB.failover ? 'BACKUP' : 'SYNC OK'}`;
}

function syncExternalControls() {
  const pct = Math.round(state.envelope.progress * 100);
  scrubSlider.value = String(pct);
  scrubOut.textContent = `${pct}%`;
  const sevPct = Math.round(state.severity * 100);
  severitySlider.value = String(sevPct);
  severityOut.textContent = `${sevPct}%`;
  for (const btn of modeButtons) {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === state.mode));
  }
  triggerBtn.textContent = state.envelope.progress < 0.5 ? 'Trigger cut to B' : 'Trigger cut to A';
}

function updateStatus(force = false) {
  const now = performance.now();
  if (!force && now - state.lastStatusMs < 120) return;
  state.lastStatusMs = now;
  const routeLabel = state.backend === 'webgl'
    ? 'WebGL 2 ElementGL'
    : state.backend === '2d'
      ? '2D drawElementImage()'
      : 'Plain HTML';
  const mp = state.backend === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
  const pct = Math.round(state.envelope.progress * 100);
  const activeName = state.envelope.progress < 0.5 ? 'Scene A (Broadcast)' : 'Scene B (Telemetry)';
  const modeText = isReducedMotion() ? 'Geometric wipe (reduced)' : MODES[state.mode].label;
  statusEl.textContent =
    `${routeLabel} · ${modeText} · Cut ${pct}% (${activeName}) · ` +
    `${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads`;
}

// #region glitch-geometry
export function syncSceneGeometry({
  canvasEl,
  elA,
  elB,
  cw,
  progress,
  plain = false,
  unitCache,
  lastGeoKeyRef,
  force = false,
}) {
  const activeIsA = progress < 0.5;
  if (plain) {
    elA.inert = false;
    elB.inert = false;
    return;
  }
  const activeEl = activeIsA ? elA : elB;
  const inactiveEl = activeIsA ? elB : elA;
  activeEl.inert = false;
  inactiveEl.inert = true;

  if (!canvasEl || typeof canvasEl.updateElementGeometry !== 'function') return;
  const dw = Math.max(1, activeEl.offsetWidth || cw);
  const zoom = activeEl.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${dw}/${zoom}`;
  if (unitCache.key !== uKey) {
    unitCache.unit = geometryUnit(canvasEl, activeEl, dw);
    unitCache.key = uKey;
    lastGeoKeyRef.value = '';
  }
  const u = unitCache.unit;
  const gKey = `${canvasEl.width}x${canvasEl.height}|${cw}|${activeIsA ? 'A' : 'B'}|${u.toFixed(4)}`;
  if (!force && lastGeoKeyRef.value === gKey) return;
  lastGeoKeyRef.value = gKey;

  canvasEl.updateElementGeometry(activeEl, {
    canvasTransform: new DOMMatrix().scale(u, u),
  });
  if (OFFSTAGE) {
    canvasEl.updateElementGeometry(inactiveEl, {
      canvasTransform: OFFSTAGE,
    });
  }
  activeEl.dataset.hitTick = activeEl.dataset.hitTick === '1' ? '0' : '1';
  inactiveEl.dataset.hitTick = inactiveEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion glitch-geometry

const geoKeyRef = {
  get value() { return state.lastGeoKey; },
  set value(v) { state.lastGeoKey = v; },
};

function changedContains(changedElements, root) {
  if (!changedElements?.length) return false;
  for (const el of changedElements) {
    if (el === root || root.contains(el)) return true;
  }
  return false;
}

function tryUploadScene(el, currentTex) {
  if (!stage || stage.lost) return currentTex;
  try {
    const t = stage.upload(el);
    if (t) {
      state.uploads++;
      return t;
    }
    return currentTex;
  } catch (err) {
    if (/paint record/i.test(err?.message ?? '')) {
      canvas.requestPaint?.();
      return currentTex;
    }
    throw err;
  }
}

// #region glitch-paint
function renderWebGL(tMs, changedElements = null) {
  if (!state.hasPainted || !stage || stage.lost || !pipeline) return false;
  const { cw, ch } = getViewportSize();
  syncSceneSizes(cw, ch);

  // Always call stage.begin() before stage.upload() so backing buffer matches CSS * DPR
  if (!stage.begin([0.04, 0.06, 0.09, 1.0])) return false;

  const needA = !texA || state.dirtyA || changedContains(changedElements, sceneA);
  const needB = !texB || state.dirtyB || changedContains(changedElements, sceneB);
  if (needA) {
    const nextA = tryUploadScene(sceneA, texA);
    if (nextA) { texA = nextA; state.dirtyA = false; }
  }
  if (needB) {
    const nextB = tryUploadScene(sceneB, texB);
    if (nextB) { texB = nextB; state.dirtyB = false; }
  }
  if (!texA || !texB) return false;

  const reduced = isReducedMotion();
  const envStep = stepCutEnvelope(state.envelope, tMs);

  // Decay pointer glitch drag energy smoothly
  const dtDrag = Math.max(0, tMs - state.dragLastMs);
  if (!state.drag && state.dragEnergy > 0) {
    state.dragEnergy = Math.max(0, state.dragEnergy - dtDrag / 260);
    state.pointerVel[0] *= 0.85;
    state.pointerVel[1] *= 0.85;
    if (state.dragEnergy < 0.005) {
      state.dragEnergy = 0;
      state.pointerVel[0] = 0;
      state.pointerVel[1] = 0;
    }
  }
  state.dragLastMs = tMs;

  const cutEnv = reduced ? 0 : envStep.cutEnv;
  const dragEnergy = reduced ? 0 : state.dragEnergy;

  pipeline.render({
    canvas,
    texA: texA.tex,
    texB: texB.tex,
    cw,
    ch,
    progress: envStep.progress,
    cutEnv,
    severity: state.severity,
    mode: MODES[state.mode].index,
    timeSec: ((tMs - state.startMs) / 1000) % 600,
    pointerUv: state.pointerUv,
    pointerVel: state.pointerVel,
    dragEnergy,
    reduced,
  });

  syncSceneGeometry({
    canvasEl: canvas,
    elA: sceneA,
    elB: sceneB,
    cw,
    progress: envStep.progress,
    unitCache: state.unitCache,
    lastGeoKeyRef: geoKeyRef,
  });
  syncExternalControls();
  state.paints++;
  updateStatus();

  const midHold = !reduced && envStep.progress > 0.01 && envStep.progress < 0.99;
  return envStep.active || dragEnergy > 0.005 || midHold;
}
// #endregion glitch-paint

// #region glitch-fallbacks
export function draw2DSliceTransition(ctx, elA, elB, {
  cw,
  ch,
  progress,
  severity = 0.75,
  mode = 'datamosh',
  reduced = false,
  timeSec = 0,
}) {
  const activeIsA = progress < 0.5;
  const baseEl = activeIsA ? elA : elB;
  const overEl = activeIsA ? elB : elA;
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawElementImage(baseEl, 0, 0, cw, ch);

  if (progress <= 0.001 || progress >= 0.999) {
    return;
  }

  if (reduced) {
    // Crisp geometric wipe using 5-argument drawElementImage()
    const splitX = Math.round(cw * progress);
    if (activeIsA && splitX > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, splitX, ch);
      ctx.clip();
      ctx.drawElementImage(elB, 0, 0, cw, ch);
      ctx.restore();
    } else if (!activeIsA && splitX < cw) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(splitX, 0, cw - splitX, ch);
      ctx.clip();
      ctx.drawElementImage(elA, 0, 0, cw, ch);
      ctx.restore();
    }
    ctx.fillStyle = '#d2491f';
    ctx.fillRect(splitX - 1, 0, 2, ch);
    return;
  }

  const slices = mode === 'scantear' ? 14 : 10;
  const bandH = ch / slices;
  const mixAmt = activeIsA ? progress : 1 - progress;
  for (let i = 0; i < slices; i++) {
    const h = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
    const rnd = h - Math.floor(h);
    if (rnd > mixAmt * 1.35) continue;
    const y = Math.floor(i * bandH);
    const bh = Math.ceil(bandH);
    const jitter = Math.round(((rnd - 0.5) * 2) * 22 * severity * Math.sin(Math.PI * progress + timeSec * 0.1));
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, y, cw, bh);
    ctx.clip();
    ctx.drawElementImage(overEl, jitter, 0, cw, ch);
    ctx.restore();
  }
}

function render2DFallback(tMs) {
  if (!state.hasPainted || !ctx2d) return false;
  const { cw, ch } = getViewportSize();
  syncSceneSizes(cw, ch);

  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const envStep = stepCutEnvelope(state.envelope, tMs);
  const reduced = isReducedMotion();

  ctx2d.save();
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw2DSliceTransition(ctx2d, sceneA, sceneB, {
    cw,
    ch,
    progress: envStep.progress,
    severity: state.severity,
    mode: state.mode,
    reduced,
    timeSec: (tMs - state.startMs) / 1000,
  });
  ctx2d.restore();

  syncSceneGeometry({
    canvasEl: canvas,
    elA: sceneA,
    elB: sceneB,
    cw,
    progress: envStep.progress,
    unitCache: state.unitCache,
    lastGeoKeyRef: geoKeyRef,
    force: true,
  });
  syncExternalControls();
  state.paints++;
  updateStatus();
  return envStep.active;
}

function enterPlainFallback(reason) {
  state.backend = 'plain';
  stopLoop();
  stageBox.classList.add('is-plain');
  syncSceneSizes(0, 0);
  syncSceneGeometry({
    canvasEl: canvas,
    elA: sceneA,
    elB: sceneB,
    cw: 0,
    progress: state.envelope.progress,
    plain: true,
    unitCache: state.unitCache,
    lastGeoKeyRef: geoKeyRef,
  });
  if (sceneA.parentElement !== plainHost) plainHost.append(sceneA);
  if (sceneB.parentElement !== plainHost) plainHost.append(sceneB);
  showNotice(reason);
  updateStatus(true);
}

function exitPlainFallback() {
  stageBox.classList.remove('is-plain');
  if (sceneA.parentElement !== canvas) canvas.append(sceneA);
  if (sceneB.parentElement !== canvas) canvas.append(sceneB);
  showNotice('');
}

function wireCanvasEvents(cv) {
  cv.addEventListener('paint', (e) => {
    state.hasPainted = true;
    const now = performance.now();
    let keep = false;
    if (state.backend === 'webgl' && stage && !stage.lost) {
      keep = renderWebGL(now, e?.changedElements ?? null);
    } else if (state.backend === '2d' && ctx2d) {
      keep = render2DFallback(now);
    }
    if (keep) startLoop();
  });

  cv.addEventListener('contextlost', (e) => {
    e.preventDefault();
    if (state.backend === '2d') {
      enterPlainFallback('The 2D canvas context was lost. Showing both scenes as plain HTML.');
    }
  });

  cv.addEventListener('contextrestored', () => {
    if (state.backend === 'plain' && ctx2d) {
      state.backend = '2d';
      state.hasPainted = false;
      state.lastGeoKey = '';
      exitPlainFallback();
      const { cw, ch } = getViewportSize();
      syncSceneSizes(cw, ch);
      cv.requestPaint?.();
    }
  });

  // Prevent accidental native text selection during drag glitch injection outside <input>
  cv.addEventListener('selectstart', (e) => {
    if (!e.target?.closest?.('input, textarea')) {
      e.preventDefault();
    }
  });

  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (e.target?.closest?.('input, textarea, button, label, a')) return;
    const rect = cv.getBoundingClientRect();
    state.drag = {
      id: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      rect,
    };
    state.pointerUv[0] = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    state.pointerUv[1] = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    try { cv.setPointerCapture?.(e.pointerId); } catch {}
  });

  cv.addEventListener('pointermove', (e) => {
    if (!state.drag || e.pointerId !== state.drag.id) return;
    const rect = state.drag.rect;
    const dx = e.clientX - state.drag.lastX;
    const dy = e.clientY - state.drag.lastY;
    state.drag.lastX = e.clientX;
    state.drag.lastY = e.clientY;
    state.pointerUv[0] = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    state.pointerUv[1] = clamp((e.clientY - rect.top) / Math.max(1, rect.height), 0, 1);
    state.pointerVel[0] = clamp(dx / Math.max(20, rect.width * 0.25), -1, 1);
    state.pointerVel[1] = clamp(dy / Math.max(20, rect.height * 0.25), -1, 1);
    if (Math.hypot(dx, dy) > 1.5 && !isReducedMotion()) {
      state.dragEnergy = clamp(state.dragEnergy + Math.hypot(dx, dy) / 34, 0.2, 1.0);
      state.dragLastMs = performance.now();
      cv.requestPaint?.();
      startLoop();
    }
  });

  const endDrag = (e) => {
    if (!state.drag || e.pointerId !== state.drag.id) return;
    state.drag = null;
    try { cv.releasePointerCapture?.(e.pointerId); } catch {}
  };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
}

function initBackend() {
  const { cw, ch } = getViewportSize();
  syncSceneSizes(cw, ch);

  if (hicSupported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: PASSTHROUGH_FRAG,
        onLost: () => {
          texA = null;
          texB = null;
          pipeline = null;
          enterPlainFallback('The WebGL 2 context was lost. Showing both scenes in plain HTML until restored.');
        },
        onRestored: () => {
          stage?.gl?.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          pipeline = stage?.gl ? new GlitchPipeline(stage.gl) : null;
          texA = null;
          texB = null;
          state.backend = 'webgl';
          state.hasPainted = false;
          state.dirtyA = true;
          state.dirtyB = true;
          state.unitCache.key = '';
          state.lastGeoKey = '';
          exitPlainFallback();
          const size = getViewportSize();
          syncSceneSizes(size.cw, size.ch);
          canvas.requestPaint?.();
        },
      });
      stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      pipeline = new GlitchPipeline(stage.gl);
      state.backend = 'webgl';
      wireCanvasEvents(canvas);
      canvas.requestPaint?.();
      return;
    } catch (err) {
      stage = null;
      pipeline = null;
      const fresh = document.createElement('canvas');
      fresh.id = 'gc-canvas';
      fresh.setAttribute('content', 'drawable');
      fresh.setAttribute('layoutsubtree', '');
      fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
      fresh.append(sceneA, sceneB);
      canvas.replaceWith(fresh);
      window.__gfx?.retire?.(canvas);
      canvas = fresh;
      showNotice(`WebGL 2 could not start (${err.message}). Using the 2D slice fallback.`);
    }
  }

  if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
    try {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        state.backend = '2d';
        if (noticeEl.hidden) {
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() slice fallback.');
        }
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      }
    } catch {}
  }

  enterPlainFallback('HTML-in-canvas is not available in this browser, so both views are shown as plain HTML.');
}
// #endregion glitch-fallbacks

function stopLoop() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function shouldKeepAnimating() {
  if (!state.onScreen || document.hidden || state.backend === 'plain') return false;
  const env = state.envelope;
  const p = env.progress;
  const reduced = isReducedMotion();
  if (env.active || performance.now() < env.pulseUntilMs) return true;
  if (!reduced && (state.dragEnergy > 0.005 || (p > 0.01 && p < 0.99))) return true;
  return false;
}

function tick(now) {
  state.rafId = 0;
  if (!state.onScreen || document.hidden || state.backend === 'plain') return;

  let keep = false;
  if (state.hasPainted) {
    if (state.backend === 'webgl') keep = renderWebGL(now, null);
    else if (state.backend === '2d') keep = render2DFallback(now);
  }
  if (keep || shouldKeepAnimating()) {
    state.rafId = requestAnimationFrame(tick);
  }
}

function startLoop() {
  if (state.rafId || !shouldKeepAnimating()) return;
  state.rafId = requestAnimationFrame(tick);
}

function drawOrPaintNow(markDirtyA = false, markDirtyB = false) {
  if (markDirtyA) state.dirtyA = true;
  if (markDirtyB) state.dirtyB = true;
  if (state.backend === 'plain') {
    updateStatus(true);
    return;
  }
  if (!state.hasPainted) {
    canvas.requestPaint?.();
    return;
  }
  if (state.backend === 'webgl') renderWebGL(performance.now(), null);
  else if (state.backend === '2d') render2DFallback(performance.now());
  startLoop();
}

// Scene A event handlers
sceneAInput.addEventListener('input', () => {
  syncScenesDOM();
  drawOrPaintNow(true, false);
});
for (const btn of sceneAPills) {
  btn.addEventListener('click', () => {
    const k = btn.dataset.flag;
    state.flagsA[k] = !state.flagsA[k];
    syncScenesDOM();
    drawOrPaintNow(true, false);
  });
}
sceneACueBtn.addEventListener('click', () => {
  state.cuesPushed++;
  syncScenesDOM();
  drawOrPaintNow(true, false);
});

// Scene B event handlers
sceneBInput.addEventListener('input', () => {
  syncScenesDOM();
  drawOrPaintNow(false, true);
});
for (const btn of sceneBPills) {
  btn.addEventListener('click', () => {
    const k = btn.dataset.nodeFlag;
    state.flagsB[k] = !state.flagsB[k];
    syncScenesDOM();
    drawOrPaintNow(false, true);
  });
}
sceneBFlushBtn.addEventListener('click', () => {
  state.flushes++;
  state.bufferPct = state.bufferPct > 28 ? Math.max(12, state.bufferPct - 24) : 84;
  syncScenesDOM();
  drawOrPaintNow(false, true);
});

sceneA.addEventListener('focusin', () => drawOrPaintNow(true, false));
sceneA.addEventListener('focusout', () => drawOrPaintNow(true, false));
sceneB.addEventListener('focusin', () => drawOrPaintNow(false, true));
sceneB.addEventListener('focusout', () => drawOrPaintNow(false, true));

// External controls
for (const btn of modeButtons) {
  btn.addEventListener('click', () => {
    const next = btn.dataset.mode;
    if (!(next in MODES)) return;
    state.mode = next;
    pipeline?.resetSmear();
    syncExternalControls();
    drawOrPaintNow(false, false);
  });
}

scrubSlider.addEventListener('input', () => {
  const p = clamp(Number(scrubSlider.value) / 100, 0, 1);
  state.envelope.active = false;
  state.envelope.progress = p;
  state.envelope.from = p;
  state.envelope.to = p;
  state.envelope.pulseUntilMs = 0;
  if (p <= 0.001 || p >= 0.999) pipeline?.resetSmear();
  syncExternalControls();
  drawOrPaintNow(false, false);
});

severitySlider.addEventListener('input', () => {
  state.severity = clamp(Number(severitySlider.value) / 100, 0, 1);
  syncExternalControls();
  drawOrPaintNow(false, false);
});

triggerBtn.addEventListener('click', () => {
  const reduced = isReducedMotion();
  const target = state.envelope.progress < 0.5 ? 1 : 0;
  pipeline?.resetSmear();
  triggerCutEnvelope(state.envelope, {
    to: target,
    tMs: performance.now(),
    reduced,
  });
  syncExternalControls();
  if (state.backend === 'plain') {
    state.envelope.progress = target;
    state.envelope.active = false;
    syncExternalControls();
    updateStatus(true);
    return;
  }
  if (state.hasPainted) {
    if (state.backend === 'webgl') renderWebGL(performance.now(), null);
    else if (state.backend === '2d') render2DFallback(performance.now());
  } else {
    canvas.requestPaint?.();
  }
  startLoop();
});

reducedToggle.addEventListener('change', () => {
  state.reducedOverride = reducedToggle.checked;
  if (isReducedMotion()) {
    state.dragEnergy = 0;
    pipeline?.resetSmear();
  }
  drawOrPaintNow(false, false);
});

reducedQuery.addEventListener?.('change', () => {
  reducedToggle.checked = reducedQuery.matches;
  state.reducedOverride = reducedQuery.matches;
  if (isReducedMotion()) {
    state.dragEnergy = 0;
    pipeline?.resetSmear();
  }
  drawOrPaintNow(false, false);
});

if (typeof IntersectionObserver !== 'undefined') {
  new IntersectionObserver(([entry]) => {
    state.onScreen = Boolean(entry?.isIntersecting);
    if (!state.onScreen) {
      stopLoop();
    } else if (state.backend !== 'plain' && state.hasPainted) {
      drawOrPaintNow(false, false);
    }
  }, { rootMargin: '80px' }).observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopLoop();
  } else if (state.onScreen && state.backend !== 'plain' && state.hasPainted) {
    drawOrPaintNow(false, false);
  }
});

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => {
    if (state.backend === 'plain') return;
    state.unitCache.key = '';
    state.lastGeoKey = '';
    const { cw, ch } = getViewportSize();
    syncSceneSizes(cw, ch);
    drawOrPaintNow(true, true);
  }).observe(viewportEl);
}

window.addEventListener('pagehide', () => {
  stopLoop();
  pipeline?.dispose();
  pipeline = null;
  stage?.dispose();
  stage = null;
});

syncScenesDOM();
syncExternalControls();
initBackend();
updateStatus(true);

// ---------------------------------------------------------------- live checks (isolated testStage fixtures)
const need = (ok, detail) => {
  if (!ok) throw new Error(detail);
  return detail;
};

function readCssPixel(gl, cv, w, h, cssX, cssY) {
  const px = new Uint8Array(4);
  const rx = Math.max(0, Math.min(cv.width - 1, Math.round(cssX * (cv.width / w))));
  const ry = Math.max(0, Math.min(cv.height - 1, Math.round((h - cssY) * (cv.height / h))));
  gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}

function makeDualFixture(w = 240, h = 160, htmlA = '', htmlB = '') {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `display:block;position:relative;width:${w}px;height:${h}px;user-select:none`;

  const mk = (bg, fg, html) => {
    const el = document.createElement('div');
    el.setAttribute('drawable', '');
    el.style.cssText =
      `position:absolute;left:0;top:0;width:${w}px;height:${h}px;overflow:hidden;box-sizing:border-box;` +
      `background:${bg};color:${fg};font:700 12px system-ui;`;
    el.innerHTML = html;
    return el;
  };
  const elA = mk('#faf6ec', '#171614', htmlA);
  const elB = mk('#09111f', '#e5f2ff', htmlB);
  cv.append(elA, elB);
  testStage().append(cv);
  return { cv, elA, elB };
}

runTests(testsBody, [
  {
    name: 'Dual-scene upload, FBO unbind and VAO unbind succeed with gl.getError() === 0',
    expect: 'pass',
    why: 'Creates an isolated ElementGL + GlitchPipeline fixture, sets UNPACK_PREMULTIPLY_ALPHA_WEBGL = true, runs begin() before upload(), renders at 0% and 100%, and checks FBO/VAO unbind + readPixels().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const W = 240;
      const H = 160;
      const { cv, elA, elB } = makeDualFixture(
        W,
        H,
        '<div style="position:absolute;inset:0;background:#d2491f"></div>',
        '<div style="position:absolute;inset:0;background:#22d3ee"></div>'
      );
      let g = null;
      let p = null;
      try {
        g = new ElementGL(cv, { fragment: PASSTHROUGH_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlitchPipeline(g.gl);
        await nextPaint(cv);

        g.begin([0, 0, 0, 1]);
        const tA = g.upload(elA);
        const tB = g.upload(elB);
        p.render({
          canvas: cv,
          texA: tA.tex,
          texB: tB.tex,
          cw: W,
          ch: H,
          progress: 0.0,
          cutEnv: 0.0,
          severity: 0.8,
          mode: 0,
          timeSec: 0.0,
          pointerUv: [0.5, 0.5],
          pointerVel: [0, 0],
          dragEnergy: 0,
          reduced: false,
        });
        const fboBound = g.gl.getParameter(g.gl.FRAMEBUFFER_BINDING);
        const vaoBound = g.gl.getParameter(g.gl.VERTEX_ARRAY_BINDING);
        const pxA = readCssPixel(g.gl, cv, W, H, 120, 80);

        p.render({
          canvas: cv,
          texA: tA.tex,
          texB: tB.tex,
          cw: W,
          ch: H,
          progress: 1.0,
          cutEnv: 0.0,
          severity: 0.8,
          mode: 0,
          timeSec: 0.8,
          pointerUv: [0.5, 0.5],
          pointerVel: [0, 0],
          dragEnergy: 0,
          reduced: false,
        });
        const err = g.gl.getError();
        const pxB = readCssPixel(g.gl, cv, W, H, 120, 80);

        return need(
          err === g.gl.NO_ERROR && fboBound === null && vaoBound === null &&
          pxA[0] > 180 && pxA[2] < 60 && pxB[2] > 180 && pxB[0] < 60,
          `glErr=${err}, fbo=${fboBound}, vao=${vaoBound}, pxA=[${Array.from(pxA)}], pxB=[${Array.from(pxB)}].`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Macroblock tearing and RGB channel split peak at mid-cut vs 0% rest',
    expect: 'pass',
    why: 'Drives createCutEnvelope() + stepCutEnvelope(env, tMs) across tMs = 0 (rest) and tMs = 390 (mid-cut) for Block datamosh and Chroma shatter, measuring mixed tiles and RGB channel spread.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const W = 240;
      const H = 160;
      const { cv, elA, elB } = makeDualFixture(
        W,
        H,
        '<div style="position:absolute;left:0;top:0;width:120px;height:160px;background:#ffffff"></div><div style="position:absolute;left:120px;top:0;width:120px;height:160px;background:#111318"></div>',
        '<div style="position:absolute;left:0;top:0;width:120px;height:160px;background:#0a1526"></div><div style="position:absolute;left:120px;top:0;width:120px;height:160px;background:#ffffff"></div>'
      );
      let g = null;
      let p = null;
      try {
        g = new ElementGL(cv, { fragment: PASSTHROUGH_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlitchPipeline(g.gl);
        await nextPaint(cv);

        g.begin([0, 0, 0, 1]);
        const tA = g.upload(elA);
        const tB = g.upload(elB);

        const env = createCutEnvelope(0);
        const s0 = stepCutEnvelope(env, 0);
        p.render({
          canvas: cv, texA: tA.tex, texB: tB.tex, cw: W, ch: H,
          progress: s0.progress, cutEnv: s0.cutEnv, severity: 0.9, mode: 0,
          timeSec: 0, pointerUv: [0.5, 0.5], pointerVel: [0, 0], dragEnergy: 0, reduced: false,
        });

        const pts = [];
        for (let y = 16; y <= 144; y += 32) {
          for (let x = 24; x <= 216; x += 24) pts.push([x, y]);
        }
        const restPixels = pts.map(([x, y]) => Array.from(readCssPixel(g.gl, cv, W, H, x, y)));

        triggerCutEnvelope(env, { to: 1, tMs: 0, durationMs: 780, reduced: false });
        const sMid = stepCutEnvelope(env, 390);
        p.render({
          canvas: cv, texA: tA.tex, texB: tB.tex, cw: W, ch: H,
          progress: sMid.progress, cutEnv: sMid.cutEnv, severity: 0.9, mode: 0,
          timeSec: 0.39, pointerUv: [0.5, 0.5], pointerVel: [0, 0], dragEnergy: 0, reduced: false,
        });
        let moshChanged = 0;
        for (let i = 0; i < pts.length; i++) {
          const px = readCssPixel(g.gl, cv, W, H, pts[i][0], pts[i][1]);
          const diff = Math.abs(px[0] - restPixels[i][0]) + Math.abs(px[1] - restPixels[i][1]) + Math.abs(px[2] - restPixels[i][2]);
          if (diff > 60) moshChanged++;
        }

        // Measure Chroma shatter RGB separation around the vertical white/dark edge (x = 108..132)
        p.resetSmear();
        p.render({
          canvas: cv, texA: tA.tex, texB: tB.tex, cw: W, ch: H,
          progress: sMid.progress, cutEnv: sMid.cutEnv, severity: 0.95, mode: 2,
          timeSec: 0.39, pointerUv: [0.5, 0.5], pointerVel: [0, 0], dragEnergy: 0, reduced: false,
        });
        const err = g.gl.getError();
        let maxChromaSplit = 0;
        for (let y = 20; y <= 140; y += 16) {
          for (let x = 104; x <= 136; x += 4) {
            const px = readCssPixel(g.gl, cv, W, H, x, y);
            maxChromaSplit = Math.max(maxChromaSplit, Math.abs(px[0] - px[2]));
          }
        }

        return need(
          err === g.gl.NO_ERROR && moshChanged >= 12 && maxChromaSplit >= 45,
          `mid-cut tMs=390 p=${sMid.progress.toFixed(2)}: moshChanged=${moshChanged}/${pts.length}, maxRGBSplit=${maxChromaSplit}, glErr=${err}.`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Block datamosh, Scan tear and Reduced-motion wipe produce distinct outputs',
    expect: 'pass',
    why: 'Renders identical mid-cut inputs (p = 0.50, severity = 0.85, tMs = 300) across Block datamosh, Scan tear and Reduced motion, comparing sampled grids.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
      const W = 240;
      const H = 160;
      const { cv, elA, elB } = makeDualFixture(
        W,
        H,
        '<div style="position:absolute;inset:0;background:linear-gradient(90deg,#d2491f 0 50%,#faf6ec 50% 100%)"></div>',
        '<div style="position:absolute;inset:0;background:linear-gradient(180deg,#09111f 0 50%,#22d3ee 50% 100%)"></div>'
      );
      let g = null;
      let p = null;
      try {
        g = new ElementGL(cv, { fragment: PASSTHROUGH_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlitchPipeline(g.gl);
        await nextPaint(cv);

        g.begin([0, 0, 0, 1]);
        const tA = g.upload(elA);
        const tB = g.upload(elB);

        const pts = [];
        for (let y = 12; y <= 148; y += 28) {
          for (let x = 16; x <= 224; x += 26) pts.push([x, y]);
        }

        const captureMode = (mode, reduced) => {
          p.resetSmear();
          p.render({
            canvas: cv, texA: tA.tex, texB: tB.tex, cw: W, ch: H,
            progress: 0.5, cutEnv: reduced ? 0 : 1.0, severity: 0.85, mode,
            timeSec: 0.30, pointerUv: [0.5, 0.5], pointerVel: [0, 0], dragEnergy: 0, reduced,
          });
          return pts.map(([x, y]) => Array.from(readCssPixel(g.gl, cv, W, H, x, y)));
        };

        const mosh = captureMode(0, false);
        const tear = captureMode(1, false);
        const wipe = captureMode(0, true);
        const err = g.gl.getError();

        const diffCount = (a, b) => {
          let n = 0;
          for (let i = 0; i < a.length; i++) {
            const d = Math.abs(a[i][0] - b[i][0]) + Math.abs(a[i][1] - b[i][1]) + Math.abs(a[i][2] - b[i][2]);
            if (d > 48) n++;
          }
          return n;
        };

        const moshVsTear = diffCount(mosh, tear);
        const moshVsWipe = diffCount(mosh, wipe);

        return need(
          err === g.gl.NO_ERROR && moshVsTear >= 10 && moshVsWipe >= 8,
          `moshVsTear=${moshVsTear}/${pts.length}, moshVsReducedWipe=${moshVsWipe}/${pts.length}, glErr=${err}.`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'updateElementGeometry() routes live DOM hits exclusively to Scene A at 0% and Scene B at 100%',
    expect: 'pass',
    why: 'Syncs geometryUnit(), updateElementGeometry(), inert and data-hit-tick for both fixture scenes at 0% and 100%, verifying elementsFromPoint() and clicks.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available.');
      }
      const W = 240;
      const H = 160;
      const { cv, elA, elB } = makeDualFixture(
        W,
        H,
        '<div style="padding:14px;display:flex;flex-direction:column;gap:10px">' +
          '<input id="fx-a-inp" type="text" inputmode="none" value="WIRE" style="width:180px;height:34px">' +
          '<button id="fx-a-btn" type="button" style="width:120px;height:40px">Push cue</button>' +
        '</div>',
        '<div style="padding:14px;display:flex;flex-direction:column;gap:10px">' +
          '<input id="fx-b-inp" type="text" inputmode="none" value="NODE" style="width:180px;height:34px">' +
          '<button id="fx-b-btn" type="button" style="width:120px;height:40px">Flush</button>' +
        '</div>'
      );
      let g = null;
      let p = null;
      const uCache = { key: '', unit: 1 };
      const gRef = { value: '' };
      try {
        if (glSupported) {
          g = new ElementGL(cv, { fragment: PASSTHROUGH_FRAG });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          p = new GlitchPipeline(g.gl);
          await nextPaint(cv);
          g.begin([0, 0, 0, 1]);
          const tA = g.upload(elA);
          const tB = g.upload(elB);
          p.render({
            canvas: cv, texA: tA.tex, texB: tB.tex, cw: W, ch: H,
            progress: 0, cutEnv: 0, severity: 0.7, mode: 0, timeSec: 0,
            pointerUv: [0.5, 0.5], pointerVel: [0, 0], dragEnergy: 0, reduced: false,
          });
        } else {
          cv.width = W;
          cv.height = H;
          const ctx = cv.getContext('2d');
          cv.addEventListener('paint', () => {
            ctx.reset();
            ctx.drawElementImage(elA, 0, 0, W, H);
          });
          await nextPaint(cv);
        }

        const btnA = elA.querySelector('#fx-a-btn');
        const inpA = elA.querySelector('#fx-a-inp');
        const btnB = elB.querySelector('#fx-b-btn');
        const inpB = elB.querySelector('#fx-b-inp');
        let clicksA = 0;
        let clicksB = 0;
        btnA.addEventListener('click', () => { clicksA++; });
        btnB.addEventListener('click', () => { clicksB++; });

        const hitAt = (el) => {
          const r = el.getBoundingClientRect();
          return document.elementsFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.5);
        };

        // 0% rest -> Scene A interactive, Scene B inert & offstage
        syncSceneGeometry({ canvasEl: cv, elA, elB, cw: W, progress: 0, unitCache: uCache, lastGeoKeyRef: gRef, force: true });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hitA0 = hitAt(btnA).includes(btnA) && hitAt(inpA).includes(inpA) && elB.inert && !hitAt(btnB).includes(btnB);
        btnA.click();

        // 100% rest -> Scene B interactive, Scene A inert & offstage
        syncSceneGeometry({ canvasEl: cv, elA, elB, cw: W, progress: 1, unitCache: uCache, lastGeoKeyRef: gRef, force: true });
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const hitB100 = hitAt(btnB).includes(btnB) && hitAt(inpB).includes(inpB) && elA.inert && !hitAt(btnA).includes(btnA);
        btnB.click();

        return need(
          hitA0 && hitB100 && clicksA === 1 && clicksB === 1,
          `at0%=${hitA0} (clicksA=${clicksA}), at100%=${hitB100} (clicksB=${clicksB}).`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        cv.remove();
        window.__gfx?.retire?.(cv);
      }
    },
  },
  {
    name: 'Synthetic webglcontextlost/restored recovery and 5-arg 2D slice fallback both work',
    expect: 'pass',
    why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored on an ElementGL fixture without calling loseContext(), then checks draw2DSliceTransition() via a plain drawImage() copy.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('HTML-in-canvas WebGL 2 is not available.');
      const W = 200;
      const H = 120;
      const wrap = document.createElement('div');
      const plain = document.createElement('div');
      plain.hidden = true;
      const cv = document.createElement('canvas');
      cv.setAttribute('content', 'drawable');
      cv.setAttribute('layoutsubtree', '');
      cv.style.cssText = `display:block;position:relative;width:${W}px;height:${H}px;`;
      const fA = document.createElement('div');
      fA.setAttribute('drawable', '');
      fA.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;background:#d2491f;`;
      const fB = document.createElement('div');
      fB.setAttribute('drawable', '');
      fB.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;background:#22d3ee;`;
      cv.append(fA, fB);
      wrap.append(cv, plain);
      testStage().append(wrap);

      let g = null;
      let p = null;
      let cv2d = null;
      let lostOk = false;
      let restoredOk = false;
      try {
        g = new ElementGL(cv, {
          fragment: PASSTHROUGH_FRAG,
          onLost: () => {
            lostOk = true;
            p = null;
            plain.hidden = false;
            plain.append(fA, fB);
          },
          onRestored: () => {
            restoredOk = true;
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            p = new GlitchPipeline(g.gl);
            plain.hidden = true;
            cv.append(fA, fB);
          },
        });
        g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        p = new GlitchPipeline(g.gl);
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tA = g.upload(fA);
        const tB = g.upload(fB);
        p.render({
          canvas: cv, texA: tA.tex, texB: tB.tex, cw: W, ch: H,
          progress: 0, cutEnv: 0, severity: 0.7, mode: 0, timeSec: 0,
          pointerUv: [0.5, 0.5], pointerVel: [0, 0], dragEnergy: 0, reduced: false,
        });

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        cv.dispatchEvent(lostEv);
        const rescued = lostEv.defaultPrevented && g.lost && lostOk && plain.contains(fA) && plain.contains(fB);

        cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(cv);
        g.begin([0, 0, 0, 1]);
        const tA2 = g.upload(fA);
        const tB2 = g.upload(fB);
        p.render({
          canvas: cv, texA: tA2.tex, texB: tB2.tex, cw: W, ch: H,
          progress: 1, cutEnv: 0, severity: 0.7, mode: 0, timeSec: 0.8,
          pointerUv: [0.5, 0.5], pointerVel: [0, 0], dragEnergy: 0, reduced: false,
        });
        const glErr = g.gl.getError();

        // Now verify 5-argument 2D slice fallback via a plain drawImage() copy
        const dpr = Math.min(window.devicePixelRatio || 1, 3);
        cv2d = document.createElement('canvas');
        cv2d.setAttribute('content', 'drawable');
        cv2d.setAttribute('layoutsubtree', '');
        cv2d.style.cssText = `display:block;position:relative;width:${W}px;height:${H}px;`;
        cv2d.width = Math.round(W * dpr);
        cv2d.height = Math.round(H * dpr);
        const dA = document.createElement('div');
        dA.setAttribute('drawable', '');
        dA.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;background:#d2491f;`;
        const dB = document.createElement('div');
        dB.setAttribute('drawable', '');
        dB.style.cssText = `position:absolute;inset:0;width:${W}px;height:${H}px;background:#22d3ee;`;
        cv2d.append(dA, dB);
        testStage().append(cv2d);
        const c2 = cv2d.getContext('2d');
        await nextPaint(cv2d);
        c2.save();
        c2.setTransform(dpr, 0, 0, dpr, 0, 0);
        draw2DSliceTransition(c2, dA, dB, {
          cw: W, ch: H, progress: 0.5, severity: 0.85, mode: 'datamosh', reduced: true, timeSec: 0,
        });
        c2.restore();

        const copy = document.createElement('canvas');
        copy.width = cv2d.width;
        copy.height = cv2d.height;
        const cc = copy.getContext('2d', { willReadFrequently: true });
        cc.drawImage(cv2d, 0, 0);
        const leftPx = cc.getImageData(Math.round(30 * dpr), Math.round(60 * dpr), 1, 1).data;
        const rightPx = cc.getImageData(Math.round(170 * dpr), Math.round(60 * dpr), 1, 1).data;
        const sawBoth2D = leftPx[2] > 170 && leftPx[0] < 60 && rightPx[0] > 170 && rightPx[2] < 60;

        return need(
          rescued && restoredOk && !g.lost && cv.contains(fA) && cv.contains(fB) && glErr === g.gl.NO_ERROR && sawBoth2D,
          `rescued=${rescued}, restored=${restoredOk}, glErr=${glErr}, 2dLeft=[${Array.from(leftPx)}], 2dRight=[${Array.from(rightPx)}].`
        );
      } finally {
        p?.dispose();
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(cv);
        cv2d?.remove();
        window.__gfx?.retire?.(cv2d);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'glitch-cut stage',
      ink: async () => {
        if (state.backend === 'plain') return null;
        if (state.backend === 'webgl') {
          if (!stage || stage.lost || !texA || !texB) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          if ((window.__gfx?.snapshots?.open ?? 0) > 0) throw new Error(`openSnapshots=${window.__gfx.snapshots.open}`);
          return state.paints > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => enterPlainFallback('Canvas drew blank after live checks.'),
    },
  ]),
]);
