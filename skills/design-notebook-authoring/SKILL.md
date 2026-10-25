---
name: design-notebook-authoring
description: Edit a Design Notebook by changing its files directly. Use when asked to add or update prototypes, canvases, documents, Sites, references, or notebook grouping.
---

# Design Notebook direct-file authoring

Use this skill when asked to make a change to a Design Notebook. The notebook's files are the source of truth. Edit prototype source, descriptors, document text and canvas JSONL directly. A geometry-only local move/resize save flow is under integration and is not yet verified in this source candidate. The agreed local path appends existing JSONL geometry events through the server; it does not use browser storage. Until verified, edit placement geometry in JSONL directly. Static output has no writable service. Do not invent a general notebook mutation API or canvas editing CLI.

## Before editing

1. Identify the notebook root and inspect its ordinary folder tree. Folders named `prototypes/`, `canvases/`, `sites/`, `research/` or `notes/` have no special discovery behavior. Work from the actual paths present in the notebook.
2. Run read-only artifact discovery when available. Review diagnostics before editing so existing missing references, duplicate IDs, unavailable artifacts and partial canvases are not attributed to your changes.
3. Read the matching descriptor and format documentation. Use authored artifact IDs and view IDs. Never derive an ID from a path or silently change an existing ID when moving a file.
4. Keep each artifact boundary intact. A typed `.prototype/`, `.canvas/` or `.site/` directory cannot contain another artifact. A `.doc.mdx` document is one file and does not own its enclosing group.
5. Leave repository metadata, dependencies and generated output outside notebook content. The first-look scanner excludes `.git`, `.design-notebook`, `.vite`, `.cache`, `.next`, `.turbo`, `node_modules`, `dist`, `build`, `out`, `coverage` and `storybook-static`.

## Make the requested change

- **Prototype:** edit the source inside its `.prototype/` folder. Keep the descriptor's stable ID, selected runtime and entry path valid. The first-look prototype runtime is `@dfosco/statefully@0.2.1`; the core supplies it. State data belongs under the `state/` data folder. Use lowercase flow names, for example `state/request.flow.json`, and match the name with a descriptor view ID `request` and path `/request`. When a task asks for comparison, place the same prototype ID more than once with different exact `viewId` values. Keep the provider connected to the core's live route binding so local and static paths select the matching flow. Do not invent a route adapter, duplicate the prototype to represent a second state, or select another runtime unless the task explicitly changes the format/core contract.
- **Document:** edit the requested `.doc.mdx` file. Preserve its `formatVersion`, `id` and `title` frontmatter. Keep references as artifact IDs.
- **Site:** represent an existing application with a `.site/` descriptor. Keep local source paths and development URLs separate from published URLs. Local values only work in the author's environment. Static review uses the authored published destination and portable screenshot; it does not build the external application.
- **Canvas:** preserve the first `canvas_created` event, its `canvasId`, all existing history and unknown records. Append complete, newline-terminated events. Use the established `widget_added`, `widget_moved`, `widget_updated` and `widget_removed` shapes. Do not append a second header or rewrite history to make the result look compact. Keep placement IDs unique and stable. A Site placement must identify both `artifactId` and an exact `viewId` from the Site descriptor.

For an unknown widget type, the only supported optional fallback is literal text in `props.fallback`:

```json
{"type":"text","text":"This view is not available in the current viewer."}
```

The viewer labels this as an unsupported-widget fallback and retains the placement's ID and geometry. It does not interpret markup or run code. Missing, malformed or other fallback shapes remain unavailable with a diagnostic.

For document embeds, use the public components from `design-notebook/docs` with stable IDs and exact view IDs:

```mdx
import { Prototype, Site } from 'design-notebook/docs'

<Prototype artifactId="borrow-flow" viewId="request" />
<Prototype artifactId="borrow-flow" viewId="confirmation" />
<Site artifactId="existing-catalog" viewId="catalog-home" />
```

The blocks are vertical and full width. A missing artifact or view should remain visible as unavailable with its actionable diagnostic; never switch to a different view.

### Example exercise

For a request to compare a Site with an existing canvas and adjust its layout:

1. Inspect the Site descriptor and choose one of its exact authored `views[].id` values.
2. Append a `widget_added` event with `type: "site"`, `props.artifactId` set to that Site's ID, and `props.viewId` set to the selected view ID. Keep local and published routes in the Site descriptor, not in a path-derived artifact reference.
3. Append `widget_moved` or `widget_updated` records for the canvas placement the user asked to change. A `widget_updated` record shallow-merges `props`; include only the fields being changed.
4. Re-read the resulting JSONL and check that every appended line is complete JSON, the header is unchanged, and no placement ID was reused.

Example event shapes:

```jsonl
{"event":"widget_added","widget":{"id":"catalog-view","type":"site","position":{"x":440,"y":32},"props":{"artifactId":"existing-catalog","viewId":"catalog-home","width":420,"height":300}}}
{"event":"widget_moved","widgetId":"review-note","position":{"x":48,"y":380}}
{"event":"widget_updated","widgetId":"review-note","props":{"width":340,"height":140}}
```

## Validate and report

From the Design Notebook source checkout, use the public read-only discovery API to inspect the example or affected notebook before and after editing:

```sh
node --input-type=module -e 'import { discoverNotebook } from "design-notebook"; const result = discoverNotebook("examples/first-look/notebook"); console.log(JSON.stringify(result.diagnostics, null, 2)); if (result.diagnostics.some(item => item.severity === "error")) process.exitCode = 1'
```

For another notebook, replace the argument with its root. Discovery reports descriptor, identity, path, reference and replay diagnostics. Compare the result with the pre-edit diagnostics, then inspect each changed JSON, MDX and JSONL file directly. Report changed paths, IDs and validation output. A warning or unavailable/partial artifact must not be described as fully rendered.

For the included example, start the local client from its isolated working copy:

```sh
cd example-notebook
npm run dev
```

Open the printed URL and review the affected prototype, canvas, document and Site views. The local geometry-save path remains unverified; until it passes integration checks, change placements directly in JSONL. Static output is read-only. Build it from the same example folder and serve its output:

```sh
cd example-notebook
npm run build -- --out-dir /tmp/notebook-review --base /
cd /tmp/notebook-review
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`, navigate between the affected artifacts, select exact view IDs and directly open and refresh their canonical paths: `/canvas/<id>`, `/docs/<id>`, `/sites/<id>?view=<view-id>`, or `/<prototype-id>/<authored-view-path>`. This is a local preview of generated static files; the build does not deploy or upload them. For the deployment recipe and hosting-prefix requirements, read [Static publishing](../../docs/format/publishing.md).

## Write safety

Use one writer per file at a time. The format does not provide file locks, transactions across artifacts, conflict resolution for overlapping writes, or automatic recovery. If a write is interrupted, stop and inspect the source before appending more. Do not repair unrelated malformed or unknown data without being asked; preserve it and report the limitation.
