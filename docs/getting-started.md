# Getting started

This guide runs the root `example-notebook/` directory in the Design Notebook source checkout. It groups a prototype, canvas, document and existing external Site in ordinary folders. The checked-in `examples/first-look/notebook` directory is a seed for creating that git-ignored working notebook, not a second dev target. Authors and agents change the working notebook files directly. This checkout guide does not imply that a released npm package is available.

## Set up the source checkout

From the repository root, install the locked dependencies:

```sh
npm install
```

The core supplies the selected runtime for notebook-owned prototypes. The notebook itself does not need a separate framework package manifest.

Create the root working copy from the checked-in fixture:

```sh
npm run example:init
```

The command refuses to replace an existing `example-notebook` folder. The working copy is git-ignored; edit it freely without turning the source repository into notebook content.

## Inspect and validate the example

The notebook root is the content root. Ordinary folders can nest and contain mixed artifact types. The suffixes mark artifact boundaries:

- `*.prototype/` contains a prototype descriptor and source.
- `*.canvas/` contains its JSONL event file.
- `*.site/` contains a descriptor for an existing external application.
- `*.doc.mdx` is one document file.

The source fixture is at [examples/first-look/notebook](../examples/first-look/notebook/), and the instantiated working copy is `example-notebook/`. Its canvas places the same `borrow-flow` prototype twice, using the exact `request` and `confirmation` view IDs. The prototype descriptor maps those views to matching Statefully flow files under `borrow-flow.prototype/state/`. The Site and document are in the same ordinary `research/` group. The document demonstrates prose and MDX embeds.

Run read-only discovery from the repository root against the working copy:

```sh
node --input-type=module -e 'import { discoverNotebook } from "design-notebook"; const result = discoverNotebook("example-notebook"); console.log(JSON.stringify(result.diagnostics, null, 2)); if (result.diagnostics.some(item => item.severity === "error")) process.exitCode = 1'
```

Discovery checks descriptors, stable IDs, paths and references, and includes canvas replay diagnostics. Review warnings as well as errors. The command reads files and does not rewrite them.

## Compare artifacts in the local client

Start the notebook client from the notebook folder. Running `npm run dev` from the repository root also serves this same `example-notebook/` folder. To serve another notebook, use `node bin/design-notebook.js dev /path/to/notebook` explicitly from the repository root.

```sh
cd example-notebook
npm run dev
```

Open the URL printed by the command. Use the folder tree to navigate to the prototype, canvas, document and Site. Prototype view selectors open exact authored views. The same prototype ID can appear more than once on a canvas with different view IDs, so the request and confirmation states can be compared side by side. Canvas move/resize saving through the local server is still pending integration verification in this source candidate. The intended behavior appends existing geometry events to the canvas JSONL; it does not use browser storage. Until that check passes, edit placement geometry in the JSONL file. A static build has no writable local service and cannot save canvas changes.

The example Site represents an existing application. Its screenshot and public destination support review; the notebook does not build or deploy that application. Local Site source paths and development URLs are specific to the author's environment. Press Ctrl+C in the terminal to stop the local client.

## Build and preview a static review

Build the full notebook viewer, supported canvas and document content, referenced assets, published Site screenshots and links, and notebook-owned prototype routes from the example notebook root:

```sh
cd example-notebook
npm run build -- --out-dir /tmp/design-notebook-first-look --base /
```

The build reports errors and exits unsuccessfully if required output is unavailable. It does not publish or upload anything. Once it completes, serve the generated folder with a plain static server:

```sh
cd /tmp/design-notebook-first-look
python3 -m http.server 4173
```

Open `http://127.0.0.1:4173/`, navigate between artifacts, select the request and confirmation views, then reload the page. Canonical direct paths use stable IDs: `/canvas/checkout-review`, `/docs/checkout-rationale`, `/sites/existing-catalog?view=catalog-home`, and `/borrow-flow/confirmation`. Open and refresh those URLs as well. A legacy `?artifact=` URL may still canonicalize, but the client does not generate it. This command previews a root-based build. If you build for a hosted prefix, use the same prefix when serving or deploying the generated files.

For deployment instructions, including a GitHub Pages workflow example, see the [static publishing guide](format/publishing.md#deploy-to-a-static-web-host) and its [GitHub Pages recipe](format/publishing.md#example-github-pages). Deployment is a separate action; this guide does not publish the notebook.

## Make changes

Edit prototype source, document text and descriptors directly. To change a canvas, append complete, newline-terminated JSON events to its `.jsonl` file while preserving the original `canvas_created` header and stable `canvasId`. Never derive IDs from filenames or paths. There is no notebook or canvas mutation API, mutation CLI, or browser save flow. Follow the [authoring guide](authoring.md) for file boundaries, references, grouping and validation.
