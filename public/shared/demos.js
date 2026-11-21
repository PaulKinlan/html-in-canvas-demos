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
// The site has two parts. Most groups hold experiments: pages that test what
// the API can and cannot do. They are not lessons and have no reading order.
// The 'start' group is the tutorial. Experiments come first; the tutorial is
// last. The menu, the homepage and the previous/next arrows follow the group
// order below (see the sort at the end).
window.DEMO_GROUPS = [
  ['contexts', 'Experiments: workers, tabs and origins'],
  ['slots', 'Experiments: slots'],
  ['primitives', 'Experiments: UI primitives'],
  ['motion', 'Experiments: transitions and motion'],
  ['media', 'Experiments: video and sound'],
  ['3d', 'Experiments: 3D and shaders'],
  ['audit', 'Measurements: accessibility, capture and performance'],
  ['start', 'Learn the API'],
];

window.DEMOS = [
  // --- start ---
  { group: 'start', href: '/start/', title: 'Start here', blurb: 'A tutorial: enable the API, draw one element with a 60-line page, common errors and their fixes, where each API call is used on this site, and a glossary.', tags: ['content="drawable"', 'paint', 'drawElementImage'] },

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
  { group: 'contexts', href: '/slot-view/', title: '<slot-view>: portable widgets', blurb: 'A live piece of another site in a line of your text, with no iframe box. The other site asks you before a pixel leaves, and takes "Buy now" back to confirm it itself.', tags: ['cross-origin', 'consent', 'shape-outside'] },
  { group: 'contexts', href: '/pip/', title: 'Picture-in-picture for any element', blurb: 'One call floats any element above your other windows: moved for real, as a live picture that takes input, or as a video.', tags: ['Document PiP', 'captureStream', 'Media Session'] },

  // --- primitives ---
  { group: 'primitives', href: '/portal/', title: '<dom-portal>', blurb: 'A drop-in element that shows any live element a second time, anywhere on the page. One element, drawn twice: click and type in either copy.', tags: ['custom element', 'updateElementGeometry'] },
  { group: 'primitives', href: '/lens/', title: 'A lens over live DOM', blurb: 'Fifteen lenses over real markup: a flat magnifier, a ray-traced glass lens, fisheye, water drop, x-ray, black hole, a fiery eye and more. One magnified draw and one shader each, so text stays sharp and you can click and type through the glass.', tags: ['drawElementImage', 'WebGL', 'touch'] },
  { group: 'primitives', href: '/shader-css/', title: 'Shader CSS', blurb: 'Add <code>fx="ripple"</code> to any element to run it through a fragment shader. CSS custom properties are the uniforms, so transitions animate it.', tags: ['texElementSubImage2D', 'WebGL', 'WebGPU', '@property'] },
  { group: 'primitives', href: '/slot-effects/', title: 'Named effects and shader slots', blurb: '<code>&lt;canvas-slot effect="tilt"&gt;</code>: no render loop. Each slot is a texture drawn through a named or hand-written fragment shader, driven by CSS custom properties.', tags: ['custom element', 'WebGL', 'WebGPU', '@property'] },
  { group: 'primitives', href: '/physical/', title: 'Physical UI', blurb: 'Working forms on jelly, cloth and paper. Drag them about: clicks still land on what you see, because hit testing follows the mesh.', tags: ['WebGL', 'Verlet', 'hit testing'] },
  { group: 'primitives', href: '/select/', title: 'Customisable select', blurb: 'A <code>&lt;select&gt;</code> with <code>appearance: base-select</code> whose options are drawn by a canvas inside the picker: a wheel, a fisheye list, a radial menu, a 3D carousel, a hand of cards, a colour grid and a helix. Also a canvas in the button, a canvas inside each option, and a select drawn in a canvas.', tags: ['appearance: base-select', 'drawElementImage', 'WebGL', 'WebGPU'] },
  { group: 'primitives', href: '/datalist/', title: 'Datalist drawn by a canvas', blurb: 'The suggestions of <code>&lt;input list&gt;</code> drawn one <code>&lt;option&gt;</code> at a time by a canvas in a popover, as a list or as pills that rearrange while you type. Also the options of a range input\'s datalist drawn as tick labels.', tags: ['datalist', 'drawElementImage', 'popover', 'anchor positioning'] },
  { group: 'primitives', href: '/inputs/', title: 'Date, time and colour pickers', blurb: 'A clock for <code>&lt;input type="time"&gt;</code>, a calendar for <code>type="date"</code> and swatches for <code>type="color"</code>, each made of real buttons that a canvas moves and fades. Also every built-in form control drawn rotated in a canvas.', tags: ['input type=date', 'input type=time', 'drawElementImage', 'popover'] },
  { group: 'primitives', href: '/component-kit/', title: 'Component kit: newer DOM features in a drawable element', blurb: 'A test element that draws a child in a canvas, written with a scoped registry, manual slot assignment, Reference Target, <code>using</code>, Observable and <code>moveBefore()</code>, and again without them. The page runs both and counts the lines.', tags: ['custom element', 'scoped registry', 'Reference Target', 'Observable', 'moveBefore'] },

  // --- motion ---
  { group: 'motion', href: '/transitions/', title: 'Live view transitions', blurb: 'Shatter, fold, burn or morph between two states that are both live DOM. Stop half way and press a button riding a shard.', tags: ['texElementSubImage2D', 'updateElementGeometry'] },
  { group: 'motion', href: '/view-transitions/', title: 'View Transitions API with HTML-in-canvas', blurb: 'A canvas that draws HTML inside <code>startViewTransition()</code>: which element can carry a name, a shader in place of the cross-fade, and a transition between two documents.', tags: ['startViewTransition', 'view-transition-name', '@view-transition'] },
  { group: 'motion', href: '/time-scrubber/', title: 'Time scrubber', blurb: 'A ring buffer of DOM frames. Scrub the interface back in time, leave motion trails, and restore a past moment, form values included.', tags: ['ElementImage', 'changedElements'] },
  { group: 'motion', href: '/particles/', title: 'Typography as particles', blurb: 'Text explodes into glyph particles and reassembles while staying selectable, searchable, linked and editable. No spans.', tags: ['Range rects', 'WebGL instancing'] },
  { group: 'motion', href: '/selection/', title: 'Text selection effects', blurb: 'Select text that a canvas draws and the canvas draws the highlight: marker strokes, lifted lines, a loupe, trails, glow, fire and a wave, from <code>Range.getClientRects()</code>. Records what the browser paints for a selection inside a canvas.', tags: ['Range.getClientRects()', '::selection', 'CSS Custom Highlight'] },
  { group: 'motion', href: '/caret/', title: 'Carets and highlights', blurb: 'An editable block in a canvas with a CSS block caret, a streak the canvas draws behind the caret, wavy lines under misspelled words from a Custom Highlight, and <code>highlightsFromPoint()</code> to tap them.', tags: ['caret-shape', 'caret-animation', 'highlightsFromPoint()'] },
  { group: 'motion', href: '/stream/', title: 'Streamed HTML drawn as it arrives', blurb: 'Markup is streamed into an element in a canvas with <code>streamAppendHTML()</code>. Each chunk raises a paint event, and a shader draws the newest blocks through a scan line, a blur or spreading ink.', tags: ['streamAppendHTML', 'paint', 'texElementSubImage2D'] },

  // --- media ---
  { group: 'media', href: '/video/', title: 'A <video> element inside a canvas', blurb: 'A playing video with its native controls and captions, drawn through a fragment shader. The controls still work. Cross-origin and encrypted video are left out of the picture.', tags: ['<video>', '::cue', 'requestVideoFrameCallback', 'EME'] },
  { group: 'media', href: '/overlay/', title: 'HTML overlays on video', blurb: 'A caption bar, a poll and a ticker in HTML over a video, in one canvas. Record it with sound, export it frame by frame with WebCodecs, or send it over WebRTC as a camera.', tags: ['MediaRecorder', 'WebCodecs', 'captureStream', 'WebRTC'] },
  { group: 'media', href: '/audio/', title: 'Sound driving DOM', blurb: 'An <code>AnalyserNode</code> writes four band levels to CSS custom properties. A shader that draws a working audio player card reads them as uniforms.', tags: ['Web Audio', '<audio>', '@property', 'WebGPU'] },
  { group: 'media', href: '/player-parts/', title: 'Parts of the native media player', blurb: 'The controls of <code>&lt;video&gt;</code> are a closed shadow tree. Restyle them with pseudo-elements, let <code>:paused</code> and <code>:seeking</code> drive a shader through CSS, and draw the controls as a layer apart from the picture.', tags: ['::-webkit-media-controls', ':paused', ':has()', 'drawImage(video)'] },
  { group: 'media', href: '/player-fx/', title: 'Shaders that join the native controls and the video frame', blurb: 'One <code>&lt;video controls&gt;</code> gives a WebGL canvas its controls and its frame as two textures. The controls bend, melt into and light the picture, and the page finds where the play button and timeline are without script access to them.', tags: ['texElementSubImage2D', 'texImage2D(video)', '::-webkit-media-controls', 'WebGL 2'] },

  // --- 3d ---
  { group: '3d', href: '/three-form/', title: 'A form in a three.js scene', blurb: 'A laptop screen, a far-away billboard and a curved wall, each showing a live HTML document you can type in, tab through and select. WebGL or WebGPU.', tags: ['three.js', 'texElementSubImage2D', 'updateElementGeometry'] },
  { group: '3d', href: '/board/', title: 'Infinite board of live pages', blurb: 'A zoomable, pannable canvas where every tile is a working document: notes, a spreadsheet, a sketch pad and whole pages in iframes, sharp at any zoom.', tags: ['drawElementImage', 'iframe', 'pinch zoom'] },
  { group: '3d', href: '/xr/', title: 'WebXR panels', blurb: 'Ordinary HTML as floating panels in a headset, driven by controller rays, with an on-panel keyboard. Runs as a desktop preview and with a built-in headset emulator too.', tags: ['WebXR', 'three.js', 'synthetic input'] },
  { group: '3d', href: '/native-ui/', title: 'DOM elements in egui and Qt Quick', blurb: 'Two native UI toolkits compiled to WebAssembly, each with real <code>&lt;input&gt;</code> and <code>&lt;select&gt;</code> elements laid out and drawn by the toolkit. Plus notes on Flutter, Compose and others.', tags: ['WebAssembly', 'texElementSubImage2D', 'updateElementGeometry'] },
  { group: '3d', href: '/xr-room/', title: 'HTML panels in a real room', blurb: 'WebXR panels pressed with a tracked fingertip, attached to detected walls and tables with anchors, hidden behind real objects by depth sensing, and shown as an XR quad layer. A simulated room runs the same code without a headset.', tags: ['WebXR', 'hand tracking', 'plane detection'] },

  // --- audit ---
  { group: 'audit', href: '/a11y/', title: 'Accessibility audit', blurb: 'Is DOM in a canvas still DOM? Probes of focus, selection, find, zoom and forced colours, a table of how each pattern on this site holds up, the same audit run over every demo, and a short list to try with a screen reader.', tags: ['accessibility tree', 'focus', 'forced-colors'] },
  { group: 'audit', href: '/capture/', title: 'Element capture', blurb: 'One call turns any element, or a whole ordinary page, into a PNG, a video or a printed page: <code>captureElement()</code>, <code>capturePage()</code>, <code>exportVideo()</code> with WebCodecs. Also copy as a picture and HTML together, page numbers on a printed capture, and a folder of HTML files rendered to PNG files.', tags: ['moveBefore', 'WebCodecs', 'print', 'FileSystemObserver'] },
  { group: 'audit', href: '/perf/', title: 'Performance wall', blurb: 'How many live elements a canvas can carry before frames drop, as plain DOM, a 2D canvas and a worker, measured on your device. Also the delay from a DOM change to the frame that shows it, and where a long frame spends its time.', tags: ['requestPaint', 'worker', 'Element Timing', 'Long Animation Frames'] },
  { group: 'audit', href: '/chrome-apis/', title: 'Plan: new platform features', blurb: 'All 678 features that chromestatus.com lists for Chrome 130 to 160, each with a note on how it could be used with a canvas that draws live DOM, and a ranked list of 28 demos to build.', tags: ['chromestatus', 'plan'] },
  { group: 'audit', href: '/chrome-apis/probes.html', title: 'Probes: new features on drawn elements', blurb: '27 short tests of recent CSS and DOM features on elements that a canvas draws: carousels, anchor positioning, <code>corner-shape</code>, HDR colour, <code>:visited</code>, permission elements.', tags: ['drawElementImage', 'getImageData', 'CSS'] },
  { group: 'audit', href: '/protected/', title: 'What a canvas may not see', blurb: 'Permission buttons, visited links, spelling markers, autofill and content from other origins, each placed in a drawable canvas: is it in the picture, can script read it, and does it still work.', tags: ['getImageData', '<geolocation>', ':visited', 'cross-origin'] },
  { group: 'audit', href: '/elements/', title: 'Every HTML element in a canvas', blurb: 'Each HTML element, input type and a few attributes, put inside a drawable canvas and measured: is it drawn, can it be hit, does it take real clicks and keys. With one thing to build for each.', tags: ['drawElementImage', 'elementsFromPoint', 'top layer'] },
  { group: 'audit', href: '/element-ideas/', title: '17 ideas from the element catalogue, built', blurb: 'A picker wheel from <code>&lt;select multiple&gt;</code>, a mixing desk from range inputs, a dialog with a drawn backdrop, a bar chart from table cells and 13 more. Each keeps the real element and says what the page had to add.', tags: ['drawable descendants', 'drawElementImage', 'updateElementGeometry'] },
];

// Put the entries in group order, keeping the order within each group, so the
// previous/next arrows walk the menu from top to bottom.
{
  const order = new Map(window.DEMO_GROUPS.map(([key], i) => [key, i]));
  const rank = (d) => order.get(d.group) ?? order.size;
  window.DEMOS = window.DEMOS.map((d, i) => [d, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([d]) => d);
}
