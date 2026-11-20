// The one list of demos. The top menu on every page (/shared/nav.js) and the
// homepage (/home.js) are both built from it.
//
// To add a demo: add ONE line inside its group below, and put
//   <script src="/shared/nav.js"></script>
// straight after <body> in the page. That's all.
//
//   href   path of the page (with trailing slash for a folder)
//   title  short name shown in the menu and on the homepage card
//   blurb  one or two sentences for the homepage card (HTML allowed)
//   tags   a few API names shown as chips (optional)
//
// Keep each entry on a single line and add new ones at the END of a group, so
// branches that add demos in parallel merge cleanly. New group? Add it to
// GROUPS, then use its key.
window.DEMO_GROUPS = [
  ['slots', 'Slots'],
  ['contexts', 'Workers, tabs and origins'],
  ['primitives', 'UI primitives'],
  ['motion', 'Transitions and motion'],
  ['3d', '3D and shaders'],
  ['audit', 'Accessibility, capture and performance'],
];

window.DEMOS = [
  // --- slots ---
  { group: 'slots', href: '/slot/', title: '<canvas-slot>', blurb: 'A custom element that slots its light-DOM children into a shadow canvas. They are drawn with effects and stay clickable, focusable and typeable.', tags: ['shadow DOM', 'drawElementImage'] },
  { group: 'slots', href: '/slot-bare/', title: 'Just a slot in a canvas', blurb: 'No library: <code>&lt;slot name&gt;</code> inside <code>&lt;canvas&gt;</code> with declarative shadow DOM, and a shadow root on <code>&lt;body&gt;</code> for page-level slots.', tags: ['declarative shadow DOM', 'slot'] },
  { group: 'slots', href: '/slot-bare/plain.html', title: 'canvas → slot, plain HTML', blurb: 'The markup with no template and no shadow root: what the browser does natively, and one script that makes it work.', tags: ['slot', 'light DOM'] },

  // --- contexts ---
  { group: 'contexts', href: '/offscreen/', title: 'OffscreenCanvas', blurb: 'Transfer <code>ElementImage</code> snapshots to a worker that keeps animating while the main thread is blocked. Plus a DOM magnifier.', tags: ['worker', 'captureElementImage'] },
  { group: 'contexts', href: '/cross-tab/', title: 'Across tabs', blurb: 'Stream a slot to another tab over a MessagePort brokered by a SharedWorker. Clicks and typing in the other tab come back to the real DOM.', tags: ['MessageChannel', 'SharedWorker', 'ImageBitmap'] },
  { group: 'contexts', href: '/cross-origin/', title: 'Across origins', blurb: 'Borrow another origin\'s DOM as pixels, and lend yours: a cross-origin iframe renders this page\'s DOM into a transferred canvas.', tags: ['postMessage', 'transferControlToOffscreen'] },
  { group: 'contexts', href: '/transports/', title: 'Transport lab', blurb: 'Nearly fifty routes for getting DOM out of its canvas: snapshots, bitmaps, video frames, streams, WebRTC, codecs, WebGL. Each one tested live.', tags: ['VideoFrame', 'WebRTC', 'WebCodecs', 'WebGL'] },
  { group: 'contexts', href: '/tear-off/', title: 'Tear-off widgets', blurb: 'Pull a widget out of the page into a popup, an always-on-top window, another tab or another origin. It keeps working, and what you do there happens here.', tags: ['window.open', 'Picture-in-Picture', 'BroadcastChannel'] },
  { group: 'contexts', href: '/remote/', title: 'Remote component', blurb: 'Scan a code and one element of the page is live on your phone over WebRTC. Taps, typing and native pickers come back to the real DOM.', tags: ['WebRTC', 'Durable Objects', 'captureStream'] },
  { group: 'contexts', href: '/embed/', title: 'Embeddable live cards', blurb: 'A card from another origin that the host page bends with a shader, recolours and resizes without ever touching its DOM. Its buttons still work.', tags: ['cross-origin', 'WebGL', 'ElementImage'] },
  { group: 'contexts', href: '/support/', title: 'Support widget', blurb: 'Share one panel of a page, not your screen, with a support agent or an AI model. Private fields are blacked out and actions need your approval.', tags: ['co-browsing', 'Workers AI', 'redaction'] },

  // --- primitives ---
  { group: 'primitives', href: '/portal/', title: '<dom-portal>', blurb: 'A drop-in element that shows any live element a second time, anywhere on the page. One element, drawn twice: click and type in either copy.', tags: ['custom element', 'updateElementGeometry'] },
  { group: 'primitives', href: '/lens/', title: 'A lens over live DOM', blurb: 'Magnifier, fisheye and x-ray loupes over real markup. Text is re-rasterized sharp at any zoom, and you can click and type through the glass.', tags: ['drawElementImage', 'mesh warp', 'touch'] },
  { group: 'primitives', href: '/shader-css/', title: 'Shader CSS', blurb: 'Add <code>fx="ripple"</code> to any element to run it through a fragment shader. CSS custom properties are the uniforms, so transitions animate it.', tags: ['texElementSubImage2D', 'WebGL', 'WebGPU', '@property'] },
  { group: 'primitives', href: '/slot-effects/', title: 'Named effects and shader slots', blurb: '<code>&lt;canvas-slot effect="tilt"&gt;</code>: no render loop. Each slot is a texture drawn through a named or hand-written fragment shader, driven by CSS custom properties.', tags: ['custom element', 'WebGL', 'WebGPU', '@property'] },
  { group: 'primitives', href: '/physical/', title: 'Physical UI', blurb: 'Working forms on jelly, cloth and paper. Drag them about: clicks still land on what you see, because hit testing follows the mesh.', tags: ['WebGL', 'Verlet', 'hit testing'] },

  // --- motion ---
  { group: 'motion', href: '/transitions/', title: 'Live view transitions', blurb: 'Shatter, fold, burn or morph between two states that are both live DOM. Stop half way and press a button riding a shard.', tags: ['texElementSubImage2D', 'updateElementGeometry'] },
  { group: 'motion', href: '/time-scrubber/', title: 'Time scrubber', blurb: 'A ring buffer of DOM frames. Scrub the interface back in time, leave motion trails, and restore a past moment, form values included.', tags: ['ElementImage', 'changedElements'] },
  { group: 'motion', href: '/particles/', title: 'Typography as particles', blurb: 'Text explodes into glyph particles and reassembles while staying selectable, searchable, linked and editable. No spans.', tags: ['Range rects', 'WebGL instancing'] },

  // --- 3d ---

  // --- audit ---
  { group: 'audit', href: '/a11y/', title: 'Accessibility audit', blurb: 'Is DOM in a canvas still DOM? Probes of focus, selection, find, zoom and forced colours, the same audit run over every demo here, and a short list to try with a screen reader.', tags: ['accessibility tree', 'focus', 'forced-colors'] },
  { group: 'audit', href: '/capture/', title: 'Element capture', blurb: 'One call turns any element, or a whole ordinary page, into a PNG, a video or a printed page: <code>captureElement()</code>, <code>capturePage()</code>, <code>recordElement()</code>.', tags: ['moveBefore', 'captureStream', 'print'] },
  { group: 'audit', href: '/perf/', title: 'Performance wall', blurb: 'How many live elements a canvas can carry before frames drop, as plain DOM, a 2D canvas and a worker, measured on your device.', tags: ['requestPaint', 'worker', 'fps'] },
];
