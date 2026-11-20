// Shared top menu. Add to any page with one tag, straight after <body>:
//   <script src="/shared/nav.js"></script>
// The list of demos lives in /shared/demos.js.
//
// Plain script (not a module) with its own styles, so it works on every page
// and in every browser regardless of what else the page loads or whether the
// page's own scripts fail.
(function () {
  if (window.__siteNav) return;
  window.__siteNav = true;
  var base = (document.currentScript && document.currentScript.src) ? new URL('.', document.currentScript.src).href : '/shared/';

  var css = '\
#site-nav{position:sticky;top:0;z-index:2147483000;font:14px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1c1a;background:rgba(246,244,239,.92);-webkit-backdrop-filter:blur(10px);backdrop-filter:blur(10px);border-bottom:1px solid #ddd8cf;}\
#site-nav *{box-sizing:border-box}\
html.page-loading body>:not(#site-nav){opacity:0}\
#site-nav .bar{display:flex;align-items:center;gap:6px;max-width:1100px;margin:0 auto;padding:4px 12px;height:48px}\
#site-nav a{color:inherit;text-decoration:none}\
#site-nav .home{font-weight:700;white-space:nowrap;padding:8px 6px;margin-right:auto;overflow:hidden;text-overflow:ellipsis}\
#site-nav .step{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:40px;border-radius:8px;font-size:18px}\
#site-nav .step:hover,#site-nav summary:hover{background:rgba(127,127,127,.16)}\
#site-nav .step[aria-disabled=true]{opacity:.3;pointer-events:none}\
#site-nav details{position:static}\
#site-nav summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 12px;border-radius:8px;border:1px solid #ddd8cf;font-weight:600;white-space:nowrap;max-width:52vw;user-select:none}\
#site-nav summary::-webkit-details-marker{display:none}\
#site-nav summary span{overflow:hidden;text-overflow:ellipsis}\
#site-nav summary::after{content:"▾";font-size:12px;opacity:.7}\
#site-nav details[open] summary::after{content:"▴"}\
#site-nav .panel{position:absolute;left:0;right:0;top:100%;max-height:calc(100vh - 60px);max-height:calc(100dvh - 60px);overflow:auto;overscroll-behavior:contain;background:#fbfaf7;border-bottom:1px solid #ddd8cf;box-shadow:0 18px 40px rgba(0,0,0,.18)}\
#site-nav .panel-in{max-width:1100px;margin:0 auto;padding:10px 12px 18px;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 24px}\
#site-nav h2{font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:#6b6760;margin:14px 8px 6px}\
#site-nav .panel a{display:block;padding:10px 8px;border-radius:8px;min-height:40px}\
#site-nav .panel a:hover{background:rgba(127,127,127,.14)}\
#site-nav .panel a[aria-current]{background:#1d1c1a;color:#f6f4ef}\
#site-nav a:focus-visible,#site-nav summary:focus-visible{outline:2px solid #d2491f;outline-offset:1px}\
@media (prefers-color-scheme:dark){#site-nav{color:#eeebe5;background:rgba(22,21,20,.9);border-color:#3a3733}#site-nav summary{border-color:#3a3733}#site-nav .panel{background:#1d1c1a;border-color:#3a3733}#site-nav h2{color:#a19c93}#site-nav .panel a[aria-current]{background:#eeebe5;color:#161514}}\
@media (max-width:520px){#site-nav .home .long{display:none}}';

  // A page's module scripts run after the HTML is parsed, and most of them build
  // or resize the demo. If the browser paints in between, everything visibly
  // jumps a moment later. So the body below the menu stays unpainted until
  // those scripts have run (DOMContentLoaded) and the page has stopped changing
  // height for three frames in a row, which covers demos that finish building
  // after an await. It gives up after 0.8 seconds of that, or 3 seconds in all
  // on a slow network. Same idea as blocking="render", which only works in <head>.
  // It is opacity, not visibility, so canvases still get paint events and
  // elementFromPoint() still answers: live checks may start before the reveal.
  var root = document.documentElement;
  // Only for a page someone is looking at directly. A framed page is not held:
  // nobody watches it load, and an opacity effect around a drawable canvas inside
  // an iframe that is itself drawn into a canvas (a page tile on /board/) crashes
  // the tab in Chromium 157.
  var learnDone = false;
  var hold = document.readyState === 'loading' && window.top === window && !/[?&]nohold\b/.test(location.search);
  function reveal() { root.classList.remove('page-loading'); }
  if (hold) {
    root.classList.add('page-loading');
    document.addEventListener('DOMContentLoaded', function () {
      var t0 = performance.now(), last = -1, same = 0;
      (function settle() {
        var h = root.scrollHeight;
        same = h === last ? same + 1 : 0;
        last = h;
        // Also wait for the "what you will learn" box (learnBox below), which adds height under the introduction.
        if ((same >= 3 && learnDone) || performance.now() - t0 > 800) reveal();
        else requestAnimationFrame(settle);
      })();
    });
    setTimeout(reveal, 3000);
  }

  function norm(p) { return p.replace(/index\.html$/, ''); }

  // The bar goes into the page the moment this script runs, at its final
  // height, so nothing below it moves when the list of demos arrives. The menu
  // and the previous/next arrows are filled in by fill().
  function mount() {
    if (document.getElementById('site-nav')) return;
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    var nav = document.createElement('nav');
    nav.id = 'site-nav';
    nav.setAttribute('aria-label', 'Demos');
    nav.innerHTML = '<div class="bar"><a class="home" href="/"><span class="long">HTML-in-canvas </span>experiments</a></div>';
    document.body.insertBefore(nav, document.body.firstChild);
  }

  function fill() {
    mount();
    var nav = document.getElementById('site-nav');
    if (nav.querySelector('details')) return;
    var demos = window.DEMOS || [];
    var groups = window.DEMO_GROUPS || [];
    var here = norm(location.pathname);
    var idx = -1;
    for (var i = 0; i < demos.length; i++) if (norm(demos[i].href) === here) idx = i;

    var esc = function (s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
    var step = function (d, label, glyph) {
      return d ? '<a class="step" href="' + esc(d.href) + '" title="' + label + ': ' + esc(d.title) + '" aria-label="' + label + ': ' + esc(d.title) + '">' + glyph + '</a>'
               : '<a class="step" aria-disabled="true" aria-hidden="true">' + glyph + '</a>';
    };
    var panel = '';
    for (var g = 0; g < groups.length; g++) {
      var items = demos.filter(function (d) { return d.group === groups[g][0]; });
      if (!items.length) continue;
      panel += '<div><h2>' + esc(groups[g][1]) + '</h2>' + items.map(function (d) {
        return '<a href="' + esc(d.href) + '"' + (norm(d.href) === here ? ' aria-current="page"' : '') + '>' + esc(d.title) + '</a>';
      }).join('') + '</div>';
    }
    var other = demos.filter(function (d) { return !groups.some(function (g) { return g[0] === d.group; }); });
    if (other.length) panel += '<div><h2>More</h2>' + other.map(function (d) { return '<a href="' + esc(d.href) + '">' + esc(d.title) + '</a>'; }).join('') + '</div>';

    nav.querySelector('.bar').insertAdjacentHTML('beforeend',
        step(idx > 0 ? demos[idx - 1] : null, 'Previous', '‹') +
        '<details><summary><span>' + (idx >= 0 ? esc(demos[idx].title) : 'All demos (' + demos.length + ')') + '</span></summary>' +
          '<div class="panel"><div class="panel-in">' + panel + '</div></div></details>' +
        step(idx >= 0 ? demos[idx + 1] : demos[0], 'Next', '›'));

    var details = nav.querySelector('details');
    document.addEventListener('click', function (e) { if (details.open && !nav.contains(e.target)) details.open = false; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && details.open) { details.open = false; nav.querySelector('summary').focus(); } });
  }

  function ready(fn) {
    if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn);
  }
  function start() { ready(fill); }

  // The box that says what a demo teaches (/shared/learn.js). Top-level pages
  // only: a framed page is a tile or a test fixture. It needs the page's
  // introduction to exist and the demo titles, so it waits for both. If the
  // page is already showing by then, it goes at the end of the page instead of
  // under the introduction, so nothing the reader is looking at moves.
  function learnBox() {
    if (window.top !== window || /[?&](bench|embed|nolearn)\b/.test(location.search)) { learnDone = true; return; }
    var place = function () {
      ready(function () {
        var go = function () {
          try { if (window.LEARN) window.LEARN.mount(!root.classList.contains('page-loading')); } catch (e) {}
          learnDone = true;
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
      });
    };
    if (window.LEARN) return place();
    var l = document.createElement('script');
    l.src = base + 'learn.js';
    l.onload = place;
    l.onerror = function () { learnDone = true; };
    document.head.appendChild(l);
  }

  ready(mount);
  if (window.DEMOS) { start(); learnBox(); }
  else {
    var s = document.createElement('script');
    s.src = base + 'demos.js';
    s.onload = function () { start(); learnBox(); };
    s.onerror = function () { start(); learnBox(); }; // still show the bar with a Home link
    document.head.appendChild(s);
  }
})();
