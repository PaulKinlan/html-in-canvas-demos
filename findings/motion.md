# Transitions and motion (`/transitions/`, `/time-scrubber/`, `/particles/`)

| Experiment | Result | Why |
|---|---|---|
| Two slotted states as WebGL textures, re-uploaded every frame of a transition | works | Animations, typing, checkbox ticks and selection highlights show up on shards, folds and embers as they happen. |
| Press a button on a flying shard | works | WebGL draws don't move hit boxes, so the triangle under the pointer is found on the CPU and its affine matrix is given to `updateElementGeometry`. |
| Per-pixel routing through a burn mask | works | The shader's noise is mirrored on the CPU; `pointer-events` flips between the two states under the pointer. |
| Shared-element morph from sub-rectangles of the two state textures | works | No extra snapshots. The hole an element leaves is filled by smearing the pixels just outside it. |
| A transition written as one fragment shader (gl-transitions convention) over the two live states | works | The two textures are the two DOM states, refreshed only when they repaint. Shaders from gl-transitions.com paste in unchanged. A bad shader is refused with the compiler's log before the transition starts. |
| Hit testing inside an arbitrary shader | partly | The browser cannot know which state a pixel came from. A shader can ship a small `pick(x, y, p)` mirror (ripple does); without one the pointer goes to the old state before half way and the new one after. Shaders that move pixels (swirl) leave hit boxes at their flat positions. |
| Read the time scrubber's history back out as pictures (`frames()`) | works | Each past frame is redrawn from its ElementImages and copied with `createImageBitmap`; 13 frames of a 320 px rig at 2× came back in order, and live drawing resumed after. Not yet fed to a real encoder. |
| Live checks that run on load, on a phone | disturbing | A rig pinned over the page covers the demo, checks on the visible demo rebuild it under the reader, and a table that fills in later makes scroll anchoring jump the page. On these three pages the checks now wait until their own section is on screen (`onScreen` in `shared/on-screen.js`), run only on fixtures inside that section, list their rows up front, and never focus with scrolling or open a modal. `?checks` starts them at once. |
| Lost WebGL or 2D context | handled | A canvas with a lost context is an empty box with live, invisible controls. The elements move their slotted children out of the canvas and show them as plain HTML, then move them back on restore. The pages also read the canvas back and do the same if it comes out blank or one solid block. Tested with `WEBGL_lose_context`; a real phone losing a context has not been observed. |
| Upload a state that has never been painted (`visibility: hidden`) | fails | "No cached paint record for element." The first frame has to wait for a paint. |
| A modal `<dialog>` or popover inside a state travels with it | fails | The top layer is not part of the canvas child's picture. |
| Hold 600 ElementImages and draw the oldest | works | About 0.014 ms per capture here, against 0.26 ms and 33 MB for the same frames as ImageBitmaps. |
| Snapshot keeps drawing after its element changes, is removed, or the canvas is resized | works | After a resize its default size is recomputed for the new canvas grid. |
| Old snapshot drawn at 4× | sharp | It is replayed paint commands, not pixels. |
| `globalAlpha`, `filter`, `globalCompositeOperation` with `drawElementImage` | works | Enough for trails and ghosts. |
| `paint` event's `changedElements` | precise | Lists only children that repainted, including for a caret blink or a CSS animation. Moving elements share one snapshot across frames. |
| Select or query the text of a past frame | fails | ElementImage has `close()` and nothing else. Rewinding for real means storing state next to each frame. |
| Drawing an ElementImage | moves the hit box | The live element becomes hit-testable where its snapshot was last drawn. |
| Nine-argument `drawElementImage` (source rectangle) | works | The source rectangle is in the element's CSS pixels. The hit box moves as if the whole element had been drawn with that source-to-destination mapping. |
| Nested and inline `drawable` descendants drawn on their own | works | A parent's picture still includes them. |
| A particle per grapheme from `Range.getClientRects()`, no spans | works | Shaping, selection, links, `window.find()` and editing are untouched. |
| 1,000 upright glyph draws in 2D | works | About 17 ms in software rendering. |
| 1,000 glyph draws in 2D, each at its own angle | fails | About 1.5 s: each angle re-rasterises text. WebGL instanced quads from one texture cost well under 1 ms of script per frame for 400 glyphs. |
| `updateElementGeometry` after 2D draws in the same `paint` handler | works | It overrides the hit box the draws left behind, so pieces can be drawn anywhere while the element stays put. |
| Animated transparent WebGL canvas with drawable children on Android (Chrome 159, real phone) | reported broken | The glyph canvas became a solid white block once letters moved. Not reproducible in headless software rendering, cause unconfirmed. `<glyph-field>` now defaults to a 2D canvas with an ImageBitmap atlas (draw block, `createImageBitmap`, clear, `drawImage` per glyph, all in one `paint` handler), keeps WebGL as `engine="webgl"`, and shows plain HTML if its context is lost. |
| Click a glyph in mid-air | works for one pointer | One element, one hit box, so the box follows the pointer: the block is placed with `updateElementGeometry` so the home of the letter under the pointer sits under it. Mouse clicks and taps on a flying link letter reach the link. Two pointers at once still cannot both be right; one drawable span per letter gets a hit box each, at the cost of an element per character. |
| Ask what is at a point again after `updateElementGeometry` moved a box there | stale | Chromium 157 keeps its last hit-test answer for a point, and this call does not clear it, so `elementFromPoint` and a click at the same point still see the old layout. One pixel away is correct, and any DOM change (toggling an attribute) clears it. `<glyph-field>` and `<live-transition>` toggle `data-moved` when the box moves. Live check on `/particles/`. Worth reporting upstream. |
| CSS zoom on the motion elements | works | The canvases are sized by `devicePixelRatio × currentCSSZoom` and re-measured through a `device-pixel-content-box` ResizeObserver, and pointer positions are divided by the zoom. `canvasTransform` stays in unzoomed layout px whatever the backing store size (probed at 1× and 2× backing, zoom 1 and 1.5). |

Not tested here: whether Chrome's find-in-page highlight is painted into an element's picture (needs a person at a real browser), and frame rates on a real GPU (these numbers are from software rendering).

## View Transitions API (`/view-transitions/`)

Tested in headless Chromium 157 with `document.startViewTransition()`, `element.startViewTransition()` and `@view-transition { navigation: auto }`.

| Question | Result | Detail |
| --- | --- | --- |
| A `<canvas layoutsubtree>` with a `view-transition-name` in a document transition | works | The old snapshot is the canvas bitmap, HTML children included. The new snapshot is live: the canvas keeps getting `paint` events and a clock inside it keeps counting while the group moves and resizes. |
| `view-transition-name` on a child of the canvas | group only, no picture | `::view-transition-group(name)` exists and animates between the boxes that `drawElementImage()` (or `updateElementGeometry()`) gave the child. Both snapshots are empty. To move one element on its own, give it its own canvas and name the canvas. |
| A shader in place of the cross-fade | works | `::view-transition-old(name) { display: none }` and `::view-transition-new(name) { animation: none }` leave the live canvas showing. The view transition moves the box and `<live-transition>` draws the change. `begin()` must finish before `startViewTransition()`: no `paint` event arrives while the update callback is pending. |
| Read `::view-transition-old()` into a canvas or texture | not possible | `ViewTransition` has no call that returns pixels. A shader transition keeps its own copy of the old state. |
| `element.startViewTransition()` on an ancestor of the canvas | works | Same result as on the document. The rest of the page stays interactive. |
| `element.startViewTransition()` on the canvas itself | canvas is blank during the transition | A scope takes part in its own transition as `view-transition-name: root`. The pseudo-elements that would show its snapshot are inside the canvas, which renders none of its contents. |
| The same, with `view-transition-name: none` on the canvas | works, shows nothing by itself | The canvas keeps drawing and getting `paint` events. Named descendants get groups that are never shown. `vt.transitionRoot` is the canvas. |
| Read those hidden groups as a clock and draw the move in the canvas | works | Replace the group keyframes with one that animates a registered custom property (`--vt-p`) from 0 to 1 and read it with `getComputedStyle(canvas, '::view-transition-group(name)')`. CSS keeps control of duration, easing and per-item delay. The canvas draws each item with the nine-argument `drawElementImage()` and can add an arc, a turn and a shadow. The page stays interactive and other scoped transitions run at the same time. |
| Position of a group inside a canvas-scoped transition | wrong | Width and height are right. The transform is 0,0 for every group, so positions have to be measured with `offsetLeft` and `offsetTop` before and after the change. In a document transition the group of a canvas child has the right position. |
| Flow layout of direct canvas children | no | Each `drawable` child is laid out alone at the canvas origin. Put a grid or flex container in as one `drawable` child and name its children. |
| `element.startViewTransition()` on a `drawable` child of `<canvas content="drawable">` | renderer crash | Crashes with or without `layoutsubtree`, with or without a draw, and with `view-transition-name: none` on the child. A child without the `drawable` attribute does not crash. A canvas without `content="drawable"` rejects with "Unsupported layout or style". Reproduction: `/view-transitions/crash.html`. |
| Cross-document transition with a named canvas on both pages | works | The canvas cross-fades and morphs like an image. `pagereveal` can fire before a module script runs, so listen for it in a classic script. |
| A shader between two documents | works with pixels | An `ElementImage` cannot follow a navigation. The old page stores a WebP of its canvas in `sessionStorage` before navigating. The new page inserts it as the first state of a `<live-transition>` and burns to the real content. The old snapshot stays visible underneath until the canvas has drawn. When the two boxes have different shapes the stored picture is stretched. |

Element-scoped view transitions shipped in Chrome 147 (developer testing from 140). References: https://developer.chrome.com/docs/css-ui/view-transitions/element-scoped-view-transitions, https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API/Using_element-scoped, https://drafts.csswg.org/css-view-transitions-2/.

Not tried yet: Navigation API `intercept()` with a shader for single-page route changes; the experiments below on WebGPU.

## View transitions drawn by a canvas (`/scoped-transitions/`)

Measured in headless Chromium 157 (C157) on 2026-11-21, by the page's live checks and by screenshots taken part way through each transition. Built from the five items that were listed as not tried under the View Transitions API section above.

| Experiment | Result | Why |
|---|---|---|
| A WebGL canvas as the scope of `canvas.startViewTransition()`, with a vertex shader reading each tile's group as a clock | works | The canvas has `view-transition-name: none`. `texElementSubImage2D()` uploads the wrapper during the transition. Each tile is a 16 by 8 mesh that turns once, lifts and bends on `--vt-p`, and the fragment shader splits the colour channels along the direction of travel. CSS sets duration and easing. |
| Start a canvas-scoped transition while a transition on an ancestor is running | works with `view-transition-scope: all` on the canvas all the time | Without it the outer transition has taken the names inside the canvas, and the inner one is rejected with "Snapshot capture failed" and the console message "Element cannot participate in multiple transitions". |
| Canvas first, then its ancestor, or both in the same task | works without `view-transition-scope: all` | The outer transition skips the names of a scope that is already active. |
| `view-transition-class` on canvases, matched by `::view-transition-group(.class)` in a transition scoped to their list | works | One rule times five canvases. With the old snapshot hidden and the new one not animated, each canvas shows live and distorts its own row (24 horizontal strips drawn with the nine-argument `drawElementImage()`) while the browser moves it. |
| Draw a canvas child at the box of its `::view-transition-group()` in a document transition | works when the hit box is put back after each draw | The group has the right position and size at every frame. `updateElementGeometry()` returns the child's hit box to its destination after the draw. |
| The same without putting the hit box back | the group does not move | A 2D draw sets the child's position. The browser retargets the group to that position each frame, so the group stays where it started (20 px of 200 in the check). |
| One canvas draws every change of a small app from an `ElementImage` of the old state to the live new state | works | `captureElementImage()` is called in a `paint` handler before `canvas.startViewTransition()`. The picture stays drawable after the DOM changes and can be drawn in columns or bands. Three effects: columns fall and turn, bands close, a circle opens from the tap. |
| All thirteen contexts lost at once (the browser's GPU process killed from outside, at rest and 250 ms into a nested transition) | recovers | Every 2D canvas fires `contextlost` and then `contextrestored` within 2.5 s, `/shared/context-guard.js` asks for a paint, and `lib/element-gl.js` restores the WebGL canvas. The transition that was running reports that it ran. No note and no plain HTML fallback appeared. |
| A 2D canvas whose context does not come back (faked: `isContextLost()` forced to true, then a `contextlost` event) | shown as plain HTML after 2.5 s | `watch2d()` in `canvas-vt.js` calls the page, which takes the content out of the canvas and writes the context-guard summary in the status line. The buttons then make their changes without a transition. |

### Things that bit

- A row drawn in strips with a different source and destination height per strip came out as dots. Source and destination strip heights must be equal.
- A wave with a large phase range across the strips reads as a plain shear. A half sine across the row (ends fixed, middle bows) reads as a bend and keeps text legible.
- The old boxes and the old picture must be taken before `startViewTransition()`, because no `paint` event arrives while the update callback is pending.
- A clock inside a canvas repaints that canvas each time it ticks. The clocks now tick only when their canvas is in the viewport. With the jank guard's 4x CPU slowdown and software rendering the page reports 0.3 s of long tasks while loading (it was 7 to 12 s when every clock ticked).
- The page uses one WebGL context, through `lib/element-gl.js`. It has no `readPixels` call and no second context for the checks.
- 2D backing stores stop at 2 device pixels per CSS pixel (`MAX_SCALE` in `canvas-vt.js`). At a ratio of 2.625 the eight visible 2D canvases held 1.7 times the pixels.
- On an Android phone (Chrome 159, 2026-11-21, reported by the project owner) the 2D canvas of experiment 2 showed white with Chrome's broken-picture icon, which Chrome draws in a 2D canvas whose context is lost. Not reproduced here: killing the GPU process in headless Chromium 157 loses every context and all of them come back.

### Not verified

- Why the 2D canvas of experiment 2 lost its context on the phone, and whether the changes above stop it. If it happens again the status line under the experiment, or the note over the canvas, holds a line that starts "Contexts made:". That line says which contexts were lost and when.
- Whether a 2D drawable canvas on Android fires `contextlost` and `contextrestored` at all. If it does not, neither the guard nor `watch2d()` can act.
- Frame rate on a phone, and the WebGL experiment on a real GPU. Open `/scoped-transitions/` on the device and press Shuffle with "Run everything at 3 seconds" on.
- WebGPU. Experiment 1 uses WebGL only. A WGSL version through `shared/backend.js` would verify it.
- Touch selection and IME inside the app of experiment 5 during a transition.

### For the index

- View transitions: a transition scoped to a canvas works as a set of CSS-timed clocks for 2D and WebGL drawing (`/scoped-transitions/`, C157, measured).
- View transitions: `view-transition-scope: all` on a canvas is needed to start a canvas-scoped transition inside a running ancestor transition (`/scoped-transitions/`, C157, measured).
- View transitions: `view-transition-class` matches canvases in a scoped transition (`/scoped-transitions/`, C157, measured).
- Hit testing: drawing a canvas child at its transition group box retargets the group unless `updateElementGeometry()` puts the hit box back (`/scoped-transitions/`, C157, measured).
- Snapshots: an `ElementImage` taken before a DOM change is a usable old state for a transition drawn by the canvas (`/scoped-transitions/`, C157, measured).

### Open ideas

- A library element, for example `<canvas-transition>`, that wraps experiment 5: any DOM change inside it is drawn by a chosen effect.
- The same clock driving a WebGPU shader, and effects that use both the old `ElementImage` and the live state as textures.
- Navigation API `intercept()` calling the function of experiment 5 for route changes.
