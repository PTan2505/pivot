# Requirements Specification — Personal UI/UX Resource Library

**Version:** v0.1  
**Status:** A consolidated set of requirements and proposals; some decisions still need to be confirmed.

## 1. Product overview

### 1.1. Goal

Build a web app that runs locally on a personal machine. It helps a developer store, organize, search and reuse UI/UX resources during frontend development, especially when working with AI such as Claude Code.

The app is more than a place to save website bookmarks. The long-term direction is a **personal frontend knowledge library** where the developer can manage reference resources, prompts, skills and workflows, and bring them into the right context when handing work to AI.

### 1.2. Problems to solve

- UI/UX resources are scattered across bookmarks, local files, websites and many other sources.
- It is hard to find a saved website, component, animation or asset again.
- There is no consistent way to link reference resources with prompts and skills for a task.
- Preparing context for Claude Code takes time when implementing an interface.
- Prompts and skills are easily lost, duplicated or hard to update.
- Data needs to be stored locally, with the ability to back up and restore it.

### 1.3. Product principles

1. **Local-first:** the primary data is stored on the personal machine and does not depend on the cloud.
2. **All-in-one:** many kinds of resources are managed in one app.
3. **Searchable:** search by keyword, tag and many filters.
4. **AI-friendly:** resources are easy to copy or export for use with Claude Code.
5. **Extensible:** MCP and AI features can be added later.
6. **Reusable:** resources can be linked to each other instead of being stored as separate items.

## 2. Scope of content to manage

The proposed data model is `Resource`: each item in the library is a resource, but each type has its own content and metadata.

| Resource group            | Examples                                                   |
| ------------------------- | ---------------------------------------------------------- |
| UI/UX References          | Websites, landing pages, dashboards, admin pages, CRM      |
| UI Libraries              | React component libraries, design systems, templates       |
| Images & Videos           | Reference images, demo videos, interface screenshots       |
| Icons & SVGs              | Icons, SVGs, logos and vector assets                       |
| Animations & Interactions | Animations, motion effects, micro-interactions             |
| Fonts & Color Palettes    | Fonts, color palettes, typography references               |
| Code Snippets             | UI code snippets or reusable patterns                      |
| Prompts & Briefs          | Prompts for specific tasks, briefs describing an interface |
| Skills & Workflows        | Claude Code skills, guides and reusable workflows          |
| Coding Rules              | Code conventions and frontend implementation guidelines    |
| Checklists & SOPs         | UI review checklists, responsive checks, procedures        |
| MCP Configurations        | Configuration for connecting AI tools and MCP servers      |

> This is a proposed scope consolidated from the ideas discussed. Whether to include every group in the MVP still needs to be settled.

### 2.1. Resource, Metadata, Content and Asset

Example with a dashboard website:

- **Resource:** the reference item for the dashboard website.
- **Metadata:** name, URL, tags, page type, style, description.
- **Content:** the user's notes or detailed analysis of the interface.
- **Asset:** screenshots, videos or SVGs stored locally.

With a prompt or skill:

- **Resource:** the prompt or skill item.
- **Metadata:** name, purpose, tags, related technology.
- **Content:** the prompt text or the skill's instructions.
- **Asset:** an attached file or document, if any.

Separating these parts makes it possible to search and edit metadata without losing the main content or the path to the file.

## 3. Functional requirements (Functional Requirements)

### FR-01. Resource management

The app must let the user:

- Create, view, edit and delete resources.
- Choose the resource type when creating one.
- Store a title, description, URL, tags and personal notes.
- Classify resources by attributes suited to each type.
- Store text content and links to local files.
- View the detail page of each resource.
- Detect duplicate URLs to avoid saving the same website several times (proposed for a later phase).

### FR-02. Add a resource from a URL

The user can paste a URL to create a reference resource.

The system must:

1. Receive the URL from the user.
2. Automatically fetch the page's metadata when possible, such as the title and the Open Graph image.
3. Let the user edit the automatically fetched information.
4. Let the user add a description, tags, page type, domain and style.
5. Save the resource after the user confirms.

If a website does not allow access to its metadata, the app must still allow manual entry. It must not depend entirely on automatic fetching.

### FR-03. File and asset management

Priority support:

- Images: PNG, JPG, WebP and other common formats.
- Vector: SVG.
- Video: common video formats.
- Animation files or interface data files where suitable.
- Text files, Markdown and code snippets.

Features:

- Upload files from the computer.
- Preview a file in a way that suits its format.
- Attach a file to one or more resources when needed.
- Store the file's origin and notes about it.
- Download or open a file where appropriate.
- Show a status when a file is missing or no longer accessible.

The MVP should prioritize common formats instead of trying to support every file type.

### FR-04. Metadata and classification management

Each resource type has a suitable metadata set, and some common fields are reused.

| Field          | Meaning                    |
| -------------- | -------------------------- |
| `title`        | Resource name              |
| `resourceType` | Resource type              |
| `description`  | Short description          |
| `tags`         | Labels managed by the user |
| `createdAt`    | Creation time              |
| `updatedAt`    | Last update time           |
| `sourceUrl`    | Online source, if any      |
| `notes`        | Personal notes             |

Type-specific metadata can include:

| Field         | Example                            |
| ------------- | ---------------------------------- |
| `pageType`    | Landing page, dashboard, admin     |
| `domain`      | SaaS, CRM, e-commerce              |
| `visualStyle` | Minimal, futuristic, pixel art     |
| `uiPattern`   | Sidebar, data table, modal         |
| `technology`  | React, Tailwind CSS, Framer Motion |
| `purpose`     | The goal of a prompt or skill      |

Not every field is required for every resource type.

### FR-05. Search and filtering

The user must be able to:

- Search by title, description, URL, notes or relevant text content.
- Filter by resource type.
- Filter by tag.
- Combine several filters, for example `React + Animation + Dashboard`.
- Clear the filters and return to the full list.
- Switch between grid and list display modes.

The current direction is keyword search and filters; AI semantic search is not required yet.

### FR-06. Prompts & Briefs management

Prompts and briefs are managed as searchable, reusable resources, not just loose pieces of text.

Proposed data fields:

- Prompt or brief name.
- Intended use.
- Content.
- Tags and related technology.
- Notes or usage instructions.
- Version or edit history, if implemented.

Features:

- Create and edit.
- Copy the content.
- Search by keyword and tag.
- Link a prompt to reference websites, assets or skills.
- Export the content for use in Claude Code.

### FR-07. Skills & Workflows management

A skill is a reusable procedure or set of instructions for a group of tasks, as opposed to a prompt, which is used for one specific request.

Examples:

- A skill for implementing a dashboard in React.
- A skill for analyzing a UI reference before coding.
- A skill for checking responsiveness.
- A skill for reviewing AI-generated code.

Proposed features:

- Create and edit skill content.
- Store the name, purpose, tags and related technology.
- Read the content in a clear structure.
- Copy or export a skill to a file.
- Support a folder structure compatible with Claude Code once the required format is known.
- Link a skill to related prompts, references and projects.

**To be settled:** how far skills are managed in the MVP: store content only, store and export files, or full management of editing, versions and file export.

### FR-08. Collections and links between resources

The proposal is to allow grouping several resources into a collection.

For example, a `SaaS Dashboard` collection could contain:

- Reference websites.
- UI component libraries.
- A prompt for building a dashboard.
- A skill for implementing the interface.
- Related SVGs, images and animations.

Besides collections, resources can be linked to each other directly. This helps build a meaningful set of context for each task instead of finding each resource independently.

**To be settled:** whether collections are in the MVP or left for a later phase.

### FR-09. Claude Code integration

The agreed direction is **hybrid: start with copy/export, then extend to MCP**.

#### Early phase — Copy & Export

- Select several resources.
- Copy the combined context to the clipboard.
- Export Markdown describing the source, notes, tags and how to use it.
- Export the selected assets to a destination folder.
- Put prompts and skills into a reusable format.

Example export structure:

```text
ui-reference-bundle/
├── context.md
├── prompts/
│   └── dashboard-brief.md
├── skills/
│   └── frontend-implementation/
│       └── SKILL.md
└── assets/
    ├── dashboard-reference.webp
    ├── brand-icon.svg
    └── loading-animation.json
```

`context.md` should contain the source URL, description, personal notes, tags, the UI patterns to refer to, and relative paths to the exported assets.

The app should not export only internal file paths if Claude Code cannot access them. When a file is needed, it should be exported or copied to a controlled destination folder.

#### Later phase — MCP

- Let AI query the library.
- Find resources by keyword or suitable criteria.
- Read the metadata and content of resources it is allowed to access.
- Return the context and the paths to related assets.

MCP is a direction for extension, not a mandatory requirement of the MVP.

### FR-10. Backup and restore

Proposed direction: **back up and restore the whole library**.

The backup package should include:

- Metadata and resource data.
- Tags and classifications.
- Prompt and skill content and notes.
- Collections and the links between resources.
- Asset files managed by the app.
- The information needed to restore the relationship between metadata and files.

Features:

- Export a backup package.
- Import a backup package to restore.
- Check the structure and validity of the data before importing.
- Report an error when a file is missing or corrupted.

Git can be considered later for prompts, skills and text-based content. By default, all images and videos should not go into Git, because the repository could grow quickly.

A backup on the same disk does not protect the data if the disk fails. For better protection, the user should copy the backup package to another storage location.

## 4. UI/UX requirements (UI/UX Requirements)

Proposed interface areas:

- **Sidebar:** Library, UI/UX References, Prompts, Skills, Collections, Projects, Settings.
- **Search bar:** search, and filter by resource type, tag, style and technology.
- **Resource cards:** thumbnail, name, type, tags and source.
- **Prompt/Skill cards:** name, purpose, technology and the copy action.
- **Resource detail:** metadata, content, file preview, notes, links, Copy and Export.

UI/UX principles:

- Easy to scan and to find resources again through images and metadata.
- Support both image-based resources and text content.
- Frequent actions such as Copy, Edit and Export are easy to find.
- Filters can be combined.
- Empty, loading and error states, and delete confirmation.
- Desktop first; responsive support can be extended as needed.

## 5. Architecture and technology

This is an **implementation proposal**, not a set of confirmed mandatory technology requirements.

### 5.1. Architecture

```text
React + TypeScript + Vite
            |
            v
Node.js + TypeScript + Fastify
            |
      +-----+------+
      |            |
      v            v
   SQLite      Filesystem
 (metadata)   (assets, exports)
```

### 5.2. Proposed supporting technology

| Component                | Technology                     |
| ------------------------ | ------------------------------ |
| Frontend                 | React + TypeScript + Vite      |
| Local API                | Node.js + TypeScript + Fastify |
| Database                 | SQLite                         |
| ORM                      | Drizzle ORM                    |
| Validation               | Zod                            |
| Unit/integration testing | Vitest                         |
| End-to-end testing       | Playwright                     |

### 5.3. Storage

Planned folder structure:

```text
data/
├── library.db
├── assets/
│   ├── images/
│   ├── videos/
│   ├── icons/
│   └── animations/
├── thumbnails/
├── exports/
└── backups/
```

- SQLite stores metadata and the relationships between resources.
- The filesystem stores the actual file content.
- The database stores a file path or identifier, and does not necessarily embed whole files in the database.
- Files and metadata must be managed consistently when renaming, deleting or restoring.

### 5.4. Local-first requirements

- The app runs on `localhost`.
- The primary data lives on the user's machine.
- No cloud account login is required.
- Resources already stored locally can still be viewed without Internet, within the limits of the data already downloaded.
- Fetching metadata, opening the source website or downloading resources from the Internet may still need a network connection.
- The backend must control file paths, access permissions and file write operations.

## 6. Non-functional requirements (Non-functional Requirements)

| Code   | Requirement                                                                            |
| ------ | -------------------------------------------------------------------------------------- |
| NFR-01 | Data persists after the app is closed and restarted.                                   |
| NFR-02 | Search and filtering work well on a library with many resources.                       |
| NFR-03 | Metadata and assets do not lose their link when edited.                                |
| NFR-04 | Backup and restore preserve the content and the relationships.                         |
| NFR-05 | Errors when fetching a URL or processing a file do not corrupt existing data.          |
| NFR-06 | Access to the local API is allowed only under the defined security policy.             |
| NFR-07 | Input URLs are checked to reduce the SSRF risk when the backend accesses websites.     |
| NFR-08 | File size is limited, formats are validated, and invalid files are handled.            |
| NFR-09 | New resource types and features can be added without redesigning the whole data model. |
| NFR-10 | Tests cover the important flows for save, edit, delete, search, export and restore.    |

## 7. Scope by phase

### MVP — First version

Goal: a local library that can be used every day.

- [ ] Local app and durable storage.
- [ ] Resource CRUD and metadata.
- [ ] Add a website from a URL, fetching metadata automatically when possible.
- [ ] Upload, preview and manage assets.
- [ ] Keyword search, tags and multiple filters.
- [ ] Resource detail page.
- [ ] Prompt and skill management at the level that is settled.
- [ ] Copy context, export Markdown and assets.
- [ ] Back up and restore the whole library.

### P1 — Experience improvements

- [ ] Collections and links between resources.
- [ ] Duplicate resource detection.
- [ ] Bulk actions.
- [ ] Better metadata fetching.
- [ ] Prompt/skill version management if needed.

### P2 — AI workflow expansion

- [ ] MCP server so Claude Code can access the library.
- [ ] Automatic tag and classification suggestions by AI.
- [ ] Semantic or image-based search.
- [ ] Browser extension to save resources quickly.
- [ ] Automatically collect many resources from chosen sources.
- [ ] Git integration for text content if suitable.

## 8. Acceptance Criteria — MVP acceptance criteria

- [ ] The user can add a URL and save a resource.
- [ ] Metadata is fetched automatically when possible; if that fails, manual entry still works.
- [ ] The user can upload, preview and save an asset.
- [ ] Data is not lost after the app restarts.
- [ ] Keyword search and combined filters return suitable results.
- [ ] Metadata can be edited without losing the link to the asset.
- [ ] Prompts or skills can be managed, found and copied.
- [ ] Several resources can be selected and turned into context for Claude Code.
- [ ] The Markdown export contains the necessary information and valid asset paths.
- [ ] Assets are exported correctly into the permitted destination folder.
- [ ] Backup and restore preserve the data, files and relationships.
- [ ] URL, upload or restore errors are handled clearly, without silently losing data.

## 9. Decisions still to be settled

The items below should not yet be treated as confirmed requirements:

1. **MVP content groups:** should Coding Rules, Checklists/SOPs and MCP Configurations be in the first version?
2. **Level of Skills management:** store content only; store and export files/folders; or edit, version and export files/folders?
3. **Backup strategy:** not needed yet; export/import the whole library; Git for text content; or a full backup combined with Git?
4. **Collections:** in the MVP or left for a later phase?
5. **Asset storage:** URLs only; local files only; or a mix of URLs and local files?

## 10. Summary of direction

The project is directed to be a **personal UI/UX library and frontend knowledge base that runs locally, with AI integration added gradually**.

The three most important layers of functionality:

1. **Collect:** gather and save websites, assets, prompts, skills and related resources.
2. **Organize & Retrieve:** manage metadata, classification, search, filtering and links between resources.
3. **Reuse with AI:** copy context, export Markdown and assets for Claude Code first; integrate MCP later.

The most important design point is not to turn the app into one big bookmark folder. Each resource needs structured metadata, content suited to its type, and the ability to link to other resources. Only then does the library really help reuse knowledge during frontend development.
