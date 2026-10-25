# Design Notebook — Vision and Architecture

**Status:** Working design · **Updated:** 2026-10-23

This document captures the product and architecture direction behind Design Notebook. It is not a finished file-format specification or a description of an implemented runtime. Field-level schemas and unresolved conventions remain to be defined where noted.

## 1. An open notebook for product design

Design Notebook is an open, filesystem-based notebook for product design. It brings executable prototypes, canvases, documents, existing websites and their supporting material into a portable working space.

Think of the distinction between a Google Docs document and the application used to open it, or between a Figma design file and the interface used to work with it. The work is content; the application provides the services and interactions around that content. These are analogies for the separation of responsibilities, not descriptions of those products' internal architecture.

Design Notebook makes that separation explicit:

- The **notebook** is the content, stored in an open directory format.
- The **core** is a local design service. It discovers and watches that content, resolves references, and manages supported prototype runtime and build work.
- The **client** is the design interface. It reads the core's view of the notebook and presents its artifacts.

The default core and client ship together in one open-source npm package, **`design-notebook`**. Users get a working notebook experience without assembling separate applications. Developers can build a different client on the same core, or implement the notebook format independently.

A notebook has two primary forms:

- **Locally, it is a directory.** Its conventional folders, configuration files, artifact definitions, source code and assets describe the notebook.
- **When published, it is a static website.** A build assembles the notebook content and viewing interface into an output directory that can be deployed to a static host.

An external website referenced by a notebook remains external. Publishing the notebook does not implicitly copy, deploy or take ownership of that website.

Authors and agents create and change notebook files directly through editors and file operations. This is the intended authoring interface: edit prototype source and document text, and append canvas records to the canvas file. The initial design does not include a notebook or canvas mutation API, a mutation CLI, or persistent browser editing. Core lifecycle commands such as starting, previewing and building are separate from authoring. Reviewers can explore a browser view without installing an authoring application.

The open format allows independently developed clients to work with the same notebook.

## 2. The format, core and client contracts

The **Design Notebook specification** defines conceptually and technically what a notebook is. Alongside the content format, the reference implementation needs an explicit contract between its core and its client.

| Boundary | Defines | Does not prescribe |
| --- | --- | --- |
| Notebook format | Saved content, directory structure, schemas, identity, references, canvas record semantics and expected prototype runtime | A particular core implementation or client UI |
| Core contract | Discovery, file observation, resolution, runtime/build results and capability reporting | A remote notebook/canvas mutation service |
| Client contract | How the interface reads discovered content, presents capabilities and handles unavailable content | A visual layout or file-authoring application |

These are responsibility boundaries inside one product. They do not require separately distributed packages or services. Backend and frontend can be developed together in one repository and shipped together while keeping their interface explicit.

The specification should be developed from the inside outward: first define the canvas JSONL data and record-operation semantics alongside the intended Tiny Canvas rendering integration; next define typed artifact folders and descriptors; then specify core discovery, watch, resolve, runtime and build behavior; finally build the bundled navigation client over those layers. Vendoring or adapting Tiny Canvas is the intended starting direction, not work already completed or a provenance decision.

### The open notebook format

The specification defines:

- The notebook directory structure, conventional folder names, configuration files and discovery rules.
- Artifact identity, types, references, assets and the meaning of their saved data.
- Canvas representation and append-record semantics, using the confirmed `.canvas.jsonl` file convention. These are file records, not remote mutation commands.
- Document representation using MDX, with Markdown content, component references and a vertical layout contract.
- Prototype routes and named URL states.
- Site references, views and portable screenshot representations.
- Artifact renderer declarations and their relationship to runtime/build capabilities.
- How tools and extensions identify themselves, describe their content and behave when unavailable.
- Versioning, compatibility and the expectations of a published notebook.

The format includes semantics as well as schemas. Clients need to agree on what an ID identifies, what a relative path is relative to, what a canvas placement refers to and what happens when a referenced capability is absent.

The typed folder and descriptor names below are confirmed direction. Remaining field-level schemas and conventions must distinguish required structure from defaults that configuration may override. Implementations should not have to reverse-engineer the first client's source to discover those rules.

### The core contract

Design Notebook Core provides read, observation and execution services around notebook content. Its contract needs to describe:

- How a notebook is located, opened, validated and watched.
- How clients discover artifacts, views, placements, assets and their relationships.
- How stable references resolve to usable local URLs or published representations.
- How the declared prototype runtime is prepared, previewed locally and built for supported publication.
- How file records and descriptors are interpreted, and how malformed or unsupported content is reported.
- How clients receive content changes, validation diagnostics and relevant runtime state.
- How clients identify supported capabilities and compatible contract versions.

The contract includes schemas for discovered data, not just a list of endpoints. Saved notebook data and runtime responses are related but distinct: a resolved development URL or running process belongs to runtime state, not necessarily to the portable notebook. Authors change saved content in files; the core observes those changes instead of providing notebook or canvas mutation operations.

There is no initial notebook/canvas mutation API or mutation CLI. Lifecycle commands start or preview the core and build or publish output; they do not edit notebook content. Canvas record operations describe how file entries represent placements and changes. Concurrent file writers, malformed partial appends and unknown records still need explicit compatibility and diagnostic rules; this design does not assume a locking mechanism.

### The client contract

The client owns the visual notebook experience: navigation, artifact presentation, canvas and document rendering. It reads the core's discovered data and runtime results rather than depending on private server internals. Persistent content changes remain direct file edits by an editor or agent.

The notebook is one web application with a navigation shell and artifact content surfaces. Each artifact type has a rendering mechanism appropriate to its content. Those mechanisms need not share the same layout or require every artifact to be a separate iframe.

A compatible client must account for the capabilities the core actually exposes and handle unsupported artifact or tool implementations through the notebook's fallback rules. A control in the UI does not create a capability the core does not provide.

The client contract also needs a published mode. A static notebook has no running local core, so the published client must consume built content and assets without requiring live server operations. The exact static data interface remains to be specified.

### One package, a default core and a default client

The bundled product provides lifecycle entry points to start the core, preview a notebook, build static output and invoke a configured publishing workflow. These commands manage the experience and its output; they are not a second way to author notebook content. No notebook or canvas mutation commands are part of the initial direction.

The default client provides a useful notebook viewing experience. Its layout and presentation customizations are product choices. They do not define the limits of what another compatible client may offer.

The reference implementation is evidence that the format works. Its incidental implementation details are not automatically part of the specification.

A starter is an example notebook configured to run with the bundled core and client. Framework dependencies, npm scripts and example content in a starter are not necessarily universal format requirements.

### Independent clients

There are two distinct ways to build an alternative viewing experience: consume the core's documented discovery and resolution results, or implement an independent reader against the notebook format. The first reuses core runtime behavior; the second relies on file-format interoperability. Neither path implies a promised generic SDK or a core service for authoring content. Editors and agents continue to write the files directly.

Clients should understand the same notebook data and preserve compatible content across implementations. That does not require identical UI, identical live capabilities or identical internal architecture. Reusing a publisher or other implementation code is a separate engineering decision.

The specification defines interoperability, while each client chooses how to present content. An independent authoring tool may edit files according to the format, but that is not a built-in mutation service promised by the core.

## 3. Notebook contents and discovery

A notebook owns its authored content: configurations, artifact definitions, prototype source, canvas documents, references and assets. It does not need to carry a copy of either the core or the client's application source code.

“Content” includes executable prototype code. It does not mean that the notebook contains only passive documents or media.

The core locates the notebook configuration and uses it, together with the format's directory conventions, to discover artifacts and resolve their references. Stable IDs identify artifacts independently of their display names. Path and ID behavior during moves or renames needs an explicit contract.

An illustrative directory using the confirmed typed artifact names: `name.prototype/name.prototype.json`, `name.canvas/name.canvas.jsonl`, and `name.site/name.site.json`. A `name.doc.mdx` file may live at the notebook root or in any ordinary grouping folder; its frontmatter holds its ID and title, and it does not own the enclosing folder. Prototype descriptors name the bundled `@dfosco/statefully` runtime and required version. The notebook-level filename and some other field schemas remain proposals:

```text
my-notebook/
  notebook.json
  onboarding.prototype/
    onboarding.prototype.json
    src/
  onboarding-review.canvas/
    onboarding-review.canvas.jsonl
  product-site.site/
    product-site.site.json
  onboarding-rationale.doc.mdx
  components/           # optional notebook-authored document components
  assets/
  package.json
  dist/                 # generated published website
```

The notebook's `package.json` may select a `design-notebook` package version, provide lifecycle scripts and declare content dependencies. The installed package supplies the core and default client. Generated output is separate from authored source.

The `.prototype`, `.canvas` and `.site` folder/descriptor pairs are the confirmed naming direction. The notebook root is the content root: ordinary directories nest freely, mix artifact kinds, and appear as groups in the notebook tree. `prototypes/`, `canvases/`, and `sites/` are optional ordinary folder names, not discovery roots. A typed artifact directory cannot contain another artifact, including through intermediate ordinary folders; discovery reports the nested and containing paths without moving files. A doc is a `.doc.mdx` file that can live at the root or in any ordinary group. It does not own its enclosing folder. Its `formatVersion`, stable ID, and title live in YAML frontmatter. Typed suffixes identify artifact boundaries, not identity; authored IDs survive path changes. Discovery ignores only documented infrastructure/generated/dependency directories and does not follow symlinked directories. See [the first-look artifact format](docs/format/artifacts.md) for path bases, descriptors, and exclusions. `notebook.json` and `dist/` remain illustrative. The format is a recognizable directory with shared meaning, not a private database understood by one application.

A **collection** groups references to independently owned notebooks. A notebook can belong to multiple collections without being copied. Collections do not require a shared runtime or database and are outside the initial runtime's essential scope.

## 4. Initial artifact types

The initial artifact types are **prototype**, **canvas**, **site** and **doc**. Supporting images, screenshots, text and other assets can appear within them. Additional first-class artifact types may be introduced later.

### Prototype

A prototype is a small website or application whose source lives inside the notebook. It contains routes and may declare named views or URL-addressable states.

The notebook runs the prototype during local development and includes supported built output when publishing. A canvas can display specific routes or states side by side. The notebook format identifies the expected prototype runtime and its run/build expectations; the core defines and bundles the supported runtime so clients do not select incompatible toolchains.

The initial publishing contract requires prototypes that can produce static output. Runtime-dependent applications need a separately defined capability; the static publisher cannot silently promise to reproduce an arbitrary backend.

The defining distinction is ownership and inclusion: the prototype belongs to the notebook and is published with it.

A prototype runtime is distinct from the technology used to build the notebook client. A different client can present the same core-resolved prototype without importing its components into the notebook UI. Supporting a different prototype runtime is a format/core compatibility decision because run behavior, routes, assets and publish output must remain predictable.

The first-look runtime is `@dfosco/statefully` version `0.2.1`, identified in each prototype descriptor. The core defines and bundles that version for both local development and static builds, with the same supported route and state behavior. The exact bundled package version and behavior in development and static release builds still need release verification. This does not imply arbitrary framework installation or a general plugin system.

The initial direction is one core-defined and bundled Statefully runtime. Existing applications using other stacks can remain sites. Supporting arbitrary runtimes within one notebook is not a prerequisite; another runtime would need an explicit format and core compatibility decision.

### Site

A site represents an existing website or application with a separate codebase outside the notebook. Adding a site records references to that work; it does not import the application into the notebook.

A site can describe:

- A local source directory, when available on the author's machine.
- A local development URL.
- A publicly deployed URL on another origin.
- Specific views or routes and their corresponding URLs.
- Screenshots that represent the site and its views within the notebook.

A site folder may initially contain only its matching descriptor; the referenced application remains external.

A site has an entry point in the notebook, with a large screenshot and a link to the deployed website. Individual site views can also be placed on canvases.

During local development, site views can use live iframes when the external application's configuration permits embedding. If the server is unavailable or embedding is blocked, the notebook needs a screenshot or an explicit unavailable state.

In published notebooks, the baseline representation is **screenshots linked to the deployed site**. The notebook must work without production iframe embedding. Different domains do not inherently prevent iframes, but the target site's embedding policy, authentication and availability are outside the notebook's control. Screenshots and links are a deliberate portability choice.

Local paths and localhost URLs are development references, not portable published destinations. Publishing must distinguish them from deployed URLs. Behavior when a screenshot or deployed URL is missing remains to be specified.

Screenshot capture, refresh, freshness information and the relationship between a local view and its deployed equivalent need a concrete contract. A screenshot is a representation of a captured view, not a promise that the external site remains unchanged.

### Canvas

A canvas is a spatial arrangement of artifact views and supporting material. It can bring together notebook prototypes, external site views, images, text and references.

A canvas placement has its own identity and spatial properties and can refer to an artifact or one of its views. The same artifact may appear in multiple placements.

Removing a placement is distinct from deleting the underlying artifact or its source code. This distinction should hold across clients.

The confirmed canvas paths are `name.canvas/name.canvas.jsonl`; a separate `name.canvas.json` configuration file is not required. Canvas JSONL holds the saved placement records and their operations. Their exact ordering, coordinates, extension data and compatibility rules still need a written specification. Agents and editors append or edit these file records directly; there is no canvas mutation API or CLI in the initial direction.

### Doc

A **doc** is an MDX file that combines Markdown prose with components. It is an initial artifact type, with its own stable identity, navigation entry and published representation.

The authoring experience starts with Markdown. Authors should be able to write a useful document without adding components or learning an import syntax. Components extend that document when needed, for example by inserting a prototype view or a site screenshot between paragraphs.

The document renderer is a vertical variant of the canvas experience, sharing its widget rendering primitives. A doc materializes as a page of Markdown and widget blocks in source order. In V1, every block occupies the full available content width, and the document surface scrolls vertically without horizontal panning or page-level horizontal scrolling. Widget sizing and overflow behavior must respect that constraint. Width props, columns, spatial rearrangement and visual layout editing are later possibilities.

MDX remains the authored source of truth. Reusing canvas rendering does not require maintaining a second editable JSONL canvas for the same document. Any intermediate block representation should be derived from the MDX source.

For each canvas widget supported by the client, the intended contract provides a corresponding document component. Artifact references, view selection, portable representations and unavailable states should have consistent meaning in either surface. Extensions need to declare their document presentation support; a missing component must not silently remove content.

The build includes the doc's rendered content and required supported components in the static notebook. Its embedded site views use the same published screenshot-and-link contract as sites on a canvas. Components that require a local server need a portable representation or an explicit publication diagnostic.

#### Components and imports

A frontmatter preprocessing step is proposed for declaring component imports before MDX compilation. For example, an author might declare a local component under an `imports` mapping and then use it in the document:

```mdx
---
imports:
  ReviewNote: ../components/ReviewNote.tsx
---

# Onboarding review

The first step needs more explanation.

<ReviewNote />

The prototype below explores an alternative.
```

This is illustrative syntax, not an implemented schema. Alias naming, default versus named exports, path bases, dependency resolution and interaction with ordinary MDX imports remain open. YAML frontmatter and its import mapping would be a Design Notebook preprocessing feature; MDX does not enable frontmatter by default. See the [MDX frontmatter guide](https://mdxjs.com/guides/frontmatter/).

The working recommendation is to make a documented set of built-in widget components available automatically and require explicit imports for notebook-authored or dependency-provided components. Automatically importing an entire `components/` directory remains an alternative to evaluate, not a settled rule. Explicit imports make dependencies and name conflicts easier to inspect.

The Markdown-first promise also needs a precise parser contract. MDX has syntax differences from Markdown, including special treatment of braces and angle brackets. Whether to support a plain `.md` mode alongside `.mdx`, and which Markdown extensions to enable, remains open. See [MDX syntax and Markdown differences](https://mdxjs.com/docs/what-is-mdx/).

### Artifact renderers and runtime adapters

Artifact definitions may name a renderer, with a default for each built-in artifact type. The renderer is the client's mechanism for presenting that artifact inside the notebook shell. The identifier and configuration belong in a documented contract; they should not expose a particular client's internal module paths.

| Artifact | Rendering responsibility |
| --- | --- |
| Prototype | Present the website URL or static output resolved for the prototype and selected view. |
| Canvas | Read the canvas representation and arrange its widget views spatially. |
| Site | Present the entry point or selected view using a local live embed or a screenshot and link. |
| Doc | Present compiled Markdown and component blocks through the vertical canvas variant. |

A **runtime/build integration** has a different responsibility from a renderer: preparing and running prototype source, reporting readiness and its actual URL, and producing supported build output. The core owns this work and supplies the declared, bundled runtime; the client renderer consumes the results. Supporting another runtime changes the format/core compatibility surface and should be added only for a demonstrated need.

This separation allows a prototype renderer to display output from the declared `@dfosco/statefully` runtime without tying it to the client's screen-building technology. Specialized renderers can be considered independently. The package and version are explicit; dev/static compatibility still needs release verification.

Like a tool handler declaration, a renderer declaration identifies a capability that an implementation must resolve. Naming one does not automatically install or execute arbitrary code. Missing renderers and unsupported adapters use the capability and fallback rules below.

These responsibilities do not require a configurable renderer or adapter plugin system in V1. Built-in renderers and a single supported prototype pipeline can establish the contracts first.

## 5. Tools and extensions

A **tool** is a bounded piece of functionality that interacts with the user through the notebook UI and interacts with notebook data.

Tools can provide custom interactions and presentations over notebook content. A tool is a capability; an artifact is a piece of work. A tool may operate on existing artifacts without introducing another artifact type.

The format needs to define the portable expectations around tools: identity, declarations, configuration, associated saved data and behavior when the implementation is unavailable. How a client loads tool code, exposes APIs and grants access to notebook data remains an implementation and extension-contract question.

Declaring a tool does not mean every client implements it, and discovering a notebook does not imply automatically executing arbitrary extension code. The initial design does not require a marketplace or a general-purpose plugin platform.

### Unavailable capabilities

A missing private widget, tool or artifact implementation must not make the rest of the notebook unreadable.

The proposed representation order is:

1. Use a supported live implementation where appropriate.
2. Otherwise use a declared portable representation, such as a screenshot or readable content.
3. Otherwise show a framework-provided unavailable state.

Readers should preserve the artifact or placement's identity, references, spatial structure and unfamiliar saved data, and must not silently hide or discard unsupported content. Unsupported schema versions should produce a clear diagnostic or unavailable state. How direct file editors handle unknown records when changing a file remains part of the format contract.

Malformed or partially appended JSONL and concurrent direct file writers also need defined diagnostics and recovery expectations. No locking or conflict-resolution system is assumed by this design.

The originating client is responsible for materializing representations that require private code. An open client cannot reconstruct a screenshot of a private widget whose implementation it never received.

Local preservation and public export are different contracts. Keeping private extension data intact does not mean including all of that data in the published website.

## 6. A small core shipped with its client

Design Notebook Core starts as a small Node.js runtime distributed in the `design-notebook` npm package alongside the default client. It watches the notebook directory, discovers content, resolves artifacts and serves the client and notebook resources. The client renders the visual notebook experience from that data.

The UI is part of the distributed product, with its own responsibility and contract. Users should not have to assemble a shell, renderer and separate runtime tools to open their first notebook. Replacing the client should not require replacing the core's discovery and resolution logic.

The initial direction is one development server serving the notebook and its supported prototypes, with Vite as the proposed development/build foundation. The development/build pipeline also prepares MDX docs and their component dependencies for the client. Exact routing, MDX integration and framework constraints remain to be designed. Multiple prototype servers are a possible future capability, not an initial architectural requirement; adapters that need their own servers must be introduced explicitly rather than assumed to fit the first server model.

Sites initially may be run independently and referenced through their local URLs. Later, the core could supervise site development servers as subprocesses, discover their actual ports and update runtime URL resolution. That would let stable artifact references survive port changes. Machine-specific process state should not become the portable identity of a site.

Agent orchestration and an elaborate process-management UI are outside this core's initial scope. A TUI or a Go/Rust implementation is not needed to establish the first notebook experience.

### Lifecycle

The intended lifecycle workflows are **dev**, **build**, and **publish**. Dev starts the core, serves the default client and refreshes the notebook experience as files change. Build assembles supported notebook content and a client for static viewing. Publish deploys that output through a configured workflow. These lifecycle commands manage the runtime and generated output; they do not create, edit or mutate notebook content. Deployment configuration and the initial host integration remain open.

These are proposed lifecycle entry points, not commands implemented in the current scaffold. Building and deploying remain distinct operations; using the notebook locally does not require a hosting account.

The static output includes the notebook UI, supported prototype builds, rendered docs and their component dependencies, assets, site screenshots and portable extension representations. It can be viewed in a browser without a running Node process or an installed authoring client. Links to external sites remain external dependencies.

## 7. Authoring, interaction and customization

### Editors and agents are the editable interface

Design Notebook should provide agent skills designed around its format and workflows.

An author should be able to ask an agent to add a site from a local directory and development URL, place particular views on a canvas, create a prototype or update notebook content. The agent edits the descriptor, prototype source, MDX or canvas JSONL file directly; the core discovers those changes and the client renders them. The same file-first authoring path is available to editors. No notebook/canvas mutation API, mutation CLI or persistent browser editing is promised initially.

Readable structures, useful validation errors, examples and reliable live refresh are therefore central product features.

Canvas placement changes are saved as direct edits to JSONL records. A future browser gesture could help an author prepare such an edit, but persistent browser editing is not part of the initial design. Direct file writes by multiple agents or editors still need clear malformed-record, unknown-data and concurrency behavior; this document does not assume a locking solution.

### Included UI, customizable presentation

The default notebook UI belongs to the client and should allow notebook-level CSS customization. The supported override mechanism and styling guarantees remain to be defined. Customization should apply consistently in development and published output.

The core's data contract should expose a graph of artifacts, views, references and relationships that the client can consume. This allows alternative clients to present information beyond what the default interface displays.

That graph is a runtime view over notebook content, not a second authoritative store. The core contract should distinguish portable saved data from local runtime information such as active servers and resolved development URLs.

Later, the default client may expose replaceable sidebar, top-bar and other components that use discovered notebook data. Component replacement is a possible future client feature, separate from notebook authoring and core behavior; it should not delay a useful bundled experience.

### Alternative client boundary

A general-purpose SDK platform is not required for the initial experience. If another client becomes useful, its builders would need a documented way to read discovered notebook data, resolve references, observe changes and understand capabilities. That does not imply a core service or client-facing API for editing notebook content; agents and editors write the files directly.

An alternative client can use its own screen-building technology while consuming the same core results and notebook format. Changing the client's UI does not change the notebook-owned prototype runtime, which is identified by the format and supplied by the core.

Replacing the notebook's routing or publication pipeline can cross the client/core boundary. The design must identify which routes and assets belong to the client and which are produced or resolved by the core. Alternative clients remain possible, but no client-authoring service or family of framework-specific distributions is promised.

## 8. Decisions and remaining design work

The current direction is settled on:

- An open notebook format, a core contract and a client contract, with support for independent implementations.
- A local notebook directory with defined structure and configuration; a static website when published.
- Prototypes owned and published by the notebook; sites referenced from separate codebases and deployments.
- Canvas views that can combine both, with screenshots and links as the published site representation.
- Docs authored in MDX and rendered through a vertical canvas variant with full-width Markdown and component blocks in V1.
- Artifact-specific rendering within the notebook shell, with runtime/build adapters separate from client renderers.
- Editors and coding agents as the intended authoring interface.
- A small Node.js core and a default, customizable client shipped together as the `design-notebook` npm package.
- Direct file authoring by agents and editors, including canvas JSONL records; no initial notebook/canvas mutation API, mutation CLI or persistent browser editing.
- A prototype runtime identified as `@dfosco/statefully` `0.2.1` by the notebook format and defined/bundled by the core; dev/static version compatibility needs release verification.
- Tools and extensions whose absence must not destroy the notebook's meaning or data.

The next design work is to specify:

- Required directories, filenames, manifests, discovery rules and configurable conventions.
- Artifact/view/placement IDs, relative paths, reference resolution and schema evolution.
- Canvas JSONL data, append-record semantics, validation, unknown-record preservation and compatibility behavior.
- Typed artifact descriptor fields and discovery rules, including `.doc.mdx` identity in frontmatter and ordinary parent-folder semantics.
- Core read/observe/resolve/runtime/build results, change notifications, capability reporting and contract version compatibility.
- Client reading and rendering obligations, including consuming static output without a live core; no client authoring service is currently promised.
- Prototype routing and the constraints of the initial single-server/static-build model.
- Renderer identifiers and configuration, adapter declarations and local versus published capability reporting.
- Doc discovery and identity, MDX preprocessing, component imports, Markdown compatibility and widget behavior in the vertical layout.
- Site view declarations, screenshot generation and freshness, missing URLs and local-only references.
- Tool declarations, data access, extension loading and portable fallback obligations.
- Whether any future browser gesture should help prepare file edits; persistent browser authoring is not part of the initial direction.
- How concurrent file writers, malformed partial JSONL appends and unknown records are diagnosed and safely handled. No locking design is assumed.
- CSS customization, generated output and the first publishing workflow.
- Compatibility fixtures demonstrating the same notebook across independent clients.

The working constraint is to keep these agreements explicit without turning every responsibility into a separate subsystem. Start with one useful notebook experience and extract implementation boundaries when they solve demonstrated problems.
