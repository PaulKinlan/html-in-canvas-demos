// What each demo teaches, and the order to read them in.
//
// /shared/nav.js loads this file on every page. It puts a short box under the
// page's introduction: what you will learn there, what to read first and the
// API calls to look for. On a phone the box starts closed, as one line. The homepage and /start/ build the learning path
// from the same list.
//
// To describe a new demo, add ONE entry to LEARN.pages, keyed by the same href
// as its line in /shared/demos.js:
//
//   level   'basics' | 'core' | 'further'
//   learn   one sentence: what a reader takes away (HTML allowed)
//   first   hrefs of pages worth reading before this one (optional)
//   api     the calls and attributes the page turns on (optional)
//
// To put it on the learning path as well, add its href to LEARN.path.
(function () {
  var LEVELS = { basics: 'Basics', core: 'Building blocks', further: 'Going further' };

  var LEARN = {
    levels: LEVELS,

    // The shortest route from "never used it" to "can build with it".
    // Each step adds one idea to the ones before it.
    path: [
      { href: '/start/', idea: 'The API itself', why: 'Four moves: opt the canvas in, size it, listen for <code>paint</code>, call <code>drawElementImage()</code>.' },
      { href: '/slot-bare/', idea: 'Keep your markup outside the canvas', why: 'The drawn element must be inside the canvas. A shadow root and a <code>&lt;slot&gt;</code> lift that limit.' },
      { href: '/slot/', idea: 'Wrap it in an element', why: '<code>&lt;canvas-slot&gt;</code> does the sizing, painting and retrying, and hands you a render callback.' },
      { href: '/portal/', idea: 'Where clicks land', why: 'One element has one hit box. <code>updateElementGeometry()</code> moves it to wherever the pointer is.' },
      { href: '/shader-css/', idea: 'Elements as GPU textures', why: '<code>texElementSubImage2D()</code> puts an element in a fragment shader. Now hit testing is your job.' },
      { href: '/offscreen/', idea: 'Snapshots and workers', why: '<code>captureElementImage()</code> makes an <code>ElementImage</code> you can transfer to a worker, with one hard limit.' },
      { href: '/cross-tab/', idea: 'Leaving the document', why: 'Across tabs and origins the DOM travels as pixels one way and input the other.' },
      { href: '/three-form/', idea: 'Into a 3D scene', why: 'The same texture and the same hit box, on a laptop screen, a billboard and a curved wall.' },
      { href: '/a11y/', idea: 'What survives', why: 'Focus, selection, find-in-page and the accessibility tree, measured for every pattern on this site.' },
    ],

    pages: {
      '/start/': { level: 'basics', learn: 'The whole API in one small page you can copy.', api: ['content="drawable"', 'drawable', 'paint', 'drawElementImage()'] },

      // --- slots ---
      '/slot/': { level: 'basics', learn: 'How a custom element with a shadow canvas draws its ordinary children, and how to move content in and out of it.', first: ['/start/', '/slot-bare/'], api: ['<slot>', 'attachShadow()', 'drawElementImage()', 'requestPaint()'] },
      '/slot-bare/': { level: 'basics', learn: 'Why the canvas has to sit in a shadow root for a <code>&lt;slot&gt;</code> to work, and the three ways to get one with no library.', first: ['/start/'], api: ['<template shadowrootmode>', '<slot name>', 'paint', 'drawElementImage()'] },
      '/slot-bare/plain.html': { level: 'basics', learn: 'What the browser does with a slot in a plain canvas (nothing), and the smallest script that makes that markup work.', first: ['/slot-bare/'], api: ['<slot name>', 'moveBefore()', 'MutationObserver'] },

      // --- contexts ---
      '/offscreen/': { level: 'core', learn: 'How to snapshot elements and draw them from a worker, and why a snapshot only draws into the canvas it came from.', first: ['/start/', '/slot/'], api: ['captureElementImage()', 'ElementImage', 'transferControlToOffscreen()'] },
      '/cross-tab/': { level: 'core', learn: 'The pattern every cross-document demo uses: send pictures out, send clicks and keys back, replay them on the real element.', first: ['/offscreen/'], api: ['createImageBitmap()', 'MessagePort', 'SharedWorker'] },
      '/cross-origin/': { level: 'further', learn: 'What may cross an origin boundary in each direction, and the one way a foreign page can draw your DOM.', first: ['/offscreen/', '/cross-tab/'], api: ['postMessage()', 'transferControlToOffscreen()', 'ElementImage'] },
      '/transports/': { level: 'further', learn: 'A reference table: every route for moving drawn DOM somewhere else, with which ones work and why the others fail.', first: ['/offscreen/', '/cross-tab/'], api: ['ElementImage', 'ImageBitmap', 'VideoFrame', 'captureStream()'] },
      '/tear-off/': { level: 'further', learn: 'How to choose a route (move the element, stream it, or lend the canvas) when a widget leaves its page.', first: ['/cross-tab/'], api: ['window.open()', 'documentPictureInPicture', 'BroadcastChannel'] },
      '/remote/': { level: 'further', learn: 'How one element becomes a video track another device can use, and what it takes to bring taps and typing back.', first: ['/cross-tab/'], api: ['captureStream()', 'RTCPeerConnection', 'WebSocket'] },
      '/embed/': { level: 'further', learn: 'Two ways to restyle content from another origin without reading its DOM, and what each one costs.', first: ['/cross-origin/', '/shader-css/'], api: ['ElementImage', 'transferControlToOffscreen()', 'WebGL'] },
      '/support/': { level: 'further', learn: 'How to share one region of a page instead of the screen, with redaction done before any pixel leaves.', first: ['/cross-tab/', '/remote/'], api: ['drawElementImage()', 'captureStream()', 'WebRTC'] },
      '/slot-view/': { level: 'further', learn: 'A protocol for embedding a live piece of another site at its real size and shape, with consent on the providing side.', first: ['/cross-origin/', '/embed/'], api: ['postMessage()', 'ImageBitmap', 'shape-outside'] },
      '/pip/': { level: 'further', learn: 'Three ways to float one element above other windows, and which keeps it interactive.', first: ['/tear-off/'], api: ['documentPictureInPicture', 'captureStream()', 'moveBefore()'] },

      // --- primitives ---
      '/portal/': { level: 'core', learn: 'How to show one live element in two places, and how a single hit box is moved to whichever copy the pointer is over.', first: ['/start/', '/slot/'], api: ['drawElementImage()', 'updateElementGeometry()'] },
      '/lens/': { level: 'core', learn: 'How to magnify live DOM and keep it sharp: draw it again larger instead of scaling pixels, then bend it in a shader.', first: ['/start/', '/portal/'], api: ['drawElementImage()', 'texImage2D()', 'updateElementGeometry()'] },
      '/shader-css/': { level: 'core', learn: 'How to run any element through a fragment shader, with CSS custom properties as the uniforms.', first: ['/start/'], api: ['texElementSubImage2D()', 'updateElementGeometry()', '@property'] },
      '/slot-effects/': { level: 'core', learn: 'How named effects hide the render loop, and how to point a slot at a shader you wrote.', first: ['/slot/', '/shader-css/'], api: ['texElementSubImage2D()', 'drawElementImageToTexture()', '@property'] },
      '/physical/': { level: 'further', learn: 'How hit testing follows a deforming mesh, so a form on cloth still takes clicks where you see it.', first: ['/shader-css/', '/portal/'], api: ['texElementSubImage2D()', 'updateElementGeometry()'] },

      // --- motion ---
      '/transitions/': { level: 'core', learn: 'How to blend two states in a shader while both stay live, and how to decide which one a click reaches.', first: ['/shader-css/'], api: ['texElementSubImage2D()', 'updateElementGeometry()'] },
      '/time-scrubber/': { level: 'further', learn: 'How to keep a history of DOM frames cheaply, and what it takes to restore real state from a picture.', first: ['/offscreen/'], api: ['ElementImage', 'changedElements', 'createImageBitmap()'] },
      '/particles/': { level: 'further', learn: 'How to draw text glyph by glyph from one ordinary element, so it stays selectable and searchable.', first: ['/shader-css/'], api: ['Range.getClientRects()', 'texElementSubImage2D()', 'WebGL instancing'] },

      // --- 3d ---
      '/three-form/': { level: 'core', learn: 'How to use an element as a three.js texture and keep typing, tabbing and selection working on a surface in 3D.', first: ['/shader-css/', '/portal/'], api: ['texElementSubImage2D()', 'drawElementImageToTexture()', 'updateElementGeometry()'] },
      '/board/': { level: 'core', learn: 'How far plain 2D goes: a zoom transform re-rasterises every tile sharp, and hit testing follows with no extra code.', first: ['/start/'], api: ['drawElementImage()', 'updateElementGeometry()', '<iframe>'] },
      '/xr/': { level: 'further', learn: 'How HTML panels work where there is no mouse: controller rays become pointer events on the real elements.', first: ['/three-form/'], api: ['WebXR', 'texElementSubImage2D()', 'PointerEvent'] },

      // --- audit ---
      '/a11y/': { level: 'core', learn: 'Which accessibility guarantees hold for drawn DOM, which patterns break them, and how to audit your own page.', first: ['/start/'], api: ['accessibility tree', 'focus', 'forced-colors'] },
      '/capture/': { level: 'core', learn: 'How to turn an element that was never written for canvas into a PNG, a video or a printed page.', first: ['/start/'], api: ['drawElementImage()', 'moveBefore()', 'VideoEncoder'] },
      '/perf/': { level: 'core', learn: 'What drawing costs: how many live elements a canvas carries on your device, against plain DOM and a worker.', first: ['/start/', '/offscreen/'], api: ['requestPaint()', 'captureElementImage()'] },
    },
  };
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
.learn-box .lv{font:600 11px/1.3 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#6b6760)}\
.learn-box .in{padding:0 14px 12px}\
.learn-box p{margin:0 0 6px}.learn-box p:last-child{margin:0}\
.learn-box code{font-size:12.5px;padding:1px 6px;border:1px solid var(--line,#ddd8cf);border-radius:99px;white-space:nowrap;display:inline-block;margin:2px 2px 2px 0}\
.learn-box .next{font-weight:600}';

  /**
   * Put the box on the page. `late` means the page is already on screen, so
   * the box goes at the end, where it cannot push what the reader is looking at.
   */
  LEARN.mount = function (late) {
    if (document.querySelector('.learn-box')) return;
    var here = norm(location.pathname);
    var info = LEARN.pages[here];
    var main = document.querySelector('main');
    if (!info || !main || here === '/start/') return;

    var step = -1;
    for (var i = 0; i < LEARN.path.length; i++) if (LEARN.path[i].href === here) step = i;
    var html = '<summary><b>What you will learn here</b><span class="lv">' + LEVELS[info.level] +
      (step >= 0 ? ' · step ' + (step + 1) + ' of ' + LEARN.path.length : '') + '</span></summary><div class="in">' +
      '<p>' + info.learn + '</p>';
    if (info.first && info.first.length) {
      html += '<p><b>Read first:</b> ' + info.first.map(function (h) { return '<a href="' + esc(h) + '">' + esc(title(h)) + '</a>'; }).join(', ') + '</p>';
    }
    if (info.api && info.api.length) {
      html += '<p><b>Look for:</b> ' + info.api.map(function (a) { return '<code>' + esc(a) + '</code>'; }).join(' ') + '</p>';
    }
    var next = step >= 0 && LEARN.path[step + 1];
    if (next) html += '<p class="next">Next on the <a href="/start/#path">learning path</a>: <a href="' + esc(next.href) + '">' + esc(title(next.href)) + '</a> →</p>';
    else if (step < 0) html += '<p>New to the API? <a href="/start/">Start here</a>.</p>';
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
  };
})();
