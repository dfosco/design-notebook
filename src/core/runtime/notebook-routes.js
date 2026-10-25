import { prototypeRouteParts } from './resolver.js'

const RESERVED_ROOTS = new Set([
  'canvas',
  'docs',
  'sites',
  '__notebook',
  'prototypes',
  'assets',
  'node_modules',
  '@fs',
])

export function normalizeRouteBase(base = '/') {
  if (typeof base !== 'string' || !base.startsWith('/') || base.startsWith('//') || /[?#\\]/.test(base)) {
    throw new TypeError('base must be an absolute same-origin path prefix.')
  }
  const segments = base.split('/').filter(Boolean)
  const canonicalSegments = []
  for (const segment of segments) {
    let decoded
    try { decoded = decodeURIComponent(segment) } catch { throw new TypeError('base contains an invalid encoded path segment.') }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) {
      throw new TypeError('base cannot contain traversal or encoded separators.')
    }
    canonicalSegments.push(encodeSegment(decoded))
  }
  return canonicalSegments.length ? `/${canonicalSegments.join('/')}/` : '/'
}

function encodeSegment(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function idSegment(id) {
  if (typeof id !== 'string' || !id.trim() || id.includes('/') || id.includes('\\') || id === '.' || id === '..') {
    throw new TypeError('Artifact id must be a non-empty safe path segment.')
  }
  return encodeSegment(id)
}

function prefixFor(base) {
  const normalized = normalizeRouteBase(base)
  return normalized === '/' ? '' : normalized.slice(0, -1)
}

function exactView(artifact, viewId) {
  if (typeof viewId !== 'string' || !viewId.trim()) return null
  const matches = Array.isArray(artifact.views) ? artifact.views.filter(view => view?.id === viewId) : []
  if (matches.length > 1) throw new TypeError(`View ID "${viewId}" is duplicated on artifact "${artifact.id}".`)
  return matches[0] ?? null
}

function urlInput(location) {
  if (location instanceof URL) return new URL(location.href)
  if (typeof location === 'string') return new URL(location, 'https://design-notebook.invalid')
  if (location && typeof location === 'object') {
    const pathname = typeof location.pathname === 'string' ? location.pathname : '/'
    const search = typeof location.search === 'string' ? location.search : ''
    const hash = typeof location.hash === 'string' ? location.hash : ''
    return new URL(`${pathname}${search}${hash}`, 'https://design-notebook.invalid')
  }
  throw new TypeError('location must be a URL, URL string, or pathname/search/hash object.')
}

function withBase(routePath, base) {
  return `${prefixFor(base)}${routePath}` || '/'
}

function prototypePath(artifact, view) {
  const id = idSegment(artifact.id)
  if (!view) return `/${id}`
  const { segments, suffix } = prototypeRouteParts(view)
  return `/${id}${segments.length ? `/${segments.join('/')}` : ''}${suffix}`
}

/** Build the canonical public shell path for an artifact and optional named view. */
export function buildArtifactPath(artifact, { base = '/', viewId } = {}) {
  if (!artifact || typeof artifact !== 'object') throw new TypeError('artifact is required.')
  const id = idSegment(artifact.id)
  const hasView = viewId !== undefined
  if (hasView && (typeof viewId !== 'string' || !viewId.trim())) {
    throw new TypeError('viewId must be a non-empty authored view ID when supplied.')
  }

  let routePath
  if (artifact.kind === 'prototype') {
    if (!hasView) routePath = prototypePath(artifact, null)
    else {
      const view = exactView(artifact, viewId)
      if (!view) throw new TypeError(`Prototype view "${viewId}" was not found.`)
      routePath = prototypePath(artifact, view)
    }
  } else if (artifact.kind === 'site') {
    routePath = `/sites/${id}`
    if (hasView) {
      if (!exactView(artifact, viewId)) throw new TypeError(`Site view "${viewId}" was not found.`)
      routePath += `?view=${encodeURIComponent(viewId)}`
    }
  } else if (artifact.kind === 'canvas') {
    if (hasView) throw new TypeError('Canvas artifacts do not have public named views.')
    routePath = `/canvas/${id}`
  } else if (artifact.kind === 'doc') {
    if (hasView) throw new TypeError('Document artifacts do not have public named views.')
    routePath = `/docs/${id}`
  } else {
    throw new TypeError(`Unsupported artifact kind: ${String(artifact.kind)}`)
  }
  return withBase(routePath, base)
}

function stripBase(pathname, base) {
  const normalized = normalizeRouteBase(base)
  if (normalized === '/') return pathname
  const prefix = normalized.slice(0, -1)
  if (pathname === prefix) return '/'
  return pathname.startsWith(normalized) ? `/${pathname.slice(normalized.length)}` : null
}

function diagnostic(code, message, details = {}) {
  return { code, severity: 'error', message, ...details }
}

function routeEntries(artifacts, base, diagnostics = []) {
  const entries = []
  const add = (artifact, view, pathname, search = '', hash = '') => {
    const key = `${pathname}${search}${hash}`
    entries.push({ artifact, view, path: key, canonicalPath: key })
  }

  for (const artifact of Array.isArray(artifacts) ? artifacts : []) {
    try {
      const id = idSegment(artifact?.id)
      if (!['prototype', 'canvas', 'doc', 'site'].includes(artifact?.kind)) {
        diagnostics.push(diagnostic('UNSUPPORTED_ARTIFACT_ROUTE_KIND', `Artifact "${artifact?.id ?? ''}" has no public route for kind "${artifact?.kind ?? ''}".`, { artifactId: artifact?.id }))
        continue
      }
      if (artifact.kind === 'prototype' && RESERVED_ROOTS.has(decodeURIComponent(id).toLowerCase())) {
        diagnostics.push(diagnostic('RESERVED_ARTIFACT_ROUTE_PREFIX', `Prototype ID "${artifact.id}" uses a reserved public route prefix.`, { artifactId: artifact.id }))
      }
      add(artifact, null, withBase(buildArtifactPath(artifact, { base }), '/'))
      if (artifact.kind === 'prototype' || artifact.kind === 'site') {
        const seenViewIds = new Set()
        for (const view of Array.isArray(artifact.views) ? artifact.views : []) {
          if (typeof view?.id !== 'string' || !view.id.trim()) {
            diagnostics.push(diagnostic('INVALID_ARTIFACT_VIEW_ID', `Artifact "${artifact.id}" has a view without a valid ID.`, { artifactId: artifact.id }))
            continue
          }
          if (seenViewIds.has(view.id)) {
            diagnostics.push(diagnostic('DUPLICATE_ARTIFACT_VIEW_ID', `Artifact "${artifact.id}" has duplicate view ID "${view.id}".`, { artifactId: artifact.id, viewId: view.id }))
            continue
          }
          seenViewIds.add(view.id)
          try {
            const path = buildArtifactPath(artifact, { base, viewId: view.id })
            // The first prototype view is the runtime's implicit default. When
            // it is authored at `/`, its path is an alias of the prototype's
            // canonical root, not a second route claim.
            if (artifact.kind === 'prototype' && view === artifact.views[0] && path === buildArtifactPath(artifact, { base })) continue
            const parsed = new URL(path, 'https://design-notebook.invalid')
            add(artifact, view, `${parsed.pathname}${parsed.search}${parsed.hash}`)
          } catch (error) {
            diagnostics.push(diagnostic('INVALID_ARTIFACT_VIEW_ROUTE', `View "${view.id}" on artifact "${artifact.id}" cannot be routed: ${error.message}`, { artifactId: artifact.id, viewId: view.id }))
          }
        }
      }
    } catch (error) {
      diagnostics.push(diagnostic('INVALID_ARTIFACT_ROUTE_ID', `Artifact route cannot be generated: ${error.message}`, { artifactId: artifact?.id }))
    }
  }

  const byPath = new Map()
  for (const entry of entries) {
    const matches = byPath.get(entry.path) ?? []
    matches.push(entry)
    byPath.set(entry.path, matches)
  }
  for (const [routePath, matches] of byPath) {
    if (matches.length > 1) diagnostics.push(diagnostic('ARTIFACT_ROUTE_COLLISION', `Multiple artifacts or views claim "${routePath}".`, {
      path: routePath,
      artifactIds: [...new Set(matches.map(match => match.artifact.id))],
    }))
  }
  return entries
}

/** Diagnose route IDs, authored view routes, reserved roots, and collisions. */
export function diagnoseArtifactRoutes(artifacts, { base = '/' } = {}) {
  const diagnostics = []
  routeEntries(artifacts, base, diagnostics)
  return diagnostics
}

/** Parse a public artifact route, including read-only legacy ?artifact links. */
export function parseArtifactPath(location, { artifacts = [], base = '/' } = {}) {
  const url = urlInput(location)
  const localPath = stripBase(url.pathname, base)
  if (localPath === null) return { status: 'not-found', diagnostics: [] }

  const routeDiagnostics = []
  const entries = routeEntries(artifacts, base, routeDiagnostics)
  const lookup = id => (Array.isArray(artifacts) ? artifacts.filter(item => item?.id === id) : [])
  const requestPathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname
  const artifactsAtPath = () => [...new Set(entries
    .filter(entry => new URL(entry.path, 'https://design-notebook.invalid').pathname === requestPathname)
    .map(entry => entry.artifact))]
  const legacyIds = url.searchParams.getAll('artifact')
  if (legacyIds.length) {
    if (localPath !== '/' || legacyIds.length !== 1) {
      return { status: 'invalid', diagnostics: [diagnostic('INVALID_LEGACY_ARTIFACT_URL', 'Legacy artifact query links are only valid at the notebook root and must identify one artifact.')] }
    }
    const matches = lookup(legacyIds[0])
    if (!matches.length) return { status: 'not-found', diagnostics: routeDiagnostics }
    if (matches.length > 1) return { status: 'ambiguous', diagnostics: [...routeDiagnostics, diagnostic('AMBIGUOUS_ARTIFACT_ID', `Artifact ID "${legacyIds[0]}" is not unique.`, { artifactId: legacyIds[0] })] }
    const artifact = matches[0]
    const viewValues = url.searchParams.getAll('view')
    if (viewValues.length > 1) return { status: 'invalid', diagnostics: [...routeDiagnostics, diagnostic('INVALID_VIEW_ID', 'Legacy URL must contain at most one view parameter.', { artifactId: artifact.id })] }
    const viewId = viewValues.length ? viewValues[0] : undefined
    if (viewId !== undefined && (typeof viewId !== 'string' || !viewId.trim())) {
      return { status: 'invalid', artifact, diagnostics: [...routeDiagnostics, diagnostic('INVALID_VIEW_ID', 'viewId must be a non-empty authored view ID.', { artifactId: artifact.id })] }
    }
    let canonicalPath
    try { canonicalPath = buildArtifactPath(artifact, { base, ...(viewId !== undefined ? { viewId } : {}) }) } catch (error) {
      return { status: 'invalid', artifact, diagnostics: [...routeDiagnostics, diagnostic('INVALID_VIEW_ID', error.message, { artifactId: artifact.id, viewId })] }
    }
    const view = viewId === undefined ? null : exactView(artifact, viewId)
    return { status: 'matched', artifact, view, canonicalPath, legacy: true, diagnostics: routeDiagnostics }
  }

  const viewValues = url.searchParams.getAll('view')
  if (viewValues.length > 1) {
    const matches = artifactsAtPath()
    return { status: 'invalid', ...(matches.length === 1 ? { artifact: matches[0] } : {}), diagnostics: [...routeDiagnostics, diagnostic('INVALID_VIEW_ID', 'Route must contain at most one view parameter.')] }
  }
  const explicitView = viewValues.length > 0
  const viewId = explicitView ? viewValues[0] : undefined
  if (explicitView && !viewId.trim()) {
    const matches = artifactsAtPath()
    return { status: 'invalid', ...(matches.length === 1 ? { artifact: matches[0] } : {}), diagnostics: [...routeDiagnostics, diagnostic('INVALID_VIEW_ID', 'viewId must be a non-empty authored view ID.')] }
  }

  const candidates = entries.filter(entry => {
    const parsed = new URL(entry.path, 'https://design-notebook.invalid')
    if (parsed.pathname !== requestPathname) return false
    if (entry.artifact.kind === 'site') {
      const entryViewId = entry.view?.id
      return explicitView ? entryViewId === viewId : entryViewId == null
    }
    if (explicitView) return false
    // Fragments are not sent in HTTP requests. A server parsing a direct
    // request can still resolve the path/query to its authored view and the
    // returned canonicalPath restores the fragment; browser parsing with an
    // explicit fragment remains exact.
    return parsed.search === url.search && (!url.hash || parsed.hash === url.hash)
  })
  const uniqueCandidates = candidates.filter((candidate, index) => candidates.findIndex(other => other.artifact === candidate.artifact && other.view?.id === candidate.view?.id) === index)
  if (!uniqueCandidates.length) {
    const samePath = entries.filter(entry => new URL(entry.path, 'https://design-notebook.invalid').pathname === requestPathname)
    if (samePath.length && explicitView) {
      const artifactsForPath = [...new Set(samePath.map(entry => entry.artifact))]
      return { status: 'invalid', ...(artifactsForPath.length === 1 ? { artifact: artifactsForPath[0] } : {}), diagnostics: [...routeDiagnostics, diagnostic('UNAVAILABLE_VIEW', `View "${viewId}" is not available on this route.`, { viewId })] }
    }
    return { status: 'not-found', diagnostics: routeDiagnostics }
  }
  if (uniqueCandidates.length > 1) {
    return { status: 'ambiguous', diagnostics: [...routeDiagnostics, diagnostic('ARTIFACT_ROUTE_COLLISION', `Multiple artifacts or views claim "${url.pathname}${url.search}${url.hash}".`, { path: `${url.pathname}${url.search}${url.hash}`, artifactIds: uniqueCandidates.map(item => item.artifact.id) })] }
  }
  const match = uniqueCandidates[0]
  const reservedPrototypeRoute = routeDiagnostics.find(item => item.code === 'RESERVED_ARTIFACT_ROUTE_PREFIX' && item.artifactId === match.artifact.id)
  if (reservedPrototypeRoute) return { status: 'invalid', artifact: match.artifact, view: match.view, diagnostics: routeDiagnostics }
  const duplicateViewId = routeDiagnostics.find(item => item.code === 'DUPLICATE_ARTIFACT_VIEW_ID' && item.artifactId === match.artifact.id && item.viewId === match.view?.id)
  if (duplicateViewId) return { status: 'invalid', artifact: match.artifact, view: match.view, diagnostics: routeDiagnostics }
  return {
    status: 'matched',
    artifact: match.artifact,
    view: match.view,
    canonicalPath: match.canonicalPath,
    diagnostics: routeDiagnostics,
  }
}
