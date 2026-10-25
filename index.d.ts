export type ArtifactKind = 'prototype' | 'canvas' | 'site' | 'doc'

export interface ArtifactDiagnostic {
  code: string
  message: string
  path: string
  field?: string
  line?: number
  severity?: 'error' | 'warning'
  id?: string
  paths?: string[]
  nestedArtifact?: { kind: ArtifactKind; path: string }
  containingArtifact?: { kind: ArtifactKind; path: string }
}

export interface DiscoveredArtifact {
  id: string | null
  kind: ArtifactKind
  title: string
  /** Directory path for directory artifacts; the containing ordinary group for Docs. */
  folderPath: string
  /** Artifact folder path or full `.doc.mdx` file path, relative to notebook root. */
  path: string
  /** Descriptor path, or Doc source path. */
  descriptorPath: string
  /** Filesystem payload path relative to notebook root. */
  payloadPath: string
  references: string[]
  /** Lossless parsed JSON descriptor, Doc frontmatter, or Canvas header. */
  descriptor: Record<string, unknown> | null
  /** Parsed authored views, retained for consumers that resolve view IDs. */
  views: Array<Record<string, unknown>>
  resolvedReferences: Array<{ id: string; kind: ArtifactKind; path: string }>
  diagnostics: ArtifactDiagnostic[]
  available: boolean
  runtime?: { id: '@dfosco/statefully'; version: '0.2.1' }
  entry?: string | null
  canvasStatus?: 'complete' | 'partial' | 'invalid'
  local?: Record<string, unknown> | null
  published?: Record<string, unknown> | null
}

export type NotebookEntry =
  | { type: 'group'; name: string; path: string; children: NotebookEntry[] }
  | { type: 'artifact'; artifact: DiscoveredArtifact }

export interface NotebookDiscovery {
  root: string
  entries: NotebookEntry[]
  artifacts: DiscoveredArtifact[]
  diagnostics: ArtifactDiagnostic[]
}

export const ARTIFACT_DIRECTORY_SUFFIXES: Readonly<Record<'prototype' | 'canvas' | 'site', string>>
export const NOTEBOOK_INFRASTRUCTURE_DIRECTORIES: ReadonlySet<string>

/** Discover typed artifacts and retain the ordinary directory groups. */
export function discoverNotebook(notebookRoot: string): NotebookDiscovery

/** Resolve a portable relative path from a notebook-root-relative base. */
export function resolveNotebookPath(root: string, basePath: string, relativePath: string): string

export interface PrototypeRouteLocation {
  pathname: string
  search: string
  params: Readonly<Record<string, string>>
  basePath: string
}

export interface PrototypeRouteBinding {
  getSnapshot(): PrototypeRouteLocation
  subscribe(listener: () => void): () => void
  navigate(destination: string): void
  dispose(): void
}

export function createPrototypeRouteBinding(options: { basePath: string; window?: Window }): PrototypeRouteBinding
export function prototypeRouteBasePath(id: string, options?: { mode?: 'local' | 'static'; base?: string; baseIsPrototypePrefix?: boolean }): string

export interface ArtifactPathMatch {
  status: 'matched' | 'not-found' | 'invalid' | 'ambiguous'
  artifact?: DiscoveredArtifact | Record<string, unknown>
  view?: Record<string, unknown> | null
  canonicalPath?: string
  legacy?: boolean
  diagnostics: Array<ArtifactDiagnostic | Record<string, unknown>>
}
export function buildArtifactPath(artifact: DiscoveredArtifact | Record<string, unknown>, options?: { base?: string; viewId?: string }): string
export function normalizeRouteBase(base?: string): string
export function parseArtifactPath(location: string | URL | { pathname: string; search?: string; hash?: string }, options?: { artifacts?: Array<DiscoveredArtifact | Record<string, unknown>>; base?: string }): ArtifactPathMatch
export function diagnoseArtifactRoutes(artifacts: Array<DiscoveredArtifact | Record<string, unknown>>, options?: { base?: string }): Array<ArtifactDiagnostic | Record<string, unknown>>
export const NOTEBOOK_RUNTIME_REFRESH_EVENT: string
export function createNotebookRuntime(options: { root: string; base?: string; host?: string; port?: number }): Promise<{
  root: string
  address: string
  start(): Promise<unknown>
  close(): Promise<void>
  getSnapshot(): NotebookDiscovery
  onRefresh(listener: (event: { file?: string; graph: NotebookDiscovery }) => void): () => void
  resolveArtifact(reference: string, options?: { kind?: ArtifactKind; viewId?: string; mode?: 'local' | 'static' }): Record<string, unknown>
  resolveAsset(reference: string, options?: { basePath?: string; mode?: 'local' | 'static' }): Record<string, unknown>
}>
export function buildNotebook(options: { root: string; outDir?: string; base?: string }): Promise<{
  root: string
  outDir: string
  base: string
  artifacts: DiscoveredArtifact[]
  entries: NotebookEntry[]
  graph: NotebookDiscovery
  diagnostics: ArtifactDiagnostic[]
  prototypes: Array<Record<string, unknown>>
}>

export function publishNotebook(options: {
  root: string
  outputRoot: string
  base?: string
  graph?: NotebookDiscovery
  prototypeResults?: Array<Record<string, unknown>>
}): Promise<{
  success: boolean
  outputRoot: string
  base: string
  graph: Omit<NotebookDiscovery, 'root'>
  diagnostics: ArtifactDiagnostic[]
  files: string[]
}>

export interface SiteViewProps {
  artifactId: string
  viewId?: string
  artifacts?: DiscoveredArtifact[]
  mode?: 'local' | 'static'
  resolveArtifact?: (reference: string, options: { kind?: ArtifactKind; viewId?: string; mode?: 'local' | 'static' }) => Record<string, unknown> | null
  resolveAsset?: (reference: string, options: Record<string, unknown>) => string | Record<string, unknown> | null
  onDiagnostic?: (diagnostic: ArtifactDiagnostic | Record<string, unknown>) => void
  className?: string
}

export function SiteView(props: SiteViewProps): import('react').ReactElement
