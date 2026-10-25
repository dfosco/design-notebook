import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NotebookShell } from 'design-notebook/shell'
import { resolveNotebookArtifact, resolveNotebookAsset } from './resolver.js'

const root = document.getElementById('design-notebook-root')
const reactRoot = root ? createRoot(root) : null

function RuntimeShell() {
  const [graph, setGraph] = useState(null)
  const [error, setError] = useState(null)
  const [revision, setRevision] = useState(0)
  const [customCssUrl, setCustomCssUrl] = useState(undefined)
  const refreshGeneration = useRef(0)
  const latestRevision = useRef(-1)
  const baseUrl = globalThis.location?.href ?? '/'

  const refreshGraph = useCallback(async nextRevision => {
    if (typeof nextRevision === 'number' && nextRevision < latestRevision.current) return
    if (typeof nextRevision === 'number') latestRevision.current = nextRevision
    const generation = ++refreshGeneration.current
    try {
      const [response, stylesheet] = await Promise.all([
        fetch('/__notebook/graph', { cache: 'no-store' }),
        fetch('/__notebook/notebook.css', { method: 'HEAD', cache: 'no-store' }),
      ])
      if (!response.ok) throw new Error(`Unable to read notebook graph (${response.status}).`)
      if (![200, 204].includes(stylesheet.status)) throw new Error(`Unable to read notebook.css (${stylesheet.status}).`)
      const next = await response.json()
      if (generation !== refreshGeneration.current) return
      setGraph(next)
      setError(null)
      setCustomCssUrl(stylesheet.status === 200 ? `/__notebook/notebook.css?revision=${nextRevision ?? 0}` : undefined)
      if (typeof nextRevision === 'number' && nextRevision >= latestRevision.current) setRevision(nextRevision)
    } catch (cause) {
      if (generation !== refreshGeneration.current) return
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => {
    refreshGraph(0)
    // Vite serializes HMR messages and awaits custom listener promises. Keep
    // graph loading detached so a slow request cannot block later revisions.
    const onRefresh = event => { void refreshGraph(event?.revision) }
    import.meta.hot?.on('design-notebook:refresh', onRefresh)
    return () => import.meta.hot?.off('design-notebook:refresh', onRefresh)
  }, [refreshGraph])

  const resolveArtifact = useCallback((reference, options = {}) => resolveNotebookArtifact(graph, reference, {
    ...options,
    mode: 'local',
    origin: globalThis.location?.origin ?? '',
  }), [graph])
  const resolveAsset = useCallback((reference, options = {}) => resolveNotebookAsset(graph, reference, {
    ...options,
    mode: 'local',
  }), [graph])
  const loadCanvas = useCallback(async artifact => {
    const response = await fetch(`/__notebook/artifacts/${encodeURIComponent(artifact.id)}/canvas`, { cache: 'no-store' })
    if (!response.ok) throw new Error(`Unable to load canvas ${artifact.id} (${response.status}).`)
    const revision = response.headers.get('etag')
    if (!revision) throw new Error(`Canvas ${artifact.id} did not provide a write revision.`)
    return { source: await response.text(), revision }
  }, [])
  const saveCanvasGeometry = useCallback(async ({ canvasId, widgetId, operation, position, width, height, revision }) => {
    const response = await fetch(`/__notebook/artifacts/${encodeURIComponent(canvasId)}/geometry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'if-match': revision },
      body: JSON.stringify({ widgetId, operation, ...(position ? { position } : {}), ...(width !== undefined ? { width } : {}), ...(height !== undefined ? { height } : {}) }),
      cache: 'no-store',
    })
    let result
    try { result = await response.json() } catch { result = { message: `Canvas geometry save failed (${response.status}).` } }
    if (!response.ok) {
      const error = new Error(result.message ?? `Canvas geometry save failed (${response.status}).`)
      error.status = response.status
      error.code = result.code
      error.revision = result.revision
      throw error
    }
    return result
  }, [])
  const loadDocument = useCallback(async artifact => {
    const moduleUrl = `/__notebook/artifacts/${encodeURIComponent(artifact.id)}/document.js?revision=${revision}`
    const loaded = await import(/* @vite-ignore */ moduleUrl)
    return { Content: loaded.default, diagnostics: loaded.designNotebookDiagnostics ?? [] }
  }, [revision])
  const reportDiagnostic = useCallback(diagnostic => {
    if (diagnostic?.severity === 'error') console.error('[Design Notebook]', diagnostic.message ?? diagnostic.code, diagnostic)
    else console.warn('[Design Notebook]', diagnostic?.message ?? diagnostic?.code ?? diagnostic)
  }, [])

  return React.createElement(NotebookShell, {
    graph,
    error,
    mode: 'local',
    baseUrl,
    routeBase: graph?.routeBase ?? '/',
    resolveArtifact,
    resolveAsset,
    loadCanvas,
    saveCanvasGeometry,
    loadDocument,
    customCssUrl,
    onDiagnostic: reportDiagnostic,
  })
}

if (reactRoot) reactRoot.render(React.createElement(RuntimeShell))
