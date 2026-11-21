// video-export.js: get a canvas that draws a <video> and HTML together out of the page.
//
//   import { recordCanvas, exportFrames, loopback } from '/lib/video-export.js';
//
//   // Live: MediaRecorder on the canvas stream plus the video's own sound.
//   const blob = await recordCanvas(canvas, { ms: 5000, audioFrom: video });
//
//   // Frame by frame: seek the video, step CSS animations, paint, encode. Exact, not real time.
//   const { blob, frames } = await exportFrames(canvas, { video, root: scene, from: 2, seconds: 3, fps: 30 });
//
//   // As a camera: the canvas stream through a peer connection in this page.
//   const { stream, stats, close } = await loopback(canvas.captureStream(30));
//
// The canvas must draw `video` and its overlays in a `paint` handler (drawElementImage()).
// Nothing here draws; these functions only ask for paints and read the canvas.

import { WebMMuxer } from './webm-mux.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VIDEO_CODECS = { vp9: 'vp09.00.10.08', vp8: 'vp8' };

/** One paint event of the canvas, asked for now. */
export function painted(canvas) {
  return new Promise((resolve) => {
    canvas.addEventListener('paint', () => resolve(), { once: true });
    canvas.requestPaint();
  });
}

// #region record
/**
 * Record the canvas for `ms` milliseconds. `audioFrom` is a media element whose sound goes
 * into the file: its captureStream() audio track is added to the canvas's video track.
 * The element's `muted` and `volume` do not change what is captured.
 */
export async function recordCanvas(canvas, { ms = 5000, fps = 30, audioFrom = null, mimeType } = {}) {
  const stream = canvas.captureStream(fps);
  let sound = false;
  if (audioFrom) {
    try {
      const track = (audioFrom.captureStream?.() ?? audioFrom.mozCaptureStream?.())?.getAudioTracks()[0];
      if (track) { stream.addTrack(track); sound = true; }
    } catch {}
  }
  const type = mimeType ?? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 2_500_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = (e) => reject(e.error ?? new Error('MediaRecorder failed')); });
  recorder.start(250);
  // captureStream() only sends a frame when the canvas changes. Ask for paints so a still scene is recorded too.
  const end = performance.now() + ms;
  while (performance.now() < end) { canvas.requestPaint(); await sleep(100); }
  recorder.stop();
  await stopped;
  stream.getVideoTracks()[0].stop();
  return Object.assign(new Blob(chunks, { type: type.split(';')[0] }), { sound, mimeType: type });
}
// #endregion record

// #region export
/**
 * Encode `seconds` of the canvas at exactly `fps`, one frame at a time.
 *
 *   video    the <video> the canvas draws; it is paused and seeked to each frame time
 *   root     the element whose CSS animations and transitions are stepped with it (default: the canvas)
 *   from     start time in the video, seconds
 *   audio    an AudioBuffer of the video's sound track (see decodeSound()); its slice goes in as Opus
 *   onframe  called before each frame is painted, to set DOM that depends on time: (index, timeSeconds)
 *   ondrawn  called after each frame is painted and before it is encoded: (index, timeSeconds)
 *
 * Resolves with { blob, frames, codec, sound, msPerFrame }.
 */
export async function exportFrames(canvas, { video, root = canvas, from = 0, seconds = 3, fps = 30, bitrate = 2_500_000, audio = null, onframe = null, ondrawn = null, signal = null } = {}) {
  if (typeof VideoEncoder === 'undefined') throw new DOMException('WebCodecs (VideoEncoder) is not available here.', 'NotSupportedError');
  const width = canvas.width, height = canvas.height;
  let config = null, codec = null;
  for (const name of ['vp9', 'vp8']) {
    const c = { codec: VIDEO_CODECS[name], width, height, bitrate, framerate: fps, latencyMode: 'quality' };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; codec = name; break; } } catch {}
  }
  if (!config) throw new DOMException(`No WebCodecs encoder for vp9 or vp8 at ${width}×${height}.`, 'NotSupportedError');

  const mux = new WebMMuxer({ width, height, codec, fps, app: 'video-export.js' });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk) => mux.add(chunk), error: (e) => (failure = e) });
  encoder.configure(config);

  // Freeze time: the video and every animation under `root` only move when this loop moves them.
  const wasPaused = video.paused, startTime = video.currentTime;
  video.pause();
  const animations = root.getAnimations({ subtree: true }).filter((a) => a.playState === 'running');
  const bases = animations.map((a) => { a.pause(); return Number(a.currentTime) || 0; });
  const total = Math.round(seconds * fps);
  const t0 = performance.now();
  try {
    for (let i = 0; i < total; i++) {
      if (failure) throw failure;
      if (signal?.aborted) throw new DOMException('Export stopped.', 'AbortError');
      // Aim at the middle of the frame, so rounding in the container cannot land on its neighbour.
      const t = from + (i + 0.5) / fps;
      if (Math.abs(video.currentTime - t) > 1e-4) {
        const seeked = new Promise((r) => video.addEventListener('seeked', r, { once: true }));
        video.currentTime = t;
        await seeked;
      }
      animations.forEach((a, k) => (a.currentTime = bases[k] + (i * 1000) / fps));
      await onframe?.(i, from + i / fps);
      await painted(canvas);
      await ondrawn?.(i, from + i / fps);
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % fps === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await sleep(4);
    }
    await encoder.flush();
    if (failure) throw failure;
  } finally {
    try { encoder.close(); } catch {}
    animations.forEach((a) => a.play());
    video.currentTime = startTime;
    if (!wasPaused) video.play().catch(() => {});
  }
  const msPerFrame = (performance.now() - t0) / total;

  let sound = false;
  if (audio && typeof AudioEncoder !== 'undefined') {
    try { sound = await encodeSound(mux, audio, from, seconds); } catch {}
  }
  return { blob: mux.finish(), frames: mux.frames, codec, sound, msPerFrame };
}

/** Decode the sound track of a media file into an AudioBuffer. Needs no user gesture. */
export async function decodeSound(url) {
  const data = await (await fetch(url)).arrayBuffer();
  return new OfflineAudioContext(2, 1, 48000).decodeAudioData(data);
}

/** Encode [from, from + seconds] of an AudioBuffer as Opus into the muxer. */
async function encodeSound(mux, buffer, from, seconds) {
  const rate = buffer.sampleRate, channels = Math.min(2, buffer.numberOfChannels);
  const config = { codec: 'opus', sampleRate: rate, numberOfChannels: channels, bitrate: 96_000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) return false;
  let failure = null;
  const encoder = new AudioEncoder({ output: (chunk, meta) => mux.addAudio(chunk, meta), error: (e) => (failure = e) });
  encoder.configure(config);
  const first = Math.round(from * rate), last = Math.min(buffer.length, Math.round((from + seconds) * rate));
  const step = Math.round(rate / 50); // 20 ms, one Opus packet
  for (let at = first; at < last; at += step) {
    const n = Math.min(step, last - at);
    const data = new Float32Array(n * channels);
    for (let c = 0; c < channels; c++) data.set(buffer.getChannelData(c).subarray(at, at + n), c * n);
    const frame = new AudioData({ format: 'f32-planar', sampleRate: rate, numberOfChannels: channels, numberOfFrames: n, timestamp: Math.round(((at - first) * 1e6) / rate), data });
    encoder.encode(frame);
    frame.close();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  return mux.audioFrames > 0;
}
// #endregion export

// #region loopback
/**
 * Send a MediaStream through two RTCPeerConnections in this page and resolve with what the far
 * side receives. This is what a call would get if the stream were used as the camera.
 */
export async function loopback(stream) {
  const a = new RTCPeerConnection(), b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate).catch(() => {});
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate).catch(() => {});
  const remote = new MediaStream();
  const want = stream.getTracks().length;
  const got = new Promise((resolve) => { b.ontrack = (e) => { remote.addTrack(e.track); if (remote.getTracks().length >= want) resolve(); }; });
  for (const track of stream.getTracks()) a.addTrack(track, stream);
  await a.setLocalDescription(await a.createOffer());
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer());
  await a.setRemoteDescription(b.localDescription);
  await got;
  return {
    stream: remote,
    /** { width, height, fps, kbps } of the received video, measured over the time since the last call. */
    stats: (() => {
      let lastBytes = 0, lastAt = performance.now();
      return async () => {
        for (const r of (await b.getStats()).values()) {
          if (r.type !== 'inbound-rtp' || r.kind !== 'video') continue;
          const now = performance.now();
          const kbps = ((r.bytesReceived - lastBytes) * 8) / (now - lastAt);
          lastBytes = r.bytesReceived; lastAt = now;
          return { width: r.frameWidth ?? 0, height: r.frameHeight ?? 0, fps: r.framesPerSecond ?? 0, kbps: Math.round(kbps), frames: r.framesDecoded ?? 0 };
        }
        return null;
      };
    })(),
    close: () => { a.close(); b.close(); },
  };
}
// #endregion loopback
