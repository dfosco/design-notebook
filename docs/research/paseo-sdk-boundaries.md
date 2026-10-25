# Paseo SDK boundaries: research for Design Notebook clients

## Finding

Paseo’s TypeScript SDK is a client for a daemon that owns agents, workspaces,
provider processes, persistence and live events. It is an orchestration API, not
a general UI toolkit or a file-backed content-system SDK. Its public package
offers typed client handles over a versioned WebSocket protocol. The first-party
app imports lower-level internal APIs, and its host runtime selects among
multiple transports. The inspected source does not state why the app uses those
internal entry points. That distinction is useful for Design Notebook: build a
small client contract around notebook data,
references, capabilities and change delivery; keep framework-specific rendering
and prototype build/runtime integration separate.

The current Design Notebook direction already supports that separation: the
default core and client ship together, alternative clients can consume the core
contract, and an independent implementation can consume the notebook format
directly. A client framework change should not require a prototype framework
change. A prototype framework or build change crosses the core boundary only
where it changes process lifecycle, URL/asset resolution, route discovery or
publishable output. The research does not support starting with a renderer
plugin system or a family of framework-specific client packages.

## Source and inspection basis

| Source | Identity and basis |
| --- | --- |
| Paseo monorepo | `getpaseo/paseo`, public GitHub repository, `main` resolved read-only to commit [`59b01b33f1e58a4cfd7f55142d3ef51d95145784`](https://github.com/getpaseo/paseo/commit/59b01b33f1e58a4cfd7f55142d3ef51d95145784) with `git ls-remote` on 2026-10-23. Source and documentation below were read at that immutable commit. No local clone was available, so there is no local dirty diff to report; upstream working-tree state is not observable from the public commit. |
| Monorepo package versions | At that commit, `packages/client`, `packages/protocol`, `packages/server`, and `packages/app` each declare `0.13.0-beta.1`: [`client/package.json`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/package.json#L1-L25), [`protocol/package.json`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/protocol/package.json#L1-L18), [`server/package.json`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/package.json#L1-L25), and [`app/package.json`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/app/package.json#L1-L20). |
| Supplied local candidate | The checkout named `paseo-defer` is a separate plugin repository, not the Paseo app/core. Its remote is `tomgrin10/paseo-defer`, package name/version are `paseo-defer@2.4.0`, and it was clean at commit `5ac9865b0166ab5acb9556e78e3efdde585055d1`. It was excluded as evidence for Paseo internals. |
| Design Notebook context | Read the current `DESIGN-NOTEBOOK.md` (read-only). Its core/client, notebook-owned prototype versus external site, static publishing, routing, and “Client SDK scope” sections inform the recommendations below; the document remains a working design, not an implemented contract. |

The report is static-source research. No Paseo daemon or app runtime was started,
and no behavior is claimed as runtime-validated.

## Responsibility and API inventory

| Layer | Observed responsibility and contract | What it does not provide |
| --- | --- | --- |
| `@getpaseo/client` public root | `createPaseoClient(config)` creates a high-level facade over `DaemonClient`; it owns connection/close and connection-state methods. The facade exposes agent, workspace, project, provider, terminal, host and config actions. See [`index.ts`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/index.ts#L512-L532) and [`PaseoApi`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/index.ts#L480-L512). | Notebook artifacts, generic filesystem watch, document/canvas rendering, UI state, or a build system. |
| `@getpaseo/client/node` | The package export map contains a Node-only `./node` entry. Its source exports `createHostClient` (which returns the lower-level `DaemonClient`), `createHostTransportFactory`, `createHostChannelTransport`, `parseHostTarget`, SSH tunnel helpers and `HostTransportBudget`. [`package.json` exports](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/package.json#L11-L35), [`node/index.ts` exports](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/node/index.ts#L1-L23), [`createHostClient`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/node/index.ts#L192-L204). | This is an actual package export, but the README names the root as the supported public API and the reviewed docs make no explicit stability promise for `/node`. Do not infer the root API's support guarantee for this entry from its export-map presence. |
| `@getpaseo/client/internal/*` | Export map includes internal daemon-client and transport subpaths. The package README explicitly calls these unsupported implementation details. [`package.json`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/package.json#L9-L25), [`README`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/README.md#L27-L44). | Not an explicitly supported basis for third-party app code. Do not copy an internal import merely because the first-party app uses it. |
| `@getpaseo/protocol` | Shared Zod schemas and TypeScript types define discriminated WebSocket message envelopes, request/result payloads, event payloads, IDs, cursors and capability data. `SessionInboundMessageSchema` is a discriminated union; the server validates incoming WebSocket envelopes and the client validates outbound messages. [`messages.ts`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/protocol/src/messages.ts#L3234-L3262), [`outbound validator`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/protocol/src/validation/ws-outbound.ts#L39-L52), [`server inbound validation`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/websocket-server.ts#L2487-L2502). | App rendering or app cache behavior. The protocol is the transport contract, not a product UI abstraction. |
| `@getpaseo/server` daemon | Owns agent/workspace state, provider sessions and process lifecycle, disk persistence, request authorization/handling, WebSocket connection admission and event delivery. The agent storage scans JSON records from daemon-owned directories; `AgentManager` tracks active sessions and subscriptions. [`AgentStorage`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/agent/agent-storage.ts#L97-L121), [`disk scan/read`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/agent/agent-storage.ts#L316-L378), [`request dispatch`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/session.ts#L2844-L2887). | A browser-side authoring model. The app is a consumer of daemon capabilities and applies product-specific policies and state. |
| `packages/app` first-party app | Owns routes, presentation, query cache, local state and platform-specific connection setup. It imports `DaemonClient` and host transport from internal SDK subpaths and separately imports public subscription types. [`host-runtime.ts`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/app/src/runtime/host-runtime.ts#L1-L25). | Its use of an internal entry point is an observed dependency. The inspected source does not establish the reason for that choice or make it public API guidance. |

The SDK README says modern browsers and Node.js 22 provide a global WebSocket
implementation, and documents a daemon endpoint ending in `/ws`. The supported
`PaseoClientConfig` includes URL, password/auth header, connection timeout and
reconnect settings, but does not expose `webSocketFactory`. The lower-level
`DaemonClientConfig` does expose `webSocketFactory` and `transportFactory`; these
are lower-level configuration fields, not fields on the supported high-level
config. [`PaseoClientConfig`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/index.ts#L87-L109), [`DaemonClientConfig`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/daemon-client.ts#L401-L430), [`client README`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/README.md#L31-L40), [`client config reference`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/public-docs/sdk/reference.md#L15-L44). The public SDK handles its supported connection lifecycle, typed request correlation, reconnection and owned subscriptions; the server remains the authority for permissions, supported capabilities and durable data. The app's host runtime constructs the internal client with custom transport factories for its connection modes. [`host-runtime.ts`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/app/src/runtime/host-runtime.ts#L575-L686).

The public SDK does not prescribe React, Expo or another rendering framework.
Its supported transport assumes a host-provided global WebSocket and a daemon
endpoint; the public high-level config does not expose a custom WebSocket
factory. App-specific transports are visible through internal APIs. React Query,
Zustand and the app's session reducers belong to the first-party UI, not to
`@getpaseo/client`; the app directly maps stream events into those stores.
[`session-context.tsx`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/app/src/contexts/session-context.tsx#L480-L540).

## Representative request and event paths

### Query: agent directory

1. A public SDK call `client.agents.list(options)` becomes
   `DaemonClient.fetchAgents(options)`. Without subscription it correlates a
   request ID with `fetch_agents_response`; with `subscribe: {}` it creates an
   owned observation and returns its initial snapshot. [`facade`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/index.ts#L695-L715), [`low-level fetch`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/daemon-client.ts#L2648-L2679).
2. The wire request is typed with filters, sorting, pagination and optional
   subscription fields. [`FetchAgentsRequestMessageSchema`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/protocol/src/messages.ts#L1263-L1285).
3. The daemon creates delivery ownership when requested, obtains a snapshot from
   its agent directory, emits `fetch_agents_response`, then flushes buffered
   updates so the initial state precedes changes. Errors release the observation
   and emit an RPC error. [`handleFetchAgents`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/session.ts#L6226-L6290).

This is a useful pattern for a notebook read API: typed query parameters, one
consistent snapshot, and an explicitly owned, releasable subscription. It does
not establish that Design Notebook needs remote pagination or WebSockets. A
Node client could call a documented in-process core API; a browser frontend
would need a browser/server boundary, such as HTTP or WebSocket. Keep the query,
snapshot and subscription semantics independent of which transport carries them.

### Mutation: create and message an agent

1. `client.agents.create(options)` is a public façade over daemon client
   creation. It normalizes the provider/model configuration, then builds a
   typed request. [`create facade`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/index.ts#L602-L614), [`create request`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/daemon-client.ts#L3166-L3235), [`request schema`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/protocol/src/messages.ts#L1732-L1760).
2. The server validates creation intent, creates or loads the daemon-owned
   session, and emits a correlated created/failed status. [`create handler`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/session.ts#L4290-L4355).
3. `agent.send(text)` sends a typed mutation request with a generated request
   ID and deduplication message ID. The server resolves the agent, constructs
   the prompt and dispatches it through its agent manager/message queue; it
   returns acceptance or an error. [`SDK send`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/daemon-client.ts#L3763-L3812), [`wire schema`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/protocol/src/messages.ts#L1385-L1399), [`server handler`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/session.ts#L8209-L8270).

The SDK presents daemon-specific mutations as handles and errors rather than
exposing the raw protocol to ordinary callers. For Design Notebook, make the
parallel API describe notebook operations such as resolving an artifact or
writing an explicitly supported placement operation. Do not let the existence
of an API method imply a capability that the active core cannot honor.

### Event/subscription: live timeline

1. The SDK's `agent.timeline.subscribe(handler)` starts an observation and
   returns a releasable subscription; `ready` confirms initial observation
   establishment. It forwards timeline, restored, error and replacement events.
   [`timeline handle`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/index.ts#L909-L940).
2. The daemon stores timeline ownership and forwards stream events only to
   matching subscriptions. [`subscription and forwarding`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/session.ts#L1332-L1385).
3. Reconnect restores live delivery but does not replay history. The consumer
   must explicitly refetch and reconcile by epoch/sequence. This is documented,
   not inferred from behavior. [`events guide`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/public-docs/sdk/events.md#L45-L80).
4. The app uses lower-level `observeEvents` and feeds events directly into its
   caches/stores. This app-owned mapping is a concrete example of reactive UI
   state sitting above the SDK. [`session-context.tsx`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/app/src/contexts/session-context.tsx#L402-L420), [`event feeds`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/app/src/contexts/session-context.tsx#L480-L540).

## Limits and lessons

- **Public API versus first-party internals:** public root methods are supported;
  internal imports are explicitly unsupported. The first-party app's internal
  `DaemonClient` import exists alongside its own transport and state layer. A
  new Design Notebook client SDK should avoid making the default client itself
  the only usable API surface.
- **Runtime and process ownership:** the daemon owns provider processes,
  agent/workspace lifecycle and persistence. The high-level root client holds a
  connection and subscription handles; it does not own those durable resources.
  The Node-only connector can also own transport resources: its SSH helper
  spawns an `ssh` child process and closes that process, socket and local server
  during teardown. [`SSH tunnel helper`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/node/ssh-tunnel.ts#L28-L53), [`Node transport teardown`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/node/index.ts#L22-L68). Shutdown and disposal should release owned observers and connection resources, while archive/delete semantics remain separate explicit operations.
- **Filesystem:** the source shows agent records persisted and parsed by the
  daemon. App protocol includes a subscribed `fs.file.update` event, but that is
  a daemon/workspace file surface, not a general artifact watch contract.
  [`agent storage`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/server/src/server/agent/agent-storage.ts#L316-L378), [`file event schema`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/protocol/src/messages.ts#L6155-L6161).
- **Validation:** protocol schemas validate transport shape and parse selected
  payloads, while domain rules and permissions run in daemon handlers. A
  notebook SDK should validate portable format data at the core boundary and
  expose diagnostics, but preserve unknown extensions where the format allows.
- **Transport and auth:** Paseo solves remote client-to-daemon connectivity,
  authentication, capability negotiation and reconnect. Design Notebook's
  first local-only core does not need that level of remote host/relay machinery.
  Keep its public client API transport-neutral enough for an alternative UI,
  while deferring remote access and auth until there is a product requirement.
- **Reconnect and cancellation:** Paseo distinguishes request correlation,
  mutation acceptance, subscription readiness, cancellation and reconnection.
  Timeline subscriptions restore membership but can miss history; clients must
  refetch. At this commit, the public `PaseoAgentHandle` has `run()`,
  `waitForFinish()`, `archive()` and `detach()`, but no `cancel()` method; the
  lower-level client has `cancelAgent()`. Cancellation therefore exists in the
  wire/client internals, but is not part of this high-level handle contract.
  [`public handle`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/index.ts#L347-L388), [`low-level cancellation`](https://github.com/getpaseo/paseo/blob/59b01b33f1e58a4cfd7f55142d3ef51d95145784/packages/client/src/daemon-client.ts#L3856-L3888).
  A notebook change feed should define its own cursor, snapshot race rules and
  disposal contract before exposing live updates.
- **App and framework state:** routing, rendering, stores, cache invalidation and
  interaction policy sit in the app. These are client responsibilities. The
  SDK boundary should exchange schemas and resolved references, not React
  components or framework hooks.

Not every behavior was traced through every provider adapter. The source/API
allows architecture conclusions about daemon ownership and protocol flow, but
this report does not claim provider-specific subprocess behavior, complete
filesystem-watch semantics, or runtime compatibility on every host.

## Design Notebook client options

### Option A — bundled core and default client, with a small client API

Keep the proposed `design-notebook` npm package as the one-command experience.
Give the core a stable schema/data/operation contract. A Node client may call a
documented in-process API. A browser client needs a browser/server boundary,
such as a local HTTP or WebSocket transport. These can carry the same contract
semantics; transport is a separate choice. This matches the current plan without
requiring separately branded framework packages.

### Option B — format-only independent clients

An independent client can read the notebook format directly and render portable
content without running the reference core. It can work on static published
output or provide its own runtime. It must follow the schema, path, ID,
capability-fallback and unknown-data rules. It will not automatically gain local
prototype supervision, watch notifications or built-in URL resolution.

### Option C — prototype runtime/build integrations

Treat an alternate framework for a notebook-owned prototype as a core adapter
capability only when the core must start/supervise it, discover its URL,
understand route/view output, or consume its static build products. A minimal
adapter contract would report supported local run and publish modes, readiness,
resolved base URL, route/view map, output directory/assets and structured build
diagnostics. Keep its implementation outside the notebook-client renderer.
Defer adapter discovery/installation and plugin management until a second
supported stack justifies them.

**Recommendation:** start with Option A and keep Option B available at the file
format boundary. Defer Option C beyond the first default-stack notebook-owned
prototype. An existing Next.js or Svelte application can be an external site;
its local directory, URL, deployed URL, screenshots and views are references,
not files the notebook client imports or builds. If the user replaces the
notebook client framework, that is a client routing/rendering change so long as
the client can consume the same notebook schemas, references and data contract.
If they replace the prototype's framework, route behavior or build pipeline,
that is a core/runtime integration when it changes runtime URLs, process
lifecycle, asset bases, route discovery or static output. A client framework
replacement does not by itself require prototype adapter support.

### Minimal illustrative interface (proposal, not an approved API)

```ts
type ArtifactRef = { artifactId: string; viewId?: string };

interface NotebookSnapshot {
  formatVersion: string;
  revision: string;
  artifacts: readonly ArtifactSummary[];
  views: readonly ArtifactView[];
  placements: readonly Placement[];
  diagnostics: readonly Diagnostic[];
}

interface NotebookClient {
  readSnapshot(): Promise<NotebookSnapshot>;
  resolve(ref: ArtifactRef): Promise<ResolvedArtifactView>;
  capabilities(): Promise<NotebookCapabilities>;
  subscribe(options?: { after?: string }): NotebookSubscription;
  close(): Promise<void>;
}

interface NotebookSubscription {
  ready: Promise<{ snapshot: NotebookSnapshot; cursor: string }>;
  onChange(listener: (change: NotebookChange) => void): () => void;
  close(): Promise<void>;
}
```

The proposal intentionally has no framework components, editor widgets,
renderer registry or prototype bundler API. `resolve()` returns data and a
portable/local representation reference, not a UI node. `subscribe()` needs a
snapshot-plus-cursor handshake so an external editor save cannot fall between
the initial read and watcher registration. It should report file-originated
changes and validation diagnostics distinctly from client-issued operations.
If direct editing is later included, expose named, capability-checked
operations with conflict/version information; do not make arbitrary file writes
part of the initial viewer contract.

### Live and static modes

The local core can answer a live snapshot and resolve development URLs for
notebook-owned prototypes and local sites. External file changes should update
the notebook revision, emit changed artifact/reference IDs and refresh
validation diagnostics. A snapshot/subscription handshake should avoid lost
changes; duplicate or coalesced notifications should be safe because clients
can reread the snapshot.

Published output has no running Node process. It needs the same artifact/view
meaning in a generated, versioned manifest plus assets and resolved portable
representations. A static client should read that manifest and render without
live mutations, local paths, localhost URLs or daemon-only capabilities. Site
views publish screenshots and links to the separate deployment. Prototype
build output is included only when the declared runtime can produce supported
static output. Represent unsupported/private capabilities through explicit
diagnostics or portable fallbacks, preserving saved identity and unknown data.

## Decisions to make next

1. Define the notebook manifest and artifact/view/placement schemas, including
   stable IDs, path bases, schema evolution and unknown-field round-tripping.
2. Choose the initial core/client call boundary: an in-process Node API for Node
   consumers, a browser/server transport for browser clients, or both. Keep the
   data contract independent of transport and client framework.
3. Decide whether the first client SDK is read-only. If writes are included,
   list only concrete operations and define external-editor conflict behavior.
4. Define a change cursor and race-free live snapshot/subscription semantics for
   filesystem changes and validation updates.
5. Define live versus published artifact resolution and the static manifest's
   compatibility rules.
6. Specify the first prototype's route and asset-base contract. Revisit
   adapters only when another notebook-owned stack is an actual requirement;
   keep external sites as references.
7. Decide how alternative clients learn unavailable capabilities and represent
   private components without losing saved notebook data.
