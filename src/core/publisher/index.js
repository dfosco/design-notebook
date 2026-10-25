import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build as viteBuild } from 'vite'
import react from '@vitejs/plugin-react'
import { compileDocument } from '../docs/index.js'
import { discoverNotebook, resolveNotebookPath, NOTEBOOK_INFRASTRUCTURE_DIRECTORIES } from '../artifacts/discovery.js'
import { replayCanvas } from '../../canvas-format/index.js'
import { buildArtifactPath, diagnoseArtifactRoutes, normalizeRouteBase, parseArtifactPath } from '../runtime/notebook-routes.js'

const require = createRequire(import.meta.url)
const PUBLISHER_MANIFEST = '.design-notebook-publisher-manifest.json'
const PUBLISHER_BROWSER = fileURLToPath(new URL('./browser.js', import.meta.url))
const ALIASES = [
  ['design-notebook/shell', fileURLToPath(new URL('../../client/shell/index.js', import.meta.url))],
  ['design-notebook/docs', fileURLToPath(new URL('../../client/docs/index.js', import.meta.url))],
  ['design-notebook/sites', fileURLToPath(new URL('../../client/sites/index.js', import.meta.url))],
  ['design-notebook/runtime/notebook-routes', fileURLToPath(new URL('../runtime/notebook-routes.js', import.meta.url))],
  ['design-notebook/runtime/route', fileURLToPath(new URL('../runtime/route.js', import.meta.url))],
  ['design-notebook/runtime/react', fileURLToPath(new URL('../runtime/react.js', import.meta.url))],
  ['design-notebook/runtime', fileURLToPath(new URL('../runtime/index.js', import.meta.url))],
]

function diagnostic(code, message, artifact, extra = {}) {
  return {
    code,
    severity: extra.severity ?? 'warning',
    ...(artifact?.id ? { artifactId: artifact.id } : {}),
    ...(artifact?.path ? { path: artifact.path } : {}),
    message,
    ...extra,
  }
}

function normalizeBase(base) {
  return normalizeRouteBase(base)
}

function normalizeOutputPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) throw new Error(`Unsafe generated output path: ${String(value)}`)
  const normalized = path.posix.normalize(value)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) throw new Error(`Unsafe generated output path: ${value}`)
  return normalized
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

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function validateOutputRoot(root, outputRoot) {
  const canonicalOutput = canonicalExistingPath(outputRoot)
  if (canonicalOutput === root || isWithin(canonicalOutput, root)) throw new Error('Static output cannot be the notebook root or one of its ancestors.')
  if (isWithin(root, canonicalOutput)) {
    const relative = path.relative(root, canonicalOutput)
    const first = relative.split(path.sep)[0]
    if (!['dist', 'build', 'out'].includes(first)) throw new Error(`Static output inside the notebook must use dist, build, or out; received ${relative}.`)
  }
  if (fs.existsSync(outputRoot) && fs.lstatSync(outputRoot).isSymbolicLink()) throw new Error(`Static output cannot be a symbolic link: ${outputRoot}`)
}

function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function isPublicHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return false
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname === '0.0.0.0' || hostname === '::1' || hostname.startsWith('127.') || hostname.startsWith('::ffff:7f')) return false
    return true
  } catch {
    return false
  }
}

function safePublicDiagnostic(item, root) {
  const message = String(item?.message ?? item?.code ?? 'Notebook diagnostic')
    .replaceAll(root, '[notebook root]')
    .replace(/https?:\/\/(?:localhost|[^/\s:'"<>]+\.localhost|[^/\s:'"<>]+\.local|127\.[^/\s:'"<>]+|0\.0\.0\.0|\[?::1\]?)(?::\d+)?[^\s)"'<>]*/gi, '[local URL]')
    .replace(/(?:\/(?:Users|home|private|tmp|var)\/[^\s:'"<>]+|[A-Za-z]:\\[^\s:'"<>]+)/g, '[local path]')
  const pathValue = typeof item?.path === 'string' && !path.isAbsolute(item.path) && !/^[A-Za-z]:/.test(item.path)
    ? item.path.split(path.sep).join('/')
    : undefined
  return {
    code: String(item?.code ?? 'NOTEBOOK_DIAGNOSTIC'),
    severity: ['error', 'warning', 'info'].includes(item?.severity) ? item.severity : 'warning',
    ...(pathValue ? { path: pathValue } : {}),
    ...(typeof item?.artifactId === 'string' ? { artifactId: item.artifactId } : {}),
    ...(typeof item?.line === 'number' ? { line: item.line } : {}),
    ...(typeof item?.field === 'string' ? { field: item.field } : {}),
    ...(typeof item?.input === 'string' && !path.isAbsolute(item.input) && !/^[A-Za-z]:/.test(item.input) ? { input: item.input.split(path.sep).join('/') } : {}),
    message,
  }
}

function publicView(view, diagnostics, artifact) {
  const projected = {}
  for (const key of ['id', 'path', 'screenshot']) {
    if (typeof view?.[key] === 'string') projected[key] = view[key]
  }
  if (typeof view?.title === 'string') projected.title = sanitizeDisplayText(view.title)
  if (typeof view?.publishedUrl === 'string') {
    if (isPublicHttpUrl(view.publishedUrl)) projected.publishedUrl = view.publishedUrl
    else diagnostics.push(diagnostic('LOCAL_OR_INVALID_SITE_URL_EXCLUDED', `A non-public destination for Site view "${view.id ?? ''}" was excluded.`, artifact))
  }
  return projected
}

function sanitizeDisplayText(value) {
  return String(value)
    .replace(/https?:\/\/(?:localhost|[^/\s:'"<>]+\.localhost|[^/\s:'"<>]+\.local|127\.[^/\s:'"<>]+|0\.0\.0\.0|\[?::1\]?)(?::\d+)?[^\s)"'<>]*/gi, '[local URL]')
    .replace(/(?:\/Users\/[^\s:'"<>]+|\/home\/[^\s:'"<>]+|\/private\/[^\s:'"<>]+|\/tmp\/[^\s:'"<>]+|\/var\/[^\s:'"<>]+|[A-Za-z]:\\[^\s:'"<>]+)/g, '[local path]')
}

function publicDescriptor(artifact, diagnostics) {
  const source = artifact.descriptor ?? {}
  const descriptor = { formatVersion: source.formatVersion ?? 1, id: artifact.id, title: sanitizeDisplayText(artifact.title) }
  if (Array.isArray(source.references)) descriptor.references = source.references.filter(item => typeof item === 'string')
  if (artifact.kind === 'prototype') {
    descriptor.runtime = { id: '@dfosco/statefully', version: '0.2.1' }
  } else if (artifact.kind === 'canvas') {
    descriptor.event = 'canvas_created'
    descriptor.canvasId = artifact.id
  } else if (artifact.kind === 'site') {
    if (typeof source.published?.url === 'string') {
      if (isPublicHttpUrl(source.published.url)) descriptor.published = { url: source.published.url }
      else diagnostics.push(diagnostic('LOCAL_OR_INVALID_SITE_URL_EXCLUDED', 'A non-public Site destination was excluded from static output.', artifact))
    }
    descriptor.views = (artifact.views ?? []).map(view => publicView(view, diagnostics, artifact))
    if (source.local || (artifact.views ?? []).some(view => view.localUrl)) {
      diagnostics.push(diagnostic('SITE_LOCAL_REFERENCE_EXCLUDED', 'Local Site source paths and development URLs are never included in static output.', artifact, { severity: 'info' }))
    }
    for (const view of artifact.views ?? []) {
      const safeView = descriptor.views.find(item => item.id === view?.id)
      const hasPublishedTarget = Boolean(safeView?.publishedUrl || descriptor.published?.url)
      if (!hasPublishedTarget) diagnostics.push(diagnostic('SITE_PUBLISHED_DESTINATION_UNAVAILABLE', `Site view "${view?.id ?? ''}" has no public destination; its screenshot can still be shown.`, artifact))
    }
  }
  return descriptor
}

function projectGraph(graph, additionalDiagnostics, root) {
  const projectionDiagnostics = []
  const artifactDiagnostics = new Map()
  for (const artifact of graph.artifacts ?? []) artifactDiagnostics.set(artifact, [...(artifact.diagnostics ?? [])].map(item => safePublicDiagnostic(item, root)))
  const projected = new Map()
  for (const artifact of graph.artifacts ?? []) {
    const diagnostics = artifactDiagnostics.get(artifact) ?? []
    const generatedDiagnostics = additionalDiagnostics.filter(item => item.artifactId === artifact.id && (!item.path || item.path === artifact.path))
    diagnostics.push(...generatedDiagnostics.map(item => safePublicDiagnostic(item, root)))
    const descriptorIssues = []
    const descriptor = publicDescriptor(artifact, descriptorIssues)
    projectionDiagnostics.push(...descriptorIssues)
    diagnostics.push(...descriptorIssues.map(item => safePublicDiagnostic(item, root)))
    const item = {
      id: artifact.id,
      kind: artifact.kind,
      title: sanitizeDisplayText(artifact.title),
      path: artifact.path,
      folderPath: artifact.folderPath ?? (artifact.kind === 'doc' && artifact.payloadPath ? path.posix.dirname(artifact.payloadPath) : undefined),
      available: artifact.available !== false && !generatedDiagnostics.some(issue => issue.severity === 'error'),
      descriptor,
      references: (artifact.references ?? []).filter(value => typeof value === 'string'),
      views: artifact.kind === 'site' ? descriptor.views ?? [] : (artifact.views ?? []).map(view => ({ id: view.id, title: view.title, path: view.path })),
      diagnostics,
    }
    if (artifact.kind === 'prototype') item.runtime = { id: '@dfosco/statefully', version: '0.2.1' }
    projected.set(artifact, item)
  }
  function projectEntry(entry) {
    if (entry?.type === 'group') return { type: 'group', name: sanitizeDisplayText(entry.name), path: entry.path, children: (entry.children ?? []).map(projectEntry) }
    if (entry?.type === 'artifact') return { type: 'artifact', artifact: projected.get(entry.artifact) ?? null }
    return null
  }
  const entries = (graph.entries ?? []).map(projectEntry).filter(Boolean)
  const artifacts = [...projected.values()]
  const diagnostics = [...(graph.diagnostics ?? []), ...additionalDiagnostics, ...projectionDiagnostics]
    .map(item => safePublicDiagnostic(item, root))
  return { entries, artifacts, diagnostics }
}

function readSourceFile(root, relativePath, artifact, inputLabel, diagnostics, severity = 'error') {
  try {
    const absolute = resolveNotebookPath(root, '', relativePath)
    const stat = fs.lstatSync(absolute)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('expected a regular file')
    return fs.readFileSync(absolute)
  } catch (error) {
    diagnostics.push(diagnostic('MISSING_PUBLISH_INPUT', `Cannot include ${inputLabel}: ${error.message}`, artifact, { severity, input: relativePath }))
    return null
  }
}

function relativeFromArtifact(basePath, reference) {
  if (typeof reference !== 'string' || !reference.trim() || reference.includes('\\') || reference.startsWith('/') || /^[A-Za-z]:/.test(reference) || /^https?:\/\//i.test(reference)) return null
  const joined = path.posix.normalize(path.posix.join(basePath ?? '', reference))
  if (joined === '..' || joined.startsWith('../')) return null
  return joined
}

function unsafeStaticReference(reference) {
  if (typeof reference !== 'string' || !reference.trim()) return true
  if (/^[a-z][a-z\d+.-]*:/i.test(reference)) return !isPublicHttpUrl(reference)
  return reference.startsWith('/') || /^[A-Za-z]:[\\/]/.test(reference) || reference.includes('\\')
}

function canvasRenderableProps(widget, artifact, diagnostics) {
  const source = widget?.props && typeof widget.props === 'object' && !Array.isArray(widget.props) ? widget.props : {}
  const props = {}
  const copy = keys => {
    for (const key of keys) if (Object.hasOwn(source, key)) props[key] = source[key]
  }
  const dimensions = ['width', 'height']
  if (['text', 'sticky-note', 'note'].includes(widget?.type)) copy(['text', ...dimensions])
  else if (widget?.type === 'image') {
    copy(['src', 'alt', ...dimensions])
    if (unsafeStaticReference(props.src)) {
      if (props.src !== undefined) diagnostics.push(diagnostic('LOCAL_OR_INVALID_ASSET_URL_EXCLUDED', 'A local or invalid canvas image reference was excluded from the published snapshot.', artifact, { input: artifact.descriptorPath }))
      delete props.src
    }
  } else if (widget?.type === 'prototype' || widget?.type === 'site') {
    copy(['artifactId', 'viewId', ...dimensions])
    if (typeof source.artifactId !== 'string' && typeof source.src === 'string' && !unsafeStaticReference(source.src)) props.src = source.src
    else if (typeof source.artifactId !== 'string' && typeof source.src === 'string' && unsafeStaticReference(source.src)) {
      diagnostics.push(diagnostic('LOCAL_OR_INVALID_ARTIFACT_REFERENCE_EXCLUDED', 'A local or invalid artifact reference was excluded from the published canvas snapshot.', artifact, { input: artifact.descriptorPath }))
    }
    if (typeof source.artifactId === 'string' && unsafeStaticReference(source.artifactId)) {
      diagnostics.push(diagnostic('LOCAL_OR_INVALID_ARTIFACT_REFERENCE_EXCLUDED', 'A local or invalid artifact reference was excluded from the published canvas snapshot.', artifact, { input: artifact.descriptorPath }))
      delete props.artifactId
    }
  } else {
    copy(['fallback', ...dimensions])
    if (props.fallback !== undefined) {
      if (props.fallback && props.fallback.type === 'text' && typeof props.fallback.text === 'string') {
        props.fallback = { type: 'text', text: props.fallback.text }
      } else {
        diagnostics.push(diagnostic('UNSUPPORTED_CANVAS_FALLBACK_EXCLUDED', `Unsupported fallback data for widget ${widget.id} was excluded from the published snapshot.`, artifact, { input: artifact.descriptorPath }))
        delete props.fallback
      }
    }
  }
  const allowed = new Set(Object.keys(props))
  if (Object.keys(source).some(key => !allowed.has(key))) {
    diagnostics.push(diagnostic('CANVAS_PRIVATE_METADATA_EXCLUDED', 'Non-rendered widget metadata was excluded from the published canvas snapshot.', artifact, { severity: 'info', input: artifact.descriptorPath }))
  }
  return props
}

function publishedCanvasSnapshot(replay, artifact, diagnostics) {
  if (replay.status !== 'complete') return null
  const state = replay.state ?? {}
  const header = { event: 'canvas_created', formatVersion: 1, canvasId: replay.canvasId }
  if (typeof state.title === 'string') header.title = sanitizeDisplayText(state.title)
  if (Number.isFinite(state.width) && state.width > 0) header.width = state.width
  if (Number.isFinite(state.height) && state.height > 0) header.height = state.height
  const supportedHeader = new Set(['canvasId', 'title', 'width', 'height', 'widgets', 'sources', 'connectors'])
  if (Object.keys(state).some(key => !supportedHeader.has(key))) {
    diagnostics.push(diagnostic('CANVAS_PRIVATE_METADATA_EXCLUDED', 'Non-rendered canvas metadata was excluded from the published snapshot.', artifact, { severity: 'info', input: artifact.descriptorPath }))
  }
  if (replay.records?.length > 1) {
    diagnostics.push(diagnostic('CANVAS_EVENT_HISTORY_EXCLUDED', 'Only final rendered widget state is published; source event history is excluded.', artifact, { severity: 'info', input: artifact.descriptorPath }))
  }
  if (state.sources?.length || state.connectors?.length) {
    diagnostics.push(diagnostic('CANVAS_NON_RENDERED_RECORDS_EXCLUDED', 'Canvas sources, connectors, and event history are not included in static output.', artifact, { severity: 'info', input: artifact.descriptorPath }))
  }
  const widgets = (state.widgets ?? []).map(widget => ({
    id: widget.id,
    ...(typeof widget.type === 'string' ? { type: widget.type } : {}),
    ...(widget.position && typeof widget.position === 'object' ? { position: Object.fromEntries(['x', 'y'].filter(key => Number.isFinite(widget.position[key])).map(key => [key, widget.position[key]])) } : {}),
    props: canvasRenderableProps(widget, artifact, diagnostics),
  }))
  return `${JSON.stringify({ ...header, widgets })}\n`
}

function isPublishableRelativeAsset(reference) {
  return typeof reference === 'string' && reference.trim() !== '' && !unsafeStaticReference(reference)
}

function isUnsupportedRelativeLink(reference) {
  return typeof reference === 'string' && reference.trim() !== '' && !reference.startsWith('#') && !reference.startsWith('?') && !/^[a-z][a-z\d+.-]*:/i.test(reference) && !reference.startsWith('/') && !reference.includes('\\')
}

async function compilePublishedDocument(root, source, artifact, artifacts, basePath, stagedFiles, assetPaths, diagnostics) {
  const validation = await compileDocument(source, { artifact, artifacts, mode: 'static' })
  diagnostics.push(...validation.diagnostics.map(issue => ({ ...issue, artifactId: artifact.id, path: artifact.path })))
  if (!validation.available || !validation.compiledSource) return null
  const { compile } = await import('@mdx-js/mdx')
  const lineOffset = source.length > validation.body.length
    ? source.slice(0, source.length - validation.body.length).split('\n').length - 1
    : 0
  const references = new Set()
  const documentDiagnostics = [...validation.diagnostics.map(issue => ({ ...issue, artifactId: artifact.id, path: artifact.path }))]
  const addIssue = (code, message, node, field) => {
    const issue = diagnostic(code, message, artifact, {
      severity: 'warning',
      ...(node?.position?.start?.line ? { line: node.position.start.line + lineOffset } : {}),
      ...(field ? { field } : {}),
    })
    diagnostics.push(issue)
    documentDiagnostics.push(issue)
  }
  const plugin = () => tree => {
    const nodes = []
    const gather = node => {
      if (!node || typeof node !== 'object') return
      nodes.push(node)
      for (const child of node.children ?? []) gather(child)
    }
    gather(tree)
    const imageReferenceIds = new Set(nodes.filter(node => node.type === 'imageReference').map(node => node.identifier))
    const linkReferenceIds = new Set(nodes.filter(node => node.type === 'linkReference').map(node => node.identifier))
    for (const node of nodes) {
      if (node.type !== 'definition') continue
      if (unsafeStaticReference(node.url)) {
        addIssue('LOCAL_OR_INVALID_ASSET_URL_EXCLUDED', 'A local or invalid Markdown reference destination was excluded from the published document.', node, 'definition.url')
        node.url = ''
      } else if (imageReferenceIds.has(node.identifier)) references.add(node.url)
      else if (linkReferenceIds.has(node.identifier) && isUnsupportedRelativeLink(node.url)) {
        addIssue('UNSUPPORTED_DOCUMENT_LINK_RESOURCE', 'Relative Markdown links are not emitted as static document files.', node, 'definition.url')
        node.url = ''
      }
    }
    const walk = node => {
      if (!node || typeof node !== 'object') return
      if (node.type === 'image') {
        if (isPublishableRelativeAsset(node.url)) references.add(node.url)
        else if (node.url && unsafeStaticReference(node.url)) {
          addIssue('LOCAL_OR_INVALID_ASSET_URL_EXCLUDED', 'A local or invalid Markdown image destination was excluded from the published document.', node, 'image.url')
          node.url = ''
        }
      } else if (node.type === 'link' && typeof node.url === 'string') {
        if (unsafeStaticReference(node.url)) {
          addIssue('LOCAL_OR_INVALID_ASSET_URL_EXCLUDED', 'A local or invalid Markdown link destination was excluded from the published document.', node, 'link.url')
          node.url = ''
        } else if (isUnsupportedRelativeLink(node.url)) {
          addIssue('UNSUPPORTED_DOCUMENT_LINK_RESOURCE', 'Relative Markdown links are not emitted as static document files.', node, 'link.url')
          node.url = ''
        }
      }
      if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
        for (const attribute of node.attributes ?? []) {
          if (attribute.type !== 'mdxJsxAttribute') continue
          const isImageSource = ['Image', 'img'].includes(node.name) && attribute.name === 'src'
          const isLinkTarget = node.name === 'a' && attribute.name === 'href'
          if (!isImageSource && !isLinkTarget) continue
          if (typeof attribute.value !== 'string') {
            addIssue('DYNAMIC_DOCUMENT_RESOURCE_UNSUPPORTED', 'Dynamic document resource references are not supported in static output.', attribute, attribute.name)
            attribute.value = ''
            continue
          }
          if (isImageSource && isPublishableRelativeAsset(attribute.value)) references.add(attribute.value)
          else if (unsafeStaticReference(attribute.value)) {
            addIssue('LOCAL_OR_INVALID_ASSET_URL_EXCLUDED', 'A local or invalid document resource destination was excluded from the published document.', attribute, attribute.name)
            attribute.value = ''
          } else if (isLinkTarget && isUnsupportedRelativeLink(attribute.value)) {
            addIssue('UNSUPPORTED_DOCUMENT_LINK_RESOURCE', 'Relative document links are not emitted as static document files.', attribute, attribute.name)
            attribute.value = ''
          }
        }
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(walk)
        else if (value && typeof value === 'object') walk(value)
      }
    }
    walk(tree)
  }
  let compiledSource
  try {
    const compiled = await compile(validation.body, { development: false, outputFormat: 'program', remarkPlugins: [plugin], jsxImportSource: 'react', filepath: artifact.path ?? 'document.doc.mdx' })
    compiledSource = String(compiled)
  } catch (error) {
    diagnostics.push(diagnostic('INVALID_DOCUMENT_MDX', `Could not compile static document resources: ${error.message}`, artifact, { severity: 'error', input: artifact.payloadPath }))
    return null
  }
  for (const reference of references) collectAsset(root, artifact, reference, basePath, stagedFiles, assetPaths, diagnostics, 'document image')
  return { compiledSource, diagnostics: documentDiagnostics }
}

function ensureNoInfrastructurePath(relativePath, artifact, diagnostics) {
  if (relativePath.split('/').some(segment => NOTEBOOK_INFRASTRUCTURE_DIRECTORIES.has(segment))) {
    diagnostics.push(diagnostic('INFRASTRUCTURE_ASSET_EXCLUDED', `Referenced file "${relativePath}" is inside a Design Notebook infrastructure directory and was not published.`, artifact))
    return false
  }
  return true
}

function collectAsset(root, artifact, reference, basePath, stagedFiles, assetPaths, diagnostics, purpose) {
  if (typeof reference !== 'string' || !reference.trim()) return
  if (/^https?:\/\//i.test(reference)) {
    if (!isPublicHttpUrl(reference)) diagnostics.push(diagnostic('LOCAL_OR_INVALID_ASSET_URL_EXCLUDED', `A local or invalid external asset URL was excluded from static output.`, artifact, { input: purpose }))
    return
  }
  const sourcePath = relativeFromArtifact(basePath, reference)
  if (!sourcePath || !ensureNoInfrastructurePath(sourcePath, artifact, diagnostics)) {
    if (!sourcePath) diagnostics.push(diagnostic('INVALID_PUBLISH_ASSET_PATH', `Referenced ${purpose} path "${reference}" is not a portable relative path within the notebook.`, artifact))
    return
  }
  const key = `${basePath ?? ''}\u0000${reference}`
  if (assetPaths[key]) return
  const bytes = readSourceFile(root, sourcePath, artifact, `${purpose} ${reference}`, diagnostics, 'warning')
  if (!bytes) return
  const outputPath = normalizeOutputPath(`notebook-assets/${sourcePath}`)
  stagedFiles.set(outputPath, bytes)
  assetPaths[key] = outputPath
}

function checkPrototypeResults(graph, prototypeResults, outputRoot, extraDiagnostics) {
  const results = new Map((Array.isArray(prototypeResults) ? prototypeResults : []).map(item => [item?.artifactId, item]))
  for (const artifact of graph.artifacts ?? []) {
    if (artifact.kind !== 'prototype' || artifact.available === false) continue
    const result = results.get(artifact.id)
    const expected = path.join(outputRoot, 'prototypes', artifact.id)
    const validDirectory = fs.existsSync(expected) && fs.lstatSync(expected).isDirectory() && !fs.lstatSync(expected).isSymbolicLink()
    const validIndex = validDirectory && fs.existsSync(path.join(expected, 'index.html')) && fs.lstatSync(path.join(expected, 'index.html')).isFile()
    if (!result || result.diagnostics?.length || !validIndex) {
      const prior = result?.diagnostics?.map(item => item.message).filter(Boolean).join(' ') || 'No successful static entry route was produced.'
      extraDiagnostics.push(diagnostic('PROTOTYPE_STATIC_OUTPUT_UNAVAILABLE', `Prototype static build failed for ${artifact.id}: ${prior}`, artifact, { severity: 'error', input: artifact.path }))
    }
  }
}

function validatePreviousPublisherOutput(outputRoot) {
  const manifestPath = path.join(outputRoot, PUBLISHER_MANIFEST)
  if (!fs.existsSync(manifestPath)) return { manifest: null, files: new Map() }
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) } catch { throw new Error('Refusing to overwrite static output with an invalid publisher ownership manifest.') }
  if (manifest?.formatVersion !== 1 || !Array.isArray(manifest.files)) throw new Error('Refusing to overwrite static output with an unsupported publisher ownership manifest.')
  const files = new Map()
  for (const item of manifest.files) {
    const relative = normalizeOutputPath(item?.path)
    if (typeof item?.sha256 !== 'string' || files.has(relative)) throw new Error('Refusing to overwrite static output with an invalid publisher file manifest.')
    files.set(relative, item.sha256)
    const file = path.join(outputRoot, ...relative.split('/'))
    if (!fs.existsSync(file)) continue
    const stat = fs.lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink() || hashFile(file) !== item.sha256) throw new Error(`Refusing to overwrite modified or unsafe publisher output: ${relative}`)
  }
  return { manifest, files }
}

function assertPublisherCollisions(outputRoot, stagedFiles, previousFiles) {
  for (const relative of stagedFiles.keys()) {
    const target = path.join(outputRoot, ...relative.split('/'))
    let current = outputRoot
    for (const segment of relative.split('/')) {
      current = path.join(current, segment)
      if (!fs.existsSync(current)) continue
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error(`Refusing to write through a symbolic link: ${path.relative(outputRoot, current)}`)
      if (current !== target && !stat.isDirectory()) throw new Error(`Static output path collides with a file: ${path.relative(outputRoot, current)}`)
      if (current === target && (!stat.isFile() || !previousFiles.has(relative))) throw new Error(`Refusing to overwrite unowned static output: ${relative}`)
    }
  }
}

function filesBelow(directory) {
  const files = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Generated static output contains a symbolic link: ${absolute}`)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile()) files.push(path.relative(directory, absolute).split(path.sep).join('/'))
    }
  }
  visit(directory)
  return files.sort()
}

function mergePublisherFiles(outputRoot, stagedFiles, previousFiles) {
  assertPublisherCollisions(outputRoot, stagedFiles, previousFiles)
  for (const [relative, bytes] of stagedFiles) {
    const target = path.join(outputRoot, ...relative.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temp = `${target}.design-notebook-${crypto.randomUUID()}.tmp`
    fs.writeFileSync(temp, bytes, { flag: 'wx' })
    fs.renameSync(temp, target)
  }
  const retained = new Set(stagedFiles.keys())
  for (const [relative, expectedHash] of previousFiles) {
    if (retained.has(relative)) continue
    const target = path.join(outputRoot, ...relative.split('/'))
    if (!fs.existsSync(target)) continue
    if (hashFile(target) !== expectedHash) throw new Error(`Refusing to remove modified publisher output: ${relative}`)
    fs.rmSync(target)
  }
  const files = [...stagedFiles.keys()].sort().map(relative => ({ path: relative, sha256: hashFile(path.join(outputRoot, ...relative.split('/'))) }))
  const manifestPath = path.join(outputRoot, PUBLISHER_MANIFEST)
  const tempManifest = `${manifestPath}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tempManifest, JSON.stringify({ formatVersion: 1, files }, null, 2))
  fs.renameSync(tempManifest, manifestPath)
}

function aliasPlugin() {
  const aliases = new Map(ALIASES)
  return {
    name: 'design-notebook-publisher-aliases',
    enforce: 'pre',
    resolveId(id) {
      if (aliases.has(id)) return aliases.get(id)
      if (id === '@dfosco/statefully' || id === '@dfosco/statefully/react') return require.resolve(id)
      if (id === 'react' || id.startsWith('react/')) return require.resolve(id)
      if (id === 'react-dom' || id.startsWith('react-dom/')) return require.resolve(id)
      return undefined
    },
  }
}

function staticEntryPlugin(entrySource, documentModules) {
  const browserResolverId = '\0design-notebook:publisher-browser-resolver'
  const documentPrefix = '\0design-notebook:compiled-document:'
  return {
    name: 'design-notebook-static-entry',
    resolveId(id) {
      if (id === '/design-notebook-static-entry.js') return '\0design-notebook:static-entry'
      if (id === 'design-notebook:publisher-browser-resolver') return browserResolverId
      const match = id.match(/^design-notebook:compiled-document:(\d+)$/)
      if (match) return `${documentPrefix}${match[1]}`
      return undefined
    },
    load(id) {
      if (id === '\0design-notebook:static-entry') return entrySource
      if (id === browserResolverId) return `export { createStaticNotebookResolvers } from ${JSON.stringify(PUBLISHER_BROWSER)};`
      if (id.startsWith(documentPrefix)) return documentModules[Number(id.slice(documentPrefix.length))]
      return undefined
    },
  }
}

function makeStaticEntry(graph, base, assetPaths, documentModules, documentById, canvasById, customCss) {
  const imports = [
    `import React from 'react'`,
    `import { createRoot } from 'react-dom/client'`,
    `import { NotebookShell } from 'design-notebook/shell'`,
    `import { createStaticNotebookResolvers } from 'design-notebook:publisher-browser-resolver'`,
  ]
  const docImports = []
  for (let index = 0; index < documentModules.length; index += 1) {
    imports.push(`import * as DocumentModule${index} from 'design-notebook:compiled-document:${index}'`)
    const artifactId = documentById[index]
    docImports.push(`${JSON.stringify(artifactId)}: { Content: props => React.createElement(DocumentModule${index}.default, { ...props, components: { ...props.components, img: props.components?.Image } }), diagnostics: DocumentModule${index}.designNotebookDiagnostics ?? [] }`)
  }
  const source = [
    ...imports,
    `const graph = ${JSON.stringify(graph)}`,
    `const base = ${JSON.stringify(base)}`,
    `const assetPaths = ${JSON.stringify(assetPaths)}`,
    `const canvasById = ${JSON.stringify(canvasById)}`,
    `const documents = { ${docImports.join(', ')} }`,
    `const baseUrl = new URL(base, globalThis.location.origin).href`,
    `const resolvers = createStaticNotebookResolvers({ graph, base, assetPaths })`,
    `const loadCanvas = async artifact => { const filename = canvasById[artifact.id]; if (!filename) throw new Error('Canvas payload is unavailable.'); const response = await fetch(new URL(filename, baseUrl), { cache: 'no-store' }); if (!response.ok) throw new Error('Unable to load canvas ' + artifact.id + ' (' + response.status + ').'); return response.text() }`,
    `const loadDocument = async artifact => documents[artifact.id] ?? null`,
    `const reportDiagnostic = item => { if (item?.severity === 'error') console.error('[Design Notebook]', item.message ?? item.code, item); else console.warn('[Design Notebook]', item?.message ?? item?.code ?? item) }`,
    `createRoot(document.getElementById('design-notebook-root')).render(React.createElement(NotebookShell, { graph, mode: 'static', routeBase: base, baseUrl, resolveArtifact: resolvers.resolveArtifact, resolveAsset: resolvers.resolveAsset, loadCanvas, loadDocument, customCssUrl: ${customCss ? `new URL(${JSON.stringify(customCss)}, baseUrl).href` : 'undefined'}, onDiagnostic: reportDiagnostic }))`,
  ].join('\n')
  return source
}

async function buildShellBundle(stageRoot, outputDirectory, source, documentModules, base) {
  const entryPlugin = staticEntryPlugin(source, documentModules)
  await viteBuild({
    root: stageRoot,
    configFile: false,
    base,
    plugins: [aliasPlugin(), entryPlugin, react()],
    resolve: { alias: Object.fromEntries(ALIASES), dedupe: ['react', 'react-dom'] },
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: {
        input: '/design-notebook-static-entry.js',
        output: {
          entryFileNames: 'assets/notebook-[hash].js',
          chunkFileNames: 'assets/chunk-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
    optimizeDeps: { noDiscovery: true, entries: [] },
  })
  const files = filesBelow(outputDirectory)
  const entry = files.find(file => /^assets\/notebook-[^/]+\.js$/.test(file))
  if (!entry) throw new Error('Vite did not emit the static notebook entry bundle.')
  const styles = files.filter(file => file.endsWith('.css'))
  const links = styles.map(file => `<link rel="stylesheet" href="${base}${file.split('/').map(encodeURIComponent).join('/')}">`).join('')
  const html = `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="description" content="A static Design Notebook"><title>Design Notebook</title>${links}</head><body><div id="design-notebook-root"></div><script type="module" crossorigin src="${base}${entry.split('/').map(encodeURIComponent).join('/')}"></script></body></html>\n`
  fs.writeFileSync(path.join(outputDirectory, 'index.html'), html)
}

function routeOutputPath(routePath, base) {
  const url = new URL(routePath, 'https://design-notebook.invalid')
  const normalized = normalizeBase(base)
  const prefix = normalized === '/' ? '' : normalized.slice(0, -1)
  if (prefix && url.pathname !== prefix && !url.pathname.startsWith(normalized)) {
    throw new Error('Canonical artifact route escaped the configured base: ' + url.pathname)
  }
  const localPath = prefix ? url.pathname.slice(prefix.length) : url.pathname
  const segments = localPath.split('/').filter(Boolean).map(segment => {
    let decoded
    try { decoded = decodeURIComponent(segment) } catch { throw new Error('Invalid encoded artifact route segment: ' + segment) }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) throw new Error('Unsafe artifact route segment: ' + segment)
    return decoded
  })
  return normalizeOutputPath(path.posix.join(...segments, 'index.html'))
}

export function staticRouteTargets(graph, base, routeDiagnostics) {
  const artifacts = graph.artifacts ?? []
  const diagnostics = []
  const conflictedPaths = new Set(routeDiagnostics
    .filter(item => item.code === 'ARTIFACT_ROUTE_COLLISION')
    .map(item => item.path))
  const blockedArtifactIds = new Set(routeDiagnostics
    .filter(item => ['INVALID_ARTIFACT_ROUTE_ID', 'RESERVED_ARTIFACT_ROUTE_PREFIX', 'UNSUPPORTED_ARTIFACT_ROUTE_KIND'].includes(item.code))
    .map(item => item.artifactId))
  const pages = new Map()
  const collidedOutputPaths = new Set()
  for (const artifact of artifacts) {
    if (blockedArtifactIds.has(artifact.id)) continue
    const candidates = [{ artifact, viewId: undefined }]
    if (artifact.kind === 'prototype' || artifact.kind === 'site') {
      for (const view of artifact.views ?? []) {
        if (typeof view?.id === 'string' && view.id.trim()) candidates.push({ artifact, viewId: view.id })
      }
    }
    for (const candidate of candidates) {
      let canonicalPath
      try {
        canonicalPath = buildArtifactPath(candidate.artifact, { base, ...(candidate.viewId !== undefined ? { viewId: candidate.viewId } : {}) })
      } catch (error) {
        diagnostics.push(diagnostic('INVALID_ARTIFACT_ROUTE', 'A shell route could not be emitted: ' + error.message, candidate.artifact, { severity: 'error' }))
        continue
      }
      const parsed = new URL(canonicalPath, 'https://design-notebook.invalid')
      const route = parsed.pathname + parsed.search + parsed.hash
      if (conflictedPaths.has(route)) continue
      const match = parseArtifactPath(canonicalPath, { artifacts, base })
      if (match.status !== 'matched' || match.artifact?.id !== candidate.artifact.id) {
        diagnostics.push(diagnostic('ARTIFACT_ROUTE_NOT_EMITTED', 'The canonical shell route could not be resolved unambiguously and was not emitted.', candidate.artifact, { severity: 'error', route }))
        continue
      }
      const outputPath = routeOutputPath(canonicalPath, base)
      const outputKey = outputPath.toLowerCase()
      if (collidedOutputPaths.has(outputKey)) continue
      const prior = pages.get(outputKey)
      if (prior && prior.artifactId !== candidate.artifact.id) {
        diagnostics.push(diagnostic('ARTIFACT_ROUTE_OUTPUT_COLLISION', 'Multiple canonical routes map to the same static shell page "' + outputPath + '".', candidate.artifact, { severity: 'error', route }))
        pages.delete(outputKey)
        collidedOutputPaths.add(outputKey)
        continue
      }
      if (!prior) pages.set(outputKey, { outputPath, artifactId: candidate.artifact.id, route })
    }
  }
  return { pages, diagnostics }
}

/**
 * Assemble a static viewer after buildNotebook has emitted prototype routes.
 * This function never invokes the prototype build and never deploys or publishes.
 */
export async function publishNotebook({ root, outputRoot, base = '/', graph: suppliedGraph, prototypeResults = [] } = {}) {
  if (typeof root !== 'string' || !root) throw new TypeError('root is required.')
  if (typeof outputRoot !== 'string' || !outputRoot) throw new TypeError('outputRoot is required.')
  const notebookRoot = fs.realpathSync.native(path.resolve(root))
  const output = path.resolve(outputRoot)
  const normalizedBase = normalizeBase(base)
  validateOutputRoot(notebookRoot, output)
  fs.mkdirSync(output, { recursive: true })
  const graph = suppliedGraph ?? discoverNotebook(notebookRoot)
  const stagedFiles = new Map()
  const assetPaths = {}
  const extraDiagnostics = []
  const canvasById = {}
  const documentModules = []
  const documentById = []

  checkPrototypeResults(graph, prototypeResults, output, extraDiagnostics)
  for (const artifact of graph.artifacts ?? []) {
    if (artifact.kind === 'canvas' && artifact.available !== false) {
      const bytes = readSourceFile(notebookRoot, artifact.descriptorPath, artifact, 'canvas JSONL', extraDiagnostics)
      if (bytes) {
        const source = bytes.toString('utf8')
        const replay = replayCanvas(source)
        for (const issue of replay.diagnostics) {
          if (issue.severity === 'error' || issue.severity === 'warning') extraDiagnostics.push(diagnostic(`CANVAS_${issue.code.replaceAll('-', '_').toUpperCase()}`, issue.message, artifact, { severity: issue.severity, line: issue.line, input: artifact.descriptorPath }))
        }
        const snapshot = publishedCanvasSnapshot(replay, artifact, extraDiagnostics)
        if (snapshot !== null) {
          const outputPath = normalizeOutputPath(`notebook-data/canvases/${encodeURIComponent(artifact.id)}.jsonl`)
          stagedFiles.set(outputPath, Buffer.from(snapshot))
          canvasById[artifact.id] = outputPath
          for (const placement of replay.placements) {
            if (placement.kind === 'image') collectAsset(notebookRoot, artifact, placement.data?.src, artifact.folderPath, stagedFiles, assetPaths, extraDiagnostics, 'canvas image')
          }
        }
      }
    }
    if (artifact.kind === 'doc') {
      const bytes = readSourceFile(notebookRoot, artifact.payloadPath, artifact, 'MDX document', extraDiagnostics)
      if (!bytes) continue
      const source = bytes.toString('utf8')
      const basePath = artifact.folderPath ?? path.posix.dirname(artifact.payloadPath)
      const compiled = await compilePublishedDocument(notebookRoot, source, artifact, graph.artifacts, basePath, stagedFiles, assetPaths, extraDiagnostics)
      if (compiled) {
        const index = documentModules.length
        documentModules.push(`${compiled.compiledSource}\nexport const designNotebookDiagnostics = ${JSON.stringify(compiled.diagnostics)};`)
        documentById[index] = artifact.id
      }
    }
    if (artifact.kind === 'site') {
      for (const view of artifact.views ?? []) collectAsset(notebookRoot, artifact, view?.screenshot, artifact.folderPath, stagedFiles, assetPaths, extraDiagnostics, `Site screenshot${view?.id ? ` ${view.id}` : ''}`)
    }
  }

  const cssBytes = fs.existsSync(path.join(notebookRoot, 'notebook.css'))
    ? readSourceFile(notebookRoot, 'notebook.css', null, 'optional notebook.css', extraDiagnostics)
    : null
  let customCss = null
  if (cssBytes) {
    customCss = 'notebook-assets/notebook.css'
    stagedFiles.set(customCss, cssBytes)
  }

  const routeDiagnostics = diagnoseArtifactRoutes(graph.artifacts ?? [], { base: normalizedBase })
  const routeTargets = staticRouteTargets(graph, normalizedBase, routeDiagnostics)
  extraDiagnostics.push(...routeDiagnostics, ...routeTargets.diagnostics)

  const finalGraph = projectGraph(graph, extraDiagnostics, notebookRoot)
  const entrySource = makeStaticEntry(finalGraph, normalizedBase, assetPaths, documentModules, documentById, canvasById, customCss)
  const stageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-publisher-'))
  const stageOutput = path.join(stageRoot, 'dist')
  try {
    await buildShellBundle(stageRoot, stageOutput, entrySource, documentModules, normalizedBase)
    for (const relative of filesBelow(stageOutput)) {
      const outputPath = normalizeOutputPath(relative)
      stagedFiles.set(outputPath, fs.readFileSync(path.join(stageOutput, ...relative.split('/'))))
    }
    const shellHtml = fs.readFileSync(path.join(stageOutput, 'index.html'))
    const stagedOutputKeys = new Set([...stagedFiles.keys()].map(file => file.toLowerCase()))
    for (const target of routeTargets.pages.values()) {
      if (stagedOutputKeys.has(target.outputPath.toLowerCase())) {
        extraDiagnostics.push(diagnostic('ARTIFACT_ROUTE_OUTPUT_COLLISION', 'Canonical shell route output collides with another generated file: ' + target.outputPath, null, { severity: 'error', route: target.route }))
        continue
      }
      stagedFiles.set(target.outputPath, shellHtml)
      stagedOutputKeys.add(target.outputPath.toLowerCase())
    }
  } catch (error) {
    extraDiagnostics.push(diagnostic('STATIC_SHELL_BUILD_FAILED', `Could not bundle the static notebook shell: ${error.message}`, null, { severity: 'error', input: 'generated static shell' }))
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true })
  }

  if (extraDiagnostics.some(item => item.code === 'STATIC_SHELL_BUILD_FAILED')) {
    const failedGraph = projectGraph(graph, extraDiagnostics, notebookRoot)
    return { success: false, outputRoot: output, base: normalizedBase, graph: failedGraph, diagnostics: failedGraph.diagnostics, files: [] }
  }

  let previous
  try {
    previous = validatePreviousPublisherOutput(output)
    mergePublisherFiles(output, stagedFiles, previous.files)
  } catch (error) {
    const issue = diagnostic('STATIC_OUTPUT_COLLISION', error.message, null, { severity: 'error', input: output })
    const failedGraph = projectGraph(graph, [...extraDiagnostics, issue], notebookRoot)
    return { success: false, outputRoot: output, base: normalizedBase, graph: failedGraph, diagnostics: failedGraph.diagnostics, files: [] }
  }

  const publishedGraph = extraDiagnostics.length === 0 ? finalGraph : projectGraph(graph, extraDiagnostics, notebookRoot)
  const finalDiagnostics = publishedGraph.diagnostics
  return {
    success: !publishedGraph.diagnostics.some(item => item.severity === 'error'),
    outputRoot: output,
    base: normalizedBase,
    graph: publishedGraph,
    diagnostics: finalDiagnostics,
    files: [...stagedFiles.keys()].sort(),
  }
}

export { isPublicHttpUrl, normalizeBase, projectGraph }
