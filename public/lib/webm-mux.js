// webm-mux.js: put WebCodecs video chunks (VP8 or VP9) into a WebM file.
// No dependencies. Video, and optionally one Opus audio track.
//
//   const mux = new WebMMuxer({ width, height, codec: 'vp9', fps: 30 });
//   new VideoEncoder({ output: (chunk) => mux.add(chunk), error });
//   …encode, flush…
//   const blob = mux.finish();          // video/webm, seekable (has Cues)
//
// With sound:
//   new AudioEncoder({ output: (chunk, meta) => mux.addAudio(chunk, meta), error });
//   …configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 }), encode, flush…
//
// The file is built in memory, so sizes and the duration are written for real
// rather than left "unknown" the way a live MediaRecorder stream has to.

const cat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
/** Big-endian unsigned integer in exactly `width` bytes (safe up to 2^53). */
const be = (n, width) => {
  const b = new Uint8Array(width);
  for (let i = width - 1; i >= 0; i--) { b[i] = n % 256; n = Math.floor(n / 256); }
  return b;
};
const uint = (n) => { let w = 1; while (n >= 2 ** (8 * w)) w++; return be(n, w); };
/** EBML size field. */
const size = (n) => {
  let w = 1;
  while (n >= 2 ** (7 * w) - 1) w++;
  const b = be(n, w);
  b[0] |= 0x80 >> (w - 1);
  return b;
};
const id = (hex) => be(hex, hex > 0xffffff ? 4 : hex > 0xffff ? 3 : hex > 0xff ? 2 : 1);
const el = (hex, payload) => {
  const p = Array.isArray(payload) ? cat(payload) : payload;
  return cat([id(hex), size(p.length), p]);
};
const str = (s) => new TextEncoder().encode(s);
const f64 = (x) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, x); return b; };

const CODEC_ID = { vp8: 'V_VP8', vp9: 'V_VP9' };

export class WebMMuxer {
  #o;
  #frames = []; // { ms, key, data }
  #audio = []; // { ms, data }
  #audioConfig = null; // { sampleRate, channels, head }

  /** @param {{ width: number, height: number, codec?: 'vp8'|'vp9', fps?: number, app?: string }} o */
  constructor(o) {
    this.#o = { codec: 'vp9', fps: 30, app: 'element-capture.js', ...o };
    if (!CODEC_ID[this.#o.codec]) throw new TypeError(`WebM here holds vp8 or vp9, not ${this.#o.codec}`);
  }

  /** Add an EncodedVideoChunk (or { timestamp µs, type, data: Uint8Array }). In presentation order. */
  add(chunk) {
    let data = chunk.data;
    if (!data) { data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); }
    this.#frames.push({ ms: Math.round(chunk.timestamp / 1000), key: chunk.type === 'key', data });
  }

  /**
   * Add an EncodedAudioChunk from an Opus AudioEncoder, with the metadata the encoder passed
   * to its output callback (the first one carries the decoder configuration).
   */
  addAudio(chunk, meta) {
    const cfg = meta?.decoderConfig;
    if (cfg && !this.#audioConfig) {
      const channels = cfg.numberOfChannels ?? 2, sampleRate = cfg.sampleRate ?? 48000;
      let head = cfg.description ? new Uint8Array(cfg.description.buffer ?? cfg.description, cfg.description.byteOffset ?? 0, cfg.description.byteLength) : null;
      if (!head) {
        // OpusHead, written by hand when the encoder gives none: version 1, pre-skip 312 samples, no gain, mapping family 0.
        head = new Uint8Array(19);
        head.set(str('OpusHead'));
        const v = new DataView(head.buffer);
        v.setUint8(8, 1); v.setUint8(9, channels); v.setUint16(10, 312, true); v.setUint32(12, sampleRate, true);
      }
      this.#audioConfig = { channels, sampleRate, head };
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.#audio.push({ ms: Math.round(chunk.timestamp / 1000), data });
  }

  get frames() { return this.#frames.length; }
  get audioFrames() { return this.#audio.length; }

  /** @returns {Blob} */
  finish() {
    const o = this.#o, frames = this.#frames;
    if (!frames.length) throw new Error('no frames were encoded');
    if (!frames[0].key) throw new Error('the first frame must be a key frame');
    const frameMs = 1000 / o.fps;
    const duration = frames.at(-1).ms + frameMs;

    // One cluster per key frame; a block's time is a signed 16-bit offset from its cluster.
    // Audio blocks (track 2) go in whichever cluster is open at their time; every Opus packet is a key frame.
    const audio = this.#audioConfig ? this.#audio.filter((a) => a.ms >= frames[0].ms) : [];
    const all = [...frames.map((f) => ({ ...f, track: 1 })), ...audio.map((a) => ({ ...a, key: false, track: 2 }))].sort((a, b) => a.ms - b.ms || a.track - b.track);
    const clusters = [];
    for (const f of all) {
      let c = clusters.at(-1);
      if (!c || (f.track === 1 && f.key) || f.ms - c.ms > 32000) clusters.push((c = { ms: f.ms, blocks: [] }));
      const head = new Uint8Array([0x80 | f.track, ((f.ms - c.ms) >> 8) & 0xff, (f.ms - c.ms) & 0xff, f.key || f.track === 2 ? 0x80 : 0x00]);
      c.blocks.push(el(0xa3, [head, f.data])); // SimpleBlock
    }
    const clusterBytes = clusters.map((c) => el(0x1f43b675, [el(0xe7, uint(c.ms)), ...c.blocks]));

    const info = el(0x1549a966, [
      el(0x2ad7b1, uint(1_000_000)), // timecode scale: 1 ms
      el(0x4d80, str(o.app)), el(0x5741, str(o.app)),
      el(0x4489, f64(duration)),
    ]);
    const videoTrack = el(0xae, [
      el(0xd7, uint(1)), el(0x73c5, uint(1)), el(0x9c, uint(0)), el(0x22b59c, str('und')),
      el(0x86, str(CODEC_ID[o.codec])), el(0x83, uint(1)),
      el(0x23e383, uint(Math.round(frameMs * 1e6))), // default frame duration, ns
      el(0xe0, [el(0xb0, uint(o.width)), el(0xba, uint(o.height))]),
    ]);
    const a = audio.length ? this.#audioConfig : null;
    const audioTrack = a && el(0xae, [
      el(0xd7, uint(2)), el(0x73c5, uint(2)), el(0x9c, uint(0)), el(0x22b59c, str('und')),
      el(0x86, str('A_OPUS')), el(0x83, uint(2)),
      el(0x63a2, a.head), // CodecPrivate: OpusHead
      el(0x56aa, uint(Math.round((new DataView(a.head.buffer, a.head.byteOffset).getUint16(10, true) / 48000) * 1e9))), // CodecDelay: the pre-skip, ns
      el(0x56bb, uint(80_000_000)), // SeekPreRoll, ns
      el(0xe1, [el(0xb5, f64(a.sampleRate)), el(0x9f, uint(a.channels))]),
    ]);
    const tracks = el(0x1654ae6b, a ? [videoTrack, audioTrack] : videoTrack);
    // Cues go before the clusters so a player finds them without a SeekHead.
    // Fixed-width numbers, so their size is known before the positions are.
    const cuePoint = (ms, pos) => el(0xbb, [el(0xb3, be(ms, 4)), el(0xb7, [el(0xf7, uint(1)), el(0xf1, be(pos, 8))])]);
    const cuesSize = el(0x1c53bb6b, clusters.map(() => cuePoint(0, 0))).length;
    let pos = info.length + tracks.length + cuesSize;
    const cues = el(0x1c53bb6b, clusters.map((c, i) => {
      const p = cuePoint(c.ms, pos);
      pos += clusterBytes[i].length;
      return p;
    }));

    const header = el(0x1a45dfa3, [
      el(0x4286, uint(1)), el(0x42f7, uint(1)), el(0x42f2, uint(4)), el(0x42f3, uint(8)),
      el(0x4282, str('webm')), el(0x4287, uint(4)), el(0x4285, uint(2)),
    ]);
    const body = [info, tracks, cues, ...clusterBytes];
    const bodySize = body.reduce((n, p) => n + p.length, 0);
    return new Blob([header, id(0x18538067), size(bodySize), ...body], { type: `video/webm;codecs=${o.codec}${a ? ',opus' : ''}` });
  }
}
