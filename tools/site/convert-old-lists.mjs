#!/usr/bin/env node
// node tools/site/convert-old-lists.mjs <ref>
//
// Converts what a branch from before 2026-11-21 added to the old shared lists
// into the per-page files that replaced them. Use it when such a branch and
// main are merged and the merge conflicts in FINDINGS.md, shared/demos.js,
// shared/learn.js or shared/support.js.
//
// <ref> is the side of the merge that still has the old files: the branch's
// own tip (`HEAD` when you are on the branch and have run `git merge
// origin/main`), or `origin/main` when main is the old side. The script reads
// the old files from <ref> with `git show` and writes into the working tree:
//
//   public/shared/demos.js entries        ->  public/<name>/page.json (group, title, blurb, tags)
//   LEARN.pages in public/shared/learn.js ->  the same page.json (question, result, first, api)
//   tools/jank/allow.json                 ->  the same page.json (jank)
//   CHECKS_WAIT_FOR_TAP in support.js     ->  <meta name="checks" content="tap"> in each page
//   "built" in tools/chrome-apis/demos.json ->  "plan" in the page.json of the page that builds the demo
//   sections of FINDINGS.md               ->  findings/<name>.md
//
// It only adds what is missing and merges a findings section that both sides
// changed (a three-way merge against the common ancestor). It prints what it
// did and what is left for you: take the new version of FINDINGS.md and
// learn.js, delete demos.js and allow.json, and resolve support.js and
// README.md by hand. Then run `npm run check:pages`.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { repoRoot } from './pages.mjs';

const ref = process.argv[2];
if (!ref) { console.error('usage: node tools/site/convert-old-lists.mjs <ref>'); process.exit(2); }
const git = (...a) => execFileSync('git', a, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
const show = (r, file) => { try { return git('show', `${r}:${file}`); } catch { return null; } };
const today = new Date().toISOString().slice(0, 10);
const other = ['HEAD', 'MERGE_HEAD', 'origin/main'].map((r) => { try { return git('rev-parse', r).trim(); } catch { return null; } }).find((sha) => sha && sha !== git('rev-parse', ref).trim());
let base = null;
try { base = git('merge-base', ref, other).trim(); } catch {}
const abs = (f) => path.join(repoRoot, f);
const read = (f) => readFile(abs(f), 'utf8').catch(() => null);
const log = (s) => console.log(s);

const pageFile = (href) => href === '/' ? 'public/page.json' : href.endsWith('/') ? `public${href}page.json` : `public${href.replace(/\.html$/, '')}.page.json`;
async function patchPage(href, fields, why) {
  const file = pageFile(href);
  const old = JSON.parse((await read(file)) ?? 'null');
  const data = old ?? {};
  const added = [];
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && data[k] === undefined) { data[k] = v; added.push(k); }
  if (!added.length) return;
  if (!old && data.group && !data.added) data.added = today;
  if (!old && !data.group) data.menu = false;
  const order = ['group', 'order', 'added', 'menu', 'kind', 'title', 'blurb', 'tags', 'question', 'result', 'first', 'api', 'plan', 'jank'];
  const sorted = Object.fromEntries(Object.entries(data).sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0])));
  await writeFile(abs(file), JSON.stringify(sorted, null, 2) + '\n');
  log(`${old ? 'updated' : 'created'} ${file} (${added.join(', ')}) from ${why}`);
}

// ---- demos.js and learn.js
const demosSrc = show(ref, 'public/shared/demos.js');
const w = {};
if (demosSrc) {
  new Function('window', demosSrc)(w);
  for (const d of w.DEMOS) await patchPage(d.href, { group: d.group, title: d.title, blurb: d.blurb, tags: d.tags }, 'demos.js');
}
const learnSrc = show(ref, 'public/shared/learn.js');
if (learnSrc && /\n\s*pages:\s*\{/.test(learnSrc)) {
  const lw = { DEMOS: w.DEMOS ?? [] };
  new Function('window', 'document', 'location', learnSrc)(lw, {}, { pathname: '/' });
  for (const [href, l] of Object.entries(lw.LEARN.pages)) await patchPage(href, { kind: l.kind, question: l.question, result: l.result, first: l.first, api: l.api }, 'learn.js');
}
const allowSrc = show(ref, 'tools/jank/allow.json');
if (allowSrc) for (const [href, jank] of Object.entries(JSON.parse(allowSrc))) await patchPage(href, { jank }, 'allow.json');

// ---- "built" in tools/chrome-apis/demos.json -> "plan" in the page file
const planSrc = show(ref, 'tools/chrome-apis/demos.json');
if (planSrc) {
  const byPage = new Map();
  for (const d of JSON.parse(planSrc)) if (d.built) byPage.set(d.built, [...(byPage.get(d.built) ?? []), d.key]);
  for (const [href, keys] of byPage) {
    if (await read(pageFile(href)) === null) { log(`demos.json marks ${keys.join(', ')} as built by ${href}, which has no page file. Add "plan" to the page that builds it.`); continue; }
    await patchPage(href, { plan: keys.length === 1 ? keys[0] : keys }, 'the "built" field of tools/chrome-apis/demos.json');
  }
}

// ---- CHECKS_WAIT_FOR_TAP
const tapList = (src) => { const m = src?.match(/CHECKS_WAIT_FOR_TAP = \[([\s\S]*?)\]/); return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : null; };
const taps = tapList(show(ref, 'public/shared/support.js'));
const baseTaps = base ? tapList(show(base, 'public/shared/support.js')) : null;
const META = '<meta name="checks" content="tap">';
for (const href of taps ?? []) {
  const file = `public${href}index.html`;
  const html = await read(file);
  if (html === null || html.includes('name="checks"')) continue;
  const at = html.indexOf('\n', html.indexOf('<meta name="viewport"'));
  await writeFile(abs(file), html.slice(0, at) + '\n' + META + html.slice(at));
  log(`added the checks meta tag to ${file}`);
}
for (const href of (baseTaps ?? []).filter((h) => taps && !taps.includes(h))) {
  const file = `public${href}index.html`;
  const html = await read(file);
  if (html?.includes(META + '\n')) { await writeFile(abs(file), html.replace(META + '\n', '')); log(`removed the checks meta tag from ${file} (the branch took the page off the list)`); }
}

// ---- FINDINGS.md sections
const sections = (src) => {
  const out = new Map();
  if (!src || !src.includes('\n## Contents\n')) return out;
  const body = src.slice(src.indexOf('\n## Contents\n') + 1).split(/^(?=## )/m).slice(1);
  for (const part of body) {
    const nl = part.indexOf('\n');
    const title = part.slice(3, nl).trim();
    const text = part.slice(nl + 1).replace(/^(#{3,6}) /gm, (m, h) => h.slice(1) + ' ');
    out.set(title, `# ${title}\n${text.replace(/\n+$/, '')}\n`);
  }
  return out;
};
const theirs = sections(show(ref, 'FINDINGS.md'));
if (theirs.size) {
  const bases = sections(base ? show(base, 'FINDINGS.md') : null);
  const existing = new Map();
  for (const f of (await readdir(abs('findings')).catch(() => [])).filter((f) => f.endsWith('.md') && f !== 'README.md')) {
    const text = await read(`findings/${f}`);
    existing.set(text.slice(2, text.indexOf('\n')).trim(), f);
  }
  const tmp = await mkdtemp(path.join(tmpdir(), 'findings-'));
  for (const [title, text] of theirs) {
    let file = existing.get(title);
    if (!file) {
      // A renamed title of a section that existed before: match on the words before the first bracket.
      const stem = title.split(/[(:]/)[0].trim();
      file = [...existing].find(([t]) => t.split(/[(:]/)[0].trim() === stem)?.[1];
    }
    if (!file) {
      const m = title.match(/`?\/([a-z0-9-]+)\//);
      let slug = m ? m[1] : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
      while ([...existing.values()].includes(`${slug}.md`)) slug += '-2';
      await writeFile(abs(`findings/${slug}.md`), text);
      existing.set(title, `${slug}.md`);
      log(`created findings/${slug}.md from the section "${title}"`);
      continue;
    }
    const was = bases.get(title) ?? [...bases].find(([t]) => t.split(/[(:]/)[0].trim() === title.split(/[(:]/)[0].trim())?.[1];
    const body = (s) => s.slice(s.indexOf('\n') + 1);
    if (was && body(was) === body(text)) continue; // the branch did not change this section
    const now = await read(`findings/${file}`);
    if (body(now) === body(text)) continue;
    const [a, b, c] = ['ours', 'base', 'theirs'].map((n) => path.join(tmp, n));
    await writeFile(a, now); await writeFile(b, was ?? ''); await writeFile(c, text.replace(/^# .*\n/, now.slice(0, now.indexOf('\n') + 1)));
    let clean = true;
    try { execFileSync('git', ['merge-file', '--union', a, b, c]); } catch { clean = false; }
    await writeFile(abs(`findings/${file}`), await readFile(a, 'utf8'));
    log(`merged the branch's changes to "${title}" into findings/${file}${clean ? '' : ' (overlapping edits: both versions were kept, read the file)'}`);
  }
}

log(`
Left for you:
  git rm public/shared/demos.js tools/jank/allow.json public/chrome-apis/data.js docs/chrome-apis-plan.md   (those the merge left)
  in FINDINGS.md, README.md, public/shared/learn.js, public/shared/support.js and tools/chrome-apis/demos.json,
    resolve each conflict by keeping the new side: the old side's lines are now in the files written above
    (a "built" line in demos.json is dropped; the page's "plan" field replaces it)
  npm run check:pages`);
