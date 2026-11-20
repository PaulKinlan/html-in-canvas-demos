// <live-card src="https://other.example/card.html" effect="ripple">
//
// Embeds a card from another origin without an iframe-shaped hole in the
// page. The card's document runs in a hidden frame and sends pictures of
// itself; this element draws them with WebGL, so the host can bend, tint and
// animate something whose DOM it cannot touch. Pointer and key input is
// mapped back through the same distortion and sent to the card.
//
//   card.effect = 'none' | 'ripple' | 'crt' | 'tilt'
//   card.tint = { dark: '#102a43', light: '#f0f4f8', amount: 1 }   pixel-level recolour
//   card.theme = { '--card-accent': '#0a7' }                        asks the card to restyle itself
//   events: 'app' (the card's own messages), 'meta', 'frame', 'fallback'
//
// The canvas's fallback content is rebuilt from the card's element map, so
// keyboard and screen-reader users get real buttons and fields that proxy to
// the card.
import { portLink } from './live-view.js';

const EFFECTS = ['none', 'ripple', 'crt', 'tilt'];
const INSET = 0.9;

const VERT = `attribute vec2 p; varying vec2 uv; void main() { uv = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `precision mediump float;
varying vec2 uv; uniform sampler2D tex; uniform int fx; uniform float t; uniform float angle; uniform float lines;
uniform vec3 dark; uniform vec3 light; uniform float tint;
vec2 source(vec2 s) {
  vec2 c = (s * 2.0 - 1.0) / ${INSET.toFixed(2)};
  if (fx == 1) c += vec2(sin(c.y * 9.0 + t * 2.0), sin(c.x * 7.0 + t * 1.6)) * 0.03;
  else if (fx == 2) c *= 1.0 + 0.14 * dot(c, c);
  else if (fx == 3) { float d = 3.0; float u = c.x * d / (d * cos(angle) + c.x * sin(angle)); c = vec2(u, c.y * (d - u * sin(angle)) / d); }
  return c * 0.5 + 0.5;
}
void main() {
  vec2 s = source(uv);
  if (s.x < 0.0 || s.y < 0.0 || s.x > 1.0 || s.y > 1.0) { gl_FragColor = vec4(0.0); return; }
  vec4 col = texture2D(tex, s);
  if (fx == 2) {
    col.r = texture2D(tex, s + vec2(0.003, 0.0)).r;
    col.b = texture2D(tex, s - vec2(0.003, 0.0)).b;
    col.rgb *= 0.86 + 0.14 * sin(uv.y * lines);
  }
  if (tint > 0.0) { float l = dot(col.rgb, vec3(0.299, 0.587, 0.114)); col.rgb = mix(col.rgb, mix(dark, light, l) * col.a, tint); }
  gl_FragColor = col;
}`;

// The same mapping as source() in the shader: where on the card is the
// pixel under this point of the canvas? This is the whole of "hit testing
// through a shader".
function sourcePoint(fx, x, y, t, angle) {
  let cx = (x * 2 - 1) / INSET;
  let cy = (y * 2 - 1) / INSET;
  if (fx === 1) {
    const ox = Math.sin(cy * 9 + t * 2) * 0.03;
    const oy = Math.sin(cx * 7 + t * 1.6) * 0.03;
    cx += ox;
    cy += oy;
  } else if (fx === 2) {
    const k = 1 + 0.14 * (cx * cx + cy * cy);
    cx *= k;
    cy *= k;
  } else if (fx === 3) {
    const d = 3;
    const u = (cx * d) / (d * Math.cos(angle) + cx * Math.sin(angle));
    cy = (cy * (d - u * Math.sin(angle))) / d;
    cx = u;
  }
  return { x: cx * 0.5 + 0.5, y: cy * 0.5 + 0.5 };
}

const rgb = (hex) => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.replace(/./g, '$&$&') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16) / 255);
};

export class LiveCard extends HTMLElement {
  static observedAttributes = ['src', 'effect'];
  #frame;
  #canvas;
  #outline;
  #gl = null;
  #uniforms = {};
  #link = null;
  #meta = null;
  #frames = 0;
  #raf = 0;
  #angle = 0;
  #time = 0;
  #hover = null;
  #down = false;
  #tint = { dark: '#000000', light: '#ffffff', amount: 0 };
  #theme = {};
  #origin = '*';
  #hasTexture = false;
  #flat = 0;
  #noticeWhy = null;

  constructor() {
    super();
    const root = this.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
        :host { display: block; position: relative; }
        iframe { position: absolute; inset: 0 auto auto 0; width: 100%; height: 200px; border: 0; opacity: 0; pointer-events: none; color-scheme: light; }
        canvas { display: block; position: relative; width: 100%; height: 200px; outline: none; touch-action: manipulation; }
        canvas:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
        :host([fallback]) iframe { position: static; opacity: 1; pointer-events: auto; }
        :host([fallback]) canvas { display: none; }
        .notice { position: absolute; inset: 0; z-index: 1; display: grid; place-content: center; justify-items: center; gap: 8px; text-align: center; padding: 12px; font: 13px/1.35 system-ui, sans-serif; color: #fff; background: #1d1c1ad9; border-radius: 12px; }
        .notice[hidden] { display: none; }
        .notice button { font: inherit; padding: 4px 12px; border-radius: 999px; border: 1px solid #fff; background: transparent; color: #fff; }
      </style><iframe title="Embedded card" loading="eager"></iframe><canvas tabindex="0" role="group"></canvas><div class="notice" role="status" hidden><span></span><button type="button">Try again</button></div>`;
    this.#frame = root.querySelector('iframe');
    this.#canvas = root.querySelector('canvas');
    this.#outline = this.#canvas;
    addEventListener('message', this.#onMessage);
    const c = this.#canvas;
    // A phone may take the WebGL context away. Without this the card would
    // just turn into an empty box.
    c.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allows it to be restored
      cancelAnimationFrame(this.#raf);
      this.#hasTexture = false;
      this.#notice('The browser took this card\'s graphics away. It will come back when there is room, or try again.');
    });
    c.addEventListener('webglcontextrestored', () => this.refresh());
    root.querySelector('.notice button').addEventListener('click', () => this.refresh());
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && this.isConnected && this.#link && this.refresh());
    // Once a second: is what we are showing one flat colour? Then say so and ask again.
    setInterval(() => {
      if (!this.isConnected || !this.#hasTexture || document.visibilityState !== 'visible' || this.#gl?.isContextLost()) return;
      this.#flat = this.isBlank() ? this.#flat + 1 : 0;
      if (this.#flat === 3) {
        this.#notice('This card is arriving blank. Asking the other site for it again.');
        this.#link?.send({ t: 'hello', frames: 'bitmap' });
      } else if (!this.#flat && this.#noticeWhy === 'blank') this.#notice(null);
    }, 1000);
    c.addEventListener('pointerdown', (e) => {
      if (e.target !== c) return;
      this.#down = true;
      c.setPointerCapture(e.pointerId);
      c.focus({ preventScroll: true });
      this.#pointer('down', e);
    });
    c.addEventListener('pointermove', (e) => {
      const r = c.getBoundingClientRect();
      this.#hover = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      if (this.#down) this.#pointer('move', e);
    });
    c.addEventListener('pointerup', (e) => {
      if (!this.#down) return;
      this.#down = false;
      this.#pointer('up', e);
    });
    c.addEventListener('pointerleave', () => (this.#hover = null));
    c.addEventListener('keydown', (e) => {
      if (e.target !== c || e.metaKey || e.ctrlKey || e.altKey || e.key === 'Tab') return;
      if (e.key.length === 1 || ['Backspace', 'Delete', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        this.#link?.send({ t: 'key', key: e.key, shift: e.shiftKey });
      }
    });
  }

  connectedCallback() {
    if (this.getAttribute('src') && !this.#frame.src) this.#load();
  }
  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
    removeEventListener('message', this.#onMessage);
  }
  attributeChangedCallback(name) {
    if (name === 'src' && this.isConnected) this.#load();
    if (name === 'effect') this.#draw();
  }

  get effect() {
    const e = this.getAttribute('effect');
    return EFFECTS.includes(e) ? e : 'none';
  }
  set effect(v) {
    this.setAttribute('effect', v);
  }
  get tint() {
    return this.#tint;
  }
  set tint(v) {
    this.#tint = { ...this.#tint, ...v };
    this.#draw();
  }
  get theme() {
    return this.#theme;
  }
  set theme(vars) {
    this.#theme = { ...this.#theme, ...vars };
    this.#frame.contentWindow?.postMessage({ type: 'theme', vars: this.#theme }, this.#origin);
  }
  get meta() {
    return this.#meta;
  }
  get frames() {
    return this.#frames;
  }
  get canvas() {
    return this.#canvas;
  }
  get frameElement() {
    return this.#frame;
  }

  /** Start the drawing side again and ask the card for a fresh picture. */
  refresh() {
    this.#notice(null);
    this.#flat = 0;
    if (this.#gl && !this.#gl.isContextLost()) {
      this.#gl = null; // programs and textures died with the old context
      this.#uniforms = {};
    }
    this.#hasTexture = false;
    this.#link?.send({ t: 'hello', frames: 'bitmap' });
  }

  /** Is the canvas showing one flat colour (64 samples)? */
  isBlank() {
    const gl = this.#gl;
    if (!gl || gl.isContextLost()) return true;
    const px = new Uint8Array(4);
    let first = null;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        gl.readPixels(Math.floor(((x + 0.5) / 8) * this.#canvas.width), Math.floor(((y + 0.5) / 8) * this.#canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (!first) first = [...px];
        else if (px.some((v, i) => Math.abs(v - first[i]) > 6)) return false;
      }
    }
    return true;
  }

  /** The message shown over the card, or null. */
  get trouble() {
    return this.shadowRoot.querySelector('.notice').hidden ? null : this.shadowRoot.querySelector('.notice span').textContent;
  }

  #notice(text) {
    const n = this.shadowRoot.querySelector('.notice');
    n.hidden = !text;
    n.querySelector('span').textContent = text ?? '';
    this.#noticeWhy = text ? (/blank/.test(text) ? 'blank' : 'lost') : null;
    if (text) this.dispatchEvent(new CustomEvent('trouble', { detail: text }));
  }

  /** Card coordinates (0..1) under a point of this element's canvas (0..1), through the current effect. */
  toCard(x, y) {
    return sourcePoint(EFFECTS.indexOf(this.effect), x, y, this.#time, this.#angle);
  }
  /** Send a protocol message to the card (pointer, key, act…). */
  send(msg) {
    this.#link?.send(msg);
  }

  #load() {
    const src = new URL(this.getAttribute('src'), document.baseURI);
    this.#origin = src.origin;
    this.#link = null;
    this.#frame.src = src.href;
  }

  // #region connect
  #onMessage = (e) => {
    if (e.source !== this.#frame.contentWindow || e.origin !== this.#origin) return;
    if (e.data?.type === 'card-ready') {
      if (!e.data.supported) return this.#fallback('this browser has no HTML-in-canvas');
      const { port1, port2 } = new MessageChannel();
      this.#link = portLink(port1);
      this.#link.onmessage = (m) => this.#receive(m);
      this.#frame.contentWindow.postMessage({ type: 'live-port' }, this.#origin, [port2]);
      if (Object.keys(this.#theme).length) this.theme = {};
      this.#link.send({ t: 'hello', frames: 'bitmap' });
    }
  };
  // #endregion connect

  #fallback(reason) {
    // Plain iframe: everything still works, minus the effects.
    this.toggleAttribute('fallback', true);
    this.dispatchEvent(new CustomEvent('fallback', { detail: reason }));
  }

  #receive(m) {
    if (m.t === 'meta') {
      this.#meta = m;
      this.#frame.style.height = m.h + 'px';
      this.#canvas.style.height = m.h + 'px';
      this.#buildOutline(m.map);
      this.dispatchEvent(new CustomEvent('meta', { detail: m }));
    } else if (m.t === 'frame' && m.bitmap) {
      this.#upload(m.bitmap);
      m.bitmap.close();
      this.#frames++;
      this.#draw();
      this.dispatchEvent(new CustomEvent('frame'));
    } else if (m.t === 'trouble') {
      this.#notice(m.what === 'lost' ? 'The other site\'s browser dropped this card\'s picture. Waiting for it to come back.' : m.what === 'blank' ? 'This card is arriving blank. Asking the other site for it again.' : null);
    } else if (m.t === 'app') {
      this.dispatchEvent(new CustomEvent('app', { detail: m }));
    }
  }

  #initGl() {
    const gl = (this.#gl = this.#canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true }));
    if (!gl) return this.#fallback('no WebGL');
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    for (const name of ['fx', 't', 'angle', 'lines', 'dark', 'light', 'tint']) this.#uniforms[name] = gl.getUniformLocation(prog, name);
  }

  #upload(bitmap) {
    if (!this.#gl) this.#initGl();
    const gl = this.#gl;
    if (!gl || gl.isContextLost()) return;
    if (this.#canvas.width !== bitmap.width || this.#canvas.height !== bitmap.height) {
      this.#canvas.width = bitmap.width;
      this.#canvas.height = bitmap.height;
      gl.viewport(0, 0, bitmap.width, bitmap.height);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap);
    this.#hasTexture = true;
  }

  #draw = () => {
    const gl = this.#gl;
    if (!gl || !this.#hasTexture) return;
    cancelAnimationFrame(this.#raf);
    const fx = EFFECTS.indexOf(this.effect);
    this.#time = performance.now() / 1000;
    // Tilt follows the pointer, and sways gently when nobody is pointing.
    const target = fx === 3 ? (this.#hover ? (this.#hover.x - 0.5) * -1.1 : Math.sin(this.#time * 0.8) * 0.45) : 0;
    this.#angle += (target - this.#angle) * (this.#hover ? 0.15 : 1);
    const u = this.#uniforms;
    gl.uniform1i(u.fx, fx);
    gl.uniform1f(u.t, this.#time);
    gl.uniform1f(u.angle, this.#angle);
    gl.uniform1f(u.lines, this.#canvas.height * 1.2);
    gl.uniform3fv(u.dark, rgb(this.#tint.dark));
    gl.uniform3fv(u.light, rgb(this.#tint.light));
    gl.uniform1f(u.tint, this.#tint.amount);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (fx === 1 || fx === 3) this.#raf = requestAnimationFrame(this.#draw);
  };

  // #region pointer
  #pointer(kind, e) {
    const r = this.#canvas.getBoundingClientRect();
    const p = this.toCard((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    if (kind === 'down' && (p.x < 0 || p.y < 0 || p.x > 1 || p.y > 1)) return (this.#down = false);
    this.#link?.send({ t: 'pointer', kind, x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) });
  }
  // #endregion pointer

  // Real, focusable elements inside the canvas (its fallback content), one
  // per interactive element of the card. They are what assistive technology
  // and the Tab key see; activating one is forwarded to the card by id.
  #buildOutline(map) {
    this.#canvas.setAttribute('aria-label', this.getAttribute('aria-label') ?? this.#meta?.title ?? 'Embedded card');
    const seen = new Set();
    for (const item of map) {
      seen.add(item.id);
      let el = this.#outline.querySelector(`[data-id="${item.id}"]`);
      if (!el) {
        el = document.createElement(item.editable ? 'input' : 'button');
        el.dataset.id = item.id;
        if (item.editable) el.addEventListener('input', () => this.#link?.send({ t: 'act', kind: 'fill', id: item.id, value: el.value }));
        else {
          el.type = 'button';
          el.addEventListener('click', () => this.#link?.send({ t: 'act', kind: 'click', id: item.id }));
        }
        this.#outline.append(el);
      }
      if (item.editable) {
        el.setAttribute('aria-label', item.name);
        if (this.shadowRoot.activeElement !== el) el.value = item.value ?? '';
      } else el.textContent = item.name;
    }
    for (const el of [...this.#outline.children]) if (!seen.has(el.dataset.id)) el.remove();
  }
}
if (!customElements.get('live-card')) customElements.define('live-card', LiveCard);
