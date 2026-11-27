import { banner, supported as hicSupported, runTests, testStage, nextPaint, stillDrawn } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

export const MODES = {
  desqueeze: {
    id: 'desqueeze',
    label: '2.39:1 ANA',
    hud: '2.39:1 Desqueeze',
    barrel: 1.0,
    aniso: 1.48,
    streakScale: 1.0,
    flareGain: 1.0,
  },
  squeeze: {
    id: 'squeeze',
    label: '1.33x RAW',
    hud: '1.33x Squeeze (raw)',
    barrel: 0.72,
    aniso: 0.86,
    streakScale: 0.62,
    flareGain: 0.92,
  },
  flat: {
    id: 'flat',
    label: '1.00x FLAT',
    hud: 'Flat',
    barrel: 0.0,
    aniso: 1.0,
    streakScale: 0.20,
    flareGain: 0.28,
  },
};

// #region layout-math
/**
 * Compute the projected cinema gate rectangle inside the canvas in CSS pixels.
 * Keeps 1.33x Squeeze visibly narrow, Flat 1:1, and 2.39:1 Desqueeze wide widescreen.
 */
export function computeGateRect(cw, ch, pw, ph, modeId) {
  const safeCw = Math.max(120, cw);
  const safeCh = Math.max(120, ch);
  const safePw = Math.max(80, pw);
  const safePh = Math.max(80, ph);

  let w = safePw;
  let h = safePh;

  if (modeId === 'squeeze') {
    w = Math.round(safePw / 1.33);
    h = safePh;
  } else if (modeId === 'desqueeze') {
    const targetW = Math.round(safePh * 2.39);
    if (targetW <= safeCw - 24) {
      w = targetW;
      h = safePh;
    } else {
      w = Math.max(200, safeCw - 14);
      h = Math.max(146, Math.round(w / 2.39));
    }
  } else {
    w = Math.min(safePw, safeCw - 16);
    h = safePh;
  }

  return {
    x: Math.round((safeCw - w) * 0.5),
    y: Math.round((safeCh - h) * 0.5),
    w,
    h,
    scaleX: w / safePw,
    scaleY: h / safePh,
  };
}
// #endregion layout-math

// #region flare-shaders
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

const WARP_GLSL = `
vec2 warpPanelUv(vec2 uv, float barrel) {
  if (abs(barrel) < 0.0001) return uv;
  vec2 p = uv * 2.0 - 1.0;
  float r2 = dot(p, p);
  float k = barrel * (r2 - 0.35);
  vec2 warped = p * vec2(1.0 + k * 0.088, 1.0 + k * 0.056);
  return warped * 0.5 + 0.5;
}`;

// Pass 1: Extract pixels above uThreshold from the premultiplied DOM texture.
const BRIGHT_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uDomTex;
uniform vec2 uDomSize;
uniform vec4 uGateRect;    // x, y, w, h in top-down stage UV [0..1]
uniform float uThreshold;
uniform float uBarrel;
uniform float uPulse;
uniform float uIgniteBoost;
in vec2 vUv;
out vec4 outColor;
${WARP_GLSL}

vec3 sampleBright(vec2 domUv) {
  if (domUv.x < 0.0 || domUv.x > 1.0 || domUv.y < 0.0 || domUv.y > 1.0) return vec3(0.0);
  vec4 tex = texture(uDomTex, domUv);
  if (tex.a < 0.004) return vec3(0.0);
  vec3 rgb = clamp(tex.rgb / tex.a, 0.0, 1.0);
  float lum = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  float maxC = max(rgb.r, max(rgb.g, rgb.b));
  float peak = max(lum, maxC * 0.94);
  float knee = max(0.06, 0.22 * (1.0 - uThreshold));
  float mask = smoothstep(uThreshold - knee * 0.35, min(0.995, uThreshold + knee), peak) * tex.a;
  float gain = (1.0 + 0.55 * uIgniteBoost) * uPulse;
  return rgb * mask * gain;
}

void main() {
  vec2 stUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 panelUv = (stUv - uGateRect.xy) / max(uGateRect.zw, vec2(0.0001));
  if (panelUv.x < 0.0 || panelUv.x > 1.0 || panelUv.y < 0.0 || panelUv.y > 1.0) {
    outColor = vec4(0.0);
    return;
  }
  vec2 wUv = warpPanelUv(panelUv, uBarrel);
  vec2 px = 0.65 / max(uDomSize, vec2(1.0));
  vec3 sum = sampleBright(wUv) * 0.40
    + sampleBright(wUv + vec2(px.x, 0.0)) * 0.15
    + sampleBright(wUv - vec2(px.x, 0.0)) * 0.15
    + sampleBright(wUv + vec2(0.0, px.y)) * 0.15
    + sampleBright(wUv - vec2(0.0, px.y)) * 0.15;
  outColor = vec4(clamp(sum, 0.0, 2.5), 1.0);
}`;

// Pass 2 & 3: 21-tap anisotropic horizontal streak convolution + cyan-cobalt chromatic tint + warm optical ghosting.
const STREAK_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform float uStreakScale;
uniform float uAnamorphicMix;
uniform int uPass;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 acc = vec3(0.0);
  float stepPx = (uPass == 0 ? 2.6 : 11.2) * max(uStreakScale, 0.08);
  vec3 cyanCore = vec3(0.56, 0.92, 1.0);
  vec3 cobaltWing = vec3(0.10, 0.56, 1.0);
  vec3 warmGhostTint = vec3(1.0, 0.54, 0.22);

  for (int i = -10; i <= 10; i++) {
    float fi = float(i);
    float distNorm = abs(fi) / 10.0;
    float w = exp(-abs(fi) * (uPass == 0 ? 0.18 : 0.15));
    vec2 off = vec2(fi * stepPx * uTexel.x, 0.0);
    vec3 s = texture(uSrc, clamp(vUv + off, vec2(0.001), vec2(0.999))).rgb;
    if (uPass == 0) {
      vec3 sTop = texture(uSrc, clamp(vUv + off + vec2(0.0, uTexel.y * 0.65), vec2(0.001), vec2(0.999))).rgb;
      vec3 sBot = texture(uSrc, clamp(vUv + off - vec2(0.0, uTexel.y * 0.65), vec2(0.001), vec2(0.999))).rgb;
      s = s * 0.56 + (sTop + sBot) * 0.22;
      vec3 streakTint = mix(cyanCore, cobaltWing, smoothstep(0.1, 0.9, distNorm));
      float luma = dot(s, vec3(0.25, 0.55, 0.20));
      vec3 tinted = mix(s, streakTint * max(luma, max(s.r, max(s.g, s.b))), 0.78 * uAnamorphicMix);
      acc += tinted * w;
    } else {
      acc += s * w;
    }
  }

  float norm = uPass == 0 ? 0.145 : 0.135;
  vec3 res = acc * norm;

  // Secondary warm internal-element optical reflection ghost on Pass 0.
  if (uPass == 0 && uAnamorphicMix > 0.05) {
    vec2 ghostUv = vec2(1.0 - vUv.x, 1.0 - vUv.y);
    vec2 gCenter = vec2(0.5) + (ghostUv - 0.5) * 0.86;
    vec3 g0 = texture(uSrc, clamp(gCenter, vec2(0.001), vec2(0.999))).rgb;
    vec3 g1 = texture(uSrc, clamp(gCenter + vec2(uTexel.x * 5.0, 0.0), vec2(0.001), vec2(0.999))).rgb;
    vec3 g2 = texture(uSrc, clamp(gCenter - vec2(uTexel.x * 5.0, 0.0), vec2(0.001), vec2(0.999))).rgb;
    vec3 ghostSample = (g0 + g1 + g2) * 0.333;
    float gLum = max(ghostSample.r, max(ghostSample.g, ghostSample.b));
    res += warmGhostTint * gLum * 0.26 * uAnamorphicMix;
  }

  outColor = vec4(clamp(res, 0.0, 3.0), 1.0);
}`;

// Pass 4: 32-tap Vogel-disc elliptical oval bokeh aperture (2:1 vertical oval in 2.39:1 desqueeze).
const BOKEH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uBrightTex;
uniform vec2 uTexel;
uniform float uAniso;
uniform float uAspect;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec3 acc = vec3(0.0);
  float wSum = 0.0;
  // Elliptical aperture: vertically tall oval when uAniso > 1.0, circular at 1.0.
  vec2 radius = vec2(1.0 / max(uAniso, 0.5), uAniso) * vec2(8.5 * uTexel.x, 8.5 * uTexel.x * uAspect);
  const float GOLDEN_ANGLE = 2.39996323;

  for (int k = 0; k < 32; k++) {
    float fk = float(k);
    float rNorm = sqrt((fk + 0.5) / 32.0);
    float ang = fk * GOLDEN_ANGLE;
    vec2 dir = vec2(cos(ang), sin(ang)) * rNorm;
    // Slight outer-edge ring bias mimics cinema spherical aberration without discrete ring echoes.
    float weight = mix(0.75, 1.30, smoothstep(0.25, 1.0, rNorm));
    vec2 uv = clamp(vUv + dir * radius, vec2(0.001), vec2(0.999));
    acc += texture(uBrightTex, uv).rgb * weight;
    wSum += weight;
  }

  vec3 bokeh = acc / max(wSum, 0.001);
  vec3 tint = mix(vec3(0.45, 0.85, 1.0), vec3(1.0), 0.32);
  outColor = vec4(clamp(bokeh * tint * 1.45, 0.0, 3.0), 1.0);
}`;

// Pass 5: Composite warped DOM panel inside 2.39:1 cinema letterbox frame with streak + oval bokeh.
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uDomTex;
uniform sampler2D uStreakTex;
uniform sampler2D uBokehTex;
uniform vec4 uGateRect;
uniform float uBarrel;
uniform float uIntensity;
uniform float uAnamorphicMix;
uniform float uBreathe;
in vec2 vUv;
out vec4 outColor;
${WARP_GLSL}

void main() {
  vec2 stUv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 panelUv = (stUv - uGateRect.xy) / max(uGateRect.zw, vec2(0.0001));

  // Dark theatre matte backdrop with subtle radial spotlight falloff
  vec2 bgP = stUv - 0.5;
  float bgVig = exp(-dot(bgP, bgP) * 2.4);
  vec3 col = mix(vec3(0.012, 0.015, 0.024), vec3(0.028, 0.036, 0.056), bgVig);

  // Subtle corner lens aberration + edge barrel breathe inside active gate
  float activeBarrel = uBarrel * (1.0 + uBreathe);
  vec2 wUv = warpPanelUv(panelUv, activeBarrel);
  float inPanel = 0.0;

  if (wUv.x >= 0.0 && wUv.x <= 1.0 && wUv.y >= 0.0 && wUv.y <= 1.0) {
    inPanel = 1.0;
    vec2 pCentered = panelUv * 2.0 - 1.0;
    float r2 = dot(pCentered, pCentered);
    float chroma = uBarrel * 0.0028 * max(0.0, r2 - 0.38);

    vec4 texC = texture(uDomTex, wUv);
    float rCh = texture(uDomTex, clamp(wUv + vec2(chroma, 0.0), vec2(0.001), vec2(0.999))).r;
    float bCh = texture(uDomTex, clamp(wUv - vec2(chroma, 0.0), vec2(0.001), vec2(0.999))).b;
    vec3 domRgb = vec3(mix(texC.r, rCh, step(0.0001, chroma)), texC.g, mix(texC.b, bCh, step(0.0001, chroma)));

    // Gentle anamorphic corner light falloff (cos^4 optical vignetting)
    float edgeVig = 1.0 - uBarrel * 0.14 * max(0.0, r2 - 0.45);
    vec3 cardLayer = domRgb * edgeVig + col * (1.0 - texC.a);

    // Subtle crisp optical frame hairline at the warped gate border
    vec2 edgeD = min(wUv, 1.0 - wUv);
    float border = (1.0 - smoothstep(0.001, 0.006, min(edgeD.x, edgeD.y))) * 0.34;
    col = mix(cardLayer, vec3(0.32, 0.72, 0.92), border);
  }

  vec3 streak = texture(uStreakTex, vUv).rgb;
  vec3 bokeh = texture(uBokehTex, vUv).rgb;

  // Keep button & slugline typography sharp inside the HUD chrome while letting streaks bloom at full power across the field and wings.
  float inChrome = inPanel * (1.0 - smoothstep(0.20, 0.28, wUv.y) * (1.0 - smoothstep(0.70, 0.78, wUv.y)));
  float interiorMask = mix(1.0, 0.44, inChrome);

  // Soft theatre vignette keeps streaks fading gracefully at outer canvas edges
  float outerFade = 1.0 - smoothstep(0.45, 0.96, length(bgP));
  vec3 flare = streak * uIntensity * mix(0.18, 1.32, uAnamorphicMix) * (0.45 + 0.55 * outerFade) * interiorMask
             + bokeh * uIntensity * mix(0.36, 0.62, uAnamorphicMix) * interiorMask;

  // Filmic highlight rolloff so overlapping cyan-cobalt streaks stay luminous without flat clipping
  vec3 combined = col + flare;
  vec3 mapped = 1.0 - exp(-combined * 1.25);
  col = mix(combined, mapped, clamp(max(flare.r, max(flare.g, flare.b)) * 0.85, 0.0, 0.92));

  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}`;
// #endregion flare-shaders

// #region pipeline
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

export class AnamorphicPipeline {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    this.progs = {
      bright: linkProgram(gl, QUAD_VERT, BRIGHT_FRAG),
      streak: linkProgram(gl, QUAD_VERT, STREAK_FRAG),
      bokeh: linkProgram(gl, QUAD_VERT, BOKEH_FRAG),
      composite: linkProgram(gl, QUAD_VERT, COMPOSITE_FRAG),
    };
    this.fboW = 320;
    this.fboH = 180;
    this.fbos = {
      bright: createFbo(gl, this.fboW, this.fboH),
      streakA: createFbo(gl, this.fboW, this.fboH),
      streakB: createFbo(gl, this.fboW, this.fboH),
      bokeh: createFbo(gl, this.fboW, this.fboH),
    };
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

  render({
    canvas,
    domTex,
    domW,
    domH,
    gateRect,
    cw,
    ch,
    threshold,
    intensity,
    barrel,
    aniso,
    streakScale,
    anamorphicMix,
    breathe,
    pulse,
    igniteBoost,
  }) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const gx = gateRect.x / Math.max(1, cw);
    const gy = gateRect.y / Math.max(1, ch);
    const gw = gateRect.w / Math.max(1, cw);
    const gh = gateRect.h / Math.max(1, ch);
    const aspect = cw / Math.max(1, ch);

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    // 1. Bright-pass extract
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.bright.fbo);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.useProgram(this.progs.bright);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, domTex);
    gl.uniform1i(this.#u(this.progs.bright, 'uDomTex'), 0);
    gl.uniform2f(this.#u(this.progs.bright, 'uDomSize'), domW, domH);
    gl.uniform4f(this.#u(this.progs.bright, 'uGateRect'), gx, gy, gw, gh);
    gl.uniform1f(this.#u(this.progs.bright, 'uThreshold'), threshold);
    gl.uniform1f(this.#u(this.progs.bright, 'uBarrel'), barrel);
    gl.uniform1f(this.#u(this.progs.bright, 'uPulse'), pulse);
    gl.uniform1f(this.#u(this.progs.bright, 'uIgniteBoost'), igniteBoost);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. Horizontal streak pass 0 (21 taps + cyan-cobalt chromatic tint + warm ghost)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.streakA.fbo);
    gl.useProgram(this.progs.streak);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.bright.tex);
    gl.uniform1i(this.#u(this.progs.streak, 'uSrc'), 0);
    gl.uniform2f(this.#u(this.progs.streak, 'uTexel'), 1 / this.fboW, 1 / this.fboH);
    gl.uniform1f(this.#u(this.progs.streak, 'uStreakScale'), streakScale);
    gl.uniform1f(this.#u(this.progs.streak, 'uAnamorphicMix'), anamorphicMix);
    gl.uniform1i(this.#u(this.progs.streak, 'uPass'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. Horizontal streak pass 1 (21 wide taps across the frame)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.streakB.fbo);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.streakA.tex);
    gl.uniform1i(this.#u(this.progs.streak, 'uPass'), 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 4. Elliptical oval bokeh pass (24-tap aperture disc)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbos.bokeh.fbo);
    gl.useProgram(this.progs.bokeh);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.bright.tex);
    gl.uniform1i(this.#u(this.progs.bokeh, 'uBrightTex'), 0);
    gl.uniform2f(this.#u(this.progs.bokeh, 'uTexel'), 1 / this.fboW, 1 / this.fboH);
    gl.uniform1f(this.#u(this.progs.bokeh, 'uAniso'), aniso);
    gl.uniform1f(this.#u(this.progs.bokeh, 'uAspect'), aspect);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 5. Final cinema composite to default framebuffer
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.progs.composite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, domTex);
    gl.uniform1i(this.#u(this.progs.composite, 'uDomTex'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.streakB.tex);
    gl.uniform1i(this.#u(this.progs.composite, 'uStreakTex'), 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.fbos.bokeh.tex);
    gl.uniform1i(this.#u(this.progs.composite, 'uBokehTex'), 2);
    gl.uniform4f(this.#u(this.progs.composite, 'uGateRect'), gx, gy, gw, gh);
    gl.uniform1f(this.#u(this.progs.composite, 'uBarrel'), barrel);
    gl.uniform1f(this.#u(this.progs.composite, 'uIntensity'), intensity);
    gl.uniform1f(this.#u(this.progs.composite, 'uAnamorphicMix'), anamorphicMix);
    gl.uniform1f(this.#u(this.progs.composite, 'uBreathe'), breathe);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  dispose() {
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    for (const f of Object.values(this.fbos)) {
      gl.deleteFramebuffer(f.fbo);
      gl.deleteTexture(f.tex);
    }
    for (const p of Object.values(this.progs)) gl.deleteProgram(p);
    gl.deleteVertexArray(this.vao);
  }
}
// #endregion pipeline

// #region geometry-sync
export function syncPanelGeometry({
  canvasEl,
  panelEl,
  gateRect,
  pw,
  mode,
  unitCache,
  lastGeoKeyRef,
  force = false,
}) {
  if (!canvasEl || mode === 'plain' || typeof canvasEl.updateElementGeometry !== 'function') return;

  const key = `${mode}|${canvasEl.width}x${canvasEl.height}|${pw}|${gateRect.x}:${gateRect.y}:${gateRect.w}:${gateRect.h}`;
  if (!force && lastGeoKeyRef.value === key) return;
  lastGeoKeyRef.value = key;

  if (mode === '2d') {
    panelEl.dataset.hitTick = panelEl.dataset.hitTick === '1' ? '0' : '1';
    return;
  }

  const zoom = panelEl.currentCSSZoom || 1;
  const uKey = `${canvasEl.width}x${canvasEl.height}/${canvasEl.clientWidth}x${canvasEl.clientHeight}/${pw}/${zoom}`;
  if (unitCache.key !== uKey) {
    unitCache.unit = geometryUnit(canvasEl, panelEl, pw);
    unitCache.key = uKey;
  }
  const u = unitCache.unit;
  const mat = new DOMMatrix()
    .scale(u, u, 1)
    .translate(gateRect.x, gateRect.y)
    .scale(gateRect.scaleX, gateRect.scaleY);

  canvasEl.updateElementGeometry(panelEl, { canvasTransform: mat });
  panelEl.dataset.hitTick = panelEl.dataset.hitTick === '1' ? '0' : '1';
}
// #endregion geometry-sync

export function mountAnamorphicFlare() {
  banner();

  const stageBox = document.getElementById('flare-stage');
  const viewportEl = document.getElementById('flare-viewport');
  let canvas = document.getElementById('flare-canvas');
  const cinemaPanel = document.getElementById('cinema-panel');
  const cinemaField = document.getElementById('cinema-field');
  const plainHost = document.getElementById('plain-host');
  const noticeEl = document.getElementById('flare-notice');
  const statusEl = document.getElementById('flare-status');

  // Inside drawable DOM
  const calloutLens = document.getElementById('callout-lens');
  const slugInput = document.getElementById('slugline-input');
  const spotlampFlare = document.getElementById('spotlamp-flare');
  const lightPuck = document.getElementById('light-puck');
  const btnIgnite = document.getElementById('btn-ignite');
  const btnSpotlamp = document.getElementById('btn-spotlamp');
  const hudReadout = document.getElementById('hud-readout');

  // External controls
  const squeezeBtns = Array.from(document.querySelectorAll('button[data-squeeze]'));
  const intensityInput = document.getElementById('ctl-intensity');
  const intensityOut = document.getElementById('out-intensity');
  const thresholdInput = document.getElementById('ctl-threshold');
  const thresholdOut = document.getElementById('out-threshold');
  const reducedCheck = document.getElementById('ctl-reduced');

  const reducedMQ = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  if (reducedMQ.matches) reducedCheck.checked = true;

  const state = {
    mode: 'init', // 'webgl' | '2d' | 'plain'
    squeezeMode: 'desqueeze',
    intensity: Number(intensityInput.value),
    threshold: Number(thresholdInput.value),
    reduced: reducedCheck.checked,
    ignited: true,
    spotlamp: false,
    puckX: 62, // percentage inside .cinema-field
    puckY: 50,
    drag: null,
    hasPainted: false,
    dirtyPanel: true,
    onScreen: true,
    uploads: 0,
    paints: 0,
    rafId: 0,
    lastTickMs: 0,
    lastHudMs: 0,
    unitCache: { key: '', unit: 1 },
    lastGeoKeyRef: { value: '' },
    anim: {
      scaleX: 1.28,
      scaleY: 1.0,
      barrel: 1.0,
      aniso: 1.48,
      streakScale: 1.0,
      flareGain: 1.0,
    },
  };

  let stage = null;
  let pipeline = null;
  let panelTex = null;
  let ctx2d = null;

  const isReducedMotion = () => state.reduced || reducedMQ.matches;

  function showNotice(msg) {
    noticeEl.hidden = !msg;
    noticeEl.textContent = msg || '';
  }

  function syncCompactClass(cw) {
    cinemaPanel.classList.toggle('is-compact', cw < 620);
  }

  function getPanelLayoutSize(cw) {
    const compact = cw < 620;
    const pw = cinemaPanel.offsetWidth || (compact ? 304 : 460);
    const ph = cinemaPanel.offsetHeight || (compact ? 196 : 244);
    return { pw, ph };
  }

  function getTargetMetrics() {
    const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 360);
    const ch = Math.max(120, canvas.clientHeight || viewportEl.clientHeight || 320);
    const { pw, ph } = getPanelLayoutSize(cw);
    const rect = computeGateRect(cw, ch, pw, ph, state.squeezeMode);
    const spec = MODES[state.squeezeMode];
    return {
      cw,
      ch,
      pw,
      ph,
      targetRect: rect,
      barrel: spec.barrel,
      aniso: spec.aniso,
      streakScale: spec.streakScale,
      flareGain: spec.flareGain,
    };
  }

  function snapOpticsToTarget() {
    const m = getTargetMetrics();
    state.anim.scaleX = m.targetRect.scaleX;
    state.anim.scaleY = m.targetRect.scaleY;
    state.anim.barrel = m.barrel;
    state.anim.aniso = m.aniso;
    state.anim.streakScale = m.streakScale;
    state.anim.flareGain = m.flareGain;
  }

  function currentGateRect(cw, ch, pw, ph) {
    const w = Math.round(pw * state.anim.scaleX);
    const h = Math.round(ph * state.anim.scaleY);
    return {
      x: Math.round((cw - w) * 0.5),
      y: Math.round((ch - h) * 0.5),
      w,
      h,
      scaleX: w / pw,
      scaleY: h / ph,
    };
  }

  function syncInPanelUI() {
    const spec = MODES[state.squeezeMode];
    calloutLens.textContent = spec.label;
    btnIgnite.setAttribute('aria-pressed', String(state.ignited));
    btnIgnite.classList.toggle('is-lit', state.ignited);
    btnSpotlamp.setAttribute('aria-pressed', String(state.spotlamp));
    btnSpotlamp.classList.toggle('is-lit', state.spotlamp);
    spotlampFlare.classList.toggle('is-active', state.spotlamp);
    cinemaPanel.classList.toggle('is-reduced', isReducedMotion());
    lightPuck.style.left = `${state.puckX.toFixed(1)}%`;
    lightPuck.style.top = `${state.puckY.toFixed(1)}%`;
    hudReadout.textContent = `${state.ignited ? 'FLARE ON' : 'STANDBY'} · ${state.spotlamp ? 'SPOT' : 'T2.0'}`;
    state.dirtyPanel = true;
  }

  function updateStatus(force = false) {
    const now = performance.now();
    if (!force && now - state.lastHudMs < 140) return;
    state.lastHudMs = now;
    const routeLabel = state.mode === 'webgl' ? 'WebGL 2 ElementGL' : state.mode === '2d' ? '2D drawElementImage()' : 'Plain HTML';
    const mp = state.mode === 'plain' ? '0.00' : ((canvas.width * canvas.height) / 1e6).toFixed(2);
    const modeName = MODES[state.squeezeMode].hud;
    statusEl.textContent = `${routeLabel} · ${modeName} · ${canvas.width}×${canvas.height} px (${mp} MP) · ${state.uploads} uploads.`;
  }

  function tryUploadPanel() {
    if (!stage || stage.lost) return null;
    try {
      const tex = stage.upload(cinemaPanel);
      if (tex) {
        panelTex = tex;
        state.dirtyPanel = false;
        state.uploads++;
      }
      return tex;
    } catch (err) {
      if (/paint record/i.test(err?.message ?? '')) {
        canvas.requestPaint?.();
        return panelTex;
      }
      throw err;
    }
  }

  function renderWebGL(uploadNow) {
    if (!state.hasPainted || !stage || stage.lost || !pipeline) return;
    const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 360);
    const ch = Math.max(120, canvas.clientHeight || viewportEl.clientHeight || 320);
    const { pw, ph } = getPanelLayoutSize(cw);
    const gate = currentGateRect(cw, ch, pw, ph);

    // Always call stage.begin() BEFORE stage.upload() so buffer sizing matches CSS pixels.
    if (!stage.begin([0.014, 0.018, 0.030, 1.0])) return;
    if (uploadNow || state.dirtyPanel || !panelTex) {
      tryUploadPanel();
    }
    if (!panelTex) return;

    const reduced = isReducedMotion();
    const t = performance.now() / 1000;
    const pulse = reduced
      ? 1.0
      : 0.92 + 0.08 * Math.sin(t * 2.1) + 0.03 * Math.sin(t * 5.0);
    const breathe = reduced ? 0.0 : 0.04 * Math.sin(t * 1.35);

    pipeline.render({
      canvas,
      domTex: panelTex.tex,
      domW: panelTex.w,
      domH: panelTex.h,
      gateRect: gate,
      cw,
      ch,
      threshold: state.threshold,
      intensity: state.intensity,
      barrel: state.anim.barrel,
      aniso: state.anim.aniso,
      streakScale: state.anim.streakScale,
      anamorphicMix: state.anim.flareGain,
      breathe,
      pulse,
      igniteBoost: state.ignited ? 1.0 : 0.0,
    });

    syncPanelGeometry({
      canvasEl: canvas,
      panelEl: cinemaPanel,
      gateRect: gate,
      pw,
      mode: state.mode,
      unitCache: state.unitCache,
      lastGeoKeyRef: state.lastGeoKeyRef,
    });

    state.paints++;
    updateStatus();
  }

  // #region fallback-2d
  function render2DFallback() {
    if (!state.hasPainted || !ctx2d) return;
    const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 360);
    const ch = Math.max(120, canvas.clientHeight || viewportEl.clientHeight || 320);
    const { pw, ph } = getPanelLayoutSize(cw);
    const gate = currentGateRect(cw, ch, pw, ph);

    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const bw = Math.max(1, Math.round(cw * dpr));
    const bh = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    ctx2d.save();
    ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2d.fillStyle = '#070a10';
    ctx2d.fillRect(0, 0, cw, ch);

    // 5-argument drawElementImage() keeps CSS layout proportions on high-DPI phones.
    ctx2d.drawElementImage(cinemaPanel, gate.x, gate.y, gate.w, gate.h);

    if (state.intensity > 0.05 && state.anim.flareGain > 0.05) {
      const puckCssX = gate.x + gate.w * (0.12 + 0.76 * (state.puckX / 100));
      const puckCssY = gate.y + gate.h * (0.28 + 0.42 * (state.puckY / 100));
      const streakAlpha = clamp(0.32 * state.intensity * state.anim.flareGain, 0, 0.72);
      const grad = ctx2d.createLinearGradient(0, puckCssY, cw, puckCssY);
      grad.addColorStop(0, 'rgba(30, 144, 255, 0)');
      grad.addColorStop(clamp(puckCssX / cw, 0.05, 0.95), `rgba(125, 244, 255, ${streakAlpha.toFixed(3)})`);
      grad.addColorStop(1, 'rgba(30, 144, 255, 0)');
      ctx2d.fillStyle = grad;
      ctx2d.fillRect(0, puckCssY - 3, cw, 6);
    }

    ctx2d.restore();
    syncPanelGeometry({
      canvasEl: canvas,
      panelEl: cinemaPanel,
      gateRect: gate,
      pw,
      mode: state.mode,
      unitCache: state.unitCache,
      lastGeoKeyRef: state.lastGeoKeyRef,
    });
    state.paints++;
    updateStatus();
  }

  function enterPlainFallback(reason) {
    state.mode = 'plain';
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    stageBox.classList.add('is-plain');
    cinemaPanel.inert = false;
    cinemaPanel.dataset.squeezeMode = state.squeezeMode;
    if (cinemaPanel.parentElement !== plainHost) plainHost.append(cinemaPanel);
    showNotice(reason);
    updateStatus(true);
  }

  function exitPlainFallback() {
    stageBox.classList.remove('is-plain');
    delete cinemaPanel.dataset.squeezeMode;
    if (cinemaPanel.parentElement !== canvas) canvas.append(cinemaPanel);
    showNotice('');
  }
  // #endregion fallback-2d

  function needsContinuousLoop() {
    if (!state.onScreen || document.hidden || state.mode === 'plain') return false;
    const m = getTargetMetrics();
    const settling =
      Math.abs(state.anim.scaleX - m.targetRect.scaleX) > 0.002 ||
      Math.abs(state.anim.scaleY - m.targetRect.scaleY) > 0.002 ||
      Math.abs(state.anim.barrel - m.barrel) > 0.004 ||
      Math.abs(state.anim.aniso - m.aniso) > 0.004;
    if (settling) return true;
    return !isReducedMotion() && state.mode === 'webgl' && (state.ignited || state.spotlamp);
  }

  function stopLoop() {
    if (state.rafId) {
      cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  function startLoop() {
    if (state.rafId || !needsContinuousLoop()) return;
    state.lastTickMs = performance.now();
    state.rafId = requestAnimationFrame(tick);
  }

  function drawCurrentFrame(uploadNow = false) {
    if (state.mode === 'plain') {
      cinemaPanel.dataset.squeezeMode = state.squeezeMode;
      updateStatus(true);
      return;
    }
    if (!state.hasPainted) {
      canvas.requestPaint?.();
      return;
    }
    if (state.mode === 'webgl') renderWebGL(uploadNow);
    else if (state.mode === '2d') render2DFallback();
  }

  function tick(now) {
    state.rafId = 0;
    if (!state.onScreen || document.hidden || state.mode === 'plain') return;
    const dt = clamp((now - state.lastTickMs) / 1000, 0.001, 0.05);
    state.lastTickMs = now;

    if (isReducedMotion()) {
      snapOpticsToTarget();
    } else {
      const m = getTargetMetrics();
      const k = 1 - Math.exp(-14 * dt);
      state.anim.scaleX = lerp(state.anim.scaleX, m.targetRect.scaleX, k);
      state.anim.scaleY = lerp(state.anim.scaleY, m.targetRect.scaleY, k);
      state.anim.barrel = lerp(state.anim.barrel, m.barrel, k);
      state.anim.aniso = lerp(state.anim.aniso, m.aniso, k);
      state.anim.streakScale = lerp(state.anim.streakScale, m.streakScale, k);
      state.anim.flareGain = lerp(state.anim.flareGain, m.flareGain, k);
    }

    drawCurrentFrame(false);
    if (needsContinuousLoop()) {
      state.rafId = requestAnimationFrame(tick);
    }
  }

  function wireCanvasEvents(cv) {
    cv.addEventListener('paint', () => {
      state.hasPainted = true;
      if (state.mode === 'webgl') renderWebGL(true);
      else if (state.mode === '2d') render2DFallback();
      startLoop();
    });
    cv.addEventListener('contextlost', (e) => {
      e.preventDefault();
      if (state.mode === '2d') {
        enterPlainFallback('The 2D canvas context was lost. Showing the cinema panel as plain HTML.');
      }
    });
    cv.addEventListener('contextrestored', () => {
      if (state.mode === 'plain' && ctx2d) {
        state.mode = '2d';
        state.hasPainted = false;
        exitPlainFallback();
        cv.requestPaint?.();
      }
    });
  }

  function initBackend() {
    const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 360);
    syncCompactClass(cw);
    snapOpticsToTarget();
    syncInPanelUI();

    if (hicSupported && glSupported) {
      try {
        stage = new ElementGL(canvas, {
          fragment: PASSTHROUGH_FRAG,
          attributes: { alpha: false, antialias: false, powerPreference: 'low-power' },
          onLost: () => {
            panelTex = null;
            pipeline = null;
            enterPlainFallback('WebGL 2 context was lost. Moved the cinema HUD to plain HTML until restored.');
          },
          onRestored: () => {
            panelTex = null;
            stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            pipeline = new AnamorphicPipeline(stage.gl);
            state.mode = 'webgl';
            state.hasPainted = false;
            state.dirtyPanel = true;
            state.unitCache.key = '';
            state.lastGeoKeyRef.value = '';
            exitPlainFallback();
            snapOpticsToTarget();
            canvas.requestPaint?.();
          },
        });
        stage.gl.pixelStorei(stage.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        pipeline = new AnamorphicPipeline(stage.gl);
        state.mode = 'webgl';
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      } catch (err) {
        stage = null;
        pipeline = null;
        const fresh = document.createElement('canvas');
        fresh.id = 'flare-canvas';
        fresh.setAttribute('content', 'drawable');
        fresh.setAttribute('layoutsubtree', '');
        fresh.setAttribute('aria-label', canvas.getAttribute('aria-label') || '');
        fresh.append(cinemaPanel);
        canvas.replaceWith(fresh);
        window.__gfx?.retire?.(canvas);
        canvas = fresh;
        showNotice(`WebGL 2 could not start (${err.message}). Using the 2D fallback.`);
      }
    }

    if (hicSupported && 'requestPaint' in HTMLCanvasElement.prototype) {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        state.mode = '2d';
        if (noticeEl.hidden) {
          showNotice('WebGL 2 texElementSubImage2D() is unavailable here; using the 5-argument 2D drawElementImage() fallback.');
        }
        wireCanvasEvents(canvas);
        canvas.requestPaint?.();
        return;
      }
    }

    enterPlainFallback('HTML-in-canvas is not available in this browser, so the cinema HUD is shown as plain HTML.');
  }

  // Interactive DOM handlers inside #cinema-panel
  btnIgnite.addEventListener('click', () => {
    state.ignited = !state.ignited;
    syncInPanelUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
    else drawCurrentFrame(false);
    startLoop();
  });

  btnSpotlamp.addEventListener('click', () => {
    state.spotlamp = !state.spotlamp;
    syncInPanelUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
    else drawCurrentFrame(false);
    startLoop();
  });

  slugInput.addEventListener('input', () => {
    state.dirtyPanel = true;
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  // Movable bright specular badge / light puck (pointer drag + keyboard arrows)
  function updatePuckFromClient(clientX, clientY) {
    const fieldRect = cinemaField.getBoundingClientRect();
    const cw = canvas.clientWidth || viewportEl.clientWidth || 360;
    const ch = canvas.clientHeight || viewportEl.clientHeight || 320;
    const { pw, ph } = getPanelLayoutSize(cw);
    const gate = currentGateRect(cw, ch, pw, ph);

    let pctX;
    let pctY;
    if (state.mode === 'plain') {
      pctX = ((clientX - fieldRect.left) / Math.max(1, fieldRect.width)) * 100;
      pctY = ((clientY - fieldRect.top) / Math.max(1, fieldRect.height)) * 100;
    } else {
      const cRect = canvas.getBoundingClientRect();
      const localPanelX = (clientX - cRect.left - gate.x) / Math.max(0.1, gate.scaleX);
      const localPanelY = (clientY - cRect.top - gate.y) / Math.max(0.1, gate.scaleY);
      const fieldLeft = cinemaField.offsetLeft;
      const fieldTop = cinemaField.offsetTop;
      const fieldW = Math.max(1, cinemaField.offsetWidth);
      const fieldH = Math.max(1, cinemaField.offsetHeight);
      pctX = ((localPanelX - fieldLeft) / fieldW) * 100;
      pctY = ((localPanelY - fieldTop) / fieldH) * 100;
    }

    state.puckX = clamp(pctX, 8, 92);
    state.puckY = clamp(pctY, 22, 78);
    syncInPanelUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
  }

  lightPuck.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    state.drag = { pointerId: e.pointerId };
    try { lightPuck.setPointerCapture?.(e.pointerId); } catch {}
    updatePuckFromClient(e.clientX, e.clientY);
  });

  lightPuck.addEventListener('pointermove', (e) => {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    e.preventDefault();
    updatePuckFromClient(e.clientX, e.clientY);
  });

  const endPuckDrag = (e) => {
    if (!state.drag || e.pointerId !== state.drag.pointerId) return;
    state.drag = null;
    try { lightPuck.releasePointerCapture?.(e.pointerId); } catch {}
  };
  lightPuck.addEventListener('pointerup', endPuckDrag);
  lightPuck.addEventListener('pointercancel', endPuckDrag);

  lightPuck.addEventListener('keydown', (e) => {
    const step = 6;
    if (e.key === 'ArrowRight') { e.preventDefault(); state.puckX = clamp(state.puckX + step, 8, 92); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); state.puckX = clamp(state.puckX - step, 8, 92); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); state.puckY = clamp(state.puckY + step, 22, 78); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); state.puckY = clamp(state.puckY - step, 22, 78); }
    else return;
    syncInPanelUI();
    if (state.mode !== 'plain') canvas.requestPaint?.();
  });

  // External optical controls
  for (const btn of squeezeBtns) {
    btn.addEventListener('click', () => {
      const next = btn.dataset.squeeze;
      if (!MODES[next] || next === state.squeezeMode) return;
      state.squeezeMode = next;
      for (const b of squeezeBtns) b.setAttribute('aria-pressed', String(b === btn));
      syncInPanelUI();
      if (isReducedMotion()) {
        snapOpticsToTarget();
        drawCurrentFrame(true);
      } else if (state.mode === 'plain') {
        drawCurrentFrame(false);
      } else {
        canvas.requestPaint?.();
        startLoop();
      }
      updateStatus(true);
    });
  }

  intensityInput.addEventListener('input', () => {
    state.intensity = Number(intensityInput.value);
    intensityOut.textContent = `${state.intensity.toFixed(2)}×`;
    drawCurrentFrame(false);
  });

  thresholdInput.addEventListener('input', () => {
    state.threshold = Number(thresholdInput.value);
    thresholdOut.textContent = state.threshold.toFixed(2);
    drawCurrentFrame(false);
  });

  reducedCheck.addEventListener('change', () => {
    state.reduced = reducedCheck.checked;
    syncInPanelUI();
    if (isReducedMotion()) {
      stopLoop();
      snapOpticsToTarget();
    }
    if (state.mode !== 'plain') canvas.requestPaint?.();
    else drawCurrentFrame(false);
    startLoop();
  });

  reducedMQ.addEventListener?.('change', () => {
    reducedCheck.checked = reducedMQ.matches;
    state.reduced = reducedMQ.matches;
    syncInPanelUI();
    if (isReducedMotion()) {
      stopLoop();
      snapOpticsToTarget();
    }
    if (state.mode !== 'plain') canvas.requestPaint?.();
    startLoop();
  });

  new IntersectionObserver(([entry]) => {
    state.onScreen = entry.isIntersecting;
    if (!state.onScreen) stopLoop();
    else {
      if (state.mode !== 'plain' && state.hasPainted) drawCurrentFrame(false);
      startLoop();
    }
  }, { rootMargin: '80px 0px' }).observe(stageBox);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else if (state.onScreen) {
      if (state.mode !== 'plain' && state.hasPainted) drawCurrentFrame(false);
      startLoop();
    }
  });

  new ResizeObserver(() => {
    if (state.mode === 'plain') return;
    const cw = Math.max(120, canvas.clientWidth || viewportEl.clientWidth || 360);
    syncCompactClass(cw);
    state.unitCache.key = '';
    state.lastGeoKeyRef.value = '';
    snapOpticsToTarget();
    if (state.hasPainted) canvas.requestPaint?.();
  }).observe(viewportEl);

  initBackend();

  // ---------------- Live Checks (Tap-Gated, Isolated Fixtures) ----------------

  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  async function settleGfx(baseActive) {
    if (!window.__gfx?.active) return;
    const deadline = performance.now() + 800;
    while (window.__gfx.active() > baseActive && performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  function readCssPx(gl, cv, cssX, cssY) {
    const sx = cv.width / (cv.clientWidth || 1);
    const sy = cv.height / (cv.clientHeight || 1);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
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

  const tests = [
    {
      name: 'ElementGL + texElementSubImage2D() runs the anamorphic pipeline with gl.getError() === 0',
      expect: 'pass',
      why: 'Uploads an isolated dark matte fixture containing a bright white specular badge via texElementSubImage2D() with UNPACK_PREMULTIPLY_ALPHA_WEBGL = true and checks gl.getError() === 0 plus pixel contrast.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 260;
        const H = 130;
        const cv = makeFixtureCanvas(
          W,
          H,
          '<div id="fx-card" drawable style="position:absolute;left:0;top:0;width:260px;height:130px;background:#070a10;display:flex;align-items:center;justify-content:center;"><span style="display:block;width:36px;height:22px;background:#ffffff;border-radius:6px;"></span></div>'
        );
        const card = cv.querySelector('#fx-card');
        let g = null;
        let pipe = null;
        let hasPaint = false;
        let tex = null;
        try {
          g = new ElementGL(cv, { fragment: PASSTHROUGH_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          pipe = new AnamorphicPipeline(g.gl);
          cv.addEventListener('paint', () => {
            hasPaint = true;
            if (!g.begin([0.014, 0.018, 0.030, 1])) return;
            tex = g.upload(card);
          }, { once: true });
          await nextPaint(cv);
          if (!hasPaint || !tex) throw new Error('paint event did not upload fixture');

          pipe.render({
            canvas: cv,
            domTex: tex.tex,
            domW: tex.w,
            domH: tex.h,
            gateRect: { x: 0, y: 0, w: W, h: H },
            cw: W,
            ch: H,
            threshold: 0.50,
            intensity: 1.4,
            barrel: 1.0,
            aniso: 1.48,
            streakScale: 1.0,
            anamorphicMix: 1.0,
            breathe: 0,
            pulse: 1.0,
            igniteBoost: 1.0,
          });
          const glErr = g.gl.getError();
          const centerPx = readCssPx(g.gl, cv, 130, 65);
          const mattePx = readCssPx(g.gl, cv, 130, 18);
          return need(
            glErr === g.gl.NO_ERROR && centerPx[0] > 180 && centerPx[2] > 190 && mattePx[0] < 40 && mattePx[2] < 60,
            `gl.getError()=${glErr}; tex=${tex.w}×${tex.h}; center rgb(${centerPx[0]},${centerPx[1]},${centerPx[2]}); dark top rgb(${mattePx[0]},${mattePx[1]},${mattePx[2]}).`
          );
        } finally {
          pipe?.dispose();
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Horizontal cyan-cobalt streak spills sideways outside bright DOM badge while matte stays dark',
      expect: 'pass',
      why: 'Measures readPixels() 78 px left and right of a 24×24 bright badge over dark matte DOM, comparing horizontal blue-cyan spill against the vertical unlit baseline and zero-intensity control.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 280;
        const H = 120;
        const cv = makeFixtureCanvas(
          W,
          H,
          '<div id="fx-streak" drawable style="position:absolute;left:0;top:0;width:280px;height:120px;background:#06090f;"><div style="position:absolute;left:128px;top:48px;width:24px;height:24px;background:#ffffff;border-radius:4px;"></div></div>'
        );
        const card = cv.querySelector('#fx-streak');
        let g = null;
        let pipe = null;
        let tex = null;
        try {
          g = new ElementGL(cv, { fragment: PASSTHROUGH_FRAG, attributes: { alpha: false, preserveDrawingBuffer: true } });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          pipe = new AnamorphicPipeline(g.gl);
          cv.addEventListener('paint', () => {
            g.begin([0.01, 0.015, 0.025, 1]);
            tex = g.upload(card);
          }, { once: true });
          await nextPaint(cv);
          if (!tex) throw new Error('fixture texture failed to upload');

          const drawWith = (intensity) => {
            g.begin([0.01, 0.015, 0.025, 1]);
            pipe.render({
              canvas: cv,
              domTex: tex.tex,
              domW: tex.w,
              domH: tex.h,
              gateRect: { x: 0, y: 0, w: W, h: H },
              cw: W,
              ch: H,
              threshold: 0.48,
              intensity,
              barrel: 0.8,
              aniso: 1.48,
              streakScale: 1.0,
              anamorphicMix: 1.0,
              breathe: 0,
              pulse: 1.0,
              igniteBoost: 1.0,
            });
          };

          drawWith(1.65);
          const leftSpill = readCssPx(g.gl, cv, 62, 60);
          const rightSpill = readCssPx(g.gl, cv, 218, 60);
          const topBaseline = readCssPx(g.gl, cv, 140, 14);
          const ovalHalo = readCssPx(g.gl, cv, 140, 38);

          drawWith(0.0);
          const offSpill = readCssPx(g.gl, cv, 62, 60);

          const horizLit = leftSpill[2] > topBaseline[2] + 18 && rightSpill[2] > topBaseline[2] + 18;
          const cyanBias = leftSpill[2] > leftSpill[0] + 12 && rightSpill[2] > rightSpill[0] + 12;
          const bokehGlow = ovalHalo[2] > topBaseline[2] + 10;
          const offDark = offSpill[2] < 24;

          return need(
            horizLit && cyanBias && bokehGlow && offDark,
            `left(-78px) rgb(${leftSpill[0]},${leftSpill[1]},${leftSpill[2]}), right(+78px) rgb(${rightSpill[0]},${rightSpill[1]},${rightSpill[2]}), ovalHalo rgb(${ovalHalo[0]},${ovalHalo[1]},${ovalHalo[2]}), topDark rgb(${topBaseline[0]},${topBaseline[1]},${topBaseline[2]}), intensity=0 rgb(${offSpill[0]},${offSpill[1]},${offSpill[2]}).`
          );
        } finally {
          pipe?.dispose();
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'Squeeze/desqueeze switches projected aspect and keeps updateElementGeometry() hit testing aligned',
      expect: 'pass',
      why: 'Applies computeGateRect() and geometryUnit() + updateElementGeometry() for both 2.39:1 Desqueeze and 1.33x Squeeze (raw), checking elementsFromPoint() hits the live button in both modes.',
      run: async () => {
        if (!hicSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
          throw new Error('updateElementGeometry() is not available.');
        }
        const baseActive = window.__gfx?.active() ?? 0;
        const W = 320;
        const H = 180;
        const PW = 220;
        const PH = 110;
        const cv = makeFixtureCanvas(
          W,
          H,
          `<div id="fx-panel" drawable style="position:absolute;left:0;top:0;width:${PW}px;height:${PH}px;background:#090d16;">` +
          '<button type="button" id="fx-btn" style="position:absolute;left:134px;top:35px;width:70px;height:40px;background:#5ce6ff;color:#04131c;border:0;border-radius:6px;font:700 12px system-ui;">Ignite</button></div>'
        );
        const panel = cv.querySelector('#fx-panel');
        const btn = cv.querySelector('#fx-btn');
        let g = null;
        let hasPaint = false;
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: PASSTHROUGH_FRAG });
            g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            cv.addEventListener('paint', () => {
              hasPaint = true;
              g.begin([0, 0, 0, 1]);
              g.upload(panel);
            }, { once: true });
          } else {
            cv.width = W;
            cv.height = H;
            cv.getContext('2d');
          }
          await nextPaint(cv);
          if (g && !hasPaint) throw new Error('fixture paint event did not fire');

          const unitCache = { key: '', unit: 1 };
          const lastGeoKeyRef = { value: '' };
          const modeType = g ? 'webgl' : '2d';

          const desqRect = computeGateRect(W, H, PW, PH, 'desqueeze');
          syncPanelGeometry({ canvasEl: cv, panelEl: panel, gateRect: desqRect, pw: PW, mode: modeType, unitCache, lastGeoKeyRef, force: true });
          if (g) {
            g.begin([0, 0, 0, 1]);
            g.quad(panel, ElementGL.rect(cv, desqRect.x, desqRect.y, desqRect.w, desqRect.h));
          } else {
            const c2 = cv.getContext('2d');
            c2.reset();
            c2.drawElementImage(panel, desqRect.x, desqRect.y, desqRect.w, desqRect.h);
          }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const cvRect = cv.getBoundingClientRect();
          const desqBtnCenterX = desqRect.x + (134 + 35) * desqRect.scaleX;
          const desqBtnCenterY = desqRect.y + (35 + 20) * desqRect.scaleY;
          const hitDesq = document.elementsFromPoint(cvRect.left + desqBtnCenterX, cvRect.top + desqBtnCenterY);

          const sqRect = computeGateRect(W, H, PW, PH, 'squeeze');
          syncPanelGeometry({ canvasEl: cv, panelEl: panel, gateRect: sqRect, pw: PW, mode: modeType, unitCache, lastGeoKeyRef, force: true });
          if (g) {
            g.begin([0, 0, 0, 1]);
            g.quad(panel, ElementGL.rect(cv, sqRect.x, sqRect.y, sqRect.w, sqRect.h));
          } else {
            const c2 = cv.getContext('2d');
            c2.reset();
            c2.drawElementImage(panel, sqRect.x, sqRect.y, sqRect.w, sqRect.h);
          }
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

          const sqBtnCenterX = sqRect.x + (134 + 35) * sqRect.scaleX;
          const sqBtnCenterY = sqRect.y + (35 + 20) * sqRect.scaleY;
          const hitSq = document.elementsFromPoint(cvRect.left + sqBtnCenterX, cvRect.top + sqBtnCenterY);

          return need(
            desqRect.w > sqRect.w + 70 && hitDesq.includes(btn) && hitSq.includes(btn),
            `desqueeze=${desqRect.w}×${desqRect.h} hit=${hitDesq.includes(btn)} at (${desqBtnCenterX.toFixed(1)}, ${desqBtnCenterY.toFixed(1)}); squeeze=${sqRect.w}×${sqRect.h} hit=${hitSq.includes(btn)} at (${sqBtnCenterX.toFixed(1)}, ${sqBtnCenterY.toFixed(1)}).`
          );
        } finally {
          g?.dispose();
          cv.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    {
      name: 'webglcontextlost moves the cinema panel to plain HTML and webglcontextrestored recovers ElementGL',
      expect: 'pass',
      why: 'Dispatches synthetic cancelable webglcontextlost and webglcontextrestored events on an ElementGL fixture without calling loseContext(), verifying plain-HTML rescue and WebGL pipeline restoration.',
      run: async () => {
        if (!hicSupported || !glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available.');
        const baseActive = window.__gfx?.active() ?? 0;
        const wrap = document.createElement('div');
        const plain = document.createElement('div');
        plain.hidden = true;
        const W = 220;
        const H = 120;
        const cv = document.createElement('canvas');
        cv.setAttribute('content', 'drawable');
        cv.setAttribute('layoutsubtree', '');
        cv.style.cssText = `display:block;width:${W}px;height:${H}px;`;
        const panel = document.createElement('div');
        panel.setAttribute('drawable', '');
        panel.style.cssText = 'position:absolute;left:0;top:0;width:160px;height:60px;background:#0c1424;color:#fff;';
        panel.textContent = '2.39:1';
        cv.append(panel);
        wrap.append(cv, plain);
        testStage().append(wrap);

        let g = null;
        let pipe = null;
        let lostFired = false;
        let restoredFired = false;
        try {
          g = new ElementGL(cv, {
            fragment: PASSTHROUGH_FRAG,
            onLost: () => {
              lostFired = true;
              pipe = null;
              plain.hidden = false;
              plain.append(panel);
            },
            onRestored: () => {
              restoredFired = true;
              g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
              pipe = new AnamorphicPipeline(g.gl);
              plain.hidden = true;
              cv.append(panel);
            },
          });
          g.gl.pixelStorei(g.gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          pipe = new AnamorphicPipeline(g.gl);
          await nextPaint(cv);
          g.begin([0, 0, 0, 1]);
          g.upload(panel);

          const lostEv = new Event('webglcontextlost', { cancelable: true });
          cv.dispatchEvent(lostEv);
          const inPlain = lostEv.defaultPrevented && g.lost && lostFired && plain.contains(panel);

          cv.dispatchEvent(new Event('webglcontextrestored'));
          await nextPaint(cv);
          g.begin([0, 0, 0, 1]);
          const texAfter = g.upload(panel);
          pipe.render({
            canvas: cv,
            domTex: texAfter.tex,
            domW: texAfter.w,
            domH: texAfter.h,
            gateRect: { x: 20, y: 20, w: 180, h: 80 },
            cw: W,
            ch: H,
            threshold: 0.54,
            intensity: 1.2,
            barrel: 1.0,
            aniso: 1.48,
            streakScale: 1.0,
            anamorphicMix: 1.0,
            breathe: 0,
            pulse: 1.0,
            igniteBoost: 1.0,
          });
          const err = g.gl.getError();

          return need(
            inPlain && restoredFired && !g.lost && cv.contains(panel) && texAfter?.w > 0 && err === g.gl.NO_ERROR,
            `preventDefault=${lostEv.defaultPrevented}, inPlain=${inPlain}, restored=${restoredFired}, err=${err}.`
          );
        } finally {
          pipe?.dispose();
          g?.dispose();
          wrap.remove();
          window.__gfx?.retire?.(cv);
          await settleGfx(baseActive);
        }
      },
    },
    stillDrawn(() => [
      {
        name: 'anamorphic flare stage',
        ink: async () => {
          if (state.mode === 'plain') return null;
          if (state.mode === 'webgl') {
            if (!stage || stage.lost || !panelTex) return 0;
            const mp = (canvas.width * canvas.height) / 1e6;
            if (mp > 4) throw new Error(`canvas backing store ${mp.toFixed(2)} MP exceeds 4 MP limit`);
            return state.paints > 0 ? 1 : 0;
          }
          return canvas.width > 0 && canvas.height > 0 ? 1 : 0;
        },
        rescue: () => enterPlainFallback('Canvas drew blank after live checks'),
      },
    ]),
  ];

  runTests(document.getElementById('tests'), tests);
}

if (typeof document !== 'undefined' && document.getElementById('flare-canvas')) {
  mountAnamorphicFlare();
}
