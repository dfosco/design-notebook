# Design Notebook client options

## Start with the work, then the interface

A notebook is a folder of design work: prototypes, canvases, documents, site links and supporting files. Its open format gives those artifacts and views shared meaning across tools.

The **core** is a local service that opens the notebook, notices file changes, and prepares previews and links. The **client** is the interface people use to browse and present the work. Different clients can use the same core without sharing the same screens.

Another interface might need a documented way to read notebook information and hear when files change. That connection is sometimes called an SDK. A general client-building platform, visual component library or content-editing service is not part of the initial promise. A client also needs a way to display a published notebook, where no local core is running.

Authors and coding agents edit files directly: prototype source, document text and descriptors, or records in the canvas JSONL file. A canvas action is represented as a saved file record, not a command sent to the running core. There is no initial notebook or canvas editing API, mutation command-line tool, or persistent browser editing. Starting a local preview, building a shareable copy and publishing it manage the lifecycle and output; they do not edit the notebook.

The current direction is to ship a useful core and default client together, so people do not assemble separate tools to open a notebook. The options below are compatible paths, not editions every user must choose between.

## Three ways to use the notebook

### 1. Use the included interface and adjust its presentation

This is the simplest starting point. A designer gets standard navigation and artifact views. A team can review a prototype, research document, and screenshots of its existing website together without moving that website into the notebook.

Some visual customization, such as colors and spacing, could make the interface feel at home. Notebook-level styling is in the current direction, but its limits are open. Replacing every component would add maintenance before a need is established.

This suits people who want predictable behavior with little setup. One team maintains the main interface, so improvements reach everyone. The trade-off is less freedom to fit a specialized process.

### 2. Build another interface on the same core

A team may need a different way to work, such as a review-focused interface for stakeholders or a compact view for a large touch display. A new client could use the same core and notebook data with its own navigation and layout. It would need a documented way to read the core's notebook view if that need becomes concrete.

The core can provide shared information and prototype services, but builders still design the interface and decide how to show unavailable features. Authors continue changing files directly; a new client does not imply a new editing service.

This path avoids duplicating shared behavior, while adding another interface to design, maintain, and keep compatible. It does not require a separate notebook format or separately packaged product.

### 3. Read the open format independently

A builder can also make a tool that reads notebook files directly, without using the local core. This is useful for a lightweight viewer, an archive reader, or a separate tool that needs to preserve and display the portable parts of a notebook. It can work from a published copy as well as from files on disk.

This route is most independent from the default runtime. The tool must understand references and unsupported features. It gets no automatic live updates, local previews or development-link resolution. It should preserve content it does not understand and show a clear unavailable state rather than silently dropping work. If it edits a notebook, it writes files according to the shared format; there is no core mutation service to call. Rules for overlapping edits and incomplete canvas records remain open.

The three paths can coexist. Supporting them does not mean promising three complete products at launch.

## Keep the interface separate from prototype execution

Changing the notebook client means changing how people navigate and view notebook work. Its UI framework is the technology used to build those screens. A new client can use different screen-building technology while consuming the same notebook and core.

A notebook-owned prototype is different from a referenced application. Prototype source belongs to the notebook and is intended to run locally and publish when supported. An existing application can remain a **site**: the notebook links to it and can show screenshots or selected views without taking ownership of its source or deployment.

Prototype execution should not be left to guesswork. First-look prototype descriptors identify `@dfosco/statefully` version `0.2.1`. The core bundles that package version and uses the same route and state behavior for local previews and static output. The exact bundled package version and behavior in development and static release builds still need release verification.

Another prototype framework would be a core and format change. The core must start it, resolve its routes and assets, and determine what can publish. Changing the notebook's screen technology does not supply that support. First look uses one defined, bundled Statefully runtime.

## What changes between local work and publication

Locally, the core is running beside the notebook. It notices file changes and the interface can show updated content, live previews, and addresses that only work on the author's machine. A designer might ask an agent to update a prototype or site reference in the files, then see the notebook refresh during review.

A published notebook is a static website: it contains the viewing interface and prepared content, but it has no local core watching files or running prototypes. Supported prototype output can be included. For an external site, the portable representation is a screenshot and a link to the deployed site, rather than a promise that the site can be embedded or copied. The publishing rules for each artifact still need to be specified.

## A proportionate starting point

A reasonable proposal is to begin with the bundled core and default client, allow modest presentation customization, and keep the format clear enough for independent readers. Authors and agents edit files directly; lifecycle commands run or publish the work without becoming a second authoring path. Another interface remains possible if a real audience needs one, but that does not commit the project to a general SDK platform or client-authoring service. Treat these as compatible directions, not several editions.

Defer a system for replacing every interface component and support for multiple prototype frameworks. Keep existing applications as site references unless there is a concrete reason to own and publish them.

Open decisions include the first client's interactions, styling limits, which features appear in a published copy, and how another client signals an unavailable capability. Settle them through examples. This recommendation starts that discussion; it is not an approved implementation plan.
