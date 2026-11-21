# Lost canvas contexts

The rules that came out of this and of the losses reported later the same day, with the checks that enforce them, are in [graphics-rules.md](graphics-rules.md). This file is the record of the first investigation (pull request 63).

Measured on 2026-11-21 in headless Chromium 157, emulating a phone (412 px wide, device scale factor 2.625). The report that started this was a white canvas with Chrome's broken-picture icon on `/selection/` on an Android phone (Chrome 159), and "crashy" video pages. The loss on the phone could not be reproduced here, so its cause is not known. This file records what was measured, what was changed and what is left to confirm on the phone.

## What was measured

| Question | Result |
| --- | --- |
| Do the pull requests fail to merge or build? | No. PRs 48, 49 and 50 merged cleanly against main in a test merge, and the one check (Workers Builds) passed. |
| How many WebGL contexts does Chrome keep? | 16 per renderer on desktop: making 16 more on `/shader-css/` lost all 7 of the page's own, with the console message "Too many active WebGL contexts. Oldest context will be lost." The limit on Android is 8 in Chromium's source; that number was not measured here. Same-origin frames count towards the same limit. |
| How many WebGL contexts do pages hold after loading, with no WebGPU? | `/slot-effects/` 8, `/shader-css/` 7, `/select/` 4 (2 alive at once), `/physical/` 3, every other page 2 or fewer. With WebGPU in use the first two hold fewer, because each element uses a WebGPU canvas on the shared device. |
| What do live checks add? | With checks running, `/shader-css/` and `/slot-effects/` made 22 WebGL contexts each, `/physical/` 14, `/player-fx/` 6, `/audio/` 5, `/video/` 4. Fixtures that removed their canvas without losing the context kept counting until garbage collection. With a limit of 8 that takes contexts from the visible demo. |
| Does `pickBackend()` cost a context? | Yes, before this change. `webgl2()` in `shared/backend.js` made a WebGL 2 context on every call and left it to the garbage collector. |
| Does one WebGPU device serve the whole page? | Yes. `webgpu()` opens one device and every caller shares it. No page asked for a second device on load. |
| What does a page show when a visible WebGL canvas loses its context? | Forced with `WEBGL_lose_context` on every visible WebGL canvas, per page. `/video/`, `/audio/`, `/player-parts/`, `/view-transitions/`, `/shader-css/`, `/physical/`: the elements fall back to plain HTML with a note. `/slot-effects/`: new contexts are made and drawing continues. `/three-form/`, `/xr/`: the page's own message. `/native-ui/`, `/embed/`, `/player-fx/`: nothing, an empty canvas. These three now get the guard's note. No renderer crash in any of these runs. |
| Can the whole GPU process be lost in the test browser? | No. `chrome://gpucrash`, `chrome://gpukill` and `chrome://gpuhang` opened in a second tab changed nothing in the first. A GPU process restart, which loses every context at once including 2D canvases, is untested. |
| Does `loseContext()` on a removed drawable canvas crash? | Not in a minimal page: a drawable WebGL canvas with an uploaded element texture, with a `<div>`, an `<iframe>` or a `<video>` child, removed and lost in four orders, 12 runs, no crash. Other threads have seen crashes in fuller pages (context lost while the canvas is in the page; lost and removed in one task; an iframe child). The guard avoids all three cases. |

## What changed

- `public/shared/context-guard.js`, loaded by `nav.js` on every page before page scripts. It counts contexts, takes the context of removed WebGL canvases when the limit is near, asks a restored 2D canvas to paint, and puts a note with a Reload button and the counts over a visible canvas that is still lost after 1.5 seconds.
- `shared/backend.js`: `webgl2()` asks once and gives its context back. A lost WebGPU device is remembered for ten minutes per tab, and pages use WebGL in that time. `?webgpu=retry` clears it.
- `lib/surface.js`: `SurfaceElement` falls back to plain HTML on `webglcontextlost` too, when the subclass does not recover.
- `npm run check:jank` counts contexts with the limit of 8 and fails a page that holds more than 8 WebGL contexts at once (`glContexts`) or shows the guard's note (`lostCanvases`).

## Not verified, needs the phone

- Which context is lost on the phone and why. If a canvas is lost again, the note over it lists the contexts made, the WebGL contexts alive and each loss with its time and reason. That line identifies the cause.
- Whether a 2D drawable canvas fires `contextlost` and `contextrestored` on Android, and whether `requestPaint()` after the restore redraws it.
- Whether the WebGPU device is what is lost. After a loss the "Drawn with" line on pages such as `/shader-css/` gives the reason, and the next page load in that tab uses WebGL.
- `/shader-css/` and `/slot-effects/` on a phone with no usable WebGPU hold 7 and 8 WebGL contexts. Running their checks there makes a ninth, and one visible effect falls back to plain HTML. Fewer contexts on those pages (one shared context, as `fx-backend="shared"` does) would remove that.
