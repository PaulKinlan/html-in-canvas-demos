import * as THREE from 'three';
import { HTMLSurfaces, support } from '/lib/html3d.js';
import { ElementQuadLayer, FingerPointer, PanelAnchor, nearestPlane, readPlanes, snapToPlane } from '/lib/xr-room.js';
import { banner, runTests, supported } from '/shared/support.js';
import { sampleGL, watchContext } from '/lib/check-fixture.js';

banner();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ emulator
// ?emulate=1 swaps navigator.xr for Meta's Immersive Web Emulation Runtime, so the session
// code (input sources, hand joints, anchors) runs on a laptop or a phone.
let device = null;
const stereo = innerWidth > innerHeight;
if (params.has('emulate')) {
  try {
    const { XRDevice, metaQuest3 } = await import('/vendor/iwer/iwer.module.min.js');
    device = new XRDevice(metaQuest3, { stereoEnabled: stereo });
    device.installRuntime({ forceInstall: true, polyfillLayers: params.has('layers') });
    device.position.set(0, 1.6, 0);
    const link = $('emu-link');
    link.textContent = 'Back to real WebXR';
    link.href = location.pathname;
  } catch (err) {
    $('xr-status').textContent = `Emulator failed to load: ${err.message}`;
  }
}

const canvas = $('scene');
const hud = $('hud');
const stage = $('stage');
const live = supported && !!support.webgl;

// --------------------------------------------------------------- the panels
// Plain DOM. This part runs with or without the canvas API.
const C = { lamp: $('c-lamp'), less: $('c-less'), more: $('c-more'), count: $('c-count'), bright: $('c-bright'), out: $('c-bright-out'), src: $('c-src') };
const logList = $('s-log');
const state = { lamp: false, count: 3, bright: 6 };
let via = ''; // which input is dispatching events right now; empty for the keyboard
let actions = { place: () => {}, float: () => {} };
function log(text) {
  const from = via || 'keyboard';
  const li = document.createElement('li');
  const small = document.createElement('small');
  small.textContent = ` ${from}`;
  li.append(text, small);
  logList.prepend(li);
  while (logList.children.length > 40) logList.lastElementChild.remove();
  logList.scrollTop = 0;
  C.src.textContent = `${text}, ${from}`;
}
function show() {
  C.lamp.setAttribute('aria-pressed', state.lamp);
  C.count.textContent = state.count;
  C.out.textContent = state.bright;
}
C.lamp.addEventListener('click', () => { state.lamp = !state.lamp; show(); log(`Lamp ${state.lamp ? 'on' : 'off'}`); });
C.less.addEventListener('click', () => { state.count = Math.max(1, state.count - 1); show(); log(`${state.count} lamps`); });
C.more.addEventListener('click', () => { state.count = Math.min(6, state.count + 1); show(); log(`${state.count} lamps`); });
C.bright.addEventListener('input', () => { state.bright = Number(C.bright.value); show(); });
C.bright.addEventListener('change', () => log(`Brightness ${state.bright}`));
for (const id of ['place', 'c-place']) $(id).addEventListener('click', () => { log('Put panels on surfaces'); actions.place(); });
for (const id of ['float', 'c-float']) $(id).addEventListener('click', () => { log('Float in front of me'); actions.float(); });

// ----------------------------------------------------------- session buttons
const xrStatus = $('xr-status');
const modes = {};
async function probe(mode, button) {
  let ok = false, why = 'navigator.xr is missing';
  if (navigator.xr) {
    try {
      ok = await navigator.xr.isSessionSupported(mode);
      why = ok ? '' : 'not supported on this device';
    } catch (err) {
      why = err.message;
    }
  }
  modes[mode] = { ok, why };
  button.disabled = !ok || !live;
  button.title = ok ? '' : `${mode}: ${why}`;
  if (ok && live) button.classList.add('go');
}
await Promise.all([probe('immersive-vr', $('enter-vr')), probe('immersive-ar', $('enter-ar'))]);
if (device) {
  $('enter-vr').textContent = 'Enter emulated VR';
  $('enter-ar').textContent = 'Enter emulated AR';
}
xrStatus.textContent = device
  ? 'Emulated Quest 3. The pointer moves the right hand.'
  : modes['immersive-vr'].ok || modes['immersive-ar'].ok
    ? ''
    : 'No headset or AR here. The simulated room below runs the same code.';

if (!live) {
  stage.hidden = true;
  $('hint').textContent = 'The panels are shown below as plain HTML. Their buttons work, but nothing is drawn in a scene.';
  for (const id of ['place', 'float']) $(id).disabled = true;
  await runTests($('results'), [
    { name: 'HTML-in-canvas for WebGL', why: 'Needs texElementSubImage2D (or the older texElementImage2D).', run: async () => { throw new Error('not available in this browser'); } },
  ]);
} else {
  await start();
}

async function start() {
  // ---------------------------------------------------------------- renderer
  // One WebGL context for the whole page, and no antialiasing on dense phone screens.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.xr.enabled = true;
  const SKY = new THREE.Color(0x0d0f14);
  const scene = new THREE.Scene();
  scene.background = SKY;
  const camera = new THREE.PerspectiveCamera(60, 16 / 10, 0.02, 60);
  camera.rotation.order = 'YXZ';
  const EYE = 1.5;
  const view = { yaw: 0, pitch: -0.12, z: 0.5, to: { yaw: 0, pitch: -0.12, z: 0.5 } };
  camera.position.set(0, EYE, view.z);

  // The simulated room hangs off `world`, so a session without a floor-level reference
  // space can shift it down to eye level.
  const world = new THREE.Group();
  scene.add(world);
  const room = new THREE.Group();
  world.add(room);
  const solid = (geometry, color) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color }));
    mesh.userData.noOcclude = true; // the room is "real": the page has no geometry for it, so rays pass through
    mesh.renderOrder = -1;
    room.add(mesh);
    return mesh;
  };
  const floor = solid(new THREE.PlaneGeometry(8, 8), 0x10131a);
  floor.rotation.x = -Math.PI / 2;
  floor.renderOrder = -3;
  const grid = new THREE.GridHelper(8, 16, 0x39415a, 0x232838);
  grid.position.y = 0.002;
  grid.userData.noOcclude = true;
  grid.renderOrder = -2;
  room.add(grid);
  const WALL_Z = -1.6, TABLE_Y = 0.74, COLUMN = 0x4a5670;
  const wall = solid(new THREE.PlaneGeometry(3.2, 2.6), 0x1b2030);
  wall.position.set(0, 1.3, WALL_Z);
  const table = solid(new THREE.BoxGeometry(1.3, 0.04, 0.7), 0x3a2f28);
  table.position.set(-0.1, TABLE_Y - 0.02, -0.75);
  for (const [x, z] of [[-0.7, -1.05], [0.5, -1.05], [-0.7, -0.45], [0.5, -0.45]]) {
    const leg = solid(new THREE.BoxGeometry(0.04, TABLE_Y - 0.04, 0.04), 0x2a221d);
    leg.position.set(x, (TABLE_Y - 0.04) / 2, z);
  }
  // Stands in for a real object between the viewer and the wall.
  const column = solid(new THREE.BoxGeometry(0.22, 2.1, 0.22), COLUMN);
  column.position.set(0.2, 1.05, -1.25);
  const lamps = Array.from({ length: 6 }, (_, i) => {
    const lamp = solid(new THREE.SphereGeometry(0.05, 16, 10), 0x333842);
    lamp.position.set(-1.2 + i * 0.2, 2.3, WALL_Z + 0.12);
    return lamp;
  });
  const OFF = new THREE.Color(0x333842), ON = new THREE.Color(0xffd66b);
  function showLamps() {
    lamps.forEach((lamp, i) => {
      lamp.visible = i < state.count;
      lamp.material.color.copy(OFF).lerp(ON, state.lamp ? 0.25 + 0.075 * state.bright : 0);
    });
  }

  // The two simulated planes, in the shape WebXR reports them: y along the normal, polygon in x and z.
  const simFrames = [
    { orientation: 'vertical', at: [0, 1.3, WALL_Z], rx: Math.PI / 2, half: [1.6, 1.3], name: 'wall' },
    { orientation: 'horizontal', at: [-0.1, TABLE_Y, -0.75], rx: 0, half: [0.65, 0.35], name: 'table' },
  ].map((f) => {
    const frame = new THREE.Object3D();
    frame.position.set(...f.at);
    frame.rotation.x = f.rx;
    room.add(frame);
    const [hx, hz] = f.half;
    return { ...f, frame, polygon: [{ x: -hx, z: -hz }, { x: hx, z: -hz }, { x: hx, z: hz }, { x: -hx, z: hz }] };
  });
  const simPlanes = () => simFrames.map((f) => {
    f.frame.updateWorldMatrix(true, false);
    return { orientation: f.orientation, matrix: f.frame.matrixWorld.clone(), polygon: f.polygon, source: `simulated ${f.name}` };
  });

  const surfaces = new HTMLSurfaces(renderer, camera, { scene });
  // Every input on this page is a position in space turned into events, never the browser's
  // own hit test. So the elements are always laid out flat in the canvas box.
  surfaces.flat = true;
  const PX = 1000; // CSS px per metre: a 64px button is 6.4cm, a fingertip-sized target
  const panels = [];
  function panel(el, name) {
    const w = el.offsetWidth / PX, h = el.offsetHeight / PX;
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ toneMapped: false }));
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.016, h + 0.016, 0.006), new THREE.MeshBasicMaterial({ color: 0x2c3242 }));
    back.position.z = -0.005;
    back.userData.noOcclude = true;
    group.add(back, mesh);
    world.add(group);
    const p = { el, name, group, mesh, surface: surfaces.add(el, mesh), w, h, anchor: null, wantAnchor: false, on: 'floating', anchorError: '' };
    panels.push(p);
    return p;
  }
  const P = { controls: panel($('p-controls'), 'Room controls'), status: panel($('p-status'), 'status') };
  $('uis').remove();
  const panelOf = (surface) => panels.find((p) => p.surface === surface);

  // ----------------------------------------------------------------- placing
  const UP = new THREE.Vector3(0, 1, 0);
  let realPlanes = [];
  const currentPlanes = () => (realPlanes.length ? realPlanes : room.visible ? simPlanes() : []);
  const viewer = () => camera.getWorldPosition(new THREE.Vector3());

  function dropAnchor(p) {
    p.anchor?.delete();
    p.anchor = null;
    p.wantAnchor = false;
  }

  /** Both panels within reach in front of the viewer, turned to face them. */
  function float() {
    const eye = viewer();
    const ahead = camera.getWorldDirection(new THREE.Vector3()).setY(0);
    if (ahead.lengthSq() < 1e-4) ahead.set(0, 0, -1);
    ahead.normalize();
    const right = new THREE.Vector3().crossVectors(ahead, UP);
    const presenting = renderer.xr.isPresenting;
    const stack = !presenting && camera.aspect < 1;
    const spots = stack
      ? [[P.status, 0, 0.14, 0.53], [P.controls, 0, -0.27, 0.53]]
      : [[P.controls, -0.285, presenting ? -0.18 : -0.1, presenting ? 0.5 : 0.8], [P.status, 0.285, presenting ? -0.18 : -0.1, presenting ? 0.5 : 0.8]];
    for (const [p, x, y, d] of spots) {
      dropAnchor(p);
      const pos = eye.clone().addScaledVector(ahead, d).addScaledVector(right, x);
      pos.y += y;
      const face = new THREE.Vector3().subVectors(eye, pos);
      if (stack) face.setY(0);
      const m = new THREE.Matrix4().lookAt(face, new THREE.Vector3(), UP); // +z towards the viewer
      world.attach(p.group);
      p.group.position.copy(world.worldToLocal(pos));
      p.group.quaternion.setFromRotationMatrix(m);
      p.on = 'floating';
    }
    if (!presenting) Object.assign(view.to, { yaw: 0, pitch: stack ? -0.1 : -0.12, z: 0.5 });
  }

  // #region place
  /** The status panel goes on the nearest wall, the controls on the nearest table. */
  function place() {
    const planes = currentPlanes();
    const eye = viewer();
    const jobs = [[P.status, 'vertical'], [P.controls, 'horizontal']];
    for (const [p, orientation] of jobs) {
      const at = p.group.getWorldPosition(new THREE.Vector3());
      // A floor is a horizontal plane too. Prefer one at table height, 25cm to 1.1m below the eyes.
      const tables = planes.filter((pl) => {
        if (pl.orientation !== 'horizontal') return false;
        const below = eye.y - new THREE.Vector3().setFromMatrixPosition(pl.matrix).y;
        return below > 0.25 && below < 1.1;
      });
      const found = (orientation === 'horizontal' && nearestPlane(tables, at, orientation)) || nearestPlane(planes, at, orientation);
      if (!found) {
        p.on = `no ${orientation} plane found`;
        continue;
      }
      dropAnchor(p);
      snapToPlane(p.group, found.plane, { size: [p.w, p.h], viewer: eye });
      p.on = `on a ${orientation} plane (${typeof found.plane.source === 'string' ? found.plane.source : 'detected'})`;
      // An anchor can only be made inside an XR frame, so the render loop picks this up.
      p.wantAnchor = !!session;
    }
    if (!renderer.xr.isPresenting) Object.assign(view.to, { yaw: 0, pitch: -0.4, z: 0.2 });
  }

  function keepAnchored(frame, referenceSpace) {
    for (const p of panels) {
      if (p.wantAnchor) {
        p.wantAnchor = false;
        PanelAnchor.create(frame, referenceSpace, p.group).then(
          (anchor) => { p.anchor = anchor; p.anchorError = ''; },
          (err) => { p.anchorError = err.message; },
        );
      }
      p.anchor?.update(frame, referenceSpace);
    }
  }
  // #endregion place
  actions = { place, float };

  function resize() {
    if (renderer.xr.isPresenting) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const was = camera.aspect < 1;
    camera.aspect = w / h;
    camera.fov = w < h ? 76 : 60;
    camera.updateProjectionMatrix();
    if (was !== camera.aspect < 1 && panels.every((p) => p.on === 'floating')) float();
    surfaces.invalidate();
  }
  new ResizeObserver(resize).observe(stage);
  resize();
  camera.updateMatrixWorld(true);
  float();

  // --------------------------------------------------------------- fingertips
  const FAR = new THREE.Vector3(0, -100, 0);
  const tipDot = () => {
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.008, 14, 10), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    tip.userData.noOcclude = true;
    tip.visible = false;
    scene.add(tip);
    // A disc on the panel under the fingertip. It shrinks as the finger closes in.
    const mark = new THREE.Mesh(new THREE.RingGeometry(0.007, 0.009, 24), new THREE.MeshBasicMaterial({ color: 0x7ad7ff, transparent: true, depthTest: false }));
    mark.userData.noOcclude = true;
    mark.renderOrder = 10;
    mark.visible = false;
    scene.add(mark);
    return { tip, mark };
  };
  const _n = new THREE.Vector3();
  function drawFinger(dots, finger, position) {
    dots.tip.visible = !!position;
    if (position) dots.tip.position.copy(position);
    dots.tip.material.color.set(finger.down ? 0xff7a4d : 0xffffff);
    const near = finger.near;
    dots.mark.visible = !!near;
    if (!near) return;
    _n.set(0, 0, 1).transformDirection(near.surface.mesh.matrixWorld);
    dots.mark.position.copy(near.point).addScaledVector(_n, 0.002);
    dots.mark.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _n);
    dots.mark.scale.setScalar(1 + Math.max(0, near.distance) * 30);
    dots.mark.material.color.set(finger.down ? 0xff7a4d : 0x7ad7ff);
  }

  // #region hands
  // Each tracked hand's index fingertip is a pointer. three.js keeps the joint poses up to
  // date; this reads one position per hand per frame.
  const hands = [0, 1].map((i) => {
    const hand = renderer.xr.getHand(i);
    scene.add(hand);
    const h = { hand, finger: new FingerPointer(surfaces, 10 + i), tip: new THREE.Vector3(), tracked: false, label: 'hand', dots: tipDot() };
    hand.addEventListener('connected', (e) => (h.label = `${e.data.handedness} hand`));
    hand.addEventListener('disconnected', () => (h.tracked = false));
    return h;
  });
  function updateHands() {
    for (const h of hands) {
      const joint = h.hand.joints?.['index-finger-tip'];
      h.tracked = !!joint && joint.visible && h.hand.visible;
      if (h.tracked) joint.getWorldPosition(h.tip);
      via = `fingertip, ${h.label}`;
      h.finger.update(h.tracked ? h.tip : FAR);
      via = '';
      drawFinger(h.dots, h.finger, h.tracked ? h.tip : null);
    }
  }
  // #endregion hands

  // Controllers, gaze and taps on a phone screen arrive as rays with select events.
  const raycaster = new THREE.Raycaster();
  const _rot = new THREE.Matrix4();
  const info = { selects: 0, via: '', forced: 0, layer: 'not asked for', sources: '' };
  const rays = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x7ad7ff }),
    );
    line.userData.noOcclude = true;
    line.visible = false;
    c.add(line);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.007, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    dot.renderOrder = 10;
    dot.userData.noOcclude = true;
    dot.visible = false;
    scene.add(dot, c);
    const r = { c, line, dot, ptr: surfaces.createRayPointer(i), source: null, grabbed: null, label: 'ray' };
    // A hand also reports a ray and a pinch. Close to a panel the fingertip takes over.
    const fingerBusy = () => { const n = hands[i].finger.near; return !!n && n.distance < 0.1; };
    c.addEventListener('connected', (e) => {
      r.source = e.data;
      r.label = `${e.data.handedness} ${e.data.targetRayMode} ray`;
      line.visible = e.data.targetRayMode === 'tracked-pointer';
    });
    c.addEventListener('disconnected', () => {
      r.source = null;
      r.ptr.leave();
      line.visible = dot.visible = false;
    });
    c.addEventListener('selectstart', () => {
      if (fingerBusy()) return;
      aim(r);
      via = r.label;
      r.ptr.down();
      via = '';
      info.selects++;
      dot.material.color.set(0xff7a4d);
    });
    c.addEventListener('selectend', () => {
      if (!r.ptr.pressed) return;
      aim(r);
      via = r.label;
      r.ptr.up();
      via = '';
      dot.material.color.set(0xffffff);
    });
    // Squeeze to pick a panel up. It lets go of its plane and its anchor.
    c.addEventListener('squeezestart', () => {
      aim(r);
      const p = r.ptr.hit && panelOf(r.ptr.hit.surface);
      if (!p) return;
      dropAnchor(p);
      p.on = 'carried';
      c.attach(p.group);
      r.grabbed = p;
    });
    c.addEventListener('squeezeend', () => {
      if (r.grabbed) {
        world.attach(r.grabbed.group);
        r.grabbed.on = 'floating';
      }
      r.grabbed = null;
    });
    r.busy = fingerBusy;
    return r;
  });
  function aim(r) {
    r.c.updateMatrixWorld(true);
    _rot.extractRotation(r.c.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(r.c.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_rot).normalize();
    const hit = r.ptr.move(raycaster);
    if (r.ptr.where) info.via = r.ptr.where.via;
    r.dot.visible = !!hit;
    if (hit) r.dot.position.copy(hit.point);
    r.line.scale.z = hit ? hit.distance : 2;
    return hit;
  }

  // ------------------------------------------------------------------ session
  let session = null, sess = null, layer = null;
  let last = null; // what the last session reported, kept for the table after it ends
  const outlines = new THREE.Group();
  scene.add(outlines);

  // #region session
  const ROOM_FEATURES = ['local-floor', 'hand-tracking', 'plane-detection', 'anchors'];
  async function enter(mode) {
    if (session) return session.end();
    const wantDepth = $('opt-depth').checked, wantLayer = $('opt-layer').checked;
    const init = { optionalFeatures: [...ROOM_FEATURES, ...(wantDepth ? ['depth-sensing'] : []), ...(wantLayer ? ['layers'] : [])] };
    // three.js draws the sensed depth into the depth buffer when the session hands it over as a GPU texture.
    if (wantDepth) init.depthSensing = { usagePreference: ['gpu-optimized', 'cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32', 'unsigned-short'] };
    let s;
    try {
      s = await navigator.xr.requestSession(mode, init);
    } catch (err) {
      xrStatus.textContent = `Could not start ${mode}: ${err.message}`;
      return;
    }
    let space = 'local-floor';
    try {
      await s.requestReferenceSpace('local-floor');
    } catch {
      space = 'local';
    }
    renderer.xr.setReferenceSpaceType(space);
    const granted = s.enabledFeatures ? [...s.enabledFeatures] : null;
    // #endregion session
    const ar = mode === 'immersive-ar';
    world.position.y = space === 'local' ? -EYE : 0;
    scene.background = ar ? null : SKY;
    room.visible = !ar || !!device; // a real AR session shows the real room
    simFinger.update(FAR);
    await renderer.xr.setSession(s);
    session = s;
    sess = { mode, space, granted, wantDepth, wantLayer, ar, t0: performance.now(), paints0: surfaces.stats.paints, frames: 0, lastPaint: performance.now(), lastSeen: surfaces.stats.paints, planeError: '', presses0: hands[0].finger.presses + hands[1].finger.presses };
    info.layer = wantLayer ? 'waiting for the first frames' : 'not asked for';
    info.forced = 0;
    $('s-mode').textContent = `${mode}${device ? ', emulated' : ''}`;
    showEmuBar(true);
    s.addEventListener('end', () => {
      last = sessionRows(performance.now()); // before anything is torn down
      for (const r of rays) {
        if (r.grabbed) world.attach(r.grabbed.group);
        r.grabbed = null;
        r.ptr.leave();
        r.line.visible = r.dot.visible = false;
      }
      for (const h of hands) {
        h.finger.update(FAR);
        drawFinger(h.dots, h.finger, null);
      }
      for (const p of panels) dropAnchor(p);
      layer?.dispose();
      layer = null;
      outlines.clear();
      realPlanes = [];
      session = sess = null;
      world.position.y = 0;
      scene.background = SKY;
      room.visible = true;
      $('s-mode').textContent = 'simulated room';
      showEmuBar(false);
      // The emulator moves the canvas out of the page and back; size it again once it is home.
      setTimeout(() => { resize(); float(); }, 50);
      setTimeout(resize, 400);
    });
  }
  $('enter-vr').addEventListener('click', () => enter('immersive-vr'));
  $('enter-ar').addEventListener('click', () => enter('immersive-ar'));

  function drawOutlines() {
    for (const child of outlines.children) child.geometry.dispose();
    outlines.clear();
    for (const plane of realPlanes) {
      const pts = plane.polygon.map((p) => new THREE.Vector3(p.x, 0, p.z).applyMatrix4(plane.matrix));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: plane.orientation === 'vertical' ? 0x7ad7ff : 0xffb199 }));
      line.userData.noOcclude = true;
      outlines.add(line);
    }
  }

  function sessionFrame(frame, now) {
    sess.frames++;
    for (const w of waiters) w.n--;
    for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].n <= 0) waiters.splice(i, 1)[0].resolve();
    const referenceSpace = renderer.xr.getReferenceSpace();
    info.sources = [...session.inputSources].map((s) => `${s.handedness[0]}:${s.hand ? 'hand' : s.targetRayMode}`).join(' ');
    if (sess.frames === 3) float(); // the head pose is known by now
    updateHands();
    for (const r of rays) {
      if (!r.source || !r.c.visible || r.busy()) {
        r.dot.visible = false;
        if (r.ptr.over && !r.ptr.pressed) r.ptr.leave();
        continue;
      }
      aim(r);
      const gp = r.source.gamepad;
      const y = gp ? (gp.axes[3] ?? gp.axes[1] ?? 0) : 0;
      if (Math.abs(y) > 0.15) r.ptr.scroll(0, y * 14);
    }
    if (frame) {
      if (sess.frames % 15 === 4) {
        try {
          realPlanes = readPlanes(frame, referenceSpace);
          drawOutlines();
        } catch (err) {
          sess.planeError = err.message;
        }
      }
      keepAnchored(frame, referenceSpace);
      if (sess.wantLayer && !layer && sess.frames === 30) {
        try {
          layer = new ElementQuadLayer(renderer, session, P.status.surface, P.status.mesh, { width: P.status.w, height: P.status.h });
          info.layer = 'quad layer created';
        } catch (err) {
          info.layer = `failed: ${err.message}`;
        }
      }
      if (layer) {
        try {
          layer.update(frame);
          info.layer = `quad layer, ${layer.mode === 'direct' ? 'texElementSubImage2D() into the layer' : 'copied from the panel texture'}, ${layer.copies} updates${layer.directError ? ` (direct upload refused: ${layer.directError})` : ''}`;
        } catch (err) {
          info.layer = `failed: ${err.message}`;
          layer.dispose();
          layer = null;
        }
      }
    }
    // If paint events stop inside the session, ask for them, then fall back to uploading
    // from the last paint record a few times a second.
    if (surfaces.stats.paints !== sess.lastSeen) {
      sess.lastSeen = surfaces.stats.paints;
      sess.lastPaint = now;
    } else if (now - sess.lastPaint > 250) {
      canvas.requestPaint?.();
      if (now - sess.lastPaint > 1000 && sess.frames % 12 === 0) {
        surfaces.uploadNow();
        info.forced++;
      }
    }
  }
  const waiters = [];
  const frames = (n) => new Promise((resolve) => waiters.push({ n, resolve }));

  // ------------------------------------------------------- simulated fingertip
  // Outside a session the pointer moves a fingertip: 4cm off the panel under the pointer,
  // pushed through its surface while the button or the touch is down.
  const simFinger = new FingerPointer(surfaces, 5);
  const simDots = tipDot();
  const sim = { client: null, pressing: false, look: null, tip: null, busy: false };
  const HOVER = 0.04, PUSHED = -0.002;
  const viewCaster = new THREE.Raycaster();
  function viewRay(client) {
    const rect = canvas.getBoundingClientRect();
    if (session && device) {
      // The emulated headset: one eye's field of view per half of the window.
      const half = stereo ? rect.width / 2 : rect.width;
      let x = client.x - rect.left;
      if (stereo && x > half) x -= half;
      const t = Math.tan((device.fovy ?? Math.PI / 2) / 2);
      const headQ = new THREE.Quaternion().setFromAxisAngle(UP, emu.yaw);
      const dir = new THREE.Vector3(((x / half) * 2 - 1) * t * (half / rect.height), -(((client.y - rect.top) / rect.height) * 2 - 1) * t, -1).applyQuaternion(headQ).normalize();
      viewCaster.set(new THREE.Vector3(0, 1.6, 0), dir);
    } else {
      viewCaster.setFromCamera(new THREE.Vector2(((client.x - rect.left) / rect.width) * 2 - 1, -(((client.y - rect.top) / rect.height) * 2 - 1)), camera);
    }
    return viewCaster;
  }
  /** Where a fingertip should be for a pointer position: `depth` metres off the panel it is over. */
  function tipFor(client, depth) {
    if (!client) return null;
    const seen = viewRay(client).intersectObjects(panels.map((p) => p.mesh), false)[0];
    if (!seen) return null;
    const normal = new THREE.Vector3(0, 0, 1).transformDirection(seen.object.matrixWorld);
    return { point: seen.point, normal, tip: seen.point.clone().addScaledVector(normal, depth) };
  }
  function simStep() {
    const t = sim.look ? null : tipFor(sim.client, sim.pressing ? PUSHED : HOVER);
    sim.tip = t ? t.tip : null;
    via = 'simulated fingertip';
    simFinger.update(sim.tip ?? FAR);
    via = '';
    if (simFinger.pointer.where) info.via = simFinger.pointer.where.via;
  }
  function simEvent(e) {
    if (sim.busy) return;
    const client = { x: e.clientX, y: e.clientY };
    if (e.type === 'pointerdown') {
      sim.client = client;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      if (tipFor(client, 0)) sim.pressing = true;
      else sim.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
      simStep();
    } else if (e.type === 'pointermove') {
      if (sim.look) {
        view.to.yaw = view.yaw += (e.clientX - sim.look.x) * 0.004;
        view.to.pitch = view.pitch = Math.max(-1.2, Math.min(0.7, view.pitch + (e.clientY - sim.look.y) * 0.004));
        sim.look.x = e.clientX;
        sim.look.y = e.clientY;
      }
      sim.client = client;
    } else if (e.type === 'pointerup' || e.type === 'pointercancel') {
      sim.pressing = false;
      sim.look = null;
      sim.client = client;
      simStep(); // pulled back to hover height: this is the release, and the click
      if (e.pointerType !== 'mouse') {
        sim.client = null; // a lifted finger is gone
        simStep();
      }
    }
  }
  canvas.addEventListener('pointerleave', () => { if (!sim.pressing && !sim.look) sim.client = null; });

  // Real pointer events must not also reach the flat-laid-out elements under the canvas.
  // Keyboard clicks (detail 0) are left alone, so Tab, Space and Enter work on the panels.
  const swallow = (e) => {
    if (!e.isTrusted || !canvas.contains(e.target)) return;
    if (e.type === 'click' && e.detail === 0) return;
    if (e.type === 'wheel') {
      const over = session ? rays.find((r) => r.ptr.over)?.ptr : simFinger.pointer.over ? simFinger.pointer : null;
      if (!over?.scroll(e.deltaX, e.deltaY)) scrollBy(e.deltaX, e.deltaY);
    } else if (e.type.startsWith('pointer')) {
      if (session && device) emuEvent(e);
      else if (!session) simEvent(e);
    }
    e.stopPropagation();
    if (e.cancelable) e.preventDefault();
  };
  for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchmove', 'touchend', 'wheel']) {
    window.addEventListener(type, swallow, { capture: true, passive: false });
  }

  // ------------------------------------------------------- emulated controller and hand
  let emuBar = null;
  const emu = { yaw: 0, client: null, downAt: 0, mode: 'controller', pressing: false };
  function showEmuBar(on) {
    if (!device) return;
    if (!emuBar) {
      emuBar = document.createElement('div');
      emuBar.className = 'emu-bar';
      emuBar.innerHTML = '<button data-turn="1" aria-label="Turn left">◀</button><button data-turn="-1" aria-label="Turn right">▶</button><button data-input>Use a hand</button><button data-exit>Exit</button>';
      emuBar.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.exit !== undefined) return session?.end();
        if (b.dataset.input !== undefined) {
          setEmuInput(emu.mode === 'hand' ? 'controller' : 'hand');
          b.textContent = emu.mode === 'hand' ? 'Use a controller' : 'Use a hand';
          return;
        }
        emu.yaw += Number(b.dataset.turn) * 0.35;
        const q = new THREE.Quaternion().setFromAxisAngle(UP, emu.yaw);
        device.quaternion.set(q.x, q.y, q.z, q.w);
      });
      document.body.append(emuBar);
    }
    emuBar.hidden = !on;
    if (on) {
      emu.yaw = 0;
      device.quaternion.set(0, 0, 0, 1);
      device.controllers.left?.position.set(-0.25, 1.1, -0.2);
      setEmuInput(emu.mode);
    }
  }
  function setEmuInput(mode) {
    emu.mode = mode;
    device.primaryInputMode = mode;
    emu.pressing = false;
    if (mode === 'hand') {
      device.hands.left?.position.set(-0.3, 1.0, -0.1);
      device.hands.right?.position.set(0.2, 1.3, -0.3);
    } else {
      emuAim();
    }
  }
  function emuAim() {
    const right = device.controllers.right;
    if (!right) return;
    const headQ = new THREE.Quaternion().setFromAxisAngle(UP, emu.yaw);
    const head = new THREE.Vector3(0, 1.6, 0);
    let target = new THREE.Vector3(0, -0.1, -1).applyQuaternion(headQ).add(head);
    if (emu.client) {
      const ray = viewRay(emu.client);
      const seen = ray.intersectObjects(panels.map((p) => p.mesh), false)[0];
      target = seen ? seen.point : ray.ray.direction.clone().multiplyScalar(1.4).add(head);
    }
    const hand = new THREE.Vector3(0.2, -0.3, -0.05).applyQuaternion(headQ).add(head);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(hand, target, UP));
    right.position.set(hand.x, hand.y, hand.z);
    right.quaternion.set(q.x, q.y, q.z, q.w);
  }
  // The emulated hand is moved until its index fingertip, as three.js reports it, is where
  // the pointer asks. That runs the same joint-reading code a real hand does.
  function emuHand() {
    const right = device.hands.right;
    const h = hands.find((x) => x.tracked && x.label.startsWith('right'));
    if (!right || !h) return;
    const want = tipFor(emu.client, emu.pressing ? PUSHED : HOVER)?.tip;
    if (!want) return;
    const p = right.position;
    // Half the error per frame: the joint pose read here is one frame old, and a full step overshoots.
    right.position.set(p.x + (want.x - h.tip.x) / 2, p.y + (want.y - h.tip.y) / 2, p.z + (want.z - h.tip.z) / 2);
  }
  function emuEvent(e) {
    if (e.type === 'pointermove' || e.type === 'pointerdown') emu.client = { x: e.clientX, y: e.clientY };
    if (emu.mode === 'hand') {
      if (e.type === 'pointerdown') emu.pressing = true;
      if (e.type === 'pointerup' || e.type === 'pointercancel') emu.pressing = false;
      return;
    }
    emuAim();
    if (e.type === 'pointerdown') {
      device.controllers.right?.updateButtonValue('trigger', 1);
      emu.downAt = performance.now();
    }
    // A tap is down and up in one frame. Hold the trigger long enough for the runtime to see it.
    if (e.type === 'pointerup' || e.type === 'pointercancel') {
      setTimeout(() => device.controllers.right?.updateButtonValue('trigger', 0), Math.max(0, 120 - (performance.now() - emu.downAt)));
    }
  }

  // ------------------------------------------------------------------ report
  const name = (surface) => panelOf(surface)?.name ?? 'a panel';
  function simRows() {
    const st = surfaces.stats;
    return [
      ['mode', 'page, simulated room'],
      ['input', 'mouse or touch moves a fingertip'],
      ['fingertips', `${simFinger.presses} presses`],
      ['planes', '2 simulated: a wall and a table'],
      ['panels', panels.map((p) => `${p.name} ${p.on}`).join('; ')],
      ['anchors', 'need a session'],
      ['depth', `a simulated column, ${$('opt-depth').checked ? 'hiding' : 'not hiding'} what is behind it`],
      ['layer', 'needs a session'],
      ['paints', `${st.paints}, ${st.uploads} uploads`],
      ['hit test', info.via || 'not used yet'],
      ['error', st.lastError ?? 'none'],
    ];
  }
  function sessionRows(now) {
    const st = surfaces.stats;
    const has = (f) => (sess.granted ? sess.granted.includes(f) : null);
    const off = (f) => (has(f) === null ? 'enabledFeatures is missing, so unknown' : `${f} was not granted`);
    const tracked = hands.filter((h) => h.tracked).length;
    const presses = hands[0].finger.presses + hands[1].finger.presses - sess.presses0;
    const v = realPlanes.filter((p) => p.orientation === 'vertical').length;
    const anchored = panels.filter((p) => p.anchor);
    const anchorError = panels.find((p) => p.anchorError)?.anchorError;
    let depth = 'not asked for';
    if (sess.wantDepth) {
      if (!has('depth-sensing')) depth = off('depth-sensing');
      else {
        let usage = '', drawn = false;
        try { usage = `${session.depthUsage}, ${session.depthDataFormat}`; } catch (err) { usage = err.message; }
        try { drawn = renderer.xr.hasDepthSensing(); } catch { /* older three */ }
        depth = `${usage}; three.js ${drawn ? 'is drawing it into the depth buffer' : 'has no depth texture to draw'}`;
      }
    }
    return [
      ['mode', `${sess.mode}${device ? ', emulated' : ''}, ${sess.space}`],
      ['input', info.sources || 'no input source yet'],
      ['fingertips', has('hand-tracking') ? `${tracked} of 2 hands tracked, ${presses} presses` : off('hand-tracking')],
      ['planes', sess.planeError || (has('plane-detection') ? `${realPlanes.length} detected (${v} vertical, ${realPlanes.length - v} horizontal)${!realPlanes.length && room.visible ? ', using the simulated wall and table' : ''}` : `${off('plane-detection')}${room.visible ? ', using the simulated wall and table' : ''}`)],
      ['panels', panels.map((p) => `${p.name} ${p.on}`).join('; ')],
      ['anchors', anchorError ? `failed: ${anchorError}` : has('anchors') ? `${anchored.length} made, ${anchored.reduce((n, p) => n + p.anchor.updates, 0)} pose updates` : off('anchors')],
      ['depth', depth],
      ['layer', sess.wantLayer && has('layers') === false ? off('layers') : info.layer],
      ['paints', `${st.paints - sess.paints0} in session (${((st.paints - sess.paints0) / Math.max(1, (now - sess.t0) / 1000)).toFixed(1)}/s)${info.forced ? `, ${info.forced} forced uploads` : ''}`],
      ['hit test', info.via || 'not used yet'],
      ['error', st.lastError ?? 'none'],
    ];
  }
  const dl = $('s-rows'), tbody = $('session-rows');
  let lastText = '';
  function report(now) {
    const simulated = simRows();
    const live = sess ? sessionRows(now) : null;
    const shown = live ?? simulated;
    const then = live ?? last;
    const text = JSON.stringify([shown, then]);
    if (text === lastText) return;
    lastText = text;
    dl.replaceChildren(...shown.flatMap(([k, v]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      dd.title = v;
      return [dt, dd];
    }));
    tbody.replaceChildren(...simulated.map(([k, v], i) => {
      const tr = document.createElement('tr');
      for (const cell of [k, v, then ? then[i][1] : 'no session yet']) tr.append(Object.assign(document.createElement('td'), { textContent: cell }));
      return tr;
    }));
  }

  // --------------------------------------------------------------------- loop
  const context = watchContext(canvas, stage, { onRestore: () => surfaces.invalidate() });
  const afterRender = [];
  let lastReport = 0;
  const ease = (a, b, k) => a + (b - a) * k;
  function stepView(k) {
    view.yaw = ease(view.yaw, view.to.yaw, k);
    view.pitch = ease(view.pitch, view.to.pitch, k);
    view.z = ease(view.z, view.to.z, k);
    camera.position.set(0, EYE, view.z);
    camera.rotation.set(view.pitch, view.yaw, 0);
    camera.updateMatrixWorld(true);
  }
  window.__room = { surfaces, P, panels, hands, rays, info, sim, simFinger, camera, scene, renderer, device, emu, enter, place, float, view, get session() { return session; }, get sess() { return sess; }, get layer() { return layer; } };

  renderer.setAnimationLoop((time, frame) => {
    const now = performance.now();
    column.material.depthWrite = $('opt-depth').checked;
    showLamps();
    if (!renderer.xr.isPresenting) {
      stepView(0.14);
      if (!sim.busy) {
        simStep();
        drawFinger(simDots, simFinger, sim.tip);
      }
    } else {
      simDots.tip.visible = simDots.mark.visible = false;
    }
    if (sess) {
      if (device && emu.mode === 'hand') emuHand();
      sessionFrame(frame, now);
    }
    surfaces.update();
    if (now - lastReport > 300) {
      lastReport = now;
      report(now);
      const near = sess ? hands.map((h) => h.finger.near).find(Boolean) : simFinger.near;
      hud.textContent = `${sess ? sess.mode : 'simulated room'} · ${near ? `fingertip ${(Math.max(0, near.distance) * 100).toFixed(1)}cm from ${name(near.surface)}` : 'fingertip away'} · ${surfaces.stats.paints} paints${surfaces.stats.lastError ? ' · ' + surfaces.stats.lastError : ''}`;
    }
    renderer.render(scene, camera);
    while (afterRender.length) afterRender.shift()(renderer.getContext());
  });

  // ------------------------------------------------------------ live checks
  // These drive a fingertip of their own over the panels on this page, so they wait for a tap
  // (shared/support.js lists this page) and put everything back.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 3000) => {
    const t = performance.now();
    while (performance.now() - t < ms) {
      if (fn()) return true;
      await wait(50);
    }
    return false;
  };
  const rendered = () => new Promise((resolve) => afterRender.push(resolve));
  const testFinger = new FingerPointer(surfaces, 20);
  // Where is an element's centre, in its panel's own CSS pixels?
  function centre(el, root, fx = 0.5, fy = 0.5) {
    const a = el.getBoundingClientRect(), b = root.getBoundingClientRect();
    const k = b.width / root.offsetWidth || 1;
    return { x: (a.left - b.left + a.width * fx) / k, y: (a.top - b.top + a.height * fy) / k };
  }
  /** Put the test fingertip `d` metres in front of a spot on an element. */
  function touch(p, el, d, fx, fy) {
    const c = centre(el, p.el, fx, fy);
    const tip = p.mesh.localToWorld(new THREE.Vector3((c.x / p.el.offsetWidth - 0.5) * p.w, (0.5 - c.y / p.el.offsetHeight) * p.h, d));
    via = 'test fingertip';
    testFinger.update(tip);
    via = '';
    return testFinger.pointer.where?.target ?? null;
  }
  const away = () => testFinger.update(FAR);
  const tag = (el) => (el ? `<${el.localName}${el.id ? '#' + el.id : ''}>` : 'nothing');
  async function hold(fn) {
    // The checks own the scene while they run: the pointer-driven fingertip is parked.
    sim.busy = true;
    simFinger.update(FAR);
    simDots.tip.visible = simDots.mark.visible = false;
    const kept = { ...state, log: [...logList.children], src: C.src.textContent, presses: simFinger.presses };
    try {
      return await fn();
    } finally {
      away();
      Object.assign(state, { lamp: kept.lamp, count: kept.count, bright: kept.bright });
      C.bright.value = kept.bright;
      show();
      logList.replaceChildren(...kept.log);
      C.src.textContent = kept.src;
      sim.busy = false;
    }
  }
  const mustBePage = () => { if (session) throw new Error('end the session first: these checks drive the simulated room'); };

  await until(() => surfaces.stats.uploads >= panels.length, 4000);
  await runTests($('results'), [
    {
      name: 'Both panels are live textures',
      why: 'Each panel is an element inside the canvas, uploaded with texElementSubImage2D() when it paints.',
      run: async () => {
        if (surfaces.stats.lastError) throw new Error(surfaces.stats.lastError);
        const before = P.status.surface.uploads;
        $('s-mode').textContent += ' ';
        const ok = await until(() => P.status.surface.uploads > before);
        $('s-mode').textContent = $('s-mode').textContent.trim();
        if (!ok) throw new Error('a DOM change did not re-upload the panel');
        return `${panels.map((p) => `${p.surface.width}×${p.surface.height}`).join(', ')} px, ${surfaces.stats.uploads} uploads`;
      },
    },
    {
      name: 'A fingertip 3cm from a button hovers and does not press',
      why: 'Distance to the panel decides. Inside 20cm the pointer moves over the element, and only the last 8mm is a press.',
      run: () => hold(async () => {
        mustBePage();
        const target = touch(P.controls, C.lamp, 0.03);
        const hovered = C.lamp.hasAttribute('data-ray-hover');
        if (target !== C.lamp) throw new Error(`the fingertip is over ${tag(target)}`);
        if (state.lamp) throw new Error('the button was pressed from 3cm away');
        if (!hovered) throw new Error('no hover state on the button');
        return `over ${tag(target)} at ${(testFinger.near.distance * 100).toFixed(1)}cm, hover outline on, not pressed`;
      }),
    },
    {
      name: 'Pushing the fingertip to the surface and pulling back clicks',
      why: 'pointerdown at 8mm, pointerup and click when the finger is pulled back past 2.5cm.',
      run: () => hold(async () => {
        mustBePage();
        touch(P.controls, C.lamp, 0.03);
        touch(P.controls, C.lamp, 0.004);
        const down = testFinger.down === P.controls.surface, early = state.lamp;
        touch(P.controls, C.lamp, 0.015);
        const held = state.lamp;
        touch(P.controls, C.lamp, 0.03);
        if (!down) throw new Error('no press at 4mm');
        if (early || held) throw new Error('clicked before the finger was pulled back');
        if (!state.lamp) throw new Error('no click after release');
        return `pressed at 4mm, still held at 1.5cm, clicked at 3cm: "${logList.firstElementChild?.textContent}"`;
      }),
    },
    {
      name: 'Sliding a pressed fingertip moves a slider',
      why: 'A synthetic event cannot move a range thumb, so the pointer sets the value from where the finger is.',
      run: () => hold(async () => {
        mustBePage();
        touch(P.controls, C.bright, 0.03, 0.2);
        touch(P.controls, C.bright, 0.002, 0.2);
        const a = state.bright;
        touch(P.controls, C.bright, 0.002, 0.9);
        const b = state.bright;
        touch(P.controls, C.bright, 0.04, 0.9);
        if (!(a <= 3 && b >= 8)) throw new Error(`values were ${a} then ${b}`);
        return `value ${a} at 20% of the track, ${b} after sliding to 90%`;
      }),
    },
    {
      name: 'A press that starts on a list scrolls it and clicks nothing',
      why: 'As on a touch screen: a pressed finger that slides more than 8px over plain content scrolls the nearest scroller.',
      run: () => hold(async () => {
        mustBePage();
        for (let i = 0; i < 24; i++) logList.append(Object.assign(document.createElement('li'), { textContent: `filler ${i + 1}` }));
        logList.scrollTop = 0;
        await wait(60);
        let clicks = 0;
        const count = () => clicks++;
        logList.addEventListener('click', count);
        touch(P.status, logList, 0.03, 0.5, 0.8);
        touch(P.status, logList, 0.002, 0.5, 0.8);
        for (const fy of [0.7, 0.55, 0.4, 0.25]) touch(P.status, logList, 0.002, 0.5, fy);
        const top = logList.scrollTop, scrolling = testFinger.scrolling;
        touch(P.status, logList, 0.04, 0.5, 0.25);
        logList.removeEventListener('click', count);
        if (!scrolling || top < 20) throw new Error(`scrollTop is ${top}`);
        if (clicks) throw new Error('the release was also a click');
        return `list scrolled ${Math.round(top)}px, no click`;
      }),
    },
    {
      name: 'Panels snap to the simulated wall and table and still take presses',
      why: 'The same call a session makes with detected planes. Input is mapped through the mesh, so a new pose needs no other change.',
      run: () => hold(async () => {
        mustBePage();
        const before = state.count;
        place();
        const n = (p) => new THREE.Vector3(0, 0, 1).transformDirection(p.group.matrixWorld);
        const wallN = n(P.status), tableN = n(P.controls);
        const gapWall = P.status.group.getWorldPosition(new THREE.Vector3()).z - WALL_Z;
        const gapTable = P.controls.group.getWorldPosition(new THREE.Vector3()).y - TABLE_Y;
        touch(P.controls, C.more, 0.03);
        touch(P.controls, C.more, 0.002);
        touch(P.controls, C.more, 0.04);
        const after = state.count;
        float();
        if (wallN.z < 0.99) throw new Error(`the status panel faces ${wallN.toArray().map((v) => v.toFixed(2))}`);
        if (tableN.y < 0.99) throw new Error(`the controls face ${tableN.toArray().map((v) => v.toFixed(2))}`);
        if (Math.abs(gapWall - 0.012) > 0.002 || Math.abs(gapTable - 0.012) > 0.002) throw new Error(`gaps are ${gapWall.toFixed(3)}m and ${gapTable.toFixed(3)}m`);
        if (after !== before + 1) throw new Error('a press on the table panel did not count');
        return `status panel 12mm off the wall, controls 12mm above the table facing up, a press on the table panel counted`;
      }),
    },
    {
      name: 'Depth occlusion hides the part of a panel behind the column',
      why: 'In a session three.js draws the sensed depth into the depth buffer. Here the column writes depth or does not.',
      timeout: 6000,
      run: () => hold(async () => {
        mustBePage();
        const box = $('opt-depth'), was = box.checked, kept = { ...view, to: { ...view.to } };
        place();
        Object.assign(view.to, { yaw: 0, pitch: -0.2, z: 0.5 });
        Object.assign(view, view.to);
        const read = async (on) => {
          box.checked = on;
          await rendered();
          const gl = await rendered();
          // A point on the front of the column, level with the status panel behind it.
          const y = P.status.group.getWorldPosition(new THREE.Vector3()).y;
          const ndc = new THREE.Vector3(0.2, y, -1.25 + 0.11).project(camera);
          const px = new Uint8Array(4);
          gl.readPixels(Math.round((ndc.x * 0.5 + 0.5) * gl.drawingBufferWidth), Math.round((ndc.y * 0.5 + 0.5) * gl.drawingBufferHeight), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          return [...px.slice(0, 3)];
        };
        const want = [(COLUMN >> 16) & 255, (COLUMN >> 8) & 255, COLUMN & 255];
        const close = (c) => c.every((v, i) => Math.abs(v - want[i]) <= 8);
        const on = await read(true), off = await read(false);
        box.checked = was;
        float();
        Object.assign(view.to, kept.to);
        if (!close(on)) throw new Error(`with depth on the pixel is rgb(${on}), not the column's rgb(${want})`);
        if (close(off)) throw new Error('with depth off the column still covers the panel');
        return `depth on: the column's rgb(${on}). Depth off: the panel's rgb(${off}) is drawn over it`;
      }),
    },
    {
      name: 'The WebXR room interfaces exist in this browser',
      why: 'Hand joints, planes, anchors, depth and quad layers. Having the interface says nothing about the device.',
      run: async () => {
        const need = { XRHand: 'hand-tracking', XRPlane: 'plane-detection', XRAnchor: 'anchors', XRDepthInformation: 'depth-sensing', XRQuadLayer: 'layers' };
        const missing = Object.keys(need).filter((k) => !(k in window));
        if (missing.length) throw new Error(`missing: ${missing.map((k) => `${k} (${need[k]})`).join(', ')}`);
        return `${Object.keys(need).join(', ')}${device ? ', from the emulator' : ''}`;
      },
    },
    {
      name: 'immersive-ar is available here',
      why: 'An Android phone with ARCore, or a passthrough headset. Planes, anchors and depth need it.',
      run: async () => {
        if (!modes['immersive-ar'].ok) throw new Error(modes['immersive-ar'].why);
        return device ? 'emulated Quest 3 (IWER)' : 'supported';
      },
    },
    {
      name: 'The scene on this page is not blank',
      why: 'Read back from the canvas. Fails if it is one flat colour or its graphics context is gone.',
      run: async () => {
        if (context.lost()) throw new Error('the WebGL context is lost');
        const n = sampleGL(await rendered());
        if (n < 3) throw new Error(`only ${n} colour${n === 1 ? '' : 's'} across the whole canvas`);
        return `${n} different colours across a 7×7 grid of samples`;
      },
    },
  ]);
  window.__ready = true;
}
