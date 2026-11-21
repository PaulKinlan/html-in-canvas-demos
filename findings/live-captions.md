# Live captions with a second language (`/live-captions/`)

Chromium 157 headless (C157), 2026-11-21. The test browser has no speech recognition service and no translation model, so the two APIs in the title were not run end to end. The table says which rows were measured.

| Experiment | Result | Notes |
| --- | --- | --- |
| Interim and final results as a caption element drawn over the frame, translation under it | measured, works | Results go through one `feed({ text, final })` function. The caption element holds two paragraphs and is drawn twice with a clip, so the first is over the frame and the second under the bar. |
| Only revised words change | measured, works | "the page reeds" then "the page reads the": two `<span>` elements kept, the third replaced and marked, a fourth added. Kept words do not run their CSS animation again. |
| Recorded transcript fed in step with the video | measured, works | `replayCues()` reads the time stamps of `talk.vtt` and feeds each word as an interim result at its time and the sentence as a final result. 8 interim results, then the final one. |
| WebVTT from final results | measured, works | `toVtt()` output loaded through a blob URL into a `<track>`: 2 cues read back with their times. A literal `-->` in a caption has to be replaced, or the cue fails to parse. |
| Captions in a `MediaRecorder` file of the canvas | measured, works | 320×260 VP9 with Opus. 981 caption pixels in the bottom of the recorded frame. |
| `SpeechRecognition` surface | measured | `continuous`, `interimResults`, `processLocally`, `phrases`, `available()`, `install()` are all present in C157. |
| `recognition.start(track)` with the audio track of `video.captureStream()` | measured: starts | Events `start` and `audiostart` arrived and no error. No result followed, as there is no recognition service in the test browser. |
| Recognition results from the clip's sound or the microphone | not verified | Needs a device with a recognition service. The page lists every recognition event under the player. |
| `Translator.availability()` | measured: never settles in C157 headless | The page waits 3 s, then uses recorded translations of the clip's six sentences and says so. |
| `Translator.create()` and `translate()` on interim and final text | not verified | Written to translate one request at a time, keep every final caption and drop interim requests that were overtaken. The time of the last call is shown under the player. |

## Things that bit

- A new caption that replaced the last one word by word marked every word as revised. A new utterance now clears the words first.
- `SpeechRecognition.prototype.start.length` is 0 in C157 although `start(track)` is accepted, so the page cannot test for the argument. It looks for `processLocally`, which shipped with it. That is an inference.
- `SpeechRecognition.available()` crashed the tab in headless C157 on `/voice/`, so this page never calls it.
- `box-sizing: border-box` from the site's style sheet makes `min-height` include the padding. A check that assumed a 46 px caption band counted pixels of the frame.

## Not verified

- Whether Chrome 159 on Android accepts `start(track)` with a track from `video.captureStream()`, and whether it needs `processLocally` for that. Choose "speech recognition on the clip's sound" and read the event list.
- How late interim results are against the sound.
- `Translator` on a phone: availability, download after the tap on the language menu, and the time per call.
- The recorded Spanish, French, German and Japanese were written by a language model and have not been checked by a speaker.

## For the index

- Media: `recognition.start(track)` accepts the audio track of `video.captureStream()` and starts. measured (start only), C157, `/live-captions/`.
- Media: a caption element in the canvas is part of `canvas.captureStream()`, so live captions are burnt into a recording. measured, C157, `/live-captions/`.
- Built-in AI: `Translator.availability()` does not settle in headless C157. measured, C157, `/live-captions/` (also seen on `/translate-lens/`).

## Open ideas

- `SpeechRecognitionPhrase` biasing from the words on the page.
- Speaker colours from two tracks (microphone and clip) recognised at once.
- The translation as a second audio track through `SpeechSynthesis`, with `/speak-words/` highlighting.
