// element-gl.js: one WebGL 2 context that draws canvas children as textured
// quads through one fragment shader. Small on purpose: a page creates one
// ElementGL for its one canvas, so it holds one GPU context.
//
//   const stage = new ElementGL(canvas, { fragment, onLost, onRestored });
//   stage.upload(element)            // texElementSubImage2D into the element's texture
//   stage.begin()                    // size the buffer, clear
//   stage.quad(element, matrix, (gl, uniform) => { gl.uniform1f(uniform('uAge'), 0.2); })
//
// `matrix` is a 16-number column-major matrix that takes the unit square
// (0,0)-(1,1), y down, to clip space. ElementGL.rect() builds the matrix that
// puts the quad on a rectangle of the canvas in CSS pixels.
//
// The fragment shader gets:  uniform sampler2D uTex;  in vec2 vUv;  (0,0 is the
// top left of the element), uniform vec2 uSize (element size in CSS pixels),
// uniform float uTime (seconds), and writes premultiplied colour to `outColor`.

export const supported =
  typeof WebGL2RenderingContext !== 'undefined' &&
  'texElementSubImage2D' in WebGL2RenderingContext.prototype &&
  typeof HTMLCanvasElement !== 'undefined' &&
  'requestPaint' in HTMLCanvasElement.prototype;

const VERTEX = `#version 300 es
in vec2 aPos;
uniform mat4 uMatrix;
out vec2 vUv;
void main() {
  vUv = aPos;
  gl_Position = uMatrix * vec4(aPos, 0.0, 1.0);
}`;

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
const DEFAULT_CLEAR = [0, 0, 0, 0];

export class ElementGL {
  static #sizes = new WeakMap();
  #fragment; #program = null; #uniforms = new Map(); #textures = new Map(); #onLost; #onRestored;
  #vao = null; #vbo = null; #ro = null; #size = { w: 0, h: 0 }; #mat = new Float32Array(16);
  #onContextLost; #onContextRestored;
  lost = false;

  constructor(canvas, { fragment, onLost = () => {}, onRestored = () => {}, attributes = {} }) {
    this.canvas = canvas;
    this.#fragment = fragment;
    this.#onLost = onLost;
    this.#onRestored = onRestored;
    ElementGL.#sizes.set(canvas, this.#size);
    if (typeof ResizeObserver !== 'undefined') {
      this.#ro = new ResizeObserver(([entry]) => {
        const box = entry.contentBoxSize?.[0];
        this.#size.w = box ? box.inlineSize : entry.contentRect.width;
        this.#size.h = box ? box.blockSize : entry.contentRect.height;
      });
      this.#ro.observe(canvas);
    }
    // #region context-loss
    // A phone under memory pressure takes the context away. preventDefault()
    // asks for it back; everything on the GPU is rebuilt when it returns.
    this.#onContextLost = (e) => {
      e.preventDefault();
      this.lost = true;
      this.#program = null;
      this.#vao = null;
      this.#vbo = null;
      this.#textures.clear();
      this.#uniforms.clear();
      this.#onLost();
    };
    this.#onContextRestored = () => {
      this.lost = false;
      this.#build();
      this.#onRestored();
      canvas.requestPaint?.();
    };
    canvas.addEventListener('webglcontextlost', this.#onContextLost);
    canvas.addEventListener('webglcontextrestored', this.#onContextRestored);
    // #endregion context-loss
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power', ...attributes });
    if (!this.gl) throw new Error('WebGL 2 is not available');
    this.#build();
    this.#syncSize();
  }

  #build() {
    const gl = this.gl;
    const compile = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(s);
        gl.deleteShader(s);
        throw new Error(log);
      }
      return s;
    };
    const vs = compile(gl.VERTEX_SHADER, VERTEX);
    let fs = null;
    const p = gl.createProgram();
    try {
      fs = compile(gl.FRAGMENT_SHADER, this.#fragment);
      gl.attachShader(p, vs);
      gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'aPos');
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
    } catch (err) {
      gl.deleteProgram(p);
      throw err;
    } finally {
      gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
    }
    if (this.#program) gl.deleteProgram(this.#program);
    this.#program = p;
    this.#uniforms.clear();
    if (!this.#vao) {
      this.#vao = gl.createVertexArray();
      this.#vbo = gl.createBuffer();
      gl.bindVertexArray(this.#vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Replace the fragment shader (for a page that switches effects). */
  setFragment(fragment) {
    this.#fragment = fragment;
    if (!this.lost) this.#build();
  }

  /** Release GPU objects, listeners and observers held by this stage. */
  dispose() {
    this.#ro?.disconnect();
    this.#ro = null;
    ElementGL.#sizes.delete(this.canvas);
    this.canvas.removeEventListener('webglcontextlost', this.#onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.#onContextRestored);
    const gl = this.gl;
    if (gl && !this.lost && !gl.isContextLost()) {
      for (const t of this.#textures.values()) gl.deleteTexture(t.tex);
      if (this.#program) gl.deleteProgram(this.#program);
      if (this.#vbo) gl.deleteBuffer(this.#vbo);
      if (this.#vao) gl.deleteVertexArray(this.#vao);
    }
    this.#textures.clear();
    this.#uniforms.clear();
    this.#program = null;
    this.#vbo = null;
    this.#vao = null;
  }

  #syncSize() {
    const c = this.canvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    let cw = this.#size.w, ch = this.#size.h;
    if (!(cw > 0 && ch > 0)) {
      cw = c.clientWidth;
      ch = c.clientHeight;
      if (cw > 0 && ch > 0) { this.#size.w = cw; this.#size.h = ch; }
    }
    if (!(cw > 0 && ch > 0)) return false;
    const w = Math.max(1, Math.round(cw * dpr)), h = Math.max(1, Math.round(ch * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return true;
  }

  // #region upload
  /** Copy an element's current picture into its texture. Call inside the paint event. */
  upload(element) {
    const gl = this.gl;
    if (this.lost) return null;
    this.#syncSize();
    const size = this.canvas.getElementImageDefaultSize(element);
    const w = Math.max(1, Math.ceil(size.width)), h = Math.max(1, Math.ceil(size.height));
    let t = this.#textures.get(element);
    if (!t) {
      t = { tex: gl.createTexture(), w: 0, h: 0 };
      this.#textures.set(element, t);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    // The storage has to be exactly the element's picture size.
    if (t.w !== w || t.h !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      t.w = w; t.h = h;
    }
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, element);
    return t;
  }
  // #endregion upload

  /** Forget an element's texture (after the element is removed). */
  forget(element) {
    const t = this.#textures.get(element);
    if (t && !this.lost) this.gl.deleteTexture(t.tex);
    this.#textures.delete(element);
  }

  has(element) { return this.#textures.has(element); }

  /** Match the buffer to the canvas box in device pixels, and clear. */
  begin(clear = DEFAULT_CLEAR) {
    const gl = this.gl, c = this.canvas;
    if (this.lost) return false;
    this.#syncSize();
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(clear[0], clear[1], clear[2], clear[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.#program);
    gl.bindVertexArray(this.#vao);
    return true;
  }

  uniform = (name) => {
    let u = this.#uniforms.get(name);
    if (u === undefined) { u = this.gl.getUniformLocation(this.#program, name); this.#uniforms.set(name, u); }
    return u;
  };

  /** Draw one element's texture on a quad. `set` sets extra uniforms. */
  quad(element, matrix, set) {
    const gl = this.gl, t = this.#textures.get(element);
    if (this.lost || !t) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.uniform1i(this.uniform('uTex'), 0);
    let mat = matrix;
    if (!(matrix instanceof Float32Array)) {
      const m = this.#mat;
      for (let i = 0; i < 16; i++) m[i] = matrix[i];
      mat = m;
    }
    gl.uniformMatrix4fv(this.uniform('uMatrix'), false, mat);
    gl.uniform2f(this.uniform('uSize'), element.offsetWidth, element.offsetHeight);
    gl.uniform1f(this.uniform('uTime'), performance.now() / 1000);
    set?.(gl, this.uniform);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** The matrix that puts the unit square on a rectangle of the canvas, in CSS pixels. */
  static rect(canvas, x, y, w, h, out = new Float32Array(16)) {
    const s = ElementGL.#sizes.get(canvas);
    const cw = (s && s.w > 0 ? s.w : canvas.clientWidth) || 1;
    const ch = (s && s.h > 0 ? s.h : canvas.clientHeight) || 1;
    out[0] = 2 * w / cw; out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = -2 * h / ch; out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = 1; out[11] = 0;
    out[12] = 2 * x / cw - 1; out[13] = 1 - 2 * y / ch; out[14] = 0; out[15] = 1;
    return out;
  }
}
