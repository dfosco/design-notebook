import assert from 'node:assert/strict'
import test from 'node:test'
import { compileDocument } from '../../src/core/docs/index.js'

const validDocument = `---
formatVersion: 1
id: review-notes
title: Review notes
references:
  - prototype-checkout
---
import { Prototype, Site, Image, CanvasWidget } from 'design-notebook/docs'

# First section

The prototype is ready.

<Prototype artifactId="prototype-checkout" viewId="overview" />

Second section.

<Site artifactId="missing-site" viewId="home" />

<Image src="assets/flow.png" alt="Checkout flow" />
`

test('compiles Markdown-first MDX with identity metadata and preserves source order', async () => {
  const artifact = { id: 'review-notes', path: 'reviews/review.doc.mdx' }
  const artifacts = [{ id: 'prototype-checkout', kind: 'prototype' }]
  const local = await compileDocument(validDocument, { artifact, artifacts, mode: 'local' })
  const statik = await compileDocument(validDocument, { artifact, artifacts, mode: 'static' })

  assert.equal(local.available, true)
  assert.deepEqual(local.frontmatter, {
    formatVersion: 1,
    id: 'review-notes',
    title: 'Review notes',
    references: ['prototype-checkout'],
  })
  assert.equal(local.compiledSource, statik.compiledSource)
  assert.equal(local.compiledSource.includes("from 'design-notebook/docs'"), true)
  assert.ok(local.compiledSource.indexOf('First section') < local.compiledSource.indexOf('The prototype is ready.'))
  assert.ok(local.compiledSource.indexOf('The prototype is ready.') < local.compiledSource.indexOf('artifactId: "prototype-checkout"'))
  assert.ok(local.compiledSource.indexOf('artifactId: "prototype-checkout"') < local.compiledSource.indexOf('Second section.'))
  assert.ok(local.compiledSource.indexOf('Second section.') < local.compiledSource.indexOf('artifactId: "missing-site"'))
  assert.deepEqual(local.diagnostics, [])
})

test('reports malformed MDX with the document path and original source line', async () => {
  const result = await compileDocument(`---\nformatVersion: 1\nid: broken\ntitle: Broken\n---\n\n# Broken\n\n<Prototype artifactId={ />`, { path: 'broken.doc.mdx' })

  assert.equal(result.available, false)
  assert.ok(result.diagnostics.some(item => item.code === 'INVALID_DOCUMENT_MDX' && item.path === 'broken.doc.mdx' && item.line >= 7))
})

test('reports unsupported explicit imports and keeps host-declared imports available', async () => {
  const source = `---\nformatVersion: 1\nid: imports\ntitle: Imports\n---\nimport { Button } from 'design-notebook/widgets'\n\n<Button />`
  const rejected = await compileDocument(source, { path: 'imports.doc.mdx' })
  const supported = await compileDocument(source, { path: 'imports.doc.mdx', supportedImportSources: ['design-notebook/widgets'] })

  assert.equal(rejected.available, false)
  assert.equal(rejected.diagnostics[0].code, 'UNSUPPORTED_DOCUMENT_IMPORT')
  assert.equal(rejected.diagnostics[0].line, 6)
  assert.equal(supported.available, true)
  assert.deepEqual(supported.diagnostics, [])
})

test('reports capitalized MDX components that have no explicit import', async () => {
  const result = await compileDocument(`---\nformatVersion: 1\nid: missing-import\ntitle: Missing import\n---\n\n<Prototype artifactId="checkout" />`, { path: 'missing-import.doc.mdx' })
  assert.equal(result.available, false)
  assert.ok(result.diagnostics.some(item => item.code === 'UNIMPORTED_DOCUMENT_COMPONENT' && item.component === 'Prototype'))
})

test('marks invalid identity metadata and unresolved declared references', async () => {
  const invalid = await compileDocument(`---\nformatVersion: 2\nid: ../bad\ntitle: ''\n---\n# Body`)
  const unresolved = await compileDocument(`---\nformatVersion: 1\nid: refs\ntitle: Refs\nreferences:\n  - missing-artifact\n---\n# Body`, { artifacts: [] })
  const unavailable = await compileDocument(`---\nformatVersion: 1\nid: refs\ntitle: Refs\nreferences:\n  - broken-site\n---\n# Body`, { artifacts: [{ id: 'broken-site', available: false }] })

  assert.equal(invalid.available, false)
  assert.ok(invalid.diagnostics.filter(item => item.field).length >= 3)
  assert.equal(unresolved.available, true)
  assert.ok(unresolved.diagnostics.some(item => item.code === 'UNRESOLVED_DOCUMENT_REFERENCE' && item.id === 'missing-artifact'))
  assert.ok(unavailable.diagnostics.some(item => item.code === 'UNAVAILABLE_DOCUMENT_REFERENCE' && item.id === 'broken-site'))
})

test('does not turn a document rejected by discovery into available compiled content', async () => {
  const result = await compileDocument(`---\nformatVersion: 1\nid: broken-doc\ntitle: Broken doc\n---\n# Content`, {
    artifact: { id: 'broken-doc', path: 'broken.doc.mdx', available: false, diagnostics: [{ code: 'INVALID_DOCUMENT_FRONTMATTER' }] },
  })
  assert.equal(result.available, false)
  assert.ok(result.diagnostics.some(item => item.code === 'UNAVAILABLE_DOCUMENT_ARTIFACT'))
})

test('malformed references containers return frontmatter diagnostics without aborting resolution', async () => {
  for (const references of ['{}', '7']) {
    const result = await compileDocument(`---\nformatVersion: 1\nid: bad-references\ntitle: Bad references\nreferences: ${references}\n---\n# Body`, {
      path: 'bad-references.doc.mdx',
      artifacts: [{ id: 'available-artifact', available: true }],
    })
    assert.equal(result.available, false, references)
    assert.ok(result.diagnostics.some(item => item.code === 'INVALID_DOCUMENT_FRONTMATTER' && item.field === 'references'), references)
  }
})
