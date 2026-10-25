# Static publishing

Design Notebook builds two things into one output folder: the notebook viewer and the supported static prototype routes. The finished folder can be served by an ordinary static host. It does not need the notebook folder, a Design Notebook dev server, or local Statefully state files after the build completes.

## What the build includes

The publisher bundles the notebook shell and compiled `.doc.mdx` documents. It writes supported canvas JSONL snapshots and copies only files referenced by canvas images, document images, Site screenshots, and the optional root `notebook.css`. Referenced files keep their source hierarchy below `notebook-assets/`. Notebook folders remain groups in the navigation tree.

Available prototypes are built by the preceding prototype build stage. Their runnable Statefully apps and bundles are included under the internal `prototypes/<artifact-id>/` path. Public notebook review pages use `/<prototype-id>` and authored named-view paths such as `/<prototype-id>/request`; these pages show the prototype inside the notebook shell. Keeping the iframe path separate prevents the shell page from embedding itself. The `.flow.json` source files are not copied as loose notebook files; their supported runtime output is already part of each prototype build. Site source folders and local development URLs are not copied. A Site can still show its screenshot when no public destination exists. In that case, the shell reports that the link is unavailable.

The public graph contains stable IDs, display names, relative artifact paths, supported views, and filtered diagnostics. It omits the notebook's absolute root, raw descriptors, local Site source paths, development URLs, and unreferenced files. Infrastructure folders such as `node_modules`, `.git`, `.cache`, `dist`, and `build` are excluded. Source files are read but not rewritten.

The source canvas remains an append-only JSONL event stream. Publishing replays it and emits a new JSONL snapshot containing only the final supported widget state and the fields needed to render it. Removed widgets, event history, connectors, unknown extension fields, and non-rendered metadata are omitted. The source stream is not rewritten. Unsupported required events and malformed records make the published canvas unavailable and produce diagnostics; unknown optional events are skipped according to the reader's supported subset.

Document image resources are discovered from MDX syntax, including Markdown images and the built-in `<Image>` component. Both resolve from the document's containing folder through the copied asset manifest, so their generated URLs work below a hosting prefix. Local machine paths, local URLs, and dynamic resource expressions in image/link attributes are excluded with diagnostics. Ordinary prose and code blocks remain authored content and are published as written. The publisher does not inspect arbitrary document prose or executable expressions for secrets; authors must keep private information out of public documents. Missing image or screenshot files produce a visible unavailable representation and a diagnostic; a missing optional Site link does not hide an available screenshot. The shell marks artifacts unavailable when a required build or document compilation fails.

## Build output and hosting prefix

The build base is a root-relative URL prefix ending in `/`. Use `/` when the site is hosted at its domain root. For example, use `/design-review/` when the output directory will be served below `https://example.com/design-review/`.

The shell uses canonical paths based on stable artifact IDs: canvases use `/canvas/<id>`, documents use `/docs/<id>`, Sites use `/sites/<id>`, and prototypes use `/<id>`. Prototype named views follow the authored view path beneath the prototype ID. For example, a view authored at `/request` uses `/borrow-flow/request`. Site view selection remains a query parameter on the Site path, for example `/sites/existing-catalog?view=catalog-home`. The publisher emits a shell entry page at each canonical path, including named prototype view paths, so a direct request and refresh work from static files without a live notebook server or an SPA rewrite. Static hosts may redirect a slashless directory path to its trailing-slash form; both forms select the same artifact while generated links remain slashless. A legacy root URL such as `/?artifact=borrow-flow&view=confirmation` can be opened and canonicalized, but new links never use `?artifact=`.

Prototype view paths are also emitted as runnable files beneath the internal `prototypes/<artifact-id>/` directory, including nested paths, query strings, and fragments. Those files serve the app inside the notebook shell and are distinct from the public notebook review pages. All links and resources use the configured base prefix.

The output directory is ownership checked. Repeated builds may replace files recorded by the publisher's hash manifest when their contents still match. Modified generated files and unowned files at generated paths cause a collision diagnostic. The publisher does not clear the output directory or remove unrelated files.

## Preview locally

After the build finishes, stop the notebook dev server and serve the output folder as static files:

```sh
cd dist
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/` and try an artifact link, a prototype view selector, and direct paths such as `/canvas/<id>`, `/docs/<id>`, `/sites/<id>?view=<view-id>`, and `/<prototype-id>/<authored-view-path>`. Refresh each path. This preview uses a root base. For a hosted prefix, configure the host to mount the output folder at that prefix and use the matching build base.

## Deploy to a static web host

Build with the path where the site will be mounted. Upload the **contents** of `dist/` to that path's static document root, preserving subdirectories such as `assets/`, `canvas/`, `docs/`, `sites/`, `notebook-assets/`, `notebook-data/`, and `prototypes/`. The generated route directories contain their own `index.html` shell entries. Static serving must support directory index files for direct route requests. Then open one route for every artifact kind and a named prototype view directly, including after a refresh.

Keep the build output as the publishable artifact. Do not upload the notebook source tree, unreferenced folders, local Site code, `.flow.json` source records, or the publisher's source workspace. A deployment is a separate action from building; the build does not upload or publish anything.

## Example: GitHub Pages

For a repository project site such as `https://example.github.io/design-review/`, build with the base `/design-review/`. For a user or organization site at the domain root, use `/`. The same base must be used for the viewer bundle, canvas payloads, copied assets, and prototype routes.

In the repository's **Settings → Pages**, choose **GitHub Actions** as the publishing source. Use GitHub's Pages workflow template, then make its build step produce the static `dist/` folder with the matching base. The upload step must package the *contents* of `dist/` so `index.html` is at the artifact root; the deploy step publishes that artifact. Keep the upload and deploy steps separate from the notebook build. GitHub documents this custom workflow sequence in [Configuring a publishing source for GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

Before relying on the deployment, open the notebook at the project prefix, refresh canonical canvas, document, Site and prototype paths, and open a nested prototype view URL directly. GitHub Pages serves static files and directories, so each public route directory and the runnable prototype view's internal `prototypes/<id>/` directory must contain the generated `index.html`. Do not expect server-side route rewriting or runtime access to the notebook source.
