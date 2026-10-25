# Canvas renderer provenance

## Sources and pinned versions

The interactive Canvas widgets use the public component distribution from
[`@dfosco/tiny-canvas`](https://github.com/dfosco/tiny-canvas), version `5.5.0`,
reviewed at repository commit
`7b933d3a0b99234b2f9b650547dd0e82d0d019f6` on 2026-10-22. The package declares
the MIT license. Its license and copyright notice are retained at
[`src/vendor/tiny-canvas/upstream/LICENSE`](../../src/vendor/tiny-canvas/upstream/LICENSE).

The vendored public distribution closure is under
[`src/vendor/tiny-canvas/upstream/`](../../src/vendor/tiny-canvas/upstream/).
SHA-256 values identify the copied files:

| File | SHA-256 |
| --- | --- |
| `tiny-canvas.js` | `e6aca42477fc842fcf5c785597926cd7aaf439ce8a0a84eb5002a35edec0d4ab` |
| `Image-Dv6N7c_d.js` | `75c570bfa97bdc306c9989fa6983c2da5690b8211d0c65b0cc1bf31610b94338` |
| `index-BDk96P-Z.js` | `f88fa84fbee7131e75a90214d8c10d7d988de483ab6760352f421219891b47ce` |
| `tiny-canvas.css` | `6bf8e34fb56a788a0ce911506dff0280d8a7fe9159204e5b65b296a46d8c39c7` |
| `LICENSE` | `26793f4b878a36d3f099267fdc8e1780d7ba24b6e65994a93fd20d61afe56c86` |

The distribution entry exposes the package's `Canvas`, `Block`, `Note`, `Mark`,
`Image`, and `Frame` components. Its required runtime imports are React,
`react/jsx-runtime`, and `react-markdown`; the host owns the React and
`react-markdown` dependencies. The adjacent hashed chunks are part of the
published distribution closure and are kept with its entry and stylesheet.
No private application modules are imported by the notebook adapter.

The shell chrome is adapted from Hypercanvas Storyboard's
`packages/storyboard/src/internals/NotebookShell/NotebookShell.jsx`,
`NotebookShell.module.css`, and canvas toolbar. The reviewed checkout was at
`246871ffb4b2802da930a2f39780a0020024ea8f`; those specific source files were
clean in that checkout. This is a direct adaptation of that shell's layout,
dimensions, theme tokens, and mobile drawer behavior. It does not import
Hypercanvas React components: `NotebookShell.jsx` is coupled to private
navigation, storage, and host APIs. The public Tiny Canvas component closure is
vendored and used directly; the Hypercanvas chrome is adapted into the
package-owned shell. The concrete source inventory and corresponding shell
adaptations are:

| Hypercanvas source | Adaptation in this package |
| --- | --- |
| `SidebarProvider`, `Sidebar`, `SidebarHeader`, `SidebarContent` in `NotebookShell.jsx` | `NotebookShell` uses the same sidebar/header/content hierarchy and collapsible layout. Its content is the notebook's recursive ordinary-folder tree, preserving mixed artifact types and the Design Notebook label. |
| `.sidebarProvider` and `.sidebar` in `NotebookShell.module.css` (lines 13–35) | The source's 286px width, flex column, border, theme surface, and 150ms collapse transition are adapted in `src/client/shell/style.css`. |
| `.sidebarHeader` and `.iconButton` in `NotebookShell.module.css` (lines 60–67, 114–118) | The source's 49px minimum header, 8px/12px padding, 28px icon control, and borderless header are adapted. The brand remains Design Notebook; Hypercanvas's private icon asset is not copied. |
| `.artifactNavigation`, `.artifactSidebarToggle`, `.artifactTitle`, `.artifactNavigationActions`, `.openBrowserButton` in `NotebookShell.module.css` (lines 488–558) | The source's 49px toolbar, 30px toggle, 4px action gap, and 13px/600 title are adapted. Back/Forward and Open in browser occupy the same action area; modified-click anchor behavior remains native. |
| `Breadcrumb`, `BreadcrumbList`, `BreadcrumbItem`, `BreadcrumbPage` in `NotebookShell.jsx` | The package retains its accessible artifact heading and path metadata rather than importing the app-bound breadcrumb components. |
| `--hc-color-background`, `--hc-color-foreground`, `--hc-color-foreground-muted`, `--hc-color-border`, `--hc-color-ring`, `--hc-color-secondary`, and `--hc-font-sans` | The shell CSS consumes these variables with the same fallback values used by Hypercanvas. |
| `@media (max-width: 720px)` sidebar provider, drawer, and `.mobileScrim` rules in `NotebookShell.module.css` (lines 665 onward) | The shell uses the source's 86vw/320px drawer, 720px breakpoint, 160ms slide, and close scrim. |

The selectors are namespaced for this package, but the listed measurements,
tokens, and responsive behavior come from the pinned source files. No private
navigation, storage, or host dependency is copied. Hypercanvas's add-widget
authoring controls are not included because this task persists only move and
resize.

## Behavior in this adapter

[`src/vendor/tiny-canvas/interactive.js`](../../src/vendor/tiny-canvas/interactive.js)
projects the validated in-memory scene into Tiny Canvas components. The JSONL
parser and replay remain in `src/canvas-format/`; this adapter neither changes
that wire format nor defines a new one.

| Behavior | Implementation |
| --- | --- |
| Select a block | Tiny Canvas `Block` selection behavior |
| Move | Tiny Canvas drag behavior; transient local movement is committed through the notebook host callback |
| Resize | Tiny Canvas resize handle for notes, Markdown, images, and frames; notebook resize handle for Site and unsupported fallback blocks |
| Pan | Native scrollable Tiny Canvas viewport |
| Zoom | Tiny Canvas zoom buttons and cursor-anchored Ctrl/Meta-wheel zoom |
| Fit | Adapter computes the full item bounds, including negative and beyond-default coordinates, then sets native zoom and scroll position |
| Text | Tiny Canvas `Note`, including its Markdown rendering and color choices |
| Markdown | Tiny Canvas `Mark` |
| Image | Tiny Canvas `Image`, including loaded-image aspect-ratio locking |
| Frame | Tiny Canvas `Frame` |
| Site | Notebook-owned resizable block with local iframe, screenshot disclosure, and destination link; static mode has no iframe and shows the screenshot plus public link directly |
| Unknown item | Notebook-owned resizable block with a visible unsupported-content fallback |

The component library clamps block positions to non-negative board coordinates.
The adapter translates the board origin to include negative authored positions,
then converts committed movement back to the original coordinate space. It does
not rewrite coordinates merely to display the board. Tiny Canvas's default
10,000 by 10,000 board is replaced with dimensions calculated from scene bounds
so Fit can include items beyond those defaults.

Tiny Canvas components default to storing geometry in browser `localStorage`.
Every adapter-created Tiny Canvas block sets `persistPosition={false}` and
resizable widget sets `persistSize={false}`. In local mode a committed move or
resize calls `saveCanvasGeometry` with the current source revision. The runtime
appends the corresponding public JSONL event and returns authoritative geometry
and the next revision. The adapter serializes commits, displays failures, and
remounts the last authoritative geometry after a failed save. Static mode has no
save callback and states that geometry changes are temporary. The renderer does
not substitute browser storage for source persistence.

This is not full parity with the Tiny Canvas authoring application. It does not
create or delete widgets, rotate blocks, copy changes, or expose the application
page selector. It renders the supported scene records and persists only move
and resize operations. Unsupported operations and widget kinds remain visible
as unsupported; they are not silently discarded.

## Geometry projection and internal scene

The scene passed to `InteractiveCanvas` is an internal adapter object created
after JSONL validation and replay. It carries stable item IDs, resolved
references, and authored file geometry. It is not a public JSONL schema or an
operation contract. Text content is passed as data to Tiny Canvas Markdown
components; it is not inserted as HTML. Unsupported widget `props.fallback`
content is rendered as literal text.

## Frame trust and runnable modules

The interactive adapter uses Tiny Canvas's `Frame` component unchanged. The
reviewed `Frame.jsx` renders its iframe without a `sandbox` attribute. Prototype
code therefore runs with the browser's normal origin and frame permissions; it
is trusted notebook code and is not isolated by this viewer. This is the source
component's current behavior and is retained for interaction parity. Site
previews are separate notebook-owned iframes: local Site URLs receive
`allow-same-origin` only when same-origin, and retain screenshot and open-link
paths when embedding is blocked or unavailable. Static Site previews have no
iframe.

The older DOM-only `renderScene` primitive has a sandboxed frame policy. That
policy applies only to callers of `renderScene`; it does not describe the
interactive Canvas's Tiny Canvas `Frame` component.

The earlier primitive-only browser evidence for `renderScene` does not verify
this interactive React surface. A browser proof for drag, resize, save and
rollback, pan, zoom, Fit, and unchanged authored source is still required before
claiming end-to-end parity. The current resource hold prohibits that browser
run; the provenance and source changes here do not claim it passed.
