// Worker side of the transport lab.
const W = 240, H = 80;
let ownGL = null;
let own = null; // ctx of an OffscreenCanvas transferred from a drawable canvas
function sample(drawable) {
  const oc = new OffscreenCanvas(W, H);
  const ctx = oc.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(drawable, 0, 0, W, H);
  return oc.transferToImageBitmap();
}
onmessage = async ({ data: m }) => {
  const ok = (detail, bitmap) => postMessage({ id: m.id, ok: true, detail, bitmap }, bitmap ? [bitmap] : []);
  try {
    if (m.kind === 'own-canvas') {
      own = m.canvas.getContext('2d', { willReadFrequently: true });
      return ok('have canvas');
    }
    if (m.kind === 'ei-transferToImageBitmap') {
      own.reset(); own.drawElementImage(m.img, 0, 0);
      const bmp = own.canvas.transferToImageBitmap();
      return ok('transferToImageBitmap() on the placeholder-linked OffscreenCanvas', bmp);
    }
    if (m.kind === 'ei-createImageBitmap') {
      own.reset(); own.drawElementImage(m.img, 0, 0);
      return ok('createImageBitmap(offscreenCanvas) in worker', await createImageBitmap(own.canvas));
    }
    if (m.kind === 'ei-videoframe') {
      own.reset(); own.drawElementImage(m.img, 0, 0);
      const f = new VideoFrame(own.canvas, { timestamp: 0 });
      const bmp = sample(f); f.close();
      return ok('new VideoFrame(offscreenCanvas) in worker', bmp);
    }
    if (m.kind === 'ei-getImageData') {
      own.reset(); own.drawElementImage(m.img, 0, 0);
      const d = own.getImageData(0, 0, W, H);
      return ok('getImageData in worker', await createImageBitmap(d));
    }
    if (m.kind === 'own-webgl-init') {
      ownGL = m.canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
      return ok('have WebGL canvas');
    }
    if (m.kind === 'ei-own-webgl' || m.kind === 'ei-fresh-webgl') {
      const gl = m.kind === 'ei-own-webgl' ? ownGL : new OffscreenCanvas(W, H).getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
      const canvas = gl.canvas;
      if (!gl.texElementSubImage2D) throw new Error('worker WebGL2 context has no texElementSubImage2D');
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      let size = { width: W, height: H };
      try { size = canvas.getElementImageDefaultSize(m.img); } catch {}
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size.width, size.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, m.img);
      let err = gl.getError();
      if (err) throw new Error('texElementSubImage2D raised GL error 0x' + err.toString(16));
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, size.width, size.height, 0, H, W, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      return ok(`texElementSubImage2D(ElementImage) in a worker, ${size.width}×${size.height} texture`, await createImageBitmap(canvas));
    }
    if (m.kind === 'frame') {
      const bmp = sample(m.payload); m.payload.close();
      return ok('worker drew the VideoFrame', bmp);
    }
    if (m.kind === 'stream') {
      const reader = m.payload.getReader();
      const { value } = await reader.read();
      const bmp = sample(value); value.close(); reader.cancel();
      return ok('worker read a VideoFrame from the transferred stream', bmp);
    }
    if (m.kind === 'track') {
      const proc = new MediaStreamTrackProcessor({ track: m.payload });
      const reader = proc.readable.getReader();
      const { value } = await reader.read();
      const bmp = sample(value); value.close(); reader.cancel();
      return ok('worker read a frame from the transferred MediaStreamTrack', bmp);
    }
    throw new Error('unknown kind ' + m.kind);
  } catch (err) {
    postMessage({ id: m.id, ok: false, detail: `${err.name}: ${err.message}` });
  }
};
