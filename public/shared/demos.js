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

  // --- primitives ---

  // --- motion ---

  // --- 3d ---

  // --- audit ---
];
