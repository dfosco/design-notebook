# Design Notebook artifact format, first look

This document defines the portable filesystem contract implemented by the first-look core. Paths in discovery results use `/` separators and are relative to the notebook root. Artifact IDs identify content independently of its filename or directory; moving or renaming an artifact preserves its ID and references. IDs are unique across artifact types in one notebook. A path is a location, never a stable reference.

## Notebook folders and boundaries

The notebook root is the content root. Every ordinary directory below it is a grouping directory. Groups can nest to any depth and can contain a mix of artifact types. `prototypes/`, `canvases/`, and `sites/` are optional examples of ordinary group names. Discovery does not give them special meaning.

The following suffixes mark artifact directory boundaries:

| Kind | Directory | Required content |
| --- | --- | --- |
| Prototype | `name.prototype/` | `name.prototype.json` and prototype source |
| Canvas | `name.canvas/` | `name.canvas.jsonl` |
| Site | `name.site/` | `name.site.json`; the descriptor alone is a complete Site artifact |
| Doc | `name.doc.mdx` or `name.doc/name.doc.mdx` | MDX file with YAML identity frontmatter |

An artifact directory cannot contain another artifact directory or Doc, even through ordinary intermediate folders. The scanner reports the nested artifact path and its containing artifact path. A nested artifact is not registered. Discovery never moves files or repairs the tree. Ordinary groups outside artifacts remain navigable groups; the contents of a valid artifact are not exposed as notebook groups.

The first-look infrastructure exclusions are directory names `.git`, `.design-notebook`, `.vite`, `.cache`, `.next`, `.turbo`, `node_modules`, `dist`, `build`, `out`, `coverage`, and `storybook-static`. They cover repository metadata, this format's reserved metadata, dependency stores, and common generated output. Symlinked directories are not followed. Other names are ordinary content; no assumption is made about underscore prefixes or legacy application-specific directories.

## Identity and references

Every artifact descriptor supplies `formatVersion: 1`, an authored `id`, and a non-empty `title`. IDs match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Missing, invalid, or duplicate IDs make affected artifacts unavailable and produce diagnostics. Discovery does not synthesize IDs from paths because that would change identity after a move.

Cross-artifact references use stable IDs. `references` arrays are optional on JSON descriptors and Doc frontmatter. Discovery resolves a reference only when exactly one discovered artifact has that ID; missing and duplicate IDs produce diagnostics and leave that reference unresolved. Artifact paths in the resolved result are current locations, while the reference remains the ID. A Doc's identity and title are in its frontmatter. IDs are not derived from Doc filenames. This keeps references stable when an artifact is renamed or moved.

Prototype and Site descriptor paths are relative to their artifact directory. Prototype `entry` is inside that directory. Site `local.sourcePath`, when relative, is relative to the notebook root and may point outside it, for example `../my-app`; an absolute machine-local path is also allowed and non-portable. Both forms are local-only and are never copied as published assets. Site `local.developmentUrl` and view `localUrl` are local-only references. Portable assets such as view screenshots must resolve inside the notebook root. Site `published.url` and a view's `publishedUrl` are absolute HTTP(S) destinations and remain the publication target. A local reference never silently becomes a published one.

Canvas data remains the single `name.canvas/name.canvas.jsonl` file. It has no sibling JSON descriptor. Canvas record identity is defined jointly with the Canvas JSONL record contract; consumers must retain the `canvas` kind, the containing directory path, and the JSONL payload path in discovery results.

## Prototype descriptor

`name.prototype.json` is JSON and follows [`prototype.schema.json`](../../schemas/artifacts/prototype.schema.json). The first-look runtime requirement is `{ "id": "@dfosco/statefully", "version": "0.2.1" }`. The ID names the public runtime package, and the exact version pins the capability the core bundles for both local development and static builds. It does not expose a client module or allow arbitrary runtime selection. Statefully's Vite plugin and React bindings are implementation APIs for the core adapter; notebook descriptors do not name those entry points.

```json
{
  "formatVersion": 1,
  "id": "onboarding",
  "title": "Onboarding",
  "runtime": { "id": "@dfosco/statefully", "version": "0.2.1" },
  "entry": "src/index.html",
  "views": [{ "id": "default", "title": "Default", "path": "/" }],
  "references": ["review-canvas"]
}
```

## Site descriptor

`name.site.json` follows [`site.schema.json`](../../schemas/artifacts/site.schema.json). A Site can have local references, published references, or both. A folder containing only this descriptor is valid.

```json
{
  "formatVersion": 1,
  "id": "product-site",
  "title": "Product site",
  "local": { "sourcePath": "product-web", "developmentUrl": "http://localhost:3000" },
  "published": { "url": "https://example.com" },
  "views": [{ "id": "home", "title": "Home", "path": "/", "publishedUrl": "https://example.com/" }]
}
```

The machine-local source path and local URL are not publication destinations. Published mode uses only the explicitly published URL (and portable view representations such as screenshots); it does not infer a public address from a local path or localhost URL.

## Canvas file

Canvas content is the JSONL payload itself. Discovery does not require a second `.canvas.json` file. Its first non-empty record is the existing event envelope `{ "event": "canvas_created", "formatVersion": 1, "canvasId": "..." }`; no parallel `kind` or `schemaVersion` fields are introduced. `canvasId` is the stable artifact ID, not a path-derived value. The enclosing `.canvas` directory name and matching JSONL basename can change without changing `canvasId`. The Canvas JSONL contract owns record framing, replay, malformed-line behavior, and unknown event handling.

The JSON descriptors and Doc frontmatter use `formatVersion: 1` for their artifact metadata. The Canvas JSONL header uses the same public version value but validates the stream format for the existing event envelope. This preserves the shared JSONL reader contract while keeping the version field name consistent.

## Doc file and enclosing folder

A Doc is a `.doc.mdx` file with YAML identity frontmatter. It can live directly at the notebook root or in an ordinary grouping directory. A Doc may also use a matching wrapper: `name.doc/name.doc.mdx`. Discovery promotes that wrapper to one Doc entry in its parent group; it does not expose `name.doc` as an extra sidebar group. The wrapper must contain the matching filename. A suffix-only directory stays an ordinary visible group and reports a missing or mismatched payload diagnostic. The wrapper does not add a JSON descriptor format. The file's YAML 1.2 frontmatter carries `formatVersion`, stable `id`, and `title`; nested extension metadata is preserved and duplicate keys are errors. Discovery parses YAML and validates the required identity fields against [`doc-frontmatter.schema.json`](../../schemas/artifacts/doc-frontmatter.schema.json). Frontmatter identity is not duplicated in the filename. MDX imports and relative assets are resolved from the directory containing that Doc file, which is the wrapper directory for a wrapped Doc. Moving the Doc changes the base for those relative paths, so a move that changes its directory must update relative imports/assets while keeping the ID unchanged.

```mdx
---
formatVersion: 1
id: onboarding-rationale
title: Onboarding rationale
---

# Why this flow exists
```

Discovery reports each artifact's stable ID, kind, title, container/folder path, source/descriptor path, payload path, availability, diagnostics, and the complete parsed descriptor including unknown extension fields and named views or states. The tree and flat artifact list expose the same public artifact object. Group tree entries preserve the ordinary directory hierarchy. Typed directory names do not become parent groups, and their names are not artifact identities. Directory read errors are diagnostics so an unreadable group cannot be mistaken for a verified empty group.
