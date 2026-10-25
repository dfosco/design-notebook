# Canvas rendering adapter

`materializeCanvas(jsonl, options)` in [`src/canvas-renderer/index.js`](../../src/canvas-renderer/index.js) consumes the result of the canonical JSONL replay implementation. It returns `{ status, canvasId, replay, scene, diagnostics }`. The `scene` is a private, in-memory adapter for `renderScene`; it is not a JSONL schema, a public rendering wire format, or a persistent authoring model.

```js
const result = materializeCanvas(canvasJsonl, {
  mode: 'local', // or 'static'
  artifacts: discovery.artifacts,
  resolveArtifact(reference, { kind, placement, artifacts, mode }) {
    // Return resolved URLs supplied by the host, or null when unavailable.
  },
  resolveAsset(path, { purpose, artifact, view, placement, mode }) {
    // Resolve with the host-selected base; return an absolute HTTP(S) URL or null.
  },
})
renderScene(container, result.scene)
```

The adapter never starts a prototype runtime or imports `@dfosco/statefully`. Prototype artifact URL resolution belongs to the core/host; the renderer only puts the resolved HTTP(S) entry URL in a frame. Resolution retains discovery's stable IDs and uses its authored `descriptor`, `entry`, `local`, `published`, and `views` fields. The adapter does not infer a route from a machine path. Canvas asset paths are resolved only through `resolveAsset` or an explicit `assetBaseUrl` supplied by the caller. The host must choose the canvas asset base. Site screenshots use the artifact-folder base context supplied to `resolveAsset`.

## Rendering policy

- Text-like widgets (`text`, `sticky-note`, `note`) render text content without HTML parsing. `image` uses an explicitly resolved URL. Unknown widget kinds use the optional [`props.fallback` convention](./canvas-jsonl.md#the-first-look-tiny-canvas-viewer-recognizes-an-optional-text-fallback-for-an-otherwise-unknown-widget-type) when its value is `{type:'text', text:string}`; it is displayed literally and labeled as an unsupported-widget fallback. Missing, malformed, or unsupported shapes remain unavailable with a diagnostic.
- Placement IDs are passed through as `data-item-id`. Finite geometry and negative coordinates remain unchanged. Missing dimensions default to 320×180; missing positions default to (0, 0). Invalid dimensions produce a warning and a visible default-sized placement.
- Replay diagnostics, partial/invalid status, unsupported header sources/connectors, and unavailable references are returned in `diagnostics` and shown as notices by `renderScene`. Valid prefix widgets remain available on partial replay.
- Prototype frames allow scripts, forms, and pop-ups. Same-origin URLs additionally use `allow-same-origin`, so notebook-owned prototype modules and origin storage work. That makes notebook-owned prototype code trusted same-origin content, not an isolation boundary. Cross-origin frames retain an opaque sandbox origin.
- A site renders a selected view screenshot and a normal link, not an iframe. A widget's `viewId` selects exactly one authored view; an unknown ID never falls back to another view. An omitted view defaults to the artifact root route `/`. An authored `view.path` resolves against the local development base in local mode or published base in static mode; its path, query, and fragment are preserved without allowing a change of origin. Static mode rejects localhost/subdomains, `.local`, loopback IPv4/IPv6, and unspecified-address destinations. It never selects a local URL. An artifact with `available:false`, missing view, screenshot, or destination remains visibly unavailable and diagnostic.
- Rendering and unmounting operate on the in-memory scene. They do not mutate replayed records or persist layout.

## Provenance and dependency inventory

The reused, vendored source basis is `@dfosco/tiny-canvas` 5.5.0, reviewed at source commit `7b933d3a0b99234b2f9b650547dd0e82d0d019f6`, under MIT. The retained license is [`LICENSES/tiny-canvas-MIT.txt`](../../LICENSES/tiny-canvas-MIT.txt); source selection and exclusions are documented in [`canvas-renderer-provenance.md`](../research/canvas-renderer-provenance.md). This integration reuses the existing DOM-native adapter files and adds a `site` screenshot/link view; no package source is imported at runtime.

| File | Role | Dependency/license |
| --- | --- | --- |
| `src/canvas-format/index.js` | Accepted JSONL parsing and replay API | Repository source; no runtime package dependency |
| `src/canvas-renderer/index.js` | Replay-to-scene materializer and resolver seam | Repository source; browser URL API only |
| `src/vendor/tiny-canvas/index.js` | DOM renderer for text, image, frame, site and fallback views | Adapted from Tiny Canvas; provenance MIT license retained |
| `src/vendor/tiny-canvas/style.css` | Renderer presentation | Adapted local CSS; same provenance record |

The runtime dependency closure is zero npm packages. In particular, this renderer does not import React, private application packages, or `@dfosco/statefully`. The existing `@dfosco/statefully@0.2.1` descriptor value identifies the core-owned prototype runtime contract; runtime bundling/serving remains owned by the host. The host also owns loading this adapter module and stylesheet in its local and static clients.

## Verification boundary

The focused Node tests consume the canonical JSONL fixture and inspect materialized IDs, geometry, resolved references, static site URLs, partial replay, unsupported features, and fallbacks. Vendor behavior tests cover rendering, trusted same-origin frames, cross-origin sandbox flags, and non-persistent unmount. The optional `tests/canvas-renderer/browser-proof.mjs` harness exercises both local/static scenes and a same-origin ES module prototype; it is not part of the default Node suite and requires externally available Playwright and Chrome. Set `PLAYWRIGHT_MODULE` (and optionally `CHROME_EXECUTABLE`) to their module and executable paths when running it. This is adapter evidence, not full notebook-shell, package publication, or static-site build integration.
