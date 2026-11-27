// What each page on the site is: the tutorial, or an experiment.
//
// The site has two parts. /start/ teaches the API. Every other page is an
// experiment that tests what the API can and cannot do. Experiments are not
// lessons and have no reading order.
//
// /shared/nav.js loads this file on every page. On an experiment it puts an
// "About this experiment" box under the page's introduction: the question the
// experiment asks, the pages it builds on, the API calls it uses and a link to
// the page's Findings. On a phone the box starts closed, as one line.
//
// What the box says comes from the page's own file, public/<name>/page.json:
//
//   question  the question the experiment asks, in one sentence (HTML allowed)
//   result    the short answer, if there is one (optional; details go in the
//             page's Findings section)
//   first     paths of pages this one builds on (optional)
//   api       the calls and attributes the page uses (optional)
//
// `npm run build` collects the page files into /shared/pages.js. This file
// holds no per-page data, so adding a page does not change it.
//
// LEARN.uses lists, for each API call, experiments that use it. The tutorial
// and the homepage show it as a reference. It is not a reading order.
(function () {
  var LEARN = {
    // For each API call, experiments whose source shows it in use.
    uses: [
      { call: 'drawElementImage()', what: 'Draw an element with a 2D context.', pages: ['/board/', '/portal/'] },
      { call: 'updateElementGeometry()', what: 'Set where an element receives clicks, hover and focus.', pages: ['/portal/', '/physical/'] },
      { call: 'texElementSubImage2D()', what: 'Upload an element as a WebGL texture.', pages: ['/shader-css/', '/three-form/'] },
      { call: 'drawElementImageToTexture()', what: 'Upload an element as a WebGPU texture.', pages: ['/slot-effects/', '/three-form/'] },
      { call: 'captureElementImage()', what: 'Take an <code>ElementImage</code> snapshot that can be transferred to a worker.', pages: ['/offscreen/', '/time-scrubber/'] },
    ],
  };
  // What each page says about itself, from the page.json files (window.PAGES is
  // in /shared/pages.js, which `npm run build` writes).
  Object.defineProperty(LEARN, 'pages', { get: function () { return window.PAGES || {}; } });
  window.LEARN = LEARN;

  // ---------------------------------------------------------------- the box
  function norm(p) { return p.replace(/index\.html$/, ''); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function title(href) {
    var demos = window.DEMOS || [];
    for (var i = 0; i < demos.length; i++) if (demos[i].href === href) return demos[i].title;
    return href;
  }

  var CSS = '\
.learn-box{margin:14px 0 18px;border:1px solid var(--line,#ddd8cf);border-left:4px solid var(--accent,#d2491f);border-radius:8px;background:var(--card,#fff);color:var(--fg,#1d1c1a);font-size:14.5px;line-height:1.5;max-width:70ch}\
.learn-box summary{cursor:pointer;list-style:none;display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;min-height:44px;padding:8px 14px}\
.learn-box summary::-webkit-details-marker{display:none}\
.learn-box summary::after{content:"▾";margin-left:auto;opacity:.7}\
.learn-box[open] summary::after{content:"▴"}\
.learn-box summary:focus-visible{outline:2px solid var(--accent,#d2491f);outline-offset:2px}\
.learn-box summary b{font-weight:600}\
.learn-box .in{padding:0 14px 12px}\
.learn-box p{margin:0 0 6px}.learn-box p:last-child{margin:0}\
.learn-box code{font-size:13px}\
.learn-box .api code{font-size:12.5px;padding:1px 6px;border:1px solid var(--line,#ddd8cf);border-radius:99px;white-space:nowrap;display:inline-block;margin:2px 2px 2px 0}\
.motion-warn{margin:12px 0 16px;padding:12px 14px;border:1px solid var(--warn,#8a6100);border-left:4px solid var(--warn,#8a6100);border-radius:8px;background:color-mix(in srgb,var(--warn,#8a6100) 11%,var(--card,#fff));color:var(--fg,#1d1c1a);font-size:14px;line-height:1.5;max-width:70ch}\
.motion-warn p{margin:0 0 8px}\
.motion-warn .mw-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}\
.motion-warn button,.motion-warn a.mw-jump{display:inline-flex;align-items:center;min-height:36px;padding:4px 10px;border-radius:6px;border:1px solid var(--line,#ddd8cf);background:var(--card,#fff);color:var(--fg,#1d1c1a);font:600 13px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none;cursor:pointer}\
.motion-warn button:hover,.motion-warn a.mw-jump:hover{border-color:var(--fg,#1d1c1a)}';

  var MOTION_RE = /(3d|parallax|scroll|droste|stereogram|autostereogram|kaleidoscope|symmetry|anamorph|catoptric|refract|caustic|hologram|peppers-ghost|spring|slit-scan|hyperbolic|poincare|fisheye|honeycomb|lenticular|orientation|facedetector|transition|particle|cloth|pinball|conveyor|ripple|fluid|wave|wobbly|compiz|cube|mirror|infinity|kinetic|comic|time-machine|cover-flow|radiosity|submerged|foil|risograph|shader|lens|physical|canvas-skin|css-uniforms|portal|elastic|flap|mech|sim-controls|osm-fold|osm-lens|osm-markers|osm-road|tear-off|godot|player-fx|timed-comments|modular-synth|loupe|pie-menu|progressive-blur|squircle)/i;

  function needsMotionWarning(here, info) {
    var meta = document.querySelector('meta[name="reduced-motion"]');
    if (meta) return meta.content.trim().toLowerCase() !== 'none';
    if (!info) return false;
    if (info.group === 'motion' || info.group === '3d') return true;
    var hay = [here, info.title || '', (info.tags || []).join(' ')].join(' ');
    return MOTION_RE.test(hay);
  }

  function mountMotionNotice(here, info, main, anchor, late) {
    if (!window.matchMedia || !needsMotionWarning(here, info)) return;
    var mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    var dismissed = false;
    var notice = null;
    var stageHidden = false;

    function sync() {
      if (!mql.matches || dismissed) {
        if (notice) { notice.remove(); notice = null; }
        if (stageHidden) {
          var s = main.querySelector('.stage');
          if (s) s.hidden = false;
          stageHidden = false;
        }
        return;
      }
      if (notice) return;
      var noteMeta = document.querySelector('meta[name="reduced-motion-note"]');
      var custom = noteMeta && noteMeta.content ? noteMeta.content.trim() : '';
      var stage = main.querySelector('.stage');
      var how = null;
      var hs = main.querySelectorAll('h2');
      for (var i = 0; i < hs.length; i++) {
        if (/^how it works$/i.test(hs[i].textContent.trim())) { how = hs[i]; break; }
      }
      if (!how && hs.length) how = hs[0];
      if (how && !how.id) how.id = 'how-it-works';

      notice = document.createElement('aside');
      notice.className = 'motion-warn';
      notice.setAttribute('role', 'note');
      notice.setAttribute('aria-label', 'Reduced motion notice');

      var p = document.createElement('p');
      var b = document.createElement('b');
      b.textContent = 'Reduced motion is on. ';
      p.append(b, document.createTextNode(
        custom || 'This experiment uses strong visual motion, 3D perspective or optical distortion. Automatic loops stay paused until you start them.'
      ));

      var actions = document.createElement('div');
      actions.className = 'mw-actions';

      if (stage) {
        var toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.textContent = 'Hide stage';
        toggleBtn.setAttribute('aria-pressed', 'false');
        toggleBtn.addEventListener('click', function () {
          stageHidden = !stageHidden;
          stage.hidden = stageHidden;
          toggleBtn.textContent = stageHidden ? 'Show stage' : 'Hide stage';
          toggleBtn.setAttribute('aria-pressed', String(stageHidden));
        });
        actions.append(toggleBtn);
      }

      if (how) {
        var jump = document.createElement('a');
        jump.className = 'mw-jump';
        jump.href = '#' + how.id;
        jump.textContent = 'Skip to ' + how.textContent.trim();
        actions.append(jump);
      }

      var dismissBtn = document.createElement('button');
      dismissBtn.type = 'button';
      dismissBtn.textContent = 'Dismiss';
      dismissBtn.addEventListener('click', function () {
        dismissed = true;
        if (notice) { notice.remove(); notice = null; }
      });
      actions.append(dismissBtn);

      notice.append(p, actions);
      if (stage && !late) stage.before(notice);
      else if (anchor && !late) anchor.after(notice);
      else main.prepend(notice);
    }

    sync();
    if (mql.addEventListener) mql.addEventListener('change', sync);
  }

  /**
   * Put the box on the page. `late` means the page is already on screen, so
   * the box goes at the end, where it cannot push what the reader is looking at.
   */
  LEARN.mount = function (late) {
    if (document.querySelector('.learn-box')) return;
    var here = norm(location.pathname);
    var info = LEARN.pages[here];
    var main = document.querySelector('main');
    if (!info || !info.question || !main) return;

    var html = '<summary><b>About this experiment</b></summary><div class="in">' +
      '<p><b>Question:</b> ' + info.question + '</p>';
    if (info.result) html += '<p><b>Result:</b> ' + info.result + '</p>';
    if (info.first && info.first.length) {
      html += '<p><b>Builds on:</b> ' + info.first.map(function (h) { return '<a href="' + esc(h) + '">' + esc(title(h)) + '</a>'; }).join(', ') + '</p>';
    }
    if (info.api && info.api.length) {
      html += '<p class="api"><b>API used:</b> ' + info.api.map(function (a) { return '<code>' + esc(a) + '</code>'; }).join(' ') + '</p>';
    }
    // The page's own Findings section says what worked, what did not and what is open.
    var findings = null, hs = main.querySelectorAll('h2');
    for (var i = 0; i < hs.length; i++) if (hs[i].textContent.trim() === 'Findings') findings = hs[i];
    if (findings && !findings.id) findings.id = 'findings';
    html += '<p>' + (findings ? 'What worked and what did not: <a href="#' + esc(findings.id) + '">Findings</a>. ' : '') +
      'This page is an experiment, not a lesson. To learn the API, read the <a href="/start/">tutorial</a>.</p>';
    html += '</div>';

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    // Closed on a phone, so the demo stays on the first screen; open where there is room.
    var box = document.createElement('details');
    box.className = 'learn-box';
    box.open = window.innerWidth >= 700;
    box.innerHTML = html;

    var anchor = !late && (main.querySelector('p.lede') || main.querySelector('h1'));
    if (anchor) anchor.after(box); else main.append(box);
    mountMotionNotice(here, info, main, box, late);
  };
})();
