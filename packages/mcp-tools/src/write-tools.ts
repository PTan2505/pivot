import { z } from "zod";
import {
  DESIGN_DECISION_KINDS,
  DESIGN_MILESTONES,
  RESOURCE_TYPES,
  SUGGESTION_KINDS,
  TAG_KINDS,
  type DesignSessionDetailDTO,
} from "@pivot/core/types";
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

// ---- get_design_session -----------------------------------------------------------------------------------------

const sessionInput = {
  sessionId: z.string().regex(UUID).optional().describe("A session id; leave out to list sessions."),
  targetProject: z.string().max(200).optional().describe("When listing: only this project's sessions."),
};

function sessionText(s: DesignSessionDetailDTO) {
  const lines = [
    `${s.title} — ${s.status}${s.targetProject ? ` — ${s.targetProject}` : ""}${s.surface ? ` (${s.surface})` : ""}`,
    `Snapshots: ${s.snapshots.map((x) => `${x.milestone} ${x.createdAt.slice(0, 10)}`).join(", ") || "none"}`,
    `Decisions: ${s.decisions.map((d) => `${d.kind}: ${d.summary}`).join(" | ") || "none"}`,
  ];
  const last = s.snapshots.at(-1);
  if (last) lines.push("", `Latest brief (${last.milestone}):`, last.markdown);
  return lines.join("\n");
}

const getDesignSession: PivotTool<typeof sessionInput> = {
  name: "get_design_session",
  title: "Get a design session",
  description:
    "Reads a design session (its brief snapshots and decisions) to continue earlier work, or lists sessions, most recent first. Snapshot text is the agent's and the user's own design notes.",
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
  getDesignSession,
  suggestMetadata,
  annotateReference,
  saveReference,
] as PivotTool[];

export type { ToolResult };
