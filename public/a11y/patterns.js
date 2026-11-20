// The ways this site gets DOM into a canvas. /a11y/ builds each one around the
// same small card (/a11y/pattern.html?p=<id>) and measures it.
// To add a pattern: add a line here and a builder with the same id in pattern.html.
export const PATTERNS = [
  { id: 'plain', title: 'Child of the canvas', how: 'The element is written inside <canvas content="drawable"> and drawn with drawElementImage.', demo: '/slot-bare/plain.html' },
  { id: 'canvas-slot', title: '<canvas-slot> element', how: 'Light-DOM children slotted into a canvas in the custom element\'s shadow root.', demo: '/slot/' },
  { id: 'bare-slot', title: 'Bare <slot> in a shadow canvas', how: 'No library: a shadow root holding canvas > slot, the element stays a child of the host.', demo: '/slot-bare/' },
  { id: 'light-slots', title: 'canvas > slot upgraded by light-slots.js', how: 'Plain markup; the script moves the canvas into a shadow root on its parent.', demo: '/slot-bare/plain.html?upgrade' },
  { id: 'body-root', title: 'Shadow root on <body>', how: 'canvas > div[drawable] > slot in a shadow root on body: the whole page is drawn, nothing in it moves. capturePage() uses this for one frame.', demo: '/capture/' },
  { id: 'overlay', title: 'Page overlay canvas', how: 'A fixed, viewport-sized canvas with the page content moved inside it.', demo: '/capture/' },
  { id: 'portal', title: '<dom-portal>: drawn twice', how: 'One element, drawn at home and again in a portal by a canvas that covers both.', demo: '/portal/' },
  { id: 'worker', title: 'Drawn by a worker', how: '<canvas-slot worker>: ElementImage snapshots are transferred and drawn on an OffscreenCanvas.', demo: '/offscreen/' },
  { id: 'shader', title: 'Shader CSS (fx attribute)', how: 'The element becomes a WebGL texture and a fragment shader draws it.', demo: '/shader-css/' },
  { id: 'lens', title: '<dom-lens>', how: 'A 2D canvas draws the content, then again magnified inside a loupe.', demo: '/lens/' },
  { id: 'physical', title: '<physical-ui>', how: 'A WebGL texture on a simulated mesh; geometry follows the triangle under the pointer.', demo: '/physical/' },
  { id: 'transition', title: '<live-transition>', how: 'Two states, both live, each a WebGL texture; only one is on screen at rest.', demo: '/transitions/' },
  { id: 'mirror', title: 'Pixel mirror', how: 'drawImage of the source canvas into another canvas: what another tab, origin or a video stream receives.', demo: '/cross-tab/' },
];
