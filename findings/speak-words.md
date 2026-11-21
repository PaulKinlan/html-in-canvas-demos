# Words highlighted as they are spoken (`/speak-words/`)

Chromium 157 headless (C157), 2026-11-21. The test browser has no voices: `speechSynthesis.getVoices()` is empty and `speak()` ends with the error `synthesis-failed`. Boundary events were therefore dispatched by hand (`new SpeechSynthesisEvent('boundary', …)` on the utterance) for every measured row. Real speech is not verified.

| Experiment | Result | Notes |
| --- | --- | --- |
| `boundary` event to a word | works | `charIndex` and `charLength` give the range. Without `charLength` the end of the word is read from the text. Events named `sentence` are counted and not drawn. |
| Word to rectangle | works | A `Range` over the word, `getClientRects()`, made relative to the article and divided by the drawn scale. |
| Spotlight on the word | works | 315 highlight pixels on the word, 0 on another word. The rectangle moves 35% of the way to the new word per frame and jumps when the line changes. |
| Spoken words at full ink, later words faint | works | The article is drawn at 32% opacity, then again through a clip made of the rectangles of the spoken range. Darkest red value 29 in a spoken word, 182 in a later one. |
| Magnified copy of the word (nine-argument `drawElementImage()`) | works | Source rectangle is the word, destination is 1.7 times larger. |
| Hit testing after that partial draw | wrong without a fix, right with it | After the nine-argument call, `elementFromPoint()` at another word returned the canvas: the call maps the whole element's hit box through the word's source-to-destination mapping. One more full-size `drawElementImage()` inside an empty clip (`rect(0, 0, 0, 0)`) draws no pixels and puts the hit box back. |
| `document.caretPositionFromPoint()` on a drawn paragraph | works | Returned the text node and offset 31, inside "seven". A tap on a word starts a new utterance from that word. |
| CSS Custom Highlights on the same ranges | in the element's picture | `::highlight(spoken-word)` gave 501 highlight pixels with one draw call and no other canvas work. |
| No boundary events | stepped by a timer | If no boundary event arrives within 0.7 s of `start`, or the utterance fails, words are stepped from an estimate (0.17 s plus 0.052 s per letter, divided by the rate). The page says which source is in use. |

## Things that bit

- A `filter: invert(1)` set on the context for the sweep effect produced a blue block. The sweep now fills a band and draws the text over it.
- The first version of the timer check ran at rate 8, where every word falls before the 0.7 s wait and nothing was stepped.
- The article's height sets the canvas's height. It is read once on load and again from a `ResizeObserver`, and assigned only when it changed.

## Not verified

- Whether the voices of Chrome 159 on Android fire `boundary` events at all, whether they carry `charLength`, and how far the events lead or trail the sound. Press Speak on the phone: the line under the buttons shows the time to `start`, the number of boundary events and the number with `charLength`. The last live check does the same with three words at zero volume.
- Whether an utterance at zero volume still fires boundary events.
- Long texts. Desktop Chrome has stopped network voices after about 15 s in the past (reported, not measured here).

## For the index

- Hit testing: a nine-argument `drawElementImage()` moves the whole element's hit box. A following full-size draw in an empty clip restores it without drawing. measured, C157, `/speak-words/` and `/cassette/`.
- Text: `caretPositionFromPoint()` works on an element drawn in a canvas. measured, C157, `/speak-words/`.
- Speech: headless C157 has no voices, `speak()` fails with `synthesis-failed`. measured, C157, `/speak-words/`.

## API requests

- A way to draw part of an element without moving its hit box, for example an option on `drawElementImage()`. Today the last draw call decides the hit box even when it is a detail view.

## Open ideas

- The same reader over `<selection-fx highlight="spoken-word">`, to use its shader effects.
- Speech marks (`<mark>` in SSML) as triggers for effects on other elements.
