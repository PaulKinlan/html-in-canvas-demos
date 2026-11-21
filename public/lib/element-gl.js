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

export class ElementGL {
  #fragment; #program = null; #uniforms = new Map(); #textures = new Map(); #onLost; #onRestored; #vao = null;
  lost = false;

  constructor(canvas, { fragment, onLost = () => {}, onRestored = () => {}, attributes = {} }) {
    this.canvas = canvas;
    this.#fragment = fragment;
    this.#onLost = onLost;
    this.#onRestored = onRestored;
    // #region context-loss
    // A phone under memory pressure takes the context away. preventDefault()
    // asks for it back; everything on the GPU is rebuilt when it returns.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      this.#program = null;
      this.#textures.clear();
      this.#uniforms.clear();
      this.#onLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.#build();
      this.#onRestored();
      canvas.requestPaint?.();
    });
    // #endregion context-loss
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'low-power', ...attributes });
    if (!this.gl) throw new Error('WebGL 2 is not available');
    this.#build();
  }

  #build() {
    const gl = this.gl;
    const compile = (type, source) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, this.#fragment));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(p));
    this.#program = p;
    this.#uniforms.clear();
    this.#vao = gl.createVertexArray();
    gl.bindVertexArray(this.#vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Replace the fragment shader (for a page that switches effects). */
  setFragment(fragment) {
    this.#fragment = fragment;
    if (!this.lost) this.#build();
  }

  // #region upload
  /** Copy an element's current picture into its texture. Call inside the paint event. */
  upload(element) {
    const gl = this.gl;
    if (this.lost) return null;
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
  begin(clear = [0, 0, 0, 0]) {
    const gl = this.gl, c = this.canvas;
    if (this.lost) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    gl.viewport(0, 0, w, h);
    gl.clearColor(...clear);
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
    gl.uniformMatrix4fv(this.uniform('uMatrix'), false, matrix);
    gl.uniform2f(this.uniform('uSize'), element.offsetWidth, element.offsetHeight);
    gl.uniform1f(this.uniform('uTime'), performance.now() / 1000);
    set?.(gl, this.uniform);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** The matrix that puts the unit square on a rectangle of the canvas, in CSS pixels. */
  static rect(canvas, x, y, w, h) {
    const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
    return new Float32Array([2 * w / cw, 0, 0, 0, 0, -2 * h / ch, 0, 0, 0, 0, 1, 0, 2 * x / cw - 1, 1 - 2 * y / ch, 0, 1]);
  }
}
