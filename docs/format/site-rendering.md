# Rendering discovered Sites

The `design-notebook/sites` entry exports `SiteView`, a reusable view for a Site already found by notebook discovery. It uses the same canvas materializer and renderer as canvas and document embeds. It does not discover files or start the external Site for you. The host supplies the discovered artifacts and resolution functions:

```jsx
import { SiteView } from 'design-notebook/sites'

<SiteView
  artifactId="existing-catalog"
  viewId="home"
  artifacts={artifacts}
  mode="local"
  resolveArtifact={resolveArtifact}
  resolveAsset={resolveAsset}
/>
```

`artifactId` is the stable ID from the Site descriptor. `viewId` selects an authored view exactly. If it is omitted, the host's selected view is used. An explicit ID that is missing does not fall back to another view. `mode` is `local` or `static`. The resolver callbacks use the same arguments as the canvas renderer: artifact resolution receives the reference and `{ kind, placement, viewId, artifacts, mode }`; asset resolution receives the reference and context including `purpose`, `artifact`, `view`, `basePath`, and `mode`. For a Site screenshot, `basePath` is the discovered Site folder path, so the host can validate and resolve the screenshot from that folder.

## Local view

In local mode, a resolved local development URL can appear in a sandboxed iframe. The renderer also shows the authored screenshot and an open-link control. The link remains useful when a Site blocks framing or its local server is unavailable. An iframe load event is not treated as proof that the Site is healthy, and `SiteView` does not launch or manage the Site's server.

When no view-specific URL exists, the authored `view.path` is resolved against the descriptor's local or published base URL. Query strings and fragments in the path are preserved, and resolution must remain on the base URL's origin. A view's `localUrl` or `publishedUrl` takes precedence over the corresponding descriptor base and `path`; that direct URL is used as authored, including its query and fragment.

## Static view

Static mode renders the screenshot and a link to the deployed destination. It does not render an iframe or include a local development URL. A missing screenshot or deployed destination is reported as unavailable. Localhost, loopback, `.local`, and other machine-local published destinations are rejected.

Screenshot paths returned by the host can be root-relative. The renderer resolves those paths against the current document URL, so generated pages do not need a workstation-specific origin.

## Unavailable references

An absent or unavailable Site, a missing explicit view, an unresolved screenshot, or an invalid destination produces a visible fallback and a diagnostic. A Site descriptor can be useful without its source project: discovery can still expose its title, authored views, screenshots, and deployed links. A descriptor-only Site has no local iframe URL, but its screenshot and link remain available when supplied.
