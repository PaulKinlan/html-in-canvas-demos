// Encode the history of a <dom-rewind> element with WebCodecs.
//
//   import { encoders, encodeRewind, decodeBack } from '/motion-capture/rewind-encode.js';
//   const list = await encoders(rw.canvas.width, rw.canvas.height);       // which codecs this device can encode
//   const out = await encodeRewind(rw, { seconds: 4, fps: 30, codec: 'vp9' });
//   out.blob          // a WebM file for vp8 and vp9, null for the others (lib/webm-mux.js holds only those two)
//   out.chunks        // the EncodedVideoChunks, for any codec
//   const back = await decodeBack(out);                                   // { frames, first, last }: VideoFrames, close them
//
// Nothing here reads pixels from the drawable canvas. <dom-rewind>.frames() hands over ImageBitmaps,
// and each one is drawn into a plain OffscreenCanvas that the VideoFrame is made from.

import { WebMMuxer } from '/lib/webm-mux.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const CODECS = [
  { name: 'vp9', codec: 'vp09.00.10.08', webm: true },
  { name: 'vp8', codec: 'vp8', webm: true },
  { name: 'av1', codec: 'av01.0.04M.08', webm: false },
  { name: 'h264', codec: 'avc1.42001f', webm: false },
];

/** A size no wider than `maxWidth`, with even width and height (H.264 needs even numbers). */
export function evenSize(width, height, maxWidth = 720) {
  const k = Math.min(1, maxWidth / width);
  return { width: Math.max(2, Math.round((width * k) / 2) * 2), height: Math.max(2, Math.round((height * k) / 2) * 2) };
}

const configFor = (entry, width, height, fps, bitrate) => ({ codec: entry.codec, width, height, bitrate, framerate: fps, latencyMode: 'quality' });

/** Each codec in CODECS with `supported` for this size on this device. */
export async function encoders(srcWidth, srcHeight, { fps = 30, maxWidth = 720 } = {}) {
  const { width, height } = evenSize(srcWidth, srcHeight, maxWidth);
  const out = [];
  for (const entry of CODECS) {
    let supported = false;
    try { supported = typeof VideoEncoder !== 'undefined' && (await VideoEncoder.isConfigSupported(configFor(entry, width, height, fps, 2_000_000))).supported === true; } catch {}
    out.push({ ...entry, supported });
  }
  return out;
}

// #region encode
/**
 * Encode the last `seconds` of a <dom-rewind> at `fps`. Live drawing in the element pauses while frames() runs.
 * Resolves with { codec, width, height, fps, frames, bytes, msPerFrame, chunks, decoderConfig, blob }.
 */
export async function encodeRewind(rw, { seconds = 4, fps = 30, codec = 'vp9', maxWidth = 720, background = '#ffffff', bitrate = 2_000_000, onprogress = null } = {}) {
  if (typeof VideoEncoder === 'undefined') throw new DOMException('WebCodecs (VideoEncoder) is not available here.', 'NotSupportedError');
  const entry = CODECS.find((c) => c.name === codec);
  if (!entry) throw new TypeError(`Unknown codec ${codec}`);
  const { width, height } = evenSize(rw.canvas.width, rw.canvas.height, maxWidth);
  const config = configFor(entry, width, height, fps, bitrate);
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new DOMException(`No ${codec} encoder at ${width}×${height} here.`, 'NotSupportedError');

  const mux = entry.webm ? new WebMMuxer({ width, height, codec, fps, app: 'rewind-encode.js' }) : null;
  const chunks = [];
  let decoderConfig = null, failure = null, bytes = 0;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig && !decoderConfig) decoderConfig = meta.decoderConfig;
      chunks.push(chunk);
      bytes += chunk.byteLength;
      mux?.add(chunk);
    },
    error: (e) => (failure = e),
  });
  encoder.configure(config);

  // A video has no transparency, so each bitmap is drawn over the background colour on a plain canvas.
  const stage = new OffscreenCanvas(width, height), sctx = stage.getContext('2d');
  let i = 0;
  const t0 = performance.now();
  try {
    for await (const { bitmap } of rw.frames({ seconds, fps })) {
      sctx.fillStyle = background;
      sctx.fillRect(0, 0, width, height);
      sctx.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      if (failure) throw failure;
      const frame = new VideoFrame(stage, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps), alpha: 'discard' });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      i++;
      onprogress?.(i);
      while (encoder.encodeQueueSize > 4) await sleep(4);
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    try { encoder.close(); } catch {}
  }
  return { codec, width, height, fps, frames: i, bytes, msPerFrame: (performance.now() - t0) / Math.max(1, i), chunks, decoderConfig, blob: mux ? mux.finish() : null };
}
// #endregion encode

// #region decode
/** Decode what encodeRewind() made, with VideoDecoder. Resolves with the count and the first and last VideoFrame. */
export async function decodeBack(result) {
  let frames = 0, first = null, last = null, failure = null;
  const decoder = new VideoDecoder({
    output: (frame) => {
      frames++;
      if (!first) { first = frame; return; }
      last?.close();
      last = frame;
    },
    error: (e) => (failure = e),
  });
  decoder.configure(result.decoderConfig ?? { codec: CODECS.find((c) => c.name === result.codec).codec, codedWidth: result.width, codedHeight: result.height });
  for (const chunk of result.chunks) decoder.decode(chunk);
  await decoder.flush();
  decoder.close();
  if (failure) throw failure;
  return { frames, first, last: last ?? first };
}
// #endregion decode
