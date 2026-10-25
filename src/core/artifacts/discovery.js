import fs from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020.js'
import { parseDocument } from 'yaml'
import { replayCanvas } from '../../canvas-format/index.js'

export const ARTIFACT_DIRECTORY_SUFFIXES = Object.freeze({
  prototype: '.prototype',
  canvas: '.canvas',
  site: '.site',
})

// Exclude only tool metadata, dependency stores and conventional generated output.
// Names such as `prototypes`, `canvases`, and `sites` are ordinary content groups.
export const NOTEBOOK_INFRASTRUCTURE_DIRECTORIES = new Set([
  '.git',
  '.design-notebook',
  '.vite',
  '.cache',
  '.next',
  '.turbo',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  'storybook-static',
])

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const PROTOTYPE_RUNTIME = Object.freeze({ id: '@dfosco/statefully', version: '0.2.1' })
const ajv = new Ajv2020({ allErrors: true, strict: false })
ajv.addFormat('uri', value => {
  try { new URL(value); return true } catch { return false }
})
const descriptorValidators = Object.freeze({
  prototype: ajv.compile(JSON.parse(fs.readFileSync(new URL('../../../schemas/artifacts/prototype.schema.json', import.meta.url), 'utf8'))),
  site: ajv.compile(JSON.parse(fs.readFileSync(new URL('../../../schemas/artifacts/site.schema.json', import.meta.url), 'utf8'))),
  doc: ajv.compile(JSON.parse(fs.readFileSync(new URL('../../../schemas/artifacts/doc-frontmatter.schema.json', import.meta.url), 'utf8'))),
})

function inside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function diagnostic(code, message, pathName, extra = {}) {
  return { code, message, path: pathName, severity: 'error', ...extra }
}

function directoryKind(name) {
  for (const [kind, suffix] of Object.entries(ARTIFACT_DIRECTORY_SUFFIXES)) {
    if (name.endsWith(suffix) && name.length > suffix.length) return kind
  }
  return null
}

function safeRelative(value, field, sourcePath, diagnostics) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
    diagnostics.push(diagnostic('INVALID_RELATIVE_PATH', `${field} must be a non-empty, forward-slash relative path.`, sourcePath, { field }))
    return null
  }
  const segments = value.split('/')
  if (segments.some(segment => !segment || segment === '.')) {
    diagnostics.push(diagnostic('INVALID_RELATIVE_PATH', `${field} cannot contain empty or "." path segments.`, sourcePath, { field }))
    return null
  }
  return value
}

/** Resolve a portable relative path from the notebook root or an artifact directory. */
export function resolveNotebookPath(root, basePath, relativePath) {
  const rootReal = fs.realpathSync.native(path.resolve(root))
  for (const [value, label] of [[basePath, 'basePath'], [relativePath, 'relativePath']]) {
    if (typeof value !== 'string' || value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) {
      throw new Error(`${label} must be a forward-slash relative path`)
    }
  }
  const base = basePath ? path.resolve(rootReal, ...basePath.split('/')) : rootReal
  if (!inside(rootReal, base)) throw new Error(`Path base escapes the notebook: ${basePath}`)
  const target = path.resolve(base, ...relativePath.split('/'))
  if (!inside(rootReal, target)) throw new Error(`Relative path escapes the notebook: ${relativePath}`)
  let existing = target
  while (!fs.existsSync(existing) && existing !== rootReal) existing = path.dirname(existing)
  if (!inside(rootReal, fs.realpathSync.native(existing))) throw new Error(`Resolved path escapes the notebook: ${relativePath}`)
  return target
}

function readJsonDescriptor(absolutePath, relativePath, diagnostics) {
  let raw
  try {
    raw = fs.readFileSync(absolutePath, 'utf8')
  } catch (error) {
    diagnostics.push(diagnostic('MISSING_DESCRIPTOR', `Cannot read required descriptor: ${error.message}`, relativePath))
    return null
  }
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected a JSON object')
    return value
  } catch (error) {
    diagnostics.push(diagnostic('INVALID_DESCRIPTOR_JSON', `Descriptor is not valid JSON: ${error.message}`, relativePath))
    return null
  }
}

function readDocFrontmatter(absolutePath, relativePath, diagnostics) {
  let source
  try {
    source = fs.readFileSync(absolutePath, 'utf8')
  } catch (error) {
    diagnostics.push(diagnostic('MISSING_DOCUMENT', `Cannot read document: ${error.message}`, relativePath))
    return null
  }
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) {
    diagnostics.push(diagnostic('MISSING_DOCUMENT_FRONTMATTER', 'A .doc.mdx file must begin with YAML frontmatter.', relativePath))
    return null
  }
  const document = parseDocument(match[1], { uniqueKeys: true, version: '1.2' })
  for (const issue of [...document.errors, ...document.warnings]) {
    const position = issue.linePos?.[0]?.line
    diagnostics.push(diagnostic('INVALID_DOCUMENT_FRONTMATTER', issue.message, relativePath, {
      ...(position ? { line: position + 1 } : {}),
      severity: document.errors.includes(issue) ? 'error' : 'warning',
    }))
  }
  if (document.errors.length) return null
  try {
    const value = document.toJS({ mapAsMap: false })
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      diagnostics.push(diagnostic('INVALID_DOCUMENT_FRONTMATTER', 'YAML frontmatter must be a mapping.', relativePath))
      return null
    }
    return value
  } catch (error) {
    diagnostics.push(diagnostic('INVALID_DOCUMENT_FRONTMATTER', `Cannot read YAML frontmatter: ${error.message}`, relativePath))
    return null
  }
}

function validateDescriptorSchema(kind, descriptor, artifact, diagnostics) {
  const validate = descriptorValidators[kind]
  if (!validate) return
  if (validate(descriptor)) return
  for (const error of validate.errors ?? []) {
    if (kind === 'prototype' && error.instancePath.startsWith('/runtime')) continue
    const missing = error.params?.missingProperty
    const field = `${error.instancePath.split('/').filter(Boolean).join('.')}${missing ? `${error.instancePath ? '.' : ''}${missing}` : ''}` || undefined
    const rootField = error.instancePath === '' ? missing : error.instancePath.slice(1)
    const code = rootField === 'id' ? 'MISSING_OR_INVALID_ID'
      : rootField === 'title' ? 'MISSING_OR_INVALID_TITLE'
        : rootField === 'formatVersion' ? 'UNSUPPORTED_FORMAT_VERSION'
          : kind === 'doc' ? 'INVALID_DOCUMENT_FRONTMATTER' : 'INVALID_DESCRIPTOR'
    diagnostics.push(diagnostic(code, `Descriptor does not match the ${kind} schema: ${error.message}.`, artifact.descriptorPath, {
      ...(field ? { field } : {}),
      schemaPath: error.schemaPath,
    }))
  }
}

function isHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

function readCanvasIdentity(absolutePath, relativePath, fallbackTitle, diagnostics) {
  let source
  try { source = fs.readFileSync(absolutePath, 'utf8') } catch (error) {
    diagnostics.push(diagnostic('MISSING_DESCRIPTOR', `Cannot read canvas JSONL: ${error.message}`, relativePath))
    return null
  }
  const replay = replayCanvas(source)
  for (const item of replay.diagnostics) {
    if (item.code === 'missing-canvas-id' || item.code === 'unsupported-format-version') continue
    diagnostics.push(diagnostic(`CANVAS_${item.code.replaceAll('-', '_').toUpperCase()}`, item.message, relativePath, {
      line: item.line,
      severity: item.severity,
    }))
  }
  const header = replay.records.find(record => record.value?.event === 'canvas_created')?.value ?? {}
  return {
    rawDescriptor: header,
    formatVersion: replay.formatVersion,
    id: replay.canvasId,
    title: fallbackTitle,
    canvasStatus: replay.status,
  }
}

function artifactShell(name, kind, relativePath, { wrappedDocument = false } = {}) {
  const suffix = ARTIFACT_DIRECTORY_SUFFIXES[kind]
  const descriptorName = `${name}${suffix}.${kind === 'canvas' ? 'jsonl' : 'json'}`
  const documentPath = wrappedDocument ? `${relativePath}/${name}.doc.mdx` : relativePath
  const descriptorPath = kind === 'doc' ? documentPath : `${relativePath}/${descriptorName}`
  return {
    id: null,
    kind,
    title: name,
    folderPath: kind === 'doc'
      ? (wrappedDocument ? relativePath : (path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath)))
      : relativePath,
    path: documentPath,
    descriptorPath,
    payloadPath: documentPath,
    descriptor: null,
    references: [],
    views: [],
    diagnostics: [],
    available: false,
  }
}

function discoverOne(root, absolutePath, relativePath, name, kind, options) {
  const artifact = artifactShell(name, kind, relativePath, options)
  const diagnostics = artifact.diagnostics
  const absoluteDescriptorPath = path.join(root, ...artifact.descriptorPath.split('/'))
  let descriptor
  if (kind === 'doc') {
    descriptor = readDocFrontmatter(absoluteDescriptorPath, artifact.payloadPath, diagnostics)
  } else if (kind === 'canvas') {
    descriptor = readCanvasIdentity(absoluteDescriptorPath, artifact.descriptorPath, name, diagnostics)
  } else {
    descriptor = readJsonDescriptor(absoluteDescriptorPath, artifact.descriptorPath, diagnostics)
  }
  if (descriptor) {
    if (kind !== 'canvas') validateDescriptorSchema(kind, descriptor, artifact, diagnostics)
    artifact.descriptor = structuredClone(kind === 'canvas' ? descriptor.rawDescriptor : descriptor)
    if (kind === 'canvas') artifact.canvasStatus = descriptor.canvasStatus
    artifact.views = Array.isArray(descriptor.views) ? structuredClone(descriptor.views) : []
    if (kind === 'canvas') {
      if (descriptor.formatVersion !== 1) diagnostics.push(diagnostic('UNSUPPORTED_FORMAT_VERSION', 'Canvas formatVersion must be 1.', artifact.descriptorPath, { field: 'formatVersion' }))
      if (typeof descriptor.id !== 'string' || !ID_PATTERN.test(descriptor.id)) {
        diagnostics.push(diagnostic('MISSING_OR_INVALID_ID', 'Canvas header must contain a stable canvasId.', artifact.descriptorPath, { field: 'canvasId' }))
      }
    }
    if (typeof descriptor.id === 'string') artifact.id = descriptor.id
    if (typeof descriptor.title === 'string' && descriptor.title.trim()) artifact.title = descriptor.title
    if (Array.isArray(descriptor.references)) {
      artifact.references = descriptor.references.filter(value => typeof value === 'string')
      if (artifact.references.length !== descriptor.references.length || artifact.references.some(value => !ID_PATTERN.test(value))) {
        diagnostics.push(diagnostic('INVALID_REFERENCES', 'references must contain only stable artifact IDs.', artifact.descriptorPath, { field: 'references' }))
      }
    } else if (descriptor.references !== undefined) {
      diagnostics.push(diagnostic('INVALID_REFERENCES', 'references must be an array of stable artifact IDs.', artifact.descriptorPath, { field: 'references' }))
    }
    if (kind === 'prototype') {
      if (descriptor.runtime?.id !== PROTOTYPE_RUNTIME.id || descriptor.runtime?.version !== PROTOTYPE_RUNTIME.version) {
        diagnostics.push(diagnostic('UNSUPPORTED_PROTOTYPE_RUNTIME', `Prototype runtime must use ${PROTOTYPE_RUNTIME.id}@${PROTOTYPE_RUNTIME.version}.`, artifact.descriptorPath, { field: 'runtime' }))
      } else {
        artifact.runtime = { ...PROTOTYPE_RUNTIME }
      }
      artifact.entry = safeRelative(descriptor.entry, 'entry', artifact.descriptorPath, diagnostics)
      validateUniqueViews(artifact, diagnostics)
      if (artifact.entry) {
        const normalizedEntry = path.posix.normalize(artifact.entry)
        if (normalizedEntry === '..' || normalizedEntry.startsWith('../')) {
          diagnostics.push(diagnostic('INVALID_RELATIVE_PATH', 'Prototype entry must remain inside its artifact directory.', artifact.descriptorPath, { field: 'entry' }))
        } else {
          const absoluteEntry = path.resolve(root, ...artifact.folderPath.split('/'), ...artifact.entry.split('/'))
          try {
            const realEntry = fs.realpathSync.native(absoluteEntry)
            const realArtifact = fs.realpathSync.native(path.resolve(root, ...artifact.folderPath.split('/')))
            if (!inside(realArtifact, realEntry) || !fs.statSync(realEntry).isFile()) {
              diagnostics.push(diagnostic('INVALID_PROTOTYPE_ENTRY', 'Prototype entry must be an existing file inside its artifact directory.', artifact.descriptorPath, { field: 'entry' }))
            }
          } catch {
            diagnostics.push(diagnostic('MISSING_PROTOTYPE_ENTRY', `Prototype entry does not exist: ${artifact.entry}`, artifact.descriptorPath, { field: 'entry' }))
          }
        }
      }
    }
    if (kind === 'site') {
      if (descriptor.local !== undefined && (!descriptor.local || typeof descriptor.local !== 'object' || Array.isArray(descriptor.local))) {
        diagnostics.push(diagnostic('INVALID_SITE_LOCAL_REFERENCE', 'local must be an object.', artifact.descriptorPath, { field: 'local' }))
      }
      if (descriptor.published !== undefined && (!descriptor.published || typeof descriptor.published !== 'object' || Array.isArray(descriptor.published))) {
        diagnostics.push(diagnostic('INVALID_SITE_PUBLISHED_REFERENCE', 'published must be an object.', artifact.descriptorPath, { field: 'published' }))
      }
      artifact.local = descriptor.local && typeof descriptor.local === 'object' && !Array.isArray(descriptor.local) ? { ...descriptor.local } : null
      artifact.published = descriptor.published && typeof descriptor.published === 'object' && !Array.isArray(descriptor.published) ? { ...descriptor.published } : null
      if (artifact.local?.sourcePath !== undefined) {
        if (typeof artifact.local.sourcePath !== 'string' || artifact.local.sourcePath.length === 0) {
          diagnostics.push(diagnostic('INVALID_LOCAL_SOURCE_PATH', 'local.sourcePath must be a non-empty local filesystem path.', artifact.descriptorPath, { field: 'local.sourcePath' }))
        }
      }
      if (artifact.local?.developmentUrl !== undefined && !isHttpUrl(artifact.local.developmentUrl)) {
        diagnostics.push(diagnostic('INVALID_LOCAL_DEVELOPMENT_URL', 'local.developmentUrl must be an absolute HTTP(S) URL.', artifact.descriptorPath, { field: 'local.developmentUrl' }))
      }
      if (artifact.published?.url !== undefined && !isHttpUrl(artifact.published.url)) {
        diagnostics.push(diagnostic('INVALID_PUBLISHED_URL', 'published.url must be an absolute HTTP(S) URL.', artifact.descriptorPath, { field: 'published.url' }))
      }
      validateUniqueViews(artifact, diagnostics)
      if (Array.isArray(descriptor.views)) {
        for (const [index, view] of descriptor.views.entries()) {
          if (view?.localUrl !== undefined && !isHttpUrl(view.localUrl)) {
            diagnostics.push(diagnostic('INVALID_VIEW_LOCAL_URL', `views[${index}].localUrl must be an absolute HTTP(S) URL.`, artifact.descriptorPath, { field: `views[${index}].localUrl` }))
          }
          if (view?.publishedUrl !== undefined && !isHttpUrl(view.publishedUrl)) {
            diagnostics.push(diagnostic('INVALID_VIEW_PUBLISHED_URL', `views[${index}].publishedUrl must be an absolute HTTP(S) URL.`, artifact.descriptorPath, { field: `views[${index}].publishedUrl` }))
          }
          if (view?.screenshot !== undefined) {
            const screenshot = safeRelative(view.screenshot, `views[${index}].screenshot`, artifact.descriptorPath, diagnostics)
            if (screenshot) {
              try { resolveNotebookPath(root, artifact.folderPath, screenshot) } catch {
                diagnostics.push(diagnostic('INVALID_RELATIVE_PATH', `views[${index}].screenshot must resolve inside the notebook root.`, artifact.descriptorPath, { field: `views[${index}].screenshot` }))
              }
            }
          }
        }
      }
    }
  }
  artifact.available = !diagnostics.some(item => item.severity === 'error') && artifact.id !== null
  return artifact
}

function validateUniqueViews(artifact, diagnostics) {
  const seen = new Set()
  for (const [index, view] of artifact.views.entries()) {
    if (!view || typeof view !== 'object' || Array.isArray(view) || typeof view.id !== 'string') continue
    if (seen.has(view.id)) {
      diagnostics.push(diagnostic('DUPLICATE_VIEW_ID', `View id "${view.id}" is used more than once.`, artifact.descriptorPath, {
        field: `views[${index}].id`, id: view.id,
      }))
    }
    seen.add(view.id)
  }
}

function listEntries(directory, relativePath, diagnostics) {
  try {
    return fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))
  } catch (error) {
    diagnostics.push(diagnostic('UNREADABLE_DIRECTORY', `Cannot read directory: ${error.message}`, relativePath || '.'))
    return []
  }
}

function scanNestedArtifacts(rootReal, absoluteDirectory, relativeDirectory, containing, diagnostics, allowedDocumentPath = null) {
  for (const entry of listEntries(absoluteDirectory, relativeDirectory, diagnostics)) {
    if (entry.isSymbolicLink() || NOTEBOOK_INFRASTRUCTURE_DIRECTORIES.has(entry.name)) continue
    const absolutePath = path.join(absoluteDirectory, entry.name)
    let realPath
    try { realPath = fs.realpathSync.native(absolutePath) } catch { continue }
    if (!inside(rootReal, realPath)) continue
    const relativePath = path.posix.join(relativeDirectory, entry.name)
    if (entry.isFile() && entry.name.endsWith('.doc.mdx')) {
      if (relativePath === allowedDocumentPath) continue
      diagnostics.push(diagnostic(
        'NESTED_ARTIFACT',
        `doc artifact ${relativePath} is inside ${containing.kind} artifact ${containing.path}; artifact folders cannot contain other artifacts.`,
        relativePath,
        { nestedArtifact: { kind: 'doc', path: relativePath }, containingArtifact: containing },
      ))
      continue
    }
    if (!entry.isDirectory()) continue
    const kind = directoryKind(entry.name)
    if (kind) {
      diagnostics.push(diagnostic(
        'NESTED_ARTIFACT',
        `${kind} artifact ${relativePath} is inside ${containing.kind} artifact ${containing.path}; artifact folders cannot contain other artifacts.`,
        relativePath,
        { nestedArtifact: { kind, path: relativePath }, containingArtifact: containing },
      ))
      scanNestedArtifacts(rootReal, absolutePath, relativePath, { kind, path: relativePath }, diagnostics)
    } else {
      scanNestedArtifacts(rootReal, absolutePath, relativePath, containing, diagnostics, allowedDocumentPath)
    }
  }
}

function documentWrapperName(directoryName) {
  return directoryName.endsWith('.doc') && directoryName.length > '.doc'.length
    ? directoryName.slice(0, -'.doc'.length)
    : null
}

function matchingDocumentPayload(absoluteDirectory, directoryName) {
  const name = documentWrapperName(directoryName)
  if (!name) return { name: null, status: 'not-wrapper', payloadName: null }
  const payloadName = `${name}.doc.mdx`
  const payloadPath = path.join(absoluteDirectory, payloadName)
  try {
    const stat = fs.lstatSync(payloadPath)
    if (stat.isFile() && !stat.isSymbolicLink()) return { name, status: 'matched', payloadName }
  } catch {}
  let documentFiles = []
  try {
    documentFiles = fs.readdirSync(absoluteDirectory, { withFileTypes: true })
      .filter(child => child.isFile() && child.name.endsWith('.doc.mdx'))
      .map(child => child.name)
      .sort((a, b) => a.localeCompare(b, 'en'))
  } catch {}
  return { name, status: documentFiles.length ? 'mismatched' : 'missing', payloadName, documentFiles }
}

/** Discover first-look Design Notebook artifacts and the ordinary folder tree. */
export function discoverNotebook(notebookRoot) {
  const root = fs.realpathSync.native(path.resolve(notebookRoot))
  const artifacts = []
  const diagnostics = []
  const entries = []
  const ids = new Map()

  function walk(directory, relativeDirectory, targetEntries) {
    for (const entry of listEntries(directory, relativeDirectory, diagnostics)) {
      if (entry.isSymbolicLink() || NOTEBOOK_INFRASTRUCTURE_DIRECTORIES.has(entry.name)) continue
      const absolutePath = path.join(directory, entry.name)
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name
      let realPath
      try { realPath = fs.realpathSync.native(absolutePath) } catch { continue }
      if (!inside(root, realPath)) continue
      if (entry.isDirectory()) {
        const kind = directoryKind(entry.name)
        if (kind) {
          const artifact = discoverOne(root, absolutePath, relativePath, entry.name.slice(0, -ARTIFACT_DIRECTORY_SUFFIXES[kind].length), kind)
          artifacts.push(artifact)
          targetEntries.push({ type: 'artifact', artifact })
          scanNestedArtifacts(root, absolutePath, relativePath, { kind, path: relativePath }, diagnostics)
        } else if (documentWrapperName(entry.name)) {
          const wrapper = matchingDocumentPayload(absolutePath, entry.name)
          if (wrapper.status === 'matched') {
            const artifact = discoverOne(root, absolutePath, relativePath, wrapper.name, 'doc', { wrappedDocument: true })
            artifacts.push(artifact)
            targetEntries.push({ type: 'artifact', artifact })
            scanNestedArtifacts(root, absolutePath, relativePath, { kind: 'doc', path: artifact.path }, diagnostics, artifact.payloadPath)
          } else {
            const expectedPath = path.posix.join(relativePath, wrapper.payloadName)
            diagnostics.push(diagnostic(
              wrapper.status === 'mismatched' ? 'MISMATCHED_DOCUMENT_WRAPPER' : 'MISSING_DOCUMENT_WRAPPER_PAYLOAD',
              wrapper.status === 'mismatched'
                ? `Document wrapper ${relativePath} must contain ${wrapper.payloadName}; found ${wrapper.documentFiles.join(', ')}.`
                : `Document wrapper ${relativePath} remains an ordinary folder until it contains ${wrapper.payloadName}.`,
              relativePath,
              { expectedPath, ...(wrapper.documentFiles?.length ? { found: wrapper.documentFiles } : {}) },
            ))
            const group = { type: 'group', name: entry.name, path: relativePath, children: [] }
            walk(absolutePath, relativePath, group.children)
            targetEntries.push(group)
          }
        } else {
          const group = { type: 'group', name: entry.name, path: relativePath, children: [] }
          walk(absolutePath, relativePath, group.children)
          targetEntries.push(group)
        }
      } else if (entry.isFile() && entry.name.endsWith('.doc.mdx')) {
        const name = entry.name.slice(0, -'.doc.mdx'.length)
        const artifact = discoverOne(root, absolutePath, relativePath, name, 'doc')
        artifacts.push(artifact)
        targetEntries.push({ type: 'artifact', artifact })
      }
    }
  }

  walk(root, '', entries)
  for (const artifact of artifacts) {
    if (artifact.id === null) continue
    ids.set(artifact.id, [...(ids.get(artifact.id) ?? []), artifact])
  }
  for (const [id, matches] of ids) {
    if (matches.length < 2) continue
    const paths = matches.map(artifact => artifact.path)
    for (const artifact of matches) {
      const item = diagnostic('DUPLICATE_ARTIFACT_ID', `Artifact id "${id}" is used by ${paths.join(' and ')}.`, artifact.path, { id, paths })
      artifact.diagnostics.push(item)
      artifact.available = false
    }
  }
  for (const artifact of artifacts) {
    artifact.resolvedReferences = artifact.references.map(id => {
      const matches = ids.get(id) ?? []
      if (matches.length === 1) {
        const target = matches[0]
        return { id, kind: target.kind, path: target.path }
      }
      const item = diagnostic(
        matches.length ? 'AMBIGUOUS_REFERENCE' : 'UNRESOLVED_REFERENCE',
        matches.length
          ? `Reference "${id}" is ambiguous because multiple artifacts use that ID.`
          : `Reference "${id}" does not match a discovered artifact ID.`,
        artifact.path,
        { id, matches: matches.map(target => target.path), severity: 'warning' },
      )
      artifact.diagnostics.push(item)
      return null
    }).filter(Boolean)
  }
  for (const artifact of artifacts) diagnostics.push(...artifact.diagnostics)
  return { root, entries, artifacts, diagnostics }
}
