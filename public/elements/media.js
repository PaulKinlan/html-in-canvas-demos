// Test assets for the element catalogue, made in the page so nothing has to be downloaded:
// a PNG, an SVG, an animated SVG, a one-second WebM video, a WAV tone and a WebVTT cue.
import { otherOrigin } from '/lib/live-origins.js';

// #region assets
function png() {
  const c = Object.assign(document.createElement('canvas'), { width: 96, height: 64 });
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 96, 64);
  grad.addColorStop(0, '#e4572e'); grad.addColorStop(1, '#2e86ab');
  g.fillStyle = grad; g.fillRect(0, 0, 96, 64);
  g.fillStyle = '#fff'; g.font = '700 16px system-ui'; g.fillText('PNG', 30, 38);
  return c.toDataURL('image/png');
}

const svg = (body) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${body}</svg>`);

// One second of a moving bar, recorded from a canvas with MediaRecorder.
async function video() {
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return null;
  const c = Object.assign(document.createElement('canvas'), { width: 160, height: 90 });
  const g = c.getContext('2d');
  const stream = c.captureStream(30);
  const type = ['video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return null;
  const rec = new MediaRecorder(stream, { mimeType: type });
  const chunks = [];
  rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
  const done = new Promise((resolve) => (rec.onstop = resolve));
  rec.start();
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      g.fillStyle = '#123'; g.fillRect(0, 0, 160, 90);
      g.fillStyle = '#fc3'; g.fillRect((t * 160) % 160, 0, 24, 90);
      g.fillStyle = '#fff'; g.font = '700 16px system-ui'; g.fillText('video', 8, 22);
      if (t < 1) setTimeout(tick, 33); else resolve();
    };
    tick();
  });
  rec.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());
  return chunks.length ? URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })) : null;
}

// Half a second of a 440 Hz tone as 8-bit mono WAV.
function wav() {
  const rate = 8000, n = rate / 2;
  const buf = new DataView(new ArrayBuffer(44 + n));
  const str = (o, s) => [...s].forEach((ch, i) => buf.setUint8(o + i, ch.charCodeAt(0)));
  str(0, 'RIFF'); buf.setUint32(4, 36 + n, true); str(8, 'WAVEfmt '); buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, rate, true); buf.setUint32(28, rate, true);
  buf.setUint16(32, 1, true); buf.setUint16(34, 8, true); str(36, 'data'); buf.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf.setUint8(44 + i, 128 + 40 * Math.sin((i / rate) * 2 * Math.PI * 440));
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

let made;
export function assets() {
  return (made ??= (async () => ({
    img: png(),
    svg: svg('<rect width="64" height="64" rx="10" fill="#6a4c93"/><circle cx="32" cy="32" r="16" fill="#ffca3a"/>'),
    anim: svg('<rect width="64" height="64" fill="#1b998b"/><rect y="24" width="16" height="16" fill="#fff"><animate attributeName="x" from="0" to="48" dur="0.6s" repeatCount="indefinite"/></rect>'),
    video: await video().catch(() => null),
    audio: wav(),
    vtt: URL.createObjectURL(new Blob(['WEBVTT\n\n00:00.000 --> 00:10.000\nCaption cue\n'], { type: 'text/vtt' })),
    other: otherOrigin(),
    thumb: 'board.jpg',
  }))());
}
// #endregion assets
