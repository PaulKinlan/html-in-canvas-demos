# Hold-to-delete ember burn card (`/hold-to-delete/`)

Measured in headless Chrome 160.0.8187.0 canary on 2026-11-27 (412 px viewport, device scale factor 2.625, SwiftShader WebGL) after [Hold to Delete](https://x.com/kshvbgde/status/2117502283894362219) by Keshav Bagaade (`/elsewhere/#hold-to-delete`). Syntax checked (`node --check`), graphics rules clean (`check:gfx`), social metadata clean (`validate.mjs`), writing clean (`--strict`), smoke check passed (`924x1202`, `1.11 MP`, `8.9 MB`, `0` errors), and `5/5` live checks passed. Chrome 159 on Android at 412 px and `npm run check:jank` (Playwright not installed here) are **not verified** yet.

The question: when you press and hold a dangerous button inside a live editable HTML card, can one WebGL 2 canvas ignite an FBM ember burn from the button's bounding box, cool back intact on early release, and hand hit testing to an undo card at 100%?

## What was built

One `<canvas id="burn-canvas" content="drawable" layoutsubtree>` inside `.burn-viewport` (`max-width: 520px`, `430 px` tall, `460 px` below `520 px` with no `dvh`, roughly `1.11 MP` at 412 px wide and 2.625 DPR) holding two live `drawable` children:

- **Editable API key card (`#burn-card`)**: live key label `<input type="text">`, toggleable scope tag pills, editable `<textarea>`, live confirmation progress bar and state badge, secondary **Archive** `<button>`, and bottom-right **Hold to delete** `<button id="btn-delete">` with an internal circular progress ring.
- **Recovery card (`#deleted-card`)**: compact dark slate card (`inert` while un-deleted) revealed behind the burning hole as `charge` approaches 100%, showing key name, hold telemetry and an active **Undo delete** `<button id="btn-undo">`.

Rendering uses one WebGL 2 context created through `new ElementGL(canvas, ...)` from `/lib/element-gl.js` (`BURN_FRAG`), gated on `hasPainted = true` inside the `'paint'` listener, with a five-argument `drawElementImage()` 2D radial clip fallback and plain-HTML extraction on unsupported browsers or context loss.

## Results

| Question | Result | Reason or detail |
|---|---|---|
| Does `ElementGL` upload `#burn-card` via `texElementSubImage2D()` and render `BURN_FRAG` cleanly at `charge = 0` and `charge = 0.55`? | measured (Chrome 160 Canary, 2026-11-27) | Check 1 passed (`gl.getError() === 0`) after calling `g.begin()` before `g.upload(cardFix)` so the fixture sizes past `300x150` and accounting for white label glyph anti-aliasing at `#btn-delete`'s centre (`[192,74,67,255]`). |
| Does releasing early quench `charge` back to `0` while keeping typed DOM input intact? | measured (Chrome 160 Canary, 2026-11-27) | Check 2 passed (`550 ms` hold quenched back to `0` while fixture `<input>` kept its typed text). |
| Does holding 1.4 s commit `deleted = true` and move hit testing via `updateElementGeometry()` to `#btn-undo`? | measured (Chrome 160 Canary, 2026-11-27) | Check 3 passed: `stepBurnState()` past 1,400 ms updated `syncCardGeometry()` and `document.elementsFromPoint()` landed on `#btn-undo` with `#btn-delete` offstage. |
| Does `webglcontextlost` enter plain-HTML fallback and `webglcontextrestored` recover `ElementGL`? | measured (Chrome 160 Canary, 2026-11-27) | Check 4 passed on synthetic cancelable `webglcontextlost` and `webglcontextrestored`. |
| Does the visible stage still have a picture after all fixtures retire? | measured (Chrome 160 Canary, 2026-11-27) | Check 5 passed (`stillDrawn()`, `1.11 MP`, `8.9 MB`, `0` lost contexts). |

## Things that bit

- **Button coordinates inside nested rows:** `btnDelete.offsetLeft` and `offsetTop` only measure relative to `burnCard` when intermediate flex wrappers remain `position: static`. Walking `offsetParent` up to `#burn-card` (with `clientLeft`/`clientTop` added) keeps `uOriginRect` locked to the uploaded texture pixels without calling `getBoundingClientRect()` during layout passes.
- **Transparency behind the active burn front:** rising spark particles drawn across the whole burned interior would put non-zero alpha inside `#btn-delete` at `charge = 0.55`. Masking sparks to `burnGap` between `-0.20` and `0.016` lets embers drift out of the active flame front while keeping the cleared void deep behind the front at `alpha = 0` so `#deleted-card` shows through cleanly.
- **Throttling in-card progress DOM updates:** mutating `#charge-fill` and `#charge-badge` inside `#burn-card` on every `requestAnimationFrame` tick would trigger unnecessary DOM repaints and `texElementSubImage2D()` uploads 60 times a second. Quantising those DOM updates to 5% steps lets the WebGL burn shader run at full display rate with minimal texture re-uploads.
- **Long-press interference on touch:** putting `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none` and `contextmenu` prevention solely on `#btn-delete` prevents scroll-cancel or Android text-selection menus during a 1.4 s hold while leaving `touch-action: pan-y` on `#burn-canvas` so normal vertical scrolling works across the rest of the card.

## Not verified

- Headless Chromium 157: all five live checks, `npm run check:jank -- /hold-to-delete/`, and `node tools/draw-size/audit.mjs /hold-to-delete/` (confirm zero layout shift, zero timed readbacks, backing store under 4 MP, and real `readPixels()` / `elementsFromPoint()` output).
- Chrome 159 on Android at 412 px wide and 2.625 DPR: 1.4 s touch hold on `#btn-delete` vs page scroll over the rest of `#burn-card`, long-press callout suppression, on-screen keyboard inside `#card-title` and `#card-notes`, and visual appearance of **Paper ash** vs **Plasma scorch**.
- `prefers-reduced-motion: reduce` live confirmation step ring without turbulence or rising sparks.

## For the index

- Transitions, text and motion: `/hold-to-delete/` rebuilds Keshav Bagaade's Hold to Delete with one `ElementGL` WebGL 2 canvas, igniting an FBM and cellular ember burn from `#btn-delete`'s exact CSS bounding box (`uOriginRect`), cooling intact on early release, and swapping `inert` plus `updateElementGeometry()` to a live **Undo delete** card at 100%.
