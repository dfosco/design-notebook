import React, { useEffect, useMemo, useRef, useId } from 'react'
import { materializeCanvas } from '../../canvas-renderer/index.js'
import { renderScene } from '../../vendor/tiny-canvas/index.js'
import '../../vendor/tiny-canvas/style.css'
import './style.css'

const EMPTY_ARTIFACTS = Object.freeze([])

function unavailable(message) {
  return React.createElement('div', { className: 'site-view__unavailable', role: 'status' }, message)
}

function siteSource(placementId, artifactId, viewId) {
  return JSON.stringify({
    event: 'canvas_created',
    formatVersion: 1,
    canvasId: 'site-view',
    widgets: [{
      id: placementId,
      type: 'site',
      position: { x: 0, y: 0 },
      props: { artifactId, ...(viewId !== undefined ? { viewId } : {}) },
    }],
  })
}

function resolverOptions({ artifacts, mode, resolveArtifact, resolveAsset }, diagnostics) {
  return {
    mode,
    artifacts,
    resolveArtifact(reference, context) {
      if (typeof resolveArtifact !== 'function') return null
      try {
        const result = resolveArtifact(reference, { ...context, mode })
        if (Array.isArray(result?.diagnostics)) diagnostics.push(...result.diagnostics)
        return result
      } catch (error) {
        diagnostics.push({
          code: 'site-artifact-resolution-failed',
          severity: 'warning',
          message: `Could not resolve Site "${String(reference)}": ${error.message}`,
        })
        return null
      }
    },
    resolveAsset(reference, context) {
      if (typeof resolveAsset !== 'function') return null
      try {
        const result = resolveAsset(reference, { ...context, mode })
        if (Array.isArray(result?.diagnostics)) diagnostics.push(...result.diagnostics)
        if (typeof result === 'string') return result
        if (result?.available === false) return null
        return typeof result?.url === 'string' ? result.url : null
      } catch (error) {
        diagnostics.push({
          code: 'site-asset-resolution-failed',
          severity: 'warning',
          message: `Could not resolve Site asset "${String(reference)}": ${error.message}`,
        })
        return null
      }
    },
  }
}

/** Render one discovered Site view through the shared canvas materializer and renderer. */
export function SiteView({
  artifactId,
  viewId,
  artifacts = EMPTY_ARTIFACTS,
  mode = 'local',
  resolveArtifact,
  resolveAsset,
  onDiagnostic,
  className = '',
}) {
  const host = useRef(null)
  const diagnosticHandler = useRef(onDiagnostic)
  diagnosticHandler.current = onDiagnostic
  const generatedId = useId()
  const placementId = `site-${generatedId}`
  const validArtifactId = typeof artifactId === 'string' && artifactId.trim().length > 0
  const validMode = mode === 'local' || mode === 'static'
  const materialized = useMemo(() => {
    if (!validArtifactId || !validMode) return null
    const resolverDiagnostics = []
    const rendered = materializeCanvas(siteSource(placementId, artifactId, viewId), resolverOptions({
      artifacts,
      mode,
      resolveArtifact,
      resolveAsset,
    }, resolverDiagnostics))
    if (!resolverDiagnostics.length) return rendered
    const messages = resolverDiagnostics.map(item => item.message).filter(Boolean)
    return {
      ...rendered,
      diagnostics: [...rendered.diagnostics, ...resolverDiagnostics],
      scene: { ...rendered.scene, notices: [...rendered.scene.notices, ...messages] },
    }
  }, [validArtifactId, validMode, placementId, artifactId, viewId, artifacts, mode, resolveArtifact, resolveAsset])

  useEffect(() => {
    if (!validArtifactId) {
      if (typeof diagnosticHandler.current === 'function') diagnosticHandler.current({
        code: 'site-artifact-id-required',
        severity: 'error',
        message: 'SiteView requires an artifactId matching a discovered Site.',
      })
      return undefined
    }
    if (!validMode) {
      if (typeof diagnosticHandler.current === 'function') diagnosticHandler.current({
        code: 'invalid-site-render-mode',
        severity: 'error',
        message: 'SiteView mode must be "local" or "static".',
      })
      return undefined
    }
    const container = host.current
    if (!container || !materialized) return undefined
    const dispose = renderScene(container, materialized.scene)
    if (typeof diagnosticHandler.current === 'function') {
      for (const diagnostic of materialized.diagnostics) diagnosticHandler.current(diagnostic)
    }
    return dispose
  }, [materialized, validArtifactId, validMode])

  if (!validArtifactId) return unavailable('SiteView requires a discovered Site artifact ID.')
  if (!validMode) return unavailable('SiteView mode must be "local" or "static".')
  return React.createElement('section', {
    className: `site-view ${className}`.trim(),
    'data-site-artifact-id': artifactId,
    'data-site-view-id': typeof viewId === 'string' ? viewId : '',
    'data-render-mode': mode,
  }, React.createElement('div', { className: 'site-view__canvas', ref: host },
    unavailable('Resolving Site view…'),
  ))
}
