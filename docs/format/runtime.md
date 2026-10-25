# Notebook runtime, routes, and builds

The first-look runtime is provided by this package. It uses Vite 7.3.7, React 19.2.3, and the exact prototype runtime declared by the artifact: `@dfosco/statefully@0.2.1`. A prototype descriptor with any other runtime ID or version is unavailable. Local preview and static build use the same pinned runtime and Statefully data index rules.

## Start and build

Run the lifecycle commands from the package checkout and pass the notebook content root:

```sh
npm run dev -- ./examples/first-look/notebook --port 5173
npm run build -- ./examples/first-look/notebook --out-dir dist --base /preview/branch/
```

`dev` starts one Node/Vite server at the notebook root and displays the package-owned shell at the configured base root (`/` by default). Canonical artifact URLs are pathname routes: prototypes use `/<stable-id>`, canvases `/canvas/<stable-id>`, documents `/docs/<stable-id>`, and Sites `/sites/<stable-id>`. Named prototype views use their authored `views[].path` beneath `/<stable-id>`; a selected Site view uses `?view=<authored-view-id>`. IDs are encoded as single path segments and route identity is stable across folder moves. The shell is exported from `design-notebook/shell`; application code is not copied into notebook content. It loads the read-only graph at `/__notebook/graph`, canvas JSONL by stable artifact ID, and compiled MDX modules from the host. The same graph and loader callback shape can be supplied by a static publisher. The server sends a `design-notebook:refresh` custom websocket event after filesystem changes. Its payload includes a monotonic `revision`, changed notebook-relative `file`, current artifacts, and diagnostics. The shell re-reads the graph and reloads the selected payload when the graph changes. The filesystem watcher only observes and refreshes content; local geometry persistence is a separate, narrowly scoped endpoint described below.

The browser-safe shared route API is exported from `design-notebook/runtime/notebook-routes`. `normalizeRouteBase(base)` canonicalizes the deployment prefix; `buildArtifactPath(artifact, { base, viewId })` creates canonical links, and `parseArtifactPath(location, { artifacts, base })` resolves them against the graph. Hosts pass the deployment prefix as the shell's `routeBase`; it is separate from `baseUrl`, which is used to normalize asset URLs. The parser accepts a single trailing slash on a canonical route because static directory hosts may redirect to that form. It does not normalize interior slashes or encoded traversal. Duplicate IDs, reserved prototype roots (`canvas`, `docs`, `sites`, and internal prefixes), malformed views, and path collisions are diagnostics. A prototype's first view at `/` is the implicit root alias and does not conflict with the base route; additional claims to the same path remain ambiguous. Legacy root `?artifact=<id>&view=<id>` links are read-only and return a canonical pathname. New shell links never emit `?artifact=`. Public prototype paths render the notebook shell; runnable prototype previews use separate `/__notebook/prototypes/<id>/...` endpoints to avoid recursively embedding the shell.

An optional `notebook.css` file at the notebook root customizes the package shell without copying its source. The host serves it at `/__notebook/notebook.css`; if it is absent, the probe returns `204` and no stylesheet link is added. Read failures remain HTTP errors and are surfaced by the shell. Changes are observed with the normal file refresh. Use the shell's documented CSS custom properties for supported theme adjustments.

`buildNotebook` emits each available Statefully prototype under `<out-dir>/prototypes/<encoded-artifact-id>/`. Its Vite base is `<base>/prototypes/<encoded-artifact-id>/`; `import.meta.env.BASE_URL` in a prototype therefore names that complete prototype prefix. It writes root and authored view route HTML files beneath each prototype output and keeps bundled assets below its `assets/` folder. Query and fragment portions of authored view paths remain in resolved links; generated HTML routes use only the pathname. Rebuilds clean only output files recorded by a matching `.design-notebook-output.json` manifest with unchanged SHA-256 hashes. Unmarked, modified, or extra files cause an output-collision diagnostic and are preserved. Output paths inside the notebook are limited to infrastructure output directories such as `dist`, `build`, and `out`; the notebook root and its ancestors are rejected. The CLI's `build` command runs `buildNotebook` once, then passes its graph and prototype results to `publishNotebook` to assemble the browser shell, sanitized graph, canvas and MDX payloads, and referenced assets in the same output directory. It exits non-zero when discovery, prototype builds, or static assembly report errors.

The package file list includes artifact discovery and schemas, canvas replay, the renderer adapter, shell, document and Site components, the static publisher, and the Tiny Canvas renderer assets. The publisher assembles files locally; it does not deploy output or start an external Site process.

The notebook chrome uses the vendored Hypercanvas Tailwind v4 pipeline with a `ds-*` utility namespace. During local development, the Vite host compiles utilities by scanning only package-owned files under `src/vendor/hypercanvas`; it does not scan notebook or prototype source. Installed and static builds use the packaged `generated/tailwind.css` artifact. Both paths namespace Tailwind variables and layers and omit global Preflight, so chrome styles do not reset prototype pages.

Changes to the vendored CSS pipeline are checked against the packaged `src/vendor/hypercanvas/generated/tailwind.css` artifact with a conservative semantic comparator (`tests/runtime/css-semantic-compare.mjs`) before the packaged artifact is regenerated. The comparator indexes style rules and at-rules via postcss and reports: selectors grouped by their at-rule context (`@media`, `@layer`), `@property` and `@keyframes` bodies compared by value, and duplicate or reordered declarations for the same selector. It is a review aid, not a renderer-equivalence proof. Selector text, declaration values and at-rule parameters are compared as trimmed source text: whitespace inside quoted strings and grammar-sensitive expressions (for example `calc(100% - 1rem)`, media/container conditions and quoted attribute values) is significant, and differences are surfaced for review rather than silently equated. Declarations inside generic at-rules the comparator does not index structurally (for example `@font-face`), same-selector conflicts, and conflicting duplicate declarations within one keyframe step whose effective value depends on unestablished source order are surfaced as review entries and make the verdict fail closed to `inconclusive`. The remaining verdicts are `regressed` (candidate-only declarations, at-rules, or changed `@property`/`@keyframes` values) or `packaged-superset` with no equivalence claim; the CLI exits non-zero for everything except a clean packaged-superset report. The packaged artifact is only regenerated after the compiled candidate produces a reviewed, accepted report through this procedure.

## Prototype entry and Statefully data

The Vite host resolves `design-notebook/runtime`, `design-notebook/runtime/react`, `design-notebook/runtime/route`, and `design-notebook/docs` to the package's corresponding built-in modules in both dev and static builds. Prototype source code must import the browser-safe route helper from `design-notebook/runtime/route`; importing `design-notebook/runtime` also imports Node/Vite server code. Use the route helper with the stable descriptor ID:

```jsx
import { PrototypeProvider } from '@dfosco/statefully/react'
import { prototypeRouteBasePath } from 'design-notebook/runtime/route'
import { usePrototypeRoute } from 'design-notebook/runtime/react'

function App() {
  const route = usePrototypeRoute({ basePath: prototypeRouteBasePath('borrow-flow') })
  return <PrototypeProvider prototype="borrow-flow" flow="default" flowSelection="route" route={route}>
    <PrototypePage />
  </PrototypeProvider>
}
```

In a static build that uses a Vite base, pass the already complete prototype base explicitly:

```js
prototypeRouteBasePath('borrow-flow', {
  mode: 'static',
  base: import.meta.env.BASE_URL,
  baseIsPrototypePrefix: true,
})
```

The helper validates that the static prefix ends in `prototypes/<encoded-id>/`. In dev, the route base is `/__notebook/prototypes/<encoded-id>`.

State files live under each prototype's `state/` directory. `default.flow.json` is indexed as `<artifact-id>/default`; `request.flow.json` as `<artifact-id>/request`. With `flowSelection="route"`, Statefully selects a requested `?flow=` or `?scene=` first, then matches the last pathname segment to an indexed flow, and falls back to `<artifact-id>/default` at the prototype root. Use matching lowercase view paths such as `/request` and `/confirmation` with `request.flow.json` and `confirmation.flow.json`. URL hash parameters remain owned by Statefully's session store.

The route hook supplies pathname, search, params, basePath, navigation, subscription, and snapshot functions. Navigation is limited to the same origin and current prototype route. It does not implement state editing or filesystem writes.

## Local canvas geometry persistence

The local shell saves a canvas widget's move or resize after the interaction commits. It sends a same-origin `POST` to `/__notebook/artifacts/<canvas-id>/geometry`, with the stable canvas and widget IDs, one geometry operation, and the exact `If-Match` ETag returned with the loaded canvas JSONL. Move appends a `widget_moved` record. Resize appends a `widget_updated` record containing width and height. Both operations append to the authored JSONL stream; they do not rewrite prior records or store geometry in browser storage. The response returns the appended event, a new ETag revision, and the resulting geometry replayed from the stream. Move preserves the current size; resize preserves the current position.

Only this geometry operation is writable. The server re-discovers the canvas by stable ID, confines its payload to the discovered canvas folder, requires a matching canvas header and complete replay, verifies that the widget exists, validates the request, and serializes writes per canvas within the running server. It compares the exact canvas bytes again immediately before append. A stale but valid revision returns `409` with the current revision. An invalid or incomplete canvas stream, missing widget, or unwritable payload returns `422`; malformed JSON or out-of-scope geometry fields return `400`; an unsupported content type returns `415`; a body over 8 KiB returns `413`; missing `If-Match` returns `428`; and missing or cross-origin request origin returns `403`. Unknown canvas IDs return `404`, and non-POST methods return `405`. Rejected requests do not repair or append to a stream. The shell restores the last authoritative geometry and displays the error when a save fails. Reloading the canvas replays the saved geometry.

The revision check and write queue coordinate this runtime's own requests. They are not an operating-system file lock or an atomic compare-and-append against arbitrary external editors. If an external process writes between the final byte check and append, that narrow race cannot be ruled out. Static output has no live write endpoint or save callback; its move and resize interaction is temporary and is not saved.

## Resolution and refresh

`createNotebookRuntime({ root, base, host, port })` returns the Vite server, the current discovery snapshot, refresh subscriptions, and the shared resolver methods. `resolveArtifact(reference, { kind, viewId, mode })` accepts a stable artifact ID. Prototype results include a stable route URL; Site results include the original descriptor, authored views, and notebook-relative `folderPath` for resolving Site assets. An omitted `viewId`, including an adapter property whose value is `undefined`, selects the default view. A supplied `viewId` must be a non-empty string and match exactly; `null`, empty, and unknown IDs are diagnosed. Prototype `views[].path` values are root-relative paths beginning with `/`. Their query and fragment components are preserved in resolved links after pathname traversal checks; generated HTML routes use only the pathname.

`resolveAsset(reference, { basePath, mode })` resolves a relative path from the caller's declared notebook-root-relative base. Use an artifact folder as the base for Site screenshots and an explicit asset folder for canvas images. Files must resolve inside the notebook. Absolute HTTP(S) references pass through. In local mode, asset URLs are root-relative to the dev server; prototype route URLs are absolute HTTP(S) URLs using that server's origin. In static mode, prototype and asset URLs are portable root-relative paths under the configured base, such as `/preview/prototypes/<id>/` and `/preview/assets/image.png`. They intentionally contain no workstation or localhost origin. Browser clients that require absolute HTTP(S) URLs must normalize a resolver result at render time with `new URL(result.url, documentBaseUrl)`, where `documentBaseUrl` comes from the current host page. In static mode, local filesystem paths and local-only Site references are not converted into publishable URLs.

The watcher discovers new or removed folders, file edits, descriptor edits, and canvas JSONL changes. Statefully's plugin rebuilds the in-memory data index for State files and invalidates its virtual module. Discovery diagnostics remain attached to the graph, and an invalid artifact can become available again after its descriptor is fixed. The runtime exposes no generic mutation service, terminal or agent hooks, or external-site process manager.
