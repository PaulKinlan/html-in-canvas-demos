# Performance (`/perf/`)

The page ramps 10 to 1,600 moving elements per renderer and reports where the frame rate falls below 90% of the display's refresh. Numbers from headless Chromium use software rendering and only show the shape; run it on real hardware for the wall.

- Script is not the limit. A `drawElementImage` call costs about 7 µs, so 200 cards is roughly 1 ms of a frame. Rasterising and compositing run out first.
- In software rendering the 2D canvas carried more moving cards (200 at 60 fps) than the same cards as individually composited DOM layers (100).
- A worker holding `ElementImage` snapshots costs the main thread nothing per frame when content is static. With the main thread blocked 40 ms per frame, a main-thread canvas drops to 23 fps and the worker stays at 60 fps (content updates at the main thread's rate, motion stays smooth).
- The worker has no advantage when every element changes every frame: each one needs a fresh snapshot captured on the main thread.
