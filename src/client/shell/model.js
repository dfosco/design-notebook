import { buildArtifactPath } from '../../core/runtime/notebook-routes.js'

/** Build a canonical public destination by delegating to the shared route helper. */
export function selectionHref(graph, routeBase, selection) {
  const artifact = Array.isArray(graph?.artifacts)
    ? graph.artifacts.find(item => item?.id === selection?.artifactId)
    : null
  if (!artifact) return null
  try {
    return buildArtifactPath(artifact, {
      base: routeBase,
      ...(selection && Object.hasOwn(selection, 'viewId') ? { viewId: selection.viewId } : {}),
    })
  } catch {
    return null
  }
}

export function artifactForSelection(graph, selection) {
  if (!selection || typeof selection.artifactId !== 'string') return null
  return Array.isArray(graph?.artifacts) ? graph.artifacts.find(artifact => artifact?.id === selection.artifactId) ?? null : null
}

export function firstArtifactSelection(entries) {
  for (const entry of entries ?? []) {
    if (entry?.type === 'artifact' && typeof entry.artifact?.id === 'string' && entry.artifact.id) {
      return { artifactId: entry.artifact.id }
    }
    if (entry?.type === 'group') {
      const nested = firstArtifactSelection(entry.children)
      if (nested) return nested
    }
  }
  return null
}

export function artifactViews(artifact) {
  return Array.isArray(artifact?.views) ? artifact.views.filter(view => typeof view?.id === 'string' && view.id.trim()) : []
}

/**
 * Return the visible scene rectangle, including placed items outside its authored
 * nominal dimensions. The shell exposes this overflow through its clipped viewport.
 */
export function canvasViewBounds(scene) {
  const width = Number.isFinite(scene?.width) && scene.width > 0 ? scene.width : 1200
  const height = Number.isFinite(scene?.height) && scene.height > 0 ? scene.height : 800
  let left = 0
  let top = 0
  let right = width
  let bottom = height
  for (const item of scene?.items ?? []) {
    const geometry = item?.geometry
    if (![geometry?.x, geometry?.y, geometry?.width, geometry?.height].every(Number.isFinite)) continue
    if (geometry.width <= 0 || geometry.height <= 0) continue
    left = Math.min(left, geometry.x)
    top = Math.min(top, geometry.y)
    right = Math.max(right, geometry.x + geometry.width)
    bottom = Math.max(bottom, geometry.y + geometry.height)
  }
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Fit visible scene/item bounds into a viewport while preserving authored coordinates. */
export function canvasFitTransform(viewport, bounds) {
  const scale = Math.min((viewport.width - 48) / bounds.width, (viewport.height - 48) / bounds.height, 1)
  const safeScale = Math.max(0.02, scale)
  return { scale: safeScale, x: 24 - bounds.x * safeScale, y: 24 - bounds.y * safeScale }
}
