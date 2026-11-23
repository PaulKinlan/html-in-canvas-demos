// The text of one feed item, taken from what a page already says about itself.
// tools/feed/site-build.mjs calls these during `npm run build`.
//
//   pageSections(html)        the lede and the "How it works" and "Findings" sections of a page
//   clean(html, base)         that HTML cut down to the tags a feed reader shows
//   findingsFor(href, files)  the parts of the findings/ files that are about one page
//   markdown(text, base)      a findings file as HTML: headings, tables, lists, code, links
//
// There is no HTML parser here and no dependency. The pages are this site's
// own, so a tag scanner with a list of allowed tags is enough, and a tag it
// does not know is dropped with its text kept.

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

// Tags kept as they are. Everything else loses its tag and keeps its text,
// except the tags in DROP, which lose their content too.
const KEEP = new Set(['p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'code', 'pre', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h3', 'h4', 'blockquote', 'br', 'kbd', 'dl', 'dt', 'dd', 'sub', 'sup', 'abbr', 'q', 'cite', 'var', 'small', 'mark', 'figcaption']);
const DROP = new Set(['script', 'style', 'canvas', 'button', 'select', 'textarea', 'template', 'iframe', 'video', 'audio', 'svg', 'object', 'form', 'label', 'input', 'img', 'picture', 'nav', 'dialog', 'output', 'progress', 'meter', 'datalist']);
const VOID = new Set(['br', 'input', 'img', 'hr', 'meta', 'link', 'source', 'track', 'wbr', 'col', 'area', 'embed']);
const BLOCK = new Set(['p', 'ul', 'ol', 'li', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h3', 'h4', 'blockquote', 'dl', 'dt', 'dd']);

const absolute = (href, base) => { try { return new URL(href, base).href; } catch { return null; } };

/**
 * Cut HTML down to the allowed tags. Links are made absolute against `base`.
 * Closing tags with no opener are dropped and open tags are closed at the end,
 * so a section that was cut out of the middle of a wrapper still nests.
 */
export function clean(html, base) {
  let out = '';
  const open = [];
  let skip = null; // { tag, depth } while inside a dropped element
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g;
  for (const m of html.matchAll(re)) {
    const [all, slash, rawTag, attrs] = m;
    if (rawTag === undefined) {
      // Text (already HTML-escaped in the source), a comment, or a stray "<".
      if (!skip && !all.startsWith('<!--')) out += all === '<' ? '&lt;' : all;
      continue;
    }
    const tag = rawTag.toLowerCase();
    if (skip) {
      if (tag === skip.tag) { if (slash) { if (--skip.depth === 0) skip = null; } else if (!VOID.has(tag)) skip.depth++; }
      continue;
    }
    const showCode = tag === 'details' && /class=["'][^"']*show-code/.test(attrs);
    if (!slash && (DROP.has(tag) || showCode || /\bhidden\b(?!=)/.test(attrs.replace(/"[^"]*"|'[^']*'/g, '')))) {
      if (!VOID.has(tag) && !attrs.trimEnd().endsWith('/')) skip = { tag, depth: 1 };
      continue;
    }
    if (tag === 'summary') { out += slash ? '</strong> ' : '<strong>'; continue; }
    if (!KEEP.has(tag)) { if (/^(div|section|details|figure|article|h2|h5|h6)$/.test(tag)) out += ' '; continue; }
    if (slash) {
      const at = open.lastIndexOf(tag);
      if (at === -1) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    if (tag === 'br') { out += '<br>'; continue; }
    let kept = '';
    if (tag === 'a') {
      const href = /\bhref=(?:"([^"]*)"|'([^']*)')/.exec(attrs);
      const url = href && absolute((href[1] ?? href[2]).replace(/&amp;/g, '&'), base);
      if (url && /^https?:/.test(url)) kept = ` href="${escAttr(url)}"`;
    } else if (tag === 'td' || tag === 'th') {
      for (const a of attrs.matchAll(/\b(colspan|rowspan)=["']?(\d+)/g)) kept += ` ${a[1]}="${a[2]}"`;
    }
    out += `<${tag}${kept}>`;
    open.push(tag);
  }
  while (open.length) out += `</${open.pop()}>`;
  // Elements that a script fills in on the page are empty here.
  let before;
  do { before = out; out = out.replace(/<(p|ul|ol|li|table|thead|tbody|tr|strong|em|code|pre|blockquote|dl|a|small|h3|h4)(?: [^>]*)?>\s*<\/\1>/g, ''); } while (out !== before);
  return out.replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** The parts of a page that explain it: { lede, sections: [{ title, html }] }. Raw HTML, not cleaned. */
export function pageSections(html) {
  const main = /<main[^>]*>([\s\S]*)<\/main>/i.exec(html)?.[1] ?? html;
  const lede = /<p\s[^>]*class=["'][^"']*\blede\b[^"']*["'][^>]*>[\s\S]*?<\/p>/i.exec(main)?.[0] ?? '';
  const sections = [];
  const heads = [...main.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
  heads.forEach((h, i) => {
    const title = h[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    if (!/^(How it works|Findings)$/i.test(title)) return;
    sections.push({ title, html: main.slice(h.index + h[0].length, heads[i + 1]?.index ?? main.length) });
  });
  return { lede, sections };
}

function inline(text, base) {
  const code = [];
  let s = text.replace(/(`+)(.+?)\1/g, (m, t, body) => { code.push(`<code>${esc(body.trim())}</code>`); return `\u0000${code.length - 1}\u0000`; });
  s = esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, href) => { const url = absolute(href.replace(/&amp;/g, '&'), base); return url && /^https?:/.test(url) ? `<a href="${escAttr(url)}">${label}</a>` : label; })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => code[+i]);
}

// A table row split at the bars that are not inside code or escaped.
function cells(line) {
  const out = [];
  let cur = '', tick = false;
  const body = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\' && body[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') tick = !tick;
    if (c === '|' && !tick) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** The Markdown the findings files use, as HTML. `##` becomes h3 and deeper headings h4. */
export function markdown(text, base) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const isRow = (l) => /^\s*\|/.test(l);
  const isItem = (l) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(l);
  for (let i = 0; i < lines.length;) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = /^\s*(```+|~~~+)/.exec(line);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      i++;
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const head = /^(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (head) { out.push(`<${head[1].length <= 2 ? 'h3' : 'h4'}>${inline(head[2], base)}</${head[1].length <= 2 ? 'h3' : 'h4'}>`); i++; continue; }
    if (isRow(line) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      const th = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && isRow(lines[i]); i++) rows.push(cells(lines[i]));
      out.push(`<table><thead><tr>${th.map((c) => `<th>${inline(c, base)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, base)}</td>`).join('')}</tr>`).join('\n')}</tbody></table>`);
      continue;
    }
    if (isItem(line)) {
      const ordered = /^\s*\d/.test(line);
      const items = [];
      for (; i < lines.length && (isItem(lines[i]) || (/^\s+\S/.test(lines[i]) && items.length)); i++) {
        if (isItem(lines[i])) items.push(lines[i].replace(/^\s*(?:[-*+]|\d+[.)])\s+/, ''));
        else items[items.length - 1] += ' ' + lines[i].trim();
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t, base)}</li>`).join('\n')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !isRow(lines[i]) && !isItem(lines[i]) && !/^(#{1,6}\s|\s*```|\s*~~~)/.test(lines[i]); i++) para.push(lines[i].trim());
    // A line that starts like a table row or a list and is neither: take it as text.
    if (!para.length) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '), base)}</p>`);
  }
  return out.join('\n');
}

/**
 * The Markdown in findings/ that is about one page.
 * `files` is [{ name, text }]. A file holds one page or a strand of several,
 * and a strand has a `##` section for each page with the page's path in the heading.
 * Returns [{ name, text }] with only the parts for `href`.
 */
export function findingsFor(href, files, known) {
  const own = href.replace(/^\/|\/$/g, '').replace(/\.html$/, '');
  const named = (heading) => [...heading.matchAll(/\/[a-z0-9][a-z0-9-]*\/(?:[a-z0-9-]+\.html)?/g)].map((m) => m[0]).filter((p) => known.has(p));
  const found = [];
  for (const f of files) {
    const parts = f.text.split(/^(?=## )/m);
    const preamble = parts[0].startsWith('## ') ? '' : parts.shift();
    const isOwn = f.name === `${own}.md`;
    const keep = parts.filter((s) => {
      const pages = named(s.slice(0, s.indexOf('\n') === -1 ? s.length : s.indexOf('\n')));
      // A section that names no page is about the whole file, so it goes with the file's own page.
      return pages.includes(href) || (isOwn && !pages.length);
    });
    if (!keep.length && !isOwn) continue;
    // The "For the index" lists and the like are notes for the documentation pass, not results.
    const body = keep.filter((s) => !/^## (For the index|Chromium bugs|API requests)\b/i.test(s));
    const intro = isOwn ? preamble.replace(/^# .*$/m, '').trim() : '';
    const text = [intro, ...body].filter(Boolean).join('\n\n').trim();
    if (text) found.push({ name: f.name, text });
  }
  return found;
}
