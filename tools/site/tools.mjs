#!/usr/bin/env node
// npm run tools
//
// Lists the scripts under tools/ with the first line of each script's header
// comment. A new tool is a new file, run as `node tools/<name>/<script>.mjs`.
// It does not get a line in package.json, because every branch that adds a
// script there edits the same few lines.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from './pages.mjs';

const dir = path.join(repoRoot, 'tools');
for (const d of (await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
  for (const f of (await readdir(path.join(dir, d.name))).sort()) {
    if (!/\.(mjs|js|sh)$/.test(f)) continue;
    const lines = (await readFile(path.join(dir, d.name, f), 'utf8')).split('\n');
    const comments = lines.filter((l) => /^(\/\/|#)(?!!)/.test(l)).map((l) => l.replace(/^(\/\/|#)\s?/, '').trim()).filter(Boolean);
    const run = comments.find((c) => /^(npm run|node |tools\/|bash )/.test(c))?.split(/\s{2,}/)[0];
    const what = comments.find((c) => !/^(npm run|node |tools\/|bash )/.test(c)) ?? '';
    console.log(`${(f.endsWith('.sh') ? '' : 'node ') + `tools/${d.name}/${f}`}\n    ${run && !run.startsWith('node tools') ? `(${run}) ` : ''}${what}`);
  }
}
