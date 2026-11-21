# Captions drawn apart from the video (`/captions/`, `lib/cue-layer.js`)

Measured in Chromium 157 headless (C157) with software video decoding, 2026-11-21. The clip is `public/media/talk.webm` with `talk.vtt`, made by `tools/speech-clip/make.mjs`: six sentences of synthesized speech, one cue each, a `<v>` voice per cue, a time stamp before each word and a `position` and `align` setting per speaker. Cue times are measured from the sound files. The word time stamps are estimates from letter counts.

| Experiment | Result | Notes |
| --- | --- | --- |
| `track.mode = 'hidden'` on a `<track>` with no `default` attribute | the file loads, `activeCues` follows the time, `cuechange` fires | After a seek to 8.0 s `activeCues` held cue 3 and one `cuechange` had fired. |
| The video's own picture with the track hidden | no caption pixels | 0 bright grey pixels in the bottom third of the frame with the track hidden, more than 50 with it showing, same fixture. |
| `VTTCue.getCueAsHTML()` | keeps voices, classes, `<b>`, `<i>`, `<lang>`, `<ruby>` and time stamps | `<v Ben>` becomes `<span title="Ben">`, `<c.loud>` becomes `<span class="loud">`, `<00:00:07.008>` becomes a `ProcessingInstruction` with target `timestamp`. Cue 3 gave 11 of them. |
| A caption element as a second `drawable` child, drawn under the frame | works | `<video drawable>` and the caption `<div drawable>` are siblings in the canvas, one `drawElementImage()` call each. |
| Tap on a drawn word | reaches its `<span>` | `elementFromPoint()` at the drawn word returned the span, and its click handler set `currentTime` to the word's time stamp. Also done with the caption box scaled by the mask mode. |
| Words marked past, now and future from the time stamps | works | At 9.2 s cue 3 had 7 past words and "builds" current. The colour change is a CSS transition and raises `paint` with no `requestPaint()`. |
| `cuechange` lateness during playback | 1 ms of media time | Played across the start of cue 2 and read `currentTime` in the handler. One run, software decoding. |
| Captions as text filled with the video frame | works | Clip to the caption area, draw the caption element, set `globalCompositeOperation = 'source-in'`, `drawImage(video)` over the area. 2414 of 2781 text pixels took the frame's colours. The canvas background must come from CSS so the area is clear before the text is drawn. |
| Caption bubble placed from `cue.position` and `cue.align` | works | The canvas reads the two settings and draws the element on that side of the frame, growing over the first 0.2 s of the cue in media time. |
| `track.addCue(new VTTCue(...))` on the hidden track | shown like a cue from the file | Its `enter` event fired once and its element had the `<b>` from the cue text. |
| `layer.update(time, { exact: true })`: cues chosen by comparing `track.cues` with a time | works | Needed when the time is ahead of what the browser has reached, as in a frame-by-frame export. Used by `/timed-comments/`. |

## Things that bit

- A `<track default>` goes to `showing` by itself. The page leaves `default` off and sets `mode = 'hidden'`, which also starts the load.
- `details.checks-fold` is closed on a phone, so `innerText` of the result rows is empty. Test scripts should read `window.__results`.
- The native caption text is small and anti-aliased. A check that counted pure white pixels found none. It now counts bright pixels with no colour, which the gradient picture of the clip does not have.
- The caption area needs a height that does not depend on the caption. The canvas is `calc(56.25cqw + 198px)` tall inside a stage with `container-type: inline-size`.

## Not verified

- A hardware-decoded `<video drawable>` as a direct canvas child on Android. Open `/captions/` on the phone and press Play: the frame should be in the canvas.
- Whether the lit word matches the sound by ear. The test browser has no sound output, and the word times are estimates.
- `cuechange` lateness with a hardware decoder. The fourth live check reports it on the device.
- A screen reader's reading of the caption box.

## For the index

- Media: a text track in `hidden` mode keeps `activeCues` current and draws nothing, so captions can be a separate drawn element. measured, C157, `/captions/`.
- Media: `getCueAsHTML()` exposes cue time stamps as `timestamp` processing instructions. measured, C157, `/captions/`.
- Drawing: `source-in` after `drawElementImage()` fills an element's text with another image. measured, C157, `/captions/`.

## Open ideas

- A second language track drawn beside the first, each in its own element.
- `kind="chapters"` cues as a drawn chapter list with the current chapter enlarged.
- Region and `line` settings (`VTTRegion`) mapped to places outside the frame.
