# Third-party notices

PIVOT's own code is under the [MIT License](LICENSE). It depends on third-party packages that keep their own licenses. A scan of the production dependencies on 2026-11-18 found 527 packages:

- **Permissive:** 444 MIT, 34 Apache-2.0, 20 ISC, 20 BSD-2/3-Clause, plus a few BlueOak-1.0.0, 0BSD and Unlicense.
- **CC-BY-4.0:** `caniuse-lite`, the browser-support data that the build tools use.
- **Not open source:** GSAP, described below.

## GSAP (`gsap`, `@gsap/react`)

- **Used by:** `apps/web` for the Library and References page motion (ScrollTrigger, Flip).
- **License:** GSAP's [Standard "No Charge" License](https://gsap.com/standard-license), from Webflow. It is free, including for commercial use, but it is **not** an open-source license, and the MIT License does not apply to GSAP.
- **What it prohibits:** using GSAP in a tool that lets people build visual animations without code and competes with Webflow's visual animation builder, without Webflow's written consent. It also prohibits removing or altering GSAP's proprietary notices. PIVOT is not such a tool.
- **What it doesn't address:** the license text does not mention npm packages, bundled builds or open-source projects.
- **If you fork PIVOT:** read the license yourself before you ship or redistribute a build that includes GSAP, especially if your fork adds a visual animation builder.

## Tools downloaded at run time

- **Chromium:** Playwright (Apache-2.0) downloads its own Chromium build the first time PIVOT captures a page. Chromium and the bundled ffmpeg come with their own licenses, which Playwright installs alongside them.
- **sharp:** sharp (Apache-2.0) installs prebuilt libvips binaries, which are under the LGPL-3.0.
