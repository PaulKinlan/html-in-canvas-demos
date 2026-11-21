// xr-room.js: the parts an HTML panel needs to sit in a real room.
//
// Built on html3d.js (element textures and ray pointers). Three pieces, each usable alone:
//
//   FingerPointer     a tracked fingertip presses a panel like a touch screen
//   nearestPlane() / snapToPlane() / readPlanes() / PanelAnchor
//                     put a panel on a detected wall or table and keep it there
//   ElementQuadLayer  hand a panel to the headset's compositor as an XRQuadLayer
//
// None of this could be run on a headset where it was written. The page that uses it
// (/xr-room/) runs every piece against a simulated room and reports what a device does.

import { Matrix4, MeshBasicMaterial, NoBlending, Quaternion, Raycaster, Vector3 } from 'three';

const _n = new Vector3(), _p = new Vector3(), _q = new Quaternion(), _s = new Vector3(), _m = new Matrix4();

// #region finger
/**
 * A fingertip as a pointer. Call update(tip) every frame with the tip's world position.
 * The tip hovers when it is within `hover` metres in front of a panel, presses when it comes
 * within `press`, and lets go when it is pulled back past `release`. While pressed, sliding
 * the finger drags a slider, or scrolls a list when the press began on plain content.
 */
export class FingerPointer {
  constructor(surfaces, id, { press = 0.008, release = 0.025, hover = 0.2, through = 0.06 } = {}) {
    this.surfaces = surfaces;
    this.pointer = surfaces.createRayPointer(id);
    this.press = press;
    this.release = release;
    this.hover = hover;
    this.through = through;
    this.raycaster = new Raycaster();
    this.down = null; // the surface being pressed
    this.near = null; // { surface, distance, point } for the panel the tip is in front of
    this.presses = 0;
    this.scrolling = false;
    this._startY = 0;
    this._lastY = 0;
  }

  update(tip) {
    let best = null;
    for (const surface of this.surfaces.surfaces) {
      const mesh = surface.mesh;
      if (surface.hit === 'none') continue;
      mesh.updateWorldMatrix(true, false);
      _n.set(0, 0, 1).transformDirection(mesh.matrixWorld);
      const d = _p.copy(tip).sub(_s.setFromMatrixPosition(mesh.matrixWorld)).dot(_n);
      if (d > this.hover || d < -this.through) continue;
      // Straight down the panel's normal from the tip. Starting a little in front keeps the
      // ray valid while the finger is pushed slightly through the surface.
      this.raycaster.set(_p.copy(tip).addScaledVector(_n, Math.max(0, -d) + 0.02), _n.clone().negate());
      this.raycaster.far = this.hover + this.through + 0.05;
      const hit = this.surfaces.intersect(this.raycaster);
      if (!hit || hit.surface !== surface) continue;
      if (!best || Math.abs(d) < Math.abs(best.distance)) best = { surface, distance: d, point: hit.point.clone(), origin: this.raycaster.ray.origin.clone(), dir: this.raycaster.ray.direction.clone() };
    }
    this.near = best;
    if (!best) {
      if (this.down) this.#lift(true);
      this.pointer.leave?.();
      return null;
    }
    this.raycaster.set(best.origin, best.dir);
    this.pointer.move(this.raycaster);
    const y = this.pointer.hit?.y ?? this._lastY; // in the element's own CSS pixels
    if (!this.down && best.distance <= this.press) {
      this.down = best.surface;
      this.presses++;
      this.scrolling = false;
      this._startY = this._lastY = y;
      this.pointer.down();
    } else if (this.down && (best.distance > this.release || best.surface !== this.down)) {
      this.#lift(false);
    } else if (this.down) {
      // A press that began on something that is not a control scrolls, like a touch screen.
      const pressed = this.pointer.pressed;
      const control = pressed?.closest?.('button, input, select, textarea, a[href], summary, label, [contenteditable]');
      if (!control && !this.pointer.drag && (this.scrolling || Math.abs(y - this._startY) > 8)) {
        this.scrolling = true;
        this.pointer.scroll(0, this._lastY - y);
      }
      this._lastY = y;
    }
    return best;
  }

  #lift(cancel) {
    this.down = null;
    if (cancel || this.scrolling) this.pointer.pressed = null; // no click after a scroll or a slide off the panel
    this.pointer.up();
    this.scrolling = false;
  }
}
// #endregion finger

// #region planes
/**
 * A plane, real or simulated: { orientation: 'vertical' | 'horizontal', matrix, polygon }.
 * `matrix` takes plane space to world space; plane space has y along the normal and the
 * polygon in x and z, as WebXR's XRPlane does.
 */
export function readPlanes(frame, referenceSpace) {
  const planes = [];
  for (const plane of frame.detectedPlanes ?? []) {
    const pose = frame.getPose(plane.planeSpace, referenceSpace);
    if (!pose) continue;
    planes.push({
      orientation: plane.orientation ?? 'horizontal',
      matrix: new Matrix4().fromArray(pose.transform.matrix),
      polygon: Array.from(plane.polygon, (p) => ({ x: p.x, z: p.z })),
      source: plane,
    });
  }
  return planes;
}

function bounds(polygon) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of polygon) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
  }
  return { x0, x1, z0, z1 };
}

/** The plane of one orientation closest to a world position, or null. */
export function nearestPlane(planes, position, orientation) {
  let best = null;
  for (const plane of planes) {
    if (plane.orientation !== orientation) continue;
    const local = position.clone().applyMatrix4(_m.copy(plane.matrix).invert());
    const b = bounds(plane.polygon);
    const dx = Math.max(b.x0 - local.x, 0, local.x - b.x1), dz = Math.max(b.z0 - local.z, 0, local.z - b.z1);
    const distance = Math.hypot(dx, local.y, dz);
    if (!best || distance < best.distance) best = { plane, distance };
  }
  return best;
}

/**
 * Move a panel onto a plane. On a wall it hangs upright, facing the viewer's side. On a
 * table it lies flat with its top edge away from the viewer. `size` is the panel's width
 * and height in metres, used to keep it inside the plane's polygon.
 */
export function snapToPlane(object, plane, { size = [0, 0], gap = 0.012, viewer = new Vector3(0, 1.6, 0) } = {}) {
  const inverse = new Matrix4().copy(plane.matrix).invert();
  const local = object.getWorldPosition(new Vector3()).applyMatrix4(inverse);
  const eye = viewer.clone().applyMatrix4(inverse);
  const side = eye.y >= 0 ? 1 : -1; // which face of the plane the viewer is on
  const normal = new Vector3(0, side, 0).transformDirection(plane.matrix);
  const b = bounds(plane.polygon);
  const fit = (v, lo, hi, half) => (hi - lo <= half * 2 ? (lo + hi) / 2 : Math.min(hi - half, Math.max(lo + half, v)));
  let up;
  if (plane.orientation === 'vertical') {
    up = new Vector3(0, 1, 0);
  } else {
    up = new Vector3().subVectors(object.getWorldPosition(new Vector3()), viewer).projectOnPlane(normal);
    if (up.lengthSq() < 1e-6) up.set(0, 0, -1).projectOnPlane(normal);
    up.normalize();
    // Square the panel up with the plane's own axes when it is within 30 degrees of one.
    for (const axis of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]) {
      axis.transformDirection(plane.matrix);
      if (axis.dot(up) > Math.cos(Math.PI / 6)) up.copy(axis);
    }
  }
  const right = new Vector3().crossVectors(up, normal).normalize();
  // How much room the panel needs along the plane's own x and z axes.
  const ax = new Vector3(1, 0, 0).transformDirection(plane.matrix), az = new Vector3(0, 0, 1).transformDirection(plane.matrix);
  const halfX = (Math.abs(right.dot(ax)) * size[0] + Math.abs(up.dot(ax)) * size[1]) / 2;
  const halfZ = (Math.abs(right.dot(az)) * size[0] + Math.abs(up.dot(az)) * size[1]) / 2;
  local.set(fit(local.x, b.x0, b.x1, halfX), side * gap, fit(local.z, b.z0, b.z1, halfZ));
  const position = local.applyMatrix4(plane.matrix);
  const rotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, normal));
  setWorldPose(object, position, rotation);
  return { position, rotation, normal };
}

export function setWorldPose(object, position, rotation) {
  const parent = object.parent;
  if (parent) {
    parent.updateWorldMatrix(true, false);
    _m.copy(parent.matrixWorld).invert();
    object.position.copy(position).applyMatrix4(_m);
    parent.getWorldQuaternion(_q).invert();
    object.quaternion.copy(_q).multiply(rotation);
  } else {
    object.position.copy(position);
    object.quaternion.copy(rotation);
  }
  object.updateMatrixWorld(true);
}

/**
 * Keep a panel where it was put as the headset refines its map of the room. An XRAnchor is
 * created at the panel's pose; update() moves the panel to wherever the anchor is now.
 */
export class PanelAnchor {
  static async create(frame, referenceSpace, object) {
    if (!frame.createAnchor) throw new Error('this session has no anchors');
    object.updateWorldMatrix(true, false);
    object.matrixWorld.decompose(_p, _q, _s);
    const pose = new XRRigidTransform({ x: _p.x, y: _p.y, z: _p.z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    return new PanelAnchor(await frame.createAnchor(pose, referenceSpace), object);
  }

  constructor(anchor, object) {
    this.anchor = anchor;
    this.object = object;
    this.updates = 0;
  }

  update(frame, referenceSpace) {
    const pose = frame.getPose(this.anchor.anchorSpace, referenceSpace);
    if (!pose) return false;
    const { position: p, orientation: o } = pose.transform;
    setWorldPose(this.object, _p.set(p.x, p.y, p.z), _q.set(o.x, o.y, o.z, o.w));
    this.updates++;
    return true;
  }

  delete() {
    try { this.anchor.delete(); } catch { /* already gone */ }
  }
}
// #endregion planes

// #region layer
/**
 * Show one html3d surface as an XRQuadLayer. The compositor draws a quad layer at the
 * display's own resolution, so small text is sharper than the same texture drawn into the
 * eye buffers. The layer goes under the scene; the panel's mesh is swapped for a material
 * that writes transparent black, which leaves a hole for the layer to show through and keeps
 * rays, cursors and other objects drawing over it as before.
 *
 * Two ways to fill the layer are tried. 'direct' uploads the element into the layer's own
 * texture with texElementSubImage2D(). If the browser refuses, 'blit' copies the texture
 * html3d already made. `mode` and `directError` say which happened.
 */
export class ElementQuadLayer {
  constructor(renderer, session, surface, mesh, { width, height }) {
    const gl = renderer.getContext();
    if (!session.renderState.layers) throw new Error('this session was not granted the layers feature');
    let binding = renderer.xr.getBinding?.();
    if (!binding?.createQuadLayer) binding = new XRWebGLBinding(session, gl);
    if (!binding.createQuadLayer) throw new Error('XRWebGLBinding has no createQuadLayer here');
    this.renderer = renderer;
    this.session = session;
    this.surface = surface;
    this.mesh = mesh;
    this.binding = binding;
    this.layer = binding.createQuadLayer({
      space: renderer.xr.getReferenceSpace(),
      viewPixelWidth: surface.width, viewPixelHeight: surface.height,
      width: width / 2, height: height / 2, // XRQuadLayer sizes are half extents
      layout: 'mono', colorFormat: gl.SRGB8_ALPHA8,
    });
    session.updateRenderState({ layers: [this.layer, ...session.renderState.layers] });
    this.material = mesh.material;
    mesh.material = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: NoBlending });
    this.read = gl.createFramebuffer();
    this.draw = gl.createFramebuffer();
    this.mode = 'direct';
    this.directError = null;
    this.copies = 0;
    this._uploads = -1;
  }

  /** Call every XR frame, before rendering. */
  update(frame) {
    const { surface, layer, renderer } = this;
    this.mesh.updateWorldMatrix(true, false);
    this.mesh.matrixWorld.decompose(_p, _q, _s);
    layer.transform = new XRRigidTransform({ x: _p.x, y: _p.y, z: _p.z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    if (!surface.glTexture || (!layer.needsRedraw && this._uploads === surface.uploads)) return;
    const gl = renderer.getContext();
    const sub = this.binding.getSubImage(layer, frame);
    while (gl.getError()) { /* start clean */ }
    if (this.mode === 'direct') {
      try {
        gl.bindTexture(gl.TEXTURE_2D, sub.colorTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, surface.element);
        const err = gl.getError();
        if (err) throw new Error(`WebGL error 0x${err.toString(16)}`);
      } catch (err) {
        this.mode = 'blit';
        this.directError = err.message;
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    }
    let failed = null;
    if (this.mode === 'blit') {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.read);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, surface.glTexture, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.draw);
      gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sub.colorTexture, 0);
      gl.disable(gl.SCISSOR_TEST);
      gl.blitFramebuffer(0, 0, surface.width, surface.height, 0, 0, sub.textureWidth ?? surface.width, sub.textureHeight ?? surface.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
      const err = gl.getError();
      if (err) failed = `WebGL error 0x${err.toString(16)} copying into the layer`;
    }
    renderer.resetState();
    renderer.setRenderTarget(renderer.getRenderTarget());
    if (failed) throw new Error(failed);
    this._uploads = surface.uploads;
    this.copies++;
  }

  dispose() {
    const gl = this.renderer.getContext();
    this.mesh.material.dispose();
    this.mesh.material = this.material;
    gl.deleteFramebuffer(this.read);
    gl.deleteFramebuffer(this.draw);
    try {
      this.session.updateRenderState({ layers: this.session.renderState.layers.filter((l) => l !== this.layer) });
    } catch { /* session already ended */ }
  }
}
// #endregion layer
