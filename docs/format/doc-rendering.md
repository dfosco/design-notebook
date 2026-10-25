# Document rendering

`.doc.mdx` files are Markdown-first MDX. YAML frontmatter supplies artifact identity and metadata. The remaining source is compiled as MDX and rendered top to bottom as full-width prose and component blocks. Source order is preserved; the page does not use a two-dimensional canvas layout.

```mdx
---
formatVersion: 1
id: checkout-review
title: Checkout review
references:
  - checkout-prototype
  - marketing-site
---
import { Prototype, Site, Image, CanvasWidget } from 'design-notebook/docs'

# Checkout review

The current flow is ready for review.

<Prototype artifactId="checkout-prototype" viewId="overview" />

The deployed marketing view is below.

<Site artifactId="marketing-site" viewId="home" />

<Image src="assets/checkout-flow.png" alt="Checkout flow" />
```

`Prototype`, `Site`, and `Image` are the built-in components. `Prototype` and `Site` require an `artifactId` matching a discovered stable artifact ID. Their optional `viewId` selects that exact authored view. An absent artifact or an explicit unknown view produces a diagnostic and a visible unavailable block; an unknown explicit view is never replaced with another view. `Image` resolves a relative `src` from the document's containing folder. Absolute HTTP(S) image URLs are also supported.

`CanvasWidget` is the explicit escape hatch for a canvas widget type that the bundled viewer does not render. It accepts `type` and `props`. A text fallback uses the same optional props convention as canvas JSONL:

```mdx
import { CanvasWidget } from 'design-notebook/docs'

<CanvasWidget type="custom-chart" props={{ fallback: { type: 'text', text: 'Chart unavailable in this viewer.' } }} />
```

Fallback text is displayed as text, not interpreted as HTML. Missing, malformed, and unsupported fallback shapes remain unavailable and produce diagnostics. Component imports are explicit. The `design-notebook/docs` module is the built-in component import; a host may add other component modules through its supported import map. There is no folder auto-import or frontmatter import syntax.

Frontmatter is YAML metadata, not MDX code. It must begin the file and include `formatVersion: 1`, a stable `id`, and a non-empty `title`. An optional `references` array contains stable artifact IDs. Frontmatter parsing and MDX compilation report source path and line where available. Invalid frontmatter, malformed MDX, unsupported imports, and unresolved declared references produce diagnostics; invalid source is marked unavailable rather than compiled as successful content.

## Local and static compilation

`compileDocument(source, options)` in `src/core/docs/index.js` strips and parses frontmatter, validates explicit imports, and compiles the remaining source into an ES module. The output is identical for `mode: 'local'` and `mode: 'static'`; the client receives the mode-specific artifact and asset resolvers from its host. Built-in components pass stable IDs and the exact `viewId` to those resolvers. Canvas prototype, site, image, and unsupported-widget fallback presentations go through the same `materializeCanvas` and `renderScene` path used by canvas views.

`Document` accepts `baseUrl` as the current page's absolute URL when a host needs to provide it explicitly. If omitted, the browser's current location is used. The component resolves root-relative and relative URLs returned by artifact and asset resolvers against that page URL at render time. The compiler output remains portable and contains no workstation origin. Hosts that render without a browser location must provide `baseUrl` for relative resolver URLs; unresolved or non-HTTP(S) values are shown as unavailable and reported as diagnostics.

The client entry `design-notebook/docs` (`src/client/docs/index.js`) exports the built-ins and `Document`. The host loads the compiled MDX module, then supplies its module component as `Content` along with the discovered document, artifact list, mode, and resolver functions:

```jsx
<Document
  Content={compiled.default}
  artifact={documentArtifact}
  artifacts={discovery.artifacts}
  mode="static"
  resolveArtifact={resolver.resolveArtifact}
  resolveAsset={resolver.resolveAsset}
  baseUrl={window.location.href}
/>
```

The compiler does not start a server, choose a navigation shell, or persist edits to notebook files. A React/Vite host supplies module loading and static artifact URLs; both modes use the same compiled module and component contract.
