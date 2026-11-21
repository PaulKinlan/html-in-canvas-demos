// <select picker="wheel">: a customisable select whose picker is drawn by a canvas.
//
//   <script type="module" src="/lib/select-picker.js"></script>
//
//   <select picker="wheel" name="time">
//     <option>09:00</option>
//     <option>09:30</option>
//   </select>
//
// picker="wheel"     a drum, like the iOS time picker (2D canvas)
// picker="fisheye"   every option at once; the ones near the pointer are full size (2D canvas)
// picker="radial"    options on a circle around the button (2D canvas)
// picker="carousel"  cards on a 3D carousel with reflections (WebGPU, WebGL 2, then 2D)
// picker="fan"       a hand of cards; slide along it and lift to choose (2D canvas)
// picker="grid"      a grid of small options, enlarged near the pointer (2D canvas)
// picker="helix"     a long list wound round a cylinder (WebGPU, WebGL 2, then 2D)
//
// rollSelected(select) animates the chosen value in the button; see the end of this file.
//
// How it works. The select uses `appearance: base-select`, so its picker is
// ordinary HTML in the top layer. This file moves the options into a
// <canvas content="drawable"> inside the select. They stay real <option>
// elements: the select still owns the value, the keyboard, typeahead, the
// form entry and the accessibility tree. The canvas only decides where each
// option is drawn, and the browser hit tests each option where it was drawn.
//
// Without HTML-in-canvas or `appearance: base-select` the select is left
// alone and works as an ordinary select.
//
// From script:  new SelectPicker(select, { layout: 'wheel' })
// Add a layout: layouts.mine = { size, place, … }   (see "layouts" below)

const HAS_CANVAS = typeof CanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in CanvasRenderingContext2D.prototype;
const HAS_BASE_SELECT = typeof CSS !== 'undefined' && CSS.supports('appearance', 'base-select');
/** True when this browser can run a canvas-drawn picker. */
export const supported = HAS_CANVAS && HAS_BASE_SELECT;

const T = (x, y, z = 0) => new DOMMatrix().translate(x, y, z);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const FAR = T(-1e5, -1e5);
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Layouts.
//
//   size(n, vw, vh)   → [width, height] of the picker in CSS px
//   place(i, s)       → where option i goes this frame, or null to hide it:
//                       { m: DOMMatrix from the option's own box (origin at its
//                         top left, CSS px) to canvas CSS px, alpha, shade, order }
//                       Options are drawn in ascending `order`. The last one
//                       drawn wins the hit test where two overlap.
//   prepare(s)        optional, once per frame before place()
//   under(ctx, s)     optional 2D drawing below the options (2D backend only)
//   over(ctx, s)      optional 2D drawing above the options (2D backend only)
//   axis, pitch       'x' or 'y': dragging along it moves s.pos by one option per `pitch` px
//   live              the option at s.pos becomes the value while the picker is open
//   releasePicks      lifting a finger over an option chooses it
//   gpu               draw with WebGPU or WebGL when available
//   center            open centred on the button instead of below it
//
// `s` is the picker's state: w, h (CSS px), n, sizes[i] {w, h}, pos (a
// fractional option index), active (the focused option), open (0 to 1 while
// the picker opens), px, py, pointer (is a pointer over the canvas), ink and
// accent (CSS colours).
// ---------------------------------------------------------------------------

// #region wheel
const wheel = {
  size: () => [240, 216],
  axis: 'y',
  pitch: 40,
  live: true,
  place(i, s) {
    const a = (i - s.pos) * 0.42 * (0.4 + 0.6 * s.open); // angle round the drum
    if (Math.abs(a) > 1.45) return null;
    const c = Math.cos(a), o = s.sizes[i];
    // Translating by R·sin(a) and squashing by cos(a) is an affine transform,
    // so a 2D canvas can draw it and hit testing follows exactly.
    return { m: T(s.w / 2, s.h / 2 + 96 * Math.sin(a)).scale(0.82 + 0.18 * c, c).translate(-o.w / 2, -o.h / 2), alpha: c ** 1.6 * s.open, order: c };
  },
  under(ctx, s) {
    ctx.fillStyle = s.accent;
    ctx.globalAlpha = 0.14;
    ctx.beginPath();
    ctx.roundRect(10, s.h / 2 - 21, s.w - 20, 42, 9);
    ctx.fill();
  },
};
// #endregion wheel

// #region fisheye
const fisheye = {
  size: (n, vw, vh) => [Math.min(260, vw - 24), Math.round(clamp(Math.min(n * 28, vh * 0.62, 460), 120, 460))],
  releasePicks: true,
  prepare(s) {
    const h0 = s.sizes[0]?.h || 28, n = s.n, H = s.h - 8;
    // Option i gets a slot of weight 1 + A·gauss(i - f). A is chosen so that
    // the option in focus gets its natural height and the slots add up to H.
    const sigma = 2.6, spread = sigma * Math.sqrt(Math.PI);
    const A = Math.max(0, ((h0 * n) / H - 1) / Math.max(0.2, 1 - (h0 * spread) / H));
    const slots = (f) => {
      const w = [];
      let total = 0;
      for (let i = 0; i < n; i++) total += w[i] = 1 + A * Math.exp(-(((i + 0.5 - f) / sigma) ** 2));
      return { w, total };
    };
    let f = s.pos + 0.5;
    if (s.pointer) {
      // Find the focus f that puts option f under the pointer (bisection: the
      // position of f grows with f).
      const target = clamp((s.py - 4) / H, 0, 1);
      let lo = 0, hi = n;
      for (let k = 0; k < 14; k++) {
        f = (lo + hi) / 2;
        const { w, total } = slots(f);
        let before = 0;
        for (let i = 0; i < Math.floor(f) && i < n; i++) before += w[i];
        if (f < n) before += w[Math.floor(f)] * (f % 1);
        if (before / total < target) lo = f; else hi = f;
      }
    }
    const { w, total } = slots(f);
    let y = 4;
    s.fish = w.map((wi) => {
      const height = (H * wi) / total, top = y;
      y += height;
      return { top, scale: Math.min(1.15, height / h0) };
    });
  },
  place(i, s) {
    const { top, scale } = s.fish[i];
    return { m: T(10 + (1 - scale) * 18 + (1 - s.open) * -14, top).scale(scale), alpha: clamp(0.3 + 0.7 * scale, 0, 1) * s.open, order: scale };
  },
};
// #endregion fisheye

// #region radial
const radial = {
  size: (n, vw) => [Math.min(280, vw - 24), Math.min(280, vw - 24)],
  releasePicks: true,
  center: true,
  place(i, s) {
    const a = -Math.PI / 2 + (i / s.n) * TAU - (1 - s.open) * 0.9;
    const R = (s.w / 2 - 48) * s.open, o = s.sizes[i];
    const scale = (0.5 + 0.5 * s.open) * (i === s.active ? 1.12 : 1);
    return { m: T(s.w / 2 + R * Math.cos(a), s.h / 2 + R * Math.sin(a)).scale(scale).translate(-o.w / 2, -o.h / 2), alpha: s.open, order: i === s.active ? 1 : 0 };
  },
  under(ctx, s) {
    const cx = s.w / 2, cy = s.h / 2, R = (s.w / 2 - 48) * s.open;
    ctx.strokeStyle = s.ink;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();
    // A spoke from the centre to the focused option.
    const a = -Math.PI / 2 + (s.active / s.n) * TAU;
    ctx.strokeStyle = s.accent;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (R - 30) * Math.cos(a), cy + (R - 30) * Math.sin(a));
    ctx.stroke();
    ctx.fillStyle = s.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, TAU);
    ctx.fill();
  },
};
// #endregion radial

// #region carousel
const carousel = {
  size: (n, vw) => [Math.min(360, vw - 24), 300],
  axis: 'x',
  pitch: 96,
  live: true,
  gpu: true,
  place(i, s) {
    const d = i - s.pos, far = Math.abs(d);
    if (far > 3.3) return null;
    const t = Math.tanh(d * 1.4), o = s.sizes[i];
    const cx = s.w / 2, cy = s.h / 2 - 22;
    // CSS-style perspective about the centre of the canvas, then each card is
    // pushed back and turned about its own vertical axis.
    const eye = new DOMMatrix();
    eye.m34 = -1 / 620;
    const m = T(cx, cy)
      .multiply(eye)
      .translate((t * 58 + d * 50) * s.open, 0, -110 * Math.min(1, far))
      .rotate(0, -t * 58, 0)
      .translate(-o.w / 2, -o.h / 2);
    return { m, alpha: clamp(3.3 - far, 0, 1) * s.open, shade: 1 - 0.42 * Math.min(1, far), order: -far, reflect: true };
  },
};
// #endregion carousel

// #region fan
// A hand of cards. Each card is rotated about a point below the canvas. The
// card under the pointer, or the focused one, is lifted and drawn last.
const fan = {
  size: (n, vw) => [Math.min(360, vw - 24), 236],
  releasePicks: true,
  prepare(s) {
    // The outermost cards must stay inside the canvas, so the spread depends on its width.
    const R = 330, half = Math.max(...s.sizes.map((o) => o.w), 80) / 2 + 14;
    const spread = (2 * Math.asin(clamp((s.w / 2 - half) / R, 0.05, 1)) * 180) / Math.PI;
    const step = Math.min(13, spread / Math.max(1, s.n - 1));
    s.fan = { step, R, px: s.w / 2, py: s.h + 196 };
    s.hot = s.active;
    if (s.pointer) {
      // The pointer's angle about the pivot picks the card.
      const deg = (Math.atan2(s.px - s.fan.px, s.fan.py - s.py) * 180) / Math.PI;
      s.hot = clamp(Math.round(deg / step + (s.n - 1) / 2), 0, s.n - 1);
    }
  },
  place(i, s) {
    const { step, R, px, py } = s.fan, o = s.sizes[i];
    const hot = i === s.hot;
    const a = (i - (s.n - 1) / 2) * step * s.open;
    const m = T(px, py).rotate(a).translate(0, -(R + (hot ? 24 : 0))).scale(hot ? 1.12 : 1).translate(-o.w / 2, -o.h / 2);
    return { m, alpha: s.open, order: hot ? 1e3 : i };
  },
};
// #endregion fan

// #region grid
// A grid of small options. The ones near the pointer are enlarged and their
// neighbours are pushed outwards, like a magnifying dock in two dimensions.
const grid = {
  size(n, vw) {
    const w = Math.min(312, vw - 24), cols = 8, cell = (w - 20) / cols;
    return [w, Math.round(Math.ceil(n / cols) * cell + 20)];
  },
  releasePicks: true,
  place(i, s) {
    const cols = 8, cell = (s.w - 20) / cols, o = s.sizes[i];
    let x = 10 + (i % cols + 0.5) * cell, y = 10 + (Math.floor(i / cols) + 0.5) * cell;
    let scale = (cell - 6) / Math.max(o.w, o.h);
    const [fx, fy] = s.pointer ? [s.px, s.py] : [10 + (s.active % cols + 0.5) * cell, 10 + (Math.floor(s.active / cols) + 0.5) * cell];
    const dx = x - fx, dy = y - fy, near = Math.exp(-(dx * dx + dy * dy) / (2 * (cell * 1.25) ** 2));
    const grow = s.pointer ? 1.15 : 0.6;
    x += dx * near * 0.55 * grow;
    y += dy * near * 0.55 * grow;
    scale *= 1 + near * grow;
    return { m: T(x, y).scale(scale * (0.4 + 0.6 * s.open)).translate(-o.w / 2, -o.h / 2), alpha: s.open, order: near };
  },
};
// #endregion grid

// #region helix
// A long list wound round a vertical cylinder. The option at s.pos faces the
// viewer; the ones behind the cylinder show through, dimmed.
const helix = {
  size: (n, vw) => [Math.min(300, vw - 24), 330],
  axis: 'y',
  pitch: 38,
  live: true,
  gpu: true,
  place(i, s) {
    const d = i - s.pos;
    if (Math.abs(d) > 8.5) return null;
    const o = s.sizes[i], turn = d * 42 * (0.3 + 0.7 * s.open), rad = (turn * Math.PI) / 180, R = 84;
    const eye = new DOMMatrix();
    eye.m34 = -1 / 700;
    const m = T(s.w / 2, s.h / 2)
      .multiply(eye)
      .translate(Math.sin(rad) * R, d * 30, (Math.cos(rad) - 1) * R)
      .rotate(0, turn, 0)
      .translate(-o.w / 2, -o.h / 2);
    const front = Math.cos(rad);
    return { m, alpha: clamp(8.5 - Math.abs(d), 0, 1) * s.open * (front < 0 ? 0.3 : 1), shade: 0.55 + 0.45 * Math.max(0, front), order: front };
  },
};
// #endregion helix

export const layouts = { wheel, fisheye, radial, carousel, fan, grid, helix };

// ---------------------------------------------------------------------------
// Styles. Everything about an option's look is ordinary CSS on the option.
// The rules below are defaults inside :where(), so page rules override them.
// ---------------------------------------------------------------------------
const CSS_TEXT = `
select[picker], select[picker]::picker(select) { appearance: base-select; }
select[picker]::picker(select) { padding: 0; border: 0; margin: 6px 0; background: none; box-shadow: none; overflow: visible; }
select[picker][picker-center]::picker(select) { position-area: center; margin: 0; }
select[picker] > button > canvas { display: block; flex: 1; min-width: 0; height: 1.5em; }
select[picker] > button > canvas > selectedcontent { display: block; width: max-content; }
select[picker] > canvas {
  display: block; touch-action: none; user-select: none; -webkit-user-select: none; cursor: default;
  border-radius: 16px; background: var(--picker-bg, Canvas); color: var(--picker-ink, CanvasText);
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  box-shadow: 0 10px 34px rgb(0 0 0 / .28);
}
select[picker="radial"] > canvas { border-radius: 50%; }
select[picker] option { touch-action: none; }
:where(select[picker]) option { box-sizing: border-box; display: flex; align-items: center; justify-content: center; margin: 0; padding: 0 12px; border-radius: 8px; white-space: nowrap; }
:where(select[picker]) option::checkmark { display: none; }
:where(select[picker]) option:checked { font-weight: 700; color: var(--picker-accent, AccentColor); }
:where(select[picker="wheel"]) option { width: 200px; height: 40px; font-size: 19px; font-variant-numeric: tabular-nums; background: none; }
:where(select[picker="fisheye"]) option { width: calc(var(--picker-w) - 20px); height: 28px; font-size: 15px; justify-content: flex-start; transform-origin: 0 0; }
:where(select[picker="radial"]) option { width: max-content; min-width: 64px; height: 40px; border-radius: 20px; padding: 0 12px; gap: 6px; background: color-mix(in srgb, currentColor 9%, var(--picker-bg, Canvas)); }
:where(select[picker="radial"]) option:is(:hover, :focus-visible) { background: color-mix(in srgb, var(--picker-accent, AccentColor) 30%, var(--picker-bg, Canvas)); }
:where(select[picker="fan"]) option { width: 96px; height: 132px; display: block; padding: 0; border-radius: 10px; white-space: normal; overflow: hidden; }
:where(select[picker="grid"]) option { width: 34px; height: 34px; padding: 0; border-radius: 8px; overflow: hidden; }
:where(select[picker="helix"]) option { width: 180px; height: 38px; font-size: 17px; background: color-mix(in srgb, currentColor 8%, var(--picker-bg, Canvas)); }
:where(select[picker="carousel"]) option { width: 150px; height: 190px; display: block; padding: 0; border-radius: 14px; white-space: normal; overflow: hidden; }
`;

function installCSS(root) {
  const host = root.nodeType === 9 ? root.head : root;
  if (host.querySelector('style[data-select-picker]')) return;
  const style = document.createElement('style');
  style.dataset.selectPicker = '';
  style.textContent = CSS_TEXT;
  host.prepend(style);
}

// ---------------------------------------------------------------------------
// The picker.
// ---------------------------------------------------------------------------
const pickers = new WeakMap();

export class SelectPicker {
  /** 'webgpu' | 'webgl' | '2d'. Decided before the picker first opens. */
  backend = '2d';
  /** Why the picker is not on the backend it asked for, or '' */
  note = '';
  /** Frames drawn since the page loaded, for tests. */
  frames = 0;
  #renderer = null;
  #running = false;
  #openAt = 0;
  #target = 0;
  #down = null;
  #dirty = true;
  #last = 0;
  #unit = null;
  #losses = 0;
  #mine = false; // has the person used this picker, or is one of its options the value?

  /**
   * `canvas` is optional: a canvas the page already wrote inside the select,
   * with options in it. The picker then manages only those options, so one
   * select can hold several canvases with a picker each.
   */
  constructor(select, { layout = select.getAttribute('picker') || 'wheel', backend = select.getAttribute('backend') || '', canvas = null } = {}) {
    const key = canvas ?? select;
    if (pickers.has(key)) return pickers.get(key);
    pickers.set(key, this);
    this.select = select;
    this.name = layouts[layout] ? layout : 'wheel';
    this.layout = layouts[this.name];
    this.s = { w: 0, h: 0, n: 0, sizes: [], pos: 0, active: 0, open: 0, px: 0, py: 0, pointer: false, ink: '#000', accent: '#06c' };
    if (!supported) {
      this.note = HAS_BASE_SELECT ? 'HTML-in-canvas is not available, so this is a plain customisable select' : 'appearance: base-select is not available, so this is the browser\'s own select';
      select.setAttribute('picker-state', 'plain');
      this.ready = Promise.resolve(this);
      return;
    }
    if (!select.hasAttribute('picker')) select.setAttribute('picker', this.name);
    select.toggleAttribute('picker-center', !!this.layout.center);
    installCSS(select.getRootNode());
    this.#wrap(canvas);
    this.#listen();
    this.ready = this.#chooseBackend(backend).then(() => this);
  }

  // #region wrap
  // Move the options into a drawable canvas inside the select. A select finds
  // its options among all its descendants, so they are still its options.
  #wrap(given) {
    const { select } = this;
    const canvas = given ?? document.createElement('canvas');
    canvas.setAttribute('content', 'drawable');
    canvas.setAttribute('layoutsubtree', ''); // the attribute's name in older Chrome versions
    if (!given) {
      for (const option of [...select.options]) canvas.append(option);
      for (const group of select.querySelectorAll(':scope > optgroup')) group.remove(); // groups are flattened
      select.append(canvas);
    }
    for (const option of canvas.querySelectorAll('option')) option.setAttribute('drawable', '');
    this.#adopt(canvas);
  }
  // #endregion wrap

  /** The options this picker draws: the ones inside its canvas. */
  get options() {
    return this.canvas ? [...this.select.options].filter((option) => option.parentNode === this.canvas) : [];
  }

  #adopt(canvas) {
    this.canvas = canvas;
    this.#unit = null;
    canvas.addEventListener('paint', () => this.#paint());
    canvas.addEventListener('contextlost', (e) => { e.preventDefault(); this.#lost('the 2D canvas lost its context'); });
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.#lost('the WebGL context was lost'); });
    this.#resize();
  }

  /** Call after adding or removing options from script. */
  refresh() {
    if (!this.canvas) return;
    for (const option of [...this.select.options]) {
      if (!option.closest('canvas')) this.canvas.append(option);
      if (option.parentNode === this.canvas) option.setAttribute('drawable', '');
    }
    this.s.sizes = [];
    this.#resize();
    this.canvas.requestPaint?.();
  }

  #resize() {
    const { canvas, select, s } = this;
    const [w, h] = this.layout.size(this.options.length, innerWidth, innerHeight);
    if (w === s.w && h === s.h) return;
    s.w = w;
    s.h = h;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.setProperty('--picker-w', `${w}px`);
    s.sizes = [];
  }

  async #chooseBackend(want) {
    if (!this.layout.gpu) return;
    want ||= new URLSearchParams(location.search).get('backend') || '';
    try {
      const { pickBackend, webgpu } = await import('../shared/backend.js');
      let backend = await pickBackend({ want });
      if (backend === 'webgpu') {
        const util = await import('./gpu-util.js');
        const gpu = util.supportedGPU ? await webgpu() : null;
        if (gpu) this.#renderer = new GPURenderer(this.canvas, gpu, util, (why) => this.#lost(why));
        else backend = 'webgl';
      }
      if (backend === 'webgl') {
        if ('texElementSubImage2D' in WebGL2RenderingContext.prototype) this.#renderer = new GLRenderer(this.canvas);
        else backend = '2d';
      }
      this.backend = backend;
      if (backend !== 'webgpu' && webgpu.reason) this.note = `not WebGPU: ${webgpu.reason}`;
    } catch (err) {
      // The canvas may already hold a WebGL or WebGPU context, so it cannot give a 2D one. Swap it.
      this.#lost(`${want || 'the GPU route'} could not start (${err.message.trim()})`);
      this.#losses--;
    }
    this.select.setAttribute('picker-backend', this.backend);
  }

  // A canvas that lost its context is replaced by a fresh 2D one, which every
  // layout can draw on. After three losses the options go back into the
  // select and it becomes a plain customisable select.
  #lost(why) {
    const old = this.canvas;
    if (!old?.isConnected) return;
    this.#renderer?.destroy?.();
    this.#renderer = null;
    this.backend = '2d';
    this.note = `${why}; drawn with a 2D canvas instead`;
    if (++this.#losses > 3) {
      for (const option of this.options) { option.removeAttribute('drawable'); this.select.append(option); }
      old.remove();
      this.canvas = null;
      this.select.removeAttribute('picker');
      this.select.setAttribute('picker-state', 'plain');
      this.note = `${why} repeatedly; this is now a plain customisable select`;
      return;
    }
    const canvas = old.cloneNode(false);
    canvas.append(...old.childNodes);
    old.replaceWith(canvas);
    this.s.w = this.s.h = 0;
    this.#adopt(canvas);
    this.select.setAttribute('picker-backend', '2d');
    canvas.requestPaint?.();
  }

  get open() {
    return this.select.matches(':open');
  }

  // #region input
  #listen() {
    const { select, s } = this;
    const local = (e) => {
      const r = this.canvas.getBoundingClientRect();
      s.px = e.clientX - r.left;
      s.py = e.clientY - r.top;
    };
    const along = (e) => (this.layout.axis === 'x' ? e.clientX : e.clientY);
    const inCanvas = (e) => this.canvas && (e.target === this.canvas || this.canvas.contains(e.target));

    // The keyboard is the select's own: arrow keys move focus from option to
    // option, and the layout follows the focused option.
    select.addEventListener('focusin', (e) => {
      const i = this.options.indexOf(e.target);
      if (i < 0) return;
      this.#mine = true;
      s.active = i;
      if (!this.#down?.moved) this.#target = i;
      this.#touch();
    });
    select.addEventListener('pointerdown', (e) => {
      if (!inCanvas(e)) return;
      local(e);
      s.pointer = true;
      this.#mine = true;
      this.#down = { id: e.pointerId, at: along(e), x: e.clientX, y: e.clientY, pos: s.pos, moved: false, v: 0, t: performance.now(), last: along(e), type: e.pointerType };
      this.#touch();
    });
    const move = (e) => {
      if (!inCanvas(e)) return;
      local(e);
      s.pointer = true;
      const d = this.#down;
      if (d && d.id === e.pointerId) {
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) {
          d.moved = true;
          // From here on the pointer belongs to the canvas, so lifting it does
          // not choose the option under it the way a click would.
          try { this.canvas.setPointerCapture(e.pointerId); } catch {}
        }
        if (d.moved && this.layout.axis) {
          const now = performance.now(), a = along(e);
          if (a !== d.last) {
            d.v = (-(a - d.last) / this.layout.pitch / Math.max(1, now - d.t)) * 1000; // options per second
            d.last = a;
            d.t = now;
          }
          const pos = d.pos - (a - d.at) / this.layout.pitch;
          const max = s.n - 1;
          s.pos = pos < 0 ? pos * 0.35 : pos > max ? max + (pos - max) * 0.35 : pos; // resist past the ends
        }
      }
      this.#touch();
    };
    select.addEventListener('pointermove', move);
    const up = (e) => {
      const d = this.#down;
      if (!d || d.id !== e.pointerId) return;
      if (e.type === 'pointerup') move(e); // the last move can be missing on a touch screen
      this.#down = null;
      if (d.type !== 'mouse') s.pointer = false;
      if (d.moved && this.layout.axis) {
        const stale = performance.now() - d.t > 90;
        this.#target = clamp(Math.round(s.pos + (stale ? 0 : d.v * 0.18)), 0, s.n - 1);
      }
      // Fisheye and radial: sliding a finger and lifting it chooses the option under it.
      if (e.type === 'pointerup' && this.layout.releasePicks && (d.moved || d.type !== 'mouse')) {
        const i = this.optionAt(e.clientX, e.clientY);
        if (i >= 0) this.choose(i, { close: true });
      }
      this.#touch();
    };
    select.addEventListener('pointerup', up);
    select.addEventListener('pointercancel', up);
    select.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.#down) { s.pointer = false; this.#touch(); }
    });
    // touch-action: none on the canvas and the options did not stop the page
    // panning under a finger in the picker (Chromium 157), which cancels the
    // pointer. Cancelling touchmove does.
    select.addEventListener('touchmove', (e) => {
      if (inCanvas(e) && e.cancelable) e.preventDefault();
    }, { passive: false });
    // With releasePicks the pointerup above chooses, so stop the click a touch would also send.
    select.addEventListener('touchend', (e) => {
      if (this.layout.releasePicks && inCanvas(e) && e.cancelable) e.preventDefault();
    }, { passive: false });
    select.addEventListener('wheel', (e) => {
      if (!this.layout.axis || !inCanvas(e)) return;
      e.preventDefault();
      const now = performance.now();
      if (now - this.#lastWheel < 70) return;
      this.#lastWheel = now;
      this.#mine = true;
      this.#target = clamp(this.#target + Math.sign(e.deltaY || e.deltaX), 0, s.n - 1);
      this.#touch();
    }, { passive: false });
    addEventListener('resize', () => { if (this.canvas) { this.#resize(); this.#touch(); } });
  }
  #lastWheel = 0;
  // #endregion input

  /** Index of the option drawn at a viewport point, or -1. */
  optionAt(x, y) {
    const option = document.elementFromPoint(x, y)?.closest?.('option');
    return option ? this.options.indexOf(option) : -1;
  }

  // #region choose
  /** Make option i the value, with the events a person's choice sends. */
  choose(i, { close = false } = {}) {
    const { select } = this;
    const option = this.options[i];
    if (option && !option.selected) {
      option.selected = true;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (close) this.close();
  }

  /**
   * Close the picker. HTMLSelectElement has showPicker() and no hidePicker(),
   * and the picker ignores blur() and synthetic key events. The picker is in
   * the same stack as popover="auto" elements, so showing an empty popover
   * closes it, as a tap outside would.
   * (Setting `appearance: auto` for a moment also closes it, but when the mouse
   * is over the picker the select's computed appearance then stays `auto`.)
   */
  close() {
    const { select } = this;
    if (!this.open) return;
    const closer = document.createElement('div');
    closer.popover = 'auto';
    closer.style.cssText = 'position:fixed;inset:auto;width:0;height:0;border:0;padding:0;margin:0;overflow:hidden';
    // Inside an open popover or dialog, a popover that is its descendant closes only what is above it.
    (select.closest(':popover-open, dialog[open]') ?? document.body).append(closer);
    closer.showPopover();
    closer.remove();
    select.focus({ preventScroll: true });
  }
  // #endregion choose

  #touch() {
    this.#dirty = true;
    if (this.#running) return;
    try { this.canvas?.requestPaint(); } catch {}
  }

  // #region loop
  // The canvas gets a `paint` event when the picker opens (its options are
  // painted for the first time) and whenever an option's rendering changes
  // (hover, :checked, focus ring). The select fires no event when its picker
  // opens, so the first paint is also the "opened" signal. While the picker
  // is open a requestAnimationFrame loop runs the motion and asks for a paint.
  #paint() {
    if (!this.open) return;
    if (!this.#running) this.#opened();
    this.#draw();
  }

  #opened() {
    const { select, s } = this;
    this.#running = true;
    this.#openAt = performance.now();
    this.#last = this.#openAt;
    s.open = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0;
    s.active = this.options.findIndex((option) => option.selected);
    this.#mine = s.active >= 0; // false when the value is an option outside this canvas
    s.active = Math.max(0, s.active);
    s.pos = this.#target = s.active;
    s.pointer = false;
    s.sizes = [];
    this.#resize();
    const style = getComputedStyle(this.canvas);
    s.ink = style.color;
    s.accent = style.getPropertyValue('--picker-accent').trim() || style.accentColor.replace('auto', '') || '#0a66d0';
    requestAnimationFrame(this.#tick);
  }

  #tick = (now) => {
    if (!this.open || !this.canvas) { this.#running = false; this.#down = null; return; }
    const { s } = this;
    const dt = Math.min(0.05, (now - this.#last) / 1000);
    this.#last = now;
    let moving = this.#dirty;
    this.#dirty = false;
    if (s.open < 1) {
      const t = clamp((now - this.#openAt) / 280, 0, 1);
      s.open = 1 - (1 - t) ** 3;
      moving = true;
    }
    if (!this.#down?.moved || !this.layout.axis) {
      const gap = this.#target - s.pos;
      if (Math.abs(gap) > 0.002) { s.pos += gap * (1 - Math.exp(-dt * 13)); moving = true; }
      else if (s.pos !== this.#target) { s.pos = this.#target; moving = true; }
      // Wheel and carousel: the option that comes to rest in the middle becomes the value.
      else if (this.layout.live && this.#mine && !this.#down && this.options[this.#target]?.selected === false) this.choose(this.#target);
    }
    if (moving) this.canvas.requestPaint();
    requestAnimationFrame(this.#tick);
  };
  // #endregion loop

  // #region draw
  #draw() {
    const { canvas, select, s, layout } = this;
    const options = this.options;
    const dpr = devicePixelRatio || 1;
    const W = Math.round(s.w * dpr), H = Math.round(s.h * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; this.#unit = null; }
    s.n = options.length;
    if (s.sizes.length !== s.n) s.sizes = options.map((o) => ({ w: o.offsetWidth, h: o.offsetHeight }));
    layout.prepare?.(s);
    const shown = [];
    for (const [i, option] of options.entries()) {
      const p = layout.place(i, s);
      if (p && p.alpha > 0.01) shown.push({ option, size: s.sizes[i], ...p });
      // An option that is not drawn keeps its last hit box, so move it away.
      else canvas.updateElementGeometry(option, { canvasTransform: FAR });
    }
    shown.sort((a, b) => a.order - b.order);
    try {
      if (this.#renderer) {
        this.#renderer.draw(s, shown, dpr);
        // WebGL and WebGPU only upload pixels. Tell the browser where each
        // option ended up, perspective included, so it can hit test it there.
        const unit = this.#geometryUnit(shown[0]);
        for (const { option, m } of shown) canvas.updateElementGeometry(option, { canvasTransform: new DOMMatrix().scale(unit).multiply(m) });
      } else {
        draw2D(canvas, s, shown, layout, dpr);
      }
      this.frames++;
    } catch (err) {
      if (!/paint record/.test(err.message) && this.note !== err.message) { this.note = err.message; console.warn('select-picker:', err); }
    }
  }
  // #endregion draw

  // updateElementGeometry()'s canvasTransform has worked in CSS pixels on some
  // canvases and in buffer pixels on others. Measure it once: apply the
  // identity and compare the option's reported width with its layout width.
  #geometryUnit(first) {
    if (this.#unit || !first) return this.#unit ?? 1;
    this.canvas.updateElementGeometry(first.option, { canvasTransform: new DOMMatrix() });
    const measured = first.option.getBoundingClientRect().width;
    this.#unit = measured > 0 && first.size.w > 0 ? first.size.w / measured : 1;
    return this.#unit;
  }
}

// #region draw2d
// The 2D route: one drawElementImage() per option under a transform. The call
// also sets the option's hit box to the same transform.
function draw2D(canvas, s, shown, layout, dpr) {
  const ctx = canvas.getContext('2d');
  ctx.reset();
  ctx.scale(dpr, dpr);
  if (layout.under) { ctx.save(); layout.under(ctx, s); ctx.restore(); }
  for (const { option, size, m, alpha = 1, shade = 1 } of shown) {
    ctx.save();
    ctx.globalAlpha = alpha;
    if (shade < 1) ctx.filter = `brightness(${shade})`;
    // A 2D canvas has no perspective. For a 3D layout this keeps the affine
    // part of the matrix, so a turned card is drawn narrower but not tapered.
    const k = m.is2D ? 1 : 1 / m.m44;
    ctx.transform(m.a * k, m.b * k, m.c * k, m.d * k, m.e * k, m.f * k);
    ctx.drawElementImage(option, 0, 0, size.w, size.h);
    ctx.restore();
  }
  if (layout.over) { ctx.save(); layout.over(ctx, s); ctx.restore(); }
}
// #endregion draw2d

// #region webgl
// The WebGL route: each option is a texture on a quad. The vertex shader
// applies the layout's 4×4 matrix, perspective included; the fragment shader
// darkens cards that are turned away and draws a fading mirror image below.
const VERT = `#version 300 es
uniform mat4 uM; uniform vec4 uDims; uniform vec4 uFx;
out vec2 vUV; out float vFade;
void main() {
  vec2 a = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  float y = a.y, v = a.y; vFade = 1.0;
  if (uFx.z > 0.5) { y = 1.0 + a.y * 0.6; v = 1.0 - a.y * 0.6; vFade = 0.3 * (1.0 - a.y); }
  vec4 p = uM * vec4(a.x * uDims.x, y * uDims.y, 0.0, 1.0);
  gl_Position = vec4(2.0 * p.x / uDims.z - p.w, p.w - 2.0 * p.y / uDims.w, 0.0, p.w);
  vUV = vec2(a.x, v);
}`;
const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec4 uFx;
in vec2 vUV; in float vFade; out vec4 color;
void main() {
  vec4 c = texture(uTex, vUV);                        // premultiplied
  color = vec4(c.rgb * uFx.y, c.a) * (uFx.x * vFade); // uFx: alpha, shade, mirror
}`;

class GLRenderer {
  #textures = new WeakMap();
  constructor(canvas) {
    this.canvas = canvas;
    const gl = (this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true }));
    if (!gl) throw new Error('no WebGL 2 context');
    const shader = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || 'shader failed to compile');
      return sh;
    };
    const prog = (this.prog = gl.createProgram());
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'program failed to link');
    this.u = { m: gl.getUniformLocation(prog, 'uM'), dims: gl.getUniformLocation(prog, 'uDims'), fx: gl.getUniformLocation(prog, 'uFx') };
    this.vao = gl.createVertexArray();
  }
  #texture(option) {
    const { gl } = this;
    let t = this.#textures.get(option);
    if (!t) {
      t = { tex: gl.createTexture(), w: 0, h: 0 };
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.#textures.set(option, t);
    }
    // texElementSubImage2D needs storage of exactly the option's picture size.
    const size = this.canvas.getElementImageDefaultSize(option);
    const w = Math.max(1, Math.ceil(size.width)), h = Math.max(1, Math.ceil(size.height));
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    if (w !== t.w || h !== t.h) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); t.w = w; t.h = h; }
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, option);
    return t.tex;
  }
  draw(s, shown) {
    const { gl, canvas, u } = this;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    for (const { option, size, m, alpha = 1, shade = 1, reflect } of shown) {
      gl.bindTexture(gl.TEXTURE_2D, this.#texture(option));
      gl.uniformMatrix4fv(u.m, false, m.toFloat32Array());
      gl.uniform4f(u.dims, size.w, size.h, s.w, s.h);
      if (reflect) { gl.uniform4f(u.fx, alpha, shade, 1, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
      gl.uniform4f(u.fx, alpha, shade, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
  destroy() {}
}
// #endregion webgl

// #region webgpu
// The WebGPU route: the same quads, with drawElementImageToTexture() for the upload.
const WGSL = `
struct U { m: mat4x4f, dims: vec4f, fx: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
struct V { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) fade: f32 };
@vertex fn vs(@builtin(vertex_index) i: u32) -> V {
  let a = vec2f(f32(i & 1u), f32(i >> 1u));
  var y = a.y; var v = a.y; var fade = 1.0;
  if (u.fx.z > 0.5) { y = 1.0 + a.y * 0.6; v = 1.0 - a.y * 0.6; fade = 0.3 * (1.0 - a.y); }
  let p = u.m * vec4f(a.x * u.dims.x, y * u.dims.y, 0.0, 1.0);
  var o: V;
  o.pos = vec4f(2.0 * p.x / u.dims.z - p.w, p.w - 2.0 * p.y / u.dims.w, 0.0, p.w);
  o.uv = vec2f(a.x, v);
  o.fade = fade;
  return o;
}
@fragment fn fs(i: V) -> @location(0) vec4f {
  let c = textureSample(tex, samp, i.uv);
  return vec4f(c.rgb * u.fx.y, c.a) * (u.fx.x * i.fade);
}`;

class GPURenderer {
  #slots = new WeakMap();
  constructor(canvas, gpu, util, onProblem, { present = true } = {}) {
    this.canvas = canvas;
    this.util = util;
    this.onProblem = onProblem;
    this.surface = new util.GPUCanvas(canvas, gpu, { present });
    const device = (this.device = gpu.device);
    const module = device.createShaderModule({ code: WGSL });
    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: gpu.format, blend: util.BLEND_OVER }] },
      primitive: { topology: 'triangle-strip' },
    });
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    addEventListener('webgpulost', () => onProblem('the WebGPU device was lost'), { once: true });
  }
  #slot(option) {
    let slot = this.#slots.get(option);
    if (!slot) {
      const buffer = () => this.device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      slot = { tex: new this.util.GPUElementTexture(this.device, this.canvas, option), main: buffer(), mirror: buffer(), view: null, groups: null };
      this.#slots.set(option, slot);
    }
    slot.tex.update();
    if (slot.view !== slot.tex.view) {
      slot.view = slot.tex.view;
      const group = (buffer) => this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: this.sampler }, { binding: 2, resource: slot.view }],
      });
      slot.groups = [group(slot.main), group(slot.mirror)];
    }
    return slot;
  }
  draw(s, shown) {
    const { device } = this;
    if (this.surface.lost) return;
    this.util.watchFrame(device, () => {
      const data = new Float32Array(24);
      const list = [];
      for (const { option, size, m, alpha = 1, shade = 1, reflect } of shown) {
        const slot = this.#slot(option);
        data.set(m.toFloat32Array(), 0);
        data.set([size.w, size.h, s.w, s.h], 16);
        data.set([alpha, shade, 0, 0], 20);
        device.queue.writeBuffer(slot.main, 0, data);
        if (reflect) { data[22] = 1; device.queue.writeBuffer(slot.mirror, 0, data); list.push(slot.groups[1]); }
        list.push(slot.groups[0]);
      }
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.surface.view(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
      pass.setPipeline(this.pipeline);
      for (const group of list) { pass.setBindGroup(0, group); pass.draw(4); }
      pass.end();
      device.queue.submit([encoder.finish()]);
    }, (problem) => this.onProblem(`WebGPU rejected the frame (${problem})`));
    if (shown.length) this.surface.shown((why) => this.onProblem(why));
  }
  destroy() {
    this.surface.destroy();
  }
}
// #endregion webgpu

// #region roll
/**
 * Animate the chosen value in the select's button. The button holds
 *
 *   <button><canvas content="drawable"><selectedcontent drawable></selectedcontent></canvas></button>
 *
 * <selectedcontent> is still filled in by the browser. The canvas draws it,
 * and when it changes the old picture rolls out and the new one rolls in.
 */
export function rollSelected(select, { ms = 280 } = {}) {
  const canvas = select.querySelector(':scope > button canvas');
  const content = canvas?.querySelector('selectedcontent');
  if (!supported || !content) return null;
  canvas.setAttribute('content', 'drawable');
  canvas.setAttribute('layoutsubtree', '');
  content.setAttribute('drawable', '');
  const ctx = canvas.getContext('2d');
  const old = new OffscreenCanvas(1, 1), oldCtx = old.getContext('2d');
  let shown = null, index = select.selectedIndex, from = 0, dir = 1;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  new ResizeObserver(([entry]) => {
    const box = entry.devicePixelContentBoxSize[0];
    if (canvas.width !== box.inlineSize || canvas.height !== box.blockSize) { canvas.width = box.inlineSize; canvas.height = box.blockSize; }
    canvas.requestPaint();
  }).observe(canvas, { box: 'device-pixel-content-box' });

  canvas.addEventListener('paint', () => {
    const now = performance.now(), dpr = canvas.width / Math.max(1, canvas.clientWidth), h = canvas.clientHeight;
    const text = content.innerHTML;
    if (shown !== null && text !== shown && !reduced && canvas.width > 1) {
      // The value changed. Keep the picture of the old value, which is still on the canvas.
      old.width = canvas.width;
      old.height = canvas.height;
      oldCtx.drawImage(canvas, 0, 0);
      from = now;
      dir = select.selectedIndex >= index ? 1 : -1;
    }
    shown = text;
    index = select.selectedIndex;
    const t = from ? Math.min(1, (now - from) / ms) : 1, e = 1 - (1 - t) ** 3;
    ctx.reset();
    if (t < 1) {
      ctx.globalAlpha = 1 - e;
      ctx.drawImage(old, 0, -dir * e * canvas.height);
      ctx.globalAlpha = e;
    } else from = 0;
    ctx.scale(dpr, dpr);
    try { ctx.drawElementImage(content, 0, (h - content.offsetHeight) / 2 + dir * (1 - e) * h, content.offsetWidth, content.offsetHeight); } catch {}
    if (t < 1) requestAnimationFrame(() => canvas.requestPaint());
  });
  canvas.requestPaint();
  return canvas;
}
// #endregion roll

/** For tests: the renderers, so a page can draw one frame to a texture and read it back. */
export const renderers = { GLRenderer, GPURenderer };

/** Upgrade every <select picker> under root. Returns the pickers. */
export function upgrade(root = document) {
  return [...root.querySelectorAll('select[picker]')].map((select) => new SelectPicker(select));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgrade());
  else upgrade();
}
