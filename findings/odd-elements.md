# Old and odd elements: font, marquee, xmp, blink, a foreign iframe and a footer (`/odd-elements/`)

Backlog group 28 in PLAN.md, ideas 28.17, 28.21, 28.23, 28.24 and 28.28. Measured in headless Chromium 157 (C157) on 2026-11-22 at 412 px wide. The page's five live checks pass there, and `node tools/odd-elements/check.mjs` drives the five demos by touch (25 steps, all pass). Nothing here has been run on a phone.

The question: what does a canvas get from elements at the edges of HTML, and what does it have to find out another way?

| Experiment | Result | Why |
|---|---|---|
| Three frames of 90 by 50 px with solid backgrounds in one drawable block: `srcdoc`, a `data:` URL, a sandboxed `srcdoc`. One pixel inside each, read from a `drawImage()` copy | this origin: 255, 0, 0, alpha 255. `data:` frame: alpha 0. Sandboxed frame: alpha 0 | A frame whose origin differs is left out of the picture. An opaque origin counts. |
| `elementFromPoint()` inside each of the three | the frame, 3 of 3 | The empty box still takes input. In the demo one touch tap on each pressed the button inside (a `postMessage` from the frame). |
| `contentDocument` of each | a document, null, null | How Warn about invisible frames (28.21) finds them with no readback. It hatches the rectangle and counts the taps the frame took. |
| Interfaces and widths in a drawable block | blink, applet, spacer: `HTMLUnknownElement`, 36, 47, 52 px. my-badge, center, big, tt, nobr, acronym: `HTMLElement`. font: `HTMLFontElement`. xmp: `HTMLPreElement`. marquee: `HTMLMarqueeElement` | Unknown elements in a design system audit (28.23) outlines 3 unknown, 2 undefined custom and 4 obsolete elements in its paragraph as a line passes down it. |
| A marquee (`scrollamount="5"`, default delay) inside a drawable block | 120 paint events in two seconds; `changedElements` named the block in 120 | Old web page in a drawn monitor (28.28) uses those events as its only clock. It draws the block once, copies the pixels with `drawImage()`, and cuts the copy into 11 strips with a bulge, a `lighter` copy for the glow, lines and a shadow, 12 times a second. |
| A tap on the button of the page on the tube; the same place with the power off | the count on the page went from 000042 to 000043; with the power off the element there is the canvas | The page is placed flat on the screen with a clipped-away draw, and parked with the power off. |
| An `xmp` with `contenteditable="plaintext-only"` | `textContent` is the markup, 0 child elements, editable; a `Range` over `<b>` gives 1 rectangle, 25 by 16 px | xmp as a literal code sample (28.24): 12 tags coloured by the canvas under the element's picture, and the same text parsed into a second element. |
| Typing `<u>new</u>` and then an `img` with `onerror` and a `script` into the xmp | 14 tags, the copy gained a `u`; neither script ran | The text is parsed in a `DOMParser` document, and script-like elements, `on*` attributes and `javascript:` links are removed before it is moved into the page. |
| `updateElementGeometry()` with a matrix that has a perspective row, on a 2D canvas | a button was found at its projected place (150, 132); the place it was drawn flat gave the canvas | Footer that is the floor (28.17): links on the footer answered at 46 and at 20 degrees of tilt, and the button of a sign standing on it. |
| A lost context | plain HTML | One `contextlost` event stops the five canvases and shows the elements as plain HTML (5 boxes). Tested by dispatching the event. |

## Things that bit

- `setHTML()` removed the `button` from the typed markup, so the copy had 5 elements where the text has 6. The page parses with `DOMParser` and removes what can run.
- Ten draws of the old page on each of 60 paint events a second, one with `blur(3px)`, gave 10.4 s of long tasks in a six-second run of `check:jank` (software rendering, scale 2.625). Without the blur it was 3.2 s. `scrolldelay="200" truespeed` did not lower the rate of paint events. The demo now draws the block once per frame at 12 frames a second and builds the tube from a `drawImage()` copy: 2.8 s.
- The page first said the marquee steps about 12 times a second, from its default delay of 85 ms. The check counted 60 paint events a second.
- The floor's strips showed dark seams with a clip 0.6 px deeper than the strip. The clip is now 2 px deeper.
- At 58 degrees the far half of the footer was unreadable at 412 px. The slider starts at 46 and stops at 66.

## Not verified

- Chrome 159 on Android: the five demos by touch.
- A frame from a second real site. Such a frame can be in another process. The two foreign frames here are in this process with an opaque origin.
- The cost of the monitor on a phone. The long tasks left in the test browser (2.8 s in six) have not been traced further.
- Typing into the `xmp` with an on-screen keyboard, and whether `plaintext-only` keeps one text node there.
- A screen reader on the slanted footer.

## For the index

- Frames: a `data:` URL frame and a sandboxed `srcdoc` frame are left out of a drawable element's picture (alpha 0) and still take input; `contentDocument` is null for both. C157, `/odd-elements/`.
- Elements: `HTMLUnknownElement` names (blink, applet, spacer) and obsolete elements (center, font, big, tt, nobr, acronym, marquee, xmp) all have boxes and are in the picture.
- Paint: a marquee nested in a drawable block raises 60 paint events a second naming the block, whatever its `scrolldelay`.
- Cost: several clipped draws of one element per frame each rasterise it again in software; one flat draw plus `drawImage()` copies into a plain canvas is cheaper and involves no readback.
- Geometry: `updateElementGeometry()` accepts a perspective matrix on a 2D canvas and hit testing follows it (also seen on `/select-selection/` and `/video-lab/`).
- Backlog: ideas 28.17, 28.21, 28.23, 28.24 and 28.28 are built on `/odd-elements/`.
