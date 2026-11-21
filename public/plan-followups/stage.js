// stage.js: the WebGL side of /plan-followups/. One fragment shader for lib/element-gl.js with four
// modes, and a small bloom chain that draws into 16-bit float buffers.
//
//   const gl = new ElementGL(canvas, { fragment: FRAGMENT });
//   const bloom = new Bloom(gl.gl);
//   gl.begin();  bloom.beginScene(canvas.width, canvas.height);     // quads now go to a float texture
//   gl.quad(panel, matrix, (g, u) => { g.uniform1f(u('uMode'), 2); … });
//   bloom.finish({ strength, headroom, view });                      // bright pass, blur, composite to the canvas

// #region fragment
export const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uSize;
uniform float uTime;
uniform float uMode;        // 0 plain, 1 page turn, 2 raise above 1.0, 3 effect chosen in CSS
uniform vec4 uCrop;         // the part of the texture this quad shows: offset xy, scale zw
uniform float uFold;        // 1: where the paper leaves the table, in page widths
uniform vec4 uBox[4];       // 2: boxes to raise, in CSS pixels of the element
uniform vec4 uOpt[4];       // 2: gain, corner radius, 1 for "full white pixels only"
uniform float uCount;
uniform float uEffect;      // 3: 0 none, 1 wave, 2 split, 3 lines. Set from the custom property --fx
uniform float uAmount;      // 3: from --u-amount
uniform vec4 uTint;         // 3: from --u-tint

vec4 page(vec2 uv) { return texture(uTex, uCrop.xy + uv * uCrop.zw); }

float sd(vec2 p, vec4 box, float r) {
  vec2 h = box.zw * 0.5;
  vec2 q = abs(p - (box.xy + h)) - h + vec2(r);
  return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec2 uv = vUv;
  if (uMode < 0.5) { outColor = page(uv); return; }

  if (uMode < 1.5) {
    // A sheet that rolls over a cylinder of radius R lying on the fold line. s is the distance along the paper.
    const float R = 0.07, PI = 3.14159265;
    float d = uv.x - uFold;
    if (d > R) { outColor = vec4(0.0); return; }
    vec4 front = vec4(0.0);
    float s;
    if (d > 0.0) {
      float a = asin(d / R);
      s = uFold + a * R;                                    // the paper going up the roll
      if (s <= 1.0) front = page(vec2(s, uv.y)) * (1.0 - 0.45 * d / R);
      s = uFold + (PI - a) * R;                             // the paper coming back over the top: its back side
      if (s <= 1.0) front = vec4(mix(page(vec2(s, uv.y)).rgb, vec3(0.93), 0.82) * (0.72 + 0.28 * d / R), 1.0);
    } else {
      front = page(uv);                                     // still flat on the table
      s = uFold + PI * R - d;                               // the turned part lying on top of it, back side up
      if (s <= 1.0) front = vec4(mix(page(vec2(s, uv.y)).rgb, vec3(0.93), 0.82) * (1.0 - 0.25 * smoothstep(0.12, 0.0, -d)), 1.0);
      else if (uFold < 0.999) front.rgb *= 1.0 - 0.3 * smoothstep(0.1, 0.0, -d);          // the shadow of the roll
    }
    outColor = front;
    return;
  }

  if (uMode < 2.5) {
    // The texture is 8-bit, so it holds at most 1.0. Multiply chosen boxes: the target is a float buffer.
    vec4 c = page(uv);
    vec2 p = vUv * uSize;
    float white = smoothstep(0.997, 0.9995, min(c.r, min(c.g, c.b)));
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uCount) break;
      if (sd(p, uBox[i], uOpt[i].y) <= 0.0) c.rgb *= uOpt[i].z > 0.5 ? mix(1.0, uOpt[i].x, white) : uOpt[i].x;
    }
    outColor = c;
    return;
  }

  // 3: the effect is a number that the page looked up from a <custom-ident>.
  vec4 c;
  if (uEffect < 0.5) c = page(uv);
  else if (uEffect < 1.5) c = page(uv + vec2(0.0, sin(uv.x * 14.0 + uTime * 4.0) * 0.06 * uAmount));
  else if (uEffect < 2.5) { float o = 0.05 * uAmount; c = vec4(page(uv + vec2(o, 0.0)).r, page(uv).g, page(uv - vec2(o, 0.0)).b, page(uv).a); }
  else { c = page(uv); c.rgb *= 1.0 - uAmount * 0.75 * step(0.5, fract(vUv.y * uSize.y / 4.0)); }
  outColor = vec4(mix(c.rgb, uTint.rgb * c.a * dot(c.rgb, vec3(0.3, 0.6, 0.1)) * 1.6, uTint.a), c.a);
}`;
// #endregion fragment

const FULL = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;
const HEAD = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
`;
// #region bloom-shaders
// Keep what is above 1.0.
const BRIGHT = `${HEAD}
void main() {
  vec4 c = texture(uTex, vUv);
  outColor = vec4(c.rgb * smoothstep(1.0, 1.5, max(c.r, max(c.g, c.b))), 1.0);
}`;
// Nine taps along one axis.
const BLUR = `${HEAD}
uniform vec2 uStep;
void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227;
  c += (texture(uTex, vUv + uStep * 1.385).rgb + texture(uTex, vUv - uStep * 1.385).rgb) * 0.316;
  c += (texture(uTex, vUv + uStep * 3.231).rgb + texture(uTex, vUv - uStep * 3.231).rgb) * 0.070;
  outColor = vec4(c, 1.0);
}`;
// The scene plus the blurred light, then the view: 0 as stored, 1 exposed down, 2 a map of values above 1.0.
const COMPOSITE = `${HEAD}
uniform sampler2D uBloom;
uniform float uStrength, uHeadroom, uView;
void main() {
  vec4 s = texture(uTex, vUv);
  vec3 b = texture(uBloom, vUv).rgb * uStrength;
  vec4 c = vec4(s.rgb + b, min(1.0, s.a + max(b.r, max(b.g, b.b))));
  if (uView > 0.5 && uView < 1.5) c.rgb /= max(uHeadroom, 1.0);
  else if (uView > 1.5) {
    float v = max(c.r, max(c.g, c.b));
    if (v <= 1.004) c = vec4(vec3(0.43 * dot(c.rgb, vec3(0.25, 0.6, 0.15))), c.a);
    else { float t = min(1.0, (v - 1.0) / max(uHeadroom - 1.0, 0.01)); c = vec4(1.0, t < 0.5 ? 0.863 - 1.255 * t : 0.235 - 0.47 * (t - 0.5), t < 0.5 ? 0.0 : 1.57 * (t - 0.5), 1.0); }
  }
  outColor = c;
}`;
// #endregion bloom-shaders

export class Bloom {
  #gl; #programs = null; #vao = null; #scene = null; #a = null; #b = null; #w = 0; #h = 0;
  float = false;
  constructor(gl) { this.#gl = gl; this.rebuild(); }

  /** Compile everything again. Call after the context comes back. */
  rebuild() {
    const gl = this.#gl;
    // Without this extension a float texture cannot be drawn into, and the chain uses 8 bits.
    this.float = !!(gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
    const make = (fragment) => {
      const p = gl.createProgram();
      for (const [type, source] of [[gl.VERTEX_SHADER, FULL], [gl.FRAGMENT_SHADER, fragment]]) {
        const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      return p;
    };
    this.#programs = { bright: make(BRIGHT), blur: make(BLUR), composite: make(COMPOSITE) };
    this.#vao = gl.createVertexArray();
    this.#scene = this.#a = this.#b = null; this.#w = this.#h = 0;
  }

  #target(w, h) {
    const gl = this.#gl, tex = gl.createTexture(), fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.float) gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA16F, w, h); else gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fbo, w, h };
  }

  // #region bloom
  /** Send the quads that follow into the float scene texture. */
  beginScene(w, h) {
    const gl = this.#gl;
    if (w !== this.#w || h !== this.#h) {
      for (const t of [this.#scene, this.#a, this.#b]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); }
      const qw = Math.max(1, w >> 2), qh = Math.max(1, h >> 2);
      this.#scene = this.#target(w, h); this.#a = this.#target(qw, qh); this.#b = this.#target(qw, qh);
      this.#w = w; this.#h = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#scene.fbo);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  }
  /** Bright pass, two blurs each way at a quarter of the size, then the scene plus the light on the canvas. */
  finish({ strength = 1, headroom = 4, view = 0 } = {}) {
    const gl = this.#gl, P = this.#programs;
    const pass = (program, source, target, set) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
      gl.viewport(0, 0, target ? target.w : this.#w, target ? target.h : this.#h);
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, source.tex);
      gl.uniform1i(gl.getUniformLocation(program, 'uTex'), 0);
      set?.((name) => gl.getUniformLocation(program, name));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    gl.bindVertexArray(this.#vao);
    gl.disable(gl.BLEND);
    pass(P.bright, this.#scene, this.#a);
    for (const reach of [1, 2]) {
      pass(P.blur, this.#a, this.#b, (u) => gl.uniform2f(u('uStep'), reach / this.#a.w, 0));
      pass(P.blur, this.#b, this.#a, (u) => gl.uniform2f(u('uStep'), 0, reach / this.#a.h));
    }
    pass(P.composite, this.#scene, null, (u) => {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.#a.tex); gl.uniform1i(u('uBloom'), 1);
      gl.uniform1f(u('uStrength'), strength); gl.uniform1f(u('uHeadroom'), headroom); gl.uniform1f(u('uView'), view);
      gl.activeTexture(gl.TEXTURE0);
    });
    gl.enable(gl.BLEND);
  }
  // #endregion bloom

  /** One pixel of the scene texture as floats. x and y are in pixels from the top left. For a live check or a tap. */
  read(x, y) {
    const gl = this.#gl, out = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.#scene.fbo);
    if (this.float) gl.readPixels(x, this.#h - 1 - y, 1, 1, gl.RGBA, gl.FLOAT, out);
    else { const b = new Uint8Array(4); gl.readPixels(x, this.#h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); out.set([...b].map((v) => v / 255)); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return out;
  }
  /** One pixel of the canvas's own drawing buffer, read as floats when the buffer is RGBA16F. Only valid straight after finish(). */
  readCanvas(x, y) {
    const gl = this.#gl, out = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (gl.drawingBufferFormat === gl.RGBA16F) gl.readPixels(x, this.#h - 1 - y, 1, 1, gl.RGBA, gl.FLOAT, out);
    else { const b = new Uint8Array(4); gl.readPixels(x, this.#h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, b); out.set([...b].map((v) => v / 255)); }
    return out;
  }
}

// #region float-buffer
/** Ask for a 16-bit float drawing buffer the size of the canvas and extended tone mapping, or go back to 8 bits. Returns what was accepted. */
export function floatDrawingBuffer(gl, float = true) {
  const result = { storage: false, toneMapping: 'no drawingBufferToneMapping()', colorSpace: gl.drawingBufferColorSpace ?? 'not reported' };
  const canFloat = typeof gl.drawingBufferStorage === 'function' && (gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float'));
  if (canFloat) {
    gl.getError();
    gl.drawingBufferStorage(float ? gl.RGBA16F : gl.RGBA8, gl.canvas.width, gl.canvas.height);
    result.storage = float && gl.getError() === gl.NO_ERROR && gl.drawingBufferFormat === gl.RGBA16F;
  }
  if (typeof gl.drawingBufferToneMapping === 'function') {
    const mode = float ? 'extended' : 'standard';
    try { gl.drawingBufferToneMapping({ mode }); result.toneMapping = mode; } catch (e) { result.toneMapping = `refused (${e.message})`; }
  }
  try { gl.drawingBufferColorSpace = float ? 'display-p3' : 'srgb'; result.colorSpace = gl.drawingBufferColorSpace; } catch { /* keeps what it had */ }
  return result;
}
// #endregion float-buffer
