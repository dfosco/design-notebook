# Notebook client shell

`design-notebook/shell` exports the package-owned `NotebookShell`. It receives a discovery graph and host callbacks. It does not read the notebook filesystem, start services, or write notebook files.

```jsx
import { NotebookShell } from 'design-notebook/shell'

<NotebookShell
  graph={graph}
  mode="local"
  baseUrl={window.location.href}
  routeBase={routeBase}
  resolveArtifact={runtime.resolveArtifact}
  resolveAsset={runtime.resolveAsset}
  loadCanvas={loadCanvas}
  loadDocument={loadDocument}
  customCssUrl={customCssUrl}
/>
```

## Host data contract

The `graph` has the discovery shape: `entries` preserves the mixed ordinary directory tree, `artifacts` contains flat artifact records, and `diagnostics` contains graph issues. Keep those objects from the same snapshot. The shell uses artifact IDs as navigation identity; paths are current locations only. It renders the supplied tree as-is, so grouping directories are ordinary folders and artifact internals do not become navigation entries.

`mode` is `local` or `static`. `baseUrl` is the absolute current notebook page URL. `routeBase` is the explicit mount path for public artifact routes, such as `/preview/branch/`; it defaults to `/` and is separate from `baseUrl`. Runtime and static hosts must pass the same configured deployment base they use to serve files. Resolver results can be absolute local URLs or portable root-relative static URLs; the shell resolves them against `baseUrl` at render time and accepts HTTP(S) only. It does not place a workstation origin in static output. Asset requests include an explicit notebook-root-relative `basePath`: the canvas folder for Canvas images, the Site folder for Site screenshots, and the containing folder for Doc embeds.

Pass a graph-fetch failure through the optional `error` prop. The shell renders it as an alert while keeping navigation and graph diagnostics available when supplied.

Discovery intentionally returns metadata, not the full Canvas JSONL or Doc MDX body. Hosts provide payload loaders:

- `loadCanvas(artifact)` returns the Canvas JSONL source string. Resolve the artifact's `payloadPath` in the local host; a static host supplies its packaged source.
- `loadDocument(artifact)` returns a compiled MDX module result such as `{ Content, diagnostics }`. `Content` is the React component exported by the host's compiled MDX module. Local compilation and static module assembly are host responsibilities.

The same props work for live and static graphs. The live host subscribes to runtime refreshes and passes a new graph object; the shell preserves the selected stable ID while replacing its metadata. When an artifact or loader is replaced, the old payload is hidden while the new one loads, and a late response from a prior selection is discarded. A static host passes the packaged graph and loaders. Client code has no Node or filesystem imports.

## Navigation and views

The shell and hosts share the browser-safe route helper at `design-notebook/runtime/notebook-routes`. Public destinations use stable artifact IDs: Canvas `/canvas/<id>`, Doc `/docs/<id>`, Site `/sites/<id>`, and Prototype `/<id>`. The explicit `routeBase` prefixes each path, so a notebook published under `/preview/branch/` links to `/preview/branch/canvas/<id>` and the other routes follow the same rule. Folder moves do not change these URLs.

Prototype named views use their authored `view.path` beneath `/<prototype-id>`, preserving its query and fragment. Site named views keep `/sites/<id>` and use `?view=<exact-view-id>`. The `view` parameter selects a view; it does not select an artifact. Empty or unknown view IDs remain invalid and diagnostic. The shell reads old root `?artifact=<id>&view=<id>` URLs for compatibility and replaces a valid one with its canonical path. It never generates `?artifact=` links. Internal runnable prototype URLs remain separate from public review routes.

Direct route requests, reload, back, and forward parse through the shared helper. Modified artifact-link clicks retain native browser behavior. A route that is missing, ambiguous, malformed, or unavailable stays visible with route or artifact diagnostics; it is not redirected to another artifact. Only the notebook root chooses the first navigation entry by default.

Prototype and Site views expose their authored view IDs. An explicit missing view is preserved and shown as unavailable; it is never replaced with another view. Prototype URLs come from the runtime resolver and open in a sandboxed iframe. Site views use the shared `SiteView` component. Documents use the accepted MDX `Document` components.

Canvas JSONL is materialized by the shared canvas adapter and drawn by the vendored Tiny Canvas closure. The viewing controls provide pan, zoom, and Fit. Local move and resize operations call the host's `saveCanvasGeometry` callback with the loaded source revision. The runtime appends the corresponding public JSONL event and returns the authoritative geometry; rejected or stale saves are surfaced and the preview rolls back. Static mode has no write service, so it identifies those edits as unsaved and does not claim persistence. Invalid and partial replay diagnostics remain visible.

Fit uses the union of authored scene dimensions and valid placement rectangles, including placements with negative coordinates or extents beyond the nominal scene edge. The shell reveals those placed rectangles inside its clipped viewport without changing their authored coordinates or the source JSONL. Pan begins on the canvas background; links, frames, disclosure summaries, and form controls keep their normal interaction. Modified artifact-link clicks retain native browser behavior.

## CSS customization

The built-in Design Notebook stylesheet sets a small token surface on `:root`:

| Variable | Purpose |
| --- | --- |
| `--dn-shell-sidebar-width` | Navigation column width |
| `--dn-shell-surface` | Sidebar and panel background |
| `--dn-shell-page` | Page background |
| `--dn-shell-text` | Primary text |
| `--dn-shell-muted` | Secondary text |
| `--dn-shell-border` | Panel and control borders |
| `--dn-shell-accent` | Navigation and control focus |
| `--dn-shell-warning` | Unavailable and diagnostic text |
| `--dn-shell-radius` | Panel corner radius |

The shell chrome itself uses the vendored Hypercanvas Sidebar, Button, Breadcrumb, Sheet, and supporting component source. Its upstream generated Tailwind palette and utility closure use the isolated `ds-*` utility namespace. `src/vendor/hypercanvas/PROVENANCE.md` records the source commit, source hashes, license, namespace adaptation, and notebook host adapter boundary. Design Notebook keeps its own identity and supplies its discovered tree and canonical route callbacks.

The host can pass `customCssUrl` for a notebook stylesheet. Resolve the authored stylesheet through the host asset resolver in both modes, then pass its returned URL. The shell normalizes that URL against `baseUrl`; no application source needs to be copied into a notebook. A host may also import an app-level override after the package stylesheet.

```css
:root {
  --dn-shell-sidebar-width: 19rem;
  --dn-shell-accent: #7c3aed;
  --dn-shell-radius: 0.25rem;
}
```
