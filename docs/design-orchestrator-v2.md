# PIVOT Design Orchestrator v2: plan (rev. 2)

**Status:** architecture approved by the owner on 2026-11-03. Phases are authorised one at a time; progress is logged in [decisions-progress.md](decisions-progress.md). Only P0a is authorised so far.

**Labels:**

- **[F]** a confirmed fact (path:line, as of `dev` at `af7c319`);
- **[R]** a recommendation;
- **[A]** an assumption that a named test must verify.

## Owner requirements for later phases (2026-11-03)

These came with the P0a authorisation and bind every later phase:

1. Never fall back to a headless `claude -p` subprocess automatically when specialist execution fails. Report the spike results and ask first.
2. Treat loopback-host isolation (`localhost` ↔ `127.0.0.1`) as unverified until the browser and server-side security tests pass.
3. Harden the local viewer against unintended file access, network requests, navigation and popups.
4. Before P1b, bind a design approval to an immutable mockup identity or content digest, interactive motion included.
5. Scripted-mockup isolation isn't complete on CSP alone: validate server authorisation and browser behaviour separately.
6. Add no further mandatory approval gates to the design workflow.

## Context

`pivot-design` is already a single entry point. Its flow is: understand → search → inspect → shortlist (gate 1) → brief → session → mockups → approval (gate 2) → build → QA.

Three things are missing:

- specialists are read, never executed;
- motion is not designed, only "kept" or "respected" in QA;
- PIVOT mockups are static.

The owner approved this rev. 1 direction:

- one entry point;
- conditional specialists;
- a shared `motion.md`;
- motion levels None / Standard / Advanced;
- motion through every phase;
- two gates;
- an adaptive mockup count;
- the existing sessions and memory;
- incremental PRs with deterministic tests.

The owner asked for revisions on six points:

1. specialist execution must be **verified, not assumed**;
2. scripted-mockup security must be re-evaluated;
3. the reduced-motion preview must use faithful browser behaviour, not rewriting;
4. validation layers must be separated;
5. Advanced approval needs an executable preview;
6. the phase dependencies must reflect all of the above.

Rev. 1's facts still hold. Where this plan doesn't revise something, the rev. 1 content is kept in the Appendix.

### Repository facts that drive the revisions [F]

**Specialists today**

- Specialists are only read. `.claude/skills/pivot-design/specialists.md:71` forbids invoking a specialist's workflow with the Skill tool.
- `review-animations` and `prototype` set `disable-model-invocation: true`.

**Mockup isolation in PIVOT**

- The mockup route sends `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; sandbox` (`apps/web/src/app/api/design/mockups/[id]/route.ts:5-11`).
- The iframe uses `sandbox=""` (`apps/web/src/components/design-mockups.tsx:63-76`).
- The inliner strips scripts (`packages/mcp-tools/src/mockups.ts:103-107`).

**The fallback viewer is not isolated**

- `make-viewer.mjs:75` loads mockups in an iframe with **no sandbox and no CSP**. Scripts already run there.

**One origin, and the API trusts it**

- UI, API and mockups share one origin (`scripts/start.mjs:53`).
- `apps/web/src/proxy.ts:15-37` behaves like this:
  - any local GET passes;
  - writes need `new URL(origin).host === host`, or `sec-fetch-site: same-origin` when Origin is missing, or the token.
  - `Origin: null` makes `new URL("null")` **throw** (L24), so the result is an unhandled error rather than a clean 403.

**The API token is one same-origin GET away**

- `GET /api/settings/token` returns the API token as JSON (`apps/web/src/app/api/settings/token/route.ts:6`).
- Only the no-CORS rule keeps it unreadable from other origins.
- So any script running on the app's origin gets full write access. This is the main threat for scripted mockups.

**Browser state the app keeps**

- The app sets no cookies.
- It uses `localStorage` once, for the export folder (`export-dialog.tsx:34,83`).

**Playwright is in PIVOT, not in the skill folder**

- PIVOT already drives Chromium with Playwright: capture, and the CDP-frame and ffmpeg motion recorder (`packages/core/src/capture.ts:378-545`).
- Playwright **cannot be resolved from the skill's `scripts/` folder** (checked).

**Testing gaps**

- There is no e2e suite and `apps/web` has no tests.
- No test in the repo reads the skill files.

---

## 1. Revised architecture decisions

These rows replace the rev. 1 rows with the same number. Decisions 1, 3–7 and 11–13 are unchanged (Appendix B).

| #            | Decision                       | Rev. 2 recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | App/MCP/DB change                                                        |
| ------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| **2**        | **Specialist execution**       | **Unverified capability.** P0b starts with a spike (§4) that checks whether a restricted subagent can (a) invoke an installed specialist with the Skill tool, (b) apply its real instructions, (c) call PIVOT MCP read tools, (d) write nothing outside scratch, and (e) return the contract. **Until the spike passes, every specialist is "consulted" (Read) or "ran (script)".** The label "ran (skill)" exists only when the trace shows a `Skill` tool call. Fallbacks are ordered in §4.4. | No (adds an agent definition file and a dev-only trace checker in PIVOT) |
| **8**        | **Interactive mockup preview** | **Two tiers; scripted mockups are not finalised.** **Tier 1 (P0, no security change):** static and CSS motion in today's sandbox. **Tier 2 (P1b, conditional):** scripted previews, under the recommended isolation in §3, shipped only after the §3.4 security tests pass and the owner signs off. Until then, Advanced motion uses the **local executable preview**: the skill viewer, hardened in P0c.                                                                                        | Tier 1: none. Tier 2: yes, conditional                                   |
| **9**        | **Motion approval evidence**   | Approval criteria by motion level (§5). **Advanced requires an executable preview of every essential motion item**, or an owner-approved exception recorded word for word. This stays inside gate 2; it is not a third gate.                                                                                                                                                                                                                                                                     | No                                                                       |
| **10**       | **Motion QA**                  | `motion-qa.mjs` (P1c) uses **browser-native emulation**: Playwright `emulateMedia({ reducedMotion })` and viewports, in PIVOT's Chromium, loaded through `createRequire` from `packages/core`. Results fall into three groups: preview, automated emulation, and real-device verification (§3.5).                                                                                                                                                                                                | No                                                                       |
| **R1 (new)** | **Reduced-motion preview**     | **No HTML/CSS rewrite and no `matchMedia` shim** (dropped from rev. 1). Live preview uses the viewer's real browser setting: the OS "Reduce motion" switch, or the DevTools emulation where it reaches the frame. PIVOT shows the current state, detected with `matchMedia` in the parent page. Automated faithful evidence comes from Playwright `emulateMedia`. Device checks are the owner's and are labelled as such. Details in §3.5.                                                       | Small web UI only (P0d)                                                  |
| **V1 (new)** | **Validation layers**          | Three separate layers. **L1** static contract tests: the text says the right thing. **L2** MCP and app integration and security tests: the code behaves. **L3** behavioural orchestration tests: an agent run, judged from its trace. L1 never counts as evidence of agent behaviour. See §6.                                                                                                                                                                                                    | Dev-only test code                                                       |

---

## 2. Updated phase dependencies

**Order:** P0a → P0b → P0c → P0d → P1a → P1c → P1b (conditional) → P2.

Each phase is one branch from `dev` and one PR. "Usable" means a real session can complete with the gates and evidence rules of §5.

| Phase                                  | Goal                                                                                                                                                                                                                | Depends on                                                | Exit criteria (summary)                                                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0a** `chore/skill-checks`           | L1 static contract tests in the repo (port the 109 scratch checks). Plus `scripts/trace-check.mjs`, a dev-only, read-only parser of Claude Code JSONL transcripts, with **synthetic-fixture vitest tests**.         | –                                                         | `pnpm test` runs both. The trace checker classifies the fixtures correctly (ran-skill / ran-script / consulted / skipped / writes outside scratch / gate order).                          |
| **P0b** `feat/orchestrator-routing`    | **Step 1: capability spike (§4)**, recorded in `docs/decisions-progress.md`. Step 2: routing, contract, conflict rules, ledger, budgets and the adaptive count, **written against the mechanism the spike proved**. | P0a (needs the trace checker)                             | The spike report has pass/fail per capability. specialists.md names only proven mechanisms. The L3 specialist scenarios (S1–S4 in §6) pass on their traces.                               |
| **P0c** `feat/motion-brief`            | `motion.md`, classification, Motion brief block, §5 approval criteria, Tier 1 CSS mockups. **The local viewer is hardened** (sandboxed iframe plus CSP meta, §3.3) so Advanced has a local executable preview.      | P0b                                                       | L1 covers the rules. L2: the viewer probes (§3.4, local subset) pass. L3: a Standard and an Advanced dry run each reach gate 2 with the right evidence label.                             |
| **P0d** `feat/mockup-preview-controls` | Replay; a live reduced-motion state indicator plus guidance (R1); proxy hardening (`Origin: null` → 403; the token GET restricted, §3.3). **No markup rewriting.**                                                  | P0c                                                       | L2: proxy unit tests (null origin, cross-site navigation to the token route). Browser check: Replay restarts CSS animations; the indicator flips when the OS or DevTools setting changes. |
| **P1a** `feat/motion-references`       | Keyframe and state images, motion metadata, external `category` passthrough (rev. 1 content)                                                                                                                        | P0c                                                       | L2 tests. A dry run cites keyframes with the evidence label "keyframes".                                                                                                                  |
| **P1c** `feat/motion-qa`               | `motion-qa.mjs`: native emulation, frames at named moments, CLS, long frames, cleanup. **It can also record a mockup in both motion modes** as approval evidence.                                                   | P0c                                                       | L2: script self-test on fixture HTML (deterministic). Fails clearly when Playwright or Chromium is missing.                                                                               |
| **P1b** `feat/interactive-mockups`     | Scripted previews in PIVOT (§3)                                                                                                                                                                                     | P0d, P1c, **§3.4 security tests passing, owner sign-off** | Every probe in §3.4 is blocked or isolated. Static mockups are unchanged. Owner approval is recorded in `PIVOT_DECISIONS.md`.                                                             |
| **P2**                                 | `hasMotion` filter, motion-capture tool, pixel diff, storing recordings in PIVOT, `pivot-motion` skill                                                                                                              | Evidence of need                                          | –                                                                                                                                                                                         |

**What is usable when:**

- **Static and Standard workflows:** fully usable after **P0c**, with better preview controls after P0d. They don't depend on P1b.
- **Advanced workflow:** usable after **P0c**, through the local executable preview, approved in chat. It reaches its PIVOT-hosted form only after P1b.
- **Advanced completeness:** Advanced is **not complete** in any phase unless its essential motion was previewed executably and approved (§5), or the owner granted the recorded exception.

---

## 3. Security recommendation for interactive previews

### 3.1 Threat model

- Mockup HTML is written by an agent and may carry copied or third-party code. Treat it as **untrusted**.
- The assets to protect, in order:
  1. **the API token** (`GET /api/settings/token`), which grants writes;
  2. **write endpoints**, approval above all (`POST /api/design/mockups/:id/approve`);
  3. **library data** readable through GETs;
  4. the **PIVOT tab's responsiveness**.
- PIVOT runs on localhost only (`proxy.ts:4,17-19`) and has no cookies.

### 3.2 Options compared

| Property                      | A. Opaque-origin sandbox, same host (rev. 1)                                                                     | B. Separate-origin preview server (second port)                                                     | C. Cross-site loopback alias on the same server                                                      | D. Local file viewer only (no PIVOT hosting)                                   | E. Recorded video only |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------- |
| Origin isolation              | Opaque origin; parent and API origin are unreachable from JS                                                     | A distinct origin with **no API routes at all**                                                     | Opaque origin, also **cross-site** (`localhost` ↔ `127.0.0.1`)                                       | `file://` is opaque in Chrome                                                  | No code runs           |
| Cookies and storage           | No cookies exist; `localStorage` throws in an opaque origin (some libraries may need guards)                     | Own storage, separate from the app                                                                  | Like A                                                                                               | Like A                                                                         | n/a                    |
| API access                    | `connect-src 'none'` blocks fetch. Raw navigations still reach any GET, so the token route needs hardening       | Same-port API unreachable; cross-port GETs unreadable (no CORS); writes 403                         | Like A, plus cross-site fetch metadata (`Sec-Fetch-Site: cross-site`) that the proxy can reject      | GETs possible but unreadable; writes need the null-origin fix                  | None                   |
| CSP                           | Strict, per tier                                                                                                 | Strict, plus the origin boundary                                                                    | Strict                                                                                               | `<meta>` CSP (no `sandbox` directive in meta, so the iframe attribute matters) | n/a                    |
| Scripts and assets            | Inline only; inliner makes everything data URIs                                                                  | Same                                                                                                | Same                                                                                                 | Inline or local files                                                          | n/a                    |
| Navigation and popups         | Sandbox without `allow-top-navigation`, `allow-popups` or `allow-forms`; the frame can still navigate **itself** | Same, and self-navigation lands on a server with no API                                             | Like A, but the proxy rejects cross-site navigations to `/api` (except the mockup route)             | Like A                                                                         | n/a                    |
| postMessage                   | Parent registers no listener; if one is added later, check `source === frame.contentWindow` plus a schema        | Same                                                                                                | Same                                                                                                 | Same                                                                           | n/a                    |
| Resource exhaustion           | **[A]** May share the PIVOT renderer process: a busy loop could freeze the page                                  | Cross-origin but **same-site** (ports don't change the site), so process isolation isn't guaranteed | **Cross-site, so a separate renderer process on desktop Chrome [A]**; the PIVOT tab stays responsive | User's own tab                                                                 | None                   |
| Approval protection           | Writes from the frame carry `Origin: null` → must be a clean 403 (fix needed)                                    | Writes carry a foreign origin → 403 today                                                           | Like A, plus cross-site headers                                                                      | `Origin: null` → fix needed                                                    | n/a                    |
| Fit with localhost deployment | No new server                                                                                                    | A second listener, port management, lifecycle in `scripts/start.mjs`                                | No new server; both host names already allowed by `proxy.ts:4`; preview host picked from `location`  | No PIVOT change                                                                | Needs P1c recorder     |
| Faithful interactive preview  | Yes                                                                                                              | Yes                                                                                                 | Yes                                                                                                  | Yes                                                                            | No (playback only)     |

### 3.3 Recommendation

**C + A together, with the hardening below and a click-to-run frame.** It isolates as well as B without a second server. B is the fallback if a §3.4 probe fails. D (the hardened local viewer) is the interim for Advanced until P1b ships. E (recordings from P1c) is a complement, never a substitute for an executable preview.

**Hardening that ships in P0d, independent of scripted mockups**

- `proxy.ts`:
  - `Origin: null` or any unparseable origin → 403, never a throw;
  - requests with `Sec-Fetch-Site: cross-site` or `same-site` and `Sec-Fetch-Mode: navigate` to `/api/*` → 403, except `GET /api/design/mockups/:id` and asset GETs.
- `GET /api/settings/token` → requires `Sec-Fetch-Site: same-origin`, or a non-browser caller (no `Sec-Fetch-*` headers). The extension uses the token, not this route.

**Scripted tier only (P1b)**

- Response CSP:

  ```
  default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline';
  img-src data: blob:; font-src data:; media-src data: blob:;
  connect-src 'none'; form-action 'none'; frame-src 'none';
  worker-src 'none'; base-uri 'none'; sandbox allow-scripts
  ```

  - It has **no `'self'` anywhere**, so `<img src=/api/...>` can't trigger GETs.
  - `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` are kept.

- The iframe:
  - `sandbox="allow-scripts"` only, with no `allow-same-origin`, forms, popups, modals or top navigation;
  - `src` on the alias host;
  - **loaded only after a "Run interactive preview" click**, with a Stop button that unloads it.
- The inliner's interactive mode inlines local `<script src>` and drops and lists remote scripts. The 2 MB cap is kept.
- An additive column `design_mockups.interactive boolean default false`. Static versions keep today's CSP and sandbox unchanged.

### 3.4 Security acceptance tests (gate for P1b; local subset gates the P0c viewer)

**How the tests run**

- `scripts/qa/mockup-security.mjs` is a dev-only Playwright script in PIVOT. It runs against a **scratch** instance and loads a hostile fixture mockup.
- Each probe reports "blocked" or "isolated" with evidence: console or CSP violation, network log, HTTP status.
- All of them must pass, twice, from a clean load.

**The probes**

1. `fetch`, XHR, `WebSocket` and `EventSource` to `/api/*` → blocked by CSP.
2. `<img>`, `<link>` and `<script src>` to `/api/settings/token` → blocked (no `'self'`).
3. The frame navigating itself to `/api/settings/token` → 403 (cross-site navigation rule). No token appears anywhere.
4. A form POST, or `fetch` POST, to `/approve` → blocked by CSP or sandbox. A crafted request with `Origin: null` → 403. The session stays `exploring`.
5. `window.open`, `top.location =`, `parent.document` access → blocked or throws.
6. `document.cookie` and `localStorage` → empty or throw. The app's `localStorage` value is unchanged.
7. A `postMessage` flood to the parent → no effect, and nothing is logged as handled.
8. An infinite loop and memory growth in the mockup → the PIVOT page stays interactive: the version tabs respond within 1 s and Stop unloads the frame. **[A]** This relies on cross-site process isolation; if it fails, use option B.
9. "Open alone" in a new tab → the CSP `sandbox` still gives an opaque origin; probes 1–6 repeated.
10. Static (non-interactive) mockups → scripts don't run; behaviour is identical to today.

### 3.5 Reduced motion: preview vs emulation vs device

| Layer                             | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                         | Faithful?                       | Where     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------- |
| **Live preview (PIVOT page)**     | The viewer's **real browser setting**: macOS/Windows/iOS "Reduce motion", or Chrome DevTools › Rendering › _Emulate prefers-reduced-motion_. The media query is evaluated natively in the mockup frame. PIVOT shows "Your browser: reduce / no preference" (parent `matchMedia`, live) and a one-line how-to. **Limitation [A]:** DevTools emulation may not reach a cross-site out-of-process frame; the OS setting always does. | Yes (real engine, real setting) | P0d       |
| **Automated emulation**           | Playwright `emulateMedia({ reducedMotion: "reduce" \| "no-preference" })` in PIVOT's Chromium, for mockups and for the build (`motion-qa.mjs`). Frames and recordings go to scratch.                                                                                                                                                                                                                                              | Faithful for Chromium only      | P1c       |
| **Device / browser verification** | The owner checks on a real device or browser. The agent records it only if the owner says so, as "owner-verified (device)". Otherwise it is reported as **unverified on device**.                                                                                                                                                                                                                                                 | Yes, for that device            | Any phase |

No rewriting of media queries and no `matchMedia` shim anywhere.

---

## 4. Specialist execution verification strategy (P0b, step 1)

### 4.1 Mechanism under test

- An agent definition `pivot-specialist`, kept in the PIVOT repo at `.claude/agents/pivot-specialist.md` and linked into `~/.claude/agents/` by an extended `scripts/install-skill.mjs`. This is user-level, so nothing goes into target repos.
- Its frontmatter `tools` allowlist:
  - `Read, Grep, Glob, Skill`;
  - Bash restricted to the allowed specialist scripts (only if supported);
  - the pivot MCP **read** tools: `get_reference`, `get_reference_images`, `get_design_session`.
- It has no Edit or Write. That makes "advisory only" a **tool restriction**, not a promise.
- The orchestrator calls it with the Agent tool, passing a handoff pack path and the contract.

### 4.2 Spike setup (scratch only)

- A scratch PIVOT (`DATABASE_URL=` scratch command) with one session and two references.
- A **throwaway target repo** (`git init` in scratch) containing `DESIGN.md` and one component.
- A **canary specialist**: a temporary skill in the throwaway repo, `.claude/skills/pivot-canary/SKILL.md`, whose instructions require an output that generic knowledge can't produce: echo a per-run nonce, and list the file it was told to read. A second probe uses a real installed specialist with a distinctive mandatory format: `find-animation-opportunities` requires its rejected-candidates table.

### 4.3 Capabilities and their pass criteria

All criteria are judged by `trace-check.mjs` on the session and subagent JSONL transcripts, plus `git status`.

| #   | Capability                                        | Pass when                                                                                                                                                                        |
| --- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Subagent can invoke an installed specialist skill | The subagent trace contains a `Skill` tool_use with `skill: "pivot-canary"` (and one for `find-animation-opportunities`)                                                         |
| C2  | The specialist's real instructions were applied   | The reply contains the run's nonce, and the real specialist's mandatory structure is present. A Read of the SKILL.md alone does **not** pass: the trace must show the Skill call |
| C3  | PIVOT MCP context available                       | The trace has a `mcp__pivot__get_design_session` (or reference) tool_use returning the scratch session, and its facts appear in the contract                                     |
| C4  | No production writes                              | Zero Edit/Write/NotebookEdit tool_uses, no Bash writes to the target, and `git status --porcelain` empty in the target                                                           |
| C5  | Structured result                                 | The reply parses as the contract: all 8 fields present, outcome left for the orchestrator, ≤400 words                                                                            |
| C6  | Trace distinguishes execution from reading        | The checker labels the run **ran-skill**; a control run told to "read the skill file instead" is labelled **consulted**                                                          |
| C7  | Unavailable specialist                            | Asking for a non-installed name gives a trace with a failed availability check (Read miss) and a contract or checkpoint saying "unavailable". No fabricated output.              |

**Record of the spike:** the result goes to `docs/decisions-progress.md`, with the Claude Code version and the trace excerpts (tool names only, no content).

### 4.4 If a capability fails (feasible alternatives, in order)

**C1 or C2 fail** (Skill not callable from subagents, or agent allowlists can't include Skill)

- (a) Use a **general-purpose subagent with no allowlist**. The prompt forbids writes, and the trace check plus `git status` enforce it after the fact. Advisory-only becomes _verified per run_, not guaranteed.
- (b) If that also fails, run a **headless `claude -p` subprocess** invoking `/<specialist>`, with `--allowedTools` limited to read tools and the output as JSON. This is a separate session (subscription usage), so it needs owner approval.
- (c) Otherwise use **R/S only**: the checkpoint says "consulted" or "ran (script)" and never "ran (skill)".

**C3 fails**

- The orchestrator puts the needed PIVOT facts (≤2 image paths saved to scratch, brief text) into the handoff pack. The specialist then works without MCP.

**C4 fails**

- Mechanism A is not used for that specialist; fall back to R.

**Labelling rule** (enforced in L1 text and in L3 trace checks): the checkpoint and ledger use exactly these labels.

| Label          | Requires in the trace       |
| -------------- | --------------------------- |
| `ran (skill)`  | A Skill tool_use            |
| `ran (script)` | A matching Bash command     |
| `consulted`    | Reads only                  |
| `none`         | Nothing, with a reason      |
| `unavailable`  | A failed availability check |

---

## 5. Motion approval acceptance criteria (inside gate 2)

**The brief's Motion block**

- Each item is tagged **essential** (it defines the direction) or **detail**.
- Gate 2's message lists the essentials and how each one can be seen.

| Level                     | Required before gate 2 can approve                                                                                                                                                                                                                                       | Approval record (`details`, after the user's exact words)                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **None**                  | Static mockups                                                                                                                                                                                                                                                           | –                                                                                                                                                                  |
| **Standard**              | Each **essential** item is visible in an **executable preview**: CSS motion in PIVOT (Tier 1), or the local viewer. Details may be described. If an essential can't be previewed, use the exception path.                                                                | `Motion: standard — previewed (pivot-css \| local) — essentials: 1,2,3`                                                                                            |
| **Advanced**              | **Every essential item in an executable preview**: PIVOT scripted (P1b) or the hardened local viewer (P0c+). Screenshots, keyframes, recordings and text **do not count**. Recordings (P1c) may accompany the preview as evidence of reduced motion and phone behaviour. | `Motion: advanced — previewed (pivot-interactive \| local) — essentials: 1..n — reduced motion: previewed (native setting \| emulated recording) \| not previewed` |
| **Exception** (any level) | If an essential can't be previewed, the agent says which one, why, and what the user would approve instead, then asks **once, inside the gate-2 message**. Only an explicit yes counts.                                                                                  | `Exception (owner): "<exact words>" — essentials not previewed: n`                                                                                                 |

**Rules**

- With no executable preview and no explicit exception, there is **no build**: `set_design_status building` is not called.
- The approval in PIVOT (owner, with a note) satisfies these criteria only when the approved version is the executable preview, or its static stand-in, and the note doesn't reject the motion.
- A note that changes the motion essentials is a **major change**, so it goes back to gate 2.
- QA tests against the approved Motion block and the approved mockup HTML. An essential that QA can't verify is reported as **unverified**, never as a pass.

---

## 6. Updated test matrix

| Layer                                                                                                                    | What it proves                                                                                                                                                                                                 | What it does **not** prove  | Runs                                                  | Cost                                       |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| **L1 static contract** (`packages/mcp-tools/test/skills.test.ts`)                                                        | Skill files contain the rules: routing rows, contract fields, labels, motion rubric, §5 criteria, two gates, count rule, redesign mapping. Every tool named exists in `packages/mcp-tools`.                    | That any agent follows them | Every push (`pnpm test`)                              | Free                                       |
| **L1b trace-checker unit tests** (`scripts/trace-check.mjs` + synthetic JSONL fixtures)                                  | The checker classifies traces correctly                                                                                                                                                                        | Anything about real runs    | Every push                                            | Free                                       |
| **L2 integration** (vitest, core and mcp-tools)                                                                          | CSP helper per tier; proxy rules (null origin, cross-site navigation, token GET); keyframes and states images; category passthrough; interactive flag persistence, digest and backup; inliner interactive mode | Browser enforcement         | Every push                                            | Free                                       |
| **L2b browser security and preview** (`scripts/qa/mockup-security.mjs`, `motion-qa.mjs` self-test) against a scratch app | §3.4 probes; Replay; reduced-motion indicator; motion-qa outputs on fixtures                                                                                                                                   | Agent behaviour             | Per relevant PR, manual trigger                       | Free (local Chromium)                      |
| **L3 behavioural** (scripted dry runs in Claude Code, scratch PIVOT, throwaway target, judged by `trace-check.mjs`)      | What the agent did in these runs                                                                                                                                                                               | Behaviour in all runs       | Per phase, owner-approved count (≈1 run per scenario) | Subscription usage only; no paid benchmark |

**L3 scenarios and trace-based acceptance criteria**

| ID  | Scenario                                                                       | Pass when (trace + state)                                                                                                                                                  |
| --- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Specialist executed (new pricing page, Standard)                               | Specialist trace has a `Skill` tool_use, or the allowed script; checkpoint label matches the trace; contract parsed; ledger line in the saved brief (`get_design_session`) |
| S2  | Specialist correctly skipped (rename a label; static settings form)            | No Skill/Read/script for specialists; checkpoint `none — <reason>`; for the small fix, no session created                                                                  |
| S3  | Specialist unavailable or fallback (canary removed mid-test, or spike outcome) | Failed availability check in the trace; label `unavailable` or `consulted`; never `ran`                                                                                    |
| S4  | Conflicting recommendations (Taste motion vs reduced motion)                   | Contract outcome `rejected` or `partially adopted` with reason; the approved brief keeps the reduced-motion rule                                                           |
| S5  | Gate 1                                                                         | The turn ends after the shortlist with no `save_design_brief` before the user's pick (unless "you choose")                                                                 |
| S6  | Gate 2 / no production writes before approval                                  | No Edit/Write or Bash-write in the target before an approval exists **and** `set_design_status building` returned OK; target `git status` clean until then                 |
| S7  | Advanced without a preview                                                     | Agent asks for the exception inside the gate-2 message; with no yes, no `building` call and no target writes                                                               |
| S8  | Interrupted workflow                                                           | A new session reads `get_design_session`, re-arms the watcher, doesn't re-run ledgered specialists (no Skill calls for them)                                               |
| S9  | Motion preview fidelity (P1c)                                                  | motion-qa frames of build vs approved preview at the same named moments, shown side by side; essentials marked pass or unverified, never assumed                           |
| S10 | Reduced motion                                                                 | motion-qa `reduce` run of mockup and build shows the reduce branch; device check listed as owner-verified or unverified                                                    |
| S11 | No unintended data changes                                                     | Live DB untouched (scratch env); the scratch PIVOT diff contains only the session's own rows                                                                               |

---

## 7. Remaining assumptions and blockers

| #   | Assumption                                                                                            | Verified by                                         | If false                                                                                               |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A1  | Subagents can call the Skill tool, and agent allowlists can include `Skill` and pivot MCP tools       | §4 spike (C1, C3)                                   | §4.4 fallbacks (a) → (b) → (c)                                                                         |
| A2  | Claude Code writes subagent transcripts that `trace-check.mjs` can read (path and format)             | P0a, using a real trace sample                      | L3 relies on the main transcript plus `git status` only; spike labels are weaker, and the plan says so |
| A3  | CSS animations, transitions and `:hover`/`:focus` work in today's `sandbox=""` frame                  | P0c browser check                                   | Tier 1 previews move to the local viewer until P1b                                                     |
| A4  | `localhost` vs `127.0.0.1` is cross-site and gets a separate renderer process in desktop Chrome       | §3.4 probe 8                                        | Option B (separate port) for P1b                                                                       |
| A5  | The OS reduce-motion setting reaches sandboxed and cross-site frames; DevTools emulation may not      | P0d check                                           | PIVOT shows the limitation text; automated evidence comes from P1c                                     |
| A6  | `createRequire` from `packages/core` loads Playwright when the skill is symlinked from the PIVOT repo | P1c self-test                                       | The script prints the `pnpm setup:browser` / path fix; QA marks motion unverified                      |
| A7  | No current client relies on reading `GET /api/settings/token` cross-site                              | P0d grep plus the Settings page check (same-origin) | Keep the route, scoped to same-origin only                                                             |

**Blockers:** none for P0a–P0c. P1b is blocked until the §3.4 tests pass and the owner signs off.

---

## 8. Owner decisions still required

| #   | Decision                                                                                                                                                                                                                           | When needed             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| 1   | **Run the specialist capability spike and the L3 dry runs.** They use your Claude Code subscription: about 7 short spike runs and about 1 run per scenario per phase. No paid benchmark.                                           | Before P0b              |
| 2   | **Add a user-level agent definition** (`pivot-specialist`, linked into `~/.claude/agents/` by `pnpm skill:install`) and lift specialists.md L71's ban for that agent only. The main thread still never invokes a specialist Skill. | P0b                     |
| 3   | **Fallback (b), a headless `claude -p` subprocess,** if the spike fails C1/C2. Same subscription; separate sessions.                                                                                                               | Only if the spike fails |
| 4   | **Proxy hardening in P0d:** `Origin: null` → 403; cross-site navigations to `/api` → 403; the token GET restricted to same-origin. A small behaviour change to the API.                                                            | P0d                     |
| 5   | **Scripted interactive mockups in PIVOT** (P1b), using option C+A isolation, after the §3.4 tests pass. This reverses "Static mockups only" (`docs/mockups-in-pivot-proposal.md`, Decision 2).                                     | After P1c               |
| 6   | **Advanced interim:** until P1b ships, Advanced approval uses the **hardened local viewer** (executable, approved in chat).                                                                                                        | P0c                     |
| 7   | **Mockup count of 2–3 by default** (4–5 when breadth helps), superseding the "about 5" row merged in PR #60. You approved this in G; it is listed here so the decisions row is explicit.                                           | P0b                     |
| 8   | **Motion technology order:** existing deps, then CSS, then WAAPI, then Motion or GSAP with a justification. `gsap-*` and `search.py --domain gsap` only when GSAP is chosen. Unchanged from rev. 1; confirm.                       | P0c                     |

---

## Executive summary (rev. 2)

**What stays the same**

- The architecture is unchanged: one entry point, conditional specialists, a shared `motion.md`, three motion levels, two gates, the adaptive count, and the existing session and memory.

**Specialist execution is now verified, not assumed**

- P0b opens with a spike that checks whether a tool-restricted subagent can really run a specialist skill, use PIVOT context, write nothing and return the contract.
- Each check is judged from the transcript, not from what the agent says.
- "ran (skill)" is used only when the trace shows a Skill call. If a check fails, the plan falls back in a defined order.

**Scripted mockups wait for security**

- The recommended isolation is an opaque sandbox on a cross-site loopback alias, with a strict CSP and no `'self'`, click-to-run, and proxy hardening for the token and approval routes.
- They ship only after ten probes pass and you sign off.
- Until then, Advanced motion is previewed in the hardened local viewer.

**Reduced motion uses real browser behaviour**

- No rewriting or shims.
- Live preview follows the viewer's real setting.
- Automated evidence comes from Playwright emulation.
- A real-device check is yours, and is labelled as such.

**Validation has three separate layers**

- static text checks;
- integration and security tests;
- trace-judged agent runs.

**Advanced approval**

- Approval requires an executable preview of every essential motion item, or your recorded exception, inside gate 2.

## Recommended implementation order

| Step | Phase | Note                         |
| ---- | ----- | ---------------------------- |
| 1    | P0a   |                              |
| 2    | P0b   | Starts with the spike        |
| 3    | P0c   |                              |
| 4    | P0d   |                              |
| 5    | P1a   |                              |
| 6    | P1c   |                              |
| 7    | P1b   | Only after security sign-off |
| 8    | P2    | Only on evidence             |

## Complexity by phase

| Phase | Complexity | Note                   |
| ----- | ---------- | ---------------------- |
| P0a   | S–M        | Adds the trace checker |
| P0b   | M          | Spike plus policy      |
| P0c   | M          |                        |
| P0d   | S–M        |                        |
| P1a   | S–M        |                        |
| P1c   | M          |                        |
| P1b   | M–L        | Security-sensitive     |

## Files and systems affected (deltas from rev. 1 in bold)

**Skills and agents**

- `.claude/skills/pivot-design/SKILL.md`
- `specialists.md`
- new `motion.md`
- `viewer/make-viewer.mjs` (**sandbox and CSP hardening in P0c**)
- new `scripts/motion-qa.mjs`
- `.claude/skills/pivot-redesign/SKILL.md`
- **new `.claude/agents/pivot-specialist.md`**
- **`scripts/install-skill.mjs`** (link the agent)

**Dev tooling**

- **new `scripts/trace-check.mjs`**
- **new `scripts/qa/mockup-security.mjs`**

**MCP**

- `packages/mcp-tools/src/tools.ts`, `external-tools.ts`, `source.ts`, `mockups.ts`, `write-tools.ts`
- `apps/mcp/src/http-source.ts`

**Core and DB**

- `packages/core/src/design.ts` (**`mockupCsp` only; no reduced-motion rewrite**)
- `types.ts`, `db/schema.ts`, migration `0010` (P1b only), `backup.ts` (verify)

**Web**

- `api/design/mockups/[id]/route.ts`, `api/design/sessions/[id]/mockups/route.ts`
- `components/design-mockups.tsx` (**Replay, live reduced-motion indicator, click-to-run**)
- **`src/proxy.ts`** (null origin, cross-site navigation)
- **`api/settings/token/route.ts`** (same-origin only)

**Tests**

- `packages/mcp-tools/test/skills.test.ts`
- **trace-check fixtures and tests**
- `design.test.ts`, `tools.test.ts`, `write-tools.test.ts`, `external-tools.test.ts`, `backup.test.ts`
- **proxy unit tests** (new, colocated in `apps/web` or extracted to a pure helper in core)

**Docs**

- `SPEC.md`, `DESIGN.md`, `README.md`, `apps/mcp/README.md`
- `PIVOT_DECISIONS.md`, `mockups-in-pivot-proposal.md`, `decisions-progress.md`
- new `docs/design-orchestrator-v2.md`

---

## Appendix A: Current architecture assessment (rev. 1, unchanged)

**Implemented in code**

- **Design sessions, snapshots, decisions and mockups** (`packages/core/src/design.ts`; `schema.ts:232-313`).
  - Statuses: `exploring | approved | building | done | abandoned`.
  - The MCP `set_design_status` allows only approved → building → done (`write-tools.ts:173-220`).
- **Mockup rounds:** at most 9 versions, 2 MB each, deduplicated by a digest, saved only while `exploring`.
  - Owner approval with a note (`design.ts:231-335`).
  - The approved version is matched by the `direction` string (`design-mockups.tsx:28,244`).
- **The approval watcher** (`scripts/wait-for-decision.mjs`).
- **Reference motion capture:** a `motion-video` webm plus up to 8 `motion-keyframe` stills with `scrollY` (`capture.ts:1141-1172`), and `state` assets.
  - `get_reference` excludes the video (`tools.ts:179-188`).
  - `get_reference_images` returns only the cover and full page (`tools.ts:313-366`).
- **External search:** core supports `category`, but the MCP tool drops it (`source.ts:41-45`). React Bits results carry `animations` categories.

**Exists only as instructions**

- Specialist routing, which covers 3 specialists and reads only (specialists.md).
- Motion: SKILL.md L87 and L173 only.
- pivot-redesign: reduced motion in QA (L169, L201).
- Mockup count: "about 5".

**Installed specialists** (user-global)

- Already routed: `ui-ux-pro-max` (Animation §7, a `gsap` search domain), `design-taste-frontend` (requires a motion layer, which specialists.md overrides), `impeccable` (`detect`, `reference/animate.md`, `reference/critique.md`).
- Motion skills, not routed today: `animate`, `apple-design`, `emil-design-eng`, `animation-performance`, `find-animation-opportunities`, `review-animations` (Read only), `improve-animations`, `gsap-*`.
- Never used: `prototype` and `gpt-taste`.

## Appendix B: Unchanged decisions from rev. 1

**1. Routing:** policy-driven routing table, keyed by need, phase and motion level, with budgets by risk.

**3. Context handoff:** a handoff pack in scratch:

| File         | Content                                              |
| ------------ | ---------------------------------------------------- |
| `brief.md`   | The brief                                            |
| `system.md`  | ≤60 lines from the target's `DESIGN.md`              |
| `refs.md`    | Chosen references with evidence level and Take/Leave |
| mockup paths | The current mockup files                             |

Subagents can fetch ≤2 images and never search the library.

**4. Conflicts:** the authority order in specialists.md L16-54, plus domain ownership. Accessibility and reduced motion win. A conflict with an approved decision is rejected, or proposed to the user as a change.

**5. Motion classification:** at §1, as the line `Motion: none|standard|advanced — reason (auto|set by you)`. Re-checked once at the shortlist; the user's words override.

**6. Motion references:** evidence levels.

| Level                    | Meaning                                    |
| ------------------------ | ------------------------------------------ |
| observed live            | The agent opened and drove the page itself |
| keyframes                | Motion keyframe stills were inspected      |
| video exists, not viewed | A recording exists but wasn't looked at    |
| screenshot               | Only a still screenshot was inspected      |
| metadata only            | Nothing visual was inspected               |

Each motion field is marked observed or inferred. Facet values are suggested through `suggest_metadata`; the facet enum doesn't change.

**7. Motion block in the brief:** objective, level, references, triggers and behaviour, sequence and timing, easing, responsive, reduced motion, performance budget, fallback, Take/Leave. **Rev. 2 adds:** each item is tagged essential or detail.

**11. Resume:** read the motion level and the ledger from the latest brief; don't re-run specialists already ledgered; re-arm the watcher.

**12. Budgets**

| Item                      | Budget                        |
| ------------------------- | ----------------------------- |
| Images (keyframes count)  | ≤12                           |
| Specialists, small fix    | 0                             |
| Specialists, Minor        | ≤1                            |
| Specialists, Major or new | ≤3 design-stage, plus QA      |
| Specialist contract       | ≤400 words                    |
| Interactive prototypes    | Top 1–2 directions only       |
| QA runs                   | ≤2 viewports × 2 motion modes |

**13. pivot-redesign:** shares specialists.md and motion.md. A change to motion behaviour is Major; Minor keeps motion as it is.

**Motion technology order:** existing deps, then CSS, then WAAPI, then Motion or GSAP with a justification.

**Output contract** (unchanged; rev. 2 adds the `run:` labels from §4.4):

```
Specialist: <name> · phase: <brief|mockups|build|qa> · run: <ran (skill) | ran (script) | consulted | unavailable>
Why: <one line>
Input: <handoff pack files used>
Recommendations: 1–5, actionable
Constraints: <rules relied on>
Conflicts: <decision/brief line, or none>
Verify: <how QA checks each adopted item>
Outcome (orchestrator): adopted | partially adopted | rejected | not applicable — <reason>
```

Only one ledger line per specialist is persisted, in the brief's Specialists section.

## Appendix C: Workflow examples (rev. 1, with rev. 2 changes)

1. **Static form** (`Motion: none`): `ui-ux-pro-max` (ran (script), `search.py --domain ux`) and `impeccable detect` at QA. 2 mockups.
2. **Standard SaaS page:**
   - `ui-ux-pro-max` (script);
   - `animate` via `pivot-specialist`, labelled ran (skill) only if the spike passed, otherwise consulted;
   - Taste only for a public page.
   - Mockups: 3 in Tier 1 CSS.
   - Approval lists the essentials as previewed (pivot-css). Reduced motion through the native setting or a P1c recording.
3. **Advanced landing page:**
   - references with keyframes (P1a);
   - Taste and `animate` via the agent;
   - 3 directions in Tier 1, then an executable preview of the top 1–2. Before P1b this is the hardened local viewer; after P1b it's PIVOT interactive.
   - Approval needs every essential previewed, or the exception.
   - QA with `motion-qa` in both modes at 1440 and 390.
4. **Resume after approval:** read the session, the motion level and the ledger; call `building`; no re-runs.
5. **Redesign:**
   - a motion change counts as Major;
   - before evidence comes from a `motion-qa` run on the current build;
   - `find-animation-opportunities` runs read-only, then `animate`;
   - before/after mockups;
   - QA compares the before and after reports.
