# Design Notebook

Design Notebook is an open notebook for product design. It brings working prototypes, canvases, documents and existing websites together in a portable folder.

Keep a design, the product it responds to, and the reasoning behind it in one place. Compare views side by side on a canvas, then explain the decisions in a document.

## The notebook is the work

- **On your computer, it is a folder.** Your prototype code, documents, canvas layouts and assets are files you can edit with your usual tools.
- **When published, it is a website.** Reviewers can explore the notebook in a browser without installing Design Notebook.

Your work stays separate from the application used to open it. You can organize it, version it and share it as files.

## Getting started

From a checkout of this repository:

```sh
npm install
npm run example:init
cd example-notebook
npm run dev
```

Open the URL printed in your terminal. The example includes a prototype, canvas, document and Site to explore.

If `example-notebook/` already exists, skip `example:init`; it will not overwrite your work. Running `npm run dev` from the repository root opens the same notebook. The `examples/` directory holds the starter template, while **`example-notebook/` is your working copy**.

See the [getting started guide](docs/getting-started.md) for the full walkthrough, the [authoring guide](docs/authoring.md) for making changes, and the [publishing guide](docs/format/publishing.md) for building a shareable website. Building and deploying are separate steps.

## Four kinds of design material

### Prototypes

Small websites or applications whose code lives in the notebook. A prototype can have named views, such as a request form and its confirmation screen, so a review can point to a particular state.

Prototypes are built and published with the notebook. The included Statefully runtime supports this workflow; applications that need their own backend can be referenced as Sites.

### Sites

Existing websites or applications that live elsewhere. A Site records links, views and screenshots without copying the application into your notebook.

You can preview a live Site locally when it is available and allows embedding. Published notebooks show screenshots and links, so reviewers do not need access to your development server. Publishing the notebook does not deploy the Site.

### Canvases

Spatial layouts that bring views, images, text and notes together. Place two prototype states next to an existing Site and a review note to compare them.

The same item can appear several times without duplicating its source. Removing it from a canvas does not delete the original.

### Documents

Markdown-based pages for explanations, research and decisions. Documents use MDX, which lets you add interactive content such as prototype views and Site screenshots alongside the text.

Use a document for a guided reading experience and a canvas for spatial comparison.

## Work with files and agents

Edit code, documents and notebook files with your editor or coding agent. Design Notebook watches for changes and updates the viewer.

Moving or resizing items on a local canvas also saves to its source file. In a published notebook, layout changes are temporary.

Organize your work in nested folders, mixing prototypes, canvases, Sites and documents as needed. An item's supporting files can sit in its own folder without adding an extra folder row in the sidebar. Items keep their identity when you move them between folders.

## One product, three parts

| Part | What it does |
| --- | --- |
| **Format** | Defines how notebook files, items and references are saved. |
| **Core** | Watches files, checks them, and runs or builds the notebook's content. |
| **Client** | Provides the interface for browsing and working with that content. |

The core and client come together in the `design-notebook` package. You do not need to assemble them yourself. Keeping these parts separate also allows other interfaces and tools to work with the same open format.

## Sharing and unavailable content

A missing widget or unavailable website should not make the rest of a notebook unreadable. Where supported, text or screenshots provide a fallback; otherwise, the viewer explains what is unavailable.

Publishing creates a viewing copy, not a copy of every source file. It includes supported content and reports what it cannot publish. See the [publishing guide](docs/format/publishing.md) for details and limits.

## Further reading

- [Vision and Architecture](DESIGN-NOTEBOOK.md) — the broader direction and open questions
- [Artifact format](docs/format/artifacts.md) — files, folders and references
- [Canvas JSONL format](docs/format/canvas-jsonl.md) — how canvas layouts are saved
- [Canvas rendering contract](docs/format/canvas-rendering.md) — supported content and behavior
- [Authoring agent skill](skills/design-notebook-authoring/SKILL.md) — guidance for coding agents
