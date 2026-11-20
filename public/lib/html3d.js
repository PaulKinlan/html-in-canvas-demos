// html3d.js: live, interactive HTML on three.js meshes, using HTML-in-canvas.
//
//   import * as THREE from 'three';
//   import { HTMLSurfaces } from '/lib/html3d.js';
//
//   const renderer = new THREE.WebGLRenderer({ canvas });      // or WebGPURenderer
//   const surfaces = new HTMLSurfaces(renderer, camera, { scene });
//   const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), new THREE.MeshBasicMaterial());
//   surfaces.add(document.querySelector('#form'), screen);      // sets screen.material.map
//   renderer.setAnimationLoop(() => { surfaces.update(); renderer.render(scene, camera); });
//
// What it does:
//   * Texture. The element becomes a child of the renderer's canvas and is uploaded on every
//     `paint` event that reports it changed. WebGL: our own mipmapped sRGB texture through
//     texElementSubImage2D (or texElementImage2D on builds that have that name). WebGPU: three's
//     stock HTMLTexture, with a shim for builds that call the queue method
//     drawElementImageToTexture instead of copyElementImageToTexture.
//   * Hit testing. Every frame the element's geometry is set with canvas.updateElementGeometry()
//     so the browser's own hit test lands on the real element where the mesh is drawn:
//       hit: 'planar'  one projective matrix for a flat face. Exact everywhere on the face.
//       hit: 'mesh'    any UV-mapped mesh (curved walls, spheres). The element's geometry follows
//                      the pointer: we raycast, find the triangle and UV under it, and place the
//                      element so that exact spot is under the pointer. Exact at the pointer,
//                      which is the only place a mouse hit test looks.
//     If something else in the scene is in front of a surface at the pointer, its geometry is
//     parked off-canvas so you cannot click through walls.
//   * Rays. createRayPointer() drives the same elements from an XR controller or any
//     THREE.Raycaster by synthesising pointer, mouse, click and focus events.
//
// `three` is a bare import: map it to your three.module.js or three.webgpu.js build.

import { ExternalTexture, HTMLTexture, Matrix4, Raycaster, SRGBColorSpace, Vector2, Vector3 } from 'three';

const C = typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype : {};
const GL = typeof WebGL2RenderingContext !== 'undefined' ? WebGL2RenderingContext.prototype : {};
const Q = typeof GPUQueue !== 'undefined' ? GPUQueue.prototype : {};

/** What this browser offers. Names differ between Chrome builds, so we look rather than assume. */
export const support = {
  paint: 'requestPaint' in C,
  geometry: 'updateElementGeometry' in C,
  webgl: 'texElementSubImage2D' in GL ? 'texElementSubImage2D' : 'texElementImage2D' in GL ? 'texElementImage2D' : null,
  webgpu: 'drawElementImageToTexture' in Q ? 'drawElementImageToTexture' : 'copyElementImageToTexture' in Q ? 'copyElementImageToTexture' : null,
};

/**
 * Make three's stock HTMLTexture work on builds where the browser methods have newer names.
 * three r187 looks for gl.texElementImage2D and queue.copyElementImageToTexture.
 * three asks for an RGBA8 texture whatever the texture's colour space, which shows DOM colours
 * washed out in the default sRGB pipeline, so by default the shim stores sRGB instead.
 * Returns the list of shims that were installed.
 */
export function installThreeShims({ srgb = true } = {}) {
  const done = [];
  if (!('texElementImage2D' in GL) && 'texElementSubImage2D' in GL) {
    // Declared with three parameters: three picks its call shape from Function.length.
    GL.texElementImage2D = function (target, internalformat, element) {
      let size;
      try {
        size = this.canvas.getElementImageDefaultSize(element);
      } catch {
        this.canvas.requestPaint(); // no paint record yet: try again after the next paint
        return;
      }
      this.texImage2D(target, 0, srgb ? this.SRGB8_ALPHA8 : internalformat, size.width, size.height, 0, this.RGBA, this.UNSIGNED_BYTE, null);
      this.texElementSubImage2D(target, 0, 0, 0, element);
    };
    done.push('WebGL2RenderingContext.texElementImage2D');
  }
  if (!('copyElementImageToTexture' in Q) && 'drawElementImageToTexture' in Q) {
    Q.copyElementImageToTexture = function (source, destination) {
      return this.drawElementImageToTexture({ source: source.source }, destination.destination ?? destination);
    };
    done.push('GPUQueue.copyElementImageToTexture');
  }
  return done;
}

const OFFSTAGE = typeof DOMMatrix !== 'undefined' ? new DOMMatrix().translate(-100000, -100000) : null;
const _v = new Vector3(), _a = new Vector3(), _b = new Vector3(), _c = new Vector3();
const _m = new Matrix4(), _m2 = new Matrix4();
const _ndc = new Vector2();

export class HTMLSurfaces {
  /**
   * @param renderer THREE.WebGLRenderer or WebGPURenderer whose canvas will hold the elements.
   * @param camera   The camera used for 2D (non-XR) hit testing.
   * @param options.scene  Raycast against the whole scene so other meshes occlude surfaces.
   */
  constructor(renderer, camera, { scene = null } = {}) {
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;
    this.canvas = renderer.domElement;
    this.surfaces = [];
    this.raycaster = new Raycaster();
    this.backend = renderer.isWebGLRenderer ? 'webgl' : 'webgpu';
    /** When true, elements are laid out flat in the canvas box instead of following their mesh. */
    this.flat = false;
    this.stats = { paints: 0, uploads: 0, lastError: null, geometryUpdates: 0 };
    this.pointer = null; // { x, y } in client coordinates, or null when no mouse is over the canvas
    this.buttons = 0;

    const canvas = this.canvas;
    if (!canvas.hasAttribute('content')) canvas.setAttribute('content', 'drawable');
    if (!canvas.hasAttribute('layoutsubtree')) canvas.setAttribute('layoutsubtree', '');
    // Scroll anchoring treats a focused text field as its anchor. Moving that field's geometry
    // (an orbiting camera, a tracked curved surface) would then scroll the page to compensate.
    canvas.style.overflowAnchor = 'none';
    if (this.backend === 'webgpu') installThreeShims();

    this._onPaint = (event) => this.#paint(event);
    this._onMove = (event) => {
      // Also runs on pointerdown: a touch has no move before it lands, so geometry is placed
      // then, and the tap's click is hit tested against the new placement.
      this.pointer = { x: event.clientX, y: event.clientY, type: event.pointerType };
      this.buttons = event.buttons;
      this.#syncGeometry();
    };
    this._onUp = (event) => (this.buttons = event.buttons);
    // A finger that lifts leaves the placement where it was, so the next tap nearby is right.
    this._onLeave = (event) => {
      if (event.pointerType !== 'touch') this.pointer = null;
    };
    canvas.addEventListener('paint', this._onPaint);
    canvas.addEventListener('pointermove', this._onMove, true);
    canvas.addEventListener('pointerdown', this._onMove, true);
    canvas.addEventListener('pointerleave', this._onLeave);
    window.addEventListener('pointerup', this._onUp, true);
  }

  /**
   * Show `element` on `mesh` and keep it interactive there.
   * @param options.hit      'planar' (default), 'mesh' or 'none'.
   * @param options.mipmaps  WebGL only. Default true: readable at a distance.
   * @param options.doubleSided  Keep hit testing when seen from behind. Default false.
   */
  add(element, mesh, { hit = 'planar', mipmaps = true, doubleSided = false } = {}) {
    element.setAttribute('drawable', '');
    if (!this.canvas.contains(element)) this.canvas.append(element);
    const cs = getComputedStyle(element);
    if (cs.position === 'static') element.style.position = 'absolute';
    if (!element.style.left) element.style.left = '0';
    if (!element.style.top) element.style.top = '0';

    const surface = {
      element, mesh, hit, mipmaps, doubleSided,
      texture: null, glTexture: null, width: 0, height: 0,
      triangles: null, last: null, tracked: false, uploads: 0, slot: null,
    };
    if (this.backend === 'webgl') {
      surface.texture = new ExternalTexture(null);
      surface.texture.colorSpace = SRGBColorSpace;
    } else {
      surface.texture = new HTMLTexture(element);
      surface.texture.colorSpace = SRGBColorSpace;
    }
    mesh.material.map = surface.texture;
    mesh.material.needsUpdate = true;
    this.surfaces.push(surface);
    this.canvas.requestPaint?.();
    return surface;
  }

  remove(surface) {
    const i = this.surfaces.indexOf(surface);
    if (i < 0) return;
    this.surfaces.splice(i, 1);
    if (surface.glTexture) this.renderer.getContext().deleteTexture(surface.glTexture);
    surface.texture.dispose();
    this.#place(surface, null);
  }

  dispose() {
    for (const s of [...this.surfaces]) this.remove(s);
    this.canvas.removeEventListener('paint', this._onPaint);
    this.canvas.removeEventListener('pointermove', this._onMove, true);
    this.canvas.removeEventListener('pointerdown', this._onMove, true);
    this.canvas.removeEventListener('pointerleave', this._onLeave);
    window.removeEventListener('pointerup', this._onUp, true);
  }

  /** Call once per frame, before or after render. Keeps hit testing lined up with the meshes. */
  update() {
    this.#syncGeometry();
  }

  /** Ask for every surface to be re-uploaded on the next paint. */
  invalidate() {
    for (const s of this.surfaces) s.dirty = true;
    this.canvas.requestPaint?.();
  }

  // ---------------------------------------------------------------- textures

  #paint(event) {
    this.stats.paints++;
    const changed = event.changedElements ? new Set(event.changedElements) : null;
    if (this.backend === 'webgpu') {
      // three's HTMLTexture uploads during render; it only needs to be told.
      for (const s of this.surfaces) {
        if (!changed || changed.has(s.element) || s.dirty) {
          s.texture.needsUpdate = true;
          s.dirty = false;
          s.uploads++;
          this.stats.uploads++;
        }
      }
      return;
    }
    const gl = this.renderer.getContext();
    let touched = false;
    for (const s of this.surfaces) {
      if (changed && !changed.has(s.element) && s.glTexture && !s.dirty) continue;
      try {
        this.#upload(gl, s);
        s.dirty = false;
        touched = true;
      } catch (err) {
        this.stats.lastError = `${err.name}: ${err.message}`;
      }
    }
    if (touched) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      this.renderer.resetState();
    }
  }

  #upload(gl, s) {
    const size = this.canvas.getElementImageDefaultSize
      ? this.canvas.getElementImageDefaultSize(s.element)
      : { width: s.element.offsetWidth * devicePixelRatio, height: s.element.offsetHeight * devicePixelRatio };
    const w = Math.max(1, Math.round(size.width)), h = Math.max(1, Math.round(size.height));
    const immutable = support.webgl === 'texElementSubImage2D';
    if (!s.glTexture || s.width !== w || s.height !== h) {
      if (s.glTexture) gl.deleteTexture(s.glTexture);
      s.glTexture = gl.createTexture();
      s.width = w;
      s.height = h;
      gl.bindTexture(gl.TEXTURE_2D, s.glTexture);
      if (immutable) {
        const levels = s.mipmaps ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
        gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, w, h);
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, s.mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
      const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
      if (aniso && s.mipmaps) {
        gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      }
      s.texture.sourceTexture = s.glTexture;
      s.last = null; // element size changed: recompute geometry
    }
    gl.bindTexture(gl.TEXTURE_2D, s.glTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    if (immutable) gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, s.element);
    else if (gl.texElementImage2D.length === 3) gl.texElementImage2D(gl.TEXTURE_2D, gl.SRGB8_ALPHA8, s.element);
    else gl.texElementImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, s.element);
    if (s.mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    const err = gl.getError();
    if (err) throw new Error(`WebGL error 0x${err.toString(16)} uploading <${s.element.localName}>`);
    s.uploads++;
    this.stats.uploads++;
  }

  // ------------------------------------------------------------- hit testing

  #place(s, matrix) {
    if (!support.geometry) return;
    const m = matrix ?? OFFSTAGE;
    const key = m.toFloat32Array();
    if (s.last && key.every((v, i) => Math.abs(v - s.last[i]) < 1e-4)) return;
    s.last = key;
    this.canvas.updateElementGeometry(s.element, { canvasTransform: m });
    this.stats.geometryUpdates++;
  }

  #syncGeometry() {
    if (!this.surfaces.length) return;
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (this.flat) return this.#flatLayout(rect);

    const camera = this.camera;
    camera.updateMatrixWorld();
    // What is in front at the pointer?
    let top = null, hit = null, under = null;
    if (this.pointer && rect.width && rect.height) {
      _ndc.set(((this.pointer.x - rect.left) / rect.width) * 2 - 1, -((this.pointer.y - rect.top) / rect.height) * 2 + 1);
      if (Math.abs(_ndc.x) <= 1 && Math.abs(_ndc.y) <= 1) {
        this.raycaster.setFromCamera(_ndc, camera);
        const targets = this.scene ? [this.scene] : this.surfaces.map((s) => s.mesh);
        const hits = this.raycaster.intersectObjects(targets, true).filter((h) => isShown(h.object) && !h.object.userData.noOcclude);
        under = new Set(hits.map((h) => h.object));
        hit = hits[0] ?? null;
        top = hit ? this.surfaces.find((s) => s.mesh === hit.object) ?? null : null;
      }
    }
    for (const s of this.surfaces) {
      if (s.hit === 'none' || !isShown(s.mesh)) { this.#place(s, null); continue; }
      const occluded = under?.has(s.mesh) && top !== s;
      if (occluded) { this.#place(s, null); s.tracked = false; continue; }
      if (s.hit === 'mesh' && top === s) {
        const m = this.#trackedMatrix(s, hit, rect);
        if (m) { this.#place(s, m); s.tracked = true; continue; }
      }
      // A drag that started on a tracked surface keeps its last geometry until the button is up.
      if (s.hit === 'mesh' && s.tracked && this.buttons) continue;
      s.tracked = false;
      this.#place(s, this.#planarMatrix(s, rect));
    }
  }

  /** Element px -> canvas CSS px for the flat face spanned by the mesh's UV corners. */
  #planarMatrix(s, rect) {
    const w = s.element.offsetWidth, h = s.element.offsetHeight;
    if (!w || !h) return null;
    const frame = this.#frame(s);
    if (!frame) return null;
    const { o, x, y, n } = frame;
    // element px (ex, ey, 0, 1) -> mesh local
    _m.set(
      x.x / w, y.x / h, n.x, o.x,
      x.y / w, y.y / h, n.y, o.y,
      x.z / w, y.z / h, n.z, o.z,
      0, 0, 0, 1,
    );
    s.mesh.updateWorldMatrix(true, false);
    _m2.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse).multiply(s.mesh.matrixWorld).multiply(_m);
    // Reject faces that cross the camera plane or face away.
    const e = _m2.elements;
    const corner = (ex, ey) => {
      const cw = e[3] * ex + e[7] * ey + e[15];
      return [(e[0] * ex + e[4] * ey + e[12]) / cw, (e[1] * ex + e[5] * ey + e[13]) / cw, cw];
    };
    const p = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)];
    if (p.some((q) => q[2] <= 1e-6)) return null;
    const area = (p[1][0] - p[0][0]) * (p[3][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[3][0] - p[0][0]);
    if (area >= 0 && !s.doubleSided) return null; // NDC y is up, so a front face has negative area here
    if (p.every((q) => q[0] < -1) || p.every((q) => q[0] > 1) || p.every((q) => q[1] < -1) || p.every((q) => q[1] > 1)) return null;
    // NDC -> canvas CSS px, y down.
    _m.set(
      rect.width / 2, 0, 0, rect.width / 2,
      0, -rect.height / 2, 0, rect.height / 2,
      0, 0, 1, 0,
      0, 0, 0, 1,
    );
    _m2.premultiply(_m);
    return new DOMMatrix(Array.from(_m2.elements));
  }

  /** Element px -> canvas CSS px, exact at the raycast hit, for any UV-mapped mesh. */
  #trackedMatrix(s, hit, rect) {
    if (!hit.uv || !hit.face) return null;
    const w = s.element.offsetWidth, h = s.element.offsetHeight;
    const geo = s.mesh.geometry, pos = geo.attributes.position, uv = geo.attributes.uv;
    if (!uv || !w || !h) return null;
    const { a, b, c } = hit.face;
    // The triangle in element px and in mesh-local space.
    const e0x = uv.getX(a) * w, e0y = (1 - uv.getY(a)) * h;
    const e1x = uv.getX(b) * w - e0x, e1y = (1 - uv.getY(b)) * h - e0y;
    const e2x = uv.getX(c) * w - e0x, e2y = (1 - uv.getY(c)) * h - e0y;
    const det = e1x * e2y - e2x * e1y;
    if (Math.abs(det) < 1e-9) return null;
    _a.fromBufferAttribute(pos, a);
    _b.fromBufferAttribute(pos, b).sub(_a);
    _c.fromBufferAttribute(pos, c).sub(_a);
    // d(local)/d(ex) and d(local)/d(ey) on this triangle.
    const dx = _b.clone().multiplyScalar(e2y / det).addScaledVector(_c, -e1y / det);
    const dy = _c.clone().multiplyScalar(e1x / det).addScaledVector(_b, -e2x / det);
    const hx = hit.uv.x * w, hy = (1 - hit.uv.y) * h;
    const local = s.mesh.worldToLocal(hit.point.clone());
    const project = (v) => {
      _v.copy(v).applyMatrix4(s.mesh.matrixWorld).project(this.camera);
      return [(_v.x * 0.5 + 0.5) * rect.width, (1 - (_v.y * 0.5 + 0.5)) * rect.height];
    };
    // Local Jacobian of the projection at the hit point, by a one-pixel step each way.
    const p0 = project(local);
    const px = project(local.clone().add(dx));
    const py = project(local.clone().add(dy));
    const A = px[0] - p0[0], B = px[1] - p0[1], Cc = py[0] - p0[0], D = py[1] - p0[1];
    if (A * D - B * Cc <= 0 && !s.doubleSided) return null; // back face
    return new DOMMatrix([A, B, Cc, D, p0[0] - A * hx - Cc * hy, p0[1] - B * hx - D * hy]);
  }

  /** Mesh-local origin and edge vectors of the element's rectangle, from the UV corners. */
  #frame(s) {
    if (s.frame !== undefined) return s.frame;
    const geo = s.mesh.geometry, pos = geo.attributes.position, uv = geo.attributes.uv;
    let frame = null;
    if (uv) {
      const tris = [];
      const count = geo.index ? geo.index.count : pos.count;
      const at = (i) => (geo.index ? geo.index.getX(i) : i);
      for (let i = 0; i < count; i += 3) tris.push([at(i), at(i + 1), at(i + 2)]);
      const find = (u, v) => {
        let best = null, bestErr = Infinity;
        for (const [a, b, c] of tris) {
          const ax = uv.getX(a), ay = uv.getY(a), bx = uv.getX(b) - ax, by = uv.getY(b) - ay, cx = uv.getX(c) - ax, cy = uv.getY(c) - ay;
          const d = bx * cy - cx * by;
          if (Math.abs(d) < 1e-12) continue;
          const l1 = ((u - ax) * cy - cx * (v - ay)) / d, l2 = (bx * (v - ay) - (u - ax) * by) / d, l0 = 1 - l1 - l2;
          const err = Math.max(0, -l0) + Math.max(0, -l1) + Math.max(0, -l2);
          if (err < bestErr) {
            bestErr = err;
            best = new Vector3().fromBufferAttribute(pos, a).multiplyScalar(l0)
              .addScaledVector(_v.fromBufferAttribute(pos, b), l1)
              .addScaledVector(_v.fromBufferAttribute(pos, c), l2);
          }
          if (err === 0) break;
        }
        return bestErr < 1e-3 ? best : null;
      };
      const o = find(0, 1), right = find(1, 1), down = find(0, 0);
      if (o && right && down) {
        const x = right.sub(o), y = down.sub(o);
        frame = { o, x, y, n: new Vector3().crossVectors(x, y).normalize().negate() };
      }
    }
    if (!frame) {
      if (!geo.boundingBox) geo.computeBoundingBox();
      const { min, max } = geo.boundingBox;
      frame = { o: new Vector3(min.x, max.y, max.z), x: new Vector3(max.x - min.x, 0, 0), y: new Vector3(0, min.y - max.y, 0), n: new Vector3(0, 0, 1) };
    }
    return (s.frame = frame);
  }

  /** XR and other ray-driven modes: park each element in its own cell of the canvas box. */
  #flatLayout(rect) {
    const n = this.surfaces.length;
    const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const cw = rect.width / cols, ch = rect.height / rows;
    this.surfaces.forEach((s, i) => {
      const w = s.element.offsetWidth || 1, h = s.element.offsetHeight || 1;
      const k = Math.min(cw / w, ch / h, 1);
      const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
      s.slot = { x, y, k };
      this.#place(s, new DOMMatrix([k, 0, 0, k, x, y]));
    });
  }

  // -------------------------------------------------------------------- rays

  /**
   * Where does a ray meet a surface? Returns { surface, x, y, point, distance } with x, y in the
   * element's own CSS pixels, or null. Other scene meshes occlude.
   */
  intersect(raycaster) {
    const targets = this.scene ? [this.scene] : this.surfaces.map((s) => s.mesh);
    const hit = raycaster.intersectObjects(targets, true).find((h) => isShown(h.object) && !h.object.userData.noOcclude);
    if (!hit) return null;
    const surface = this.surfaces.find((s) => s.mesh === hit.object);
    if (!surface) return { surface: null, point: hit.point, distance: hit.distance };
    if (!hit.uv) return null;
    return {
      surface,
      x: hit.uv.x * surface.element.offsetWidth,
      y: (1 - hit.uv.y) * surface.element.offsetHeight,
      point: hit.point,
      distance: hit.distance,
    };
  }

  /** The element under element-local (x, y) of a surface, and the client point used to find it. */
  elementAt(surface, x, y) {
    const rect = this.canvas.getBoundingClientRect();
    let cx, cy;
    if (this.flat && surface.slot) {
      cx = rect.left + surface.slot.x + x * surface.slot.k;
      cy = rect.top + surface.slot.y + y * surface.slot.k;
    } else {
      const er = surface.element.getBoundingClientRect();
      cx = er.left + (x / (surface.element.offsetWidth || 1)) * er.width;
      cy = er.top + (y / (surface.element.offsetHeight || 1)) * er.height;
    }
    let target = document.elementFromPoint(cx, cy);
    let via = 'elementFromPoint';
    if (!target || !surface.element.contains(target)) {
      // The page may not be hit-testable (hidden behind an immersive session): search by rects.
      via = 'rects';
      target = surface.element;
      const walk = (node) => {
        for (const child of node.children) {
          const r = child.getBoundingClientRect();
          if (cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom && getComputedStyle(child).pointerEvents !== 'none') {
            target = child;
            walk(child);
          }
        }
      };
      walk(surface.element);
    }
    return { target, clientX: cx, clientY: cy, via };
  }

  /** A pointer driven by rays (XR controllers, hands, gaze) instead of the mouse. */
  createRayPointer(id = 1) {
    return new RayPointer(this, id);
  }
}

function isShown(object) {
  for (let o = object; o; o = o.parent) if (!o.visible) return false;
  return true;
}

const FOCUSABLE = 'input, textarea, select, button, a[href], summary, [tabindex], [contenteditable=""], [contenteditable="true"]';

/**
 * Synthetic input for places the browser's own hit test cannot reach, such as an immersive
 * WebXR session. Events are untrusted, so the parts a real click gets for free (focus, caret
 * placement, range dragging, opening a select) are done by hand here.
 */
export class RayPointer {
  constructor(surfaces, id) {
    this.surfaces = surfaces;
    this.id = 1000 + id;
    this.hit = null;
    this.over = null;
    this.pressed = null;
    this.drag = null;
    this.where = null;
  }

  /** Point the ray. Returns the hit (or null) so the caller can draw a cursor. */
  move(raycaster) {
    const hit = this.surfaces.intersect(raycaster);
    this.hit = hit && hit.surface ? hit : null;
    const where = this.hit ? this.surfaces.elementAt(this.hit.surface, this.hit.x, this.hit.y) : null;
    this.where = where;
    const target = where?.target ?? null;
    if (target !== this.over) {
      if (this.over) {
        this.#fire(this.over, 'pointerout', where);
        this.over.closest('[data-ray-hover]')?.removeAttribute('data-ray-hover');
      }
      this.over = target;
      if (target) {
        this.#fire(target, 'pointerover', where);
        (target.closest(FOCUSABLE) ?? target).setAttribute('data-ray-hover', '');
      }
    }
    if (target) this.#fire(target, 'pointermove', where);
    if (this.drag && where) this.#dragRange(where);
    return hit;
  }

  down() {
    const where = this.where;
    if (!where) {
      if (document.activeElement && this.surfaces.canvas.contains(document.activeElement)) document.activeElement.blur();
      return null;
    }
    const target = where.target;
    this.pressed = target;
    this.#fire(target, 'pointerdown', where);
    const proceed = this.#fire(target, 'mousedown', where);
    if (proceed) {
      const focusable = target.closest(FOCUSABLE);
      if (focusable) focusable.focus({ preventScroll: true });
      else if (document.activeElement && this.surfaces.canvas.contains(document.activeElement)) document.activeElement.blur();
      if (target.matches('input[type=range]')) {
        this.drag = target;
        this.#dragRange(where);
      } else if (target.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea')) {
        const pos = document.caretPositionFromPoint?.(where.clientX, where.clientY);
        try {
          if (pos) target.setSelectionRange(pos.offset, pos.offset);
        } catch { /* input types without a text selection */ }
      }
    }
    return target;
  }

  up() {
    const where = this.where;
    const target = where?.target ?? this.pressed;
    if (target) {
      this.#fire(target, 'pointerup', where);
      this.#fire(target, 'mouseup', where);
    }
    const wasDrag = this.drag;
    this.drag = null;
    const pressed = this.pressed;
    this.pressed = null;
    if (!pressed || wasDrag || !where) return null;
    // Click when press and release share an interactive ancestor, as the browser would.
    const clickTarget = pressed === where.target ? pressed : commonAncestor(pressed, where.target);
    if (!clickTarget || !this.surfaces.canvas.contains(clickTarget) || clickTarget === this.surfaces.canvas) return null;
    const select = clickTarget.closest('select');
    if (select) {
      // A synthetic click cannot open the native popup: step to the next option instead.
      select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select;
    }
    this.#fire(clickTarget, 'click', where);
    return clickTarget;
  }

  /** Scroll whatever scrollable box is under the ray. */
  scroll(dx, dy) {
    for (let el = this.over; el && el !== this.surfaces.canvas; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)) {
        el.scrollBy(dx, dy);
        return el;
      }
    }
    return null;
  }

  #dragRange(where) {
    const input = this.drag;
    const r = input.getBoundingClientRect();
    const min = Number(input.min || 0), max = Number(input.max || 100), step = Number(input.step || 1);
    const t = Math.min(1, Math.max(0, (where.clientX - r.left) / (r.width || 1)));
    const value = String(Math.round((min + t * (max - min)) / step) * step);
    if (value !== input.value) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  #fire(target, type, where) {
    const init = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: where?.clientX ?? 0, clientY: where?.clientY ?? 0,
      button: 0, buttons: type.endsWith('down') || (this.pressed && type.endsWith('move')) ? 1 : 0,
      pointerId: this.id, pointerType: 'mouse', isPrimary: true,
    };
    const event = type.startsWith('pointer') ? new PointerEvent(type, init) : new MouseEvent(type, init);
    return target.dispatchEvent(event);
  }
}

function commonAncestor(a, b) {
  if (!a || !b) return null;
  for (let n = a; n; n = n.parentElement) if (n.contains(b)) return n;
  return null;
}
