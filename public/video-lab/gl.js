// gl.js: the one WebGL canvas of /video-lab/. Three scenes share it (the title
// editor, the cinema screen, the timeline skin), so the page holds one context.
// Each scene owns some drawable children of the canvas and draws them as quads
// through one fragment shader with a mode switch.
//
//   const stage = createStage(canvas, { onFail });
//   stage.add('editor', scene);     // scene: { root, paint(view, now), animated(), enter(), leave() }
//   stage.use('editor');

import { ElementGL, supported } from '/lib/element-gl.js';
import { LiveTransition } from '/lib/live-transition.js';

export { supported };

/** Transitions between two shots. The last three are the shaders /transitions/ uses, taken from lib/live-transition.js. */
export const TRANSITIONS = ['fade', 'wipe', 'ripple', 'pixelate', 'swirl'];
const borrowed = ['ripple', 'pixelate', 'swirl'].map((name) => LiveTransition.shaders[name].glsl.replace('vec4 transition(', `vec4 tr_${name}(`)).join('\n');

// #region shader
export const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uTex;    // the element this quad draws
uniform sampler2D uB;      // a second element: the next shot, or the cinema screen for the floor
uniform vec2 uSize;        // element size, CSS pixels
uniform float uTime;
uniform int uMode;         // 0 the element as it is, 1 transition, 2 timeline skin, 3 screen, 4 floor
uniform int uKind;         // which transition, or which skin
uniform float progress;    // transition progress, 0 to 1
uniform float ratio;       // width / height
uniform vec2 origin;       // where a ripple starts, uv with y up
uniform vec4 uBox;         // the timeline of the native controls: x0, y0, x1, y1 from the top left. x1 < x0: not found
uniform float uPlayed;     // currentTime / duration
uniform float uAlpha;
in vec2 vUv;
out vec4 outColor;

// gl-transitions convention: uv has y up.
vec4 getFromColor(vec2 uv) { return texture(uTex, vec2(uv.x, 1.0 - uv.y)); }
vec4 getToColor(vec2 uv) { return texture(uB, vec2(uv.x, 1.0 - uv.y)); }
${borrowed}
vec4 tr_fade(vec2 uv) { return mix(getFromColor(uv), getToColor(uv), progress); }
vec4 tr_wipe(vec2 uv) {
  // A soft edge that crosses from left to right. The old shot is pushed along it.
  float edge = progress * 1.2 - 0.1;
  float k = smoothstep(edge - 0.08, edge + 0.08, uv.x);
  return mix(getToColor(uv), getFromColor(uv - vec2((1.0 - k) * 0.08, 0.0)), k);
}

vec3 hue(float h) { return 0.5 + 0.5 * cos(6.2832 * (h + vec3(0.0, 0.33, 0.67))); }

// The timeline skin. Only pixels inside the measured box of the native timeline change, plus a glow next to it.
vec4 skin(vec2 uv) {
  vec4 base = texture(uTex, uv);
  if (uBox.z <= uBox.x || uKind == 0) return base;
  vec2 lo = uBox.xy, hi = uBox.zw;
  float cy = (lo.y + hi.y) * 0.5, half_ = (hi.y - lo.y) * 0.5;
  float pad = 22.0 / uSize.x;                                  // the native track starts and ends 22 CSS pixels inside the box (measured)
  float head = mix(lo.x + pad, hi.x - pad, uPlayed);
  float x = (uv.x - lo.x) / (hi.x - lo.x);                     // 0 to 1 along the strip
  float d = (uv.y - cy) / half_;                               // -1 to 1 across it
  bool inside = uv.x >= lo.x && uv.x <= hi.x && abs(d) <= 1.0;
  float played = step(uv.x, head);
  vec3 col = base.rgb;
  if (inside) {
    // The native strip is covered with the colours of the picture column above it, darkened.
    col = texture(uTex, vec2(uv.x, 0.5)).rgb * 0.22;
    if (uKind == 1) {
      // Neon: the played part is a bright bar with a wave moving along it. The rest is a row of dots.
      vec3 ink = hue(x * 0.6 + uTime * 0.05);
      float wave = 0.6 + 0.4 * sin(x * 90.0 - uTime * 6.0 + d * 1.5);
      float core = exp(-d * d * 2.5);
      vec3 lit = ink * (0.5 + 0.9 * wave) * (0.45 + core) + vec3(1.0) * exp(-d * d * 30.0) * 0.6;
      vec3 dots = vec3(0.6) * step(0.5, fract(x * 60.0)) * exp(-d * d * 14.0);
      col += mix(dots, lit, played);
    } else if (uKind == 2) {
      // Blocks: 36 cells. A lit cell has the colour of the picture above it.
      float cell = floor(x * 36.0), fx = fract(x * 36.0);
      float lit = step((cell + 0.5) / 36.0 * (hi.x - lo.x) + lo.x, head);
      vec3 pic = texture(uTex, vec2((cell + 0.5) / 36.0 * (hi.x - lo.x) + lo.x, 0.45)).rgb;
      float shape = step(0.12, fx) * step(fx, 0.88) * step(abs(d), 0.62);
      col = mix(col, mix(vec3(0.16), pic * 1.3 + 0.12, lit), shape);
    } else {
      // Scope: the brightness of the picture column above each point, drawn as a graph. Filled on the played part.
      float lum = dot(texture(uTex, vec2(uv.x, 0.45)).rgb, vec3(0.2126, 0.7152, 0.0722));
      float y = 1.0 - (d * 0.5 + 0.5);                          // 0 at the bottom of the strip
      float curve = 0.12 + lum * 0.8;
      float trace = 1.0 - smoothstep(0.0, 0.14, abs(y - curve));
      col += vec3(0.25, 1.0, 0.55) * (trace + played * step(y, curve) * 0.45);
    }
  }
  // Light from the played part spills upwards, and a glow sits at the playhead. Both reach outside the strip.
  float up = max(0.0, lo.y - uv.y) / max(half_, 1e-4);
  if (uv.y < lo.y && uv.x >= lo.x && uv.x <= hi.x) col += hue(x * 0.6 + uTime * 0.05) * played * exp(-up * 0.9) * 0.3;
  vec2 g = (uv - vec2(head, cy)) * vec2(ratio, 1.0) / max(half_, 1e-4);
  col += hue(uPlayed * 0.6 + uTime * 0.05) * exp(-dot(g, g) * 0.35) * 0.9;
  return vec4(col, base.a);
}

void main() {
  vec4 c;
  if (uMode == 1) {
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    c = uKind == 1 ? tr_wipe(uv) : uKind == 2 ? tr_ripple(uv) : uKind == 3 ? tr_pixelate(uv) : uKind == 4 ? tr_swirl(uv) : tr_fade(uv);
  } else if (uMode == 2) {
    c = skin(vUv);
  } else if (uMode == 4) {
    // The floor: the seat map, lit by the average colour of the screen. Brighter near the screen (the top edge).
    c = texture(uTex, vUv);
    vec3 light = vec3(0.0);
    for (int i = 0; i < 8; i++) light += texture(uB, vec2((float(i) + 0.5) / 8.0, 0.35 + 0.3 * fract(float(i) * 0.37))).rgb;
    c.rgb *= 0.35 + (light / 8.0) * 1.6 * (1.0 - vUv.y * 0.7);
  } else {
    c = texture(uTex, vUv);
    // Mode 3 with uAlpha below 1 is the reflection of the screen in the floor: it fades away from the floor.
    if (uMode == 3 && uAlpha < 1.0) c.a *= vUv.y * vUv.y;
  }
  c.a *= uAlpha;
  outColor = vec4(c.rgb * c.a, c.a);
}`;
// #endregion shader

// ---- 4×4 matrices, column-major, as plain arrays ----
export const mat = {
  mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    return o;
  },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  },
  lookAt(eye, target, up = [0, 1, 0]) {
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((n) => n / l); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
  },
  /** The unit square (0,0)-(1,1) onto the parallelogram at `o` with edges `u` (along x) and `v` (along y). */
  plane(o, u, v) {
    return [u[0], u[1], u[2], 0, v[0], v[1], v[2], 0, 0, 0, 1, 0, o[0], o[1], o[2], 1];
  },
};

// #region place
/**
 * Tell the browser where a quad drawn by WebGL is, so taps reach the element.
 * `clip` takes the unit square to clip space (what ElementGL.quad() was given).
 * The result takes element pixels to canvas CSS pixels, with the perspective divide.
 */
export function hitMatrix(canvas, element, clip) {
  const W = canvas.clientWidth, H = canvas.clientHeight;
  const toCss = [W / 2, 0, 0, 0, 0, -H / 2, 0, 0, 0, 0, 1, 0, W / 2, H / 2, 0, 1];
  const fromPx = [1 / element.offsetWidth, 0, 0, 0, 0, 1 / element.offsetHeight, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  // The depth row is dropped: hit testing needs x, y and w only.
  const m = mat.mul(toCss, mat.mul(clip, fromPx));
  m[2] = m[6] = m[10] = m[14] = 0; m[10] = 1;
  return new DOMMatrix(m);
}
const placed = new WeakMap();
export function place(canvas, element, matrix) {
  const key = Array.from(matrix.toFloat32Array(), (n) => n.toFixed(3)).join();
  if (placed.get(element) === key) return;
  placed.set(element, key);
  canvas.updateElementGeometry?.(element, { canvasTransform: matrix });
  element.toggleAttribute('data-placed'); // Chromium 157 keeps old hit-test answers until an attribute changes
}
/** Move an element's hit box off the canvas (it is not drawn this frame). */
export const park = (canvas, element) => place(canvas, element, new DOMMatrix().translate(-99999, -99999));
// #endregion place

export function createStage(canvas, { onFail = () => {}, clear = [0.04, 0.045, 0.06, 1] } = {}) {
  let gl;
  try {
    gl = new ElementGL(canvas, {
      fragment: FRAGMENT,
      onLost: () => onFail('The WebGL context was lost. The demos on this canvas are stopped until it returns.'),
      onRestored: () => onFail(''),
    });
  } catch (err) {
    onFail(`WebGL 2 could not start: ${err.message}`);
    return null;
  }
  const scenes = new Map();
  let current = null, raf = 0, onScreen = true, grab = null;
  const full = () => ElementGL.rect(canvas, 0, 0, canvas.clientWidth, canvas.clientHeight);

  const view = {
    gl, canvas, full,
    /** texElementSubImage2D for one element. False when it has no picture yet. */
    upload(element) {
      try { return !!gl.upload(element); } catch (err) {
        if (!/paint record|not been painted|snapshot/i.test(err.message)) throw err;
        canvas.requestPaint(); // the element was shown in this frame: it has a picture in the next one
        return false;
      }
    },
    /** Draw an element on a quad. `second` is another uploaded element for unit 1. */
    quad(element, matrix, { mode = 0, kind = 0, second = null, alpha = 1, set = null } = {}) {
      gl.quad(element, matrix, (g, u) => {
        g.uniform1i(u('uMode'), mode);
        g.uniform1i(u('uKind'), kind);
        g.uniform1f(u('uAlpha'), alpha);
        g.uniform1f(u('ratio'), canvas.clientWidth / Math.max(1, canvas.clientHeight));
        g.uniform2f(u('origin'), 0.5, 0.5);
        g.uniform1i(u('uB'), 1);
        g.activeTexture(g.TEXTURE1);
        g.bindTexture(g.TEXTURE_2D, second ? textureOf(second) : null);
        g.activeTexture(g.TEXTURE0);
        set?.(g, u);
      });
    },
  };
  // ElementGL keeps its textures private. upload() returns the record, so the last one per element is kept here.
  const records = new WeakMap();
  const textureOf = (element) => records.get(element)?.tex ?? null;
  const rawUpload = gl.upload.bind(gl);
  gl.upload = (element) => { const t = rawUpload(element); if (t) records.set(element, t); return t; };
  view.record = (element) => records.get(element);

  canvas.addEventListener('paint', () => {
    if (gl.lost || !current) return;
    if (!gl.begin(clear)) return;
    current.paint(view, performance.now());
    if (grab) {
      const g = gl.gl, w = canvas.width, h = canvas.height, px = new Uint8Array(w * h * 4);
      g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
      const done = grab; grab = null;
      done({ data: px, width: w, height: h, at: (x, y) => { const i = (Math.floor((1 - y) * (h - 1)) * w + Math.floor(x * (w - 1))) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; } });
    }
  });

  const tick = () => {
    raf = 0;
    if (!onScreen || gl.lost || !current) return;
    if (current.animated?.()) canvas.requestPaint();
    raf = requestAnimationFrame(tick);
  };
  const wake = () => { if (!raf && onScreen) raf = requestAnimationFrame(tick); };
  const seen = new IntersectionObserver(([e]) => {
    onScreen = e.isIntersecting;
    if (onScreen) { current?.near?.(); wake(); canvas.requestPaint(); } else current?.away?.();
  }, { rootMargin: '150px 0px' });
  seen.observe(canvas);

  return {
    view, gl, scenes,
    get current() { return current; },
    add(name, scene) { scenes.set(name, scene); scene.name = name; for (const el of scene.elements()) el.hidden = true; },
    use(name) {
      const next = scenes.get(name);
      if (next === current) return;
      if (current) { current.leave?.(); for (const el of current.elements()) { el.hidden = true; } }
      current = next;
      for (const el of current.elements()) el.hidden = false;
      current.enter?.();
      if (onScreen) current.near?.();
      wake();
      canvas.requestPaint();
    },
    repaint() { canvas.requestPaint(); wake(); },
    /** The canvas as drawn in the next paint. For live checks only. at(x, y) takes 0 to 1 from the top left. */
    grab: () => new Promise((resolve) => { grab = resolve; canvas.requestPaint(); }),
    stop() { seen.disconnect(); cancelAnimationFrame(raf); onScreen = false; },
  };
}
