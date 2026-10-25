# Hypercanvas chrome provenance

The chrome in this directory is vendored from `@dfosco/hypercanvas` 0.70.0-beta.0, MIT licensed, at upstream commit `bf1b4bc3a3158f90f37600e9e270ab68e6d0bd7f`. The inspected upstream paths were clean at that commit. The copied license is [LICENSE](./LICENSE).

## Source closure

| Vendored path | Upstream path | Upstream SHA-256 |
| --- | --- | --- |
| `chrome/ui/sidebar.jsx` | `packages/storyboard/src/internals/chrome/ui/sidebar.jsx` | `3e63ee8f92854f53c218e824df6991c80e313c547355d04bd3315f7f160eca0a` |
| `chrome/ui/button.jsx` | `packages/storyboard/src/internals/chrome/ui/button.jsx` | `afce189123a23c3afa28253a0b3df8a6c6dbd85430ced3abd8e016aa463e79f8` |
| `chrome/ui/input.jsx` | `packages/storyboard/src/internals/chrome/ui/input.jsx` | `3a28d391a03e685977614772d7bafe71949f7f7a6c1b37f0245ef7cf3c1ac210` |
| `chrome/ui/separator.jsx` | `packages/storyboard/src/internals/chrome/ui/separator.jsx` | `cf39735596b056e775b1f2896ea0bd292022126038b85de257e90d365ee40202` |
| `chrome/ui/sheet.jsx` | `packages/storyboard/src/internals/chrome/ui/sheet.jsx` | `ed22ad805f268c43940bfe622fe54638afa0c7fc84651b65823b326a247baa0b` |
| `chrome/ui/skeleton.jsx` | `packages/storyboard/src/internals/chrome/ui/skeleton.jsx` | `3f162f12a93026beeee2c969b509c7330884947d7d52837ab46bfb11581dc2f7` |
| `chrome/ui/tooltip.jsx` | `packages/storyboard/src/internals/chrome/ui/tooltip.jsx` | `ef9716d3cbbfb8fd641b83dbb1dba8eaa96aa3d4633a448a37fa6448602f2a9c` |
| `chrome/ui/breadcrumb.jsx` | `packages/storyboard/src/internals/chrome/ui/breadcrumb.jsx` | `67cca1b1aef76a0b9f17343c19535884f7c372607ff86cf56c6b530da3a96f00` |
| `chrome/utils.js` | `packages/storyboard/src/internals/chrome/utils.js` | `5bff15862a95806dc27708b9bfa82fee4aaebad2516c098d77a1e218a5ffdea0` |
| `chrome/use-mobile.js` | `packages/storyboard/src/internals/chrome/use-mobile.js` | `adbb0dd2da0928091f8894de028f0ed7d36614f41c26c26a9e8863eed36b65d8` |
| `classnames.js` | `packages/storyboard/src/internals/hc-classnames.js` | `d4bf15d7aeeaeaffd580253c1ac986ea6a76bb3951120fbd627c347bdc43a1f5` |
| `core-css.js` | `packages/storyboard/src/internals/vite/core-css.js` | `7486c33dc27fc6f579b06d776ea99d0aa8d797e1b635165b48e8db51259aafe7` |
| `generated/tailwind.source.css` | `packages/storyboard/src/core/styles/tailwind.css` | `99f519eabacc66a3c4e21a3667ed2565da581c0ec461866f4b5178d8e0071db6` |
| `NotebookShell/NotebookShell.module.css` | `packages/storyboard/src/internals/NotebookShell/NotebookShell.module.css` | `dafcb556685722e0dacff0f1c835910c10cd40555b67f0f256d08393c5f36c06` |
| `NotebookShell/hypercanvas-icon.svg` | `packages/storyboard/src/internals/NotebookShell/hypercanvas-icon.svg` | `2ad76e744366383d3e0a6d510014d59285126f65a25a7d90530c0d7bbc5170b4` |
| `generated/tailwind.css` | `packages/storyboard/dist/tailwind.css` | `b4a50e231e84292224a407daff0e67d6bdee42ec80ce3555e958599fb867c5c3` |

The actual upstream NotebookShell render structure is adapted in `NotebookShell/NotebookChrome.jsx`. It retains Hypercanvas's `SidebarProvider` → `Sidebar` → header/separator/content/footer composition and the inline top bar's Button/Breadcrumb/actions composition (upstream `NotebookShell.jsx`, SHA-256 `13384b9e700750bd6373277ce9f03369bedc1da63c2473696bc26ba2018708d0`; sidebar around lines 790–930 and top bar around 931–945). Artifact rows use the upstream `TYPE_ICONS` mapping and `SidebarMenuItem` / `SidebarMenuButton` composition from `renderPage` (around lines 663–685). Folder headers reuse the upstream `.groupHeader`, `.groupTitle`, `.groupCount`, `.pageList` composition used for type groups and file sections (around lines 817–900), keyed to discovered ordinary folders instead of changing the notebook's mixed hierarchy into type groups. They retain the source triangle chevron characters and open by default. Root folders use the same zero-depth group placement as upstream groups; only child folders receive visual indentation. The adapter counts descendant artifacts and stores only transient collapse state keyed by folder path. It supplies Design Notebook identity, discovered folder/artifact entries, canonical route links, selected-view controls, and browser history callbacks. The notebook identity is rendered as a heading because this client exposes no notebook switch/edit action; it deliberately omits the upstream dropdown chevron rather than presenting a nonfunctional menu affordance. On Canvas pages the shared top bar remains hidden; closing the sidebar transfers focus to its visible reopen button after that control mounts. It also omits private notebook CRUD, settings, storage, and diagnostics actions.

The Canvas title-only overlay adapts the static title treatment from upstream `packages/storyboard/src/internals/canvas/CanvasPage.jsx` (`CanvasPageStaticTitle`, around line 743; SHA-256 `4ec401e5fe8add001b0cb2d00e1718d76a86ebc48ffaef60c7e202b8eb619e93`) and `CanvasPage.module.css` (`.canvasTitleStatic`, lines 102–110; SHA-256 `ef06edac60f58b33728efb8c40ae571d56e7c0e18c26e1ded8099cae337826f4`). It keeps the upstream font, size, weight, muted color, spacing, and nowrap treatment. The client adds its own absolute placement and ellipsis for narrow canvases; it does not add a toolbar or edit behavior.

## Namespace adaptation

Upstream component utilities were mechanically changed from `hc-*` to `ds-*`; the class merge helper now merges only `ds-*` utilities and preserves CSS-module, prototype, and other foreign classes. The copied Tailwind v4 import/source-discovery pipeline keeps its AST-based candidate scanning and CSS selector rewriting, with the prefix changed to `ds`. The source imports prefixed theme/utilities and `tw-animate-css`; it does not import Tailwind Preflight. The compiled stylesheet is the pinned upstream generated CSS with class selectors, internal Tailwind variables/layers, and prefix-bearing class-attribute selectors namespaced to `ds-*` using PostCSS and selector-parser ASTs. Semantic shell tokens and CSS-module references are kept in the `ds-*` namespace. `data-hc-ui` and `data-hc-surface` remain source component markers, not CSS utility names.

The source scanner is scoped to `src/vendor/hypercanvas/**`; it does not scan notebook prototypes or authored document CSS. The packaged stylesheet is the pinned upstream generated artifact after namespace adaptation, so installed/static shells do not rely on scanning consumer files. A focused regression test scans the current vendored source candidates and verifies that the artifact contains each emitted utility selector; only structural `group/name` and `peer/name` markers are excluded because they are selector context, not standalone utilities. The runtime development plugin compiles the same vendored source closure and may include the wider development catalogue. Vite/package integration and dependency installation are owned by the runtime package owner.

The adapter preserves native anchor behavior for modified clicks. Sidebar collapse uses the vendored controlled `SidebarProvider` behavior and source CSS. No storage or notebook content is written by the chrome.
