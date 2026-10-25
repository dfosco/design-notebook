const LOCAL_PREFIX = '/__notebook/prototypes/'

function normalizeBase(base) {
  if (typeof base !== 'string' || !base.startsWith('/') || base.startsWith('//') || base.includes('..')) {
    throw new TypeError('base must be a root-relative URL prefix without traversal segments.')
  }
  return base.endsWith('/') ? base : `${base}/`
}

/** Return the route prefix used for one stable prototype ID in local or static mode. */
export function prototypeRouteBasePath(id, { mode = 'local', base = '/', baseIsPrototypePrefix = false } = {}) {
  if (typeof id !== 'string' || !id) throw new TypeError('A stable prototype ID is required.')
  if (mode === 'local') return `${LOCAL_PREFIX}${encodeURIComponent(id)}`
  if (mode === 'static') {
    const normalized = normalizeBase(base)
    if (baseIsPrototypePrefix) {
      const expectedSuffix = `prototypes/${encodeURIComponent(id)}/`
      if (!normalized.endsWith(expectedSuffix)) throw new TypeError(`base must end with ${expectedSuffix} when baseIsPrototypePrefix is true.`)
      return normalized.replace(/\/$/, '')
    }
    return `${normalized}prototypes/${encodeURIComponent(id)}`
  }
  throw new TypeError('mode must be "local" or "static".')
}

/** Create the read-only browser location binding expected by Statefully's PrototypeProvider. */
export function createPrototypeRouteBinding({ basePath, window: targetWindow = globalThis.window } = {}) {
  if (!targetWindow?.location || !targetWindow?.history) throw new TypeError('A browser Window is required.')
  if (typeof basePath !== 'string' || !basePath.startsWith('/') || basePath.startsWith('//')) {
    throw new TypeError('basePath must be an absolute same-origin route prefix.')
  }
  const normalizedBase = basePath.replace(/\/+$/, '') || '/'
  const listeners = new Set()
  let snapshot = readLocation()

  function readLocation() {
    return Object.freeze({
      pathname: targetWindow.location.pathname,
      search: targetWindow.location.search,
      params: Object.freeze({}),
      basePath: normalizedBase,
    })
  }

  function publish() {
    snapshot = readLocation()
    for (const listener of listeners) listener()
  }

  function subscribe(listener) {
    if (!listeners.size) {
      targetWindow.addEventListener('popstate', publish)
      targetWindow.addEventListener('design-notebook:navigate', publish)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (!listeners.size) {
        targetWindow.removeEventListener('popstate', publish)
        targetWindow.removeEventListener('design-notebook:navigate', publish)
      }
    }
  }

  function navigate(destination) {
    const url = new URL(destination, targetWindow.location.href)
    if (url.origin !== targetWindow.location.origin) throw new TypeError('Prototype navigation must stay on the current origin.')
    if (normalizedBase !== '/' && url.pathname !== normalizedBase && !url.pathname.startsWith(`${normalizedBase}/`)) {
      throw new TypeError(`Prototype navigation must remain below ${normalizedBase}.`)
    }
    targetWindow.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
    publish()
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe,
    navigate,
    dispose() {
      targetWindow.removeEventListener('popstate', publish)
      targetWindow.removeEventListener('design-notebook:navigate', publish)
      listeners.clear()
    },
  })
}
