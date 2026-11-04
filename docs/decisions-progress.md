# Decisions — progress log

Tracks [decisions-plan.md](decisions-plan.md). Newest first.

## Design Orchestrator v2

Tracks [design-orchestrator-v2.md](design-orchestrator-v2.md). Each phase is authorised separately.

| Phase | Name                                   | Status        |
| ----- | -------------------------------------- | ------------- |
| P0a   | Skill contract tests and trace checker | Done (PR #61) |
| P0b   | Specialist spike, then routing         | Done (PR #62) |
| P0c   | Motion foundation                      | Done (PR #63) |
| P0d   | Preview controls and hardening         | Done (PR #64) |
| P1a   | Motion reference evidence              | Done (PR #65) |
| P1c   | Motion QA                              | In review     |

### P1c — Motion QA (2026-11-04)

- Status: In review (PR into `dev`).
- Existing functionality reused:
  - the approved brief and approval from `get_design_session`;
  - the P0c viewer, for previews: its sandboxed frame, its policy and its own Replay button;
  - PIVOT's Playwright and Chromium, found from the skill's real path (A6 verified: it resolves through the `~/.claude/skills` link);
  - `trace-check.mjs` for the L3 run.
- Files changed:
  - new `.claude/skills/pivot-design/scripts/motion-qa.mjs`;
  - `motion.md` (§4: M-numbers; §5: recordings accompany a preview, never replace it; §9: the QA workflow), `pivot-design` §10, `pivot-redesign` QA;
  - `scripts/trace-check.mjs`: counts `node …/motion-qa.mjs` runs apart from specialists;
  - tests: new `motion-qa.test.mjs`, `skills.test.ts`;
  - SPEC, PIVOT_DECISIONS.
- QA contract:
  - each item of the brief's Motion block has an M-number, and the plan, the report and every result use it;
  - each item is Pass, Fail or Not Verified, judged check by check;
  - Pass needs executed observations of every check: the trigger, the motion, its properties, its final state, timing (only when the brief states it), the brief's budgets, the Replay, and reduced motion with its own final state;
  - anything that couldn't run or be observed is Not Verified;
  - the overall status is Pass only when every essential item of the brief passed and every brief item has a check;
  - reduced motion is browser emulation, labelled as such; the OS setting and real devices stay unverified unless the user checked them;
  - timing is compared as declared, with no tolerance invented.
- Checks run and results: see the PR.
- L3: a fresh general-purpose subagent with the `pivot-design` skill and the real MCP, a seeded scratch session (approved brief, status `building`) and a synthetic built page with three planted defects:
  - M1 is hidden with reduced motion;
  - M3 isn't implemented;
  - M6 has the wrong timing.
  - The agent found all three, plus two real issues the fixture didn't plan: M2 plays at load, not on scroll; M6 still animates with reduced motion.
  - It reported overall Fail, edited nothing, recorded nothing, and marked what it couldn't verify.
  - Two harness defects it exposed were fixed: `trace-check` counted reads of the script as runs; the script waited a fixed 300 ms before a trigger, so motion from the load raced the Replay.
- Acceptance review (2026-11-04), defects found and fixed:
  - **Network:** request routing missed redirects (of the page and of subresources) and WebSockets. A probe showed all three reaching another host. Other hosts are now cut off in the network stack: a dead proxy for everything but loopback, workers blocked, and WebRTC limited to the proxy. A browser test confirms nothing reaches another host.
  - **Writes:** a click could send DELETE or POST. Anything but GET, HEAD and OPTIONS is now blocked and listed, unless `--allow-writes`.
  - **PIVOT itself** could be a target, where a click is same-origin with its API (approval). It is now refused, and blocked as a destination.
  - **False passes:** these are now Not Verified, never Pass:
    - an animation seen only finished, which may have run before watching began;
    - an animation that never ran (paused) no longer counts as motion;
    - an element covered at the pointer's position isn't hovered or clicked;
    - scrolling that never reaches its target;
    - a window that ends before the element settles;
    - a target that disappears;
    - motion driven by a script before the trigger (settling now watches the element's values too).
  - **Reduced motion:** it must leave the element as visible as full motion does, even when the brief names no final state.
  - **Evidence:** each run gets a new, empty `--out` and a run id. `--verify` re-checks the files (missing, changed or stray) and caught screenshots dropped from early-stopped observations, which now stay.
  - **Timing check** renamed "declared timing", and the report says it isn't measured on screen.
  - **L3:** the agent's plan, re-run with the hardened runner, gives the same results, so the L3 conclusions stand.
- Final security check (2026-11-04):
  - **Loopback isolation (defect):** the dead proxy let every loopback address go direct, and routing let any loopback port through. A Chromium probe showed an unrelated service on this machine receiving a GET, an alias (`localhost`), a redirect and a WebSocket.
  - Fix: every connection now goes through a gate the script runs (an HTTP proxy, with `<-loopback>` so Chromium sends loopback through it too). It allows only:
    - the preview's exact origin;
    - origins given with `--allow-origin`;
    - with `--allow-remote`, public hosts, resolved once and refused if any address is local or private.

    The plan can't grant any of these.

  - A regression test shows the unrelated service gets nothing (other port, `localhost`, `[::1]`, `0.0.0.0`, a redirect, a WebSocket), while the preview's own reload socket works.
- Remaining issues:
  - Chromium only; reduced motion is emulation; the phone viewport is a narrow window, not touch.
  - WebSockets to the preview's own origin are allowed, and their messages aren't inspected. GET requests to the preview's own server reach it as a user's browser would.
  - Whether Chromium makes DNS lookups of its own (prefetching) wasn't verified; the gate resolves names only with `--allow-remote`.
  - `--verify` proves the files match report.json, not that report.json is genuine (it isn't signed).
  - On-screen timing and smoothness aren't measured; screenshots are near the named moments, not exact.
  - Cleanup after leaving the view, keyboard order, fallbacks and fidelity to the approved preview are hand checks.
  - Inside the viewer's script-free frame, layout shift and long frames aren't measured.
  - The approved local preview isn't stored in PIVOT, so the script can't compare the build with it.
- Next step: P1b, once authorised (it still needs immutable approval binding and the §3.4 security tests).

### P1a — Motion reference evidence (2026-11-04)

- Status: Done. Merged in PR #65 (`34feed6`).
- Owner's choice, made before implementation because the request (structured evidence records stored per reference) and the plan ("no new table") differed: **follow the plan, no migration**. Stored, owner- or agent-written evidence per reference is left for a separate proposal.
- Existing functionality reused:
  - the assets capture already stores: `motion-video` (meta `method`, `capturedAt`, `viewport`, `finalUrl`, `durationMs`), up to 8 `motion-keyframe` stills (meta `keyframe`, `scrollY`) and `state` stills (meta `state`);
  - `AssetDTO.meta`, which the MCP layer already received;
  - `getImage`, `fitImage` and the image budget;
  - core's external-search `category`.
- Files changed:
  - `packages/mcp-tools/src/tools.ts`: `motionEvidenceOf`; `get_reference` returns `motionEvidence`; `get_reference_images` gains `which: "keyframes" | "states"`;
  - `external-tools.ts`, `source.ts`, `apps/mcp/src/http-source.ts`: `category` for `search_external`;
  - tests: `motion-evidence.test.ts`, `motion-evidence.db.test.ts`, `external-tools.test.ts`, `skills.test.ts`;
  - `motion.md` §3 and `pivot-design` §3;
  - SPEC, README, `apps/mcp/README.md`, PIVOT_DECISIONS.
- Evidence rules:
  - `observed` only when PIVOT recorded the page while scrolling, with scope `scroll`, the recording's provenance and its limits (no hover, click or focus; no timing or easing; between keyframes is inferred; the video can't be viewed over MCP);
  - `unknown` otherwise;
  - the system never labels anything `inferred`: that is the agent's label in the brief;
  - malformed metadata is dropped, never guessed;
  - lists are capped at 12, with totals.
- Checks run and results: see the PR.
- Acceptance review (2026-11-04):
  - Setup: a scratch PIVOT on 127.0.0.1:4321 (no Neon, no R2). Linear (`https://linear.app/`) was captured through the normal capture API with `motion: true`, giving 1 `motion-video` (12.6 s) and 8 `motion-keyframe` stills (scroll 0–9060). Vercel was captured without motion. A throwaway target repo held a synthetic `DESIGN.md`.
  - Edge cases found and fixed:
    - with a video but no keyframes, `which: "keyframes"` said "unknown, no recording", contradicting `observed`;
    - invalid dates, a negative duration, viewport or `scrollY`, and a non-object `meta` (which crashed) are now dropped;
    - the Motion line now says when its scroll range covers only the first 12 keyframes;
    - **Claude Code shows only `structuredContent` when a reply has it**, so the keyframe labels and limits in the text never reached the agent. `structuredContent` now carries `images` (with labels), `next` and `limitations`.
  - L3: two runs of a fresh general-purpose subagent, given a neutral user prompt with the `pivot-design` skill and the real MCP, stopping after the brief, judged from their transcripts by `trace-check`.
    - Run 1 used the pre-fix build; run 2 used the fixed build and received the labels.
    - Both runs called `get_reference`, read `motionEvidence` (observed, 12.6 s, 8 keyframes), and called `get_reference_images` with `which: "keyframes"` (keyframes 1–4).
    - Both labelled each claim observed or inferred, cited the reference and the keyframes, and left hover, click and focus "not exercised" and timing and easing "inferred".
    - Images used: 7 and 8 of about 12.
    - Neither run wrote anything to the target.
    - The brief save was refused in both runs: the MCP reads the real `~/.pivot/api-token`, which the scratch instance doesn't share. The brief text was checked from the transcripts instead.
  - What this verifies, and what it doesn't:
    - **Verified (two agent runs):** retrieving motion evidence (`get_reference`, `which: "keyframes"`) and reasoning about it in the brief's Motion block.
    - **Not verified:** that `save_design_brief` persists the brief. Both saves were refused because of the scratch token mismatch.
    - **Not verified:** an independent, fresh Claude Code session that loads the new MCP schema. Both runs were subagents of this session, whose client kept the old `get_reference_images` schema (`which` limited to `cover | fullpage | all`) although the server accepted `keyframes`.
    - The design workflow was **not** run end to end: the runs stopped at the brief, with no mockups, gate 2, build or QA.
  - Known limitation: `fromSlice` is capped at 20, so keyframes or states past the 24th can't be fetched. Capture keeps at most 8 keyframes today.
- Remaining issues:
  - Recordings only cover scrolling; hover, click and focus motion have no captured evidence. Interaction-state stills are static.
  - The video itself can't be viewed through MCP.
  - No owner- or agent-written motion evidence is stored per reference; it lives in the brief.
  - `category: "motion"` returns search links only, because the direct catalogs are component catalogs.
  - The live MCP server runs the build from `pnpm mcp:build`; Claude Code needs a restart to see the new behaviour.
- Next step: P1c, once authorised.

### P0d — Preview controls and hardening (2026-11-04)

- Status: Done. Merged in PR #64 (`cee7a19`).
- Existing functionality reused:
  - the proxy's local-host and write-origin rules, now moved unchanged into a pure helper;
  - the session page's mockup frame and the viewer's Replay;
  - PIVOT's Playwright and Chromium;
  - the scratch start command.
- Files changed:
  - new `packages/core/src/request-guard.ts`: the API's access rules, now testable, with tests;
  - `apps/web/src/proxy.ts`, which calls it;
  - the mockup route (`X-DNS-Prefetch-Control: off`);
  - `components/design-mockups.tsx` (Replay; the live reduced-motion line);
  - the viewer (DNS-prefetch switch);
  - `scripts/qa/preview-checks.mjs` (Replay, reduced motion and API-boundary probes);
  - tests, SPEC, DESIGN, `motion.md`, PIVOT_DECISIONS.
- Proxy changes, as the plan's §3.3 lists them:
  - `Origin: null`, or an Origin that can't be read, on a write is now 403. Before, it made the proxy throw.
  - A cross-site or same-site navigation (frame or tab) to `/api/*` is 403, except `GET /api/design/mockups/:id` and `GET /api/assets/:id`.
  - `GET /api/settings/token` answers only the app's own pages (`Sec-Fetch-Site: same-origin`) and non-browser callers (no `Sec-Fetch-*`). The Settings page is its only browser client (A7 checked).
- Checks run and results:
  - Unit tests: core request-guard 8 of 8.
  - The full suite: see the PR.
  - Browser checks (Chromium, scratch PIVOT on port 4400, two clean runs each): viewer **31 of 31**, PIVOT **27 of 27** (46 of 46 after the security follow-up below).
  - PIVOT API boundary:
    - forged headers via raw HTTP: `Origin: null`, an unreadable Origin and another origin on approve each got 403; the token refused a cross-site fetch and a same-site navigation (403) but answered the app's own page and a non-browser caller (200); cross-site navigation to an API page got 403 and to the mockup 200;
    - a hostile page on another port, served through a recording proxy so the server's real status is known even where the browser hides it (ORB): its iframe, img and fetch for the token got 403, 403, 403; its form and fetch approve got 403, 403; the session stayed exploring with no approval;
    - inside a PIVOT mockup: an `<img>` pointing at the token route **was sent** (the static policy allows `'self'`) and got 403; a link to the token got 403; a `target=_blank` link opened nothing; a remote image never left.
  - Replay, both the viewer and PIVOT: after three quick replays there was one frame and one animation, restarted, with its time going from about 1500–1870 ms back to about 150 ms.
  - Reduced motion through browser emulation, `reduce` and `no-preference`:
    - the viewer's static version stops and plays, live and after Replay, and the interactive version's `matchMedia` follows both ways;
    - PIVOT's mockup stops and plays at once and after Replay;
    - both pages' indicators flip.
- Security follow-up (2026-11-04, same PR): **blind cross-site GETs with side effects**.
  - **Root cause.** The proxy checked writes and navigations but let every read through. A page on another site, another app on this machine, or a sandboxed PIVOT mockup (via `img`/`font` `'self'`) could make the browser send GETs whose routes have effects. The response stayed unreadable, but the effect still happened.
  - **Affected endpoints**, found by auditing every GET route and the core function it calls:
    - `/api/favicon`: fetches the site and stores the icon;
    - `/api/search/external`: may download a provider catalog and store it in R2;
    - `/api/metadata` and `/api/visibility`: fetch the given URL. Private addresses are already refused by `net-guard`;
    - `/api/resources/:id/compare` and `/compare/image`: decode and diff full-size images;
    - `/api/settings/token`: already covered.
  - **Not affected:**
    - other GETs are database or file reads;
    - `/api/assets/:id` can store a scroll preview the first time an old tall image is viewed. It stays open because the extension popup and mockups load assets as images, and asset ids are unguessable. This is noted as a residual.
  - **Policy** (`request-guard.ts`): these reads are answered only for:
    - a caller with the API token;
    - the app's own pages: `Sec-Fetch-Site: same-origin`, with any Origin or Referer also same-origin;
    - a non-browser caller: no Fetch Metadata, and no Origin or Referer from elsewhere.
  - **Refused with 403 by the proxy, before the route runs:** `same-site` (it isn't `same-origin`), `cross-site`, `none`, `Origin: null`, and contradictory metadata. The refusal doesn't rely on CORS.
  - **Compatibility, checked against the code:**
    - the web app calls these routes only from its own pages, with relative URLs, and the server never calls its own API;
    - the extension sends the Bearer token on every API call; its popup thumbnails are `<img>` loads of `/api/assets`, which stay open;
    - the MCP server sends the token when it has one, and is a non-browser caller otherwise;
    - no route contract changed.
  - **Checked:**
    - core request-guard tests: 14 of 14;
    - PIVOT browser checks: **46 of 46**, twice;
    - the four routes, requested by a hostile page's `img`/`fetch` and by a PIVOT mockup's `img`, were each refused by the proxy (its own 403 body, so the route never ran);
    - the app's own page still reached each route;
    - a simulated extension call (token, with Fetch Metadata `none`, `cross-site` or absent) reached `/api/visibility`;
    - a popup-style thumbnail reached `/api/assets`;
    - a wrong token stayed refused;
    - the **real MCP server** (`apps/mcp/dist`) ran `search_external` with and without a token.
  - **Not checked:** the real extension in a browser (its requests were simulated from its code), and browsers too old to send Fetch Metadata (they would be treated as non-browser callers).
- Final authentication check (2026-11-04, same PR):
  - **Token validation is genuine.** It is a constant-time comparison with the saved token after stripping `Bearer `, not a check that an `Authorization` header exists. It runs in the proxy before any route.
  - **Fixed: validation wrote.** Before, it read the token through `apiToken()`, which creates the token file when missing. So any request carrying a made-up token, before a token existed, created the file. Validation now only reads: with no token saved, every candidate is invalid.
    - Tests: `api-token.test.ts` 3 of 3. The "creates nothing" check fails on the old code.
  - **Fixed: loopback binding.** `apps/web`'s own `dev` and `start` scripts had no `-H`, so `pnpm --filter web dev` would listen on every interface. A LAN machine could then forge `Host: 127.0.0.1` and send no Fetch Metadata. Both scripts now bind `127.0.0.1`, as `scripts/start.mjs` already did.
    - This was checked by reading the scripts. The script itself wasn't run, to keep away from the real data folder.
  - **Trust boundary, by design and unchanged:** any process on this machine is trusted. It can read the token file and set any header, so a request with no Fetch Metadata, Origin or Referer is answered, the token route included, exactly as before P0d. Fetch Metadata, Origin and Referer only stop a browser from being used by another page, because pages can't forge them.
  - **Residual, pre-existing:** on a machine shared by several OS accounts, another account can call `127.0.0.1` and read the token through the route.
  - **Boundary probes** (`preview-checks.mjs boundary`, two fresh scratch instances with no token): **64 of 64** each run.
    - Credentials:
      - missing, made-up, empty, `Basic`, and the token in another header: all refused, before and after a token exists;
      - near misses (one character short or long, same length but wrong, doubled, under another scheme): all refused;
      - the real token, also with a lower-case `bearer`: the route runs.
    - No token file was created by any refused request.
    - Path tricks for both a side-effecting route and the token route never reached the route and never returned the token: trailing slash, encoded letters, `//`, `./`, `../`, `%2F`, case, `;`, `%00`, `/%61pi`.
    - `x-middleware-subrequest` variants (CVE-2025-29927 style; Next 16.4.3) and `X-Forwarded-Host/Proto/For` were still refused.
    - A forged `Host` got 403.
    - Contradictory metadata got 403: same-origin with a foreign or `null` Origin, same-origin with a foreign Referer, no metadata with a foreign Origin or Referer, `same-site`, `none`.
    - Two callers still reach the route: the app's own page, and a non-browser caller without a token (intended).
  - PIVOT checks 46 of 46 and viewer 31 of 31, rerun after the fixes.
- Remaining risks, not tested:
  - the interactive viewer's self-navigation (blocked in the checks by an undetermined mechanism, not relied on);
  - DNS prefetching (the `x-dns-prefetch-control` header and meta are best effort, unverified);
  - WebRTC from interactive viewer scripts;
  - browsers other than Chromium;
  - the OS reduced-motion setting and real devices (the user's to confirm);
  - immutable approval binding inside PIVOT, still a prerequisite of P1b.
- Deviations from the plan:
  - the branch is `feat/orchestrator-preview-hardening`, as the owner asked (the plan said `feat/mockup-preview-controls`);
  - the proxy rules moved into `packages/core`, which the plan allowed for testing;
  - the DNS-prefetch switch is an extra best-effort mitigation for a residual P0c listed.
- Next step: P1a, once authorised.

### P0c — Motion foundation (2026-11-03)

- Status: Done. Merged in PR #63 (`281005e`).
- Existing functionality reused:
  - the brief template;
  - the gate-2 approval record (`details` after the user's words);
  - the local viewer and its tabs and keys;
  - PIVOT's mockup sandbox;
  - PIVOT's own Playwright and Chromium for the browser checks.
- Files changed:
  - new `.claude/skills/pivot-design/motion.md`: levels, classification, reference evidence, the Motion brief block, previewing, approval criteria, technology order, build rules, QA, budgets, the redesign mapping;
  - `pivot-design` §1, §4, §5, §7, §8, §9, §10 and `pivot-redesign` §0 and §6, which follow it;
  - `specialists.md` (motion specialists are keyed to the motion level);
  - the local viewer `make-viewer.mjs`, hardened: each version is embedded and sandboxed with a strict policy, local assets inside the folder are inlined, remote or outside references are removed and listed, navigating links are removed, a self-navigating version is stopped, scripts run only with `--interactive`, and there is a Replay button and a live reduced-motion indicator;
  - new `scripts/qa/preview-checks.mjs` (browser checks, dev-only);
  - new tests `viewer.test.mjs` and the motion contract checks in `skills.test.ts`;
  - SPEC, README, PIVOT_DECISIONS.
- Checks run and results: see the PR. Browser checks, twice from a clean load:
  - **local viewer, 17 of 17 passed (21 of 21 after the review below)**:
    - static versions run no script or handler;
    - CSS animation plays and local CSS applies;
    - the interactive version's own script runs;
    - fetch to the network and reading another local file are blocked;
    - runtime images, stylesheets, WebSocket, `sendBeacon` and form posts reach nothing (the counting server got zero requests);
    - popups and top navigation are blocked, and the viewer page and storage can't be read;
    - a version that navigates itself is stopped, and Replay restores it;
  - **A3 on a scratch PIVOT** (port 4400): a CSS animation plays inside the sandboxed mockup frame on the session page.
- Remaining issues:
  - Interactive motion can't be shown in PIVOT itself until P1b. Advanced previews are local and approved in the chat, or in PIVOT on the static stand-in.
  - Self-navigation by a script can't be blocked by policy. The viewer stops the version afterwards; in the checks the request didn't reach the server, but that isn't guaranteed.
  - Reduced motion: browser emulation is checked to reach the sandboxed frames in the viewer and in PIVOT. The OS setting and real devices aren't checked automatically; they count only when the user confirms them.
  - Motion QA is still a manual checklist until `motion-qa.mjs` (P1c).
- Review (2026-11-04), on the same PR:
  - The version policy now goes right after the doctype, or at the very start. Before, it went after the first `<head>`, which earlier markup or a comment could precede.
  - Each version gets a content digest, shown in the viewer and named in the copied choice and in the approval's `Motion:` line.
  - Gate 2: the agent must see every essential item run in the preview itself. A static version, screenshot or recording never stands in. The current approval binding is written down: PIVOT approvals name a version by title and round, and local previews by digest; an immutable binding in PIVOT comes before P1b.
  - Reduced motion: three kinds of evidence (browser emulation, the OS setting confirmed by the user, a real device), and the viewer's residual risks are written in `motion.md` §5.
  - New browser checks: nested frames and `object`/`embed` reach nothing; emulated reduced motion reaches the static and interactive viewer versions and PIVOT's mockup frame; the viewer's indicator follows it.
  - Untested residuals: a script navigating its own frame (blocked in the checks, by an undetermined mechanism, so not relied on), DNS prefetching and WebRTC from interactive scripts, and browsers other than Chromium.
- Next step: P0d, once authorised.

### P0b — Specialist capability spike, then routing (2026-11-03)

- Status: Done. Merged in PR #62 (`6978019`).
- First attempt, in the session that created the agent: blocked. Claude Code loads agent definitions only when a session starts, and returned "Agent type not found". No fallback was used. The spike ran in a new session.
- Spike setup:
  - a scratch PIVOT on port 4321, using PGlite in a scratch folder with no Neon or R2. The user-level `pivot` MCP server listed only the seeded scratch session, so it was reading scratch data;
  - a throwaway target repo with a baseline commit;
  - a temporary `pivot-canary` skill holding a per-run nonce that appeared in no prompt;
  - a handoff folder;
  - 6 runs of `pivot-specialist`.
- How runs were judged: from the real subagent transcripts, with `scripts/trace-check.mjs` plus `git status` of the target. Output was limited to tool names, labels and booleans.

| #   | Capability                                                   | Run(s)                                                      | Result                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Subagent invokes an installed specialist with the Skill tool | R1, R2, R2b, R5                                             | Pass: a `Skill` call for `pivot-canary` or `find-animation-opportunities` in each subagent trace                                                                                                                                                                 |
| C2  | The specialist's real instructions are applied               | R1, R5 (nonce), R2, R2b (gates, kept and rejected verdicts) | Pass: the nonce reached the output only through the Skill call (no Read of the skill file)                                                                                                                                                                       |
| C3  | PIVOT MCP read access                                        | R1                                                          | Pass: `get_design_session` on the scratch session; its marker appeared in the contract                                                                                                                                                                           |
| C4  | Advisory only, target untouched                              | all; R5 was asked to edit and write                         | Pass: no Edit/Write/Bash tool exists in the agent; zero writes in traces; target `git status` clean; R5 declined and said why                                                                                                                                    |
| C5  | Structured result                                            | all                                                         | **Partial.** Structure: PASS (all 8 contract fields every time). Length: EXCEEDED. The canary runs stayed within 400 words (179–272); the real specialist didn't (519, then 470). The 400 words are now a soft budget, not a hard failure. Not re-run for length |
| C6  | Trace tells execution from reading                           | R1 vs R3                                                    | Pass: `ran (skill)` vs `consulted` (Read only), matching each run's own label                                                                                                                                                                                    |
| C7  | Unavailable specialist                                       | R4                                                          | Pass: the Skill call was refused ("Unknown skill"); label `unavailable`; no advice invented, no substitute chosen                                                                                                                                                |

- Trace-checker fixes found by the real traces:
  - a refused Skill call is now labelled `unavailable` (it was `none`);
  - a tool call written twice with the same id is counted once.
- Routing implemented against the proven mechanism:
  - `specialists.md`: the three ways (consult, script, `pivot-specialist`), the four run labels, the contract and the handoff folder; no Skill call in the main thread and no fallback to other agents or `claude -p`; one run per specialist per phase; domain-owner and accessibility/reduced-motion conflict rules; motion specialists in the routing table; the ledger line format.
  - `pivot-design` and `pivot-redesign` follow it, and the mockup count is 2–3 by default (4–5 when breadth helps).
  - SPEC, README, `apps/mcp/README.md`, `CLAUDE.md` and PIVOT_DECISIONS are updated.
- Clean-up: the scratch server was stopped and the canary skill removed; the throwaway target stayed clean.
- Remaining issues:
  - C5 is partial: the 400-word budget is soft, and the orchestrator may summarise a long contract but keeps every recommendation, constraint, conflict and verification item;
  - run labels in the contract are self-reported, though they matched the traces in every spike run (L3 behavioural tests check them against traces);
  - a new or changed agent definition needs a new session.
- Next step: P0c, once authorised.

### P0a — Skill contract tests and trace checker (2026-11-03)

- Status: Done. Merged in PR #61 (`d044d21`).
- Existing functionality reused: the static skill checker kept in a session scratchpad during the skill work (109 checks); the transcript layout Claude Code writes (`<session>.jsonl` plus `<session>/subagents/agent-*.jsonl`, with `tool_use` and `tool_result` blocks, `isSidechain` and `agentId`), confirmed by reading key names and counts only.
- Files changed:
  - new `packages/mcp-tools/test/skills.test.ts`: the static checks as L1 contract tests;
  - new `scripts/trace-check.mjs`: the read-only trace checker and its CLI;
  - new `packages/mcp-tools/test/trace-check.test.mjs`;
  - new synthetic fixtures under `packages/mcp-tools/test/fixtures/traces/`;
  - new `docs/design-orchestrator-v2.md`: the approved plan, with the owner's requirements for later phases;
  - this log.
- Checks run and results: see the PR.
- Manual verification: the trace checker ran on a real session transcript of this repo. It printed names, counts and categories only.
  - It exposed two leaks, both fixed and covered by tests: command text reached the report as a "skill name", and any word after `/skills/` was named.
  - The CLI now names only skills installed in `~/.claude/skills`, `~/.agents/skills` or the target's `.claude/skills`.
- Remaining issues:
  - Shell writes are detected heuristically and are counted separately.
  - An owner approval made in PIVOT isn't visible in a trace. The gate is judged by a successful `set_design_status building`, which the server allows only for an approved session.
  - The checks prove what the files say, not what an agent does.
  - The symlink checks against `~/.claude/skills` were left out because they depend on the machine.
- Next step: P0b, once authorised. It starts with the specialist capability spike.

## Status

| Phase | Name                               | Status                       |
| ----- | ---------------------------------- | ---------------------------- |
| 0     | Plan and docs                      | Done                         |
| S     | Align `pivot-design` with Part A   | Done                         |
| 1     | Reliable capture (server)          | Done                         |
| 2     | Extension that survives offline    | Done                         |
| 3     | Popup and library                  | Done                         |
| 4     | Sections, links, private pages     | Done                         |
| 5     | Design track: sessions, MCP writes | Done                         |
| 6     | Later + Optional                   | Done, with gaps listed below |

### Phase 6.4 — Optional: look elsewhere, capture sessions

- Status: Done for #6/#7 (link-out) and #36. Not built: Trusted Websites (#52), an Advanced settings group (#50).
- Existing functionality reused: `KNOWN_SOURCES` and their verified `searchUrl` templates, the saved Sources list, the popup's collection pills and `chrome.storage.session`.
- Files changed: core `known-sources.ts` (`externalSearchLinks`), test in `sources.test.ts`; web `external-search.tsx`, `library-view.tsx`; extension `lib/capture-session.ts`, `background.ts`, `popup.tsx`, `popup/parts.tsx` (Library | Elsewhere), `lib/api.ts`; SPEC §18; DESIGN.md.
- Checks run and results: core sources tests 4/4 (links for a query, saved sources first, none for an empty query, category filter); extension tests; typecheck, lint, `next build`, full suite in the hooks.
- Manual verification: headless Chromium with the built extension against the scratch app — a capture session on "Heroes" put two saves on different pages into it, the collection came preselected on the second popup, the session sits in session storage (ends with the browser); Library › Elsewhere for "pricing table" listed Dribbble, Behance, Awwwards, Landbook, Lapa Ninja, One Page Love, Siteinspire and Pinterest.

## What is still open after all phases

- **Not built:** extension-side tab recording for signed-in motion (#20; needs the `tabCapture` and `offscreen` permissions and can't be driven headless), Trusted Websites (#52), an Advanced settings group (#50), public revocable share links (#41; needs an architecture decision), "Workflow Config" (#1; undefined).
- **Partly:** #4 (Motion metadata exists as assets, not as a reference kind), #49 (errors explain cause and next step; there is no collapsed technical-details view), #63 and #65 (QA and consistent states are practised per phase, not finished work items).
- **Verification limits:** extension flows were driven in headless Chromium with a stubbed active tab or a test-only build with `<all_urls>` standing in for the `activeTab` grant; real-Chrome quick save (⌥⇧D), context menus and the alarm-driven sync weren't clicked through by hand.

### Hybrid Search: Cloud-First catalog storage (2026-11-02)

- **Status:** Done. The owner revised the storage decision; still no PR or merge.
- **Files changed:**
  - core: `external-search.ts` (explicit R2 store, namespaced keys, bounded memory cache, R2 failure handling, `storageError` for Settings), `types.ts`;
  - tests: `external-search.test.ts`, now run against s3rver;
  - web: `settings/page.tsx`;
  - docs: SPEC §18, PIVOT_DECISIONS §8 (new row superseding local-only), `hybrid-search-plan.md` §8–9, DESIGN.md.
- **Checks:**
  - **Core tests** on s3rver:
    - catalogs go to `external-catalogs/v1/*`, never to local disk;
    - repeated searches cost 0 R2 or provider requests;
    - after a restart, each catalog is read from R2 once;
    - R2 down: the memory copy answers, or `unavailable` with no download;
    - an R2 write refused: memory copy plus a note;
    - a provider refresh failure: the stale copy answers and R2 is unchanged;
    - no R2 configured: `unavailable`, no fallback.
  - **Real R2** (temporary test, removed; no credentials printed):
    - 3 objects written: 17,996 / 53,946 / 9,855 bytes; 78 / 218 / 65 items;
    - 4 more searches: 0 R2 requests, 0 provider requests;
    - restart: 3 R2 reads, 0 writes, 0 downloads;
    - simulated R2 outage: in memory `ok`, after a restart `unavailable`;
    - simulated provider outage with day-old catalogs: `stale`, 0 R2 writes;
    - library rows 0 → 0.
  - **Web app with real R2** (scratch database):
    - External results load from the R2 copies;
    - Settings shows the R2 note;
    - the data folder has no catalog files.

### Hybrid Search pre-merge fixes F1–F4 (2026-11-02)

- **Status:** Done. The owner approved the audit findings; still no PR or merge.
- **Files changed:**
  - core: `external-search.ts`, `types.ts` (`externalPageFor`);
  - tests: `external-search.test.ts`, plus the new fixture `magicui-llms.txt`;
  - web: `external-search.tsx`, `command-palette.tsx`, `settings/page.tsx`;
  - docs: SPEC §18, DESIGN.md (Hybrid search), `hybrid-search-plan.md` §5 and §8.
- **Fixes:**
  - **F1:** catalogs are stored locally whatever the R2 settings.
  - **F2:** Magic UI is confirmed against its own free list, and fails safe when the list can't be read.
  - **F3:** an honest message when Refresh is on cooldown.
  - **F4:** no stale results under a new query, and no flicker.
  - React Bits stays metadata-only; the licensing interpretation risk is written down in the plan.
- **Checks:** 3 new regression tests (R2 configured, free-list exclusion and fail-safe, page/query consistency); the refresh test now asserts `refreshed: false` and `retryInMs` on cooldown. See the commit for the full run.

### Hybrid Search H1–H4 — Free catalogs, scope switch, MCP and skill (2026-11-02)

- **Status:** Done, except one check: the headless `pivot-design` E2E with a thin library hasn't been run (it costs a paid Claude Code run).
- **Existing functionality reused:**
  - `parseQuery` (plus a new `toJsRegex`), `searchResources` unchanged, `externalSearchLinks` and `KNOWN_SOURCES`;
  - `safeFetch` (SSRF guard), the blob store, `app_settings`;
  - `/api/clip` for Save (`ifExists: "skip"`, Inbox, server capture);
  - `findByUrl`'s `urlKey` for "already in your library";
  - the `PivotSource` / `HttpSource` pattern.
- **Files changed:**
  - **core:** `external-search.ts` (new), `types.ts`, `query.ts`, `settings.ts`, `capabilities.ts`; tests `external-search.test.ts` with recorded fixtures in `test/fixtures/catalogs/`;
  - **web routes:** `api/search/external`, `api/search/providers` (and `/refresh`), `api/clip` (`origin`);
  - **web components:** `external-search.tsx` (rewritten), `library-view.tsx`, `command-palette.tsx`, `settings/page.tsx`, `resource-detail.tsx`, `lib/api.ts`, `hooks/use-library-params.ts`;
  - **MCP:** `external-tools.ts` (new) and `source.ts` in `packages/mcp-tools`, `http-source.ts` and `server.ts` in `apps/mcp`, test `external-tools.test.ts`;
  - **skill and docs:** `.claude/skills/pivot-design/SKILL.md`; SPEC §1, §6, §10, §18; DESIGN.md (Hybrid search); the plan files.
- **Checks run and results:**
  - Tests: core 104 of 104 (10 new); MCP 15 of 15 (3 new); extension 12 of 12.
  - Typecheck and lint clean; Prettier clean on the changed files.
  - The new core tests cover:
    - the cost guard (every provider free, keyless, HTTPS on its own host);
    - one sync, then local search with **zero** network calls and **no** database writes;
    - page links from the sitemap or catalog;
    - React Bits variants merged, and acronyms kept ("ASCII Text");
    - a day-old catalog resynced, a failed sync answered with the last good copy (also after a restart), no copy → `unavailable`;
    - catalogs that aren't JSON, carry code, or have only unsafe names are refused;
    - markup stripped;
    - "already in your library";
    - a switched-off provider skipped without a request;
    - refresh at most once a minute;
    - link-outs are never verified and include paid sources, never the direct providers;
    - query validation.
- **Manual verification** (scratch app on port 4400, live catalogs):
  - **Catalogs:** synced Magic UI 78, React Bits 218 and shadcn/ui 65; confirmed pages 78/78, 217/218 and 64/65; the stored catalogs hold only id, title, description, url, linkVerified and categories.
  - **Library page:** `animated list` under All shows the library empty state and then Magic UI and React Bits "Animated List".
  - **Save:** **Save to library** created one reference (Inbox, captured, `meta.externalOrigin` with provider, id, MIT, timestamps); the card turned "In your library"; the detail page shows "Found via Magic UI (MIT) search".
  - **Scopes:**
    - External hides the library list, the count and the shelf.
    - Library with no match offers "Search outside your library", which switches to External (`bento grid` → Bento Grid, Magic Bento).
  - **⌘K:** the scope switch, plus "Magic UI · Direct · MIT" and "React Bits · Direct · MIT + Commons Clause" groups for `marquee`.
  - **Settings › Search:**
    - switching React Bits off made it `disabled` in results; switching it back on restored it;
    - Refresh catalog re-downloaded Magic UI and showed a toast;
    - the checkboxes have accessible names.
  - **API:** an empty query and a 121-character query are refused with 400.
  - **Phone (375 px):** no horizontal overflow.
- **Remaining issues:**
  - The `pivot-design` headless E2E on a thin library (H3 acceptance) hasn't been run.
  - React Bits `EvilEye` and shadcn `form` have no confirmed page.
  - Whether the Magic UI free registry ever lists Pro items is still unverified.
  - SiteInspire stays link-out until its licence is verified.
  - #42 "Possibly related" is still missing.
- **Next step:** the owner's review; then the skill E2E if wanted.

### Hybrid Search H0 and H0.5 — Decisions, docs and Magic UI proof of concept (2026-11-01)

- **Status:** Done (docs and an isolated proof of concept). Nothing in the app is built; H1 waits for owner approval.
- **Existing functionality reused:**
  - `parseQuery` (`packages/core/src/query.ts`), read-only, by the proof of concept;
  - the link-out builder and `KNOWN_SOURCES` (unchanged).
- **Files changed:**
  - `docs/hybrid-search-plan.md` (new; the plan of record, replacing the two review drafts outside the repo);
  - `docs/PIVOT_DECISIONS.md` §8: six new rows, and the 2026-10-31 link-out-only row marked superseded but kept;
  - `docs/SPEC.md`:
    - §1 row 23, §6 and §13: updated;
    - §4: Elsewhere stays link-out;
    - §11: paid providers out of scope;
    - §18: current link-out behaviour, plus the approved, not-built Hybrid Search;
  - `docs/decisions-plan.md`:
    - #6, #7 and #42 re-opened;
    - C6 marked superseded;
    - new Hybrid Search phase list H0–H4.
- **Checks run and results:**
  - Prettier on the changed docs.
  - Proof of concept: `node poc.mjs` in a scratch folder outside the repo; all assertions passed:
    - live sync: 78 components;
    - local search for `marquee`, `border beam` and `animated list`, each with the right component first and 0 network calls;
    - docs URLs: 78 of 78 answered 200, after one override;
    - malformed registries refused;
    - 500, HTML and 404 fell back to the last good catalog;
    - a hang timed out at 1.5 s; DNS failure handled;
    - no cached catalog → `unavailable`.
- **Manual verification:** read the registry, an item endpoint (it contains code, so it is never fetched) and the licence.
- **Remaining issues:**
  - Whether the free registry lists Pro items is unverified.
  - Docs URLs need a sync-time check and an override map.
  - SiteInspire's licence is still unverified (link-out only).
- **Next step:** H1, after the owner approves it.

### Follow-up — Smooth full-page motion video (A6 feedback, 2026-11-01)

- Status: Done
- Why: testing A6, the owner found the motion video choppy and stopping before the end of the page, and asked for scroll videos like Refero's. Cause: the walk scrolled in 225px wheel steps every 250 ms, blocked on PNG keyframe shots mid-scroll, and stopped after 12 s, while `recordVideo` sampled whatever the screen showed.
- Existing functionality reused: Playwright's bundled ffmpeg (the one `recordVideo` used), the scroll scripts (`UNLOCK_INNER_SCROLL`, `EAGER_IMAGES`, `IMAGES_ON_SCREEN`, `NO_SMOOTH_SCROLL`), the full-page height cap, the asset roles and the `motionLikely` hint.
- Files changed: core `capture.ts` (`recordScroll` replaces `walkWithKeyframes` and `recordVideo`: every frame a CDP JPEG screenshot at its own scroll position, piped into ffmpeg VP9 at 30 fps; 1 s rest, eased glide at 900 px/s, 1 s rest; follows a page that grows; keyframes picked from the same frames; `durationMs` in the video's meta), `capture-flow.test.ts`; SPEC §12, the plan's Phase 6 line.
- Checks run and results: the motion test now checks the two rests (≥ 2 s) and that the last keyframe is at the page bottom. Real pages: linear.app/pricing → 8.4 s video in 13.5 s, scrolled to 5083px, 8 keyframes; stripe.com → 14.9 s video in 26 s, scrolled to the 12000px cap. Frame-to-frame shift measured on the decoded Linear video: 0 for the first second, ramp 2 → 30px, a steady 30px per frame (900 px/s) with no dropped or repeated frame, ramp down 28 → 0, then a second at rest.
- E2E in Chrome (scratch app, linear.app/pricing): Add → Save → Retake ▾ → Record motion gave an 8.4 s 1440×900 video with 0 dropped frames, ending on the footer, and 8 keyframes; a second recording replaced the first (still 1 video, 8 keyframes, 11 files). It also found a bug, fixed on `fix/motion-no-hover`: the pointer rested mid-screen, so table rows lit up and tooltips popped as they passed under it. The recording now never moves the pointer onto the page; a test page that turns red under a pointer checks every keyframe.
- Remaining issues: time-based animations run while each frame is shot (about 30 ms per frame), so they play at roughly real speed but a frame that waits for images shows them jump ahead. Signed-in pages still need the extension-side recording (#20).

### Phase 6.3 — Backup, restore, share package, device transfer

- Status: Done (except public share links, which need an architecture decision: the API only answers this machine).
- Existing functionality reused: the exports folder and Finder reveal, `saveAsset` (sha256 reuse), `urlKey` for "same URL", the offline queue's IndexedDB store.
- Files changed: core `backup.ts` (backup, preview, restore with keep / merge / new), `share.ts`; routes `api/backup`, `api/backup/preview`, `api/backup/restore`, `api/share`, `api/clip` (`privatePage`); web `backup-section.tsx` in Settings, `selection-bar.tsx` (Share package); extension `lib/transfer.ts`, `options.tsx` (Waiting saves), `privatePage` set on saves from pages flagged private; SPEC §11, §17; DESIGN.md.
- Checks run and results: core `backup.test.ts` 4/4 (a purged reference restored with facets, collection, screenshot and cover, annotation and link, the rest kept; a second restore adds nothing; merge fills only the emptied description and keeps the user's new title; "import as new" twice makes one copy; a tampered file name, a non-backup folder and a relative path refused; the share package leaves out notes and the private page and escapes HTML). Extension tests; typecheck, lint, full suite in the hooks.
- Manual verification: scratch app — Settings › Back up the library: 22 references, 29 files, 36 links, 1 annotation, 1 design session (3.7 MB); Preview of that folder: 22 already here; Restore with Keep: kept 22, nothing added. Share package of Linear and Notion pricing: `index.html` with both, four images. Two headless Chromium profiles with the built extension: profile A exported two waiting saves (one held for privacy approval); the file holds the screenshots and not the token; profile B imported 2, then 0 on the second import, with the approval hold kept.
- Remaining issues: no public share link; restoring into a library with the same ids but different content keeps yours unless you choose merge or new per item (the UI sets one choice for all conflicts).
- Next step: Optional items.

### Phase 6.2 — Annotations, interaction states, asset extraction

- Status: Done
- Existing functionality reused: `/api/clip` (a state is a clip with `attachTo`), the offline queue and privacy hold, `safeFetch` (SSRF guard) for picked images, `saveAsset`/`attachAsset`, the assets route's sandboxed CSP for SVG, `get_reference` in MCP.
- Files changed: core `annotations.ts`, `extract.ts`, `resources.ts` (annotations in a resource's details), `types.ts`, schema + migration `0008` (adds `asset_annotations`); routes `api/resources/[id]/annotations`, `api/annotations/[id]`, `api/resources/[id]/extract`, `api/clip` (`attachTo`, `state`); web `annotation-layer.tsx`, `asset-gallery.tsx` (Notes mode); MCP `get_reference` (annotations, section context); extension `lib/discover.ts`, `lib/api.ts`, `popup/parts.tsx` (`AddState`, `AssetPicker`), `popup.tsx`; SPEC §16, DESIGN.md.
- Checks run and results: core `annotations-extract.test.ts` 2/2 (notes on the reference's own screenshot only, boxes kept inside the image, out-of-range refused, partial edits keep the rest, the pixels unchanged; picked image and SVG saved with their source, a non-image and a non-SVG reported, font names and gradients in meta, more than 20 files refused); MCP and extension suites; typecheck, lint, full suite in the hooks.
- Manual verification: scratch app — on Notion pricing, Notes mode: dragged a box, typed a note, moved it 3% with the arrow keys; stored as a region at x 0.06 with its size and note, and MCP `get_reference` lists "Two tiers side by side, price first (region at 6%, 52% of viewport)". A real bug found and fixed on the way: the edit schema inherited the create defaults, so editing a note reset the box's size. Headless Chromium with the extension on a local test site: the page saved once, then "Add this view as a state" → "Open menu" added a `state` image to that same reference (still one reference for the URL); "Pick assets" saved the SVG icon and the gradient, and reported the logo as blocked because it sits on 127.0.0.1 (the SSRF guard; public images are covered by the unit test).
- Remaining issues: annotations live on the detail page only (not in the full-size viewer); asset discovery reads only on-screen images and same-origin stylesheets for font sources.
- Next step: Phase 6.3 (export, backup, import, share package, device transfer).

### Phase 6.1 — Capture variants, comparison, versions, requests, health

- Status: Done
- Existing functionality reused: `screenshotUrl` (now takes a viewport, a mobile mode and a motion mode), the scroll walk and stitching (now sized from the page's viewport), `capture_attempts` (a `deferred` status), asset roles and `saveAsset` dedupe, `createResource`/`createLink` for design versions.
- Files changed: core `capture.ts` (extras before the status is final, motion walk with keyframes, real mobile/tablet contexts, deferred requests, `motionLikely`), new `compare.ts` (pixel diff, design versions, capture health), `settings.ts` (`cleanCaptureOptions`), `types.ts`, `context.ts` (exports keep to Latest, states and attachments); routes `api/resources/[id]/capture` (viewports, motion, defer), `api/resources/[id]/compare` (+ `/image`), `api/resources/[id]/versions`, `api/captures/health`, `api/captures/[id]` (+ `/run`); web `asset-gallery.tsx` (labels, Retake menu, compare panel, Record motion hint), `app/captures/page.tsx` (requests, Worth a look); MCP role labels; SPEC §12, DESIGN.md.
- Checks run and results: capture tests 24/24, including 4 new ones (tablet 820 and mobile 390 in one reference and replaced per size; motion video webm + keyframes; a deferred request untouched by time and restarts until run, then done; Original vs Latest diff over 50% on the colour-swapping test page, a new design version sharing the Latest assets and linked `newer_version_of`, the old one keeping its Original; three blocked captures reported as a failing site). A real race found and fixed: the resource turned "done" before the extras were saved.
- Manual verification: scratch app, the real linear.app/pricing retaken with tablet, mobile and motion: tablet 820×1180 (+ 820×6854 full), mobile 390×844 (+ 390×7605 full), a 13.7 s 1440×900 webm that plays in the detail page, 7 keyframes; the gallery labels them "Viewport · mobile · dark" and "Motion".
- Remaining issues: extension-side tab recording (signed-in motion, #20) isn't built. The diff compares from the top at one width, so a page that grew at the top shifts everything below.
- Next step: Phase 6.2 (annotations, states, asset extraction).

### Phase 5 — Design track: sessions and MCP writes (5a proposal, 5b build)

- Status: Done. 5a is [design-track-proposal.md](design-track-proposal.md); the owner asked for every phase without stopping for review, so it was built as proposed. "Workflow Config" (#1) stays open because nothing defines it.
- Existing functionality reused: the read tools and `runTool` in `packages/mcp-tools`, `HttpSource` (now also writes, with the API token), `/api/clip` for `save_reference` (duplicates, background capture, Inbox), `findByUrl`, the Inbox from Phase 3, the Markdown renderer for briefs, `updateResource`/`addToCollection`/`createCollection` to apply accepted suggestions.
- Files changed: core `design.ts`, `suggestions.ts`, `resources.ts` (pending suggestion text is searchable; `suggestions` count), `types.ts`, `capabilities.ts` (API 4), schema + migration `0007` (adds `design_sessions`, `design_snapshots`, `design_decisions`, `resource_suggestions`); routes `api/design/*`, `api/resources/[id]/suggestions`, `api/resources/[id]/annotate`, `api/suggestions`, `api/suggestions/decide`; web `app/design` pages, `components/design-session.tsx`, `components/suggestions.tsx`, Inbox and detail page, top-bar link; MCP `packages/mcp-tools/src/write-tools.ts`, `source.ts` (`PivotWriter`), `apps/mcp/src/http-source.ts`, `server.ts` (12 tools, read-only hints), README; `.claude/skills/pivot-design/SKILL.md` (uses the tools at each step, says when a save fails); SPEC §10, §11, §15; DESIGN.md; MCP plan Step 5.
- Checks run and results: core `design.test.ts` 3/3 (session opened only by the first brief, same brief twice is one snapshot, approval → approved, major change → exploring; suggestions matched to existing facet names, skipped when already present or repeated, searchable while pending, applied only when accepted, rejected text no longer found; agent notes appended); MCP `write-tools.test.ts` 6/6 plus the read tests (read-only connection refuses, input validation, collection names resolved); typecheck, lint, `next build` (it caught a `params` access outside `<Suspense>` on `/design/[id]`, fixed), full suite in the hooks.
- Manual verification:
  - Full headless `pivot-design` run against the scratch app, with the MCP pointed at it and three real pricing references (Linear, Notion, Supabase) captured by the Phase 1 pipeline. Turn 1 ($1.19, 176 s): read the design system, searched, inspected 3 references, `save_design_brief` initial, 3 mockups in its scratch folder, stopped for the pick; project `git status` clean. Turn 2 after "Approved: direction 1" ($1.72, 90 s): `record_design_decision` approval, `save_design_brief` approved, built `pricing.html` + `styles/pricing.css`, checked 1280 and 375 px, said plainly that the Yearly view wasn't checked in a browser (its script needed a permission the headless run didn't have), recorded no deviations; the target repo has only those two code files.
  - The session shows in the app as Approved with the first brief, the approval and the approved brief. Three suggestions sent through the API: the text was searchable at once, the Inbox listed them, Accept on "Style: Dark" added the facet.
- Remaining issues: the agent never called `suggest_metadata` on its own in the run (it's optional in the skill). Mockup images aren't stored. "Workflow Config" undefined.
- Next step: Phase 6.

### Phase 4 — Sections, links, private pages

- Status: Done
- Existing functionality reused: the offline queue (held saves are queue items), `queueSave`/`syncNow`, `findByUrl`/`urlKey` for "same page", `safeFetch` (SSRF-guarded, no cookies) for the private check, `getPageInfo`'s injected reader, the Inbox from Phase 3 (sections land there).
- Files changed: core `links.ts`, `visibility.ts`, `types.ts` (link kinds), `capabilities.ts` (API 3: `visibility`, `clip.section`, `links`), schema + migration `0006` (adds `resource_links`); routes `api/resources/[id]/links`, `api/links/[id]`, `api/visibility`, `api/clip` (`section`, auto-link); web `resource-links.tsx`, `resource-detail.tsx` (Links, Section info); extension `lib/section.ts` (picker, list, scrolling), `lib/privacy.ts`, `lib/redact.ts`, `lib/page.ts` (privacy signals, mask suggestions), `lib/queue.ts` (`needs_approval`), `lib/sync.ts` (`approvePending`), `background.ts` (section capture and stitching, capture retry on Chrome's rate limit, private quick saves held, context-menu section), `popup.tsx` (section buttons and list, private review, approval view), new `popup/redact-editor.tsx`; SPEC §14, DESIGN.md.
- Checks run and results: core `links.test.ts` 4/4 (section `part_of` its page, same-page links, nothing by website alone, one row for symmetric links, suggestions confirmed by hand, no self-links, trashed ends hidden; visibility: public page, redirect to sign-in, 403, unreachable, app-like URLs); extension tests 12/12 (a held save is never sent, even forced); typecheck, lint, full suite in the hooks.
- Manual verification: headless Chromium with the built extension and a local test site, against the scratch app:
  - "Pick from a list" listed Hero, Pricing and Footer; Pricing (2000px tall) was saved as "Pricing — 127.0.0.1", in the Inbox, with its rect and a 1280×2000 stitched image.
  - A page with a password field, an email and a filled card field was flagged (password field, app-like address); three masks were suggested; Save stayed disabled until the approval box was ticked; the uploaded image is black under the email; no server capture was queued.
  - "Select a section" + Enter on that page held the section as `needs_approval` (nothing on the server); Review → "Upload with these masks" sent it (one more save on the server, queue empty).
  - Two real bugs found and fixed: the second tab capture within a second was refused by Chrome (now waits and retries), and the waiting panel was collapsed so Review was hidden (it now opens when something needs you).
  - Test-only difference: Playwright can't click the toolbar button, so the run used a copy of the build with `<all_urls>` standing in for the `activeTab` grant a real click gives. The shipped manifest is unchanged.
- Remaining issues: mask suggestions cover filled fields, emails and amounts on screen; names, addresses and anything inside images or canvases are not detected. Fixed headers can repeat inside a stitched section. MCP doesn't expose links or section context yet.
- Next step: Phase 5a.

### Phase 3 — Popup and library

- Status: Done
- Existing functionality reused: `findByUrl`/`urlKey` (same duplicate rule as before), `listResources` filters, the bulk route, `LibraryView` chips (`ViaChip`), the detail page's `Field` rows, the extension's `FacetPicker`, the `capture_attempts` table from Phase 1 for the queue page.
- Files changed: core `resources.ts` (`review_status`, `needsReview`/`url`/`host` filters, `inbox` count, `setReviewStatus`), schema + migration `0005` (adds `resources.review_status`), `types.ts`; routes `api/resources` (filters), `api/resources/bulk` (`reviewed`, `needsReview`), `api/lookup` (3 newest with thumbnails + total), `api/clip` (`needsReview`, `collectionIds`, `capturedUrl`); web `use-library-params.ts`, `lib/api.ts`, `library-view.tsx` (Inbox pill, chips), `selection-bar.tsx` (Mark reviewed), `resource-detail.tsx` (Inbox banner, Captured from, Published by, Original source), new `app/captures/page.tsx`, Settings link; extension `popup.tsx` (Capture/Library tabs, duplicate panel, collection pills, Edit after save, a11y fixes), new `popup/parts.tsx`, `lib/api.ts`, `lib/page.ts` (address bar URL), `background.ts` (quick saves go to the Inbox with provenance); SPEC §13, DESIGN.md (gallery, capture queue, page header, popup).
- Checks run and results: core `review-filters.test.ts` 2/2 (Inbox lists, search still finds, count, mark reviewed, page and website filters); extension tests 11/11; typecheck, lint, full suite in the hooks.
- Manual verification: scratch app — Inbox pill with count 1, Inbox list, detail banner, Mark reviewed removes it, Captured from shown; `/captures` lists runs with Retry. Headless Chromium with the built extension: the duplicate panel shows the earlier save with a loaded thumbnail; the Library tab lists this page, this website and recent saves; ← switches tabs; two collection pills pressed; save, then Edit → new title and one collection removed → the server has the new title, only "Pricing pages", and `capturedUrl` from the address bar.
- Remaining issues: agent suggestions in the Inbox come with Phase 5 (#35). The library has no direct "Saved from <host>" entry point except the popup (the `host` filter is API-only).
- Next step: Phase 4.

### Phase 2 — Extension that survives being offline

- Status: Done
- Existing functionality reused: the extension's `api.clip`, `getPageInfo`/`captureTab`, the popup form and its token ping; `/api/clip` unchanged apart from the request id; the proxy's origin check.
- Files changed: extension `lib/queue.ts` (sync logic, no storage), `lib/pending-store.ts` (IndexedDB), `lib/sync.ts` (wiring, badge, `queueSave`), `background.ts` (every save goes through the queue; alarms; session-stored notification targets), `popup.tsx` (save while offline with cached tags and collections, "Saved locally" screen, waiting-saves panel with Sync now / Retry / Discard, update and storage warnings), `manifest.json` (`alarms`), Vitest setup; core `clip-requests.ts`, `capabilities.ts`, schema + migration `0004` (adds `clip_requests`); routes `api/clip` (`clientRequestId`), `api/capabilities`; `proxy.ts` (token required for writes with neither `Origin` nor `Sec-Fetch-Site`); root `pnpm test` now includes the extension; SPEC §3 and §4.
- Checks run and results: extension queue tests 11/11 (order, offline stop, backoff, refused saves parked and retried only on request, missing server features, rejected token, single-item sync); core clip-request tests 4/4 (repeat answered, repeat waits for a save in progress, gives up with 409, retry after a failed first try); typecheck, lint, full suite in the hooks. One real bug found by the tests and fixed: Retry on a refused save didn't send it.
- Manual verification: scratch app on port 4400. `/api/capabilities` answers; a POST to `/api/ping` without Origin or token → 403, with the token → 200; the same `clientRequestId` sent twice → one resource, second answer `replayed: true`. In headless Chromium with the built extension loaded (popup driven with a stubbed active tab): with PIVOT unreachable the popup still saved, showed "Saved locally", the item and its screenshot were in IndexedDB and the badge showed 1; after pointing it at the running app and reopening the popup the item was sent, the queue emptied, the badge cleared, and `/api/lookup` found the page.
- Remaining issues: quick save, the context menu and the alarm-driven background sync weren't driven in a real browser (Playwright can't press extension shortcuts); they share the tested `queueSave`/`syncNow` code. Device transfer of waiting saves is Phase 6 (#51).
- Next step: Phase 3.

### Phase 1 — Reliable capture (server)

- Status: Done
- Existing functionality reused: the Playwright pipeline in `capture.ts` (SSRF guard, scroll walk, stitched full page, block-page detection, Open Graph fallback), `saveAsset`'s sha256 dedupe, `attachAsset`'s role upsert, the detail page's status bar and Retry button.
- Files changed: `packages/core/src/capture.ts` (attempts, retry, quality, theme, cancel, Original/Latest), new `settings.ts`, `db/schema.ts` + migration `0003` (adds `capture_attempts`, `app_settings`, `resources.capture_quality`, `assets.meta`; nothing removed), `types.ts`, `assets.ts`, `resources.ts`, `context.ts`; routes `api/resources/[id]/capture` (POST options, GET history, DELETE cancel), `api/captures`, `api/settings/capture`, `api/clip` (`expandContent`); `asset-gallery.tsx` (Cancel, notes, Retake options, theme labels, Original first, capture history), Settings → Capture; the extension popup's "Expand content"; MCP role labels; SPEC #7 and new §12.
- Checks run and results: core capture tests 20/20 (new: Original kept and in-between shots deleted; history order; a sign-in wall doesn't replace a good shot and is flagged when there's nothing to keep; 503 retried; 429 waits for Retry-After; a blocked page isn't retried; cancelling a running capture; settings and per-capture override; Load More only with `expandContent`). `pnpm typecheck`, `pnpm lint`, full `pnpm test` in the pre-push hook.
- Manual verification: scratch app on port 4400 (PGlite, no R2). Saved example.com, retook it with "Both themes": Latest dark plus light variant, both labelled; the identical second dark shot was not stored twice; history shows two completed runs; the Retake options menu opens and lists the four options; Settings → Capture shows Dark and Expand content off.
- Remaining issues: the Capture Queue page and the extension's queue view are Phase 3 (#17); Undo/Discard are Phase 3 (#55). Quality detection is heuristic and can be wrong (by design it never blocks a save).
- Next step: Phase 2.

### Phase S — Align `pivot-design` with Part A

- Status: Done
- Existing functionality reused: the skill from PR #34, the Ledgerly scratch target and the stream-json summary script from the first end-to-end test.
- Files changed: `.claude/skills/pivot-design/SKILL.md` (flow understand → search → inspect → choose → brief → design session → mockups → approval → build → QA; no "go ahead" exception; major changes go back to approval; QA reports deviations; design documents only in PIVOT, and the skill says when it can't save them; confirmed metadata beats suggestions), `docs/SPEC.md` §10, `docs/search-mcp-progress.md`, `docs/SEARCH_MCP_IMPLEMENTATION_PLAN.md`.
- Checks run and results: `pnpm check` (see the PR); two fresh headless Claude Code sessions on clean copies of the Ledgerly baseline, with the app running and the `pivot` MCP connected.
  - "Use the pivot-design skill. Just build it: design the pricing page": 26 tool calls, 7 images, $0.99, 119 s. Read the design system and content, used the Pricing pages collection, attributed Notion, Supabase and Linear (Stripe looked at and left out), wrote **one** mockup to its scratch folder, printed the brief with the Take / Leave table, said the brief isn't saved in PIVOT because the MCP only reads, and ended with "Reply approved and I'll build it". `git status` clean.
  - "Raise the contrast of the footer links": 7 tool calls, $0.36, 27 s. Didn't use the library or write a brief. Found the footer has no links, measured its text at 6.48:1, and asked which change was meant. No file changed.
- Manual verification: read both transcripts.
- Remaining issues: the design session and decision steps can't save anything until Phase 5b adds write tools. A real React/Next target is still untested.
- Next step: Phase 1.

### Phase 0 — Plan and docs

- Status: Done
- Existing functionality reused: Part A was compared with `.claude/skills/pivot-design/SKILL.md` in PR #34; the audits of the extension (`apps/extension`), the server (`packages/core`, `apps/web/src/app/api`) and the web app, and the open issues in [reference-first-progress.md](reference-first-progress.md) (G11: saves are lost while the app is down).
- Files changed: `docs/PIVOT_DECISIONS.md` (the consolidated baseline, Part A + Part B, copied in with the owner's amendments added to its §8 table), `docs/decisions-plan.md`, this log, `CLAUDE.md` (current focus).
- Checks run and results: docs only; Prettier on the changed files.
- Manual verification: none needed.
- Remaining issues: the conflicts C1–C11 in the plan's §2 are open until their phases land. The Activity Log retention period is still undecided (decision #54 gave 30 days only as an example).
- Next step: Phase S (align the skill with Part A on PR #34), then Phase 1.
