# VHS tape tracking and head-switching noise (`/vhs-tracking/`)

Measured in headless Chrome 160.0.8188.0 canary on 2026-11-27 (`412x800` at device scale factor `2.625` with touch emulation, and `960x800` at DPR `2`, SwiftShader WebGL), plus a fallback check with `--disable-blink-features=CanvasDrawElement` and a reduced-motion check with emulated `prefers-reduced-motion: reduce`. All live checks wait for a tap (`<meta name="checks" content="tap">`). Chrome 159 on Android, headless Chromium 157 and `npm run check:jank` (Playwright not installed here) are **not verified**.

I built a retro broadcast and camcorder VCR deck (`#vhs-deck`, `drawable`) inside one `<canvas id="vhs-canvas" content="drawable" layoutsubtree>` rendered by one `ElementGL` WebGL 2 context (`/lib/element-gl.js`). The fragment shader (`VHS_FRAG`) degrades the uploaded live DOM with YIQ chroma delay and horizontal smear, a movable helical-scan tracking noise bar driven by `uTracking`, bottom ~7% rotary head-switching jitter (`vUv.y > 0.928`), fast-forward/rewind scan streaks, pause field tremble and tape dropout snow flecks while keeping `#vhs-label`, the channel switcher (`CH 03`, `AV 1`, `CAM`) and transport buttons (`PLAY`, `FF 2x`, `REW`, `PAUSE`) clickable via `updateElementGeometry()`.

| Question or check | Result | Notes |
|---|---|---|
| `ElementGL` upload and `VHS_FRAG` render succeed with `gl.getError() === 0` | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`gl.getError() === 0`; `leftRed=[250,37,39,255]`, `rightDark=[8,10,16,255]` on 412 px DPR 2.625). |
| YIQ chroma delay and horizontal smear bleed red across a sharp edge | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`4 px` right of red/black edge: Clean=`[8,10,16,255]`, VHS Play at `uWear=0.85`=`[144,0,0,255]`). |
| Tracking off-centre introduces helical scanline tear that clears near `0.0` | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: sampled pixels differing (`> 65` RGB sum vs Clean) across the band were `0` at `uTracking=0.0` and `58/153` on mobile (`59/153` on desktop) at `uTracking=0.32`. |
| `updateElementGeometry()` keeps `PLAY` button, channel button and `<input>` hit-testable | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed (`inputHit=true`, `channelHit=true`, `playHit=true`, `playClicks=1` via `elementsFromPoint()`). |
| `webglcontextlost` enters plain-HTML fallback and `webglcontextrestored` recovers | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed on synthetic cancelable `webglcontextlost` and `webglcontextrestored` (`defaultPrevented=true`, `plainWhileLost=true`, `restored=true`, `glErr=0`). |
| Visible stage still holds a picture after all fixtures retire | measured (Chrome 160 Canary, 2026-11-27) | Check 6 (`stillDrawn()`) passed (`100.0%` drawn; `948x1183`, `1.12 MP`, `8.97 MB`, `glActive: 1`, `glPeak: 6` during tap checks, `openSnapshots: 0`, `unaskedReads: 0`, `wrongDraws: 0`). |
| Plain-HTML fallback when HTML-in-canvas is disabled | measured (Chrome 160 Canary, 2026-11-27) | With `--disable-blink-features=CanvasDrawElement` at 412 px, `#vhs-stage` enters `.is-plain` (`scrollWidth === 412`, `0` errors) and moves `#vhs-deck` into `#vhs-plain-host`. |
| Reduced motion calibration freeze | measured (Chrome 160 Canary, 2026-11-27) | With `prefers-reduced-motion: reduce`, `#vhs-reduced` starts checked and rendering stops after 2 initial uploads (`calibration frozen`). |
| Real device frame rate, touch typing inside `#vhs-label`, and phone memory pressure | not verified | Needs a live run on Chrome 159 for Android at 412 px wide. |

## Things that bit

- **Red REC dot smearing onto adjacent green text:** in the first pass, placing a red dot 6 px left of `"PLAY"` caused YIQ chroma bleed (`delayUv + smearUv`) to tint the `"P"` of `"PLAY"` reddish at 42% wear. Increasing badge gap from `6px` to `9px` left enough dark padding so the chroma trail reads as an authentic bleed gap rather than muddying the glyph.
- **Default tracking and dropout density obscuring the tape `<input>`:** starting `uTracking` at `+0.28` placed the main tracking tear band across the middle of `#vhs-label`, and `dropThresh = 0.996 - 0.022 * uWear` sprinkled too many white specks across medium-wear text. Moving the default tracking dial to `-0.38` places the tear band inside the monitor window above the SMPTE colour bars, and tightening `dropThresh` to `0.9985 - 0.011 * uWear` keeps copy sharp at 42% wear while letting high wear flood the tape.
- **Reserving the bottom 7% for head-switching noise:** placing a non-interactive calibration footer across `vUv.y > 0.928` keeps the rotary head-switching shear and dropout speckles visible without shifting clickable transport or channel buttons off their `updateElementGeometry()` hit boxes.
- **Premultiplied alpha uploads in `ElementGL`:** calling `gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true)` at creation, inside `onRestored`, and in every fixture prevents translucent borders and badges from washing out before un-premultiplication in `VHS_FRAG`.

## Not verified

- Headless Chromium 157: running `npm run check:jank -- /vhs-tracking/` and `node tools/draw-size/audit.mjs /vhs-tracking/` (Playwright is not installed in this environment).
- Chrome 159 on Android (412 px wide, DPR 2.625): real GPU frame rate during live playback and `FF 2x`, touch keyboard opening and editing inside `#vhs-label`, and confirming zero context losses under memory pressure.
- `public/<name>/social.jpg` capture via `node tools/social/capture.mjs /vhs-tracking/`.

## For the index

- Video and sound: `/vhs-tracking/` wraps a live interactive HTML VCR player card (editable tape label, channel switcher, transport buttons and running timecode) in one `ElementGL` WebGL 2 shader adding YIQ chroma smear, a movable helical tracking tear band, FF/REW scan streaks, pause tremble and bottom 7% head-switching noise while keeping controls hit-testable via `updateElementGeometry()` (measured in Chrome 160 Canary, 2026-11-27; Chrome 159 Android not verified).
