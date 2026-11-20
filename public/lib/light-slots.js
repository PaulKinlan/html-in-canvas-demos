// light-slots.js: make <slot> work inside a plain, light-DOM <canvas>.
//
//   <canvas content="drawable">
//     <slot name="card"></slot>
//   </canvas>
//   <div slot="card">Reprojected into the canvas</div>
//
// Natively this does nothing: a <slot> only projects content when it is in a
// shadow tree, and it only projects children of that tree's host.
//
// This script upgrades the markup without changing how you write it:
//  1. It attaches a shadow root to the canvas's parent element.
//  2. It moves the canvas into that shadow root (same element, same context,
//     any references you hold stay valid), so its <slot>s become real slots.
//  3. Siblings of the canvas that have a matching slot="name" are assigned to
//     the canvas's slots. All other siblings keep their place through
//     anonymous slots, so the rest of the layout is unchanged.
//
// Limits (these are the platform's, not choices):
//  - Slotted elements must be siblings of the canvas (children of the same
//    parent). Add `slots="document"` to the canvas and elements with a
//    matching slot attribute anywhere in the page are moved next to it first.
//  - Document CSS selectors no longer reach the canvas once it is in a shadow
//    root. Same-origin stylesheet rules are copied in, which keeps simple
//    selectors (`canvas`, `#id`, `.class`) working; descendant selectors that
//    start outside the canvas won't match.
//  - document.querySelector('canvas') won't find it afterwards. Hold a
//    reference, or listen for the `slotsready` event on the parent.

const upgraded = new WeakMap(); // host -> { root, canvases }

function copyDocumentStyles(root) {
  const sheet = new CSSStyleSheet();
  for (const s of document.styleSheets) {
    let rules;
    try { rules = s.cssRules; } catch { continue; } // cross-origin sheet
    for (const rule of rules) {
      try { sheet.insertRule(rule.cssText, sheet.cssRules.length); } catch {}
    }
  }
  root.adoptedStyleSheets = [sheet];
}

// The anonymous slots that carry the host's ordinary children, in order.
const flowSlots = (root) => [...root.children].filter((n) => n.localName === 'slot' && 'flow' in n.dataset);

function assign(host) {
  const state = upgraded.get(host);
  if (!state) return;
  const { root } = state;
  // Named slots that live inside one of our canvases.
  const named = new Map();
  for (const canvas of state.canvases) {
    for (const slot of canvas.querySelectorAll('slot[name]')) {
      if (!named.has(slot.name)) named.set(slot.name, { slot, nodes: [] });
    }
  }
  // Walk the host's children in order. Slotted ones go to their canvas slot;
  // the rest go to the anonymous slot that sits at their original position.
  const anon = flowSlots(root);
  const flow = anon.map(() => []);
  let region = 0;
  const markers = state.markers; // comment nodes left where each canvas was
  for (const node of host.childNodes) {
    const m = markers.indexOf(node);
    if (m !== -1) { region = m + 1; continue; }
    const name = node.nodeType === 1 ? node.getAttribute('slot') : null;
    if (name && named.has(name)) {
      if (!node.hasAttribute('drawable')) node.setAttribute('drawable', '');
      named.get(name).nodes.push(node);
    } else if (node.nodeType === 1 || node.nodeType === 3) {
      flow[region].push(node);
    }
  }
  anon.forEach((slot, i) => slot.assign(...flow[i]));
  for (const { slot, nodes } of named.values()) slot.assign(...nodes);
  for (const canvas of state.canvases) canvas.requestPaint?.();
}

export function upgrade(canvas) {
  const host = canvas.parentElement;
  if (!host || canvas.getRootNode() !== document) return false;

  if (canvas.getAttribute('slots') === 'document') {
    // Opt-in: bring matching elements from anywhere in the page alongside.
    for (const slot of canvas.querySelectorAll('slot[name]')) {
      for (const el of document.querySelectorAll(`[slot="${CSS.escape(slot.name)}"]`)) {
        if (el.parentElement !== host) host.append(el);
      }
    }
  }

  let state = upgraded.get(host);
  if (!state) {
    let root;
    try {
      root = host.attachShadow({ mode: 'open', slotAssignment: 'manual' });
    } catch (err) {
      console.warn('light-slots: cannot attach a shadow root to', host, err);
      return false;
    }
    copyDocumentStyles(root);
    const first = document.createElement('slot');
    first.dataset.flow = '';
    root.append(first);
    state = { root, canvases: [], markers: [] };
    upgraded.set(host, state);
    new MutationObserver(() => assign(host)).observe(host, { childList: true, attributes: true, attributeFilter: ['slot'], subtree: false });
  }

  // Leave a marker where the canvas was so document order is preserved, then
  // move the canvas into the shadow root followed by a slot for what follows.
  const marker = document.createComment('canvas moved to shadow root by light-slots');
  canvas.replaceWith(marker);
  const after = document.createElement('slot');
  after.dataset.flow = '';
  // Insert after the anonymous slot for the marker's region.
  const anon = flowSlots(state.root);
  let region = 0;
  for (const node of host.childNodes) {
    if (node === marker) break;
    if (state.markers.includes(node)) region++;
  }
  // Keep markers in document order.
  state.markers.splice(region, 0, marker);
  anon[region].after(canvas, after);
  state.canvases.push(canvas);
  assign(host);
  host.dispatchEvent(new CustomEvent('slotsready', { detail: { canvas }, bubbles: true }));
  return true;
}

export function upgradeAll(scope = document) {
  const done = [];
  for (const canvas of scope.querySelectorAll('canvas:has(slot)')) {
    if (upgrade(canvas)) done.push(canvas);
  }
  return done;
}

// Auto-upgrade unless imported with ?manual.
if (!new URL(import.meta.url).searchParams.has('manual')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => upgradeAll());
  else upgradeAll();
}
