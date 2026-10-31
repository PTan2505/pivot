// Pure, isomorphic definitions shared by the server and the browser.

export const RESOURCE_TYPES = [
  "reference",
  "library",
  "media",
  "icon",
  "animation",
  "typography",
  "prompt",
  "skill",
  "snippet",
  "rule",
  "checklist",
  "mcp",
  "source",
] as const;

export type ResourceType = (typeof RESOURCE_TYPES)[number];

export const TAG_KINDS = ["tag", "pageType", "domain", "visualStyle", "uiPattern", "technology"] as const;
export type TagKind = (typeof TAG_KINDS)[number];

export const TAG_KIND_LABELS: Record<TagKind, string> = {
  tag: "Tags",
  pageType: "Page type",
  domain: "Domain",
  visualStyle: "Style",
  uiPattern: "Pattern",
  technology: "Technology",
};

/** Suggested facet values, seeded on first run. Users can add their own. */
export const FACET_SUGGESTIONS: Record<Exclude<TagKind, "tag">, string[]> = {
  pageType: [
    "Landing page",
    "Dashboard",
    "Admin",
    "Settings",
    "Pricing",
    "Onboarding",
    "Auth",
    "Docs",
    "Blog",
    "Portfolio",
    "Checkout",
    "Profile",
  ],
  domain: [
    "SaaS",
    "CRM",
    "E-commerce",
    "Fintech",
    "Developer tool",
    "AI",
    "Health",
    "Education",
    "Social",
    "Media",
    "Productivity",
  ],
  visualStyle: [
    "Minimal",
    "Dark",
    "Brutalist",
    "Glassmorphism",
    "Editorial",
    "Playful",
    "Futuristic",
    "Pixel art",
    "Corporate",
    "Retro",
    "Bento",
  ],
  uiPattern: [
    "Sidebar",
    "Data table",
    "Modal",
    "Command palette",
    "Kanban",
    "Charts",
    "Form",
    "Empty state",
    "Navigation",
    "Cards",
    "Hero",
    "Pricing table",
  ],
  technology: [
    "React",
    "Next.js",
    "Tailwind CSS",
    "shadcn/ui",
    "Framer Motion",
    "GSAP",
    "Three.js",
    "Radix UI",
    "Vue",
    "Svelte",
    "Lottie",
    "CSS",
  ],
};

export type ContentKind = "none" | "markdown" | "code" | "json";

export interface ResourceTypeDef {
  type: ResourceType;
  label: string;
  plural: string;
  /** One line on what this type holds, shown in the navbar menu. */
  blurb: string;
  group: "visual" | "knowledge";
  /** Lucide icon name, resolved in the web app. */
  icon: string;
  /** Card leads with an image (cover asset) rather than text. */
  visual: boolean;
  url: "primary" | "optional";
  content: ContentKind;
  facets: Exclude<TagKind, "tag">[];
  /** Type-specific meta fields rendered in the detail form. */
  fields: MetaField[];
  /** Folder used inside an export bundle. */
  exportDir: string;
}

export type MetaField =
  | { key: string; label: string; kind: "text"; placeholder?: string }
  | { key: string; label: string; kind: "textarea"; placeholder?: string }
  | { key: string; label: string; kind: "list"; placeholder?: string }
  | { key: string; label: string; kind: "select"; options: readonly { value: string; label: string }[]; hint?: string }
  | { key: string; label: string; kind: "colors" };

/** What you go to a source site to find. Sources are grouped by these on their tab. */
export const SOURCE_CATEGORIES = [
  { value: "inspiration", label: "Inspiration", hint: "Whole sites, landing pages and visual direction" },
  { value: "product-ui", label: "Product UI", hint: "Screens and flows from real apps" },
  {
    value: "styles-systems",
    label: "Styles & Systems",
    hint: "Visual styles, design systems and how others build components",
  },
  { value: "components", label: "Components", hint: "Components with code you can copy" },
  { value: "motion", label: "Motion", hint: "Animation, effects and micro-interactions" },
  { value: "type-color", label: "Type & Color", hint: "Fonts, pairings and palettes" },
  { value: "assets", label: "Assets", hint: "Icons and illustrations" },
] as const;
export type SourceCategory = (typeof SOURCE_CATEGORIES)[number]["value"];

export const SOURCE_PRICING = [
  { value: "free", label: "Free" },
  { value: "freemium", label: "Freemium" },
  { value: "paid", label: "Paid" },
] as const;

/** `searchUrl` holds a template where `{q}` stands for the URL-encoded query. */
export function sourceSearchUrl(template: string, query: string) {
  return template.replaceAll("{q}", encodeURIComponent(query.trim()));
}

const purpose: MetaField = { key: "purpose", label: "Purpose", kind: "text", placeholder: "What is this for?" };

export const TYPE_DEFS: Record<ResourceType, ResourceTypeDef> = {
  reference: {
    type: "reference",
    label: "Reference",
    plural: "References",
    blurb: "Pages and screens worth studying",
    group: "visual",
    icon: "globe",
    visual: true,
    url: "primary",
    content: "none",
    facets: ["pageType", "domain", "visualStyle", "uiPattern"],
    fields: [],
    exportDir: "references",
  },
  library: {
    type: "library",
    label: "UI Library",
    plural: "UI Libraries",
    blurb: "Component kits and design-system docs",
    group: "visual",
    icon: "library",
    visual: true,
    url: "primary",
    content: "none",
    facets: ["technology", "visualStyle"],
    fields: [],
    exportDir: "libraries",
  },
  media: {
    type: "media",
    label: "Image & Video",
    plural: "Images & Videos",
    blurb: "Screenshots, mood images and clips",
    group: "visual",
    icon: "image",
    visual: true,
    url: "optional",
    content: "none",
    facets: ["pageType", "visualStyle", "uiPattern"],
    fields: [],
    exportDir: "media",
  },
  icon: {
    type: "icon",
    label: "Icon & SVG",
    plural: "Icons & SVGs",
    blurb: "Icon sets, logos and SVG art",
    group: "visual",
    icon: "shapes",
    visual: true,
    url: "optional",
    content: "none",
    facets: ["visualStyle"],
    fields: [],
    exportDir: "icons",
  },
  animation: {
    type: "animation",
    label: "Animation",
    plural: "Animations",
    blurb: "Lottie files, motion code and recordings",
    group: "visual",
    icon: "sparkles",
    visual: true,
    url: "optional",
    content: "code",
    facets: ["technology", "uiPattern"],
    fields: [{ key: "language", label: "Code language", kind: "text", placeholder: "css, tsx…" }],
    exportDir: "animations",
  },
  typography: {
    type: "typography",
    label: "Font & Palette",
    plural: "Fonts & Palettes",
    blurb: "Typefaces, pairings and color palettes",
    group: "visual",
    icon: "palette",
    visual: true,
    url: "optional",
    content: "none",
    facets: ["visualStyle", "domain"],
    fields: [
      { key: "colors", label: "Colors", kind: "colors" },
      { key: "fonts", label: "Fonts", kind: "list", placeholder: "Inter, Geist Mono…" },
    ],
    exportDir: "typography",
  },
  prompt: {
    type: "prompt",
    label: "Prompt",
    plural: "Prompts & Briefs",
    blurb: "Briefs with {{variables}} to reuse",
    group: "knowledge",
    icon: "message-square-text",
    visual: false,
    url: "optional",
    content: "markdown",
    facets: ["technology", "pageType"],
    fields: [purpose],
    exportDir: "prompts",
  },
  skill: {
    type: "skill",
    label: "Skill",
    plural: "Skills",
    blurb: "Claude Code skills, grouped by pack",
    group: "knowledge",
    icon: "wand",
    visual: false,
    url: "optional",
    content: "markdown",
    facets: ["technology"],
    fields: [
      {
        key: "whenToUse",
        label: "When to use",
        kind: "textarea",
        placeholder: "Which tasks or projects is this skill good for?",
      },
    ],
    exportDir: "skills",
  },
  snippet: {
    type: "snippet",
    label: "Snippet",
    plural: "Code Snippets",
    blurb: "Code to copy into your projects",
    group: "knowledge",
    icon: "code",
    visual: false,
    url: "optional",
    content: "code",
    facets: ["technology", "uiPattern"],
    fields: [{ key: "language", label: "Language", kind: "text", placeholder: "tsx" }],
    exportDir: "snippets",
  },
  rule: {
    type: "rule",
    label: "Coding Rule",
    plural: "Coding Rules",
    blurb: "Conventions to hand to an AI agent",
    group: "knowledge",
    icon: "scroll-text",
    visual: false,
    url: "optional",
    content: "markdown",
    facets: ["technology"],
    fields: [purpose],
    exportDir: "rules",
  },
  checklist: {
    type: "checklist",
    label: "Checklist",
    plural: "Checklists & SOPs",
    blurb: "Steps to run before you ship",
    group: "knowledge",
    icon: "list-checks",
    visual: false,
    url: "optional",
    content: "markdown",
    facets: ["technology"],
    fields: [purpose],
    exportDir: "checklists",
  },
  mcp: {
    type: "mcp",
    label: "MCP Config",
    plural: "MCP Configs",
    blurb: "Server configs for Claude Code",
    group: "knowledge",
    icon: "plug",
    visual: false,
    url: "optional",
    content: "json",
    facets: ["technology"],
    fields: [{ key: "serverName", label: "Server name", kind: "text", placeholder: "figma" }],
    exportDir: "mcp",
  },
  source: {
    type: "source",
    label: "Source",
    plural: "Sources",
    blurb: "Sites to browse for references",
    group: "visual",
    icon: "compass",
    visual: true,
    url: "primary",
    content: "none",
    facets: [],
    fields: [
      { key: "category", label: "Category", kind: "select", options: SOURCE_CATEGORIES },
      { key: "searchUrl", label: "Search URL", kind: "text", placeholder: "https://dribbble.com/search/{q}" },
      { key: "pricing", label: "Pricing", kind: "select", options: SOURCE_PRICING },
      { key: "platforms", label: "Covers", kind: "list", placeholder: "web, ios, android" },
      { key: "whenToUse", label: "When to use", kind: "textarea", placeholder: "What do you come here for?" },
    ],
    exportDir: "sources",
  },
};

/** The app's top-level sections, shown in the navbar. Every type belongs to exactly one. */
export const SECTIONS = [
  { id: "library", label: "Library", types: ["reference", "library", "media", "icon", "animation", "typography"] },
  { id: "knowledge", label: "Knowledge", types: ["prompt", "snippet", "rule", "checklist", "mcp"] },
  { id: "sources", label: "Sources", types: ["source"] },
  { id: "skills", label: "Skills", types: ["skill"] },
] as const satisfies readonly { id: string; label: string; types: readonly ResourceType[] }[];

export type SectionId = (typeof SECTIONS)[number]["id"];
export type Section = { id: SectionId; label: string; types: readonly ResourceType[] };

export function sectionOf(type: ResourceType): Section {
  return SECTIONS.find((s) => (s.types as readonly ResourceType[]).includes(type))!;
}

export function isSectionId(v: unknown): v is SectionId {
  return SECTIONS.some((s) => s.id === v);
}

export function isResourceType(v: unknown): v is ResourceType {
  return typeof v === "string" && (RESOURCE_TYPES as readonly string[]).includes(v);
}

export type AssetKind = "image" | "svg" | "video" | "lottie" | "font" | "text" | "other";
/**
 * `screenshot` / `screenshot-full` are the Latest server capture. `-original` keeps the first successful capture once
 * a retake replaces it, and `-variant` holds the other colour scheme when both were captured.
 */
export type AssetRole =
  | "screenshot"
  | "screenshot-full"
  | "screenshot-original"
  | "screenshot-full-original"
  | "screenshot-variant"
  | "screenshot-full-variant"
  | "attachment";
/** `partial`: the first screen was saved but the full page wasn't. `cancelled`: stopped by the user. */
export type CaptureStatus = "pending" | "done" | "partial" | "failed" | "cancelled";
/** Separate from the status: a completed capture can still look wrong (blank, a sign-in wall, broken images). */
export type CaptureQuality = "looks_good" | "needs_review" | "unavailable";
export type CaptureTheme = "light" | "dark" | "both";

/** What one capture is asked to do. Unset fields fall back to the capture settings. */
export interface CaptureOptions {
  /** Click "Load more"-style buttons while walking the page. Off unless asked for. */
  expandContent?: boolean;
  theme?: CaptureTheme;
}

export interface CaptureSettings {
  expandContent: boolean;
  theme: CaptureTheme;
}

export const DEFAULT_CAPTURE_SETTINGS: CaptureSettings = { expandContent: false, theme: "dark" };

export type CaptureAttemptStatus = "queued" | "capturing" | "completed" | "partial" | "failed" | "cancelled";

export interface CaptureAttemptDTO {
  id: string;
  resourceId: string;
  method: "server" | "extension";
  status: CaptureAttemptStatus;
  quality: CaptureQuality | null;
  qualityReasons: string[];
  error: string | null;
  context: Record<string, unknown>;
  viewportAssetId: string | null;
  fullAssetId: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
export type SkillSyncState = "synced" | "app-changed" | "disk-changed" | "conflict" | "missing";

export interface TagDTO {
  id: string;
  kind: TagKind;
  name: string;
  count?: number;
}

export interface AssetDTO {
  id: string;
  kind: AssetKind;
  role: AssetRole;
  fileName: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  sourceUrl: string | null;
  notes: string;
  /** For screenshots: colorScheme, viewport, capturedAt, finalUrl. */
  meta: Record<string, unknown>;
  createdAt: string;
  /** Present when the file no longer exists on disk. */
  missing?: boolean;
}

export interface ResourceDTO {
  id: string;
  type: ResourceType;
  title: string;
  description: string;
  sourceUrl: string | null;
  notes: string;
  content: string;
  meta: Record<string, unknown>;
  coverAssetId: string | null;
  captureStatus: CaptureStatus | null;
  captureError: string | null;
  captureQuality: CaptureQuality | null;
  /** "needs_review": a quick save waiting in the Inbox. Separate from the capture status. */
  reviewStatus: "needs_review" | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: TagDTO[];
  /** The server's full-page screenshot, if any: reference cards scroll through it on hover. */
  fullShot: { id: string; width: number | null; height: number | null } | null;
}

export interface ResourceDetailDTO extends ResourceDTO {
  assets: AssetDTO[];
  collections: { id: string; name: string }[];
}

export interface CollectionDTO {
  id: string;
  name: string;
  description: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface SkillStatusDTO {
  resourceId: string | null;
  skillName: string;
  state: SkillSyncState | "untracked";
  dirPath: string;
  isSymlink: boolean;
  /** Plugin skills are read-only in the app. */
  readonly: boolean;
}

export interface SkillPackDTO {
  id: string;
  name: string;
  author: string | null;
  kind: "repo" | "plugin" | "author" | "local";
  repoUrl: string | null;
  homepage: string | null;
  description: string;
  count: number;
}

// ---- Search for agents (MCP) and paged API callers ----

export const SEARCH_SORTS = ["relevance", "updated", "created", "oldest", "title"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

export interface SearchRequest {
  query?: string;
  /** Types to search; defaults to references. Ignored when `section` is set. */
  types?: ResourceType[];
  section?: SectionId;
  /** Facets or tags by name, all required (AND), matched case-insensitively. */
  facets?: { kind: TagKind; name: string }[];
  collectionId?: string;
  /** Only resources saved from this source (a source resource id). */
  sourceId?: string;
  /** `relevance` (the default with a query) ranks title, then tag, then description matches; otherwise recently edited. */
  sort?: SearchSort;
  /** 1–50, default 20. */
  limit?: number;
  /** From the previous page's `nextCursor`. */
  cursor?: string | null;
}

/** One result, small enough for an agent's context: no storage paths, no asset ids, no notes or content. */
export interface SearchHit {
  id: string;
  type: ResourceType;
  title: string;
  /** "attio.com", never the full tracking URL. */
  host: string | null;
  /** http(s) only. */
  sourceUrl: string | null;
  /** Up to 280 characters. */
  description: string;
  /** Facets first, then plain tags; at most 8. */
  facets: { kind: TagKind; name: string }[];
  hasScreenshot: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SearchPage {
  results: SearchHit[];
  total: number;
  nextCursor: string | null;
  sort: SearchSort;
  /** Requested facets that don't exist in the library; the result is then empty. */
  unknownFacets?: { kind: TagKind; name: string }[];
}

/** How two references relate. Theme, viewport, Original/Latest and states are assets of one reference, not links. */
export const LINK_KINDS = ["same_source_page", "part_of", "related_to", "variant_of", "newer_version_of"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

export const LINK_LABELS: Record<LinkKind, { out: string; in: string }> = {
  same_source_page: { out: "Same page as", in: "Same page as" },
  part_of: { out: "Part of", in: "Has section" },
  related_to: { out: "Related to", in: "Related to" },
  variant_of: { out: "Variant of", in: "Has variant" },
  newer_version_of: { out: "Newer version of", in: "Older version of" },
};

export interface ResourceLinkDTO {
  id: string;
  kind: LinkKind;
  /** "out": this reference is the link's `from`. */
  direction: "out" | "in";
  /** False for a suggestion waiting to be accepted. */
  confirmed: boolean;
  origin: "auto" | "user" | "agent";
  other: { id: string; title: string; type: string; coverAssetId: string | null };
  createdAt: string;
}
