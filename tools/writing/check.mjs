#!/usr/bin/env node
// Writing check: flags the mechanical mannerisms listed in docs/writing.md.
//
//   node tools/writing/check.mjs                 every page, page.json and site data file
//   node tools/writing/check.mjs /portal/        one page (its HTML and page.json)
//   node tools/writing/check.mjs --docs          also the Markdown documents and findings/
//   node tools/writing/check.mjs --strict        warnings fail too
//   node tools/writing/check.mjs --rules         print the rules and stop
//
// It reads prose only: text in a page outside <script>, <style>, <pre>, <template> and
// <textarea>, <canvas> and <select>, with inline <code> left out; the title, blurb, question and result of a
// page.json; string text in the site's data files; and Markdown outside code.
// An error is a mannerism that is wrong wherever it appears. A warning needs a person to
// look, because the pattern is sometimes the plain way to say the thing.
// To accept one line, put `writing-allow: <rule id>` in a comment on that line or the
// line above it. The check cannot judge voice, rhythm or whether a sentence says anything:
// docs/writing.md has the list to read a page against.

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const args = process.argv.slice(2);
const STRICT = args.includes('--strict');
const DOCS = args.includes('--docs');
const only = args.filter((a) => a.startsWith('/')).map((a) => a.replace(/^\/|\/$/g, ''));

const W = (list) => new RegExp(`\\b(?:${list.join('|')})\\b`, 'gi');

// where: 'any' = every kind of text, 'heading' = h1 to h4 and Markdown headings, 'prose' = not headings
const RULES = [
  { id: 'em-dash', level: 'error', re: /—|&mdash;|&#8212;| -- /g, say: 'Em-dash. Use a full stop, a comma, a colon or brackets.' },
  { id: 'en-dash', level: 'error', re: / – | &ndash; /g, say: 'Spaced en-dash used as a dash. Use a full stop, a comma, a colon or brackets.' },
  { id: 'vocabulary', level: 'error', say: 'Word that sells and says nothing. Say what the thing does.',
    re: W(['delve[sd]?', 'delving', 'leverag(?:e|es|ed|ing)', 'seamless(?:ly)?', 'robust', 'powerful', 'magic(?:al|ally)?', 'delight(?:s|ed|ful|fully)?',
      'effortless(?:ly)?', 'unleash(?:es|ed|ing)?', 'supercharg(?:e|es|ed|ing)', 'game[- ]chang(?:er|ing)', 'cutting[- ]edge', 'state[- ]of[- ]the[- ]art',
      'tapestry', 'testament', 'pivotal', 'streamlin(?:e|es|ed|ing)', 'showcas(?:e|es|ed|ing)', 'elevat(?:e|es|ed|ing) (?:your|the)', 'unlock(?:s|ed|ing)? (?:the|new|your)',
      'harness(?:es|ed|ing)? the', 'empower(?:s|ed|ing)?', 'plethora', 'myriad', 'ever[- ](?:evolving|changing)', 'on steroids', 'the sharp edges?', 'sharp edges', 'blazing(?:ly)?',
      'jaw[- ]dropping', 'stunning(?:ly)?', 'breathtaking', 'revolutioni[sz](?:e|es|ed|ing)', 'best[- ]in[- ]class', 'world[- ]class', 'next[- ]level', 'rich tapestry',
      'utili[sz](?:e|es|ed|ing)', 'facilitat(?:e|es|ed|ing)', 'holistic(?:ally)?', 'synerg(?:y|ies)', 'paradigm(?:s| shift)?', 'treasure trove', 'buckle up', 'vibrant']) },
  { id: 'stock-phrase', level: 'error', say: 'Stock phrase. Cut it and start with the fact.',
    re: W(["it(?:'s| is) worth noting", "it(?:'s| is) important to (?:note|remember|understand)", 'keep in mind that', 'in conclusion', 'in summary', 'to sum up', 'in essence',
      'at its core', 'at the end of the day', 'when it comes to', "in today's", 'in the world of', 'the world of', "let(?:'s| us) (?:dive|explore|take a look|unpack|break (?:it|this) down)",
      'dive (?:in|into|deep)', 'deep dive', 'without further ado', 'the best of both worlds', 'look no further', 'say goodbye to', 'gone are the days', 'a wide (?:range|variety) of',
      'a breeze', 'take (?:it|this|your \\w+) to the next level', 'this is where \\w+ comes? in', 'the power of', 'the beauty of', 'the magic of', 'under the hood',
      'out of the box', 'first[- ]class citizen', 'rest assured', 'needless to say', 'that being said', 'having said that', 'the real DOM', 'no strings attached',
      "whether you(?:'re| are)", 'not only\\b[^.]{0,80}\\bbut also', 'more than just', "(?:isn't|is not|aren't|are not) just", 'not just (?:a|an|the|about)\\b', 'just works', 'the trick is', 'the secret is', 'the key is (?:to|that)', 'the key (?:insight|takeaway)',
      'think of it as', 'imagine (?:a|if|being)', "here(?:'s| is) the (?:thing|catch|kicker|twist)", 'spoiler(?: alert)?', 'plot twist', 'the result\\?', 'the catch\\?', 'the best part\\?', 'the answer\\?', 'why does this matter\\?']) },
  { id: 'opener', level: 'error', say: 'Sentence opens with a signpost adverb. Start with the subject.',
    re: /(?:^|[.!?:] )(?:Importantly|Notably|Crucially|Essentially|Ultimately|Moreover|Furthermore|Additionally|Interestingly|Remarkably|Surprisingly|Simply put|In short|In other words|Put simply|Fundamentally|Indeed),/g },
  { id: 'emoji', level: 'warn', re: /[\u{1F300}-\u{1FAFF}\u{2728}\u{2705}\u{274C}\u{1F680}]/gu, say: 'Emoji in copy.' },
  { id: 'slogan-heading', level: 'error', where: 'heading', say: 'Heading written as a slogan. Name the element, the call or the task.',
    re: /^(?:One|Two|Three|No|Any|Every|All|Zero)\b[^,.:]{2,30}, (?:one|two|three|no|any|every|all|zero|many)\b[^,]{2,30}$|^[^,.:]{3,30}, (?:reimagined|rethought|redefined|reinvented|made (?:easy|simple)|simplified|unleashed|done right)\.?$|^(?:Meet|Introducing|Say hello to|Welcome to)\b/i },
  { id: 'heading-shout', level: 'error', where: 'heading', re: /!\s*$/, say: 'Heading ends with an exclamation mark.' },
  { id: 'not-x-its-y', level: 'error', say: '"It is not X. It is Y." written for effect. Say what it is.',
    re: /\b(?:This|It|That)(?:'s| is|'s) not (?:a|an|the|just)?[^.?!]{2,50}[.;,] (?:it|this|that)(?:'s| is) /gi },
  // Warnings.
  { id: 'question-heading', level: 'warn', where: 'heading', re: /\?\s*$/, say: 'Heading is a question. Keep it only if the section answers that question.' },
  { id: 'title-case', level: 'warn', where: 'heading', test: titleCase, say: 'Heading in Title Case. Use sentence case.' },
  { id: 'fragment-run', level: 'warn', where: 'prose', re: /(?:^|[.!?] )No [a-z][^.?!,]{1,30}\. No [a-z][^.?!,]{1,30}\./g, say: 'Run of "No X. No Y." fragments. Write one sentence.' },
  { id: 'closing-contrast', level: 'warn', where: 'prose', re: /, not (?:a|an|the|just|only|merely)? ?[a-z][a-z' -]{1,30}\.$/g, say: 'Block ends on ", not X." Check it is a fact the reader needs and not a flourish.' },
  { id: 'we', level: 'warn', where: 'prose', re: /\b(?:[Ww]e|[Oo]ur|[Uu]s)\b(?! (?:as an industry|the browser))/g, say: 'The site is one person\'s. Say "I", or name who "we" is.' },
  { id: 'filler', level: 'warn', where: 'prose', say: 'Filler or hedge. Cut it or say how sure you are once.',
    re: W(['in order to', 'simply', 'basically', 'obviously', 'of course', 'very', 'quite', 'truly', 'incredibly', 'extremely', 'arguably', 'generally speaking', 'it should be noted', 'please note', 'as mentioned(?: above| earlier)?', 'as you can see', 'comprehensive', 'crucial(?:ly)?', 'vital', 'essential(?:ly)?', 'key (?:feature|benefit|difference)s?', 'various', 'numerous', 'a number of', 'ensure[sd]?', 'ensuring', 'landscape', 'realm', 'journey']) },
];

function titleCase(text) {
  const words = text.replace(/CODE/g, '').split(/\s+/).filter((w) => /^[A-Za-z][a-z]+$/.test(w));
  if (words.length < 4) return false;
  const small = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'to', 'for', 'with', 'by', 'at', 'from', 'as', 'is', 'that']);
  const rest = words.slice(1).filter((w) => !small.has(w.toLowerCase()));
  return rest.length >= 3 && rest.filter((w) => /^[A-Z]/.test(w)).length / rest.length > 0.75;
}

if (args.includes('--rules')) {
  for (const r of RULES) console.log(`${r.level.padEnd(5)} ${r.id.padEnd(17)} ${r.say}`);
  process.exit(0);
}

// --- Readers. Each returns blocks: { line, kind: 'heading' | 'prose', text }. ---

const lineOf = (src, i) => src.slice(0, i).split('\n').length;
const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;|&rsquo;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

// A canvas's children are demo content, not copy about the page.
const SKIP = new Set(['script', 'style', 'pre', 'template', 'textarea', 'svg', 'canvas', 'select', 'code', 'kbd', 'samp']);
const BLOCK = new Set(['h1', 'h2', 'h3', 'h4', 'p', 'li', 'td', 'th', 'dt', 'dd', 'figcaption', 'summary', 'blockquote', 'caption', 'label', 'button', 'a', 'div', 'section', 'main', 'ul', 'ol', 'table', 'tr', 'details', 'header', 'footer', 'nav', 'article', 'aside', 'form', 'title']);

function readHtml(src) {
  const blocks = [];
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)\b(?:"[^"]*"|'[^']*'|[^>"'])*>|[^<]+|</g;
  let skip = null, cur = null, inHead = false, m;
  const flush = () => { if (cur && cur.text.trim().length > 2) { cur.text = decode(cur.text).replace(/\s+/g, ' ').trim(); blocks.push(cur); } cur = null; };
  while ((m = re.exec(src))) {
    const tok = m[0], tag = m[1]?.toLowerCase();
    if (skip) { if (tag === skip && tok[1] === '/') { if (cur && (skip === 'code' || skip === 'kbd' || skip === 'samp')) cur.text += 'CODE'; skip = null; } continue; }
    if (tok.startsWith('<!--')) continue;
    if (tag) {
      const close = tok[1] === '/';
      if (tag === 'head') { inHead = !close; continue; }
      if (!close && SKIP.has(tag) && !tok.endsWith('/>')) { skip = tag; continue; }
      if (BLOCK.has(tag)) {
        if (tag === 'a' && cur) continue; // a link inside a block is part of it
        flush();
        if (!close) cur = { line: lineOf(src, m.index), kind: /^h[1-4]$/.test(tag) ? 'heading' : 'prose', text: '' };
        else cur = { line: lineOf(src, m.index), kind: 'prose', text: '' };
      }
      continue;
    }
    if (inHead) continue;
    if (!cur) cur = { line: lineOf(src, m.index), kind: 'prose', text: '' };
    cur.text += tok;
  }
  flush();
  return blocks;
}

function readPageJson(src) {
  const blocks = [];
  let j; try { j = JSON.parse(src); } catch { return blocks; }
  for (const k of ['title', 'blurb', 'question', 'result']) {
    if (typeof j[k] !== 'string' || !j[k]) continue;
    const i = src.indexOf(`"${k}"`);
    const text = decode(j[k].replace(/<code>[\s\S]*?<\/code>/g, 'CODE').replace(/<[^>]+>/g, ''));
    blocks.push({ line: lineOf(src, i), kind: k === 'title' ? 'heading' : 'prose', text });
  }
  return blocks;
}

// Data files: every string literal of 30 characters or more that has a space in it.
function readJsStrings(src) {
  const blocks = [];
  const re = /'((?:[^'\\\n]|\\.){30,})'|"((?:[^"\\\n]|\\.){30,})"|`((?:[^`\\]|\\.){30,})`/g;
  let m;
  while ((m = re.exec(src))) {
    const raw = m[1] ?? m[2] ?? m[3];
    if (!/ /.test(raw) || /[{};=]\s*$|^\s*(?:import|const|let|var) /.test(raw)) continue;
    const text = decode(raw.replace(/\\(['"`])/g, '$1').replace(/<code>[\s\S]*?<\/code>/g, 'CODE').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ');
    blocks.push({ line: lineOf(src, m.index), kind: 'prose', text });
  }
  return blocks;
}

function readMarkdown(src) {
  const blocks = [];
  let fence = false;
  src.split('\n').forEach((raw, i) => {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; return; }
    if (fence || /^\s*$/.test(raw) || /^\s*\|?\s*-{3,}/.test(raw) || /^ {4,}\S/.test(raw) && !/^\s*[-*\d]/.test(raw)) return;
    const h = /^#{1,6}\s+(.*)$/.exec(raw);
    const text = (h ? h[1] : raw).replace(/`[^`]*`/g, 'CODE').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^[\s>*\-+\d.|]+/, '').replace(/[*_]{1,2}/g, '');
    if (text.trim().length > 2) blocks.push({ line: i + 1, kind: h ? 'heading' : 'prose', text: text.trim() });
  });
  return blocks;
}

// --- Files. ---

const files = [];
const pub = path.join(ROOT, 'public');
const GENERATED = new Set(['vendor', 'lib', 'media']);
function walk(dir, depth) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (depth === 0 && GENERATED.has(e.name)) continue;
      if (/^(egui|qt|build|dist|node_modules)$/.test(e.name)) continue;
      if (depth < 2) walk(p, depth + 1);
    } else if (e.name.endsWith('.html')) files.push([p, readHtml]);
    else if (e.name === 'page.json') files.push([p, readPageJson]);
  }
}
walk(pub, 0);
for (const f of ['friction/entries.js', 'crashes/cases.js', 'shared/learn.js', 'elements/ideas.js', 'home.js']) {
  const p = path.join(pub, f);
  if (fs.existsSync(p)) files.push([p, readJsStrings]);
}
if (DOCS) {
  for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.md') && f !== 'ELEMENTS.md') files.push([path.join(ROOT, f), readMarkdown]);
  // Folders inside docs/ are read too (docs/ui-watch/ holds one report per week).
  for (const d of ['docs', 'findings']) for (const f of fs.readdirSync(path.join(ROOT, d), { recursive: true })) if (f.endsWith('.md')) files.push([path.join(ROOT, d, f), readMarkdown]);
}

// docs/writing.md quotes the mannerisms it lists.
const QUOTES_RULES = /docs\/writing\.md$|DESIGN\.md$/;

let errors = 0, warns = 0, shown = 0;
const counts = {};
for (const [file, reader] of files) {
  const rel = path.relative(ROOT, file);
  if (only.length && !only.some((o) => rel.startsWith(`public/${o}/`) || (o === '' && rel === 'public/index.html'))) continue;
  if (QUOTES_RULES.test(rel)) continue;
  const src = fs.readFileSync(file, 'utf8');
  if (src.length > 3e6) continue;
  const lines = src.split('\n');
  for (const b of reader(src)) {
    const allow = `${lines[b.line - 2] || ''}\n${lines[b.line - 1] || ''}`.match(/writing-allow:\s*([\w ,-]+)/)?.[1] || '';
    for (const r of RULES) {
      if (r.where === 'heading' && b.kind !== 'heading') continue;
      if (r.where === 'prose' && b.kind !== 'prose') continue;
      if (allow.includes(r.id)) continue;
      let hit = null;
      if (r.test) { if (r.test(b.text)) hit = b.text; }
      else { r.re.lastIndex = 0; const m = r.re.exec(b.text); if (m) hit = m[0]; }
      if (hit === null) continue;
      if (r.level === 'error') errors++; else warns++;
      counts[r.id] = (counts[r.id] || 0) + 1;
      if (r.level === 'error' || STRICT || only.length) {
        shown++;
        const i = Math.max(0, b.text.indexOf(hit) - 40);
        console.log(`${rel}:${b.line}  ${r.level} ${r.id}  "${hit.trim()}"\n    ${b.text.slice(i, i + 150)}\n    ${r.say}`);
      }
    }
  }
}

const summary = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`\nwriting: ${errors} error${errors === 1 ? '' : 's'}, ${warns} warning${warns === 1 ? '' : 's'}${summary ? ` (${summary})` : ''}.`);
if (warns && !STRICT && !only.length) console.log('Warnings are listed with --strict, or for one page with its path.');
process.exit(errors || (STRICT && warns) ? 1 : 0);
