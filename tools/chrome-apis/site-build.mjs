// The Chrome APIs plan as part of `npm run build` (see tools/site/build.mjs).
// It writes public/chrome-apis/data.js and public/chrome-apis/plan.md, which are
// not committed. Which planned demos are built comes from the "plan" field of
// the page files, so it has to run after they are read.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function build() {
  const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build.mjs');
  const out = execFileSync(process.execPath, [script, '--quiet'], { encoding: 'utf8' }).trim();
  return `public/chrome-apis/data.js and plan.md: ${out}`;
}
