// DOM radiosity: live HTML elements uploaded to WebGPU/WebGL textures,
// classified on the GPU into emitters and occluders, converted to a Euclidean
// distance field via Jump-Flood (JFA), and lit with 4-cascade 2D Radiance
// Cascades global illumination.

import { banner, checkBench, nav, nextPaint, onBench, runTests, supported } from '/shared/support.js';
import { checkDevice, webgpu, webgl2 } from '/shared/backend.js';
import { routeSwitch } from '/shared/route-switch.js';
import { ElementGL, supported as glSupported } from '/lib/element-gl.js';
import { GPUCanvas, GPUElementTexture, checkWGSL, gpuMethod, supportedGPU, uploadElement, watchFrame } from '/lib/gpu-util.js';

nav('/dom-radiosity/');
banner();

const $ = (id) => document.getElementById(id);
const sceneEl = $('scene');
const neonInput = $('neon-input');
const viewSelect = $('view-mode');
const hueSlider = $('hue-slider');
const exposureSlider = $('exposure-slider');
const bounceSlider = $('bounce-slider');
const orbitBtn = $('orbit-btn');
const resetBtn = $('reset-btn');
const statsEl = $('stats');
const messageEl = $('message');

let canvas = $('stage');
let contextKind = '';
let stage = null;
let turn = 0;
let choice = '';
const routeState = { backend: 'starting', gpuNote: '' };

const VIEW_MODES = { radiosity: 0, light: 1, sdf: 2, plain: 3 };
const DEFAULT_POS = {
  'pillar-a': { left: '29%', top: '50%' },
  'pillar-b': { left: '71%', top: '50%' },
  'pillar-c': { left: '50%', top: '60%' },
};
const DEFAULT_LAMPS = {
  amber: { left: 14, top: 76 },
  cyan: { left: 86, top: 76 },
  rose: { left: 50, top: 88 },
};

// ---------------------------------------------------------------------------
// Simulation dimensions (multiples of 16 so all 4 cascades align cleanly)
// ---------------------------------------------------------------------------

function simDims(cssW, cssH, maxSide = 384) {
  const aspect = Math.max(0.25, Math.min(4, cssW / Math.max(1, cssH)));
  let w, h;
  if (aspect >= 1) {
    w = maxSide;
    h = Math.round(maxSide / aspect);
  } else {
    h = maxSide;
    w = Math.round(maxSide * aspect);
  }
  w = Math.max(64, Math.round(w / 16) * 16);
  h = Math.max(64, Math.round(h / 16) * 16);
  return { w, h };
}

function jfaSteps(w, h) {
  const maxDim = Math.max(w, h);
  let step = 1;
  while (step * 2 < maxDim) step *= 2;
  const list = [];
  for (let s = step; s >= 1; s >>= 1) list.push(s);
  return list;
}

const CASCADE_INTERVALS = [
  [0.0, 3.0],
  [2.5, 14.0],
  [13.0, 58.0],
  [56.0, 560.0],
];

// ---------------------------------------------------------------------------
// WGSL shaders (WebGPU @compute JFA + 4-cascade 2D Radiance Cascades)
// ---------------------------------------------------------------------------

// #region seed
const SEED_WGSL = /* wgsl */ `
struct SeedParams {
  simSize: vec2u,
  domSize: vec2u,
  emitGain: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};

@group(0) @binding(0) var domTex: texture_2d<f32>;
@group(0) @binding(1) var sceneOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var jfaOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(3) var<uniform> params: SeedParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.simSize.x || id.y >= params.simSize.y) { return; }

  let x0 = (id.x * params.domSize.x) / params.simSize.x;
  let x1 = max(x0 + 1u, ((id.x + 1u) * params.domSize.x) / params.simSize.x);
  let y0 = (id.y * params.domSize.y) / params.simSize.y;
  let y1 = max(y0 + 1u, ((id.y + 1u) * params.domSize.y) / params.simSize.y);

  let sx0 = i32(min(x0, params.domSize.x - 1u));
  let sx1 = i32(min(x1 - 1u, params.domSize.x - 1u));
  let sy0 = i32(min(y0, params.domSize.y - 1u));
  let sy1 = i32(min(y1 - 1u, params.domSize.y - 1u));
  let smx = (sx0 + sx1) / 2;
  let smy = (sy0 + sy1) / 2;

  var taps = array<vec2i, 5>(
    vec2i(smx, smy),
    vec2i(sx0, sy0),
    vec2i(sx1, sy0),
    vec2i(sx0, sy1),
    vec2i(sx1, sy1)
  );

  var bestEmit = vec3f(0.0);
  var bestScore = 0.0;
  var maxOcc = 0.0;

  for (var i = 0u; i < 5u; i = i + 1u) {
    let p = textureLoad(domTex, taps[i], 0);
    if (p.a > 0.14) {
      let rgb = p.rgb / max(p.a, 0.001);
      let maxC = max(rgb.r, max(rgb.g, rgb.b));
      if (maxC > 0.38) {
        let emit = rgb * pow(maxC, 0.45) * p.a * params.emitGain;
        let score = dot(emit, vec3f(0.3, 0.59, 0.11)) + max(emit.r, max(emit.g, emit.b));
        if (score > bestScore) {
          bestScore = score;
          bestEmit = emit;
        }
      } else if (p.a > 0.45) {
        maxOcc = max(maxOcc, p.a);
      }
    }
  }

  let px = vec2i(id.xy);
  if (bestScore > 0.001) {
    textureStore(sceneOut, px, vec4f(bestEmit, 1.0));
    textureStore(jfaOut, px, vec4f(f32(id.x) + 0.5, f32(id.y) + 0.5, 1.0, 0.0));
  } else if (maxOcc > 0.45) {
    textureStore(sceneOut, px, vec4f(0.0, 0.0, 0.0, 1.0));
    textureStore(jfaOut, px, vec4f(f32(id.x) + 0.5, f32(id.y) + 0.5, 1.0, 0.0));
  } else {
    textureStore(sceneOut, px, vec4f(0.0));
    textureStore(jfaOut, px, vec4f(-1.0, -1.0, 0.0, 4096.0));
  }
}
`;
// #endregion seed

// #region jfa
const JFA_WGSL = /* wgsl */ `
struct JfaParams {
  simSize: vec2u,
  step: i32,
  pad: i32,
};

@group(0) @binding(0) var jfaIn: texture_2d<f32>;
@group(0) @binding(1) var jfaOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: JfaParams;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.simSize.x || id.y >= params.simSize.y) { return; }

  let dims = vec2i(params.simSize);
  let here = vec2i(id.xy);
  let pos = vec2f(f32(id.x) + 0.5, f32(id.y) + 0.5);

  var bestSeed = vec2f(-1.0, -1.0);
  var bestDistSq = 1e12;
  var found = 0.0;

  for (var dy = -1; dy <= 1; dy = dy + 1) {
    for (var dx = -1; dx <= 1; dx = dx + 1) {
      let c = here + vec2i(dx * params.step, dy * params.step);
      if (c.x < 0 || c.y < 0 || c.x >= dims.x || c.y >= dims.y) { continue; }
      let s = textureLoad(jfaIn, c, 0);
      if (s.z > 0.5) {
        let diff = pos - s.xy;
        let d2 = dot(diff, diff);
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestSeed = s.xy;
          found = 1.0;
        }
      }
    }
  }

  let dist = select(4096.0, sqrt(bestDistSq), found > 0.5);
  textureStore(jfaOut, here, vec4f(bestSeed, found, dist));
}
`;
// #endregion jfa

// #region cascades
const RADIANCE_WGSL = /* wgsl */ `
struct CascadeParams {
  simSize: vec2u,
  cascade: u32,
  side: u32,
  tStart: f32,
  tEnd: f32,
  bounce: f32,
  sigma: f32,
};

@group(0) @binding(0) var sceneTex: texture_2d<f32>;
@group(0) @binding(1) var jfaTex: texture_2d<f32>;
@group(0) @binding(2) var prevIrrad: texture_2d<f32>;
@group(0) @binding(3) var upperCascade: texture_2d<f32>;
@group(0) @binding(4) var cascadeOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var<uniform> params: CascadeParams;

const TAU: f32 = 6.28318530718;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.simSize.x || id.y >= params.simSize.y) { return; }

  let dims = vec2i(params.simSize);
  let dimsF = vec2f(params.simSize);
  let side = params.side;
  let probe = id.xy / side;
  let local = id.xy % side;
  let rayIdx = local.y * side + local.x;
  let numRays = side * side;

  let angle = (f32(rayIdx) + 0.5) * (TAU / f32(numRays));
  let dir = vec2f(cos(angle), sin(angle));
  let origin = (vec2f(probe) + 0.5) * f32(side);

  var rad = vec3f(0.0);
  var vis = 1.0;
  var t = params.tStart;

  if (params.cascade == 0u) {
    let sc0 = textureLoad(sceneTex, clamp(vec2i(origin), vec2i(0), dims - 1), 0);
    if (sc0.a > 0.5 && max(sc0.r, max(sc0.g, sc0.b)) > 0.001) {
      rad = sc0.rgb;
      vis = 0.0;
    } else {
      t = 0.5;
    }
  }

  if (vis > 0.5) {
    for (var step = 0u; step < 52u; step = step + 1u) {
      if (t >= params.tEnd) { break; }
      let pos = origin + dir * t;
      if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= dimsF.x || pos.y >= dimsF.y) {
        break;
      }
      let ipos = vec2i(pos);
      let d = textureLoad(jfaTex, ipos, 0).w;
      if (d < 0.72) {
        let sc = textureLoad(sceneTex, ipos, 0);
        if (sc.a > 0.5) {
          let att = exp(-(t - params.tStart) * params.sigma);
          if (max(sc.r, max(sc.g, sc.b)) > 0.001) {
            rad = sc.rgb * att;
          } else if (params.bounce > 0.001) {
            let back = clamp(vec2i(pos - dir * 1.6), vec2i(0), dims - 1);
            let prev = textureLoad(prevIrrad, back, 0).rgb;
            rad = prev * params.bounce * 0.52 * att;
          }
          vis = 0.0;
          break;
        }
        t = t + 0.75;
      } else {
        t = t + max(d * 0.85, 0.75);
      }
    }
  }

  if (vis > 0.5 && params.cascade < 3u) {
    let upperSide = side * 2u;
    let upperMax = vec2i(params.simSize / upperSide) - vec2i(1);
    let u = (vec2f(probe) + 0.5) * 0.5 - 0.5;
    let q0 = vec2i(floor(u));
    let f = u - vec2f(q0);

    let q00 = clamp(q0, vec2i(0), upperMax);
    let q10 = clamp(q0 + vec2i(1, 0), vec2i(0), upperMax);
    let q01 = clamp(q0 + vec2i(0, 1), vec2i(0), upperMax);
    let q11 = clamp(q0 + vec2i(1, 1), vec2i(0), upperMax);

    let uSideI = i32(upperSide);
    var merged = vec3f(0.0);
    for (var k = 0u; k < 4u; k = k + 1u) {
      let uRay = rayIdx * 4u + k;
      let uLocal = vec2i(i32(uRay % upperSide), i32(uRay / upperSide));
      let c00 = textureLoad(upperCascade, q00 * uSideI + uLocal, 0).rgb;
      let c10 = textureLoad(upperCascade, q10 * uSideI + uLocal, 0).rgb;
      let c01 = textureLoad(upperCascade, q01 * uSideI + uLocal, 0).rgb;
      let c11 = textureLoad(upperCascade, q11 * uSideI + uLocal, 0).rgb;
      let b = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
      merged = merged + b * 0.25;
    }
    rad = rad + merged * exp(-(params.tEnd - params.tStart) * params.sigma);
  }

  textureStore(cascadeOut, vec2i(id.xy), vec4f(rad, vis));
}
`;

const RESOLVE_WGSL = /* wgsl */ `
struct ResolveParams {
  simSize: vec2u,
  pad0: u32,
  pad1: u32,
};

@group(0) @binding(0) var cascade0: texture_2d<f32>;
@group(0) @binding(1) var irradOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: ResolveParams;

fn probeIrrad(p: vec2i, maxP: vec2i) -> vec3f {
  let c = clamp(p, vec2i(0), maxP) * 2;
  let r0 = textureLoad(cascade0, c + vec2i(0, 0), 0).rgb;
  let r1 = textureLoad(cascade0, c + vec2i(1, 0), 0).rgb;
  let r2 = textureLoad(cascade0, c + vec2i(0, 1), 0).rgb;
  let r3 = textureLoad(cascade0, c + vec2i(1, 1), 0).rgb;
  return (r0 + r1 + r2 + r3) * 0.25;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= params.simSize.x || id.y >= params.simSize.y) { return; }

  let maxP = vec2i(params.simSize / 2u) - vec2i(1);
  let u = (vec2f(id.xy) + 0.5) * 0.5 - 0.5;
  let p0 = vec2i(floor(u));
  let f = u - vec2f(p0);

  let c00 = probeIrrad(p0, maxP);
  let c10 = probeIrrad(p0 + vec2i(1, 0), maxP);
  let c01 = probeIrrad(p0 + vec2i(0, 1), maxP);
  let c11 = probeIrrad(p0 + vec2i(1, 1), maxP);
  let irr = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);

  textureStore(irradOut, vec2i(id.xy), vec4f(irr, 1.0));
}
`;
// #endregion cascades

// #region composite
const COMPOSITE_WGSL = /* wgsl */ `
struct CompositeParams {
  exposure: f32,
  mode: u32,
  simW: f32,
  simH: f32,
};

@group(0) @binding(0) var domTex: texture_2d<f32>;
@group(0) @binding(1) var irradTex: texture_2d<f32>;
@group(0) @binding(2) var jfaTex: texture_2d<f32>;
@group(0) @binding(3) var linSamp: sampler;
@group(0) @binding(4) var<uniform> params: CompositeParams;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
  var pts = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  let p = pts[i];
  var out: VSOut;
  out.pos = vec4f(p, 0.0, 1.0);
  out.uv = vec2f(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
  return out;
}

fn tonemap(c: vec3f) -> vec3f {
  let x = max(c, vec3f(0.0));
  return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}

@fragment fn fs(v: VSOut) -> @location(0) vec4f {
  let dom = textureSample(domTex, linSamp, v.uv);

  if (params.mode == 3u) {
    let base = vec3f(0.027, 0.031, 0.051);
    return vec4f(dom.rgb + base * (1.0 - dom.a), 1.0);
  }

  let irr = textureSample(irradTex, linSamp, v.uv).rgb;

  if (params.mode == 2u) {
    let d = textureSample(jfaTex, linSamp, v.uv).w;
    let normD = clamp(d / 180.0, 0.0, 1.0);
    let band = abs(fract(d / 12.0) - 0.5);
    let line = 1.0 - smoothstep(0.0, 0.09, band);
    let edge = 1.0 - smoothstep(0.0, 2.2, d);
    let col = mix(vec3f(0.04, 0.09, 0.16), vec3f(0.16, 0.42, 0.62), 1.0 - normD)
            + vec3f(0.18, 0.55, 0.72) * line * 0.45
            + vec3f(1.0, 0.55, 0.25) * edge * 0.9;
    return vec4f(col, 1.0);
  }

  let cell = fract(v.uv * vec2f(params.simW, params.simH) / 24.0);
  let gx = 1.0 - smoothstep(0.0, 0.055, min(cell.x, 1.0 - cell.x));
  let gy = 1.0 - smoothstep(0.0, 0.055, min(cell.y, 1.0 - cell.y));
  let grid = max(gx, gy);

  let floorBase = vec3f(0.018, 0.021, 0.032) + vec3f(0.014, 0.017, 0.026) * grid;
  let litFloor = floorBase + irr * params.exposure * (0.9 + 0.24 * grid);

  if (params.mode == 1u) {
    let occDark = vec3f(0.035, 0.04, 0.058) + irr * params.exposure * 0.08;
    let rgb = dom.rgb / max(dom.a, 0.001);
    let isEmit = select(0.0, 1.0, dom.a > 0.14 && max(rgb.r, max(rgb.g, rgb.b)) > 0.38);
    let isOcc = dom.a * (1.0 - isEmit);
    let outCol = mix(litFloor, occDark, isOcc);
    return vec4f(tonemap(outCol), 1.0);
  }

  let rgb = dom.rgb / max(dom.a, 0.001);
  let maxC = max(rgb.r, max(rgb.g, rgb.b));
  let isEmit = select(0.0, 1.0, dom.a > 0.14 && maxC > 0.38);

  let mappedFloor = tonemap(litFloor);
  let occLit = dom.rgb + tonemap(irr * params.exposure) * 0.14 * dom.a;
  let emitLit = min(dom.rgb * 1.15 + tonemap(irr * params.exposure) * 0.22 * dom.a, vec3f(1.0));
  let domLit = mix(occLit, emitLit, isEmit);
  let finalCol = domLit + mappedFloor * (1.0 - dom.a);
  return vec4f(finalCol, 1.0);
}
`;
// #endregion composite

// ---------------------------------------------------------------------------
// WebGPU Stage
// ---------------------------------------------------------------------------

class GPURadiosityStage {
  route = 'webgpu';
  constructor(canvasEl, gpu, element, { present = true, maxSide = 384 } = {}) {
    this.canvas = canvasEl;
    this.gpu = gpu;
    this.device = gpu.device;
    this.element = element;
    this.present = present;
    this.maxSide = maxSide;
    this.surface = new GPUCanvas(canvasEl, gpu, { present });
    this.domTex = new GPUElementTexture(this.device, canvasEl, element);
    this.simW = 0;
    this.simH = 0;
    this.irradIndex = 0;
    this.textures = {};
    this.buffers = {};
    this.pipelines = {};
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  }

  static async create(canvasEl, gpu, element, opts = {}) {
    const s = new GPURadiosityStage(canvasEl, gpu, element, opts);
    await s.#buildPipelines();
    return s;
  }

  async #buildPipelines() {
    const d = this.device;
    const [seedMod, jfaMod, radMod, resMod, compMod] = await Promise.all([
      checkWGSL(d, SEED_WGSL, 'seed'),
      checkWGSL(d, JFA_WGSL, 'jfa'),
      checkWGSL(d, RADIANCE_WGSL, 'radiance'),
      checkWGSL(d, RESOLVE_WGSL, 'resolve'),
      checkWGSL(d, COMPOSITE_WGSL, 'composite'),
    ]);
    this.pipelines.seed = d.createComputePipeline({ layout: 'auto', compute: { module: seedMod, entryPoint: 'main' } });
    this.pipelines.jfa = d.createComputePipeline({ layout: 'auto', compute: { module: jfaMod, entryPoint: 'main' } });
    this.pipelines.rad = d.createComputePipeline({ layout: 'auto', compute: { module: radMod, entryPoint: 'main' } });
    this.pipelines.resolve = d.createComputePipeline({ layout: 'auto', compute: { module: resMod, entryPoint: 'main' } });
    this.pipelines.composite = d.createRenderPipeline({
      layout: 'auto',
      vertex: { module: compMod, entryPoint: 'vs' },
      fragment: { module: compMod, entryPoint: 'fs', targets: [{ format: this.gpu.format }] },
      primitive: { topology: 'triangle-list' },
    });

    this.buffers.seed = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.buffers.resolve = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.buffers.composite = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.buffers.jfa = [];
    for (let i = 0; i < 12; i++) {
      this.buffers.jfa.push(d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
    this.buffers.cascades = [];
    for (let c = 0; c < 4; c++) {
      this.buffers.cascades.push(d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    }
  }

  #ensureGrid(w, h) {
    if (this.simW === w && this.simH === h) return;
    for (const t of Object.values(this.textures)) t?.destroy();
    const d = this.device;
    const mk = () => d.createTexture({
      size: [w, h],
      format: 'rgba16float',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC,
    });
    this.textures = {
      scene: mk(),
      jfaA: mk(),
      jfaB: mk(),
      rcA: mk(),
      rcB: mk(),
      irradA: mk(),
      irradB: mk(),
    };
    this.simW = w;
    this.simH = h;
    this.irradIndex = 0;
  }

  upload() {
    this.domTex.update();
  }

  draw({ exposure = 1.45, bounce = 0.35, mode = 0, cssW = this.canvas.clientWidth || this.canvas.width, cssH = this.canvas.clientHeight || this.canvas.height } = {}) {
    if (!this.domTex.texture) return;
    const { w, h } = simDims(cssW, cssH, this.maxSide);
    this.#ensureGrid(w, h);
    const d = this.device;
    const q = d.queue;
    const wgX = Math.ceil(w / 8);
    const wgY = Math.ceil(h / 8);

    // 1. Seed uniforms
    const seedU32 = new Uint32Array([w, h, this.domTex.width, this.domTex.height, 0, 0, 0, 0]);
    new Float32Array(seedU32.buffer)[4] = 1.85;
    q.writeBuffer(this.buffers.seed, 0, seedU32);

    // 2. JFA step uniforms
    const steps = jfaSteps(w, h);
    for (let i = 0; i < steps.length; i++) {
      const buf = new Int32Array([w, h, steps[i], 0]);
      q.writeBuffer(this.buffers.jfa[i], 0, buf);
    }

    // 3. Cascade uniforms
    const sigma = 0.0038;
    for (let c = 0; c < 4; c++) {
      const side = 2 << c;
      const u32 = new Uint32Array(8);
      const f32 = new Float32Array(u32.buffer);
      u32[0] = w;
      u32[1] = h;
      u32[2] = c;
      u32[3] = side;
      f32[4] = CASCADE_INTERVALS[c][0];
      f32[5] = CASCADE_INTERVALS[c][1];
      f32[6] = bounce;
      f32[7] = sigma;
      q.writeBuffer(this.buffers.cascades[c], 0, u32);
    }

    // 4. Resolve & composite uniforms
    q.writeBuffer(this.buffers.resolve, 0, new Uint32Array([w, h, 0, 0]));
    const compBuf = new ArrayBuffer(16);
    new Float32Array(compBuf, 0, 1)[0] = exposure;
    new Uint32Array(compBuf, 4, 1)[0] = mode;
    new Float32Array(compBuf, 8, 2).set([w, h]);
    q.writeBuffer(this.buffers.composite, 0, compBuf);

    const enc = d.createCommandEncoder();

    // Pass 1: Seed
    {
      const bg = d.createBindGroup({
        layout: this.pipelines.seed.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.domTex.view },
          { binding: 1, resource: this.textures.scene.createView() },
          { binding: 2, resource: this.textures.jfaA.createView() },
          { binding: 3, resource: { buffer: this.buffers.seed } },
        ],
      });
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipelines.seed);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
    }

    // Pass 2: JFA ping-pong
    let jfaSrc = this.textures.jfaA;
    let jfaDst = this.textures.jfaB;
    for (let i = 0; i < steps.length; i++) {
      const bg = d.createBindGroup({
        layout: this.pipelines.jfa.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: jfaSrc.createView() },
          { binding: 1, resource: jfaDst.createView() },
          { binding: 2, resource: { buffer: this.buffers.jfa[i] } },
        ],
      });
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipelines.jfa);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
      const tmp = jfaSrc;
      jfaSrc = jfaDst;
      jfaDst = tmp;
    }
    this.lastJfa = jfaSrc;

    // Pass 3: 4-cascade 2D Radiance Cascades (coarse c=3 down to fine c=0)
    const prevIrradTex = this.irradIndex === 0 ? this.textures.irradA : this.textures.irradB;
    const nextIrradTex = this.irradIndex === 0 ? this.textures.irradB : this.textures.irradA;
    let rcUpper = this.textures.rcB;
    let rcOut = this.textures.rcA;
    for (let c = 3; c >= 0; c--) {
      const bg = d.createBindGroup({
        layout: this.pipelines.rad.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.textures.scene.createView() },
          { binding: 1, resource: jfaSrc.createView() },
          { binding: 2, resource: prevIrradTex.createView() },
          { binding: 3, resource: rcUpper.createView() },
          { binding: 4, resource: rcOut.createView() },
          { binding: 5, resource: { buffer: this.buffers.cascades[c] } },
        ],
      });
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipelines.rad);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
      const tmp = rcUpper;
      rcUpper = rcOut;
      rcOut = tmp;
    }

    // Pass 4: Resolve cascade 0 into irradiance texture
    {
      const bg = d.createBindGroup({
        layout: this.pipelines.resolve.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: rcUpper.createView() },
          { binding: 1, resource: nextIrradTex.createView() },
          { binding: 2, resource: { buffer: this.buffers.resolve } },
        ],
      });
      const pass = enc.beginComputePass();
      pass.setPipeline(this.pipelines.resolve);
      pass.setBindGroup(0, bg);
      pass.dispatchWorkgroups(wgX, wgY);
      pass.end();
    }
    this.lastIrrad = nextIrradTex;
    this.irradIndex = 1 - this.irradIndex;

    // Pass 5: Composite onto canvas (or off-screen target)
    if (this.present || this.surface) {
      const bg = d.createBindGroup({
        layout: this.pipelines.composite.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: this.domTex.view },
          { binding: 1, resource: nextIrradTex.createView() },
          { binding: 2, resource: jfaSrc.createView() },
          { binding: 3, resource: this.sampler },
          { binding: 4, resource: { buffer: this.buffers.composite } },
        ],
      });
      const pass = enc.beginRenderPass({
        colorAttachments: [{
          view: this.surface.view(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: [0.027, 0.031, 0.051, 1],
        }],
      });
      pass.setPipeline(this.pipelines.composite);
      pass.setBindGroup(0, bg);
      pass.draw(3);
      pass.end();
    }

    q.submit([enc.finish()]);
  }

  destroy() {
    this.domTex.destroy();
    this.surface.destroy();
    for (const t of Object.values(this.textures)) t?.destroy();
    this.textures = {};
    this.buffers.seed?.destroy();
    this.buffers.resolve?.destroy();
    this.buffers.composite?.destroy();
    for (const b of this.buffers.jfa ?? []) b.destroy();
    for (const b of this.buffers.cascades ?? []) b.destroy();
    this.buffers = {};
  }
}

// ---------------------------------------------------------------------------
// WebGL 2 Stage (built on ElementGL from /lib/element-gl.js, single context)
// ---------------------------------------------------------------------------

const GL_VERT = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.0, 1.0);
}`;

const GL_PASSTHROUGH = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`;

const GL_PACK_HELPERS = `
vec2 pack16(float v) {
  float x = floor(clamp(v, 0.0, 1.0) * 65535.0 + 0.5);
  return vec2(floor(x / 256.0), mod(x, 256.0)) / 255.0;
}
float unpack16(vec2 p) {
  return (p.x * 255.0 * 256.0 + p.y * 255.0) / 65535.0;
}
`;

const GL_SEED_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uDom;
uniform vec2 uSimSize;
uniform vec2 uDomSize;
uniform float uEmitGain;
uniform float uHdrScale;
in vec2 vUv;
layout(location = 0) out vec4 outScene;
layout(location = 1) out vec4 outJfa;
${GL_PACK_HELPERS}
void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  ivec2 domMax = ivec2(uDomSize) - ivec2(1);
  // Flip Y because texElementSubImage2D puts row 0 at bottom in GL texture space or top depending on unpack;
  // ElementGL leaves UNPACK_FLIP_Y_WEBGL false, so texel row 0 is the DOM top (v=0 at top, v=1 at bottom).
  int simY = int(uSimSize.y) - 1 - id.y;
  int x0 = (id.x * int(uDomSize.x)) / int(uSimSize.x);
  int x1 = max(x0 + 1, ((id.x + 1) * int(uDomSize.x)) / int(uSimSize.x));
  int y0 = (simY * int(uDomSize.y)) / int(uSimSize.y);
  int y1 = max(y0 + 1, ((simY + 1) * int(uDomSize.y)) / int(uSimSize.y));

  int sx0 = clamp(x0, 0, domMax.x);
  int sx1 = clamp(x1 - 1, 0, domMax.x);
  int sy0 = clamp(y0, 0, domMax.y);
  int sy1 = clamp(y1 - 1, 0, domMax.y);
  int smx = (sx0 + sx1) / 2;
  int smy = (sy0 + sy1) / 2;

  ivec2 taps[5] = ivec2[5](
    ivec2(smx, smy),
    ivec2(sx0, sy0),
    ivec2(sx1, sy0),
    ivec2(sx0, sy1),
    ivec2(sx1, sy1)
  );

  vec3 bestEmit = vec3(0.0);
  float bestScore = 0.0;
  float maxOcc = 0.0;

  for (int i = 0; i < 5; i++) {
    vec4 p = texelFetch(uDom, taps[i], 0);
    if (p.a > 0.14) {
      vec3 rgb = p.rgb / max(p.a, 0.001);
      float maxC = max(rgb.r, max(rgb.g, rgb.b));
      if (maxC > 0.38) {
        vec3 emit = rgb * pow(maxC, 0.45) * p.a * uEmitGain;
        float score = dot(emit, vec3(0.3, 0.59, 0.11)) + max(emit.r, max(emit.g, emit.b));
        if (score > bestScore) {
          bestScore = score;
          bestEmit = emit;
        }
      } else if (p.a > 0.45) {
        maxOcc = max(maxOcc, p.a);
      }
    }
  }

  vec2 uvSeed = (vec2(id) + 0.5) / uSimSize;
  if (bestScore > 0.001) {
    outScene = vec4(bestEmit * uHdrScale, 1.0);
    outJfa = vec4(pack16(uvSeed.x), pack16(uvSeed.y));
  } else if (maxOcc > 0.45) {
    outScene = vec4(0.0, 0.0, 0.0, 1.0);
    outJfa = vec4(pack16(uvSeed.x), pack16(uvSeed.y));
  } else {
    outScene = vec4(0.0);
    outJfa = vec4(0.0);
  }
}`;

const GL_JFA_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uJfaIn;
uniform vec2 uSimSize;
uniform int uStep;
out vec4 outJfa;
${GL_PACK_HELPERS}
void main() {
  ivec2 dims = ivec2(uSimSize);
  ivec2 here = ivec2(gl_FragCoord.xy);
  vec2 pos = vec2(here) + 0.5;
  vec4 bestRaw = vec4(0.0);
  float bestD2 = 1e12;

  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      ivec2 c = here + ivec2(dx * uStep, dy * uStep);
      if (c.x < 0 || c.y < 0 || c.x >= dims.x || c.y >= dims.y) continue;
      vec4 s = texelFetch(uJfaIn, c, 0);
      if (s.r + s.g + s.b + s.a > 0.0001) {
        vec2 seed = vec2(unpack16(s.rg), unpack16(s.ba)) * uSimSize;
        vec2 diff = pos - seed;
        float d2 = dot(diff, diff);
        if (d2 < bestD2) {
          bestD2 = d2;
          bestRaw = s;
        }
      }
    }
  }
  outJfa = bestRaw;
}`;

const GL_RADIANCE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uJfa;
uniform sampler2D uPrevIrrad;
uniform sampler2D uUpper;
uniform vec2 uSimSize;
uniform int uCascade;
uniform int uSide;
uniform float uTStart;
uniform float uTEnd;
uniform float uBounce;
uniform float uSigma;
uniform float uHdrScale;
out vec4 outCascade;
${GL_PACK_HELPERS}
const float TAU = 6.28318530718;

float sdfAt(ivec2 ipos, vec2 pos) {
  vec4 s = texelFetch(uJfa, ipos, 0);
  if (s.r + s.g + s.b + s.a <= 0.0001) return 4096.0;
  vec2 seed = vec2(unpack16(s.rg), unpack16(s.ba)) * uSimSize;
  return length(pos - seed);
}

void main() {
  ivec2 dims = ivec2(uSimSize);
  ivec2 id = ivec2(gl_FragCoord.xy);
  ivec2 probe = id / uSide;
  ivec2 local = id - probe * uSide;
  int rayIdx = local.y * uSide + local.x;
  int numRays = uSide * uSide;

  float angle = (float(rayIdx) + 0.5) * (TAU / float(numRays));
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 origin = (vec2(probe) + 0.5) * float(uSide);

  vec3 rad = vec3(0.0);
  float vis = 1.0;
  float t = uTStart;

  if (uCascade == 0) {
    vec4 sc0 = texelFetch(uScene, clamp(ivec2(origin), ivec2(0), dims - ivec2(1)), 0);
    vec3 e0 = sc0.rgb / uHdrScale;
    if (sc0.a > 0.5 && max(e0.r, max(e0.g, e0.b)) > 0.001) {
      rad = e0;
      vis = 0.0;
    } else {
      t = 0.5;
    }
  }

  if (vis > 0.5) {
    for (int step = 0; step < 52; step++) {
      if (t >= uTEnd) break;
      vec2 pos = origin + dir * t;
      if (pos.x < 0.0 || pos.y < 0.0 || pos.x >= uSimSize.x || pos.y >= uSimSize.y) break;
      ivec2 ipos = ivec2(pos);
      float d = sdfAt(ipos, pos);
      if (d < 0.72) {
        vec4 sc = texelFetch(uScene, ipos, 0);
        if (sc.a > 0.5) {
          float att = exp(-(t - uTStart) * uSigma);
          vec3 e = sc.rgb / uHdrScale;
          if (max(e.r, max(e.g, e.b)) > 0.001) {
            rad = e * att;
          } else if (uBounce > 0.001) {
            ivec2 back = clamp(ivec2(pos - dir * 1.6), ivec2(0), dims - ivec2(1));
            vec3 prev = texelFetch(uPrevIrrad, back, 0).rgb / uHdrScale;
            rad = prev * uBounce * 0.52 * att;
          }
          vis = 0.0;
          break;
        }
        t += 0.75;
      } else {
        t += max(d * 0.85, 0.75);
      }
    }
  }

  if (vis > 0.5 && uCascade < 3) {
    int upperSide = uSide * 2;
    ivec2 upperMax = dims / upperSide - ivec2(1);
    vec2 u = (vec2(probe) + 0.5) * 0.5 - 0.5;
    ivec2 q0 = ivec2(floor(u));
    vec2 f = u - vec2(q0);

    ivec2 q00 = clamp(q0, ivec2(0), upperMax);
    ivec2 q10 = clamp(q0 + ivec2(1, 0), ivec2(0), upperMax);
    ivec2 q01 = clamp(q0 + ivec2(0, 1), ivec2(0), upperMax);
    ivec2 q11 = clamp(q0 + ivec2(1, 1), ivec2(0), upperMax);

    vec3 merged = vec3(0.0);
    for (int k = 0; k < 4; k++) {
      int uRay = rayIdx * 4 + k;
      ivec2 uLocal = ivec2(uRay % upperSide, uRay / upperSide);
      vec3 c00 = texelFetch(uUpper, q00 * upperSide + uLocal, 0).rgb / uHdrScale;
      vec3 c10 = texelFetch(uUpper, q10 * upperSide + uLocal, 0).rgb / uHdrScale;
      vec3 c01 = texelFetch(uUpper, q01 * upperSide + uLocal, 0).rgb / uHdrScale;
      vec3 c11 = texelFetch(uUpper, q11 * upperSide + uLocal, 0).rgb / uHdrScale;
      vec3 b = mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y);
      merged += b * 0.25;
    }
    rad += merged * exp(-(uTEnd - uTStart) * uSigma);
  }

  outCascade = vec4(rad * uHdrScale, vis);
}`;

const GL_RESOLVE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uCascade0;
uniform vec2 uSimSize;
out vec4 outIrrad;

vec3 probeIrrad(ivec2 p, ivec2 maxP) {
  ivec2 c = clamp(p, ivec2(0), maxP) * 2;
  vec3 r0 = texelFetch(uCascade0, c + ivec2(0, 0), 0).rgb;
  vec3 r1 = texelFetch(uCascade0, c + ivec2(1, 0), 0).rgb;
  vec3 r2 = texelFetch(uCascade0, c + ivec2(0, 1), 0).rgb;
  vec3 r3 = texelFetch(uCascade0, c + ivec2(1, 1), 0).rgb;
  return (r0 + r1 + r2 + r3) * 0.25;
}

void main() {
  ivec2 maxP = ivec2(uSimSize) / 2 - ivec2(1);
  vec2 u = gl_FragCoord.xy * 0.5 - 0.5;
  ivec2 p0 = ivec2(floor(u));
  vec2 f = u - vec2(p0);
  vec3 c00 = probeIrrad(p0, maxP);
  vec3 c10 = probeIrrad(p0 + ivec2(1, 0), maxP);
  vec3 c01 = probeIrrad(p0 + ivec2(0, 1), maxP);
  vec3 c11 = probeIrrad(p0 + ivec2(1, 1), maxP);
  outIrrad = vec4(mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y), 1.0);
}`;

const GL_COMPOSITE_FRAG = `#version 300 es
precision highp float;
uniform sampler2D uDom;
uniform sampler2D uIrrad;
uniform sampler2D uJfa;
uniform vec2 uSimSize;
uniform float uExposure;
uniform float uHdrScale;
uniform int uMode;
in vec2 vUv;
out vec4 outColor;
${GL_PACK_HELPERS}

vec3 tonemap(vec3 c) {
  vec3 x = max(c, vec3(0.0));
  return (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
}

vec3 sampleIrrad(vec2 uv) {
  vec2 p = uv * uSimSize - 0.5;
  ivec2 p0 = ivec2(floor(p));
  vec2 f = p - vec2(p0);
  ivec2 hi = ivec2(uSimSize) - ivec2(1);
  vec3 c00 = texelFetch(uIrrad, clamp(p0, ivec2(0), hi), 0).rgb;
  vec3 c10 = texelFetch(uIrrad, clamp(p0 + ivec2(1, 0), ivec2(0), hi), 0).rgb;
  vec3 c01 = texelFetch(uIrrad, clamp(p0 + ivec2(0, 1), ivec2(0), hi), 0).rgb;
  vec3 c11 = texelFetch(uIrrad, clamp(p0 + ivec2(1, 1), ivec2(0), hi), 0).rgb;
  return mix(mix(c00, c10, f.x), mix(c01, c11, f.x), f.y) / uHdrScale;
}

void main() {
  vec2 domUv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 dom = texture(uDom, domUv);

  if (uMode == 3) {
    vec3 base = vec3(0.027, 0.031, 0.051);
    outColor = vec4(dom.rgb + base * (1.0 - dom.a), 1.0);
    return;
  }

  vec3 irr = sampleIrrad(vUv);

  if (uMode == 2) {
    vec2 pos = vUv * uSimSize;
    ivec2 ipos = clamp(ivec2(pos), ivec2(0), ivec2(uSimSize) - ivec2(1));
    vec4 s = texelFetch(uJfa, ipos, 0);
    float d = 4096.0;
    if (s.r + s.g + s.b + s.a > 0.0001) {
      vec2 seed = vec2(unpack16(s.rg), unpack16(s.ba)) * uSimSize;
      d = length(pos - seed);
    }
    float normD = clamp(d / 180.0, 0.0, 1.0);
    float band = abs(fract(d / 12.0) - 0.5);
    float line = 1.0 - smoothstep(0.0, 0.09, band);
    float edge = 1.0 - smoothstep(0.0, 2.2, d);
    vec3 col = mix(vec3(0.04, 0.09, 0.16), vec3(0.16, 0.42, 0.62), 1.0 - normD)
             + vec3(0.18, 0.55, 0.72) * line * 0.45
             + vec3(1.0, 0.55, 0.25) * edge * 0.9;
    outColor = vec4(col, 1.0);
    return;
  }

  vec2 cell = fract(vUv * uSimSize / 24.0);
  float gx = 1.0 - smoothstep(0.0, 0.055, min(cell.x, 1.0 - cell.x));
  float gy = 1.0 - smoothstep(0.0, 0.055, min(cell.y, 1.0 - cell.y));
  float grid = max(gx, gy);

  vec3 floorBase = vec3(0.018, 0.021, 0.032) + vec3(0.014, 0.017, 0.026) * grid;
  vec3 litFloor = floorBase + irr * uExposure * (0.9 + 0.24 * grid);

  if (uMode == 1) {
    vec3 occDark = vec3(0.035, 0.04, 0.058) + irr * uExposure * 0.08;
    vec3 rgb = dom.rgb / max(dom.a, 0.001);
    float isEmit = (dom.a > 0.14 && max(rgb.r, max(rgb.g, rgb.b)) > 0.38) ? 1.0 : 0.0;
    float isOcc = dom.a * (1.0 - isEmit);
    outColor = vec4(tonemap(mix(litFloor, occDark, isOcc)), 1.0);
    return;
  }

  vec3 rgb = dom.rgb / max(dom.a, 0.001);
  float maxC = max(rgb.r, max(rgb.g, rgb.b));
  float isEmit = (dom.a > 0.14 && maxC > 0.38) ? 1.0 : 0.0;

  vec3 mappedFloor = tonemap(litFloor);
  vec3 occLit = dom.rgb + tonemap(irr * uExposure) * 0.14 * dom.a;
  vec3 emitLit = min(dom.rgb * 1.15 + tonemap(irr * uExposure) * 0.22 * dom.a, vec3(1.0));
  vec3 domLit = mix(occLit, emitLit, isEmit);
  outColor = vec4(domLit + mappedFloor * (1.0 - dom.a), 1.0);
}`;

class GLRadiosityStage {
  route = 'webgl';
  constructor(canvasEl, element, { onLost = () => {}, onRestored = () => {} } = {}) {
    if (!glSupported) throw new Error('WebGL 2 texElementSubImage2D() is not available');
    this.canvas = canvasEl;
    this.element = element;
    this.host = new ElementGL(canvasEl, {
      fragment: GL_PASSTHROUGH,
      onLost: () => { this.#clearTargets(); onLost(); },
      onRestored: () => { this.#initPrograms(); onRestored(); },
    });
    this.gl = this.host.gl;
    this.domInfo = null;
    this.simW = 0;
    this.simH = 0;
    this.irradIndex = 0;
    this.targets = {};
    this.programs = {};
    this.vao = null;
    this.useFloat = false;
    this.hdrScale = 0.22;
    this.#initPrograms();
  }

  #compile(src) {
    const gl = this.gl;
    const mk = (type, code) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, code);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(`GLSL: ${log}`);
      }
      return sh;
    };
    const vs = mk(gl.VERTEX_SHADER, GL_VERT);
    const fs = mk(gl.FRAGMENT_SHADER, src);
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      const log = gl.getProgramInfoLog(p);
      gl.deleteProgram(p);
      throw new Error(`GLSL link: ${log}`);
    }
    return p;
  }

  #initPrograms() {
    const gl = this.gl;
    this.useFloat = !!gl.getExtension('EXT_color_buffer_float');
    this.hdrScale = this.useFloat ? 1.0 : 0.22;
    this.vao = gl.createVertexArray();
    this.programs = {
      seed: this.#compile(GL_SEED_FRAG),
      jfa: this.#compile(GL_JFA_FRAG),
      rad: this.#compile(GL_RADIANCE_FRAG),
      resolve: this.#compile(GL_RESOLVE_FRAG),
      composite: this.#compile(GL_COMPOSITE_FRAG),
    };
  }

  #mkTex(w, h, floatFmt) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (floatFmt) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return tex;
  }

  #mkFbo(textures) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    const bufs = [];
    textures.forEach((tex, i) => {
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, tex, 0);
      bufs.push(gl.COLOR_ATTACHMENT0 + i);
    });
    gl.drawBuffers(bufs);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      gl.deleteFramebuffer(fbo);
      return null;
    }
    return fbo;
  }

  #clearTargets() {
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      for (const k of Object.keys(this.targets)) {
        const v = this.targets[k];
        if (!v) continue;
        if (k.startsWith('fbo')) gl.deleteFramebuffer(v);
        else gl.deleteTexture(v);
      }
    }
    this.targets = {};
    this.simW = 0;
    this.simH = 0;
  }

  #ensureGrid(w, h) {
    if (this.simW === w && this.simH === h) return;
    this.#clearTargets();
    const gl = this.gl;
    const build = (isFloat) => {
      const scene = this.#mkTex(w, h, isFloat);
      const jfaA = this.#mkTex(w, h, false);
      const jfaB = this.#mkTex(w, h, false);
      const rcA = this.#mkTex(w, h, isFloat);
      const rcB = this.#mkTex(w, h, isFloat);
      const irradA = this.#mkTex(w, h, isFloat);
      const irradB = this.#mkTex(w, h, isFloat);
      const fboSeed = this.#mkFbo([scene, jfaA]);
      const fboJfaA = this.#mkFbo([jfaA]);
      const fboJfaB = this.#mkFbo([jfaB]);
      const fboRcA = this.#mkFbo([rcA]);
      const fboRcB = this.#mkFbo([rcB]);
      const fboIrrA = this.#mkFbo([irradA]);
      const fboIrrB = this.#mkFbo([irradB]);
      if (!fboSeed || !fboJfaA || !fboJfaB || !fboRcA || !fboRcB || !fboIrrA || !fboIrrB) {
        for (const t of [scene, jfaA, jfaB, rcA, rcB, irradA, irradB]) gl.deleteTexture(t);
        for (const f of [fboSeed, fboJfaA, fboJfaB, fboRcA, fboRcB, fboIrrA, fboIrrB]) if (f) gl.deleteFramebuffer(f);
        return null;
      }
      return { scene, jfaA, jfaB, rcA, rcB, irradA, irradB, fboSeed, fboJfaA, fboJfaB, fboRcA, fboRcB, fboIrrA, fboIrrB };
    };
    let made = this.useFloat ? build(true) : null;
    if (!made) {
      this.useFloat = false;
      this.hdrScale = 0.22;
      made = build(false);
    }
    if (!made) throw new Error('WebGL 2 could not allocate off-screen framebuffers');
    this.targets = made;
    this.simW = w;
    this.simH = h;
    this.irradIndex = 0;
  }

  upload() {
    if (this.host.lost) return;
    this.domInfo = this.host.upload(this.element);
  }

  draw({ exposure = 1.45, bounce = 0.35, mode = 0, cssW = this.canvas.clientWidth || this.canvas.width, cssH = this.canvas.clientHeight || this.canvas.height } = {}) {
    if (this.host.lost || !this.domInfo) return;
    const gl = this.gl;
    const { w, h } = simDims(cssW, cssH, 320);
    this.#ensureGrid(w, h);
    const T = this.targets;

    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    const bindTex = (unit, tex) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
    };

    // 1. Seed
    gl.bindFramebuffer(gl.FRAMEBUFFER, T.fboSeed);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.programs.seed);
    bindTex(0, this.domInfo.tex);
    gl.uniform1i(gl.getUniformLocation(this.programs.seed, 'uDom'), 0);
    gl.uniform2f(gl.getUniformLocation(this.programs.seed, 'uSimSize'), w, h);
    gl.uniform2f(gl.getUniformLocation(this.programs.seed, 'uDomSize'), this.domInfo.w, this.domInfo.h);
    gl.uniform1f(gl.getUniformLocation(this.programs.seed, 'uEmitGain'), 1.85);
    gl.uniform1f(gl.getUniformLocation(this.programs.seed, 'uHdrScale'), this.hdrScale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 2. JFA
    const steps = jfaSteps(w, h);
    let jfaSrc = T.jfaA, jfaDstFbo = T.fboJfaB, jfaDst = T.jfaB, jfaSrcFbo = T.fboJfaA;
    gl.useProgram(this.programs.jfa);
    gl.uniform1i(gl.getUniformLocation(this.programs.jfa, 'uJfaIn'), 0);
    gl.uniform2f(gl.getUniformLocation(this.programs.jfa, 'uSimSize'), w, h);
    const uStepLoc = gl.getUniformLocation(this.programs.jfa, 'uStep');
    for (const s of steps) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, jfaDstFbo);
      bindTex(0, jfaSrc);
      gl.uniform1i(uStepLoc, s);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [jfaSrc, jfaDst] = [jfaDst, jfaSrc];
      [jfaSrcFbo, jfaDstFbo] = [jfaDstFbo, jfaSrcFbo];
    }

    // 3. 4-cascade Radiance Cascades
    const prevIrr = this.irradIndex === 0 ? T.irradA : T.irradB;
    const nextIrr = this.irradIndex === 0 ? T.irradB : T.irradA;
    const nextIrrFbo = this.irradIndex === 0 ? T.fboIrrB : T.fboIrrA;

    let rcUpper = T.rcB, rcOut = T.rcA, rcOutFbo = T.fboRcA, rcUpperFbo = T.fboRcB;
    gl.useProgram(this.programs.rad);
    gl.uniform1i(gl.getUniformLocation(this.programs.rad, 'uScene'), 0);
    gl.uniform1i(gl.getUniformLocation(this.programs.rad, 'uJfa'), 1);
    gl.uniform1i(gl.getUniformLocation(this.programs.rad, 'uPrevIrrad'), 2);
    gl.uniform1i(gl.getUniformLocation(this.programs.rad, 'uUpper'), 3);
    gl.uniform2f(gl.getUniformLocation(this.programs.rad, 'uSimSize'), w, h);
    gl.uniform1f(gl.getUniformLocation(this.programs.rad, 'uBounce'), bounce);
    gl.uniform1f(gl.getUniformLocation(this.programs.rad, 'uSigma'), 0.0038);
    gl.uniform1f(gl.getUniformLocation(this.programs.rad, 'uHdrScale'), this.hdrScale);
    const uCascadeLoc = gl.getUniformLocation(this.programs.rad, 'uCascade');
    const uSideLoc = gl.getUniformLocation(this.programs.rad, 'uSide');
    const uTStartLoc = gl.getUniformLocation(this.programs.rad, 'uTStart');
    const uTEndLoc = gl.getUniformLocation(this.programs.rad, 'uTEnd');

    bindTex(0, T.scene);
    bindTex(1, jfaSrc);
    bindTex(2, prevIrr);
    for (let c = 3; c >= 0; c--) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, rcOutFbo);
      bindTex(3, rcUpper);
      gl.uniform1i(uCascadeLoc, c);
      gl.uniform1i(uSideLoc, 2 << c);
      gl.uniform1f(uTStartLoc, CASCADE_INTERVALS[c][0]);
      gl.uniform1f(uTEndLoc, CASCADE_INTERVALS[c][1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      [rcUpper, rcOut] = [rcOut, rcUpper];
      [rcUpperFbo, rcOutFbo] = [rcOutFbo, rcUpperFbo];
    }

    // 4. Resolve
    gl.bindFramebuffer(gl.FRAMEBUFFER, nextIrrFbo);
    gl.useProgram(this.programs.resolve);
    bindTex(0, rcUpper);
    gl.uniform1i(gl.getUniformLocation(this.programs.resolve, 'uCascade0'), 0);
    gl.uniform2f(gl.getUniformLocation(this.programs.resolve, 'uSimSize'), w, h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.irradIndex = 1 - this.irradIndex;

    // 5. Composite onto canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.programs.composite);
    bindTex(0, this.domInfo.tex);
    bindTex(1, nextIrr);
    bindTex(2, jfaSrc);
    gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'uDom'), 0);
    gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'uIrrad'), 1);
    gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'uJfa'), 2);
    gl.uniform2f(gl.getUniformLocation(this.programs.composite, 'uSimSize'), w, h);
    gl.uniform1f(gl.getUniformLocation(this.programs.composite, 'uExposure'), exposure);
    gl.uniform1f(gl.getUniformLocation(this.programs.composite, 'uHdrScale'), this.hdrScale);
    gl.uniform1i(gl.getUniformLocation(this.programs.composite, 'uMode'), mode);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  destroy() {
    this.#clearTargets();
    const gl = this.gl;
    if (gl && !gl.isContextLost()) {
      for (const p of Object.values(this.programs)) gl.deleteProgram(p);
      if (this.vao) gl.deleteVertexArray(this.vao);
    }
    this.programs = {};
    this.vao = null;
    this.host.dispose();
  }
}

// ---------------------------------------------------------------------------
// 2D Canvas fallback (no WebGPU and no WebGL 2)
// ---------------------------------------------------------------------------

class Canvas2DStage {
  route = '2d';
  constructor(canvasEl, element) {
    this.canvas = canvasEl;
    this.element = element;
    // Never pass willReadFrequently on a drawable canvas.
    this.ctx = canvasEl.getContext('2d');
    if (!this.ctx) throw new Error('2D canvas context is not available');
  }
  upload() {}
  draw({ exposure = 1.45, mode = 0, cssW = this.canvas.clientWidth || 1, cssH = this.canvas.clientHeight || 1 } = {}) {
    const ctx = this.ctx;
    const dpr = this.canvas.width / Math.max(1, cssW);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#07080d';
    ctx.fillRect(0, 0, cssW, cssH);
    if (mode !== 3) {
      ctx.save();
      ctx.filter = `blur(${Math.round(14 * exposure)}px) brightness(${(1.1 * exposure).toFixed(2)})`;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawElementImage(this.element, 0, 0, cssW, cssH);
      ctx.restore();
    }
    if (mode !== 1) {
      ctx.drawElementImage(this.element, 0, 0, cssW, cssH);
    }
  }
  destroy() {}
}

// ---------------------------------------------------------------------------
// Page lifecycle, routing, sizing, hit-testing and interaction
// ---------------------------------------------------------------------------

function canvasFor(kind) {
  if (contextKind && contextKind !== kind) {
    const old = canvas;
    const fresh = old.cloneNode(false);
    old.replaceWith(fresh);
    fresh.append(sceneEl);
    window.__gfx?.retire(old);
    canvas = fresh;
    watchCanvas();
  }
  contextKind = kind;
  return canvas;
}

function showPlain(reason) {
  routeState.backend = 'plain';
  messageEl.textContent = reason;
  statsEl.textContent = '';
  const box = document.createElement('div');
  box.id = 'plain-stage';
  canvas.replaceWith(box);
  window.__gfx?.retire(canvas);
  box.append(sceneEl);
}

let firstFrames = 0;

async function start(want = choice) {
  choice = want;
  const mine = ++turn;
  stage?.destroy();
  stage = null;
  firstFrames = 0;
  routeState.backend = 'starting';
  routeState.gpuNote = '';
  messageEl.textContent = '';

  if (!supported) {
    return showPlain('HTML-in-canvas is not available in this browser, so the gallery is shown as plain HTML.');
  }

  const order = want === '2d' ? ['2d'] : want === 'webgl' ? ['webgl', '2d'] : want === 'webgpu' ? ['webgpu', 'webgl', '2d'] : ['webgpu', 'webgl', '2d'];
  let problem = '';

  for (const route of order) {
    try {
      let made = null;
      if (route === 'webgpu') {
        const gpu = await webgpu();
        if (!gpu) {
          routeState.gpuNote ||= webgpu.reason || 'WebGPU is not usable on this device';
          continue;
        }
        if (!supportedGPU) {
          routeState.gpuNote = 'this browser has no GPUQueue.drawElementImageToTexture()';
          continue;
        }
        made = await GPURadiosityStage.create(canvasFor('webgpu'), gpu, sceneEl);
      } else if (route === 'webgl') {
        if (!webgl2() || !glSupported) {
          problem = 'WebGL 2 texElementSubImage2D() is not available';
          continue;
        }
        made = new GLRadiosityStage(canvasFor('webgl2'), sceneEl, {
          onLost: () => { messageEl.textContent = 'The WebGL context was lost. It will redraw when restored.'; },
          onRestored: () => { messageEl.textContent = ''; dirty = true; settleFrames = 8; schedule(); },
        });
      } else {
        made = new Canvas2DStage(canvasFor('2d'), sceneEl);
      }
      if (mine !== turn) { made.destroy(); return; }
      stage = made;
      routeState.backend = made.route;
      break;
    } catch (err) {
      problem = err.message;
      if (route === 'webgpu') routeState.gpuNote = err.message;
    }
  }

  if (mine !== turn) return;
  if (!stage) {
    return showPlain(`No canvas route could draw this gallery (${problem || routeState.gpuNote}), so it is shown as plain HTML.`);
  }
  resize();
  dirty = true;
  settleFrames = 10;
  canvas.requestPaint?.();
  schedule();
  routeCtrl?.show();
}

function fallBackFromWebGPU(reason) {
  if (!stage || stage.route !== 'webgpu') return;
  const note = reason;
  start('webgl').then(() => {
    routeState.gpuNote = note;
    routeCtrl?.show();
  });
}

addEventListener('webgpulost', () => fallBackFromWebGPU(webgpu.reason || 'the WebGPU device was lost'));

let deviceSize = null;
const sizes = new ResizeObserver((entries) => {
  const box = entries.at(-1).devicePixelContentBoxSize?.[0];
  deviceSize = box ? { w: box.inlineSize, h: box.blockSize } : null;
  resize();
  dirty = true;
  settleFrames = 8;
  schedule();
});

let visible = true;
const seen = new IntersectionObserver((entries) => {
  visible = entries.at(-1).isIntersecting;
  if (visible && (dirty || settleFrames > 0 || orbiting)) schedule();
});

function resize() {
  if (!canvas.isConnected || !canvas.clientWidth) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const exact = deviceSize && Math.abs(deviceSize.w / (canvas.clientWidth * dpr) - 1) < 0.02;
  const w = Math.max(2, exact ? deviceSize.w : Math.round(canvas.clientWidth * dpr));
  const h = Math.max(2, exact ? deviceSize.h : Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  placedKey = '';
}

function watchCanvas() {
  canvas.addEventListener('paint', () => {
    dirty = true;
    settleFrames = Math.max(settleFrames, 8);
    schedule();
  });
  sizes.observe(canvas, { box: 'device-pixel-content-box' });
  seen.observe(canvas);
}

// #region composite
// Keep the live HTML container's hit box aligned with the drawn canvas and clear
// Chromium's hit-test cache whenever a pillar or lamp moves.
let geomUnit = 1;
let placedKey = '';
let hitTick = 0;

function syncGeometry(forceTick = false) {
  if (!canvas.updateElementGeometry || !sceneEl.isConnected) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const key = `${cw}x${ch}:${geomUnit}`;
  if (key !== placedKey || forceTick) {
    placedKey = key;
    const apply = () => canvas.updateElementGeometry(sceneEl, { canvasTransform: new DOMMatrix().scale(geomUnit) });
    apply();
    const drawn = sceneEl.getBoundingClientRect().width;
    if (drawn > 0 && cw > 0 && Math.abs(drawn / cw - 1) > 0.1) {
      geomUnit *= cw / drawn;
      apply();
    }
    if (forceTick) {
      sceneEl.dataset.hitTick = String(++hitTick);
    }
  }
}
// #endregion composite

let dirty = true;
let settleFrames = 10;
let raf = 0;
let orbiting = false;
let orbitPhase = 0;
let lastFrameAt = 0;

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && (dirty || settleFrames > 0 || orbiting)) schedule();
});

function schedule() {
  if (!raf && stage && visible && !document.hidden) raf = requestAnimationFrame(frame);
}

function frame(now) {
  raf = 0;
  if (!stage || !canvas.isConnected) return;

  const dt = Math.min(0.1, lastFrameAt ? (now - lastFrameAt) / 1000 : 0.016);
  lastFrameAt = now;

  if (orbiting) {
    orbitPhase += dt * 0.85;
    const a = sceneEl.querySelector('.lamp-amber');
    const c = sceneEl.querySelector('.lamp-cyan');
    const r = sceneEl.querySelector('.lamp-rose');
    if (a) { a.style.left = `${(18 + 9 * Math.cos(orbitPhase)).toFixed(2)}%`; a.style.top = `${(70 + 14 * Math.sin(orbitPhase)).toFixed(2)}%`; }
    if (c) { c.style.left = `${(82 + 9 * Math.cos(orbitPhase + 2.1)).toFixed(2)}%`; c.style.top = `${(70 + 14 * Math.sin(orbitPhase + 2.1)).toFixed(2)}%`; }
    if (r) { r.style.left = `${(50 + 26 * Math.sin(orbitPhase * 0.7)).toFixed(2)}%`; r.style.top = `${(86 + 5 * Math.cos(orbitPhase * 1.4)).toFixed(2)}%`; }
    canvas.requestPaint?.();
    dirty = true;
  }

  if (dirty) {
    try {
      stage.upload();
      dirty = false;
    } catch {
      canvas.requestPaint?.();
      return;
    }
  }

  const opts = {
    exposure: Number(exposureSlider.value),
    bounce: Number(bounceSlider.value),
    mode: VIEW_MODES[viewSelect.value] ?? 0,
    cssW: canvas.clientWidth,
    cssH: canvas.clientHeight,
  };

  if (stage.route === 'webgpu' && firstFrames < 2) {
    firstFrames++;
    watchFrame(stage.device, () => stage.draw(opts), fallBackFromWebGPU);
    stage.surface.shown(fallBackFromWebGPU);
  } else {
    stage.draw(opts);
  }

  syncGeometry(orbiting);

  const simText = stage.simW ? `Grid ${stage.simW}×${stage.simH} · 4 cascades (256 rays) · JFA ${jfaSteps(stage.simW, stage.simH).length} passes` : '2D blur fallback';
  const targetStats = `${stage.route.toUpperCase()} · Canvas ${canvas.width}×${canvas.height} · ${simText}`;
  if (statsEl.textContent !== targetStats) statsEl.textContent = targetStats;

  if (settleFrames > 0) settleFrames--;
  if (orbiting || dirty || settleFrames > 0) schedule();
}

// ---------------------------------------------------------------------------
// Interactive DOM gallery controls (typing, toggling lamps, dragging pillars)
// ---------------------------------------------------------------------------

function markDirty(hitMoved = false) {
  dirty = true;
  settleFrames = 10;
  if (hitMoved) syncGeometry(true);
  canvas.requestPaint?.();
  schedule();
}

neonInput.addEventListener('input', () => markDirty(false));
hueSlider.addEventListener('input', () => {
  sceneEl.style.setProperty('--neon-hue', hueSlider.value);
  markDirty(false);
});
exposureSlider.addEventListener('input', () => { settleFrames = 4; schedule(); });
bounceSlider.addEventListener('input', () => { settleFrames = 10; schedule(); });
viewSelect.addEventListener('change', () => { settleFrames = 2; schedule(); });

orbitBtn.addEventListener('click', () => {
  orbiting = !orbiting;
  orbitBtn.setAttribute('aria-pressed', String(orbiting));
  orbitBtn.textContent = orbiting ? 'Stop orbit' : 'Orbit lamps';
  lastFrameAt = 0;
  schedule();
});

resetBtn.addEventListener('click', () => {
  orbiting = false;
  orbitBtn.setAttribute('aria-pressed', 'false');
  orbitBtn.textContent = 'Orbit lamps';
  neonInput.value = 'LIGHT';
  hueSlider.value = '18';
  sceneEl.style.setProperty('--neon-hue', '18');
  exposureSlider.value = '1.45';
  bounceSlider.value = '0.35';
  viewSelect.value = 'radiosity';
  for (const [id, pos] of Object.entries(DEFAULT_POS)) {
    const p = $(id);
    if (p) { p.style.left = pos.left; p.style.top = pos.top; }
  }
  for (const lamp of sceneEl.querySelectorAll('.lamp')) {
    lamp.classList.add('lit');
    lamp.setAttribute('aria-pressed', 'true');
    const def = DEFAULT_LAMPS[lamp.dataset.lamp];
    if (def) { lamp.style.left = `${def.left}%`; lamp.style.top = `${def.top}%`; }
  }
  for (const sw of sceneEl.querySelectorAll('.pillar-switch')) {
    sw.classList.remove('lit-emerald', 'lit-gold');
    sw.setAttribute('aria-pressed', 'false');
  }
  markDirty(true);
});

for (const lamp of sceneEl.querySelectorAll('.lamp')) {
  lamp.addEventListener('click', () => {
    const on = lamp.classList.toggle('lit');
    lamp.setAttribute('aria-pressed', String(on));
    markDirty(false);
  });
}

for (const sw of sceneEl.querySelectorAll('.pillar-switch')) {
  sw.addEventListener('pointerdown', (e) => e.stopPropagation());
  sw.addEventListener('click', (e) => {
    e.stopPropagation();
    const cls = sw.dataset.switch === 'a' ? 'lit-emerald' : 'lit-gold';
    const on = sw.classList.toggle(cls);
    sw.setAttribute('aria-pressed', String(on));
    markDirty(false);
  });
}

let dragging = null;
for (const pillar of sceneEl.querySelectorAll('.pillar')) {
  pillar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const rect = (canvas.isConnected ? canvas : sceneEl).getBoundingClientRect();
    const pRect = pillar.getBoundingClientRect();
    const cx = pRect.left + pRect.width / 2;
    const cy = pRect.top + pRect.height / 2;
    dragging = { el: pillar, id: e.pointerId, dx: cx - e.clientX, dy: cy - e.clientY, rect };
    try { pillar.setPointerCapture(e.pointerId); } catch {}
  });
}

window.addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragging.id) return;
  const r = (canvas.isConnected ? canvas : sceneEl).getBoundingClientRect();
  const x = Math.max(8, Math.min(92, ((e.clientX + dragging.dx - r.left) / Math.max(1, r.width)) * 100));
  const y = Math.max(26, Math.min(86, ((e.clientY + dragging.dy - r.top) / Math.max(1, r.height)) * 100));
  dragging.el.style.left = `${x.toFixed(2)}%`;
  dragging.el.style.top = `${y.toFixed(2)}%`;
  markDirty(true);
});

function stopDrag(e) {
  if (!dragging || e.pointerId !== dragging.id) return;
  dragging = null;
  syncGeometry(true);
}
window.addEventListener('pointerup', stopDrag);
window.addEventListener('pointercancel', stopDrag);

// ---------------------------------------------------------------------------
// Start the visible demo
// ---------------------------------------------------------------------------

watchCanvas();
const routeCtrl = routeSwitch($('route'), {
  targets: () => [routeState],
  values: { webgpu: 'webgpu', webgl: 'webgl', '2d': '2d' },
  active: (s) => s.backend,
  note: (s) => s.gpuNote,
  apply: (want) => start(want),
});
if (!turn) start('');

// ---------------------------------------------------------------------------
// Live checks (wait for a tap via <meta name="checks" content="tap">)
// ---------------------------------------------------------------------------

// #region checks
const bench = supported ? checkBench() : null;

async function makeWebGPUFixture(w, h, html) {
  const c = document.createElement('canvas');
  c.setAttribute('content', 'drawable');
  c.setAttribute('layoutsubtree', '');
  c.width = w;
  c.height = h;
  c.style.cssText = `display:block;width:${w}px;height:${h}px`;
  const box = document.createElement('div');
  box.setAttribute('drawable', '');
  box.style.cssText = `position:relative;width:${w}px;height:${h}px;background:transparent;overflow:hidden`;
  box.innerHTML = html;
  c.append(box);
  bench.append(c);
  const gpu = await checkDevice();
  if (!gpu) throw new Error(`no WebGPU device (${webgpu.reason || 'unavailable'})`);
  if (!supportedGPU) throw new Error('GPUQueue.drawElementImageToTexture() is not available');
  const ctx = c.getContext('webgpu');
  if (!ctx) throw new Error('the fixture canvas gave no WebGPU context');
  ctx.configure({ device: gpu.device, format: gpu.format, alphaMode: 'premultiplied' });
  await nextPaint(c);
  const sz = c.getElementImageDefaultSize(box);
  return {
    canvas: c,
    el: box,
    gpu,
    device: gpu.device,
    w: Math.max(1, Math.ceil(sz.width)),
    h: Math.max(1, Math.ceil(sz.height)),
    retire() {
      try { ctx.unconfigure(); } catch {}
      c.remove();
      window.__gfx?.retire(c);
    },
  };
}

async function readStorageBuffer(device, srcBuf, byteLength) {
  const staging = device.createBuffer({ size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const enc = device.createCommandEncoder();
  enc.copyBufferToBuffer(srcBuf, 0, staging, 0, byteLength);
  device.queue.submit([enc.finish()]);
  await staging.mapAsync(GPUMapMode.READ);
  const out = new Float32Array(staging.getMappedRange().slice(0));
  staging.unmap();
  staging.destroy();
  return out;
}

const tests = [
  {
    name: 'drawElementImageToTexture() accepts TEXTURE_BINDING | COPY_DST',
    why: 'Probes whether an rgba8unorm upload target needs only TEXTURE_BINDING | COPY_DST, or also RENDER_ATTACHMENT.',
    timeout: 12000,
    async run() {
      const fx = await makeWebGPUFixture(128, 64, '<div style="width:100%;height:100%;background:#ff6622"></div>');
      let tex1 = null, tex2 = null;
      try {
        const d = fx.device;
        tex1 = d.createTexture({
          size: [fx.w, fx.h],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
        d.pushErrorScope('validation');
        uploadElement(d, fx.el, tex1);
        const err1 = await d.popErrorScope();
        if (!err1) {
          return `${gpuMethod}() accepted TEXTURE_BINDING | COPY_DST directly (${fx.w}×${fx.h})`;
        }
        tex2 = d.createTexture({
          size: [fx.w, fx.h],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        d.pushErrorScope('validation');
        uploadElement(d, fx.el, tex2);
        const err2 = await d.popErrorScope();
        if (err2) throw new Error(`also failed with RENDER_ATTACHMENT: ${err2.message.split('\n')[0]}`);
        return `TEXTURE_BINDING | COPY_DST alone was rejected (${err1.message.split('\n')[0]}); adding RENDER_ATTACHMENT succeeded (${fx.w}×${fx.h})`;
      } finally {
        tex1?.destroy();
        tex2?.destroy();
        fx.retire();
      }
    },
  },
  {
    name: 'drawElementImageToTexture() accepts STORAGE_BINDING on the target texture',
    why: 'Checks whether an rgba8unorm texture created with STORAGE_BINDING can receive a live HTML upload directly without a copy.',
    timeout: 12000,
    async run() {
      const fx = await makeWebGPUFixture(128, 64, '<div style="width:100%;height:100%;background:#00ddff"></div>');
      let tex = null;
      try {
        const d = fx.device;
        d.pushErrorScope('validation');
        tex = d.createTexture({
          size: [fx.w, fx.h],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.STORAGE_BINDING,
        });
        uploadElement(d, fx.el, tex);
        const err = await d.popErrorScope();
        if (err) throw new Error(err.message.split('\n')[0]);
        return `${gpuMethod}() accepted STORAGE_BINDING directly on rgba8unorm (${fx.w}×${fx.h}); no copy pass needed`;
      } finally {
        tex?.destroy();
        fx.retire();
      }
    },
  },
  {
    name: 'WGSL @compute textureLoad() reads live HTML pixels (premultiplied alpha)',
    why: 'Uploads a solid orange half and a 50% alpha orange half, reads both inside a @compute shader with textureLoad(), and inspects the RGB/alpha values.',
    timeout: 12000,
    async run() {
      const fx = await makeWebGPUFixture(
        128,
        64,
        '<div style="position:absolute;left:0;top:0;width:64px;height:64px;background:rgb(255,100,40)"></div>' +
        '<div style="position:absolute;left:64px;top:0;width:64px;height:64px;background:rgba(255,100,40,0.5)"></div>',
      );
      let tex = null, outBuf = null;
      try {
        const d = fx.device;
        tex = d.createTexture({
          size: [fx.w, fx.h],
          format: 'rgba8unorm',
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });
        uploadElement(d, fx.el, tex);

        const mod = await checkWGSL(d, /* wgsl */ `
          @group(0) @binding(0) var domTex: texture_2d<f32>;
          @group(0) @binding(1) var<storage, read_write> outData: array<vec4f, 2>;
          @compute @workgroup_size(1)
          fn main() {
            let dims = vec2i(textureDimensions(domTex));
            outData[0] = textureLoad(domTex, vec2i(dims.x / 4, dims.y / 2), 0);
            outData[1] = textureLoad(domTex, vec2i((dims.x * 3) / 4, dims.y / 2), 0);
          }
        `, 'probe-load');
        const pipe = d.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
        outBuf = d.createBuffer({ size: 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const bg = d.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: tex.createView() },
            { binding: 1, resource: { buffer: outBuf } },
          ],
        });
        const enc = d.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(1);
        pass.end();
        d.queue.submit([enc.finish()]);

        const vals = await readStorageBuffer(d, outBuf, 32);
        const [sr, sg, sb, sa, hr, hg, hb, ha] = vals;
        if (sr < 0.7 || sa < 0.9) throw new Error(`solid pixel unexpected: (${sr.toFixed(2)}, ${sg.toFixed(2)}, ${sb.toFixed(2)}, ${sa.toFixed(2)})`);
        if (ha < 0.35 || ha > 0.65) throw new Error(`half-alpha pixel unexpected: alpha ${ha.toFixed(2)}`);
        const convention = hr <= ha + 0.08 ? 'premultiplied' : 'straight';
        return `solid (${sr.toFixed(2)}, ${sg.toFixed(2)}, ${sb.toFixed(2)}, ${sa.toFixed(2)}); 50% alpha (${hr.toFixed(2)}, ${hg.toFixed(2)}, ${hb.toFixed(2)}, ${ha.toFixed(2)}) -> ${convention} alpha`;
      } finally {
        outBuf?.destroy();
        tex?.destroy();
        fx.retire();
      }
    },
  },
  {
    name: 'JFA + Radiance Cascades compute passes separate lit and shadowed regions',
    why: 'Runs Seed -> JFA -> 4 Radiance Cascades -> Resolve off screen on a fixture with a left emitter and a central dark pillar, then compares lit vs shadowed irradiance.',
    timeout: 15000,
    async run() {
      const fx = await makeWebGPUFixture(
        256,
        128,
        '<div style="position:absolute;left:16px;top:24px;width:24px;height:80px;background:#00e5ff"></div>' +
        '<div style="position:absolute;left:112px;top:14px;width:28px;height:100px;background:#10131b"></div>',
      );
      let gpuStage = null, outBuf = null;
      try {
        gpuStage = await GPURadiosityStage.create(fx.canvas, fx.gpu, fx.el, { present: false, maxSide: 256 });
        gpuStage.upload();
        gpuStage.draw({ exposure: 1.5, bounce: 0.0, mode: 0, cssW: 256, cssH: 128 });

        const d = fx.device;
        const mod = await checkWGSL(d, /* wgsl */ `
          @group(0) @binding(0) var irradTex: texture_2d<f32>;
          @group(0) @binding(1) var jfaTex: texture_2d<f32>;
          @group(0) @binding(2) var<storage, read_write> outData: array<vec4f, 3>;
          @compute @workgroup_size(1)
          fn main() {
            let dims = vec2i(textureDimensions(irradTex));
            let litCoord = vec2i((dims.x * 74) / 256, dims.y / 2);
            let shdCoord = vec2i((dims.x * 196) / 256, dims.y / 2);
            outData[0] = textureLoad(irradTex, litCoord, 0);
            outData[1] = textureLoad(irradTex, shdCoord, 0);
            outData[2] = textureLoad(jfaTex, litCoord, 0);
          }
        `, 'probe-gi');
        const pipe = d.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
        outBuf = d.createBuffer({ size: 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
        const bg = d.createBindGroup({
          layout: pipe.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: gpuStage.lastIrrad.createView() },
            { binding: 1, resource: gpuStage.lastJfa.createView() },
            { binding: 2, resource: { buffer: outBuf } },
          ],
        });
        const enc = d.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipe);
        pass.setBindGroup(0, bg);
        pass.dispatchWorkgroups(1);
        pass.end();
        d.queue.submit([enc.finish()]);

        const v = await readStorageBuffer(d, outBuf, 48);
        const litLuma = v[0] * 0.2126 + v[1] * 0.7152 + v[2] * 0.0722;
        const shdLuma = v[4] * 0.2126 + v[5] * 0.7152 + v[6] * 0.0722;
        const sdfDist = v[11];
        if (litLuma < 0.05) throw new Error(`lit region irradiance too low (${litLuma.toFixed(4)})`);
        if (litLuma <= shdLuma * 1.6) throw new Error(`shadow contrast too weak: lit ${litLuma.toFixed(4)} vs shadowed ${shdLuma.toFixed(4)}`);
        if (!(sdfDist > 5 && sdfDist < 120)) throw new Error(`unexpected JFA distance at lit probe: ${sdfDist.toFixed(2)}`);
        const ratio = litLuma / Math.max(0.0001, shdLuma);
        return `lit ${litLuma.toFixed(3)} vs shadowed ${shdLuma.toFixed(3)} (${ratio.toFixed(1)}× contrast); JFA distance at lit probe ${sdfDist.toFixed(1)} cells`;
      } finally {
        outBuf?.destroy();
        gpuStage?.destroy();
        fx.retire();
      }
    },
  },
  {
    name: 'updateElementGeometry() hit-tests the live input and lamp button',
    why: 'Draws a fixture gallery with an emissive input and button, updates geometry, and checks document.elementFromPoint() at their centres.',
    timeout: 10000,
    async run() {
      const c = document.createElement('canvas');
      c.setAttribute('content', 'drawable');
      c.setAttribute('layoutsubtree', '');
      c.width = 260;
      c.height = 120;
      c.style.cssText = 'display:block;width:260px;height:120px';
      const box = document.createElement('div');
      box.setAttribute('drawable', '');
      box.style.cssText = 'position:relative;width:260px;height:120px;background:#07080d';
      box.innerHTML =
        '<input type="text" value="RAY" aria-label="Test input" style="position:absolute;left:20px;top:16px;width:220px;height:36px;color:#ff6b1a;background:transparent;border:1px solid #ff6b1a">' +
        '<button type="button" style="position:absolute;left:70px;top:66px;width:120px;height:40px;background:#00d8ff;color:#021820;border:0;border-radius:20px">Lamp</button>';
      c.append(box);
      bench.append(c);
      try {
        const ctx = c.getContext('2d');
        await nextPaint(c);
        ctx.drawElementImage(box, 0, 0, 260, 120);
        c.updateElementGeometry?.(box, { canvasTransform: new DOMMatrix() });
        box.dataset.hitTick = '1';
        const rect = c.getBoundingClientRect();
        const inp = box.querySelector('input');
        const btn = box.querySelector('button');
        const hitInput = document.elementFromPoint(rect.left + 130, rect.top + 34);
        const hitBtn = document.elementFromPoint(rect.left + 130, rect.top + 86);
        if (hitInput !== inp) throw new Error(`input point hit ${hitInput ? hitInput.tagName : 'nothing'}`);
        if (hitBtn !== btn) throw new Error(`button point hit ${hitBtn ? hitBtn.tagName : 'nothing'}`);
        return 'elementFromPoint() hit both the live <input> and <button> after updateElementGeometry()';
      } finally {
        c.remove();
        window.__gfx?.retire(c);
      }
    },
  },
  {
    name: 'The gallery canvas above still has a picture',
    why: 'Run last, after all fixtures are retired. Copies a 48×48 probe from the visible canvas to confirm it is still drawing.',
    timeout: 10000,
    async run() {
      if (routeState.backend === 'plain') throw new Error('the page is showing plain HTML');
      if (!stage) throw new Error('no backend is active');
      cancelAnimationFrame(raf);
      raf = 0;
      dirty = true;
      frame(performance.now());
      const probe = new OffscreenCanvas(48, 48).getContext('2d', { willReadFrequently: true });
      probe.drawImage(canvas, 0, 0, 48, 48);
      const d = probe.getImageData(0, 0, 48, 48).data;
      let lit = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 8 && (d[i] > 18 || d[i + 1] > 18 || d[i + 2] > 28)) lit++;
      }
      if (!lit) throw new Error(`the ${routeState.backend} canvas has no lit pixels`);
      return `drawn with ${routeState.backend}, ${Math.round((lit / 2304) * 100)}% of sampled pixels carry light or DOM content`;
    },
  },
];

if (supported) {
  runTests($('results'), onBench(bench, tests)).then(() => bench?.done());
} else {
  runTests($('results'), [
    {
      name: 'HTML-in-canvas is available',
      why: 'The live checks require canvas[layoutsubtree] and drawElementImageToTexture().',
      run: async () => { throw new Error('not available in this browser'); },
    },
  ]);
}
// #endregion checks
