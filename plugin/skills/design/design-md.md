# A DESIGN.md for a project that has none

Shared by `pivot:design` (§0) and `pivot:redesign` (§1). A design is only as consistent as the system it is checked against, and a project without one makes every session rediscover its colours, type and spacing from the code. So the first design session in such a project drafts one, from the code, and the user decides whether it goes into the project.

**DESIGN.md is a file of the project, not a session document.** It describes the project's own design system, for every future change, and lives in the project's repository like its other docs. Briefs, decisions and session notes still go into PIVOT only (the skill's rule doesn't change). Never write DESIGN.md without the user's yes, never commit it, and never touch other files while doing this.

## 1. When

- At `pivot:design` §0 or `pivot:redesign` §1, after looking for the project's design system: no `DESIGN.md` at the project root, in `docs/`, or wherever the project's `CLAUDE.md` / `AGENTS.md` says its design docs live.
- **Not** when the project already documents its system under another name (`docs/design-system.md`, `STYLEGUIDE.md`, a Storybook "Foundations" page, a tokens package with a README): use that as the design system and don't create a second one. Mention once that a DESIGN.md could point to it, nothing more.
- **Not** for a small, explicit fix (it skips the flow): say in one line that the project has no DESIGN.md and offer to draft one later.
- **Once per session**: if the user declines, don't ask again in this session; read the code directly as before.

## 2. Gather, from the code only

Read before you write; count rather than guess.

- **Tokens and theme:** CSS custom properties (`:root`, `[data-theme]`, `@theme` in Tailwind 4), `tailwind.config.*`, theme objects (MUI, Chakra, styled-components, `theme.ts`), design-token JSON, SCSS variables.
- **Global styles:** the root stylesheet, resets, `color-scheme`, dark/light switching.
- **Type:** the fonts actually loaded (`next/font`, `@font-face`, `<link>`), the sizes, weights and line heights in use.
- **Spacing, radius, elevation:** the scale the tokens define, and the raw values that repeat in components (`rounded-[14px]` ten times is a rule; once is an accident).
- **Components:** the component library and where it lives (`components/ui`, a shadcn `components.json`, a package), the primitives every screen reuses (button, input, card, dialog), their variants.
- **Layout:** breakpoints, container widths, page gutters, the navigation pattern.
- **Motion:** durations and easings in tokens or repeated in code, the motion library if any, reduced-motion handling.
- **Icons and imagery:** the icon set and its default size.

Where two values compete (two near-identical greys, three button heights), write down both with where each is used: that is an open question, not something to settle quietly.

## 3. Draft

A short, factual document: 80–200 lines for most projects. Structure:

1. **Overview:** what the product is and the character the code shows (2–4 sentences: dark or light, dense or airy, sharp or round), the stack (framework, styling, component library).
2. **Colors:** each token with its value and its role (surface, text, accent, status…), and contrast where it matters.
3. **Typography:** families, the scale (name, size, weight, line height), where each is used.
4. **Spacing and layout:** the spacing scale, breakpoints, containers and gutters, the navigation pattern.
5. **Shapes and elevation:** radii, borders, shadows.
6. **Components:** the shared ones, by path, with their variants and the rules they follow.
7. **Motion:** durations, easings, reduced motion.
8. **Rules:** the patterns the code consistently keeps (one primary button per screen, icons always with a label, …), only those you saw.
9. **Open questions:** gaps and conflicts (no token for X, values hard-coded in N places, two competing button styles).

- **Every value comes from the code**, with its file (`--accent: #ff6a13` in `app/globals.css`). Never invent a brand colour, a scale step or a rule the code doesn't show; what's missing goes to Open questions.
- Write it in the language the project's docs use (English when unsure).
- Keep it about the system, not the current task: nothing from this session's brief.

## 4. Show it, then ask

- Write the draft to your scratchpad (never the project), and show it in the chat: in full when it's short, otherwise its outline, the colour and type tables, the open questions and the scratchpad path.
- Ask with `AskUserQuestion`: **Write it to `<project>/DESIGN.md`** (recommended) / **Change something first** / **Don't create it**. Name the exact path. Without that tool, ask in the chat and stop for the answer.
- **Change something:** apply what the user says to the draft, show it again, ask again.
- **Yes:** write exactly the draft they saw to that path (or another path they name). Don't commit, don't stage, don't edit any other file. Say where it is and that it isn't committed.
- **No:** carry on reading the code directly; don't ask again this session.

## 5. Afterwards

- Use the new DESIGN.md as the project's design system for the rest of the flow (the brief's constraints, the mockups, the build and the §10 checklist).
- Mention it in the brief's design-system line ("DESIGN.md, created this session from the code"), without copying it into PIVOT.
- An existing DESIGN.md is never rewritten this way. A change to it is a design-system change: it needs its own approval (`pivot:redesign` §5).
