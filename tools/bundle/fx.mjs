// Builds public/lib/fx.js: the fx attribute as ONE file that another site can
// include with a single <script type="module">. The source stays in separate
// modules (shader-fx.js and what it imports); this joins them.
//
//   npm run build:fx          write public/lib/fx.js
//   npm run check:fx          fail if public/lib/fx.js is not what the sources build
//
// No dependencies. It is not a general bundler: it understands the import and
// export forms these modules use (named imports from relative paths, and
// `export` in front of const, let, function, async function and class, plus
// `export { a, b };`) and stops with an error on anything else. Each module
// becomes a function scope, so names cannot clash between files.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entry = resolve(root, 'public/lib/shader-fx.js');
const out = resolve(root, 'public/lib/fx.js');
const ENTRY_EXPORTS = ['defineEffect', 'effects', 'FxSurface'];

const order = []; // files, dependencies first
const modules = new Map(); // file -> { id, code, exports }

function load(file) {
  if (modules.has(file)) return modules.get(file);
  const mod = { id: `m${modules.size}`, code: '', exports: [] };
  modules.set(file, mod);
  let src = readFileSync(file, 'utf8');
  if (/\bimport\s*\(|\bimport\.meta\b|export\s+default\b|export\s+\*|import\s+\*|import\s+[A-Za-z_$][\w$]*\s*(,|from)/.test(src)) {
    throw new Error(`${relative(root, file)}: uses an import or export form this tool does not handle`);
  }
  // import { a, b as c } from './x.js';
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_, names, from) => {
    if (!from.startsWith('.')) throw new Error(`${relative(root, file)}: import from "${from}" is not a relative path`);
    const dep = load(resolve(dirname(file), from));
    const list = names.split(',').map((n) => n.trim()).filter(Boolean).map((n) => n.replace(/\s+as\s+/, ': '));
    return `const { ${list.join(', ')} } = ${dep.id};`;
  });
  src = src.replace(/^import\s*['"]([^'"]+)['"];?[ \t]*$/gm, (_, from) => {
    load(resolve(dirname(file), from));
    return '';
  });
  // export { a, b };
  src = src.replace(/^export\s*\{([^}]*)\};?[ \t]*$/gm, (_, names) => {
    for (const n of names.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (/\sas\s/.test(n)) throw new Error(`${relative(root, file)}: "export { ${n} }" renames, which this tool does not handle`);
      mod.exports.push(n);
    }
    return '';
  });
  // export const x / export function x / export class X
  src = src.replace(/^export\s+((?:async\s+)?function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (_, kind, name) => {
    mod.exports.push(name);
    return `${kind} ${name}`;
  });
  if (/^\s*(import|export)\b/m.test(src)) {
    const line = src.split('\n').find((l) => /^\s*(import|export)\b/.test(l));
    throw new Error(`${relative(root, file)}: could not rewrite "${line.trim()}"`);
  }
  mod.code = src;
  order.push(file);
  return mod;
}

load(entry);
const entryMod = modules.get(entry);
for (const name of ENTRY_EXPORTS) if (!entryMod.exports.includes(name)) throw new Error(`shader-fx.js does not export ${name}`);

let text = `// fx: draw any HTML element through a fragment shader with one attribute.
//
//   <script type="module" src="https://html-in-canvas.page/lib/fx.js"></script>
//   <button fx="ripple">Still a button</button>
//
// Needs the HTML-in-canvas API (Chrome with chrome://flags/#canvas-draw-element).
// Without it the page is left as plain HTML.
// Instructions and a live editor: https://html-in-canvas.page/shader-css/
//
// GENERATED FILE. Do not edit. Built by tools/bundle/fx.mjs from:
${order.map((f) => `//   ${relative(root, f)}`).join('\n')}
`;
for (const file of order) {
  const mod = modules.get(file);
  text += `\n// ---- ${relative(root, file)} ----\nconst ${mod.id} = (() => {\n${mod.code.trimEnd()}\nreturn { ${[...new Set(mod.exports)].join(', ')} };\n})();\n`;
}
text += `\nexport const { ${ENTRY_EXPORTS.join(', ')} } = ${entryMod.id};\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(out, 'utf8'); } catch {}
  if (current !== text) {
    console.error('public/lib/fx.js is out of date. Run: npm run build:fx');
    process.exit(1);
  }
  console.log('public/lib/fx.js is up to date.');
} else {
  writeFileSync(out, text);
  console.log(`wrote ${relative(root, out)} (${(text.length / 1024).toFixed(0)} KB from ${order.length} modules)`);
}
