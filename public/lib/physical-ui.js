// <physical-ui>: live DOM on a simulated material.
//
//   <script type="module" src="/lib/physical-ui.js"></script>
//
//   <physical-ui material="jelly">
//     <form>…a real form…</form>
//   </physical-ui>
//
// Attributes
//   material  jelly | cloth | paper            (default jelly)
//   pin       top | corners | left | none      (default: cloth top, paper corners, jelly none)
//   wind      0..1 ambient breeze              (default 0)
//   touch     "scroll" lets a touch drag scroll the page instead of grabbing
//   bleed     canvas margin for the material to move into (default 60)
//
// The content is uploaded to a WebGL texture (texElementSubImage2D) and drawn
// on a mesh of point masses joined by distance constraints. Drag anywhere that
// is not a control to pull the material about; pressing a control or typing
// gives it a poke.
//
// Hit testing: an element's geometry is one matrix, and a wobbling mesh is not
// one matrix. But only the spot under the pointer matters, so every frame the
// triangle under the pointer is found and the element's geometry is set to
// THAT triangle's affine transform. Clicks land on what you see, even while
// it is moving. At rest the mesh is exactly the layout box.

import { SurfaceElement, ElementTexture, program, supportedGL } from './surface.js';

const MATERIALS = {
  //         home spring, constraint stiffness, iterations, bend, damping, depth push on drag, shading
  jelly: { home: 90, stiff: 0.35, iterations: 2, bend: 0, damping: 0.94, lift: 0, shade: 0.5, pin: 'none', swing: false, grab: 90 },
  cloth: { home: 26, stiff: 0.95, iterations: 4, bend: 0, damping: 0.985, lift: 0.35, shade: 0.9, pin: 'top', swing: true, grab: 46 },
  paper: { home: 150, stiff: 1, iterations: 5, bend: 0.85, damping: 0.9, lift: 0.9, shade: 1.1, pin: 'corners', swing: false, grab: 70 },
};

const INTERACTIVE = 'a[href],button,input,select,textarea,summary,label,[contenteditable],[tabindex]';
const DEPTH = 900; // perspective distance in px

const VERT = `#version 300 es
layout(location = 0) in vec3 a_pos;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_normal;
uniform vec2 u_canvas;
uniform float u_bleed;
uniform vec2 u_centre;
out vec2 v_uv;
out vec3 v_normal;
void main() {
  float k = 1.0 + a_pos.z / ${DEPTH.toFixed(1)};
  vec2 p = u_centre + (a_pos.xy - u_centre) * k + u_bleed;
  v_uv = a_uv;
  v_normal = a_normal;
  gl_Position = vec4(p.x / u_canvas.x * 2.0 - 1.0, 1.0 - p.y / u_canvas.y * 2.0, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_normal;
uniform sampler2D u_tex;
uniform float u_shade;
out vec4 o;
void main() {
  vec4 c = texture(u_tex, v_uv);
  vec3 n = normalize(v_normal);
  vec3 L = normalize(vec3(-0.45, -0.6, 0.66));
  float lit = 1.0 + (dot(n, L) - L.z) * u_shade;
  float spec = pow(max(dot(reflect(-L, n), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) - pow(L.z, 24.0);
  c.rgb = c.rgb * clamp(lit, 0.55, 1.35) + c.a * max(spec, 0.0) * 0.25 * min(u_shade, 1.0);
  o = c;
}`;

const reducedMotion = typeof matchMedia !== 'undefined' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

export class PhysicalUI extends SurfaceElement {
  static contextType = 'webgl2';
  static contextAttributes = { premultipliedAlpha: true, antialias: true };
  static defaultBleed = 60;
  static observedAttributes = ['material', 'pin', 'wind'];
  static get supported() {
    return supportedGL;
  }

  #gl = null;
  #prog = null;
  #u = {};
  #tex = null;
  #vbo = null;
  #ibo = null;
  #indexCount = 0;
  // simulation state
  #cols = 0;
  #rows = 0;
  #pos = null; // xyz per node
  #prev = null;
  #rest = null; // xy per node
  #pinned = null;
  #home = null; // per-node home spring
  #normals = null;
  #nbo = null;
  #links = null; // [a, b, restLength, stiffness] flattened
  #grab = null; // { nodes: [[index, weight, ox, oy]], x, y }
  #pointer = null;
  #awake = false;
  #last = 0;
  #gust = 0;
  #meshFor = '';
  #lost = 0;
  #scrollY = 0;
  /** Diagnostics for the demo page. */
  stats = { nodes: 0, awake: false, maxOffset: 0, hit: 'rest' };

  get material() {
    const m = this.getAttribute('material');
    return MATERIALS[m] ? m : 'jelly';
  }

  attributeChangedCallback() {
    this.#meshFor = '';
    this.wake();
  }

  connected() {
    const gl = (this.#gl = this.ctx);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.#prog = null;
      this.#lost = setTimeout(() => this.fallBackToPlain('WebGL context lost'), 1500);
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      clearTimeout(this.#lost);
      this.#meshFor = '';
      this.contentDirty = true;
      this.wake();
    });
    this.addEventListener('pointerdown', this.#onDown);
    this.addEventListener('pointermove', this.#onMove);
    this.addEventListener('pointerup', this.#onUp);
    this.addEventListener('pointercancel', this.#onUp);
    this.addEventListener('pointerleave', this.#onLeave);
    this.addEventListener('input', this.#onInput);
    this.addEventListener('click', this.#onClick);
    addEventListener('scroll', this.#onScroll, { passive: true });
    this.#scrollY = scrollY;
    if (!this.shadowRoot.adoptedStyleSheets.includes(touchSheet())) this.shadowRoot.adoptedStyleSheets.push(touchSheet());
    void gl;
  }

  disconnected() {
    removeEventListener('scroll', this.#onScroll);
  }

  resized() {
    this.#meshFor = '';
  }

  /** Start simulating (called for you on any interaction). */
  wake() {
    this.#awake = true;
    this.invalidate();
  }

  /** Push the material at a point (content px). Positive strength pushes in. */
  poke(x, y, strength = 1) {
    if (!this.#pos || reducedMotion.matches) return;
    const m = MATERIALS[this.material];
    const radius = 70;
    for (let i = 0; i < this.#pinned.length; i++) {
      if (this.#pinned[i]) continue;
      const dx = this.#rest[i * 2] - x, dy = this.#rest[i * 2 + 1] - y;
      const w = Math.exp(-(dx * dx + dy * dy) / (radius * radius));
      if (w < 0.01) continue;
      const d = Math.hypot(dx, dy) || 1;
      // Jelly bulges outward in the plane; cloth and paper are dented in depth.
      if (m.lift === 0) {
        this.#prev[i * 3] -= (dx / d) * w * 5 * strength;
        this.#prev[i * 3 + 1] -= (dy / d) * w * 5 * strength;
      } else this.#prev[i * 3 + 2] += w * 9 * strength;
    }
    this.wake();
  }

  /** A gust of wind (cloth and paper move in depth, jelly shivers). */
  gust(strength = 1) {
    this.#gust = Math.max(this.#gust, strength);
    this.wake();
  }

  // ---- input ----

  #onDown = (e) => {
    if (reducedMotion.matches || !this.#pos) return;
    const p = this.localPoint(e);
    this.#pointer = p;
    const rest = this.#restPointUnder(p) ?? p;
    if (e.target.closest?.(INTERACTIVE) && this.contains(e.target)) {
      this.poke(rest.x, rest.y, 1);
      return;
    }
    if (e.button !== 0) return;
    // Grab the nodes around the press, weighted by distance.
    const m = MATERIALS[this.material];
    const nodes = [];
    for (let i = 0; i < this.#pinned.length; i++) {
      if (this.#pinned[i]) continue;
      const dx = this.#rest[i * 2] - rest.x, dy = this.#rest[i * 2 + 1] - rest.y;
      const w = Math.exp(-(dx * dx + dy * dy) / (m.grab * m.grab));
      if (w > 0.02) nodes.push([i, w, this.#pos[i * 3] - p.x, this.#pos[i * 3 + 1] - p.y]);
    }
    if (!nodes.length) return;
    this.#grab = { nodes, x: p.x, y: p.y, sx: p.x, sy: p.y };
    try {
      this.setPointerCapture(e.pointerId);
    } catch {}
    e.preventDefault(); // a drag moves the material, it does not select text
    this.toggleAttribute('grabbing', true);
    this.wake();
  };

  #onMove = (e) => {
    this.#pointer = this.localPoint(e);
    if (this.#grab) {
      this.#grab.x = this.#pointer.x;
      this.#grab.y = this.#pointer.y;
      this.wake();
    } else if (this.#awake) this.#updateGeometry();
  };

  #onUp = (e) => {
    if (!this.#grab) return;
    this.#grab = null;
    this.toggleAttribute('grabbing', false);
    try {
      this.releasePointerCapture(e.pointerId);
    } catch {}
    this.wake();
  };

  #onLeave = () => {
    if (!this.#grab) this.#pointer = null;
  };

  #onInput = (e) => this.#pokeAt(e.target, 0.5);
  #onClick = (e) => {
    if (e.detail === 0) this.#pokeAt(e.target, 1); // keyboard activation
  };

  #pokeAt(el, strength) {
    if (!(el instanceof Element) || !this.#pos) return;
    // Layout offsets are in rest space whatever the mesh is doing.
    let x = el.offsetWidth / 2, y = el.offsetHeight / 2;
    for (let n = el; n && n !== this && this.contains(n); n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    this.poke(Math.min(this.width, Math.max(0, x)), Math.min(this.height, Math.max(0, y)), strength);
  }

  #onScroll = () => {
    const dy = scrollY - this.#scrollY;
    this.#scrollY = scrollY;
    if (!this.#pos || reducedMotion.matches || !dy) return;
    // The page moved under the material: let it lag behind and catch up.
    const lag = Math.max(-40, Math.min(40, dy)) * 0.35;
    for (let i = 0; i < this.#pinned.length; i++) {
      if (this.#pinned[i]) continue;
      const depth = MATERIALS[this.material].swing ? this.#rest[i * 2 + 1] / Math.max(1, this.height) : 1;
      this.#pos[i * 3 + 1] += lag * depth;
      this.#prev[i * 3 + 1] += lag * depth * 0.6;
    }
    this.wake();
  };

  // ---- mesh ----

  #build() {
    const gl = this.#gl;
    const m = MATERIALS[this.material];
    const w = this.width, h = this.height;
    const cols = (this.#cols = Math.max(3, Math.min(44, Math.round(w / 22))));
    const rows = (this.#rows = Math.max(3, Math.min(44, Math.round(h / 22))));
    const n = (cols + 1) * (rows + 1);
    const old = this.#pos && this.#pos.length === n * 3 ? this.#pos : null;
    this.#pos = new Float32Array(n * 3);
    this.#prev = new Float32Array(n * 3);
    this.#rest = new Float32Array(n * 2);
    this.#pinned = new Uint8Array(n);
    this.#home = new Float32Array(n);
    this.#normals = new Float32Array(n * 3);
    const uv = new Float32Array(n * 2);
    const pin = this.getAttribute('pin') ?? m.pin;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i;
        const x = (i / cols) * w, y = (j / rows) * h;
        this.#rest[k * 2] = x;
        this.#rest[k * 2 + 1] = y;
        this.#pos[k * 3] = this.#prev[k * 3] = x;
        this.#pos[k * 3 + 1] = this.#prev[k * 3 + 1] = y;
        uv[k * 2] = i / cols;
        uv[k * 2 + 1] = j / rows;
        const corner = (i === 0 || i === cols) && j === 0;
        this.#pinned[k] = pin === 'top' ? j === 0 : pin === 'corners' ? corner : pin === 'left' ? i === 0 : 0;
        // A hanging sheet swings back like a pendulum: the further from the
        // pins, the weaker the pull home. Its rest shape is exactly flat.
        this.#home[k] = m.swing ? m.home / (0.12 + j / rows) : m.home;
      }
    }
    void old;
    const links = [];
    const link = (a, b, s) => links.push(a, b, Math.hypot(this.#rest[a * 2] - this.#rest[b * 2], this.#rest[a * 2 + 1] - this.#rest[b * 2 + 1]), s);
    const at = (i, j) => j * (cols + 1) + i;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        if (i < cols) link(at(i, j), at(i + 1, j), m.stiff);
        if (j < rows) link(at(i, j), at(i, j + 1), m.stiff);
        if (i < cols && j < rows) {
          link(at(i, j), at(i + 1, j + 1), m.stiff * 0.7);
          link(at(i + 1, j), at(i, j + 1), m.stiff * 0.7);
        }
        if (m.bend) {
          if (i + 2 <= cols) link(at(i, j), at(i + 2, j), m.bend);
          if (j + 2 <= rows) link(at(i, j), at(i, j + 2), m.bend);
        }
      }
    }
    this.#links = new Float32Array(links);

    const index = new Uint16Array(cols * rows * 6);
    let q = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
        index.set([a, c, b, b, c, d], q);
        q += 6;
      }
    }
    this.#indexCount = index.length;

    if (!this.#prog) {
      this.#prog = program(gl, VERT, FRAG);
      for (const name of ['u_canvas', 'u_bleed', 'u_centre', 'u_tex', 'u_shade']) this.#u[name] = gl.getUniformLocation(this.#prog, name);
      this.#tex = new ElementTexture(gl, this.canvas, this.content);
      this.#vbo = gl.createBuffer();
      this.#ibo = gl.createBuffer();
      this.uvbo = gl.createBuffer();
      this.#nbo = gl.createBuffer();
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.#pos, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvbo);
    gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#nbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.#normals, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
    this.stats.nodes = n;
    this.contentDirty = true;
  }

  // ---- simulation ----

  #step(dt, time) {
    const m = MATERIALS[this.material];
    const pos = this.#pos, prev = this.#prev, rest = this.#rest, pinned = this.#pinned, home = this.#home;
    const n = pinned.length;
    const wind = (Number(this.getAttribute('wind')) || 0) + this.#gust;
    this.#gust *= 0.94;
    if (this.#gust < 0.01) this.#gust = 0;
    const dt2 = dt * dt;
    for (let i = 0; i < n; i++) {
      const x = i * 3;
      if (pinned[i]) {
        pos[x] = prev[x] = rest[i * 2];
        pos[x + 1] = prev[x + 1] = rest[i * 2 + 1];
        pos[x + 2] = prev[x + 2] = 0;
        continue;
      }
      const k = home[i];
      let ax = k * (rest[i * 2] - pos[x]);
      let ay = k * (rest[i * 2 + 1] - pos[x + 1]);
      let az = k * 1.4 * -pos[x + 2];
      if (wind) {
        // Travelling waves of pressure, stronger away from the pins.
        const rx = rest[i * 2], ry = rest[i * 2 + 1];
        const f = Math.sin(rx * 0.012 + time * 2.1) + Math.sin(ry * 0.009 - time * 1.4 + rx * 0.004) + 0.4 * Math.sin(time * 3.7 + rx * 0.02);
        const reach = m.swing ? ry / Math.max(1, this.height) : 1;
        if (m.lift) az += f * wind * 1500 * reach;
        ax += f * wind * (m.lift ? 500 : 900) * reach;
        if (!m.lift) ay += Math.cos(rx * 0.03 + time * 3.1) * wind * 700;
      }
      const vx = (pos[x] - prev[x]) * m.damping;
      const vy = (pos[x + 1] - prev[x + 1]) * m.damping;
      const vz = (pos[x + 2] - prev[x + 2]) * m.damping;
      prev[x] = pos[x];
      prev[x + 1] = pos[x + 1];
      prev[x + 2] = pos[x + 2];
      pos[x] += vx + ax * dt2;
      pos[x + 1] += vy + ay * dt2;
      pos[x + 2] += vz + az * dt2;
    }

    const links = this.#links;
    for (let it = 0; it < m.iterations; it++) {
      if (this.#grab) this.#applyGrab(m);
      for (let l = 0; l < links.length; l += 4) {
        const a = links[l] * 3, b = links[l + 1] * 3;
        const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const pa = pinned[links[l]], pb = pinned[links[l + 1]];
        if (pa && pb) continue;
        const diff = ((d - links[l + 2]) / d) * links[l + 3];
        const wa = pa ? 0 : pb ? 1 : 0.5, wb = pb ? 0 : pa ? 1 : 0.5;
        pos[a] += dx * diff * wa; pos[a + 1] += dy * diff * wa; pos[a + 2] += dz * diff * wa;
        pos[b] -= dx * diff * wb; pos[b + 1] -= dy * diff * wb; pos[b + 2] -= dz * diff * wb;
      }
    }
    if (this.#grab) this.#applyGrab(m);
  }

  #applyGrab(m) {
    const g = this.#grab;
    const pull = Math.hypot(g.x - g.sx, g.y - g.sy);
    for (const [i, w, ox, oy] of g.nodes) {
      const x = i * 3;
      const s = Math.min(1, w * 1.6);
      this.#pos[x] += (g.x + ox - this.#pos[x]) * s;
      this.#pos[x + 1] += (g.y + oy - this.#pos[x + 1]) * s;
      // Sheets lift towards you as they are pulled, so they fold rather than slide.
      if (m.lift) this.#pos[x + 2] += (Math.min(120, pull * m.lift) * w - this.#pos[x + 2]) * s;
    }
  }

  // ---- hit testing ----

  #project(i, out) {
    const x = this.#pos[i * 3], y = this.#pos[i * 3 + 1], k = 1 + this.#pos[i * 3 + 2] / DEPTH;
    const cx = this.width / 2, cy = this.height / 2;
    out[0] = cx + (x - cx) * k;
    out[1] = cy + (y - cy) * k;
    return out;
  }

  /** Find the mesh triangle under a point (content px). Returns the corners or null. */
  #triangleUnder(p) {
    const cols = this.#cols, rows = this.#rows;
    const A = [0, 0], B = [0, 0], C = [0, 0], D = [0, 0];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        this.#project(a, A); this.#project(b, B); this.#project(c, C); this.#project(d, D);
        if (inside(p, A, C, B)) return [a, c, b, [...A], [...C], [...B]];
        if (inside(p, B, C, D)) return [b, c, d, [...B], [...C], [...D]];
      }
    }
    return null;
  }

  #restPointUnder(p) {
    const t = this.#triangleUnder(p);
    if (!t) return null;
    const [a, b, c, A, B, C] = t;
    const [u, v, w] = barycentric(p, A, B, C);
    const r = this.#rest;
    return { x: r[a * 2] * u + r[b * 2] * v + r[c * 2] * w, y: r[a * 2 + 1] * u + r[b * 2 + 1] * v + r[c * 2 + 1] * w };
  }

  // #region geometry
  #updateGeometry() {
    const p = this.#pointer;
    let matrix = null;
    if (p && this.#awake) {
      const t = this.#triangleUnder(p);
      if (t) {
        const [a, b, c, A, B, C] = t;
        const r = this.#rest;
        matrix = affine([r[a * 2], r[a * 2 + 1]], [r[b * 2], r[b * 2 + 1]], [r[c * 2], r[c * 2 + 1]], A, B, C);
      }
    }
    if (matrix) {
      this.setGeometry(new DOMMatrix().translate(this.bleed, this.bleed).multiply(matrix));
      this.stats.hit = 'triangle under the pointer';
    } else {
      this.setGeometry();
      this.stats.hit = 'rest';
    }
  }
  // #endregion geometry

  // ---- frame ----

  render(now) {
    const gl = this.#gl;
    if (!gl || gl.isContextLost()) return false;
    const key = `${this.material}|${this.getAttribute('pin')}|${Math.round(this.width)}x${Math.round(this.height)}`;
    if (key !== this.#meshFor) {
      this.#build();
      this.#meshFor = key;
    }
    const m = MATERIALS[this.material];
    const windy = (Number(this.getAttribute('wind')) || 0) > 0 || this.#gust > 0;
    if (reducedMotion.matches) this.#awake = false;
    if ((this.#awake || windy) && !reducedMotion.matches) {
      this.#awake = true;
      const dt = Math.min(1 / 30, Math.max(1 / 240, (now - this.#last) / 1000 || 1 / 60));
      const steps = 2;
      for (let s = 0; s < steps; s++) this.#step(dt / steps, now / 1000);
      // Sleep when nothing is moving: snap exactly to the layout box.
      let maxOffset = 0, maxSpeed = 0;
      const pos = this.#pos, prev = this.#prev, rest = this.#rest;
      for (let i = 0; i < this.#pinned.length; i++) {
        const o = Math.abs(pos[i * 3] - rest[i * 2]) + Math.abs(pos[i * 3 + 1] - rest[i * 2 + 1]) + Math.abs(pos[i * 3 + 2]);
        const v = Math.abs(pos[i * 3] - prev[i * 3]) + Math.abs(pos[i * 3 + 1] - prev[i * 3 + 1]) + Math.abs(pos[i * 3 + 2] - prev[i * 3 + 2]);
        if (o > maxOffset) maxOffset = o;
        if (v > maxSpeed) maxSpeed = v;
      }
      this.stats.maxOffset = maxOffset;
      if (!this.#grab && !windy && maxOffset < 0.15 && maxSpeed < 0.02) {
        for (let i = 0; i < this.#pinned.length; i++) {
          pos[i * 3] = prev[i * 3] = rest[i * 2];
          pos[i * 3 + 1] = prev[i * 3 + 1] = rest[i * 2 + 1];
          pos[i * 3 + 2] = prev[i * 3 + 2] = 0;
        }
        this.#awake = false;
        this.stats.maxOffset = 0;
      }
    }
    this.#last = now;
    this.stats.awake = this.#awake;

    gl.activeTexture(gl.TEXTURE0);
    if (this.contentDirty || !this.#tex.width) this.#tex.update();
    else gl.bindTexture(gl.TEXTURE_2D, this.#tex.texture);
    this.contentDirty = false;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.#prog);
    gl.uniform2f(this.#u.u_canvas, this.canvas.width / this.scale, this.canvas.height / this.scale);
    gl.uniform1f(this.#u.u_bleed, this.bleed);
    gl.uniform2f(this.#u.u_centre, this.width / 2, this.height / 2);
    gl.uniform1i(this.#u.u_tex, 0);
    gl.uniform1f(this.#u.u_shade, m.shade);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#pos);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    this.#computeNormals();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.#nbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.#normals);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#ibo);
    gl.drawElements(gl.TRIANGLES, this.#indexCount, gl.UNSIGNED_SHORT, 0);

    this.#updateGeometry();
    return this.#awake;
  }

  // Smooth per-node normals from the neighbours on each side.
  #computeNormals() {
    const cols = this.#cols, rows = this.#rows, pos = this.#pos, out = this.#normals, w = cols + 1;
    for (let j = 0; j <= rows; j++) {
      for (let i = 0; i <= cols; i++) {
        const k = j * w + i;
        const l = (j * w + Math.max(0, i - 1)) * 3, r = (j * w + Math.min(cols, i + 1)) * 3;
        const u = (Math.max(0, j - 1) * w + i) * 3, d = (Math.min(rows, j + 1) * w + i) * 3;
        const ax = pos[r] - pos[l], ay = pos[r + 1] - pos[l + 1], az = pos[r + 2] - pos[l + 2];
        const bx = pos[d] - pos[u], by = pos[d + 1] - pos[u + 1], bz = pos[d + 2] - pos[u + 2];
        out[k * 3] = ay * bz - az * by;
        out[k * 3 + 1] = az * bx - ax * bz;
        out[k * 3 + 2] = ax * by - ay * bx;
      }
    }
  }

  /** Render now and return a 2D context holding the pixels (for tests and export). */
  snapshot() {
    this.contentDirty = true;
    this.render(performance.now());
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(this.canvas, 0, 0);
    return ctx;
  }

  /** Where a rest-space point (content px) currently is on screen (content px). */
  whereIs(x, y) {
    const cols = this.#cols, rows = this.#rows;
    const fi = Math.min(cols - 1e-6, Math.max(0, (x / this.width) * cols)), fj = Math.min(rows - 1e-6, Math.max(0, (y / this.height) * rows));
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
    const a = j * (cols + 1) + i, A = this.#project(a, [0, 0]), B = this.#project(a + 1, [0, 0]), C = this.#project(a + cols + 1, [0, 0]), D = this.#project(a + cols + 2, [0, 0]);
    // Same split as the index buffer: (a, c, b) and (b, c, d).
    if (u + v <= 1) return { x: A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v, y: A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v };
    return { x: D[0] + (C[0] - D[0]) * (1 - u) + (B[0] - D[0]) * (1 - v), y: D[1] + (C[1] - D[1]) * (1 - u) + (B[1] - D[1]) * (1 - v) };
  }

  /** Move the pointer used for hit testing from script (client coords, or null). */
  pointTo(clientX, clientY) {
    this.#pointer = clientX == null ? null : this.localPoint({ clientX, clientY });
    this.#updateGeometry();
  }
}

function barycentric(p, a, b, c) {
  const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
  if (Math.abs(d) < 1e-9) return [-1, -1, -1];
  const u = ((b[1] - c[1]) * (p.x - c[0]) + (c[0] - b[0]) * (p.y - c[1])) / d;
  const v = ((c[1] - a[1]) * (p.x - c[0]) + (a[0] - c[0]) * (p.y - c[1])) / d;
  return [u, v, 1 - u - v];
}

function inside(p, a, b, c) {
  const [u, v, w] = barycentric(p, a, b, c);
  return u >= -1e-4 && v >= -1e-4 && w >= -1e-4;
}

/** The 2D affine matrix taking s0,s1,s2 to d0,d1,d2. */
function affine(s0, s1, s2, d0, d1, d2) {
  const det = (s1[0] - s0[0]) * (s2[1] - s0[1]) - (s2[0] - s0[0]) * (s1[1] - s0[1]);
  if (Math.abs(det) < 1e-9) return null;
  const a = ((d1[0] - d0[0]) * (s2[1] - s0[1]) - (d2[0] - d0[0]) * (s1[1] - s0[1])) / det;
  const c = ((d2[0] - d0[0]) * (s1[0] - s0[0]) - (d1[0] - d0[0]) * (s2[0] - s0[0])) / det;
  const b = ((d1[1] - d0[1]) * (s2[1] - s0[1]) - (d2[1] - d0[1]) * (s1[1] - s0[1])) / det;
  const d = ((d2[1] - d0[1]) * (s1[0] - s0[0]) - (d1[1] - d0[1]) * (s2[0] - s0[0])) / det;
  return new DOMMatrix([a, b, c, d, d0[0] - a * s0[0] - c * s0[1], d0[1] - b * s0[0] - d * s0[1]]);
}

let sheet;
function touchSheet() {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(':host { touch-action: none; } :host([touch="scroll"]) { touch-action: auto; } :host([grabbing]) { cursor: grabbing; }');
  }
  return sheet;
}

if (!customElements.get('physical-ui')) customElements.define('physical-ui', PhysicalUI);
