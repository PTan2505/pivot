import { z } from "zod";
import {
  DESIGN_DECISION_KINDS,
  DESIGN_MILESTONES,
  RESOURCE_TYPES,
  SUGGESTION_KINDS,
  TAG_KINDS,
  type DesignSessionDetailDTO,
} from "@pivot/core/types";
import { inlineMockup } from "./mockups";
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

const decisionInput = {
  sessionId: z.string().regex(UUID).describe("The design session."),
  kind: z
    .enum(DESIGN_DECISION_KINDS)
    .describe(
      "approval: the user explicitly approved a direction (only then build). change: the user changed an approved decision. deviation: QA found the build departs from the approved direction.",
    ),
  summary: z.string().min(1).max(2000).describe("One or two sentences: what was decided or found."),
  direction: z.string().max(2000).optional().describe("The chosen direction or mix, for an approval."),
  details: z.string().max(50_000).optional().describe("Anything else worth keeping, in Markdown."),
};

const recordDesignDecision: PivotTool<typeof decisionInput> = {
  name: "record_design_decision",
  title: "Record a design decision",
  description: `Records an approval, a change after approval, or a deviation found in QA in the design session's history. Record an approval only after the user explicitly approved a direction in this conversation. ${NOT_IN_REPO}`,
  inputSchema: decisionInput,
  async run(source, { sessionId, ...input }) {
    const res = await writer(source).recordDesignDecision(sessionId, input);
    return {
      content: [text(`Recorded the ${input.kind} (id ${res.id}).`)],
      structuredContent: { id: res.id, sessionId, kind: input.kind },
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
          .describe("Absolute path of the mockup's HTML file. Local CSS, images and fonts are inlined."),
        html: z.string().optional().describe("The mockup's HTML instead of a path, already self-contained."),
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
  description: `Stores a round of mockup versions (static HTML) in the design session, where the user compares them as tabs at desktop, tablet and phone width and can approve one with a note. Local stylesheets, images and fonts are inlined; scripts and remote files are removed (they don't load in PIVOT). Each call is a new round; the same set again returns the same round. Only while the session is exploring. Returns the page's link. ${NOT_IN_REPO}`,
  inputSchema: mockupsInput,
  async run(source, { sessionId, snapshotId, mockups }) {
    const w = writer(source);
    const dropped = new Set<string>();
    const missing = new Set<string>();
    const versions = [];
    for (const [i, m] of mockups.entries()) {
      if ((m.path == null) === (m.html == null))
        throw new ToolError("invalid_input", `Version ${i + 1}: give either path or html.`);
      let html = m.html ?? "";
      if (m.path != null) {
        if (!m.path.startsWith("/") && !/^[a-z]:[\\/]/i.test(m.path))
          throw new ToolError("invalid_input", `Version ${i + 1}: path must be absolute.`);
        try {
          const r = await inlineMockup(m.path);
          html = r.html;
          r.dropped.forEach((d) => dropped.add(d));
          r.missing.forEach((d) => missing.add(d));
        } catch {
          throw new ToolError("invalid_input", `Version ${i + 1}: can't read ${m.path}.`);
        }
      }
      if (Buffer.byteLength(html) > MOCKUP_BYTES)
        throw new ToolError(
          "invalid_input",
          `Version ${i + 1} is over 2 MB once inlined: use smaller or fewer images (screenshots as WebP or JPEG).`,
        );
      versions.push({ title: m.title, html });
    }
    const res = await w.saveDesignMockups(sessionId, { snapshotId, mockups: versions });
    const url = w.appUrl ? `${w.appUrl}/design/${sessionId}?round=${res.round}` : undefined;
    const lines = [
      `${res.created ? "Saved" : "Already saved as"} round ${res.round} with ${versions.length} version${versions.length === 1 ? "" : "s"}.`,
      url ? `The user opens it at ${url}` : "",
      "The user can approve a version there, with a note; get_design_session then shows that approval with source owner.",
      dropped.size ? `Removed (scripts and remote files don't load in PIVOT): ${[...dropped].join(", ")}` : "",
      missing.size ? `Missing local files: ${[...missing].join(", ")}` : "",
    ];
    return {
      content: [text(lines.filter(Boolean).join("\n"))],
      structuredContent: { ...res, sessionId, url, dropped: [...dropped], missing: [...missing] },
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
            `${d.kind}${d.source === "owner" ? " (by the user, in PIVOT)" : ""}: ${d.summary}` +
            (d.direction ? ` Direction: ${d.direction}.` : "") +
            (d.source === "owner" && d.details ? ` The user's note: "${d.details}"` : ""),
        )
        .join(" | ") || "none"
    }`,
  ];
  const rounds = [...new Set((s.mockups ?? []).map((m) => m.round))];
  if (rounds.length) {
    lines.push(
      `Mockups: ${rounds
        .map(
          (r) =>
            `round ${r}: ${s.mockups
              .filter((m) => m.round === r)
              .map((m) => `${m.n}. ${m.title}`)
              .join(", ")}`,
        )
        .join(" | ")}`,
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
  saveDesignMockups,
  setDesignStatus,
  getDesignSession,
  suggestMetadata,
  annotateReference,
  saveReference,
] as PivotTool[];

export type { ToolResult };
