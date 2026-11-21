#!/usr/bin/env node
// npm run check:merge
//
// Says whether this branch merges cleanly with main and with every other
// branch on the remote that has work main does not have. Run it before opening
// a pull request. It changes nothing: it uses `git merge-tree`, which merges in
// memory.
//
//   node tools/site/check-merge.mjs            fetch, then test main and all branches
//   node tools/site/check-merge.mjs --no-fetch use the refs already fetched
//   node tools/site/check-merge.mjs --days 7   also test branches last pushed up to 7 days ago (default 1)
//
// It exits with 1 when the merge with main conflicts. A conflict with another
// open branch is reported and does not fail, because only one of the two has to
// change. A file that both branches edit is a file to split: see
// ARCHITECTURE.md, "Why pull requests conflicted".
import { execFileSync } from 'node:child_process';
import { repoRoot } from './pages.mjs';

const git = (...a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tryGit = (...a) => { try { return git(...a); } catch (e) { return (e.stdout ?? '') + ''; } };

if (!process.argv.includes('--no-fetch')) {
  try { git('fetch', '--quiet', '--prune', 'origin'); } catch { console.warn('warning: git fetch failed, using the refs already here'); }
}
const conflicts = (other) => tryGit('merge-tree', '--write-tree', '--name-only', 'HEAD', other)
  .split('\n').filter((l) => l.startsWith('CONFLICT')).map((l) => l.replace(/^CONFLICT \([^)]*\): /, '').replace(/^Merge conflict in /, '').replace(/^(\S+) deleted in .*$/, '$1 (deleted on one side, edited on the other)'));

const main = conflicts('origin/main');
const behind = git('rev-list', '--count', 'HEAD..origin/main');
console.log(`origin/main: ${main.length ? `CONFLICTS in ${main.join(', ')}` : 'merges cleanly'}${+behind ? ` (this branch is ${behind} commits behind; merge main before opening the pull request)` : ''}`);

const head = git('rev-parse', 'HEAD');
const refs = git('for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin').split('\n').filter((r) => r && r !== 'origin/main' && r !== 'origin/HEAD' && r !== 'origin');
const days = +(process.argv[process.argv.indexOf('--days') + 1] ?? 1) || 1;
const since = Date.now() / 1000 - days * 86400;
let clashes = 0;
for (const ref of refs) {
  if (git('rev-parse', ref) === head) continue;
  if (git('rev-list', '--count', `origin/main..${ref}`) === '0') continue; // already merged
  if (+git('log', '-1', '--format=%ct', ref) < since) continue; // an old branch, not open work
  const c = conflicts(ref);
  if (c.length) { clashes++; console.log(`${ref}: would conflict in ${c.join(', ')}`); }
}
if (!clashes) console.log('No other unmerged branch conflicts with this one.');
process.exit(main.length ? 1 : 0);
