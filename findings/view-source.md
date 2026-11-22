# Peel a page back to read its source (`/view-source/`, `/view-dom/`, `lib/page-peel.js`)

Results are measured in C157 (headless Chromium 157, software rendering, 412 px wide with touch, and 1280 px wide) on 2026-11-22, by the page's live checks and by Playwright scripts that sent touch events through CDP. Nothing here was run on A159.

## What was built

Two pages with the same peel. On each, the whole page is a scrolling box that the fx library draws through the effect `page-peel` (GLSL and WGSL in `lib/page-peel.js`). Dragging the top right corner rolls the page back.

- `/view-source/`: under the page is its HTML as the server sent it (a second `fetch()` of the page, read from the response stream).
- `/view-dom/`: under the page is its DOM as it is now (`getHTML()` of the document, rewritten when a `MutationObserver` reports a change).

The layer under the page holds numbered lines of source and nothing else: no bar, tabs or buttons. The first version was one page with a header and two tabs in that layer. The owner asked for two pages that show only the code (2026-11-22). The numbers that the bar used to show (bytes and chunks, counts of changes) are in a card in the page itself. On `/view-dom/` that card is left out of the counts, or it would count its own updates, and it is not written while the page is peeled: its numbers were six changed lines in the live text after every change, and the text scrolled to them and not to what the reader had changed.

Taking the page off leaves it as a roll in the bottom left corner. Pressing the roll puts the page back, so the source layer needs no button for that.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Can one canvas draw a whole scrolling page? | Yes, measured. | `#sheet` is `overflow-y: auto` at the height of the window below the menu. It is slotted into `<fx-surface>`. Touch, wheel and `scrollTop` scroll it, each raises a `paint` event and a new frame, and `elementFromPoint()` finds elements at their scrolled positions. |
| How large is the canvas? | 2.24 MP at 412 px and scale 2.625. 28.3 MB in all canvases (jank guard). | The canvas is one screen, not the length of the page. |
| Can input pass through the transparent part of a shaded canvas? | Not by itself. Yes with `clip-path` on the canvas host. | Transparent pixels still hit the drawn element. `peelOutline()` repeats the shader's arithmetic and gives a polygon. With it on `<fx-surface>`, `elementFromPoint()` returns the layer below, and a touch swipe there scrolled the source layer and left the page where it was. |
| Does the script outline agree with the shader? | Yes, measured: 459 of 459 grid points. | Points within 2 px of the roll were left out. |
| Does the page under the peeled paper take taps on the paper? | It would. A handle element with the paper's outline (`clip-path`) covers it. | The paper lying on the page is pixels only. |
| Does a drawable canvas inside the drawn page work? | Yes, measured. | Its pixels are in the outer picture and its button took a touch tap. It has `contain: paint` (see `findings/media-tiles.md`). |
| Is the WGSL the same picture as the GLSL? | Yes, measured off screen: mean difference 0.08 of 255 per channel. | Software WebGPU adapter, drawn into a texture (`sameOnWebGPU()`). |
| Is the fetched HTML what the page was parsed from? | Same byte count in the test (the navigation entry's `decodedBodySize`). The text itself cannot be compared. | The first response cannot be read again from script. |
| How many chunks does the stream arrive in? | 1 from the local test server (23 kB). | Not verified for the deployed Worker. |
| Does `getHTML()` show the canvas that draws the page? | Yes with `{ shadowRoots: [surface.shadowRoot] }`. `outerHTML` shows none of it. | `/view-dom/` passes the root of `<fx-surface>` and not the root of the source layer. |
| Does the live text follow the page? | Attributes, text and children: yes. `value` and `checked` properties: no, until copied to attributes. | Measured by a live check with a text field. |
| What does a `MutationObserver` report for `textContent = …`? | A `childList` record, not `characterData`. | The clock's changes are counted under "lists of children". |
| Does the source view report its own updates? | No: it is in a shadow root. | Measured: two changes inside a shadow root gave no record on a document observer. |
| Without the API, or after a lost canvas? | The same `clip-path` goes on the page itself: the corner is cut along a straight line. | Measured with `--disable-blink-features=CanvasDrawElement` and by calling `fallBackToPlain()`. |

## Things that bit

- The handle's round button sits on the paper's corner. Two checks that probed that point got the button and not what they expected. The checks probe other points.
- A check that looked for a typed value in the serialised document found it, because the text of the check's own script is in the document. The value is now made at run time.
- A check that counted `MutationObserver` records on the document counted the page's clock. It counts only records about its fixture.
- `--fx-x` and `--fx-y` are registered as inherited properties by the fx library. Setting them on `#sheet` on every frame of a drag would restyle every element of the page, so `#sheet > *` sets both to 0. The saving was not measured.
- Nothing inside the page may change while the corner is held: any change makes the canvas take a new picture of the whole page. The status line is written when the paper stops.
- On a wide window the first pose uncovered the left of the source layer last, where every line starts. The source keeps to a 500 px column on the right until the page is off.
- A fixed, full-screen box would count as an overlay in the jank guard. The page uses a box in normal flow and `overflow: hidden` on the document.
- When the window changes height the canvas changes size and is cleared. The library draws it again on the next animation frame, so for one frame the layer under the page showed through all of it (jank guard: `blankFrames 1` on `/view-dom/`; on `/view-source/` the same frame showed the source text and was not counted as blank). The pages set the surface's `resized` hook to call `render()` in the same frame. Measured after: 0 blank frames on both.
- On `/view-dom/` the text scrolls to the first changed line, and the clock changes every second. The text keeps still for five seconds after the reader scrolls it.

## Not verified

- A159: everything. In particular the WebGPU route on a screen (the test browser has no adapter that can present), the frame rate while the paper is dragged and while the page scrolls (the page writes both under "Findings" after each movement), touch selection handles in the source layer, and the on-screen keyboard over a document that does not scroll.
- How many chunks the deployed Worker sends, and whether the second response has the same bytes as the first there. The page reports both.
- The `shared` route (2D canvas through one WebGL context) at 2.24 MP on a phone GPU. In the test browser it ran in software.

## Open ideas

- A third page that shows only the lines that differ between the two sources.
- Read the first response itself with a service worker that tees the navigation response.
- Draw the source layer in the same canvas as a second texture, so the shader can light it.

## For the index

- Input, hit testing: transparent pixels of a shaded canvas still take input. `clip-path` on the canvas host hands input to what is behind (`/view-source/`, measured C157).
- Layout: a scrolling box as the drawable content keeps the canvas at one screen for a page of any length (`/view-source/`, measured C157).
- Serialisation: `getHTML({ shadowRoots })` writes the drawing canvas of a wrapped element, `outerHTML` does not (`/view-source/`, measured C157).

## API requests

- A way for a drawn element to say that a region of its canvas is not its own for input, without CSS clipping of the host.
