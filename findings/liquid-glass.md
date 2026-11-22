# Liquid glass toolbar over scrolling DOM (`/liquid-glass/`)

Not verified in a live browser yet (written 2026-11-22). All live checks wait for a tap (`<meta name="checks" content="tap">`) and run on isolated fixtures in the visitor's browser.

This experiment takes inspiration from Apple's Liquid Glass material design (WWDC 2025) and community WebGL and WebGPU refractive glass UI demos. CSS `backdrop-filter: blur()` can frost pixels behind a floating bar, yet it can't bend them through a curved bevel or split RGB channels like a physical lens. Here, one `ElementGL` canvas (`/lib/element-gl.js`) holds both `#lg-page` (a live scrollable article with selectable text, contrast cards, checkboxes and a newsletter form) and `#lg-dock` (a floating navigation pill). Pass 0 draws the article; Pass 1 samples the article texture on `TEXTURE1` through a rounded-rectangle SDF lens with Snell's-law refraction, chromatic dispersion, a 9-tap frosted micro-blur and a pointer-lit Fresnel rim, then composites the live `#lg-dock` DOM texture on top.

| Question | Result | Notes |
|---|---|---|
| One `ElementGL` canvas uploading both `#lg-page` and `#lg-dock` via `texElementSubImage2D()` | not verified | Checked by live check 1 on a 220 by 120 fixture (`preserveDrawingBuffer: true` + `readPixels()`). |
| Snell's-law UV bending near the rounded pill bevel | not verified | Checked by live check 2 across a red-to-blue vertical seam with `uRefraction = 0` vs `1.5`. |
| Chromatic dispersion across a black-and-white vertical edge | not verified | Checked by live check 3 by measuring peak `|R - B|` along the bevel seam on a greyscale background. |
| Re-uploading `#lg-page` while it scrolls | not verified | Checked by live check 4 (`scrollTop = 0` red block vs `scrollTop = 80` green block); the demo also listens to `scroll` and flags `pageDirty = true` before calling `requestPaint()`. |
| `updateElementGeometry()` + `dataset.hitTick` syncing hit boxes for a dragged pill over a scrolling article | not verified | Checked by live checks 5 and 6 via `elementFromPoint()` and click handlers on both layers. |
| Visual legibility and drag smoothness at 412 px wide on touch | not verified | Needs a live run on Chrome 159 on Android and headless Chromium 157. |

## Things that bit

- `ElementGL.quad()` binds the drawn element's own texture to `TEXTURE0` (`uTex`). To sample the background article inside the floating pill pass without opening a second WebGL context, Pass 0 stores the `{ tex, w, h }` handle returned by `stage.upload(pageEl)` and Pass 1 binds `pageTex.tex` to `TEXTURE1` (`uBgTex`) inside `quad()`'s uniform callback.
- `updateElementGeometry()` has been seen to take CSS pixels on some canvases and backing-buffer pixels on others at high device pixel ratios. The paint handler scales both matrices with `geometryUnit()` from `/lib/surface.js` and toggles `dataset.hitTick` when a layer moves or resizes so Chromium clears its hit-test cache.
- Dragging a floating pill that contains real `<button>` elements needs a movement threshold (6 px when "Drag anywhere on pill" is checked) and a capture-phase click suppressor after a drag, otherwise dragging either steals taps or fires accidental clicks on release.

## Not verified

- Chromium 157 (headless): running all 6 live checks, verifying `npm run check:jank -- /liquid-glass/` and `node tools/draw-size/audit.mjs /liquid-glass/`, and capturing `social.jpg`.
- Chrome 159 on Android (412 px wide, device pixel ratio 2.625): touch dragging `#lg-dock` with `touch-action: none` over `#lg-page` (`touch-action: pan-y`), text selection under and around the pill, keyboard entry in the newsletter `<input>`, real frame rate during scrolling, and behaviour after a context loss.
- Chromium 153: fallback behaviour when WebGL `texElementSubImage2D()` is missing or behaves differently.

## Open ideas

- Add a WebGPU route via `/shared/backend.js` alongside the `ElementGL` WebGL 2 route so visitors can compare GPU cost and shader behaviour on both backends.
- Drive the pill's refraction and bevel uniforms from registered CSS custom properties (`@property`) so CSS transitions animate the glass when the toolbar docks or floats.

## For the index

- Shaders and lenses: a two-pass `ElementGL` canvas can sample one drawable child (`#lg-page`) as a background texture on `TEXTURE1` while refracting it behind a second drawable child (`#lg-dock`) with Snell's law and chromatic dispersion (not verified, `/liquid-glass/`).
