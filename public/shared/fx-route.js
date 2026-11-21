// Load the fx library so that the page opens one graphics context.
//
//   import { loadFx } from '/shared/fx-route.js';
//   const fx = await loadFx({ targets: () => document.querySelectorAll('#demo [fx]'), mount: $('route') });
//
// Left alone, each [fx] element gets a canvas of its own: WebGPU canvases on
// the page's one device when WebGPU works, else a WebGL context per element.
// Several WebGL contexts next to a WebGPU device have ended in lost contexts on
// a phone, so this helper asks /shared/backend.js first and, when WebGPU is not
// usable, marks every target fx-backend="shared". Shared surfaces are 2D
// canvases drawn through one page-wide WebGL context in turn.
//
// A surface whose canvas loses its context is switched to plain HTML with a note.
//
// `mount` gets the "Drawn with" menu (/shared/route-switch.js). `?route=webgl`
// in the address asks for the shared WebGL route without starting WebGPU.

import { webgpu } from './backend.js';
import { routeSwitch } from './route-switch.js';

export async function loadFx({ targets, mount = null } = {}) {
  const all = () => [...targets()];
  const asked = new URLSearchParams(location.search).get('route');
  // The elements move into their canvases only after the awaits below. /shared/nav.js
  // keeps the page unpainted while <html> has data-hold, so that move is not seen.
  const root = document.documentElement;
  root.setAttribute('data-hold', '');
  const release = () => requestAnimationFrame(() => requestAnimationFrame(() => root.removeAttribute('data-hold')));
  let gpu = null;
  try {
    gpu = asked === 'webgl' ? null : await webgpu();
  } catch {}
  const route = (choice) => {
    for (const el of all()) {
      if (choice === 'webgpu') el.setAttribute('fx-backend', 'webgpu');
      else if (choice === 'webgl' || !gpu) el.setAttribute('fx-backend', 'shared');
      else el.removeAttribute('fx-backend');
    }
  };
  route(asked);
  let lib;
  try {
    lib = await import('/lib/shader-fx.js');
  } finally {
    release();
  }
  const surfaceOf = (el) => el.closest('fx-surface');
  if (mount) {
    routeSwitch(mount, {
      targets: all,
      active: (el) => surfaceOf(el)?.backend,
      // On the shared route the element's own note only says that the route was asked for.
      note: (el) => (gpu ? surfaceOf(el)?.gpuNote : webgpu.reason || surfaceOf(el)?.gpuNote),
      apply: route,
    });
  }
  // #region lost
  // A canvas whose context is lost stays blank. Look every two seconds, and when a
  // surface's context has been lost on two looks in a row, show that element as
  // plain HTML with a note (fallBackToPlain is the fx library's own fallback).
  const lostBefore = new WeakSet();
  setInterval(() => {
    for (const el of all()) {
      const s = surfaceOf(el);
      if (!s?.live || !s.ctx?.isContextLost?.()) { if (s) lostBefore.delete(s); continue; }
      if (lostBefore.has(s)) s.fallBackToPlain('the canvas lost its graphics context');
      else lostBefore.add(s);
    }
  }, 2000);
  // #endregion lost
  return { ...lib, gpu, route, surfaceOf };
}

/**
 * A live check for pages that define effects: draw one fixture per effect with
 * WebGL and with WebGPU (into a texture, never on screen) and compare the two.
 * Effects that use u_time cannot be compared and should be left out.
 *
 *   runTests(tbody, [ sameOnWebGPU(['burn-in', 'melt'], { vars: '--fx-progress:0.5' }) ])
 */
export function sameOnWebGPU(names, { vars = '--fx-progress:0.5;--fx-amount:1;--fx-x:-0.6;--fx-y:-0.5', limit = 1.5 } = {}) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    name: 'The effects on WebGPU: the same picture as WebGL',
    why: `Each effect is written in GLSL and in WGSL. A fixture is drawn both ways (the WebGPU one into a texture) and the pixels are compared: ${names.join(', ')}. Needs a WebGPU adapter.`,
    timeout: 12000 + names.length * 4000,
    run: async () => {
      const [{ testStage, supported }, { pictureDifference }] = await Promise.all([import('./support.js'), import('/lib/gpu-util.js')]);
      if (!supported) throw new Error('HTML-in-canvas is not available');
      const stage = testStage();
      const make = async (name, attrs) => {
        const holder = document.createElement('div');
        holder.style.cssText = `flex:none;box-sizing:content-box;width:200px;padding:0;${vars}`;
        holder.innerHTML = `<div fx="${name}" ${attrs} style="width:200px;height:90px;box-sizing:border-box;padding:8px;border-radius:18px;background:linear-gradient(90deg,#173a5e,#e0457b);color:#fff;font:700 26px system-ui">Same <span style="color:#ffd66b">picture</span></div>`;
        stage.append(holder);
        const el = holder.firstElementChild;
        let s;
        for (let i = 0; i < 200; i++) { s = el.closest('fx-surface'); if (s?.ready && s.frames) break; await sleep(25); }
        if (!s?.ready) throw new Error(`${name}: the fixture was never drawn`);
        return { s, holder };
      };
      const parts = [];
      for (const name of names) {
        const gl = await make(name, 'fx-backend="shared"');
        const gpu = await make(name, 'fx-backend="webgpu" fx-offscreen');
        for (let i = 0; i < 60 && gpu.s.backend !== 'webgpu' && !gpu.s.gpuNote; i++) await sleep(50);
        if (gpu.s.backend !== 'webgpu') throw new Error(`WebGPU is not in use: ${gpu.s.gpuNote || 'it did not start'}`);
        await sleep(80);
        const d = pictureDifference(await gl.s.readback(), await gpu.s.readback());
        gl.holder.remove();
        gpu.holder.remove();
        if (d.ink < 0.05) throw new Error(`${name}: WebGPU drew nothing`);
        if (d.mean > limit) throw new Error(`${name}: mean difference ${d.mean.toFixed(2)} of 255, largest ${d.max}`);
        parts.push(`${name} ${d.mean.toFixed(2)}`);
      }
      return `mean difference per channel, of 255: ${parts.join(', ')}`;
    },
  };
}
