import React, { createContext, useContext, useEffect, useId, useMemo, useRef } from 'react'
import { materializeCanvas } from '../../canvas-renderer/index.js'
import { renderScene } from '../../vendor/tiny-canvas/index.js'
import { documentCanvasScene } from './render-scene.js'
import './style.css'

const DocumentContext = createContext(null)

function unavailable(message) {
  return React.createElement('div', { className: 'doc-widget__unavailable', role: 'status' }, message)
}

function initialWidgetMessage(item) {
  if (!item) return 'This embedded view is unavailable.'
  if (item.kind === 'image' && !item.src) return 'Image source is unavailable.'
  if (item.kind === 'frame' && !item.src) return 'Prototype view is unavailable.'
  if (item.kind === 'site' && !item.src && !item.href) return 'Site view and destination are unavailable.'
  if (!['text', 'image', 'frame', 'site'].includes(item.kind)) {
    return item.fallback?.type === 'text' ? `Unsupported widget fallback: ${item.fallback.text}` : 'Unsupported widget content is unavailable.'
  }
  return null
}

function normalizeResolvedUrl(value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null
  const pageUrl = baseUrl ?? globalThis.location?.href
  if (typeof pageUrl !== 'string' || !pageUrl.trim()) return null
  try {
    const url = new URL(value, pageUrl)
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

function resolverOptions(context, diagnostics) {
  const { artifact, artifacts, mode, resolveArtifact, resolveAsset, baseUrl } = context
  const artifactById = new Map((artifacts ?? []).map(item => [item.id, item]))
  return {
    mode,
    artifacts,
    resolveArtifact(reference, { kind, viewId }) {
      if (typeof resolveArtifact !== 'function') return null
      let result
      try { result = resolveArtifact(reference, { kind, viewId, mode }) } catch { return null }
      if (!result || typeof result !== 'object') return null
      for (const item of Array.isArray(result.diagnostics) ? result.diagnostics : []) diagnostics.push({ ...item, reference, kind })
      const known = artifactById.get(result.id ?? reference)
      if (result.available === false) return result
      if (kind === 'site') return { ...result, folderPath: known?.folderPath ?? '', descriptor: result.descriptor ?? known?.descriptor }
      if (result.url !== undefined) {
        const url = normalizeResolvedUrl(result.url, baseUrl)
        if (!url) {
          diagnostics.push({ code: 'INVALID_RESOLVED_ARTIFACT_URL', severity: 'warning', reference, kind, message: `Resolved ${kind} URL for "${reference}" is not a valid HTTP(S) URL in this document context.` })
          return { ...result, available: false, url: null }
        }
        return { ...result, url }
      }
      return result
    },
    resolveAsset(reference, { artifact: referencedArtifact } = {}) {
      if (typeof resolveAsset !== 'function') return null
      const basePath = referencedArtifact?.folderPath ?? artifact?.folderPath ?? ''
      try {
        const result = resolveAsset(reference, { basePath, mode })
        for (const item of Array.isArray(result?.diagnostics) ? result.diagnostics : []) diagnostics.push({ ...item, reference, basePath })
        const value = typeof result === 'string' ? result : result?.available === false ? null : result?.url
        if (value == null) return null
        const url = normalizeResolvedUrl(value, baseUrl)
        if (!url) diagnostics.push({ code: 'INVALID_RESOLVED_ASSET_URL', severity: 'warning', reference, basePath, message: `Resolved asset URL for "${reference}" is not a valid HTTP(S) URL in this document context.` })
        return url
      } catch { return null }
    },
  }
}

function CanvasPrimitive({ type, props, fallbackType, className = '' }) {
  const context = useContext(DocumentContext)
  const container = useRef(null)
  const reactId = useId()
  const widgetId = typeof props.id === 'string' && props.id.trim() ? props.id : `doc-${reactId}`
  const materialized = useMemo(() => {
    const resolverDiagnostics = []
    const source = JSON.stringify({
      event: 'canvas_created',
      formatVersion: 1,
      canvasId: 'document-view',
      widgets: [{ id: widgetId, type, position: { x: 0, y: 0 }, props }],
    })
    const result = materializeCanvas(source, resolverOptions(context ?? { mode: 'local' }, resolverDiagnostics))
    if (!resolverDiagnostics.length) return result
    const diagnostics = [...result.diagnostics, ...resolverDiagnostics]
    return {
      ...result,
      diagnostics,
      scene: {
        ...result.scene,
        notices: [...result.scene.notices, ...resolverDiagnostics.map(item => item.message).filter(Boolean)],
      },
    }
  }, [context, props, type, widgetId])

  useEffect(() => {
    const root = container.current
    if (!root) return undefined
    let dispose = () => {}
    const draw = () => {
      const width = Math.max(1, Math.floor(root.clientWidth || 960))
      const height = Math.max(1, Math.floor(width * 9 / 16))
      dispose()
      dispose = renderScene(root, documentCanvasScene(materialized.scene, width, height))
    }
    draw()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(draw) : null
    observer?.observe(root)
    return () => { observer?.disconnect(); dispose() }
  }, [materialized, type])

  useEffect(() => {
    const report = context?.onDiagnostic
    if (typeof report !== 'function') return
    for (const diagnostic of materialized.diagnostics) report({ ...diagnostic, artifactPath: context.artifact?.path })
  }, [context, materialized])

  if (materialized.status === 'invalid') return unavailable(`This ${type} view could not be replayed.`)
  const placeholder = initialWidgetMessage(materialized.scene.items[0])
  return React.createElement('figure', {
    className: `doc-widget ${className}`.trim(),
    'data-widget-type': type,
    'data-widget-id': widgetId,
    'data-source-kind': fallbackType ?? type,
  }, React.createElement('div', { className: 'doc-widget__canvas', ref: container }, placeholder ? unavailable(placeholder) : null))
}

function requireArtifactId(type, artifactId) {
  return typeof artifactId === 'string' && artifactId.trim()
    ? null
    : unavailable(`${type} requires an artifactId that matches a discovered notebook artifact.`)
}

export function Prototype({ artifactId, viewId, id, ...props }) {
  const invalid = requireArtifactId('Prototype', artifactId)
  if (invalid) return invalid
  return React.createElement(CanvasPrimitive, { type: 'prototype', props: { ...props, id, artifactId, ...(viewId !== undefined ? { viewId } : {}) } })
}

export function Site({ artifactId, viewId, id, ...props }) {
  const invalid = requireArtifactId('Site', artifactId)
  if (invalid) return invalid
  return React.createElement(CanvasPrimitive, { type: 'site', props: { ...props, id, artifactId, ...(viewId !== undefined ? { viewId } : {}) } })
}

export function Image({ src, alt = '', id, ...props }) {
  if (typeof src !== 'string' || !src.trim()) return unavailable('Image requires a source path or URL.')
  return React.createElement(CanvasPrimitive, { type: 'image', props: { ...props, id, src, alt } })
}

/** Render an unknown canvas widget's declared text fallback through canvas rules. */
export function CanvasWidget({ type, id, props = {} }) {
  if (typeof type !== 'string' || !type.trim()) return unavailable('CanvasWidget requires a widget type.')
  return React.createElement(CanvasPrimitive, { type, props: { ...props, id } })
}

export function Document({ Content, artifact, artifacts, mode = 'local', baseUrl, resolveArtifact, resolveAsset, onDiagnostic, className = '' }) {
  const context = useMemo(() => ({ artifact, artifacts, mode, baseUrl, resolveArtifact, resolveAsset, onDiagnostic }), [artifact, artifacts, mode, baseUrl, resolveArtifact, resolveAsset, onDiagnostic])
  if (!Content) return unavailable(`Document ${artifact?.title ?? ''} has no compiled MDX module.`)
  return React.createElement('article', {
    className: `doc-renderer ${className}`.trim(),
    'data-document-id': artifact?.id ?? '',
    'data-render-mode': mode,
  }, React.createElement(DocumentContext.Provider, { value: context }, React.createElement(Content, { components: { Prototype, Site, Image, CanvasWidget } })))
}

export const DOCS_IMPORT_PATH = 'design-notebook/docs'
