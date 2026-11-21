// Run by `npm run build` (tools/site/build.mjs calls every tools/<name>/site-build.mjs).
// The build fails when a page or library breaks a graphics rule: see check.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkGfx } from './check.mjs';

export async function build() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
  const { problems, allowed, stale } = await checkGfx(root);
  for (const p of problems) console.error(`error: public/${p.file}:${p.line} ${p.rule}: ${p.say}`);
  for (const s of stale) console.error(`error: tools/gfx/known.json lists ${s}, and the file no longer does it. Remove the entry.`);
  if (problems.length || stale.length) throw new Error(`${problems.length + stale.length} graphics rule problem(s). Run \`node tools/gfx/check.mjs\` for the lines, and read docs/graphics-rules.md.`);
  return `graphics rules: no problems, ${allowed.length} allowed exceptions`;
}
