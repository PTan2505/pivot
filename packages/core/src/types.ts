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
  | { key: string; label: string; kind: "colors" };

const purpose: MetaField = { key: "purpose", label: "Purpose", kind: "text", placeholder: "What is this for?" };

export const TYPE_DEFS: Record<ResourceType, ResourceTypeDef> = {
  reference: {
    type: "reference",
    label: "Reference",
    plural: "References",
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
    group: "knowledge",
    icon: "plug",
    visual: false,
    url: "optional",
    content: "json",
    facets: ["technology"],
    fields: [{ key: "serverName", label: "Server name", kind: "text", placeholder: "figma" }],
    exportDir: "mcp",
  },
};

/** Types that live in their own tab and stay out of the library's "All" view and count. */
export const SEPARATE_TYPES: readonly ResourceType[] = ["skill"];

export function isResourceType(v: unknown): v is ResourceType {
  return typeof v === "string" && (RESOURCE_TYPES as readonly string[]).includes(v);
}

export type AssetKind = "image" | "svg" | "video" | "lottie" | "font" | "text" | "other";
export type AssetRole = "screenshot" | "screenshot-full" | "attachment";
export type CaptureStatus = "pending" | "done" | "failed";
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
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  tags: TagDTO[];
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
