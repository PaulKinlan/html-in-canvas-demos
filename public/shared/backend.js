// Which GPU route should a demo use: WebGPU, WebGL 2, or neither?
//
//   import { pickBackend, webgpu } from '/shared/backend.js';
//   const backend = await pickBackend();            // 'webgpu' | 'webgl' | '2d'
//   const { device, format } = await webgpu();      // or null, with webgpu.reason saying why
//   const gpu = await webgpu({ compat: true });     // also accept a compatibility mode device
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

/**
 * Optional WebGPU features, asked for only by webgpu({ features: true }) and
 * only where the adapter lists them. `device.features.has(name)` is the test.
 * The device every page shares is made with a plain requestDevice().
 * /webgpu-features/ shows what each one is for and what is drawn without it.
 */
export const OPTIONAL_FEATURES = ['texture-component-swizzle', 'float32-blendable', 'dual-source-blending', 'primitive-index'];

const attempts = new Map();

/**
 * The page's shared WebGPU device, or null. Never throws.
 *
 *   webgpu()                    the page's device: a core adapter that passes both rules
 *   webgpu({ features: true })  a second device, with OPTIONAL_FEATURES. Every option
 *                               below can be combined with it
 *   webgpu({ compat: true })    the page's device, or when there is no core adapter, one from
 *                               a compatibility mode adapter (OpenGL ES 3.1 class hardware)
 *   webgpu({ compat: 'only' })  ask for a compatibility mode adapter first
 *   webgpu({ force: true })     skip both rules (tests that never present)
 *
 * `gpu.level` is 'core' or 'compatibility'. A compatibility device has lower
 * limits and rejects some core shaders, so only pages written for it ask.
 */
export function webgpu({ force = false, compat = false, features = false } = {}) {
  const f = features ? '+features' : '';
  const page = () => once(`page${f}`, () => open({ features }));
  // A forced, compatibility or features device is never handed to a caller
  // that did not ask for it: showing a canvas with a forced one could destroy
  // it and every WebGL context with it, and a compatibility one fails core-only shaders.
  if (force && compat) return once(`forced-compat${f}`, () => open({ force: true, compat: true, features }));
  if (force) return once(`forced${f}`, () => page().then((gpu) => gpu ?? open({ force: true, features })));
  if (compat === 'only') return once(`compat-only${f}`, () => open({ compat: true, features }));
  if (compat) return once(`compat${f}`, () => page().then((gpu) => gpu ?? ((features ? webgpu.featuresReason : webgpu.reason) === NO_ADAPTER ? webgpu({ compat: 'only', features }) : null)));
  return page();
}
const NO_ADAPTER = 'WebGPU found no graphics adapter';
/** Why the page's device (the one webgpu() gives without options) is not usable. Empty when it is. */
webgpu.reason = '';
/** The same for webgpu({ features: true }). */
webgpu.featuresReason = '';
/** Why webgpu({ compat: 'only' }) gave nothing. */
webgpu.compatReason = '';

function once(key, make) {
  if (!attempts.has(key)) attempts.set(key, make());
  return attempts.get(key);
}

async function open({ force = false, compat = false, features = false }) {
  const mine = !force && !compat; // only a page's own device reports through webgpu.reason
  const say = (reason) => (features ? (webgpu.featuresReason = reason) : (webgpu.reason = reason));
  const no = (reason) => {
    if (mine) say(reason);
    if (compat) webgpu.compatReason = reason;
    return null;
  };
  try {
    if (!navigator.gpu) return no('this browser has no WebGPU');
    const adapter = await navigator.gpu.requestAdapter(compat ? { featureLevel: 'compatibility' } : { powerPreference: 'high-performance' });
    if (!adapter) return no(compat ? 'WebGPU found no compatibility mode adapter' : NO_ADAPTER);
    const info = adapter.info ?? {};
    const software = info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? /swiftshader|llvmpipe|software/i.test(`${info.architecture} ${info.description}`);
    if (software && !force) return no('the only WebGPU adapter is a software one');
    const device = await adapter.requestDevice(features ? { requiredFeatures: OPTIONAL_FEATURES.filter((name) => adapter.features.has(name)) } : undefined);
    // A device from a core adapter always has this feature. One from a compatibility adapter has it only when asked.
    const level = device.features.has('core-features-and-limits') ? 'core' : 'compatibility';
    const gpu = { device, adapter, format: navigator.gpu.getPreferredCanvasFormat(), lost: false, software: !!software, level };
    device.lost.then((e) => {
      gpu.lost = true;
      if (mine) say(`the WebGPU device was lost (${e.message || e.reason})`);
      dispatchEvent(new CustomEvent('webgpulost', { detail: e }));
    });
    if (!force) {
      const problem = await selfTest(gpu);
      if (problem) {
        device.destroy();
        return no(problem);
      }
    }
    if (mine) say('');
    return gpu;
  } catch (err) {
    return no(`WebGPU failed to start (${err.message})`);
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

/** True when a WebGL 2 context can be made. */
export function webgl2() {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
}

/**
 * The best route this browser can really run, from `order`.
 * `want` (an attribute or ?backend= value) wins when it is usable.
 */
export async function pickBackend({ want = '', order = ['webgpu', 'webgl', '2d'] } = {}) {
  // 'webgpu-compat' is a tier between WebGPU and WebGL for pages that list it:
  // a compatibility mode device where no core adapter exists.
  const usable = async (name) => (name === 'webgpu' ? !!(await webgpu()) : name === 'webgpu-compat' ? !!(await webgpu({ compat: true })) : name === 'webgl' ? webgl2() : true);
  if (want && order.includes(want) && (await usable(want))) return want;
  for (const name of order) if (await usable(name)) return name;
  return '2d';
}
