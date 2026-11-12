import { z } from "zod";
import {
  DESIGN_DECISION_KINDS,
  DESIGN_MILESTONES,
  DESIGN_QA_DETECTOR,
  DESIGN_QA_LEVELS,
  SPECIALIST_PHASES,
  SPECIALIST_RUN_LABELS,
  RESOURCE_TYPES,
  SUGGESTION_KINDS,
  TAG_KINDS,
  type DesignCandidateDTO,
  type DesignSessionDetailDTO,
} from "@pivot/core/types";
import { inlineMockup, MockupRejected } from "./mockups";
import { canWrite, ToolError, type PivotSource, type PivotWriter } from "./source";
import type { PivotTool, ToolResult } from "./tools";

// Tools that write to PIVOT. Each one stores something the agent produced (a brief, a decision, a suggestion, a note,
// a new reference) without overwriting what the user confirmed. Design documents go here, never into the target
// project's repository.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (t: string) => ({ type: "text" as const, text: t });

function writer(source: PivotSource): PivotSource & PivotWriter {
  if (!canWrite(source)) {
    throw new ToolError("read_only", "This PIVOT connection can only read. Nothing was saved.");
  }
  return source;
}

const NOT_IN_REPO =
  "Design briefs, decisions and session notes belong in PIVOT: never write them into the project's repository as well.";

// ---- save_design_brief ------------------------------------------------------------------------------------------

const briefInput = {
  sessionId: z
    .string()
    .regex(UUID)
    .optional()
    .describe("The design session from an earlier call. Leave out only for the first complete brief."),
  milestone: z
    .enum(DESIGN_MILESTONES)
    .describe(
      "initial: the first complete brief (opens the session). approved: the brief the user approved. major_change: the brief after a change in structure or direction (the session then needs approving again).",
    ),
  title: z.string().min(1).max(200).describe('Short name of the work, e.g. "Ledgerly pricing page".'),
  targetProject: z.string().max(200).optional().describe("The project being designed for (its folder or repo name)."),
  surface: z.string().max(200).optional().describe('What is designed, e.g. "pricing page".'),
  markdown: z.string().min(1).max(200_000).describe("The whole brief in Markdown, Take / Leave table included."),
  referenceIds: z.array(z.string().regex(UUID)).max(50).optional().describe("The PIVOT references the brief uses."),
  note: z.string().max(2000).optional().describe("What changed since the last snapshot, for major_change."),
};

const saveDesignBrief: PivotTool<typeof briefInput> = {
  name: "save_design_brief",
  title: "Save a design brief",
  description: `Stores a design brief in PIVOT at a milestone: the first complete brief (opens a design session; tiny fixes don't get one), the approved brief, or a major change. Saving the same brief again returns the same snapshot. ${NOT_IN_REPO}`,
  inputSchema: briefInput,
  async run(source, input) {
    const res = await writer(source).saveDesignBrief(input);
    const what = res.duplicate
      ? "That brief was already saved at this milestone"
      : res.created
        ? "Saved the brief and opened a design session"
        : `Saved the ${input.milestone.replace("_", " ")} brief`;
    return {
      content: [text(`${what}. sessionId ${res.sessionId}, snapshot ${res.snapshotId}.`)],
      structuredContent: res,
    };
  },
};

// ---- record_design_decision -------------------------------------------------------------------------------------

/** What an agent may record: never an approval, which only the owner makes, in PIVOT. */
const AGENT_DECISION_KINDS = DESIGN_DECISION_KINDS.filter((k) => k !== "approval") as [
  Exclude<(typeof DESIGN_DECISION_KINDS)[number], "approval">,
  ...Exclude<(typeof DESIGN_DECISION_KINDS)[number], "approval">[],
];

const decisionInput = {
  sessionId: z.string().regex(UUID).describe("The design session."),
  kind: z
    .enum(AGENT_DECISION_KINDS)
    .describe(
      "change: the user changed an approved decision. deviation: QA found the build departs from the approved direction. (Approvals are the owner's alone: they approve in PIVOT, never through this tool.)",
    ),
  summary: z.string().min(1).max(2000).describe("One or two sentences: what was decided or found."),
  direction: z.string().max(2000).optional().describe("The direction it concerns."),
  details: z.string().max(50_000).optional().describe("Anything else worth keeping, in Markdown."),
  mockupId: z
    .string()
    .regex(UUID)
    .optional()
    .describe("The mockup version it concerns, when there is one (its id, from get_design_session)."),
  mockupDigest: z
    .string()
    .regex(/^[0-9a-f]{12,64}$/i)
    .optional()
    .describe("That version's digest (at least its first 12 characters). PIVOT refuses it if it isn't that version's."),
};

const recordDesignDecision: PivotTool<typeof decisionInput> = {
  name: "record_design_decision",
  title: "Record a design decision",
  description: `Records a change after approval, or a deviation found in QA, in the design session's history. It can't record an approval: approvals are the owner's alone. When the user chooses a version in the chat, give them the session page's link and ask them to press Approve this version there (it needs their owner passphrase); get_design_session and the watcher then show the approval. ${NOT_IN_REPO}`,
  inputSchema: decisionInput,
  async run(source, { sessionId, ...input }) {
    const res = await writer(source).recordDesignDecision(sessionId, input);
    return {
      content: [
        text(
          `Recorded the ${input.kind} (id ${res.id})${input.mockupId ? `, bound to mockup version ${input.mockupId}` : ""}.`,
        ),
      ],
      structuredContent: { id: res.id, sessionId, kind: input.kind, mockupId: input.mockupId ?? null },
    };
  },
};

// ---- save_design_mockups ----------------------------------------------------------------------------------------

const MOCKUP_BYTES = 2 * 1024 * 1024;

const mockupsInput = {
  sessionId: z.string().regex(UUID).describe("The design session (exploring: a new brief, or a major change)."),
  mockups: z
    .array(
      z.object({
        title: z.string().min(1).max(120).describe('The direction\'s name, e.g. "Raised Pro card".'),
        path: z
          .string()
          .optional()
          .describe(
            "Absolute path of the mockup's HTML file. Local CSS, images and fonts in its folder are inlined; a reference outside the folder fails the save.",
          ),
        html: z.string().optional().describe("The mockup's HTML instead of a path, already self-contained."),
        interactive: z
          .boolean()
          .optional()
          .describe(
            "true for a prototype whose scripts carry its interactions or motion: its scripts are kept (local .js files inlined) and run only in the separate, network-locked preview browser (scripts/preview.mjs), never on PIVOT's pages. Default false: a static mockup, scripts removed.",
          ),
      }),
    )
    .min(1)
    .max(9)
    .describe("The versions of this round, in the order they are shown (1 to 9)."),
  snapshotId: z.string().regex(UUID).optional().describe("The brief they illustrate; defaults to the latest."),
};

const saveDesignMockups: PivotTool<typeof mockupsInput> = {
  name: "save_design_mockups",
  title: "Save mockups to a design session",
  description: `Stores a round of mockup versions in the design session, where the user compares them as tabs at desktop, tablet and phone width and can approve one with a note. Local stylesheets, images and fonts from the mockup's own folder are inlined (2 MB in all); a reference outside that folder fails the save and nothing is stored; scripts and remote files are removed (they don't load in PIVOT). A version marked interactive keeps its scripts: PIVOT's page shows it without them, and the user tries it in the interactive preview (scripts/preview.mjs), a separate browser locked to the stored, digest-checked versions. Each call is a new round; the same set again returns the same round. Only while the session is exploring. Returns the page's link. ${NOT_IN_REPO}`,
  inputSchema: mockupsInput,
  async run(source, { sessionId, snapshotId, mockups }) {
    const w = writer(source);
    const dropped = new Set<string>();
    const missing = new Set<string>();
    const skipped = new Set<string>();
    const versions = [];
    for (const [i, m] of mockups.entries()) {
      if ((m.path == null) === (m.html == null))
        throw new ToolError("invalid_input", `Version ${i + 1}: give either path or html.`);
      let html = m.html ?? "";
      if (m.path != null) {
        if (!m.path.startsWith("/") && !/^[a-z]:[\\/]/i.test(m.path))
          throw new ToolError("invalid_input", `Version ${i + 1}: path must be absolute.`);
        try {
          const r = await inlineMockup(m.path, { interactive: m.interactive === true });
          html = r.html;
          r.dropped.forEach((d) => dropped.add(d));
          r.missing.forEach((d) => missing.add(d));
          r.skipped.forEach((d) => skipped.add(d));
        } catch (e) {
          // Fail closed: one reference outside the mockup's folder (or over budget) and nothing in the round is saved.
          if (e instanceof MockupRejected)
            throw new ToolError(
              "invalid_input",
              `Version ${i + 1} was not saved: ${e.problems.join("; ")}. A mockup may only use files inside its own folder, by relative path.`,
            );
          throw new ToolError("invalid_input", `Version ${i + 1}: can't read ${m.path}.`);
        }
      }
      if (Buffer.byteLength(html) > MOCKUP_BYTES)
        throw new ToolError(
          "invalid_input",
          `Version ${i + 1} is over 2 MB once inlined: use smaller or fewer images (screenshots as WebP or JPEG).`,
        );
      versions.push({ title: m.title, html, ...(m.interactive ? { interactive: true } : {}) });
    }
    const res = await w.saveDesignMockups(sessionId, { snapshotId, mockups: versions });
    const url = w.appUrl ? `${w.appUrl}/design/${sessionId}?round=${res.round}` : undefined;
    const lines = [
      `${res.created ? "Saved" : "Already saved as"} round ${res.round} with ${versions.length} version${versions.length === 1 ? "" : "s"}.`,
      url ? `The user opens it at ${url}` : "",
      "The user can approve a version there, with a note; get_design_session then shows that approval with source owner.",
      versions.some((v) => "interactive" in v)
        ? `Interactive versions: ${versions.flatMap((v, i) => ("interactive" in v ? [i + 1] : [])).join(", ")}. Their scripts don't run on PIVOT's page; open them for the user with the interactive preview (node <pivot-design skill>/scripts/preview.mjs ${sessionId}).`
        : "",
      dropped.size ? `Removed (scripts and remote files don't load in PIVOT): ${[...dropped].join(", ")}` : "",
      missing.size ? `Missing local files: ${[...missing].join(", ")}` : "",
      skipped.size ? `Not inlined: ${[...skipped].join(", ")}` : "",
    ];
    return {
      content: [text(lines.filter(Boolean).join("\n"))],
      structuredContent: {
        ...res,
        sessionId,
        url,
        dropped: [...dropped],
        missing: [...missing],
        skipped: [...skipped],
      },
    };
  },
};

// ---- set_design_status ------------------------------------------------------------------------------------------

const statusInput = {
  sessionId: z.string().regex(UUID).describe("The design session."),
  status: z
    .enum(["building", "done"])
    .describe(
      "building: you are starting to build the approved direction (only from approved). done: the build and its QA are finished with nothing left for the user to decide (only from building).",
    ),
};

// The two moves an agent makes; exploring and approved follow briefs and approvals, abandoned is the user's call.
const FROM: Record<"building" | "done", { from: string; why: string }> = {
  building: {
    from: "approved",
    why: "Only an approved session can start building: show the direction and record the user's approval first.",
  },
  done: { from: "building", why: "Only a session that is building can be marked done." },
};

const setDesignStatus: PivotTool<typeof statusInput> = {
  name: "set_design_status",
  title: "Set a design session's status",
  description:
    "Moves a design session to building when you start implementing its approved direction, and to done when the build and QA are finished with nothing left for the user to decide. Setting the status it already has changes nothing. It never sets exploring, approved or abandoned.",
  inputSchema: statusInput,
  async run(source, { sessionId, status }) {
    const w = writer(source);
    const s = await w.getDesignSession(sessionId);
    if (!s) throw new ToolError("not_found", `No design session ${sessionId}.`);
    if (s.status === status) {
      return { content: [text(`The session is already ${status}.`)], structuredContent: { sessionId, status } };
    }
    const rule = FROM[status];
    if (status === "done" && s.status === "building" && !s.currentQaId)
      throw new ToolError(
        "conflict",
        "Record the QA first with record_design_qa (the slop check, the specialist ledger, what stayed unverified), then mark the session done.",
      );
    if (s.status !== rule.from) {
      const hint =
        s.status === "abandoned"
          ? " The user abandoned it: ask whether to restore it before doing more."
          : s.status === "exploring"
            ? " It is exploring: the direction needs the user's approval again."
            : "";
      throw new ToolError("conflict", `The session is ${s.status}. ${rule.why}${hint}`);
    }
    const updated = await w.setDesignStatus(sessionId, status);
    return {
      content: [text(`The session is now ${updated.status}.`)],
      structuredContent: { sessionId, status: updated.status },
    };
  },
};

// ---- record_design_qa --------------------------------------------------------------------------------------------

const qaInput = {
  sessionId: z.string().regex(UUID).describe("The design session (building)."),
  level: z
    .enum(DESIGN_QA_LEVELS)
    .describe("new: a new design (pivot-design). minor or major: a redesign at that risk level (pivot-redesign)."),
  summary: z.string().min(1).max(300).describe("One line: what QA found, and whether anything is left."),
  slopCheck: z
    .object({
      detector: z.object({
        status: z
          .enum(DESIGN_QA_DETECTOR)
          .describe("ran, not_installed (impeccable isn't installed), or failed (it was there but didn't run)."),
        result: z
          .string()
          .min(1)
          .max(4000)
          .describe("What the detector reported (findings and what you did), or why it didn't run."),
      }),
      checklist: z
        .string()
        .min(1)
        .max(4000)
        .describe("What the checklist against DESIGN.md found on the after screenshots, or that it found nothing."),
      critique: z
        .string()
        .max(4000)
        .optional()
        .describe("The text critique against impeccable's critique.md. Required for level new and major."),
    })
    .describe("pivot-design §10's slop check."),
  specialists: z
    .array(
      z.object({
        name: z.string().min(1).max(80).describe('The specialist, e.g. "ui-ux-pro-max", or "none".'),
        phase: z.enum(SPECIALIST_PHASES),
        run: z.enum(SPECIALIST_RUN_LABELS).describe("The run label of what really happened (specialists.md §1)."),
        outcome: z
          .string()
          .min(1)
          .max(300)
          .describe("adopted / partially adopted / rejected / not applicable, and why; for none, the user's words."),
      }),
    )
    .min(1)
    .max(12)
    .describe(
      "The specialist ledger: at least the design-stage specialist (brief or mockups); for new and major also the QA audit (phase qa).",
    ),
  unverified: z
    .array(z.string().min(1).max(300))
    .max(30)
    .optional()
    .describe(
      "Checks that were blocked or not run (widths, states, axe, keyboard, motion…): unverified, never passed.",
    ),
};

const recordDesignQa: PivotTool<typeof qaInput> = {
  name: "record_design_qa",
  title: "Record a design session's QA",
  description:
    "Records the QA report of a session that is building, before you mark it done: the slop check (detector, checklist, and the critique for a new design or a Major redesign), the specialist ledger with run labels, and what stayed unverified. set_design_status done is refused without one recorded after the current approval. Record what you really did: a check you didn't run is unverified.",
  inputSchema: qaInput,
  async run(source, { sessionId, ...input }) {
    const w = writer(source);
    if (!w.recordDesignQa)
      throw new ToolError("not_supported", "This PIVOT app can't store QA reports yet: update PIVOT and restart it.");
    const res = await w.recordDesignQa(sessionId, { ...input, unverified: input.unverified ?? [] });
    return {
      content: [text(`Recorded the QA report (${res.id}). You can now mark the session done if nothing is left.`)],
      structuredContent: { sessionId, id: res.id },
    };
  },
};

// ---- propose_references / select_references (gate 1) --------------------------------------------------------------

const candidateText = (c: DesignCandidateDTO) =>
  `${c.n}. ${c.title} — ${c.kind === "library" ? `library reference (id ${c.resourceId})` : `external, ${c.source}`}${
    c.url ? ` — ${c.url}` : ""
  }${c.selected ? " — PICKED by the user" : ""}\n   Why: ${c.why}${c.take ? `\n   Take: ${c.take}` : ""}${
    c.avoid ? `\n   Avoid: ${c.avoid}` : ""
  }${
    c.kind === "external"
      ? c.previewStatus === "ready"
        ? "\n   Preview: captured by PIVOT"
        : c.previewStatus === "failed"
          ? `\n   Preview: none (${c.previewError})`
          : "\n   Preview: still capturing"
      : ""
  }`;

const proposeInput = {
  sessionId: z.string().regex(UUID).describe("The design session (exploring)."),
  candidates: z
    .array(
      z.object({
        resourceId: z.string().regex(UUID).optional().describe("A library reference, from search_references."),
        url: z
          .string()
          .url()
          .optional()
          .describe(
            "An external page you found and checked is real (a web search, a gallery, a component catalog): the page itself, never a search-results page.",
          ),
        title: z.string().max(200).optional().describe("Defaults to the reference's title, or the page's host."),
        source: z
          .string()
          .max(120)
          .optional()
          .describe('Where an external page was found, e.g. "web search", "land-book.com", "React Bits".'),
        why: z.string().min(1).max(1000).describe("Why it fits this brief, from what you saw."),
        take: z.string().max(1000).optional().describe("What to take from it."),
        avoid: z.string().max(1000).optional().describe("What to leave or avoid."),
      }),
    )
    .min(1)
    .max(12)
    .describe("Library references and external pages, in the order to show them."),
};

const PREVIEW_WAIT_MS = 120_000;

const proposeReferences: PivotTool<typeof proposeInput> = {
  name: "propose_references",
  title: "Propose references for the user to pick (gate 1)",
  description: `Puts the references you recommend on the design session's page in PIVOT, numbered, so the user can see them and pick: library references by id, and real external pages by URL. PIVOT captures its own preview of each external page (public http/https only) and returns those previews here so you can check each one is what you said; a page that can't be captured (blocked, login, timeout) is listed with the reason. External pages are NOT saved to the library (save_reference only if the user asks). Never invent a URL: propose only pages you found and opened. After this, show the user the numbered list with the session link and wait for their pick (gate 1); record it with select_references. ${NOT_IN_REPO}`,
  inputSchema: proposeInput,
  async run(source, { sessionId, candidates }) {
    const w = writer(source);
    if (!w.proposeReferences || !w.listCandidates)
      throw new ToolError(
        "not_supported",
        "This PIVOT app can't hold proposed references yet (update and restart it).",
      );
    const { candidates: added } = await w.proposeReferences(sessionId, candidates);
    const ids = new Set(added.map((c) => c.id));
    // wait for PIVOT to finish capturing the external pages, so the user and you see the same previews
    let current = added;
    for (
      const until = Date.now() + PREVIEW_WAIT_MS;
      current.some((c) => c.previewStatus === "pending") && Date.now() < until;
    ) {
      await new Promise((r) => setTimeout(r, 2000));
      current = (await w.listCandidates(sessionId)).filter((c) => ids.has(c.id));
    }
    const images = [];
    for (const c of current.filter((c) => c.kind === "external" && c.previewStatus === "ready").slice(0, 8)) {
      const img = await w.getCandidatePreview?.(c.id);
      if (img) images.push({ type: "image" as const, data: img.data.toString("base64"), mimeType: img.mimeType });
    }
    const url = w.appUrl ? `${w.appUrl}/design/${sessionId}#references` : undefined;
    const skipped = candidates.length - added.length;
    const lines = [
      `Proposed ${current.length} reference${current.length === 1 ? "" : "s"}${skipped ? ` (${skipped} already proposed, skipped)` : ""}:`,
      ...current.map(candidateText),
      url ? `The user sees them, with previews, at ${url}` : "",
      "Previews of the external pages follow, in order. Check each matches what you wrote; if not, say so to the user.",
      "Now show the user the numbered list and the link, and wait for their pick (gate 1). Record it with select_references, quoting their words.",
    ];
    return {
      content: [text(lines.filter(Boolean).join("\n")), ...images],
      structuredContent: { sessionId, url, candidates: current },
    };
  },
};

const selectInput = {
  sessionId: z.string().regex(UUID).describe("The design session."),
  numbers: z.array(z.number().int().min(1)).min(1).max(30).describe("The numbers the user picked."),
  userWords: z
    .string()
    .min(1)
    .max(2000)
    .describe('The user\'s own words for the pick, quoted exactly, e.g. "2 and 5: the cards of 2, the type of 5".'),
};

const selectReferences: PivotTool<typeof selectInput> = {
  name: "select_references",
  title: "Record the user's pick of references (gate 1)",
  description: `Records which proposed references the user picked, with their own words, on the session's page. Call it only with numbers the user gave you in this conversation; never pick for them (if they said "you choose", quote that). Exactly these become the picked ones. ${NOT_IN_REPO}`,
  inputSchema: selectInput,
  async run(source, { sessionId, numbers, userWords }) {
    const w = writer(source);
    if (!w.selectReferences)
      throw new ToolError(
        "not_supported",
        "This PIVOT app can't hold proposed references yet (update and restart it).",
      );
    const { selected } = await w.selectReferences(sessionId, { numbers, userWords });
    return {
      content: [text([`Recorded the user's pick: "${userWords}"`, ...selected.map(candidateText)].join("\n"))],
      structuredContent: { sessionId, selected },
    };
  },
};

// ---- get_design_session -----------------------------------------------------------------------------------------

const sessionInput = {
  sessionId: z.string().regex(UUID).optional().describe("A session id; leave out to list sessions."),
  targetProject: z.string().max(200).optional().describe("When listing: only this project's sessions."),
};

function sessionText(s: DesignSessionDetailDTO) {
  const lines = [
    `${s.title} — ${s.status}${s.targetProject ? ` — ${s.targetProject}` : ""}${s.surface ? ` (${s.surface})` : ""}`,
    `Snapshots: ${s.snapshots.map((x) => `${x.milestone} ${x.createdAt.slice(0, 10)}`).join(", ") || "none"}`,
    `Decisions: ${
      s.decisions
        .map(
          (d) =>
            `${d.kind}${d.source === "owner" ? " (by the user, in PIVOT)" : ""}${d.id === s.currentApprovalId ? " [counts now]" : ""}: ${d.summary}` +
            (d.direction ? ` Direction: ${d.direction}.` : "") +
            (d.binding
              ? ` Bound to mockup ${d.binding.mockupId}, digest ${d.binding.digest.slice(0, 12)}: ${
                  d.binding.status === "bound"
                    ? "unchanged"
                    : d.binding.status === "changed"
                      ? "CHANGED since approval, approve again"
                      : "the version is gone, approve again"
                }.`
              : "") +
            (d.source === "owner" && d.details ? ` The user's note: "${d.details}"` : ""),
        )
        .join(" | ") || "none"
    }`,
  ];
  if (!s.currentApprovalId && s.decisions.some((d) => d.kind === "approval"))
    lines.push(
      "No approval counts now (the session went back to exploring after it, or approvals conflict): the direction needs approving again before building.",
    );
  if (s.status === "building")
    lines.push(
      s.currentQaId
        ? `QA: recorded (${s.currentQaId}); mark the session done when nothing is left for the user to decide.`
        : "QA: not recorded yet. Record it with record_design_qa before marking the session done.",
    );
  const rounds = [...new Set((s.mockups ?? []).map((m) => m.round))];
  if (rounds.length) {
    lines.push(
      `Mockups: ${rounds
        .map(
          (r) =>
            `round ${r}: ${s.mockups
              .filter((m) => m.round === r)
              .map((m) => `${m.n}. ${m.title} (id ${m.id}, digest ${m.digest.slice(0, 12)})`)
              .join(", ")}`,
        )
        .join(" | ")}`,
    );
  }
  if (s.candidates?.length) {
    const picked = s.candidates.filter((c) => c.selected);
    lines.push(
      "",
      `Proposed references (gate 1): ${picked.length ? `the user picked ${picked.map((c) => c.n).join(", ")} ("${picked[0].selectedWords}")` : "not picked yet"}`,
      ...s.candidates.map(candidateText),
    );
  }
  const last = s.snapshots.at(-1);
  if (last) lines.push("", `Latest brief (${last.milestone}):`, last.markdown);
  return lines.join("\n");
}

const getDesignSession: PivotTool<typeof sessionInput> = {
  name: "get_design_session",
  title: "Get a design session",
  description:
    "Reads a design session (its brief snapshots, decisions and mockup rounds) to continue earlier work, or lists sessions, most recent first. An approval with source owner was made by the user in PIVOT: it is the user's explicit approval, and its note is their instruction for the build. Snapshot text is the agent's and the user's own design notes.",
  inputSchema: sessionInput,
  async run(source, { sessionId, targetProject }) {
    const w = writer(source);
    if (sessionId) {
      const s = await w.getDesignSession(sessionId);
      if (!s) throw new ToolError("not_found", `No design session ${sessionId}.`);
      return { content: [text(sessionText(s))], structuredContent: { ...s } };
    }
    const sessions = await w.listDesignSessions(targetProject);
    return {
      content: [
        text(
          sessions.length
            ? sessions
                .map((s, i) => `${i + 1}. ${s.title} — ${s.status} — ${s.updatedAt.slice(0, 10)} (id ${s.id})`)
                .join("\n")
            : "No design sessions yet.",
        ),
      ],
      structuredContent: { sessions },
    };
  },
};

// ---- suggest_metadata -------------------------------------------------------------------------------------------

const suggestInput = {
  id: z.string().regex(UUID).describe("The reference, from search_references."),
  suggestions: z
    .array(
      z.object({
        kind: z.enum(SUGGESTION_KINDS),
        value: z
          .record(z.string(), z.unknown())
          .describe(
            'facet: {"kind": "pageType"|"domain"|"visualStyle"|"uiPattern"|"technology"|"tag", "name": "…"}; collection: {"name": "…"} or {"id": "…"}; title or description: {"text": "…"}.',
          ),
        reason: z.string().max(500).optional().describe("Why, from what you saw in the screenshot."),
      }),
    )
    .min(1)
    .max(30),
};

const suggestMetadata: PivotTool<typeof suggestInput> = {
  name: "suggest_metadata",
  title: "Suggest facets, collections, a title or a description",
  description: `Suggests metadata for a reference after looking at it: facets (prefer names list_facets shows; a matching name is reused, so don't invent synonyms), collections, a better title, or a visual description for search. Suggestions wait in the user's Inbox until accepted; they never change the reference by themselves and are searchable meanwhile. Facet kinds: ${TAG_KINDS.join(", ")}.`,
  inputSchema: suggestInput,
  async run(source, { id, suggestions }) {
    const res = await writer(source).addSuggestions(
      id,
      suggestions.map((s) => ({ kind: s.kind, value: s.value, reason: s.reason })),
    );
    const lines = [
      `${res.added.length} suggestion${res.added.length === 1 ? "" : "s"} added to the Inbox.`,
      ...res.added.map((a) => {
        const v = a.value as { kind?: string; name?: string; text?: string; existing?: boolean };
        const what = a.kind === "facet" ? `${v.kind}: ${v.name}` : a.kind === "collection" ? v.name : v.text;
        return `- ${a.kind}: ${what}${v.existing === false ? " (new)" : ""}`;
      }),
      ...res.skipped.map((s) => `- skipped ${s.kind}: ${s.why}`),
    ];
    return { content: [text(lines.join("\n"))], structuredContent: res };
  },
};

// ---- annotate_reference -----------------------------------------------------------------------------------------

const annotateInput = {
  id: z.string().regex(UUID).describe("The reference."),
  note: z.string().min(1).max(2000).describe("What you learned from it, e.g. how its pricing table groups features."),
};

const annotateReference: PivotTool<typeof annotateInput> = {
  name: "annotate_reference",
  title: "Add a note to a reference",
  description:
    "Appends a short note to a reference's notes, marked as the agent's and dated. The user's own notes are never changed.",
  inputSchema: annotateInput,
  async run(source, { id, note }) {
    const res = await writer(source).annotate(id, note);
    return { content: [text(`Added: ${res.line}`)], structuredContent: res };
  },
};

// ---- save_reference ---------------------------------------------------------------------------------------------

const saveInput = {
  url: z.string().url().describe("The page to save (http or https)."),
  type: z.enum(RESOURCE_TYPES).optional().describe('Default "reference".'),
  title: z.string().max(300).optional().describe("Leave out to use the page's own title."),
  notes: z.string().max(5000).optional().describe("Why it is worth keeping."),
  facets: z
    .array(z.object({ kind: z.enum(TAG_KINDS), name: z.string().min(1).max(80) }))
    .max(20)
    .optional()
    .describe("Facets the user asked for; prefer existing names (list_facets)."),
  collections: z.array(z.string().max(120)).max(10).optional().describe("Existing collections, by id or name."),
};

const saveReference: PivotTool<typeof saveInput> = {
  name: "save_reference",
  title: "Save a page to PIVOT",
  description:
    "Saves a public page to the user's library when they ask for it (external results are never saved on their own). PIVOT takes the screenshots in the background; the reference lands in the Inbox for the user to review. A page already saved as the same type is not saved twice.",
  inputSchema: saveInput,
  async run(source, input) {
    const w = writer(source);
    let collectionIds: string[] | undefined;
    if (input.collections?.length) {
      const all = await source.listCollections();
      collectionIds = input.collections.map((c) => {
        const hit = all.find((x) => x.id === c || x.name.toLowerCase() === c.toLowerCase());
        if (!hit) throw new ToolError("not_found", `No collection "${c}". list_facets shows the collections.`);
        return hit.id;
      });
    }
    const res = await w.saveReference({ ...input, tags: input.facets, collectionIds });
    return {
      content: [
        text(
          res.existing
            ? `Already saved: ${res.title ?? input.url} (id ${res.id}). Nothing new was created.`
            : `Saved ${res.title ?? input.url} (id ${res.id}); it is in the Inbox and the screenshots are being taken.`,
        ),
      ],
      structuredContent: res,
    };
  },
};

export const WRITE_TOOLS = [
  saveDesignBrief,
  recordDesignDecision,
  recordDesignQa,
  saveDesignMockups,
  setDesignStatus,
  getDesignSession,
  proposeReferences,
  selectReferences,
  suggestMetadata,
  annotateReference,
  saveReference,
] as PivotTool[];

export type { ToolResult };
