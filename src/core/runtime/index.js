import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer, build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import statefully from '@dfosco/statefully/vite'
import coreCss from '../../vendor/hypercanvas/core-css.js'
import { discoverNotebook, resolveNotebookPath, NOTEBOOK_INFRASTRUCTURE_DIRECTORIES } from '../artifacts/discovery.js'
import { compileDocument } from '../docs/index.js'
import { replayCanvas } from '../../canvas-format/index.js'
import { prototypeRouteParts, resolveNotebookArtifact, resolveNotebookAsset } from './resolver.js'
import { diagnoseArtifactRoutes, normalizeRouteBase, parseArtifactPath } from './notebook-routes.js'

const PROTOTYPE_PREFIX = '/__notebook/prototypes/'
const STATIC_PROTOTYPE_PREFIX = 'prototypes/'
const REFRESH_EVENT = 'design-notebook:refresh'
const BUILD_OUTPUT_MANIFEST = '.design-notebook-output.json'
const PACKAGE_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SHELL_ENTRY = fileURLToPath(new URL('./shell-entry.js', import.meta.url))
const HYPERCANVAS_NOTEBOOK_CHROME = fileURLToPath(new URL('../../vendor/hypercanvas/NotebookShell/NotebookChrome.jsx', import.meta.url))
const HYPERCANVAS_TAILWIND_SOURCE = fileURLToPath(new URL('../../vendor/hypercanvas/generated/tailwind.source.css', import.meta.url))
const HOST_OPTIMIZE_DEPS = [
  'react', 'react-dom/client', 'react-markdown',
  '@base-ui/react/button', '@base-ui/react/dialog', '@base-ui/react/input',
  '@base-ui/react/merge-props', '@base-ui/react/separator', '@base-ui/react/tooltip',
  '@base-ui/react/use-render',
  'class-variance-authority', 'clsx', 'lucide-react', 'tailwind-merge',
  // Base UI imports these CJS shim subpaths from its ESM store hooks. Include
  // them explicitly because the package entrypoints live outside notebook root
  // and dependency discovery is intentionally disabled for notebook content.
  'use-sync-external-store/shim', 'use-sync-external-store/shim/with-selector',
]
// The dependency optimizer resolves `optimizeDeps.include` entries through
// package-root node resolution anchored at the notebook root, which fails for
// notebooks outside the package installation. Alias every closure entry to
// the exact module file the browser ESM graph would load anyway (`import`
// condition resolved from the package), so external notebook roots prebundle
// the same chrome dependency closure. Longest first: string aliases also
// match subpaths, so `shim` must not shadow `shim/with-selector`.
const HOST_CLOSURE_ALIASES = HOST_OPTIMIZE_DEPS.slice(3)
  .sort((a, b) => b.length - a.length)
  .map(id => ({ find: id, replacement: fileURLToPath(import.meta.resolve(id)) }))
const require = createRequire(import.meta.url)
const hostAliases = [
  { find: 'design-notebook/shell', replacement: fileURLToPath(new URL('../../client/shell/index.js', import.meta.url)) },
  { find: 'design-notebook/docs', replacement: fileURLToPath(new URL('../../client/docs/index.js', import.meta.url)) },
  { find: 'design-notebook/sites', replacement: fileURLToPath(new URL('../../client/sites/index.js', import.meta.url)) },
  { find: 'design-notebook/runtime/route', replacement: fileURLToPath(new URL('./route.js', import.meta.url)) },
  { find: 'design-notebook/runtime/notebook-routes', replacement: fileURLToPath(new URL('./notebook-routes.js', import.meta.url)) },
  { find: 'design-notebook/runtime/react', replacement: fileURLToPath(new URL('./react.js', import.meta.url)) },
  { find: 'design-notebook/runtime', replacement: fileURLToPath(new URL('./index.js', import.meta.url)) },
  { find: '@dfosco/statefully/react', replacement: require.resolve('@dfosco/statefully/react') },
  { find: '@dfosco/statefully', replacement: require.resolve('@dfosco/statefully') },
  { find: /^react-dom(\/.*)?$/, replacement: id => require.resolve(id) },
  { find: /^react(\/.*)?$/, replacement: id => require.resolve(id) },
  { find: /^react-markdown$/, replacement: require.resolve('react-markdown') },
  ...HOST_CLOSURE_ALIASES,
]

const hostDependencyPlugin = {
  name: 'design-notebook-host-dependencies',
  enforce: 'pre',
  resolveId(id) {
    if (id === 'design-notebook/shell') return fileURLToPath(new URL('../../client/shell/index.js', import.meta.url))
    if (id === 'design-notebook/docs') return fileURLToPath(new URL('../../client/docs/index.js', import.meta.url))
    if (id === 'design-notebook/sites') return fileURLToPath(new URL('../../client/sites/index.js', import.meta.url))
    if (id === 'design-notebook/runtime/route') return fileURLToPath(new URL('./route.js', import.meta.url))
    if (id === 'design-notebook/runtime/notebook-routes') return fileURLToPath(new URL('./notebook-routes.js', import.meta.url))
    if (id === 'design-notebook/runtime/react') return fileURLToPath(new URL('./react.js', import.meta.url))
    if (id === 'design-notebook/runtime') return fileURLToPath(new URL('./index.js', import.meta.url))
    if (id === '@dfosco/statefully' || id === '@dfosco/statefully/react') return require.resolve(id)
    if (id === 'react' || id.startsWith('react/')) return require.resolve(id)
    if (id === 'react-dom' || id.startsWith('react-dom/')) return require.resolve(id)
    return undefined
  },
}

function runtimeChromeStylesPlugin() {
  let command = 'serve'
  return {
    name: 'design-notebook-hypercanvas-style-entry',
    enforce: 'pre',
    configResolved(config) { command = config.command },
    resolveId(source, importer) {
      if (command !== 'serve' || !importer || path.resolve(importer.split('?')[0]) !== HYPERCANVAS_NOTEBOOK_CHROME) return null
      if (['../generated/tailwind.css', '../generated/tailwind.source.css'].includes(source.split('?')[0])) {
        return HYPERCANVAS_TAILWIND_SOURCE
      }
      return null
    },
  }
}

export { createPrototypeRouteBinding, prototypeRouteBasePath } from './route.js'

function normalizeBase(base) {
  return normalizeRouteBase(base)
}

function encodeId(id) {
  return encodeURIComponent(id)
}

function decodeId(id) {
  try { return decodeURIComponent(id) } catch { return null }
}

function stateRoots(graph) {
  return graph.artifacts
    .filter(artifact => artifact.available && artifact.kind === 'prototype' && artifact.runtime?.id === '@dfosco/statefully')
    .map(artifact => ({
      path: path.resolve(graph.root, artifact.folderPath, 'state'),
      identityRoot: artifact.id,
      scope: artifact.id,
      identityProfile: 'standalone',
    }))
}

function rootsKey(roots) {
  return JSON.stringify(roots.map(root => [root.path, root.identityRoot, root.scope, root.identityProfile]))
}

function response(res, status, body, contentType = 'application/json; charset=utf-8', headers = {}) {
  res.statusCode = status
  res.setHeader('content-type', contentType)
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  const payload = contentType.startsWith('application/json') && !Buffer.isBuffer(body) ? JSON.stringify(body) : body
  res.end(payload)
}

function requestFailure(statusCode, code, message, details = {}) {
  return Object.assign(new Error(message), { statusCode, code, details })
}

function canvasRevision(bytes) {
  return `"sha256-${crypto.createHash('sha256').update(bytes).digest('hex')}"`
}

function sameOriginMutationRequest(req) {
  const origin = req.headers.origin
  const host = req.headers.host
  if (typeof origin !== 'string' || typeof host !== 'string' || !host) return false
  if (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin') return false
  try {
    const parsed = new URL(origin)
    const protocol = req.socket.encrypted ? 'https:' : 'http:'
    return parsed.origin === new URL(`${protocol}//${host}`).origin
  } catch {
    return false
  }
}

async function readJsonRequest(req, maximumBytes = 8 * 1024) {
  const contentType = req.headers['content-type']
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    const error = new Error('Content-Type must be application/json.')
    error.statusCode = 415
    error.code = 'UNSUPPORTED_CONTENT_TYPE'
    throw error
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maximumBytes) {
      const error = new Error('Canvas geometry request is too large.')
      error.statusCode = 413
      error.code = 'REQUEST_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  let value
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch {
    const error = new Error('Request body must be valid JSON.')
    error.statusCode = 400
    error.code = 'INVALID_JSON'
    throw error
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const error = new Error('Request body must be a JSON object.')
    error.statusCode = 400
    error.code = 'INVALID_REQUEST'
    throw error
  }
  return value
}

function validateGeometryRequest(value) {
  const allowed = value.operation === 'move'
    ? new Set(['widgetId', 'operation', 'position'])
    : value.operation === 'resize'
      ? new Set(['widgetId', 'operation', 'width', 'height'])
      : new Set(['widgetId', 'operation'])
  if (Object.keys(value).some(key => !allowed.has(key))) {
    throw requestFailure(400, 'INVALID_GEOMETRY_REQUEST', 'Only a widget ID and one move or resize geometry operation are accepted.')
  }
  if (typeof value.widgetId !== 'string' || !value.widgetId.trim()) {
    throw requestFailure(400, 'INVALID_GEOMETRY_REQUEST', 'widgetId must be a non-empty string.')
  }
  if (value.operation === 'move') {
    const position = value.position
    if (!position || typeof position !== 'object' || Array.isArray(position) ||
      Object.keys(position).some(key => key !== 'x' && key !== 'y') ||
      !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw requestFailure(400, 'INVALID_GEOMETRY_REQUEST', 'Move position must contain only finite x and y coordinates.')
    }
    return { widgetId: value.widgetId, event: { event: 'widget_moved', widgetId: value.widgetId, position: { x: position.x, y: position.y } } }
  }
  if (value.operation === 'resize') {
    if (!Number.isFinite(value.width) || value.width <= 0 || !Number.isFinite(value.height) || value.height <= 0) {
      throw requestFailure(400, 'INVALID_GEOMETRY_REQUEST', 'Resize width and height must be positive finite numbers.')
    }
    return { widgetId: value.widgetId, event: { event: 'widget_updated', widgetId: value.widgetId, props: { width: value.width, height: value.height } } }
  }
  throw requestFailure(400, 'INVALID_GEOMETRY_REQUEST', 'operation must be "move" or "resize".')
}

function geometryForCanvasWidget(widget) {
  const geometry = {
    x: widget.position?.x ?? 0,
    y: widget.position?.y ?? 0,
    width: widget.props?.width ?? 320,
    height: widget.props?.height ?? 180,
  }
  return Object.values(geometry).every(Number.isFinite) && geometry.width > 0 && geometry.height > 0
    ? geometry
    : { x: 0, y: 0, width: 320, height: 180 }
}

function readWritableCanvas(notebookRoot, canvasId) {
  const graph = discoverNotebook(notebookRoot)
  const matches = graph.artifacts.filter(artifact => artifact.kind === 'canvas' && artifact.id === canvasId)
  if (!matches.length) throw requestFailure(404, 'CANVAS_NOT_FOUND', `Canvas "${canvasId}" was not found.`)
  if (matches.length !== 1) throw requestFailure(422, 'CANVAS_ID_AMBIGUOUS', `Canvas ID "${canvasId}" is not unique.`)
  const artifact = matches[0]
  if (!artifact.available) {
    throw requestFailure(422, 'CANVAS_NOT_WRITABLE', 'Canvas discovery reports invalid or unavailable content.', { diagnostics: artifact.diagnostics })
  }
  let absolute
  let realFile
  let bytes
  try {
    absolute = resolveNotebookPath(notebookRoot, '', artifact.descriptorPath)
    if (fs.lstatSync(absolute).isSymbolicLink()) throw new Error('Canvas payload cannot be a symbolic link.')
    realFile = fs.realpathSync.native(absolute)
    const realFolder = fs.realpathSync.native(resolveNotebookPath(notebookRoot, '', artifact.folderPath))
    if (!isWithin(notebookRoot, realFile) || path.dirname(realFile) !== realFolder || !fs.statSync(realFile).isFile()) {
      throw new Error('Canvas payload must remain a regular file inside its discovered artifact folder.')
    }
    bytes = fs.readFileSync(realFile)
  } catch (error) {
    throw requestFailure(422, 'CANVAS_NOT_WRITABLE', `Canvas payload is unavailable: ${error.message}`)
  }
  const source = bytes.toString('utf8')
  const replay = replayCanvas(source)
  if (replay.status !== 'complete' || replay.canvasId !== canvasId) {
    throw requestFailure(422, 'CANVAS_NOT_WRITABLE', 'Canvas must have a complete event stream and matching stable canvasId before geometry can be saved.', {
      canvasId: replay.canvasId ?? null,
      status: replay.status,
      diagnostics: replay.diagnostics,
    })
  }
  return { artifact, bytes, source, replay, file: realFile, revision: canvasRevision(bytes) }
}

function canvasWriteConflict(canvas) {
  return requestFailure(409, 'CANVAS_REVISION_CONFLICT', 'Canvas changed since this geometry was loaded. Reload before saving again.', {
    revision: canvas.revision,
  })
}

function htmlFilesBelow(directory) {
  const result = []
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...htmlFilesBelow(absolute))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) result.push(absolute)
  }
  return result
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function validateOutputRoot(notebookRoot, outputRoot) {
  const canonicalOutputRoot = canonicalExistingPath(outputRoot)
  if (canonicalOutputRoot === notebookRoot) throw new Error('Build output cannot be the notebook root.')
  if (isWithin(canonicalOutputRoot, notebookRoot)) throw new Error('Build output cannot be an ancestor of the notebook root.')
  if (isWithin(notebookRoot, canonicalOutputRoot)) {
    const relative = path.relative(notebookRoot, canonicalOutputRoot)
    const topLevel = relative.split(path.sep)[0]
    if (!NOTEBOOK_INFRASTRUCTURE_DIRECTORIES.has(topLevel)) {
      throw new Error(`Build output inside the notebook must use an infrastructure output directory (dist, build, or out); received: ${relative}`)
    }
  }
}

function filesBelow(directory) {
  const files = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Build output contains a symbolic link: ${absolute}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(path.relative(directory, absolute).split(path.sep).join('/'))
      else throw new Error(`Build output contains an unsupported entry: ${absolute}`)
    }
  }
  visit(directory)
  return files.sort()
}

function directoriesBelow(directory) {
  const directories = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(`Build output contains a symbolic link: ${path.join(current, entry.name)}`)
      if (!entry.isDirectory()) continue
      const absolute = path.join(current, entry.name)
      directories.push(path.relative(directory, absolute).split(path.sep).join('/'))
      visit(absolute)
    }
  }
  visit(directory)
  return directories.sort()
}

function fileHash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function cleanGeneratedTarget(target, artifactId) {
  if (!fs.existsSync(target)) return
  const stat = fs.lstatSync(target)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Build output target is not a safe directory: ${target}`)
  const manifestPath = path.join(target, BUILD_OUTPUT_MANIFEST)
  const entries = fs.readdirSync(target)
  if (!entries.length) return
  if (!fs.existsSync(manifestPath)) throw new Error(`Refusing to overwrite unowned build output: ${target}`)
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch {
    throw new Error(`Refusing to overwrite build output with an invalid ownership manifest: ${target}`)
  }
  if (manifest?.formatVersion !== 1 || manifest.artifactId !== artifactId || !Array.isArray(manifest.files) || !Array.isArray(manifest.directories)) {
    throw new Error(`Refusing to overwrite build output not owned by artifact ${artifactId}: ${target}`)
  }
  const listed = new Map()
  for (const item of manifest.files) {
    if (!item || typeof item.path !== 'string' || item.path.startsWith('/') || item.path.split('/').some(part => !part || part === '.' || part === '..') || typeof item.sha256 !== 'string') {
      throw new Error(`Refusing to overwrite output with an invalid file manifest: ${target}`)
    }
    listed.set(item.path, item.sha256)
  }
  const actual = filesBelow(target).filter(file => file !== BUILD_OUTPUT_MANIFEST)
  const actualDirectories = directoriesBelow(target)
  if (actual.length !== listed.size || actual.some(file => !listed.has(file)) ||
    actualDirectories.length !== manifest.directories.length || actualDirectories.some((directory, index) => directory !== manifest.directories[index])) {
    throw new Error(`Refusing to overwrite build output containing unowned files: ${target}`)
  }
  for (const file of actual) {
    if (fileHash(path.join(target, ...file.split('/'))) !== listed.get(file)) {
      throw new Error(`Refusing to overwrite modified build output: ${file}`)
    }
  }
  for (const file of actual) fs.rmSync(path.join(target, ...file.split('/')))
  fs.rmSync(manifestPath)
  function removeEmptyDirectories(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const child = path.join(directory, entry.name)
      if (entry.isDirectory()) removeEmptyDirectories(child)
    }
    if (directory !== target && fs.readdirSync(directory).length === 0) fs.rmdirSync(directory)
  }
  removeEmptyDirectories(target)
}

function writeGeneratedManifest(target, artifactId) {
  const files = filesBelow(target).filter(file => file !== BUILD_OUTPUT_MANIFEST)
    .map(file => ({ path: file, sha256: fileHash(path.join(target, ...file.split('/'))) }))
  const directories = directoriesBelow(target)
  fs.writeFileSync(path.join(target, BUILD_OUTPUT_MANIFEST), JSON.stringify({ formatVersion: 1, artifactId, files, directories }, null, 2))
}

function routeOutputPath(target, route) {
  const segments = routeSegments({ path: route ?? '/' }).map(segment => decodeURIComponent(segment))
  if (!segments.length) return path.join(target, 'index.html')
  return segments.at(-1).toLowerCase().endsWith('.html')
    ? path.join(target, ...segments)
    : path.join(target, ...segments, 'index.html')
}

function writeStaticViewRoutes(target, artifact) {
  const htmlFiles = htmlFilesBelow(target)
  if (htmlFiles.length !== 1) throw new Error(`Expected one built HTML entry, received ${htmlFiles.length}.`)
  const html = fs.readFileSync(htmlFiles[0], 'utf8')
  fs.writeFileSync(path.join(target, 'index.html'), html)
  for (const view of artifact.views ?? []) {
    const destination = routeOutputPath(target, view.path)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, html)
  }
  if (!artifact.views?.some(view => view.path === '/')) fs.writeFileSync(path.join(target, 'index.html'), html)
  if (htmlFiles[0] !== path.join(target, 'index.html')) fs.rmSync(htmlFiles[0], { force: true })
}

function routeSegments(view) {
  return prototypeRouteParts(view).segments
}

function canonicalExistingPath(candidate) {
  let current = path.resolve(candidate)
  const suffix = []
  while (!fs.existsSync(current) && path.dirname(current) !== current) {
    suffix.unshift(path.basename(current))
    current = path.dirname(current)
  }
  return path.join(fs.realpathSync.native(current), ...suffix)
}

function watchTreeIsReady(watcher, root) {
  const watched = watcher.getWatched()
  let ready = true
  function visit(directory) {
    if (!Object.hasOwn(watched, directory)) { ready = false; return }
    let entries
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || NOTEBOOK_INFRASTRUCTURE_DIRECTORIES.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && !watched[directory]?.includes(entry.name)) ready = false
    }
  }
  visit(root)
  return ready
}

function missingWatchedPaths(watcher, root) {
  const watched = watcher.getWatched()
  const missing = []
  function visit(directory) {
    if (!Object.hasOwn(watched, directory)) { missing.push(directory); return }
    let entries
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || NOTEBOOK_INFRASTRUCTURE_DIRECTORIES.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && !watched[directory]?.includes(entry.name)) missing.push(absolute)
    }
  }
  visit(root)
  return missing
}

function contentPaths(root) {
  const paths = [root]
  function visit(directory) {
    let entries
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || NOTEBOOK_INFRASTRUCTURE_DIRECTORIES.has(entry.name)) continue
      const absolute = path.join(directory, entry.name)
      paths.push(absolute)
      if (entry.isDirectory()) visit(absolute)
    }
  }
  visit(root)
  return paths
}

async function waitForWatchTree(watcher, root) {
  const deadline = Date.now() + 5000
  while (!watchTreeIsReady(watcher, root)) {
    if (Date.now() >= deadline) throw new Error(`Filesystem watcher did not finish scanning the notebook root: ${missingWatchedPaths(watcher, root).join(', ')}`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

function makeResolver(getGraph, getDevOrigin, base) {
  return {
    resolveArtifact(reference, options = {}) {
      const graph = getGraph()
      return resolveNotebookArtifact(graph, reference, { ...options, base, origin: getDevOrigin() ?? '' })
    },
    resolveAsset(reference, { basePath = '', mode = 'local' } = {}) {
      const graph = getGraph()
      const result = resolveNotebookAsset(graph, reference, { basePath, mode, base })
      if (!result.available || /^https?:\/\//i.test(reference)) return result
      try {
        resolveNotebookPath(graph.root, basePath, reference)
        return result
      } catch (error) {
        return { available: false, diagnostics: [{ code: 'UNAVAILABLE_ASSET', message: error.message }] }
      }
    },
  }
}

function createDocumentModulesPlugin(runtime) {
  const prefix = '\0design-notebook-document:'
  return {
    name: 'design-notebook-document-modules',
    resolveId(source) {
      const match = source.match(/^\/__notebook\/artifacts\/([^/]+)\/document\.js(?:\?.*)?$/)
      if (!match) return null
      const id = decodeId(match[1])
      return id ? `${prefix}${encodeURIComponent(id)}` : null
    },
    async load(id) {
      if (!id.startsWith(prefix)) return null
      const artifactId = decodeURIComponent(id.slice(prefix.length))
      const graph = runtime.getSnapshot()
      const artifact = graph.artifacts.find(item => item.id === artifactId && item.kind === 'doc' && item.available)
      if (!artifact) return 'export default null; export const designNotebookDiagnostics = [];'
      try {
        const absolute = resolveNotebookPath(runtime.root, '', artifact.payloadPath)
        const realFile = fs.realpathSync.native(absolute)
        if (!isWithin(runtime.root, realFile) || !fs.statSync(realFile).isFile()) throw new Error('Document payload is unavailable.')
        const source = fs.readFileSync(realFile, 'utf8')
        const result = await compileDocument(source, { artifact, artifacts: graph.artifacts })
        const diagnostics = JSON.stringify(result.diagnostics)
        if (!result.available || !result.compiledSource) return `export default null;\nexport const designNotebookDiagnostics = ${diagnostics};`
        return `${result.compiledSource}\nexport const designNotebookDiagnostics = ${diagnostics};`
      } catch (error) {
        const diagnostics = JSON.stringify([{ code: 'DOCUMENT_LOAD_FAILED', severity: 'error', path: artifact.path, message: error.message }])
        return `export default null;\nexport const designNotebookDiagnostics = ${diagnostics};`
      }
    },
  }
}

function createRoutesPlugin(runtime, normalizedBase) {
  const canvasWriteTails = new Map()
  async function withCanvasWriteLock(canvasId, action) {
    const previous = canvasWriteTails.get(canvasId) ?? Promise.resolve()
    let release
    const gate = new Promise(resolve => { release = resolve })
    const tail = previous.then(() => gate)
    canvasWriteTails.set(canvasId, tail)
    await previous
    try { return await action() } finally {
      release()
      if (canvasWriteTails.get(canvasId) === tail) canvasWriteTails.delete(canvasId)
    }
  }

  async function saveCanvasGeometry(canvasId, request, expectedRevision) {
    return withCanvasWriteLock(canvasId, () => {
      let canvas = readWritableCanvas(runtime.root, canvasId)
      if (canvas.revision !== expectedRevision) throw canvasWriteConflict(canvas)
      let widget = canvas.replay.state.widgets.find(item => item.id === request.widgetId)
      if (!widget) throw requestFailure(422, 'CANVAS_WIDGET_NOT_FOUND', `Widget "${request.widgetId}" does not exist in canvas "${canvasId}".`)

      const nextSource = `${canvas.source}${canvas.source.endsWith('\n') ? '' : '\n'}${JSON.stringify(request.event)}\n`
      const nextReplay = replayCanvas(nextSource)
      if (nextReplay.status !== 'complete' || nextReplay.canvasId !== canvasId) {
        throw requestFailure(422, 'CANVAS_NOT_WRITABLE', 'Geometry update would not produce a complete canvas event stream.', {
          status: nextReplay.status,
          diagnostics: nextReplay.diagnostics,
        })
      }

      // Check the exact bytes again immediately before append. In-process writers
      // are serialized above; an intervening editor change becomes a conflict.
      let latestBytes
      try {
        if (fs.lstatSync(canvas.file).isSymbolicLink()) throw new Error('Canvas payload became a symbolic link.')
        const realFile = fs.realpathSync.native(canvas.file)
        if (!isWithin(runtime.root, realFile) || realFile !== canvas.file) throw new Error('Canvas payload moved outside its discovered path.')
        latestBytes = fs.readFileSync(realFile)
      } catch (error) {
        throw requestFailure(422, 'CANVAS_NOT_WRITABLE', `Canvas payload changed before save: ${error.message}`)
      }
      if (canvasRevision(latestBytes) !== expectedRevision) {
        canvas = readWritableCanvas(runtime.root, canvasId)
        throw canvasWriteConflict(canvas)
      }

      const delimiter = canvas.source.length > 0 && !canvas.source.endsWith('\n') ? '\n' : ''
      fs.appendFileSync(canvas.file, `${delimiter}${JSON.stringify(request.event)}\n`)
      const savedBytes = fs.readFileSync(canvas.file)
      const savedSource = savedBytes.toString('utf8')
      const savedReplay = replayCanvas(savedSource)
      if (savedReplay.status !== 'complete' || savedReplay.canvasId !== canvasId) {
        throw requestFailure(500, 'CANVAS_WRITE_VERIFY_FAILED', 'Saved canvas could not be replayed as a complete stream.')
      }
      widget = savedReplay.state.widgets.find(item => item.id === request.widgetId)
      if (!widget) throw requestFailure(500, 'CANVAS_WRITE_VERIFY_FAILED', 'Saved widget geometry could not be verified.')
      return {
        revision: canvasRevision(savedBytes),
        event: request.event,
        geometry: geometryForCanvasWidget(widget),
      }
    })
  }

  return {
    name: 'design-notebook-runtime-routes',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = new URL(req.url ?? '/', 'http://notebook.invalid').pathname
        const methodCanOpenShell = ['GET', 'HEAD'].includes(req.method ?? 'GET')
        const baseRoot = normalizedBase === '/' ? '/' : normalizedBase.slice(0, -1)
        const isInternalRoute = pathname.startsWith('/__notebook/')
        const shellRoute = parseArtifactPath(req.url ?? '/', { artifacts: runtime.getSnapshot().artifacts, base: normalizedBase })
        if (methodCanOpenShell && !isInternalRoute && (pathname === baseRoot || pathname === normalizedBase || shellRoute.status === 'matched' || shellRoute.status === 'ambiguous' || shellRoute.artifact)) {
          const source = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Design Notebook</title></head><body><div id="design-notebook-root"></div><script type="module" src="/@fs${SHELL_ENTRY}"></script></body></html>`
          const html = await server.transformIndexHtml(req.url ?? '/', source)
          response(res, 200, html, 'text/html; charset=utf-8')
          return
        }
        if (pathname === '/__notebook/graph' && req.method === 'GET') {
          const snapshot = runtime.getSnapshot()
          const routeDiagnostics = diagnoseArtifactRoutes(snapshot.artifacts, { base: normalizedBase })
          response(res, 200, { ...snapshot, diagnostics: [...snapshot.diagnostics, ...routeDiagnostics], routeDiagnostics, routeBase: normalizedBase })
          return
        }
        const geometryMatch = pathname.match(/^\/__notebook\/artifacts\/([^/]+)\/geometry$/)
        if (geometryMatch) {
          if (req.method !== 'POST') {
            response(res, 405, { code: 'METHOD_NOT_ALLOWED', message: 'Canvas geometry accepts POST requests only.' }, 'application/json; charset=utf-8', { allow: 'POST' })
            return
          }
          if (!sameOriginMutationRequest(req)) {
            response(res, 403, { code: 'CROSS_ORIGIN_FORBIDDEN', message: 'Canvas geometry saves require a same-origin local notebook request.' })
            return
          }
          const canvasId = decodeId(geometryMatch[1])
          if (!canvasId) {
            response(res, 404, { code: 'CANVAS_NOT_FOUND', message: 'Canvas ID is invalid.' })
            return
          }
          try {
            const request = validateGeometryRequest(await readJsonRequest(req))
            const expectedRevision = req.headers['if-match']
            if (typeof expectedRevision !== 'string') throw requestFailure(428, 'CANVAS_REVISION_REQUIRED', 'If-Match must contain the ETag from the loaded canvas.')
            if (!/^"sha256-[a-f0-9]{64}"$/.test(expectedRevision)) throw requestFailure(400, 'INVALID_CANVAS_REVISION', 'If-Match must contain a valid canvas ETag.')
            const saved = await saveCanvasGeometry(canvasId, request, expectedRevision)
            response(res, 200, saved, 'application/json; charset=utf-8', { etag: saved.revision, 'cache-control': 'no-store' })
          } catch (error) {
            const status = Number.isInteger(error.statusCode) ? error.statusCode : 500
            const body = {
              code: error.code ?? 'CANVAS_WRITE_FAILED',
              message: status === 500 ? 'Unable to save canvas geometry.' : error.message,
              ...error.details,
            }
            response(res, status, body, 'application/json; charset=utf-8', {
              ...(typeof error.details?.revision === 'string' ? { etag: error.details.revision } : {}),
              'cache-control': 'no-store',
            })
          }
          return
        }
        if (pathname === '/__notebook/notebook.css' && ['GET', 'HEAD'].includes(req.method ?? 'GET')) {
          const stylesheet = path.join(runtime.root, 'notebook.css')
          try {
            const stat = fs.lstatSync(stylesheet)
            if (!stat.isFile() || stat.isSymbolicLink()) return response(res, 404, { error: 'Notebook stylesheet not found.' })
            response(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(stylesheet, 'utf8'), 'text/css; charset=utf-8')
          } catch (error) {
            if (error.code === 'ENOENT') {
              res.statusCode = 204
              res.end()
            } else {
              response(res, 500, { error: 'Unable to read notebook stylesheet.', message: error.message })
            }
          }
          return
        }
        const payloadMatch = pathname.match(/^\/__notebook\/artifacts\/([^/]+)\/(canvas|document\.js)$/)
        if (payloadMatch && ['GET', 'HEAD'].includes(req.method ?? 'GET')) {
          const id = decodeId(payloadMatch[1])
          const kind = payloadMatch[2] === 'canvas' ? 'canvas' : 'doc'
          const artifact = id && runtime.getSnapshot().artifacts.find(item => item.id === id && item.kind === kind && item.available)
          if (!artifact) return response(res, 404, { error: `${kind === 'canvas' ? 'Canvas' : 'Document'} not found.` })
          try {
            const relativeFile = kind === 'canvas' ? artifact.descriptorPath : artifact.payloadPath
            const absoluteFile = resolveNotebookPath(runtime.root, '', relativeFile)
            const realFile = fs.realpathSync.native(absoluteFile)
            if (!isWithin(runtime.root, realFile) || !fs.statSync(realFile).isFile()) return response(res, 404, { error: 'Artifact payload is unavailable.' })
            if (kind === 'canvas') {
              const bytes = fs.readFileSync(realFile)
              response(res, 200, req.method === 'HEAD' ? '' : bytes, 'application/x-ndjson; charset=utf-8', { etag: canvasRevision(bytes), 'cache-control': 'no-store' })
            } else {
              const transformed = await server.transformRequest(req.url ?? pathname)
              response(res, 200, req.method === 'HEAD' ? '' : transformed?.code ?? '', 'text/javascript; charset=utf-8')
            }
          } catch (error) {
            response(res, 404, { error: 'Artifact payload is unavailable.', message: error.message })
          }
          return
        }
        if (!pathname.startsWith(PROTOTYPE_PREFIX) || !['GET', 'HEAD'].includes(req.method ?? 'GET')) return next()
        const encoded = pathname.slice(PROTOTYPE_PREFIX.length).split('/')[0]
        const id = decodeId(encoded)
        const artifact = id && runtime.getSnapshot().artifacts.find(item => item.id === id && item.kind === 'prototype' && item.available)
        if (!artifact) return response(res, 404, { error: 'Prototype not found.' })
        const entry = path.resolve(runtime.root, artifact.folderPath, artifact.entry)
        if (!entry.startsWith(`${runtime.root}${path.sep}`)) return response(res, 404, { error: 'Prototype entry is unavailable.' })
        try {
          let sourceHtml = fs.readFileSync(entry, 'utf8')
          const entryDirectory = path.posix.dirname(artifact.entry)
          const sourcePrefix = `/${artifact.folderPath.split('/').map(encodeURIComponent).join('/')}/${entryDirectory === '.' ? '' : `${entryDirectory}/`}`
          sourceHtml = sourceHtml.replace(/\b(src|href)=(['"])(\.{1,2}\/[^'"]+)\2/g, (_match, attribute, quote, relative) => {
            const resolved = path.posix.normalize(path.posix.join(sourcePrefix, relative))
            return `${attribute}=${quote}${resolved}${quote}`
          })
          let html = await server.transformIndexHtml(req.url, sourceHtml, entry)
          html = html.replaceAll(`${PROTOTYPE_PREFIX}${encoded}/`, sourcePrefix)
          response(res, 200, html, 'text/html; charset=utf-8')
        } catch (error) {
          response(res, 500, { error: 'Unable to transform prototype entry.', message: error.message })
        }
      })
    },
  }
}

/** Create the single read-only dev runtime for a notebook folder. */
export async function createNotebookRuntime({ root, base = '/', host = '127.0.0.1', port = 0 } = {}) {
  if (typeof root !== 'string' || !root) throw new TypeError('root is required.')
  const notebookRoot = fs.realpathSync.native(path.resolve(root))
  const normalizedBase = normalizeBase(base)
  let graph = discoverNotebook(notebookRoot)
  const runtime = { root: notebookRoot, getSnapshot: () => graph }
  let publicAddress = null
  const resolver = makeResolver(() => graph, () => publicAddress, normalizedBase)
  const statePlugin = statefully({ roots: stateRoots(graph), mode: 'development' })
  let server
  let watcher
  let watcherReady
  let debounce
  let revision = 0
  const listeners = new Set()

  async function refresh(file) {
    const next = discoverNotebook(notebookRoot)
    const nextRoots = stateRoots(next)
    if (rootsKey(nextRoots) !== rootsKey(stateRoots(graph))) statePlugin.api.setRoots(nextRoots)
    graph = next
    revision += 1
    const changedPath = file ? canonicalExistingPath(file) : null
    const event = { revision, root: notebookRoot, file: changedPath ? path.relative(notebookRoot, changedPath).split(path.sep).join('/') : null, diagnostics: graph.diagnostics, artifacts: graph.artifacts }
    server?.ws.send(REFRESH_EVENT, event)
    for (const listener of listeners) listener(event)
  }

  const vitePlugin = {
    name: 'design-notebook-read-only-watcher',
    configureServer(viteServer) {
      server = viteServer
      watcher = viteServer.watcher
      watcherReady = new Promise(resolve => watcher.once('ready', resolve))
      const onChange = file => {
        const changed = canonicalExistingPath(file)
        const relative = path.relative(notebookRoot, changed)
        if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return
        clearTimeout(debounce)
        debounce = setTimeout(() => refresh(file), 35)
      }
      const onAll = (_event, file) => onChange(file)
      watcher.add(notebookRoot)
      watcher.on('all', onAll)
      viteServer.httpServer?.once('close', () => {
        clearTimeout(debounce)
        watcher.off('all', onAll)
      })
    },
  }

  const vite = await createViteServer({
    root: notebookRoot,
    configFile: false,
    appType: 'custom',
    server: { host, port, strictPort: false, fs: { allow: [notebookRoot, PACKAGE_ROOT] } },
    plugins: [
      hostDependencyPlugin,
      runtimeChromeStylesPlugin(),
      coreCss({ packageRoot: PACKAGE_ROOT }),
      createDocumentModulesPlugin(runtime),
      statePlugin,
      react(),
      vitePlugin,
      createRoutesPlugin(runtime, normalizedBase),
    ],
    resolve: { alias: hostAliases, dedupe: ['react', 'react-dom'] },
    // The notebook entry is outside the package. Resolve this transitive
    // CommonJS-bearing dependency from the package installation explicitly so
    // Vite prebundles it regardless of the notebook's location.
    optimizeDeps: { noDiscovery: true, entries: [], include: HOST_OPTIMIZE_DEPS },
  })

  return {
    root: notebookRoot,
    mode: 'development',
    server: vite,
    get address() {
      const address = vite.httpServer?.address()
      return address && typeof address === 'object' ? `http://${host}:${address.port}` : null
    },
    getSnapshot: () => graph,
    resolveArtifact: resolver.resolveArtifact,
    resolveAsset: resolver.resolveAsset,
    onRefresh(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async start() {
      await vite.listen()
      await watcherReady
      vite.watcher.add(contentPaths(notebookRoot))
      await waitForWatchTree(vite.watcher, notebookRoot)
      publicAddress = this.address
      return this
    },
    async close() { await vite.close(); listeners.clear() },
  }
}

/** Build all available Statefully prototypes with the same pinned runtime and URL layout as development. */
export async function buildNotebook({ root, outDir = 'dist', base = '/' } = {}) {
  if (typeof root !== 'string' || !root) throw new TypeError('root is required.')
  const notebookRoot = fs.realpathSync.native(path.resolve(root))
  const normalizedBase = normalizeBase(base)
  const graph = discoverNotebook(notebookRoot)
  const prototypes = graph.artifacts.filter(item => item.kind === 'prototype' && item.available && item.runtime?.id === '@dfosco/statefully')
  const outputRoot = path.resolve(notebookRoot, outDir)
  validateOutputRoot(notebookRoot, outputRoot)
  fs.mkdirSync(outputRoot, { recursive: true })
  const results = []
  for (const artifact of prototypes) {
    const prefix = `${normalizedBase}${STATIC_PROTOTYPE_PREFIX}${encodeId(artifact.id)}/`
    const target = path.join(outputRoot, STATIC_PROTOTYPE_PREFIX, artifact.id)
    try {
      cleanGeneratedTarget(target, artifact.id)
    } catch (error) {
      results.push({ artifactId: artifact.id, outDir: target, diagnostics: [{ code: 'BUILD_OUTPUT_COLLISION', message: error.message }] })
      continue
    }
    fs.mkdirSync(target, { recursive: true })
    const statePlugin = statefully({ roots: stateRoots({ ...graph, artifacts: [artifact] }), mode: 'production' })
    try {
      const result = await viteBuild({
        root: notebookRoot,
        configFile: false,
        base: prefix,
        plugins: [hostDependencyPlugin, statePlugin, react()],
        resolve: { alias: hostAliases, dedupe: ['react', 'react-dom'] },
        build: {
          outDir: target,
          emptyOutDir: false,
          rollupOptions: { input: { index: path.resolve(notebookRoot, artifact.folderPath, artifact.entry) } },
        },
      })
      writeStaticViewRoutes(target, artifact)
      writeGeneratedManifest(target, artifact.id)
      results.push({ artifactId: artifact.id, outDir: target, url: `${prefix}`, result })
    } catch (error) {
      results.push({ artifactId: artifact.id, outDir: target, diagnostics: [{ code: 'PROTOTYPE_BUILD_FAILED', message: error.message }] })
    }
  }
  const publicGraph = { root: notebookRoot, entries: graph.entries, artifacts: graph.artifacts, diagnostics: graph.diagnostics }
  return { root: notebookRoot, outDir: outputRoot, base: normalizedBase, entries: graph.entries, artifacts: graph.artifacts, diagnostics: graph.diagnostics, graph: publicGraph, prototypes: results }
}

export const NOTEBOOK_RUNTIME_REFRESH_EVENT = REFRESH_EVENT
