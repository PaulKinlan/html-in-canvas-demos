// #region setup
import * as THREE from 'three';
import { HTMLSurfaces, installThreeShims, support } from '/lib/html3d.js';
// #endregion setup
import { banner, nav, runTests } from '/shared/support.js';
import { isFixture, mirror, publish, sampleGL, watchContext } from '/lib/check-fixture.js';

nav('/three-form/');
banner();

const useGPU = window.__gpu;
document.getElementById(useGPU ? 'r-webgpu' : 'r-webgl').setAttribute('aria-current', 'true');
const $ = (id) => document.getElementById(id);
// #region setup
const canvas = $('scene');
// #endregion setup
const hud = $('hud');

// ------------------------------------------------------------------ renderer
// Remember what the browser had before any shim, for the report below.
const native = { texElementImage2D: 'texElementImage2D' in WebGL2RenderingContext.prototype, copyElementImageToTexture: typeof GPUQueue !== 'undefined' && 'copyElementImageToTexture' in GPUQueue.prototype };
// #region setup
let renderer, backendName;
if (useGPU) {
  installThreeShims();
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  backendName = renderer.backend.isWebGPUBackend ? 'three WebGPURenderer (WebGPU)' : 'three WebGPURenderer (fell back to WebGL2)';
} else {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  backendName = 'three WebGLRenderer';
}
// #endregion setup
renderer.setPixelRatio(isFixture ? 1 : Math.min(devicePixelRatio, 2)); // the hidden copy that runs the checks stays cheap
let deviceLost = '';
renderer.backend?.device?.lost.then((info) => (deviceLost = `WebGPU device lost: ${info.message || info.reason}`));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f14);
scene.fog = new THREE.Fog(0x0d0f14, 14, 30);
const camera = new THREE.PerspectiveCamera(50, 16 / 10, 0.05, 80);

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20222a, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(3, 6, 4);
scene.add(sun);

const grid = new THREE.GridHelper(40, 40, 0x39415a, 0x1c2130);
grid.userData.noOcclude = true;
scene.add(grid);

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.1, ...extra });
const screenMat = () => new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const box = (w, h, d, material, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  return m;
};

// Desk
const desk = new THREE.Group();
desk.add(box(1.5, 0.04, 0.7, mat(0x6b4a32), 0, 0.73, 0));
for (const [x, z] of [[-0.7, -0.3], [0.7, -0.3], [-0.7, 0.3], [0.7, 0.3]]) desk.add(box(0.04, 0.71, 0.04, mat(0x23262e), x, 0.355, z));
scene.add(desk);

// Laptop: 640x400 screen, hinged lid.
const laptop = new THREE.Group();
laptop.position.set(0, 0.75, 0.02);
laptop.add(box(0.36, 0.014, 0.25, mat(0xb9bec8, { metalness: 0.6, roughness: 0.35 }), 0, 0.007, 0));
laptop.add(box(0.3, 0.002, 0.11, mat(0x2a2d35), 0, 0.0145, -0.04));
const lid = new THREE.Group();
lid.position.set(0, 0.014, -0.125);
lid.add(box(0.36, 0.235, 0.008, mat(0xb9bec8, { metalness: 0.6, roughness: 0.35 }), 0, 0.1175, -0.004));
const laptopScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.2125), screenMat());
laptopScreen.position.set(0, 0.1175, 0.0006);
lid.add(laptopScreen);
laptop.add(lid);
scene.add(laptop);
const setLid = (deg) => (lid.rotation.x = -THREE.MathUtils.degToRad(deg - 90));
setLid(108);

// Billboard: 960x420, far away and turned.
const billboard = new THREE.Group();
billboard.position.set(2.8, 0, -8.5);
billboard.rotation.y = -0.3;
const BW = 6, BH = (6 * 420) / 960;
const billboardScreen = new THREE.Mesh(new THREE.PlaneGeometry(BW, BH), screenMat());
billboardScreen.position.set(0, 3.4, 0.06);
billboard.add(billboardScreen);
billboard.add(box(BW + 0.3, BH + 0.3, 0.1, mat(0x1b1e26), 0, 3.4, 0));
billboard.add(box(0.18, 3.4, 0.18, mat(0x30343f), -2, 1.0, -0.1));
billboard.add(box(0.18, 3.4, 0.18, mat(0x30343f), 2, 1.0, -0.1));
scene.add(billboard);

// Curved wall: 1800x520 on a 100 degree arc. Built by hand so the UV mapping is explicit.
const ARC = THREE.MathUtils.degToRad(100), R = 3.4, WH = (R * ARC * 520) / 1800, WY = 0.5;
const wallPoint = (u, v, target = new THREE.Vector3()) => {
  const t = (u - 0.5) * ARC;
  return target.set(R * Math.sin(t), WY + v * WH, -R * Math.cos(t));
};
function arcGeometry(segments = 48) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    for (const v of [0, 1]) {
      const p = wallPoint(u, v);
      pos.push(p.x, p.y, p.z);
      uv.push(u, v);
    }
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, c, d, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const wall = new THREE.Group();
wall.position.set(-0.6, 0, 1.6);
wall.rotation.y = THREE.MathUtils.degToRad(62);
const wallScreen = new THREE.Mesh(arcGeometry(), screenMat());
wall.add(wallScreen);
const backing = new THREE.Mesh(arcGeometry(), mat(0x1b1e26, { side: THREE.BackSide }));
backing.scale.set(1.01, 1, 1.01);
backing.userData.noOcclude = true;
wall.add(backing);
scene.add(wall);

// A drone that can get in the way.
const drone = new THREE.Group();
drone.add(box(0.09, 0.03, 0.09, mat(0xffc400, { emissive: 0x332200 })));
for (const [x, z] of [[-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]]) {
  const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.004, 20), mat(0x222222));
  rotor.position.set(x, 0.02, z);
  drone.add(rotor);
}
drone.visible = false;
scene.add(drone);

// ------------------------------------------------------------------ surfaces
// #region setup
const surfaces = new HTMLSurfaces(renderer, camera, { scene });
const S = {};
if (support.paint) {
  S.laptop = surfaces.add($('laptop-ui'), laptopScreen);
  S.billboard = surfaces.add($('billboard-ui'), billboardScreen);
  S.wall = surfaces.add($('wall-ui'), wallScreen, { hit: 'mesh' });
  $('uis').hidden = true;
} else {
  for (const m of [laptopScreen, billboardScreen, wallScreen]) m.material.color.set(0x2a2f3c);
}
// #endregion setup

// ------------------------------------------------------------------ the documents talk to each other
const form = $('laptop-ui'), bb = $('billboard-ui');
function syncBillboard() {
  $('b-msg').textContent = $('f-msg').value || ' ';
  $('b-name').textContent = $('f-name').value || 'someone';
  $('b-msg').style.fontSize = `${$('f-size').value}px`;
  $('f-size-out').textContent = $('f-size').value;
  bb.style.setProperty('--ink', $('f-color').value);
  bb.classList.toggle('glow', $('f-glow').checked);
}
form.addEventListener('input', syncBillboard);
form.addEventListener('change', syncBillboard);
syncBillboard();
let posts = 0;
function post(name, msg) {
  const tr = document.createElement('tr');
  tr.className = 'new';
  for (const text of [String(++posts), name, msg, new Date().toLocaleTimeString([], { hour12: false })]) {
    const td = document.createElement('td');
    td.textContent = text;
    tr.append(td);
  }
  $('w-rows').prepend(tr);
  filterRows();
}
form.addEventListener('submit', (e) => {
  e.preventDefault();
  post($('f-name').value, $('f-msg').value);
});
let likes = 0;
$('b-like').addEventListener('click', () => ($('b-likes').textContent = String(++likes)));
function filterRows() {
  const q = $('w-filter').value.toLowerCase();
  for (const tr of $('w-rows').children) tr.hidden = q && !tr.textContent.toLowerCase().includes(q);
}
$('w-filter').addEventListener('input', filterRows);
$('w-hue').addEventListener('input', (e) => $('wall-ui').style.setProperty('--hue', e.target.value));
const animate = () => $('w-bars').classList.toggle('on', $('w-anim').checked);
$('w-anim').addEventListener('change', animate);
animate();
for (const [n, m] of [['Grace', 'Compiled on the first try.'], ['Linus', 'Just a hobby, nothing big.'], ['Tim', 'Vague, but exciting.'], ['Margaret', 'There was no second chance.'], ['Alan', 'The best way to predict the future is to invent it.'], ['Radia', 'Bridges, mostly.'], ['Ken', 'When in doubt, use brute force.'], ['Barbara', 'Abstraction matters.'], ['Edsger', 'Simplicity is a prerequisite for reliability.'], ['Donald', 'Premature optimisation, you know the rest.'], ['Hedy', 'Hop frequencies, not conclusions.'], ['Dennis', 'C is quirky, flawed, and an enormous success.'], ['Frances', 'Compilers are how machines learn manners.'], ['Vint', 'Packets find a way.']]) post(n, m);
const tick = () => ($('clock').textContent = new Date().toLocaleTimeString([], { hour12: false }));
setInterval(tick, 1000);
tick();

// ------------------------------------------------------------------ camera
const VIEWS = {
  overview: { pos: [1.5, 1.9, 4.6], target: [0.35, 1.45, -1.5] },
  laptop: { pos: [0.04, 1.0, 0.5], target: [0, 0.87, -0.1] },
  billboard: { pos: [0.6, 1.5, -0.5], target: [2.8, 3.3, -8.5] },
  wall: { pos: wall.localToWorld(new THREE.Vector3(0, 1.4, 1.9)).toArray(), target: wall.localToWorld(wallPoint(0.5, 0.5)).toArray() },
};
const orbit = { target: new THREE.Vector3(), radius: 4, theta: 0, phi: 1.2 };
let tween = null;
function applyOrbit() {
  const { target, radius, theta, phi } = orbit;
  camera.position.set(target.x + radius * Math.sin(phi) * Math.sin(theta), target.y + radius * Math.cos(phi), target.z + radius * Math.sin(phi) * Math.cos(theta));
  camera.lookAt(target);
  camera.updateMatrixWorld();
}
function orbitFrom(pos, target) {
  const d = new THREE.Vector3().subVectors(pos, target);
  orbit.target.copy(target);
  orbit.radius = d.length();
  orbit.phi = Math.acos(THREE.MathUtils.clamp(d.y / orbit.radius, -1, 1));
  orbit.theta = Math.atan2(d.x, d.z);
}
let currentView = null;
function view(name, instant = false) {
  const v = VIEWS[name];
  currentView = name;
  const to = { pos: new THREE.Vector3(...v.pos), target: new THREE.Vector3(...v.target) };
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-pressed', String(b.dataset.view === name));
  if (instant) {
    tween = null;
    orbitFrom(to.pos, to.target);
    applyOrbit();
    return;
  }
  tween = { t0: performance.now(), from: { pos: camera.position.clone(), target: orbit.target.clone() }, to };
}
for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => view(b.dataset.view));
view('overview', true);

// Keyboard focus drives the camera. In the overview a text field is a few pixels tall, so
// tabbing into a document flies to the view where it can be read and its focus ring seen.
let byKeyboard = false;
window.addEventListener('keydown', (e) => { if (e.key === 'Tab') byKeyboard = true; }, true);
window.addEventListener('pointerdown', () => (byKeyboard = false), true);
canvas.addEventListener('focusin', (e) => {
  if (!byKeyboard) return;
  const name = Object.keys(S).find((k) => S[k].element.contains(e.target));
  if (name && VIEWS[name] && currentView !== name) view(name);
});

let dragging = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.target !== canvas) return; // presses on the documents belong to the documents
  dragging = { x: e.clientX, y: e.clientY };
  currentView = null;
  canvas.setPointerCapture(e.pointerId);
  canvas.style.cursor = 'grabbing';
  tween = null;
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  orbit.theta -= (e.clientX - dragging.x) * 0.005;
  orbit.phi = THREE.MathUtils.clamp(orbit.phi - (e.clientY - dragging.y) * 0.005, 0.15, Math.PI - 0.15);
  dragging = { x: e.clientX, y: e.clientY };
  applyOrbit();
});
const endDrag = () => {
  dragging = null;
  canvas.style.cursor = 'grab';
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
// Two fingers anywhere, including on a document, pinch the camera in and out.
const fingers = new Map();
let spread = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch') return;
  fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size === 2) { const [a, b] = [...fingers.values()]; spread = Math.hypot(a[0] - b[0], a[1] - b[1]); dragging = null; tween = null; }
}, true);
canvas.addEventListener('pointermove', (e) => {
  if (!fingers.has(e.pointerId)) return;
  fingers.set(e.pointerId, [e.clientX, e.clientY]);
  if (fingers.size !== 2) return;
  const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  if (spread > 0 && d > 0) { orbit.radius = THREE.MathUtils.clamp((orbit.radius * spread) / d, 0.2, 30); applyOrbit(); }
  spread = d;
  dragging = null;
}, true);
for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, (e) => fingers.delete(e.pointerId), true);
canvas.addEventListener('wheel', (e) => {
  if (e.target !== canvas) return; // let lists and text areas scroll themselves
  e.preventDefault();
  orbit.radius = THREE.MathUtils.clamp(orbit.radius * Math.exp(e.deltaY * 0.001), 0.2, 30);
  applyOrbit();
}, { passive: false });

$('lid').addEventListener('input', (e) => setLid(Number(e.target.value)));
$('drone').addEventListener('change', (e) => (drone.visible = e.target.checked));

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);
resize();

// ------------------------------------------------------------------ loop
let auto = true; // tests switch the drone and tween off
let hover = '';
canvas.addEventListener('pointermove', (e) => {
  const t = e.target;
  hover = t === canvas ? '' : `<${t.localName}${t.id ? '#' + t.id : ''}>`;
});
function frame(time) {
  if (tween) {
    const k = Math.min(1, (time - tween.t0) / 700), s = k * k * (3 - 2 * k);
    orbitFrom(new THREE.Vector3().lerpVectors(tween.from.pos, tween.to.pos, s), new THREE.Vector3().lerpVectors(tween.from.target, tween.to.target, s));
    applyOrbit();
    if (k === 1) tween = null;
  } else if ($('spin').checked && !dragging && auto) {
    orbit.theta += 0.0015;
    applyOrbit();
  }
  if (drone.visible && auto) {
    const t = time / 1400;
    laptopScreen.getWorldPosition(drone.position);
    drone.position.x += Math.sin(t) * 0.3;
    drone.position.y += Math.sin(t * 2.3) * 0.03;
    drone.position.z += 0.12;
    drone.rotation.y = t * 3;
  }
  // #region loop
  scene.updateMatrixWorld();
  surfaces.update();
  renderer.render(scene, camera);
  // #endregion loop
  if (blankProbe) {
    blankProbe(renderer.isWebGLRenderer ? sampleGL(renderer.getContext()) : -1);
    blankProbe = null;
  }
  const st = surfaces.stats;
  hud.textContent = `${backendName}\npaints ${st.paints}  uploads ${st.uploads}  geometry ${st.geometryUpdates}${hover ? `\nunder pointer: ${hover}` : ''}${st.lastError ? `\n${st.lastError}` : ''}${deviceLost ? `\n${deviceLost}` : ''}`;
}
let blankProbe = null;
const context = watchContext(canvas, $('stage'));
// #region loop
renderer.setAnimationLoop(frame);
// #endregion loop

// ------------------------------------------------------------------ live tests
const frames = (n = 2) => new Promise((resolve) => {
  const step = () => (n-- > 0 ? requestAnimationFrame(step) : resolve());
  step();
});
const until = async (fn, ms = 3000) => {
  const t0 = performance.now();
  while (!fn()) {
    if (performance.now() - t0 > ms) throw new Error('timed out waiting');
    await frames(1);
  }
};
/** Where a descendant of a document sits inside that document, in its own CSS px. */
function localBox(root, el) {
  let x = 0, y = 0;
  for (let n = el; n && n !== root; n = n.offsetParent) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const p = n.offsetParent;
    if (p && p !== root) { x += p.clientLeft - p.scrollLeft; y += p.clientTop - p.scrollTop; }
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}
const toWorld = {
  laptop: (u, v) => laptopScreen.localToWorld(new THREE.Vector3((u - 0.5) * 0.34, (v - 0.5) * 0.2125, 0)),
  billboard: (u, v) => billboardScreen.localToWorld(new THREE.Vector3((u - 0.5) * BW, (v - 0.5) * BH, 0)),
  wall: (u, v) => wallScreen.localToWorld(wallPoint(u, v)),
};
/** Client coordinates of a point inside `el`, worked out from the scene alone (not from DOM geometry). */
function clientPoint(key, el, fx = 0.5, fy = 0.5) {
  const root = S[key].element, b = localBox(root, el);
  const u = (b.x + b.w * fx) / root.offsetWidth, v = 1 - (b.y + b.h * fy) / root.offsetHeight;
  const p = toWorld[key](u, v).project(camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (1 - (p.y * 0.5 + 0.5)) * r.height };
}
const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
probe.canvas.width = probe.canvas.height = 1;
function renderedPixel(pt) {
  scene.updateMatrixWorld();
  renderer.render(scene, camera);
  const r = canvas.getBoundingClientRect();
  probe.clearRect(0, 0, 1, 1);
  probe.drawImage(canvas, ((pt.x - r.left) / r.width) * canvas.width, ((pt.y - r.top) / r.height) * canvas.height, 1, 1, 0, 0, 1, 1);
  return Array.from(probe.getImageData(0, 0, 1, 1).data.slice(0, 3));
}
const close = (a, b, tol = 40) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const name = (el) => (el ? `<${el.localName}${el.id ? '#' + el.id : ''}>` : 'nothing');
async function settle(pointer = null) {
  const box = $('stage').getBoundingClientRect();
  if (box.top < 56 || box.bottom > innerHeight) $('stage').scrollIntoView({ block: 'nearest' });
  surfaces.pointer = pointer;
  scene.updateMatrixWorld();
  surfaces.update();
  await frames(3);
}
async function expectHit(key, el, fx, fy, { tracked = true } = {}) {
  const pt = clientPoint(key, el, fx, fy);
  await settle(tracked ? pt : null);
  const got = document.elementFromPoint(pt.x, pt.y);
  if (got !== el && !el.contains(got)) throw new Error(`expected ${name(el)} at ${pt.x.toFixed(0)},${pt.y.toFixed(0)}, the browser hit ${name(got)}`);
  return pt;
}

// Hooks for scripted input tests.
window.__scene = { surfaces, S, camera, scene };
window.__touchTargets = () => ['w-anim', 'w-link', 'w-filter'].map((id) => ({ name: id, ...clientPoint('wall', $(id), 0.5, 0.5) }));

if (support.paint && !isFixture) {
  // The checks fly the camera around and focus fields, so they run on a hidden copy of this page.
  await mirror($('results'), runTests, {
    query: useGPU ? '&renderer=webgpu' : '',
    extra: [{
      name: 'The scene on this page is not blank',
      why: 'Read back from the canvas on this page, not the hidden copy. Fails if it is one flat colour or its graphics context is gone.',
      run: async () => {
        if (context.lost()) throw new Error('the WebGL context is lost');
        if (deviceLost) throw new Error(deviceLost);
        const n = await new Promise((resolve) => (blankProbe = resolve));
        if (n < 0) return 'WebGPU: the device is alive (pixels are not read back on this renderer)';
        if (n < 3) throw new Error(`only ${n} colour${n === 1 ? '' : 's'} across the whole canvas`);
        return `${n} different colours across a 7×7 grid of samples`;
      },
    }],
  });
} else if (support.paint) {
  await until(() => surfaces.stats.uploads >= 3 || surfaces.stats.lastError, 5000).catch(() => {});
  auto = false;
  // elementFromPoint() only answers inside the viewport, so the scene has to be on screen.
  const scrollBefore = scrollY;
  $('stage').scrollIntoView({ block: 'nearest' });
  const tests = [
    {
      name: 'DOM reaches the GPU as a texture',
      why: `${backendName}. The "Post it" button should be ember orange where the scene says it is.`,
      run: async () => {
        if (surfaces.stats.lastError) throw new Error(surfaces.stats.lastError);
        view('laptop', true);
        await frames(2);
        const px = renderedPixel(clientPoint('laptop', $('f-post'), 0.06, 0.5));
        if (!close(px, [210, 73, 31])) throw new Error(`pixel on the button is rgb(${px}), expected about rgb(210,73,31)`);
        return `rgb(${px}) on the button, ${S.laptop.width || S.laptop.element.offsetWidth}×${S.laptop.height || S.laptop.element.offsetHeight} texture, via ${useGPU ? support.webgpu : support.webgl}`;
      },
    },
    {
      name: 'Flat surface: the browser hit test finds the button on the laptop screen',
      why: 'updateElementGeometry() with one perspective matrix.',
      run: async () => {
        view('laptop', true);
        const a = await expectHit('laptop', $('f-post'), 0.5, 0.5, { tracked: false });
        await expectHit('laptop', $('f-name'), 0.9, 0.5, { tracked: false });
        await expectHit('laptop', $('f-glow'), 0.5, 0.5, { tracked: false });
        return `button, text field and checkbox all hit (button at ${a.x.toFixed(0)},${a.y.toFixed(0)})`;
      },
    },
    {
      name: 'Flat, far away and at an angle: the billboard’s like button',
      why: 'Nine metres away in the overview shot, a few pixels tall.',
      run: async () => {
        view('overview', true);
        const pt = await expectHit('billboard', $('b-like'), 0.5, 0.5, { tracked: false });
        const r = $('b-like').getBoundingClientRect();
        return `hit at ${pt.x.toFixed(0)},${pt.y.toFixed(0)}; the button is ${r.width.toFixed(0)}×${r.height.toFixed(0)}px on screen`;
      },
    },
    {
      name: 'Typing repaints the texture and the billboard',
      why: 'Focus the name field, insert text, wait for the paint event.',
      run: async () => {
        view('laptop', true);
        const before = S.billboard.uploads, input = $('f-name');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        document.execCommand('insertText', false, '!');
        await until(() => S.billboard.uploads > before);
        const text = $('b-name').textContent;
        document.execCommand('delete');
        input.blur();
        if (!text.endsWith('!')) throw new Error(`billboard shows "${text}"`);
        return `billboard read "${text}" and re-uploaded ${S.billboard.uploads - before}×`;
      },
    },
    {
      name: 'Curved wall with a mouse: geometry follows the pointer',
      why: 'Raycast, take the triangle under the pointer, re-place the element. Five targets across the arc.',
      timeout: 15000,
      run: async () => {
        view('wall', true);
        const targets = [[$('w-filter'), 0.1], [$('w-notes'), 0.5], [$('w-details').querySelector('summary'), 0.1], [$('w-hue'), 0.5], [$('w-link'), 0.2]];
        for (const [el, fx] of targets) await expectHit('wall', el, fx, 0.5);
        orbitFrom(wall.localToWorld(new THREE.Vector3(2.6, 2.4, 1.2)), wall.localToWorld(wallPoint(0.5, 0.5)));
        applyOrbit();
        for (const [el, fx] of targets) await expectHit('wall', el, fx, 0.5);
        return `${targets.length} targets hit head on, and again from a steep angle off to one side`;
      },
    },
    {
      name: 'Curved wall without a pointer (a touch tap)',
      why: 'No pointer move comes before a tap, so the hit test sees the flat fallback placement across the arc’s chord.',
      run: async () => {
        view('wall', true);
        const targets = [$('w-filter'), $('w-notes'), $('w-hue'), $('w-link')];
        const missed = [];
        for (const el of targets) await expectHit('wall', el, 0.5, 0.5, { tracked: false }).catch(() => missed.push(name(el)));
        if (missed.length) throw new Error(`${missed.length} of ${targets.length} targets missed: ${missed.join(', ')}`);
        return 'all targets hit even without tracking';
      },
    },
    {
      name: 'Occlusion: a drone in front of the screen blocks the click',
      why: 'The DOM does not know about scene depth. The raycast parks an occluded surface off-canvas.',
      run: async () => {
        view('laptop', true);
        const pt = await expectHit('laptop', $('f-post'), 0.5, 0.5);
        const b = localBox($('laptop-ui'), $('f-post'));
        drone.visible = true;
        drone.position.copy(toWorld.laptop((b.x + b.w / 2) / 640, 1 - (b.y + b.h / 2) / 400)).lerp(camera.position, 0.3);
        await settle(pt);
        const got = document.elementFromPoint(pt.x, pt.y);
        drone.visible = $('drone').checked;
        await settle(null);
        if (got !== canvas) throw new Error(`the browser still hit ${name(got)} through the drone`);
        return 'with the drone in the way the hit test returns the canvas';
      },
    },
    {
      name: 'Closing the lid takes the form out of reach',
      why: 'A surface that faces away from the camera gets no geometry.',
      run: async () => {
        view('overview', true);
        setLid(1);
        await settle(null);
        const r = $('f-post').getBoundingClientRect();
        setLid(Number($('lid').value));
        await settle(null);
        if (r.right > 0) throw new Error(`button still on screen at ${r.left.toFixed(0)},${r.top.toFixed(0)}`);
        return 'element geometry is parked off-canvas while the screen faces the keyboard';
      },
    },
    {
      name: 'Focus order and bounding boxes follow the scene',
      why: 'Tab through the laptop form; each focused element reports a rect inside the drawn screen.',
      run: async () => {
        view('laptop', true);
        await settle(null);
        const screen = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
          const p = toWorld.laptop(u, v).project(camera), r = canvas.getBoundingClientRect();
          return [r.left + (p.x * 0.5 + 0.5) * r.width, r.top + (1 - (p.y * 0.5 + 0.5)) * r.height];
        });
        const minX = Math.min(...screen.map((p) => p[0])) - 2, maxX = Math.max(...screen.map((p) => p[0])) + 2;
        const minY = Math.min(...screen.map((p) => p[1])) - 2, maxY = Math.max(...screen.map((p) => p[1])) + 2;
        const order = [];
        for (const el of form.querySelectorAll('input, textarea, select, button')) {
          el.focus({ preventScroll: true });
          if (document.activeElement !== el) throw new Error(`${name(el)} would not take focus`);
          const r = el.getBoundingClientRect();
          if (r.left < minX || r.right > maxX || r.top < minY || r.bottom > maxY) throw new Error(`${name(el)} rect ${r.left.toFixed(0)},${r.top.toFixed(0)} is outside the drawn screen`);
          order.push(el.id);
        }
        document.activeElement.blur();
        return `${order.length} controls focusable in order, rects inside the screen quad`;
      },
    },
    {
      name: 'WebGPU: the same form element into a GPUTexture, read back',
      why: `queue.${support.webgpu ?? 'copyElementImageToTexture'}() on a separate device, whatever renderer drew the scene. No render pass, so it also runs on software GPUs.`,
      timeout: 8000,
      run: async () => {
        if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
        if (!support.webgpu) throw new Error('GPUQueue has no element-image method');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('no WebGPU adapter on this machine');
        const device = await adapter.requestDevice();
        const el = $('laptop-ui'), measured = canvas.getElementImageDefaultSize(el), size = { width: measured.width, height: measured.height };
        size.width = Math.ceil(size.width);
        size.height = Math.ceil(size.height);
        const texture = device.createTexture({ size: [size.width, size.height], format: 'rgba8unorm', usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
        if (support.webgpu === 'drawElementImageToTexture') device.queue.drawElementImageToTexture({ source: el }, { texture });
        else device.queue.copyElementImageToTexture({ source: el }, { destination: { texture }, width: size.width, height: size.height });
        const bytesPerRow = Math.ceil((size.width * 4) / 256) * 256;
        const buffer = device.createBuffer({ size: bytesPerRow * size.height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [size.width, size.height]);
        device.queue.submit([encoder.finish()]);
        await buffer.mapAsync(GPUMapMode.READ);
        const bytes = new Uint8Array(buffer.getMappedRange());
        const b = localBox(el, $('f-post')), k = size.width / el.offsetWidth;
        const at = Math.round((b.y + b.h / 2) * k) * bytesPerRow + Math.round((b.x + 8) * k) * 4;
        const px = Array.from(bytes.slice(at, at + 3));
        device.destroy();
        if (!close(px, [210, 73, 31])) throw new Error(`texel on the button is rgb(${px})`);
        return `${size.width}×${size.height} GPUTexture, button texel rgb(${px}). The element lives in a ${useGPU ? 'WebGPU' : 'WebGL'} canvas.`;
      },
    },
    {
      name: 'three.js r187 HTMLTexture as shipped',
      why: 'three looks for gl.texElementImage2D and queue.copyElementImageToTexture.',
      run: async () => {
        const has = useGPU ? native.copyElementImageToTexture : native.texElementImage2D;
        if (!has) throw new Error(useGPU ? `no GPUQueue.copyElementImageToTexture here (this build has ${support.webgpu ?? 'neither method'})` : `no gl.texElementImage2D here (this build has ${support.webgl ?? 'neither method'}), so three uploads nothing`);
        return 'the method three expects exists natively';
      },
    },
    {
      name: 'three.js HTMLTexture with the html3d.js shim',
      why: 'installThreeShims() maps the old names onto the new methods. A sticker on the desk uses three’s own texture class.',
      run: async () => {
        installThreeShims();
        const el = document.createElement('div');
        el.setAttribute('drawable', '');
        el.style.cssText = 'position:absolute;left:0;top:0;width:240px;height:80px;background:rgb(0,128,96);color:#fff;font:600 20px/80px system-ui;text-align:center';
        el.textContent = 'stock HTMLTexture';
        canvas.append(el);
        const texture = new THREE.HTMLTexture(el);
        texture.colorSpace = THREE.SRGBColorSpace;
        const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.08), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
        sticker.position.set(0.42, 0.751, 0.12);
        sticker.rotation.x = -Math.PI / 2;
        scene.add(sticker);
        view('laptop', true);
        orbitFrom(new THREE.Vector3(0.42, 1.3, 0.3), sticker.position);
        applyOrbit();
        const p = sticker.localToWorld(new THREE.Vector3(-0.1, 0.03, 0)).project(camera), r = canvas.getBoundingClientRect();
        const pt = { x: r.left + (p.x * 0.5 + 0.5) * r.width, y: r.top + (1 - (p.y * 0.5 + 0.5)) * r.height };
        let px = [0, 0, 0], failure = null;
        await until(() => (canvas.requestPaint(), close((px = renderedPixel(pt)), [0, 128, 96])), 2500).catch((err) => (failure = err));
        if (failure && failure.message !== 'timed out waiting') throw failure;
        if (!close(px, [0, 128, 96])) throw new Error(`sticker pixel is rgb(${px}), expected rgb(0,128,96)`);
        return `sticker drew: rgb(${px})`;
      },
    },
    {
      name: 'Hit testing by CSS transform (three’s InteractionManager route)',
      why: 'three positions the element with a CSS matrix3d instead of updateElementGeometry().',
      run: async () => {
        const el = document.createElement('button');
        el.setAttribute('drawable', '');
        el.style.cssText = 'position:absolute;left:0;top:0;width:120px;height:60px;transform-origin:0 0;transform:translate(40px,40px)';
        el.textContent = 'css';
        canvas.append(el);
        await new Promise((resolve) => { canvas.addEventListener('paint', resolve, { once: true }); canvas.requestPaint(); });
        await frames(3);
        const r = canvas.getBoundingClientRect();
        const got = document.elementFromPoint(r.left + 100, r.top + 70);
        el.remove();
        if (got !== el) throw new Error(`the browser hit ${name(got)}; a CSS transform alone does not place a ${useGPU ? 'WebGPU' : 'WebGL'}-drawn element`);
        return 'CSS transform is enough for hit testing';
      },
    },
  ];
  await runTests($('results'), publish(tests));
  scrollTo(0, scrollBefore);
  view('overview', true);
  auto = true;
} else {
  $('results').innerHTML = '<tr><td class="status fail">✗</td><td colspan="2">HTML-in-canvas is not available, so the three documents are shown as ordinary HTML above and the scene has blank screens.</td></tr>';
}

