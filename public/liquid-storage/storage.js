import { banner, supported as hicSupported, runTests, nextPaint, testStage, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

banner();

export const TOTAL_CAPACITY_GB = 128;
export const METER_MAX_GB = 64;
export const DEFAULT_ALLOC = Object.freeze({ apps: 28, media: 24, cache: 18, system: 12 });

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// #region fluid-physics
/** Convert a 0..100% quota target into balanced GB buckets across Apps, Media, Cache and System. */
export function allocationFromPercent(pct) {
  const p = clamp(Number(pct) || 0, 0, 100);
  if (p <= 0.1) return { apps: 0, media: 0, cache: 0, system: 0 };
  if (Math.abs(p - 64) < 0.4) return { ...DEFAULT_ALLOC };
  const total = (p / 100) * TOTAL_CAPACITY_GB;
  const system = Math.min(12, total * 0.42);
  const rem = Math.max(0, total - system);
  const apps = Math.min(METER_MAX_GB, rem * (28 / 70));
  const media = Math.min(METER_MAX_GB, rem * (24 / 70));
  const cache = Math.min(METER_MAX_GB, Math.max(0, total - system - apps - media));
  return { apps, media, cache, system };
}

/** Shared damped drain + slosh physics stepper for both the main card and live check fixtures. */
export function createFluidPhysics({ isReduced = () => false, initial = DEFAULT_ALLOC } = {}) {
  const norm = (alloc) => {
    const apps = clamp(alloc.apps, 0, METER_MAX_GB);
    const media = clamp(alloc.media, 0, METER_MAX_GB);
    const cache = clamp(alloc.cache, 0, METER_MAX_GB);
    const system = clamp(alloc.system, 0, METER_MAX_GB);
    const sum = apps + media + cache + system;
    return {
      a: apps / TOTAL_CAPACITY_GB,
      b: media / TOTAL_CAPACITY_GB,
      c: cache / TOTAL_CAPACITY_GB,
      d: system / TOTAL_CAPACITY_GB,
      usage: clamp(sum / TOTAL_CAPACITY_GB, 0, 1),
      m: [
        apps / METER_MAX_GB,
        media / METER_MAX_GB,
        cache / METER_MAX_GB,
        system / METER_MAX_GB,
      ],
    };
  };

  const init = norm(initial);
  const s = {
    targetA: init.a,
    targetB: init.b,
    targetC: init.c,
    targetD: init.d,
    targetUsage: init.usage,
    targetM: [...init.m],

    levelA: init.a,
    levelB: init.b,
    levelC: init.c,
    levelD: init.d,
    usageLevel: init.usage,
    meterLevels: [...init.m],

    tilt: 0,
    tiltVel: 0,
    tiltDrive: 0,
    dragging: false,
    waveEnergy: 0,
    phase: 0,
    isSettled: true,
  };

  function setTargets(alloc, { impulse = 0 } = {}) {
    const n = norm(alloc);
    s.targetA = n.a;
    s.targetB = n.b;
    s.targetC = n.c;
    s.targetD = n.d;
    s.targetUsage = n.usage;
    s.targetM = [...n.m];

    if (isReduced()) {
      s.levelA = n.a;
      s.levelB = n.b;
      s.levelC = n.c;
      s.levelD = n.d;
      s.usageLevel = n.usage;
      s.meterLevels = [...n.m];
      s.tilt = 0;
      s.tiltVel = 0;
      s.tiltDrive = 0;
      s.waveEnergy = 0;
      s.isSettled = true;
      return;
    }

    if (Math.abs(impulse) > 0.001) {
      s.tiltVel = clamp(s.tiltVel + impulse, -4.5, 4.5);
      s.waveEnergy = clamp(Math.max(s.waveEnergy, Math.min(1, Math.abs(impulse) * 0.42)), 0, 1);
    }
    s.isSettled = false;
  }

  function kickSlosh(dir = 1, strength = 1) {
    if (isReduced()) {
      s.tilt = 0;
      s.tiltVel = 0;
      s.tiltDrive = 0;
      s.waveEnergy = 0;
      s.isSettled = true;
      return;
    }
    const sign = dir >= 0 ? 1 : -1;
    s.tiltVel = clamp(s.tiltVel + sign * 2.8 * strength, -4.8, 4.8);
    s.waveEnergy = clamp(Math.max(s.waveEnergy, 0.82 * strength), 0, 1);
    s.isSettled = false;
  }

  function snapToRest() {
    s.levelA = s.targetA;
    s.levelB = s.targetB;
    s.levelC = s.targetC;
    s.levelD = s.targetD;
    s.usageLevel = s.targetUsage;
    s.meterLevels = [...s.targetM];
    s.tilt = 0;
    s.tiltVel = 0;
    s.tiltDrive = 0;
    s.waveEnergy = 0;
    s.isSettled = true;
  }

  function step(dt) {
    const h = clamp(dt, 0.001, 0.05);
    if (isReduced()) {
      snapToRest();
      return false;
    }

    // Level chase (exponential smoothing across drain and refill transitions).
    const chase = 1 - Math.exp(-9.5 * h);
    s.levelA += (s.targetA - s.levelA) * chase;
    s.levelB += (s.targetB - s.levelB) * chase;
    s.levelC += (s.targetC - s.levelC) * chase;
    s.levelD += (s.targetD - s.levelD) * chase;
    s.usageLevel += (s.targetUsage - s.usageLevel) * chase;
    for (let i = 0; i < 4; i++) {
      s.meterLevels[i] += (s.targetM[i] - s.meterLevels[i]) * chase;
    }

    // Underdamped spring for fluid slosh tilt so waves rock back and forth before settling.
    const sub = 1 / 120;
    for (let rem = h; rem > 1e-6; rem -= sub) {
      const stepDt = Math.min(rem, sub);
      const targetTilt = s.dragging ? s.tiltDrive : 0;
      const stiffness = s.dragging ? 84 : 46;
      const damping = s.dragging ? 12 : 4.2;
      const acc = -stiffness * (s.tilt - targetTilt) - damping * s.tiltVel;
      s.tiltVel += acc * stepDt;
      s.tilt = clamp(s.tilt + s.tiltVel * stepDt, -0.36, 0.36);
    }

    if (!s.dragging) {
      s.waveEnergy = Math.max(0, s.waveEnergy - h * 0.36);
    }
    s.phase += h * (3.5 + s.waveEnergy * 2.4);

    const levelDiff = Math.max(
      Math.abs(s.targetA - s.levelA),
      Math.abs(s.targetB - s.levelB),
      Math.abs(s.targetC - s.levelC),
      Math.abs(s.targetD - s.levelD),
      Math.abs(s.targetUsage - s.usageLevel)
    );

    const active = s.dragging
      || levelDiff > 0.0008
      || Math.abs(s.tilt) > 0.0012
      || Math.abs(s.tiltVel) > 0.0025
      || s.waveEnergy > 0.003;

    if (!active) {
      s.levelA = s.targetA;
      s.levelB = s.targetB;
      s.levelC = s.targetC;
      s.levelD = s.targetD;
      s.usageLevel = s.targetUsage;
      s.meterLevels = [...s.targetM];
      s.tilt = 0;
      s.tiltVel = 0;
      s.waveEnergy = 0;
      s.isSettled = true;
      return false;
    }

    s.isSettled = false;
    return true;
  }

  return { s, setTargets, kickSlosh, snapToRest, step };
}
// #endregion fluid-physics

// #region storage-shader
export const STORAGE_FRAG = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;

uniform float uLevelA;
uniform float uLevelB;
uniform float uLevelC;
uniform float uLevelD;
uniform float uUsageLevel;
uniform vec4 uMeterLevels;
uniform float uTilt;
uniform float uWaveEnergy;
uniform float uPhase;

uniform vec4 uTankRect;
uniform vec4 uDigitsRect;
uniform vec4 uMeter0;
uniform vec4 uMeter1;
uniform vec4 uMeter2;
uniform vec4 uMeter3;
uniform float uShowLevels;
uniform float uReducedMotion;

in vec2 vUv;
out vec4 outColor;

float lum(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

float edgeGate(float l) {
  return smoothstep(0.0, 0.04, l) * smoothstep(1.0, 0.96, l);
}

float multiWave(float x, float phase, float energy, float seed) {
  if (uReducedMotion > 0.5) return 0.0;
  float amp = 0.003 + 0.022 * energy;
  float w1 = sin(x * 9.0 + phase * 1.35 + seed) * 0.54;
  float w2 = sin(x * 18.5 - phase * 2.15 + seed * 1.7) * 0.31;
  float w3 = cos(x * 32.0 + phase * 3.40 - seed * 0.8) * 0.15;
  return amp * (w1 + w2 + w3);
}

float waveSlope(float x, float phase, float energy, float seed) {
  if (uReducedMotion > 0.5) return 0.0;
  float amp = 0.003 + 0.022 * energy;
  float d1 = 9.0 * cos(x * 9.0 + phase * 1.35 + seed) * 0.54;
  float d2 = 18.5 * cos(x * 18.5 - phase * 2.15 + seed * 1.7) * 0.31;
  float d3 = -32.0 * sin(x * 32.0 + phase * 3.40 - seed * 0.8) * 0.15;
  return amp * (d1 + d2 + d3);
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float bubbles(vec2 uvLocal, float phase, float energy, float seed) {
  if (uReducedMotion > 0.5 || energy < 0.015) return 0.0;
  float acc = 0.0;
  for (int i = 0; i < 2; i++) {
    float scale = i == 0 ? 11.0 : 18.0;
    vec2 p = uvLocal * vec2(scale * 0.7, scale);
    p.y -= phase * (0.28 + float(i) * 0.14) + seed;
    p.x += sin(p.y * 1.4 + seed + float(i)) * 0.16;
    vec2 id = floor(p);
    vec2 f = fract(p) - 0.5;
    float h = hash21(id + seed * 13.7 + float(i) * 29.0);
    if (h > 0.72) {
      vec2 center = vec2((fract(h * 19.3) - 0.5) * 0.48, (fract(h * 7.1) - 0.5) * 0.42);
      float r = mix(0.06, 0.13, fract(h * 31.7));
      float d = length(f - center);
      acc += (1.0 - smoothstep(r * 0.5, r, d)) * smoothstep(0.72, 0.98, h);
    }
  }
  return clamp(acc * energy * 0.65, 0.0, 0.75);
}

bool inRect(vec2 uv, vec4 r) {
  return r.z > r.x && r.w > r.y
    && uv.x >= r.x && uv.x <= r.z
    && uv.y >= r.y && uv.y <= r.w;
}

vec3 fluidPalette(int idx, float depthNorm) {
  // 0: System (rose), 1: Apps (indigo), 2: Media (cyan), 3: Cache (amber)
  if (idx == 0) return mix(vec3(0.74, 0.14, 0.28), vec3(0.98, 0.36, 0.50), depthNorm);
  if (idx == 1) return mix(vec3(0.20, 0.25, 0.78), vec3(0.45, 0.53, 1.00), depthNorm);
  if (idx == 2) return mix(vec3(0.03, 0.54, 0.68), vec3(0.14, 0.88, 0.96), depthNorm);
  return mix(vec3(0.76, 0.44, 0.04), vec3(1.00, 0.72, 0.20), depthNorm);
}

vec3 shadeTank(vec2 uv, vec4 tex, vec4 rect) {
  float mask = smoothstep(0.28, 0.46, lum(tex.rgb));
  if (mask < 0.004) return tex.rgb;

  vec2 span = max(rect.zw - rect.xy, vec2(0.001));
  vec2 local = clamp((uv - rect.xy) / span, 0.0, 1.0);
  float xNorm = local.x - 0.5;
  float hNorm = 1.0 - local.y;
  float boxW = span.x * max(uSize.x, 1.0);
  float boxH = span.y * max(uSize.y, 1.0);
  float aspect = boxW / max(boxH, 1.0);
  float tiltSlope = tan(uTilt) * aspect * 0.65;
  float aa = 1.6 / max(boxH, 1.0);

  float l1 = uLevelD;
  float l2 = l1 + uLevelA;
  float l3 = l2 + uLevelB;
  float l4 = l3 + uLevelC;

  float hasD = smoothstep(0.001, 0.008, uLevelD);
  float hasA = smoothstep(0.001, 0.008, uLevelA);
  float hasB = smoothstep(0.001, 0.008, uLevelB);
  float hasC = smoothstep(0.001, 0.008, uLevelC);

  float s1 = (l1 + (xNorm * tiltSlope + multiWave(xNorm, uPhase, uWaveEnergy, 0.7)) * edgeGate(l1)) * hasD;
  float s2 = mix(s1, max(s1, l2 + (xNorm * tiltSlope + multiWave(xNorm, uPhase, uWaveEnergy, 2.1)) * edgeGate(l2)), hasA);
  float s3 = mix(s2, max(s2, l3 + (xNorm * tiltSlope + multiWave(xNorm, uPhase, uWaveEnergy, 3.6)) * edgeGate(l3)), hasB);
  float s4 = mix(s3, max(s3, l4 + (xNorm * tiltSlope + multiWave(xNorm, uPhase, uWaveEnergy, 5.0)) * edgeGate(l4)), hasC);

  // Empty tinted glass backdrop.
  vec3 glass = vec3(0.075, 0.115, 0.195);
  float glassSpec = exp(-pow((xNorm + 0.34) * 6.5, 2.0)) * 0.17 + exp(-pow((xNorm - 0.42) * 10.0, 2.0)) * 0.09;
  vec3 col = glass + vec3(0.55, 0.76, 1.0) * glassSpec;

  // Layer bands from bottom (System) to top (Cache).
  float in1 = (1.0 - smoothstep(s1 - aa, s1 + aa, hNorm)) * hasD;
  float in2 = (smoothstep(s1 - aa, s1 + aa, hNorm) * (1.0 - smoothstep(s2 - aa, s2 + aa, hNorm))) * hasA;
  float in3 = (smoothstep(s2 - aa, s2 + aa, hNorm) * (1.0 - smoothstep(s3 - aa, s3 + aa, hNorm))) * hasB;
  float in4 = (smoothstep(s3 - aa, s3 + aa, hNorm) * (1.0 - smoothstep(s4 - aa, s4 + aa, hNorm))) * hasC;

  float d1 = clamp(hNorm / max(s1, 0.02), 0.0, 1.0);
  float d2 = clamp((hNorm - s1) / max(s2 - s1, 0.02), 0.0, 1.0);
  float d3 = clamp((hNorm - s2) / max(s3 - s2, 0.02), 0.0, 1.0);
  float d4 = clamp((hNorm - s3) / max(s4 - s3, 0.02), 0.0, 1.0);

  vec3 c1 = fluidPalette(0, d1);
  vec3 c2 = fluidPalette(1, d2);
  vec3 c3 = fluidPalette(2, d3);
  vec3 c4 = fluidPalette(3, d4);

  float anyFluid = clamp(in1 + in2 + in3 + in4, 0.0, 1.0);
  vec3 liquidCol = c1 * in1 + c2 * in2 + c3 * in3 + c4 * in4;
  float bub = bubbles(vec2(local.x, hNorm), uPhase, uWaveEnergy, 1.3);
  liquidCol += vec3(0.45, 0.72, 0.95) * bub * 0.42;
  liquidCol += vec3(0.32, 0.52, 0.80) * glassSpec * 0.95;

  col = mix(col, liquidCol, anyFluid);

  // Meniscus rim highlights on each active surface and strongest at the top surface s4.
  float menW = max(aa * 2.1, 0.011);
  float m1 = exp(-abs(hNorm - s1) / menW) * hasD * edgeGate(l1);
  float m2 = exp(-abs(hNorm - s2) / menW) * hasA * edgeGate(l2);
  float m3 = exp(-abs(hNorm - s3) / menW) * hasB * edgeGate(l3);
  float m4 = exp(-abs(hNorm - s4) / menW) * edgeGate(l4);
  col += vec3(1.0, 0.65, 0.75) * m1 * 0.28;
  col += vec3(0.65, 0.72, 1.00) * m2 * 0.30;
  col += vec3(0.55, 0.96, 1.00) * m3 * 0.34;
  col += vec3(1.00, 0.98, 0.92) * m4 * 0.56;

  // Chromatic internal refraction of underlying DOM capacity tick labels.
  float sSlope = waveSlope(xNorm, uPhase, uWaveEnergy, 5.0);
  vec2 refr = vec2((tiltSlope * 0.55 + sSlope * 0.30) * 0.014, -0.0065) * anyFluid;
  vec2 uvR = clamp(uv + refr * 1.45, rect.xy + 0.001, rect.zw - 0.001);
  vec2 uvG = clamp(uv + refr * 1.00, rect.xy + 0.001, rect.zw - 0.001);
  vec2 uvB = clamp(uv + refr * 0.55, rect.xy + 0.001, rect.zw - 0.001);
  float inkR = smoothstep(0.84, 0.62, lum(texture(uTex, uvR).rgb));
  float inkG = smoothstep(0.84, 0.62, lum(texture(uTex, uvG).rgb));
  float inkB = smoothstep(0.84, 0.62, lum(texture(uTex, uvB).rgb));
  vec3 refrLabel = mix(vec3(0.56, 0.68, 0.88), vec3(0.95, 0.98, 1.0), anyFluid);
  col = mix(col, col + refrLabel * vec3(inkR, inkG, inkB) * (0.42 + 0.36 * anyFluid), max(inkG, max(inkR, inkB)) * 0.82);

  // Diagnostic shader level guide lines when "Show shader levels" is enabled.
  if (uShowLevels > 0.5) {
    float dash = step(0.45, fract(local.x * 12.0));
    float guide = 0.0;
    guide += exp(-abs(hNorm - l1) / (aa * 1.2)) * hasD;
    guide += exp(-abs(hNorm - l2) / (aa * 1.2)) * hasA;
    guide += exp(-abs(hNorm - l3) / (aa * 1.2)) * hasB;
    guide += exp(-abs(hNorm - l4) / (aa * 1.2)) * hasC;
    col = mix(col, vec3(1.0, 0.96, 0.62), clamp(guide, 0.0, 1.0) * dash * 0.95);
  }

  return mix(tex.rgb, col, mask);
}

vec3 shadeDigits(vec2 uv, vec4 tex, vec4 rect) {
  float glyphMask = smoothstep(0.20, 0.78, lum(tex.rgb));
  if (glyphMask < 0.004) return tex.rgb;

  vec2 span = max(rect.zw - rect.xy, vec2(0.001));
  vec2 local = clamp((uv - rect.xy) / span, 0.0, 1.0);
  float xNorm = local.x - 0.5;
  // Tighter glyph height normalization so 15% fills lower stroke and 80% stops below cap.
  float hNorm = clamp((1.0 - local.y - 0.06) / 0.88, 0.0, 1.0);
  float boxW = span.x * max(uSize.x, 1.0);
  float boxH = span.y * max(uSize.y, 1.0);
  float aspect = boxW / max(boxH, 1.0);
  float aa = 1.6 / max(boxH, 1.0);

  // Four-tap luminance gradient creates a hollow glass tube rim inside the glyph strokes.
  vec2 stepUv = 1.6 / max(uSize, vec2(1.0));
  float lx1 = lum(texture(uTex, uv + vec2(stepUv.x, 0.0)).rgb);
  float lx0 = lum(texture(uTex, uv - vec2(stepUv.x, 0.0)).rgb);
  float ly1 = lum(texture(uTex, uv + vec2(0.0, stepUv.y)).rgb);
  float ly0 = lum(texture(uTex, uv - vec2(0.0, stepUv.y)).rgb);
  vec2 grad = vec2(lx1 - lx0, ly1 - ly0);
  float bevelRim = clamp(length(grad) * 1.45, 0.0, 1.0);

  float tiltSlope = tan(uTilt) * aspect * 0.36;
  float surfUsage = uUsageLevel + (xNorm * tiltSlope + multiWave(xNorm, uPhase, uWaveEnergy, 4.4)) * edgeGate(uUsageLevel);
  float inLiquid = (1.0 - smoothstep(surfUsage - aa, surfUsage + aa, hNorm)) * smoothstep(0.002, 0.015, uUsageLevel);

  // Empty upper glass tube interior remains bright enough to read the full digits.
  vec3 emptyGlass = vec3(0.145, 0.215, 0.355) + vec3(0.45, 0.68, 0.96) * bevelRim * 0.72;

  // Multi-band glowing fluid inside the numerals matching Apps/Media/Cache/System share.
  float totalUsed = max(uLevelA + uLevelB + uLevelC + uLevelD, 0.001);
  float fD = (uLevelD / totalUsed) * surfUsage;
  float fA = fD + (uLevelA / totalUsed) * surfUsage;
  float fB = fA + (uLevelB / totalUsed) * surfUsage;

  float wD = 1.0 - smoothstep(fD - aa * 2.0, fD + aa * 2.0, hNorm);
  float wA = smoothstep(fD - aa * 2.0, fD + aa * 2.0, hNorm) * (1.0 - smoothstep(fA - aa * 2.0, fA + aa * 2.0, hNorm));
  float wB = smoothstep(fA - aa * 2.0, fA + aa * 2.0, hNorm) * (1.0 - smoothstep(fB - aa * 2.0, fB + aa * 2.0, hNorm));
  float wC = smoothstep(fB - aa * 2.0, fB + aa * 2.0, hNorm);

  vec3 bandCol = fluidPalette(0, 0.65) * wD
    + fluidPalette(1, 0.68) * wA
    + fluidPalette(2, 0.72) * wB
    + fluidPalette(3, 0.76) * wC;
  float normW = max(wD + wA + wB + wC, 0.001);
  bandCol /= normW;

  float bub = bubbles(vec2(local.x * 1.4, hNorm), uPhase, uWaveEnergy, 3.8);
  bandCol += vec3(0.55, 0.90, 1.0) * bub * 0.48;
  bandCol += vec3(0.45, 0.75, 1.0) * bevelRim * 0.34;

  vec3 col = mix(emptyGlass, bandCol, inLiquid);

  float men = exp(-abs(hNorm - surfUsage) / max(aa * 2.4, 0.015)) * edgeGate(uUsageLevel);
  col += vec3(0.92, 0.99, 1.0) * men * 0.72;

  if (uShowLevels > 0.5) {
    float dash = step(0.45, fract(local.x * 16.0));
    float guide = exp(-abs(hNorm - uUsageLevel) / (aa * 1.3));
    col = mix(col, vec3(1.0, 0.96, 0.62), clamp(guide, 0.0, 1.0) * dash);
  }

  return mix(tex.rgb, col, glyphMask);
}

vec3 shadeMeter(vec2 uv, vec4 tex, vec4 rect, float level, int paletteIdx, float seed) {
  float tubeMask = smoothstep(0.28, 0.56, lum(tex.rgb));
  if (tubeMask < 0.004) return tex.rgb;

  vec2 span = max(rect.zw - rect.xy, vec2(0.001));
  vec2 local = clamp((uv - rect.xy) / span, 0.0, 1.0);
  float xBar = local.x;
  float yBar = local.y - 0.5;
  float boxW = span.x * max(uSize.x, 1.0);
  float aa = 1.6 / max(boxW, 1.0);

  float tiltShift = yBar * (-tan(uTilt) * 0.16);
  float waveShift = multiWave(yBar, uPhase, uWaveEnergy, seed) * 0.45;
  float fillFront = level + (tiltShift + waveShift) * edgeGate(level);
  float inFluid = (1.0 - smoothstep(fillFront - aa, fillFront + aa, xBar)) * smoothstep(0.002, 0.015, level);

  float cylShade = 1.0 - pow(yBar * 1.65, 2.0) * 0.28;
  float glassHighlight = exp(-pow((yBar + 0.28) * 9.0, 2.0)) * 0.24;

  vec3 emptyTube = vec3(0.09, 0.135, 0.22) + vec3(0.45, 0.66, 0.95) * glassHighlight * 0.65;
  vec3 fluid = fluidPalette(paletteIdx, xBar * 0.75 + 0.20) * cylShade;
  fluid += vec3(0.50, 0.82, 1.0) * bubbles(vec2(yBar + 0.5, xBar * 2.2), uPhase, uWaveEnergy, seed) * 0.42;
  fluid += vec3(0.85, 0.95, 1.0) * glassHighlight;

  vec3 col = mix(emptyTube, fluid, inFluid);
  float men = exp(-abs(xBar - fillFront) / max(aa * 2.2, 0.014)) * edgeGate(level);
  col += vec3(1.0) * men * 0.52;

  if (uShowLevels > 0.5) {
    float tick = exp(-abs(xBar - level) / (aa * 1.2));
    col = mix(col, vec3(1.0, 0.96, 0.62), clamp(tick, 0.0, 1.0));
  }

  return mix(tex.rgb, col, tubeMask);
}

void main() {
  vec4 tex = texture(uTex, vUv);
  vec3 rgb = tex.rgb;

  if (inRect(vUv, uTankRect)) {
    rgb = shadeTank(vUv, tex, uTankRect);
  } else if (inRect(vUv, uDigitsRect)) {
    rgb = shadeDigits(vUv, tex, uDigitsRect);
  } else if (inRect(vUv, uMeter0)) {
    rgb = shadeMeter(vUv, tex, uMeter0, uMeterLevels.x, 1, 1.1);
  } else if (inRect(vUv, uMeter1)) {
    rgb = shadeMeter(vUv, tex, uMeter1, uMeterLevels.y, 2, 2.3);
  } else if (inRect(vUv, uMeter2)) {
    rgb = shadeMeter(vUv, tex, uMeter2, uMeterLevels.z, 3, 3.7);
  } else if (inRect(vUv, uMeter3)) {
    rgb = shadeMeter(vUv, tex, uMeter3, uMeterLevels.w, 0, 5.1);
  }

  outColor = vec4(rgb, tex.a);
}`;
// #endregion storage-shader

// ---------------------------------------------------------------- DOM references
const stageBox = document.getElementById('storage-stage');
const viewportEl = document.getElementById('storage-viewport');
const canvas = document.getElementById('storage-canvas');
const cardEl = document.getElementById('storage-card');
const plainHost = document.getElementById('plain-host');
const hudEl = document.getElementById('stage-hud');
const noticeEl = document.getElementById('stage-notice');
const testsBody = document.getElementById('tests');

const modeTagEl = document.getElementById('card-mode-tag');
const storageGbOut = document.getElementById('storage-gb-out');
const freeBadgeEl = document.getElementById('free-badge');
const quotaDigitsEl = document.getElementById('quota-digits');
const cacheChipEl = document.getElementById('cache-chip');
const tiltChipEl = document.getElementById('tilt-chip');
const tankMaskEl = document.getElementById('tank-mask');

const meterApps = document.getElementById('meter-apps');
const meterMedia = document.getElementById('meter-media');
const meterCache = document.getElementById('meter-cache');
const meterSystem = document.getElementById('meter-system');
const valApps = document.getElementById('val-apps');
const valMedia = document.getElementById('val-media');
const valCache = document.getElementById('val-cache');
const valSystem = document.getElementById('val-system');
const quotaSlider = document.getElementById('quota-slider');
const clearCacheBtn = document.getElementById('btn-clear-cache');
const refillBtn = document.getElementById('btn-refill');

const viewBtns = Array.from(document.querySelectorAll('button[data-view]'));
const sloshBtn = document.getElementById('btn-slosh');
const showLevelsCheck = document.getElementById('ctl-levels');
const reducedCheck = document.getElementById('ctl-reduced');

const reducedQuery = typeof matchMedia === 'function'
  ? matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
if (reducedQuery.matches) reducedCheck.checked = true;
const isReduced = () => reducedCheck.checked || reducedQuery.matches;

// ---------------------------------------------------------------- State & backend
const physics = createFluidPhysics({ isReduced });
let alloc = { ...DEFAULT_ALLOC };
let viewMode = 'combined';
let showLevels = false;
let stage = null;
let ctx2d = null;
let backend = 'none';
let hasPainted = false;
let textureDirty = true;
let isVisible = true;
let tabVisible = !document.hidden;
let rafId = 0;
let lastFrameTime = 0;
let lostTimer = 0;
let lastGeoSig = '';
let uploadCount = 0;
let sloshDir = 1;

const VIEW_LABELS = {
  combined: 'Combined',
  vessel: 'Segmented vessel',
  digits: 'Liquid digits',
};

function showNotice(text) {
  if (!text) {
    noticeEl.hidden = true;
    noticeEl.textContent = '';
  } else {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  }
}

function updateDomValues({ syncSlider = true } = {}) {
  const totalUsed = alloc.apps + alloc.media + alloc.cache + alloc.system;
  const pct = Math.round((totalUsed / TOTAL_CAPACITY_GB) * 100);
  const freeGb = Math.max(0, TOTAL_CAPACITY_GB - totalUsed);

  meterApps.value = alloc.apps;
  meterMedia.value = alloc.media;
  meterCache.value = alloc.cache;
  meterSystem.value = alloc.system;

  valApps.textContent = `${alloc.apps.toFixed(1)} GB`;
  valMedia.textContent = `${alloc.media.toFixed(1)} GB`;
  valCache.textContent = `${alloc.cache.toFixed(1)} GB`;
  valSystem.textContent = `${alloc.system.toFixed(1)} GB`;

  storageGbOut.textContent = `${totalUsed.toFixed(1)} / ${TOTAL_CAPACITY_GB} GB`;
  freeBadgeEl.textContent = `${freeGb.toFixed(1)} GB free`;
  quotaDigitsEl.textContent = `${pct}%`;
  cacheChipEl.textContent = `${alloc.cache.toFixed(1)} GB`;

  if (syncSlider) {
    quotaSlider.value = String(pct);
  }

  // CSS stops for plain HTML tank gradient fallback.
  const pD = (alloc.system / TOTAL_CAPACITY_GB) * 100;
  const pA = pD + (alloc.apps / TOTAL_CAPACITY_GB) * 100;
  const pB = pA + (alloc.media / TOTAL_CAPACITY_GB) * 100;
  const pC = pB + (alloc.cache / TOTAL_CAPACITY_GB) * 100;
  tankMaskEl.style.setProperty('--p-d', `${pD.toFixed(1)}%`);
  tankMaskEl.style.setProperty('--p-a', `${pA.toFixed(1)}%`);
  tankMaskEl.style.setProperty('--p-b', `${pB.toFixed(1)}%`);
  tankMaskEl.style.setProperty('--p-c', `${pC.toFixed(1)}%`);
}

function markTextureDirty({ wake = true } = {}) {
  textureDirty = true;
  canvas.requestPaint?.();
  if (wake) scheduleLoop();
}

// #region geometry-sync
function measureUvRect(el, container) {
  if (!el || !container) return [0, 0, 0, 0];
  const cr = container.getBoundingClientRect();
  const er = el.getBoundingClientRect();
  if (cr.width <= 0 || cr.height <= 0 || er.width <= 0 || er.height <= 0) {
    return [0, 0, 0, 0];
  }
  return [
    clamp((er.left - cr.left) / cr.width, 0, 1),
    clamp((er.top - cr.top) / cr.height, 0, 1),
    clamp((er.right - cr.left) / cr.width, 0, 1),
    clamp((er.bottom - cr.top) / cr.height, 0, 1),
  ];
}

function measureAllRects(container = cardEl) {
  return {
    tank: measureUvRect(tankMaskEl, container),
    digits: measureUvRect(quotaDigitsEl, container),
    meters: [
      measureUvRect(meterApps, container),
      measureUvRect(meterMedia, container),
      measureUvRect(meterCache, container),
      measureUvRect(meterSystem, container),
    ],
  };
}

function syncGeometry(force = false) {
  if (backend !== 'webgl' || !hasPainted) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const cardW = cardEl.offsetWidth;
  const cardH = cardEl.offsetHeight;
  if (!cw || !ch || !cardW || !cardH) return;

  const unit = geometryUnit(canvas, cardEl, cardW);
  const sig = `${unit.toFixed(4)}:${cw}x${ch}:${viewMode}`;
  if (!force && sig === lastGeoSig) return;
  lastGeoSig = sig;

  const scaled = new DOMMatrix().scale(unit, unit, 1);
  canvas.updateElementGeometry?.(cardEl, { canvasTransform: scaled });
  cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

// #region fallback-2d
function drawWaveRect2D(ctx, rect, cw, ch, levels, tiltDeg) {
  const x = rect[0] * cw;
  const y = rect[1] * ch;
  const w = (rect[2] - rect[0]) * cw;
  const h = (rect[3] - rect[1]) * ch;
  if (w <= 2 || h <= 2) return;

  const s = physics.s;
  const bands = [
    { frac: levels.d, color: '#f04868' },
    { frac: levels.a, color: '#5b6cf9' },
    { frac: levels.b, color: '#12c7e5' },
    { frac: levels.c, color: '#f5a623' },
  ];

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(25, w * 0.25));
  ctx.clip();

  ctx.fillStyle = '#0e1624';
  ctx.fillRect(x, y, w, h);

  let cum = 0;
  const slope = Math.tan(tiltDeg) * 0.45;
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (b.frac <= 0.002) continue;
    const prevCum = cum;
    cum += b.frac;
    const topBase = y + h * (1 - cum);
    const botBase = y + h * (1 - prevCum);

    ctx.beginPath();
    for (let px = 0; px <= w; px += 4) {
      const xn = px / w - 0.5;
      const wave = isReduced() ? 0 : Math.sin(xn * 9 + s.phase + i) * (1.5 + s.waveEnergy * 5);
      const wy = topBase - xn * slope * w + wave;
      if (px === 0) ctx.moveTo(x + px, wy);
      else ctx.lineTo(x + px, wy);
    }
    ctx.lineTo(x + w, botBase + 4);
    ctx.lineTo(x, botBase + 4);
    ctx.closePath();
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 0.86;
    ctx.fill();
  }
  ctx.restore();
}

function draw2DFallback(cw, ch) {
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
  ctx2d.clearRect(0, 0, cw, ch);

  // Full 5-argument draw establishes crisp labels, buttons, range slider and hit geometry.
  ctx2d.drawElementImage(cardEl, 0, 0, cw, ch);

  const rects = measureAllRects(cardEl);
  const s = physics.s;
  if (rects.tank[2] > rects.tank[0]) {
    drawWaveRect2D(ctx2d, rects.tank, cw, ch, { a: s.levelA, b: s.levelB, c: s.levelC, d: s.levelD }, s.tilt);
  }
  if (rects.digits[2] > rects.digits[0]) {
    const dx = rects.digits[0] * cw;
    const dy = rects.digits[1] * ch;
    const dw = (rects.digits[2] - rects.digits[0]) * cw;
    const dh = (rects.digits[3] - rects.digits[1]) * ch;
    ctx2d.save();
    ctx2d.globalCompositeOperation = 'multiply';
    ctx2d.beginPath();
    const topY = dy + dh * (1 - s.usageLevel);
    ctx2d.moveTo(dx, topY);
    for (let px = 0; px <= dw; px += 4) {
      const xn = px / dw - 0.5;
      const wave = isReduced() ? 0 : Math.sin(xn * 8 + s.phase) * (1.2 + s.waveEnergy * 4);
      ctx2d.lineTo(dx + px, topY - xn * Math.tan(s.tilt) * dw * 0.35 + wave);
    }
    ctx2d.lineTo(dx + dw, dy + dh);
    ctx2d.lineTo(dx, dy + dh);
    ctx2d.closePath();
    const grad = ctx2d.createLinearGradient(0, dy + dh, 0, dy);
    grad.addColorStop(0, '#f04868');
    grad.addColorStop(0.35, '#5b6cf9');
    grad.addColorStop(0.7, '#12c7e5');
    grad.addColorStop(1, '#f5a623');
    ctx2d.fillStyle = grad;
    ctx2d.fill();
    ctx2d.restore();
  }

  // Final crisp 5-argument draw keeps controls and hit geometry current.
  ctx2d.globalAlpha = 0.01;
  ctx2d.drawElementImage(cardEl, 0, 0, cw, ch);
  ctx2d.globalAlpha = 1;
}

function switchToPlain(reason) {
  backend = 'plain';
  cancelAnimationFrame(rafId);
  rafId = 0;
  stageBox.classList.add('plain');
  if (cardEl.parentElement !== plainHost) {
    plainHost.append(cardEl);
  }
  showNotice(reason);
  updateHud();
}

function restoreFromPlain() {
  stageBox.classList.remove('plain');
  if (cardEl.parentElement !== canvas) {
    canvas.append(cardEl);
  }
  showNotice('');
  markTextureDirty();
}
// #endregion fallback-2d

function updateHud() {
  const s = physics.s;
  const deg = (s.tilt * 180) / Math.PI;
  const tiltStr = `${Math.abs(deg) < 0.05 ? '0.0' : deg.toFixed(1)}°`;
  if (tiltChipEl.textContent !== tiltStr) {
    tiltChipEl.textContent = tiltStr;
    textureDirty = true;
  }

  const routeName = backend === 'webgl'
    ? 'WebGL 2 (ElementGL)'
    : backend === '2d'
      ? '2D drawElementImage() fallback'
      : 'Plain HTML fallback';
  const totalUsed = alloc.apps + alloc.media + alloc.cache + alloc.system;
  hudEl.textContent =
    `Route: ${routeName} · View: ${VIEW_LABELS[viewMode]} · ` +
    `Usage: ${Math.round((totalUsed / TOTAL_CAPACITY_GB) * 100)}% (${totalUsed.toFixed(1)}/${TOTAL_CAPACITY_GB} GB) · ` +
    `Cache: ${alloc.cache.toFixed(1)} GB · Tilt: ${tiltStr} · ` +
    `Physics: ${s.isSettled ? 'settled (idle)' : 'sloshing'}`;
}

function applyStorageUniforms(gl, loc, s, rects) {
  gl.uniform1f(loc('uLevelA'), s.levelA);
  gl.uniform1f(loc('uLevelB'), s.levelB);
  gl.uniform1f(loc('uLevelC'), s.levelC);
  gl.uniform1f(loc('uLevelD'), s.levelD);
  gl.uniform1f(loc('uUsageLevel'), s.usageLevel);
  gl.uniform4f(loc('uMeterLevels'), s.meterLevels[0], s.meterLevels[1], s.meterLevels[2], s.meterLevels[3]);
  gl.uniform1f(loc('uTilt'), s.tilt);
  gl.uniform1f(loc('uWaveEnergy'), s.waveEnergy);
  gl.uniform1f(loc('uPhase'), s.phase);
  gl.uniform4f(loc('uTankRect'), rects.tank[0], rects.tank[1], rects.tank[2], rects.tank[3]);
  gl.uniform4f(loc('uDigitsRect'), rects.digits[0], rects.digits[1], rects.digits[2], rects.digits[3]);
  gl.uniform4f(loc('uMeter0'), rects.meters[0][0], rects.meters[0][1], rects.meters[0][2], rects.meters[0][3]);
  gl.uniform4f(loc('uMeter1'), rects.meters[1][0], rects.meters[1][1], rects.meters[1][2], rects.meters[1][3]);
  gl.uniform4f(loc('uMeter2'), rects.meters[2][0], rects.meters[2][1], rects.meters[2][2], rects.meters[2][3]);
  gl.uniform4f(loc('uMeter3'), rects.meters[3][0], rects.meters[3][1], rects.meters[3][2], rects.meters[3][3]);
  gl.uniform1f(loc('uShowLevels'), showLevels ? 1 : 0);
  gl.uniform1f(loc('uReducedMotion'), isReduced() ? 1 : 0);
}

function drawFrame() {
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (!cw || !ch || !hasPainted) return;

  if (backend === 'webgl' && stage && !stage.lost) {
    try {
      // Size backing store before upload() so first-frame element pixels match full HiDPI resolution.
      if (!stage.begin([0, 0, 0, 0])) return;
      if (textureDirty || !stage.has(cardEl)) {
        stage.upload(cardEl);
        textureDirty = false;
        uploadCount += 1;
      }
      syncGeometry();
      const rects = measureAllRects(cardEl);
      stage.quad(cardEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, loc) => {
        applyStorageUniforms(gl, loc, physics.s, rects);
      });
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        textureDirty = true;
        canvas.requestPaint?.();
      } else {
        throw err;
      }
    }
  } else if (backend === '2d') {
    draw2DFallback(cw, ch);
  }
  updateHud();
}

function tick(now) {
  rafId = 0;
  if (!isVisible || !tabVisible || backend === 'plain' || backend === 'none') return;
  const dt = lastFrameTime ? (now - lastFrameTime) / 1000 : 1 / 60;
  lastFrameTime = now;

  const moving = physics.step(dt);
  drawFrame();

  if (moving) {
    rafId = requestAnimationFrame(tick);
  } else {
    lastFrameTime = 0;
  }
}

function scheduleLoop() {
  if (!isVisible || !tabVisible || backend === 'plain' || backend === 'none') return;
  if (!rafId) {
    rafId = requestAnimationFrame(tick);
  }
}

// ---------------------------------------------------------------- Controls inside the canvas
quotaSlider.addEventListener('input', () => {
  const prevTotal = alloc.apps + alloc.media + alloc.cache + alloc.system;
  alloc = allocationFromPercent(Number(quotaSlider.value));
  const nextTotal = alloc.apps + alloc.media + alloc.cache + alloc.system;
  const impulse = clamp((nextTotal - prevTotal) * 0.08, -2.5, 2.5);
  updateDomValues({ syncSlider: false });
  physics.setTargets(alloc, { impulse });
  markTextureDirty();
});

clearCacheBtn.addEventListener('click', () => {
  const dropped = alloc.cache;
  alloc = { ...alloc, cache: 0 };
  updateDomValues({ syncSlider: true });
  physics.setTargets(alloc, { impulse: dropped > 0.1 ? -2.2 : -0.9 });
  markTextureDirty();
});

refillBtn.addEventListener('click', () => {
  const prevTotal = alloc.apps + alloc.media + alloc.cache + alloc.system;
  if (prevTotal < 81.5 || alloc.cache < 17.5) {
    alloc = { ...DEFAULT_ALLOC };
  } else {
    alloc = allocationFromPercent(80);
  }
  updateDomValues({ syncSlider: true });
  physics.setTargets(alloc, { impulse: 2.3 });
  markTextureDirty();
});

// Pointer drag across the glass card drives slosh tilt without stealing taps or range drags.
let cardPointerId = null;
let cardStartX = 0;
let cardStartY = 0;
let cardLastX = 0;
let cardDragging = false;
let suppressCardClickUntil = 0;

cardEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  if (e.target.closest('input, button, select, a')) return;
  cardPointerId = e.pointerId;
  cardStartX = e.clientX;
  cardStartY = e.clientY;
  cardLastX = e.clientX;
  cardDragging = false;
});

cardEl.addEventListener('pointermove', (e) => {
  if (cardPointerId !== e.pointerId) return;
  const dxTotal = e.clientX - cardStartX;
  const dyTotal = e.clientY - cardStartY;
  if (!cardDragging) {
    if (Math.abs(dxTotal) > 7 && Math.abs(dxTotal) >= Math.abs(dyTotal)) {
      cardDragging = true;
      try { cardEl.setPointerCapture(e.pointerId); } catch {}
    } else if (Math.abs(dyTotal) > 10) {
      cardPointerId = null;
      return;
    } else {
      return;
    }
  }
  const dx = e.clientX - cardLastX;
  cardLastX = e.clientX;
  if (isReduced()) return;
  physics.s.dragging = true;
  physics.s.tiltDrive = clamp(dxTotal / 190, -0.32, 0.32);
  physics.s.tiltVel = clamp(physics.s.tiltVel + dx * 0.045, -4.5, 4.5);
  physics.s.waveEnergy = clamp(Math.max(physics.s.waveEnergy, Math.min(1, Math.abs(dx) * 0.04 + 0.35)), 0, 1);
  physics.s.isSettled = false;
  scheduleLoop();
});

function releaseCardDrag(e) {
  if (cardPointerId !== e.pointerId) return;
  if (cardDragging) {
    suppressCardClickUntil = performance.now() + 80;
    try { cardEl.releasePointerCapture(e.pointerId); } catch {}
  }
  cardPointerId = null;
  cardDragging = false;
  physics.s.dragging = false;
  physics.s.tiltDrive = 0;
  scheduleLoop();
}
cardEl.addEventListener('pointerup', releaseCardDrag);
cardEl.addEventListener('pointercancel', releaseCardDrag);
cardEl.addEventListener('click', (e) => {
  if (performance.now() < suppressCardClickUntil && !e.target.closest('button, input')) {
    e.stopPropagation();
  }
}, true);

// ---------------------------------------------------------------- External toolbar controls
for (const btn of viewBtns) {
  btn.addEventListener('click', () => {
    viewMode = btn.dataset.view;
    cardEl.dataset.view = viewMode;
    modeTagEl.textContent = VIEW_LABELS[viewMode] ?? viewMode;
    for (const b of viewBtns) b.setAttribute('aria-pressed', String(b === btn));
    lastGeoSig = '';
    markTextureDirty();
    if (backend === 'webgl') syncGeometry(true);
  });
}

sloshBtn.addEventListener('click', () => {
  sloshDir *= -1;
  physics.kickSlosh(sloshDir, 1.0);
  scheduleLoop();
});

showLevelsCheck.addEventListener('change', () => {
  showLevels = showLevelsCheck.checked;
  drawFrame();
  scheduleLoop();
});

reducedCheck.addEventListener('change', () => {
  if (isReduced()) {
    physics.snapToRest();
    drawFrame();
  } else {
    physics.kickSlosh(1, 0.6);
    scheduleLoop();
  }
});

// ---------------------------------------------------------------- Startup, visibility & observers
function startBackend() {
  if (!hicSupported) {
    switchToPlain('HTML-in-canvas is not available in this browser, so the storage dashboard is shown as plain HTML.');
    return;
  }

  canvas.addEventListener('paint', () => {
    hasPainted = true;
    textureDirty = true;
    if (!rafId && isVisible && tabVisible) drawFrame();
  });

  if (glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: STORAGE_FRAG,
        onLost: () => {
          clearTimeout(lostTimer);
          lostTimer = setTimeout(() => {
            if (stage?.lost) {
              switchToPlain('The WebGL 2 context was lost, so the storage dashboard moved to plain HTML.');
            }
          }, 1200);
        },
        onRestored: () => {
          clearTimeout(lostTimer);
          restoreFromPlain();
          backend = 'webgl';
          lastGeoSig = '';
          hasPainted = true;
          textureDirty = true;
          scheduleLoop();
        },
      });
      backend = 'webgl';
    } catch {
      stage = null;
    }
  }

  if (backend === 'none') {
    ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
      switchToPlain('Canvas rendering is unavailable here, so the storage dashboard is shown as plain HTML.');
      return;
    }
    backend = '2d';
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (ctx2d?.isContextLost?.()) {
          switchToPlain('The 2D canvas context was lost, so the storage dashboard moved to plain HTML.');
        }
      }, 1200);
    });
    canvas.addEventListener('contextrestored', () => {
      clearTimeout(lostTimer);
      restoreFromPlain();
      backend = '2d';
      hasPainted = true;
      textureDirty = true;
      scheduleLoop();
    });
  }

  canvas.requestPaint?.();
}

if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver((entries) => {
    const entry = entries[0];
    const nowVis = Boolean(entry && entry.isIntersecting);
    if (nowVis === isVisible) return;
    isVisible = nowVis;
    if (isVisible && tabVisible) {
      markTextureDirty({ wake: !physics.s.isSettled });
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }, { threshold: 0.01 });
  io.observe(viewportEl);
}

document.addEventListener('visibilitychange', () => {
  tabVisible = !document.hidden;
  if (tabVisible && isVisible) {
    if (!physics.s.isSettled) scheduleLoop();
    else drawFrame();
  } else {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
});

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    lastGeoSig = '';
    textureDirty = true;
    drawFrame();
  });
  ro.observe(viewportEl);
}

updateDomValues({ syncSlider: true });
startBackend();
updateHud();

// ---------------------------------------------------------------- Live checks (isolated fixtures on testStage)
const need = (ok, msg) => { if (!ok) throw new Error(msg); return msg; };

function makeFixtureCard(width = 240, height = 210) {
  const cv = document.createElement('canvas');
  cv.setAttribute('content', 'drawable');
  cv.setAttribute('layoutsubtree', '');
  cv.style.cssText = `width:${width}px;height:${height}px;display:block;position:relative`;

  const card = document.createElement('div');
  card.setAttribute('drawable', '');
  card.style.cssText = `width:${width}px;height:${height}px;background:#0c121e;color:#eef4ff;padding:8px;box-sizing:border-box;display:grid;grid-template-columns:76px 1fr;gap:8px;align-items:stretch`;

  const tank = document.createElement('div');
  tank.style.cssText = 'border-radius:14px;background:#eff6ff;height:100%;box-sizing:border-box';

  const right = document.createElement('div');
  right.style.cssText = 'display:flex;flex-direction:column;justify-content:space-between;gap:6px';

  const out = document.createElement('output');
  out.textContent = '64%';
  out.style.cssText = 'font:900 34px/0.85 system-ui,sans-serif;color:#ffffff;display:inline-block';

  const meter = document.createElement('meter');
  meter.min = 0;
  meter.max = 64;
  meter.value = 18;
  meter.style.cssText = 'appearance:none;display:block;width:100%;height:14px;border-radius:99px;background:#eff6ff';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '64';
  slider.style.cssText = 'width:100%;height:26px;margin:0';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Clear cache';
  btn.style.cssText = 'height:32px;border-radius:6px;border:1px solid #9e6516;background:#2b1d0b;color:#ffd38a;font:600 12px system-ui';

  right.append(out, meter, slider, btn);
  card.append(tank, right);
  cv.append(card);
  return { cv, card, tank, out, meter, slider, btn };
}

const tests = [
  {
    name: 'ElementGL fluid vessel + numeral mask render cleanly (gl.getError() === 0)',
    expect: 'pass',
    why: 'Builds an isolated ElementGL canvas on testStage(), uploads a drawable tank, <meter> and <output> card via texElementSubImage2D(), renders STORAGE_FRAG with slosh tilt and verifies gl.getError() === 0.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const fx = makeFixtureCard(220, 180);
      testStage().append(fx.cv);
      let g = null;
      try {
        g = new ElementGL(fx.cv, { fragment: STORAGE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(fx.cv);
        const uploaded = g.upload(fx.card);
        const rects = {
          tank: measureUvRect(fx.tank, fx.card),
          digits: measureUvRect(fx.out, fx.card),
          meters: [measureUvRect(fx.meter, fx.card), [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        };
        g.begin([0, 0, 0, 0]);
        g.quad(fx.card, ElementGL.rect(fx.cv, 0, 0, 220, 180), (gl, loc) => {
          applyStorageUniforms(gl, loc, {
            levelA: 0.22,
            levelB: 0.19,
            levelC: 0.14,
            levelD: 0.09,
            usageLevel: 0.64,
            meterLevels: [0.44, 0.38, 0.28, 0.19],
            tilt: 0.12,
            waveEnergy: 0.75,
            phase: 1.2,
          }, rects);
        });
        const err = g.gl.getError();
        const px = new Uint8Array(4);
        const midX = Math.round(((rects.tank[0] + rects.tank[2]) * 0.5) * fx.cv.width);
        const botY = Math.round((1 - (rects.tank[1] * 0.2 + rects.tank[3] * 0.8)) * fx.cv.height);
        g.gl.readPixels(clamp(midX, 0, fx.cv.width - 1), clamp(botY, 0, fx.cv.height - 1), 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, px);
        return need(
          err === g.gl.NO_ERROR && uploaded && px[3] > 200,
          `gl.getError()=${err}, uploaded ${uploaded?.w}x${uploaded?.h}, tank lower pixel rgba(${px[0]},${px[1]},${px[2]},${px[3]}).`
        );
      } finally {
        g?.dispose();
        fx.cv.remove();
        window.__gfx?.retire?.(fx.cv);
      }
    },
  },
  {
    name: 'Draining from 80% to 15% changes upper vessel pixels while lower layer stays filled',
    expect: 'pass',
    why: 'Renders an isolated ElementGL vessel at 80% load vs 15% load and reads pixels at 55% vessel height and 8% vessel height via readPixels().',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const fx = makeFixtureCard(220, 190);
      testStage().append(fx.cv);
      let g = null;
      try {
        g = new ElementGL(fx.cv, { fragment: STORAGE_FRAG, attributes: { preserveDrawingBuffer: true } });
        g.begin([0, 0, 0, 0]);
        await nextPaint(fx.cv);
        g.upload(fx.card);
        const rects = {
          tank: measureUvRect(fx.tank, fx.card),
          digits: measureUvRect(fx.out, fx.card),
          meters: [measureUvRect(fx.meter, fx.card), [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        };

        const renderAndSample = (levels) => {
          g.begin([0, 0, 0, 0]);
          g.quad(fx.card, ElementGL.rect(fx.cv, 0, 0, 220, 190), (gl, loc) => {
            applyStorageUniforms(gl, loc, levels, rects);
          });
          const err = g.gl.getError();
          const cx = clamp(Math.round(((rects.tank[0] + rects.tank[2]) * 0.5) * fx.cv.width), 0, fx.cv.width - 1);
          const tankTopY = rects.tank[1];
          const tankBotY = rects.tank[3];
          const uvUpper = tankBotY - (tankBotY - tankTopY) * 0.55;
          const uvLower = tankBotY - (tankBotY - tankTopY) * 0.03;
          const glUpperY = clamp(Math.round((1 - uvUpper) * fx.cv.height), 0, fx.cv.height - 1);
          const glLowerY = clamp(Math.round((1 - uvLower) * fx.cv.height), 0, fx.cv.height - 1);
          const upper = new Uint8Array(4);
          const lower = new Uint8Array(4);
          g.gl.readPixels(cx, glUpperY, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, upper);
          g.gl.readPixels(cx, glLowerY, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, lower);
          return { err, upper, lower };
        };

        const high = renderAndSample({
          levelA: 0.25, levelB: 0.25, levelC: 0.20, levelD: 0.10,
          usageLevel: 0.80, meterLevels: [0.5, 0.5, 0.4, 0.2],
          tilt: 0, waveEnergy: 0, phase: 0,
        });
        const low = renderAndSample({
          levelA: 0.05, levelB: 0.05, levelC: 0.00, levelD: 0.05,
          usageLevel: 0.15, meterLevels: [0.1, 0.1, 0.0, 0.1],
          tilt: 0, waveEnergy: 0, phase: 0,
        });

        const upperDelta = Math.abs(high.upper[0] - low.upper[0])
          + Math.abs(high.upper[1] - low.upper[1])
          + Math.abs(high.upper[2] - low.upper[2]);
        const lowerStillRed = low.lower[0] > 140 && low.lower[0] > low.lower[1] + 40;

        return need(
          high.err === g.gl.NO_ERROR && low.err === g.gl.NO_ERROR && upperDelta > 80 && lowerStillRed,
          `55% height pixel changed by ${upperDelta} RGB units (80% rgb(${high.upper[0]},${high.upper[1]},${high.upper[2]}) -> 15% rgb(${low.upper[0]},${low.upper[1]},${low.upper[2]})); 3% height remained filled rgb(${low.lower[0]},${low.lower[1]},${low.lower[2]}).`
        );
      } finally {
        g?.dispose();
        fx.cv.remove();
        window.__gfx?.retire?.(fx.cv);
      }
    },
  },
  {
    name: 'Damped slosh impulse oscillates, settles to sleep, and respects reduced motion',
    expect: 'pass',
    why: 'Steps createFluidPhysics() after kickSlosh() and a cache drain, checks peak tilt and full rest settling, then verifies instant snap under reduced motion.',
    run: async () => {
      let reduced = false;
      const phys = createFluidPhysics({ isReduced: () => reduced });
      phys.kickSlosh(1, 1.0);
      phys.setTargets({ apps: 28, media: 24, cache: 0, system: 12 }, { impulse: -1.4 });

      let peakTilt = 0;
      let steps = 0;
      while (steps < 400 && phys.step(1 / 60)) {
        peakTilt = Math.max(peakTilt, Math.abs(phys.s.tilt));
        steps += 1;
      }

      const settledOk = phys.s.isSettled && Math.abs(phys.s.tilt) < 0.001 && phys.s.waveEnergy === 0;

      reduced = true;
      phys.setTargets(DEFAULT_ALLOC, { impulse: 2.5 });
      const stillRunning = phys.step(1 / 60);
      const reducedOk = !stillRunning && phys.s.tilt === 0 && phys.s.waveEnergy === 0 && Math.abs(phys.s.usageLevel - 82 / 128) < 0.001;

      return need(
        peakTilt > 0.08 && settledOk && reducedOk,
        `peak tilt=${((peakTilt * 180) / Math.PI).toFixed(1)} deg, settled in ${steps} frames (${(steps / 60).toFixed(2)}s); reduced-motion snapped with tilt=0.`
      );
    },
  },
  {
    name: 'updateElementGeometry() keeps Clear cache button and quota slider hit-testable inside canvas',
    expect: 'pass',
    why: 'Mounts an isolated ElementGL fixture on testStage(), calibrates updateElementGeometry() via geometryUnit(), checks elementsFromPoint() hits both the button and <input type="range">, and clicks Clear cache.',
    run: async () => {
      if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('updateElementGeometry() is not available');
      }
      const fx = makeFixtureCard(250, 190);
      let cleared = 0;
      fx.btn.addEventListener('click', () => {
        fx.meter.value = 0;
        fx.out.textContent = '50%';
        cleared += 1;
      });
      testStage().append(fx.cv);

      let g = null;
      try {
        if (glSupported) {
          g = new ElementGL(fx.cv, { fragment: STORAGE_FRAG });
          g.begin([0, 0, 0, 0]);
        }
        await nextPaint(fx.cv);
        if (g) {
          g.begin([0, 0, 0, 0]);
          g.upload(fx.card);
          const rects = {
            tank: measureUvRect(fx.tank, fx.card),
            digits: measureUvRect(fx.out, fx.card),
            meters: [measureUvRect(fx.meter, fx.card), [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
          };
          g.quad(fx.card, ElementGL.rect(fx.cv, 0, 0, 250, 190), (gl, loc) => {
            applyStorageUniforms(gl, loc, {
              levelA: 0.22, levelB: 0.19, levelC: 0.14, levelD: 0.09,
              usageLevel: 0.64, meterLevels: [0.4, 0.4, 0.3, 0.2],
              tilt: 0, waveEnergy: 0, phase: 0,
            }, rects);
          });
        }

        const unit = geometryUnit(fx.cv, fx.card, fx.card.offsetWidth);
        fx.cv.updateElementGeometry(fx.card, { canvasTransform: new DOMMatrix().scale(unit, unit, 1) });
        fx.card.dataset.hitTick = fx.card.dataset.hitTick === '1' ? '0' : '1';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

        const br = fx.btn.getBoundingClientRect();
        const sr = fx.slider.getBoundingClientRect();
        const btnHits = document.elementsFromPoint(br.left + br.width * 0.5, br.top + br.height * 0.5);
        const sliderHits = document.elementsFromPoint(sr.left + sr.width * 0.5, sr.top + sr.height * 0.5);
        fx.btn.click();

        return need(
          btnHits.includes(fx.btn) && sliderHits.includes(fx.slider) && cleared === 1 && fx.meter.value === 0,
          `geometryUnit=${unit.toFixed(3)}, button hit=${btnHits.includes(fx.btn)}, slider hit=${sliderHits.includes(fx.slider)}, click drained meter to ${fx.meter.value}.`
        );
      } finally {
        g?.dispose();
        fx.cv.remove();
        window.__gfx?.retire?.(fx.cv);
      }
    },
  },
  {
    name: 'webglcontextlost moves controls to plain HTML and webglcontextrestored rebuilds the stage',
    expect: 'pass',
    why: 'Dispatches synthetic webglcontextlost and webglcontextrestored events on an isolated ElementGL fixture without calling loseContext(), verifying plain fallback hosting and clean GL restoration.',
    run: async () => {
      if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
      const wrap = document.createElement('div');
      wrap.style.cssText = 'width:220px;height:160px;position:relative';
      const plain = document.createElement('div');
      plain.style.cssText = 'width:100%;height:100%;display:none';
      const fx = makeFixtureCard(220, 160);
      wrap.append(fx.cv, plain);
      testStage().append(wrap);

      let lostCount = 0;
      let restoredCount = 0;
      let g = null;
      try {
        g = new ElementGL(fx.cv, {
          fragment: STORAGE_FRAG,
          onLost: () => {
            lostCount += 1;
            plain.style.display = 'block';
            fx.cv.style.display = 'none';
            plain.append(fx.card);
          },
          onRestored: () => {
            restoredCount += 1;
            plain.style.display = 'none';
            fx.cv.style.display = 'block';
            fx.cv.append(fx.card);
          },
        });
        g.begin([0, 0, 0, 0]);
        await nextPaint(fx.cv);
        g.upload(fx.card);

        const lostEv = new Event('webglcontextlost', { cancelable: true });
        fx.cv.dispatchEvent(lostEv);
        const inPlainWhileLost = lostEv.defaultPrevented && g.lost && fx.card.parentElement === plain;

        fx.cv.dispatchEvent(new Event('webglcontextrestored'));
        await nextPaint(fx.cv);
        g.begin([0, 0, 0, 0]);
        const reuploaded = g.upload(fx.card);
        const err = g.gl.getError();

        return need(
          inPlainWhileLost && !g.lost && restoredCount === 1 && fx.card.parentElement === fx.cv && Boolean(reuploaded) && err === g.gl.NO_ERROR,
          `lost=${lostCount} (plain host active), restored=${restoredCount} (canvas re-attached, gl.getError()=${err}).`
        );
      } finally {
        g?.dispose();
        wrap.remove();
        window.__gfx?.retire?.(fx.cv);
      }
    },
  },
  stillDrawn(() => [
    {
      name: 'liquid storage dashboard stage',
      ink: async () => {
        if (backend === 'plain') return null;
        if (backend === 'webgl') {
          if (!stage || stage.lost || !stage.has(cardEl)) return 0;
          const mp = (canvas.width * canvas.height) / 1e6;
          if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
          return uploadCount > 0 ? 1 : 0;
        }
        return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
      },
      rescue: () => switchToPlain('Canvas drew blank after live checks'),
    },
  ]),
];

runTests(testsBody, tests);
