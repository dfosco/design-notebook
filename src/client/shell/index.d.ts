import type { ArtifactDiagnostic, ArtifactKind, DiscoveredArtifact, NotebookDiscovery } from '../../../index.js'

export interface NotebookShellProps {
  graph: NotebookDiscovery | null
  error?: string | null
  mode?: 'local' | 'static'
  baseUrl?: string
  /** Deployment mount path used for public artifact routes, for example `/preview/branch/`. */
  routeBase?: string
  resolveArtifact?: (reference: string, options: { kind?: ArtifactKind; viewId?: string; mode?: 'local' | 'static' }) => Record<string, unknown> | null
  resolveAsset?: (reference: string, options: Record<string, unknown>) => string | Record<string, unknown> | null
  loadCanvas?: (artifact: DiscoveredArtifact) => Promise<string | { source: string; revision?: string }>
  saveCanvasGeometry?: (request: {
    canvasId: string
    widgetId: string
    operation: 'move' | 'resize'
    position?: { x: number; y: number }
    width?: number
    height?: number
    revision?: string
  }) => Promise<{
    revision: string
    event: Record<string, unknown>
    geometry: { x: number; y: number; width: number; height: number }
  }>
  loadDocument?: (artifact: DiscoveredArtifact) => Promise<{ Content?: import('react').ComponentType; default?: import('react').ComponentType; diagnostics?: ArtifactDiagnostic[] }>
  customCssUrl?: string
  onDiagnostic?: (diagnostic: ArtifactDiagnostic | Record<string, unknown>) => void
  className?: string
}

export function NotebookShell(props: NotebookShellProps): import('react').ReactElement
