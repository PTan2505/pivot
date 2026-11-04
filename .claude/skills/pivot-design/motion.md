# Motion

Shared by `pivot-design` and `pivot-redesign`. Motion is part of the design: it is classified, briefed, previewed,
approved and checked like layout and type, never added as an effect during the build. Most screens need little or
none: don't force animation onto work that doesn't ask for it.

## 1. Levels

| Level        | What it covers                                                                                                                                                   | Mockups                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **None**     | Only what the interface needs to work: instant state changes, the platform's own focus and scroll.                                                               | Static                                                           |
| **Standard** | Micro-interactions, hover and focus feedback, entrances, modal / accordion / tab / toggle transitions.                                                           | CSS motion in the PIVOT mockups (§5)                             |
| **Advanced** | Scroll storytelling, pinned sections, scroll-linked sequences, parallax, SVG morphing, interactive illustrations, complex timelines, 3D. Always with a fallback. | Directions first, then an executable preview of the top 1–2 (§5) |

## 2. Classify

At `pivot-design` §1 (or `pivot-redesign` §0), write one line:

`Motion: none | standard | advanced — <reason> (auto | set by you)`

- **The user's words decide** when they say anything about motion ("no animation", "subtle transitions", "scroll
  storytelling like X"): mark it `set by you`.
- **Otherwise classify from the surface and the request** (`auto`):
  - **none** by default, and for forms, settings, data-dense app screens, docs and fixes that don't mention motion;
  - **standard** when the request or the brief's directions involve interaction feedback or transitions (a toggle,
    tabs, a menu, a modal, a carousel, entrance of a hero), or the project's design system defines motion tokens the
    surface should use;
  - **advanced** only when the request asks for one of the Advanced effects, or a chosen reference's evidence (§3)
    shows it as the point of the page.
- **Re-check once, after the user picks references** (`pivot-design` §4): the picks can raise the level; the user can
  lower it. Don't change it again after the brief unless the user asks.
- Write the level in the brief header. Level **none** adds nothing else to the workflow.

## 3. Motion references

A screenshot can't show motion. For every reference that informs motion, say what you actually saw:

| Evidence                   | Meaning                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `observed live`            | You opened the page in a browser tool (with the user's permission) and triggered the behaviour yourself. |
| `keyframes`                | You looked at the reference's motion keyframes in PIVOT.                                                 |
| `video exists, not viewed` | PIVOT lists a motion recording (`get_reference` shows "motion keyframe" screenshots) you couldn't view.  |
| `screenshot`               | Only still images.                                                                                       |
| `metadata only`            | Title, description, catalog text.                                                                        |

- Describe, where the evidence allows: trigger; behaviour; sequence; timing and easing; interaction states; relation
  to scroll; responsive behaviour; reduced-motion behaviour; the source link.
- Mark each of those as **observed** or **inferred**. Never describe an animation as seen when you only had a still or
  text; "probably fades in" is inferred.
- For animation components outside the library, `search_external` with generic words ("animated tabs", "scroll
  reveal"); their results are metadata only unless you open them.

## 4. Motion block in the brief

Only when the level isn't **none**. Keep it proportional: about 6 lines for Standard, up to about 15 for Advanced. Tag
each item **essential** (it defines the direction; the user must see it before approving) or **detail**.

```md
**Motion:** <standard | advanced> (<auto | set by you>): <objective: what the motion is for>

| Item   | Trigger → behaviour              | Timing / easing    | Reduced motion      | Tag       |
| ------ | -------------------------------- | ------------------ | ------------------- | --------- |
| <name> | <click on X → thumb slides to Y> | <200 ms, ease-out> | <cross-fade 150 ms> | essential |

- **References:** <title (evidence): take / leave>
- **Responsive:** <what changes on phone>
- **Performance:** <transform and opacity only; budget, e.g. no layout shift, 60 fps on a mid-range phone>
- **Fallback:** <what shows without scripts or support> (Advanced)
- **Technology:** <CSS | WAAPI | the project's existing library>, because <reason> (§7)
```

## 5. Previewing motion

The user must be able to see each **essential** item before gate 2 (§6).

- **CSS motion in PIVOT (Standard).** Mockups saved with `save_design_mockups` keep inline CSS but lose every
  script. Transitions, `@keyframes`, `:hover`, `:focus-visible`, `:checked`/`:target` state tricks and CSS
  scroll-driven animations (`animation-timeline`) can show most Standard motion. Also draw the end states statically,
  so the version reads without motion. The session page has **Replay** (a fresh frame, so motion restarts with
  nothing left from the last run) and a line saying whether the browser has reduced motion on.
- **Executable local preview (Advanced, or any essential CSS can't show).** Build only the top 1–2 directions as
  interactive prototypes, in the same scratch folder, and run the local viewer with them marked interactive:
  `node <skill>/viewer/make-viewer.mjs <folder> --title "<surface>" --interactive <n,…>`.
  - Scripts must be inline or local files inside the folder (a library copied from the target's own
    `node_modules`, when its licence allows). Nothing is fetched: the viewer runs each version in a sandbox with no
    network, no access to other files, no navigation of the page and no popups, and lists anything it removed. Each
    version shows a content **digest**; a choice copied from the viewer names it.
  - **What is tested and what isn't** (`scripts/qa/preview-checks.mjs viewer`, Chromium): fetch, images, styles,
    WebSocket, `sendBeacon`, forms, nested frames, `object`/`embed`, popups, top navigation, reading the viewer page,
    storage and other local files were all blocked before any request left. A script navigating its own frame
    can't be blocked by any policy: in the checks that request didn't leave either, and the viewer then stopped the
    version, but don't rely on it, so keep prototypes free of redirects. Not covered by the checks: DNS prefetching
    (the viewer asks the browser not to prefetch, unverified) and WebRTC from an interactive script, and browsers
    other than Chromium. The inliner's markup rewriting is a
    convenience, not the protection: the sandbox and the policy are.
  - Static versions stay script-free in the viewer too.
  - Save the static versions (and a static stand-in for each prototype) to PIVOT as usual, so the session holds them.
- **Reduced motion uses the browser's own media query**, never a rewrite of the mockup's CSS or a fake `matchMedia`.
  Three kinds of evidence, never merged into one:
  - **browser emulation** (Chrome DevTools › Rendering › _Emulate CSS media feature prefers-reduced-motion_, or
    Playwright): checked in Chromium, both `reduce` and `no-preference`, live and after Replay, to reach the static
    and interactive versions in the local viewer and PIVOT's mockup frame, and to flip both pages' indicator;
  - **the OS setting** (macOS/Windows/iOS "Reduce motion"): the native path, but not checked automatically: it is
    verified only when the user turns it on and says what they saw;
  - **a real device**: unverified unless the user checked it.
    The local viewer and PIVOT's session page show which setting the browser currently reports.
- A recording, keyframes, a screenshot or a description is not an executable preview.
- **Check it yourself before gate 2:** open the preview with the browser tool you have and trigger every essential
  item. An item you didn't see run doesn't count as previewed: fix the prototype, or offer the exception (§6).

## 6. Approval (inside gate 2)

There is no separate motion approval: the user approves the direction **and** its motion at gate 2.

| Level    | Before gate 2 can approve                                                                                                                                                         | Add to the approval's `details`, after the user's exact words                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| None     | Static mockups.                                                                                                                                                                   | –                                                                                                                                                |
| Standard | Each **essential** item visible in CSS motion in PIVOT or in the local viewer, and seen running by you; details may be described.                                                 | `Motion: standard — previewed (pivot-css \| local, digest <d>) — essentials: <list>`                                                             |
| Advanced | **Every essential item in the executable local preview**, seen running by you (until PIVOT can run interactive mockups). Screenshots, keyframes, recordings and text don't count. | `Motion: advanced — previewed (local, digest <d>) — essentials: <list> — reduced motion: <emulated \| OS setting, by the user \| not previewed>` |

- **Exception.** If an essential item can't be previewed, say which one, why, and what the user would approve
  instead, in the gate-2 message itself (not as an extra step), and ask once. Only an explicit yes counts; record
  `Exception (owner): "<exact words>" — essentials not previewed: <list>`. Without a preview or that yes, don't
  build: don't call `set_design_status` with `building`.
- An approval made in PIVOT counts for motion only when the user could see the preview (the version itself, or the
  local preview of the version they approved) and the note doesn't reject the motion. A static version or its
  screenshot is never counted as the executable preview.
- **What an approval is bound to, today:** a PIVOT approval names its version by title and round, and PIVOT keeps
  that mockup's HTML unchanged; a local preview is named by its digest in the `Motion:` line. The local prototype
  itself isn't stored in PIVOT, so keep its folder until the build is checked. Binding an approval to an immutable
  mockup identity in PIVOT itself comes before interactive mockups move into PIVOT (P1b).
- A note or reply that changes an essential item is a major change: back to gate 2.

## 7. Technology

Choose in this order, and write the choice and its reason on the brief's **Technology** line:

1. What the target project already uses for motion (its CSS conventions, or a library already installed, such as
   Motion, GSAP or Rive).
2. CSS transitions, `@keyframes` and scroll-driven animations.
3. The Web Animations API, for sequences a script must control.
4. Add a library (Motion, GSAP and its ScrollTrigger) only for what the above can't do well (complex timelines,
   cross-browser pinning, SVG morphing, Flip layouts), and say why. Rive or Lottie only when the asset exists.

Never add a dependency without that reason in the approved brief. The `gsap-*` skills are consulted only when GSAP is
the chosen technology.

## 8. Build

- Animate `transform` and `opacity`; no layout shift.
- Every motion has a reduced-motion path (gentler or none), exactly as briefed.
- Interruptible: a second input retargets, doesn't queue or jump.
- Clean up on unmount: listeners, observers, timelines, `requestAnimationFrame` loops.
- Keep the approved timing and easing; a different feel is a deviation (`pivot-design` §10).

## 9. QA

Check each approved item, at desktop and phone width:

- trigger correctness; initial and final states; timing and sequence; hover, focus, click and keyboard;
- scroll behaviour (Advanced);
- reduced motion: the briefed path, with the browser's emulation;
- no layout shift, no long frames, listeners and timelines cleaned up after leaving the view;
- the fallback (Advanced);
- fidelity to the approved preview; accessibility (focus visible, nothing that flashes).

Report evidence as `pivot-design` §10 says: what you generated, what you actually looked at, what you hand over, and
what is **unverified**. A behaviour you couldn't trigger or measure is unverified, never a pass; behaviour on a real
device is unverified unless the user checked it and said so.

## 10. Budgets

- Executable prototypes: the top 1–2 directions only.
- Motion references: they share the task's image budget.
- A motion specialist counts toward the specialist limits (`specialists.md` §2).

## In `pivot-redesign`

- A change to motion behaviour is an **interaction** change, so it is **Major**.
- A Minor (styling-only) redesign keeps existing motion exactly as it is, and its checks confirm that.
