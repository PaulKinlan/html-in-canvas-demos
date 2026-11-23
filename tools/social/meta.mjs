// The tags a shared link and a search engine read, made from a page's page.json:
// description, canonical URL, the feed's address, Open Graph, Twitter card and schema.org JSON-LD.
// tools/social/site-build.mjs writes them into each page during `npm run build`.
import path from 'node:path';

export const SITE = {
  origin: 'https://html-in-canvas.page',
  host: 'html-in-canvas.page',
  name: 'HTML-in-canvas experiments',
  description: 'Experiments with the HTML-in-canvas API in Chrome: drawElementImage(), texElementSubImage2D() and drawElementImageToTexture() draw live, interactive HTML elements into 2D, WebGL and WebGPU canvases. Each page states a question, runs checks in your browser and lists its findings.',
  language: 'en',
  repo: 'https://github.com/PaulKinlan/html-in-canvas-demos',
  author: { name: 'Paul Kinlan', url: 'https://paul.kinlan.me/', twitter: '@Paul_Kinlan', sameAs: ['https://github.com/PaulKinlan'] },
  image: { width: 1200, height: 630, type: 'image/jpeg' },
  // The RSS feed that tools/feed/site-build.mjs writes. Every page names it in a <link rel="alternate">.
  feed: { path: '/feed.xml', title: 'HTML-in-canvas experiments: new pages' },
};

export const START = '<!-- social:start';
export const END = '<!-- social:end -->';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·', times: '×', rarr: '→', larr: '←', hellip: '…', ndash: '–', mdash: '—' };
// page.json text may hold HTML (<code>, entities). The tags hold plain text.
export function plainText(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, (tag) => (/^<\/?[a-z!]/i.test(tag) && /^<\/?(code|a|b|i|em|strong|span|br|kbd|abbr|sub|sup|q|cite|var|small|mark)\b/i.test(tag) ? '' : tag))
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1));
      return ENTITIES[e] ?? m;
    })
    .replace(/\s+/g, ' ').trim();
}

// Whole sentences up to about `max` characters.
export function shorten(text, max = 200) {
  if (text.length <= max) return text;
  const parts = text.match(/[^.!?]+[.!?]+(?=\s|$)|[^.!?]+$/g) ?? [text];
  let out = '';
  for (const p of parts) {
    if (out && (out + p).length > max) break;
    out += p;
  }
  out = out.trim();
  // A short first sentence before a long second one: cut the second at a word.
  if (out.length < 90) out = text.slice(0, max).replace(/[\s,;:]+\S*$/, '') + '…';
  if (out.length > max + 60) out = out.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return out;
}

export const attr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Where a page's picture is kept, relative to public/.
export function imageFileFor(href) {
  if (href === '/') return 'social.jpg';
  if (href.endsWith('/')) return path.posix.join(href.slice(1), 'social.jpg');
  return href.slice(1).replace(/\.html$/, '') + '.social.jpg';
}

// `page` is an entry from readPages(). `hasImage` says whether its own picture exists.
// `ownDescription` is true when the page already has a hand-written <meta name="description">.
export function describe(page, { hasImage = false, ownDescription = false } = {}) {
  const home = page.href === '/';
  // The Worker's asset handling ("auto-trailing-slash") redirects /a/b.html to /a/b, so that is the address.
  const url = SITE.origin + page.href.replace(/\.html$/, '');
  const title = home ? SITE.name : plainText(page.title || page.href);
  const full = home ? SITE.description : plainText(page.blurb || page.question || SITE.description);
  const description = shorten(full);
  const question = plainText(page.question || '');
  const image = `${SITE.origin}/${hasImage ? imageFileFor(page.href) : 'social.jpg'}`;
  const alt = home
    ? `${SITE.name}: the site's home page, and its name on a dark band`
    : `The page "${title}" on ${SITE.name}, with its title on a dark band`;
  const author = { '@type': 'Person', '@id': `${SITE.origin}/#author`, name: SITE.author.name, url: SITE.author.url, sameAs: SITE.author.sameAs };
  const website = { '@type': 'WebSite', '@id': `${SITE.origin}/#website`, url: `${SITE.origin}/`, name: SITE.name, description: SITE.description, inLanguage: SITE.language, author: { '@id': author['@id'] } };
  const imageObject = { '@type': 'ImageObject', url: image, width: SITE.image.width, height: SITE.image.height };

  const graph = [];
  if (home) {
    graph.push(website, author, {
      '@type': 'CollectionPage', '@id': url, url, name: title, description: full, inLanguage: SITE.language,
      isPartOf: { '@id': website['@id'] }, author: { '@id': author['@id'] }, primaryImageOfPage: imageObject,
    });
  } else {
    const article = {
      '@type': 'TechArticle', '@id': url, url, mainEntityOfPage: url,
      headline: title.slice(0, 110), name: title, description: full,
      ...(question ? { abstract: question } : {}),
      image: imageObject, inLanguage: SITE.language,
      ...(page.added ? { datePublished: page.added } : {}),
      ...(page.tags?.length || page.api?.length ? { keywords: [...new Set([...(page.tags ?? []), ...(page.api ?? [])].map(plainText))].join(', ') } : {}),
      ...(page.kind === 'tutorial' ? { learningResourceType: 'tutorial' } : {}),
      about: { '@type': 'Thing', name: 'HTML-in-canvas API', url: 'https://developer.chrome.com/docs/web-platform/html-in-canvas/concepts' },
      author, publisher: { '@id': author['@id'] },
      isPartOf: { '@type': 'WebSite', '@id': website['@id'], url: website.url, name: SITE.name },
      codeRepository: undefined,
    };
    delete article.codeRepository;
    graph.push(article, {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: SITE.name, item: `${SITE.origin}/` },
        { '@type': 'ListItem', position: 2, name: title, item: url },
      ],
    });
  }
  // One value per line: tools/gfx/check.mjs skips a file that has a line over 2,000 characters.
  // It also reads every <script> as code, so "(", "'" and "`" are written as \u escapes: an API
  // name in the text, such as getImageData(), is then not taken for a call.
  const jsonld = '\n' + JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 1).replace(/</g, '\\u003c').replace(/[('`]/g, (c) => '\\u00' + c.charCodeAt(0).toString(16)) + '\n';

  const lines = [
    `${START} (written by \`npm run build\` from page.json, see tools/social/; do not edit) -->`,
    ownDescription ? null : `<meta name="description" content="${attr(description)}">`,
    `<link rel="canonical" href="${attr(url)}">`,
    `<link rel="alternate" type="application/rss+xml" title="${attr(SITE.feed.title)}" href="${SITE.origin}${SITE.feed.path}">`,
    `<meta name="author" content="${attr(SITE.author.name)}">`,
    `<meta property="og:type" content="${home ? 'website' : 'article'}">`,
    `<meta property="og:site_name" content="${attr(SITE.name)}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:title" content="${attr(title)}">`,
    `<meta property="og:description" content="${attr(description)}">`,
    `<meta property="og:url" content="${attr(url)}">`,
    `<meta property="og:image" content="${attr(image)}">`,
    `<meta property="og:image:type" content="${SITE.image.type}">`,
    `<meta property="og:image:width" content="${SITE.image.width}">`,
    `<meta property="og:image:height" content="${SITE.image.height}">`,
    `<meta property="og:image:alt" content="${attr(alt)}">`,
    home ? null : `<meta property="article:author" content="${attr(SITE.author.url)}">`,
    !home && page.added ? `<meta property="article:published_time" content="${page.added}">` : null,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:creator" content="${SITE.author.twitter}">`,
    `<meta name="twitter:title" content="${attr(title)}">`,
    `<meta name="twitter:description" content="${attr(description)}">`,
    `<meta name="twitter:image" content="${attr(image)}">`,
    `<meta name="twitter:image:alt" content="${attr(alt)}">`,
    `<script type="application/ld+json">${jsonld}</script>`,
    END,
  ].filter(Boolean);
  return { url, title, description, image, block: lines.join('\n') };
}

// Returns the HTML with the block written after <title>, replacing an earlier block.
export function inject(html, block) {
  const nl = html.includes('\r\n') ? '\r\n' : '\n';
  block = block.replace(/\n/g, nl);
  const a = html.indexOf(START);
  if (a !== -1) {
    const b = html.indexOf(END, a);
    if (b === -1) throw new Error('a social:start comment has no social:end');
    return html.slice(0, a) + block + html.slice(b + END.length);
  }
  const head = html.search(/<\/head>/i);
  const scope = head === -1 ? html : html.slice(0, head);
  const m = /<\/title>[^\S\r\n]*(\r?\n)?/i.exec(scope) ?? /<meta\s+charset[^>]*>[^\S\r\n]*(\r?\n)?/i.exec(scope) ?? /<head[^>]*>[^\S\r\n]*(\r?\n)?/i.exec(scope);
  if (!m) throw new Error('no <title>, <meta charset> or <head> to write the tags after');
  const at = m.index + m[0].length;
  return html.slice(0, at) + (m[1] ? '' : nl) + block + nl + html.slice(at);
}

// True when the page has its own description outside the generated block.
export function hasOwnDescription(html) {
  const a = html.indexOf(START), b = a === -1 ? -1 : html.indexOf(END, a);
  const rest = a === -1 || b === -1 ? html : html.slice(0, a) + html.slice(b + END.length);
  return /<meta\s+name=["']description["']/i.test(rest);
}
