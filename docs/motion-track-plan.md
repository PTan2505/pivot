# Motion you can read: measure a reference's motion instead of guessing from stills

Approved by the owner on 2026-11-22, after a discussion of how PIVOT could read a reference's motion. Each phase below is its own branch from `dev` and its own pull request, updates [SPEC.md](SPEC.md) in the same change, and is logged in this file's progress section.

## The problem

- **What exists.** "Record motion" (Retake menu, `recordScroll` in `packages/core/src/capture.ts`) scrolls the page top to bottom under a virtual clock. Every frame advances the page's clock by exactly 1/30 s and steps CSS and Web Animations with it (`stepAnimations`). It writes a 30 fps webm and keeps up to 8 keyframes (`MAX_KEYFRAMES`).
- **What Claude gets.** `get_reference` returns `motionEvidence`. Its limitations say timing and easing weren't measured. `get_reference_images` `which: "keyframes"` sends full-screen stills, about 1,728 tokens each and 13,824 for 8. Nothing about duration, easing, stagger, pinning or hover. What happens between two stills is guessed.
- **What it wastes.** At every frame the recording already knows the exact time and scroll position; it throws that away and keeps pictures.
- **The result.** In the landing session (2026-11-22) all three references had no recording, so every motion line in the brief was inferred. A recorded reference would still have given only stills.

## The goal

Claude reads a reference's motion as numbers, with a picture only where a picture helps, at a fraction of today's tokens:

| What Claude gets                                                                 | Tokens (Python estimate) |
| -------------------------------------------------------------------------------- | ------------------------ |
| Today: 8 full-screen keyframes, no timing                                        | about 13,800             |
| Motion table: up to 24 items of about 125 characters (M0: median 791, max 1,039) | about 790                |
| One element filmstrip: 4–6 frames, the whole strip capped at 960×320             | about 410                |
| Table plus one filmstrip                                                         | about 1,200              |

Every motion item carries where its numbers come from:

- `exact`: the page declared it (a CSS transition or animation, a Web Animation, a GSAP tween or ScrollTrigger).
- `measured`: PIVOT watched it change frame by frame; the numbers are fitted, with their error.
- `seen`: only pictures show it (canvas or WebGL, video).

`inferred` stays the agent's own label in the brief, never PIVOT's.

## The owner's decisions (confirmed 2026-11-22)

| Question                               | Recommendation                                                                                                                                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| When is motion measured?               | **With "Record motion" only**, as SPEC decisions #20–23 and #47 say ("never turned on automatically"). M0 measured an automatic light scan on save: median 28 s and up to 122 s for a faithful one, so it stays out. |
| Keyframes and the video                | **Kept** as they are. The motion track is a new asset next to them; nothing is migrated or deleted.                                                                                                                  |
| Hover and click                        | **Phase M3**, after scroll. It probes a small sample under the same safety rules as "Load more": nav items, buttons, cards, `role=tab`, `aria-expanded`. Never links, forms or anything that submits.                |
| Motion QA against the reference        | **Phase M4.** `motion-qa.mjs` already compares the build with the brief using the animations it declares. It gains the measured tracks (for motion made by scripts) and a reference comparison.                      |
| References recorded before this change | **Recorded again by hand** (Retake → Record motion) when they matter. A "measure again" for a whole collection is out of scope here.                                                                                 |

## How it works

### 1. Declared motion (`exact`)

During the recording loop, after each frame step, PIVOT reads:

- `document.getAnimations()`: element, property, from → to, duration, delay, easing, iterations, and the scroll position and time when it started. Transitions are caught when they start. A small `transitionrun` listener installed with the clock records ones that start and finish between two frames.
- `window.gsap` and `window.ScrollTrigger` when present: each trigger's start and end (as scroll positions), scrub, pin and snap; each tween's duration, ease, stagger and targets.
- `window.lenis` (or a Lenis instance on the root) when present: lerp or duration. This is the scroll smoothing.

`getAnimations()` and the element diff are read in an isolated world, so the page's own scripts can't see them or answer for them. GSAP, ScrollTrigger and Lenis live on the page's `window`, which an isolated world can't see (M0), so they are read in the main world, read-only, once at the start and at each rest, never every frame: on a busy WebGL page a main-world call waited up to 3.7 s. A GSAP tween can only be read while it runs; a bundled GSAP that isn't on `window` falls back to `measured`. GSAP's `power2.out` is the same curve as `easeOutCubic`, so the two are one name.

### 2. Measured motion (`measured`)

For motion done by script without a declared animation:

- At each frame, PIVOT reads transform (as translate, scale, rotate), opacity, clip-path, filter blur and the box of the elements that changed since the last frame, at most 40 at a time. It picks them by a cheap diff of box and computed style on the elements in view plus a margin of half a viewport above and below (without it, staggered items that start just off screen were cut short by up to 6 frames in M0), and follows any element with a running declared animation wherever it is.
- Scroll inside an inner container (rauno.me) is detected, so a page that scrolls inside a box doesn't turn its content into false pins.
- Springs (`linear()` easings with many stops) are shown as "spring, N ms"; an interrupted spring is folded into one item; keyframe animations show their ranges, not only the first and last frame.
- Items get a stable identity (element and selector, rounded values), so two recordings of the same page give the same table where the page itself doesn't change.
- Each element's samples are cut into segments: start time or scroll position, end, the property, from → to.
- Each segment is fitted to the standard curves (linear, ease, ease-in, ease-out, ease-in-out, and common `cubic-bezier` and `expo`/`back` shapes), with the error. Below a threshold it is named; above it, it is "custom" with 5 sampled points.
- Then PIVOT groups what belongs together:
  - siblings starting at a regular interval become one item with a stagger;
  - an element fixed while the page scrolls becomes a pin, with its range;
  - an element moving at a steady ratio of the scroll becomes parallax, with the ratio; one that follows the scroll with a lag (lerped) is still parallax, marked smoothed, not a timed "custom" curve;
  - motion tied to scroll position (scrubbed) is told apart from motion that plays once in time.

### 3. Pictures only where they help (`seen`, or on request)

- **Element filmstrip:** for one motion item, 4–6 frames cropped to the box the element moves through, tiled into one image capped as a whole at 960×320 (about 410 tokens), picked by legibility (a move reads better than a crossfade) and preferring motion that plays while the page rests, since scrolling mixes into the frames otherwise, with each frame's time or scroll position. It is cut from the recording's frames at capture time and stored with the track. It is not made from the video later.
- **Canvas, WebGL and video:** PIVOT can't read these as DOM. A pixel diff between frames finds the regions that change and for how long. They become `seen` items with a filmstrip and no easing.

### 4. Stored and served

- **New asset role `motion-track`:** JSON with the items, the source of each, the viewport, the frame rate, the libraries found and the limits. The filmstrips are stored as `motion-strip` images. Both go through the blob store and are included in backups.
- **MCP:**
  - `get_reference` returns a `motion` table in place of today's `motionEvidence` text when a track exists. Each item has: id, trigger (load, scroll range, hover, click), target (a readable name plus selector), properties from → to, duration or scroll span, delay, easing (with the fit error when measured), stagger, pin or parallax, and source. `motionEvidence` stays for references with keyframes only.
  - `get_reference_images` gets `which: "motion"` with an `item` (or the items a filmstrip exists for). It counts toward the image budget like the others.
  - Caps: at most 24 items in a reply (the most visible first: largest area, then earliest), and the rest counted.
- **PIVOT's reference page:** the detail page shows the motion table under the recording (read-only, the same items), so the owner sees what Claude will read.
- **Skill:** `motion.md` §3 gains the new evidence labels (`exact`, `measured`, `seen` from PIVOT) and says to read the table first and ask for a filmstrip only for an item that matters. The brief's Motion block cites item ids (for example "Vercel M3: fade + rise 16px, 600 ms, ease-out, exact").

## Phases

**M0. Spike (no PR, scratch only).** Measure on 6–8 real pages from the library: GSAP with ScrollTrigger, Lenis, CSS-only, Framer Motion, canvas, plus one heavy page.

- How many elements change per frame.
- What the measuring adds to a recording's time.
- Whether the easing fit holds against known values.
- What an automatic light scan on save would cost.

Report the numbers, then go on to M1 or adjust.

**M1. Measure scroll motion and serve the table** (`feat/motion-track`):

- `capture.ts`: the declared and measured layers inside `recordScroll`, and the `motion-track` asset. Also fixes the clock race M0 found: `page.clock.pauseAt(now + 1)` throws "Cannot fast-forward to the past" when the page's clock moved past `now` (7 of 55 runs, 3 failed outright); it retries with a fresh time.
- `packages/core`: the track's types, segmenting and easing fit (pure functions, unit-tested), backup.
- `packages/mcp-tools`: the `motion` table in `get_reference`.
- Fixture pages with known motion, all in the test folder and served locally:
  - CSS 300 ms ease-out;
  - a staggered list (80 ms);
  - a GSAP scrubbed parallax;
  - a pinned section;
  - a Lenis page;
  - a JS `requestAnimationFrame` fade.

  The tests require durations within one frame (33.3 ms at 30 fps), stagger within one frame, the right easing name, and the right pin and parallax ranges. Recording runs only against a scratch PIVOT.

- SPEC (§ capture, MCP), `motion.md` §3, versions.

**M2. Element filmstrips and moving pictures** (`feat/motion-strips`):

- Filmstrips cut at capture time.
- `which: "motion"` in `get_reference_images`.
- Canvas, WebGL and video regions as `seen` items.
- The motion table on the reference page (DESIGN.md).

**M3. Hover and click** (`feat/motion-interactions`):

- After the scroll pass, PIVOT probes a sample of interactive elements under the safety rules above. It reads the transitions that run, with their numbers, and a filmstrip for the clearest few.
- Items get `trigger: hover` or `click`.

**M4. Motion QA reads the same tracks** (`feat/motion-qa-tracks`):

- `motion-qa.mjs` measures motion made by scripts with the same code (today it reads only declared animations and applies no tolerance).
- It can compare a build's item with the reference item the brief cites, within one frame and by easing name.
- `motion.md` §9 and the QA report say which checks were exact, which were measured and which were not verified.

## Versions

Each phase that changes `packages/core`, the app or MCP output is a minor bump of pivot-studio and of the plugin, unless a pending unreleased minor already covers it. Today 0.5.0 and 0.6.0 are pending; if they are released first, M1 makes them 0.6.0 and 0.7.0. A new asset role needs no migration: `assets.role` is a text column (`schema.ts`), and only the `AssetRole` type in `packages/core/src/types.ts` gains `motion-track` and `motion-strip`.

## Risks and limits

- **Heavy pages.** Measuring 60 elements per frame could slow a recording that already takes minutes on long pages. M0 measures it. The cap and the visible-only rule keep it bounded, and the 300 s budget stays.
- **Libraries change.** GSAP, Lenis and Framer Motion internals are read defensively. When a read fails, the item falls back to `measured`.
- **Easing on scrubbed motion** follows the scroll, not time. Such items report the scroll range and the ratio, not a duration.
- **The sample is not the page.** Hover and click cover a sample; the reply says how many were probed.
- **Pages that detect automation** may skip their motion; the track then says "no motion found", never "none".

## Out of scope

- Viewing the video itself through MCP.
- Recording on every save (unless the owner decides it after M0).
- Re-recording a whole collection.
- Motion of pages behind a login.

## Progress

### M0: spike (2026-11-22)

Scratch only, no repo change. A copy of `recordScroll` (same constants and clock) on 8 library pages (apple.com/airpods-pro, linear.app, raycast.com, resend.com, vercel.com, posthog.com, rauno.me, cal.com) and 7 local fixture pages with known motion. Every number computed in Python from the runs' JSON.

- **Cost of measuring:** about 2.75 ms per frame (median of page medians; worst p95 7.2 ms), 2–16 % of the recording loop, 45 % on raycast because of per-frame main-world calls (now once per rest). Wall-time differences between runs are dominated by screenshot timing noise (vercel measured 39 % faster than its baseline).
- **Changed elements per frame:** median 2–7, p95 4–12; only linear went over 40 (14 frames). A cap of 40 gives the same items as 60.
- **Accuracy on the fixtures:** all seven within one frame (33.3 ms) once a half-viewport margin is measured; script-driven motion reads 12–26 ms short. Easing named right on all seven; for script-driven motion the best fit is only 1.6–2.3× better than the next, so those names are weaker.
- **Table size:** median 791 tokens for 24 items, max 1,039.
- **Stability:** two recordings of the same page share 16–100 % of their items (live demos, interrupted springs). M1 adds stable identity and rounding.
- **Automatic light scan on save: not cheap.** Faithful only when it waits for real rendering: median 28 s with page load, up to 122 s. Without rendering (median 8 s) it loses scroll-linked motion and shifts triggers. It also needs the fake clock installed before the page loads. "Record motion" stays the only way to measure; at most a cheap probe (declared animations and canvases at load) could set `motionLikely`, as a separate decision.
- **Filmstrips:** a sliding label is clearly legible (149–189 tokens); a card that fades in while the page scrolls is legible but mixed with the scroll; a crossfade barely reads. Hence the whole-strip cap and the legibility rule above.
- **Untested:** real GSAP, ScrollTrigger, Lenis or Framer Motion pages (none of the 8 used them; only the GSAP fixtures cover GSAP), the wheel path, canvas/WebGL/video `seen` items, hover and click, a phone viewport, encode time with measuring on. M1's fixtures add a Lenis page.
- **Found:** the clock race in `recordScroll` (fixed in M1, above).

### M1: measure scroll motion and serve the table (2026-11-23)

Branch `feat/motion-track`. Before it, `fix/motion-clock-race` (pull request 156) fixed the clock race M0 found.

- **Built:** `motion-probe.ts` (the isolated-world probe and the main-world GSAP, ScrollTrigger and Lenis read), `motion-fit.ts` (curves, fitting, value parsing) and `motion-track.ts` (segments, items, the table) in `packages/core`; `recordScroll` measures each frame and the capture stores a `motion-track` asset; `get_reference` adds the `motion` table (24 items); `motion.md` §3 and SPEC (decision #37, §12, §10) describe it.
- **Fixtures** (`packages/core/test/fixtures/motion`, `motion-track.test.ts`), recorded through the real capture: a CSS transition (300 ms ease-out), `@keyframes` (600 ms `cubic-bezier(.23,1,.32,1)`), six siblings 80 ms apart, a `requestAnimationFrame` fade (500 ms easeOutCubic: measured 490–510 ms, named right), a sticky pin (scroll 2800–3900, within 40 px), a lerped parallax (−0.3/px, smoothed, within 0.03), a GSAP scrubbed parallax and a tween (exact), and a Lenis-like page scrolled with the wheel. Two recordings of the same page give the same item keys.
- **Real pages** (screenshotUrl only, nothing saved): posthog.com 52 items, cal.com 47, linear.app 20; 24 lines are 2,900–3,700 characters (about 730–930 tokens). Most items are `exact`. Changes after looking at them: CSS-module classes read as `[class*="_name"]`, utility classes dropped, identity transform steps dropped and decimals rounded, loops of the same animation merged whatever their phase, one-frame jumps shown as such, keys by order instead of rounded scroll positions (those flipped between recordings).
- **Not done here:** filmstrips, canvas/WebGL/video `seen` items and the table on the reference page (M2); hover and click (M3); motion QA against tracks (M4). A real GSAP or Lenis site is still untested; only the fixtures cover them.
