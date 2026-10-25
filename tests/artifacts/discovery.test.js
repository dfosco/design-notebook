import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Ajv2020 from 'ajv/dist/2020.js'
import * as publicApi from 'design-notebook'
import {
  discoverNotebook,
  NOTEBOOK_INFRASTRUCTURE_DIRECTORIES,
  resolveNotebookPath,
} from '../../src/core/artifacts/discovery.js'
import { buildArtifactPath } from '../../src/core/runtime/notebook-routes.js'

function notebook(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-artifacts-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

function write(root, relativePath, content) {
  const absolute = path.join(root, ...relativePath.split('/'))
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, content)
  return absolute
}

function descriptor(id, title, extra = {}) {
  return JSON.stringify({ formatVersion: 1, id, title, ...extra }, null, 2)
}

function addPrototype(root, folder, id, extra = {}) {
  write(root, `${folder}/src/index.html`, '<main>Prototype</main>')
  write(root, `${folder}/${path.posix.basename(folder).replace(/\.prototype$/, '')}.prototype.json`, descriptor(id, id, {
    runtime: { id: '@dfosco/statefully', version: '0.2.1' }, entry: 'src/index.html', ...extra,
  }))
}

function addCanvas(root, folder, id) {
  write(root, `${folder}/${path.posix.basename(folder).replace(/\.canvas$/, '')}.canvas.jsonl`, `${JSON.stringify({ event: 'canvas_created', canvasId: id, formatVersion: 1 })}\n`)
}

function addSite(root, folder, id, extra = {}) {
  write(root, `${folder}/${path.posix.basename(folder).replace(/\.site$/, '')}.site.json`, descriptor(id, id, extra))
}

function addDoc(root, file, id, title = id) {
  write(root, file, `---\nformatVersion: 1\nid: ${id}\ntitle: "${title}"\n---\n\n# ${title}\n`)
}

function paths(result) {
  return result.artifacts.map(artifact => artifact.path).sort()
}

test('discovers mixed artifacts at root and in arbitrary nested groups with spaces', t => {
  assert.equal(typeof publicApi.discoverNotebook, 'function')
  const root = notebook(t)
  addPrototype(root, 'root prototype.prototype', 'prototype-a')
  addCanvas(root, 'canvases/Reviews/deep group/Review.canvas', 'canvas-a')
  addSite(root, 'sites/Client/production site.site', 'site-a')
  addDoc(root, 'Product notes/Research/Why now.doc.mdx', 'doc-a', 'Why now')

  const result = discoverNotebook(root)
  assert.deepEqual(paths(result), [
    'Product notes/Research/Why now.doc.mdx',
    'canvases/Reviews/deep group/Review.canvas',
    'root prototype.prototype',
    'sites/Client/production site.site',
  ])
  assert.equal(result.diagnostics.length, 0)
  assert.deepEqual(result.artifacts.map(artifact => artifact.kind).sort(), ['canvas', 'doc', 'prototype', 'site'])
  assert.equal(result.artifacts.every(artifact => artifact.available), true)
  assert.equal(result.entries.find(entry => entry.type === 'group' && entry.name === 'canvases').children[0].type, 'group')
})

test('discovers direct and wrapped Docs as single parent-level artifacts with wrapper-relative assets and stable routes', t => {
  const root = notebook(t)
  addPrototype(root, 'work/Flow.prototype', 'prototype-a')
  addCanvas(root, 'work/Review.canvas', 'canvas-a')
  addSite(root, 'work/Catalog.site', 'site-a')
  addDoc(root, 'work/Direct.doc.mdx', 'direct-doc', 'Direct')
  write(root, 'work/Review notes.doc/Review notes.doc.mdx', [
    '---', 'formatVersion: 1', 'id: wrapped-doc', 'title: Wrapped notes', 'references: [direct-doc]', '---', '',
    '![Evidence](assets/evidence.svg)',
  ].join('\n'))
  write(root, 'work/Review notes.doc/assets/evidence.svg', '<svg />')

  const result = discoverNotebook(root)
  assert.deepEqual(result.diagnostics, [])
  assert.deepEqual(result.artifacts.map(artifact => artifact.kind).sort(), ['canvas', 'doc', 'doc', 'prototype', 'site'])
  const wrapped = result.artifacts.find(artifact => artifact.id === 'wrapped-doc')
  assert.equal(wrapped.path, 'work/Review notes.doc/Review notes.doc.mdx')
  assert.equal(wrapped.payloadPath, wrapped.path)
  assert.equal(wrapped.descriptorPath, wrapped.path)
  assert.equal(wrapped.folderPath, 'work/Review notes.doc')
  assert.deepEqual(wrapped.resolvedReferences, [{ id: 'direct-doc', kind: 'doc', path: 'work/Direct.doc.mdx' }])
  assert.equal(
    resolveNotebookPath(root, wrapped.folderPath, 'assets/evidence.svg'),
    fs.realpathSync.native(path.join(root, 'work/Review notes.doc/assets/evidence.svg')),
  )
  assert.equal(buildArtifactPath(wrapped), '/docs/wrapped-doc')

  const work = result.entries.find(entry => entry.type === 'group' && entry.name === 'work')
  const wrappedEntry = work.children.find(entry => entry.type === 'artifact' && entry.artifact.id === 'wrapped-doc')
  assert.ok(wrappedEntry, 'the Doc wrapper is promoted as one artifact entry')
  assert.equal(work.children.some(entry => entry.type === 'group' && entry.name === 'Review notes.doc'), false)

  const oldRoute = buildArtifactPath(wrapped)
  fs.renameSync(path.join(root, 'work/Review notes.doc'), path.join(root, 'work/Updated notes.doc'))
  fs.renameSync(path.join(root, 'work/Updated notes.doc/Review notes.doc.mdx'), path.join(root, 'work/Updated notes.doc/Updated notes.doc.mdx'))
  const moved = discoverNotebook(root).artifacts.find(artifact => artifact.id === 'wrapped-doc')
  assert.equal(buildArtifactPath(moved), oldRoute)
})

test('keeps suffix-only Doc folders visible and diagnoses missing or mismatched wrapper payloads', t => {
  const root = notebook(t)
  fs.mkdirSync(path.join(root, 'Empty.doc'))
  addDoc(root, 'Wrong name.doc/Other.doc.mdx', 'other-doc')

  const result = discoverNotebook(root)
  assert.equal(result.artifacts.some(artifact => artifact.path === 'Empty.doc'), false)
  assert.equal(result.entries.some(entry => entry.type === 'group' && entry.name === 'Empty.doc'), true)
  assert.equal(result.entries.some(entry => entry.type === 'group' && entry.name === 'Wrong name.doc'), true)
  assert.ok(result.diagnostics.some(item => item.code === 'MISSING_DOCUMENT_WRAPPER_PAYLOAD' && item.path === 'Empty.doc'))
  assert.ok(result.diagnostics.some(item => item.code === 'MISMATCHED_DOCUMENT_WRAPPER' && item.path === 'Wrong name.doc'))
  assert.equal(result.artifacts.some(artifact => artifact.id === 'other-doc'), true, 'a mismatched wrapper remains an ordinary group containing its direct Doc')
})

test('convenience folder names have no special discovery behavior and descriptor-only sites are valid', t => {
  const root = notebook(t)
  addPrototype(root, 'prototypes/nested/First.prototype', 'first')
  addCanvas(root, 'canvases/Canvases.canvas', 'canvas')
  addSite(root, 'sites/Only descriptor.site', 'external')

  const result = discoverNotebook(root)
  assert.equal(result.artifacts.length, 3)
  assert.equal(result.artifacts.find(item => item.kind === 'site').available, true)
  assert.equal(result.diagnostics.length, 0)
})

test('reports missing IDs, duplicate IDs, malformed descriptors and unsupported runtime', t => {
  const root = notebook(t)
  addPrototype(root, 'Missing.prototype', '', { runtime: { id: '@dfosco/statefully', version: '0.2.1' } })
  addSite(root, 'Broken.site', 'dup')
  addSite(root, 'Also broken.site', 'dup')
  write(root, 'Invalid.prototype/Invalid.prototype.json', '{ nope')
  write(root, 'Invalid runtime.prototype/src/index.html', '<main />')
  write(root, 'Invalid runtime.prototype/Invalid runtime.prototype.json', descriptor('runtime', 'Runtime', {
    runtime: { id: 'some-private-client/runtime', version: '1.0.0' }, entry: 'src/index.html',
  }))
  write(root, 'No identity.doc.mdx', '# no frontmatter\n')
  fs.mkdirSync(path.join(root, 'No descriptor.site'))

  const result = discoverNotebook(root)
  const codes = result.diagnostics.map(item => item.code)
  assert.ok(codes.includes('MISSING_OR_INVALID_ID'))
  assert.ok(codes.includes('DUPLICATE_ARTIFACT_ID'))
  assert.equal(codes.filter(code => code === 'DUPLICATE_ARTIFACT_ID').length, 2)
  assert.ok(codes.includes('INVALID_DESCRIPTOR_JSON'))
  assert.ok(codes.includes('UNSUPPORTED_PROTOTYPE_RUNTIME'))
  assert.ok(codes.includes('MISSING_DOCUMENT_FRONTMATTER'))
  assert.ok(result.artifacts.every(item => !item.available))
})

test('reports nested artifacts through intervening groups without registering them', t => {
  const root = notebook(t)
  addPrototype(root, 'Outer.prototype', 'outer')
  addSite(root, 'Outer.prototype/group with spaces/Nested.site', 'nested')
  addCanvas(root, 'Outer.prototype/group with spaces/deeper/Canvas.canvas', 'nested-canvas')

  const result = discoverNotebook(root)
  assert.deepEqual(paths(result), ['Outer.prototype'])
  const nested = result.diagnostics.filter(item => item.code === 'NESTED_ARTIFACT')
  assert.deepEqual(nested.map(item => item.nestedArtifact.path).sort(), [
    'Outer.prototype/group with spaces/Nested.site',
    'Outer.prototype/group with spaces/deeper/Canvas.canvas',
  ])
  assert.ok(nested.every(item => item.containingArtifact.path === 'Outer.prototype'))
})

test('ignores dependencies and generated directories, and never follows symlinks', t => {
  const root = notebook(t)
  for (const excluded of NOTEBOOK_INFRASTRUCTURE_DIRECTORIES) {
    addSite(root, `${excluded}/Hidden.site`, `hidden-${excluded}`)
  }
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'design-notebook-outside-'))
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }))
  addSite(outside, 'Escaped.site', 'escaped')
  fs.symlinkSync(outside, path.join(root, 'linked'), 'dir')

  const result = discoverNotebook(root)
  assert.deepEqual(result.artifacts, [])
  assert.deepEqual(result.diagnostics, [])
})

test('renames preserve authored identity while returned paths change', t => {
  const root = notebook(t)
  addSite(root, 'sites/Before.site', 'stable-site')
  addPrototype(root, 'Client.prototype', 'client', { references: ['stable-site'] })
  const beforeResult = discoverNotebook(root)
  const before = beforeResult.artifacts.find(item => item.kind === 'site')
  fs.renameSync(path.join(root, 'sites/Before.site'), path.join(root, 'sites/After.site'))
  fs.renameSync(path.join(root, 'sites/After.site/Before.site.json'), path.join(root, 'sites/After.site/After.site.json'))
  const afterResult = discoverNotebook(root)
  const after = afterResult.artifacts.find(item => item.kind === 'site')
  const client = afterResult.artifacts.find(item => item.kind === 'prototype')

  assert.equal(before.id, 'stable-site')
  assert.equal(after.id, before.id)
  assert.equal(after.path, 'sites/After.site')
  assert.deepEqual(client.resolvedReferences, [{ id: 'stable-site', kind: 'site', path: 'sites/After.site' }])
})

test('emits one warning per unresolved or ambiguous reference', t => {
  const root = notebook(t)
  addSite(root, 'First.site', 'duplicate')
  addSite(root, 'Second.site', 'duplicate')
  addPrototype(root, 'Source.prototype', 'source', { references: ['duplicate', 'missing'] })

  const result = discoverNotebook(root)
  const references = result.diagnostics.filter(item => item.code === 'AMBIGUOUS_REFERENCE' || item.code === 'UNRESOLVED_REFERENCE')
  assert.deepEqual(references.map(item => item.code).sort(), ['AMBIGUOUS_REFERENCE', 'UNRESOLVED_REFERENCE'])
  assert.deepEqual(result.artifacts.find(item => item.id === 'source').resolvedReferences, [])
})

test('diagnoses a Doc nested anywhere inside a typed artifact', t => {
  const root = notebook(t)
  addSite(root, 'Project.site', 'site')
  addDoc(root, 'Project.site/group/Inside.doc/Inside.doc.mdx', 'inside')

  const result = discoverNotebook(root)
  assert.deepEqual(paths(result), ['Project.site'])
  assert.deepEqual(result.diagnostics.filter(item => item.code === 'NESTED_ARTIFACT').map(item => ({
    nested: item.nestedArtifact.path,
    containing: item.containingArtifact.path,
  })), [{ nested: 'Project.site/group/Inside.doc/Inside.doc.mdx', containing: 'Project.site' }])
})

test('represents local and published Site destinations independently', t => {
  const root = notebook(t)
  addSite(root, 'Product.site', 'product-site', {
    local: { sourcePath: 'web-app', developmentUrl: 'http://localhost:3000' },
    published: { url: 'https://example.com' },
  })

  const artifact = discoverNotebook(root).artifacts[0]
  assert.equal(artifact.available, true)
  assert.deepEqual(artifact.local, { sourcePath: 'web-app', developmentUrl: 'http://localhost:3000' })
  assert.deepEqual(artifact.published, { url: 'https://example.com' })
})

test('returns full descriptors and view/state data through tree and flat results', t => {
  const root = notebook(t)
  const descriptorValue = {
    formatVersion: 1,
    id: 'prototype-with-views',
    title: 'Prototype',
    runtime: { id: '@dfosco/statefully', version: '0.2.1' },
    entry: 'src/index.html',
    views: [{ id: 'checkout', title: 'Checkout', path: '/checkout', state: { step: 2 } }],
    states: [{ id: 'signed-in', title: 'Signed in', values: { user: 'demo' } }],
    customExtension: { retained: true },
  }
  write(root, 'Prototype.prototype/src/index.html', '<main />')
  write(root, 'Prototype.prototype/Prototype.prototype.json', JSON.stringify(descriptorValue))

  const result = discoverNotebook(root)
  const artifact = result.artifacts[0]
  assert.deepEqual(artifact.descriptor, descriptorValue)
  assert.deepEqual(artifact.views, descriptorValue.views)
  assert.deepEqual(artifact.descriptor.states, descriptorValue.states)
  assert.deepEqual(artifact.descriptor.customExtension, { retained: true })
  assert.equal(result.entries[0].artifact, artifact)
  assert.equal(Object.keys(artifact).some(key => key.startsWith('_absolute')), false)
})

test('preserves canvas event extensions in the returned descriptor', t => {
  const root = notebook(t)
  const header = { event: 'canvas_created', canvasId: 'canvas-id', formatVersion: 1, customExtension: { retained: true } }
  write(root, 'Canvas.canvas/Canvas.canvas.jsonl', `${JSON.stringify(header)}\n`)

  const artifact = discoverNotebook(root).artifacts[0]
  assert.equal(artifact.id, 'canvas-id')
  assert.deepEqual(artifact.descriptor, header)
})

test('allows local Site source paths outside the notebook root and keeps them local-only', t => {
  const root = notebook(t)
  addSite(root, 'External.site', 'external-site', { local: { sourcePath: '../my-app' } })

  const artifact = discoverNotebook(root).artifacts[0]
  assert.equal(artifact.available, true)
  assert.deepEqual(artifact.local, { sourcePath: '../my-app' })
  assert.equal(artifact.published, null)
})

test('validates complete Site descriptors during discovery', t => {
  const root = notebook(t)
  addSite(root, 'Malformed views.site', 'malformed-views', {
    views: [null, { title: 'Missing ID', path: 7 }],
  })
  addSite(root, 'Malformed publication.site', 'malformed-publication', {
    published: {},
    views: [{ id: 'duplicate', title: 'One', publishedUrl: 'https://' }, { id: 'duplicate', title: 'Two' }],
  })

  const result = discoverNotebook(root)
  const malformedViews = result.artifacts.find(item => item.id === 'malformed-views')
  const malformedPublication = result.artifacts.find(item => item.id === 'malformed-publication')
  assert.equal(malformedViews.available, false)
  assert.ok(malformedViews.diagnostics.some(item => item.code === 'INVALID_DESCRIPTOR' && item.field?.startsWith('views.')))
  assert.equal(malformedPublication.available, false)
  assert.ok(malformedPublication.diagnostics.some(item => item.field === 'published.url'))
  assert.ok(malformedPublication.diagnostics.some(item => item.code === 'INVALID_DESCRIPTOR' && item.field === 'views.0.publishedUrl'))
  assert.ok(malformedPublication.diagnostics.some(item => item.code === 'DUPLICATE_VIEW_ID'))
})

test('parses YAML comments and nested metadata without dropping extension data', t => {
  const root = notebook(t)
  write(root, 'Research/Review.doc.mdx', [
    '---',
    'formatVersion: 1',
    'id: review-doc',
    'title: Review # editorial note',
    'references:',
    '  - target-site',
    'metadata:',
    '  owner: design',
    '  review:',
    '    complete: true',
    '---',
    '',
    '# Review',
  ].join('\n'))

  const artifact = discoverNotebook(root).artifacts[0]
  assert.equal(artifact.available, true)
  assert.equal(artifact.title, 'Review')
  assert.deepEqual(artifact.references, ['target-site'])
  assert.deepEqual(artifact.descriptor.metadata, { owner: 'design', review: { complete: true } })
})

test('rejects duplicate YAML frontmatter keys with a line diagnostic', t => {
  const root = notebook(t)
  write(root, 'Duplicate.doc.mdx', '---\nformatVersion: 1\nid: first\nid: second\ntitle: Duplicate\n---\n')

  const artifact = discoverNotebook(root).artifacts[0]
  assert.equal(artifact.available, false)
  assert.ok(artifact.diagnostics.some(item => item.code === 'INVALID_DOCUMENT_FRONTMATTER' && item.line === 4))
})

test('reports unreadable directories instead of treating them as valid empty groups', t => {
  const root = notebook(t)
  fs.mkdirSync(path.join(root, 'blocked'))
  const original = fs.readdirSync
  try {
    fs.readdirSync = function (directory, ...args) {
      if (directory === fs.realpathSync(path.join(root, 'blocked'))) throw Object.assign(new Error('permission denied'), { code: 'EACCES' })
      return original.call(this, directory, ...args)
    }
    const result = discoverNotebook(root)
    assert.equal(result.entries.find(entry => entry.path === 'blocked').children.length, 0)
    assert.ok(result.diagnostics.some(item => item.code === 'UNREADABLE_DIRECTORY' && item.path === 'blocked'))
  } finally {
    fs.readdirSync = original
  }
})

test('prototype schema pins the selected public runtime package and version', t => {
  const root = notebook(t)
  const schemaPath = new URL('../../schemas/artifacts/prototype.schema.json', import.meta.url)
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
  assert.deepEqual(schema.properties.runtime.required, ['id', 'version'])
  assert.equal(schema.properties.runtime.properties.id.const, '@dfosco/statefully')
  assert.equal(schema.properties.runtime.properties.version.const, '0.2.1')

  addPrototype(root, 'Selected.prototype', 'selected')
  const artifact = discoverNotebook(root).artifacts[0]
  assert.deepEqual(artifact.runtime, { id: '@dfosco/statefully', version: '0.2.1' })
})

test('resolves relative paths from their declared base and rejects root escapes', t => {
  const root = notebook(t)
  fs.mkdirSync(path.join(root, 'groups/deep'), { recursive: true })
  const realRoot = fs.realpathSync(root)
  assert.equal(resolveNotebookPath(root, 'groups/deep', 'assets/logo.svg'), path.join(realRoot, 'groups/deep/assets/logo.svg'))
  assert.equal(resolveNotebookPath(root, 'groups/deep', '../../shared/logo.svg'), path.join(realRoot, 'shared/logo.svg'))
  assert.throws(() => resolveNotebookPath(root, 'groups', '../../../outside'), /escapes the notebook/)
})

test('artifact JSON Schemas compile as draft 2020-12 and enforce the public runtime contract', () => {
  const ajv = new Ajv2020({ strict: false })
  ajv.addFormat('uri', value => {
    try { new URL(value); return true } catch { return false }
  })
  const readSchema = name => JSON.parse(fs.readFileSync(new URL(`../../schemas/artifacts/${name}`, import.meta.url), 'utf8'))
  const prototype = ajv.compile(readSchema('prototype.schema.json'))
  const site = ajv.compile(readSchema('site.schema.json'))
  const doc = ajv.compile(readSchema('doc-frontmatter.schema.json'))

  assert.equal(prototype({ formatVersion: 1, id: 'prototype', title: 'Prototype', runtime: { id: '@dfosco/statefully', version: '0.2.1' }, entry: 'src/index.html' }), true)
  assert.equal(prototype({ formatVersion: 1, id: 'prototype', title: 'Prototype', runtime: { id: '@dfosco/statefully', version: '0.2.0' }, entry: 'src/index.html' }), false)
  assert.equal(site({ formatVersion: 1, id: 'site', title: 'Site', local: { sourcePath: '../my-app' } }), true)
  assert.equal(doc({ formatVersion: 1, id: 'doc', title: 'Doc' }), true)
})
