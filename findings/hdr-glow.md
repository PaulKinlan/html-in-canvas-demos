# HDR interface (`/hdr-glow/`)

Measured in Chromium 157 (headless shell), 2026-11-21. The test browser has no HDR output, so every result here is a value read back from the canvas with `getImageData(…, { pixelFormat: 'rgba-float16' })`, not something seen on a screen. Not yet run on the test phone.

The canvas in every row is a 2D context with `colorType: 'float16'` and `colorSpace: 'display-p3'`. Values are Display P3 component values as read back; 1.0 is standard white.

## CSS on the drawn element

| Question | Result | Notes |
|---|---|---|
| `background: color(display-p3 3 3 3)` | 3.0 | Also through a border (2.5), an outline (3.0), text colour (3.0), `linear-gradient()` and `radial-gradient()` stops (4.0). |
| `color(srgb-linear 4 4 4)` | 1.82 | 4.0 linear is 1.82 after the sRGB transfer curve, which Display P3 shares. The readback is encoded, so this is the same light as 4.0 linear. `color(srgb-linear 8 8 8)` reads 2.45. This answers the open question in the plan: it is not a tone curve or a limit. |
| `color(srgb 2 2 2)`, `color(rec2100-linear 2 2 2)`, `color(xyz-d65 3 3 3)` | 2.0, 1.35, about 1.6 | Each predefined space carries values above 1.0. |
| `rgb(600 600 600)`, `oklch(2 0 0)` | 1.0 | Clamped. Only `color()` carried values above white. |
| Relative colour `color(from #2a6cf0 display-p3 calc(r * var(--gain)) …)` with `--gain: 3` | 0.71, 1.25, 2.73 | A custom property can scale an existing colour above 1.0. |
| The same colour with `--gain` animated by a CSS animation on a registered property | follows the animation | 1.25 at the midpoint of 1 to 4 on mid grey. |
| `box-shadow: 0 0 12px 6px color(display-p3 4 2 1)` in the blurred part | 4, 2, 1 at alpha 0.27 | The blur keeps the values (the readback is not premultiplied). `text-shadow` the same. |
| `filter` on the element, including `blur(0px)` and `saturate(1)` | 1.0 | Any CSS filter clamps the element's picture. `filter: drop-shadow()` in a colour of 4.0 gave 1.0. |
| `mix-blend-mode: plus-lighter` on the element | 1.0 | Clamped. |
| `opacity`, `mask`, `clip-path`, `border-radius`, `transform`, `will-change`, `backdrop-filter` | 3.0 | Not clamped. |
| `dynamic-range-limit: standard` on the element | 3.0 | The property does not change stored values. Its effect on the screen is not verified. |

## Canvas operations in the float16 context

| Operation | Result | Notes |
|---|---|---|
| `fillRect()` with `color(display-p3 3 3 3)`, canvas gradients, `putImageData()` of float data | keep values above 1.0 | |
| `multiply` with a fill above 1.0 over drawn pixels | scales them, above 1.0 | 0.5 times 4 read back as 2.0. With a fill of 1 ÷ headroom it brings the whole canvas under 1.0. The page uses both. |
| `source-over` with `globalAlpha` | keeps | 6.0 at half alpha over 2.0 gave 4.0. |
| Shadow of a fill (`shadowColor` above 1.0, `shadowBlur`) | keeps, 4.0 | The page draws its halo this way, with the fill itself off the canvas. |
| `lighter`, `screen`, `overlay`, `hard-light`, `color-dodge` | clamp to 1.0 | 0.8 plus 0.8 with `lighter` is 1.0. |
| `ctx.filter` (blur, brightness) | clamps to 1.0 | `brightness(3)` on white gives 1.0. |
| `drawElementImage()` with `shadowBlur` set | element and shadow clamp to 1.0 | The 3.0 element came out as 1.0. |
| `drawElementImage()` with `globalAlpha`, a scale or a rotation | keeps 3.0 | |
| `drawImage()` of a float16 canvas, an OffscreenCanvas or an ImageBitmap of one, and `createPattern()` | clamp to 1.0 | The source held 4.0. So a bloom that blurs a copy of the canvas cannot be built in 2D. |

## Other routes

| Route | Result | Notes |
|---|---|---|
| WebGL 2: `texElementSubImage2D()` into `RGBA16F` or `RGBA32F` storage | `INVALID_OPERATION` | `RGBA8` and `SRGB8_ALPHA8` are accepted and hold at most 1.0. `drawingBufferStorage(RGBA16F)` and `drawingBufferToneMapping()` exist, so a shader can write values above 1.0, but it does not receive them from the element. |
| WebGPU: `drawElementImageToTexture()` into `rgba16float` | 1.0 for a CSS value of 3.0 | Measured with the SwiftShader adapter (`--enable-unsafe-webgpu`). With `colorSpace: 'display-p3'` on the destination the colours are converted and still clamped. |
| `toneMapping: { mode: 'extended' }` on the 2D context | accepted; reported back as `standard` | With `--enable-experimental-web-platform-features` it is reported as `extended`. A string instead of the dictionary throws a TypeError. |

## On the test phone (Chrome 159, Android), 2026-11-21

Reported by the project owner with a screenshot of the first version of the page. Not reproduced in the test browser.

| Observation | Detail |
|---|---|
| The visible canvas was white with the context guard's note over it | "This canvas lost its 2D context and the page did not get it back." |
| The guard's log | 10 2D contexts made, 1 WebGL, 1 WebGPU. 2D losses at 1.4 to 1.6 s, then seven at 3.1 s, seven at 4.6 s, seven at 6.1 s, seven at 7.6 s. |
| Which canvases | Seven matches the visible canvas plus the six float16 fixtures of the 2D live checks, which were out of the page but still alive. All float16 contexts were lost together. |
| The interval | 1.5 s, which was the interval of the page's status readback (`getImageData()` with `pixelFormat: 'rgba-float16'`, four 1 by 1 reads). Chrome's own retry of a lost 2D context could give a similar rhythm, so the readback is suspected, not shown, as the cause. |
| The readback after the first loss | 0.00 for every sample. |

Second report, same phone, after the readback became a button (PR 75): the panel was drawn and stayed until the map view was chosen. The page's notice then read "The float16 canvas lost its context on this device (right after a float readback with getImageData(), 5.3 s after load)". The screen line read "dynamic-range high, colour gamut srgb".

| Result | Label |
|---|---|
| `getImageData()` with `pixelFormat: 'rgba-float16'` on a float16 Display P3 2D canvas loses that context, and the other float16 2D contexts on the page with it | reported, A159, twice: on a 1.5 s timer, and once on demand |
| Drawing elements into the float16 canvas with no readback does not lose it | reported, A159 ("it worked for a bit") |
| The phone's screen matches `(dynamic-range: high)` | reported, A159 |

Third report, same phone, on the preview of PR 82, 2026-11-21 17:47, asked to pick "As stored" and leave the map view alone: the word BRIGHTER in the white strip could not be read. It could be read after selecting the text of the strip, so the word was drawn and the selection highlight made it visible.

| Result | Label |
|---|---|
| A value of headroom times white in the canvas is shown at the same brightness as white: values above 1.0 do not appear brighter than white on this phone | reported, A159, once |

Fourth report, a screenshot at 18:03 on the same preview: "As stored", headroom 4.0, `dynamic-range-limit: no-limit`, 533 paint events, no readback pressed. The page's lines read "Screen: dynamic-range high, colour gamut srgb. Context: float16, display-p3, tone mapping standard." The white strip was blank. So the canvas was float16 and held the values, and the screen showed 4.0 times white as white.

| Result | Label |
|---|---|
| A float16 Display P3 2D canvas with tone mapping reported as `standard` shows values above 1.0 at the brightness of white, on a screen that matches `(dynamic-range: high)` | reported, A159, with the context line in the screenshot |
| `dynamic-range-limit: no-limit` on the canvas does not change that | reported, A159, same screenshot |

Fifth report, four screenshots at 19:57 on the same preview with chrome://flags "Experimental Web Platform features" turned on:

| Observation | Label |
|---|---|
| The context line reads "float16, display-p3, tone mapping extended". Without the flag it read "standard". So `getContext('2d', { toneMapping: { mode: 'extended' } })` is accepted on Chrome 159 Android only with the flag | reported, A159 |
| The screen line is unchanged: dynamic-range high, colour gamut srgb | reported, A159 |
| In the screenshot the white strip is blank. A screenshot is an SDR picture, so it cannot show whether the word was brighter than white on the screen itself. Not answered yet | not verified |
| The map view drew once (424 paint events): badge, Deploy button and its halo, bar, focus ring, heading and the first line of text are coloured as above 1.0. The strip is coloured only in its left third, with a stepped edge, while the canvas holds 4.0 across the whole strip | reported, A159. The cause of the partial strip is not known: a partial float readback is one explanation |
| A later float readback lost the context ("last seen right after a float readback with getImageData(), 32.3 s after load"). The panel moved to a new float16 canvas, which kept drawing (669 and 729 paint events) with tone mapping extended, and readback and the map were switched off | reported, A159. This is the first real run of the path that had only been tested with a dispatched event |
| So a float readback does not lose the context every time: at least one full-canvas readback returned data before the one that lost it | reported, A159 |

What the page does now: it reads floats back only when "Read values back" is pressed or the map view is chosen, and its live checks wait for a tap. When a float16 context is lost within 2.5 seconds of a readback, the panel moves into a new float16 canvas, and readback and the map view are switched off on that device (`localStorage`). When it is lost with no readback before, the new canvas is 8-bit and the notice says so (`sessionStorage`). "Reset and reload" clears both. Both paths were tested in the test browser with a dispatched `contextlost` event, not with a real loss.

## Things that bit

- A status readout that sampled "the panel background" beside the Deploy button read 0.32 instead of 0.08: the sample point was inside the button's halo. It now samples the bottom corner.
- `getContext('2d', { toneMapping: 'extended' })` throws, so the page tries the dictionary form and falls back to no option.
- The halo has to be clipped off the element with an even-odd clip, because the shadow of a filled shape is solid under the shape.

## Not verified

- Whether the phone shows values above 1.0 brighter than white with tone mapping `extended` (flag on). The context is created that way (fifth report above), but a screenshot cannot show it. To verify: with the flag on and "As stored" selected, look at the white strip on the screen itself for the word BRIGHTER.
- Why the map view coloured only the left third of the white strip on the phone.
- The effect of `dynamic-range-limit` on the canvas element. The page has a select for it.
- `(dynamic-range: high)` on the test phone. The page prints what the screen reports.
- Whether an 8-bit readback (`getImageData()` with no `pixelFormat`) of a float16 canvas also loses the context on the phone, and whether the loss is a GPU process crash. Not tried.
- Whether a new float16 canvas made right after the loss works on the phone. The first report's log (losses every 1.5 s, each after a restore) suggests a restored context draws again.
- Speed of the repaint (about 15 a second, every frame during a deploy) and of the map view's full readback on a phone.

## Open ideas

- A WebGL route with an `RGBA16F` drawing buffer: the element arrives as 8 bits, and a shader raises pixels chosen by a mask and adds a real bloom. Not built.
- Ask for a float destination in `texElementSubImage2D()` and unclamped values in `drawElementImageToTexture()`.

## For the index

- Colour and HDR: a float16 Display P3 2D canvas keeps CSS `color()` values above 1.0 through `drawElementImage()` (measured, C157, `/hdr-glow/`).
- Colour and HDR: a CSS `filter` or `mix-blend-mode` on the element, `ctx.filter`, `lighter`, a shadow on the draw and `drawImage()` of a float canvas clamp to 1.0; `multiply` and fill shadows do not (measured, C157, `/hdr-glow/`).
- WebGL and WebGPU: element copies do not carry values above 1.0; `texElementSubImage2D()` refuses float textures (measured, C157, `/hdr-glow/`).

## Chromium bugs

- Chrome 159 on Android: `getImageData(…, { pixelFormat: 'rgba-float16' })` on a float16 Display P3 2D canvas loses every float16 2D context on the page (reported, A159, `/hdr-glow/`). Needs a reduced page, without HTML-in-canvas if it still reproduces, before filing.

## API requests

- `texElementSubImage2D()` should accept `RGBA16F` storage, and `drawElementImageToTexture()` should keep values above 1.0 in a float texture, so that GPU routes can receive HDR CSS colours.
