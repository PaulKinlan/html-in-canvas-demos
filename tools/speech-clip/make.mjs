// Builds public/media/talk.webm and public/media/talk.vtt: a 640x360 clip of synthesized speech with one WebVTT cue per sentence.
//
//   node tools/speech-clip/make.mjs
//
// Needs ffmpeg built with libflite. Each sentence is synthesized by itself, so
// the cue times are the measured lengths of the sound files. The time stamps
// inside a cue (one per word) are estimates: the sentence's time is shared out
// by the number of letters in each word. The picture is the sound's waveform
// (ffmpeg showwaves) in white over a moving colour gradient, with no text in it.
// Each speaker's cues carry a position setting: Ada on the left, Ben on the right.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/media');
const LINES = [
  ['Ada', 'slt', 'This clip was made by a speech synthesizer.'],
  ['Ada', 'slt', 'Each sentence is one cue in a text track.'],
  ['Ben', 'rms', 'The page reads the active cues and builds the captions as elements.'],
  ['Ben', 'rms', 'A canvas draws them apart from the video frame.'],
  ['Ada', 'slt', 'Tap a word to move the video to it.'],
  ['Ben', 'rms', 'The clip starts again after this sentence.'],
];
const GAP = 0.45; // silence after each sentence, seconds
const tmp = mkdtempSync(path.join(tmpdir(), 'talk-'));
const ff = (...args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
const stamp = (t) => `${String(Math.floor(t / 3600)).padStart(2, '0')}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${(t % 60).toFixed(3).padStart(6, '0')}`;

let t = 0.3;
const cues = [];
const parts = [];
LINES.forEach(([who, voice, text], i) => {
  const wav = path.join(tmp, `${i}.wav`);
  const txt = path.join(tmp, `${i}.txt`);
  writeFileSync(txt, text);
  ff('-f', 'lavfi', '-i', `flite=textfile=${txt}:voice=${voice}`, '-ar', '48000', '-ac', '1', wav);
  const len = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav]).toString());
  // One time stamp before each word after the first, placed by letter count.
  const words = text.split(' ');
  const letters = words.map((w) => w.replace(/[^a-z]/gi, '').length + 1);
  const total = letters.reduce((a, b) => a + b, 0);
  let at = t, body = '';
  words.forEach((w, k) => {
    body += (k ? ` <${stamp(at)}>` : '') + w;
    at += (letters[k] / total) * len;
  });
  cues.push(`${i + 1}\n${stamp(t)} --> ${stamp(t + len + GAP - 0.05)} ${who === 'Ada' ? 'position:4% align:start' : 'position:96% align:end'}\n<v ${who}>${body}</v>`);
  parts.push({ wav, delay: Math.round(t * 1000) });
  t += len + GAP;
});
const length = Math.ceil(t * 10) / 10 + 0.3;

const inputs = parts.flatMap((p) => ['-i', p.wav]);
const mix = parts.map((p, i) => `[${i}:a]adelay=${p.delay}[a${i}]`).join(';') + ';' + parts.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${parts.length}:normalize=0,volume=1.6,apad,atrim=0:${length},asplit[snd][wave]`;
const picture = `[wave]showwaves=s=640x360:mode=cline:rate=30:colors=white:scale=sqrt,colorkey=black:0.1:0.2[w];gradients=s=640x360:r=30:c0=0xd2491f:c1=0x1565c0:c2=0xffd166:c3=0x2e7d32:nb_colors=4:speed=0.02:d=${length}[bg];[bg][w]overlay=format=auto,format=yuv420p[v]`;
ff(...inputs, '-filter_complex', `${mix};${picture}`, '-map', '[v]', '-map', '[snd]', '-t', String(length), '-c:v', 'libvpx-vp9', '-b:v', '160k', '-g', '30', '-row-mt', '1', '-cpu-used', '3', '-c:a', 'libopus', '-b:a', '40k', path.join(out, 'talk.webm'));
writeFileSync(path.join(out, 'talk.vtt'), `WEBVTT\n\nNOTE Made by tools/speech-clip/make.mjs. Word time stamps are estimates.\n\n${cues.join('\n\n')}\n`);
rmSync(tmp, { recursive: true });
console.log(`talk.webm: ${length.toFixed(1)} s, ${cues.length} cues`);
