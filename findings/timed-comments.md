# Timed comments that cross the video (`/timed-comments/`)

Measured in Chromium 157 headless (C157) with software video decoding, 2026-11-21. The clip is `public/media/clip.webm`, which carries its frame number as stripes in the picture.

| Experiment | Result | Notes |
| --- | --- | --- |
| `video.addTextTrack('metadata')` as the store for comments | works | The track starts in the `hidden` mode. Each comment is a `VTTCue` from its time for 4 s with JSON as its text. `activeCues` held all three test cues at 2.5 s and two at 5.2 s. |
| One `drawable` child of the canvas per active cue, added and removed while the video plays | works | `lib/cue-layer.js` with a `render` function. A child added since the last paint cannot be drawn yet: `drawElementImage()` throws, the handler skips it and asks for another paint. |
| Position from the frame's media time | within 1.5 px of the formula | `x = W − (t − start) ÷ 4 × (W + width)`. `getBoundingClientRect()` of each comment matched it at 3.0 s. |
| Is the comment placed for the frame that is in the picture? | 45 of 45 paints | During 1.5 s of playback the paint handler read the frame number from the stripes it had just drawn and compared it with the `mediaTime` from `requestVideoFrameCallback()` that the comments were placed for. |
| Hit test on a rotated, moving comment | works | In the wave mode at −0.14 rad, `elementFromPoint()` at the drawn centre returned the comment's button. After a seek that moved the comment 100 px, the same point returned the video. The stale hit-test answer seen with `updateElementGeometry()` did not appear with 2D `drawElementImage()`. |
| Click on a comment, then on the Like button of the opened card | works | The click paused the video and opened the card. The Like button was hit at its drawn place. The count is written into the cue's `text`, so it is still there after the clip loops. |
| A real touch tap on a comment (test driver, phone emulation) | works | The card opened with Like, Go to and Close. |
| `globalCompositeOperation = 'difference'` for one `drawElementImage()` call | works | 700 of 900 changed pixels were the inverse of the frame under white text. |
| Frame-by-frame export with `exportFrames()` | the same step in every frame | 12 frames. The comment moved 3.23 px per frame with a largest error of 0.06 px. The cues for each frame time are chosen by comparing times, because `activeCues` updates only after the seek. |

## Things that bit

- The status line was written before the paint and showed the last paint's count of drawn comments. It is now written from a `paint` listener registered after the drawing one.
- With `layoutsubtree`, the comment elements need `position: absolute` so that twelve of them do not change the layout of the video and the bar.
- A comment that starts in the last 4 s of the clip is cut off at the loop, because its cue cannot run past the end of the video.

## Not verified

- The frame match with a hardware decoder on Android. The third live check reports it on the device.
- Tapping a moving comment with a finger, and the cost of 30 or more comments on a phone. The line under the player shows how many are drawn in each paint.
- The third check reads one row of a 320×180 fixture per frame for 1.5 s. It reads a `drawImage()` copy on an `OffscreenCanvas`, not the drawable canvas, and no drawable canvas on the page is made with `willReadFrequently` (that option loses every 2D context on an Android phone). It is not used by the visible player.

## For the index

- Media: comments as `VTTCue`s in a `metadata` track give the set of elements to draw at any time. measured, C157, `/timed-comments/`.
- Hit testing: 2D `drawElementImage()` under a rotation moves the hit box, and the old place stops answering after the next draw. measured, C157, `/timed-comments/`.
- Drawing: blend modes (`difference`) apply to `drawElementImage()`. measured, C157, `/timed-comments/`.

## Open ideas

- Comments that pass behind a subject, with a segmentation mask of the frame as the clip.
- A density strip under the frame drawn from the same cues, where a tap seeks.
- Comments from another tab over `BroadcastChannel`, added as cues at the current time.
