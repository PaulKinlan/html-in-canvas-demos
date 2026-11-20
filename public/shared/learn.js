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
//   learn   one or two sentences: what the page shows how to do (HTML allowed)
//   first   hrefs of pages worth reading before this one (optional)
//   api     the calls and attributes the page turns on (optional)
//
// To put it on the learning path as well, add its href to LEARN.path.
(function () {
  var LEVELS = { basics: 'Basics', core: 'Building blocks', further: 'Going further' };

  var LEARN = {
    levels: LEVELS,

    // The pages to read first, in order.
    path: [
      { href: '/start/', idea: 'The API', why: 'Mark the canvas, size it, handle <code>paint</code>, call <code>drawElementImage()</code>.' },
      { href: '/slot-bare/', idea: 'Slots', why: 'A drawn element must be inside the canvas. A shadow root and a <code>&lt;slot&gt;</code> let the markup stay outside it.' },
      { href: '/slot/', idea: 'A custom element', why: '<code>&lt;canvas-slot&gt;</code> handles sizing, painting and retries, and calls your render function.' },
      { href: '/portal/', idea: 'Hit testing', why: 'An element has one hit-test region. <code>updateElementGeometry()</code> sets where it is.' },
      { href: '/shader-css/', idea: 'WebGL textures', why: '<code>texElementSubImage2D()</code> uploads an element as a texture. Hit testing must then be set by hand.' },
      { href: '/offscreen/', idea: 'Snapshots and workers', why: '<code>captureElementImage()</code> returns an <code>ElementImage</code> that can be transferred to a worker.' },
      { href: '/cross-tab/', idea: 'Other tabs and origins', why: 'Send pixels to the other document and forward its input events back to the element.' },
      { href: '/three-form/', idea: '3D', why: 'The same texture upload and hit-test call, used with three.js.' },
      { href: '/a11y/', idea: 'Accessibility', why: 'Measurements of focus, selection, find-in-page and the accessibility tree for each technique on this site.' },
    ],

    pages: {
      '/start/': { level: 'basics', learn: 'The API calls needed to draw one element, in a 60-line page.', api: ['content="drawable"', 'drawable', 'paint', 'drawElementImage()'] },

      // --- slots ---
      '/slot/': { level: 'basics', learn: 'How a custom element with a canvas in its shadow root draws its light-DOM children, and how to move elements in and out of it.', first: ['/start/', '/slot-bare/'], api: ['<slot>', 'attachShadow()', 'drawElementImage()', 'requestPaint()'] },
      '/slot-bare/': { level: 'basics', learn: 'Why a <code>&lt;slot&gt;</code> in a canvas needs a shadow root, and three ways to create one without a library.', first: ['/start/'], api: ['<template shadowrootmode>', '<slot name>', 'paint', 'drawElementImage()'] },
      '/slot-bare/plain.html': { level: 'basics', learn: 'A slot in a light-DOM canvas projects nothing. This page shows a script that moves the matching elements in.', first: ['/slot-bare/'], api: ['<slot name>', 'moveBefore()', 'MutationObserver'] },

      // --- contexts ---
      '/offscreen/': { level: 'core', learn: 'How to capture elements as <code>ElementImage</code> snapshots and draw them in a worker. A snapshot draws only into its source canvas.', first: ['/start/', '/slot/'], api: ['captureElementImage()', 'ElementImage', 'transferControlToOffscreen()'] },
      '/cross-tab/': { level: 'core', learn: 'How to show an element in another tab: send <code>ImageBitmap</code> frames over a <code>MessagePort</code>, send pointer and key events back, and dispatch them on the element.', first: ['/offscreen/'], api: ['createImageBitmap()', 'MessagePort', 'SharedWorker'] },
      '/cross-origin/': { level: 'further', learn: 'What can be sent to another origin, and how a cross-origin frame can draw your elements into a canvas you transfer to it.', first: ['/offscreen/', '/cross-tab/'], api: ['postMessage()', 'transferControlToOffscreen()', 'ElementImage'] },
      '/transports/': { level: 'further', learn: 'Reference: about fifty ways to move drawn DOM to another context, each tested, with the reason for each failure.', first: ['/offscreen/', '/cross-tab/'], api: ['ElementImage', 'ImageBitmap', 'VideoFrame', 'captureStream()'] },
      '/tear-off/': { level: 'further', learn: 'Four ways to show a widget in another window (move the element, send frames, stream video, transfer the canvas) and what each supports.', first: ['/cross-tab/'], api: ['window.open()', 'documentPictureInPicture', 'BroadcastChannel'] },
      '/remote/': { level: 'further', learn: 'How to stream one element to another device with <code>captureStream()</code> and WebRTC, and forward taps and typing back.', first: ['/cross-tab/'], api: ['captureStream()', 'RTCPeerConnection', 'WebSocket'] },
      '/embed/': { level: 'further', learn: 'Two ways for a host page to apply a shader to content from another origin without access to its DOM, with the limits of each.', first: ['/cross-origin/', '/shader-css/'], api: ['ElementImage', 'transferControlToOffscreen()', 'WebGL'] },
      '/support/': { level: 'further', learn: 'How to send one element of a page to another person or a vision model, with marked fields blacked out before the frame is sent.', first: ['/cross-tab/', '/remote/'], api: ['drawElementImage()', 'captureStream()', 'WebRTC'] },
      '/slot-view/': { level: 'further', learn: 'A <code>postMessage</code> protocol for embedding an element from another origin at its own size, with a permission prompt on the providing origin.', first: ['/cross-origin/', '/embed/'], api: ['postMessage()', 'ImageBitmap', 'shape-outside'] },
      '/pip/': { level: 'further', learn: 'Three ways to put one element in a picture-in-picture window, and which of them accept input.', first: ['/tear-off/'], api: ['documentPictureInPicture', 'captureStream()', 'moveBefore()'] },

      // --- primitives ---
      '/portal/': { level: 'core', learn: 'How to draw one element in two places, and how to move its hit-test region to the copy under the pointer.', first: ['/start/', '/slot/'], api: ['drawElementImage()', 'updateElementGeometry()'] },
      '/lens/': { level: 'core', learn: 'How to magnify DOM without blur: draw the element again at the lens zoom, then distort that image in a shader.', first: ['/start/', '/portal/'], api: ['drawElementImage()', 'texImage2D()', 'updateElementGeometry()'] },
      '/shader-css/': { level: 'core', learn: 'How to draw an element through a fragment shader, with CSS custom properties as the uniforms.', first: ['/start/'], api: ['texElementSubImage2D()', 'updateElementGeometry()', '@property'] },
      '/slot-effects/': { level: 'core', learn: 'How <code>&lt;canvas-slot effect&gt;</code> applies a named shader to each slot, and how to use your own shader.', first: ['/slot/', '/shader-css/'], api: ['texElementSubImage2D()', 'drawElementImageToTexture()', '@property'] },
      '/physical/': { level: 'further', learn: 'How to keep hit testing correct for an element drawn on a mesh that changes shape every frame.', first: ['/shader-css/', '/portal/'], api: ['texElementSubImage2D()', 'updateElementGeometry()'] },

      // --- motion ---
      '/transitions/': { level: 'core', learn: 'How to blend two elements in a shader while both accept input, and how to choose which one a click reaches.', first: ['/shader-css/'], api: ['texElementSubImage2D()', 'updateElementGeometry()'] },
      '/time-scrubber/': { level: 'further', learn: 'How to keep a ring buffer of frames of an element, and how to restore form state when returning to an earlier frame.', first: ['/offscreen/'], api: ['ElementImage', 'changedElements', 'createImageBitmap()'] },
      '/particles/': { level: 'further', learn: 'How to draw each glyph of an element separately, using <code>Range</code> rectangles, while the element stays selectable and searchable.', first: ['/shader-css/'], api: ['Range.getClientRects()', 'texElementSubImage2D()', 'WebGL instancing'] },

      // --- 3d ---
      '/three-form/': { level: 'core', learn: 'How to use an element as a three.js texture, and how to keep typing, Tab and selection working on a 3D surface.', first: ['/shader-css/', '/portal/'], api: ['texElementSubImage2D()', 'drawElementImageToTexture()', 'updateElementGeometry()'] },
      '/board/': { level: 'core', learn: 'How to build a zoomable board with 2D <code>drawElementImage()</code> only. Text is rasterised again at each zoom level and hit testing follows the transform.', first: ['/start/'], api: ['drawElementImage()', 'updateElementGeometry()', '<iframe>'] },
      '/xr/': { level: 'further', learn: 'How to use HTML panels in WebXR, where there is no mouse: convert controller rays to pointer events on the elements.', first: ['/three-form/'], api: ['WebXR', 'texElementSubImage2D()', 'PointerEvent'] },

      // --- audit ---
      '/a11y/': { level: 'core', learn: 'Which accessibility features work for drawn DOM, which techniques break them, and how to run the same audit on your own page.', first: ['/start/'], api: ['accessibility tree', 'focus', 'forced-colors'] },
      '/capture/': { level: 'core', learn: 'How to export any element as a PNG, a video or a printed page by wrapping it in a canvas for one frame.', first: ['/start/'], api: ['drawElementImage()', 'moveBefore()', 'VideoEncoder'] },
      '/perf/': { level: 'core', learn: 'How many elements a canvas can draw per frame on your device, compared with plain DOM and with a worker.', first: ['/start/', '/offscreen/'], api: ['requestPaint()', 'captureElementImage()'] },
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
    var html = '<summary><b>What this page covers</b><span class="lv">' + LEVELS[info.level] +
      (step >= 0 ? ' · step ' + (step + 1) + ' of ' + LEARN.path.length : '') + '</span></summary><div class="in">' +
      '<p>' + info.learn + '</p>';
    if (info.first && info.first.length) {
      html += '<p><b>Read first:</b> ' + info.first.map(function (h) { return '<a href="' + esc(h) + '">' + esc(title(h)) + '</a>'; }).join(', ') + '</p>';
    }
    if (info.api && info.api.length) {
      html += '<p><b>API used:</b> ' + info.api.map(function (a) { return '<code>' + esc(a) + '</code>'; }).join(' ') + '</p>';
    }
    var next = step >= 0 && LEARN.path[step + 1];
    if (next) html += '<p class="next">Next on the <a href="/start/#path">learning path</a>: <a href="' + esc(next.href) + '">' + esc(title(next.href)) + '</a> →</p>';
    else if (step < 0) html += '<p>Tutorial for the API: <a href="/start/">Start here</a>.</p>';
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
