// glass-gl.js: a piece of glass, computed by a fragment shader, for the glass skin of <canvas-skin>.
//
//   import { glass, GLASS_DEFAULTS } from '/lib/glass-gl.js';
//   const out = glass(source, { sx, sy, sw, sh, x, y, cssWidth, cssHeight }, panel, settings);
//   if (out) ctx.drawImage(out.canvas, out.sx, out.sy, out.sw, out.sh, panel.x, panel.y, panel.width, panel.height);
//
// `source` is a plain canvas that holds what is behind the glass. The shader treats the panel as a slab
// of glass with a flat middle and a rounded rim, and for each pixel:
//
//   1. finds the distance to the edge of the rounded rectangle and the direction to it (a signed distance field)
//   2. gets the height of the glass surface there, and from the slope of the height the surface normal
//   3. bends the line of sight into the glass with Snell's law (refract(), with the refractive index),
//      once for red, green and blue with slightly different indices, and follows each to the back of the slab
//   4. reads the background where each ray lands, averaged over a small disc when the glass is frosted
//   5. adds light: a highlight where the rim faces the light, a weaker one on the far rim, and a
//      Fresnel term that makes steep parts of the surface reflect more
//
// One WebGL 2 context for the page, on a canvas that is never in the document. Every glass element
// uses it in turn and copies the result into its own 2D canvas with drawImage(). An element's picture
// can only be drawn by the canvas the element is in, but the background here is an ordinary canvas,
// so it can be a texture in a context that the wrappers share.
//
// glass() returns null when there is no WebGL 2 or the context is lost. The skin then draws its 2D version.

export const GLASS_DEFAULTS = {
  light: 315,        // direction the light comes from, in degrees clockwise from "up" (315 = upper left)
  rim: 14,           // width of the rounded rim, CSS px
  thickness: 22,     // height of the glass at its flat middle, CSS px
  ior: 1.5,          // refractive index. 1 is air (no bending), 1.5 is window glass, 2.4 is diamond
  dispersion: 0.06,  // difference of the index between red and blue
  frost: 1.5,        // radius of the blur of what is seen through the glass, CSS px
  specular: 1,       // strength of the highlights
  tint: 1,           // how much of the element's own colour is mixed into the glass. 0 is clear glass
};

const VERTEX = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos; gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0); }`;

// #region shader
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D uBack;
uniform vec2 uSize;        // panel size, CSS px
uniform vec4 uBackRect;    // uv of the panel's top left corner in uBack, and uv per CSS px
uniform float uRadius, uRim, uThick, uIor, uDisp, uFrost, uSpec, uScale;
uniform vec2 uLight;       // unit vector toward the light, on the screen (y down)
uniform vec4 uTint;
in vec2 vUv;
out vec4 outColor;

// Signed distance to a rounded rectangle: negative inside.
float sd(vec2 p) {
  vec2 q = abs(p) - uSize * 0.5 + uRadius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius;
}
// Height of the glass surface at a depth d inside the edge: a quarter circle over the rim, then flat.
float height(float d) {
  float t = clamp(d / uRim, 0.0, 1.0);
  return uThick * sqrt(max(1.0 - (1.0 - t) * (1.0 - t), 0.0));
}
vec3 back(vec2 p) { return texture(uBack, uBackRect.xy + (p + uSize * 0.5) * uBackRect.zw).rgb; }
// What is seen at p through glass with refractive index ior and surface normal n.
vec2 landing(vec2 p, vec3 n, float h, float ior) {
  vec3 r = refract(vec3(0.0, 0.0, -1.0), n, 1.0 / ior);    // Snell's law
  return p + r.xy / max(-r.z, 0.12) * h;                   // travel down to the back of the slab
}

void main() {
  vec2 p = (vUv - 0.5) * uSize;
  float dist = sd(p), d = -dist, e = 0.6;
  // Direction out of the shape, and the slope of the surface along it.
  vec2 out2 = vec2(sd(p + vec2(e, 0.0)) - sd(p - vec2(e, 0.0)), sd(p + vec2(0.0, e)) - sd(p - vec2(0.0, e)));
  out2 = out2 / max(length(out2), 1e-5);
  float slope = (height(d + e) - height(d - e)) / (2.0 * e);
  vec3 n = normalize(vec3(out2 * slope, 1.0));
  float h = height(d) + uThick * 0.25;

  vec2 pr = landing(p, n, h, uIor - uDisp), pg = landing(p, n, h, uIor), pb = landing(p, n, h, uIor + uDisp);
  vec3 col = vec3(0.0);
  if (uFrost > 0.05) {
    // Eight samples on a spiral, for glass that is not perfectly clear.
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 2.39996, rad = uFrost * sqrt((float(i) + 0.5) / 8.0);
      vec2 o = vec2(cos(a), sin(a)) * rad;
      col += vec3(back(pr + o).r, back(pg + o).g, back(pb + o).b);
    }
    col /= 8.0;
  } else col = vec3(back(pr).r, back(pg).g, back(pb).b);

  col = mix(col, uTint.rgb, uTint.a);

  // Light. tilt is 0 on the flat middle and near 1 where the rim is steep.
  float tilt = length(n.xy), facing = dot(out2, uLight);
  float near = pow(clamp(facing, 0.0, 1.0), 1.5), far = pow(clamp(-facing, 0.0, 1.0), 3.0);
  float edge = smoothstep(uRim, 0.0, d);
  float fresnel = 0.04 + 0.96 * pow(1.0 - n.z, 5.0);
  col += uSpec * (near * 0.9 + far * 0.45) * pow(tilt, 2.0) * edge;      // highlights on the rim
  col += uSpec * fresnel * 0.5;                                          // steep glass reflects the sky
  col *= 1.0 - 0.22 * tilt * clamp(-facing, 0.0, 1.0) * (1.0 - far);     // the side away from the light is darker
  col += uSpec * 0.07 * clamp(dot(p / uSize * 2.0, uLight), 0.0, 1.0);    // the half toward the light is a little brighter

  float alpha = clamp(0.5 - dist * uScale, 0.0, 1.0);
  outColor = vec4(col * alpha, alpha);
}`;
// #endregion shader

let state = null;   // { canvas, gl, program, uniforms, texture } | { failed: reason }

function start() {
  if (typeof document === 'undefined' || typeof WebGL2RenderingContext === 'undefined') return { failed: 'This browser has no WebGL 2.' };
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 128;
  // gfx-allow: webgl-context the page's one WebGL context, on a canvas outside the document, shared by every glass element; ElementGL draws elements and this draws from a plain canvas
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power' });
  if (!gl) return { failed: 'WebGL 2 gave no context.' };
  const made = { canvas, gl, lost: false };
  // #region lost
  // A lost context is not asked back. glass() returns null from then on and the skin draws in 2D.
  canvas.addEventListener('webglcontextlost', () => { made.lost = true; listeners.forEach((fn) => fn('The shared WebGL context was lost.')); });
  // #endregion lost
  const compile = (type, source) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindVertexArray(gl.createVertexArray());
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.disable(gl.BLEND);
  made.texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, made.texture);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  made.program = program; made.compile = compile; made.programs = new Map();
  made.uniforms = Object.fromEntries(['uBack', 'uSize', 'uBackRect', 'uRadius', 'uRim', 'uThick', 'uIor', 'uDisp', 'uFrost', 'uSpec', 'uScale', 'uLight', 'uTint'].map((n) => [n, gl.getUniformLocation(program, n)]));
  gl.uniform1i(made.uniforms.uBack, 0);
  return made;
}

const listeners = new Set();
/** Call fn(reason) if the shared context is lost, so the elements can be drawn again in 2D. */
export function onGlassLost(fn) { listeners.add(fn); }
/** 'webgl', or the reason the shader is not in use. Does not create the context. */
export function glassRoute() { return !state ? 'not started' : state.failed ? state.failed : state.lost ? 'The shared WebGL context was lost.' : 'webgl'; }

// #region render
/**
 * source: a plain canvas. copy: the part of it to use ({ sx, sy, sw, sh } in its pixels) and where that
 * part lies ({ x, y, width, height } in CSS px, in the same coordinates as the panel).
 * panel: { x, y, width, height, radius, tint: [r, g, b, a] } in CSS px. scale: device px per CSS px.
 */
export function glass(source, copy, panel, settings, scale) {
  if (!state) { try { state = start(); } catch (err) { state = { failed: `The glass shader did not compile: ${err.message}` }; } }
  if (state.failed || state.lost) return null;
  const { gl, canvas, uniforms: u } = state;
  if (gl.isContextLost()) { state.lost = true; return null; }
  gl.useProgram(state.program);
  const pw = Math.max(1, Math.round(panel.width * scale)), ph = Math.max(1, Math.round(panel.height * scale));
  if (canvas.width < pw) canvas.width = pw;          // the canvas only grows
  if (canvas.height < ph) canvas.height = ph;

  // Only the part of the source that lies behind this element is uploaded.
  gl.bindTexture(gl.TEXTURE_2D, state.texture);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, copy.sx); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, copy.sy);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, copy.sw, copy.sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);

  const s = { ...GLASS_DEFAULTS, ...settings };
  const rim = Math.max(0.5, Math.min(s.rim, panel.width / 2, panel.height / 2));
  const angle = (s.light * Math.PI) / 180;
  gl.viewport(0, canvas.height - ph, pw, ph);        // the top left pw by ph pixels of the canvas
  gl.uniform2f(u.uSize, panel.width, panel.height);
  gl.uniform4f(u.uBackRect, (panel.x - copy.x) / copy.width, (panel.y - copy.y) / copy.height, 1 / copy.width, 1 / copy.height);
  gl.uniform1f(u.uRadius, Math.max(0, Math.min(panel.radius, panel.width / 2, panel.height / 2)));
  gl.uniform1f(u.uRim, rim);
  gl.uniform1f(u.uThick, Math.min(s.thickness, rim * 2.2));   // a thin element cannot be a thick lens
  gl.uniform1f(u.uIor, Math.max(1, s.ior));
  gl.uniform1f(u.uDisp, s.dispersion);
  gl.uniform1f(u.uFrost, s.frost);
  gl.uniform1f(u.uSpec, s.specular);
  gl.uniform1f(u.uScale, scale);
  gl.uniform2f(u.uLight, Math.sin(angle), -Math.cos(angle));
  gl.uniform4f(u.uTint, panel.tint[0], panel.tint[1], panel.tint[2], Math.min(1, panel.tint[3] * s.tint));
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return { canvas, sx: 0, sy: 0, sw: pw, sh: ph };
}
// #endregion render

// ------------------------------------------------------------------------------------ other shaders
// #region shade
// The same context runs any other fragment shader a skin brings, so a page still has one WebGL context.
// A shader is written as the body of a function `vec4 shade(vec2 p)`: p is in CSS px from the panel's
// centre, and the answer is a colour with straight alpha. These are declared for it:
//
//   uSize (panel size, CSS px), uRadius, uScale (device px per CSS px), uTime (seconds), uSeed (0..1)
//   uBack + back(p): the picture given as `source`, read at a point in the panel's coordinates
//   sdBox(p): signed distance to the panel's rounded rectangle, negative inside
//   hash(vec2), noise(vec2), fbm(vec2): value noise
//   and one uniform for each entry of `values` (a number is a float, an array of 2 to 4 is a vector)
const HEAD = `#version 300 es
precision highp float;
uniform sampler2D uBack;
uniform vec2 uSize;
uniform vec4 uBackRect;
uniform float uRadius, uScale, uTime, uSeed;
in vec2 vUv;
out vec4 outColor;
float sdBox(vec2 p) { vec2 q = abs(p) - uSize * 0.5 + uRadius; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uRadius; }
vec4 back(vec2 p) { return texture(uBack, uBackRect.xy + (p + uSize * 0.5) * uBackRect.zw); }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p = p * 2.03 + 17.0; a *= 0.5; } return s; }
`;
const TAIL = `
void main() { vec4 c = shade((vUv - 0.5) * uSize); outColor = vec4(c.rgb * c.a, c.a); }`;

/**
 * Run a skin's shader over a panel. name: a key for the compiled program. body: GLSL with `vec4 shade(vec2 p)`.
 * panel: { width, height, radius } in CSS px, plus x, y when a source is given. values: uniforms by name.
 * source, copy: as for glass(). Returns { canvas, sx, sy, sw, sh } to draw with drawImage(), or null.
 */
export function shade(name, body, panel, scale, values = {}, source = null, copy = null) {
  if (!state) { try { state = start(); } catch (err) { state = { failed: `The glass shader did not compile: ${err.message}` }; } }
  if (state.failed || state.lost) return null;
  const { gl, canvas } = state;
  if (gl.isContextLost()) { state.lost = true; return null; }
  let made = state.programs.get(name);
  if (!made) {
    made = { failed: null, uniforms: new Map() };
    state.programs.set(name, made);
    try {
      const declared = Object.entries(values).map(([k, v]) => `uniform ${typeof v === 'number' ? 'float' : `vec${v.length}`} ${k};`).join('\n');
      const program = gl.createProgram();
      gl.attachShader(program, state.compile(gl.VERTEX_SHADER, VERTEX));
      gl.attachShader(program, state.compile(gl.FRAGMENT_SHADER, `${HEAD}${declared}\n${body}${TAIL}`));
      gl.bindAttribLocation(program, 0, 'aPos');
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(program));
      made.program = program;
    } catch (err) {
      made.failed = err.message;
      window.__gfx?.report?.('shader', `canvas-skin shader "${name}" did not compile`, { message: String(err.message).slice(0, 400) });
    }
  }
  if (made.failed) return null;
  const at = (k) => { if (!made.uniforms.has(k)) made.uniforms.set(k, gl.getUniformLocation(made.program, k)); return made.uniforms.get(k); };
  const pw = Math.max(1, Math.round(panel.width * scale)), ph = Math.max(1, Math.round(panel.height * scale));
  if (canvas.width < pw) canvas.width = pw;
  if (canvas.height < ph) canvas.height = ph;
  gl.useProgram(made.program);
  // panel.keep (an element) gives the picture a texture of its own, uploaded again only when panel.sig
  // changes. A skin that moves 20 times a second then uploads once, not 20 times a second.
  let held = null;
  if (panel.keep) {
    state.kept ??= new WeakMap();
    held = state.kept.get(panel.keep);
    if (!held) {
      held = { texture: gl.createTexture(), sig: null, copy: null };
      gl.bindTexture(gl.TEXTURE_2D, held.texture);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      state.kept.set(panel.keep, held);
    }
    if (!source) { if (held.sig !== panel.sig || !held.copy) return null; copy = held.copy; }
  }
  gl.bindTexture(gl.TEXTURE_2D, held ? held.texture : state.texture);
  if (copy) {
    if (source) {
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, copy.sx); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, copy.sy);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, copy.sw, copy.sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
      if (held) { held.sig = panel.sig; held.copy = { sx: 0, sy: 0, sw: copy.sw, sh: copy.sh, x: copy.x, y: copy.y, width: copy.width, height: copy.height }; }
    }
    gl.uniform4f(at('uBackRect'), ((panel.x ?? 0) - copy.x) / copy.width, ((panel.y ?? 0) - copy.y) / copy.height, 1 / copy.width, 1 / copy.height);
  }
  gl.uniform1i(at('uBack'), 0);
  gl.viewport(0, canvas.height - ph, pw, ph);
  gl.uniform2f(at('uSize'), panel.width, panel.height);
  gl.uniform1f(at('uRadius'), Math.max(0, Math.min(panel.radius ?? 0, panel.width / 2, panel.height / 2)));
  gl.uniform1f(at('uScale'), scale);
  gl.uniform1f(at('uTime'), (performance.now() / 1000) % 3600);
  gl.uniform1f(at('uSeed'), panel.seed ?? 0);
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === 'number') gl.uniform1f(at(k), v);
    else gl[`uniform${v.length}f`](at(k), ...v);
  }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return { canvas, sx: 0, sy: 0, sw: pw, sh: ph };
}
// #endregion shade

/** True if shade() already holds this element's picture with this signature, so the skin need not draw it again. */
export function holds(element, sig) { const held = state?.kept?.get(element); return !!held && held.sig === sig && !state.lost; }
