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
#site-nav .bar{display:flex;align-items:center;gap:6px;max-width:1100px;margin:0 auto;padding:6px 12px;min-height:48px}\
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

  function norm(p) { return p.replace(/index\.html$/, ''); }

  function build() {
    if (document.getElementById('site-nav')) return;
    var demos = window.DEMOS || [];
    var groups = window.DEMO_GROUPS || [];
    var here = norm(location.pathname);
    var idx = -1;
    for (var i = 0; i < demos.length; i++) if (norm(demos[i].href) === here) idx = i;

    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    var nav = document.createElement('nav');
    nav.id = 'site-nav';
    nav.setAttribute('aria-label', 'Demos');
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

    nav.innerHTML =
      '<div class="bar">' +
        '<a class="home" href="/"><span class="long">HTML-in-canvas </span>experiments</a>' +
        step(idx > 0 ? demos[idx - 1] : (idx === -1 ? null : null), 'Previous', '‹') +
        '<details><summary><span>' + (idx >= 0 ? esc(demos[idx].title) : 'All demos (' + demos.length + ')') + '</span></summary>' +
          '<div class="panel"><div class="panel-in">' + panel + '</div></div></details>' +
        step(idx >= 0 ? demos[idx + 1] : demos[0], 'Next', '›') +
      '</div>';
    document.body.insertBefore(nav, document.body.firstChild);

    var details = nav.querySelector('details');
    document.addEventListener('click', function (e) { if (details.open && !nav.contains(e.target)) details.open = false; });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && details.open) { details.open = false; nav.querySelector('summary').focus(); } });
  }

  function ready(fn) {
    if (document.body) fn(); else document.addEventListener('DOMContentLoaded', fn);
  }
  function start() { ready(build); }

  if (window.DEMOS) start();
  else {
    var s = document.createElement('script');
    s.src = base + 'demos.js';
    s.onload = start;
    s.onerror = start; // still show the bar with a Home link
    document.head.appendChild(s);
  }
})();
