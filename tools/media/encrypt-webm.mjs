// Writes a Clear Key encrypted WebM (VP9, video only) from an IVF file.
// Usage: node encrypt-webm.mjs in.ivf out.webm
// WebM encryption: every frame is AES-128-CTR encrypted and prefixed with a
// signal byte (1 = encrypted) and an 8-byte IV. The track header names the key.
// The key and key id are public on purpose: the clip only exists to test what
// an encrypted <video> does inside a canvas.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCipheriv } from 'node:crypto';

export const KEY = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
export const KID = Buffer.from('000102030405060708090a0b0c0d0e0f', 'hex');

const [, , src, dst] = process.argv;
const ivf = readFileSync(src);
const width = ivf.readUInt16LE(12), height = ivf.readUInt16LE(14);
const rate = ivf.readUInt32LE(16), scale = ivf.readUInt32LE(20);
const frames = [];
for (let o = ivf.readUInt16LE(6); o < ivf.length; ) {
  const size = ivf.readUInt32LE(o), pts = Number(ivf.readBigUInt64LE(o + 4));
  frames.push({ ms: Math.round((pts * scale * 1000) / rate), data: ivf.subarray(o + 12, o + 12 + size) });
  o += 12 + size;
}

const id = (hex) => Buffer.from(hex, 'hex');
const size = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); b[0] = 0x01; return b; };
const el = (hex, ...body) => { const d = Buffer.concat(body); return Buffer.concat([id(hex), size(d.length), d]); };
const uint = (hex, n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return el(hex, b); };
const str = (hex, s) => el(hex, Buffer.from(s));
const float = (hex, n) => { const b = Buffer.alloc(8); b.writeDoubleBE(n); return el(hex, b); };

const header = el('1A45DFA3', uint('4286', 1), uint('42F7', 1), uint('42F2', 4), uint('42F3', 8), str('4282', 'webm'), uint('4287', 4), uint('4285', 2));
const info = el('1549A966', uint('2AD7B1', 1000000), str('4D80', 'encrypt-webm'), str('5741', 'encrypt-webm'), float('4489', frames.at(-1).ms + 33));
const encryption = el('6D80', el('6240', uint('5031', 0), uint('5032', 1), uint('5033', 1),
  el('5035', uint('47E1', 5), el('47E2', KID), el('47E7', uint('47E8', 1)))));
const tracks = el('1654AE6B', el('AE', uint('D7', 1), uint('73C5', 1), uint('83', 1), str('86', 'V_VP9'),
  el('E0', uint('B0', width), uint('BA', height)), encryption));

const clusters = [];
let cluster = null;
frames.forEach((f, i) => {
  const key = (f.data[0] & 0x04) === 0 && i % 30 === 0; // VP9 frame_type bit; the source has a keyframe every 30
  if (key) clusters.push((cluster = { ms: f.ms, blocks: [] }));
  const iv = Buffer.alloc(8); iv.writeUInt32BE(0x48494331, 0); iv.writeUInt32BE(i + 1, 4);
  const cipher = createCipheriv('aes-128-ctr', KEY, Buffer.concat([iv, Buffer.alloc(8)]));
  const body = Buffer.concat([Buffer.from([0x01]), iv, cipher.update(f.data), cipher.final()]);
  const head = Buffer.alloc(4); head[0] = 0x81; head.writeInt16BE(f.ms - cluster.ms, 1); head[3] = key ? 0x80 : 0;
  cluster.blocks.push(el('A3', head, body));
});
const body = Buffer.concat([info, tracks, ...clusters.map((c) => el('1F43B675', uint('E7', c.ms), ...c.blocks))]);
writeFileSync(dst, Buffer.concat([header, el('18538067', body)]));
console.log(`${dst}: ${frames.length} frames, ${clusters.length} clusters, ${width}x${height}`);
