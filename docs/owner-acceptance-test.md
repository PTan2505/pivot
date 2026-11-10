# Owner acceptance test: the first real design workflow

One real run of the whole workflow, by you, with your own approval. About 45–60 minutes. The automated demo
(`scripts/qa/workflow-demo`) already checks the mechanics with TEST-ONLY approvals. This test is the part only you
can do: a real pick, a real approval, and judging the result.

## Before you start (once)

1. Get the code under test. Either merge PR #70, then #71, then the release-hardening PR into `dev` and check out
   `dev`, or check out the release-hardening branch in your PIVOT folder:

   ```bash
   git fetch origin && git switch feat/owner-approval-gate && pnpm install
   ```

2. Rebuild the MCP server and relink the skills, then **start a new Claude Code session**, because agents and MCP
   servers load at start:

   ```bash
   pnpm mcp:build && pnpm skill:install
   ```

3. Set your owner passphrase, in **your own** terminal, never through Claude. Use at least 12 characters, and nothing
   you use elsewhere:

   ```bash
   pnpm owner:passphrase
   ```

   Expected: `Owner passphrase set (~/.pivot/owner-approval.json)…`

4. Start PIVOT and open <http://127.0.0.1:4321>:

   ```bash
   npm start
   ```

## The run

| #   | You do                                                                                                                                                                                          | Expected                                                                                                                                                                                                                                                                                                       |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | In a real project, ask Claude Code: _"Design a pricing page for this project with PIVOT references. Make the top direction interactive, with a menu and a small entrance animation."_           | Claude restates the goal, audience and motion level, then searches PIVOT.                                                                                                                                                                                                                                      |
| 2   | Look at the 6–10 references it shows (each links to PIVOT), and reply with your picks, e.g. _"2 and 5: the cards of 2, the type of 5"_.                                                         | It stops until you pick. Then it writes the brief and opens a design session in PIVOT.                                                                                                                                                                                                                         |
| 3   | Wait for the mockups.                                                                                                                                                                           | 2–3 versions saved to PIVOT; one marked **Interactive**. Claude gives you the session link, and a separate **Interactive preview** window opens.                                                                                                                                                               |
| 4   | In the preview window: click through the interactive version; try Desktop / Tablet / Phone, **Motion: reduced**, Replay and **Compare**. Note the digest in the footer of the version you like. | Interactions and motion work. Reduced motion stops the movement. The footer shows `Version n · id … · digest …`.                                                                                                                                                                                               |
| 5   | **Negative check:** tell Claude in the chat _"I approve version 2."_                                                                                                                            | Claude does **not** start building. It gives you the session link and asks you to approve there.                                                                                                                                                                                                               |
| 6   | In PIVOT, open the session page, select the same version (its digest line matches the preview), press **Approve this version**, add a note if you like, and type your passphrase.               | The version shows **Approved**; the session moves to Approved. A wrong passphrase is refused.                                                                                                                                                                                                                  |
| 7   | Go back to Claude.                                                                                                                                                                              | Within seconds, without you writing anything, Claude says it is building version n from your note. PIVOT shows **Building**.                                                                                                                                                                                   |
| 8   | Let it build and check.                                                                                                                                                                         | It builds in the project. Then it reports QA: functional checks, desktop, tablet and phone, a comparison with the approved version, accessibility, motion with and without reduced motion. Each check is pass, fail or unverified, never assumed. PIVOT shows **Done** when nothing is left for you to decide. |
| 9   | Judge the result yourself, in the browser.                                                                                                                                                      | It matches the version you approved. Any departure is listed in the report as a question for you, not silently changed.                                                                                                                                                                                        |

## If something goes wrong

- **The dialog says no passphrase is set:** run `pnpm owner:passphrase` (step 3) and open the dialog again.
- **"Too many wrong passphrases":** owner actions are locked for 15 minutes.
- **The preview window doesn't open:** run `pnpm setup:browser` in the PIVOT folder. Claude falls back to the local
  viewer and says so.
- **To stop:** press **Abandon** on the session page. Nothing in your project changes until a version is approved.

## What to report back

Pass or fail for steps 1–9, anything that surprised you, and whether the built page is what you approved.
