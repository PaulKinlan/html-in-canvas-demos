// compositor.js: a worker that composes video frames and DOM snapshots into a video track.
//
// The page transfers three things to this worker:
//   1. The OffscreenCanvas of a <canvas content="drawable"> (transferControlToOffscreen()).
//      An ElementImage draws only into the canvas it was captured from, so the output
//      canvas has to be that one.
//   2. A source of VideoFrames: a MediaStreamTrack (the worker makes a MediaStreamTrackProcessor),
//      or the ReadableStream of a MediaStreamTrackProcessor made on the main thread,
//      or single VideoFrames posted one at a time. The worker can also make its own frames:
//      it reads a WebM file and decodes it with VideoDecoder, or draws a test pattern.
//   3. A place to write: the WritableStream of a MediaStreamTrackGenerator made on the main
//      thread. Where the worker has VideoTrackGenerator it makes the track itself and
//      transfers it back.
// On every paint the page also transfers an ElementImage of the overlay scene.
//
// Messages with an `id` are answered with { id, ok, ... }.

let canvas = null, ctx = null, W = 640, H = 360;
let scene = null;          // the latest ElementImage of the overlay scene
let panels = [];           // boxes of the overlay panels in scene pixels: { x, y, w, h, r }
let look = 'plain';
let writer = null, generator = null;
let convert = 'auto';      // how a VideoFrame becomes something a 2D context draws: auto, bitmap, draw, copy
let paused = false;        // the page sets this while the canvas is off screen
let run = 0;               // changes when the source changes, which ends the old read loop
let small = null;          // a 64 by 36 canvas for the mosaic look
const stats = { read: 0, written: 0, skipped: 0, scenes: 0, drawMs: 0, error: '', format: '', convert: '' };
const log = { read: [], written: [], counted: [], stampsIn: [], stampsOut: [], stampsCounted: [] };
const now = () => performance.timeOrigin + performance.now();
const keep = (list, value) => { list.push(value); if (list.length > 900) list.splice(0, 300); };

/** Draw a frame so that it covers the canvas, cropping what does not fit. */
function cover(c, frame, w = W, h = H) {
  const fw = frame.displayWidth ?? frame.width, fh = frame.displayHeight ?? frame.height;
  const s = Math.max(w / fw, h / fh);
  c.drawImage(frame, (w - fw * s) / 2, (h - fh * s) / 2, fw * s, fh * s);
}

// #region looks
// Each look draws the video frame. The overlay scene is drawn after it, except where a look draws it itself.
const LOOKS = {
  plain(frame) {
    cover(ctx, frame);
  },
  // The frame is drawn again, blurred, inside the box of each overlay panel.
  frosted(frame) {
    cover(ctx, frame);
    for (const p of panels) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, p.r);
      ctx.clip();
      ctx.filter = 'blur(9px) saturate(1.8) brightness(0.7)';
      cover(ctx, frame);
      ctx.restore();
    }
  },
  // The frame is shrunk to 64 by 36 and drawn back without smoothing. The panels show the full frame.
  mosaic(frame) {
    small ??= new OffscreenCanvas(64, 36);
    const sc = small.getContext('2d');
    cover(sc, frame, 64, 36);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, W, H);
    ctx.imageSmoothingEnabled = true;
    for (const p of panels) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, p.r);
      ctx.clip();
      cover(ctx, frame);
      ctx.restore();
    }
  },
  // The canvas is not cleared. Each frame is drawn at 16% opacity, so movement leaves a trail.
  trails(frame) {
    ctx.globalAlpha = 0.16;
    cover(ctx, frame);
    ctx.globalAlpha = 1;
  },
  // The scene is a mask. The frame is kept at full strength where the scene has pixels,
  // and is grey and dark everywhere else. The scene is then drawn over it at 45%.
  cutout(frame) {
    if (!scene) return cover(ctx, frame);
    ctx.clearRect(0, 0, W, H);
    ctx.drawElementImage(scene, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-in';
    cover(ctx, frame);
    ctx.globalCompositeOperation = 'destination-over';
    ctx.filter = 'grayscale(1) brightness(0.35)';
    cover(ctx, frame);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 0.45;
    ctx.drawElementImage(scene, 0, 0, W, H);
    ctx.globalAlpha = 1;
    return true; // the scene is already drawn
  },
};
// #endregion looks

// #region compose
/** One output frame: the video frame, the DOM snapshot over it, and a VideoFrame of the result. */
async function compose(frame) {
  if (!ctx) return;
  const t0 = performance.now();
  const picture = await drawable(frame);
  const sceneDrawn = (LOOKS[look] ?? LOOKS.plain)(picture);
  if (picture instanceof ImageBitmap) picture.close();
  // Drawing the snapshot here also moves the element's hit-test box on the main thread.
  if (scene && !sceneDrawn) ctx.drawElementImage(scene, 0, 0, W, H);
  if (writer) {
    if (writer.desiredSize !== null && writer.desiredSize <= 0) {
      stats.skipped++; // the track has not taken the last frame yet
    } else {
      const out = new VideoFrame(canvas, { timestamp: frame.timestamp ?? Math.round(performance.now() * 1000) });
      keep(log.stampsOut, out.timestamp);
      writer.write(out).then(() => out.close(), (err) => { out.close(); stats.error = String(err); });
      stats.written++;
      keep(log.written, now());
    }
  }
  stats.drawMs += (performance.now() - t0 - stats.drawMs) / 20; // running mean
}
// #endregion compose

// #region convert
// A 2D context needs RGB. In Chromium 157 with software rendering, drawImage(VideoFrame),
// createImageBitmap(VideoFrame) and texImage2D(VideoFrame) of a YUV frame in a worker all wait for
// the main thread. copyTo() in the frame's own format does not, so 'copy' reads the planes and
// converts them here.
const YUV = new Set(['I420', 'I420A', 'NV12']);
let stage = null, stageCtx = null, rgba = null, planes = null, mapX = null, mapY = null, mapKey = '';

async function drawable(frame) {
  const mode = convert === 'auto' ? (YUV.has(frame.format) ? 'copy' : 'bitmap') : convert === 'copy' && !YUV.has(frame.format) ? 'bitmap' : convert;
  stats.format = `${frame.format ?? 'no format'} ${frame.displayWidth}×${frame.displayHeight}`;
  stats.convert = mode;
  if (mode === 'draw') return frame;
  if (mode === 'bitmap') return createImageBitmap(frame);
  return viaCopy(frame);
}

/** copyTo() the Y, U and V planes and convert them to RGB, cropped to cover the output size. Returns a canvas. */
async function viaCopy(frame) {
  stage ??= new OffscreenCanvas(W, H);
  stageCtx ??= stage.getContext('2d');
  rgba ??= new ImageData(W, H);
  const fw = frame.visibleRect.width, fh = frame.visibleRect.height;
  const size = frame.allocationSize();
  if (!planes || planes.length < size) planes = new Uint8Array(size);
  const [Y, U, V] = await frame.copyTo(planes);
  if (mapKey !== `${fw}×${fh}`) {
    // Which source column and row each output pixel takes: nearest neighbour, centred.
    mapKey = `${fw}×${fh}`;
    const s = Math.max(W / fw, H / fh);
    mapX = Int32Array.from({ length: W }, (_, x) => Math.min(fw - 1, Math.max(0, Math.floor((fw - W / s) / 2 + x / s))));
    mapY = Int32Array.from({ length: H }, (_, y) => Math.min(fh - 1, Math.max(0, Math.floor((fh - H / s) / 2 + y / s))));
  }
  const nv12 = frame.format === 'NV12', full = !!frame.colorSpace?.fullRange, hd = frame.colorSpace?.matrix === 'bt709';
  const [rv, gu, gv, bu] = full ? (hd ? [1.5748, 0.1873, 0.4681, 1.8556] : [1.402, 0.344, 0.714, 1.772]) : (hd ? [1.793, 0.213, 0.533, 2.112] : [1.596, 0.392, 0.813, 2.017]);
  const out = rgba.data, src = planes;
  let o = 0;
  for (let y = 0; y < H; y++) {
    const sy = mapY[y], yo = Y.offset + sy * Y.stride, uo = U.offset + (sy >> 1) * U.stride, vo = nv12 ? 0 : V.offset + (sy >> 1) * V.stride;
    for (let x = 0; x < W; x++) {
      const sx = mapX[x], cx = sx >> 1;
      const c = full ? src[yo + sx] : 1.164 * (src[yo + sx] - 16);
      const d = (nv12 ? src[uo + cx * 2] : src[uo + cx]) - 128, e = (nv12 ? src[uo + cx * 2 + 1] : src[vo + cx]) - 128;
      out[o++] = c + rv * e;
      out[o++] = c - gu * d - gv * e;
      out[o++] = c + bu * d;
      out[o++] = 255;
    }
  }
  stageCtx.putImageData(rgba, 0, 0);
  return stage;
}
// #endregion convert

/** Take one frame from any source: count it, compose it, close it. */
async function take(frame) {
  stats.read++;
  keep(log.read, now());
  keep(log.stampsIn, frame.timestamp);
  try { await compose(frame); } catch (err) { stats.error = String(err); } finally { frame.close(); }
}

// #region read
/** Read VideoFrames from the stream until the source changes. Each one is composed and closed. */
async function pump(readable, mine) {
  const reader = readable.getReader();
  try {
    while (mine === run) {
      const { value: frame, done } = await reader.read();
      if (done) break;
      if (mine !== run) { frame.close(); break; }
      await take(frame);
    }
  } catch (err) {
    stats.error = String(err);
  }
  reader.cancel().catch(() => {});
}
// #endregion read

/** A source made in the worker: a flat colour with a moving bar and the frame number as 16 stripes. No main thread takes part. */
function synthetic(mine, colour = '#1040c0', fps = 30) {
  const src = new OffscreenCanvas(W, H);
  const sc = src.getContext('2d');
  let n = 0;
  const tick = async () => {
    if (mine !== run) return;
    if (paused) return setTimeout(tick, 200);
    sc.fillStyle = colour;
    sc.fillRect(0, 0, W, H);
    sc.fillStyle = 'rgb(255 255 255 / .25)';
    sc.fillRect(((n * 6) % (W + 80)) - 80, 0, 80, H);
    const stripe = W / 32;
    for (let i = 0; i < 16; i++) { sc.fillStyle = (n >> i) & 1 ? '#fff' : '#000'; sc.fillRect(W / 2 + i * stripe, 0, stripe, Math.round(H / 22)); }
    const frame = new VideoFrame(src, { timestamp: Math.round((n * 1e6) / fps) });
    n++;
    await take(frame);
    setTimeout(tick, 1000 / fps);
  };
  tick();
}

// #region decode
/** The video frames of a WebM file: [{ key, data }], with the codec string for VideoDecoder. */
function demuxWebM(bytes) {
  const MASTERS = new Set([0x18538067, 0x1f43b675, 0x1654ae6b, 0xae, 0xa0]); // Segment, Cluster, Tracks, TrackEntry, BlockGroup
  const frames = [];
  let codec = '', videoTrack = 1, entry = null;
  const vint = (at, keepMarker) => {
    let length = 1;
    while (length <= 8 && !(bytes[at] & (0x80 >> (length - 1)))) length++;
    let value = keepMarker ? bytes[at] : bytes[at] & (0xff >> length);
    for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i];
    return { value, length };
  };
  const walk = (from, to) => {
    for (let at = from; at < to - 1;) {
      const id = vint(at, true), size = vint(at + id.length, false);
      const start = at + id.length + size.length;
      const unknown = size.value === 2 ** (7 * size.length) - 1; // a size of all ones: the element runs to the end
      const end = unknown ? to : Math.min(to, start + size.value);
      if (MASTERS.has(id.value)) {
        if (id.value === 0xae) entry = {};
        walk(start, end);
        if (id.value === 0xae && entry.type === 1) { videoTrack = entry.number; codec = entry.codec; }
      } else if (id.value === 0xd7 && entry) entry.number = bytes[start];
      else if (id.value === 0x83 && entry) entry.type = bytes[start];
      else if (id.value === 0x86 && entry) entry.codec = String.fromCharCode(...bytes.subarray(start, end));
      else if (id.value === 0xa3 || id.value === 0xa1) {
        // SimpleBlock or Block: track number, 16-bit time, flags, then the frame.
        const track = vint(start, false);
        if (track.value === videoTrack) frames.push({ key: id.value === 0xa3 ? !!(bytes[start + track.length + 2] & 0x80) : frames.length === 0, data: bytes.subarray(start + track.length + 3, end) });
      }
      at = end;
    }
  };
  walk(0, bytes.length);
  return { frames, codec: codec === 'V_VP9' ? 'vp09.00.10.08' : codec === 'V_VP8' ? 'vp8' : codec === 'V_AV1' ? 'av01.0.04M.08' : codec };
}

/** Read a WebM file and decode it here at `fps`, in a loop. Nothing passes through the main thread. */
async function decodeFile(mine, url, fps = 30) {
  const { frames, codec } = demuxWebM(new Uint8Array(await (await fetch(url)).arrayBuffer()));
  if (!frames.length) throw new Error('no video frames found in the file');
  let chain = Promise.resolve();
  const decoder = new VideoDecoder({
    output: (frame) => { chain = chain.then(() => (mine === run ? take(frame) : frame.close())); },
    error: (err) => { stats.error = String(err); },
  });
  decoder.configure({ codec, optimizeForLatency: true });
  let i = 0, n = 0;
  const tick = () => {
    if (mine !== run || decoder.state !== 'configured') { if (decoder.state !== 'closed') decoder.close(); return; }
    if (!paused && decoder.decodeQueueSize < 3) {
      const f = frames[i];
      decoder.decode(new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: Math.round((n * 1e6) / fps), data: f.data }));
      n++;
      i = (i + 1) % frames.length; // the file starts with a key frame, so the loop can start again there
    }
    setTimeout(tick, 1000 / fps);
  };
  tick();
  return { frames: frames.length, codec };
}
// #endregion decode

/** The frame number carried by clip.webm or the synthetic source: 16 stripes in the top right, lowest bit first. */
function frameNumber() {
  const stripe = W / 32;
  const d = ctx.getImageData(W / 2, Math.round(H / 60), W / 2, 1).data;
  let n = 0;
  for (let i = 0; i < 16; i++) if (d[Math.floor(i * stripe + stripe / 2) * 4] > 128) n |= 1 << i;
  return n;
}

const between = (list, from, to) => list.filter((t) => t >= from && t <= to).length;

/** What this worker global has. The page uses it to pick the routes. */
function probe() {
  return {
    MediaStreamTrackProcessor: typeof MediaStreamTrackProcessor !== 'undefined',
    VideoTrackGenerator: typeof VideoTrackGenerator !== 'undefined',
    MediaStreamTrackGenerator: typeof MediaStreamTrackGenerator !== 'undefined',
    MediaStreamTrack: typeof MediaStreamTrack !== 'undefined',
    VideoFrame: typeof VideoFrame !== 'undefined',
    VideoDecoder: typeof VideoDecoder !== 'undefined',
    drawElementImage: typeof OffscreenCanvasRenderingContext2D !== 'undefined' && 'drawElementImage' in OffscreenCanvasRenderingContext2D.prototype,
    texElementSubImage2D: typeof WebGL2RenderingContext !== 'undefined' && 'texElementSubImage2D' in WebGL2RenderingContext.prototype,
    requestAnimationFrame: typeof requestAnimationFrame !== 'undefined',
  };
}

/** texElementSubImage2D(ElementImage) and texImage2D(VideoFrame) in one WebGL 2 shader, on a canvas of its own. */
function glCompose(glCanvas, image) {
  const gl = glCanvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) throw new Error('no WebGL 2 context in the worker');
  if (!gl.texElementSubImage2D) throw new Error('the worker WebGL 2 context has no texElementSubImage2D()');
  const w = glCanvas.width, h = glCanvas.height;
  const src = new OffscreenCanvas(w, h);
  const sc = src.getContext('2d');
  sc.fillStyle = '#1040c0';
  sc.fillRect(0, 0, w, h);
  const frame = new VideoFrame(src, { timestamp: 0 });
  const tex = (unit) => {
    const t = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  tex(0);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  frame.close();
  tex(1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, image);
  const glError = gl.getError();
  if (glError) throw new Error(`texElementSubImage2D() raised GL error 0x${glError.toString(16)}`);
  const shader = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, `#version 300 es
    out vec2 uv;
    void main() { vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision mediump float;
    uniform sampler2D video, scene;
    in vec2 uv; out vec4 colour;
    void main() { vec2 p = vec2(uv.x, 1.0 - uv.y); vec4 s = texture(scene, p); colour = vec4(s.rgb + texture(video, p).rgb * (1.0 - s.a), 1.0); }`));
  gl.linkProgram(program);
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'video'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'scene'), 1);
  gl.viewport(0, 0, w, h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const at = (x, y) => { const d = new Uint8Array(4); gl.readPixels(x, h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, d); return [...d]; };
  return at;
}

const handlers = {
  init(m) {
    canvas = m.canvas;
    W = canvas.width; H = canvas.height;
    ctx = canvas.getContext('2d', { willReadFrequently: !!m.readBack });
    if (!ctx) throw new Error('no 2D context for the transferred canvas');
    canvas.addEventListener?.('contextlost', () => postMessage({ type: 'lost' }));
    return probe();
  },
  probe: () => probe(),
  // #region scene
  scene(m) {
    scene?.close();
    scene = m.image;
    panels = m.panels ?? panels;
    stats.scenes++;
  },
  // #endregion scene
  look(m) { look = m.look; },
  convert(m) { convert = m.convert; },
  pause(m) { paused = !!m.paused; },
  async source(m) {
    const mine = ++run;
    if (m.convert) convert = m.convert;
    if (m.url) return { route: 'decode', ...(await decodeFile(mine, m.url)) };
    if (m.track) {
      // The route in the specification: the track is transferred and the processor is made here.
      pump(new MediaStreamTrackProcessor({ track: m.track }).readable, mine);
      return { route: 'track' };
    }
    if (m.readable) { pump(m.readable, mine); return { route: 'readable' }; }
    if (m.synthetic) { synthetic(mine, m.colour, m.fps); return { route: 'synthetic' }; }
    return { route: 'none' };
  },
  // A single frame posted from the main thread, for a browser with no MediaStreamTrackProcessor.
  frame: (m) => take(m.frame),
  sink(m) {
    writer?.releaseLock?.();
    writer = null;
    if (m.writable) { writer = m.writable.getWriter(); return { route: 'writable' }; }
    if (m.generator) {
      // The route in the specification: the track is made here and transferred to the page.
      generator = new VideoTrackGenerator();
      writer = generator.writable.getWriter();
      const track = generator.track;
      return { route: 'VideoTrackGenerator', track, transfer: [track] };
    }
    return { route: 'none' };
  },
  /** Count the frames of another stream (for example what the track delivers) with their arrival times. */
  count(m) {
    (async () => {
      const reader = m.readable.getReader();
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ done: true }));
        if (done) break;
        keep(log.counted, now());
        keep(log.stampsCounted, value.timestamp);
        value.close();
      }
    })();
  },
  stats: () => ({ ...stats, drawMs: +stats.drawMs.toFixed(2), look, size: `${W}×${H}` }),
  /** How many frames were read, written and counted between two times on the shared clock. */
  window: (m) => ({ read: between(log.read, m.from, m.to), written: between(log.written, m.from, m.to), counted: between(log.counted, m.from, m.to) }),
  stamps: () => ({ in: log.stampsIn.slice(-120), out: log.stampsOut.slice(-120), counted: log.stampsCounted.slice(-120) }),
  sample: (m) => ({ pixels: m.points.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]), frameNumber: frameNumber() }),
  /** Draw the scene snapshot into a canvas made here. The API refuses: a snapshot belongs to its source canvas. */
  foreign() {
    const other = new OffscreenCanvas(W, H).getContext('2d');
    other.drawElementImage(scene, 0, 0, W, H);
    return { drawn: true };
  },
  gl(m) {
    const at = glCompose(m.canvas, m.image);
    return { pixels: m.points.map(([x, y]) => at(x, y)) };
  },
};

onmessage = async ({ data: m }) => {
  try {
    const result = (await handlers[m.type]?.(m)) ?? {};
    const { transfer = [], ...rest } = result;
    if (m.id) postMessage({ id: m.id, ok: true, ...rest }, transfer);
  } catch (err) {
    stats.error = `${err.name}: ${err.message}`;
    if (m.id) postMessage({ id: m.id, ok: false, error: stats.error });
    else postMessage({ type: 'error', error: stats.error });
  }
};
