// Worker side of /transports-2/.
onmessage = async ({ data: m }) => {
  try {
    // #region channel
    if (m.kind === 'channel') {
      // The RTCDataChannel was transferred here before it carried anything.
      // Input from the far device is parsed on this thread from now on.
      const channel = m.channel;
      channel.onmessage = (e) => {
        const input = JSON.parse(e.data);
        postMessage({ id: m.id, ok: true, input, thread: self.constructor.name, lag: Date.now() - input.sent });
      };
      return;
    }
    // #endregion channel
    // #region sab
    if (m.kind === 'sab') {
      // Wait for the page to publish a frame into shared memory, then read it in place: no copy, no message per frame.
      const flag = new Int32Array(m.flag);
      const pixels = new Uint8ClampedArray(m.pixels);
      const started = performance.now();
      let spins = 0;
      // Atomics.pause() tells the CPU this is a spin wait. Spin briefly, then block.
      while (Atomics.load(flag, 0) === 0 && spins < 2000) {
        if (Atomics.pause) Atomics.pause();
        spins++;
      }
      if (Atomics.load(flag, 0) === 0) Atomics.wait(flag, 0, 0, 4000);
      const i = (14 * m.width + 14) * 4;
      postMessage({ id: m.id, ok: true, frame: Atomics.load(flag, 0), px: Array.from(pixels.slice(i, i + 4)), waited: Math.round(performance.now() - started), spins, pause: typeof Atomics.pause === 'function' });
      return;
    }
    // #endregion sab
    postMessage({ id: m.id, ok: false, detail: 'unknown kind ' + m.kind });
  } catch (err) {
    postMessage({ id: m.id, ok: false, detail: `${err.name}: ${err.message}` });
  }
};
