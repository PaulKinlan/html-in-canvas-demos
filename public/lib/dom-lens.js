// <dom-lens>: a magnifier, fisheye or x-ray loupe over live DOM.
//
//   <script type="module" src="/lib/dom-lens.js"></script>
//   <dom-lens mode="magnify" zoom="2.5" radius="120">
//     <article>…any markup, forms included…</article>
//   </dom-lens>
//
// Attributes
//   mode     magnify | fisheye | xray              (default magnify)
//   zoom     magnification at the lens centre      (default 2)
//   radius   lens radius in CSS px                 (default 110)
//   pinned   keep the lens at x / y instead of following the pointer
//   x, y     lens centre in CSS px from the element's top-left (with pinned)
//   off      draw the content with no lens
//   touch    "scroll" lets a touch drag scroll the page; by default a drag
//            moves the lens, which is drawn above the finger
//   bleed    extra canvas margin so the lens can hang over the edge
//
// The content is drawn with drawElementImage(), which replays the element's
// paint record. Scaling it re-rasterizes text and vectors, so the magnified
// view is sharp rather than an upscaled bitmap. The lens follows keyboard focus
// as well as the pointer.

import { SurfaceElement, cssZoom } from './surface.js';

const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[tabindex],[contenteditable]';

export class DomLens extends SurfaceElement {
  static contextType = '2d';
  static observedAttributes = ['mode', 'zoom', 'radius', 'pinned', 'x', 'y', 'off', 'rings'];

  #client = null; // last pointer position, client coords
  #pointer = null; // lens centre from the pointer, content px
  #focus = null; // lens centre from keyboard focus
  #boxes = null; // cached element boxes for x-ray
  #backdrop = '#fff';
  #msPerDraw = 0.2;
  #settled = false;
  #settleTimer = 0;
  #touch = false;
  #onMove = (e) => {
    this.#touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    this.#client = { x: e.clientX, y: e.clientY };
    this.#focus = null;
    this.#track();
  };
  // A finger has no hover: the lens appears on touch and goes when it lifts.
  #onUp = (e) => {
    if (e.pointerType === 'mouse') return;
    this.#client = null;
    this.#track();
  };
  #onScroll = () => this.#track();
  #onLeave = () => {
    this.#client = null;
    this.#track();
  };

  /** Number of drawElementImage calls in the last frame (for the demo's stats). */
  drawCalls = 0;

  attributeChangedCallback() {
    this.invalidate();
  }

  connected() {
    addEventListener('pointermove', this.#onMove, { passive: true });
    addEventListener('pointerdown', this.#onMove, { passive: true });
    addEventListener('pointerup', this.#onUp, { passive: true });
    addEventListener('pointercancel', this.#onUp, { passive: true });
    if (!this.shadowRoot.adoptedStyleSheets.includes(touchSheet())) this.shadowRoot.adoptedStyleSheets.push(touchSheet());
    addEventListener('scroll', this.#onScroll, { passive: true, capture: true });
    document.documentElement.addEventListener('pointerleave', this.#onLeave);
    this.addEventListener('focusin', this.#onFocus);
    this.addEventListener('focusout', this.#onBlur);
    this.#backdrop = findBackdrop(this);
  }

  disconnected() {
    removeEventListener('pointermove', this.#onMove);
    removeEventListener('pointerdown', this.#onMove);
    removeEventListener('pointerup', this.#onUp);
    removeEventListener('pointercancel', this.#onUp);
    removeEventListener('scroll', this.#onScroll, { capture: true });
    document.documentElement.removeEventListener('pointerleave', this.#onLeave);
    this.removeEventListener('focusin', this.#onFocus);
    this.removeEventListener('focusout', this.#onBlur);
  }

  resized() {
    this.#boxes = null;
    this.#backdrop = findBackdrop(this);
  }

  #onFocus = (e) => {
    // Keyboard users get the lens too: centre it on whatever took focus.
    let visible = false;
    try {
      visible = e.target.matches(':focus-visible');
    } catch {}
    if (!visible || this.hasAttribute('pinned')) return;
    const host = this.getBoundingClientRect();
    const r = e.target.getBoundingClientRect();
    const z = cssZoom(this);
    this.#focus = { x: (r.left + r.width / 2 - host.left) / z, y: (r.top + r.height / 2 - host.top) / z };
    this.invalidate();
  };

  #onBlur = () => {
    this.#focus = null;
    this.invalidate();
  };

  /** Drive the lens from script: client coordinates, or null to release it. */
  pointTo(clientX, clientY) {
    this.#client = clientX == null ? null : { x: clientX, y: clientY };
    this.#focus = null;
    this.#track();
  }

  #track() {
    const before = this.#pointer;
    if (!this.#client) this.#pointer = null;
    else {
      const r = this.getBoundingClientRect();
      const z = cssZoom(this);
      const x = (this.#client.x - r.left) / z;
      const y = (this.#client.y - r.top) / z;
      const m = this.bleed;
      this.#pointer = x >= -m && y >= -m && x <= r.width / z + m && y <= r.height / z + m ? { x, y } : null;
    }
    if (before || this.#pointer) this.invalidate();
  }

  get zoom() {
    return Math.max(1, Number(this.getAttribute('zoom')) || 2);
  }
  get radius() {
    return Math.max(8, Number(this.getAttribute('radius')) || 110);
  }
  get mode() {
    return this.getAttribute('mode') || 'magnify';
  }

  /** Current lens centre in content px, or null when there is no lens. */
  get lens() {
    if (this.hasAttribute('off')) return null;
    if (this.hasAttribute('pinned')) {
      return { x: Number(this.getAttribute('x')) || 0, y: Number(this.getAttribute('y')) || 0, pinned: true };
    }
    if (this.#focus) return this.#focus;
    const p = this.#pointer;
    if (!p || !this.#touch) return p;
    // Under a finger the lens would be hidden, so show it above the finger
    // (below, near the top edge), still magnifying the point being touched.
    const lift = this.radius + 28;
    const y = p.y - lift < -this.bleed + this.radius * 0.4 ? p.y + lift : p.y - lift;
    return { x: p.x, y, fx: p.x, fy: p.y };
  }

  /** Magnification at distance d from the lens centre. */
  magnification(d) {
    const z = this.zoom;
    if (this.mode !== 'fisheye') return z;
    const t = Math.min(1, d / this.radius);
    return 1 / (1 / z + (1 - 1 / z) * t * t);
  }

  // #region render
  render() {
    const { ctx, content, scale: s, width: w, height: h, bleed: b } = this;
    const lens = this.lens;
    const t0 = performance.now();
    const R = this.radius;
    const mode = this.mode;
    let calls = 0;
    const draw = () => {
      ctx.drawElementImage(content, b, b, w, h);
      calls++;
    };

    // Element boxes have to be read before the magnified draw: every
    // drawElementImage() call moves the element's geometry to where it drew.
    const boxes = lens && mode === 'xray' ? this.#measure() : null;

    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width / s, this.canvas.height / s);
    draw();

    if (lens) {
      // (cx, cy) is where the lens is drawn; (fx, fy) is the point it looks at.
      const cx = lens.x + b;
      const cy = lens.y + b;
      const fx = (lens.fx ?? lens.x) + b;
      const fy = (lens.fy ?? lens.y) + b;
      const about = (m) => {
        ctx.translate(cx, cy);
        ctx.scale(m, m);
        ctx.translate(-fx, -fy);
      };
      const clipCircle = (r) => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.clip();
      };

      ctx.save();
      clipCircle(R);
      ctx.fillStyle = mode === 'xray' ? '#081a2e' : this.#backdrop;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

      if (mode === 'fisheye') {
        // A fisheye is not an affine transform, and drawElementImage() only
        // takes one. So warp it the way software renderers texture-map: cut
        // the lens into a polar mesh of triangles and draw the element once
        // per triangle, clipped to it, with the affine transform that maps
        // the triangle's source corners onto its screen corners. Neighbours
        // share edges, so the image is continuous, and every triangle is
        // re-rasterized, so text stays sharp all the way out.
        // That is a lot of draw calls, so the mesh is coarse while the lens
        // moves (sized to a frame budget from the measured cost per call) and
        // refined once it rests.
        const full = Math.max(2, Math.min(24, Number(this.getAttribute('rings')) || Math.round(R / 14)));
        let rings = full;
        if (!this.hasAttribute('rings')) {
          // Triangles = sectors * (2 * rings - 1) with sectors = 3 * rings.
          const budget = Math.max(18, (this.#settled ? 120 : 14) / this.#msPerDraw);
          rings = Math.max(2, Math.min(full, Math.floor((3 + Math.sqrt(9 + 24 * budget)) / 12)));
        }
        if (rings < full && !this.#settled) {
          clearTimeout(this.#settleTimer);
          this.#settleTimer = setTimeout(() => {
            this.#settled = true;
            this.invalidate();
          }, 140);
        }
        this.#settled = false;
        const sectors = Math.max(8, Math.min(64, Math.round(rings * 3)));
        const z = this.zoom;
        const src = (r) => r / z + (1 - 1 / z) * (r * r * r) / (R * R); // screen radius -> source radius
        const pt = (i, j) => {
          const r = (R * i) / rings;
          const a = (j / sectors) * Math.PI * 2;
          const cs = Math.cos(a), sn = Math.sin(a), q = src(r);
          return [cx + cs * r, cy + sn * r, fx + cs * q, fy + sn * q];
        };
        for (let i = rings - 1; i >= 0; i--) {
          for (let j = 0; j < sectors; j++) {
            const p00 = pt(i, j), p01 = pt(i, j + 1), p10 = pt(i + 1, j), p11 = pt(i + 1, j + 1);
            if (i === 0) triangle(ctx, p00, p10, p11, draw);
            else {
              triangle(ctx, p00, p10, p11, draw);
              triangle(ctx, p00, p11, p01, draw);
            }
          }
        }
      } else if (mode === 'xray') {
        ctx.save();
        about(this.zoom);
        ctx.globalAlpha = 0.45;
        ctx.filter = 'grayscale(1) invert(1) sepia(1) hue-rotate(170deg)';
        draw();
        ctx.filter = 'none';
        ctx.globalAlpha = 1;
        this.#drawBoxes(ctx, boxes, fx, fy, R, b);
        ctx.restore();
      } else {
        ctx.save();
        about(this.zoom);
        draw();
        ctx.restore();
      }
      ctx.restore();

      // Rim and a little glass.
      const glare = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      glare.addColorStop(0, 'rgba(255,255,255,0.16)');
      glare.addColorStop(0.5, 'rgba(255,255,255,0)');
      glare.addColorStop(0.85, 'rgba(0,0,0,0)');
      glare.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = glare;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = mode === 'xray' ? '#5fd0ff' : 'rgba(20,20,20,0.85)';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(cx, cy, R - 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Hit testing. A lens that follows the pointer needs nothing special: the
    // pointer is the fixed point of the magnification, so what you see under
    // it is what is there. A pinned lens is different: when the pointer is
    // inside it, point the element's geometry at the magnified drawing so
    // clicks land on what is shown.
    let geometry = this.restMatrix;
    this.hitTesting = 'rest';
    if (lens?.pinned && this.#pointer) {
      const d = Math.hypot(this.#pointer.x - lens.x, this.#pointer.y - lens.y);
      if (d < R) {
        const m = this.magnification(d);
        geometry = new DOMMatrix().translate(lens.x + b, lens.y + b).scale(m).translate(-lens.x - b, -lens.y - b).multiply(geometry);
        this.hitTesting = 'lens';
      }
    }
    this.setGeometry(geometry);
    this.contentDirty = false;
    this.drawCalls = calls;
    this.frameMs = performance.now() - t0;
    if (calls > 8) this.#msPerDraw = this.#msPerDraw * 0.7 + (this.frameMs / calls) * 0.3;
    return false;
  }
  // #endregion render

  /** Element boxes in content px. Read while geometry is at rest. */
  #measure() {
    if (this.#boxes && !this.contentDirty) return this.#boxes;
    if (this.hitTesting === 'lens' && this.#boxes) return this.#boxes; // rects are magnified right now
    const host = this.getBoundingClientRect();
    const z = cssZoom(this);
    const boxes = [];
    const walk = (el, depth) => {
      if (boxes.length >= 1500) return;
      for (const child of el.children) {
        const r = child.getBoundingClientRect();
        if (r.width && r.height) {
          boxes.push({
            x: (r.left - host.left) / z, y: (r.top - host.top) / z, w: r.width / z, h: r.height / z, depth,
            label: child.localName + (child.id ? '#' + child.id : ''),
            interactive: child.matches(INTERACTIVE),
          });
        }
        walk(child, depth + 1);
      }
    };
    walk(this, 0);
    this.#boxes = boxes;
    return boxes;
  }

  /** How many element boxes the x-ray drew last frame. */
  boxesDrawn = 0;

  #drawBoxes(ctx, boxes, cx, cy, R, b) {
    const z = this.zoom;
    const reach = R / z;
    const lx = cx - b;
    const ly = cy - b;
    let n = 0;
    ctx.font = `${9 / z + 4 / z}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = 'top';
    for (const box of boxes) {
      if (box.x > lx + reach || box.x + box.w < lx - reach || box.y > ly + reach || box.y + box.h < ly - reach) continue;
      n++;
      const hue = box.interactive ? 35 : 190 + box.depth * 28;
      ctx.lineWidth = (box.interactive ? 2 : 1) / z;
      ctx.strokeStyle = `hsl(${hue} 95% ${box.interactive ? 60 : 68}%)`;
      ctx.fillStyle = `hsl(${hue} 95% 60% / ${box.interactive ? 0.22 : 0.05})`;
      ctx.fillRect(box.x + b, box.y + b, box.w, box.h);
      ctx.strokeRect(box.x + b, box.y + b, box.w, box.h);
      ctx.fillStyle = `hsl(${hue} 95% 78%)`;
      ctx.fillText(box.label, box.x + b + 2 / z, box.y + b + 2 / z);
    }
    this.boxesDrawn = n;
  }
}

/**
 * Draw through one triangle of a warp mesh. Each corner is [dx, dy, sx, sy]:
 * where it is on screen and which point of the source it shows.
 */
// #region triangle
function triangle(ctx, a, b, c, draw) {
  const [x0, y0, u0, v0] = a, [x1, y1, u1, v1] = b, [x2, y2, u2, v2] = c;
  const det = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
  if (Math.abs(det) < 1e-9) return;
  const m11 = ((x1 - x0) * (v2 - v0) - (x2 - x0) * (v1 - v0)) / det;
  const m12 = ((x2 - x0) * (u1 - u0) - (x1 - x0) * (u2 - u0)) / det;
  const m21 = ((y1 - y0) * (v2 - v0) - (y2 - y0) * (v1 - v0)) / det;
  const m22 = ((y2 - y0) * (u1 - u0) - (y1 - y0) * (u2 - u0)) / det;
  // Grow the clip by half a pixel so antialiased edges do not leave seams.
  const gx = (x0 + x1 + x2) / 3, gy = (y0 + y1 + y2) / 3;
  const grow = (x, y) => {
    const dx = x - gx, dy = y - gy, d = Math.hypot(dx, dy) || 1;
    return [x + (dx / d) * 0.7, y + (dy / d) * 0.7];
  };
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(...grow(x0, y0));
  ctx.lineTo(...grow(x1, y1));
  ctx.lineTo(...grow(x2, y2));
  ctx.closePath();
  ctx.clip();
  ctx.transform(m11, m21, m12, m22, x0 - m11 * u0 - m12 * v0, y0 - m21 * u0 - m22 * v0);
  draw();
  ctx.restore();
}
// #endregion triangle

let sheet;
function touchSheet() {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    // A drag over the lens moves the lens instead of scrolling the page.
    // touch="scroll" (or the off attribute) gives scrolling back.
    sheet.replaceSync(':host { touch-action: none; } :host([off]), :host([pinned]), :host([touch="scroll"]) { touch-action: auto; }');
  }
  return sheet;
}

function findBackdrop(el) {
  for (let n = el; n instanceof Element; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (c && c !== 'transparent' && !/rgba?\(.*,\s*0\)$/.test(c) && !/\/\s*0\)$/.test(c)) return c;
  }
  return getComputedStyle(document.documentElement).colorScheme.includes('dark') && matchMedia('(prefers-color-scheme: dark)').matches ? '#161514' : '#ffffff';
}

if (!customElements.get('dom-lens')) customElements.define('dom-lens', DomLens);
