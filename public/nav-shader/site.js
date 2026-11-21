// A small site whose navigations are drawn by a shader.
//
//   const site = mountSite(liveTransitionElement, { effect: () => 'ink', onlog });
//
// The element is <live-transition>: each child is one view, both views of a
// transition are live DOM in one canvas, and a fragment shader blends them.
// This file adds the navigation half. Every same-page navigation (a link, a
// GET form, Back and Forward) is intercepted with the Navigation API. The new
// view is fetched before the URL changes, and the shader starts from the box
// of the element that was clicked.

import { LiveTransition } from '/lib/live-transition.js';

export const VIEWS = ['home', 'tides', 'knots', 'lights'];
export const support = {
  navigation: 'navigation' in globalThis,
  precommit: 'NavigationPrecommitController' in globalThis,
  addHandler: 'NavigationPrecommitController' in globalThis && 'addHandler' in NavigationPrecommitController.prototype,
  sourceElement: 'NavigateEvent' in globalThis && 'sourceElement' in NavigateEvent.prototype,
};

// #region shader
// "ink": the new view spreads from the origin with a ragged edge. The old view
// is pushed outward just ahead of the edge, and the edge glows. The same
// function in GLSL (WebGL) and WGSL (WebGPU). `origin` is the clicked link.
LiveTransition.shaders.ink = {
  glsl: `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 transition(vec2 uv) {
  vec2 d = uv - origin; d.x *= ratio;
  float dist = length(d);
  float rag = (vnoise(vec2(uv.x * ratio, uv.y) * 9.0) - 0.5) * 0.24 * (1.0 - progress);
  float front = progress * 2.1 - 0.14 + rag;
  float inside = 1.0 - smoothstep(front - 0.015, front + 0.015, dist);
  float band = exp(-pow((dist - front) / 0.06, 2.0)) * (1.0 - progress);
  vec2 push = normalize(d + 1e-5) * band * 0.04; push.x /= ratio;
  vec4 c = mix(getFromColor(uv - push), getToColor(uv + push * 0.5), inside);
  c.rgb += band * vec3(1.0, 0.55, 0.18) * 0.7;
  return c;
}`,
  wgsl: `
fn h21(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453); }
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p); var f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2f(1.0, 0.0)), f.x), mix(h21(i + vec2f(0.0, 1.0)), h21(i + vec2f(1.0, 1.0)), f.x), f.y);
}
fn transition(uv: vec2f) -> vec4f {
  var d = uv - t.origin; d.x *= t.ratio;
  let dist = length(d);
  let rag = (vnoise(vec2f(uv.x * t.ratio, uv.y) * 9.0) - 0.5) * 0.24 * (1.0 - t.progress);
  let front = t.progress * 2.1 - 0.14 + rag;
  let inside = 1.0 - smoothstep(front - 0.015, front + 0.015, dist);
  let band = exp(-pow((dist - front) / 0.06, 2.0)) * (1.0 - t.progress);
  var push = normalize(d + 1e-5) * band * 0.04; push.x /= t.ratio;
  let c = mix(getFromColor(uv - push), getToColor(uv + push * 0.5), inside);
  return vec4f(c.rgb + band * vec3f(1.0, 0.55, 0.18) * 0.7, c.a);
}`,
  // Which view a click reaches part way through: the new one inside the edge.
  pick: (x, y, p, { H, origin }) => Math.hypot(x - origin.x, y - origin.y) / H < p * 2.1 - 0.14,
};
// #endregion shader

export function mountSite(site, { effect = () => 'ink', duration = () => 900, onlog = () => {}, path = location.pathname } = {}) {
  const views = new Map([...site.children].map((el) => [el.dataset.view, el]));
  const t0 = performance.now();
  const log = (text) => onlog(`${((performance.now() - t0) / 1000).toFixed(2)} s  ${text}`);
  const nameOf = (url) => new URL(url, location.href).searchParams.get('view') || 'home';
  const state = { runs: 0, last: null };

  // #region load
  // A view is a fragment of HTML in its own file. It is fetched once and then
  // kept as a child of the element, so what was typed into it is still there
  // when the reader comes back.
  async function load(name) {
    if (views.has(name)) return views.get(name);
    const res = await fetch(`/nav-shader/views/${name}.html`);
    if (!res.ok) throw new Error(`${res.status} for the "${name}" view`);
    const el = new DOMParser().parseFromString(await res.text(), 'text/html').body.firstElementChild;
    views.set(name, el);
    site.append(el); // a new child is a new state: it gets its own texture
    wire(el);
    return el;
  }
  // #endregion load

  // Centre of the element that started the navigation, in the site's own pixels.
  function originOf(source) {
    if (!source || !site.contains(source)) return undefined;
    const a = source.getBoundingClientRect(), b = site.getBoundingClientRect();
    return { x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top };
  }

  async function show(name, origin) {
    const el = views.get(name);
    state.last = { name, origin, effect: effect(), from: site.states[site.current]?.dataset.view };
    await site.show(el, { effect: effect(), duration: duration(), origin });
    state.runs++;
    site.dispatchEvent(new CustomEvent('siteview', { detail: state.last }));
  }

  // #region navigate
  // One listener for every navigation in this document.
  function onNavigate(e) {
    if (!e.canIntercept || e.hashChange || e.downloadRequest !== null || e.formData) return;
    const url = new URL(e.destination.url);
    const name = nameOf(url);
    if (url.pathname !== path || !VIEWS.includes(name)) return;
    const source = support.sourceElement ? e.sourceElement : null;
    const origin = originOf(source);
    log(`navigate: ${e.navigationType} to "${name}", started by ${source ? `<${source.localName}> "${source.textContent.trim().slice(0, 24)}"` : 'no element'}`);

    // After the URL has changed: run the shader between the two views.
    let queued = false;
    const draw = async () => {
      log(`committed: the URL is ${location.pathname}${location.search}`);
      await load(name);
      await show(name, origin);
      log(`transition finished (${state.last.effect})`);
    };

    if (support.precommit && e.cancelable) {
      e.intercept({
        scroll: 'manual',
        focusReset: 'manual',
        // Before the URL changes: fetch the new view. The old URL and the old
        // view stay in place while this promise is pending.
        async precommitHandler(controller) {
          const before = location.search || '(none)';
          const start = performance.now();
          await load(name);
          log(`precommit: view loaded in ${Math.round(performance.now() - start)} ms while the query was still ${before}`);
          // Chrome 146: the post-commit step can be added from here.
          if (controller.addHandler) { controller.addHandler(draw); queued = true; }
        },
        async handler() { if (!queued) await draw(); },
      });
    } else {
      // No precommit handler (or a traversal that cannot be deferred): the URL
      // changes first and the view is fetched after.
      e.intercept({ scroll: 'manual', focusReset: 'manual', handler: draw });
    }
  }
  // #endregion navigate

  // #region fallback
  // Without the Navigation API: catch clicks on links, use history.pushState.
  function onClick(e) {
    const a = e.target.closest?.('a[href]');
    if (!a || !site.contains(a) || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey) return;
    const url = new URL(a.href);
    if (url.pathname !== path || !VIEWS.includes(nameOf(url))) return;
    e.preventDefault();
    const origin = originOf(a);
    log(`click: to "${nameOf(url)}" (no Navigation API, history.pushState)`);
    load(nameOf(url)).then(() => { history.pushState(null, '', url); return show(nameOf(url), origin); });
  }
  const onPop = () => load(nameOf(location.href)).then(() => show(nameOf(location.href)));
  // #endregion fallback

  if (support.navigation) navigation.addEventListener('navigate', onNavigate);
  else { site.addEventListener('click', onClick); addEventListener('popstate', onPop); }

  // What the views do on their own, to show that both are live in a transition.
  function wire(el) {
    const opened = performance.now();
    const out = el.querySelector('[data-open]');
    if (out) setInterval(() => { if (el.isConnected) out.value = Math.floor((performance.now() - opened) / 1000); }, 1000);
    const count = el.querySelector('[data-count]');
    if (count) { let n = 0; count.onclick = () => (count.textContent = `Tied ${++n} times`); }
  }
  for (const el of views.values()) wire(el);

  return {
    views, state, load, show, nameOf, originOf,
    /** Show the view the URL names, with no transition (used once, on load). */
    async start() {
      const name = nameOf(location.href);
      if (name === 'home' || !VIEWS.includes(name)) return;
      const el = await load(name);
      site.prepend(el); // the first child is the state shown at the start
    },
    destroy() {
      if (support.navigation) navigation.removeEventListener('navigate', onNavigate);
      else { site.removeEventListener('click', onClick); removeEventListener('popstate', onPop); }
    },
  };
}
