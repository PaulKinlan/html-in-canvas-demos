// #region panels
import * as THREE from 'three';
import { HTMLSurfaces, support } from '/lib/html3d.js';
// #endregion panels
import { banner, runTests, supported } from '/shared/support.js';
import { isFixture, mirror, publish, sampleGL, watchContext } from '/lib/check-fixture.js';

banner();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ emulator
// ?emulate=1 swaps navigator.xr for Meta's Immersive Web Emulation Runtime before anything
// else looks at it, so the whole session path (XRSession, input sources, select events) runs
// on a laptop or a phone. It replaces the real runtime for this page load, hence the URL flag.
let device = null;
// Side by side eyes only when the window is wide enough for two of them.
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
const uis = $('uis');
const live = supported && !!support.webgl;

// --------------------------------------------------------------- the panels
// All plain DOM. This part runs with or without the canvas API.
const F = { name: $('x-name'), msg: $('x-msg'), mood: $('x-mood'), size: $('x-size'), shout: $('x-shout'), form: $('p-form') };
const list = $('x-list');
let entries = 0;
function addEntry(name, text, meta, fresh = true) {
  const li = document.createElement('li');
  const b = document.createElement('b');
  b.textContent = name;
  const small = document.createElement('small');
  small.textContent = meta;
  li.append(b, ` ${text}`, small);
  if (fresh) li.className = 'new';
  list.prepend(li);
  entries++;
  $('x-count').textContent = `${list.children.length} entries`;
  if (fresh) list.scrollTop = 0;
}
[
  ['Grace', 'Compiled on the first try.', 'Delighted · volume 7'],
  ['Tim', 'It is all just documents.', 'Curious · volume 4'],
  ['Hedy', 'Hopping between panels.', 'Curious · volume 6'],
  ['Alan', 'Can a panel think?', 'Sceptical · volume 3'],
  ['Katherine', 'Checked the trajectory by hand.', 'Delighted · volume 9'],
  ['Linus', 'Talk is cheap. Show me the DOM.', 'Sceptical · volume 8'],
  ['Margaret', 'Software engineering, in a room.', 'Curious · volume 5'],
  ['Dennis', 'hello, world', 'Seasick · volume 2'],
].forEach((e) => addEntry(...e, false));

F.size.addEventListener('input', () => ($('x-size-out').textContent = F.size.value));
F.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = F.msg.value.trim() || '(nothing)';
  addEntry(F.name.value.trim() || 'Anonymous', F.shout.checked ? text.toUpperCase() + '!' : text, `${F.mood.value} · volume ${F.size.value}`);
});
$('x-clear').addEventListener('click', () => {
  list.replaceChildren();
  $('x-count').textContent = '0 entries';
});

// The keyboard. Keys cancel mousedown, so they never take focus from the field being typed in.
const keys = $('p-keys');
let lastField = F.msg;
let shift = false;
const ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', '⇧zxcvbnm⌫', ',␣.↵'];
const SPECIAL = { '⇧': ['shift', 'Shift', 'wide'], '⌫': ['back', 'Backspace', 'wide'], '␣': ['space', 'Space', 'space'], '↵': ['enter', 'Enter', 'wide'] };
for (const row of ROWS) {
  const div = document.createElement('div');
  div.className = 'krow';
  for (const ch of row) {
    const b = document.createElement('button');
    b.type = 'button';
    b.tabIndex = -1;
    const sp = SPECIAL[ch];
    b.dataset.key = sp ? sp[0] : ch;
    b.textContent = sp && sp[0] === 'space' ? '' : ch;
    if (sp) {
      b.setAttribute('aria-label', sp[1]);
      b.classList.add(sp[2]);
    }
    div.append(b);
  }
  keys.append(div);
}
document.addEventListener('focusin', (e) => {
  if (e.target.matches?.('.xp input[type=text], .xp textarea')) lastField = e.target;
});
keys.addEventListener('mousedown', (e) => e.preventDefault());
keys.addEventListener('click', (e) => {
  const key = e.target.closest('button')?.dataset.key;
  if (key) typeKey(key);
});
function typeKey(key) {
  if (key === 'shift') {
    shift = !shift;
    keys.querySelector('[data-key=shift]').setAttribute('aria-pressed', shift);
    for (const b of keys.querySelectorAll('button')) if (b.dataset.key.length === 1 && /[a-z]/i.test(b.dataset.key)) b.textContent = shift ? b.dataset.key.toUpperCase() : b.dataset.key;
    return;
  }
  const f = lastField;
  if (!f?.isConnected) return;
  if (document.activeElement !== f) f.focus({ preventScroll: true });
  const start = f.selectionStart, end = f.selectionEnd;
  if (key === 'enter' && !f.matches('textarea')) return f.form?.requestSubmit();
  if (key === 'back') {
    if (start === end && start === 0) return;
    f.setRangeText('', start === end ? start - 1 : start, end, 'end');
  } else {
    const text = key === 'enter' ? '\n' : key === 'space' ? ' ' : shift ? key.toUpperCase() : key;
    if (f.maxLength > 0 && f.value.length - (end - start) >= f.maxLength) return;
    f.setRangeText(text, start, end, 'end');
    if (shift) typeKey('shift');
  }
  f.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: key === 'back' ? 'deleteContentBackward' : 'insertText' }));
}

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
  ? 'Emulated Quest 3. Move the pointer to aim the right controller, press to pull the trigger.'
  : modes['immersive-vr'].ok || modes['immersive-ar'].ok
    ? ''
    : 'No headset here. The preview below works, and the emulator runs the session path.';

if (!live) {
  // Without the API the panels stay where they are, as an ordinary page.
  stage.hidden = true;
  $('hint').textContent = 'The panels are shown below as plain HTML. The form and the keyboard still work.';
  await runTests($('results'), [
    { name: 'HTML-in-canvas for WebGL', why: 'Needs texElementSubImage2D (or the older texElementImage2D).', run: async () => { throw new Error('not available in this browser'); } },
  ]);
} else {
  await start();
}

async function start() {
  // ---------------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(isFixture ? 1 : Math.min(devicePixelRatio, 2)); // the hidden copy that runs the checks stays cheap
  renderer.xr.enabled = true;
  const SKY = new THREE.Color(0x0d0f14);
  const scene = new THREE.Scene();
  scene.background = SKY;
  const camera = new THREE.PerspectiveCamera(60, 16 / 10, 0.05, 60);
  const look = { yaw: 0, pitch: -0.17 };
  camera.position.set(0, 1.5, 0.8);
  camera.rotation.order = 'YXZ';

  // Everything the viewer sees hangs off `world`, so a session without a floor-level
  // reference space can shift the room down to eye level.
  const world = new THREE.Group();
  scene.add(world);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20222a, 1.4));
  const room = new THREE.Group();
  world.add(room);
  const grid = new THREE.GridHelper(12, 24, 0x39415a, 0x232838);
  grid.userData.noOcclude = true;
  room.add(grid);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x10131a }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.01;
  floor.userData.noOcclude = true;
  room.add(floor);

  // #region panels
  const surfaces = new HTMLSurfaces(renderer, camera, { scene });
  const PX = 600; // CSS px per metre
  const panels = [];
  function panel(el, pos, rot) {
    const w = el.offsetWidth / PX, h = el.offsetHeight / PX;
    const group = new THREE.Group();
    group.position.set(...pos);
    group.rotation.order = 'YXZ';
    group.rotation.set(...rot);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ toneMapped: false }));
    const back = new THREE.Mesh(new THREE.BoxGeometry(w + 0.03, h + 0.03, 0.012), new THREE.MeshBasicMaterial({ color: 0x2c3242 }));
    back.position.z = -0.008;
    group.add(back, mesh);
    world.add(group);
    const p = { el, group, mesh, surface: surfaces.add(el, mesh), w, h };
    panels.push(p);
    return p;
  }
  // #endregion panels
  const P = {
    form: panel($('p-form'), [0, 1.5, -1.2], [0, 0, 0]),
    log: panel($('p-log'), [-0.98, 1.5, -0.9], [0, 0.72, 0]),
    stats: panel($('p-stats'), [0.98, 1.5, -0.9], [0, -0.72, 0]),
    keys: panel($('p-keys'), [0, 0.97, -0.9], [-0.7, 0, 0]),
  };
  uis.remove();

  function resize() {
    if (renderer.xr.isPresenting) return;
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w < h ? 0.15 : 0.8; // a narrow screen stands closer so the form is big enough to tap
    camera.updateProjectionMatrix();
    surfaces.invalidate();
  }
  new ResizeObserver(resize).observe(stage);
  resize();

  // Preview: drag empty space to look around.
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.target !== canvas || renderer.xr.isPresenting) return;
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    look.yaw += (e.clientX - dragging.x) * 0.004;
    look.pitch = Math.max(-1.1, Math.min(0.9, look.pitch + (e.clientY - dragging.y) * 0.004));
    dragging.x = e.clientX;
    dragging.y = e.clientY;
  });
  // Keyboard focus turns the preview camera to the panel that has it.
  let byKeyboard = false;
  window.addEventListener('keydown', (e) => { if (e.key === 'Tab') byKeyboard = true; }, true);
  window.addEventListener('pointerdown', () => (byKeyboard = false), true);
  canvas.addEventListener('focusin', (e) => {
    if (!byKeyboard || renderer.xr.isPresenting) return;
    const p = panels.find((q) => q.el.contains(e.target));
    if (p) look.yaw = Math.atan2(-p.group.position.x, -p.group.position.z) * 0.8;
  });
  const drop = (e) => { if (dragging?.id === e.pointerId) dragging = null; };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);

  // --------------------------------------------------------------------- rays
  const raycaster = new THREE.Raycaster();
  const _rot = new THREE.Matrix4();
  const info = { selects: 0, clicks: 0, lastTarget: '', via: '', forced: 0, layer: 'off', sources: '' };
  const describe = (el) => (el ? `<${el.localName}${el.id ? '#' + el.id : ''}${el.dataset?.key ? ' ' + el.dataset.key : ''}>` : 'nothing');

  // #region rays
  const rays = [0, 1].map((i) => {
    const c = renderer.xr.getController(i);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0x7ad7ff }),
    );
    line.userData.noOcclude = true;
    line.visible = false;
    c.add(line);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true }));
    dot.renderOrder = 10;
    dot.userData.noOcclude = true;
    dot.visible = false;
    scene.add(dot);
    scene.add(c);
    const r = { c, line, dot, ptr: surfaces.createRayPointer(i), source: null, grabbed: null };
    c.addEventListener('connected', (e) => {
      r.source = e.data;
      line.visible = e.data.targetRayMode === 'tracked-pointer';
    });
    c.addEventListener('disconnected', () => {
      r.source = null;
      line.visible = dot.visible = false;
    });
    c.addEventListener('selectstart', () => {
      aim(r);
      r.ptr.down();
      info.selects++;
      dot.material.color.set(0xff7a4d);
    });
    c.addEventListener('selectend', () => {
      aim(r);
      const target = r.ptr.up();
      dot.material.color.set(0xffffff);
      if (target) {
        info.clicks++;
        info.lastTarget = describe(target);
      }
    });
    // Squeeze to pick a panel up and put it somewhere else.
    c.addEventListener('squeezestart', () => {
      aim(r);
      const p = r.ptr.hit && panels.find((q) => q.surface === r.ptr.hit.surface);
      if (!p) return;
      c.attach(p.group);
      r.grabbed = p;
    });
    c.addEventListener('squeezeend', () => {
      if (r.grabbed) world.attach(r.grabbed.group);
      r.grabbed = null;
    });
    return r;
  });
  // #endregion rays

  // #region rays
  function setRay(origin, direction) {
    raycaster.ray.origin.copy(origin);
    raycaster.ray.direction.copy(direction).normalize();
  }
  // #endregion rays
  // #region rays
  function aim(r) {
    r.c.updateMatrixWorld(true);
    _rot.extractRotation(r.c.matrixWorld);
    setRay(new THREE.Vector3().setFromMatrixPosition(r.c.matrixWorld), new THREE.Vector3(0, 0, -1).applyMatrix4(_rot));
    const hit = r.ptr.move(raycaster);
    if (r.ptr.where) info.via = r.ptr.where.via;
    r.dot.visible = !!hit;
    if (hit) r.dot.position.copy(hit.point);
    r.line.scale.z = hit ? hit.distance : 3;
    return hit;
  }
  // #endregion rays

  // ------------------------------------------------------------------ session
  let session = null, sess = null;
  async function enter(mode) {
    if (session) return session.end();
    const wantLayer = $('opt-layer').checked;
    try {
      const s = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking', ...(wantLayer ? ['layers'] : [])] });
      let space = 'local-floor';
      try {
        await s.requestReferenceSpace('local-floor');
      } catch {
        space = 'local';
      }
      renderer.xr.setReferenceSpaceType(space);
      world.position.y = space === 'local' ? -1.5 : 0;
      const ar = mode === 'immersive-ar';
      scene.background = ar ? null : SKY;
      room.visible = !ar;
      await renderer.xr.setSession(s);
      session = s;
      sess = { mode, space, t0: performance.now(), paints0: surfaces.stats.paints, frames: 0, lastPaint: performance.now(), lastSeen: surfaces.stats.paints, checked: false, wantLayer };
      surfaces.flat = true; // elements side by side in the canvas box; rays index into that layout
      $('x-mode').textContent = `${mode}${device ? ' (emulated)' : ''}`;
      showEmuBar(true);
      s.addEventListener('end', () => {
        for (const r of rays) {
          if (r.grabbed) world.attach(r.grabbed.group);
          r.grabbed = null;
          r.line.visible = r.dot.visible = false;
        }
        dropLayer();
        session = sess = null;
        surfaces.flat = false;
        world.position.y = 0;
        scene.background = SKY;
        room.visible = true;
        $('x-mode').textContent = 'page';
        showEmuBar(false);
        // The emulator moves the canvas out of the page and back; size it again once it is home.
        setTimeout(resize, 50);
        setTimeout(resize, 400);
      });
    } catch (err) {
      xrStatus.textContent = `Could not start ${mode}: ${err.message}`;
    }
  }
  $('enter-vr').addEventListener('click', () => enter('immersive-vr'));
  $('enter-ar').addEventListener('click', () => enter('immersive-ar'));

  // Emulated controller: the pointer aims it, pressing pulls the trigger. Real pointer events
  // must not also reach the flat-laid-out elements under the canvas, so they stop here.
  let emuBar = null;
  function showEmuBar(on) {
    if (!device) return;
    if (!emuBar) {
      emuBar = document.createElement('div');
      emuBar.className = 'emu-bar';
      emuBar.innerHTML = '<button data-turn="1" aria-label="Turn left">◀</button><button data-turn="-1" aria-label="Turn right">▶</button><span>Point to aim, press for trigger</span><button data-exit>Exit</button>';
      emuBar.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.exit !== undefined) return session?.end();
        emu.yaw += Number(b.dataset.turn) * 0.35;
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), emu.yaw);
        device.quaternion.set(q.x, q.y, q.z, q.w);
        emuAim(emu.last);
      });
      document.body.append(emuBar);
    }
    emuBar.hidden = !on;
    if (on) {
      emu.yaw = 0;
      device.quaternion.set(0, 0, 0, 1);
      device.controllers.left?.position.set(-0.25, 1.1, -0.2);
      emuAim(null);
    }
  }
  const emu = { yaw: 0, last: null, downAt: 0 };
  const emuCaster = new THREE.Raycaster();
  function emuAim(e) {
    const right = device.controllers.right;
    if (!right) return;
    emu.last = e;
    const rect = canvas.getBoundingClientRect();
    const half = stereo ? rect.width / 2 : rect.width;
    let nx = 0, ny = -0.1;
    if (e) {
      let x = e.clientX - rect.left;
      if (stereo && x > half) x -= half;
      nx = (x / half) * 2 - 1;
      ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    }
    const t = Math.tan((device.fovy ?? Math.PI / 2) / 2);
    const headQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), emu.yaw);
    const head = new THREE.Vector3(0, 1.6, 0);
    // Aim at whatever the eye sees under the pointer, so the hand's ray lands where you point.
    const dir = new THREE.Vector3(nx * t * (half / rect.height), ny * t, -1).applyQuaternion(headQ).normalize();
    emuCaster.set(head, dir);
    const seen = emuCaster.intersectObjects(panels.map((p) => p.mesh), false)[0];
    const target = seen ? seen.point : dir.multiplyScalar(1.4).add(head);
    const hand = new THREE.Vector3(0.2, -0.3, -0.25).applyQuaternion(headQ).add(head);
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(hand, target, new THREE.Vector3(0, 1, 0)));
    right.position.set(hand.x, hand.y, hand.z);
    right.quaternion.set(q.x, q.y, q.z, q.w);
  }
  if (device) {
    const swallow = (e) => {
      if (!session || !e.isTrusted || !canvas.contains(e.target)) return;
      if (e.type === 'pointermove' || e.type === 'pointerdown') emuAim(e);
      if (e.type === 'pointerdown') {
        device.controllers.right?.updateButtonValue('trigger', 1);
        emu.downAt = performance.now();
      }
      // A tap is down and up in one frame. Hold the trigger long enough for the runtime to see it.
      if (e.type === 'pointerup' || e.type === 'pointercancel') {
        setTimeout(() => device.controllers.right?.updateButtonValue('trigger', 0), Math.max(0, 120 - (performance.now() - emu.downAt)));
      }
      if (e.type === 'wheel') for (const r of rays) r.ptr.scroll(e.deltaX, e.deltaY);
      e.stopPropagation();
      e.preventDefault();
    };
    for (const type of ['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'touchstart', 'touchend', 'wheel', 'contextmenu']) {
      window.addEventListener(type, swallow, { capture: true, passive: false });
    }
  }

  // ------------------------------------------------- experimental: XR quad layer
  // The compositor draws a quad layer at the display's own resolution, so text stays sharp.
  // The layer sits under the scene and the panel's mesh punches a hole through to it.
  let layer = null;
  const hole = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, blending: THREE.NoBlending });
  function dropLayer() {
    if (!layer) return;
    P.form.mesh.material = layer.material;
    const gl = renderer.getContext();
    gl.deleteFramebuffer(layer.read);
    gl.deleteFramebuffer(layer.draw);
    layer = null;
  }
  function makeLayer() {
    const gl = renderer.getContext();
    if (!session.renderState.layers) throw new Error('this session has no layers support');
    let binding = renderer.xr.getBinding?.();
    if (!binding?.createQuadLayer) binding = new XRWebGLBinding(session, gl);
    if (!binding.createQuadLayer) throw new Error('XRWebGLBinding has no createQuadLayer here');
    const s = P.form.surface;
    const quad = binding.createQuadLayer({
      space: renderer.xr.getReferenceSpace(), viewPixelWidth: s.width, viewPixelHeight: s.height,
      width: P.form.w / 2, height: P.form.h / 2, layout: 'mono', colorFormat: gl.SRGB8_ALPHA8,
    });
    session.updateRenderState({ layers: [quad, ...session.renderState.layers] });
    layer = { quad, binding, read: gl.createFramebuffer(), draw: gl.createFramebuffer(), uploads: -1, blits: 0, material: P.form.mesh.material };
    P.form.mesh.material = hole;
    info.layer = 'quad layer created';
  }
  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  function drawLayer(frame) {
    const s = P.form.surface;
    P.form.mesh.updateWorldMatrix(true, false);
    P.form.mesh.matrixWorld.decompose(_p, _q, _s);
    layer.quad.transform = new XRRigidTransform({ x: _p.x, y: _p.y, z: _p.z }, { x: _q.x, y: _q.y, z: _q.z, w: _q.w });
    if (!s.glTexture || (!layer.quad.needsRedraw && layer.uploads === s.uploads)) return;
    const gl = renderer.getContext();
    const sub = layer.binding.getSubImage(layer.quad, frame);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, layer.read);
    gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, s.glTexture, 0);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, layer.draw);
    gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sub.colorTexture, 0);
    gl.disable(gl.SCISSOR_TEST);
    gl.blitFramebuffer(0, 0, s.width, s.height, 0, 0, sub.textureWidth ?? s.width, sub.textureHeight ?? s.height, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    const err = gl.getError();
    renderer.resetState();
    renderer.setRenderTarget(renderer.getRenderTarget());
    if (err) throw new Error(`WebGL error 0x${err.toString(16)} copying into the layer`);
    layer.uploads = s.uploads;
    layer.blits++;
    info.layer = `quad layer, ${layer.blits} copies`;
  }

  // ------------------------------------------------------------ in-session checks
  const frames = (n) => new Promise((resolve) => waiters.push({ n, resolve }));
  const waiters = [];
  async function sessionChecks() {
    const mine = sess;
    const tbody = $('session-results');
    tbody.replaceChildren();
    const clock = $('x-clock');
    const tests = [
      {
        name: 'paint events keep arriving during the session',
        why: 'The page itself is not on screen in a headset. Does the browser still paint the canvas children?',
        timeout: 8000,
        run: async () => {
          const before = surfaces.stats.paints;
          clock.textContent = `check ${Math.random().toString(36).slice(2, 6)}`;
          await frames(40);
          const n = surfaces.stats.paints - before;
          if (!n) throw new Error('no paint event in 40 XR frames after a DOM change');
          return `${n} paint events in 40 XR frames`;
        },
      },
      {
        name: 'a DOM change reaches the texture',
        why: 'Either through paint, or by uploading from the last paint record on every few frames.',
        timeout: 8000,
        run: async () => {
          const s = P.form.surface, before = s.uploads, forced = info.forced;
          clock.textContent = `check ${Math.random().toString(36).slice(2, 6)}`;
          await frames(40);
          if (s.uploads === before) throw new Error(`no upload. Last error: ${surfaces.stats.lastError ?? 'none'}`);
          return info.forced > forced ? `uploaded by the forced fallback (${info.forced - forced} forced)` : `${s.uploads - before} uploads driven by paint`;
        },
      },
      {
        name: 'elementFromPoint answers for panel content',
        why: 'Rays are mapped into a flat layout of the elements and the browser is asked what is there.',
        run: async () => {
          const c = centre($('x-send'), P.form.el);
          const where = surfaces.elementAt(P.form.surface, c.x, c.y);
          if (where.via !== 'elementFromPoint') throw new Error(`fell back to walking bounding rects, found ${describe(where.target)}`);
          if (where.target !== $('x-send')) throw new Error(`found ${describe(where.target)}`);
          return `found ${describe(where.target)}`;
        },
      },
      {
        name: 'the session has an input source with a ray',
        why: 'Controllers, hands, gaze or screen taps. A phone only has one while a finger is down.',
        run: async () => {
          const list = [...session.inputSources].map((s) => `${s.handedness} ${s.targetRayMode}`);
          if (!list.length) throw new Error(info.selects ? `none right now, but ${info.selects} select events so far` : 'none yet');
          return list.join(', ');
        },
      },
    ];
    if (mine.wantLayer) {
      tests.push({
        name: 'the form as an XR quad layer',
        why: 'Composited by the headset at native resolution, with the mesh as a hole in the scene.',
        timeout: 8000,
        run: async () => {
          makeLayer();
          await frames(30);
          if (info.layer.startsWith('failed')) throw new Error(info.layer);
          if (!layer?.blits) throw new Error('layer created but nothing was copied into it');
          return info.layer;
        },
      });
    }
    const results = await runTests(tbody, tests);
    const ul = $('x-checks');
    ul.replaceChildren(...results.map((r) => {
      const li = document.createElement('li');
      li.className = r.ok ? 'pass' : 'fail';
      li.textContent = `${r.name}: ${r.detail}`;
      return li;
    }));
    window.__sessionResults = results;
  }

  // Where is an element's centre, in its panel's own CSS pixels?
  function centre(el, root, fx = 0.5, fy = 0.5) {
    let x = el.offsetWidth * fx, y = el.offsetHeight * fy;
    for (let n = el; n && n !== root; n = n.offsetParent) {
      x += n.offsetLeft - (n.offsetParent && n.offsetParent !== root ? n.offsetParent.scrollLeft : 0);
      y += n.offsetTop - (n.offsetParent && n.offsetParent !== root ? n.offsetParent.scrollTop : 0);
      if (n.offsetParent && !root.contains(n.offsetParent)) break;
    }
    return { x, y };
  }

  // --------------------------------------------------------------------- loop
  const statsEl = $('x-stats');
  let lastStats = 0, lastStatsText = '', lastClock = '';
  function writeStats(now) {
    const st = surfaces.stats;
    const rows = [
      ['mode', sess ? `${sess.mode}${device ? ' (emulated)' : ''}, ${sess.space}` : 'page preview'],
      ['input', sess ? info.sources || 'none yet' : 'mouse / touch (native)'],
      ['paints', sess ? `${st.paints - sess.paints0} in session (${((st.paints - sess.paints0) / Math.max(1, (now - sess.t0) / 1000)).toFixed(1)}/s)` : `${st.paints}`],
      ['uploads', `${st.uploads}${info.forced ? `, ${info.forced} forced` : ''}`],
      ['hit test', info.via || 'native'],
      ['ray clicks', `${info.clicks}${info.lastTarget ? ` last ${info.lastTarget}` : ''}`],
      ['layer', info.layer],
      ['error', st.lastError ?? 'none'],
    ];
    const text = rows.map((r) => r.join('\t')).join('\n');
    if (text === lastStatsText) return;
    lastStatsText = text;
    statsEl.replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement('dt'), dd = document.createElement('dd');
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }));
  }

  let blankProbe = null;
  const context = watchContext(canvas, stage);
  window.__xr = { stereo, surfaces, P, panels, rays, info, camera, scene, renderer, device, enter, get session() { return session; } };

  renderer.setAnimationLoop((time, frame) => {
    const now = performance.now();
    if (!renderer.xr.isPresenting) camera.rotation.set(look.pitch, look.yaw, 0);
    surfaces.update();

    if (sess) {
      sess.frames++;
      for (const w of waiters) w.n--;
      for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].n <= 0) waiters.splice(i, 1)[0].resolve();
      info.sources = [...session.inputSources].map((s) => `${s.handedness[0]}:${s.targetRayMode}`).join(' ');
      for (const r of rays) {
        if (!r.source || !r.c.visible) { r.dot.visible = false; continue; }
        aim(r);
        const gp = r.source.gamepad;
        const y = gp ? (gp.axes[3] ?? gp.axes[1] ?? 0) : 0;
        if (Math.abs(y) > 0.15) r.ptr.scroll(0, y * 14);
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
      if (layer && frame) {
        try {
          drawLayer(frame);
        } catch (err) {
          info.layer = `failed: ${err.message}`;
          dropLayer();
        }
      }
      if (!sess.checked && now - sess.t0 > 2000) {
        sess.checked = true;
        sessionChecks();
      }
    }

    const clock = new Date().toLocaleTimeString();
    if (clock !== lastClock && !$('x-clock').textContent.startsWith('check')) $('x-clock').textContent = lastClock = clock;
    else if (clock !== lastClock) lastClock = clock, setTimeout(() => ($('x-clock').textContent = clock), 1500);
    if (now - lastStats > 300) {
      lastStats = now;
      writeStats(now);
      hud.textContent = `${sess ? sess.mode : 'preview'} · ${surfaces.stats.paints} paints · ${surfaces.stats.uploads} uploads${surfaces.stats.lastError ? ' · ' + surfaces.stats.lastError : ''}`;
    }
    renderer.render(scene, camera);
    if (blankProbe) {
      blankProbe(sampleGL(renderer.getContext()));
      blankProbe = null;
    }
  });

  // ------------------------------------------------------------ live checks
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 3000) => {
    const t = performance.now();
    while (performance.now() - t < ms) {
      if (fn()) return true;
      await wait(50);
    }
    return false;
  };
  // Aim a hand-held ray at a spot on a panel, the way a controller would.
  const testPtr = surfaces.createRayPointer(9);
  function rayAt(p, el, fx = 0.5, fy = 0.5) {
    const c = centre(el, p.el, fx, fy);
    const target = p.mesh.localToWorld(new THREE.Vector3((c.x / p.el.offsetWidth - 0.5) * p.w, (0.5 - c.y / p.el.offsetHeight) * p.h, 0));
    const origin = new THREE.Vector3(0.2, 1.25, 0.1);
    setRay(origin, target.sub(origin));
    testPtr.move(raycaster);
    return testPtr.where;
  }
  function rayClick(p, el, fx, fy) {
    const where = rayAt(p, el, fx, fy);
    testPtr.down();
    testPtr.up();
    return where;
  }
  function rayAway() {
    setRay(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(0, 1, 0));
    testPtr.move(raycaster);
  }
  const onScreen = async () => {
    const y = scrollY;
    stage.scrollIntoView({ block: 'start' });
    await wait(60);
    surfaces.update();
    return () => scrollTo(0, y);
  };
  const key = (k) => keys.querySelector(`[data-key="${k}"]`);

  if (!isFixture) {
    // The checks focus fields and type, so they run on a hidden copy of this page.
    await mirror($('results'), runTests, {
      query: params.has('emulate') ? '&emulate=1' : '',
      extra: [{
        name: 'The scene on this page is not blank',
        why: 'Read back from the canvas on this page, not the hidden copy. Fails if it is one flat colour or its graphics context is gone.',
        run: async () => {
          if (context.lost()) throw new Error('the WebGL context is lost');
          const n = await new Promise((resolve) => (blankProbe = resolve));
          if (n < 3) throw new Error(`only ${n} colour${n === 1 ? '' : 's'} across the whole canvas`);
          return `${n} different colours across a 7×7 grid of samples`;
        },
      }],
    });
    window.__ready = true;
    return;
  }
  await until(() => surfaces.stats.uploads >= panels.length);
  const tests = [
    {
      name: 'four panels are live textures',
      why: 'Each panel is an element inside the canvas, uploaded with texElementSubImage2D on paint.',
      run: async () => {
        if (surfaces.stats.lastError) throw new Error(surfaces.stats.lastError);
        const before = P.stats.surface.uploads;
        $('x-mode').textContent = 'page ';
        if (!(await until(() => P.stats.surface.uploads > before))) throw new Error('a DOM change did not re-upload the panel');
        $('x-mode').textContent = 'page';
        return `${panels.map((p) => `${p.surface.width}×${p.surface.height}`).join(', ')} px, ${surfaces.stats.uploads} uploads`;
      },
    },
    {
      name: 'the page preview uses native hit testing',
      why: 'No session: the browser hit tests the perspective quads itself, for mouse and touch.',
      run: async () => {
        const back = await onScreen();
        const r = $('x-send').getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        back();
        if (el !== $('x-send')) throw new Error(`elementFromPoint found ${describe(el)}`);
        return `button is ${Math.round(r.width)}×${Math.round(r.height)} on screen and clickable`;
      },
    },
    {
      name: 'a ray becomes a click',
      why: 'What a controller trigger does in a session: raycast, UV to element pixels, synthetic pointer events.',
      run: async () => {
        const back = await onScreen();
        const was = F.shout.checked;
        const where = rayClick(P.form, F.shout);
        back();
        const now = F.shout.checked;
        F.shout.checked = was;
        if (where?.target !== F.shout) throw new Error(`the ray found ${describe(where?.target)}`);
        if (now === was) throw new Error('the checkbox did not toggle');
        return `ray hit ${describe(where.target)} via ${where.via}, checkbox toggled`;
      },
    },
    {
      name: 'a ray drags a slider',
      why: 'Synthetic events cannot move a range thumb, so the ray pointer sets the value from its position.',
      run: async () => {
        const back = await onScreen();
        rayAt(P.form, F.size, 0.85);
        testPtr.down();
        const a = F.size.value;
        rayAt(P.form, F.size, 0.25);
        const b = F.size.value;
        testPtr.up();
        back();
        F.size.value = 5;
        F.size.dispatchEvent(new Event('input', { bubbles: true }));
        if (!(Number(a) >= 7 && Number(b) <= 4)) throw new Error(`values were ${a} then ${b}`);
        return `value ${a} at 85%, ${b} after dragging to 25%`;
      },
    },
    {
      name: 'the on-panel keyboard types at the caret',
      why: 'Keys cancel mousedown so focus stays in the field. Text goes in with setRangeText().',
      run: async () => {
        const back = await onScreen();
        const was = F.name.value;
        rayClick(P.form, F.name);
        const focused = document.activeElement === F.name;
        F.name.setSelectionRange(F.name.value.length, F.name.value.length);
        rayClick(P.keys, key('x'));
        rayClick(P.keys, key('r'));
        const typed = F.name.value, still = document.activeElement === F.name;
        rayClick(P.keys, key('back'));
        const after = F.name.value;
        back();
        F.name.value = was;
        if (!focused) throw new Error('the ray did not focus the field');
        if (typed !== was + 'xr') throw new Error(`value was "${typed}"`);
        if (!still) throw new Error(`focus moved to ${describe(document.activeElement)}`);
        if (after !== was + 'x') throw new Error(`backspace left "${after}"`);
        return `typed "xr" into "${was}", backspace removed one, focus never left the field`;
      },
    },
    {
      name: 'Enter on the keyboard submits the form',
      why: 'requestSubmit() runs the form\'s real submit path, validation included.',
      run: async () => {
        const back = await onScreen();
        const before = entries;
        rayClick(P.form, F.name);
        rayClick(P.keys, key('enter'));
        back();
        if (entries !== before + 1) throw new Error('no guest book entry appeared');
        list.firstElementChild.remove();
        entries--;
        $('x-count').textContent = `${list.children.length} entries`;
        return 'a guest book entry appeared on the other panel';
      },
    },
    {
      name: 'a ray scrolls a list',
      why: 'A thumbstick has no wheel event, so the ray pointer scrolls the nearest scrollable ancestor.',
      run: async () => {
        const back = await onScreen();
        list.scrollTop = 0;
        rayAt(P.log, list);
        const el = testPtr.scroll(0, 80);
        const top = list.scrollTop;
        list.scrollTop = 0;
        back();
        if (el !== list || top < 40) throw new Error(`scrolled ${describe(el)} to ${top}`);
        return `guest book scrolled ${top}px`;
      },
    },
    {
      name: 'immersive-vr is available here',
      why: 'A headset, Cardboard on Android, or the emulator.',
      run: async () => {
        if (!modes['immersive-vr'].ok) throw new Error(modes['immersive-vr'].why);
        return device ? 'emulated Quest 3 (IWER)' : 'supported';
      },
    },
    {
      name: 'immersive-ar is available here',
      why: 'An Android phone with ARCore, or a passthrough headset.',
      run: async () => {
        if (!modes['immersive-ar'].ok) throw new Error(modes['immersive-ar'].why);
        return device ? 'emulated Quest 3 (IWER)' : 'supported';
      },
    },
  ];
  await runTests($('results'), publish(tests));
  rayAway();
  document.activeElement?.blur?.();
  window.__ready = true;
}
