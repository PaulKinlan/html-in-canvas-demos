// device-tier.js: pick an effect quality before the first frame.
//
//   import { deviceTier } from '/lib/device-tier.js';
//   const { tier, quality } = deviceTier();      // synchronous, no GPU touched
//   mesh.subdivide(quality.mesh);
//
// The tier comes from navigator.cpuPerformance (CPU Performance API, a small
// integer where a higher number is a faster CPU) when the browser has it, and
// from core count and device memory otherwise. `inputs` holds what was read, so
// a page can show why it chose what it chose.
//
// softwareGpu() is separate and asynchronous: it asks for a WebGPU adapter (no
// device) and reports GPUAdapterInfo.isFallbackAdapter. A page that would use
// WebGPU can call it and take the 2D route when the adapter is software.

// #region tier
/** What each tier turns on. Pages may ignore this and map tiers themselves. */
export const QUALITY = {
  low: { mesh: 12, blurTaps: 5, fps: 30, shaders: false },
  mid: { mesh: 24, blurTaps: 9, fps: 60, shaders: true },
  high: { mesh: 48, blurTaps: 17, fps: 60, shaders: true },
};

/** @returns {{ tier: 'low'|'mid'|'high', source: string, inputs: object, quality: object }} */
export function deviceTier(nav = navigator) {
  const inputs = {
    cpuPerformance: nav.cpuPerformance ?? null,
    cores: nav.hardwareConcurrency ?? null,
    memoryGB: nav.deviceMemory ?? null,
    saveData: nav.connection?.saveData ?? null,
  };
  let tier, source;
  if (typeof inputs.cpuPerformance === 'number' && inputs.cpuPerformance > 0) {
    // 1 is the slowest class the API reports. 0 means the browser will not say.
    tier = inputs.cpuPerformance <= 1 ? 'low' : inputs.cpuPerformance <= 2 ? 'mid' : 'high';
    source = 'navigator.cpuPerformance';
  } else {
    const cores = inputs.cores ?? 4, mem = inputs.memoryGB ?? 4;
    tier = cores <= 4 && mem <= 2 ? 'low' : cores >= 8 && mem >= 8 ? 'high' : 'mid';
    source = 'cores and device memory';
  }
  if (inputs.saveData && tier !== 'low') { tier = tier === 'high' ? 'mid' : 'low'; source += ', lowered for Save-Data'; }
  return { tier, source, inputs, quality: QUALITY[tier] };
}
// #endregion tier

// #region gpu
/** Ask for a WebGPU adapter, without a device, and report whether it is a software one. */
export async function softwareGpu() {
  if (!navigator.gpu) return { webgpu: false, fallback: null, detail: 'no navigator.gpu' };
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { webgpu: false, fallback: null, detail: 'requestAdapter() returned null' };
    const info = adapter.info ?? {};
    const fallback = info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null;
    return { webgpu: true, fallback, detail: [info.vendor, info.architecture, info.description].filter(Boolean).join(' ') };
  } catch (err) {
    return { webgpu: false, fallback: null, detail: err.message };
  }
}
// #endregion gpu
