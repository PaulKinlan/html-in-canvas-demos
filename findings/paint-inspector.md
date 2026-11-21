# Paint event inspector (`/paint-inspector/`, `lib/devtools/paint-inspector.js`)

Measured in headless Chromium 157 (C157) with software rendering on 2026-11-21, 60 Hz frame clock. Counts are events whose `changedElements` held the element.

| Change | Events | Detail |
|---|---|---|
| `background-color` animation on a drawable element | every frame | 30 in 0.5 s. |
| Transform animation on a descendant of a drawable element | every frame | 30 in 0.5 s. The event names the drawable ancestor. |
| `<marquee>` | every frame | 30 in 0.5 s. |
| Playing 30 fps video | one per video frame | 30 events in 1 s, and `getVideoPlaybackQuality()` reported 30 frames. |
| `<progress>` with no value | 8 a second | |
| Caret of a focused text field | 2 a second | 4 events in 1.6 s including the focus ring. |
| Text set by script | 1 per change | The neighbour was not named. |
| Transform animation on the drawable element itself | none | The picture is the element before its own transform. 0 paint events arrived at all. |
| Opacity animation on the drawable element itself | none | Same. |
| An element that does not change | named once, for its first picture | Not named again. |
| A listener added 300 ms after the element was put in the canvas | first event lists no elements | `requestPaint()` raised the event. The first mention of the element was lost. |
| A paint listener that draws nothing | events keep arriving | 30 in 0.5 s. |

## Things that bit

- A `<progress>` styled as a 60 px tall tile (the tile class sets a background, padding and `overflow: hidden`) drew as a flat grey box with no animation, and its count stayed at 2. The page now puts an unstyled `<progress>` inside a drawable `<div>`.
- After the checks finished, every tile was named once more at the same moment. The cause was not looked for. It reads as a repaint of the whole canvas content.

## Not verified

- The rates on a phone (90 or 120 Hz frame clock, hardware video decoding). Open the page on the phone and read the labels.
- Hover: a touch screen has none, so the button tile is named on press and focus only.

## For the index

- The canvas, the attributes and the paint event: a transform or opacity animation on the drawable element itself raises no paint event, while the same animation on a descendant raises one per frame that names the drawable ancestor (measured, C157, `/paint-inspector/`).
- The canvas, the attributes and the paint event: an element is named in `changedElements` once for its first picture; a listener added after that sees an empty list from `requestPaint()` (measured, C157, `/paint-inspector/`).
- The canvas, the attributes and the paint event: rates per second at 60 Hz: background animation and `<marquee>` 60, 30 fps video 30, indeterminate `<progress>` 8, caret 2 (measured, software rendering, C157, `/paint-inspector/`).
- Ideas built: "Paint event inspector" (`ELEMENTS.md`, rank 2, tools).
