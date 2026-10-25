function encodeId(id) {
  return encodeURIComponent(id)
}

function normalizePortablePath(basePath, reference) {
  for (const [value, label] of [[basePath, 'basePath'], [reference, 'relativePath']]) {
    if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
      throw new Error(`${label} must be a forward-slash relative path`)
    }
  }
  const segments = []
  for (const segment of `${basePath ? `${basePath}/` : ''}${reference}`.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (!segments.length) throw new Error(`Relative path escapes the notebook: ${reference}`)
      segments.pop()
    } else segments.push(segment)
  }
  return segments
}

export function prototypeRouteParts(view) {
  const value = view?.path ?? '/'
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    throw new TypeError(`Invalid prototype view path: ${value}`)
  }
  const url = new URL(value, 'https://notebook.invalid')
  if (url.origin !== 'https://notebook.invalid') throw new TypeError(`Invalid prototype view path: ${value}`)
  const rawPath = value.split(/[?#]/, 1)[0]
  const segments = rawPath.split('/').filter(Boolean).map(segment => {
    let decoded
    try { decoded = decodeURIComponent(segment) } catch { throw new TypeError(`Invalid prototype view path: ${value}`) }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) throw new TypeError(`Invalid prototype view path: ${value}`)
    return encodeURIComponent(decoded)
  })
  return { segments, suffix: `${url.search}${url.hash}` }
}

function viewFor(artifact, viewId, requested) {
  if (!requested) return artifact.views?.[0] ?? null
  if (typeof viewId !== 'string' || !viewId.trim()) return null
  return artifact.views?.find(view => view.id === viewId) ?? null
}

export function resolveNotebookArtifact(graph, reference, options = {}) {
  const { kind, mode = 'local', viewId, base = '/', origin = '' } = options
  if (typeof reference !== 'string') return unavailable(kind, reference)
  const artifact = graph?.artifacts?.find(item => item.id === reference && item.available && (!kind || item.kind === kind))
  if (!artifact) return unavailable(kind, reference)
  if (artifact.kind === 'prototype') {
    const requestedView = viewId !== undefined
    const view = viewFor(artifact, viewId, requestedView)
    if (requestedView && !view) {
      const code = typeof viewId === 'string' && viewId.trim() ? 'UNAVAILABLE_VIEW' : 'INVALID_VIEW_ID'
      return { available: false, id: artifact.id, title: artifact.title, diagnostics: [{ code, message: code === 'UNAVAILABLE_VIEW' ? `Prototype view "${viewId}" was not found.` : 'Prototype viewId must be a non-empty string.' }] }
    }
    try {
      const { segments, suffix } = prototypeRouteParts(view)
      const path = segments.join('/')
      const url = mode === 'static'
        ? `${base.endsWith('/') ? base : `${base}/`}prototypes/${encodeId(artifact.id)}/${path}${suffix}`
        : `${origin}/__notebook/prototypes/${encodeId(artifact.id)}/${path}${suffix}`
      return { available: true, id: artifact.id, kind: artifact.kind, title: artifact.title, viewId: view?.id, url }
    } catch (error) {
      return { available: false, id: artifact.id, kind: artifact.kind, title: artifact.title, diagnostics: [{ code: 'INVALID_VIEW_PATH', message: error.message }] }
    }
  }
  if (artifact.kind === 'site') {
    const requestedView = viewId !== undefined
    const view = viewFor(artifact, viewId, requestedView)
    if (requestedView && !view) {
      const code = typeof viewId === 'string' && viewId.trim() ? 'UNAVAILABLE_VIEW' : 'INVALID_VIEW_ID'
      return { available: false, id: artifact.id, kind: artifact.kind, title: artifact.title, folderPath: artifact.folderPath, descriptor: artifact.descriptor, views: artifact.views, diagnostics: [{ code, message: code === 'UNAVAILABLE_VIEW' ? `Site view "${viewId}" was not found.` : 'Site viewId must be a non-empty string.' }] }
    }
    return { available: true, id: artifact.id, kind: artifact.kind, title: artifact.title, folderPath: artifact.folderPath, descriptor: artifact.descriptor, views: artifact.views, viewId: view?.id, view }
  }
  return { available: true, id: artifact.id, kind: artifact.kind, title: artifact.title, descriptor: artifact.descriptor }
}

function unavailable(kind, reference) {
  return { available: false, diagnostics: [{ code: 'UNAVAILABLE_ARTIFACT', message: `No available ${kind ?? 'artifact'} has ID "${reference}".` }] }
}

export function resolveNotebookAsset(graph, reference, options = {}) {
  const { basePath = '', mode = 'local', base = '/' } = options
  if (typeof reference !== 'string' || !reference.trim()) return { available: false, diagnostics: [{ code: 'INVALID_ASSET_REFERENCE' }] }
  if (/^https?:\/\//i.test(reference)) return { available: true, url: reference }
  try {
    const segments = normalizePortablePath(basePath, reference)
    const encoded = segments.map(encodeURIComponent).join('/')
    return { available: true, url: mode === 'static' ? `${base.endsWith('/') ? base : `${base}/`}${encoded}` : `/${encoded}` }
  } catch (error) {
    return { available: false, diagnostics: [{ code: 'UNAVAILABLE_ASSET', message: error.message }] }
  }
}
