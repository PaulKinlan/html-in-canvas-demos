# Friction log (`/friction/`, `public/friction/entries.js`, `public/friction/probes.js`)

Measured in C157 (headless Chromium 157.0.8103.78 shell, software rendering) on 2026-11-21, at 412 px wide with emulated touch and device scale factor 2, and with `--force-device-scale-factor=2` and no viewport emulation. Nothing here has been run on A159.

The page collects every place recorded so far where HTML-in-canvas, or a Chrome API used with it, did not do what the person writing a page expected. The entries were gathered from `FINDINGS.md` ("Chromium bugs worth filing", "API changes that would help", the index), from the "Things that bit", "Chromium bugs" and "API requests" sections of the files in this folder, and from `docs/graphics-rules.md` and `docs/lost-contexts.md`. Crashes and lost canvases stay on `/crashes/`: the page lists them from `public/crashes/cases.js` and does not copy them.

## What the log holds

| Kind | Entries | What it means |
|---|---|---|
| Browser behaviour that looks wrong | 18 | Candidates for a Chromium bug report. None is filed. |
| The API has no way to do it | 17 | Requests for the explainer. |
| The API as built, where it was not what we expected | 21 | Developer friction: no error, no warning or no line in the explainer said so. |
| Our mistakes | 8 | Developer friction: the code or the test was wrong. |
| Libraries, bindings and the test browser | 7 | Friction from outside the API. |
| Seen, cause not found | 8 | Each needs a smaller page or a run on the device that showed it. |

79 entries. By area: hit testing 13, drawing 10, pictures 9, WebGL and WebGPU 9, lost canvases 8, form controls 6, paint event 6, layout 5, related APIs 4, tools 4, ElementImage 2, view transitions 2, accessibility 1.

## Probes

Nineteen entries can be decided by script. `probes.js` has one function for each. The live checks run them on fixtures on the test stage and mark the entry "still happens" or "does not happen" in the browser that opened the page. A check fails while the behaviour is still there (`expect: 'fail'`).

| Probe | Result in C157, 2026-11-21 | Numbers |
|---|---|---|
| `drawElementImage()` with no size under `ctx.scale(devicePixelRatio)` | measured: still happens | A 100 px box covers 200 CSS px at ratio 2. At ratio 1 the probe cannot decide. |
| The remembered hit-test answer after a move | measured: still happens | The asked point stays stale. A point 2 px away is right. An attribute toggle clears it. |
| Hit region after a source-rectangle draw and `updateElementGeometry()` | measured: still happens | 3 of 36 points after a 12 px piece of a 120 px element, 36 after a whole draw in an empty clip. |
| A draw at `globalAlpha` 0 moves the hit region | measured: still happens | |
| `getBoundingClientRect()` follows the last draw | measured: still happens | 50 by 20 for a 100 by 40 px element drawn at half size. |
| Direct drawable children are laid out at the canvas origin | measured: still happens | `offsetTop` 0 and 0, widths 29 and 47 px in a 300 px canvas. |
| A canvas child without `drawable` | measured: throws | "Descendants passed to DrawElementImage must have the 'drawable' attribute". |
| A draw in the task that inserted the element | measured: throws | "No cached paint record for element". It draws after the next paint event. |
| `<slot drawable>` | measured: throws | "No cached paint record for element". The slotted child without its own attribute throws the `drawable` error. |
| An SVG drawn with `offsetWidth` and `offsetHeight` | measured: draws nothing, throws nothing | `offsetWidth` is `undefined`. |
| `ctx.filter = 'url(#missing)'` | measured: draws unfiltered, throws nothing | |
| A canvas inside a drawable box with 20 px of padding | measured: still happens | Drawn 60 by 20 px in place of 80 by 40. Right with `contain: paint`. |
| A spread shadow and an outline outside the border box | measured: not in the picture | |
| A change of a custom property that no rule uses | measured: no paint event | 0 events in 300 ms. A background change gives 1. |
| An `ElementImage` in a second canvas | measured: refused | `drawElementImage()` throws, `drawImage()` throws, `createImageBitmap()` rejects. No `[Symbol.dispose]`. A closed one throws "The ElementImage has been closed". |
| three.js method names | measured: missing | `texElementImage2D` and `copyElementImageToTexture` are missing. `texElementSubImage2D` and `drawElementImageToTexture` are present. |
| `navigator.devicePosture` | measured: `type` and `onchange` only | |
| `getBoxQuads()` | measured: missing on Element and Range | |
| `HTMLSelectElement.prototype.hidePicker` | measured: missing | `showPicker` is present. |

## Things that bit

- The alpha convention of an element texture is recorded two ways in this folder. `webgpu.md` says premultiplied, from a texture readback. `gpu-video.md` says translucent controls were solid white until the shader multiplied colour by alpha. The log lists this as one entry and does not settle it.
- Under Playwright's device emulation with `deviceScaleFactor: 2` the probe for a draw with no size reported the same doubling as with `--force-device-scale-factor=2`. The earlier note that emulation hides it was made with a different setup and was not re-tested here.
- Text put into the entry cards after a probe would change their height and move the page. Each card has one fixed line for the result and the detail stays in the live check table.

## Not verified

- Every probe on A159. Open `/friction/` on the phone and press "Run these 19 checks". A check that passes there marks an entry that Chrome 159 no longer shows.
- The entries about touch (`:active` under a touch press, `touch-action` in a picker, a rotated range input) come from emulated touch.
- Whether any entry is already known to the Chromium or WICG trackers. None was searched for and none is filed.
- The 60 entries without a probe were copied from the records named in each entry and were not re-run for this page.

## Open ideas

- A probe for `clearElementGeometry()`, `moveBefore()` in one task, and a nested drawable repainted outside the window.
- A probe for the two alpha conventions that reads one half transparent box back through `texElementSubImage2D()` and through `drawElementImageToTexture()`. It needs a GPU context, so it would wait for its own tap.
- A column for the tracker link once an entry is filed.

## For the index

- Phones and lost contexts, and every other area: `/friction/` lists what did not work as expected across all areas, 79 entries, with 19 re-run in the visitor's browser (measured, C157, `/friction/`).
- AGENTS.md, "Which file to read": a row for "What did not work as expected, by kind and area: `/friction/` (`public/friction/entries.js`). Add an entry there when a new one is found".
