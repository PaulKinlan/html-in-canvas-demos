# Cassette deck from audio controls (`/cassette/`)

Measured in Chromium 157 headless (C157), 2026-11-21, with emulated touch at 412 px. The sound is `public/cassette/tape.webm`, made by `tools/cassette/make.sh`.

| Experiment | Result | Notes |
| --- | --- | --- |
| `display: grid` on `::-webkit-media-controls-panel` of an `<audio controls>` element | works | With `grid-row` and `grid-column` on the play button, the timeline, both time displays and the volume container. The play button filled its 80×72 cell exactly (found by filling it with magenta for one paint). |
| Size, font and colour on the parts | works | The current time display is drawn at 28 px in a monospace font. `filter: invert(1)` on the timeline makes the dark track light. `accent-color` on the timeline had no visible effect here. |
| An audio element 290 px tall | works | `max-height: none; height: 100%` on `::-webkit-media-controls-enclosure` lets the panel fill it. |
| Pieces of the element with the nine-argument `drawElementImage()` | works | Timeline row as laid out, counter row with a shadow glow, key cells 4 px lower while down, and the play glyph copied onto the cassette label at twice the size. |
| The browser's glyph as a state display | works | 1482 label pixels changed on `play()` and 0 differed after `pause()`. No state code draws it. |
| Hit testing after the partial draws | right with the restoring draw | With a final full-size draw inside an empty clip, the play key, mute key and timeline answered `<audio>`. Without it they did not. |
| Which element is on top for hits | the one drawn last | The audio element's box covers the deck. When its restoring draw came after the Rewind and Forward buttons, taps on them went to the audio element. Drawing the buttons afterwards fixed it. |
| Real touch on the drawn play key and timeline (test driver) | works | Playback started, the key was drawn down, the label showed the pause glyph, and a tap on the timeline moved `currentTime` to 19.1 s. A live check cannot produce trusted input, so this is not a row in the page's table. |
| Reels and counter from `currentTime` | works | Tape pixels on the left reel went from 2775 at 6 s to 1060 at 18 s. The shown position eases towards `currentTime`, so a seek winds the reels. |
| `AnalyserNode` on `audio.captureStream()` | works | Levels read while the muted fixture kept playing. The element's own output is not rerouted, so a suspended `AudioContext` costs only the meters. |
| The overflow button | cannot be placed | Its only name is `::-internal-media-controls-overflow-button`. `controlslist="nodownload noplaybackrate"` empties its menu and the browser leaves the button out. |

## Things that bit

- The timeline is 32 px wide in a grid cell until it is given `justify-self: stretch; width: auto; min-width: 0`.
- An unplaced overflow button was put in the first free grid cell, over the cassette, where it took taps without being drawn.
- The reels need frames while the tape plays. `paint` fires only about four times a second from the timeline's own repaint, so a `requestAnimationFrame` loop asks for paints while the audio is playing or the reels are still winding, and stops otherwise.

## Not verified

- The touch layout of audio controls in Chrome 159 on Android: part sizes, and whether the same parts exist. The first live check reports where the play button is.
- Sound output, and `audio.captureStream()` on Android.
- The volume slider is hidden. Mute is the only volume control on the deck.

## For the index

- Media: the native control panel of `<audio>` accepts a CSS grid, so the parts can be rearranged without script. measured, C157, `/cassette/`.
- Hit testing: among overlapping drawn elements, the one drawn last takes the hit. measured, C157, `/cassette/`.
- Drawing: a source rectangle of the play button copies the browser's own play or pause glyph, which follows the element's state. measured, C157, `/cassette/`.

## Open ideas

- A record key that captures the microphone into a second audio element.
- Tape hiss, wow and flutter with an `AudioWorklet`, with the reels reading its speed.
- The same deck for a `<video>`: the frame in the cassette window.
