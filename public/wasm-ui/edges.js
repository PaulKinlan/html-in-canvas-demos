// edges.js: one Sobel edge filter, written twice. Once as a WebNN graph, once as the C function
// edges() in ui.c. Both read the pixels that the toolkit drew for one DOM element.

/** The pixels the program last drew for an element, at the canvas's device resolution. */
export function grab(ui, name) {
  const rect = ui.rect(name);
  if (!rect) throw new Error(`"${name}" is not drawn`);
  const s = ui.scale();
  const max = ui.exports.max_pixels();
  const w = Math.min(1024, Math.round(rect.w * s));
  const h = Math.min(Math.round(rect.h * s), Math.floor(max / w));
  return ui.ctx.getImageData(Math.round(rect.x * s), Math.round(rect.y * s), w, h);
}

// #region wasm-edges
/** The filter in WebAssembly. This calls into the module while its run() is suspended. */
export function wasmEdges(ui, image) {
  const { memory, pixels_ptr, edges_ptr, edges } = ui.exports;
  const t0 = performance.now();
  new Uint8Array(memory.buffer, pixels_ptr(), image.data.length).set(image.data);
  const lit = edges(image.width, image.height);
  if (lit < 0) throw new Error('the image is larger than the buffer in ui.c');
  const out = new Uint8ClampedArray(memory.buffer, edges_ptr(), image.data.length).slice();
  return { image: new ImageData(out, image.width, image.height), lit, ms: performance.now() - t0 };
}
// #endregion wasm-edges

// #region webnn-edges
let cached = null; // { key, context, graph, input, output }

/** The filter as a WebNN graph: cast, transpose to NCHW, one 3x3 convolution with two filters, L2 norm. */
async function build(width, height) {
  const context = await navigator.ml.createContext();
  const builder = new MLGraphBuilder(context);
  const shape = [1, height, width, 4];
  const pixels = builder.input('pixels', { dataType: 'uint8', shape });
  const nchw = builder.transpose(builder.cast(pixels, 'float32'), { permutation: [0, 3, 1, 2] });
  // Two filters over four channels (R, G, B, A): Sobel x and Sobel y of the luminance.
  const sx = [-1, 0, 1, -2, 0, 2, -1, 0, 1], sy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const weights = new Float32Array(2 * 4 * 9);
  [sx, sy].forEach((kernel, f) => [0.299, 0.587, 0.114, 0].forEach((luma, c) => {
    kernel.forEach((k, i) => (weights[f * 36 + c * 9 + i] = k * luma));
  }));
  const filter = builder.constant({ dataType: 'float32', shape: [2, 4, 3, 3] }, weights);
  const gradients = builder.conv2d(nchw, filter, { padding: [1, 1, 1, 1] });
  const magnitude = builder.reduceL2(gradients, { axes: [1], keepDimensions: true });
  const edges = builder.clamp(magnitude, { minValue: 0, maxValue: 255 });
  const graph = await builder.build({ edges });
  const input = await context.createTensor({ dataType: 'uint8', shape, writable: true });
  const output = await context.createTensor({ dataType: 'float32', shape: [1, 1, height, width], readable: true });
  return { key: `${width}x${height}`, context, graph, input, output };
}

export async function webnnEdges(image) {
  if (!navigator.ml) throw new Error('navigator.ml is missing in this browser');
  const first = cached?.key !== `${image.width}x${image.height}`;
  const t0 = performance.now();
  if (first) cached = await build(image.width, image.height);
  const t1 = performance.now();
  const { context, graph, input, output } = cached;
  context.writeTensor(input, new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.length));
  context.dispatch(graph, { pixels: input }, { edges: output });
  const values = new Float32Array(await context.readTensor(output));
  const out = new Uint8ClampedArray(image.data.length);
  let lit = 0;
  for (let i = 0; i < values.length; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = values[i];
    out[i * 4 + 3] = 255;
    if (values[i] > 64) lit++;
  }
  return { image: new ImageData(out, image.width, image.height), lit, ms: performance.now() - t1, buildMs: first ? t1 - t0 : 0 };
}
// #endregion webnn-edges
