# Authoring notebooks

Authors and coding agents edit notebook files directly. The integrated client discovers and displays prototypes, canvases, documents and existing Sites for local review and static output. A geometry-only local save path for moving and resizing canvas placements is under integration and is not yet verified in this source candidate. The agreed path appends existing JSONL geometry events through the local server, not browser storage. Until integration verification passes, change placement geometry directly in the JSONL file. Static output has no writable local service. There is no general notebook mutation API or mutation CLI, or concurrent-writer coordination.

## Organize content

The notebook root is the content root. Any ordinary directory can group content, nest inside another group and contain a mix of artifacts. Names such as `prototypes/`, `canvases/`, `sites/`, `research/` and `notes/` are conventions for people; discovery treats all of them as ordinary folders.

Artifact suffixes mark boundaries: `name.prototype/`, `name.canvas/`, `name.site/`, and the single file `name.doc.mdx`. A typed artifact directory must not contain another artifact, even through intermediate ordinary folders. Discovery reports nested artifacts and does not repair or move files. Files and folders inside an artifact belong to that artifact; they are not separate notebook entries. Exclude repository metadata, dependency folders and generated output such as `.git`, `node_modules`, `dist`, `build`, `.next` and `.cache` from notebook content. See the [complete exclusion list](format/artifacts.md#notebook-folders-and-boundaries).

## Preserve identity and references

Every artifact has an authored stable ID in its descriptor or document frontmatter. Canvas identity is the `canvasId` in the existing `canvas_created` event. A file or folder can be renamed without changing its artifact ID. References use those IDs, not paths. Fix a duplicate ID or unresolved reference at its source instead of changing the reference to a path.

Prototype descriptors select the supported `@dfosco/statefully` version. The core owns that runtime and its local/static integration. A named Statefully flow uses a lowercase file such as `state/request.flow.json`; match it with a descriptor view whose ID is `request` and path is `/request`. A canvas can place the same `artifactId` more than once, using different exact `viewId` values to compare states side by side. Keep the provider connected to the core's live route binding so both local and static paths select the matching flow. Do not invent another route adapter or infer view IDs from labels. Changing the notebook client's UI framework does not change this prototype runtime.

A Site represents an existing external application. Its descriptor may include local-only source paths or development URLs and separately authored published destinations. The local fields are for the author's environment. They are not copied into static output. A Site view can include a portable screenshot and a published link. External deployment remains the Site owner's responsibility.

The client builds public review paths from stable artifact IDs, so renaming or moving an artifact folder does not change its URL. Canvas and document paths use `/canvas/<id>` and `/docs/<id>`. A Site uses `/sites/<id>`; an exact Site view is selected with `?view=<view-id>`. A prototype uses `/<id>` and authored named-view paths, such as `/<id>/request`. The path identifies the notebook review surface. The runnable prototype app remains at a separate internal path so the review page can embed it without recursion. New links do not use `?artifact=`.

## Change canvas content

Canvas data lives at `name.canvas/name.canvas.jsonl`. Preserve the initial event and append complete, newline-terminated JSON records in order. The reader applies the supported `widget_added`, `widget_moved`, `widget_updated` and `widget_removed` events. Do not rename the established event envelope or replace it with a different operation format. A placement's ID remains its identity across move and update records. Keep IDs unique and do not reuse one after removal.

Example: add a Site view and a note, then move and resize the note. `viewId` must exactly match a view in that Site descriptor.

```jsonl
{"event":"widget_added","widget":{"id":"catalog-view","type":"site","position":{"x":440,"y":32},"props":{"artifactId":"existing-catalog","viewId":"catalog-home","width":420,"height":300}}}
{"event":"widget_added","widget":{"id":"review-note","type":"sticky-note","position":{"x":32,"y":360},"props":{"text":"Compare the catalog's category labels with the new flow.","width":300,"height":120}}}
{"event":"widget_moved","widgetId":"review-note","position":{"x":48,"y":380}}
{"event":"widget_updated","widgetId":"review-note","props":{"width":340,"height":140}}
```

To remove a placement, append a `widget_removed` record with its ID. To change text or references, append `widget_updated`; it merges the supplied props and keeps other props. Do not edit prior records to simulate a mutation API. For an unknown widget type, the only supported optional text fallback is `props.fallback: {"type":"text","text":"..."}`. It is shown literally and labeled unsupported. Other fallback shapes remain unavailable with a diagnostic.

For a document embed, use the public components from `design-notebook/docs` with stable IDs and exact view IDs:

```mdx
import { Prototype, Site } from 'design-notebook/docs'

<Prototype artifactId="borrow-flow" viewId="request" />
<Prototype artifactId="borrow-flow" viewId="confirmation" />
<Site artifactId="existing-catalog" viewId="catalog-home" />
```

These embeds are vertical full-width blocks. An explicit `viewId` must match exactly. Missing artifacts or views produce an actionable diagnostic and a visible unavailable block. The integrated local client renders compiled documents alongside canvas and Site views. Static output includes compiled documents and their supported referenced images; see the [publishing guide](format/publishing.md) for resource and deployment behavior.

Edit one canvas file at a time. Append a full JSON object and newline together. If an edit is interrupted or replay reports a malformed or partial stream, inspect and repair the file before adding more records. The format has no locking, transaction, automatic repair or overlapping-write resolution.

## Validate and review

Run the read-only discovery check in the [getting started guide](getting-started.md) before and after edits. Resolve new errors and inspect warnings, especially duplicate IDs, unresolved references, unavailable views and partial canvas state. Preserve unknown optional records and fields you do not own. For the included example, use `cd example-notebook && npm run dev`. Geometry saving from the local client remains unverified; until it passes integration checks, edit placement geometry directly in JSONL. Static output is assembled with `npm run build -- --out-dir /tmp/notebook-review --base /` from `example-notebook` and served with a plain static server as described in the [getting started guide](getting-started.md). The build does not upload or deploy the output. Keep notebook source authoritative and compare its files directly after editing.
