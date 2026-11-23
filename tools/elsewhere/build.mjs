#!/usr/bin/env node
// Writes the list on /elsewhere/ (other people's demos and interface work) from
// public/elsewhere/entries.json into public/elsewhere/index.html, between the
// `elsewhere:start` and `elsewhere:end` comments. The page is static HTML, so it
// needs no script to show the list and nothing moves while it loads.
//
//   node tools/elsewhere/build.mjs            validate the entries and rewrite the list
//   node tools/elsewhere/build.mjs --check    fail if the page is not up to date (writes nothing)
//   node tools/elsewhere/build.mjs --links    also request every outside link and print the ones that fail
//
// To add an entry: add an object to "entries" in entries.json, set "updated" to
// today, run this script and commit both files. The weekly run described in
// docs/ui-watch/README.md does the same.
//
// An entry:
//   id      required. Lower case, digits and hyphens. It is the anchor on the page and the
//           guid in /elsewhere/feed.xml, so never change it once published.
//   kind    required. One of the keys of KINDS below.
//   title   required. HTML text: write &lt;rangegroup&gt; for an element name.
//   by      required. Who made it.
//   url     required. The original: where its maker published it.
//   source  the source code or a second link, if there is one.
//   via     { name, url }: where it was found, when that is not the original.
//   made    YYYY-MM-DD, the day it was published, if known.
//   added   required. YYYY-MM-DD, the day it joined this list.
//   what    required. One or two sentences on what it does. HTML: only <code> is allowed.
//   note    what it shows that this site lacks, or how it could be drawn with the API.
//   here    paths of pages on this site that ask the nearest question.
//
// tools/feed/site-build.mjs reads the same file during `npm run build` and writes
// public/elsewhere/feed.xml (not committed).

import { readFile, writeFile, access } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataFile = path.join(root, 'public/elsewhere/entries.json');
const pageFile = path.join(root, 'public/elsewhere/index.html');
const START = '<!-- elsewhere:start (written by `node tools/elsewhere/build.mjs` from entries.json; do not edit) -->';
const END = '<!-- elsewhere:end -->';

// The sections of the page, in order.
export const KINDS = {
  hic: { title: 'Made with HTML-in-canvas', intro: 'Demos by other people that draw live HTML in a canvas.' },
  library: { title: 'Libraries and frameworks', intro: 'Code you can install that uses the API.' },
  collection: { title: 'Collections', intro: 'Other lists of demos.' },
  ui: { title: 'Interface work I\'d like to rebuild', intro: 'None of these use the API. Each is a control or an effect that I think could be rebuilt with a native element drawn by a canvas. The second line of each says how. That line is a plan: I haven\'t measured any of them.' },
  proposal: { title: 'Proposed controls and elements', intro: 'New HTML controls under discussion. A canvas can draw one as soon as a browser has a prototype.' },
  reading: { title: 'Reading', intro: 'Announcements, documentation and write-ups.' },
  place: { title: 'Where I look', intro: 'The sites the weekly search reads.' },
};

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const LINKS = args.includes('--links');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = (html) => String(html).replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const exists = (f) => access(f).then(() => true, () => false);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isUrl = (s) => /^https:\/\/[^\s"<>]+$/.test(s);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const day = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
// Only <code> and character references are allowed in the HTML fields.
const htmlOk = (s) => !/<(?!\/?code>)/.test(s) && !/&(?!(?:lt|gt|amp|quot|#\d+);)/.test(s);

async function validate(data) {
  const problems = [];
  if (!isDate(data.updated ?? '')) problems.push('"updated" must be a date, YYYY-MM-DD');
  const seen = new Set();
  const urls = new Map();
  for (const [i, e] of (data.entries ?? []).entries()) {
    const at = `entry ${i + 1} (${e.id ?? 'no id'})`;
    for (const k of ['id', 'kind', 'title', 'by', 'url', 'added', 'what']) if (!e[k]) problems.push(`${at}: "${k}" is missing`);
    if (e.id && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.id)) problems.push(`${at}: "id" must be lower case letters, digits and hyphens`);
    if (seen.has(e.id)) problems.push(`${at}: the id is used twice`);
    seen.add(e.id);
    if (e.kind && !KINDS[e.kind]) problems.push(`${at}: unknown kind "${e.kind}"`);
    for (const k of ['url', 'source']) if (e[k] && !isUrl(e[k])) problems.push(`${at}: "${k}" must be an https URL`);
    if (e.via && !(e.via.name && isUrl(e.via.url ?? ''))) problems.push(`${at}: "via" needs a name and an https url`);
    for (const k of ['added', 'made']) if (e[k] && !isDate(e[k])) problems.push(`${at}: "${k}" must be a date, YYYY-MM-DD`);
    for (const k of ['title', 'what', 'note']) if (e[k] && !htmlOk(e[k])) problems.push(`${at}: "${k}" may hold only <code> tags and &lt; &gt; &amp; &quot;`);
    if (e.url) { if (urls.has(e.url)) problems.push(`${at}: the same url as ${urls.get(e.url)}`); urls.set(e.url, e.id); }
    for (const h of e.here ?? []) {
      if (!/^\/[a-z0-9-]+\/$/.test(h) || !(await exists(path.join(root, 'public', h, 'index.html')))) problems.push(`${at}: "here" names ${h}, which is not a page on this site`);
    }
  }
  return problems;
}

function card(e) {
  const facts = [`By ${esc(e.by)}`];
  if (e.made) facts.push(`<time datetime="${e.made}">${day(e.made)}</time>`);
  const links = [];
  if (e.source) links.push(`<a href="${esc(e.source)}">${/github\.com/.test(e.source) ? 'Source' : 'More'}</a>`);
  if (e.via) links.push(`found through <a href="${esc(e.via.url)}">${esc(e.via.name)}</a>`);
  const here = (e.here ?? []).map((h) => `<a href="${h}">${h}</a>`).join(', ');
  return [
    `    <article class="card find" id="${e.id}">`,
    `      <h3><a href="${esc(e.url)}">${e.title}</a></h3>`,
    `      <p class="by">${facts.join(' · ')}${links.length ? ` · ${links.join(' · ')}` : ''}</p>`,
    `      <p>${e.what}</p>`,
    e.note ? `      <p class="note">${e.note}</p>` : null,
    here ? `      <p class="here">Nearest here: ${here}</p>` : null,
    `    </article>`,
  ].filter(Boolean).join('\n');
}

export function render(data) {
  const byKind = Object.fromEntries(Object.keys(KINDS).map((k) => [k, []]));
  for (const e of data.entries) byKind[e.kind].push(e);
  // Newest additions first, then newest work, then by name.
  for (const list of Object.values(byKind)) {
    list.sort((a, b) => b.added.localeCompare(a.added) || (b.made ?? '').localeCompare(a.made ?? '') || text(a.title).localeCompare(text(b.title)));
  }
  const kinds = Object.keys(KINDS).filter((k) => byKind[k].length);
  const out = [START];
  out.push(`  <p class="count">${data.entries.length} entries. Last added to on <time datetime="${data.updated}">${day(data.updated)}</time>.</p>`);
  out.push('  <nav class="kinds" aria-label="Sections of this page">');
  for (const k of kinds) out.push(`    <a href="#${k}">${esc(KINDS[k].title)} <span>${byKind[k].length}</span></a>`);
  out.push('  </nav>');
  for (const k of kinds) {
    out.push(`  <section id="${k}">`, `    <h2>${esc(KINDS[k].title)}</h2>`, `    <p class="intro">${esc(KINDS[k].intro)}</p>`, '    <div class="finds">');
    out.push(byKind[k].map(card).join('\n'));
    out.push('    </div>', '  </section>');
  }
  out.push(`  ${END}`);
  return out.join('\n');
}

function request(url) {
  // curl, because it follows the proxy settings of the environment it runs in.
  return new Promise((resolve) => {
    execFile('curl', ['-sL', '-m', '25', '-o', '/dev/null', '-w', '%{http_code}', '-A', 'Mozilla/5.0 (link check)', url], (err, stdout) => resolve(stdout || (err ? 'error' : '000')));
  });
}

const data = JSON.parse(await readFile(dataFile, 'utf8'));
const problems = await validate(data);
if (problems.length) {
  console.error(`elsewhere: ${problems.length} problem${problems.length === 1 ? '' : 's'} in entries.json\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const page = await readFile(pageFile, 'utf8');
const a = page.indexOf(START), b = page.indexOf(END);
if (a < 0 || b < a) { console.error('elsewhere: the elsewhere:start and elsewhere:end comments are missing from index.html'); process.exit(1); }
const next = page.slice(0, a) + render(data) + page.slice(b + END.length);
if (CHECK) {
  if (next !== page) { console.error('elsewhere: index.html is not up to date. Run node tools/elsewhere/build.mjs'); process.exit(1); }
  console.log(`elsewhere: ${data.entries.length} entries, the page is up to date`);
} else {
  if (next !== page) await writeFile(pageFile, next);
  console.log(`elsewhere: ${data.entries.length} entries${next === page ? ', no change' : ', page written'}`);
}

if (LINKS) {
  const urls = [...new Set(data.entries.flatMap((e) => [e.url, e.source, e.via?.url]).filter(Boolean))];
  const results = [];
  for (let i = 0; i < urls.length; i += 8) results.push(...await Promise.all(urls.slice(i, i + 8).map(async (u) => [u, await request(u)])));
  const bad = results.filter(([, code]) => !/^2/.test(code));
  console.log(`links: ${urls.length} requested, ${urls.length - bad.length} answered 2xx`);
  for (const [u, code] of bad) console.log(`  ${code}  ${u}`);
}
