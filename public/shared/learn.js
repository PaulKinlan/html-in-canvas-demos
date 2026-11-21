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
// To describe a new experiment, add ONE entry to LEARN.pages, keyed by the
// same href as its line in /shared/demos.js:
//
//   question  the question the experiment asks, in one sentence (HTML allowed)
//   result    the short answer, if there is one (optional; details go in the
//             page's Findings section)
//   first     hrefs of pages this one builds on (optional)
//   api       the calls and attributes the page uses (optional)
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

    pages: {
      '/start/': { kind: 'tutorial' },

      // --- slots ---
      '/slot/': { question: 'Can a custom element with a canvas in its shadow root draw its light-DOM children and keep them clickable, focusable and typeable?', first: ['/start/', '/slot-bare/'], api: ['<slot>', 'attachShadow()', 'drawElementImage()', 'requestPaint()'] },
      '/slot-bare/': { question: 'Does a <code>&lt;slot&gt;</code> inside a <code>&lt;canvas&gt;</code> project elements with no library?', result: 'It does when the canvas is in a shadow root. The page shows three ways to create one.', first: ['/start/'], api: ['<template shadowrootmode>', '<slot name>', 'paint', 'drawElementImage()'] },
      '/slot-bare/plain.html': { question: 'What does a <code>&lt;slot&gt;</code> in a light-DOM canvas do with no shadow root?', result: 'It projects nothing. A script that moves the matching elements into the canvas makes the markup work.', first: ['/slot-bare/'], api: ['<slot name>', 'moveBefore()', 'MutationObserver'] },

      // --- contexts ---
      '/offscreen/': { question: 'Can a worker draw DOM elements while the main thread is blocked?', result: 'An <code>ElementImage</code> transfers to a worker. It draws only into its source canvas.', first: ['/start/', '/slot/'], api: ['captureElementImage()', 'ElementImage', 'transferControlToOffscreen()'] },
      '/cross-tab/': { question: 'Can an element be shown and used in another tab?', result: 'The page sends <code>ImageBitmap</code> frames over a <code>MessagePort</code>. The other tab sends pointer and key events back, and they are dispatched on the element.', first: ['/offscreen/'], api: ['createImageBitmap()', 'MessagePort', 'SharedWorker'] },
      '/cross-origin/': { question: 'What of a drawn element can be sent to another origin, and can a cross-origin frame draw this page\'s elements into a canvas transferred to it?', first: ['/offscreen/', '/cross-tab/'], api: ['postMessage()', 'transferControlToOffscreen()', 'ElementImage'] },
      '/transports/': { question: 'Which transports can carry drawn DOM to another context? About fifty are tested, with the reason for each failure.', first: ['/offscreen/', '/cross-tab/'], api: ['ElementImage', 'ImageBitmap', 'VideoFrame', 'captureStream()'] },
      '/transports-2/': { question: 'Which transport APIs from Chrome 130 to 160 carry a drawn element, and what stops when the browser freezes the source tab?', result: '<code>maintain-framerate-and-resolution</code> keeps a 960×540 element at 960×540 where the default shrinks it to 320×180. A frame with <code>Document-Isolation-Policy</code> gets shared memory. WebTransport has no server here.', first: ['/transports/', '/remote/'], api: ['RTCRtpSender.setParameters()', 'SharedArrayBuffer', 'WebTransport', 'RestrictionTarget'] },
      '/tear-off/': { question: 'Can a widget move to a popup, an always-on-top window, another tab or another origin and keep working? Four methods are compared.', first: ['/cross-tab/'], api: ['window.open()', 'documentPictureInPicture', 'BroadcastChannel'] },
      '/remote/': { question: 'Can one element be streamed to another device with <code>captureStream()</code> and WebRTC, and take taps and typing from it?', first: ['/cross-tab/'], api: ['captureStream()', 'RTCPeerConnection', 'WebSocket'] },
      '/embed/': { question: 'Can a host page apply a shader to content from another origin without access to its DOM? Two methods are compared.', first: ['/cross-origin/', '/shader-css/'], api: ['ElementImage', 'transferControlToOffscreen()', 'WebGL'] },
      '/support/': { question: 'Can a page share one element, instead of the screen, with another person or a vision model, with marked fields blacked out before the frame is sent?', first: ['/cross-tab/', '/remote/'], api: ['drawElementImage()', 'captureStream()', 'WebRTC'] },
      '/slot-view/': { question: 'Can an element from another origin be laid out inline at its own size, with a permission prompt on the providing origin?', first: ['/cross-origin/', '/embed/'], api: ['postMessage()', 'ImageBitmap', 'shape-outside'] },
      '/pip/': { question: 'Can any element be put in a picture-in-picture window, and does it accept input there? Three methods are compared.', first: ['/tear-off/'], api: ['documentPictureInPicture', 'captureStream()', 'moveBefore()'] },

      // --- primitives ---
      '/portal/': { question: 'Can one element be drawn in two places and take input in both?', result: 'An element has one hit-test region. The page moves it to the copy under the pointer.', first: ['/start/', '/slot/'], api: ['drawElementImage()', 'updateElementGeometry()'] },
      '/lens/': { question: 'Can live DOM be magnified and distorted without blur while clicks and typing pass through the lens?', first: ['/start/', '/portal/'], api: ['drawElementImage()', 'texImage2D()', 'updateElementGeometry()'] },
      '/shader-css/': { question: 'Can an HTML attribute draw an element through a fragment shader, with CSS custom properties as the uniforms?', first: ['/start/'], api: ['texElementSubImage2D()', 'updateElementGeometry()', '@property'] },
      '/slot-effects/': { question: 'Can <code>&lt;canvas-slot&gt;</code> apply a shader to each slot without the page author writing a render loop?', first: ['/slot/', '/shader-css/'], api: ['texElementSubImage2D()', 'drawElementImageToTexture()', '@property'] },
      '/physical/': { question: 'Can hit testing stay correct for a form drawn on a mesh that changes shape every frame?', first: ['/shader-css/', '/portal/'], api: ['texElementSubImage2D()', 'updateElementGeometry()'] },
      '/select/': { question: 'Can a canvas inside a customisable <code>&lt;select&gt;</code> draw the options while the select keeps the value, the keyboard and hit testing? And does the picker of a select inside a canvas draw into that canvas?', result: 'Options inside a canvas inside the select work, in 2D, WebGL and WebGPU. The picker of a select that is in a canvas stays in the top layer and is not drawn by that canvas.', first: ['/start/', '/portal/', '/three-form/'], api: ['appearance: base-select', 'drawElementImage()', 'texElementSubImage2D()', 'drawElementImageToTexture()', 'updateElementGeometry()'] },
      '/datalist/': { question: 'The popup of <code>&lt;input list&gt;</code> cannot be styled. Can the <code>&lt;datalist&gt;</code> element itself be put in a canvas and its options drawn as the suggestions?', result: 'Yes, once the input\'s <code>list</code> attribute is removed and the keyboard handling is rewritten. An option in a datalist renders only text, so rich suggestions are not possible this way.', first: ['/start/', '/select/'], api: ['drawElementImage()', 'updateElementGeometry()', 'popover', 'CSS anchor positioning'] },
      '/inputs/': { question: 'Date, time and colour inputs have pickers with no element to style. Can a canvas-drawn picker made of real buttons replace them on the same input, and what happens to the built-in controls when the input is drawn in a canvas?', result: 'The replacement pickers work with touch, mouse and keyboard. Built-in controls draw and work rotated. Their own pickers stay outside the canvas.', first: ['/start/', '/select/', '/datalist/'], api: ['drawElementImage()', 'updateElementGeometry()', 'popover', 'CSS anchor positioning'] },

      // --- motion ---
      '/transitions/': { question: 'Can two states both accept input while a shader blends between them, and which one does a click reach?', first: ['/shader-css/'], api: ['texElementSubImage2D()', 'updateElementGeometry()'] },
      '/view-transitions/': { question: 'Does a canvas that draws HTML work with the View Transitions API, and can a shader replace the cross-fade?', result: 'A named canvas transitions as one live picture. A canvas child gets a group with no picture. Scoped transitions on the canvas or its children fail.', first: ['/transitions/'], api: ['document.startViewTransition()', 'view-transition-name', '@view-transition', 'drawElementImage()'] },
      '/time-scrubber/': { question: 'Can a page keep past frames of an element and return to an earlier one, form values included?', first: ['/offscreen/'], api: ['ElementImage', 'changedElements', 'createImageBitmap()'] },
      '/particles/': { question: 'Can each glyph of a paragraph be drawn separately while the paragraph stays selectable, searchable and editable?', first: ['/shader-css/'], api: ['Range.getClientRects()', 'texElementSubImage2D()', 'WebGL instancing'] },
      '/selection/': { question: 'When text inside a canvas is selected, what does the browser draw, and can the canvas draw its own highlight from the rectangles of the selected text?', first: ['/particles/', '/shader-css/'], api: ['Range.getClientRects()', '::selection', 'CSS.highlights', 'updateElementGeometry()', 'texElementSubImage2D()'] },
      '/stream/': { question: 'When markup is streamed into an element in a canvas, does the canvas get a paint event for each chunk, and can it draw the newest blocks differently from the rest?', result: 'In Chromium 157 each chunk raises one paint event with no call to requestPaint(). A MutationObserver gives the new blocks, and one shader pass draws them through an effect while the text stays selectable.', first: ['/shader-css/'], api: ['streamAppendHTML()', 'paint event', 'texElementSubImage2D()', 'updateElementGeometry()'] },

      // --- media ---
      '/video/': { question: 'Does a playing <code>&lt;video&gt;</code> with native controls and captions draw into a canvas, frame by frame, and do its controls still work under a shader?', result: 'Frames, controls and <code>::cue</code> captions are drawn, and <code>paint</code> fires for each video frame. Cross-origin video without CORS and encrypted video are left out.', first: ['/start/', '/shader-css/'], api: ['<video controls>', '<track>', 'requestVideoFrameCallback()', 'texElementSubImage2D()', 'MediaKeys'] },
      '/overlay/': { question: 'Can HTML drawn over a video in one canvas be recorded with the video\'s sound, exported with exact frames, and sent as a camera?', result: 'All three work. The export seeks the video and steps CSS animations one frame at a time.', first: ['/video/', '/capture/', '/remote/'], api: ['drawElementImage()', 'captureStream()', 'MediaRecorder', 'VideoEncoder', 'AudioEncoder', 'RTCPeerConnection'] },
      '/audio/': { question: 'Can sound analysis drive the shader that draws live DOM, with CSS custom properties as the only link?', first: ['/shader-css/', '/video/'], api: ['AnalyserNode', 'OfflineAudioContext', '<audio controls>', '@property'] },
      '/player-parts/': { question: 'The native media controls are a shadow tree a page cannot open. Can a canvas restyle their parts, react to the player\'s state, or draw the controls apart from the picture?', result: 'Pseudo-element rules are drawn. State pseudo-classes drive a shader through <code>:has()</code> where the browser has them. A video reduced to its controls can be drawn anywhere. No single part can be reached from script.', first: ['/video/', '/shader-css/'], api: ['::-webkit-media-controls-panel', ':paused', ':has()', 'drawImage()', 'drawElementImage()'] },
      '/player-fx/': { question: 'Can one shader work on the native controls and the video frame as separate inputs, and can an effect start at one control when no script can reach it?', result: 'Yes. The controls and the frame are two textures from one element. Each named part is found by giving it a flat colour for one paint and reading the picture back.', first: ['/player-parts/', '/video/'], api: ['texElementSubImage2D()', 'texImage2D(video)', '::-webkit-media-controls-play-button', 'getElementImageDefaultSize()'] },

      // --- 3d ---
      '/three-form/': { question: 'Can an HTML form be a three.js texture and keep typing, Tab and text selection on a 3D surface?', first: ['/shader-css/', '/portal/'], api: ['texElementSubImage2D()', 'drawElementImageToTexture()', 'updateElementGeometry()'] },
      '/board/': { question: 'Can a zoomable board of live documents be built with 2D <code>drawElementImage()</code> only, with text rasterised again at each zoom level?', first: ['/start/'], api: ['drawElementImage()', 'updateElementGeometry()', '<iframe>'] },
      '/xr/': { question: 'Can HTML panels be used in WebXR, where there is no mouse? Controller rays are converted to pointer events on the elements.', first: ['/three-form/'], api: ['WebXR', 'texElementSubImage2D()', 'PointerEvent'] },
      '/native-ui/': { question: 'Can a native UI toolkit compiled to WebAssembly (egui, Qt Quick) use real DOM inputs as widgets inside its own WebGL canvas?', result: 'Yes for both, with a bridge of about 200 lines and no change to the toolkit. Tab order and occlusion are left to the bridge.', first: ['/three-form/'], api: ['texElementSubImage2D()', 'updateElementGeometry()', 'WebAssembly'] },

      // --- audit ---
      '/a11y/': { question: 'Which accessibility features work for DOM drawn in a canvas, and which techniques on this site break them?', first: ['/start/'], api: ['accessibility tree', 'focus', 'forced-colors'] },
      '/capture/': { question: 'Can any element be exported as a PNG, a video or a printed page by wrapping it in a canvas for one frame?', first: ['/start/'], api: ['drawElementImage()', 'moveBefore()', 'VideoEncoder'] },
      '/perf/': { question: 'How many elements can a canvas draw per frame on your device, compared with plain DOM and with a worker?', first: ['/start/', '/offscreen/'], api: ['requestPaint()', 'captureElementImage()'] },
      '/chrome-apis/': { question: 'Which features from Chrome 130 to 160 can be combined with a canvas that draws live DOM, and which demos should be built from them?', result: '359 of 678 features have an idea, 44 are measured, and 28 demos are planned.', first: ['/chrome-apis/probes.html'] },
      '/chrome-apis/probes.html': { question: 'Do recent CSS and DOM features take effect on an element that a canvas draws?', result: 'Shapes, carets, highlights, scroll markers and scroll-driven animations do. Popovers are not in the picture, links are drawn as unvisited, and permission elements report that they are distorted.', first: ['/start/'], api: ['drawElementImage()', 'requestPaint()', 'getImageData()'] },
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
.learn-box .in{padding:0 14px 12px}\
.learn-box p{margin:0 0 6px}.learn-box p:last-child{margin:0}\
.learn-box code{font-size:13px}\
.learn-box .api code{font-size:12.5px;padding:1px 6px;border:1px solid var(--line,#ddd8cf);border-radius:99px;white-space:nowrap;display:inline-block;margin:2px 2px 2px 0}';

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
  };
})();
