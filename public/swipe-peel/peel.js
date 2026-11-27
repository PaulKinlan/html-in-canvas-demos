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

export const ROW_H = 88;
export const ROW_GAP = 10;
export const PAD_X = 12;
export const PAD_Y = 12;
export const COMMIT_FRACTION = 0.42;
export const MESH_COLS = 28;
export const MESH_ROWS = 10;

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;

export const INBOX_ITEMS = [
  {
    id: 0,
    initials: 'PK',
    badgeBg: '#d2491f',
    sender: 'Paul Kinlan',
    ageMinutes: 2,
    subject: 'Android 159 peel gesture trace',
    snippet: 'Check lock angle at 14 px horizontal delta on Pixel.',
    starred: true,
    checked: false,
  },
  {
    id: 1,
    initials: 'AR',
    badgeBg: '#2563eb',
    sender: 'Ada Rivera',
    ageMinutes: 14,
    subject: 'WebGL texture budget on mobile',
    snippet: 'Keep backing store under 4 MP and release retired slots.',
    starred: false,
    checked: false,
  },
  {
    id: 2,
    initials: 'JM',
    badgeBg: '#0f766e',
    sender: 'Jonah Meyer',
    ageMinutes: 38,
    subject: 'Spring collapse timing curve',
    snippet: 'Stiffness 260 with damping 26 settles cleanly in 280 ms.',
    starred: false,
    checked: true,
  },
  {
    id: 3,
    initials: 'EL',
    badgeBg: '#7c3aed',
    sender: 'Elena Lin',
    ageMinutes: 95,
    subject: 'Touch-action pan-y notes',
    snippet: 'Vertical pan yields cleanly past the 8 px deadzone.',
    starred: true,
    checked: false,
  },
  {
    id: 4,
    initials: 'SK',
    badgeBg: '#b45309',
    sender: 'Samira Khan',
    ageMinutes: 180,
    subject: 'Hit-test cache invalidation',
    snippet: 'Flip dataset.hitTick only when a row slot moves.',
    starred: false,
    checked: false,
  },
  {
    id: 5,
    initials: 'TR',
    badgeBg: '#be185d',
    sender: 'Theo Ross',
    ageMinutes: 320,
    subject: 'Context-loss recovery test',
    snippet: 'Move live rows into plain HTML if the GPU drops.',
    starred: false,
    checked: false,
  },
];

const PASSTHROUGH_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

// #region touch-arbitration
/**
 * Decide whether a pointer movement past the 8 px deadzone locks to a
 * horizontal row peel/stretch or yields to vertical scrolling.
 */
export function decideLock(dx, dy) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > 8 && ax > ay * 1.4) return 'horizontal';
  if (ay > 8 && ay >= ax / 1.4) return 'vertical';
  return 'pending';
}

/**
 * Tracks a single pointer gesture from pointerdown through angle arbitration,
 * horizontal drag velocity, and threshold crossing.
 */
export function createSwipeSession({
  rowId,
  pointerId,
  startX,
  startY,
  startLocalY = 0,
  startTime = performance.now(),
  startedOnControl = false,
}) {
  const session = {
    rowId,
    pointerId,
    startX,
    startY,
    startLocalY,
    lastX: startX,
    lastT: startTime,
    vx: 0,
    lock: 'pending',
    captured: false,
    startedOnControl,
    crossedThreshold: false,
    step(clientX, clientY, now = performance.now()) {
      const dx = clientX - session.startX;
      const dy = clientY - session.startY;
      if (session.lock === 'pending') {
        session.lock = decideLock(dx, dy);
      }
      const dt = Math.max(0.004, (now - session.lastT) / 1000);
      const instVx = (clientX - session.lastX) / dt;
      session.vx = session.vx * 0.55 + instVx * 0.45;
      session.lastX = clientX;
      session.lastT = now;
      return session.lock;
    },
    effectiveDx(clientX) {
      const raw = clientX - session.startX;
      return raw - Math.sign(raw) * Math.min(Math.abs(raw), 8);
    },
  };
  return session;
}
// #endregion touch-arbitration

// #region elastic-spring
/**
 * Symplectic spring integrator sub-stepped to 240 Hz so large frame gaps
 * never overshoot or explode.
 */
export function stepSpring(value, velocity, target, stiffness, damping, dt) {
  const clamped = Math.min(Math.max(dt, 0), 0.05);
  if (clamped <= 0) {
    return {
      value,
      velocity,
      settled: Math.abs(value - target) < 0.05 && Math.abs(velocity) < 0.5,
    };
  }
  const subDt = 1 / 240;
  const steps = Math.max(1, Math.min(12, Math.ceil(clamped / subDt)));
  const h = clamped / steps;
  let x = value;
  let v = velocity;
  for (let i = 0; i < steps; i++) {
    const accel = (target - x) * stiffness - v * damping;
    v += accel * h;
    x += v * h;
  }
  const settled = Math.abs(x - target) < 0.05 && Math.abs(v) < 0.5;
  if (settled) {
    x = target;
    v = 0;
  }
  return { value: x, velocity: v, settled };
}

/**
 * Advance one row's horizontal peel/stretch spring, threshold pulse, and
 * vertical collapse/expand spring. Returns true while still animating.
 */
export function stepRowPhysics(row, rowW, dt, reducedMotion, isDragging) {
  let moving = false;

  if (row.pulse > 0) {
    row.pulse = reducedMotion ? 0 : Math.max(0, row.pulse - dt * 4.5);
    if (row.pulse > 0) moving = true;
  }

  if (!isDragging) {
    if (row.committing) {
      if (reducedMotion) {
        row.offsetX = row.targetX;
        row.velX = 0;
        row.collapse = 0;
        row.collapseVel = 0;
        return false;
      }
      const sx = stepSpring(row.offsetX, row.velX, row.targetX, 340, 28, dt);
      row.offsetX = sx.value;
      row.velX = sx.velocity;
      if (!sx.settled) moving = true;

      if (Math.abs(row.offsetX) >= rowW * 0.55) {
        row.targetCollapse = 0;
      }
    } else if (row.offsetX !== row.targetX || row.velX !== 0) {
      if (reducedMotion) {
        row.offsetX = row.targetX;
        row.velX = 0;
      } else {
        const sx = stepSpring(row.offsetX, row.velX, row.targetX, 360, 22, dt);
        row.offsetX = sx.value;
        row.velX = sx.velocity;
        if (!sx.settled) moving = true;
      }
    }
  }

  if (row.collapse !== row.targetCollapse || row.collapseVel !== 0) {
    if (reducedMotion) {
      row.collapse = row.targetCollapse;
      row.collapseVel = 0;
    } else {
      const sc = stepSpring(row.collapse, row.collapseVel, row.targetCollapse, 260, 26, dt);
      row.collapse = Math.max(0, Math.min(1.08, sc.value));
      row.collapseVel = sc.velocity;
      if (!sc.settled) moving = true;
      else row.collapse = row.targetCollapse;
    }
  }

  return moving;
}
// #endregion elastic-spring

// #region peel-shader
const STRIP_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;

uniform vec2 uCanvas;
uniform vec4 uRect; // x, y, w, h in CSS px

out vec2 vUv;

void main() {
  vUv = aUv;
  vec2 pos = uRect.xy + aUv * uRect.zw;
  vec2 clip = vec2(
    (pos.x / max(uCanvas.x, 1.0)) * 2.0 - 1.0,
    1.0 - (pos.y / max(uCanvas.y, 1.0)) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const STRIP_FS = `#version 300 es
precision highp float;
in vec2 vUv;

uniform vec2 uSize;
uniform float uDir;       // +1.0 Archive (emerald), -1.0 Delete (crimson)
uniform float uProgress;  // 0..1 towards commit threshold
uniform float uCommitted; // 1.0 when past 42% threshold
uniform float uPulse;     // 0..1 threshold pop pulse
uniform float uPeelEdge;  // 0..1 exposed fraction for shadow casting

out vec4 outColor;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h);
}

float iconArchive(vec2 p) {
  float lid = sdRoundBox(p - vec2(0.0, -5.5), vec2(9.0, 2.2), 1.0);
  float body = sdRoundBox(p - vec2(0.0, 3.0), vec2(7.6, 5.8), 1.4);
  float hollow = sdRoundBox(p - vec2(0.0, 3.5), vec2(5.2, 3.4), 0.8);
  float boxShell = min(lid, max(body, -hollow));
  float stem = sdSegment(p, vec2(0.0, -0.8), vec2(0.0, 5.2)) - 1.25;
  float tipL = sdSegment(p, vec2(-3.0, 2.6), vec2(0.0, 5.5)) - 1.15;
  float tipR = sdSegment(p, vec2(3.0, 2.6), vec2(0.0, 5.5)) - 1.15;
  return min(boxShell, min(stem, min(tipL, tipR)));
}

float iconTrash(vec2 p) {
  float handle = sdRoundBox(p - vec2(0.0, -7.8), vec2(2.8, 1.4), 0.7);
  float lid = sdRoundBox(p - vec2(0.0, -5.2), vec2(8.5, 1.4), 0.7);
  float taper = clamp((p.y + 3.0) / 12.0, 0.0, 1.0) * 1.4;
  float bin = sdRoundBox(p - vec2(0.0, 3.2), vec2(6.8 - taper, 5.8), 1.2);
  float ribL = sdSegment(p, vec2(-2.4, -0.2), vec2(-2.0, 6.2)) - 0.9;
  float ribR = sdSegment(p, vec2(2.4, -0.2), vec2(2.0, 6.2)) - 0.9;
  float binHollow = max(bin, -min(ribL, ribR));
  return min(min(handle, lid), binHollow);
}

void main() {
  vec2 px = vUv * uSize;
  float radius = min(12.0, min(uSize.x, uSize.y) * 0.45);
  float boxD = sdRoundBox(px - uSize * 0.5, uSize * 0.5, radius);
  float mask = 1.0 - smoothstep(-0.75, 0.75, boxD);
  if (mask <= 0.002) discard;

  float s = uDir > 0.0 ? vUv.x : (1.0 - vUv.x);
  vec3 baseCol = uDir > 0.0 ? vec3(0.047, 0.255, 0.149) : vec3(0.286, 0.047, 0.055);
  vec3 hotCol = uDir > 0.0 ? vec3(0.086, 0.659, 0.306) : vec3(0.878, 0.157, 0.176);

  float sweep = smoothstep(0.0, max(uProgress * 0.92 + 0.08, 0.08), 1.0 - s);
  vec3 bg = mix(baseCol, hotCol, clamp(uProgress * 0.85 + 0.2 * sweep, 0.0, 1.0));
  if (uCommitted > 0.5) {
    bg = mix(bg, hotCol * 1.12, 0.45);
  }
  bg += vec3(0.22, 0.24, 0.22) * uPulse * 0.55;

  float creasePx = uPeelEdge * uSize.x;
  float distFromEdge = max(0.0, creasePx - s * uSize.x);
  float edgeShadow = exp(-distFromEdge / 18.0) * 0.38;
  bg *= (1.0 - edgeShadow);

  float innerRim = smoothstep(-2.5, 0.0, boxD);
  bg *= mix(1.0, 0.72, innerRim * 0.6);

  vec2 anchor = uDir > 0.0 ? vec2(32.0, uSize.y * 0.5) : vec2(uSize.x - 32.0, uSize.y * 0.5);
  float iconScale = mix(0.80, 1.12, uProgress) + 0.18 * uPulse;
  vec2 ip = (px - anchor) / max(iconScale, 0.2);
  float iconD = uDir > 0.0 ? iconArchive(ip) : iconTrash(ip);
  float iconAlpha = (1.0 - smoothstep(-0.7, 0.7, iconD)) * smoothstep(0.03, 0.20, uProgress);

  float halo = (1.0 - smoothstep(14.0, 19.0, length(ip))) * (uCommitted > 0.5 ? 0.24 : 0.0);
  vec3 col = mix(bg, vec3(1.0), halo);
  col = mix(col, vec3(0.98, 0.99, 0.99), iconAlpha);

  outColor = vec4(col * mask, mask);
}`;

const ROW_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUv;

uniform vec2 uCanvas;
uniform vec4 uRect;      // x, y, restW, restH in CSS px
uniform float uOffsetX;  // signed swipe offset in CSS px
uniform float uTiltY;    // -1..1 grab vertical bias
uniform float uCollapse; // 0..1 height scale
uniform float uMode;     // 0.0 = Sticker Peel (3D Curl), 1.0 = Elastic Taffy
uniform float uPulse;    // 0..1 threshold pop pulse

out vec2 vUv;
out vec3 vNormal;
out float vCrest;
out float vShadow;
out float vStrain;

void main() {
  vUv = aUv;
  float w = max(uRect.z, 1.0);
  float h = max(uRect.w * uCollapse, 0.5);
  float absDx = abs(uOffsetX);
  float dir = uOffsetX >= 0.0 ? 1.0 : -1.0;
  vec2 center = uRect.xy + vec2(w * 0.5, h * 0.5);

  vec2 pos = uRect.xy + vec2(aUv.x * w, aUv.y * h);
  float zLocal = 0.0;
  vNormal = vec3(0.0, 0.0, 1.0);
  vCrest = 0.0;
  vShadow = 0.0;
  vStrain = 0.0;

  if (uMode < 0.5) {
    // Mode 0: Sticker Peel (3D cylindrical curl mesh)
    if (absDx >= 0.4) {
      float p = clamp(absDx / w, 0.0, 1.5);
      float s = dir > 0.0 ? aUv.x : (1.0 - aUv.x);
      float slant = uTiltY * 0.11 * clamp(p * 2.4, 0.0, 1.0) * (aUv.y - 0.5);
      float creaseS = clamp(p * 0.56 + slant, 0.0, 1.15);
      float slideX = max(0.0, p - 0.70) * w * 0.68;
      float R = mix(10.0, 21.0, clamp(p * 1.5, 0.0, 1.0)) * (1.0 - 0.30 * max(0.0, p - 0.90));

      float xLocal;
      if (s >= creaseS) {
        xLocal = s * w;
        float distPx = (s - creaseS) * w;
        vShadow = exp(-distPx / max(R * 0.95, 1.0)) * clamp(p * 3.2, 0.0, 1.0);
        vNormal = vec3(0.0, 0.0, 1.0);
      } else {
        float arcLen = (creaseS - s) * w;
        float piR = 3.14159265 * R;
        if (arcLen <= piR) {
          float theta = arcLen / max(R, 1.0);
          xLocal = creaseS * w + sin(theta) * R;
          zLocal = (1.0 - cos(theta)) * R;
          vNormal = vec3(dir * sin(theta), uTiltY * 0.12, cos(theta));
          vCrest = sin(theta);
        } else {
          float excess = arcLen - piR;
          xLocal = creaseS * w + excess * 0.94;
          zLocal = 2.0 * R + excess * 0.12 + 3.5 * sin(clamp(excess / 72.0, 0.0, 1.0) * 1.570796);
          vNormal = normalize(vec3(-dir * 0.12, uTiltY * 0.08, -1.0));
          vCrest = exp(-excess / 16.0) * 0.35;
        }
      }
      float px = uRect.x + (dir > 0.0 ? xLocal : (w - xLocal)) + dir * slideX;
      float py = uRect.y + aUv.y * h + uPulse * (aUv.y - 0.5) * 4.0;
      float persp = 920.0 / max(920.0 - zLocal, 280.0);
      pos = center + (vec2(px, py) - center) * persp;
    }
  } else {
    // Mode 1: Elastic Taffy rubber-band stretch + Poisson pinch
    if (absDx >= 0.4) {
      float p = clamp(absDx / w, 0.0, 1.6);
      float s = dir > 0.0 ? aUv.x : (1.0 - aUv.x);
      float lagFrac = clamp(p / 0.42, 0.0, 1.0);
      float releaseFrac = smoothstep(0.42, 0.85, p);
      float trailRatio = mix(0.24 * lagFrac * lagFrac, 0.88, releaseFrac);
      float lead = uOffsetX;
      float trail = uOffsetX * trailRatio;
      float shiftX = mix(trail, lead, pow(s, 0.78));

      float stretch = abs(lead - trail) / w;
      float waist = sin(3.14159265 * s);
      float pinchY = (1.0 - clamp(stretch * 0.34, 0.0, 0.26) * waist) * (1.0 + uPulse * 0.045);
      float shearY = uTiltY * 5.0 * s * clamp(p * 2.0, 0.0, 1.0);

      pos.x = uRect.x + aUv.x * w + shiftX;
      pos.y = center.y + (aUv.y - 0.5) * h * pinchY + shearY;
      vStrain = clamp(stretch * 2.4 * (0.4 + 0.6 * waist), 0.0, 1.0);
    }
  }

  vec2 clip = vec2(
    (pos.x / max(uCanvas.x, 1.0)) * 2.0 - 1.0,
    1.0 - (pos.y / max(uCanvas.y, 1.0)) * 2.0
  );
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const ROW_FS = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNormal;
in float vCrest;
in float vShadow;
in float vStrain;

uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uMode;
uniform float uAlpha;
uniform float uPulse;

out vec4 outColor;

void main() {
  vec4 tex = texture(uTex, vUv);
  if (tex.a <= 0.002) discard;

  vec3 L = normalize(vec3(-0.32, -0.45, 0.84));
  vec3 rgb;

  if (uMode < 0.5) {
    if (gl_FrontFacing) {
      vec3 N = normalize(vNormal);
      float ndotl = max(dot(N, L), 0.0);
      float shade = mix(0.86, 1.05, ndotl) * (1.0 - vShadow * 0.42);
      float spec = pow(clamp(vCrest, 0.0, 1.0), 3.0) * 0.24;
      rgb = tex.rgb * shade + vec3(1.0, 0.99, 0.96) * spec * tex.a;
    } else {
      // Curled sticker underside: matte metallic/paper stock with lit specular crease
      vec3 N = normalize(-vNormal);
      float ndotl = max(dot(N, L), 0.0);
      vec3 matte = vec3(0.89, 0.87, 0.83);
      vec3 unpremul = tex.rgb / max(tex.a, 0.01);
      vec3 paper = mix(matte, unpremul * 0.68 + matte * 0.32, 0.16);
      float grain = (fract(sin(dot(floor(vUv * uSize * 0.65), vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * 0.03;
      float diff = 0.64 + 0.36 * ndotl;
      float creaseSpec = pow(clamp(vCrest, 0.0, 1.0), 2.0) * 0.48;
      float edgeDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
      float rim = (1.0 - smoothstep(0.0, 0.024, edgeDist)) * 0.18;
      rgb = (paper * diff + grain) + vec3(1.0, 0.98, 0.94) * (creaseSpec + rim);
      rgb *= tex.a;
    }
  } else {
    float edgeDist = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float rim = (1.0 - smoothstep(0.0, 0.03, edgeDist)) * vStrain * 0.28;
    float sheen = vStrain * 0.14 * (0.55 + 0.45 * sin((vUv.x * 2.0 + vUv.y) * 3.14159265));
    rgb = tex.rgb + (vec3(1.0, 0.85, 0.72) * (sheen + rim) + vec3(0.28, 0.26, 0.22) * uPulse) * tex.a;
  }

  float a = tex.a * uAlpha;
  outColor = vec4(rgb * uAlpha, a);
}`;

function compileShaderProgram(gl, vsSrc, fsSrc) {
  const make = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error(`shader compile failed: ${log}`);
    }
    return s;
  };
  const vs = make(gl.VERTEX_SHADER, vsSrc);
  const fs = make(gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.bindAttribLocation(prog, 0, 'aUv');
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`program link failed: ${log}`);
  }
  const uniforms = new Map();
  const u = (name) => {
    let loc = uniforms.get(name);
    if (loc === undefined) {
      loc = gl.getUniformLocation(prog, name);
      uniforms.set(name, loc);
    }
    return loc;
  };
  return { prog, u };
}

export function buildGpuResources(gl) {
  const strip = compileShaderProgram(gl, STRIP_VS, STRIP_FS);
  const row = compileShaderProgram(gl, ROW_VS, ROW_FS);

  const quadVao = gl.createVertexArray();
  const quadVbo = gl.createBuffer();
  gl.bindVertexArray(quadVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const verts = new Float32Array((MESH_COLS + 1) * (MESH_ROWS + 1) * 2);
  let ptr = 0;
  for (let j = 0; j <= MESH_ROWS; j++) {
    const v = j / MESH_ROWS;
    for (let i = 0; i <= MESH_COLS; i++) {
      verts[ptr++] = i / MESH_COLS;
      verts[ptr++] = v;
    }
  }
  const indices = new Uint16Array(MESH_COLS * MESH_ROWS * 6);
  let k = 0;
  const stride = MESH_COLS + 1;
  for (let j = 0; j < MESH_ROWS; j++) {
    for (let i = 0; i < MESH_COLS; i++) {
      const a = j * stride + i;
      const b = (j + 1) * stride + i;
      const c = j * stride + (i + 1);
      const d = (j + 1) * stride + (i + 1);
      indices[k++] = a;
      indices[k++] = b;
      indices[k++] = c;
      indices[k++] = c;
      indices[k++] = b;
      indices[k++] = d;
    }
  }

  const meshVao = gl.createVertexArray();
  const meshVbo = gl.createBuffer();
  const meshIbo = gl.createBuffer();
  gl.bindVertexArray(meshVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
  gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  // Reverse column draw order (right-to-left) for right-swipe Painter sorting
  const revIndices = new Uint16Array(MESH_COLS * MESH_ROWS * 6);
  let rk = 0;
  for (let j = 0; j < MESH_ROWS; j++) {
    for (let i = MESH_COLS - 1; i >= 0; i--) {
      const a = j * stride + i;
      const b = (j + 1) * stride + i;
      const c = j * stride + (i + 1);
      const d = (j + 1) * stride + (i + 1);
      revIndices[rk++] = a;
      revIndices[rk++] = b;
      revIndices[rk++] = c;
      revIndices[rk++] = c;
      revIndices[rk++] = b;
      revIndices[rk++] = d;
    }
  }
  const meshRevVao = gl.createVertexArray();
  const meshRevIbo = gl.createBuffer();
  gl.bindVertexArray(meshRevVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, meshVbo);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshRevIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, revIndices, gl.STATIC_DRAW);

  gl.bindVertexArray(null);
  return {
    strip,
    row,
    quadVao,
    quadVbo,
    meshVao,
    meshIbo,
    meshRevVao,
    meshRevIbo,
    meshVbo,
    indexCount: indices.length,
  };
}

export function disposeGpuResources(gl, gpuRes) {
  if (!gl || !gpuRes || gl.isContextLost()) return;
  gl.deleteProgram(gpuRes.strip.prog);
  gl.deleteProgram(gpuRes.row.prog);
  gl.deleteBuffer(gpuRes.quadVbo);
  gl.deleteVertexArray(gpuRes.quadVao);
  gl.deleteBuffer(gpuRes.meshVbo);
  gl.deleteBuffer(gpuRes.meshIbo);
  gl.deleteVertexArray(gpuRes.meshVao);
  gl.deleteBuffer(gpuRes.meshRevIbo);
  gl.deleteVertexArray(gpuRes.meshRevVao);
}
// #endregion peel-shader

// #region geometry-sync
/**
 * Compute each row's live vertical position, height during collapse, and
 * visibility inside the scroll viewport.
 */
export function computeVisibleSlots(rows, rowW, rowH, scrollTop, canvasH) {
  let yCursor = PAD_Y;
  const slots = [];
  for (const row of rows) {
    if (row.removed || row.collapse <= 0.001) {
      slots.push({ row, drawX: PAD_X, drawY: -10000, slotH: 0, visible: false });
      continue;
    }
    const slotH = rowH * row.collapse;
    const step = (rowH + ROW_GAP) * row.collapse;
    const drawY = yCursor - scrollTop;
    const visible = drawY + slotH > -4 && drawY < canvasH + 4;
    slots.push({ row, drawX: PAD_X, drawY, slotH, visible });
    yCursor += step;
  }
  const contentHeight = Math.max(canvasH, Math.ceil(yCursor - ROW_GAP + PAD_Y));
  return { slots, contentHeight };
}

/**
 * Sync canvas.updateElementGeometry() scaled by geometryUnit() and toggle
 * dataset.hitTick only when a row's quantized transform or inert flag changes.
 */
export function syncRowGeometry(canvasEl, row, drawX, drawY, rowW, visible) {
  const el = row.el;
  if (!el || !el.isConnected || rowW <= 0 || !('updateElementGeometry' in canvasEl)) return;
  const peeledAway = Math.abs(row.offsetX) > rowW * 0.25 || row.committing || row.collapse < 0.88;
  const hideHit = !visible || row.removed || peeledAway;
  const unit = geometryUnit(canvasEl, el, rowW);
  if (el.inert !== hideHit) el.inert = hideHit;

  const qx = hideHit ? -100000 : Math.round(drawX * 2) / 2;
  const qy = hideHit ? -100000 : Math.round(drawY * 2) / 2;
  const key = `${qx},${qy},${hideHit ? 1 : 0}`;
  const m = hideHit
    ? new DOMMatrix().scale(unit, unit, 1).multiply(OFFSTAGE)
    : new DOMMatrix().scale(unit, unit, 1).translate(drawX, drawY);
  try {
    canvasEl.updateElementGeometry(el, { canvasTransform: m });
  } catch {}

  if (key !== row.lastHitKey) {
    row.lastHitKey = key;
    el.dataset.hitTick = el.dataset.hitTick === '1' ? '0' : '1';
  }
}
// #endregion geometry-sync

// --- DOM refs & state ---
const stageBox = document.getElementById('swipe-stage');
const stageStatus = document.getElementById('stage-status');
const feedViewport = document.getElementById('feed-viewport');
const feedTrack = document.getElementById('feed-scroll-track');
const plainList = document.getElementById('plain-list');
const emptyInbox = document.getElementById('empty-inbox');
const emptyResetBtn = document.getElementById('empty-reset');
const remainingOut = document.getElementById('remaining-count');
const tallyOut = document.getElementById('tally-out');
const telemetryOut = document.getElementById('swipe-telemetry');

const modePeelBtn = document.getElementById('mode-peel');
const modeTaffyBtn = document.getElementById('mode-taffy');
const demoSwipeBtn = document.getElementById('btn-demo-swipe');
const undoBtn = document.getElementById('btn-undo');
const resetBtn = document.getElementById('btn-reset');

const canvas = document.getElementById('peel-canvas');

const reducedMotionQuery = typeof window.matchMedia === 'function'
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

const textures = new Map();

const state = {
  route: 'init',
  mode: 'peel',
  reducedMotion: !!reducedMotionQuery?.matches,
  inView: true,
  archived: 0,
  deleted: 0,
  rows: [],
  undoStack: [],
  session: null,
  suppressClickUntil: 0,
  rafId: 0,
  lastFrameTime: 0,
  needUploadAll: true,
  lastScrollTrackH: 0,
  cachedCanvasW: 0,
  cachedCanvasH: 0,
  cachedRowW: 0,
  paintCount: 0,
};

let stage = null;
let gpu = null;
let ctx2d = null;

function formatAge(minutes) {
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const h = Math.floor(minutes / 60);
  return `${h}h ago`;
}

function buildRowElement(item) {
  const el = document.createElement('article');
  el.className = 'mail-row';
  el.id = `mail-${item.id}`;
  el.dataset.id = String(item.id);
  el.setAttribute('drawable', '');

  const checkWrap = document.createElement('label');
  checkWrap.className = 'check-hit';
  checkWrap.setAttribute('aria-label', `Select message from ${item.sender}`);
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.className = 'row-check';
  chk.checked = item.checked;
  checkWrap.append(chk);

  const avatar = document.createElement('span');
  avatar.className = 'sender-badge';
  avatar.style.setProperty('--badge', item.badgeBg);
  avatar.textContent = item.initials;
  avatar.setAttribute('aria-hidden', 'true');

  const main = document.createElement('div');
  main.className = 'mail-main';

  const top = document.createElement('div');
  top.className = 'mail-top';
  const sender = document.createElement('span');
  sender.className = 'mail-sender';
  sender.textContent = item.sender;
  const timeEl = document.createElement('time');
  timeEl.className = 'mail-time';
  timeEl.textContent = formatAge(item.ageMinutes);
  top.append(sender, timeEl);

  const subject = document.createElement('div');
  subject.className = 'mail-subject';
  subject.textContent = item.subject;

  const snippet = document.createElement('div');
  snippet.className = 'mail-snippet';
  snippet.textContent = item.snippet;

  main.append(top, subject, snippet);

  const starBtn = document.createElement('button');
  starBtn.type = 'button';
  starBtn.className = 'star-btn';
  starBtn.setAttribute('aria-pressed', String(item.starred));
  starBtn.setAttribute('aria-label', `Star message from ${item.sender}`);
  starBtn.textContent = item.starred ? '★' : '☆';

  const plainActions = document.createElement('div');
  plainActions.className = 'plain-actions';
  const archBtn = document.createElement('button');
  archBtn.type = 'button';
  archBtn.className = 'plain-archive';
  archBtn.textContent = 'Archive';
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'plain-delete';
  delBtn.textContent = 'Delete';
  plainActions.append(archBtn, delBtn);

  if (item.checked) el.classList.add('is-checked');

  el.append(checkWrap, avatar, main, starBtn, plainActions);
  return { el, chk, starBtn, timeEl, archBtn, delBtn };
}

function setStatusBanner(msg) {
  if (!msg) {
    stageStatus.hidden = true;
    stageStatus.textContent = '';
  } else {
    stageStatus.hidden = false;
    stageStatus.textContent = msg;
  }
}

function setTelemetry(msg) {
  if (telemetryOut) telemetryOut.textContent = msg;
}

function updateCounts() {
  const activeCount = state.rows.filter((r) => !r.removed && !r.committing).length;
  remainingOut.textContent = `${activeCount} of ${INBOX_ITEMS.length} remaining`;
  tallyOut.textContent = `Archived ${state.archived} · Deleted ${state.deleted}`;
  undoBtn.disabled = state.undoStack.length === 0;
  demoSwipeBtn.disabled = activeCount === 0;
  emptyInbox.hidden = state.rows.some((r) => !r.removed);
}

function measureStageMetrics() {
  const cw = canvas.clientWidth || feedViewport.clientWidth || 360;
  const ch = canvas.clientHeight || feedViewport.clientHeight || 368;
  const rowW = Math.max(200, cw - PAD_X * 2);
  if (cw !== state.cachedCanvasW || rowW !== state.cachedRowW) {
    state.cachedCanvasW = cw;
    state.cachedCanvasH = ch;
    state.cachedRowW = rowW;
    canvas.style.setProperty('--row-w', `${rowW}px`);
    state.needUploadAll = true;
  }
  return { cw, ch, rowW };
}

function syncScrollTrackHeight(contentHeight) {
  if (state.route === 'plain') {
    if (state.lastScrollTrackH !== 0) {
      state.lastScrollTrackH = 0;
      feedTrack.style.height = '';
    }
    return;
  }
  if (Math.abs(contentHeight - state.lastScrollTrackH) >= 1) {
    state.lastScrollTrackH = contentHeight;
    feedTrack.style.height = `${contentHeight}px`;
  }
}

function insertRowElementInOrder(row) {
  const container = state.route === 'plain' ? plainList : canvas;
  const idx = state.rows.indexOf(row);
  let beforeEl = null;
  for (let i = idx + 1; i < state.rows.length; i++) {
    const candidate = state.rows[i];
    if (!candidate.removed && candidate.el.parentElement === container) {
      beforeEl = candidate.el;
      break;
    }
  }
  if (beforeEl) container.insertBefore(row.el, beforeEl);
  else container.append(row.el);
}

function wireRowElement(el, item) {
  const chk = el.querySelector('.row-check');
  const starBtn = el.querySelector('.star-btn');
  const timeEl = el.querySelector('.mail-time');
  const archBtn = el.querySelector('.plain-archive');
  const delBtn = el.querySelector('.plain-delete');
  return { el, chk, starBtn, timeEl, archBtn, delBtn };
}

function initRows(reuseDom = false) {
  if (!reuseDom) {
    canvas.replaceChildren();
    plainList.replaceChildren();
  }
  textures.clear();
  state.rows = INBOX_ITEMS.map((item) => {
    const existing = reuseDom ? canvas.querySelector(`#mail-${item.id}`) : null;
    const parts = existing ? wireRowElement(existing, item) : buildRowElement(item);
    const row = {
      id: item.id,
      item,
      el: parts.el,
      timeEl: parts.timeEl,
      ageMinutes: item.ageMinutes,
      removed: false,
      committing: false,
      action: null,
      offsetX: 0,
      velX: 0,
      targetX: 0,
      collapse: 1,
      collapseVel: 0,
      targetCollapse: 1,
      pulse: 0,
      dragTiltY: 0,
      lastDrawY: 0,
      lastHitKey: '',
    };

    parts.chk.addEventListener('change', () => {
      row.el.classList.toggle('is-checked', parts.chk.checked);
      setTelemetry(`Row ${row.id + 1} (${item.sender}) ${parts.chk.checked ? 'checked' : 'unchecked'}.`);
      requestCanvasPaint();
    });

    parts.starBtn.addEventListener('click', () => {
      const next = parts.starBtn.getAttribute('aria-pressed') !== 'true';
      parts.starBtn.setAttribute('aria-pressed', String(next));
      parts.starBtn.textContent = next ? '★' : '☆';
      setTelemetry(`${next ? 'Starred' : 'Unstarred'} "${item.subject}".`);
      requestCanvasPaint();
    });

    parts.archBtn.addEventListener('click', () => commitRow(row, 'archive'));
    parts.delBtn.addEventListener('click', () => commitRow(row, 'delete'));

    if (!existing) canvas.append(row.el);
    return row;
  });
  state.archived = 0;
  state.deleted = 0;
  state.undoStack = [];
  state.needUploadAll = true;
  updateCounts();
}

function finalizeRemoval(row) {
  row.removed = true;
  row.committing = false;
  row.collapse = 0;
  row.collapseVel = 0;
  row.el.inert = true;
  if (canvas.isConnected && row.el.parentElement === canvas && state.route === 'webgl') {
    syncRowGeometry(canvas, row, 0, -10000, state.cachedRowW || 320, false);
  }
  row.el.remove();
  textures.delete(row.el);
  stage?.forget(row.el);
  updateCounts();
}

function commitRow(row, action) {
  if (row.removed || row.committing) return;
  row.committing = true;
  row.action = action;
  if (action === 'archive') state.archived++;
  else state.deleted++;
  state.undoStack.push({ row, action });

  if (row.el.contains(document.activeElement)) {
    undoBtn.focus({ preventScroll: true });
  }

  const rowW = state.cachedRowW || 340;
  const dir = action === 'archive' ? 1 : -1;
  row.targetX = dir * (rowW + 44);
  row.pulse = 1;

  if (state.route === 'plain' || state.reducedMotion) {
    finalizeRemoval(row);
    if (state.route === 'webgl') drawSceneWebGL();
    else if (state.route === '2d') drawScene2D();
    else updateCounts();
  } else {
    updateCounts();
    wakeAnim();
  }
  setTelemetry(`${action === 'archive' ? 'Archived' : 'Deleted'} "${row.item.subject}". Press Undo last to restore it.`);
}

function undoLast() {
  const entry = state.undoStack.pop();
  if (!entry) return;
  const { row, action } = entry;
  if (action === 'archive') state.archived = Math.max(0, state.archived - 1);
  else state.deleted = Math.max(0, state.deleted - 1);

  row.removed = false;
  row.committing = false;
  row.action = null;
  row.el.inert = false;
  row.lastHitKey = '';
  const rowW = state.cachedRowW || 340;
  if (state.route === 'plain' || state.reducedMotion) {
    row.collapse = 1;
    row.targetCollapse = 1;
    row.collapseVel = 0;
    row.offsetX = 0;
    row.targetX = 0;
    row.velX = 0;
  } else {
    row.collapse = 0.04;
    row.targetCollapse = 1;
    row.collapseVel = 0;
    row.offsetX = action === 'archive' ? rowW * 0.28 : -rowW * 0.28;
    row.targetX = 0;
    row.velX = 0;
  }

  insertRowElementInOrder(row);
  state.needUploadAll = true;
  updateCounts();
  requestCanvasPaint();
  wakeAnim();
  setTelemetry(`Restored "${row.item.subject}" via Undo.`);
}

function resetList() {
  for (const r of state.rows) {
    textures.delete(r.el);
    stage?.forget(r.el);
  }
  initRows();
  if (state.route === 'plain') {
    for (const r of state.rows) {
      r.el.inert = false;
      plainList.append(r.el);
    }
  } else {
    requestCanvasPaint();
  }
  feedViewport.scrollTop = 0;
  setTelemetry('Reset all 6 inbox rows.');
}

function triggerDemoSwipe() {
  const active = state.rows.filter((r) => !r.removed && !r.committing);
  if (!active.length) return;
  const target = active[1] ?? active[0];
  if (state.route === 'plain' || state.reducedMotion) {
    commitRow(target, 'archive');
    return;
  }
  const rowW = state.cachedRowW || 340;
  target.offsetX = rowW * 0.48;
  target.velX = 480;
  target.dragTiltY = -0.35;
  target.pulse = 1;
  commitRow(target, 'archive');
}

function requestCanvasPaint() {
  if (state.route === 'webgl' || state.route === '2d') {
    canvas.requestPaint?.();
  }
}

// #region render-loop
export function drawStrip(gl, gpuRes, canvasW, canvasH, row, drawX, drawY, rowW, slotH, mode) {
  const absDx = Math.abs(row.offsetX);
  const committed = row.committing || absDx >= rowW * COMMIT_FRACTION;
  const dir = row.action === 'archive' ? 1 : row.action === 'delete' ? -1 : (row.offsetX >= 0 ? 1 : -1);
  const progress = Math.min(1, absDx / Math.max(rowW * COMMIT_FRACTION, 1));
  const peelEdge = mode === 0
    ? Math.min(1, (absDx / Math.max(rowW, 1)) * 0.56 + Math.max(0, absDx / Math.max(rowW, 1) - 0.70) * 0.68)
    : Math.min(1, absDx / Math.max(rowW, 1));

  gl.useProgram(gpuRes.strip.prog);
  gl.bindVertexArray(gpuRes.quadVao);
  gl.uniform2f(gpuRes.strip.u('uCanvas'), canvasW, canvasH);
  gl.uniform4f(gpuRes.strip.u('uRect'), drawX, drawY, rowW, slotH);
  gl.uniform2f(gpuRes.strip.u('uSize'), rowW, slotH);
  gl.uniform1f(gpuRes.strip.u('uDir'), dir);
  gl.uniform1f(gpuRes.strip.u('uProgress'), progress);
  gl.uniform1f(gpuRes.strip.u('uCommitted'), committed ? 1 : 0);
  gl.uniform1f(gpuRes.strip.u('uPulse'), row.pulse);
  gl.uniform1f(gpuRes.strip.u('uPeelEdge'), peelEdge);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

export function drawRowMesh(gl, gpuRes, tex, canvasW, canvasH, row, drawX, drawY, rowW, rowH, mode) {
  const alpha = row.committing
    ? Math.max(0, 1 - Math.max(0, Math.abs(row.offsetX) / Math.max(rowW, 1) - 0.85) / 0.30)
    : 1;
  if (alpha <= 0.01 || row.collapse <= 0.02) return;

  gl.useProgram(gpuRes.row.prog);
  gl.bindVertexArray(row.offsetX >= 0 ? gpuRes.meshRevVao : gpuRes.meshVao);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex.tex);
  gl.uniform1i(gpuRes.row.u('uTex'), 0);
  gl.uniform2f(gpuRes.row.u('uCanvas'), canvasW, canvasH);
  gl.uniform4f(gpuRes.row.u('uRect'), drawX, drawY, rowW, rowH);
  gl.uniform2f(gpuRes.row.u('uSize'), rowW, rowH);
  gl.uniform1f(gpuRes.row.u('uOffsetX'), row.offsetX);
  gl.uniform1f(gpuRes.row.u('uTiltY'), row.dragTiltY);
  gl.uniform1f(gpuRes.row.u('uCollapse'), row.collapse);
  gl.uniform1f(gpuRes.row.u('uMode'), mode);
  gl.uniform1f(gpuRes.row.u('uAlpha'), alpha);
  gl.uniform1f(gpuRes.row.u('uPulse'), row.pulse);
  gl.drawElements(gl.TRIANGLES, gpuRes.indexCount, gl.UNSIGNED_SHORT, 0);
}

function drawSceneWebGL(paintEvent) {
  if (!stage || stage.lost || state.route !== 'webgl') return;
  const gl = stage.gl;
  if (!gpu) gpu = buildGpuResources(gl);

  const { cw, ch, rowW } = measureStageMetrics();
  const changed = paintEvent?.changedElements;
  let needRepaintRetry = false;

  if (paintEvent) {
    state.paintCount++;
    const uploadList = state.needUploadAll || !changed?.length
      ? state.rows.filter((r) => !r.removed).map((r) => r.el)
      : changed;
    let allUploaded = true;
    for (const el of uploadList) {
      if (!el?.isConnected) continue;
      try {
        const handle = stage.upload(el);
        if (handle) textures.set(el, handle);
      } catch (err) {
        allUploaded = false;
        if (/paint record/i.test(err?.message ?? '')) needRepaintRetry = true;
      }
    }
    if (allUploaded && state.needUploadAll) state.needUploadAll = false;
  } else {
    for (const r of state.rows) {
      if (!r.removed && !textures.has(r.el) && r.el.isConnected) {
        try {
          const handle = stage.upload(r.el);
          if (handle) textures.set(r.el, handle);
        } catch {
          needRepaintRetry = true;
        }
      }
    }
  }

  if (!stage.begin([0.078, 0.094, 0.129, 1.0])) return;
  gl.disable(gl.CULL_FACE);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
  const prevVao = gl.getParameter(gl.VERTEX_ARRAY_BINDING);

  const { slots, contentHeight } = computeVisibleSlots(state.rows, rowW, ROW_H, feedViewport.scrollTop, ch);
  syncScrollTrackHeight(contentHeight);

  const modeNum = state.mode === 'peel' ? 0 : 1;

  for (const s of slots) {
    const { row, drawX, drawY, slotH, visible } = s;
    row.lastDrawY = drawY;
    syncRowGeometry(canvas, row, drawX, drawY, rowW, visible);
    if (!visible) continue;

    if (Math.abs(row.offsetX) > 0.5 || row.committing || row.collapse < 0.995) {
      drawStrip(gl, gpu, cw, ch, row, drawX, drawY, rowW, slotH, modeNum);
    }

    const handle = textures.get(row.el);
    if (handle) {
      drawRowMesh(gl, gpu, handle, cw, ch, row, drawX, drawY, rowW, ROW_H, modeNum);
    }
  }

  gl.bindVertexArray(prevVao);
  gl.useProgram(prevProg);

  if (needRepaintRetry) canvas.requestPaint?.();
}

function drawRoundedRect2D(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function drawScene2D() {
  if (!ctx2d || state.route !== '2d') return;
  const { cw, ch, rowW } = measureStageMetrics();
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const bw = Math.max(1, Math.round(cw * dpr));
  const bh = Math.max(1, Math.round(ch * dpr));
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;

  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx2d.fillStyle = '#141821';
  ctx2d.fillRect(0, 0, cw, ch);

  const { slots, contentHeight } = computeVisibleSlots(state.rows, rowW, ROW_H, feedViewport.scrollTop, ch);
  syncScrollTrackHeight(contentHeight);

  for (const s of slots) {
    const { row, drawX, drawY, slotH, visible } = s;
    row.lastDrawY = drawY;
    if (!visible || row.removed || slotH <= 1) {
      row.el.inert = true;
      continue;
    }
    row.el.inert = Math.abs(row.offsetX) > rowW * 0.25 || row.committing || row.collapse < 0.88;

    const absDx = Math.abs(row.offsetX);
    if (absDx > 0.5 || row.committing || row.collapse < 0.995) {
      const isArchive = row.action === 'archive' || (row.action === null && row.offsetX >= 0);
      ctx2d.save();
      drawRoundedRect2D(ctx2d, drawX, drawY, rowW, slotH, 12);
      ctx2d.fillStyle = isArchive ? '#15803d' : '#b91c1c';
      ctx2d.fill();
      ctx2d.fillStyle = '#ffffff';
      ctx2d.font = '600 13px system-ui, sans-serif';
      ctx2d.textAlign = isArchive ? 'left' : 'right';
      ctx2d.textBaseline = 'middle';
      ctx2d.fillText(isArchive ? 'Archive' : 'Delete', isArchive ? drawX + 18 : drawX + rowW - 18, drawY + slotH * 0.5);
      ctx2d.restore();
    }

    if (row.collapse > 0.05) {
      ctx2d.save();
      ctx2d.translate(drawX + row.offsetX, drawY);
      if (row.collapse < 0.998) {
        ctx2d.scale(1, row.collapse);
      }
      try {
        ctx2d.drawElementImage(row.el, 0, 0, rowW, ROW_H);
      } catch {}
      ctx2d.restore();
    }
  }
}
// #endregion render-loop

// --- Animation loop (sleeps cleanly when settled or offscreen) ---
function stepFrame(now) {
  state.rafId = 0;
  if (!state.inView || document.hidden || state.route === 'plain') return;

  const dt = state.lastFrameTime ? (now - state.lastFrameTime) / 1000 : 1 / 60;
  state.lastFrameTime = now;
  const rowW = state.cachedRowW || 340;
  let anyMoving = false;
  const finished = [];

  for (const row of state.rows) {
    if (row.removed) continue;
    const isDragging = state.session?.rowId === row.id && state.session.lock === 'horizontal';
    if (stepRowPhysics(row, rowW, dt, state.reducedMotion, isDragging)) {
      anyMoving = true;
    }
    if (row.committing && row.collapse <= 0.002) {
      finished.push(row);
    }
  }

  for (const row of finished) {
    finalizeRemoval(row);
  }

  if (state.route === 'webgl') drawSceneWebGL();
  else if (state.route === '2d') drawScene2D();

  if (anyMoving) {
    state.rafId = requestAnimationFrame(stepFrame);
  } else {
    state.lastFrameTime = 0;
  }
}

function wakeAnim() {
  if (!state.inView || document.hidden || state.route === 'plain') return;
  if (!state.rafId) {
    state.lastFrameTime = performance.now();
    state.rafId = requestAnimationFrame(stepFrame);
  }
}

function stopAnim() {
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }
  state.lastFrameTime = 0;
}

// --- Plain HTML Fallback & Context-Loss Recovery ---
function enterPlainFallback(reason) {
  if (state.route === 'plain') {
    setStatusBanner(reason);
    return;
  }
  stopAnim();
  state.route = 'plain';
  stageBox.classList.add('plain');
  canvas.hidden = true;
  plainList.hidden = false;
  syncScrollTrackHeight(0);
  for (const row of state.rows) {
    if (row.removed) continue;
    row.el.inert = false;
    plainList.append(row.el);
  }
  setStatusBanner(reason);
  updateCounts();
  setTelemetry('Plain HTML fallback active: Star, Checkbox, Archive, Delete and Undo controls work directly.');
}

function leavePlainFallback(nextRoute) {
  state.route = nextRoute;
  stageBox.classList.remove('plain');
  canvas.hidden = false;
  plainList.hidden = true;
  for (const row of state.rows) {
    if (row.removed) continue;
    canvas.append(row.el);
  }
  state.needUploadAll = true;
  setStatusBanner('');
  updateCounts();
  requestCanvasPaint();
}

// --- Pointer & Touch Arbitration Wiring ---
function isControlTarget(target) {
  return !!target?.closest?.('button, input, label, a');
}

function findRowForPointer(e) {
  const hitRowEl = e.target?.closest?.('.mail-row');
  if (hitRowEl) {
    const match = state.rows.find((r) => r.el === hitRowEl && !r.removed && !r.committing);
    if (match) return match;
  }
  const rect = canvas.getBoundingClientRect();
  const py = e.clientY - rect.top;
  const rowW = state.cachedRowW || 340;
  const { slots } = computeVisibleSlots(state.rows, rowW, ROW_H, feedViewport.scrollTop, rect.height || 368);
  for (const s of slots) {
    if (!s.visible || s.row.committing) continue;
    if (py >= s.drawY && py <= s.drawY + s.slotH) return s.row;
  }
  return null;
}

canvas.addEventListener('click', (e) => {
  if (performance.now() < state.suppressClickUntil) {
    e.preventDefault();
    e.stopPropagation();
    state.suppressClickUntil = 0;
  }
}, true);

canvas.addEventListener('pointerdown', (e) => {
  if (state.route === 'plain') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  const row = findRowForPointer(e);
  if (!row) return;
  const rect = canvas.getBoundingClientRect();
  const localY = e.clientY - rect.top;

  state.session = createSwipeSession({
    rowId: row.id,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    startLocalY: localY,
    startTime: performance.now(),
    startedOnControl: isControlTarget(e.target),
  });
});

canvas.addEventListener('touchmove', (e) => {
  if (state.session?.lock === 'horizontal' && e.cancelable) {
    e.preventDefault();
  }
}, { passive: false });

window.addEventListener('pointermove', (e) => {
  const s = state.session;
  if (!s || e.pointerId !== s.pointerId) return;
  const row = state.rows.find((r) => r.id === s.rowId);
  if (!row || row.removed || row.committing) {
    state.session = null;
    return;
  }

  const prevLock = s.lock;
  const nextLock = s.step(e.clientX, e.clientY, performance.now());

  if (prevLock === 'pending' && nextLock === 'horizontal') {
    s.captured = true;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    canvas.classList.add('dragging');
    state.suppressClickUntil = performance.now() + 360;
    const relY = ((s.startLocalY - row.lastDrawY) / ROW_H) * 2 - 1;
    row.dragTiltY = Math.max(-1, Math.min(1, relY));
    setTelemetry(`Locked horizontal ${state.mode === 'peel' ? '3D peel' : 'elastic taffy'} on row ${row.id + 1}.`);
  } else if (prevLock === 'pending' && nextLock === 'vertical') {
    setTelemetry('Arbitration locked vertical scroll (|dy| > 8 px).');
  }

  if (nextLock === 'horizontal') {
    const rowW = state.cachedRowW || 340;
    const effDx = s.effectiveDx(e.clientX);
    const thresh = rowW * COMMIT_FRACTION;
    const nowOver = Math.abs(effDx) >= thresh;
    if (nowOver && !s.crossedThreshold) {
      s.crossedThreshold = true;
      row.pulse = 1.0;
      try { navigator.vibrate?.(12); } catch {}
      setTelemetry(`Past 42% commit threshold: release to ${effDx >= 0 ? 'Archive' : 'Delete'}.`);
    } else if (!nowOver && s.crossedThreshold) {
      s.crossedThreshold = false;
      setTelemetry('Pulled back inside 42% threshold: release to snap back.');
    }
    row.offsetX = effDx;
    row.targetX = effDx;
    row.velX = 0;
    wakeAnim();
  }
});

function finishPointer(e) {
  const s = state.session;
  if (!s || e.pointerId !== s.pointerId) return;
  state.session = null;
  if (s.captured) {
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  }
  canvas.classList.remove('dragging');

  const row = state.rows.find((r) => r.id === s.rowId);
  if (!row || row.removed || row.committing) return;

  if (s.lock === 'horizontal') {
    state.suppressClickUntil = performance.now() + 260;
    const rowW = state.cachedRowW || 340;
    const absDx = Math.abs(row.offsetX);
    const flick = Math.abs(s.vx) > 620 && Math.sign(s.vx) === Math.sign(row.offsetX) && absDx > rowW * 0.20;
    if (e.type === 'pointerup' && (absDx >= rowW * COMMIT_FRACTION || flick)) {
      commitRow(row, row.offsetX >= 0 ? 'archive' : 'delete');
    } else {
      row.targetX = 0;
      row.velX = e.type === 'pointerup' ? s.vx * 0.35 : 0;
      wakeAnim();
      setTelemetry('Released below 42% threshold: sprang back.');
    }
  }
}

window.addEventListener('pointerup', finishPointer);
window.addEventListener('pointercancel', finishPointer);

feedViewport.addEventListener('scroll', () => {
  if (state.route === 'webgl') drawSceneWebGL();
  else if (state.route === '2d') drawScene2D();
}, { passive: true });

// --- Controls & Lifecycle ---
function setMode(nextMode) {
  if (state.mode === nextMode) return;
  state.mode = nextMode;
  modePeelBtn.setAttribute('aria-pressed', String(nextMode === 'peel'));
  modeTaffyBtn.setAttribute('aria-pressed', String(nextMode === 'taffy'));
  if (state.route === 'webgl') drawSceneWebGL();
  else if (state.route === '2d') drawScene2D();
  setTelemetry(`Switched to ${nextMode === 'peel' ? 'Sticker peel (3D curl)' : 'Elastic taffy'} mode.`);
}

modePeelBtn.addEventListener('click', () => setMode('peel'));
modeTaffyBtn.addEventListener('click', () => setMode('taffy'));
demoSwipeBtn.addEventListener('click', triggerDemoSwipe);
undoBtn.addEventListener('click', undoLast);
resetBtn.addEventListener('click', resetList);
emptyResetBtn.addEventListener('click', resetList);

reducedMotionQuery?.addEventListener?.('change', (e) => {
  state.reducedMotion = e.matches;
});

if (typeof ResizeObserver !== 'undefined') {
  const ro = new ResizeObserver(() => {
    measureStageMetrics();
    if (state.route === 'webgl') drawSceneWebGL();
    else if (state.route === '2d') drawScene2D();
  });
  ro.observe(feedViewport);
}

if (typeof IntersectionObserver !== 'undefined') {
  const io = new IntersectionObserver(([entry]) => {
    state.inView = !!entry?.isIntersecting;
    if (state.inView) {
      requestCanvasPaint();
    } else {
      stopAnim();
    }
  }, { rootMargin: '120px' });
  io.observe(stageBox);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAnim();
  } else if (state.inView) {
    requestCanvasPaint();
  }
});

// Gentle live time badge tick (paused offscreen and well clear of initial load)
setInterval(() => {
  if (!state.inView || document.hidden || state.route === 'init') return;
  let touched = false;
  for (const r of state.rows) {
    if (r.removed) continue;
    r.ageMinutes++;
    r.timeEl.textContent = formatAge(r.ageMinutes);
    touched = true;
  }
  if (touched) requestCanvasPaint();
}, 60000);

// --- Boot ---
initRows(true);
measureStageMetrics();

if (glSupported) {
  try {
    stage = new ElementGL(canvas, {
      fragment: PASSTHROUGH_FRAG,
      onLost() {
        gpu = null;
        textures.clear();
        enterPlainFallback('The WebGL 2 context was lost. All live rows moved into plain HTML so controls stay usable.');
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
    enterPlainFallback(`Could not start ElementGL (${err?.message ?? err}). Showing plain HTML list.`);
  }
} else if (canvas2dSupported) {
  ctx2d = canvas.getContext('2d');
  if (ctx2d) {
    state.route = '2d';
    setStatusBanner('WebGL 2 texElementSubImage2D() is not available here, so this page uses the 2D 5-argument drawElementImage() fallback.');
    canvas.addEventListener('contextlost', (e) => {
      e.preventDefault();
      enterPlainFallback('The 2D canvas context was lost. Live rows moved into plain HTML.');
    });
    canvas.addEventListener('contextrestored', () => {
      leavePlainFallback('2d');
    });
    canvas.addEventListener('paint', drawScene2D);
    canvas.requestPaint?.();
  } else {
    enterPlainFallback('Could not open a 2D canvas context. Showing plain HTML list.');
  }
} else {
  enterPlainFallback('HTML-in-canvas is not available in this browser, so the inbox rows are shown as plain HTML.');
}

// --- Live checks (tap-gated via <meta name="checks" content="tap">) ---
const tbody = document.getElementById('tests');

function buildFixtureRow(labelText, bg = '#fcfbf8') {
  const row = document.createElement('article');
  row.setAttribute('drawable', '');
  row.style.cssText = `position:absolute;left:0;top:0;width:256px;height:88px;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-radius:12px;background:${bg};color:#181a1f;font:600 13px system-ui,sans-serif;`;
  const chk = document.createElement('input');
  chk.type = 'checkbox';
  chk.className = 'row-check';
  chk.style.cssText = 'width:24px;height:24px;margin:0;flex:none;';
  const title = document.createElement('span');
  title.textContent = labelText;
  title.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'star-btn';
  btn.textContent = '★';
  btn.style.cssText = 'width:40px;height:40px;flex:none;';
  row.append(chk, title, btn);
  return { row, chk, btn };
}

const checks = [
  {
    name: 'ElementGL uploads live drawable rows via texElementSubImage2D() and draws the curled peel mesh',
    why: 'Mounts an isolated drawable row inside ElementGL on testStage(), uploads it with stage.upload(), renders the emerald reveal strip and 28x10 Sticker Peel mesh, verifies gl.getError() === 0, and samples pixels once.',
    run: async () => {
      if (!glSupported) throw new Error('texElementSubImage2D() is not supported in this browser');
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:280px;height:124px;';
      const { row } = buildFixtureRow('Curl fixture row');
      c.append(row);
      box.append(c);

      const fx = new ElementGL(c, {
        fragment: PASSTHROUGH_FRAG,
        attributes: { preserveDrawingBuffer: true },
      });
      const localGpu = buildGpuResources(fx.gl);
      const mockRow = {
        el: row,
        offsetX: 175,
        dragTiltY: -0.2,
        collapse: 1,
        committing: false,
        action: null,
        pulse: 0,
      };
      let glErr = 0;

      const drawFixture = () => {
        const tex = fx.upload(row);
        if (!fx.begin([0.078, 0.094, 0.129, 1.0]) || !tex) return;
        const gl = fx.gl;
        gl.disable(gl.CULL_FACE);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        drawStrip(gl, localGpu, 280, 124, mockRow, 12, 18, 256, 88, 0);
        drawRowMesh(gl, localGpu, tex, 280, 124, mockRow, 12, 18, 256, 88, 0);
        glErr = gl.getError();
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        if (glErr !== 0) throw new Error(`WebGL error 0x${glErr.toString(16)} after curled mesh draw`);

        const gl = fx.gl;
        const sample = (cssX, cssY) => {
          const px = new Uint8Array(4);
          const x = Math.min(c.width - 1, Math.max(0, Math.round(cssX * (c.width / 280))));
          const y = Math.min(c.height - 1, Math.max(0, Math.round((124 - cssY) * (c.height / 124))));
          gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return Array.from(px);
        };
        const stripPx = sample(36, 62);
        const peelPx = sample(124, 62);
        const flatPx = sample(220, 62);
        if (!(stripPx[1] > stripPx[0] && stripPx[1] > 70)) {
          throw new Error(`exposed Archive strip was not emerald: rgba(${stripPx.join(',')})`);
        }
        if (peelPx[3] < 200 || flatPx[3] < 200) {
          throw new Error(`curled mesh pixel empty: peel rgba(${peelPx.join(',')}), flat rgba(${flatPx.join(',')})`);
        }
        return `gl.getError() === 0; strip rgba(${stripPx.join(',')}), curl rgba(${peelPx.join(',')}), flat rgba(${flatPx.join(',')})`;
      } finally {
        disposeGpuResources(fx.gl, localGpu);
        fx.dispose();
      }
    },
  },
  {
    name: 'Direction-lock angle arbitration locks horizontal swipe (|dx| > 8, |dx| > |dy| * 1.4) vs vertical scroll (|dy| > 8)',
    why: 'Verifies decideLock() and createSwipeSession() across deadzone, horizontal peel lock, 45-degree diagonal safety, and vertical scroll lock on an isolated fixture.',
    run: async () => {
      if (decideLock(5, 4) !== 'pending') throw new Error('expected pending inside 8 px deadzone');
      if (decideLock(14, 5) !== 'horizontal') throw new Error('expected horizontal lock for (14, 5)');
      if (decideLock(-15, 6) !== 'horizontal') throw new Error('expected horizontal lock for (-15, 6)');
      if (decideLock(4, 14) !== 'vertical') throw new Error('expected vertical lock for (4, 14)');
      if (decideLock(10, 10) !== 'vertical') throw new Error('expected 45-deg diagonal (10, 10) to yield to vertical scroll');

      const horiz = createSwipeSession({ rowId: 0, pointerId: 1, startX: 40, startY: 50, startTime: 100 });
      if (horiz.step(45, 52, 116) !== 'pending') throw new Error('horizontal session locked too early inside 8 px');
      if (horiz.step(55, 55, 132) !== 'horizontal') throw new Error('horizontal session failed to lock at dx=15, dy=5');
      if (horiz.step(96, 85, 148) !== 'horizontal') throw new Error('horizontal lock did not stick after vertical drift');
      const eff = horiz.effectiveDx(96);

      const vert = createSwipeSession({ rowId: 1, pointerId: 2, startX: 40, startY: 50, startTime: 200 });
      if (vert.step(43, 62, 216) !== 'vertical') throw new Error('vertical session failed to lock at dx=3, dy=12');
      if (vert.step(80, 95, 232) !== 'vertical') throw new Error('vertical lock did not stick after horizontal drift');

      return `deadzone=pending, (14,5)->horizontal (effDx=${eff.toFixed(0)} px), (10,10)->vertical, (3,12)->vertical`;
    },
  },
  {
    name: 'Commit removes row texture via forget() and Undo restores it cleanly without orphaned textures',
    why: 'Uploads 3 drawable rows in an isolated ElementGL canvas, archives and removes row 2 via stage.forget(), verifies has(row2) === false, then restores row 2 via Undo and confirms re-upload with gl.getError() === 0.',
    run: async () => {
      if (!glSupported) throw new Error('texElementSubImage2D() is not supported in this browser');
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:280px;height:290px;';
      const items = [0, 1, 2].map((i) => buildFixtureRow(`Item ${i + 1}`));
      for (const it of items) c.append(it.row);
      box.append(c);

      const fx = new ElementGL(c, { fragment: PASSTHROUGH_FRAG });
      let glErr = 0;
      const drawFixture = () => {
        for (const el of c.children) fx.upload(el);
        if (!fx.begin([0, 0, 0, 0])) return;
        let y = 10;
        for (const el of c.children) {
          fx.quad(el, ElementGL.rect(c, 12, y, 256, 88));
          y += 96;
        }
        glErr = fx.gl.getError();
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);
        if (!items.every((it) => fx.has(it.row))) {
          throw new Error('initial upload did not track all 3 rows');
        }

        // Archive/remove middle row and forget its GPU texture.
        const middle = items[1].row;
        middle.remove();
        fx.forget(middle);
        if (fx.has(middle)) throw new Error('orphaned texture remained in ElementGL after forget()');
        if (c.children.length !== 2) throw new Error(`expected 2 children after commit, got ${c.children.length}`);
        await nextPaint(c);

        // Undo restore before row 3 and re-upload.
        c.insertBefore(middle, items[2].row);
        await nextPaint(c);
        await nextPaint(c);
        if (!fx.has(middle)) throw new Error('Undo did not re-upload restored row texture');
        if (c.children.length !== 3) throw new Error(`expected 3 children after Undo, got ${c.children.length}`);
        if (glErr !== 0) throw new Error(`WebGL error 0x${glErr.toString(16)} after Undo restore`);

        return `3 uploaded -> forget() cleared middle texture (has=${false}) -> Undo restored 3 rows, gl.getError() === 0`;
      } finally {
        fx.dispose();
      }
    },
  },
  {
    name: 'updateElementGeometry() keeps row Star and checkbox controls clickable across collapse',
    why: 'Places two drawable rows on testStage() with syncRowGeometry(), verifies elementsFromPoint() hits Star and checkbox, then collapses row 1 offstage and confirms row 2 controls stay hit-testable at their collapsed position.',
    run: async () => {
      if (!glSupported || !('updateElementGeometry' in HTMLCanvasElement.prototype)) {
        throw new Error('ElementGL or updateElementGeometry() is not supported');
      }
      const box = testStage();
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.style.cssText = 'display:block;width:280px;height:216px;';
      const r0 = buildFixtureRow('Row one');
      const r1 = buildFixtureRow('Row two');
      c.append(r0.row, r1.row);
      box.append(c);

      const fx = new ElementGL(c, { fragment: PASSTHROUGH_FRAG });
      const state0 = { el: r0.row, offsetX: 0, collapse: 1, committing: false, removed: false, lastHitKey: '' };
      const state1 = { el: r1.row, offsetX: 0, collapse: 1, committing: false, removed: false, lastHitKey: '' };

      const drawFixture = () => {
        if (!state0.removed) fx.upload(r0.row);
        fx.upload(r1.row);
        if (!fx.begin([0, 0, 0, 0])) return;
        if (!state0.removed) {
          fx.quad(r0.row, ElementGL.rect(c, 12, 12, 256, 88));
        }
        const y1 = state0.removed ? 12 : 110;
        fx.quad(r1.row, ElementGL.rect(c, 12, y1, 256, 88));
        syncRowGeometry(c, state0, 12, 12, 256, !state0.removed);
        syncRowGeometry(c, state1, 12, y1, 256, true);
      };
      c.addEventListener('paint', drawFixture);

      try {
        await nextPaint(c);
        await nextPaint(c);

        const rect = c.getBoundingClientRect();
        const star0X = rect.left + 12 + 256 - 32;
        const star0Y = rect.top + 12 + 44;
        const chk1X = rect.left + 12 + 24;
        const chk1Y = rect.top + 110 + 44;

        const hitStar0 = document.elementsFromPoint(star0X, star0Y);
        const hitChk1 = document.elementsFromPoint(chk1X, chk1Y);
        if (!hitStar0.includes(r0.btn)) {
          throw new Error(`initial Star 0 missed: got ${hitStar0.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        }
        if (!hitChk1.includes(r1.chk)) {
          throw new Error(`initial Checkbox 1 missed: got ${hitChk1.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        }

        // Collapse row 0 out and verify row 1 moved up to y=12 cleanly.
        state0.removed = true;
        await nextPaint(c);
        await nextPaint(c);

        const hitStar1Collapsed = document.elementsFromPoint(rect.left + 12 + 256 - 32, rect.top + 12 + 44);
        const hitChk1Collapsed = document.elementsFromPoint(rect.left + 12 + 24, rect.top + 12 + 44);
        if (!hitStar1Collapsed.includes(r1.btn)) {
          throw new Error(`collapsed Star 1 missed at (236, 56): got ${hitStar1Collapsed.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        }
        if (!hitChk1Collapsed.includes(r1.chk)) {
          throw new Error(`collapsed Checkbox 1 missed at (36, 56): got ${hitChk1Collapsed.slice(0, 3).map((e) => e.tagName).join(', ')}`);
        }
        return `initial hits: r0 button & r1 input; post-collapse hits at y=12: r1 ${hitStar1Collapsed[0]?.tagName} & ${hitChk1Collapsed[0]?.tagName}`;
      } finally {
        fx.dispose();
      }
    },
  },
];

if (tbody) runTests(tbody, checks);
