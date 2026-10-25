import { resolveNotebookArtifact, resolveNotebookAsset } from '../runtime/resolver.js'

function publicHttpUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return false
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    return host !== 'localhost' && !host.endsWith('.localhost') && !host.endsWith('.local') &&
      host !== '0.0.0.0' && host !== '::1' && !host.startsWith('127.') && !host.startsWith('::ffff:7f')
  } catch {
    return false
  }
}

/** Browser-safe static resolver used by the published notebook shell. */
export function createStaticNotebookResolvers({ graph, base = '/', assetPaths = {} }) {
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return {
    resolveArtifact(reference, options = {}) {
      const result = resolveNotebookArtifact(graph, reference, {
        ...options,
        mode: 'static',
        base: normalizedBase,
      })
      if (result.available === false || result.kind !== 'site') return result
      return {
        ...result,
        descriptor: result.descriptor,
        views: result.views,
      }
    },
    resolveAsset(reference, options = {}) {
      if (typeof reference === 'string' && /^[a-z][a-z\d+.-]*:/i.test(reference)) {
        if (!publicHttpUrl(reference)) return { available: false, diagnostics: [{ code: 'LOCAL_OR_INVALID_ASSET_URL_EXCLUDED', message: 'Local or non-HTTP asset URLs are unavailable in a static notebook.' }] }
        return { available: true, url: reference }
      }
      const resolved = resolveNotebookAsset(graph, reference, { ...options, mode: 'static', base: normalizedBase })
      if (resolved.available === false) return resolved
      const sourceKey = `${options.basePath ?? ''}\u0000${reference}`
      const published = assetPaths[sourceKey]
      if (!published) return { available: false, diagnostics: [{ code: 'UNAVAILABLE_ASSET', message: `Referenced asset "${reference}" was not included in the static notebook.` }] }
      return { available: true, url: `${normalizedBase}${published.split('/').map(encodeURIComponent).join('/')}` }
    },
  }
}
