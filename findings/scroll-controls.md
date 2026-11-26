# Scroll areas drawn over scroll containers, a range and details (`/scroll-controls/`, `lib/ui-feed/scrolls.js`)

Measured in C157 (the headless test browser, software rendering) on 2026-11-25, at 412 px wide and on an emulated Pixel 7 for the touch rows. Nothing here has been run on a phone.

The page rebuilds five more demos from <https://ui-feed.dev/> as custom elements on the base class in `lib/ui-feed/kit.js`. Earlier ones are in [list-controls.md](list-controls.md) and the files it lists. I looked at what each published demo does and built it again. No source, picture or font was taken from the originals, which are far higher fidelity than these.

## Which native element each one is

| Control | Original on ui-feed.dev | Native elements under the drawing |
|---|---|---|
| `<paint-chart>` | paint chart (scroll area) | a `<div>` scroll container with an `<ol>` of colours, and an empty `<div>` for the thumb |
| `<track-scroll>` | dragging the thumb (scroll area) | a `<div>` scroll container with an `<ol>` of tracks, an `inert`, `aria-hidden` copy of the rows on black, and an empty `<div>` for the thumb |
| `<bank-statement>` | account statement (scroll area) | a `<header>`, a scroll container with a `<section>` a day, a `position: sticky` `<h4>`, `<data>` for each amount and `<output>` for each balance |
| `<seismo-split>` | seismograph event list (resizable) | an `<input type="range">` as the split bar, a scroll container holding a `<table>` of events |
| `<lp-order>` | LP running order (waterfall) | a `<details>` for each side, with an `<ol>` of tracks |

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does a scroll container drawn squashed still scroll and take the pointer? | measured: yes | Scrolled 200 units, `elementFromPoint` found the container over the squashed stack and over the list, because a last alpha-0 draw at its real size puts the hit region back. |
| Can a drawn thumb drag a scroll container? | measured: yes | A drag of 60 units scrolled 104 (104 expected for 402 of scroll over 232 of travel), and the thumb's hit region followed. By touch, a drag of 80 scrolled to 428. |
| Can rows level with a held thumb be drawn from a second copy? | measured: yes | The band spring was 0.25 open 60 ms after the press, 1.00 after 500 ms, and 0.00 700 ms after letting go. A drag of 100 scrolled 229 (229 expected). |
| Does `position: sticky` work in a scroll container in a canvas? | measured: yes | Scrolled 220 units, the heading at the container's top edge was the sticky one for the rows under it. The container grew from 248 to 320 units as the big heading was drawn away. |
| Can a range input be the bar of a split? | measured: yes | Value and table height: 96 and 182, 88 and 190 after ArrowUp, 128 and 150 after Page Down, 60 and 218 after a drag of 300 up (the min). By touch, a drag of 60 up gave 60 and 218. |
| Can a details open over time with the side below following the drawing? | measured: yes | 250 ms after the click side A was drawn 52% open. At 750 ms side B's summary took the pointer three rows lower and not where it had been. |
| Do touches work? | measured: yes (emulated Pixel 7, CDP touch events) | A swipe scrolled the paint chart to 165, the tracks to 364 and the statement to 135 (container 320 tall). Taps opened both sides of the record. A vertical swipe on the record scrolled the page by 165 px. |
| Does the plain fallback work? | measured: yes | After a `contextlost` event and 1.5 s the list was a plain scroll container of 12 rows with the copy and thumb hidden, and it scrolled. |
| Do the controls stop painting? | measured: yes, except the clock | 0 paint events in 500 ms at rest for four. The seismograph had 1 or 2, from its clock, which ticks once a second while it is on screen. |

## Things that bit

- A thumb `<div>` with no height had no hit region, though it was drawn with a height: the first drag fell through to the list.
- `setPointerCapture?.()` still throws for a pointer made by a script, because the method exists. The controls catch it.
- Writing the clock's text in every draw raised a paint event every frame, a loop of 31 paints in 500 ms. It is written only when the second changes.
- The rows of the paint chart wrapped "No. 09" under "Swimming Pool" until `white-space: nowrap`.
- As plain HTML the component's rules are gone, so the scroll containers lost their height and didn't scroll. They get a `max-height` on `feed-plain`.

## Not verified

- Everything on a phone, including a fling on the scroll containers and whether the drawn thumbs keep up with a finger.
- What a screen reader says for the containers (`role="region"` with a label), and for a range used as a split.
- The fonts. The originals use a display serif, a grotesque and a terminal font that the test browser didn't have.

## For the index

- `/scroll-controls/`: five ui-feed.dev demos rebuilt on scroll containers, a range input and details (paint chart, dragging the thumb, account statement, seismograph, LP running order).
- A scroll container in a canvas scrolls itself and raises paint; it can be drawn several times and bent, as long as the last draw (alpha 0) puts its hit region back.
- `position: sticky` works inside a scroll container that is a drawable child.
- An element drawn only to take input (an alpha-0 hit draw) needs a size of its own; with zero height it takes no pointer.
