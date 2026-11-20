// <live-transition>: view transitions where both states are live DOM.
//
//   <live-transition effect="shatter" duration="900">
//     <section>State one</section>
//     <section>State two</section>
//   </live-transition>
//
//   el.show(1)                                  // animate to the second child
//   el.show(1, { effect: 'burn', origin: { x, y } })
//   el.begin(1, { effect: 'fold' }); el.progress = 0.4   // park mid-transition
//   el.play() / el.cancel()
//
// Each child is slotted into a WebGL canvas in the shadow root and uploaded as
// a texture with texElementSubImage2D on every frame, so animations, typing
// and state changes keep showing up in the middle of a transition. The mesh
// that draws each frame is also used for hit testing: the triangle under the
// pointer decides which state gets the event and with which transform.
//
// Children with matching data-morph="key" attributes are flown from their old
// box to their new one by the "morph" effect.
//
// Without HTML-in-canvas support the element shows one child at a time and
// uses document.startViewTransition when it can.

const SUPPORTED =
  typeof WebGL2RenderingContext !== 'undefined' &&
  'texElementSubImage2D' in WebGL2RenderingContext.prototype &&
  'requestPaint' in HTMLCanvasElement.prototype;

const VS = `#version 300 es
in vec3 aPos;   // x, y in CSS px relative to the host, w for perspective
in vec4 aUV;    // uv in state A, uv in state B
in vec4 aFx;    // mix, alpha, shade, base
uniform vec2 uView;
uniform vec2 uOff;
out vec4 vUV;
out vec4 vFx;
void main() {
  vec2 c = (aPos.xy + uOff) / uView * 2.0 - 1.0;
  gl_Position = vec4(c.x * aPos.z, -c.y * aPos.z, 0.0, aPos.z);
  vUV = aUV;
  vFx = aFx;
}`;

const FS = `#version 300 es
precision highp float;
in vec4 vUV;
in vec4 vFx;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uNoise;
uniform int uMode;        // 0 mesh, 1 burn
uniform float uFront;
uniform vec2 uOrigin;     // CSS px
uniform float uMaxD;
uniform vec2 uSize;       // CSS px of a state
uniform vec4 uHolesA[8];
uniform vec4 uHolesB[8];
uniform int uNA;
uniform int uNB;
out vec4 o;

// Inside a hole, smear the nearest pixel just outside it. On flat or gently
// shaded backgrounds this is "what was behind the element".
vec2 inpaint(vec2 uv, vec4 r) {
  if (uv.x > r.x && uv.x < r.z && uv.y > r.y && uv.y < r.w) {
    vec2 px = 1.5 / uSize;
    float dl = (uv.x - r.x) * uSize.x, dr = (r.z - uv.x) * uSize.x;
    float dt = (uv.y - r.y) * uSize.y, db = (r.w - uv.y) * uSize.y;
    float m = min(min(dl, dr), min(dt, db));
    if (m == dl) uv.x = r.x - px.x;
    else if (m == dr) uv.x = r.z + px.x;
    else if (m == dt) uv.y = r.y - px.y;
    else uv.y = r.w + px.y;
  }
  return uv;
}

void main() {
  vec2 ua = vUV.xy, ub = vUV.zw;
  if (uMode == 1) {
    vec2 p = ua * uSize;
    float n = texture(uNoise, p / 420.0).r;
    float t = 0.55 * distance(p, uOrigin) / uMaxD + 0.45 * n;
    float e = uFront - t;
    vec4 a = texture(uA, ua), b = texture(uB, ub);
    if (e > 0.0) {
      float hot = 1.0 - smoothstep(0.0, 0.05, e);
      o = b + vec4(1.0, 0.45, 0.1, 0.0) * hot * 0.5 * b.a;
    } else {
      float charred = smoothstep(-0.09, -0.02, e);
      float glow = smoothstep(-0.035, 0.0, e);
      vec3 ember = mix(vec3(1.0, 0.25, 0.02), vec3(1.0, 0.85, 0.35), glow);
      o = vec4(a.rgb * (1.0 - 0.9 * charred) + ember * glow * a.a, a.a);
    }
    return;
  }
  if (vFx.w > 0.5) {
    for (int i = 0; i < uNA; i++) ua = inpaint(ua, uHolesA[i]);
    for (int i = 0; i < uNB; i++) ub = inpaint(ub, uHolesB[i]);
  }
  vec4 c = mix(texture(uA, ua), texture(uB, ub), vFx.x);
  c.rgb *= vFx.z;
  o = c * vFx.y;
}`;

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable value noise, shared by the burn shader and its CPU hit test.
const NOISE_N = 128;
let noiseData;
function noise() {
  if (noiseData) return noiseData;
  const rand = mulberry(7);
  const out = new Float32Array(NOISE_N * NOISE_N);
  for (const [cells, weight] of [[4, 0.5], [8, 0.27], [16, 0.15], [32, 0.08]]) {
    const g = Float32Array.from({ length: cells * cells }, rand);
    for (let y = 0; y < NOISE_N; y++) {
      for (let x = 0; x < NOISE_N; x++) {
        const fx = (x / NOISE_N) * cells, fy = (y / NOISE_N) * cells;
        const x0 = Math.floor(fx), y0 = Math.floor(fy);
        const tx = smooth(0, 1, fx - x0), ty = smooth(0, 1, fy - y0);
        const at = (i, j) => g[(j % cells) * cells + (i % cells)];
        out[y * NOISE_N + x] += weight * lerp(lerp(at(x0, y0), at(x0 + 1, y0), tx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty);
      }
    }
  }
  noiseData = out;
  return out;
}
function noiseAt(u, v) {
  const n = noise();
  const fx = ((u % 1) + 1) % 1 * NOISE_N - 0.5, fy = ((v % 1) + 1) % 1 * NOISE_N - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
  const at = (i, j) => n[((j + NOISE_N) % NOISE_N) * NOISE_N + ((i + NOISE_N) % NOISE_N)];
  return lerp(lerp(at(x0, y0), at(x0 + 1, y0), tx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty);
}

// ---------------------------------------------------------------- effects
// A mesh effect is (p, env) => void. It calls env.quad / env.tri to place
// pieces of state A (the outgoing one) and state B. Coordinates are CSS px
// relative to the element; a destination point may carry a third value, the
// perspective w (1 / scale), for perspective-correct texturing.

const FOCAL = 1100;

function fade(p, { W, H, quad }) {
  quad([[0, 0], [W, 0], [W, H], [0, H]], { x: 0, y: 0, w: W, h: H }, { mix: smooth(0, 1, p) });
}

function shatter(p, env) {
  const { W, H, quad, tri, origin, rand, state } = env;
  if (!state.shards) {
    const cols = Math.max(4, Math.round(W / 64)), rows = Math.max(3, Math.round(H / 64));
    const pts = [];
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const edgeX = i === 0 || i === cols, edgeY = j === 0 || j === rows;
        pts.push([
          (i + (edgeX ? 0 : (rand() - 0.5) * 0.7)) * (W / cols),
          (j + (edgeY ? 0 : (rand() - 0.5) * 0.7)) * (H / rows),
        ]);
      }
    }
    const maxD = Math.max(...[[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => Math.hypot(x - origin.x, y - origin.y)));
    state.shards = [];
    const add = (a, b, c) => {
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3;
      const dx = cx - origin.x, dy = cy - origin.y, d = Math.hypot(dx, dy) || 1;
      const ang = rand() * Math.PI * 2;
      state.shards.push({
        v: [a, b, c], cx, cy,
        delay: (d / maxD) * 0.5 + rand() * 0.06,
        vx: (dx / d) * (60 + rand() * 160) + (rand() - 0.5) * 60,
        vy: (dy / d) * (40 + rand() * 120) - 40 - rand() * 80,
        axis: [Math.cos(ang), Math.sin(ang)],
        spin: (rand() < 0.5 ? -1 : 1) * (2 + rand() * 5),
        fall: 500 + rand() * 500,
      });
    };
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * (cols + 1) + i;
        const tl = pts[k], tr = pts[k + 1], bl = pts[k + cols + 1], br = pts[k + cols + 2];
        if (rand() < 0.5) { add(tl, tr, br); add(tl, br, bl); } else { add(tl, tr, bl); add(tr, br, bl); }
      }
    }
    // Draw far shards first so the ones that have flown longest sit on top.
    state.shards.sort((a, b) => b.delay - a.delay);
  }
  // State B waits underneath, rising out of the dark.
  const s = lerp(0.94, 1, ease(p));
  const bx = (x) => W / 2 + (x - W / 2) * s, by = (y) => H / 2 + (y - H / 2) * s;
  quad([[bx(0), by(0)], [bx(W), by(0)], [bx(W), by(H)], [bx(0), by(H)]], { x: 0, y: 0, w: W, h: H }, { mix: 1, shade: lerp(0.45, 1, smooth(0.1, 0.9, p)) });

  for (const sh of state.shards) {
    const t = clamp((p - sh.delay * 0.55) / 0.45, 0, 1.6);
    const alpha = 1 - smooth(0.75, 1.0, t);
    if (alpha <= 0) continue;
    const crack = smooth(0, 0.08, t) * 0.04;  // shards pull apart before they fly
    const angle = sh.spin * t * t;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const [ax, ay] = sh.axis;
    const ox = sh.vx * t, oy = sh.vy * t + sh.fall * t * t;
    const dst = sh.v.map(([x, y]) => {
      const lx = (x - sh.cx) * (1 - crack), ly = (y - sh.cy) * (1 - crack);
      // Rotate about an axis lying in the plane (Rodrigues, axis z = 0).
      const dot = lx * ax + ly * ay;
      const rx = lx * cos + ax * dot * (1 - cos);
      const ry = ly * cos + ay * dot * (1 - cos);
      const rz = (ax * ly - ay * lx) * sin;
      const scale = FOCAL / (FOCAL - rz - 120 * t);
      return [sh.cx + ox + rx * scale, sh.cy + oy + ry * scale, 1 / scale];
    });
    tri(dst, sh.v, { mix: 0, alpha, shade: 0.72 + 0.28 * Math.abs(cos) });
  }
}

function fold(p, { W, H, quad }) {
  const n = Math.max(2, Math.round(W / 110) * 2);
  const e = clamp(ease(p), 0.0001, 0.9999);
  const w0 = W / n;
  const persp = (x, y, z) => {
    const s = FOCAL / (FOCAL - z);
    return [W / 2 + (x - W / 2) * s, H / 2 + (y - H / 2) * s, 1 / s];
  };
  // State A collapses to the left like an accordion while B opens out of the right edge.
  const strips = (mix, start, total) => {
    const cosT = total / W, sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
    const wp = w0 * cosT, depth = -w0 * sinT;
    for (let i = 0; i < n; i++) {
      const x0 = start + i * wp, x1 = x0 + wp;
      const z0 = i % 2 ? depth : 0, z1 = i % 2 ? 0 : depth;
      quad(
        [persp(x0, 0, z0), persp(x1, 0, z1), persp(x1, H, z1), persp(x0, H, z0)],
        { x: i * w0, y: 0, w: w0, h: H },
        { mix, shade: 1 - sinT * (i % 2 ? 0.08 : 0.34) },
      );
    }
  };
  const split = W * (1 - e);
  strips(0, 0, split);
  strips(1, split, W - split);
}

function morph(p, { W, H, quad, pairs }) {
  const e = ease(p);
  quad([[0, 0], [W, 0], [W, H], [0, H]], { x: 0, y: 0, w: W, h: H }, { mix: smooth(0.15, 0.85, p), base: true });
  for (const { a, b } of pairs) {
    const x = lerp(a.x, b.x, e), y = lerp(a.y, b.y, e), w = lerp(a.w, b.w, e), h = lerp(a.h, b.h, e);
    // A small arc so paired elements don't slide along the same straight line.
    const lift = -Math.sin(e * Math.PI) * Math.min(24, Math.hypot(b.x - a.x, b.y - a.y) * 0.12);
    quad([[x, y + lift], [x + w, y + lift], [x + w, y + h + lift], [x, y + h + lift]], a, { mix: smooth(0.2, 0.8, p), src2: b });
  }
}

// ---------------------------------------------------------------- element

export class LiveTransition extends HTMLElement {
  static supported = SUPPORTED;
  /** Mesh effects by name. Add your own: LiveTransition.effects.swirl = (p, env) => { … }. */
  static effects = { fade, shatter, fold, morph, burn: 'shader' };

  #canvas; #gl; #prog; #uni = {}; #vbo;
  #layers = [];            // { el, wrap, tex, tw, th }
  #current = 0;
  #anim = null;            // { from, to, effect, duration, origin, start, p, paused, state, rand, pairs, resolve }
  #raf = 0;
  #tris = [];              // last drawn mesh, for hit testing
  #verts = [];
  #W = 0; #H = 0; #dpr = 1; #bleed = 60;
  #ro; #mo;
  #pointer = null;
  #needsFrame = true;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get supported() { return SUPPORTED; }
  get states() { return this.#layers.map((l) => l.el); }
  get current() { return this.#current; }
  get transitioning() { return !!this.#anim; }
  get canvas() { return this.#canvas; }

  connectedCallback() {
    if (this.#canvas || this.shadowRoot.childNodes.length) return;
    this.#bleed = Number(this.getAttribute('bleed') ?? 60);
    if (!SUPPORTED) {
      this.shadowRoot.innerHTML = `<style>:host{display:block}::slotted(:not([data-live-active])){display:none !important}</style><slot></slot>`;
      this.#sync();
      this.#mo = new MutationObserver(() => this.#sync());
      this.#mo.observe(this, { childList: true });
      return;
    }
    const b = this.#bleed;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: relative; }
        canvas { position: absolute; left: -${b}px; top: -${b}px; width: calc(100% + ${2 * b}px); height: calc(100% + ${2 * b}px); pointer-events: none; }
        .layer { position: absolute; left: ${b}px; top: ${b}px; width: calc(100% - ${2 * b}px); height: calc(100% - ${2 * b}px); pointer-events: auto; overflow: hidden; }
        .layer[hidden] { display: block; visibility: hidden; pointer-events: none; }
        .layer.off { pointer-events: none; }
      </style>
      <canvas content="drawable" layoutsubtree></canvas>`;
    this.#canvas = this.shadowRoot.querySelector('canvas');
    this.#initGL();
    this.#sync();
    this.#mo = new MutationObserver(() => this.#sync());
    this.#mo.observe(this, { childList: true });
    this.#ro = new ResizeObserver(() => this.#measure());
    this.#ro.observe(this);
    this.#canvas.addEventListener('paint', (e) => this.#render(e));
    addEventListener('pointermove', this.#onPointer, { passive: true });
    addEventListener('pointerdown', this.#onPointer, { passive: true, capture: true });
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#raf);
    removeEventListener('pointermove', this.#onPointer);
    removeEventListener('pointerdown', this.#onPointer, { capture: true });
  }

  // ------------------------------------------------------------ public API

  /** Animate to a state (index or child element). Resolves when it has finished. */
  async show(target, opts = {}) {
    await this.begin(target, opts);
    if (!this.#anim) return;
    return this.play();
  }

  /** Set up a transition and hold it at progress 0. Drive it with `progress` or `play()`. */
  async begin(target, opts = {}) {
    const to = typeof target === 'number' ? target : this.states.indexOf(target);
    if (to < 0 || to >= this.#layers.length) throw new RangeError('No such state');
    if (this.#anim) this.#finish(true);
    if (to === this.#current) return;
    let effect = opts.effect ?? this.getAttribute('effect') ?? 'fade';
    if (!(effect in LiveTransition.effects)) throw new RangeError(`Unknown effect "${effect}"`);
    const duration = Number(opts.duration ?? this.getAttribute('duration') ?? 900);
    if (!opts.force && matchMedia('(prefers-reduced-motion: reduce)').matches) effect = 'fade';

    if (!SUPPORTED) return this.#fallbackShow(to);

    const from = this.#current;
    const fromLayer = this.#layers[from], toLayer = this.#layers[to];
    toLayer.wrap.hidden = false;
    toLayer.wrap.inert = false;
    this.#anim = {
      from, to, effect, duration,
      origin: opts.origin ?? { x: this.#W / 2, y: this.#H / 2 },
      p: 0, paused: true, start: 0, state: {}, rand: mulberry(opts.seed ?? (Math.random() * 1e9) | 0),
      pairs: [], promise: null, resolve: null,
    };
    this.#anim.promise = new Promise((r) => (this.#anim.resolve = r));
    // The incoming state has no paint record until the browser has painted it once.
    await this.#nextPaint();
    await this.#nextPaint();
    if (!this.#anim) return;
    this.#anim.pairs = this.#pairs(fromLayer.el, toLayer.el);
    this.dispatchEvent(new CustomEvent('livetransitionstart', { detail: { from, to, effect } }));
    this.#requestFrame();
  }

  /** Run the pending transition from its current progress to the end. */
  play() {
    const a = this.#anim;
    if (!a) return Promise.resolve();
    a.paused = false;
    a.start = performance.now() - a.p * a.duration;
    this.#loop();
    return a.promise;
  }

  pause() { if (this.#anim) this.#anim.paused = true; }

  /** Drop the pending transition and stay on the outgoing state. */
  cancel() { if (this.#anim) this.#finish(false); }

  get progress() { return this.#anim ? this.#anim.p : 0; }
  set progress(v) {
    const a = this.#anim;
    if (!a) return;
    a.paused = true;
    a.p = clamp(Number(v));
    this.#requestFrame();
  }

  /** Which state is visible at a point (CSS px relative to the element), and how it is transformed there. */
  pick(x, y) {
    const a = this.#anim;
    if (!a) return x >= 0 && y >= 0 && x <= this.#W && y <= this.#H ? { state: this.#current, matrix: new DOMMatrix() } : null;
    if (a.effect === 'burn') {
      if (x < 0 || y < 0 || x > this.#W || y > this.#H) return null;
      return { state: this.#burnEdge(a, x, y) > 0 ? a.to : a.from, matrix: new DOMMatrix() };
    }
    for (let i = this.#tris.length - 1; i >= 0; i--) {
      const t = this.#tris[i];
      if (t.alpha < 0.1) continue;
      const [x0, y0, x1, y1, x2, y2] = t.d;
      const den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (Math.abs(den) < 1e-6) continue;
      const u = ((y1 - y2) * (x - x2) + (x2 - x1) * (y - y2)) / den;
      const v = ((y2 - y0) * (x - x2) + (x0 - x2) * (y - y2)) / den;
      if (u < 0 || v < 0 || u + v > 1) continue;
      const toB = t.mix >= 0.5;
      const m = affine(toB ? t.sb : t.sa, t.d);
      if (!m) continue;
      return { state: toB ? a.to : a.from, matrix: m };
    }
    return null;
  }

  // ------------------------------------------------------------ internals

  #sync() {
    const kids = [...this.children];
    if (!SUPPORTED) {
      this.#layers = kids.map((el) => ({ el }));
      this.#current = Math.min(this.#current, Math.max(0, kids.length - 1));
      kids.forEach((el, i) => el.toggleAttribute('data-live-active', i === this.#current));
      return;
    }
    const old = new Map(this.#layers.map((l) => [l.el, l]));
    this.#layers = kids.map((el, i) => {
      let layer = old.get(el);
      old.delete(el);
      if (!layer) {
        const wrap = document.createElement('div');
        wrap.className = 'layer';
        wrap.setAttribute('drawable', '');
        const slot = document.createElement('slot');
        wrap.append(slot);
        this.#canvas.append(wrap);
        layer = { el, wrap, slot, tex: null, tw: 0, th: 0 };
        this.#ro?.observe(el);
      }
      el.slot = layer.slot.name = `live-${i}`;
      return layer;
    });
    for (const gone of old.values()) gone.wrap.remove();
    this.#current = Math.min(this.#current, Math.max(0, kids.length - 1));
    this.#applyVisibility();
    for (const l of this.#layers) this.#ro?.observe(l.el);
    this.#measure();
  }

  #applyVisibility() {
    const a = this.#anim;
    this.#layers.forEach((l, i) => {
      const on = i === this.#current || (a && (i === a.from || i === a.to));
      l.wrap.hidden = !on;
      l.wrap.inert = !on;
      if (!on) l.fresh = false;
      l.wrap.classList.remove('off');
      l.el.toggleAttribute('data-live-active', i === this.#current);
    });
  }

  #measure() {
    if (!SUPPORTED) return;
    // The element is as tall as its tallest state unless the author gave it a height.
    let h = 0;
    for (const l of this.#layers) h = Math.max(h, l.el.offsetHeight);
    if (!this.style.height && !this.hasAttribute('fixed-height')) this.style.minHeight = `${h}px`;
    const r = this.getBoundingClientRect();
    const dpr = devicePixelRatio || 1;
    const W = this.offsetWidth, H = this.offsetHeight;
    const cw = Math.round((W + 2 * this.#bleed) * dpr), ch = Math.round((H + 2 * this.#bleed) * dpr);
    if (cw !== this.#canvas.width || ch !== this.#canvas.height) {
      this.#canvas.width = cw;
      this.#canvas.height = ch;
    }
    this.#W = W; this.#H = H; this.#dpr = dpr;
    void r;
    this.#requestFrame();
  }

  #initGL() {
    const gl = (this.#gl = this.#canvas.getContext('webgl2', { premultipliedAlpha: true, antialias: true, alpha: true }));
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = (this.#prog = gl.createProgram());
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.bindAttribLocation(prog, 1, 'aUV');
    gl.bindAttribLocation(prog, 2, 'aFx');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    for (const n of ['uView', 'uOff', 'uA', 'uB', 'uNoise', 'uMode', 'uFront', 'uOrigin', 'uMaxD', 'uSize', 'uHolesA', 'uHolesB', 'uNA', 'uNB']) {
      this.#uni[n] = gl.getUniformLocation(prog, n);
    }
    this.#vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
    const stride = 11 * 4;
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 28);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const n = noise();
    const bytes = new Uint8Array(NOISE_N * NOISE_N);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.round(clamp(n[i]) * 255);
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NOISE_N, NOISE_N, 0, gl.RED, gl.UNSIGNED_BYTE, bytes);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.uniform1i(this.#uni.uA, 0);
    gl.uniform1i(this.#uni.uB, 1);
    gl.uniform1i(this.#uni.uNoise, 2);
  }

  #nextPaint() {
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.#canvas.removeEventListener('paint', done); resolve(); };
      const timer = setTimeout(done, 250);
      this.#canvas.addEventListener('paint', done);
      this.#canvas.requestPaint();
    });
  }

  #requestFrame() {
    if (!SUPPORTED) return;
    this.#needsFrame = true;
    this.#canvas.requestPaint();
  }

  #loop() {
    cancelAnimationFrame(this.#raf);
    const tick = (now) => {
      const a = this.#anim;
      if (!a || a.paused) return;
      a.p = clamp((now - a.start) / a.duration);
      this.#requestFrame();
      if (a.p >= 1) { this.#finish(true); return; }
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  #finish(commit) {
    const a = this.#anim;
    if (!a) return;
    cancelAnimationFrame(this.#raf);
    this.#anim = null;
    if (commit) this.#current = a.to;
    for (const l of this.#layers) this.#canvas.updateElementGeometry?.(l.wrap, { canvasTransform: this.#place(new DOMMatrix()) });
    this.#applyVisibility();
    this.#requestFrame();
    a.resolve?.();
    this.dispatchEvent(new CustomEvent('livetransitionend', { detail: { from: a.from, to: a.to, effect: a.effect, committed: commit } }));
  }

  #fallbackShow(to) {
    const swap = () => {
      this.#current = to;
      this.#layers.forEach((l, i) => l.el.toggleAttribute('data-live-active', i === to));
    };
    if (document.startViewTransition) return document.startViewTransition(swap).finished.catch(() => {});
    swap();
  }

  #pairs(aEl, bEl) {
    const host = this.getBoundingClientRect();
    const boxes = (root) => {
      const map = new Map();
      for (const el of root.querySelectorAll('[data-morph]')) {
        const r = el.getBoundingClientRect();
        if (r.width && r.height) map.set(el.dataset.morph, { x: r.x - host.x, y: r.y - host.y, w: r.width, h: r.height });
      }
      return map;
    };
    // Measure with both states at rest so a previous pick() transform can't skew the boxes.
    const a = boxes(aEl), b = boxes(bEl);
    const out = [];
    for (const [key, box] of a) if (b.has(key) && out.length < 8) out.push({ key, a: box, b: b.get(key) });
    return out;
  }

  #place(m) {
    return new DOMMatrix().translate(this.#bleed, this.#bleed).multiply(m);
  }

  #upload(layer, unit, changed) {
    const gl = this.#gl;
    // A state's texture is still good if the browser has not repainted it since the last upload.
    if (layer.tex && layer.fresh && changed && !changed.has(layer.wrap)) return;
    const size = this.#canvas.getElementImageDefaultSize(layer.wrap);
    const w = Math.max(1, Math.ceil(size.width)), h = Math.max(1, Math.ceil(size.height));
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (!layer.tex) {
      layer.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, layer.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, layer.tex);
    }
    if (layer.tw !== w || layer.th !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      layer.tw = w; layer.th = h;
    }
    layer.fresh = false;
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, layer.wrap);
    layer.fresh = true;
  }

  #burnFront(a) { return a.p * 1.3 - 0.14; }
  #burnMaxD(a) {
    return Math.max(...[[0, 0], [this.#W, 0], [this.#W, this.#H], [0, this.#H]].map(([x, y]) => Math.hypot(x - a.origin.x, y - a.origin.y)));
  }
  #burnEdge(a, x, y) {
    const t = 0.55 * Math.hypot(x - a.origin.x, y - a.origin.y) / this.#burnMaxD(a) + 0.45 * noiseAt(x / 420, y / 420);
    return this.#burnFront(a) - t;
  }

  #render(event) {
    const gl = this.#gl, a = this.#anim, W = this.#W, H = this.#H;
    const changed = event?.changedElements ? new Set(event.changedElements) : null;
    if (!W || !H || !this.#layers.length) return;
    const from = this.#layers[a ? a.from : this.#current], to = this.#layers[a ? a.to : this.#current];
    try {
      this.#upload(from, 0, changed);
      if (a) this.#upload(to, 1, changed);
    } catch (err) {
      // No paint record yet (the state was only just made visible). Try again next frame.
      this.lastError = err;
      requestAnimationFrame(() => this.#canvas.requestPaint());
      return;
    }
    this.#needsFrame = false;

    const verts = (this.#verts.length = 0, this.#verts), tris = (this.#tris.length = 0, this.#tris);
    const tri = (dst, src, { mix = 0, alpha = 1, shade = 1, src2, base = false } = {}) => {
      const s2 = src2 ?? src;
      const rec = { d: [], sa: [], sb: [], mix, alpha };
      for (let i = 0; i < 3; i++) {
        const [x, y, w = 1] = dst[i];
        verts.push(x, y, w, src[i][0] / W, src[i][1] / H, s2[i][0] / W, s2[i][1] / H, mix, alpha, shade, base ? 1 : 0);
        rec.d.push(x, y); rec.sa.push(src[i][0], src[i][1]); rec.sb.push(s2[i][0], s2[i][1]);
      }
      tris.push(rec);
    };
    const corners = (r) => [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]];
    const quad = (dst, src, opts = {}) => {
      const s = corners(src), s2 = opts.src2 ? corners(opts.src2) : s;
      tri([dst[0], dst[1], dst[2]], [s[0], s[1], s[2]], { ...opts, src2: [s2[0], s2[1], s2[2]] });
      tri([dst[0], dst[2], dst[3]], [s[0], s[2], s[3]], { ...opts, src2: [s2[0], s2[2], s2[3]] });
    };

    let mode = 0;
    if (!a) {
      quad(corners({ x: 0, y: 0, w: W, h: H }), { x: 0, y: 0, w: W, h: H }, { mix: 0 });
    } else if (a.effect === 'burn') {
      mode = 1;
      quad(corners({ x: 0, y: 0, w: W, h: H }), { x: 0, y: 0, w: W, h: H }, { mix: 0 });
    } else {
      LiveTransition.effects[a.effect](a.p, { W, H, quad, tri, origin: a.origin, rand: a.rand, state: a.state, pairs: a.pairs });
    }

    gl.viewport(0, 0, this.#canvas.width, this.#canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.#prog);
    const u = this.#uni;
    gl.uniform2f(u.uView, W + 2 * this.#bleed, H + 2 * this.#bleed);
    gl.uniform2f(u.uOff, this.#bleed, this.#bleed);
    gl.uniform2f(u.uSize, W, H);
    gl.uniform1i(u.uMode, mode);
    if (mode === 1) {
      gl.uniform1f(u.uFront, this.#burnFront(a));
      gl.uniform2f(u.uOrigin, a.origin.x, a.origin.y);
      gl.uniform1f(u.uMaxD, this.#burnMaxD(a));
    }
    const holes = (key) => {
      const out = new Float32Array(32);
      (a?.effect === 'morph' ? a.pairs : []).forEach((p, i) => out.set([p[key].x / W, p[key].y / H, (p[key].x + p[key].w) / W, (p[key].y + p[key].h) / H], i * 4));
      return out;
    };
    const nPairs = a?.effect === 'morph' ? a.pairs.length : 0;
    gl.uniform4fv(u.uHolesA, holes('a'));
    gl.uniform4fv(u.uHolesB, holes('b'));
    gl.uniform1i(u.uNA, nPairs);
    gl.uniform1i(u.uNB, nPairs);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, from.tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, to.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 11);

    this.#route();
    this.dispatchEvent(new CustomEvent('liveframe', { detail: { progress: a?.p ?? 0, triangles: tris.length } }));
  }

  #onPointer = (e) => {
    const r = this.getBoundingClientRect();
    this.#pointer = { x: e.clientX - r.x, y: e.clientY - r.y };
    if (this.#anim) this.#route();
  };

  /** Point the browser's hit testing at whichever state is under the pointer, with that piece's transform. */
  #route() {
    const a = this.#anim;
    if (!a) {
      const l = this.#layers[this.#current];
      this.#canvas.updateElementGeometry(l.wrap, { canvasTransform: this.#place(new DOMMatrix()) });
      return;
    }
    const hit = this.#pointer ? this.pick(this.#pointer.x, this.#pointer.y) : null;
    for (const i of [a.from, a.to]) {
      const l = this.#layers[i];
      const mine = hit && hit.state === i;
      l.wrap.classList.toggle('off', !mine);
      if (mine) this.#canvas.updateElementGeometry(l.wrap, { canvasTransform: this.#place(hit.matrix) });
    }
  }
}

/** The 2D affine matrix that maps three source points onto three destination points. */
function affine(s, d) {
  const [sx0, sy0, sx1, sy1, sx2, sy2] = s;
  const det = sx0 * (sy1 - sy2) + sx1 * (sy2 - sy0) + sx2 * (sy0 - sy1);
  if (Math.abs(det) < 1e-9) return null;
  const solve = (d0, d1, d2) => [
    (d0 * (sy1 - sy2) + d1 * (sy2 - sy0) + d2 * (sy0 - sy1)) / det,
    (d0 * (sx2 - sx1) + d1 * (sx0 - sx2) + d2 * (sx1 - sx0)) / det,
    (d0 * (sx1 * sy2 - sx2 * sy1) + d1 * (sx2 * sy0 - sx0 * sy2) + d2 * (sx0 * sy1 - sx1 * sy0)) / det,
  ];
  const [a, c, e] = solve(d[0], d[2], d[4]);
  const [b, dd, f] = solve(d[1], d[3], d[5]);
  return new DOMMatrix([a, b, c, dd, e, f]);
}

if (!customElements.get('live-transition')) customElements.define('live-transition', LiveTransition);
