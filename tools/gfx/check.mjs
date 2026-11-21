#!/usr/bin/env node
// npm run check:gfx
//
// Reads the source of every page and library under public/ and fails on the
// calls that have lost canvases or crashed the tab on the test phone
// (Chrome 159, Android). The test browser does not reproduce those losses, so
// these rules are checked in the source. `npm run build` runs this check
// (tools/gfx/site-build.mjs), so a page that breaks a rule fails the Workers
// build and gets no preview. What the rules are for: docs/graphics-rules.md.
//
//   lose-context    WEBGL_lose_context.loseContext() is called. On a drawable
//                   canvas this has crashed the renderer. Give a canvas back
//                   with window.__gfx.retire(canvasOrElement) after removing it.
//   own-device      GPUAdapter.requestDevice() outside shared/backend.js. A page
//                   uses the one shared device from webgpu().
//   webgl-context   getContext('webgl' or 'webgl2') outside lib/element-gl.js.
//                   A page draws all its elements on one canvas with ElementGL from
//                   that file. Chrome on Android keeps 8 per tab.
//   float-readback  getImageData() with pixelFormat 'rgba-float16'. Allowed
//                   only with a reason, and never on a timer or in a frame.
//   timed-readback  getImageData(), readPixels() or mapAsync() inside the
//                   callback of setInterval() or requestAnimationFrame() that
//                   is written inline around it. (A loop reached through a
//                   function call is found by check:jank, which counts the
//                   readbacks a page makes when nobody touches it.)
//
// An exception is written at the call, on the same line or the line above,
// with the reason:
//
//   // gfx-allow: webgl-context the page's one context, lost and restored by hand
//
// tools/gfx/known.json lists the files that broke a rule before the rule
// existed, each with a reason. Do not add a new page to it: use the comment.
//
//   node tools/gfx/check.mjs              every file under public/
//   node tools/gfx/check.mjs --root dir   another checkout's public/ folder
//   node tools/gfx/check.mjs --list       also print the allowed exceptions
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// Not read: other people's code, build output, and the bundle whose sources are read. A file with a
// line over 2,000 characters is a compiled or minified bundle (a framework's runtime) and is not read either.
// A page that ships someone else's runtime puts it in a folder named vendor/.
const SKIP = [/(^|\/)vendor\//, /(^|\/)canvaskit\//, /^native-ui\/(egui|qt)\//, /^lib\/fx\.js$/, /^media\//, /^shared\/pages\.js$/];
// The shared modules that are the one allowed place for each call.
const HOME = {
  'lose-context': ['shared/context-guard.js'],
  'own-device': ['shared/backend.js'],
  'webgl-context': ['lib/element-gl.js'],
};
const RULES = [
  { rule: 'lose-context', re: /\.loseContext\s*\(/g, say: 'loseContext() can crash the renderer. Remove the canvas and call window.__gfx?.retire(canvas).' },
  { rule: 'own-device', re: /(?<!\b(?:hid|usb|bluetooth|serial))\.requestDevice\s*\(/g, say: 'A second WebGPU device. Use webgpu() from /shared/backend.js.' },
  { rule: 'webgl-context', re: /getContext\(\s*['"`](?:webgl2?|experimental-webgl)['"`]/g, say: 'Another WebGL context. Draw every element on one canvas with ElementGL from /lib/element-gl.js.' },
  { rule: 'float-readback', re: /pixelFormat\s*:\s*['"`]rgba-float16['"`]/g, say: 'A float readback from a GPU canvas. It matched the losses on /hdr-glow/.' },
];
const READ = /\b(getImageData|readPixels|mapAsync)\s*\(/g;
const LOOP = /\b(setInterval|requestAnimationFrame)\s*\(\s*(?:async\s*)?(?:function\b[^{]*|\([^)]*\)\s*=>|\w+\s*=>)\s*\{/g;

async function walk(dir, base = dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name), rel = path.relative(base, full).split(path.sep).join('/');
    if (SKIP.some((re) => re.test(rel + (e.isDirectory() ? '/' : '')))) continue;
    if (e.isDirectory()) await walk(full, base, out);
    else if (/\.(js|mjs|html)$/.test(e.name)) out.push(rel);
  }
  return out;
}

// Blank out comments and, in HTML, everything outside <script>, keeping line numbers.
function codeOnly(text, isHTML) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  if (isHTML) {
    let out = '', at = 0;
    for (const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      const start = m.index + m[0].indexOf('>') + 1;
      out += blank(text.slice(at, start)) + m[1];
      at = start + m[1].length;
    }
    text = out + blank(text.slice(at));
  }
  // Comments. A URL's "//" follows a colon and is left alone.
  return text.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)));
}

// The end of the block that opens at `open` (the index of a "{").
function blockEnd(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}' && --depth === 0) return i;
  }
  return code.length;
}

export async function checkGfx(root) {
  const known = JSON.parse(await readFile(path.join(here, 'known.json'), 'utf8'));
  const problems = [], allowed = [];
  for (const rel of await walk(root)) {
    const text = await readFile(path.join(root, rel), 'utf8');
    const lines = text.split('\n');
    if (lines.some((l) => l.length > 2000)) continue;
    const code = codeOnly(text, rel.endsWith('.html'));
    const lineOf = (i) => code.slice(0, i).split('\n').length;
    const excuse = (rule, line) => {
      for (const l of [lines[line - 1], lines[line - 2] ?? '']) {
        const m = l.match(new RegExp(`gfx-allow:\\s*${rule}\\s+(\\S.{7,})`));
        if (m) return m[1].replace(/\s*(\*\/|-->)\s*$/, '').trim();
      }
      return known[rel]?.[rule] ?? null;
    };
    const hit = (rule, line, say) => {
      if (HOME[rule]?.includes(rel)) return;
      const why = excuse(rule, line);
      (why ? allowed : problems).push({ file: rel, line, rule, say, why, text: lines[line - 1].trim().slice(0, 110) });
    };
    for (const { rule, re, say } of RULES) for (const m of code.matchAll(re)) hit(rule, lineOf(m.index), say);
    for (const m of code.matchAll(LOOP)) {
      const open = m.index + m[0].length - 1, body = code.slice(open, blockEnd(code, open));
      for (const r of body.matchAll(READ)) hit('timed-readback', lineOf(open + r.index), `${r[1]}() inside a ${m[1]}() callback. Read back on a tap, or from a 2D canvas made with willReadFrequently.`);
    }
  }
  // An entry in known.json for a file that no longer breaks the rule is stale.
  const stale = [];
  for (const [file, rules] of Object.entries(known)) for (const rule of Object.keys(rules)) {
    if (!allowed.some((a) => a.file === file && a.rule === rule)) stale.push(`${file}: ${rule}`);
  }
  return { problems, allowed, stale };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--root');
  const root = at >= 0 ? path.resolve(argv[at + 1]) : path.resolve(here, '../../public');
  const { problems, allowed, stale } = await checkGfx(root);
  if (argv.includes('--list')) for (const a of allowed) console.log(`allowed  ${a.file}:${a.line}  ${a.rule}: ${a.why}`);
  for (const s of stale) console.log(`stale    tools/gfx/known.json lists ${s}, and the file no longer does it. Remove the entry.`);
  for (const p of problems) console.log(`FAIL     ${p.file}:${p.line}  ${p.rule}\n         ${p.text}\n         ${p.say}`);
  console.log(`\ncheck:gfx: ${problems.length} problem(s), ${allowed.length} allowed exception(s).`);
  if (problems.length || stale.length) process.exit(1);
}
