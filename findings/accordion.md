# Accordion from `<details>` (`/accordion/`)

Measured in C157 (headless shell, 412 px wide, touch emulation) on 2026-11-21. Not yet run on A159.

| Question | Result | Notes |
|---|---|---|
| `<details drawable>` in both states | works | Closed, `offsetHeight` and the picture are the summary only. |
| Get the open picture of a closed `<details>` | only from a snapshot | `captureElementImage()` taken while it was open still draws the content after it has closed. |
| Draw the content of a closed `<details>` on its own (content element has `drawable`) | fails | `drawElementImage()` throws `InvalidStateError`: "No cached paint record for element". The content has no box while closed. |
| Opening one `<details name>` closes the other | synchronously | `a.open` is false in the same task as `b.open = true`. One `paint` event shows both changes, so both animations start on the same frame. The page gets no event before the close. |
| Detect the change | compare `open` on each paint | The `toggle` event is a later task. The first paint after the change already has the new layout. |
| Part of an element drawn clipped under a shear, several times a frame | works | Six strips of the content, each one clip plus `transform(1, 0, shear, squash, 0, 0)` plus `drawElementImage()`. |
| Where input goes during the fold | last draw | The page ends each frame with a draw at `globalAlpha = 0` at the resting position. Controls in the opening section work during the fold. |
| A summary drawn away from its layout position | works | `elementFromPoint()` and real taps reach it. |
| CSS route: `interpolate-size: allow-keywords` and a height transition on `::details-content`, canvas only redraws | works | 19 `paint` events with 19 different heights in a 0.3 s transition in a check fixture. |

## Things that bit

- The layout jumps at once when a section opens, so `offsetTop` of the sections below is no use during the animation. The page stacks the sections itself with an animated height for each.
- A check that added the CSS-route rules in a `<style>` element just before opening saw no transition (two heights). With the rules in the page's stylesheet from the start it runs.

## Not verified

- Frame rate of the fold on a phone.
- What a screen reader announces during the fold. The elements and their states are the native ones.
- Find-in-page opening a closed section (`hidden=until-found` behaviour of `<details>`), which would also change `open` without warning. The paint-time comparison should cover it. Searching the page for a word in a closed section would verify it.

## For the index

- Drawing elements: The open picture of a closed `<details>` is available only as a `captureElementImage()` snapshot taken while it was open. A nested drawable content element throws "No cached paint record" while closed. measured, C157, `/accordion/`.
- Transitions and motion: A CSS height transition on `::details-content` raises a `paint` event for each frame, so the browser can animate an accordion that a canvas draws. measured, C157, `/accordion/`.

## Ideas built

- "Accordion that unfolds" from `public/elements/ideas.js` (structure).
