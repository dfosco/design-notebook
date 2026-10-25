import { replayCanvas } from '../canvas-format/index.js'

const DEFAULT_GEOMETRY = Object.freeze({ width: 320, height: 180 })
const TEXT_WIDGETS = new Set(['text', 'sticky-note', 'note'])

function isHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function httpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

function isMachineLocalUrl(value) {
  const url = httpUrl(value)
  if (!url) return true
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') ||
    hostname === '::1' || hostname === '0.0.0.0' || hostname.startsWith('127.') || hostname.startsWith('::ffff:7f')
}

function resolveViewPath(base, viewPath) {
  const baseUrl = httpUrl(base)
  if (!baseUrl || typeof viewPath !== 'string' || !viewPath.trim()) return null
  try {
    const resolved = new URL(viewPath, baseUrl)
    return resolved.origin === baseUrl.origin ? resolved.href : null
  } catch {
    return null
  }
}

function resolveAsset(value, context, options) {
  if (isHttpUrl(value)) return value
  if (typeof options.resolveAsset === 'function') {
    try {
      const resolved = options.resolveAsset(value, context)
      return isHttpUrl(resolved) ? resolved : null
    } catch {
      return null
    }
  }
  if (typeof options.assetBaseUrl !== 'string') return null
  try {
    const resolved = new URL(value, options.assetBaseUrl).href
    return isHttpUrl(resolved) ? resolved : null
  } catch {
    return null
  }
}

function resolveSiteAsset(value, context, options) {
  if (isHttpUrl(value)) return value
  if (typeof options.resolveAsset !== 'function') return resolveAsset(value, context, options)
  try {
    const result = options.resolveAsset(value, context)
    if (result?.available === false) return null
    const candidate = typeof result === 'string' ? result : result?.url
    if (isHttpUrl(candidate)) return candidate
    if (typeof candidate !== 'string' || !candidate.trim() || candidate.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(candidate)) return null
    const url = new URL(candidate, 'https://relative-site-asset.invalid')
    return url.origin === 'https://relative-site-asset.invalid' ? candidate : null
  } catch {
    return null
  }
}

function geometryOf(placement, diagnostics) {
  const source = placement.source
  const x = placement.position?.x ?? 0
  const y = placement.position?.y ?? 0
  const width = placement.width ?? DEFAULT_GEOMETRY.width
  const height = placement.height ?? DEFAULT_GEOMETRY.height
  const valid = [x, y, width, height].every(Number.isFinite) && width > 0 && height > 0
  if (valid) return { x, y, width, height }
  diagnostics.push({
    code: 'invalid-widget-geometry',
    severity: 'warning',
    widgetId: source.id,
    message: `Widget ${source.id} has unusable geometry; a default placement is shown.`,
  })
  return { x: 0, y: 0, ...DEFAULT_GEOMETRY }
}

function sceneDimensions(state, diagnostics) {
  const valid = ['width', 'height'].every(key => state[key] === undefined || (Number.isFinite(state[key]) && state[key] > 0))
  if (!valid) diagnostics.push({
    code: 'invalid-canvas-dimensions', severity: 'warning',
    message: 'Canvas dimensions are unusable; a 1200×800 viewing surface is shown.',
  })
  return {
    width: Number.isFinite(state.width) && state.width > 0 ? state.width : 1200,
    height: Number.isFinite(state.height) && state.height > 0 ? state.height : 800,
  }
}

function resolvedArtifact(value, kind, placement, viewId, artifacts, options) {
  if (typeof options.resolveArtifact !== 'function') return null
  try {
    const result = options.resolveArtifact(value, { kind, placement, viewId, artifacts, mode: options.mode })
    return result && typeof result === 'object' ? result : null
  } catch {
    return null
  }
}

function materializeItem(placement, artifacts, options, diagnostics) {
  const data = placement.data ?? {}
  const context = { widget: placement.source, placement, artifacts, mode: options.mode }
  const item = {
    id: placement.id,
    geometry: geometryOf(placement, diagnostics),
  }
  const kind = placement.kind

  if (TEXT_WIDGETS.has(kind)) {
    return {
      ...item,
      kind: 'text',
      text: typeof data.text === 'string' ? data.text : '',
      ...(typeof data.color === 'string' ? { color: data.color } : {}),
    }
  }

  if (kind === 'markdown' || kind === 'mark') {
    const text = [data.markdown, data.content, data.text].find(value => typeof value === 'string') ?? ''
    return { ...item, kind: 'markdown', text }
  }

  if (kind === 'image') {
    const src = resolveAsset(data.src, { ...context, purpose: 'canvas-image' }, options)
    if (!src) diagnostics.push({
      code: 'unavailable-image', severity: 'warning', widgetId: placement.id,
      message: `Image widget ${placement.id} has no resolvable source.`,
    })
    return { ...item, kind: 'image', src, alt: typeof data.alt === 'string' ? data.alt : '' }
  }

  if (kind === 'prototype') {
    const reference = data.artifactId ?? data.src
    const artifact = resolvedArtifact(reference, 'prototype', placement, data.viewId, artifacts, options)
    const src = artifact?.available === false ? null : artifact?.url
    if (!isHttpUrl(src)) diagnostics.push({
      code: 'unavailable-prototype', severity: 'warning', widgetId: placement.id,
      message: `Prototype widget ${placement.id} has no resolved local or published entry URL.`,
    })
    return { ...item, kind: 'frame', src: isHttpUrl(src) ? src : null, title: artifact?.title ?? `Prototype ${placement.id}` }
  }

  if (kind === 'site') {
    const reference = data.artifactId ?? data.src
    const artifact = resolvedArtifact(reference, 'site', placement, data.viewId, artifacts, options)
    const descriptor = artifact?.descriptor ?? artifact
    const views = Array.isArray(descriptor?.views) ? descriptor.views : (Array.isArray(artifact?.views) ? artifact.views : [])
    const hasViewId = data.viewId !== undefined
    const view = hasViewId && typeof data.viewId === 'string'
      ? views.find(candidate => candidate?.id === data.viewId)
      : (hasViewId ? null : artifact?.view ?? null)
    const artifactAvailable = artifact?.available !== false && Boolean(artifact)
    const missingView = hasViewId && !view
    if (!artifactAvailable) diagnostics.push({
      code: 'unavailable-site-artifact', severity: 'warning', widgetId: placement.id,
      message: `Site artifact for widget ${placement.id} is unavailable.`,
    })
    if (missingView) diagnostics.push({
      code: 'unavailable-site-view', severity: 'warning', widgetId: placement.id,
      viewId: data.viewId,
      message: `Site view "${data.viewId}" for widget ${placement.id} was not found.`,
    })
    const screenshot = artifactAvailable && !missingView && view?.screenshot
      ? resolveSiteAsset(view.screenshot, {
        ...context,
        artifact,
        view,
        purpose: 'site-screenshot',
        base: 'artifact-folder',
        basePath: artifact.folderPath ?? artifact.descriptor?.folderPath ?? '',
      }, options)
      : null
    const localBase = descriptor?.local?.developmentUrl ?? view?.localUrl
    const publishedBase = descriptor?.published?.url ?? view?.publishedUrl
    const route = view?.path ?? (!hasViewId ? '/' : null)
    const localUrl = artifactAvailable && !missingView
      ? (view?.localUrl ?? (localBase ? (route !== null ? resolveViewPath(localBase, route) : localBase) : null))
      : null
    const publishedUrl = artifactAvailable && !missingView
      ? (view?.publishedUrl ?? (publishedBase ? (route !== null ? resolveViewPath(publishedBase, route) : publishedBase) : null))
      : null
    const validLocalUrl = isHttpUrl(localUrl) ? localUrl : null
    const validPublishedUrl = isHttpUrl(publishedUrl) && !isMachineLocalUrl(publishedUrl) ? publishedUrl : null
    const validLink = options.mode === 'static' ? validPublishedUrl : (validLocalUrl ?? validPublishedUrl)
    if (options.mode === 'local' && !validLocalUrl && artifactAvailable && !missingView) diagnostics.push({
      code: 'unavailable-site-local-view', severity: 'warning', widgetId: placement.id,
      message: `Site widget ${placement.id} has no local development URL; use its available screenshot or published destination.`,
    })
    if (!screenshot) diagnostics.push({
      code: 'unavailable-site-screenshot', severity: 'warning', widgetId: placement.id,
      message: `Site widget ${placement.id} has no resolvable screenshot.`,
    })
    if (!validLink) diagnostics.push({
      code: 'unavailable-site-link', severity: 'warning', widgetId: placement.id,
      message: `Site widget ${placement.id} has no valid ${options.mode} destination.`,
    })
    return {
      ...item,
      kind: 'site',
      src: screenshot,
      href: validLink,
      ...(options.mode === 'local' && validLocalUrl ? { localSrc: validLocalUrl } : {}),
      title: view?.title ?? artifact?.title ?? descriptor?.title ?? `Site ${placement.id}`,
    }
  }

  const fallback = data.fallback
  const validTextFallback = isRecord(fallback) && fallback.type === 'text' && typeof fallback.text === 'string'
  if (!validTextFallback) {
    const missing = fallback === undefined
    diagnostics.push({
      code: missing ? 'missing-widget-fallback' : (isRecord(fallback) && fallback.type !== 'text' ? 'unsupported-widget-fallback' : 'invalid-widget-fallback'),
      severity: 'warning',
      widgetId: placement.id,
      message: missing
        ? `Widget ${placement.id} has an unsupported type and no declared fallback.`
        : `Widget ${placement.id} has an unsupported or malformed fallback; its content is unavailable.`,
    })
  }
  return {
    ...item,
    kind: typeof kind === 'string' ? kind : 'unknown',
    message: `Widget type “${typeof kind === 'string' ? kind : 'unknown'}” is not supported by this canvas viewer${validTextFallback ? '; showing its text fallback.' : '; content is unavailable.'}`,
    ...(validTextFallback ? { fallback: { type: 'text', text: fallback.text } } : {}),
  }
}

/** Convert accepted JSONL replay into the renderer's private scene adapter. */
export function materializeCanvas(sourceText, options = {}) {
  const mode = options.mode ?? 'local'
  if (mode !== 'local' && mode !== 'static') throw new TypeError('Canvas rendering mode must be "local" or "static".')
  const replay = replayCanvas(sourceText)
  const diagnostics = replay.diagnostics.map(item => ({ ...item }))
  if (replay.state.sources.length) diagnostics.push({
    code: 'unsupported-header-sources', severity: 'warning',
    message: `${replay.state.sources.length} canvas source record(s) are retained by replay but are not rendered.`,
  })
  if (replay.state.connectors.length) diagnostics.push({
    code: 'unsupported-header-connectors', severity: 'warning',
    message: `${replay.state.connectors.length} canvas connector(s) are retained by replay but are not rendered.`,
  })

  const dimensions = sceneDimensions(replay.state, diagnostics)
  const scene = {
    title: replay.state.title,
    mode,
    ...dimensions,
    items: replay.placements.map(placement => materializeItem(placement, options.artifacts ?? [], { ...options, mode }, diagnostics)),
    notices: diagnostics.filter(item => item.severity === 'error' || item.severity === 'warning').map(item => item.message),
  }
  return { status: replay.status, canvasId: replay.canvasId, replay, scene, diagnostics }
}
