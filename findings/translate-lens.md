# Language models, voice and input (`/translate-lens/`, `/agent-view/`, `/voice/`)

Measured in headless Chromium 157 on 2026-11-21. The built-in AI interfaces had no model there, so the rows that need one are marked.

| What | Result | Detail |
|---|---|---|
| A converted copy of an element drawn inside a clip (a lens) | works | Two drawable children, one 2D context. The original is drawn at its layout position and keeps hit testing; the copy is `inert`. |
| The copy in its own layout, German against English, 340 px column | drifts | Block tops are off by 0, 0, 24, 48, 48 px. |
| The whole copy drawn once per block, clipped and moved to the original block | works | 0 px of drift. One draw of the copy per block under the lens. |
| A `drawable` descendant passed to `drawElementImage()` by itself | works | One small draw per block. The element takes clicks where it was drawn. |
| The same descendant in its drawable ancestor's picture | left out | The ancestor is drawn with a hole where the descendant is. A list item drawn by itself has no bullet. |
| `getBoundingClientRect()` on a canvas child that is drawn moved or scaled | reports the drawn box | Use `offsetTop` and `offsetLeft` to measure layout. |
| A card swapped for its summary when its text would be under 9 px | works | The undrawn element keeps its last hit area, so it is made `inert`. |
| `Translator.availability()` | never settles | Headless Chromium 157. The page gives up after 3 s. |
| `Summarizer`, `LanguageModel` availability | "downloadable" | No download is possible in the container. `Rewriter` is missing, `LanguageDetector` is "unavailable". |
| `LanguageModel.prompt()` with a `responseConstraint`, no model | resolves with prose | The answer starts "On-device" and is not JSON. Not verified with a model. |
| `navigator.modelContext` (WebMCP) | missing | Registration is written for `registerTool()` and `provideContext()` and has not been run. |
| A tool call shown by a shader through four CSS custom properties | works | The lean and the marker position are registered properties with CSS transitions. The tool resolves after the animation. |
| Hit testing on the form while it leans in perspective | works | Four controls found at their drawn centres, within 0.4 px of the effect's matrix. |
| A form control named `length` | cannot be reached by name | `form.elements.length` is the number of controls. |
| Words matched against the accessible names of the buttons that are not hidden, then `click()` | works | `/voice/`. No command list: the names come from the DOM, and change when the other set of switches is shown. |
| A press from script starting the shader's ring | works | `click()` fires no pointer event, so the page calls the surface's `poke(x, y)`. |
| A custom highlight on a transcript word, in the texture | drawn | 575 pixels of the highlight colour in the read-back picture. |
| `SpeechRecognition.available({ processLocally: true })` | crashes the tab | Headless Chromium 157. `/voice/` asks only after a tap, and its check refuses in an automated browser. |
| `SpeechRecognition`, `phrases`, `SpeechRecognitionPhrase`, `install()` | present | Headless Chromium 157. `SpeechRecognitionResult` is not a global there, so `speechStartTime` cannot be detected. |

Not verified: every path that calls a model (`Translator`, `Rewriter`, `Summarizer`, the Prompt API planner and image prompt), WebMCP with a real agent, speech recognition of any kind (no microphone), whether `phrases` changes what is recognised, result timestamps, WebGPU on screen, and touch dragging of the lens on a real phone.
