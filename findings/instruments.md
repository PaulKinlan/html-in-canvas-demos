# Form controls drawn as instruments (`/instruments/`)

Five ideas from the element catalogue (group 1 of the backlog in PLAN.md). Measured in headless Chromium 157 (C157) on 2026-11-21 with a mouse, a keyboard and emulated touch at 412 px wide. The page's eight live checks pass there, and `node tools/instruments/check.mjs` drives the five demos with real input (17 steps, all pass). The first version of the page lost its canvases on Chrome 159 on Android (A159, reported 2026-11-21). See "Lost canvases on the phone" below.

| Experiment | Result | Why |
|---|---|---|
| Rotary switch: five `<label drawable>` of one radio group, each drawn rotated round a knob. The form and fieldset are not drawn | works | A tap on a drawn label checks its radio. Arrow keys move the checked radio and the focus. `FormData` holds one value. The knob has no state: it reads which radio is checked. |
| A drag handle for a shape that is only canvas pixels (the knob, the clock face) | works | A round `drawable` element that is only a faint ring is drawn over it. It gets the pointer events. Its `touch-action: none` applies at the drawn place: a touch drag there scrolled the page by 0 px, and a swipe elsewhere on the same canvas (`touch-action: pan-y`) scrolled it by 150 px. |
| Odometer: `<input type="number">` with transparent text over digit wheels drawn by the canvas | works | The transparent input adds no pixels (live check). It still draws its caret and selection. `letter-spacing` set to wheel width minus the digit advance puts each character over its wheel. Typing, ArrowUp and select-all work in the field. |
| Rolling the digits from the element's own picture | not possible | When the value changes, the picture of the old value is gone, and an `ElementImage` can only be kept for the same canvas frame. The wheels are drawn with `fillText()` in the input's font. |
| Focus ring on a drawn input | drawn by the canvas | An `outline` is outside the border box, and the picture ends at the border box. The odometer strokes its case from `input.matches(':focus-visible')`. The radio labels use a border and an inset shadow. |
| `stepUp()` on a drawn number input | `paint`, no `input` event | The canvas redraws by itself. The line of text under the demo has to be updated by the caller. |
| Prism: one form, three `<fieldset drawable>`, a 2D context | works | Each face is 28 vertical strips while it turns, each one clipped `drawElementImage()` with its own x and y scale. At rest the front face is one flat draw, which sets the hit region. A field is then found at its flat place to 0.0 px (live check). |
| Browser validation on a face of the prism | works | `reportValidity()` after Next, and the submit button with a box unchecked, showed the browser's message pointing at the field where it was drawn (seen in screenshots, C157 headless). `:invalid` styles are in the picture. |
| `inert` on the faces that are turned away | drawn, submitted, validated, not hit | An inert fieldset is drawn. `elementFromPoint()` returns the canvas at its place. Its fields are in `FormData` and still fail `checkValidity()` with an `invalid` event. |
| Submit while an invalid field is on an inert face | handled by the page | The browser raises `invalid` on every invalid field and cannot focus an inert one. The page cancels those events, turns to the face of the first one and focuses it after the turn. |
| Enter in a text field on face 1 | submits | Implicit submission goes through the form's submit button, which is on the inert third face. With later fields empty the prism turns to the first of them. |
| Gauge: one `<meter>` drawn in 100 slices round a 240 degree arc | works | Each slice is a clipped draw, rotated to its angle and stretched 1.5 times along the arc. The slices carry the colour the browser picks from `low`, `high` and `optimum`: rgb 16,124,16 at the optimum, 216,59,1 two regions away (live check). Setting `value` or `optimum` raises `paint`. |
| Clock: `<input type="time">` under a drawn face, hands dragged | works | The page reads `valueAsNumber` and writes `value` plus an `input` event during a drag. The minute hand carries into the hour past 12. Typing in the field moves the hands through every minute in between. |

## Lost canvases on the phone

Reported from Chrome 159 on Android on 2026-11-21, on the preview of the first version: the rotary canvas as a white box with the broken-picture icon, then a white screen, then an empty canvas, repeatedly. The page has no WebGL or WebGPU context. Headless Chromium 157 with software rendering does not lose a context.

Cause, reported on 2026-11-21 at 19:30 UTC by the thread that tested on the phone (pull request #84, `public/crashes/cases.js`): a drawable 2D canvas created with `willReadFrequently: true`, once drawn into and read, loses every 2D context on the page about every half second. The first version's live checks made such canvases on load. The second commit of this page had already removed them. The other rows of the table below were suspects only.

What the first version did that the pages reported as working on the phone do not, all removed:

| Removed | Why it was a suspect |
|---|---|
| Live checks that ran on load | Eight fixture canvases made and removed in the first seconds, beside the demo. The guidance for new pages is to keep checks behind a tap. The page now has `<meta name="checks" content="tap">`. |
| Fixture canvases made with `willReadFrequently: true` (the cause, see above) | That asks for a canvas kept in main memory, and `drawElementImage()` then has to bring an element picture back from the GPU. Checks now read from a small `drawImage()` copy. |
| `drawElementImage()` with `globalAlpha = 0` of an element with no content (the drag handles) | An empty picture, drawn every frame. The handles are now a faint ring, drawn normally. |
| An input whose picture is completely transparent (the odometer) | The same. It has a faint bottom border now. |
| `shadowBlur` on canvas fills | Not used by the other 2D pages. Replaced with plain fills. |
| Demos started 300 px before they reach the screen | Two canvases were drawing at load. The margin is 100 px. |

What the page now does when a context is lost: the first `contextlost` on any of the five canvases stops all five, moves their controls out into plain HTML where the canvas was, prints `window.__gfx.summary()` under them, and sets a `sessionStorage` flag so that a reload starts as plain HTML. A button clears the flag. Tested by dispatching `contextlost` on one canvas: all five show plain controls and each demo still reports its form value.

## Things that bit

- `canvas { display: block }` in a page's styles beats the `hidden` attribute, so a hidden canvas stayed on screen as an empty box until the rule was written for `:not([hidden])`.
- `click()` on a `<label>` moves focus to its radio. A live check that did that failed the jank guard (`focusMoves 1`). The check now calls `click()` on the radio found by `elementFromPoint()`.
- One submit raises `invalid` once for every invalid field. Turning the prism on each event ended on the last invalid face. The first event in a task decides.
- Shading each strip of a turned face separately left dark seams where strips overlap by half a pixel. The shade is now one fill over the outline of the face.
- `offsetLeft` of a field in a fieldset is measured from the fieldset's padding edge, so a check that compares drawn and layout positions has to add `clientLeft`.
- The fixed `<output>` under a demo needs room for its longest text, or the page below moves when the form is submitted.

## Not verified

- Chrome 159 on Android: whether this version keeps its canvases. If one is lost, the line under the plain controls says which contexts were made and lost.
- Chrome 159 on Android: the five demos by touch. `node tools/instruments/check.mjs` covers touch only through CDP events.
- Whether a tap on the drawn time input opens the Android time dialog, and where. Open `/instruments/#clock` and tap the field.
- The on-screen keyboard over the odometer and the prism, and whether the canvas stays in view. Tap the wheels.
- Where Android shows the validation message for a field on the prism. Press Next with the name empty.
- The speed of 56 strip draws per frame (prism) and 101 draws per frame (gauge with "Wander") on a phone GPU.
- A screen reader on any of the five.

## For the index

- Backlog: ideas 1.1 to 1.5 of the PLAN.md backlog are built on `/instruments/` (element catalogue: "Rotary switch from a radio group", "Odometer for a number input", "Form on a prism, one fieldset per face", "Dial gauge from a meter", "Clock hands from a time input"). `public/elements/ideas.js` does not mark them as built yet.
- Hit testing: `touch-action` on a drawable element applies at the place it was drawn (measured with CDP touch, C157, `/instruments/`).
- Pages that hold still: `/instruments/` lost its 2D canvases repeatedly on the phone in its first version, with no WebGL context on the page (reported, A159). Cause unknown.
- Elements: an `outline` is not in an element's picture (measured, C157, `/instruments/`).
- Forms: an `inert` drawable fieldset is drawn, submitted and validated, and is not returned by `elementFromPoint()` (measured, C157, `/instruments/`).
- Forms: the browser's validation message points at the drawn position of a field (seen in a screenshot, C157 headless, `/instruments/`).
- Paint events: `stepUp()`, `meter.value` and a time input's `value` set from script each raise `paint` with no `requestPaint()` (measured, C157, `/instruments/`).

## Open ideas

- Wheel taps: tap the top or bottom half of one odometer wheel to step that digit.
- The prism on WebGL through `lib/element-gl.js` with `updateElementGeometry()` and a perspective matrix, so the faces take input during the turn.
- A second hand on the clock from `step="1"`, and a 24 hour dial.
