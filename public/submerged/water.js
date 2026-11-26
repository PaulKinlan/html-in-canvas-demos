import { banner, supported, runTests, testStage, nextPaint } from '/shared/support.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// #region pde
// 2D damped shallow-water wave equation on a compact typed-array grid.
// Aspect-corrected Laplacian weights keep circular ripples circular in CSS
// pixels while guaranteeing CFL stability (sx + sy === 1, c2 < 0.5).
export class WaterField {
  constructor(cols = 128, rows = 128) {
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    this.curr = new Float32Array(n);
    this.prev = new Float32Array(n);
    this.next = new Float32Array(n);
    this.pixels = new Uint8Array(n * 4);
    this.c2 = 0.36;
    this.damping = 0.986;
    this.restore = 0.9965;
    this.sx = 0.5;
    this.sy = 0.5;
    this.pack();
  }

  setAspect(cssW, cssH) {
    const ar = clamp((cssW || 1) / Math.max(cssH || 1, 1), 0.55, 1.85);
    const ar2 = ar * ar;
    this.sx = 1 / (1 + ar2);
    this.sy = ar2 / (1 + ar2);
  }

  clear() {
    this.curr.fill(0);
    this.prev.fill(0);
    this.next.fill(0);
    this.pack();
  }

  splash(u, v, radiusPx = 22, strength = 0.72, cssW = 400, cssH = 400) {
    const { cols, rows, curr, prev } = this;
    const cx = u * cssW;
    const cy = v * cssH;
    const r = Math.max(6, radiusPx);
    const r2 = r * r;
    const x0 = Math.max(1, Math.floor(((cx - r) / cssW) * (cols - 1)));
    const x1 = Math.min(cols - 2, Math.ceil(((cx + r) / cssW) * (cols - 1)));
    const y0 = Math.max(1, Math.floor(((cy - r) / cssH) * (rows - 1)));
    const y1 = Math.min(rows - 2, Math.ceil(((cy + r) / cssH) * (rows - 1)));
    for (let y = y0; y <= y1; y++) {
      const py = (y / (rows - 1)) * cssH - cy;
      const row = y * cols;
      for (let x = x0; x <= x1; x++) {
        const px = (x / (cols - 1)) * cssW - cx;
        const d2 = px * px + py * py;
        if (d2 >= r2) continue;
        const k = 0.5 * (1 + Math.cos(Math.PI * Math.sqrt(d2) / r));
        const delta = strength * k;
        const i = row + x;
        curr[i] = clamp(curr[i] - delta, -1.8, 1.8);
        prev[i] = clamp(prev[i] - delta * 0.42, -1.8, 1.8);
      }
    }
  }

  step(substeps = 1) {
    const { cols, rows, c2, damping, restore, sx, sy } = this;
    for (let s = 0; s < substeps; s++) {
      const curr = this.curr;
      const prev = this.prev;
      const next = this.next;
      for (let y = 1; y < rows - 1; y++) {
        const row = y * cols;
        for (let x = 1; x < cols - 1; x++) {
          const i = row + x;
          const h = curr[i];
          const lap =
            sx * (curr[i - 1] + curr[i + 1] - 2 * h) +
            sy * (curr[i - cols] + curr[i + cols] - 2 * h);
          const nh = (h + (h - prev[i]) * damping + c2 * lap) * restore;
          next[i] = nh > 1.8 ? 1.8 : nh < -1.8 ? -1.8 : nh;
        }
      }
      // Soft partial reflection along tank walls.
      for (let x = 0; x < cols; x++) {
        next[x] = next[cols + x] * 0.62;
        next[(rows - 1) * cols + x] = next[(rows - 2) * cols + x] * 0.62;
      }
      for (let y = 0; y < rows; y++) {
        const row = y * cols;
        next[row] = next[row + 1] * 0.62;
        next[row + cols - 1] = next[row + cols - 2] * 0.62;
      }
      this.prev = curr;
      this.curr = next;
      this.next = prev;
    }
  }

  energy() {
    const { curr, prev } = this;
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < curr.length; i++) {
      const h = curr[i];
      const v = h - prev[i];
      sum += v * v + 0.5 * h * h;
      const a = Math.abs(h);
      if (a > peak) peak = a;
    }
    return { mean: sum / curr.length, peak };
  }

  // Pack height (R), dh/dx (G), dh/dy (B) and curvature (A) into RGBA8 so
  // every WebGL 2 GPU gets hardware bilinear filtering without float FBOs.
  pack() {
    const { cols, rows, curr, pixels } = this;
    const gradGain = 1.65;
    for (let y = 0; y < rows; y++) {
      const yUp = y > 0 ? y - 1 : 0;
      const yDn = y < rows - 1 ? y + 1 : rows - 1;
      const row = y * cols;
      const rowUp = yUp * cols;
      const rowDn = yDn * cols;
      for (let x = 0; x < cols; x++) {
        const xL = x > 0 ? x - 1 : 0;
        const xR = x < cols - 1 ? x + 1 : cols - 1;
        const i = row + x;
        const h = curr[i];
        const gx = (curr[row + xR] - curr[row + xL]) * 0.5;
        const gy = (curr[rowDn + x] - curr[rowUp + x]) * 0.5;
        const lap = (curr[row + xL] + curr[row + xR] + curr[rowUp + x] + curr[rowDn + x] - 4 * h);
        const o = i * 4;
        pixels[o] = Math.round(clamp(0.5 + h * 0.45, 0, 1) * 255);
        pixels[o + 1] = Math.round(clamp(0.5 + gx * gradGain, 0, 1) * 255);
        pixels[o + 2] = Math.round(clamp(0.5 + gy * gradGain, 0, 1) * 255);
        pixels[o + 3] = Math.round(clamp(0.5 - lap * 1.1, 0, 1) * 255);
      }
    }
    return pixels;
  }

  // Evaluate Snell refraction hit-test shift in CSS px directly from the CPU
  // heightfield (no GPU readback). A DOM pixel at (u + off) is drawn at u, so
  // its visual shift on screen is (-off.x * cssW, -off.y * cssH).
  sampleSnellOffset(u, v, waterLevel, depth, cssW, cssH) {
    const { cols, rows, curr } = this;
    const baseShore = 1.06 + (-0.06 - 1.06) * waterLevel;
    const fx = clamp(u, 0, 1) * (cols - 1);
    const fy = clamp(v, 0, 1) * (rows - 1);
    const ix = clamp(Math.round(fx), 1, cols - 2);
    const iy = clamp(Math.round(fy), 1, rows - 2);
    const shoreIy = clamp(Math.round(clamp(baseShore, 0.01, 0.99) * (rows - 1)), 0, rows - 1);
    const shoreWave = curr[shoreIy * cols + ix];
    const shoreY = baseShore - shoreWave * 0.028;
    const distBelow = v - shoreY;
    if (distBelow <= 0 || depth <= 0.001) {
      return { dx: 0, dy: 0, submerged: false };
    }
    const row = iy * cols;
    const gx = (curr[row + ix + 1] - curr[row + ix - 1]) * 0.5;
    const gy = (curr[(iy + 1) * cols + ix] - curr[(iy - 1) * cols + ix]) * 0.5;
    const slope = 2.6;
    let nx = -gx * slope;
    let ny = -gy * slope;
    let nz = 1.0;
    const invLen = 1 / Math.hypot(nx, ny, nz);
    nx *= invLen;
    ny *= invLen;
    nz *= invLen;
    // Snell's law: I = (0, 0, -1), eta = 1 / 1.333 = 0.75.
    const eta = 0.75;
    const ndoti = -nz;
    const k = 1 - eta * eta * (1 - ndoti * ndoti);
    if (k <= 0) return { dx: 0, dy: 0, submerged: true };
    const c = eta * ndoti + Math.sqrt(k);
    const tx = -c * nx;
    const ty = -c * ny;
    const tz = -eta - c * nz;
    const depthRamp = clamp(distBelow / 0.12, 0, 1);
    const smoothRamp = depthRamp * depthRamp * (3 - 2 * depthRamp);
    const localDepth = depth * (0.28 + 0.72 * smoothRamp);
    const scale = (localDepth * 0.095) / Math.max(-tz, 0.35);
    const dx = clamp(-tx * scale * cssW, -28, 28);
    const dy = clamp(-ty * scale * cssH, -28, 28);
    return { dx, dy, submerged: true };
  }
}
// #endregion pde

// #region shader
export const WATER_FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D uTex;
uniform sampler2D uWaterTex;
uniform vec2 uSize;
uniform vec2 uWaterRes;
uniform float uTime;
uniform float uWaterLevel;
uniform float uDepth;
uniform float uAmbient;

in vec2 vUv;
out vec4 outColor;

vec2 sampleGrad(vec2 uv) {
  vec4 w = texture(uWaterTex, clamp(uv, vec2(0.004), vec2(0.996)));
  vec2 g = (w.gb - 0.5) * 2.0;
  // Subtle travelling capillary ripples keep the surface alive between splashes.
  float t = uTime;
  float a = uAmbient * 0.042;
  vec2 p = uv * vec2(18.0, 14.0);
  g.x += a * (cos(p.x * 1.15 + p.y * 0.65 + t * 1.7) * 0.6 + cos(p.x * 2.3 - p.y * 1.4 - t * 2.2) * 0.4);
  g.y += a * (sin(p.x * 0.85 - p.y * 1.25 + t * 1.5) * 0.6 + cos(p.x * 1.6 + p.y * 2.1 - t * 2.0) * 0.4);
  return g;
}

vec3 waterNormal(vec2 uv) {
  vec2 g = sampleGrad(uv);
  return normalize(vec3(-g.x * 2.15, -g.y * 2.15, 1.0));
}

vec2 snellOffset(vec2 uv, float localDepth) {
  vec3 N = waterNormal(uv);
  vec3 T = refract(vec3(0.0, 0.0, -1.0), N, 0.75);
  if (length(T) < 1e-4) T = vec3(0.0, 0.0, -1.0);
  return (T.xy / max(-T.z, 0.35)) * localDepth * 0.095;
}

void main() {
  vec4 dryTex = texture(uTex, vUv);
  vec3 dryRgb = dryTex.rgb;

  float baseShore = mix(1.06, -0.06, uWaterLevel);
  float shoreWave = (texture(uWaterTex, vec2(clamp(vUv.x, 0.004, 0.996), clamp(baseShore, 0.01, 0.99))).r - 0.5) * 2.0;
  float shoreRipple = sin(vUv.x * 20.0 + uTime * 1.6) * 0.0024 * uAmbient;
  float shoreY = baseShore - shoreWave * 0.028 - shoreRipple;
  float distBelow = vUv.y - shoreY;

  // Faint capillary wet line just above the waterline.
  float dryRim = exp(-max(-distBelow, 0.0) * 180.0) * step(distBelow, 0.0) * step(0.01, uWaterLevel) * step(uWaterLevel, 0.99);
  vec3 aboveRgb = dryRgb * (1.0 - dryRim * 0.09);

  float subMask = smoothstep(-0.003, 0.004, distBelow);
  if (subMask <= 0.001) {
    outColor = vec4(aboveRgb, 1.0);
    return;
  }

  float depthRamp = smoothstep(0.0, 0.12, max(distBelow, 0.0));
  float localDepth = uDepth * (0.28 + 0.72 * depthRamp);

  // Concave shoreline meniscus pulls light slightly upward right at the waterline.
  float meniscusBand = exp(-abs(distBelow) * 150.0) * step(0.01, uWaterLevel) * step(uWaterLevel, 0.99);
  vec2 meniscusPull = vec2(0.0, -meniscusBand * 0.014 * clamp(uDepth, 0.3, 1.8));

  vec2 offG = snellOffset(vUv, localDepth) + meniscusPull;
  vec2 offR = offG * 0.92;
  vec2 offB = offG * 1.08;

  vec2 uvR = clamp(vUv + offR, vec2(0.002), vec2(0.998));
  vec2 uvG = clamp(vUv + offG, vec2(0.002), vec2(0.998));
  vec2 uvB = clamp(vUv + offB, vec2(0.002), vec2(0.998));
  vec3 refracted = vec3(
    texture(uTex, uvR).r,
    texture(uTex, uvG).g,
    texture(uTex, uvB).b
  );

  // Jacobian-determinant optical caustics: light intensity scales with 1 / det(J)
  // where P(u) = u + snellOffset(u) maps surface coordinates to the submerged DOM.
  vec2 eps = vec2(1.45) / max(uWaterRes, vec2(32.0));
  vec2 offXp = snellOffset(vUv + vec2(eps.x, 0.0), localDepth);
  vec2 offXm = snellOffset(vUv - vec2(eps.x, 0.0), localDepth);
  vec2 offYp = snellOffset(vUv + vec2(0.0, eps.y), localDepth);
  vec2 offYm = snellOffset(vUv - vec2(0.0, eps.y), localDepth);
  vec2 dPdu = vec2(1.0, 0.0) + (offXp - offXm) / (2.0 * eps.x);
  vec2 dPdv = vec2(0.0, 1.0) + (offYp - offYm) / (2.0 * eps.y);
  float detJ = dPdu.x * dPdv.y - dPdu.y * dPdv.x;

  float focus = clamp(1.0 / max(detJ, 0.24), 0.55, 3.2);
  float caustic = pow(max(focus - 1.0, 0.0), 1.2) * 0.44 * clamp(uDepth, 0.2, 1.7) * (0.35 + 0.65 * depthRamp);
  float troughShade = clamp((1.0 - focus) * 0.14, 0.0, 0.10);

  // Clear-water Beer-Lambert absorption keeps submerged text readable.
  vec3 absorb = exp(-vec3(0.14, 0.045, 0.025) * localDepth);
  vec3 wetRgb = refracted * absorb * (1.0 - troughShade);
  wetRgb += vec3(0.84, 0.97, 1.0) * caustic + vec3(0.16, 0.11, 0.04) * caustic * caustic;

  // Fresnel sky reflection and directional specular glint on crests.
  vec3 N = normalize(waterNormal(vUv) + vec3(0.0, -meniscusBand * 0.65, 0.0));
  vec3 V = vec3(0.0, 0.0, 1.0);
  float fresnel = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  vec3 skyCol = mix(vec3(0.54, 0.80, 0.94), vec3(0.92, 0.98, 1.0), clamp(0.5 - N.y * 1.5, 0.0, 1.0));
  wetRgb = mix(wetRgb, skyCol, clamp(fresnel * 0.38, 0.0, 0.34));

  vec3 L = normalize(vec3(-0.32, -0.62, 0.95));
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 56.0) * 0.58;
  wetRgb += vec3(0.94, 0.99, 1.0) * spec;

  vec3 finalRgb = mix(aboveRgb, wetRgb, subMask);

  // Bright meniscus highlight and thin underside shadow along the waterline.
  float meniscusGlint = exp(-pow((distBelow - 0.002) * 260.0, 2.0)) * step(0.01, uWaterLevel) * step(uWaterLevel, 0.99);
  float meniscusShadow = exp(-pow((distBelow - 0.010) * 160.0, 2.0)) * step(0.01, uWaterLevel) * step(uWaterLevel, 0.99);
  finalRgb = finalRgb * (1.0 - meniscusShadow * 0.16) + vec3(0.88, 0.98, 1.0) * meniscusGlint * 0.62;

  outColor = vec4(clamp(finalRgb, 0.0, 1.0), 1.0);
}`;
// #endregion shader

function createWaterTexture(gl, water) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, water.cols, water.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, water.pixels);
  return tex;
}

function uploadWaterTexture(gl, tex, water) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, water.cols, water.rows, gl.RGBA, gl.UNSIGNED_BYTE, water.pixels);
}

export function mountSubmerged() {
  banner();

  const stageEl = document.getElementById('sub-stage');
  const canvas = document.getElementById('sub-canvas');
  const cardEl = document.getElementById('sub-card');
  const statusEl = document.getElementById('sub-status');
  const noticeEl = document.getElementById('sub-notice');

  // External water controls
  const levelInput = document.getElementById('sub-level');
  const levelOut = document.getElementById('sub-level-out');
  const depthInput = document.getElementById('sub-depth');
  const depthOut = document.getElementById('sub-depth-out');
  const rainInput = document.getElementById('sub-rain');
  const splashBtn = document.getElementById('sub-splash');
  const refractHitInput = document.getElementById('sub-refract-hit');

  // Submerged live HTML form controls
  const noteInput = document.getElementById('sub-note');
  const valveInput = document.getElementById('sub-valve');
  const valveOut = document.getElementById('sub-valve-out');
  const gainInput = document.getElementById('sub-gain');
  const gainOut = document.getElementById('sub-gain-out');
  const interlockInput = document.getElementById('sub-interlock');
  const alarmInput = document.getElementById('sub-alarm');
  const pingBtn = document.getElementById('sub-ping');
  const resetBtn = document.getElementById('sub-reset');
  const tideReadout = document.getElementById('sub-tide-badge');
  const cardOut = document.getElementById('sub-card-out');

  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reducedMotion) rainInput.checked = false;

  const water = new WaterField(128, 128);

  const state = {
    waterLevel: Number(levelInput.value) / 100,
    depth: Number(depthInput.value),
    raindrops: rainInput.checked,
    refractHit: refractHitInput.checked,
    pointerU: 0.5,
    pointerV: 0.65,
    pointerInside: false,
    hitDx: 0,
    hitDy: 0,
    paints: 0,
    uploads: 0,
    logs: 0,
    pings: 0,
    lastEvent: 'Ready',
  };

  let route = 'plain';
  let stage = null;
  let waterTex = null;
  let ctx2d = null;
  let cardDirty = true;
  let onScreen = true;
  let rafId = 0;
  let lastFrameAt = 0;
  let accum = 0;
  let nextDropAt = 0;
  let lastStatusAt = 0;

  const say = (text) => {
    noticeEl.hidden = false;
    noticeEl.textContent = text;
  };

  function updateCardSummary(action) {
    const valve = Number(valveInput.value);
    const gain = Number(gainInput.value);
    const flags = [
      interlockInput.checked ? 'interlock ON' : 'interlock OFF',
      alarmInput.checked ? 'alarm ON' : 'alarm OFF',
    ].join(', ');
    const note = noteInput.value.trim() || 'No note';
    cardOut.textContent = `${action} | Valve ${valve}% | Gain ${gain} dB | ${flags} | "${note}"`;
    tideReadout.textContent = `+${(state.waterLevel * 4.2).toFixed(2)} m`;
    cardDirty = true;
  }

  function updateStatus(force = false) {
    const now = performance.now();
    if (!force && now - lastStatusAt < 200) return;
    lastStatusAt = now;
    const label = route === 'webgl' ? 'WebGL 2 (ElementGL)' : route === '2d' ? '2D fallback' : 'Plain HTML fallback';
    const e = water.energy();
    const hitText = state.refractHit
      ? `offset (${state.hitDx.toFixed(1)}, ${state.hitDy.toFixed(1)}) px`
      : 'standard (0, 0) px';
    statusEl.textContent =
      `Route: ${label} · level ${Math.round(state.waterLevel * 100)}% · depth ${state.depth.toFixed(2)} · ` +
      `wave E=${e.mean.toFixed(4)} · hit-test ${hitText} · ${state.paints} paints, ${state.uploads} DOM uploads`;
  }

  function splashAtElement(el, radius = 26, strength = 0.78) {
    const hostRect = stageEl.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (hostRect.width <= 0 || hostRect.height <= 0) return;
    const u = clamp((elRect.left + elRect.width * 0.5 - hostRect.left) / hostRect.width, 0.05, 0.95);
    const v = clamp((elRect.top + elRect.height * 0.5 - hostRect.top) / hostRect.height, 0.05, 0.95);
    state.pointerU = u;
    state.pointerV = v;
    water.splash(u, v, radius, strength, hostRect.width, hostRect.height);
    if (route === 'webgl' || route === '2d') canvas.requestPaint?.();
  }

  function enterPlainFallback(reason) {
    route = 'plain';
    stageEl.classList.add('plain');
    stageEl.append(cardEl);
    say(reason);
    updateStatus(true);
  }

  if (supported && glSupported) {
    try {
      stage = new ElementGL(canvas, {
        fragment: WATER_FRAGMENT,
        onLost: () => {
          waterTex = null;
          say('The WebGL context was lost. It will draw again when the browser restores it.');
        },
        onRestored: () => {
          noticeEl.hidden = true;
          waterTex = createWaterTexture(stage.gl, water);
          cardDirty = true;
          canvas.requestPaint?.();
        },
      });
      waterTex = createWaterTexture(stage.gl, water);
      route = 'webgl';
    } catch (err) {
      say(`WebGL could not start (${err.message}).`);
    }
  }

  if (route === 'plain' && supported) {
    try {
      ctx2d = canvas.getContext('2d');
      if (ctx2d) {
        route = '2d';
        say('WebGL texElementSubImage2D() is not available here, so the demo is using the 2D drawElementImage() fallback without wave refraction.');
      }
    } catch {}
  }

  if (route === 'plain') {
    enterPlainFallback('HTML-in-canvas is not available here, so the form is shown as plain HTML.');
  }

  // #region paint
  let lastGeoKey = '';
  function syncGeometry(cw, ch) {
    let dx = 0;
    let dy = 0;
    if (state.refractHit && state.pointerInside) {
      const off = water.sampleSnellOffset(
        state.pointerU,
        state.pointerV,
        state.waterLevel,
        state.depth,
        cw,
        ch
      );
      dx = off.dx;
      dy = off.dy;
    }
    state.hitDx = dx;
    state.hitDy = dy;
    const unit = geometryUnit(canvas, cardEl, cardEl.offsetWidth || cw);
    const rx = Math.round(dx);
    const ry = Math.round(dy);
    const key = `${rx},${ry},${cardEl.offsetWidth},${cardEl.offsetHeight},${unit.toFixed(3)}`;
    if (key === lastGeoKey) return;
    lastGeoKey = key;
    canvas.updateElementGeometry(cardEl, {
      canvasTransform: new DOMMatrix().scale(unit).translate(rx, ry),
    });
    // Toggle an attribute so Chromium clears its hit-test cache after a move.
    cardEl.dataset.hitTick = cardEl.dataset.hitTick === '1' ? '0' : '1';
  }

  canvas.addEventListener('paint', (e) => {
    if (route === 'plain') return;
    const cw = canvas.clientWidth || 1;
    const ch = canvas.clientHeight || 1;
    water.setAspect(cw, ch);
    state.paints++;

    if (route === 'webgl' && stage && !stage.lost) {
      const changed = new Set(e.changedElements ?? []);
      if (cardDirty || changed.has(cardEl) || !stage.has(cardEl)) {
        stage.upload(cardEl);
        cardDirty = false;
        state.uploads++;
      }
      if (!waterTex) waterTex = createWaterTexture(stage.gl, water);
      water.pack();
      uploadWaterTexture(stage.gl, waterTex, water);

      if (!stage.begin([0.07, 0.14, 0.20, 1])) return;
      stage.quad(cardEl, ElementGL.rect(canvas, 0, 0, cw, ch), (gl, u) => {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, waterTex);
        gl.uniform1i(u('uWaterTex'), 1);
        gl.uniform2f(u('uWaterRes'), water.cols, water.rows);
        gl.uniform1f(u('uWaterLevel'), state.waterLevel);
        gl.uniform1f(u('uDepth'), state.depth);
        gl.uniform1f(u('uAmbient'), reducedMotion ? 0.15 : 1.0);
      });
      syncGeometry(cw, ch);
      updateStatus();
      return;
    }

    if (route === '2d' && ctx2d) {
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
      ctx2d.drawElementImage(cardEl, 0, 0, cardEl.offsetWidth || cw, cardEl.offsetHeight || ch);
      if (state.waterLevel > 0.005) {
        const yLine = ch * (1 - state.waterLevel);
        ctx2d.fillStyle = 'rgba(24, 124, 168, 0.24)';
        ctx2d.fillRect(0, yLine, cw, ch - yLine);
        ctx2d.fillStyle = 'rgba(220, 248, 255, 0.85)';
        ctx2d.fillRect(0, yLine - 1, cw, 2);
      }
      syncGeometry(cw, ch);
      updateStatus();
    }
  });
  // #endregion paint

  // Fixed-timestep simulation loop, paused automatically offscreen or hidden.
  function stopLoop() {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastFrameAt = 0;
  }

  function startLoop() {
    if (rafId || !onScreen || document.hidden || route === 'plain') return;
    lastFrameAt = performance.now();
    if (!nextDropAt) nextDropAt = lastFrameAt + 900;
    rafId = requestAnimationFrame(tick);
  }

  function tick(now) {
    rafId = 0;
    if (!onScreen || document.hidden || route === 'plain') return;
    const dt = Math.min((now - lastFrameAt) / 1000, 0.05);
    lastFrameAt = now;
    accum += dt;
    const stepDt = 1 / 60;
    let steps = 0;
    while (accum >= stepDt && steps < 3) {
      water.step(1);
      accum -= stepDt;
      steps++;
    }
    if (state.raindrops && !reducedMotion && state.waterLevel > 0.08 && now >= nextDropAt) {
      const cw = canvas.clientWidth || 400;
      const ch = canvas.clientHeight || 460;
      const shoreV = clamp(1 - state.waterLevel + 0.05, 0.08, 0.92);
      const u = 0.08 + Math.random() * 0.84;
      const v = shoreV + Math.random() * Math.max(0.05, 0.94 - shoreV);
      water.splash(u, v, 14 + Math.random() * 10, 0.42 + Math.random() * 0.24, cw, ch);
      nextDropAt = now + 1050 + Math.random() * 850;
    }
    canvas.requestPaint?.();
    rafId = requestAnimationFrame(tick);
  }

  if (typeof IntersectionObserver !== 'undefined') {
    new IntersectionObserver(
      (entries) => {
        onScreen = entries.some((entry) => entry.isIntersecting);
        if (onScreen) startLoop();
        else stopLoop();
      },
      { rootMargin: '80px 0px' }
    ).observe(stageEl);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopLoop();
    else startLoop();
  });

  // Pointer and touch ripples without blocking vertical page scroll or controls.
  let lastWakeAt = 0;
  stageEl.addEventListener('pointerdown', (e) => {
    const r = stageEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const u = clamp((e.clientX - r.left) / r.width, 0, 1);
    const v = clamp((e.clientY - r.top) / r.height, 0, 1);
    state.pointerU = u;
    state.pointerV = v;
    state.pointerInside = true;
    water.splash(u, v, 24, 0.78, r.width, r.height);
    if (route !== 'plain') canvas.requestPaint?.();
  }, { passive: true });

  stageEl.addEventListener('pointermove', (e) => {
    const r = stageEl.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const u = clamp((e.clientX - r.left) / r.width, 0, 1);
    const v = clamp((e.clientY - r.top) / r.height, 0, 1);
    state.pointerU = u;
    state.pointerV = v;
    state.pointerInside = true;
    // Mouse hover leaves a light wake; touch wakes only while pressed so pan-y scroll stays clean.
    if (e.pointerType === 'touch' && e.buttons === 0) return;
    const now = performance.now();
    if (now - lastWakeAt < 28) return;
    lastWakeAt = now;
    water.splash(u, v, 14, e.buttons ? 0.34 : 0.16, r.width, r.height);
  }, { passive: true });

  const forgetTouch = (e) => {
    if (e.pointerType === 'touch') state.pointerInside = false;
  };
  stageEl.addEventListener('pointerup', forgetTouch, { passive: true });
  stageEl.addEventListener('pointercancel', forgetTouch, { passive: true });
  stageEl.addEventListener('pointerleave', () => { state.pointerInside = false; });

  // External water controls.
  levelInput.addEventListener('input', () => {
    const pct = Number(levelInput.value);
    state.waterLevel = pct / 100;
    levelOut.textContent = `${pct}%`;
    tideReadout.textContent = `+${(state.waterLevel * 4.2).toFixed(2)} m`;
    cardDirty = true;
    updateStatus(true);
    if (route !== 'plain') canvas.requestPaint?.();
  });

  depthInput.addEventListener('input', () => {
    state.depth = Number(depthInput.value);
    depthOut.textContent = state.depth.toFixed(2);
    updateStatus(true);
    if (route !== 'plain') canvas.requestPaint?.();
  });

  rainInput.addEventListener('change', () => {
    state.raindrops = rainInput.checked;
    nextDropAt = performance.now() + 300;
  });

  refractHitInput.addEventListener('change', () => {
    state.refractHit = refractHitInput.checked;
    lastGeoKey = '';
    updateStatus(true);
    if (route !== 'plain') canvas.requestPaint?.();
  });

  splashBtn.addEventListener('click', () => {
    const r = stageEl.getBoundingClientRect();
    const shoreV = clamp(1 - state.waterLevel + 0.12, 0.25, 0.85);
    const u = 0.35 + Math.random() * 0.30;
    const v = clamp(shoreV + (Math.random() - 0.5) * 0.18, 0.22, 0.86);
    water.splash(u, v, 36, 1.35, r.width || 400, r.height || 460);
    if (route !== 'plain') canvas.requestPaint?.();
  });

  cardEl.addEventListener('focusin', () => { cardDirty = true; });
  cardEl.addEventListener('focusout', () => { cardDirty = true; });

  // Submerged live HTML form interactions splash straight from each control.
  noteInput.addEventListener('input', () => {
    updateCardSummary('Typing');
    splashAtElement(noteInput, 18, 0.42);
  });

  valveInput.addEventListener('input', () => {
    valveOut.textContent = `${valveInput.value}%`;
    updateCardSummary('Valve adjusted');
    splashAtElement(valveInput, 20, 0.48);
  });

  gainInput.addEventListener('input', () => {
    gainOut.textContent = `${gainInput.value} dB`;
    updateCardSummary('Gain adjusted');
    splashAtElement(gainInput, 20, 0.48);
  });

  interlockInput.addEventListener('change', () => {
    updateCardSummary('Interlock toggled');
    splashAtElement(interlockInput, 22, 0.65);
  });

  alarmInput.addEventListener('change', () => {
    updateCardSummary('Alarm toggled');
    splashAtElement(alarmInput, 22, 0.65);
  });

  cardEl.addEventListener('submit', (e) => {
    e.preventDefault();
    state.logs++;
    updateCardSummary(`Logged #${state.logs}`);
    splashAtElement(cardEl.querySelector('button[type="submit"]') || cardEl, 34, 1.15);
  });

  pingBtn.addEventListener('click', () => {
    state.pings++;
    updateCardSummary(`Sonar ping #${state.pings} (depth ${(2.1 + state.waterLevel * 3.8).toFixed(1)} m)`);
    splashAtElement(pingBtn, 32, 1.25);
  });

  resetBtn.addEventListener('click', () => {
    noteInput.value = 'Swell rising on east pier';
    valveInput.value = '64';
    valveOut.textContent = '64%';
    gainInput.value = '14';
    gainOut.textContent = '14 dB';
    interlockInput.checked = true;
    alarmInput.checked = false;
    updateCardSummary('Form reset');
    splashAtElement(resetBtn, 26, 0.85);
  });

  new ResizeObserver(() => {
    cardDirty = true;
    lastGeoKey = '';
    if (route !== 'plain') canvas.requestPaint?.();
  }).observe(stageEl);

  // Initial calm ripple so the surface shows refraction on first frame.
  if (!reducedMotion) {
    const r = stageEl.getBoundingClientRect();
    water.splash(0.52, 0.68, 30, 0.9, r.width || 420, r.height || 470);
  }
  updateCardSummary('Station online');
  updateStatus(true);
  startLoop();

  // ---------------------------------------------------------------- live checks on isolated fixtures
  const need = (ok, detail) => {
    if (!ok) throw new Error(detail);
    return detail;
  };

  function makeFixture(w, h, html) {
    const cv = document.createElement('canvas');
    cv.setAttribute('content', 'drawable');
    cv.setAttribute('layoutsubtree', '');
    cv.style.cssText = `position:relative;display:block;width:${w}px;height:${h}px;`;
    const card = document.createElement('div');
    card.setAttribute('drawable', '');
    card.style.cssText = `position:absolute;inset:0;width:${w}px;height:${h}px;overflow:hidden;`;
    card.innerHTML = html;
    cv.append(card);
    testStage().append(cv);
    return { cv, card };
  }

  function readCssPx(glStage, cv, cssX, cssY) {
    const gl = glStage.gl;
    const sx = cv.width / (cv.clientWidth || 1);
    const sy = cv.height / (cv.clientHeight || 1);
    const rx = clamp(Math.floor(cssX * sx), 0, Math.max(0, cv.width - 1));
    const ry = clamp(Math.floor(cv.height - 1 - cssY * sy), 0, Math.max(0, cv.height - 1));
    const px = new Uint8Array(4);
    gl.readPixels(rx, ry, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  const tests = [
    {
      name: 'ElementGL and texElementSubImage2D() draw the submerged HTML card cleanly',
      expect: 'pass',
      why: 'Top half of the fixture card is warm vermilion (dry above the 50% shoreline) and bottom half is bright white (submerged with aqua tint below the shoreline).',
      run: async () => {
        if (!supported || !glSupported) throw new Error('WebGL texElementSubImage2D() is not available in this browser.');
        const { cv, card } = makeFixture(
          200,
          120,
          '<div style="width:200px;height:60px;background:#d2491f"></div><div style="width:200px;height:60px;background:#ffffff"></div>'
        );
        let g = null;
        let tex = null;
        try {
          g = new ElementGL(cv, { fragment: WATER_FRAGMENT, attributes: { preserveDrawingBuffer: true } });
          const field = new WaterField(64, 64);
          field.setAspect(200, 120);
          field.pack();
          tex = createWaterTexture(g.gl, field);
          await nextPaint(cv);
          g.upload(card);
          g.begin([0, 0, 0, 1]);
          g.quad(card, ElementGL.rect(cv, 0, 0, 200, 120), (gl, u) => {
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.uniform1i(u('uWaterTex'), 1);
            gl.uniform2f(u('uWaterRes'), field.cols, field.rows);
            gl.uniform1f(u('uWaterLevel'), 0.5);
            gl.uniform1f(u('uDepth'), 1.2);
            gl.uniform1f(u('uAmbient'), 0.0);
          });
          const dryPx = readCssPx(g, cv, 100, 24);
          const wetPx = readCssPx(g, cv, 100, 96);
          return need(
            dryPx[0] > 170 && dryPx[2] < 80 && wetPx[2] > wetPx[0] + 10 && wetPx[2] > 170,
            `Dry top rgb(${dryPx[0]},${dryPx[1]},${dryPx[2]}); submerged bottom rgb(${wetPx[0]},${wetPx[1]},${wetPx[2]}).`
          );
        } finally {
          if (g && tex && !g.lost) g.gl.deleteTexture(tex);
          g?.dispose();
          window.__gfx?.retire(cv);
        }
      },
    },
    {
      name: 'Wave perturbation updates heightfield energy and settles back smoothly',
      expect: 'pass',
      why: 'A splash in the centre of a 64 by 64 grid should raise wave energy, radiate outward to a ring 10 cells away, and damp down below 15% of peak energy within 240 steps.',
      run: async () => {
        const field = new WaterField(64, 64);
        field.setAspect(400, 400);
        const startE = field.energy().mean;
        field.splash(0.5, 0.5, 36, 1.0, 400, 400);
        const peakE = field.energy().mean;
        for (let i = 0; i < 18; i++) field.step(1);
        const ringIdx = 32 * 64 + 42;
        const ringHeight = Math.abs(field.curr[ringIdx]);
        for (let i = 0; i < 240; i++) field.step(1);
        const endE = field.energy().mean;
        const finite = Number.isFinite(endE) && Number.isFinite(ringHeight);
        return need(
          finite && startE === 0 && peakE > 0.002 && ringHeight > 0.01 && endE < peakE * 0.15,
          `Start E=${startE.toFixed(5)}, peak E=${peakE.toFixed(5)}, ring |h|=${ringHeight.toFixed(3)}, settled E=${endE.toFixed(5)}.`
        );
      },
    },
    {
      name: 'updateElementGeometry() keeps underwater buttons clickable',
      expect: 'pass',
      why: 'Places a button in the submerged lower half of a fixture canvas and checks elementsFromPoint() hits it and fires its click handler, including with a refraction offset.',
      run: async () => {
        if (!supported) throw new Error('HTML-in-canvas is not available in this browser.');
        const { cv, card } = makeFixture(
          220,
          120,
          '<button type="button" id="fx-sub-btn" style="position:absolute;left:40px;top:64px;width:96px;height:36px">Ping</button>'
        );
        let g = null;
        let tex = null;
        try {
          if (glSupported) {
            g = new ElementGL(cv, { fragment: WATER_FRAGMENT });
            const field = new WaterField(32, 32);
            field.pack();
            tex = createWaterTexture(g.gl, field);
            cv.addEventListener('paint', () => {
              if (!g || g.lost) return;
              g.upload(card);
              g.begin([0, 0, 0, 1]);
              g.quad(card, ElementGL.rect(cv, 0, 0, 220, 120), (gl, u) => {
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, tex);
                gl.uniform1i(u('uWaterTex'), 1);
                gl.uniform2f(u('uWaterRes'), field.cols, field.rows);
                gl.uniform1f(u('uWaterLevel'), 0.8);
                gl.uniform1f(u('uDepth'), 1.0);
                gl.uniform1f(u('uAmbient'), 0.0);
              });
            });
          } else {
            const ctx = cv.getContext('2d');
            cv.width = 220;
            cv.height = 120;
            cv.addEventListener('paint', () => {
              ctx.reset();
              ctx.drawElementImage(card, 0, 0, 220, 120);
            });
          }
          await nextPaint(cv);
          const unit = geometryUnit(cv, card, 220);
          cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit) });
          card.dataset.hitTick = '1';

          const btn = card.querySelector('#fx-sub-btn');
          let clicks = 0;
          btn.addEventListener('click', () => { clicks++; });

          const rect = cv.getBoundingClientRect();
          const stack1 = document.elementsFromPoint(rect.left + 88, rect.top + 82);
          const hitBase = stack1.includes(btn);
          if (hitBase) btn.click();

          // Apply a +16 px horizontal refraction offset and verify the hit box moves with it.
          cv.updateElementGeometry(card, { canvasTransform: new DOMMatrix().scale(unit).translate(16, 0) });
          card.dataset.hitTick = '0';
          const stack2 = document.elementsFromPoint(rect.left + 144, rect.top + 82);
          const hitOffset = stack2.includes(btn);
          return need(
            hitBase && clicks === 1 && hitOffset,
            `Base hit: ${hitBase}, click count: ${clicks}, +16 px offset hit at x=144: ${hitOffset}.`
          );
        } finally {
          if (g && tex && !g.lost) g.gl.deleteTexture(tex);
          g?.dispose();
          window.__gfx?.retire(cv);
        }
      },
    },
    {
      name: 'Zero openSnapshots and zero per-frame readback',
      expect: 'pass',
      why: 'The water PDE runs on CPU typed arrays and uploads via texSubImage2D(), so the render loop should open 0 captureElementImage() snapshots and trigger 0 unasked GPU readbacks.',
      run: async () => {
        // Step a few animation frames while checking context-guard telemetry.
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
        const gfx = window.__gfx;
        if (!gfx) {
          return 'context-guard.js not present; water loop uses texSubImage2D() with 0 snapshots and 0 readbacks.';
        }
        const openSnap = gfx.snapshots?.open ?? 0;
        const madeSnap = gfx.snapshots?.made ?? 0;
        const unasked = gfx.reads?.unasked ?? 0;
        const timed = Boolean(gfx.reads?.timed);
        const largestMP = (gfx.memory?.().largest ?? 0) / 1e6;
        return need(
          openSnap === 0 && madeSnap === 0 && unasked === 0 && !timed,
          `openSnapshots=${openSnap} (made ${madeSnap}), unasked readbacks=${unasked}, timed=${timed}, largest canvas=${largestMP.toFixed(2)} MP.`
        );
      },
    },
  ];

  runTests(document.getElementById('tests'), tests);
}

if (typeof document !== 'undefined' && document.getElementById('sub-canvas')) {
  mountSubmerged();
}
