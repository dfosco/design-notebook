import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { materializeCanvas } from '../../canvas-renderer/index.js'
import { InteractiveCanvas } from '../../vendor/tiny-canvas/interactive.js'
import { Document } from '../docs/index.js'
import { SiteView } from '../sites/index.js'
import { normalizeRouteBase, parseArtifactPath } from '../../core/runtime/notebook-routes.js'
import { artifactForSelection, artifactViews, firstArtifactSelection, selectionHref } from './model.js'
import { NotebookChrome } from '../../vendor/hypercanvas/NotebookShell/NotebookChrome.jsx'
import '../../vendor/tiny-canvas/upstream/tiny-canvas.css'
import '../../vendor/tiny-canvas/style.css'
import './style.css'

const EMPTY = Object.freeze([])

function currentUrl(fallback) {
  if (typeof globalThis.location?.href === 'string') return globalThis.location.href
  return typeof fallback === 'string' && fallback ? fallback : '/'
}

function parseShellRoute(value, artifacts, entries, routeBase) {
  let parsed
  try {
    parsed = parseArtifactPath(value, { artifacts, base: routeBase })
  } catch (error) {
    return { selection: null, status: 'invalid', diagnostics: [{ code: 'INVALID_ARTIFACT_ROUTE', message: error.message }] }
  }
  if (parsed.status === 'matched') {
    return {
      selection: { artifactId: parsed.artifact.id, ...(parsed.view ? { viewId: parsed.view.id } : {}) },
      status: parsed.status,
      diagnostics: parsed.diagnostics ?? [],
      canonicalPath: parsed.canonicalPath,
      legacy: parsed.legacy === true,
    }
  }

  // The notebook root is the one path that intentionally chooses a default.
  // All other unmatched or malformed routes stay visible instead of redirecting.
  try {
    const url = new URL(value, 'https://design-notebook.invalid')
    const root = normalizeRouteBase(routeBase).replace(/\/+$/, '') || '/'
    const path = url.pathname.replace(/\/+$/, '') || '/'
    const isRoot = path === root && !url.searchParams.has('artifact') && !url.searchParams.has('view')
    if (isRoot && parsed.status === 'not-found') {
      const selection = firstArtifactSelection(entries)
      const defaultPath = selectionHref({ artifacts }, routeBase, selection)
      const defaultRoute = defaultPath ? parseArtifactPath(defaultPath, { artifacts, base: routeBase }) : null
      if (!defaultRoute || defaultRoute.status !== 'matched') {
        return {
          selection: null,
          status: defaultRoute?.status ?? 'not-found',
          diagnostics: [...(parsed.diagnostics ?? []), ...(defaultRoute?.diagnostics ?? [])],
        }
      }
      return { selection, status: 'root', diagnostics: parsed.diagnostics ?? [] }
    }
  } catch {}
  return { selection: null, status: parsed.status, diagnostics: parsed.diagnostics ?? [] }
}

function RouteIssue({ route }) {
  if (!route || ['matched', 'root'].includes(route.status)) return null
  const label = route.status === 'not-found' ? 'Notebook route was not found.' : `Notebook route is ${route.status}.`
  return React.createElement('section', { className: 'notebook-shell__unavailable', role: 'status', 'data-route-status': route.status },
    React.createElement('h2', null, label),
    route.diagnostics?.length ? diagnosticList(route.diagnostics) : React.createElement('p', null, 'Check the artifact ID, view ID, and notebook base path.'),
  )
}

function diagnosticList(items) {
  return React.createElement('ul', { className: 'notebook-shell__diagnostics' }, items.map((item, index) => React.createElement('li', {
    key: `${item?.code ?? 'diagnostic'}-${item?.path ?? ''}-${index}`,
    'data-diagnostic-code': item?.code ?? '',
  }, `${item?.path ? `${item.path}: ` : ''}${item?.message ?? item?.code ?? 'Notebook diagnostic'}`)))
}

function AsyncPayload({ artifact, loader, children, missingMessage }) {
  const [state, setState] = useState({ key: '', artifact: null, loader: null, status: 'loading', value: null, error: null })
  const key = artifact?.id ?? ''
  useEffect(() => {
    let active = true
    if (!artifact) {
      setState({ key, artifact, loader, status: 'empty', value: null, error: null })
      return () => { active = false }
    }
    if (typeof loader !== 'function') {
      setState({ key, artifact, loader, status: 'unavailable', value: null, error: new Error(missingMessage) })
      return () => { active = false }
    }
    setState({ key, artifact, loader, status: 'loading', value: null, error: null })
    Promise.resolve().then(() => loader(artifact)).then(value => {
      if (active) setState({ key, artifact, loader, status: value == null ? 'unavailable' : 'ready', value, error: null })
    }, error => {
      if (active) setState({ key, artifact, loader, status: 'error', value: null, error })
    })
    return () => { active = false }
  }, [artifact, key, loader, missingMessage])

  if (state.key !== key || state.artifact !== artifact || state.loader !== loader || state.status === 'loading') return React.createElement('div', { className: 'notebook-shell__empty', role: 'status' }, 'Loading artifact…')
  if (state.status !== 'ready') return React.createElement('section', { className: 'notebook-shell__unavailable', role: 'status' },
    React.createElement('h2', null, state.status === 'error' ? 'Artifact could not be loaded' : 'Artifact content is unavailable'),
    React.createElement('p', null, state.error?.message ?? missingMessage),
    artifact?.diagnostics?.length ? diagnosticList(artifact.diagnostics) : null,
  )
  return children(state.value)
}

function normalizeHttpUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value, baseUrl)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function resolverForShell({ resolveArtifact, resolveAsset, artifacts, mode, baseUrl, artifact }, diagnostics) {
  return {
    mode,
    artifacts,
    resolveArtifact(reference, context = {}) {
      if (typeof resolveArtifact !== 'function') return null
      let result
      try { result = resolveArtifact(reference, { ...context, mode }) } catch (error) {
        diagnostics.push({ code: 'ARTIFACT_RESOLUTION_FAILED', severity: 'warning', message: error.message, reference })
        return null
      }
      if (!result || typeof result !== 'object') return null
      diagnostics.push(...(Array.isArray(result.diagnostics) ? result.diagnostics : []))
      if (result.available === false || context.kind === 'site' || result.url === undefined) return result
      const url = normalizeHttpUrl(result.url, baseUrl)
      if (!url) {
        const issue = { code: 'INVALID_RESOLVED_ARTIFACT_URL', severity: 'warning', reference, kind: context.kind, message: `Resolved ${context.kind ?? 'artifact'} URL for "${reference}" is not a valid HTTP(S) URL.` }
        diagnostics.push(issue)
        return { ...result, available: false, diagnostics: [...(result.diagnostics ?? []), issue] }
      }
      return { ...result, url }
    },
    resolveAsset(reference, context = {}) {
      if (typeof resolveAsset !== 'function') return null
      const basePath = context.basePath ?? context.artifact?.folderPath ?? artifact?.folderPath ?? ''
      let result
      try { result = resolveAsset(reference, { ...context, basePath, mode }) } catch (error) {
        diagnostics.push({ code: 'ASSET_RESOLUTION_FAILED', severity: 'warning', message: error.message, reference, basePath })
        return null
      }
      if (result?.available === false) {
        diagnostics.push(...(Array.isArray(result.diagnostics) ? result.diagnostics : []))
        return null
      }
      const value = typeof result === 'string' ? result : result?.url
      if (value == null) return null
      const url = normalizeHttpUrl(value, baseUrl)
      if (!url) {
        diagnostics.push({ code: 'INVALID_RESOLVED_ASSET_URL', severity: 'warning', reference, basePath, message: `Resolved asset URL for "${reference}" is not a valid HTTP(S) URL.` })
        return null
      }
      diagnostics.push(...(Array.isArray(result?.diagnostics) ? result.diagnostics : []))
      return url
    },
  }
}

function CanvasScene({ artifact, scene, diagnostics, mode, revision, saveCanvasGeometry, onDiagnostic }) {
  useEffect(() => {
    for (const diagnostic of diagnostics) onDiagnostic?.({ ...diagnostic, artifactPath: artifact.path })
  }, [artifact.path, diagnostics, onDiagnostic])
  return React.createElement(React.Fragment, null,
    React.createElement(InteractiveCanvas, { scene, canvasId: scene.canvasId, revision, mode, saveCanvasGeometry }),
    diagnostics.length ? diagnosticList(diagnostics) : null,
  )
}

function CanvasSurface({ artifact, graph, mode, baseUrl, resolveArtifact, resolveAsset, loadCanvas, saveCanvasGeometry, onDiagnostic }) {
  return React.createElement(AsyncPayload, { artifact, loader: loadCanvas, missingMessage: 'The host did not provide a canvas payload loader.' }, payload => {
    const source = typeof payload === 'string' ? payload : payload?.source
    const revision = typeof payload === 'object' && payload !== null ? payload.revision : undefined
    if (typeof source !== 'string') return React.createElement('div', { className: 'notebook-shell__unavailable', role: 'status' }, 'Canvas payload loader must return JSONL text or { source, revision }.')
    const diagnostics = []
    const options = resolverForShell({ resolveArtifact, resolveAsset, artifacts: graph?.artifacts ?? EMPTY, mode, baseUrl, artifact }, diagnostics)
    let materialized
    try { materialized = materializeCanvas(source, options) } catch (error) {
      return React.createElement('section', { className: 'notebook-shell__unavailable', role: 'status' }, 'Canvas replay failed.', React.createElement('p', null, error.message))
    }
    const allDiagnostics = [...materialized.diagnostics, ...diagnostics]
    if (materialized.status === 'invalid') return React.createElement('div', { className: 'notebook-shell__unavailable', role: 'status' }, 'Canvas replay is invalid. Source content is preserved.', diagnosticList(allDiagnostics))
    return React.createElement(CanvasScene, { artifact, scene: { ...materialized.scene, canvasId: materialized.canvasId }, diagnostics: allDiagnostics, mode, revision, saveCanvasGeometry, onDiagnostic })
  })
}

function PrototypeSurface({ artifact, viewId, mode, baseUrl, resolveArtifact, onDiagnostic }) {
  const resolved = useMemo(() => {
    let result = null
    try { result = resolveArtifact?.(artifact.id, { kind: 'prototype', viewId, mode }) ?? null } catch (error) {
      result = { available: false, diagnostics: [{ code: 'ARTIFACT_RESOLUTION_FAILED', message: error.message }] }
    }
    if (!result || typeof result !== 'object') result = { available: false, diagnostics: [{ code: 'UNAVAILABLE_ARTIFACT', message: `Prototype "${artifact.id}" could not be resolved.` }] }
    const url = result.available === false ? null : normalizeHttpUrl(result.url, baseUrl)
    return { ...result, url, available: result.available !== false && Boolean(url) }
  }, [artifact.id, viewId, mode, baseUrl, resolveArtifact])
  useEffect(() => {
    if (Array.isArray(resolved.diagnostics)) resolved.diagnostics.forEach(item => onDiagnostic?.(item))
  }, [resolved.diagnostics, onDiagnostic])

  if (artifact.available === false) return React.createElement(UnavailableArtifact, { artifact })
  if (!resolved.available) return React.createElement('section', { className: 'notebook-shell__unavailable', role: 'status' },
    React.createElement('h2', null, 'Prototype view is unavailable'),
    React.createElement('p', null, resolved.diagnostics?.[0]?.message ?? 'The runtime did not return a valid HTTP(S) view URL.'),
  )
  let sameOrigin = false
  try { sameOrigin = new URL(resolved.url).origin === new URL(baseUrl ?? globalThis.location?.href).origin } catch {}
  const sandbox = 'allow-scripts allow-forms allow-popups' + (sameOrigin ? ' allow-same-origin' : '')
  return React.createElement('iframe', {
    // A host-selected view is a new notebook route, not an iframe navigation
    // entry in the browser's joint session history. Remounting drops the old
    // child history so Back/Forward stays aligned with the shell URL.
    key: `${artifact.id}:${resolved.url}`,
    className: 'notebook-shell__prototype-frame',
    src: resolved.url,
    title: `${artifact.title}${resolved.viewId ? `: ${artifactViews(artifact).find(view => view.id === resolved.viewId)?.title ?? resolved.viewId}` : ''}`,
    loading: 'lazy',
    referrerPolicy: 'no-referrer',
    sandbox,
  })
}

function UnavailableArtifact({ artifact }) {
  return React.createElement('section', { className: 'notebook-shell__unavailable', role: 'status' },
    React.createElement('h2', null, `${artifact?.kind ?? 'Artifact'} is unavailable`),
    artifact?.diagnostics?.length ? diagnosticList(artifact.diagnostics) : React.createElement('p', null, 'Discovery marked this artifact unavailable.'),
  )
}

function viewControls(artifact, selectedViewId, onViewChange) {
  const views = artifactViews(artifact)
  if (!views.length) return null
  const value = selectedViewId ?? views[0].id
  const selectedViewExists = views.some(view => view.id === value)
  return React.createElement('label', { className: 'notebook-shell__view-select' }, 'View', React.createElement('select', {
    value,
    onChange: event => onViewChange(event.target.value),
  }, !selectedViewExists ? React.createElement('option', { value, key: `missing-${value}`, disabled: true }, `Unavailable view: ${value}`) : null,
  views.map(view => React.createElement('option', { value: view.id, key: view.id }, view.title || view.id))))
}

function LoadedDocument({ result, artifact, graph, mode, baseUrl, resolveArtifact, resolveAsset, onDiagnostic }) {
  useEffect(() => {
    for (const diagnostic of result?.diagnostics ?? []) onDiagnostic?.(diagnostic)
  }, [result?.diagnostics, onDiagnostic])
  const Content = result?.Content ?? result?.default
  if (!Content) return React.createElement('section', { className: 'notebook-shell__unavailable', role: 'status' }, 'Compiled document module is unavailable.', result?.diagnostics?.length ? diagnosticList(result.diagnostics) : null)
  return React.createElement(Document, { Content, artifact, artifacts: graph?.artifacts ?? EMPTY, mode, baseUrl, resolveArtifact, resolveAsset, onDiagnostic })
}

function RenderArtifact({ artifact, selection, graph, mode, baseUrl, resolveArtifact, resolveAsset, loadCanvas, saveCanvasGeometry, loadDocument, onDiagnostic }) {
  if (!artifact) return React.createElement('div', { className: 'notebook-shell__empty', role: 'status' }, selection?.artifactId ? `No discovered artifact has ID "${selection.artifactId}".` : 'Select an artifact to review it.')
  if (artifact.available === false) return React.createElement(UnavailableArtifact, { artifact })
  const views = artifactViews(artifact)
  const viewId = selection?.viewId ?? views[0]?.id
  if (artifact.kind === 'prototype') return React.createElement(PrototypeSurface, { artifact, viewId, mode, baseUrl, resolveArtifact, onDiagnostic })
  if (artifact.kind === 'site') return React.createElement(SiteView, { artifactId: artifact.id, viewId, artifacts: graph?.artifacts ?? EMPTY, mode, resolveArtifact, resolveAsset, onDiagnostic })
  if (artifact.kind === 'canvas') return React.createElement(CanvasSurface, { artifact, graph, mode, baseUrl, resolveArtifact, resolveAsset, loadCanvas, saveCanvasGeometry, onDiagnostic })
  if (artifact.kind === 'doc') return React.createElement(AsyncPayload, { artifact, loader: loadDocument, missingMessage: 'The host did not provide a document module loader.' }, result => React.createElement(LoadedDocument, { result, artifact, graph, mode, baseUrl, resolveArtifact, resolveAsset, onDiagnostic }))
  return React.createElement('section', { className: 'notebook-shell__unavailable', role: 'status' }, `Unsupported artifact kind: ${String(artifact.kind)}`)
}

/** Package-owned shell. The host supplies discovery data, loaders, and URL resolvers. */
export function NotebookShell({ graph, error, mode = 'local', baseUrl, routeBase = '/', resolveArtifact, resolveAsset, loadCanvas, saveCanvasGeometry, loadDocument, customCssUrl, onDiagnostic, className = '' }) {
  const entries = Array.isArray(graph?.entries) ? graph.entries : EMPTY
  const artifacts = Array.isArray(graph?.artifacts) ? graph.artifacts : EMPTY
  const initialRoute = useMemo(() => parseShellRoute(currentUrl(baseUrl), artifacts, entries, routeBase), [baseUrl, artifacts, entries, routeBase])
  const [route, setRoute] = useState(initialRoute)
  const selection = route.selection
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const effectiveBaseUrl = currentUrl(baseUrl)
  useEffect(() => {
    const syncRoute = () => {
      const next = parseShellRoute(currentUrl(baseUrl), artifacts, entries, routeBase)
      if (next.status === 'matched' && next.canonicalPath && globalThis.history?.replaceState) {
        const current = globalThis.location ? `${globalThis.location.pathname}${globalThis.location.search}${globalThis.location.hash}` : ''
        if (current !== next.canonicalPath) globalThis.history.replaceState({}, '', next.canonicalPath)
      }
      setRoute(next)
    }
    syncRoute()
    const handlePopState = () => syncRoute()
    globalThis.addEventListener?.('popstate', handlePopState)
    return () => globalThis.removeEventListener?.('popstate', handlePopState)
  }, [baseUrl, routeBase, artifacts, entries])
  const selected = artifactForSelection(graph, selection)
  const selectedViewId = selection?.viewId ?? artifactViews(selected)[0]?.id
  const selectedPath = selected?.folderPath ?? selected?.path ?? ''
  const diagnostics = graph?.diagnostics ?? EMPTY
  const resolvedCustomCss = customCssUrl ? normalizeHttpUrl(customCssUrl, effectiveBaseUrl) : null

  const makeHref = useCallback(next => selectionHref(graph, routeBase, next), [graph, routeBase])
  const navigate = useCallback(next => {
    const href = selectionHref(graph, routeBase, next)
    const parsed = href ? parseShellRoute(href, artifacts, entries, routeBase) : null
    if (!parsed || parsed.status !== 'matched') return
    setRoute(parsed)
    if (href && globalThis.history?.pushState && globalThis.location) globalThis.history.pushState({}, '', href)
  }, [graph, routeBase, artifacts, entries])
  const selectView = useCallback(viewId => navigate({ artifactId: selected?.id, viewId }), [navigate, selected?.id])
  const body = React.createElement(React.Fragment, null,
    resolvedCustomCss ? React.createElement('link', { rel: 'stylesheet', href: resolvedCustomCss, 'data-notebook-custom-css': '' }) : null,
      error ? React.createElement('section', { className: 'notebook-shell__unavailable', role: 'alert' }, React.createElement('h2', null, 'Notebook could not be loaded'), React.createElement('p', null, error.message ?? String(error))) : null,
      React.createElement(RouteIssue, { route }),
      diagnostics.length ? React.createElement('details', { className: 'notebook-shell__graph-diagnostics' },
        React.createElement('summary', null, `${diagnostics.length} notebook diagnostic${diagnostics.length === 1 ? '' : 's'}`), diagnosticList(diagnostics)) : null,
      React.createElement(RenderArtifact, { artifact: selected, selection, graph, mode, baseUrl: effectiveBaseUrl, resolveArtifact, resolveAsset, loadCanvas, saveCanvasGeometry, loadDocument, onDiagnostic }))
  const toolbarExtras = selected && (selected.kind === 'prototype' || selected.kind === 'site')
    ? viewControls(selected, selectedViewId, selectView)
    : null

  return React.createElement(NotebookChrome, {
    graph,
    selected,
    selectedViewId,
    activePath: selectedPath,
    makeHref,
    onSelect: navigate,
    sidebarOpen,
    onSidebarOpenChange: setSidebarOpen,
    onBack: () => globalThis.history?.back(),
    onForward: () => globalThis.history?.forward(),
    trailing: toolbarExtras,
    mode,
    className: `notebook-shell ${className}`.trim(),
    children: body,
  })
}

export const NOTEBOOK_SHELL_IMPORT_PATH = 'design-notebook/shell'
