// Which GPU route should a demo use: WebGPU, WebGL 2, or neither?
//
//   import { pickBackend, webgpu } from '/shared/backend.js';
//   const backend = await pickBackend();            // 'webgpu' | 'webgl' | '2d'
//   const { device, format } = await webgpu();      // or null, with webgpu.reason saying why
//
// WebGPU is only chosen when it is really usable, because a WebGPU device that
// dies takes every WebGL context and large 2D canvas on the page with it:
//
//   - there must be an adapter, and not a software (fallback) one. Headless
//     test browsers only have SwiftShader, where presenting to a canvas
//     destroys the device;
//   - a self-test draws one colour to a WebGPU canvas, copies it to a 2D
//     canvas with drawImage() and reads it back. That is the round trip the
//     demos rely on, so a browser that cannot do it is sent to WebGL.
//
// The device is shared: every caller on the page gets the same one.
// `webgpu({ force: true })` skips both rules (for tests that render to a
// texture and never present).

let attempt = null;
let forcedAttempt = null;

/** The page's shared WebGPU device, or null. Never throws. */
export function webgpu({ force = false } = {}) {
  attempt ??= open(false);
  if (!force) return attempt;
  // A forced device is the page's own when that works, else one that skipped
  // the rules. It is never handed to a caller that did not ask for it: showing
  // a canvas with it could destroy it, and every WebGL context with it.
  forcedAttempt ??= attempt.then((gpu) => gpu ?? open(true));
  return forcedAttempt;
}
/** Why the page's device (the one webgpu() gives without force) is not usable. Empty when it is. */
webgpu.reason = '';

async function open(force) {
  const no = (reason) => {
    if (!force) webgpu.reason = reason;
    return null;
  };
  try {
    if (!navigator.gpu) return no('this browser has no WebGPU');
    if (!force) {
      const before = lostBefore();
      if (before) return no(before);
    }
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return no('WebGPU found no graphics adapter');
    const info = adapter.info ?? {};
    const software = info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? /swiftshader|llvmpipe|software/i.test(`${info.architecture} ${info.description}`);
    if (software && !force) return no('the only WebGPU adapter is a software one');
    const device = await adapter.requestDevice();
    const gpu = { device, adapter, format: navigator.gpu.getPreferredCanvasFormat(), lost: false, software: !!software };
    device.lost.then((e) => {
      gpu.lost = true;
      if (!force) webgpu.reason = `the WebGPU device was lost (${e.message || e.reason})`;
      if (!force && e.reason !== 'destroyed') rememberLoss(e.message || e.reason || 'no reason given');
      dispatchEvent(new CustomEvent('webgpulost', { detail: e }));
    });
    if (!force) {
      const problem = await selfTest(gpu);
      if (problem) {
        device.destroy();
        return no(problem);
      }
    }
    if (!force) webgpu.reason = '';
    return gpu;
  } catch (err) {
    return no(`WebGPU failed to start (${err.message})`);
  }
}

// A device that was lost on this phone is likely to be lost again on the next
// page, and a lost device can take the page's WebGL contexts and large 2D
// canvases with it. So after a loss the tab uses WebGL for ten minutes.
// ?webgpu=retry forgets the loss.
const LOSS_KEY = 'webgpu-lost';
const LOSS_MS = 10 * 60 * 1000;
function rememberLoss(message) {
  try { sessionStorage.setItem(LOSS_KEY, JSON.stringify({ at: Date.now(), message })); } catch {}
}
function lostBefore() {
  try {
    if (new URLSearchParams(location.search).get('webgpu') === 'retry') sessionStorage.removeItem(LOSS_KEY);
    const loss = JSON.parse(sessionStorage.getItem(LOSS_KEY) ?? 'null');
    if (!loss) return '';
    const age = Date.now() - loss.at;
    if (age > LOSS_MS) { sessionStorage.removeItem(LOSS_KEY); return ''; }
    const mins = Math.max(1, Math.round(age / 60000));
    return `the WebGPU device was lost ${mins} min ago in this tab (${loss.message}); add ?webgpu=retry to the address to use WebGPU again`;
  } catch {
    return '';
  }
}

// Clear a WebGPU canvas to a known colour and read it back through a 2D canvas.
async function selfTest({ device, format }) {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const g = c.getContext('webgpu');
  if (!g) return 'no WebGPU canvas context';
  g.configure({ device, format, alphaMode: 'premultiplied' });
  const enc = device.createCommandEncoder();
  enc.beginRenderPass({ colorAttachments: [{ view: g.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 1, 0, 1] }] }).end();
  device.queue.submit([enc.finish()]);
  const t = document.createElement('canvas');
  t.width = t.height = 4;
  const t2 = t.getContext('2d', { willReadFrequently: true });
  t2.drawImage(c, 0, 0);
  const px = t2.getImageData(1, 1, 1, 1).data;
  await device.queue.onSubmittedWorkDone();
  await new Promise((r) => setTimeout(r, 0));
  if (!(px[1] > 200 && px[0] < 60 && px[3] > 200)) return 'a WebGPU canvas could not be copied to a 2D canvas';
  return '';
}

// Asked once. The probe's context is given back at once: Chrome on Android
// keeps 8 WebGL contexts per tab, and a probe left to the garbage collector
// counts as one of them.
let hasWebGL2 = null;
/** True when a WebGL 2 context can be made. */
export function webgl2() {
  if (hasWebGL2 !== null) return hasWebGL2;
  try {
    // This canvas is never in a page and has no children, so losing its context is safe.
    const gl = document.createElement('canvas').getContext('webgl2');
    hasWebGL2 = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    hasWebGL2 = false;
  }
  return hasWebGL2;
}

/**
 * The best route this browser can really run, from `order`.
 * `want` (an attribute or ?backend= value) wins when it is usable.
 */
export async function pickBackend({ want = '', order = ['webgpu', 'webgl', '2d'] } = {}) {
  const usable = async (name) => (name === 'webgpu' ? !!(await webgpu()) : name === 'webgl' ? webgl2() : true);
  if (want && order.includes(want) && (await usable(want))) return want;
  for (const name of order) if (await usable(name)) return name;
  return '2d';
}
