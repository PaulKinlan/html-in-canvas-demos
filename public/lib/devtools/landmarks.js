// Landmark map: which elements under a root are landmark regions, what each is
// called, and a tint and a label for each, drawn over the picture.
import { plate, hatch } from './stage.js';

// #region roles
const LANDMARK_ROLES = new Set(['banner', 'complementary', 'contentinfo', 'form', 'main', 'navigation', 'region', 'search']);
const SECTIONING = 'article, aside, main, nav, section';
/** The nearest ancestor of `el` below `root` that matches, or null. With no root, every ancestor is looked at. */
function ancestor(el, root, selector) {
  for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (p.matches(selector)) return p;
  return null;
}

/** The accessible name from aria-labelledby, aria-label or title. Landmarks do not take a name from their content. */
export function landmarkName(el) {
  const ids = el.getAttribute('aria-labelledby');
  if (ids) {
    const text = ids.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent.trim() ?? '').filter(Boolean).join(' ');
    if (text) return text;
  }
  return (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
}

/**
 * The landmark role of an element, or null. These are the rules of the HTML
 * accessibility mapping as Chromium 157 applies them (compared with its
 * accessibility tree by tools/devtools-pages/verify.mjs):
 *   main, nav, search, aside and form always map to a landmark role;
 *   header and footer only when no article, aside, main, nav or section is an ancestor;
 *   section only when it has a name.
 * `scope` limits the ancestors that count. With no scope the whole document
 * counts, which is what the browser does. Pass the drawn root to treat it as
 * a page of its own.
 */
export function landmarkRole(el, scope = null) {
  const explicit = (el.getAttribute('role') || '').trim().split(/\s+/)[0];
  if (explicit) {
    if (!LANDMARK_ROLES.has(explicit)) return null;
    return explicit === 'region' && !landmarkName(el) ? null : explicit;
  }
  switch (el.localName) {
    case 'main': return 'main';
    case 'nav': return 'navigation';
    case 'search': return 'search';
    case 'aside': return 'complementary';
    case 'header': return ancestor(el, scope, SECTIONING) ? null : 'banner';
    case 'footer': return ancestor(el, scope, SECTIONING) ? null : 'contentinfo';
    case 'section': return landmarkName(el) ? 'region' : null;
    case 'form': return 'form'; // Chromium gives a form this role with or without a name
  }
  return null;
}

/**
 * Every landmark under `root` in tree order, and the elements that look like
 * landmarks and are not (`role: null`, with the reason).
 */
export function findLandmarks(root, { scope = null } = {}) {
  const found = [], lookalikes = [];
  for (const el of root.querySelectorAll('*')) {
    if (!el.checkVisibility() || el.matches('[aria-hidden="true"], [inert]') || ancestor(el, root, '[aria-hidden="true"], [inert]')) continue;
    const role = landmarkRole(el, scope);
    if (role) {
      let depth = 0;
      for (let p = el.parentElement; p && p !== root; p = p.parentElement) if (landmarkRole(p, scope)) depth++;
      found.push({ el, role, name: landmarkName(el), from: el.hasAttribute('role') ? `role="${role}"` : `<${el.localName}>`, depth });
    } else if (/^(header|footer|section)$/.test(el.localName) && !el.hasAttribute('role')) {
      const why = el.localName === 'section' ? 'no name' : `inside <${ancestor(el, scope, SECTIONING).localName}>`;
      lookalikes.push({ el, role: null, why });
    }
  }
  return { found, lookalikes };
}
// #endregion roles

// #region problems
/** What a screen reader user would trip over in the list of landmarks. */
export function landmarkProblems(root, found) {
  const problems = [];
  const by = Map.groupBy(found, (l) => l.role);
  for (const role of ['main', 'banner', 'contentinfo']) {
    const list = by.get(role) ?? [];
    if (list.length > 1) problems.push({ text: `${list.length} ${role} landmarks. There should be one.`, els: list.map((l) => l.el) });
  }
  if (!by.has('main')) problems.push({ text: 'No main landmark.', els: [] });
  const bareForms = (by.get('form') ?? []).filter((l) => !l.name);
  if (bareForms.length) problems.push({ text: `${bareForms.length} form ${bareForms.length === 1 ? 'landmark has' : 'landmarks have'} no name.`, els: bareForms.map((l) => l.el) });
  for (const [role, list] of by) {
    if (list.length < 2 || role === 'main' || role === 'banner' || role === 'contentinfo' || role === 'form') continue;
    const names = Map.groupBy(list, (l) => l.name.toLowerCase());
    for (const [name, same] of names) {
      if (same.length > 1) problems.push({ text: `${same.length} ${role} landmarks ${name ? `are all called "${same[0].name}"` : 'have no name'}. A list of landmarks cannot tell them apart.`, els: same.map((l) => l.el) });
    }
  }
  // Text that is in no landmark. Report the nearest element around each such text node, once.
  const landmarkEls = new Set(found.map((l) => l.el));
  const outside = new Set();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.data.trim() || !node.parentElement.checkVisibility()) continue;
    let inside = false;
    for (let p = node.parentElement; p && p !== root; p = p.parentElement) if (landmarkEls.has(p)) { inside = true; break; }
    if (inside) continue;
    // The outermost ancestor below the root.
    let top = node.parentElement;
    while (top.parentElement && top.parentElement !== root) top = top.parentElement;
    if (top !== root) outside.add(top);
  }
  if (outside.size) problems.push({ text: `${outside.size} ${outside.size === 1 ? 'part of the page is' : 'parts of the page are'} in no landmark.`, els: [...outside], outside: true });
  return problems;
}
// #endregion problems

// #region draw-landmarks
export const ROLE_COLOURS = { banner: '#2f6bff', navigation: '#12b76a', main: '#f59f1a', complementary: '#b25cff', contentinfo: '#00b8d9', search: '#e0457b', form: '#c98a00', region: '#7d8bb0' };

/**
 * Draw the map. The context carries the transform the root was drawn with and
 * `rectOf(el)` returns an element's layout rectangle in the root's own px (see
 * atIdentity() in layout-boxes.js). `scale` is the size of one root px on the
 * canvas, used to keep labels and lines the same size at any zoom.
 */
export function drawLandmarks(ctx, { found, lookalikes }, problems, rectOf, { selected = null, scale = 1, showLookalikes = true } = {}) {
  const u = 1 / scale; // one CSS px of the canvas, in root px
  ctx.save();
  if (showLookalikes) {
    for (const l of lookalikes) {
      const r = rectOf(l.el);
      if (!r) continue;
      ctx.setLineDash([4 * u, 3 * u]);
      ctx.strokeStyle = '#59606e';
      ctx.lineWidth = 1.25 * u;
      ctx.strokeRect(r.x, r.y, r.width, r.height);
      ctx.setLineDash([]);
    }
  }
  for (const p of problems) {
    for (const el of p.els) {
      const r = rectOf(el);
      if (!r) continue;
      if (p.outside) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y, r.width, r.height);
        ctx.clip();
        hatch(ctx, r, '#e5484d', 7 * u);
        ctx.restore();
      }
      ctx.strokeStyle = '#e5484d';
      ctx.lineWidth = 3 * u;
      ctx.strokeRect(r.x - 2 * u, r.y - 2 * u, r.width + 4 * u, r.height + 4 * u);
    }
  }
  for (const l of found) {
    const r = rectOf(l.el);
    if (!r) continue;
    const colour = ROLE_COLOURS[l.role] ?? '#888', dim = selected && l.el !== selected;
    const inset = 0; // nested landmarks keep their own box; the tints add up
    ctx.globalAlpha = dim ? 0.08 : l.el === selected ? 0.42 : 0.24;
    ctx.fillStyle = colour;
    ctx.fillRect(r.x + inset, r.y + inset, r.width - inset * 2, r.height - inset * 2);
    ctx.globalAlpha = dim ? 0.35 : 1;
    ctx.strokeStyle = colour;
    ctx.lineWidth = (l.el === selected ? 3 : 2) * u;
    ctx.strokeRect(r.x + u, r.y + u, r.width - 2 * u, r.height - 2 * u);
  }
  ctx.globalAlpha = 1;
  // Labels last, so that no tint covers one. They are drawn at the top right corner, in canvas px.
  for (const l of found) {
    const r = rectOf(l.el);
    if (!r) continue;
    const text = l.name ? `${l.role} "${l.name}"` : l.role;
    ctx.save();
    ctx.translate(r.x + r.width, r.y);
    ctx.scale(u, u);
    ctx.font = '600 11px ui-monospace, Menlo, Consolas, monospace';
    const w = Math.ceil(ctx.measureText(text).width) + 10;
    plate(ctx, text, Math.max(-w - 2, -r.width * scale), 2, { fill: ROLE_COLOURS[l.role] ?? '#888', color: '#10131f' });
    ctx.restore();
  }
  ctx.restore();
}
// #endregion draw-landmarks
