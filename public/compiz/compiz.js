import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { geometryUnit } from '/lib/surface.js';
import {
  supported as canvas2dSupported,
  banner,
  runTests,
  testStage,
  nextPaint,
} from '/shared/support.js';

banner();

const MESH_DIVS = 20;
const GRID_N = 4;
const CUBE_HX = 0.92;
const CUBE_HY = 0.725;
const CUBE_LIFT_Y = 0.34;
const FLOOR_Y = -1.06;
const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

const PASSTHROUGH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

// #region spring-solver
/**
 * Compiz 2006 4x4 Bezier spring-mass grid.
 * Adjacent grid nodes are connected by vectorial rest-offset springs
 * ((stepX, 0) horizontally and (0, stepY) vertically) integrated with
 * 240 Hz symplectic substeps so the window shears and ripples like jelly
 * while always recovering upright.
 */
export class WobblyGrid {
  constructor(x = 60, y = 48, w = 320, h = 248) {
    this.winW = w;
    this.winH = h;
    this.nodes = Array.from({ length: GRID_N * GRID_N }, () => ({
      x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0, immobile: false,
    }));
    this.grabIndex = -1;
    this.grabOffsetX = 0;
    this.grabOffsetY = 0;
    this.maxLag = 0;
    this.settled = true;
    this.reset(x, y, w, h);
  }

  reset(x, y, w = this.winW, h = this.winH) {
    this.winW = Math.max(40, w);
    this.winH = Math.max(40, h);
    const sx = this.winW / (GRID_N - 1);
    const sy = this.winH / (GRID_N - 1);
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const n = this.nodes[j * GRID_N + i];
        n.x = x + i * sx;
        n.y = y + j * sy;
        n.vx = 0;
        n.vy = 0;
        n.fx = 0;
        n.fy = 0;
        n.immobile = false;
      }
    }
    this.grabIndex = -1;
    this.maxLag = 0;
    this.settled = true;
  }

  centroid() {
    let sx = 0, sy = 0;
    for (const n of this.nodes) { sx += n.x; sy += n.y; }
    return { x: sx / this.nodes.length, y: sy / this.nodes.length };
  }

  resizeKeepingCenter(newW, newH, bounds = null) {
    const c = this.centroid();
    let ox = c.x - newW * 0.5;
    let oy = c.y - newH * 0.5;
    if (bounds) {
      ox = Math.max(10, Math.min(bounds.w - newW - 10, ox));
      oy = Math.max(10, Math.min(bounds.h - newH - 10, oy));
    }
    this.reset(ox, oy, newW, newH);
  }

  grabNearest(px, py) {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < this.nodes.length; k++) {
      const n = this.nodes[k];
      const d = Math.hypot(n.x - px, n.y - py);
      if (d < bestD) { bestD = d; best = k; }
    }
    for (const n of this.nodes) n.immobile = false;
    this.grabIndex = best;
    const pinned = this.nodes[best];
    pinned.immobile = true;
    pinned.vx = 0;
    pinned.vy = 0;
    this.grabOffsetX = pinned.x - px;
    this.grabOffsetY = pinned.y - py;
    this.settled = false;
    return best;
  }

  moveGrab(px, py, bounds = null) {
    if (this.grabIndex < 0) return;
    const n = this.nodes[this.grabIndex];
    let tx = px + this.grabOffsetX;
    let ty = py + this.grabOffsetY;
    if (bounds) {
      const pad = 10;
      tx = Math.max(pad, Math.min(bounds.w - pad, tx));
      ty = Math.max(pad, Math.min(bounds.h - pad, ty));
    }
    n.x = tx;
    n.y = ty;
    n.vx = 0;
    n.vy = 0;
    this.settled = false;
  }

  releaseGrab(vx = 0, vy = 0) {
    if (this.grabIndex < 0) return;
    const speed = Math.hypot(vx, vy);
    const maxV = 1500;
    const scale = speed > maxV ? maxV / speed : 1;
    const rvx = vx * scale;
    const rvy = vy * scale;
    const gi = this.grabIndex % GRID_N;
    const gj = Math.floor(this.grabIndex / GRID_N);
    const pinned = this.nodes[this.grabIndex];
    pinned.immobile = false;
    pinned.vx = rvx * 0.45;
    pinned.vy = rvy * 0.45;
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const dist = Math.abs(i - gi) + Math.abs(j - gj);
        if (dist === 1) {
          const nb = this.nodes[j * GRID_N + i];
          nb.vx += rvx * 0.16;
          nb.vy += rvy * 0.16;
        }
      }
    }
    this.grabIndex = -1;
    this.settled = false;
  }

  applyImpulse(ix, iy, twist = 0) {
    for (let j = 0; j < GRID_N; j++) {
      const vFrac = j / (GRID_N - 1);
      const rowSign = 1 - 1.65 * vFrac;
      for (let i = 0; i < GRID_N; i++) {
        const uFrac = i / (GRID_N - 1) - 0.5;
        const n = this.nodes[j * GRID_N + i];
        if (n.immobile) continue;
        n.vx += ix * rowSign + twist * (vFrac - 0.5);
        n.vy += iy * (1 - 0.5 * vFrac) - twist * uFrac * 0.7;
      }
    }
    this.settled = false;
  }

  step(dt, opts = {}) {
    const stiffness = opts.stiffness ?? 5.5;
    const friction = opts.friction ?? 3.5;
    const elastic = opts.elastic ?? true;
    const edgeBounce = opts.edgeBounce ?? true;
    const bounds = opts.bounds ?? null;

    const sx = this.winW / (GRID_N - 1);
    const sy = this.winH / (GRID_N - 1);

    if (!elastic) {
      if (this.grabIndex >= 0) {
        const gi = this.grabIndex % GRID_N;
        const gj = Math.floor(this.grabIndex / GRID_N);
        const anchor = this.nodes[this.grabIndex];
        const ox = anchor.x - gi * sx;
        const oy = anchor.y - gj * sy;
        for (let j = 0; j < GRID_N; j++) {
          for (let i = 0; i < GRID_N; i++) {
            const n = this.nodes[j * GRID_N + i];
            n.x = ox + i * sx;
            n.y = oy + j * sy;
            n.vx = 0;
            n.vy = 0;
          }
        }
      }
      this.maxLag = 0;
      this.settled = this.grabIndex < 0;
      return;
    }

    const clampedDt = Math.min(Math.max(dt, 0), 0.05);
    if (clampedDt <= 0) return;

    const subDt = 1 / 240;
    const steps = Math.max(1, Math.min(12, Math.ceil(clampedDt / subDt)));
    const h = clampedDt / steps;
    const K = 48 + stiffness * 34;
    const D = 1.6 + friction * 1.1;
    const damp = Math.exp(-D * h);
    const edgeK = 240;
    const pad = 14;

    for (let s = 0; s < steps; s++) {
      for (const n of this.nodes) { n.fx = 0; n.fy = 0; }

      for (let j = 0; j < GRID_N; j++) {
        for (let i = 0; i < GRID_N - 1; i++) {
          const a = this.nodes[j * GRID_N + i];
          const b = this.nodes[j * GRID_N + i + 1];
          const dx = (a.x + sx) - b.x;
          const dy = a.y - b.y;
          b.fx += K * dx; b.fy += K * dy;
          a.fx -= K * dx; a.fy -= K * dy;
        }
      }

      for (let j = 0; j < GRID_N - 1; j++) {
        for (let i = 0; i < GRID_N; i++) {
          const a = this.nodes[j * GRID_N + i];
          const b = this.nodes[(j + 1) * GRID_N + i];
          const dx = a.x - b.x;
          const dy = (a.y + sy) - b.y;
          b.fx += K * dx; b.fy += K * dy;
          a.fx -= K * dx; a.fy -= K * dy;
        }
      }

      if (edgeBounce && bounds && this.grabIndex < 0) {
        const minX = pad;
        const maxX = Math.max(minX + 40, bounds.w - pad);
        const minY = pad;
        const maxY = Math.max(minY + 40, bounds.h - pad);
        for (const n of this.nodes) {
          if (n.x < minX) n.fx += edgeK * (minX - n.x);
          else if (n.x > maxX) n.fx -= edgeK * (n.x - maxX);
          if (n.y < minY) n.fy += edgeK * (minY - n.y);
          else if (n.y > maxY) n.fy -= edgeK * (n.y - maxY);
        }
      }

      for (const n of this.nodes) {
        if (n.immobile) continue;
        n.vx = (n.vx + n.fx * h) * damp;
        n.vy = (n.vy + n.fy * h) * damp;
        n.x += n.vx * h;
        n.y += n.vy * h;
      }
    }

    const c = this.centroid();
    const ox = c.x - this.winW * 0.5;
    const oy = c.y - this.winH * 0.5;
    let maxLag = 0;
    let maxSpeed = 0;
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const n = this.nodes[j * GRID_N + i];
        const lag = Math.hypot(n.x - (ox + i * sx), n.y - (oy + j * sy));
        if (lag > maxLag) maxLag = lag;
        const sp = Math.hypot(n.vx, n.vy);
        if (sp > maxSpeed) maxSpeed = sp;
      }
    }
    this.maxLag = maxLag;

    if (this.grabIndex < 0 && maxLag < 0.08 && maxSpeed < 0.8) {
      let fx = ox;
      let fy = oy;
      if (edgeBounce && bounds) {
        fx = Math.max(pad, Math.min(bounds.w - this.winW - pad, fx));
        fy = Math.max(pad, Math.min(bounds.h - this.winH - pad, fy));
      }
      for (let j = 0; j < GRID_N; j++) {
        for (let i = 0; i < GRID_N; i++) {
          const n = this.nodes[j * GRID_N + i];
          n.x = fx + i * sx;
          n.y = fy + j * sy;
          n.vx = 0;
          n.vy = 0;
        }
      }
      this.maxLag = 0;
      this.settled = true;
    } else {
      this.settled = false;
    }
  }

  fillControls(out32, minimizeT = 0, dockX = 0, dockY = 0) {
    for (let j = 0; j < GRID_N; j++) {
      const rowT = minimizeT > 0.0001
        ? Math.max(0, Math.min(1, (minimizeT * 1.48 - (GRID_N - 1 - j) * 0.16)))
        : 0;
      const smooth = rowT * rowT * (3 - 2 * rowT);
      const pinch = Math.pow(smooth, 0.7);
      const pullY = smooth * smooth;
      for (let i = 0; i < GRID_N; i++) {
        const idx = j * GRID_N + i;
        const n = this.nodes[idx];
        let x = n.x;
        let y = n.y;
        if (minimizeT > 0.0001) {
          const targetX = dockX + (i - 1.5) * 9;
          x = x + (targetX - x) * pinch;
          y = y + (dockY - y) * pullY;
        }
        out32[idx * 2] = x;
        out32[idx * 2 + 1] = y;
      }
    }
    return out32;
  }

  evalBezier(u, v, ctrl32 = null) {
    const iu = 1 - u, iv = 1 - v;
    const bu = [iu * iu * iu, 3 * u * iu * iu, 3 * u * u * iu, u * u * u];
    const bv = [iv * iv * iv, 3 * v * iv * iv, 3 * v * v * iv, v * v * v];
    let x = 0, y = 0;
    for (let j = 0; j < GRID_N; j++) {
      for (let i = 0; i < GRID_N; i++) {
        const w = bu[i] * bv[j];
        const idx = j * GRID_N + i;
        const px = ctrl32 ? ctrl32[idx * 2] : this.nodes[idx].x;
        const py = ctrl32 ? ctrl32[idx * 2 + 1] : this.nodes[idx].y;
        x += px * w;
        y += py * w;
      }
    }
    return { x, y };
  }
}
// #endregion spring-solver

// #region wobbly-geometry
/**
 * Fit a least-squares sheared affine DOMMatrix to the four deformed corners
 * of the 4x4 Bezier spring grid and scale it by geometryUnit().
 */
export function wobblyHitMatrix(ctrl32, winW, winH, unit) {
  const tlx = ctrl32[0], tly = ctrl32[1];
  const trx = ctrl32[6], try_ = ctrl32[7];
  const blx = ctrl32[24], bly = ctrl32[25];
  const brx = ctrl32[30], bry = ctrl32[31];

  const cx = 0.25 * (tlx + trx + blx + brx);
  const cy = 0.25 * (tly + try_ + bly + bry);
  const w = Math.max(winW, 1);
  const h = Math.max(winH, 1);

  const exX = ((trx - tlx) + (brx - blx)) / (2 * w);
  const exY = ((try_ - tly) + (bry - bly)) / (2 * w);
  const eyX = ((blx - tlx) + (brx - trx)) / (2 * h);
  const eyY = ((bly - tly) + (bry - try_)) / (2 * h);

  const det = exX * eyY - exY * eyX;
  let m;
  if (Math.abs(det) < 0.04) {
    m = new DOMMatrix().translate(cx - w * 0.5, cy - h * 0.5);
  } else {
    const ox = cx - 0.5 * w * exX - 0.5 * h * eyX;
    const oy = cy - 0.5 * w * exY - 0.5 * h * eyY;
    m = new DOMMatrix([exX, exY, eyX, eyY, ox, oy]);
  }
  return new DOMMatrix().scale(unit, unit, 1).multiply(m);
}
// #endregion wobbly-geometry

// #region bezier-shader
const WOBBLY_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;

uniform vec2 uCanvas;
uniform vec2 uCtrl[16];
uniform vec2 uOffset;
uniform vec2 uRestSize;

out vec2 vUv;
out float vStrain;

void evalPatch(vec2 uv, out vec2 pos, out vec2 dPdu, out vec2 dPdv) {
  float u = uv.x, v = uv.y;
  float iu = 1.0 - u, iv = 1.0 - v;
  float bu[4] = float[4](iu * iu * iu, 3.0 * u * iu * iu, 3.0 * u * u * iu, u * u * u);
  float bv[4] = float[4](iv * iv * iv, 3.0 * v * iv * iv, 3.0 * v * v * iv, v * v * v);
  float dbu[4] = float[4](-3.0 * iu * iu, 3.0 * iu * iu - 6.0 * u * iu, 6.0 * u * iu - 3.0 * u * u, 3.0 * u * u);
  float dbv[4] = float[4](-3.0 * iv * iv, 3.0 * iv * iv - 6.0 * v * iv, 6.0 * v * iv - 3.0 * v * v, 3.0 * v * v);

  pos = vec2(0.0);
  dPdu = vec2(0.0);
  dPdv = vec2(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 p = uCtrl[j * 4 + i];
      pos += p * (bu[i] * bv[j]);
      dPdu += p * (dbu[i] * bv[j]);
      dPdv += p * (bu[i] * dbv[j]);
    }
  }
}

void main() {
  vUv = aUv;
  vec2 pos, dPdu, dPdv;
  evalPatch(aUv, pos, dPdu, dPdv);
  pos += uOffset;

  float area = abs(dPdu.x * dPdv.y - dPdu.y * dPdv.x);
  float restArea = max(uRestSize.x * uRestSize.y, 1.0);
  float shear = abs(dot(normalize(dPdu + vec2(1e-4, 0.0)), normalize(dPdv + vec2(0.0, 1e-4))));
  vStrain = clamp(abs(area / restArea - 1.0) * 1.4 + shear * 0.9, 0.0, 1.0);

  vec2 clip = vec2((pos.x / max(uCanvas.x, 1.0)) * 2.0 - 1.0, 1.0 - (pos.y / max(uCanvas.y, 1.0)) * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const WOBBLY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in float vStrain;

uniform sampler2D uTex;
uniform int uPass; // 0 = drop shadow, 1 = live window, 2 = mesh wireframe
uniform float uAlpha;
uniform float uGlow;
uniform vec4 uWireColor;

out vec4 outColor;

void main() {
  if (uPass == 2) {
    outColor = vec4(uWireColor.rgb * uWireColor.a, uWireColor.a);
    return;
  }
  if (uPass == 0) {
    vec2 edge = min(vUv, 1.0 - vUv);
    float feather = smoothstep(0.0, 0.06, edge.x) * smoothstep(0.0, 0.07, edge.y);
    float a = 0.40 * feather * uAlpha;
    outColor = vec4(0.02 * a, 0.01 * a, 0.05 * a, a);
    return;
  }

  vec4 tex = texture(uTex, vUv);
  float sheen = vStrain * (0.14 + 0.16 * uGlow) * (0.55 + 0.45 * sin((vUv.x + vUv.y) * 6.28318));
  float rimX = 1.0 - smoothstep(0.0, 0.014, min(vUv.x, 1.0 - vUv.x));
  float rimY = 1.0 - smoothstep(0.0, 0.018, min(vUv.y, 1.0 - vUv.y));
  float rim = max(rimX, rimY) * (0.20 + 0.35 * vStrain);
  vec3 tint = vec3(1.0, 0.66, 0.36);
  vec3 rgb = tex.rgb + (tint * sheen + vec3(0.95, 0.72, 0.50) * rim) * tex.a;
  outColor = vec4(rgb * uAlpha, tex.a * uAlpha);
}`;
// #endregion bezier-shader

const BG_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0);
}`;

const BG_FS = `#version 300 es
precision highp float;
in vec2 vUv;

uniform vec2 uCanvas;
uniform float uMode; // 0 = wobbly desktop, 1 = 3D cube skydome + floor
uniform float uTheme; // 0 = beryl indigo, 1 = ubuntu aubergine, 2 = emerald
uniform float uGlow;
uniform vec2 uSpot;
uniform float uHorizon;

out vec4 outColor;

void main() {
  vec3 topCol = vec3(0.07, 0.11, 0.22);
  vec3 botCol = vec3(0.03, 0.04, 0.09);
  vec3 accent = vec3(0.26, 0.58, 0.96);

  if (uTheme > 0.5 && uTheme < 1.5) {
    topCol = vec3(0.21, 0.08, 0.16);
    botCol = vec3(0.07, 0.03, 0.07);
    accent = vec3(0.92, 0.42, 0.16);
  } else if (uTheme >= 1.5) {
    topCol = vec3(0.06, 0.18, 0.19);
    botCol = vec3(0.02, 0.07, 0.08);
    accent = vec3(0.18, 0.78, 0.68);
  }

  vec2 px = vUv * uCanvas;

  if (uMode < 0.5) {
    vec3 col = mix(topCol, botCol, pow(vUv.y, 0.9));
    float dSpot = length((px - uSpot) / max(min(uCanvas.x, uCanvas.y), 1.0));
    col += accent * exp(-dSpot * dSpot * 3.4) * (0.14 + 0.26 * uGlow);

    vec2 g = abs(fract(px / 32.0 - 0.5) - 0.5) / max(fwidth(px / 32.0), vec2(0.001));
    float gridLine = 1.0 - min(min(g.x, g.y), 1.0);
    col += accent * gridLine * 0.055;

    // Classic subtle top desktop panel strip hint.
    float topStrip = 1.0 - smoothstep(18.0, 26.0, px.y);
    col = mix(col, vec3(0.03, 0.03, 0.05), topStrip * 0.45);

    float vig = 1.0 - 0.30 * dot(vUv - 0.5, vUv - 0.5);
    outColor = vec4(col * vig, 1.0);
    return;
  }

  // 3D Desktop Cube skydome + glossy reflective floor.
  float h = clamp(uHorizon, 0.48, 0.76);
  vec3 col;
  if (vUv.y < h) {
    float t = vUv.y / max(h, 0.01);
    col = mix(topCol * 1.15, mix(topCol, accent, 0.24), pow(t, 1.6));
    float aura = exp(-pow((vUv.x - 0.5) * 2.2, 2.0) - pow((vUv.y - h * 0.72) * 3.0, 2.0));
    col += accent * aura * (0.16 + 0.16 * uGlow);
  } else {
    float fy = (vUv.y - h) / max(1.0 - h, 0.01);
    vec3 floorNear = mix(botCol, topCol, 0.22);
    vec3 floorFar = botCol * 0.55;
    col = mix(floorNear, floorFar, pow(fy, 0.75));

    // Perspective floor grid lines receding to horizon.
    float z = 1.0 / max(fy + 0.06, 0.06);
    float gx = (vUv.x - 0.5) * z * 2.2;
    float gz = z * 0.65;
    float lx = abs(fract(gx - 0.5) - 0.5);
    float lz = abs(fract(gz - 0.5) - 0.5);
    float grid = (1.0 - smoothstep(0.015, 0.06, min(lx, lz))) * smoothstep(0.0, 0.18, fy) * (1.0 - fy * 0.6);
    col += accent * grid * 0.11;

    // Soft elliptical shadow under the hovering cube.
    vec2 sd = vec2((vUv.x - 0.5) * 2.5, (fy - 0.24) * 5.2);
    float shadow = exp(-dot(sd, sd) * 2.2) * 0.58;
    col *= (1.0 - shadow);
  }

  float seam = exp(-abs(vUv.y - h) * 85.0);
  col += accent * seam * 0.24;
  outColor = vec4(col, 1.0);
}`;

const CAGE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform vec2 uCanvas;
uniform float uPointSize;
void main() {
  vec2 clip = vec2((aPos.x / max(uCanvas.x, 1.0)) * 2.0 - 1.0, 1.0 - (aPos.y / max(uCanvas.y, 1.0)) * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

const CAGE_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = vec4(uColor.rgb * uColor.a, uColor.a);
}`;

const CUBE_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;

uniform mat4 uModel;
uniform mat4 uVP;
uniform vec3 uOrigin;
uniform vec3 uAxisU;
uniform vec3 uAxisV;
uniform vec3 uNormal;
uniform float uReflect;
uniform float uFloorY;

out vec2 vUv;
out vec3 vWorldPos;
out vec3 vWorldNormal;

void main() {
  vUv = aUv;
  vec3 localPos = uOrigin + aUv.x * uAxisU + aUv.y * uAxisV;
  vec4 wp = uModel * vec4(localPos, 1.0);
  vec3 wn = normalize(mat3(uModel) * uNormal);
  if (uReflect > 0.5) {
    wp.y = 2.0 * uFloorY - wp.y;
    wn.y = -wn.y;
  }
  vWorldPos = wp.xyz;
  vWorldNormal = wn;
  gl_Position = uVP * wp;
}`;

const CUBE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vWorldPos;
in vec3 vWorldNormal;

uniform sampler2D uTex;
uniform int uKind; // 0 = live HTML workspace face, 1 = procedural Compiz cap
uniform float uAlpha;
uniform float uReflect;
uniform float uFloorY;
uniform float uRimGlow;
uniform float uIsFront;
uniform vec3 uAccent;
uniform vec3 uCamPos;

out vec4 outColor;

void main() {
  vec3 N = normalize(vWorldNormal);
  vec3 V = normalize(uCamPos - vWorldPos);
  bool frontSide = dot(N, V) >= 0.0;
  vec3 Nf = frontSide ? N : -N;
  vec3 L = normalize(vec3(-0.35, 0.62, 0.78));
  float ndotl = max(dot(Nf, L), 0.0);
  float light = frontSide ? (0.74 + 0.28 * ndotl) : (0.50 + 0.20 * ndotl);
  float fresnel = pow(1.0 - max(dot(Nf, V), 0.0), 2.4);

  float reflectFade = 1.0;
  if (uReflect > 0.5) {
    if (vWorldPos.y > uFloorY + 0.01) discard;
    reflectFade = smoothstep(uFloorY - 2.15, uFloorY - 0.05, vWorldPos.y) * 0.44;
    if (reflectFade <= 0.004) discard;
  }

  float edgeDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
  float border = 1.0 - smoothstep(0.004, 0.022, edgeDist);

  if (uKind == 1) {
    // Classic Compiz Fusion brushed dark cap with concentric compass ring.
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ang = atan(p.y, p.x);
    vec3 base = mix(vec3(0.11, 0.14, 0.21), vec3(0.05, 0.06, 0.10), clamp(r * 0.85, 0.0, 1.0));
    float ring1 = 1.0 - smoothstep(0.012, 0.036, abs(r - 0.58));
    float ring2 = 1.0 - smoothstep(0.008, 0.024, abs(r - 0.30));
    float spokes = (1.0 - smoothstep(0.02, 0.08, abs(sin(ang * 4.0)))) * smoothstep(0.30, 0.34, r) * (1.0 - smoothstep(0.56, 0.60, r));
    vec3 col = base * light + uAccent * (ring1 * 0.62 + ring2 * 0.42 + spokes * 0.25 + border * 0.45);
    float a = clamp(uAlpha * 0.90, 0.25, 0.94) * reflectFade;
    outColor = vec4(col * a, a);
    return;
  }

  vec4 tex = texture(uTex, vUv);
  vec3 lit = tex.rgb * light;
  float edgeBoost = border * (0.28 + 0.42 * uRimGlow + 0.24 * uIsFront);
  vec3 glassRim = uAccent * (edgeBoost + fresnel * (0.14 + 0.20 * uRimGlow));
  vec3 rgb = lit + glassRim * tex.a;
  if (uReflect > 0.5) rgb *= vec3(0.84, 0.88, 0.96);

  float a = tex.a * uAlpha * reflectFade;
  outColor = vec4(rgb * (uAlpha * reflectFade), a);
}`;

// --- Compact 4x4 column-major 3D matrix helpers ---
export function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function mat4Mul(a, b, out = new Float32Array(16)) {
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4], b1 = b[col * 4 + 1], b2 = b[col * 4 + 2], b3 = b[col * 4 + 3];
    out[col * 4]     = a[0] * b0 + a[4] * b1 + a[8]  * b2 + a[12] * b3;
    out[col * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9]  * b2 + a[13] * b3;
    out[col * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[col * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function mat4RotateX(rad) {
  const m = mat4Identity();
  const c = Math.cos(rad), s = Math.sin(rad);
  m[5] = c; m[6] = s;
  m[9] = -s; m[10] = c;
  return m;
}

export function mat4RotateY(rad) {
  const m = mat4Identity();
  const c = Math.cos(rad), s = Math.sin(rad);
  m[0] = c; m[2] = -s;
  m[8] = s; m[10] = c;
  return m;
}

export function mat4Perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY * 0.5);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / Math.max(aspect, 0.01);
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye, target, up) {
  let zx = eye[0] - target[0], zy = eye[1] - target[1], zz = eye[2] - target[2];
  const zl = Math.hypot(zx, zy, zz) || 1;
  zx /= zl; zy /= zl; zz /= zl;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl; xy /= xl; xz /= xl;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

function mulVec3Point(m, p) {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function mulVec3Dir(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8]  * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9]  * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

// #region cube-geometry
/**
 * Build the exact projective DOMMatrix that maps a cube workspace's element CSS
 * pixels (0..elW, 0..elH) onto the perspective-projected face in canvas pixels,
 * then scales by geometryUnit().
 */
export function cubeProjectiveMatrix(face, elW, elH, modelMat, vpMat, cw, ch, unit) {
  const w = Math.max(elW, 1);
  const h = Math.max(elH, 1);
  const { origin: o, axisU: x, axisV: y, normal: n } = face;

  const elemToCube = new Float32Array([
    x[0] / w, x[1] / w, x[2] / w, 0,
    y[0] / h, y[1] / h, y[2] / h, 0,
    n[0],     n[1],     n[2],     0,
    o[0],     o[1],     o[2],     1,
  ]);
  const modelElem = mat4Mul(modelMat, elemToCube);
  const clipElem = mat4Mul(vpMat, modelElem);

  const ndcToCanvas = new Float32Array([
    cw * 0.5,  0,         0, 0,
    0,        -ch * 0.5,  0, 0,
    0,         0,         1, 0,
    cw * 0.5,  ch * 0.5,  0, 1,
  ]);
  const canvasMat = mat4Mul(ndcToCanvas, clipElem);
  return new DOMMatrix().scale(unit, unit, 1).multiply(new DOMMatrix(Array.from(canvasMat)));
}
// #endregion cube-geometry

function compileProgram(gl, vsSrc, fsSrc) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(log || 'Shader compile error');
    }
    return s;
  };
  const vs = make(gl.VERTEX_SHADER, vsSrc);
  const fs = make(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(log || 'Program link error');
  }
  const cache = new Map();
  const u = (name) => {
    let loc = cache.get(name);
    if (loc === undefined) {
      loc = gl.getUniformLocation(prog, name);
      if (loc === null && !name.includes('[')) loc = gl.getUniformLocation(prog, `${name}[0]`);
      cache.set(name, loc);
    }
    return loc;
  };
  return { prog, u };
}

function disposeGpuResources(gl, res) {
  if (!gl || !res || gl.isContextLost()) return;
  for (const p of [res.bg, res.wobbly, res.cage, res.cube]) {
    if (p?.prog) gl.deleteProgram(p.prog);
  }
  for (const vao of [res.quadVao, res.meshVao, res.wireVao, res.cageVao]) {
    if (vao) gl.deleteVertexArray(vao);
  }
  for (const buf of res.buffers ?? []) {
    if (buf) gl.deleteBuffer(buf);
  }
}

function buildGpuResources(gl) {
  const bg = compileProgram(gl, BG_VS, BG_FS);
  const wobbly = compileProgram(gl, WOBBLY_VS, WOBBLY_FS);
  const cage = compileProgram(gl, CAGE_VS, CAGE_FS);
  const cube = compileProgram(gl, CUBE_VS, CUBE_FS);

  // Unit quad VAO for background and 3D cube faces.
  const quadVao = gl.createVertexArray();
  gl.bindVertexArray(quadVao);
  const quadVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // Static 20x20 subdivided mesh for the wobbly Bezier patch.
  const cols = MESH_DIVS;
  const rows = MESH_DIVS;
  const stride = cols + 1;
  const verts = new Float32Array(stride * (rows + 1) * 2);
  let vi = 0;
  for (let r = 0; r <= rows; r++) {
    const v = r / rows;
    for (let c = 0; c <= cols; c++) {
      verts[vi++] = c / cols;
      verts[vi++] = v;
    }
  }
  const triIdx = new Uint16Array(cols * rows * 6);
  let ti = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c;
      const b = a + 1;
      const cIdx = a + stride;
      const d = cIdx + 1;
      triIdx[ti++] = a; triIdx[ti++] = cIdx; triIdx[ti++] = b;
      triIdx[ti++] = b; triIdx[ti++] = cIdx; triIdx[ti++] = d;
    }
  }

  const wireIdx = new Uint16Array(((rows + 1) * cols + (cols + 1) * rows) * 2);
  let wi = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const a = r * stride + c;
      wireIdx[wi++] = a; wireIdx[wi++] = a + 1;
    }
  }
  for (let c = 0; c <= cols; c++) {
    for (let r = 0; r < rows; r++) {
      const a = r * stride + c;
      wireIdx[wi++] = a; wireIdx[wi++] = a + stride;
    }
  }

  const meshVao = gl.createVertexArray();
  gl.bindVertexArray(meshVao);
  const meshVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const meshTriIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshTriIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triIdx, gl.STATIC_DRAW);

  const wireVao = gl.createVertexArray();
  gl.bindVertexArray(wireVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const meshWireIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshWireIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, wireIdx, gl.STATIC_DRAW);

  // Dynamic VAO for the 4x4 spring cage lines and 16 control nodes.
  const cageVao = gl.createVertexArray();
  gl.bindVertexArray(cageVao);
  const cageVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, cageVbo);
  gl.bufferData(gl.ARRAY_BUFFER, 48 * 2 * 4, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  gl.bindVertexArray(null);
  return {
    bg, wobbly, cage, cube,
    quadVao, meshVao, wireVao, cageVao, cageVbo,
    buffers: [quadVbo, meshVbo, meshTriIbo, meshWireIbo, cageVbo],
    triCount: triIdx.length,
    wireCount: wireIdx.length,
  };
}

function cubeFaceDefs(hx = CUBE_HX, hy = CUBE_HY) {
  const faces = [
    {
      kind: 0, wsIndex: 0, accent: [1.0, 0.48, 0.24],
      origin: [-hx,  hy,  hx], axisU: [ 2 * hx, 0, 0], axisV: [0, -2 * hy, 0], normal: [ 0,  0,  1],
    },
    {
      kind: 0, wsIndex: 1, accent: [0.18, 0.77, 0.71],
      origin: [ hx,  hy,  hx], axisU: [0, 0, -2 * hx], axisV: [0, -2 * hy, 0], normal: [ 1,  0,  0],
    },
    {
      kind: 0, wsIndex: 2, accent: [0.95, 0.72, 0.02],
      origin: [ hx,  hy, -hx], axisU: [-2 * hx, 0, 0], axisV: [0, -2 * hy, 0], normal: [ 0,  0, -1],
    },
    {
      kind: 0, wsIndex: 3, accent: [0.65, 0.55, 0.98],
      origin: [-hx,  hy, -hx], axisU: [0, 0,  2 * hx], axisV: [0, -2 * hy, 0], normal: [-1,  0,  0],
    },
    {
      kind: 1, wsIndex: -1, accent: [0.46, 0.74, 0.98],
      origin: [-hx,  hy, -hx], axisU: [ 2 * hx, 0, 0], axisV: [0, 0,  2 * hx], normal: [ 0,  1,  0],
    },
    {
      kind: 1, wsIndex: -1, accent: [0.46, 0.74, 0.98],
      origin: [-hx, -hy,  hx], axisU: [ 2 * hx, 0, 0], axisV: [0, 0, -2 * hx], normal: [ 0, -1,  0],
    },
  ];
  for (const f of faces) {
    f.center = [
      f.origin[0] + 0.5 * f.axisU[0] + 0.5 * f.axisV[0],
      f.origin[1] + 0.5 * f.axisU[1] + 0.5 * f.axisV[1],
      f.origin[2] + 0.5 * f.axisU[2] + 0.5 * f.axisV[2],
    ];
  }
  return faces;
}

// --- DOM wiring for the live page demo ---
const stageBox = document.getElementById('compiz-stage');
const canvas = document.getElementById('compiz-canvas');
const statusNote = document.getElementById('stage-status');
const dockRestoreBtn = document.getElementById('dock-restore');
const fallbackDeck = document.getElementById('fallback-deck');
const telemetryEl = document.getElementById('compiz-telemetry');

const wobblyWin = document.getElementById('wobbly-win');
const wsEls = [
  document.getElementById('cube-ws-0'),
  document.getElementById('cube-ws-1'),
  document.getElementById('cube-ws-2'),
  document.getElementById('cube-ws-3'),
];

const modeWobblyBtn = document.getElementById('mode-wobbly');
const modeCubeBtn = document.getElementById('mode-cube');
const controlsWobbly = document.getElementById('controls-wobbly');
const controlsCube = document.getElementById('controls-cube');

const flingBtn = document.getElementById('btn-fling');
const minBtn = document.getElementById('btn-minimize');
const centreBtn = document.getElementById('btn-centre');
const stiffnessRange = document.getElementById('rng-stiffness');
const stiffnessOut = document.getElementById('out-stiffness');
const frictionRange = document.getElementById('rng-friction');
const frictionOut = document.getElementById('out-friction');
const wireframeChk = document.getElementById('chk-wireframe');

const wsJumpBtns = Array.from(document.querySelectorAll('.ws-jump'));
const spinBtn = document.getElementById('btn-spin');
const cubeResetBtn = document.getElementById('btn-cube-reset');
const opacityRange = document.getElementById('rng-opacity');
const opacityOut = document.getElementById('out-opacity');
const reflectChk = document.getElementById('chk-reflect');

const reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

const CUBE_FACES = cubeFaceDefs();
const ctrlBuf = new Float32Array(32);
const cageLinesBuf = new Float32Array(24 * 2 * 2);

const state = {
  route: 'none', // 'webgl' | '2d' | 'plain'
  mode: 'wobbly', // 'wobbly' | 'cube'
  inView: true,
  rafId: 0,
  lastTime: 0,
  clockTimer: 0,

  // Wobbly state
  grid: new WobblyGrid(80, 56, 320, 248),
  stiffness: 5.5,
  friction: 3.5,
  elastic: true,
  edgeBounce: true,
  wireframe: false,
  glow: 0.62,
  minimized: false,
  minimizeT: 0,
  wobblyInitialized: false,
  lastStageW: 0,
  lastStageH: 0,

  // Cube state
  yaw: -0.34,
  pitch: -0.16,
  yawVel: 0,
  pitchVel: 0,
  targetYaw: null,
  targetPitch: null,
  autoSpin: false,
  opacity: 0.78,
  showReflection: true,
  rimGlow: 0.68,
  frontWs: 0,
  theme: 0,

  // Pointer drag state
  drag: null,

  // Hit-test cache-clear keys
  hitKeys: new WeakMap(),
  lastTelemetry: '',
};

let stage = null;
let gpu = null;
let ctx2d = null;
const textures = new Map();

function bumpHitTick(el, key) {
  if (state.hitKeys.get(el) === key) return;
  state.hitKeys.set(el, key);
  el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
}

function setStatus(msg) {
  if (!statusNote) return;
  if (msg) {
    statusNote.textContent = msg;
    statusNote.hidden = false;
  } else {
    statusNote.hidden = true;
  }
}

function stageMetrics() {
  const cw = canvas?.clientWidth || 380;
  const ch = canvas?.clientHeight || 420;
  return { cw, ch };
}

function syncWindowDimensions() {
  if (!wobblyWin || state.route === 'plain') return;
  const { cw, ch } = stageMetrics();
  const targetW = cw < 500 ? Math.max(244, Math.min(286, Math.round(cw - 64))) : 324;
  const pxW = `${targetW}px`;
  if (wobblyWin.style.width !== pxW) wobblyWin.style.width = pxW;
  const elW = wobblyWin.offsetWidth || targetW;
  const elH = wobblyWin.offsetHeight || 248;

  if (!state.wobblyInitialized) {
    const ox = Math.max(16, Math.round((cw - elW) * 0.5));
    const oy = Math.max(24, Math.round((ch - elH) * 0.44));
    state.grid.reset(ox, oy, elW, elH);
    state.wobblyInitialized = true;
    state.lastStageW = cw;
    state.lastStageH = ch;
  } else if (Math.abs(elW - state.grid.winW) > 1 || Math.abs(elH - state.grid.winH) > 1 || Math.abs(cw - state.lastStageW) > 4 || Math.abs(ch - state.lastStageH) > 4) {
    state.grid.resizeKeepingCenter(elW, elH, { w: cw, h: ch });
    state.lastStageW = cw;
    state.lastStageH = ch;
  }
}

function syncInertState() {
  if (state.route === 'plain') {
    wobblyWin.inert = false;
    for (const el of wsEls) el.inert = false;
    return;
  }
  if (state.mode === 'wobbly') {
    wobblyWin.inert = state.minimized || state.minimizeT > 0.35;
    for (const el of wsEls) el.inert = true;
  } else {
    wobblyWin.inert = true;
    for (let i = 0; i < wsEls.length; i++) {
      wsEls[i].inert = i !== state.frontWs;
    }
  }
}

function requestRepaint() {
  if (state.route === 'plain') return;
  if (state.route === 'webgl' && stage && !stage.lost) {
    canvas.requestPaint?.();
  } else if (state.route === '2d' && ctx2d) {
    canvas.requestPaint?.();
  }
}

function needsAnimation() {
  if (!state.inView || document.hidden || state.route === 'plain') return false;
  if (state.mode === 'wobbly') {
    const wantMin = state.minimized ? 1 : 0;
    if (Math.abs(state.minimizeT - wantMin) > 0.002) return true;
    if (state.drag?.kind === 'wobbly') return true;
    return !state.grid.settled;
  }
  if (state.drag?.kind === 'cube') return true;
  if (state.autoSpin && !reducedMotion?.matches) return true;
  if (state.targetYaw !== null || state.targetPitch !== null) return true;
  return Math.abs(state.yawVel) > 0.004 || Math.abs(state.pitchVel) > 0.004;
}

function wakeAnim() {
  if (state.rafId || !needsAnimation()) return;
  state.lastTime = performance.now();
  state.rafId = requestAnimationFrame(tickAnim);
}

function stopAnim() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
}

function shortestAngleDiff(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function tickAnim(now) {
  state.rafId = 0;
  const dt = Math.min(0.05, Math.max(0.001, (now - state.lastTime) / 1000));
  state.lastTime = now;

  if (state.mode === 'wobbly') {
    const { cw, ch } = stageMetrics();
    const wantMin = state.minimized ? 1 : 0;
    if (Math.abs(state.minimizeT - wantMin) > 0.002) {
      const rate = reducedMotion?.matches ? 12 : 3.2;
      const step = rate * dt;
      if (state.minimizeT < wantMin) state.minimizeT = Math.min(wantMin, state.minimizeT + step);
      else state.minimizeT = Math.max(wantMin, state.minimizeT - step);
      if (state.minimizeT === 0 && !state.minimized && !reducedMotion?.matches) {
        state.grid.applyImpulse(0, -180, 90);
      }
      syncInertState();
    }
    state.grid.step(dt, {
      stiffness: state.stiffness,
      friction: state.friction,
      elastic: state.elastic && !reducedMotion?.matches,
      edgeBounce: state.edgeBounce,
      bounds: { w: cw, h: ch },
    });
  } else {
    if (state.drag?.kind !== 'cube') {
      if (state.targetYaw !== null) {
        const dy = shortestAngleDiff(state.yaw, state.targetYaw);
        const dp = (state.targetPitch ?? -0.14) - state.pitch;
        if (reducedMotion?.matches || (Math.abs(dy) < 0.004 && Math.abs(dp) < 0.004)) {
          state.yaw = state.targetYaw;
          state.pitch = state.targetPitch ?? -0.14;
          state.targetYaw = null;
          state.targetPitch = null;
        } else {
          const ease = 1 - Math.exp(-9.5 * dt);
          state.yaw += dy * ease;
          state.pitch += dp * ease;
        }
      } else if (state.autoSpin && !reducedMotion?.matches) {
        state.yaw -= 0.58 * dt;
        state.pitch += (-0.16 - state.pitch) * (1 - Math.exp(-3.5 * dt));
      } else {
        const damp = Math.exp(-4.2 * dt);
        state.yaw += state.yawVel * dt;
        state.pitch = Math.max(-0.56, Math.min(0.56, state.pitch + state.pitchVel * dt));
        state.yawVel *= damp;
        state.pitchVel *= damp;
        if (Math.abs(state.yawVel) < 0.004) state.yawVel = 0;
        if (Math.abs(state.pitchVel) < 0.004) state.pitchVel = 0;
      }
    }
  }

  requestRepaint();
  if (needsAnimation()) {
    state.rafId = requestAnimationFrame(tickAnim);
  }
}

function updateClockText() {
  const el = document.getElementById('ws3-clock');
  if (!el) return;
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  el.textContent = `${hh}:${mm}:${ss}`;
}

function syncClockTimer() {
  const want = state.mode === 'cube' && state.inView && !document.hidden && state.route !== 'plain';
  if (want && !state.clockTimer) {
    updateClockText();
    state.clockTimer = setInterval(() => {
      updateClockText();
      requestRepaint();
    }, 1000);
  } else if (!want && state.clockTimer) {
    clearInterval(state.clockTimer);
    state.clockTimer = 0;
  }
}

function updateTelemetry(text) {
  if (telemetryEl && text !== state.lastTelemetry) {
    state.lastTelemetry = text;
    telemetryEl.textContent = text;
  }
}

function syncWsButtons() {
  for (const btn of wsJumpBtns) {
    btn.setAttribute('aria-pressed', String(Number(btn.dataset.ws) === state.frontWs));
  }
}

// --- WebGL 2 Rendering (one ElementGL context) ---
function drawWobblyWebGL(gl, cw, ch) {
  syncWindowDimensions();
  const winW = wobblyWin.offsetWidth || state.grid.winW;
  const winH = wobblyWin.offsetHeight || state.grid.winH;
  const tex = stage.upload(wobblyWin);
  if (tex) textures.set(wobblyWin, tex);

  const dockX = cw * 0.5;
  const dockY = ch - 18;
  state.grid.fillControls(ctrlBuf, state.minimizeT, dockX, dockY);
  const center = state.grid.centroid();

  // Pass 1: 2006 Compiz desktop wallpaper.
  gl.useProgram(gpu.bg.prog);
  gl.bindVertexArray(gpu.quadVao);
  gl.uniform2f(gpu.bg.u('uCanvas'), cw, ch);
  gl.uniform1f(gpu.bg.u('uMode'), 0.0);
  gl.uniform1f(gpu.bg.u('uTheme'), state.theme);
  gl.uniform1f(gpu.bg.u('uGlow'), state.glow);
  gl.uniform2f(gpu.bg.u('uSpot'), center.x, center.y);
  gl.uniform1f(gpu.bg.u('uHorizon'), 0.62);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const alpha = Math.max(0, 1 - state.minimizeT * 0.96);
  const handle = textures.get(wobblyWin);
  if (handle && alpha > 0.01) {
    gl.useProgram(gpu.wobbly.prog);
    gl.bindVertexArray(gpu.meshVao);
    gl.uniform2f(gpu.wobbly.u('uCanvas'), cw, ch);
    gl.uniform2fv(gpu.wobbly.u('uCtrl'), ctrlBuf);
    gl.uniform2f(gpu.wobbly.u('uRestSize'), winW, winH);
    gl.uniform1f(gpu.wobbly.u('uAlpha'), alpha);
    gl.uniform1f(gpu.wobbly.u('uGlow'), state.glow);

    // Drop shadow underneath deformed Bezier window.
    gl.uniform1i(gpu.wobbly.u('uPass'), 0);
    gl.uniform2f(gpu.wobbly.u('uOffset'), 10, 16);
    gl.drawElements(gl.TRIANGLES, gpu.triCount, gl.UNSIGNED_SHORT, 0);

    // Live HTML window drawn across the 20x20 Bezier triangle mesh.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, handle.tex);
    gl.uniform1i(gpu.wobbly.u('uTex'), 0);
    gl.uniform1i(gpu.wobbly.u('uPass'), 1);
    gl.uniform2f(gpu.wobbly.u('uOffset'), 0, 0);
    gl.drawElements(gl.TRIANGLES, gpu.triCount, gl.UNSIGNED_SHORT, 0);

    // Optional wireframe overlay (20x20 mesh + 4x4 spring control cage).
    if (state.wireframe) {
      gl.bindVertexArray(gpu.wireVao);
      gl.uniform1i(gpu.wobbly.u('uPass'), 2);
      gl.uniform2f(gpu.wobbly.u('uOffset'), 0, 0);
      gl.uniform4f(gpu.wobbly.u('uWireColor'), 0.34, 0.88, 1.0, 0.52);
      gl.drawElements(gl.LINES, gpu.wireCount, gl.UNSIGNED_SHORT, 0);

      let ci = 0;
      for (let j = 0; j < GRID_N; j++) {
        for (let i = 0; i < GRID_N - 1; i++) {
          const a = (j * GRID_N + i) * 2;
          const b = (j * GRID_N + i + 1) * 2;
          cageLinesBuf[ci++] = ctrlBuf[a]; cageLinesBuf[ci++] = ctrlBuf[a + 1];
          cageLinesBuf[ci++] = ctrlBuf[b]; cageLinesBuf[ci++] = ctrlBuf[b + 1];
        }
      }
      for (let j = 0; j < GRID_N - 1; j++) {
        for (let i = 0; i < GRID_N; i++) {
          const a = (j * GRID_N + i) * 2;
          const b = ((j + 1) * GRID_N + i) * 2;
          cageLinesBuf[ci++] = ctrlBuf[a]; cageLinesBuf[ci++] = ctrlBuf[a + 1];
          cageLinesBuf[ci++] = ctrlBuf[b]; cageLinesBuf[ci++] = ctrlBuf[b + 1];
        }
      }
      gl.useProgram(gpu.cage.prog);
      gl.bindVertexArray(gpu.cageVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.cageVbo);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, cageLinesBuf);
      gl.uniform2f(gpu.cage.u('uCanvas'), cw, ch);
      gl.uniform1f(gpu.cage.u('uPointSize'), 7.0);
      gl.uniform4f(gpu.cage.u('uColor'), 1.0, 0.62, 0.24, 0.90);
      gl.drawArrays(gl.LINES, 0, 48);

      gl.bufferSubData(gl.ARRAY_BUFFER, 0, ctrlBuf);
      gl.uniform4f(gpu.cage.u('uColor'), 1.0, 0.90, 0.45, 0.96);
      gl.drawArrays(gl.POINTS, 0, 16);
      if (state.grid.grabIndex >= 0) {
        gl.uniform1f(gpu.cage.u('uPointSize'), 12.0);
        gl.uniform4f(gpu.cage.u('uColor'), 1.0, 0.28, 0.18, 1.0);
        gl.drawArrays(gl.POINTS, state.grid.grabIndex, 1);
      }
    }
  }

  // Sync live affine hit box via updateElementGeometry().
  if (state.minimizeT > 0.35) {
    try { canvas.updateElementGeometry?.(wobblyWin, { canvasTransform: OFFSTAGE }); } catch {}
    bumpHitTick(wobblyWin, 'minimized');
  } else {
    const unit = geometryUnit(canvas, wobblyWin, winW);
    const hitMat = wobblyHitMatrix(ctrlBuf, winW, winH, unit);
    try { canvas.updateElementGeometry?.(wobblyWin, { canvasTransform: hitMat }); } catch {}
    const key = `${ctrlBuf[0].toFixed(1)},${ctrlBuf[1].toFixed(1)},${ctrlBuf[6].toFixed(1)},${ctrlBuf[7].toFixed(1)},${ctrlBuf[24].toFixed(1)},${ctrlBuf[25].toFixed(1)},${Math.round(cw)}x${Math.round(ch)}`;
    bumpHitTick(wobblyWin, key);
  }
  for (const ws of wsEls) {
    try { canvas.updateElementGeometry?.(ws, { canvasTransform: OFFSTAGE }); } catch {}
  }

  const statusText = state.minimized
    ? 'WebGL 2 | Window minimised to dock | Press Restore window'
    : `WebGL 2 | 4x4 Bezier -> 20x20 mesh (800 tris) | corner lag ${state.grid.maxLag.toFixed(1)} px | k=${state.stiffness.toFixed(1)} f=${state.friction.toFixed(1)}`;
  updateTelemetry(statusText);
}

// #region cube-render
function drawCubePass(gl, progObj, faces, modelMat, viewMat, vpMat, camPos, reflect, frontWs) {
  const sorted = faces.map((f) => {
    const wp = mulVec3Point(modelMat, f.center);
    if (reflect) wp[1] = 2 * FLOOR_Y - wp[1];
    const vp = mulVec3Point(viewMat, wp);
    return { f, viewZ: vp[2] };
  });
  // Convex cube: sorting ascending by camera-space Z draws back faces first,
  // caps next, and front faces last for exact premultiplied translucency.
  sorted.sort((a, b) => a.viewZ - b.viewZ);

  gl.useProgram(progObj.prog);
  gl.bindVertexArray(gpu.quadVao);
  gl.uniformMatrix4fv(progObj.u('uModel'), false, modelMat);
  gl.uniformMatrix4fv(progObj.u('uVP'), false, vpMat);
  gl.uniform3f(progObj.u('uCamPos'), camPos[0], camPos[1], camPos[2]);
  gl.uniform1f(progObj.u('uAlpha'), state.opacity);
  gl.uniform1f(progObj.u('uReflect'), reflect ? 1.0 : 0.0);
  gl.uniform1f(progObj.u('uFloorY'), FLOOR_Y);
  gl.uniform1f(progObj.u('uRimGlow'), state.rimGlow);

  for (const { f } of sorted) {
    gl.uniform1i(progObj.u('uKind'), f.kind);
    gl.uniform3f(progObj.u('uOrigin'), f.origin[0], f.origin[1], f.origin[2]);
    gl.uniform3f(progObj.u('uAxisU'), f.axisU[0], f.axisU[1], f.axisU[2]);
    gl.uniform3f(progObj.u('uAxisV'), f.axisV[0], f.axisV[1], f.axisV[2]);
    gl.uniform3f(progObj.u('uNormal'), f.normal[0], f.normal[1], f.normal[2]);
    gl.uniform3f(progObj.u('uAccent'), f.accent[0], f.accent[1], f.accent[2]);
    gl.uniform1f(progObj.u('uIsFront'), f.wsIndex === frontWs ? 1.0 : 0.0);
    if (f.kind === 0) {
      const handle = textures.get(wsEls[f.wsIndex]);
      if (!handle) continue;
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, handle.tex);
      gl.uniform1i(progObj.u('uTex'), 0);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
// #endregion cube-render

function cubeCamera(cw, ch) {
  const aspect = cw / Math.max(ch, 1);
  const camDist = aspect < 1 ? 4.55 / Math.max(0.68, aspect * 1.02) : 4.45;
  const camPos = [0, 0.28, camDist];
  const camTarget = [0, -0.22, 0];
  const viewMat = mat4LookAt(camPos, camTarget, [0, 1, 0]);
  const projMat = mat4Perspective((42 * Math.PI) / 180, aspect, 0.1, 40);
  const vpMat = mat4Mul(projMat, viewMat);
  const modelMat = mat4Mul(
    mat4Translate(0, CUBE_LIFT_Y, 0),
    mat4Mul(mat4RotateX(state.pitch), mat4RotateY(state.yaw)),
  );
  return { camPos, viewMat, vpMat, modelMat };
}

function drawCubeWebGL(gl, cw, ch) {
  for (const ws of wsEls) {
    const tex = stage.upload(ws);
    if (tex) textures.set(ws, tex);
  }

  const { camPos, viewMat, vpMat, modelMat } = cubeCamera(cw, ch);

  // Pick the frontmost workspace face by outward camera-space normal Z.
  let bestWs = 0;
  let bestNz = -Infinity;
  for (let i = 0; i < 4; i++) {
    const wn = mulVec3Dir(modelMat, CUBE_FACES[i].normal);
    const vn = mulVec3Dir(viewMat, wn);
    if (vn[2] > bestNz) { bestNz = vn[2]; bestWs = i; }
  }
  if (state.frontWs !== bestWs) {
    state.frontWs = bestWs;
    syncWsButtons();
  }
  syncInertState();

  // Compute screen horizon Y where the floor plane sits behind the cube.
  const floorPt = [0, FLOOR_Y, -3.5];
  const fClipX = vpMat[0] * floorPt[0] + vpMat[4] * floorPt[1] + vpMat[8] * floorPt[2] + vpMat[12];
  const fClipY = vpMat[1] * floorPt[0] + vpMat[5] * floorPt[1] + vpMat[9] * floorPt[2] + vpMat[13];
  const fClipW = vpMat[3] * floorPt[0] + vpMat[7] * floorPt[1] + vpMat[11] * floorPt[2] + vpMat[15];
  void fClipX;
  const horizonUvY = 0.5 - 0.5 * (fClipY / Math.max(fClipW, 0.001));

  // Pass 1: Compiz skydome and glossy reflective floor.
  gl.useProgram(gpu.bg.prog);
  gl.bindVertexArray(gpu.quadVao);
  gl.uniform2f(gpu.bg.u('uCanvas'), cw, ch);
  gl.uniform1f(gpu.bg.u('uMode'), 1.0);
  gl.uniform1f(gpu.bg.u('uTheme'), state.theme);
  gl.uniform1f(gpu.bg.u('uGlow'), state.rimGlow);
  gl.uniform2f(gpu.bg.u('uSpot'), cw * 0.5, ch * 0.4);
  gl.uniform1f(gpu.bg.u('uHorizon'), horizonUvY);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  // Pass 2: Real-time mirrored floor reflection.
  if (state.showReflection) {
    drawCubePass(gl, gpu.cube, CUBE_FACES, modelMat, viewMat, vpMat, camPos, true, bestWs);
  }

  // Pass 3: Translucent 4-face 3D Desktop Cube + caps.
  drawCubePass(gl, gpu.cube, CUBE_FACES, modelMat, viewMat, vpMat, camPos, false, bestWs);

  // Update projective hit geometry on the frontmost face; park the rest offstage.
  try { canvas.updateElementGeometry?.(wobblyWin, { canvasTransform: OFFSTAGE }); } catch {}
  for (let i = 0; i < 4; i++) {
    const ws = wsEls[i];
    if (i === bestWs && bestNz > 0.25) {
      const elW = ws.offsetWidth || 300;
      const elH = ws.offsetHeight || 236;
      const unit = geometryUnit(canvas, ws, elW);
      const projHit = cubeProjectiveMatrix(CUBE_FACES[i], elW, elH, modelMat, vpMat, cw, ch, unit);
      try { canvas.updateElementGeometry?.(ws, { canvasTransform: projHit }); } catch {}
      const key = `${state.yaw.toFixed(3)},${state.pitch.toFixed(3)},${Math.round(cw)}x${Math.round(ch)}`;
      bumpHitTick(ws, key);
    } else {
      try { canvas.updateElementGeometry?.(ws, { canvasTransform: OFFSTAGE }); } catch {}
    }
  }

  const yawDeg = Math.round((((-state.yaw * 180) / Math.PI) % 360 + 360) % 360);
  const pitchDeg = Math.round((state.pitch * 180) / Math.PI);
  updateTelemetry(`WebGL 2 | Front: Workspace ${bestWs + 1}/4 | yaw ${yawDeg} deg, pitch ${pitchDeg} deg | opacity ${Math.round(state.opacity * 100)}%`);
}

function drawSceneWebGL() {
  if (!stage || stage.lost || state.route !== 'webgl' || !state.inView) return;
  const { cw, ch } = stageMetrics();
  if (cw < 4 || ch < 4) return;
  if (!stage.begin([0, 0, 0, 1])) return;

  const gl = stage.gl;
  const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
  if (!gpu && !gl.isContextLost()) gpu = buildGpuResources(gl);
  if (!gpu) return;

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  if (state.mode === 'wobbly') {
    drawWobblyWebGL(gl, cw, ch);
  } else {
    drawCubeWebGL(gl, cw, ch);
  }

  gl.useProgram(prevProg);
  gl.bindVertexArray(prevVao);
}

// --- 2D Canvas Fallback Renderer (5-argument drawElementImage) ---
function drawScene2D() {
  if (!ctx2d || state.route !== '2d' || !state.inView) return;
  const { cw, ch } = stageMetrics();
  if (cw < 4 || ch < 4) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }

  const ctx = ctx2d;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#141d36');
  grad.addColorStop(1, '#080a12');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  if (state.mode === 'wobbly') {
    syncWindowDimensions();
    const winW = wobblyWin.offsetWidth || state.grid.winW;
    const winH = wobblyWin.offsetHeight || state.grid.winH;
    state.grid.fillControls(ctrlBuf, state.minimizeT, cw * 0.5, ch - 18);
    const tlx = ctrlBuf[0], tly = ctrlBuf[1];
    const trx = ctrlBuf[6], try_ = ctrlBuf[7];
    const blx = ctrlBuf[24], bly = ctrlBuf[25];
    const brx = ctrlBuf[30], bry = ctrlBuf[31];
    const cx = 0.25 * (tlx + trx + blx + brx);
    const cy = 0.25 * (tly + try_ + bly + bry);
    const exX = ((trx - tlx) + (brx - blx)) / (2 * winW);
    const exY = ((try_ - tly) + (bry - bly)) / (2 * winW);
    const eyX = ((blx - tlx) + (brx - trx)) / (2 * winH);
    const eyY = ((bly - tly) + (bry - try_)) / (2 * winH);
    const ox = cx - 0.5 * winW * exX - 0.5 * winH * eyX;
    const oy = cy - 0.5 * winW * exY - 0.5 * winH * eyY;
    const alpha = Math.max(0, 1 - state.minimizeT * 0.96);

    if (alpha > 0.02) {
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.transform(exX, exY, eyX, eyY, ox, oy);
      ctx.drawElementImage(wobblyWin, 0, 0, winW, winH);
      ctx.restore();

      if (state.wireframe) {
        ctx.save();
        ctx.strokeStyle = 'rgba(90, 225, 255, 0.65)';
        ctx.lineWidth = 1;
        for (let r = 0; r <= 8; r++) {
          ctx.beginPath();
          for (let c = 0; c <= 12; c++) {
            const p = state.grid.evalBezier(c / 12, r / 8, ctrlBuf);
            if (c === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
          }
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    updateTelemetry(`2D fallback | sheared 4-corner drawElementImage() | corner lag ${state.grid.maxLag.toFixed(1)} px`);
    return;
  }

  // 2D projected cube fallback.
  const order = [];
  let bestWs = 0;
  let bestCos = -Infinity;
  for (let i = 0; i < 4; i++) {
    const ang = state.yaw + i * (Math.PI * 0.5);
    const nz = Math.cos(ang);
    const nx = Math.sin(ang);
    if (nz > bestCos) { bestCos = nz; bestWs = i; }
    order.push({ i, nz, nx });
  }
  state.frontWs = bestWs;
  syncWsButtons();
  syncInertState();
  order.sort((a, b) => a.nz - b.nz);

  for (const { i, nz, nx } of order) {
    const ws = wsEls[i];
    const elW = ws.offsetWidth || 300;
    const elH = ws.offsetHeight || 236;
    const scaleX = Math.abs(nz) * 0.82;
    if (scaleX < 0.04) continue;
    const drawW = elW * scaleX;
    const drawH = elH * (0.80 + 0.08 * nz);
    const px = cw * 0.5 + nx * (elW * 0.44) - drawW * 0.5;
    const py = ch * 0.44 - drawH * 0.5;

    ctx.save();
    ctx.globalAlpha = state.opacity * (nz > 0 ? 1 : 0.45);
    ctx.translate(px, py);
    ctx.scale(drawW / elW, drawH / elH);
    ctx.drawElementImage(ws, 0, 0, elW, elH);
    ctx.restore();
  }
  updateTelemetry(`2D fallback | Front: Workspace ${bestWs + 1}/4 | opacity ${Math.round(state.opacity * 100)}%`);
}

// --- Plain HTML Fallback (no HTML-in-canvas or lost GPU context) ---
function enterPlainFallback(reason) {
  if (state.route === 'plain') {
    setStatus(reason);
    return;
  }
  stopAnim();
  state.route = 'plain';
  syncClockTimer();
  stageBox.classList.add('fallback');
  canvas.hidden = true;
  dockRestoreBtn.hidden = true;
  fallbackDeck.hidden = false;
  wobblyWin.inert = false;
  wobblyWin.style.width = '';
  fallbackDeck.append(wobblyWin);
  for (const ws of wsEls) {
    ws.inert = false;
    fallbackDeck.append(ws);
  }
  setStatus(reason);
  updateTelemetry('Plain HTML fallback active: all five windows stay live below.');
}

function leavePlainFallback(nextRoute) {
  state.route = nextRoute;
  stageBox.classList.remove('fallback');
  canvas.hidden = false;
  fallbackDeck.hidden = true;
  canvas.append(wobblyWin);
  for (const ws of wsEls) canvas.append(ws);
  setStatus('');
  syncInertState();
  syncClockTimer();
  requestRepaint();
}

// --- Mode switching and window/cube controls ---
function setMode(next) {
  if (state.mode === next) return;
  state.mode = next;
  state.drag = null;
  canvas.classList.remove('dragging');
  modeWobblyBtn.setAttribute('aria-pressed', String(next === 'wobbly'));
  modeCubeBtn.setAttribute('aria-pressed', String(next === 'cube'));
  controlsWobbly.hidden = next !== 'wobbly';
  controlsCube.hidden = next !== 'cube';
  dockRestoreBtn.hidden = next !== 'wobbly' || !state.minimized;
  syncInertState();
  syncClockTimer();
  requestRepaint();
  wakeAnim();
}

function toggleMinimize() {
  state.minimized = !state.minimized;
  minBtn.textContent = state.minimized ? 'Restore window' : 'Minimise';
  dockRestoreBtn.hidden = state.mode !== 'wobbly' || !state.minimized || state.route === 'plain';
  syncInertState();
  wakeAnim();
  requestRepaint();
}

function triggerShake() {
  if (state.minimized) toggleMinimize();
  const dir = Math.random() < 0.5 ? 1 : -1;
  state.grid.applyImpulse(dir * 780, -240, dir * 420);
  wakeAnim();
  requestRepaint();
}

function jumpToWorkspace(idx) {
  state.autoSpin = false;
  spinBtn.setAttribute('aria-pressed', 'false');
  state.yawVel = 0;
  state.pitchVel = 0;
  state.targetYaw = -idx * (Math.PI * 0.5);
  state.targetPitch = -0.14;
  wakeAnim();
  requestRepaint();
}

modeWobblyBtn?.addEventListener('click', () => setMode('wobbly'));
modeCubeBtn?.addEventListener('click', () => setMode('cube'));

flingBtn?.addEventListener('click', triggerShake);
minBtn?.addEventListener('click', toggleMinimize);
dockRestoreBtn?.addEventListener('click', toggleMinimize);
centreBtn?.addEventListener('click', () => {
  if (state.minimized) toggleMinimize();
  const { cw, ch } = stageMetrics();
  const elW = wobblyWin.offsetWidth || state.grid.winW;
  const elH = wobblyWin.offsetHeight || state.grid.winH;
  state.grid.reset(Math.round((cw - elW) * 0.5), Math.round((ch - elH) * 0.44), elW, elH);
  requestRepaint();
});

stiffnessRange?.addEventListener('input', () => {
  state.stiffness = Number(stiffnessRange.value);
  stiffnessOut.textContent = state.stiffness.toFixed(1);
});
frictionRange?.addEventListener('input', () => {
  state.friction = Number(frictionRange.value);
  frictionOut.textContent = state.friction.toFixed(1);
});
wireframeChk?.addEventListener('change', () => {
  state.wireframe = !!wireframeChk.checked;
  requestRepaint();
});

for (const btn of wsJumpBtns) {
  btn.addEventListener('click', () => jumpToWorkspace(Number(btn.dataset.ws)));
}
spinBtn?.addEventListener('click', () => {
  state.autoSpin = !state.autoSpin;
  state.targetYaw = null;
  state.targetPitch = null;
  spinBtn.setAttribute('aria-pressed', String(state.autoSpin));
  wakeAnim();
});
cubeResetBtn?.addEventListener('click', () => {
  state.autoSpin = false;
  spinBtn.setAttribute('aria-pressed', 'false');
  state.yawVel = 0;
  state.pitchVel = 0;
  state.targetYaw = -0.34;
  state.targetPitch = -0.16;
  wakeAnim();
});
opacityRange?.addEventListener('input', () => {
  const pct = Number(opacityRange.value);
  state.opacity = pct / 100;
  opacityOut.textContent = `${pct}%`;
  requestRepaint();
});
reflectChk?.addEventListener('change', () => {
  state.showReflection = !!reflectChk.checked;
  requestRepaint();
});

// Wire live interactive HTML controls inside the five drawable windows.
function wireWindowControls() {
  const winShakeBtn = document.getElementById('win-shake-btn');
  const winMinBtn = document.getElementById('win-min-btn');
  const winBodyShake = document.getElementById('win-body-shake');
  const winPingBtn = document.getElementById('win-ping-btn');
  const winPingOut = document.getElementById('win-ping-out');
  const winGlow = document.getElementById('win-glow');
  const winGlowOut = document.getElementById('win-glow-out');
  const winChkJelly = document.getElementById('win-chk-jelly');
  const winChkEdge = document.getElementById('win-chk-edge');
  const winCmd = document.getElementById('win-cmd');

  let pings = 0;
  winPingBtn?.addEventListener('click', () => {
    pings++;
    winPingOut.textContent = `${pings} ${pings === 1 ? 'ping' : 'pings'}`;
    if (state.mode === 'wobbly' && state.elastic && !reducedMotion?.matches) {
      state.grid.applyImpulse(160 * (pings % 2 ? 1 : -1), -90, 80);
      wakeAnim();
    }
    requestRepaint();
  });
  winShakeBtn?.addEventListener('click', triggerShake);
  winBodyShake?.addEventListener('click', triggerShake);
  winMinBtn?.addEventListener('click', toggleMinimize);
  winGlow?.addEventListener('input', () => {
    const v = Number(winGlow.value);
    state.glow = v / 100;
    winGlowOut.textContent = `${v}%`;
    requestRepaint();
  });
  winChkJelly?.addEventListener('change', () => {
    state.elastic = !!winChkJelly.checked;
    requestRepaint();
  });
  winChkEdge?.addEventListener('change', () => {
    state.edgeBounce = !!winChkEdge.checked;
  });
  winCmd?.addEventListener('input', () => requestRepaint());

  // Workspace 1: Notes
  let stamps = 0;
  const ws0Stamp = document.getElementById('ws0-stamp');
  const ws0Count = document.getElementById('ws0-count');
  ws0Stamp?.addEventListener('click', () => {
    stamps++;
    ws0Count.textContent = `${stamps} ${stamps === 1 ? 'stamp' : 'stamps'}`;
    requestRepaint();
  });
  document.getElementById('ws0-title')?.addEventListener('input', () => requestRepaint());
  document.getElementById('ws0-note')?.addEventListener('input', () => requestRepaint());

  // Workspace 2: Mixer
  const bindSlider = (id, outId, onVal) => {
    const el = document.getElementById(id);
    const out = document.getElementById(outId);
    el?.addEventListener('input', () => {
      const v = Number(el.value);
      if (out) out.textContent = `${v}%`;
      onVal?.(v);
      requestRepaint();
    });
  };
  bindSlider('ws1-master', 'ws1-master-out');
  bindSlider('ws1-synth', 'ws1-synth-out');
  bindSlider('ws1-rim', 'ws1-rim-out', (v) => { state.rimGlow = v / 100; });
  const ws1Mute = document.getElementById('ws1-mute');
  const ws1State = document.getElementById('ws1-state');
  ws1Mute?.addEventListener('change', () => {
    ws1State.textContent = ws1Mute.checked ? 'Muted' : 'ALSA live';
    requestRepaint();
  });

  // Workspace 3: Checklist
  const ws2Items = Array.from(document.querySelectorAll('.ws2-item'));
  const ws2Fill = document.getElementById('ws2-meter-fill');
  const ws2Out = document.getElementById('ws2-out');
  const ws2Toggle = document.getElementById('ws2-toggle');
  const syncWs2 = () => {
    const done = ws2Items.filter((c) => c.checked).length;
    ws2Fill.style.width = `${Math.round((done / ws2Items.length) * 100)}%`;
    ws2Out.textContent = `${done}/${ws2Items.length} ready`;
    requestRepaint();
  };
  for (const c of ws2Items) c.addEventListener('change', syncWs2);
  ws2Toggle?.addEventListener('click', () => {
    const allChecked = ws2Items.every((c) => c.checked);
    for (const c of ws2Items) c.checked = !allChecked;
    syncWs2();
  });

  // Workspace 4: Theme & Clock
  const themeNames = ['Beryl indigo', 'Aubergine', 'Emerald'];
  const ws3Btns = Array.from(document.querySelectorAll('.ws3-theme'));
  const ws3Out = document.getElementById('ws3-out');
  const ws3Ping = document.getElementById('ws3-ping');
  for (const btn of ws3Btns) {
    btn.addEventListener('click', () => {
      state.theme = Number(btn.dataset.theme) || 0;
      for (const b of ws3Btns) b.classList.toggle('active-theme', b === btn);
      ws3Out.textContent = themeNames[state.theme] ?? 'Beryl indigo';
      requestRepaint();
    });
  }
  ws3Ping?.addEventListener('click', () => {
    updateClockText();
    requestRepaint();
  });
}

// --- Pointer dragging for Wobbly window and 3D Cube ---
function isLiveControl(el) {
  return !!el?.closest?.('button, input, textarea, select, label, a');
}

function pointInWindowBounds(px, py) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of state.grid.nodes) {
    if (n.x < minX) minX = n.x;
    if (n.x > maxX) maxX = n.x;
    if (n.y < minY) minY = n.y;
    if (n.y > maxY) maxY = n.y;
  }
  return px >= minX - 18 && px <= maxX + 18 && py >= minY - 18 && py <= maxY + 18;
}

canvas.addEventListener('pointerdown', (e) => {
  if (state.route === 'plain' || e.button > 0) return;
  if (isLiveControl(e.target)) return;

  const rect = canvas.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;

  if (state.mode === 'wobbly') {
    if (state.minimized) return;
    const onTitlebar = !!e.target?.closest?.('.cwin-titlebar');
    const nearWin = onTitlebar || !!e.target?.closest?.('#wobbly-win') || pointInWindowBounds(px, py);
    if (!nearWin) return;
    state.grid.grabNearest(px, py);
    state.drag = {
      kind: 'wobbly',
      pointerId: e.pointerId,
      lastX: px,
      lastY: py,
      lastT: performance.now(),
      vx: 0,
      vy: 0,
    };
    canvas.classList.add('dragging');
    wakeAnim();
    requestRepaint();
    return;
  }

  // 3D Cube mode drag (wait 5 px before grabbing so short clicks pass through).
  state.autoSpin = false;
  spinBtn.setAttribute('aria-pressed', 'false');
  state.targetYaw = null;
  state.targetPitch = null;
  state.yawVel = 0;
  state.pitchVel = 0;
  state.drag = {
    kind: 'cube',
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    lastX: e.clientX,
    lastY: e.clientY,
    lastT: performance.now(),
    moved: false,
  };
});

window.addEventListener('pointermove', (e) => {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  const now = performance.now();
  const dt = Math.max(0.004, (now - d.lastT) / 1000);

  if (d.kind === 'wobbly') {
    const rect = canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const instVx = (px - d.lastX) / dt;
    const instVy = (py - d.lastY) / dt;
    d.vx = d.vx * 0.55 + instVx * 0.45;
    d.vy = d.vy * 0.55 + instVy * 0.45;
    d.lastX = px;
    d.lastY = py;
    d.lastT = now;
    const { cw, ch } = stageMetrics();
    state.grid.moveGrab(px, py, { w: cw, h: ch });
    wakeAnim();
    requestRepaint();
    return;
  }

  const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
  if (!d.moved && dist >= 5) {
    d.moved = true;
    canvas.classList.add('dragging');
  }
  if (!d.moved) return;

  const dx = e.clientX - d.lastX;
  const dy = e.clientY - d.lastY;
  d.lastX = e.clientX;
  d.lastY = e.clientY;
  d.lastT = now;

  const { cw, ch } = stageMetrics();
  const dYaw = (dx / Math.max(cw, 220)) * 3.1;
  const dPitch = (dy / Math.max(ch, 220)) * 2.1;
  state.yaw += dYaw;
  state.pitch = Math.max(-0.56, Math.min(0.56, state.pitch + dPitch));
  state.yawVel = state.yawVel * 0.45 + (dYaw / dt) * 0.55;
  state.pitchVel = state.pitchVel * 0.45 + (dPitch / dt) * 0.55;
  requestRepaint();
});

function endDrag(e) {
  const d = state.drag;
  if (!d || e.pointerId !== d.pointerId) return;
  state.drag = null;
  canvas.classList.remove('dragging');
  if (d.kind === 'wobbly') {
    state.grid.releaseGrab(d.vx, d.vy);
    wakeAnim();
    requestRepaint();
  } else if (d.moved) {
    wakeAnim();
  }
}

window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// Pause offscreen via IntersectionObserver and visibilitychange.
if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver(([entry]) => {
    state.inView = !!entry?.isIntersecting;
    syncClockTimer();
    if (state.inView) {
      wakeAnim();
      requestRepaint();
    } else {
      stopAnim();
    }
  }, { rootMargin: '120px' });
  io.observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  syncClockTimer();
  if (document.hidden) {
    stopAnim();
  } else if (state.inView) {
    wakeAnim();
    requestRepaint();
  }
});

wireWindowControls();
updateClockText();
syncInertState();

// Boot the single ElementGL context, 2D 5-arg fallback, or plain HTML fallback.
if (glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: PASSTHROUGH_FRAG,
      onLost() {
        gpu = null;
        textures.clear();
        enterPlainFallback('The WebGL 2 context was lost. All five windows moved to plain HTML so your controls stay usable.');
      },
      onRestored() {
        gpu = null;
        textures.clear();
        leavePlainFallback('webgl');
      },
    });
    state.route = 'webgl';
    canvas.addEventListener('paint', drawSceneWebGL);
    canvas.requestPaint?.();
  } catch (err) {
    enterPlainFallback(`Could not start ElementGL (${err?.message ?? err}). Showing all five windows as plain HTML.`);
  }
} else if (canvas2dSupported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.route = '2d';
    setStatus('WebGL 2 texElementSubImage2D() is not available here, so this page is drawing through the 2D 5-argument drawElementImage() fallback.');
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      enterPlainFallback('The 2D canvas context was lost. All five windows moved to plain HTML.');
    });
    canvas.addEventListener('contextrestored', () => {
      leavePlainFallback('2d');
    });
    canvas.addEventListener('paint', drawScene2D);
    canvas.requestPaint?.();
  } else {
    enterPlainFallback('Could not open a 2D canvas context. Showing all five windows as plain HTML.');
  }
} else {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the five live windows are shown as plain HTML.');
}

// --- Live checks (tap-gated via <meta name="checks" content="tap">) ---
const tbody = document.getElementById('results');

const checks = [
  {
    name: 'ElementGL + texElementSubImage2D() uploads and draws the tessellated 20x20 spring-mesh window',
    why: 'Creates an isolated drawable canvas on testStage(), uploads a live HTML window via ElementGL.upload(), renders the 20x20 Bezier triangle mesh with a sheared control grid, checks gl.getError() === 0, and samples pixels once.',
    run: async () => {
      if (!glSupported) throw new Error('texElementSubImage2D() is not supported in this browser');
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:240px;height:200px;';
      const win = document.createElement('div');
      win.setAttribute('drawable', '');
      win.style.cssText = 'position:absolute;left:0;top:0;width:136px;height:96px;background:#d8642c;color:#fff;font:700 14px system-ui;padding:10px;border-radius:8px;';
      win.textContent = 'Compiz 20x20';
      c.append(win);
      box.append(c);

      const fx = new ElementGL(c, {
        fragment: PASSTHROUGH_FRAG,
        attributes: { preserveDrawingBuffer: true },
      });
      const localGpu = buildGpuResources(fx.gl);
      const grid = new WobblyGrid(48, 52, 136, 96);
      grid.applyImpulse(420, -120, 180);
      grid.step(0.04, { stiffness: 5.5, friction: 3.0 });
      const localCtrl = grid.fillControls(new Float32Array(32));
      let glErr = 0;

      const drawFixture = () => {
        const tex = fx.upload(win);
        if (!fx.begin([0, 0, 0, 0]) || !tex) return;
        const gl = fx.gl;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(localGpu.wobbly.prog);
        gl.bindVertexArray(localGpu.meshVao);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, tex.tex);
        gl.uniform1i(localGpu.wobbly.u('uTex'), 0);
        gl.uniform2f(localGpu.wobbly.u('uCanvas'), 240, 200);
        gl.uniform2fv(localGpu.wobbly.u('uCtrl'), localCtrl);
        gl.uniform2f(localGpu.wobbly.u('uRestSize'), 136, 96);
        gl.uniform1i(localGpu.wobbly.u('uPass'), 1);
        gl.uniform2f(localGpu.wobbly.u('uOffset'), 0, 0);
        gl.uniform1f(localGpu.wobbly.u('uAlpha'), 1.0);
        gl.uniform1f(localGpu.wobbly.u('uGlow'), 0.5);
        gl.drawElements(gl.TRIANGLES, localGpu.triCount, gl.UNSIGNED_SHORT, 0);
        glErr = gl.getError();
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        if (glErr !== 0) throw new Error(`WebGL error 0x${glErr.toString(16)} after 20x20 mesh draw`);

        const gl = fx.gl;
        const sample = (cssX, cssY) => {
          const px = new Uint8Array(4);
          const x = Math.min(c.width - 1, Math.max(0, Math.round(cssX * (c.width / 240))));
          const y = Math.min(c.height - 1, Math.max(0, Math.round((200 - cssY) * (c.height / 200))));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return Array.from(px);
        };
        const ctr = grid.evalBezier(0.5, 0.5, localCtrl);
        const inside = sample(ctr.x, ctr.y);
        const outside = sample(6, 6);
        if (inside[3] < 200) throw new Error(`wobbly mesh centre pixel was empty: rgba(${inside.join(',')})`);
        if (outside[3] > 5) throw new Error(`corner outside window was not clear: rgba(${outside.join(',')})`);
        return `gl.getError() === 0; 20x20 mesh (${localGpu.triCount / 3} tris); centre rgba(${inside.join(',')}), outside rgba(${outside.join(',')})`;
      } finally {
        disposeGpuResources(fx.gl, localGpu);
        fx.dispose();
      }
    },
  },
  {
    name: 'Spring-mass solver produces non-zero corner lag on impulse and damps cleanly back toward rest',
    why: 'Pulls the grabbed corner of a 4x4 WobblyGrid, confirms the opposite corner lags behind, releases it, and steps 180 frames to confirm elastic damping back to rest.',
    run: async () => {
      const grid = new WobblyGrid(40, 40, 300, 220);
      const startLag = grid.maxLag;
      if (startLag !== 0) throw new Error(`expected 0 rest lag, got ${startLag}`);

      grid.grabNearest(40, 40);
      grid.moveGrab(112, 74);
      let peakLag = 0;
      for (let i = 0; i < 6; i++) {
        grid.step(1 / 60, { stiffness: 5.5, friction: 3.5 });
        if (grid.maxLag > peakLag) peakLag = grid.maxLag;
      }
      const tl = grid.nodes[0];
      const br = grid.nodes[15];
      const diagGap = Math.hypot((br.x - tl.x) - 300, (br.y - tl.y) - 220);
      if (peakLag < 8 || diagGap < 8) {
        throw new Error(`expected clear corner lag on grab, got peakLag=${peakLag.toFixed(2)} px, diagGap=${diagGap.toFixed(2)} px`);
      }

      grid.releaseGrab(260, -110);
      for (let i = 0; i < 180; i++) {
        grid.step(1 / 60, { stiffness: 5.5, friction: 3.5 });
        if (grid.maxLag > peakLag) peakLag = grid.maxLag;
      }
      if (grid.maxLag > 0.5) {
        throw new Error(`grid did not damp back toward rest: residual lag ${grid.maxLag.toFixed(2)} px`);
      }
      return `peak corner lag ${peakLag.toFixed(1)} px (opposite corner delta ${diagGap.toFixed(1)} px) -> damped to ${grid.maxLag.toFixed(3)} px (settled=${grid.settled})`;
    },
  },
  {
    name: '3D Desktop Cube renders all 4 live drawable faces on one ElementGL context',
    why: 'Mounts 4 coloured drawable workspace divs inside one isolated ElementGL canvas on testStage(), uploads all 4 via texElementSubImage2D(), renders the translucent 3D cube at an oblique angle, checks gl.getError() === 0, and verifies two visible faces drew distinct colours.',
    run: async () => {
      if (!glSupported) throw new Error('texElementSubImage2D() is not supported in this browser');
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:240px;height:220px;';
      const palette = ['#e65525', '#1eb8a8', '#e5b214', '#8e6bf5'];
      const faces = palette.map((bg, i) => {
        const d = document.createElement('div');
        d.setAttribute('drawable', '');
        d.style.cssText = `position:absolute;left:0;top:0;width:160px;height:126px;background:${bg};color:#fff;font:700 15px system-ui;padding:12px;`;
        d.textContent = `WS ${i + 1}`;
        c.append(d);
        return d;
      });
      box.append(c);

      const fx = new ElementGL(c, {
        fragment: PASSTHROUGH_FRAG,
        attributes: { preserveDrawingBuffer: true },
      });
      const localGpu = buildGpuResources(fx.gl);
      const defs = cubeFaceDefs();
      let glErr = 0;

      const drawFixture = () => {
        const uploaded = faces.map((el) => fx.upload(el));
        if (!fx.begin([0, 0, 0, 0]) || uploaded.some((t) => !t)) return;
        const gl = fx.gl;
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

        const aspect = 240 / 220;
        const camPos = [0, 0.25, 4.35];
        const viewMat = mat4LookAt(camPos, [0, 0.1, 0], [0, 1, 0]);
        const projMat = mat4Perspective((42 * Math.PI) / 180, aspect, 0.1, 40);
        const vpMat = mat4Mul(projMat, viewMat);
        const modelMat = mat4Mul(
          mat4Translate(0, 0.12, 0),
          mat4Mul(mat4RotateX(-0.14), mat4RotateY(-0.68)),
        );

        const sorted = defs.map((f) => {
          const wp = mulVec3Point(modelMat, f.center);
          const vp = mulVec3Point(viewMat, wp);
          return { f, viewZ: vp[2] };
        }).sort((a, b) => a.viewZ - b.viewZ);

        gl.useProgram(localGpu.cube.prog);
        gl.bindVertexArray(localGpu.quadVao);
        gl.uniformMatrix4fv(localGpu.cube.u('uModel'), false, modelMat);
        gl.uniformMatrix4fv(localGpu.cube.u('uVP'), false, vpMat);
        gl.uniform3f(localGpu.cube.u('uCamPos'), camPos[0], camPos[1], camPos[2]);
        gl.uniform1f(localGpu.cube.u('uAlpha'), 0.82);
        gl.uniform1f(localGpu.cube.u('uReflect'), 0.0);
        gl.uniform1f(localGpu.cube.u('uFloorY'), FLOOR_Y);
        gl.uniform1f(localGpu.cube.u('uRimGlow'), 0.5);

        for (const { f } of sorted) {
          gl.uniform1i(localGpu.cube.u('uKind'), f.kind);
          gl.uniform3f(localGpu.cube.u('uOrigin'), f.origin[0], f.origin[1], f.origin[2]);
          gl.uniform3f(localGpu.cube.u('uAxisU'), f.axisU[0], f.axisU[1], f.axisU[2]);
          gl.uniform3f(localGpu.cube.u('uAxisV'), f.axisV[0], f.axisV[1], f.axisV[2]);
          gl.uniform3f(localGpu.cube.u('uNormal'), f.normal[0], f.normal[1], f.normal[2]);
          gl.uniform3f(localGpu.cube.u('uAccent'), f.accent[0], f.accent[1], f.accent[2]);
          gl.uniform1f(localGpu.cube.u('uIsFront'), f.wsIndex === 0 ? 1.0 : 0.0);
          if (f.kind === 0) {
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, uploaded[f.wsIndex].tex);
            gl.uniform1i(localGpu.cube.u('uTex'), 0);
          }
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        glErr = gl.getError();
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        if (glErr !== 0) throw new Error(`WebGL error 0x${glErr.toString(16)} during 4-face cube draw`);

        const gl = fx.gl;
        const sample = (cssX, cssY) => {
          const px = new Uint8Array(4);
          const x = Math.min(c.width - 1, Math.max(0, Math.round(cssX * (c.width / 240))));
          const y = Math.min(c.height - 1, Math.max(0, Math.round((220 - cssY) * (c.height / 220))));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return Array.from(px);
        };
        const leftFace = sample(92, 110);
        const rightFace = sample(164, 110);
        if (leftFace[3] < 160 || rightFace[3] < 160) {
          throw new Error(`cube face pixel empty: left rgba(${leftFace.join(',')}), right rgba(${rightFace.join(',')})`);
        }
        const colorDiff = Math.abs(leftFace[0] - rightFace[0]) + Math.abs(leftFace[1] - rightFace[1]) + Math.abs(leftFace[2] - rightFace[2]);
        if (colorDiff < 35) {
          throw new Error(`two adjacent cube faces did not show distinct colours: left rgba(${leftFace.join(',')}), right rgba(${rightFace.join(',')})`);
        }
        return `gl.getError() === 0; 4 faces uploaded on 1 ElementGL; left rgba(${leftFace.join(',')}), right rgba(${rightFace.join(',')})`;
      } finally {
        disposeGpuResources(fx.gl, localGpu);
        fx.dispose();
      }
    },
  },
  {
    name: 'updateElementGeometry() scaled by geometryUnit() lands elementsFromPoint() on the moved window button',
    why: 'Builds an isolated drawable window with a live button on testStage(), moves and shears its 4x4 spring grid, updates canvas.updateElementGeometry(), and checks document.elementsFromPoint() at the new button coordinates.',
    run: async () => {
      if (!glSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('ElementGL or updateElementGeometry() is not supported');
      }
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:260px;height:220px;';
      const win = document.createElement('div');
      win.setAttribute('drawable', '');
      win.style.cssText = 'position:absolute;left:0;top:0;width:124px;height:88px;display:flex;align-items:center;justify-content:center;background:#1e1a29;border-radius:8px;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '+1 Ping';
      btn.style.cssText = 'width:82px;height:44px;';
      win.append(btn);
      c.append(win);
      box.append(c);

      const fx = new ElementGL(c, { fragment: PASSTHROUGH_FRAG });
      const grid = new WobblyGrid(16, 18, 124, 88);
      const localCtrl = new Float32Array(32);
      let tick = 0;
      let lastKey = '';

      const drawFixture = () => {
        fx.upload(win);
        if (!fx.begin([0, 0, 0, 0])) return;
        grid.fillControls(localCtrl);
        const w = win.offsetWidth || 124;
        const h = win.offsetHeight || 88;
        const ctr = grid.centroid();
        const quadMat = ElementGL.rect(c, ctr.x - w * 0.5, ctr.y - h * 0.5, w, h);
        fx.quad(win, quadMat);

        const unit = geometryUnit(c, win, w);
        const hm = wobblyHitMatrix(localCtrl, w, h, unit);
        c.updateElementGeometry(win, { canvasTransform: hm });
        const key = `${localCtrl[0].toFixed(1)},${localCtrl[1].toFixed(1)},${localCtrl[30].toFixed(1)}`;
        if (key !== lastKey) {
          lastKey = key;
          win.dataset.hitTick = String((tick++) & 1);
        }
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        const rect = c.getBoundingClientRect();
        const restCtr = grid.centroid();
        const atRest = document.elementsFromPoint(rect.left + restCtr.x, rect.top + restCtr.y);
        if (!atRest.includes(btn) && !atRest.includes(win)) {
          throw new Error(`rest hit missed: got ${atRest.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        }

        // Move and shear the window across the canvas.
        grid.reset(108, 92, 124, 88);
        grid.grabNearest(108, 92);
        grid.moveGrab(126, 102);
        grid.step(0.03, { stiffness: 5.5, friction: 3.5 });
        await nextPaint(c);
        await nextPaint(c);

        const movedCtr = grid.centroid();
        const atMoved = document.elementsFromPoint(rect.left + movedCtr.x, rect.top + movedCtr.y);
        if (!atMoved.includes(btn) && !atMoved.includes(win)) {
          throw new Error(`moved hit missed at (${Math.round(movedCtr.x)},${Math.round(movedCtr.y)}): got ${atMoved.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        }
        return `rest hit ${atRest[0]?.tagName} at (${Math.round(restCtr.x)},${Math.round(restCtr.y)}); moved hit ${atMoved[0]?.tagName} at (${Math.round(movedCtr.x)},${Math.round(movedCtr.y)})`;
      } finally {
        fx.dispose();
      }
    },
  },
];

if (tbody) runTests(tbody, checks);
