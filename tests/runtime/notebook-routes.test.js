import test from 'node:test'
import assert from 'node:assert/strict'
import { buildArtifactPath, diagnoseArtifactRoutes, normalizeRouteBase, parseArtifactPath } from '../../src/core/runtime/notebook-routes.js'
import { discoverNotebook } from '../../src/core/artifacts/discovery.js'

const prototype = {
  id: 'borrow-flow',
  kind: 'prototype',
  views: [
    { id: 'default', title: 'Default', path: '/' },
    { id: 'request', title: 'Request', path: '/request?step=1#form' },
  ],
}
const site = { id: 'marketing-site', kind: 'site', views: [{ id: 'home', title: 'Home', path: '/' }] }
const canvas = { id: 'review-canvas', kind: 'canvas' }
const doc = { id: 'notes', kind: 'doc' }

test('builds stable canonical paths for every artifact kind and preserves base prefixes', () => {
  const options = { base: '/preview/branch/' }
  assert.equal(buildArtifactPath(prototype, options), '/preview/branch/borrow-flow')
  assert.equal(buildArtifactPath(prototype, { ...options, viewId: 'request' }), '/preview/branch/borrow-flow/request?step=1#form')
  assert.equal(buildArtifactPath(site, { ...options, viewId: 'home' }), '/preview/branch/sites/marketing-site?view=home')
  assert.equal(buildArtifactPath(canvas, options), '/preview/branch/canvas/review-canvas')
  assert.equal(buildArtifactPath({ ...canvas, folderPath: 'before/move' }), buildArtifactPath({ ...canvas, folderPath: 'after/move' }))
  assert.equal(buildArtifactPath(doc, options), '/preview/branch/docs/notes')
  assert.equal(buildArtifactPath(canvas, { base: '/preview/my%20branch/' }), '/preview/my%20branch/canvas/review-canvas')
  assert.equal(buildArtifactPath(canvas, { base: '/preview/my branch/' }), '/preview/my%20branch/canvas/review-canvas')
  assert.equal(normalizeRouteBase('/preview/my%20branch/'), '/preview/my%20branch/')
  assert.throws(() => buildArtifactPath(canvas, { base: '/preview/%2e%2e/private/' }), /traversal/)
  assert.throws(() => buildArtifactPath(canvas, { base: '/preview/my%2Fbranch/' }), /separators/)
})

test('browser-safe route API is exposed through the package subpath', async () => {
  const publicRoutes = await import('design-notebook/runtime/notebook-routes')
  assert.equal(publicRoutes.buildArtifactPath(canvas), buildArtifactPath(canvas))
  assert.equal(publicRoutes.normalizeRouteBase('/preview/my%20branch/'), '/preview/my%20branch/')
  assert.equal(typeof publicRoutes.parseArtifactPath, 'function')
  assert.equal(typeof publicRoutes.diagnoseArtifactRoutes, 'function')
})

test('parser resolves canonical paths and exact named views', () => {
  const artifacts = [prototype, site, canvas, doc]
  assert.equal(parseArtifactPath('/preview/branch/borrow-flow/request?step=1#form', { artifacts, base: '/preview/branch/' }).view.id, 'request')
  const siteMatch = parseArtifactPath('/preview/branch/sites/marketing-site?view=home', { artifacts, base: '/preview/branch/' })
  assert.equal(siteMatch.status, 'matched')
  assert.equal(siteMatch.view.id, 'home')
  assert.equal(parseArtifactPath('/preview/branch/canvas/review-canvas', { artifacts, base: '/preview/branch/' }).artifact, canvas)
  assert.equal(parseArtifactPath('/preview/branch/docs/notes', { artifacts, base: '/preview/branch/' }).artifact, doc)
  for (const route of [
    '/preview/branch/borrow-flow/',
    '/preview/branch/borrow-flow/request?step=1#form',
    '/preview/branch/canvas/review-canvas/',
    '/preview/branch/docs/notes/',
    '/preview/branch/sites/marketing-site/',
    '/preview/branch/sites/marketing-site/?view=home',
  ]) assert.equal(parseArtifactPath(route, { artifacts, base: '/preview/branch/' }).status, 'matched', route)
  assert.equal(parseArtifactPath('/outside/canvas/review-canvas', { artifacts, base: '/preview/branch/' }).status, 'not-found')
  assert.equal(parseArtifactPath('/preview/branch/borrow-flow//request?step=1#form', { artifacts, base: '/preview/branch/' }).status, 'not-found')
})

test('legacy artifact query links parse read-only and return a pathname canonical URL', () => {
  const matched = parseArtifactPath('/preview/branch/?artifact=borrow-flow&view=request', { artifacts: [prototype], base: '/preview/branch/' })
  assert.equal(matched.status, 'matched')
  assert.equal(matched.legacy, true)
  assert.equal(matched.canonicalPath, '/preview/branch/borrow-flow/request?step=1#form')
  assert.throws(() => buildArtifactPath(prototype, { viewId: 'missing' }), /not found/)
  assert.equal(parseArtifactPath('/?artifact=borrow-flow&view=', { artifacts: [prototype] }).status, 'invalid')
  assert.equal(parseArtifactPath('/borrow-flow?view=unknown', { artifacts: [prototype] }).status, 'invalid')
  assert.equal(parseArtifactPath('/sites/marketing-site?view=', { artifacts: [site] }).status, 'invalid')
})

test('diagnostics ignore the first view alias at root and report genuine route conflicts', () => {
  assert.deepEqual(diagnoseArtifactRoutes([prototype]), [])
  const conflict = { ...prototype, title: 'Duplicate stable identity' }
  const diagnostics = diagnoseArtifactRoutes([prototype, conflict, { id: 'canvas', kind: 'prototype', views: [] }])
  assert.ok(diagnostics.some(item => item.code === 'ARTIFACT_ROUTE_COLLISION'))
  assert.ok(diagnostics.some(item => item.code === 'RESERVED_ARTIFACT_ROUTE_PREFIX'))
})

test('actual starter default prototype route is not diagnosed as a collision', () => {
  const graph = discoverNotebook(new URL('../../examples/first-look/notebook', import.meta.url).pathname)
  const artifact = graph.artifacts.find(item => item.kind === 'prototype' && item.id === 'borrow-flow')
  assert.ok(artifact)
  const diagnostics = diagnoseArtifactRoutes(graph.artifacts)
  assert.equal(diagnostics.some(item => item.artifactIds?.includes('borrow-flow') && item.code === 'ARTIFACT_ROUTE_COLLISION'), false)
  const result = parseArtifactPath('/borrow-flow', { artifacts: graph.artifacts })
  assert.equal(result.status, 'matched')
  assert.equal(result.artifact.id, 'borrow-flow')
})

test('malformed IDs, views, reserved prefixes and collisions are explicit', () => {
  assert.throws(() => buildArtifactPath({ id: '../x', kind: 'canvas' }), /safe path segment/)
  assert.throws(() => buildArtifactPath(prototype, { viewId: '' }), /non-empty/)
  assert.throws(() => buildArtifactPath({ ...prototype, views: [{ id: 'escape', path: '/%2e%2e/private' }] }, { viewId: 'escape' }), /Invalid prototype view path/)
  const duplicates = [{ id: 'same', kind: 'canvas' }, { id: 'same', kind: 'canvas' }]
  assert.ok(diagnoseArtifactRoutes(duplicates).some(item => item.code === 'ARTIFACT_ROUTE_COLLISION'))
  assert.equal(parseArtifactPath('/canvas/same', { artifacts: duplicates }).status, 'ambiguous')
  assert.ok(diagnoseArtifactRoutes([{ id: 'Docs', kind: 'prototype', views: [] }]).some(item => item.code === 'RESERVED_ARTIFACT_ROUTE_PREFIX'))
  assert.equal(parseArtifactPath('/Docs', { artifacts: [{ id: 'Docs', kind: 'prototype', views: [] }] }).status, 'invalid')
})
