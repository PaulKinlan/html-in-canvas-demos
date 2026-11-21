// Reads every page file under public/ and returns the site's list of pages.
//
// A page describes itself in a JSON file beside its HTML:
//   public/<name>/page.json          describes /<name>/
//   public/<name>/<file>.page.json   describes /<name>/<file>.html
//   public/page.json                 describes /
// No file lists all pages, so two branches that each add a page touch
// different files. `npm run build` turns the page files into
// public/shared/pages.js, which is not committed.
//
// Fields (all optional unless marked):
//   group     required for a menu entry: the name of a file in tools/site/groups/
//   title     required for a menu entry: the name in the menu and on the homepage card
//   blurb     one or two sentences for the homepage card (HTML allowed)
//   tags      a few API names shown as chips
//   order     position inside the group. Pages without it come after the
//             pages that have it, by `added` date and then by path.
//   added     the date the page was added, YYYY-MM-DD
//   menu      false keeps the page out of the menu and the homepage
//   kind      "tutorial" for /start/. Everything else is an experiment.
//   question  the question the experiment asks (HTML allowed)
//   result    the short answer, if there is one (HTML allowed)
//   first     paths of pages this one builds on
//   api       the calls and attributes the page uses
//   plan      id of the planned demo this page builds (tools/chrome-apis/demos.json)
//   jank      known exceptions for `npm run check:jank`: { metric: { max, why } }
import { readdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(here, '../..');

const KNOWN = new Set(['group', 'title', 'blurb', 'tags', 'order', 'added', 'menu', 'kind', 'question', 'result', 'first', 'api', 'plan', 'jank']);
const SKIP_DIRS = new Set(['vendor', 'node_modules', 'media', 'thumbs']);

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), out); }
    else if (e.name === 'page.json' || e.name.endsWith('.page.json')) out.push(path.join(dir, e.name));
  }
  return out;
}

const exists = (f) => access(f).then(() => true, () => false);

/** The path a page file describes: public/a/page.json → /a/, public/a/b.page.json → /a/b.html. */
export function hrefOf(publicDir, file) {
  const rel = path.relative(publicDir, file).split(path.sep).join('/');
  if (rel === 'page.json') return '/';
  if (rel.endsWith('/page.json')) return '/' + rel.slice(0, -'page.json'.length);
  return '/' + rel.slice(0, -'.page.json'.length) + '.html';
}

/**
 * Read the page files. Returns { groups, pages, menu, problems, warnings }.
 * `pages` is every page keyed by path. `menu` is the menu entries in display order.
 */
export async function readPages(publicDir = path.join(repoRoot, 'public')) {
  // One file per menu group, tools/site/groups/<key>.json with { order, title },
  // so two branches that each add a group add different files.
  const groupDir = path.join(here, 'groups');
  const groupFiles = (await readdir(groupDir)).filter((f) => f.endsWith('.json')).sort();
  const groups = (await Promise.all(groupFiles.map(async (f) => ({ key: f.slice(0, -5), ...JSON.parse(await readFile(path.join(groupDir, f), 'utf8')) }))))
    .sort((a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || a.key.localeCompare(b.key))
    .map((g) => [g.key, g.title]);
  const groupRank = new Map(groups.map(([key], i) => [key, i]));
  const problems = [];
  const warnings = [];
  const pages = {};

  for (const file of (await walk(publicDir)).sort()) {
    const rel = path.relative(repoRoot, file);
    const href = hrefOf(publicDir, file);
    let data;
    try { data = JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { problems.push(`${rel}: not valid JSON (${e.message})`); continue; }
    for (const k of Object.keys(data)) if (!KNOWN.has(k)) problems.push(`${rel}: unknown field "${k}"`);
    const target = href.endsWith('/') ? path.join(publicDir, href, 'index.html') : path.join(publicDir, href);
    if (!(await exists(target))) problems.push(`${rel}: describes ${href}, and ${path.relative(repoRoot, target)} does not exist`);
    if (data.menu !== false) {
      if (!data.title) problems.push(`${rel}: a menu entry needs "title"`);
      if (!data.group) problems.push(`${rel}: a menu entry needs "group"`);
      else if (!groupRank.has(data.group)) problems.push(`${rel}: unknown group "${data.group}". Groups are the files in tools/site/groups/`);
    }
    if (data.added && !/^\d{4}-\d{2}-\d{2}$/.test(data.added)) problems.push(`${rel}: "added" must be YYYY-MM-DD`);
    pages[href] = { href, ...data };
  }
  for (const p of Object.values(pages)) {
    for (const f of p.first ?? []) if (!pages[f]) problems.push(`${p.href}: "first" names ${f}, which has no page file`);
  }

  // Files that used to hold these lists. A merge that brings one back would be ignored without this.
  for (const [old, now] of [['public/shared/demos.js', 'a page.json beside each page'], ['tools/jank/allow.json', 'the "jank" field of each page.json']]) {
    if (await exists(path.join(repoRoot, old))) problems.push(`${old} exists. Its content now lives in ${now}. Move the entries and delete the file.`);
  }

  // A page with the site menu and no page file is not in the menu.
  for (const e of await readdir(publicDir, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    const index = path.join(publicDir, e.name, 'index.html');
    if (pages[`/${e.name}/`] || !(await exists(index))) continue;
    if ((await readFile(index, 'utf8')).includes('/shared/nav.js')) warnings.push(`public/${e.name}/index.html has the site menu and no page.json, so it is not in the menu`);
  }

  const rank = (p) => [groupRank.get(p.group) ?? groups.length, p.order ?? Infinity, p.added ?? '9999', p.href];
  const cmp = (a, b) => { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; return 0; };
  const menu = Object.values(pages).filter((p) => p.menu !== false).sort(cmp);
  return { groups, pages, menu, problems, warnings };
}
